import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.js';
import { createStudyCurriculum } from '../server/study-curriculum.js';
import { runConversationCheck, CONVERSATION_CHECK_TURNS } from '../server/conversation-check.js';
import { studyCondition, STUDY_NOW } from './fixtures/study-condition.js';

test('operator feature check exercises actual authenticated two-turn chat, conversation history and cited rendering with two bounded mock completions', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'fm-conversation-probe-route-'));
  const curriculum = createStudyCurriculum({ records: [studyCondition({ id: 'atrial-fibrillation', name: 'Atrial fibrillation', aliases: ['atrial fibrillation'] })], now: () => STUDY_NOW });
  const env = { STUDY_ACCESS_TOKEN: 'local-new-conversation-test-token', OPENAI_API_KEY: 'local-mock-provider-key', OPENAI_MODEL: 'gpt-4.1-mini', AI_PROVIDER: 'openai', STUDY_INITIAL_CONVERSATION_CHECK: 'dialogue-v3' };
  const calls = [];
  const server = createApp({ dataDir: dir, curriculum, env, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    const body = JSON.parse(options.body);
    const index = calls.length; calls.push(body);
    assert.equal(body.store, false);
    assert.equal(body.max_tokens ?? body.max_completion_tokens, 512);
    assert.equal(body.messages.at(-1).content, CONVERSATION_CHECK_TURNS[index].content);
    if (index === 1) assert.ok(body.messages.some(message => message.content.includes(CONVERSATION_CHECK_TURNS[0].content)));
    const parsed = { chunkIds: index ? ['atrial-fibrillation:management'] : [], questionId: null, unsupported: false,
      dialogue: { intent: index ? 'explain' : 'planning', acknowledgment: 'time', followup: index ? 'attempt-recall' : 'choose-topic', focusChunkId: index ? 'atrial-fibrillation:management' : null, learnerQuote: null, minutes: index ? null : 15 } };
    return Response.json({ model: 'gpt-4.1-mini-2025-04-14', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(parsed) } }], usage: { prompt_tokens: 1000 + index, completion_tokens: 70 } });
  } });
  t.after(async () => { await server.closeVoiceSessions(); await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true }); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const receipt = await runConversationCheck({ baseUrl: `http://127.0.0.1:${server.address().port}/`, env, curriculum, flushTelemetry: () => server.flushIngeniumTelemetry() });
  assert.equal(receipt.conversationPassed, true, JSON.stringify(receipt));
  assert.equal(receipt.submitted, 2);
  assert.equal(calls.length, 2);
  assert.equal(receipt.turns[0].inputTokens, 1000);
  assert.equal(receipt.turns[1].inputTokens, 1001);
});
