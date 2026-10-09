import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStudyCurriculum, validateStudyCondition, officialStudySourceUrl, loadStudyCurriculum, STUDY_NO_EVIDENCE } from '../server/study-curriculum.js';
import { studyCondition, STUDY_NOW } from './fixtures/study-condition.js';

test('study source URL allowlist rejects spoofing, credentials, non-HTTPS and unrelated hosts', () => {
  for (const url of ['http://cdc.gov/ref', 'https://cdc.gov.evil.example/ref', 'https://u:p@cdc.gov/ref', 'https://cdc.gov:8443/ref', 'javascript:alert(1)', 'https://random.example/ref']) assert.equal(officialStudySourceUrl(url), false);
  for (const url of ['https://www.cdc.gov/ref', 'https://www.nhlbi.nih.gov/health/asthma', 'https://ginasthma.org/guidelines/']) assert.equal(officialStudySourceUrl(url), true);
});

test('source verification is separate from clinician review and all graded facts need references', () => {
  assert.deepEqual(validateStudyCondition(studyCondition(), { now: STUDY_NOW }), []);
  for (const mutate of [
    record => { record.review.humanReviewed = true; },
    record => { record.sections[0].sourceIds = ['fabricated']; },
    record => { record.questions[0].sectionIds = ['missing']; },
    record => { delete record.questions[0].distractorExplanations.A; },
    record => { record.review.checkedAt = '2026-02-30'; },
    record => { record.sources[0].status = 'blocked'; },
    record => { record.status = 'unresolved-conflict'; }
  ]) { const record = studyCondition(); mutate(record); assert.ok(validateStudyCondition(record, { now: STUDY_NOW }).length); }
});

test('duplicate and malformed records are rejected without granting clinical coverage', () => {
  const rejected = createStudyCurriculum({ records: [studyCondition(), studyCondition()], now: () => STUDY_NOW });
  assert.equal(rejected.count, 0);
  assert.equal(rejected.rejected.length, 2);
  const malformed = createStudyCurriculum({ records: [{ id: 'bad', sections: {} }], now: () => STUDY_NOW });
  assert.equal(malformed.count, 0);
  assert.throws(() => createStudyCurriculum({ records: Array(501).fill(studyCondition()) }), /at most 500/);
});

test('ranked retrieval uses title aliases and section relevance without incidental-word coverage', () => {
  const service = createStudyCurriculum({ records: [studyCondition()], now: () => STUDY_NOW });
  const found = service.retrieve('What should I review about inhaler technique for bronchial asthma?');
  assert.equal(found[0].key, 'asthma:management');
  assert.equal(service.retrieve('inhaler technique for an unrelated condition').length, 0);
  assert.equal(service.retrieve('How?', { previousQueries: ['Study bronchial asthma'] }).length, 3);
  assert.equal(service.retrieve('A condition not in the library', { conditionIds: ['asthma'] }).length, 0);
  assert.equal(service.list({ q: 'asthma' }).matched, 1);
  assert.equal(service.list({ domain: 'preventive' }).matched, 0);
});

test('named subtype suppresses the broad alias without matching similar unrelated names', () => {
  const broad = studyCondition({ id: 'copd', name: 'COPD', aliases: ['chronic obstructive pulmonary disease'] });
  const narrow = studyCondition({ id: 'copd-exacerbation', name: 'COPD exacerbation', aliases: ['AECOPD'] });
  const service = createStudyCurriculum({ records: [broad, narrow], now: () => STUDY_NOW });
  assert.deepEqual([...new Set(service.retrieve('Study COPD exacerbation').map(item => item.conditionId))], ['copd-exacerbation']);
  assert.equal(service.retrieve('Study asthma-like cough').length, 0);
});

test('a newly named condition overrides linked conversation context and unsupported dosing abstains', () => {
  const service = createStudyCurriculum({ records: [studyCondition(), studyCondition({ id: 'diabetes', name: 'Diabetes', aliases: ['T2DM'] })], now: () => STUDY_NOW });
  assert.deepEqual([...new Set(service.retrieve('Study diabetes', { conditionIds: ['asthma'] }).map(item => item.conditionId))], ['diabetes']);
  assert.equal(service.retrieve('What insulin dose?', { conditionIds: ['asthma'] }).length, 0);
  assert.equal(service.retrieve('What insulin dose for diabetes?', { conditionIds: ['asthma'] }).length, 0);
});

