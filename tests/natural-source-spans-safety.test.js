import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.js';
import { createStudyCurriculum } from '../server/study-curriculum.js';
import { buildNaturalSourceSpans, buildNaturalReviewSchema, renderReviewedTutor, naturalTutorFailure } from '../server/natural-tutor.js';
import { premiumSpeechText } from '../server/premium-speech.js';
import { studyCondition, STUDY_NOW } from './fixtures/study-condition.js';

const fact = 'Mock management fact: review inhaler technique.';
const draft = { segments: [{ id: 's1', text: fact, sourceChunkIds: ['asthma:management'] }] };
const legacyReview = { approved: true, segments: [{ id: 's1', approved: true, externalFactCount: 1, flags: [], claims: [{ quote: fact, type: 'medical', sourceChunkIds: ['asthma:management'], supports: [{ chunkId: 'asthma:management', excerpt: fact }] }] }] };

function context(record = studyCondition()) {
  let clock = STUDY_NOW;
  const references = createStudyCurriculum({ records: [record], now: () => clock });
  const evidence = references.retrieve('Study asthma inhaler technique');
  return { references, evidence, conversation: { id: randomUUID(), title: 'Span safety study', mode: 'coach', messages: [{ id: randomUUID(), role: 'user', content: 'PRIVATE_USER_STORY. Help me study asthma.', createdAt: STUDY_NOW }] }, settings: { coachStyle: 'socratic', dailyMinutes: 15, focus: 'exam' }, expire: () => { clock = Date.parse('2026-11-10T00:00:00Z'); } };
}
function v2Review(current) {
  const result = { version: 2, ...structuredClone(legacyReview) };
  const span = buildNaturalSourceSpans(current).find(item => item.chunkId === 'asthma:management');
  assert.ok(span);
  result.segments[0].claims[0].supports = [{ chunkId: span.chunkId, spanId: span.spanId }];
  return result;
}

test('review schemas expose immutable public canonical spans without private learner or candidate text', () => {
  const current = context();
  current.evidence[0].text = 'PRIVATE_RETRIEVAL_OVERRIDE';
  const spans = buildNaturalSourceSpans(current);
  assert.ok(spans.length);
  assert.deepEqual(spans, buildNaturalSourceSpans(current));
  for (const span of spans) {
    const [conditionId, sectionId] = span.chunkId.split(':');
    assert.equal(span.excerpt, current.references.get(conditionId).chunks.find(item => item.id === sectionId).text);
    assert.equal(typeof span.spanId, 'string');
  }
  const schema = buildNaturalReviewSchema({ segments: [{ id: 's1', text: 'PRIVATE_CANDIDATE_STORY', sourceChunkIds: [] }] }, current);
  assert.equal(schema.name, 'family_medicine_natural_review_v2');
  assert.ok(schema.schema.required.includes('version'));
  assert.doesNotMatch(JSON.stringify(schema), /PRIVATE_/);
  const support = schema.schema.properties.segments.items.properties.claims.items.properties.supports.items;
  assert.deepEqual(support.required, ['chunkId', 'spanId']);
  assert.deepEqual(new Set(support.properties.spanId.enum), new Set(spans.map(item => item.spanId)));
  assert.equal(support.properties.excerpt, undefined);
});

test('v2 span selection rejects wrong chunk bindings, unknown spans, free excerpts and altered exact quotes', () => {
  for (const mutate of [
    value => { value.segments[0].claims[0].supports[0].chunkId = 'asthma:diagnosis'; },
    value => { value.segments[0].claims[0].supports[0].spanId = buildNaturalSourceSpans(context()).find(item => item.chunkId === 'asthma:diagnosis').spanId; },
    value => { value.segments[0].claims[0].supports[0].spanId = 'PRIVATE_UNKNOWN_SPAN'; },
    value => { value.segments[0].claims[0].supports[0].excerpt = fact; },
    value => { value.segments[0].claims[0].quote = fact.replace('Mock', 'M\u200dock'); },
    value => { value.segments[0].claims[0].supports = [{ chunkId: 'asthma:management', excerpt: fact }]; },
  ]) {
    const current = context(); const review = v2Review(current); mutate(review);
    assert.throws(() => renderReviewedTutor(draft, review, { ...current, requireVersion2: true }), error => {
      const failure = naturalTutorFailure(error);
      assert.doesNotMatch(JSON.stringify(failure), /PRIVATE_|spanId|inhaler technique|asthma:/);
      assert.deepEqual(failure.citations, []);
      return true;
    });
  }
});

