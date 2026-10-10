import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.js';
import { createStudyCurriculum } from '../server/study-curriculum.js';
import { buildStudyDialogueSchema, renderStudyDialogue, projectStudyDialoguePlan, studyDialogueRejection } from '../server/study-conversation.js';
import { studyCondition, STUDY_NOW } from './fixtures/study-condition.js';
import { sourceSpanSupport } from './fixtures/natural-review-v3.js';

const settings = { coachStyle: 'socratic', dailyMinutes: 18, focus: 'exam' };
const dialogue = { intent: 'explain', acknowledgment: 'none', followup: 'attempt-recall', focusChunkId: 'asthma:management', learnerQuote: null, minutes: null };
function fixture() {
  const references = createStudyCurriculum({ records: [studyCondition()], now: () => STUDY_NOW });
  return { references, evidence: references.retrieve('Study asthma'), conversation: { mode: 'coach', messages: [{ role: 'user', content: 'Explain asthma and give an original multiple-choice board question.' }] }, settings, medicalRequested: true };
}
const plan = overrides => ({ chunkIds: ['asthma:management'], questionId: null, unsupported: false, dialogue, ...overrides });

test('a valid dual point and canonical quiz renders both exact bodies with one source union and both trusted identities', () => {
  const context = fixture();
  const point = context.references.render({ chunkIds: ['asthma:management'], questionId: null, unsupported: false }, context.evidence);
  const quiz = context.references.render({ chunkIds: [], questionId: 'asthma:asthma-q1', unsupported: false }, context.evidence);
  for (const parsed of [plan({ questionId: 'asthma:asthma-q1' }), { chunkIds: ['asthma:management'], questionId: 'asthma:asthma-q1', unsupported: false }]) {
    const rendered = renderStudyDialogue(parsed, context);
    assert.ok(rendered.content.includes(point.content));
    assert.ok(rendered.content.includes(quiz.content));
    assert.ok(rendered.content.indexOf(point.content) < rendered.content.indexOf(quiz.content));
    assert.equal(rendered.spokenText, rendered.content);
    assert.deepEqual(rendered.citations, point.citations);
    assert.deepEqual(rendered.studySelection, point.studySelection);
    assert.deepEqual(rendered.studyQuestion, quiz.studyQuestion);
    assert.equal(rendered.studyDialogue.followup, 'none');
    assert.equal(rendered.sourceVerified, true);
  }
});

test('repeated eligible IDs dedupe without factual changes; an invented ID still fails before normalization', () => {
  const context = fixture();
  const single = renderStudyDialogue(plan({}), context);
  const duplicate = renderStudyDialogue(plan({ chunkIds: ['asthma:management', 'asthma:management'] }), context);
  assert.equal(duplicate.content, single.content);
  assert.deepEqual(duplicate.studySelection.chunkIds, ['asthma:management']);
  assert.throws(() => renderStudyDialogue(plan({ chunkIds: ['asthma:management', 'private-invented-id'] }), context), error => studyDialogueRejection(error).reasonId === 302);
});

test('unsupported coupled to any citation selection fails before coaching or pending hint suppression', () => {
  const context = fixture();
  for (const selection of [{ chunkIds: ['asthma:management'], questionId: null }, { chunkIds: [], questionId: 'asthma:asthma-q1' }, { chunkIds: ['asthma:management'], questionId: 'asthma:asthma-q1' }]) {
    assert.throws(() => renderStudyDialogue(plan({ ...selection, unsupported: true }), { ...context, coachingRequested: true }), error => studyDialogueRejection(error).reasonId === 303);
  }
});

test('native schema restricts a cited point followed by recall to chunks and a recall act rather than a bank quiz', () => {
  const context = fixture();
  context.conversation.messages[0].content = 'For board study, explain one cited point about asthma from the current library, then ask one recall question about that point.';
  const schema = buildStudyDialogueSchema(context).schema;
  assert.deepEqual(schema.properties.questionId.enum, [null]);
  assert.ok(schema.properties.chunkIds.items.enum.includes('asthma:management'));
  context.conversation.messages[0].content = 'Explain asthma and give an original multiple-choice board question.';
  assert.ok(buildStudyDialogueSchema(context).schema.properties.questionId.enum.includes('asthma:asthma-q1'));
});

