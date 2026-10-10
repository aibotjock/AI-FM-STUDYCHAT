import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createStudyCurriculum, validateStudyCondition, studyRecordType, STUDY_CONDITION_FILES, STUDY_OPTIONAL_CONDITION_FILES } from '../server/study-curriculum.js';
import { sourceEditorialWordBudget, CONCISE_SOURCE_WORD_BUDGET } from '../shared/source-reuse.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const names = STUDY_CONDITION_FILES;
const ineligibleStatuses = new Set(['withdrawn', 'unresolved-conflict', 'blocked', 'superseded']);

function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value ? timestamp : NaN;
}

function statusReasons(record) {
  const reasons = [];
  for (const [location, item] of [['condition', record], ['review', record?.review], ...(Array.isArray(record?.sources) ? record.sources.map(source => [`source ${source?.id || '(unknown)'}`, source]) : [])]) {
    if (ineligibleStatuses.has(item?.status)) reasons.push(`${location}: ${item.status}`);
  }
  return reasons;
}

// Strip only known eligibility flags from a private validation copy. No dates,
// source permissions, URLs, content or persisted records are changed.
function structuralCopy(record) {
  const copy = structuredClone(record);
  for (const item of [copy, copy?.review, ...(Array.isArray(copy?.sources) ? copy.sources : [])]) {
    if (item && ineligibleStatuses.has(item.status)) delete item.status;
  }
  return copy;
}