test('monthly expiry removes RAG eligibility and source-linked cards remain explicitly unreviewed', () => {
  let now = STUDY_NOW;
  const service = createStudyCurriculum({ records: [studyCondition()], now: () => now });
  const card = service.card('asthma', 'asthma-q1');
  assert.equal(card.verified, false);
  assert.equal(card.humanReview, false);
  assert.match(card.front, /A\. Mock alternative/);
  now = Date.parse('2026-11-09T00:00:00Z');
  assert.equal(service.get('asthma').current, false);
  assert.equal(service.retrieve('asthma').length, 0);
  assert.equal(service.answer('asthma', 'asthma-q1', 'B').current, false);
});

test('condition detail omits answers and evaluation returns canonical answer with official links', () => {
  const service = createStudyCurriculum({ records: [studyCondition()], now: () => STUDY_NOW });
  const detail = service.get('asthma');
  assert.equal(detail.formalGuideline, false);
  assert.equal(detail.sources[0].kind, 'official-clinical-reference');
  assert.equal(JSON.stringify(detail).includes('correctChoiceId'), false);
  assert.equal(JSON.stringify(detail).includes('distractorExplanations'), false);
  const answer = service.answer('asthma', 'asthma-q1', 'A');
  assert.equal(answer.correct, false);
  assert.equal(answer.correctChoiceId, 'B');
  assert.equal(answer.sources[0].url, 'https://www.nhlbi.nih.gov/health/asthma');
  assert.equal(service.answer('asthma', 'asthma-q1', 'Z'), null);
});

test('RAG renders canonical source text and rejects fabricated bodies, citation IDs and malformed selections', () => {
  const service = createStudyCurriculum({ records: [studyCondition()], now: () => STUDY_NOW });
  const evidence = service.retrieve('asthma inhaler technique');
  const selection = { chunkIds: ['asthma:management'], questionId: null, unsupported: false };
  const forged = evidence.map(item => ({ ...item, text: 'Invented dose.', citations: [{ url: 'https://evil.example' }] }));
  const answer = service.render(selection, forged);
  assert.match(answer.content, /review inhaler technique/);
  assert.equal(answer.content.includes('Invented'), false);
  assert.equal(answer.citations[0].url, 'https://www.nhlbi.nih.gov/health/asthma');
  for (const input of [{ ...selection, answer: 'invented' }, { ...selection, chunkIds: ['asthma:missing'] }, { ...selection, chunkIds: ['asthma:management', 'asthma:management'] }, { ...selection, unsupported: true }]) assert.throws(() => service.render(input, evidence));
  assert.equal(service.render({ chunkIds: [], questionId: null, unsupported: true }, evidence).content, STUDY_NO_EVIDENCE);
});

test('quiz selection presents a canonical original question without leaking its answer', () => {
  const service = createStudyCurriculum({ records: [studyCondition()], now: () => STUDY_NOW });
  const evidence = service.retrieve('asthma');
  const answer = service.render({ chunkIds: [], questionId: 'asthma:asthma-q1', unsupported: false }, evidence);
  assert.match(answer.content, /Fictional study vignette/);
  assert.equal(answer.content.includes('explicitly supports'), false);
  assert.throws(() => service.render({ chunkIds: [], questionId: 'missing:q1', unsupported: false }, evidence));
  assert.equal(service.prompt(evidence).includes('distractorExplanations'), false);
});

test('loader reads bounded fixed filenames and validates JSON envelope before processing', t => {
  const dir = mkdtempSync(join(tmpdir(), 'study-corpus-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'unused'));
  writeFileSync(join(dir, 'ignore.json'), 'invalid but not a corpus file');
  const path = join(dir, 'cardiometabolic.json');
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, checkedAt: '2026-10-09', conditions: [studyCondition()] }));
  assert.equal(loadStudyCurriculum({ contentDir: dir, now: () => STUDY_NOW }).count, 1);
  writeFileSync(path, ' '.repeat(2 * 1024 * 1024 + 1));
  assert.throws(() => loadStudyCurriculum({ contentDir: dir }), /bounded file limits/);
  writeFileSync(path, JSON.stringify({ schemaVersion: 9, checkedAt: '2026-10-09', conditions: [] }));
  assert.throws(() => loadStudyCurriculum({ contentDir: dir }), /envelope/);
});

