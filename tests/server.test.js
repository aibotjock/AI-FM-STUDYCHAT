import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createApp } from '../server/index.js';
import { createStudyCurriculum } from '../server/study-curriculum.js';
import { studyCondition, STUDY_NOW } from './fixtures/study-condition.js';

const ACCESS_TOKEN = 'test-access-token-at-least-24-characters';
const cardInput = { front: 'What should I recall?', back: 'One clear idea.', topic: 'Recall', sourceTitle: '', sourceUrl: '', verified: false };
const managementFact = studyCondition().sections.find(section => section.id === 'management').text;

function naturalReply(payload, { factual = true } = {}) {
  const schema = payload.response_format?.json_schema?.name;
  assert.ok(['family_medicine_natural_tutor', 'family_medicine_natural_review'].includes(schema), `Unexpected generated contract ${schema}`);
  const text = factual ? managementFact : 'Which study step would you like to work through together?';
  const sourceChunkIds = factual ? ['asthma:management'] : [];
  const reply = schema === 'family_medicine_natural_review'
    ? { approved: true, segments: [{ id: 's1', approved: true, externalFactCount: factual ? 1 : 0, claims: factual ? [{ quote: text, type: 'medical', sourceChunkIds, supports: [{ chunkId: 'asthma:management', excerpt: managementFact }] }] : [], flags: [] }] }
    : { segments: [{ id: 's1', text, sourceChunkIds }] };
  return Response.json({ model: 'gpt-4.1-mini', usage: { prompt_tokens: 7, completion_tokens: 3 }, choices: [{ message: { content: JSON.stringify(reply) } }] });
}

async function fixture(t, options = {}) {
  const dataDir = options.dataDir || mkdtempSync(join(tmpdir(), 'studychat-test-'));
  const curriculum = createStudyCurriculum({ records: [studyCondition()], now: () => STUDY_NOW });
  const foundations = createStudyCurriculum({ records: [], now: () => STUDY_NOW });
  const server = createApp({ dataDir, curriculum, foundations, env: options.env || {}, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    if (!options.keepData) rmSync(dataDir, { recursive: true, force: true });
  });
  let cookie;
  async function request(path, method = 'GET', body, extraHeaders = {}) {
    const response = await fetch(url + path, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...extraHeaders }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    return { response, result };
  }
  async function login() {
    const { response } = await request('/api/login', 'POST', { token: ACCESS_TOKEN });
    cookie = response.headers.get('set-cookie')?.split(';')[0];
    assert.equal(response.status, 200);
    return response;
  }
  return { server, url, request, login, dataDir };
}

test('remote hosts require a strong access token and short tokens are refused', () => {
  assert.throws(() => createApp({ env: { HOST: '0.0.0.0' } }), /strong STUDY_ACCESS_TOKEN/);
  assert.throws(() => createApp({ env: { STUDY_ACCESS_TOKEN: 'short' } }), /at least 24/);
});

test('authentication protects study data and logout invalidates the session', async t => {
  const app = await fixture(t, { env: { STUDY_ACCESS_TOKEN: ACCESS_TOKEN, OPENAI_API_KEY: 'never-exposed' } });
  let result = await app.request('/api/status');
  assert.equal(result.result.authenticated, false);
  assert.equal(result.result.authRequired, true);
  assert.equal(result.result.provider, 'OpenAI');
  assert.equal(JSON.stringify(result.result).includes('never-exposed'), false);
  assert.equal((await app.request('/api/state')).response.status, 401);
  assert.equal((await app.request('/api/login', 'POST', { token: 'wrong' })).response.status, 401);
  const login = await app.login();
  assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.equal((await app.request('/api/state')).response.status, 200);
  assert.equal((await app.request('/api/logout', 'POST', {})).response.status, 200);
  assert.equal((await app.request('/api/state')).response.status, 401);
});

