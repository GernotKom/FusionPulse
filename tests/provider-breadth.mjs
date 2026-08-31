/* ═════════════ v3.31.0 · Suite 50 · §28 · Provider und Marktbreite ═══
   Anlass: das ChatGPT-Bandbreiten-Audit vom 30.08.2026. Dessen §28 verlangt,
   dass die App bei Provider-Wechsel eindeutig ausweist, wer liefert und ob die
   Marktbreite eingeschraenkt ist — und §29, dass ein Provider-Ausfall NIEMALS
   etwas verbessert.

   Beim Umsetzen ist der eigentliche Fehler aufgefallen: die alte Quellenzeile
   war eine binaere Behauptung ueber ein offenes Feld und hat jede
   Nicht-Tiingo-Quelle als „Twelve Data" ausgewiesen — auch Alpaca, auch ein
   leeres Feld. Der im Audit geplante Alpaca-Failover haette damit den falschen
   Anbieter genannt.

   Wie Suite 48 liegt diese Suite in einer EIGENEN Datei, weil parallel am
   zweiten Strang gearbeitet wird (R9: beide mit je einer Zeile in
   package.json einhaengen).

   Alle Pruefungen sind mit Negativkontrollen belegt; Protokoll in
   RELEASE_NOTES_v3_31_0.md. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const idx = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
/* Kommentare raus, BEVOR irgendeine Negativpruefung laeuft (Lehre v3.12.0:
   ein Erklaerkommentar, der den alten Wert zitiert, laesst `doesNotMatch`
   anschlagen). Alle Verbotspruefungen unten arbeiten auf `code`. */
const code = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* ─── 1 · Die alte Falschbehauptung darf nicht zurueckkommen ────────────── */
{
  assert.ok(!/includes\('Tiingo'\)\s*\?\s*'Tiingo IEX, US-Markt \(Primary\)'/.test(code),
    'Die binaere Quellenzeile („alles was nicht Tiingo heisst, ist Twelve Data") darf nicht zurueckkehren');
  assert.ok(/function feedInfo\s*\(/.test(code), 'feedInfo() muss die einzige Wahrheitsquelle sein');
  assert.ok(/function bandwidthNote\s*\(/.test(code), 'bandwidthNote() fehlt');
  assert.ok(idx.includes('id="stockFeed"'), 'Die Quelle muss im Aktienkopf sichtbar sein, nicht nur in einer Fussnote');
  assert.ok(!/stocks:'Aktien \(Twelve Data\)'/.test(code),
    'Das Ressourcen-Label darf Twelve Data nicht als primaeren Aktienanbieter fuehren');
}

/* ─── 2 · Ausgefuehrt: was sagt feedInfo bei welchem Zustand? ───────────── */
function stubEl() {
  const el = {
    style: (() => { const m = new Map(); return { _map: m, setProperty(k, v) { m.set(k, String(v)); },
      removeProperty(k) { const v = m.get(k) ?? ''; m.delete(k); return v; },
      getPropertyValue(k) { return m.get(k) ?? ''; } }; })(),
    dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    children: [], value: '', textContent: '', innerHTML: '', checked: false, hidden: false,
    addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {}, insertAdjacentHTML() {},
    setAttribute() {}, removeAttribute() {}, getAttribute() { return null; }, focus() {}, click() {},
    scrollIntoView() {}, insertAdjacentElement() {}, insertBefore() {}, replaceChildren() {},
    prepend() {}, append() {}, contains() { return false; },
    setPointerCapture() {}, releasePointerCapture() {},
    animate() { return { cancel() {}, finished: Promise.resolve() }; },
    querySelector() { return stubEl(); }, querySelectorAll() { return []; }, closest() { return null; },
    getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 }; },
  };
  return el;
}
function ladeClient() {
  const store = new Map(); const elCache = new Map();
  const elFor = (sel) => { const k = String(sel); if (!elCache.has(k)) elCache.set(k, stubEl()); return elCache.get(k); };
  const doc = { readyState: 'complete', documentElement: stubEl(), body: stubEl(), head: stubEl(),
    hidden: false, visibilityState: 'visible', createElement() { return stubEl(); }, createTextNode() { return stubEl(); },
    getElementById(id) { return elFor('#' + id); }, querySelector(sel) { return elFor(sel); },
    querySelectorAll() { return []; }, addEventListener() {}, removeEventListener() {} };
  const ctx = {
    console, __elFor: elFor, document: doc,
    navigator: { userAgent: 'node', onLine: true, serviceWorker: { register: async () => ({}), getRegistrations: async () => [], addEventListener() {}, removeEventListener() {}, controller: null, ready: new Promise(() => {}) }, vibrate() {} },
    location: { href: 'https://test.local/', search: '', hostname: 'test.local', protocol: 'https:', reload() {} },
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), clear: () => store.clear() },
    fetch: async () => { throw new Error('Netzwerk im Test bewusst deaktiviert'); },
    AbortController, AbortSignal, URL, URLSearchParams, TextEncoder, TextDecoder,
    Intl, Math, Date, JSON, Map, Set, Promise, Array, Object, Number, String, Boolean, RegExp, Error,
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
    AudioContext: function () { return { state: 'suspended', resume() {}, createOscillator() { return { connect() {}, start() {}, stop() {}, frequency: { setValueAtTime() {}, value: 0 }, type: '' }; }, createGain() { return { connect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {}, value: 0 } }; }, destination: {}, currentTime: 0 }; },
    Notification: function () {}, Audio: function () { return { play() {}, pause() {} }; },
    performance: { now: () => 0 }, crypto: { randomUUID: () => 'test-uuid', getRandomValues: a => a },
  };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
  ctx.Notification.permission = 'denied'; ctx.Notification.requestPermission = async () => 'denied';
  vm.createContext(ctx);
  vm.runInContext(app + '\n;globalThis.__fp={ feedInfo, bandwidthNote, FEED_BREADTH, el:__elFor, setAuthDenied:(v)=>{authDenied=v;} };', ctx, { filename: 'app.js' });
  return ctx.__fp;
}

