import { studyDialogueHistory } from './study-conversation.js';
import { createHash } from 'node:crypto';
import { evidencePolicyInstructions } from '../shared/evidence-policy.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const ids = ['s1', 's2', 's3', 's4', 's5', 's6'];
const flags = ['unsupported_fact', 'missing_source', 'care_advice', 'false_action', 'competence_claim', 'pending_answer', 'clinical_quote', 'misattributed_user_state', 'invented_source', 'uncertain'];
const reasonIds = new Set([101, 201, 202, 203, 301, 302, 303, 304, 305, 306, 307, 499]);
const reviewSubcodes = new Set(['segment_shape', 'segment_unknown', 'segment_duplicate', 'segment_not_approved', 'flags_shape', 'flags_present', 'fact_count_invalid', 'claims_shape', 'fact_count_mismatch', 'claim_limit']);
const supportSubcodes = new Set(['support_shape', 'support_source_unknown', 'support_duplicate', 'support_not_declared', 'support_span_unknown', 'support_span_chunk_mismatch', 'support_excerpt_invalid', 'support_excerpt_not_exact']);
function safeReviewDiagnostics(input, reasonId) {
  const subcodes = reasonId === 302 ? reviewSubcodes : reasonId === 305 ? supportSubcodes : null;
  if (!object(input) || !subcodes?.has(input.subcode)) return undefined;
  const result = { version: 1, stage: 'review', subcode: input.subcode };
  for (const key of ['draftSegmentCount', 'reviewSegmentCount', 'segmentIndex', 'externalFactCount', 'claimCount', 'flagCount', 'declaredSourceCount', 'claimIndex', 'supportIndex', 'supportCount']) {
    if (Number.isInteger(input[key]) && input[key] >= 0) result[key] = Math.min(input[key], 100);
  }
  if (Array.isArray(input.flags)) result.flags = [...new Set(input.flags.filter(flag => flags.includes(flag)))].sort();
  return result;
}
export class NaturalTutorError extends Error {
  constructor(reasonId, diagnostics) {
    super('The tutoring response did not pass validation.');
    this.reasonId = reasonIds.has(reasonId) ? reasonId : 499;
    if ([302, 305].includes(this.reasonId)) this.diagnostics = safeReviewDiagnostics(diagnostics, this.reasonId);
  }
}
const reject = (reasonId, diagnostics) => { throw new NaturalTutorError(reasonId, diagnostics); };
const exactKeys = (value, expected) => object(value) && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
const text = (value, max) => typeof value === 'string' && value.trim() && value.length <= max && !value.includes('\0');

function currentEvidence(references, evidence) {
  const result = new Map();
  for (const item of evidence) {
    const [conditionId, sectionId, extra] = typeof item.key === 'string' ? item.key.split(':') : [];
    const condition = references.get(conditionId);
    const section = condition?.current && !extra && condition.chunks.find(chunk => chunk.id === sectionId);
    if (!section) reject(101);
    result.set(item.key, { key: item.key, conditionId, conditionTitle: condition.title, heading: section.heading, text: section.text, checkedAt: condition.checkedAt, expiresAt: condition.expiresAt });
  }
  return result;
}

/** Immutable public-source bindings; no learner or generated text enters IDs. */
export function buildNaturalSourceSpans({ references, evidence }) {
  return [...currentEvidence(references, evidence).values()].map(source => {
    if (!text(source.text, 1600)) reject(101);
    return { spanId: `span_${createHash('sha256').update(source.key).update('\0').update(source.text).digest('hex')}`, chunkId: source.key, excerpt: source.text };
  });
}
const idArraySchema = (keys, max = 4, min = 0) => ({ type: 'array', minItems: min, maxItems: keys.length ? max : 0, items: keys.length ? { type: 'string', enum: keys } : { type: 'string' } });
const namedSchema = (name, properties) => ({ name, schema: { type: 'object', additionalProperties: false, required: Object.keys(properties), properties } });

export function buildNaturalTutorSchema({ references, evidence }) {
  const keys = [...currentEvidence(references, evidence).keys()];
  return namedSchema('family_medicine_natural_tutor', { segments: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'object', additionalProperties: false, required: ['id', 'text', 'sourceChunkIds'], properties: {
    id: { type: 'string', enum: ids }, text: { type: 'string', minLength: 1, maxLength: 1800 }, sourceChunkIds: idArraySchema(keys),
  } } } });
}

