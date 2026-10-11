import { createHash } from 'node:crypto';
import { HttpError } from './errors.js';
import { validChatId } from './chat.js';
import { createConversationAudioService, conversationAudioId, CONVERSATION_AUDIO_LIMITS } from '../packages/conversation-agent/server/openai-transcription.js';
import { VOICES, VOICE_CHOICES, DEFAULT_VOICE } from './voice-catalogue.js';

const SPEECH_MODEL = 'kokoro-v1.0';
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (status, message, code) => { throw new HttpError(status, message, code); };

function validSpeechWav(audio) {
  if (audio.length <= 44) return false;
  return audio.toString('ascii', 0, 4) === 'RIFF'
    && audio.toString('ascii', 8, 16) === 'WAVEfmt '
    && audio.readUInt32LE(4) === audio.length - 8 && audio.readUInt32LE(16) === 16
    && audio.readUInt16LE(20) === 1 && audio.readUInt16LE(22) === 1
    && audio.readUInt32LE(24) === 24000 && audio.readUInt32LE(28) === 48000
    && audio.readUInt16LE(32) === 2 && audio.readUInt16LE(34) === 16
    && audio.toString('ascii', 36, 40) === 'data'
    && audio.readUInt32LE(40) === audio.length - 44 && (audio.length - 44) % 2 === 0;
}

// Stop even when a stale provider callback ignores cancellation.
function abortable(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) { Promise.resolve(promise).catch(() => {}); return Promise.reject(signal.reason); }
  return new Promise((resolve, reject) => {
    const aborted = () => { signal.removeEventListener('abort', aborted); reject(signal.reason); };
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve(promise).then(value => { signal.removeEventListener('abort', aborted); resolve(value); }, error => { signal.removeEventListener('abort', aborted); reject(error); });
  });
}

