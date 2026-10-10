import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { runIngeniumConnectionCheck } from '../server/ingenium-check.js';
import { createApp } from '../server/index.js';
import { createStudyCurriculum } from '../server/study-curriculum.js';
import { INGENIUM_TELEMETRY_ENDPOINT } from '../server/ingenium-telemetry.js';

const BASE = 'http://127.0.0.1:3000/';
const TARGETS = ['gpt-5.6-terra', 'gpt-6-luna'];
const ACCESS = 'mock-comparison-owner-access-never-exported';
const COOKIE = 'studychat_session=mock-comparison-session-never-exported';
const ENV = {
  INGENIUM_INITIAL_CONNECTION_CHECK: 'luna6-terra56-ready-v1',
  STUDY_ACCESS_TOKEN: ACCESS,
  INGENIUM_TELEMETRY_KEY: `ia_${'x'.repeat(43)}`,
  INGENIUM_TELEMETRY_ORGANIZATION_ID: '11111111-2222-4333-8444-555555555555',
  APP_MODE: 'personal', AI_PROVIDER: 'openai'
};
const activeStatus = model => ({ aiConfigured: true, providerId: 'openai', modelSelectionEnabled: true, authRequired: true, model });
const resultId = model => `ingenium-luna6-terra56-ready-v1-${model}`;
const readyResult = model => ({ requestedModel: model, returnedModel: model, connectionPassed: true, instructionPassed: true, latencyMs: 123, usage: { prompt_tokens: 20, completion_tokens: 1 }, estimatedCostUsd: .0000096, cached: false, answer: `PRIVATE ${ACCESS}`, extraSecret: ENV.INGENIUM_TELEMETRY_KEY });

function mock({ catalog = { source: 'account', stale: false, models: TARGETS.map(id => ({ id })) }, select, readback, connection } = {}) {
  let current = 'gpt-4.1-mini', statusCalls = 0;
  const calls = [];
  const fetchImpl = async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : undefined;
    const path = url.pathname;
    calls.push({ path, method: options.method, body });
    assert.equal(url.origin, new URL(BASE).origin);
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    if (path === '/api/status' && statusCalls++ === 0) {
      assert.equal(options.headers.Cookie, undefined);
      return Response.json(activeStatus(current));
    }
    if (path === '/api/login') {
      assert.equal(options.headers.Cookie, undefined);
      assert.deepEqual(body, { token: ACCESS });
      return Response.json({ authenticated: true }, { headers: { 'Set-Cookie': `${COOKIE}; Path=/; HttpOnly` } });
    }
    assert.equal(options.headers.Cookie, COOKIE);
    if (path === '/api/models') return Response.json(catalog);
    if (path === '/api/model') {
      assert.equal(options.method, 'PUT');
      assert.deepEqual(body, { model: TARGETS[calls.filter(call => call.path === '/api/model').length - 1] });
      current = body.model;
      return select ? select(current) : Response.json({ model: current });
    }
    if (path === '/api/status') return Response.json(readback ? readback(current) : activeStatus(current));
    if (path === '/api/model-test') {
      assert.deepEqual(body, { requestId: resultId(current) });
      return connection ? connection(current) : Response.json(readyResult(current));
    }
    if (path === '/api/ingenium-status') return Response.json({ delivered: 2, pending: 0, secret: ACCESS });
    assert.equal(path, '/api/logout');
    assert.deepEqual(body, {});
    return Response.json({ authenticated: false });
  };
  return { fetchImpl, calls };
}

test('the comparison gate is exact, personal OpenAI only, credential-dependent and restricted to the local listener', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error('No request authorized'); };
  for (const gate of ['', 'luna6-terra56', 'LUNA6-TERRA56-READY-V1']) {
    assert.deepEqual(await runIngeniumConnectionCheck({ baseUrl: BASE, env: { ...ENV, INGENIUM_INITIAL_CONNECTION_CHECK: gate }, fetchImpl }), { skipped: true });
  }
  for (const baseUrl of ['https://127.0.0.1:3000/', 'http://remote.example/', 'http://localhost:3000/', 'http://127.0.0.1:3000/private/', 'http://127.0.0.1:3000/?redirect=remote', 'http://127.0.0.1:3000/#remote', 'http://user:secret@127.0.0.1:3000/']) {
    await assert.rejects(runIngeniumConnectionCheck({ baseUrl, env: ENV, fetchImpl }), /local app listener/);
  }
  for (const fields of [{ APP_MODE: 'commercial' }, { AI_PROVIDER: 'anthropic' }, { STUDY_ACCESS_TOKEN: '' }, { INGENIUM_TELEMETRY_KEY: '' }, { INGENIUM_TELEMETRY_ORGANIZATION_ID: '' }]) {
    const result = await runIngeniumConnectionCheck({ baseUrl: BASE, env: { ...ENV, ...fields }, fetchImpl });
    assert.equal(result.skipped, true);
  }
  assert.equal(calls, 0);
});

