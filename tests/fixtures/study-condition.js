export function studyCondition(overrides = {}) {
  const condition = {
    id: 'asthma', name: 'Asthma', aliases: ['bronchial asthma'], specialty: 'Respiratory', domain: 'chronic', keywords: ['airflow', 'inhaler'],
    overview: 'Mock original study text for a fictional source-backed test condition.',
    review: { kind: 'automated-source-check', humanReviewed: false, checkedAt: '2026-10-09', expiresAt: '2026-11-09' },
    sources: [{ id: 'nih-asthma', title: 'Mock official asthma teaching reference', organization: 'NIH', url: 'https://www.nhlbi.nih.gov/health/asthma', kind: 'official-clinical-reference', edition: 'Test edition', publishedDate: null, checkedAt: '2026-10-09', locator: 'Test fixture only', reuse: 'original-summary-no-full-text' }],
    sections: [
      { id: 'diagnosis', title: 'Diagnosis', text: 'Mock diagnosis fact: assess variable airflow limitation.', sourceIds: ['nih-asthma'] },
      { id: 'management', title: 'Management', text: 'Mock management fact: review inhaler technique.', sourceIds: ['nih-asthma'] },
      { id: 'follow-up', title: 'Follow-up', text: 'Mock follow-up fact: reassess control and adherence.', sourceIds: ['nih-asthma'] }
    ],
    questions: [1, 2].map(number => ({
      id: `asthma-q${number}`, stem: `Fictional study vignette ${number}: which learning step is supported by the mock reference?`,
      choices: ['A', 'B', 'C', 'D', 'E'].map((id, index) => ({ id, text: index === 1 ? 'Review inhaler technique.' : `Mock alternative ${id}.` })),
      correctChoiceId: 'B', explanation: 'The supplied mock reference explicitly supports reviewing inhaler technique.',
      distractorExplanations: { A: 'This is not supported by the mock reference.', C: 'This is not supported by the mock reference.', D: 'This is not supported by the mock reference.', E: 'This is not supported by the mock reference.' },
      sectionIds: ['management'], sourceIds: ['nih-asthma'], domain: 'chronic', learningObjective: 'Recall a supplied mock management distinction.', difficulty: 'application'
    }))
  };
  return { ...condition, ...overrides };
}
export const STUDY_NOW = Date.parse('2026-10-09T12:00:00Z');
