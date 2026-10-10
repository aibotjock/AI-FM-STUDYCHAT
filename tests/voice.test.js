import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { createChatService } from '../server/chat.js';
import { createVoiceService } from '../server/voice.js';
import { encodePcmWav } from '../packages/conversation-agent/src/browser-audio.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const mp3 = () => new Response(Buffer.from('ID3mock-audio'), { headers: { 'Content-Type': 'audio/mpeg' } });
const wav = async () => Buffer.from(await encodePcmWav(new Float32Array(8000).fill(0.1), 16000).arrayBuffer()).toString('base64');

async function setup(t, { content = 'Saved reply.', fetchImpl = async () => mp3(), config = {}, now } = {}) {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON');
  let textCalls = 0;
  const chat = createChatService({ db, provider: { async generate() { textCalls++; return { content }; } } });
  await chat.submit({ conversationId: 'c1', turnId: 't1', attemptId: 'a1', input: 'Hello' });
  let voice = createVoiceService({ db, chat, config: { apiKey: 'test-secret', audioBytes: 2 * 1024 * 1024, ...config }, fetchImpl, now });
  t.after(() => { voice.close(); chat.close(); db.close(); });
  const request = (extra = {}) => ({ conversationId: 'c1', messageId: 'a1', requestId: randomUUID(), ownerKey: 'owner', ...extra });
  return { db, chat, get voice() { return voice; }, request, textCalls: () => textCalls,
    restartVoice() { voice.close(); voice = createVoiceService({ db, chat, config: { apiKey: 'test-secret', audioBytes: 2 * 1024 * 1024, ...config }, fetchImpl, now }); } };
}

test('speech reads only a completed saved reply and makes no second text call', async t => {
  let body, calls = 0;
  const { voice, request, textCalls } = await setup(t, { fetchImpl: async (url, options) => { calls++; assert.equal(url, 'https://api.openai.com/v1/audio/speech'); body = JSON.parse(options.body); return mp3(); } });
  const result = await voice.speech(request({ input: 'Browser-supplied false answer', voice: 'cedar' }));
  assert.equal(body.input, 'Saved reply.'); assert.equal(body.model, 'gpt-4o-mini-tts'); assert.equal(body.voice, 'cedar');
  assert.equal(result.contentType, 'audio/mpeg'); assert.equal(result.audio.toString(), 'ID3mock-audio');
  assert.equal(calls, 1); assert.equal(textCalls(), 1);
  await assert.rejects(voice.speech(request({ messageId: 'unknown' })), error => error.code === 'voice_reply_unavailable');
  await assert.rejects(voice.speech(request({ voice: 'unknown' })), error => error.code === 'invalid_voice');
  assert.equal(calls, 1);
});

test('speech rejects incomplete, imported and long replies before a provider call', async t => {
  let calls = 0;
  const { voice, db, chat, request } = await setup(t, { fetchImpl: async () => { calls++; return mp3(); } });
  db.prepare("UPDATE chat_attempts SET status='interrupted' WHERE attempt_id='a1'").run();
  await assert.rejects(voice.speech(request()), error => error.code === 'voice_reply_unavailable');
  db.prepare("UPDATE chat_attempts SET status='completed',imported=1 WHERE attempt_id='a1'").run();
  await assert.rejects(voice.speech(request()), error => error.code === 'voice_reply_unavailable');
  db.prepare("UPDATE chat_attempts SET imported=0,content=? WHERE attempt_id='a1'").run('x'.repeat(4097));
  await assert.rejects(voice.speech(request()), error => error.code === 'speech_too_long');
  assert.equal(chat.history('c1').turns[0].content.length, 4097); assert.equal(calls, 0);
});

test('durable speech IDs suppress duplicates and expired or restarted cache never repays automatically', async t => {
  let calls = 0, clock = Date.now();
  const env = await setup(t, { now: () => clock, fetchImpl: async () => { calls++; return mp3(); } });
  const request = env.request();
  assert.equal((await env.voice.speech(request)).cached, false);
  assert.equal((await env.voice.speech(request)).cached, true); assert.equal(calls, 1);
  await assert.rejects(env.voice.speech({ ...request, voice: 'ash' }), error => error.code === 'speech_request_conflict');
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
  release(mp3()); await tick();
  assert.equal(db.prepare('SELECT status FROM speech_requests WHERE request_id=?').get(input.requestId).status, 'uncertain');
  await assert.rejects(voice.speech(input), error => error.code === 'speech_request_uncertain');
  assert.equal(calls, 1);
});