test('CSRF, DNS rebinding, unsafe source URLs, and malformed requests are rejected', async t => {
  const app = await fixture(t);
  assert.equal((await app.request('/api/cards', 'POST', cardInput, { Origin: 'https://evil.example' })).response.status, 403);
  assert.equal((await app.request('/api/cards', 'POST', cardInput, { 'Sec-Fetch-Site': 'cross-site' })).response.status, 403);
  const rebindingStatus = await new Promise((resolve, reject) => {
    const request = httpRequest(app.url + '/api/state', { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject); request.end();
  });
  assert.equal(rebindingStatus, 403);
  assert.equal((await app.request('/api/cards', 'POST', { ...cardInput, sourceUrl: 'javascript:alert(1)' })).response.status, 400);
  const response = await fetch(app.url + '/api/cards', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(response.status, 415);
  assert.equal((await app.request('/api/cards', 'POST', null)).response.status, 400);
  assert.equal((await app.request('/api/cards', 'POST', { ...cardInput, front: 'X'.repeat(2001) })).response.status, 400);
});

test('cards, settings, and scheduling survive a server restart', async t => {
  const first = await fixture(t, { keepData: true });
  const created = await first.request('/api/cards', 'POST', cardInput);
  assert.equal(created.response.status, 201);
  const id = created.result.id;
  const review = await first.request('/api/reviews', 'POST', { cardId: id, rating: 'good' });
  assert.equal(review.response.status, 200);
  assert.equal(review.result.card.state, 'review');
  assert.ok(review.result.card.dueAt > Date.now());
  assert.equal((await first.request('/api/reviews', 'POST', { cardId: id, rating: 'good' })).response.status, 409);
  const settings = await first.request('/api/settings', 'PUT', { focus: 'balanced', timeZone: 'Asia/Manila', competencyRatings: { PC: 3 }, voiceEnabled: false });
  assert.equal(settings.result.competencyRatings.PC, 3);
  assert.equal((await first.request('/api/settings', 'PUT', { timeZone: 'Mars/Invalid' })).response.status, 400);
  await new Promise(resolve => first.server.close(resolve));
  const second = await fixture(t, { dataDir: first.dataDir });
  const state = (await second.request('/api/state')).result;
  assert.equal(state.cards.find(card => card.id === id).state, 'review');
  assert.equal(state.reviews.length, 1);
  assert.equal(state.settings.timeZone, 'Asia/Manila');
  assert.equal(state.settings.competencyRatings.PC, 3);
  assert.equal(state.settings.voiceEnabled, false);
  const cleared = await second.request('/api/settings', 'PUT', { competencyRatings: {} });
  assert.deepEqual(cleared.result.competencyRatings, {});
});

test('card import and full restore validate atomically; backups keep review history', async t => {
  const app = await fixture(t);
  const before = (await app.request('/api/state')).result;
  const invalid = await app.request('/api/cards/import', 'POST', { cards: [cardInput, { front: 'Missing answer' }] });
  assert.equal(invalid.response.status, 400);
  assert.equal((await app.request('/api/state')).result.cards.length, before.cards.length);
  const imported = await app.request('/api/cards/import', 'POST', { cards: [cardInput, { ...cardInput, front: 'Another idea?' }] });
  assert.equal(imported.result.cards.length, 2);
  await app.request('/api/reviews', 'POST', { cardId: imported.result.cards[0].id, rating: 'again' });
  const backup = (await app.request('/api/export')).result;
  const invalidBackup = structuredClone(backup);
  invalidBackup.cards[0].sourceUrl = 'file:///etc/passwd';
  assert.equal((await app.request('/api/import', 'POST', invalidBackup)).response.status, 400);
  assert.equal((await app.request('/api/state')).result.cards.length, backup.cards.length);
  await app.request(`/api/cards/${imported.result.cards[0].id}`, 'DELETE');
  assert.equal((await app.request('/api/import', 'POST', backup)).response.status, 200);
  const restored = (await app.request('/api/state')).result;
  assert.equal(restored.cards.length, backup.cards.length);
  assert.deepEqual(restored.reviews, backup.reviews);
  assert.deepEqual(restored.settings, backup.settings);
});

test('offline study navigation is scripted, durable, and cannot create uncited conversation drafts', async t => {
  const app = await fixture(t);
  const conversation = (await app.request('/api/conversations', 'POST', { title: 'Reasoning practice', mode: 'coach' })).result;
  const chat = await app.request('/api/chat', 'POST', { conversationId: conversation.id, content: 'I want to practice synthesis.', requestId: 'offline-request-1' });
  assert.equal(chat.response.status, 200);
  assert.equal(chat.result.message.scripted, true);
  assert.equal(chat.result.message.canonicalStudyProcess, true);
  assert.equal(chat.result.message.sourceVerified, true);
  assert.match(chat.result.message.content, /Scripted prompt; no factual or clinical answer/);
  assert.equal(chat.result.conversation.messages.length, 2);
  const replay = await app.request('/api/chat', 'POST', { conversationId: conversation.id, content: 'I want to practice synthesis.', requestId: 'offline-request-1' });
  assert.equal(replay.result.message.id, chat.result.message.id);
  assert.equal(replay.result.conversation.messages.length, 2);
  const backup = (await app.request('/api/export')).result;
  assert.equal((await app.request('/api/import', 'POST', backup)).response.status, 200);
  const restoredReplay = await app.request('/api/chat', 'POST', { conversationId: conversation.id, content: 'I want to practice synthesis.', requestId: 'offline-request-1' });
  assert.equal(restoredReplay.result.message.id, chat.result.message.id);
  assert.equal(restoredReplay.result.conversation.messages.length, 2);
  const invalidReference = structuredClone(backup);
  invalidReference.conversations[0].messages[1].responseTo = 'missing-user';
  assert.equal((await app.request('/api/import', 'POST', invalidReference)).response.status, 400);
  const invalidDate = structuredClone(backup);
  invalidDate.conversations[0].messages[0].createdAt = 1e300;
  assert.equal((await app.request('/api/import', 'POST', invalidDate)).response.status, 400);
  const countBefore = (await app.request('/api/state')).result.cards.length;
  const drafts = await app.request('/api/chat/cards', 'POST', { conversationId: conversation.id });
  assert.equal(drafts.result.cards.length, 0);
  assert.ok(drafts.result.cards.every(card => card.verified === false));
  assert.equal((await app.request('/api/state')).result.cards.length, countBefore);
  assert.equal((await app.request(`/api/conversations/${conversation.id}`, 'DELETE')).response.status, 200);
});

test('conversation limits reserve room for a reply and permit an unresolved-message retry', async t => {
  const app = await fixture(t);
  const conversation = (await app.request('/api/conversations', 'POST', { mode: 'coach' })).result;
  const backup = (await app.request('/api/export')).result;
  backup.conversations[0].messages = Array.from({ length: 999 }, (_, index) => ({ id: `message-${index}`, role: 'assistant', content: 'Prior study prompt.', createdAt: Date.now() }));
  assert.equal((await app.request('/api/import', 'POST', backup)).response.status, 200);
  assert.equal((await app.request('/api/chat', 'POST', { conversationId: conversation.id, content: 'New question.' })).response.status, 400);
  backup.conversations[0].messages[998] = { id: 'pending-user', role: 'user', content: 'Retry question.', requestId: 'retry-final', createdAt: Date.now() };
  assert.equal((await app.request('/api/import', 'POST', backup)).response.status, 200);
  const retried = await app.request('/api/chat', 'POST', { conversationId: conversation.id, content: 'Retry question.', requestId: 'retry-final' });
  assert.equal(retried.response.status, 200);
  assert.equal(retried.result.conversation.messages.length, 1000);
  const full = (await app.request('/api/export')).result;
  assert.equal((await app.request('/api/import', 'POST', full)).response.status, 200);
});

test('provider failures return a safe durable fallback and replay without repeating a model request', async t => {
  let calls = 0;
  const requests = [];
  const app = await fixture(t, { env: { OPENAI_API_KEY: 'secret-test-key' }, fetchImpl: async (url, request) => {
    const body = JSON.parse(request.body);
    requests.push({ url, authorizationMatches: request.headers.Authorization === 'Bearer secret-test-key', body });
    if (++calls === 1) return new Response('secret-test-key provider internals', { status: 500 });
    return naturalReply(body);
  } });
  const conversation = (await app.request('/api/conversations', 'POST', { mode: 'coach' })).result;
  const request = { conversationId: conversation.id, content: 'Study asthma.', requestId: 'provider-retry' };
  const failed = await app.request('/api/chat', 'POST', request);
  assert.equal(failed.response.status, 200);
  assert.equal(failed.result.message.unsupported, true);
  assert.equal(failed.result.message.reviewedDialogue, undefined);
  assert.equal(failed.result.message.studyRejection.code, 'natural_tutor_validation');
  assert.match(failed.result.message.content, /could not complete the source check/);
  assert.equal(JSON.stringify(failed.result).includes('secret-test-key'), false);
  assert.equal((await app.request('/api/state')).result.conversations[0].messages.length, 2);
  const replay = await app.request('/api/chat', 'POST', request);
  assert.equal(replay.result.message.id, failed.result.message.id);
  assert.equal(calls, 1, 'Replaying a completed safe fallback cannot dispatch another provider request.');
  const success = await app.request('/api/chat', 'POST', { ...request, requestId: 'explicit-new-attempt' });
  assert.equal(success.response.status, 200, JSON.stringify(success.result));
  assert.equal(success.result.offline, false);
  assert.equal(success.result.message.reviewedDialogue, true);
  assert.equal(success.result.message.groundingReview.status, 'passed');
  assert.equal(success.result.message.sourceVerified, false);
  assert.equal(success.result.message.citations[0].url, 'https://www.nhlbi.nih.gov/health/asthma');
  assert.equal(success.result.conversation.messages.length, 4);
  assert.equal((await app.request('/api/chat', 'POST', { ...request, requestId: 'explicit-new-attempt' })).result.conversation.messages.length, 4);
  assert.equal(calls, 3, 'An explicit new attempt generates one draft and one grounding review after the failed draft.');
  for (const request of requests) {
    assert.equal(request.url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(request.authorizationMatches, true);
    assert.equal(request.body.model, 'gpt-4.1-mini');
    assert.equal(request.body.response_format.type, 'json_schema');
    assert.equal(request.body.response_format.json_schema.strict, true);
  }
});

test('same-conversation lock prevents concurrent replies, deletes, and backup restores', async t => {
  let release;
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  const app = await fixture(t, { env: { OPENAI_API_KEY: 'test' }, fetchImpl: async (url, request) => {
    markStarted();
    await pending;
    return naturalReply(JSON.parse(request.body));
  } });
  const conversation = (await app.request('/api/conversations', 'POST', { mode: 'practice' })).result;
  const backup = (await app.request('/api/export')).result;
  const active = app.request('/api/chat', 'POST', { conversationId: conversation.id, content: 'Study asthma.' });
  await started;
  assert.equal((await app.request('/api/chat', 'POST', { conversationId: conversation.id, content: 'Another message.' })).response.status, 409);
  assert.equal((await app.request(`/api/conversations/${conversation.id}`, 'DELETE')).response.status, 409);
  assert.equal((await app.request('/api/import', 'POST', backup)).response.status, 409);
  release();
  assert.equal((await active).response.status, 200);
});

test('slow uploads cannot overwrite a deleted card or restore over an active coaching reply', async t => {
  let release;
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  const app = await fixture(t, { env: { OPENAI_API_KEY: 'test' }, fetchImpl: async (url, request) => {
    markStarted(); await pending;
    return naturalReply(JSON.parse(request.body));
  } });
  async function beginUpload(path, method, value) {
    const body = Buffer.from(JSON.stringify(value));
    const seenRequest = once(app.server, 'request');
    let resolveResponse;
    let rejectResponse;
    const completed = new Promise((resolve, reject) => { resolveResponse = resolve; rejectResponse = reject; });
    const request = httpRequest(app.url + path, { method, headers: { 'Content-Type': 'application/json', 'Content-Length': body.length } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolveResponse({ status: response.statusCode, result: JSON.parse(Buffer.concat(chunks).toString()) }));
    });
    request.on('error', rejectResponse);
    const half = Math.max(1, Math.floor(body.length / 2));
    request.write(body.subarray(0, half));
    await seenRequest;
    return { finish: () => { request.end(body.subarray(half)); return completed; } };
  }
  const first = (await app.request('/api/cards', 'POST', cardInput)).result;
  const second = (await app.request('/api/cards', 'POST', { ...cardInput, front: 'Keep this card.' })).result;
  const edit = await beginUpload(`/api/cards/${first.id}`, 'PUT', { front: 'Replacement text.' });
  await app.request(`/api/cards/${first.id}`, 'DELETE');
  assert.equal((await edit.finish()).status, 404);
  assert.equal((await app.request('/api/state')).result.cards.find(card => card.id === second.id).front, 'Keep this card.');
  const conversation = (await app.request('/api/conversations', 'POST', { mode: 'coach' })).result;
  const backup = (await app.request('/api/export')).result;
  const restore = await beginUpload('/api/import', 'POST', backup);
  const active = app.request('/api/chat', 'POST', { conversationId: conversation.id, content: 'Study asthma.' });
  await started;
  assert.equal((await restore.finish()).status, 409);
  release();
  assert.equal((await active).response.status, 200);
  assert.equal((await app.request('/api/state')).result.conversations.find(item => item.id === conversation.id).messages.length, 2);
});

test('uncited conversation card drafting cannot dispatch another provider or fabricate source provenance', async t => {
  let calls = 0;
  const app = await fixture(t, { env: { OPENAI_API_KEY: 'test' }, fetchImpl: async (url, request) => {
    calls++;
    const input = JSON.parse(request.body);
    return naturalReply(input, { factual: false });
  } });
  const conversation = (await app.request('/api/conversations', 'POST', { mode: 'coach' })).result;
  await app.request('/api/chat', 'POST', { conversationId: conversation.id, content: 'Teach recall.' });
  assert.equal(calls, 2, 'The generated coaching turn includes a separate grounding review.');
  const drafts = (await app.request('/api/chat/cards', 'POST', { conversationId: conversation.id })).result.cards;
  assert.deepEqual(drafts, []);
  assert.equal(calls, 2, 'Drafting cannot request a model-generated uncited card.');
});

test('oversized growth rolls back without detaching other active chats, and every export can restore', async t => {
  let release;
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  const app = await fixture(t, { env: { OPENAI_API_KEY: 'test' }, fetchImpl: async (url, request) => {
    markStarted(); await pending;
    return naturalReply(JSON.parse(request.body));
  } });
  const conversation = (await app.request('/api/conversations', 'POST', { mode: 'coach' })).result;
  const backup = (await app.request('/api/export')).result;
  backup.conversations[0].messages = Array.from({ length: 900 }, (_, index) => ({ id: `large-${index}`, role: 'assistant', content: 'x'.repeat(18000), createdAt: 1000, sourceVerified: false }));
  const targetBytes = 16 * 1024 * 1024 - 8192;
  let extra = targetBytes - Buffer.byteLength(JSON.stringify(backup));
  for (const message of backup.conversations[0].messages) {
    const amount = Math.min(20000 - message.content.length, Math.max(0, extra));
    message.content += 'x'.repeat(amount); extra -= amount;
  }
  assert.equal(extra, 0);
  assert.equal((await app.request('/api/import', 'POST', backup)).response.status, 200);
  const active = app.request('/api/chat', 'POST', { conversationId: conversation.id, content: 'Study asthma.', requestId: 'large-test-request' });
  await started;
  assert.equal((await app.request('/api/cards', 'POST', { ...cardInput, front: 'f'.repeat(2000), back: 'b'.repeat(8000) })).response.status, 413);
  release();
  assert.equal((await active).response.status, 200);
  const exported = (await app.request('/api/export')).result;
  assert.equal(exported.cards.length, backup.cards.length);
  assert.equal(exported.conversations[0].messages.length, 902);
  assert.ok(Buffer.byteLength(JSON.stringify(exported)) < 16 * 1024 * 1024);
  assert.equal((await app.request('/api/import', 'POST', exported)).response.status, 200);
});

test('login throttling rejects repeated guesses', async t => {
  const app = await fixture(t, { env: { STUDY_ACCESS_TOKEN: ACCESS_TOKEN } });
  for (let i = 0; i < 8; i++) assert.equal((await app.request('/api/login', 'POST', { token: 'wrong' })).response.status, 401);
  assert.equal((await app.request('/api/login', 'POST', { token: ACCESS_TOKEN })).response.status, 429);
});
