import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as immediate } from 'node:timers/promises';
import { createIngeniumTelemetry } from '../server/telemetry.js';

const config = { ingeniumKey: 'ia_private-server-key', ingeniumOrganizationId: '8a2ee0b6-0b2b-4e73-99d6-15ad088f14de' };
const event = values => ({ requestId: randomUUID(), provider: 'openai', requestedModel: 'gpt-4.1-mini', returnedModel: 'gpt-4.1-mini-2025-04-14',
  endpoint: 'responses', statusCode: 200, latencyMs: 75, occurredAt: '2026-10-10T22:00:00.000Z', ...values });
const ack = (id, duplicate = false) => Response.json({ accepted: true, requestId: id, duplicate });
async function until(condition) {
  for (let step = 0; step < 200; step++) { if (condition()) return; await immediate(); }
  assert.fail('Background sender did not reach the expected state.');
}
function memory() { return new DatabaseSync(':memory:'); }

test('unconfigured telemetry creates no outbox, stores no event and makes no network call', async () => {
  const db = memory(); let calls = 0;
  const telemetry = createIngeniumTelemetry({ db, config: {}, fetchImpl: async () => { calls++; throw new Error(); } });
  assert.equal(telemetry.record(event()), false); await immediate();
  assert.equal(calls, 0); assert.equal(telemetry.status().configured, false);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'ingenium_%'").get().n, 0);
  telemetry.close(); db.close();
});

test('record is synchronous and only approved metadata reaches the sender; absent usage stays unknown', async () => {
  const db = memory(); let seen, resolveFetch;
  const telemetry = createIngeniumTelemetry({ db, config, now: () => Date.parse('2026-10-10T22:00:00.000Z'), fetchImpl: (url, options) => {
    seen = { url, options }; return new Promise(resolve => { resolveFetch = resolve; });
  } });
  const value = event({ prompt: 'PRIVATE LEARNER TEXT', content: 'PRIVATE ANSWER', learnerId: 'private-learner', apiKey: 'private-key', endpointOverride: 'https://bad.invalid', arbitrary: 4 });
  assert.equal(telemetry.record(value), true); assert.equal(seen, undefined); assert.equal(telemetry.status().pending, 1);
  await until(() => seen);
  assert.equal(seen.url, 'https://mzmtbauuqywucgssckwx.supabase.co/functions/v1/studychat-test-events');
  assert.equal(seen.options.headers['x-ingenium-key'], config.ingeniumKey);
  assert.equal(seen.options.headers['x-ingenium-organization'], config.ingeniumOrganizationId);
  const payload = JSON.parse(seen.options.body);
  assert.deepEqual(Object.keys(payload).sort(), ['requestId', 'provider', 'requestedModel', 'returnedModel', 'endpoint', 'statusCode', 'errorCode', 'latencyMs', 'inputTokens', 'outputTokens', 'cachedInputTokens', 'cacheWriteInputTokens', 'reasoningOutputTokens', 'estimatedCostUsd', 'occurredAt', 'source'].sort());
  assert.equal(payload.inputTokens, null); assert.equal(payload.outputTokens, null); assert.equal(payload.estimatedCostUsd, null);
  assert.equal(payload.source, 'app_observed'); assert.doesNotMatch(seen.options.body, /PRIVATE|private-key|private-learner|bad\.invalid/);
  resolveFetch(ack(value.requestId)); await until(() => telemetry.status().delivered === 1);
  assert.equal(telemetry.status().pending, 0); assert.equal(telemetry.status().lastDeliveryAt, '2026-10-10T22:00:00.000Z');
  telemetry.close(); db.close();
});

test('only an exact bounded acknowledgement delivers; retries and duplicate acknowledgements retain the UUID', async () => {
  const db = memory(), value = event(); let clock = 1_791_669_600_000; const requests = [];
  const telemetry = createIngeniumTelemetry({ db, config, now: () => clock, fetchImpl: async (url, options) => {
    requests.push(JSON.parse(options.body));
    return requests.length === 1 ? ack(randomUUID()) : ack(value.requestId, true);
  } });
  assert.equal(telemetry.record(value), true); await until(() => telemetry.status().lastError === 'receiver_ack');
  assert.equal(telemetry.status().pending, 1); assert.equal(telemetry.status().delivered, 0);
  clock += 1000; assert.equal(telemetry.record(value), true);
  await until(() => telemetry.status().delivered === 1);
  assert.deepEqual(requests.map(item => item.requestId), [value.requestId, value.requestId]);
  assert.equal(telemetry.record(value), true); await immediate(); assert.equal(requests.length, 2);
  telemetry.close(); db.close();
});

