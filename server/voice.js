import { createHash } from 'node:crypto';
import { HttpError } from './errors.js';
import { validChatId } from './chat.js';
import { createConversationAudioService, conversationAudioId, CONVERSATION_TRANSCRIPTION_MODEL, CONVERSATION_AUDIO_LIMITS } from '../packages/conversation-agent/server/openai-transcription.js';

const SPEECH_ENDPOINT = 'https://api.openai.com/v1/audio/speech';
const SPEECH_MODEL = 'gpt-4o-mini-tts';
const VOICES = ['marin', 'cedar', 'coral', 'sage', 'ash'];
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (status, message, code) => { throw new HttpError(status, message, code); };

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
  if ((config.transcriptionModel || CONVERSATION_TRANSCRIPTION_MODEL) !== CONVERSATION_TRANSCRIPTION_MODEL) throw new Error('Use the pinned transcription model.');
  if ((config.speechModel || SPEECH_MODEL) !== SPEECH_MODEL) throw new Error('Use gpt-4o-mini-tts for the configured voices.');
  const key = (config.apiKey || '').trim(), audioBytes = config.audioBytes || 2 * 1024 * 1024;
  const timeoutMs = config.audioTimeoutMs || 45000, cacheMs = CONVERSATION_AUDIO_LIMITS.cacheMs;
  const active = new Map(), cache = new Map(), revisions = new Map();
  let closed = false, epoch = 0;
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
  const transcription = createConversationAudioService({ db, env: { OPENAI_API_KEY: key }, fetchImpl: guardedFetch, now });

  function scope(input) {
    validChatId(input.conversationId, 'Conversation ID');
    if (typeof input.ownerKey !== 'string' || !input.ownerKey || input.ownerKey.length > 256) fail(401, 'Sign in to use voice.', 'voice_authentication_required');
    return hash(`${input.ownerKey}\0${input.conversationId}`);
  }
  function revision(conversationId) { return `${epoch}:${revisions.get(conversationId) || 0}`; }
  function prune() { for (const [id, item] of cache) if (item.expiresAt <= now()) cache.delete(id); }
  function ready(input) {
    scope(input);
    if (closed || !key) fail(503, 'AI voice is unavailable. Continue with typed chat.', 'voice_unavailable');
    if (input.signal?.aborted || input.authorize?.() === false) fail(409, 'This audio operation was stopped.', 'voice_cancelled');
  }
  function options() {
    return { ...transcription.options(), enabled: Boolean(key) && !closed, audio: { ...transcription.options().audio, maxBytes: audioBytes },
      speechModel: SPEECH_MODEL, voices: [...VOICES], maxSpeechCharacters: 4096, speechFormat: 'mp3', aiGenerated: true };
  }
  function start(input) {
    ready(input);
    if (chat.history(input.conversationId).conversation?.readOnly) fail(409, 'Start a new conversation to use voice.', 'voice_read_only');
    return transcription.start(input);
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
    const voice = input.voice || 'marin';
    if (!VOICES.includes(voice)) fail(400, 'Choose a supported voice.', 'invalid_voice');
    const fingerprint = hash(`${input.messageId}\0${voice}\0${reply.content}`);
    const prior = db.prepare('SELECT * FROM speech_requests WHERE request_id=?').get(requestId);
    if (prior && (prior.scope !== ownerScope || prior.fingerprint !== fingerprint)) fail(409, 'This speech ID was already used for a different request.', 'speech_request_conflict');
    if (prior?.status === 'complete') {
      const saved = cache.get(requestId);
      if (!saved) fail(409, 'This audio is no longer in memory. No automatic regeneration was made.', 'speech_cache_expired');
      return { audio: Buffer.from(saved.audio), contentType: 'audio/mpeg', cached: true };
    }
    if (prior) fail(409, 'The earlier audio request has an uncertain outcome. No automatic retry was made.', 'speech_request_uncertain');
    if (active.size) fail(409, 'Another reply is preparing audio.', 'speech_busy');
    if (db.prepare('SELECT COUNT(*) AS count FROM speech_requests').get().count >= CONVERSATION_AUDIO_LIMITS.maxLedgerEntries) fail(429, 'The speech request history is full.', 'speech_ledger_limit');

    const controller = new AbortController(), signal = input.signal ? AbortSignal.any([controller.signal, input.signal]) : controller.signal;
    const token = revision(input.conversationId), started = now();
    const timer = setTimeout(() => controller.abort(new HttpError(504, 'Audio preparation timed out. The reply remains available as text.', 'voice_timeout')), timeoutMs);
    const metadata = { provider: 'openai', endpoint: 'audio/speech', model: SPEECH_MODEL, voice, usage: null, estimatedCostUsd: null };
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
      const response = await guardedFetch(SPEECH_ENDPOINT, { method: 'POST', redirect: 'error', signal,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: SPEECH_MODEL, input: reply.content, voice, response_format: 'mp3' }) });
      responseBody = response.body;
      if (!response.ok) { void response.body?.cancel?.().catch(() => {}); fail(response.status === 429 ? 429 : 502, 'Audio could not be prepared. The reply remains available as text.', 'speech_provider_failed'); }
      if (!/^audio\/(?:mpeg|mp3)(?:;|$)/i.test(response.headers.get('content-type') || '') || Number(response.headers.get('content-length')) > audioBytes || !response.body?.getReader) fail(502, 'The speech provider returned unusable audio.', 'speech_provider_format');
      reader = response.body.getReader();
      const pieces = []; let bytes = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > audioBytes) fail(502, 'Audio exceeded its size limit. The reply remains available as text.', 'speech_audio_limit');
        pieces.push(Buffer.from(value));
      }
      allowed();
      if (!bytes) fail(502, 'The speech provider returned empty audio.', 'speech_provider_format');
      const audio = Buffer.concat(pieces);
      db.prepare("UPDATE speech_requests SET status='complete',metadata=? WHERE request_id=? AND status='pending'").run(JSON.stringify({ ...metadata, bytes, latencyMs: Math.max(0, now() - started) }), requestId);
      while (cache.size >= 10) cache.delete(cache.keys().next().value);
      cache.set(requestId, { audio, conversationId: input.conversationId, scope: ownerScope, expiresAt: now() + cacheMs });
      completed = true;
      return { audio: Buffer.from(audio), contentType: 'audio/mpeg', cached: false };
    } catch (error) {
      db.prepare("UPDATE speech_requests SET status='uncertain',metadata=? WHERE request_id=? AND status='pending'").run(JSON.stringify({ ...metadata, cancelled: signal.aborted, billingOutcome: 'unknown' }), requestId);
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
  return { options, start, end, transcribe, cancel, speech, speak: speech, invalidate,
    close() { if (!closed) { invalidate(); transcription.close(); closed = true; } } };
}
