import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createCommercialApp } from '../server/commercial/index.js';
import { createUsage } from '../server/commercial/usage.js';
import { contentSha256, NO_EVIDENCE_ANSWER } from '../server/guidelines.js';

const NOW = Date.parse('2026-10-09T12:00:00Z');
const pilot = { PRIVATE_PILOT: 'true', PUBLIC_RELEASE: 'false' };
const password = 'safe-test-password-123';
const card = { front: 'Personal study question', back: 'Personal study answer', topic: 'Recall', sourceTitle: '', sourceUrl: '', verified: false };
// Invented nonclinical fixture, not evidence of medical accuracy or reviewer credentials.
const source = { id: 'recall-fixture', title: 'Recall study method', body: 'Recall practice means explaining a study concept before checking a note.', domain: 'foundations', status: 'published', contentType: 'original-teaching', source: { title: 'Invented test note', organization: 'Test fixture', url: 'https://example.org/test-only', edition: 'fixture-1', effectiveDate: '2026-10-01' }, review: { reviewer: 'Invented test reviewer', reviewedAt: '2026-10-02', nextReviewAt: '2026-11-01' }, rights: { status: 'cleared', commercialUse: true, aiProcessing: true, perpetual: true, evidence: 'Original nonclinical test fixture.' } };
source.source.contentSha256 = contentSha256(source.body);

async function fixture(t, options = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'commercial-study-test-'));
  const server = createCommercialApp({ dataDir, env: { ...pilot, ...options.env }, now: () => NOW, ...options });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { if (server.listening) await new Promise(resolve => server.close(resolve)); rmSync(dataDir, { recursive: true, force: true }); });
  function client() {
    let cookie;
    async function request(path, method = 'GET', body, extraHeaders = {}) {
      const response = await fetch(url + path, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...extraHeaders }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      const setCookie = response.headers.get('set-cookie'); if (setCookie) cookie = setCookie.split(';')[0];
      return { response, result: await response.json() };
    }
    const register = async email => { const result = await request('/api/register', 'POST', { email, password }); assert.equal(result.response.status, 200); return result.result.account; };
    return { request, register, getCookie: () => cookie };
  }
  const rawRequest = (path, headers = {}) => new Promise((resolve, reject) => {
    const req = httpRequest(url + path, { headers }, res => { let data = ''; res.on('data', chunk => { data += chunk; }); res.on('end', () => resolve({ response: { status: res.statusCode }, result: JSON.parse(data) })); });
    req.on('error', reject); req.end();
  });
  return { server, client, dataDir, url, rawRequest };
}

test('commercial preparation blocks public launch and unconfigured public billing', () => {
  assert.throws(() => createCommercialApp({ env: { PUBLIC_RELEASE: 'true' } }), /Public release is blocked/);
  assert.throws(() => createCommercialApp({ env: {} }), /Configure Google Play billing/);
  assert.throws(() => createCommercialApp({ env: { ...pilot, COMMERCIAL_OPENAI_MODEL: 'another-model' } }), /Unknown aliases are disabled/);
  assert.throws(() => createCommercialApp({ env: { ...pilot, COMMERCIAL_OPENAI_MODEL: 'another-model', AI_INPUT_USD_PER_MILLION: '1', AI_OUTPUT_USD_PER_MILLION: '1' } }), /Unknown aliases are disabled/);
});

