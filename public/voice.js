import { createBrowserAudioInput } from '/packages/conversation-agent/src/browser-audio.js';
import { mountVoiceCircle } from '/packages/conversation-agent/src/voice-circle.js';
import { el, actionId, updateSession, getVoiceChoices } from '/app.js';

let current = null;
let openingGeneration = 0;
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
function createPlayback({ voice }) {
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
        const response = await fetch('/api/voice/speech', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId: value.conversationId, messageId: value.messageId, requestId: actionId(), voice: voice() }), signal: bounded.signal });
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
  if (current) { current.circle.button.focus(); return; }
  const epoch = ++openingGeneration;
  const valid = () => epoch === openingGeneration && (!isCurrent || isCurrent());
  const options = await api('/api/voice');
  if (!valid()) return;
  if (!options.enabled) { onError(new Error(`${options.unavailableReason || 'The self-hosted voice service is unavailable.'} Continue with typed chat; practice and review are unaffected.`)); return; }
  const preferences = await api('/api/settings');
  if (!valid()) return;
  if (isBusy?.()) throw new Error('Stop the current reply before starting voice. Your displayed text remains available.');
  const container = el('dialog', { class: 'voice-dialog', 'aria-label': 'Voice conversation', 'aria-describedby': 'voice-instructions' });
  if (typeof container.showModal !== 'function') { onError(new Error('Open the app in an up-to-date browser to use voice. Typed chat remains available.')); return; }
  if (!document.querySelector('#voice-circle-style')) document.head.append(el('link', { id: 'voice-circle-style', rel: 'stylesheet', href: '/packages/conversation-agent/voice-circle.css' }));
  const previousFocus = document.activeElement, settingsController = new AbortController();
  const choices = getVoiceChoices(options), voices = choices.map(choice => choice.id);
  if (choices.length !== 5) { onError(new Error('The voice list is unavailable. Continue with typed chat and try voice again later.')); return; }
  const voiceLabel = id => choices.find(choice => choice.id === id)?.label || id;
  let selectedVoice = voices.includes(preferences.voice) ? preferences.voice : voices.includes(options.defaultVoice) ? options.defaultVoice : voices[0];
  let circle, agent, voiceSessionId = null, savingVoice = false, destroyed = false;
  const input = createBrowserAudioInput({ sampleRate: 16000, maxDurationMs: 60000 });
  const playback = createPlayback({ voice: () => selectedVoice });
  const circleContainer = el('div');
  const voicePicker = el('select', { id: 'conversation-voice', 'aria-label': 'Conversation voice' }, choices.map(choice => el('option', { value: choice.id, text: choice.label })));
  voicePicker.value = selectedVoice;
  const voiceFeedback = el('p', { class: 'voice-preference-status', role: 'status', 'aria-live': 'polite', text: 'Choose a voice before starting.' });
  const advertisedTimeoutMs = Number(options.transcriptionTimeoutMs);
  const transcriptionTimeoutMs = (Number.isFinite(advertisedTimeoutMs) && advertisedTimeoutMs >= 1000 ? Math.min(120000, advertisedTimeoutMs) : 30000) + 5000;
  const update = state => {
    if (destroyed) return;
    circle?.update(state);
    voicePicker.disabled = savingVoice || Boolean(state.active);
    if (circle) circle.button.disabled = savingVoice;
  };
  const host = {
    async startSession({ signal }) { const bounded = boundedSignal(signal); try { const value = await api('/api/voice/start', { method: 'POST', body: { conversationId }, signal: bounded.signal }); voiceSessionId = value.sessionId; return { ...value, conversationId }; } finally { bounded.done(); } },
    async transcribe(value) { const bounded = boundedSignal(value.signal, transcriptionTimeoutMs); try { return await api('/api/voice/transcribe', { method: 'POST', body: { conversationId, sessionId: value.sessionId, requestId: value.requestId, audioBase64: await encodedAudio(value.audio) }, signal: bounded.signal, timeoutMs: transcriptionTimeoutMs }); } finally { bounded.done(); } },
    cancel(value) { return api('/api/voice/cancel', { method: 'POST', body: { conversationId, sessionId: voiceSessionId, requestId: value.requestId } }).catch(() => {}); },
    endSession(value) { return api('/api/voice/end', { method: 'POST', body: { conversationId, sessionId: value.sessionId } }).catch(() => {}); },
  };
  const view = { container, input, playback, settingsController, dispose: () => { destroyed = true; } };
  const close = ({ typed = false } = {}) => {
    if (current !== view) return;
    const restoreAgent = !isCurrent || isCurrent();
    cleanup();
    if (!restoreAgent) return;
    setAgent(null);
    const target = typed ? document.querySelector('.composer textarea') : previousFocus;
    if (target?.isConnected) target.focus({ preventScroll: true });
  };
  voicePicker.addEventListener('change', async () => {
    if (destroyed || savingVoice || agent.active()) return;
    const previous = selectedVoice, next = voicePicker.value, savedFocus = document.activeElement;
    if (!voices.includes(next)) { voicePicker.value = previous; return; }
    savingVoice = true; voiceFeedback.textContent = 'Saving voice…'; update(agent.state());
    try {
      const saved = await api('/api/settings', { method: 'POST', body: { actionId: actionId(), voice: next }, signal: settingsController.signal });
      if (destroyed || current !== view || !valid()) return;
      if (!voices.includes(saved.voice)) throw new Error('The server did not confirm an available voice. Try again.');
      selectedVoice = saved.voice; voicePicker.value = selectedVoice;
      updateSession({ settings: saved }); voiceFeedback.textContent = `${voiceLabel(selectedVoice)} selected.`;
    } catch (error) {
      if (destroyed || current !== view || !valid()) return;
      selectedVoice = previous; voicePicker.value = previous; voiceFeedback.textContent = `Voice change was not confirmed. ${error.message}`;
    } finally {
      savingVoice = false;
      if (!destroyed) {
        update(agent.state());
        if (current === view && valid() && container.open && !container.contains(document.activeElement)) {
          const target = container.contains(savedFocus) && !savedFocus.disabled ? savedFocus : circle.button;
          target.focus({ preventScroll: true });
        }
      }
    }
  });
  container.append(
    el('header', { class: 'voice-dialog-header' }, el('div', {}, el('div', { class: 'eyebrow', text: 'Study Coach' }), el('h2', { text: 'Voice conversation' })), el('button', { type: 'button', class: 'subtle', text: 'Close voice', onclick: () => close() })),
    el('p', { id: 'voice-instructions', class: 'voice-instructions', text: 'Choose one of five voices, then tap Start conversation. Speak naturally and pause when finished; Coach will listen and reply aloud.' }),
    el('div', { class: 'voice-picker' }, el('label', { for: 'conversation-voice', text: 'Conversation voice' }), voicePicker), voiceFeedback, circleContainer,
    el('footer', { class: 'voice-dialog-footer' }, el('button', { type: 'button', text: 'Use typed chat', onclick: () => close({ typed: true }) }), el('small', { text: 'AI-generated speech · Stop, close, or leave the app to turn the microphone off.' })),
  );
  container.addEventListener('cancel', event => { event.preventDefault(); close(); });
  container.addEventListener('close', () => close());
  container.addEventListener('click', event => {
    if (event.target !== container) return;
    const rect = container.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
  });
  document.body.append(container);
  agent = setAgent({ input, playback, host, onState: update });
  circle = mountVoiceCircle({ container: circleContainer, agent, showComposer: false, getStartOptions: () => ({ conversationId }) });
  Object.assign(view, { circle, agent }); current = view; update(agent.state());
  try { container.showModal(); circle.button.focus(); }
  catch (error) { close(); onError(new Error('Voice could not open. Typed chat remains available.')); }
}
export function stopPlayback() { current?.playback.stop(); }
export function cleanup() {
  openingGeneration++; const value = current; current = null;
  if (!value) return;
  value.dispose(); value.settingsController.abort(); value.agent.destroy(); value.circle.destroy();
  if (value.container.open) value.container.close();
  value.container.remove();
}
