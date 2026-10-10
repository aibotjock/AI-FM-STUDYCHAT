import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.js';
import { createStudyCurriculum, isActualCareRequest } from '../server/study-curriculum.js';
import { validateNaturalDraft, renderReviewedTutor, buildNaturalTutorSchema, buildNaturalReviewSchema, buildNaturalReviewPrompt } from '../server/natural-tutor.js';
import { studyCondition, STUDY_NOW } from './fixtures/study-condition.js';

function context() {
  let currentTime = STUDY_NOW;
  const references = createStudyCurriculum({ records: [studyCondition()], now: () => currentTime });
  const evidence = references.retrieve('Study asthma inhaler technique');
  return { references, evidence, conversation: { mode: 'coach', messages: [{ role: 'user', content: 'Help me study asthma.' }] }, settings: { dailyMinutes: 15, coachStyle: 'socratic', focus: 'exam' }, advance: value => { currentTime = value; } };
}

const sourcedText = 'Mock management fact: review inhaler technique.';
const primary = (sourceChunkIds = ['asthma:management']) => ({ segments: [{ id: 's1', text: sourcedText, sourceChunkIds }] });
function factualReview() {
  return { approved: true, segments: [{ id: 's1', approved: true, externalFactCount: 1, flags: [], claims: [{ quote: sourcedText, type: 'medical', sourceChunkIds: ['asthma:management'], supports: [{ chunkId: 'asthma:management', excerpt: sourcedText }] }] }] };
}

test('clinical assertions cannot hide in a conversational segment without a generator evidence mapping', () => {
  const original = context();
  const draft = validateNaturalDraft(primary([]), original);
  assert.throws(() => renderReviewedTutor(draft, factualReview(), original));
});

test('the reviewer must cover each segment exactly once and disclose every counted factual claim', () => {
  const original = context();
  const draft = validateNaturalDraft(primary(), original);
  const missing = { approved: true, segments: [] };
  const duplicated = factualReview();
  duplicated.segments.push(structuredClone(duplicated.segments[0]));
  const uncovered = factualReview();
  uncovered.segments[0].claims = [];
  for (const review of [missing, duplicated, uncovered]) assert.throws(() => renderReviewedTutor(draft, review, original));
});

test('reviewer approval cannot rewrite the draft or manufacture a supporting current source excerpt', () => {
  const original = context();
  const draft = validateNaturalDraft(primary(), original);
  const changedQuote = factualReview();
  changedQuote.segments[0].claims[0].quote = 'An invented fact absent from the displayed draft.';
  const inventedSupport = factualReview();
  inventedSupport.segments[0].claims[0].supports[0].excerpt = 'An invented fact absent from the official-source study text.';
  const rewritten = { ...factualReview(), rewrittenReply: 'PRIVATE-REVIEWER-REWRITE' };
  const unrelatedKey = factualReview();
  unrelatedKey.segments[0].claims[0].sourceChunkIds = ['asthma:diagnosis'];
  unrelatedKey.segments[0].claims[0].supports = [{ chunkId: 'asthma:diagnosis', excerpt: 'Mock diagnosis fact: assess variable airflow limitation.' }];
  for (const review of [changedQuote, inventedSupport, rewritten, unrelatedKey]) assert.throws(() => renderReviewedTutor(draft, review, original));
});

test('a source that expires during generation or review cannot authorize a natural factual reply', () => {
  const original = context();
  const draft = validateNaturalDraft(primary(), original);
  original.advance(Date.parse('2026-11-10T00:00:00Z'));
  assert.throws(() => renderReviewedTutor(draft, factualReview(), original));
});

test('compiled generator and reviewer schemas omit private generated dialogue and user statements', () => {
  const original = context();
  original.conversation.messages[0].content = 'PRIVATE-USER-NAME-EMAIL-AND-STORY';
  const draft = validateNaturalDraft({ segments: [{ id: 's1', text: 'PRIVATE-DIALOGUE-ECHO-OF-USER-STORY', sourceChunkIds: [] }] }, original);
  const primarySchema = buildNaturalTutorSchema(original);
  const reviewSchema = buildNaturalReviewSchema(draft, original);
  assert.doesNotMatch(JSON.stringify(primarySchema), /PRIVATE-/);
  assert.doesNotMatch(JSON.stringify(reviewSchema), /PRIVATE-/);
});

