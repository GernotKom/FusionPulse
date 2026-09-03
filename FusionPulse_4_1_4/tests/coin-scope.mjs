/* ══════════════════ v3.30.0 · Suite 48 · R1 · Coin-Skope im Fokusfenster ═══
   WARUM DIESE SUITE IN EINER EIGENEN DATEI STEHT
   An `src/worker.js` und an `tests/safety-regression.mjs` arbeitet parallel ein
   zweiter Strang. Eine neue Suite mitten in die 327-KB-Datei zu schreiben waere
   ein sicherer Merge-Konflikt. Diese Datei ist additiv: sie aendert nichts.
   → Naechster Bearbeiter: eine Zeile in `package.json` haengt sie in `check`:
     "test:coinscope": "node tests/coin-scope.mjs"  und in `check` anhaengen.

   WAS SIE BEWEIST
   R1 war zwanzig Versionen offen, weil die Meldung als REIHENFOLGE gelesen
   wurde. Die Reihenfolge stimmte seit v3.9.1. Falsch war der INHALT: das erste
   Fenster enthielt den Plan, die eigentliche Analyse lag im Modal hinter dem
   letzten Knopf. Diese Suite nagelt deshalb BEIDES fest — Position UND Inhalt.
   Ein Test nur auf die Position haette den Fehler wieder nicht gesehen; genau
   so ist er zwanzig Versionen alt geworden.

   Alle Pruefungen wurden mit einer Negativkontrolle belegt (Protokoll in
   RELEASE_NOTES_v3_30_0.md). */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const idx = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

/* ─────────────────────────────────────────────────────────────────────────
   1 · POSITION — die tatsaechliche Abfolge im Markup, nicht das Vorhandensein
   ───────────────────────────────────────────────────────────────────────── */
{
  const at = (needle, label) => {
    const i = idx.indexOf(needle);
    assert.ok(i > 0, `${label} nicht gefunden: ${needle}`);
    return i;
  };

  const abfolge = [
    ['id="bandCoin"',        'Überschrift Krypto'],
    ['class="stage"',        'Fokus + Heatmap'],
    ['id="topPicksCoin"',    'Top Picks'],
    ['id="cryptoMovers"',    'Mover'],
    ['id="sentimentCard"',   'Stimmung'],
    ['class="coinbar"',      'Suche/Filter'],
    ['<section id="list"',   'Coin-Liste'],
  ];
  let vorher = -1, vorLabel = 'Anfang';
  for (const [needle, label] of abfolge) {
    const pos = at(needle, label);
    assert.ok(pos > vorher, `Abfolge Kryptobereich verletzt: „${label}" muss NACH „${vorLabel}" stehen`);
    vorher = pos; vorLabel = label;
  }

  /* Zwischen Band und Fokus darf NICHTS Krypto-Bezogenes stehen. Sonst waere
     „an erster Stelle" wieder Auslegungssache. */
  const zwischenraum = idx.slice(at('id="bandCoin"', 'Band'), at('class="stage"', 'Fokus'));
  assert.ok(!/data-domain="coin"/.test(zwischenraum.replace(/id="bandCoin"[\s\S]*?<\/div>\s*<\/div>/, '')),
    'Zwischen Krypto-Band und Fokusfenster darf keine weitere Krypto-Kachel liegen');

  /* Der Fokus steht vor dem Aktienbereich — sonst waere er nicht „zuerst". */
  assert.ok(at('class="stage"', 'Fokus') < at('<section id="stocks"', 'Aktienabschnitt'),
    'Das Krypto-Fokusfenster muss vor dem Aktienbereich stehen');
}

