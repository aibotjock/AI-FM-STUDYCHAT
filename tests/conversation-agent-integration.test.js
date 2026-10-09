import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { createApp } from '../server/index.js';
import { createStudyCurriculum } from '../server/study-curriculum.js';
import { studyCondition } from './fixtures/study-condition.js';

// Exercise shipped browser adapters and the actual app sendTurn/readout functions
// under Node with injected capture/playback. This is not browser or device QA.
const adapterPath = new URL('../public/conversation-agent-adapter.js', import.meta.url);
const runtimeUrl = pathToFileURL(new URL('../public/vendor/conversation-agent/index.js', import.meta.url).pathname).href;
const adapterText = readFileSync(adapterPath, 'utf8').replace("'/vendor/conversation-agent/index.js'", JSON.stringify(runtimeUrl));
const { createStudyConversationAgent } = await import('data:text/javascript;base64,' + Buffer.from(adapterText).toString('base64'));
const appText = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const callbackStart = appText.indexOf('sendTurn: async (');
const callbackEnd = appText.indexOf('\n  },\n});', callbackStart);
assert(callbackStart >= 0 && callbackEnd > callbackStart, 'Locate the shipped application host callback.');
const callbackText = appText.slice(callbackStart + 'sendTurn: '.length, callbackEnd + '\n  }'.length);
const readoutStart = appText.indexOf('function trustedStudySpeech(');
const readoutEnd = appText.indexOf('function renderMessage(', readoutStart);
const readoutText = appText.slice(readoutStart, readoutEnd);
const shippedCallback = new Function('api', 'state', 'currentConversationId', 'screen', 'render', readoutText + '\nreturn (' + callbackText + ');');
const waitFor = async predicate => {
  const until = Date.now() + 5000;
  while (!predicate()) { if (Date.now() >= until) throw new Error('Integration condition timed out.'); await new Promise(resolve => setTimeout(resolve, 5)); }
};

