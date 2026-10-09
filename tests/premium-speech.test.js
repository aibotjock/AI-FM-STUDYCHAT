import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../server/index.js';
import { createStudyCurriculum, combineStudyCurricula } from '../server/study-curriculum.js';
import { renderReviewedTutor } from '../server/natural-tutor.js';
import { createPremiumSpeechService, premiumSpeechText, splitPremiumSpeech, PREMIUM_SPEECH_MODEL, PREMIUM_VOICES, PREMIUM_PREVIEW_TEXT, PREMIUM_SPEECH_LIMITS } from '../server/premium-speech.js';
import { studyCondition, STUDY_NOW } from './fixtures/study-condition.js';

const key = 'synthetic-speech-provider-key-never-a-real-key';
const mp3 = Buffer.from('ID3synthetic-mp3-body-for-local-tests-only');
function audio(body = mp3, headers = {}) { return new Response(body, { headers: { 'Content-Type': 'audio/mpeg', 'x-request-id': 'req_synthetic_speech', ...headers } }); }
function service(t, fetchImpl, { db = new DatabaseSync(':memory:'), now } = {}) {
  const speech = createPremiumSpeechService({ db, env: { OPENAI_API_KEY: key }, fetchImpl, ...(now ? { now } : {}) });
  t.after(() => { speech.close(); db.close(); });
  return { speech, db };
}
const request = (extra = {}) => ({ text: PREMIUM_PREVIEW_TEXT, voice: 'marin', requestId: randomUUID(), scope: 'preview', ...extra });

test('premium chunks retain every character, prefer natural boundaries and never split a surrogate pair', () => {
  const text = ('A study sentence with an emoji 😀 and a complete word. '.repeat(500)).slice(0, 24000);
  const chunks = splitPremiumSpeech(text);
  assert.equal(chunks.join(''), text);
  assert.ok(chunks.length <= 8);
  assert.ok(chunks.every(chunk => chunk.length <= 4096));
  for (const chunk of chunks.slice(0, -1)) assert.match(chunk, /\s$/);
  const surrogate = splitPremiumSpeech('x'.repeat(4095) + '😀tail');
  assert.equal(surrogate.join(''), 'x'.repeat(4095) + '😀tail');
  assert.equal(surrogate[0].length, 4095);
  assert.throws(() => splitPremiumSpeech('x'.repeat(24001)), { code: 'speech_text_limit' });
});

test('all five premium voices use one fixed OpenAI speech endpoint and truthful binary usage metadata', async t => {
  const calls = [];
  const { speech, db } = service(t, async (url, options) => {
    calls.push(JSON.parse(options.body));
    assert.equal(url, 'https://api.openai.com/v1/audio/speech');
    assert.equal(options.headers.Authorization, `Bearer ${key}`);
    assert.equal(options.redirect, 'error');
    return audio();
  });
  for (const voice of PREMIUM_VOICES) {
    const result = await speech.synthesize(request({ voice: voice.id }));
    assert.deepEqual(result.audio, mp3);
    assert.equal(result.cached, false);
    assert.equal(result.metadata.model, 'gpt-4o-mini-tts');
    assert.equal(result.metadata.voice, voice.id);
    assert.equal(result.metadata.providerRequestId, 'req_synthetic_speech');
    assert.equal(result.metadata.usage, null);
    assert.equal(result.metadata.estimatedCostUsd, null);
  }
  assert.deepEqual(calls.map(call => call.voice), ['marin', 'cedar', 'coral', 'sage', 'ash']);
  for (const call of calls) {
    assert.equal(call.model, PREMIUM_SPEECH_MODEL);
    assert.equal(call.input, PREMIUM_PREVIEW_TEXT);
    assert.equal(call.response_format, 'mp3');
    assert.doesNotMatch(JSON.stringify(call), /astra|realtime|url/i);
  }
  const rows = db.prepare('SELECT * FROM premium_speech_requests').all();
  assert.equal(rows.length, 5);
  assert.doesNotMatch(JSON.stringify(rows), /Hello\. I am|ID3synthetic|synthetic-speech-provider-key/);
});

