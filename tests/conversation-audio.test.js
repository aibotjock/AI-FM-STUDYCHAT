import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createConversationAudioService, decodeConversationWav, CONVERSATION_AUDIO_LIMITS, CONVERSATION_TRANSCRIPTION_MODEL } from '../server/conversation-audio.js';
import { createApp } from '../server/index.js';
import { createStudyCurriculum } from '../server/study-curriculum.js';
import { splitPremiumSpeech } from '../server/premium-speech.js';
import { studyCondition, STUDY_NOW } from './fixtures/study-condition.js';

const key = 'synthetic-conversation-audio-provider-key-never-real';
function wav(milliseconds = 1000, sampleRate = 16000) {
  const size = Math.round(milliseconds * sampleRate / 1000) * 2, value = Buffer.alloc(44 + size);
  value.write('RIFF'); value.writeUInt32LE(value.length - 8, 4); value.write('WAVE', 8); value.write('fmt ', 12); value.writeUInt32LE(16, 16); value.writeUInt16LE(1, 20); value.writeUInt16LE(1, 22); value.writeUInt32LE(sampleRate, 24); value.writeUInt32LE(sampleRate * 2, 28); value.writeUInt16LE(2, 32); value.writeUInt16LE(16, 34); value.write('data', 36); value.writeUInt32LE(size, 40);
  for (let i = 44; i < value.length; i += 2) value.writeInt16LE(1000, i);
  return value;
}
const transcript = (extra = {}) => Response.json({ text: 'Let us study this together.', usage: { type: 'tokens', input_tokens: 12, output_tokens: 6, total_tokens: 18, input_token_details: { audio_tokens: 12, text_tokens: 0 } }, ...extra }, { headers: { 'x-request-id': 'req_synthetic_transcription' } });
function fixture(t, fetchImpl, options = {}) {
  const db = options.db || new DatabaseSync(':memory:');
  const service = createConversationAudioService({ db, env: { OPENAI_API_KEY: key }, fetchImpl, ...options });
  t.after(() => { service.close(); db.close(); });
  const session = service.start({ conversationId: randomUUID(), ownerKey: 'owner-one' });
  const input = extra => ({ sessionId: session.sessionId, conversationId: session.conversationId, ownerKey: 'owner-one', requestId: randomUUID(), audioBase64: wav().toString('base64'), ...extra });
  return { service, db, session, input };
}

test('WAV validation trusts byte structure and bounds, never browser MIME or claimed duration', () => {
  for (const rate of [16000, 24000, 48000]) assert.equal(decodeConversationWav(wav(1000, rate).toString('base64')).durationMs, 1000);
  const invalid = [wav(100), wav(60001), Buffer.from('not wav')];
  const stereo = wav(); stereo.writeUInt16LE(2, 22); invalid.push(stereo);
  const badSize = wav(); badSize.writeUInt32LE(0, 40); invalid.push(badSize);
  const badRate = wav(); badRate.writeUInt32LE(44100, 24); invalid.push(badRate);
  for (const value of invalid) assert.throws(() => decodeConversationWav(value.toString('base64')), { status: 400 });
  for (const value of ['', 'data:audio/wav;base64,AAAA', 'AA A=', '%%%%', 'AAAA=', 'A'.repeat(Math.ceil(CONVERSATION_AUDIO_LIMITS.maxAudioBytes / 3) * 4 + 4)]) assert.throws(() => decodeConversationWav(value), { status: 400 });
});

test('only fixed OpenAI transcription receives server credentials; ledger contains metadata without transcript or audio', async t => {
  let calls = 0;
  const { service, db, input } = fixture(t, async (url, options) => {
    calls++; assert.equal(url, 'https://api.openai.com/v1/audio/transcriptions');
    assert.equal(options.headers.Authorization, `Bearer ${key}`); assert.equal(options.redirect, 'error');
    assert.equal(options.body.get('model'), CONVERSATION_TRANSCRIPTION_MODEL); assert.equal(options.body.get('response_format'), 'json');
    assert.equal(options.body.get('prompt'), null); assert.equal(options.body.get('language'), 'en');
    const file = options.body.get('file'); assert.equal(file.name, 'utterance.wav'); assert.equal(file.type, 'audio/wav'); assert.deepEqual(Buffer.from(await file.arrayBuffer()), wav());
    return transcript();
  });
  const request = input(), first = await service.transcribe(request), replay = await service.transcribe(request);
  assert.equal(first.text, 'Let us study this together.'); assert.equal(first.transcriptVerified, false); assert.equal(first.cached, false); assert.equal(first.metadata.estimatedCostUsd, null); assert.equal(first.metadata.ingeniumReported, false);
  assert.equal(first.metadata.usage.input_token_details.audio_tokens, 12); assert.equal(replay.cached, true); assert.equal(replay.metadata.paidRequest, false); assert.equal(calls, 1);
  const ledger = JSON.stringify(db.prepare('SELECT * FROM conversation_audio_requests').all());
  assert.doesNotMatch(ledger, /Let us study|synthetic-conversation-audio-provider-key|audioBase64|UklG/);
  assert.equal(db.prepare('SELECT status FROM conversation_audio_requests').get().status, 'complete');
});

