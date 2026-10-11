import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as immediate } from 'node:timers/promises';
import { createMeasurementManifest } from '../server/build-metadata.js';
import { createIngeniumTelemetry } from '../server/telemetry.js';
import { modelPricingSnapshot } from '../server/models.js';
import { buildApplication } from '../server/bootstrap.js';
import { loadConfig } from '../server/config.js';

const config = { model: 'gpt-4.1-mini', anthropicModel: 'claude-haiku-5-5', maxOutputTokens: 1200,
  limitedOutputTokens: 768, standardPromptBytes: 24000, limitedPromptBytes: 8000,
  ingeniumKey: 'ia_private-test-credential', ingeniumOrganizationId: '8a2ee0b6-0b2b-4e73-99d6-15ad088f14de' };
const observation = {provider: 'openai', requestedModel: 'gpt-4.1-mini', endpoint: 'responses'};
const event = extra => ({requestId: randomUUID(), ...observation, returnedModel: 'gpt-4.1-mini',
  statusCode: 200, latencyMs: 12, occurredAt: '2026-10-11T03:00:00.000Z', ...extra});

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'studychat-build-meta-'));
  for (const directory of ['server', 'public', 'content', 'data', 'tools']) mkdirSync(join(root, directory));
  writeFileSync(join(root, 'package.json'), JSON.stringify({name: 'studychat-no-rag', version: '2.0.0',
    devDependencies: {'@huggingface/transformers': '3.8.1', 'kokoro-js': '1.2.1', esbuild: '0.28.2'}}));
  writeFileSync(join(root, 'server/provider.js'), 'export const textTransport = 1;\n');
  writeFileSync(join(root, 'public/device-voice.js'), 'export const runtime = 1;\n');
  writeFileSync(join(root, 'public/device-voice-worker.js'), 'export const worker = 1;\n');
  writeFileSync(join(root, 'tools/build-device-voice.mjs'), 'export const builder = 1;\n');
  writeFileSync(join(root, 'content/bank.json'), '{}\n');
  t.after(() => rmSync(root, {recursive: true, force: true}));
  return root;
}

async function until(condition) {
  for (let step = 0; step < 200; step++) {if (condition()) return; await immediate();}
  assert.fail('Background telemetry did not settle.');
}

test('build measurement is deterministic, opaque, source-derived and independent of client secrets/state', t => {
  const root = fixture(t);
  const first = createMeasurementManifest({config, root}).forTextObservation(observation);
  assert.deepEqual(createMeasurementManifest({config, root}).forTextObservation(observation), first);
  for (const [field, prefix] of [['appVersion', 'app'], ['modelConfigVersion', 'model'], ['voiceRuntimeVersion', 'voice'], ['pricingVersion', 'pricing']]) {
    assert.match(first[field], new RegExp(`^${prefix}-sha256-[a-f0-9]{64}$`));
  }
  assert.deepEqual(Object.keys(first).sort(), ['schemaVersion','appVersion','modelConfigVersion','voiceRuntimeVersion','pricingVersion','basis','stage'].sort());
  assert.equal(first.schemaVersion, 1); assert.equal(first.basis, 'baseline'); assert.equal(first.stage, 'text');
  writeFileSync(join(root, '.env'), 'OPENAI_API_KEY=private-env-value');
  writeFileSync(join(root, 'data/learner.json'), 'private learner answers');
  const rotated = createMeasurementManifest({root, config: {...config, apiKey: 'private-api-key', accessToken: 'private-login-token',
    ingeniumKey: 'ia_another-private-key', dataDir: '/private/learner-directory', learnerId: 'private-person'}}).forTextObservation(observation);
  assert.deepEqual(rotated, first);
  assert.doesNotMatch(JSON.stringify(first), /private|learner|commit|revision|git|apiKey|prompt|answer/i);
});

test('model selection, configured limits and telemetry availability invalidate the relevant fingerprints', t => {
  const root = fixture(t), firstManifest = createMeasurementManifest({config, root}), first = firstManifest.forTextObservation(observation);
  const selected = firstManifest.forTextObservation({...observation, requestedModel: 'gpt-4.1'});
  assert.notEqual(selected.modelConfigVersion, first.modelConfigVersion); assert.equal(selected.appVersion, first.appVersion);
  const changedLimits = createMeasurementManifest({config: {...config, maxOutputTokens: 800}, root}).forTextObservation(observation);
  assert.notEqual(changedLimits.modelConfigVersion, first.modelConfigVersion); assert.notEqual(changedLimits.appVersion, first.appVersion);
  const changedDefault = createMeasurementManifest({config: {...config, model: 'gpt-4.1'}, root}).forTextObservation(observation);
  assert.notEqual(changedDefault.modelConfigVersion, first.modelConfigVersion); assert.notEqual(changedDefault.appVersion, first.appVersion);
  const unavailable = createMeasurementManifest({config: {...config, ingeniumKey: ''}, root}).forTextObservation(observation);
  assert.notEqual(unavailable.appVersion, first.appVersion);
});

