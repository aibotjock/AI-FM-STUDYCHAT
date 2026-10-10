import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.js';
import { createStudyCurriculum } from '../server/study-curriculum.js';
import { isDialogueFollowup, conversationalEvidence } from '../server/study-conversation.js';
import { buildNaturalTutorPrompt, buildNaturalTutorSchema, buildNaturalReviewPrompt, buildNaturalReviewSchema, renderReviewedTutor, aggregateTutorUsage } from '../server/natural-tutor.js';
import { studyCondition, STUDY_NOW } from './fixtures/study-condition.js';

function fixture() {
  const references = createStudyCurriculum({ records: [studyCondition()], now: () => STUDY_NOW });
  const evidence = references.retrieve('Study asthma');
  const settings = { coachStyle: 'direct', dailyMinutes: 25, focus: 'exam' };
  const conversation = { mode: 'coach', messages: [{ role: 'user', content: 'Call me Morgan. I want a brief direct explanation.' }] };
  return { references, evidence, settings, conversation };
}
function approvedPoint(context) {
  const text = 'For this study point, the supplied summary asks you to review inhaler technique. Which part would you like to explore?';
  const draft = { segments: [{ id: 's1', text, sourceChunkIds: ['asthma:management'] }] };
  const review = { approved: true, segments: [{ id: 's1', approved: true, externalFactCount: 1, claims: [{ quote: 'the supplied summary asks you to review inhaler technique', type: 'medical', sourceChunkIds: ['asthma:management'], supports: [{ chunkId: 'asthma:management', excerpt: context.evidence.find(item => item.key === 'asthma:management').text }] }], flags: [] }] };
  return { draft, review };
}

test('source-reviewed natural prose preserves the author words while adding server citations and distinct provenance', () => {
  const context = fixture();
  const { draft, review } = approvedPoint(context);
  const rendered = renderReviewedTutor(draft, review, { ...context, now: STUDY_NOW });
  assert.equal(rendered.spokenText, draft.segments[0].text);
  assert.equal(rendered.content, `${draft.segments[0].text} [1]`);
  assert.equal(rendered.reviewedDialogue, true);
  assert.equal(rendered.sourceVerified, false);
  assert.equal(rendered.canonicalSpokenText, false);
  assert.equal(rendered.humanReview, false);
  assert.equal(rendered.groundingReview.externalClaimCount, 1);
  assert.equal(rendered.groundingReview.medicalClaimCount, 1);
  assert.equal(rendered.groundingReview.reviewedAt, STUDY_NOW);
  assert.deepEqual(rendered.groundingReview.segments, review.segments);
  assert.equal(rendered.citations[0].url, 'https://www.nhlbi.nih.gov/health/asthma');
});

test('normal conversation context reaches both independent prompts while compiled schemas exclude private prose', () => {
  const context = fixture();
  context.conversation.messages.push({ role: 'user', content: 'I have a dog named PRIVATE_DOG_NAME. What name did I give you for me?' });
  const draft = { segments: [{ id: 's1', text: 'You asked me to call you Morgan. What has your day been like?', sourceChunkIds: [] }] };
  const primary = buildNaturalTutorPrompt(context);
  const reviewer = buildNaturalReviewPrompt(draft, context);
  const primaryContext = JSON.parse(primary.split('NATURAL_TUTOR_CONTEXT=')[1]);
  const reviewContext = JSON.parse(reviewer.split('NATURAL_REVIEW_DATA=')[1]);
  assert.equal(primaryContext.preferences.coachStyle, 'direct');
  assert.equal(primaryContext.preferences.dailyMinutes, 25);
  assert.ok(reviewContext.history.some(message => message.content.includes('Call me Morgan')));
  assert.deepEqual(reviewContext.candidate, draft.segments);
  for (const schema of [buildNaturalTutorSchema(context), buildNaturalReviewSchema(draft, context)]) assert.doesNotMatch(JSON.stringify(schema), /PRIVATE_DOG_NAME|Call me Morgan|You asked me/);
});

test('consecutive source-reviewed followups retrieve fresh canonical source IDs without trusting generated prose', () => {
  const context = fixture();
  const { draft, review } = approvedPoint(context);
  const rendered = renderReviewedTutor(draft, review, context);
  const conversation = { messages: [{ role: 'user', content: 'Study asthma' }, { role: 'assistant', ...rendered }, { role: 'user', content: 'Why?' }, { role: 'assistant', ...rendered }] };
  const evidence = conversationalEvidence(context.references, conversation, 'Explain this.', { conditionIds: ['asthma'], previousQueries: ['Why?'] });
  assert.equal(evidence[0].key, 'asthma:management');
  assert.equal(evidence[0].text, context.evidence.find(item => item.key === 'asthma:management').text);
  assert.notEqual(evidence[0].text, rendered.spokenText);
});

