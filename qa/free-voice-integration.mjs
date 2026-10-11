import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { buildApplication } from '../server/bootstrap.js';
import { loadConfig } from '../server/config.js';
import { encodePcmWav, resampleMono } from '../packages/conversation-agent/src/browser-audio.js';

// Executes real local speech models, with a fixture answering model and temporary data.
// No OpenAI/Anthropic API calls, production credentials or learner records are used.
const speechOrigin = process.env.SPEECH_SERVICE_URL;
const speechToken = process.env.SPEECH_SERVICE_TOKEN_FILE ? readFileSync(process.env.SPEECH_SERVICE_TOKEN_FILE, 'utf8').trim() : process.env.SPEECH_SERVICE_TOKEN;
if (!speechOrigin || !speechToken) throw new Error('Set SPEECH_SERVICE_URL and SPEECH_SERVICE_TOKEN_FILE (or SPEECH_SERVICE_TOKEN) for the running private speech worker.');
const allVoices = process.env.REAL_VOICE_ALL_VOICES === '1';
const originalFetch = globalThis.fetch, workerCalls = { health: 0, transcribe: 0, speech: 0 };
globalThis.fetch = (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith(`${speechOrigin}/`)) {
    const endpoint = new URL(url).pathname.slice(1);
    if (Object.hasOwn(workerCalls, endpoint)) workerCalls[endpoint]++;
  }
  return originalFetch(input, init);
};
const greeting = 'Hello. I would like to study today.';
const savedAnswer = 'Welcome. Your speech was recognized. We can continue your study session.';
const dataDir = mkdtempSync(`${tmpdir()}/studychat-real-speech-`);
const ownerToken = randomUUID(), conversationId = randomUUID();
const selections = [], checks = [], synthesis = [];
const model = { id: 'claude-haiku-5-5', provider: 'anthropic', label: 'Fixture Claude selection', tier: 'standard', available: true };
const provider = {
  available: true,
  async catalogue() { return { providers: [{ id: 'anthropic', label: 'Anthropic fixture', configured: true }], models: [model] }; },
  async resolveSelection(selection) { assert.deepEqual(selection, { provider: model.provider, model: model.id }); return selection; },
  async generate({ selection, onDelta, signal }) {
    signal.throwIfAborted(); selections.push({ ...selection }); onDelta(savedAnswer);
    return { content: savedAnswer, model: selection.model, provider: selection.provider };
  }
};
const app = buildApplication({ config: loadConfig({ HOST: '127.0.0.1', PORT: '0', DATA_DIR: dataDir, STUDY_ACCESS_TOKEN: ownerToken, SPEECH_SERVICE_URL: speechOrigin, SPEECH_SERVICE_TOKEN: speechToken }), provider });
let origin, headers, worker, workerLog = '';
const post = (path, body) => fetch(origin + path, { method: 'POST', headers, body: JSON.stringify(body) });
async function json(response, expected = 200) { assert.equal(response.status, expected); return response.json(); }
function pcmWave(audio, rate = 24000) {
  assert.ok(audio.length > 44); assert.equal(audio.subarray(0, 4).toString(), 'RIFF'); assert.equal(audio.subarray(8, 12).toString(), 'WAVE');
  assert.equal(audio.readUInt32LE(4), audio.length - 8); assert.equal(audio.subarray(12, 16).toString(), 'fmt ');
  assert.equal(audio.readUInt16LE(20), 1); assert.equal(audio.readUInt16LE(22), 1); assert.equal(audio.readUInt32LE(24), rate);
  assert.equal(audio.readUInt16LE(34), 16); assert.equal(audio.subarray(36, 40).toString(), 'data'); assert.equal(audio.readUInt32LE(40), audio.length - 44);
  const samples = new Float32Array((audio.length - 44) / 2);
  for (let index = 0; index < samples.length; index++) samples[index] = audio.readInt16LE(44 + index * 2) / 32768;
  assert.ok(samples.some(value => Math.abs(value) > 0.001), 'Speech must contain non-silent samples.');
  return samples;
}

