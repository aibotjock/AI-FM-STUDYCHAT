import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createCommercialApp } from '../server/commercial/index.js';
import { contentSha256 } from '../server/guidelines.js';

const NOW = Date.parse('2026-10-09T12:00:00Z');
const pilot = { PRIVATE_PILOT: 'true', PUBLIC_RELEASE: 'false', AI_PROVIDER: 'anthropic', CLAUDE_API_KEY: 'test-claude-key' };
// Nonclinical fixture exercises the provider path, not medical correctness.
const source = { id: 'recall-fixture', title: 'Recall study method', body: 'Recall practice means explaining a study concept before checking a note.', domain: 'foundations', status: 'published', contentType: 'original-teaching', source: { title: 'Invented test note', organization: 'Test fixture', url: 'https://example.org/test-only', edition: 'fixture-1', effectiveDate: '2026-10-01' }, review: { reviewer: 'Invented test reviewer', reviewedAt: '2026-10-02', nextReviewAt: '2026-11-01' }, rights: { status: 'cleared', commercialUse: true, aiProcessing: true, perpetual: true, evidence: 'Original nonclinical test fixture.' } };
source.source.contentSha256 = contentSha256(source.body);

async function fixture(t, { env = {}, fetchImpl } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'commercial-providers-test-'));
  let server, url, cookie;
  async function start(providerEnv) {
    server = createCommercialApp({ dataDir, env: providerEnv, fetchImpl, now: () => NOW, corpus: { version: 'test-only', ready: true, records: [source] } });
    server.listen(0, '127.0.0.1'); await once(server, 'listening'); url = `http://127.0.0.1:${server.address().port}`;
  }
  await start({ ...pilot, ...env });
  t.after(async () => { if (server.listening) await new Promise(resolve => server.close(resolve)); rmSync(dataDir, { recursive: true, force: true }); });
  async function request(path, method = 'GET', body) {
    const response = await fetch(url + path, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return { response, result: await response.json() };
  }
  await request('/api/register', 'POST', { email: 'provider@example.org', password: 'test-password-long-enough' });
  const conversation = (await request('/api/conversations', 'POST', { mode: 'coach' })).result;
  return { request, conversation, async switchProvider(nextEnv) { await new Promise(resolve => server.close(resolve)); await start({ ...pilot, ...nextEnv }); } };
}
const claudeResponse = value => Response.json({ content: [{ type: 'text', text: JSON.stringify(value) }], usage: { input_tokens: 100, output_tokens: 20 }, stop_reason: 'end_turn' });

test('commercial Claude replies remain source checked and use Claude prices', async t => {
  let calls = 0;
  const app = await fixture(t, { fetchImpl: async (url, options) => {
    calls++; assert.equal(url, 'https://api.anthropic.com/v1/messages');
    const body = JSON.parse(options.body); assert.equal(body.model, 'claude-haiku-5-5'); assert.equal(body.max_tokens, 600);
    return claudeResponse({ answer: calls === 1 ? source.body : 'Invented unsupported clinical recommendation.', citationIds: [source.id], unsupported: false });
  } });
  const first = await app.request('/api/chat', 'POST', { conversationId: app.conversation.id, content: 'Teach recall study practice', requestId: 'claude-grounded' });
  assert.equal(first.response.status, 200); assert.equal(first.result.message.content, source.body); assert.equal(first.result.message.citations[0].url, source.source.url);
  const status = (await app.request('/api/status')).result; assert.equal(status.provider, 'Claude'); assert.equal(status.providerId, 'anthropic'); assert.equal(status.model, 'claude-haiku-5-5'); assert.equal(status.usage.usedUsd, .000020);
  assert.equal((await app.request('/api/chat', 'POST', { conversationId: app.conversation.id, content: 'Explain recall again', requestId: 'claude-unsupported' })).response.status, 502);
  assert.equal(calls, 2);
});

test('commercial Claude requests still reserve budget first and do not fall back to OpenAI', async t => {
  let calls = 0;
  const app = await fixture(t, { env: { AI_GLOBAL_MONTHLY_BUDGET_USD: '.00001' }, fetchImpl: async () => { calls++; throw Error('No request should be sent'); } });
  const request = { conversationId: app.conversation.id, content: 'Teach recall study practice', requestId: 'budget' };
  assert.equal((await app.request('/api/chat', 'POST', request)).response.status, 503); assert.equal(calls, 0);
  await app.switchProvider({ AI_PROVIDER: 'anthropic', CLAUDE_API_KEY: '', OPENAI_API_KEY: 'test-openai-key' });
  assert.equal((await app.request('/api/chat', 'POST', { ...request, requestId: 'no-fallback' })).response.status, 503); assert.equal(calls, 0);
});

test('commercial request replay cannot cross the selected provider after restart', async t => {
  let calls = 0;
  const app = await fixture(t, { fetchImpl: async () => {
    calls++; const isCards = calls === 2;
    return claudeResponse(isCards ? { cards: [{ front: 'What does recall practice mean?', sourceId: source.id, back: source.body }] } : { answer: source.body, citationIds: [source.id], unsupported: false });
  } });
  await app.request('/api/chat', 'POST', { conversationId: app.conversation.id, content: 'Teach recall study practice', requestId: 'context' });
  const cardsRequest = { conversationId: app.conversation.id, requestId: 'same-card-request' };
  const drafts = await app.request('/api/chat/cards', 'POST', cardsRequest); assert.equal(drafts.response.status, 200); assert.equal(drafts.result.cards[0].back, source.body);
  await app.switchProvider({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'test-openai-key' });
  assert.equal((await app.request('/api/chat/cards', 'POST', cardsRequest)).response.status, 409); assert.equal(calls, 2);
});
