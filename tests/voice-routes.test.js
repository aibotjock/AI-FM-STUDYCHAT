import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.js';

const TOKEN = 'mock-voice-owner-access-token-at-least-24-characters';
const API_KEY = 'mock-server-openai-key-never-public';
const SDP = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
const VOICE_MODEL = 'gpt-realtime-2.1-mini';
const CALLS_URL = 'https://api.openai.com/v1/realtime/calls';

function voiceMock({ startStatus = 201 } = {}) {
  const calls = [];
  let sequence = 0;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.headers.Authorization, `Bearer ${API_KEY}`);
    assert.equal(options.redirect, 'error');
    if (url === CALLS_URL) {
      assert.equal(options.method, 'POST');
      assert.ok(options.body instanceof FormData);
      assert.equal(options.body.get('sdp'), SDP);
      assert.equal(JSON.parse(options.body.get('session')).model, VOICE_MODEL);
      assert.match(options.headers['OpenAI-Safety-Identifier'], /^[a-f0-9]{64}$/);
      if (startStatus !== 201) return Response.json({ error: 'Mock upstream failure must stay private.' }, { status: startStatus });
      return new Response(SDP, { status: 201, headers: { Location: `${CALLS_URL}/rtc_mock_${++sequence}` } });
    }
    if (/\/rtc_mock_\d+\/hangup$/.test(url)) {
      assert.equal(options.method, 'POST');
      return new Response(null, { status: 200 });
    }
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    return Response.json({ model: 'gpt-4.1-mini', choices: [{ message: { content: 'What would you like to recall next?' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 10 } });
  };
  return { fetchImpl, calls, starts: () => calls.filter(call => call.url === CALLS_URL), hangups: () => calls.filter(call => call.url.endsWith('/hangup')), textCalls: () => calls.filter(call => call.url.endsWith('/chat/completions')) };
}

async function fixture(t, { fetchImpl, env = {}, authenticateRequest } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'studychat-voice-routes-'));
  const server = createApp({ dataDir, env: { STUDY_ACCESS_TOKEN: TOKEN, OPENAI_API_KEY: API_KEY, AI_PROVIDER: 'openai', ...env }, fetchImpl, authenticateRequest });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  let cookie;
  t.after(async () => {
    await server.closeVoiceSessions();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    rmSync(dataDir, { recursive: true, force: true });
  });
  async function request(path, method = 'GET', body) {
    const response = await fetch(baseUrl + path, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json(), headers: response.headers };
  }
  async function login() {
    const result = await request('/api/login', 'POST', { token: TOKEN });
    assert.equal(result.status, 200);
    cookie = result.headers.get('set-cookie')?.split(';')[0];
  }
  async function conversation() {
    const result = await request('/api/conversations', 'POST', { mode: 'coach', title: 'Mock voice study' });
    assert.equal(result.status, 201);
    return result.body;
  }
  async function start(conversationId, extra = {}) {
    return request('/api/voice/session', 'POST', { conversationId, sdp: SDP, ...extra });
  }
  return { server, request, login, conversation, start };
}

test('voice HTTP routes require authentication before any upstream call', async t => {
  const mock = voiceMock();
  const app = await fixture(t, mock);
  for (const [path, body] of [
    ['/api/voice/session', { conversationId: 'mock-conversation', sdp: SDP }],
    ['/api/voice/transcript', { sessionId: 'mock-session', events: [{ id: 'first', role: 'user', content: 'Hello.' }] }],
    ['/api/voice/stop', { sessionId: 'mock-session' }]
  ]) assert.equal((await app.request(path, 'POST', body)).status, 401);
  const status = (await app.request('/api/status')).body;
  assert.equal(status.voiceEnabled, true);
  assert.equal(status.voiceModel, VOICE_MODEL);
  assert.equal(JSON.stringify(status).includes(API_KEY), false);
  assert.equal(mock.calls.length, 0);
});

