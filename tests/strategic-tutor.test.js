import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudyCurriculum } from '../server/study-curriculum.js';
import { buildNaturalTutorPrompt } from '../server/natural-tutor.js';
import { evidencePolicyInstructions } from '../shared/evidence-policy.js';
import { studyCondition, STUDY_NOW } from './fixtures/study-condition.js';

test('strategic tutor instructions preserve optional learning, source limits and the pending-quiz boundary', () => {
  const references = createStudyCurriculum({ records: [studyCondition()], now: () => STUDY_NOW });
  const evidence = references.retrieve('Study asthma');
  const pendingQuestion = references.quiz(evidence).studyQuestion;
  const settings = { coachStyle: 'direct', dailyMinutes: 25, focus: 'exam' };
  for (const [content, pending] of [
    ['I remember the fact but do not understand why it changes the next step.', null],
    ['I am not sure which option to choose. Do not reveal the answer.', pendingQuestion],
    ['I would just like to chat about my day.', null],
  ]) {
    const conversation = { mode: 'coach', messages: [{ role: 'user', content }] };
    const prompt = buildNaturalTutorPrompt({ references, evidence, settings, conversation, pendingQuestion: pending });
    const instructions = prompt.split('\nOUTPUT_SCHEMA=')[0];
    assert.ok(instructions.includes(evidencePolicyInstructions('generator')), 'Canonical grounding instructions must remain intact.');
    assert.match(instructions, /commit to an answer and their reasoning before explaining/);
    assert.match(instructions, /Accept uncertainty, a pass or a request for explanation without pressure/);
    assert.match(instructions, /one useful question at a time/);
    assert.match(instructions, /self-reported recall difficulty.*interpretation confusion.*next-step confusion/);
    assert.match(instructions, /provided sources support both the clue and the comparison/);
    assert.match(instructions, /supports all medical case premises and relationships; do not invent case premises/);
    assert.match(instructions, /Offer a fresh variation only through a server-owned original question/);
    assert.match(instructions, /teach-back, then later retrieval or mixed practice as optional next steps/);
    assert.match(instructions, /do not force questions or exercises on ordinary chat/);
    assert.match(instructions, /Do not invent reasoning scores, validated competence scores or clinical-competence claims/);
    assert.match(instructions, /If an original quiz is pending, do not reveal its answer or give new factual hints until an option is selected or an affirmative reveal is requested/);

    const context = JSON.parse(prompt.split('\nNATURAL_TUTOR_CONTEXT=')[1]);
    assert.equal(context.history.at(-1).content, content);
    assert.equal(context.revealRequested, false);
    assert.deepEqual(context.sources.map(source => [source.key, source.text]), evidence.map(source => [source.key, source.text]));
    if (pending) {
      assert.equal(context.pendingQuestion.key, pending.key);
      assert.equal(context.pendingQuestion.fingerprint, pending.fingerprint);
      for (const secret of ['correctChoiceId', 'explanation', 'rationale', 'distractorExplanations']) {
        assert.equal(Object.hasOwn(context.pendingQuestion, secret), false, `Pending quiz must not expose ${secret}.`);
      }
    } else assert.equal(context.pendingQuestion, null);
  }
});
