/* ============================================================================
   Service-Worker-Prüfstand · seit v3.25.0
   ----------------------------------------------------------------------------
   ANLASS: Am 29.08. stand die App still. Safari meldete "Service Worker context
   closed" und "Failed to load resource"; `app.js` wurde nie ausgeführt.

   URSACHE war der Cache-first-Zweig aus v3.19.0 OHNE `.catch()`. Lehnt die
   Cache-API ab — in Safari genügt Speicherdruck oder ITP-Räumung —, lehnt auch
   `respondWith()` ab, und für den Browser existiert die Datei dann schlicht
   nicht. Der Network-first-Zweig hatte einen `.catch()` und lief weiter, also
   erschien das Grundgerüst. Genau das liess den Totalausfall wie "keine Daten"
   aussehen.

   WARUM DIESE DATEI EXISTIERT: 43 grüne Suiten haben den Fehler nicht gefunden,
   weil sie den Service Worker nur als TEXT geprüft haben — Regex auf Regeln,
   die vorhanden sein sollen. Ein fehlendes `.catch()` sieht man so nicht.
   Hier wird er AUSGEFÜHRT, unter Störungen: Cache wirft, Netz wirft, beides.

   DIE REGEL, die hier verteidigt wird: ein `respondWith` darf NIEMALS ablehnen.
   Ein Service Worker sitzt zwischen der App und allem, was sie braucht. Jeder
   unbehandelte Fehler darin nimmt nicht eine Datei aus dem Verkehr, sondern die
   ganze Anwendung.
   ========================================================================== */
import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const VERSION = /const APP_VERSION = '([^']+)'/.exec(src)[1];

/** Baut eine Service-Worker-Umgebung nach und lässt eine Anfrage durchlaufen. */
function makeSW(source, { cacheThrows = false, netThrows = false, hit = null, putThrows = false } = {}) {
  const handlers = {};
  const ctx = {
    location: { origin: 'https://t.local' },
    URL, Request, Promise, Object, Array, Math, Date, JSON, Map, Set, console,
    Response: class {
      constructor(body, init = {}) {
        this.body = body; this.status = init.status || 200; this.ok = this.status < 400;
        this.headers = new Map(Object.entries(init.headers || {}));
      }
      clone() { return this; }
    },
    caches: {
      async match() { if (cacheThrows) throw new Error('QuotaExceededError'); return hit; },
      async open() {
        if (cacheThrows) throw new Error('QuotaExceededError');
        return { async put() { if (putThrows) throw new Error('put failed'); }, async addAll() {} };
      },
      async keys() { return []; }, async delete() { return true; },
    },
    async fetch() {
      if (netThrows) throw new Error('Load failed');
      return { ok: true, status: 200, clone() { return this; }, body: 'NETZ' };
    },
  };
  ctx.self = {
    addEventListener: (t, f) => { handlers[t] = f; },
    skipWaiting() {}, clients: { claim() {}, async matchAll() { return []; } },
    caches: ctx.caches, location: ctx.location,
  };
  ctx.addEventListener = ctx.self.addEventListener;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(source, ctx, { filename: 'sw.js' });

  return async function request(path) {
    const waits = [];
    let out = null, rejected = null, responded = false;
    const e = {
      request: new Request('https://t.local' + path),
      respondWith(p) { responded = true; out = Promise.resolve(p).then((r) => r, (err) => { rejected = err; return null; }); },
      waitUntil(p) { waits.push(Promise.resolve(p).catch(() => {})); },
    };
    handlers.fetch(e);
    const res = responded ? await out : null;
    await Promise.all(waits);
    return { responded, rejected: rejected && rejected.message, res, waits: waits.length };
  };
}

const ASSET = `/app.js?v=${VERSION}`;
const SHELL = '/index.html';
const API = '/api/health';

/* -- 1. DER FEHLER VOM 29.08. -------------------------------------------- */
// Cache-API lehnt ab. Vorher: respondWith lehnte ab -> Datei "existiert nicht".
{
  const r = await makeSW(src, { cacheThrows: true })(ASSET);
  assert.equal(r.rejected, null,
    `respondWith darf bei kaputter Cache-API NICHT ablehnen (war: ${r.rejected}) — genau daran ist die App am 29.08. gestorben`);
  assert.equal(r.res.body, 'NETZ',
    'Bei kaputtem Cache muss auf das Netz ausgewichen werden');
}

/* -- 2. Jede Störkombination, für Asset UND Shell ------------------------- */
for (const path of [ASSET, SHELL]) {
  for (const opt of [{}, { cacheThrows: true }, { netThrows: true }, { putThrows: true },
                     { cacheThrows: true, netThrows: true }]) {
    const r = await makeSW(src, opt)(path);
    const name = `${path} bei ${JSON.stringify(opt)}`;
    assert.equal(r.rejected, null, `${name}: respondWith darf nie ablehnen`);
    assert.ok(r.res, `${name}: es muss IMMER eine Antwort herauskommen`);
    assert.ok(typeof r.res.status === 'number', `${name}: mit einem Status`);
  }
}

