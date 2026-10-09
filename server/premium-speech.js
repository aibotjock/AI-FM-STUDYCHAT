import { createHash } from 'node:crypto';
import { renderReviewedTutor } from './natural-tutor.js';
import { STUDY_NO_EVIDENCE, STUDY_REAL_CARE_REDIRECT } from './study-curriculum.js';

export const PREMIUM_SPEECH_MODEL = 'gpt-4o-mini-tts';
export const PREMIUM_VOICES = Object.freeze(['marin', 'cedar', 'coral', 'sage', 'ash'].map(id => Object.freeze({ id, label: id[0].toUpperCase() + id.slice(1) })));
export const PREMIUM_PREVIEW_TEXT = 'Hello. I am your AI study voice. We can work through one question at a time, at your pace.';
export const PREMIUM_SPEECH_LIMITS = Object.freeze({ maxChunkChars: 4096, maxChunks: 8, maxTotalChars: 24000, maxAudioBytes: 3 * 1024 * 1024, cacheBytes: 16 * 1024 * 1024, cacheEntries: 16, cacheTtlMs: 5 * 60 * 1000, timeoutMs: 45000, maxLedgerEntries: 10000 });
const endpoint = 'https://api.openai.com/v1/audio/speech';
const digest = value => createHash('sha256').update(value).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const object = value => value && typeof value === 'object' && !Array.isArray(value);

export class PremiumSpeechError extends Error {
  constructor(status, message, code = 'speech_unavailable') { super(message); this.name = 'PremiumSpeechError'; this.status = status; this.code = code; }
}
const fail = (status, message, code) => { throw new PremiumSpeechError(status, message, code); };
export function premiumVoice(value) {
  if (!PREMIUM_VOICES.some(voice => voice.id === value)) fail(400, 'Choose Marin, Cedar, Coral, Sage or Ash.', 'invalid_voice');
  return value;
}
export function speechRequestId(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) fail(400, 'Use a new UUID for an explicit speech request.', 'invalid_speech_request');
  return value.toLowerCase();
}

/** Every character is retained. A long response is refused rather than silently clipped. */
export function splitPremiumSpeech(text) {
  if (typeof text !== 'string' || !text.trim() || text.includes('\0') || text.length > PREMIUM_SPEECH_LIMITS.maxTotalChars) fail(409, 'This reply is too long or unavailable for speech. Choose a shorter study reply.', 'speech_text_limit');
  const chunks = [];
  let offset = 0;
  while (offset < text.length) {
    let end = Math.min(offset + PREMIUM_SPEECH_LIMITS.maxChunkChars, text.length);
    if (end < text.length) {
      const tailStart = Math.max(offset, end - 512);
      const tail = text.slice(tailStart, end);
      const sentences = [...tail.matchAll(/[.!?]\s+|\n+/g)];
      const last = sentences.at(-1);
      if (last) end = tailStart + last.index + last[0].length;
      else {
        const spaces = [...tail.matchAll(/\s+/g)];
        const whitespace = spaces.at(-1);
        if (whitespace) end = tailStart + whitespace.index + whitespace[0].length;
      }
    }
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end--;
    chunks.push(text.slice(offset, end)); offset = end;
  }
  if (chunks.length > PREMIUM_SPEECH_LIMITS.maxChunks) fail(409, 'This reply needs too many speech chunks. Choose a shorter reply.', 'speech_text_limit');
  return chunks;
}

function evidenceFor(references, keys) {
  if (!Array.isArray(keys) || keys.length > 6 || new Set(keys).size !== keys.length) fail(409, 'The current speech source check is unavailable.', 'speech_source_check');
  return keys.map(key => {
    if (typeof key !== 'string') fail(409, 'The current speech source check is unavailable.', 'speech_source_check');
    const [conditionId, sectionId, extra] = key.split(':');
    const condition = references.get(conditionId);
    const section = !extra && condition?.current && condition.chunks.find(item => item.id === sectionId);
    if (!section) fail(409, 'This reply needs a new current study-source check before it can be spoken.', 'speech_source_expired');
    return { key, conditionId, conditionTitle: condition.title, heading: section.heading, text: section.text, checkedAt: condition.checkedAt };
  });
}
const processAllowlist = new Set([STUDY_NO_EVIDENCE, STUDY_REAL_CARE_REDIRECT]);

