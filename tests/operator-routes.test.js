import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.js';

async function fixture(t) {
  const dataDir = mkdtempSync(join(tmpdir(), 'fm-hidden-operator-'));
  let generated = 0, cookie = '';
  const server = createApp({ dataDir, env: { STUDY_ACCESS_TOKEN: 'synthetic-owner-token-at-least-24' }, fetchImpl: async () => { generated++; throw new Error('No provider calls expected.'); } });
  t.after(async () => { await server.closeVoiceSessions(); await new Promise(resolve => server.close(resolve)); rmSync(dataDir, { recursive: true, force: true }); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, method = 'GET', body) => {
    const response = await fetch(origin + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json(), response };
  };
  const login = async () => { const result = await request('/api/login', 'POST', { token: 'synthetic-owner-token-at-least-24' }); assert.equal(result.status, 200); cookie = result.response.headers.get('set-cookie').split(';')[0]; };
  return { request, login, generated: () => generated };
}
const title = 'Operator natural conversation check · synthetic study';

test('internal check endpoints retain owner authentication and reject arbitrary reserved records', async t => {
  const app = await fixture(t);
  assert.equal((await app.request('/api/operator/state')).status, 401);
  assert.equal((await app.request('/api/operator/conversations', 'POST', { title, mode: 'coach' })).status, 401);
  await app.login();
  assert.equal((await app.request('/api/operator/conversations', 'POST', { title: 'My normal chat', mode: 'coach' })).status, 400);
  assert.equal((await app.request('/api/conversations', 'POST', { title, mode: 'coach' })).status, 400);
  const ordinary = await app.request('/api/conversations', 'POST', { title: 'My normal chat', mode: 'coach', internalCheck: true });
  assert.equal(ordinary.status, 201);
  assert.notEqual(ordinary.body.internalCheck, true);
  assert.equal(app.generated(), 0);
});

test('internal check conversations never become learner state or exported chat history', async t => {
  const app = await fixture(t); await app.login();
  const ordinary = (await app.request('/api/conversations', 'POST', { title: 'Normal study conversation', mode: 'coach' })).body;
  const internal = await app.request('/api/operator/conversations', 'POST', { title, mode: 'coach' });
  assert.equal(internal.status, 201); assert.equal(internal.body.internalCheck, true);
  await app.request('/api/chat', 'POST', { conversationId: internal.body.id, requestId: 'natural-dialogue-v1-hello-gpt-4.1-mini', content: 'Synthetic operator hello.' });
  const state = (await app.request('/api/state')).body;
  const backup = (await app.request('/api/export')).body;
  const operators = (await app.request('/api/operator/state')).body;
  assert.deepEqual(state.conversations.map(x => x.id), [ordinary.id]);
  assert.deepEqual(backup.conversations.map(x => x.id), [ordinary.id]);
  assert.equal(operators.conversations.length, 2);
  assert.equal(operators.conversations.find(x => x.id === internal.body.id).messages.length, 2);
});

test('restoring a learner backup preserves internal paid-request identities and rejects internal-ID collisions', async t => {
  const app = await fixture(t); await app.login();
  await app.request('/api/conversations', 'POST', { title: 'Learner history', mode: 'coach' });
  const internal = (await app.request('/api/operator/conversations', 'POST', { title, mode: 'coach' })).body;
  const turn = { conversationId: internal.id, requestId: 'natural-dialogue-v1-hello-gpt-4.1-mini', content: 'Synthetic operator hello.' };
  const original = await app.request('/api/chat', 'POST', turn);
  assert.equal(original.status, 200);
  const backup = (await app.request('/api/export')).body;
  assert.equal((await app.request('/api/import', 'POST', backup)).status, 200);
  const before = app.generated();
  const repeated = await app.request('/api/chat', 'POST', turn);
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.message.id, original.body.message.id);
  assert.equal(app.generated(), before);
  const full = (await app.request('/api/operator/state')).body;
  assert.equal(full.conversations.find(x => x.id === internal.id).messages[0].requestId, turn.requestId);
  const forged = { ...backup, conversations: [{ ...backup.conversations[0], id: internal.id }] };
  assert.equal((await app.request('/api/import', 'POST', forged)).status, 400);
  assert.equal((await app.request('/api/operator/state')).body.conversations.find(x => x.id === internal.id).messages.length, 2);
});
