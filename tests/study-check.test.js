import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudyCurriculum } from '../server/study-curriculum.js';
import { studyCondition, STUDY_NOW } from './fixtures/study-condition.js';
import { runStudySourceCheck, STUDY_SOURCE_CHECK_CONDITION, STUDY_SOURCE_CHECK_QUERY, STUDY_SOURCE_CHECK_REQUEST_ID, STUDY_SOURCE_CHECK_TITLE } from '../server/study-check.js';

const BASE = 'http://127.0.0.1:3000/';
const TOKEN = 'mock-owner-token-private-and-not-for-logging';
const OPENAI_KEY = 'mock-openai-key-private-and-not-for-logging';
const COOKIE = 'studychat_session=mock-session-private';
const ENV = { APP_MODE: 'personal', AI_PROVIDER: 'openai', OPENAI_MODEL: 'gpt-4.1-mini', OPENAI_API_KEY: OPENAI_KEY, STUDY_ACCESS_TOKEN: TOKEN, STUDY_INITIAL_SOURCE_CHECK: 'source-v1', INGENIUM_TELEMETRY_KEY: 'mock-telemetry-key-private', INGENIUM_TELEMETRY_ORGANIZATION_ID: 'mock-organization' };
const STATUS = { aiConfigured: true, providerId: 'openai', model: 'gpt-4.1-mini' };

function fixture() {
  const record = studyCondition({ id: STUDY_SOURCE_CHECK_CONDITION, name: 'Atrial fibrillation', aliases: ['AF'], domain: 'chronic' });
  record.sections[0].id = 'risk';
  record.sections[1].id = 'drug';
  record.sections[2].id = 'aspirin';
  record.sections[0].text = 'Mock AF stroke-risk assessment teaching fact for a synthetic test only.';
  record.sections[1].text = 'Mock AF anticoagulation teaching fact for a synthetic test only.';
  record.questions.forEach(question => { question.sectionIds = ['drug']; });
  const curriculum = createStudyCurriculum({ records: [record], now: STUDY_NOW });
  const evidence = curriculum.retrieve(STUDY_SOURCE_CHECK_QUERY, { conditionIds: [STUDY_SOURCE_CHECK_CONDITION] });
  const chunkIds = ['atrial-fibrillation:risk', 'atrial-fibrillation:drug'];
  const rendered = curriculum.render({ chunkIds, questionId: null, unsupported: false }, evidence);
  const user = { id: 'probe-user', role: 'user', content: STUDY_SOURCE_CHECK_QUERY, requestId: STUDY_SOURCE_CHECK_REQUEST_ID, studyRequestedConditionIds: [STUDY_SOURCE_CHECK_CONDITION], studyConditionIds: [STUDY_SOURCE_CHECK_CONDITION] };
  const message = { id: 'probe-answer', role: 'assistant', responseTo: user.id, ...rendered, studySelection: { chunkIds }, ai: { provider: 'openai', requestedModel: 'gpt-4.1-mini', returnedModel: 'gpt-4.1-mini-2025-04-14', usage: { prompt_tokens: 1200, completion_tokens: 55 }, estimatedCostUsd: .000568, unusedSecret: OPENAI_KEY } };
  const conversation = { id: 'probe-conversation', title: STUDY_SOURCE_CHECK_TITLE, mode: 'coach', curriculumConditionId: STUDY_SOURCE_CHECK_CONDITION, messages: [user, message] };
  return { curriculum, user, message, conversation };
}
function harness({ state = { conversations: [] }, status = STATUS, response, chatFailure, cookie = COOKIE } = {}) {
  const data = fixture();
  const requests = [];
  let flushes = 0;
  const fetchImpl = async (url, options) => {
    assert.equal(url.origin, new URL(BASE).origin);
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    const body = options.body === undefined ? undefined : JSON.parse(options.body);
    requests.push({ path: url.pathname, body, method: options.method });
    if (url.pathname === '/api/status') return Response.json(status);
    if (url.pathname === '/api/login') {
      assert.deepEqual(body, { token: TOKEN });
      assert.equal(options.headers.Cookie, undefined);
      return Response.json({ authenticated: true }, { headers: { 'Set-Cookie': `${cookie}; HttpOnly; SameSite=Strict` } });
    }
    assert.equal(options.headers.Cookie, cookie);
    if (url.pathname === '/api/state') return Response.json(state);
    if (url.pathname === '/api/conversations') {
      assert.deepEqual(body, { title: STUDY_SOURCE_CHECK_TITLE, mode: 'coach', conditionId: STUDY_SOURCE_CHECK_CONDITION });
      return Response.json({ id: 'probe-conversation' }, { status: 201 });
    }
    if (url.pathname === '/api/chat') {
      assert.deepEqual(body, { conversationId: 'probe-conversation', content: STUDY_SOURCE_CHECK_QUERY, conditionIds: [STUDY_SOURCE_CHECK_CONDITION], requestId: STUDY_SOURCE_CHECK_REQUEST_ID });
      if (chatFailure) return chatFailure();
      return response || Response.json({ message: data.message, unusedSecret: TOKEN });
    }
    if (url.pathname === '/api/ingenium-status') return Response.json({ delivered: 2, pending: 0, unusedSecret: ENV.INGENIUM_TELEMETRY_KEY });
    assert.equal(url.pathname, '/api/logout');
    assert.deepEqual(body, {});
    return Response.json({ authenticated: false });
  };
  return { ...data, requests, fetchImpl, flushTelemetry: async () => { flushes++; }, flushCount: () => flushes };
}
const invoke = (mock, env = ENV) => runStudySourceCheck({ baseUrl: BASE, env, fetchImpl: mock.fetchImpl, flushTelemetry: mock.flushTelemetry, curriculum: mock.curriculum });