export function validateNaturalDraft(parsed, { references, evidence }) {
  if (!exactKeys(parsed, ['segments']) || !Array.isArray(parsed.segments) || !parsed.segments.length || parsed.segments.length > 6) reject(201);
  const available = currentEvidence(references, evidence);
  const seen = new Set();
  let total = 0;
  for (const segment of parsed.segments) {
    if (!exactKeys(segment, ['id', 'text', 'sourceChunkIds']) || !ids.includes(segment.id) || seen.has(segment.id) || !text(segment.text, 1800) || !Array.isArray(segment.sourceChunkIds) || segment.sourceChunkIds.length > 4 || new Set(segment.sourceChunkIds).size !== segment.sourceChunkIds.length || segment.sourceChunkIds.some(key => !available.has(key))) reject(202);
    seen.add(segment.id); total += segment.text.length;
  }
  if (total > 7000) reject(203);
  return structuredClone(parsed);
}

function publicPending(references, pendingQuestion) {
  if (!pendingQuestion) return null;
  return references.boardQuestions().find(question => question.key === pendingQuestion.key && question.fingerprint === pendingQuestion.fingerprint) || null;
}
export function explicitAnswerReveal(content) {
  return !/\b(?:not|don't|don’t|never|without|avoid)\b[\s\S]{0,60}\b(?:reveal|show|give|tell|answer)\b/i.test(content) && /^(?:(?:please|can you|could you|i want you to|i would like you to)\s+)*(?:(?:reveal|show|give|tell)\b[\s\S]*\b(?:answer|rationale|explanation)\b|explain (?:the )?answer\b)/i.test(content.trim());
}

export function buildNaturalTutorPrompt({ references, evidence, conversation, settings, pendingQuestion = null }) {
  return `You are a conversational companion and tutor for an independent family medicine board-study app. Respond naturally to the learner and recent conversation. Usually keep the reply within 80 words unless the learner asks for detail; answer a request for detail fully within the output limits. Preserve every clinically necessary qualifier and exception rather than shortening a fact inaccurately. Avoid canned navigation, routine narration and forced questions. Ask at most one useful question; do not request information already provided.
${evidencePolicyInstructions('generator')}
Conversation pacing: presentation.status=interrupted or pending contains only completely presented audio segments, if any. Address the interruption and clarify or resume when requested.
Study strategy: During study practice, invite the learner to commit to an answer and their reasoning before explaining. Accept uncertainty, a pass or a request for explanation without pressure. Ask one useful question at a time. Distinguish self-reported recall difficulty from interpretation confusion and next-step confusion using what the learner actually says or answers; clarify briefly only when needed, without presenting an inferred weakness as demonstrated.
After a committed answer or a request for explanation, explain the cited decisive clue. Explain why an alternative differs only when the provided sources support both the clue and the comparison. Offer a fresh variation only when the supplied evidence supports all medical case premises and relationships; do not invent case premises or fill evidence gaps. Otherwise return to a supported point or acknowledge the limit.
Offer a short neutral teach-back, then later retrieval or mixed practice as optional next steps; do not force questions or exercises on ordinary chat. Do not invent reasoning scores, validated competence scores or clinical-competence claims from self-reports or conversation.
Return only one JSON object matching OUTPUT_SCHEMA exactly, with every required field and no extras. Each segment is a short paragraph with a unique ID s1..s6. Declare supporting sourceChunkIds on every factual paragraph, including questions. The server owns source links. Neutral recall prompts need no new source. If an original quiz is pending, do not reveal its answer or give new factual hints until an option is selected or an affirmative reveal is requested; nonfactual reflection and planning remain allowed.
OUTPUT_SCHEMA=${JSON.stringify(buildNaturalTutorSchema({ references, evidence }).schema)}
NATURAL_TUTOR_CONTEXT=${JSON.stringify({ mode: conversation.mode, preferences: { coachStyle: settings.coachStyle, dailyMinutes: settings.dailyMinutes, focus: settings.focus }, history: studyDialogueHistory(conversation), pendingQuestion: publicPending(references, pendingQuestion), revealRequested: explicitAnswerReveal(conversation.messages.findLast(message => message.role === 'user')?.content || ''), sources: [...currentEvidence(references, evidence).values()] })}`;
}

export function buildNaturalReviewSchema(draft, { references, evidence }) {
  const keys = [...currentEvidence(references, evidence).keys()];
  const spans = buildNaturalSourceSpans({ references, evidence });
  const support = { type: 'object', additionalProperties: false, required: ['chunkId', 'spanId'], properties: { chunkId: { type: 'string', ...(keys.length ? { enum: keys } : {}) }, spanId: { type: 'string', ...(spans.length ? { enum: spans.map(span => span.spanId) } : {}) } } };
  const claim = { type: 'object', additionalProperties: false, required: ['quote', 'type', 'sourceChunkIds', 'supports'], properties: {
    quote: { type: 'string', minLength: 1, maxLength: 1200 }, type: { type: 'string', enum: ['medical', 'education', 'other'] }, sourceChunkIds: idArraySchema(keys, 4, keys.length ? 1 : 0), supports: { type: 'array', minItems: 1, maxItems: 4, items: support },
  } };
  return namedSchema('family_medicine_natural_review_v2', { version: { type: 'integer', enum: [2] }, approved: { type: 'boolean' }, segments: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'object', additionalProperties: false, required: ['id', 'approved', 'externalFactCount', 'claims', 'flags'], properties: {
    id: { type: 'string', enum: draft.segments.map(segment => segment.id) }, approved: { type: 'boolean' }, externalFactCount: { type: 'integer', minimum: 0, maximum: 12 }, claims: { type: 'array', maxItems: keys.length ? 12 : 0, items: claim }, flags: { type: 'array', maxItems: flags.length, items: { type: 'string', enum: flags } },
  } } } });
}

