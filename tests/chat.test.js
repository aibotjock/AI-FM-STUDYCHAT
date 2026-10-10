import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createChatService } from '../server/chat.js';
import { createOpenAIProvider, consumeResponseStream } from '../server/provider.js';

const request = (turnId = 't1', extra = {}) => ({ conversationId: 'c1', turnId, attemptId: `${turnId}-a1`, input: 'Hello', ...extra });
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(t, provider, options = {}) {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON');
  const chat = createChatService({ db, provider, ...options });
  t.after(() => { chat.close(); db.close(); }); return { chat, db };
}
function streamed(events, chunkSize = 17) {
  const bytes = new TextEncoder().encode(events.map(event => typeof event === 'string' ? event : `event: ${event.type}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`).join(''));
  return new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize)); controller.close(); } });
}
const textDelta = delta => ({ type: 'response.output_text.delta', item_id: 'msg_123', output_index: 0, content_index: 0, delta, sequence_number: 1 });
const completed = (text, extra = {}) => ({ type: 'response.completed', sequence_number: 2, response: { status: 'completed', model: 'gpt-4.1-mini', output: [{ type: 'message', content: [{ type: 'output_text', text }] }], ...extra } });

test('empty-reference ordinary chat streams once, saves user first, and deduplicates stable IDs', async t => {
  let calls = 0, chat;
  const provider = { async generate({ messages, onDelta }) {
    calls++; assert.equal(chat.history('c1').turns[0].input, 'Hello');
    assert.equal(messages.at(-1).content, 'Hello'); assert.equal(messages.length, 2);
    onDelta('Hi '); onDelta('there.'); return { content: 'Hi there.', usage: { input_tokens: 10, output_tokens: 3 }, model: 'test' };
  } };
  ({ chat } = setup(t, provider));
  const events = [], result = await chat.submit(request(), event => events.push(event));
  assert.equal(result.status, 'completed'); assert.equal(calls, 1);
  assert.deepEqual(events.map(event => event.type), ['start','delta','delta','done']);
  assert.equal(result.sources.length, 0); assert.ok(result.firstTextMs >= 0);
  const duplicate = await chat.submit(request());
  assert.equal(duplicate.duplicate, true); assert.equal(calls, 1); assert.equal(chat.history('c1').turns.length, 1);
  await assert.rejects(chat.submit(request('t1', { input: 'Different' })), error => error.code === 'payload_mismatch');
});

test('a failed turn retries with a new attempt without duplicating its user message', async t => {
  let calls = 0;
  const { chat } = setup(t, { async generate() { calls++; if (calls === 1) throw new Error('secret provider details'); return { content: 'Recovered.' }; } });
  const failed = await chat.submit(request());
  assert.equal(failed.status, 'failed'); assert.doesNotMatch(failed.error, /secret/);
  const retry = await chat.submit(request('t1', { retry: true, attemptId: 't1-a2' }));
  assert.equal(retry.status, 'completed'); assert.equal(calls, 2);
  assert.equal(chat.history('c1').turns.length, 1); assert.equal(chat.history('c1').turns[0].attempts.length, 2);
  await chat.submit(request('t2', { input: 'Hello' }));
  assert.equal(chat.history('c1').turns.length, 2); assert.equal(calls, 3);
});

test('completed duplicate is saved; older failed retry is rejected after later conversation', async t => {
  const { chat } = setup(t, { async generate({ messages }) { if (messages.at(-1).content === 'Fail') throw new Error('failure'); return { content: 'Ok.' }; } });
  await chat.submit(request('t1', { input: 'Fail' })); await chat.submit(request('t2'));
  await assert.rejects(chat.submit(request('t1', { input: 'Fail', retry: true, attemptId: 'a-retry' })), error => error.code === 'older_retry');
  const done = await chat.submit(request('t2', { retry: true, attemptId: 'unneeded-retry' }));
  assert.equal(done.status, 'completed'); assert.equal(done.duplicate, true);
});

test('new submission cancels older request; ignored cancellation and stale deltas cannot overwrite it', async t => {
  let release, oldDelta, calls = 0;
  const { chat } = setup(t, { async generate({ onDelta }) {
    calls++; if (calls === 1) { oldDelta = onDelta; onDelta('Partial'); return new Promise(resolve => { release = resolve; }); }
    onDelta('New'); return { content: 'New' };
  } });
  const oldEvents = [], first = chat.submit(request(), event => oldEvents.push(event)); await tick();
  const duplicate = await chat.submit(request()); assert.equal(duplicate.status, 'running'); assert.equal(calls, 1);
  assert.equal((await chat.submit(request('t2'))).status, 'completed');
  assert.equal((await first).status, 'cancelled');
  oldDelta(' stale'); release({ content: 'Partial stale' }); await tick();
  const old = chat.history('c1').turns[0]; assert.equal(old.status, 'cancelled'); assert.equal(old.content, 'Partial');
  assert.equal(oldEvents.filter(event => ['done','error'].includes(event.type)).length, 1);
  assert.equal(chat.history('c1').turns[1].content, 'New');
});