async function fixture(t, { holdTranscription = false, holdCheckpoint = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'fm-conversation-adapter-'));
  const providerCalls = [], apiCalls = [], outputs = [], states = [];
  let releaseTranscription, transcriptionEntered;
  const entered = new Promise(resolve => { transcriptionEntered = resolve; });
  const held = new Promise(resolve => { releaseTranscription = resolve; });
  const server = createApp({ dataDir: dir, curriculum: createStudyCurriculum({ records: [studyCondition()] }), foundations: createStudyCurriculum({ records: [] }), env: { STUDY_ACCESS_TOKEN: 'synthetic-conversation-adapter-access-token', OPENAI_API_KEY: 'synthetic-key-no-paid-calls', OPENAI_MODEL: 'gpt-4.1-mini' }, fetchImpl: async (url, options) => {
    providerCalls.push({ url, body: options.body });
    if (url === 'https://api.openai.com/v1/audio/transcriptions') {
      assert.equal(options.body.get('model'), 'gpt-4o-mini-transcribe');
      transcriptionEntered(); if (holdTranscription) await held;
      return Response.json({ text: 'Quiz me on asthma.' });
    }
    assert.equal(url, 'https://api.openai.com/v1/audio/speech');
    const input = JSON.parse(options.body);
    assert.equal(input.model, 'gpt-4o-mini-tts'); assert.equal(input.voice, 'marin');
    return new Response('ID3synthetic-checked-audio', { headers: { 'Content-Type': 'audio/mpeg' } });
  } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'synthetic-conversation-adapter-access-token' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const api = async (path, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    const item = { path, body, signal: options.signal };
    apiCalls.push(item);
    if (holdCheckpoint && path === '/api/conversation-agent/checkpoint') return new Promise((resolve, reject) => {
      assert(options.signal instanceof AbortSignal, 'The real adapter must forward its bounded checkpoint signal.');
      options.signal.addEventListener('abort', () => { item.aborted = true; reject(new DOMException('Synthetic stalled checkpoint aborted.', 'AbortError')); }, { once: true });
    });
    const response = await fetch(base + path, { ...options, headers: { Cookie: cookie, 'Content-Type': 'application/json', ...options.headers } });
    if (!response.ok) { const error = await response.json(); throw new Error(error.error); }
    if (path === '/api/voice/speech') return response;
    return response.json();
  };
  const conversation = await api('/api/conversations', { method: 'POST', body: JSON.stringify({ title: 'Synthetic adapter integration', mode: 'coach' }) });
  const state = await api('/api/state');
  const documentImpl = Object.assign(new EventTarget(), { hidden: false });
  const capture = { processors: [], tracks: [] };
  class AudioContextImpl {
    constructor() { this.sampleRate = 16000; this.destination = {}; }
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
    createScriptProcessor() { const processor = { connect() {}, disconnect() {} }; capture.processors.push(processor); return processor; }
  }
  const windowImpl = Object.assign(new EventTarget(), { isSecureContext: true, AudioContext: AudioContextImpl, crypto: { randomUUID } });
  const navigatorImpl = { mediaDevices: { async getUserMedia() {
    const track = { stopped: false, stop() { this.stopped = true; }, getSettings() { return { echoCancellation: true }; } };
    capture.tracks.push(track);
    return { getTracks: () => [track], getAudioTracks: () => [track] };
  } } };
  let currentPlayback = null;
  const playback = {
    async play(options) {
      const response = await api('/api/voice/speech', { method: 'POST', body: JSON.stringify({ conversationId: options.conversationId, messageId: options.messageId, voice: 'marin', chunkIndex: 0, requestId: randomUUID() }), signal: options.signal });
      assert((await response.arrayBuffer()).byteLength > 0);
      currentPlayback = { options, chunkCount: Number(response.headers.get('X-Study-Speech-Chunks')), completedChunks: 0 };
      outputs.push(currentPlayback); options.onPreparing?.({ chunkIndex: 0, chunkCount: currentPlayback.chunkCount }); options.onStart?.();
    },
    stop() { currentPlayback = null; },
    state() { return { chunkIndex: 0, completedChunks: currentPlayback?.completedChunks || 0 }; },
    complete() { const current = currentPlayback; current.completedChunks = current.chunkCount; current.options.onProgress?.({ completedChunks: current.chunkCount, currentChunk: 0 }); current.options.onChunkEnd?.({ completedChunks: current.chunkCount }); current.options.onEnd?.(); },
  };
  const agent = createStudyConversationAgent({ api, sendTurn: shippedCallback(api, state, conversation.id, 'coach', () => {}), speechPlayer: playback, onState: value => states.push(value), windowImpl, documentImpl, navigatorImpl });
  const frames = (amplitude, seconds) => {
    const processor = capture.processors.at(-1), samples = new Float32Array(2048);
    for (let index = 0; index < samples.length; index++) samples[index] = index % 2 ? amplitude : -amplitude;
    for (let count = 0; count < Math.ceil(seconds * 16000 / samples.length); count++) processor.onaudioprocess({ inputBuffer: { getChannelData: () => samples } });
  };
  t.after(async () => { releaseTranscription(); await agent.stop(); agent.destroy(); await server.closeVoiceSessions(); await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true }); });
  return { agent, frames, api, apiCalls, providerCalls, capture, outputs, states, conversation, entered, releaseTranscription, playback, server };
}