test('request identities cannot cross owners, sessions, conversations, or changed recordings', async t => {
  let calls = 0;
  const { service, session, input } = fixture(t, async () => { calls++; return transcript(); });
  const request = input(); await service.transcribe(request);
  await assert.rejects(service.transcribe({ ...request, ownerKey: 'owner-two' }), { code: 'conversation_audio_session_inactive' });
  await assert.rejects(service.transcribe({ ...request, conversationId: randomUUID() }), { code: 'conversation_audio_session_inactive' });
  await assert.rejects(service.transcribe({ ...request, audioBase64: wav(1200).toString('base64') }), { code: 'conversation_audio_request_conflict' });
  service.end({ ...session, ownerKey: 'owner-one' });
  const second = service.start({ conversationId: session.conversationId, ownerKey: 'owner-one' });
  await assert.rejects(service.transcribe({ ...request, sessionId: second.sessionId }), { code: 'conversation_audio_request_conflict' });
  assert.equal(calls, 1);
});

test('UUID case normalization preserves replay identity and actually ends the requested session', async t => {
  let calls = 0;
  const { service, session, input } = fixture(t, async () => { calls++; return transcript(); });
  const request = input(), upper = { ...request, sessionId: request.sessionId.toUpperCase(), requestId: request.requestId.toUpperCase() };
  const first = await service.transcribe(upper); assert.equal(first.sessionId, session.sessionId); assert.equal(first.requestId, request.requestId);
  assert.equal((await service.transcribe(request)).cached, true); assert.equal(calls, 1);
  const ended = service.end({ sessionId: session.sessionId.toUpperCase(), conversationId: session.conversationId, ownerKey: 'owner-one' }); assert.equal(ended.ended, true);
  await assert.rejects(service.transcribe(input()), { code: 'conversation_audio_session_inactive' });
});

test('provider failures and cancelled work remain uncertain and cannot trigger automatic paid retry', async t => {
  let calls = 0, release;
  const waiting = new Promise(resolve => { release = resolve; });
  const { service, db, input } = fixture(t, async () => { calls++; await waiting; return transcript(); });
  const request = input(), pending = service.transcribe(request);
  assert.equal(service.active, 1);
  await assert.rejects(service.transcribe(input()), { code: 'conversation_audio_busy' });
  assert.equal(service.cancel(request).cancelled, true); release();
  await assert.rejects(pending, { code: 'conversation_audio_request_inactive' });
  await assert.rejects(service.transcribe(request), { code: 'conversation_audio_request_uncertain' });
  assert.equal(calls, 1); assert.equal(service.active, 0);
  const row = db.prepare('SELECT status,metadata FROM conversation_audio_requests').get();
  assert.equal(row.status, 'uncertain'); assert.equal(JSON.parse(row.metadata).billingOutcome, 'unknown'); assert.equal(JSON.parse(row.metadata).cancelled, true);
});

test('provider errors, prohibited returned model and invalid usage never leak details or invent cost', async t => {
  const replies = [new Response(key, { status: 500 }), transcript({ model: 'Astra' }), transcript({ usage: { type: 'tokens', input_tokens: 12, output_tokens: 6, total_tokens: 500 } })];
  const { service, input } = fixture(t, async () => replies.shift());
  const first = input(); await assert.rejects(service.transcribe(first), error => error.code === 'conversation_audio_provider_failed' && !error.message.includes(key));
  await assert.rejects(service.transcribe(first), { code: 'conversation_audio_request_uncertain' });
  await assert.rejects(service.transcribe(input()), { code: 'conversation_audio_provider_model' });
  const last = await service.transcribe(input()); assert.equal(last.metadata.usage, null); assert.equal(last.metadata.estimatedCostUsd, null);
});

