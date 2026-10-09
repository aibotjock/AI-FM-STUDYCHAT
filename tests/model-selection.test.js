import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/index.js';
import { createStudyCurriculum } from '../server/study-curriculum.js';
import { studyCondition, STUDY_NOW } from './fixtures/study-condition.js';
import { sourceSpanSupport } from './fixtures/natural-review-v2.js';

const ACCESS_TOKEN = 'owner-model-test-token-at-least-24-characters';
const API_KEY = 'mock-provider-key-must-never-be-exported';
const MODEL_IDS = ['gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-5.5-pro'];
const STUDY_SELECTOR = JSON.stringify({ chunkIds: ['asthma:management'], questionId: null, unsupported: false });
const MANAGEMENT_FACT = studyCondition().sections.find(section => section.id === 'management').text;

function naturalContent(body) {
  const schema = body.response_format?.json_schema?.name;
  assert.ok(['family_medicine_natural_tutor', 'family_medicine_natural_review_v2'].includes(schema), `Unexpected generated contract ${schema}`);
  assert.ok(body.messages.some(message => message.content.includes(schema === 'family_medicine_natural_review_v2' ? 'NATURAL_REVIEW_DATA' : 'NATURAL_TUTOR_CONTEXT')));
  const reply = schema === 'family_medicine_natural_review_v2'
    ? { version: 2, approved: true, segments: [{ id: 's1', approved: true, externalFactCount: 1, claims: [{ quote: MANAGEMENT_FACT, type: 'medical', sourceChunkIds: ['asthma:management'], supports: [sourceSpanSupport(body, 'asthma:management')] }], flags: [] }] }
    : { segments: [{ id: 's1', text: MANAGEMENT_FACT, sourceChunkIds: ['asthma:management'] }] };
  return JSON.stringify(reply);
}

async function fixture(t, { dataDir, keepData = false, env = {}, fetchImpl, authenticateRequest, generateReply } = {}) {
  const directory = dataDir || mkdtempSync(join(tmpdir(), 'studychat-model-selection-'));
  const curriculum = createStudyCurriculum({ records: [studyCondition()], now: () => STUDY_NOW });
  const foundations = createStudyCurriculum({ records: [], now: () => STUDY_NOW });
  const server = createApp({ dataDir: directory, curriculum, foundations, env: { STUDY_ACCESS_TOKEN: ACCESS_TOKEN, OPENAI_API_KEY: API_KEY, AI_PROVIDER: 'openai', ...env }, fetchImpl, authenticateRequest, generateReply });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  let cookie;
  t.after(async () => {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    if (!keepData) rmSync(directory, { recursive: true, force: true });
  });
  async function request(path, method = 'GET', body, headers = {}) {
    const response = await fetch(baseUrl + path, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, headers: response.headers, body: await response.json() };
  }
  async function login(token = ACCESS_TOKEN, headers = {}) {
    const result = await request('/api/login', 'POST', { token }, headers);
    if (result.status === 200) cookie = result.headers.get('set-cookie')?.split(';')[0];
    return result;
  }
  return { server, dataDir: directory, request, login };
}

function providerMock({ reply = 'READY', returnedModel, usage = { prompt_tokens: 1000, completion_tokens: 100 }, inference } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.headers.Authorization, `Bearer ${API_KEY}`);
    if (url === 'https://api.openai.com/v1/models') {
      assert.equal(options.method, 'GET');
      return Response.json({ data: MODEL_IDS.map(id => ({ id })).concat([{ id: 'gpt-astra-mock-prohibited' }, { id: 'unknown-model' }]) });
    }
    assert.equal(options.method, 'POST');
    assert.ok(['https://api.openai.com/v1/chat/completions', 'https://api.openai.com/v1/responses'].includes(url));
    const body = JSON.parse(options.body);
    assert.equal(body.store, false);
    assert.ok(MODEL_IDS.includes(body.model), `Unexpected inference model ${body.model}`);
    assert.doesNotMatch(body.model, /astra/i);
    if (inference) return inference({ url, options, body });
    const model = returnedModel || body.model;
    return url.endsWith('/responses')
      ? Response.json({ model, status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: reply }] }], usage: { input_tokens: usage.prompt_tokens, output_tokens: usage.completion_tokens } })
      : Response.json({ model, choices: [{ message: { content: reply }, finish_reason: 'stop' }], usage });
  };
  return { calls, fetchImpl, modelCalls: () => calls.filter(call => call.options.method === 'GET'), inferenceCalls: () => calls.filter(call => call.options.method === 'POST') };
}