test('failed plan projection contains only known IDs, fixed enums, counts and bounded numbers', () => {
  const context = fixture();
  const secret = 'PRIVATE_RAW_PLAN_STRING';
  const projected = projectStudyDialoguePlan({ chunkIds: ['asthma:management', secret], questionId: secret, unsupported: true, coachText: secret, dialogue: { intent: secret, acknowledgment: 'none', followup: 'none', focusChunkId: secret, learnerQuote: secret, minutes: 15 } }, context);
  assert.doesNotMatch(JSON.stringify(projected), /PRIVATE_RAW_PLAN_STRING|coachText/);
  assert.deepEqual(projected.chunkIds, ['asthma:management']);
  assert.equal(projected.unknownChunkCount, 1);
  assert.equal(projected.unknownQuestion, true);
  assert.equal(projected.dialogue.learnerQuotePosition, null);
  assert.equal(projected.dialogue.minutes, 15);
  assert.deepEqual(studyDialogueRejection(new Error(secret)), { code: 'invalid_dialogue_plan', reasonId: 399 });
});

test('HTTP natural explanation is reviewed and idempotent before a canonical quiz and grade without further AI calls', async t => {
  const context = fixture();
  const dataDir = mkdtempSync(join(tmpdir(), 'fm-dual-dialogue-'));
  let calls = 0;
  const factualText = 'Mock management fact: review inhaler technique.';
  const server = createApp({ dataDir, curriculum: context.references, foundations: createStudyCurriculum({ records: [], now: () => STUDY_NOW }), env: { OPENAI_API_KEY: 'mock-only', OPENAI_MODEL: 'gpt-4.1-mini' }, fetchImpl: async (_url, request) => {
    calls++;
    const body = JSON.parse(request.body);
    const primary = body.messages.some(message => message.content.includes('NATURAL_TUTOR_CONTEXT='));
    const payload = primary ? { segments: [{ id: 's1', text: factualText, sourceChunkIds: ['asthma:management'] }] }
      : { version: 3, approved: true, segments: [{ id: 's1', approved: true, externalFactCount: 1, claims: [{ quote: factualText, type: 'medical', sourceChunkIds: ['asthma:management'], supports: [sourceSpanSupport(body, 'asthma:management')] }], flags: [], questions: [] }] };
    return Response.json({ model: 'gpt-4.1-mini', choices: [{ message: { content: JSON.stringify(payload) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } });
  } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); rmSync(dataDir, { recursive: true, force: true }); });
  const api = async (path, body) => { const response = await fetch(base + path, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); assert.equal(response.ok, true); return response.json(); };
  const conversation = await api('/api/conversations', { mode: 'coach', conditionId: 'asthma' });
  const request = { conversationId: conversation.id, content: 'Explain asthma management for board study.', requestId: 'natural-explanation' };
  const explanation = await api('/api/chat', request);
  assert.equal(explanation.message.studyRejection, undefined);
  assert.equal(explanation.message.reviewedDialogue, true);
  assert.equal(explanation.message.canonicalSpokenText, false);
  assert.equal(explanation.message.spokenText, factualText);
  assert.deepEqual(explanation.message.groundingReview.sourceChunkIds, ['asthma:management']);
  assert.equal((await api('/api/chat', request)).message.id, explanation.message.id);
  assert.equal(calls, 2, 'Reusing the natural reply does not repeat author or reviewer calls.');
  const quiz = await api('/api/chat', { conversationId: conversation.id, content: 'Quiz me on asthma.', requestId: 'canonical-original' });
  assert.equal(quiz.message.studyQuestion.key, 'asthma:asthma-q1');
  assert.equal(quiz.message.sourceVerified, true);
  assert.equal(quiz.message.curriculum, true);
  assert.equal(quiz.message.current, true);
  assert.ok(quiz.message.citations.length);
  assert.equal(quiz.message.reviewedDialogue, undefined);
  const graded = await api('/api/chat', { conversationId: conversation.id, content: 'B', requestId: 'dual-grade' });
  assert.equal(graded.message.studyAnswer.correct, true);
  assert.equal(calls, 2, 'Original quiz selection and answer-key grading make no AI call.');
});
