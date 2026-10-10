import policy from '../content/source-reuse-policy.json' with { type: 'json' };

// Exact-document permissions are repository-owned, never client assertions.
// They do not grant clinical review, global rights or commercial activation.
export const CONCISE_SOURCE_WORD_BUDGET = 200;
export const PUBLIC_DOMAIN_STUDY_WORD_BUDGET = 2000;
const documents = new Map(policy.documents.map(document => [document.url, Object.freeze(document)]));
if (policy.schemaVersion !== 1 || documents.size !== policy.documents.length || policy.documents.length > 500 || policy.documents.some(document =>
  !/^https:\/\//.test(document.url || '') || document.url.includes('#') ||
  !Array.isArray(document.organizations) || !document.organizations.length || document.organizations.some(value => typeof value !== 'string' || !value.trim()) ||
  !Array.isArray(document.kinds) || !document.kinds.length || document.kinds.some(kind => !['clinical-guideline', 'official-recommendation', 'official-clinical-reference'].includes(kind)) ||
  !['public-domain-mmwr', 'public-domain-government', 'cc-by-4.0', 'cc-by-unversioned'].includes(document.basis) ||
  !/^https:\/\//.test(document.policyUrl || '') || !Number.isFinite(day(document.checkedAt)) ||
  !Number.isInteger(document.wordBudget) || document.wordBudget < 200 || document.wordBudget > 5000
)) throw new Error('Invalid document reuse policy.');
const rightsKeys = ['basis', 'policyUrl', 'checkedAt', 'commercialClinicalApproval'];
function day(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value ? timestamp : NaN;
}
export function verifiedStudySourceReuse(source, { now = Date.now() } = {}) {
  const rights = source?.rights;
  const document = documents.get(source?.url);
  return Number.isFinite(now) && document !== undefined &&
    document.organizations.includes(source?.organization) && document.kinds.includes(source?.kind) &&
    (source?.reuse === 'original-summary-no-full-text' ||
      (source?.reuse === 'licensed-text-excerpt' && document.basis.startsWith('cc-by-')) ||
      (source?.reuse === 'public-domain-text-excerpt' && document.basis.startsWith('public-domain-') && typeof source.attribution === 'string' && source.attribution.trim().length > 0 && source.attribution.length <= 1000)) &&
    rights !== null && typeof rights === 'object' && !Array.isArray(rights) &&
    Object.keys(rights).length === rightsKeys.length && rightsKeys.every(key => Object.hasOwn(rights, key)) &&
    rights.basis === document.basis && rights.policyUrl === document.policyUrl &&
    rights.commercialClinicalApproval === false && Number.isFinite(day(rights.checkedAt)) &&
    day(document.checkedAt) <= day(rights.checkedAt) && day(rights.checkedAt) <= now && Number.isFinite(day(source.checkedAt)) &&
    // Permission review and medical currency are independent dated checks.
    // A later rights review must never require renewing an older source check.
    day(source.checkedAt) <= now &&
    (!rights.basis.startsWith('cc-by-') || (
      typeof source.attribution === 'string' && source.attribution.trim().length > 0 && source.attribution.length <= 1000 &&
      typeof source.derivativeNotice === 'string' && source.derivativeNotice.trim().length > 0 && source.derivativeNotice.length <= 600
    ));
}
export function sourceEditorialWordBudget(source, options) {
  return verifiedStudySourceReuse(source, options) ? documents.get(source.url).wordBudget : CONCISE_SOURCE_WORD_BUDGET;
}
export function knownStudySourceReuseUrl(value) { return typeof value === 'string' && documents.has(value); }