test('commercial accounts isolate cards, conversations, backups and restore ownership', async t => {
  const app = await fixture(t), alice = app.client(), bob = app.client(), anonymous = app.client();
  assert.equal((await anonymous.request('/api/state')).response.status, 401);
  const accountA = await alice.register('Alice@example.org'), accountB = await bob.register('bob@example.org');
  assert.notEqual(accountA.id, accountB.id); assert.match(accountA.obfuscatedAccountId, /^[a-f0-9]{64}$/);
  const created = (await alice.request('/api/cards', 'POST', card)).result;
  const conversation = (await alice.request('/api/conversations', 'POST', { mode: 'coach' })).result;
  assert.equal((await bob.request(`/api/cards/${created.id}`, 'PUT', { front: 'Steal it' })).response.status, 404);
  assert.equal((await bob.request(`/api/conversations/${conversation.id}`, 'DELETE')).response.status, 404);
  assert.equal((await bob.request('/api/chat', 'POST', { conversationId: conversation.id, content: 'Read private chat' })).response.status, 404);
  const bState = (await bob.request('/api/state')).result; assert.equal(bState.cards.some(item => item.id === created.id), false);
  const bBackup = (await bob.request('/api/export')).result; bBackup.cards = [];
  assert.equal((await bob.request('/api/import', 'POST', bBackup)).response.status, 200);
  assert.equal((await alice.request('/api/state')).result.cards.some(item => item.id === created.id), true);
  assert.equal((await alice.request('/api/logout', 'POST', {})).response.status, 200);
  assert.equal((await alice.request('/api/state')).response.status, 401);
  assert.equal((await alice.request('/api/login', 'POST', { email: 'alice@example.org', password })).response.status, 200);
  assert.equal((await alice.request('/api/state')).result.cards.some(item => item.id === created.id), true);
});

test('real empty corpus abstains without spending AI money and reports require ownership', async t => {
  let calls = 0;
  const app = await fixture(t, { env: { ...pilot, OPENAI_API_KEY: 'server-secret' }, fetchImpl: async () => { calls++; throw Error('Should never call'); } });
  const alice = app.client(), bob = app.client(); await alice.register('alice@example.org'); await bob.register('bob@example.org');
  const conversation = (await alice.request('/api/conversations', 'POST', { mode: 'coach' })).result;
  const reply = await alice.request('/api/chat', 'POST', { conversationId: conversation.id, content: 'Teach a medical guideline', requestId: 'no-source' });
  assert.equal(reply.response.status, 200); assert.equal(reply.result.message.content, NO_EVIDENCE_ANSWER); assert.equal(reply.result.message.unsupported, true); assert.equal(calls, 0);
  const report = { conversationId: conversation.id, messageId: reply.result.message.id, reason: 'Please add reviewed evidence.' };
  assert.equal((await bob.request('/api/reports', 'POST', report)).response.status, 404);
  assert.equal((await alice.request('/api/reports', 'POST', report)).response.status, 201);
  const repeated = (await alice.request('/api/reports', 'POST', report)); assert.equal(repeated.response.status, 200);
  for (let count = 2; count < 5; count++) { const duplicate = await alice.request('/api/reports', 'POST', report); assert.equal(duplicate.response.status, 200); assert.equal(duplicate.result.reportId, repeated.result.reportId); }
  assert.equal((await alice.request('/api/reports', 'POST', report)).response.status, 429);
  const status = (await alice.request('/api/status')).result; assert.equal(status.privatePilot, true); assert.equal(status.entitlement.source, 'private-pilot'); assert.equal(status.usage.turns, 0); assert.equal(status.guidelines.ready, false);
  assert.equal(JSON.stringify(status).includes('server-secret'), false);
});

