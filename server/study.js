import { createHash, randomUUID } from 'node:crypto';
import { createBoardPractice, createQuestionBankCurriculum, BoardPracticeError } from '../packages/practice-engine/index.js';
import { RATINGS, createCard, scheduleReview, getDueCards, previewIntervals, studyStats } from '../packages/spaced-review-engine/index.js';
import { SCENARIOS, STARTER_CARDS, COMPETENCIES } from '../content/seed.js';
import { validateSettings, DEFAULT_SETTINGS } from './store.js';
import { HttpError } from './errors.js';

const clone = value => structuredClone(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validTime = value => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;
const SETTING_KEYS = new Set(Object.keys(DEFAULT_SETTINGS));
const CARD_FIELDS = ['front', 'back', 'topic', 'sourceTitle', 'sourceUrl', 'suspended'];
const PURPOSE = 'Fictional educational exercises; feedback is not an official competency rating.';
const SIGNAL_LABEL = 'Study signals, not clinical competence or board-readiness predictions.';
const CASES = SCENARIOS.map(({ systemContext, ...scenario }) => scenario);
const WORKSHEETS = [
  { id: 'representation', title: 'Problem representation', fields: ['Relevant context', 'Time course', 'Key syndrome', 'Discriminating findings', 'One-sentence summary without assuming a diagnosis'] },
  { id: 'differential', title: 'Compare hypotheses', fields: ['Leading hypothesis', 'Supporting evidence', 'Evidence against it', 'Dangerous alternative', 'Finding that would change your ranking'] },
  { id: 'handoff', title: 'Focused handoff', fields: ['Current acuity', 'Working assessment and uncertainty', 'Pending tasks', 'Contingencies', 'Who owns follow-up'] },
  { id: 'reflection', title: 'Reflection and next practice', fields: ['What happened', 'Cue or reasoning step to revisit', 'Source to consult', 'One specific next practice task'] },
];

function validatedCard(input, options) {
  try { return createCard(input, options); }
  catch (error) { throw new HttpError(400, error.message, 'invalid_card'); }
}

// Legacy study backups permit text IDs. These resources are selected through
// JSON bodies, never interpolated into a URL, SQL statement, or object key.
function resourceId(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > 160 || /[\u0000-\u001f\u007f]/.test(value)) throw new HttpError(400, `${name} is invalid.`);
  return value;
}

function practiceResult(fn) {
  try { return fn(); }
  catch (error) {
    if (error instanceof BoardPracticeError) throw new HttpError(error.status || 400, error.message, error.code);
    throw error;
  }
}

function conversationId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id)) throw new HttpError(400, 'Conversation ID is invalid.');
  return id;
}

