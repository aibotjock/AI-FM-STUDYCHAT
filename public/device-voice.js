// Speech models and recordings stay on this device. Chat still uses the selected chat provider.
export const DEVICE_VOICE_CHOICES = Object.freeze([
  { id: 'af_heart', label: 'Heart' }, { id: 'af_bella', label: 'Bella' },
  { id: 'af_nicole', label: 'Nicole' }, { id: 'am_michael', label: 'Michael' },
  { id: 'bf_emma', label: 'Emma' },
].map(Object.freeze));
export const DEVICE_VOICE_IDS = Object.freeze(DEVICE_VOICE_CHOICES.map(value => value.id));
export const DEFAULT_DEVICE_VOICE = 'af_heart';

const MANIFEST_URL = '/voice-assets/manifest.json';
const CANDIDATE_URL = '/voice-assets/download-manifest.json';
const MARKER_URL = '/voice-assets/install-status.json';
const METADATA_CACHE = 'studychat-device-voice-metadata';
const PACK_PREFIX = 'studychat-device-voice-';
const MAX_PACK_BYTES = 512 * 1024 * 1024;
const MAX_ASSET_BYTES = 256 * 1024 * 1024;
let installing = false;

function abortError() { return new DOMException('Voice operation cancelled.', 'AbortError'); }
function checkAbort(signal) { if (signal?.aborted) throw signal.reason || abortError(); }
function capabilityReason() {
  if (!globalThis.isSecureContext) return 'Device voice requires HTTPS or localhost.';
  if (!globalThis.Worker || !globalThis.WebAssembly || !globalThis.caches || !globalThis.crypto?.subtle) return 'This browser cannot run and store the device voice models. Use a current browser or typed chat.';
  return '';
}
function validateManifest(value) {
  if (!value || !/^[A-Za-z0-9_-]{1,80}$/.test(value.version) || !Array.isArray(value.assets) || !value.assets.length || value.assets.length > 96) throw new Error('The device voice download manifest is invalid.');
  const seen = new Set(); let totalBytes = 0;
  const assets = value.assets.map(asset => {
    if (!asset || typeof asset.url !== 'string' || !asset.url.startsWith('/voice-assets/') || asset.url.includes('\\') || asset.url.includes('%') || asset.url.includes('?') || asset.url.includes('#')) throw new Error('The device voice asset path is invalid.');
    const url = new URL(asset.url, location.origin);
    if (url.origin !== location.origin || url.pathname !== asset.url || [MANIFEST_URL, CANDIDATE_URL, MARKER_URL].includes(asset.url) || seen.has(asset.url)) throw new Error('The device voice asset path is invalid.');
    if (!Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 || asset.bytes > MAX_ASSET_BYTES || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error('The device voice asset integrity record is invalid.');
    seen.add(asset.url); totalBytes += asset.bytes;
    return { url: asset.url, bytes: asset.bytes, sha256: asset.sha256 };
  });
  if (totalBytes > MAX_PACK_BYTES || !seen.has('/voice-assets/runtime.js')) throw new Error('The device voice download is too large or incomplete.');
  return { version: value.version, assets, totalBytes };
}
async function manifest({ signal, localOnly = false } = {}) {
  checkAbort(signal);
  const metadata = await caches.open(METADATA_CACHE);
  if (localOnly) {
    const pointer = await metadata.match(MARKER_URL); const active = pointer && await pointer.json();
    if (!active || !/^[A-Za-z0-9_-]{1,80}$/.test(active.version) || active.cacheName !== `${PACK_PREFIX}${active.version}`) throw new Error('Download the app voices before starting a voice conversation.');
    const saved = await (await caches.open(active.cacheName)).match(MANIFEST_URL);
    if (!saved) throw new Error('The installed voice manifest is missing. Download the app voices again.');
    return validateManifest(await saved.json());
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('The voice download server is taking too long to respond. Try again.')), 15000);
  try {
    const response = await fetch(MANIFEST_URL, { cache: 'no-store', credentials: 'same-origin', signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal });
    if (!response.ok) throw new Error('The device voice download is not available yet. Typed chat remains available.');
    const raw = await response.text();
    if (raw.length > 65536) throw new Error('The device voice manifest is too large.');
    const value = validateManifest(JSON.parse(raw));
    checkAbort(signal);
    await metadata.put(CANDIDATE_URL, new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }));
    return value;
  } catch (error) {
    checkAbort(signal);
    const saved = await metadata.match(CANDIDATE_URL) || await metadata.match(MANIFEST_URL);
    if (!saved) throw error;
    return validateManifest(await saved.json());
  } finally { clearTimeout(timeout); }
}
function verified(response, asset) {
  return response?.ok && response.headers.get('X-StudyChat-SHA256') === asset.sha256 && response.headers.get('X-StudyChat-Bytes') === String(asset.bytes);
}
async function inspectPack(value) {
  const cacheName = `${PACK_PREFIX}${value.version}`;
  const cache = await caches.open(cacheName);
  let downloadedBytes = 0;
  // Read cache metadata, without loading hundreds of megabytes into memory.
  for (const asset of value.assets) if (verified(await cache.match(asset.url), asset)) downloadedBytes += asset.bytes;
  const marker = await cache.match(MARKER_URL);
  const metadata = await caches.open(METADATA_CACHE), active = await metadata.match(MARKER_URL);
  let installed = false;
  if (marker && active && downloadedBytes === value.totalBytes) {
    try {
      const record = await marker.json(), pointer = await active.json();
      installed = record.version === value.version && record.totalBytes === value.totalBytes && pointer.version === value.version && pointer.cacheName === cacheName;
    } catch {}
  }
  return { installed, downloadedBytes, cacheName, cache };
}
function status(value = {}, extra = {}) {
  return { supported: !capabilityReason(), installed: false, updateAvailable: false, totalBytes: value.totalBytes || 0, downloadedBytes: 0, version: value.version || null, downloadVersion: value.version || null, reason: '', voices: DEVICE_VOICE_CHOICES, defaultVoice: DEFAULT_DEVICE_VOICE, ...extra };
}
export async function getDeviceVoiceStatus({ signal } = {}) {
  const reason = capabilityReason();
  if (reason) return status({}, { supported: false, reason });
  try {
    const value = await manifest({ signal }); const pack = await inspectPack(value); checkAbort(signal);
    if (!pack.installed) {
      try {
        const active = await manifest({ signal, localOnly: true }), installed = await inspectPack(active); checkAbort(signal);
        if (installed.installed) return status(value, { installed: true, updateAvailable: active.version !== value.version, version: active.version, downloadedBytes: pack.downloadedBytes });
      } catch (error) { checkAbort(signal); }
    }
    return status(value, { installed: pack.installed, downloadedBytes: pack.downloadedBytes });
  } catch (error) { checkAbort(signal); return status({}, { reason: error.message || 'The device voice download is unavailable.' }); }
}
export const getStatus = getDeviceVoiceStatus;