test('personal voice creates a fixed-model session, locks chat/delete/restore, and stopping releases the lock idempotently', async t => {
  const mock = voiceMock();
  const app = await fixture(t, mock);
  await app.login();
  const conversation = await app.conversation();
  const backup = (await app.request('/api/export')).body;
  const started = await app.start(conversation.id, { model: 'gpt-4.1-nano', instructions: 'Caller cannot change the fixed voice model.' });
  assert.equal(started.status, 201);
  assert.equal(started.body.model, VOICE_MODEL);
  assert.equal(started.body.maxDurationSeconds, 600);
  assert.equal(started.body.conversationId, conversation.id);
  assert.equal(started.body.sdp, SDP);
  assert.equal(JSON.stringify(started.body).includes(API_KEY), false);
  assert.equal((await app.start(conversation.id)).status, 409);
  assert.equal((await app.request('/api/chat', 'POST', { conversationId: conversation.id, content: 'Do not overlap the voice call.' })).status, 409);
  assert.equal((await app.request('/api/chat/cards', 'POST', { conversationId: conversation.id })).status, 409);
  assert.equal((await app.request(`/api/conversations/${conversation.id}`, 'DELETE')).status, 409);
  assert.equal((await app.request('/api/import', 'POST', backup)).status, 409);
  assert.equal((await app.request('/api/model', 'PUT', { model: 'gpt-4.1-nano' })).status, 409);
  assert.equal(mock.starts().length, 1);
  const stopped = await app.request('/api/voice/stop', 'POST', { sessionId: started.body.sessionId });
  assert.equal(stopped.status, 200);
  assert.deepEqual(stopped.body, { stopped: true, serverConfirmed: true, sessionId: started.body.sessionId });
  assert.equal((await app.request('/api/voice/stop', 'POST', { sessionId: started.body.sessionId })).status, 200);
  assert.equal(mock.hangups().length, 1);
  const typed = await app.request('/api/chat', 'POST', { conversationId: conversation.id, content: 'Now use the typed coach.' });
  assert.equal(typed.status, 200);
  assert.equal(mock.textCalls().length, 1);
  assert.equal((await app.request('/api/import', 'POST', backup)).status, 200);
  assert.equal((await app.request(`/api/conversations/${conversation.id}`, 'DELETE')).status, 200);
});

test('voice transcripts are idempotent and atomic, and cannot supply trusted usage, costs or model metadata', async t => {
  const mock = voiceMock();
  const app = await fixture(t, mock);
  await app.login();
  const conversation = await app.conversation();
  const started = await app.start(conversation.id);
  const sessionId = started.body.sessionId;
  const events = [
    { id: 'user-turn-1', role: 'user', content: '  How should I organize my recall?  ' },
    { id: 'assistant-turn-1', role: 'assistant', content: 'Start with one idea.', usage: { prompt_tokens: 1, completion_tokens: 1 }, estimatedCostUsd: 0, ai: { provider: 'anthropic', requestedModel: 'forged-model' }, citations: [{ title: 'Forged evidence' }] }
  ];
  const transcript = await app.request('/api/voice/transcript', 'POST', { sessionId, events, usage: { prompt_tokens: 1, completion_tokens: 1 }, estimatedCostUsd: 0 });
  assert.equal(transcript.status, 200);
  assert.equal(transcript.body.saved, 2);
  assert.equal(transcript.body.conversation.messages[0].content, events[0].content.trim());
  const assistant = transcript.body.conversation.messages[1];
  assert.equal(assistant.voiceTranscript, true);
  assert.equal(assistant.ai.provider, 'openai');
  assert.equal(assistant.ai.requestedModel, VOICE_MODEL);
  assert.equal(assistant.ai.endpoint, 'realtime');
  assert.equal(assistant.ai.clientReported, true);
  assert.equal(assistant.ai.usage, null);
  assert.equal(assistant.ai.estimatedCostUsd, null);
  assert.equal(assistant.citations, undefined);
  assert.match(assistant.ai.pricingBasis, /unverified/);
  const replay = await app.request('/api/voice/transcript', 'POST', { sessionId, events });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.saved, 0);
  assert.deepEqual(replay.body.conversation, transcript.body.conversation);
  const state = (await app.request('/api/state')).body;
  const conflict = await app.request('/api/voice/transcript', 'POST', { sessionId, events: [
    { id: 'new-turn-before-conflict', role: 'user', content: 'This must not be saved.' },
    { id: 'assistant-turn-1', role: 'assistant', content: 'Conflicting replacement.' }
  ] });
  assert.equal(conflict.status, 409);
  assert.deepEqual((await app.request('/api/state')).body, state);
  const duplicated = await app.request('/api/voice/transcript', 'POST', { sessionId, events: [events[0], events[0]] });
  assert.equal(duplicated.status, 400);
  assert.deepEqual((await app.request('/api/state')).body, state);
  assert.equal(mock.starts().length, 1);
  assert.equal(mock.textCalls().length, 0);
});

