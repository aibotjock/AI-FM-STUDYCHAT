import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { createChatService } from '../server/chat.js';
import { createVoiceService } from '../server/voice.js';
import { encodePcmWav } from '../packages/conversation-agent/src/browser-audio.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const speechWav = async () => Buffer.from(await encodePcmWav(new Float32Array(12000).fill(0.1), 24000).arrayBuffer());
const audioResponse = async () => new Response(await speechWav(), { headers: { 'Content-Type': 'audio/wav' } });
const healthResponse = () => Response.json({ ready: true, provider: 'self-hosted', transcriptionModel: 'small.en', speechModel: 'kokoro-v1.0', voices: ['af_heart', 'af_bella', 'af_nicole', 'am_michael', 'bf_emma'] });
const wav = async () => Buffer.from(await encodePcmWav(new Float32Array(8000).fill(0.1), 16000).arrayBuffer()).toString('base64');

async function setup(t, { content = 'Saved reply.', fetchImpl = async () => audioResponse(), config = {}, now } = {}) {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON');
  let textCalls = 0;
  const chat = createChatService({ db, provider: { async generate() { textCalls++; return { content }; } } });
  await chat.submit({ conversationId: 'c1', turnId: 't1', attemptId: 'a1', input: 'Hello' });
  let voice = createVoiceService({ db, chat, config: { speechServiceUrl: 'http://127.0.0.1:8080', speechServiceToken: 's'.repeat(32), audioBytes: 2 * 1024 * 1024, ...config }, fetchImpl: (url, options) => url.endsWith('/health') ? healthResponse() : fetchImpl(url, options), now });
  t.after(() => { voice.close(); chat.close(); db.close(); });
  const request = (extra = {}) => ({ conversationId: 'c1', messageId: 'a1', requestId: randomUUID(), ownerKey: 'owner', ...extra });
  return { db, chat, get voice() { return voice; }, request, textCalls: () => textCalls,
    restartVoice() { voice.close(); voice = createVoiceService({ db, chat, config: { speechServiceUrl: 'http://127.0.0.1:8080', speechServiceToken: 's'.repeat(32), audioBytes: 2 * 1024 * 1024, ...config }, fetchImpl: (url, options) => url.endsWith('/health') ? healthResponse() : fetchImpl(url, options), now }); } };
}

test('speech reads only a completed saved reply and makes no second text call', async t => {
  let body, calls = 0;
  const { voice, request, textCalls } = await setup(t, { fetchImpl: async (url, options) => { calls++; assert.equal(url, 'http://127.0.0.1:8080/speech'); body = JSON.parse(options.body); return audioResponse(); } });
  const result = await voice.speech(request({ input: 'Browser-supplied false answer', voice: 'af_bella' }));
  assert.equal(body.text, 'Saved reply.'); assert.equal(body.model, undefined); assert.equal(body.voice, 'af_bella');
  assert.equal(result.contentType, 'audio/wav'); assert.deepEqual(result.audio, await speechWav());
  assert.equal(calls, 1); assert.equal(textCalls(), 1);
  await assert.rejects(voice.speech(request({ messageId: 'unknown' })), error => error.code === 'voice_reply_unavailable');
  await assert.rejects(voice.speech(request({ voice: 'unknown' })), error => error.code === 'invalid_voice');
  assert.equal(calls, 1);
});

test('speech rejects incomplete, imported and long replies before a provider call', async t => {
  let calls = 0;
  const { voice, db, chat, request } = await setup(t, { fetchImpl: async () => { calls++; return audioResponse(); } });
  db.prepare("UPDATE chat_attempts SET status='interrupted' WHERE attempt_id='a1'").run();
  await assert.rejects(voice.speech(request()), error => error.code === 'voice_reply_unavailable');
  db.prepare("UPDATE chat_attempts SET status='completed',imported=1 WHERE attempt_id='a1'").run();
  await assert.rejects(voice.speech(request()), error => error.code === 'voice_reply_unavailable');
  db.prepare("UPDATE chat_attempts SET imported=0,content=? WHERE attempt_id='a1'").run('x'.repeat(4097));
  await assert.rejects(voice.speech(request()), error => error.code === 'speech_too_long');
  assert.equal(chat.history('c1').turns[0].content.length, 4097); assert.equal(calls, 0);
});

