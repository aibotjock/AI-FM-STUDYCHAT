// Independent factual curriculum metadata, checked against the official 2026
// booklet. This app contains original material and is not endorsed by ABFM.
export const BLUEPRINT_VERSION = 'ABFM-2025-current-2026';
export const BLUEPRINT_SOURCES = Object.freeze([
  'https://www.theabfm.org/family-medicine-exam-blueprint/',
  'https://www.theabfm.org/app/uploads/2025/10/2026-FMCE-Examination-Information-Booklet-v.1.0.pdf',
]);
export const ABFM_BLUEPRINT = Object.freeze([
  Object.freeze({ id: 'acute', title: 'Acute Care and Diagnosis', percent: 35, benchmarkCases: 70 }),
  Object.freeze({ id: 'chronic', title: 'Chronic Care Management', percent: 25, benchmarkCases: 50 }),
  Object.freeze({ id: 'emergent', title: 'Emergent and Urgent Care', percent: 20, benchmarkCases: 40 }),
  Object.freeze({ id: 'preventive', title: 'Preventive Care', percent: 15, benchmarkCases: 30 }),
  Object.freeze({ id: 'foundations', title: 'Foundations of Care', percent: 5, benchmarkCases: 10 }),
]);

// A balanced study allocation, not an exam score prediction. Largest remainder
// preserves the requested count with a stable domain order for tied fractions.
export function allocateMixedPractice(count = 20) {
  if (!Number.isInteger(count) || count < 0 || count > 10000) throw new TypeError('Practice count must be an integer from 0 to 10000.');
  const allocation = ABFM_BLUEPRINT.map((domain, index) => {
    const exact = count * domain.percent / 100;
    return { domain: domain.id, count: Math.floor(exact), remainder: exact % 1, index };
  });
  const remaining = count - allocation.reduce((sum, item) => sum + item.count, 0);
  const ranking = [...allocation].sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let index = 0; index < remaining; index++) ranking[index].count++;
  return allocation.map(({ domain, count: total }) => ({ domain, count: total }));
}

