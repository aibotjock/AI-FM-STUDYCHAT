import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { verifiedStudySourceReuse } from '../shared/source-reuse.js';

// Repository-owned, reviewed supplements only. A URL catalog never grants ingestion.
export const STUDY_REFERENCE_FILES = Object.freeze([
  'medlineplus-breadth.json', 'federal-clinical-depth.json', 'federal-specialty-passages.json',
  'licensed-specialty-passages.json',
]);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value);
function day(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value ? parsed : NaN;
}
const fail = message => { throw new Error(`Invalid reference expansion: ${message}`); };

/** Add passages without changing existing questions, their source bindings or review dates. */
export function mergeStudyReferences(records, supplements, { now = Date.now() } = {}) {
  const timestamp = typeof now === 'function' ? now() : now;
  if (!Array.isArray(records) || !Array.isArray(supplements) || supplements.length > STUDY_REFERENCE_FILES.length || !Number.isFinite(timestamp)) fail('bounded records and time required.');
  const result = structuredClone(records), byId = new Map(result.map(record => [record.id, record]));
  const added = new Set();
  for (const supplement of supplements) {
    if (!object(supplement) || supplement.schemaVersion !== 1 || !Number.isFinite(day(supplement.checkedAt)) || day(supplement.checkedAt) > timestamp || !Array.isArray(supplement.conditions) || supplement.conditions.length > 125) fail('invalid envelope.');
    const targets = new Set();
    for (const patch of supplement.conditions) {
      const record = byId.get(patch?.conditionId);
      if (!object(patch) || !id(patch.conditionId) || !record || targets.has(patch.conditionId) || !Array.isArray(patch.sources) || !patch.sources.length || patch.sources.length > 8 || !Array.isArray(patch.sections) || !patch.sections.length || patch.sections.length > 12) fail('unknown, duplicate or unbounded target.');
      targets.add(patch.conditionId);
      const sources = new Map();
      for (const source of patch.sources) {
        if (!id(source?.id) || sources.has(source.id) || record.sources.some(existing => existing.id === source.id) || !verifiedStudySourceReuse(source, { now: timestamp }) || day(source.checkedAt) < day(supplement.checkedAt) || typeof source.attribution !== 'string' || !source.attribution.trim()) fail('unverified exact-document rights, attribution or source identity.');
        sources.set(source.id, source);
      }
      const currentSections = [];
      for (const section of patch.sections) {
        const key = `${record.id}:${section?.id}`;
        if (!object(section) || !id(section.id) || added.has(key) || record.sections.some(existing => existing.id === section.id) || typeof section.text !== 'string' || !section.text.trim() || section.text.length > 1600 || section.text.includes('\0') || typeof section.title !== 'string' || !section.title.trim() || section.title.length > 200 || !Array.isArray(section.sourceIds) || !section.sourceIds.length || section.sourceIds.length > 4 || new Set(section.sourceIds).size !== section.sourceIds.length || section.sourceIds.some(sourceId => !sources.has(sourceId)) || typeof section.sourceLocator !== 'string' || !section.sourceLocator.trim() || section.sourceLocator.length > 2000) fail('unbounded, duplicate or unsupported passage.');
        added.add(key);
        if (section.provenance?.excerptSha256 !== undefined && section.provenance.excerptSha256 !== createHash('sha256').update(section.text).digest('hex')) fail('excerpt provenance has changed.');
        if (section.sourceSpans !== undefined && (!Array.isArray(section.sourceSpans) || !section.sourceSpans.length || section.sourceSpans.length > 4 || section.sourceSpans.some(span => !object(span) || !section.sourceIds.includes(span.sourceId) || typeof span.excerpt !== 'string' || !span.excerpt.trim() || span.excerpt.length > 1600 || span.sha256 !== createHash('sha256').update(span.excerpt).digest('hex')) || section.sourceSpans.map(span => span.excerpt).join('\n\n') !== section.text)) fail('source passage binding has changed.');
        const review = section.review || { kind: 'automated-source-check', humanReviewed: false, checkedAt: supplement.checkedAt, expiresAt: new Date(day(supplement.checkedAt) + 30 * 86400000).toISOString().slice(0, 10) };
        if (!object(review) || review.kind !== 'automated-source-check' || review.humanReviewed !== false || !Number.isFinite(day(review.checkedAt)) || day(review.checkedAt) < day(supplement.checkedAt) || day(review.checkedAt) > timestamp || !Number.isFinite(day(review.expiresAt)) || day(review.expiresAt) <= day(review.checkedAt) || day(review.expiresAt) > day(review.checkedAt) + 45 * 86400000) fail('invalid passage review dates.');
        if (day(review.expiresAt) > timestamp) currentSections.push({ ...section, review });
      }
      const usedSources = new Set(currentSections.flatMap(section => section.sourceIds));
      const currentSources = patch.sources.filter(source => usedSources.has(source.id));
      if (record.sources.length + currentSources.length > 16 || record.sections.length + currentSections.length > 32) fail('combined reference limits exceeded.');
      record.sources.push(...structuredClone(currentSources));
      record.sections.push(...structuredClone(currentSections));
    }
  }
  return result;
}

/** One reader shared by runtime and maintenance; never fetch arbitrary external content. */
export function readStudyReferenceFiles(directory, { now = Date.now() } = {}) {
  let bytes = 0;
  return STUDY_REFERENCE_FILES.filter(name => existsSync(resolve(directory, name))).map(name => {
    const path = resolve(directory, name), size = statSync(path).size;
    bytes += size;
    if (size > 1024 * 1024 || bytes > 2 * 1024 * 1024) fail('file limits exceeded.');
    const body = readFileSync(path, 'utf8');
    return { name: `reference-expansion/${name}`, parsed: JSON.parse(body), sha256: createHash('sha256').update(body).digest('hex') };
  });
}
