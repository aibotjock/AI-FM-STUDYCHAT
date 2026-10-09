import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadStudyCurriculum } from './study-curriculum.js';
import { renderStudyDialogue, projectStudyDialoguePlan, STUDY_DIALOGUE_ENUMS } from './study-conversation.js';

export const CONVERSATION_CHECK_TITLE = 'Operator conversation check · synthetic study';
export const LEGACY_CONVERSATION_FOLLOWUP = Object.freeze({ requestId: 'study-dialogue-v1-followup-gpt-4.1-mini', content: 'I would like to study atrial fibrillation. Start our plan with a brief cited study point, then ask one recall question.' });
export const SCHEMA_CONVERSATION_FOLLOWUP = Object.freeze({ requestId: 'study-dialogue-v2-followup-gpt-4.1-mini', content: 'For board study, explain one cited point about atrial fibrillation from the current library, then ask one recall question about that point.' });
export const CONVERSATION_CHECK_TURNS = Object.freeze([
  { requestId: 'study-dialogue-v1-plan-gpt-4.1-mini', content: 'Help me plan a 15-minute study session. Ask me just one question at a time.' },
  { requestId: 'study-dialogue-v3-followup-gpt-4.1-mini', content: SCHEMA_CONVERSATION_FOLLOWUP.content }
]);
const KNOWN_TURNS = [...CONVERSATION_CHECK_TURNS, LEGACY_CONVERSATION_FOLLOWUP, SCHEMA_CONVERSATION_FOLLOWUP];
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = value => typeof value === 'string' && /^[A-Za-z0-9._-]{1,100}$/.test(value);
const validModel = value => ['gpt-4.1-mini', 'gpt-4.1-mini-2025-04-14'].includes(value);
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 10000000;

