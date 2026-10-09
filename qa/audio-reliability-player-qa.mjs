import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createPremiumSpeechPlayer } from '../public/premium-speech.js';
import { createSourcedVoiceCoach } from '../public/sourced-voice.js';

// Only the new media-event/watchdog paths are exercised. The audio and clock
// never leave this process, and authenticated fetch is a deterministic mock.
const results = [];
const runStartedAt = Date.now();
const selected = process.env.QA_SCOPES ? new Set(process.env.QA_SCOPES.split(',').map(Number)) : null;
const flush = async () => { for (let index = 0; index < 4; index++) await new Promise(resolve => setImmediate(resolve)); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fakeClock() {
  let now = 0, sequence = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(callback, delay = 0) {
      const id = ++sequence;
      timers.set(id, { callback, due: now + Math.max(0, Number(delay) || 0) });
      return id;
    },
    clearTimeout: id => timers.delete(id),
    async advance(amount) {
      const target = now + amount;
      let executions = 0;
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.due <= target).sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
        if (!next) break;
        assert(++executions <= 10000, 'fake clock must not loop through unbounded zero-delay timers');
        timers.delete(next[0]); now = next[1].due; next[1].callback(); await flush();
      }
      now = target; await flush();
    },
    pending: () => timers.size,
  };
}
function response(body, count = 1) {
  return new Response('ID3mock-audio-watchdog', { headers: {
    'Content-Type': 'audio/mpeg', 'X-Study-Speech-Chunks': String(count),
    'X-Study-Speech-Chunk': String(body.chunkIndex || 0),
    'X-Study-Speech-Voice': body.voice, 'X-Study-Speech-Model': 'gpt-4o-mini-tts',
  } });
}
function harness({ count = 1, fetcher, initialPlay = 'resolved' } = {}) {
  const clock = fakeClock(), document = new EventTarget(), window = new EventTarget();
  const calls = [], audio = [], states = [], revoked = [], pendingPlays = [];
  let nextPlay = initialPlay, legacySpeechCalls = 0;
  document.hidden = false;
  window.Audio = class {
    constructor(url) {
      this.url = url; this.plays = 0; this.pauses = 0;
      this.currentTime = 0; this.duration = 20; this.ended = false;
      this.paused = true; this.volume = .4; audio.push(this);
    }
    play() {
      this.plays++; this.paused = false;
      const mode = nextPlay; nextPlay = 'resolved';
      if (mode === 'pending') { const pending = deferred(); pendingPlays.push(pending); return pending.promise; }
      if (mode === 'blocked') return Promise.reject(Object.assign(new Error('gesture needed'), { name: 'NotAllowedError' }));
      return Promise.resolve();
    }
    pause() { this.pauses++; this.paused = true; this.onpause?.(); }
    removeAttribute() {}
    load() {}
    event(name) { this[`on${name}`]?.(); }
  };
  window.URL = { createObjectURL: () => `blob:watchdog-${audio.length}`, revokeObjectURL: url => revoked.push(url) };
  window.crypto = { randomUUID }; window.AbortController = AbortController; window.isSecureContext = true;
  window.setTimeout = clock.setTimeout; window.clearTimeout = clock.clearTimeout;
  window.speechSynthesis = { cancel() {}, speak() { legacySpeechCalls++; throw new Error('Device speech must never be substituted'); } };
  const player = createPremiumSpeechPlayer({
    windowImpl: window, documentImpl: document, now: clock.now, playbackWatchdogMs: 12000,
    getVoice: () => 'marin', onState: state => states.push(state),
    fetchImpl: async (path, options) => {
      const body = JSON.parse(options.body); calls.push({ path, body, signal: options.signal });
      return fetcher ? fetcher(body, options, calls.length) : response(body, count);
    },
  });
  return { clock, window, document, calls, audio, states, revoked, pendingPlays, player,
    setPlayMode: mode => { nextPlay = mode; }, legacySpeechCalls: () => legacySpeechCalls };
}
const savedReply = { conversationId: 'saved-conversation', messageId: 'checked-message' };
let scope = 0;
async function check(name, run) {
  const index = scope++;
  if (selected && !selected.has(index)) return;
  try { await run(); results.push({ scope: index, name, pass: true }); }
  catch (error) { results.push({ scope: index, name, pass: false, error: error.stack }); }
  console.log(JSON.stringify(results.at(-1)));
}

