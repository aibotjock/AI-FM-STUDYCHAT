import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.js';
import { createStudyCurriculum, studyChoice } from '../server/study-curriculum.js';
import { studyCondition, STUDY_NOW } from './fixtures/study-condition.js';

async function fixture(t, options = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'fm-conversational-quiz-'));
  let currentTime = STUDY_NOW;
  let providerCalls = 0;
  const records = [studyCondition(), studyCondition({ id: 'diabetes', name: 'Diabetes', aliases: ['T2DM'] })];
  const curriculum = createStudyCurriculum({ records, now: () => currentTime });
  const foundations = options.foundations || createStudyCurriculum({ records: [], now: () => currentTime });
  const env = { OPENAI_API_KEY: 'quiz-mock-only-not-a-real-api-key', OPENAI_MODEL: 'gpt-4.1-mini', ...options.env };
  const fetchImpl = async () => {
    providerCalls++;
    return Response.json({ model: 'gpt-4.1-mini', usage: { prompt_tokens: 7, completion_tokens: 3 }, choices: [{ message: { content: JSON.stringify(options.selection || { chunkIds: [], questionId: 'asthma:asthma-q1', unsupported: false }) } }] });
  };
  let server;
  let base;
  async function start() {
    server = createApp({ dataDir, curriculum, foundations, env, fetchImpl, ...(options.generateReply ? { generateReply: options.generateReply } : {}), ...(options.authenticateRequest ? { authenticateRequest: options.authenticateRequest } : {}) });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() { if (server?.listening) { await server.closeVoiceSessions(); await new Promise(resolve => server.close(resolve)); } }
  await start();
  t.after(async () => { await stop(); rmSync(dataDir, { recursive: true, force: true }); });
  async function request(path, method = 'GET', body) {
    const response = await fetch(base + path, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), Origin: base }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }
  async function conversation(conditionId = 'asthma') { return (await request('/api/conversations', 'POST', { mode: 'coach', ...(conditionId ? { conditionId } : {}) })).body; }
  async function chat(conversationId, content, requestId, extra = {}) { return request('/api/chat', 'POST', { conversationId, content, requestId, ...extra }); }
  return { request, conversation, chat, calls: () => providerCalls, advance: value => { currentTime = value; }, async restart() { await stop(); await start(); } };
}

test('deliberate option parsing accepts reasoning without turning a clinical sentence into an answer', () => {
  for (const text of ['B', 'b.', 'option B', 'Answer: B', 'The answer is B', 'I choose B', 'B because this matches the supplied vignette.']) assert.equal(studyChoice(text), 'B', text);
  for (const text of ['A patient has a cough.', 'B. Study diabetes', 'B or C', 'Z', 'I choose B or C', 'Give B to the patient', 'asthma']) assert.equal(studyChoice(text), null, text);
  for (const [text, expected] of [['bee', 'B'], ['see', 'C'], ['dee', 'D'], ['ee', 'E'], ['choice bee', 'B']]) assert.equal(studyChoice(text), expected, text);
  for (const text of ['See my patient', 'be', 'see the source', 'bee sting treatment']) assert.equal(studyChoice(text), null, text);
});

test('personal study coaching uses conversational acts without generating uncited facts or conversation cards', async t => {
  const app = await fixture(t, { selection: { chunkIds: [], questionId: null, unsupported: false, dialogue: { intent: 'reflect', acknowledgment: 'effort', followup: 'name-gap' } } });
  for (const mode of ['coach', 'simulation', 'practice']) {
    const conversation = (await app.request('/api/conversations', 'POST', { mode })).body;
    const reply = await app.chat(conversation.id, 'I want to practice synthesis.', `scripted-${mode}`);
    assert.equal(reply.body.message.scripted, true);
    assert.equal(reply.body.message.canonicalStudyProcess, true);
    assert.equal(reply.body.message.sourceVerified, true);
    assert.equal(reply.body.message.ai.provider, 'openai');
    assert.equal(reply.body.message.studyDialogue.intent, 'reflect');
    assert.match(reply.body.message.content, /Which part feels unclear/);
    assert.match(reply.body.message.content, /not assigning a competence score or verifying a free-text medical answer/);
    assert.deepEqual(reply.body.message.citations, []);
    const drafts = await app.request('/api/chat/cards', 'POST', { conversationId: conversation.id });
    assert.deepEqual(drafts.body.cards, []);
    assert.match(drafts.body.notice, /Uncited conversation drafts are disabled/);
  }
  assert.equal(app.calls(), 3, 'Each new coaching turn uses one model request; drafting unsourced cards uses none.');
});