test('source check is disabled by default and blocks nonpersonal/nonOpenAI/credential-less configurations without requests', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error('Inactive checks must not issue requests.'); };
  for (const env of [{}, { ...ENV, STUDY_INITIAL_SOURCE_CHECK: '' }, { ...ENV, APP_MODE: 'commercial' }, { ...ENV, AI_PROVIDER: 'anthropic' }, { ...ENV, OPENAI_API_KEY: '' }, { ...ENV, STUDY_ACCESS_TOKEN: '' }]) {
    const result = await runStudySourceCheck({ baseUrl: BASE, env, fetchImpl });
    assert.equal(result.skipped, true);
  }
  assert.equal(calls, 0);
});

test('source check never sends credentials to a remote, redirected, or malformed listener', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error('Unsafe listeners must not issue requests.'); };
  for (const baseUrl of ['https://127.0.0.1:3000/', 'http://example.com/', 'http://localhost:3000/', 'http://127.0.0.1:3000/path', 'http://127.0.0.1:3000/?remote=true', 'http://127.0.0.1:3000/#remote', 'http://user:secret@127.0.0.1:3000/']) {
    await assert.rejects(runStudySourceCheck({ baseUrl, env: ENV, fetchImpl }), /local app listener/);
  }
  assert.equal(calls, 0);
});

test('inactive or different selected models stop before authentication or paid inference', async () => {
  for (const status of [{ ...STATUS, aiConfigured: false }, { ...STATUS, providerId: 'anthropic' }, { ...STATUS, model: 'gpt-4.1-nano' }, { ...STATUS, model: 'Astra' }]) {
    const mock = harness({ status });
    assert.deepEqual(await invoke(mock), { skipped: true, reason: 'baseline_model_not_active' });
    assert.deepEqual(mock.requests.map(request => request.path), ['/api/status']);
    assert.equal(mock.flushCount(), 0);
  }
});

test('fresh check sends one fixed synthetic source request, validates canonical text/citations, flushes and logs out without leaking secrets', async () => {
  const mock = harness();
  const result = await invoke(mock);
  assert.deepEqual(result, { authenticated: true, sourcePassed: true, canonicalPassed: true, citationPassed: true, currentSourcePassed: true, selectorMarkerPassed: true, relevantSourcePassed: true, cached: false, uncertain: false, provider: 'openai', requestedModel: 'gpt-4.1-mini', returnedModel: 'gpt-4.1-mini-2025-04-14', inputTokens: 1200, outputTokens: 55, estimatedCostUsd: .000568, telemetryFlushed: true, delivered: 2, pending: 0, logoutAttempted: true });
  assert.deepEqual(mock.requests.map(request => request.path), ['/api/status', '/api/login', '/api/state', '/api/conversations', '/api/chat', '/api/ingenium-status', '/api/logout']);
  assert.equal(mock.requests.filter(request => request.path === '/api/chat').length, 1);
  assert.equal(mock.flushCount(), 1);
  for (const secret of [TOKEN, OPENAI_KEY, COOKIE, ENV.INGENIUM_TELEMETRY_KEY, STUDY_SOURCE_CHECK_QUERY, mock.message.content]) assert.equal(JSON.stringify(result).includes(secret), false);
});

