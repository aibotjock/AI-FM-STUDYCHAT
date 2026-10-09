import { createApp } from '../server/index.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dir = mkdtempSync(join(tmpdir(), 'fm-voice-ui-'));
const server = createApp({ dataDir: dir, env: { OPENAI_API_KEY: 'qa-local-key-only', AI_PROVIDER: 'openai', OPENAI_MODEL: 'gpt-4.1-mini' }, fetchImpl: async () => { throw new Error('Unexpected provider request: browser QA uses intercepted routes only'); } });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, headless: true, args: ['--no-sandbox'] });
const results = [];
const errors = [];
const check = async (name, fn) => { if (process.env.QA_ONLY && !new RegExp(process.env.QA_ONLY).test(name)) return; if (process.env.QA_SCOPE === 'ui' && !/^(UI|Dictation):/.test(name)) return; try { const detail = await fn(); results.push({ name, pass: true, detail }); } catch (error) { results.push({ name, pass: false, error: error.message }); } console.log(JSON.stringify(results.at(-1))); };
const makePage = async () => {
  const context = await browser.newContext({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await context.addInitScript(() => {
    const qa = window.__qa = { speechInstances: [], peers: [], streams: [], audio: [], mediaMode: 'success', autoplayBlocked: false, mediaPending: null };
    class FakeRecognition {
      constructor() { this.started = 0; this.stopped = 0; qa.speechInstances.push(this); }
      start() { this.started++; }
      stop() { this.stopped++; this.onend?.(); }
      abort() { this.stop(); }
      emit(index, values) { const results = values.map(value => { const result = [{ transcript: value.text }]; result.isFinal = value.final; return result; }); this.onresult?.({ resultIndex: index, results }); }
    }
    window.SpeechRecognition = FakeRecognition;
    class FakeStream {
      constructor() { this.track = { kind: 'audio', enabled: true, stopped: 0, stop() { this.stopped++; } }; qa.streams.push(this); }
      getTracks() { return [this.track]; }
      getAudioTracks() { return [this.track]; }
    }
    window.MediaStream = FakeStream;
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { async getUserMedia() {
      if (qa.mediaMode === 'denied') throw new DOMException('Microphone denied for QA', 'NotAllowedError');
      if (qa.mediaMode === 'pending') return await new Promise(resolve => { qa.mediaPending = () => resolve(new FakeStream()); });
      return new FakeStream();
    } } });
    class FakeChannel extends EventTarget {
      constructor() { super(); this.readyState = 'connecting'; this.sent = []; this.closed = 0; }
      send(value) { this.sent.push(JSON.parse(value)); }
      close() { this.closed++; this.readyState = 'closed'; }
      open() { this.readyState = 'open'; this.dispatchEvent(new Event('open')); this.onopen?.(); }
      emit(value) { const event = new MessageEvent('message', { data: JSON.stringify(value) }); this.dispatchEvent(event); this.onmessage?.(event); }
    }
    class FakePeer extends EventTarget {
      constructor() { super(); this.connectionState = 'new'; this.closed = 0; this.channel = null; qa.peers.push(this); }
      addTrack() {}
      createDataChannel() { return this.channel = new FakeChannel(); }
      async createOffer() { return { type: 'offer', sdp: 'v=0\r\nqa-offline-offer' }; }
      async setLocalDescription(value) { this.localDescription = value; }
      async setRemoteDescription(value) { this.remoteDescription = value; this.connectionState = 'connected'; this.channel.open(); this.onconnectionstatechange?.(); this.dispatchEvent(new Event('connectionstatechange')); }
      close() { this.closed++; this.connectionState = 'closed'; }
      emit(value) { this.channel.emit(value); }
      remoteAudio() { const event = new Event('track'); event.streams = [new FakeStream()]; event.track = event.streams[0].track; this.dispatchEvent(event); this.ontrack?.(event); }
    }
    window.RTCPeerConnection = FakePeer;
    const audioSource = new WeakMap();
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', { configurable: true, get() { return audioSource.get(this); }, set(value) { audioSource.set(this, value); if (!qa.audio.includes(this)) qa.audio.push(this); } });
    HTMLMediaElement.prototype.play = async function () { this.__played = (this.__played || 0) + 1; if (!qa.audio.includes(this)) qa.audio.push(this); if (qa.autoplayBlocked) throw new DOMException('QA autoplay blocked', 'NotAllowedError'); };
    HTMLMediaElement.prototype.pause = function () { this.__paused = (this.__paused || 0) + 1; };
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  return { page, context };
};
try {
  const controllers = [];
  const controllerPage = async () => {
    const item = await makePage(); controllers.push(item.context);
    await item.page.goto(baseUrl + '/#coach'); await item.page.locator('#chat-input').waitFor();
    await item.page.evaluate(async () => {
      const { createVoiceCoach } = await import('/voice-chat.js');
      window.__voiceRequests = []; window.__voiceSaves = []; window.__voiceStates = [];
      window.__requestMode = 'success'; window.__pendingRequest = null;
      window.__coach = createVoiceCoach({ request: async (path, data) => {
        window.__voiceRequests.push({ path, data });
        if (path.endsWith('/session')) {
          if (window.__requestMode === 'fail') throw new Error('QA server refused voice. No automatic retry was made.');
          if (window.__requestMode === 'pending') await new Promise(resolve => { window.__pendingRequest = resolve; });
          return { sessionId: 'qa_session', model: 'gpt-realtime-2.1-mini', sdp: 'v=0\r\nqa-offline-answer', maxDurationSeconds: 600 };
        }
        return { ok: true };
      }, onTranscript: async value => { window.__voiceSaves.push(value); }, onState: value => { window.__voiceStates.push(value); } });
    });
    return item.page;
  };
  await check('Voice starts only explicitly, guards simultaneous Start, and sends one greeting', async () => {
    const page = await controllerPage();
    assert.equal(await page.evaluate(() => __voiceRequests.length), 0);
    await page.evaluate(async () => { await Promise.all([__coach.start({ conversationId: 'qa_conversation' }), __coach.start({ conversationId: 'qa_conversation' })]); });
    const measured = await page.evaluate(() => ({ requests: __voiceRequests, peers: __qa.peers.length, sent: __qa.peers[0].channel.sent, phase: __coach.state().phase }));
    assert.equal(measured.requests.filter(value => value.path.endsWith('/session')).length, 1); assert.equal(measured.peers, 1);
    assert.equal(measured.sent.filter(value => value.type === 'response.create').length, 1); assert.equal(measured.phase, 'listening');
    await page.evaluate(() => __coach.stop()); return { starts: 1, greetings: 1 };
  });
  await check('Mute, Unmute, Interrupt and Stop control microphone, output and call teardown', async () => {
    const page = await controllerPage(); await page.evaluate(() => __coach.start({ conversationId: 'qa_conversation' }));
    await page.evaluate(() => __coach.toggleMute()); assert.equal(await page.evaluate(() => __qa.streams[0].track.enabled), false);
    await page.evaluate(() => __coach.toggleMute()); assert.equal(await page.evaluate(() => __qa.streams[0].track.enabled), true);
    await page.evaluate(() => __coach.interrupt());
    const sent = await page.evaluate(() => __qa.peers[0].channel.sent.map(value => value.type)); assert(sent.includes('response.cancel')); assert(sent.includes('output_audio_buffer.clear')); assert(sent.includes('input_audio_buffer.clear'));
    await page.evaluate(() => __coach.stop());
    const measured = await page.evaluate(() => ({ trackStops: __qa.streams[0].track.stopped, peerClosed: __qa.peers[0].closed, channelClosed: __qa.peers[0].channel.closed, stopRequests: __voiceRequests.filter(value => value.path.endsWith('/stop')).length, phase: __coach.state().phase, audioElements: document.querySelectorAll('audio').length }));
    assert.equal(measured.trackStops, 1); assert.equal(measured.peerClosed, 1); assert.equal(measured.channelClosed, 1); assert.equal(measured.stopRequests, 1); assert.equal(measured.phase, 'idle'); assert.equal(measured.audioElements, 0); return measured;
  });
  await check('Voice captions remain separate per item and repeated final events save each turn once', async () => {
    const page = await controllerPage(); await page.evaluate(() => __coach.start({ conversationId: 'qa_conversation' }));
    await page.evaluate(() => {
      const emit = value => __qa.peers[0].emit(value);
      emit({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'item_1', delta: 'first ' });
      emit({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'item_2', delta: 'second ' });
      emit({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'item_1', delta: 'turn' });
    });
    assert.equal(await page.evaluate(() => __coach.state().userCaption), 'first turn');
    await page.evaluate(() => {
      const final = { type: 'conversation.item.input_audio_transcription.completed', item_id: 'item_1', transcript: 'first turn' };
      __qa.peers[0].emit(final); __qa.peers[0].emit(final);
      __qa.peers[0].emit({ type: 'response.output_audio_transcript.done', item_id: 'reply_1', transcript: 'One clear question?' });
      __qa.peers[0].emit({ type: 'response.output_audio_transcript.done', item_id: 'reply_1', transcript: 'One clear question?' });
    });
    await page.waitForFunction(() => __voiceSaves.flatMap(value => value.events).length === 2);
    const saved = await page.evaluate(() => __voiceSaves.flatMap(value => value.events)); assert.equal(new Set(saved.map(value => value.id)).size, 2); assert.deepEqual(saved.map(value => value.content), ['first turn', 'One clear question?']);
    await page.evaluate(() => __coach.stop()); return { savedTurns: saved.length, uniqueIds: 2 };
  });
  await check('Microphone permission failure surfaces clearly without starting a paid call', async () => {
    const page = await controllerPage(); await page.evaluate(async () => { __qa.mediaMode = 'denied'; await __coach.start({ conversationId: 'qa_conversation' }); });
    const measured = await page.evaluate(() => ({ state: __coach.state(), requests: __voiceRequests.length, peers: __qa.peers.length, audioElements: document.querySelectorAll('audio').length }));
    assert.equal(measured.state.phase, 'error'); assert.match(measured.state.message, /permission was denied/i); assert.equal(measured.requests, 0); assert.equal(measured.peers, 0); assert.equal(measured.audioElements, 0); return measured;
  });
  await check('Stop during pending microphone setup closes late tracks and creates no call', async () => {
    const page = await controllerPage(); await page.evaluate(() => { __qa.mediaMode = 'pending'; window.__starting = __coach.start({ conversationId: 'qa_conversation' }); });
    await page.waitForFunction(() => Boolean(__qa.mediaPending)); await page.evaluate(() => __coach.stop());
    await page.evaluate(async () => { __qa.mediaPending(); await __starting; });
    const measured = await page.evaluate(() => ({ stops: __qa.streams[0].track.stopped, calls: __voiceRequests.length, phase: __coach.state().phase })); assert.equal(measured.stops, 1); assert.equal(measured.calls, 0); assert.equal(measured.phase, 'idle'); return measured;
  });
  await check('Stop during pending server setup tears down locally and closes the late created call', async () => {
    const page = await controllerPage(); await page.evaluate(() => { __requestMode = 'pending'; window.__starting = __coach.start({ conversationId: 'qa_conversation' }); });
    await page.waitForFunction(() => Boolean(__pendingRequest)); await page.evaluate(() => __coach.stop()); await page.evaluate(async () => { __pendingRequest(); await __starting; });
    const measured = await page.evaluate(() => ({ trackStops: __qa.streams[0].track.stopped, peerClosed: __qa.peers[0].closed, starts: __voiceRequests.filter(value => value.path.endsWith('/session')).length, stops: __voiceRequests.filter(value => value.path.endsWith('/stop')).length, phase: __coach.state().phase }));
    assert.equal(measured.trackStops, 1); assert.equal(measured.peerClosed, 1); assert.equal(measured.starts, 1); assert.equal(measured.stops, 1); assert.equal(measured.phase, 'idle'); return measured;
  });
  await check('Cancelled setup blocks immediate restart until late session closes, then permits a fresh call', async () => {
    const page = await controllerPage(); await page.evaluate(() => { __requestMode = 'pending'; window.__starting = __coach.start({ conversationId: 'qa_conversation' }); });
    await page.waitForFunction(() => Boolean(__pendingRequest)); await page.evaluate(async () => { await __coach.stop(); await __coach.start({ conversationId: 'qa_conversation' }); });
    const during = await page.evaluate(() => ({ starts: __voiceRequests.filter(value => value.path.endsWith('/session')).length, streams: __qa.streams.length, setupPending: __coach.state().setupPending })); assert.equal(during.starts, 1); assert.equal(during.streams, 1); assert.equal(during.setupPending, true);
    await page.evaluate(async () => { __pendingRequest(); await __starting; }); assert.equal(await page.evaluate(() => __voiceRequests.filter(value => value.path.endsWith('/stop')).length), 1);
    await page.evaluate(async () => { __requestMode = 'success'; await __coach.start({ conversationId: 'qa_conversation' }); });
    assert.equal(await page.evaluate(() => __voiceRequests.filter(value => value.path.endsWith('/session')).length), 2); assert.equal(await page.evaluate(() => __coach.state().phase), 'listening'); await page.evaluate(() => __coach.stop()); return { blockedDuringCancelledSetup: true, lateCallClosed: true, freshStartAllowed: true };
  });
  await check('Background transition stops microphone and call without restarting', async () => {
    const page = await controllerPage(); await page.evaluate(() => __coach.start({ conversationId: 'qa_conversation' }));
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForFunction(() => __voiceRequests.some(value => value.path.endsWith('/stop')));
    const measured = await page.evaluate(() => ({ phase: __coach.state().phase, message: __coach.state().message, trackStops: __qa.streams[0].track.stopped, starts: __voiceRequests.filter(value => value.path.endsWith('/session')).length }));
    assert.equal(measured.phase, 'idle'); assert.match(measured.message, /background/i); assert.equal(measured.trackStops, 1); assert.equal(measured.starts, 1); return measured;
  });
  await check('Server voice failure tears down tracks and peer with no automatic paid retry', async () => {
    const page = await controllerPage(); await page.evaluate(async () => { __requestMode = 'fail'; await __coach.start({ conversationId: 'qa_conversation' }); });
    const measured = await page.evaluate(() => ({ state: __coach.state(), requests: __voiceRequests, stops: __qa.streams[0].track.stopped, closed: __qa.peers[0].closed }));
    assert.equal(measured.state.phase, 'error'); assert.match(measured.state.message, /no automatic retry/i); assert.equal(measured.requests.filter(value => value.path.endsWith('/session')).length, 1); assert.equal(measured.stops, 1); assert.equal(measured.closed, 1); return { starts: 1, microphoneStopped: true, peerClosed: true };
  });
  await check('Autoplay blocking shows a recovery action and manual audio enable recovers', async () => {
    const page = await controllerPage(); await page.evaluate(async () => { __qa.autoplayBlocked = true; await __coach.start({ conversationId: 'qa_conversation' }); __qa.peers[0].remoteAudio(); });
    await page.waitForFunction(() => __coach.state().audioBlocked); assert.match(await page.evaluate(() => __coach.state().message), /enable speaker audio/i);
    await page.evaluate(async () => { __qa.autoplayBlocked = false; await __coach.playAudio(); }); assert.equal(await page.evaluate(() => __coach.state().audioBlocked), false);
    await page.evaluate(() => __coach.stop()); return { blockedSurfaced: true, recoveredOnUserAction: true };
  });
  const uiPage = async () => {
    const item = await makePage(); controllers.push(item.context);
    const calls = { sessions: [], transcripts: [], stops: [], mode: 'success', conversation: null };
    await item.page.route('**/api/status', async route => { const response = await route.fetch(); const data = await response.json(); await route.fulfill({ response, json: { ...data, voiceEnabled: true, voiceModel: 'gpt-realtime-2.1-mini' } }); });
    await item.page.route('**/api/voice/session', async route => {
      const body = route.request().postDataJSON(); calls.sessions.push(body);
      if (calls.mode === 'pending') await new Promise(resolve => { calls.releaseSession = resolve; });
      if (calls.mode === 'fail') return route.fulfill({ status: 503, json: { error: 'QA voice server unavailable. No automatic retry was made.' } });
      const state = await (await fetch(baseUrl + '/api/state')).json(); calls.conversation = state.conversations.find(value => value.id === body.conversationId);
      await route.fulfill({ json: { sessionId: 'qa_ui_session', conversationId: body.conversationId, model: 'gpt-realtime-2.1-mini', sdp: 'v=0\r\nqa-offline-answer', maxDurationSeconds: 600, maxOutputTokens: 1024 } });
    });
    await item.page.route('**/api/voice/transcript', async route => {
      const body = route.request().postDataJSON(); calls.transcripts.push(body);
      for (const event of body.events) if (!calls.conversation.messages.some(value => value.id === event.id)) calls.conversation.messages.push({ ...event, createdAt: Date.now() });
      await route.fulfill({ json: { saved: body.events.length, conversation: calls.conversation } });
    });
    await item.page.route('**/api/voice/stop', async route => { calls.stops.push(route.request().postDataJSON()); await route.fulfill({ json: { stopped: true } }); });
    await item.page.goto(baseUrl + '/#coach'); await item.page.getByRole('button', { name: 'Start voice', exact: true }).waitFor();
    return { page: item.page, calls };
  };
  await check('UI: voice controls connect explicit Start, Mute, Interrupt and Stop actions', async () => {
    const { page, calls } = await uiPage(); assert.equal(calls.sessions.length, 0); await page.getByRole('button', { name: 'Start voice', exact: true }).click();
    await page.getByRole('button', { name: 'Mute microphone', exact: true }).waitFor(); await page.waitForFunction(() => __qa.peers[0]?.connectionState === 'connected');
    assert.equal(calls.sessions.length, 1); assert.equal(await page.locator('#chat-input').isDisabled(), true);
    await page.getByRole('button', { name: 'Mute microphone', exact: true }).click(); assert.equal(await page.evaluate(() => __qa.streams[0].track.enabled), false); assert.equal(await page.getByRole('button', { name: 'Unmute microphone', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: 'Unmute microphone', exact: true }).click(); assert.equal(await page.evaluate(() => __qa.streams[0].track.enabled), true);
    await page.getByRole('button', { name: 'Interrupt coach', exact: true }).click(); const events = await page.evaluate(() => __qa.peers[0].channel.sent.map(value => value.type)); assert(events.includes('response.cancel')); assert(events.includes('output_audio_buffer.clear'));
    await page.getByRole('button', { name: 'Stop voice', exact: true }).click(); await page.getByRole('button', { name: 'Start voice', exact: true }).waitFor();
    assert.equal(await page.locator('#chat-input').isDisabled(), false); assert.equal(calls.stops.length, 1); return { sessions: 1, stopCalls: 1, allButtonsWired: true };
  });
  await check('UI: rapid Start taps during conversation setup keep one active study conversation', async () => {
    const { page, calls } = await uiPage(); let creations = 0;
    await page.route('**/api/conversations', async route => {
      if (route.request().method() === 'POST') { creations++; await new Promise(resolve => setTimeout(resolve, 100)); }
      await route.continue();
    });
    await page.getByRole('button', { name: 'Start voice', exact: true }).evaluate(button => { button.click(); button.click(); });
    await page.waitForFunction(() => __qa.peers[0]?.connectionState === 'connected');
    assert.equal(creations, 1, 'Rapid Start taps created more than one study conversation.'); assert.equal(calls.sessions.length, 1);
    await page.getByRole('button', { name: 'Stop voice', exact: true }).click(); return { conversationCreations: 1, voiceSessions: 1 };
  });
  await check('UI: cancelled setup displays disabled Finishing voice setup and reenables Start after shutdown', async () => {
    const { page, calls } = await uiPage(); calls.mode = 'pending'; await page.getByRole('button', { name: 'Start voice', exact: true }).click();
    await page.waitForFunction(() => __qa.peers.length === 1); await page.getByRole('button', { name: 'Stop voice', exact: true }).click();
    const finishing = page.getByRole('button', { name: 'Finishing voice setup…', exact: true }); await finishing.waitFor(); assert.equal(await finishing.isDisabled(), true); assert.equal(calls.sessions.length, 1);
    calls.releaseSession(); await page.getByRole('button', { name: 'Start voice', exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: 'Start voice', exact: true }).isDisabled(), false); assert.equal(calls.stops.length, 1); return { pendingLabelVisible: true, startDisabledUntilShutdown: true, lateCallStopped: true };
  });
  await check('UI: finalized voice captions POST unique turns once and update conversation bubbles', async () => {
    const { page, calls } = await uiPage(); await page.getByRole('button', { name: 'Start voice', exact: true }).click(); await page.waitForFunction(() => __qa.peers[0]?.connectionState === 'connected');
    await page.evaluate(() => { const value = { type: 'conversation.item.input_audio_transcription.completed', item_id: 'learner_1', transcript: 'Let us study diabetes.' }; __qa.peers[0].emit(value); __qa.peers[0].emit(value); });
    await page.locator('.message.user .message-text').filter({ hasText: 'Let us study diabetes.' }).waitFor();
    await page.evaluate(() => { const value = { type: 'response.output_audio_transcript.done', item_id: 'coach_1', transcript: 'Which diabetes topic would you like to practice?' }; __qa.peers[0].emit(value); __qa.peers[0].emit(value); });
    await page.locator('.message.assistant .message-text').filter({ hasText: 'Which diabetes topic would you like to practice?' }).waitFor();
    const events = calls.transcripts.flatMap(value => value.events); assert.equal(events.length, 2); assert.equal(new Set(events.map(value => value.id)).size, 2); assert.equal(await page.locator('.message.user').count(), 1); assert.equal(await page.locator('.message.assistant').count(), 1);
    await page.getByRole('button', { name: 'Stop voice', exact: true }).click(); return { transcriptPosts: calls.transcripts.length, uniqueTurns: 2, bubbleCount: 2, note: 'Transcript API response mocked; backend durability tested separately.' };
  });
  await check('UI: autoplay failure exposes Enable speaker audio and the button restores playback', async () => {
    const { page } = await uiPage(); await page.evaluate(() => { __qa.autoplayBlocked = true; }); await page.getByRole('button', { name: 'Start voice', exact: true }).click(); await page.waitForFunction(() => __qa.peers[0]?.connectionState === 'connected'); await page.evaluate(() => __qa.peers[0].remoteAudio());
    await page.getByRole('button', { name: 'Enable speaker audio', exact: true }).waitFor(); await page.evaluate(() => { __qa.autoplayBlocked = false; }); await page.getByRole('button', { name: 'Enable speaker audio', exact: true }).click(); await page.getByRole('button', { name: 'Enable speaker audio', exact: true }).waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Stop voice', exact: true }).click(); return { audioButtonRecovered: true };
  });
  await check('UI: permission and server failures show actionable status and restore typing without retry', async () => {
    const first = await uiPage(); await first.page.evaluate(() => { __qa.mediaMode = 'denied'; }); await first.page.getByRole('button', { name: 'Start voice', exact: true }).click(); await first.page.locator('.voice-session-status').filter({ hasText: 'Microphone permission was denied' }).waitFor(); assert.equal(await first.page.locator('#chat-input').isDisabled(), false); assert.equal(first.calls.sessions.length, 0);
    const second = await uiPage(); second.calls.mode = 'fail'; await second.page.getByRole('button', { name: 'Start voice', exact: true }).click(); await second.page.locator('.voice-session-status').filter({ hasText: 'QA voice server unavailable' }).waitFor(); assert.equal(await second.page.locator('#chat-input').isDisabled(), false); assert.equal(second.calls.sessions.length, 1); return { micDeniedStatus: true, serverErrorStatus: true, automaticRetries: 0 };
  });
  await check('UI: voice actions and captions fit a 360 by 800 phone without page overflow', async () => {
    const { page } = await uiPage(); await page.getByRole('button', { name: 'Start voice', exact: true }).click(); await page.waitForFunction(() => __qa.peers[0]?.connectionState === 'connected');
    await page.evaluate(() => __qa.peers[0].emit({ type: 'response.output_audio_transcript.delta', item_id: 'geometry', delta: 'A deliberately long spoken caption checks how medical education text wraps on a narrow phone screen without making any clinical assertion. '.repeat(6) }));
    const measured = await page.evaluate(() => ({ width: innerWidth, pageWidth: document.documentElement.scrollWidth, controlsWidth: document.querySelector('#voice-controls').getBoundingClientRect().width, buttons: [...document.querySelectorAll('.voice-actions button')].map(value => ({ name: value.textContent, x: value.getBoundingClientRect().x, right: value.getBoundingClientRect().right })) })); assert(measured.pageWidth <= measured.width); for (const button of measured.buttons) assert(button.x >= 0 && button.right <= measured.width, JSON.stringify(button));
    await page.getByRole('button', { name: 'Stop voice', exact: true }).scrollIntoViewIfNeeded(); await page.getByRole('button', { name: 'Stop voice', exact: true }).click(); return measured;
  });
  await check('Dictation: interim revisions and repeated final events replace the same index', async () => {
    const { page, context } = await makePage(); controllers.push(context);
    await page.goto(baseUrl + '/#coach'); await page.locator('#chat-input').waitFor();
    await page.locator('#chat-input').fill('Prefix'); await page.getByRole('button', { name: 'Dictate a message', exact: true }).click();
    await page.evaluate(() => __qa.speechInstances[0].emit(0, [{ text: 'alpha', final: false }])); assert.equal(await page.locator('#chat-input').inputValue(), 'Prefix alpha');
    await page.evaluate(() => __qa.speechInstances[0].emit(0, [{ text: 'alpha beta', final: false }])); assert.equal(await page.locator('#chat-input').inputValue(), 'Prefix alpha beta');
    await page.evaluate(() => { const event = [{ text: 'alpha beta', final: true }]; __qa.speechInstances[0].emit(0, event); __qa.speechInstances[0].emit(0, event); });
    assert.equal(await page.locator('#chat-input').inputValue(), 'Prefix alpha beta'); return { sameIndexRevisions: 3, duplicateFinalAppends: 0 };
  });
  await check('Dictation: cumulative resultIndex updates append each segment once', async () => {
    const { page, context } = await makePage(); controllers.push(context);
    await page.goto(baseUrl + '/#coach'); await page.locator('#chat-input').waitFor(); await page.getByRole('button', { name: 'Dictate a message', exact: true }).click();
    await page.evaluate(() => __qa.speechInstances[0].emit(0, [{ text: 'one', final: true }]));
    await page.evaluate(() => __qa.speechInstances[0].emit(1, [{ text: 'one', final: true }, { text: 'two', final: false }]));
    await page.evaluate(() => __qa.speechInstances[0].emit(1, [{ text: 'one', final: true }, { text: 'two three', final: true }]));
    await page.evaluate(() => __qa.speechInstances[0].emit(1, [{ text: 'one', final: true }, { text: 'two three', final: true }]));
    assert.equal(await page.locator('#chat-input').inputValue(), 'one two three'); return { resultIndex: 1, phrase: 'one two three' };
  });
  await check('Dictation: manual prefix and suffix edits survive revised speech, and corrected words stop dictation', async () => {
    const { page, context } = await makePage(); controllers.push(context);
    await page.goto(baseUrl + '/#coach'); await page.locator('#chat-input').waitFor(); await page.locator('#chat-input').fill('Before'); await page.getByRole('button', { name: 'Dictate a message', exact: true }).click();
    await page.evaluate(() => __qa.speechInstances[0].emit(0, [{ text: 'spoken phrase', final: false }]));
    await page.locator('#chat-input').fill('Edited before spoken phrase trailing note');
    await page.evaluate(() => __qa.speechInstances[0].emit(0, [{ text: 'spoken phrase revised', final: true }]));
    assert.equal(await page.locator('#chat-input').inputValue(), 'Edited before spoken phrase revised trailing note');
    await page.locator('#chat-input').fill('Edited before corrected phrase trailing note');
    assert.equal(await page.evaluate(() => __qa.speechInstances[0].stopped), 1);
    await page.evaluate(() => __qa.speechInstances[0].emit(0, [{ text: 'late browser replay', final: true }]));
    assert.equal(await page.locator('#chat-input').inputValue(), 'Edited before corrected phrase trailing note'); return { manualEditsPreserved: true, lateReplayIgnored: true };
  });
  await check('Dictation: a new recording session appends its words once without replaying the previous session', async () => {
    const { page, context } = await makePage(); controllers.push(context);
    await page.goto(baseUrl + '/#coach'); await page.locator('#chat-input').waitFor(); await page.getByRole('button', { name: 'Dictate a message', exact: true }).click();
    await page.evaluate(() => __qa.speechInstances[0].emit(0, [{ text: 'first session', final: true }])); await page.getByRole('button', { name: 'Stop dictation', exact: true }).click();
    await page.getByRole('button', { name: 'Dictate a message', exact: true }).click(); await page.evaluate(() => { const value = [{ text: 'second session', final: true }]; __qa.speechInstances[1].emit(0, value); __qa.speechInstances[1].emit(0, value); });
    assert.equal(await page.locator('#chat-input').inputValue(), 'first session second session'); return { sessions: 2, appendedPhrases: 2 };
  });
  await check('Dictation: older stopped recognition callbacks cannot change a new session', async () => {
    const { page, context } = await makePage(); controllers.push(context);
    await page.goto(baseUrl + '/#coach'); await page.locator('#chat-input').waitFor(); await page.getByRole('button', { name: 'Dictate a message', exact: true }).click();
    await page.evaluate(() => __qa.speechInstances[0].emit(0, [{ text: 'first', final: true }])); await page.getByRole('button', { name: 'Stop dictation', exact: true }).click(); await page.getByRole('button', { name: 'Dictate a message', exact: true }).click();
    await page.evaluate(() => { __qa.speechInstances[1].emit(0, [{ text: 'second', final: false }]); __qa.speechInstances[0].emit(0, [{ text: 'stale old session', final: true }]); __qa.speechInstances[0].onend?.(); });
    assert.equal(await page.locator('#chat-input').inputValue(), 'first second'); assert.equal(await page.getByRole('button', { name: 'Stop dictation', exact: true }).count(), 1); return { oldResultIgnored: true, oldEndIgnored: true };
  });
  await check('Dictation: deliberate repeated words at distinct result indices are preserved', async () => {
    const { page, context } = await makePage(); controllers.push(context);
    await page.goto(baseUrl + '/#coach'); await page.locator('#chat-input').waitFor(); await page.getByRole('button', { name: 'Dictate a message', exact: true }).click();
    await page.evaluate(() => __qa.speechInstances[0].emit(0, [{ text: 'repeat', final: true }, { text: 'repeat', final: true }]));
    assert.equal(await page.locator('#chat-input').inputValue(), 'repeat repeat'); return { repeatedWordsPreserved: true };
  });
  await check('Dictation: browser removal of a trailing interim segment removes the stale text', async () => {
    const { page, context } = await makePage(); controllers.push(context);
    await page.goto(baseUrl + '/#coach'); await page.locator('#chat-input').waitFor(); await page.getByRole('button', { name: 'Dictate a message', exact: true }).click();
    await page.evaluate(() => __qa.speechInstances[0].emit(0, [{ text: 'final words', final: true }, { text: 'removed interim', final: false }]));
    await page.evaluate(() => __qa.speechInstances[0].emit(1, [{ text: 'final words', final: true }]));
    assert.equal(await page.locator('#chat-input').inputValue(), 'final words'); return { staleInterimRemoved: true };
  });
  for (const context of controllers) await context.close();
} finally {
  const report = { scope: 'New continuous voice and dictation reconciliation only', checkedAt: new Date().toISOString(), results, pageErrors: errors, limitations: ['WebRTC and microphone are controlled browser fakes; no paid API requests.', 'Physical phone microphone, speaker echo cancellation, and background behavior need owner confirmation.'] };
  writeFileSync(new URL(process.env.QA_SCOPE === 'ui' ? './voice-ui-browser-results.json' : './voice-browser-results.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  await browser.close(); await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true });
  if (results.some(result => !result.pass) || errors.length) process.exitCode = 1;
}
