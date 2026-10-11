import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';

async function withApp(fn, protectedAccess = true) {
  const config = loadConfig({ HOST: '127.0.0.1', PORT: '0', STUDY_ACCESS_TOKEN: protectedAccess ? 'a'.repeat(32) : '' });
  const chat = { conversations: () => [], history: id => ({ conversation: { id }, turns: [] }), removeConversation() {}, cancel: () => ({ cancelled: true }), async submit(body, emit, { signal }) { emit({ type: 'start', ...body }); if (body.input === 'wait') await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); emit({ type: 'done', content: 'Hello', turnId: body.turnId, attemptId: body.attemptId }); } };
  const app = createApp({ config, chat });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  try { await fn({ origin, app }); } finally { await app.close(); }
}

test('HTTP protects private state, checks origin, uses HttpOnly cookies, and serves only the public shell', () => withApp(async ({ origin }) => {
  assert.equal((await fetch(`${origin}/health`)).status, 200);
  assert.equal((await fetch(`${origin}/api/conversations`)).status, 401);
  assert.equal((await fetch(`${origin}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'a'.repeat(32) }) })).status, 403);
  const login = await fetch(`${origin}/api/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'a'.repeat(32) }) });
  assert.equal(login.status, 200); const cookie = login.headers.get('set-cookie'); assert.match(cookie, /HttpOnly; SameSite=Strict/);
  const headers = { Cookie: cookie.split(';')[0], Origin: origin, 'Content-Type': 'application/json' };
  assert.equal((await fetch(`${origin}/api/conversations`, { headers })).status, 200);
  for (const path of ['/api/voice', '/api/voice/start', '/api/voice/transcribe', '/api/voice/speech']) {
    const request = path === '/api/voice' ? { headers } : { method: 'POST', headers, body: '{}' };
    assert.equal((await fetch(origin + path, request)).status, 404);
  }
  for (const path of ['/server/store.js', '/content/medical-question-bank.json', '/packages/practice-engine/server/question-bank.js']) assert.equal((await fetch(origin + path)).status, 404);
  const stream = await fetch(`${origin}/api/chat`, { method: 'POST', headers, body: JSON.stringify({ conversationId: 'c', turnId: 't', attemptId: 'a', input: 'hello' }) });
  assert.match(stream.headers.get('content-type'), /text\/event-stream/); assert.match(await stream.text(), /"type":"done"/);
  await fetch(`${origin}/api/logout`, { method: 'POST', headers, body: '{}' });
  assert.equal((await fetch(`${origin}/api/conversations`, { headers })).status, 401);
}));

test('invalid access token is visibly rejected and throttled', () => withApp(async ({ origin }) => {
  for (let i = 0; i < 5; i++) assert.equal((await fetch(`${origin}/api/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{"token":"wrong"}' })).status, 401);
  assert.equal((await fetch(`${origin}/api/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{"token":"wrong"}' })).status, 429);
}));

test('device package is public with bounded paths and WASM-capable CSP while private files stay inaccessible', () => withApp(async ({ origin }) => {
  const manifest = await fetch(`${origin}/voice-assets/manifest.json`);
  assert.equal(manifest.status, 200);
  assert.match(manifest.headers.get('content-security-policy'), /script-src 'self' 'wasm-unsafe-eval'/);
  const bytes = await manifest.arrayBuffer();
  assert.equal(bytes.byteLength, Number(manifest.headers.get('content-length')));
  const value = JSON.parse(new TextDecoder().decode(bytes));
  assert.equal(value.voices.length, 5);
  const head = await fetch(`${origin}/voice-assets/manifest.json`, { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(Number(head.headers.get('content-length')), bytes.byteLength); assert.equal((await head.arrayBuffer()).byteLength, 0);
  for (const path of ['/voice-assets/%2e%2e%2fserver/config.js', '/voice-assets/models/whisper/config.py', '/voice-assets/.env', '/server/config.js']) assert.equal((await fetch(origin + path)).status, 404);
}));