function safeUsage(message) {
  const ai = message?.ai;
  return { provider: ai?.provider === 'openai' ? 'openai' : null, returnedModel: validModel(ai?.returnedModel) ? ai.returnedModel : null,
    inputTokens: count(ai?.usage?.prompt_tokens) ? ai.usage.prompt_tokens : null, outputTokens: count(ai?.usage?.completion_tokens) ? ai.usage.completion_tokens : null,
    estimatedCostUsd: Number.isFinite(ai?.estimatedCostUsd) && ai.estimatedCostUsd >= 0 ? ai.estimatedCostUsd : null };
}
function validDialogue(message) {
  return object(message) && message.role === 'assistant' && message.studyDialogue?.version === 1 && message.canonicalSpokenText === true &&
    message.sourceVerified === true && typeof message.spokenText === 'string' && message.spokenText.trim() && !message.importedEvidence && !message.unsupported && !message.offline &&
    message.ai?.provider === 'openai' && message.ai.requestedModel === 'gpt-4.1-mini' && validModel(message.ai.returnedModel) && !message.ai.imported && !message.ai.clientReported;
}
function validateTurn(message, index, curriculum, conversation, settings) {
  if (!validDialogue(message)) return false;
  const evidence = index === 0 ? [] : curriculum.retrieve(CONVERSATION_CHECK_TURNS[1].content, { conditionIds: ['atrial-fibrillation'] });
  let rendered;
  try {
    const marker = message.studyDialogue;
    rendered = renderStudyDialogue({ chunkIds: message.studySelection?.chunkIds || [], questionId: message.studyQuestion?.key || null, unsupported: false,
      dialogue: { intent: marker.intent, acknowledgment: marker.acknowledgment, followup: marker.followup, focusChunkId: marker.focusChunkId, learnerQuote: null, minutes: marker.minutes } },
    { references: curriculum, evidence, conversation, settings, medicalRequested: index === 1 });
  } catch { return false; }
  if (message.spokenText !== rendered.spokenText) return false;
  if (index === 0) return message.studyDialogue.intent === 'planning' && message.studyDialogue.minutes === 15 && !message.curriculum && message.canonicalStudyProcess === true && (!message.citations || message.citations.length === 0);
  if (message.curriculum !== true || message.grounded !== true || message.current !== true || message.humanReview !== false || !Array.isArray(message.studySelection?.chunkIds) || !message.studySelection.chunkIds.length) return false;
  let canonical;
  try { canonical = curriculum.render({ chunkIds: message.studySelection.chunkIds, questionId: null, unsupported: false }, evidence); } catch { return false; }
  return canonical.curriculum === true && canonical.conditionIds.length === 1 && canonical.conditionIds[0] === 'atrial-fibrillation' &&
    message.content.includes(canonical.content) && message.spokenText.includes(canonical.content) && JSON.stringify(message.citations) === JSON.stringify(rendered.citations) &&
    (message.studyDialogue.followup !== 'none' || object(message.studyQuestion));
}
function savedReplyDiagnostics(message, curriculum) {
  const marker = message?.studyDialogue;
  const evidence = curriculum.retrieve(CONVERSATION_CHECK_TURNS[1].content, { conditionIds: ['atrial-fibrillation'] });
  const eligibleKeys = new Set(evidence.map(item => item.key));
  const rejected = message?.studyRejection?.plan;
  const reasonId = message?.studyRejection?.reasonId;
  const safePlan = rejected?.parseableObject === false ? { parseableObject: false } : object(rejected) ? projectStudyDialoguePlan({ ...rejected, dialogue: { ...rejected.dialogue, learnerQuote: rejected.dialogue?.learnerQuotePosition } }, { references: curriculum, evidence }) : null;
  if (safePlan?.parseableObject) {
    for (const field of ['chunkCount', 'unknownChunkCount']) if (Number.isInteger(rejected[field]) && rejected[field] >= 0 && rejected[field] <= 1000) safePlan[field] = rejected[field];
    safePlan.unknownQuestion = rejected.unknownQuestion === true;
  }
  return { validDialogue: Boolean(validDialogue(message)), curriculum: message?.curriculum === true, current: message?.current === true,
    unsupported: message?.unsupported === true, selectionPresent: Array.isArray(message?.studySelection?.chunkIds),
    selectedChunks: (message?.studySelection?.chunkIds || []).filter(key => eligibleKeys.has(key)).slice(0, 4),
    quizPresent: object(message?.studyQuestion), citationsPresent: Array.isArray(message?.citations) && message.citations.length > 0,
    intent: STUDY_DIALOGUE_ENUMS.intent.includes(marker?.intent) ? marker.intent : null,
    followup: STUDY_DIALOGUE_ENUMS.followup.includes(marker?.followup) ? marker.followup : null,
    learnerQuotePresent: marker?.learnerQuotePresent === true,
    rejectionCode: ['invalid_json', 'invalid_dialogue_plan'].includes(message?.studyRejection?.code) ? message.studyRejection.code : null,
    rejectionReasonId: [100,201,202,203,204,205,206,207,208,301,302,303,304,305,306,307,399].includes(reasonId) ? reasonId : null,
    rejectedPlan: safePlan };
}