test('durable speech IDs suppress duplicates and expired or restarted cache never regenerates automatically', async t => {
  let calls = 0, clock = Date.now();
  const env = await setup(t, { now: () => clock, fetchImpl: async () => { calls++; return audioResponse(); } });
  const request = env.request();
  assert.equal((await env.voice.speech(request)).cached, false);
  assert.equal((await env.voice.speech(request)).cached, true); assert.equal(calls, 1);
  await assert.rejects(env.voice.speech({ ...request, voice: 'bf_emma' }), error => error.code === 'speech_request_conflict');
  await assert.rejects(env.voice.speech({ ...request, ownerKey: 'another-sign-in' }), error => error.code === 'speech_request_conflict');
  clock += 60001;
  await assert.rejects(env.voice.speech(request), error => error.code === 'speech_cache_expired');
  env.restartVoice();
  await assert.rejects(env.voice.speech(request), error => error.code === 'speech_cache_expired');
  assert.equal(calls, 1);
});

test('obsolete speech rejects ignored cancellation and late callbacks cannot complete its ledger', async t => {
  let release, calls = 0;
  const { voice, db, request } = await setup(t, { fetchImpl: async () => { calls++; return new Promise(resolve => { release = resolve; }); } });
  const input = request(), pending = voice.speech(input); await tick();
  voice.invalidate({ conversationId: 'c1', speechOnly: true });
  await assert.rejects(pending, error => error.code === 'voice_cancelled');
  release(audioResponse()); await tick();
  assert.equal(db.prepare('SELECT status FROM speech_requests WHERE request_id=?').get(input.requestId).status, 'uncertain');
  await assert.rejects(voice.speech(input), error => error.code === 'speech_request_uncertain');
  assert.equal(calls, 1);
});

test('speech timeout during a stalled body is visible, bounded, and leaves text usable', async t => {
  const { voice, chat, request } = await setup(t, { config: { audioTimeoutMs: 20 }, fetchImpl: async () => new Response(new ReadableStream({ start() {} }), { headers: { 'Content-Type': 'audio/wav' } }) });
  const started = Date.now();
  await assert.rejects(voice.speech(request()), error => error.code === 'voice_timeout');
  assert.ok(Date.now() - started < 1000); assert.equal(chat.history('c1').turns[0].content, 'Saved reply.');
});

test('transcription reuses self-hosted WAV service with utterance IDs and independent owner sessions', async t => {
  let calls = 0;
  const { voice } = await setup(t, { fetchImpl: async (url, options) => {
    calls++; assert.equal(url, 'http://127.0.0.1:8080/transcribe');
    assert.ok(Buffer.isBuffer(options.body)); assert.equal(options.headers.Authorization, `Bearer ${'s'.repeat(32)}`); assert.equal(options.headers['Content-Type'], 'audio/wav');
    return Response.json({ text: 'Hello again', model: 'small.en' });
  } });
  const session = await voice.start({ conversationId: 'new-conversation', ownerKey: 'owner' });
  const input = { conversationId: session.conversationId, sessionId: session.sessionId, ownerKey: 'owner', requestId: randomUUID(), audioBase64: await wav() };
  assert.equal((await voice.transcribe(input)).text, 'Hello again');
  assert.equal((await voice.transcribe(input)).cached, true); assert.equal(calls, 1);
  await assert.rejects(voice.transcribe({ ...input, ownerKey: 'another-sign-in' }), error => error.code === 'conversation_audio_session_inactive');
  voice.invalidate({ conversationId: input.conversationId, speechOnly: true });
  assert.equal((await voice.transcribe({ ...input, requestId: randomUUID() })).text, 'Hello again');
  voice.invalidate();
  await assert.rejects(voice.transcribe({ ...input, requestId: randomUUID() }), error => error.code === 'conversation_audio_session_inactive');
});