/** Reconstruct trusted server text with current sources; browser prose is never an input. */
export function premiumSpeechText({ conversation, message, references, settings = {} }) {
  if (!references || !conversation || conversation.internalCheck || message?.role !== 'assistant' || message.importedEvidence || message.importedReview || message.voiceTranscript || message.ai?.imported || message.aiReview?.imported || message.studyRejection || message.studyQuestion?.imported || message.studyAnswer?.imported) fail(409, 'This message is not eligible for an AI voice. Send a new study message first.', 'speech_message_untrusted');
  const index = conversation.messages.findIndex(item => item === message);
  const user = conversation.messages[index - 1];
  if (index < 1 || user?.role !== 'user' || message.responseTo !== user.id) fail(409, 'The speech response does not match a trusted conversation turn.', 'speech_message_untrusted');
  let reconstructed;
  try {
    if (message.reviewedDialogue === true && message.groundingReview?.version === 1 && message.groundingReview.status === 'passed' && message.sourceVerified === false && message.canonicalSpokenText === false) {
      const keys = [...new Set((message.naturalSegments || []).flatMap(segment => segment.sourceChunkIds || []))];
      const evidence = evidenceFor(references, keys);
      reconstructed = renderReviewedTutor({ segments: message.naturalSegments }, { approved: true, segments: message.groundingReview.segments }, { references, evidence, conversation: { ...conversation, messages: conversation.messages.slice(0, index) }, settings, pendingQuestion: message.pendingStudyQuestion, now: message.groundingReview.reviewedAt });
      if (!same(reconstructed.groundingReview, message.groundingReview)) fail(409, 'The stored grounding review has changed.', 'speech_message_untrusted');
    } else if (message.curriculum === true && message.sourceVerified === true && message.current === true) {
      if (message.studyAnswer) reconstructed = references.gradeQuestion(message.studyAnswer, message.studyAnswer.choiceId);
      else if (message.studyQuestion) {
        const condition = references.get(message.studyQuestion.key?.split(':')[0]);
        const evidence = condition?.current ? evidenceFor(references, condition.chunks.slice(0, 1).map(section => `${condition.id}:${section.id}`)) : [];
        reconstructed = references.render({ chunkIds: [], questionId: message.studyQuestion.key, unsupported: false }, evidence);
        if (!same(reconstructed.studyQuestion, message.studyQuestion)) fail(409, 'This practice question has changed.', 'speech_source_expired');
      } else if (message.studySelection) reconstructed = references.render({ chunkIds: message.studySelection.chunkIds, questionId: null, unsupported: false }, evidenceFor(references, message.studySelection.chunkIds));
    } else if (message.sourceVerified === true && message.canonicalStudyProcess === true && processAllowlist.has(message.content) && !message.citations?.length) reconstructed = { content: message.content, citations: [] };
  } catch (error) {
    if (error instanceof PremiumSpeechError) throw error;
    fail(409, 'This reply did not pass its current source reconstruction. Ask for a new reply.', 'speech_source_check');
  }
  if (!reconstructed || reconstructed.unsupported || reconstructed.content !== message.content || !same(reconstructed.citations || [], message.citations || []) || (message.spokenText !== undefined && reconstructed.spokenText !== message.spokenText)) fail(409, 'This reply did not pass its current source reconstruction. Ask for a new reply.', 'speech_source_check');
  return reconstructed.spokenText || reconstructed.content;
}