test('future source checks cannot grant eligibility and excessive citations cannot break backup limits', () => {
  const future = studyCondition();
  future.review.checkedAt = '2026-10-10';
  assert.ok(validateStudyCondition(future, { now: STUDY_NOW }).length);
  const one = studyCondition();
  one.sources = Array.from({ length: 6 }, (_, index) => ({ ...one.sources[0], id: `source-${index}` }));
  one.sections.forEach(section => { section.sourceIds = one.sources.map(source => source.id); });
  one.questions.forEach(question => { question.sourceIds = [one.sources[0].id]; });
  const two = { ...structuredClone(one), id: 'diabetes', name: 'Diabetes', aliases: [] };
  const service = createStudyCurriculum({ records: [one, two], now: () => STUDY_NOW });
  const evidence = service.retrieve('Study asthma and diabetes', { maxChunks: 6 });
  assert.throws(() => service.render({ chunkIds: ['asthma:diagnosis', 'diabetes:diagnosis'], questionId: null, unsupported: false }, evidence), /reference limit/);
});

test('official CDN exception permits only the exact verified guideline URL', () => {
  const exact = 'https://assets.contentstack.io/v3/assets/bltee37abb6b278ab2c/blt04d52e3b6ff5112f/632cab5b258fb55f6b2186af/gout-guideline-2020.pdf';
  assert.equal(officialStudySourceUrl(exact), true);
  for (const url of [exact + '?another=1', exact.replace('gout-guideline-2020.pdf', 'fake.pdf'), 'https://assets.contentstack.io/arbitrary-guideline.pdf', 'https://assets.contentstack.io.evil.example/arbitrary.pdf']) assert.equal(officialStudySourceUrl(url), false);
  for (const host of ['hematology.org', 'aaaai.org', 'hiv.gov', 'menopause.org', 'asccp.org', 'medconnection.ucsfbenioffchildrens.org', 'internationalguideline.com', 'ameriburn.org']) assert.equal(officialStudySourceUrl(`https://${host}/official-reference`), true);
});

test('supplementary DKA and kidney-stone official hosts do not trust lookalike domains', () => {
  for (const host of ['abcd.care', 'cariguidelines.org']) {
    assert.equal(officialStudySourceUrl(`https://${host}/official-guideline`), true);
    assert.equal(officialStudySourceUrl(`https://${host}.evil.example/official-guideline`), false);
  }
});

test('verified society journal hosts do not confer trust to unrelated Wiley journals', () => {
  for (const host of ['medlineplus.gov', 'alz-journals.onlinelibrary.wiley.com', 'agsjournals.onlinelibrary.wiley.com', 'acrjournals.onlinelibrary.wiley.com']) {
    assert.equal(officialStudySourceUrl(`https://${host}/verified-reference`), true);
    assert.equal(officialStudySourceUrl(`https://${host}.evil.example/verified-reference`), false);
  }
  for (const host of ['unrelated.onlinelibrary.wiley.com', 'arbitrary.alz-journals.onlinelibrary.wiley.com', 'onlinelibrary.wiley.com', 'wiley.com']) assert.equal(officialStudySourceUrl(`https://${host}/unrelated-reference`), false);
});

test('loader includes the additional common-condition file without opening arbitrary filenames', t => {
  const dir = mkdtempSync(join(tmpdir(), 'study-additions-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'common_additions.json'), JSON.stringify({ schemaVersion: 1, checkedAt: '2026-10-09', conditions: [studyCondition()] }));
  writeFileSync(join(dir, 'unrecognized_additions.json'), 'invalid ignored data');
  const service = loadStudyCurriculum({ contentDir: dir, now: () => STUDY_NOW });
  assert.equal(service.count, 1);
  assert.deepEqual(service.rejected, []);
});
