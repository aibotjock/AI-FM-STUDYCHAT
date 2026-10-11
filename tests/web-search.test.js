import test from 'node:test';
import assert from 'node:assert/strict';
import { consumeResponseStream, consumeAnthropicStream, createModelGateway } from '../server/provider.js';
import { SEARCH_DOMAINS, safeSource, searchCapable } from '../server/web-search.js';
import { loadConfig } from '../server/config.js';
const stream = events => new ReadableStream({ start(controller) { const text = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''); const bytes = new TextEncoder().encode(text); for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i,i+7)); controller.close(); } });
const citation = { type: 'url_citation', url: 'https://www.cdc.gov/guidelines', title: 'CDC guidance', start_index: 6, end_index: 9 };
function openai(searched = true, annotations = [citation]) { return [
  ...(searched ? [{ type: 'response.web_search_call.searching' }] : []),
  { type: 'response.output_text.delta', delta: 'Read: [1]' },
  { type: 'response.completed', response: { status: 'completed', model: 'gpt-4.1-mini', service_tier: 'default', usage: { input_tokens: 20, output_tokens: 5, input_tokens_details: { cache_write_tokens: 0 } }, output: [
    ...(searched ? [{ type: 'web_search_call', status: 'completed' }] : []),
    { type: 'message', content: [{ type: 'output_text', text: 'Read: [1]', annotations }] }
  ] } }
]; }
function claude(results, citeUrl = citation.url, stop = 'end_turn') { return [
  { type: 'message_start', message: { model: 'claude-sonnet-4-5', usage: { input_tokens: 10 } } },
  { type: 'content_block_start', content_block: { type: 'server_tool_use', name: 'web_search' } },
  { type: 'content_block_start', content_block: { type: 'web_search_tool_result', content: results } },
  { type: 'content_block_start', content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Current guidance.' } },
  { type: 'content_block_delta', delta: { type: 'citations_delta', citation: { type: 'web_search_result_location', url: citeUrl, title: 'Guideline', cited_text: 'Not retained' } } },
  { type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 4, server_tool_use: { web_search_requests: 1 } } },
  { type: 'message_stop' }
]; }
test('medical search rejects spoofed, credentialed, non-HTTPS and outside domains', () => {
  for (const url of ['https://cdc.gov.evil.org/x','https://evilcdc.gov/x','http://cdc.gov/x','https://user:password@cdc.gov/x','https://cdc.gov:8443/x','javascript:alert(1)']) assert.equal(safeSource({ url },0),null);
  assert.ok(safeSource({ url: 'https://www.cdc.gov/x' },0));
  assert.equal(loadConfig({}).webSearchEnabled,true); assert.equal(loadConfig({ WEB_SEARCH_ENABLED: 'false' }).webSearchEnabled,false);
  assert.throws(() => loadConfig({ WEB_SEARCH_ENABLED: 'yes' }));
  assert.equal(searchCapable('openai',{ id: 'gpt-4.1-nano' }),false);
  assert.equal(searchCapable('anthropic',{ id: 'claude-sonnet-4-5', capabilities: { server_tools: { web_search: { supported: false } } } }),false);
});
test('OpenAI citations require a search, retain safe offsets, and reject unsupported links', async () => {
  let searches = 0; const result = await consumeResponseStream(stream(openai(true,[citation,{ ...citation,url: 'https://blog.example/x' },{ ...citation,end_index: 100 }])),{ onSearch: () => searches++ });
  assert.ok(searches); assert.equal(result.sources.length,1); assert.equal(result.sources[0].startIndex,6); assert.match(result.label,/Live search citations/);
  assert.equal((await consumeResponseStream(stream(openai(false)))).sources.length,0);
  assert.match((await consumeResponseStream(stream(openai(true,[])))).label,/no supporting citation/);
});
test('Claude accepts only citations to retrieved allowed results and admits tool errors', async () => {
  const result = await consumeAnthropicStream(stream(claude([{ type: 'web_search_result',url: citation.url }])));
  assert.equal(result.sources.length,1); assert.equal(result.sources[0].endIndex,result.content.length); assert.doesNotMatch(JSON.stringify(result.sources),/Not retained/);
  assert.equal((await consumeAnthropicStream(stream(claude([])))).sources.length,0);
  const failed = await consumeAnthropicStream(stream(claude({ type: 'web_search_tool_result_error',error_code: 'unavailable' })));
  assert.match(failed.label,/incomplete/); assert.equal(failed.sources.length,0);
  await assert.rejects(consumeAnthropicStream(stream(claude([],citation.url,'pause_turn'))),error => error.code === 'incomplete_response');
});
test('gateway exposes native bounded search, keeps selected provider, and excludes tool fees from text-only estimates', async () => {
  for (const provider of ['openai','anthropic']) {
    let requests = 0, payload, observed;
    const model = provider === 'openai' ? 'gpt-4.1-mini' : 'claude-sonnet-4-5';
    const gateway = createModelGateway({ config: { apiKey: 'secret', anthropicApiKey: 'secret', model, webSearchEnabled: true }, onSettled: value => { observed = value; }, fetchImpl: async (url,options) => {
      if (url.includes('/models')) return new Response(JSON.stringify({ data: [{ id: model }] }));
      requests++; payload = JSON.parse(options.body);
      return new Response(stream(provider === 'openai' ? openai() : claude([{ type: 'web_search_result',url: citation.url }])));
    } });
    await gateway.generate({ selection: { provider,model },messages: [{ role: 'user',content: 'Check current guidelines.' }] });
    assert.equal(requests,1); assert.equal(payload.model,model); assert.equal(payload.tools.length,1);
    assert.deepEqual(provider === 'openai' ? payload.tools[0].filters.allowed_domains : payload.tools[0].allowed_domains,SEARCH_DOMAINS);
    assert.equal(provider === 'openai' ? payload.max_tool_calls : payload.tools[0].max_uses,2);
    assert.equal(observed.estimatedCostUsd,null); assert.doesNotMatch(JSON.stringify(observed),/guidelines|secret|cdc.gov/);
  }
});
test('disabled search has no tools or search instructions and no extra request', async () => {
  let body;
  const gateway = createModelGateway({ config: { apiKey: 'secret',webSearchEnabled: false }, fetchImpl: async (url,options) => {
    if (url.includes('/models')) return new Response(JSON.stringify({ data: [{ id: 'gpt-4.1-mini' }] }));
    body = JSON.parse(options.body); return new Response(stream(openai(false,[])));
  } });
  await gateway.generate({ messages: [{ role: 'user',content: 'Hi' }] });
  assert.equal(body.tools,undefined); assert.equal(body.input.length,1);
});
test('failed evidence lookup streams an explicit typed-chat fallback for voice readout', async () => {
  let streamed = '';
  const gateway = createModelGateway({ config: { apiKey: 'secret',webSearchEnabled: true }, fetchImpl: async (url) => {
    if (url.includes('/models')) return new Response(JSON.stringify({ data: [{ id: 'gpt-4.1-mini' }] }));
    return new Response(stream(openai(true,[])));
  } });
  const result = await gateway.generate({ messages: [{ role: 'user',content: 'Verify this guideline' }], onDelta: text => { streamed += text; } });
  assert.equal(streamed,result.content); assert.match(result.content,/could not verify.*guideline/); assert.match(result.content,/typed chat/); assert.equal(result.sources.length,0);
});
