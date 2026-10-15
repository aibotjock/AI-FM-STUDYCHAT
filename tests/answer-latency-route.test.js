import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.js';
import { createStudyCurriculum } from '../server/study-curriculum.js';
import { studyCondition, STUDY_NOW } from './fixtures/study-condition.js';

test('GPT-4o-mini answers in one call and releases only the complete answer', { timeout: 5000 }, async t => {
  const dataDir = mkdtempSync(join(tmpdir(), 'fm-answer-latency-route-'));
  const model = 'gpt-4o-mini-2024-07-18';
  const input = 'I would like a short study break.';
  const text = 'We can take a short break. What would you prefer?';
  let calls = 0, releaseAnswer = () => {}, signalAnswerStarted;
  const answerStarted = new Promise(resolve => { signalAnswerStarted = resolve; });
  const server = createApp({ dataDir,
    curriculum: createStudyCurriculum({ records: [studyCondition()], now: () => STUDY_NOW }),
    env: { OPENAI_API_KEY: 'synthetic-not-a-real-key', OPENAI_MODEL: model },
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/chat/completions');
      const body = JSON.parse(options.body), turn = calls++;
      assert.equal(body.model, model);
      assert.deepEqual(body.response_format, { type: 'json_object' });
      const marker = 'NATURAL_TUTOR_CONTEXT=';
      const prompt = body.messages.find(message => message.content.includes(marker)).content;
      assert.match(prompt, /OUTPUT_SCHEMA=/);
      assert.doesNotMatch(prompt, /NATURAL_REVIEW_DATA=/);
      const context = JSON.parse(prompt.split(marker)[1]);
      assert.equal(body.messages.at(-1).content, input);
      assert.equal(context.history.filter(message => message.role === 'user' && message.content === input).length, turn);
      assert.ok(context.library, 'The model receives the app library inventory.');
      assert.match(JSON.stringify(context.library), /asthma/i);
      if (turn === 1) {
        const waiting = new Promise(resolve => { releaseAnswer = resolve; });
        signalAnswerStarted();
        await waiting;
      }
      return Response.json({ model, usage: { prompt_tokens: 30, completion_tokens: 20 },
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ segments: [{ id: 's1', text, sourceChunkIds: [] }] }) } }] });
    }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { releaseAnswer(); await server.closeVoiceSessions(); await new Promise(resolve => server.close(resolve)); rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, value) => fetch(base + path, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  const conversation = await (await post('/api/conversations', { mode: 'coach' })).json();
  const first = await post('/api/chat', { conversationId: conversation.id, content: input, requestId: 'first' });
  assert.equal(first.status, 200);
  assert.equal((await first.json()).message.libraryGroundedDialogue, true);
  let delivered = false;
  const second = post('/api/chat', { conversationId: conversation.id, content: input, requestId: 'second' }).then(response => { delivered = true; return response; });
  await answerStarted;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2, 'One model call per turn.');
  assert.equal(delivered, false, 'The complete answer must finish before release.');
  releaseAnswer();
  const response = await second;
  assert.equal(response.status, 200);
  const value = await response.json();
  assert.equal(value.message.libraryGroundedDialogue, true);
  assert.equal(value.message.reviewedDialogue, undefined);
  assert.equal(value.message.aiReview, undefined);
  assert.equal(value.message.spokenText, text);
  assert.equal(value.message.aiTotal.calls, 1);
  const retried = await (await post('/api/chat', { conversationId: conversation.id, content: input, requestId: 'second' })).json();
  assert.equal(retried.message.id, value.message.id);
  assert.equal(calls, 2, 'An idempotent retry must not add a model call.');
});