{
  const C = ladeClient();

  /* Primaerfall: Tiingo IEX. Rolle primary, Marktbreite AUSDRUECKLICH
     eingeschraenkt — die 2-3 % IEX-Anteil standen seit v3.8.1 in den Notizen
     und waren fuer den Nutzer nie sichtbar. */
  const t = C.feedInfo({ provider: 'Tiingo', source: 'Tiingo IEX' }, {});
  assert.equal(t.provider, 'Tiingo');
  assert.equal(t.role, 'primary');
  assert.equal(t.breadth, 'partial', 'Tiingo IEX sieht rund 2–3 % des US-Volumens und muss das sagen');
  assert.ok(/2–3 %/.test(t.detail), 'Der IEX-Anteil muss im Klartext dastehen');

  /* Der Fall, der den Fehler ausgeloest hat: Alpaca. Frueher „Twelve Data". */
  const aIex = C.feedInfo({ provider: 'Alpaca' }, { feed: 'IEX (Free)' });
  assert.equal(aIex.provider, 'Alpaca', 'Alpaca darf nicht als Twelve Data ausgewiesen werden');
  assert.equal(aIex.role, 'fallback');
  assert.equal(aIex.breadth, 'partial');
  assert.ok(!/Twelve/i.test(aIex.label), 'Im Alpaca-Fall darf Twelve Data nirgends stehen');

  /* Nach einem Alpaca-Plus-Upgrade: SIP, volle Marktbreite — ohne Codepfad
     fuer den Tarifnamen (§25/§33.7 des Audits). */
  const aSip = C.feedInfo({ provider: 'Alpaca' }, { feed: 'SIP (All US Exchanges)' });
  assert.equal(aSip.breadth, 'full', 'SIP ist der konsolidierte Gesamtmarkt');
  assert.equal(aSip.role, 'fallback', 'Auch mit SIP bleibt Alpaca der Fallback — Tiingo bleibt Primary (§22.1)');
  assert.ok(!/Algo Trader|Alpaca Plus|Alpaca Basic/i.test(code),
    'Kein Alpaca-Tarifname darf im Client hart codiert sein (§33.8) — die Breite kommt aus der Antwort, nicht aus einem Tarif');

  /* FAIL-CLOSED, der Kern von §29: unbekannt darf nie primary und nie full
     werden, und es darf kein Anbietername erfunden werden. */
  for (const meta of [{}, { provider: '' }, { provider: null }, { source: 'irgendwas' }, { provider: 0 }]) {
    const u = C.feedInfo(meta, {});
    assert.equal(u.provider, null, `Unbekannte Quelle darf keinen Namen bekommen: ${JSON.stringify(meta)}`);
    assert.notEqual(u.role, 'primary', 'Unbekannt ist nicht Primary');
    assert.notEqual(u.breadth, 'full', 'Unbekannt ist NICHT volle Marktbreite');
    assert.ok(!/Twelve|Tiingo|Alpaca/.test(u.label), 'Es darf kein Anbieter geraten werden');
    assert.equal(u.tone, 'warn', 'Ein nicht bestimmbarer Zustand darf nicht beruhigend aussehen');
  }

  /* DIE LUECKE, DIE EINE NEGATIVKONTROLLE AUFGEDECKT HAT (NK3):
     Anbieter BEKANNT, Feed UNBEKANNT. Genau der reale Zustand kurz nach dem
     Start, wenn `stockMeta.provider` schon da ist und `openingMeta.feed` noch
     nicht geladen wurde. Die erste Fassung dieses Tests hat nur den Fall
     „gar nichts bekannt" geprueft — eine Sabotage, die `full` als Rueckfall
     setzt, lief deshalb durch. Dritte Wiederholung der Lehre aus 8z: der Test
     muss den Wert benutzen, der die Abwehr TATSAECHLICH erreicht. */
  for (const [meta, opening] of [
        [{ provider: 'Alpaca' }, {}],
        [{ provider: 'Alpaca' }, { feed: '' }],
        [{ provider: 'Alpaca' }, { feed: 'irgendein neuer Feedname' }],
        [{ provider: 'Tiingo' }, { feed: 'unbekannt' }]]) {
    const u = C.feedInfo(meta, opening);
    assert.notEqual(u.breadth, 'full',
      `Bekannter Anbieter mit unbekanntem Feed darf NICHT als volle Marktbreite gelten: ${JSON.stringify([meta, opening])}`);
    assert.notEqual(u.tone, 'ok', 'Und er darf nicht beruhigend aussehen');
  }
  /* „nicht bestimmbar" muss sich sprachlich von „vollstaendig" unterscheiden —
     die Lehre aus 8x: „nicht bewertbar" ist nicht „neutral". */
  assert.notEqual(C.FEED_BREADTH.unknown.label, C.FEED_BREADTH.full.label);
  assert.ok(/NICHT dasselbe wie vollständig/.test(C.FEED_BREADTH.unknown.detail));
}

