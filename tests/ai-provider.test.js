import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createAiProvider, AiProviderError } from '../server/ai-provider.js';
import { createApp } from '../server/index.js';
import { createStudyCurriculum } from '../server/study-curriculum.js';
import { studyCondition, STUDY_NOW } from './fixtures/study-condition.js';
import { sourceSpanSupport } from './fixtures/natural-review-v2.js';

const key = 'server-only-claude-test-key';
const env = { AI_PROVIDER: 'anthropic', CLAUDE_API_KEY: key };
const messages = [{ role: 'system', content: 'Coach through active recall.' }, { role: 'user', content: 'Help me practice recall.' }];
const result = (overrides = {}) => ({ content: [{ type: 'thinking', thinking: 'private thought content', signature: 'private-signature' }, { type: 'text', text: 'Which idea would you recall first?' }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 20 }, ...overrides });

test('Claude Haiku 5.5 uses its official request shape and returns text without thinking', async () => {
  let calls = 0;
  const provider = createAiProvider({ env, commercial: true, fetchImpl: async (url, request) => {
    calls++;
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    assert.equal(request.headers['x-api-key'], key);
    assert.equal(request.headers['anthropic-version'], '2023-06-01');
    assert.equal(request.redirect, 'error');
    const body = JSON.parse(request.body);
    assert.equal(body.model, 'claude-haiku-5-5');
    assert.equal(body.max_tokens, 600);
    assert.equal(typeof body.system, 'string');
    assert.match(body.system, /valid JSON object/);
    assert.deepEqual(body.thinking, { type: 'adaptive' });
    assert.deepEqual(body.output_config, { effort: 'low' });
    for (const field of ['temperature', 'top_p', 'top_k', 'response_format']) assert.equal(Object.hasOwn(body, field), false);
    assert.equal(body.messages[0].role, 'user');
    assert.equal(body.messages.at(-1).role, 'user');
    return Response.json(result());
  } });
  assert.equal(provider.label, 'Claude');
  assert.equal(provider.providerId, 'anthropic');
  assert.deepEqual(provider.rates, { inputUsdPerMillion: .10, outputUsdPerMillion: .50 });
  const completed = await provider.complete([messages[0], { role: 'assistant', content: 'Orphaned old answer.' }, messages[1]], { jsonMode: true, maxOutputTokens: 600 });
  assert.equal(completed.content, 'Which idea would you recall first?');
  assert.deepEqual(completed.usage, { prompt_tokens: 100, completion_tokens: 20 });
  assert.doesNotMatch(JSON.stringify(completed), /private thought|signature|test-key/);
  assert.equal(calls, 1);
});

test('Claude refusals, incomplete outputs, unsafe format, and HTTP failures are sanitized without retries', async () => {
  for (const [payload, status] of [[result({ stop_reason: 'refusal' }), 422], [result({ stop_reason: 'max_tokens' }), 502], [result({ stop_reason: 'model_context_window_exceeded' }), 400], [result({ content: [{ type: 'thinking', thinking: 'secret' }] }), 502]]) {
    let calls = 0;
    const provider = createAiProvider({ env, fetchImpl: async () => { calls++; return Response.json(payload); } });
    await assert.rejects(provider.complete(messages), error => error instanceof AiProviderError && error.status === status && !error.message.includes('secret'));
    assert.equal(calls, 1);
  }
  for (const status of [401, 429, 529, 500]) {
    let calls = 0;
    const provider = createAiProvider({ env, fetchImpl: async () => { calls++; return new Response(`${key} private provider body`, { status }); } });
    await assert.rejects(provider.complete(messages), error => error instanceof AiProviderError && !JSON.stringify({ message: error.message, stack: error.stack }).includes(key));
    assert.equal(calls, 1);
  }
});

test('provider selection never falls back and rejects incompatible Claude requests before spending', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return Response.json(result()); };
  const missing = createAiProvider({ env: { AI_PROVIDER: 'anthropic', OPENAI_API_KEY: 'other-provider-key' }, fetchImpl });
  assert.equal(missing.configured, false);
  await assert.rejects(missing.complete(messages), { status: 503 });
  const provider = createAiProvider({ env, fetchImpl });
  await assert.rejects(provider.complete([...messages, { role: 'assistant', content: 'Forbidden assistant prefill.' }]), { status: 400 });
  await assert.rejects(provider.complete([{ role: 'user', content: 'x'.repeat(100000) }]), { status: 400 });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(provider.complete(messages, { signal: controller.signal }), { status: 504 });
  assert.equal(calls, 0);
  assert.throws(() => createAiProvider({ env: { AI_PROVIDER: 'unknown' } }), /AI_PROVIDER/);
  assert.throws(() => createAiProvider({ env: { ...env, CLAUDE_MODEL: 'custom-model' }, commercial: true }), /explicit verified/);
  assert.equal(createAiProvider({ env: { ...env, CLAUDE_MODEL: 'custom-model', AI_INPUT_USD_PER_MILLION: '1', AI_OUTPUT_USD_PER_MILLION: '5' }, commercial: true }).rates.outputUsdPerMillion, 5);
});

