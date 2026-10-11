// One CPU-only worker owns both engines. Termination cancels inference and releases model memory.
const VOICES = new Set(['af_heart', 'af_bella', 'af_nicole', 'am_michael', 'bf_emma']);
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
let runtime = null, recognizer = null, synthesizer = null, packVersion = null, busy = false;

function wavSamples(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 44 || buffer.byteLength > 2 * 1024 * 1024) throw new Error('The recording is empty or too long.');
  const data = new DataView(buffer);
  const tag = offset => String.fromCharCode(...new Uint8Array(buffer, offset, 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || data.getUint32(4, true) + 8 !== buffer.byteLength) throw new Error('The recording must be a complete WAV file.');
  let format = false, samples = null, offset = 12;
  while (offset + 8 <= buffer.byteLength) {
    const name = tag(offset), length = data.getUint32(offset + 4, true), start = offset + 8;
    if (start + length > buffer.byteLength) throw new Error('The recording has an invalid WAV chunk.');
    if (name === 'fmt ') {
      if (format || length < 16 || data.getUint16(start, true) !== 1 || data.getUint16(start + 2, true) !== 1 || data.getUint32(start + 4, true) !== 16000 || data.getUint32(start + 8, true) !== 32000 || data.getUint16(start + 12, true) !== 2 || data.getUint16(start + 14, true) !== 16) throw new Error('The recording must be mono PCM16 audio at 16 kHz.');
      format = true;
    } else if (name === 'data') {
      if (samples || !format || length < 3840 || length > 16000 * 60 * 2 || length % 2) throw new Error('Record between 0.12 and 60 seconds of speech.');
      samples = new Float32Array(length / 2);
      for (let index = 0; index < samples.length; index++) samples[index] = data.getInt16(start + index * 2, true) / 32768;
    }
    offset = start + length + (length % 2);
  }
  if (!format || !samples || offset !== buffer.byteLength) throw new Error('The recording has no valid PCM audio.');
  return samples;
}
function encodeWav(parts, sampleCount) {
  if (!sampleCount || 44 + sampleCount * 2 > MAX_AUDIO_BYTES) throw new Error('This voice reply is too long. The complete text remains available.');
  const buffer = new ArrayBuffer(44 + sampleCount * 2), data = new DataView(buffer);
  const tag = (offset, text) => { for (let index = 0; index < text.length; index++) data.setUint8(offset + index, text.charCodeAt(index)); };
  tag(0, 'RIFF'); data.setUint32(4, buffer.byteLength - 8, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, 1, true);
  data.setUint32(24, 24000, true); data.setUint32(28, 48000, true); data.setUint16(32, 2, true); data.setUint16(34, 16, true);
  tag(36, 'data'); data.setUint32(40, sampleCount * 2, true);
  let offset = 44;
  for (const samples of parts) for (const value of samples) {
    if (!Number.isFinite(value)) throw new Error('Device speech generated invalid audio.');
    const clamped = Math.max(-1, Math.min(1, value)); data.setInt16(offset, Math.round(clamped * (clamped < 0 ? 32768 : 32767)), true); offset += 2;
  }
  return buffer;
}
async function load(pack) {
  if (!pack || !/^[A-Za-z0-9_-]{1,80}$/.test(pack.version) || pack.cacheName !== `studychat-device-voice-${pack.version}`) throw new Error('The installed voice pack is invalid.');
  if (packVersion && packVersion !== pack.version) throw new Error('The device voice pack changed. Close and reopen voice.');
  if (recognizer && synthesizer) return;
  const cache = await caches.open(pack.cacheName), marker = await cache.match('/voice-assets/install-status.json');
  if (!marker || (await marker.json()).version !== pack.version) throw new Error('Download the complete app voices before starting voice.');
  const saved = await cache.match('/voice-assets/manifest.json'); const manifest = saved && await saved.json();
  if (manifest?.version !== pack.version || !Array.isArray(manifest.assets)) throw new Error('The installed voice manifest is unavailable. Download the app voices again.');
  const assets = new Map(manifest.assets.map(asset => [new URL(asset.url, location.origin).href, asset]));
  // Transformers, ONNX and Kokoro can read only the previously verified local pack.
  // JavaScript module imports are served from the same completed pack by the app service worker.
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    const asset = assets.get(url.href);
    if (url.origin !== location.origin || !asset || (init?.method || (input instanceof Request ? input.method : 'GET')) !== 'GET') throw new Error('Device speech attempted to load a file outside its installed voice pack.');
    const response = await cache.match(url.href);
    if (!response || response.headers.get('X-StudyChat-SHA256') !== asset.sha256 || response.headers.get('X-StudyChat-Bytes') !== String(asset.bytes)) throw new Error('An installed voice file is missing. Download the app voices again.');
    return response;
  };
  // Import only after the cache guard is active; do not fetch vendor scripts from a CDN.
  runtime = await import('/voice-assets/runtime.js');
  if (typeof runtime.pipeline !== 'function' || !runtime.KokoroTTS || typeof runtime.phonemize !== 'function') throw new Error('The installed speech runtime is incomplete.');
  const env = runtime.env;
  env.allowRemoteModels = false; env.allowLocalModels = true; env.localModelPath = '/voice-assets/models/';
  env.useBrowserCache = false; env.useFS = false; env.useFSCache = false;
  env.backends.onnx.wasm.numThreads = 1; env.backends.onnx.wasm.proxy = false; env.backends.onnx.wasm.wasmPaths = '/voice-assets/ort/';
  // Serial model initialization avoids peak allocation of two simultaneous model downloads.
  recognizer = await runtime.pipeline('automatic-speech-recognition', 'whisper', { device: 'wasm', dtype: 'q8' });
  synthesizer = await runtime.KokoroTTS.from_pretrained('kokoro', { device: 'wasm', dtype: 'q8' });
  packVersion = pack.version;
}
async function transcribe(payload) {
  const samples = wavSamples(payload?.audio), started = performance.now();
  let energy = 0; for (const value of samples) energy += value * value;
  if (Math.sqrt(energy / samples.length) < 0.0005) return { text: '', metadata: { provider: 'device-whisper', durationSeconds: samples.length / 16000, elapsedMs: 0 } };
  const result = await recognizer(samples, { chunk_length_s: 30, stride_length_s: 5, return_timestamps: false, max_new_tokens: 440 });
  const text = typeof result?.text === 'string' ? result.text.trim() : '';
  if (text.length > 8000) throw new Error('The transcript is too long. Try a shorter recording.');
  return { text, metadata: { provider: 'device-whisper', durationSeconds: samples.length / 16000, elapsedMs: Math.round(performance.now() - started) } };
}
function splitText(text) {
  // Bound each first pass by words and punctuation; tokenizer validation below is the final limit.
  const pieces = []; let remaining = text.trim();
  while (remaining.length > 240) {
    const window = remaining.slice(0, 241);
    const punctuation = [...window.matchAll(/[.!?;:\n]\s+/g)].at(-1);
    let cut = punctuation && punctuation.index > 40 ? punctuation.index + punctuation[0].length : window.lastIndexOf(' ');
    if (cut < 1) cut = 240;
    pieces.push(remaining.slice(0, cut).trim()); remaining = remaining.slice(cut).trim();
  }
  if (remaining) pieces.push(remaining);
  return pieces;
}
async function tokenize(text, voice, depth = 0) {
  const phonemes = await runtime.phonemize(text, voice[0]);
  const { input_ids } = synthesizer.tokenizer(phonemes, { truncation: false });
  const length = input_ids?.dims?.at(-1);
  if (!Number.isInteger(length) || length < 2) throw new Error('Device voice could not tokenize this reply.');
  if (length <= 510) return [input_ids];
  if (depth > 12 || text.length < 2) throw new Error('Part of this reply cannot be spoken. The complete text remains available.');
  const midpoint = Math.floor(text.length / 2);
  const leftSpace = text.lastIndexOf(' ', midpoint), rightSpace = text.indexOf(' ', midpoint);
  let cut = leftSpace > 0 ? leftSpace : rightSpace > 0 ? rightSpace : midpoint;
  if (cut <= 0 || cut >= text.length) cut = midpoint;
  return [...await tokenize(text.slice(0, cut).trim(), voice, depth + 1), ...await tokenize(text.slice(cut).trim(), voice, depth + 1)];
}
async function speech(payload) {
  const content = payload?.content, voice = payload?.voice;
  if (typeof content !== 'string' || !content.trim() || content.length > 4096 || !VOICES.has(voice)) throw new Error('Choose an installed voice and a reply of at most 4096 characters.');
  const audio = []; let sampleCount = 0;
  for (const text of splitText(content)) {
    for (const inputIds of await tokenize(text, voice)) {
      const output = await synthesizer.generate_from_ids(inputIds, { voice, speed: 1 });
      if (output?.sampling_rate !== 24000 || !(output.audio instanceof Float32Array) || !output.audio.length) throw new Error('Device voice returned invalid audio.');
      sampleCount += output.audio.length;
      if (44 + sampleCount * 2 > MAX_AUDIO_BYTES) throw new Error('This voice reply is too long. The complete text remains available.');
      // Copy the result: a later ONNX run can reuse the previous tensor's memory.
      audio.push(output.audio.slice());
    }
  }
  return { audio: encodeWav(audio, sampleCount), sampleRate: 24000 };
}
self.onmessage = async event => {
  const { id, type, payload, pack } = event.data || {};
  if (typeof id !== 'string' || !['ready', 'transcribe', 'speech'].includes(type)) return;
  if (busy) { self.postMessage({ id, type: 'error', error: { message: 'Another device speech operation is running.', code: 'busy' } }); return; }
  busy = true;
  try {
    await load(pack);
    const result = type === 'ready' ? { ready: true, sampleRate: 24000 } : type === 'transcribe' ? await transcribe(payload) : await speech(payload);
    self.postMessage({ id, type: 'result', result }, result.audio instanceof ArrayBuffer ? [result.audio] : []);
  } catch (error) { self.postMessage({ id, type: 'error', error: { message: error.message || 'Device speech could not finish. Use typed chat.', code: error.name || 'speech_failed' } }); }
  finally { busy = false; }
};