test('a report upload finishing after account deletion cannot recreate the workspace', async t => {
  const app = await fixture(t), client = app.client(), account = await client.register('one@example.org');
  const conversation = (await client.request('/api/conversations', 'POST', { mode: 'coach' })).result;
  const reply = (await client.request('/api/chat', 'POST', { conversationId: conversation.id, content: 'Review a study method', requestId: 'no-evidence' })).result;
  const body = JSON.stringify({ conversationId: conversation.id, messageId: reply.message.id, reason: 'Review this answer.' });
  let observed;
  const received = new Promise(resolve => { observed = (_req) => { if (_req.url === '/api/reports') { app.server.off('request', observed); resolve(); } }; app.server.on('request', observed); });
  let finish;
  const response = new Promise((resolve, reject) => {
    const req = httpRequest(app.url + '/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Cookie: client.getCookie() } }, res => { let data = ''; res.on('data', chunk => { data += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) })); });
    req.on('error', reject); req.write(body.slice(0, 1)); finish = () => req.end(body.slice(1));
  });
  await received;
  assert.equal((await client.request('/api/account/delete', 'POST', { confirmation: 'DELETE' })).response.status, 200);
  finish(); assert.equal((await response).status, 410);
  assert.equal(existsSync(join(app.dataDir, 'users', account.id)), false);
  const db = new DatabaseSync(join(app.dataDir, 'commercial.sqlite')); t.after(() => db.close());
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM content_reports').get().count, 0);
});

test('grounded replies attach approved sources, bill once and reject free clinical generation', async t => {
  let calls = 0;
  const app = await fixture(t, { env: { ...pilot, OPENAI_API_KEY: 'server-key' }, corpus: { version: 'test-only', ready: true, records: [source] }, fetchImpl: async (_url, options) => {
    calls++; const input = JSON.parse(options.body); assert.equal(input.model, 'gpt-5.4-mini-2026-03-17'); assert.equal(input.max_completion_tokens, 600); assert.equal(input.store, false);
    return Response.json({ choices: [{ message: { content: JSON.stringify({ answer: calls === 1 ? source.body : 'Invented clinical treatment recommendation.', citationIds: [source.id], unsupported: false }) } }], usage: { prompt_tokens: 50, completion_tokens: 50 } });
  } });
  const client = app.client(); await client.register('one@example.org');
  const conversation = (await client.request('/api/conversations', 'POST', { mode: 'coach' })).result;
  const request = { conversationId: conversation.id, content: 'Teach recall study practice', requestId: 'grounded' };
  const first = await client.request('/api/chat', 'POST', request); assert.equal(first.response.status, 200); assert.equal(first.result.message.content, source.body); assert.equal(first.result.message.citations[0].url, source.source.url);
  const repeated = await client.request('/api/chat', 'POST', request); assert.equal(repeated.result.message.id, first.result.message.id); assert.equal(calls, 1);
  assert.equal((await client.request('/api/chat', 'POST', { ...request, requestId: 'invalid' })).response.status, 502);
  const saved = (await client.request('/api/state')).result; assert.equal(saved.conversations[0].messages.some(message => message.content.includes('Invented clinical treatment')), false);
  assert.equal((await client.request('/api/status')).result.usage.turns, 2);
});

test('server purchase token ownership prevents reusing another account receipt', async t => {
  const billingImpl = { configured: true, verify: async ({ userId, purchaseToken }) => ({ purchaseTokenHash: (await import('../server/commercial/accounts.js')).sha256(purchaseToken), productId: 'family_medicine_monthly', state: 'SUBSCRIPTION_STATE_ACTIVE', expiresAt: NOW + 86400000, checkedAt: NOW, isTrial: false, trialPhaseKnown: true, acknowledgementNeeded: false }), acknowledge: async () => true };
  const app = await fixture(t, { env: { PUBLIC_RELEASE: 'false', BILLING_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64') }, billingImpl });
  const alice = app.client(), bob = app.client(); await alice.register('alice@example.org'); await bob.register('bob@example.org');
  const first = await alice.request('/api/billing/verify', 'POST', { purchaseToken: 'test-server-receipt' }); assert.equal(first.response.status, 200); assert.equal(first.result.entitlement.active, true);
  assert.equal((await bob.request('/api/billing/verify', 'POST', { purchaseToken: 'test-server-receipt' })).response.status, 403);
  const db = new DatabaseSync(join(app.dataDir, 'commercial.sqlite')); t.after(() => db.close());
  const stored = db.prepare('SELECT encrypted_token FROM play_purchases').get(); assert.equal(stored.encrypted_token.includes('test-server-receipt'), false);
});

test('budget reservations are atomic, bounded and idempotent across store restart', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'commercial-usage-test-')), file = join(dir, 'usage.sqlite'); t.after(() => rmSync(dir, { recursive: true, force: true }));
  let db = new DatabaseSync(file), ledger = createUsage({ db, env: { AI_GLOBAL_MONTHLY_BUDGET_USD: '.0027' }, now: () => NOW });
  const input = { userId: 'one', requestId: 'first', fingerprint: 'same', isTrial: false, period: 'month', inputTokens: 0, outputTokens: 600 };
  const results = await Promise.allSettled([Promise.resolve().then(() => ledger.reserve(input)), Promise.resolve().then(() => ledger.reserve({ ...input, userId: 'two', requestId: 'second' }))]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(results.find(item => item.status === 'rejected').reason.status, 503);
  ledger.complete({ userId: 'one', requestId: 'first', usage: { prompt_tokens: 0, completion_tokens: 600 }, result: { content: 'Source-checked answer' } }); db.close();
  db = new DatabaseSync(file); ledger = createUsage({ db, env: { AI_GLOBAL_MONTHLY_BUDGET_USD: '.0027' }, now: () => NOW });
  assert.equal(ledger.reserve(input).replay.content, 'Source-checked answer');
  assert.throws(() => ledger.reserve({ ...input, fingerprint: 'different' }), error => error.status === 409);
  db.close();
});

test('unknown provider outcomes retain reservations and trial budget remains enforced', () => {
  const db = new DatabaseSync(':memory:');
  const ledger = createUsage({ db, env: { AI_TRIAL_BUDGET_USD: '.0027' }, now: () => NOW });
  const input = { userId: 'trial', requestId: 'first', fingerprint: 'same', isTrial: true, period: 'first', inputTokens: 0, outputTokens: 600 };
  ledger.reserve(input); ledger.failed('trial', 'first');
  assert.throws(() => ledger.reserve({ ...input, requestId: 'next', period: 'new-expiry' }), error => error.status === 429);
  assert.equal(ledger.summary('trial').usedUsd, .0027); db.close();
});

test('changing verified subscription expiry cannot reset a subscriber calendar allowance', () => {
  const db = new DatabaseSync(':memory:');
  const ledger = createUsage({ db, env: { AI_MONTHLY_BUDGET_USD: '.0027' }, now: () => NOW });
  const input = { userId: 'subscriber', requestId: 'first', fingerprint: 'same', isTrial: false, period: 'play:expiry-one', inputTokens: 0, outputTokens: 600 };
  ledger.reserve(input);
  assert.throws(() => ledger.reserve({ ...input, requestId: 'new-receipt', period: 'play:expiry-two' }), error => error.status === 429);
  db.close();
});

test('account deletion invalidates sessions, erases files and rejects an in-flight provider response', async t => {
  let resolveReply, startReply;
  const started = new Promise(resolve => { startReply = resolve; });
  const gate = new Promise(resolve => { resolveReply = resolve; });
  const app = await fixture(t, { env: { ...pilot, OPENAI_API_KEY: 'server-key' }, corpus: { version: 'test-only', ready: true, records: [source] }, fetchImpl: async () => { startReply(); await gate; return Response.json({ choices: [{ message: { content: JSON.stringify({ answer: source.body, citationIds: [source.id], unsupported: false }) } }], usage: { prompt_tokens: 10, completion_tokens: 20 } }); } });
  const alice = app.client(), account = await alice.register('alice@example.org');
  const conversation = (await alice.request('/api/conversations', 'POST', { mode: 'coach' })).result;
  const pending = alice.request('/api/chat', 'POST', { conversationId: conversation.id, content: 'Teach recall study practice', requestId: 'pending' });
  await started;
  assert.equal((await alice.request('/api/account/delete', 'POST', { confirmation: 'DELETE' })).response.status, 200);
  assert.equal(existsSync(join(app.dataDir, 'users', account.id)), false);
  resolveReply(); assert.equal((await pending).response.status, 410);
  assert.equal((await alice.request('/api/state')).response.status, 401);
  const db = new DatabaseSync(join(app.dataDir, 'commercial.sqlite')); t.after(() => db.close());
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM account_sessions WHERE user_id=?').get(account.id).count, 0);
  assert.equal(db.prepare('SELECT result FROM ai_requests').get().result, null);
  assert.equal(db.prepare('SELECT email FROM accounts WHERE id=?').get(account.id).email.includes('alice'), false);
});

test('commercial auth rejects weak passwords and cross-origin writes', async t => {
  const app = await fixture(t), client = app.client();
  assert.equal((await client.request('/api/register', 'POST', { email: 'one@example.org', password: 'short' })).response.status, 400);
  assert.equal((await client.request('/api/register', 'POST', { email: 'one@example.org', password }, { Origin: 'https://evil.example' })).response.status, 403);
});

test('network private pilots require HTTPS origin pinning and an invitation secret', async t => {
  assert.throws(() => createCommercialApp({ env: { ...pilot, HOST: '0.0.0.0' } }), /HTTPS APP_ORIGIN/);
  assert.throws(() => createCommercialApp({ env: { ...pilot, HOST: '0.0.0.0', APP_ORIGIN: 'https://study.example.org' } }), /PILOT_INVITE_TOKEN/);
  assert.throws(() => createCommercialApp({ env: { ...pilot, HOST: '0.0.0.0', APP_ORIGIN: 'http://study.example.org', PILOT_INVITE_TOKEN: 'secret-test-invitation-long-enough' } }), /HTTPS origin/);
  const invite = 'secret-test-invitation-long-enough';
  const app = await fixture(t, { env: { ...pilot, PILOT_INVITE_TOKEN: invite } }), client = app.client();
  const status = (await client.request('/api/status')).result; assert.equal(status.registrationRestricted, true); assert.equal(JSON.stringify(status).includes(invite), false);
  assert.equal((await client.request('/api/register', 'POST', { email: 'one@example.org', password })).response.status, 403);
  assert.equal((await client.request('/api/register', 'POST', { email: 'one@example.org', password, inviteToken: 'wrong' })).response.status, 403);
  assert.equal((await client.request('/api/register', 'POST', { email: 'one@example.org', password, inviteToken: invite })).response.status, 200);
  assert.equal((await app.rawRequest('/api/state', { Host: 'evil.example.org', Cookie: client.getCookie() })).response.status, 403);
});

test('remote origin rejects mismatched hosts and insecure same-host origins', async t => {
  const app = await fixture(t, { env: { ...pilot, HOST: '0.0.0.0', APP_ORIGIN: 'https://study.example.org', PILOT_INVITE_TOKEN: 'secret-test-invitation-long-enough' } }), client = app.client();
  assert.equal((await client.request('/api/status')).response.status, 403);
  assert.equal((await app.rawRequest('/api/status', { Host: 'study.example.org' })).response.status, 200);
  assert.equal((await app.rawRequest('/api/status', { Host: 'study.example.org', Origin: 'http://study.example.org' })).response.status, 403);
});

test('new sign-in bounds active sessions and revokes the oldest session', async t => {
  const app = await fixture(t), oldest = app.client(), newest = app.client(), account = await oldest.register('one@example.org');
  const db = new DatabaseSync(join(app.dataDir, 'commercial.sqlite')); t.after(() => db.close());
  const expires = db.prepare('SELECT expires_at FROM account_sessions WHERE user_id=?').get(account.id).expires_at;
  for (let index = 1; index < 15; index++) db.prepare('INSERT INTO account_sessions(hash,user_id,expires_at) VALUES(?,?,?)').run(index.toString(16).padStart(64, '0'), account.id, expires);
  assert.equal((await newest.request('/api/login', 'POST', { email: 'one@example.org', password })).response.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM account_sessions WHERE user_id=?').get(account.id).count, 10);
  assert.equal((await oldest.request('/api/state')).response.status, 401);
  assert.equal((await newest.request('/api/state')).response.status, 200);
});

test('email sign-in throttling uses the same whitespace and case normalization as credentials', async t => {
  const app = await fixture(t), client = app.client(); await client.register('one@example.org'); await client.request('/api/logout', 'POST', {});
  for (let index = 0; index < 9; index++) assert.equal((await client.request('/api/login', 'POST', { email: 'one@example.org', password: 'incorrect-password-long' })).response.status, 401);
  for (const email of ['one@example.org', ' one@example.org', 'one@example.org ', '\tONE@example.org\n']) assert.equal((await client.request('/api/login', 'POST', { email, password: 'incorrect-password-long' })).response.status, 429);
});