test('comparison selects Terra then Luna serially, uses durable IDs and exposes only safe summary fields', async () => {
  const transport = mock({ connection: model => Response.json({ ...readyResult(model), cached: model === 'gpt-5.6-terra' }) });
  let flushes = 0;
  const result = await runIngeniumConnectionCheck({ baseUrl: BASE, env: ENV, ...transport, flushTelemetry: async () => { flushes++; } });
  assert.deepEqual(transport.calls.map(call => call.path), ['/api/status', '/api/login', '/api/models', '/api/model', '/api/status', '/api/model-test', '/api/model', '/api/status', '/api/model-test', '/api/status', '/api/ingenium-status', '/api/logout']);
  assert.deepEqual(transport.calls.filter(call => call.path === '/api/model-test').map(call => call.body.requestId), TARGETS.map(resultId));
  assert.equal(result.activeModel, 'gpt-6-luna');
  assert.equal(result.lunaActive, true);
  assert.equal(result.clinicalAccuracy, 'Not evaluated');
  assert.deepEqual(result.results.map(row => row.cached), [true, false]);
  assert.deepEqual(result.results.map(row => row.requestedModel), TARGETS);
  assert.equal(result.results[0].inputTokens, 20);
  assert.equal(result.results[0].latencyMs, 123);
  assert.equal(result.results[0].estimatedCostUsd, .0000096);
  assert.equal(result.delivered, 2);
  assert.equal(result.pending, 0);
  assert.equal(flushes, 1);
  for (const marker of [ACCESS, COOKIE, ENV.INGENIUM_TELEMETRY_KEY, 'PRIVATE', 'answer', 'extraSecret']) assert.equal(JSON.stringify(result).includes(marker), false);
});

test('unconfirmed, stale or incomplete account catalogs stop before model selection or inference and log out', async () => {
  for (const catalog of [
    { source: 'documented', stale: false, models: TARGETS.map(id => ({ id })) },
    { source: 'account', stale: true, models: TARGETS.map(id => ({ id })) },
    { source: 'account', stale: false, models: [{ id: 'gpt-6-luna' }] },
    { source: 'account', models: TARGETS.map(id => ({ id })) }
  ]) {
    const transport = mock({ catalog });
    const result = await runIngeniumConnectionCheck({ baseUrl: BASE, env: ENV, ...transport });
    assert.equal(result.failed, true);
    assert.equal(result.stage, 'fresh_candidate_access_unconfirmed');
    assert.equal(result.lunaActive, false);
    assert.equal(transport.calls.some(call => ['/api/model', '/api/model-test'].includes(call.path)), false);
    assert.equal(transport.calls.at(-1).path, '/api/logout');
  }
});

test('selection conflicts and selection or readback identity mismatches stop without an unauthorized model check', async () => {
  const cases = [
    { select: () => Response.json({ error: 'Private selection failure' }, { status: 409 }), expectedCalls: 0 },
    { select: () => Response.json({ model: 'gpt-4.1-mini' }), expectedCalls: 0 },
    { readback: () => activeStatus('gpt-4.1-mini'), expectedCalls: 0 },
    { select: model => model === 'gpt-6-luna' ? Response.json({ error: 'Private selection collision' }, { status: 409 }) : Response.json({ model }), expectedCalls: 1 }
  ];
  for (const { expectedCalls, ...options } of cases) {
    const transport = mock(options);
    const result = await runIngeniumConnectionCheck({ baseUrl: BASE, env: ENV, ...transport });
    assert.equal(result.failed, true);
    assert.equal(result.lunaActive, false);
    assert.equal(transport.calls.filter(call => call.path === '/api/model-test').length, expectedCalls);
    assert.equal(transport.calls.at(-1).path, '/api/logout');
  }
});

