import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStudyCurriculum } from '../server/study-curriculum.js';
import { buildNaturalSourceSpans, buildNaturalReviewSchema, buildNaturalReviewPrompt, renderReviewedTutor, NaturalTutorError, naturalTutorFailure } from '../server/natural-tutor.js';

function context(recordOverride) {
  const original = JSON.parse(readFileSync(new URL('../content/conditions/cardiometabolic.json', import.meta.url))).conditions.find(condition => condition.id === 'atrial-fibrillation');
  const record = recordOverride || original;
  const now = Date.parse(`${record.review.checkedAt}T12:00:00Z`);
  const references = createStudyCurriculum({ records: [record], now: () => now });
  const evidence = references.retrieve('Study atrial fibrillation', { maxChunks: 6 });
  const key = 'atrial-fibrillation:risk';
  const source = evidence.find(item => item.key === key);
  assert.ok(source);
  const text = 'The study summary bases stroke prevention on estimated annual thromboembolism risk, regardless of AF pattern, when that risk is at least 2% per year.';
  const draft = { segments: [{ id: 's1', text, sourceChunkIds: [key] }] };
  const span = buildNaturalSourceSpans({ references, evidence }).find(item => item.chunkId === key);
  const review = { version: 2, approved: true, segments: [{ id: 's1', approved: true, externalFactCount: 1, claims: [{ quote: text, type: 'medical', sourceChunkIds: [key], supports: [{ chunkId: key, spanId: span.spanId }] }], flags: [] }] };
  return { record, references, evidence, draft, review, source, span, conversation: { mode: 'coach', messages: [{ role: 'user', content: 'Explain one cited study point about atrial fibrillation.' }] }, settings: { coachStyle: 'direct', dailyMinutes: 15, focus: 'exam' }, now };
}

test('an immutable current AF source span compiles into existing exact-excerpt records for premium replay', () => {
  const current = context();
  const spans = buildNaturalSourceSpans(current);
  assert.equal(spans.length, current.evidence.length);
  assert.equal(current.span.excerpt, current.source.text);
  assert.deepEqual(buildNaturalSourceSpans(current), spans);
  const rendered = renderReviewedTutor(current.draft, current.review, { ...current, requireVersion2: true });
  assert.equal(rendered.groundingReview.version, 1);
  assert.deepEqual(rendered.groundingReview.segments[0].claims[0].supports, [{ chunkId: current.source.key, excerpt: current.source.text }]);
  assert.doesNotMatch(JSON.stringify(rendered.groundingReview.segments), /spanId/);
  assert.deepEqual(rendered.groundingReview.sourceSpanBindings, [{ chunkId: current.span.chunkId, spanId: current.span.spanId }]);
  const replay = renderReviewedTutor(current.draft, { approved: true, segments: rendered.groundingReview.segments }, { ...current, sourceSpanBindings: rendered.groundingReview.sourceSpanBindings });
  assert.equal(replay.content, rendered.content);
  assert.equal(replay.spokenText, rendered.spokenText);
  assert.deepEqual(replay.citations, rendered.citations);
  assert.deepEqual(replay.groundingReview.sourceSpanBindings, rendered.groundingReview.sourceSpanBindings);
});

test('persisted span bindings reject additive source edits and incomplete unions while older v1 records remain compatible', () => {
  const before = context();
  const rendered = renderReviewedTutor(before.draft, before.review, before);
  const legacy = { approved: true, segments: rendered.groundingReview.segments };
  assert.equal(renderReviewedTutor(before.draft, legacy, before).content, rendered.content);
  const appended = structuredClone(before.record);
  appended.sections.find(section => section.id === 'risk').text += ' A changed-source qualifier has been appended.';
  const after = context(appended);
  assert.ok(after.source.text.includes(before.source.text));
  assert.throws(() => renderReviewedTutor(before.draft, legacy, { ...after, sourceSpanBindings: rendered.groundingReview.sourceSpanBindings }), error => error.reasonId === 305 && error.diagnostics.subcode === 'support_span_unknown');
  assert.throws(() => renderReviewedTutor(before.draft, legacy, { ...before, sourceSpanBindings: [] }), error => error.reasonId === 305 && error.diagnostics.subcode === 'support_not_declared');
  const surplus = buildNaturalSourceSpans(before).map(({ chunkId, spanId }) => ({ chunkId, spanId }));
  assert.throws(() => renderReviewedTutor(before.draft, legacy, { ...before, sourceSpanBindings: surplus }), error => error.reasonId === 305 && error.diagnostics.subcode === 'support_not_declared');
});

