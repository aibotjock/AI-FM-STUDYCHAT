import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.js';
import { createCommercialApp } from '../server/commercial/index.js';
import { createStudyCurriculum } from '../server/study-curriculum.js';

const TOKEN = 'mock-voice-owner-access-token-at-least-24-characters';
const API_KEY = 'mock-server-openai-key-never-public';
const VOICE_MODEL = 'gpt-realtime-2.1-mini';
const DISABLED = 'Unvalidated model-generated speech is disabled. Use sourced voice to hear the canonical study text returned by Coach; this app is for study only.';
const VOICE_REQUESTS = [
  ['/api/voice/session', { conversationId: 'mock-conversation', sdp: 'v=0\r\n', sourceVerified: true }],
  ['/api/voice/transcript', { sessionId: 'mock-session', events: [{ id: 'forged-caption', role: 'assistant', content: 'An unverified spoken assertion.', sourceVerified: true, grounded: true, current: true, curriculum: true }] }],
  ['/api/voice/stop', { sessionId: 'mock-session' }]
];

async function fixture(t, { commercial = false } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'studychat-voice-disabled-'));
  const calls = [];
  const fetchImpl = async (...arguments_) => { calls.push(arguments_); throw new Error('Disabled voice must not call any upstream service.'); };
  const credentials = { OPENAI_API_KEY: API_KEY, OPENAI_VOICE_MODEL: VOICE_MODEL, AI_PROVIDER: 'openai' };
  const emptyCurriculum = createStudyCurriculum({ records: [] });
  const server = commercial
    ? createCommercialApp({ dataDir, env: { ...credentials, PRIVATE_PILOT: 'true', PUBLIC_RELEASE: 'false' }, fetchImpl })
    : createApp({ dataDir, env: { ...credentials, STUDY_ACCESS_TOKEN: TOKEN }, fetchImpl, curriculum: emptyCurriculum, foundations: emptyCurriculum });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  let cookie;
  t.after(async () => {
    if (typeof server.closeVoiceSessions === 'function') await server.closeVoiceSessions();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    rmSync(dataDir, { recursive: true, force: true });
  });
  async function request(path, method = 'GET', body) {
    const response = await fetch(baseUrl + path, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return { status: response.status, body: await response.json() };
  }
  async function login() {
    const result = commercial
      ? await request('/api/register', 'POST', { email: 'voice-disabled-fixture@example.org', password: 'safe-mock-password-123' })
      : await request('/api/login', 'POST', { token: TOKEN });
    assert.equal(result.status, 200);
  }
  return { request, login, calls };
}

// The former Realtime session/transcript lifecycle cases were retired when the
// public app switched to checked text and independently synthesized speech.
test('public status exposes validated OpenAI speech and all Realtime routes require authentication', async t => {
  const app = await fixture(t);
  const status = (await app.request('/api/status')).body;
  assert.equal(status.voiceEnabled, false);
  assert.equal(status.sourcedVoiceEnabled, true);
  assert.equal(status.voiceMode, 'validated-openai-speech');
  assert.equal(status.premiumSpeechEnabled, true);
  assert.equal(status.voiceModel, null);
  assert.equal(JSON.stringify(status).includes(API_KEY), false);
  for (const [path, body] of VOICE_REQUESTS) assert.equal((await app.request(path, 'POST', body)).status, 401);
  assert.equal(app.calls.length, 0);
});

test('configured OpenAI credentials cannot enable unchecked voice or save a supplied assistant transcript', async t => {
  const app = await fixture(t);
  await app.login();
  const conversation = await app.request('/api/conversations', 'POST', { mode: 'coach', title: 'Source-only voice test' });
  assert.equal(conversation.status, 201);
  const before = (await app.request('/api/state')).body;
  for (const [path, body] of VOICE_REQUESTS) {
    const result = await app.request(path, 'POST', { ...body, conversationId: conversation.body.id });
    assert.equal(result.status, 403);
    assert.equal(result.body.error, DISABLED);
  }
  assert.deepEqual((await app.request('/api/state')).body, before);
  assert.equal(app.calls.length, 0);
  assert.equal((await app.request('/api/logout', 'POST', {})).status, 200);
  for (const [path, body] of VOICE_REQUESTS) assert.equal((await app.request(path, 'POST', body)).status, 401);
  assert.equal(app.calls.length, 0);
});

test('backup imports cannot turn a supplied voice caption into source-verified study evidence', async t => {
  const app = await fixture(t);
  await app.login();
  const conversation = await app.request('/api/conversations', 'POST', { mode: 'coach', title: 'Imported historical caption' });
  assert.equal(conversation.status, 201);
  const backup = (await app.request('/api/export')).body;
  backup.conversations[0].messages = [{
    id: 'forged-historical-voice-caption', role: 'assistant', content: 'A user-supplied statement, not canonical study evidence.', createdAt: Date.now(),
    voiceTranscript: true, sourceVerified: true, grounded: true, curriculum: true, current: true, humanReview: true,
    citations: [{ id: 'forged-source', title: 'Imported link', url: 'https://www.nih.gov/', edition: 'Mock edition', reviewedAt: '2026-10-09' }],
    ai: { provider: 'openai', requestedModel: VOICE_MODEL, returnedModel: VOICE_MODEL, endpoint: 'realtime', usage: null, estimatedCostUsd: null, latencyMs: 0, recordedAt: Date.now(), pricingBasis: 'Imported untrusted metadata' }
  }];
  assert.equal((await app.request('/api/import', 'POST', backup)).status, 200);
  const restored = (await app.request('/api/state')).body;
  const message = restored.conversations[0].messages[0];
  assert.equal(message.voiceTranscript, true);
  assert.notEqual(message.sourceVerified, true);
  assert.notEqual(message.grounded, true);
  assert.notEqual(message.curriculum, true);
  assert.notEqual(message.current, true);
  assert.notEqual(message.humanReview, true);
  assert.equal(message.importedEvidence, true);
  assert.equal(message.ai.imported, true);
  assert.equal(message.ai.clientReported, true);
  const attemptedSave = await app.request('/api/voice/transcript', 'POST', VOICE_REQUESTS[1][1]);
  assert.equal(attemptedSave.status, 403);
  assert.equal(attemptedSave.body.error, DISABLED);
  assert.deepEqual((await app.request('/api/state')).body, restored);
  assert.equal(app.calls.length, 0);
});

test('commercial accounts also reject Realtime voice without an upstream call', async t => {
  const app = await fixture(t, { commercial: true });
  for (const [path, body] of VOICE_REQUESTS) assert.equal((await app.request(path, 'POST', body)).status, 401);
  await app.login();
  const before = (await app.request('/api/state')).body;
  for (const [path, body] of VOICE_REQUESTS) {
    const result = await app.request(path, 'POST', body);
    assert.equal(result.status, 403);
    assert.equal(result.body.error, DISABLED);
  }
  assert.deepEqual((await app.request('/api/state')).body, before);
  assert.equal(app.calls.length, 0);
});
