import { readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { resolve, join, relative, dirname } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const source = resolve(process.argv[2] || join(root, '..', 'Conversation-Agent'));
const target = join(root, 'public', 'vendor', 'conversation-agent');
const serverTarget = join(root, 'server', 'vendor', 'conversation-agent');
if (!existsSync(join(source, 'package.json')) || !existsSync(join(source, 'index.js'))) throw new Error('Provide the checked Conversation-Agent source directory.');
const pkg = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
const files = ['index.js'];
function visit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) visit(path);
    else if (/\.(?:js|ts)$/.test(entry.name)) files.push(relative(source, path).replaceAll('\\', '/'));
  }
}
visit(join(source, 'src'));
for (const extra of ['index.d.ts', 'voice-circle.css', 'NOTICE', 'LICENSE']) if (existsSync(join(source, extra))) files.push(extra);
// Only generated runtime artifacts are replaced; application adapters live outside.
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
const hashes = {};
for (const name of [...new Set(files)].sort()) {
  const destination = join(target, name);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(join(source, name), destination);
  hashes[name] = createHash('sha256').update(readFileSync(destination)).digest('hex');
}
const serverHashes = {};
const serverSource = join(source, 'server', 'openai-transcription.js');
if (existsSync(serverSource)) {
  mkdirSync(serverTarget, { recursive: true });
  const destination = join(serverTarget, 'openai-transcription.js');
  copyFileSync(serverSource, destination);
  serverHashes['server/openai-transcription.js'] = createHash('sha256').update(readFileSync(destination)).digest('hex');
}
writeFileSync(join(target, 'release.json'), JSON.stringify({ repository: 'https://github.com/aibotjock/Conversation-Agent', version: pkg.version, sourceRevision: process.argv[3] || null, files: hashes, serverFiles: serverHashes }, null, 2) + '\n');
console.log(`Generated ${Object.keys(hashes).length} runtime files from Conversation-Agent ${pkg.version}.`);
