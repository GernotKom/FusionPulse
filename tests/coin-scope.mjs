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

  /* ══ v4.2.4 · BEIDE BEREICHE SIND GLEICH GEBAUT ═════════════════════════
     Nutzeranmerkung vom 03.09.: „die Sektionen sollten gleich aufgebaut sein
     … das hatten wir schon extrem oft besprochen."

     Bis 4.2.3 war die Abfolge tatsaechlich verschieden, und dieser Test hat
     die Abweichung sogar FESTGESCHRIEBEN: er verlangte die Coin-Suche
     zwischen Stimmung und Liste, also ganz unten — waehrend die Aktiensuche
     seit jeher direkt unter der Ueberschrift steht. Ein Test, der eine
     Asymmetrie zementiert, macht sie unsichtbar: jede Aenderung in Richtung
     Symmetrie liess ihn rot werden, und das sah nach einem Fehler aus.

     Deshalb wird ab hier nicht mehr eine feste Liste je Bereich geprueft,
     sondern die BAUFORM BEIDER BEREICHE GEGENEINANDER. Weicht einer ab, faellt
     der Test — egal welcher. Das ist die einzige Formulierung, die verhindert,
     dass die beiden Seiten wieder auseinanderlaufen. */
  const BAUFORM = [
    ['Band',          'id="bandCoin"',       'id="bandStock"'],
    ['Überschrift',   '<h2>Coin-Radar</h2>', '<h2>Aktienradar</h2>'],
    ['Skope-Fenster', 'class="stage"',       'class="stockstage"'],
    ['Suche darin',   'id="coinTools"',      'id="stockQ"'],
    ['Fokuskarte',    'id="focus"',          'id="stockFocus"'],
    ['★-Leiste',      'id="coinFavStrip"',   'id="depotStrip"'],
    ['Liste',         'id="coinList"',       'id="stockGroups"'],
    ['Empfehlungen',  'id="topPicksCoin"',   'id="topPicks"'],
  ];
  for (const spalte of [1, 2]) {
    const markt = spalte === 1 ? 'Krypto' : 'Aktien';
    let vorher = -1, vorLabel = 'Anfang';
    for (const zeile of BAUFORM) {
      const pos = at(zeile[spalte], `${markt}: ${zeile[0]}`);
      assert.ok(pos > vorher,
        `${markt}: „${zeile[0]}" muss NACH „${vorLabel}" stehen. Beide Bereiche haben dieselbe Bauform — `
        + 'Band, Überschrift, Skope-Fenster mit Suche darin, Kacheln, ★-Leiste, Liste.');
      vorher = pos; vorLabel = zeile[0];
    }
  }

  /* ══ v4.2.7 · DIE SUCHE LIEGT IM SKOPE-FENSTER, NICHT DAVOR ═════════════
     4.2.5 hatte beide Bereiche gleich gebaut — aber die Suche als eigene
     Leiste OBERHALB des Fensters. Das war symmetrisch und trotzdem falsch
     platziert: die Suche entscheidet, WAS im grossen Fenster steht, also
     gehoert sie hinein. Geprueft wird die tatsaechliche Verschachtelung, nicht
     nur die Reihenfolge: die Leiste muss zwischen dem oeffnenden Tag des
     Skope-Fensters und der Fokuskarte liegen. Eine reine Reihenfolgepruefung
     waere auch dann gruen, wenn die Leiste wieder davor stuende. */
  for (const [markt, stage, tools, fokus] of [
    ['Krypto', 'class="stage"',      'id="coinTools"',      'id="focus"'],
    /* Eigene Kennung, weil `class="stocktools"` seit 4.2.5 in BEIDEN Bereichen
       steht — der erste Treffer im Dokument waere sonst immer die Coin-Leiste,
       und die Pruefung liefe an der Aktienseite vorbei. Genau diese Art
       stiller Fehlanker ist heute schon dreimal aufgetreten. */
    ['Aktien', 'class="stockstage"', 'id="stockTools"',  'id="stockFocus"'],
  ]) {
    const sAt = at(stage, `${markt}: Skope-Fenster`), tAt = at(tools, `${markt}: Suchleiste`), fAt = at(fokus, `${markt}: Fokuskarte`);
    assert.ok(sAt < tAt && tAt < fAt,
      `${markt}: Die Suchleiste muss INNERHALB des Skope-Fensters liegen — zwischen dessen Beginn und der Fokuskarte, nicht davor`);
  }

  /* v4.2.7 · Die Auswertung muss als eigene Sektion erkennbar sein. Alle drei
     Bereiche liegen in EINEM Dokument, die Reiter springen nur — wer scrollt,
     laeuft von den Aktien direkt in den Rueckblick. Das Band braucht deshalb
     eine sichtbare Zaesur und nicht nur eine weitere Zeile. */
  {
    const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
    assert.match(css, /#bandLab\{[^}]*border-top/,
      'v4.2.7: Die Auswertung braucht eine sichtbare Trennlinie zum Aktienbereich');
    assert.match(css, /#bandLab \.domain-head\{[^}]*background/,
      'v4.2.7: … und eine abgesetzte Ueberschrift, nicht nur Text');
    assert.ok(at('id="stockGroups"', 'Aktienliste') < at('id="bandLab"', 'Auswertungsband'),
      'v4.2.7: Die Auswertung steht hinter BEIDEN Maerkten — sie wertet beide aus');
  }

  /* ══ v4.2.8 · ERST DIE LISTE, DANN DIE EMPFEHLUNGEN ═════════════════════
     Die Trefferliste steht in beiden Bereichen direkt unter dem Skope-Fenster
     und VOR den Empfehlungs-Kacheln. Erst was ist, dann was vorgeschlagen
     wird. Bis 4.2.7 lag die Aktienliste hinter neun Kacheln am Ende des
     Abschnitts, die Coin-Liste hinter dreien. */
  for (const [markt, stage, liste, empf] of [
    ['Krypto', 'class="stage"',      'id="coinList"',    'id="topPicksCoin"'],
    ['Aktien', 'class="stockstage"', 'id="stockGroups"', 'id="topPicks"'],
  ]) {
    assert.ok(at(stage, `${markt}: Skope`) < at(liste, `${markt}: Liste`),
      `${markt}: Die Trefferliste gehoert unter das Skope-Fenster`);
    assert.ok(at(liste, `${markt}: Liste`) < at(empf, `${markt}: Empfehlungen`),
      `${markt}: Die Empfehlungen kommen NACH der Trefferliste, nicht davor`);
  }

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