test('span approval cannot remap across a source edit, outlive source currency or truncate an oversized chunk', () => {
  const original = context(); const review = v2Review(original);
  const edited = studyCondition();
  edited.sections = edited.sections.map(section => section.id === 'management' ? { ...section, text: `${section.text} A different current qualifier.` } : section);
  const updated = context(edited);
  assert.notEqual(v2Review(updated).segments[0].claims[0].supports[0].spanId, review.segments[0].claims[0].supports[0].spanId);
  assert.throws(() => renderReviewedTutor(draft, review, { ...updated, requireVersion2: true }));
  original.expire();
  assert.throws(() => renderReviewedTutor(draft, review, { ...original, requireVersion2: true }));
  const oversize = studyCondition();
  oversize.sections = oversize.sections.map(section => section.id === 'management' ? { ...section, text: 'X'.repeat(1601) } : section);
  assert.throws(() => buildNaturalSourceSpans(context(oversize)));
});

test('legacy review records still reconstruct exact speech while fresh providers must supply v2', () => {
  const current = context();
  const accepted = renderReviewedTutor(draft, legacyReview, current);
  const message = { id: randomUUID(), role: 'assistant', responseTo: current.conversation.messages[0].id, ...accepted };
  current.conversation.messages.push(message);
  assert.equal(premiumSpeechText({ ...current, message }), fact);
  assert.throws(() => renderReviewedTutor(draft, legacyReview, { ...current, requireVersion2: true }));
  message.importedReview = true;
  assert.throws(() => premiumSpeechText({ ...current, message }));
  delete message.importedReview;
  current.expire();
  assert.throws(() => premiumSpeechText({ ...current, message }));
});

test('persisted v2 approval rejects an additive canonical source change despite unchanged dates and a surviving excerpt substring', () => {
  const original = context();
  const selected = v2Review(original);
  const accepted = renderReviewedTutor(draft, selected, { ...original, requireVersion2: true });
  assert.deepEqual(accepted.groundingReview.sourceSpanBindings, selected.segments[0].claims[0].supports);
  const message = { id: randomUUID(), role: 'assistant', responseTo: original.conversation.messages[0].id, ...accepted };
  original.conversation.messages.push(message);
  assert.equal(premiumSpeechText({ ...original, message }), fact);
  const edited = studyCondition();
  edited.sections = edited.sections.map(section => section.id === 'management' ? { ...section, text: `${section.text} A new limiting qualifier now applies.` } : section);
  const updated = context(edited);
  assert.equal(updated.references.get('asthma').current, true);
  assert.equal(updated.references.get('asthma').checkedAt, original.references.get('asthma').checkedAt);
  assert.ok(updated.references.get('asthma').chunks.find(item => item.id === 'management').text.includes(fact));
  assert.throws(() => renderReviewedTutor(draft, { approved: true, segments: message.groundingReview.segments }, { ...updated, sourceSpanBindings: message.groundingReview.sourceSpanBindings }));
  assert.throws(() => premiumSpeechText({ ...updated, conversation: original.conversation, message }), { status: 409 });
});

