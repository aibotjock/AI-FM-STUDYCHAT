import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.js';
import { createStudyCurriculum } from '../server/study-curriculum.js';
import { studyCondition, STUDY_NOW } from './fixtures/study-condition.js';

test('the active GPT-4o-mini profile keeps full schemas and current input while waiting for independent review', { timeout: 5000 }, async t => {
  const dataDir = mkdtempSync(join(tmpdir(), 'fm-answer-latency-route-'));
  const model = 'gpt-4o-mini-2024-07-18';
  const input = 'I would like a short study break.';
  const text = 'We can take a short break. What would you prefer?';
  let calls = 0, releaseReview = () => {}, signalReviewStarted;
  const reviewStarted = new Promise(resolve => { signalReviewStarted = resolve; });
  const server = createApp({ dataDir,
    curriculum: createStudyCurriculum({ records: [studyCondition()], now: () => STUDY_NOW }),
    env: { OPENAI_API_KEY: 'synthetic-not-a-real-key', OPENAI_MODEL: model },
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/chat/completions');
      const body = JSON.parse(options.body), turn = Math.floor(calls / 2), reviewing = calls++ % 2 === 1;
      assert.equal(body.model, model);
      assert.deepEqual(body.response_format, { type: 'json_object' });
      const marker = reviewing ? 'NATURAL_REVIEW_DATA=' : 'NATURAL_TUTOR_CONTEXT=';
      const prompt = body.messages.find(message => message.content.includes(marker)).content;
      assert.match(prompt, /OUTPUT_SCHEMA=/);
      const context = JSON.parse(prompt.split(marker)[1]);
      assert.equal(reviewing ? context.learnerRequest : body.messages.at(-1).content, input);
      assert.equal(context.history.filter(message => message.role === 'user' && message.content === input).length, turn);
      let reply;
      if (!reviewing) reply = { segments: [{ id: 's1', text, sourceChunkIds: [] }] };
      else {
        assert.equal(context.candidate[0].text, text);
        if (turn === 1) {
          const waiting = new Promise(resolve => { releaseReview = resolve; });
          signalReviewStarted();
          await waiting;
        }
        reply = { version: 3, approved: true, segments: [{ id: 's1', approved: true, externalFactCount: 0, claims: [], flags: [],
          questions: [{ quote: 'What would you prefer?', kind: 'conversation', recallSpanId: null }] }] };
      }
      return Response.json({ model, usage: { prompt_tokens: 30, completion_tokens: 20 },
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(reply) } }] });
    }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { releaseReview(); await server.closeVoiceSessions(); await new Promise(resolve => server.close(resolve)); rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, value) => fetch(base + path, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  const conversation = await (await post('/api/conversations', { mode: 'coach' })).json();
  const first = await post('/api/chat', { conversationId: conversation.id, content: input, requestId: 'first' });
  assert.equal(first.status, 200);
  assert.equal((await first.json()).message.reviewedDialogue, true);
  let delivered = false;
  const second = post('/api/chat', { conversationId: conversation.id, content: input, requestId: 'second' }).then(response => { delivered = true; return response; });
  await reviewStarted;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 4);
  assert.equal(delivered, false, 'A draft must not be delivered before the independent reviewer returns.');
  releaseReview();
  const response = await second;
  assert.equal(response.status, 200);
  const value = await response.json();
  assert.equal(value.message.reviewedDialogue, true);
  assert.equal(value.message.spokenText, text);
  assert.equal(value.message.aiTotal.calls, 2);
});