export function createVoiceService({ db, chat, config = {}, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  if (!db?.prepare || typeof chat?.history !== 'function') throw new Error('Voice requires the shared database and chat history.');
  const endpoint = (config.speechServiceUrl || '').replace(/\/$/, ''), key = (config.speechServiceToken || '').trim();
  const configured = Boolean(endpoint && key.length >= 32), audioBytes = config.audioBytes || 2 * 1024 * 1024;
  const speechAudioBytes = config.speechAudioBytes || 8 * 1024 * 1024;
  const transcriptionModel = config.transcriptionModel || 'small.en';
  const timeoutMs = config.audioTimeoutMs || 45000, cacheMs = CONVERSATION_AUDIO_LIMITS.cacheMs;
  const active = new Map(), cache = new Map(), revisions = new Map();
  let closed = false, epoch = 0, healthy = false, healthAt = -Infinity;
  db.exec(`CREATE TABLE IF NOT EXISTS speech_requests (
    request_id TEXT PRIMARY KEY, scope TEXT NOT NULL, fingerprint TEXT NOT NULL,
    status TEXT NOT NULL, created_at INTEGER NOT NULL, metadata TEXT);
    UPDATE speech_requests SET status='uncertain' WHERE status='pending';`);

  const guardedFetch = async (url, options) => {
    options.signal?.throwIfAborted();
    const pending = Promise.resolve(fetchImpl(url, options));
    pending.then(response => { if (options.signal?.aborted) void response.body?.cancel?.().catch(() => {}); }, () => {});
    const response = await abortable(pending, options.signal);
    return {
      ok: response.ok, status: response.status, headers: response.headers,
      body: response.body && {
        cancel: () => abortable(response.body.cancel(), options.signal),
        getReader() {
          const reader = response.body.getReader();
          return { read: () => abortable(reader.read(), options.signal), cancel: () => abortable(reader.cancel(), options.signal) };
        }
      }
    };
  };
  const serviceFetch = (path, options = {}) => guardedFetch(`${endpoint}/${path}`, { ...options, redirect: 'error', headers: { ...options.headers, Authorization: `Bearer ${key}` } });
  const transcription = createConversationAudioService({ db, env: {}, now, provider: {
    configured, name: 'self-hosted', model: transcriptionModel, paidRequest: false, timeoutMs: 95000,
    request: ({ audio, signal }) => serviceFetch('transcribe', { method: 'POST', signal, headers: { 'Content-Type': 'audio/wav' }, body: audio })
  } });

  function scope(input) {
    validChatId(input.conversationId, 'Conversation ID');
    if (typeof input.ownerKey !== 'string' || !input.ownerKey || input.ownerKey.length > 256) fail(401, 'Sign in to use voice.', 'voice_authentication_required');
    return hash(`${input.ownerKey}\0${input.conversationId}`);
  }
  function revision(conversationId) { return `${epoch}:${revisions.get(conversationId) || 0}`; }
  function prune() { for (const [id, item] of cache) if (item.expiresAt <= now()) cache.delete(id); }
  function ready(input) {
    scope(input);
    if (closed || !configured) fail(503, 'The free speech service is not connected. Continue with typed chat.', 'voice_unavailable');
    if (input.signal?.aborted || input.authorize?.() === false) fail(409, 'This audio operation was stopped.', 'voice_cancelled');
  }
  function options() {
    return { ...transcription.options(), enabled: configured && healthy && !closed, audio: { ...transcription.options().audio, maxBytes: audioBytes },
      speechModel: SPEECH_MODEL, voices: [...VOICES], voiceChoices: VOICE_CHOICES, defaultVoice: DEFAULT_VOICE,
      maxSpeechCharacters: 4096, speechFormat: 'wav', aiGenerated: true,
      unavailableReason: !configured ? 'The free speech service is not connected yet. Typed chat is available.' : !healthy ? 'The speech service is warming up or unavailable. Typed chat is available.' : null };
  }
  async function status({ signal } = {}) {
    if (!configured || closed) return options();
    if (healthy && now() - healthAt < 10000) return options();
    const bounded = AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]);
    let reader;
    try {
      const response = await serviceFetch('health', { signal: bounded });
      if (!response.ok || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') || '') || Number(response.headers.get('content-length')) > 8192 || !response.body?.getReader) throw new Error('Speech readiness unavailable.');
      reader = response.body.getReader(); const pieces = []; let bytes = 0;
      for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.length; if (bytes > 8192) throw new Error('Speech readiness too large.'); pieces.push(Buffer.from(part.value)); }
      const value = JSON.parse(Buffer.concat(pieces).toString('utf8'));
      healthy = value.ready === true && value.transcriptionModel === transcriptionModel && value.speechModel === SPEECH_MODEL && VOICES.every(voice => value.voices?.includes(voice));
    } catch { healthy = false; }
    finally { if (reader) void reader.cancel().catch(() => {}); healthAt = now(); }
    return options();
  }
  async function start(input) {
    ready(input);
    const token = revision(input.conversationId);
    if (chat.history(input.conversationId).conversation?.readOnly) fail(409, 'Start a new conversation to use voice.', 'voice_read_only');
    if (!(await status(input)).enabled) fail(503, options().unavailableReason, 'voice_unavailable');
    ready(input);
    if (token !== revision(input.conversationId)) fail(409, 'This voice operation was stopped.', 'voice_cancelled');
    if (chat.history(input.conversationId).conversation?.readOnly) fail(409, 'Start a new conversation to use voice.', 'voice_read_only');
    return { ...transcription.start(input), ...options() };
  }
  function end(input) { scope(input); const result = transcription.end(input); invalidate({ conversationId: input.conversationId, speechOnly: true }); return result; }
  async function transcribe(input) {
    ready(input);
    if (typeof input.audioBase64 !== 'string' || input.audioBase64.length > Math.ceil(audioBytes / 3) * 4 || input.audioBase64.length / 4 * 3 - (input.audioBase64.endsWith('==') ? 2 : input.audioBase64.endsWith('=') ? 1 : 0) > audioBytes) fail(413, 'The recording is too large. Type your message instead.', 'voice_audio_limit');
    const result = await transcription.transcribe(input);
    if (!result.text.trim()) fail(422, 'No speech was recognized. Type your message or make a new recording.', 'voice_empty_transcript');
    return result;
  }
  function savedReply(input) {
    validChatId(input.messageId, 'Message ID');
    const history = chat.history(input.conversationId);
    const turn = history.turns.find(item => item.attemptId === input.messageId);
    if (!turn || turn.status !== 'completed' || turn.imported || typeof turn.content !== 'string' || !turn.content.trim()) fail(409, 'Only a completed saved reply can be spoken.', 'voice_reply_unavailable');
    if (turn.content.length > 4096) fail(422, 'This reply is too long for audio. Its full text remains available.', 'speech_too_long');
    return turn;
  }
  async function speech(input) {
    ready(input); prune();
    const requestId = conversationAudioId(input.requestId), ownerScope = scope(input), reply = savedReply(input);
    const voice = input.voice || DEFAULT_VOICE;
    if (!VOICES.includes(voice)) fail(400, 'Choose a supported voice.', 'invalid_voice');
    const fingerprint = hash(`${input.messageId}\0${voice}\0${reply.content}`);
    const prior = db.prepare('SELECT * FROM speech_requests WHERE request_id=?').get(requestId);
    if (prior && (prior.scope !== ownerScope || prior.fingerprint !== fingerprint)) fail(409, 'This speech ID was already used for a different request.', 'speech_request_conflict');
    if (prior?.status === 'complete') {
      const saved = cache.get(requestId);
      if (!saved) fail(409, 'This audio is no longer in memory. No automatic regeneration was made.', 'speech_cache_expired');
      return { audio: Buffer.from(saved.audio), contentType: 'audio/wav', cached: true };
    }
    if (prior) fail(409, 'The earlier audio request has an uncertain outcome. No automatic retry was made.', 'speech_request_uncertain');
    if (active.size) fail(409, 'Another reply is preparing audio.', 'speech_busy');
    if (db.prepare('SELECT COUNT(*) AS count FROM speech_requests').get().count >= CONVERSATION_AUDIO_LIMITS.maxLedgerEntries) fail(429, 'The speech request history is full.', 'speech_ledger_limit');

    const controller = new AbortController(), signal = input.signal ? AbortSignal.any([controller.signal, input.signal]) : controller.signal;
    const token = revision(input.conversationId), started = now();
    const timer = setTimeout(() => controller.abort(new HttpError(504, 'Audio preparation timed out. The reply remains available as text.', 'voice_timeout')), timeoutMs);
    const metadata = { provider: 'self-hosted', endpoint: 'speech', model: SPEECH_MODEL, voice, usage: null, estimatedCostUsd: 0, paidRequest: false, hostingCostIncluded: false };
    const allowed = () => {
      if (signal.aborted || closed || token !== revision(input.conversationId) || input.authorize?.() === false) fail(409, 'This audio operation was stopped.', 'voice_cancelled');
      const current = savedReply(input);
      if (current.content !== reply.content) fail(409, 'The saved reply changed. Audio preparation stopped.', 'voice_reply_unavailable');
    };
    db.prepare('INSERT INTO speech_requests VALUES(?,?,?,?,?,?)').run(requestId, ownerScope, fingerprint, 'pending', started, JSON.stringify(metadata));
    active.set(requestId, { controller, scope: ownerScope, conversationId: input.conversationId });
    let reader, responseBody, completed = false;
    try {
      allowed();
      const response = await serviceFetch('speech', { method: 'POST', signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: reply.content, voice }) });
      responseBody = response.body;
      if (!response.ok) { void response.body?.cancel?.().catch(() => {}); fail(response.status === 429 ? 429 : 502, 'Audio could not be prepared. The reply remains available as text.', 'speech_provider_failed'); }
      if (!/^audio\/wav(?:;|$)/i.test(response.headers.get('content-type') || '') || Number(response.headers.get('content-length')) > speechAudioBytes || !response.body?.getReader) fail(502, 'The speech provider returned unusable audio.', 'speech_provider_format');
      reader = response.body.getReader();
      const pieces = []; let bytes = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > speechAudioBytes) fail(502, 'Audio exceeded its size limit. The reply remains available as text.', 'speech_audio_limit');
        pieces.push(Buffer.from(value));
      }
      allowed();
      if (!bytes) fail(502, 'The speech provider returned empty audio.', 'speech_provider_format');
      const audio = Buffer.concat(pieces);
      if (!validSpeechWav(audio)) fail(502, 'The speech service returned an invalid WAV recording.', 'speech_provider_format');
      db.prepare("UPDATE speech_requests SET status='complete',metadata=? WHERE request_id=? AND status='pending'").run(JSON.stringify({ ...metadata, bytes, latencyMs: Math.max(0, now() - started) }), requestId);
      while (cache.size >= 10) cache.delete(cache.keys().next().value);
      cache.set(requestId, { audio, conversationId: input.conversationId, scope: ownerScope, expiresAt: now() + cacheMs });
      completed = true;
      return { audio: Buffer.from(audio), contentType: 'audio/wav', cached: false };
    } catch (error) {
      db.prepare("UPDATE speech_requests SET status='uncertain',metadata=? WHERE request_id=? AND status='pending'").run(JSON.stringify({ ...metadata, cancelled: signal.aborted, billingOutcome: 'no_vendor_api_fee' }), requestId);
      healthy = false;
      if (signal.aborted) throw signal.reason instanceof HttpError ? signal.reason : new HttpError(409, 'Audio preparation stopped. The reply remains available as text.', 'voice_cancelled');
      if (error instanceof HttpError) throw error;
      fail(502, 'Audio could not be prepared. No automatic retry was made.', 'speech_provider_failed');
    } finally {
      clearTimeout(timer); active.delete(requestId);
      if (!completed) {
        controller.abort();
        if (reader) void reader.cancel().catch(() => {});
        else void responseBody?.cancel?.().catch(() => {});
      }
    }
  }
  function cancel(input) {
    const ownerScope = scope(input), requestId = conversationAudioId(input.requestId), item = active.get(requestId);
    let cancelled = false;
    if (item?.scope === ownerScope) {
      item.controller.abort(); cancelled = true;
      db.prepare("UPDATE speech_requests SET status='uncertain' WHERE request_id=? AND status='pending'").run(requestId);
    }
    if (input.sessionId) cancelled = transcription.cancel(input).cancelled || cancelled;
    return { requestId, cancelled };
  }
  function invalidate(input = {}) {
    const conversationId = input.conversationId;
    if (conversationId) revisions.set(conversationId, (revisions.get(conversationId) || 0) + 1);
    else { epoch++; revisions.clear(); }
    for (const [id, item] of active) if (!conversationId || item.conversationId === conversationId) {
      item.controller.abort(); db.prepare("UPDATE speech_requests SET status='uncertain' WHERE request_id=? AND status='pending'").run(id);
    }
    for (const [id, item] of cache) if (!conversationId || item.conversationId === conversationId) cache.delete(id);
    if (!input.speechOnly) transcription.invalidate();
  }
  return { options, status, start, end, transcribe, cancel, speech, speak: speech, invalidate,
    close() { if (!closed) { invalidate(); transcription.close(); closed = true; } } };
}