test('failed or uncertain candidate checks are attempted once and only the other explicit candidate can follow', async () => {
  for (const status of [409, 503]) {
    const transport = mock({ connection: model => model === 'gpt-5.6-terra' ? Response.json({ error: `Private failure ${ACCESS}` }, { status }) : Response.json(readyResult(model)) });
    const result = await runIngeniumConnectionCheck({ baseUrl: BASE, env: ENV, ...transport });
    assert.equal(result.failed, true);
    assert.equal(result.results[0].status, status);
    assert.equal(result.results[0].stage, 'model_connection');
    assert.equal(result.lunaActive, true);
    assert.deepEqual(transport.calls.filter(call => call.path === '/api/model-test').map(call => call.body.requestId), TARGETS.map(resultId));
    assert.equal(JSON.stringify(result).includes(ACCESS), false);
  }
  const mismatch = mock({ connection: model => Response.json({ ...readyResult(model), returnedModel: 'gpt-4.1-mini' }) });
  const result = await runIngeniumConnectionCheck({ baseUrl: BASE, env: ENV, ...mismatch });
  assert.equal(result.stage, 'model_identity');
  assert.equal(result.lunaActive, false);
  assert.equal(mismatch.calls.filter(call => call.path === '/api/model-test').length, 1);
});

test('authenticated local HTTP comparison replaces a saved override, emits exact metadata and reuses passed checks after restart', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'studychat-ingenium-comparison-'));
  const db = new DatabaseSync(join(directory, 'studychat.sqlite'));
  db.exec('CREATE TABLE owner_ai_config (id INTEGER PRIMARY KEY CHECK (id = 1), model TEXT NOT NULL)');
  db.prepare('INSERT INTO owner_ai_config(id,model) VALUES(1,?)').run('gpt-4.1-mini');
  db.close();
  const completions = [], events = [];
  const env = { ...ENV, OPENAI_API_KEY: 'mock-private-provider-key', OPENAI_MODEL: 'gpt-6-luna' };
  const providerFetch = async (url, options) => {
    if (url === INGENIUM_TELEMETRY_ENDPOINT) {
      const event = JSON.parse(options.body);
      assert.equal(event.source, 'app_observed');
      assert.equal(event.provider, 'openai');
      assert.match(event.requestId, /^[0-9a-f-]{36}$/);
      for (const secret of [ACCESS, env.OPENAI_API_KEY, ENV.INGENIUM_TELEMETRY_KEY, 'READY']) assert.equal(JSON.stringify(event).includes(secret), false);
      events.push(event);
      return Response.json({ accepted: true });
    }
    assert.equal(options.headers.Authorization, `Bearer ${env.OPENAI_API_KEY}`);
    if (url === 'https://api.openai.com/v1/models') return Response.json({ data: TARGETS.map(id => ({ id })) });
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    const body = JSON.parse(options.body);
    assert.ok(TARGETS.includes(body.model));
    assert.equal(body.reasoning_effort, 'low');
    assert.equal(body.max_completion_tokens, 512);
    assert.equal(body.store, false);
    completions.push(body.model);
    return Response.json({ model: body.model, choices: [{ message: { content: 'READY' }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 1 } });
  };
  const references = createStudyCurriculum({ records: [] });
  const servers = [];
  t.after(async () => {
    for (const server of servers) if (server.listening) await new Promise(resolve => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  });
  async function app() {
    const server = createApp({ dataDir: directory, env, fetchImpl: providerFetch, curriculum: references, foundations: references });
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const baseUrl = `http://127.0.0.1:${server.address().port}/`;
    return { server, baseUrl };
  }
  const first = await app();
  assert.equal((await (await fetch(new URL('/api/status', first.baseUrl))).json()).model, 'gpt-4.1-mini');
  assert.equal((await fetch(new URL('/api/models', first.baseUrl))).status, 401);
  const result = await runIngeniumConnectionCheck({ baseUrl: first.baseUrl, env, flushTelemetry: () => first.server.flushIngeniumTelemetry() });
  assert.equal(result.lunaActive, true);
  assert.deepEqual(completions, TARGETS);
  assert.deepEqual(events.map(event => [event.requestedModel, event.returnedModel]), TARGETS.map(model => [model, model]));
  assert.equal(new Set(events.map(event => event.requestId)).size, 2);
  assert.deepEqual(events.map(event => event.estimatedCostUsd), [.000052, .0000025]);
  assert.equal(result.delivered, 2);
  assert.equal(result.pending, 0);
  assert.equal((await (await fetch(new URL('/api/status', first.baseUrl))).json()).model, 'gpt-6-luna');
  await new Promise(resolve => first.server.close(resolve));
  const restarted = await app();
  const reused = await runIngeniumConnectionCheck({ baseUrl: restarted.baseUrl, env, flushTelemetry: () => restarted.server.flushIngeniumTelemetry() });
  assert.equal(reused.lunaActive, true);
  assert.deepEqual(reused.results.map(row => row.cached), [true, true]);
  assert.deepEqual(completions, TARGETS);
  assert.equal(events.length, 2);
});
