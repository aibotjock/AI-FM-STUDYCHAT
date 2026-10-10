import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoardPractice, BoardPracticeError } from '../server/board-practice.js';
import { createStudyCurriculum } from '../server/study-curriculum.js';
import { studyCondition, STUDY_NOW } from './fixtures/study-condition.js';

function fixture({ questionCount = 12 } = {}) {
  let clock = STUDY_NOW;
  let sequence = 0;
  const record = studyCondition();
  record.questions = Array.from({ length: questionCount }, (_, index) => ({ ...structuredClone(record.questions[0]), id: `asthma-q${index + 1}` }));
  const curriculum = createStudyCurriculum({ records: [record], now: () => clock });
  const engine = createBoardPractice({ curricula: [curriculum], now: () => clock, random: () => 0.37, createId: () => `session-${++sequence}` });
  const state = {};
  return { engine, state, record, tick: (duration = 1000) => { clock += duration; }, expire: () => { clock = Date.parse('2026-11-09T00:00:00Z'); } };
}
function targeted(f, choiceId = 'A', confidence) {
  f.tick();
  const started = f.engine.start(f.state, { mode: 'targeted', conditionId: 'asthma', count: 1, feedback: 'immediate' });
  f.engine.answer(f.state, { sessionId: started.sessionId, questionKey: started.question.key, choiceId, confidence });
  f.tick();
  return f.engine.finish(f.state, { sessionId: started.sessionId });
}
const rejects = (action, code) => assert.throws(action, error => error instanceof BoardPracticeError && error.code === code);

test('empty evidence stays unassessed and supplies a teaching sequence without a mastery claim', () => {
  const f = fixture();
  const plan = f.engine.learningPlan(f.state);
  assert.equal(plan.version, 1);
  assert.equal(plan.summary.uniqueQuestions, 0);
  assert.equal(plan.summary.firstExposureCorrect, 0);
  assert.equal(plan.unassessedDomains.length, 5);
  assert.deepEqual(plan.priorities, []);
  assert.deepEqual(plan.steps.map(step => step.id), ['commit', 'correct', 'fresh', 'space', 'mix']);
  assert.equal(plan.officialScore, false);
  assert.doesNotMatch(JSON.stringify(plan), /"(?:accuracy|mastery|correctChoiceId|rationale|feedback)":/);
});

test('confidence is optional, recorded before feedback, validated and immutable on a duplicate answer', () => {
  const f = fixture();
  const started = f.engine.start(f.state, { mode: 'targeted', conditionId: 'asthma', count: 1, feedback: 'end' });
  assert.equal(started.selectedConfidence, null);
  const payload = { sessionId: started.sessionId, questionKey: started.question.key, choiceId: 'A', confidence: 'high' };
  rejects(() => f.engine.answer(f.state, { ...payload, confidence: 'certain' }), 'INVALID_ANSWER');
  const answered = f.engine.answer(f.state, payload);
  assert.equal(answered.feedback, undefined);
  assert.equal(answered.selectedConfidence, 'high');
  assert.deepEqual(f.engine.answer(f.state, { ...payload, confidence: 'low' }), answered);
  rejects(() => f.engine.answer(f.state, { ...payload, choiceId: 'B' }), 'ANSWER_ALREADY_RECORDED');
  assert.equal(f.engine.learningPlan(f.state).summary.uniqueQuestions, 0);
  assert.deepEqual(f.engine.learningPlan(f.state).priorities, []);
  assert.doesNotMatch(JSON.stringify(f.engine.learningPlan(f.state)), /"(?:correctChoiceId|rationale|distractorExplanations)":/);
  const finished = f.engine.finish(f.state, { sessionId: started.sessionId });
  assert.equal(finished.questions[0].selectedConfidence, 'high');
  const plan = f.engine.learningPlan(f.state);
  assert.equal(plan.summary.confidentErrors, 1);
  assert.equal(plan.priorities[0].evidenceLevel, 'limited');
  assert.equal(plan.priorities[0].misses, 1);
  assert.notEqual(plan.priorities[0].questionKey, started.question.key);
  assert.doesNotMatch(JSON.stringify(plan), /"(?:correctChoiceId|rationale|distractorExplanations)":/);
});

