import { createApp } from '../server/index.js';
import { createStudyCurriculum } from '../server/study-curriculum.js';
import { studyCondition } from '../tests/fixtures/study-condition.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// Actual local application routes with injected microphone, media and provider
// traffic. These checks establish wiring, not real-device echo or audibility.
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dir = mkdtempSync(join(tmpdir(), 'fm-conversation-agent-'));
const token = 'conversation-agent-local-synthetic-qa-token';
const results = [], errors = [], consoleErrors = [], requests = [], providerCalls = [];
const transcripts = [];
let lastDraft = [], rejectNext = false, holdAuthor = false, releaseAuthor = null;
const sourceContext = (body, marker) => {
  const prompt = body.messages.find(item => item.role === 'system' && item.content.includes(marker))?.content;
  assert(prompt, `Missing synthetic provider prompt marker: ${marker}`);
  return JSON.parse(prompt.slice(prompt.lastIndexOf(marker) + marker.length));
};
let scopeDir = join(dir, 'initial');
const fixture = () => createApp({
  dataDir: scopeDir,
  curriculum: createStudyCurriculum({ records: [studyCondition()] }),
  foundations: createStudyCurriculum({ records: [] }),
  env: { STUDY_ACCESS_TOKEN: token, OPENAI_API_KEY: 'mock-only-conversation-agent', OPENAI_MODEL: 'gpt-4.1-mini' },
  fetchImpl: async (url, options) => {
    providerCalls.push({ endpoint: url, mocked: true });
    if (url === 'https://api.openai.com/v1/models') return Response.json({ data: [{ id: 'gpt-4.1-mini', object: 'model' }] });
    if (url === 'https://api.openai.com/v1/audio/transcriptions') {
      const data = options.body;
      assert.equal(data.get('model'), 'gpt-4o-mini-transcribe');
      assert(data.get('file').size > 44, 'The real bridge must upload bounded WAV audio.');
      return Response.json({ text: transcripts.shift() || 'I would like to talk about studying.', usage: { type: 'tokens', input_tokens: 10, output_tokens: 8, total_tokens: 18 } });
    }
    const body = JSON.parse(options.body);
    if (url === 'https://api.openai.com/v1/audio/speech') {
      assert.equal(body.model, 'gpt-4o-mini-tts');
      providerCalls.at(-1).voice = body.voice;
      providerCalls.at(-1).text = body.input;
      return new Response('ID3synthetic-audio-no-physical-sound', { headers: { 'Content-Type': 'audio/mpeg' } });
    }
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    let reply;
    if (body.messages.some(item => item.role === 'system' && item.content.includes('NATURAL_TUTOR_CONTEXT='))) {
      const context = sourceContext(body, 'NATURAL_TUTOR_CONTEXT=');
      providerCalls.at(-1).history = context.history;
      const latest = context.latest || context.latestUser || body.messages.findLast(item => item.role === 'user')?.content || '';
      rejectNext = /reject fixture/i.test(latest);
      lastDraft = [{ id: 's1', text: rejectNext ? 'Synthetic unverified teaching fixture.' : 'We can work at your pace. Tell me what you would like to practice.', sourceChunkIds: [] }];
      if (holdAuthor) { holdAuthor = false; await new Promise(resolve => { releaseAuthor = resolve; }); }
      reply = { segments: lastDraft };
    } else {
      assert.equal(body.response_format.json_schema.name, 'family_medicine_natural_review_v2');
      sourceContext(body, 'NATURAL_REVIEW_DATA=');
      reply = { version: 2, approved: !rejectNext, segments: lastDraft.map(segment => ({ id: segment.id, approved: !rejectNext, externalFactCount: 0, claims: [], flags: rejectNext ? ['unsupported_fact'] : [] })) };
    }
    return Response.json({ model: 'gpt-4.1-mini', usage: { prompt_tokens: 20, completion_tokens: 15 }, choices: [{ message: { content: JSON.stringify(reply) } }] });
  },
});
let server = fixture();
server.listen(0, '127.0.0.1');
await once(server, 'listening');
let base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
await context.addInitScript(() => {
  window.__qaCapture = { tracks: [], processors: [], contexts: [], requests: [], denied: false };
  const qa = window.__qaCapture;
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
    async getUserMedia(constraints) {
      qa.requests.push(constraints);
      if (qa.denied) throw Object.assign(new Error('Synthetic permission denial'), { name: 'NotAllowedError' });
      const track = { kind: 'audio', readyState: 'live', enabled: true, stopped: false, stop() { this.stopped = true; this.readyState = 'ended'; }, getSettings() { return { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: 16000 }; } };
      qa.tracks.push(track);
      return { getTracks: () => [track], getAudioTracks: () => [track] };
    },
    getSupportedConstraints() { return { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: true, sampleRate: true }; },
  } });
  class FakeAudioContext {
    constructor() { this.sampleRate = 16000; this.currentTime = 0; this.state = 'running'; this.destination = {}; qa.contexts.push(this); }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createScriptProcessor() { const node = { connect() {}, disconnect() {}, onaudioprocess: null }; qa.processors.push(node); return node; }
    createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
  }
  Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext });
  Object.defineProperty(window, 'webkitAudioContext', { configurable: true, value: FakeAudioContext });
  Object.defineProperty(window, 'AudioWorkletNode', { configurable: true, value: undefined });
  class FakeEmitter {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(listener); }
    removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
    emit(type) { for (const listener of [...(this.listeners.get(type) || [])]) listener({ type }); }
  }
  window.__qaStreams = [];
  class FakeMediaSource extends FakeEmitter {
    constructor() { super(); this.readyState = 'closed'; this.chunks = []; window.__qaStreams.push(this); }
    static isTypeSupported(value) { return value === 'audio/mpeg'; }
    addSourceBuffer() {
      const source = new FakeEmitter();
      source.appendBuffer = value => { this.chunks.push(value.byteLength); setTimeout(() => source.emit('updateend'), 0); };
      return source;
    }
    endOfStream() { this.readyState = 'ended'; }
  }
  window.MediaSource = FakeMediaSource;
  const originalObjectUrl = URL.createObjectURL.bind(URL);
  URL.createObjectURL = value => {
    if (!(value instanceof FakeMediaSource)) return originalObjectUrl(value);
    setTimeout(() => { value.readyState = 'open'; value.emit('sourceopen'); }, 0);
    return 'blob:synthetic-conversation-stream-' + window.__qaStreams.length;
  };
  window.__qaFrames = (amplitude, seconds) => {
    const node = qa.processors.at(-1);
    if (!node?.onaudioprocess) throw new Error('No active synthetic capture processor.');
    const frame = new Float32Array(2048);
    for (let index = 0; index < frame.length; index++) frame[index] = index % 2 ? amplitude : -amplitude;
    for (let count = 0; count < Math.ceil(seconds * 16000 / frame.length); count++) {
      qa.contexts.at(-1).currentTime += frame.length / 16000;
      node.onaudioprocess({ inputBuffer: { numberOfChannels: 1, getChannelData: () => frame }, outputBuffer: { getChannelData: () => new Float32Array(2048) }, playbackTime: qa.contexts.at(-1).currentTime });
    }
  };
  window.__qaAudio = [];
  window.Audio = class {
    constructor(url) { this.url = url; this.currentTime = 0; this.duration = 9; this.paused = true; this.volume = 1; this.muted = false; window.__qaAudio.push(this); }
    async play() { this.plays = (this.plays || 0) + 1; this.paused = false; this.isPlaying = true; this.onplaying?.(); }
    pause() { this.pauses = (this.pauses || 0) + 1; this.paused = true; this.isPlaying = false; this.onpause?.(); }
    removeAttribute() {}
    load() {}
  };
  window.SpeechRecognition = class { start() { throw new Error('The new voice session must not silently use browser dictation.'); } };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { cancel() {}, speak() { throw new Error('The new voice session must not use device speech synthesis.'); } } });
});
const page = await context.newPage();
page.setDefaultTimeout(10000);
page.on('pageerror', error => errors.push(error.message));
page.on('console', item => { if (item.type() === 'error') consoleErrors.push(item.text()); });
page.on('request', request => {
  if (request.url().startsWith(base + '/api/')) {
    const body = request.postDataJSON();
    const { audioBase64, ...metadata } = body || {};
    requests.push({ path: new URL(request.url()).pathname, method: request.method(), streamRequested: request.headers()['x-study-speech-stream'] === '1', ...(body ? { body: metadata, ...(audioBase64 ? { audioEncodedBytes: audioBase64.length } : {}) } : {}) });
  }
});
const action = name => page.locator(`[data-action="${name}"]:visible`).first().click();
const state = async () => (await context.request.get(base + '/api/state')).json();
const speechCalls = () => providerCalls.filter(item => item.endpoint.endsWith('/audio/speech'));
const liveTracks = () => page.evaluate(() => window.__qaCapture.tracks.filter(track => !track.stopped).length);
const frames = (amplitude, seconds) => page.evaluate(({ amplitude, seconds }) => window.__qaFrames(amplitude, seconds), { amplitude, seconds });
async function start() { await page.locator('#conversation-circle .voice-orb').click(); await page.waitForFunction(() => window.__qaCapture.processors.at(-1)?.onaudioprocess && window.__qaCapture.tracks.some(track => !track.stopped)); }
async function utterance(text) { transcripts.push(text); await frames(0.12, 0.7); await frames(0, 1.5); }
async function playing() { await page.waitForFunction(() => window.__qaAudio.at(-1)?.isPlaying === true); }
async function fresh() {
  assert.equal((await context.request.post(base + '/api/login', { data: { token } })).status(), 200);
  const response = await context.request.post(base + '/api/conversations', { data: { title: `Conversation Agent QA ${crypto.randomUUID()}`, mode: 'coach' } });
  assert.equal(response.status(), 201);
  await page.goto(base + '/?qa=' + crypto.randomUUID() + '#coach');
  await page.locator('#chat-input').waitFor();
  await page.locator('#conversation-circle .voice-orb').waitFor();
}
const only = process.env.QA_SCOPES ? new Set(process.env.QA_SCOPES.split(',').map(Number)) : null;
let scope = 0;
async function check(name, run) {
  const index = scope++;
  if (only && !only.has(index)) return;
  try {
    // Isolate actual session limits instead of weakening them for a large QA run.
    await page.goto('about:blank');
    releaseAuthor?.(); releaseAuthor = null; holdAuthor = false; transcripts.length = 0;
    await server.closeVoiceSessions?.();
    await new Promise(resolve => server.close(resolve));
    scopeDir = join(dir, `scope-${index}`);
    server = fixture();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
    await run();
    const geometry = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth }));
    assert(geometry.width <= geometry.viewport, `Mobile overflow: ${JSON.stringify(geometry)}`);
    results.push({ scope: index, name, pass: true });
    console.log(JSON.stringify(results.at(-1)));
  } catch (error) {
    results.push({ scope: index, name, pass: false, error: error.stack, visible: (await page.locator('#main').textContent().catch(() => '')).slice(-1600) });
    console.log(JSON.stringify({ scope: index, name, pass: false, error: error.message }));
  }
}

