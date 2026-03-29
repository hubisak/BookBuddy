/* ============================================================
   BOOKBUDDY — sw.js
   Service Worker: caches app shell for offline use
   Strategy:
   - App shell: cache-first
   - Google Fonts: network-first with cache fallback
   - Open Library API + Covers API: síť bez fake fallbacku
   ============================================================ */

const CACHE_NAME = 'bookbuddy-openlibrary-v2';

const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
];

// Při instalaci uloží základní soubory aplikace pro offline spuštění.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// Po aktivaci smaže staré cache, aby se nemíchaly staré a nové verze.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// Rozhoduje, jestli se soubor načte z cache nebo ze sítě.
self.addEventListener('fetch', event => {
  const url = event.request.url;

  if (
    url.includes('openlibrary.org/search.json') ||
    url.includes('covers.openlibrary.org/')
  ) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
