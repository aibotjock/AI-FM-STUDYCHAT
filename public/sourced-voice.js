// Study voice uses the same canonical, cited text reply as the visible chat.
// Recognition and speech synthesis are optional browser services, not an audio AI model.
export function sourcedVoiceSupported(windowImpl = window) {
  return Boolean(windowImpl.isSecureContext && (windowImpl.SpeechRecognition || windowImpl.webkitSpeechRecognition) && windowImpl.speechSynthesis && windowImpl.SpeechSynthesisUtterance);
}

export function speechChunks(text, limit = 700) {
  if (typeof text !== 'string' || !text.trim() || text.length > 24000) return [];
  const width = Math.max(100, Math.min(1000, Number(limit) || 700));
  const output = [];
  let offset = 0;
  while (offset < text.length) {
    let end = Math.min(text.length, offset + width);
    if (end < text.length) {
      const space = text.lastIndexOf(' ', end - 1);
      const newline = text.lastIndexOf('\n', end - 1);
      const boundary = Math.max(space, newline);
      if (boundary > offset + width / 2) end = boundary + 1;
      // Keep a surrogate pair together if a long unbroken word crosses the boundary.
      if (/^[\uDC00-\uDFFF]$/.test(text[end] || '') && /^[\uD800-\uDBFF]$/.test(text[end - 1] || '')) end--;
    }
    output.push(text.slice(offset, end)); offset = end;
  }
  return output;
}

export function canonicalSpokenReply(reply) {
  return Boolean(reply && reply.sourceVerified === true && typeof reply.content === 'string' && reply.content.trim() && reply.content.length <= 24000);
}