export function buildNaturalReviewPrompt(draft, { references, evidence, conversation, settings, pendingQuestion = null }) {
  const latest = conversation.messages.findLast(message => message.role === 'user')?.content || '';
  return `You are a separate automated source-grounding and safety reviewer. Evaluate the ENTIRE candidate reply, including general conversation. Return only one JSON object matching OUTPUT_SCHEMA exactly, with all required fields and no extras; never rewrite the reply.
${evidencePolicyInstructions('reviewer')}
Review every original segment ID exactly once. Each external assertion needs a complete exact quote from its candidate paragraph, declared current sourceChunkIds, and one supporting immutable sourceSpan for each referenced chunk. Select chunkId and spanId from sourceSpans; do not copy or rewrite excerpts. Read the canonical excerpts and verify direct entailment; selecting an ID alone is insufficient. For a question containing a factual premise, quote the exact question and verify that premise. Neutral recall requests assert no new external fact. Set externalFactCount to the complete claims array length, including zero for nonfactual segments. Use flags for failures or uncertainty; approved may be true only when every segment passes without flags.
Presentation metadata records client-reported playback, not hearing or understanding. When a canonical quiz is pending without an affirmative reveal request, reject new factual hints or answer reveals; nonfactual planning and reflection remain allowed.
OUTPUT_SCHEMA=${JSON.stringify(buildNaturalReviewSchema(draft, { references, evidence }).schema)}
NATURAL_REVIEW_DATA=${JSON.stringify({ learnerRequest: latest, preferences: { coachStyle: settings.coachStyle, dailyMinutes: settings.dailyMinutes, focus: settings.focus }, history: studyDialogueHistory(conversation), candidate: draft.segments, sources: [...currentEvidence(references, evidence).values()].map(({ text: _excerpt, ...metadata }) => metadata), sourceSpans: buildNaturalSourceSpans({ references, evidence }), pendingQuestion: publicPending(references, pendingQuestion), revealRequested: explicitAnswerReveal(latest) })}`;
}

