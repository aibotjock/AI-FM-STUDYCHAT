import test from 'node:test';
import assert from 'node:assert/strict';
import { createIngeniumTelemetry, projectIngeniumMetadata, INGENIUM_TELEMETRY_ENDPOINT } from '../server/ingenium-telemetry.js';

const key = `ia_${'a'.repeat(43)}`;
const organizationId = '21bca727-553f-4df8-a2c6-e702f45e4ca2';
const requestId = 'a0c604ce-63f8-49cd-9bb1-774376810351';
const env = { INGENIUM_TELEMETRY_KEY: key, INGENIUM_TELEMETRY_ORGANIZATION_ID: organizationId };
const metadata = { provider: 'openai', requestedModel: 'gpt-4.1-mini', returnedModel: 'gpt-4.1-mini-2025-04-14', endpoint: 'chat', usage: { prompt_tokens: 31, completion_tokens: 2 }, estimatedCostUsd: .0000156, latencyMs: 85, recordedAt: Date.parse('2026-10-09T06:00:00.000Z') };

test('metadata projection excludes content, credentials and arbitrary provider fields', () => {
  const result = projectIngeniumMetadata({ ...metadata, prompt: 'private question', content: 'private answer', key, email: 'private@example.com', pricingBasis: 'untrusted free text', usage: { ...metadata.usage, private: 'not allowed' } }, { requestId });
  assert.deepEqual(result, { requestId, provider: 'openai', requestedModel: metadata.requestedModel, returnedModel: metadata.returnedModel, endpoint: 'chat', latencyMs: 85, inputTokens: 31, outputTokens: 2, estimatedCostUsd: .0000156, occurredAt: '2026-10-09T06:00:00.000Z', source: 'app_observed' });
  assert.doesNotMatch(JSON.stringify(result), /private|ia_|untrusted/);
});

test('one server-only delivery uses fixed HTTPS endpoint and returns a secret-free acknowledgment', async () => {
  let calls = 0;
  const observer = createIngeniumTelemetry({ env, fetchImpl: async (url, request) => {
    calls++;
    assert.equal(url, INGENIUM_TELEMETRY_ENDPOINT);
    assert.equal(request.method, 'POST');
    assert.equal(request.redirect, 'error');
    assert.equal(request.signal instanceof AbortSignal, true);
    assert.equal(request.headers['x-ingenium-key'], key);
    assert.equal(request.headers['x-ingenium-organization'], organizationId);
    assert.deepEqual(JSON.parse(request.body), projectIngeniumMetadata(metadata, { requestId }));
    return Response.json({ accepted: true }, { status: 201 });
  } });
  assert.deepEqual(await observer.observe(metadata, { requestId }), { accepted: true, requestId });
  assert.equal(calls, 1);
  assert.equal(observer.status().accepted, 1);
  assert.equal(observer.status().failed, 0);
  assert.doesNotMatch(JSON.stringify(observer.status()), /ia_|Bearer/);
});

test('unconfigured observers do not deliver and never expose partial credentials', async () => {
  let calls = 0;
  for (const broken of [{}, { ...env, INGENIUM_TELEMETRY_KEY: 'wrong' }, { ...env, INGENIUM_TELEMETRY_ORGANIZATION_ID: 'wrong' }]) {
    const observer = createIngeniumTelemetry({ env: broken, fetchImpl: async () => { calls++; throw new Error('not called'); } });
    assert.deepEqual(await observer.observe(metadata, { requestId }), { accepted: false, reason: 'not_configured', requestId });
    assert.equal(observer.status().configured, false);
    assert.equal(observer.status().organizationId, null);
  }
  assert.equal(calls, 0);
});

test('Astra, non-OpenAI metadata and malformed token/cost fields cannot leave the process', async () => {
  let calls = 0;
  const observer = createIngeniumTelemetry({ env, fetchImpl: async () => { calls++; return Response.json({}); } });
  for (const invalid of [
    { ...metadata, requestedModel: 'gpt-6-astra' }, { ...metadata, returnedModel: 'ASTRA' },
    { ...metadata, provider: 'anthropic' }, { ...metadata, requestedModel: 'invalid/model' },
    { ...metadata, usage: { prompt_tokens: -1, completion_tokens: 2 } },
    { ...metadata, usage: { prompt_tokens: 31, completion_tokens: 2000001 } },
    { ...metadata, estimatedCostUsd: Infinity }, { ...metadata, estimatedCostUsd: 10001 },
    { ...metadata, estimatedCostUsd: .1, usage: null }, { ...metadata, latencyMs: -1 },
    { ...metadata, recordedAt: NaN }, { ...metadata, endpoint: 'messages' }
  ]) assert.deepEqual(await observer.observe(invalid, { requestId }), { accepted: false, reason: 'invalid_metadata' });
  assert.equal(projectIngeniumMetadata(metadata, { requestId: 'not-a-uuid' }), null);
  assert.equal(calls, 0);
});

test('missing provider usage stays unknown rather than becoming invented zeros', () => {
  const result = projectIngeniumMetadata({ ...metadata, returnedModel: null, usage: null, estimatedCostUsd: null }, { requestId });
  assert.equal(result.returnedModel, null);
  assert.equal(result.inputTokens, null);
  assert.equal(result.outputTokens, null);
  assert.equal(result.estimatedCostUsd, null);
});

test('failed delivery is reported once and does not trigger automatic retries', async () => {
  let calls = 0;
  const observer = createIngeniumTelemetry({ env, fetchImpl: async () => { calls++; throw new Error(`${key} private endpoint details`); } });
  assert.deepEqual(await observer.observe(metadata, { requestId }), { accepted: false, reason: 'delivery_failed', requestId });
  assert.equal(calls, 1);
  assert.equal(observer.status().failed, 1);
  assert.doesNotMatch(JSON.stringify(observer.status()), /ia_|private endpoint/);
});

test('auth rejection, event conflict and remote failure expose only fixed error categories', async () => {
  for (const [status, reason] of [[401, 'registration_rejected'], [403, 'registration_rejected'], [409, 'event_conflict'], [500, 'delivery_failed']]) {
    const observer = createIngeniumTelemetry({ env, fetchImpl: async () => new Response(`${key} secret remote detail`, { status }) });
    assert.deepEqual(await observer.observe(metadata, { requestId }), { accepted: false, reason, requestId });
  }
});