/** A quarantine pass is maintenance integrity, never a fully current readiness claim. */
export function validateMaintenanceCorpus({ records, files = [], now = Date.now(), allowQuarantine = false, minimumConditions = 100, minimumFormalConditions = 100, minimumCorrectPositionShare = 0.1 } = {}) {
  if (!Array.isArray(records) || records.length > 500 || !Number.isFinite(now)) throw new TypeError('Use bounded study records and a valid validation time.');
  const problems = [];
  const structuralRecords = [];
  for (const record of records) {
    const errors = validateStudyCondition(structuralCopy(record), { now });
    const statusObjects = [record, record?.review, ...(Array.isArray(record?.sources) ? record.sources : [])];
    if (statusObjects.some(item => item?.status !== undefined && !ineligibleStatuses.has(item.status))) errors.push('Unknown content/source status; do not infer eligibility.');
    if (errors.length) problems.push(...errors.map(error => `${record?.id || '(unknown)'}: ${error}`));
    else structuralRecords.push(record);
  }
  const runtime = createStudyCurriculum({ records, now });
  const structural = createStudyCurriculum({ records: structuralRecords.map(structuralCopy), now });
  if (structural.rejected.length) problems.push(...structural.rejected.map(item => `${item.id}: ${item.problems.join(' ')}`));
  if (!allowQuarantine && runtime.rejected.length) problems.push(...runtime.rejected.map(item => `${item.id}: ${item.problems.join(' ')}`));
  const catalog = runtime.list();
  const detailById = new Map(structuralRecords.map(record => [record.id, runtime.get(record.id)]));
  const quarantine = structuralRecords.map(record => {
    const reasons = statusReasons(record);
    const detail = detailById.get(record.id);
    if (detail && !detail.current) reasons.push(`source check expired ${detail.expiresAt} (UTC)`);
    return reasons.length ? { id: record.id, name: record.name, questionCount: record.questions.length, reasons } : null;
  }).filter(Boolean);
  const quarantinedIds = new Set(quarantine.map(item => item.id));
  const currentRecords = structuralRecords.filter(record => detailById.get(record.id)?.current && !quarantinedIds.has(record.id));
  const diseaseRecords = records.filter(record => studyRecordType(record) === 'condition');
  const currentDiseases = currentRecords.filter(record => studyRecordType(record) === 'condition');
  const formal = record => studyRecordType(record) === 'condition' && record.sources.some(source => ['clinical-guideline', 'official-recommendation'].includes(source.kind));
  const formalCount = structuralRecords.filter(formal).length;
  const currentFormalCount = currentRecords.filter(formal).length;
  if (diseaseRecords.length < minimumConditions) problems.push(`Expected at least ${minimumConditions} disease conditions in the inventory; study topics do not count as diagnoses.`);
  if (!allowQuarantine && (currentDiseases.length < minimumConditions || catalog.currentCount !== records.length)) problems.push('Expected all inventory records to be accepted and currently eligible, including the minimum disease conditions.');
  if (formalCount < minimumFormalConditions || (!allowQuarantine && currentFormalCount < minimumFormalConditions)) problems.push(`Expected at least ${minimumFormalConditions} conditions with formal guideline or official recommendation evidence; reference-only gaps must remain explicit.`);

  const questionKeys = new Set();
  const stems = new Set();
  const positions = Object.fromEntries('ABCDE'.split('').map(letter => [letter, 0]));
  const domains = Object.fromEntries(['acute', 'chronic', 'emergent', 'preventive', 'foundations'].map(domain => [domain, 0]));
  let sections = 0;
  let questionCount = 0;
  for (const record of structuralRecords) {
    sections += record.sections.length;
    const envelope = files.find(file => file.parsed.conditions.includes(record));
    // The envelope records the earliest check in a mixed-date file. Adding
    // newly checked material must not renew unchanged source review dates.
    if (envelope && date(record.review.checkedAt) < date(envelope.parsed.checkedAt)) problems.push(`${record.id}: review precedes envelope check date.`);
    const detail = structural.get(record.id);
    if (detail?.questions.some(item => 'correctChoiceId' in item || 'rationale' in item || item.choices.some(choice => 'explanation' in choice))) problems.push(`${record.id}: answer leaked before grading.`);
    for (const question of record.questions) {
      questionCount++;
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
      const result = runtime.answer(record.id, question.id, question.correctChoiceId);
      const card = runtime.card(record.id, question.id);
      if (quarantinedIds.has(record.id)) {
        if (result?.current || card?.current) problems.push(`${key}: quarantined question/card is incorrectly current.`);
      } else if (!result?.correct || !result.current || result.humanReview !== false || !result.sources.length || !card?.current || !card.sourceVerified || card.verified !== false || card.front.length > 2000 || card.back.length > 4000) problems.push(`${key}: canonical answer/card integrity failed.`);
    }
    if (quarantinedIds.has(record.id) && runtime.retrieve(record.name, { conditionIds: [record.id] }).some(chunk => chunk.conditionId === record.id)) problems.push(`${record.id}: quarantined content supplied current retrieval evidence.`);
  }
  if (questionCount < 2 * records.length) problems.push('Expected at least two original questions for every condition.');
  if (Object.values(positions).some(count => count < questionCount * minimumCorrectPositionShare)) problems.push('Correct-answer positions have a severe distribution bias.');
  const referenceOnly = structuralRecords.filter(record => studyRecordType(record) === 'condition' && !formal(record)).map(record => ({ id: record.id, name: record.name }));
  const sources = new Map();
  const sourceWords = new Map();
  const sourceBudgets = new Map();
  for (const record of structuralRecords) for (const source of record.sources) {
    const budget = sourceEditorialWordBudget(source, { now });
    // Rights attach to the exact document, independently of the dates on an
    // older citation to that same document. One validated grant can establish
    // its editorial budget; a different, restricted co-source stays bounded.
    sourceBudgets.set(source.url, Math.max(sourceBudgets.get(source.url) ?? 0, budget));
    const entry = sources.get(source.url) || { url: source.url, organization: source.organization, kind: source.kind, conditions: [] };
    entry.conditions.push(record.id);
    sources.set(source.url, entry);
  }
  for (const record of structuralRecords) {
    const urls = new Map(record.sources.map(source => [source.id, source.url]));
    const count = (text, ids) => {
      for (const sourceId of ids) {
        const url = urls.get(sourceId);
        sourceWords.set(url, (sourceWords.get(url) || 0) + text.trim().split(/\s+/).length);
      }
    };
    for (const section of record.sections) count(section.text, section.sourceIds);
    for (const question of record.questions) {
      const expanded = question.sourceIds.some(id => (sourceBudgets.get(urls.get(id)) ?? 0) > CONCISE_SOURCE_WORD_BUDGET);
      count([...(expanded ? [question.stem, ...question.choices.map(choice => choice.text)] : [question.choices.find(choice => choice.id === question.correctChoiceId).text]), question.explanation, ...Object.values(question.distractorExplanations)].join(' '), question.sourceIds);
    }
  }
  for (const [url, words] of sourceWords) {
    const budget = sourceBudgets.get(url) ?? CONCISE_SOURCE_WORD_BUDGET;
    if (words > budget) problems.push(`${url}: combined attributed factual teaching/rationale text exceeds the ${budget}-word ${budget === CONCISE_SOURCE_WORD_BUDGET ? 'concise-source' : 'verified-document'} budget (${words}).`);
  }
  const manifest = {
    schemaVersion: 1, checkedAt: structuralRecords.map(record => record.review.checkedAt).sort()[0] || null,
    purpose: 'Educational board-study tool only; not medical advice or for clinical use. Source checks are not clinician approval, rights clearance or a medical accuracy certification.',
    scope: 'Disease-reference curriculum plus separate preventive/lifespan study topics: at least 100 diagnoses, not a prevalence ranking or the complete exam syllabus.',
    conditions: diseaseRecords.length, acceptedConditions: structuralRecords.filter(record => studyRecordType(record) === 'condition' && detailById.get(record.id)).length, currentConditions: currentDiseases.length, quarantinedConditions: quarantine.filter(record => diseaseRecords.some(disease => disease.id === record.id)).length,
    studyTopics: records.filter(record => studyRecordType(record) === 'study-topic').length, currentStudyTopics: currentRecords.filter(record => studyRecordType(record) === 'study-topic').length,
    foundationTopics: records.filter(record => studyRecordType(record) === 'foundation').length, inventoryRecords: records.length, acceptedRecords: catalog.total, currentRecords: currentRecords.length, quarantinedRecords: quarantine.length,
    questions: questionCount, currentQuestions: currentRecords.reduce((sum, record) => sum + record.questions.length, 0), quarantinedQuestions: quarantine.reduce((sum, record) => sum + record.questionCount, 0), sections,
    formalGuidelineConditions: formalCount, currentFormalGuidelineConditions: currentFormalCount, officialReferenceOnlyConditions: referenceOnly, quarantine,
    distinctSourceUrls: sources.size, maximumAttributedFactualWordsPerUrl: Math.max(0, ...sourceWords.values()), questionDomains: domains, correctAnswerPositions: positions,
    sourceEditorialBudgets: [...sourceBudgets].filter(([, budget]) => budget > CONCISE_SOURCE_WORD_BUDGET).map(([url, budget]) => ({ url, wordBudget: budget, clinicalApproval: false })),
    validationMode: allowQuarantine ? 'maintenance-allow-quarantine' : 'strict-current-readiness', fullyCurrent: currentRecords.length === records.length && !problems.length,
    clinicalApproval: false, humanReviewed: false, commercialApprovedRecords: 0,
    files: files.map(({ name, sha256 }) => ({ path: `content/conditions/${name}`, sha256 })),
    sources: [...sources.values()].sort((a, b) => a.url.localeCompare(b.url)),
  };
  return { ok: !problems.length, problems: [...new Set(problems)], manifest };
}

