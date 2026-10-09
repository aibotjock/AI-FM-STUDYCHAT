import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.js';
import { createStudyCurriculum } from '../server/study-curriculum.js';
import { runNaturalConversationCheck, NATURAL_CHECK_TURNS } from '../server/natural-conversation-check.js';
import { studyCondition, STUDY_NOW } from './fixtures/study-condition.js';

test('natural operator check exercises authenticated three-turn generation and review, bounded history, and current cited rendering', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'fm-natural-probe-route-'));
  const curriculum = createStudyCurriculum({ records: [studyCondition({ id: 'atrial-fibrillation', name: 'Atrial fibrillation', aliases: ['atrial fibrillation'] })], now: () => STUDY_NOW });
  const env = { STUDY_ACCESS_TOKEN: 'local-new-conversation-test-token', OPENAI_API_KEY: 'local-mock-provider-key', OPENAI_MODEL: 'gpt-4.1-mini', AI_PROVIDER: 'openai', STUDY_INITIAL_CONVERSATION_CHECK: 'natural-v1' };
  const calls = [];
  const server = createApp({ dataDir: dir, curriculum, env, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    const body = JSON.parse(options.body), index = calls.length, turn = Math.floor(index / 2), reviewing = index % 2 === 1;
    calls.push(body); assert.equal(body.store, false); assert.equal(body.max_tokens ?? body.max_completion_tokens, reviewing ? 600 : 800);
    const prefix = reviewing ? 'NATURAL_REVIEW_DATA=' : 'NATURAL_TUTOR_CONTEXT=';
    const context = JSON.parse(body.messages.find(message => message.content.includes(prefix)).content.split(prefix)[1]);
    assert.ok(context.history.some(message => message.content === NATURAL_CHECK_TURNS[turn].content));
    if (turn > 0) assert.ok(context.history.some(message => message.content === NATURAL_CHECK_TURNS[0].content));
    let parsed;
    if (!reviewing) {
      assert.equal(body.messages.at(-1).content, NATURAL_CHECK_TURNS[turn].content);
      const source = context.sources[0];
      parsed = { segments: [{ id: 's1', text: turn === 0 ? 'Hi Morgan. What is on your mind?' : turn === 1 ? 'You asked me to call you Morgan. How has your day been?' : `${source.text} What does that source-backed point say?`, sourceChunkIds: turn === 2 ? [source.key] : [] }] };
    } else {
      const candidate = context.candidate[0], source = context.sources.find(item => candidate.sourceChunkIds.includes(item.key));
      const claims = turn === 2 ? [{ quote: source.text, type: 'medical', sourceChunkIds: [source.key], supports: [{ chunkId: source.key, excerpt: source.text }] }] : [];
      parsed = { approved: true, segments: [{ id: candidate.id, approved: true, externalFactCount: claims.length, claims, flags: [] }] };
    }
    return Response.json({ model: 'gpt-4.1-mini-2025-04-14', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(parsed) } }], usage: { prompt_tokens: 1000 + index, completion_tokens: 70 } });
  } });
  t.after(async () => { await server.closeVoiceSessions(); await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true }); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const receipt = await runNaturalConversationCheck({ baseUrl: `http://127.0.0.1:${server.address().port}/`, env, curriculum, flushTelemetry: () => server.flushIngeniumTelemetry() });
  assert.equal(receipt.naturalConversationPassed, true, JSON.stringify(receipt)); assert.equal(receipt.submitted, 3); assert.equal(calls.length, 6);
  assert.equal(receipt.turns[0].generation.inputTokens, 1000); assert.equal(receipt.turns[0].review.inputTokens, 1001); assert.equal(receipt.turns[2].review.inputTokens, 1005);
  // Reuse the persisted pass and inspect projected learner history without another paid completion.
  const cached = await runNaturalConversationCheck({ baseUrl: `http://127.0.0.1:${server.address().port}/`, env, curriculum });
  assert.equal(cached.naturalConversationPassed, true); assert.equal(cached.submitted, 0); assert.equal(calls.length, 6);
});
