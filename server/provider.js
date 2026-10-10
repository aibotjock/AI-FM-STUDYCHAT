/** Direct Responses SSE transport. No tools, source gate, retries, or secondary model call.
 * Event contract: https://developers.openai.com/api/docs/guides/streaming-responses
 */
export class ProviderError extends Error {
  constructor(message, code = 'provider_error') { super(message); this.name = 'ProviderError'; this.code = code; }
}

function responseText(response) {
  if (typeof response?.output_text === 'string') return response.output_text;
  if (response.output != null && !Array.isArray(response.output)) throw new ProviderError('AI returned malformed final output.', 'malformed_stream');
  return (response.output || []).filter(item => item.type === 'message')
    .flatMap(item => item.content || []).map(part => part.type === 'output_text' ? part.text : part.type === 'refusal' ? part.refusal : '').join('');
}

export async function consumeResponseStream(body, { signal, onDelta = () => {}, maxOutputChars = 20000 } = {}) {
  if (!body?.getReader) throw new ProviderError('AI returned an unreadable stream.', 'malformed_stream');
  const reader = body.getReader(), decoder = new TextDecoder();
  let buffer = '', content = '', totalBytes = 0, completed = null;
  function event(block) {
    const lines = block.split(/\r?\n/), data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return;
    let value;
    try { value = JSON.parse(data); } catch { throw new ProviderError('AI returned a malformed stream event.', 'malformed_stream'); }
    if (!value || typeof value.type !== 'string') throw new ProviderError('AI returned a malformed stream event.', 'malformed_stream');
    if (value.type === 'response.output_text.delta' || value.type === 'response.refusal.delta') {
      if (typeof value.delta !== 'string') throw new ProviderError('AI returned a malformed text event.', 'malformed_stream');
      if (content.length + value.delta.length > maxOutputChars) throw new ProviderError('AI response exceeded the configured size limit.', 'output_limit');
      content += value.delta; onDelta(value.delta);
    } else if (value.type === 'response.completed') {
      if (!value.response || value.response.status !== 'completed') throw new ProviderError('AI response did not complete.', 'incomplete_response');
      const finalText = responseText(value.response);
      if (finalText.length > maxOutputChars) throw new ProviderError('AI response exceeded the configured size limit.', 'output_limit');
      if (finalText && !content) { content = finalText; onDelta(finalText); }
      else if (finalText && finalText !== content) throw new ProviderError('AI final text did not match its stream.', 'malformed_stream');
      if (!content.trim()) throw new ProviderError('AI returned no text. You can retry this turn.', 'empty_output');
      completed = { content, usage: value.response.usage || null, model: value.response.model || null };
    } else if (value.type === 'response.failed' || value.type === 'response.incomplete' || value.type === 'error') {
      throw new ProviderError('AI could not complete this response. You can retry this turn.', value.type === 'response.incomplete' ? 'incomplete_response' : 'provider_error');
    }
  }
  try {
    while (!completed) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        if (buffer.trim()) event(buffer);
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > 2097152) throw new ProviderError('AI stream exceeded the configured size limit.', 'output_limit');
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 262144 && !/\r?\n\r?\n/.test(buffer)) throw new ProviderError('AI returned an oversized stream event.', 'malformed_stream');
      let boundary;
      while ((boundary = /\r?\n\r?\n/.exec(buffer)) && !completed) {
        const block = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length); event(block);
      }
    }
    if (!completed) throw new ProviderError('AI stream closed before completion. You can retry this turn.', 'early_close');
    return completed;
  } finally {
    await reader.cancel().catch(() => {}); reader.releaseLock();
  }
}

export function createOpenAIProvider({ apiKey = '', model = 'gpt-4.1-mini', maxOutputTokens = 1200,
  timeoutMs = 90000, maxOutputChars = 20000, fetchImpl = globalThis.fetch } = {}) {
  if (/astra/i.test(model)) throw new TypeError('Astra models are not permitted in this app.');
  return {
    available: Boolean(apiKey), model,
    async generate({ messages, signal, onDelta }) {
      if (!apiKey) throw new ProviderError('AI unavailable: configure the server API key to use Coach.', 'ai_unavailable');
      const timed = AbortSignal.timeout(timeoutMs), combined = signal ? AbortSignal.any([signal, timed]) : timed;
      try {
        const response = await fetchImpl('https://api.openai.com/v1/responses', {
          method: 'POST', signal: combined,
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
          body: JSON.stringify({ model, input: messages, max_output_tokens: maxOutputTokens, stream: true, store: false }),
        });
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          if (response.status === 401 || response.status === 403) throw new ProviderError('AI authentication failed. Check server credentials.', 'provider_auth');
          if (response.status === 429) throw new ProviderError('AI is temporarily rate limited. Please retry later.', 'provider_rate_limit');
          throw new ProviderError('AI service is unavailable. Please retry later.', 'provider_http');
        }
        const result = await consumeResponseStream(response.body, { signal: combined, onDelta, maxOutputChars });
        return { ...result, model: result.model || model };
      } catch (error) {
        if (signal?.aborted) throw signal.reason || new DOMException('Cancelled', 'AbortError');
        if (timed.aborted) throw new ProviderError('AI request timed out. You can retry this turn.', 'timeout');
        if (error instanceof ProviderError) throw error;
        throw new ProviderError('Could not reach the AI service. You can retry this turn.', 'provider_network');
      }
    },
  };
}