test('session expiration, aggregate audio budget and cached transcript expiration are enforced without paid retries', async t => {
  let clock = 1000, calls = 0;
  const { service, session, input } = fixture(t, async () => { calls++; return transcript(); }, { now: () => clock });
  const short = input(); await service.transcribe(short); clock += CONVERSATION_AUDIO_LIMITS.cacheMs + 1;
  await assert.rejects(service.transcribe(short), { code: 'conversation_audio_transcript_expired' });
  for (let i = 0; i < 9; i++) await service.transcribe(input({ audioBase64: wav(60000).toString('base64') }));
  await assert.rejects(service.transcribe(input({ audioBase64: wav(60000).toString('base64') })), { code: 'conversation_audio_usage_limit' });
  assert.equal(calls, 10);
  clock = session.expiresAt;
  await assert.rejects(service.transcribe(input()), { code: 'conversation_audio_session_inactive' });
});

test('session starts and shutdown are bounded, and restart makes pending receipts uncertain', t => {
  const { service, db, session } = fixture(t, async () => transcript());
  for (let i = 0; i < 5; i++) service.start({ conversationId: session.conversationId, ownerKey: 'owner-one' });
  assert.throws(() => service.start({ conversationId: session.conversationId, ownerKey: 'owner-one' }), { code: 'conversation_audio_session_limit' });
  service.close(); assert.equal(service.options().enabled, false);
  db.prepare('INSERT INTO conversation_audio_requests VALUES(?,?,?,?,?,?)').run(randomUUID(), 'hash', 'scope', 'pending', 1000, null);
  const restarted = createConversationAudioService({ db, env: { OPENAI_API_KEY: key }, fetchImpl: async () => transcript() });
  assert.equal(db.prepare('SELECT status FROM conversation_audio_requests').get().status, 'uncertain'); restarted.close();
});

test('server session expiry and provider deadline abort work even without a subsequent browser request', async t => {
  const timers = []; let release, calls = 0;
  const waiting = new Promise(resolve => { release = resolve; });
  const { service, db, input } = fixture(t, async () => { calls++; await waiting; return transcript(); }, {
    setTimer(callback, milliseconds) { const timer = { callback, milliseconds, cleared: false, unref() {} }; timers.push(timer); return timer; },
    clearTimer(timer) { if (timer) timer.cleared = true; },
  });
  const request = input(), pending = service.transcribe(request);
  const expiry = timers.find(timer => timer.milliseconds === 600000);
  assert.ok(expiry); expiry.callback(); release();
  await assert.rejects(pending, { code: 'conversation_audio_session_inactive' });
  assert.equal(calls, 1); assert.equal(db.prepare('SELECT status FROM conversation_audio_requests').get().status, 'uncertain');
  assert.equal(expiry.cleared, true);
  assert.equal(timers.find(timer => timer.milliseconds === 30000).cleared, true);

  const deadlines = []; let finish;
  const blocked = new Promise(resolve => { finish = resolve; });
  const second = fixture(t, async () => { await blocked; return transcript(); }, {
    setTimer(callback, milliseconds) { const timer = { callback, milliseconds, unref() {} }; deadlines.push(timer); return timer; }, clearTimer() {},
  });
  const secondRequest = second.input(), timeout = second.service.transcribe(secondRequest);
  deadlines.find(timer => timer.milliseconds === 30000).callback(); finish();
  await assert.rejects(timeout, { code: 'conversation_audio_request_inactive' });
  await assert.rejects(second.service.transcribe(secondRequest), { code: 'conversation_audio_request_uncertain' });
});

