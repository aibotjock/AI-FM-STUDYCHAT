const CACHE = 'studychat-shell-v2';
const METADATA = 'studychat-device-voice-metadata';
const MARKER = '/voice-assets/install-status.json';
const MANIFEST = '/voice-assets/manifest.json';
const SHELL = [
  '/', '/styles.css', '/app.js', '/study.js', '/voice.js', '/device-voice.js',
  '/device-voice-worker.js', '/icon.svg', '/icon-192.png', '/icon-512.png',
  '/manifest.webmanifest', '/packages/conversation-agent/src/conversation-core.js',
  '/packages/conversation-agent/src/browser-audio.js',
  '/packages/conversation-agent/src/voice-circle.js',
  '/packages/conversation-agent/voice-circle.css',
];
self.addEventListener('install', event => event.waitUntil(
  caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()),
));
self.addEventListener('activate', event => event.waitUntil(
  caches.keys().then(names => Promise.all(names.filter(name => name.startsWith('studychat-shell-') && name !== CACHE).map(name => caches.delete(name)))).then(() => self.clients.claim()),
));
async function installedAsset(request) {
  const metadata = await caches.open(METADATA);
  const active = await metadata.match(MARKER);
  if (!active) return null;
  try {
    const pointer = await active.json();
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(pointer.version) || pointer.cacheName !== `studychat-device-voice-${pointer.version}`) return null;
    const pack = await caches.open(pointer.cacheName);
    const marker = await pack.match(MARKER), manifest = await pack.match(MANIFEST);
    if (!marker || !manifest) return null;
    const record = await marker.json(), value = await manifest.clone().json();
    if (record.version !== pointer.version || value.version !== pointer.version) return null;
    const path = new URL(request.url).pathname;
    if (path === MANIFEST) return manifest;
    const asset = value.assets.find(item => item.url === path);
    if (!asset) return null;
    const response = await pack.match(path);
    return response?.headers.get('X-StudyChat-SHA256') === asset.sha256 && response.headers.get('X-StudyChat-Bytes') === String(asset.bytes) ? response : null;
  } catch { return null; }
}
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/voice-assets/')) {
    // Installer requests bypass the active pack; runtime requests never redownload it.
    if (['no-store', 'reload'].includes(event.request.cache)) return;
    event.respondWith(installedAsset(event.request).then(response => response || fetch(event.request)));
    return;
  }
  if (!SHELL.includes(url.pathname)) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) { const copy = response.clone(); void caches.open(CACHE).then(cache => cache.put(event.request, copy)); }
    return response;
  }).catch(() => caches.match(event.request)));
});
