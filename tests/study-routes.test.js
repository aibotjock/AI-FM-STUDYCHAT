import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.js';
import { createStudyCurriculum } from '../server/study-curriculum.js';
import { studyCondition, STUDY_NOW } from './fixtures/study-condition.js';

async function fixture(t, options = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'study-routes-'));
  const curriculum = options.curriculum || createStudyCurriculum({ records: options.records || [studyCondition()], now: () => STUDY_NOW });
  let calls = 0;
  const requests = [];
  const fetchImpl = async (url, request) => {
    calls++;
    const payload = JSON.parse(request.body);
    requests.push(payload);
    const response = options.reply || { chunkIds: ['asthma:management'], questionId: null, unsupported: false };
    return Response.json({ model: 'gpt-4.1-mini', usage: { prompt_tokens: 7, completion_tokens: 3 }, choices: [{ message: { content: JSON.stringify(response) } }] });
  };
  const server = createApp({ dataDir, env: options.env || {}, curriculum, fetchImpl, ...(options.authenticateRequest ? { authenticateRequest: options.authenticateRequest } : {}), ...(options.generateReply ? { generateReply: options.generateReply } : {}) });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { if (server.listening) await new Promise(resolve => server.close(resolve)); rmSync(dataDir, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${server.address().port}`;
  let cookie;
  async function request(path, method = 'GET', body, headers = {}) {
    const response = await fetch(url + path, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json(), response };
  }
  return { server, request, requests, calls: () => calls, async login(token) { const result = await request('/api/login', 'POST', { token }); cookie = result.response.headers.get('set-cookie')?.split(';')[0]; return result; }, async conversation(conditionId = 'asthma') { return (await request('/api/conversations', 'POST', { mode: 'coach', conditionId })).body; } };
}

test('curriculum is authenticated and read-only detail hides keys, explanations and approval claims', async t => {
  const token = 'curriculum-test-access-token-at-least-24-characters';
  const app = await fixture(t, { env: { STUDY_ACCESS_TOKEN: token } });
  assert.equal((await app.request('/api/curriculum')).status, 401);
  assert.equal((await app.login(token)).status, 200);
  const list = await app.request('/api/curriculum?q=asthma&domain=chronic');
  assert.equal(list.body.total, 1);
  assert.equal(list.body.questionCount, 2);
  assert.match(list.body.disclaimer, /not medical advice/);
  const detail = await app.request('/api/curriculum/asthma');
  assert.equal(detail.body.condition.humanReview, false);
  assert.equal(detail.body.condition.chunks.length, 3);
  assert.equal(JSON.stringify(detail.body).includes('correctChoiceId'), false);
  assert.equal(JSON.stringify(detail.body).includes('explicitly supports'), false);
  assert.equal((await app.request('/api/curriculum/missing')).status, 404);
  assert.equal((await app.request('/api/curriculum?q=' + 'x'.repeat(301))).status, 400);
});

test('question grading is canonical, choices validated and CSRF mutations rejected', async t => {
  const app = await fixture(t);
  const good = await app.request('/api/curriculum/asthma/answer', 'POST', { questionId: 'asthma-q1', choiceId: 'B' });
  assert.equal(good.status, 200);
  assert.equal(good.body.correct, true);
  assert.equal(good.body.correctChoiceId, 'B');
  assert.equal(good.body.choices[0].explanation, 'This is not supported by the mock reference.');
  assert.equal(good.body.sources[0].kind, 'official-clinical-reference');
  assert.equal((await app.request('/api/curriculum/asthma/answer', 'POST', { questionId: 'asthma-q1', choiceId: 'Z' })).status, 400);
  assert.equal((await app.request('/api/curriculum/asthma/card', 'POST', { questionId: 'asthma-q1' }, { Origin: 'https://evil.example' })).status, 403);
});

test('expired content stays visible but cannot grade, save cards or ground chat', async t => {
  const curriculum = createStudyCurriculum({ records: [studyCondition()], now: () => Date.parse('2026-11-10T00:00:00Z') });
  const app = await fixture(t, { curriculum, env: { OPENAI_API_KEY: 'mock-key' } });
  assert.equal((await app.request('/api/curriculum/asthma')).body.condition.current, false);
  for (const route of ['answer', 'card']) assert.equal((await app.request(`/api/curriculum/asthma/${route}`, 'POST', { questionId: 'asthma-q1', choiceId: 'B' })).status, 409);
  const conversation = await app.conversation();
  const reply = await app.request('/api/chat', 'POST', { conversationId: conversation.id, content: 'Study asthma' });
  assert.equal(reply.body.message.unsupported, true);
  assert.equal(app.calls(), 0);
});

test('canonical cards save idempotently with source dates and existing spaced repetition', async t => {
  const app = await fixture(t);
  const created = await app.request('/api/curriculum/asthma/card', 'POST', { questionId: 'asthma-q1', sourceUrl: 'https://evil.example', verified: true });
  assert.equal(created.status, 201);
  assert.equal(created.body.card.verified, false);
  assert.equal(created.body.card.sourceVerified, true);
  assert.equal(created.body.card.sourceCheckedAt, '2026-10-09');
  assert.equal(created.body.card.sourceExpiresAt, '2026-11-09');
  assert.equal(created.body.card.curriculumQuestionId, 'asthma-q1');
  assert.match(created.body.card.sourceUrl, /nih.gov/);
  const replay = await app.request('/api/curriculum/asthma/card', 'POST', { questionId: 'asthma-q1' });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.cached, true);
  assert.equal(replay.body.card.id, created.body.card.id);
  const review = await app.request('/api/reviews', 'POST', { cardId: created.body.card.id, rating: 'good' });
  assert.equal(review.status, 200);
  assert.equal(review.body.card.curriculumConditionId, 'asthma');
  assert.equal(review.body.card.state, 'review');
});

test('edited and restored card provenance stays untrusted while bounded dates survive backup', async t => {
  const app = await fixture(t);
  const card = (await app.request('/api/curriculum/asthma/card', 'POST', { questionId: 'asthma-q1' })).body.card;
  const edited = await app.request(`/api/cards/${card.id}`, 'PUT', { back: 'Learner edited this answer.' });
  assert.equal(edited.body.sourceVerified, false);
  assert.equal(edited.body.importedSource, true);
  const backup = (await app.request('/api/export')).body;
  assert.equal((await app.request('/api/import', 'POST', backup)).status, 200);
  const restored = (await app.request('/api/state')).body.cards.find(item => item.id === card.id);
  assert.equal(restored.sourceExpiresAt, '2026-11-09');
  assert.equal(restored.sourceVerified, false);
  assert.equal(restored.humanReview, false);
  backup.cards.find(item => item.id === card.id).sourceCheckedAt = '2026-02-30';
  assert.equal((await app.request('/api/import', 'POST', backup)).status, 400);
});

test('condition conversation linkage survives backup and invalid references are refused', async t => {
  const app = await fixture(t);
  const conversation = await app.conversation();
  assert.equal(conversation.curriculumConditionId, 'asthma');
  assert.equal((await app.request('/api/conversations', 'POST', { mode: 'coach', conditionId: 'missing' })).status, 400);
  assert.equal((await app.request('/api/conversations', 'POST', { mode: 'coach', conditionId: 'asthma', curriculumConditionId: 'different' })).status, 400);
  const backup = (await app.request('/api/export')).body;
  assert.equal((await app.request('/api/import', 'POST', backup)).status, 200);
  assert.equal((await app.request('/api/state')).body.conversations[0].curriculumConditionId, 'asthma');
  assert.equal((await app.request('/api/chat', 'POST', { conversationId: conversation.id, content: 'Study asthma', conditionIds: ['missing'] })).status, 400);
});

test('connected study chat selects canonical text and never exposes generated clinical prose', async t => {
  const app = await fixture(t, { env: { OPENAI_API_KEY: 'mock-key' } });
  const conversation = await app.conversation();
  const payload = { conversationId: conversation.id, content: 'Study asthma inhaler technique', requestId: 'one-study-request' };
  const result = await app.request('/api/chat', 'POST', payload);
  assert.equal(result.status, 200);
  assert.equal(result.body.message.sourceVerified, true);
  assert.equal(result.body.message.humanReview, false);
  assert.equal(result.body.message.curriculum, true);
  assert.match(result.body.message.content, /Mock management fact: review inhaler technique/);
  assert.equal(result.body.message.citations[0].url, 'https://www.nhlbi.nih.gov/health/asthma');
  assert.equal(app.requests[0].response_format.type, 'json_object');
  assert.ok(app.requests[0].messages.some(message => /NOT been clinician-reviewed/.test(message.content)));
  assert.equal((await app.request('/api/chat', 'POST', payload)).body.message.id, result.body.message.id);
  assert.equal(app.calls(), 1);
});

test('invented selector answer bodies and citation laundering fall back to an honest evidence gap', async t => {
  const app = await fixture(t, { env: { OPENAI_API_KEY: 'mock-key' }, reply: { chunkIds: ['asthma:management'], questionId: null, unsupported: false, answer: 'Take an invented medicine.' } });
  const conversation = await app.conversation();
  const result = await app.request('/api/chat', 'POST', { conversationId: conversation.id, content: 'Study asthma' });
  assert.equal(result.body.message.unsupported, true);
  assert.deepEqual(result.body.message.citations, []);
  assert.equal(result.body.message.content.includes('invented medicine'), false);
  assert.equal(app.calls(), 1);
});

test('unsupported clinical and dosing questions abstain without a paid provider request', async t => {
  const app = await fixture(t, { env: { OPENAI_API_KEY: 'mock-key' } });
  const conversation = await app.conversation();
  for (const content of ['What insulin dose?', 'What insulin dose for asthma?']) {
    const result = await app.request('/api/chat', 'POST', { conversationId: conversation.id, content });
    assert.equal(result.body.message.unsupported, true);
  }
  assert.equal(app.calls(), 0);
});

test('sourced draft cards use canonical answers, carry dates and remain unsaved until chosen', async t => {
  const app = await fixture(t);
  const conversation = await app.conversation();
  const before = (await app.request('/api/state')).body.cards.length;
  const chat = await app.request('/api/chat', 'POST', { conversationId: conversation.id, content: 'Study asthma' });
  assert.equal(chat.body.message.grounded, true);
  const drafts = await app.request('/api/chat/cards', 'POST', { conversationId: conversation.id });
  assert.equal(drafts.body.cards.length, 2);
  assert.ok(drafts.body.cards.every(card => card.verified === false && card.sourceVerified === true && card.humanReview === false));
  assert.equal(drafts.body.cards[0].sourceCheckedAt, '2026-10-09');
  assert.equal(drafts.body.cards[0].sourceExpiresAt, '2026-11-09');
  assert.equal(drafts.body.cards[0].expiresAt, undefined);
  assert.equal((await app.request('/api/state')).body.cards.length, before);
  assert.equal(app.calls(), 0);
});

test('commercial injected coaching keeps its approved gate and cannot opt into unreviewed curriculum', async t => {
  const app = await fixture(t, { authenticateRequest: () => true, generateReply: async () => ({ content: 'Commercial approved-gate response.' }) });
  assert.equal((await app.request('/api/curriculum')).status, 403);
  const conversation = (await app.request('/api/conversations', 'POST', { mode: 'coach' })).body;
  const result = await app.request('/api/chat', 'POST', { conversationId: conversation.id, content: 'Clinical question.' });
  assert.equal(result.body.message.content, 'Commercial approved-gate response.');
  assert.equal((await app.request('/api/conversations', 'POST', { mode: 'coach', conditionId: 'asthma' })).status, 400);
});

test('linked chat switches to a newly named condition and request replay cannot change context', async t => {
  const app = await fixture(t, { records: [studyCondition(), studyCondition({ id: 'diabetes', name: 'Diabetes', aliases: ['T2DM'] })] });
  const conversation = await app.conversation('asthma');
  const result = await app.request('/api/chat', 'POST', { conversationId: conversation.id, content: 'Study diabetes', requestId: 'switch-condition' });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.message.conditionIds, ['diabetes']);
  assert.match(result.body.message.content, /Diabetes/);
  const conflicting = await app.request('/api/chat', 'POST', { conversationId: conversation.id, content: 'Study diabetes', requestId: 'switch-condition', conditionIds: ['diabetes'] });
  assert.equal(conflicting.status, 409);
  const backup = (await app.request('/api/export')).body;
  assert.equal((await app.request('/api/import', 'POST', backup)).status, 200);
  assert.equal((await app.request('/api/chat', 'POST', { conversationId: conversation.id, content: 'Study diabetes', requestId: 'switch-condition' })).body.message.id, result.body.message.id);
});

test('saving a previously edited canonical card cannot silently overwrite its review history', async t => {
  const app = await fixture(t);
  const card = (await app.request('/api/curriculum/asthma/card', 'POST', { questionId: 'asthma-q1' })).body.card;
  await app.request(`/api/cards/${card.id}`, 'PUT', { front: 'Edited learner question.' });
  assert.equal((await app.request('/api/curriculum/asthma/card', 'POST', { questionId: 'asthma-q1' })).status, 409);
  assert.equal((await app.request('/api/state')).body.cards.find(item => item.id === card.id).front, 'Edited learner question.');
});

test('public status exposes only non-sensitive curriculum counts without requiring sign-in', async t => {
  const current = studyCondition();
  const expired = studyCondition({ id: 'expired-mock-condition', name: 'Expired mock condition', aliases: [], review: { kind: 'automated-source-check', humanReviewed: false, checkedAt: '2026-08-01', expiresAt: '2026-09-01' } });
  expired.sources[0].kind = 'clinical-guideline';
  const app = await fixture(t, { records: [current, expired], env: { STUDY_ACCESS_TOKEN: 'private-status-test-access-token-24-chars', OPENAI_API_KEY: 'never-expose-private-openai-key' } });
  const status = await app.request('/api/status');
  assert.equal(status.status, 200);
  assert.equal(status.body.authenticated, false);
  assert.deepEqual(status.body.curriculum, { conditions: 2, questions: 4, currentConditions: 1, formalGuidelineConditions: 1 });
  assert.equal(JSON.stringify(status.body).includes('never-expose-private-openai-key'), false);
  assert.equal(JSON.stringify(status.body).includes('Mock diagnosis fact'), false);
  assert.equal((await app.request('/api/curriculum')).status, 401);
  assert.equal(app.calls(), 0);
});