/** A new feature check only: two fixed turns, durable identities, no paid retry. */
export async function runConversationCheck({ baseUrl, env = process.env, fetchImpl = globalThis.fetch, flushTelemetry = async () => {}, curriculum: suppliedCurriculum } = {}) {
  if (env.STUDY_INITIAL_CONVERSATION_CHECK !== 'dialogue-v3') return { skipped: true };
  if ((env.APP_MODE || 'personal') !== 'personal' || (env.AI_PROVIDER || 'openai').trim().toLowerCase() !== 'openai') return { skipped: true, reason: 'personal_openai_only' };
  const base = new URL(baseUrl);
  if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || base.pathname !== '/' || base.search || base.hash || base.username || base.password) throw new Error('Conversation checks require the local app listener.');
  if (!(env.STUDY_ACCESS_TOKEN || '').trim() || !(env.OPENAI_API_KEY || '').trim()) return { skipped: true, reason: 'server_credentials_not_configured' };
  let cookie = '', authenticated = false, submitted = 0;
  let receipt = { failed: true, stage: 'conversation_check' };
  const request = (path, body) => fetchImpl(new URL(path, base), { method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(55000), headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
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
    const response = await request('/api/operator/state');
    if (!response.ok) return receipt = { failed: true, stage: 'saved_state' };
    const state = await response.json();
    if (!object(state) || !Array.isArray(state.conversations) || state.conversations.length > 500 || state.conversations.some(item => !object(item) || !Array.isArray(item.messages) || item.messages.length > 1000)) return receipt = { failed: true, stage: 'saved_state' };
    const candidates = state.conversations.filter(item => item.title === CONVERSATION_CHECK_TITLE);
    const identities = state.conversations.flatMap(item => item.messages.filter(message => message.role === 'user' && KNOWN_TURNS.some(turn => turn.requestId === message.requestId)).map(message => ({ conversation: item, message })));
    if (candidates.length > 1 || identities.some(item => item.conversation !== candidates[0])) return receipt = { failed: true, uncertain: true, stage: 'saved_request_conflict' };
    let conversation = candidates[0];
    if (conversation && (conversation.mode !== 'coach' || !validId(conversation.id) || conversation.messages.some(message => message.role === 'user' && !KNOWN_TURNS.some(turn => turn.requestId === message.requestId && turn.content === message.content)))) return receipt = { failed: true, uncertain: true, stage: 'saved_conversation_conflict' };
    if (!conversation) {
      const created = await request('/api/operator/conversations', { title: CONVERSATION_CHECK_TITLE, mode: 'coach' });
      if (!created.ok) return receipt = { failed: true, stage: 'create_conversation' };
      conversation = await created.json();
      if (!validId(conversation?.id) || !Array.isArray(conversation.messages)) return receipt = { failed: true, stage: 'create_conversation' };
    }
    const turns = [];
    for (let index = 0; index < CONVERSATION_CHECK_TURNS.length; index++) {
      const turn = CONVERSATION_CHECK_TURNS[index];
      const users = conversation.messages.filter(message => message.role === 'user' && message.requestId === turn.requestId);
      let message, cached = false;
      if (users.length) {
        const replies = conversation.messages.filter(item => item.role === 'assistant' && item.responseTo === users[0].id);
        if (users.length !== 1 || users[0].content !== turn.content || (users[0].studyRequestedConditionIds || []).length || replies.length !== 1) return receipt = { failed: true, uncertain: true, stage: 'saved_request_without_valid_reply', turn: index + 1, submitted };
        message = replies[0]; cached = true;
      } else {
        if (conversation.messages.some(item => item.role === 'user' && CONVERSATION_CHECK_TURNS.slice(index + 1).some(next => next.requestId === item.requestId))) return receipt = { failed: true, uncertain: true, stage: 'saved_turn_order', submitted };
        submitted++;
        const reply = await request('/api/chat', { conversationId: conversation.id, ...turn });
        if (!reply.ok) return receipt = { failed: true, uncertain: true, stage: 'conversation_response', status: reply.status, turn: index + 1, submitted };
        const payload = await reply.json(); message = payload.message;
        if (object(payload.conversation) && Array.isArray(payload.conversation.messages)) conversation = payload.conversation;
      }
      const context = { ...conversation, messages: conversation.messages.filter(item => item.role !== 'assistant' || item.id !== message?.id) };
      const passed = validateTurn(message, index, curriculum, context, state.settings || { dailyMinutes: 18, coachStyle: 'socratic', focus: 'exam' });
      turns.push({ turn: index + 1, passed, cached, ...safeUsage(message) });
      if (!passed) return receipt = { failed: true, stage: 'dialogue_validation', turn: index + 1, submitted, turns, checks: savedReplyDiagnostics(message, curriculum) };
    }
    return receipt = { conversationPassed: true, planPassed: true, citedFollowupPassed: true, submitted, turns };
  } catch {
    return receipt = { failed: true, stage: 'conversation_check', ...(submitted ? { uncertain: true } : {}), submitted };
  } finally {
    if (authenticated) {
      try { await flushTelemetry(); receipt.telemetryFlushed = true; } catch { receipt.telemetryFlushed = false; }
      try { await request('/api/logout', {}); receipt.logoutAttempted = true; } catch { receipt.logoutAttempted = true; }
    }
  }
}
