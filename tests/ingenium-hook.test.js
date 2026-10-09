import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createAiProvider, AiProviderError } from '../server/ai-provider.js';
import { createApp } from '../server/index.js';
import { createStudyCurriculum } from '../server/study-curriculum.js';
import { studyCondition, STUDY_NOW } from './fixtures/study-condition.js';
import { INGENIUM_TELEMETRY_ENDPOINT } from '../server/ingenium-telemetry.js';

// Tests use only synthetic local fetch replacements. Never send study content
// or credentials to a real provider or metadata receiver.
const MODEL = 'gpt-4.1-mini';
const MODEL_TWO = 'gpt-6-luna';
const PROVIDER_KEY = 'mock-provider-key-private-marker';
const ACCESS_TOKEN = 'mock-owner-access-code-private-at-least-24';
const INGEST_KEY = `ia_${'x'.repeat(43)}`;
const ORGANIZATION = '11111111-2222-4333-8444-555555555555';
const PROMPT = 'Private prompt marker: synthetic recall study question.';
const ANSWER = 'Private answer marker: choose a recall concept.';
const STUDY_QUERY = 'Private prompt marker: explain asthma management for board study.';
const MANAGEMENT_FACT = studyCondition().sections.find(section => section.id === 'management').text;
const messages = [{ role: 'system', content: 'Private system instructions marker.' }, { role: 'user', content: PROMPT }];
const reply = (model = MODEL, content = ANSWER, overrides = {}) => ({ model, choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20 }, ...overrides });
const metadataKeys = ['provider', 'requestedModel', 'returnedModel', 'endpoint', 'usage', 'estimatedCostUsd', 'latencyMs', 'pricingBasis', 'recordedAt'].sort();

function naturalContent(body) {
  const schema = body.response_format?.json_schema?.name || (body.messages.some(message => message.content.includes('NATURAL_REVIEW_DATA')) ? 'family_medicine_natural_review' : body.messages.some(message => message.content.includes('NATURAL_TUTOR_CONTEXT')) ? 'family_medicine_natural_tutor' : null);
  assert.ok(['family_medicine_natural_tutor', 'family_medicine_natural_review'].includes(schema), `Unexpected generated contract ${schema}`);
  assert.ok(body.messages.some(message => message.content.includes(schema === 'family_medicine_natural_review' ? 'NATURAL_REVIEW_DATA' : 'NATURAL_TUTOR_CONTEXT')));
  return JSON.stringify(schema === 'family_medicine_natural_review'
    ? { approved: true, segments: [{ id: 's1', approved: true, externalFactCount: 1, claims: [{ quote: MANAGEMENT_FACT, type: 'medical', sourceChunkIds: ['asthma:management'], supports: [{ chunkId: 'asthma:management', excerpt: MANAGEMENT_FACT }] }], flags: [] }] }
    : { segments: [{ id: 's1', text: MANAGEMENT_FACT, sourceChunkIds: ['asthma:management'] }] });
}

test('successful adapter completion invokes a metadata-only hook while the default browser contract stays unchanged', async () => {
  let upstreamCalls = 0;
  const observed = [];
  const provider = createAiProvider({ env: { OPENAI_API_KEY: PROVIDER_KEY, OPENAI_MODEL: MODEL }, onCompletion: metadata => observed.push(metadata), fetchImpl: async () => {
    upstreamCalls++;
    return Response.json({ ...reply(), privateProviderField: 'Private provider extension marker.' });
  } });
  const result = await provider.complete(messages);
  assert.deepEqual(result, { content: ANSWER, usage: { prompt_tokens: 100, completion_tokens: 20 } });
  assert.equal(upstreamCalls, 1);
  assert.equal(observed.length, 1);
  assert.deepEqual(Object.keys(observed[0]).sort(), metadataKeys);
  assert.equal(observed[0].requestedModel, MODEL);
  assert.equal(observed[0].returnedModel, MODEL);
  assert.equal(observed[0].endpoint, 'chat');
  assert.equal(observed[0].estimatedCostUsd, .000072);
  assert.ok(observed[0].latencyMs >= 0);
  assert.doesNotMatch(JSON.stringify(observed), /Private|mock-provider-key|system instructions|prompt marker|answer marker/);
});

