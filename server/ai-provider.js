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
  if (providerId === 'openai') return count(usage?.prompt_tokens) && count(usage?.completion_tokens) ? { prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens } : null;
  if (!count(usage?.input_tokens) || !count(usage?.output_tokens)) return null;
  const writes = usage.cache_creation_input_tokens ?? 0, reads = usage.cache_read_input_tokens ?? 0;
  if (!count(writes) || !count(reads)) return null;
  // No caching is requested. Unexpected caches use conservative price equivalents:
  // 1-hour writes cost 2x base input; cache-read discounts are ignored.
  return { prompt_tokens: usage.input_tokens + 2 * writes + reads, completion_tokens: usage.output_tokens };
}

export function createAiProvider({ env = process.env, fetchImpl = globalThis.fetch, commercial = false } = {}) {
  const providerId = (env.AI_PROVIDER || 'openai').trim().toLowerCase();
  if (!['openai', 'anthropic'].includes(providerId)) throw new Error('AI_PROVIDER must be openai or anthropic.');
  const label = providerId === 'anthropic' ? 'Claude' : 'OpenAI';
  const key = providerId === 'anthropic' ? (env.CLAUDE_API_KEY || env.ANTHROPIC_API_KEY || '').trim() : (env.OPENAI_API_KEY || '').trim();
  const model = (providerId === 'anthropic' ? env.CLAUDE_MODEL || CLAUDE_DEFAULT : commercial ? env.COMMERCIAL_OPENAI_MODEL || OPENAI_COMMERCIAL_DEFAULT : env.OPENAI_MODEL || 'gpt-4.1-mini').trim();
  if (!model || model.length > 150 || /[\s\u0000-\u001f\u007f]/u.test(model)) throw new Error('Configure a valid AI model ID.');
  const known = providerId === 'anthropic' ? model === CLAUDE_DEFAULT : model === OPENAI_COMMERCIAL_DEFAULT;
  if (commercial && !known && (!env.AI_INPUT_USD_PER_MILLION || !env.AI_OUTPUT_USD_PER_MILLION)) throw new Error('A custom AI model requires explicit verified input and output prices.');
  const defaults = providerId === 'anthropic' ? [0.10, 0.50] : commercial ? [0.75, 4.50] : [0.40, 1.60];
  const rates = Object.freeze({ inputUsdPerMillion: rate(env.AI_INPUT_USD_PER_MILLION, defaults[0]), outputUsdPerMillion: rate(env.AI_OUTPUT_USD_PER_MILLION, defaults[1]) });
  const configured = Boolean(key);

  async function complete(messages, { jsonMode = false, maxOutputTokens = commercial ? 600 : 1200, signal } = {}) {
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
    } else {
      url = 'https://api.openai.com/v1/chat/completions';
      headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
      body = { model, messages: jsonMode ? [{ role: 'system', content: JSON_INSTRUCTION }, ...cleaned] : cleaned, store: false, max_completion_tokens: maxOutputTokens, ...(jsonMode ? { response_format: { type: 'json_object' } } : {}) };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
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
      let content;
      if (providerId === 'anthropic') {
        if (payload?.stop_reason === 'refusal') fail(422, 'The AI provider declined this request. Rephrase your study question.');
        if (payload?.stop_reason === 'max_tokens') fail(502, 'The AI answer reached its output limit before finishing. Try a shorter question.');
        if (payload?.stop_reason === 'model_context_window_exceeded') fail(400, 'Shorten this study conversation before asking another question.');
        if (payload?.stop_reason && !['end_turn', 'stop_sequence'].includes(payload.stop_reason)) fail(502, 'The AI provider returned an unsupported answer format.');
        content = Array.isArray(payload?.content) ? payload.content.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n\n') : null;
      } else {
        const choice = payload?.choices?.[0];
        if (choice?.message?.refusal || choice?.finish_reason === 'content_filter') fail(422, 'The AI provider declined this request. Rephrase your study question.');
        if (choice?.finish_reason === 'length') fail(502, 'The AI answer reached its output limit before finishing. Try a shorter question.');
        content = choice?.message?.content;
      }
      if (typeof content !== 'string' || !content.trim() || content.length > 20000) fail(502, 'The AI provider returned an empty or unusable answer. Please try again.');
      return { content: content.trim(), usage: normalizeUsage(payload, providerId) };
    } catch (failure) {
      if (failure instanceof AiProviderError) throw failure;
      if (requestSignal.aborted || failure?.name === 'AbortError') fail(504, 'The AI provider took too long or the request was interrupted. Retry your message.');
      fail(502, 'Unable to reach the AI provider. Check the server connection and retry.');
    } finally { clearTimeout(timeout); }
  }
  return Object.freeze({ configured, label, providerId, model, rates, complete });
}
