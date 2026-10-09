// The account model endpoint does not describe capabilities or prices. Only
// documented text model profiles can become selectable study models.
const MODEL_ENDPOINT = 'https://api.openai.com/v1/models';
const CACHE_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 8000;
const MAX_CATALOG_BYTES = 1024 * 1024;
const DEFAULT_MODEL = 'gpt-4.1-mini';

export class OpenAIModelError extends Error {
  constructor(status, message) { super(message); this.name = 'OpenAIModelError'; this.status = status; }
}

export function assertAllowedModel(model) {
  // This check precedes all other validation, including returned model IDs.
  if (typeof model === 'string' && /astra/i.test(model)) throw new OpenAIModelError(400, 'Astra models are prohibited for this app.');
  if (typeof model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,149}$/.test(model)) throw new OpenAIModelError(400, 'Use a valid supported model ID.');
  return model;
}

const rates = (input, output) => Object.freeze({ inputUsdPerMillion: input, outputUsdPerMillion: output });
const modernEfforts = Object.freeze(['none', 'low', 'medium', 'high', 'xhigh', 'max']);
const gpt5Efforts = Object.freeze(['minimal', 'low', 'medium', 'high']);
const fiveEfforts = Object.freeze(['none', 'low', 'medium', 'high', 'xhigh']);
const proEfforts = Object.freeze(['medium', 'high', 'xhigh']);

function profile(id, label, input, output, options = {}) {
  const api = options.api || 'chat';
  return Object.freeze({ id, canonicalId: id, label, api, tokenParameter: api === 'responses' ? 'max_output_tokens' : 'max_completion_tokens', jsonMode: api !== 'responses', timeoutMs: api === 'responses' ? 180000 : 45000, defaultMaxOutputTokens: api === 'responses' ? 4096 : 1200, rates: input === null || output === null ? null : rates(input, output), ...options });
}

