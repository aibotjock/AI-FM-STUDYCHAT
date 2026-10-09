import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadStudyCurriculum } from './study-curriculum.js';

export const STUDY_SOURCE_CHECK_REQUEST_ID = 'study-source-selector-source-v1-gpt-4.1-mini';
export const STUDY_SOURCE_CHECK_CONDITION = 'atrial-fibrillation';
export const STUDY_SOURCE_CHECK_TITLE = 'Operator source check · synthetic board study';
export const STUDY_SOURCE_CHECK_QUERY = 'For board study only, what does the current atrial fibrillation study library say about stroke-risk assessment and anticoagulation?';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = value => typeof value === 'string' && /^[A-Za-z0-9._-]{1,100}$/.test(value);
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 10000000;
const model = value => ['gpt-4.1-mini', 'gpt-4.1-mini-2025-04-14'].includes(value) ? value : null;

function validateReply(message, curriculum, evidence) {
  const marker = message?.studySelection;
  if (!object(message) || message.role !== 'assistant' || message.curriculum !== true || message.grounded !== true || message.sourceVerified !== true || message.humanReview !== false || message.current !== true || message.importedEvidence || message.offline || message.unsupported || !object(marker) || Object.keys(marker).some(key => key !== 'chunkIds') || !Array.isArray(marker.chunkIds) || !marker.chunkIds.length || marker.chunkIds.length > 4 || new Set(marker.chunkIds).size !== marker.chunkIds.length || marker.chunkIds.some(key => typeof key !== 'string' || !evidence.some(chunk => chunk.key === key))) return false;
  let expected;
  try { expected = curriculum.render({ chunkIds: marker.chunkIds, questionId: null, unsupported: false }, evidence); } catch { return false; }
  return expected.current === true && message.content === expected.content && JSON.stringify(message.citations) === JSON.stringify(expected.citations) && JSON.stringify(message.conditionIds) === JSON.stringify(expected.conditionIds) && message.ai?.provider === 'openai' && message.ai.requestedModel === 'gpt-4.1-mini' && model(message.ai.returnedModel) !== null && !message.ai.imported && !message.ai.clientReported;
}
function safeMetadata(message) {
  const ai = message?.ai;
  return { provider: ai?.provider === 'openai' ? 'openai' : null, requestedModel: model(ai?.requestedModel), returnedModel: model(ai?.returnedModel), inputTokens: count(ai?.usage?.prompt_tokens) ? ai.usage.prompt_tokens : null, outputTokens: count(ai?.usage?.completion_tokens) ? ai.usage.completion_tokens : null, estimatedCostUsd: typeof ai?.estimatedCostUsd === 'number' && Number.isFinite(ai.estimatedCostUsd) && ai.estimatedCostUsd >= 0 && ai.estimatedCostUsd <= 1000 ? ai.estimatedCostUsd : null };
}

