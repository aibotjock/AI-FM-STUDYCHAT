import policy from '../content/evidence-policy.json' with { type: 'json' };

export const EVIDENCE_POLICY_VERSION = 'study-evidence-policy-v1';
const roles = new Set(['generator', 'reviewer']);

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function validateCanonicalPolicy() {
  if (policy.schemaVersion !== 1 || policy.policyVersion !== EVIDENCE_POLICY_VERSION || policy.clinicalUseAllowed !== false ||
      typeof policy.title !== 'string' || typeof policy.intendedUse !== 'string' || !Array.isArray(policy.rules) || !policy.rules.length ||
      policy.rules.some(rule => !rule || typeof rule.id !== 'string' || !rule.id || typeof rule.instruction !== 'string' || !rule.instruction.trim()) ||
      new Set(policy.rules.map(rule => rule.id)).size !== policy.rules.length ||
      [...roles].some(role => !Array.isArray(policy.roleInstructions?.[role]) || !policy.roleInstructions[role].length || policy.roleInstructions[role].some(instruction => typeof instruction !== 'string' || !instruction.trim())) ||
      !policy.publicMetadata || typeof policy.publicMetadata !== 'object' || Array.isArray(policy.publicMetadata)) {
    throw new TypeError('The canonical evidence policy is invalid or unsupported.');
  }
  freeze(policy);
}

validateCanonicalPolicy();

/** Explicit unknown versions fail; a version label never supplies approval. */
export function assertEvidencePolicyVersion(version) {
  if (version !== EVIDENCE_POLICY_VERSION) throw new TypeError('Unsupported evidence policy version.');
  return version;
}

function selectedVersion(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => key !== 'version')) {
    throw new TypeError('Evidence policy options accept only a version.');
  }
  return assertEvidencePolicyVersion(Object.hasOwn(options, 'version') ? options.version : EVIDENCE_POLICY_VERSION);
}

/** Canonical safety instructions; retain the host schema, context and validators. */
export function evidencePolicyInstructions(role, options = {}) {
  const version = selectedVersion(options);
  if (!roles.has(role)) throw new TypeError('Unsupported evidence policy role.');
  return [
    `EVIDENCE_POLICY_VERSION=${version}`,
    `Scope: ${policy.intendedUse}.`,
    ...policy.rules.map(rule => `[${rule.id}] ${rule.instruction}`),
    ...policy.roleInstructions[role],
  ].join('\n');
}

/** Nonsecret, context-free transparency metadata; contains no trust grant. */
export function publicEvidencePolicy(options = {}) {
  selectedVersion(options);
  return freeze({
    schemaVersion: policy.schemaVersion,
    policyVersion: policy.policyVersion,
    title: policy.title,
    intendedUse: policy.intendedUse,
    clinicalUseAllowed: policy.clinicalUseAllowed,
    ruleIds: policy.rules.map(rule => rule.id),
    ...structuredClone(policy.publicMetadata),
  });
}