test('unsupported responses are safe canonical process text and imported source markers can never authorize speech', async t => {
  const app = await fixture(t);
  const conversation = await app.conversation();
  const unknown = await app.chat(conversation.id, 'Tell me about lupus', 'safe-abstention');
  assert.equal(unknown.body.message.unsupported, true);
  assert.equal(unknown.body.message.canonicalStudyProcess, true);
  assert.equal(unknown.body.message.sourceVerified, true);
  assert.deepEqual(unknown.body.message.citations, []);
  const backup = (await app.request('/api/export')).body;
  assert.equal((await app.request('/api/import', 'POST', backup)).status, 200);
  const restored = (await app.request('/api/state')).body.conversations[0].messages[1];
  assert.equal(restored.sourceVerified, false);
  assert.equal(restored.canonicalStudyProcess, undefined);
  assert.equal(app.calls(), 0);
});

test('foundation chat uses the source bank for canonical snippets, expiry dates and quiz grading without changing condition counts', async t => {
  const record = studyCondition({ id: 'foundations-evidence', name: 'Evidence appraisal', aliases: ['evidence appraisal'], domain: 'foundations', recordType: 'foundation' });
  record.questions = record.questions.map(question => ({ ...question, domain: 'foundations' }));
  const foundations = createStudyCurriculum({ records: [record], now: () => STUDY_NOW });
  const app = await fixture(t, { foundations, env: { OPENAI_API_KEY: '' } });
  assert.equal((await app.request('/api/curriculum')).body.total, 2);
  const conversation = await app.conversation('foundations-evidence');
  const text = await app.chat(conversation.id, 'Study evidence appraisal', 'foundation-source');
  assert.equal(text.body.message.curriculum, true);
  assert.equal(text.body.message.sourceVerified, true);
  assert.match(text.body.message.citations[0].expiresAt, /^2026-11-09$/);
  assert.ok(text.body.message.studySelection.chunkIds.every(key => key.startsWith('foundations-evidence:')));
  const question = await app.chat(conversation.id, 'Quiz me', 'foundation-chat-quiz');
  assert.match(question.body.message.studyQuestion.key, /^foundations-evidence:/);
  const graded = await app.chat(conversation.id, 'choice bee', 'foundation-chat-grade');
  assert.equal(graded.body.message.studyAnswer.correct, true);
  assert.equal(app.calls(), 0);
});

test('clear real-person requests redirect before source selection or grading while explicit hypothetical board vignettes remain eligible', async t => {
  const app = await fixture(t, { env: { OPENAI_API_KEY: '' } });
  const conversation = await app.conversation();
  for (const [index, content] of ['I have asthma. What treatment should I take?', 'My patient has asthma.', 'My child has a cough.', 'What medication dose for me?', 'My actual patient has asthma in a hypothetical board case.'].entries()) {
    const response = await app.chat(conversation.id, content, `real-person-${index}`);
    assert.equal(response.body.message.canonicalStudyProcess, true);
    assert.equal(response.body.message.sourceVerified, true);
    assert.match(response.body.message.content, /cannot diagnose a real person, select treatment or advise patient care/);
    assert.deepEqual(response.body.message.citations, []);
    assert.equal(response.body.message.curriculum, undefined);
  }
  const hypothetical = await app.chat(conversation.id, 'In a fictional board vignette, my patient has asthma. Study asthma.', 'hypothetical-study');
  assert.equal(hypothetical.body.message.curriculum, true);
  const quiz = await app.chat(conversation.id, 'Quiz me on asthma', 'before-real-grade');
  assert.ok(quiz.body.message.studyQuestion);
  const redirected = await app.chat(conversation.id, 'B because my patient has asthma.', 'real-person-grade');
  assert.equal(redirected.body.message.studyAnswer, undefined);
  assert.equal(redirected.body.message.canonicalStudyProcess, true);
  assert.equal(app.calls(), 0);
});

test('canonical chat question hides its key, then grades the selected answer without a model request', async t => {
  const app = await fixture(t);
  const conversation = await app.conversation();
  const quiz = await app.chat(conversation.id, 'Quiz me on asthma', 'new-quiz');
  assert.equal(quiz.status, 200);
  assert.equal(quiz.body.message.studyQuestion.key, 'asthma:asthma-q1');
  assert.match(quiz.body.message.studyQuestion.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(quiz.body.message).includes('correctChoiceId'), false);
  assert.equal(JSON.stringify(quiz.body.message).includes('explicitly supports'), false);
  assert.equal(app.calls(), 0);
  const result = await app.chat(conversation.id, 'B because I reviewed the given learning step.', 'grade-correct');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.message.studyAnswer, { ...quiz.body.message.studyQuestion, choiceId: 'B', correct: true, correctChoiceId: 'B' });
  assert.match(result.body.message.content, /Original board-practice feedback/);
  assert.match(result.body.message.content, /hypothetical vignette/);
  assert.match(result.body.message.content, /written reasoning has not been evaluated/);
  assert.match(result.body.message.content, /source checks are not clinician approval or patient-care advice/);
  assert.equal(result.body.message.ai, undefined);
  assert.equal(result.body.message.humanReview, false);
  assert.equal(result.body.message.citations[0].url, 'https://www.nhlbi.nih.gov/health/asthma');
  assert.equal(app.calls(), 0);
});