test('a transient failed observation survives restart and is delivered once with its original ID', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'studychat-telemetry-')), filename = join(directory, 'events.sqlite'), value = event({ inputTokens: 12, outputTokens: 3, estimatedCostUsd: 0.0000096 });
  const requests = []; let clock = 100_000, db = new DatabaseSync(filename);
  let telemetry = createIngeniumTelemetry({ db, config, now: () => clock, fetchImpl: async (url, options) => { requests.push(options.body); return new Response('', { status: 503 }); } });
  try {
    assert.equal(telemetry.record(value), true); await until(() => telemetry.status().lastError === 'receiver_http');
    assert.equal(telemetry.status().pending, 1); telemetry.close(); await immediate(); db.close();
    clock += 2000; db = new DatabaseSync(filename);
    telemetry = createIngeniumTelemetry({ db, config, now: () => clock, fetchImpl: async (url, options) => { requests.push(options.body); return ack(JSON.parse(options.body).requestId); } });
    await until(() => telemetry.status().delivered === 1);
    assert.equal(requests.length, 2); assert.equal(requests[0], requests[1]); assert.equal(telemetry.status().pending, 0);
  } finally { telemetry.close(); await immediate(); db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('durable organization binding blocks cross-tenant replay while same-organization key rotation preserves original bytes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'studychat-tenant-')), filename = join(directory, 'events.sqlite'), value = event();
  let clock = 100_000, db = new DatabaseSync(filename), calls = 0, original;
  let telemetry = createIngeniumTelemetry({ db, config, now: () => clock, fetchImpl: async () => new Response('', { status: 503 }) });
  try {
    assert.equal(telemetry.record(value), true); await until(() => telemetry.status().lastError === 'receiver_http');
    original = db.prepare('SELECT * FROM ingenium_outbox').get();
    telemetry.close(); await immediate(); db.close(); clock += 2000; db = new DatabaseSync(filename);
    const otherOrganization = randomUUID();
    const other = { ingeniumOrganizationId: otherOrganization, ingeniumKey: 'ia_other-private-key',
      ingeniumLegacyOrganizationId: otherOrganization };
    telemetry = createIngeniumTelemetry({ db, config: other, now: () => clock, fetchImpl: async () => { calls++; return ack(value.requestId); } });
    await immediate(); assert.equal(calls, 0); assert.equal(telemetry.record(event()), false);
    assert.equal(telemetry.status().lastError, 'receiver_organization_mismatch'); assert.equal(telemetry.status().pending, 1);
    assert.deepEqual(db.prepare('SELECT * FROM ingenium_outbox').get(), original);
    assert.equal(db.prepare('SELECT organization_id FROM ingenium_outbox_owner').get().organization_id, config.ingeniumOrganizationId);
    assert.doesNotMatch(JSON.stringify(telemetry.status()), /private-key/);
    telemetry.close(); await immediate(); db.close(); db = new DatabaseSync(filename);
    telemetry = createIngeniumTelemetry({ db, config: { ...config, ingeniumOrganizationId: config.ingeniumOrganizationId.toUpperCase(),
      ingeniumKey: 'ia_rotated-private-key' }, now: () => clock, fetchImpl: async (_url, options) => {
        calls++; assert.equal(options.headers['x-ingenium-key'], 'ia_rotated-private-key');
        assert.equal(options.headers['x-ingenium-organization'], config.ingeniumOrganizationId); assert.equal(options.body, original.payload);
        return ack(value.requestId);
      } });
    await until(() => telemetry.status().delivered === 1);
    assert.equal(calls, 1); assert.equal(telemetry.status().pending, 0);
    assert.equal(db.prepare('SELECT payload FROM ingenium_outbox').get().payload, original.payload);
    assert.doesNotMatch(JSON.stringify(db.prepare('SELECT * FROM ingenium_outbox_owner').all()), /ia_|private-key/);
  } finally { telemetry.close(); await immediate(); db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('unbound legacy observations fail closed until their original organization is explicitly attested', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'studychat-legacy-owner-')), filename = join(directory, 'events.sqlite'), value = event();
  let clock = 100_000, db = new DatabaseSync(filename), calls = 0, original;
  let telemetry = createIngeniumTelemetry({ db, config, now: () => clock, fetchImpl: async () => new Response('', { status: 503 }) });
  try {
    telemetry.record(value); await until(() => telemetry.status().lastError === 'receiver_http');
    original = db.prepare('SELECT * FROM ingenium_outbox').get();
    telemetry.close(); await immediate(); db.exec('DROP TABLE ingenium_outbox_owner'); db.close(); clock += 2000;
    for (const assertion of [undefined, randomUUID()]) {
      db = new DatabaseSync(filename);
      telemetry = createIngeniumTelemetry({ db, config: { ...config, ingeniumLegacyOrganizationId: assertion }, now: () => clock,
        fetchImpl: async () => { calls++; return ack(value.requestId); } });
      await immediate(); assert.equal(calls, 0); assert.equal(telemetry.record(event()), false);
      assert.equal(telemetry.status().lastError, 'receiver_organization_unbound');
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM ingenium_outbox_owner').get().count, 0);
      assert.deepEqual(db.prepare('SELECT * FROM ingenium_outbox').get(), original);
      telemetry.close(); await immediate(); db.close();
    }
    db = new DatabaseSync(filename);
    telemetry = createIngeniumTelemetry({ db, config: { ...config, ingeniumLegacyOrganizationId: config.ingeniumOrganizationId }, now: () => clock,
      fetchImpl: async (_url, options) => { calls++; assert.equal(options.body, original.payload); return ack(value.requestId, true); } });
    await until(() => telemetry.status().delivered === 1);
    assert.equal(calls, 1); assert.equal(db.prepare('SELECT payload FROM ingenium_outbox').get().payload, original.payload);
    assert.equal(db.prepare('SELECT organization_id FROM ingenium_outbox_owner').get().organization_id, config.ingeniumOrganizationId);
  } finally { telemetry.close(); await immediate(); db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('an invalid organization cannot be persisted as queue identity or sent to the receiver', async () => {
  const db = memory(); let calls = 0;
  const telemetry = createIngeniumTelemetry({ db, config: { ...config, ingeniumOrganizationId: 'private-person@example.invalid' },
    fetchImpl: async () => { calls++; return ack(randomUUID()); } });
  assert.equal(telemetry.record(event()), false); await immediate(); assert.equal(calls, 0);
  assert.equal(telemetry.status().lastError, 'receiver_organization_invalid');
  assert.equal(telemetry.status().organizationId, null);
  assert.doesNotMatch(JSON.stringify(telemetry.status()), /private-person/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM ingenium_outbox_owner').get().count, 0);
  telemetry.close(); db.close();
});

test('receiver authentication failure is visible and pauses further sends while preserving pending observations', async () => {
  const db = memory(); let calls = 0;
  const telemetry = createIngeniumTelemetry({ db, config, fetchImpl: async () => { calls++; return new Response('', { status: 401 }); } });
  telemetry.record(event()); telemetry.record(event());
  await until(() => telemetry.status().rejected === 1);
  assert.equal(telemetry.status().lastError, 'receiver_auth'); assert.equal(telemetry.status().pending, 1);
  telemetry.record(event()); await immediate(); assert.equal(calls, 1); assert.equal(telemetry.status().pending, 2);
  telemetry.close(); db.close();
});

test('a full outbox explicitly refuses the new event and never removes any pending observation', async () => {
  const db = memory(); let calls = 0;
  const telemetry = createIngeniumTelemetry({ db, config, fetchImpl: () => { calls++; return new Promise(() => {}); } });
  const ids = [];
  for (let index = 0; index < 500; index++) { const value = event(); ids.push(value.requestId); assert.equal(telemetry.record(value), true); }
  assert.equal(telemetry.record(event()), false);
  const status = telemetry.status(); assert.equal(status.pending, 500); assert.equal(status.retainedEvents, 500); assert.equal(status.dropped, 1); assert.equal(status.lastError, 'outbox_full');
  assert.deepEqual(db.prepare('SELECT request_id FROM ingenium_outbox ORDER BY rowid').all().map(row => row.request_id), ids);
  await until(() => calls === 1); telemetry.close(); await immediate();
  assert.equal(telemetry.status().pending, 500); db.close();
});

test('delivered retention remains bounded while durable totals preserve all acknowledgements', async () => {
  const db = memory();
  const telemetry = createIngeniumTelemetry({ db, config, fetchImpl: async (url, options) => ack(JSON.parse(options.body).requestId) });
  for (let index = 0; index < 125; index++) telemetry.record(event());
  await until(() => telemetry.status().delivered === 125);
  assert.equal(telemetry.status().retainedEvents, 100); assert.equal(telemetry.status().pending, 0);
  telemetry.close(); db.close();
});

test('sender deadline releases an ignored abort and keeps the event for a later retry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const db = memory(); let calls = 0, clock = 100_000;
  const telemetry = createIngeniumTelemetry({ db, config, now: () => clock, fetchImpl: () => { calls++; return new Promise(() => {}); } });
  const value = event(); telemetry.record(value); await until(() => calls === 1);
  clock += 5000; t.mock.timers.tick(5000); await until(() => telemetry.status().lastError === 'receiver_timeout');
  assert.equal(telemetry.status().pending, 1); assert.equal(telemetry.status().delivered, 0);
  telemetry.close(); await immediate(); db.close();
});

test('oversized acknowledgements are not accepted and a stalled response body shares the same deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const db = memory(); let calls = 0, clock = 100_000;
  const telemetry = createIngeniumTelemetry({ db, config, now: () => clock, fetchImpl: async () => {
    calls++;
    if (calls === 1) return new Response(' '.repeat(4097));
    return new Response(new ReadableStream({ start() {} }));
  } });
  const value = event(); telemetry.record(value); await until(() => telemetry.status().lastError === 'receiver_ack');
  assert.equal(telemetry.status().delivered, 0); clock += 1000; telemetry.record(value); await until(() => calls === 2);
  clock += 5000; t.mock.timers.tick(5000); await until(() => telemetry.status().lastError === 'receiver_timeout');
  assert.equal(telemetry.status().pending, 1); telemetry.close(); await immediate(); db.close();
});

test('invalid usage, unknown error codes and conflicting IDs are refused without leaking their contents', async () => {
  const db = memory(); const telemetry = createIngeniumTelemetry({ db, config, fetchImpl: () => new Promise(() => {}) });
  const invalid = [{ inputTokens: 8 }, { errorCode: 'private provider message' }, { requestId: '00000000-0000-0000-0000-000000000000' },
    { provider: 'anthropic', endpoint: 'responses' }, { endpoint: 'messages' }, { inputTokens: 10_000_001, outputTokens: 0 },
    { inputTokens: 0, outputTokens: 2_000_001 }, { inputTokens: 8, outputTokens: 3, cachedInputTokens: 9 },
    { inputTokens: 8, outputTokens: 3, cacheWriteInputTokens: 9 }, { inputTokens: 8, outputTokens: 3, reasoningOutputTokens: 4 },
    { estimatedCostUsd: 0 }, { source: 'client_simulated', inputTokens: 0, outputTokens: 0 },
    { occurredAt: '2026-10-10T22:00:00Z' }, { occurredAt: '2026-02-30T22:00:00.000Z' }];
  for (const fields of invalid) assert.equal(telemetry.record(event(fields)), false);
  const value = event({ source: 'client_simulated' });
  assert.equal(telemetry.record(value), true); assert.equal(telemetry.record({ ...value, requestedModel: 'gpt-5.5' }), false);
  assert.equal(telemetry.status().dropped, invalid.length + 1); assert.equal(telemetry.status().pending, 1);
  const payload = JSON.parse(db.prepare('SELECT payload FROM ingenium_outbox').get().payload);
  assert.equal(payload.source, 'client_simulated'); assert.equal(payload.inputTokens, null); assert.equal(payload.outputTokens, null);
  telemetry.close(); await immediate(); db.close();
});
