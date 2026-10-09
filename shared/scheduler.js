// A transparent SM-2-inspired scheduler with short relearning steps.
// This is an educational scheduling heuristic, not FSRS or a validated retention estimate.
const DAY = 86_400_000;
const MINUTE = 60_000;
export const RATINGS = ['again', 'hard', 'good', 'easy'];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function timestamp(value) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0) throw new Error('Invalid review time.');
  return result;
}

export function createCard(input, { now = Date.now(), id } = {}) {
  now = timestamp(now);
  if (!input || typeof input !== 'object') throw new Error('Card must be an object.');
  const front = typeof input.front === 'string' ? input.front.trim() : '';
  const back = typeof input.back === 'string' ? input.back.trim() : '';
  if (!front || !back) throw new Error('Both the question and answer are required.');
  if (front.length > 2000 || back.length > 8000) throw new Error('Card text is too long.');
  const sourceUrl = typeof input.sourceUrl === 'string' ? input.sourceUrl.trim() : '';
  if (sourceUrl) {
    let url;
    try { url = new URL(sourceUrl); } catch { throw new Error('Source must be an https or http URL.'); }
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Source must be an https or http URL.');
  }
  return {
    id: id ?? globalThis.crypto.randomUUID(), front, back,
    topic: (typeof input.topic === 'string' ? input.topic.trim() : '')?.slice(0, 120) || 'Clinical reasoning',
    sourceTitle: (typeof input.sourceTitle === 'string' ? input.sourceTitle.trim() : '').slice(0, 300),
    sourceUrl, verified: input.verified === true, suspended: input.suspended === true,
    createdAt: now, dueAt: now, state: 'new', intervalDays: 0, ease: 2.5,
    repetitions: 0, lapses: 0, lastReviewedAt: null,
  };
}

export function scheduleReview(original, rating, now = Date.now()) {
  now = timestamp(now);
  if (!RATINGS.includes(rating)) throw new Error('Choose Again, Hard, Good, or Easy.');
  if (!original?.id || !['new', 'learning', 'review'].includes(original.state)) throw new Error('Invalid card schedule.');
  if (original.suspended) throw new Error('Resume this card before reviewing it.');
  const card = { ...original };
  let ease = clamp(Number(card.ease) || 2.5, 1.3, 3.5);
  let interval = clamp(Number(card.intervalDays) || 0, 0, 365);
  let repetitions = Math.max(0, Number(card.repetitions) || 0);
  let lapses = Math.max(0, Number(card.lapses) || 0);
  const wasNew = card.state === 'new';
  let delay;
  if (rating === 'again') {
    if (!wasNew) lapses += 1;
    ease = clamp(ease - 0.2, 1.3, 3.5);
    // A forgotten mature card must relearn before it can return to long intervals.
    interval = 1;
    repetitions = 0;
    card.state = 'learning';
    delay = 10 * MINUTE;
  } else if (rating === 'hard' && card.state !== 'review') {
    ease = clamp(ease - 0.15, 1.3, 3.5);
    card.state = 'learning';
    delay = 30 * MINUTE;
  } else {
    const goodInterval = repetitions === 0 ? Math.max(1, interval) : repetitions === 1 ? Math.max(6, interval) : Math.max(1, Math.round(interval * ease));
    if (rating === 'hard') {
      interval = Math.max(1, Math.min(goodInterval, Math.ceil(interval * 1.2)));
      ease = clamp(ease - 0.15, 1.3, 3.5);
    } else if (rating === 'good') {
      interval = goodInterval;
      repetitions += 1;
    } else {
      interval = Math.max(4, goodInterval + 1, Math.round(interval * ease * 1.3));
      ease = clamp(ease + 0.15, 1.3, 3.5);
      repetitions += 1;
    }
    interval = clamp(interval, 1, 365);
    card.state = 'review';
    delay = interval * DAY;
  }
  card.intervalDays = interval;
  card.ease = Number(ease.toFixed(2));
  card.repetitions = repetitions;
  card.lapses = lapses;
  card.lastReviewedAt = now;
  card.dueAt = now + delay;
  return {
    card,
    review: {
      id: globalThis.crypto.randomUUID(), cardId: card.id, topic: card.topic,
      rating, reviewedAt: now, wasNew, previousDueAt: original.dueAt,
      nextDueAt: card.dueAt, intervalDays: Number((delay / DAY).toFixed(6)),
    },
  };
}

