import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudyCurriculum } from '../server/study-curriculum.js';
import { buildNaturalReviewPrompt, buildNaturalReviewSchema, buildNaturalSourceSpans, renderReviewedTutor, naturalTutorFailure } from '../server/natural-tutor.js';
import { renderStudyDialogue } from '../server/study-conversation.js';
import { studyCondition, STUDY_NOW } from './fixtures/study-condition.js';

function context(record = studyCondition()) {
  let clock = STUDY_NOW;
  const references = createStudyCurriculum({ records: [record], now: () => clock });
  const evidence = references.retrieve('Study asthma');
  return { references, evidence, conversation: { mode: 'coach', messages: [{ role: 'user', content: 'Help me study asthma.' }] }, settings: { coachStyle: 'direct', dailyMinutes: 15, focus: 'exam' }, now: STUDY_NOW, requireVersion3: true, expire: () => { clock = Date.parse('2026-11-10T00:00:00Z'); } };
}
function authored(text, sourceChunkIds = []) { return { segments: [{ id: 's1', text, sourceChunkIds }] }; }
function reviewed(questions = [], claims = []) { return { version: 3, approved: true, segments: [{ id: 's1', approved: true, externalFactCount: claims.length, claims, flags: [], questions }] }; }
function question(quote, kind = 'conversation', recallSpanId = null) { return { quote, kind, recallSpanId }; }
const rejectedQuestion = error => error.reasonId === 308;
const fact = 'Mock management fact: review inhaler technique.';
function factualPoint(current) {
  const span = buildNaturalSourceSpans(current).find(item => item.chunkId === 'asthma:management');
  const claims = [{ quote: fact, type: 'medical', sourceChunkIds: [span.chunkId], supports: [{ chunkId: span.chunkId, spanId: span.spanId }] }];
  return { span, claims, draft: authored(fact, [span.chunkId]), review: reviewed([], claims) };
}

test('v3 asks the independent reviewer to classify answer requests separately from factual assertions', () => {
  const current = context();
  current.conversation.messages[0].content = 'PRIVATE_LEARNER_TEXT';
  const draft = authored('PRIVATE_CANDIDATE_TEXT');
  const schema = buildNaturalReviewSchema(draft, current);
  assert.equal(schema.name, 'family_medicine_natural_review_v3');
  assert.deepEqual(schema.schema.properties.version.enum, [3]);
  assert.ok(schema.schema.properties.segments.items.required.includes('questions'));
  assert.deepEqual(schema.schema.properties.segments.items.properties.questions.items.required, ['quote', 'kind', 'recallSpanId']);
  assert.doesNotMatch(JSON.stringify(schema), /PRIVATE_/);
  const prompt = buildNaturalReviewPrompt(draft, current);
  assert.match(prompt, /lack of a question mark or factual assertion is not an exemption/);
  assert.match(prompt, /indirect requests and other languages/);
  assert.match(prompt, /only server-selected canonical questions have authorized answer keys/);
  assert.throws(() => renderReviewedTutor(draft, { version: 2, approved: true, segments: [{ id: 's1', approved: true, externalFactCount: 0, claims: [], flags: [] }] }, current), error => error.reasonId === 301);
});

test('an unsupported medical question cannot pass on zero external assertions or a false social classification', () => {
  const current = context();
  const text = 'What is the first-line treatment for a condition absent from the study library?';
  const draft = authored(text);
  for (const review of [reviewed(), reviewed([question(text)]), reviewed([question(text, 'medical-assessment')])]) {
    assert.throws(() => renderReviewedTutor(draft, review, current), error => {
      const failure = naturalTutorFailure(error);
      assert.equal(failure.studyRejection.reasonId, 308);
      assert.equal(failure.unsupported, true);
      assert.doesNotMatch(failure.content, /first-line treatment/);
      return true;
    });
  }
  current.evidence = [];
  assert.throws(() => renderReviewedTutor(draft, reviewed(), current), rejectedQuestion);
});