async function boundedAudio(response) {
  if (!/^audio\/(?:mpeg|mp3)(?:;|$)/i.test(response.headers.get('content-type') || '')) { await response.body?.cancel?.().catch(() => {}); fail(502, 'The speech provider returned an unexpected audio format.', 'speech_provider_format'); }
  if (Number(response.headers.get('content-length')) > PREMIUM_SPEECH_LIMITS.maxAudioBytes) { await response.body?.cancel?.().catch(() => {}); fail(502, 'The speech audio exceeded its size limit.', 'speech_audio_limit'); }
  const chunks = []; let bytes = 0;
  if (!response.body?.getReader) fail(502, 'The speech provider returned no readable audio.', 'speech_provider_format');
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    bytes += value.byteLength;
    if (bytes > PREMIUM_SPEECH_LIMITS.maxAudioBytes) { await reader.cancel(); fail(502, 'The speech audio exceeded its size limit.', 'speech_audio_limit'); }
    chunks.push(value);
  }
  const audio = Buffer.concat(chunks);
  if (audio.length < 4 || !(audio.subarray(0, 3).toString('ascii') === 'ID3' || (audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0))) fail(502, 'The speech provider returned invalid MP3 audio.', 'speech_provider_format');
  return audio;
}

export function createPremiumSpeechService({ env = process.env, fetchImpl = globalThis.fetch, db, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  if (!db?.prepare) throw new Error('Premium speech requires a durable request ledger.');
  const key = typeof env.OPENAI_API_KEY === 'string' ? env.OPENAI_API_KEY.trim() : '';
  db.exec("CREATE TABLE IF NOT EXISTS premium_speech_requests(request_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL,metadata TEXT); UPDATE premium_speech_requests SET status='uncertain' WHERE status='pending';");
  const cache = new Map(), active = new Map(); let bytes = 0, stopped = false;
  function prune() {
    for (const [id, item] of cache) if (item.expiresAt <= now()) { bytes -= item.audio.length; cache.delete(id); }
  }
  function invalidate() { cache.clear(); bytes = 0; for (const controller of active.values()) controller.abort(); }
  function put(fingerprint, audio, metadata) {
    prune();
    const prior = cache.get(fingerprint); if (prior) bytes -= prior.audio.length;
    cache.delete(fingerprint); cache.set(fingerprint, { audio, metadata, expiresAt: now() + PREMIUM_SPEECH_LIMITS.cacheTtlMs }); bytes += audio.length;
    while (cache.size > PREMIUM_SPEECH_LIMITS.cacheEntries || bytes > PREMIUM_SPEECH_LIMITS.cacheBytes) { const [id, item] = cache.entries().next().value; bytes -= item.audio.length; cache.delete(id); }
  }
  async function synthesize({ text, voice, requestId, scope = 'preview', signal, authorize = () => true }) {
    premiumVoice(voice); requestId = speechRequestId(requestId);
    if (typeof text !== 'string' || !text.trim() || text.length > PREMIUM_SPEECH_LIMITS.maxChunkChars || text.includes('\0')) fail(400, 'Use a bounded server-owned speech chunk.', 'speech_text_limit');
    const allowed = () => { if (stopped || signal?.aborted || authorize() !== true) fail(409, 'This speech request is no longer active.', 'speech_request_inactive'); };
    allowed();
    if (!key) fail(503, 'OpenAI speech is not configured on this server.', 'speech_not_configured');
    const fingerprint = digest(JSON.stringify({ model: PREMIUM_SPEECH_MODEL, voice, scope, textHash: digest(text) }));
    prune();
    const prior = db.prepare('SELECT fingerprint,status FROM premium_speech_requests WHERE request_id=?').get(requestId);
    if (prior && prior.fingerprint !== fingerprint) fail(409, 'This speech request ID was already used for a different voice or reply.', 'speech_request_conflict');
    if (prior && prior.status !== 'complete') fail(409, 'The earlier speech request has an uncertain outcome. It will not be automatically repeated.', 'speech_request_uncertain');
    const cached = cache.get(fingerprint);
    if (cached) {
      allowed();
      if (!prior) {
        if (db.prepare('SELECT COUNT(*) AS count FROM premium_speech_requests').get().count >= PREMIUM_SPEECH_LIMITS.maxLedgerEntries) fail(429, 'The speech request history is full.', 'speech_ledger_limit');
        db.prepare('INSERT INTO premium_speech_requests VALUES(?,?,?,?,?)').run(requestId, fingerprint, 'complete', now(), JSON.stringify({ ...cached.metadata, paidRequest: false }));
      }
      return { audio: cached.audio, cached: true, metadata: { ...cached.metadata, paidRequest: false } };
    }
    if (prior) fail(409, 'That audio is no longer in memory. Start an explicit new speech request to generate it again.', 'speech_audio_expired');
    if (active.size) fail(409, 'Another speech chunk is being prepared. Wait for it before requesting another.', 'speech_busy');
    if (db.prepare('SELECT COUNT(*) AS count FROM premium_speech_requests').get().count >= PREMIUM_SPEECH_LIMITS.maxLedgerEntries) fail(429, 'The speech request history is full.', 'speech_ledger_limit');
    const controller = new AbortController(), timer = setTimer(() => controller.abort(), PREMIUM_SPEECH_LIMITS.timeoutMs);
    timer.unref?.();
    const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    db.prepare('INSERT INTO premium_speech_requests VALUES(?,?,?,?,?)').run(requestId, fingerprint, 'pending', now(), null);
    active.set(requestId, controller);
    const startedAt = now();
    try {
      const response = await fetchImpl(endpoint, { method: 'POST', redirect: 'error', signal: requestSignal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ model: PREMIUM_SPEECH_MODEL, voice, input: text, response_format: 'mp3', instructions: 'Read the supplied words exactly in a clear, warm, conversational voice. Do not add introductions, explanations, facts or advice.' }) });
      if (!response.ok) { await response.body?.cancel?.().catch(() => {}); fail(response.status === 429 ? 429 : 502, 'OpenAI could not prepare this voice. No automatic retry was made.', 'speech_provider_failed'); }
      const audio = await boundedAudio(response);
      if (requestSignal.aborted) fail(409, 'This speech request was stopped.', 'speech_request_inactive');
      allowed();
      const providerId = response.headers.get('x-request-id');
      const metadata = { provider: 'openai', endpoint: 'audio/speech', model: PREMIUM_SPEECH_MODEL, voice, providerRequestId: typeof providerId === 'string' && /^[A-Za-z0-9_-]{1,180}$/.test(providerId) ? providerId : null, inputCharacters: text.length, audioBytes: audio.length, latencyMs: Math.max(0, now() - startedAt), usage: null, estimatedCostUsd: null, pricingBasis: 'Token usage and exact cost are unavailable in the binary speech response.', paidRequest: true };
      db.prepare("UPDATE premium_speech_requests SET status='complete',metadata=? WHERE request_id=?").run(JSON.stringify(metadata), requestId);
      put(fingerprint, audio, metadata);
      return { audio, cached: false, metadata };
    } catch (error) {
      if (!stopped) db.prepare("UPDATE premium_speech_requests SET status='uncertain' WHERE request_id=?").run(requestId);
      if (error instanceof PremiumSpeechError) throw error;
      fail(requestSignal.aborted ? 409 : 502, requestSignal.aborted ? 'This speech request was stopped.' : 'Speech could not be prepared. No automatic retry was made.', requestSignal.aborted ? 'speech_request_inactive' : 'speech_provider_failed');
    } finally { clearTimer(timer); active.delete(requestId); }
  }
  return { configured: Boolean(key), options: () => ({ enabled: Boolean(key) && !stopped, provider: 'openai', model: PREMIUM_SPEECH_MODEL, defaultVoice: 'marin', voices: PREMIUM_VOICES, disclosure: 'These voices are AI-generated.', maxChunkChars: PREMIUM_SPEECH_LIMITS.maxChunkChars, maxChunks: PREMIUM_SPEECH_LIMITS.maxChunks }), synthesize, invalidate, inspect(requestId) { requestId = speechRequestId(requestId); prune(); const row = db.prepare('SELECT status,fingerprint,metadata FROM premium_speech_requests WHERE request_id=?').get(requestId); return { requestId, status: row?.status || 'not_started', cachedAudioAvailable: Boolean(row && cache.has(row.fingerprint)), metadata: row?.metadata ? JSON.parse(row.metadata) : null }; }, get active() { return active.size; }, close() { if (stopped) return; invalidate(); for (const id of active.keys()) db.prepare("UPDATE premium_speech_requests SET status='uncertain' WHERE request_id=?").run(id); stopped = true; } };
}