await check('pending play promise times out safely; gesture resume retains the exact prepared buffer without another request', async () => {
  const h = harness({ initialPlay: 'pending' });
  let started = 0, ended = 0; const blocked = [];
  try {
    const beginning = h.player.play({ ...savedReply, onStart: () => started++, onEnd: () => ended++, onBlocked: message => blocked.push(message) });
    await flush();
    assert.equal(h.calls.length, 1); assert.equal(h.audio.length, 1); assert.equal(h.audio[0].plays, 1);
    assert.equal(h.player.state().phase, 'starting', 'calling play() is not evidence that audio is playing');
    assert.equal(h.player.state().firstAudioMs, null); assert.equal(started, 0);
    await h.clock.advance(11999); assert.equal(blocked.length, 0);
    await h.clock.advance(1);
    assert.equal(h.player.state().phase, 'paused'); assert.equal(h.player.state().audioBlocked, true);
    assert.equal(blocked.length, 1); assert.match(blocked[0], /audio|play|resume/i);
    assert.equal(h.audio[0].paused, true); assert.equal(ended, 0); assert.equal(h.revoked.length, 0);
    const buffered = h.audio[0];
    const resuming = h.player.resume(); await flush();
    assert.equal(h.player.state().phase, 'starting'); assert.equal(h.audio[0], buffered);
    assert.equal(h.calls.length, 1); assert.equal(h.audio.length, 1); assert.equal(buffered.plays, 2);
    buffered.event('playing'); await resuming;
    assert.equal(h.player.state().phase, 'playing'); assert.equal(started, 1);
    assert.equal(h.player.state().firstAudioMs, 12000); assert(h.player.state().elapsedMs >= 12000);
    h.pendingPlays[0].resolve(); await beginning;
    assert.equal(h.player.state().phase, 'playing', 'the stale play-promise completion must not undo the successful gesture resume');
    buffered.ended = true; buffered.event('ended');
    assert.equal(ended, 1); assert.equal(h.player.active(), false); assert.equal(h.revoked.length, 1);
    assert.equal(h.legacySpeechCalls(), 0);
  } finally { h.player.destroy(); }
});

await check('real time progress resets the bounded stall watchdog; waiting and stalled events show buffering without false completion', async () => {
  const h = harness(); let ended = 0; const blocked = [];
  try {
    await h.player.play({ ...savedReply, onEnd: () => ended++, onBlocked: message => blocked.push(message) });
    const media = h.audio[0]; assert.equal(h.player.state().phase, 'starting');
    media.event('playing'); assert.equal(h.player.state().phase, 'playing'); assert.equal(h.player.state().firstAudioMs, 0);
    await h.clock.advance(6000); media.currentTime = 1; media.event('timeupdate');
    assert.equal(h.player.state().currentTime, 1); assert.equal(h.player.state().duration, 20);
    assert.equal(h.player.state().chunkIndex, 0); assert.equal(h.player.state().chunkCount, 1);
    assert(h.player.state().elapsedMs >= 6000); media.event('waiting');
    assert.equal(h.player.state().phase, 'buffering');
    await h.clock.advance(6000); media.currentTime = 2; media.event('timeupdate');
    assert.equal(h.player.state().phase, 'playing', 'advancing media time is playback evidence even without another playing event');
    await h.clock.advance(11999); assert.equal(blocked.length, 0);
    await h.clock.advance(1); assert.equal(blocked.length, 1); assert.equal(h.player.state().phase, 'paused');
    assert.equal(ended, 0); assert.equal(h.calls.length, 1); assert.equal(h.audio.length, 1);
    await h.player.resume(); media.event('playing'); media.event('stalled');
    assert.equal(h.player.state().phase, 'buffering');
    await h.clock.advance(12000); assert.equal(blocked.length, 2); assert.equal(ended, 0);
    assert.equal(h.calls.length, 1); assert.equal(media.volume, .4); assert.equal(h.legacySpeechCalls(), 0);
  } finally { h.player.destroy(); }
});