test('owner model APIs require sign-in, reject prohibited and unknown selections before inference, and use one account catalog request', async t => {
  const mock = providerMock();
  const app = await fixture(t, mock);
  for (const [path, method, body] of [['/api/models', 'GET'], ['/api/model-results', 'GET'], ['/api/model', 'PUT', { model: 'gpt-4.1-nano' }], ['/api/model-test', 'POST', { requestId: 'unauthenticated' }]]) {
    assert.equal((await app.request(path, method, body)).status, 401);
  }
  assert.equal(mock.calls.length, 0);
  assert.equal((await app.login()).status, 200);
  assert.equal((await app.request('/api/model', 'PUT', { model: 'gpt-AsTrA-prohibited' })).status, 400);
  assert.equal((await app.request('/api/model', 'PUT', { model: 'unknown-model' })).status, 400);
  assert.equal(mock.calls.length, 0);
  const catalog = await app.request('/api/models');
  assert.equal(catalog.status, 200);
  assert.equal(catalog.body.source, 'account');
  assert.deepEqual(catalog.body.models.map(model => model.id).sort(), [...MODEL_IDS].sort());
  assert.equal(catalog.body.selectedModel, 'gpt-4.1-mini');
  assert.equal((await app.request('/api/models')).status, 200);
  assert.equal(mock.modelCalls().length, 1);
  assert.equal(mock.inferenceCalls().length, 0);
  assert.equal(JSON.stringify(catalog.body).includes(API_KEY), false);
});

test('model selection is disabled for externally authenticated workspaces and Claude workspaces', async t => {
  const mock = providerMock();
  const external = await fixture(t, { ...mock, authenticateRequest: () => true });
  for (const [path, method, body] of [['/api/models', 'GET'], ['/api/model-results', 'GET'], ['/api/model', 'PUT', { model: 'gpt-4.1-nano' }], ['/api/model-test', 'POST', { requestId: 'not-an-owner' }]]) {
    assert.equal((await external.request(path, method, body)).status, 403);
  }
  const claude = await fixture(t, { ...mock, env: { AI_PROVIDER: 'anthropic', CLAUDE_API_KEY: 'mock-unused-claude-key' } });
  await claude.login();
  assert.equal((await claude.request('/api/status')).body.modelSelectionEnabled, false);
  assert.equal((await claude.request('/api/models')).status, 403);
  assert.equal((await claude.request('/api/model', 'PUT', { model: 'gpt-4.1-nano' })).status, 403);
  assert.equal(mock.calls.length, 0);
});

test('a selected owner model survives restart and identical connection checks reuse persisted results with new request IDs', async t => {
  const mock = providerMock();
  const first = await fixture(t, { ...mock, keepData: true });
  await first.login();
  const selection = await first.request('/api/model', 'PUT', { model: 'gpt-4.1-nano' });
  assert.equal(selection.status, 200);
  assert.equal(selection.body.model, 'gpt-4.1-nano');
  const initial = await first.request('/api/model-test', 'POST', { requestId: 'connection-test-1' });
  assert.equal(initial.status, 200);
  assert.equal(initial.body.cached, false);
  assert.equal(initial.body.connectionPassed, true);
  assert.equal(initial.body.instructionPassed, true);
  assert.equal(initial.body.requestedModel, 'gpt-4.1-nano');
  assert.equal(initial.body.clinicalAccuracy, 'Not evaluated');
  const sameId = await first.request('/api/model-test', 'POST', { requestId: 'connection-test-1' });
  const newId = await first.request('/api/model-test', 'POST', { requestId: 'connection-test-2' });
  assert.equal(sameId.body.cached, true);
  assert.equal(newId.body.cached, true);
  assert.equal(newId.body.recordedAt, initial.body.recordedAt);
  assert.equal(mock.modelCalls().length, 1);
  assert.equal(mock.inferenceCalls().length, 1);
  const exported = await first.request('/api/model-results');
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get('content-disposition'), /studychat-model-results\.json/);
  assert.equal(exported.body.results.length, 1);
  assert.equal(JSON.stringify(exported.body).includes(API_KEY), false);
  assert.equal(JSON.stringify(exported.body).includes(ACCESS_TOKEN), false);
  await new Promise(resolve => first.server.close(resolve));
  const second = await fixture(t, { ...mock, dataDir: first.dataDir });
  await second.login();
  assert.equal((await second.request('/api/status')).body.model, 'gpt-4.1-nano');
  const restarted = await second.request('/api/model-test', 'POST', { requestId: 'connection-test-after-restart' });
  assert.equal(restarted.status, 200);
  assert.equal(restarted.body.cached, true);
  assert.equal(restarted.body.recordedAt, initial.body.recordedAt);
  assert.equal(mock.inferenceCalls().length, 1);
});

