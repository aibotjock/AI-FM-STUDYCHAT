import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../server/store.js';
import { createStudyService } from '../server/study.js';
import { createChatService } from '../server/chat.js';

const bank = JSON.parse(readFileSync(new URL('../content/medical-question-bank.json', import.meta.url)));
const epoch = Date.parse('2026-10-10T18:00:00Z');
function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'study-integration-'));
  let now = epoch, store = createStore({ dataDir: dir }), service = createStudyService({ store, bank, now: () => now });
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  return { get store() { return store; }, get service() { return service; }, advance(value) { now = value; }, reopen() { store.close(); store = createStore({ dataDir: dir }); service = createStudyService({ store, bank, now: () => now }); } };
}

test('real bank counts, topic pagination, and public questions preserve answer-safe projections', t => {
  const { service } = setup(t), summary = service.summary();
  assert.equal(summary.loadedQuestions, 566); assert.equal(summary.eligibleQuestions, 558); assert.equal(summary.comparativeQuestions, 8);
  assert.equal(summary.topics, 130); assert.equal(summary.cards, 12); assert.equal(summary.dueCount, 5);
  const library = service.library('hypertension'); assert.ok(library.topics.length);
  const key = library.topics.find(topic => topic.id === 'hypertension').questionKeys[0];
  const safe = service.question(key); assert.equal(safe.choices.length, 5);
  for (const value of [safe, library, summary.catalog]) { assert.equal(JSON.stringify(value).includes('correctChoiceId'), false); assert.equal(JSON.stringify(value).includes('distractorExplanations'), false); }
  const revealed = service.question(key, true); assert.equal(revealed.feedback.correctChoiceId, bank.questions.find(entry => entry.key === key).question.correctChoiceId);
  assert.equal(revealed.sourceLabel, 'Question sources'); assert.ok(revealed.sources.length);
  assert.equal(JSON.stringify(service.cases()).includes('systemContext'), false);
});

test('practice reuses weighted selection, commits answers once, and resumes the same timed session after restart', t => {
  const ctx = setup(t);
  const view = ctx.service.practice('start', { actionId: 'practice-start', count: 20, timed: true, timeLimitSeconds: 60 });
  assert.deepEqual(view.allocation.map(item => item.count), [7, 5, 4, 3, 1]);
  assert.equal('correctChoiceId' in view.question, false);
  const body = { actionId: 'answer-once', sessionId: view.sessionId, questionKey: view.question.key, choiceId: 'A' };
  const answered = ctx.service.practice('answer', body);
  assert.equal(answered.answeredCount, 1);
  assert.deepEqual(ctx.service.practice('answer', body), answered);
  assert.throws(() => ctx.service.practice('answer', { ...body, choiceId: 'B' }), { status: 409 });
  assert.throws(() => ctx.service.practice('answer', { ...body, actionId: 'changed-answer', choiceId: 'B' }), { code: 'ANSWER_ALREADY_RECORDED' });
  ctx.reopen();
  const resumed = ctx.service.practice('view'); assert.equal(resumed.sessionId, view.sessionId); assert.equal(resumed.answeredCount, 1);
  ctx.advance(epoch + 60000);
  const next = ctx.service.practice('view'); assert.equal(next.timeExpired, true);
  assert.throws(() => ctx.service.practice('answer', { actionId: 'late-answer', sessionId: view.sessionId, questionKey: next.question.key, choiceId: 'A' }), { code: 'TIME_EXPIRED' });
  const finished = ctx.service.practice('finish', { actionId: 'finish', sessionId: view.sessionId });
  assert.equal(finished.answered, 1); assert.equal(finished.skipped, 19); assert.equal(ctx.service.practice('history').length, 1);
});

test('expiry is preserved in practice, question reveal, card warnings, and eligible counts', t => {
  const ctx = setup(t), key = bank.questions[0].key;
  ctx.service.cards('from-question', { actionId: 'question-card', key });
  const view = ctx.service.practice('start', { actionId: 'start-expiry', count: 10 });
  ctx.advance(Date.parse('2027-01-01T00:00:00Z'));
  assert.equal(ctx.service.summary().eligibleQuestions, 0);
  assert.equal(ctx.service.summary().practiceWarning.code, 'CONTENT_CHANGED');
  assert.throws(() => ctx.service.practice('view', { sessionId: view.sessionId }), { code: 'CONTENT_CHANGED' });
  assert.throws(() => ctx.service.question(key, true), { status: 409 });
  const card = ctx.service.cards('list').cards.find(item => item.questionKey === key);
  assert.equal(card.sourceCurrent, false); assert.match(card.sourceWarning, /expired/);
  assert.equal(ctx.service.question(key).topic.review.expiresAt, bank.questions[0].topic.review.expiresAt);
});

