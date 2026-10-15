import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudyCurriculum, combineStudyCurricula } from '../server/study-curriculum.js';
import { buildLibraryContext } from '../server/library-context.js';
import { buildNaturalTutorPrompt } from '../server/natural-tutor.js';
import { studyCondition, STUDY_NOW } from './fixtures/study-condition.js';

function fixture(now = () => STUDY_NOW) {
  const references = createStudyCurriculum({ records: [studyCondition()], now });
  return { references, evidence: references.retrieve('Study asthma'), conversation: { mode: 'coach', messages: [{ role: 'user', content: 'Study asthma.' }] },
    settings: { coachStyle: 'direct', dailyMinutes: 15, focus: 'exam' } };
}
const packet = prompt => JSON.parse(prompt.split('NATURAL_TUTOR_CONTEXT=')[1]);

test('loaded library inventory exposes accurate types and publishers without passages or question answers', () => {
  const { references } = fixture();
  const topic = studyCondition({ id: 'learning-principles', name: 'Learning principles', recordType: 'foundation', domain: 'foundations' });
  const foundation = createStudyCurriculum({ records: [topic], now: () => STUDY_NOW });
  const combined = combineStudyCurricula([references, foundation]);
  const inventory = combined.inventory();
  assert.deepEqual(inventory.map(item => [item.id, item.recordType, item.current]), [['asthma', 'condition', true], ['learning-principles', 'foundation', true]]);
  assert.deepEqual(inventory[0].publishers, ['NIH']);
  assert.deepEqual(inventory[0].sourceKinds, ['official-clinical-reference']);
  for (const item of inventory) assert.deepEqual(Object.keys(item).sort(), ['current', 'id', 'publishers', 'recordType', 'sourceKinds', 'title']);
  assert.doesNotMatch(JSON.stringify(inventory), /correctChoiceId|explanation|rationale|choices|questionId|Mock diagnosis fact|asthma-q1/);
  inventory[0].title = 'Changed outside the bank';
  inventory[0].publishers.push('Untrusted publisher');
  assert.equal(combined.inventory()[0].title, 'Asthma');
  assert.deepEqual(combined.inventory()[0].publishers, ['NIH']);
});

test('inventory currency is recomputed while expired records remain discoverable as unavailable', () => {
  let now = STUDY_NOW;
  const { references } = fixture(() => now);
  assert.equal(buildLibraryContext(references).current, 1);
  now = Date.parse('2026-11-10T12:00:00Z');
  const context = buildLibraryContext(references);
  assert.equal(context.total, 1);
  assert.equal(context.current, 0);
  assert.equal(context.topics[0][3], false);
});

test('external directory links are distinct from loaded passages and never forward extra content', () => {
  const { references } = fixture();
  const referenceDirectory = { sources: [{ id: 'publisher-directory', title: 'Additional source collection', organization: 'Publisher', referenceType: 'collection',
    text: 'PRIVATE_EXTERNAL_PASSAGE', correctChoiceId: 'PRIVATE_KEY', questionId: 'PRIVATE_QUESTION' }] };
  const context = buildLibraryContext(references, { referenceDirectory });
  assert.equal(context.scope, 'catalogue-metadata-only');
  assert.equal(context.available, true);
  assert.equal(context.total, 1);
  assert.equal(context.directory.scope, 'external-links-only');
  assert.equal(context.directory.total, 1);
  assert.deepEqual(context.directory.sources, [['publisher-directory', 'Additional source collection', 'collection']]);
  assert.equal(context.directory.contentSupplied, false);
  assert.deepEqual(context.topicColumns, ['id', 'title', 'recordType', 'current']);
  assert.deepEqual(context.directory.columns, ['id', 'title', 'referenceType']);
  assert.doesNotMatch(JSON.stringify(context), /PRIVATE_|correctChoiceId|questionId/);
  const unknown = buildLibraryContext(null, { referenceDirectory });
  assert.equal(unknown.available, false);
  assert.equal(unknown.total, null);
  assert.equal(unknown.directory.available, true);
  assert.equal(unknown.directory.total, 1);
});

test('primary prompt makes library first and preserves the exact supplied current evidence packet', () => {
  const context = fixture();
  const referenceDirectory = { sources: [{ id: 'external-link', title: 'Linked source', organization: 'Publisher', referenceType: 'document' }] };
  const prompt = buildNaturalTutorPrompt({ ...context, referenceDirectory });
  const result = packet(prompt);
  assert.match(prompt, /Library first: Consult the supplied current library passages in sources before formulating any clinical teaching/);
  assert.match(prompt, /A listed topic or directory link does not mean its text was supplied/);
  assert.match(prompt, /do not claim the entire topic or library is unavailable/);
  assert.match(prompt, /only with the exact supplied current passage text and sourceChunkIds/);
  assert.equal(result.library.topics[0][1], 'Asthma');
  assert.equal(result.library.directory.contentSupplied, false);
  for (const source of result.sources) assert.equal(source.text, context.evidence.find(item => item.key === source.key).text);
  assert.equal(result.sources.length, context.evidence.length);
  assert.equal(result.pendingQuestion, null);
  assert.doesNotMatch(JSON.stringify(result.library), /asthma-q1|correctChoiceId|Mock diagnosis fact/);
});

test('catalogue discovery cannot invent passage evidence when retrieval is empty', () => {
  const context = fixture();
  const result = packet(buildNaturalTutorPrompt({ ...context, evidence: [] }));
  assert.equal(result.library.topics[0][0], 'asthma');
  assert.equal(result.library.topics[0][3], true);
  assert.deepEqual(result.sources, []);
});

test('selected-topic starters retrieve current passages without broadening unknown-topic or dose coverage', () => {
  let now = STUDY_NOW;
  const { references } = fixture(() => now);
  for (const request of ['start', 'begin', 'please start', 'teach me', 'review this topic']) {
    const evidence = references.retrieve(request, { conditionIds: ['asthma'] });
    assert.equal(evidence.length, 3, request);
    assert.ok(evidence.every(item => item.conditionId === 'asthma'), request);
  }
  assert.deepEqual(references.retrieve('start'), []);
  assert.deepEqual(references.retrieve('start', { conditionIds: ['not-loaded'] }), []);
  assert.deepEqual(references.retrieve('Study a fictional new syndrome', { conditionIds: ['asthma'] }), []);
  assert.deepEqual(references.retrieve('What insulin dose?', { conditionIds: ['asthma'] }), []);
  now = Date.parse('2026-11-10T12:00:00Z');
  assert.deepEqual(references.retrieve('start', { conditionIds: ['asthma'] }), []);
});