export function dayKey(date = Date.now(), timeZone) {
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) throw new Error('Invalid date.');
  const parts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', ...(timeZone ? { timeZone } : {}) }).formatToParts(value);
  const part = key => parts.find(p => p.type === key).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function getDueCards(cards, { now = Date.now(), newLimit = 5, reviews = [], timeZone } = {}) {
  now = timestamp(now);
  const today = dayKey(now, timeZone);
  const introduced = new Set(reviews.filter(r => r.wasNew && dayKey(r.reviewedAt, timeZone) === today).map(r => r.cardId)).size;
  const remaining = Math.max(0, Math.floor(Number(newLimit) || 0) - introduced);
  const due = cards.filter(c => !c.suspended && c.state !== 'new' && c.dueAt <= now).sort((a, b) => {
    if (a.state !== b.state) return a.state === 'learning' ? -1 : 1;
    return a.dueAt - b.dueAt || a.createdAt - b.createdAt;
  });
  const fresh = cards.filter(c => !c.suspended && c.state === 'new' && c.dueAt <= now).sort((a, b) => a.createdAt - b.createdAt).slice(0, remaining);
  return [...due, ...fresh];
}

export function formatInterval(milliseconds) {
  if (milliseconds < DAY) return `${Math.max(1, Math.round(milliseconds / MINUTE))}m`;
  return `${Math.round(milliseconds / DAY)}d`;
}

export function previewIntervals(card, now = Date.now()) {
  return Object.fromEntries(RATINGS.map(rating => {
    const { card: next } = scheduleReview({ ...card, suspended: false }, rating, now);
    return [rating, formatInterval(next.dueAt - now)];
  }));
}

export function studyStats(cards, reviews, now = Date.now(), { timeZone, newLimit = 5 } = {}) {
  const today = dayKey(now, timeZone);
  const todayReviews = reviews.filter(r => dayKey(r.reviewedAt, timeZone) === today);
  const active = cards.filter(c => !c.suspended);
  const recent = reviews.filter(r => r.reviewedAt >= now - 30 * DAY && r.reviewedAt <= now);
  const success = list => list.length ? Math.round(100 * list.filter(r => r.rating !== 'again').length / list.length) : null;
  const days = new Set(reviews.map(r => dayKey(r.reviewedAt, timeZone)));
  let streak = 0;
  // Calendar arithmetic uses noon UTC and date strings so DST cannot skip a day.
  const cursor = new Date(`${today}T12:00:00Z`);
  if (!days.has(today)) cursor.setUTCDate(cursor.getUTCDate() - 1);
  while (days.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  const topics = [...new Set(recent.map(r => r.topic))];
  const weakTopics = topics.map(topic => {
    const items = recent.filter(r => r.topic === topic);
    const retention = success(items);
    return { topic, reviews: items.length, lapses: items.filter(r => r.rating === 'again').length, retention, recallRate: retention };
  }).sort((a, b) => a.retention - b.retention || b.reviews - a.reviews);
  const activity = [];
  for (let i = 13; i >= 0; i -= 1) {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - i);
    const key = date.toISOString().slice(0, 10);
    activity.push({ date: key, count: reviews.filter(r => dayKey(r.reviewedAt, timeZone) === key).length });
  }
  const newReviewed = new Set(todayReviews.filter(r => r.wasNew).map(r => r.cardId)).size;
  const dueCount = getDueCards(cards, { now, newLimit, reviews, timeZone }).length;
  return {
    totalCards: cards.length, activeCards: active.length, totalReviews: reviews.length,
    reviewedToday: todayReviews.length, dueCount,
    reviewDueCount: active.filter(c => c.state !== 'new' && c.dueAt <= now).length,
    newCount: active.filter(c => c.state === 'new').length,
    newRemaining: Math.max(0, newLimit - newReviewed),
    matureCount: active.filter(c => c.intervalDays >= 21 && c.state === 'review').length,
    leeches: active.filter(c => c.lapses >= 8).length,
    retention: success(recent), recallRate: success(recent), streak,
    weakTopics, activity, minutesEstimate: Math.ceil(dueCount * 0.75),
  };
}
