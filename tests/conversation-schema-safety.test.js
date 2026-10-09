import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudyCurriculum } from '../server/study-curriculum.js';
import { buildStudyDialogueSchema, buildStudyDialoguePrompt, renderStudyDialogue } from '../server/study-conversation.js';
import { studyCondition, STUDY_NOW } from './fixtures/study-condition.js';

function context() {
  const references = createStudyCurriculum({ records: [studyCondition()], now: () => STUDY_NOW });
  const evidence = references.retrieve('Study asthma inhaler technique');
  const recent = ['PRIVATE-ATTEMPT: A fictional medicine cures everything.', 'x'.repeat(181), 'A multiline\nlearner attempt.', '', 'Study preference four.', 'Study preference five.', 'Study preference six.', 'Please help me reflect.'];
  const conversation = { mode: 'coach', messages: [
    { role: 'user', content: 'OLDER-OUTSIDE-QUOTE-WINDOW' },
    { role: 'assistant', content: 'PRIVATE-ASSISTANT-TEXT is not a learner statement.' },
    ...recent.map(content => ({ role: 'user', content })),
  ] };
  return { references, evidence, conversation, settings: { dailyMinutes: 15, coachStyle: 'socratic', focus: 'exam' }, recent };
}

function plan(learnerQuote) {
  return { chunkIds: ['asthma:management'], questionId: null, unsupported: false, dialogue: { intent: 'reflect', acknowledgment: 'effort', followup: 'name-gap', focusChunkId: 'asthma:management', learnerQuote, minutes: null } };
}

test('compiled tutor schemas contain public source IDs and quote ordinals, never private learner or assistant text', () => {
  const original = context();
  const schema = buildStudyDialogueSchema(original);
  assert.deepEqual(schema.schema.properties.dialogue.properties.learnerQuote, { type: ['integer', 'null'], enum: [null, 0, 4, 5, 6, 7] });
  const encoded = JSON.stringify(schema);
  assert.doesNotMatch(encoded, /PRIVATE-|OLDER-OUTSIDE|Study preference|learner attempt|Please help me reflect/);
  const alternate = structuredClone(original.conversation);
  alternate.messages.filter(message => message.role === 'user').forEach(message => {
    if (message.content && message.content.length <= 180 && !message.content.includes('\n')) message.content = 'A different private learner statement.';
  });
  assert.deepEqual(buildStudyDialogueSchema({ ...original, conversation: alternate }), schema);
  const prompt = buildStudyDialoguePrompt(original);
  const data = JSON.parse(prompt.split('STUDY_DIALOGUE_CONTEXT=')[1]);
  assert.equal(data.recentLearnerTurns[0].index, 0);
  assert.equal(data.recentLearnerTurns[0].content, original.recent[0]);
  assert.equal(data.recentLearnerTurns[1].quoteEligible, false);
  assert.equal(data.recentLearnerTurns[7].index, 7);
});

test('quote ordinals copy exact recent user words while keeping private and unverified statements out of speech', () => {
  const original = context();
  for (const ordinal of [0, 7]) {
    const rendered = renderStudyDialogue(plan(ordinal), original);
    assert.ok(rendered.content.includes(`Your words (unverified learner statement): “${original.recent[ordinal]}”`));
    assert.ok(!rendered.spokenText.includes(original.recent[ordinal]));
    assert.match(rendered.spokenText, /Mock management fact: review inhaler technique/);
    assert.equal(rendered.studyDialogue.learnerQuotePresent, true);
    assert.equal(rendered.studyDialogue.learnerQuote, undefined);
    assert.equal(rendered.canonicalSpokenText, true);
  }
  const legacy = renderStudyDialogue(plan('Please help me reflect.'), original);
  assert.ok(legacy.content.includes('Your words (unverified learner statement)'));
  assert.ok(!legacy.spokenText.includes('Please help me reflect.'));
});

test('runtime rejects missing, out-of-range and ineligible quote ordinals even if a provider violates the strict schema', () => {
  const original = context();
  for (const ordinal of [-1, 8, 999, 0.5, 1, 2, 3]) assert.throws(() => renderStudyDialogue(plan(ordinal), original));
  assert.throws(() => renderStudyDialogue(plan(0), { ...original, conversation: { messages: [] } }));
  assert.throws(() => renderStudyDialogue(plan('OLDER-OUTSIDE-QUOTE-WINDOW'), original));
  assert.throws(() => renderStudyDialogue(plan('PRIVATE-ASSISTANT-TEXT'), original));
});
