import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAllowedModel, getOpenAIModelProfile, createOpenAIModelCatalog, OpenAIModelError } from '../server/openai-models.js';

const key = 'server-only-openai-catalog-key';
const env = { OPENAI_API_KEY: key, OPENAI_MODEL: 'gpt-4.1-mini' };
const today = Date.parse('2026-10-09T12:00:00.000Z');
const modelsResponse = data => Response.json({ object: 'list', data: data.map(item => typeof item === 'string' ? { id: item } : item) });

test('Astra is prohibited before configuration, catalog selection, or profile lookup can spend', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return modelsResponse([]); };
  for (const model of ['gpt-6-astra', 'ASTRA', 'gpt-6.1-astra-2026-10-08', 'ft:gpt-astra:owner:name', ' astra ']) {
    assert.throws(() => assertAllowedModel(model), error => error instanceof OpenAIModelError && error.status === 400 && /prohibited/.test(error.message));
    assert.throws(() => getOpenAIModelProfile(model), /prohibited/);
    assert.throws(() => createOpenAIModelCatalog({ env: { ...env, OPENAI_MODEL: model }, fetchImpl }), /prohibited/);
    const catalog = createOpenAIModelCatalog({ env, fetchImpl });
    await assert.rejects(catalog.assertSelectable(model), /prohibited/);
    await assert.rejects(catalog.list({ selectedModel: model }), /prohibited/);
  }
  assert.equal(calls, 0);
});

test('model profiles distinguish documented endpoints, reasoning, context limits, and exact snapshot prices', () => {
  const pro = getOpenAIModelProfile('gpt-5.5-pro-2026-04-23');
  assert.equal(pro.api, 'responses');
  assert.equal(pro.tokenParameter, 'max_output_tokens');
  assert.equal(pro.jsonMode, false);
  assert.equal(pro.reasoningEffort, 'medium');
  assert.equal(pro.timeoutMs, 180000);
  assert.equal(pro.defaultMaxOutputTokens, 4096);
  assert.deepEqual(pro.rates, { inputUsdPerMillion: 30, outputUsdPerMillion: 180 });
  const sol = getOpenAIModelProfile('gpt-6.1-sol');
  assert.equal(sol.api, 'chat');
  assert.equal(sol.tokenParameter, 'max_completion_tokens');
  assert.equal(sol.supportedReasoningEfforts.includes('none'), false);
  assert.equal(sol.supportedReasoningEfforts.includes(sol.reasoningEffort), true);
  assert.deepEqual(getOpenAIModelProfile('gpt-6-luna').rates, { inputUsdPerMillion: .10, outputUsdPerMillion: .50 });
  assert.equal(getOpenAIModelProfile('gpt-5.4-nano-2026-03-17').rates.outputUsdPerMillion, 1.25);
  assert.equal(getOpenAIModelProfile('gpt-4o-2024-05-13').rates, null);
  assert.equal(getOpenAIModelProfile('gpt-3.5-turbo-1106').rates, null);
  assert.equal(getOpenAIModelProfile('gpt-4').jsonMode, false);
  assert.equal(getOpenAIModelProfile('gpt-4').tokenParameter, 'max_tokens');
  assert.equal(getOpenAIModelProfile('gpt-3.5-turbo').tokenParameter, 'max_tokens');
  assert.equal(getOpenAIModelProfile('gpt-4').contextWindowTokens, 8192);
  assert.equal(Object.isFrozen(sol.rates), true);
  for (const id of ['gpt-6', 'chat-latest', 'gpt-6.1-sol-2026-10-09', 'gpt-5.6-sol-2026-10-09', 'gpt-4o-2030-99-01', 'gpt-4.1-mini-2027-01-01', 'ft:gpt-4.1-mini:owner:name']) assert.equal(getOpenAIModelProfile(id), null);
});

test('account models intersect documented text profiles and never expose a server key', async () => {
  let calls = 0;
  const catalog = createOpenAIModelCatalog({ env, now: () => today, fetchImpl: async (url, request) => {
    calls++;
    assert.equal(url, 'https://api.openai.com/v1/models');
    assert.equal(request.method, 'GET');
    assert.equal(request.redirect, 'error');
    assert.equal(request.headers.Authorization, `Bearer ${key}`);
    assert.equal(request.signal instanceof AbortSignal, true);
    return modelsResponse(['gpt-4.1-mini', 'gpt-6-luna', 'gpt-5.5-pro', 'gpt-6-astra', 'gpt-6', 'chat-latest', 'text-embedding-3-small', 'gpt-image-1', 'whisper-1', 'gpt-4o-realtime-preview', 'gpt-4o-audio-preview', 'omni-moderation-latest', 'gpt-4o-mini-search-preview', 'gpt-4.1-mini', 'gpt-4-0314', 'gpt-3.5-turbo-1106', { id: 'gpt-5.4', shutdown_date: '2026-10-01' }, { id: 'gpt-5.4-mini', shutdown_date: 'not-a-date' }, null]);
  } });
  const result = await catalog.list({ selectedModel: 'gpt-6-luna' });
  assert.equal(result.configured, true);
  assert.equal(result.source, 'account');
  assert.equal(result.stale, false);
  assert.deepEqual(result.models.map(item => item.id), ['gpt-4.1-mini', 'gpt-6-luna', 'gpt-5.5-pro']);
  assert.equal(result.models.find(item => item.selected).id, 'gpt-6-luna');
  assert.equal(result.fetchedAt, new Date(today).toISOString());
  assert.doesNotMatch(JSON.stringify(result), /server-only|Bearer|Authorization|astra/i);
  assert.equal((await catalog.assertSelectable('gpt-5.5-pro')).api, 'responses');
  await assert.rejects(catalog.assertSelectable('gpt-5.4'), /not available/);
  assert.equal(calls, 1);
});

