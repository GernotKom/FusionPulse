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

/* ─── 6 · v3.32.1 · Auth: Trim, Diagnose, kein Passwortfeld ─────────────── */
{
  const w = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  const wcode = w.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  /* Unsichtbare Zeichen im Secret sind die haeufigste Ursache fuer ein
     „Token stimmt doch!" — `echo "x" | wrangler secret put` haengt \n an. */
  assert.match(wcode, /const want = String\(env\.APP_TOKEN\)\.trim\(\)/,
    'Das erwartete Secret muss getrimmt werden — ein angehaengtes \\n macht den Vergleich unmoeglich');
  assert.match(wcode, /\.trim\(\);\s*\n\s*return !!got && got === want;/,
    'Auch der gesendete Wert muss getrimmt werden');
  /* Aber ein LEERER Token darf nie durchkommen — sonst haette das Trimmen den
     Zugang geoeffnet statt repariert. */
  assert.ok(wcode.includes('return !!got && got === want;'),
    'Ein leerer Token darf NIEMALS als gueltig gelten');

  /* Die Diagnose muss unterscheiden, aber nichts verraten. */
  const hint = w.slice(w.indexOf('function authHint'), w.indexOf('function authHint') + 1400);
  assert.ok(hint.length > 300, 'Schnitt authHint ist leer — Anker pruefen');
  assert.ok(hint.includes('gar kein Zugriffs-Token an'), 'Fall 1: nichts angekommen');
  assert.ok(hint.includes('falsche Länge'), 'Fall 2: falsche Laenge (iOS-Autofill)');
  assert.ok(hint.includes('stimmt aber nicht überein'), 'Fall 3: falscher Wert');
  assert.ok(!/\$\{want\}|\+ want|want\.slice|want\.length\}/.test(hint),
    'Der Hinweis darf weder das Geheimnis noch seine Laenge ausgeben');
  assert.ok(!/APP_TOKEN\}/.test(hint), 'Das Secret darf nirgends in die Antwort gelangen');

  /* Das Feld darf kein Passwortfeld mehr sein — Safari ignoriert dort
     autocomplete="off" und fuellt es ungefragt. */
  assert.ok(!/id="sToken"[^>]*type="password"/.test(idx),
    'Der Zugriffs-Token darf kein type="password" sein: iOS fuellt solche Felder selbst aus');
  assert.match(idx, /id="sToken"[^>]*autocapitalize="none"/,
    'Ohne autocapitalize wird das erste Zeichen auf dem iPhone grossgeschrieben');
  assert.match(idx, /id="sToken"[^>]*spellcheck="false"/, 'Keine Autokorrektur auf einem Token');

  /* Und der Server-Hinweis muss beim Nutzer ankommen. */
  const acode = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(acode, /res\.status === 401 && data\.hint/,
    'Der Client muss den Hinweis aus der 401-Antwort uebernehmen');
  assert.match(acode, /authHintText \? authHintText/,
    'Und ihn anzeigen — sonst bleibt es beim nichtssagenden „Nicht autorisiert"');
}

