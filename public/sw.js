// DS Elite PWA service worker.
// Deliberately NETWORK-FIRST for page loads so coaches always get the latest
// deploy (the app is updated often and needs Supabase online anyway). The only
// thing cached is the last successful page, used purely as an offline fallback.
const CACHE = 'dse-shell-v1';

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
