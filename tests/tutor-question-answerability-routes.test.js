import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.js';
import { createStudyCurriculum } from '../server/study-curriculum.js';
import { studyCondition, STUDY_NOW } from './fixtures/study-condition.js';

async function fixture(t, { question = 'Which antibiotic is first-line for this disease?' } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'answerability-route-'));
  const requests = [];
  const fetchImpl = async (_url, request) => {
    const body = JSON.parse(request.body); requests.push(body);
    assert.equal(body.response_format?.json_schema?.name, 'family_medicine_natural_tutor');
    const response = { segments: [{ id: 's1', text: question, sourceChunkIds: [] }] };
    return Response.json({ model: 'gpt-4.1-mini', usage: { prompt_tokens: 10, completion_tokens: 10 }, choices: [{ message: { content: JSON.stringify(response) } }] });
  };
  const curriculum = createStudyCurriculum({ records: [studyCondition()], now: STUDY_NOW });
  const server = createApp({ dataDir, curriculum, env: { OPENAI_API_KEY: 'mock-no-paid-call' }, fetchImpl });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); rmSync(dataDir, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, payload) => { const response = await fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); assert.ok([200, 201].includes(response.status)); return response.json(); };
  return { post, requests };
}

test('an unanswerable generated medical question is replaced by a cited point with no second call', async t => {
  const app = await fixture(t);
  const conversation = await app.post('/api/conversations', { mode: 'coach', conditionId: 'asthma' });
  const { message } = await app.post('/api/chat', { conversationId: conversation.id, content: 'Help me study asthma treatment.' });
  assert.equal(message.curriculum, true);
  assert.ok(message.citations.length);
  assert.doesNotMatch(message.content, /Which antibiotic|\?/);
  assert.equal(message.studyQuestion, undefined);
  assert.equal(app.requests.length, 1);
});

test('the deterministic question gate cannot release an obvious unsupported assessment without evidence', async t => {
  const app = await fixture(t);
  const conversation = await app.post('/api/conversations', { mode: 'coach' });
  const { message } = await app.post('/api/chat', { conversationId: conversation.id, content: 'Study an unknown fictional disease.' });
  assert.equal(message.unsupported, true);
  assert.equal(message.studyRejection.reasonId, 308);
  assert.deepEqual(message.citations, []);
  assert.doesNotMatch(message.content, /Which antibiotic/);
  assert.equal(app.requests.length, 1);
});

test('an explicit study quiz uses a current canonical key and can be graded without a provider call', async t => {
  const app = await fixture(t);
  const conversation = await app.post('/api/conversations', { mode: 'coach', conditionId: 'asthma' });
  const asked = await app.post('/api/chat', { conversationId: conversation.id, content: 'Quiz me on asthma' });
  assert.ok(asked.message.studyQuestion?.fingerprint);
  assert.doesNotMatch(asked.message.content, /canonical answer for|Rationale\n/);
  const graded = await app.post('/api/chat', { conversationId: conversation.id, content: 'B' });
  assert.equal(graded.message.studyAnswer.correct, true);
  assert.ok(graded.message.citations.length);
  assert.equal(app.requests.length, 0);
});

test('ordinary preference questions remain conversational after the stricter medical-question gate', async t => {
  const question = 'Would you like to take a break?';
  const app = await fixture(t, { question });
  const conversation = await app.post('/api/conversations', { mode: 'coach' });
  const { message } = await app.post('/api/chat', { conversationId: conversation.id, content: 'I feel tired of studying.' });
  assert.equal(message.libraryGroundedDialogue, true);
  assert.equal(message.reviewedDialogue, undefined);
  assert.match(message.content, /Would you like to take a break/);
  assert.deepEqual(message.libraryGrounding.sourceChunkIds, []);
  assert.equal(app.requests.length, 1);
});
