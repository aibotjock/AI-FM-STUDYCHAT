import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceService, sanitizeVoiceEvents, VoiceError, VOICE_MODEL } from '../server/voice.js';

const offer = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=sendrecv\r\n';
const conversation = { id: 'study-voice-test', mode: 'coach', messages: [{ role: 'user', content: 'Help me practice fictional family medicine cases.' }] };
const config = { env: { OPENAI_API_KEY: 'server-test-key', AI_PROVIDER: 'openai' } };
const answer = () => new Response(offer, { status: 201, headers: { Location: '/v1/realtime/calls/rtc_test' } });

test('voice creates one fixed GA WebRTC session with bounded output and private server authorization', async () => {
  const calls = [];
  const service = createVoiceService({ ...config, fetchImpl: async (url, options) => { calls.push({ url, options }); return url.endsWith('/hangup') ? new Response(null, { status: 200 }) : answer(); } });
  const result = await service.createSession({ sdp: offer, conversation, settings: {}, ownerKey: 'test-owner' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.openai.com/v1/realtime/calls');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer server-test-key');
  assert.match(calls[0].options.headers['OpenAI-Safety-Identifier'], /^[a-f0-9]{64}$/);
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.body.get('sdp'), offer);
  const body = JSON.parse(calls[0].options.body.get('session'));
  assert.equal(body.model, VOICE_MODEL);
  assert.equal(body.type, 'realtime');
  assert.equal(body.max_output_tokens, 1024);
  assert.deepEqual(body.output_modalities, ['audio']);
  assert.equal(body.audio.input.turn_detection.interrupt_response, true);
  assert.equal(body.audio.input.turn_detection.create_response, true);
  assert.equal(body.audio.input.transcription.model, 'gpt-transcribe');
  assert.equal(body.truncation.token_limits.post_instructions, 8000);
  assert.deepEqual(body.tools, []);
  assert.equal(result.maxDurationSeconds, 600);
  assert.equal(result.model, VOICE_MODEL);
  assert(!JSON.stringify(result).includes('server-test-key'));
  assert(!JSON.stringify(result).includes('Bearer'));
  await service.closeAll();
});

test('voice rejects prohibited models, bad offers, missing key and invalid owners before any upstream call', async () => {
  let requests = 0;
  const fetchImpl = async () => { requests++; return answer(); };
  assert.throws(() => createVoiceService({ env: { OPENAI_VOICE_MODEL: 'blocked-astra-test' }, fetchImpl }), /Astra is prohibited/);
  assert.throws(() => createVoiceService({ env: { OPENAI_VOICE_MODEL: 'unverified-model' }, fetchImpl }), /supports only/);
  await assert.rejects(createVoiceService({ env: {}, fetchImpl }).createSession({ sdp: offer, conversation }), error => error instanceof VoiceError && error.status === 503);
  const service = createVoiceService({ ...config, fetchImpl });
  await assert.rejects(service.createSession({ sdp: 'not sdp', conversation }), /Invalid voice connection offer/);
  await assert.rejects(service.createSession({ sdp: offer + 'x'.repeat(65536), conversation }), /Invalid voice connection offer/);
  await assert.rejects(service.createSession({ sdp: offer, conversation, ownerKey: '../another-owner' }), /Invalid voice owner/);
  assert.equal(requests, 0);
});

test('voice blocks concurrent creation and scopes session lookup to its owner', async () => {
  let release;
  let requests = 0;
  const service = createVoiceService({ ...config, fetchImpl: async url => { requests++; if (url.endsWith('/hangup')) return new Response(null, { status: 200 }); await new Promise(resolve => { release = resolve; }); return answer(); } });
  const first = service.createSession({ sdp: offer, conversation, ownerKey: 'first' });
  await assert.rejects(service.createSession({ sdp: offer, conversation, ownerKey: 'first' }), error => error.status === 409);
  assert.equal(requests, 1);
  release(); const result = await first;
  assert.equal(service.validateSession(result.sessionId, 'first').conversationId, conversation.id);
  assert.throws(() => service.validateSession(result.sessionId, 'second'), error => error.status === 404);
  await assert.rejects(service.createSession({ sdp: offer, conversation, ownerKey: 'first' }), error => error.status === 409);
  await service.closeSession(result.sessionId, 'first');
});