async function fixture(t, { legacy = false, model = 'gpt-4.1-mini' } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'natural-spans-safety-'));
  const current = context(); const calls = [], speechCalls = [], reviewReplies = [];
  const server = createApp({ dataDir, curriculum: current.references, foundations: createStudyCurriculum({ records: [], now: () => STUDY_NOW }), env: { OPENAI_API_KEY: 'local-source-span-fixture-only', OPENAI_MODEL: model }, fetchImpl: async (url, options) => {
    const input = JSON.parse(options.body);
    if (String(url).endsWith('/audio/speech')) {
      speechCalls.push(input);
      return new Response(new Uint8Array([73, 68, 51, 1]), { headers: { 'Content-Type': 'audio/mpeg' } });
    }
    calls.push(input);
    const system = input.messages?.find(message => typeof message.content === 'string' && message.content.includes('NATURAL_REVIEW_DATA='))?.content || '';
    let output = draft;
    if (system.includes('NATURAL_REVIEW_DATA=')) {
      const data = JSON.parse(system.split('NATURAL_REVIEW_DATA=')[1]);
      output = legacy ? legacyReview : { version: 3, ...structuredClone(legacyReview) };
      if (!legacy) for (const segment of output.segments) segment.questions = [];
      if (!legacy) {
        const span = data.sourceSpans.find(item => item.chunkId === 'asthma:management');
        assert.ok(span);
        output.segments[0].claims[0].supports = [{ chunkId: span.chunkId, spanId: span.spanId }];
      }
      reviewReplies.push(structuredClone(output));
    }
    return Response.json({ model, choices: [{ message: { content: JSON.stringify(output) } }], usage: { prompt_tokens: 6, completion_tokens: 4 } });
  } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); rmSync(dataDir, { recursive: true, force: true }); });
  async function request(path, body) { return fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: base, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
  async function api(path, body) { const response = await request(path, body); return { status: response.status, body: await response.json() }; }
  const created = await api('/api/conversations', { title: 'Source span study', mode: 'coach', curriculumConditionId: 'asthma' });
  assert.equal(created.status, 201);
  return { api, request, calls, speechCalls, reviewReplies, conversationId: created.body.id };
}

test('fresh v3 HTTP generation persists canonical v1 evidence and premium speech reads the exact checked text', async t => {
  const app = await fixture(t);
  const chatBody = { conversationId: app.conversationId, content: 'Help me study asthma inhaler technique.', requestId: randomUUID() };
  const answer = await app.api('/api/chat', chatBody);
  assert.equal(answer.status, 200);
  const message = answer.body.message;
  assert.equal(message.reviewedDialogue, true, JSON.stringify({ rejection: message.studyRejection, calls: app.calls.map(call => call.response_format?.json_schema?.name) }));
  assert.equal(message.sourceVerified, false);
  assert.equal(message.groundingReview.version, 1);
  assert.deepEqual(message.groundingReview.segments[0].claims[0].supports, [{ chunkId: 'asthma:management', excerpt: fact }]);
  assert.equal(message.groundingReview.segments[0].claims[0].supports[0].spanId, undefined);
  assert.equal(message.groundingReview.sourceSpanBindings[0].chunkId, 'asthma:management');
  assert.equal(message.spokenText, fact);
  assert.equal(message.content, `${fact} [1]`);
  assert.equal(app.calls[1].response_format.json_schema.name, 'family_medicine_natural_review_v3');
  assert.equal((await app.api('/api/chat', chatBody)).body.message.id, message.id);
  assert.equal(app.calls.length, 2);
  const audio = await app.request('/api/voice/speech', { conversationId: app.conversationId, messageId: message.id, voice: 'marin', chunkIndex: 0, requestId: randomUUID() });
  assert.equal(audio.status, 200);
  assert.equal(audio.headers.get('Content-Type'), 'audio/mpeg');
  await audio.arrayBuffer();
  assert.equal(app.speechCalls.length, 1);
  assert.equal(app.speechCalls[0].input, fact);
  const backup = (await app.api('/api/export')).body;
  assert.equal((await app.api('/api/import', backup)).status, 200);
  assert.equal((await app.api('/api/voice/speech', { conversationId: app.conversationId, messageId: message.id, voice: 'marin', chunkIndex: 0, requestId: randomUUID() })).status, 409);
  assert.equal(app.speechCalls.length, 1);
});

test('JSON fallback providers cannot submit the old excerpt protocol for a fresh reply', async t => {
  const app = await fixture(t, { legacy: true, model: 'gpt-4o-mini' });
  const body = { conversationId: app.conversationId, content: 'Help me study asthma inhaler technique.', requestId: randomUUID() };
  const answer = await app.api('/api/chat', body);
  assert.equal(answer.status, 200);
  assert.equal(answer.body.message.reviewedDialogue, undefined);
  assert.equal(answer.body.message.unsupported, true);
  assert.equal(answer.body.message.studyRejection.code, 'natural_tutor_validation');
  assert.deepEqual(answer.body.message.citations, []);
  assert.equal(app.calls[1].response_format.type, 'json_object');
  assert.deepEqual(app.reviewReplies, [legacyReview]);
  assert.equal((await app.api('/api/chat', body)).body.message.id, answer.body.message.id);
  assert.equal(app.calls.length, 2);
  assert.equal(app.speechCalls.length, 0);
});
