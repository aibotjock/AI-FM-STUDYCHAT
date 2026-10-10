/** Study priorities from server-regraded practice, never an exam prediction. */
export function buildLearningPlan({ evidence, questions, activeKeys, blueprint, historyLimit = 32 }) {
  const topics = new Map();
  const firstAttempts = evidence.attempts.filter(attempt => attempt.firstExposure);
  for (const attempt of evidence.attempts) {
    if (!topics.has(attempt.conditionId)) topics.set(attempt.conditionId, { conditionId: attempt.conditionId, title: attempt.title, domain: attempt.domain, first: [], repeats: [], latest: new Map(), confident: new Set() });
    const topic = topics.get(attempt.conditionId);
    (attempt.firstExposure ? topic.first : topic.repeats).push(attempt);
    topic.latest.set(attempt.key, attempt);
    if (!attempt.correct && attempt.confidence === 'high') topic.confident.add(attempt.key);
  }
  const priorities = [];
  for (const topic of topics.values()) {
    const misses = topic.first.filter(attempt => !attempt.correct).length;
    const repeatMisses = [...topic.latest.values()].filter(attempt => !attempt.firstExposure && !attempt.correct).length;
    const lowConfidenceCorrect = topic.first.filter(attempt => attempt.correct && attempt.confidence === 'low').length;
    if (!misses && !repeatMisses && !lowConfidenceCorrect) continue;
    const fresh = questions.find(question => question.conditionId === topic.conditionId && !evidence.exposedKeys.has(question.key) && !activeKeys.has(question.key));
    const recentFirst = topic.first.at(-1);
    const followUp = recentFirst?.correct && misses > 0;
    const evidenceLevel = misses >= 2 ? 'repeated-error' : 'limited';
    const reason = misses
      ? `${misses} missed first-exposure question${misses === 1 ? '' : 's'}${topic.confident.size ? `; ${topic.confident.size} distinct question${topic.confident.size === 1 ? '' : 's'} missed with high confidence` : ''}. ${followUp ? 'A newer fresh response was correct; check it again after a delay.' : misses >= 2 ? 'Errors on distinct items warrant a focused review.' : 'This is a provisional study signal, not a reliable topic assessment.'}`
      : repeatMisses ? `${repeatMisses} repeated question${repeatMisses === 1 ? ' was' : 's were'} still missed. Prior exposure limits what this shows about new-case performance.`
      : `${lowConfidenceCorrect} first-exposure answer${lowConfidenceCorrect === 1 ? ' was' : 's were'} correct with low confidence. Reinforce the reasoning and check recall later; this is not evidence of an error or mastery.`;
    priorities.push({ conditionId: topic.conditionId, title: topic.title, domain: topic.domain, reason, evidenceLevel, priorityKind: misses || repeatMisses ? 'error-review' : 'reinforce-recall', uniqueQuestions: topic.first.length, misses, correct: topic.first.length - misses, repeatAttempts: topic.repeats.length, repeatMisses, lowConfidenceCorrect, confidentErrors: topic.confident.size, followUpCorrect: Boolean(followUp), questionKey: fresh?.key || null });
  }
  priorities.sort((a, b) => Number(a.priorityKind === 'reinforce-recall') - Number(b.priorityKind === 'reinforce-recall') || Number(a.followUpCorrect) - Number(b.followUpCorrect) || b.confidentErrors - a.confidentErrors || b.misses - a.misses || b.repeatMisses - a.repeatMisses || a.title.localeCompare(b.title));
  const assessedDomains = new Set(firstAttempts.map(attempt => attempt.domain));
  const unassessedDomains = blueprint.filter(domain => !assessedDomains.has(domain.id)).map(domain => ({ domain: domain.id, title: domain.title }));
  return {
    version: 1,
    summary: { completedSessions: evidence.sessions.length, retainedHistoryLimit: historyLimit, uniqueQuestions: firstAttempts.length, firstExposureCorrect: firstAttempts.filter(attempt => attempt.correct).length, firstExposureMisses: firstAttempts.filter(attempt => !attempt.correct).length, repeatAttempts: evidence.attempts.length - firstAttempts.length, lowConfidenceCorrect: firstAttempts.filter(attempt => attempt.correct && attempt.confidence === 'low').length, confidentErrors: new Set(evidence.attempts.filter(attempt => !attempt.correct && attempt.confidence === 'high').map(attempt => attempt.key)).size, unassessedDomains: unassessedDomains.length, ignoredSessions: evidence.ignoredSessions, ignoredQuestions: evidence.ignoredQuestions },
    priorities: priorities.slice(0, 8),
    unassessedDomains,
    steps: [
      { id: 'commit', title: 'Commit before seeing feedback', description: 'Answer an unseen case and optionally state confidence. Explain the clue, decision and alternative to yourself or your tutor before opening the rationale.' },
      { id: 'correct', title: 'Correct the specific gap', description: 'Read the cited explanation and source-linked topic. Compare the decisive finding with the alternatives; identify whether the problem was recall, interpretation or next-step reasoning.' },
      { id: 'fresh', title: 'Check a fresh same-topic case', description: 'After reviewing the source, attempt an unseen question when one is available. It checks another item in the topic, not a validated transfer of the same clinical concept.' },
      { id: 'space', title: 'Retrieve it later', description: 'Save the key distinction as a review card and use the existing spaced-repetition schedule. An immediate correct repeat does not demonstrate durable learning.' },
      { id: 'mix', title: 'Return to mixed practice', description: 'Use later mixed cases across the blueprint to practice deciding which knowledge applies. Review overlooked domains; no data means unassessed.' }
    ],
    limitations: [`Based only on the last ${historyLimit} retained, trusted completed sessions with current canonical question fingerprints. Imported scores and active sessions do not establish knowledge.`, 'First exposure and unseen mean no recorded exposure in retained current history, not lifetime novelty. First exposures are separate from repeated attempts; unassessed topics are not mastered.', 'Few questions per topic provide limited evidence. Self-reported confidence identifies calibration prompts, not competence. Written reasoning and clinical performance are not independently assessed.', 'This study plan is not an ABFM score, passing prediction, clinical competence assessment or guarantee.'],
    officialScore: false
  };
}
