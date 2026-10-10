// DS Elite PWA service worker.
// Deliberately NETWORK-FIRST for page loads so coaches always get the latest
// deploy (the app is updated often and needs Supabase online anyway). The only
// thing cached is the last successful page (one for HQ, one for the /hub
// pages), used purely as an offline fallback.
const CACHE = 'dse-shell-v2';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Web Push: show a notification when a push arrives (even if the app is closed).
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (e) { data = { body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'DS Elite';
  // A tagged push (the Tournament Hub's "hub-<team>") replaces that team's
  // older alert in the tray; renotify makes the replacement buzz/show again
  // instead of landing silently. Only with a tag — Chrome throws on
  // renotify without one.
  const tag = data.tag || undefined;
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag,
    renotify: !!tag,
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Open the notification's url — actually open it.
//
// The previous version called client.navigate(url) inside a try/catch and then
// focused that client regardless. iOS PWAs don't reliably support navigate(),
// so it threw, the catch swallowed it, and the app was focused on whatever
// screen it was already showing — the url silently discarded. Tapping a
// notification appeared to do nothing.
//
// Now: only keep an existing window if navigate genuinely succeeded. Otherwise
// fall through to openWindow, which honours the url on every platform.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      try {
        if (typeof c.navigate === 'function') {
          const navigated = await c.navigate(url);
          const target = navigated || c;
          if (target && typeof target.focus === 'function') return target.focus();
        }
      } catch (e) {
        // navigate isn't available here — openWindow below is the reliable path.
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
    // Nothing else worked: at least bring the app forward.
    if (all[0] && typeof all[0].focus === 'function') return all[0].focus();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  // Only handle top-level navigations; let everything else (assets, Supabase,
  // /api) go straight to the network so nothing is ever served stale.
  if (req.mode !== 'navigate') return;
  // The public Tournament Hub (/hub, its own registration with scope /hub, but
  // also inside HQ's '/' scope) keeps its own offline copy, so HQ and the hub
  // never overwrite each other's. Only successful pages are kept — a 404 from
  // a bad link must not become the offline fallback.
  const path = new URL(req.url).pathname;
  const key = (path === '/hub' || path.startsWith('/hub/')) ? '/hub' : '/';
  event.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      if (fresh.ok) {
        const copy = fresh.clone(); // now, before the page starts reading the body
        event.waitUntil(caches.open(CACHE).then((c) => c.put(key, copy)).catch(() => {}));
      }
      return fresh;
    } catch (e) {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(key);
      return cached || Response.error();
    }
  })());
});
