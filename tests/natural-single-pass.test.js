import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudyCurriculum } from '../server/study-curriculum.js';
import { renderNaturalTutor, buildNaturalSourceSpans, NaturalTutorError } from '../server/natural-tutor.js';
import { studyCondition, STUDY_NOW } from './fixtures/study-condition.js';

function fixture(record = studyCondition(), now = STUDY_NOW) {
  const references = createStudyCurriculum({ records: [record], now: () => now });
  return { references, evidence: references.retrieve('Study asthma'), conversation: { messages: [{ role: 'user', content: 'Explain the supplied study point.' }] } };
}
function draft(text = 'For this study point, review inhaler technique.', sourceChunkIds = ['asthma:management']) {
  return { segments: [{ id: 's1', text, sourceChunkIds }] };
}

test('single-pass prose binds current library sources without claiming an independent review', () => {
  const context = fixture();
  const input = draft();
  const rendered = renderNaturalTutor(input, context);
  assert.equal(rendered.spokenText, input.segments[0].text);
  assert.equal(rendered.content, `${input.segments[0].text} [1]`);
  assert.equal(rendered.libraryGroundedDialogue, true);
  assert.equal(rendered.libraryGrounding.version, 1);
  assert.equal(rendered.libraryGrounding.status, 'bound');
  assert.deepEqual(rendered.libraryGrounding.sourceChunkIds, ['asthma:management']);
  assert.deepEqual(rendered.libraryGrounding.sourceSpanBindings, buildNaturalSourceSpans(context).filter(span => span.chunkId === 'asthma:management').map(({ chunkId, spanId }) => ({ chunkId, spanId })));
  assert.equal(rendered.sourceVerified, false);
  assert.equal(rendered.humanReview, false);
  assert.equal(rendered.canonicalSpokenText, false);
  assert.equal(rendered.reviewedDialogue, undefined);
  assert.equal(rendered.groundingReview, undefined);
  assert.equal(rendered.current, true);
  assert.equal(rendered.citations[0].url, 'https://www.nhlbi.nih.gov/health/asthma');
  input.segments[0].text = 'Changed caller input';
  assert.notEqual(rendered.naturalSegments[0].text, input.segments[0].text);
});

test('source rendering rehydrates canonical text and URLs instead of trusting evidence copies', () => {
  const context = fixture();
  const before = renderNaturalTutor(draft(), context);
  const forged = context.evidence.map(item => ({ ...item, text: 'INVENTED_SOURCE_TEXT', citations: [{ id: 'forged', url: 'https://example.com' }] }));
  const after = renderNaturalTutor(draft(), { ...context, evidence: forged });
  assert.deepEqual(after.libraryGrounding, before.libraryGrounding);
  assert.deepEqual(after.citations, before.citations);
});

test('ordinary conversation, preferences, and an honest source gap need no false citations', () => {
  const context = { ...fixture(), evidence: [] };
  for (const text of [
    'Hi Morgan. What would you like to work on?',
    'Would you like an original question or a short study point?',
    'Would you like to study asthma treatment?',
    'Asthma is available in the study library.',
    'Would you like to study inhaler technique?',
    'We can discuss treatment when you are ready.',
    'Which part would you like to explore?',
    'I cannot verify that exact medication dose from the current library. Would you like to choose another study point?',
    'The current library does not include enough evidence for that treatment detail.',
  ]) {
    const rendered = renderNaturalTutor(draft(text, []), context);
    assert.equal(rendered.spokenText, text);
    assert.deepEqual(rendered.citations, []);
    assert.deepEqual(rendered.libraryGrounding.sourceSpanBindings, []);
    assert.equal(rendered.current, undefined);
  }
});

test('overt medical prose and doses without source bindings are rejected, including after a gap statement', () => {
  const context = { ...fixture(), evidence: [] };
  for (const text of ['Asthma is reversible.', 'Take 20 mg daily.', 'Review inhaler technique.', 'I cannot verify this guideline. Asthma requires a medication.', 'I cannot find a source, but this treatment works.', 'Would you like to study a dose of 20 mg?', 'We can discuss treatment, but take 20 mg daily.', 'Asthma is available in the study library and treatment cures it.']) {
    assert.throws(() => renderNaturalTutor(draft(text, []), context), error => error instanceof NaturalTutorError && error.reasonId === 303, text);
  }
});

