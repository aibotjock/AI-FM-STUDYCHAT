import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, verify as verifySignature } from 'node:crypto';
import { createPlayBilling } from '../server/commercial/billing.js';

const NOW = Date.parse('2026-10-09T03:30:00Z');
const USER_ID = 'account-owner-123';
const PURCHASE_TOKEN = 'secret-purchase-token';
const hash = value => createHash('sha256').update(value).digest('hex');
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const env = {
  GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ type: 'service_account', client_email: 'billing@example.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://evil.example/steal' }),
  ANDROID_PACKAGE_NAME: 'com.aibotjock.familymedicinestudycoach',
};

function purchase(overrides = {}) {
  return {
    subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
    externalAccountIdentifiers: { obfuscatedExternalAccountId: hash(USER_ID) },
    acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING',
    lineItems: [{ productId: 'family_medicine_monthly', expiryTime: '2026-11-09T03:30:00Z', offerPhase: { basePrice: {} } }],
    ...overrides,
  };
}

function fixture({ result = purchase(), failOAuth = false, publisherStatus = 200, acknowledgeStatus = 204, fetchError = false, clock = () => NOW } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (fetchError) throw new Error(`Failed ${url}; credentials-secret`);
    if (url === 'https://oauth2.googleapis.com/token') {
      return Response.json(failOAuth ? { error_description: 'sensitive credential failure' } : { access_token: 'secret-google-access-token', expires_in: 3600 }, { status: failOAuth ? 401 : 200 });
    }
    if (url.endsWith(':acknowledge')) return new Response(null, { status: acknowledgeStatus });
    return Response.json(result, { status: publisherStatus });
  };
  return { billing: createPlayBilling({ env, fetchImpl, now: clock }), calls };
}

test('Play billing signs a constrained RS256 assertion and verifies the expected app/account/product', async () => {
  const { billing, calls } = fixture();
  assert.equal(billing.configured, true);
  const result = await billing.verify({ userId: USER_ID, purchaseToken: PURCHASE_TOKEN });
  assert.equal(result.purchaseTokenHash, hash(PURCHASE_TOKEN));
  assert.equal(result.productId, 'family_medicine_monthly');
  assert.equal(result.state, 'SUBSCRIPTION_STATE_ACTIVE');
  assert.equal(result.expiresAt, Date.parse('2026-11-09T03:30:00Z'));
  assert.equal(result.checkedAt, NOW);
  assert.equal(result.isTrial, false);
  assert.equal(result.trialPhaseKnown, true);
  assert.equal(result.acknowledgementNeeded, true);
  assert.equal(calls.length, 2, 'verification never acknowledges before persistence');
  const assertion = new URLSearchParams(calls[0].options.body).get('assertion');
  const [header, payload, signature] = assertion.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'RS256', typ: 'JWT' });
  const claims = JSON.parse(Buffer.from(payload, 'base64url'));
  assert.equal(claims.iss, 'billing@example.iam.gserviceaccount.com');
  assert.equal(claims.aud, 'https://oauth2.googleapis.com/token');
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/androidpublisher');
  assert.equal(claims.exp - claims.iat, 3600);
  assert.ok(verifySignature('RSA-SHA256', Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url')));
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[1].url, `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${env.ANDROID_PACKAGE_NAME}/purchases/subscriptionsv2/tokens/${PURCHASE_TOKEN}`);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer secret-google-access-token');
  assert.ok(Object.isFrozen(result));
  assert.equal(await billing.acknowledge(result), true);
  assert.equal(calls.length, 3, 'acknowledgement reuses the short-lived OAuth token');
  assert.ok(calls[2].url.endsWith(`/purchases/subscriptions/family_medicine_monthly/tokens/${PURCHASE_TOKEN}:acknowledge`));
  assert.equal(await billing.acknowledge(result), true);
  assert.equal(calls.length, 3, 'repeated acknowledgement of the same verified object is idempotent');
});

test('Play billing rejects missing credentials, malformed settings, and client-forged acknowledgement', async () => {
  for (const invalidEnv of [{}, { GOOGLE_SERVICE_ACCOUNT_JSON: 'invalid-secret-json' }, { ...env, ANDROID_PACKAGE_NAME: 'https://evil.example' }]) {
    const billing = createPlayBilling({ env: invalidEnv, fetchImpl: () => { throw new Error('Should not call network'); } });
    assert.equal(billing.configured, false);
    await assert.rejects(billing.verify({ userId: USER_ID, purchaseToken: PURCHASE_TOKEN }), { code: 'billing_not_configured', status: 503 });
  }
  const { billing, calls } = fixture();
  await assert.rejects(billing.acknowledge({ purchaseToken: PURCHASE_TOKEN, acknowledgementNeeded: true }), { code: 'purchase_not_verified', status: 400 });
  await assert.rejects(billing.verify({ userId: USER_ID, purchaseToken: '\r\ninvalid' }), { status: 400 });
  assert.equal(calls.length, 0);
});

test('Play purchase binding prevents receipt theft and requires the native account hash', async () => {
  for (const externalAccountIdentifiers of [{}, { obfuscatedExternalAccountId: hash('another-account') }, { obfuscatedExternalAccountId: USER_ID }, { obfuscatedExternalAccountId: 'é'.repeat(64) }]) {
    const { billing } = fixture({ result: purchase({ externalAccountIdentifiers }) });
    await assert.rejects(billing.verify({ userId: USER_ID, purchaseToken: PURCHASE_TOKEN }), { code: 'purchase_account_mismatch', status: 403 });
  }
});