test('incorrect chat choice reveals the canonical answer and every distractor with stable request replay', async t => {
  const app = await fixture(t);
  const conversation = await app.conversation();
  await app.chat(conversation.id, 'Quiz me on asthma', 'wrong-quiz');
  const result = await app.chat(conversation.id, 'A', 'grade-wrong');
  assert.equal(result.body.message.studyAnswer.correct, false);
  assert.equal(result.body.message.studyAnswer.correctChoiceId, 'B');
  assert.match(result.body.message.content, /Not quite/);
  assert.match(result.body.message.content, /supplied mock reference explicitly supports/);
  for (const id of ['A', 'C', 'D', 'E']) assert.match(result.body.message.content, new RegExp(`${id}\\. This is not supported`));
  const replay = await app.chat(conversation.id, 'A', 'grade-wrong');
  assert.equal(replay.body.message.id, result.body.message.id);
  assert.equal(replay.body.conversation.messages.length, 4);
  assert.equal((await app.chat(conversation.id, 'B', 'grade-wrong')).status, 409);
  assert.equal((await app.chat(conversation.id, 'A', 'grade-wrong', { conditionIds: ['asthma'] })).status, 409);
  assert.equal(app.calls(), 0);
});

test('quiz source expiry between presentation and answering abstains without exposing the answer or dispatching inference', async t => {
  const app = await fixture(t);
  const conversation = await app.conversation();
  await app.chat(conversation.id, 'Quiz me on asthma', 'expires-quiz');
  app.advance(Date.parse('2026-11-10T00:00:00Z'));
  const result = await app.chat(conversation.id, 'B', 'expires-answer');
  assert.equal(result.body.message.unsupported, true);
  assert.match(result.body.message.content, /source check has expired/);
  assert.equal(result.body.message.studyAnswer, undefined);
  assert.deepEqual(result.body.message.citations, []);
  assert.equal(app.calls(), 0);
});

test('a changed canonical question cannot grade a stale question fingerprint', () => {
  const original = studyCondition();
  const curriculum = createStudyCurriculum({ records: [original], now: () => STUDY_NOW });
  const prompt = curriculum.render({ chunkIds: [], questionId: 'asthma:asthma-q1', unsupported: false }, curriculum.retrieve('Study asthma'));
  const changed = structuredClone(original);
  changed.questions[0].stem += ' An additional hypothetical detail changes the question.';
  const updated = createStudyCurriculum({ records: [changed], now: () => STUDY_NOW });
  const result = updated.gradeQuestion(prompt.studyQuestion, 'B');
  assert.equal(result.unsupported, true);
  assert.equal(result.studyAnswer, undefined);
  assert.deepEqual(result.citations, []);
  const revisedSourceText = structuredClone(original);
  revisedSourceText.sections[1].text += ' A revised source-backed study point.';
  const revised = createStudyCurriculum({ records: [revisedSourceText], now: () => STUDY_NOW });
  assert.equal(revised.gradeQuestion(prompt.studyQuestion, 'B').unsupported, true);
});

test('trusted pending quiz survives server restart but imported quiz metadata remains untrusted', async t => {
  const app = await fixture(t);
  const conversation = await app.conversation();
  const quiz = await app.chat(conversation.id, 'Quiz me on asthma', 'persisted-quiz');
  await app.restart();
  const graded = await app.chat(conversation.id, 'B', 'persisted-grade');
  assert.equal(graded.body.message.studyAnswer.correct, true);
  assert.equal(app.calls(), 0);
  const backup = (await app.request('/api/export')).body;
  backup.conversations[0].messages = backup.conversations[0].messages.slice(0, 2);
  backup.conversations[0].messages[1].curriculum = true;
  backup.conversations[0].messages[1].sourceVerified = true;
  const imported = await app.request('/api/import', 'POST', backup);
  assert.equal(imported.status, 200);
  const restored = (await app.request('/api/state')).body.conversations[0].messages[1];
  assert.deepEqual(restored.studyQuestion, { ...quiz.body.message.studyQuestion, imported: true });
  assert.equal(restored.importedEvidence, true);
  assert.equal(restored.curriculum, undefined);
  const answer = await app.chat(conversation.id, 'B', 'untrusted-answer');
  assert.equal(answer.body.message.studyAnswer, undefined);
});