test('speech replay and identical fresh IDs reuse bounded RAM audio while differing voices conflict', async t => {
  let calls = 0;
  const { speech } = service(t, async () => { calls++; return audio(); });
  const firstRequest = request();
  const first = await speech.synthesize(firstRequest);
  const sameId = await speech.synthesize(firstRequest);
  const freshId = await speech.synthesize({ ...firstRequest, requestId: randomUUID() });
  assert.equal(first.cached, false);
  assert.equal(sameId.cached, true);
  assert.equal(freshId.cached, true);
  assert.equal(freshId.metadata.paidRequest, false);
  assert.equal(calls, 1);
  await assert.rejects(speech.synthesize({ ...firstRequest, voice: 'cedar' }), { code: 'speech_request_conflict' });
  assert.equal(calls, 1);
});

test('expired and restarted completed speech IDs cannot automatically regenerate paid audio', async t => {
  let clock = 0, calls = 0;
  const db = new DatabaseSync(':memory:');
  const fetchImpl = async () => { calls++; return audio(); };
  const first = createPremiumSpeechService({ db, env: { OPENAI_API_KEY: key }, fetchImpl, now: () => clock });
  const input = request();
  await first.synthesize(input);
  clock = PREMIUM_SPEECH_LIMITS.cacheTtlMs + 1;
  await assert.rejects(first.synthesize(input), { code: 'speech_audio_expired' });
  first.close();
  const second = createPremiumSpeechService({ db, env: { OPENAI_API_KEY: key }, fetchImpl });
  t.after(() => { second.close(); db.close(); });
  assert.equal(second.inspect(input.requestId).status, 'complete');
  assert.equal(second.inspect(input.requestId).cachedAudioAvailable, false);
  await assert.rejects(second.synthesize(input), { code: 'speech_audio_expired' });
  assert.equal(calls, 1);
});

test('provider failure is durable and uncertain IDs never retry or expose provider details', async t => {
  let calls = 0;
  const { speech } = service(t, async () => { calls++; return new Response(key + ' provider detail', { status: 500 }); });
  const input = request();
  await assert.rejects(speech.synthesize(input), error => error.code === 'speech_provider_failed' && !error.message.includes(key));
  assert.equal(speech.inspect(input.requestId).status, 'uncertain');
  await assert.rejects(speech.synthesize(input), { code: 'speech_request_uncertain' });
  assert.equal(calls, 1);
});

test('speech concurrency is bounded and stopped requests remain uncertain even when fetch ignores abort', async t => {
  let resolveProvider;
  const waiting = new Promise(resolve => { resolveProvider = resolve; });
  const { speech } = service(t, async () => { await waiting; return audio(); });
  const firstInput = request();
  const first = speech.synthesize(firstInput);
  assert.equal(speech.active, 1);
  const secondInput = request({ voice: 'cedar' });
  await assert.rejects(speech.synthesize(secondInput), { code: 'speech_busy' });
  assert.equal(speech.inspect(secondInput.requestId).status, 'not_started');
  speech.invalidate(); resolveProvider();
  await assert.rejects(first, { code: 'speech_request_inactive' });
  assert.equal(speech.active, 0);
  assert.equal(speech.inspect(firstInput.requestId).status, 'uncertain');
});

