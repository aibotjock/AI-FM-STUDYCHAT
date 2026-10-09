import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudyCurriculum } from '../server/study-curriculum.js';
import { renderStudyDialogue } from '../server/study-conversation.js';
import { runConversationCheck, CONVERSATION_CHECK_TITLE, CONVERSATION_CHECK_TURNS, LEGACY_CONVERSATION_FOLLOWUP, SCHEMA_CONVERSATION_FOLLOWUP } from '../server/conversation-check.js';
import { studyCondition, STUDY_NOW } from './fixtures/study-condition.js';

const BASE = 'http://127.0.0.1:3000/';
const ENV = { STUDY_INITIAL_CONVERSATION_CHECK: 'dialogue-v3', AI_PROVIDER: 'openai', APP_MODE: 'personal', STUDY_ACCESS_TOKEN: 'mock-secret-owner-code', OPENAI_API_KEY: 'mock-secret-openai-key' };
const SETTINGS = { dailyMinutes: 18, coachStyle: 'socratic', focus: 'exam' };
const STATUS = { aiConfigured: true, providerId: 'openai', model: 'gpt-4.1-mini' };
function harness({ state = { settings: SETTINGS, conversations: [] }, status = STATUS, failChat, alterReply, selectQuestion = false } = {}) {
  const curriculum = createStudyCurriculum({ records: [studyCondition({ id: 'atrial-fibrillation', name: 'Atrial fibrillation', aliases: ['atrial fibrillation'], domain: 'chronic' })], now: () => STUDY_NOW });
  const requests = [];
  let flushes = 0;
  const fetchImpl = async (url, options) => {
    assert.equal(url.origin, new URL(BASE).origin);
    assert.equal(options.redirect, 'error');
    const body = options.body === undefined ? undefined : JSON.parse(options.body);
    requests.push({ path: url.pathname, body });
    if (url.pathname === '/api/status') return Response.json(status);
    if (url.pathname === '/api/login') {
      assert.deepEqual(body, { token: ENV.STUDY_ACCESS_TOKEN });
      return Response.json({}, { headers: { 'Set-Cookie': 'studychat_session=mock-cookie; HttpOnly' } });
    }
    assert.equal(options.headers.Cookie, 'studychat_session=mock-cookie');
    if (url.pathname === '/api/operator/state') return Response.json(state);
    if (url.pathname === '/api/operator/conversations') {
      assert.deepEqual(body, { title: CONVERSATION_CHECK_TITLE, mode: 'coach' });
      const conversation = { id: 'synthetic-conversation', title: CONVERSATION_CHECK_TITLE, mode: 'coach', messages: [] };
      state.conversations.push(conversation);
      return Response.json(conversation, { status: 201 });
    }
    if (url.pathname === '/api/chat') {
      const index = CONVERSATION_CHECK_TURNS.findIndex(turn => turn.requestId === body.requestId);
      assert.ok(index >= 0);
      assert.deepEqual(body, { conversationId: 'synthetic-conversation', ...CONVERSATION_CHECK_TURNS[index] });
      const conversation = state.conversations[0];
      const user = { id: `user-${index}`, role: 'user', content: body.content, requestId: body.requestId };
      conversation.messages.push(user);
      if (failChat) return failChat(index);
      const evidence = index ? curriculum.retrieve(body.content, { conditionIds: ['atrial-fibrillation'] }) : [];
      const parsed = { chunkIds: index ? [evidence[0].key] : [], questionId: index && selectQuestion ? `atrial-fibrillation:${curriculum.get('atrial-fibrillation').questions[0].id}` : null, unsupported: false,
        dialogue: { intent: index ? 'explain' : 'planning', acknowledgment: 'time', followup: index ? 'attempt-recall' : 'choose-topic', focusChunkId: index ? evidence[0].key : null, learnerQuote: null, minutes: index ? null : 15 } };
      const rendered = renderStudyDialogue(parsed, { references: curriculum, evidence, conversation, settings: SETTINGS, medicalRequested: index === 1 });
      const message = { id: `reply-${index}`, role: 'assistant', responseTo: user.id, ...rendered, sourceVerified: true, ...(index ? {} : { canonicalStudyProcess: true }),
        ai: { provider: 'openai', requestedModel: 'gpt-4.1-mini', returnedModel: 'gpt-4.1-mini-2025-04-14', usage: { prompt_tokens: 100, completion_tokens: 60 }, estimatedCostUsd: .000136, extraSecret: ENV.OPENAI_API_KEY } };
      alterReply?.(message, index);
      conversation.messages.push(message);
      return Response.json({ message, conversation });
    }
    assert.equal(url.pathname, '/api/logout');
    return Response.json({});
  };
  return { curriculum, state, requests, fetchImpl, flushTelemetry: async () => { flushes++; }, flushes: () => flushes };
}
const invoke = mock => runConversationCheck({ baseUrl: BASE, env: ENV, fetchImpl: mock.fetchImpl, curriculum: mock.curriculum, flushTelemetry: mock.flushTelemetry });