test('explicit condition changes and an intervening unsupported topic cannot grade a prior quiz', async t => {
  const app = await fixture(t, { selection: { chunkIds: [], questionId: 'asthma:asthma-q1', unsupported: false } });
  const first = await app.conversation();
  await app.chat(first.id, 'Quiz me on asthma', 'switch-quiz');
  const changed = await app.chat(first.id, 'B', 'switched-answer', { conditionIds: ['diabetes'] });
  assert.equal(changed.body.message.studyAnswer, undefined);
  const second = await app.conversation();
  await app.chat(second.id, 'Quiz me on asthma', 'intervening-quiz');
  const unknown = await app.chat(second.id, 'Tell me about lupus', 'unsupported-new-topic');
  assert.equal(unknown.body.message.unsupported, true);
  const stale = await app.chat(second.id, 'B', 'stale-old-answer');
  assert.equal(stale.body.message.studyAnswer, undefined);
  assert.equal(stale.body.message.unsupported, true);
});

test('invalid imported question metadata rejects atomically and commercial chat never uses personal quiz grading', async t => {
  const app = await fixture(t);
  const conversation = await app.conversation();
  await app.chat(conversation.id, 'Quiz me on asthma', 'invalid-import-quiz');
  const backup = (await app.request('/api/export')).body;
  backup.conversations[0].messages[1].studyQuestion.fingerprint = 'forged';
  assert.equal((await app.request('/api/import', 'POST', backup)).status, 400);
  const result = await app.chat(conversation.id, 'B', 'after-rejected-import');
  assert.equal(result.body.message.studyAnswer.correct, true);
  const commercial = await fixture(t, { authenticateRequest: () => true, generateReply: async () => ({ content: 'Commercial approved study gate only.' }) });
  const separateConversation = await commercial.conversation(null);
  const reply = await commercial.chat(separateConversation.id, 'B', 'commercial-option');
  assert.equal(reply.body.message.content, 'Commercial approved study gate only.');
  assert.equal(reply.body.message.studyAnswer, undefined);
  assert.equal(commercial.calls(), 0);
});


test('current board pool exposes no answers and fingerprint-bound structured grading excludes stale records', () => {
  const records = [studyCondition(), studyCondition({ id: 'expired', name: 'Expired fixture', aliases: [], review: { kind: 'automated-source-check', humanReviewed: false, checkedAt: '2026-08-01', expiresAt: '2026-09-01' } })];
  const curriculum = createStudyCurriculum({ records, now: () => STUDY_NOW });
  const pool = curriculum.boardQuestions();
  assert.equal(pool.length, 2);
  assert.equal(pool[0].domain, 'chronic');
  assert.equal(pool[0].current, true);
  assert.equal(JSON.stringify(pool).includes('correctChoiceId'), false);
  assert.equal(JSON.stringify(pool).includes('explanation'), false);
  const graded = curriculum.gradeBoardQuestion(pool[0], 'B');
  assert.equal(graded.correct, true);
  assert.equal(graded.humanReview, false);
  assert.equal(graded.citations[0].url, 'https://www.nhlbi.nih.gov/health/asthma');
  assert.equal(curriculum.gradeBoardQuestion({ ...pool[0], fingerprint: '0'.repeat(64) }, 'B'), null);
  assert.equal(curriculum.gradeBoardQuestion(pool[0], 'Z'), null);
});

test('explicit quiz requests cycle original questions without inference and do not confer unknown-topic coverage', async t => {
  const app = await fixture(t, { env: { OPENAI_API_KEY: '' } });
  const conversation = await app.conversation();
  const first = await app.chat(conversation.id, 'Can you quiz me on asthma?', 'offline-quiz-one');
  assert.equal(first.body.message.studyQuestion.key, 'asthma:asthma-q1');
  await app.chat(conversation.id, 'B', 'offline-grade-one');
  const second = await app.chat(conversation.id, 'Next question', 'offline-quiz-two');
  assert.equal(second.body.message.studyQuestion.key, 'asthma:asthma-q2');
  await app.chat(conversation.id, 'A', 'offline-grade-two');
  const third = await app.chat(conversation.id, 'Give me another board question', 'offline-quiz-three');
  assert.equal(third.body.message.studyQuestion.key, 'asthma:asthma-q1');
  const missing = await app.chat(conversation.id, 'Quiz me on lupus', 'offline-unknown-quiz');
  assert.equal(missing.body.message.unsupported, true);
  assert.equal(missing.body.message.studyQuestion, undefined);
  assert.equal(app.calls(), 0);
});
