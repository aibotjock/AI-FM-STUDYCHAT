import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
function files(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]); }
const sources = ['server', 'shared', 'public', 'scripts'].flatMap(dir => files(join(root, dir))).filter(path => path.endsWith('.js'));
for (const path of sources) {
  const result = spawnSync(process.execPath, ['--check', path], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
const manifest = JSON.parse(readFileSync(join(root, 'public/manifest.webmanifest'), 'utf8'));
for (const icon of manifest.icons) if (!existsSync(join(root, 'public', icon.src))) throw new Error(`Missing app icon: ${icon.src}`);
const { STARTER_CARDS, SCENARIOS } = await import('../shared/content.js');
if (new Set(SCENARIOS.map(item => item.id)).size !== SCENARIOS.length) throw new Error('Duplicate scenario IDs');
if (STARTER_CARDS.some(card => !card.front || !card.back)) throw new Error('Incomplete starter card');
console.log(`Checked ${sources.length} JavaScript files, PWA icons, ${SCENARIOS.length} cases, and ${STARTER_CARDS.length} starter cards.`);