test('unknown, cross-chunk and arbitrary-text span selections remain rejected with private-safe reason305 details', () => {
  for (const [subcode, mutate] of [
    ['support_span_unknown', support => { support.spanId = 'PRIVATE_INVENTED_SPAN'; }],
    ['support_span_chunk_mismatch', (support, current) => { support.spanId = buildNaturalSourceSpans(current).find(span => span.chunkId !== support.chunkId).spanId; }],
    ['support_shape', support => { support.excerpt = 'PRIVATE_MODEL_EXCERPT'; }],
  ]) {
    const current = context(); mutate(current.review.segments[0].claims[0].supports[0], current);
    assert.throws(() => renderReviewedTutor(current.draft, current.review, { ...current, requireVersion2: true }), error => {
      assert.equal(error.reasonId, 305);
      const failure = naturalTutorFailure(error);
      assert.equal(failure.studyRejection.diagnostics.subcode, subcode);
      assert.equal(failure.studyRejection.diagnostics.claimIndex, 0);
      assert.equal(failure.studyRejection.diagnostics.supportIndex, 0);
      assert.equal(failure.studyRejection.diagnostics.supportCount, 1);
      assert.doesNotMatch(JSON.stringify(failure), /PRIVATE_|atrial-fibrillation|span_[a-f0-9]{64}|thromboembolism/);
      return true;
    });
  }
  const current = context();
  const legacy = structuredClone(current.review); delete legacy.version;
  legacy.segments[0].claims[0].supports = [{ chunkId: current.source.key, excerpt: 'PRIVATE_NONCANONICAL_EXCERPT' }];
  assert.throws(() => renderReviewedTutor(current.draft, legacy, current), error => {
    assert.equal(naturalTutorFailure(error).studyRejection.diagnostics.subcode, 'support_excerpt_not_exact');
    assert.doesNotMatch(JSON.stringify(naturalTutorFailure(error)), /PRIVATE_/);
    return true;
  });
});

test('source-span identity binds exact current canonical text and cannot authorize a changed source', () => {
  const before = context();
  const changed = structuredClone(before.record);
  changed.sections.find(section => section.id === 'risk').text += ' This is a changed test-source revision.';
  const after = context(changed);
  assert.notEqual(after.span.spanId, before.span.spanId);
  assert.throws(() => renderReviewedTutor(before.draft, before.review, { ...after, requireVersion2: true }), error => error instanceof NaturalTutorError && error.reasonId === 305 && error.diagnostics.subcode === 'support_span_unknown');
});

test('fresh review protocol requires version2 without weakening exact claims, pending guards or schema privacy', () => {
  const current = context();
  const legacy = { approved: true, segments: structuredClone(current.review.segments) };
  legacy.segments[0].claims[0].supports = [{ chunkId: current.source.key, excerpt: current.source.text }];
  assert.throws(() => renderReviewedTutor(current.draft, legacy, { ...current, requireVersion2: true }), error => error.reasonId === 301);
  const schema = buildNaturalReviewSchema(current.draft, current);
  assert.equal(schema.name, 'family_medicine_natural_review_v2');
  assert.deepEqual(schema.schema.required, ['version', 'approved', 'segments']);
  assert.deepEqual(schema.schema.properties.version.enum, [2]);
  const supportSchema = schema.schema.properties.segments.items.properties.claims.items.properties.supports.items;
  assert.deepEqual(supportSchema.required, ['chunkId', 'spanId']);
  assert.equal(supportSchema.additionalProperties, false);
  current.conversation.messages[0].content = 'PRIVATE_LEARNER_STORY';
  const schemaText = JSON.stringify(buildNaturalReviewSchema(current.draft, current));
  assert.doesNotMatch(schemaText, /PRIVATE_LEARNER_STORY|thromboembolism/);
  const data = JSON.parse(buildNaturalReviewPrompt(current.draft, current).split('NATURAL_REVIEW_DATA=')[1]);
  assert.deepEqual(data.sourceSpans, buildNaturalSourceSpans(current));
  const badQuote = structuredClone(current.review); badQuote.segments[0].claims[0].quote = 'PRIVATE_INVENTED_CLAIM';
  assert.throws(() => renderReviewedTutor(current.draft, badQuote, current), error => error.reasonId === 304);
  const hiddenClaim = structuredClone(current.draft); hiddenClaim.segments[0].sourceChunkIds = [];
  assert.throws(() => renderReviewedTutor(hiddenClaim, current.review, current), error => error.reasonId === 304);
  for (const content of ['Give me a hint.', 'Do not reveal the answer.']) assert.throws(() => renderReviewedTutor(current.draft, current.review, { ...current, conversation: { messages: [{ role: 'user', content }] }, pendingQuestion: current.references.quiz(current.evidence).studyQuestion }), error => error.reasonId === 306);
});
