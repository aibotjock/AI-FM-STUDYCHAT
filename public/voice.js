import { createBrowserAudioInput } from '/packages/conversation-agent/src/browser-audio.js';
import { mountVoiceCircle } from '/packages/conversation-agent/src/voice-circle.js';
import { el, actionId, notice } from '/app.js';

let current = null;
function boundedSignal(signal, duration = 50000) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(new Error('Voice request timed out.')), duration);
  return { signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal, done: () => clearTimeout(timer) };
}
async function encodedAudio(blob) {
  if (!(blob instanceof Blob) || !blob.size || blob.size > 2 * 1024 * 1024) throw new Error('Your recording is empty or too long. Type your message instead.');
  const bytes = new Uint8Array(await blob.arrayBuffer()); let encoded = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) encoded += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(encoded);
}
function createPlayback({ voice, api }) {
  let audio = null, url = null, controller = null, details = null, generation = 0, expiryTimer = null;
  function stop({ clearCache = false } = {}) { generation++; controller?.abort(); controller = null; clearTimeout(expiryTimer); expiryTimer = null; if (audio) { audio.pause(); audio.currentTime = 0; audio.onended = null; audio.onerror = null; audio.onwaiting = null; audio.onplaying = null; } if (clearCache) { if (url) URL.revokeObjectURL(url); url = null; audio = null; details = null; } }
  function handlers(epoch) {
    audio.onplaying = () => { if (epoch === generation) details?.onStart?.(); };
    audio.onwaiting = () => { if (epoch === generation) details?.onWaiting?.(); };
    audio.onended = () => { if (epoch === generation) { details?.onProgress?.({ completedChunks: 1, currentChunk: 0 }); details?.onChunkEnd?.({ completedChunks: 1 }); details?.onEnd?.(); stop({ clearCache: true }); } };
    audio.onerror = () => { if (epoch === generation) { details?.onError?.(new Error('The voice reply could not be played. Your text remains available.')); stop({ clearCache: true }); } };
  }
  async function startAudio(epoch) {
    if (!audio || epoch !== generation) return;
    handlers(epoch);
    try { await audio.play(); }
    catch (error) { if (epoch !== generation) return; if (error.name === 'NotAllowedError') details?.onBlocked?.('Tap Play prepared audio to hear the saved reply. Text is ready below.', { reason: 'permission' }); else { details?.onError?.(new Error('Audio playback failed. Your text remains available.')); stop({ clearCache: true }); } }
  }
  return {
    async play(value) {
      stop({ clearCache: true }); const epoch = generation; details = value;
      if (!value.content?.trim() || value.content.length > 4096) { value.onError?.(new Error('This reply is too long for voice readout. The complete text is available.')); return; }
      controller = new AbortController(); const bounded = boundedSignal(AbortSignal.any([value.signal, controller.signal]));
      value.onPreparing?.({ chunkIndex: 0 });
      try {
        const response = await fetch('/api/voice/speech', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId: value.conversationId, messageId: value.messageId, requestId: actionId(), voice }), signal: bounded.signal });
        if (!response.ok) { let body = {}; try { body = await response.json(); } catch {} throw new Error(body.error || 'Speech preparation failed. Use the displayed text.'); }
        const blob = await response.blob(); if (!blob.size || blob.size > 8 * 1024 * 1024) throw new Error('The speech reply could not be loaded. Use the displayed text.');
        if (epoch !== generation || value.signal.aborted) return;
        url = URL.createObjectURL(blob); audio = new Audio(url); audio.preload = 'auto';
        expiryTimer = setTimeout(() => { if (epoch === generation) { value.onError?.(new Error('Voice readout expired. Your text remains available.')); stop({ clearCache: true }); } }, 300000);
        await startAudio(epoch);
      } catch (error) { if (epoch === generation && !value.signal.aborted) { value.onError?.(new Error(error.message || 'Speech preparation failed. Use typing instead.')); stop({ clearCache: true }); } }
      finally { bounded.done(); }
    },
    resume: () => startAudio(generation), stop,
    state: () => ({ currentChunk: 0, completedChunks: 0 }), destroy: () => stop({ clearCache: true }),
  };
}
export async function open({ api, conversationId, setAgent, isBusy, isCurrent, onError }) {
  if (current) { current.container.querySelector('button')?.focus(); return; }
  const options = await api('/api/voice');
  if (isCurrent && !isCurrent()) return;
  if (!options.enabled) { onError(new Error('Voice is unavailable. Continue with typed chat; practice and review are unaffected.')); return; }
  const preferences = await api('/api/settings');
  if (isCurrent && !isCurrent()) return;
  if (!preferences.voiceEnabled) { onError(new Error('Enable optional voice in Settings, then choose Voice again. Your microphone is off.')); return; }
  if (isBusy?.()) throw new Error('Stop the current reply before starting voice. Your displayed text remains available.');
  if (!document.querySelector('#voice-circle-style')) document.head.append(el('link', { id: 'voice-circle-style', rel: 'stylesheet', href: '/packages/conversation-agent/voice-circle.css' }));
  const input = createBrowserAudioInput({ sampleRate: 16000, maxDurationMs: 60000 });
  const playback = createPlayback({ voice: preferences.voice || 'marin', api });
  const container = el('div', { class: 'voice-panel' }), circleContainer = el('div');
  let circle, agent, voiceSessionId = null;
  const host = {
    async startSession({ signal }) { const bounded = boundedSignal(signal); try { const value = await api('/api/voice/start', { method: 'POST', body: { conversationId }, signal: bounded.signal }); voiceSessionId = value.sessionId; return { ...value, conversationId }; } finally { bounded.done(); } },
    async transcribe(value) { const bounded = boundedSignal(value.signal); try { return await api('/api/voice/transcribe', { method: 'POST', body: { conversationId, sessionId: value.sessionId, requestId: value.requestId, audioBase64: await encodedAudio(value.audio) }, signal: bounded.signal, timeoutMs: 50000 }); } finally { bounded.done(); } },
    cancel(value) { return api('/api/voice/cancel', { method: 'POST', body: { conversationId, sessionId: voiceSessionId, requestId: value.requestId } }).catch(() => {}); },
    endSession(value) { return api('/api/voice/end', { method: 'POST', body: { conversationId, sessionId: value.sessionId } }).catch(() => {}); },
  };
  const close = () => { cleanup(); setAgent(null); };
  container.append(el('div', { class: 'row spread' }, el('div', { class: 'eyebrow', text: 'Optional voice · AI-generated speech' }), el('button', { type: 'button', class: 'subtle', text: 'Close voice', onclick: close })), notice('Tap Start conversation to allow microphone capture. Stop, close, or background the app to release it. Typed chat remains available.'), circleContainer);
  document.querySelector('.chat-card')?.before(container);
  agent = setAgent({ input, playback, host, onState: state => circle?.update(state) });
  circle = mountVoiceCircle({ container: circleContainer, agent, showComposer: false, getStartOptions: () => ({ conversationId }) });
  current = { container, circle, agent, input, playback }; circle.button.focus();
}
export function stopPlayback() { current?.playback.stop(); }
export function cleanup() { const value = current; current = null; if (!value) return; value.agent.stop('Voice closed. Your microphone is off.'); value.circle.destroy(); value.input.destroy(); value.playback.destroy(); value.container.remove(); }
