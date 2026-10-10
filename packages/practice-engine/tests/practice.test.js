import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBoardPractice, createQuestionBankCurriculum } from '../index.js';
const bank = JSON.parse(readFileSync(new URL('../../../content/medical-question-bank.json', import.meta.url)));
const epoch = Date.parse('2026-10-10T18:00:00Z');
function setup() {
  let clock = epoch, sequence = 0;
  const curriculum = createQuestionBankCurriculum(bank, { now: () => clock });
  const engine = createBoardPractice({ curricula: [curriculum], now: () => clock, random: () => 0.5, createId: () => `session-${++sequence}` });
  return { engine, curriculum, state: {}, setClock: value => { clock = value; } };
}
test('real bank supports blueprint selection, answer-safe presentation, grading and completed results', () => {
  const { engine, curriculum, state } = setup();
  assert.equal(curriculum.boardQuestions().length, 558);
  let view = engine.start(state, { count: 20 });
  assert.deepEqual(view.allocation.map(x => x.count), [7, 5, 4, 3, 1]);
  assert.equal('correctChoiceId' in view.question, false);
  assert.equal('explanation' in view.question, false);
  const id = view.sessionId;
  for (let index = 0; index < 20; index++) {
    view = engine.view(state, { sessionId: id, index });
    const entry = bank.questions.find(e => e.key === view.question.key);
    engine.answer(state, { sessionId: id, questionKey: entry.key, choiceId: entry.question.correctChoiceId, confidence: 'high' });
  }
  const result = engine.finish(state, { sessionId: id });
  assert.equal(result.correct, 20);
  assert.equal(result.accuracy, 100);
  assert.equal(state.boardPractice.active, null);
  assert.equal(engine.history(state).length, 1);
});
test('answers cannot be changed and expired sources invalidate resumed practice', () => {
  const { engine, state, setClock } = setup();
  const view = engine.start(state, { count: 10, timed: true, timeLimitSeconds: 60 });
  engine.answer(state, { sessionId: view.sessionId, questionKey: view.question.key, choiceId: 'A' });
  assert.throws(() => engine.answer(state, { sessionId: view.sessionId, questionKey: view.question.key, choiceId: 'B' }), { code: 'ANSWER_ALREADY_RECORDED' });
  setClock(epoch + 60000);
  const next = engine.view(state, { sessionId: view.sessionId, index: 1 });
  assert.throws(() => engine.answer(state, { sessionId: view.sessionId, questionKey: next.question.key, choiceId: 'A' }), { code: 'TIME_EXPIRED' });
  setClock(Date.parse('2027-01-01'));
  assert.throws(() => engine.view(state, { sessionId: view.sessionId }), { code: 'CONTENT_CHANGED' });
});
test('adapter owns bank data and imported scores cannot become trusted learning evidence', () => {
  const copy = structuredClone(bank);
  const curriculum = createQuestionBankCurriculum(copy, { now: epoch });
  const first = curriculum.boardQuestions()[0];
  copy.questions[0].question.correctChoiceId = 'Z';
  assert.ok(curriculum.gradeBoardQuestion(first, 'A'));
  const { engine, state } = setup();
  const view = engine.start(state, { count: 10 });
  engine.finish(state, { sessionId: view.sessionId });
  const exported = engine.exportHistory(state);
  const restored = {};
  engine.importHistory(restored, exported);
  assert.equal(engine.history(restored)[0].trusted, false);
});
