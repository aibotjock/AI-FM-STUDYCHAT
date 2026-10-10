import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateMaintenanceCorpus, runMaintenanceCli } from '../scripts/validate-study-curriculum.js';
import { studyCondition, STUDY_NOW } from './fixtures/study-condition.js';

function condition(number) {
  const record = studyCondition({ id: `mock-${number}`, name: `Mock condition ${number}`, aliases: [] });
  record.sources[0].url = `https://www.nhlbi.nih.gov/health/mock-${number}`;
  record.sources[0].kind = 'official-recommendation';
  record.questions.forEach((question, index) => {
    question.stem = `Mock condition ${number}, fictional vignette ${index}: select the supplied learning step.`;
    question.correctChoiceId = 'ABCDE'[(number * 2 + index) % 5];
    question.choices.forEach(choice => { choice.text = choice.id === question.correctChoiceId ? 'Review inhaler technique.' : `Mock alternative ${choice.id}.`; });
    question.distractorExplanations = Object.fromEntries(question.choices.filter(choice => choice.id !== question.correctChoiceId).map(choice => [choice.id, 'The mock reference does not support this alternative.']));
  });
  return record;
}

function expire(record) {
  record.review.checkedAt = '2026-09-01';
  record.review.expiresAt = '2026-10-01';
  record.sources.forEach(source => { source.checkedAt = '2026-09-01'; });
  return record;
}

const validate = (records, options = {}) => validateMaintenanceCorpus({ records, now: STUDY_NOW, minimumConditions: 2, minimumFormalConditions: 2, minimumCorrectPositionShare: 0, ...options });

test('strict mode remains a fully current readiness check with no inferred approval', () => {
  const result = validate([condition(1), condition(2)]);
  assert.equal(result.ok, true, result.problems.join('\n'));
  assert.equal(result.manifest.validationMode, 'strict-current-readiness');
  assert.equal(result.manifest.fullyCurrent, true);
  assert.equal(result.manifest.currentConditions, 2);
  assert.equal(result.manifest.currentQuestions, 4);
  assert.equal(result.manifest.clinicalApproval, false);
  assert.equal(result.manifest.humanReviewed, false);
  assert.equal(result.manifest.commercialApprovedRecords, 0);
});

test('expired material is explicit quarantine and never a current readiness pass', () => {
  const records = [expire(condition(1)), condition(2)];
  const before = JSON.stringify(records);
  assert.equal(validate(records).ok, false);
  const result = validate(records, { allowQuarantine: true });
  assert.equal(result.ok, true, result.problems.join('\n'));
  assert.equal(result.manifest.conditions, 2);
  assert.equal(result.manifest.currentConditions, 1);
  assert.equal(result.manifest.quarantinedConditions, 1);
  assert.equal(result.manifest.questions, 4);
  assert.equal(result.manifest.currentQuestions, 2);
  assert.equal(result.manifest.quarantinedQuestions, 2);
  assert.equal(result.manifest.currentFormalGuidelineConditions, 1);
  assert.equal(result.manifest.fullyCurrent, false);
  assert.match(result.manifest.quarantine[0].reasons[0], /expired 2026-10-01 \(UTC\)/);
  assert.equal(JSON.stringify(records), before, 'Maintenance must not rewrite check dates or flags.');
});

test('each known condition, review or source flag remains runtime-ineligible', () => {
  for (const status of ['withdrawn', 'unresolved-conflict', 'blocked', 'superseded']) for (const location of ['condition', 'review', 'source']) {
    const blocked = condition(1);
    const target = location === 'condition' ? blocked : location === 'review' ? blocked.review : blocked.sources[0];
    target.status = status;
    const result = validate([blocked, condition(2)], { allowQuarantine: true });
    assert.equal(result.ok, true, `${location}:${status}: ${result.problems.join('\n')}`);
    assert.equal(result.manifest.acceptedConditions, 1);
    assert.equal(result.manifest.currentConditions, 1);
    assert.equal(result.manifest.quarantinedConditions, 1);
    assert.ok(result.manifest.quarantine[0].reasons.some(reason => reason.includes(status)));
    assert.equal(validate([blocked, condition(2)]).ok, false);
  }
});