test('account list and failed refresh are cached with clear stale evidence, without retries', async () => {
  let clock = today, calls = 0;
  const catalog = createOpenAIModelCatalog({ env, now: () => clock, fetchImpl: async () => {
    calls++;
    if (calls === 1) return modelsResponse(['gpt-4.1-mini']);
    throw new Error(`${key} private network detail`);
  } });
  await Promise.all([catalog.list(), catalog.list(), catalog.list()]);
  assert.equal(calls, 1);
  clock += 5 * 60 * 1000;
  const stale = await catalog.list();
  assert.equal(stale.source, 'account');
  assert.equal(stale.stale, true);
  assert.match(stale.warning, /Previously confirmed/);
  assert.deepEqual(stale.models.map(item => item.id), ['gpt-4.1-mini']);
  assert.equal(calls, 2);
  await catalog.list();
  assert.equal(calls, 2);
  await assert.rejects(catalog.assertSelectable('gpt-4.1-mini'), error => error instanceof OpenAIModelError && error.status === 503 && /could not be confirmed/.test(error.message));
  assert.equal(calls, 2);
  assert.doesNotMatch(JSON.stringify(stale), /server-only|private network/);
});

test('missing key or first list failure offers only a clearly documented fallback', async () => {
  let calls = 0;
  const missing = createOpenAIModelCatalog({ env: {}, now: () => today, fetchImpl: async () => { calls++; throw new Error('Should not run.'); } });
  const local = await missing.list();
  assert.equal(local.configured, false);
  assert.equal(local.source, 'documented');
  assert.equal(local.fetchedAt, null);
  assert.match(local.warning, /server OpenAI API key/);
  await assert.rejects(missing.assertSelectable('gpt-4.1-mini'), { status: 503 });
  assert.equal(calls, 0);
  const failed = createOpenAIModelCatalog({ env, now: () => today, fetchImpl: async () => { calls++; return new Response(key, { status: 401 }); } });
  const result = await failed.list();
  assert.equal(result.source, 'documented');
  assert.match(result.warning, /access has not been confirmed/);
  assert.equal(result.models.some(item => /astra/i.test(item.id)), false);
  await assert.rejects(failed.assertSelectable('gpt-5.4-mini-2026-03-17'), { status: 503 });
  assert.equal(calls, 1);
  assert.doesNotMatch(JSON.stringify(result), /server-only/);
});

test('known shutdown dates override omitted upstream metadata and expire cached models on time', async () => {
  let clock = Date.parse('2026-10-22T23:59:59.000Z');
  const catalog = createOpenAIModelCatalog({ env, now: () => clock, fetchImpl: async () => modelsResponse(['gpt-4.1-mini', 'gpt-4', 'o4-mini']) });
  const before = await catalog.list();
  assert.deepEqual(before.models.map(item => item.id), ['gpt-4.1-mini', 'gpt-4', 'o4-mini']);
  assert.equal(before.models.find(item => item.id === 'gpt-4').shutdownDate, '2026-10-23T00:00:00.000Z');
  clock += 1000;
  const after = await catalog.list();
  assert.deepEqual(after.models.map(item => item.id), ['gpt-4.1-mini']);
  await assert.rejects(catalog.assertSelectable('gpt-4'), /not available/);
  const fallback = await createOpenAIModelCatalog({ env: {}, now: () => clock }).list();
  assert.equal(fallback.models.some(item => item.id === 'o1' || item.id === 'gpt-4.1-nano'), false);
  assert.equal(fallback.models.some(item => item.id === 'gpt-4-0314' || item.id === 'gpt-3.5-turbo-1106'), false);
});

test('malformed and oversized account catalogs stay sanitized and do not become selectable account evidence', async () => {
  const responses = [() => new Response('{broken json'), () => Response.json({ data: 'not-an-array' }), () => new Response(key, { headers: { 'content-length': '1048577' } }), () => modelsResponse(Array.from({ length: 10001 }, () => 'gpt-4.1-mini'))];
  for (const createResponse of responses) {
    let calls = 0;
    const catalog = createOpenAIModelCatalog({ env, now: () => today, fetchImpl: async () => { calls++; return createResponse(); } });
    const result = await catalog.list();
    assert.equal(result.source, 'documented');
    assert.match(result.warning, /unavailable/);
    assert.doesNotMatch(JSON.stringify(result), /server-only/);
    assert.equal(calls, 1);
  }
});

test('documented December and April shutdowns remove exact eligible models from account and fallback lists', async () => {
  let clock = Date.parse('2026-12-10T23:59:59.000Z');
  const catalog = createOpenAIModelCatalog({ env, now: () => clock, fetchImpl: async () => modelsResponse(['gpt-4.1-mini', 'gpt-5', 'gpt-5-pro-2025-10-06', 'o3-pro', 'gpt-5.1', 'gpt-5.4-nano']) });
  const before = await catalog.list();
  assert.equal(before.models.find(item => item.id === 'gpt-5-pro-2025-10-06').shutdownDate, '2026-12-11T00:00:00.000Z');
  clock += 1000;
  assert.deepEqual((await catalog.list()).models.map(item => item.id), ['gpt-4.1-mini', 'gpt-5.1', 'gpt-5.4-nano']);
  clock = Date.parse('2027-04-01T00:00:00.000Z');
  assert.deepEqual((await catalog.list()).models.map(item => item.id), ['gpt-4.1-mini']);
  const fallback = await createOpenAIModelCatalog({ env: {}, now: () => clock }).list();
  for (const id of ['gpt-5', 'gpt-5-mini-2025-08-07', 'o3-pro-2025-06-10', 'gpt-5.1', 'gpt-5.4-nano']) assert.equal(fallback.models.some(item => item.id === id), false);
});