/* ══ v4.2.4 · GLEICHE BAUFORM HEISST AUCH GLEICHE BEDIENELEMENTE ══════════
   Die Reihenfolge oben ist die halbe Symmetrie. Die andere Haelfte sind die
   Bedienelemente an den entsprechenden Stellen — sonst sind die Bereiche
   gleich aufgebaut und trotzdem verschieden bedienbar. */
{
  const at = (needle, label) => { const i = idx.indexOf(needle); assert.ok(i > 0, `${label} fehlt: ${needle}`); return i; };

  /* 1 · Suchfeld, Loeschknopf, Ladeknopf, Rueckmeldung — beidseitig. */
  for (const [markt, feld, clear, go, note] of [
    ['Krypto', 'id="q"',      'id="coinSearchClear"',  'id="coinSearchGo"',  'id="coinSearchNote"'],
    ['Aktien', 'id="stockQ"', 'id="stockSearchClear"', 'id="stockSearchGo"', 'id="stockSearchPreview"'],
  ]) {
    at(feld, `${markt}: Suchfeld`); at(clear, `${markt}: Löschknopf`);
    at(go, `${markt}: Ladeknopf`);  at(note, `${markt}: Rückmeldung`);
  }

  /* 2 · Beide Filter bieten die Favoritenansicht an. */
  const fCoin = idx.slice(at('id="f"', 'Coin-Filter'), at('id="iv"', 'Intervall'));
  const fStock = idx.slice(at('id="stockF"', 'Aktienfilter'), at('id="watchlistToggle"', 'Watchlist-Schalter'));
  assert.match(fCoin, /value="favorites"/, 'Der Coin-Filter muss die Favoritenansicht anbieten');
  assert.match(fStock, /value="favorites"/, 'Der Aktienfilter ebenso');

  /* 3 · DER STERN IM GROSSEN FOKUSFENSTER, BEIDSEITIG.
     Er stand bis 4.2.3 nur in der Aktien-Fokuskarte. Wer einen Coin im Fokus
     hatte, musste zum Markieren erst in der Liste danach suchen — obwohl der
     Fokus die Stelle ist, an der man sich fuer einen Titel entscheidet. */
  const app2 = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const coinFocus = app2.slice(app2.indexOf('function renderFocus()'), app2.indexOf('function renderMap()'));
  const stockFocus = app2.slice(app2.indexOf('topBox.innerHTML=`<div class="stockfocus-card'), app2.indexOf('topBox.innerHTML=`<div class="stockfocus-card') + 4000);
  assert.match(coinFocus, /<h2><button class="favbtn/,
    'v4.2.4: Das Coin-Fokusfenster braucht die Favoritenmarkierung — die Aktienseite hat sie seit jeher');
  assert.match(stockFocus, /<h3><button class="favbtn/,
    'v4.2.4: … und die Aktienseite muss sie behalten');
  assert.match(coinFocus, /\$\('#focus \[data-favpair\]'\)\?\.addEventListener/,
    'v4.2.4: Der Stern im Fokus muss auch wirklich schalten, nicht nur dastehen');
  /* Eine Wirkung, zwei Stellen: der Fokus-Stern ruft denselben Umschalter wie
     die Listenzeile. Ein eigener Pfad waere die naechste stille Zweitwahrheit. */
  assert.equal((coinFocus.match(/togglePairFavorite\(/g) || []).length, 1,
    'v4.2.4: Der Fokus-Stern muss denselben Umschalter benutzen wie die Liste');
}

console.log('✓ FusionPulse v4.2.4 Symmetrie beider Marktbereiche (ausgefuehrt): OK');

/* ══ v4.2.8 · DER TEST LAS DIE DATEI, DER BROWSER SAH ETWAS ANDERES ════════
   Die Reihenfolge im Markup war seit 4.2.5 richtig, alle Prüfungen darauf
   waren grün — und das Krypto-Skope-Fenster stand trotzdem ganz unten. Ursache
   war EINE Zeile in `applyPrimaryBlockOrder()`:

       if(main && stage) main.insertAdjacentElement('afterend', stage);

   Sie schob das Fenster beim Booten hinter `<main>` — und in `<main>` lagen
   Coin-Liste, Aktienbereich UND Auswertung. Das Fenster landete am Ende der
   Seite, hinter dem Lab.

   Das ist der Grund, warum die Anordnung mehrfach zurückkam: eine zweite,
   unsichtbare Reihenfolge neben dem Markup. Jede Korrektur an index.html war
   wirkungslos, und kein Test konnte es sehen, weil alle die Datei lesen.

   Deshalb prüft dieser Block die FUNKTION selbst: sie darf ausschließlich den
   Aktienblock verschieben. Jedes weitere `insertAdjacentElement`,
   `insertBefore`, `append` oder `prepend` dort ist eine neue Zweitwahrheit —
   und wird hier rot, bevor sie ein Layouträtsel wird. */
{
  const app3 = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const fn = app3.slice(app3.indexOf('function applyPrimaryBlockOrder()'),
                        app3.indexOf('/* --------------------------------------------------------------------- Boot */'));
  assert.ok(fn.length > 100, 'v4.2.8: applyPrimaryBlockOrder muss auffindbar sein');
  const stripped = fn.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  const umzuege = [...stripped.matchAll(/insertAdjacentElement|insertBefore|appendChild|\.append\(|\.prepend\(|\.after\(|\.before\(/g)];
  assert.equal(umzuege.length, 1,
    `v4.2.8: applyPrimaryBlockOrder darf GENAU EINEN Umzug ausführen (den Aktienblock), gefunden: ${umzuege.length}. `
    + 'Jeder weitere Umzug ist eine zweite Reihenfolge neben dem Markup — genau daran ist die Anordnung mehrfach gescheitert.');
  assert.doesNotMatch(stripped, /stage/,
    'v4.2.8: Das Skope-Fenster darf zur Laufzeit NICHT mehr verschoben werden — seine Position steht im Markup');
  assert.match(stripped, /viewbar\.insertAdjacentElement\('afterend',\s*stocks\)/,
    'v4.2.8: Der eine erlaubte Umzug ist der Aktienblock vor den Kryptoblock');

  /* Und die Gegenrichtung: es darf auch sonst nirgends im Boot-Pfad ein
     Layoutblock verschoben werden. `paint()` sortiert Listenzeilen — das ist
     Inhalt, keine Seitenstruktur, und deshalb ausgenommen. */
  const boot = app3.slice(app3.indexOf('/* --------------------------------------------------------------------- Boot */'));
  const bootStripped = boot.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  assert.doesNotMatch(bootStripped, /insertAdjacentElement/,
    'v4.2.8: Im Boot-Pfad darf kein weiterer Block umgehängt werden');
}

console.log('✓ FusionPulse v4.2.8 Markup ist die einzige Reihenfolge (ausgefuehrt): OK');
