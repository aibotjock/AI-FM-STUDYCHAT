import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { buildApplication } from '../server/bootstrap.js';
import { loadConfig } from '../server/config.js';

// Browser/audio fixtures exercise the actual capture VAD and conversation agent.
// Provider text, transcription, and speech are fixtures: no paid requests run.
// This verifies browser lifecycle and the app contract, not model accuracy/audio quality.
const modulePath = process.env.PLAYWRIGHT_MODULE;
const executablePath = process.env.CHROMIUM_EXECUTABLE;
if (!modulePath || !executablePath) throw new Error('Set PLAYWRIGHT_MODULE and CHROMIUM_EXECUTABLE to external test tools. They are not app dependencies.');
const { chromium } = createRequire(import.meta.url)(modulePath);
const dataDir = mkdtempSync(`${tmpdir()}/studychat-voice-browser-`);
const token = randomUUID();
const calls = { model: 0, transcription: 0, speech: 0 };
const speechBodies = [];
const modelSelections = [];
const voices = [
  { value: 'af_heart', label: 'Heart' }, { value: 'af_bella', label: 'Bella' }, { value: 'af_nicole', label: 'Nicole' },
  { value: 'am_michael', label: 'Michael' }, { value: 'bf_emma', label: 'Emma' }
];
const models = [
  { id: 'gpt-4.1-mini', provider: 'openai', label: 'GPT-4.1 mini', tier: 'standard', available: true, limits: { maxPromptBytes: 24000, maxOutputTokens: 1200 } },
  { id: 'claude-haiku-5-5', provider: 'anthropic', label: 'Claude Haiku', tier: 'standard', available: true, limits: { maxPromptBytes: 24000, maxOutputTokens: 1200 } }
];
const provider = {
  available: true,
  async catalogue() { return { providers: [{ id: 'openai', label: 'OpenAI', configured: true }, { id: 'anthropic', label: 'Anthropic', configured: true }], models, defaultSelection: { provider: 'openai', model: 'gpt-4.1-mini' } }; },
  async resolveSelection(selection) { assert.ok(models.some(model => model.provider === selection.provider && model.id === selection.model)); return selection; },
  async generate({ messages, selection, onDelta, signal }) {
    calls.model++; signal.throwIfAborted();
    modelSelections.push({ ...selection });
    const content = `Voice fixture reply: ${messages.at(-1).content}`;
    onDelta(content);
    return { content, model: selection.model, provider: selection.provider };
  }
};
const speechToken = randomUUID();
const speechFixture = createServer((request, response) => {
  assert.equal(request.headers.authorization, `Bearer ${speechToken}`);
  if (request.url !== '/health') { response.writeHead(500).end('Audio is intercepted by browser fixtures.'); return; }
  response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ready: true, transcriptionModel: 'small.en', speechModel: 'kokoro-v1.0', voices: voices.map(voice => voice.value) }));
});
await new Promise(resolve => speechFixture.listen(0, '127.0.0.1', resolve));
const speechOrigin = `http://127.0.0.1:${speechFixture.address().port}`;
const app = buildApplication({ config: loadConfig({ HOST: '127.0.0.1', PORT: '0', DATA_DIR: dataDir, STUDY_ACCESS_TOKEN: token, SPEECH_SERVICE_URL: speechOrigin, SPEECH_SERVICE_TOKEN: speechToken }), provider });
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${app.server.address().port}`;
const errors = [], checks = [];
let browser, page;

async function installAudioFixture(page, denyPermission = false) {
  await page.addInitScript(({ denyPermission }) => {
    const fixture = window.__voiceQA = {
      denyPermission, permissionCalls: 0, tracks: [], contexts: [], processors: [], audios: [],
      blockNextPlayback: true, playbackCalls: 0, pauses: 0, trackStops: 0,
      emit(amplitude, count = 1) {
        for (let i = 0; i < count; i++) {
          const frame = new Float32Array(2048).fill(amplitude);
          for (const processor of this.processors) if (!processor.disconnected) processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => frame } });
        }
      },
      finishAudio() { this.audios.at(-1)?.onended?.(); },
      activeTracks() { return this.tracks.filter(track => track.readyState === 'live').length; },
      setHidden(hidden) { Object.defineProperty(document, 'hidden', { configurable: true, value: hidden }); document.dispatchEvent(new Event('visibilitychange')); },
    };
    const node = () => ({ disconnected: false, connect() {}, disconnect() { this.disconnected = true; } });
    class FixtureAudioContext {
      constructor() { this.sampleRate = 16000; this.destination = {}; this.closed = false; fixture.contexts.push(this); }
      resume() { return Promise.resolve(); }
      close() { this.closed = true; return Promise.resolve(); }
      createMediaStreamSource() { return node(); }
      createGain() { return { ...node(), gain: { value: 1 } }; }
      createScriptProcessor() { const processor = { ...node(), onaudioprocess: null }; fixture.processors.push(processor); return processor; }
    }
    window.AudioContext = FixtureAudioContext;
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      async getUserMedia(constraints) {
        fixture.permissionCalls++;
        if (fixture.denyPermission) throw new DOMException('Fixture permission denied', 'NotAllowedError');
        if (constraints.video !== false || constraints.audio.echoCancellation !== true) throw new Error('Expected speech capture constraints');
        const track = { readyState: 'live', onended: null, getSettings: () => ({ echoCancellation: true }), stop() { if (this.readyState !== 'ended') fixture.trackStops++; this.readyState = 'ended'; } };
        fixture.tracks.push(track);
        return { getTracks: () => [track], getAudioTracks: () => [track] };
      }
    } });
    window.Audio = class FixtureAudio {
      constructor(url) { this.src = url; this.currentTime = 0; fixture.audios.push(this); }
      play() {
        fixture.playbackCalls++;
        if (fixture.blockNextPlayback) { fixture.blockNextPlayback = false; return Promise.reject(new DOMException('Fixture autoplay blocked', 'NotAllowedError')); }
        queueMicrotask(() => this.onplaying?.()); return Promise.resolve();
      }
      pause() { fixture.pauses++; }
    };
  }, { denyPermission });
  await page.route('**/api/voice/transcribe', async route => {
    const body = route.request().postDataJSON();
    const audio = Buffer.from(body.audioBase64, 'base64');
    assert.equal(audio.subarray(0, 4).toString(), 'RIFF');
    assert.equal(audio.subarray(8, 12).toString(), 'WAVE');
    assert.equal(audio.readUInt32LE(24), 16000);
    assert.ok(audio.length > 44, 'VAD should submit real encoded PCM fixture frames');
    assert.ok(body.conversationId && body.sessionId && body.requestId);
    calls.transcription++;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: 'Explain a study concept', requestId: body.requestId }) });
  });
  await page.route('**/api/voice/speech', async route => {
    const body = route.request().postDataJSON();
    assert.ok(body.conversationId && body.messageId && body.requestId);
    assert.ok(voices.some(voice => voice.value === body.voice));
    calls.speech++; speechBodies.push(body);
    await route.fulfill({ status: 200, contentType: 'audio/wav', body: Buffer.from('fixture-audio-bytes') });
  });
}
async function signIn(page) {
  await page.goto(origin);
  await page.getByLabel('Study access token').fill(token);
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await page.getByLabel('Message Coach').waitFor();
}
const dialog = () => page.getByRole('dialog', { name: 'Voice conversation', exact: true });
async function openVoice() {
  await page.getByRole('button', { name: 'Start voice conversation', exact: true }).click();
  await dialog().waitFor();
  await dialog().getByRole('button', { name: 'Start conversation', exact: true }).waitFor();
}
async function startVoice() {
  await dialog().getByRole('button', { name: 'Start conversation', exact: true }).click();
  await dialog().locator('.voice-channels').getByText(/Microphone on/).waitFor();
  assert.equal(await page.evaluate(() => window.__voiceQA.activeTracks()), 1);
}
async function assertReleased() {
  await page.waitForFunction(() => window.__voiceQA.activeTracks() === 0 && window.__voiceQA.contexts.every(context => context.closed));
}

try {
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(8000);
  page.on('pageerror', error => errors.push(error.message));
  await installAudioFixture(page, true);
  await signIn(page);
  assert.equal(await page.evaluate(() => window.__voiceQA.permissionCalls), 0);
  assert.equal(calls.transcription, 0); assert.equal(calls.speech, 0);
  const launch = page.getByRole('button', { name: 'Start voice conversation', exact: true });
  const launchBox = await launch.boundingBox();
  assert.ok(launchBox.width >= 44 && launchBox.width <= 56 && launchBox.height >= 44 && launchBox.height <= 56);
  assert.equal(await launch.evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(17, 17, 17)');
  assert.ok(await launch.locator('svg').count());
  checks.push('phone composer has a compact black waveform control with a 44px minimum touch target; microphone stays off at boot');

  await openVoice();
  assert.equal(await page.evaluate(() => window.__voiceQA.permissionCalls), 0);
  await dialog().locator('.voice-channels').getByText(/Microphone off/).waitFor();
  const voice = dialog().getByLabel('Conversation voice', { exact: true });
  assert.deepEqual(await voice.locator('option').evaluateAll(options => options.map(option => ({ value: option.value, label: option.textContent }))), voices);
  const savedVoice = page.waitForResponse(response => response.url().endsWith('/api/settings') && response.request().postData()?.includes('af_nicole'));
  await voice.selectOption('af_nicole'); assert.equal((await (await savedVoice).json()).voice, 'af_nicole');
  await page.waitForFunction(() => document.activeElement?.closest('dialog[open]'));
  // Chromium can place focus on browser chrome (reported as BODY) at wrap;
  // native modal semantics must still prevent background app controls gaining focus.
  for (let i = 0; i < 9; i++) { await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement === document.body || Boolean(document.activeElement?.closest('dialog[open]'))), true); }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.keyboard.press('Escape'); await dialog().waitFor({ state: 'hidden' });
  assert.equal(await launch.evaluate(element => element === document.activeElement), true);
  await openVoice(); assert.equal(await dialog().getByLabel('Conversation voice').inputValue(), 'af_nicole');
  checks.push('native voice dialog opens without Settings opt-in or microphone capture; five choices save immediately; keyboard focus excludes background controls; Escape restores composer focus');

  await dialog().getByRole('button', { name: 'Start conversation', exact: true }).click();
  await dialog().locator('.voice-notice[role="alert"]').getByText(/permission was denied/i).waitFor();
  assert.equal(await page.evaluate(() => window.__voiceQA.permissionCalls), 1);
  await assertReleased();
  await dialog().getByRole('button', { name: 'Use typed chat', exact: true }).click();
  assert.equal(await page.getByLabel('Message Coach').evaluate(element => element === document.activeElement), true);
  await page.getByLabel('Message Coach').fill('Typed after microphone denial');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByText('Voice fixture reply: Typed after microphone denial', { exact: true }).waitFor();
  assert.equal(calls.model, 1); assert.equal(calls.transcription, 0); assert.equal(calls.speech, 0);
  checks.push('permission denial closes audio resources; Use typed chat focuses the composer; typed streaming remains usable without audio calls');

  await page.close();
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(8000); page.on('pageerror', error => errors.push(error.message));
  await installAudioFixture(page); await signIn(page);
  const modelPicker = page.getByLabel('Chat model', { exact: true });
  await modelPicker.locator('option').filter({ hasText: 'Claude Haiku' }).waitFor({ state: 'attached' });
  const savedModel = page.waitForResponse(response => response.url().endsWith('/api/settings') && response.request().postData()?.includes('anthropic'));
  await modelPicker.selectOption(JSON.stringify(['anthropic', 'claude-haiku-5-5']));
  assert.equal((await (await savedModel).json()).aiProvider, 'anthropic');
  await openVoice(); assert.equal(await dialog().getByLabel('Conversation voice').inputValue(), 'af_nicole');
  await startVoice(); assert.equal(await dialog().getByLabel('Conversation voice').isDisabled(), true);
  await page.evaluate(() => { window.__voiceQA.emit(0.12, 4); window.__voiceQA.emit(0, 10); });
  await dialog().getByText('Voice fixture reply: Explain a study concept', { exact: true }).waitFor();
  await dialog().getByRole('button', { name: 'Play prepared audio', exact: true }).waitFor();
  assert.equal(calls.transcription, 1); assert.equal(calls.model, 2); assert.equal(calls.speech, 1); assert.equal(speechBodies[0].voice, 'af_nicole');
  assert.deepEqual(modelSelections.at(-1), { provider: 'anthropic', model: 'claude-haiku-5-5' });
  await dialog().getByRole('button', { name: 'Play prepared audio', exact: true }).click();
  await dialog().locator('.voice-channels').getByText(/Reply playing/).waitFor();
  assert.equal(calls.speech, 1, 'Resume must reuse prepared audio instead of making another speech request');
  await page.evaluate(() => window.__voiceQA.finishAudio());
  await dialog().locator('.voice-channels').getByText(/Microphone on.*Ready/).waitFor();
  assert.equal(await page.evaluate(() => window.__voiceQA.playbackCalls), 2);
  checks.push('real local VAD encodes one utterance; one transcript produces one Coach turn and one chosen-voice speech request; blocked playback resumes cached audio and returns to listening');
  checks.push('voice keeps the saved Anthropic model selection; speech never makes a second answering-model request');

  await dialog().getByRole('button', { name: 'Mute microphone', exact: true }).click();
  await assertReleased();
  await dialog().getByRole('button', { name: 'Unmute microphone', exact: true }).click();
  await dialog().locator('.voice-channels').getByText(/Microphone on/).waitFor();
  assert.equal(await page.evaluate(() => window.__voiceQA.activeTracks()), 1);
  await dialog().getByRole('button', { name: 'Stop conversation', exact: true }).click();
  await assertReleased(); await dialog().getByRole('button', { name: 'Start conversation', exact: true }).waitFor();
  assert.equal(await dialog().getByLabel('Conversation voice').isDisabled(), false);
  checks.push('mute releases tracks/context; unmute explicitly reacquires one microphone; Stop releases resources and unlocks voice selection');

  await startVoice();
  await page.evaluate(() => window.__voiceQA.setHidden(true));
  await assertReleased();
  await dialog().getByRole('button', { name: 'Start conversation', exact: true }).waitFor();
  const capturesBeforeReturn = await page.evaluate(() => window.__voiceQA.permissionCalls);
  await page.evaluate(() => window.__voiceQA.setHidden(false));
  assert.equal(await page.evaluate(() => window.__voiceQA.permissionCalls), capturesBeforeReturn);
  await startVoice(); await page.keyboard.press('Escape'); await dialog().waitFor({ state: 'hidden' }); await assertReleased();
  checks.push('backgrounding stops capture and does not auto-resume; Escape during capture releases every track');

  await openVoice(); await startVoice();
  await page.evaluate(() => { window.__voiceQA.emit(0.12, 4); window.__voiceQA.emit(0, 10); });
  await dialog().locator('.voice-channels').getByText(/Reply playing/).waitFor();
  await dialog().getByRole('button', { name: 'Close voice', exact: true }).click(); await dialog().waitFor({ state: 'hidden' }); await assertReleased();
  assert.equal(await page.evaluate(() => window.__voiceQA.audios.at(-1).onended), null);
  assert.ok(await page.evaluate(() => window.__voiceQA.pauses) > 0);
  assert.ok(await page.locator('.chat-log').getByText('Voice fixture reply: Explain a study concept', { exact: true }).count() > 0);
  assert.equal(calls.transcription, 2); assert.equal(calls.model, 3); assert.equal(calls.speech, 2);
  checks.push('Close during a spoken reply pauses playback, detaches its callbacks, and preserves displayed chat text');

  const nextFrame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  let releaseTranscript, transcriptRequested;
  const heldTranscript = new Promise(resolve => { releaseTranscript = resolve; });
  const requestedTranscript = new Promise(resolve => { transcriptRequested = resolve; });
  const delayedTranscript = async route => {
    const body = route.request().postDataJSON(); calls.transcription++; transcriptRequested(); await heldTranscript;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: 'Obsolete transcript', requestId: body.requestId }) });
  };
  await page.route('**/api/voice/transcribe', delayedTranscript);
  await openVoice(); await startVoice();
  await page.evaluate(() => { window.__voiceQA.emit(0.12, 4); window.__voiceQA.emit(0, 10); });
  await requestedTranscript;
  const modelsBeforeTranscriptClose = calls.model;
  await dialog().getByRole('button', { name: 'Close voice', exact: true }).click(); await dialog().waitFor({ state: 'hidden' }); await assertReleased();
  releaseTranscript(); await nextFrame(); await page.unroute('**/api/voice/transcribe', delayedTranscript);
  assert.equal(calls.model, modelsBeforeTranscriptClose);
  assert.equal(await page.getByText('Voice fixture reply: Obsolete transcript', { exact: true }).count(), 0);
  checks.push('closing during delayed transcription releases capture; a stale transcript cannot submit another Coach turn');

  let releaseSpeech, speechRequested;
  const heldSpeech = new Promise(resolve => { releaseSpeech = resolve; });
  const requestedSpeech = new Promise(resolve => { speechRequested = resolve; });
  const delayedSpeech = async route => {
    calls.speech++; speechBodies.push(route.request().postDataJSON()); speechRequested(); await heldSpeech;
    await route.fulfill({ status: 200, contentType: 'audio/wav', body: Buffer.from('obsolete-fixture-audio') });
  };
  await page.route('**/api/voice/speech', delayedSpeech);
  await openVoice(); await startVoice();
  await page.evaluate(() => { window.__voiceQA.emit(0.12, 4); window.__voiceQA.emit(0, 10); });
  await requestedSpeech;
  const playbackBeforeSpeechClose = await page.evaluate(() => window.__voiceQA.playbackCalls);
  await dialog().getByRole('button', { name: 'Close voice', exact: true }).click(); await dialog().waitFor({ state: 'hidden' }); await assertReleased();
  releaseSpeech(); await nextFrame(); await page.unroute('**/api/voice/speech', delayedSpeech);
  assert.equal(await page.evaluate(() => window.__voiceQA.playbackCalls), playbackBeforeSpeechClose);
  assert.ok(await page.locator('.chat-log').getByText('Voice fixture reply: Explain a study concept', { exact: true }).count() > 0);
  checks.push('closing during delayed speech preparation prevents stale audio playback and preserves the saved study reply');

  await page.setViewportSize({ width: 320, height: 740 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const narrowLaunch = page.getByRole('button', { name: 'Start voice conversation', exact: true });
  const narrowBox = await narrowLaunch.boundingBox();
  assert.ok(narrowBox.width >= 44 && narrowBox.height >= 44);
  await openVoice();
  assert.equal(await dialog().locator('.conversation-voice-circle').getAttribute('data-reduced-motion'), 'true');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const dialogBox = await dialog().boundingBox();
  assert.ok(dialogBox.x >= 0 && dialogBox.x + dialogBox.width <= 320 && dialogBox.y >= 0 && dialogBox.y + dialogBox.height <= 740);
  if (process.env.VOICE_SCREENSHOT) await page.screenshot({ path: process.env.VOICE_SCREENSHOT });
  await page.mouse.click(2, 2); await dialog().waitFor({ state: 'hidden' }); await assertReleased();
  checks.push('320px layout stays in the viewport with a 44px launch target; reduced motion is honored; backdrop click closes safely');

  await page.locator('.tabbar [data-tab="settings"]').click();
  assert.equal(await page.getByLabel('Voice', { exact: true }).inputValue(), 'af_nicole');
  assert.equal(await page.getByLabel('Enable optional voice', { exact: true }).count(), 0);
  checks.push('Close releases active capture; selected voice persists across authentication sessions and appears in Settings without an enablement gate');

  await page.locator('.tabbar [data-tab="coach"]').click();
  let releaseOptions, optionsRequested;
  const heldOptions = new Promise(resolve => { releaseOptions = resolve; });
  const requestedOptions = new Promise(resolve => { optionsRequested = resolve; });
  await page.route('**/api/voice', async route => {
    const response = await route.fetch(); optionsRequested(); await heldOptions; await route.fulfill({ response });
  });
  const delayedOptions = page.waitForResponse(response => response.url().endsWith('/api/voice') && response.request().method() === 'GET');
  const capturesBeforeNavigate = await page.evaluate(() => window.__voiceQA.permissionCalls);
  await page.getByRole('button', { name: 'Start voice conversation', exact: true }).click();
  await requestedOptions;
  await page.locator('.tabbar [data-tab="practice"]').click();
  releaseOptions(); await delayedOptions;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.locator('dialog[open]').count(), 0);
  assert.equal(await page.evaluate(() => window.__voiceQA.permissionCalls), capturesBeforeNavigate);
  checks.push('navigating while voice options load prevents a stale dialog from opening or requesting the microphone');

  await page.unroute('**/api/voice');
  await page.locator('.tabbar [data-tab="coach"]').click();
  const unavailableOptions = async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: false, unavailableReason: 'The self-hosted speech service is offline.', voices: voices.map(voice => voice.value) }) });
  await page.route('**/api/voice', unavailableOptions);
  const microphoneBeforeOutage = await page.evaluate(() => window.__voiceQA.permissionCalls);
  await page.getByRole('button', { name: 'Start voice conversation', exact: true }).click();
  await page.getByText(/self-hosted speech service is offline/).waitFor();
  assert.equal(await page.locator('dialog[open]').count(), 0);
  assert.equal(await page.evaluate(() => window.__voiceQA.permissionCalls), microphoneBeforeOutage);
  await page.getByLabel('Message Coach').fill('Typed while speech is offline');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByText('Voice fixture reply: Typed while speech is offline', { exact: true }).waitFor();
  assert.deepEqual(modelSelections.at(-1), { provider: 'anthropic', model: 'claude-haiku-5-5' });
  checks.push('unavailable self-hosted speech prevents microphone access while typed chat still uses the selected answering model');

  assert.deepEqual(errors, []);
  const result = { browser: await browser.version(), viewport: { width: 390, height: 844 }, speechStack: 'Whisper + Kokoro + Pipecat', mockedProvider: true, mockedCapture: true, mockedTranscription: true, mockedSpeech: true, actualPaidRequests: 0, voices, modelSelections, calls, checks, errors };
  if (process.env.VOICE_RESULTS) writeFileSync(process.env.VOICE_RESULTS, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(JSON.stringify({ failure: error.message, calls, checks, errors, body: await page?.locator('body').innerText() }));
  throw error;
} finally { await browser?.close(); await app.shutdown(); await new Promise(resolve => speechFixture.close(resolve)); rmSync(dataDir, { recursive: true, force: true }); }
