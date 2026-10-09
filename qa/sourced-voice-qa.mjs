import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const moduleText = readFileSync(new URL('../public/sourced-voice.js', import.meta.url));
const server = createServer((request, response) => {
  if (request.url === '/sourced-voice.js') { response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end(moduleText); return; }
  response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><html><head><meta charset="utf-8"><title>Sourced study voice QA</title></head><body><p id="state"></p></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, headless: true, args: ['--no-sandbox'] });
const results = [], pageErrors = [];
const contexts = [];
const check = async (name, fn) => {
  if (process.env.QA_ONLY && !new RegExp(process.env.QA_ONLY).test(name)) return;
  try { results.push({ name, pass: true, detail: await fn() }); }
  catch (error) { results.push({ name, pass: false, error: error.message }); }
  console.log(JSON.stringify(results.at(-1)));
};
async function controllerPage() {
  const context = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true }); contexts.push(context);
  await context.addInitScript(() => {
    const qa = window.__qa = { recognizers: [], spoken: [], cancelled: 0, requests: [], states: [], timers: new Map(), timerId: 0, mode: 'success', pending: null, startError: false };
    class FakeRecognition {
      constructor() { this.started = 0; this.stopped = 0; this.aborted = 0; this.micActive = false; qa.recognizers.push(this); }
      start() { this.started++; if (qa.startError) throw new Error('Mock browser cannot start.'); this.micActive = true; if (!qa.startSilent) this.onstart?.(); }
      stop() { this.stopped++; }
      abort() { this.aborted++; this.micActive = false; this.onend?.(); }
      emit(resultIndex, values) { const results = values.map(value => Object.assign([{ transcript: value.text }], { isFinal: value.final })); this.onresult?.({ resultIndex, results }); }
      end() { this.micActive = false; this.onend?.(); }
      error(error) { this.onerror?.({ error }); }
    }
    window.SpeechRecognition = FakeRecognition;
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    const synthesis = { speak(utterance) { qa.spoken.push(utterance); if (!qa.speechSilent) utterance.onstart?.(); }, cancel() { qa.cancelled++; } };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synthesis });
    qa.synthesis = synthesis;
    qa.sendTurn = async value => {
      qa.requests.push(value);
      if (qa.mode === 'pending') return await new Promise(resolve => { qa.pending = resolve; });
      if (qa.mode === 'failure') throw new Error('The study request failed. No retry was made.');
      return { content: qa.reply || 'Source-linked original study reply. Source: [NIH-1].', sourceVerified: qa.mode !== 'unverified' };
    };
    qa.windowImpl = {
      isSecureContext: window.isSecureContext, SpeechRecognition: FakeRecognition,
      speechSynthesis: synthesis, SpeechSynthesisUtterance: window.SpeechSynthesisUtterance,
      AbortController: window.AbortController, crypto: window.crypto,
      setTimeout(callback, delay) { const id = ++qa.timerId; qa.timers.set(id, { callback, delay }); return id; },
      clearTimeout(id) { qa.timers.delete(id); },
      addEventListener: window.addEventListener.bind(window), removeEventListener: window.removeEventListener.bind(window),
    };
    qa.fireTimer = delay => { const entry = [...qa.timers.entries()].find(([, value]) => value.delay === delay); if (entry) { qa.timers.delete(entry[0]); entry[1].callback(); } };
    qa.finalTurn = text => { const recognizer = qa.recognizers.at(-1); recognizer.emit(0, [{ text, final: true }]); recognizer.end(); };
  });
  const page = await context.newPage(); page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(async () => {
    const { createSourcedVoiceCoach } = await import('/sourced-voice.js');
    window.__coach = createSourcedVoiceCoach({ sendTurn: __qa.sendTurn, windowImpl: __qa.windowImpl, onState(value) { __qa.states.push(value); document.querySelector('#state').textContent = value.message; } });
  });
  return page;
}
try {
  await check('Explicit Start opens one recognizer, creates no greeting or model request, and prevents overlapping Start', async () => {
    const page = await controllerPage();
    assert.equal(await page.evaluate(() => __qa.recognizers.length), 0);
    await page.evaluate(async () => { await Promise.all([__coach.start({ conversationId: 'study-test' }), __coach.start({ conversationId: 'study-test' })]); });
    const measured = await page.evaluate(() => ({ recognizers: __qa.recognizers.length, requests: __qa.requests.length, phase: __coach.state().phase, continuous: __qa.recognizers[0].continuous, active: __coach.active() }));
    assert.deepEqual(measured, { recognizers: 1, requests: 0, phase: 'listening', continuous: false, active: true });
    await page.evaluate(() => __coach.stop()); return measured;
  });
  await check('Revised interim and duplicate finals produce one ordered text turn; the microphone stays off during canonical reply reading', async () => {
    const page = await controllerPage(); await page.evaluate(() => __coach.start({ conversationId: 'study-test' }));
    await page.evaluate(() => {
      __qa.reply = ('Exact source-linked study text. [NIH-1]\n').repeat(55);
      const r = __qa.recognizers[0];
      r.emit(0, [{ text: 'explain diabetes diabetes', final: false }]);
      r.emit(0, [{ text: 'explain diabetes', final: false }]);
      r.emit(0, [{ text: 'explain diabetes', final: true }, { text: 'for an exam', final: true }]);
      r.emit(0, [{ text: 'explain diabetes', final: true }, { text: 'for an exam', final: true }]);
    });
    assert.equal(await page.evaluate(() => __qa.requests.length), 0);
    await page.evaluate(() => __qa.recognizers[0].end());
    await page.waitForFunction(() => __qa.spoken.length === 1);
    const measured = await page.evaluate(() => ({ requests: __qa.requests.length, content: __qa.requests[0].content, conversationId: __qa.requests[0].conversationId, mic: __qa.recognizers[0].micActive, phase: __coach.state().phase }));
    assert.deepEqual(measured, { requests: 1, content: 'explain diabetes for an exam', conversationId: 'study-test', mic: false, phase: 'speaking' });
    const spoken = await page.evaluate(() => { let guard = 100; while (__coach.state().phase === 'speaking' && guard--) __qa.spoken.at(-1).onend?.(); return { text: __qa.spoken.map(value => value.text).join(''), expected: __qa.reply, recognizers: __qa.recognizers.length, requests: __qa.requests.length, phase: __coach.state().phase }; });
    assert.equal(spoken.text, spoken.expected); assert.equal(spoken.recognizers, 2); assert.equal(spoken.requests, 1); assert.equal(spoken.phase, 'listening');
    await page.evaluate(() => __coach.stop()); return { ...measured, unchangedReplyCharacters: spoken.text.length, nextRecognizerStarts: 1 };
  });
  await check('Mute and Unmute affect capture; Interrupt stops reading without replaying a late completion; Stop clears all resources', async () => {
    const page = await controllerPage(); await page.evaluate(() => __coach.start());
    await page.evaluate(() => __coach.toggleMute());
    assert.equal(await page.evaluate(() => __qa.recognizers[0].micActive), false); assert.equal(await page.evaluate(() => __coach.state().muted), true);
    await page.evaluate(() => __coach.toggleMute()); assert.equal(await page.evaluate(() => __qa.recognizers.length), 2);
    await page.evaluate(() => __qa.finalTurn('Quiz me.')); await page.waitForFunction(() => __qa.spoken.length === 1);
    await page.evaluate(() => { window.__lateEnd = __qa.spoken[0].onend; __coach.interrupt(); __lateEnd(); });
    assert.equal(await page.evaluate(() => __qa.recognizers.length), 3); assert.equal(await page.evaluate(() => __qa.requests.length), 1);
    await page.evaluate(() => __coach.stop());
    const measured = await page.evaluate(() => ({ phase: __coach.state().phase, microphonesActive: __qa.recognizers.filter(value => value.micActive).length, timers: __qa.timers.size, active: __coach.active() }));
    assert.deepEqual(measured, { phase: 'idle', microphonesActive: 0, timers: 0, active: false }); return measured;
  });
  await check('Stop aborts a pending text request and a late response cannot speak or restart capture', async () => {
    const page = await controllerPage(); await page.evaluate(() => { __qa.mode = 'pending'; __coach.start(); __qa.finalTurn('What should I study?'); });
    await page.waitForFunction(() => Boolean(__qa.pending));
    await page.evaluate(() => { __coach.stop(); __qa.pending({ content: 'Late source-linked reply.', sourceVerified: true }); });
    await page.waitForFunction(() => __qa.requests[0].signal.aborted);
    const measured = await page.evaluate(() => ({ aborted: __qa.requests[0].signal.aborted, requests: __qa.requests.length, spoken: __qa.spoken.length, recognizers: __qa.recognizers.length, phase: __coach.state().phase }));
    assert.deepEqual(measured, { aborted: true, requests: 1, spoken: 0, recognizers: 1, phase: 'idle' }); return measured;
  });
  await check('Interrupt cancels a pending reply; only a newly recognized turn may get a new canonical reply', async () => {
    const page = await controllerPage(); await page.evaluate(() => { __qa.mode = 'pending'; __coach.start(); __qa.finalTurn('First question.'); });
    await page.waitForFunction(() => Boolean(__qa.pending));
    await page.evaluate(() => { const resolve = __qa.pending; __coach.interrupt(); resolve({ content: 'Cancelled source-linked reply.', sourceVerified: true }); });
    assert.equal(await page.evaluate(() => __qa.requests[0].signal.aborted), true);
    await page.evaluate(() => { __qa.mode = 'success'; __qa.finalTurn('New question.'); }); await page.waitForFunction(() => __qa.spoken.length === 1);
    assert.equal(await page.evaluate(() => __qa.requests.length), 2); assert.equal(await page.evaluate(() => __qa.requests[1].content), 'New question.');
    assert(!await page.evaluate(() => __qa.spoken.some(value => value.text.includes('Cancelled'))));
    await page.evaluate(() => __coach.stop()); return { requests: 2, cancelledReplyRead: false };
  });
  await check('Background and page exit stop capture, abort pending work, and suppress late playback', async () => {
    const page = await controllerPage(); await page.evaluate(() => { __qa.mode = 'pending'; __coach.start(); __qa.finalTurn('Explain a study topic.'); });
    await page.waitForFunction(() => Boolean(__qa.pending));
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); __qa.pending({ content: 'A late reply.', sourceVerified: true }); });
    assert.equal(await page.evaluate(() => __qa.requests[0].signal.aborted), true); assert.equal(await page.evaluate(() => __qa.spoken.length), 0);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); __qa.mode = 'success'; __coach.start(); __qa.finalTurn('Quiz again.'); });
    await page.waitForFunction(() => __qa.spoken.length === 1); await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    const measured = await page.evaluate(() => ({ active: __coach.active(), phase: __coach.state().phase, microphonesActive: __qa.recognizers.filter(value => value.micActive).length }));
    assert.deepEqual(measured, { active: false, phase: 'idle', microphonesActive: 0 }); return measured;
  });
  await check('Permission denial and browser-start failure surface fallback text without request retries', async () => {
    const page = await controllerPage(); await page.evaluate(() => { __coach.start(); __qa.recognizers[0].error('not-allowed'); });
    assert.match(await page.evaluate(() => __coach.state().message), /permission was denied/i);
    assert.equal(await page.evaluate(() => __qa.requests.length), 0);
    await page.evaluate(() => { __qa.startError = true; __coach.start(); });
    assert.match(await page.evaluate(() => __coach.state().message), /keyboard dictation/i);
    const measured = await page.evaluate(() => ({ phase: __coach.state().phase, requests: __qa.requests.length, active: __coach.active() }));
    assert.deepEqual(measured, { phase: 'error', requests: 0, active: false }); return measured;
  });
  await check('Read-aloud failure pauses without microphone echo; explicit Read reply retries exact text only', async () => {
    const page = await controllerPage(); await page.evaluate(() => { __coach.start(); __qa.finalTurn('Source-linked question.'); });
    await page.waitForFunction(() => __qa.spoken.length === 1);
    await page.evaluate(() => __qa.spoken[0].onerror({ error: 'not-allowed' }));
    const paused = await page.evaluate(() => ({ audioBlocked: __coach.state().audioBlocked, phase: __coach.state().phase, recognizers: __qa.recognizers.length }));
    assert.deepEqual(paused, { audioBlocked: true, phase: 'paused', recognizers: 1 });
    await page.evaluate(() => __coach.playAudio());
    assert.equal(await page.evaluate(() => __qa.requests.length), 1); assert.equal(await page.evaluate(() => __qa.spoken[0].text === __qa.spoken[1].text), true);
    await page.evaluate(() => __qa.spoken[1].onend()); assert.equal(await page.evaluate(() => __qa.recognizers.length), 2);
    await page.evaluate(() => __coach.stop()); return { audioBlockedShown: true, explicitSpeechRetries: 1, requestRetries: 0 };
  });
  await check('Unsupported browser rejects voice transparently and leaves keyboard dictation available', async () => {
    const page = await controllerPage();
    const measured = await page.evaluate(async () => { __qa.windowImpl.speechSynthesis = null; try { await __coach.start(); return {}; } catch (error) { return { message: error.message, requests: __qa.requests.length, recognizers: __qa.recognizers.length, active: __coach.active() }; } });
    assert.match(measured.message, /unsupported browsers/i); assert.equal(measured.requests, 0); assert.equal(measured.recognizers, 0); assert.equal(measured.active, false); return measured;
  });
  await check('Ten-minute limit aborts pending work; unchecked returned text is never spoken', async () => {
    const page = await controllerPage(); await page.evaluate(() => { __qa.mode = 'pending'; __coach.start(); __qa.finalTurn('A study question.'); });
    await page.waitForFunction(() => Boolean(__qa.pending));
    await page.evaluate(() => { __qa.fireTimer(600000); __qa.pending({ content: 'Expired reply.', sourceVerified: true }); });
    assert.equal(await page.evaluate(() => __qa.requests[0].signal.aborted), true); assert.match(await page.evaluate(() => __coach.state().message), /ten-minute/i);
    await page.evaluate(() => { __qa.mode = 'unverified'; __coach.start(); __qa.finalTurn('Another question.'); }); await page.waitForFunction(() => __coach.state().phase === 'error');
    const measured = await page.evaluate(() => ({ spoken: __qa.spoken.length, active: __coach.active(), message: __coach.state().message }));
    assert.equal(measured.spoken, 0); assert.equal(measured.active, false); assert.match(measured.message, /not marked as canonical/i); return measured;
  });
  await check('Interim-only recognition does not submit a guessed transcript or automatically reopen a microphone', async () => {
    const page = await controllerPage(); await page.evaluate(() => { __coach.start(); __qa.recognizers[0].emit(0, [{ text: 'unfinished words', final: false }]); __qa.recognizers[0].end(); });
    const measured = await page.evaluate(() => ({ requests: __qa.requests.length, recognizers: __qa.recognizers.length, phase: __coach.state().phase, message: __coach.state().message }));
    assert.equal(measured.requests, 0); assert.equal(measured.recognizers, 1); assert.equal(measured.phase, 'error'); assert.match(measured.message, /No final speech/i); return measured;
  });
  await check('Unresponsive recognition start or stop and a failed text request surface errors without automatic retries', async () => {
    const page = await controllerPage();
    await page.evaluate(() => { __qa.startSilent = true; __coach.start(); __qa.fireTimer(15000); });
    assert.match(await page.evaluate(() => __coach.state().message), /did not start/i);
    await page.evaluate(() => { __qa.startSilent = false; __coach.start(); __qa.recognizers.at(-1).emit(0, [{ text: 'Final words.', final: true }]); __qa.fireTimer(3000); });
    assert.match(await page.evaluate(() => __coach.state().message), /did not finish stopping/i);
    assert.equal(await page.evaluate(() => __qa.requests.length), 0);
    await page.evaluate(() => { __qa.mode = 'failure'; __coach.start(); __qa.finalTurn('Try a new study question.'); }); await page.waitForFunction(() => __coach.state().phase === 'error');
    const measured = await page.evaluate(() => ({ requests: __qa.requests.length, spoken: __qa.spoken.length, microphonesActive: __qa.recognizers.filter(value => value.micActive).length, phase: __coach.state().phase }));
    assert.deepEqual(measured, { requests: 1, spoken: 0, microphonesActive: 0, phase: 'error' }); return measured;
  });
  await check('Silent speech startup pauses with a visible Read reply fallback and keeps the microphone off', async () => {
    const page = await controllerPage();
    await page.evaluate(() => { __qa.speechSilent = true; __coach.start(); __qa.finalTurn('A source-linked study question.'); }); await page.waitForFunction(() => __qa.spoken.length === 1);
    await page.evaluate(() => __qa.fireTimer(10000));
    const measured = await page.evaluate(() => ({ phase: __coach.state().phase, blocked: __coach.state().audioBlocked, microphonesActive: __qa.recognizers.filter(value => value.micActive).length, requests: __qa.requests.length }));
    assert.deepEqual(measured, { phase: 'paused', blocked: true, microphonesActive: 0, requests: 1 });
    await page.evaluate(() => __coach.stop()); return measured;
  });
  assert.equal(pageErrors.length, 0, `Browser errors: ${pageErrors.join('; ')}`);
} finally {
  for (const context of contexts) await context.close();
  await browser.close(); await new Promise(resolve => server.close(resolve));
  const resultFile = new URL('./sourced-voice-results.json', import.meta.url);
  const previous = process.env.QA_ONLY && existsSync(resultFile) ? JSON.parse(readFileSync(resultFile, 'utf8')).results : [];
  const combined = [...previous.filter(value => !results.some(newValue => newValue.name === value.name)), ...results];
  const output = { checkedAt: new Date().toISOString(), kind: 'mock-browser-source-canonical-voice', paidProviderCalls: 0, physicalPhoneVerified: false, passed: combined.filter(value => value.pass).length, failed: combined.filter(value => !value.pass).length, pageErrors, results: combined };
  writeFileSync(resultFile, JSON.stringify(output, null, 2) + '\n');
}
if (results.some(value => !value.pass) || pageErrors.length) process.exitCode = 1;