test('shipped StudyChat host and adapter bind capture, authenticated transcription, canonical reply identity, completed checkpoint and typed continuation', async t => {
  const app = await fixture(t); await app.agent.start({ conversationId: app.conversation.id });
  app.frames(0.1, 0.7); app.frames(0, 1.5); await waitFor(() => app.outputs.length === 1);
  const transcribe = app.apiCalls.find(item => item.path.endsWith('/transcribe'));
  assert.deepEqual(Object.keys(transcribe.body).sort(), ['audioBase64', 'conversationId', 'requestId', 'sessionId']);
  assert.equal(Buffer.from(transcribe.body.audioBase64, 'base64').subarray(0, 4).toString(), 'RIFF');
  const chat = app.apiCalls.find(item => item.path === '/api/chat');
  assert.equal(chat.body.voiceSessionId, transcribe.body.sessionId);
  assert.equal(chat.body.content, 'Quiz me on asthma.');
  assert.equal(app.agent.state().inputState, 'monitoring'); assert.equal(app.agent.state().outputState, 'playing');
  app.playback.complete(); await waitFor(() => app.apiCalls.some(item => item.path.endsWith('/checkpoint')));
  const checkpoint = app.apiCalls.find(item => item.path.endsWith('/checkpoint'));
  assert.equal(checkpoint.body.turnId, chat.body.requestId); assert.equal(checkpoint.body.complete, true);
  assert(checkpoint.signal instanceof AbortSignal);
  await app.agent.sendText('B'); await waitFor(() => app.outputs.length === 2);
  assert.equal(app.providerCalls.filter(item => item.url.endsWith('/audio/transcriptions')).length, 1, 'Typing must not be re-transcribed.');
  const stored = app.server.readOnlySnapshot().conversations.find(item => item.id === app.conversation.id);
  assert.equal(stored.messages[0].voiceTranscript, true);
  assert.equal(stored.messages[1].voicePlayback.status, 'completed');
  assert.equal(stored.messages.at(-1).studyAnswer.correct, true);
  await app.agent.stop(); await waitFor(() => app.apiCalls.some(item => item.path.endsWith('/session/end')));
  assert(app.capture.tracks.every(track => track.stopped));
});

test('actual adapter interruption cancels the active authenticated transcription ID and suppresses a late provider completion', async t => {
  const app = await fixture(t, { holdTranscription: true }); await app.agent.start({ conversationId: app.conversation.id });
  app.frames(0.1, 0.7); app.frames(0, 1.5); await app.entered;
  const transcribe = app.apiCalls.find(item => item.path.endsWith('/transcribe'));
  app.agent.interrupt(); await waitFor(() => app.apiCalls.some(item => item.path.endsWith('/cancel')));
  const cancel = app.apiCalls.find(item => item.path.endsWith('/cancel'));
  assert.equal(cancel.body.requestId, transcribe.body.requestId); assert.equal(cancel.body.sessionId, transcribe.body.sessionId);
  assert.equal(transcribe.signal.aborted, true);
  app.releaseTranscription(); await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(app.outputs.length, 0); assert.equal(app.apiCalls.filter(item => item.path === '/api/chat').length, 0);
  assert.equal(app.providerCalls.length, 1);
});

test('checkpoint AbortSignal crosses the real adapter and a stalled report cannot wedge the next authenticated typed turn', async t => {
  const app = await fixture(t, { holdCheckpoint: true }); await app.agent.start({ conversationId: app.conversation.id });
  app.frames(0.1, 0.7); app.frames(0, 1.5); await waitFor(() => app.outputs.length === 1);
  app.agent.interrupt();
  const next = app.agent.sendText('B');
  await waitFor(() => app.apiCalls.some(item => item.path.endsWith('/checkpoint')));
  const checkpoint = app.apiCalls.find(item => item.path.endsWith('/checkpoint'));
  assert(checkpoint.signal instanceof AbortSignal);
  assert.equal(checkpoint.body.complete, false); assert.equal(checkpoint.body.completedChunks, 0);
  await next; await waitFor(() => app.outputs.length === 2);
  assert.equal(checkpoint.signal.aborted, true);
  assert.equal(app.apiCalls.filter(item => item.path.endsWith('/checkpoint')).length, 1, 'No automatic checkpoint retry.');
  const stored = app.server.readOnlySnapshot().conversations.find(item => item.id === app.conversation.id);
  assert.equal(stored.messages[1].voicePlayback.status, 'pending');
  assert.equal(stored.messages[1].voicePlayback.presentedText, '');
});
