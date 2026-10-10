import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createChatService } from '../server/chat.js';

test('selection is captured per attempt, duplicate identity cannot switch models, and explicit failed retry can', async t => {
  const db = new DatabaseSync(':memory:'); let defaults = { provider: 'openai', model: 'gpt-4.1-mini' }, calls = [];
  const chat = createChatService({ db, getSelection: () => defaults, provider: { async generate({ selection }) { calls.push(selection); if (calls.length === 1) { const error = new Error('Temporary outage'); error.code = 'provider_http'; throw error; } return { content: 'Claude reply', provider: selection.provider, model: selection.model }; } } });
  t.after(() => { chat.close(); db.close(); });
  const request = { conversationId: 'c', turnId: 't', attemptId: 'a', input: 'Hello' };
  assert.equal((await chat.submit(request)).status, 'failed');
  defaults = { provider: 'anthropic', model: 'claude-sonnet-5-5' };
  assert.equal((await chat.submit(request)).duplicate, true); assert.equal(calls.length, 1);
  await assert.rejects(chat.submit({ ...request, ...defaults }), { code: 'payload_mismatch' });
  const reply = await chat.submit({ ...request, ...defaults, retry: true, attemptId: 'b' });
  assert.equal(reply.status, 'completed'); assert.equal(reply.provider, 'anthropic'); assert.equal(reply.model, defaults.model);
  assert.deepEqual(calls, [{ provider: 'openai', model: 'gpt-4.1-mini' }, defaults]);
  const saved = chat.history('c').turns[0]; assert.equal(saved.attempts.length, 2); assert.deepEqual(saved.selection, defaults);
  const copy = chat.validateImport(chat.exportData()); db.exec('BEGIN'); chat.importData(copy); db.exec('COMMIT');
  assert.equal(chat.history('c').turns[0].historicalMetadata.provider, 'anthropic'); assert.equal(chat.history('c').turns[0].provider, null);
});
