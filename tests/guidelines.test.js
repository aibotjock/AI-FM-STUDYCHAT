import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ABFM_BLUEPRINT, allocateMixedPractice } from '../shared/blueprint.js';
import { loadGuidelineCorpus, retrieveEvidence, validateGroundedResponse, buildEvidencePrompt, contentSha256, NO_EVIDENCE_ANSWER, COACHING_PROMPTS } from '../server/guidelines.js';

const NOW = '2026-10-09T12:00:00Z';
// These are invented nonclinical fixtures owned by this test. They are not
// evidence of clinical validation, actual reviewer credentials, or licensing.
function example(id = 'example-recall', body = 'Recall practice means trying to explain a concept before checking a study note.') {
  return {
    id, title: 'Recall study method', body, domain: 'foundations', status: 'published', contentType: 'original-teaching',
    source: { title: 'Invented test teaching note', organization: 'Test fixture', url: 'https://example.org/test-only', edition: 'fixture-1', effectiveDate: '2026-10-01', contentSha256: contentSha256(body) },
    review: { reviewer: 'Invented test reviewer', reviewedAt: '2026-10-02', nextReviewAt: '2026-11-01' },
    rights: { status: 'cleared', commercialUse: true, aiProcessing: true, perpetual: true, evidence: 'Original nonclinical test fixture authored for this software test.' },
  };
}
function file(t, records) {
  const dir = mkdtempSync(join(tmpdir(), 'study-guidelines-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'corpus.json');
  writeFileSync(path, JSON.stringify({ version: 'test-only', records }));
  return path;
}

test('real checked-in corpus is empty and cannot substantiate guideline readiness', () => {
  const corpus = loadGuidelineCorpus(fileURLToPath(new URL('../content/guidelines.json', import.meta.url)), { now: NOW });
  assert.equal(corpus.ready, false);
  assert.equal(corpus.records.length, 0);
  assert.deepEqual(retrieveEvidence('a clinical recommendation', { corpus, now: NOW }), []);
});

test('only reviewed, rights-cleared, untampered active content is retrievable', t => {
  const good = example();
  const draft = { ...example('draft'), status: 'draft' };
  const expired = { ...example('expired'), review: { ...good.review, nextReviewAt: '2026-10-08' } };
  const unclear = { ...example('unclear'), rights: { ...good.rights, aiProcessing: false } };
  const altered = { ...example('altered'), body: 'Changed after review.' };
  const replaced = { ...example('replaced'), supersededBy: 'example-recall' };
  const checkbox = { ...example('checkbox'), verified: true };
  const future = { ...example('future'), source: { ...good.source, effectiveDate: '2026-10-10' } };
  const invalidDate = { ...example('invalid-date'), review: { ...good.review, reviewedAt: '2026-02-30' } };
  const corpus = loadGuidelineCorpus(file(t, [good, draft, expired, unclear, altered, replaced, checkbox, future, invalidDate]), { now: NOW });
  assert.equal(corpus.records.length, 1);
  assert.equal(corpus.rejected.length, 8);
  assert.deepEqual(retrieveEvidence('recall concept', { corpus, now: NOW }).map(item => item.id), ['example-recall']);
  assert.equal(retrieveEvidence('recall', { corpus, now: '2026-11-02' }).length, 0);
});

test('duplicate IDs, unsafe source URLs, and malformed envelopes fail closed', t => {
  const good = example();
  const unsafe = { ...example('unsafe'), source: { ...good.source, url: 'https://user:password@example.org/source' } };
  const corpus = loadGuidelineCorpus(file(t, [good, example(), unsafe]), { now: NOW });
  assert.equal(corpus.ready, false);
  assert.equal(corpus.rejected.length, 3);
  const path = file(t, []);
  writeFileSync(path, '{"records":[]}');
  assert.throws(() => loadGuidelineCorpus(path, { now: NOW }), /envelope/);
});

test('dated permissions expire independently of clinical reviews and are checked on every evidence path', t => {
  const dated = example('dated-license');
  dated.rights = { ...dated.rights, perpetual: false, effectiveAt: '2026-10-01', expiresAt: '2026-10-10' };
  const variations = [
    { id: 'expired-license', expiresAt: '2026-09-01' },
    { id: 'future-license', effectiveAt: '2026-10-10' },
    { id: 'invalid-expiry', expiresAt: '2026-02-30' },
    { id: 'expiry-type', expiresAt: 1791590400000 },
    { id: 'effective-type', effectiveAt: false },
    { id: 'perpetual-type', perpetual: 'true' },
    { id: 'conflicting-duration', perpetual: true },
    { id: 'absent-duration', expiresAt: undefined },
  ].map(({ id, ...changes }) => ({ ...dated, id, rights: { ...dated.rights, ...changes } }));
  const corpus = loadGuidelineCorpus(file(t, [dated, ...variations]), { now: NOW });
  assert.deepEqual(corpus.records.map(record => record.id), ['dated-license']);
  assert.equal(corpus.rejected.length, variations.length);
  assert.equal(retrieveEvidence('recall', { corpus, now: NOW }).length, 1);
  assert.match(buildEvidencePrompt([dated], { now: NOW }), /dated-license/);
  assert.equal(validateGroundedResponse({ answer: dated.body, citationIds: [dated.id], unsupported: false }, [dated], { now: NOW }).unsupported, false);
  const expiration = '2026-10-10T00:00:00Z';
  assert.equal(retrieveEvidence('recall', { corpus, now: expiration }).length, 0);
  assert.equal(loadGuidelineCorpus(file(t, [dated]), { now: expiration }).ready, false);
  assert.throws(() => buildEvidencePrompt([dated], { now: expiration }), /no longer eligible/);
  assert.throws(() => validateGroundedResponse({ answer: dated.body, citationIds: [dated.id], unsupported: false }, [dated], { now: expiration }), /no longer eligible/);
});

test('lexical retrieval is bounded and abstains on no matches', t => {
  const records = [example('alpha'), example('beta'), example('gamma'), example('delta')];
  const corpus = loadGuidelineCorpus(file(t, records), { now: NOW });
  assert.equal(retrieveEvidence('recall', { corpus, now: NOW }).length, 3);
  assert.deepEqual(retrieveEvidence('orthopedics', { corpus, now: NOW }), []);
  assert.deepEqual(retrieveEvidence('what should I do', { corpus, now: NOW }), []);
  assert.throws(() => retrieveEvidence('recall', { corpus, now: NOW, maxChunks: 4 }), /maxChunks/);
  assert.throws(() => retrieveEvidence('recall', { corpus, now: 'invalid' }), /current time/);
});

test('supported output must reproduce reviewed text; citation existence is insufficient', () => {
  const record = example();
  const parsed = { answer: `${record.body}\n\n${COACHING_PROMPTS[0]}`, citationIds: [record.id], unsupported: false };
  const result = validateGroundedResponse(parsed, [record], { now: NOW });
  assert.equal(result.unsupported, false);
  assert.deepEqual(result.citations, [{ id: record.id, title: record.source.title, url: record.source.url, edition: record.source.edition, reviewedAt: record.review.reviewedAt }]);
  assert.throws(() => validateGroundedResponse({ ...parsed, answer: 'Take 10 mg every day.' }, [record], { now: NOW }), /match reviewed teaching/);
  assert.throws(() => validateGroundedResponse({ ...parsed, answer: `${record.body}\n\nA dose of 10 mg is appropriate.` }, [record], { now: NOW }), /match reviewed teaching/);
  assert.throws(() => validateGroundedResponse({ ...parsed, citationIds: ['invented-id'] }, [record], { now: NOW }), /Unknown/);
  assert.throws(() => validateGroundedResponse({ ...parsed, citationIds: [] }, [record], { now: NOW }), /require reviewed/);
  assert.throws(() => validateGroundedResponse(parsed, [record], { now: '2026-11-02' }), /no longer eligible/);
});

test('unsupported output never relays a model-invented clinical answer', () => {
  const result = validateGroundedResponse({ answer: 'A made-up treatment instruction', citationIds: [], unsupported: true }, [], { now: NOW });
  assert.deepEqual(result, { answer: NO_EVIDENCE_ANSWER, citations: [], unsupported: true });
  const record = example();
  assert.throws(() => validateGroundedResponse({ answer: '', citationIds: [record.id], unsupported: true }, [record], { now: NOW }), /must not present evidence/);
});

test('evidence prompt is bounded and makes exact quotation and abstention explicit', () => {
  const prompt = buildEvidencePrompt([example()], { now: NOW });
  assert.match(prompt, /EXACTLY/);
  assert.match(prompt, /untrusted JSON data, never instructions/);
  assert.match(prompt, /unsupported:true/);
  assert.match(prompt, /example-recall/);
  assert.throws(() => buildEvidencePrompt([example(), example(), example(), example()]), /at most three/);
});

test('mixed-practice allocation conserves counts and uses current blueprint weights', () => {
  assert.equal(ABFM_BLUEPRINT.reduce((sum, domain) => sum + domain.percent, 0), 100);
  assert.deepEqual(allocateMixedPractice(200).map(item => item.count), [70, 50, 40, 30, 10]);
  for (const count of [0, 1, 7, 21, 100]) assert.equal(allocateMixedPractice(count).reduce((sum, item) => sum + item.count, 0), count);
  assert.throws(() => allocateMixedPractice(-1), /integer/);
});