/* ─────────────────────────────────────────────────────────────────────────
   2 · EINE QUELLE — kein zweiter Textbaustein
   In 8f (sectorLag) und 8i (Live-Quote) stand dieselbe Kennzahl auf zwei
   Pfaden, einer davon still veraltet. Zwei Kopien der Faktorzeilen waeren
   derselbe Fehler in der Anzeige.
   ───────────────────────────────────────────────────────────────────────── */
{
  const treffer = app.split("factor('Multi-Timeframe'").length - 1;
  assert.ok(treffer >= 1, 'Die Faktorzeilen fehlen ganz — der Skope-Block hat keinen Inhalt mehr');
  assert.equal(treffer, 1,
    `Die Faktorzeilen stehen ${treffer}× im Quelltext, erlaubt ist genau EINMAL ` +
    '(in coinScopeBlocks). Zwei Kopien laufen garantiert auseinander — 8f und 8i.');

  assert.ok(/function coinScopeBlocks\s*\(/.test(app), 'coinScopeBlocks muss existieren');

  const detail = app.slice(app.indexOf('function refreshDetail'), app.indexOf('function logTrade'));
  assert.ok(detail.length > 200, 'Schnitt refreshDetail ist leer — Anker pruefen');   // Lehre v3.11.0
  assert.ok(detail.includes('coinScopeBlocks(r)'),
    'Das Detailfenster muss denselben Baustein benutzen wie das Fokusfenster');

  const fokus = app.slice(app.indexOf('function renderFocus'), app.indexOf('function historyBand'));
  assert.ok(fokus.length > 200, 'Schnitt renderFocus ist leer — Anker pruefen');
  assert.ok(fokus.includes('coinScopeBlocks(r)'),
    'Das Fokusfenster muss den Skope-Baustein enthalten — das ist der Kern von R1');
  assert.ok(fokus.includes('class="coinscope"'), 'Der Skope-Block braucht seinen eigenen Behaelter');
}

/* ─────────────────────────────────────────────────────────────────────────
   3 · CSS — ausgelesen, nicht geraten (Lehre 8aa)
   ───────────────────────────────────────────────────────────────────────── */
{
  const regel = css.slice(css.indexOf('.coinscope{'), css.indexOf('.coinscope{') + 200);
  assert.ok(css.includes('.coinscope{'), 'Es braucht eine Regel fuer .coinscope');
  assert.ok(/grid-column:1\/-1/.test(regel),
    '.coinscope muss beide Spalten des Fokus-Rasters ueberspannen — sonst zieht es die Preisleiter in die Laenge');
  /* Der Fehler aus 8aa, woertlich: eine Kachel auf feste Hoehe gestutzt. */
  assert.ok(!/\.coinscope\{[^}]*height:\s*\d/.test(css),
    '.coinscope darf keine feste Hoehe haben — der Inhalt ist variabel lang');
  assert.ok(!/\.coinscope\{[^}]*overflow:\s*hidden/.test(css),
    '.coinscope darf nichts abschneiden');
  assert.ok(css.includes('.cscope-head'), 'Die Ueberschrift des Skope-Blocks braucht eine Regel');
  /* Die eingebetteten Klassen muessen bereits Regeln haben, sonst ist der
     Block zwar da und trotzdem nicht lesbar (vierter Fall dieser Klasse). */
  for (const k of ['.factor{', '.fbar{', '.metrics{', '.metric{', '.hint{', '.coin-intraday']) {
    assert.ok(css.includes(k), `Regel fehlt fuer ${k} — Inhalt waere unformatiert`);
  }
}

/* ─────────────────────────────────────────────────────────────────────────
   4 · AUSGEFUEHRT — was steht wirklich im Fokusfenster?
   Regex sieht, was da ist, nie was fehlt (8v). Deshalb wird `renderFocus`
   hier WIRKLICH aufgerufen und das Ergebnis ausgelesen.
   ───────────────────────────────────────────────────────────────────────── */
function stubEl() {
  const el = {
    style: (() => { const m = new Map(); return {
      _map: m, setProperty(k, v) { m.set(k, String(v)); },
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
  const store = new Map();
  const elCache = new Map();
  const elFor = (sel) => { const k = String(sel);
    if (!elCache.has(k)) elCache.set(k, stubEl());
    return elCache.get(k); };
  const doc = {
    readyState: 'complete', documentElement: stubEl(), body: stubEl(), head: stubEl(),
    hidden: false, visibilityState: 'visible',
    createElement() { return stubEl(); }, createTextNode() { return stubEl(); },
    getElementById(id) { return elFor('#' + id); },
    querySelector(sel) { return elFor(sel); }, querySelectorAll() { return []; },
    addEventListener() {}, removeEventListener() {},
  };
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
    performance: { now: () => 0 },
    crypto: { randomUUID: () => 'test-uuid', getRandomValues: a => a },
  };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
  ctx.Notification.permission = 'denied';
  ctx.Notification.requestPermission = async () => 'denied';

  const epilog = `
;globalThis.__fp = {
  el: __elFor,
  renderFocus, coinScopeBlocks,
  get rows(){return rows;}, set rows(v){rows=v;},
  get selected(){return selected;}, set selected(v){selected=v;},
  get S(){return S;}
};`;
  vm.createContext(ctx);
  vm.runInContext(app + epilog, ctx, { filename: 'app.js' });
  return ctx.__fp;
}

/* Ein Coin, bei dem ALLES gemessen ist. Positivkontrolle — ohne sie ist jeder
   Negativtest wertlos (Lehre 8z). */
function coin(over = {}) {
  return {
    pair: 'SOL-EUR', light: 'green', setup: 'Pullback', regime: 'Risk-On', orderType: 'limit',
    price: 100, entry: 100, stop: 97, tp1: 104, tp2: 108, zoneLow: 99, zoneHigh: 101,
    quality: 8.2, executability: 7.4, netCRV: 3.1, riskPct: 3, costPct: 0.4, costRatio: 5.2,
    slipBps: 6, spreadPct: 0.0012, buyCapacity: 24000, sellCapacity: 21000, imbalance: 0.18,
    vwapDev: 0.6, rsi: 58, atrPct: 2.4, tp2Source: 'Fibonacci 1.618',
    mtf: 7.5, volumeAcceleration: 6.8, relativeStrength: 7.1, compression: 5.9,
    trendQuality: 8.0, bookScore: 6.4, liquidity: 7.7, elliott: 6.1, exhaustion: 2.2,
    blockers: [], inZone: true, spark: [98, 99, 100, 101, 100], _age: 900000, _streak: 4,
    _history: [], components: ['mtf', 'volume', 'rs', 'squeeze', 'ema21', 'book', 'elliott'],
    analysisMode: 'standard',
    ...over,
  };
}

{
  const C = ladeClient();
  C.rows = [coin()];
  C.selected = 'SOL-EUR';
  C.renderFocus();
  const html = C.el('#focus').innerHTML;

  assert.ok(html.length > 500, 'renderFocus hat nichts geschrieben — Fixture oder Harness pruefen');

  /* --- der Kern von R1: die Analyse steht IM Fokusfenster ---------------- */
  assert.ok(html.includes('class="coinscope"'), 'Der Skope-Block fehlt im Fokusfenster');
  assert.ok(/Alles zu\s*SOL/.test(html), 'Der Skope-Block muss benennen, um welchen Coin es geht');
  assert.ok(html.includes('Intraday-Kurs'), 'Kursverlauf fehlt im Fokusfenster');
  assert.ok(html.includes('Mikrostruktur'), 'Mikrostruktur fehlt im Fokusfenster');
  assert.ok(html.includes('Ziel-Herkunft'), 'Ziel-Herkunft fehlt im Fokusfenster');
  assert.ok(html.includes('Fibonacci 1.618'), 'Die Herkunft des Kursziels muss ablesbar sein');

  /* Alle neun Faktoren, einzeln. Eine Sammelpruefung („mindestens ein
     Faktor") wuerde acht fehlende nicht bemerken. */
  for (const f of ['Multi-Timeframe', 'Volumen-Beschleunigung', 'Relative Stärke (BTC)',
                   'Kompression / Squeeze', 'Trendqualität (EMA)', 'Orderbuch-Druck',
                   'Liquidität', 'Elliott-Wellen', 'Erschöpfung']) {
    assert.ok(html.includes(f), `Faktor „${f}" fehlt im Fokusfenster`);
  }
  assert.equal(html.split('class="factor').length - 1, 9, 'Es muessen genau neun Faktorzeilen sein');

  /* --- die Werte muessen auch wirklich drinstehen, nicht nur die Labels --- */
  assert.ok(html.includes('58'), 'RSI-Wert fehlt');
  assert.ok(html.includes('6 bps'), 'Slippage-Wert fehlt');

  /* --- der alte Weg bleibt erhalten (Invariante 6: nichts still streichen) */
  assert.ok(html.includes('id="fdet"'), 'Der Knopf ins Detailfenster darf nicht verschwinden');
}

/* ─────────────────────────────────────────────────────────────────────────
   5 · FAIL-CLOSED — fehlende Werte duerfen nichts erfinden
   Regel 2 des Projekts: `Number(null)` ist 0, nicht NaN. Der Test benutzt
   deshalb die Werte, die die Abwehr tatsaechlich erreichen (Lehre 8z), und
   prueft JEDES Feld einzeln (Lehre 8y) statt nur den Idealfall.
   ───────────────────────────────────────────────────────────────────────── */
{
  const C = ladeClient();
  const leer = coin({
    spreadPct: null, slipBps: null, buyCapacity: null, sellCapacity: null,
    imbalance: null, vwapDev: null, rsi: null, atrPct: null, tp2Source: null,
    costRatio: null, mtf: null, volumeAcceleration: null, relativeStrength: null,
    compression: null, trendQuality: null, bookScore: null, liquidity: null,
    elliott: null, exhaustion: null,
  });
  C.rows = [leer]; C.selected = 'SOL-EUR';
  C.renderFocus();
  const html = C.el('#focus').innerHTML;

  const skope = html.slice(html.indexOf('class="coinscope"'));
  assert.ok(skope.length > 300, 'Skope-Block im Ausfallfall leer — Schnitt pruefen');
  assert.ok(!/NaN/.test(skope), 'Ein nicht gemessener Wert darf nie als NaN erscheinen');
  assert.ok(!/undefined|>null</.test(skope), 'Ein nicht gemessener Wert darf nie als null/undefined erscheinen');
  assert.ok(!/>0 %</.test(skope), 'Ein fehlender Wert darf nie als gemessene Null durchgehen (Regel 2)');
  assert.ok(skope.includes('(n.v.)'), 'Nicht messbare Faktoren muessen als solche gekennzeichnet sein');
  /* Und die Faktorbalken duerfen dann nicht gefuellt sein. */
  assert.ok(!/class="factor"[^>]*>[\s\S]{0,400}?width:\s*[1-9]/.test(skope),
    'Ein nicht messbarer Faktor darf keinen gefuellten Balken bekommen');

  /* Der Coin ohne Auswahl: leeres Fenster, aber kein Absturz und kein Skope. */
  const C2 = ladeClient();
  C2.rows = []; C2.selected = null;
  C2.renderFocus();
  const leerHtml = C2.el('#focus').innerHTML;
  assert.ok(!leerHtml.includes('class="coinscope"'),
    'Ohne ausgewaehlten Coin darf kein Skope-Block behauptet werden');
}

console.log('✓ FusionPulse v3.30.0 coin-scope (R1) regressions: OK');
