import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.js';
import { createBoardPractice } from '../server/board-practice.js';
import { createStudyCurriculum, loadStudyFoundations } from '../server/study-curriculum.js';
import { studyCondition, STUDY_NOW } from './fixtures/study-condition.js';

function records(domain) {
  return Array.from({ length: 4 }, (_, index) => {
    const id = `mock-${domain}-${index}`;
    const condition = studyCondition({ id, name: `Mock ${domain} study topic ${index}`, aliases: [], domain, ...(domain === 'foundations' ? { recordType: 'foundation' } : {}) });
    condition.questions = condition.questions.map((question, number) => ({ ...question, id: `${id}-q${number}`, domain }));
    return condition;
  });
}
async function fixture(t, options = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'fm-board-routes-'));
  let currentTime = STUDY_NOW;
  let providerCalls = 0;
  let id = 0;
  const curriculum = createStudyCurriculum({ records: ['acute', 'chronic', 'emergent', 'preventive'].flatMap(records), now: () => currentTime });
  const foundations = createStudyCurriculum({ records: records('foundations'), now: () => currentTime });
  const boardPractice = createBoardPractice({ curricula: [curriculum, foundations], now: () => currentTime, random: () => 0.5, createId: () => `board-session-${++id}` });
  let server;
  let base;
  let cookie;
  async function start() {
    server = createApp({ dataDir, curriculum, foundations, boardPractice, env: options.env || {}, fetchImpl: async () => { providerCalls++; throw new Error('No provider request should occur in original board practice.'); }, ...(options.authenticateRequest ? { authenticateRequest: options.authenticateRequest } : {}), ...(options.generateReply ? { generateReply: options.generateReply } : {}) });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() { if (server?.listening) { await server.closeVoiceSessions(); await new Promise(resolve => server.close(resolve)); } }
  await start();
  t.after(async () => { await stop(); rmSync(dataDir, { recursive: true, force: true }); });
  async function request(path, method = 'GET', body, extraHeaders = {}) {
    const response = await fetch(base + path, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), Origin: base, ...extraHeaders }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json(), response };
  }
  return { request, calls: () => providerCalls, advance: value => { currentTime = value; }, async restartServer() { await stop(); await start(); }, async login(token) { const result = await request('/api/login', 'POST', { token }); cookie = result.response.headers.get('set-cookie')?.split(';')[0]; return result; } };
}