await check('external media pause offers same-buffer resume and preserves the user media volume', async () => {
  const h = harness(); let ended = 0; const blocked = [];
  try {
    await h.player.play({ ...savedReply, onEnd: () => ended++, onBlocked: message => blocked.push(message) });
    const media = h.audio[0]; media.event('playing'); media.currentTime = 3; media.event('timeupdate');
    media.pause();
    assert.equal(h.player.state().phase, 'paused'); assert.equal(h.player.state().audioBlocked, true);
    assert.equal(blocked.length, 1); assert.match(blocked[0], /audio|play|resume/i);
    await h.clock.advance(24000); assert.equal(blocked.length, 1, 'already paused media must not keep raising watchdog callbacks');
    await h.player.resume(); assert.equal(h.player.state().phase, 'starting');
    media.event('playing'); assert.equal(h.player.state().phase, 'playing');
    assert.equal(media.currentTime, 3); assert.equal(media.volume, .4);
    assert.equal(h.calls.length, 1); assert.equal(h.audio.length, 1); assert.equal(media.plays, 2); assert.equal(ended, 0);
    media.ended = true; media.event('ended'); assert.equal(ended, 1); assert.equal(h.legacySpeechCalls(), 0);
  } finally { h.player.destroy(); }
});

await check('continuous mic resumes once after all confirmed chunks; missing ended event is handled only by the native ended flag', async () => {
  const h = harness({ count: 2 }), recognitions = [], turns = [];
  h.window.SpeechRecognition = class {
    constructor() { recognitions.push(this); }
    start() { queueMicrotask(() => this.onstart?.()); }
    stop() { this.stopped = true; queueMicrotask(() => this.onend?.()); }
    abort() { this.aborted = true; }
  };
  const coach = createSourcedVoiceCoach({ windowImpl: h.window, documentImpl: h.document, navigatorImpl: { language: 'en-US' }, speechPlayer: h.player,
    sendTurn: async turn => { assert.equal(recognitions[0].stopped, true); turns.push(turn); return { messageId: savedReply.messageId, content: 'Checked complete response.', readoutAllowed: true }; } });
  try {
    await coach.start({ conversationId: savedReply.conversationId }); await flush();
    recognitions[0].onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'Explain this study point' }], { isFinal: true })] });
    await flush(); assert.equal(turns.length, 1); assert.equal(recognitions.length, 1); assert.equal(h.calls.length, 1);
    const first = h.audio[0], staleFirstEnd = first.onended;
    assert.equal(h.player.state().phase, 'starting'); first.event('playing'); assert.equal(coach.state().phase, 'speaking');
    first.duration = 5; first.currentTime = 5; first.ended = true; first.event('timeupdate'); await flush();
    assert.equal(h.calls.length, 2); assert.equal(h.calls[1].body.chunkIndex, 1); assert.equal(recognitions.length, 1);
    assert.equal(coach.state().phase, 'preparing-audio', 'server preparation for the next part must not claim that Coach is already speaking');
    staleFirstEnd?.(); staleFirstEnd?.(); await flush(); assert.equal(h.calls.length, 2);
    const last = h.audio[1]; last.event('playing'); last.duration = 5; last.currentTime = 5; last.ended = false; last.event('timeupdate');
    await h.clock.advance(12000);
    assert.equal(h.player.state().phase, 'paused'); assert.equal(coach.state().phase, 'paused'); assert.equal(coach.state().audioBlocked, true);
    assert.equal(recognitions.length, 1, 'near-duration time cannot stand in for a confirmed end');
    await coach.playAudio(); assert.equal(h.calls.length, 2); assert.equal(h.audio.length, 2); assert.equal(last.plays, 2);
    last.event('playing'); const staleLastEnd = last.onended; last.ended = true; last.event('timeupdate'); await flush();
    staleLastEnd?.(); staleLastEnd?.(); await flush();
    assert.equal(recognitions.length, 2); assert.equal(coach.state().phase, 'listening'); assert.equal(h.player.active(), false);
    assert.equal(h.calls.length, 2); assert.equal(turns.length, 1);
    for (const call of h.calls) assert.deepEqual(Object.keys(call.body).sort(), ['chunkIndex', 'conversationId', 'messageId', 'requestId', 'voice']);
    assert.equal(h.legacySpeechCalls(), 0);
  } finally { coach.destroy(); h.player.destroy(); }
});

