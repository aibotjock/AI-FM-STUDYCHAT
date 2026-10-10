import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPremiumSpeechPlayer } from '../public/premium-speech.js';

const tick = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
const reply = { conversationId: 'authorized-study-conversation', messageId: 'reviewed-study-reply' };
const bytes = [Buffer.from('ID3approved-'), Buffer.from('same-recording-'), Buffer.from('frames')];

function harness(t, { waitForFrames = false, permissionDenied = false, progressing = false } = {}) {
  let time = 0, nextTimer = 0, nextUrl = 0;
  const timers = new Map(), objects = new Map(), audios = [], sources = [], calls = [], blocked = [];
  const pending = [];
  const doc = new EventTarget(); doc.hidden = false;
  class SourceBuffer extends EventTarget {
    appendBuffer(value) { this.chunks.push(Buffer.from(value)); queueMicrotask(() => this.dispatchEvent(new Event('updateend'))); }
    constructor() { super(); this.chunks = []; }
  }
  class MediaSource extends EventTarget {
    static isTypeSupported(type) { return type === 'audio/mpeg'; }
    constructor() { super(); this.readyState = 'closed'; sources.push(this); }
    addSourceBuffer() { this.buffer = new SourceBuffer(); return this.buffer; }
    endOfStream() { this.readyState = 'ended'; for (const resolve of pending.splice(0)) resolve(); }
  }
  class Audio {
    constructor(url) {
      this.url = url; this.object = objects.get(url); this.paused = true; this.ended = false;
      this.currentTime = 0; this.duration = NaN; this.playCalls = 0; audios.push(this);
      if (this.object instanceof MediaSource) queueMicrotask(() => { this.object.readyState = 'open'; this.object.dispatchEvent(new Event('sourceopen')); });
    }
    play() {
      this.playCalls++;
      if (permissionDenied) return Promise.reject(Object.assign(new Error('Audio needs a gesture.'), { name: 'NotAllowedError' }));
      this.paused = false;
      if (this.object instanceof MediaSource && waitForFrames && this.object.readyState !== 'ended') return new Promise(resolve => pending.push(resolve));
      this.onplaying?.();
      if (progressing || this.object instanceof Blob) { this.currentTime = .1; this.ontimeupdate?.(); }
      return Promise.resolve();
    }
    pause() { this.paused = true; this.onpause?.(); }
    removeAttribute() {}
    load() {}
    end() { this.ended = true; this.onended?.(); }
  }
  const win = new EventTarget();
  Object.assign(win, {
    Audio, Blob, MediaSource, AbortController, crypto: { randomUUID },
    setTimeout(fn, delay = 0) { const id = ++nextTimer; timers.set(id, { fn, at: time + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    URL: { createObjectURL(value) { const url = `blob:mobile-${++nextUrl}`; objects.set(url, value); return url; }, revokeObjectURL(url) { objects.delete(url); } },
  });
  const player = createPremiumSpeechPlayer({ windowImpl: win, documentImpl: doc, now: () => time,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(new ReadableStream({ start(controller) { for (const value of bytes) controller.enqueue(value); controller.close(); } }), { headers: {
        'Content-Type': 'audio/mpeg', 'X-Study-Speech-Chunks': '1', 'X-Study-Speech-Chunk': '0',
        'X-Study-Speech-Voice': 'marin', 'X-Study-Speech-Model': 'gpt-4o-mini-tts', 'X-Study-Speech-Streaming': '1',
      } });
    },
  });
  t.after(() => { player.destroy(); for (const resolve of pending.splice(0)) resolve(); });
  async function advance(amount) {
    const target = time + amount;
    for (let count = 0; ; count++) {
      assert(count < 100, 'Bounded fake timer traversal.');
      const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]); time = next[1].at; next[1].fn(); await tick();
    }
    time = target; await tick();
  }
  return { player, audios, sources, calls, blocked, advance, options: { ...reply, onBlocked: (message, metadata) => blocked.push({ message, metadata }) } };
}

