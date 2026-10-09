import { assertAllowedModel, getOpenAIModelProfile } from './openai-models.js';
// Direct server-side requests only: no SDK retries, fallback, or thinking storage.
export class AiProviderError extends Error {
  constructor(status, message) { super(message); this.name = 'AiProviderError'; this.status = status; }
}
const fail = (status, message) => { throw new AiProviderError(status, message); };
const JSON_INSTRUCTION = 'Return exactly one valid JSON object. Do not use Markdown fences or add text outside that JSON object.';
const CLAUDE_DEFAULT = 'claude-haiku-5-5';
const OPENAI_COMMERCIAL_DEFAULT = 'gpt-5.4-mini-2026-03-17';

function rate(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0 || result > 1000) throw new Error('AI token prices must be finite nonnegative dollars per million tokens.');
  return result;
}
function normalizeUsage(payload, providerId) {
  const usage = payload?.usage;
  const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 10000000;
  if (providerId === 'openai') {
    const input = usage?.prompt_tokens ?? usage?.input_tokens;
    const output = usage?.completion_tokens ?? usage?.output_tokens;
    return count(input) && count(output) ? { prompt_tokens: input, completion_tokens: output } : null;
  }
  if (!count(usage?.input_tokens) || !count(usage?.output_tokens)) return null;
  const writes = usage.cache_creation_input_tokens ?? 0, reads = usage.cache_read_input_tokens ?? 0;
  if (!count(writes) || !count(reads)) return null;
  // No caching is requested. Unexpected caches use conservative price equivalents:
  // 1-hour writes cost 2x base input; cache-read discounts are ignored.
  return { prompt_tokens: usage.input_tokens + 2 * writes + reads, completion_tokens: usage.output_tokens };
}