export function renderReviewedTutor(draft, review, { references, evidence, conversation, pendingQuestion = null, now = Date.now, requireVersion2 = false, sourceSpanBindings }) {
  draft = validateNaturalDraft(draft, { references, evidence });
  const available = currentEvidence(references, evidence);
  const version2 = object(review) && review.version === 2;
  if ((requireVersion2 && !version2) || !exactKeys(review, version2 ? ['version', 'approved', 'segments'] : ['approved', 'segments']) || review.approved !== true || !Array.isArray(review.segments) || review.segments.length !== draft.segments.length) reject(301);
  const sourceSpans = version2 || sourceSpanBindings !== undefined ? new Map(buildNaturalSourceSpans({ references, evidence }).map(span => [span.spanId, span])) : null;
  const expectedBindings = new Map();
  if (sourceSpanBindings !== undefined) {
    const bindingDetail = subcode => ({ subcode, draftSegmentCount: draft.segments.length, reviewSegmentCount: review.segments.length, declaredSourceCount: Array.isArray(sourceSpanBindings) ? sourceSpanBindings.length : undefined });
    if (!Array.isArray(sourceSpanBindings) || sourceSpanBindings.length > 4) reject(305, bindingDetail('support_shape'));
    for (const binding of sourceSpanBindings) {
      if (!exactKeys(binding, ['chunkId', 'spanId'])) reject(305, bindingDetail('support_shape'));
      if (expectedBindings.has(binding.chunkId)) reject(305, bindingDetail('support_duplicate'));
      if (!available.has(binding.chunkId)) reject(305, bindingDetail('support_source_unknown'));
      const currentSpan = sourceSpans.get(binding.spanId);
      if (!currentSpan) reject(305, bindingDetail('support_span_unknown'));
      if (currentSpan.chunkId !== binding.chunkId) reject(305, bindingDetail('support_span_chunk_mismatch'));
      expectedBindings.set(binding.chunkId, { chunkId: binding.chunkId, spanId: binding.spanId });
    }
  }
  const segmentMap = new Map(draft.segments.map(segment => [segment.id, segment]));
  const seen = new Set(), used = new Set(), accepted = [];
  let externalClaimCount = 0, medicalClaimCount = 0;
  for (const [segmentIndex, segment] of review.segments.entries()) {
    const original = segmentMap.get(segment?.id);
    const detail = subcode => ({ subcode, draftSegmentCount: draft.segments.length, reviewSegmentCount: review.segments.length, segmentIndex, externalFactCount: segment?.externalFactCount, claimCount: Array.isArray(segment?.claims) ? segment.claims.length : undefined, flagCount: Array.isArray(segment?.flags) ? segment.flags.length : undefined, declaredSourceCount: original?.sourceChunkIds.length, flags: segment?.flags });
    if (!exactKeys(segment, ['id', 'approved', 'externalFactCount', 'claims', 'flags'])) reject(302, detail('segment_shape'));
    if (!original) reject(302, detail('segment_unknown'));
    if (seen.has(segment.id)) reject(302, detail('segment_duplicate'));
    if (!Array.isArray(segment.flags)) reject(302, detail('flags_shape'));
    if (segment.flags.length) reject(302, detail('flags_present'));
    if (segment.approved !== true) reject(302, detail('segment_not_approved'));
    if (!Number.isInteger(segment.externalFactCount) || segment.externalFactCount < 0 || segment.externalFactCount > 12) reject(302, detail('fact_count_invalid'));
    if (!Array.isArray(segment.claims)) reject(302, detail('claims_shape'));
    if (segment.externalFactCount !== segment.claims.length) reject(302, detail('fact_count_mismatch'));
    if (segment.claims.length > 12) reject(302, detail('claim_limit'));
    seen.add(segment.id);
    if (original.sourceChunkIds.length && !segment.claims.length) reject(303);
    const acceptedSegment = structuredClone(segment);
    for (const [claimIndex, claim] of segment.claims.entries()) {
      if (!exactKeys(claim, ['quote', 'type', 'sourceChunkIds', 'supports']) || !text(claim.quote, 1200) || !original.text.includes(claim.quote) || !['medical', 'education', 'other'].includes(claim.type) || !Array.isArray(claim.sourceChunkIds) || !claim.sourceChunkIds.length || claim.sourceChunkIds.length > 4 || new Set(claim.sourceChunkIds).size !== claim.sourceChunkIds.length || claim.sourceChunkIds.some(key => !available.has(key) || !original.sourceChunkIds.includes(key)) || !Array.isArray(claim.supports) || claim.supports.length !== claim.sourceChunkIds.length) reject(304);
      const supported = new Set();
      const compiledSupports = [];
      for (const [supportIndex, support] of claim.supports.entries()) {
        const source = available.get(support?.chunkId);
        const supportDetail = subcode => ({ ...detail(subcode), claimIndex, supportIndex, supportCount: claim.supports.length });
        if (!exactKeys(support, version2 ? ['chunkId', 'spanId'] : ['chunkId', 'excerpt'])) reject(305, supportDetail('support_shape'));
        if (!source) reject(305, supportDetail('support_source_unknown'));
        if (supported.has(support.chunkId)) reject(305, supportDetail('support_duplicate'));
        if (!claim.sourceChunkIds.includes(support.chunkId)) reject(305, supportDetail('support_not_declared'));
        const span = version2 ? sourceSpans.get(support.spanId) : null;
        if (version2 && !span) reject(305, supportDetail('support_span_unknown'));
        if (version2 && span.chunkId !== support.chunkId) reject(305, supportDetail('support_span_chunk_mismatch'));
        const excerpt = version2 ? span.excerpt : support.excerpt;
        if (!text(excerpt, 1600)) reject(305, supportDetail('support_excerpt_invalid'));
        if (!source.text.includes(excerpt)) reject(305, supportDetail('support_excerpt_not_exact'));
        compiledSupports.push({ chunkId: support.chunkId, excerpt });
        supported.add(support.chunkId); used.add(support.chunkId);
      }
      acceptedSegment.claims[claimIndex].supports = compiledSupports;
      externalClaimCount++; if (claim.type === 'medical') medicalClaimCount++;
    }
    accepted.push(acceptedSegment);
  }
  const latest = conversation.messages.findLast(message => message.role === 'user')?.content || '';
  if (pendingQuestion && !explicitAnswerReveal(latest) && externalClaimCount) reject(306);
  const sourceChunkIds = [...used];
  if (sourceChunkIds.length > 4) reject(307);
  if (sourceSpanBindings !== undefined && (expectedBindings.size !== sourceChunkIds.length || sourceChunkIds.some(key => !expectedBindings.has(key)))) reject(305, { subcode: 'support_not_declared', declaredSourceCount: expectedBindings.size });
  const persistedBindings = version2 ? sourceChunkIds.map(chunkId => {
    const span = [...sourceSpans.values()].find(item => item.chunkId === chunkId);
    return { chunkId, spanId: span.spanId };
  }) : sourceSpanBindings !== undefined ? sourceChunkIds.map(key => expectedBindings.get(key)) : undefined;
  const citationByChunk = new Map(sourceChunkIds.map(key => [key, references.render({ chunkIds: [key], questionId: null, unsupported: false }, evidence).citations]));
  const citations = [...new Map([...citationByChunk.values()].flat().map(source => [`${source.id}|${source.url}`, source])).values()];
  if (citations.length > 10) reject(307);
  const citationNumbers = new Map(citations.map((source, index) => [`${source.id}|${source.url}`, index + 1]));
  const reviewById = new Map(accepted.map(segment => [segment.id, segment]));
  const content = draft.segments.map(segment => {
    const referencesForSegment = [...new Set(reviewById.get(segment.id).claims.flatMap(claim => claim.sourceChunkIds.flatMap(key => citationByChunk.get(key).map(source => citationNumbers.get(`${source.id}|${source.url}`)))))];
    return `${segment.text}${referencesForSegment.length ? ` [${referencesForSegment.join(', ')}]` : ''}`;
  }).join('\n\n');
  return { content, spokenText: draft.segments.map(segment => segment.text).join('\n\n'), canonicalSpokenText: false, sourceVerified: false, reviewedDialogue: true, humanReview: false,
    citations, ...(sourceChunkIds.length ? { current: true, grounded: true, conditionIds: [...new Set(sourceChunkIds.map(key => available.get(key).conditionId))] } : {}), naturalSegments: draft.segments,
    groundingReview: { version: 1, status: 'passed', externalClaimCount, medicalClaimCount, sourceChunkIds, ...(persistedBindings ? { sourceSpanBindings: persistedBindings } : {}), reviewedAt: typeof now === 'function' ? now() : now, segments: accepted }, pendingStudyQuestion: pendingQuestion ? { ...pendingQuestion } : null };
}

