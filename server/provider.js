import { SEARCH_INSTRUCTIONS, searchTool, safeSource, searchOutcome } from './web-search.js';
import { createModelCatalogue } from './models.js';
import { randomUUID } from 'node:crypto';

/** Fetch-only text transports. Bounded hosted search; no retry or provider/model fallback.
 * https://developers.openai.com/api/docs/guides/streaming-responses
 * https://platform.claude.com/docs/en/build-with-claude/streaming
 */
export class ProviderError extends Error {
  constructor(message, code = 'provider_error', status) { super(message); this.name = 'ProviderError'; this.code = code; if (status) this.status = status; }
}
function malformed() { throw new ProviderError('AI returned a malformed stream event.', 'malformed_stream'); }
function appendText(current, delta, onDelta, limit) {
  if (typeof delta !== 'string') malformed();
  if (current.length + delta.length > limit) throw new ProviderError('AI response exceeded the configured size limit.', 'output_limit');
  if (delta) onDelta(delta); return current + delta;
}
function requireText(content) { if (!content.trim()) throw new ProviderError('AI returned no text. You can retry this turn.', 'empty_output'); }
const tokenCount = value => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000 ? value : null;
function normalizeUsage(raw, provider) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  let input_tokens = tokenCount(raw.input_tokens ?? raw.prompt_tokens);
  const output_tokens = tokenCount(raw.output_tokens ?? raw.completion_tokens);
  if (provider === 'anthropic' && input_tokens !== null) {
    const cached = tokenCount(raw.cache_read_input_tokens ?? 0), written = tokenCount(raw.cache_creation_input_tokens ?? 0);
    input_tokens = cached === null || written === null ? null : tokenCount(input_tokens + cached + written);
  }
  if (input_tokens === null && output_tokens === null) return null;
  return { input_tokens, output_tokens, total_tokens: tokenCount(raw.total_tokens) ?? (input_tokens !== null && output_tokens !== null ? tokenCount(input_tokens + output_tokens) : null), provider_details: raw };
}
const observedErrorCodes = new Set(['provider_error','provider_auth','provider_rate_limit','provider_http','provider_network','malformed_stream','output_limit','empty_output','incomplete_response','early_close','timeout','cancelled']);
const observedModel = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value) ? value : null;
function settledMetadata(selected, state, result, error, signal) {
  const errorCode = !error ? null : error.code === 'timeout' ? 'timeout' : signal?.aborted || error.name === 'AbortError' ? 'cancelled' : observedErrorCodes.has(error.code) ? error.code : 'provider_error';
  const raw = result?.usage?.provider_details, input = tokenCount(result?.usage?.input_tokens), output = tokenCount(result?.usage?.output_tokens);
  const countsKnown = input !== null && output !== null;
  const details = raw?.input_tokens_details || raw?.prompt_tokens_details;
  const cachedInputTokens = tokenCount(selected.provider === 'anthropic' ? raw?.cache_read_input_tokens : details?.cached_tokens);
  const cacheWriteInputTokens = tokenCount(selected.provider === 'anthropic' ? raw?.cache_creation_input_tokens : details?.cache_write_tokens);
  const reasoningOutputTokens = tokenCount(selected.provider === 'anthropic' ? raw?.output_tokens_details?.thinking_tokens
    : raw?.output_tokens_details?.reasoning_tokens ?? raw?.completion_tokens_details?.reasoning_tokens);
  // Full base input rates overestimate cache reads; cache writes and uncertain tiers stay unpriced.
  const priceKnown = !state.searchAttempted && !error && countsKnown && selected.priceKnown && state.returnedModel === selected.model && cacheWriteInputTokens === 0
    && (selected.provider === 'anthropic' ? result?.serviceTier === 'standard' && raw?.inference_geo === 'global' : result?.serviceTier === 'default');
  const estimate = priceKnown ? (input * selected.inputPricePerMillion + output * selected.outputPricePerMillion) / 1_000_000 : null;
  return { requestId: state.requestId, provider: selected.provider, requestedModel: selected.model, returnedModel: state.returnedModel,
    endpoint: selected.provider === 'anthropic' ? 'messages' : selected.transport === 'chat-completions' ? 'chat' : 'responses',
    statusCode: state.statusCode ?? (!error ? 200 : errorCode === 'cancelled' ? 499 : errorCode === 'timeout' ? 504 : 502), errorCode,
    latencyMs: Math.min(3600000,Math.max(0,Math.round(performance.now() - state.started))),
    inputTokens: countsKnown ? input : null, outputTokens: countsKnown ? output : null,
    cachedInputTokens, cacheWriteInputTokens, reasoningOutputTokens,
    estimatedCostUsd: Number.isFinite(estimate) && estimate >= 0 ? Math.ceil(estimate * 1_000_000_000) / 1_000_000_000 : null,
    occurredAt: new Date().toISOString(), source: 'app_observed' };
}
function abortable(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve,reject) => {
    const abort = () => reject(signal.reason || new DOMException('Cancelled','AbortError'));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort',abort,{ once: true });
    Promise.resolve(promise).then(resolve,reject).finally(() => signal.removeEventListener('abort',abort));
  });
}
async function* sse(body, signal) {
  if (!body?.getReader) malformed();
  const reader = body.getReader(), decoder = new TextDecoder(); let buffer = '', bytes = 0;
  function data(block) {
    return block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
  }
  try {
    for (;;) {
      signal?.throwIfAborted(); const next = await abortable(reader.read(),signal);
      if (next.done) { buffer += decoder.decode(); if (buffer.trim()) { const value = data(buffer); if (value) yield value; } return; }
      bytes += next.value.byteLength;
      if (bytes > 2097152) throw new ProviderError('AI stream exceeded the configured size limit.', 'output_limit');
      buffer += decoder.decode(next.value,{ stream: true });
      if (buffer.length > 262144 && !/\r?\n\r?\n/.test(buffer)) malformed();
      let boundary;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const value = data(buffer.slice(0,boundary.index)); buffer = buffer.slice(boundary.index + boundary[0].length);
        if (value) yield value;
      }
    }
  } finally { void reader.cancel().catch(() => {}); try { reader.releaseLock(); } catch {} }
}
function eventJson(data) { try { const value = JSON.parse(data); if (!value || typeof value !== 'object') malformed(); return value; } catch { malformed(); } }
function responseText(response) {
  if (typeof response?.output_text === 'string') return response.output_text;
  if (response.output != null && !Array.isArray(response.output)) malformed();
  return (response.output || []).filter(item => item.type === 'message').flatMap(item => item.content || [])
    .map(part => part.type === 'output_text' ? part.text : part.type === 'refusal' ? part.refusal : '').join('');
}
export async function consumeResponseStream(body, { signal, onDelta = () => {}, maxOutputChars = 20000, onReported = () => {}, onSearch = () => {} } = {}) {
  let content = '', searched = false, searchCompleted = false;
  for await (const data of sse(body,signal)) {
    if (data === '[DONE]') continue;
    const event = eventJson(data); if (typeof event.type !== 'string') malformed();
    if (event.type.startsWith('response.web_search_call.')) { searched = true; if (event.type === 'response.web_search_call.completed') searchCompleted = true; onSearch(); }
    if (event.type === 'response.output_text.delta' || event.type === 'response.refusal.delta') content = appendText(content,event.delta,onDelta,maxOutputChars);
    else if (event.type === 'response.completed') {
      onReported({ model: event.response?.model, usage: event.response?.usage, serviceTier: event.response?.service_tier });
      if (event.response?.status !== 'completed') throw new ProviderError('AI response did not complete.', 'incomplete_response');
      const final = responseText(event.response);
      if (final && !content) content = appendText(content,final,onDelta,maxOutputChars);
      else if (final && final !== content) malformed();
      const calls = (event.response.output || []).filter(item => item.type === 'web_search_call');
      if (calls.length) { searched = true; if (calls.some(call => call.status === 'completed')) searchCompleted = true; onSearch(); }
      const sources = []; let offset = 0;
      for (const part of (event.response.output || []).filter(item => item.type === 'message').flatMap(item => item.content || [])) {
        for (const citation of part.annotations || []) if (searchCompleted && citation.type === 'url_citation') {
          const source = safeSource(citation,offset + citation.end_index,offset + citation.start_index);
          if (source && Number.isInteger(source.startIndex) && Number.isInteger(source.endIndex) && source.startIndex >= offset && source.endIndex >= source.startIndex && source.endIndex <= offset + (part.text || '').length && sources.length < 12) sources.push(source);
        }
        offset += (part.text || part.refusal || '').length;
      }
      requireText(content); return { content, ...searchOutcome(searched,(searched && !searchCompleted) || calls.some(call => call.status !== 'completed'),sources), usage: event.response.usage || null, model: event.response.model || null, serviceTier: event.response.service_tier || null };
    } else if (['response.failed','response.incomplete','error'].includes(event.type)) {
      if (event.response) onReported({ model: event.response.model, usage: event.response.usage, serviceTier: event.response.service_tier });
      throw new ProviderError('AI could not complete this response. You can retry this turn.', event.type === 'response.incomplete' ? 'incomplete_response' : 'provider_error');
    }
  }
  throw new ProviderError('AI stream closed before completion. You can retry this turn.', 'early_close');
}
export async function consumeChatCompletionStream(body, { signal, onDelta = () => {}, maxOutputChars = 20000, onReported = () => {} } = {}) {
  let content = '', stop = null, model = null, usage = null, serviceTier = null;
  for await (const data of sse(body,signal)) {
    if (data === '[DONE]') {
      onReported({ model, usage, serviceTier });
      if (stop !== 'stop') throw new ProviderError('AI response did not complete.', 'incomplete_response');
      requireText(content); return { content, model, usage, serviceTier };
    }
    const event = eventJson(data);
    if (event.error) throw new ProviderError('AI could not complete this response. You can retry this turn.', 'provider_error');
    if (!Array.isArray(event.choices)) malformed();
    if (event.model) model = event.model; if (event.usage) usage = event.usage; if (event.service_tier) serviceTier = event.service_tier;
    const choice = event.choices.find(value => value.index === 0) || event.choices[0];
    if (!choice) continue;
    const delta = choice.delta;
    if (!delta || typeof delta !== 'object') malformed();
    if (delta.content != null) content = appendText(content,delta.content,onDelta,maxOutputChars);
    if (delta.refusal != null) content = appendText(content,delta.refusal,onDelta,maxOutputChars);
    if (choice.finish_reason != null) stop = choice.finish_reason;
  }
  throw new ProviderError('AI stream closed before completion. You can retry this turn.', 'early_close');
}
export async function consumeAnthropicStream(body, { signal, onDelta = () => {}, maxOutputChars = 20000, onReported = () => {}, onSearch = () => {} } = {}) {
  let content = '', stop = null, model = null, usage = null, started = false, searched = false, searchFailed = false;
  const retrieved = new Set(), sources = [];
  const cite = citation => { const source = safeSource(citation,content.length); if (searched && citation?.type === 'web_search_result_location' && source && retrieved.has(source.url) && sources.length < 12) sources.push(source); };
  for await (const data of sse(body,signal)) {
    const event = eventJson(data); if (typeof event.type !== 'string') malformed();
    if (event.type === 'message_start') { if (!event.message || started) malformed(); started = true; model = event.message.model || null; usage = event.message.usage || null; }
    else if (event.type === 'content_block_start') {
      if (!started || !event.content_block) malformed(); const block = event.content_block;
      if (block.type === 'server_tool_use' && block.name === 'web_search') { searched = true; onSearch(); }
      if (block.type === 'web_search_tool_result') {
        searched = true; onSearch();
        if (!Array.isArray(block.content)) searchFailed = true;
        else for (const result of block.content) { const source = safeSource(result,0); if (result.type === 'web_search_result' && source) retrieved.add(source.url); }
      }
      if (block.type === 'text') { if (block.text) content = appendText(content,block.text,onDelta,maxOutputChars); for (const citation of block.citations || []) cite(citation); }
    }
    else if (event.type === 'content_block_delta') {
      if (!started || !event.delta || typeof event.delta.type !== 'string') malformed();
      if (event.delta.type === 'text_delta') content = appendText(content,event.delta.text,onDelta,maxOutputChars);
      else if (event.delta.type === 'citations_delta') cite(event.delta.citation);
    } else if (event.type === 'message_delta') { if (!started || !event.delta) malformed(); if (event.delta.stop_reason != null) stop = event.delta.stop_reason; if (event.usage) usage = { ...usage, ...event.usage }; }
    else if (event.type === 'message_stop') {
      if (started) onReported({ model, usage, serviceTier: usage?.service_tier });
      if (!started || !['end_turn','stop_sequence','refusal'].includes(stop)) throw new ProviderError('AI response did not complete.', 'incomplete_response');
      requireText(content); return { content, ...searchOutcome(searched,searchFailed,sources), model, usage, serviceTier: usage?.service_tier || null };
    } else if (event.type === 'error') throw new ProviderError('AI could not complete this response. You can retry this turn.', 'provider_error');
  }
  throw new ProviderError('AI stream closed before completion. You can retry this turn.', 'early_close');
}