/* ─── 3 · Bandbreite: fehlende Messung ist keine niedrige Zahl ──────────── */
{
  const C = ladeClient();
  /* Genau der Fehler aus 8f: eine UI, die einen dauerhaft leeren Wert
     auswertet, sieht aus wie eine Messung und ist keine. Der Worker liefert
     diese Felder heute noch nicht. */
  for (const meta of [{}, { bandwidth: {} }, { bandwidth: { usedGb: null, capGb: null } },
                      { bandwidth: { usedGb: 12 } }, { bandwidth: { capGb: 40 } },
                      { bandwidth: { usedGb: '', capGb: '' } }, { bandwidth: { usedGb: 5, capGb: 0 } }]) {
    const b = C.bandwidthNote(meta);
    assert.equal(b.measured, false, `Unvollstaendige Angabe darf nicht als Messung gelten: ${JSON.stringify(meta)}`);
    assert.ok(!/\b0 %|\b0,00\b/.test(b.label), 'Eine fehlende Messung darf nie als 0 erscheinen (Regel 2)');
    assert.ok(/nicht gemessen/.test(b.label));
    assert.ok(/NICHT schließen/.test(b.detail), 'Es muss dastehen, dass daraus keine Reserve folgt');
    assert.notEqual(b.tone, 'ok', 'Eine fehlende Messung darf nicht gruen aussehen');
  }
  /* Echte Zahlen werden gerechnet — und der Ausfallzustand vom 30.08. (40/40)
     muss rot sein, nicht gelb. */
  const voll = C.bandwidthNote({ bandwidth: { usedGb: 40, capGb: 40 } });
  assert.equal(voll.measured, true);
  assert.equal(voll.pct, 100);
  assert.equal(voll.tone, 'err', '40 von 40 GB ist der Zustand, der den Nachrichtentest blockiert hat — der ist rot');
  const halb = C.bandwidthNote({ bandwidth: { usedGb: 10, capGb: 40 } });
  assert.equal(halb.pct, 25);
  assert.equal(halb.tone, 'ok');
}

