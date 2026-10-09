// Realtime audio uses WebRTC, not the browser's optional dictation service.
export function voiceSupported() {
  return Boolean(window.isSecureContext && window.RTCPeerConnection && navigator.mediaDevices?.getUserMedia);
}

export function createVoiceCoach({ request, onTranscript, onState = () => {}, windowImpl = window, documentImpl = document, navigatorImpl = navigator } = {}) {
  let peer = null, channel = null, stream = null, audio = null;
  let generation = 0, session = null, durationTimer = null, connectionTimer = null;
  let saving = Promise.resolve(), stopping = null;
  let setupPending = false;
  const saved = new Set(), pending = new Map(), captions = new Map();
  let snapshot = { phase: 'idle', message: 'Start voice for a spoken conversation.', muted: false, audioBlocked: false, userCaption: '', assistantCaption: '', warning: '', model: null, setupPending: false };
  const active = () => ['starting', 'listening', 'thinking', 'speaking'].includes(snapshot.phase);
  function update(change) { snapshot = { ...snapshot, ...change }; onState({ ...snapshot, active: active() }); }
  function send(event) { if (channel?.readyState === 'open') channel.send(JSON.stringify(event)); }
  function clearLocal() {
    clearTimeout(durationTimer); clearTimeout(connectionTimer);
    durationTimer = null; connectionTimer = null;
    if (stream) for (const track of stream.getTracks()) { track.onended = null; track.stop(); }
    stream = null;
    if (channel) { channel.onopen = null; channel.onmessage = null; channel.onclose = null; channel.onerror = null; try { channel.close(); } catch {} }
    channel = null;
    if (peer) { peer.ontrack = null; peer.onconnectionstatechange = null; try { peer.close(); } catch {} }
    peer = null;
    if (audio) { audio.pause(); audio.srcObject = null; audio.remove(); }
    audio = null;
  }
  async function playAudio() {
    if (!audio) return;
    try { await audio.play(); update({ audioBlocked: false }); }
    catch { update({ audioBlocked: true, message: 'Tap Enable speaker audio to hear your coach.' }); }
  }
  function saveTurn(turn) {
    if (!session || saved.has(turn.id) || pending.has(turn.id)) return;
    if (pending.size >= 100) { update({ warning: 'Transcript saving has reached its local limit. Stop voice and save pending turns.' }); return; }
    pending.set(turn.id, turn);
    queueSave();
  }
  function queueSave() {
    const sessionId = session?.sessionId;
    if (!sessionId) return saving;
    saving = saving.then(async () => {
      const events = [...pending.values()].slice(0, 20);
      if (!events.length) return;
      try {
        await onTranscript({ sessionId, events });
        for (const event of events) { pending.delete(event.id); saved.add(event.id); }
        update({ warning: pending.size ? 'Some voice turns are waiting to be saved.' : '' });
      } catch { update({ warning: 'Some voice captions are not saved. Tap Save captions before leaving this page.' }); }
    });
    return saving;
  }
  function eventId(role, itemId) {
    return `${role}_${String(itemId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80)}`;
  }
  function handleEvent(raw) {
    let event;
    try { if (typeof raw !== 'string' || raw.length > 131072) return; event = JSON.parse(raw); } catch { return; }
    if (!event || typeof event.type !== 'string') return;
    if (event.type === 'session.created' || event.type === 'session.updated') {
      const model = event.session?.model;
      if (model && (/astra/i.test(model) || model !== session?.model)) { stop('Voice stopped because the provider reported an unexpected model.', true); return; }
    }
    if (event.type === 'input_audio_buffer.speech_started') update({ phase: 'listening', message: snapshot.muted ? 'Microphone muted.' : 'Listening… finish your thought naturally.', userCaption: '' });
    else if (event.type === 'input_audio_buffer.speech_stopped') update({ phase: 'thinking', message: 'Coach is considering your answer…' });
    else if (event.type === 'response.created') update({ phase: 'thinking', message: 'Coach is preparing a spoken reply…', assistantCaption: '' });
    else if (event.type === 'output_audio_buffer.started') update({ phase: 'speaking', message: 'Coach is speaking. You can interrupt by talking.' });
    else if (['output_audio_buffer.stopped', 'output_audio_buffer.cleared'].includes(event.type)) update({ phase: 'listening', message: snapshot.muted ? 'Microphone muted. Tap Unmute when ready.' : 'Listening… say your next thought.' });
    else if (event.type === 'conversation.item.input_audio_transcription.delta' && event.item_id && typeof event.delta === 'string') {
      const id = eventId('user', event.item_id);
      const text = `${captions.get(id) || ''}${event.delta}`.slice(0, 12000);
      captions.set(id, text); update({ userCaption: text });
    } else if (event.type === 'conversation.item.input_audio_transcription.completed' && event.item_id && typeof event.transcript === 'string') {
      const text = event.transcript.trim().slice(0, 12000);
      const id = eventId('user', event.item_id); captions.delete(id);
      update({ userCaption: text }); if (text) saveTurn({ id, role: 'user', content: text });
    } else if (event.type === 'conversation.item.input_audio_transcription.failed') {
      update({ warning: 'Your coach received audio, but a text caption could not be made for that turn.' });
    } else if (event.type === 'response.output_audio_transcript.delta' && event.item_id && typeof event.delta === 'string') {
      const id = eventId('assistant', event.item_id);
      const text = `${captions.get(id) || ''}${event.delta}`.slice(0, 12000);
      captions.set(id, text); update({ assistantCaption: text });
    } else if (event.type === 'response.output_audio_transcript.done' && event.item_id && typeof event.transcript === 'string') {
      const text = event.transcript.trim().slice(0, 12000);
      const id = eventId('assistant', event.item_id); captions.delete(id);
      update({ assistantCaption: text }); if (text) saveTurn({ id, role: 'assistant', content: text, interrupted: snapshot.phase === 'listening' });
    } else if (event.type === 'response.done') {
      if (event.response?.status === 'failed') stop('The voice response failed. Stop and start again when you are ready; no automatic retry was made.', true);
      else if (event.response?.status === 'incomplete') update({ warning: 'This spoken reply reached its response limit. Ask a shorter follow-up question.' });
    } else if (event.type === 'error') {
      // Cancel-with-no-active-response is harmless and is documented by OpenAI.
      if (['response_cancel_not_active', 'response_not_active'].includes(event.error?.code)) return;
      stop('OpenAI reported a voice error. Check your connection or API billing before starting again. No automatic retry was made.', true);
    }
    if (captions.size > 32) captions.delete(captions.keys().next().value);
  }
  async function start({ conversationId } = {}) {
    if (active() || stopping || setupPending) return;
    if (!windowImpl.isSecureContext || !windowImpl.RTCPeerConnection || !navigatorImpl.mediaDevices?.getUserMedia) throw new Error('Voice needs an HTTPS browser with microphone and WebRTC support. Open this app in Chrome or Safari.');
    if (documentImpl.hidden) throw new Error('Keep the study app visible while starting voice.');
    const attempt = ++generation;
    setupPending = true;
    session = null; saved.clear(); pending.clear(); captions.clear();
    update({ phase: 'starting', message: 'Allow your microphone, then connect to your voice coach…', muted: false, audioBlocked: false, warning: '', userCaption: '', assistantCaption: '', setupPending: true });
    try {
      audio = documentImpl.createElement('audio'); audio.autoplay = true; audio.setAttribute('playsinline', ''); audio.setAttribute('aria-hidden', 'true'); audio.hidden = true; documentImpl.body.append(audio);
      const acquired = await navigatorImpl.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (attempt !== generation) { for (const track of acquired.getTracks()) track.stop(); return; }
      stream = acquired;
      peer = new windowImpl.RTCPeerConnection();
      for (const track of stream.getAudioTracks()) { track.onended = () => stop('The microphone disconnected. Start voice again when it is available.', true); peer.addTrack(track, stream); }
      peer.ontrack = event => { if (audio && event.streams?.[0]) { audio.srcObject = event.streams[0]; playAudio(); } };
      peer.onconnectionstatechange = () => {
        if (!peer) return;
        if (peer.connectionState === 'connected') { clearTimeout(connectionTimer); update({ phase: 'listening', message: 'Listening… have a conversation at your pace.' }); }
        if (['failed', 'disconnected'].includes(peer.connectionState)) stop('Voice lost its connection. Your microphone has stopped. Start again when ready.', true);
      };
      channel = peer.createDataChannel('oai-events');
      channel.onmessage = event => handleEvent(event.data);
      channel.onerror = () => stop('The voice event connection failed. Your microphone has stopped.', true);
      channel.onclose = () => { if (active()) stop('The voice conversation ended. Your microphone has stopped.'); };
      channel.onopen = () => {
        if (attempt !== generation || !session) return;
        update({ phase: 'listening', message: 'Connected. Say hello or choose a topic.' });
        // This one greeting is initiated only by the user's explicit Start action.
        send({ type: 'response.create', response: { instructions: 'Greet the learner briefly and ask one question about the family medicine topic they want to study. If recent study context is supplied, ask whether they want to continue it.' } });
      };
      const offer = await peer.createOffer(); await peer.setLocalDescription(offer);
      if (attempt !== generation) return;
      const created = await request('/api/voice/session', { conversationId, sdp: offer.sdp });
      if (!created || !/^[A-Za-z0-9_-]{1,100}$/.test(created.sessionId || '') || created.model !== 'gpt-realtime-2.1-mini' || typeof created.sdp !== 'string') throw new Error('The app returned an invalid voice connection.');
      session = created;
      if (attempt !== generation) { await request('/api/voice/stop', { sessionId: session.sessionId }).catch(() => {}); session = null; return; }
      update({ model: created.model });
      await peer.setRemoteDescription({ type: 'answer', sdp: created.sdp });
      durationTimer = setTimeout(() => stop('Your ten-minute voice session ended. Start another when you are ready.'), Math.min(600, Math.max(1, Number(created.maxDurationSeconds) || 600)) * 1000);
      connectionTimer = setTimeout(() => { if (active() && peer?.connectionState !== 'connected') stop('Voice did not finish connecting. Your microphone has stopped. Start again when ready.', true); }, 20000);
    } catch (error) {
      if (attempt !== generation) return;
      const message = error?.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow microphone access in your browser’s site settings, then tap Start voice.' : error?.name === 'NotFoundError' ? 'No microphone was found. Connect a microphone or use typing.' : error?.message || 'Voice could not start. Check microphone access and your connection.';
      await stop(message, true);
    } finally { setupPending = false; update({ setupPending: false }); }
  }
  async function stop(message = 'Voice stopped. Your microphone is off.', failed = false) {
    if (stopping) return stopping;
    ++generation;
    const activeSession = session;
    clearLocal();
    update({ phase: failed ? 'error' : 'idle', message, muted: false, audioBlocked: false });
    stopping = (async () => {
      // Stop audio immediately. Pending captions are text-only and cause no inference.
      await saving;
      if (activeSession) {
        try { await request('/api/voice/stop', { sessionId: activeSession.sessionId }); }
        catch (error) { update({ warning: error?.message || 'Your microphone is off, but the server could not confirm voice shutdown.' }); }
      }
    })().finally(() => { stopping = null; });
    return stopping;
  }
  function toggleMute() {
    if (!stream || !active()) return;
    const muted = !snapshot.muted;
    for (const track of stream.getAudioTracks()) track.enabled = !muted;
    if (muted) send({ type: 'input_audio_buffer.clear' });
    update({ muted, message: muted ? 'Microphone muted. You can still hear your coach.' : 'Microphone on. Say your next thought.' });
  }
  function interrupt() {
    if (!active()) return;
    send({ type: 'response.cancel' }); send({ type: 'output_audio_buffer.clear' });
    update({ phase: 'listening', message: snapshot.muted ? 'Coach stopped. Unmute to speak.' : 'Coach stopped. Say your next thought.' });
  }
  function leave() { if (active()) stop('Voice stopped because the app went into the background. Tap Start voice when you return.'); }
  documentImpl.addEventListener('visibilitychange', () => { if (documentImpl.hidden) leave(); });
  windowImpl.addEventListener('pagehide', leave);
  windowImpl.addEventListener('offline', () => { if (active()) stop('Voice stopped because the phone went offline.', true); });
  return { start, stop, toggleMute, interrupt, playAudio, retrySave: queueSave, active, state: () => ({ ...snapshot, active: active(), pendingCaptions: pending.size }) };
}
