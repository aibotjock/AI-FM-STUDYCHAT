import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadStudyCurriculum } from './study-curriculum.js';
import { renderReviewedTutor, NaturalTutorError } from './natural-tutor.js';

export const NATURAL_CHECK_TITLE = 'Operator natural conversation check · synthetic study';
export const LEGACY_NATURAL_STUDY_TURN = Object.freeze({ requestId: 'natural-dialogue-v1-study-gpt-4.1-mini', content: 'Ready to study. For the family medicine board exam, explain one source-linked point about atrial fibrillation in your own words, then ask one recall question.' });
export const NATURAL_CHECK_TURNS = Object.freeze([
  { requestId: 'natural-dialogue-v1-hello-gpt-4.1-mini', content: 'Hi. For this synthetic study session, call me Morgan. I’m not ready to study yet; can we just chat for a minute?' },
  { requestId: 'natural-dialogue-v1-context-gpt-4.1-mini', content: 'What name did I ask you to call me? Please answer naturally and then ask me how my day has been.' },
  { requestId: 'natural-dialogue-v2-study-gpt-4.1-mini', content: 'For family medicine board study, explain just one directly supported point about atrial fibrillation in a short paragraph with its source IDs. Then ask a neutral recall question about what the paragraph said, without adding a new clinical premise.' }
]);
const KNOWN_TURNS = [...NATURAL_CHECK_TURNS, LEGACY_NATURAL_STUDY_TURN];
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = value => typeof value === 'string' && /^[A-Za-z0-9._-]{1,100}$/.test(value);
const validModel = value => ['gpt-4.1-mini', 'gpt-4.1-mini-2025-04-14'].includes(value);
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 10000000;
const trustedAi = ai => object(ai) && ai.provider === 'openai' && ai.requestedModel === 'gpt-4.1-mini' && validModel(ai.returnedModel) && !ai.imported && !ai.clientReported;
function usage(ai) {
  return { returnedModel: validModel(ai?.returnedModel) ? ai.returnedModel : null,
    inputTokens: count(ai?.usage?.prompt_tokens) ? ai.usage.prompt_tokens : null,
    outputTokens: count(ai?.usage?.completion_tokens) ? ai.usage.completion_tokens : null,
    estimatedCostUsd: Number.isFinite(ai?.estimatedCostUsd) && ai.estimatedCostUsd >= 0 ? ai.estimatedCostUsd : null };
}
function validateReply(message, index, references, conversation) {
  if (!object(message) || message.role !== 'assistant' || message.reviewedDialogue !== true || message.sourceVerified !== false || message.canonicalSpokenText !== false || message.humanReview !== false || message.importedEvidence || message.unsupported || message.offline || !trustedAi(message.ai) || !trustedAi(message.aiReview) || message.aiTotal?.calls !== 2 || message.groundingReview?.version !== 1 || message.groundingReview.status !== 'passed') return false;
  const evidence = index === 2 ? references.retrieve(NATURAL_CHECK_TURNS[2].content, { conditionIds: ['atrial-fibrillation'] }) : [];
  let rendered;
  try {
    rendered = renderReviewedTutor({ segments: message.naturalSegments }, { approved: true, segments: message.groundingReview.segments }, { references, evidence, conversation, now: message.groundingReview.reviewedAt });
  } catch { return false; }
  if (message.content !== rendered.content || message.spokenText !== rendered.spokenText || JSON.stringify(message.citations) !== JSON.stringify(rendered.citations) || JSON.stringify(message.groundingReview) !== JSON.stringify(rendered.groundingReview)) return false;
  if (index < 2) return rendered.groundingReview.externalClaimCount === 0 && rendered.citations.length === 0 && (index !== 1 || (/\bMorgan\b/i.test(rendered.spokenText) && rendered.spokenText.includes('?')));
  return message.current === true && message.grounded === true && rendered.groundingReview.medicalClaimCount > 0 && rendered.citations.length > 0 && rendered.conditionIds.length === 1 && rendered.conditionIds[0] === 'atrial-fibrillation' && rendered.spokenText.includes('?');
}