export function createSourcedVoiceCoach({ sendTurn, onState = () => {}, windowImpl = window, documentImpl = document, navigatorImpl = navigator, maxDurationMs = 600000 } = {}) {
  if (typeof sendTurn !== 'function') throw new TypeError('Sourced voice requires a canonical chat callback.');
  const Recognition = windowImpl.SpeechRecognition || windowImpl.webkitSpeechRecognition;
  const synthesis = windowImpl.speechSynthesis;
  const setTimer = windowImpl.setTimeout?.bind(windowImpl) || setTimeout;
  const clearTimer = windowImpl.clearTimeout?.bind(windowImpl) || clearTimeout;
  let generation = 0, turnVersion = 0, recognition = null, requestController = null;
  let durationTimer = null, recognitionTimer = null, speechTimer = null;
  let conversationId = null, destroyed = false, speech = null;
  let spokenText = '', chunks = [], chunkIndex = 0;
  let snapshot = { phase: 'idle', message: 'Start sourced voice to study the cited question bank.', muted: false, audioBlocked: false, userCaption: '', assistantCaption: '', warning: '', model: null, setupPending: false };
  const active = () => ['starting', 'listening', 'thinking', 'speaking', 'paused'].includes(snapshot.phase);
  const current = (attempt, turn) => !destroyed && attempt === generation && turn === turnVersion && active() && !documentImpl.hidden;
  function update(change) { snapshot = { ...snapshot, ...change }; onState({ ...snapshot, active: active() }); }
  function cancelSpeech() {
    clearTimer(speechTimer); speechTimer = null;
    if (speech) { speech.onend = null; speech.onerror = null; speech.onstart = null; }
    speech = null; synthesis?.cancel();
  }
  function cancelRecognition() {
    clearTimer(recognitionTimer); recognitionTimer = null;
    const previous = recognition; recognition = null;
    if (previous) {
      previous.onresult = null; previous.onend = null; previous.onerror = null; previous.onstart = null;
      try { previous.abort(); } catch {}
    }
  }
  function stop(message = 'Sourced voice stopped. Your microphone is off.', failed = false) {
    generation++; turnVersion++;
    clearTimer(durationTimer); durationTimer = null;
    requestController?.abort(); requestController = null;
    cancelRecognition(); cancelSpeech();
    spokenText = ''; chunks = []; chunkIndex = 0;
    update({ phase: failed ? 'error' : 'idle', message, muted: false, audioBlocked: false, setupPending: false });
    return Promise.resolve();
  }
  function pauseForAudio(message) {
    cancelSpeech();
    update({ phase: 'paused', audioBlocked: true, message, warning: 'The canonical reply and its sources remain visible in chat. Tap Read reply to retry browser speech, or Stop voice to type.' });
  }
  function listen(attempt = generation, turn = turnVersion) {
    if (!current(attempt, turn)) return;
    if (snapshot.muted) { update({ phase: 'paused', message: 'Microphone muted. Tap Unmute when ready.' }); return; }
    cancelRecognition();
    const segments = new Map();
    let submitted = false, ended = false, finishing = false;
    const instance = new Recognition(); recognition = instance;
    instance.lang = navigatorImpl.language || 'en-US';
    instance.continuous = false; instance.interimResults = true; instance.maxAlternatives = 1;
    const valid = () => recognition === instance && current(attempt, turn);
    const textOf = finalOnly => [...segments.entries()].sort((a, b) => a[0] - b[0]).filter(([, value]) => !finalOnly || value.final).map(([, value]) => value.text).filter(Boolean).join(' ').slice(0, 12000);
    instance.onstart = () => {
      if (!valid()) return;
      clearTimer(recognitionTimer); recognitionTimer = null;
      update({ phase: 'listening', message: 'Listening… finish your question or say an answer choice.', setupPending: false });
    };
    instance.onresult = event => {
      if (!valid() || ended || submitted || !event?.results) return;
      const start = Math.max(0, Number.isInteger(event.resultIndex) ? event.resultIndex : 0);
      for (const index of segments.keys()) if (index >= event.results.length) segments.delete(index);
      for (let index = start; index < Math.min(event.results.length, 100); index++) {
        const result = event.results[index];
        if (typeof result?.[0]?.transcript === 'string') segments.set(index, { text: result[0].transcript.trim(), final: result.isFinal === true });
      }
      update({ userCaption: textOf(false) });
      if (!finishing && [...segments.values()].some(value => value.final && value.text)) {
        finishing = true;
        // Wait for onend before request/TTS so the recognizer cannot hear its reply.
        recognitionTimer = setTimer(() => { if (valid()) stop('The browser did not finish stopping its microphone. Start again or use keyboard dictation.', true); }, 3000);
        try { instance.stop(); } catch { stop('The browser could not stop dictation safely. Use typing or keyboard dictation.', true); }
      }
    };
    instance.onerror = event => {
      if (!valid()) return;
      const error = event?.error;
      const message = ['not-allowed', 'service-not-allowed'].includes(error) ? 'Microphone or browser speech permission was denied. Allow it in site settings, or use keyboard dictation.' : error === 'no-speech' ? 'No speech was recognized. Start again when ready, or use keyboard dictation.' : error === 'audio-capture' ? 'The browser could not access a microphone. Use typing or keyboard dictation.' : 'Browser dictation failed. No automatic request retry was made. Use typing or keyboard dictation.';
      stop(message, true);
    };
    instance.onend = () => {
      if (!valid() || ended) return;
      ended = true; clearTimer(recognitionTimer); recognitionTimer = null;
      recognition = null;
      const content = textOf(true);
      if (!content) { stop('No final speech was recognized. Your microphone is off; start again or use keyboard dictation.', true); return; }
      if (submitted) return;
      submitted = true;
      void submit(content, attempt, turn);
    };
    update({ phase: 'starting', message: 'Allow browser speech recognition, then ask a study question.', setupPending: true, audioBlocked: false, warning: '', userCaption: '' });
    recognitionTimer = setTimer(() => { if (valid()) stop('Browser dictation did not start. Use keyboard dictation or typing.', true); }, 15000);
    try { instance.start(); } catch { stop('Browser dictation is unavailable. Use keyboard dictation or typing.', true); }
  }
  async function submit(content, attempt, turn) {
    if (!current(attempt, turn)) return;
    update({ phase: 'thinking', message: 'Finding the canonical study reply…', setupPending: false, userCaption: content });
    const Controller = windowImpl.AbortController || AbortController;
    const controller = new Controller(); requestController = controller;
    try {
      const id = windowImpl.crypto?.randomUUID?.() || `voice-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const reply = await sendTurn({ content, conversationId, requestId: id, signal: controller.signal });
      if (!current(attempt, turn) || controller.signal.aborted) return;
      if (!canonicalSpokenReply(reply)) {
        stop('That reply was not marked as canonical sourced study text. Voice did not read it. Use the cited question bank or review the visible message.', true);
        return;
      }
      spokenText = reply.content; chunks = speechChunks(spokenText); chunkIndex = 0;
      update({ assistantCaption: spokenText, warning: '' });
      speakChunk(attempt, turn);
    } catch (error) {
      if (!current(attempt, turn) || controller.signal.aborted) return;
      stop(error?.message || 'The study request failed. No automatic retry was made; use the visible chat to retry.', true);
    } finally { if (requestController === controller) requestController = null; }
  }
  function speakChunk(attempt = generation, turn = turnVersion) {
    if (!current(attempt, turn)) return;
    if (chunkIndex >= chunks.length) {
      cancelSpeech();
      turnVersion++;
      listen(generation, turnVersion);
      return;
    }
    const utterance = new windowImpl.SpeechSynthesisUtterance(chunks[chunkIndex]); speech = utterance;
    utterance.lang = navigatorImpl.language || 'en-US'; utterance.rate = .95;
    const valid = () => speech === utterance && current(attempt, turn);
    utterance.onstart = () => {
      if (!valid()) return;
      clearTimer(speechTimer); speechTimer = null;
      update({ phase: 'speaking', message: 'Reading the exact cited study reply. Tap Interrupt to speak next.', audioBlocked: false });
    };
    utterance.onend = () => {
      if (!valid()) return;
      clearTimer(speechTimer); speechTimer = null;
      speech = null; chunkIndex++;
      speakChunk(attempt, turn);
    };
    utterance.onerror = () => { if (valid()) pauseForAudio('Browser speech did not finish. The cited reply is visible in chat.'); };
    update({ phase: 'speaking', message: 'Reading the exact cited study reply. Microphone is off while the reply is read.', audioBlocked: false });
    speechTimer = setTimer(() => { if (valid()) pauseForAudio('Browser speech did not start. Tap Read reply, or use the visible cited text.'); }, 10000);
    try { synthesis.speak(utterance); } catch { pauseForAudio('Browser read-aloud is unavailable. Use the cited text in chat.'); }
  }
  async function start(options = {}) {
    if (destroyed || active()) return;
    if (!sourcedVoiceSupported(windowImpl)) throw new Error('Sourced voice needs HTTPS and browser speech recognition plus read-aloud. Use keyboard dictation and the visible cited text on unsupported browsers.');
    if (documentImpl.hidden) throw new Error('Keep the study app visible while starting sourced voice.');
    generation++; turnVersion++;
    conversationId = options.conversationId || null;
    update({ phase: 'starting', message: 'Starting sourced study voice…', muted: false, audioBlocked: false, userCaption: '', assistantCaption: '', warning: '', setupPending: true });
    durationTimer = setTimer(() => stop('Your ten-minute sourced voice session ended. Start another when ready.'), Math.max(1, Math.min(600000, Number(maxDurationMs) || 600000)));
    listen(generation, turnVersion);
  }
  function toggleMute() {
    if (!active()) return;
    const muted = !snapshot.muted;
    update({ muted });
    if (muted && ['starting', 'listening'].includes(snapshot.phase)) {
      cancelRecognition(); update({ phase: 'paused', setupPending: false, message: 'Microphone muted. Tap Unmute when ready.' });
    } else if (!muted && snapshot.phase === 'paused' && !snapshot.audioBlocked) listen(generation, turnVersion);
    else update({ message: muted ? 'Microphone muted. The cited reply can still be read aloud.' : snapshot.phase === 'speaking' ? 'Microphone will listen after the cited reply ends. Tap Interrupt to speak now.' : 'The microphone will resume when this study turn finishes.' });
  }
  function interrupt() {
    if (!active()) return;
    turnVersion++;
    requestController?.abort(); requestController = null;
    cancelRecognition(); cancelSpeech();
    spokenText = ''; chunks = []; chunkIndex = 0;
    update({ audioBlocked: false, warning: '', setupPending: false });
    listen(generation, turnVersion);
  }
  function playAudio() {
    if (!active() || !snapshot.audioBlocked || !spokenText || !chunks.length) return;
    cancelSpeech();
    update({ warning: '', audioBlocked: false });
    speakChunk(generation, turnVersion);
  }
  const onHidden = () => { if (documentImpl.hidden && active()) stop('Sourced voice stopped when the app moved to the background. Start again when ready.'); };
  const onLeave = () => { if (active()) stop('Sourced voice stopped because you left the page.'); };
  documentImpl.addEventListener?.('visibilitychange', onHidden);
  windowImpl.addEventListener?.('pagehide', onLeave);
  return {
    start, stop, toggleMute, interrupt, playAudio,
    retrySave: () => Promise.resolve(),
    active, state: () => ({ ...snapshot, active: active() }),
    destroy() { stop(); destroyed = true; documentImpl.removeEventListener?.('visibilitychange', onHidden); windowImpl.removeEventListener?.('pagehide', onLeave); },
  };
}
