const CACHE = 'studychat-shell-v1';
const SHELL = ['/', '/styles.css', '/app.js', '/icon.svg', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest', '/packages/conversation-agent/src/conversation-core.js'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(names => Promise.all(names.filter(name => name !== CACHE).map(name => caches.delete(name)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin || !SHELL.includes(new URL(event.request.url).pathname)) return;
  event.respondWith(fetch(event.request).then(response => { if (response.ok) { const copy = response.clone(); void caches.open(CACHE).then(cache => cache.put(event.request, copy)); } return response; }).catch(() => caches.match(event.request)));
});
