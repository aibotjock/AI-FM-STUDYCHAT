import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { loadStudyCurriculum } from '../server/study-curriculum.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const names = ['cardiometabolic.json', 'respiratory_infectious.json', 'neuro_msk_derm.json', 'women_children_prevention.json', 'common_additions.json'];
const problems = [];
const files = names.map(name => {
  const body = readFileSync(resolve(root, 'content/conditions', name), 'utf8');
  const parsed = JSON.parse(body);
  if (name !== 'common_additions.json' && parsed.conditions.length !== 25) problems.push(`${name}: expected 25 conditions.`);
  if (name === 'common_additions.json' && parsed.conditions.length < 5) problems.push(`${name}: expected at least five additional conditions.`);
  return { name, parsed, sha256: createHash('sha256').update(body).digest('hex') };
});
const records = files.flatMap(file => file.parsed.conditions);
const curriculum = loadStudyCurriculum({ contentDir: resolve(root, 'content/conditions') });
const catalog = curriculum.list();
if (curriculum.rejected.length) problems.push(...curriculum.rejected.map(item => `${item.id}: ${item.problems.join(' ')}`));
if (catalog.total < 100 || catalog.currentCount !== catalog.total) problems.push('Expected at least 100 accepted conditions, all currently eligible.');
if (catalog.questionCount < 2 * catalog.total) problems.push('Expected at least two original questions for every condition.');
const questionKeys = new Set();
const stems = new Set();
const positions = Object.fromEntries('ABCDE'.split('').map(letter => [letter, 0]));
const domains = Object.fromEntries(['acute', 'chronic', 'emergent', 'preventive', 'foundations'].map(domain => [domain, 0]));
let sections = 0;
for (const record of records) {
  sections += record.sections.length;
  if (record.review.checkedAt !== files.find(file => file.parsed.conditions.includes(record)).parsed.checkedAt) problems.push(`${record.id}: envelope check date mismatch.`);
  for (const question of record.questions) {
    const key = `${record.id}:${question.id}`;
    if (questionKeys.has(key)) problems.push(`${key}: duplicate key.`);
    questionKeys.add(key);
    const stem = question.stem.toLowerCase().replace(/\s+/g, ' ').trim();
    if (stems.has(stem)) problems.push(`${key}: identical question stem.`);
    stems.add(stem);
    if (question.choices.map(choice => choice.id).join('') !== 'ABCDE') problems.push(`${key}: choices must be labeled A through E.`);
    const expectedDistractors = question.choices.filter(choice => choice.id !== question.correctChoiceId).map(choice => choice.id).sort().join('');
    if (Object.keys(question.distractorExplanations).sort().join('') !== expectedDistractors) problems.push(`${key}: distractor rationale map mismatch.`);
    positions[question.correctChoiceId]++;
    domains[question.domain]++;
    const result = curriculum.answer(record.id, question.id, question.correctChoiceId);
    const card = curriculum.card(record.id, question.id);
    if (!result?.correct || !result.current || result.humanReview !== false || !result.sources.length || !card?.current || !card.sourceVerified || card.verified !== false || card.front.length > 2000 || card.back.length > 4000) problems.push(`${key}: canonical answer/card integrity failed.`);
    const detail = curriculum.get(record.id);
    if (!detail) problems.push(`${key}: condition was rejected.`);
    else if (detail.questions.some(item => 'correctChoiceId' in item || 'rationale' in item || item.choices.some(choice => 'explanation' in choice))) problems.push(`${key}: answer leaked before grading.`);
  }
}
if (Object.values(positions).some(count => count < catalog.questionCount * 0.1)) problems.push('Correct-answer positions have a severe distribution bias.');
const referenceOnly = catalog.conditions.filter(condition => !condition.formalGuideline).map(condition => ({ id: condition.id, name: condition.title }));
if (catalog.total - referenceOnly.length < 100) problems.push('Expected at least 100 conditions with formal guideline or official recommendation evidence; reference-only gaps must remain explicit.');
const sources = new Map();
const sourceWords = new Map();
for (const record of records) for (const source of record.sources) {
  const entry = sources.get(source.url) || { url: source.url, organization: source.organization, kind: source.kind, conditions: [] };
  entry.conditions.push(record.id);
  sources.set(source.url, entry);
}
for (const record of records) {
  const urls = new Map(record.sources.map(source => [source.id, source.url]));
  const count = (text, ids) => {
    for (const sourceId of ids) {
      const url = urls.get(sourceId);
      sourceWords.set(url, (sourceWords.get(url) || 0) + text.trim().split(/\s+/).length);
    }
  };
  for (const section of record.sections) count(section.text, section.sourceIds);
  for (const question of record.questions) count([question.explanation, ...Object.values(question.distractorExplanations), question.choices.find(choice => choice.id === question.correctChoiceId).text].join(' '), question.sourceIds);
}
for (const [url, words] of sourceWords) if (words > 200) problems.push(`${url}: combined attributed factual teaching/rationale text exceeds the 200-word concise-source budget (${words}).`);
const manifest = {
  schemaVersion: 1, checkedAt: records.map(record => record.review.checkedAt).sort()[0],
  purpose: 'Personal educational pilot; source checks are not clinician approval, rights clearance or a medical accuracy certification.',
  scope: 'At least 100 curated common or high-yield family medicine conditions, not a prevalence ranking or complete exam syllabus.',
  conditions: catalog.total, currentConditions: catalog.currentCount, questions: catalog.questionCount, sections,
  formalGuidelineConditions: catalog.total - referenceOnly.length, officialReferenceOnlyConditions: referenceOnly,
  distinctSourceUrls: sources.size, maximumAttributedFactualWordsPerUrl: Math.max(...sourceWords.values()), questionDomains: domains, correctAnswerPositions: positions,
  clinicalApproval: false, humanReviewed: false, commercialApprovedRecords: 0,
  files: files.map(({ name, sha256 }) => ({ path: `content/conditions/${name}`, sha256 })),
  sources: [...sources.values()].sort((a, b) => a.url.localeCompare(b.url)),
};
if (problems.length) {
  console.error(JSON.stringify({ ok: false, problems }, null, 2));
  process.exitCode = 1;
} else {
  if (process.argv.includes('--write-manifest')) {
    writeFileSync(resolve(root, 'content/curriculum-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    const lines = ['# Condition coverage', '', `Source checks: ${manifest.checkedAt}. ${manifest.conditions} conditions, ${manifest.questions} original questions and ${sections} original teaching sections.`, '', `Formal guideline or official recommendation evidence: ${manifest.formalGuidelineConditions} conditions. Official clinical reference only: ${referenceOnly.length}. These labels do not establish independent clinician review or commercial rights.`, '', 'This is a curated high-yield selection, not an epidemiological ranking of the top 100 or a proportionally balanced ABFM mock examination. Source links are free at their originating sites; the app is independent and does not imply endorsement.', '', '| Condition | Primary domain | Questions | Source coverage |', '| --- | --- | ---: | --- |'];
    for (const condition of catalog.conditions) lines.push(`| ${condition.title.replaceAll('|', '/')} | ${condition.domain} | ${condition.questionCount} | ${condition.formalGuideline ? 'Guideline / official recommendation' : '**Official reference only — guideline gap**'} |`);
    lines.push('', 'Detailed editions, populations, locators, jurisdictions and limitations are stored in each condition record and displayed in the app. See the four source-audit reports for blocked and excluded sources.');
    writeFileSync(resolve(root, 'docs/CONDITION_COVERAGE.md'), `${lines.join('\n')}\n`);
  }
  console.log(JSON.stringify({ ok: true, conditions: manifest.conditions, currentConditions: manifest.currentConditions, questions: manifest.questions, sections, formalGuidelineConditions: manifest.formalGuidelineConditions, referenceOnly, distinctSourceUrls: sources.size, questionDomains: domains, correctAnswerPositions: positions, paidCalls: 0 }, null, 2));
}
