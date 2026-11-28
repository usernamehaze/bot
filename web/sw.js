const CACHE_NAME = 'cassie-v344';
const ASSETS = [
  './',
  'index.html',
  'start.html',
  'landing/landing.js',
  'landing/try.js',
  'landing/home.css',
  'app.html',
  'style.css',
  'rewards.css',
  'config.js',
  'errors.js',
  'extlink.js',
  'opening.js',
  'care.js',
  'cassie-bot.js',
  'app.js',
  'native.js',
  'listen.js',
  'tour.js',
  'mic.js',
  'study-room.js',
  'gradient.js',
  'start.js',
  'memory.js',
  'rewards.js',
  'board.js',
  'export.js',
  'sketch.js',
  'boardprep.js',
  'livedraw.js',
  'drawbook.js',
  'isoview.js', // (v319: Machine view, and the Anatomy kit it draws with: works offline too)
  'vendor/anatomy/iso-kit.mjs',
  'vendor/anatomy/lathe.mjs',
  'vendor/anatomy/tube.mjs',
  'cards.js',
  'cite.js',
  'voice.js',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

// (v344) a page the host redirected (app.html -> /app) is kept and served as a plain answer: Safari refuses a
// redirected answer from here ("Response served by service worker has redirections"), so offline the app would not open
const clean = (r) => (r && r.redirected ? r.clone().blob().then((body) => new Response(body, { status: r.status, statusText: r.statusText, headers: r.headers })) : Promise.resolve(r));
// (v344) on slow mobile data the network is given a few seconds, then this device's copy is used
const timed = (p, ms) => new Promise((ok, no) => { const t = setTimeout(() => no(new Error('slow')), ms); p.then((r) => { clearTimeout(t); ok(r); }, (e) => { clearTimeout(t); no(e); }); });
// the copy kept on this device, clean, whatever address it was asked by
const kept = (req, ...more) => [req, ...more].reduce((p, k) => p.then((c) => c || (k && caches.match(k, { ignoreSearch: true }))), Promise.resolve(null)).then((c) => c && clean(c));

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => Promise.all(ASSETS.map((a) => fetch(a, { cache: 'no-cache' }).then(clean).then((r) => r.ok ? cache.put(a, r) : null).catch(() => null))))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== 'cassie-remind').map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

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

// Network-first for our own files: always fetch the latest when online (so
// code updates land immediately), falling back to cache only when offline.
// Cross-origin requests (e.g. the Gemini API) are left untouched.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Page navigations need special care: Cloudflare Pages 308-redirects
  // /app.html -> /app, and a browser REJECTS a redirected response returned
  // from a service worker for a navigation (ERR_FAILED). So follow the
  // redirect ourselves and hand back a fresh, non-redirected response.
  if (event.request.mode === 'navigate') {
    // cache: 'no-cache' makes the browser re-check the page with the server, so a phone never keeps showing yesterday's
    // app.html. (v344) The fresh page is kept for offline, and with no internet or slow data (4 seconds) the kept one opens.
    const keyOf = /^\/app(\/|$)/.test(url.pathname) ? 'app.html' : /^\/[\w-]+$/.test(url.pathname) ? url.pathname.slice(1) + '.html' : null; // (/start is start.html)
    const net = fetch(event.request.url, { cache: 'no-cache', credentials: 'same-origin' }).then(clean).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE_NAME).then((c) => c.put(keyOf || event.request.url, copy)).catch(() => {}); }
      return r;
    });
    const fallback = () => kept(event.request, keyOf, 'start.html', 'app.html');
    event.respondWith(timed(net, 4000).catch(() => fallback().then((c) => c || net)));
    return;
  }

  // A file with its version in the address (app.js?v=266) never changes (a new version has a new address), so
  // once fetched it comes from this device straight away: faster loads and less mobile data.
  if (/[?&]v=\d+/.test(url.search)) {
    event.respondWith(caches.open(CACHE_NAME).then((cache) => cache.match(event.request).then((hit) => hit || fetch(event.request).then((response) => {
      if (response.ok && !response.redirected) cache.put(event.request, response.clone());
      return response;
    }).catch(() => kept(event.request).then((c) => c || Response.error()))))); // (v344: offline, the copy kept at install, app.js for app.js?v=344)
    return;
  }

  // Other same-origin GETs: network-first with a runtime cache. Never cache a
  // redirected response (Cache.put rejects those).
  const fresh = new Request(event.request.url, { cache: 'no-cache' });
  const net = fetch(fresh).then((response) => {
    if (!response.redirected) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
    }
    return response;
  });
  // (v344) offline, or 8 seconds on slow data: the copy kept on this device, else keep waiting for the network
  event.respondWith(timed(net, 8000).catch(() => kept(event.request).then((c) => c || net)));
});

// Study reminders: the server only sends an empty nudge at the time you picked.
// The words come from this device (what is due and your streak), so they never leave it.
async function remindText(now = Date.now()) {
  let snap = null;
  try { const r = await (await caches.open('cassie-remind')).match('/__remind'); if (r) snap = await r.json(); } catch (e) { /* nothing kept */ }
  if (!snap) return 'A short review today keeps what you learned.';
  const end = new Date(now); end.setHours(23, 59, 59, 999);
  const due = (snap.due || []).filter((d) => d <= end.getTime()).length;
  const first = (snap.soon || []).find((c) => c.due <= end.getTime());
  if (due) return `${due} card${due === 1 ? ' is' : 's are'} due today${first && first.f ? `, like ${first.f}` : ''}. A 5 minute review keeps them.`;
  const y = new Date(now); y.setDate(y.getDate() - 1);
  const yday = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
  if (snap.streak > 0 && snap.streakDay === yday) return `Your ${snap.streak} day streak ends tonight. One question keeps it going.`;
  return 'A short review today keeps what you learned.';
}
self.addEventListener('push', (event) => {
  event.waitUntil(remindText().then((body) => self.registration.showNotification('Cassie', { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'cassie-remind' })));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = all.find((c) => /app(\.html)?/.test(new URL(c.url).pathname));
    if (open) return open.focus();
    return self.clients.openWindow(new URL('app.html', self.registration.scope).href);
  })());
});