/* -- 3. Totalausfall muss erkennbar sein, nicht still --------------------- */
{
  const r = await makeSW(src, { netThrows: true })(ASSET);
  assert.equal(r.rejected, null, 'Auch offline darf nichts ablehnen');
  assert.equal(r.res.status, 504, 'Ohne Netz und ohne Cache muss ein sichtbarer Fehler kommen');
  assert.match(String(r.res.body), /FusionPulse/,
    'Und er muss benennen, wer ihn erzeugt hat — ein leeres Nichts ist nicht diagnostizierbar');
}

/* -- 4. Cache-Treffer schlägt Netz nur bei versionierter URL -------------- */
{
  const hit = { ok: true, status: 200, clone() { return this; }, body: 'CACHE' };
  const asset = await makeSW(src, { hit })(ASSET);
  assert.equal(asset.res.body, 'CACHE', 'Versionierte Assets kommen aus dem Cache');
  const shell = await makeSW(src, { hit })(SHELL);
  assert.equal(shell.res.body, 'NETZ',
    'Die Shell muss network-first bleiben — sonst koennen Tab-Titel und Worker auseinanderlaufen');
  // Eine FREMDE Version darf den Cache-first-Zweig nicht treffen.
  const fremd = await makeSW(src, { hit })('/app.js?v=99.99.99');
  assert.equal(fremd.res.body, 'NETZ',
    'Eine andere Version muss network-first laufen — das ist der ganze Sicherheitsbeweis der Regel');
}

/* -- 5. /api/ wird niemals angefasst -------------------------------------- */
{
  const r = await makeSW(src, { hit: { ok: true, status: 200, clone() { return this; }, body: 'CACHE' } })(API);
  assert.equal(r.responded, false,
    'API-Anfragen muessen durchgereicht werden — ein veralteter Kurs ist gefaehrlicher als ein Fehler');
}

/* -- 6. Der stille Fehler: Schreibvorgänge müssen den SW am Leben halten -- */
// Ohne waitUntil darf der Browser den Service Worker mitten im Schreiben
// beenden. Das war die Meldung "Service Worker context closed".
{
  const r = await makeSW(src, {})(ASSET);
  assert.ok(r.waits >= 1,
    'Ein Cache-Schreibvorgang MUSS in e.waitUntil() liegen, sonst wird der Service Worker mittendrin beendet');
  const off = await makeSW(src, { netThrows: true })(ASSET);
  assert.equal(off.waits, 0, 'Ohne Antwort darf auch nichts am Leben gehalten werden');
}

/* -- 7. Kaputte Adresse darf nicht ins Leere laufen ----------------------- */
{
  const handlers = {};
  const r = await makeSW(src, {})('/pfad mit leerzeichen.js');
  assert.equal(r.rejected, null, 'Auch eine ungewoehnliche Adresse darf nichts ablehnen');
}

console.log('✓ FusionPulse Service-Worker-Prüfstand (ausgeführt, nicht nur gelesen): OK');

/* -- 8. Selbstheilung im Client ------------------------------------------- */
// Der Prüfstand oben deckt den Service Worker ab. Diese Prüfung deckt den Fall
// ab, dass trotzdem einer hängen bleibt: nach 12 s ohne verarbeitete Antwort
// meldet die App ihn ab und lädt neu — einmalig, mit Sperrfrist.
{
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const healIdx = app.indexOf("const HEAL = 'fp_sw_healed_at'");
  assert.ok(healIdx > 0, 'Es muss eine Selbstheilung fuer einen haengenden Service Worker geben');
  assert.ok(healIdx < app.indexOf('async function scan('),
    'Sie muss VOR dem Code stehen, der moeglicherweise gerade nicht laeuft');
  const block = app.slice(healIdx, healIdx + 900);
  assert.match(block, /6 \* 60 \* 60_000/,
    'Mit Sperrfrist — sonst entsteht eine Neulade-Schleife, die schlimmer ist als der Fehler');
  assert.match(block, /if \(self\.__fpScanOk\) return;/,
    'Ausloeser muss eine tatsaechlich verarbeitete Antwort sein, nicht blosses Starten von app.js');
  assert.match(app, /self\.__fpScanOk = true;/,
    'Und diese Quittung muss im Erfolgspfad des Scans gesetzt werden');
  assert.ok(!/localStorage\.clear\(\)/.test(block),
    'Die Heilung darf die Einstellungen nicht loeschen');
}

console.log('✓ FusionPulse Selbstheilung: OK');
