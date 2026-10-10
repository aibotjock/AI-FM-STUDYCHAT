import { studyDialogueHistory } from './study-conversation.js';
import { createHash } from 'node:crypto';
import { evidencePolicyInstructions } from '../shared/evidence-policy.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const ids = ['s1', 's2', 's3', 's4', 's5', 's6'];
const flags = ['unsupported_fact', 'missing_source', 'care_advice', 'false_action', 'competence_claim', 'pending_answer', 'clinical_quote', 'misattributed_user_state', 'invented_source', 'uncertain'];
const reasonIds = new Set([101, 201, 202, 203, 301, 302, 303, 304, 305, 306, 307, 308, 499]);
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
    result.set(item.key, { key: item.key, conditionId, conditionTitle: condition.title, heading: section.heading, text: section.text, checkedAt: condition.checkedAt, expiresAt: condition.expiresAt,
      sourceContext: condition.sources.filter(source => section.sourceIds.includes(source.id)).map(source => ({ title: source.title, organization: source.organization, kind: source.kind, edition: source.edition, jurisdiction: source.jurisdiction, limitations: source.limitations })) });
  }
  return result;
}

// This is a conservative second guard, not the semantic question reviewer.
// In particular, a question can assert no fact while still requiring an answer
// that is absent from the library. Such assessments must use canonical keys.
function obviousMedicalAssessment(value) {
  const preference = /\b(?:would you like|do you want|would you prefer|want to study|prefer to study)\b/i;
  return value.split(/(?<=[.!?])\s+|\n+/).some(part => !preference.test(part) && (part.includes('?') || /^(?:please\s+)?(?:at what|what|which|when|how|name|list|identify|choose|select|tell me|give me|recall|calculate)\b/i.test(part.trim())) && (
    /\b(?:what|which|when|name|list|identify|choose|select|tell me|give me|recall|calculate)\b[^?\n]{0,400}\b(?:first[- ]line|next[- ](?:best )?step|best next|treatment|therapy|antibiotics?|dos(?:e|age|ing)|diagnos\w*|contraindicat\w*|risk(?: factors?)?|thresholds?|screening|complications?|prophylaxis|management|recommended|guideline|medications?|vaccin\w*)\b/i.test(part) ||
    /\bhow\b[^?\n]{0,180}\b(?:treat|manage|diagnose|dose|prescribe)\b/i.test(part)
  ));
}