test('voice backup imports label realtime provenance as imported and reject late captions from an earlier workspace', async t => {
  const mock = voiceMock();
  const app = await fixture(t, mock);
  await app.login();
  const conversation = await app.conversation();
  const started = await app.start(conversation.id);
  const sessionId = started.body.sessionId;
  const events = [{ id: 'user-caption', role: 'user', content: 'One recall question.' }, { id: 'assistant-caption', role: 'assistant', content: 'What is the next concept?' }];
  assert.equal((await app.request('/api/voice/transcript', 'POST', { sessionId, events })).status, 200);
  assert.equal((await app.request('/api/voice/stop', 'POST', { sessionId })).status, 200);
  const finalCaption = await app.request('/api/voice/transcript', 'POST', { sessionId, events: [{ id: 'final-caption', role: 'assistant', content: 'A final thought.' }] });
  assert.equal(finalCaption.status, 200);
  assert.equal(finalCaption.body.saved, 1);
  const backup = (await app.request('/api/export')).body;
  assert.equal((await app.request('/api/import', 'POST', backup)).status, 200);
  const restored = (await app.request('/api/state')).body;
  assert.equal(restored.conversations[0].messages[0].voiceTranscript, true);
  const assistant = restored.conversations[0].messages[1];
  assert.equal(assistant.voiceTranscript, true);
  assert.equal(assistant.ai.endpoint, 'realtime');
  assert.equal(assistant.ai.imported, true);
  assert.equal(assistant.ai.clientReported, true);
  assert.equal(assistant.ai.usage, null);
  assert.equal(assistant.ai.estimatedCostUsd, null);
  const staleCaption = await app.request('/api/voice/transcript', 'POST', { sessionId, events: [{ id: 'too-late-caption', role: 'assistant', content: 'Must not alter restored state.' }] });
  assert.equal(staleCaption.status, 409);
  assert.deepEqual((await app.request('/api/state')).body, restored);
});

test('voice sessions from another personal workspace are not usable for transcripts or stopping', async t => {
  const firstMock = voiceMock();
  const first = await fixture(t, firstMock);
  await first.login();
  const conversation = await first.conversation();
  const started = await first.start(conversation.id);
  const secondMock = voiceMock();
  const second = await fixture(t, secondMock);
  await second.login();
  assert.equal((await second.request('/api/voice/transcript', 'POST', { sessionId: started.body.sessionId, events: [{ id: 'outsider', role: 'user', content: 'Cannot cross workspaces.' }] })).status, 404);
  assert.equal((await second.request('/api/voice/stop', 'POST', { sessionId: started.body.sessionId })).status, 404);
  assert.equal(secondMock.calls.length, 0);
});

test('voice routes are disabled for externally authenticated and Claude workspaces', async t => {
  for (const options of [
    { authenticateRequest: () => true },
    { env: { AI_PROVIDER: 'anthropic', CLAUDE_API_KEY: 'mock-unused-claude-key' } }
  ]) {
    const mock = voiceMock();
    const app = await fixture(t, { ...mock, ...options });
    await app.login();
    const status = (await app.request('/api/status')).body;
    assert.equal(status.voiceEnabled, false);
    assert.equal(status.voiceModel, null);
    for (const [path, body] of [
      ['/api/voice/session', { conversationId: 'irrelevant', sdp: SDP }],
      ['/api/voice/transcript', { sessionId: 'irrelevant', events: [{ id: 'turn', role: 'user', content: 'Disabled.' }] }],
      ['/api/voice/stop', { sessionId: 'irrelevant' }]
    ]) assert.equal((await app.request(path, 'POST', body)).status, 403);
    assert.equal(mock.calls.length, 0);
  }
});