test('review rating and card schedule commit once, daily new-card cap honors timezone, and restart retains schedules', t => {
  const ctx = setup(t), first = ctx.service.due().cards[0];
  assert.throws(() => ctx.service.review({ actionId: 'invalid-rating', cardId: first.id, rating: 'mastered' }), { status: 400, code: 'invalid_rating' });
  const body = { actionId: 'review-once', cardId: first.id, rating: 'good' };
  const result = ctx.service.review(body); assert.equal(result.card.state, 'review'); assert.equal(result.card.dueAt, epoch + 86400000);
  assert.deepEqual(ctx.service.review(body), result); assert.equal(ctx.store.getState().reviews.length, 1);
  assert.throws(() => ctx.service.review({ ...body, actionId: 'review-again-too-soon' }), { code: 'card_not_due' });
  for (let i = 0; i < 4; i++) ctx.service.review({ actionId: `new-${i}`, cardId: ctx.service.due().cards[0].id, rating: 'good' });
  assert.equal(ctx.service.due().cards.length, 0); assert.equal(ctx.service.due().stats.newRemaining, 0);
  ctx.reopen(); assert.equal(ctx.store.getState().reviews.length, 5); assert.equal(ctx.service.cards('list').cards.find(card => card.id === first.id).dueAt, result.card.dueAt);
  ctx.advance(Date.parse('2026-10-11T03:59:00Z')); assert.equal(ctx.service.due().cards.length, 0);
  ctx.advance(Date.parse('2026-10-11T04:01:00Z')); assert.equal(ctx.service.due().stats.newRemaining, 5); assert.equal(ctx.service.due().cards.length, 5);
});

test('card edits preserve scheduling, clear canonical identity when content changes, and deletion retains review history', t => {
  const ctx = setup(t), key = bank.questions[0].key;
  assert.throws(() => ctx.service.cards('create', { actionId: 'invalid-card', front: '', back: '' }), { status: 400, code: 'invalid_card' });
  const created = ctx.service.cards('from-question', { actionId: 'create-question', key }).card;
  assert.equal(created.verified, false); assert.equal(created.origin, 'question');
  const edited = ctx.service.cards('update', { actionId: 'edit-card', id: created.id, back: 'My personal explanation' }).card;
  assert.equal(edited.origin, 'personal'); assert.equal('questionKey' in edited, false); assert.equal(edited.dueAt, created.dueAt);
  const first = ctx.service.due().cards[0]; ctx.service.review({ actionId: 'review-delete', cardId: first.id, rating: 'good' });
  ctx.service.cards('delete', { actionId: 'delete-card', id: first.id });
  assert.equal(ctx.store.getState().reviews.length, 1); assert.equal(ctx.service.cards('list').cards.some(card => card.id === first.id), false);
});

test('quiz and reflection share saved chat path, preserve pending state, intercept hints, and grade without a paid text call', async t => {
  const ctx = setup(t); let calls = 0, observed;
  const provider = { async generate({ messages, onDelta }) { calls++; observed = messages; onDelta('We can reflect on your approach.'); return { content: 'We can reflect on your approach.' }; } };
  const chat = createChatService({ db: ctx.store.db, provider, config: { chatTimeoutMs: 1000 }, getContext: ({ conversationId }) => ctx.service.getChatContext(conversationId), resolveTurn: request => ctx.service.resolveChatTurn(request) });
  t.after(() => chat.close());
  const submit = (turnId, input) => chat.submit({ conversationId: 'quiz-conversation', turnId, attemptId: `${turnId}-attempt`, input }, () => {});
  const start = await submit('quiz-start', '/quiz hypertension'); assert.equal(start.status, 'completed'); assert.equal(calls, 0);
  const pending = ctx.store.getState().chatStudy['quiz-conversation'].boardPractice.active;
  const key = pending.selection[0].key, canonical = bank.questions.find(entry => entry.key === key).question;
  assert.equal(start.content.includes('Canonical answer:'), false);
  const reflection = await submit('reflection', 'I rush when I feel uncertain.'); assert.equal(reflection.status, 'completed'); assert.equal(calls, 1);
  assert.equal(ctx.store.getState().chatStudy['quiz-conversation'].boardPractice.active.id, pending.id);
  const context = observed.find(message => message.role === 'developer').content;
  assert.match(context, /canonical quiz is pending/); assert.equal(context.includes(canonical.explanation), false); assert.equal(context.includes('correctChoiceId'), false);
  const hint = await submit('hint', 'Which option is correct?'); assert.equal(calls, 1); assert.equal(hint.content.includes('Canonical answer:'), false);
  const answered = await submit('answer', canonical.correctChoiceId); assert.equal(calls, 1); assert.match(answered.content, /^Correct\./); assert.equal(answered.label, 'Question sources');
  assert.equal(ctx.store.getState().chatStudy['quiz-conversation'].boardPractice.active, null);
  assert.deepEqual(await submit('answer', canonical.correctChoiceId), { ...answered, duplicate: true });
  ctx.service.removeConversation('quiz-conversation');
  assert.equal(Object.hasOwn(ctx.store.getState().chatStudy, 'quiz-conversation'), false);
});