/** Reuse passed context turns; one new corrected study identity, no automatic retry. */
export async function runNaturalConversationCheck({ baseUrl, env = process.env, fetchImpl = globalThis.fetch, flushTelemetry = async () => {}, curriculum: suppliedCurriculum } = {}) {
  if (env.STUDY_INITIAL_CONVERSATION_CHECK !== 'natural-v2') return { skipped: true };
  if ((env.APP_MODE || 'personal') !== 'personal' || (env.AI_PROVIDER || 'openai').trim().toLowerCase() !== 'openai') return { skipped: true, reason: 'personal_openai_only' };
  const base = new URL(baseUrl);
  if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || base.pathname !== '/' || base.search || base.hash || base.username || base.password) throw new Error('Natural conversation checks require the local app listener.');
  if (!(env.STUDY_ACCESS_TOKEN || '').trim() || !(env.OPENAI_API_KEY || '').trim()) return { skipped: true, reason: 'server_credentials_not_configured' };
  let cookie = '', authenticated = false, submitted = 0;
  let receipt = { failed: true, stage: 'natural_conversation_check' };
  const request = (path, body) => fetchImpl(new URL(path, base), { method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(110000), headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  try {
    const statusResponse = await request('/api/status');
    if (!statusResponse.ok) return receipt = { failed: true, stage: 'status' };
    const status = await statusResponse.json();
    if (!status.aiConfigured || status.providerId !== 'openai' || status.model !== 'gpt-4.1-mini') return receipt = { skipped: true, reason: 'baseline_model_not_active' };
    const curriculum = suppliedCurriculum || loadStudyCurriculum({ contentDir: resolve(ROOT, 'content', 'conditions') });
    if (!curriculum.get('atrial-fibrillation')?.current) return receipt = { failed: true, stage: 'current_references' };
    const login = await request('/api/login', { token: env.STUDY_ACCESS_TOKEN });
    if (!login.ok) return receipt = { failed: true, stage: 'sign_in' };
    cookie = (login.headers.get('set-cookie') || '').split(';')[0];
    if (!/^studychat_session=[A-Za-z0-9._-]+$/.test(cookie)) return receipt = { failed: true, stage: 'sign_in' };
    authenticated = true;
    const saved = await request('/api/operator/state');
    if (!saved.ok) return receipt = { failed: true, stage: 'saved_state' };
    const state = await saved.json();
    if (!object(state) || !Array.isArray(state.conversations) || state.conversations.length > 500 || state.conversations.some(item => !object(item) || !Array.isArray(item.messages) || item.messages.length > 1000)) return receipt = { failed: true, stage: 'saved_state' };
    const candidates = state.conversations.filter(item => item.title === NATURAL_CHECK_TITLE);
    const identities = state.conversations.flatMap(item => item.messages.filter(message => message.role === 'user' && KNOWN_TURNS.some(turn => turn.requestId === message.requestId)).map(message => ({ conversation: item, message })));
    if (candidates.length > 1 || identities.some(item => item.conversation !== candidates[0])) return receipt = { failed: true, uncertain: true, stage: 'saved_request_conflict' };
    let conversation = candidates[0];
    if (conversation && (conversation.internalCheck !== true || conversation.mode !== 'coach' || !validId(conversation.id) || conversation.messages.some(message => message.role === 'user' && !KNOWN_TURNS.some(turn => turn.requestId === message.requestId && turn.content === message.content)))) return receipt = { failed: true, uncertain: true, stage: 'saved_conversation_conflict' };
    if (!conversation) {
      const created = await request('/api/operator/conversations', { title: NATURAL_CHECK_TITLE, mode: 'coach' });
      if (!created.ok) return receipt = { failed: true, stage: 'create_conversation' };
      conversation = await created.json();
      if (!validId(conversation?.id) || conversation.internalCheck !== true || !Array.isArray(conversation.messages)) return receipt = { failed: true, stage: 'create_conversation' };
    }
    const turns = [];
    for (let index = 0; index < NATURAL_CHECK_TURNS.length; index++) {
      const turn = NATURAL_CHECK_TURNS[index];
      const users = conversation.messages.filter(message => message.role === 'user' && message.requestId === turn.requestId);
      let message, cached = false;
      if (users.length) {
        const replies = conversation.messages.filter(item => item.role === 'assistant' && item.responseTo === users[0].id);
        if (users.length !== 1 || users[0].content !== turn.content || (users[0].studyRequestedConditionIds || []).length || replies.length !== 1) return receipt = { failed: true, uncertain: true, stage: 'saved_request_without_valid_reply', turn: index + 1, submitted };
        message = replies[0]; cached = true;
      } else {
        if (conversation.messages.some(item => item.role === 'user' && NATURAL_CHECK_TURNS.slice(index + 1).some(next => next.requestId === item.requestId))) return receipt = { failed: true, uncertain: true, stage: 'saved_turn_order', submitted };
        submitted++;
        const response = await request('/api/chat', { conversationId: conversation.id, ...turn });
        if (!response.ok) return receipt = { failed: true, uncertain: true, stage: 'conversation_response', status: response.status, turn: index + 1, submitted };
        const payload = await response.json(); message = payload.message;
        if (!object(payload.conversation) || !Array.isArray(payload.conversation.messages)) return receipt = { failed: true, uncertain: true, stage: 'conversation_state', submitted };
        conversation = payload.conversation;
      }
      const userIndex = conversation.messages.findIndex(item => item.role === 'user' && item.requestId === turn.requestId);
      const context = { ...conversation, messages: conversation.messages.slice(0, userIndex + 1) };
      const passed = validateReply(message, index, curriculum, context);
      turns.push({ turn: index + 1, passed, cached, generation: usage(message?.ai), review: usage(message?.aiReview), externalClaimCount: count(message?.groundingReview?.externalClaimCount) ? message.groundingReview.externalClaimCount : null });
      if (!passed) return receipt = { failed: true, stage: 'natural_reply_validation', turn: index + 1, submitted, turns, rejectionReasonId: [101,201,202,203,301,302,303,304,305,306,307,400,499].includes(message?.studyRejection?.reasonId) ? message.studyRejection.reasonId : null, ...(message?.studyRejection?.reasonId === 302 ? { reviewDiagnostics: new NaturalTutorError(302, message.studyRejection.diagnostics).diagnostics || null } : {}) };
    }
    return receipt = { naturalConversationPassed: true, contextRecallPassed: true, citedStudyTransitionPassed: true, submitted, providerCalls: submitted * 2, turns };
  } catch {
    return receipt = { failed: true, stage: 'natural_conversation_check', ...(submitted ? { uncertain: true } : {}), submitted };
  } finally {
    if (authenticated) {
      try { await flushTelemetry(); receipt.telemetryFlushed = true; } catch { receipt.telemetryFlushed = false; }
      try { await request('/api/logout', {}); receipt.logoutAttempted = true; } catch { receipt.logoutAttempted = true; }
    }
  }
}