test('operator dialogue feature check is opt-in, OpenAI/personal only, and cannot send credentials to another listener', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error('Unexpected request'); };
  for (const env of [{}, { ...ENV, APP_MODE: 'commercial' }, { ...ENV, AI_PROVIDER: 'anthropic' }, { ...ENV, OPENAI_API_KEY: '' }, { ...ENV, STUDY_ACCESS_TOKEN: '' }]) assert.equal((await runConversationCheck({ baseUrl: BASE, env, fetchImpl })).skipped, true);
  for (const baseUrl of ['https://127.0.0.1:3000/', 'http://localhost/', 'http://example.com/', `${BASE}?x=1`, `${BASE}path`, 'http://user:password@127.0.0.1/']) await assert.rejects(runConversationCheck({ baseUrl, env: ENV, fetchImpl }), /local app listener/);
  assert.equal(calls, 0);
});

test('a different or inactive model prevents sign-in and all conversational inference', async () => {
  for (const status of [{ ...STATUS, model: 'Astra' }, { ...STATUS, model: 'gpt-4.1-nano' }, { ...STATUS, aiConfigured: false }]) {
    const mock = harness({ status });
    assert.equal((await invoke(mock)).skipped, true);
    assert.deepEqual(mock.requests.map(item => item.path), ['/api/status']);
  }
});

test('two new study turns validate planning plus cited followup and log only bounded usage metadata', async () => {
  const mock = harness();
  const receipt = await invoke(mock);
  assert.equal(receipt.conversationPassed, true);
  assert.equal(receipt.submitted, 2);
  assert.equal(receipt.planPassed, true);
  assert.equal(receipt.citedFollowupPassed, true);
  assert.deepEqual(receipt.turns.map(turn => turn.cached), [false, false]);
  assert.equal(mock.flushes(), 1);
  assert.equal(receipt.logoutAttempted, true);
  assert.equal(mock.requests.filter(item => item.path === '/api/chat').length, 2);
  for (const value of [ENV.STUDY_ACCESS_TOKEN, ENV.OPENAI_API_KEY, 'mock-cookie', ...CONVERSATION_CHECK_TURNS.map(turn => turn.content), mock.state.conversations[0].messages[1].content]) assert.equal(JSON.stringify(receipt).includes(value), false);
});

test('saved completed dialogue feature checks never call the paid chat route again', async () => {
  const mock = harness();
  assert.equal((await invoke(mock)).conversationPassed, true);
  const before = mock.requests.filter(item => item.path === '/api/chat').length;
  const receipt = await invoke(mock);
  assert.equal(receipt.conversationPassed, true);
  assert.equal(receipt.submitted, 0);
  assert.deepEqual(receipt.turns.map(turn => turn.cached), [true, true]);
  assert.equal(mock.requests.filter(item => item.path === '/api/chat').length, before);
});

test('an uncertain saved request with no reply blocks paid retries across restarts', async () => {
  const mock = harness({ failChat: () => Response.json({}, { status: 504 }) });
  const first = await invoke(mock);
  assert.equal(first.uncertain, true);
  assert.equal(first.submitted, 1);
  const receipt = await invoke(mock);
  assert.equal(receipt.failed, true);
  assert.equal(receipt.uncertain, true);
  assert.equal(receipt.stage, 'saved_request_without_valid_reply');
  assert.equal(mock.requests.filter(item => item.path === '/api/chat').length, 1);
});

test('altered speech text or irrelevant citations fail without a retry or proceeding past the failed turn', async () => {
  for (const [index, alter] of [[0, message => { message.spokenText += ' Invented claim'; }], [1, message => { message.citations[0].url = 'https://example.com/'; }], [1, message => { message.ai.returnedModel = 'Astra'; }]]) {
    const mock = harness({ alterReply: (message, current) => { if (current === index) alter(message); } });
    const receipt = await invoke(mock);
    assert.equal(receipt.failed, true);
    assert.equal(receipt.stage, 'dialogue_validation');
    assert.equal(mock.requests.filter(item => item.path === '/api/chat').length, index + 1);
    assert.equal(receipt.logoutAttempted, true);
  }
});

test('conflicting durable identities cannot create a fresh paid conversation', async () => {
  const state = { settings: SETTINGS, conversations: [{ id: 'wrong-place', title: 'Unrelated session', mode: 'coach', messages: [{ id: 'user-old', role: 'user', ...CONVERSATION_CHECK_TURNS[0] }] }] };
  const mock = harness({ state });
  const receipt = await invoke(mock);
  assert.equal(receipt.stage, 'saved_request_conflict');
  assert.equal(receipt.uncertain, true);
  assert.equal(mock.requests.some(item => item.path === '/api/chat' || item.path === '/api/operator/conversations'), false);
});

