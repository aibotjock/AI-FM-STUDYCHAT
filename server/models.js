/** Public model metadata only. Keys stay in the gateway; live lists do not provide prices.
 * Checked 2026-10-10 against official model/pricing documentation.
 */
const PRICING_CHECKED_AT = '2026-10-10';
const PRICES = {
  openai: {
    'gpt-6-astra': [10,50], 'gpt-6.1-sol': [2,10], 'gpt-6-sol': [2,10], 'gpt-6-luna': [.1,.5],
    'gpt-5.6-sol': [4,20], 'gpt-5.6': [4,20], 'gpt-5.6-terra': [2,12], 'gpt-5.6-luna': [.2,1.2], 'gpt-5.6-cyber': [12.5,75],
    'gpt-5.5-pro': [30,180], 'gpt-5.5': [5,30], 'chat-latest': [5,30], 'gpt-5.4-pro': [30,180], 'gpt-5.4-mini': [.75,4.5], 'gpt-5.4': [2.5,15],
    'gpt-5.2-pro': [21,168], 'gpt-5.2': [1.75,14], 'gpt-5-pro': [15,120], 'gpt-5-mini': [.25,2], 'gpt-5-nano': [.05,.4], 'gpt-5': [1.25,10],
    'o1-pro': [150,600], 'o1': [15,60], 'o1-mini': [1.1,4.4], 'o3-pro': [20,80], 'o3': [2,8], 'o3-mini': [1.1,4.4], 'o4-mini': [1.1,4.4],
    'gpt-5.1': [1.25,10], 'gpt-5.3-codex': [1.75,14], 'gpt-4.1-mini': [.4,1.6], 'gpt-4.1-nano': [.1,.4], 'gpt-4.1': [2,8],
    'gpt-4o-mini': [.15,.6], 'gpt-4o': [2.5,10], 'gpt-4-turbo': [10,30], 'gpt-4': [30,60], 'gpt-3.5-turbo': [.5,1.5],
    'gpt-4.1-mini-2025-04-14': [.4,1.6], 'gpt-4.1-2025-04-14': [2,8], 'gpt-4o-mini-2024-07-18': [.15,.6],
  },
  anthropic: {
    'claude-fable-5-1': [10,50], 'claude-mythos-5-1': [10,50], 'claude-fable-5': [10,50], 'claude-mythos-5': [10,50],
    'claude-opus-5-5': [4,20], 'claude-opus-5': [5,25], 'claude-opus-4-8': [5,25], 'claude-opus-4-7': [5,25], 'claude-opus-4-6': [5,25], 'claude-opus-4-5': [5,25],
    'claude-sonnet-5-5': [2,10], 'claude-sonnet-5': [2,10], 'claude-sonnet-4-6': [3,15], 'claude-sonnet-4-5': [3,15],
    'claude-haiku-5-5': [.1,.5], 'claude-haiku-4-5': [1,5],
    'claude-opus-4-5-20251101': [5,25], 'claude-sonnet-4-5-20250929': [3,15], 'claude-haiku-4-5-20251001': [1,5],
  },
};
/** Actual configured catalogue tariff data only; callers receive an isolated copy. */
export function modelPricingSnapshot() {
  return { checkedAt: PRICING_CHECKED_AT, inputOutputUsdPerMillion: structuredClone(PRICES) };
}
const FALLBACKS = {
  openai: [...Object.keys(PRICES.openai).filter(id => id !== 'gpt-5.6-cyber'), 'gpt-4o', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo', 'o4-mini', 'o3-mini', 'o1', 'o1-mini'],
  anthropic: [...Object.keys(PRICES.anthropic)],
};
const PROVIDERS = [{ id: 'openai', label: 'OpenAI' }, { id: 'anthropic', label: 'Anthropic' }];
const validModelId = id => typeof id === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(id);
const unsupported = /(?:audio|transcrib|tts|realtime|embedding|moderation|image|dall-e|sora|whisper|deep-research|search-preview|search-api|computer-use|instruct|babbage|davinci|gpt-oss|rosalind|gpt-live)/i;
export class ModelSelectionError extends Error {
  constructor(message, code = 'invalid_model', status = 400) { super(message); this.name = 'ModelSelectionError'; this.code = code; this.status = status; }
}

function baseModel(id) { return id.startsWith('ft:') ? id.split(':')[1] : id; }
function supported(provider, row) {
  if (!validModelId(row.id) || unsupported.test(row.id) || row.id === 'chatgpt-4o-latest') return false;
  if (row.lifecycle === 'retired' || (row.shutdown_date && Date.parse(row.shutdown_date) <= Date.now())) return false;
  if (provider === 'anthropic') return /^claude-[A-Za-z0-9_.-]+$/.test(row.id);
  const base = baseModel(row.id);
  return /^(?:gpt-(?:[3-9](?:\.\d+)?|4o)(?:[-.]|$)|o[134](?:[-.]|$)|chatgpt-(?:4o|5(?:\.\d+)?)(?:[-.]|$)|chat-latest$|codex-mini(?:[-.]|$))/.test(base);
}
function price(provider, id) {
  if (id.startsWith('ft:')) return null; // fine-tuning prices differ from their base model
  return PRICES[provider][id] || null; // unreviewed variants/snapshots remain price-unknown
}
function descriptor(provider, row, config, availability) {
  const rates = price(provider, row.id), tier = !rates || rates[0] >= 3 || rates[1] >= 15 ? 'limited' : 'standard';
  const base = baseModel(row.id);
  const legacy = /^(?:gpt-3\.5|gpt-4(?:$|-)|o1-(?:mini|preview))/.test(base) || row.id.startsWith('ft:') || base.startsWith('chatgpt-') || base === 'chat-latest';
  const maxOutputTokens = Math.min(tier === 'limited' ? config.limitedOutputTokens ?? 768 : config.maxOutputTokens ?? 1200, row.max_tokens > 0 ? row.max_tokens : Infinity);
  return { id: row.id, provider, label: row.display_name || row.id, tier, available: availability !== 'unconfigured', availability,
    transport: provider === 'anthropic' ? 'messages' : legacy ? 'chat-completions' : 'responses',
    streaming: !/^gpt-3\.5/.test(base),
    limits: { maxPromptBytes: tier === 'limited' ? config.limitedPromptBytes ?? 8000 : config.standardPromptBytes ?? 24000, maxOutputTokens },
    priceKnown: Boolean(rates), ...(rates ? { inputPricePerMillion: rates[0], outputPricePerMillion: rates[1], pricingCheckedAt: PRICING_CHECKED_AT } : {}),
    ...(row.lifecycle ? { lifecycle: row.lifecycle } : {}) };
}

async function readJson(response, signal) {
  if (!response.ok || !response.body?.getReader) { void response.body?.cancel().catch(() => {}); throw new Error('Model list unavailable.'); }
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) { signal.throwIfAborted(); const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > 1048576) throw new Error('Model list too large.'); chunks.push(value); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { void reader.cancel().catch(() => {}); try { reader.releaseLock(); } catch {} }
}