try {
  await check('original central circle supports keyboard start, five preserved voices, reduced motion and explicit echo-cancel capture', async () => {
    await fresh();
    assert.deepEqual(await page.locator('#coach-voice option').evaluateAll(items => items.map(item => item.value)), ['marin', 'cedar', 'coral', 'sage', 'ash']);
    assert.equal(await page.locator('#coach-voice').inputValue(), 'marin');
    const orb = page.locator('#conversation-circle .voice-orb');
    assert.equal(await orb.getAttribute('type'), 'button');
    assert.equal(await orb.getAttribute('aria-pressed'), 'false');
    await orb.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__qaCapture.tracks.some(track => !track.stopped));
    assert.equal(await orb.getAttribute('aria-pressed'), 'true');
    assert.equal(await liveTracks(), 1);
    const requested = await page.evaluate(() => window.__qaCapture.requests.at(-1));
    assert.equal(requested.audio.echoCancellation, true);
    assert.equal(await page.locator('#conversation-circle .voice-status').getAttribute('role'), 'status');
    assert.equal(await page.locator('#conversation-circle .voice-status').getAttribute('aria-live'), 'polite');
    assert.equal(await page.locator('#conversation-circle .conversation-voice-circle').getAttribute('data-reduced-motion'), 'true');
    await action('voice-stop');
    assert.equal(await liveTracks(), 0);
  });
  await check('complete utterance uses authenticated OpenAI transcription once; approved premium playback leaves capture active', async () => {
    await fresh(); await start();
    const before = requests.length;
    await utterance('I would like to talk about studying.'); await playing();
    const current = requests.slice(before);
    assert.equal(current.filter(item => item.path === '/api/conversation-agent/transcribe').length, 1);
    assert.equal(current.filter(item => item.path === '/api/chat').length, 1);
    assert.equal(current.filter(item => item.path === '/api/voice/speech').length, 1);
    const speech = current.find(item => item.path === '/api/voice/speech');
    assert.equal(speech.streamRequested, true);
    assert(await page.evaluate(() => window.__qaStreams.at(-1).chunks.length > 0), 'Approved audio must reach the streaming playback adapter.');
    assert.deepEqual(Object.keys(speech.body).sort(), ['chunkIndex', 'conversationId', 'messageId', 'requestId', 'voice']);
    assert.equal(await liveTracks(), 1, 'The new conversation must keep input active during approved output.');
    assert.equal(await page.locator('.message.assistant .message-text').last().textContent(), speechCalls().at(-1).text);
    const last = (await state()).conversations.find(item => item.id === speech.body.conversationId).messages.at(-1);
    assert.equal(last.voicePlayback.status, 'pending');
    assert.equal(last.voicePlayback.presentedText, '');
    const checkpoint = page.waitForResponse(response => response.url() === base + '/api/conversation-agent/checkpoint' && response.request().postDataJSON()?.complete === true);
    await page.evaluate(() => { const audio = window.__qaAudio.at(-1); audio.isPlaying = false; audio.onended?.(); });
    assert.equal((await checkpoint).status(), 200);
    const complete = (await state()).conversations.find(item => item.id === speech.body.conversationId).messages.at(-1);
    assert.equal(complete.voicePlayback.status, 'completed');
    assert.equal(complete.voicePlayback.completedChunks, complete.voicePlayback.chunkCount);
    assert.equal(complete.voicePlayback.presentedText, speechCalls().at(-1).text);
    assert.equal(await liveTracks(), 1);
    await action('voice-stop'); assert.equal(await liveTracks(), 0);
  });
  await check('hands-free speech onset stops playback locally before another transcript is uploaded; duplicate frame completion does not submit twice', async () => {
    await fresh(); await start();
    await utterance('I would like to discuss my study plans.'); await playing();
    const before = requests.filter(item => item.path === '/api/conversation-agent/transcribe').length;
    await page.evaluate(() => { window.__qaOldAudio = window.__qaAudio.at(-1); window.__qaOldAudio.currentTime = 2; window.__qaOldCallbacks = { ended: window.__qaOldAudio.onended, playing: window.__qaOldAudio.onplaying }; });
    transcripts.push('Please explain that more slowly.');
    await frames(0.18, 0.5);
    assert.equal(await page.evaluate(() => window.__qaOldAudio.isPlaying), false);
    assert.equal(requests.filter(item => item.path === '/api/conversation-agent/transcribe').length, before);
    await page.evaluate(() => { window.__qaOldCallbacks.ended?.call(window.__qaOldAudio); window.__qaOldCallbacks.playing?.call(window.__qaOldAudio); });
    assert.equal(await page.evaluate(() => window.__qaOldAudio.plays), 1, 'Late callbacks must not restart old audio.');
    await frames(0, 1.5); await playing();
    await frames(0, 2);
    assert.equal(requests.filter(item => item.path === '/api/conversation-agent/transcribe').length, before + 1);
    assert.equal(requests.filter(item => item.path === '/api/chat').at(-1).body.content, 'Please explain that more slowly.');
    await action('voice-stop');
  });
  await check('mute stops capture and unmute reacquires it; navigation and backgrounding shut microphone down', async () => {
    await fresh(); await start();
    await action('voice-mute');
    await page.waitForFunction(() => window.__qaCapture.tracks.every(track => track.stopped));
    assert.equal(await liveTracks(), 0);
    await action('voice-mute');
    await page.waitForFunction(() => window.__qaCapture.tracks.some(track => !track.stopped));
    assert.equal(await liveTracks(), 1);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    assert.equal(await liveTracks(), 0);
    await fresh(); await start(); await action('settings');
    assert.equal(await liveTracks(), 0, 'Opening another workspace must close capture.');
    await action('logout'); await page.locator('#login-form').waitFor();
    assert.equal(await liveTracks(), 0);
    assert.equal(await page.locator('.message').count(), 0);
  });
  await check('microphone permission denial and offline transcription show actionable failure with typed recovery and no speech', async () => {
    await fresh(); await page.evaluate(() => { window.__qaCapture.denied = true; });
    const before = speechCalls().length;
    await page.locator('#conversation-circle .voice-orb').click();
    await page.waitForFunction(() => document.querySelector('#conversation-circle [role=alert]')?.textContent.trim());
    assert.equal(await liveTracks(), 0);
    assert.equal(speechCalls().length, before);
    assert.equal(await page.locator('#chat-input').isEnabled(), true);
    await page.locator('#chat-input').fill('Can we talk about studying?');
    await page.locator('#chat-form [type=submit]').click();
    await page.locator('.message.assistant').last().waitFor();
    assert.equal(speechCalls().length, before, 'Typed recovery must not automatically start voice.');
    await fresh(); await start();
    await page.route('**/api/conversation-agent/transcribe', route => route.abort('internetdisconnected'));
    await utterance('Can we talk about my study plans?');
    await page.waitForFunction(() => document.querySelector('#conversation-circle [role=alert]')?.textContent.trim());
    await action('voice-stop');
    assert.equal(await liveTracks(), 0);
    await page.unroute('**/api/conversation-agent/transcribe');
  });
  await check('a rejected whole-reply review is displayed as withheld and never reaches speech synthesis', async () => {
    await fresh(); await start();
    const before = speechCalls().length;
    await utterance('Please reject fixture for this study conversation.');
    await page.waitForFunction(() => document.querySelector('.message.assistant .message-text')?.textContent.includes('current study library'));
    assert.equal(speechCalls().length, before);
    assert.equal(await page.evaluate(() => window.__qaAudio.length), 0);
    await action('voice-stop');
  });
  await check('interruption while an answer is preparing cancels obsolete work; a late author completion cannot start audio', async () => {
    await fresh(); await start(); holdAuthor = true;
    const before = speechCalls().length;
    await utterance('I would like to talk about studying.');
    await page.waitForFunction(() => document.querySelector('#conversation-circle .conversation-voice-circle')?.getAttribute('data-phase') === 'thinking');
    assert(releaseAuthor, 'The synthetic author must be held in-flight.');
    await frames(0.18, 0.5);
    releaseAuthor(); releaseAuthor = null;
    await page.waitForTimeout(150);
    assert.equal(speechCalls().length, before);
    assert.equal(await page.evaluate(() => window.__qaAudio.length), 0);
    await action('voice-stop');
  });
  await check('a delayed interruption checkpoint never makes the next tutor assume unplayed content was presented', async () => {
    await fresh(); await start();
    await utterance('I would like to talk about studying.'); await playing();
    let releaseCheckpoint;
    const blocked = new Promise(resolve => { releaseCheckpoint = resolve; });
    await page.route('**/api/conversation-agent/checkpoint', async route => { await blocked; await route.continue().catch(() => {}); });
    const before = providerCalls.length;
    try {
      await utterance('Please explain that more slowly.'); await playing();
      const nextAuthor = providerCalls.slice(before).find(item => Array.isArray(item.history));
      assert(nextAuthor, 'The next synthetic author call must receive history.');
      const previousAssistant = nextAuthor.history.find(item => item.role === 'assistant');
      assert(previousAssistant);
      assert(!previousAssistant.content.includes('We can work at your pace.'), 'Unplayed response text must not be supplied as presented history.');
      assert.equal(previousAssistant.presentation.unplayedContentExcluded, true);
      assert.equal(previousAssistant.presentation.heard, 'unknown');
    } finally {
      releaseCheckpoint();
      await page.unroute('**/api/conversation-agent/checkpoint');
      await action('voice-stop');
    }
  });
  await check('unexpected microphone disconnection never advertises listening and exposes typed recovery', async () => {
    await fresh(); await start();
    await page.evaluate(() => { const track = window.__qaCapture.tracks.at(-1); track.readyState = 'ended'; track.onended?.(); });
    await page.waitForFunction(() => document.querySelector('#conversation-circle [role=alert]')?.textContent.includes('disconnected'));
    assert.equal(await liveTracks(), 0);
    assert.notEqual(await page.locator('#conversation-circle .conversation-voice-circle').getAttribute('data-phase'), 'listening');
    assert.equal(await page.locator('#chat-input').isEnabled(), true);
    await action('voice-stop');
    await fresh(); await start(); await action('voice-mute');
    await page.evaluate(() => { window.__qaCapture.denied = true; });
    await action('voice-mute');
    await page.waitForFunction(() => document.querySelector('#conversation-circle [role=alert]')?.textContent.includes('permission'));
    assert.equal(await liveTracks(), 0);
    assert.equal(await page.locator('#chat-input').isEnabled(), true);
    assert.notEqual(await page.locator('#conversation-circle .conversation-voice-circle').getAttribute('data-input-state'), 'starting');
    await action('voice-stop');
  });
  assert.equal(errors.length, 0, `Browser errors: ${errors.join('; ')}`);
  assert.equal(consoleErrors.filter(item => /Content Security Policy|Refused to|Uncaught/.test(item)).length, 0, 'Strict CSP must accept the circle assets.');
  if (results.some(item => !item.pass)) process.exitCode = 1;
} finally {
  releaseAuthor?.();
  writeFileSync(new URL(only ? `./conversation-agent-browser-results-scopes-${[...only].join('-')}.json` : './conversation-agent-browser-results.json', import.meta.url), JSON.stringify({ runAt: new Date().toISOString(), scope: 'New reusable voice wiring only. Synthetic microphone/media/provider; actual local authenticated app routes. No real audio quality, echo-rejection or phone latency result.', results, pageErrors: errors, consoleErrors, requests, providerCalls, paidProviderCalls: 0 }, null, 2));
  await browser.close();
  await server.closeVoiceSessions?.();
  await new Promise(resolve => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
}
