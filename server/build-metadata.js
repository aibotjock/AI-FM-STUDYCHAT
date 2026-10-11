import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { modelPricingSnapshot } from './models.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MODEL = /^[A-Za-z0-9_.:-]{1,200}$/;
const VERSION = /^(?:app|model|voice|pricing)-sha256-[a-f0-9]{64}$/;
const SOURCE_EXTENSIONS = /\.(?:js|mjs|cjs|json|html|css|svg|txt)$/;
const SKIP_DIRECTORIES = new Set(['tests', 'docs', 'demo', 'node_modules', 'voice-assets']);
const CONFIG_INTEGERS = ['chatTimeoutMs', 'maxInputChars', 'maxOutputTokens', 'maxHistoryMessages',
  'standardPromptBytes', 'limitedPromptBytes', 'limitedOutputTokens', 'maxOutputChars',
  'modelCatalogueTimeoutMs', 'modelCatalogueCacheMs'];

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
const version = (kind, value) => `${kind}-sha256-${digest(value)}`;

function sourceFiles(root) {
  const rows = [];
  function walk(directory) {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory() && !SKIP_DIRECTORIES.has(entry.name)) walk(path);
      else if (entry.isFile() && SOURCE_EXTENSIONS.test(entry.name)) {
        if (rows.length >= 4096) throw new Error('Build source fingerprint exceeds its file bound.');
        rows.push([relative(root, path).replaceAll('\\', '/'), digest(readFileSync(path))]);
      }
    }
  }
  for (const path of ['server', 'public', 'packages', 'content']) walk(join(root, path));
  for (const filename of ['package.json', 'package-lock.json', 'tools/build-device-voice.mjs']) {
    const path = join(root, filename);
    if (existsSync(path)) rows.push([filename, digest(readFileSync(path))]);
  }
  return rows.sort(([a], [b]) => a.localeCompare(b));
}

function publicConfig(config) {
  const result = { model: MODEL.test(config.model ?? '') ? config.model : null,
    anthropicModel: MODEL.test(config.anthropicModel ?? '') ? config.anthropicModel : null };
  for (const key of CONFIG_INTEGERS) result[key] = Number.isSafeInteger(config[key]) && config[key] >= 0 ? config[key] : null;
  return result;
}

/** Content-derived build identity, not an asserted Git commit or a learner/device identity.
 * Runs once at boot. No environment spread, secret hash, learner state, or network call. */
export function createMeasurementManifest({ config = {}, root = ROOT, pricingSnapshot = modelPricingSnapshot() } = {}) {
  const files = sourceFiles(root);
  const packagePath = join(root, 'package.json');
  const packageJson = existsSync(packagePath) ? JSON.parse(readFileSync(packagePath, 'utf8')) : {};
  const modelConfig = publicConfig(config);
  const pricingVersion = version('pricing', pricingSnapshot);
  const voicePath = join(root, 'public/voice-assets/manifest.json');
  const voiceRuntimeVersion = version('voice', {
    // This identifies the server-offered runtime. It does not assert a downloaded device pack.
    assets: existsSync(voicePath) ? digest(readFileSync(voicePath)) : null,
    sources: files.filter(([path]) => /(?:device-voice|(?:^|\/)voice(?:-circle|-catalogue)?\.)/.test(path)),
    dependencies: Object.fromEntries(['@huggingface/transformers', 'kokoro-js', 'esbuild'].map(name =>
      [name, typeof packageJson.devDependencies?.[name] === 'string' ? packageJson.devDependencies[name] : null]))
  });
  const appVersion = version('app', { schemaVersion: 1, source: files, modelConfig,
    voiceRuntimeVersion, pricingVersion, telemetry: { schemaVersion: 1,
      configured: Boolean(config.ingeniumKey && config.ingeniumOrganizationId) } });
  return Object.freeze({ appVersion, voiceRuntimeVersion, pricingVersion,
    forTextObservation(input) {
      if (!input || !['openai', 'anthropic'].includes(input.provider) || !MODEL.test(input.requestedModel ?? '') ||
        !(input.provider === 'anthropic' ? input.endpoint === 'messages' : ['chat', 'responses'].includes(input.endpoint))) return null;
      return Object.freeze({ schemaVersion: 1, appVersion,
        modelConfigVersion: version('model', { schemaVersion: 1, modelConfig,
          provider: input.provider, requestedModel: input.requestedModel, endpoint: input.endpoint }),
        voiceRuntimeVersion, pricingVersion, basis: 'baseline', stage: 'text' });
    }
  });
}

/** Whitelist exact measurement fields; used only for a trusted server-built manifest. */
export function measurementPayload(manifest, input) {
  let value;
  try { value = manifest?.forTextObservation?.({ provider: input.provider, requestedModel: input.requestedModel, endpoint: input.endpoint }); }
  catch { return null; } // Optional tagging failure preserves the existing observation.
  if (!value || value.schemaVersion !== 1 || value.basis !== 'baseline' || value.stage !== 'text' ||
    !VERSION.test(value.appVersion) || !value.appVersion.startsWith('app-') ||
    !VERSION.test(value.modelConfigVersion) || !value.modelConfigVersion.startsWith('model-') ||
    !VERSION.test(value.voiceRuntimeVersion) || !value.voiceRuntimeVersion.startsWith('voice-') ||
    !VERSION.test(value.pricingVersion) || !value.pricingVersion.startsWith('pricing-')) return null;
  return { schemaVersion: 1, appVersion: value.appVersion, modelConfigVersion: value.modelConfigVersion,
    voiceRuntimeVersion: value.voiceRuntimeVersion, pricingVersion: value.pricingVersion, basis: 'baseline', stage: 'text' };
}