async function downloadAsset(asset, cache, { signal, progress }) {
  checkAbort(signal);
  const response = await fetch(asset.url, { cache: 'no-store', credentials: 'same-origin', signal });
  if (!response.ok || response.type === 'opaque' || response.redirected) throw new Error('A device voice file could not be downloaded. Try again to resume.');
  const contentLength = Number(response.headers.get('Content-Length'));
  // Fetch decodes compressed transport bodies; integrity applies to the decoded file.
  if (contentLength && !response.headers.get('Content-Encoding') && contentLength !== asset.bytes) throw new Error('A device voice file has an unexpected size. Try downloading again.');
  const bytes = new Uint8Array(asset.bytes); let received = 0;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    try {
      for (;;) {
        checkAbort(signal); const chunk = await reader.read(); if (chunk.done) break;
        if (received + chunk.value.byteLength > bytes.length) throw new Error('A device voice file exceeds its download limit.');
        bytes.set(chunk.value, received); received += chunk.value.byteLength; progress(received, 'downloading');
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  } else {
    const data = new Uint8Array(await response.arrayBuffer());
    if (data.length !== bytes.length) throw new Error('A device voice file download is incomplete.');
    bytes.set(data); received = data.length; progress(received, 'downloading');
  }
  if (received !== asset.bytes) throw new Error('A device voice file download is incomplete. Try again to resume.');
  checkAbort(signal); progress(received, 'verifying');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hash = Array.from(digest, value => value.toString(16).padStart(2, '0')).join('');
  if (hash !== asset.sha256) throw new Error('A device voice file failed its integrity check. Try downloading again.');
  checkAbort(signal);
  const headers = new Headers({ 'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream', 'Content-Length': String(asset.bytes), 'X-StudyChat-SHA256': asset.sha256, 'X-StudyChat-Bytes': String(asset.bytes) });
  await cache.put(asset.url, new Response(bytes, { headers }));
  checkAbort(signal);
}
export async function installDeviceVoice({ signal, onProgress } = {}) {
  const reason = capabilityReason(); if (reason) throw new Error(reason);
  if (installing) throw new Error('The device voice download is already in progress.');
  installing = true;
  try {
    const value = await manifest({ signal }); const pack = await inspectPack(value); checkAbort(signal);
    const remaining = value.totalBytes - pack.downloadedBytes;
    if (navigator.storage?.estimate && remaining) {
      const space = await navigator.storage.estimate();
      if (Number.isFinite(space.quota) && Number.isFinite(space.usage) && space.quota - space.usage < remaining * 1.1) throw new Error('There is not enough browser storage for the device voice download. Free some space and try again.');
    }
    let completedBytes = pack.downloadedBytes; let filesDone = 0;
    const notify = (stage, file = '', fileBytes = 0) => onProgress?.({ stage, downloadedBytes: completedBytes + fileBytes, totalBytes: value.totalBytes, file, filesDone, filesTotal: value.assets.length });
    notify('downloading');
    for (const asset of value.assets) {
      checkAbort(signal);
      if (verified(await pack.cache.match(asset.url), asset)) { filesDone++; continue; }
      await downloadAsset(asset, pack.cache, { signal, progress: (bytes, stage) => notify(stage, asset.url, bytes) });
      completedBytes += asset.bytes; filesDone++; notify('downloading', asset.url);
    }
    checkAbort(signal);
    // The service worker serves a pack only after this final atomic cache write.
    const metadata = await caches.open(METADATA_CACHE);
    const savedManifest = new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
    await pack.cache.put(MANIFEST_URL, savedManifest.clone());
    const marker = new Response(JSON.stringify({ version: value.version, totalBytes: value.totalBytes, cacheName: pack.cacheName }), { headers: { 'Content-Type': 'application/json' } });
    await pack.cache.put(MARKER_URL, marker.clone());
    await metadata.put(MANIFEST_URL, savedManifest);
    await metadata.put(MARKER_URL, marker);
    checkAbort(signal);
    await navigator.storage?.persist?.().catch(() => false);
    // Avoid keeping successive, large model packs after an upgrade completes.
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(PACK_PREFIX) && name !== METADATA_CACHE && name !== pack.cacheName).map(name => caches.delete(name)));
    notify('complete');
    return status(value, { installed: true, downloadedBytes: value.totalBytes });
  } catch (error) {
    if (error.name === 'QuotaExceededError') throw new Error('Browser storage filled during the voice download. Free some space, then retry to resume.');
    throw error;
  } finally { installing = false; }
}
export const install = installDeviceVoice;