test('unknown, stale, malformed, and model-provided authorization fields cannot bind a reply', () => {
  assert.throws(() => renderNaturalTutor(draft('A study point.', ['unknown:section']), fixture()), { reasonId: 202 });
  const malformed = draft(); malformed.segments[0].sourceVerified = true;
  assert.throws(() => renderNaturalTutor(malformed, fixture()), { reasonId: 202 });
  const fresh = fixture();
  const expired = fixture(studyCondition(), Date.parse('2026-12-01T00:00:00Z'));
  assert.throws(() => renderNaturalTutor(draft(), { ...expired, evidence: fresh.evidence }), { reasonId: 101 });
});

test('saved bindings reject changed canonical source text, missing, duplicate, and mismatched bindings', () => {
  const before = fixture();
  const original = renderNaturalTutor(draft(), before);
  const sourceSpanBindings = original.libraryGrounding.sourceSpanBindings;
  assert.deepEqual(renderNaturalTutor(draft(), { ...before, sourceSpanBindings }), original);
  const changed = studyCondition(); changed.sections[1].text += ' Changed canonical revision.';
  const after = fixture(changed);
  assert.throws(() => renderNaturalTutor(draft(), { ...after, sourceSpanBindings }), { reasonId: 305 });
  for (const bindings of [[], [...sourceSpanBindings, ...sourceSpanBindings], [{ chunkId: 'asthma:management', spanId: 'span_unknown' }], [{ ...sourceSpanBindings[0], approved: true }]]) {
    assert.throws(() => renderNaturalTutor(draft(), { ...before, sourceSpanBindings: bindings }), { reasonId: 305 });
  }
});

test('generated medical assessment questions and invented patient cases remain server-owned', () => {
  for (const text of [
    'What is the first-line treatment?',
    'Which diagnosis is most likely?',
    'Name the antibiotic dose.',
    'Would you like to tell me the correct diagnosis?',
    'A 65-year-old patient presents with wheezing. What would you do?',
  ]) assert.throws(() => renderNaturalTutor(draft(text), fixture()), { reasonId: 308 }, text);
  assert.equal(renderNaturalTutor(draft('Review inhaler technique. Which part would you like to explore?'), fixture()).libraryGroundedDialogue, true);
  assert.equal(renderNaturalTutor(draft('For 65-year-old adults, preserve the population limits in this study reference.'), fixture()).libraryGroundedDialogue, true);
});

test('pending canonical quizzes reject bound hints and unsolicited grading', () => {
  const context = fixture();
  const pendingQuestion = context.references.quiz(context.evidence).studyQuestion;
  const pending = { ...context, pendingQuestion, conversation: { messages: [{ role: 'user', content: 'Give me a hint.' }] } };
  assert.throws(() => renderNaturalTutor(draft(), pending), { reasonId: 306 });
  assert.throws(() => renderNaturalTutor(draft('Your answer is correct.', []), pending), { reasonId: 306 });
  assert.equal(renderNaturalTutor(draft('Take your time. Which option would you like to choose?', []), pending).libraryGroundedDialogue, true);
  assert.equal(renderNaturalTutor(draft(), { ...pending, conversation: { messages: [{ role: 'user', content: 'Reveal the answer.' }] } }).libraryGroundedDialogue, true);
  assert.throws(() => renderNaturalTutor(draft(), { ...pending, conversation: { messages: [{ role: 'user', content: 'Do not reveal the answer.' }] } }), { reasonId: 306 });
});

test('source unions and bindings preserve segment insertion order while sharing citations', () => {
  const context = fixture();
  const input = { segments: [
    { id: 's1', text: 'Review inhaler technique.', sourceChunkIds: ['asthma:management'] },
    { id: 's2', text: 'Assess variable airflow limitation.', sourceChunkIds: ['asthma:diagnosis'] },
  ] };
  const rendered = renderNaturalTutor(input, context);
  assert.deepEqual(rendered.libraryGrounding.sourceChunkIds, ['asthma:management', 'asthma:diagnosis']);
  assert.deepEqual(rendered.libraryGrounding.sourceSpanBindings.map(binding => binding.chunkId), rendered.libraryGrounding.sourceChunkIds);
  assert.equal(rendered.citations.length, 1);
  assert.equal(rendered.content, `${input.segments[0].text} [1]\n\n${input.segments[1].text} [1]`);
});
