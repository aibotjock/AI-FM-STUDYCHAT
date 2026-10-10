import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sourceEditorialWordBudget, verifiedStudySourceReuse } from '../shared/source-reuse.js';
import { validateMaintenanceCorpus } from '../scripts/validate-study-curriculum.js';
import { studyCondition } from './fixtures/study-condition.js';

const now = Date.parse('2026-10-10T12:00:00Z');
const foundations = JSON.parse(readFileSync(new URL('../content/board-foundations.json', import.meta.url), 'utf8'));
const source = foundations.conditions[0].sources.find(source => source.rights);

test('exact government document permissions do not extend to other pages or licensed encyclopedia content', () => {
  assert.equal(verifiedStudySourceReuse(source, { now }), true);
  assert.equal(sourceEditorialWordBudget(source, { now }), 2000);
  for (const change of [
    { url: 'https://www.cdc.gov/reproductive-health/glossary/unverified.html' },
    { url: source.url + '?copy=1' },
    { organization: 'Invented publisher' },
    { rights: { ...source.rights, basis: 'cc-by-4.0' } },
    { rights: { ...source.rights, policyUrl: 'https://creativecommons.org/licenses/by/4.0/' } },
    { url: 'https://medlineplus.gov/ency/article/000001.htm' },
  ]) assert.equal(verifiedStudySourceReuse({ ...source, ...change }, { now }), false);
});

test('mixed review dates preserve the oldest file check and reject records older than it', () => {
  const first = studyCondition({ id: 'first' });
  const second = studyCondition({ id: 'second' });
  first.review.checkedAt = '2026-10-09'; second.review.checkedAt = '2026-10-10';
  for (const [i, record] of [first, second].entries()) {
    record.sources[0].url = `https://www.nhlbi.nih.gov/health/date-fixture-${i}`;
    record.questions.forEach((question, j) => { question.stem = `Original date fixture ${i}-${j}: ${question.stem}`; });
  }
  const files = [{ parsed: { checkedAt: '2026-10-09', conditions: [first, second] } }];
  const options = { records: [first, second], files, now, minimumConditions: 2, minimumFormalConditions: 0, minimumCorrectPositionShare: 0 };
  const result = validateMaintenanceCorpus(options);
  assert.equal(result.ok, true, result.problems.join('\n'));
  assert.equal(result.manifest.checkedAt, '2026-10-09');
  files[0].parsed.checkedAt = '2026-10-10';
  assert.ok(validateMaintenanceCorpus(options).problems.some(problem => problem.includes('review precedes envelope')));
  assert.equal(first.review.checkedAt, '2026-10-09');
});

test('a licensed article requires attribution and changes notice and preserves its exact English URL', () => {
  const article = {
    ...source,
    url: 'https://www.scielo.br/j/jbpneu/a/WTTJ9tSyCNfwdPpK33DLV5R/?format=html&lang=en',
    organization: 'Jornal Brasileiro de Pneumologia',
    attribution: 'Synthetic attribution contract fixture; no article authorship assertion.',
    derivativeNotice: 'Original study paraphrase and original questions; not the original article.',
    rights: { ...source.rights, basis: 'cc-by-4.0', policyUrl: 'https://creativecommons.org/licenses/by/4.0/' },
  };
  assert.equal(verifiedStudySourceReuse(article, { now }), true);
  for (const change of [
    { attribution: '' }, { derivativeNotice: '' },
    { url: article.url.replace('lang=en', 'lang=pt') },
    { rights: { ...article.rights, basis: 'public-domain-government' } },
    { rights: { ...article.rights, commercialClinicalApproval: true } },
  ]) assert.equal(verifiedStudySourceReuse({ ...article, ...change }, { now }), false);
});
