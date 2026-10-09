import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudyCurriculum } from '../server/study-curriculum.js';
import { buildStudyDialogueSchema, renderStudyDialogue, projectStudyDialoguePlan, studyDialogueRejection } from '../server/study-conversation.js';
import { studyCondition, STUDY_NOW } from './fixtures/study-condition.js';

function context() {
  const second = studyCondition({ id: 'diabetes', name: 'Diabetes', aliases: ['T2DM'] });
  // Same local source ID in two records is valid; their official URLs differ.
  second.sources[0].url = 'https://www.niddk.nih.gov/health-information/diabetes';
  second.sources[0].title = 'A separate official mock teaching reference';
  const references = createStudyCurriculum({ records: [studyCondition(), second], now: () => STUDY_NOW });
  const evidence = references.retrieve('Study asthma and diabetes', { maxChunks: 6 });
  return { references, evidence, conversation: { mode: 'coach', messages: [{ role: 'user', content: 'For board study, show a cited point and one original practice question.' }] }, settings: { coachStyle: 'teach-quiz', dailyMinutes: 15, focus: 'exam' }, medicalRequested: true };
}

function plan(extra = {}) {
  return { chunkIds: ['asthma:management'], questionId: 'diabetes:asthma-q1', unsupported: false, dialogue: { intent: 'explain', acknowledgment: 'none', followup: 'none', focusChunkId: null, learnerQuote: null, minutes: null }, ...extra };
}

test('dual cited text and quiz preserve both source URLs when source IDs are only locally unique', () => {
  const original = context();
  const rendered = renderStudyDialogue(plan(), original);
  assert.deepEqual(rendered.studySelection.chunkIds, ['asthma:management']);
  assert.equal(rendered.studyQuestion.key, 'diabetes:asthma-q1');
  assert.deepEqual(rendered.conditionIds, ['asthma', 'diabetes']);
  assert.match(rendered.content, /Mock management fact: review inhaler technique/);
  assert.match(rendered.content, /Original board-style practice/);
  assert.equal(rendered.citations.length, 2);
  assert.deepEqual(new Set(rendered.citations.map(source => source.url)), new Set(['https://www.nhlbi.nih.gov/health/asthma', 'https://www.niddk.nih.gov/health-information/diabetes']));
  assert.equal(rendered.studyAnswer, undefined);
  assert.ok(!JSON.stringify(rendered).includes('correctChoiceId'));
  assert.equal(original.references.gradeQuestion(rendered.studyQuestion, 'B').studyAnswer.correct, true);
});

test('dual selection cannot use an unprovided or expired question or launder a declared evidence gap', () => {
  const original = context();
  const asthmaOnly = original.evidence.filter(item => item.conditionId === 'asthma');
  assert.throws(() => renderStudyDialogue(plan(), { ...original, evidence: asthmaOnly }), /Unknown or expired practice question/);
  const expired = createStudyCurriculum({ records: [studyCondition(), studyCondition({ id: 'diabetes', name: 'Diabetes' })], now: () => Date.parse('2026-11-10T00:00:00Z') });
  assert.throws(() => renderStudyDialogue(plan(), { ...original, references: expired }), /Unknown or expired practice question/);
  assert.throws(() => renderStudyDialogue(plan({ unsupported: true }), original), /Evidence-gap dialogue cannot claim cited facts/);
  assert.throws(() => renderStudyDialogue(plan({ chunkIds: ['PRIVATE-UNKNOWN-CHUNK'] }), original), /Unknown selected study reference/);
});

test('failure projections retain only eligible public identifiers and bounded diagnostics, never private model prose', () => {
  const original = context();
  const failed = plan({ chunkIds: ['asthma:management', 'PRIVATE-UNKNOWN-CHUNK', { secret: 'PRIVATE-OBJECT' }], questionId: 'PRIVATE-UNKNOWN-QUESTION', answer: 'PRIVATE-UNSOURCED-ANSWER' });
  failed.dialogue = { intent: 'explain', acknowledgment: 'PRIVATE-ACKNOWLEDGMENT', followup: 'name-gap', focusChunkId: 'PRIVATE-UNKNOWN-FOCUS', learnerQuote: 'PRIVATE-LEARNER-QUOTE', minutes: 999, freeText: 'PRIVATE-COACH-ANSWER' };
  const projected = projectStudyDialoguePlan(failed, original);
  assert.deepEqual(projected.chunkIds, ['asthma:management']);
  assert.equal(projected.chunkCount, 3);
  assert.equal(projected.unknownChunkCount, 2);
  assert.equal(projected.questionId, null);
  assert.equal(projected.unknownQuestion, true);
  assert.deepEqual(projected.dialogue, { intent: 'explain', acknowledgment: null, followup: 'name-gap', focusChunkId: null, learnerQuotePosition: null, minutes: null });
  assert.doesNotMatch(JSON.stringify(projected), /PRIVATE-|freeText|answer|secret/);
  assert.deepEqual(projectStudyDialoguePlan('PRIVATE-NONOBJECT', original), { parseableObject: false });
  assert.deepEqual(studyDialogueRejection(new Error('PRIVATE-ERROR-CONTENT')), { code: 'invalid_dialogue_plan', reasonId: 399 });
  assert.deepEqual(studyDialogueRejection(new SyntaxError('PRIVATE-JSON-CONTENT')), { code: 'invalid_json', reasonId: 100 });
  assert.deepEqual(studyDialogueRejection(new Error('Unknown selected study reference.')), { code: 'invalid_dialogue_plan', reasonId: 302 });
});