async function appFixture(t, { provider, accessToken = 'private-test-access-token' } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'studychat-conversation-audio-')), calls = [];
  const curriculum = createStudyCurriculum({ records: [studyCondition()], now: () => STUDY_NOW });
  const server = createApp({ dataDir, curriculum, foundations: createStudyCurriculum({ records: [], now: () => STUDY_NOW }), env: { OPENAI_API_KEY: key, STUDY_ACCESS_TOKEN: accessToken }, fetchImpl: async (url, options) => { calls.push({ url, options }); return provider ? provider(url, options, calls.length) : transcript(); } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); rmSync(dataDir, { recursive: true, force: true }); });
  async function request(path, body, { cookie, origin = base, method = 'POST', signal, stream } = {}) {
    const response = await fetch(base + path, { method, signal, headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...(stream ? { 'X-Study-Speech-Stream': '1' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: response.headers.get('content-type')?.startsWith('audio/') ? Buffer.from(await response.arrayBuffer()) : await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0], headers: response.headers };
  }
  const cookie = (await request('/api/login', { token: accessToken })).cookie;
  const conversation = (await request('/api/conversations', { mode: 'coach', conditionId: 'asthma' }, { cookie })).body;
  const voice = (await request('/api/conversation-agent/session/start', { conversationId: conversation.id }, { cookie })).body;
  return { server, base, calls, request, cookie, conversation, voice };
}

test('HTTP voice routes enforce login, origin, exact schema and same sign-in session ownership', async t => {
  const app = await appFixture(t), fields = { sessionId: app.voice.sessionId, conversationId: app.conversation.id, requestId: randomUUID(), audioBase64: wav().toString('base64') };
  assert.equal((await app.request('/api/conversation-agent/transcribe', fields)).status, 401);
  assert.equal((await app.request('/api/conversation-agent/transcribe', fields, { cookie: app.cookie, origin: 'https://attacker.example' })).status, 403);
  assert.equal((await app.request('/api/conversation-agent/transcribe', { ...fields, model: 'Astra', approved: true }, { cookie: app.cookie })).status, 400);
  const other = (await app.request('/api/login', { token: 'private-test-access-token' })).cookie;
  assert.equal((await app.request('/api/conversation-agent/transcribe', fields, { cookie: other })).status, 409);
  assert.equal(app.calls.length, 0);
  const result = await app.request('/api/conversation-agent/transcribe', fields, { cookie: app.cookie }); assert.equal(result.status, 200); assert.equal(result.body.text, 'Let us study this together.');
  const again = await app.request('/api/conversation-agent/transcribe', fields, { cookie: app.cookie }); assert.equal(again.body.cached, true); assert.equal(app.calls.length, 1);
  assert.equal((await app.request('/api/voice/session', {}, { cookie: app.cookie })).status, 403);
  const options = await app.request('/api/conversation-agent/options', undefined, { cookie: app.cookie, method: 'GET' }); assert.equal(options.body.telemetry.audioReportedToIngenium, false);
  await app.request('/api/logout', {}, { cookie: app.cookie });
  assert.equal((await app.request('/api/conversation-agent/transcribe', { ...fields, requestId: randomUUID() }, { cookie: other })).status, 409);
});

test('HTTP checkpoint trusts only canonical stored reply IDs and defaults voice replies to zero presented content', async t => {
  const app = await appFixture(t);
  const reply = await app.request('/api/chat', { conversationId: app.conversation.id, content: 'Quiz me on asthma', requestId: randomUUID(), voiceSessionId: app.voice.sessionId }, { cookie: app.cookie });
  assert.equal(reply.status, 200); assert.equal(reply.body.message.voicePlayback.status, 'pending'); assert.equal(reply.body.message.voicePlayback.presentedText, ''); assert.equal(app.calls.length, 0);
  const fields = { sessionId: app.voice.sessionId, conversationId: app.conversation.id, messageId: reply.body.message.id, completedChunks: 0, complete: false };
  assert.equal((await app.request('/api/conversation-agent/checkpoint', { ...fields, approved: true }, { cookie: app.cookie })).status, 400);
  assert.equal((await app.request('/api/conversation-agent/checkpoint', { ...fields, messageId: randomUUID() }, { cookie: app.cookie })).status, 404);
  assert.equal((await app.request('/api/conversation-agent/checkpoint', { ...fields, completedChunks: 99 }, { cookie: app.cookie })).status, 400);
  const checkpoint = await app.request('/api/conversation-agent/checkpoint', fields, { cookie: app.cookie }); assert.equal(checkpoint.status, 200); assert.equal(checkpoint.body.playback.status, 'interrupted');
  const complete = await app.request('/api/conversation-agent/checkpoint', { ...fields, completedChunks: reply.body.message.voicePlayback.chunkCount, complete: true }, { cookie: app.cookie }); assert.equal(complete.status, 200); assert.equal(complete.body.playback.presentedText, splitPremiumSpeech(reply.body.message.spokenText || reply.body.message.content).join(''));
  const stored = app.server.readOnlySnapshot().conversations.find(item => item.id === app.conversation.id).messages.find(message => message.id === fields.messageId);
  assert.equal(stored.content, reply.body.message.content); assert.equal(stored.voicePlayback.clientReported, true);
});

test('cancelled voice author work cannot start review, release a late answer, or reuse its uncertain request ID', async t => {
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; }), wait = new Promise(resolve => { release = resolve; });
  const app = await appFixture(t, { provider: async () => { entered(); await wait; return Response.json({ model: 'gpt-4.1-mini', choices: [{ message: { content: JSON.stringify({ segments: [{ id: 's1', text: 'We can study together.', sourceChunkIds: [] }] }) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }); } });
  const requestId = randomUUID(), body = { conversationId: app.conversation.id, content: 'Hello, let us make a study plan.', requestId, voiceSessionId: app.voice.sessionId };
  const pending = app.request('/api/chat', body, { cookie: app.cookie }); await started;
  const cancel = await app.request('/api/conversation-agent/cancel', { sessionId: app.voice.sessionId, conversationId: app.conversation.id, requestId }, { cookie: app.cookie }); assert.equal(cancel.body.cancelled, true); release();
  assert.equal((await pending).status, 409); assert.equal(app.calls.length, 1);
  const replay = await app.request('/api/chat', body, { cookie: app.cookie }); assert.equal(replay.status, 409); assert.equal(app.calls.length, 1);
  const messages = app.server.readOnlySnapshot().conversations.find(item => item.id === app.conversation.id).messages;
  assert.equal(messages.length, 1); assert.equal(messages[0].voiceRequestStatus, 'uncertain'); assert.equal(messages[0].voiceTranscript, true);
});

test('approved speech streams through existing scoped route and cached replay incurs no provider request', async t => {
  const mp3 = Buffer.from('ID3synthetic-audio-checked-words');
  const app = await appFixture(t, { provider: async (url) => {
    assert.equal(url, 'https://api.openai.com/v1/audio/speech');
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(mp3.subarray(0, 5)); controller.enqueue(mp3.subarray(5)); controller.close(); } }), { headers: { 'Content-Type': 'audio/mpeg', 'x-request-id': 'req_synthetic_stream' } });
  } });
  const request = { voice: 'marin', requestId: randomUUID() };
  const result = await app.request('/api/voice/preview', request, { cookie: app.cookie, stream: true });
  assert.equal(result.status, 200); assert.deepEqual(result.body, mp3); assert.equal(result.headers.get('x-study-speech-streaming'), '1'); assert.equal(result.headers.get('content-length'), null); assert.equal(result.headers.get('x-study-speech-cost'), 'unknown');
  const replay = await app.request('/api/voice/preview', request, { cookie: app.cookie, stream: true }); assert.deepEqual(replay.body, mp3); assert.equal(replay.headers.get('x-study-speech-cached'), 'true'); assert.equal(app.calls.length, 1);
});