test('Play verification rejects wrong products, malformed or expired receipts, and inactive states', async () => {
  const invalid = [
    purchase({ lineItems: [{ productId: 'other_product', expiryTime: '2026-11-09T03:30:00Z' }] }),
    purchase({ lineItems: [{ productId: 'family_medicine_monthly', expiryTime: '2026-10-09T03:30:00Z' }] }),
    purchase({ lineItems: [{ productId: 'family_medicine_monthly', expiryTime: 'next week' }] }),
    purchase({ lineItems: [] }),
    purchase({ lineItems: [...purchase().lineItems, ...purchase().lineItems] }),
    ...['SUBSCRIPTION_STATE_PENDING', 'SUBSCRIPTION_STATE_ON_HOLD', 'SUBSCRIPTION_STATE_PAUSED', 'SUBSCRIPTION_STATE_EXPIRED', 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED', 'unknown'].map(subscriptionState => purchase({ subscriptionState })),
    purchase({ acknowledgementState: 'ACKNOWLEDGEMENT_STATE_UNSPECIFIED' }),
  ];
  for (const result of invalid) {
    const { billing } = fixture({ result });
    await assert.rejects(billing.verify({ userId: USER_ID, purchaseToken: PURCHASE_TOKEN }), { code: 'purchase_ineligible', status: 403 });
  }
});

test('Play preserves access during grace period and cancellation only until verified expiration', async () => {
  for (const state of ['SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD', 'SUBSCRIPTION_STATE_CANCELED']) {
    const { billing } = fixture({ result: purchase({ subscriptionState: state }) });
    const verified = await billing.verify({ userId: USER_ID, purchaseToken: PURCHASE_TOKEN });
    assert.equal(verified.state, state);
  }
});

test('Play trial detection uses the current phase rather than enduring offer tags', async () => {
  const phases = [
    [{ freeTrial: {} }, true, true],
    [{ basePrice: {} }, false, true],
    [{ introductoryPrice: {} }, false, true],
    [{ prorationPeriod: { originalOfferPhaseType: 'FREE_TRIAL' } }, true, true],
    [{ prorationPeriod: { originalOfferPhaseType: 'BASE' } }, false, true],
    [undefined, true, false],
    [{ unknownFuturePhase: {} }, true, false],
  ];
  for (const [offerPhase, isTrial, trialPhaseKnown] of phases) {
    const { billing } = fixture({ result: purchase({ lineItems: [{ ...purchase().lineItems[0], offerDetails: { offerId: 'three-day-trial', offerTags: ['trial'] }, offerPhase }] }) });
    const verified = await billing.verify({ userId: USER_ID, purchaseToken: PURCHASE_TOKEN });
    assert.equal(verified.isTrial, isTrial);
    assert.equal(verified.trialPhaseKnown, trialPhaseKnown);
  }
});

test('Play never includes credentials, purchase tokens, or provider response bodies in errors', async () => {
  for (const options of [{ failOAuth: true }, { publisherStatus: 403 }, { publisherStatus: 429 }, { publisherStatus: 503 }, { fetchError: true }]) {
    const { billing } = fixture(options);
    await assert.rejects(billing.verify({ userId: USER_ID, purchaseToken: PURCHASE_TOKEN }), error => {
      assert.equal(error.status, 503);
      assert.equal(error.code, 'billing_unavailable');
      assert.doesNotMatch(error.message, /secret|credential|https|token/);
      assert.doesNotMatch(error.stack, /secret-purchase-token|secret-google-access-token|sensitive credential failure/);
      return true;
    });
  }
  const { billing } = fixture({ publisherStatus: 404 });
  await assert.rejects(billing.verify({ userId: USER_ID, purchaseToken: PURCHASE_TOKEN }), { code: 'purchase_ineligible', status: 403 });
  const acknowledgementFailure = fixture({ acknowledgeStatus: 503 });
  const verified = await acknowledgementFailure.billing.verify({ userId: USER_ID, purchaseToken: PURCHASE_TOKEN });
  await assert.rejects(acknowledgementFailure.billing.acknowledge(verified), { code: 'billing_unavailable', status: 503 });
});

test('Play already-acknowledged receipts skip network mutation and expired verification cannot be acknowledged', async () => {
  const { billing, calls } = fixture({ result: purchase({ acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED' }) });
  const verified = await billing.verify({ userId: USER_ID, purchaseToken: PURCHASE_TOKEN });
  assert.equal(await billing.acknowledge(verified), true);
  assert.equal(calls.length, 2);
  let current = NOW;
  const pending = fixture({ clock: () => current });
  const pendingReceipt = await pending.billing.verify({ userId: USER_ID, purchaseToken: PURCHASE_TOKEN });
  current = pendingReceipt.expiresAt;
  await assert.rejects(pending.billing.acknowledge(pendingReceipt), { code: 'purchase_ineligible', status: 403 });
});

test('Play concurrent verification shares OAuth authentication without sharing purchase results', async () => {
  const { billing, calls } = fixture();
  const [first, second] = await Promise.all([
    billing.verify({ userId: USER_ID, purchaseToken: 'first-token' }),
    billing.verify({ userId: USER_ID, purchaseToken: 'second-token' }),
  ]);
  assert.notEqual(first.purchaseTokenHash, second.purchaseTokenHash);
  assert.equal(calls.filter(call => call.url === 'https://oauth2.googleapis.com/token').length, 1);
  assert.equal(calls.length, 3);
});