test('board routes require authentication and same-origin writes while public status exposes counts only', async t => {
  const token = 'board-api-mock-token-at-least-24-characters';
  const app = await fixture(t, { env: { STUDY_ACCESS_TOKEN: token, OPENAI_API_KEY: 'mock-provider-key-must-stay-private' } });
  const status = await app.request('/api/status');
  assert.deepEqual(status.body.boardPractice, { questions: 40, availableMixedSizes: [10, 20] });
  assert.equal(JSON.stringify(status.body).includes('Fictional study vignette'), false);
  assert.equal(JSON.stringify(status.body).includes('mock-provider-key-must-stay-private'), false);
  assert.equal((await app.request('/api/board-practice')).status, 401);
  assert.equal((await app.login(token)).status, 200);
  assert.equal((await app.request('/api/board-practice/start', 'POST', { count: 20 }, { Origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await app.request('/api/board-practice/start', 'POST', { count: 40 })).body.code, 'INSUFFICIENT_COVERAGE');
  assert.equal(app.calls(), 0);
});

test('end-feedback sessions hide canonical answers in API/state/backups and reveal bounded feedback only on finish', async t => {
  const app = await fixture(t);
  const started = await app.request('/api/board-practice/start', 'POST', { count: 20, mode: 'mixed', feedback: 'end' });
  assert.equal(started.status, 200);
  const session = started.body;
  assert.equal(session.status, 'active');
  assert.equal(session.officialScore, false);
  const selected = await app.request(`/api/board-practice/${session.sessionId}/answer`, 'POST', { questionKey: session.question.key, choiceId: 'B' });
  assert.equal(selected.body.selectedChoiceId, 'B');
  assert.equal(selected.body.feedback, undefined);
  for (const path of ['/api/state', '/api/export', `/api/board-practice/${session.sessionId}?index=0`]) {
    const result = await app.request(path);
    assert.equal(JSON.stringify(result.body).includes('correctChoiceId'), false, path);
    assert.equal(JSON.stringify(result.body).includes('explicitly supports'), false, path);
  }
  const finished = await app.request(`/api/board-practice/${session.sessionId}/finish`, 'POST', {});
  assert.equal(finished.body.correct, 1);
  assert.equal(finished.body.answered, 1);
  assert.equal(finished.body.skipped, 19);
  assert.equal(finished.body.questions[0].feedback.correctChoiceId, 'B');
  assert.equal(finished.body.questions[0].feedback.humanReview, false);
  assert.equal(finished.body.questions[0].feedback.citations[0].url, 'https://www.nhlbi.nih.gov/health/asthma');
  assert.equal(finished.body.officialScore, false);
  assert.match(finished.body.scoreMeaning, /not an ABFM score/);
  assert.equal((await app.request('/api/board-practice')).body.active, null);
  const history = (await app.request('/api/board-practice/export')).body;
  assert.equal(history.history[0].correct, 1);
  assert.equal(JSON.stringify(history).includes('correctChoiceId'), false);
  assert.equal(app.calls(), 0);
});

test('practice navigation, answer conflicts, finish replay and durable restart retain one recorded choice', async t => {
  const app = await fixture(t);
  const first = (await app.request('/api/board-practice/start', 'POST', { count: 10 })).body;
  const answerPath = `/api/board-practice/${first.sessionId}/answer`;
  const answer = { questionKey: first.question.key, choiceId: 'A' };
  assert.equal((await app.request(answerPath, 'POST', answer)).body.feedback.correct, false);
  assert.equal((await app.request(answerPath, 'POST', answer)).body.answeredCount, 1);
  assert.equal((await app.request(answerPath, 'POST', { ...answer, choiceId: 'B' })).status, 409);
  assert.equal((await app.request(`/api/board-practice/${first.sessionId}?index=1`)).body.position, 1);
  assert.equal((await app.request(`/api/board-practice/${first.sessionId}?index=-1`)).status, 400);
  assert.equal((await app.request(`/api/board-practice/${first.sessionId}?index=10`)).status, 400);
  assert.equal((await app.request('/api/board-practice/start', 'POST', { count: 10 })).body.code, 'SESSION_ACTIVE');
  await app.restartServer();
  assert.equal((await app.request('/api/board-practice')).body.active.sessionId, first.sessionId);
  const finished = (await app.request(`/api/board-practice/${first.sessionId}/finish`, 'POST', {})).body;
  assert.equal(finished.answered, 1);
  assert.deepEqual((await app.request(`/api/board-practice/${first.sessionId}/finish`, 'POST', {})).body, finished);
  assert.equal((await app.request('/api/board-practice')).body.history.length, 1);
  assert.equal(app.calls(), 0);
});

test('source expiry preserves access to catalog and restart while refusing stale practice feedback', async t => {
  const app = await fixture(t);
  const first = (await app.request('/api/board-practice/start', 'POST', { count: 10 })).body;
  app.advance(Date.parse('2026-11-10T00:00:00Z'));
  const base = await app.request('/api/board-practice');
  assert.equal(base.status, 200);
  assert.equal(base.body.active, null);
  assert.equal(base.body.activeError.code, 'CONTENT_CHANGED');
  assert.equal(base.body.activeError.sessionId, first.sessionId);
  assert.equal(base.body.catalog.questionCount, 0);
  const answer = await app.request(`/api/board-practice/${first.sessionId}/answer`, 'POST', { questionKey: first.question.key, choiceId: 'B' });
  assert.equal(answer.status, 409);
  assert.equal(answer.body.code, 'CONTENT_CHANGED');
  assert.equal(JSON.stringify(answer.body).includes('correctChoiceId'), false);
  const restart = await app.request('/api/board-practice/restart', 'POST', { count: 10 });
  assert.equal(restart.body.code, 'INSUFFICIENT_COVERAGE');
  assert.equal(app.calls(), 0);
});

test('history and workspace imports are atomic, discard active identities and label restored scores untrusted', async t => {
  const app = await fixture(t);
  const first = (await app.request('/api/board-practice/start', 'POST', { count: 10 })).body;
  await app.request(`/api/board-practice/${first.sessionId}/answer`, 'POST', { questionKey: first.question.key, choiceId: 'B' });
  await app.request(`/api/board-practice/${first.sessionId}/finish`, 'POST', {});
  await app.request('/api/board-practice/start', 'POST', { count: 10 });
  const backup = (await app.request('/api/export')).body;
  const invalid = structuredClone(backup);
  invalid.boardPractice.history[0].summary.correct = 1000;
  assert.equal((await app.request('/api/import', 'POST', invalid)).status, 400);
  assert.equal((await app.request('/api/board-practice')).body.active.sessionId, backup.boardPractice.active.id);
  assert.equal((await app.request('/api/import', 'POST', backup)).status, 200);
  const restored = (await app.request('/api/state')).body.boardPractice;
  assert.equal(restored.active, null);
  assert.equal(restored.history[0].trusted, false);
  assert.equal(restored.history[0].selection, undefined);
  assert.equal(restored.history[0].answers, undefined);
  const history = (await app.request('/api/board-practice')).body.history;
  assert.equal(history[0].imported, true);
  assert.equal(history[0].officialScore, false);
  assert.equal((await app.request(`/api/board-practice/${history[0].sessionId}`)).status, 404);
  const exported = (await app.request('/api/board-practice/export')).body;
  exported.history[0].sessionId = 'imported-other-summary';
  exported.history[0].accuracy = 100000;
  assert.equal((await app.request('/api/board-practice/import', 'POST', exported)).body.imported, 1);
  const imported = (await app.request('/api/board-practice')).body.history.find(item => item.sessionId === 'imported-other-summary');
  assert.equal(imported.accuracy, 100);
  assert.equal(imported.trusted, false);
  assert.equal(app.calls(), 0);
});

test('foundation questions have hidden detail keys and canonical review cards with dated source provenance', async t => {
  const app = await fixture(t);
  const id = 'mock-foundations-0';
  const detail = await app.request(`/api/curriculum/${id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.condition.domain, 'foundations');
  assert.equal(JSON.stringify(detail.body).includes('correctChoiceId'), false);
  const card = await app.request(`/api/curriculum/${id}/card`, 'POST', { questionId: `${id}-q0` });
  assert.equal(card.status, 201);
  assert.equal(card.body.card.sourceVerified, true);
  assert.equal(card.body.card.humanReview, false);
  assert.equal(card.body.card.verified, false);
  assert.equal(card.body.card.sourceExpiresAt, '2026-11-09');
  assert.equal((await app.request(`/api/curriculum/${id}/card`, 'POST', { questionId: `${id}-q0` })).body.cached, true);
  assert.equal(app.calls(), 0);
});

test('commercial injected coaching cannot opt into board practice and unknown statuses never confer eligibility', async t => {
  const app = await fixture(t, { authenticateRequest: () => true, generateReply: async () => ({ content: 'Commercial approved study gate.' }) });
  assert.equal((await app.request('/api/board-practice')).status, 403);
  assert.equal((await app.request('/api/status')).body.boardPractice, null);
  for (const target of ['record', 'review', 'source']) {
    const condition = studyCondition();
    (target === 'record' ? condition : target === 'review' ? condition.review : condition.sources[0]).status = 'arbitrarily-approved';
    const curriculum = createStudyCurriculum({ records: [condition], now: () => STUDY_NOW });
    assert.equal(curriculum.count, 0, target);
    assert.equal(curriculum.boardQuestions().length, 0, target);
  }
});

test('separate foundation loader rejects wrong envelope/topic types without inflating diagnosis inventory', t => {
  const directory = mkdtempSync(join(tmpdir(), 'fm-foundation-loader-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'foundations.json');
  const payload = { schemaVersion: 1, checkedAt: '2026-10-09', topicType: 'foundations', conditions: records('foundations') };
  writeFileSync(path, JSON.stringify(payload));
  assert.equal(loadStudyFoundations({ contentPath: path, now: () => STUDY_NOW }).count, 4);
  payload.conditions[0].domain = 'acute';
  writeFileSync(path, JSON.stringify(payload));
  assert.throws(() => loadStudyFoundations({ contentPath: path, now: () => STUDY_NOW }), /envelope/);
  assert.equal(loadStudyFoundations({ contentPath: join(directory, 'missing') }).count, 0);
});
