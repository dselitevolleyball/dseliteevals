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

// Focus an open tab (or open one) and navigate to the notification's url.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) { try { await c.navigate(url); } catch (e) {} return c.focus(); }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
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