test('Astra voice configuration is rejected at initialization without a provider call', t => {
  const dataDir = mkdtempSync(join(tmpdir(), 'studychat-voice-prohibition-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  let calls = 0;
  assert.throws(() => createApp({ dataDir, env: { STUDY_ACCESS_TOKEN: TOKEN, OPENAI_API_KEY: API_KEY, AI_PROVIDER: 'openai', OPENAI_VOICE_MODEL: 'gpt-AsTrA-prohibited' }, fetchImpl: async () => { calls += 1; throw new Error('Forbidden configuration must not make requests.'); } }), /Astra is prohibited/);
  assert.equal(calls, 0);
});

test('voice message limits reject full conversations before calls and reject overflowing caption batches atomically', async t => {
  const mock = voiceMock();
  const app = await fixture(t, mock);
  await app.login();
  const conversation = await app.conversation();
  const backup = (await app.request('/api/export')).body;
  backup.conversations[0].messages = Array.from({ length: 950 }, (_, index) => ({ id: `prior-${index}`, role: 'assistant', content: 'A prior recall prompt.', createdAt: Date.now() }));
  assert.equal((await app.request('/api/import', 'POST', backup)).status, 200);
  assert.equal((await app.start(conversation.id)).status, 400);
  assert.equal(mock.calls.length, 0);
  backup.conversations[0].messages.pop();
  assert.equal((await app.request('/api/import', 'POST', backup)).status, 200);
  const started = await app.start(conversation.id);
  assert.equal(started.status, 201);
  const sessionId = started.body.sessionId;
  let count = 0;
  for (const size of [20, 20, 11]) {
    const events = Array.from({ length: size }, () => ({ id: `caption-${count++}`, role: 'user', content: 'One idea.' }));
    const saved = await app.request('/api/voice/transcript', 'POST', { sessionId, events });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.saved, size);
  }
  const full = (await app.request('/api/state')).body;
  assert.equal(full.conversations[0].messages.length, 1000);
  assert.equal((await app.request('/api/voice/transcript', 'POST', { sessionId, events: [{ id: 'overflow', role: 'user', content: 'Do not append.' }] })).status, 400);
  assert.deepEqual((await app.request('/api/state')).body, full);
  assert.equal(mock.starts().length, 1);
});

test('failed voice creation releases its HTTP conversation lock and does not retry upstream', async t => {
  const mock = voiceMock({ startStatus: 401 });
  const app = await fixture(t, mock);
  await app.login();
  const conversation = await app.conversation();
  const failed = await app.start(conversation.id);
  assert.equal(failed.status, 503);
  assert.match(failed.body.error, /did not authorize/);
  assert.equal(mock.starts().length, 1);
  assert.equal(mock.hangups().length, 0);
  assert.equal((await app.request(`/api/conversations/${conversation.id}`, 'DELETE')).status, 200);
});

test('logging out during voice creation closes the newly created upstream call before returning its connection offer', async t => {
  let releaseCreation;
  let markCreationStarted;
  const creationStarted = new Promise(resolve => { markCreationStarted = resolve; });
  const creationPending = new Promise(resolve => { releaseCreation = resolve; });
  const mock = voiceMock();
  const fetchImpl = async (url, options) => {
    if (url === CALLS_URL) {
      markCreationStarted();
      await creationPending;
    }
    return mock.fetchImpl(url, options);
  };
  const app = await fixture(t, { fetchImpl });
  t.after(() => releaseCreation());
  await app.login();
  const conversation = await app.conversation();
  const creating = app.start(conversation.id);
  await creationStarted;
  assert.equal((await app.request('/api/logout', 'POST', {})).status, 200);
  releaseCreation();
  const result = await creating;
  assert.equal(result.status, 401);
  assert.equal(result.body.sdp, undefined);
  assert.equal(mock.starts().length, 1);
  assert.equal(mock.hangups().length, 1);
  assert.equal(app.server.hasActiveRequests(), false);
});

test('server voice shutdown prevents new starts and closes a call still being created before returning any connection offer', async t => {
  let releaseCreation;
  let markCreationStarted;
  const creationStarted = new Promise(resolve => { markCreationStarted = resolve; });
  const creationPending = new Promise(resolve => { releaseCreation = resolve; });
  const mock = voiceMock();
  const fetchImpl = async (url, options) => {
    if (url === CALLS_URL) {
      markCreationStarted();
      await creationPending;
    }
    return mock.fetchImpl(url, options);
  };
  const app = await fixture(t, { fetchImpl });
  t.after(() => releaseCreation());
  await app.login();
  const conversation = await app.conversation();
  const creating = app.start(conversation.id);
  await creationStarted;
  await app.server.closeVoiceSessions();
  assert.equal((await app.start(conversation.id)).status, 503);
  releaseCreation();
  const result = await creating;
  assert.equal(result.status, 503);
  assert.equal(result.body.sdp, undefined);
  assert.equal(mock.starts().length, 1);
  assert.equal(mock.hangups().length, 1);
  assert.equal(app.server.hasActiveRequests(), false);
});