test('speech timeout during a stalled body is visible, bounded, and leaves text usable', async t => {
  const { voice, chat, request } = await setup(t, { config: { audioTimeoutMs: 20 }, fetchImpl: async () => new Response(new ReadableStream({ start() {} }), { headers: { 'Content-Type': 'audio/mpeg' } }) });
  const started = Date.now();
  await assert.rejects(voice.speech(request()), error => error.code === 'voice_timeout');
  assert.ok(Date.now() - started < 1000); assert.equal(chat.history('c1').turns[0].content, 'Saved reply.');
});

test('transcription reuses pinned WAV service with utterance IDs and independent owner sessions', async t => {
  let calls = 0;
  const { voice } = await setup(t, { fetchImpl: async (url, options) => {
    calls++; assert.equal(url, 'https://api.openai.com/v1/audio/transcriptions');
    assert.equal(options.body.get('model'), 'gpt-4o-mini-transcribe');
    return Response.json({ text: 'Hello again', model: 'gpt-4o-mini-transcribe' });
  } });
  const session = voice.start({ conversationId: 'new-conversation', ownerKey: 'owner' });
  const input = { conversationId: session.conversationId, sessionId: session.sessionId, ownerKey: 'owner', requestId: randomUUID(), audioBase64: await wav() };
  assert.equal((await voice.transcribe(input)).text, 'Hello again');
  assert.equal((await voice.transcribe(input)).cached, true); assert.equal(calls, 1);
  await assert.rejects(voice.transcribe({ ...input, ownerKey: 'another-sign-in' }), error => error.code === 'conversation_audio_session_inactive');
  voice.invalidate({ conversationId: input.conversationId, speechOnly: true });
  assert.equal((await voice.transcribe({ ...input, requestId: randomUUID() })).text, 'Hello again');
  voice.invalidate();
  await assert.rejects(voice.transcribe({ ...input, requestId: randomUUID() }), error => error.code === 'conversation_audio_session_inactive');
});

test('empty and oversized recordings fail visibly without repeat paid transcription', async t => {
  let calls = 0;
  const { voice } = await setup(t, { fetchImpl: async () => { calls++; return Response.json({ text: '  ' }); } });
  const session = voice.start({ conversationId: 'c1', ownerKey: 'owner' });
  const input = { conversationId: 'c1', sessionId: session.sessionId, ownerKey: 'owner', requestId: randomUUID(), audioBase64: await wav() };
  await assert.rejects(voice.transcribe(input), error => error.code === 'voice_empty_transcript');
  await assert.rejects(voice.transcribe(input), error => error.code === 'voice_empty_transcript');
  assert.equal(calls, 1);
  await assert.rejects(voice.transcribe({ ...input, requestId: randomUUID(), audioBase64: Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64') }), error => error.code === 'voice_audio_limit');
  assert.equal(calls, 1);
});

test('no-key voice and provider audio failures preserve the completed text', async t => {
  const missing = await setup(t, { config: { apiKey: '' }, fetchImpl: async () => { throw new Error('Must not request without a key'); } });
  assert.equal(missing.voice.options().enabled, false);
  assert.throws(() => missing.voice.start({ conversationId: 'c1', ownerKey: 'owner' }), error => error.code === 'voice_unavailable');
  await assert.rejects(missing.voice.speech(missing.request()), error => error.code === 'voice_unavailable');
  assert.equal(missing.chat.history('c1').turns[0].status, 'completed');
  let calls = 0;
  const failed = await setup(t, { fetchImpl: async () => { calls++; return Response.json({ error: 'secret-provider-error' }, { status: 500 }); } });
  const input = failed.request();
  await assert.rejects(failed.voice.speech(input), error => error.code === 'speech_provider_failed' && !error.message.includes('secret'));
  await assert.rejects(failed.voice.speech(input), error => error.code === 'speech_request_uncertain');
  assert.equal(calls, 1); assert.equal(failed.chat.history('c1').turns[0].content, 'Saved reply.');
});

test('cancelled transcription cannot complete later or repurchase the same utterance', async t => {
  let release, calls = 0;
  const { voice, db } = await setup(t, { fetchImpl: async () => { calls++; return new Promise(resolve => { release = resolve; }); } });
  const session = voice.start({ conversationId: 'c1', ownerKey: 'owner' });
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
  for (const response of [new Response(null, { headers: { 'Content-Type': 'audio/mpeg' } }), Response.json({ text: 'Not audio' }), new Response(Buffer.alloc(65), { headers: { 'Content-Type': 'audio/mpeg' } })]) {
    const { voice, chat, request } = await setup(t, { config: { audioBytes: 64 }, fetchImpl: async () => response });
    await assert.rejects(voice.speech(request()), error => ['speech_provider_format', 'speech_audio_limit'].includes(error.code));
    assert.equal(chat.history('c1').turns[0].status, 'completed');
  }
});