export function createAiProvider({ env = process.env, fetchImpl = globalThis.fetch, commercial = false, onCompletion } = {}) {
  const providerId = (env.AI_PROVIDER || 'openai').trim().toLowerCase();
  if (!['openai', 'anthropic'].includes(providerId)) throw new Error('AI_PROVIDER must be openai or anthropic.');
  const label = providerId === 'anthropic' ? 'Claude' : 'OpenAI';
  const key = providerId === 'anthropic' ? (env.CLAUDE_API_KEY || env.ANTHROPIC_API_KEY || '').trim() : (env.OPENAI_API_KEY || '').trim();
  const model = (providerId === 'anthropic' ? env.CLAUDE_MODEL || CLAUDE_DEFAULT : commercial ? env.COMMERCIAL_OPENAI_MODEL || OPENAI_COMMERCIAL_DEFAULT : env.OPENAI_MODEL || 'gpt-4.1-mini').trim();
  assertAllowedModel(model);
  if (!model || model.length > 150 || /[\s\u0000-\u001f\u007f]/u.test(model)) throw new Error('Configure a valid AI model ID.');
  const profile = providerId === 'openai' ? getOpenAIModelProfile(model) : null;
  if (providerId === 'openai' && !profile) throw new Error('Configure a documented OpenAI text model. Unknown aliases are disabled.');
  const unavailableReason = profile?.shutdownDate && Date.parse(profile.shutdownDate) <= Date.now() ? 'This OpenAI model has reached its announced shutdown date. Choose another model in Study preferences.' : null;
  if (commercial && unavailableReason) throw new Error(unavailableReason);
  const known = providerId === 'anthropic' ? model === CLAUDE_DEFAULT : Boolean(profile?.rates);
  if (commercial && !known && (!env.AI_INPUT_USD_PER_MILLION || !env.AI_OUTPUT_USD_PER_MILLION)) throw new Error('A custom AI model requires explicit verified input and output prices.');
  const defaults = providerId === 'anthropic' ? [0.10, 0.50] : [profile.rates?.inputUsdPerMillion ?? null, profile.rates?.outputUsdPerMillion ?? null];
  const rates = Object.freeze({ inputUsdPerMillion: rate(env.AI_INPUT_USD_PER_MILLION, defaults[0]), outputUsdPerMillion: rate(env.AI_OUTPUT_USD_PER_MILLION, defaults[1]) });
  const configured = Boolean(key) && !unavailableReason;

  async function complete(messages, { jsonMode = false, maxOutputTokens = commercial ? 600 : profile?.defaultMaxOutputTokens || 1200, signal, includeMetadata = false } = {}) {
    assertAllowedModel(model);
    if (profile?.shutdownDate && Date.parse(profile.shutdownDate) <= Date.now()) fail(503, 'This OpenAI model has reached its announced shutdown date. Choose another model in Study preferences.');
    if (!configured) fail(503, 'The selected AI provider is not configured on the server.');
    if (!Array.isArray(messages) || !messages.length || messages.length > 100 || messages.some(message => !message || !['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || !message.content.trim() || message.content.length > 120000)) fail(400, 'Use a bounded text study conversation.');
    if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 4096) fail(400, 'Use a supported AI output limit.');
    const cleaned = messages.map(({ role, content }) => ({ role, content }));
    if (providerId === 'anthropic' && model === CLAUDE_DEFAULT && Buffer.byteLength(JSON.stringify(cleaned), 'utf8') + 512 > 100000) fail(400, 'Shorten this study conversation before asking another question.');
    let url, body, headers;
    if (providerId === 'anthropic') {
      const systems = cleaned.filter(message => message.role === 'system').map(message => message.content);
      const turns = cleaned.filter(message => message.role !== 'system');
      // Windowed histories may begin with an answer whose user turn was removed.
      while (turns[0]?.role === 'assistant') turns.shift();
      if (!turns.length || turns.at(-1).role !== 'user') fail(400, 'Claude study requests must end with a user message.');
      if (jsonMode) systems.push(JSON_INSTRUCTION);
      url = 'https://api.anthropic.com/v1/messages';
      headers = { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' };
      body = { model, max_tokens: maxOutputTokens, messages: turns, ...(systems.length ? { system: systems.join('\n\n') } : {}), ...(model === CLAUDE_DEFAULT ? { thinking: { type: 'adaptive' }, output_config: { effort: 'low' } } : {}) };
    } else if (profile.api === 'responses') {
      url = 'https://api.openai.com/v1/responses';
      headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
      const systems = cleaned.filter(message => message.role === 'system').map(message => message.content);
      if (jsonMode) systems.push(JSON_INSTRUCTION);
      body = { model, input: cleaned.filter(message => message.role !== 'system'), ...(systems.length ? { instructions: systems.join('\n\n') } : {}), store: false, max_output_tokens: maxOutputTokens, ...(jsonMode && profile.jsonMode ? { text: { format: { type: 'json_object' } } } : {}), ...(profile.reasoningEffort ? { reasoning: { effort: profile.reasoningEffort } } : {}) };
    } else {
      url = 'https://api.openai.com/v1/chat/completions';
      headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
      const limitField = profile.tokenParameter;
      body = { model, messages: jsonMode ? [{ role: 'system', content: JSON_INSTRUCTION }, ...cleaned] : cleaned, store: false, [limitField]: maxOutputTokens, ...(jsonMode && profile.jsonMode ? { response_format: { type: 'json_object' } } : {}), ...(profile.reasoningEffort ? { reasoning_effort: profile.reasoningEffort } : {}) };
    }
    if (profile?.contextWindowTokens && Buffer.byteLength(JSON.stringify(body), 'utf8') + maxOutputTokens > profile.contextWindowTokens) fail(400, 'This model has a smaller context window. Start a shorter conversation.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), profile?.timeoutMs || 45000);
    const startedAt = Date.now();
    const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    try {
      if (requestSignal.aborted) fail(504, 'The AI request was interrupted before completion.');
      const response = await fetchImpl(url, { method: 'POST', redirect: 'error', signal: requestSignal, headers, body: JSON.stringify(body) });
      if (!response.ok) {
        if ([401, 403].includes(response.status)) fail(502, 'The AI provider rejected the server API key. Check the server configuration.');
        if ([429, 529].includes(response.status)) fail(503, 'The AI provider is busy or its usage limit has been reached. Please try again later.');
        fail(502, 'The AI provider could not complete this request. Please try again.');
      }
      const payload = await response.json();
      if (payload?.model !== undefined) {
        try { assertAllowedModel(payload.model); } catch { fail(502, 'The provider returned a prohibited or invalid model. Its answer was blocked.'); }
        if (providerId === 'openai') {
          const returned = getOpenAIModelProfile(payload.model);
          const sameSnapshot = !profile.snapshot && returned?.snapshot && returned.canonicalId === model;
          if (!returned || (payload.model !== model && !sameSnapshot)) fail(502, 'The provider returned a different model. Its answer was blocked.');
        }
      }
      let content;
      if (providerId === 'anthropic') {
        if (payload?.stop_reason === 'refusal') fail(422, 'The AI provider declined this request. Rephrase your study question.');
        if (payload?.stop_reason === 'max_tokens') fail(502, 'The AI answer reached its output limit before finishing. Try a shorter question.');
        if (payload?.stop_reason === 'model_context_window_exceeded') fail(400, 'Shorten this study conversation before asking another question.');
        if (payload?.stop_reason && !['end_turn', 'stop_sequence'].includes(payload.stop_reason)) fail(502, 'The AI provider returned an unsupported answer format.');
        content = Array.isArray(payload?.content) ? payload.content.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n\n') : null;
      } else if (profile.api === 'responses') {
        if (payload?.status !== 'completed' || payload?.error || payload?.incomplete_details) fail(502, 'The AI answer did not finish within its output limit. It was not retried or sent to another model.');
        const blocks = Array.isArray(payload.output) ? payload.output.filter(item => item?.type === 'message' && item.role === 'assistant').flatMap(item => Array.isArray(item.content) ? item.content : []) : [];
        if (blocks.some(block => block?.type === 'refusal')) fail(422, 'The AI provider declined this request. Rephrase your study question.');
        content = blocks.filter(block => block?.type === 'output_text' && typeof block.text === 'string').map(block => block.text).join('\n\n');
      } else {
        const choice = payload?.choices?.[0];
        if (choice?.message?.refusal || choice?.finish_reason === 'content_filter') fail(422, 'The AI provider declined this request. Rephrase your study question.');
        if (choice?.finish_reason === 'length') fail(502, 'The AI answer reached its output limit before finishing. Try a shorter question.');
        content = choice?.message?.content;
      }
      if (typeof content !== 'string' || !content.trim() || content.length > 20000) fail(502, 'The AI provider returned an empty or unusable answer. Please try again.');
      const usage = normalizeUsage(payload, providerId);
      const billedRates = providerId === 'openai' && payload.model && payload.model !== model ? getOpenAIModelProfile(payload.model)?.rates : rates;
      const estimatedCostUsd = usage && billedRates && billedRates.inputUsdPerMillion !== null && billedRates.outputUsdPerMillion !== null ? (usage.prompt_tokens * billedRates.inputUsdPerMillion + usage.completion_tokens * billedRates.outputUsdPerMillion) / 1e6 : null;
      const metadata = { provider: providerId, requestedModel: model, returnedModel: payload.model || null, endpoint: profile?.api || 'messages', usage, estimatedCostUsd, latencyMs: Math.max(0, Date.now() - startedAt), pricingBasis: estimatedCostUsd === null ? 'unknown' : 'Configured standard rates; cache discounts excluded', recordedAt: Date.now() };
      if (typeof onCompletion === 'function') {
        try { await onCompletion(metadata); } catch { /* Telemetry cannot discard an answer or repeat paid inference. */ }
      }
      return { content: content.trim(), usage, ...(includeMetadata ? { metadata } : {}) };
    } catch (failure) {
      if (failure instanceof AiProviderError) throw failure;
      if (requestSignal.aborted || failure?.name === 'AbortError') fail(504, 'The AI provider took too long or the request was interrupted. Retry your message.');
      fail(502, 'Unable to reach the AI provider. Check the server connection and retry.');
    } finally { clearTimeout(timeout); }
  }
  return Object.freeze({ configured, label, providerId, model, rates, unavailableReason, complete });
}