async function boundedJson(body,signal) {
  if (!body?.getReader) malformed(); const reader = body.getReader(), chunks = []; let bytes = 0;
  try { for (;;) { const next = await abortable(reader.read(),signal); if (next.done) break; bytes += next.value.byteLength;
    if (bytes > 2097152) throw new ProviderError('AI response exceeded the configured size limit.', 'output_limit'); chunks.push(next.value); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { malformed(); }
  } finally { void reader.cancel().catch(() => {}); try { reader.releaseLock(); } catch {} }
}
function chatMessages(messages,model) {
  if (/^o1-(?:mini|preview)/.test(model)) return [{ role: 'user', content: messages.map(message => `${message.role.toUpperCase()}: ${message.content}`).join('\n\n') }];
  return messages.map(message => ({ role: message.role === 'developer' ? 'system' : message.role, content: message.content }));
}
async function requestText({ apiKey, provider, selection, messages, signal, onDelta, maxOutputChars, fetchImpl, observation, onSearch }) {
  const { model, transport, limits } = selection, maxTokens = limits.maxOutputTokens;
  let url, headers, body;
  if (provider === 'anthropic') {
    url = 'https://api.anthropic.com/v1/messages'; headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
    body = { model, max_tokens: maxTokens, stream: true, service_tier: 'standard_only',
      system: messages.filter(message => ['system','developer'].includes(message.role)).map(message => message.content).join('\n\n'),
      messages: messages.filter(message => ['user','assistant'].includes(message.role)) };
  } else if (transport === 'chat-completions') {
    url = 'https://api.openai.com/v1/chat/completions'; headers = { Authorization: `Bearer ${apiKey}` };
    const legacy = /^gpt-(?:3\.5|4(?:$|-))/.test(model.replace(/^ft:/,''));
    body = { model, service_tier: 'default', messages: chatMessages(messages,model), stream: selection.streaming !== false,
      [legacy ? 'max_tokens' : 'max_completion_tokens']: maxTokens, ...(selection.streaming !== false ? { stream_options: { include_usage: true } } : {}) };
  } else {
    url = 'https://api.openai.com/v1/responses'; headers = { Authorization: `Bearer ${apiKey}` };
    body = { model, service_tier: 'default', input: messages.map(message => message.role === 'assistant' ? { ...message, phase: 'final_answer' } : message), max_output_tokens: maxTokens, stream: true, store: false };
  }
  if (selection.webSearchSupported) { body.tools = [searchTool(provider)]; if (provider === 'openai') { body.max_tool_calls = 2; body.tool_choice = 'auto'; } }
  if (observation) { observation.attempted = true; observation.started = performance.now(); }
  const response = await fetchImpl(url,{ method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', Accept: selection.streaming === false ? 'application/json' : 'text/event-stream' }, body: JSON.stringify(body), signal });
  if (observation && !observation.settled && Number.isInteger(response.status) && response.status >= 100 && response.status <= 599) observation.statusCode = response.status;
  signal.throwIfAborted();
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    if ([401,403].includes(response.status)) throw new ProviderError('AI authentication or model access failed. Check server credentials and model access.', 'provider_auth', response.status);
    if (response.status === 429) throw new ProviderError('AI is temporarily rate limited. Please retry later.', 'provider_rate_limit', response.status);
    throw new ProviderError('AI service could not accept this request. Check model availability or retry later.', 'provider_http', response.status);
  }
  let result;
  const onReported = reported => {
    if (observation && !observation.settled) {
      observation.returnedModel = observedModel(reported.model);
      observation.reportedResult = { usage: reported.usage, serviceTier: reported.serviceTier };
    }
  };
  const options = { signal, onDelta, maxOutputChars, onReported, onSearch: () => { if (signal.aborted) return; if (observation) observation.searchAttempted = true; onSearch?.(); } };
  if (selection.streaming === false) {
    const value = await boundedJson(response.body,signal), choice = value.choices?.[0];
    onReported({ model: value.model, usage: value.usage, serviceTier: value.service_tier });
    if (choice?.finish_reason !== 'stop') throw new ProviderError('AI response did not complete.', 'incomplete_response');
    const content = appendText('',choice.message?.content || choice.message?.refusal || '',onDelta,maxOutputChars); requireText(content);
    result = { content, model: value.model || null, usage: value.usage || null, serviceTier: value.service_tier || null };
  } else result = await (provider === 'anthropic' ? consumeAnthropicStream : transport === 'chat-completions' ? consumeChatCompletionStream : consumeResponseStream)(response.body,options);
  if (observation?.searchAttempted && (!result.sources?.length || result.label?.includes('incomplete'))) {
    result.content = appendText(result.content,'\n\nI could not verify the current guideline from supporting sources. Please check it in typed chat using a search-capable model or consult the official guideline directly.',onDelta,maxOutputChars);
  }
  if (observation && !observation.settled) observation.returnedModel = observedModel(result.model);
  return { ...result, model: result.model || model, provider, usage: normalizeUsage(result.usage,provider) };
}
async function timedGeneration(options, timeoutMs, signal) {
  const controller = new AbortController(), abort = () => controller.abort(signal.reason || new DOMException('Cancelled','AbortError'));
  if (signal?.aborted) abort(); else signal?.addEventListener('abort',abort,{ once: true });
  const timer = setTimeout(() => controller.abort(new ProviderError('AI request timed out. You can retry this turn.', 'timeout')),timeoutMs);
  try {
    controller.signal.throwIfAborted();
    return await abortable(requestText({ ...options, signal: controller.signal, onDelta: delta => { if (!controller.signal.aborted) options.onDelta?.(delta); } }),controller.signal);
  } catch (error) {
    controller.abort(error);
    if (signal?.aborted) throw signal.reason || new DOMException('Cancelled','AbortError');
    if (error instanceof ProviderError) throw error;
    throw new ProviderError('Could not reach the AI service. You can retry this turn.', 'provider_network');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort',abort); }
}

export function createOpenAIProvider({ apiKey = '', model = 'gpt-4.1-mini', maxOutputTokens = 1200,
  timeoutMs = 90000, maxOutputChars = 20000, fetchImpl = globalThis.fetch } = {}) {
  return { available: Boolean(apiKey), model, async generate({ messages, signal, onDelta }) {
    if (!apiKey) throw new ProviderError('AI unavailable: configure the server API key to use Coach.', 'ai_unavailable');
    return timedGeneration({ apiKey, provider: 'openai', selection: { model, transport: 'responses', limits: { maxOutputTokens } }, messages, onDelta, maxOutputChars, fetchImpl },timeoutMs,signal);
  } };
}
export function createModelGateway({ config = {}, fetchImpl = globalThis.fetch, onSettled } = {}) {
  const models = createModelCatalogue({ config, fetchImpl }); let active = false;
  return { ...models, model: config.model || 'gpt-4.1-mini',
    async generate({ messages, selection, signal, onDelta, onSearch }) {
      if (!Array.isArray(messages) || messages.some(message => !message || !['system','developer','user','assistant'].includes(message.role) || typeof message.content !== 'string')) throw new ProviderError('Invalid Coach request.', 'invalid_input', 400);
      const selected = await models.resolveSelection(selection);
      const bounded = messages.map(message => ({ role: message.role, content: message.content })); let historyPairsOmitted = 0;
      if (config.webSearchEnabled === true) bounded.unshift({ role: 'system', content: selected.webSearchSupported ? SEARCH_INSTRUCTIONS : 'Live web search is unavailable for this selected model. Do not claim to have checked current sources. State uncertainty about current guidance. For guideline questions, tell the user you could not verify the guideline and to check it in typed chat using a search-capable model.' });
      // Drop complete oldest history pairs. The tutor rules, host state and newest input stay intact.
      const promptBytes = () => Buffer.byteLength(JSON.stringify(bounded.map(message => message.role === 'assistant' ? { ...message, phase: 'final_answer' } : message)),'utf8');
      while (promptBytes() > selected.limits.maxPromptBytes) {
        const lastUser = bounded.findLastIndex(message => message.role === 'user'), oldestUser = bounded.findIndex(message => message.role === 'user');
        if (oldestUser < 0 || oldestUser === lastUser || bounded[oldestUser + 1]?.role !== 'assistant') throw new ProviderError(`This model limits the complete prompt to ${selected.limits.maxPromptBytes} UTF-8 bytes. Shorten the message or selected source metadata.`, 'context_limit', 413);
        bounded.splice(oldestUser,2); historyPairsOmitted++;
      }
      signal?.throwIfAborted();
      if (active) throw new ProviderError('Another AI request is active. Stop it or wait for completion.', 'chat_busy', 409);
      active = true;
      const observation = { requestId: randomUUID(), attempted: false, started: performance.now(), statusCode: null, returnedModel: null, settled: false };
      let result, failure;
      try {
        result = await timedGeneration({ apiKey: selected.provider === 'openai' ? config.apiKey : config.anthropicApiKey,
          provider: selected.provider, selection: selected, messages: bounded, onDelta, onSearch, maxOutputChars: config.maxOutputChars ?? 20000, fetchImpl, observation },config.chatTimeoutMs ?? 90000,signal);
        return { ...result, ...(config.webSearchEnabled === true && !selected.webSearchSupported ? { label: 'Live search unavailable for this model · guidance unverified.' } : {}), tier: selected.tier, limits: selected.limits, historyPairsOmitted };
      } catch (error) {
        failure = error;
        if (observation.reportedResult) result = { ...observation.reportedResult, usage: normalizeUsage(observation.reportedResult.usage,selected.provider) };
        throw error;
      }
      finally {
        active = false; observation.settled = true;
        if (observation.attempted && typeof onSettled === 'function') {
          try { const pending = onSettled(settledMetadata(selected,observation,result,failure,signal)); if (pending?.catch) pending.catch(() => {}); } catch {}
        }
      }
    } };
}