export function aggregateTutorUsage(primary, review, calls) {
  const records = [primary, review].filter(Boolean);
  const complete = records.length === calls;
  return { calls, usage: complete && records.every(record => record.usage) ? { prompt_tokens: records.reduce((total, record) => total + record.usage.prompt_tokens, 0), completion_tokens: records.reduce((total, record) => total + record.usage.completion_tokens, 0) } : null,
    estimatedCostUsd: complete && records.every(record => Number.isFinite(record.estimatedCostUsd)) ? records.reduce((total, record) => total + record.estimatedCostUsd, 0) : null,
    latencyMs: records.reduce((total, record) => total + (record.latencyMs || 0), 0) };
}

export function naturalTutorFailure(error) {
  const diagnostics = error instanceof NaturalTutorError && [302, 305].includes(error.reasonId) ? safeReviewDiagnostics(error.diagnostics, error.reasonId) : undefined;
  return { content: 'I could not complete the source check for that reply, so I have not used it. We can keep chatting, or work from a cited study section. What would you like to try next?', citations: [], unsupported: true, studyRejection: { code: 'natural_tutor_validation', reasonId: error instanceof NaturalTutorError && reasonIds.has(error.reasonId) ? error.reasonId : error instanceof SyntaxError ? 400 : 499, ...(diagnostics ? { diagnostics } : {}) } };
}
