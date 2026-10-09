import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { createPremiumSpeechService, PREMIUM_PREVIEW_TEXT, PREMIUM_SPEECH_LIMITS } from '../server/premium-speech.js';
import { createPremiumSpeechPlayer } from '../public/premium-speech.js';

const mp3 = Buffer.from('ID3synthetic-streaming-audio-not-a-live-provider-call');
const turn = () => ({ text: PREMIUM_PREVIEW_TEXT, voice: 'marin', requestId: randomUUID(), scope: 'local-stream-test' });
const tick = () => new Promise(resolve => setImmediate(resolve));
function controlledAudio() {
  let controller, cancelled = false;
  const body = new ReadableStream({ start(value) { controller = value; }, cancel() { cancelled = true; } });
  return { response: new Response(body, { headers: { 'Content-Type': 'audio/mpeg', 'x-request-id': 'req_local_stream' } }), push: value => controller.enqueue(value), end: () => controller.close(), cancelled: () => cancelled };
}
function service(t, fetchImpl) {
  const db = new DatabaseSync(':memory:');
  const speech = createPremiumSpeechService({ db, env: { OPENAI_API_KEY: 'synthetic-stream-key-only' }, fetchImpl });
  t.after(() => { speech.close(); db.close(); });
  return speech;
}

test('approved service streams validated initial bytes before EOF and cached replay does not repeat paid work', async t => {
  const provider = controlledAudio(); let calls = 0, delivered;
  const firstBytes = new Promise(resolve => { delivered = resolve; });
  const speech = service(t, async () => { calls++; return provider.response; });
  const input = turn(), emitted = [];
  const pending = speech.synthesize({ ...input, onAudio(bytes, receipt) { emitted.push(Buffer.from(bytes)); delivered(receipt); } });
  provider.push(mp3.subarray(0, 2)); await tick();
  assert.equal(emitted.length, 0, 'No unvalidated prefix is released.');
  provider.push(mp3.subarray(2, 10));
  const first = await firstBytes;
  assert.equal(first.cached, false);
  assert.equal(first.metadata.providerRequestId, 'req_local_stream');
  assert.equal(speech.inspect(input.requestId).status, 'pending');
  provider.push(mp3.subarray(10)); provider.end();
  const result = await pending;
  assert.deepEqual(Buffer.concat(emitted), mp3);
  assert.deepEqual(result.audio, mp3);
  assert.equal(speech.inspect(input.requestId).status, 'complete');
  assert.equal(result.metadata.usage, null);
  assert.equal(result.metadata.estimatedCostUsd, null);
  const replay = [];
  assert.equal((await speech.synthesize({ ...input, onAudio(bytes) { replay.push(Buffer.from(bytes)); } })).cached, true);
  assert.deepEqual(Buffer.concat(replay), mp3);
  assert.equal(calls, 1);
});

test('source authorization is rechecked before every released audio segment and uncertain work never retries', async t => {
  const provider = controlledAudio(); let active = true, calls = 0, first;
  const started = new Promise(resolve => { first = resolve; });
  const speech = service(t, async () => { calls++; return provider.response; });
  const input = turn(), emitted = [];
  const pending = speech.synthesize({ ...input, authorize: () => active, onAudio(bytes) { emitted.push(bytes); first(); } });
  const rejected = assert.rejects(pending, { code: 'speech_request_inactive' });
  provider.push(mp3.subarray(0, 12)); await started;
  active = false; provider.push(mp3.subarray(12));
  await rejected;
  assert.equal(emitted.length, 1);
  assert.equal(provider.cancelled(), true);
  assert.equal(speech.inspect(input.requestId).status, 'uncertain');
  assert.equal(speech.inspect(input.requestId).cachedAudioAvailable, false);
  assert.equal(speech.inspect(input.requestId).metadata.estimatedCostUsd, null);
  active = true;
  await assert.rejects(speech.synthesize(input), { code: 'speech_request_uncertain' });
  assert.equal(calls, 1);
});