test('actual tariff content, source/package changes and offered voice runtime invalidate build fingerprints', t => {
  const root = fixture(t), first = createMeasurementManifest({config, root}).forTextObservation(observation);
  const changedPrices = modelPricingSnapshot(); changedPrices.inputOutputUsdPerMillion.openai['gpt-4.1-mini'][0] += 0.01;
  const priced = createMeasurementManifest({config, root, pricingSnapshot: changedPrices}).forTextObservation(observation);
  assert.notEqual(priced.pricingVersion, first.pricingVersion); assert.notEqual(priced.appVersion, first.appVersion);
  assert.equal(modelPricingSnapshot().inputOutputUsdPerMillion.openai['gpt-4.1-mini'][0], 0.4);
  writeFileSync(join(root, 'public/device-voice-worker.js'), 'export const worker = 2;\n');
  const voice = createMeasurementManifest({config, root}).forTextObservation(observation);
  assert.notEqual(voice.voiceRuntimeVersion, first.voiceRuntimeVersion); assert.notEqual(voice.appVersion, first.appVersion);
  mkdirSync(join(root, 'public/voice-assets'));
  writeFileSync(join(root, 'public/voice-assets/manifest.json'), JSON.stringify({version: 'offered-pack-v2', assets: [{sha256: 'a'.repeat(64)}]}));
  const offered = createMeasurementManifest({config, root}).forTextObservation(observation);
  assert.notEqual(offered.voiceRuntimeVersion, voice.voiceRuntimeVersion);
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')); packageJson.version = '2.0.1';
  writeFileSync(join(root, 'package.json'), JSON.stringify(packageJson));
  const packaged = createMeasurementManifest({config, root}).forTextObservation(observation);
  assert.notEqual(packaged.appVersion, offered.appVersion);
  writeFileSync(join(root, 'package-lock.json'), '{"lockfileVersion":3,"packages":{}}');
  const locked = createMeasurementManifest({config, root}).forTextObservation(observation);
  assert.notEqual(locked.appVersion, packaged.appVersion);
  writeFileSync(join(root, 'tools/build-device-voice.mjs'), 'export const builder = 2;\n');
  const rebuilt = createMeasurementManifest({config, root}).forTextObservation(observation);
  assert.notEqual(rebuilt.voiceRuntimeVersion, locked.voiceRuntimeVersion);
  writeFileSync(join(root, 'server/provider.js'), 'export const textTransport = 2;\n');
  assert.notEqual(createMeasurementManifest({config, root}).forTextObservation(observation).appVersion, rebuilt.appVersion);
});

test('only trusted server-built measurement reaches new observations; simulation and raw caller fields stay excluded', async t => {
  const root = fixture(t), db = new DatabaseSync(':memory:');
  const manifest = createMeasurementManifest({config, root});
  const telemetry = createIngeniumTelemetry({db, config, measurementManifest: manifest, fetchImpl: async (_url, options) =>
    Response.json({accepted: true, requestId: JSON.parse(options.body).requestId, duplicate: false})});
  t.after(async () => {telemetry.close(); await immediate(); db.close();});
  const value = event({prompt: 'PRIVATE PROMPT', answer: 'PRIVATE ANSWER', learnerId: 'PRIVATE LEARNER',
    measurement: {basis: 'optimized', stage: 'voice', appVersion: 'PRIVATE OVERRIDE'}});
  assert.equal(telemetry.record(value), true);
  const payload = JSON.parse(db.prepare('SELECT payload FROM ingenium_outbox WHERE request_id=?').get(value.requestId).payload);
  assert.deepEqual(payload.measurement, manifest.forTextObservation(observation));
  assert.doesNotMatch(JSON.stringify(payload), /PRIVATE|private-test-credential|prompt|answer|learnerId/);
  const simulated = event({source: 'client_simulated', measurement: payload.measurement});
  assert.equal(telemetry.record(simulated), true);
  const simulationPayload = JSON.parse(db.prepare('SELECT payload FROM ingenium_outbox WHERE request_id=?').get(simulated.requestId).payload);
  assert.equal(Object.hasOwn(simulationPayload, 'measurement'), false);
  await until(() => telemetry.status().delivered === 2);
});

