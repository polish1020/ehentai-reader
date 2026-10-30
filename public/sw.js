const VERSION = 'yijing-live-v1';
const SHELL = ['/', '/index.html', '/style.css', '/app.js', '/source.mjs', '/filters.mjs', '/manifest.webmanifest', '/assets/icon.svg'];
self.addEventListener('install', event => event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== VERSION).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) { const copy = response.clone(); caches.open(VERSION).then(cache => cache.put(event.request, copy)); }
    return response;
  }).catch(async () => (await caches.match(event.request)) || (event.request.mode === 'navigate' ? await caches.match('/index.html') : new Response('Offline', {status: 503}))));
});
