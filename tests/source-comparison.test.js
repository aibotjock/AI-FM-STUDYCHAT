import test from 'node:test';
import assert from 'node:assert/strict';
import { loadStudyCurriculum } from '../server/study-curriculum.js';
import { buildNaturalSourceSpans, buildNaturalTutorPrompt, buildNaturalReviewPrompt, renderReviewedTutor } from '../server/natural-tutor.js';

test('different current hypertension positions retain separate source context and cannot exchange approval spans', () => {
  const now = Date.parse('2026-10-10T12:00:00Z');
  const references = loadStudyCurriculum({ contentDir: new URL('../content/conditions', import.meta.url).pathname, now });
  const keys = ['hypertension:initial-therapy', 'hypertension:federal-depth-htn-va-dbp-20261010'];
  const pool = [...references.retrieve('hypertension usual treatment goal initial therapy', { maxChunks: 6 }), ...references.retrieve('hypertension diastolic target individuals 30', { maxChunks: 6 })];
  const evidence = keys.map(key => pool.find(item => item.key === key));
  assert.ok(evidence.every(Boolean), 'Both positions must actually be retrieved.');
  const context = { references, evidence, now, requireVersion3: true, settings: {}, conversation: { mode: 'coach', messages: [{ role: 'user', content: 'Compare the supplied hypertension targets for study.' }] } };
  const spans = buildNaturalSourceSpans(context);
  const draft = { segments: evidence.map((item, index) => ({ id: `s${index + 1}`, text: item.text, sourceChunkIds: [item.key] })) };
  const review = { version: 3, approved: true, segments: draft.segments.map(segment => ({ id: segment.id, approved: true, externalFactCount: 1, claims: [{ quote: segment.text, type: 'medical', sourceChunkIds: segment.sourceChunkIds, supports: [{ chunkId: segment.sourceChunkIds[0], spanId: spans.find(span => span.chunkId === segment.sourceChunkIds[0]).spanId }] }], flags: [], questions: [] })) };
  for (const prompt of [buildNaturalTutorPrompt(context), buildNaturalReviewPrompt(draft, context)]) {
    assert.match(prompt, /VA\/DoD/);
    assert.match(prompt, /2026/);
    assert.match(prompt, /differ from the existing AHA\/ACC/);
    assert.match(prompt, /cite both positions/);
  }
  const approved = renderReviewedTutor(draft, review, context);
  assert.ok(approved.citations.some(source => source.id && source.title.includes('VA/DoD')));
  assert.ok(approved.citations.some(source => source.edition.includes('2025')));
  assert.deepEqual(approved.groundingReview.sourceChunkIds, keys);
  const crossed = structuredClone(review);
  crossed.segments[0].claims[0].supports[0].spanId = spans[1].spanId;
  assert.throws(() => renderReviewedTutor(draft, crossed, context), error => error.reasonId === 305);
  const uncertain = structuredClone(review);
  uncertain.segments[1].flags = ['uncertain'];
  assert.throws(() => renderReviewedTutor(draft, uncertain, context), error => error.reasonId === 302);
});
