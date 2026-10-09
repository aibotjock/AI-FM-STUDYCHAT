import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudyCurriculum } from '../server/study-curriculum.js';
import { renderReviewedTutor } from '../server/natural-tutor.js';
import { runNaturalConversationCheck, NATURAL_CHECK_TITLE, NATURAL_CHECK_TURNS } from '../server/natural-conversation-check.js';
import { studyCondition, STUDY_NOW } from './fixtures/study-condition.js';

const BASE = 'http://127.0.0.1:3000/';
const ENV = { STUDY_INITIAL_CONVERSATION_CHECK: 'natural-v1', AI_PROVIDER: 'openai', APP_MODE: 'personal', STUDY_ACCESS_TOKEN: 'mock-owner-secret', OPENAI_API_KEY: 'mock-openai-secret' };
const STATUS = { aiConfigured: true, providerId: 'openai', model: 'gpt-4.1-mini' };
function harness({ state = { conversations: [] }, status = STATUS, failChat, alterReply } = {}) {
  const curriculum = createStudyCurriculum({ records: [studyCondition({ id: 'atrial-fibrillation', name: 'Atrial fibrillation', aliases: ['atrial fibrillation'], domain: 'chronic' })], now: () => STUDY_NOW });
  const requests = []; let flushes = 0;
  const fetchImpl = async (url, options) => {
    assert.equal(url.origin, new URL(BASE).origin); assert.equal(options.redirect, 'error');
    const body = options.body === undefined ? undefined : JSON.parse(options.body);
    requests.push({ path: url.pathname, body });
    if (url.pathname === '/api/status') return Response.json(status);
    if (url.pathname === '/api/login') { assert.deepEqual(body, { token: ENV.STUDY_ACCESS_TOKEN }); return Response.json({}, { headers: { 'Set-Cookie': 'studychat_session=mock-cookie; HttpOnly' } }); }
    assert.equal(options.headers.Cookie, 'studychat_session=mock-cookie');
    if (url.pathname === '/api/operator/state') return Response.json(state);
    if (url.pathname === '/api/operator/conversations') {
      assert.deepEqual(body, { title: NATURAL_CHECK_TITLE, mode: 'coach' });
      const conversation = { id: 'synthetic-conversation', title: NATURAL_CHECK_TITLE, mode: 'coach', internalCheck: true, messages: [] };
      state.conversations.push(conversation); return Response.json(conversation, { status: 201 });
    }
    if (url.pathname === '/api/chat') {
      const index = NATURAL_CHECK_TURNS.findIndex(turn => turn.requestId === body.requestId); assert.ok(index >= 0);
      assert.deepEqual(body, { conversationId: 'synthetic-conversation', ...NATURAL_CHECK_TURNS[index] });
      const conversation = state.conversations[0];
      const user = { id: `user-${index}`, role: 'user', content: body.content, requestId: body.requestId }; conversation.messages.push(user);
      if (failChat) return failChat(index);
      const evidence = index === 2 ? curriculum.retrieve(body.content, { conditionIds: ['atrial-fibrillation'] }) : [];
      const reply = index === 0 ? 'Hi Morgan. We can chat. What is on your mind?' : index === 1 ? 'You asked me to call you Morgan. How has your day been?' : `${evidence[0].text}\nWhat does that study point say?`;
      const draft = { segments: [{ id: 's1', text: reply, sourceChunkIds: index === 2 ? [evidence[0].key] : [] }] };
      const claims = index === 2 ? [{ quote: evidence[0].text, type: 'medical', sourceChunkIds: [evidence[0].key], supports: [{ chunkId: evidence[0].key, excerpt: evidence[0].text }] }] : [];
      const review = { approved: true, segments: [{ id: 's1', approved: true, externalFactCount: claims.length, claims, flags: [] }] };
      const rendered = renderReviewedTutor(draft, review, { references: curriculum, evidence, conversation, now: STUDY_NOW });
      const ai = { provider: 'openai', requestedModel: 'gpt-4.1-mini', returnedModel: 'gpt-4.1-mini-2025-04-14', usage: { prompt_tokens: 100, completion_tokens: 60 }, estimatedCostUsd: .000136, extraSecret: ENV.OPENAI_API_KEY };
      const message = { id: `reply-${index}`, role: 'assistant', responseTo: user.id, ...rendered, ai: { ...ai }, aiReview: { ...ai }, aiTotal: { calls: 2 } };
      alterReply?.(message, index); conversation.messages.push(message); return Response.json({ message, conversation });
    }
    assert.equal(url.pathname, '/api/logout'); return Response.json({});
  };
  return { state, curriculum, requests, fetchImpl, flushTelemetry: async () => { flushes++; }, flushes: () => flushes };
}
const invoke = mock => runNaturalConversationCheck({ baseUrl: BASE, env: ENV, fetchImpl: mock.fetchImpl, curriculum: mock.curriculum, flushTelemetry: mock.flushTelemetry });