test('a multi-sentence quiz hint keeps its context while an unrelated medical topic is not a generic followup', () => {
  assert.equal(isDialogueFollowup('I don’t understand. Can I have a hint?'), true);
  assert.equal(isDialogueFollowup('I am confused. Give me a hint.'), true);
  assert.equal(isDialogueFollowup('Tell me about lupus. Can I have a hint?'), false);
});

test('two-completion usage shows actual combined cost and leaves partial unknown costs unestimated', () => {
  const first = { usage: { prompt_tokens: 100, completion_tokens: 30 }, estimatedCostUsd: 0.000088, latencyMs: 200 };
  const second = { usage: { prompt_tokens: 200, completion_tokens: 20 }, estimatedCostUsd: 0.000112, latencyMs: 300 };
  assert.deepEqual(aggregateTutorUsage(first, second, 2), { calls: 2, usage: { prompt_tokens: 300, completion_tokens: 50 }, estimatedCostUsd: first.estimatedCostUsd + second.estimatedCostUsd, latencyMs: 500 });
  const partial = aggregateTutorUsage(first, null, 2);
  assert.equal(partial.calls, 2);
  assert.equal(partial.usage, null);
  assert.equal(partial.estimatedCostUsd, null);
});

test('a nonnative selected model receives complete privacy-safe author and reviewer schemas in its prompts', async t => {
  const dataDir = mkdtempSync(join(tmpdir(), 'natural-json-contract-'));
  const calls = [];
  const learnerName = 'PRIVATE_LEARNER_NAME_174';
  const authoredText = `You asked me to call you ${learnerName}. What would you like to chat about?`;
  const server = createApp({ dataDir, curriculum: fixture().references, env: { OPENAI_API_KEY: 'mock-not-real', OPENAI_MODEL: 'gpt-6-luna' }, fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body); calls.push(body);
    assert.deepEqual(body.response_format, { type: 'json_object' });
    const prompt = body.messages.find(message => message.content.includes('OUTPUT_SCHEMA='))?.content;
    assert.ok(prompt);
    const compiled = prompt.split('OUTPUT_SCHEMA=')[1].split('\n')[0];
    const schema = JSON.parse(compiled);
    assert.doesNotMatch(compiled, /PRIVATE_LEARNER_NAME_174|What would you like to chat about/);
    assert.equal(schema.additionalProperties, false);
    const reviewing = prompt.includes('NATURAL_REVIEW_DATA=');
    if (!reviewing) {
      assert.match(prompt, /within 80 words unless the learner asks for detail/);
      assert.match(prompt, /answer a request for detail fully within the output limits/);
      assert.match(prompt, /Preserve every clinically necessary qualifier and exception/);
    }
    assert.deepEqual(schema.required, reviewing ? ['version', 'approved', 'segments'] : ['segments']);
    assert.deepEqual(schema.properties.segments.items.required, reviewing ? ['id', 'approved', 'externalFactCount', 'claims', 'flags', 'questions'] : ['id', 'text', 'sourceChunkIds']);
    assert.equal(schema.properties.segments.items.additionalProperties, false);
    const response = reviewing ? { version: 3, approved: true, segments: [{ id: 's1', approved: true, externalFactCount: 0, claims: [], flags: [], questions: [{ quote: 'What would you like to chat about?', kind: 'conversation', recallSpanId: null }] }] } : { segments: [{ id: 's1', text: authoredText, sourceChunkIds: [] }] };
    return Response.json({ model: 'gpt-6-luna', usage: { prompt_tokens: 30, completion_tokens: 10 }, choices: [{ message: { content: JSON.stringify(response) } }] });
  } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); rmSync(dataDir, { recursive: true, force: true }); });
  async function post(path, body, status = 200) {
    const response = await fetch(base + path, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, status);
    return response.json();
  }
  const conversation = await post('/api/conversations', { mode: 'coach' }, 201);
  const reply = await post('/api/chat', { conversationId: conversation.id, content: `Call me ${learnerName}. I'd like to chat about my day.`, requestId: 'nonnative-schema-contract' });
  assert.equal(calls.length, 2);
  assert.equal(reply.message.reviewedDialogue, true);
  assert.equal(reply.message.spokenText, authoredText);
  assert.equal(reply.message.ai.returnedModel, 'gpt-6-luna');
});