function readCorpus(rootDir, now) {
  let bytes = 0;
  return names.filter(name => !STUDY_OPTIONAL_CONDITION_FILES.includes(name) || existsSync(resolve(rootDir, 'content/conditions', name))).map(name => {
    const body = readFileSync(resolve(rootDir, 'content/conditions', name), 'utf8');
    bytes += Buffer.byteLength(body);
    if (Buffer.byteLength(body) > 2 * 1024 * 1024 || bytes > 8 * 1024 * 1024) throw new Error('Study corpus exceeds its bounded file limits.');
    const parsed = JSON.parse(body);
    if (!parsed || parsed.schemaVersion !== 1 || !Number.isFinite(date(parsed.checkedAt)) || date(parsed.checkedAt) > now || !Array.isArray(parsed.conditions) || parsed.conditions.length > 125) throw new Error(`${name}: invalid study corpus envelope.`);
    if (name !== 'common_additions.json' && !STUDY_OPTIONAL_CONDITION_FILES.includes(name) && parsed.conditions.length !== 25) throw new Error(`${name}: expected 25 conditions.`);
    if (name === 'common_additions.json' && parsed.conditions.length < 5) throw new Error(`${name}: expected at least five additional conditions.`);
    if (STUDY_OPTIONAL_CONDITION_FILES.includes(name) && parsed.conditions.length < 1) throw new Error(`${name}: expected at least one additional study condition.`);
    return { name, parsed, sha256: createHash('sha256').update(body).digest('hex') };
  });
}