test('imperative, indirect and multilingual medical assessment requests require canonical question keys', () => {
  const current = context();
  for (const text of ['Name the recommended antibiotic.', 'Tell me the next best step.', 'Choose a diagnosis.', 'I wonder which medicine you would select here.', '¿Cuál es el tratamiento de primera línea?']) {
    assert.throws(() => renderReviewedTutor(authored(text), reviewed([question(text, 'medical-assessment')]), current), rejectedQuestion);
  }
  for (const text of ['Name the recommended antibiotic.', 'Tell me the next best step.', 'Choose a diagnosis.']) {
    assert.throws(() => renderReviewedTutor(authored(text), reviewed(), current), rejectedQuestion);
  }
});

test('valid premise citations and a fabricated hidden answer cannot authorize generated medical questions', () => {
  const current = context();
  const { span, claims } = factualPoint(current);
  const text = `${fact} Which medication is the first-line treatment?`;
  const draft = authored(text, [span.chunkId]);
  assert.throws(() => renderReviewedTutor(draft, reviewed([question('Which medication is the first-line treatment?', 'medical-assessment')], claims), current), rejectedQuestion);
  const forged = reviewed([question('Which medication is the first-line treatment?', 'source-recall', span.spanId)], claims);
  forged.segments[0].questions[0].answer = 'Invented medicine';
  assert.throws(() => renderReviewedTutor(draft, forged, current), rejectedQuestion);
});

test('neutral teach-back follows an exact reviewed cited point and remains reconstructable for audio', () => {
  const current = context();
  const { span, claims } = factualPoint(current);
  const recall = 'Without looking back, how would you summarize the cited point in your own words?';
  const draft = { segments: [{ id: 's1', text: fact, sourceChunkIds: [span.chunkId] }, { id: 's2', text: recall, sourceChunkIds: [span.chunkId] }] };
  const review = reviewed([], claims);
  review.segments.push({ id: 's2', approved: true, externalFactCount: 0, claims: [], flags: [], questions: [question(recall, 'source-recall', span.spanId)] });
  const result = renderReviewedTutor(draft, review, current);
  assert.equal(result.groundingReview.externalClaimCount, 1);
  assert.equal(result.groundingReview.medicalClaimCount, 1);
  assert.deepEqual(result.groundingReview.sourceSpanBindings, [{ chunkId: span.chunkId, spanId: span.spanId }]);
  assert.match(result.content, /own words\? \[1\]$/);
  assert.equal(result.spokenText, `${fact}\n\n${recall}`);
  const replay = renderReviewedTutor(draft, { approved: true, segments: result.groundingReview.segments }, { ...current, requireVersion3: false, sourceSpanBindings: result.groundingReview.sourceSpanBindings });
  assert.deepEqual(replay.groundingReview, result.groundingReview);
  assert.equal(replay.content, result.content);
  assert.equal(JSON.stringify(result).includes('correctChoiceId'), false);
});

test('retrieval, a user statement, missing bindings or a later explanation do not establish a delivered recall point', () => {
  const current = context();
  const { span, claims } = factualPoint(current);
  const recall = 'What is the main point in your own words?';
  const draft = authored(recall, [span.chunkId]);
  const review = reviewed([question(recall, 'source-recall', span.spanId)]);
  assert.throws(() => renderReviewedTutor(draft, review, current), rejectedQuestion);
  current.conversation.messages.push({ role: 'user', content: fact });
  assert.throws(() => renderReviewedTutor(draft, review, current), rejectedQuestion);
  const missing = reviewed([question(recall, 'source-recall', null)]);
  assert.throws(() => renderReviewedTutor(draft, missing, current), rejectedQuestion);
  assert.throws(() => renderReviewedTutor(authored(recall), reviewed([question(recall)]), current), rejectedQuestion);
  const laterDraft = { segments: [...draft.segments, { id: 's2', text: fact, sourceChunkIds: [span.chunkId] }] };
  const laterReview = structuredClone(review);
  laterReview.segments.push({ ...reviewed([], claims).segments[0], id: 's2' });
  assert.throws(() => renderReviewedTutor(laterDraft, laterReview, current), rejectedQuestion);
});