// Standard synchronous, short-context token prices in USD per million tokens.
// These values are explicit documented profiles, never inferred from model IDs.
const PROFILES = Object.freeze([
  profile('gpt-6.1-sol', 'GPT-6.1 Sol', 2, 10, { reasoningEffort: 'low', supportedReasoningEfforts: Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']), fixedId: true }),
  profile('gpt-6-sol', 'GPT-6 Sol', 2, 10, { reasoningEffort: 'low', supportedReasoningEfforts: modernEfforts, fixedId: true }),
  profile('gpt-6-luna', 'GPT-6 Luna', .10, .50, { reasoningEffort: 'low', supportedReasoningEfforts: modernEfforts, fixedId: true }),
  profile('gpt-5.6-sol', 'GPT-5.6 Sol', 4, 20, { reasoningEffort: 'low', supportedReasoningEfforts: modernEfforts, fixedId: true }),
  profile('gpt-5.6', 'GPT-5.6', 4, 20, { reasoningEffort: 'low', supportedReasoningEfforts: modernEfforts, fixedId: true }),
  profile('gpt-5.6-terra', 'GPT-5.6 Terra', 2, 12, { reasoningEffort: 'low', supportedReasoningEfforts: modernEfforts, fixedId: true }),
  profile('gpt-5.6-luna', 'GPT-5.6 Luna', .20, 1.20, { reasoningEffort: 'low', supportedReasoningEfforts: modernEfforts, fixedId: true }),
  profile('gpt-5.5', 'GPT-5.5', 5, 30, { reasoningEffort: 'low', supportedReasoningEfforts: fiveEfforts }),
  profile('gpt-5.5-pro', 'GPT-5.5 Pro', 30, 180, { api: 'responses', reasoningEffort: 'medium', supportedReasoningEfforts: proEfforts }),
  profile('gpt-5.4', 'GPT-5.4', 2.50, 15, { reasoningEffort: 'low', supportedReasoningEfforts: fiveEfforts }),
  profile('gpt-5.4-pro', 'GPT-5.4 Pro', 30, 180, { api: 'responses', reasoningEffort: 'medium', supportedReasoningEfforts: proEfforts }),
  profile('gpt-5.4-mini', 'GPT-5.4 Mini', .75, 4.50, { reasoningEffort: 'low', supportedReasoningEfforts: fiveEfforts }),
  profile('gpt-5.4-nano', 'GPT-5.4 Nano', .20, 1.25, { reasoningEffort: 'low', supportedReasoningEfforts: fiveEfforts }),
  profile('gpt-5.2', 'GPT-5.2', 1.75, 14, { reasoningEffort: 'low', supportedReasoningEfforts: fiveEfforts }),
  profile('gpt-5.2-pro', 'GPT-5.2 Pro', 21, 168, { api: 'responses', reasoningEffort: 'medium', supportedReasoningEfforts: proEfforts }),
  profile('gpt-5.1', 'GPT-5.1', 1.25, 10, { reasoningEffort: 'low', supportedReasoningEfforts: Object.freeze(['none', 'low', 'medium', 'high']) }),
  profile('gpt-5', 'GPT-5', 1.25, 10, { reasoningEffort: 'low', supportedReasoningEfforts: gpt5Efforts, deprecated: true }),
  profile('gpt-5-mini', 'GPT-5 Mini', .25, 2, { reasoningEffort: 'low', supportedReasoningEfforts: gpt5Efforts, deprecated: true }),
  profile('gpt-5-nano', 'GPT-5 Nano', .05, .40, { reasoningEffort: 'low', supportedReasoningEfforts: gpt5Efforts, deprecated: true }),
  profile('gpt-5-pro', 'GPT-5 Pro', 15, 120, { api: 'responses', reasoningEffort: 'high', supportedReasoningEfforts: Object.freeze(['high']) }),
  profile('gpt-4.1', 'GPT-4.1', 2, 8),
  profile('gpt-4.1-mini', 'GPT-4.1 Mini', .40, 1.60),
  profile('gpt-4.1-nano', 'GPT-4.1 Nano', .10, .40, { deprecated: true }),
  profile('gpt-4o', 'GPT-4o', 2.50, 10),
  profile('gpt-4o-mini', 'GPT-4o Mini', .15, .60),
  profile('o3', 'o3', 2, 8, { reasoningEffort: 'low', supportedReasoningEfforts: Object.freeze(['low', 'medium', 'high']), deprecated: true }),
  profile('o3-mini', 'o3 Mini', 1.10, 4.40, { reasoningEffort: 'low', supportedReasoningEfforts: Object.freeze(['low', 'medium', 'high']), deprecated: true }),
  profile('o3-pro', 'o3 Pro', 20, 80, { api: 'responses', deprecated: true }),
  profile('o4-mini', 'o4 Mini', 1.10, 4.40, { reasoningEffort: 'low', supportedReasoningEfforts: Object.freeze(['low', 'medium', 'high']), deprecated: true }),
  profile('o1', 'o1', 15, 60, { reasoningEffort: 'low', supportedReasoningEfforts: Object.freeze(['low', 'medium', 'high']), deprecated: true }),
  profile('gpt-3.5-turbo', 'GPT-3.5 Turbo', .50, 1.50, { tokenParameter: 'max_tokens', jsonMode: false, contextWindowTokens: 16385, deprecated: true }),
  profile('gpt-4-turbo', 'GPT-4 Turbo', 10, 30, { tokenParameter: 'max_tokens', jsonMode: false, contextWindowTokens: 128000, deprecated: true }),
  profile('gpt-4', 'GPT-4', 30, 60, { tokenParameter: 'max_tokens', jsonMode: false, contextWindowTokens: 8192, deprecated: true })
]);

const byId = new Map(PROFILES.map(item => [item.id, item]));
// Snapshots are exact documented IDs. Future dates do not inherit protocols or
// prices. Historical snapshots with different unverified prices remain null.
const SNAPSHOTS = new Map([
  ['gpt-5.4-mini-2026-03-17', 'gpt-5.4-mini'],
  ['gpt-5.4-nano-2026-03-17', 'gpt-5.4-nano'],
  ['gpt-5.4-2026-03-05', 'gpt-5.4'],
  ['gpt-5.4-pro-2026-03-05', 'gpt-5.4-pro'],
  ['gpt-5.5-2026-04-23', 'gpt-5.5'],
  ['gpt-5.5-pro-2026-04-23', 'gpt-5.5-pro'],
  ['gpt-5.2-2025-12-11', 'gpt-5.2'],
  ['gpt-5.2-pro-2025-12-11', 'gpt-5.2-pro'],
  ['gpt-5.1-2025-11-13', 'gpt-5.1'],
  ['gpt-5-2025-08-07', 'gpt-5'],
  ['gpt-5-mini-2025-08-07', 'gpt-5-mini'],
  ['gpt-5-nano-2025-08-07', 'gpt-5-nano'],
  ['gpt-5-pro-2025-10-06', 'gpt-5-pro'],
  ['gpt-4.1-2025-04-14', 'gpt-4.1'],
  ['gpt-4.1-mini-2025-04-14', 'gpt-4.1-mini'],
  ['gpt-4.1-nano-2025-04-14', 'gpt-4.1-nano'],
  ['gpt-4o-2024-05-13', 'gpt-4o'],
  ['gpt-4o-2024-08-06', 'gpt-4o'],
  ['gpt-4o-2024-11-20', 'gpt-4o'],
  ['gpt-4o-mini-2024-07-18', 'gpt-4o-mini'],
  ['o3-2025-04-16', 'o3'],
  ['o3-mini-2025-01-31', 'o3-mini'],
  ['o4-mini-2025-04-16', 'o4-mini'],
  ['o1-2024-12-17', 'o1'],
  ['o3-pro-2025-06-10', 'o3-pro'],
  ['gpt-3.5-turbo-0125', 'gpt-3.5-turbo'],
  ['gpt-3.5-turbo-1106', 'gpt-3.5-turbo'],
  ['gpt-4-turbo-2024-04-09', 'gpt-4-turbo'],
  ['gpt-4-0613', 'gpt-4'],
  ['gpt-4-0314', 'gpt-4']
]);
const UNKNOWN_SNAPSHOT_PRICES = new Set(['gpt-4o-2024-05-13', 'gpt-3.5-turbo-1106']);
const OCTOBER_SHUTDOWN = '2026-10-23T00:00:00.000Z';
const KNOWN_SHUTDOWNS = new Map([
  'gpt-3.5-turbo', 'gpt-3.5-turbo-0125', 'gpt-4', 'gpt-4-0613',
  'gpt-4-turbo', 'gpt-4-turbo-2024-04-09', 'gpt-4.1-nano',
  'gpt-4.1-nano-2025-04-14', 'gpt-4o-2024-05-13', 'o1',
  'o1-2024-12-17', 'o3-mini', 'o3-mini-2025-01-31', 'o4-mini',
  'o4-mini-2025-04-16'
].map(id => [id, OCTOBER_SHUTDOWN]));
KNOWN_SHUTDOWNS.set('gpt-4-0314', '2026-03-26T00:00:00.000Z');
KNOWN_SHUTDOWNS.set('gpt-3.5-turbo-1106', '2026-09-28T00:00:00.000Z');
for (const id of ['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5-2025-08-07', 'gpt-5-mini-2025-08-07', 'gpt-5-nano-2025-08-07', 'gpt-5-pro-2025-10-06', 'o3', 'o3-2025-04-16', 'o3-pro', 'o3-pro-2025-06-10']) KNOWN_SHUTDOWNS.set(id, '2026-12-11T00:00:00.000Z');
for (const id of ['gpt-5.1', 'gpt-5.4-nano']) KNOWN_SHUTDOWNS.set(id, '2027-04-01T00:00:00.000Z');

function withShutdown(item) {
  const shutdownDate = KNOWN_SHUTDOWNS.get(item.id);
  return shutdownDate ? Object.freeze({ ...item, shutdownDate }) : item;
}

export function getOpenAIModelProfile(model) {
  assertAllowedModel(model);
  const exact = byId.get(model);
  if (exact) return withShutdown(exact);
  const base = byId.get(SNAPSHOTS.get(model));
  if (!base) return null;
  return withShutdown(Object.freeze({ ...base, id: model, label: `${base.label} (${model.slice(base.id.length + 1)})`, rates: UNKNOWN_SNAPSHOT_PRICES.has(model) ? null : base.rates, snapshot: true }));
}

function publicProfile(item, selectedModel, shutdownDate) {
  return { id: item.id, label: item.label, api: item.api, rates: item.rates || null, selected: item.id === selectedModel, ...(item.deprecated ? { deprecated: true } : {}), ...(shutdownDate ? { shutdownDate } : {}) };
}

function shutdownTime(value) {
  if (value === undefined || value === null) return null;
  const result = typeof value === 'number' && Number.isFinite(value) ? (value > 100000000000 ? value : value * 1000) : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(result) ? result : 0;
}

export function createOpenAIModelCatalog({ env = process.env, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const key = (env.OPENAI_API_KEY || '').trim();
  const defaultModel = assertAllowedModel((env.OPENAI_MODEL || DEFAULT_MODEL).trim());
  if (!getOpenAIModelProfile(defaultModel)) throw new OpenAIModelError(400, 'Configure a documented OpenAI text model.');
  let cached = null, pending = null, lastAttemptedAt = null, lastAttemptFailed = false;

  async function fetchCatalog() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetchImpl(MODEL_ENDPOINT, { method: 'GET', redirect: 'error', signal: controller.signal, headers: { Authorization: `Bearer ${key}` } });
      if (!response.ok) throw new Error('Unavailable account model list.');
      const length = Number(response.headers?.get?.('content-length'));
      if (Number.isFinite(length) && length > MAX_CATALOG_BYTES) throw new Error('Oversized model list.');
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > MAX_CATALOG_BYTES) throw new Error('Oversized model list.');
      const payload = JSON.parse(text);
      if (!Array.isArray(payload?.data) || payload.data.length > 10000) throw new Error('Invalid model list.');
      const models = new Map();
      for (const candidate of payload.data) {
        let item;
        try { item = getOpenAIModelProfile(candidate?.id); } catch { continue; }
        if (!item) continue;
        const upstreamShutdown = shutdownTime(candidate.shutdown_date);
        const knownShutdown = shutdownTime(item.shutdownDate);
        const shutdown = upstreamShutdown === null ? knownShutdown : knownShutdown === null ? upstreamShutdown : Math.min(upstreamShutdown, knownShutdown);
        if (shutdown !== null && shutdown <= now()) continue;
        models.set(item.id, { profile: item, shutdownDate: shutdown === null ? null : new Date(shutdown).toISOString() });
      }
      cached = { models: [...models.values()], fetchedAt: now() };
      return cached;
    } finally { clearTimeout(timeout); }
  }

  async function list({ selectedModel = defaultModel } = {}) {
    assertAllowedModel(selectedModel);
    const fresh = cached && now() - cached.fetchedAt < CACHE_MS;
    if (key && !fresh && (pending || lastAttemptedAt === null || now() - lastAttemptedAt >= CACHE_MS)) {
      if (!pending) {
        lastAttemptedAt = now();
        pending = fetchCatalog().then(value => { lastAttemptFailed = false; return value; }, error => { lastAttemptFailed = true; throw error; }).finally(() => { pending = null; });
      }
      try { await pending; } catch { /* Provider details and keys never leave the server. */ }
    }
    const unavailable = lastAttemptFailed;
    const source = cached ? 'account' : 'documented';
    const models = (cached ? cached.models : [...byId.keys(), ...SNAPSHOTS.keys()].map(id => { const item = getOpenAIModelProfile(id); return { profile: item, shutdownDate: item.shutdownDate || null }; })).filter(item => !item.shutdownDate || Date.parse(item.shutdownDate) > now());
    return {
      configured: Boolean(key), selectedModel, defaultModel, source,
      stale: Boolean(cached && unavailable), fetchedAt: cached ? new Date(cached.fetchedAt).toISOString() : null,
      ...(source === 'documented' ? { warning: key ? 'The account model list is unavailable. This is a documented model list; account access has not been confirmed.' : 'Add the server OpenAI API key to confirm account model access.' } : unavailable ? { warning: 'The account model list could not be refreshed. Previously confirmed model access is shown.' } : {}),
      models: models.map(({ profile: item, shutdownDate }) => publicProfile(item, selectedModel, shutdownDate))
    };
  }

  async function assertSelectable(model) {
    assertAllowedModel(model);
    const item = getOpenAIModelProfile(model);
    if (!item) throw new OpenAIModelError(400, 'Select a supported OpenAI text model from the model list.');
    const catalog = await list({ selectedModel: model });
    if (catalog.source !== 'account' || catalog.stale) throw new OpenAIModelError(503, 'The OpenAI account model list could not be confirmed. Try again when account access is available.');
    if (!catalog.models.some(candidate => candidate.id === model)) throw new OpenAIModelError(400, 'This model is not available in the confirmed OpenAI account model list.');
    return item;
  }
  return Object.freeze({ list, assertSelectable });
}
