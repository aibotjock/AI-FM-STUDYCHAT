import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelGateway, consumeAnthropicStream, consumeChatCompletionStream } from '../server/provider.js';
import { createModelCatalogue } from '../server/models.js';

const CONFIG = { apiKey: 'openai-server-secret', anthropicApiKey: 'anthropic-server-secret', model: 'gpt-4.1-mini',
  anthropicModel: 'claude-haiku-5-5', maxOutputTokens: 1200, limitedOutputTokens: 768, standardPromptBytes: 24000,
  limitedPromptBytes: 8000, modelCatalogueTimeoutMs: 30, modelCatalogueCacheMs: 600000, chatTimeoutMs: 100, maxOutputChars: 20000 };
const messages = [{ role: 'system', content: 'Tutor rules.' }, { role: 'developer', content: 'Host study state.' }, { role: 'user', content: 'Hello' }];
function stream(events, chunkSize = 11) {
  const bytes = new TextEncoder().encode(events.map(event => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\r\n\r\n`).join(''));
  return new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i,i+chunkSize)); controller.close(); } });
}
function anthropic(text = 'Hello', stop = 'end_turn') { return [
  { type: 'message_start', message: { model: 'claude-haiku-5-5', usage: { input_tokens: 8, output_tokens: 0 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
  { type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 3 } }, { type: 'message_stop' },
]; }
function openai(text = 'Hello', model = 'gpt-4.1-mini') { return [
  { type: 'response.output_text.delta', delta: text },
  { type: 'response.completed', response: { status: 'completed', model, output: [{ type: 'message', content: [{ type: 'output_text', text }] }], usage: { input_tokens: 10, output_tokens: 3 } } },
]; }
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const tick = () => new Promise(resolve => setImmediate(resolve));

test('live catalogue filters nontext/retired models, pages Claude, caches listings, and keeps unknown prices limited', async () => {
  const calls = [];
  const modelCatalogue = createModelCatalogue({ config: CONFIG, fetchImpl: async (url,options) => {
    calls.push(url);
    if (url.startsWith('https://api.openai.com')) {
      assert.equal(options.headers.Authorization, `Bearer ${CONFIG.apiKey}`);
      return json({ data: ['gpt-4.1-mini','gpt-6-astra','gpt-6-future','gpt-5.6-cyber','gpt-image-2','gpt-4o-mini-tts','text-embedding-3-small','o3-deep-research','chatgpt-4o-latest','chat-latest','gpt-5.3-codex','ft:gpt-4.1-mini:owner:tuned','gpt-4-shutdown'].map(id => ({ id, ...(id === 'gpt-4-shutdown' ? { shutdown_date: '2000-01-01' } : {}) })) });
    }
    assert.equal(options.headers['x-api-key'], CONFIG.anthropicApiKey);
    if (!url.includes('after_id')) return json({ data: [{ id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5', lifecycle: 'active', max_tokens: 64000 }, { id: 'claude-retired', lifecycle: 'retired' }], has_more: true, last_id: 'claude-retired' });
    return json({ data: [{ id: 'claude-sonnet-4-5-20250929', lifecycle: 'deprecated' }, { id: 'claude-future', lifecycle: 'active' }], has_more: false });
  } });
  const catalogue = await modelCatalogue.catalogue(); await modelCatalogue.catalogue();
  assert.equal(calls.length, 3); assert.ok(calls[2].includes('after_id=claude-retired'));
  assert.deepEqual(catalogue.models.map(item => item.id), ['gpt-4.1-mini','gpt-6-astra','gpt-6-future','gpt-5.6-cyber','chat-latest','gpt-5.3-codex','ft:gpt-4.1-mini:owner:tuned','claude-haiku-5-5','claude-sonnet-4-5-20250929','claude-future']);
  assert.equal(catalogue.models.find(item => item.id === 'gpt-5.6-cyber').tier, 'limited');
  assert.equal(catalogue.models.find(item => item.id === 'gpt-5.6-cyber').outputPricePerMillion, 75);
  assert.equal(catalogue.models.find(item => item.id === 'gpt-6-future').tier, 'limited');
  assert.equal(catalogue.models.find(item => item.id === 'gpt-5.3-codex').outputPricePerMillion, 14);
  assert.equal(catalogue.models.find(item => item.id === 'claude-sonnet-4-5-20250929').priceKnown, true);
  assert.equal(catalogue.models.find(item => item.id.startsWith('ft:')).priceKnown, false);
  assert.doesNotMatch(JSON.stringify(catalogue), /server-secret/);
  await assert.rejects(modelCatalogue.resolveSelection({ provider: 'unknown', model: 'anything' }), error => error.code === 'invalid_model');
  await assert.rejects(modelCatalogue.resolveSelection({ provider: 'openai', model: 'gpt-image-2' }), error => error.code === 'model_unavailable');
});

test('documented fallback catalogue admits uncertainty and no-key mode makes zero network calls', async () => {
  let calls = 0;
  const noKey = createModelGateway({ config: { model: 'gpt-4.1-mini' }, fetchImpl: async () => { calls++; throw new Error('unexpected'); } });
  const catalogue = await noKey.catalogue(); assert.equal(noKey.available, false); assert.equal(calls, 0);
  assert.ok(catalogue.models.every(item => !item.available));
  assert.ok(!catalogue.models.some(item => item.id === 'gpt-5.6-cyber'));
  await assert.rejects(noKey.generate({ messages }), error => error.code === 'ai_unavailable');
  const failed = createModelCatalogue({ config: { ...CONFIG, anthropicApiKey: '' }, fetchImpl: async () => { calls++; throw new Error('secret upstream error'); } });
  const fallback = await failed.catalogue();
  assert.ok(!fallback.models.some(item => item.id === 'gpt-5.6-cyber'));
  assert.match(fallback.providers[0].error, /unconfirmed/); assert.doesNotMatch(JSON.stringify(fallback), /secret upstream/);
  assert.equal((await failed.resolveSelection({ provider: 'openai', model: 'gpt-6-astra' })).availability, 'unconfirmed');
});

test('Anthropic SSE exposes only text, merges cumulative usage, and requires a complete message_stop', async () => {
  const events = anthropic('Héllo'), visible = [];
  events.splice(2,0,{ type: 'content_block_delta', index: 1, delta: { type: 'thinking_delta', thinking: 'private reasoning' } },{ type: 'ping' },{ type: 'future_event' });
  const result = await consumeAnthropicStream(stream(events,1),{ onDelta: delta => visible.push(delta) });
  assert.equal(result.content, 'Héllo'); assert.deepEqual(visible,['Héllo']); assert.deepEqual(result.usage,{ input_tokens: 8, output_tokens: 3 });
  for (const [bad,code] of [[anthropic('Partial','max_tokens'),'incomplete_response'],[anthropic().slice(0,-1),'early_close'],[anthropic(''),'empty_output'],[{bad:'event'},'malformed_stream']]) {
    await assert.rejects(consumeAnthropicStream(stream(Array.isArray(bad) ? bad : [bad])),error => error.code === code);
  }
  await assert.rejects(consumeAnthropicStream(stream([{ type: 'error', error: { message: 'secret' } }])),error => error.code === 'provider_error' && !error.message.includes('secret'));
});

test('Chat Completions SSE requires stop plus DONE, retains final usage, and rejects truncation', async () => {
  const valid = [{ model: 'gpt-4', choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }] },{ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },{ choices: [], usage: { prompt_tokens: 7, completion_tokens: 3 } },'[DONE]'];
  const result = await consumeChatCompletionStream(stream(valid)); assert.equal(result.content,'Hello'); assert.equal(result.usage.completion_tokens,3);
  const truncated = structuredClone(valid); truncated[1].choices[0].finish_reason = 'length';
  await assert.rejects(consumeChatCompletionStream(stream(truncated)),error => error.code === 'incomplete_response');
  await assert.rejects(consumeChatCompletionStream(stream(valid.slice(0,-1))),error => error.code === 'early_close');
});

test('gateway uses one selected Anthropic Messages request with server-only credentials and unchanged tutor rules', async () => {
  const paid = []; let body;
  const gateway = createModelGateway({ config: CONFIG, fetchImpl: async (url,options) => {
    if (options.method !== 'POST') return json({ data: [{ id: url.includes('anthropic') ? 'claude-haiku-5-5' : 'gpt-4.1-mini' }] });
    paid.push(url); body = JSON.parse(options.body); assert.equal(options.headers['x-api-key'],CONFIG.anthropicApiKey);
    assert.equal(options.headers['anthropic-version'],'2023-06-01'); return new Response(stream(anthropic()));
  } });
  const result = await gateway.generate({ messages, selection: { provider: 'anthropic', model: 'claude-haiku-5-5', limits: { maxOutputTokens: 999999 } } });
  assert.deepEqual(paid,['https://api.anthropic.com/v1/messages']); assert.equal(result.provider,'anthropic');
  assert.equal(body.system,'Tutor rules.\n\nHost study state.'); assert.deepEqual(body.messages,[messages[2]]);
  assert.equal(body.max_tokens,1200); assert.equal(body.tools,undefined); assert.equal(body.thinking,undefined);
  assert.equal(body.service_tier,'standard_only');
});

test('expensive/unknown model limits cannot be raised by the browser; complete UTF8 prompt is checked before payment', async () => {
  let paid = 0, body;
  const gateway = createModelGateway({ config: { ...CONFIG, anthropicApiKey: '' }, fetchImpl: async (url,options) => {
    if (options.method !== 'POST') return json({ data: [{ id: 'gpt-6-astra' },{ id: 'gpt-6-future' }] });
    paid++; body = JSON.parse(options.body); return new Response(stream(openai('Hello',body.model)));
  } });
  const override = { provider: 'openai', model: 'gpt-6-astra', tier: 'standard', limits: { maxPromptBytes: 999999, maxOutputTokens: 999999 } };
  await assert.rejects(gateway.generate({ messages: [{ role: 'user', content: '😀'.repeat(2100) }], selection: override }),error => error.code === 'context_limit');
  assert.equal(paid,0);
  const result = await gateway.generate({ messages, selection: override }); assert.equal(body.max_output_tokens,768); assert.equal(body.service_tier,'default'); assert.equal(result.tier,'limited'); assert.equal(paid,1);
  assert.equal((await gateway.resolveSelection({ provider: 'openai', model: 'gpt-6-future' })).limits.maxPromptBytes,8000);
});

test('legacy GPT3.5 selects buffered Chat Completions upfront without paid stream fallback', async () => {
  let paid = 0, body;
  const gateway = createModelGateway({ config: { ...CONFIG, anthropicApiKey: '' }, fetchImpl: async (url,options) => {
    if (options.method !== 'POST') return json({ data: [{ id: 'gpt-3.5-turbo' }] });
    paid++; assert.equal(url,'https://api.openai.com/v1/chat/completions'); body = JSON.parse(options.body); assert.equal(body.service_tier,'default');
    return json({ model: 'gpt-3.5-turbo', choices: [{ finish_reason: 'stop', message: { content: 'Hello' } }], usage: { prompt_tokens: 10, completion_tokens: 2 } });
  } });
  const visible = [], result = await gateway.generate({ messages, selection: { provider: 'openai', model: 'gpt-3.5-turbo' }, onDelta: value => visible.push(value) });
  assert.equal(paid,1); assert.equal(body.stream,false); assert.equal(body.max_tokens,1200);
  assert.deepEqual(body.messages.map(message => message.role),['system','system','user']); assert.deepEqual(visible,['Hello']); assert.equal(result.content,'Hello');
  assert.equal(result.usage.input_tokens,10); assert.equal(result.usage.output_tokens,2);
});

test('limited models trim complete oldest history pairs while preserving rules, host state and newest input', async () => {
  let body, paid = 0;
  const gateway = createModelGateway({ config: { ...CONFIG, anthropicApiKey: '' }, fetchImpl: async (url,options) => {
    if (options.method !== 'POST') return json({ data: [{ id: 'gpt-6-astra' }] });
    paid++; body = JSON.parse(options.body); return new Response(stream(openai('Hello','gpt-6-astra')));
  } });
  const input = [...messages.slice(0,2),{ role: 'user', content: 'old question' },{ role: 'assistant', content: 'old answer '.repeat(900) },{ role: 'user', content: 'recent question' },{ role: 'assistant', content: 'recent answer' },messages[2]];
  const result = await gateway.generate({ messages: input, selection: { provider: 'openai', model: 'gpt-6-astra' } });
  assert.equal(result.historyPairsOmitted,1); assert.equal(paid,1);
  assert.deepEqual(body.input.map(message => message.content),['Tutor rules.','Host study state.','recent question','recent answer','Hello']);
  assert.equal(body.input[3].phase,'final_answer'); assert.equal(input.length,7);
  await assert.rejects(gateway.generate({ messages: [{ role: 'system', content: 'required rule '.repeat(700) },messages[2]], selection: { provider: 'openai', model: 'gpt-6-astra' } }),error => error.code === 'context_limit');
  assert.equal(paid,1);
});

test('gateway limits one active paid call globally and releases its slot after cancellation', async () => {
  let paid = 0, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const gateway = createModelGateway({ config: { ...CONFIG, anthropicApiKey: '', chatTimeoutMs: 1000 }, fetchImpl: async (url,options) => {
    if (options.method !== 'POST') return json({ data: [{ id: 'gpt-4.1-mini' }] });
    paid++; if (paid === 1) { entered(); return new Promise(() => {}); } return new Response(stream(openai()));
  } });
  const controller = new AbortController(), first = gateway.generate({ messages, signal: controller.signal });
  const observed = assert.rejects(first,error => error.name === 'AbortError'); await started;
  await assert.rejects(gateway.generate({ messages }),error => error.code === 'chat_busy' && error.status === 409); assert.equal(paid,1);
  controller.abort(); await observed; await tick(); assert.equal((await gateway.generate({ messages })).content,'Hello'); assert.equal(paid,2);
});

test('gateway deadlines cover stalled stream bodies and failed requests never trigger fallback or retry', async () => {
  let paid = 0;
  const gateway = createModelGateway({ config: { ...CONFIG, anthropicApiKey: '', chatTimeoutMs: 15 }, fetchImpl: async (url,options) => {
    if (options.method !== 'POST') return json({ data: [{ id: 'gpt-4.1-mini' }] });
    paid++; return new Response(new ReadableStream({ start() {} }));
  } });
  await assert.rejects(gateway.generate({ messages }),error => error.code === 'timeout'); assert.equal(paid,1);
  const fail = createModelGateway({ config: { ...CONFIG, anthropicApiKey: '' }, fetchImpl: async (url,options) => {
    if (options.method !== 'POST') return json({ data: [{ id: 'gpt-4.1-mini' }] });
    paid++; return new Response('{"secret":"provider detail"}',{ status: 429 });
  } });
  await assert.rejects(fail.generate({ messages }),error => error.code === 'provider_rate_limit' && !error.message.includes('secret')); assert.equal(paid,2);
});

const OBSERVED_FIELDS = ['requestId','provider','requestedModel','returnedModel','endpoint','statusCode','errorCode','latencyMs','inputTokens','outputTokens','cachedInputTokens','cacheWriteInputTokens','reasoningOutputTokens','estimatedCostUsd','occurredAt','source'];
function assertSafeObservation(event) {
  assert.deepEqual(Object.keys(event).sort(),[...OBSERVED_FIELDS].sort());
  assert.match(event.requestId,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.ok(Number.isInteger(event.latencyMs) && event.latencyMs >= 0 && event.latencyMs <= 3600000);
  assert.match(event.occurredAt,/^\d{4}-\d{2}-\d{2}T.*Z$/); assert.ok(Number.isFinite(Date.parse(event.occurredAt)));
  assert.equal(event.source,'app_observed');
  assert.equal(event.inputTokens === null,event.outputTokens === null);
  assert.doesNotMatch(JSON.stringify(event),/server-secret|Tutor rules|Host study state|Hello|private-|provider_details/);
}

test('settled observer has a strict metadata allowlist and conservative real-shaped OpenAI and Claude usage', async () => {
  const events = []; let paid = 0;
  const gateway = createModelGateway({ config: CONFIG, onSettled: event => events.push(event), fetchImpl: async (url,options) => {
    if (options.method !== 'POST') return json({ data: [{ id: url.includes('anthropic') ? 'claude-haiku-5-5' : 'gpt-4.1-mini' }] });
    paid++;
    if (url.includes('anthropic')) {
      const fixture = anthropic(); fixture[0].message.usage = { input_tokens: 10, cache_read_input_tokens: 30, cache_creation_input_tokens: paid === 2 ? 20 : 0,
        output_tokens: 0, service_tier: 'standard', inference_geo: paid === 4 ? 'us' : 'global', private_debug: 'private-usage' };
      fixture[3].usage = { output_tokens: 8, output_tokens_details: { thinking_tokens: 2 } }; return new Response(stream(fixture));
    }
    const fixture = openai(); fixture[1].response.service_tier = 'default';
    fixture[1].response.usage = { input_tokens: 100, output_tokens: 10, total_tokens: 110,
      input_tokens_details: { cached_tokens: 20, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 3 }, private_debug: 'private-usage' };
    return new Response(stream(fixture));
  } });
  await gateway.generate({ messages, selection: { provider: 'openai', model: 'gpt-4.1-mini', inputPricePerMillion: 99999 } });
  const written = await gateway.generate({ messages, selection: { provider: 'anthropic', model: 'claude-haiku-5-5' } });
  await gateway.generate({ messages, selection: { provider: 'anthropic', model: 'claude-haiku-5-5' } });
  await gateway.generate({ messages, selection: { provider: 'anthropic', model: 'claude-haiku-5-5' } });
  assert.equal(paid,4); assert.equal(events.length,4); events.forEach(assertSafeObservation);
  assert.equal(new Set(events.map(event => event.requestId)).size,4);
  assert.equal(events[0].endpoint,'responses'); assert.equal(events[0].returnedModel,'gpt-4.1-mini');
  assert.deepEqual([events[0].inputTokens,events[0].outputTokens,events[0].cachedInputTokens,events[0].cacheWriteInputTokens,events[0].reasoningOutputTokens],[100,10,20,0,3]);
  assert.equal(events[0].estimatedCostUsd,0.000056); assert.equal(events[0].errorCode,null); assert.equal(events[0].statusCode,200);
  assert.equal(written.usage.input_tokens,60); assert.equal(written.usage.total_tokens,68);
  assert.equal(events[1].endpoint,'messages'); assert.equal(events[1].inputTokens,60); assert.equal(events[1].cacheWriteInputTokens,20); assert.equal(events[1].reasoningOutputTokens,2); assert.equal(events[1].estimatedCostUsd,null);
  assert.equal(events[2].inputTokens,40); assert.equal(events[2].estimatedCostUsd,0.000008);
  assert.equal(events[3].estimatedCostUsd,null); // inherited geography is not a verified base-price request
});

test('settled observer records actual HTTP failures, network errors, timeouts and cancellation once without provider detail', async () => {
  for (const [respond,code,status] of [
    [() => new Response('private-provider-error',{ status: 429 }),'provider_rate_limit',429],
    [() => { throw new Error('private-network-error'); },'provider_network',502],
    [() => new Response(stream([{ invalid: 'private-malformed-event' }])),'malformed_stream',200],
    [() => new Promise(() => {}),'timeout',504],
  ]) {
    const events = []; let paid = 0;
    const gateway = createModelGateway({ config: { ...CONFIG, anthropicApiKey: '', chatTimeoutMs: 15 }, onSettled: event => events.push(event), fetchImpl: async (url,options) => {
      if (options.method !== 'POST') return json({ data: [{ id: 'gpt-4.1-mini' }] }); paid++; return respond();
    } });
    await assert.rejects(gateway.generate({ messages }),error => error.code === code);
    assert.equal(paid,1); assert.equal(events.length,1); assertSafeObservation(events[0]);
    assert.equal(events[0].statusCode,status); assert.equal(events[0].errorCode,code); assert.equal(events[0].inputTokens,null); assert.equal(events[0].estimatedCostUsd,null);
  }
  const events = []; let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const gateway = createModelGateway({ config: { ...CONFIG, anthropicApiKey: '', chatTimeoutMs: 1000 }, onSettled: event => events.push(event), fetchImpl: async (url,options) => {
    if (options.method !== 'POST') return json({ data: [{ id: 'gpt-4.1-mini' }] }); entered(); return new Promise(() => {});
  } });
  const controller = new AbortController(), result = gateway.generate({ messages, signal: controller.signal });
  const cancelled = assert.rejects(result,error => error.name === 'AbortError'); await started;
  await assert.rejects(gateway.generate({ messages }),error => error.code === 'chat_busy'); assert.equal(events.length,0);
  controller.abort(); await cancelled; assert.equal(events.length,1); assertSafeObservation(events[0]);
  assert.equal(events[0].errorCode,'cancelled'); assert.equal(events[0].statusCode,499);
});

test('pre-payment rejection emits no observation and observer exceptions or pending promises never change replies', async () => {
  let notifications = 0, paid = 0;
  const gateway = createModelGateway({ config: { ...CONFIG, anthropicApiKey: '' }, onSettled: () => {
    notifications++; if (notifications === 1) return new Promise(() => {}); throw new Error('observer failure');
  }, fetchImpl: async (url,options) => {
    if (options.method !== 'POST') return json({ data: [{ id: 'gpt-4.1-mini' }] }); paid++;
    return paid === 3 ? new Response('private-provider-error',{ status: 503 }) : new Response(stream(openai()));
  } });
  await assert.rejects(gateway.generate({ messages: [{ role: 'user', content: null }] }),error => error.code === 'invalid_input');
  await assert.rejects(gateway.generate({ messages, selection: { provider: 'openai', model: 'gpt-unlisted' } }),error => error.code === 'model_unavailable');
  await assert.rejects(gateway.generate({ messages: [{ role: 'user', content: 'x'.repeat(25000) }] }),error => error.code === 'context_limit');
  await assert.rejects(gateway.generate({ messages, signal: AbortSignal.abort() }),error => error.name === 'AbortError');
  const noKey = createModelGateway({ config: {}, onSettled: () => { notifications++; } });
  await assert.rejects(noKey.generate({ messages }),error => error.code === 'ai_unavailable');
  assert.equal(notifications,0); assert.equal(paid,0);
  assert.equal((await gateway.generate({ messages })).content,'Hello');
  assert.equal((await gateway.generate({ messages })).content,'Hello');
  await assert.rejects(gateway.generate({ messages }),error => error.code === 'provider_http' && error.status === 503);
  assert.equal(notifications,3); assert.equal(paid,3);
});

test('length-limited terminal replies fail while preserving provider-reported model and usage only for the observer', async () => {
  const events = [], gateway = createModelGateway({ config: { ...CONFIG, chatTimeoutMs: 1000 }, onSettled: event => events.push(event), fetchImpl: async (url,options) => {
    if (options.method !== 'POST') return json({ data: url.includes('anthropic') ? [{ id: 'claude-haiku-5-5' }] : [{ id: 'gpt-6-luna' },{ id: 'gpt-4-turbo' }] });
    if (url.endsWith('/responses')) return new Response(stream([{ type: 'response.incomplete', response: { status: 'incomplete', model: 'gpt-6-luna', service_tier: 'default',
      usage: { input_tokens: 42, output_tokens: 1200, output_tokens_details: { reasoning_tokens: 1200 }, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } } } }]));
    if (url.endsWith('/chat/completions')) return new Response(stream([
      { model: 'gpt-4-turbo', service_tier: 'default', choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: 'length' }] },
      { choices: [], usage: { prompt_tokens: 42, completion_tokens: 768, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 768 } } },'[DONE]',
    ]));
    const fixture = anthropic('Hello','max_tokens');
    fixture[0].message.usage = { input_tokens: 42, cache_read_input_tokens: 12, cache_creation_input_tokens: 0, service_tier: 'standard', inference_geo: 'global' };
    fixture[3].usage = { output_tokens: 768, output_tokens_details: { thinking_tokens: 700 } }; return new Response(stream(fixture));
  } });
  for (const selection of [{ provider: 'openai', model: 'gpt-6-luna' },{ provider: 'openai', model: 'gpt-4-turbo' },{ provider: 'anthropic', model: 'claude-haiku-5-5' }]) {
    await assert.rejects(gateway.generate({ messages, selection }),error => error.code === 'incomplete_response');
  }
  assert.equal(events.length,3); events.forEach(event => { assertSafeObservation(event); assert.equal(event.errorCode,'incomplete_response'); assert.equal(event.statusCode,200); assert.equal(event.estimatedCostUsd,null); });
  assert.deepEqual(events.map(event => [event.endpoint,event.returnedModel,event.inputTokens,event.outputTokens,event.reasoningOutputTokens]),[
    ['responses','gpt-6-luna',42,1200,1200],['chat','gpt-4-turbo',42,768,768],['messages','claude-haiku-5-5',54,768,700],
  ]);
});
