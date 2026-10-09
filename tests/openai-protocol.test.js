import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiProvider, AiProviderError } from '../server/ai-provider.js';

// Synthetic transport fixtures validate protocol and accounting, not medicine.
// No request leaves this process and no real provider key is used.
const NOW = Date.parse('2026-10-09T12:00:00Z');
const messages = [{ role: 'system', content: 'Help with nonclinical recall practice.' }, { role: 'user', content: 'Reply READY.' }];
const chat = (model, extra = {}) => ({ model, choices: [{ message: { content: 'READY' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20 }, ...extra });
const responses = (model, extra = {}) => ({ model, status: 'completed', output: [{ type: 'reasoning', summary: [{ text: 'Private reasoning fixture' }] }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'READY' }] }], usage: { input_tokens: 100, output_tokens: 20 }, ...extra });

function provider(model, reply, onRequest = () => {}) {
  let calls = 0;
  const instance = createAiProvider({ env: { AI_PROVIDER: 'openai', OPENAI_API_KEY: 'synthetic-server-key', OPENAI_MODEL: model }, fetchImpl: async (url, options) => {
    calls++;
    const body = JSON.parse(options.body);
    onRequest(url, body, options);
    return Response.json(reply);
  } });
  return { instance, callCount: () => calls };
}

test('legacy OpenAI profiles use max_tokens without unsupported JSON mode and reject excessive context before inference', async t => {
  // Freeze profile eligibility at this validation date: these models have an
  // announced future retirement that must not turn a protocol test into a poll.
  t.mock.method(Date, 'now', () => NOW);
  for (const model of ['gpt-3.5-turbo', 'gpt-4-turbo', 'gpt-4']) {
    const mock = provider(model, chat(model), (url, body, options) => {
      assert.equal(url, 'https://api.openai.com/v1/chat/completions');
      assert.equal(options.redirect, 'error');
      assert.equal(body.store, false);
      assert.equal(body.max_tokens, 512);
      assert.equal(Object.hasOwn(body, 'max_completion_tokens'), false);
      assert.equal(Object.hasOwn(body, 'response_format'), false);
      assert.match(body.messages[0].content, /valid JSON object/);
    });
    assert.equal((await mock.instance.complete(messages, { jsonMode: true, maxOutputTokens: 512 })).content, 'READY');
    assert.equal(mock.callCount(), 1);
  }
  const bounded = provider('gpt-4', chat('gpt-4'));
  await assert.rejects(bounded.instance.complete([{ role: 'user', content: 'x'.repeat(9000) }]), error => error instanceof AiProviderError && error.status === 400 && /context/.test(error.message));
  assert.equal(bounded.callCount(), 0);
});

test('modern OpenAI profiles send max_completion_tokens and low reasoning while reporting estimated standard-rate metadata', async () => {
  const mock = provider('gpt-6-luna', chat('gpt-6-luna'), (url, body) => {
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(body.max_completion_tokens, 512);
    assert.equal(Object.hasOwn(body, 'max_tokens'), false);
    assert.equal(body.reasoning_effort, 'low');
    assert.equal(body.store, false);
    assert.deepEqual(body.response_format, { type: 'json_object' });
  });
  const result = await mock.instance.complete(messages, { jsonMode: true, maxOutputTokens: 512, includeMetadata: true });
  assert.equal(result.metadata.requestedModel, 'gpt-6-luna');
  assert.equal(result.metadata.returnedModel, 'gpt-6-luna');
  assert.equal(result.metadata.endpoint, 'chat');
  assert.deepEqual(result.metadata.usage, { prompt_tokens: 100, completion_tokens: 20 });
  assert.equal(result.metadata.estimatedCostUsd, .00002);
  assert.match(result.metadata.pricingBasis, /estimate|standard rates/i);
  assert.ok(result.metadata.latencyMs >= 0);
  assert.equal(mock.callCount(), 1);
});

