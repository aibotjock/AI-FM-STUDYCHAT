import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { STUDY_CONDITION_FILES, loadStudyCurriculum, loadStudyFoundations, combineStudyCurricula, studyRecordType } from '../server/study-curriculum.js';
import { buildBoardAlignment } from '../server/board-alignment.js';
import { validateMaintenanceCorpus } from './validate-study-curriculum.js';
import { verifiedStudySourceReuse, knownStudySourceReuseUrl } from '../shared/source-reuse.js';

const ROOT = resolve(import.meta.dirname, '..');

/** Combined bank integrity and rights inventory; never clinical certification. */
export function validateBoardBank({ rootDir = ROOT, now = Date.now(), minimumQuestions = 400, allowQuarantine = false } = {}) {
  if (!Number.isInteger(minimumQuestions) || minimumQuestions < 1 || minimumQuestions > 48000) throw new TypeError('Use a bounded minimum question count.');
  const contentDir = resolve(rootDir, 'content/conditions');
  const foundationPath = resolve(rootDir, 'content/board-foundations.json');
  const curriculum = loadStudyCurriculum({ contentDir, now });
  const foundations = loadStudyFoundations({ contentPath: foundationPath, now });
  const paths = [...STUDY_CONDITION_FILES.map(name => resolve(contentDir, name)).filter(existsSync), foundationPath];
  const files = paths.map(path => {
    const body = readFileSync(path, 'utf8');
    return { name: path.slice(rootDir.length + 1), parsed: JSON.parse(body), sha256: createHash('sha256').update(body).digest('hex') };
  });
  const records = files.flatMap(file => file.parsed.conditions);
  const result = validateMaintenanceCorpus({ records, files, now, allowQuarantine });
  const combined = combineStudyCurricula([curriculum, foundations]);
  const questions = combined.boardQuestions();
  const problems = [...result.problems];
  const minimumCount = allowQuarantine ? result.manifest.questions : questions.length;
  if (minimumCount < minimumQuestions) problems.push(`Expected at least ${minimumQuestions} ${allowQuarantine ? 'inventory' : 'current'} original questions; found ${minimumCount}.`);
  let annotated = 0;
  let documented = 0;
  const unresolved = [];
  for (const record of records) for (const question of record.questions) {
    const sources = question.sourceIds.map(id => record.sources.find(source => source.id === id));
    if (sources.every(source => verifiedStudySourceReuse(source, { now }))) annotated++;
    if (sources.every(source => knownStudySourceReuseUrl(source?.url))) documented++;
    else unresolved.push(`${record.id}:${question.id}`);
  }
  return {
    ok: problems.length === 0, problems,
    manifest: {
      schemaVersion: 1, checkedAt: new Date(now).toISOString().slice(0, 10),
      purpose: 'Original family medicine board study only; not medical advice or clinical use.',
      conditions: records.filter(record => studyRecordType(record) === 'condition').length,
      studyTopics: records.filter(record => studyRecordType(record) === 'study-topic').length,
      foundationTopics: records.filter(record => studyRecordType(record) === 'foundation').length,
      inventoryQuestions: result.manifest.questions, currentQuestions: questions.length,
      currentQuestionScope: 'U.S. board-study pool; comparative-study questions remain in the library.',
      comparativeStudyQuestions: records.reduce((sum, record) => sum + record.questions.filter(question => question.examScope === 'comparative-study').length, 0),
      minimumQuestions, satisfiesMinimum: minimumCount >= minimumQuestions,
      minimumBasis: allowQuarantine ? 'inventory-with-explicit-quarantine' : 'current-us-board-study',
      currentMeetsMinimum: questions.length >= minimumQuestions,
      sections: result.manifest.sections, distinctSourceUrls: result.manifest.distinctSourceUrls,
      correctAnswerPositions: result.manifest.correctAnswerPositions,
      annotatedDocumentReuseQuestions: annotated, exactDocumentReuseAssessmentQuestions: documented,
      unresolvedDocumentReuseQuestionKeys: unresolved,
      rightsMeaning: 'Document-specific U.S. text reuse assessments, with exact CC BY attribution where applicable. These counts do not approve clinical facts, legacy item accuracy, international rights or commercial activation.',
      humanReviewed: false, commercialActivationApproved: false, clinicalAccuracyCertified: false,
      validationMode: result.manifest.validationMode, quarantine: result.manifest.quarantine,
      files: files.map(({ name, sha256 }) => ({ path: name, sha256 })),
      alignment: buildBoardAlignment(questions),
    },
  };
}

export function runBoardBankCli(args = process.argv.slice(2), { rootDir = ROOT, now = Date.now(), output = console.log, error = console.error } = {}) {
  try {
    if (args.some(argument => !['--write-manifest', '--allow-quarantine'].includes(argument))) throw new Error('Use only --write-manifest and/or --allow-quarantine.');
    const result = validateBoardBank({ rootDir, now, allowQuarantine: args.includes('--allow-quarantine') });
    if (!result.ok) { error(JSON.stringify({ ok: false, problems: result.problems }, null, 2)); return 1; }
    if (args.includes('--write-manifest')) writeFileSync(resolve(rootDir, 'content/board-bank-manifest.json'), JSON.stringify(result.manifest, null, 2) + '\n');
    const { alignment, files, unresolvedDocumentReuseQuestionKeys, ...summary } = result.manifest;
    output(JSON.stringify({ ok: true, ...summary, unresolvedDocumentReuseQuestions: unresolvedDocumentReuseQuestionKeys.length, domains: alignment.domains, poolFingerprint: alignment.poolFingerprint, paidCalls: 0 }, null, 2));
    return 0;
  } catch (exception) { error(JSON.stringify({ ok: false, problems: [exception.message] }, null, 2)); return 1; }
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) process.exitCode = runBoardBankCli();