test('HTTP streaming releases checked audio before provider EOF and disconnect cancels stalled audio', async t => {
  let finish, cancelled = false;
  const app = await appFixture(t, { provider: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(Buffer.from('ID3first-checked-audio')); finish = () => { controller.enqueue(Buffer.from('-last-audio')); controller.close(); }; },
    cancel() { cancelled = true; },
  }), { headers: { 'Content-Type': 'audio/mpeg' } }) });
  const requestId = randomUUID();
  const response = await fetch(app.base + '/api/voice/preview', { method: 'POST', headers: { Origin: app.base, Cookie: app.cookie, 'Content-Type': 'application/json', 'X-Study-Speech-Stream': '1' }, body: JSON.stringify({ voice: 'marin', requestId }) });
  assert.equal(response.status, 200); const reader = response.body.getReader();
  const first = await reader.read(); assert.equal(Buffer.from(first.value).toString(), 'ID3first-checked-audio');
  assert.equal(typeof finish, 'function'); assert.equal(cancelled, false);
  await reader.cancel();
  for (let i = 0; i < 20 && !cancelled; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(cancelled, true);
  const receipt = await app.request('/api/voice/check/' + requestId, undefined, { cookie: app.cookie, method: 'GET' });
  assert.equal(receipt.body.status, 'uncertain'); assert.equal(receipt.body.metadata.billingOutcome, 'unknown'); assert.equal(receipt.body.cachedAudioAvailable, false); assert.equal(app.calls.length, 1);
});