test('the bounded speech timeout cancels delivery without a retry even if the provider ignores its signal', async t => {
  const db = new DatabaseSync(':memory:');
  let timeout, resolveProvider, calls = 0, cleared = false;
  const provider = new Promise(resolve => { resolveProvider = resolve; });
  const speech = createPremiumSpeechService({ db, env: { OPENAI_API_KEY: key }, fetchImpl: async () => { calls++; await provider; return audio(); }, setTimer(callback, milliseconds) { assert.equal(milliseconds, 45000); timeout = callback; return { unref() {} }; }, clearTimer() { cleared = true; } });
  t.after(() => { speech.close(); db.close(); });
  const input = request();
  const pending = speech.synthesize(input);
  timeout(); resolveProvider();
  await assert.rejects(pending, { code: 'speech_request_inactive' });
  assert.equal(cleared, true);
  assert.equal(calls, 1);
  assert.equal(speech.inspect(input.requestId).status, 'uncertain');
  await assert.rejects(speech.synthesize(input), { code: 'speech_request_uncertain' });
  assert.equal(calls, 1);
});

test('speech audio limits reject excess advertised or streamed bytes and non-MP3 payloads', async t => {
  const scenarios = [
    () => audio(mp3, { 'content-length': String(PREMIUM_SPEECH_LIMITS.maxAudioBytes + 1) }),
    () => audio(Buffer.alloc(PREMIUM_SPEECH_LIMITS.maxAudioBytes + 1)),
    () => audio(mp3, { 'content-type': 'audio/wav' }),
    () => audio('not an MP3'),
  ];
  for (const response of scenarios) {
    const { speech } = service(t, async () => response());
    const input = request();
    await assert.rejects(speech.synthesize(input), error => ['speech_audio_limit', 'speech_provider_format'].includes(error.code));
    assert.equal(speech.inspect(input.requestId).status, 'uncertain');
  }
});

test('an unexpected provider audio format cancels its streaming body before returning an uncertain receipt', async t => {
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(mp3); }, cancel() { cancelled = true; } });
  const { speech } = service(t, async () => new Response(stream, { headers: { 'Content-Type': 'audio/wav' } }));
  const input = request();
  await assert.rejects(speech.synthesize(input), { code: 'speech_provider_format' });
  assert.equal(cancelled, true);
  assert.equal(speech.inspect(input.requestId).status, 'uncertain');
});

test('speech cache evicts at entry and byte limits without repeating an evicted completed UUID', async t => {
  let calls = 0;
  const { speech } = service(t, async () => { calls++; return audio(); });
  const inputs = [];
  for (let index = 0; index < 17; index++) { const input = request({ scope: `message-${index}` }); inputs.push(input); await speech.synthesize(input); }
  await assert.rejects(speech.synthesize(inputs[0]), { code: 'speech_audio_expired' });
  assert.equal((await speech.synthesize(inputs.at(-1))).cached, true);
  assert.equal(calls, 17);
  const large = Buffer.alloc(PREMIUM_SPEECH_LIMITS.maxAudioBytes); large.write('ID3');
  const second = service(t, async () => audio(large)).speech;
  const bigInputs = [];
  for (let index = 0; index < 6; index++) { const input = request({ scope: `large-${index}` }); bigInputs.push(input); await second.synthesize(input); }
  await assert.rejects(second.synthesize(bigInputs[0]), { code: 'speech_audio_expired' });
  assert.equal((await second.synthesize(bigInputs.at(-1))).cached, true);
});

