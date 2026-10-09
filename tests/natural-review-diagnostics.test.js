import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStudyCurriculum } from '../server/study-curriculum.js';
import { buildNaturalTutorPrompt, buildNaturalReviewPrompt, renderReviewedTutor, NaturalTutorError, naturalTutorFailure } from '../server/natural-tutor.js';

function context() {
  const record = JSON.parse(readFileSync(new URL('../content/conditions/cardiometabolic.json', import.meta.url))).conditions.find(condition => condition.id === 'atrial-fibrillation');
  const now = Date.parse(`${record.review.checkedAt}T12:00:00Z`);
  const references = createStudyCurriculum({ records: [record], now: () => now });
  const evidence = references.retrieve('Study atrial fibrillation', { maxChunks: 6 });
  const key = 'atrial-fibrillation:risk';
  const source = evidence.find(item => item.key === key);
  assert.ok(source);
  const text = 'The study summary bases stroke prevention on estimated annual thromboembolism risk, regardless of AF pattern, when that risk is at least 2% per year.';
  const draft = { segments: [{ id: 's1', text, sourceChunkIds: [key] }, { id: 's2', text: 'What is the main point in your own words?', sourceChunkIds: [] }] };
  const review = { approved: true, segments: [{ id: 's1', approved: true, externalFactCount: 1, claims: [{ quote: text, type: 'medical', sourceChunkIds: [key], supports: [{ chunkId: key, excerpt: source.text }] }], flags: [] }, { id: 's2', approved: true, externalFactCount: 0, claims: [], flags: [] }] };
  return { references, evidence, draft, review, conversation: { mode: 'coach', messages: [{ role: 'user', content: 'For board study, explain one cited point about atrial fibrillation from the current library, then ask one recall question about that point.' }] }, settings: { coachStyle: 'direct', dailyMinutes: 15, focus: 'exam' }, now };
}

test('actual AF study corpus supports one reviewed point followed by neutral recall without adding a factual premise', () => {
  const current = context();
  const result = renderReviewedTutor(current.draft, current.review, current);
  assert.equal(result.reviewedDialogue, true);
  assert.equal(result.sourceVerified, false);
  assert.equal(result.groundingReview.externalClaimCount, 1);
  assert.deepEqual(result.groundingReview.sourceChunkIds, ['atrial-fibrillation:risk']);
  assert.equal(result.spokenText, current.draft.segments.map(segment => segment.text).join('\n\n'));
  assert.match(result.content, /\[1\]\n\nWhat is the main point in your own words\?$/);
  assert.equal(result.citations[0].url, current.references.get('atrial-fibrillation').sources[0].url);
  const author = buildNaturalTutorPrompt(current);
  const reviewer = buildNaturalReviewPrompt(current.draft, current);
  assert.match(author, /Questions can contain factual premises/);
  assert.match(reviewer, /Review factual premises inside questions/);
});

test('a supported factual premise in an AF recall question requires that question segment to declare its source', () => {
  const current = context();
  const key = 'atrial-fibrillation:risk';
  const question = 'At what estimated annual risk does the study point base stroke prevention on risk regardless of AF pattern?';
  current.draft.segments[1] = { id: 's2', text: question, sourceChunkIds: [key] };
  current.review.segments[1] = { id: 's2', approved: true, externalFactCount: 1, flags: [], claims: [{ quote: question, type: 'medical', sourceChunkIds: [key], supports: [{ chunkId: key, excerpt: current.evidence.find(item => item.key === key).text }] }] };
  assert.equal(renderReviewedTutor(current.draft, current.review, current).groundingReview.externalClaimCount, 2);
  current.draft.segments[1].sourceChunkIds = [];
  assert.throws(() => renderReviewedTutor(current.draft, current.review, current), error => error instanceof NaturalTutorError && error.reasonId === 304);
  current.review.segments[1].approved = false;
  current.review.segments[1].flags = ['missing_source'];
  assert.throws(() => renderReviewedTutor(current.draft, current.review, current), error => {
    const failure = naturalTutorFailure(error);
    assert.equal(failure.studyRejection.reasonId, 302);
    assert.equal(failure.studyRejection.diagnostics.subcode, 'flags_present');
    assert.deepEqual(failure.studyRejection.diagnostics.flags, ['missing_source']);
    assert.equal(failure.studyRejection.diagnostics.declaredSourceCount, 0);
    assert.deepEqual(failure.citations, []);
    return true;
  });
});

test('review rejection diagnostics distinguish fixed structural causes without preserving private IDs or prose', () => {
  const rows = [
    ['segment_shape', segment => { segment.extra = 'PRIVATE_EXTRA'; }],
    ['segment_unknown', segment => { segment.id = 'PRIVATE_SEGMENT_ID'; }],
    ['segment_duplicate', segment => { segment.id = 's1'; }],
    ['segment_not_approved', segment => { segment.approved = false; }],
    ['flags_shape', segment => { segment.flags = 'PRIVATE_FLAGS'; }],
    ['flags_present', segment => { segment.flags = ['uncertain', 'PRIVATE_FLAGS']; }],
    ['fact_count_invalid', segment => { segment.externalFactCount = -1; }],
    ['claims_shape', segment => { segment.claims = 'PRIVATE_CLAIMS'; }],
    ['fact_count_mismatch', segment => { segment.externalFactCount = 1; }],
  ];
  for (const [subcode, mutate] of rows) {
    const current = context(); mutate(current.review.segments[1]);
    assert.throws(() => renderReviewedTutor(current.draft, current.review, current), error => {
      const failure = naturalTutorFailure(error);
      assert.equal(failure.studyRejection.reasonId, 302);
      assert.equal(failure.studyRejection.diagnostics.subcode, subcode);
      assert.equal(failure.studyRejection.diagnostics.segmentIndex, 1);
      assert.equal(failure.studyRejection.diagnostics.draftSegmentCount, 2);
      assert.equal(failure.studyRejection.diagnostics.reviewSegmentCount, 2);
      assert.doesNotMatch(JSON.stringify(failure), /PRIVATE_|atrial-fibrillation|thromboembolism/);
      if (subcode === 'flags_present') assert.deepEqual(failure.studyRejection.diagnostics.flags, ['uncertain']);
      return true;
    }, subcode);
  }
});

test('diagnostic sanitization rejects arbitrary subcodes, error strings and nested private projections', () => {
  const error = new NaturalTutorError(302, { subcode: 'flags_present', flags: ['missing_source', 'PRIVATE'], flagCount: 999999, claimCount: 3, externalFactCount: 'PRIVATE', segmentId: 'PRIVATE', raw: 'PRIVATE', nested: { user: 'PRIVATE' } });
  assert.deepEqual(naturalTutorFailure(error).studyRejection.diagnostics, { version: 1, stage: 'review', subcode: 'flags_present', claimCount: 3, flagCount: 100, flags: ['missing_source'] });
  error.diagnostics = { subcode: 'PRIVATE', raw: 'PRIVATE' };
  assert.equal(naturalTutorFailure(error).studyRejection.diagnostics, undefined);
  error.reasonId = 'PRIVATE';
  assert.equal(naturalTutorFailure(error).studyRejection.reasonId, 499);
  for (const other of [new Error('PRIVATE_MODEL_BODY'), new SyntaxError('PRIVATE_MODEL_JSON'), new NaturalTutorError('PRIVATE')]) assert.doesNotMatch(JSON.stringify(naturalTutorFailure(other)), /PRIVATE/);
});