test('an existing complete request validates from durable history without another model call', async () => {
  const { conversation } = fixture();
  const mock = harness({ state: { conversations: [conversation] } });
  const result = await invoke(mock);
  assert.equal(result.cached, true);
  assert.equal(result.sourcePassed, true);
  assert.equal(result.relevantSourcePassed, true);
  assert.deepEqual(mock.requests.map(request => request.path), ['/api/status', '/api/login', '/api/state', '/api/ingenium-status', '/api/logout']);
});

test('a valid canonical response selecting the wrong or incomplete sections fails the narrow study-source relevance check', async () => {
  const { curriculum, conversation, message } = fixture();
  const evidence = curriculum.retrieve(STUDY_SOURCE_CHECK_QUERY, { conditionIds: [STUDY_SOURCE_CHECK_CONDITION] });
  for (const chunkIds of [['atrial-fibrillation:aspirin'], ['atrial-fibrillation:risk'], ['atrial-fibrillation:drug']]) {
    const rendered = curriculum.render({ chunkIds, questionId: null, unsupported: false }, evidence);
    const reply = { ...message, ...rendered, studySelection: { chunkIds } };
    const mock = harness({ state: { conversations: [{ ...conversation, messages: [conversation.messages[0], reply] }] } });
    const result = await invoke(mock);
    assert.equal(result.canonicalPassed, true);
    assert.equal(result.citationPassed, true);
    assert.equal(result.currentSourcePassed, true);
    assert.equal(result.selectorMarkerPassed, true);
    assert.equal(result.relevantSourcePassed, false);
    assert.equal(result.sourcePassed, false);
    assert.equal(result.failed, true);
    assert.equal(result.stage, 'source_relevance');
    assert.equal(result.cached, true);
    assert.equal(mock.requests.some(request => request.path === '/api/chat'), false);
  }
});

test('uncertain pending, duplicated, conflicting or reused requests are never retried', async () => {
  const { conversation, user } = fixture();
  const scenarios = [
    [{ ...conversation, messages: [user] }],
    [conversation, { ...conversation, id: 'duplicate-conversation' }],
    [{ ...conversation, messages: [{ ...user, content: 'Changed private text' }] }],
    [{ ...conversation, messages: [{ ...user, studyRequestedConditionIds: ['hypertension'] }] }],
    [{ ...conversation, messages: [{ role: 'user', content: 'Unrelated old probe' }] }],
    [{ ...conversation, messages: [] }, { ...conversation, id: 'duplicate-probe', messages: [] }]
  ];
  for (const conversations of scenarios) {
    const mock = harness({ state: { conversations } });
    const result = await invoke(mock);
    assert.equal(result.failed, true);
    assert.equal(result.uncertain, true);
    assert.ok(mock.requests.every(request => !['/api/chat', '/api/conversations'].includes(request.path)));
    assert.equal(mock.requests.at(-1).path, '/api/logout');
  }
});

