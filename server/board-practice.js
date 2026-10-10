import { randomUUID } from 'node:crypto';
import { ABFM_BLUEPRINT, BLUEPRINT_VERSION, allocateMixedPractice } from '../shared/blueprint.js';
import { STUDY_DISCLAIMER } from './study-curriculum.js';
import { buildBoardAlignment } from './board-alignment.js';
import { buildLearningPlan } from './learning-strategy.js';

export const BOARD_PRACTICE_SIZES = Object.freeze([10, 20, 40, 80, 100]);
export const BOARD_PRACTICE_HISTORY_LIMIT = 32;
const DOMAINS = new Set(ABFM_BLUEPRINT.map(item => item.id));
const CHOICE = /^[A-E]$/;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}:[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const FINGERPRINT = /^[a-f0-9]{64}$/;
const MODES = new Set(['mixed', 'domain', 'missed', 'weak', 'targeted']);
const CONFIDENCE = new Set(['low', 'medium', 'high']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = value => structuredClone(value);
const own = (value, key) => Object.hasOwn(value, key);
const validTime = value => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 100 && /^[A-Za-z0-9._-]+$/.test(value);
const validCount = (mode, count) => mode === 'targeted' ? count === 1 : BOARD_PRACTICE_SIZES.includes(count);
const validConfidence = value => value === undefined || value === null || CONFIDENCE.has(value);

export class BoardPracticeError extends Error {
  constructor(code, message, { status = 400, ...details } = {}) {
    super(message);
    this.name = 'BoardPracticeError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
function fail(code, message, details) { throw new BoardPracticeError(code, message, details); }
function stateContainer(state) {
  if (!object(state)) throw new TypeError('Board practice requires an application state object.');
  if (!object(state.boardPractice) || state.boardPractice.schemaVersion !== 1) state.boardPractice = { schemaVersion: 1, active: null, history: [] };
  const container = state.boardPractice;
  if (!Array.isArray(container.history) || container.history.length > BOARD_PRACTICE_HISTORY_LIMIT) fail('INVALID_STATE', 'The practice history is invalid. Restore a validated history backup.', { status: 409 });
  if (container.active !== null && container.active !== undefined && !object(container.active)) fail('INVALID_STATE', 'The saved practice session is invalid. Restart practice.', { status: 409 });
  return container;
}
function publicQuestion(question) {
  return { key: question.key, conditionId: question.conditionId, questionId: question.questionId, conditionTitle: question.conditionTitle, domain: question.domain, stem: question.stem, choices: question.choices.map(choice => ({ id: choice.id, text: choice.text })), checkedAt: question.checkedAt, expiresAt: question.expiresAt };
}
function validQuestion(question) {
  return object(question) && KEY.test(question.key || '') && FINGERPRINT.test(question.fingerprint || '') && DOMAINS.has(question.domain) && question.current === true && typeof question.stem === 'string' && question.stem.length <= 2000 && Array.isArray(question.choices) && question.choices.length === 5 && new Set(question.choices.map(choice => choice.id)).size === 5 && question.choices.every(choice => CHOICE.test(choice.id || '') && typeof choice.text === 'string' && choice.text.length <= 600);
}
function shuffle(items, random) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const value = random();
    if (!(typeof value === 'number' && value >= 0 && value < 1)) throw new TypeError('Practice random generator must return a number from zero up to one.');
    const target = Math.floor(value * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
}
function accuracy(correct, answered) { return answered ? Math.round(correct / answered * 10000) / 100 : null; }
function summaryView(session) {
  return { sessionId: session.id, mode: session.mode, domain: session.domain || null, conditionId: session.conditionId || null, count: session.count, total: session.count, timed: session.timed, feedback: session.feedback, createdAt: session.createdAt, completedAt: session.completedAt, status: 'completed', ...clone(session.summary), trusted: session.trusted !== false, imported: session.trusted === false, officialScore: false, blueprintVersion: session.blueprintVersion, disclaimer: STUDY_DISCLAIMER };
}

/** Local, source-linked study practice. This engine does not call any AI provider. */
export function createBoardPractice({ curricula = [], now = Date.now, random = Math.random, createId = randomUUID } = {}) {
  if (!Array.isArray(curricula) || curricula.length > 8 || curricula.some(curriculum => !curriculum || typeof curriculum.boardQuestions !== 'function' || typeof curriculum.gradeBoardQuestion !== 'function')) throw new TypeError('Use validated curricula with canonical board-question helpers.');
  function time() {
    const value = typeof now === 'function' ? now() : now;
    if (!validTime(value)) throw new TypeError('Use a valid board practice clock.');
    return value;
  }
  function pool() {
    const questions = new Map();
    for (const curriculum of curricula) {
      const supplied = curriculum.boardQuestions();
      if (!Array.isArray(supplied) || supplied.length > 6000) throw new Error('Board question pool exceeds its bounds.');
      for (const question of supplied) {
        if (!validQuestion(question)) throw new Error('Board question pool contains an invalid question.');
        if (questions.has(question.key)) throw new Error('Board question identities must be unique across curricula.');
        questions.set(question.key, { ...clone(question), curriculum });
      }
    }
    return questions;
  }
  function catalog() {
    const questions = [...pool().values()];
    const alignment = buildBoardAlignment(questions, { includeCrosswalk: false });
    const domains = ABFM_BLUEPRINT.map(domain => ({ ...domain, available: alignment.domains.find(item => item.domain === domain.id).availableQuestions }));
    const sizes = BOARD_PRACTICE_SIZES.map(count => {
      const allocation = allocateMixedPractice(count);
      const gaps = allocation.filter(item => item.count > domains.find(domain => domain.id === item.domain).available).map(item => ({ domain: item.domain, required: item.count, available: domains.find(domain => domain.id === item.domain).available, shortfall: item.count - domains.find(domain => domain.id === item.domain).available }));
      return { count, available: gaps.length === 0, allocation, gaps };
    });
    return { questionCount: questions.length, domains, sizes, availableSizes: sizes.filter(size => size.available).map(size => size.count), alignment, blueprintVersion: BLUEPRINT_VERSION, officialScore: false, purpose: 'Independent family medicine board study only; practice timing and accuracy are not official exam scores or readiness predictions.', disclaimer: STUDY_DISCLAIMER };
  }
  function alignment() { return buildBoardAlignment([...pool().values()]); }
  function validSession(session) {
    return object(session) && validId(session.id) && MODES.has(session.mode) && validCount(session.mode, session.count) && (session.mode !== 'targeted' || validId(session.conditionId)) && typeof session.timed === 'boolean' && ['immediate', 'end'].includes(session.feedback) && validTime(session.createdAt) && (!session.timed || Number.isInteger(session.timeLimitSeconds) && session.timeLimitSeconds >= 60 && session.timeLimitSeconds <= 14400) && Array.isArray(session.selection) && session.selection.length === session.count && new Set(session.selection.map(item => item?.key)).size === session.count && session.selection.every(item => object(item) && KEY.test(item.key || '') && FINGERPRINT.test(item.fingerprint || '') && (session.mode !== 'targeted' || item.key.startsWith(`${session.conditionId}:`))) && object(session.answers) && Object.keys(session.answers).length <= session.count && Object.entries(session.answers).every(([key, answer]) => session.selection.some(item => item.key === key) && object(answer) && CHOICE.test(answer.choiceId || '') && validTime(answer.answeredAt) && validConfidence(answer.confidence));
  }
  function checkedSession(state, sessionId, { completed = false } = {}) {
    const container = stateContainer(state);
    const session = container.active && (!sessionId || container.active.id === sessionId) ? container.active : completed ? container.history.find(item => item.id === sessionId && item.trusted !== false) : null;
    if (!session) fail('SESSION_NOT_FOUND', 'That study session is unavailable.', { status: 404 });
    if (!validSession(session)) fail('INVALID_STATE', 'The saved practice session is invalid. Restart practice.', { status: 409 });
    const questions = pool();
    const changed = session.selection.filter(identity => questions.get(identity.key)?.fingerprint !== identity.fingerprint).map(identity => identity.key);
    if (changed.length) {
      if (container.active?.id === session.id) container.active.invalidatedAt = time();
      fail('CONTENT_CHANGED', 'A question changed or its source check expired. Restart practice to use current source-linked questions. Saved historical scores do not establish current knowledge.', { status: 409, questionKeys: changed });
    }
    return { container, session, questions };
  }
  function canonicalGrade(question, choiceId) {
    const graded = question.curriculum.gradeBoardQuestion({ key: question.key, fingerprint: question.fingerprint }, choiceId);
    if (!graded || graded.current !== true || graded.fingerprint !== question.fingerprint || typeof graded.correct !== 'boolean' || !CHOICE.test(graded.correctChoiceId || '')) fail('CONTENT_CHANGED', 'The question is no longer eligible for source-linked grading. Restart practice.', { status: 409 });
    return clone(graded);
  }
  function completedResults(session, questions) {
    const items = session.selection.map(identity => {
      const question = questions.get(identity.key);
      const answer = session.answers[identity.key];
      // A skipped question still has a canonical rationale, shown only in finished review.
      const feedback = canonicalGrade(question, answer?.choiceId || 'A');
      if (!answer) feedback.correct = false;
      return { ...publicQuestion(question), selectedChoiceId: answer?.choiceId || null, selectedConfidence: answer?.confidence || null, answered: Boolean(answer), feedback };
    });
    const domainResults = ABFM_BLUEPRINT.map(domain => {
      const selected = items.filter(item => item.domain === domain.id);
      const answered = selected.filter(item => item.answered).length;
      const correct = selected.filter(item => item.answered && item.feedback.correct).length;
      return { domain: domain.id, title: domain.title, total: selected.length, answered, correct, skipped: selected.length - answered, accuracy: accuracy(correct, answered) };
    });
    const answered = items.filter(item => item.answered).length;
    const correct = items.filter(item => item.answered && item.feedback.correct).length;
    return { sessionId: session.id, status: 'completed', mode: session.mode, domain: session.domain || null, conditionId: session.conditionId || null, total: session.count, count: session.count, answered, correct, skipped: session.count - answered, accuracy: accuracy(correct, answered), completionPercent: Math.round(answered / session.count * 10000) / 100, domainResults, questions: items, missedQuestionKeys: items.filter(item => !item.answered || !item.feedback.correct).map(item => item.key), timed: session.timed, createdAt: session.createdAt, completedAt: session.completedAt, trusted: true, officialScore: false, blueprintVersion: session.blueprintVersion, scoreMeaning: 'Accuracy describes answered questions in this practice session only. It is not an ABFM score, passing prediction, clinical competence assessment, or guarantee of complete exam coverage.', disclaimer: STUDY_DISCLAIMER };
  }
  function view(state, { sessionId, index } = {}) {
    const container = stateContainer(state);
    if (!sessionId && !container.active) return null;
    const { session, questions } = checkedSession(state, sessionId, { completed: true });
    if (session.completedAt !== undefined) return completedResults(session, questions);
    let position = index;
    if (position === undefined) {
      position = session.selection.findIndex(identity => !own(session.answers, identity.key));
      if (position < 0) position = session.count - 1;
    }
    if (!Number.isInteger(position) || position < 0 || position >= session.count) fail('INVALID_INDEX', 'Select a valid practice question position.');
    const identity = session.selection[position];
    const question = questions.get(identity.key);
    const answer = session.answers[identity.key];
    const remainingSeconds = session.timed ? Math.max(0, Math.ceil((session.createdAt + session.timeLimitSeconds * 1000 - time()) / 1000)) : null;
    return { sessionId: session.id, status: 'active', mode: session.mode, domain: session.domain || null, conditionId: session.conditionId || null, count: session.count, position, answeredCount: Object.keys(session.answers).length, remaining: session.count - Object.keys(session.answers).length, createdAt: session.createdAt, timed: session.timed, timeLimitSeconds: session.timed ? session.timeLimitSeconds : null, remainingSeconds, timeExpired: session.timed && remainingSeconds === 0, feedbackMode: session.feedback, allocation: clone(session.allocation), question: publicQuestion(question), selectedChoiceId: answer?.choiceId || null, selectedConfidence: answer?.confidence || null, ...(answer && session.feedback === 'immediate' ? { feedback: canonicalGrade(question, answer.choiceId) } : {}), officialScore: false, blueprintVersion: session.blueprintVersion, disclaimer: STUDY_DISCLAIMER };
  }
  function learningEvidence(container, questions) {
    const observedAt = time();
    const ids = new Map();
    for (const session of container.history) if (object(session)) ids.set(session.id, (ids.get(session.id) || 0) + 1);
    const sessions = [];
    let ignoredSessions = 0;
    let ignoredQuestions = 0;
    for (const [historyIndex, session] of container.history.entries()) {
      if (session?.trusted !== true || !validSession(session) || ids.get(session.id) !== 1 || !validTime(session.completedAt) || session.completedAt < session.createdAt || session.completedAt > observedAt || session.invalidatedAt !== undefined || Object.values(session.answers).some(answer => answer.answeredAt < session.createdAt || answer.answeredAt > session.completedAt || session.timed && answer.answeredAt >= session.createdAt + session.timeLimitSeconds * 1000)) {
        ignoredSessions++;
        continue;
      }
      const selection = [];
      for (const identity of session.selection) {
        const question = questions.get(identity.key);
        if (!question || question.fingerprint !== identity.fingerprint || session.mode === 'targeted' && question.conditionId !== session.conditionId) {
          ignoredQuestions++;
          continue;
        }
        const answer = session.answers[identity.key];
        let correct = null;
        if (answer) {
          try { correct = canonicalGrade(question, answer.choiceId).correct; }
          catch (error) {
            if (error?.code !== 'CONTENT_CHANGED') throw error;
            ignoredQuestions++;
            continue;
          }
        }
        selection.push({ question, answer, correct });
      }
      if (selection.length) sessions.push({ session, selection, historyIndex });
      else ignoredSessions++;
    }
    // History is stored newest first. Keep that chronology for sessions that
    // finish within the same clock tick; random IDs carry no timing evidence.
    sessions.sort((a, b) => a.session.createdAt - b.session.createdAt || a.session.completedAt - b.session.completedAt || b.historyIndex - a.historyIndex);
    const exposedKeys = new Set();
    const attempts = [];
    for (const { session, selection } of sessions) {
      for (const { question, answer, correct } of selection) {
        if (answer) attempts.push({ key: question.key, conditionId: question.conditionId, title: question.conditionTitle, domain: question.domain, correct, confidence: answer.confidence || null, firstExposure: !exposedKeys.has(question.key), answeredAt: answer.answeredAt, sessionId: session.id });
        // Finished review exposes even skipped questions. A later answer is a
        // repeat exposure, while a skip supplies no evidence of knowledge.
        exposedKeys.add(question.key);
      }
    }
    return { sessions, attempts, exposedKeys, ignoredSessions, ignoredQuestions };
  }
  function learningPlan(state) {
    const container = stateContainer(state);
    const questions = pool();
    const evidence = learningEvidence(container, questions);
    const activeKeys = new Set(validSession(container.active) ? container.active.selection.filter(identity => questions.get(identity.key)?.fingerprint === identity.fingerprint).map(identity => identity.key) : []);
    return buildLearningPlan({ evidence, questions: [...questions.values()], activeKeys, blueprint: ABFM_BLUEPRINT, historyLimit: BOARD_PRACTICE_HISTORY_LIMIT });
  }
  function missedKeys(container, questions) {
    const missed = new Set();
    const latest = new Map();
    for (const { session, selection } of learningEvidence(container, questions).sessions) {
      for (const { question, answer, correct } of selection) {
        const existing = latest.get(question.key);
        if (!existing || session.completedAt >= existing.completedAt) latest.set(question.key, { answer, correct, completedAt: session.completedAt });
      }
    }
    for (const [key, entry] of latest) if (!entry.answer || !entry.correct) missed.add(key);
    return missed;
  }
  function weakestDomain(container, questions) {
    const totals = new Map(ABFM_BLUEPRINT.map(domain => [domain.id, { answered: 0, correct: 0 }]));
    for (const result of learningEvidence(container, questions).attempts.filter(attempt => attempt.firstExposure)) {
      const domain = totals.get(result.domain);
      if (domain) { domain.answered++; if (result.correct) domain.correct++; }
    }
    return [...totals].filter(([, total]) => total.answered > 0).sort((a, b) => a[1].correct / a[1].answered - b[1].correct / b[1].answered || ABFM_BLUEPRINT.findIndex(domain => domain.id === a[0]) - ABFM_BLUEPRINT.findIndex(domain => domain.id === b[0]))[0]?.[0] || null;
  }
  function start(state, options = {}) {
    const container = stateContainer(state);
    if (container.active) fail('SESSION_ACTIVE', 'Resume the current study session or explicitly restart it.', { status: 409, sessionId: container.active.id });
    if (!object(options) || Object.keys(options).some(key => !['count', 'mode', 'domain', 'conditionId', 'timed', 'timeLimitSeconds', 'feedback'].includes(key))) fail('INVALID_OPTIONS', 'Use only supported study-practice options.');
    const { count = 20, mode = 'mixed', timed = false, feedback = 'immediate' } = options;
    if (!validCount(mode, count) || !MODES.has(mode) || typeof timed !== 'boolean' || !['immediate', 'end'].includes(feedback) || timed && (!Number.isInteger(options.timeLimitSeconds) || options.timeLimitSeconds < 60 || options.timeLimitSeconds > 14400) || !timed && options.timeLimitSeconds !== undefined && options.timeLimitSeconds !== null || mode !== 'targeted' && options.conditionId !== undefined || mode === 'targeted' && (!validId(options.conditionId) || options.domain !== undefined)) fail('INVALID_OPTIONS', 'Choose a valid practice size, or one fresh question for a selected topic, and valid optional practice timing.');
    const questions = pool();
    let domain = options.domain || null;
    if (mode === 'weak') domain = weakestDomain(container, questions);
    if ((mode === 'domain' || mode === 'weak') && !DOMAINS.has(domain)) fail(mode === 'weak' ? 'NO_HISTORY' : 'INVALID_DOMAIN', mode === 'weak' ? 'Complete a study session before targeting your lowest practice domain accuracy.' : 'Choose a blueprint study domain.');
    if ((mode === 'mixed' || mode === 'missed') && domain) fail('INVALID_OPTIONS', 'A domain is only supported for domain-targeted practice.');
    const candidates = [...questions.values()].filter(question => (!domain || question.domain === domain) && (mode !== 'targeted' || question.conditionId === options.conditionId));
    const missed = mode === 'missed' ? missedKeys(container, questions) : null;
    const exposed = mode === 'targeted' ? learningEvidence(container, questions).exposedKeys : null;
    const eligible = missed ? candidates.filter(question => missed.has(question.key)) : exposed ? candidates.filter(question => !exposed.has(question.key)) : candidates;
    const allocation = mode === 'mixed' ? allocateMixedPractice(count) : domain ? ABFM_BLUEPRINT.map(item => ({ domain: item.id, count: item.id === domain ? count : 0 })) : ABFM_BLUEPRINT.map(item => ({ domain: item.id, count: 0 }));
    let selected;
    if (mode === 'mixed') {
      const gaps = allocation.filter(item => eligible.filter(question => question.domain === item.domain).length < item.count).map(item => ({ domain: item.domain, required: item.count, available: eligible.filter(question => question.domain === item.domain).length }));
      if (gaps.length) fail('INSUFFICIENT_COVERAGE', 'The current eligible question library cannot fill this blueprint allocation without repeats. Choose a smaller session or review the visible domain gaps.', { status: 409, gaps, count });
      selected = shuffle(allocation.flatMap(item => shuffle(eligible.filter(question => question.domain === item.domain), random).slice(0, item.count)), random);
    } else {
      if (eligible.length < count) fail(mode === 'targeted' ? 'NO_FRESH_QUESTION' : 'INSUFFICIENT_COVERAGE', mode === 'targeted' ? 'There is no current board-study question without recorded exposure in retained history for this topic. Review its cited material and use later mixed practice; repeated questions do not establish transfer.' : mode === 'missed' ? 'There are too few current missed questions for this session size. Complete more practice or choose another mode.' : 'There are too few current questions in this domain for this session size.', { status: 409, gaps: [{ domain: domain || (mode === 'targeted' ? 'targeted' : 'missed'), required: count, available: eligible.length }], count });
      selected = shuffle(eligible, random).slice(0, count);
      if (mode === 'targeted') domain = selected[0].domain;
      for (const item of allocation) item.count = selected.filter(question => question.domain === item.domain).length;
    }
    const id = createId();
    if (!validId(id) || container.history.some(session => session.id === id)) throw new Error('Study session IDs must be valid and unique.');
    container.active = { id, mode, domain, ...(mode === 'targeted' ? { conditionId: options.conditionId } : {}), count, timed, feedback, ...(timed ? { timeLimitSeconds: options.timeLimitSeconds } : {}), createdAt: time(), selection: selected.map(({ key, fingerprint }) => ({ key, fingerprint })), answers: {}, allocation, blueprintVersion: BLUEPRINT_VERSION, trusted: true };
    return view(state);
  }
  function answer(state, { sessionId, questionKey, choiceId, confidence } = {}) {
    if (!validId(sessionId) || !KEY.test(questionKey || '') || !CHOICE.test(choiceId || '') || !validConfidence(confidence)) fail('INVALID_ANSWER', 'Select A, B, C, D or E and optionally low, medium or high confidence before feedback.');
    const { session } = checkedSession(state, sessionId);
    const position = session.selection.findIndex(identity => identity.key === questionKey);
    if (position < 0) fail('QUESTION_NOT_IN_SESSION', 'That question is not part of this study session.');
    const prior = session.answers[questionKey];
    if (prior) {
      if (prior.choiceId !== choiceId) fail('ANSWER_ALREADY_RECORDED', 'That question already has a recorded choice. Restart practice to answer it again.', { status: 409 });
      return view(state, { sessionId, index: position });
    }
    if (session.timed && time() >= session.createdAt + session.timeLimitSeconds * 1000) fail('TIME_EXPIRED', 'The practice timer has ended. Finish the session to review answered and skipped questions.', { status: 409 });
    session.answers[questionKey] = { choiceId, answeredAt: time(), ...(confidence ? { confidence } : {}) };
    return view(state, { sessionId, index: position });
  }
  function finish(state, { sessionId } = {}) {
    if (!validId(sessionId)) fail('INVALID_SESSION', 'Select a valid study session.');
    const { container, session, questions } = checkedSession(state, sessionId, { completed: true });
    if (session.completedAt !== undefined) return completedResults(session, questions);
    session.completedAt = time();
    const result = completedResults(session, questions);
    session.summary = { answered: result.answered, correct: result.correct, skipped: result.skipped, accuracy: result.accuracy, completionPercent: result.completionPercent, domainResults: clone(result.domainResults) };
    container.history.unshift(session);
    container.history = container.history.slice(0, BOARD_PRACTICE_HISTORY_LIMIT);
    container.active = null;
    return result;
  }
  function restart(state, options = {}) {
    const container = stateContainer(state);
    const previous = container.active;
    container.active = null;
    try { return start(state, options); } catch (error) { container.active = previous; throw error; }
  }
  function history(state) { return stateContainer(state).history.map(summaryView); }
  function exportHistory(state) { return { schemaVersion: 1, exportedAt: time(), purpose: 'Independent study practice history, not official exam scores or a clinical assessment.', history: history(state), disclaimer: STUDY_DISCLAIMER }; }
  function importHistory(state, payload, { replace = false } = {}) {
    if (!object(payload) || payload.schemaVersion !== 1 || !Array.isArray(payload.history) || payload.history.length > BOARD_PRACTICE_HISTORY_LIMIT) fail('INVALID_IMPORT', 'Import a bounded version-one study-practice history export.');
    const imported = payload.history.map(item => {
      if (!object(item) || !validId(item.sessionId || item.id) || !validCount(item.mode, item.total ?? item.count) || !MODES.has(item.mode) || item.mode === 'targeted' && !validId(item.conditionId) || !validTime(item.createdAt) || !validTime(item.completedAt) || item.completedAt < item.createdAt || !Number.isInteger(item.answered) || !Number.isInteger(item.correct) || item.correct < 0 || item.correct > item.answered || item.answered > (item.total ?? item.count) || !Array.isArray(item.domainResults) || item.domainResults.length !== 5) fail('INVALID_IMPORT', 'Imported history contains invalid practice counts or timestamps.');
      const total = item.total ?? item.count;
      const seen = new Set();
      const domainResults = item.domainResults.map(result => {
        if (!object(result) || !DOMAINS.has(result.domain) || seen.has(result.domain) || !Number.isInteger(result.total) || !Number.isInteger(result.answered) || !Number.isInteger(result.correct) || result.correct < 0 || result.correct > result.answered || result.answered > result.total || result.total < 0 || result.total > total) fail('INVALID_IMPORT', 'Imported history contains invalid domain totals.');
        seen.add(result.domain);
        return { domain: result.domain, title: ABFM_BLUEPRINT.find(domain => domain.id === result.domain).title, total: result.total, answered: result.answered, correct: result.correct, skipped: result.total - result.answered, accuracy: accuracy(result.correct, result.answered) };
      });
      if (domainResults.reduce((sum, result) => sum + result.total, 0) !== total || domainResults.reduce((sum, result) => sum + result.answered, 0) !== item.answered || domainResults.reduce((sum, result) => sum + result.correct, 0) !== item.correct) fail('INVALID_IMPORT', 'Imported domain counts do not match the session totals.');
      return { id: item.sessionId || item.id, mode: item.mode, domain: DOMAINS.has(item.domain) ? item.domain : null, ...(item.mode === 'targeted' ? { conditionId: item.conditionId } : {}), count: total, timed: item.timed === true, feedback: item.feedback === 'end' ? 'end' : 'immediate', createdAt: item.createdAt, completedAt: item.completedAt, trusted: false, blueprintVersion: typeof item.blueprintVersion === 'string' ? item.blueprintVersion.slice(0, 100) : 'Imported unverified practice', summary: { answered: item.answered, correct: item.correct, skipped: total - item.answered, accuracy: accuracy(item.correct, item.answered), completionPercent: Math.round(item.answered / total * 10000) / 100, domainResults } };
    });
    if (new Set(imported.map(item => item.id)).size !== imported.length) fail('INVALID_IMPORT', 'Imported session identities must be unique.');
    const container = stateContainer(state);
    const existingIds = new Set(container.history.map(item => item.id));
    container.history = replace ? imported : [...container.history, ...imported.filter(item => !existingIds.has(item.id))].slice(0, BOARD_PRACTICE_HISTORY_LIMIT);
    return { imported: imported.filter(item => replace || !existingIds.has(item.id)).length, trusted: false, officialScore: false, history: history(state), disclaimer: STUDY_DISCLAIMER };
  }
  function sanitizeImport(state, payload) {
    const replacement = { boardPractice: { schemaVersion: 1, active: null, history: [] } };
    if (payload !== undefined && payload !== null) {
      if (!object(payload) || payload.schemaVersion !== 1 || !Array.isArray(payload.history)) fail('INVALID_IMPORT', 'Imported practice state is invalid.');
      // An application backup may contain internal completed sessions. Reduce them
      // to counts only; never accept an imported active session or answer identity.
      const safeHistory = payload.history.map(item => object(item.summary) ? summaryView(item) : item);
      importHistory(replacement, { schemaVersion: 1, history: safeHistory }, { replace: true });
    }
    state.boardPractice = replacement.boardPractice;
    return history(state);
  }
  return { catalog, alignment, learningPlan, start, view, answer, finish, restart, history, exportHistory, importHistory, sanitizeImport };
}
