import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAiProvider } from '../server/ai-provider.js';
import { createApp } from '../server/index.js';
import { createStudyCurriculum } from '../server/study-curriculum.js';
import { buildStudyDialogueSchema, buildStudyDialoguePrompt } from '../server/study-conversation.js';
import { studyCondition, STUDY_NOW } from './fixtures/study-condition.js';

const bank = () => createStudyCurriculum({ records: [studyCondition()], now: () => STUDY_NOW });
const turns = [{ role: 'user', content: 'Explain one cited study point.' }];
const reply = content => Response.json({ model: 'gpt-4.1-mini', choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 10 } });

test('strict study schema restricts source IDs, question IDs, dialogue enums and exact recent learner quotes', () => {
  const references = bank();
  const evidence = references.retrieve('Study asthma');
  const conversation = { messages: [{ role: 'assistant', content: 'Not learner words' }, { role: 'user', content: 'I have 15 minutes to study.' }, { role: 'user', content: 'x'.repeat(181) }] };
  const { schema } = buildStudyDialogueSchema({ references, evidence, conversation });
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ['chunkIds', 'questionId', 'unsupported', 'dialogue']);
  assert.deepEqual(schema.properties.chunkIds.items.enum, evidence.map(item => item.key));
  assert.deepEqual(schema.properties.questionId.enum, ['asthma:asthma-q1', 'asthma:asthma-q2', null]);
  assert.equal(schema.properties.dialogue.additionalProperties, false);
  assert.equal(schema.properties.dialogue.required.length, 6);
  assert.deepEqual(schema.properties.dialogue.properties.learnerQuote.enum, [null, 0]);
  assert.doesNotMatch(JSON.stringify(schema), /I have 15 minutes|Not learner words/);
  assert.equal(schema.properties.dialogue.properties.minutes.maximum, 120);
  const empty = buildStudyDialogueSchema({ references, evidence: [] }).schema;
  assert.equal(empty.properties.chunkIds.maxItems, 0);
  assert.equal(Object.hasOwn(empty.properties.chunkIds.items, 'enum'), false);
  assert.deepEqual(empty.properties.questionId.enum, [null]);
});