/** The host adapts trusted persisted state; the pinned engines own grading and scheduling. */
export function createStudyService({ store, bank, now = Date.now } = {}) {
  const curriculum = createQuestionBankCurriculum(bank, { now });
  const engine = createBoardPractice({ curricula: [curriculum], now });
  const entries = new Map(bank.questions.map(entry => [entry.key, entry]));
  const topics = new Map();
  for (const entry of bank.questions) {
    if (!topics.has(entry.topic.id)) topics.set(entry.topic.id, { id: entry.topic.id, name: entry.topic.name, specialty: entry.topic.specialty, questionKeys: [] });
    topics.get(entry.topic.id).questionKeys.push(entry.key);
  }
  const clock = () => typeof now === 'function' ? now() : now;
  store.updateState(state => {
    state.settings = validateSettings(state.settings || {});
    state.cards ||= []; state.reviews ||= []; state.chatStudy ||= {};
    if (state.studySeedVersion !== 1) {
      if (!state.cards.length) state.cards = STARTER_CARDS.map(input => ({ ...validatedCard({ ...input, verified: false }, { now: clock() }), origin: 'starter' }));
      state.studySeedVersion = 1;
    }
    engine.history(state);
  });

  const options = state => ({ now: clock(), newLimit: state.settings.newCardLimit, reviews: state.reviews, timeZone: state.settings.timeZone });
  const stats = state => studyStats(state.cards, state.reviews, clock(), { timeZone: state.settings.timeZone, newLimit: state.settings.newCardLimit });
  const pool = () => new Map(curriculum.boardQuestions().map(question => [question.key, question]));
  function decorate(card, eligible = pool()) {
    if (!card.questionKey) return clone(card);
    const current = eligible.get(card.questionKey);
    const sourceCurrent = Boolean(current && current.fingerprint === card.questionFingerprint);
    return { ...clone(card), sourceCurrent, sourceWarning: sourceCurrent ? null : 'The question changed or its recorded source check expired. This card is not current verified guidance.' };
  }
  function action(kind, body, fn) {
    if (!object(body)) throw new HttpError(400, 'Use a study action object.');
    const { actionId, action: ignored, ...payload } = body;
    return store.action(actionId, kind, payload, fn);
  }
  function summary() {
    const state = store.getState();
    let activePractice = null, practiceWarning = null;
    try { activePractice = engine.view(state); } catch (error) { if (!(error instanceof BoardPracticeError)) throw error; practiceWarning = { code: error.code, message: error.message }; }
    const catalog = engine.catalog();
    return { loadedQuestions: bank.questions.length, eligibleQuestions: catalog.questionCount, comparativeQuestions: bank.questions.filter(entry => entry.question.examScope === 'comparative-study').length, topics: topics.size, cards: state.cards.length, dueCount: getDueCards(state.cards, options(state)).length, catalog, activePractice, practiceWarning, stats: stats(state), settings: state.settings };
  }
  function library(query = '', page = 1) {
    if (typeof query !== 'string' || query.length > 200) throw new HttpError(400, 'Search text is too long.');
    if (!Number.isInteger(page) || page < 1 || page > 10000) throw new HttpError(400, 'Choose a valid page.');
    const search = query.toLowerCase().trim(), eligible = pool();
    const matches = [...topics.values()].filter(topic => `${topic.name} ${topic.specialty} ${topic.id}`.toLowerCase().includes(search)).sort((a, b) => a.name.localeCompare(b.name));
    return { topics: matches.slice((page - 1) * 20, page * 20).map(topic => ({ ...clone(topic), questionCount: topic.questionKeys.length, eligibleCount: topic.questionKeys.filter(key => eligible.has(key)).length, comparativeCount: topic.questionKeys.filter(key => entries.get(key).question.examScope === 'comparative-study').length })), total: matches.length, page, pages: Math.ceil(matches.length / 20) };
  }
  function question(key, reveal = false) {
    const entry = entries.get(key);
    if (!entry) throw new HttpError(404, 'That question is unavailable.');
    const eligible = pool().get(key), q = entry.question;
    const result = { key, topic: clone(entry.topic), stem: q.stem, choices: q.choices.map(({ id, text }) => ({ id, text })), current: Boolean(eligible), comparative: q.examScope === 'comparative-study' };
    if (reveal) {
      // Explicit answer reveal still honors the engine's source eligibility.
      if (!eligible) throw new HttpError(409, 'This item is comparative or its recorded source check expired; it cannot be graded as current U.S. board practice.', 'question_ineligible');
      const feedback = curriculum.gradeBoardQuestion(eligible, 'A');
      if (!feedback) throw new HttpError(409, 'The question is no longer eligible for current grading.');
      result.feedback = feedback; result.sources = feedback.sources; result.sourceLabel = 'Question sources';
    }
    return result;
  }
  function practice(method = 'view', body = {}) {
    if (method === 'catalog') return engine.catalog();
    if (method === 'history') return practiceResult(() => engine.history(store.getState()));
    if (method === 'view') return practiceResult(() => engine.view(store.getState(), body));
    if (!['start', 'restart', 'answer', 'finish'].includes(method)) throw new HttpError(400, 'Choose a supported practice action.');
    const { actionId, action: ignored, ...payload } = body;
    return action(`practice:${method}`, body, state => practiceResult(() => engine[method](state, payload)));
  }
  function cards(method = 'list', body = {}) {
    if (method === 'list') {
      const query = typeof body.query === 'string' ? body.query.toLowerCase().trim() : '';
      if (query.length > 200) throw new HttpError(400, 'Search text is too long.');
      const all = store.getState().cards, eligible = pool();
      return { cards: all.filter(card => `${card.front} ${card.back} ${card.topic}`.toLowerCase().includes(query)).map(card => decorate(card, eligible)), total: all.length };
    }
    if (!['create', 'update', 'delete', 'from-question'].includes(method)) throw new HttpError(400, 'Choose a supported card action.');
    return action(`cards:${method}`, body, state => {
      if (method === 'delete') {
        resourceId(body.id, 'Card ID');
        if (!state.cards.some(card => card.id === body.id)) throw new HttpError(404, 'That card is unavailable.');
        state.cards = state.cards.filter(card => card.id !== body.id);
        return { deleted: body.id };
      }
      if (method === 'update') {
        resourceId(body.id, 'Card ID');
        const index = state.cards.findIndex(card => card.id === body.id);
        if (index < 0) throw new HttpError(404, 'That card is unavailable.');
        const previous = state.cards[index], changes = Object.fromEntries(CARD_FIELDS.filter(key => body[key] !== undefined).map(key => [key, body[key]]));
        const validated = validatedCard({ ...previous, ...changes, verified: false }, { now: previous.createdAt, id: previous.id });
        const changedText = Object.keys(changes).some(key => key !== 'suspended' && changes[key] !== previous[key]);
        const next = { ...previous, ...Object.fromEntries(CARD_FIELDS.map(key => [key, validated[key]])), verified: false };
        if (changedText) { next.origin = 'personal'; delete next.questionKey; delete next.questionFingerprint; delete next.questionSources; }
        state.cards[index] = next;
        return { card: decorate(next) };
      }
      if (state.cards.length >= 10000) throw new HttpError(409, 'Export a backup and remove cards before adding more.');
      let input = body, provenance = { origin: 'personal' };
      if (method === 'from-question') {
        const item = question(body.key, true), grade = item.feedback;
        input = { front: `${item.stem}\n\n${item.choices.map(choice => `${choice.id}. ${choice.text}`).join('\n')}`, back: `Answer: ${grade.correctChoiceId}. ${item.choices.find(choice => choice.id === grade.correctChoiceId).text}\n\n${grade.rationale}`, topic: item.topic.name, sourceTitle: item.sources[0]?.title || '', sourceUrl: item.sources[0]?.url || '' };
        provenance = { origin: 'question', questionKey: item.key, questionFingerprint: grade.fingerprint, questionSources: clone(item.sources) };
      }
      const card = { ...validatedCard({ ...input, verified: false }, { now: clock(), id: randomUUID() }), ...provenance };
      state.cards.push(card);
      return { card: decorate(card) };
    });
  }
  function due() {
    const state = store.getState(), eligible = pool();
    return { cards: getDueCards(state.cards, options(state)).map(card => ({ ...decorate(card, eligible), intervals: previewIntervals(card, clock()) })), stats: stats(state) };
  }
  function review(body) {
    return action('review', body, state => {
      resourceId(body.cardId, 'Card ID');
      if (!RATINGS.includes(body.rating)) throw new HttpError(400, 'Choose Again, Hard, Good, or Easy.', 'invalid_rating');
      if (state.reviews.length >= 100000) throw new HttpError(409, 'The retained review-history limit is reached. Export a backup before starting a new study workspace.', 'review_history_full');
      const index = state.cards.findIndex(card => card.id === body.cardId);
      if (index < 0) throw new HttpError(404, 'That card is unavailable.');
      if (!getDueCards(state.cards, options(state)).some(card => card.id === body.cardId)) throw new HttpError(409, 'This card is not currently due or the new-card limit is reached.', 'card_not_due');
      const result = scheduleReview(state.cards[index], body.rating, clock());
      state.cards[index] = result.card; state.reviews.push(result.review);
      return { ...result, card: decorate(result.card), stats: stats(state) };
    });
  }
  function settings(body) {
    if (body === undefined) return store.getState().settings;
    if (!object(body) || Object.keys(body).some(key => key !== 'actionId' && !SETTING_KEYS.has(key))) throw new HttpError(400, 'Use supported settings.');
    const save = state => (state.settings = validateSettings(body, state.settings));
    return body.actionId ? action('settings', body, save) : store.updateState(save);
  }
  function progress() {
    const state = store.getState();
    return { review: stats(state), practice: { catalog: engine.catalog(), history: engine.history(state), learningPlan: engine.learningPlan(state) }, selfAssessmentLabel: SIGNAL_LABEL, quizEvidenceScope: 'Chat quizzes retain separate conversation history; these practice signals describe weighted practice sessions.' };
  }
  function chatState(state, id, create = false) {
    conversationId(id);
    if (!object(state.chatStudy)) state.chatStudy = {};
    if (!Object.hasOwn(state.chatStudy, id) && create) {
      if (Object.keys(state.chatStudy).length >= 100) throw new HttpError(409, 'There are too many saved case/quiz conversations. Export a backup before removing older conversations.');
      state.chatStudy[id] = { scenarioId: null };
    }
    return Object.hasOwn(state.chatStudy, id) ? state.chatStudy[id] : null;
  }
  function cases(body) {
    if (body === undefined) return { cases: clone(CASES), purpose: PURPOSE };
    if (!object(body)) throw new HttpError(400, 'Choose a case.');
    const scenario = body.scenarioId == null ? null : CASES.find(item => item.id === body.scenarioId);
    if (body.scenarioId != null && !scenario) throw new HttpError(404, 'That case is unavailable.');
    const choose = state => { const session = chatState(state, body.conversationId, true); session.scenarioId = scenario?.id || null; return { scenario: clone(scenario) }; };
    return body.actionId ? action('case', body, choose) : store.updateState(choose);
  }
  function getChatContext(id) {
    const state = store.getState(), session = chatState(state, id), scenario = SCENARIOS.find(item => item.id === session?.scenarioId);
    return [
      `Learner preferences: ${JSON.stringify(state.settings)}.`,
      scenario ? `Selected fictional educational case: ${scenario.title}. ${scenario.systemContext} Feedback is study reflection, never an official competency rating.` : '',
      session?.boardPractice?.active ? 'A canonical quiz is pending. Keep it pending during ordinary or reflective conversation. Do not address its specific facts or options, suggest an answer, or give an answer-revealing hint. Offer process reflection; the host accepts A-E or explicit /reveal. No answer key is supplied here.' : '',
    ].filter(Boolean).join('\n');
  }
  function removeConversation(id) {
    conversationId(id);
    return store.updateState(state => { if (state.chatStudy) delete state.chatStudy[id]; return { removed: true }; });
  }
  const formatQuiz = view => `${view.question.stem}\n\n${view.question.choices.map(choice => `${choice.id}. ${choice.text}`).join('\n')}\n\nChoose A–E, reflect without revealing the answer, or use /reveal.`;
  function resolveChatTurn({ conversationId: id, text, turnId }) {
    conversationId(id);
    if (typeof text !== 'string' || typeof turnId !== 'string') throw new HttpError(400, 'A valid chat submission is required.');
    const input = text.trim(), start = input.match(/^(?:\/quiz|quiz me|ask me a (?:practice )?question)(?:\s+(.+))?$/i);
    const pending = chatState(store.getState(), id)?.boardPractice?.active;
    const answer = pending && input.match(/^(?:answer\s*[: ]\s*)?([A-E])[.)]?$/i);
    const reveal = pending && /^(?:\/reveal|(?:reveal|show)(?: the)? answer)$/i.test(input);
    const hint = pending && /(?:^\/(?:hint|answer|key)$|\b(?:hint|correct answer|answer key|which option|which choice|what is the answer|what's the answer|tell me the answer|give me the answer)\b)/i.test(input);
    if (!start && !answer && !reveal && !hint) return null;
    const actionId = `chat-study-${createHash('sha256').update(`${id}\0${turnId}`).digest('hex')}`;
    try {
      return store.action(actionId, 'chat-study', { conversationId: id, text }, state => {
        const session = chatState(state, id, true);
        if (hint && !reveal) return { content: 'The question remains pending. Identify the key clue, compare your hypotheses, and commit to A–E before feedback. Use /reveal when you want to see the canonical answer.', sources: [] };
        if (start) {
          if (session.boardPractice?.active) return { content: formatQuiz(engine.view(session)), sources: [] };
          const topicName = (start[1] || '').replace(/^(?:about|on)\s+/i, '').toLowerCase();
          const eligible = curriculum.boardQuestions();
          const matched = topicName ? [...topics.values()].filter(topic => topic.id.toLowerCase() === topicName || topic.name.toLowerCase().includes(topicName)) : [];
          if (topicName && matched.length !== 1) return { content: matched.length ? `Choose a specific topic: ${matched.slice(0, 8).map(topic => topic.name).join(', ')}.` : 'That topic is unavailable. Choose a topic from Library, then use /quiz followed by its name.', sources: [] };
          const conditionId = matched[0]?.id || eligible[Math.floor(Math.random() * eligible.length)]?.conditionId;
          if (!conditionId) return { content: 'No current U.S. board-study questions are eligible. Review the recorded source expiry dates; no questions or dates will be invented.', sources: [] };
          session.scenarioId = null;
          const view = engine.start(session, { mode: 'targeted', count: 1, conditionId });
          return { content: formatQuiz(view), sources: [] };
        }
        const view = engine.view(session);
        if (answer) engine.answer(session, { sessionId: view.sessionId, questionKey: view.question.key, choiceId: answer[1].toUpperCase() });
        const finished = engine.finish(session, { sessionId: view.sessionId }), feedback = finished.questions[0].feedback;
        const correct = feedback.choices.find(choice => choice.id === feedback.correctChoiceId);
        return { content: `${reveal ? 'Answer revealed; this was not recorded as a correct attempt.' : feedback.correct ? 'Correct.' : 'That choice was incorrect.'}\n\nCanonical answer: ${feedback.correctChoiceId}. ${correct.text}\n\n${feedback.rationale}\n\nQuestion sources are recorded citations, not a live recheck.`, sources: feedback.sources, label: 'Question sources' };
      });
    } catch (error) {
      if (error instanceof BoardPracticeError || error instanceof HttpError) return { content: error.message, sources: [] };
      throw error;
    }
  }
  function validateImport(snapshot) {
    if (!object(snapshot)) throw new HttpError(400, 'Import a study state object.');
    const state = clone(snapshot);
    state.settings = validateSettings(state.settings || {});
    if (!Array.isArray(state.cards) || state.cards.length > 10000 || !Array.isArray(state.reviews) || state.reviews.length > 100000) throw new HttpError(400, 'Import bounded cards and review records.');
    const cardIds = new Set();
    state.cards = state.cards.map(card => {
      if (!object(card)) throw new HttpError(400, 'Invalid imported card.');
      resourceId(card.id, 'Card ID');
      if (cardIds.has(card.id)) throw new HttpError(400, 'Imported card IDs must be unique.');
      cardIds.add(card.id);
      if (!['new', 'learning', 'review'].includes(card.state) || !validTime(card.createdAt) || !validTime(card.dueAt) || card.lastReviewedAt !== null && !validTime(card.lastReviewedAt) || !Number.isFinite(card.intervalDays) || card.intervalDays < 0 || card.intervalDays > 365 || !Number.isFinite(card.ease) || card.ease < 1.3 || card.ease > 3.5 || !Number.isSafeInteger(card.repetitions) || card.repetitions < 0 || !Number.isSafeInteger(card.lapses) || card.lapses < 0 || typeof card.suspended !== 'boolean') throw new HttpError(400, 'Imported card scheduling is invalid.');
      const text = validatedCard(card, { now: card.createdAt, id: card.id });
      const importedSourceStatus = card.importedSourceStatus || { verified: card.verified === true, sourceVerified: card.sourceVerified === true, humanReview: card.humanReview === true };
      return { ...card, ...Object.fromEntries(CARD_FIELDS.map(key => [key, text[key]])), verified: false, sourceVerified: false, humanReview: false, importedSource: true, importedSourceStatus, origin: 'imported' };
    });
    const reviewIds = new Set();
    for (const review of state.reviews) {
      if (!object(review)) throw new HttpError(400, 'Invalid imported review.');
      resourceId(review.id, 'Review ID'); resourceId(review.cardId, 'Card ID');
      if (reviewIds.has(review.id) || !RATINGS.includes(review.rating) || !validTime(review.reviewedAt) || !validTime(review.previousDueAt) || !validTime(review.nextDueAt) || !Number.isFinite(review.intervalDays) || review.intervalDays < 0 || review.intervalDays > 365 || typeof review.wasNew !== 'boolean' || typeof review.topic !== 'string' || review.topic.length > 120) throw new HttpError(400, 'Imported review history is invalid.');
      reviewIds.add(review.id);
    }
    practiceResult(() => engine.sanitizeImport(state, state.boardPractice));
    state.chatStudy = {}; state.studySeedVersion = 1;
    return state;
  }
  return { summary, library, question, practice, cards, due, review, settings, progress, cases, worksheets: () => ({ competencies: clone(COMPETENCIES), worksheets: clone(WORKSHEETS), purpose: PURPOSE }), getChatContext, resolveChatTurn, removeConversation, validateImport };
}