test('Responses-only OpenAI profiles isolate instructions, normalize usage and exclude reasoning from saved text', async () => {
  const mock = provider('gpt-5.4-pro', responses('gpt-5.4-pro'), (url, body) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(body.store, false);
    assert.equal(body.max_output_tokens, 4096);
    assert.deepEqual(body.reasoning, { effort: 'medium' });
    assert.equal(Object.hasOwn(body, 'text'), false);
    assert.equal(Object.hasOwn(body, 'response_format'), false);
    assert.match(body.instructions, /nonclinical recall/);
    assert.match(body.instructions, /valid JSON object/);
    assert.deepEqual(body.input, [messages[1]]);
  });
  const result = await mock.instance.complete(messages, { jsonMode: true, includeMetadata: true });
  assert.equal(result.content, 'READY');
  assert.equal(result.metadata.endpoint, 'responses');
  assert.deepEqual(result.usage, { prompt_tokens: 100, completion_tokens: 20 });
  assert.equal(result.metadata.estimatedCostUsd, .0066);
  assert.doesNotMatch(JSON.stringify(result), /Private reasoning|synthetic-server-key/);
  assert.equal(mock.callCount(), 1);
});

test('incomplete, refused and invalid Responses outputs fail safely without a retry or fallback', async () => {
  const model = 'gpt-5.4-pro';
  for (const [reply, status] of [
    [responses(model, { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }), 502],
    [responses(model, { error: { message: 'Private upstream fixture' } }), 502],
    [responses(model, { output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'Private refusal fixture' }] }] }), 422],
    [responses(model, { output: [{ type: 'reasoning', summary: [{ text: 'Private reasoning fixture' }] }] }), 502],
    [responses(model, { status: 'failed' }), 502]
  ]) {
    const mock = provider(model, reply);
    await assert.rejects(mock.instance.complete(messages), error => error instanceof AiProviderError && error.status === status && !/Private/.test(error.message));
    assert.equal(mock.callCount(), 1);
  }
});

test('returned model IDs cannot switch to another family that shares the requested prefix', async t => {
  t.mock.method(Date, 'now', () => NOW);
  for (const [requested, returned] of [['gpt-5.4', 'gpt-5.4-mini'], ['gpt-5.4', 'gpt-5.4-pro'], ['gpt-4', 'gpt-4-turbo'], ['gpt-4.1-mini', 'unknown-model']]) {
    const mock = provider(requested, chat(returned));
    await assert.rejects(mock.instance.complete(messages), error => error instanceof AiProviderError && error.status === 502 && /different model/.test(error.message));
    assert.equal(mock.callCount(), 1);
  }
});

test('a requested alias accepts only its documented same-family snapshot and reports both exact IDs', async () => {
  const mock = provider('gpt-5.4', chat('gpt-5.4-2026-03-05'));
  const result = await mock.instance.complete(messages, { includeMetadata: true });
  assert.equal(result.content, 'READY');
  assert.equal(result.metadata.requestedModel, 'gpt-5.4');
  assert.equal(result.metadata.returnedModel, 'gpt-5.4-2026-03-05');
  assert.equal(mock.callCount(), 1);
});

test('a pinned snapshot rejects a different documented snapshot in its own family', async () => {
  const mock = provider('gpt-4o-2024-08-06', chat('gpt-4o-2024-11-20'));
  await assert.rejects(mock.instance.complete(messages), error => error instanceof AiProviderError && error.status === 502 && /different model/.test(error.message));
  assert.equal(mock.callCount(), 1);
});

test('missing or invalid usage and unverified historical prices remain unknown rather than reporting invented costs', async t => {
  t.mock.method(Date, 'now', () => NOW);
  for (const usage of [undefined, { prompt_tokens: -1, completion_tokens: 20 }, { prompt_tokens: 100, completion_tokens: '20' }, { prompt_tokens: 10000001, completion_tokens: 20 }]) {
    const mock = provider('gpt-4.1-mini', chat('gpt-4.1-mini', { usage }));
    const result = await mock.instance.complete(messages, { includeMetadata: true });
    assert.equal(result.content, 'READY');
    assert.equal(result.usage, null);
    assert.equal(result.metadata.estimatedCostUsd, null);
    assert.equal(result.metadata.pricingBasis, 'unknown');
    assert.equal(mock.callCount(), 1);
  }
  const unpriced = provider('gpt-4o-2024-05-13', chat('gpt-4o-2024-05-13'));
  assert.deepEqual(unpriced.instance.rates, { inputUsdPerMillion: null, outputUsdPerMillion: null });
  const result = await unpriced.instance.complete(messages, { includeMetadata: true });
  assert.deepEqual(result.usage, { prompt_tokens: 100, completion_tokens: 20 });
  assert.equal(result.metadata.estimatedCostUsd, null);
  assert.equal(result.metadata.pricingBasis, 'unknown');
  assert.equal(unpriced.callCount(), 1);
});
