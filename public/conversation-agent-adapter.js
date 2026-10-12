import { createConversationAgent, createBrowserAudioInput, createSherpaAudioInput, createPhoneVoicePlayback, listPhoneVoices, pickVoiceOptions, mountVoiceCircle } from '/vendor/conversation-agent/index.js';

export { mountVoiceCircle };

export function conversationAudioSupported(windowImpl = window, navigatorImpl = navigator) {
  return windowImpl.isSecureContext === true && Boolean(navigatorImpl.mediaDevices?.getUserMedia)
    && Boolean(windowImpl.AudioContext || windowImpl.webkitAudioContext);
}

async function audioBase64(audio) {
  if (!(audio instanceof Blob) || !audio.size || audio.size > 5760044) throw new Error('The microphone recording is empty or too long. Try a shorter turn.');
  const bytes = new Uint8Array(await audio.arrayBuffer());
  const pieces = [];
  for (let offset = 0; offset < bytes.length; offset += 32768) pieces.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
  return btoa(pieces.join(''));
}

/** Free on-device voice: speech is recognized in the browser (no upload, no transcription
 * request) and approved replies are spoken with the phone's own voices. Speech files
 * are served from /sherpa/ (downloaded at build time) and cached after first use. */
export function createOnDeviceVoice({ windowImpl = window, documentImpl = document, navigatorImpl = navigator, voiceId = null, sensitivity = 'normal', onLoadProgress = () => {} } = {}) {
  const input = createSherpaAudioInput({ assetBaseUrl: '/sherpa/', windowImpl, documentImpl, navigatorImpl, sensitivity, pauseMs: 700, maxDurationMs: 60000, onLoadProgress });
  const playback = createPhoneVoicePlayback({ voiceId });
  let choices = null;
  return {
    input, playback,
    /** Up to five English voices offered by this device. */
    async voiceChoices() {
      choices ||= listPhoneVoices().then(voices => pickVoiceOptions(voices, 5)).catch(() => []);
      return choices;
    },
    setVoice: id => playback.setVoice(id),
    preview: id => playback.preview(id),
    setSensitivity: value => input.setSensitivity(value),
  };
}

/** StudyChat owns authentication, grounded replies and message-authorized speech. */
export function createStudyConversationAgent({ api, sendTurn, speechPlayer, onState, onDevice = null, windowImpl = window, documentImpl = document, navigatorImpl = navigator } = {}) {
  const input = onDevice?.input || createBrowserAudioInput({ windowImpl, documentImpl, navigatorImpl, sampleRate: 16000, preRollMs: 500, silenceMs: 1100, maxDurationMs: 60000 });
  const post = (path, body, signal) => api(path, { method: 'POST', body: JSON.stringify(body), signal });
  const host = {
    startSession: ({ conversationId, signal }) => post('/api/conversation-agent/session/start', { conversationId }, signal),
    endSession: ({ conversationId, sessionId }) => sessionId ? post('/api/conversation-agent/session/end', { conversationId, sessionId }) : undefined,
    async transcribe({ audio, conversationId, sessionId, requestId, signal }) {
      const encoded = await audioBase64(audio);
      if (signal.aborted) throw new DOMException('Voice turn cancelled.', 'AbortError');
      return post('/api/conversation-agent/transcribe', { conversationId, sessionId, requestId, audioBase64: encoded }, signal);
    },
    sendTurn: options => sendTurn(options),
    cancel: ({ conversationId, sessionId, requestId }) => sessionId && requestId
      ? post('/api/conversation-agent/cancel', { conversationId, sessionId, requestId }) : undefined,
    reportPlayback: ({ conversationId, sessionId, messageId, turnId, completedChunks, status, signal }) => sessionId && messageId
      ? post('/api/conversation-agent/checkpoint', { conversationId, sessionId, messageId, ...(turnId ? { turnId } : {}), completedChunks, complete: status === 'completed' }, signal) : undefined,
  };
  // On-device utterances arrive as text, so `transcribe` is only used by the cloud input.
  return createConversationAgent({ input, host, playback: onDevice?.playback || speechPlayer, onState, windowImpl, documentImpl, maxDurationMs: 600000 });
}
