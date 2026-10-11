import { createHash } from 'node:crypto';

// A small adapter for the isolated bank. No RAG, filesystem, network or database.
export function createQuestionBankCurriculum(bank, { now = Date.now } = {}) {
  if (!Array.isArray(bank?.questions) || bank.questions.length > 6000) throw new TypeError('Use a bounded question-bank export.');
  const entries = new Map();
  for (const original of bank.questions) {
    const entry = structuredClone(original);
    if (entries.has(entry.key)) throw new Error('Duplicate question identity.');
    const q = entry.question;
    if (!q || !Array.isArray(q.choices) || q.choices.length !== 5 || new Set(q.choices.map(c => c.id)).size !== 5 || q.choices.some(c => !/^[A-E]$/.test(c.id)) || !q.choices.some(c => c.id === q.correctChoiceId)) throw new TypeError('Invalid answer choices.');
    const fingerprint = createHash('sha256').update(JSON.stringify(entry)).digest('hex');
    entries.set(entry.key, { entry, fingerprint });
  }
  function currency(entry) {
    const time = typeof now === 'function' ? now() : now;
    if (!Number.isFinite(time)) throw new TypeError('Use a valid clock.');
    const review = entry.topic.review;
    const checked = Date.parse(review?.checkedAt), expires = Date.parse(review?.expiresAt);
    const blocked = ['withdrawn', 'unresolved-conflict', 'blocked', 'superseded'];
    return { checkedAt: review?.checkedAt, expiresAt: review?.expiresAt,
      current: Number.isFinite(checked) && checked <= time && Number.isFinite(expires) && expires > time && !blocked.includes(review.status) && entry.sources.every(s => !blocked.includes(s.status)) };
  }
  function identity(entry, fingerprint) {
    return { key: entry.key, fingerprint, conditionId: entry.topic.id, conditionTitle: entry.topic.name, questionId: entry.question.id, domain: entry.question.domain, sourceIds: [...entry.question.sourceIds], ...currency(entry) };
  }
  return {
    boardQuestions() {
      return [...entries.values()].filter(({ entry }) => entry.question.examScope !== 'comparative-study' && currency(entry).current).map(({ entry, fingerprint }) => ({ ...identity(entry, fingerprint), stem: entry.question.stem, choices: entry.question.choices.map(({ id, text }) => ({ id, text })) }));
    },
    gradeBoardQuestion(pending, choiceId) {
      const found = entries.get(pending?.key);
      if (!found || pending.fingerprint !== found.fingerprint || !/^[A-E]$/.test(choiceId) || !currency(found.entry).current) return null;
      const { entry, fingerprint } = found, q = entry.question;
      return { ...identity(entry, fingerprint), correct: q.correctChoiceId === choiceId, correctChoiceId: q.correctChoiceId, rationale: q.explanation,
        choices: q.choices.map(c => ({ ...c, explanation: c.id === q.correctChoiceId ? q.explanation : q.distractorExplanations?.[c.id] || '' })), sources: structuredClone(entry.sources), citations: structuredClone(entry.sources), humanReview: false };
    },
  };
}