function recallPointAvailable(span, { conversation, draft, review, original, question }) {
  const prior = conversation.messages.some(message => {
    if (message.role !== 'assistant' || message.importedEvidence || message.voiceTranscript || message.unsupported) return false;
    if (message.curriculum === true && message.sourceVerified === true && message.studySelection?.chunkIds?.includes(span.chunkId)) return typeof message.content === 'string' && message.content.includes(span.excerpt);
    return message.reviewedDialogue === true && message.sourceVerified === false && message.groundingReview?.status === 'passed' &&
      message.groundingReview.sourceSpanBindings?.some(binding => binding.chunkId === span.chunkId && binding.spanId === span.spanId) &&
      message.groundingReview.segments?.some(segment => segment.claims?.some(claim => claim.supports?.some(support => support.chunkId === span.chunkId && support.excerpt === span.excerpt)));
  });
  if (prior) return true;
  // A reviewed cited point followed by teach-back in the same reply is allowed.
  const recallIndex = draft.segments.findIndex(segment => segment.id === original.id);
  return review.segments.some(segment => {
    const pointIndex = draft.segments.findIndex(candidate => candidate.id === segment.id);
    const point = draft.segments[pointIndex];
    return point && pointIndex <= recallIndex && point.sourceChunkIds.includes(span.chunkId) && segment.claims?.some(claim =>
      (pointIndex < recallIndex || point.text.indexOf(claim.quote) < point.text.indexOf(question.quote)) &&
      claim.supports?.some(support => support.chunkId === span.chunkId && (support.spanId === span.spanId || support.excerpt === span.excerpt)));
  });
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
  // Historical refusals cannot override the current server evidence. Let the
  // caller render canonical cited passages rather than pay for reviewing a
  // blanket source-absence claim. Specific unsupported details remain gaps.
  if (available.size && parsed.segments.every(segment => !segment.sourceChunkIds.length) && parsed.segments.some(segment => /\b(?:no|do not have any|don't have any)\s+(?:(?:approved|verified|valid|usable|available|supporting)\s+)?(?:sources?|references?)\b|\bcannot teach factual clinical content\b/i.test(segment.text))) reject(308);
  return structuredClone(parsed);
}

function publicPending(references, pendingQuestion) {
  if (!pendingQuestion) return null;
  return references.boardQuestions().find(question => question.key === pendingQuestion.key && question.fingerprint === pendingQuestion.fingerprint) || null;
}
export function explicitAnswerReveal(content) {
  return !/\b(?:not|don't|don’t|never|without|avoid)\b[\s\S]{0,60}\b(?:reveal|show|give|tell|answer)\b/i.test(content) && /^(?:(?:please|can you|could you|i want you to|i would like you to)\s+)*(?:(?:reveal|show|give|tell)\b[\s\S]*\b(?:answer|rationale|explanation)\b|explain (?:the )?answer\b)/i.test(content.trim());
}

export function buildNaturalTutorPrompt({ references, evidence, conversation, settings, pendingQuestion = null, voiceTurn = false }) {
  return `You are a conversational companion and tutor for an independent family medicine board-study app. Respond naturally to the learner and recent conversation. ${voiceTurn ? 'This is a spoken conversation. Aim for 40–60 words and one or two short paragraphs per routine turn, keeping the first sentence directly useful.' : 'Usually keep the reply within 80 words'} unless the learner asks for detail; answer a request for detail fully within the output limits. Preserve every clinically necessary qualifier and exception rather than shortening a fact inaccurately. Avoid canned navigation, routine narration and forced questions. Ask at most one useful question; do not request information already provided.
${evidencePolicyInstructions('generator')}
Evidence availability: The current sources below supersede historical statements about missing references. When they support part of the request, teach that supported part with sourceChunkIds and identify only the specific remaining gap. Never claim there are no sources for a topic when sources are supplied. A source title alone does not establish a treatment, dose or cutoff.
Conversation pacing: presentation.status=interrupted or pending contains only completely presented audio segments, if any. Address the interruption and clarify or resume when requested.
Study strategy: During study practice, invite the learner to commit to an answer and their reasoning before explaining. Accept uncertainty, a pass or a request for explanation without pressure. Ask one useful question at a time. Distinguish self-reported recall difficulty from interpretation confusion and next-step confusion using what the learner actually says or answers; clarify briefly only when needed, without presenting an inferred weakness as demonstrated.
After a committed answer or a request for explanation, explain the cited decisive clue. Explain why an alternative differs only when the provided sources support both the clue and the comparison. Offer a fresh variation only through a server-owned original question, not a case composed in prose. Any medical case requires evidence that supports all medical case premises and relationships; do not invent case premises or fill evidence gaps. Otherwise return to a supported point or acknowledge the limit.
Offer a short neutral teach-back, then later retrieval or mixed practice as optional next steps; do not force questions or exercises on ordinary chat. Do not invent reasoning scores, validated competence scores or clinical-competence claims from self-reports or conversation.
Question answerability: Do not compose medical assessment questions, new hypothetical cases, medication-choice questions or requests to name a diagnosis, treatment, dose or next step. The server owns original study questions and their current cited answer keys. Ask the learner whether they want an original question when appropriate; do not invent one. A source-backed neutral teach-back may ask the learner to summarize a cited point already delivered in this conversation or explained with source support in this reply. Declare that point's sourceChunkIds on the teach-back paragraph. A topic title, user claim or retrieved source never establishes that a point was delivered. Keep ordinary conversation, preferences and clarifying study-process questions natural.
Return only one JSON object matching OUTPUT_SCHEMA exactly, with every required field and no extras. Each segment is a short paragraph with a unique ID s1..s6. Declare supporting sourceChunkIds on every factual paragraph, including questions. The server owns source links. If an original quiz is pending, do not reveal its answer or give new factual hints until an option is selected or an affirmative reveal is requested; nonfactual reflection and planning remain allowed.
OUTPUT_SCHEMA=${JSON.stringify(buildNaturalTutorSchema({ references, evidence }).schema)}
NATURAL_TUTOR_CONTEXT=${JSON.stringify({ mode: conversation.mode, preferences: { coachStyle: settings.coachStyle, dailyMinutes: settings.dailyMinutes, focus: settings.focus }, history: studyDialogueHistory(conversation), pendingQuestion: publicPending(references, pendingQuestion), revealRequested: explicitAnswerReveal(conversation.messages.findLast(message => message.role === 'user')?.content || ''), sources: [...currentEvidence(references, evidence).values()] })}`;
}

export function buildNaturalReviewSchema(draft, { references, evidence, requireVersion3 = false }) {
  const keys = [...currentEvidence(references, evidence).keys()];
  const spans = buildNaturalSourceSpans({ references, evidence });
  const support = { type: 'object', additionalProperties: false, required: ['chunkId', 'spanId'], properties: { chunkId: { type: 'string', ...(keys.length ? { enum: keys } : {}) }, spanId: { type: 'string', ...(spans.length ? { enum: spans.map(span => span.spanId) } : {}) } } };
  const claim = { type: 'object', additionalProperties: false, required: ['quote', 'type', 'sourceChunkIds', 'supports'], properties: {
    quote: { type: 'string', minLength: 1, maxLength: 1200 }, type: { type: 'string', enum: ['medical', 'education', 'other'] }, sourceChunkIds: idArraySchema(keys, 4, keys.length ? 1 : 0), supports: { type: 'array', minItems: 1, maxItems: 4, items: support },
  } };
  const questions = { type: 'array', maxItems: 4, items: { type: 'object', additionalProperties: false, required: ['quote', 'kind', 'recallSpanId'], properties: {
    quote: { type: 'string', minLength: 1, maxLength: 1800 }, kind: { type: 'string', enum: ['conversation', 'source-recall', 'medical-assessment'] }, recallSpanId: { type: ['string', 'null'], enum: [null, ...spans.map(span => span.spanId)] },
  } } };
  return namedSchema(requireVersion3 ? 'family_medicine_natural_review_v3' : 'family_medicine_natural_review_v2', { version: { type: 'integer', enum: [requireVersion3 ? 3 : 2] }, approved: { type: 'boolean' }, segments: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'object', additionalProperties: false, required: ['id', 'approved', 'externalFactCount', 'claims', 'flags', ...(requireVersion3 ? ['questions'] : [])], properties: {
    id: { type: 'string', enum: draft.segments.map(segment => segment.id) }, approved: { type: 'boolean' }, externalFactCount: { type: 'integer', minimum: 0, maximum: 12 }, claims: { type: 'array', maxItems: keys.length ? 12 : 0, items: claim }, flags: { type: 'array', maxItems: flags.length, items: { type: 'string', enum: flags } },
    ...(requireVersion3 ? { questions } : {}),
  } } } });
}

export function buildNaturalReviewPrompt(draft, { references, evidence, conversation, settings, pendingQuestion = null, requireVersion3 = false }) {
  const latest = conversation.messages.findLast(message => message.role === 'user')?.content || '';
  return `You are a separate automated source-grounding and safety reviewer. Evaluate the ENTIRE candidate reply, including general conversation. Return only one JSON object matching OUTPUT_SCHEMA exactly, with all required fields and no extras; never rewrite the reply.
${evidencePolicyInstructions('reviewer')}
Review every original segment ID exactly once. Each external assertion needs a complete exact quote from its candidate paragraph, declared current sourceChunkIds, and one supporting immutable sourceSpan for each referenced chunk. Select chunkId and spanId from sourceSpans; do not copy or rewrite excerpts. Read the canonical excerpts and verify direct entailment; selecting an ID alone is insufficient. For a question containing a factual premise, quote the exact question and verify that premise. Set externalFactCount to the complete claims array length, including zero for nonfactual segments. Use flags for failures or uncertainty; approved may be true only when every segment passes without flags.
${requireVersion3 ? 'Separately list EVERY question and request for an answer in questions, quoting its complete exact wording. Include imperatives (Name, Choose, Tell me, Explain), indirect requests and other languages; lack of a question mark or factual assertion is not an exemption. kind=medical-assessment includes requests for diagnosis, treatment, first-line choices, medication/dose, clinical next step or other medical knowledge. These are prohibited in generated prose even if a premise has citations: only server-selected canonical questions have authorized answer keys. kind=source-recall is limited to a neutral summary or teach-back of one exact cited point already delivered in trusted conversation or explained in this candidate; bind its current recallSpanId. It must not ask a new specific medical question or grade reasoning. kind=conversation covers ordinary social conversation, preferences and study-process clarification, with recallSpanId=null. A user-provided fact, condition title or retrieved but undelivered passage cannot authorize source-recall. Questions with no known answer cannot be approved. Questions=[] means the segment requests no answer of any kind.' : 'Neutral recall requests assert no new external fact.'}
Presentation metadata records client-reported playback, not hearing or understanding. When a canonical quiz is pending without an affirmative reveal request, reject new factual hints or answer reveals; nonfactual planning and reflection remain allowed.
OUTPUT_SCHEMA=${JSON.stringify(buildNaturalReviewSchema(draft, { references, evidence, requireVersion3 }).schema)}
NATURAL_REVIEW_DATA=${JSON.stringify({ learnerRequest: latest, preferences: { coachStyle: settings.coachStyle, dailyMinutes: settings.dailyMinutes, focus: settings.focus }, history: studyDialogueHistory(conversation), candidate: draft.segments, sources: [...currentEvidence(references, evidence).values()].map(({ text: _excerpt, ...metadata }) => metadata), sourceSpans: buildNaturalSourceSpans({ references, evidence }), pendingQuestion: publicPending(references, pendingQuestion), revealRequested: explicitAnswerReveal(latest) })}`;
}

export function renderReviewedTutor(draft, review, { references, evidence, conversation, pendingQuestion = null, now = Date.now, requireVersion2 = false, requireVersion3 = false, sourceSpanBindings }) {
  draft = validateNaturalDraft(draft, { references, evidence });
  const available = currentEvidence(references, evidence);
  const version2 = object(review) && review.version === 2;
  const version3 = object(review) && review.version === 3;
  const boundReview = version2 || version3;
  if ((requireVersion3 && !version3) || (requireVersion2 && !boundReview) || !exactKeys(review, boundReview ? ['version', 'approved', 'segments'] : ['approved', 'segments']) || review.approved !== true || !Array.isArray(review.segments) || review.segments.length !== draft.segments.length) reject(301);
  const sourceSpans = boundReview || sourceSpanBindings !== undefined || review.segments.some(segment => Object.hasOwn(segment || {}, 'questions')) ? new Map(buildNaturalSourceSpans({ references, evidence }).map(span => [span.spanId, span])) : null;
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
    const questionAudit = version3 || Object.hasOwn(segment || {}, 'questions');
    if (!exactKeys(segment, ['id', 'approved', 'externalFactCount', 'claims', 'flags', ...(questionAudit ? ['questions'] : [])])) reject(302, detail('segment_shape'));
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
    const acceptedSegment = structuredClone(segment);
    for (const [claimIndex, claim] of segment.claims.entries()) {
      if (!exactKeys(claim, ['quote', 'type', 'sourceChunkIds', 'supports']) || !text(claim.quote, 1200) || !original.text.includes(claim.quote) || !['medical', 'education', 'other'].includes(claim.type) || !Array.isArray(claim.sourceChunkIds) || !claim.sourceChunkIds.length || claim.sourceChunkIds.length > 4 || new Set(claim.sourceChunkIds).size !== claim.sourceChunkIds.length || claim.sourceChunkIds.some(key => !available.has(key) || !original.sourceChunkIds.includes(key)) || !Array.isArray(claim.supports) || claim.supports.length !== claim.sourceChunkIds.length) reject(304);
      const supported = new Set();
      const compiledSupports = [];
      for (const [supportIndex, support] of claim.supports.entries()) {
        const source = available.get(support?.chunkId);
        const supportDetail = subcode => ({ ...detail(subcode), claimIndex, supportIndex, supportCount: claim.supports.length });
        if (!exactKeys(support, boundReview ? ['chunkId', 'spanId'] : ['chunkId', 'excerpt'])) reject(305, supportDetail('support_shape'));
        if (!source) reject(305, supportDetail('support_source_unknown'));
        if (supported.has(support.chunkId)) reject(305, supportDetail('support_duplicate'));
        if (!claim.sourceChunkIds.includes(support.chunkId)) reject(305, supportDetail('support_not_declared'));
        const span = boundReview ? sourceSpans.get(support.spanId) : null;
        if (boundReview && !span) reject(305, supportDetail('support_span_unknown'));
        if (boundReview && span.chunkId !== support.chunkId) reject(305, supportDetail('support_span_chunk_mismatch'));
        const excerpt = boundReview ? span.excerpt : support.excerpt;
        if (!text(excerpt, 1600)) reject(305, supportDetail('support_excerpt_invalid'));
        if (!source.text.includes(excerpt)) reject(305, supportDetail('support_excerpt_not_exact'));
        compiledSupports.push({ chunkId: support.chunkId, excerpt });
        supported.add(support.chunkId); used.add(support.chunkId);
      }
      acceptedSegment.claims[claimIndex].supports = compiledSupports;
      externalClaimCount++; if (claim.type === 'medical') medicalClaimCount++;
    }
    const recallKeys = new Set();
    if (questionAudit) {
      if (!Array.isArray(segment.questions) || segment.questions.length > 4) reject(308);
      const questionQuotes = new Set();
      for (const question of segment.questions) {
        if (!exactKeys(question, ['quote', 'kind', 'recallSpanId']) || !text(question.quote, 1800) || !original.text.includes(question.quote) || questionQuotes.has(question.quote) || !['conversation', 'source-recall', 'medical-assessment'].includes(question.kind)) reject(308);
        questionQuotes.add(question.quote);
        if (question.kind === 'medical-assessment') reject(308);
        if (question.kind === 'source-recall') {
          const span = sourceSpans.get(question.recallSpanId);
          if (!span || !original.sourceChunkIds.includes(span.chunkId) || !recallPointAvailable(span, { conversation, draft, review, original, question })) reject(308);
          recallKeys.add(span.chunkId); used.add(span.chunkId);
        } else if (question.recallSpanId !== null) reject(308);
      }
      // Literal question marks and obvious answer requests cannot disappear
      // from the independent audit merely by reporting an empty questions list.
      for (let index = 0; index < original.text.length; index++) {
        if (original.text[index] === '?' && !segment.questions.some(question => {
          const start = original.text.indexOf(question.quote);
          return index >= start && index < start + question.quote.length;
        })) reject(308);
      }
      if (/^(?:please\s+)?(?:name|list|identify|choose|select|tell me|give me|recall|summarize|explain)\b/i.test(original.text.trim()) && !segment.questions.length) reject(308);
      for (const question of segment.questions) {
        if (/\b(?:without looking back|(?:cited|source[- ]linked|study) (?:point|section|text)|(?:the )?main point|summarize (?:the|this|that) point)\b/i.test(question.quote) && question.kind !== 'source-recall') reject(308);
      }
    }
    // Apply this also on replay: older medical questions never acquire answer
    // authorization just because their former factual review was successful.
    if (obviousMedicalAssessment(original.text)) reject(308);
    if (original.sourceChunkIds.length && !segment.claims.length && (!recallKeys.size || original.sourceChunkIds.some(key => !recallKeys.has(key)))) reject(303);
    accepted.push(acceptedSegment);
  }
  const latest = conversation.messages.findLast(message => message.role === 'user')?.content || '';
  if (pendingQuestion && !explicitAnswerReveal(latest) && externalClaimCount) reject(306);
  const sourceChunkIds = [...used];
  if (sourceChunkIds.length > 4) reject(307);
  if (sourceSpanBindings !== undefined && (expectedBindings.size !== sourceChunkIds.length || sourceChunkIds.some(key => !expectedBindings.has(key)))) reject(305, { subcode: 'support_not_declared', declaredSourceCount: expectedBindings.size });
  const persistedBindings = boundReview ? sourceChunkIds.map(chunkId => {
    const span = [...sourceSpans.values()].find(item => item.chunkId === chunkId);
    return { chunkId, spanId: span.spanId };
  }) : sourceSpanBindings !== undefined ? sourceChunkIds.map(key => expectedBindings.get(key)) : undefined;
  const citationByChunk = new Map(sourceChunkIds.map(key => [key, references.render({ chunkIds: [key], questionId: null, unsupported: false }, evidence).citations]));
  const citations = [...new Map([...citationByChunk.values()].flat().map(source => [`${source.id}|${source.url}`, source])).values()];
  if (citations.length > 10) reject(307);
  const citationNumbers = new Map(citations.map((source, index) => [`${source.id}|${source.url}`, index + 1]));
  const reviewById = new Map(accepted.map(segment => [segment.id, segment]));
  const content = draft.segments.map(segment => {
    const segmentReview = reviewById.get(segment.id);
    const citationKeys = [...segmentReview.claims.flatMap(claim => claim.sourceChunkIds), ...(segmentReview.questions || []).filter(question => question.kind === 'source-recall').map(question => sourceSpans.get(question.recallSpanId).chunkId)];
    const referencesForSegment = [...new Set(citationKeys.flatMap(key => citationByChunk.get(key).map(source => citationNumbers.get(`${source.id}|${source.url}`))))];
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
