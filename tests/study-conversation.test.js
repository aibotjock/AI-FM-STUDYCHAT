import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.js';
import { createStudyCurriculum, isActualCareRequest } from '../server/study-curriculum.js';
import { buildStudyDialoguePrompt, conversationalEvidence, renderStudyDialogue, studyDialogueHistory } from '../server/study-conversation.js';
import { studyCondition, STUDY_NOW } from './fixtures/study-condition.js';

const settings = { coachStyle: 'socratic', focus: 'exam', dailyMinutes: 18 };
const selection = (dialogue, chunkIds = []) => ({ chunkIds, questionId: null, unsupported: false, dialogue });
const plan = overrides => ({ intent: 'planning', acknowledgment: 'time', followup: 'choose-topic', focusChunkId: null, learnerQuote: null, minutes: 15, ...overrides });
const references = () => createStudyCurriculum({ records: [studyCondition()], now: () => STUDY_NOW });

async function fixture(t, respond) {
  const dataDir = mkdtempSync(join(tmpdir(), 'fm-study-dialogue-'));
  const calls = [];
  const server = createApp({ dataDir, curriculum: references(), foundations: createStudyCurriculum({ records: [], now: () => STUDY_NOW }), env: { OPENAI_API_KEY: 'mock-not-real', OPENAI_MODEL: 'gpt-4.1-mini' }, fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body); calls.push(body);
    const prompt = body.messages.find(message => message.content.includes('STUDY_DIALOGUE_CONTEXT='))?.content;
    const context = JSON.parse(prompt.split('STUDY_DIALOGUE_CONTEXT=')[1]);
    return Response.json({ model: 'gpt-4.1-mini', usage: { prompt_tokens: 20, completion_tokens: 10 }, choices: [{ message: { content: JSON.stringify(respond(context, calls.length)) } }] });
  } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); rmSync(dataDir, { recursive: true, force: true }); });
  async function request(path, method = 'GET', body) {
    const response = await fetch(base + path, { method, headers: { Origin: base, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  }
  const conversation = (await request('/api/conversations', 'POST', { mode: 'coach', conditionId: 'asthma' })).body;
  return { request, calls, chat: (content, requestId) => request('/api/chat', 'POST', { conversationId: conversation.id, content, requestId }) };
}

test('study availability is not actual care, while mixed care clauses and symptom durations retain the care gate', () => {
  for (const text of ['I have 10 minutes to study', 'I have ten minutes', 'I have 20 minutes today. Help me plan a study session.', 'I have a few minutes to review', 'I have 20 minutes and want to focus on one topic.']) assert.equal(isActualCareRequest(text), false, text);
  for (const text of ['I have 10 minutes and I have asthma', 'I have 10 minutes of palpitations', 'I have twenty minutes with chest pain', 'I have ten minutes to study, but my child has a cough']) assert.equal(isActualCareRequest(text), true, text);
});

test('dialogue prompt requires a single plan schema, bounded history and saved tutoring preferences', () => {
  const bank = references();
  const conversation = { mode: 'coach', messages: Array.from({ length: 40 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: 'x'.repeat(4000) })) };
  const history = studyDialogueHistory(conversation);
  assert.ok(history.length <= 16);
  assert.ok(history.reduce((sum, item) => sum + item.content.length, 0) <= 16000);
  assert.ok(history.filter(item => item.role === 'assistant').every(item => item.trust === 'untrusted-history'));
  const prompt = buildStudyDialoguePrompt({ references: bank, evidence: bank.retrieve('Study asthma'), conversation, settings });
  assert.match(prompt, /dialogue object is REQUIRED on every response/);
  assert.equal((prompt.match(/Return ONLY JSON/g) || []).length, 1);
  const context = JSON.parse(prompt.split('STUDY_DIALOGUE_CONTEXT=')[1]);
  assert.deepEqual(context.preferences, settings);
});

test('a cited conversational explanation ends with one recall question and preserves exact source body', () => {
  const bank = references();
  const evidence = bank.retrieve('Study asthma');
  const parsed = selection(plan({ intent: 'explain', acknowledgment: 'understand', followup: 'attempt-recall', focusChunkId: 'asthma:management', minutes: null }), ['asthma:management']);
  const conversation = { messages: [{ role: 'user', content: 'Explain the cited management point, then ask one question.' }] };
  const rendered = renderStudyDialogue(parsed, { references: bank, evidence, conversation, settings, medicalRequested: true });
  const canonical = bank.render({ chunkIds: ['asthma:management'], questionId: null, unsupported: false }, evidence);
  assert.ok(rendered.content.includes(canonical.content));
  assert.ok(rendered.content.indexOf(canonical.content) < rendered.content.lastIndexOf('Without looking back'));
  assert.match(rendered.content, /in one sentence\?$/);
  assert.equal((rendered.spokenText.match(/\?/g) || []).length, 1);
  assert.deepEqual(rendered.citations, canonical.citations);
});

test('consecutive natural followups rehydrate the last trusted current selected section', () => {
  const bank = references();
  const canonical = bank.render({ chunkIds: ['asthma:management'], questionId: null, unsupported: false }, bank.retrieve('Study asthma'));
  const conversation = { messages: [{ role: 'user', content: 'Study asthma' }, { role: 'assistant', ...canonical }, { role: 'user', content: 'Why?' }, { role: 'assistant', ...canonical }, { role: 'user', content: 'I still don’t understand it.' }] };
  for (const content of ['I still don’t understand it.', 'Explain the last source-linked learning point step by step for board study.', 'Break it down for me']) {
    const evidence = conversationalEvidence(bank, conversation, content, { conditionIds: ['asthma'], previousQueries: ['Why?'] });
    assert.equal(evidence[0].key, 'asthma:management', content);
  }
});

test('linked-topic planning uses prior turns and preferences, one bounded completion and durable replay', async t => {
  let seenContext;
  const app = await fixture(t, (context, count) => { seenContext = context; return selection(plan({ acknowledgment: count === 1 ? 'time' : 'thanks', learnerQuote: count === 1 ? '15 minutes' : null })); });
  assert.equal((await app.request('/api/settings', 'PUT', { coachStyle: 'direct', focus: 'exam', dailyMinutes: 30 })).status, 200);
  const first = await app.chat('I have 15 minutes to study. Help me plan.', 'plan-first');
  assert.equal(first.status, 200);
  assert.equal(first.body.message.studyDialogue.intent, 'planning');
  assert.equal(first.body.message.studyDialogue.minutes, 15);
  assert.equal(first.body.message.canonicalStudyProcess, true);
  assert.equal(first.body.message.curriculum, undefined);
  assert.deepEqual(first.body.message.citations, []);
  assert.match(first.body.message.content, /unverified learner statement/);
  assert.doesNotMatch(first.body.message.spokenText, /unverified learner statement/);
  assert.match(first.body.message.spokenText, /concise cited section/);
  const replay = await app.chat('I have 15 minutes to study. Help me plan.', 'plan-first');
  assert.equal(replay.body.message.id, first.body.message.id);
  assert.equal(app.calls.length, 1);
  const second = await app.chat('Thanks, let us keep that plan.', 'plan-followup');
  assert.equal(second.status, 200);
  assert.equal(app.calls.length, 2);
  assert.equal(app.calls[0].max_completion_tokens ?? app.calls[0].max_tokens, 512);
  assert.equal(app.calls[1].max_completion_tokens ?? app.calls[1].max_tokens, 512);
  assert.equal(seenContext.preferences.coachStyle, 'direct');
  assert.ok(seenContext.history.some(message => message.role === 'user' && message.content.includes('15 minutes')));
  assert.ok(seenContext.history.some(message => message.role === 'assistant' && message.dialogue?.intent === 'planning'));
});

test('planning between a canonical quiz and its answer preserves pending identity without revealing or regrading', async t => {
  const app = await fixture(t, () => selection(plan()));
  const quiz = await app.chat('Quiz me on asthma', 'quiz-first');
  assert.ok(quiz.body.message.studyQuestion);
  const planning = await app.chat('Help me plan a 15-minute study session.', 'plan-during-quiz');
  assert.equal(planning.body.message.studyDialogue.intent, 'planning');
  assert.deepEqual(planning.body.message.studyDialogue.pendingQuestion, quiz.body.message.studyQuestion);
  assert.equal(planning.body.message.studyAnswer, undefined);
  assert.doesNotMatch(planning.body.message.content, /Mock management fact|canonical answer|Review inhaler technique/);
  const answer = await app.chat('B', 'answer-after-plan');
  assert.equal(answer.body.message.studyAnswer.correct, true);
  assert.equal(app.calls.length, 1);
});