test('verified GPT-4.1 models and snapshots use native strict Structured Outputs with no request storage', async () => {
  const references = bank();
  const jsonSchema = buildStudyDialogueSchema({ references, evidence: [] });
  for (const model of ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4.1-2025-04-14', 'gpt-4.1-mini-2025-04-14', 'gpt-4.1-nano-2025-04-14']) {
    let calls = 0;
    const provider = createAiProvider({ env: { OPENAI_API_KEY: 'mock-only', OPENAI_MODEL: model }, fetchImpl: async (_url, request) => {
      calls++; const body = JSON.parse(request.body);
      assert.deepEqual(body.response_format, { type: 'json_schema', json_schema: { ...jsonSchema, strict: true } });
      assert.equal(body.store, false);
      assert.equal(body.max_completion_tokens, 512);
      return Response.json({ model, choices: [{ message: { content: '{}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    } });
    await provider.complete(turns, { jsonSchema, maxOutputTokens: 512 });
    assert.equal(calls, 1);
  }
});

test('other selectable models retain JSON mode; malformed schema rejects before any provider call', async () => {
  let calls = 0;
  const references = bank();
  const provider = createAiProvider({ env: { OPENAI_API_KEY: 'mock-only', OPENAI_MODEL: 'gpt-4o' }, fetchImpl: async (_url, request) => {
    calls++; assert.deepEqual(JSON.parse(request.body).response_format, { type: 'json_object' });
    return Response.json({ model: 'gpt-4o', choices: [{ message: { content: '{}' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
  } });
  await provider.complete(turns, { jsonSchema: buildStudyDialogueSchema({ references, evidence: [] }) });
  assert.equal(calls, 1);
  for (const jsonSchema of [{ name: 'invalid name', schema: { type: 'object' } }, { name: 'bad_root', schema: { type: 'array' } }]) await assert.rejects(provider.complete(turns, { jsonSchema }), { status: 400 });
  assert.equal(calls, 1);
});

test('mixed factual planning request explicitly requires a cited point followed by recall rather than a quiz selector', () => {
  const references = bank();
  const prompt = buildStudyDialoguePrompt({ references, evidence: references.retrieve('Study asthma'), conversation: { mode: 'coach', messages: turns }, settings: { dailyMinutes: 18, coachStyle: 'socratic', focus: 'exam' } });
  assert.match(prompt, /explicit request for a cited medical study point takes priority/);
  assert.match(prompt, /set questionId null and followup attempt-recall/);
  assert.match(prompt, /Use exactly the supplied IDs and enum spellings/);
});

async function appFixture(t, completion) {
  const dataDir = mkdtempSync(join(tmpdir(), 'fm-strict-output-'));
  let calls = 0;
  const curriculum = bank();
  const server = createApp({ dataDir, curriculum, foundations: createStudyCurriculum({ records: [], now: () => STUDY_NOW }), env: { OPENAI_API_KEY: 'mock-only', OPENAI_MODEL: 'gpt-4.1-mini' }, fetchImpl: async (_url, request) => {
    calls++; const body = JSON.parse(request.body);
    assert.equal(body.response_format.type, 'json_schema');
    assert.equal(body.response_format.json_schema.strict, true);
    assert.ok(body.max_completion_tokens > 0 && body.max_completion_tokens <= 1800);
    if (body.response_format.json_schema.name === 'family_medicine_natural_review') {
      const data = JSON.parse(body.messages.find(message => message.content.includes('NATURAL_REVIEW_DATA=')).content.split('NATURAL_REVIEW_DATA=')[1]);
      return reply(JSON.stringify({ approved: true, segments: data.candidate.map(segment => ({ id: segment.id, approved: true, externalFactCount: segment.sourceChunkIds.length ? 1 : 0, flags: [], claims: segment.sourceChunkIds.length ? [{ quote: segment.text, type: 'medical', sourceChunkIds: segment.sourceChunkIds, supports: segment.sourceChunkIds.map(chunkId => ({ chunkId, excerpt: data.sources.find(source => source.key === chunkId).text })) }] : [] })) }));
    }
    assert.equal(body.response_format.json_schema.name, 'family_medicine_natural_tutor');
    return reply(completion);
  } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); rmSync(dataDir, { recursive: true, force: true }); });
  const api = async (path, body) => { const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { Origin: base, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); return response.json(); };
  const conversation = await api('/api/conversations', { mode: 'coach', conditionId: 'asthma' });
  return { api, calls: () => calls, chat: requestId => api('/api/chat', { conversationId: conversation.id, content: 'Explain asthma management for board study.', requestId }) };
}

test('HTTP strict natural response retains canonical citations and replay avoids repeating either completion', async t => {
  const app = await appFixture(t, JSON.stringify({ segments: [{ id: 's1', text: 'Mock management fact: review inhaler technique.', sourceChunkIds: ['asthma:management'] }] }));
  const result = await app.chat('strict-valid');
  assert.equal(result.message.reviewedDialogue, true);
  assert.equal(result.message.groundingReview.status, 'passed');
  assert.equal(result.message.grounded, true);
  assert.equal(result.message.sourceVerified, false);
  assert.equal(result.message.studyRejection, undefined);
  assert.match(result.message.content, /Mock management fact: review inhaler technique/);
  assert.equal(result.message.citations[0].url, 'https://www.nhlbi.nih.gov/health/asthma');
  assert.equal((await app.chat('strict-valid')).message.id, result.message.id);
  assert.equal(app.calls(), 2);
});

test('malformed JSON or invented natural fields produce safe rejection codes without retaining raw model output or retrying', async t => {
  for (const [content, reasonId] of [['{LEAK_RAW_RESPONSE_SECRET', 400], [JSON.stringify({ segments: [{ id: 's1', text: 'LEAK_RAW_RESPONSE_SECRET', sourceChunkIds: ['asthma:invented-key'] }], coachText: 'LEAK_RAW_RESPONSE_SECRET' }), 201]]) {
    const app = await appFixture(t, content);
    const result = await app.chat(`bad-${reasonId}`);
    assert.equal(result.message.studyRejection.code, 'natural_tutor_validation');
    assert.equal(result.message.studyRejection.reasonId, reasonId);
    assert.equal(result.message.unsupported, true);
    assert.match(result.message.content, /have not used it/);
    assert.equal(result.message.reviewedDialogue, undefined);
    assert.deepEqual(result.message.citations, []);
    assert.doesNotMatch(JSON.stringify(await app.api('/api/state')), /LEAK_RAW_RESPONSE_SECRET|invented-key|invented-act/);
    assert.equal((await app.chat(`bad-${reasonId}`)).message.id, result.message.id);
    assert.equal(app.calls(), 1);
  }
});
