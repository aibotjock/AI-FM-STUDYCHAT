export const COACH_VOICES = Object.freeze([
  { id: 'marin', label: 'Marin' }, { id: 'cedar', label: 'Cedar' },
  { id: 'coral', label: 'Coral' }, { id: 'sage', label: 'Sage' }, { id: 'ash', label: 'Ash' },
]);
export const DEFAULT_COACH_VOICE = 'marin';
const voices = new Set(COACH_VOICES.map(voice => voice.id));

/** Audio is fetched only by authenticated message identity or a fixed preview. */
export function createPremiumSpeechPlayer({ fetchImpl = fetch, windowImpl = window, documentImpl = document, getVoice = () => DEFAULT_COACH_VOICE, onState = () => {}, onUnauthorized = () => {}, now = () => windowImpl.performance?.now?.() ?? Date.now(), playbackWatchdogMs = 12000 } = {}) {
  let generation = 0, operation = null, destroyed = false;
  let snapshot = { phase: 'idle', active: false, kind: null, voice: DEFAULT_COACH_VOICE, audioBlocked: false, message: '', elapsedMs: 0, firstAudioMs: null, chunkIndex: 0, chunkCount: null, currentTime: 0, duration: null };
  const previews = new Map();
  const setTimer = windowImpl.setTimeout?.bind(windowImpl) || setTimeout;
  const clearTimer = windowImpl.clearTimeout?.bind(windowImpl) || clearTimeout;
  const watchdogMs = Math.max(1000, Math.min(30000, Number(playbackWatchdogMs) || 12000));
  const label = id => COACH_VOICES.find(voice => voice.id === id)?.label || id;
  const valid = current => !destroyed && operation === current && current.generation === generation && !current.controller.signal.aborted && !documentImpl.hidden;
  const update = change => { snapshot = { ...snapshot, ...change }; onState({ ...snapshot }); };
  function measured(current) {
    const audio = current.audio;
    return { elapsedMs: Math.max(0, now() - current.startedAt), firstAudioMs: current.firstAudioMs, chunkIndex: current.chunkIndex, chunkCount: current.chunkCount,
      currentTime: Number.isFinite(audio?.currentTime) ? Math.max(0, audio.currentTime) : 0, duration: Number.isFinite(audio?.duration) && audio.duration > 0 ? audio.duration : null };
  }
  function clock(current) {
    if (!valid(current)) return;
    update(measured(current));
    current.clockTimer = setTimer(() => clock(current), 1000);
  }
  function clearWatchdog(current) { clearTimer(current?.watchdogTimer); if (current) current.watchdogTimer = null; }
  function disposeAudio(current) {
    clearWatchdog(current);
    const audio = current?.audio;
    if (audio) {
      audio.onended = null; audio.onerror = null; audio.onplaying = null; audio.onwaiting = null; audio.onstalled = null; audio.onpause = null; audio.ontimeupdate = null; audio.onloadedmetadata = null;
      try { audio.pause(); audio.removeAttribute?.('src'); audio.load?.(); } catch {}
    }
    if (current?.objectUrl) windowImpl.URL.revokeObjectURL(current.objectUrl);
    if (current) { current.audio = null; current.objectUrl = null; current.blob = null; current.playVersion++; }
  }
  function stop({ clearCache = false } = {}) {
    generation++;
    const previous = operation; operation = null;
    previous?.controller.abort(); clearTimer(previous?.clockTimer);
    if (previous?.externalSignal && previous.abortListener) previous.externalSignal.removeEventListener('abort', previous.abortListener);
    disposeAudio(previous);
    if (clearCache) previews.clear();
    update({ phase: 'idle', active: false, audioBlocked: false, kind: null, message: '', elapsedMs: 0, firstAudioMs: null, currentTime: 0, duration: null });
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
  function pausePrepared(current, message) {
    if (!valid(current) || !current.audio) return;
    clearWatchdog(current); current.playVersion++;
    current.ignorePause = true;
    try { current.audio.pause(); } catch {}
    current.ignorePause = false;
    update({ ...measured(current), phase: 'paused', active: true, audioBlocked: true, message });
    current.callbacks.onBlocked?.(message);
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
      pausePrepared(current, 'Audio did not advance. Tap Play audio to resume the prepared recording; no new voice request is needed.');
    }, Math.max(0, watchdogMs - Math.max(0, now() - current.progressAt)));
  }
  function playing(current, audio) {
    if (!valid(current) || current.audio !== audio || snapshot.phase === 'paused') return;
    if (audio.ended === true) { completeChunk(current, audio); return; }
    if (audio.paused === true) return;
    if (!current.audioStarted) { current.audioStarted = true; current.progressAt = now(); }
    if (current.firstAudioMs === null) current.firstAudioMs = Math.max(0, now() - current.startedAt);
    update({ ...measured(current), phase: 'playing', active: true, audioBlocked: false, message: `Playing ${label(current.voice)} AI voice…` });
    armWatchdog(current); current.callbacks.onStart?.();
  }
  function completeChunk(current, audio) {
    if (!valid(current) || current.audio !== audio) return;
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
    update({ phase: 'starting', active: true, audioBlocked: false, message: `Starting ${label(current.voice)} AI voice…` });
    armWatchdog(current);
    try { await audio.play(); }
    catch (error) {
      if (!valid(current) || current.audio !== audio || current.playVersion !== attempt) return;
      if (error?.name === 'NotAllowedError') pausePrepared(current, 'Your browser paused audio. Tap Play audio to start the prepared recording.');
      else fail(current, error);
    }
  }
  async function attachAudio(current, blob) {
    if (!valid(current)) return;
    disposeAudio(current); current.blob = blob; current.lastTime = 0; current.audioStarted = false;
    current.objectUrl = windowImpl.URL.createObjectURL(blob);
    const audio = new windowImpl.Audio(current.objectUrl); current.audio = audio;
    audio.preload = 'auto';
    audio.onplaying = () => playing(current, audio);
    const buffering = () => {
      if (!valid(current) || current.audio !== audio || snapshot.phase === 'paused') return;
      update({ ...measured(current), phase: 'buffering', message: 'Audio is buffering. Your microphone remains off.' }); armWatchdog(current);
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
        current.progressAt = now();
        if (snapshot.phase !== 'playing' && snapshot.phase !== 'paused') playing(current, audio);
        else if (snapshot.phase === 'playing') { update(measured(current)); armWatchdog(current); }
      }
    };
    audio.onloadedmetadata = () => { if (valid(current) && current.audio === audio) update(measured(current)); };
    audio.onerror = () => { if (valid(current) && current.audio === audio) fail(current, new Error('AI voice audio could not be played. No device voice was substituted.')); };
    audio.onended = () => completeChunk(current, audio);
    await playBuffer(current);
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
      const response = await fetchImpl(current.kind === 'preview' ? '/api/voice/preview' : '/api/voice/speech', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: current.controller.signal });
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
      const blob = await response.blob();
      if (!valid(current)) return;
      if (!blob.size || blob.size > 8 * 1024 * 1024) throw new Error('The AI voice response was empty or too large to play.');
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
    const current = { generation, kind, voice, conversationId: options.conversationId, messageId: options.messageId, chunkIndex: 0, chunkCount: null, requestIds: new Map(), controller: new Controller(), callbacks: options, externalSignal: options.signal, audio: null, objectUrl: null, playVersion: 0, startedAt: now(), firstAudioMs: null, clockTimer: null, watchdogTimer: null };
    operation = current;
    if (options.signal?.aborted) { stop(); return; }
    if (options.signal) { current.abortListener = () => { if (operation === current) stop(); }; options.signal.addEventListener('abort', current.abortListener, { once: true }); }
    update({ phase: 'loading', active: true, kind, voice, audioBlocked: false, elapsedMs: 0, firstAudioMs: null, chunkIndex: 0, chunkCount: null, currentTime: 0, duration: null });
    clock(current); await loadChunk(current);
  }
  const onHidden = () => { if (documentImpl.hidden) stop({ clearCache: true }); };
  const onLeave = () => stop({ clearCache: true });
  documentImpl.addEventListener?.('visibilitychange', onHidden); windowImpl.addEventListener?.('pagehide', onLeave);
  return {
    play: options => begin('reply', options), preview: options => begin('preview', options),
    resume: () => operation?.audio ? playBuffer(operation) : Promise.resolve(),
    stop, active: () => snapshot.active, state: () => ({ ...snapshot }),
    destroy() { stop({ clearCache: true }); destroyed = true; documentImpl.removeEventListener?.('visibilitychange', onHidden); windowImpl.removeEventListener?.('pagehide', onLeave); },
  };
}
