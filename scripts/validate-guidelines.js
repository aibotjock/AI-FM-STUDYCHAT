import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { loadGuidelineCorpus } from '../server/guidelines.js';

const pathArgument = process.argv.slice(2).find(argument => !argument.startsWith('--'));
const path = pathArgument ? resolve(pathArgument) : fileURLToPath(new URL('../content/guidelines.json', import.meta.url));
try {
  const corpus = loadGuidelineCorpus(path);
  console.log(JSON.stringify({ version: corpus.version, eligibleRecords: corpus.records.length, rejected: corpus.rejected, ready: corpus.ready, notice: 'Schema, rights attestations, integrity, and review dates checked. This does not establish clinical accuracy or launch approval.' }, null, 2));
  if (corpus.rejected.length || (process.argv.includes('--require-ready') && !corpus.ready)) process.exitCode = 1;
} catch (error) {
  console.error(`Guideline validation failed: ${error.message}`);
  process.exitCode = 1;
}