/* ─── 7 · v3.32.2 · Die Systemampel darf im Ausfall nicht gruen sein ─────── */
{
  const acode = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const strip = acode.slice(acode.indexOf('function renderResourceStrip'),
                            acode.indexOf('function renderResourceStrip') + 2600);
  assert.ok(strip.length > 500, 'Schnitt renderResourceStrip ist leer — Anker pruefen');

  /* Der gemeldete Fall: 401, keine Statusauskunft, Ampel stand auf gruen. */
  assert.match(strip, /if\(authDenied \|\| health\?\.authenticated===false\)/,
    'Bei fehlendem Token muss die Ampel VOR der Levelberechnung abbiegen');
  assert.ok(/authDenied[\s\S]{0,600}?classList\.add\('err'\)/.test(strip),
    'Der 401-Fall muss ROT sein, nicht gruen');
  assert.ok(/weder Aktien noch Krypto/.test(strip),
    'Es muss dastehen, dass AUCH Krypto betroffen ist — es laeuft ueber dieselbe geschuetzte Route');

  /* Und der allgemeinere Fall: keine Auskunft ist nicht „in Ordnung". */
  assert.match(strip, /if\(!states\.length\)/,
    'Ohne Statusauskunft darf nicht auf gruen zurueckgefallen werden');
  assert.ok(/!states\.length[\s\S]{0,500}?classList\.add\('orange'\)/.test(strip),
    'Fehlende Auskunft muss sichtbar sein — Lehre 8x: nicht bewertbar ist nicht neutral');
  /* Die Reihenfolge ist entscheidend: beide Abbiegungen MUESSEN vor der Zeile
     stehen, die aus fehlenden Meldungen `green` ableitet. */
  assert.ok(strip.indexOf("if(!states.length)") < strip.indexOf("const level=red?'red'"),
    'Die Abbiegungen muessen vor der Levelberechnung stehen, sonst greifen sie nie');
  assert.ok(strip.indexOf('if(authDenied') < strip.indexOf("if(!states.length)"),
    'Der konkrete 401-Grund muss vor der allgemeinen Meldung kommen');
}