test('distinct first-exposure misses produce a stronger provisional priority and canonical regrading ignores stored scores', () => {
  const f = fixture();
  const first = targeted(f, 'A', 'high');
  const second = targeted(f, 'A');
  assert.notEqual(first.questions[0].key, second.questions[0].key);
  f.state.boardPractice.history[0].summary.correct = 999;
  f.state.boardPractice.history[0].summary.domainResults = [{ domain: 'preventive', answered: 999, correct: 999 }];
  let plan = f.engine.learningPlan(f.state);
  assert.equal(plan.summary.firstExposureMisses, 2);
  assert.equal(plan.summary.firstExposureCorrect, 0);
  assert.equal(plan.priorities[0].evidenceLevel, 'repeated-error');
  assert.equal(plan.priorities[0].uniqueQuestions, 2);
  assert.equal(plan.priorities[0].domain, 'chronic');
  targeted(f, 'B', 'medium');
  plan = f.engine.learningPlan(f.state);
  assert.equal(plan.summary.firstExposureCorrect, 1);
  assert.equal(plan.priorities[0].followUpCorrect, true);
  assert.match(plan.priorities[0].reason, /after a delay/);
  assert.equal(plan.unassessedDomains.length, 4);
});

test('a correct memorized repeat does not overwrite first-exposure evidence; skipped review also counts as exposure', () => {
  const f = fixture();
  const first = targeted(f);
  f.tick();
  const session = f.engine.start(f.state, { mode: 'domain', domain: 'chronic', count: 10 });
  const firstKey = first.questions[0].key;
  assert.ok(f.state.boardPractice.active.selection.some(item => item.key === firstKey));
  f.engine.answer(f.state, { sessionId: session.sessionId, questionKey: firstKey, choiceId: 'B', confidence: 'low' });
  f.tick();
  f.engine.finish(f.state, { sessionId: session.sessionId });
  const plan = f.engine.learningPlan(f.state);
  assert.equal(plan.summary.uniqueQuestions, 1);
  assert.equal(plan.summary.firstExposureMisses, 1);
  assert.equal(plan.summary.firstExposureCorrect, 0);
  assert.equal(plan.summary.repeatAttempts, 1);
  const exposed = new Set(f.state.boardPractice.history.flatMap(item => item.selection.map(question => question.key)));
  assert.ok(!exposed.has(plan.priorities[0].questionKey));
  const fresh = f.engine.start(f.state, { mode: 'targeted', conditionId: 'asthma', count: 1 });
  assert.ok(!exposed.has(fresh.question.key));
});

test('targeted practice selects one server-controlled current fresh item, preserves active sessions, and reports exhaustion', () => {
  const f = fixture({ questionCount: 2 });
  const first = targeted(f);
  const second = f.engine.start(f.state, { mode: 'targeted', conditionId: 'asthma', count: 1 });
  assert.notEqual(second.question.key, first.questions[0].key);
  rejects(() => f.engine.start(f.state, { mode: 'targeted', conditionId: 'asthma', count: 1 }), 'SESSION_ACTIVE');
  assert.equal(f.engine.view(f.state).sessionId, second.sessionId);
  assert.equal(f.engine.learningPlan(f.state).priorities[0].questionKey, null);
  f.engine.finish(f.state, { sessionId: second.sessionId });
  rejects(() => f.engine.start(f.state, { mode: 'targeted', conditionId: 'asthma', count: 1 }), 'NO_FRESH_QUESTION');
  assert.equal(f.engine.learningPlan(f.state).priorities[0].questionKey, null);
  for (const options of [{ mode: 'targeted', count: 10, conditionId: 'asthma' }, { mode: 'targeted', count: 1, conditionId: '../asthma' }, { mode: 'targeted', count: 1, conditionId: 'asthma', domain: 'chronic' }, { mode: 'mixed', count: 10, conditionId: 'asthma' }]) rejects(() => f.engine.start(f.state, options), 'INVALID_OPTIONS');
  rejects(() => f.engine.start(f.state, { mode: 'targeted', count: 1, conditionId: 'unavailable' }), 'NO_FRESH_QUESTION');
});

test('imported summaries and restored answer identities cannot affect diagnosis, confidence or fresh selection', () => {
  const f = fixture();
  const completed = targeted(f, 'A', 'high');
  const exported = f.engine.exportHistory(f.state);
  const imported = {};
  f.engine.importHistory(imported, exported);
  assert.equal(f.engine.history(imported)[0].conditionId, 'asthma');
  assert.equal(f.engine.learningPlan(imported).summary.uniqueQuestions, 0);
  assert.equal(f.engine.learningPlan(imported).summary.confidentErrors, 0);
  assert.equal(f.engine.learningPlan(imported).summary.ignoredSessions, 1);
  const restored = {};
  f.engine.sanitizeImport(restored, f.state.boardPractice);
  assert.deepEqual(f.engine.learningPlan(restored).priorities, []);
  assert.equal(restored.boardPractice.history[0].answers, undefined);
  assert.equal(completed.count, 1);
});

