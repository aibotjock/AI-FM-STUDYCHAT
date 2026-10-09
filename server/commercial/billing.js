import { createHash, createPrivateKey, sign, timingSafeEqual } from 'node:crypto';

const OAUTH_URL = 'https://oauth2.googleapis.com/token';
const PUBLISHER_URL = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/';
const PUBLISHER_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const PRODUCT_ID = 'family_medicine_monthly';
const DEFAULT_PACKAGE = 'com.aibotjock.familymedicinestudycoach';
const ENTITLED_STATES = new Set([
  'SUBSCRIPTION_STATE_ACTIVE',
  'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
  'SUBSCRIPTION_STATE_CANCELED',
]);

export class PlayBillingError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = 'PlayBillingError';
    this.code = code;
    this.status = status;
  }
}

const unavailable = () => new PlayBillingError('Google Play verification is temporarily unavailable. Please try again.', 'billing_unavailable', 503);
const invalidPurchase = () => new PlayBillingError('This purchase does not provide an active subscription for this app.', 'purchase_ineligible', 403);
const sha256 = value => createHash('sha256').update(value, 'utf8').digest('hex');

function credentialsFrom(env) {
  try {
    const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (typeof raw !== 'string' || raw.length > 131072) return null;
    const account = JSON.parse(raw);
    if (account.type !== 'service_account' || typeof account.client_email !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(account.client_email)) return null;
    if (typeof account.private_key !== 'string' || account.private_key.length > 32768) return null;
    const key = createPrivateKey(account.private_key);
    if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 2048) return null;
    // The endpoint is fixed; untrusted token_uri fields cannot receive credentials.
    return { email: account.client_email, key };
  } catch {
    return null;
  }
}

function validToken(value) {
  return typeof value === 'string' && value.length >= 1 && value.length <= 4096 && !/[\s\u0000-\u001f\u007f]/u.test(value);
}

function validTimestamp(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
}

function trialPhase(item) {
  // offerId and offerTags identify the purchased offer, not its current phase.
  // Google's current OfferPhase is authoritative; unknown phases use the lower
  // trial AI budget without inventing an unverified paid entitlement.
  const phase = item.offerPhase;
  if (phase && typeof phase === 'object' && !Array.isArray(phase)) {
    if (Object.hasOwn(phase, 'freeTrial')) return { isTrial: true, trialPhaseKnown: true };
    if (Object.hasOwn(phase, 'basePrice') || Object.hasOwn(phase, 'introductoryPrice')) return { isTrial: false, trialPhaseKnown: true };
    if (phase.prorationPeriod?.originalOfferPhaseType === 'FREE_TRIAL') return { isTrial: true, trialPhaseKnown: true };
    if (['BASE', 'INTRODUCTORY'].includes(phase.prorationPeriod?.originalOfferPhaseType)) return { isTrial: false, trialPhaseKnown: true };
  }
  return { isTrial: true, trialPhaseKnown: false };
}

/** Server-only Google Play purchase verification. No client flag grants access.
 * Persist the verified purchase hash/account binding before acknowledge().
 * The caller must never serialize purchaseToken to clients or application logs.
 * API schema: https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2
 */
