/* ============================================================================
   FusionPulse Service Worker
   Zwei Regeln, die im Trading wichtiger sind als Offline-Komfort:
   1) /api/ wird NIEMALS gecacht — veraltete Kurse sind gefährlicher als ein Fehler.
   2) Die App-Shell läuft network-first. Ein alter Cache darf nie dazu führen,
      dass Tab-Titel, UI und Worker verschiedene Versionsnummern zeigen.
   APP_VERSION wird von scripts/sync-version.mjs aus package.json gesetzt.
   ========================================================================== */
const APP_VERSION = '3.0.8';
const CACHE = `fusionpulse-v${APP_VERSION}`;
const SHELL = ['/', '/index.html', '/version.js', '/app.js', '/style.css',
               '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-512-maskable.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL))
      .catch(() => {})                       // ein fehlendes Asset darf das Update nicht blockieren
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((cs) => cs.forEach((c) => c.postMessage({ type: 'FP_ACTIVATED', version: APP_VERSION }))),
  );
});

self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (e.data?.type === 'FP_VERSION?') e.source?.postMessage({ type: 'FP_VERSION', version: APP_VERSION });
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return;            // immer direkt ans Netz
  if (url.origin !== location.origin) return;

  // Network-first: frisch, wenn Netz da ist; Cache nur als Rückfallebene.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('/index.html'))),
  );
});