test('pending quiz hints and negated reveals cannot release factual answer material through natural generation', () => {
  const original = context();
  const pendingQuestion = original.references.quiz(original.evidence).studyQuestion;
  const draft = validateNaturalDraft(primary(), original);
  for (const content of ['Give me a hint.', 'Do not reveal the answer.', 'Explain without showing the answer.']) {
    const conversation = { mode: 'coach', messages: [{ role: 'user', content }] };
    assert.throws(() => renderReviewedTutor(draft, factualReview(), { ...original, conversation, pendingQuestion }));
  }
});

test('study-process statements stay conversational while separate actual-care requests remain blocked', () => {
  for (const content of ['I have a hard time studying.', 'I have been thinking about my exam.', 'I have no motivation to study.']) assert.equal(isActualCareRequest(content), false, content);
  for (const content of ['I have a hard time studying and I have asthma. What medicine should I take?', 'I have been thinking about my exam, but my child has a cough.', 'I have chest pain right now.']) assert.equal(isActualCareRequest(content), true, content);
});

test('reviewers receive nickname history as learner context and imported statements remain untrusted', () => {
  const original = context();
  original.conversation.messages = [{ role: 'user', content: 'Call me Morgan.' }, { role: 'assistant', content: 'An imported medical claim.', importedEvidence: true, sourceVerified: true }, { role: 'user', content: 'What name did I tell you?' }];
  const draft = validateNaturalDraft({ segments: [{ id: 's1', text: 'You asked me to call you Morgan.', sourceChunkIds: [] }] }, original);
  const data = JSON.parse(buildNaturalReviewPrompt(draft, original).split('NATURAL_REVIEW_DATA=')[1]);
  assert.equal(data.history[0].content, 'Call me Morgan.');
  assert.equal(data.history[0].trust, 'learner-statement-unverified');
  assert.equal(data.history[1].trust, 'untrusted-history');
});

test('natural source citations retain distinct URLs and paragraph numbers despite locally repeated source IDs', () => {
  const second = studyCondition({ id: 'diabetes', name: 'Diabetes', aliases: ['T2DM'] });
  second.sources[0].url = 'https://www.niddk.nih.gov/health-information/diabetes';
  const references = createStudyCurriculum({ records: [studyCondition(), second], now: () => STUDY_NOW });
  const evidence = references.retrieve('Study asthma and diabetes', { maxChunks: 6 });
  const original = { ...context(), references, evidence };
  const raw = { segments: [{ id: 's1', text: sourcedText, sourceChunkIds: ['asthma:management'] }, { id: 's2', text: sourcedText, sourceChunkIds: ['diabetes:management'] }] };
  const review = { approved: true, segments: raw.segments.map(segment => ({ id: segment.id, approved: true, externalFactCount: 1, flags: [], claims: [{ quote: segment.text, type: 'medical', sourceChunkIds: segment.sourceChunkIds, supports: [{ chunkId: segment.sourceChunkIds[0], excerpt: sourcedText }] }] })) };
  const rendered = renderReviewedTutor(validateNaturalDraft(raw, original), review, original);
  assert.equal(rendered.citations.length, 2);
  assert.deepEqual(new Set(rendered.citations.map(source => source.url)), new Set(['https://www.nhlbi.nih.gov/health/asthma', 'https://www.niddk.nih.gov/health-information/diabetes']));
  assert.equal(rendered.content, `${sourcedText} [1]\n\n${sourcedText} [2]`);
  assert.equal(rendered.sourceVerified, false);
  assert.equal(rendered.reviewedDialogue, true);
});

