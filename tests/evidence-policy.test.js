import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EVIDENCE_POLICY_VERSION, assertEvidencePolicyVersion, evidencePolicyInstructions, publicEvidencePolicy } from '../shared/evidence-policy.js';

test('canonical policy binds every rule and role to its supported explicit version', () => {
  const canonical = JSON.parse(readFileSync(new URL('../content/evidence-policy.json', import.meta.url), 'utf8'));
  assert.equal(canonical.policyVersion, EVIDENCE_POLICY_VERSION);
  assert.equal(canonical.clinicalUseAllowed, false);
  assert.equal(assertEvidencePolicyVersion(canonical.policyVersion), EVIDENCE_POLICY_VERSION);
  for (const role of ['generator', 'reviewer']) {
    const instructions = evidencePolicyInstructions(role);
    assert.ok(instructions.startsWith(`EVIDENCE_POLICY_VERSION=${EVIDENCE_POLICY_VERSION}\n`));
    for (const rule of canonical.rules) assert.ok(instructions.includes(`[${rule.id}] ${rule.instruction}`));
    for (const instruction of canonical.roleInstructions[role]) assert.ok(instructions.includes(instruction));
  }
});

test('unknown versions or roles cannot silently weaken the active policy', () => {
  for (const version of [undefined, null, '', 1, {}, 'study-evidence-policy-v0', 'study-evidence-policy-v2', 'PRIVATE-UNKNOWN-VERSION']) {
    assert.throws(() => assertEvidencePolicyVersion(version), /Unsupported evidence policy version\./);
    assert.throws(() => evidencePolicyInstructions('generator', { version }), /Unsupported evidence policy version\./);
    assert.throws(() => publicEvidencePolicy({ version }), /Unsupported evidence policy version\./);
  }
  for (const role of ['assistant', 'self-review', '', null, undefined, {}]) assert.throws(() => evidencePolicyInstructions(role), /Unsupported evidence policy role\./);
});

test('instruction builders reject client approvals, source replacements and private context', () => {
  for (const options of [null, [], 'v1', { approved: true }, { version: EVIDENCE_POLICY_VERSION, source: 'PRIVATE-CONTEXT' }, { userId: 'PRIVATE-ACCOUNT' }]) {
    assert.throws(() => evidencePolicyInstructions('generator', options), /accept only a version/);
    assert.throws(() => publicEvidencePolicy(options), /accept only a version/);
  }
});

test('generator and independent reviewer preserve exact support, context, abstention and natural social chat', () => {
  const generator = evidencePolicyInstructions('generator');
  const reviewer = evidencePolicyInstructions('reviewer');
  for (const instructions of [generator, reviewer]) {
    for (const required of ['Every external factual claim', 'exact supplied current authoritative source support', 'population, setting, jurisdiction', 'deterministic span/freshness validation', 'memory', 'invent', 'ordinary social chat', 'never agree to appease', 'not qualified clinical approval']) assert.ok(instructions.includes(required), required);
    assert.match(instructions, /Failure to find support does not prove a claim false/);
  }
  assert.match(generator, /Empty evidence permits nonfactual conversation/);
  assert.match(reviewer, /every original segment, external claim and implicit premise/);
  assert.match(reviewer, /never rewrite or invent support/);
  assert.match(reviewer, /any failing claim rejects the whole reply/);
});

test('public metadata is context-free and refuses accuracy, competence, rights or clinician approval claims', () => {
  const metadata = publicEvidencePolicy();
  assert.equal(metadata.policyVersion, EVIDENCE_POLICY_VERSION);
  assert.equal(metadata.clinicalUseAllowed, false);
  assert.equal(metadata.automatedReviewIsClinicalApproval, false);
  assert.equal(metadata.learnerMemoryIsAuthoritativeEvidence, false);
  assert.equal(metadata.guaranteedAccuracy, false);
  assert.equal(metadata.completeSourceCoverageGuaranteed, false);
  assert.equal(metadata.competenceOrExamPassPredictionsAllowed, false);
  assert.equal(metadata.commercialReleaseRequiresSeparateRightsAndQualifiedClinicalReview, true);
  assert.equal(Object.hasOwn(metadata, 'rules'), false);
  assert.equal(Object.hasOwn(metadata, 'roleInstructions'), false);
  assert.doesNotMatch(JSON.stringify(metadata), /api[_-]?key|credentials|conversationId|sourceChunkIds|learnerRequest|PRIVATE-/i);
  assert.ok(metadata.limitations.some(limitation => limitation.includes('a prompt alone cannot enforce accuracy')));
});

test('callers cannot mutate public metadata and later alter instructions or policy declarations', () => {
  const before = evidencePolicyInstructions('reviewer');
  const metadata = publicEvidencePolicy();
  assert.ok(Object.isFrozen(metadata));
  assert.ok(Object.isFrozen(metadata.ruleIds));
  assert.ok(Object.isFrozen(metadata.limitations));
  assert.throws(() => { metadata.clinicalUseAllowed = true; }, TypeError);
  assert.throws(() => { metadata.ruleIds.push('client-approved'); }, TypeError);
  assert.throws(() => { metadata.limitations[0] = 'All medical answers are guaranteed accurate.'; }, TypeError);
  assert.equal(publicEvidencePolicy().clinicalUseAllowed, false);
  assert.equal(evidencePolicyInstructions('reviewer'), before);
});