/** Explicit operator check, disabled by default. Never retries paid inference. */
export async function runStudySourceCheck({ baseUrl, env = process.env, fetchImpl = globalThis.fetch, flushTelemetry = async () => {}, curriculum: suppliedCurriculum } = {}) {
  if (env.STUDY_INITIAL_SOURCE_CHECK !== 'source-v1') return { skipped: true };
  if ((env.APP_MODE || 'personal') !== 'personal' || (env.AI_PROVIDER || 'openai').trim().toLowerCase() !== 'openai') return { skipped: true, reason: 'personal_openai_only' };
  const base = new URL(baseUrl);
  if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || base.pathname !== '/' || base.search || base.hash || base.username || base.password) throw new Error('Source checks require the local app listener.');
  if (!(env.STUDY_ACCESS_TOKEN || '').trim() || !((env.OPENAI_API_KEY || '').trim())) return { skipped: true, reason: 'server_credentials_not_configured' };
  let cookie = '';
  let authenticated = false;
  let paidRequestSubmitted = false;
  let receipt = { failed: true, stage: 'source_check' };
  const request = async (path, body) => fetchImpl(new URL(path, base), {
    method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(55000),
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  try {
    const statusResponse = await request('/api/status');
    if (!statusResponse.ok) return receipt = { failed: true, stage: 'status' };
    const status = await statusResponse.json();
    if (!status.aiConfigured || status.providerId !== 'openai' || status.model !== 'gpt-4.1-mini') return receipt = { skipped: true, reason: 'baseline_model_not_active' };
    const curriculum = suppliedCurriculum || loadStudyCurriculum({ contentDir: resolve(ROOT, 'content', 'conditions') });
    const condition = curriculum.get(STUDY_SOURCE_CHECK_CONDITION);
    const evidence = curriculum.retrieve(STUDY_SOURCE_CHECK_QUERY, { conditionIds: [STUDY_SOURCE_CHECK_CONDITION] });
    if (!condition?.current || !evidence.length || evidence.some(chunk => chunk.conditionId !== STUDY_SOURCE_CHECK_CONDITION)) return receipt = { failed: true, stage: 'current_references' };
    const login = await request('/api/login', { token: env.STUDY_ACCESS_TOKEN });
    if (!login.ok) return receipt = { failed: true, stage: 'sign_in' };
    cookie = (login.headers.get('set-cookie') || '').split(';')[0];
    if (!/^studychat_session=[A-Za-z0-9._-]+$/.test(cookie)) return receipt = { failed: true, stage: 'sign_in' };
    authenticated = true;
    const stateResponse = await request('/api/state');
    if (!stateResponse.ok) return receipt = { failed: true, authenticated: true, stage: 'saved_state' };
    const state = await stateResponse.json();
    if (!object(state) || !Array.isArray(state.conversations) || state.conversations.length > 500 || state.conversations.some(conversation => !object(conversation) || !Array.isArray(conversation.messages) || conversation.messages.length > 1000)) return receipt = { failed: true, authenticated: true, stage: 'saved_state' };
    const priorRequests = state.conversations.flatMap(conversation => conversation.messages.filter(message => message?.role === 'user' && message.requestId === STUDY_SOURCE_CHECK_REQUEST_ID).map(user => ({ conversation, user })));
    let conversation;
    let message;
    let cached = false;
    if (priorRequests.length) {
      if (priorRequests.length !== 1 || priorRequests[0].user.content !== STUDY_SOURCE_CHECK_QUERY || JSON.stringify(priorRequests[0].user.studyRequestedConditionIds) !== JSON.stringify([STUDY_SOURCE_CHECK_CONDITION]) || priorRequests[0].conversation.curriculumConditionId !== STUDY_SOURCE_CHECK_CONDITION) return receipt = { failed: true, authenticated: true, uncertain: true, cached: true, stage: 'saved_request_conflict' };
      ({ conversation } = priorRequests[0]);
      const replies = conversation.messages.filter(item => item?.role === 'assistant' && item.responseTo === priorRequests[0].user.id);
      if (replies.length !== 1) return receipt = { failed: true, authenticated: true, uncertain: true, cached: true, stage: 'saved_request_without_reply' };
      message = replies[0];
      cached = true;
    } else {
      const candidates = state.conversations.filter(item => item.title === STUDY_SOURCE_CHECK_TITLE);
      if (candidates.length > 1 || candidates.length === 1 && (candidates[0].messages.length !== 0 || candidates[0].mode !== 'coach' || candidates[0].curriculumConditionId !== STUDY_SOURCE_CHECK_CONDITION)) return receipt = { failed: true, authenticated: true, uncertain: true, stage: 'saved_conversation_conflict' };
      conversation = candidates[0];
      if (!conversation) {
        const created = await request('/api/conversations', { title: STUDY_SOURCE_CHECK_TITLE, mode: 'coach', conditionId: STUDY_SOURCE_CHECK_CONDITION });
        if (!created.ok) return receipt = { failed: true, authenticated: true, stage: 'source_conversation' };
        conversation = await created.json();
      }
      if (!validId(conversation?.id)) return receipt = { failed: true, authenticated: true, stage: 'source_conversation' };
      paidRequestSubmitted = true;
      const response = await request('/api/chat', { conversationId: conversation.id, content: STUDY_SOURCE_CHECK_QUERY, conditionIds: [STUDY_SOURCE_CHECK_CONDITION], requestId: STUDY_SOURCE_CHECK_REQUEST_ID });
      if (!response.ok) return receipt = { failed: true, authenticated: true, uncertain: true, cached: false, stage: 'source_response', status: response.status };
      message = (await response.json())?.message;
    }
    const canonicalPassed = validateReply(message, curriculum, evidence);
    const relevantSourcePassed = canonicalPassed && ['atrial-fibrillation:risk', 'atrial-fibrillation:drug'].every(key => message.studySelection.chunkIds.includes(key));
    const passed = canonicalPassed && relevantSourcePassed;
    return receipt = { authenticated: true, sourcePassed: passed, canonicalPassed, citationPassed: canonicalPassed, currentSourcePassed: canonicalPassed, selectorMarkerPassed: canonicalPassed, relevantSourcePassed, cached, uncertain: false, ...(passed ? {} : { failed: true, stage: canonicalPassed ? 'source_relevance' : 'canonical_validation' }), ...safeMetadata(message) };
  } catch {
    return receipt = { failed: true, ...(authenticated ? { authenticated: true } : {}), ...(paidRequestSubmitted ? { uncertain: true, cached: false } : {}), stage: 'source_check' };
  } finally {
    if (authenticated) {
      try {
        await flushTelemetry();
        receipt.telemetryFlushed = true;
        if (env.INGENIUM_TELEMETRY_KEY && env.INGENIUM_TELEMETRY_ORGANIZATION_ID) {
          const delivered = await request('/api/ingenium-status');
          if (delivered.ok) {
            const telemetry = await delivered.json();
            receipt.delivered = count(telemetry?.delivered) ? telemetry.delivered : null;
            receipt.pending = count(telemetry?.pending) ? telemetry.pending : null;
          }
        }
      } catch { receipt.telemetryFlushed = false; }
      try { await request('/api/logout', {}); receipt.logoutAttempted = true; } catch { receipt.logoutAttempted = true; }
    }
  }
}