export function createDeviceVoice() {
  let worker = null, generation = 0, workerGeneration = 0, sequence = 0, closed = false, pending = null, readyVersion = null, readyStatus = null;
  function terminate(error = abortError()) {
    generation++; workerGeneration++; readyVersion = null; readyStatus = null; worker?.terminate(); worker = null;
    const job = pending; pending = null;
    if (job) { clearTimeout(job.timer); job.signal?.removeEventListener('abort', job.abort); job.reject(error); }
  }
  function run(type, payload, pack, { signal, transfer = [] } = {}) {
    checkAbort(signal);
    if (closed) return Promise.reject(new Error('This voice session is closed.'));
    if (pending) return Promise.reject(new Error('Another device voice operation is still running.'));
    if (!worker) {
      worker = new Worker('/device-voice-worker.js', { type: 'module', name: 'studychat-device-voice' });
      const epoch = workerGeneration;
      worker.onmessage = event => {
        if (epoch !== workerGeneration || !pending || event.data?.id !== pending.id) return;
        const message = event.data;
        if (message.type !== 'result' && message.type !== 'error') return;
        const job = pending; pending = null; clearTimeout(job.timer); job.signal?.removeEventListener('abort', job.abort);
        if (message.type === 'error') { const error = new Error(message.error?.message || 'Device voice could not finish. Use typed chat.'); error.code = message.error?.code; terminate(error); job.reject(error); }
        else job.resolve(message.result);
      };
      worker.onerror = event => { if (epoch === workerGeneration) { event.preventDefault(); terminate(new Error('The device speech engine could not run. Use typed chat or try voice again.')); } };
      worker.onmessageerror = () => { if (epoch === workerGeneration) terminate(new Error('The device speech engine returned an invalid result.')); };
    }
    const id = `${generation}:${++sequence}`;
    return new Promise((resolve, reject) => {
      const abort = () => terminate(signal?.reason || abortError());
      const timer = setTimeout(() => terminate(new Error('Device speech took too long. Use typed chat or try a shorter message.')), type === 'ready' ? 180000 : 300000);
      pending = { id, resolve, reject, signal, abort, timer }; signal?.addEventListener('abort', abort, { once: true });
      try { worker.postMessage({ id, type, payload, pack: { version: pack.version, cacheName: `${PACK_PREFIX}${pack.version}` } }, transfer); }
      catch (error) { terminate(error); }
    });
  }
  async function ready({ signal } = {}) {
    if (closed) throw new Error('This voice session is closed.');
    checkAbort(signal);
    if (readyVersion && worker) return readyStatus;
    const epoch = generation;
    const value = await manifest({ signal, localOnly: true }); const pack = await inspectPack(value); checkAbort(signal);
    if (epoch !== generation || closed) throw abortError();
    if (!pack.installed) throw new Error('Download the app voices before starting a voice conversation.');
    await run('ready', {}, value, { signal }); checkAbort(signal);
    if (epoch !== generation || closed) throw abortError();
    readyVersion = value.version;
    readyStatus = status(value, { installed: true, downloadedBytes: value.totalBytes });
    return readyStatus;
  }
  return {
    ready,
    async transcribe({ audio, signal } = {}) {
      if (!(audio instanceof Blob) || !audio.size || audio.size > 2 * 1024 * 1024) throw new Error('The recording is empty or too long. Try a shorter message or type it.');
      const epoch = generation;
      await ready({ signal }); const buffer = await audio.arrayBuffer(); checkAbort(signal);
      if (epoch !== generation || closed) throw abortError();
      const result = await run('transcribe', { audio: buffer }, { version: readyVersion }, { signal, transfer: [buffer] });
      if (!result || typeof result.text !== 'string') throw new Error('Device speech returned an invalid transcript.');
      return result;
    },
    async speech({ content, voice = DEFAULT_DEVICE_VOICE, signal } = {}) {
      if (typeof content !== 'string' || !content.trim() || content.length > 4096) throw new Error('This reply is too long for voice. The complete text remains available.');
      if (!DEVICE_VOICE_IDS.includes(voice)) throw new Error('Choose one of the five installed voices.');
      const epoch = generation;
      await ready({ signal });
      if (epoch !== generation || closed) throw abortError();
      const result = await run('speech', { content, voice }, { version: readyVersion }, { signal });
      if (!(result?.audio instanceof ArrayBuffer) || result.audio.byteLength < 44 || result.audio.byteLength > 8 * 1024 * 1024) throw new Error('Device voice returned an invalid audio reply.');
      return new Blob([result.audio], { type: 'audio/wav' });
    },
    cancel() { if (pending) terminate(); else generation++; },
    destroy() { closed = true; terminate(); },
  };
}
