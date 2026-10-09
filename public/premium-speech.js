export const COACH_VOICES = Object.freeze([
  { id: 'marin', label: 'Marin' }, { id: 'cedar', label: 'Cedar' },
  { id: 'coral', label: 'Coral' }, { id: 'sage', label: 'Sage' }, { id: 'ash', label: 'Ash' },
]);
export const DEFAULT_COACH_VOICE = 'marin';
const voices = new Set(COACH_VOICES.map(voice => voice.id));

/** Audio is fetched only by authenticated message identity or a fixed preview. */
export function createPremiumSpeechPlayer({ fetchImpl = fetch, windowImpl = window, documentImpl = document, getVoice = () => DEFAULT_COACH_VOICE, onState = () => {}, onUnauthorized = () => {} } = {}) {
  let generation = 0, operation = null, destroyed = false;
  let snapshot = { phase: 'idle', active: false, kind: null, voice: DEFAULT_COACH_VOICE, audioBlocked: false, message: '' };
  const previews = new Map();
  const now = () => Date.now();
  const label = id => COACH_VOICES.find(voice => voice.id === id)?.label || id;
  const valid = current => !destroyed && operation === current && current.generation === generation && !current.controller.signal.aborted && !documentImpl.hidden;
  const update = change => { snapshot = { ...snapshot, ...change }; onState({ ...snapshot }); };
  function disposeAudio(current) {
    const audio = current?.audio;
    if (audio) {
      audio.onended = null; audio.onerror = null; audio.onplaying = null;
      try { audio.pause(); audio.removeAttribute?.('src'); audio.load?.(); } catch {}
    }
    if (current?.objectUrl) windowImpl.URL.revokeObjectURL(current.objectUrl);
    if (current) { current.audio = null; current.objectUrl = null; current.blob = null; }
  }
  function stop({ clearCache = false } = {}) {
    generation++;
    const previous = operation; operation = null;
    previous?.controller.abort();
    if (previous?.externalSignal && previous.abortListener) previous.externalSignal.removeEventListener('abort', previous.abortListener);
    disposeAudio(previous);
    if (clearCache) previews.clear();
    update({ phase: 'idle', active: false, audioBlocked: false, kind: null, message: '' });
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
  async function playBuffer(current) {
    if (!valid(current) || !current.audio) return;
    update({ phase: 'playing', active: true, audioBlocked: false, message: `Playing ${label(current.voice)} AI voice…` });
    try { await current.audio.play(); }
    catch (error) {
      if (!valid(current)) return;
      if (error?.name === 'NotAllowedError') {
        update({ phase: 'paused', active: true, audioBlocked: true, message: 'Tap Play audio to continue the prepared AI voice.' });
        current.callbacks.onBlocked?.();
      } else fail(current, error);
    }
  }
  async function attachAudio(current, blob) {
    if (!valid(current)) return;
    disposeAudio(current); current.blob = blob;
    current.objectUrl = windowImpl.URL.createObjectURL(blob);
    const audio = new windowImpl.Audio(current.objectUrl); current.audio = audio;
    audio.preload = 'auto';
    audio.onplaying = () => {
      if (!valid(current) || current.audio !== audio) return;
      update({ phase: 'playing', active: true, audioBlocked: false, message: `Playing ${label(current.voice)} AI voice…` });
      current.callbacks.onStart?.();
    };
    audio.onerror = () => { if (valid(current) && current.audio === audio) fail(current, new Error('AI voice audio could not be played. No device voice was substituted.')); };
    audio.onended = () => {
      if (!valid(current) || current.audio !== audio) return;
      disposeAudio(current);
      if (current.kind === 'reply' && current.chunkIndex + 1 < current.chunkCount) {
        current.chunkIndex++; void loadChunk(current);
      } else finished(current);
    };
    await playBuffer(current);
  }
  async function loadChunk(current) {
    if (!valid(current)) return;
    update({ phase: 'loading', active: true, audioBlocked: false, message: `Preparing ${label(current.voice)} AI voice…` });
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
    const current = { generation, kind, voice, conversationId: options.conversationId, messageId: options.messageId, chunkIndex: 0, chunkCount: null, requestIds: new Map(), controller: new Controller(), callbacks: options, externalSignal: options.signal, audio: null, objectUrl: null };
    operation = current;
    if (options.signal?.aborted) { stop(); return; }
    if (options.signal) { current.abortListener = () => { if (operation === current) stop(); }; options.signal.addEventListener('abort', current.abortListener, { once: true }); }
    update({ phase: 'loading', active: true, kind, voice, audioBlocked: false });
    await loadChunk(current);
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