test('OpenAI remains available through the same adapter without request storage', async () => {
  const provider = createAiProvider({ env: { OPENAI_API_KEY: 'openai-server-key' }, fetchImpl: async (url, request) => {
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(request.headers.Authorization, 'Bearer openai-server-key');
    const body = JSON.parse(request.body);
    assert.equal(body.model, 'gpt-4.1-mini');
    assert.equal(body.store, false);
    assert.deepEqual(body.response_format, { type: 'json_object' });
    return Response.json({ choices: [{ message: { content: '{"cards":[]}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 5 } });
  } });
  assert.deepEqual(await provider.complete(messages, { jsonMode: true }), { content: '{"cards":[]}', usage: { prompt_tokens: 20, completion_tokens: 5 } });
});

test('personal inactive Claude adapter preserves reviewed natural replies through the mocked browser API', async t => {
  const dataDir = mkdtempSync(join(tmpdir(), 'personal-claude-test-'));
  let calls = 0;
  const curriculum = createStudyCurriculum({ records: [studyCondition()], now: () => STUDY_NOW });
  const foundations = createStudyCurriculum({ records: [], now: () => STUDY_NOW });
  const server = createApp({ dataDir, env, curriculum, foundations, fetchImpl: async (_url, request) => {
    calls++; const body = JSON.parse(request.body);
    const factualText = 'Mock management fact: review inhaler technique.';
    assert.match(body.system, /NATURAL_(?:TUTOR_CONTEXT|REVIEW_DATA)=/);
    const primary = body.system.includes('NATURAL_TUTOR_CONTEXT=');
    const payload = primary ? { segments: [{ id: 's1', text: factualText, sourceChunkIds: ['asthma:management'] }] }
      : { version: 2, approved: true, segments: [{ id: 's1', approved: true, externalFactCount: 1, claims: [{ quote: factualText, type: 'medical', sourceChunkIds: ['asthma:management'], supports: [sourceSpanSupport(body, 'asthma:management')] }], flags: [] }] };
    return Response.json(result({ content: [{ type: 'thinking', thinking: 'private thinking' }, { type: 'text', text: JSON.stringify(payload) }] }));
  } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); rmSync(dataDir, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${server.address().port}`;
  async function api(path, body) { const response = await fetch(url + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); assert.equal(response.ok, true); return response.json(); }
  const status = await api('/api/status');
  assert.equal(status.provider, 'Claude'); assert.equal(status.model, 'claude-haiku-5-5');
  assert.equal(JSON.stringify(status).includes(key), false);
  const conversation = await api('/api/conversations', { mode: 'coach' });
  const reply = await api('/api/chat', { conversationId: conversation.id, content: 'Explain asthma management for board study.', requestId: 'claude-chat' });
  assert.equal(reply.offline, false); assert.equal(reply.conversation.messages.length, 2);
  assert.match(reply.message.content, /Mock management fact: review inhaler technique/);
  assert.equal(reply.message.reviewedDialogue, true);
  assert.equal(reply.message.sourceVerified, false);
  assert.equal(reply.message.canonicalSpokenText, false);
  assert.equal(reply.message.groundingReview.status, 'passed');
  assert.equal(reply.message.aiTotal.calls, 2);
  assert.equal(reply.message.ai.provider, 'anthropic');
  const drafts = await api('/api/chat/cards', { conversationId: conversation.id });
  assert.equal(drafts.cards[0].verified, false);
  assert.equal(drafts.cards[0].sourceTitle, 'Mock official asthma teaching reference');
  assert.equal(drafts.cards[0].sourceVerified, true);
  assert.equal(drafts.cards[0].humanReview, false);
  assert.equal(drafts.sourceLinked, true);
  assert.equal(JSON.stringify(await api('/api/state')).includes('private thinking'), false);
  assert.equal(calls, 2, 'Only mocked author and reviewer calls run; canonical card drafts make no further provider request.');
});
