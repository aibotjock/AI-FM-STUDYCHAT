import test from 'node:test';
import assert from 'node:assert/strict';
import { runIngeniumConnectionCheck } from '../server/ingenium-check.js';

const BASE_URL = 'http://127.0.0.1:3000/';
const ACCESS_TOKEN = 'mock-local-access-token-never-exported';
const SESSION = 'studychat_session=mock-local-session-never-exported';
const OPERATOR_ENV = {
  INGENIUM_INITIAL_CONNECTION_CHECK: 'ready-v1',
  INGENIUM_TELEMETRY_KEY: 'mock-telemetry-key-never-exported',
  INGENIUM_TELEMETRY_ORGANIZATION_ID: 'mock-organization',
  STUDY_ACCESS_TOKEN: ACCESS_TOKEN
};
const ACTIVE_STATUS = { aiConfigured: true, providerId: 'openai', model: 'gpt-4.1-mini' };

test('Ingenium readiness checks skip inactive flags and other models before login or inference', async () => {
  let calls = 0;
  const inactive = await runIngeniumConnectionCheck({ baseUrl: BASE_URL, env: { ...OPERATOR_ENV, INGENIUM_INITIAL_CONNECTION_CHECK: '' }, fetchImpl: async () => { calls += 1; throw new Error('Inactive checks must not make requests.'); } });
  assert.deepEqual(inactive, { skipped: true });
  assert.equal(calls, 0);
  for (const status of [
    { ...ACTIVE_STATUS, aiConfigured: false },
    { ...ACTIVE_STATUS, model: 'gpt-4.1-nano' },
    { ...ACTIVE_STATUS, providerId: 'anthropic' }
  ]) {
    const paths = [];
    const result = await runIngeniumConnectionCheck({ baseUrl: BASE_URL, env: OPERATOR_ENV, fetchImpl: async (url, options) => {
      paths.push(url.pathname);
      assert.equal(url.origin, new URL(BASE_URL).origin);
      assert.equal(options.method, 'GET');
      assert.equal(options.body, undefined);
      assert.equal(options.headers.Cookie, undefined);
      return Response.json(status);
    } });
    assert.deepEqual(result, { skipped: true, reason: 'baseline_model_not_active' });
    assert.deepEqual(paths, ['/api/status']);
  }
});

test('Ingenium readiness checks refuse remote or unsafe listener URLs before sending credentials', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; throw new Error('Unsafe URLs must not make requests.'); };
  for (const baseUrl of [
    'https://127.0.0.1:3000/',
    'http://remote.example:3000/',
    'http://localhost:3000/',
    'http://127.0.0.1:3000/private/',
    'http://127.0.0.1:3000/?destination=remote',
    'http://127.0.0.1:3000/#remote',
    'http://username:password@127.0.0.1:3000/'
  ]) {
    await assert.rejects(runIngeniumConnectionCheck({ baseUrl, env: OPERATOR_ENV, fetchImpl }), /local app listener/);
  }
  assert.equal(calls, 0);
});

test('Ingenium local readiness checks use the fixed durable request, flush telemetry, return a limited safe summary and log out', async () => {
  const events = [];
  const requests = [];
  const fetchImpl = async (url, options) => {
    assert.equal(url.origin, new URL(BASE_URL).origin);
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    const body = options.body === undefined ? undefined : JSON.parse(options.body);
    requests.push({ path: url.pathname, options, body });
    events.push(url.pathname);
    if (url.pathname === '/api/status') return Response.json(ACTIVE_STATUS);
    if (url.pathname === '/api/login') {
      assert.equal(options.method, 'POST');
      assert.deepEqual(body, { token: ACCESS_TOKEN });
      assert.equal(options.headers.Cookie, undefined);
      return Response.json({ authenticated: true }, { headers: { 'Set-Cookie': `${SESSION}; Path=/; HttpOnly; SameSite=Strict` } });
    }
    assert.equal(options.headers.Cookie, SESSION);
    if (url.pathname === '/api/model-test') {
      assert.deepEqual(body, { requestId: 'ingenium-registration-ready-v1-gpt-4.1-mini' });
      return Response.json({ connectionPassed: true, instructionPassed: true, returnedModel: 'gpt-4.1-mini-2025-04-14', requestedModel: 'gpt-4.1-mini', cached: false, estimatedCostUsd: .00014, answer: `Do not expose ${ACCESS_TOKEN}`, unusedSecret: OPERATOR_ENV.INGENIUM_TELEMETRY_KEY });
    }
    if (url.pathname === '/api/ingenium-status') {
      assert.equal(options.method, 'GET');
      return Response.json({ delivered: 1, pending: 0, unusedSecret: OPERATOR_ENV.INGENIUM_TELEMETRY_KEY });
    }
    assert.equal(url.pathname, '/api/logout');
    assert.deepEqual(body, {});
    return Response.json({ authenticated: false });
  };
  const result = await runIngeniumConnectionCheck({ baseUrl: BASE_URL, env: OPERATOR_ENV, fetchImpl, flushTelemetry: async () => { events.push('flush'); } });
  assert.deepEqual(events, ['/api/status', '/api/login', '/api/model-test', 'flush', '/api/ingenium-status', '/api/logout']);
  assert.deepEqual(result, { authenticated: true, connected: true, instructionPassed: true, model: 'gpt-4.1-mini-2025-04-14', cached: false, estimatedCostUsd: .00014, delivered: 1, pending: 0 });
  assert.equal(requests.filter(request => request.path === '/api/model-test').length, 1);
  assert.equal(requests.filter(request => request.body && JSON.stringify(request.body).includes(ACCESS_TOKEN)).length, 1);
  for (const secret of [ACCESS_TOKEN, SESSION, OPERATOR_ENV.INGENIUM_TELEMETRY_KEY]) assert.equal(JSON.stringify(result).includes(secret), false);
});

test('Ingenium readiness provider failures return the authenticated failure stage without retries and still log out', async () => {
  const paths = [];
  let flushes = 0;
  const result = await runIngeniumConnectionCheck({ baseUrl: BASE_URL, env: OPERATOR_ENV, flushTelemetry: async () => { flushes += 1; }, fetchImpl: async (url, options) => {
    paths.push(url.pathname);
    assert.equal(url.origin, new URL(BASE_URL).origin);
    if (url.pathname === '/api/status') return Response.json(ACTIVE_STATUS);
    if (url.pathname === '/api/login') return Response.json({ authenticated: true }, { headers: { 'Set-Cookie': `${SESSION}; Path=/; HttpOnly` } });
    assert.equal(options.headers.Cookie, SESSION);
    if (url.pathname === '/api/model-test') return Response.json({ error: `Private provider failure ${OPERATOR_ENV.INGENIUM_TELEMETRY_KEY}` }, { status: 503 });
    assert.equal(url.pathname, '/api/logout');
    return Response.json({ authenticated: false });
  } });
  assert.deepEqual(result, { failed: true, authenticated: true, stage: 'model_connection', status: 503 });
  assert.deepEqual(paths, ['/api/status', '/api/login', '/api/model-test', '/api/logout']);
  assert.equal(flushes, 0);
  assert.equal(JSON.stringify(result).includes(OPERATOR_ENV.INGENIUM_TELEMETRY_KEY), false);
});
