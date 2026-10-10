export const COACH_VOICES = Object.freeze([
  { id: 'marin', label: 'Marin' }, { id: 'cedar', label: 'Cedar' },
  { id: 'coral', label: 'Coral' }, { id: 'sage', label: 'Sage' }, { id: 'ash', label: 'Ash' },
]);
export const DEFAULT_COACH_VOICE = 'marin';
const voices = new Set(COACH_VOICES.map(voice => voice.id));
const maxAudioBytes = 3 * 1024 * 1024;

/** Audio is fetched only by authenticated message identity or a fixed preview. */
export function createPremiumSpeechPlayer({ fetchImpl = fetch, windowImpl = window, documentImpl = document, getVoice = () => DEFAULT_COACH_VOICE, onState = () => {}, onUnauthorized = () => {}, now = () => windowImpl.performance?.now?.() ?? Date.now(), playbackWatchdogMs = 12000, streamStartupWatchdogMs = 3000 } = {}) {
  let generation = 0, operation = null, destroyed = false;
  let snapshot = { phase: 'idle', active: false, kind: null, voice: DEFAULT_COACH_VOICE, audioBlocked: false, blockReason: null, message: '', elapsedMs: 0, firstAudioMs: null, chunkIndex: 0, chunkCount: null, completedChunks: 0, currentTime: 0, duration: null, transport: 'buffered' };
  const previews = new Map();
  const setTimer = windowImpl.setTimeout?.bind(windowImpl) || setTimeout;
  const clearTimer = windowImpl.clearTimeout?.bind(windowImpl) || clearTimeout;
  const watchdogMs = Math.max(1000, Math.min(30000, Number(playbackWatchdogMs) || 12000));
  const streamStartupMs = Math.max(500, Math.min(watchdogMs, Number(streamStartupWatchdogMs) || 3000));
  const label = id => COACH_VOICES.find(voice => voice.id === id)?.label || id;
  const valid = current => !destroyed && operation === current && current.generation === generation && !current.controller.signal.aborted && !documentImpl.hidden;
  const update = change => { snapshot = { ...snapshot, ...change }; onState({ ...snapshot }); operation?.callbacks.onProgress?.({ ...snapshot }); };
  function measured(current) {
    const audio = current.audio;
    return { elapsedMs: Math.max(0, now() - current.startedAt), firstAudioMs: current.firstAudioMs, chunkIndex: current.chunkIndex, currentChunk: current.chunkIndex, chunkCount: current.chunkCount, completedChunks: current.completedChunks,
      currentTime: Number.isFinite(audio?.currentTime) ? Math.max(0, audio.currentTime) : 0, duration: Number.isFinite(audio?.duration) && audio.duration > 0 ? audio.duration : null };
  }
  function clock(current) {
    if (!valid(current)) return;
    update(measured(current));
    current.clockTimer = setTimer(() => clock(current), 1000);
  }
  function clearWatchdog(current) { clearTimer(current?.watchdogTimer); if (current) current.watchdogTimer = null; }
  function clearStreamStartup(current) { clearTimer(current?.streamStartupTimer); if (current) current.streamStartupTimer = null; }
  function disposeAudio(current) {
    clearWatchdog(current); clearStreamStartup(current);
    const audio = current?.audio;
    if (audio) {
      audio.onended = null; audio.onerror = null; audio.onplaying = null; audio.onwaiting = null; audio.onstalled = null; audio.onpause = null; audio.ontimeupdate = null; audio.onloadedmetadata = null;
      try { audio.pause(); audio.removeAttribute?.('src'); audio.load?.(); } catch {}
    }
    if (current?.objectUrl) windowImpl.URL.revokeObjectURL(current.objectUrl);
    current?.streamCleanup?.();
    if (current) { current.audio = null; current.objectUrl = null; current.blob = null; current.streamFailure = null; current.playVersion++; }
  }
  function stop({ clearCache = false } = {}) {
    generation++;
    const previous = operation; operation = null;
    previous?.controller.abort(); clearTimer(previous?.clockTimer);
    if (previous?.externalSignal && previous.abortListener) previous.externalSignal.removeEventListener('abort', previous.abortListener);
    disposeAudio(previous);
    if (clearCache) previews.clear();
    update({ phase: 'idle', active: false, audioBlocked: false, blockReason: null, kind: null, message: '', elapsedMs: 0, firstAudioMs: null, chunkIndex: 0, chunkCount: null, completedChunks: 0, currentTime: 0, duration: null, transport: 'buffered' });
  }
  function fail(current, error) {
    if (!valid(current)) return;
    const callback = current.callbacks.onError;
    stop();
    update({ phase: 'error', message: error?.message || 'AI voice could not be played. Your reply remains visible in chat.' });
    callback?.(error);
  }
  function finished(current) {
    if (!valid(current)) return;
    const callback = current.callbacks.onEnd;
    stop(); callback?.();
  }
  function pausePrepared(current, message, blockReason = 'paused') {
    if (!valid(current) || !current.audio) return;
    clearWatchdog(current); clearStreamStartup(current); current.playVersion++;
    current.ignorePause = true;
    try { current.audio.pause(); } catch {}
    current.ignorePause = false;
    // A resumed recording is a new audible interval. Its next native playing
    // event must notify the conversation core, even though the bytes are reused.
    current.audioStarted = false;
    update({ ...measured(current), phase: 'paused', active: true, audioBlocked: true, blockReason, message });
    current.callbacks.onBlocked?.(message, { reason: blockReason });
  }
  function armWatchdog(current) {
    clearWatchdog(current);
    const audio = current.audio;
    current.watchdogTimer = setTimer(() => {
      if (!valid(current) || current.audio !== audio) return;
      if (audio.ended === true) { completeChunk(current, audio); return; }
      if (audio.paused === true) { pausePrepared(current, 'Audio was paused. Tap Play audio to continue the prepared recording.'); return; }
      if (Number.isFinite(audio.currentTime) && audio.currentTime > current.lastTime) {
        current.lastTime = audio.currentTime; current.progressAt = now();
        if (snapshot.phase !== 'playing') playing(current, audio);
        else { update(measured(current)); armWatchdog(current); }
        return;
      }
      if (current.streamFailure) { current.streamFailure(); return; }
      pausePrepared(current, 'Audio did not advance. Tap Play audio to resume the prepared recording; no new voice request is needed.', 'stalled');
    }, Math.max(0, watchdogMs - Math.max(0, now() - current.progressAt)));
  }
  function playing(current, audio) {
    if (!valid(current) || current.audio !== audio || snapshot.phase === 'paused') return;
    if (audio.ended === true) { completeChunk(current, audio); return; }
    if (audio.paused === true) return;
    const firstPlaying = !current.audioStarted;
    if (firstPlaying) { current.audioStarted = true; current.progressAt = now(); }
    if (current.firstAudioMs === null) current.firstAudioMs = Math.max(0, now() - current.startedAt);
    update({ ...measured(current), phase: 'playing', active: true, audioBlocked: false, blockReason: null, message: `Playing ${label(current.voice)} AI voice…` });
    armWatchdog(current); if (firstPlaying) current.callbacks.onStart?.();
  }
  function completeChunk(current, audio) {
    if (!valid(current) || current.audio !== audio) return;
    current.completedChunks = current.chunkIndex + 1;
    update(measured(current));
    current.callbacks.onChunkEnd?.({ ...measured(current), completedChunks: current.completedChunks });
    disposeAudio(current);
    if (current.kind === 'reply' && current.chunkIndex + 1 < current.chunkCount) {
      current.chunkIndex++; void loadChunk(current);
    } else finished(current);
  }
  async function playBuffer(current) {
    if (!valid(current) || !current.audio) return;
    if (current.audio.ended === true) { completeChunk(current, current.audio); return; }
    const audio = current.audio, attempt = ++current.playVersion;
    current.progressAt = now();
    update({ phase: 'starting', active: true, audioBlocked: false, blockReason: null, message: `Starting ${label(current.voice)} AI voice…` });
    armWatchdog(current);
    try { await audio.play(); }
    catch (error) {
      if (!valid(current) || current.audio !== audio || current.playVersion !== attempt) return;
      if (error?.name === 'NotAllowedError') pausePrepared(current, 'Your browser paused audio. Tap Play audio to start the prepared recording.', 'permission');
      else if (current.streamFailure) current.streamFailure();
      else fail(current, error);
    }
  }
  async function attachAudio(current, blob, { autoplay = true, seekAt = 0, preserveStarted = false } = {}) {
    if (!valid(current)) return;
    disposeAudio(current); current.blob = blob; current.lastTime = 0; if (!preserveStarted) current.audioStarted = false;
    current.objectUrl = windowImpl.URL.createObjectURL(blob);
    const audio = new windowImpl.Audio(current.objectUrl); current.audio = audio;
    audio.preload = 'auto';
    audio.onplaying = () => playing(current, audio);
    const buffering = () => {
      if (!valid(current) || current.audio !== audio || snapshot.phase === 'paused') return;
      update({ ...measured(current), phase: 'buffering', message: 'Audio is buffering.' }); armWatchdog(current);
    };
    audio.onwaiting = buffering; audio.onstalled = buffering;
    audio.onpause = () => {
      if (!valid(current) || current.audio !== audio || current.ignorePause || audio.ended === true || snapshot.phase === 'paused') return;
      pausePrepared(current, 'Audio was paused. Tap Play audio to continue the prepared recording.');
    };
    audio.ontimeupdate = () => {
      if (!valid(current) || current.audio !== audio) return;
      if (audio.ended === true) { completeChunk(current, audio); return; }
      if (Number.isFinite(audio.currentTime) && audio.currentTime > current.lastTime) {
        current.lastTime = audio.currentTime;
        clearStreamStartup(current);
        current.progressAt = now();
        if (snapshot.phase !== 'playing' && snapshot.phase !== 'paused') playing(current, audio);
        else if (snapshot.phase === 'playing') { update(measured(current)); armWatchdog(current); }
      }
    };
    audio.onloadedmetadata = () => { if (valid(current) && current.audio === audio) { if (seekAt > 0) { try { audio.currentTime = seekAt; } catch {} seekAt = 0; } update(measured(current)); } };
    audio.onerror = () => { if (valid(current) && current.audio === audio) { if (current.streamFailure) current.streamFailure(); else fail(current, new Error('AI voice audio could not be played. No device voice was substituted.')); } };
    audio.onended = () => completeChunk(current, audio);
    if (autoplay) await playBuffer(current);
    return audio;
  }
  function streamingSupported() {
    try { return typeof windowImpl.MediaSource === 'function' && windowImpl.MediaSource.isTypeSupported?.('audio/mpeg') === true; } catch { return false; }
  }
  /** A failed MSE decoder falls back to the same downloaded bytes, never another paid request. */
  async function attachStream(current, response) {
    const reader = response.body.getReader(), chunks = [];
    let bytes = 0, sourceBuffer = null, streamFailed = false, started = false, seekAt = 0, rejectPending = null, resolveOpen = null, cleanupStream = null;
    const mediaSource = new windowImpl.MediaSource();
    const sourceError = () => current.streamFailure?.();
    const failStream = () => {
      if (streamFailed) return;
      streamFailed = true;
      seekAt = Number.isFinite(current.audio?.currentTime) ? Math.max(0, current.audio.currentTime) : 0;
      current.ignorePause = true; try { current.audio?.pause(); } catch {} current.ignorePause = false;
      clearWatchdog(current); clearStreamStartup(current); rejectPending?.(new Error('Streaming audio is unavailable on this device.'));
      if (valid(current)) update({ ...measured(current), phase: 'loading', transport: 'buffered-fallback', message: 'Preparing the same recording for this browser…' });
    };
    const onAbort = () => { resolveOpen?.(); rejectPending?.(new Error('Audio stopped.')); void reader.cancel().catch(() => {}); };
    current.controller.signal.addEventListener('abort', onAbort, { once: true });
    const opened = new Promise(resolve => {
      resolveOpen = resolve;
      const timer = setTimer(() => { failStream(); resolve(); }, watchdogMs);
      const onOpen = () => {
        clearTimer(timer);
        if (!valid(current) || streamFailed) { resolve(); return; }
        try { sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg'); sourceBuffer.addEventListener('error', sourceError); }
        catch { failStream(); }
        resolve();
      };
      mediaSource.addEventListener('sourceopen', onOpen, { once: true });
      cleanupStream = () => { clearTimer(timer); resolve(); mediaSource.removeEventListener('sourceopen', onOpen); sourceBuffer?.removeEventListener('error', sourceError); current.streamCleanup = null; };
    });
    const audio = await attachAudio(current, mediaSource, { autoplay: false });
    // attachAudio disposes the preceding recording. Install this recording's
    // fallback callback afterwards so no old callback controls the new stream.
    current.streamFailure = failStream;
    current.streamCleanup = cleanupStream;
    update({ transport: 'streaming' });
    async function append(chunk) {
      await opened;
      if (!valid(current) || streamFailed || !sourceBuffer) return;
      await new Promise((resolve, reject) => {
        const timer = setTimer(() => interrupted(new Error('Streaming audio did not advance.')), watchdogMs);
        const cleanup = () => { clearTimer(timer); sourceBuffer.removeEventListener('updateend', done); sourceBuffer.removeEventListener('error', error); if (rejectPending === interrupted) rejectPending = null; };
        const done = () => { cleanup(); resolve(); };
        const error = () => { cleanup(); reject(new Error('Streaming audio could not be decoded.')); };
        const interrupted = errorValue => { cleanup(); reject(errorValue); };
        rejectPending = interrupted;
        sourceBuffer.addEventListener('updateend', done, { once: true }); sourceBuffer.addEventListener('error', error, { once: true });
        try { sourceBuffer.appendBuffer(chunk); } catch (errorValue) { cleanup(); reject(errorValue); }
      });
      if (!started && valid(current) && !streamFailed) {
        started = true;
        current.streamStartupTimer = setTimer(() => {
          if (valid(current) && current.audio === audio && !snapshot.audioBlocked && !(audio.currentTime > 0)) current.streamFailure?.();
        }, streamStartupMs);
        // HTMLMediaElement.play() can wait for later MP3 frames. Awaiting it
        // here would stop the reader that supplies those frames and deadlock.
        void playBuffer(current);
      }
    }
    try {
      while (valid(current)) {
        const { done, value } = await reader.read(); if (done) break;
        bytes += value.byteLength;
        if (bytes > maxAudioBytes) throw new Error('The AI voice response was too large to play.');
        chunks.push(value);
        if (!streamFailed) { try { await append(value); } catch { if (!valid(current)) return; failStream(); } }
      }
      if (!valid(current)) return;
      if (!bytes) throw new Error('The AI voice response was empty.');
      const blob = new windowImpl.Blob(chunks, { type: 'audio/mpeg' });
      if (current.kind === 'preview') previews.set(current.voice, { blob, expiresAt: now() + 5 * 60 * 1000 });
      if (streamFailed || !sourceBuffer || !started) { current.streamCleanup?.(); await attachAudio(current, blob, { seekAt, preserveStarted: true }); }
      else {
        current.blob = blob;
        current.streamFailure = () => { failStream(); if (valid(current)) void attachAudio(current, blob, { seekAt, preserveStarted: true }); };
        try { if (mediaSource.readyState === 'open') mediaSource.endOfStream(); } catch { failStream(); await attachAudio(current, blob, { seekAt, preserveStarted: true }); }
      }
    } finally {
      current.controller.signal.removeEventListener('abort', onAbort);
      await reader.cancel().catch(() => {}); reader.releaseLock();
      if (current.audio !== audio) current.streamFailure = null;
    }
  }
  async function loadChunk(current) {
    if (!valid(current)) return;
    update({ ...measured(current), phase: 'loading', active: true, audioBlocked: false, message: current.chunkIndex ? `Preparing the next part of ${label(current.voice)} AI voice…` : `Preparing ${label(current.voice)} AI voice…` });
    current.callbacks.onPreparing?.({ chunkIndex: current.chunkIndex, chunkCount: current.chunkCount });
    const cache = current.kind === 'preview' ? previews.get(current.voice) : null;
    if (cache && cache.expiresAt > now()) { current.chunkCount = 1; await attachAudio(current, cache.blob); return; }
    const requestId = current.requestIds.get(current.chunkIndex) || windowImpl.crypto.randomUUID();
    current.requestIds.set(current.chunkIndex, requestId);
    const body = current.kind === 'preview' ? { voice: current.voice, requestId }
      : { conversationId: current.conversationId, messageId: current.messageId, voice: current.voice, chunkIndex: current.chunkIndex, requestId };
    try {
      const canStream = streamingSupported();
      const response = await fetchImpl(current.kind === 'preview' ? '/api/voice/preview' : '/api/voice/speech', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(canStream ? { 'X-Study-Speech-Stream': '1' } : {}) }, body: JSON.stringify(body), signal: current.controller.signal });
      if (!valid(current)) return;
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        if (response.status === 401) { onUnauthorized(); stop({ clearCache: true }); return; }
        throw new Error(payload.error || 'AI voice was unavailable. No automatic retry was made.');
      }
      const countHeader = response.headers.get('X-Study-Speech-Chunks'), indexHeader = response.headers.get('X-Study-Speech-Chunk');
      const count = Number(countHeader), index = Number(indexHeader);
      if (!/^audio\/mpeg(?:;|$)/i.test(response.headers.get('Content-Type') || '') || !/^[1-8]$/.test(countHeader || '') || !/^[0-7]$/.test(indexHeader || '') || index !== current.chunkIndex || response.headers.get('X-Study-Speech-Voice') !== current.voice || response.headers.get('X-Study-Speech-Model') !== 'gpt-4o-mini-tts' || (current.chunkCount !== null && count !== current.chunkCount) || (current.kind === 'preview' && count !== 1)) throw new Error('The AI voice response did not match the requested reply. Audio was not played.');
      current.chunkCount = count;
      if (canStream && response.headers.get('X-Study-Speech-Streaming') === '1' && response.body?.getReader) { await attachStream(current, response); return; }
      const blob = await response.blob();
      if (!valid(current)) return;
      if (!blob.size || blob.size > maxAudioBytes) throw new Error('The AI voice response was empty or too large to play.');
      if (current.kind === 'preview') previews.set(current.voice, { blob, expiresAt: now() + 5 * 60 * 1000 });
      await attachAudio(current, blob);
    } catch (error) { if (valid(current)) fail(current, error); }
  }
  async function begin(kind, options = {}) {
    if (destroyed) throw new Error('The AI voice player is closed.');
    if (documentImpl.hidden) throw new Error('Keep the app visible while starting AI voice.');
    const voice = options.voice || getVoice();
    if (!voices.has(voice)) throw new Error('Choose one of the five Coach voices.');
    if (kind === 'reply' && (typeof options.conversationId !== 'string' || !options.conversationId || typeof options.messageId !== 'string' || !options.messageId)) throw new Error('AI voice needs a saved study reply.');
    stop();
    const Controller = windowImpl.AbortController || AbortController;
    const current = { generation, kind, voice, conversationId: options.conversationId, messageId: options.messageId, chunkIndex: 0, completedChunks: 0, chunkCount: null, requestIds: new Map(), controller: new Controller(), callbacks: options, externalSignal: options.signal, audio: null, objectUrl: null, playVersion: 0, startedAt: now(), firstAudioMs: null, clockTimer: null, watchdogTimer: null };
    operation = current;
    if (options.signal?.aborted) { stop(); return; }
    if (options.signal) { current.abortListener = () => { if (operation === current) stop(); }; options.signal.addEventListener('abort', current.abortListener, { once: true }); }
    update({ phase: 'loading', active: true, kind, voice, audioBlocked: false, elapsedMs: 0, firstAudioMs: null, chunkIndex: 0, chunkCount: null, completedChunks: 0, currentTime: 0, duration: null, transport: 'buffered' });
    clock(current); await loadChunk(current);
  }
  const onHidden = () => { if (documentImpl.hidden) stop({ clearCache: true }); };
  const onLeave = () => stop({ clearCache: true });
  documentImpl.addEventListener?.('visibilitychange', onHidden); windowImpl.addEventListener?.('pagehide', onLeave);
  return {
    play: options => begin('reply', options), preview: options => begin('preview', options),
    resume: () => operation?.audio ? playBuffer(operation) : Promise.resolve(),
    stop, active: () => snapshot.active, state: () => ({ ...snapshot }), getOutputState: () => ({ ...snapshot, playing: snapshot.phase === 'playing' }),
    destroy() { stop({ clearCache: true }); destroyed = true; documentImpl.removeEventListener?.('visibilitychange', onHidden); windowImpl.removeEventListener?.('pagehide', onLeave); },
  };
}