export function createModelCatalogue({ config = {}, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  let cached = null, refreshed = 0, refreshing = null;
  const keys = { openai: config.apiKey || '', anthropic: config.anthropicApiKey || '' };
  async function live(provider) {
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Model list timed out.')); }, config.modelCatalogueTimeoutMs ?? 10000); });
    const work = (async () => {
      const records = [], cursors = new Set(); let cursor = null;
      for (let page = 0; page < 5; page++) {
        const origin = provider === 'openai' ? 'https://api.openai.com/v1/models' : 'https://api.anthropic.com/v1/models';
        const url = new URL(origin);
        if (provider === 'anthropic') { url.searchParams.set('limit','100'); if (cursor) url.searchParams.set('after_id',cursor); }
        const headers = provider === 'openai' ? { Authorization: `Bearer ${keys[provider]}` } : { 'x-api-key': keys[provider], 'anthropic-version': '2023-06-01' };
        const response = await fetchImpl(url.href, { headers, signal: controller.signal });
        controller.signal.throwIfAborted();
        const value = await readJson(response, controller.signal);
        if (!Array.isArray(value.data) || value.data.length > 4096 || value.data.some(row => !row || typeof row.id !== 'string')) throw new Error('Malformed model list.');
        records.push(...value.data);
        if (provider === 'openai' || !value.has_more) return records;
        cursor = value.last_id;
        if (!validModelId(cursor) || cursors.has(cursor)) throw new Error('Invalid model pagination.');
        cursors.add(cursor);
      }
      throw new Error('Model catalogue pagination limit reached.');
    })();
    try { return await Promise.race([work,deadline]); } finally { clearTimeout(timer); controller.abort(); }
  }
  async function refresh() {
    const providers = [], models = [];
    const results = await Promise.allSettled(PROVIDERS.map(async provider => keys[provider.id] ? live(provider.id) : null));
    results.forEach((result,index) => {
      const provider = PROVIDERS[index], configured = Boolean(keys[provider.id]);
      providers.push({ ...provider, configured, ...(result.status === 'rejected' ? { error: 'Model list refresh failed; documented options shown with account access unconfirmed.' } : {}) });
      const rows = result.status === 'fulfilled' && result.value !== null ? result.value : FALLBACKS[provider.id].map(id => ({ id }));
      const availability = !configured ? 'unconfigured' : result.status === 'rejected' ? 'unconfirmed' : 'listed';
      const seen = new Set();
      for (const row of rows) if (supported(provider.id,row) && !seen.has(row.id)) { seen.add(row.id); models.push(descriptor(provider.id,row,config,availability)); }
    });
    cached = { providers, models, defaultSelection: { provider: 'openai', model: config.model || 'gpt-4.1-mini' }, updatedAt: new Date(now()).toISOString() };
    refreshed = now(); return cached;
  }
  async function catalogue() {
    if (!cached || now() - refreshed >= (config.modelCatalogueCacheMs ?? 600000)) {
      refreshing ||= refresh().finally(() => { refreshing = null; }); await refreshing;
    }
    return structuredClone(cached);
  }
  async function resolveSelection(selection = {}) {
    const provider = selection?.provider || 'openai';
    if (!PROVIDERS.some(item => item.id === provider)) throw new ModelSelectionError('Choose OpenAI or Anthropic.');
    const model = selection?.model || (provider === 'openai' ? config.model || 'gpt-4.1-mini' : config.anthropicModel || 'claude-haiku-5-5');
    if (!validModelId(model)) throw new ModelSelectionError('Model ID is invalid.');
    const known = (await catalogue()).models.find(item => item.provider === provider && item.id === model);
    if (!known) throw new ModelSelectionError('This text model is not in the available catalogue. Choose another model.', 'model_unavailable', 409);
    if (!keys[provider]) throw new ModelSelectionError(`${provider === 'openai' ? 'OpenAI' : 'Anthropic'} AI unavailable: configure its server API key.`, 'ai_unavailable', 503);
    return { ...known, model: known.id };
  }
  return { catalogue, resolveSelection, available: Boolean(keys.openai || keys.anthropic) };
}
