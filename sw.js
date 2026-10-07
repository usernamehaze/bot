const CACHE_NAME = 'cassie-v137';
const ASSETS = [
  './',
  'index.html',
  'start.html',
  'landing/landing.js',
  'landing/play.js',
  'app.html',
  'style.css',
  'config.js',
  'cassie-bot.js',
  'app.js',
  'memory.js',
  'board.js',
  'export.js',
  'sketch.js',
  'cards.js',
  'cite.js',
  'voice.js',
  'manifest.json',
  'patterns/student.svg',
  'patterns/pro.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first for our own files: always fetch the latest when online (so
// code updates land immediately), falling back to cache only when offline.
// Cross-origin requests (e.g. the Gemini API) are left untouched.
// Android "Share → Cassie" (manifest share_target): keep what was shared, then open the app.
// The app picks it up from this cache and asks "What should I do with this?".
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || url.origin !== self.location.origin || !url.pathname.endsWith('/share-target')) return;
  event.respondWith((async () => {
    try {
      const form = await event.request.formData();
      const file = form.get('file');
      const cache = await caches.open('cassie-share');
      await cache.put('shared.json', new Response(JSON.stringify({
        title: String(form.get('title') || ''), text: String(form.get('text') || ''), url: String(form.get('url') || ''),
        file: file && file.size ? { name: file.name || 'shared', type: file.type || '' } : null, at: Date.now(),
      }), { headers: { 'content-type': 'application/json' } }));
      if (file && file.size) await cache.put('shared-file', new Response(file, { headers: { 'content-type': file.type || 'application/octet-stream' } }));
      else await cache.delete('shared-file');
    } catch (e) { /* nothing usable was shared */ }
    return Response.redirect(new URL('app.html?shared=1', self.registration.scope).href, 303);
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Page navigations need special care: Cloudflare Pages 308-redirects
  // /app.html -> /app, and a browser REJECTS a redirected response returned
  // from a service worker for a navigation (ERR_FAILED). So follow the
  // redirect ourselves and hand back a fresh, non-redirected response.
  if (event.request.mode === 'navigate') {
    // cache: 'no-cache' makes the browser re-check the page with the server,
    // so a phone never keeps showing yesterday's app.html (and its old scripts).
    event.respondWith(
      fetch(event.request.url, { cache: 'no-cache', credentials: 'same-origin' })
        .then((response) => {
          if (response.redirected) {
            return response.clone().blob().then((body) =>
              new Response(body, {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
              })
            );
          }
          return response;
        })
        .catch(() =>
          caches.match(event.request, { ignoreSearch: true }).then((c) => c || caches.match('start.html'))
        )
    );
    return;
  }

  // Other same-origin GETs: network-first with a runtime cache. Never cache a
  // redirected response (Cache.put rejects those).
  const fresh = new Request(event.request.url, { cache: 'no-cache' });
  event.respondWith(
    fetch(fresh)
      .then((response) => {
        if (!response.redirected) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((c) => c || caches.match(event.request, { ignoreSearch: true })))
  );
});