test('speech ledger stays bounded, never erases uncertain identities, and rejects new work at capacity', async t => {
  let calls = 0;
  const { speech, db } = service(t, async () => { calls++; return audio(); });
  const insert = db.prepare('INSERT INTO premium_speech_requests VALUES(?,?,?,?,?)');
  db.exec('BEGIN');
  for (let index = 0; index < PREMIUM_SPEECH_LIMITS.maxLedgerEntries; index++) insert.run(randomUUID(), 'synthetic-fingerprint', 'uncertain', 0, null);
  db.exec('COMMIT');
  await assert.rejects(speech.synthesize(request()), { code: 'speech_ledger_limit' });
  assert.equal(calls, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM premium_speech_requests').get().count, 10000);
});

test('canonical and reviewed speech reconstruction uses exact current server words and citations', () => {
  const curriculum = createStudyCurriculum({ records: [studyCondition()], now: () => STUDY_NOW });
  const references = combineStudyCurricula([curriculum]);
  const conversation = { id: 'speech-study', messages: [{ id: 'u1', role: 'user', content: 'Study asthma' }] };
  const evidence = references.retrieve('Study asthma');
  const canonical = { id: 'a1', role: 'assistant', responseTo: 'u1', ...references.render({ chunkIds: ['asthma:management'], questionId: null, unsupported: false }, evidence) };
  conversation.messages.push(canonical);
  assert.equal(premiumSpeechText({ conversation, message: canonical, references }), canonical.content);
  conversation.messages.push({ id: 'u2', role: 'user', content: 'Explain that point.' });
  const fact = evidence.find(item => item.key === 'asthma:management').text;
  const draft = { segments: [{ id: 's1', text: fact, sourceChunkIds: ['asthma:management'] }] };
  const review = { approved: true, segments: [{ id: 's1', approved: true, externalFactCount: 1, claims: [{ quote: fact, type: 'medical', sourceChunkIds: ['asthma:management'], supports: [{ chunkId: 'asthma:management', excerpt: fact }] }], flags: [] }] };
  const natural = { id: 'a2', role: 'assistant', responseTo: 'u2', ...renderReviewedTutor(draft, review, { references, evidence, conversation, now: STUDY_NOW }) };
  conversation.messages.push(natural);
  assert.equal(premiumSpeechText({ conversation, message: natural, references }), fact);
  assert.notEqual(natural.content, fact, 'Visible citations remain distinct from the exact spoken words.');
});

test('premium voice routes expose five choices, save voice settings and speak only a canonical server question', async t => {
  const dataDir = mkdtempSync(join(tmpdir(), 'fm-premium-route-'));
  const calls = [];
  const curriculum = createStudyCurriculum({ records: [studyCondition()], now: () => STUDY_NOW });
  const server = createApp({ dataDir, curriculum, foundations: createStudyCurriculum({ records: [], now: () => STUDY_NOW }), env: { OPENAI_API_KEY: key }, fetchImpl: async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return audio(); } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await server.closeVoiceSessions(); await new Promise(resolve => server.close(resolve)); rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = async (path, method = 'GET', body) => { const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Origin: base }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, body: await response.json() }; };
  const options = await json('/api/voice/options');
  assert.equal(options.body.enabled, true);
  assert.equal(options.body.defaultVoice, 'marin');
  assert.deepEqual(options.body.voices.map(voice => voice.id), ['marin', 'cedar', 'coral', 'sage', 'ash']);
  assert.match(options.body.disclosure, /AI-generated/);
  assert.equal((await json('/api/settings', 'PUT', { voiceId: 'cedar' })).body.voiceId, 'cedar');
  assert.equal((await json('/api/settings', 'PUT', { voiceId: 'invented' })).status, 400);
  const conversation = (await json('/api/conversations', 'POST', { mode: 'coach', conditionId: 'asthma' })).body;
  const chat = await json('/api/chat', 'POST', { conversationId: conversation.id, content: 'Quiz me on asthma' });
  assert.equal(calls.length, 0);
  const speechInput = { conversationId: conversation.id, messageId: chat.body.message.id, voice: 'cedar', chunkIndex: 0, requestId: randomUUID() };
  const response = await fetch(base + '/api/voice/speech', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(speechInput) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'audio/mpeg');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-study-speech-chunks'), '1');
  assert.equal(response.headers.get('x-study-speech-model'), PREMIUM_SPEECH_MODEL);
  assert.equal(response.headers.get('x-study-speech-usage'), 'unknown');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), mp3);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.input, chat.body.message.content);
  const check = await json('/api/voice/check/' + speechInput.requestId);
  assert.equal(check.body.status, 'complete');
  assert.equal(check.body.metadata.usage, null);
  assert.equal(check.body.metadata.estimatedCostUsd, null);
  assert.doesNotMatch(JSON.stringify(check.body), /Fictional study vignette|ID3synthetic|synthetic-speech-provider-key/);
});