/* ─── 8 · v3.32.3 · Ein klebriger Merker darf die Anzeige nicht kapern ───── */
{
  const acode = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  /* Der Fehler aus v3.32.0: Das Flag kam aus einem TEXTMUSTER ueber beliebige
     Fehlermeldungen. Jede Meldung, in der zufaellig „401" vorkommt, loeste es
     aus — und zurueckgenommen wurde es nur an einer Stelle. */
  assert.ok(!/nicht autorisiert\|unauthorized/.test(acode),
    'authDenied darf NICHT aus einem Textmuster ueber Fehlermeldungen kommen — nur aus dem HTTP-Status');
  assert.match(acode, /if\(lastHttpStatus === 401\)\s*\{\s*authDenied = true/,
    'Nur ein echter HTTP-401 darf das Flag setzen');
  assert.match(acode, /lastHttpStatus = res\.status;/, 'Der Status muss ueberhaupt festgehalten werden');

  /* Setzer und Ruecknahme muessen gleich breit sein. Die Ruecknahme gehoert
     in den regelmaessigen Health-Abruf, nicht in einen einzelnen Erfolgspfad. */
  const lh = acode.slice(acode.indexOf('async function loadHealth'), acode.indexOf('async function loadHealth') + 900);
  assert.ok(lh.length > 200, 'Schnitt loadHealth ist leer — Anker pruefen');
  assert.match(lh, /health\.status && Object\.keys\(health\.status\)\.length[\s\S]{0,120}authDenied = false/,
    'Eine gelieferte Statusauskunft muss den Merker zuruecknehmen — sonst bleibt er kleben');

  /* Und die Widerspruchsregel: was messbar da ist, schlaegt was gemerkt wurde. */
  const strip = acode.slice(acode.indexOf('function renderResourceStrip'),
                            acode.indexOf('function renderResourceStrip') + 2800);
  /* v3.32.6: Die Regel haengt nicht mehr an EINEM Indikator. `states.length`
     war zu schwach — die drei Zustandsfelder koennen leer sein, obwohl der
     Server sauber antwortet. Geprueft wird jetzt, dass mehrere unabhaengige
     Belege den Merker zuruecknehmen. */
  assert.match(strip, /const bedientUns = states\.length/,
    'Es braucht mehrere unabhaengige Belege, nicht nur die drei Zustandsfelder');
  for (const beleg of ['health.bandwidth', 'health.components', 'lastSuccessfulScanTs']) {
    assert.ok(strip.includes(beleg),
      `„${beleg}" muss als Beleg fuer einen funktionierenden Zugang zaehlen`);
  }
  assert.match(strip, /if\(bedientUns && authDenied\)\{ authDenied=false/,
    'Liegt ein Beleg vor, darf ein alter Merker die Leiste nicht rot faerben');
  assert.match(strip, /if\(lastHttpStatus===401\) lastHttpStatus=0/,
    'Auch der Statuscode muss zurueckgesetzt werden — sonst setzt der naechste beliebige Fehler das Flag erneut');
  assert.ok(strip.indexOf('const bedientUns') < strip.indexOf('if(authDenied || health'),
    'Die Widerspruchsregel muss VOR der roten Abbiegung greifen, sonst wirkt sie nie');

  /* Der eigentliche Fehler von v3.32.5: `lastHttpStatus` wurde nur im
     Fehlerzweig gesetzt und nie zurueckgenommen. Ein einziger 401 beim Start
     blieb damit fuer immer stehen, und jede spaetere Zeitueberschreitung las
     ihn und meldete „Zugriffs-Token fehlt". */
  assert.match(acode, /const res = await fetchWithTimeout\(`\/api\/scan[\s\S]{0,200}?lastHttpStatus = res\.status;/,
    'Der Statuscode muss bei JEDER Antwort gesetzt werden, nicht nur im Fehlerfall');
}

/* ─── 9 · v3.32.4 · Die Diagnose muss LESBAR sein ───────────────────────── */
{
  const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
  const ccode = css.replace(/\/\*[\s\S]*?\*\//g, '');

  /* Die Grundregel bleibt: schmal und einzeilig im Normalfall. */
  assert.match(ccode, /\.resource-strip span\{[^}]*white-space:nowrap/,
    'Im Normalfall bleibt die Leiste einzeilig — sonst faellt die Kopfzeile auseinander');

  /* Aber im Fehlerfall darf sie nicht kuerzen. Sonst ist die dreiteilige
     Diagnose aus v3.32.1 unsichtbar — der Fehler aus 8aa. */
  assert.match(ccode, /\.resource-strip\.err span[^{]*\{[^}]*white-space:normal/,
    'Im Fehlerfall muss der Text umbrechen duerfen, nicht abgeschnitten werden');
  assert.match(ccode, /\.resource-strip\.err span[^{]*\{[^}]*overflow:visible/,
    'overflow:hidden wuerde die Diagnose weiterhin verschlucken');
  assert.match(ccode, /\.resource-strip\.err[^{]*\{[^}]*max-width:none/,
    'Die 190-px-Grenze muss im Fehlerfall entfallen');
  /* Und der orange Fall („Zustand nicht abrufbar") genauso — er traegt
     ebenfalls einen erklaerenden Satz. */
  assert.match(ccode, /\.resource-strip\.orange span[^{]*\{[^}]*white-space:normal/,
    'Auch die orange Meldung muss vollstaendig lesbar sein');
}

/* ─── 10 · v3.32.5 · Die Aufschluesselung muss IN der App stehen ─────────── */
{
  const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
  const acode = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  assert.ok(idx.includes('id="bwTable"'), 'Es braucht einen Platz fuer die Aufschluesselung im Aktienkopf');
  assert.match(acode, /function renderBandwidthTable/, 'Die Tabelle muss gerendert werden');
  /* NK38 hat die erste Fassung dieser Zeile als blind entlarvt: `/\.bwtab\{/`
     traf auch die Regel INNERHALB des `@media`-Blocks. Die Basisregel konnte
     also entfernt werden, ohne dass der Test es merkte — die Tabelle waere auf
     dem Desktop unformatiert gewesen. Geprueft wird jetzt die Basisregel mit
     ihrem Inhalt, ausserhalb jedes Media-Query. */
  const cssBase = css.replace(/@media[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g, '');
  assert.match(cssBase, /\.bwtab\{width:100%;border-collapse:collapse/,
    'Die Basisregel der Tabelle muss ausserhalb jedes Media-Query stehen');
  assert.match(cssBase, /\.bwtab th\{/, 'Auch die Kopfzeile braucht eine Regel');
  assert.match(cssBase, /\.bwtable\{/, 'Der Behaelter braucht eine Regel');

  /* Sie darf nur erscheinen, wenn wirklich gemessen wurde — sonst behauptet
     eine leere Tabelle eine Messung, die es nicht gibt (Lehre 8f). */
  const fn = acode.slice(acode.indexOf('function renderBandwidthTable'),
                         acode.indexOf('function bandwidthNote'));
  assert.ok(fn.length > 300, 'Schnitt renderBandwidthTable ist leer — Anker pruefen');
  assert.match(fn, /bw\.measured!==true/, 'Ohne echte Messung darf keine Tabelle erscheinen');
  assert.match(fn, /!Array\.isArray\(bw\.paths\) \|\| !bw\.paths\.length/,
    'Auch eine leere Pfadliste darf keine Tabelle erzeugen');
  assert.match(fn, /host\.hidden=true/, 'Im Zweifel bleibt sie verborgen');
  /* Die mittlere Antwortgroesse ist die entscheidende Zahl — an ihr laesst
     sich ablesen, welcher Pfad die Bandbreite frisst. */
  assert.match(fn, /r\.avgKb!=null\?/, 'Die mittlere Antwortgroesse muss dastehen, fail-closed bei fehlendem Wert');
  assert.ok(!/avgKb\)\|\|0|Number\(r\.avgKb\)\|\|0/.test(fn),
    'Ein fehlender Mittelwert darf nicht als 0 KB erscheinen');
}

/* ─── 9 · v3.32.7 · `protected` ist keine Aussage ueber dieses Geraet ────── */
{
  const acode = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const wcode = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  /* Der gemeldete Fall vom 01.09.: Der richtige Token ist eingetragen, die
     Daten laufen, alle Einzelampeln gruen — und die Systemleiste meldet
     „Zugriffs-Token fehlt auf diesem Geraet". Ursache: `/api/health` liefert
     `protected: !!env.APP_TOKEN` — eine Eigenschaft der INSTALLATION, wahr
     sobald ueberhaupt ein APP_TOKEN gesetzt ist. Der Client las das als
     Urteil ueber den Anrufer. */
  assert.ok(!/health\?\.protected===true/.test(acode),
    '`protected` beschreibt die Installation und darf die Systemleiste NIE rot faerben');
  assert.match(acode, /if\(authDenied \|\| health\?\.authenticated===false\)/,
    'Nur eine Aussage ueber DIESE Anfrage (`authenticated`) darf rot faerben');

  /* `=== false`, nicht `!== true`: ein Worker vor v3.32.7 sendet das Feld gar
     nicht, und „nicht gesagt" ist nicht „verneint". Sonst waere jede aeltere
     Installation ab dem Update dauerhaft rot — derselbe Fehler in neuer Form. */
  assert.ok(!/health\?\.authenticated!==true/.test(acode),
    'Ein fehlendes Feld darf nicht als Verneinung gelten — sonst faerbt das Update alte Worker rot');

  /* Und die Gegenseite: der Worker muss das Feld ueberhaupt liefern, in BEIDEN
     Antworten. Fehlte es in der autorisierten, bliebe die Leiste stumm; fehlte
     es in der abgewiesenen, meldete sie einen echten 401 nicht mehr. */
  assert.match(wcode, /protected:true,authenticated:false/,
    'Die abgewiesene Health-Antwort muss `authenticated:false` sagen');
  assert.match(wcode, /protected: !!env\.APP_TOKEN,[\s\S]{0,200}?authenticated: true,/,
    'Die autorisierte Health-Antwort muss `authenticated:true` sagen');
}

console.log('✓ FusionPulse v3.32.7 provider/breadth (Audit §28/§29) regressions: OK');