test('a throwing or rejecting completion hook preserves the paid answer and makes no provider retry', async () => {
  for (const callback of [() => { throw new Error('Private callback failure marker.'); }, async () => { throw new Error('Private rejected callback marker.'); }]) {
    let upstreamCalls = 0;
    const provider = createAiProvider({ env: { OPENAI_API_KEY: PROVIDER_KEY }, onCompletion: callback, fetchImpl: async () => { upstreamCalls++; return Response.json(reply()); } });
    const result = await provider.complete(messages, { includeMetadata: true });
    assert.equal(result.content, ANSWER);
    assert.equal(result.metadata.requestedModel, MODEL);
    assert.equal(upstreamCalls, 1);
  }
});

test('refused and mismatched-model answers never invoke the successful-completion observer', async () => {
  for (const [payload, status] of [[reply(MODEL, ANSWER, { choices: [{ message: { refusal: 'Private refusal marker.' }, finish_reason: 'stop' }] }), 422], [reply(MODEL_TWO), 502]]) {
    let upstreamCalls = 0, observed = 0;
    const provider = createAiProvider({ env: { OPENAI_API_KEY: PROVIDER_KEY }, onCompletion: () => { observed++; }, fetchImpl: async () => { upstreamCalls++; return Response.json(payload); } });
    await assert.rejects(provider.complete(messages), error => error instanceof AiProviderError && error.status === status);
    assert.equal(upstreamCalls, 1);
    assert.equal(observed, 0);
  }
});

test('inactive optional Claude adapter also projects metadata without prompt, answer or thinking content', async () => {
  const observed = [];
  let upstreamCalls = 0;
  const provider = createAiProvider({ env: { AI_PROVIDER: 'anthropic', CLAUDE_API_KEY: PROVIDER_KEY }, onCompletion: metadata => observed.push(metadata), fetchImpl: async () => {
    upstreamCalls++;
    return Response.json({ model: 'claude-haiku-5-5', content: [{ type: 'thinking', thinking: 'Private thinking marker.' }, { type: 'text', text: ANSWER }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 20 } });
  } });
  assert.equal((await provider.complete(messages)).content, ANSWER);
  assert.equal(upstreamCalls, 1);
  assert.equal(observed.length, 1);
  assert.deepEqual(Object.keys(observed[0]).sort(), metadataKeys);
  assert.equal(observed[0].provider, 'anthropic');
  assert.equal(observed[0].endpoint, 'messages');
  assert.doesNotMatch(JSON.stringify(observed), /Private|mock-provider-key/);
});