test('failed saved-reply diagnostics contain only allowlisted metadata and never unverified model or learner wording', async () => {
  const unsafe = 'private-unverified-learner-text';
  const mock = harness({ alterReply: (message, index) => {
    if (index === 0) {
      message.studyDialogue.intent = unsafe;
      message.studyDialogue.followup = unsafe;
      message.studySelection = { chunkIds: [unsafe] };
      message.spokenText = unsafe;
    }
  } });
  const receipt = await invoke(mock);
  assert.equal(receipt.failed, true);
  assert.equal(receipt.checks.intent, null);
  assert.equal(receipt.checks.followup, null);
  assert.deepEqual(receipt.checks.selectedChunks, []);
  assert.equal(JSON.stringify(receipt).includes(unsafe), false);
  assert.equal(mock.requests.filter(item => item.path === '/api/chat').length, 1);
});

test('v3 correction reuses the passed plan and preserves both prior failed followups without resubmitting them', async () => {
  const mock = harness();
  assert.equal((await invoke(mock)).conversationPassed, true);
  const conversation = mock.state.conversations[0];
  // Represent the original, genuinely failed v1 followup: retain it as history,
  // never replace it or submit its paid identity again.
  conversation.messages[2] = { ...conversation.messages[2], ...LEGACY_CONVERSATION_FOLLOWUP };
  conversation.messages[3] = { id: 'failed-old-reply', role: 'assistant', responseTo: conversation.messages[2].id, content: 'A safe source-gap reply.', unsupported: true };
  conversation.messages.push({ id: 'schema-old-user', role: 'user', ...SCHEMA_CONVERSATION_FOLLOWUP }, { id: 'schema-old-reply', role: 'assistant', responseTo: 'schema-old-user', content: 'A safe source-gap reply.', unsupported: true });
  const before = mock.requests.filter(item => item.path === '/api/chat').length;
  const receipt = await invoke(mock);
  assert.equal(receipt.conversationPassed, true);
  assert.equal(receipt.submitted, 1);
  assert.deepEqual(receipt.turns.map(turn => turn.cached), [true, false]);
  assert.equal(mock.requests.filter(item => item.path === '/api/chat').length, before + 1);
  assert.equal(conversation.messages[3].id, 'failed-old-reply');
  assert.equal(conversation.messages[5].id, 'schema-old-reply');
  assert.equal(mock.requests.filter(item => item.path === '/api/chat' && item.body.requestId === LEGACY_CONVERSATION_FOLLOWUP.requestId).length, 0);
  assert.equal(mock.requests.filter(item => item.path === '/api/chat' && item.body.requestId === SCHEMA_CONVERSATION_FOLLOWUP.requestId).length, 0);
});

test('dual canonical fact and quiz proof reconstructs the actual question and complete source union', async () => {
  const mock = harness({ selectQuestion: true });
  const receipt = await invoke(mock);
  assert.equal(receipt.conversationPassed, true, JSON.stringify(receipt));
  assert.equal(receipt.submitted, 2);
  assert.ok(mock.state.conversations[0].messages[3].studySelection.chunkIds.length);
  assert.ok(mock.state.conversations[0].messages[3].studyQuestion.key);
  assert.equal(mock.state.conversations[0].messages[3].studyDialogue.followup, 'none');
});

test('projected rejection receipts preserve fixed reasons and counts while stripping private and unknown fields', async () => {
  const unsafe = 'private-model-or-learner-prose';
  const mock = harness({ alterReply: (message, index) => {
    if (index === 1) {
      message.unsupported = true;
      message.studyRejection = { code: 'invalid_dialogue_plan', reasonId: 303, plan: { parseableObject: true, chunkIds: ['atrial-fibrillation:management', unsafe], chunkCount: 2, unknownChunkCount: 1, questionId: unsafe, unknownQuestion: true, unsupported: true, raw: unsafe, dialogue: { intent: 'explain', acknowledgment: 'none', followup: 'attempt-recall', learnerQuotePosition: 1, learnerQuoteText: unsafe, focusChunkId: unsafe, minutes: 15 } } };
    }
  } });
  const receipt = await invoke(mock);
  assert.equal(receipt.failed, true);
  assert.equal(receipt.checks.rejectionReasonId, 303);
  assert.equal(receipt.checks.rejectedPlan.chunkCount, 2);
  assert.equal(receipt.checks.rejectedPlan.unknownChunkCount, 1);
  assert.equal(receipt.checks.rejectedPlan.unknownQuestion, true);
  assert.equal(receipt.checks.rejectedPlan.dialogue.learnerQuotePosition, 1);
  assert.equal(JSON.stringify(receipt).includes(unsafe), false);
  assert.equal(mock.requests.filter(item => item.path === '/api/chat').length, 2);
});