export function createPlayBilling({ env = process.env, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const credentials = credentialsFrom(env);
  const packageName = env.ANDROID_PACKAGE_NAME || DEFAULT_PACKAGE;
  const packageValid = typeof packageName === 'string' && packageName.length <= 255 && /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(packageName);
  const configured = Boolean(credentials && packageValid && typeof fetchImpl === 'function');
  const verifiedObjects = new WeakSet();
  const acknowledgedObjects = new WeakSet();
  let cachedAccessToken;
  let tokenRequest;

  async function safeFetch(url, options) {
    try {
      return await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(10000) });
    } catch {
      // Network exceptions often include the URL, hence the purchase token.
      throw unavailable();
    }
  }

  async function safeJson(response) {
    try { return await response.json(); }
    catch { throw unavailable(); }
  }

  async function obtainAccessToken() {
    if (!configured) throw new PlayBillingError('Google Play billing has not been configured.', 'billing_not_configured', 503);
    if (cachedAccessToken && cachedAccessToken.expiresAt > now() + 60000) return cachedAccessToken.value;
    if (tokenRequest) return tokenRequest;
    tokenRequest = (async () => {
      const issuedAt = Math.floor(now() / 1000);
      let assertion;
      try {
        const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
        const payload = Buffer.from(JSON.stringify({ iss: credentials.email, scope: PUBLISHER_SCOPE, aud: OAUTH_URL, iat: issuedAt, exp: issuedAt + 3600 })).toString('base64url');
        const data = `${header}.${payload}`;
        assertion = `${data}.${sign('RSA-SHA256', Buffer.from(data), credentials.key).toString('base64url')}`;
      } catch { throw unavailable(); }
      const response = await safeFetch(OAUTH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
      });
      if (!response.ok) throw unavailable();
      const result = await safeJson(response);
      if (typeof result?.access_token !== 'string' || !result.access_token || result.access_token.length > 8192 || !Number.isFinite(result.expires_in) || result.expires_in <= 0) throw unavailable();
      cachedAccessToken = { value: result.access_token, expiresAt: now() + Math.min(result.expires_in, 3600) * 1000 };
      return cachedAccessToken.value;
    })();
    try { return await tokenRequest; }
    finally { tokenRequest = undefined; }
  }

  async function publisherFetch(path, options = {}) {
    const accessToken = await obtainAccessToken();
    const response = await safeFetch(`${PUBLISHER_URL}${encodeURIComponent(packageName)}/${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${accessToken}`, ...options.headers },
    });
    if (response.status === 401) cachedAccessToken = undefined;
    return response;
  }

  async function verify({ userId, purchaseToken } = {}) {
    if (typeof userId !== 'string' || userId.length < 1 || userId.length > 256 || /[\u0000-\u001f\u007f]/u.test(userId) || !validToken(purchaseToken)) {
      throw new PlayBillingError('A valid account and Google Play purchase token are required.', 'purchase_input_invalid', 400);
    }
    const response = await publisherFetch(`purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`, { method: 'GET' });
    if ([400, 404, 410].includes(response.status)) throw invalidPurchase();
    if (!response.ok) throw unavailable();
    const purchase = await safeJson(response);
    const binding = purchase?.externalAccountIdentifiers?.obfuscatedExternalAccountId;
    const expectedBinding = sha256(userId);
    if (typeof binding !== 'string' || !/^[a-f0-9]{64}$/.test(binding) || !timingSafeEqual(Buffer.from(binding), Buffer.from(expectedBinding))) {
      throw new PlayBillingError('This purchase is not linked to your account. Restore it using the original account.', 'purchase_account_mismatch', 403);
    }
    // This app currently sells one monthly product, with no subscription add-ons.
    if (!Array.isArray(purchase.lineItems) || purchase.lineItems.length !== 1 || purchase.lineItems[0]?.productId !== PRODUCT_ID) throw invalidPurchase();
    const item = purchase.lineItems[0];
    const checkedAt = now();
    const expiresAt = validTimestamp(item.expiryTime);
    if (!ENTITLED_STATES.has(purchase.subscriptionState) || !Number.isFinite(expiresAt) || expiresAt <= checkedAt) throw invalidPurchase();
    if (!['ACKNOWLEDGEMENT_STATE_PENDING', 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED'].includes(purchase.acknowledgementState)) throw invalidPurchase();
    const verified = {
      purchaseTokenHash: sha256(purchaseToken),
      productId: PRODUCT_ID,
      state: purchase.subscriptionState,
      expiresAt,
      ...trialPhase(item),
      checkedAt,
      purchaseToken,
      acknowledgementNeeded: purchase.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING',
    };
    Object.freeze(verified);
    verifiedObjects.add(verified);
    return verified;
  }

  async function acknowledge(verified) {
    if (!verified || !verifiedObjects.has(verified)) throw new PlayBillingError('A server-verified purchase is required.', 'purchase_not_verified', 400);
    if (!verified.acknowledgementNeeded || acknowledgedObjects.has(verified)) return true;
    if (verified.expiresAt <= now()) throw invalidPurchase();
    const response = await publisherFetch(`purchases/subscriptions/${encodeURIComponent(verified.productId)}/tokens/${encodeURIComponent(verified.purchaseToken)}:acknowledge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    if (!response.ok) throw unavailable();
    acknowledgedObjects.add(verified);
    return true;
  }

  return Object.freeze({ configured, verify, acknowledge });
}