test('model prose, fabricated citations, wrong source markers, imported responses and wrong model metadata fail exact validation', async () => {
  const { message, conversation } = fixture();
  const wrongMessages = [
    { ...message, content: `${message.content}\nInvented model detail.` },
    { ...message, citations: [{ ...message.citations[0], url: 'https://example.com/fabrication' }] },
    { ...message, studySelection: { chunkIds: ['unknown:chunk'] } },
    { ...message, studySelection: { chunkIds: [message.studySelection.chunkIds[0], message.studySelection.chunkIds[0]] } },
    { ...message, studySelection: { chunkIds: message.studySelection.chunkIds, trusted: true } },
    { ...message, importedEvidence: true },
    { ...message, current: false },
    { ...message, humanReview: true },
    { ...message, ai: { ...message.ai, requestedModel: 'gpt-4.1-nano' } },
    { ...message, ai: { ...message.ai, returnedModel: 'Astra' } },
    { ...message, ai: { ...message.ai, imported: true } }
  ];
  for (const reply of wrongMessages) {
    const mock = harness({ state: { conversations: [{ ...conversation, messages: [conversation.messages[0], reply] }] } });
    const result = await invoke(mock);
    assert.equal(result.sourcePassed, false);
    assert.equal(result.failed, true);
    assert.equal(result.stage, 'canonical_validation');
    assert.equal(result.cached, true);
    assert.equal(mock.requests.some(request => request.path === '/api/chat'), false);
    assert.equal(JSON.stringify(result).includes('Astra'), false);
  }
});

test('current-source eligibility is required before login or inference', async () => {
  const mock = harness();
  const expired = createStudyCurriculum({ records: [studyCondition({ id: STUDY_SOURCE_CHECK_CONDITION, name: 'Atrial fibrillation' })], now: Date.parse('2026-11-09T00:00:00Z') });
  const result = await runStudySourceCheck({ baseUrl: BASE, env: ENV, fetchImpl: mock.fetchImpl, curriculum: expired });
  assert.deepEqual(result, { failed: true, stage: 'current_references' });
  assert.deepEqual(mock.requests.map(request => request.path), ['/api/status']);
});

test('paid request errors or interruptions return uncertain safe receipts, never retry and still flush/logout', async () => {
  for (const chatFailure of [() => Response.json({ error: `Private ${OPENAI_KEY}` }, { status: 503 }), () => { throw new Error(`Private ${TOKEN}`); }]) {
    const mock = harness({ chatFailure });
    const result = await invoke(mock);
    assert.equal(result.failed, true);
    assert.equal(result.uncertain, true);
    assert.equal(result.cached, false);
    assert.equal(mock.requests.filter(request => request.path === '/api/chat').length, 1);
    assert.equal(mock.requests.at(-1).path, '/api/logout');
    assert.equal(mock.flushCount(), 1);
    assert.equal(JSON.stringify(result).includes(TOKEN), false);
    assert.equal(JSON.stringify(result).includes(OPENAI_KEY), false);
  }
});

test('a restart after an interrupted request sees its durable user marker and does not repeat inference', async () => {
  const { conversation, user } = fixture();
  const persisted = { conversations: [] };
  const first = harness({ state: persisted, chatFailure: () => { persisted.conversations.push({ ...conversation, messages: [user] }); throw new Error('Simulated process interruption after request persisted'); } });
  assert.equal((await invoke(first)).uncertain, true);
  const restarted = harness({ state: persisted });
  const result = await invoke(restarted);
  assert.equal(result.uncertain, true);
  assert.equal(result.stage, 'saved_request_without_reply');
  assert.equal(first.requests.filter(request => request.path === '/api/chat').length + restarted.requests.filter(request => request.path === '/api/chat').length, 1);
});

test('metadata and telemetry summaries whitelist bounded values and tolerate delivery failures', async () => {
  const { message, conversation } = fixture();
  const reply = { ...message, ai: { ...message.ai, usage: { prompt_tokens: OPENAI_KEY, completion_tokens: 999999999 }, estimatedCostUsd: -2 } };
  const mock = harness({ state: { conversations: [{ ...conversation, messages: [conversation.messages[0], reply] }] } });
  const result = await runStudySourceCheck({ baseUrl: BASE, env: ENV, fetchImpl: mock.fetchImpl, curriculum: mock.curriculum, flushTelemetry: async () => { throw new Error(`Private ${ENV.INGENIUM_TELEMETRY_KEY}`); } });
  assert.equal(result.sourcePassed, true);
  assert.equal(result.inputTokens, null);
  assert.equal(result.outputTokens, null);
  assert.equal(result.estimatedCostUsd, null);
  assert.equal(result.telemetryFlushed, false);
  assert.equal(result.logoutAttempted, true);
  assert.equal(mock.requests.at(-1).path, '/api/logout');
  assert.equal(JSON.stringify(result).includes(ENV.INGENIUM_TELEMETRY_KEY), false);
});