test('empty provider output and ignored-signal timeout reach visible terminal outcomes', async t => {
  const { chat } = setup(t, { async generate() { return { content: '   ' }; } });
  const events = []; assert.equal((await chat.submit(request(), event => events.push(event))).code, 'empty_output');
  assert.equal(events.at(-1).type, 'error');
  const timed = setup(t, { async generate() { return new Promise(() => {}); } }, { config: { chatTimeoutMs: 15 } }).chat;
  const result = await timed.submit(request()); assert.equal(result.status, 'failed'); assert.equal(result.code, 'timeout'); assert.equal(timed.hasActiveWork(), false);
});

test('Stop wins once, excludes incomplete turns from model context, and terminal text is not rewritten', async t => {
  let calls = 0, delivered;
  const { chat } = setup(t, { async generate({ messages, onDelta }) {
    calls++; if (calls === 1) { onDelta('Partial text'); return new Promise(() => {}); }
    delivered = messages; return { content: 'Next answer.' };
  } });
  const controller = new AbortController(), first = chat.submit(request(), () => {}, { signal: controller.signal });
  await tick(); controller.abort(); assert.equal((await first).status, 'cancelled');
  await chat.submit(request('t2', { input: 'Next' }));
  assert.equal(delivered.length, 2); assert.ok(delivered.every(message => message.content !== 'Partial text'));
  assert.equal(chat.cancel({ conversationId: 'c1' }).cancelled, false);
});

test('restart interrupts unresolved saved work without a provider call or automatic resume', t => {
  let calls = 0;
  const { chat, db } = setup(t, { async generate() { calls++; return { content: 'Never' }; } });
  db.prepare('INSERT INTO chat_conversations VALUES (?,?,?,?)').run('saved','Saved',1,1);
  db.prepare('INSERT INTO chat_turns(turn_id,conversation_id,input,reference_ids,created_at) VALUES (?,?,?,?,?)').run('saved-turn','saved','Hi','[]',1);
  db.prepare('INSERT INTO chat_attempts(attempt_id,turn_id,status,content,started_at) VALUES (?,?,?,?,?)').run('saved-attempt','saved-turn','running','Partial',1);
  const restored = createChatService({ db, provider: { async generate() { calls++; } } });
  assert.equal(restored.history('saved').turns[0].status, 'interrupted'); assert.equal(calls, 0);
  assert.equal(chat.conversations().length, 1);
});

test('bounded completed history and safe host context do not load question or reference corpus', async t => {
  const seen = [], contexts = [];
  const { chat } = setup(t, { async generate({ messages }) { seen.push(messages); return { content: 'Answer' }; } }, {
    config: { maxHistoryMessages: 2 }, getContext: value => { contexts.push(value); return { preferences: { style: 'concise' }, pendingQuiz: { stem: 'Safe stem only', revealed: false } }; },
  });
  await chat.submit(request()); await chat.submit(request('t2')); await chat.submit(request('t3'));
  assert.equal(seen[2].length, 5); assert.equal(contexts[0].text, 'Hello');
  assert.doesNotMatch(JSON.stringify(seen), /correctChoice|medical-question-bank|catalogue\.json/);
});

test('saved history pages retain chronological order and do not repeat or lose turns', t => {
  const { chat, db } = setup(t, { async generate() { throw new Error('No provider request expected'); } });
  db.prepare('INSERT INTO chat_conversations VALUES (?,?,?,?)').run('history','History',1,1);
  const turn = db.prepare('INSERT INTO chat_turns(turn_id,conversation_id,input,created_at) VALUES (?,?,?,?)');
  const attempt = db.prepare('INSERT INTO chat_attempts(attempt_id,turn_id,status,content,started_at) VALUES (?,?,?,?,?)');
  db.exec('BEGIN');
  for (let i = 1; i <= 105; i++) { turn.run(`history-${i}`,'history',`Input ${i}`,i); attempt.run(`history-a-${i}`,`history-${i}`,'completed',`Reply ${i}`,i); }
  db.exec('COMMIT');
  const latest = chat.history('history'), older = chat.history('history', { beforeSeq: String(latest.page.beforeSeq) });
  assert.equal(latest.turns.length, 100); assert.equal(latest.turns[0].input, 'Input 6'); assert.equal(latest.turns.at(-1).input, 'Input 105');
  assert.equal(older.turns.length, 5); assert.equal(older.turns[0].input, 'Input 1'); assert.equal(older.page.hasOlder, false);
  assert.equal(new Set([...older.turns,...latest.turns].map(row => row.turnId)).size, 105);
  assert.throws(() => chat.history('history', { beforeSeq: 'bad' }));
});

