// DS Elite PWA service worker.
// Deliberately NETWORK-FIRST for page loads so coaches always get the latest
// deploy (the app is updated often and needs Supabase online anyway). The only
// thing cached is the last successful page, used purely as an offline fallback.
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
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || undefined,
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
  event.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      const cache = await caches.open(CACHE);
      cache.put('/', fresh.clone());
      return fresh;
    } catch (e) {
      const cache = await caches.open(CACHE);
      const cached = await cache.match('/');
      return cached || Response.error();
    }
  })());
});
