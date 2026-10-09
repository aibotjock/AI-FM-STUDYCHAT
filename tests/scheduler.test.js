import test from 'node:test';
import assert from 'node:assert/strict';
import { createCard, scheduleReview, getDueCards, previewIntervals, studyStats, dayKey } from '../shared/scheduler.js';

const now = Date.parse('2026-10-09T03:00:00Z');
const make = (id = 'card') => createCard({ front: 'Question', back: 'Answer', topic: 'Reasoning' }, { now, id });
const DAY = 86_400_000;

test('successful retrieval spaces repeated reviews further apart', () => {
  const first = scheduleReview(make(), 'good', now);
  assert.equal(first.card.dueAt, now + DAY);
  assert.equal(first.review.wasNew, true);
  const second = scheduleReview(first.card, 'good', first.card.dueAt);
  assert.equal(second.card.intervalDays, 6);
  const third = scheduleReview(second.card, 'good', second.card.dueAt);
  assert.equal(third.card.intervalDays, 15);
  assert.equal(third.review.wasNew, false);
});

test('forgotten cards return for relearning rather than being marked mastered', () => {
  const learned = { ...make(), state: 'review', intervalDays: 24, repetitions: 4, lastReviewedAt: now - DAY };
  const result = scheduleReview(learned, 'again', now);
  assert.equal(result.card.state, 'learning');
  assert.equal(result.card.dueAt, now + 600_000);
  assert.equal(result.card.lapses, 1);
  assert.equal(result.card.repetitions, 0);
  assert.equal(scheduleReview(result.card, 'good', result.card.dueAt).card.intervalDays, 1);
  assert.equal(getDueCards([result.card], { now: now + 599_999 }).length, 0);
  assert.equal(getDueCards([result.card], { now: now + 600_000 })[0].id, learned.id);
});

test('due cards take precedence, with suspended and future cards excluded', () => {
  const cards = [make('new'), { ...make('overdue'), state: 'review', dueAt: now - DAY }, { ...make('learning'), state: 'learning' }, { ...make('suspended'), suspended: true }, { ...make('future'), state: 'review', dueAt: now + DAY }];
  assert.deepEqual(getDueCards(cards, { now, newLimit: 1 }).map(c => c.id), ['learning', 'overdue', 'new']);
});

test('daily new-card cap counts unique introductions, including cards missed immediately', () => {
  const fresh = [make('a'), make('b'), make('c')];
  const reviews = [scheduleReview(make('introduced'), 'again', now).review];
  assert.equal(getDueCards(fresh, { now, newLimit: 2, reviews }).length, 1);
  reviews.push({ ...reviews[0], id: 'duplicate' });
  assert.equal(getDueCards(fresh, { now, newLimit: 2, reviews }).length, 1);
  assert.equal(getDueCards(fresh, { now, newLimit: 0 }).length, 0);
});

test('new-card limits reset at the learner local midnight rather than UTC midnight', () => {
  const before = Date.parse('2026-10-09T03:59:00Z');
  const after = Date.parse('2026-10-09T04:01:00Z');
  const reviews = [{ cardId: 'introduced', wasNew: true, reviewedAt: before }];
  assert.equal(getDueCards([make()], { now: before, newLimit: 1, reviews, timeZone: 'America/New_York' }).length, 0);
  assert.equal(getDueCards([make()], { now: after, newLimit: 1, reviews, timeZone: 'America/New_York' }).length, 1);
});

test('recall reports use real ratings, and streaks stay calendar-correct across DST', () => {
  const review = (date, rating) => ({ reviewedAt: Date.parse(date), rating, topic: 'Reasoning', cardId: date });
  const reviews = [review('2026-03-07T17:00:00Z', 'good'), review('2026-03-08T16:00:00Z', 'again'), review('2026-03-09T16:00:00Z', 'good')];
  const stats = studyStats([make()], reviews, Date.parse('2026-03-09T17:00:00Z'), { timeZone: 'America/New_York' });
  assert.equal(stats.streak, 3);
  assert.equal(stats.retention, 67);
  assert.equal(stats.weakTopics[0].lapses, 1);
  assert.equal(studyStats([], [], now).retention, null);
  assert.equal(dayKey(now, 'America/New_York'), '2026-10-08');
});

test('interval previews match future review behavior and long intervals remain bounded', () => {
  assert.deepEqual(previewIntervals(make(), now), { again: '10m', hard: '30m', good: '1d', easy: '4d' });
  let card = make();
  let time = now;
  for (let i = 0; i < 100; i++) {
    card = scheduleReview(card, 'easy', time).card;
    time = card.dueAt;
    assert.ok(card.intervalDays <= 365);
    assert.ok(card.ease <= 3.5);
  }
});

test('invalid ratings, incomplete cards, and executable source links are rejected', () => {
  assert.throws(() => createCard({ front: 'Only a question' }));
  assert.throws(() => createCard({ front: 'Q', back: 'A', sourceUrl: 'javascript:alert(1)' }));
  assert.throws(() => scheduleReview(make(), 'excellent', now));
  assert.throws(() => scheduleReview({ ...make(), suspended: true }, 'good', now));
});

test('an easier rating never schedules a card sooner than a harder rating', () => {
  const states = [make(), scheduleReview(make(), 'good', now).card,
    { ...make(), state: 'learning', intervalDays: 20, repetitions: 0 },
    { ...make(), state: 'review', intervalDays: 365, repetitions: 5 },
    { ...make(), state: 'review', intervalDays: 24, repetitions: 0 },
    { ...make(), state: 'review', intervalDays: 5, repetitions: 3, ease: 1.3 }];
  for (const card of states) {
    const dates = ['again', 'hard', 'good', 'easy'].map(rating => scheduleReview(card, rating, now).card.dueAt);
    assert.ok(dates.every((due, index) => index === 0 || due >= dates[index - 1]), JSON.stringify(dates));
  }
});
