import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildApplication } from '../server/bootstrap.js';
import { loadConfig } from '../server/config.js';

async function fixture(t, provider) {
  const dataDir = mkdtempSync(join(tmpdir(), 'studychat-http-'));
  const config = loadConfig({ HOST: '127.0.0.1', PORT: '0', DATA_DIR: dataDir, STUDY_ACCESS_TOKEN: 'test-owner-access-token-32-characters' });
  const app = buildApplication({ config, provider });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.shutdown(); rmSync(dataDir, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  const login = await fetch(`${origin}/api/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: config.accessToken }) });
  assert.equal(login.status, 200); await login.json();
  const headers = { Origin: origin, 'Content-Type': 'application/json', Cookie: login.headers.get('set-cookie').split(';')[0] };
  const post = (path, body) => fetch(origin + path, { method: 'POST', headers, body: JSON.stringify(body) });
  return { app, origin, headers, post };
}
async function events(response) {
  assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /text\/event-stream/);
  return (await response.text()).split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
}

test('HTTP chat IDs round trip through encoded history and DELETE routes', async t => {
  const { app, origin, headers, post } = await fixture(t, { async generate() { return { content: 'Hello.' }; } });
  const conversationId = 'owner.case:1', turnId = 'turn.case:1', attemptId = 'attempt.case:1';
  assert.equal((await events(await post('/api/chat', { conversationId, turnId, attemptId, input: 'Hello' }))).at(-1).status, 'completed');
  const history = await fetch(`${origin}/api/conversations/${encodeURIComponent(conversationId)}`, { headers });
  assert.equal(history.status, 200); assert.equal((await history.json()).turns[0].attemptId, attemptId);
  assert.equal((await fetch(`${origin}/api/conversations/${encodeURIComponent(conversationId)}?beforeSeq=invalid`, { headers })).status, 400);
  assert.equal((await fetch(`${origin}/api/conversations/${encodeURIComponent('invalid/id')}`, { headers })).status, 400);
  const removed = await fetch(`${origin}/api/conversations/${encodeURIComponent(conversationId)}`, { method: 'DELETE', headers });
  assert.equal(removed.status, 200); await removed.json(); assert.equal(app.chat.history(conversationId).conversation, null);
});

test('no-key HTTP Coach fails explicitly while canonical practice, cards, review, and Library stay usable', async t => {
  const { origin, headers, post } = await fixture(t);
  const submitted = await events(await post('/api/chat', { conversationId: 'no-ai', turnId: 'greeting', attemptId: 'greeting-a', input: 'Hello' }));
  assert.equal(submitted.at(-1).type, 'error'); assert.equal(submitted.at(-1).code, 'ai_unavailable'); assert.match(submitted.at(-1).error, /AI unavailable/);
  const quiz = await events(await post('/api/chat', { conversationId: 'no-ai', turnId: 'quiz', attemptId: 'quiz-a', input: '/quiz' }));
  assert.equal(quiz.at(-1).status, 'completed'); assert.match(quiz.at(-1).content, /Choose A/);
  for (const path of ['/api/library', '/api/practice', '/api/cards', '/api/review']) { const response = await fetch(origin + path, { headers }); assert.equal(response.status, 200); await response.json(); }
});

test('logout aborts an active HTTP generation and leaves an authoritative cancelled outcome', async t => {
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const { app, origin, headers, post } = await fixture(t, { async generate({ onDelta }) { onDelta('Partial'); entered(); return new Promise(() => {}); } });
  const stream = await post('/api/chat', { conversationId: 'active', turnId: 'turn', attemptId: 'attempt', input: 'Hello' }); await started;
  const logout = await post('/api/logout', {}); assert.equal(logout.status, 200); await logout.json();
  const terminal = (await events(stream)).at(-1);
  assert.equal(terminal.status, 'cancelled'); assert.equal(app.chat.history('active').turns[0].status, 'cancelled');
  assert.equal((await fetch(`${origin}/api/conversations/active`, { headers })).status, 401);
});