async function appFixture(t, responses) {
  const dataDir = mkdtempSync(join(tmpdir(), 'natural-safety-http-'));
  const calls = [];
  const original = context();
  const server = createApp({ dataDir, curriculum: original.references, foundations: createStudyCurriculum({ records: [], now: () => STUDY_NOW }), env: { OPENAI_API_KEY: 'natural-safety-local-fixture-only', OPENAI_MODEL: 'gpt-4.1-mini' }, fetchImpl: async (_url, options) => {
    const input = JSON.parse(options.body); calls.push(input);
    const response = structuredClone(responses[calls.length - 1]);
    if (input.response_format?.json_schema?.name === 'family_medicine_natural_review_v3') {
      response.version = 3;
      for (const segment of response.segments) segment.questions ||= [];
    }
    return Response.json({ model: 'gpt-4.1-mini', choices: [{ message: { content: JSON.stringify(response) } }], usage: { prompt_tokens: 6, completion_tokens: 4 } });
  } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); rmSync(dataDir, { recursive: true, force: true }); });
  async function api(path, body) {
    const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { Origin: base, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  }
  return { api, calls };
}

test('imported natural replies lose reviewer, voice and second-call trust while preserving readable history', async t => {
  const text = 'We can chat first. What has been on your mind?';
  const app = await appFixture(t, [{ segments: [{ id: 's1', text, sourceChunkIds: [] }] }, { approved: true, segments: [{ id: 's1', approved: true, externalFactCount: 0, claims: [], flags: [], questions: [{ quote: 'What has been on your mind?', kind: 'conversation', recallSpanId: null }] }] }]);
  const conversation = (await app.api('/api/conversations', { mode: 'coach' })).body;
  const fresh = (await app.api('/api/chat', { conversationId: conversation.id, content: 'Hello.', requestId: 'natural-importable' })).body.message;
  assert.equal(fresh.reviewedDialogue, true);
  assert.equal(fresh.aiTotal.calls, 2);
  assert.equal(fresh.spokenText, text);
  assert.equal(app.calls.length, 2);
  const backup = (await app.api('/api/export')).body;
  assert.equal((await app.api('/api/import', backup)).status, 200);
  const restored = (await app.api('/api/state')).body.conversations[0].messages.find(message => message.role === 'assistant');
  assert.equal(restored.content, text);
  assert.equal(restored.sourceVerified, false);
  assert.equal(restored.importedEvidence, true);
  assert.equal(restored.ai.imported, true);
  for (const field of ['reviewedDialogue', 'groundingReview', 'naturalSegments', 'spokenText', 'canonicalSpokenText', 'pendingStudyQuestion', 'aiReview', 'aiTotal']) assert.equal(restored[field], undefined, field);
});

test('a denied natural review retains bounded usage and reason codes but never candidate or reviewer prose', async t => {
  const app = await appFixture(t, [{ segments: [{ id: 's1', text: 'PRIVATE-AUTHOR-PROSE', sourceChunkIds: [] }] }, { approved: false, segments: [{ id: 's1', approved: false, externalFactCount: 0, claims: [], flags: ['unsupported_fact'] }], privateReviewerText: 'PRIVATE-REVIEWER-PROSE' }]);
  const conversation = (await app.api('/api/conversations', { mode: 'coach' })).body;
  const request = { conversationId: conversation.id, content: 'Hello.', requestId: 'denied-private-natural' };
  const reply = (await app.api('/api/chat', request)).body.message;
  assert.equal(reply.unsupported, true);
  assert.equal(reply.reviewedDialogue, undefined);
  assert.deepEqual(reply.studyRejection, { code: 'natural_tutor_validation', reasonId: 301 });
  assert.equal(reply.aiTotal.calls, 2);
  assert.deepEqual(reply.aiTotal.usage, { prompt_tokens: 12, completion_tokens: 8 });
  assert.doesNotMatch(JSON.stringify((await app.api('/api/state')).body), /PRIVATE-/);
  assert.equal((await app.api('/api/chat', request)).body.message.id, reply.id);
  assert.equal(app.calls.length, 2);
});