test('quarantine cannot launder corrupt permissions, hosts, dates, review or schema', () => {
  const mutations = [
    record => { record.sources[0].reuse = 'full-text-ai-permitted'; },
    record => { record.sources[0].url = 'https://nih.gov.attacker.example/guideline'; },
    record => { record.sources[0].checkedAt = '2026-02-30'; },
    record => { record.review.checkedAt = '2027-01-01'; },
    record => { record.review.humanReviewed = true; },
    record => { record.sections[0].sourceIds = ['invented-source']; },
    record => { record.sources[0].status = 'permission-restricted'; }
  ];
  for (const mutate of mutations) {
    const blocked = condition(1);
    blocked.status = 'blocked';
    mutate(blocked);
    const result = validate([blocked, condition(2)], { allowQuarantine: true });
    assert.equal(result.ok, false);
    assert.ok(result.problems.some(problem => problem.startsWith('mock-1:')));
  }
});

test('duplicate IDs and answer integrity still fail in maintenance mode', () => {
  const first = condition(1);
  first.status = 'withdrawn';
  assert.equal(validate([first, condition(1)], { allowQuarantine: true }).ok, false);
  const broken = condition(2);
  broken.questions[0].distractorExplanations[broken.questions[0].correctChoiceId] = 'Extra answer rationale';
  assert.equal(validate([first, broken], { allowQuarantine: true }).ok, false);
});

function temporaryCorpus() {
  const directory = mkdtempSync(join(tmpdir(), 'study-maintenance-'));
  mkdirSync(join(directory, 'content/conditions'), { recursive: true });
  mkdirSync(join(directory, 'docs'));
  const names = ['cardiometabolic.json', 'respiratory_infectious.json', 'neuro_msk_derm.json', 'women_children_prevention.json', 'common_additions.json'];
  for (const [index, name] of names.entries()) {
    const records = Array.from({ length: index === 4 ? 5 : 25 }, (_, offset) => condition(index * 25 + offset));
    if (index === 0) records[0].review.expiresAt = '2026-10-10';
    if (index === 1) records[0].sources[0].status = 'blocked';
    writeFileSync(join(directory, 'content/conditions', name), JSON.stringify({ schemaVersion: 1, checkedAt: '2026-10-09', conditions: records }));
  }
  return directory;
}

test('CLI writes honest partial coverage only under explicit quarantine mode', () => {
  const directory = temporaryCorpus();
  const output = [];
  const options = { rootDir: directory, now: STUDY_NOW + 86400000, output: value => output.push(JSON.parse(value)), error: value => output.push(JSON.parse(value)) };
  try {
    assert.equal(runMaintenanceCli(['--write-manifest'], options), 1);
    assert.equal(existsSync(join(directory, 'content/curriculum-manifest.json')), false);
    assert.equal(runMaintenanceCli(['--allow-quarantine', '--write-manifest'], options), 0);
    const manifest = JSON.parse(readFileSync(join(directory, 'content/curriculum-manifest.json')));
    assert.equal(manifest.conditions, 105);
    assert.equal(manifest.currentConditions, 103);
    assert.equal(manifest.quarantinedConditions, 2);
    assert.equal(manifest.questions, 210);
    assert.equal(manifest.currentQuestions, 206);
    assert.equal(manifest.fullyCurrent, false);
    assert.equal(manifest.validationMode, 'maintenance-allow-quarantine');
    assert.equal(manifest.files.length, 5);
    assert.equal(manifest.checkedAt, '2026-10-09');
    const coverage = readFileSync(join(directory, 'docs/CONDITION_COVERAGE.md'), 'utf8');
    assert.match(coverage, /Currently eligible: 103 disease conditions, 0 study topics and 206 questions/);
    assert.match(coverage, /Quarantined: 2 records and 4 questions/);
    assert.match(coverage, /Study tool only; not medical advice or for clinical use/);
    assert.match(coverage, /\*\*Quarantined:\*\*/);
    assert.equal(output.at(-1).paidCalls, 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('CLI refuses future envelope dates and never writes a corruption report as success', () => {
  const directory = temporaryCorpus();
  const file = join(directory, 'content/conditions/common_additions.json');
  const parsed = JSON.parse(readFileSync(file));
  parsed.checkedAt = '2027-01-01';
  writeFileSync(file, JSON.stringify(parsed));
  const errors = [];
  try {
    assert.equal(runMaintenanceCli(['--allow-quarantine', '--write-manifest'], { rootDir: directory, now: STUDY_NOW, output() {}, error: value => errors.push(JSON.parse(value)) }), 1);
    assert.equal(existsSync(join(directory, 'content/curriculum-manifest.json')), false);
    assert.match(errors[0].problems.join(' '), /invalid study corpus envelope/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