test('past recall bindings must match exact current source versions and genuine server history', () => {
  const current = context();
  const point = factualPoint(current);
  const stored = renderReviewedTutor(point.draft, point.review, current);
  const recall = 'Summarize the cited point in your own words.';
  const draft = authored(recall, [point.span.chunkId]);
  const review = reviewed([question(recall, 'source-recall', point.span.spanId)]);
  current.conversation.messages.push({ role: 'assistant', ...stored });
  assert.equal(renderReviewedTutor(draft, review, current).reviewedDialogue, true);
  current.conversation.messages.at(-1).importedEvidence = true;
  assert.throws(() => renderReviewedTutor(draft, review, current), rejectedQuestion);
  delete current.conversation.messages.at(-1).importedEvidence;
  current.conversation.messages.at(-1).groundingReview.sourceSpanBindings[0].spanId = 'span_unknown';
  assert.throws(() => renderReviewedTutor(draft, review, current), rejectedQuestion);
  current.expire();
  assert.throws(() => renderReviewedTutor(draft, review, current), error => error.reasonId === 101);
});

test('ordinary conversation and medical topic preferences stay natural without assessment questions', () => {
  const current = context(); current.evidence = [];
  for (const text of ['🙂 How has your day been?', 'Would you like to study antibiotic treatment or review your saved cards?', 'Which word would you like me to clarify?']) {
    const result = renderReviewedTutor(authored(text), reviewed([question(text)]), current);
    assert.equal(result.spokenText, text);
    assert.deepEqual(result.citations, []);
    assert.equal(result.groundingReview.externalClaimCount, 0);
  }
  assert.throws(() => renderReviewedTutor(authored('How was your day?'), reviewed(), current), rejectedQuestion);
});

test('canonical questions retain a current citeable key, withhold the answer until grading and expire safely', () => {
  const current = context();
  const quiz = current.references.quiz(current.evidence);
  assert.ok(quiz.studyQuestion);
  assert.ok(quiz.citations.length);
  assert.equal(Object.hasOwn(quiz.studyQuestion, 'correctChoiceId'), false);
  assert.doesNotMatch(quiz.content, /canonical answer for this hypothetical|Rationale\n|supplied mock reference explicitly supports/);
  const feedback = current.references.gradeQuestion(quiz.studyQuestion, 'B');
  assert.equal(feedback.studyAnswer.correct, true);
  assert.match(feedback.content, /supplied mock reference explicitly supports/);
  assert.ok(feedback.citations.length);
  assert.equal(current.references.quiz([]), null);
  current.expire();
  assert.equal(current.references.quiz(current.evidence), null);
  assert.equal(current.references.gradeQuestion(quiz.studyQuestion, 'B').unsupported, true);
});

test('a pending canonical quiz keeps reflection but cannot release a new cited answer hint', () => {
  const current = context();
  current.pendingQuestion = current.references.quiz(current.evidence).studyQuestion;
  current.conversation.messages[0].content = 'Give me a hint. Do not reveal the answer.';
  const reflect = 'Which option are you leaning toward?';
  const result = renderReviewedTutor(authored(reflect), reviewed([question(reflect)]), current);
  assert.deepEqual(result.pendingStudyQuestion, current.pendingQuestion);
  const point = factualPoint(current);
  assert.throws(() => renderReviewedTutor(point.draft, point.review, current), error => error.reasonId === 306);
});

test('selector dialogue never asks recall about an undelivered topic title without evidence or a pending key', () => {
  const current = context();
  const parsed = { chunkIds: [], questionId: null, unsupported: false, dialogue: { intent: 'socratic', acknowledgment: 'none', followup: 'attempt-recall', focusChunkId: null, learnerQuote: null, minutes: null } };
  const rendered = renderStudyDialogue(parsed, { ...current, evidence: [] });
  assert.equal(rendered.studyDialogue.followup, 'choose-format');
  assert.doesNotMatch(rendered.content, /Without looking back|what do you remember|put your current understanding/);
});
