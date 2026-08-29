/* ============================================================================
   FusionPulse Service Worker
   Zwei Regeln, die im Trading wichtiger sind als Offline-Komfort:
   1) /api/ wird NIEMALS gecacht — veraltete Kurse sind gefährlicher als ein Fehler.
   2) Die App-Shell läuft network-first. Ein alter Cache darf nie dazu führen,
      dass Tab-Titel, UI und Worker verschiedene Versionsnummern zeigen.
   APP_VERSION wird von scripts/sync-version.mjs aus package.json gesetzt.
   ========================================================================== */
const APP_VERSION = '3.23.0';
const CACHE = `fusionpulse-v${APP_VERSION}`;
/* v3.14.3: app.js/style.css/version.js tragen die Version im URL. Der Cache
   muss dieselben URLs vorhalten, sonst greift die Offline-Rueckfallebene ins
   Leere. Die Liste wird von scripts/sync-version.mjs gesetzt. */
const SHELL_VERSIONED = ['/version.js?v=3.23.0', '/app.js?v=3.23.0', '/style.css?v=3.23.0'];
const SHELL = ['/', '/index.html', ...SHELL_VERSIONED,
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

  /* v3.19.0 · Cache-first NUR fuer Assets, deren URL die Version DIESES Service
     Workers traegt (app.js?v=…, style.css?v=…, version.js?v=…).
     Warum das die Invariante aus dem Kopf dieser Datei nicht verletzt:
     Eine neue App-Version bedeutet eine NEUE URL. Liegt eine neuere Shell auf
     dem Server, fordert deren index.html `?v=3.19.0` an — das trifft den
     Vergleich unten nicht mehr und faellt automatisch auf Network-first
     zurueck. Ein veralteter Treffer ist damit strukturell unmoeglich, nicht
     nur unwahrscheinlich.
     Vorher zog die App bei JEDEM Start ~160 kB (gzip) ueber das Netz, obwohl
     der Cache-Eintrag unter exakt derselben URL gar nicht veralten kann. */
  if (url.searchParams.get('v') === APP_VERSION) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })),
    );
    return;
  }

  // Network-first: frisch, wenn Netz da ist; Cache nur als Rückfallebene.
  // Gilt weiterhin fuer index.html, "/" und alles ohne Versionsstempel.
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