/* ─── 4 · §29: die Herkunft darf nichts bewerten ────────────────────────── */
{
  /* feedInfo/bandwidthNote duerfen Score, Ampel, CRV oder Freigabe nicht
     beruehren. Gleiche Pruefart wie bei modelCompare (v3.15.0). */
  const start = app.indexOf('const FEED_BREADTH');
  const ende = app.indexOf('function renderResourceStrip');
  const block = app.slice(start, ende).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(block.length > 500, 'Schnitt ist leer — Anker pruefen');   // Lehre v3.11.0
  for (const verboten of ['buyReady', 'stockLevel', '.score', 'minCrvStock', 'light=', 'netCRV']) {
    assert.ok(!block.includes(verboten),
      `Die Herkunftsanzeige darf ${verboten} nicht beruehren — sie beschreibt nur, wer geliefert hat`);
  }
  assert.ok(/verändert weder Score noch Ampel noch Kauf-Freigabe/.test(block),
    'Die Anzeige muss ihre Wirkungslosigkeit selbst aussprechen');
}

/* ─── 5 · v3.32.0 · Der 401-Fall darf nicht wie ein Datenproblem aussehen ── */
{
  const C = ladeClient();
  /* Ohne Token liefert KEINE /api/-Route Daten. Vorher stand dann dreimal
     gelb „nicht bestimmbar" da, und der Nutzer suchte den Fehler beim
     Anbieter. Lehre 8aa in Reinform. */
  const code2 = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(/if\s*\(authDenied\)/.test(code2), 'feedInfo/bandwidthNote muessen den 401-Fall kennen');
  assert.ok(/authDenied\s*=\s*true/.test(code2), 'Ein 401 muss das Flag setzen');
  /* NK14 hat die erste Fassung dieser Zeile als blind entlarvt: der Regex
     /authDenied = false/ traf die DEKLARATION und war damit immer erfuellt.
     Geprueft werden muss die Ruecknahme im ERFOLGSPFAD — sonst bliebe der
     Token-Hinweis stehen, nachdem der Nutzer ihn eingetragen hat, und die App
     wuerde einen behobenen Fehler weitermelden. */
  assert.match(code2, /lastSuccessfulScanTs = Date\.now\(\);[^\n]*authDenied = false/,
    'Ein erfolgreicher Scan muss das Flag zuruecknehmen, sonst bleibt der Hinweis nach dem Eintragen stehen');

  const fi = C.feedInfo({ provider: 'Tiingo' }, {});
  assert.equal(fi.provider, 'Tiingo', 'Ohne 401 bleibt alles wie gehabt');

  /* Und mit 401: die Ursache muss dastehen, nicht die Diagnose. */
  C.setAuthDenied(true);
  const fi2 = C.feedInfo({ provider: 'Tiingo' }, {});
  assert.match(fi2.label, /Token/, 'Bei 401 muss der fehlende Token genannt werden, nicht „nicht bestimmbar"');
  assert.match(fi2.detail, /Einstellungen/, 'Der Weg zur Loesung muss dabeistehen');
  assert.match(fi2.detail, /KEIN Problem des Datenanbieters/, 'Die Fehldeutung muss ausdruecklich ausgeschlossen werden');
  assert.notEqual(fi2.breadth, 'full', 'Auch im 401-Fall keine volle Marktbreite behaupten');
  const bw2 = C.bandwidthNote({ bandwidth: { measured: true, usedGb: 5, capGb: 40 } });
  assert.equal(bw2.measured, false, 'Bei 401 darf keine Bandbreitenzahl behauptet werden — sie kann gar nicht abgerufen worden sein');
  C.setAuthDenied(false);
}

console.log('✓ FusionPulse v3.32.0 provider/breadth (Audit §28/§29) regressions: OK');
