import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeStudyReferences } from '../server/reference-expansion.js';
import { STUDY_CONDITION_FILES, createStudyCurriculum, loadStudyCurriculum } from '../server/study-curriculum.js';
import { studyCondition } from './fixtures/study-condition.js';

const now = Date.parse('2026-10-10T12:00:00Z');
const module = JSON.parse(readFileSync(new URL('../content/reference-expansion/medlineplus-breadth.json', import.meta.url), 'utf8'));
const patch = module.conditions.find(record => record.conditionId === 'asthma');
const sample = () => ({ schemaVersion: 1, checkedAt: module.checkedAt, conditions: [{ conditionId: 'asthma', sources: structuredClone(patch.sources), sections: structuredClone(patch.sections.slice(0, 1)) }] });

test('permitted passages add retrieval while preserving original quiz identity and review dates', () => {
  const original = studyCondition(), supplement = sample();
  const before = structuredClone({ original, supplement });
  const merged = mergeStudyReferences([original], [supplement], { now });
  assert.deepEqual({ original, supplement }, before, 'Inputs remain unchanged.');
  assert.deepEqual(merged[0].questions, original.questions);
  assert.deepEqual(merged[0].review, original.review);
  const initial = createStudyCurriculum({ records: [original], now });
  const expanded = createStudyCurriculum({ records: merged, now });
  assert.deepEqual(expanded.boardQuestions().map(q => [q.key, q.fingerprint]), initial.boardQuestions().map(q => [q.key, q.fingerprint]));
  assert.ok(expanded.get('asthma').chunks.some(chunk => chunk.id === patch.sections[0].id));
  assert.equal(expanded.get('asthma').sources.at(-1).reuse, 'public-domain-text-excerpt');
});

test('catalog URLs, forged rights, vendor encyclopedia and changed provenance cannot authorize import', () => {
  const attempts = [
    value => { value.conditions[0].sources[0].url = 'https://medlineplus.gov/ency/article/000141.htm'; },
    value => { value.conditions[0].sources[0].rights.policyUrl = 'https://example.com/permissions'; },
    value => { value.conditions[0].sources[0].attribution = ''; },
    value => { value.conditions[0].sections[0].text += ' Altered fact.'; },
    value => { value.conditions[0].conditionId = 'invented-condition'; },
    value => { value.conditions[0].sources[0].checkedAt = '2026-11-01'; },
    value => { value.conditions.push(structuredClone(value.conditions[0])); },
  ];
  for (const change of attempts) {
    const input = sample(); change(input);
    assert.throws(() => mergeStudyReferences([studyCondition()], [input], { now }), /Invalid reference expansion/);
  }
});

test('a supplemental passage expiry withholds that passage without renewing or deleting the host bank', () => {
  const original = studyCondition();
  original.review.expiresAt = '2026-11-22'; // Deliberately outside current runtime eligibility; merger never repairs it.
  const merged = mergeStudyReferences([original], [sample()], { now: Date.parse('2026-11-09T00:00:00Z') });
  assert.deepEqual(merged, [original]);
  assert.equal(merged[0].review.expiresAt, '2026-11-22');
});

test('actual supplements are source-linked current text without adding inferred guideline classifications', () => {
  const library = loadStudyCurriculum({ contentDir: new URL('../content/conditions', import.meta.url).pathname, now });
  assert.deepEqual(library.rejected, []);
  const asthma = library.get('asthma');
  const nlm = asthma.sources.find(source => source.url === patch.sources[0].url);
  assert.equal(nlm.kind, 'official-clinical-reference');
  assert.match(nlm.attribution, /MedlinePlus/);
  assert.ok(asthma.chunks.some(chunk => chunk.id.startsWith('medlineplus-')));
});

test('licensed paragraph assemblies require exact spans, document rights and retained credit', () => {
  const licensed = JSON.parse(readFileSync(new URL('../content/reference-expansion/licensed-specialty-passages.json', import.meta.url), 'utf8'));
  const target = licensed.conditions.find(record => record.conditionId === 'type-2-diabetes');
  const section = target.sections.find(item => item.id.startsWith('ada-') && item.sourceSpans.length > 1);
  const source = target.sources.find(item => item.id === section.sourceIds[0]);
  const original = STUDY_CONDITION_FILES.flatMap(name => {
    const file = new URL(`../content/conditions/${name}`, import.meta.url);
    try { return JSON.parse(readFileSync(file, 'utf8')).conditions; } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }).find(record => record.id === target.conditionId);
  const supplement = { schemaVersion: 1, checkedAt: licensed.checkedAt, conditions: [{ conditionId: target.conditionId, sources: [source], sections: [section] }] };
  const merged = mergeStudyReferences([original], [supplement], { now });
  assert.equal(merged[0].sections.at(-1).text, section.sourceSpans.map(span => span.excerpt).join('\n\n'));
  assert.equal(merged[0].sources.at(-1).reuse, 'licensed-text-excerpt');
  assert.ok(merged[0].sources.at(-1).attribution);
  assert.ok(merged[0].sources.at(-1).derivativeNotice);
  for (const change of [
    value => { value.conditions[0].sections[0].sourceSpans.reverse(); },
    value => { value.conditions[0].sections[0].sourceSpans[0].excerpt += ' Unsupported addition.'; },
    value => { value.conditions[0].sections[0].sourceSpans[0].sourceId = 'other-document'; },
    value => { value.conditions[0].sources[0].attribution = ''; },
    value => { value.conditions[0].sources[0].derivativeNotice = ''; },
    value => { value.conditions[0].sources[0].rights.policyUrl = 'https://creativecommons.org/licenses/by-nc/4.0/'; },
  ]) {
    const altered = structuredClone(supplement); change(altered);
    assert.throws(() => mergeStudyReferences([original], [altered], { now }), /Invalid reference expansion/);
  }
});