await check('stopwatch resets per operation; stop, abort and background discard stale media callbacks and watchdog timers', async () => {
  const h = harness({ count: 2 }); let ended = 0, blocked = 0;
  const callbacks = { onEnd: () => ended++, onBlocked: () => blocked++ };
  const captured = media => ['playing', 'waiting', 'stalled', 'pause', 'timeupdate', 'ended'].map(name => media[`on${name}`]).filter(Boolean);
  try {
    await h.player.play({ ...savedReply, ...callbacks }); const first = h.audio[0]; first.event('playing');
    await h.clock.advance(5000); first.currentTime = 2; first.event('timeupdate'); assert(h.player.state().elapsedMs >= 5000);
    const stale = captured(first); h.player.stop();
    assert.equal(h.player.state().phase, 'idle'); assert.equal(h.player.state().elapsedMs, 0);
    assert.equal(h.player.state().firstAudioMs, null); assert.equal(h.clock.pending(), 0);
    for (const callback of stale) callback(); await h.clock.advance(24000);
    assert.equal(h.calls.length, 1); assert.equal(ended, 0); assert.equal(blocked, 0); assert.equal(h.player.active(), false);
    const external = new AbortController(); await h.player.play({ ...savedReply, signal: external.signal, ...callbacks });
    const second = h.audio[1]; assert.equal(h.player.state().elapsedMs, 0); assert.equal(h.player.state().firstAudioMs, null);
    second.event('playing'); const aborted = captured(second); external.abort();
    for (const callback of aborted) callback(); await h.clock.advance(12000);
    assert.equal(h.calls.length, 2); assert.equal(h.player.active(), false); assert.equal(h.clock.pending(), 0);
    await h.player.play({ ...savedReply, ...callbacks }); const third = h.audio[2]; third.event('playing');
    const hidden = captured(third); h.document.hidden = true; h.document.dispatchEvent(new Event('visibilitychange'));
    for (const callback of hidden) callback(); await h.clock.advance(24000);
    assert.equal(h.calls.length, 3); assert.equal(ended, 0); assert.equal(blocked, 0); assert.equal(h.revoked.length, 3);
    assert.equal(h.player.active(), false); assert.equal(h.clock.pending(), 0); assert.equal(h.legacySpeechCalls(), 0);
  } finally { h.player.destroy(); }
});

const ledgerPath = new URL('./audio-reliability-player-results.json', import.meta.url);
const previous = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8')) : { attempts: [] };
const attempt = { runAt: new Date(runStartedAt).toISOString(), completedAt: new Date().toISOString(), durationMs: Date.now() - runStartedAt,
  reason: process.env.QA_RUN_REASON || 'Initial execution of novel audio reliability scopes or correction of a recorded failing scope',
  selectedScopes: selected ? [...selected] : 'all-new-scopes', paidProviderCalls: 0,
  scope: 'Only new premium media-event, progress-watchdog, same-buffer resume, completion and cancellation paths. Fake media and clock; no physical-phone sound quality or volume claim.', results };
writeFileSync(ledgerPath, JSON.stringify({ ...previous, attempts: [...(previous.attempts || []), attempt] }, null, 2));
if (results.some(result => !result.pass)) process.exitCode = 1;