test('model changes during active chat are rejected and chat provenance includes requested model, returned model, usage and cost', async t => {
  let release;
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  const mock = providerMock({ inference: async ({ body }) => {
    markStarted();
    await pending;
    return Response.json({ model: `${body.model}-2025-04-14`, choices: [{ message: { content: naturalContent(body) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 100 } });
  } });
  const app = await fixture(t, mock);
  t.after(() => release());
  await app.login();
  const conversation = (await app.request('/api/conversations', 'POST', { mode: 'coach' })).body;
  const active = app.request('/api/chat', 'POST', { conversationId: conversation.id, content: 'Explain asthma management for board study.', requestId: 'metadata-chat' });
  await started;
  assert.equal((await app.request('/api/model', 'PUT', { model: 'gpt-4.1-nano' })).status, 409);
  assert.equal(mock.modelCalls().length, 0);
  release();
  const completed = await active;
  assert.equal(completed.status, 200);
  assert.match(completed.body.message.content, /Mock management fact: review inhaler technique/);
  assert.equal(completed.body.message.sourceVerified, false);
  assert.equal(completed.body.message.reviewedDialogue, true);
  assert.equal(completed.body.message.groundingReview.status, 'passed');
  const metadata = completed.body.message.ai;
  assert.equal(metadata.provider, 'openai');
  assert.equal(metadata.endpoint, 'chat');
  assert.equal(metadata.requestedModel, 'gpt-4.1-mini');
  assert.equal(metadata.returnedModel, 'gpt-4.1-mini-2025-04-14');
  assert.deepEqual(metadata.usage, { prompt_tokens: 1000, completion_tokens: 100 });
  assert.equal(metadata.estimatedCostUsd, .00056);
  assert.ok(Number.isFinite(metadata.latencyMs) && metadata.latencyMs >= 0);
  assert.ok(Number.isFinite(metadata.recordedAt));
  assert.equal(completed.body.message.aiReview.requestedModel, metadata.requestedModel);
  assert.equal(completed.body.message.aiReview.returnedModel, metadata.returnedModel);
  assert.deepEqual(completed.body.message.aiTotal.usage, { prompt_tokens: 2000, completion_tokens: 200 });
  assert.equal(completed.body.message.aiTotal.estimatedCostUsd, .00112);
  assert.equal(completed.body.message.aiTotal.calls, 2);
  assert.equal((await app.request('/api/state')).body.conversations[0].messages[1].ai.requestedModel, 'gpt-4.1-mini');
  assert.equal(mock.inferenceCalls().length, 2);
});

test('persisted model selection keeps documented model prices after restart rather than original server overrides', async t => {
  const mock = providerMock();
  const env = { AI_INPUT_USD_PER_MILLION: '3', AI_OUTPUT_USD_PER_MILLION: '9' };
  const first = await fixture(t, { ...mock, env, keepData: true });
  await first.login();
  const selection = await first.request('/api/model', 'PUT', { model: 'gpt-4.1-nano' });
  assert.equal(selection.status, 200);
  assert.deepEqual(selection.body.rates, { inputUsdPerMillion: .10, outputUsdPerMillion: .40 });
  await new Promise(resolve => first.server.close(resolve));
  const second = await fixture(t, { ...mock, env, dataDir: first.dataDir });
  await second.login();
  const result = await second.request('/api/model-test', 'POST', { requestId: 'restart-pricing-check' });
  assert.equal(result.status, 200);
  assert.equal(result.body.requestedModel, 'gpt-4.1-nano');
  assert.equal(result.body.estimatedCostUsd, .00014);
});

test('Responses-only owner models can be selected and connection checks persist normalized usage without paid repeats', async t => {
  const mock = providerMock();
  const app = await fixture(t, mock);
  await app.login();
  assert.equal((await app.request('/api/model', 'PUT', { model: 'gpt-5.5-pro' })).status, 200);
  const result = await app.request('/api/model-test', 'POST', { requestId: 'responses-check' });
  assert.equal(result.status, 200);
  assert.equal(result.body.endpoint, 'responses');
  assert.equal(result.body.instructionPassed, true);
  assert.deepEqual(result.body.usage, { prompt_tokens: 1000, completion_tokens: 100 });
  const body = JSON.parse(mock.inferenceCalls()[0].options.body);
  assert.equal(body.max_output_tokens, 512);
  assert.equal(body.model, 'gpt-5.5-pro');
  assert.equal((await app.request('/api/model-test', 'POST', { requestId: 'responses-check-again' })).body.cached, true);
  assert.equal(mock.inferenceCalls().length, 1);
});

test('backup imports preserve untrusted provenance and evidence flags, while unsafe URLs and forbidden model metadata reject atomically', async t => {
  const citations = [{ id: 'reviewed-reference-1', title: 'Synthetic reviewed reference', url: 'https://example.org/reference', edition: '2026', reviewedAt: '2026-10-01' }];
  const app = await fixture(t, { generateReply: async () => ({ content: 'There is not enough reviewed evidence.', citations, unsupported: true }), fetchImpl: async () => { throw new Error('This test must not call a provider.'); } });
  await app.login();
  const conversation = (await app.request('/api/conversations', 'POST', { mode: 'coach' })).body;
  assert.equal((await app.request('/api/chat', 'POST', { conversationId: conversation.id, content: 'Synthetic source check.' })).status, 200);
  const backup = (await app.request('/api/export')).body;
  backup.conversations[0].messages[1].ai = { provider: 'openai', requestedModel: 'gpt-4.1-mini', returnedModel: 'gpt-4.1-mini-2025-04-14', endpoint: 'chat', usage: { prompt_tokens: 1000, completion_tokens: 100 }, estimatedCostUsd: .00056, latencyMs: 12, recordedAt: Date.now(), pricingBasis: 'Synthetic rates' };
  backup.conversations[0].messages[1].reviewedDialogue = true;
  backup.conversations[0].messages[1].canonicalSpokenText = true;
  backup.conversations[0].messages[1].groundingReview = { version: 1, status: 'passed', externalClaimCount: 0 };
  assert.equal((await app.request('/api/import', 'POST', backup)).status, 200);
  const imported = (await app.request('/api/state')).body;
  const message = imported.conversations[0].messages[1];
  assert.equal(message.unsupported, true);
  assert.deepEqual(message.citations, citations);
  assert.equal(message.importedEvidence, true);
  assert.equal(message.ai.imported, true);
  assert.equal(message.ai.requestedModel, 'gpt-4.1-mini');
  assert.equal(message.sourceVerified, false);
  assert.notEqual(message.reviewedDialogue, true);
  assert.notEqual(message.canonicalSpokenText, true);
  assert.equal(message.groundingReview, undefined);
  for (const change of [
    value => { value.conversations[0].messages[1].citations[0].url = 'javascript:alert(1)'; },
    value => { value.conversations[0].messages[1].citations[0].url = 'https://user:password@example.org/reference'; },
    value => { value.conversations[0].messages[1].ai.requestedModel = 'gpt-astra-prohibited'; },
    value => { value.conversations[0].messages[1].ai.returnedModel = 'gpt-AsTrA-prohibited'; },
    value => { value.conversations[0].messages[1].ai.usage.completion_tokens = -1; }
  ]) {
    const invalid = structuredClone(backup);
    invalid.settings.dailyMinutes = 120;
    change(invalid);
    assert.equal((await app.request('/api/import', 'POST', invalid)).status, 400);
    assert.deepEqual((await app.request('/api/state')).body, imported);
  }
});

test('forbidden returned model IDs block answers without switching or retrying another model', async t => {
  const mock = providerMock({ returnedModel: 'gpt-astra-prohibited', reply: STUDY_SELECTOR });
  const app = await fixture(t, mock);
  await app.login();
  const conversation = (await app.request('/api/conversations', 'POST', { mode: 'coach' })).body;
  const request = { conversationId: conversation.id, content: 'Explain asthma management for board study.', requestId: 'forbidden-return' };
  const result = await app.request('/api/chat', 'POST', request);
  assert.equal(result.status, 200);
  assert.equal(result.body.message.unsupported, true);
  assert.equal(result.body.message.reviewedDialogue, undefined);
  assert.equal(result.body.message.ai, undefined);
  assert.equal(result.body.message.aiReview, undefined);
  assert.equal(result.body.message.aiTotal.calls, 1);
  assert.deepEqual(result.body.message.citations, []);
  assert.match(result.body.message.content, /could not complete the source check/);
  assert.equal((await app.request('/api/state')).body.conversations[0].messages.length, 2);
  assert.equal((await app.request('/api/status')).body.model, 'gpt-4.1-mini');
  assert.equal(mock.inferenceCalls().length, 1);
  assert.equal(JSON.stringify(result.body).includes(API_KEY), false);
  assert.equal((await app.request('/api/chat', 'POST', request)).body.message.id, result.body.message.id);
  assert.equal(mock.inferenceCalls().length, 1, 'A prohibited returned identity never triggers a second review, fallback model or replay inference.');
});

test('owner sign-in trims copied whitespace and issues a secure HTTPS proxy cookie while rejecting incorrect API-key tokens', async t => {
  const mock = providerMock();
  const app = await fixture(t, mock);
  assert.equal((await app.request('/api/state')).status, 401);
  const invalid = await app.login(API_KEY, { 'X-Forwarded-Proto': 'https' });
  assert.equal(invalid.status, 401);
  assert.equal(invalid.headers.get('set-cookie'), null);
  assert.match(invalid.body.error, /STUDY_ACCESS_TOKEN/);
  assert.match(invalid.body.error, /OpenAI API key is separate/);
  const valid = await app.login(` \n\t${ACCESS_TOKEN}\r\n `, { 'X-Forwarded-Proto': 'https' });
  assert.equal(valid.status, 200);
  assert.match(valid.headers.get('set-cookie'), /HttpOnly; SameSite=Strict;/);
  assert.match(valid.headers.get('set-cookie'), /; Secure$/);
  assert.equal((await app.request('/api/state')).status, 200);
  assert.equal(mock.calls.length, 0);
});

test('expired saved owner models keep sign-in and study data available until the owner selects an active model', async t => {
  const mock = providerMock();
  const first = await fixture(t, { ...mock, keepData: true });
  await first.login();
  const originalState = (await first.request('/api/state')).body;
  await new Promise(resolve => first.server.close(resolve));
  const database = new DatabaseSync(join(first.dataDir, 'studychat.sqlite'));
  database.prepare('INSERT INTO owner_ai_config(id,model) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET model=excluded.model').run('gpt-4-0314');
  database.close();
  const second = await fixture(t, { ...mock, dataDir: first.dataDir });
  const status = (await second.request('/api/status')).body;
  assert.equal(status.aiConfigured, false);
  assert.equal(status.model, 'gpt-4-0314');
  assert.equal(status.modelSelectionEnabled, true);
  assert.match(status.modelWarning, /shutdown date/);
  assert.equal((await second.login()).status, 200);
  assert.deepEqual((await second.request('/api/state')).body, originalState);
  assert.equal((await second.request('/api/export')).status, 200);
  const catalog = await second.request('/api/models');
  assert.equal(catalog.status, 200);
  assert.equal(catalog.body.models.some(model => model.id === 'gpt-4-0314'), false);
  assert.equal((await second.request('/api/model-test', 'POST', { requestId: 'expired-model-check' })).status, 503);
  const conversation = (await second.request('/api/conversations', 'POST', { mode: 'coach' })).body;
  const offline = await second.request('/api/chat', 'POST', { conversationId: conversation.id, content: 'Explain asthma inhaler technique for board study.' });
  assert.equal(offline.status, 200);
  assert.equal(offline.body.message.sourceVerified, true);
  assert.equal(offline.body.message.grounded, true);
  assert.equal(offline.body.message.current, true);
  assert.match(offline.body.message.content, /Mock management fact: review inhaler technique/);
  assert.equal(offline.body.message.ai, undefined, 'Local canonical study references need no available AI model.');
  assert.equal(mock.inferenceCalls().length, 0);
  assert.equal((await second.request('/api/model', 'PUT', { model: 'gpt-4.1-nano' })).status, 200);
  assert.equal((await second.request('/api/status')).body.aiConfigured, true);
  assert.equal((await second.request('/api/status')).body.modelWarning, null);
  const active = await second.request('/api/model-test', 'POST', { requestId: 'active-model-check' });
  assert.equal(active.status, 200);
  assert.equal(active.body.requestedModel, 'gpt-4.1-nano');
  assert.equal(mock.inferenceCalls().length, 1);
});

test('model checks reject stale selections after an awaited catalog without spending on the previously captured model', async t => {
  let releaseCatalog;
  let markCatalogStarted;
  const catalogStarted = new Promise(resolve => { markCatalogStarted = resolve; });
  const catalogPending = new Promise(resolve => { releaseCatalog = resolve; });
  const mock = providerMock();
  const fetchImpl = async (url, options) => {
    if (url.endsWith('/models')) {
      markCatalogStarted();
      await catalogPending;
    }
    return mock.fetchImpl(url, options);
  };
  const app = await fixture(t, { fetchImpl });
  t.after(() => releaseCatalog());
  await app.login();
  const selecting = app.request('/api/model', 'PUT', { model: 'gpt-4.1-nano' });
  await catalogStarted;
  const incoming = once(app.server, 'request');
  const staleCheck = app.request('/api/model-test', 'POST', { requestId: 'stale-model-check' });
  const [request] = await incoming;
  if (!request.readableEnded) await once(request, 'end');
  await new Promise(resolve => setImmediate(resolve));
  releaseCatalog();
  assert.equal((await selecting).status, 200);
  const stale = await staleCheck;
  assert.equal(stale.status, 409);
  assert.match(stale.body.error, /selected model changed/);
  assert.equal((await app.request('/api/status')).body.model, 'gpt-4.1-nano');
  assert.equal(mock.modelCalls().length, 1);
  assert.equal(mock.inferenceCalls().length, 0);
  assert.equal((await app.request('/api/model-results')).body.results.length, 0);
});

test('failed READY instructions remain request-idempotent while new check requests may retry and passing checks are reused', async t => {
  let inferenceCount = 0;
  const mock = providerMock({ inference: async ({ body }) => {
    inferenceCount += 1;
    return Response.json({ model: body.model, choices: [{ message: { content: inferenceCount === 1 ? 'NOT READY' : 'READY' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 100 } });
  } });
  const app = await fixture(t, mock);
  await app.login();
  const failedInstruction = await app.request('/api/model-test', 'POST', { requestId: 'instruction-check-failed' });
  assert.equal(failedInstruction.status, 200);
  assert.equal(failedInstruction.body.connectionPassed, true);
  assert.equal(failedInstruction.body.instructionPassed, false);
  assert.equal(failedInstruction.body.cached, false);
  const sameRequest = await app.request('/api/model-test', 'POST', { requestId: 'instruction-check-failed' });
  assert.equal(sameRequest.status, 200);
  assert.equal(sameRequest.body.cached, true);
  assert.equal(sameRequest.body.instructionPassed, false);
  assert.equal(mock.inferenceCalls().length, 1);
  const retry = await app.request('/api/model-test', 'POST', { requestId: 'instruction-check-retry' });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.cached, false);
  assert.equal(retry.body.instructionPassed, true);
  assert.equal(mock.inferenceCalls().length, 2);
  const passedReplay = await app.request('/api/model-test', 'POST', { requestId: 'instruction-check-passed-reuse' });
  assert.equal(passedReplay.status, 200);
  assert.equal(passedReplay.body.cached, true);
  assert.equal(passedReplay.body.instructionPassed, true);
  assert.equal(passedReplay.body.recordedAt, retry.body.recordedAt);
  assert.equal(mock.inferenceCalls().length, 2);
  assert.equal((await app.request('/api/model-results')).body.results.length, 2);
});