test('natural operator check only permits the fixed local OpenAI personal gate', async () => {
  let calls = 0; const fetchImpl = async () => { calls++; throw new Error('Unexpected request'); };
  for (const env of [{}, { ...ENV, STUDY_INITIAL_CONVERSATION_CHECK: 'dialogue-v3' }, { ...ENV, APP_MODE: 'commercial' }, { ...ENV, AI_PROVIDER: 'anthropic' }, { ...ENV, OPENAI_API_KEY: '' }, { ...ENV, STUDY_ACCESS_TOKEN: '' }]) assert.equal((await runNaturalConversationCheck({ baseUrl: BASE, env, fetchImpl })).skipped, true);
  for (const baseUrl of ['https://127.0.0.1:3000/', 'http://localhost/', 'http://example.com/', `${BASE}?x=1`, `${BASE}path`, 'http://user:password@127.0.0.1/']) await assert.rejects(runNaturalConversationCheck({ baseUrl, env: ENV, fetchImpl }), /local app listener/);
  assert.equal(calls, 0);
});
test('inactive or different active model prevents natural sign-in and inference', async () => {
  for (const status of [{ ...STATUS, model: 'blocked-model' }, { ...STATUS, model: 'gpt-4.1-nano' }, { ...STATUS, aiConfigured: false }]) {
    const mock = harness({ status }); assert.equal((await invoke(mock)).skipped, true); assert.deepEqual(mock.requests.map(item => item.path), ['/api/status']);
  }
});
test('three genuinely reviewed replies validate nickname continuity and cited study transition without logging prose', async () => {
  const mock = harness(); const receipt = await invoke(mock);
  assert.equal(receipt.naturalConversationPassed, true, JSON.stringify(receipt)); assert.equal(receipt.contextRecallPassed, true); assert.equal(receipt.citedStudyTransitionPassed, true);
  assert.equal(receipt.submitted, 3); assert.equal(receipt.providerCalls, 6); assert.deepEqual(receipt.turns.map(turn => turn.cached), [false, false, false]);
  assert.equal(mock.flushes(), 1); assert.equal(receipt.logoutAttempted, true);
  for (const secret of [ENV.STUDY_ACCESS_TOKEN, ENV.OPENAI_API_KEY, 'mock-cookie', ...NATURAL_CHECK_TURNS.map(turn => turn.content), mock.state.conversations[0].messages[1].content]) assert.equal(JSON.stringify(receipt).includes(secret), false);
});
test('durable passed natural replies are reused without paid route repeats', async () => {
  const mock = harness(); assert.equal((await invoke(mock)).naturalConversationPassed, true);
  const before = mock.requests.filter(item => item.path === '/api/chat').length; const receipt = await invoke(mock);
  assert.equal(receipt.naturalConversationPassed, true); assert.equal(receipt.submitted, 0); assert.equal(receipt.providerCalls, 0); assert.deepEqual(receipt.turns.map(turn => turn.cached), [true, true, true]);
  assert.equal(mock.requests.filter(item => item.path === '/api/chat').length, before);
});
test('uncertain natural inference stays blocked across restarts without retry', async () => {
  const mock = harness({ failChat: () => Response.json({}, { status: 504 }) });
  assert.equal((await invoke(mock)).uncertain, true); const receipt = await invoke(mock);
  assert.equal(receipt.stage, 'saved_request_without_valid_reply'); assert.equal(receipt.uncertain, true); assert.equal(mock.requests.filter(item => item.path === '/api/chat').length, 1);
});
test('altered natural text, nickname, citation, reviewer provenance or hidden unsupported claims stop without retry', async () => {
  for (const [index, alter] of [[0, m => { m.spokenText += ' Invented words'; }], [0, m => { m.groundingReview.externalClaimCount = 1; }], [1, m => { m.naturalSegments[0].text = 'You asked me to call you Alex. How is your day?'; m.content = m.naturalSegments[0].text; m.spokenText = m.content; }], [2, m => { m.citations[0].url = 'https://example.com/'; }], [2, m => { m.aiReview.returnedModel = 'blocked-model'; }]]) {
    const mock = harness({ alterReply: (message, current) => { if (current === index) alter(message); } }); const receipt = await invoke(mock);
    assert.equal(receipt.stage, 'natural_reply_validation', JSON.stringify(receipt)); assert.equal(mock.requests.filter(item => item.path === '/api/chat').length, index + 1); assert.equal(receipt.logoutAttempted, true);
  }
});
test('foreign durable identity blocks fresh natural checks and preserves learner history', async () => {
  const mock = harness({ state: { conversations: [{ id: 'learner', title: 'My session', mode: 'coach', messages: [{ id: 'user-old', role: 'user', ...NATURAL_CHECK_TURNS[0] }] }] } });
  const receipt = await invoke(mock); assert.equal(receipt.stage, 'saved_request_conflict'); assert.equal(receipt.uncertain, true);
  assert.equal(mock.requests.some(item => item.path === '/api/chat' || item.path === '/api/operator/conversations'), false);
});