test('canonical deterministic resolver shares saved path without another AI call', async t => {
  let paid = 0;
  const { chat } = setup(t, { async generate() { paid++; } }, { resolveTurn: ({ text }) => text === 'Reveal' ? { content: 'Canonical rationale.', label: 'Question sources', sources: [{ id: 'recorded-source' }] } : null });
  const result = await chat.submit(request('t1', { input: 'Reveal' }));
  assert.equal(paid, 0); assert.equal(result.status, 'completed'); assert.equal(result.label, 'Question sources');
});

test('backup round trip preserves legacy archive; imported answers cannot become trusted context or source badges', async t => {
  let messages;
  const { chat, db } = setup(t, { async generate(value) { messages = value.messages; return { content: 'Fresh answer.' }; } });
  await chat.submit(request()); const exported = chat.exportData();
  exported.legacyRecords = [{ id: 'original id', messages: [{ role: 'assistant', content: 'Old assistant-only record', evidenceStatus: 'historical' }] }];
  exported.attempts[0].sources = JSON.stringify([{ id: 'fake', label: 'Consulted source' }]);
  exported.attempts[0].model = 'historical-model'; exported.attempts[0].usage = '{"output_tokens":3}'; exported.attempts[0].total_ms = 400;
  db.exec('BEGIN'); chat.importData(exported); db.exec('COMMIT');
  assert.equal(chat.history('c1').turns[0].imported, true); assert.deepEqual(chat.history('c1').turns[0].sources, []);
  const historical = chat.history('c1').turns[0].historicalMetadata;
  assert.equal(historical.sources, exported.attempts[0].sources); assert.equal(historical.model, 'historical-model'); assert.equal(historical.total_ms, 400);
  db.exec('BEGIN'); chat.importData(chat.exportData()); db.exec('COMMIT');
  assert.deepEqual(chat.history('c1').turns[0].historicalMetadata, historical);
  assert.deepEqual(chat.exportData().legacyRecords, exported.legacyRecords);
  await chat.submit(request('t2')); assert.equal(messages.length, 2);
  const invalid = structuredClone(exported); invalid.turns[0].conversation_id = 'missing';
  assert.throws(() => chat.validateImport(invalid)); assert.equal(chat.history('c1').turns.length, 2);
});

test('Responses parser handles split UTF-8 SSE and requires actual completed event', async () => {
  const deltas = [];
  const result = await consumeResponseStream(streamed([textDelta('Héllo'),textDelta(' there.'),completed('Héllo there.', { usage: { input_tokens: 6, output_tokens: 3 } })], 1), { onDelta: delta => deltas.push(delta) });
  assert.equal(result.content, 'Héllo there.'); assert.equal(result.usage.output_tokens, 3); assert.equal(deltas.join(''), result.content);
  for (const [events, code] of [
    [[textDelta('Partial'),{ type: 'response.output_text.done', text: 'Partial' }], 'early_close'],
    [['data: broken\n\n'], 'malformed_stream'],
    [[completed('')], 'empty_output'],
    [[textDelta('Partial'),{ type: 'response.incomplete', response: { status: 'incomplete' } }], 'incomplete_response'],
    [[{ type: 'error', message: 'provider secret' }], 'provider_error'],
    [[textDelta('A'),completed('B')], 'malformed_stream'],
  ]) await assert.rejects(consumeResponseStream(streamed(events)), error => error.code === code);
});

test('direct provider sends one supported Responses request without tools or fallback', async () => {
  let calls = 0, body;
  const provider = createOpenAIProvider({ apiKey: 'test-secret', model: 'gpt-4.1-mini', fetchImpl: async (url, options) => {
    calls++; assert.equal(url, 'https://api.openai.com/v1/responses'); assert.equal(options.headers.Authorization, 'Bearer test-secret');
    body = JSON.parse(options.body); return new Response(streamed([textDelta('Ok'),completed('Ok')]), { headers: { 'content-type': 'text/event-stream' } });
  } });
  assert.equal((await provider.generate({ messages: [{ role: 'user', content: 'Hi' }] })).content, 'Ok');
  assert.equal(calls, 1); assert.equal(body.stream, true); assert.equal(body.store, false); assert.equal(body.tools, undefined);
  const noAI = createOpenAIProvider(); assert.equal(noAI.available, false);
  await assert.rejects(noAI.generate({ messages: [] }), error => error.code === 'ai_unavailable');
  assert.throws(() => createOpenAIProvider({ model: 'gpt-6-astra' }));
});