async function fixture(t, { telemetryFails = false } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'studychat-ingenium-hook-'));
  const providerCalls = [], events = [], catalogCalls = [];
  const curriculum = createStudyCurriculum({ records: [studyCondition()], now: () => STUDY_NOW });
  const foundations = createStudyCurriculum({ records: [], now: () => STUDY_NOW });
  const server = createApp({ dataDir, curriculum, foundations, env: { STUDY_ACCESS_TOKEN: ACCESS_TOKEN, AI_PROVIDER: 'openai', OPENAI_API_KEY: PROVIDER_KEY, INGENIUM_TELEMETRY_KEY: INGEST_KEY, INGENIUM_TELEMETRY_ORGANIZATION_ID: ORGANIZATION }, fetchImpl: async (url, options) => {
    if (url === INGENIUM_TELEMETRY_ENDPOINT) {
      assert.equal(options.method, 'POST');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers['x-ingenium-key'], INGEST_KEY);
      assert.equal(options.headers['x-ingenium-organization'], ORGANIZATION);
      events.push(JSON.parse(options.body));
      if (telemetryFails) throw new Error(`Private receiver failure marker ${INGEST_KEY}`);
      return Response.json({ accepted: true });
    }
    if (url === 'https://api.openai.com/v1/models') {
      catalogCalls.push(url);
      return Response.json({ data: [{ id: MODEL }, { id: MODEL_TWO }] });
    }
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(options.headers.Authorization, `Bearer ${PROVIDER_KEY}`);
    const body = JSON.parse(options.body);
    providerCalls.push(body);
    const isCheck = body.messages.some(message => message.content.includes('exactly READY'));
    return Response.json(reply(body.model, isCheck ? 'READY' : naturalContent(body)));
  } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  let cookie;
  t.after(async () => { if (server.listening) await new Promise(resolve => server.close(resolve)); rmSync(dataDir, { recursive: true, force: true }); });
  async function request(path, method = 'GET', body) {
    const response = await fetch(baseUrl + path, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return { status: response.status, body: await response.json() };
  }
  assert.equal((await request('/api/login', 'POST', { token: ACCESS_TOKEN })).status, 200);
  const conversation = (await request('/api/conversations', 'POST', { mode: 'coach' })).body;
  return { request, conversation, providerCalls, events, catalogCalls, server, dataDir };
}

function assertEventHasNoStudyContent(event) {
  assert.deepEqual(Object.keys(event).sort(), ['requestId', 'provider', 'requestedModel', 'returnedModel', 'endpoint', 'latencyMs', 'inputTokens', 'outputTokens', 'estimatedCostUsd', 'occurredAt', 'source'].sort());
  assert.match(event.requestId, /^[0-9a-f-]{36}$/i);
  assert.equal(event.source, 'app_observed');
  assert.equal(event.inputTokens, 100);
  assert.equal(event.outputTokens, 20);
  assert.doesNotMatch(JSON.stringify(event), /Private|mock-provider-key|mock-owner-access|ia_x+|Mock management fact|asthma|inhaler/);
}

function assertReviewedReply(result) {
  assert.match(result.body.message.content, /Mock management fact: review inhaler technique/);
  assert.equal(result.body.message.sourceVerified, false);
  assert.equal(result.body.message.curriculum, undefined);
  assert.equal(result.body.message.reviewedDialogue, true);
  assert.equal(result.body.message.groundingReview.status, 'passed');
  assert.equal(result.body.message.groundingReview.medicalClaimCount, 1);
  assert.equal(result.body.message.aiTotal.calls, 2);
  assert.equal(result.body.message.ai.provider, 'openai');
  assert.equal(result.body.message.aiReview.provider, 'openai');
  assert.equal(result.body.message.citations[0].url, 'https://www.nhlbi.nih.gov/health/asthma');
  assert.equal(result.body.message.humanReview, false);
}

test('real app provider wiring emits one bounded metadata event per completed request and replays produce none', async t => {
  const app = await fixture(t);
  const chatRequest = { conversationId: app.conversation.id, content: STUDY_QUERY, requestId: 'wiring-chat-once' };
  const first = await app.request('/api/chat', 'POST', chatRequest);
  assert.equal(first.status, 200);
  assertReviewedReply(first);
  await app.server.flushIngeniumTelemetry();
  assert.equal(app.providerCalls.length, 2);
  assert.equal(app.events.length, 2);
  for (const event of app.events) { assertEventHasNoStudyContent(event); assert.equal(event.requestedModel, MODEL); }
  assert.notEqual(app.events[0].requestId, app.events[1].requestId);
  assert.equal((await app.request('/api/chat', 'POST', chatRequest)).body.message.id, first.body.message.id);
  assert.equal(app.providerCalls.length, 2);
  assert.equal(app.events.length, 2);
  const check = await app.request('/api/model-test', 'POST', { requestId: 'wiring-model-check-once' });
  assert.equal(check.status, 200);
  assert.equal(check.body.instructionPassed, true);
  await app.server.flushIngeniumTelemetry();
  assert.equal(app.providerCalls.length, 3);
  assert.equal(app.events.length, 3);
  assertEventHasNoStudyContent(app.events[2]);
  assert.equal(new Set(app.events.map(event => event.requestId)).size, 3);
  assert.equal((await app.request('/api/model-test', 'POST', { requestId: 'wiring-model-check-new-id' })).body.cached, true);
  assert.equal(app.providerCalls.length, 3);
  assert.equal(app.events.length, 3);
  assert.equal(app.catalogCalls.length, 1);
});

test('metadata receiver failure preserves the app answer and all exposed status excludes private credentials', async t => {
  const app = await fixture(t, { telemetryFails: true });
  const completed = await app.request('/api/chat', 'POST', { conversationId: app.conversation.id, content: STUDY_QUERY, requestId: 'receiver-failure-once' });
  assert.equal(completed.status, 200);
  assertReviewedReply(completed);
  await app.server.flushIngeniumTelemetry();
  assert.equal(app.providerCalls.length, 2);
  assert.ok(app.events.length >= 1);
  for (const event of app.events) assertEventHasNoStudyContent(event);
  const pending = await app.request('/api/ingenium-status');
  assert.equal(pending.body.pending, 2);
  assert.equal(pending.body.delivered, 0);
  const status = await app.request('/api/status');
  assert.equal(status.status, 200);
  assert.equal(status.body.authenticated, true);
  assert.doesNotMatch(JSON.stringify(status.body), /mock-provider-key|mock-owner-access|ia_x+|Private receiver/);
});

test('selecting an owner model retains the metadata observer and reports the selected identity', async t => {
  const app = await fixture(t);
  assert.equal((await app.request('/api/model', 'PUT', { model: MODEL_TWO })).status, 200);
  const completed = await app.request('/api/chat', 'POST', { conversationId: app.conversation.id, content: STUDY_QUERY, requestId: 'selected-model-observer' });
  assert.equal(completed.status, 200);
  assertReviewedReply(completed);
  assert.equal(completed.body.message.ai.requestedModel, MODEL_TWO);
  assert.equal(completed.body.message.aiReview.requestedModel, MODEL_TWO);
  await app.server.flushIngeniumTelemetry();
  assert.equal(app.providerCalls.length, 2);
  assert.equal(app.events.length, 2);
  for (const event of app.events) {
    assertEventHasNoStudyContent(event);
    assert.equal(event.requestedModel, MODEL_TWO);
    assert.equal(event.returnedModel, MODEL_TWO);
  }
});

test('durable metadata outbox survives restart and retries the same event UUID without another provider inference', async t => {
  const dataDir = mkdtempSync(join(tmpdir(), 'studychat-ingenium-restart-'));
  const env = { STUDY_ACCESS_TOKEN: ACCESS_TOKEN, AI_PROVIDER: 'openai', OPENAI_API_KEY: PROVIDER_KEY, INGENIUM_TELEMETRY_KEY: INGEST_KEY, INGENIUM_TELEMETRY_ORGANIZATION_ID: ORGANIZATION };
  const events = [], servers = [];
  let receiverAvailable = false, providerCalls = 0;
  const fetchImpl = async (url, options) => {
    if (url === INGENIUM_TELEMETRY_ENDPOINT) {
      events.push(JSON.parse(options.body));
      return Response.json({ accepted: receiverAvailable }, { status: receiverAvailable ? 200 : 503 });
    }
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    providerCalls++;
    const body = JSON.parse(options.body);
    return Response.json(reply(body.model, naturalContent(body)));
  };
  t.after(async () => {
    for (const server of servers) if (server.listening) await new Promise(resolve => server.close(resolve));
    rmSync(dataDir, { recursive: true, force: true });
  });
  async function start() {
    const curriculum = createStudyCurriculum({ records: [studyCondition()], now: () => STUDY_NOW });
    const foundations = createStudyCurriculum({ records: [], now: () => STUDY_NOW });
    const server = createApp({ dataDir, env, curriculum, foundations, fetchImpl });
    servers.push(server);
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    let cookie;
    async function request(path, method = 'GET', body) {
      const response = await fetch(baseUrl + path, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
      return { status: response.status, body: await response.json() };
    }
    return { server, request };
  }
  const first = await start();
  assert.equal((await first.request('/api/ingenium-status')).status, 401);
  assert.equal((await first.request('/api/login', 'POST', { token: ACCESS_TOKEN })).status, 200);
  const conversation = (await first.request('/api/conversations', 'POST', { mode: 'coach' })).body;
  const chatRequest = { conversationId: conversation.id, content: STUDY_QUERY, requestId: 'durable-single-inference' };
  const completed = await first.request('/api/chat', 'POST', chatRequest);
  assert.equal(completed.status, 200);
  assertReviewedReply(completed);
  await first.server.flushIngeniumTelemetry();
  assert.equal(providerCalls, 2);
  assert.ok(events.length >= 1);
  assert.equal(new Set(events.map(event => event.requestId)).size, 1);
  const eventId = events[0].requestId;
  const pending = (await first.request('/api/ingenium-status')).body;
  assert.equal(pending.pending, 2);
  assert.equal(pending.delivered, 0);
  assert.equal(pending.lastResult.reason, 'delivery_failed');
  assert.doesNotMatch(JSON.stringify(pending), /mock-provider-key|mock-owner-access|ia_x+|Private/);
  const database = new DatabaseSync(join(dataDir, 'studychat.sqlite'));
  const stored = database.prepare('SELECT request_id,metadata,status FROM owner_telemetry_outbox').all();
  database.close();
  assert.equal(stored.length, 2);
  assert.ok(stored.some(row => row.request_id === eventId));
  for (const row of stored) {
    assert.equal(row.status, 'pending');
    assert.doesNotMatch(row.metadata, /Private|mock-provider-key|mock-owner-access|ia_x+|Mock management fact|asthma|inhaler/);
  }
  await new Promise(resolve => first.server.close(resolve));
  const attemptsBeforeRestart = events.length;
  receiverAvailable = true;
  const restarted = await start();
  await restarted.server.flushIngeniumTelemetry();
  assert.equal(events.length, attemptsBeforeRestart + 2);
  assert.deepEqual(new Set(events.slice(attemptsBeforeRestart).map(event => event.requestId)), new Set(stored.map(row => row.request_id)));
  assert.deepEqual(events.slice(attemptsBeforeRestart).find(event => event.requestId === eventId), events[0]);
  assert.equal(providerCalls, 2);
  assert.equal((await restarted.request('/api/ingenium-status')).status, 401);
  assert.equal((await restarted.request('/api/login', 'POST', { token: ACCESS_TOKEN })).status, 200);
  const delivered = (await restarted.request('/api/ingenium-status')).body;
  assert.equal(delivered.pending, 0);
  assert.equal(delivered.delivered, 2);
  assert.equal(delivered.lastResult.accepted, true);
  assert.doesNotMatch(JSON.stringify(delivered), /mock-provider-key|mock-owner-access|ia_x+|Private/);
  assert.equal((await restarted.request('/api/chat', 'POST', chatRequest)).body.message.id, completed.body.message.id);
  await restarted.server.flushIngeniumTelemetry();
  assert.equal(providerCalls, 2);
  assert.equal(events.length, attemptsBeforeRestart + 2);
});

test('a full metadata outbox stays capped at 500 pending events while the app preserves its paid answer', async t => {
  const app = await fixture(t, { telemetryFails: true });
  const database = new DatabaseSync(join(app.dataDir, 'studychat.sqlite'));
  const metadata = JSON.stringify({ provider: 'openai', requestedModel: MODEL, returnedModel: MODEL, endpoint: 'chat', usage: { prompt_tokens: 100, completion_tokens: 20 }, estimatedCostUsd: .000072, latencyMs: 1, pricingBasis: 'Synthetic standard rates', recordedAt: Date.now() });
  const insert = database.prepare("INSERT INTO owner_telemetry_outbox(request_id,metadata,status,created_at) VALUES(?,?,'pending',?)");
  database.exec('BEGIN');
  for (let index = 0; index < 500; index++) insert.run(randomUUID(), metadata, Date.now() + index);
  database.exec('COMMIT');
  database.close();
  const completed = await app.request('/api/chat', 'POST', { conversationId: app.conversation.id, content: STUDY_QUERY, requestId: 'full-outbox-single-inference' });
  assert.equal(completed.status, 200);
  assertReviewedReply(completed);
  assert.equal(app.providerCalls.length, 2);
  const status = await app.request('/api/ingenium-status');
  assert.equal(status.status, 200);
  assert.equal(status.body.pending, 500);
  assert.equal(status.body.delivered, 0);
  assert.equal(app.events.length, 0);
  assert.doesNotMatch(JSON.stringify(status.body), /mock-provider-key|mock-owner-access|ia_x+|Private/);
});