test('empty and oversized recordings fail visibly without repeated inference', async t => {
  let calls = 0;
  const { voice } = await setup(t, { fetchImpl: async () => { calls++; return Response.json({ text: '  ' }); } });
  const session = await voice.start({ conversationId: 'c1', ownerKey: 'owner' });
  const input = { conversationId: 'c1', sessionId: session.sessionId, ownerKey: 'owner', requestId: randomUUID(), audioBase64: await wav() };
  await assert.rejects(voice.transcribe(input), error => error.code === 'voice_empty_transcript');
  await assert.rejects(voice.transcribe(input), error => error.code === 'voice_empty_transcript');
  assert.equal(calls, 1);
  await assert.rejects(voice.transcribe({ ...input, requestId: randomUUID(), audioBase64: Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64') }), error => error.code === 'voice_audio_limit');
  assert.equal(calls, 1);
});

test('unconfigured free voice and provider audio failures preserve the completed text', async t => {
  const missing = await setup(t, { config: { speechServiceUrl: '', speechServiceToken: '', apiKey: 'paid-key-must-not-enable-speech' }, fetchImpl: async () => { throw new Error('Must not request without a key'); } });
  assert.equal(missing.voice.options().enabled, false);
  await assert.rejects(() => missing.voice.start({ conversationId: 'c1', ownerKey: 'owner' }), error => error.code === 'voice_unavailable');
  await assert.rejects(missing.voice.speech(missing.request()), error => error.code === 'voice_unavailable');
  assert.equal(missing.chat.history('c1').turns[0].status, 'completed');
  let calls = 0;
  const failed = await setup(t, { fetchImpl: async () => { calls++; return Response.json({ error: 'secret-provider-error' }, { status: 500 }); } });
  const input = failed.request();
  await assert.rejects(failed.voice.speech(input), error => error.code === 'speech_provider_failed' && !error.message.includes('secret'));
  await assert.rejects(failed.voice.speech(input), error => error.code === 'speech_request_uncertain');
  assert.equal(calls, 1); assert.equal(failed.chat.history('c1').turns[0].content, 'Saved reply.');
});

test('cancelled transcription cannot complete later or regenerate the same utterance', async t => {
  let release, calls = 0;
  const { voice, db } = await setup(t, { fetchImpl: async () => { calls++; return new Promise(resolve => { release = resolve; }); } });
  const session = await voice.start({ conversationId: 'c1', ownerKey: 'owner' });
  const input = { conversationId: 'c1', sessionId: session.sessionId, ownerKey: 'owner', requestId: randomUUID(), audioBase64: await wav() };
  const pending = voice.transcribe(input); await tick();
  assert.equal(voice.cancel(input).cancelled, true);
  await assert.rejects(pending, error => error.code === 'conversation_audio_request_inactive');
  release(Response.json({ text: 'Obsolete transcript' })); await tick();
  assert.equal(db.prepare('SELECT status FROM conversation_audio_requests WHERE request_id=?').get(input.requestId).status, 'uncertain');
  await assert.rejects(voice.transcribe(input), error => error.code === 'conversation_audio_request_uncertain');
  assert.equal(calls, 1);
});

test('empty, malformed and oversized speech responses remain explicit failures', async t => {
  for (const response of [new Response(null, { headers: { 'Content-Type': 'audio/wav' } }), Response.json({ text: 'Not audio' }), new Response(Buffer.alloc(65), { headers: { 'Content-Type': 'audio/wav' } })]) {
    const { voice, chat, request } = await setup(t, { config: { speechAudioBytes: 64 }, fetchImpl: async () => response });
    await assert.rejects(voice.speech(request()), error => ['speech_provider_format', 'speech_audio_limit'].includes(error.code));
    assert.equal(chat.history('c1').turns[0].status, 'completed');
  }
});

test('self-hosted speech and transcription require no OpenAI key and record no vendor fee', async t => {
  const env = await setup(t, { config: { apiKey: '', anthropicApiKey: 'brain-key-is-not-a-speech-key' }, fetchImpl: async (url, options) => {
    assert.ok(url.startsWith('http://127.0.0.1:8080/'));
    assert.equal(options.headers.Authorization, `Bearer ${'s'.repeat(32)}`);
    return url.endsWith('/transcribe') ? Response.json({ text: 'Explain renal physiology.', model: 'small.en' }) : audioResponse();
  } });
  const session = await env.voice.start({ conversationId: 'c1', ownerKey: 'owner' });
  assert.equal(session.provider, 'self-hosted'); assert.equal(session.voices.length, 5);
  const transcript = await env.voice.transcribe({ conversationId: 'c1', sessionId: session.sessionId, ownerKey: 'owner', requestId: randomUUID(), audioBase64: await wav() });
  assert.equal(transcript.metadata.paidRequest, false); assert.equal(transcript.metadata.estimatedCostUsd, 0); assert.equal(transcript.metadata.hostingCostIncluded, false);
  const request = env.request(); await env.voice.speech(request);
  const metadata = JSON.parse(env.db.prepare('SELECT metadata FROM speech_requests WHERE request_id=?').get(request.requestId).metadata);
  assert.equal(metadata.provider, 'self-hosted'); assert.equal(metadata.paidRequest, false); assert.equal(metadata.estimatedCostUsd, 0);
  assert.equal(env.textCalls(), 1);
});

test('readiness must confirm the models and voices before microphone session starts', async t => {
  for (const body of [{ ready: false }, { ready: true, transcriptionModel: 'other', speechModel: 'kokoro-v1.0', voices: ['af_heart'] }]) {
    const db = new DatabaseSync(':memory:');
    const voice = createVoiceService({ db, chat: { history: () => ({ turns: [] }) }, config: { speechServiceUrl: 'http://localhost:8080', speechServiceToken: 's'.repeat(32) }, fetchImpl: async () => Response.json(body) });
    assert.equal((await voice.status()).enabled, false);
    await assert.rejects(voice.start({ conversationId: 'c1', ownerKey: 'owner' }), error => error.code === 'voice_unavailable');
    voice.close(); db.close();
  }
});

test('a cancelled readiness check cannot create a late microphone session', async t => {
  const db = new DatabaseSync(':memory:'), controller = new AbortController(); let release;
  const voice = createVoiceService({ db, chat: { history: () => ({ turns: [] }) }, config: { speechServiceUrl: 'http://localhost:8080', speechServiceToken: 's'.repeat(32) }, fetchImpl: () => new Promise(resolve => { release = resolve; }) });
  const pending = voice.start({ conversationId: 'c1', ownerKey: 'owner', signal: controller.signal });
  controller.abort(); await assert.rejects(pending);
  release(healthResponse()); await tick(); assert.equal(voice.options().enabled, false);
  voice.close(); db.close();
});

test('all five voices read the saved reply without adding an answering-model request', async t => {
  const selected = [];
  const env = await setup(t, { fetchImpl: async (url, options) => { selected.push(JSON.parse(options.body).voice); return audioResponse(); } });
  for (const voice of ['af_heart', 'af_bella', 'af_nicole', 'am_michael', 'bf_emma']) await env.voice.speech(env.request({ voice }));
  assert.equal(new Set(selected).size, 5); assert.equal(env.textCalls(), 1);
});

test('restore or conversation deletion during readiness cannot create an obsolete voice session', async () => {
  const db = new DatabaseSync(':memory:'); let release;
  const voice = createVoiceService({ db, chat: { history: () => ({ turns: [] }) }, config: { speechServiceUrl: 'http://localhost:8080', speechServiceToken: 's'.repeat(32) }, fetchImpl: () => new Promise(resolve => { release = resolve; }) });
  const pending = voice.start({ conversationId: 'c1', ownerKey: 'owner' });
  voice.invalidate({ conversationId: 'c1' }); release(healthResponse());
  await assert.rejects(pending, error => error.code === 'voice_cancelled');
  voice.close(); db.close();
});