test('optional tagging failure preserves legacy valid observations', async t => {
  const db = new DatabaseSync(':memory:');
  const telemetry = createIngeniumTelemetry({db, config,
    measurementManifest: {forTextObservation() {throw new Error('Private build detail');}},
    fetchImpl: async (_url, options) => Response.json({accepted: true, requestId: JSON.parse(options.body).requestId, duplicate: false})});
  t.after(async () => {telemetry.close(); await immediate(); db.close();});
  const value = event();
  assert.equal(telemetry.record(value), true);
  const payload = JSON.parse(db.prepare('SELECT payload FROM ingenium_outbox').get().payload);
  assert.equal(Object.hasOwn(payload, 'measurement'), false);
  assert.doesNotMatch(JSON.stringify(payload), /Private build detail/);
  await until(() => telemetry.status().delivered === 1);
});

test('legacy persisted observations keep their original bytes and deduplication after metadata is enabled', async t => {
  const root = fixture(t), filename = join(root, 'legacy.sqlite'), value = event();
  let now = 100_000, db = new DatabaseSync(filename), delivered;
  let telemetry = createIngeniumTelemetry({db, config, now: () => now, fetchImpl: async () => new Response('', {status: 503})});
  assert.equal(telemetry.record(value), true);
  await until(() => telemetry.status().lastError === 'receiver_http');
  const originalBytes = db.prepare('SELECT payload FROM ingenium_outbox').get().payload;
  assert.equal(Object.hasOwn(JSON.parse(originalBytes), 'measurement'), false);
  telemetry.close(); await immediate(); db.close();
  now += 2000; db = new DatabaseSync(filename);
  telemetry = createIngeniumTelemetry({db, config, measurementManifest: createMeasurementManifest({config, root}), now: () => now,
    fetchImpl: async (_url, options) => {delivered = options.body; return Response.json({accepted: true, requestId: value.requestId, duplicate: true});}});
  t.after(async () => {telemetry.close(); await immediate(); db.close();});
  assert.equal(telemetry.record(value), true);
  await until(() => telemetry.status().delivered === 1);
  assert.equal(delivered, originalBytes); assert.equal(telemetry.status().dropped, 0);
  assert.equal(db.prepare('SELECT payload FROM ingenium_outbox').get().payload, originalBytes);
});

test('normal bootstrap tags both successful OpenAI and failed Anthropic attempted text requests without paid tests', async t => {
  const dataDir = mkdtempSync(join(tmpdir(), 'studychat-tagged-provider-')), observations = [];
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    if (String(url).includes('studychat-test-events')) {
      const payload = JSON.parse(options.body); observations.push(payload);
      return Response.json({accepted: true, requestId: payload.requestId, duplicate: false});
    }
    if (options.method !== 'POST') return Response.json({data: [{id: String(url).includes('anthropic') ? 'claude-haiku-5-5' : 'gpt-4.1-mini'}]});
    if (String(url).includes('anthropic')) return new Response('', {status: 429});
    const completed = {type: 'response.completed', response: {status: 'completed', model: 'gpt-4.1-mini', service_tier: 'default',
      output: [{type: 'message', content: [{type: 'output_text', text: 'PRIVATE ANSWER'}]}],
      usage: {input_tokens: 10, output_tokens: 3, input_tokens_details: {cache_write_tokens: 0}}}};
    return new Response(`data: ${JSON.stringify(completed)}\n\n`);
  });
  const appConfig = loadConfig({HOST: '127.0.0.1', PORT: '0', DATA_DIR: dataDir,
    OPENAI_API_KEY: 'private-openai-provider-key', ANTHROPIC_API_KEY: 'private-anthropic-provider-key',
    INGENIUM_TELEMETRY_KEY: config.ingeniumKey, INGENIUM_TELEMETRY_ORGANIZATION_ID: config.ingeniumOrganizationId});
  const app = buildApplication({config: appConfig});
  t.after(async () => {await app.shutdown(); rmSync(dataDir, {recursive: true, force: true});});
  const messages = [{role: 'user', content: 'PRIVATE PROMPT LEARNER ID'}];
  await app.models.generate({messages, selection: {provider: 'openai', model: 'gpt-4.1-mini'}});
  await assert.rejects(app.models.generate({messages, selection: {provider: 'anthropic', model: 'claude-haiku-5-5'}}), error => error.code === 'provider_rate_limit');
  await until(() => app.telemetry.status().delivered === 2);
  assert.equal(observations.length, 2);
  assert.equal(observations[0].errorCode, null); assert.equal(observations[1].errorCode, 'provider_rate_limit');
  assert.equal(observations[0].measurement.appVersion, observations[1].measurement.appVersion);
  assert.notEqual(observations[0].measurement.modelConfigVersion, observations[1].measurement.modelConfigVersion);
  for (const observation of observations) {assert.equal(observation.measurement.basis, 'baseline'); assert.equal(observation.measurement.stage, 'text');}
  assert.doesNotMatch(JSON.stringify(observations), /PRIVATE|private-openai|private-anthropic|private-test-credential|learnerId/);
});