test('voice provider failures are sanitized and never retry call creation', async () => {
  for (const status of [401, 403, 429, 500]) {
    let requests = 0;
    const service = createVoiceService({ ...config, fetchImpl: async () => { requests++; return new Response('sensitive upstream server-test-key error', { status }); } });
    await assert.rejects(service.createSession({ sdp: offer, conversation }), error => {
      assert(!error.message.includes('server-test-key')); assert(!error.message.includes('sensitive'));
      return error instanceof VoiceError && error.status === (status === 429 ? 429 : [401, 403].includes(status) ? 503 : 502);
    });
    assert.equal(requests, 1);
  }
});

test('voice validates SDP answers and never follows a provider-controlled hangup origin', async () => {
  const locations = ['https://attacker.example/v1/realtime/calls/rtc_test', '/v1/realtime/calls/../secret', '/v1/realtime/calls/rtc_test?key=hidden'];
  for (const location of locations) {
    const calls = [];
    const service = createVoiceService({ ...config, fetchImpl: async url => { calls.push(url); return new Response(offer, { status: 201, headers: { Location: location } }); } });
    await assert.rejects(service.createSession({ sdp: offer, conversation }), /invalid voice connection/);
    assert.deepEqual(calls, ['https://api.openai.com/v1/realtime/calls']);
  }
  const calls = [];
  const service = createVoiceService({ ...config, fetchImpl: async url => { calls.push(url); return url.endsWith('/hangup') ? new Response(null, { status: 200 }) : new Response('bad answer', { status: 201, headers: { Location: '/v1/realtime/calls/rtc_test' } }); } });
  await assert.rejects(service.createSession({ sdp: offer, conversation }), /invalid voice connection/);
  assert.equal(calls.length, 2); assert(calls[1].endsWith('/rtc_test/hangup'));
});

test('voice stop is idempotent while final caption grace is limited to five seconds', async () => {
  let clock = 10000;
  let hangups = 0, closed = 0;
  const service = createVoiceService({ ...config, now: () => clock, onSessionClosed: () => { closed++; }, fetchImpl: async url => { if (url.endsWith('/hangup')) { hangups++; return new Response(null, { status: 200 }); } return answer(); } });
  const result = await service.createSession({ sdp: offer, conversation });
  await service.closeSession(result.sessionId);
  assert.throws(() => service.validateSession(result.sessionId), error => error.status === 409);
  assert.equal(service.validateSession(result.sessionId, 'personal', { allowClosed: true }).closedAt, clock);
  clock += 5001;
  assert.throws(() => service.validateSession(result.sessionId, 'personal', { allowClosed: true }), /saving window has ended/);
  assert.equal((await service.closeSession(result.sessionId)).serverConfirmed, true);
  assert.equal(hangups, 1); assert.equal(closed, 1);
});

test('automatic expiry makes two bounded shutdown attempts and releases a failed shutdown lock', async () => {
  let timer, hangups = 0, closed = 0;
  const service = createVoiceService({ ...config, setTimer: callback => { timer = callback; return { unref() {} }; }, clearTimer() {}, onSessionClosed: () => { closed++; }, fetchImpl: async url => { if (url.endsWith('/hangup')) { hangups++; return new Response(null, { status: 500 }); } return answer(); } });
  const first = await service.createSession({ sdp: offer, conversation });
  timer(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(hangups, 2); assert.equal(closed, 1);
  assert(service.validateSession(first.sessionId, 'personal', { allowClosed: true }).closedAt);
  // An upstream shutdown problem does not deadlock this owner's local workspace.
  const second = await service.createSession({ sdp: offer, conversation });
  assert.notEqual(second.sessionId, first.sessionId);
  await service.closeAll();
});

test('voice transcript validation accepts only bounded text turns and strips untrusted metadata', () => {
  const output = sanitizeVoiceEvents([{ id: 'user_msg-one', role: 'user', content: '  My attempted answer.  ', usage: { total: 999 }, apiKey: 'never persisted' }, { id: 'assistant_msg-two', role: 'assistant', content: 'Consider one alternative.', interrupted: true }]);
  assert.deepEqual(output[0], { id: 'user_msg-one', role: 'user', content: 'My attempted answer.', interrupted: false });
  assert.equal(output[1].interrupted, true);
  for (const invalid of [[], new Array(21).fill({ id: 'x', role: 'user', content: 'x' }), [{ id: 'x', role: 'system', content: 'x' }], [{ id: 'x', role: 'user', content: '' }], [{ id: 'x', role: 'user', content: 'x'.repeat(12001) }], [{ id: 'same', role: 'user', content: 'x' }, { id: 'same', role: 'assistant', content: 'y' }]]) assert.throws(() => sanitizeVoiceEvents(invalid), VoiceError);
});