test('abort stops a stalled provider body promptly and records unknown cancellation billing', async t => {
  const provider = controlledAudio(), controller = new AbortController(); let first;
  const started = new Promise(resolve => { first = resolve; });
  const speech = service(t, async () => provider.response), input = turn();
  const pending = speech.synthesize({ ...input, signal: controller.signal, onAudio() { first(); } });
  const rejected = assert.rejects(pending, { code: 'speech_request_inactive' });
  provider.push(mp3); await started;
  controller.abort(); await rejected;
  assert.equal(provider.cancelled(), true);
  const receipt = speech.inspect(input.requestId);
  assert.equal(receipt.status, 'uncertain');
  assert.equal(receipt.metadata.cancelled, true);
  assert.equal(receipt.metadata.billingOutcome, 'unknown');
  assert.equal(receipt.metadata.usage, null);
});

test('invalid MP3 and oversized stream segments cannot be emitted or cached', async t => {
  for (const bytes of [Buffer.from('INVALID'), Buffer.alloc(PREMIUM_SPEECH_LIMITS.maxAudioBytes + 1)]) {
    const speech = service(t, async () => new Response(bytes, { headers: { 'Content-Type': 'audio/mpeg' } }));
    let delivered = false; const input = turn();
    await assert.rejects(speech.synthesize({ ...input, onAudio() { delivered = true; } }), error => ['speech_audio_limit', 'speech_provider_format'].includes(error.code));
    assert.equal(delivered, false);
    assert.equal(speech.inspect(input.requestId).cachedAudioAvailable, false);
  }
});

function playerHarness(t, { mse = true, decoderFailure = false, response } = {}) {
  const objects = new Map(), audios = [], calls = [], sources = [], progress = [];
  const doc = new EventTarget(); doc.hidden = false;
  class SourceBuffer extends EventTarget {
    appendBuffer(bytes) {
      if (decoderFailure) throw new Error('Local unsupported decoder fixture.');
      this.bytes = (this.bytes || 0) + bytes.byteLength;
      queueMicrotask(() => this.dispatchEvent(new Event('updateend')));
    }
  }
  class MediaSource extends EventTarget {
    static isTypeSupported(type) { return mse && type === 'audio/mpeg'; }
    constructor() { super(); this.readyState = 'closed'; sources.push(this); }
    addSourceBuffer() { this.buffer = new SourceBuffer(); return this.buffer; }
    endOfStream() { this.readyState = 'ended'; }
  }
  class Audio {
    constructor(url) {
      this.url = url; this.paused = true; this.ended = false; this.currentTime = 0; this.duration = NaN; this.playCalls = 0; audios.push(this);
      const object = objects.get(url);
      if (object instanceof MediaSource) queueMicrotask(() => { object.readyState = 'open'; object.dispatchEvent(new Event('sourceopen')); });
    }
    async play() { this.playCalls++; this.paused = false; this.onplaying?.(); }
    pause() { this.paused = true; this.onpause?.(); }
    removeAttribute() {}
    load() {}
    end() { this.ended = true; this.onended?.(); }
  }
  const win = new EventTarget();
  Object.assign(win, { Audio, Blob, MediaSource, AbortController, crypto: { randomUUID }, setTimeout, clearTimeout, URL: { createObjectURL(value) { const id = `blob:local-${objects.size}`; objects.set(id, value); return id; }, revokeObjectURL(id) { objects.delete(id); } } });
  const player = createPremiumSpeechPlayer({ windowImpl: win, documentImpl: doc, fetchImpl: async (path, options) => {
    calls.push({ path, body: JSON.parse(options.body), headers: options.headers });
    return response || new Response(mp3, { headers: speechHeaders() });
  } });
  t.after(() => player.destroy());
  return { player, audios, calls, sources, progress, options: { conversationId: 'trusted-conversation', messageId: 'trusted-message', onProgress: value => progress.push(value) } };
}
function speechHeaders(overrides = {}) {
  return { 'Content-Type': 'audio/mpeg', 'X-Study-Speech-Chunks': '1', 'X-Study-Speech-Chunk': '0', 'X-Study-Speech-Voice': 'marin', 'X-Study-Speech-Model': 'gpt-4o-mini-tts', 'X-Study-Speech-Streaming': '1', ...overrides };
}

