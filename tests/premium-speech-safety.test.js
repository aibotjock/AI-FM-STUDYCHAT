import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.js';
import { createStudyCurriculum } from '../server/study-curriculum.js';
import { validateNaturalDraft, renderReviewedTutor } from '../server/natural-tutor.js';
import { premiumSpeechText } from '../server/premium-speech.js';
import { studyCondition, STUDY_NOW } from './fixtures/study-condition.js';
import { sourceSpanSupport } from './fixtures/natural-review-v2.js';

const fact = 'Mock management fact: review inhaler technique.';
const draft = { segments: [{ id: 's1', text: fact, sourceChunkIds: ['asthma:management'] }] };
const review = { approved: true, segments: [{ id: 's1', approved: true, externalFactCount: 1, flags: [], claims: [{ quote: fact, type: 'medical', sourceChunkIds: ['asthma:management'], supports: [{ chunkId: 'asthma:management', excerpt: fact }] }] }] };

function sourceContext() {
  let clock = STUDY_NOW;
  const references = createStudyCurriculum({ records: [studyCondition()], now: () => clock });
  const evidence = references.retrieve('Study asthma inhaler technique');
  const conversation = { id: randomUUID(), title: 'Study conversation', mode: 'coach', messages: [{ id: randomUUID(), role: 'user', content: 'Help me study asthma.', createdAt: STUDY_NOW }] };
  return { references, evidence, conversation, settings: { coachStyle: 'socratic', dailyMinutes: 15, focus: 'exam' }, expire: () => { clock = Date.parse('2026-11-10T00:00:00Z'); } };
}

function reviewedMessage(context) {
  return { id: randomUUID(), role: 'assistant', responseTo: context.conversation.messages.at(-1).id, createdAt: STUDY_NOW, ...renderReviewedTutor(validateNaturalDraft(draft, context), review, context) };
}

function storedReviewedContext() {
  const context = sourceContext();
  context.message = reviewedMessage(context);
  context.conversation.messages.push(context.message);
  return context;
}

test('AI speech rejects imported review provenance and detached same-ID messages', () => {
  const original = storedReviewedContext();
  assert.equal(premiumSpeechText(original), fact);
  for (const mutate of [
    message => { message.importedEvidence = true; },
    message => { message.importedReview = true; },
    message => { message.aiReview = { imported: true }; },
    message => { message.ai = { imported: true }; },
    message => { message.voiceTranscript = true; },
    message => { message.role = 'user'; },
  ]) {
    const context = storedReviewedContext(); mutate(context.message);
    assert.throws(() => premiumSpeechText(context), { status: 409 });
  }
  assert.throws(() => premiumSpeechText({ ...original, message: structuredClone(original.message) }), { status: 409 });
});

test('stored source checks must match visible text, exact spoken text, reviewer excerpts and server citations', () => {
  for (const mutate of [
    message => { message.content += '\n[1] PRIVATE_UNCHECKED_FACT'; },
    message => { message.spokenText += '\nPRIVATE_UNCHECKED_FACT'; },
    message => { message.citations[0].url = 'https://private.invalid/forged'; },
    message => { message.groundingReview.segments[0].claims[0].supports[0].excerpt = 'PRIVATE_UNCHECKED_FACT'; },
    message => { message.groundingReview.externalClaimCount = 0; },
    message => { message.sourceVerified = true; },
    message => { message.canonicalSpokenText = true; },
  ]) {
    const context = storedReviewedContext(); mutate(context.message);
    assert.throws(() => premiumSpeechText(context), { status: 409 });
  }
  const context = storedReviewedContext();
  context.message.content = `${fact} [1]`;
  context.message.reviewedDialogue = false;
  context.message.sourceVerified = true;
  context.message.canonicalStudyProcess = true;
  assert.throws(() => premiumSpeechText(context), { status: 409 });
});