test('explicit quiz reveal records a skipped attempt and repeat delivery cannot create another quiz', t => {
  const ctx = setup(t), start = { conversationId: 'quiz:one', text: '/quiz hypertension', turnId: 'turn:one' };
  const first = ctx.service.resolveChatTurn(start), pending = ctx.store.getState().chatStudy['quiz:one'].boardPractice.active;
  assert.deepEqual(ctx.service.resolveChatTurn(start), first);
  assert.equal(ctx.store.getState().chatStudy['quiz:one'].boardPractice.active.id, pending.id);
  const reveal = ctx.service.resolveChatTurn({ conversationId: 'quiz:one', text: '/reveal', turnId: 'turn:reveal' });
  assert.match(reveal.content, /not recorded as a correct attempt/);
  const completed = ctx.store.getState().chatStudy['quiz:one'].boardPractice.history[0];
  assert.equal(completed.summary.correct, 0); assert.equal(completed.summary.answered, 0);
  assert.equal(ctx.service.resolveChatTurn({ conversationId: 'quiz:one', text: 'hello', turnId: 'hello' }), null);
});

test('validated import preserves learner/source records, distrusts scores, clears pending sessions, and malformed snapshots do not mutate state', t => {
  const ctx = setup(t), view = ctx.service.practice('start', { actionId: 'import-practice', count: 10 });
  ctx.service.practice('finish', { actionId: 'import-finish', sessionId: view.sessionId });
  const card = ctx.service.due().cards[0]; ctx.service.review({ actionId: 'import-review', cardId: card.id, rating: 'good' });
  ctx.service.cards('delete', { actionId: 'deleted-reviewed-card', id: card.id });
  const original = ctx.store.getState(); original.cards[0].sourceVerified = true; original.cards[0].humanReview = true;
  const restored = ctx.service.validateImport(original);
  assert.equal(restored.cards.length, original.cards.length); assert.equal(restored.reviews.length, original.reviews.length);
  assert.equal(restored.cards[0].verified, false); assert.equal(restored.cards[0].sourceVerified, false); assert.equal(restored.cards[0].importedSourceStatus.sourceVerified, true);
  assert.equal(restored.boardPractice.active, null); assert.equal(restored.boardPractice.history[0].trusted, false); assert.deepEqual(restored.chatStudy, {});
  assert.equal(original.cards[0].sourceVerified, true);
  const legacyIds = cloneSnapshot(original);
  const oldCardId = legacyIds.cards[0].id; legacyIds.cards[0].id = 'old card: custom ID';
  legacyIds.reviews.forEach(review => { if (review.cardId === oldCardId) review.cardId = 'old card: custom ID'; });
  assert.equal(ctx.service.validateImport(legacyIds).cards[0].id, 'old card: custom ID');
  const before = ctx.store.getState(), bad = cloneSnapshot(before); bad.cards[0].dueAt = 'tomorrow';
  assert.throws(() => ctx.service.validateImport(bad), { status: 400 }); assert.deepEqual(ctx.store.getState(), before);
  ctx.store.replace(restored); ctx.reopen(); assert.equal(ctx.service.practice('history')[0].trusted, false); assert.equal(ctx.service.summary().cards, original.cards.length);
});

const cloneSnapshot = value => structuredClone(value);
