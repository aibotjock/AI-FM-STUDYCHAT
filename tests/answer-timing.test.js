import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.js';
import { answerTimingText } from '../shared/answer-timing.js';

const message = { ai: { endpoint: 'chat', latencyMs: 2100 }, aiReview: { endpoint: 'chat', latencyMs: 3600 } };

test('saved author and reviewer durations remain distinguishable without implying speech timing', () => {
  assert.equal(answerTimingText(message), 'Writing 2.1 s · Checking 3.6 s');
  assert.equal(answerTimingText({ ai: { latencyMs: 0 }, aiReview: { latencyMs: 0 } }), 'Writing 0.0 s · Checking 0.0 s');
  assert.doesNotMatch(answerTimingText(message), /audio|verified|first token/i);
});

test('the browser timing module is served and included in the installed app shell', async t => {
  const dataDir = mkdtempSync(join(tmpdir(), 'fm-answer-timing-'));
  const server = createApp({ dataDir, env: {}, fetchImpl: async () => { throw new Error('No provider request allowed.'); } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await server.closeVoiceSessions(); await new Promise(resolve => server.close(resolve)); rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const dependency = await fetch(base + '/shared/answer-timing.js');
  assert.equal(dependency.status, 200);
  assert.match(dependency.headers.get('content-type'), /javascript/);
  assert.match(await dependency.text(), /export function answerTimingText/);
  const worker = await (await fetch(base + '/sw.js')).text();
  assert.match(worker, /'\/shared\/answer-timing\.js'/);
});

test('missing, imported, client-reported and invalid timings never become measured stage labels', () => {
  for (const value of [null, {}, { ai: message.ai }, { ...message, importedEvidence: true },
    { ...message, ai: { ...message.ai, imported: true } }, { ...message, aiReview: { ...message.aiReview, clientReported: true } },
    { ...message, ai: { ...message.ai, endpoint: 'realtime' } },
    ...[null, '100', -1, NaN, Infinity, 86400001].map(latencyMs => ({ ...message, aiReview: { latencyMs } }))]) {
    assert.equal(answerTimingText(value), '');
  }
});