test('later conversation turns cannot supply the reveal permission for an earlier pending quiz reply', () => {
  const context = storedReviewedContext();
  context.message.pendingStudyQuestion = context.references.quiz(context.evidence).studyQuestion;
  context.conversation.messages.push({ id: randomUUID(), role: 'user', content: 'Please reveal the answer.', createdAt: STUDY_NOW + 1 });
  assert.throws(() => premiumSpeechText(context), { status: 409 });
});

async function fixture(t, { env = {}, authenticateRequest, isActive, speechResponse } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'premium-speech-safety-'));
  const context = sourceContext();
  const speechCalls = [];
  let speechStarted;
  const started = new Promise(resolve => { speechStarted = resolve; });
  const server = createApp({ dataDir, curriculum: context.references, foundations: createStudyCurriculum({ records: [], now: () => STUDY_NOW }), authenticateRequest, isActive, env: { HOST: '127.0.0.1', OPENAI_API_KEY: 'local-speech-safety-fixture-only', OPENAI_MODEL: 'gpt-4.1-mini', ...env }, fetchImpl: async (url, options) => {
    const input = JSON.parse(options.body);
    if (String(url).endsWith('/audio/speech')) {
      speechCalls.push({ url, input, signal: options.signal });
      speechStarted();
      return speechResponse ? await speechResponse({ url, options, input }) : new Response(new Uint8Array([73, 68, 51, 1]), { headers: { 'Content-Type': 'audio/mpeg' } });
    }
    const output = input.response_format?.json_schema?.name === 'family_medicine_natural_review_v2'
      ? { version: 2, approved: true, segments: review.segments.map(segment => ({ ...segment, claims: segment.claims.map(claim => ({ ...claim, supports: claim.sourceChunkIds.map(chunkId => sourceSpanSupport(input, chunkId)) })) })) }
      : draft;
    return Response.json({ model: 'gpt-4.1-mini', choices: [{ message: { content: JSON.stringify(output) } }], usage: { prompt_tokens: 6, completion_tokens: 4 } });
  } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); rmSync(dataDir, { recursive: true, force: true }); });
  async function request(path, body, { method = body === undefined ? 'GET' : 'POST', cookie, signal } = {}) {
    return fetch(base + path, { method, signal, headers: { Origin: base, ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  async function api(path, body, options) {
    const response = await request(path, body, options);
    return { status: response.status, body: await response.json() };
  }
  async function makeStudyMessage() {
    const created = await api('/api/conversations', { mode: 'coach', title: 'Speech safety study', curriculumConditionId: 'asthma' });
    assert.equal(created.status, 201);
    const chat = await api('/api/chat', { conversationId: created.body.id, content: 'Help me study asthma inhaler technique.', requestId: randomUUID() });
    assert.equal(chat.status, 200);
    assert.equal(chat.body.message.reviewedDialogue, true);
    return { conversationId: created.body.id, messageId: chat.body.message.id, message: chat.body.message };
  }
  return { ...context, api, request, server, base, started, speechCalls, makeStudyMessage };
}

function delayedAudio(t) {
  let release;
  const response = new Promise(resolve => { release = () => resolve(new Response(new Uint8Array([73, 68, 51, 1]), { headers: { 'Content-Type': 'audio/mpeg' } })); });
  // Providers can ignore abort; the app must still discard the late result.
  t.after(() => release());
  return { speechResponse: () => response, release };
}
const speechBody = (message, requestId = randomUUID()) => ({ conversationId: message.conversationId, messageId: message.messageId, voice: 'marin', chunkIndex: 0, requestId });

test('owner authentication, configured OpenAI and the personal workspace boundary precede speech calls', async t => {
  const locked = await fixture(t, { env: { STUDY_ACCESS_TOKEN: 'speech-owner-auth-local-fixture-secret-only' } });
  assert.equal((await locked.api('/api/voice/options')).status, 401);
  assert.equal((await locked.api('/api/voice/preview', { voice: 'marin', requestId: randomUUID() })).status, 401);
  assert.equal(locked.speechCalls.length, 0);
  const commercial = await fixture(t, { authenticateRequest: () => true });
  assert.equal((await commercial.api('/api/voice/options')).status, 403);
  assert.equal((await commercial.api('/api/voice/preview', { voice: 'marin', requestId: randomUUID() })).status, 403);
  assert.equal(commercial.speechCalls.length, 0);
  const unconfigured = await fixture(t, { env: { OPENAI_API_KEY: '' } });
  assert.equal((await unconfigured.api('/api/voice/options')).body.enabled, false);
  assert.equal((await unconfigured.api('/api/voice/preview', { voice: 'marin', requestId: randomUUID() })).status, 503);
  assert.equal(unconfigured.speechCalls.length, 0);
});

test('speech requests reject client text, captions, paid flags, arbitrary endpoints and Astra before provider calls', async t => {
  const app = await fixture(t);
  const message = await app.makeStudyMessage();
  for (const [field, value] of [['text', 'CLIENT_FACT [1]'], ['input', 'CLIENT_FACT'], ['caption', 'CLIENT_FACT'], ['model', 'Astra'], ['url', 'https://private.invalid/audio'], ['apiKey', 'PRIVATE_KEY'], ['paid', true], ['sourceVerified', true]]) {
    assert.equal((await app.api('/api/voice/preview', { voice: 'marin', requestId: randomUUID(), [field]: value })).status, 400, field);
    assert.equal((await app.api('/api/voice/speech', { ...speechBody(message), [field]: value })).status, 400, field);
  }
  for (const voice of ['Astra', 'claude', 'alloy']) assert.equal((await app.api('/api/voice/preview', { voice, requestId: randomUUID() })).status, 400, voice);
  assert.equal((await app.api('/api/voice/speech', { ...speechBody(message), chunkIndex: '0' })).status, 400);
  for (const path of ['/api/voice/session', '/api/voice/transcript', '/api/voice/stop']) assert.equal((await app.api(path, {})).status, 403);
  assert.equal(app.speechCalls.length, 0);
});

test('imported client captions and forged review metadata cannot gain AI speech through copied message IDs', async t => {
  const app = await fixture(t);
  const message = await app.makeStudyMessage();
  const backup = (await app.api('/api/export')).body;
  const imported = backup.conversations[0].messages.find(item => item.id === message.messageId);
  Object.assign(imported, { content: 'CLIENT_FACT [1]', spokenText: 'CLIENT_FACT', sourceVerified: true, canonicalSpokenText: true, reviewedDialogue: true, importedReview: false, voiceTranscript: false });
  assert.equal((await app.api('/api/import', backup)).status, 200);
  const restored = (await app.api('/api/state')).body.conversations[0].messages.find(item => item.id === message.messageId);
  assert.equal(restored.content, 'CLIENT_FACT [1]');
  assert.equal(restored.importedEvidence, true);
  assert.equal(restored.reviewedDialogue, undefined);
  assert.equal(restored.groundingReview, undefined);
  assert.equal(restored.spokenText, undefined);
  assert.equal((await app.api('/api/voice/speech', speechBody(message))).status, 409);
  assert.equal(app.speechCalls.length, 0);
});

test('source expiry after the provider call discards audio and leaves an uncertain nonreplayable receipt', async t => {
  const delayed = delayedAudio(t);
  const app = await fixture(t, delayed);
  const message = await app.makeStudyMessage();
  const body = speechBody(message);
  const pending = app.request('/api/voice/speech', body);
  await app.started;
  assert.equal(app.server.hasActiveRequests(), true);
  app.expire(); delayed.release();
  const response = await pending;
  assert.equal(response.status, 409);
  assert.match(response.headers.get('Content-Type'), /application\/json/);
  const receipt = (await app.api(`/api/voice/check/${body.requestId}`)).body;
  assert.equal(receipt.status, 'uncertain');
  assert.equal(receipt.cachedAudioAvailable, false);
  assert.equal(app.server.hasActiveRequests(), false);
  assert.equal((await app.api('/api/voice/speech', body)).status, 409);
  assert.equal(app.speechCalls.length, 1);
  assert.equal(app.speechCalls[0].url, 'https://api.openai.com/v1/audio/speech');
  assert.equal(app.speechCalls[0].input.model, 'gpt-4o-mini-tts');
  assert.equal(app.speechCalls[0].input.input, fact);
});

test('loopback logout cancels late audio even though the local workspace remains authenticated', async t => {
  const delayed = delayedAudio(t);
  const app = await fixture(t, delayed);
  const message = await app.makeStudyMessage();
  const body = speechBody(message);
  const pending = app.request('/api/voice/speech', body);
  await app.started;
  assert.equal((await app.api('/api/logout', {})).body.authenticated, true);
  assert.equal(app.speechCalls[0].signal.aborted, true);
  delayed.release();
  assert.equal((await pending).status, 409);
  const receipt = (await app.api(`/api/voice/check/${body.requestId}`)).body;
  assert.equal(receipt.status, 'uncertain');
  assert.equal(receipt.cachedAudioAvailable, false);
  assert.equal((await app.api('/api/voice/speech', body)).status, 409);
  assert.equal(app.speechCalls.length, 1);
});

test('import with reused IDs and conversation deletion both invalidate in-flight speech', async t => {
  for (const action of ['import', 'delete']) {
    const delayed = delayedAudio(t);
    const app = await fixture(t, delayed);
    const message = await app.makeStudyMessage();
    const backup = (await app.api('/api/export')).body;
    const body = speechBody(message);
    const pending = app.request('/api/voice/speech', body);
    await app.started;
    const changed = action === 'import' ? await app.api('/api/import', backup) : await app.api(`/api/conversations/${message.conversationId}`, undefined, { method: 'DELETE' });
    assert.equal(changed.status, 200, action);
    assert.equal(app.speechCalls[0].signal.aborted, true, action);
    delayed.release();
    assert.equal((await pending).status, 409, action);
    const receipt = (await app.api(`/api/voice/check/${body.requestId}`)).body;
    assert.equal(receipt.status, 'uncertain', action);
    assert.equal(receipt.cachedAudioAvailable, false, action);
    assert.equal((await app.api('/api/voice/speech', speechBody(message))).status, action === 'import' ? 409 : 404, action);
    assert.equal(app.speechCalls.length, 1, action);
  }
});

test('client disconnect and inactive account guards discard late provider audio without caching it', { timeout: 5000 }, async t => {
  for (const action of ['disconnect', 'inactive']) {
    let active = true;
    const delayed = delayedAudio(t);
    const app = await fixture(t, { ...delayed, isActive: () => active });
    const message = await app.makeStudyMessage();
    const body = speechBody(message);
    const controller = new AbortController();
    const pending = app.request('/api/voice/speech', body, { signal: controller.signal }).catch(error => error);
    await app.started;
    if (action === 'disconnect') {
      const aborted = new Promise(resolve => app.speechCalls[0].signal.addEventListener('abort', resolve, { once: true }));
      controller.abort(); await aborted;
    } else active = false;
    delayed.release();
    const outcome = await pending;
    if (action === 'disconnect') assert.equal(outcome.name, 'AbortError');
    else assert.equal(outcome.status, 409);
    await new Promise(resolve => setImmediate(resolve));
    active = true;
    const receipt = (await app.api(`/api/voice/check/${body.requestId}`)).body;
    assert.equal(receipt.status, 'uncertain', action);
    assert.equal(receipt.cachedAudioAvailable, false, action);
    assert.equal(app.server.hasActiveRequests(), false, action);
    assert.equal((await app.api('/api/voice/speech', body)).status, 409, action);
    assert.equal(app.speechCalls.length, 1, action);
  }
});
