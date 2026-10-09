import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.js';
import { runPremiumVoiceCheck, PREMIUM_CHECK_REQUEST_ID } from '../server/premium-voice-check.js';

const BASE = 'http://127.0.0.1:3000/';
const ENV = { STUDY_INITIAL_PREMIUM_VOICE_CHECK: 'premium-v1', AI_PROVIDER: 'openai', APP_MODE: 'personal', STUDY_ACCESS_TOKEN: 'mock-owner-key', OPENAI_API_KEY: 'mock-openai-key', OPENAI_MODEL: 'gpt-4.1-mini' };
const OPTIONS = { enabled: true, provider: 'openai', model: 'gpt-4o-mini-tts', defaultVoice: 'marin', voices: ['marin', 'cedar', 'coral', 'sage', 'ash'].map(id => ({ id, label: id })) };
const MP3 = new Uint8Array(140); MP3.set([73, 68, 51]);
const HEADERS = { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-Study-Speech-Model': 'gpt-4o-mini-tts', 'X-Study-Speech-Voice': 'marin', 'X-Study-Speech-Chunks': '1', 'X-Study-Speech-Chunk': '0', 'X-Study-Speech-Usage': 'unknown', 'X-Study-Speech-Cost': 'unknown' };
const METADATA = { provider: 'openai', endpoint: 'audio/speech', model: 'gpt-4o-mini-tts', voice: 'marin', audioBytes: MP3.length, usage: null, estimatedCostUsd: null };
function harness({ status = { aiConfigured: true, providerId: 'openai' }, catalog = OPTIONS, savedStatus = 'not_started', savedMetadata = null, speech, alterIdentity = false } = {}) {
  const requests = [];
  const fetchImpl = async (url, options) => {
    assert.equal(url.origin, new URL(BASE).origin); assert.equal(options.redirect, 'error');
    const body = options.body === undefined ? undefined : JSON.parse(options.body);
    requests.push({ path: url.pathname, body });
    if (url.pathname === '/api/status') return Response.json(status);
    if (url.pathname === '/api/login') { assert.deepEqual(body, { token: ENV.STUDY_ACCESS_TOKEN }); return Response.json({}, { headers: { 'Set-Cookie': 'studychat_session=mock-cookie; HttpOnly' } }); }
    assert.equal(options.headers.Cookie, 'studychat_session=mock-cookie');
    if (url.pathname === '/api/voice/options') return Response.json(catalog);
    if (url.pathname === `/api/voice/check/${PREMIUM_CHECK_REQUEST_ID}`) return Response.json({ requestId: alterIdentity ? 'wrong-identity' : PREMIUM_CHECK_REQUEST_ID, status: savedStatus, metadata: savedMetadata });
    if (url.pathname === '/api/voice/preview') { assert.deepEqual(body, { voice: 'marin', requestId: PREMIUM_CHECK_REQUEST_ID }); return speech ? speech() : new Response(MP3, { headers: HEADERS }); }
    assert.equal(url.pathname, '/api/logout'); return Response.json({});
  };
  return { requests, fetchImpl };
}
const invoke = mock => runPremiumVoiceCheck({ baseUrl: BASE, env: ENV, fetchImpl: mock.fetchImpl });

test('premium preview gate permits only local personal OpenAI credentials, without requests when disabled', async () => {
  let calls = 0; const fetchImpl = async () => { calls++; throw new Error('Unexpected request'); };
  for (const env of [{}, { ...ENV, STUDY_INITIAL_PREMIUM_VOICE_CHECK: 'voice-v1' }, { ...ENV, AI_PROVIDER: 'anthropic' }, { ...ENV, APP_MODE: 'commercial' }, { ...ENV, OPENAI_API_KEY: '' }, { ...ENV, STUDY_ACCESS_TOKEN: '' }]) assert.equal((await runPremiumVoiceCheck({ baseUrl: BASE, env, fetchImpl })).skipped, true);
  for (const baseUrl of ['https://127.0.0.1:3000/', 'http://localhost/', 'http://example.com/', `${BASE}?x=1`, `${BASE}path`, 'http://user:secret@127.0.0.1/']) await assert.rejects(runPremiumVoiceCheck({ baseUrl, env: ENV, fetchImpl }), /local app listener/);
  assert.equal(calls, 0);
});
test('one fixed Marin preview validates five voice options and truthful MP3 metadata without exposing credentials or audio', async () => {
  const mock = harness(), receipt = await invoke(mock);
  assert.equal(receipt.premiumVoicePassed, true); assert.equal(receipt.voiceCatalogPassed, true); assert.equal(receipt.submitted, 1); assert.equal(receipt.logoutAttempted, true); assert.equal(receipt.audioBytes, MP3.length);
  assert.equal(receipt.usage, null); assert.equal(receipt.estimatedCostUsd, null);
  assert.equal(mock.requests.filter(r => r.path === '/api/voice/preview').length, 1);
  for (const secret of [ENV.STUDY_ACCESS_TOKEN, ENV.OPENAI_API_KEY, 'mock-cookie']) assert.equal(JSON.stringify(receipt).includes(secret), false);
  assert.equal('audio' in receipt, false);
});
test('durable complete premium receipt prevents paid repeat even after temporary audio expires', async () => {
  const mock = harness({ savedStatus: 'complete', savedMetadata: METADATA }), receipt = await invoke(mock);
  assert.equal(receipt.premiumVoicePassed, true); assert.equal(receipt.cached, true); assert.equal(receipt.submitted, 0);
  assert.equal(mock.requests.some(r => r.path === '/api/voice/preview'), false);
});
test('pending uncertain or conflicting premium request is blocked without retry', async () => {
  for (const savedStatus of ['pending', 'uncertain', 'unknown']) {
    const mock = harness({ savedStatus }), receipt = await invoke(mock);
    assert.equal(receipt.uncertain, true); assert.equal(receipt.submitted, 0); assert.equal(mock.requests.some(r => r.path === '/api/voice/preview'), false);
  }
  const conflict = harness({ alterIdentity: true }); assert.equal((await invoke(conflict)).stage, 'saved_speech_request'); assert.equal(conflict.requests.some(r => r.path === '/api/voice/preview'), false);
  const malformed = harness({ savedStatus: 'complete', savedMetadata: { ...METADATA, estimatedCostUsd: 0 } }); assert.equal((await invoke(malformed)).stage, 'saved_speech_validation'); assert.equal(malformed.requests.some(r => r.path === '/api/voice/preview'), false);
});
test('inactive provider or incorrect voice catalog stops before any premium inference', async () => {
  for (const status of [{ aiConfigured: false, providerId: 'openai' }, { aiConfigured: true, providerId: 'anthropic' }]) {
    const mock = harness({ status }); assert.equal((await invoke(mock)).skipped, true); assert.deepEqual(mock.requests.map(r => r.path), ['/api/status']);
  }
  for (const catalog of [{ ...OPTIONS, defaultVoice: 'cedar' }, { ...OPTIONS, voices: OPTIONS.voices.slice(1) }, { ...OPTIONS, model: 'blocked-model' }]) {
    const mock = harness({ catalog }); assert.equal((await invoke(mock)).stage, 'voice_catalog'); assert.equal(mock.requests.some(r => r.path === '/api/voice/preview'), false);
  }
});
test('invalid bytes headers or provider timeout yield one attempt and guaranteed logout', async () => {
  for (const [speech, stage] of [
    [() => new Response(MP3, { headers: { ...HEADERS, 'X-Study-Speech-Voice': 'ash' } }), 'speech_headers'],
    [() => new Response(new Uint8Array(140), { headers: HEADERS }), 'speech_bytes'],
    [() => new Response('failure', { status: 502 }), 'speech_response'],
    [() => { throw new Error('private-provider-secret'); }, 'premium_voice_check']
  ]) {
    const mock = harness({ speech }), receipt = await invoke(mock); assert.equal(receipt.stage, stage); assert.equal(receipt.submitted, 1); assert.equal(receipt.logoutAttempted, true); assert.equal(mock.requests.filter(r => r.path === '/api/voice/preview').length, 1); assert.equal(JSON.stringify(receipt).includes('private-provider-secret'), false);
  }
});
test('premium hook exercises actual authenticated local routes, persists its receipt and never repeats the mock provider call', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'fm-premium-check-')), calls = [];
  const env = { ...ENV, STUDY_ACCESS_TOKEN: 'local-premium-preview-test-token' };
  const server = createApp({ dataDir: dir, env, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/audio/speech'); const body = JSON.parse(options.body); calls.push(body);
    assert.equal(body.model, 'gpt-4o-mini-tts'); assert.equal(body.voice, 'marin'); assert.equal(body.response_format, 'mp3'); assert.equal(body.input, 'Hello. I am your AI study voice. We can work through one question at a time, at your pace.');
    return new Response(MP3, { headers: { 'Content-Type': 'audio/mpeg', 'X-Request-ID': 'mock-provider-request' } });
  } });
  t.after(async () => { await server.closeVoiceSessions(); await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true }); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const baseUrl = `http://127.0.0.1:${server.address().port}/`;
  const receipt = await runPremiumVoiceCheck({ baseUrl, env }); assert.equal(receipt.premiumVoicePassed, true, JSON.stringify(receipt)); assert.equal(receipt.submitted, 1); assert.equal(calls.length, 1);
  const saved = await runPremiumVoiceCheck({ baseUrl, env }); assert.equal(saved.premiumVoicePassed, true, JSON.stringify(saved)); assert.equal(saved.cached, true); assert.equal(saved.submitted, 0); assert.equal(calls.length, 1);
});