try {
  if (process.env.SPEECH_PYTHON_EXECUTABLE) {
    if (!process.env.SPEECH_MODELS_DIR) throw new Error('Set SPEECH_MODELS_DIR to the downloaded models when starting a worker.');
    const workerUrl = new URL(speechOrigin);
    assert.ok(['127.0.0.1', 'localhost'].includes(workerUrl.hostname));
    const python = process.env.SPEECH_PYTHON_EXECUTABLE, script = new URL('../services/speech/service.py', import.meta.url).pathname;
    const args = [script], affinity = process.env.SPEECH_CPU_AFFINITY;
    if (affinity) assert.match(affinity, /^[0-9,-]{1,40}$/);
    worker = spawn(affinity ? 'taskset' : python, affinity ? ['-c', affinity, python, ...args] : args, {
      env: { ...process.env, HOST: workerUrl.hostname, PORT: workerUrl.port || '8081', MODELS_DIR: process.env.SPEECH_MODELS_DIR, SPEECH_SERVICE_TOKEN: speechToken, OMP_NUM_THREADS: '2', OPENBLAS_NUM_THREADS: '2', NUMBA_NUM_THREADS: '2' },
      stdio: ['ignore', 'ignore', 'pipe']
    });
    worker.stderr.on('data', chunk => { workerLog = (workerLog + chunk.toString()).slice(-8192); });
    let ready = false;
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      if (worker.exitCode !== null) throw new Error(`Speech worker stopped before readiness (${worker.exitCode}).`);
      try {
        const response = await fetch(`${speechOrigin}/health`, { signal: AbortSignal.timeout(3000) });
        const health = await response.json();
        if (response.ok && health.ready === true) { ready = true; break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.equal(ready, true, 'Actual speech worker must become ready.');
  }
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${app.server.address().port}`;
  const login = await fetch(`${origin}/api/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: ownerToken }) });
  await json(login); headers = { Origin: origin, 'Content-Type': 'application/json', Cookie: login.headers.get('set-cookie').split(';')[0] };
  const options = await json(await fetch(`${origin}/api/voice`, { headers }));
  assert.equal(options.enabled, true); assert.equal(options.provider, 'self-hosted'); assert.equal(options.transcriptionModel, 'small.en'); assert.equal(options.speechModel, 'kokoro-v1.0');
  assert.equal(options.voices.length, 5);
  assert.equal((await fetch(`${origin}/api/voice`)).status, 401);
  checks.push('authenticated Node readiness validates actual loaded speech models and five local voices; unauthenticated app access is rejected');
  await json(await post('/api/settings', { actionId: randomUUID(), aiProvider: model.provider, aiModel: model.id }));
  const session = await json(await post('/api/voice/start', { conversationId }));
  assert.ok(session.sessionId);

  const fixtureAudio = process.env.REAL_VOICE_INPUT_WAV;
  let recognitionAudio;
  if (fixtureAudio) {
    recognitionAudio = readFileSync(fixtureAudio); pcmWave(recognitionAudio, 16000);
  } else {
    const greetingResponse = await fetch(`${speechOrigin}/speech`, { method: 'POST', headers: { Authorization: `Bearer ${speechToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: greeting, voice: options.defaultVoice }), signal: AbortSignal.timeout(90000) });
    assert.equal(greetingResponse.status, 200); const samples = pcmWave(Buffer.from(await greetingResponse.arrayBuffer()));
    recognitionAudio = Buffer.from(await encodePcmWav(resampleMono(samples, 24000), 16000).arrayBuffer());
  }
  const requestId = randomUUID(), started = performance.now();
  const utterance = { conversationId, sessionId: session.sessionId, requestId, audioBase64: recognitionAudio.toString('base64') };
  const transcript = await json(await post('/api/voice/transcribe', utterance));
  const transcriptionMs = Math.round(performance.now() - started);
  assert.match(transcript.text, /study/i);
  const callsAfterTranscription = workerCalls.transcribe;
  const repeatedTranscript = await json(await post('/api/voice/transcribe', utterance));
  assert.equal(repeatedTranscript.cached, true); assert.equal(repeatedTranscript.text, transcript.text);
  assert.equal(workerCalls.transcribe, callsAfterTranscription);
  checks.push('actual Whisper recognizes a synthetic study greeting through the authenticated app; repeating its utterance ID reuses the saved transcript');

  const turnId = randomUUID(), attemptId = randomUUID();
  const streamed = await post('/api/chat', { conversationId, turnId, attemptId, input: transcript.text });
  assert.equal(streamed.status, 200); assert.match(streamed.headers.get('content-type'), /text\/event-stream/);
  const events = (await streamed.text()).split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
  assert.equal(events.at(-1).status, 'completed'); assert.equal(events.at(-1).content, savedAnswer);
  assert.equal(selections.length, 1); assert.deepEqual(selections[0], { provider: model.provider, model: model.id });
  assert.equal(app.chat.history(conversationId).turns[0].content, savedAnswer);
  checks.push('one recognized utterance produces one saved Coach answer using the selected Anthropic fixture; no paid answering-model call occurs');

  for (const voice of allVoices ? options.voices : [options.defaultVoice]) {
    const speechRequest = { conversationId, messageId: attemptId, requestId: randomUUID(), voice, input: 'This browser text must not replace the saved reply.' };
    const speechStarted = performance.now(), response = await post('/api/voice/speech', speechRequest);
    assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /^audio\/wav/);
    const audio = Buffer.from(await response.arrayBuffer()), samples = pcmWave(audio);
    const latencyMs = Math.round(performance.now() - speechStarted);
    const callsAfterSpeech = workerCalls.speech;
    const repeat = await post('/api/voice/speech', speechRequest); assert.equal(repeat.status, 200);
    assert.deepEqual(Buffer.from(await repeat.arrayBuffer()), audio);
    assert.equal(workerCalls.speech, callsAfterSpeech);
    const entry = app.store.db.prepare('SELECT status, metadata FROM speech_requests WHERE request_id=?').get(speechRequest.requestId);
    assert.equal(entry.status, 'complete'); const metadata = JSON.parse(entry.metadata);
    assert.equal(metadata.provider, 'self-hosted'); assert.equal(metadata.voice, voice); assert.equal(metadata.paidRequest, false); assert.equal(metadata.estimatedCostUsd, 0);
    synthesis.push({ voice, bytes: audio.length, sampleRate: 24000, channels: 1, sampleBits: 16, durationSeconds: Number((samples.length / 24000).toFixed(2)), latencyMs, cachedReplayIdentical: true });
  }
  assert.equal(selections.length, 1);
  checks.push('actual Kokoro synthesizes the saved answer through Node; cached replay is byte-identical and creates no additional answering-model attempt');
  const ended = await json(await post('/api/voice/end', { conversationId, sessionId: session.sessionId }));
  assert.equal(ended.ended, true);
  checks.push('ending the app voice session releases its server-side session');

  const result = { checkedAt: new Date().toISOString(), speechStack: 'Whisper + Kokoro + Pipecat', realSpeechModels: true, mockedAnsweringModel: true, microphone: 'synthetic speech fixture', physicalPhoneTested: false, deployedToRailway: false, actualPaidRequests: 0, workerCalls, transcription: { text: transcript.text, latencyMs: transcriptionMs, inputBytes: recognitionAudio.length, cachedReplay: true }, answeringModelSelections: selections, synthesis, checks };
  if (process.env.REAL_VOICE_RESULTS) writeFileSync(process.env.REAL_VOICE_RESULTS, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(JSON.stringify({ failure: error.message, workerLog, actualPaidRequests: 0 }));
  throw error;
} finally {
  await app.shutdown(); rmSync(dataDir, { recursive: true, force: true }); globalThis.fetch = originalFetch;
  if (worker && worker.exitCode === null) {
    worker.kill('SIGTERM');
    await new Promise(resolve => { const timer = setTimeout(() => worker.kill('SIGKILL'), 15000); worker.once('exit', () => { clearTimeout(timer); resolve(); }); });
  }
}