function writeReports(rootDir, manifest, validatedRecords) {
  writeFileSync(resolve(rootDir, 'content/curriculum-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const lines = ['# Condition coverage', '', `Source checks begin: ${manifest.checkedAt}. Inventory: ${manifest.conditions} disease conditions and ${manifest.studyTopics} additional study topics, ${manifest.questions} original questions and ${manifest.sections} original teaching sections.`, '', `Currently eligible: ${manifest.currentConditions} disease conditions, ${manifest.currentStudyTopics} study topics and ${manifest.currentQuestions} questions. Quarantined: ${manifest.quarantinedRecords} records and ${manifest.quarantinedQuestions} questions. Validation mode: ${manifest.validationMode}; fully current: ${manifest.fullyCurrent}.`, '', `Formal guideline or official recommendation evidence: ${manifest.formalGuidelineConditions} inventory conditions (${manifest.currentFormalGuidelineConditions} current). Official clinical reference only: ${manifest.officialReferenceOnlyConditions.length}. These labels do not establish independent clinician review or commercial rights.`, '', 'Study tool only; not medical advice or for clinical use. This is a curated high-yield selection, not an epidemiological ranking or a proportionally balanced ABFM mock examination. Source links are free at their originating sites; the app is independent and does not imply endorsement.', '', '| Condition or study topic | Primary domain | Questions | Source coverage | Eligibility |', '| --- | --- | ---: | --- | --- |'];
  const records = [...validatedRecords].sort((a, b) => a.name.localeCompare(b.name));
  const quarantine = new Map(manifest.quarantine.map(record => [record.id, record.reasons]));
  for (const condition of records) lines.push(`| ${condition.name.replaceAll('|', '/')} | ${condition.domain} | ${condition.questions.length} | ${condition.sources.some(source => ['clinical-guideline', 'official-recommendation'].includes(source.kind)) ? 'Guideline / official recommendation' : '**Official reference only — guideline gap**'} | ${quarantine.has(condition.id) ? `**Quarantined:** ${quarantine.get(condition.id).join('; ').replaceAll('|', '/')}` : 'Current source check; clinician review pending'} |`);
  lines.push('', 'Detailed editions, populations, locators, jurisdictions and limitations are stored in each condition record and displayed in the app. See the source-audit reports for blocked and excluded sources. Quarantined records remain in the inventory but cannot supply current RAG evidence or current canonical grading/cards.');
  writeFileSync(resolve(rootDir, 'docs/CONDITION_COVERAGE.md'), `${lines.join('\n')}\n`);
}

export function runMaintenanceCli(args = process.argv.slice(2), { rootDir = root, now = Date.now(), output = console.log, error = console.error } = {}) {
  try {
    if (args.some(argument => !['--write-manifest', '--allow-quarantine'].includes(argument))) throw new Error('Use only --write-manifest and/or --allow-quarantine.');
    const files = readCorpus(rootDir, now);
    const records = files.flatMap(file => file.parsed.conditions);
    const result = validateMaintenanceCorpus({ records, files, now, allowQuarantine: args.includes('--allow-quarantine') });
    if (!result.ok) { error(JSON.stringify({ ok: false, problems: result.problems }, null, 2)); return 1; }
    if (args.includes('--write-manifest')) writeReports(rootDir, result.manifest, records);
    const { sources, files: fileHashes, ...summary } = result.manifest;
    output(JSON.stringify({ ok: true, ...summary, paidCalls: 0 }, null, 2));
    return 0;
  } catch (exception) {
    error(JSON.stringify({ ok: false, problems: [exception.message] }, null, 2));
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = runMaintenanceCli();