test('pending streaming play does not block later MP3 frames or end-of-stream', async t => {
  const h = harness(t, { waitForFrames: true });
  const playback = h.player.play(h.options); await tick();
  assert.equal(h.sources[0].buffer.chunks.length, bytes.length, 'A pending play promise must not block the response reader.');
  assert.equal(h.sources[0].readyState, 'ended');
  await playback;
  assert.equal(h.calls.length, 1);
  assert.equal(h.player.state().audioBlocked, false);
});

test('silent MSE startup falls back promptly to exactly the downloaded approved recording without paid retry', async t => {
  const h = harness(t); let started = 0, ended = 0;
  await h.player.play({ ...h.options, onStart: () => started++, onEnd: () => ended++ });
  assert.equal(h.audios.length, 1);
  await h.advance(3000);
  assert.equal(h.audios.length, 2, 'A decoder stall is recovered before the twelve-second generic watchdog.');
  assert.equal(h.player.state().transport, 'buffered-fallback');
  assert.equal(h.player.state().phase, 'playing');
  assert.equal(h.blocked.length, 0, 'Decoder stalls are not misreported as a permission denial.');
  assert.deepEqual(Buffer.from(await h.audios[1].object.arrayBuffer()), Buffer.concat(bytes));
  assert.equal(h.calls.length, 1);
  assert.equal(h.player.state().completedChunks, 0);
  h.audios[1].end(); assert.equal(ended, 1);
  assert.equal(started, 1, 'Fallback must not announce a second tutor playback start.');
});

test('explicit autoplay rejection keeps prepared audio for gesture resume and never auto-retries a paid request', async t => {
  const h = harness(t, { permissionDenied: true });
  await h.player.play(h.options); await h.advance(5000);
  assert.equal(h.player.state().phase, 'paused');
  assert.equal(h.player.state().audioBlocked, true);
  assert.equal(h.audios.length, 1);
  assert.equal(h.blocked.length, 1);
  assert.equal(h.blocked[0].metadata.reason, 'permission');
  assert.equal(h.player.state().blockReason, 'permission');
  assert.equal(h.calls.length, 1);
  assert.equal(h.sources[0].buffer.chunks.length, bytes.length, 'Permission denial must not prevent preserving the authorized recording.');
});

test('advancing stream is not replaced and cancellation suppresses a pending recovery', async t => {
  const h = harness(t, { progressing: true });
  await h.player.play(h.options); await h.advance(3000);
  assert.equal(h.audios.length, 1);
  assert.equal(h.player.state().transport, 'streaming');
  h.player.stop(); await h.advance(3000);
  assert.equal(h.audios.length, 1);
  assert.equal(h.player.active(), false);
  assert.equal(h.calls.length, 1);
});

test('a buffered playback stall reports its actual reason and retains the same authorized audio', async t => {
  const h = harness(t);
  await h.player.play(h.options); await h.advance(3000);
  const prepared = h.audios[1];
  await h.advance(12000);
  assert.equal(h.player.state().phase, 'paused');
  assert.equal(h.player.state().blockReason, 'stalled');
  assert.equal(h.blocked[0].metadata.reason, 'stalled');
  assert.equal(h.audios[1], prepared);
  assert.equal(h.calls.length, 1);
});

test('resuming previously audible playback emits a new start notification using the same recording', async t => {
  const h = harness(t, { progressing: true });
  let starts = 0;
  await h.player.play({ ...h.options, onStart: () => starts++ });
  const prepared = h.audios[0];
  assert.equal(starts, 1);
  prepared.pause();
  assert.equal(h.player.state().phase, 'paused');
  assert.equal(h.blocked[0].metadata.reason, 'paused');
  await h.player.resume();
  assert.equal(h.player.state().phase, 'playing');
  assert.equal(starts, 2, 'The conversation core needs a fresh start event after recovery.');
  assert.equal(h.audios[0], prepared);
  assert.equal(h.calls.length, 1);
  assert.equal(h.player.state().completedChunks, 0);
  await h.player.resume();
  assert.equal(starts, 2, 'An uninterrupted playing interval must not emit duplicate starts.');
});