test('stale, malformed, future, conflicted and untrusted histories are excluded rather than establishing knowledge', () => {
  const f = fixture();
  targeted(f, 'A', 'high');
  const saved = structuredClone(f.state);
  const changes = [
    state => { state.boardPractice.history[0].trusted = false; },
    state => { state.boardPractice.history[0].selection[0].fingerprint = 'a'.repeat(64); },
    state => { Object.values(state.boardPractice.history[0].answers)[0].confidence = 'invented'; },
    state => { Object.values(state.boardPractice.history[0].answers)[0].answeredAt = STUDY_NOW - 1; },
    state => { state.boardPractice.history[0].completedAt += 100000; },
    state => { state.boardPractice.history[0].selection = {}; },
    state => { state.boardPractice.history.push(structuredClone(state.boardPractice.history[0])); },
    state => { state.boardPractice.history[0].invalidatedAt = STUDY_NOW; }
  ];
  for (const change of changes) {
    const state = structuredClone(saved);
    change(state);
    const plan = f.engine.learningPlan(state);
    assert.equal(plan.summary.uniqueQuestions, 0);
    assert.deepEqual(plan.priorities, []);
    assert.ok(plan.summary.ignoredSessions >= 1);
  }
  f.expire();
  assert.equal(f.engine.learningPlan(saved).summary.uniqueQuestions, 0);
  assert.deepEqual(f.engine.learningPlan(saved).priorities, []);
});

test('weak mode uses first-exposure canonical answers rather than editable summary totals', () => {
  const f = fixture();
  targeted(f, 'A');
  const exported = f.engine.exportHistory(f.state);
  f.state.boardPractice.history[0].summary.domainResults = [{ domain: 'acute', answered: 50, correct: 0 }];
  const weak = f.engine.start(f.state, { mode: 'weak', count: 10 });
  assert.equal(weak.domain, 'chronic');
  const imported = {};
  f.engine.importHistory(imported, exported);
  rejects(() => f.engine.start(imported, { mode: 'weak', count: 10 }), 'NO_HISTORY');
});

test('low-confidence correct responses invite recall reinforcement without being labeled errors', () => {
  const f = fixture();
  targeted(f, 'B', 'low');
  const plan = f.engine.learningPlan(f.state);
  assert.equal(plan.summary.firstExposureMisses, 0);
  assert.equal(plan.summary.lowConfidenceCorrect, 1);
  assert.equal(plan.priorities[0].priorityKind, 'reinforce-recall');
  assert.equal(plan.priorities[0].misses, 0);
  assert.equal(plan.priorities[0].correct, 1);
  assert.equal(plan.priorities[0].evidenceLevel, 'limited');
  assert.match(plan.priorities[0].reason, /not evidence of an error or mastery/);
  assert.match(plan.limitations.join(' '), /last 32/);
  assert.match(plan.limitations.join(' '), /not lifetime novelty/);
});

test('sessions in one clock tick retain chronological first responses independently of session ID ordering', () => {
  const record = studyCondition();
  record.questions = Array.from({ length: 10 }, (_, index) => ({ ...structuredClone(record.questions[0]), id: `asthma-q${index}` }));
  const curriculum = createStudyCurriculum({ records: [record], now: STUDY_NOW });
  const ids = ['z-first', 'a-repeat'];
  const engine = createBoardPractice({ curricula: [curriculum], now: STUDY_NOW, random: () => 0.37, createId: () => ids.shift() });
  const state = {};
  for (const choiceId of ['A', 'B']) {
    const session = engine.start(state, { mode: 'domain', domain: 'chronic', count: 10 });
    engine.answer(state, { sessionId: session.sessionId, questionKey: session.question.key, choiceId });
    engine.finish(state, { sessionId: session.sessionId });
  }
  const plan = engine.learningPlan(state);
  assert.equal(plan.summary.uniqueQuestions, 1);
  assert.equal(plan.summary.firstExposureMisses, 1);
  assert.equal(plan.summary.firstExposureCorrect, 0);
  assert.equal(plan.summary.repeatAttempts, 1);
});
