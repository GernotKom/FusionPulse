/* ============================================================================
   FusionPulse Service Worker
   Zwei Regeln, die im Trading wichtiger sind als Offline-Komfort:
   1) /api/ wird NIEMALS gecacht — veraltete Kurse sind gefährlicher als ein Fehler.
   2) Die App-Shell läuft network-first. Ein alter Cache darf nie dazu führen,
      dass Tab-Titel, UI und Worker verschiedene Versionsnummern zeigen.
   APP_VERSION wird von scripts/sync-version.mjs aus package.json gesetzt.
   ========================================================================== */
const APP_VERSION = '3.32.6';
const CACHE = `fusionpulse-v${APP_VERSION}`;
/* v3.14.3: app.js/style.css/version.js tragen die Version im URL. Der Cache
   muss dieselben URLs vorhalten, sonst greift die Offline-Rueckfallebene ins
   Leere. Die Liste wird von scripts/sync-version.mjs gesetzt. */
const SHELL_VERSIONED = ['/version.js?v=3.32.6', '/app.js?v=3.32.6', '/style.css?v=3.32.6'];
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

/* ============================================================================
   v3.25.0 · WARUM DIE APP AM 29.08. STILLSTAND — und was daraus folgt
   ----------------------------------------------------------------------------
   Safari meldete: "Service Worker context closed" und "Failed to load resource".
   Die Oberflaeche blieb auf ihren statischen Startwerten stehen, weil `app.js`
   nie geladen wurde.

   URSACHE, zwei Fehler von mir, beide in v3.19.0 entstanden:

   1) DER TOEDLICHE: der Cache-first-Zweig hatte KEIN `.catch()`. Lehnt
      `caches.match()` oder `fetch()` ab — in Safari passiert das, sobald der
      Speicher unter Druck steht oder ITP den Cache raeumt —, dann lehnt auch
      `respondWith()` ab. Fuer den Browser heisst das nicht "nimm halt das Netz",
      sondern "diese Datei existiert nicht". `app.js` kam nie an.
      Der Network-first-Zweig hatte schon immer einen `.catch()` und lief
      deshalb weiter: index.html wurde ausgeliefert, das Grundgeruest erschien —
      und genau das liess den Ausfall wie "keine Daten" aussehen.

   2) DER STILLE: die Cache-Schreibvorgaenge im Hintergrund lagen nicht in
      `e.waitUntil()`. Sobald `respondWith` fertig war, durfte der Browser den
      Service Worker beenden — mitten im Schreiben. Daher die Meldung
      "Service Worker context closed".

   DIE REGEL, die daraus folgt und die nicht mehr aufgeweicht werden darf:
   Ein `respondWith` darf NIEMALS ablehnen. Ein Service Worker sitzt zwischen
   der App und allem, was sie braucht; jeder unbehandelte Fehler darin nimmt
   nicht eine Datei aus dem Verkehr, sondern die ganze Anwendung. Im Zweifel
   liefert er eine Antwort aus dem Netz, aus dem Cache oder notfalls eine
   erkennbare Fehlerantwort — aber er lehnt nicht ab.
   ========================================================================== */

/** Schreibt in den Hintergrund-Cache und HAELT den Service Worker dabei am
 *  Leben. Fehler werden geschluckt: ein misslungener Cache-Eintrag ist ein
 *  Schoenheitsfehler, ein abgebrochener Ladevorgang waere keiner. */
function cachePut(e, req, res) {
  if (!res || !res.ok) return;
  const copy = res.clone();
  e.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}));
}

/** Netz holen, Ergebnis nebenbei cachen. Lehnt nur ab, wenn das Netz ablehnt. */
function fromNetwork(e) {
  return fetch(e.request).then((res) => { cachePut(e, e.request, res); return res; });
}

/** Letzte Instanz: eine Antwort, die man ansieht statt eines stillen Nichts. */
const lastResort = (why) => new Response(
  `FusionPulse: Ressource nicht verfuegbar (${why}).`,
  { status: 504, headers: { 'content-type': 'text/plain; charset=utf-8' } },
);

self.addEventListener('fetch', (e) => {
  let url;
  /* Selbst das Zerlegen der Adresse wird abgesichert. Wirft hier etwas, wuerde
     der Fehler ausserhalb von respondWith landen und die Anfrage ins Leere
     laufen lassen. */
  try { url = new URL(e.request.url); } catch { return; }
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
      caches.match(e.request)
        .catch(() => null)                    // Cache kaputt/geraeumt -> egal, weiter zum Netz
        .then((hit) => hit || fromNetwork(e))
        .catch(() => caches.match(e.request).catch(() => null))
        .then((res) => res || lastResort('Netz und Cache ohne Treffer')),
    );
    return;
  }

  // Network-first: frisch, wenn Netz da ist; Cache nur als Rückfallebene.
  // Gilt weiterhin fuer index.html, "/" und alles ohne Versionsstempel.
  e.respondWith(
    fromNetwork(e)
      .catch(() => caches.match(e.request)
        .then((hit) => hit || caches.match('/index.html'))
        .catch(() => null))
      .then((res) => res || lastResort('offline und nichts im Cache')),
  );
});
