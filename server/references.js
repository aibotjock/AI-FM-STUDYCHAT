import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { HttpError } from './errors.js';

const DEFAULT_CATALOGUE = new URL('../content/reference-library/references/catalogue.json', import.meta.url);
const PAGE_SIZE = 20;
const NOTE = 'Directory metadata only. These documents were not consulted for this answer. Review recorded editions, scope, corrections, and rights before use.';
const referenceId = url => `ref_${createHash('sha256').update(url).digest('hex').slice(0, 20)}`;

// The local metadata is loaded only by a directory request or a nonempty selection.
// There is deliberately no document-fetching or consultation capability here.
export function createReferenceDirectory({ cataloguePath = DEFAULT_CATALOGUE, readFile = readFileSync } = {}) {
  let directory;
  function load() {
    if (directory) return directory;
    try {
      const raw = readFile(cataloguePath, 'utf8');
      if (Buffer.byteLength(raw) > 2 * 1024 * 1024) throw new Error('Catalogue size limit.');
      const catalogue = JSON.parse(raw);
      if (catalogue.schemaVersion !== 1 || !Array.isArray(catalogue.references)) throw new Error('Invalid catalogue.');
      const byId = new Map(), entries = [], urls = new Set(); let metadataRecords = 0, catalogRecords = 0;
      for (const item of catalogue.references) {
        const url = new URL(item.url);
        if (url.protocol !== 'https:' || url.username || url.password || urls.has(item.url) || !Array.isArray(item.records) || !item.records.length) throw new Error('Invalid reference.');
        if (item.records.some(record => !record?.metadata || typeof record.metadata.title !== 'string' || !record.metadata.title.trim() || !record.provenance || typeof record.provenance.file !== 'string')) throw new Error('Invalid metadata.');
        const descriptor = { id: referenceId(item.url), title: item.records[0].metadata.title, organization: item.records.find(record => record.metadata.organization)?.metadata.organization || '', url: item.url,
          label: 'Reference link', consulted: false, readingSupported: false, records: item.records };
        const entry = { descriptor, searchable: JSON.stringify(item).toLowerCase() };
        if (byId.has(descriptor.id)) throw new Error('Duplicate reference identity.');
        byId.set(descriptor.id, entry); entries.push(entry); urls.add(item.url);
        for (const record of item.records) {
          metadataRecords++; if (record.provenance.file === 'content/source-registry.json') catalogRecords++;
          const alias = record.metadata.id;
          if (typeof alias === 'string' && alias) {
            if (byId.has(alias) && byId.get(alias) !== entry) throw new Error('Ambiguous metadata identity.');
            byId.set(alias, entry);
          }
        }
      }
      directory = { entries, byId, counts: { uniqueUrls: entries.length, metadataRecords, catalogRecords } };
      return directory;
    } catch {
      throw new HttpError(503, 'Reference directory is unavailable. Conversation does not require a reference match.', 'source_unavailable');
    }
  }
  function search(query = '', page = 1) {
    if (typeof query !== 'string' || query.length > 200) throw new HttpError(400, 'Reference search must contain at most 200 characters.', 'invalid_reference_query');
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000) throw new HttpError(400, 'Reference page is invalid.', 'invalid_reference_page');
    const current = load(), text = query.trim().toLowerCase();
    const matches = text ? current.entries.filter(entry => entry.searchable.includes(text)) : current.entries;
    return { references: matches.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(entry => structuredClone(entry.descriptor)), page, pageSize: PAGE_SIZE, total: matches.length,
      pages: Math.max(1, Math.ceil(matches.length / PAGE_SIZE)), counts: { ...current.counts }, note: NOTE };
  }
  function resolveIds(ids = []) {
    if (!Array.isArray(ids) || ids.length > 5 || ids.some(id => typeof id !== 'string' || !id || id.length > 200)) throw new HttpError(400, 'Select at most five valid reference IDs.', 'invalid_reference_id');
    if (!ids.length) return [];
    const current = load(), selected = new Map();
    for (const id of ids) {
      const entry = current.byId.get(id);
      if (!entry) throw new HttpError(400, 'Selected reference ID is not in the directory.', 'invalid_reference_id');
      selected.set(entry.descriptor.id, entry.descriptor);
    }
    return [...selected.values()].map(descriptor => structuredClone(descriptor));
  }
  return { search, resolveIds };
}
