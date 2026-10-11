import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { buildApplication } from '../server/bootstrap.js';
import { loadConfig } from '../server/config.js';

// Real CPU/WASM Whisper + Kokoro and actual Cache API/service worker. No microphone or paid model calls.
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE);
const dataDir = mkdtempSync(`${tmpdir()}/studychat-real-device-`), token = randomUUID();
const app = buildApplication({ config: loadConfig({ HOST: '127.0.0.1', PORT: '0', DATA_DIR: dataDir, STUDY_ACCESS_TOKEN: token }) });
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${app.server.address().port}`;
const checks = [], errors = [], requests = [], voices = [];
const quick = process.env.DEVICE_VOICE_QUICK === '1';
let browser, context, page;
const elapsed = () => Math.round(performance.now());
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  context = await browser.newContext({ viewport: { width: 390, height: 844 } }); page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  context.on('request', request => requests.push({ url: request.url(), method: request.method(), bytes: request.postDataBuffer()?.length || 0 }));
  await page.goto(origin); await page.getByLabel('Study access token').fill(token); await page.getByRole('button', { name: 'Open workspace', exact: true }).click(); await page.getByLabel('Message Coach').waitFor();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  console.log(JSON.stringify({ stage: 'installing actual model pack' }));
  const installStarted = elapsed();
  const installed = await page.evaluate(async () => { window.__device = await import('/device-voice.js'); const before = await window.__device.getDeviceVoiceStatus(); const result = before.installed ? before : await window.__device.installDeviceVoice(); const cache = await caches.open(`studychat-device-voice-${result.version}`); const manifest = await (await cache.match('/voice-assets/manifest.json')).json(); return { version: result.version, totalBytes: result.totalBytes, installed: result.installed, inferenceAssets: manifest.assets.filter(asset => asset.url.endsWith('.onnx') || asset.url.endsWith('.wasm') || asset.url === '/voice-assets/runtime.js').map(asset => ({ url: asset.url, sha256: asset.sha256 })) }; });
  const installMs = elapsed() - installStarted; assert.equal(installed.installed, true);
  checks.push('actual SHA-256-verified local model/runtime pack installed in browser Cache Storage');
  const postInstallRequestIndex = requests.length;
  console.log(JSON.stringify({ stage: 'warming actual CPU/WASM engines', installed }));
  const warmStarted = elapsed(); await page.evaluate(async () => { window.__voice = window.__device.createDeviceVoice(); await window.__voice.ready(); }); const warmMs = elapsed() - warmStarted;
  checks.push('actual local module worker initializes both CPU/WASM speech models under production CSP');
  const greeting = 'Hello. I would like to study today.';
  for (const voice of quick ? ['af_heart'] : ['af_heart', 'af_bella', 'af_nicole', 'am_michael', 'bf_emma']) {
    console.log(JSON.stringify({ stage: 'synthesizing actual device voice', voice }));
    const started = elapsed();
    const result = await page.evaluate(async ({ greeting, voice }) => {
      const blob = await window.__voice.speech({ content: greeting, voice }); const buffer = await blob.arrayBuffer(); const view = new DataView(buffer);
      if (view.getUint32(24, true) !== 24000 || view.getUint16(22, true) !== 1 || view.getUint16(34, true) !== 16) throw new Error('Unexpected real voice audio format.');
      let maximum = 0; for (let i = 44; i < buffer.byteLength; i += 2) maximum = Math.max(maximum, Math.abs(view.getInt16(i, true)));
      if (!maximum) throw new Error('Real voice audio was silent.');
      if (voice === 'af_heart') window.__greetingAudio = buffer;
      const digest = await crypto.subtle.digest('SHA-256', buffer); return { bytes: buffer.byteLength, durationSeconds: (buffer.byteLength - 44) / 48000, sha256: Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('') };
    }, { greeting, voice });
    voices.push({ voice, ...result, latencyMs: elapsed() - started });
  }
  assert.equal(new Set(voices.map(value => value.sha256)).size, quick ? 1 : 5);
  checks.push(quick ? 'actual Kokoro Heart produces non-silent PCM16 mono 24 kHz WAV audio' : 'all five actual Kokoro device voices produce distinct, non-silent PCM16 mono 24 kHz WAV audio');
  console.log(JSON.stringify({ stage: 'transcribing actual synthetic greeting on device' }));
  const transcription = await page.evaluate(async () => {
    window.__resampleWav = buffer => { const source = new DataView(buffer), count = (buffer.byteLength - 44) / 2, targetCount = Math.floor(count * 2 / 3), output = new ArrayBuffer(44 + targetCount * 2), view = new DataView(output); new Uint8Array(output, 0, 44).set(new Uint8Array(buffer, 0, 44)); view.setUint32(4, output.byteLength - 8, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint32(40, targetCount * 2, true); for (let index = 0; index < targetCount; index++) { const position = index * 1.5, low = Math.floor(position), high = Math.min(count - 1, low + 1), weight = position - low; view.setInt16(44 + index * 2, Math.round(source.getInt16(44 + low * 2, true) * (1 - weight) + source.getInt16(44 + high * 2, true) * weight), true); } return new Blob([output], { type: 'audio/wav' }); };
    return await window.__voice.transcribe({ audio: window.__resampleWav(window.__greetingAudio) });
  });
  assert.match(transcription.text, /study/i); checks.push('actual quantized Whisper recognizes the actual Kokoro synthetic greeting entirely on device');
  let longReply = null;
  if (!quick) {
  const longText = 'We can study one concept at a time. '.repeat(10) + 'The final word is apple.';
  console.log(JSON.stringify({ stage: 'testing long reply chunks', characters: longText.length }));
  const longStarted = elapsed();
  longReply = await page.evaluate(async content => { const blob = await window.__voice.speech({ content, voice: 'af_heart' }); window.__longAudio = await blob.arrayBuffer(); return { bytes: blob.size, durationSeconds: (blob.size - 44) / 48000 }; }, longText);
  longReply.latencyMs = elapsed() - longStarted; assert.ok(longReply.durationSeconds > voices[0].durationSeconds * 2);
  const longTranscript = await page.evaluate(async () => await window.__voice.transcribe({ audio: window.__resampleWav(window.__longAudio) }));
  assert.match(longTranscript.text, /apple/i);
  longReply.characters = longText.length; longReply.endingRecognized = true;
  checks.push('a reply exceeding the worker chunk limit speaks its ending; actual Whisper recognizes its final apple marker');
  }
  await page.evaluate(() => { window.__voice.destroy(); window.__voice = null; });
  const onlineLocalRequests = requests.slice(postInstallRequestIndex).filter(value => new URL(value.url).pathname.startsWith('/voice-assets/'));
  await context.setOffline(true);
  console.log(JSON.stringify({ stage: 'offline cached-shell reload and cold engine recreation' }));
  await page.reload({ waitUntil: 'domcontentloaded' });
  const offlineStarted = elapsed();
  const offline = await page.evaluate(async () => { const module = await import('/device-voice.js'); const status = await module.getDeviceVoiceStatus(); const runtime = module.createDeviceVoice(); await runtime.ready(); const audio = await runtime.speech({ content: 'The voices work on this device.', voice: 'bf_emma' }); runtime.destroy(); return { installed: status.installed, bytes: audio.size }; });
  offline.elapsedMs = elapsed() - offlineStarted; assert.equal(offline.installed, true); assert.ok(offline.bytes > 44);
  checks.push('offline cached-shell reload initializes a fresh worker from installed files and produces real speech without a network');
  await context.setOffline(false);
  assert.equal(requests.filter(value => new URL(value.url).pathname.startsWith('/api/voice')).length, 0);
  assert.equal(requests.filter(value => new URL(value.url).origin !== origin).length, 0);
  assert.equal(requests.filter(value => value.method === 'POST' && new URL(value.url).pathname !== '/api/login').length, 0);
  assert.deepEqual(errors, []);
  checks.push('no server speech endpoint, external CDN or uploaded audio requests; no paid answering-model calls or page errors');
  const result = { checkedAt: new Date().toISOString(), browser: await browser.version(), backend: 'CPU/WASM, one ONNX thread', mode: quick ? 'final-pack-smoke' : 'all-voices-and-chunking', actualModels: true, actualMicrophone: false, physicalPhoneTested: false, paidApiRequests: 0, serverSpeechRequests: 0, installed: { ...installed, installMs }, warmMs, voices, transcription, longReply, offline, postInstallAssetRequests: onlineLocalRequests.map(value => new URL(value.url).pathname), checks, errors };
  if (process.env.DEVICE_VOICE_RESULTS) writeFileSync(process.env.DEVICE_VOICE_RESULTS, JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result));
} catch (error) { console.error(JSON.stringify({ failure: error.message, checks, errors, requests: requests.map(value => new URL(value.url).pathname) })); throw error; }
finally { await browser?.close(); await app.shutdown(); rmSync(dataDir, { recursive: true, force: true }); }
