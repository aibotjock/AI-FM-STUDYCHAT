import { createHash } from 'node:crypto';
import { ABFM_BLUEPRINT, BLUEPRINT_VERSION, BLUEPRINT_SOURCES } from '../shared/blueprint.js';

export const BOARD_CROSSWALK_VERSION = 'original-question-primary-domain-v1';
const DOMAIN_IDS = new Set(ABFM_BLUEPRINT.map(domain => domain.id));
const QUESTION_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}:[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const FINGERPRINT = /^[a-f0-9]{64}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const percent = (part, total) => total ? Math.round(part / total * 10000) / 100 : null;

/** Audit publisher-authored domain metadata, not medical correctness or exam readiness. */
export function buildBoardAlignment(questions, { includeCrosswalk = true } = {}) {
  if (typeof includeCrosswalk !== 'boolean') throw new TypeError('Choose a boolean crosswalk inclusion option.');
  if (!Array.isArray(questions) || questions.length > 48000) throw new TypeError('Use a bounded current board-question inventory.');
  const seen = new Set();
  const crosswalk = questions.map(question => {
    if (!object(question) || !QUESTION_KEY.test(question.key || '') || !FINGERPRINT.test(question.fingerprint || '') || !DOMAIN_IDS.has(question.domain) || question.current !== true) throw new TypeError('Alignment requires current canonical question identities and one known primary domain.');
    if (seen.has(question.key)) throw new Error('Alignment question identities must be unique.');
    seen.add(question.key);
    const [conditionId, questionId] = question.key.split(':');
    if (question.conditionId !== conditionId || question.questionId !== questionId || !Array.isArray(question.sourceIds) || question.sourceIds.length < 1 || question.sourceIds.length > 8 || new Set(question.sourceIds).size !== question.sourceIds.length || question.sourceIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(id))) throw new TypeError('Alignment requires consistent condition, question and source identities.');
    return { key: question.key, fingerprint: question.fingerprint, conditionId, questionId, primaryDomain: question.domain, sourceIds: [...question.sourceIds].sort() };
  }).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const domains = ABFM_BLUEPRINT.map(domain => {
    const items = crosswalk.filter(item => item.primaryDomain === domain.id);
    const bankPercent = percent(items.length, crosswalk.length);
    return { domain: domain.id, title: domain.title, targetPercent: domain.percent, availableQuestions: items.length, coveredTopics: new Set(items.map(item => item.conditionId)).size, bankPercent, deviationPercentagePoints: bankPercent === null ? null : Math.round((bankPercent - domain.percent) * 100) / 100 };
  });
  return {
    schemaVersion: 1, crosswalkVersion: BOARD_CROSSWALK_VERSION, blueprintVersion: BLUEPRINT_VERSION,
    blueprintSources: [...BLUEPRINT_SOURCES], questionCount: crosswalk.length,
    poolFingerprint: createHash('sha256').update(JSON.stringify({ crosswalkVersion: BOARD_CROSSWALK_VERSION, blueprintVersion: BLUEPRINT_VERSION, crosswalk })).digest('hex'),
    mappingBasis: 'Publisher-authored question primary-domain metadata; not independently adjudicated alignment.',
    ...(includeCrosswalk ? { crosswalk } : {}), domains,
    scope: 'Current inventory and primary-domain distribution only. Topic completeness, item difficulty, medical accuracy and exam readiness are not evaluated.',
    completeExamCoverage: 'not-established', officialScore: false,
  };
}