test('supported player starts approved audio before download completion and checkpoints only ended chunks', async t => {
  const provider = controlledAudio();
  const response = new Response(provider.response.body, { headers: speechHeaders() });
  const h = playerHarness(t, { response }); let started, ends = 0; const chunks = [];
  const playing = new Promise(resolve => { started = resolve; });
  const pending = h.player.play({ ...h.options, onStart: started, onEnd: () => ends++, onChunkEnd: value => chunks.push(value) });
  provider.push(mp3.subarray(0, 12)); await playing;
  assert.equal(h.player.state().phase, 'playing');
  assert.equal(h.player.state().transport, 'streaming');
  assert.equal(h.player.state().completedChunks, 0);
  assert.equal(chunks.length, 0);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].headers['X-Study-Speech-Stream'], '1');
  provider.push(mp3.subarray(12)); provider.end(); await pending;
  assert.equal(h.sources[0].readyState, 'ended');
  h.audios[0].end();
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].completedChunks, 1);
  assert.equal(ends, 1);
});

test('MSE decoder failure reuses the same response bytes as buffered playback without another request', async t => {
  const h = playerHarness(t, { decoderFailure: true }); let errors = 0;
  await h.player.play({ ...h.options, onError: () => errors++ });
  assert.equal(h.calls.length, 1);
  assert.equal(errors, 0);
  assert.equal(h.audios.length, 2);
  assert.equal(h.audios[1].playCalls, 1);
  assert.equal(h.player.state().transport, 'buffered-fallback');
  assert.equal(h.player.state().phase, 'playing');
});

test('a late MSE decoder error resumes the downloaded recording from its conservative playback time', async t => {
  const h = playerHarness(t);
  await h.player.play(h.options);
  h.audios[0].currentTime = 1.25;
  h.sources[0].buffer.dispatchEvent(new Event('error'));
  await tick();
  assert.equal(h.calls.length, 1);
  assert.equal(h.audios.length, 2);
  h.audios[1].onloadedmetadata();
  assert.equal(h.audios[1].currentTime, 1.25);
  assert.equal(h.audios[1].playCalls, 1);
  assert.equal(h.player.state().phase, 'playing');
  assert.equal(h.player.state().completedChunks, 0);
});

test('unsupported MSE uses existing buffered path and prepares no alternative provider voice', async t => {
  const h = playerHarness(t, { mse: false });
  await h.player.play(h.options);
  assert.equal(h.calls[0].headers['X-Study-Speech-Stream'], undefined);
  assert.equal(h.sources.length, 0);
  assert.equal(h.audios.length, 1);
  assert.equal(h.player.state().transport, 'buffered');
  assert.equal(h.calls[0].body.voice, 'marin');
});

test('stopping mid-download cancels the body and prevents stale callbacks or speech restart', async t => {
  const provider = controlledAudio(), response = new Response(provider.response.body, { headers: speechHeaders() });
  const h = playerHarness(t, { response }); let started, ends = 0, errors = 0;
  const playing = new Promise(resolve => { started = resolve; });
  const pending = h.player.play({ ...h.options, onStart: started, onEnd: () => ends++, onError: () => errors++ });
  provider.push(mp3); await playing;
  const staleEnded = h.audios[0].onended;
  h.player.stop(); await pending;
  staleEnded();
  assert.equal(provider.cancelled(), true);
  assert.equal(h.player.state().active, false);
  assert.equal(h.audios[0].paused, true);
  assert.equal(ends, 0);
  assert.equal(errors, 0);
  assert.equal(h.calls.length, 1);
});
