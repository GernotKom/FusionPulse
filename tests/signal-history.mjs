/* ══ v4.2.9 · VERLAUF DER KAUF-FREIGABEN (ausgefuehrt) ══════════════════════
   Anlass war eine Nutzerfrage: „USELESS wurde 2x empfohlen und ist heute
   74 % gestiegen — Muster oder Zufall?" Beantwortbar wird sie nur, wenn die
   ZAEHLWEISE stimmt. Eine gruene Lage steht ueber viele 5-Minuten-Takte; wer
   Zeilen zaehlt statt Episoden, haelt eine ruhige Phase fuer viele Treffer
   und liest aus jedem Verlauf heraus, was er will.

   Deshalb wird hier die Gruppierung ausgefuehrt geprueft, nicht das Markup. */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
const from = worker.indexOf('const SIGNAL_EPISODE_GAP_MS');
const to = worker.indexOf('const STOCK_SNAPSHOT_LIVE_MS');
assert.ok(from > 0 && to > from, 'signalHistory muss auffindbar sein');

const src = 'const APP_VERSION="test";\nfunction dbNum(v){const n=Number(v);return Number.isFinite(n)?n:null;}\n'
  + 'async function ensureD1Schema(){}\n'
  + worker.slice(from, to)
  + '\nreturn { signalHistory, SIGNAL_EPISODE_GAP_MS };';
const M = new Function(src)();

/* Ein Prüfstand, der genau das liefert, was D1 liefern würde. */
function db(rows, opts = {}) {
  return { prepare(sql) { return { bind() { return {
    async all() { if (opts.fail) throw new Error(opts.fail); return { results: rows }; },
  }; } }; } };
}
const T0 = Date.UTC(2026, 8, 1, 12, 0, 0), B = 5 * 60_000;
const gruen = (symbol, ts, extra = {}) => ({ ts, symbol, source: 'Bitpanda Fusion', price: 1, score: 7, crv: 2,
  max_pct: null, min_pct: null, mae_pre: null, success_ts: null, reach_ts: null, resolved_ts: null, dropped_ts: null, payload: null, ...extra });

/* 1 · Zwölf aufeinanderfolgende Takte sind EINE Gelegenheit, nicht zwölf. */
{
  const rows = Array.from({ length: 12 }, (_, i) => gruen('USELESS', T0 + i * B));
  const r = await M.signalHistory({ DB: db(rows) }, 'coin', 7, 25);
  assert.equal(r.state, 'ok');
  assert.equal(r.episodes.length, 1,
    'NK-SH1: Aufeinanderfolgende gruene Takte sind EINE Episode — sonst zaehlt eine ruhige Stunde als zwoelf Empfehlungen');
  assert.equal(r.episodes[0].buckets, 12, 'NK-SH1: … die Zahl der Takte bleibt aber sichtbar');
  assert.equal(r.episodes[0].minutes, 60, 'NK-SH1: … und die Dauer stimmt');
}

/* 2 · Eine echte Lücke trennt. Genau das meint „2x empfohlen". */
{
  const rows = [
    ...Array.from({ length: 4 }, (_, i) => gruen('USELESS', T0 + i * B)),
    ...Array.from({ length: 3 }, (_, i) => gruen('USELESS', T0 + 20 * 3600_000 + i * B)),
  ];
  const r = await M.signalHistory({ DB: db(rows) }, 'coin', 7, 25);
  assert.equal(r.episodes.length, 2, 'NK-SH2: Zwei getrennte Phasen sind zwei Episoden');
  assert.ok(r.episodes[0].firstTs > r.episodes[1].firstTs, 'NK-SH2: die jüngste steht oben');
}

/* 3 · Knapp unter der Lückengrenze wird NICHT getrennt. Der Grenzfall
       entscheidet, ob aus einer Gelegenheit zwei werden. */
{
  const knapp = M.SIGNAL_EPISODE_GAP_MS - 60_000;
  const r1 = await M.signalHistory({ DB: db([gruen('X', T0), gruen('X', T0 + knapp)]) }, 'coin', 7, 25);
  assert.equal(r1.episodes.length, 1, 'NK-SH3: knapp unter der Grenze bleibt es eine Episode');
  const r2 = await M.signalHistory({ DB: db([gruen('X', T0), gruen('X', T0 + M.SIGNAL_EPISODE_GAP_MS + 60_000)]) }, 'coin', 7, 25);
  assert.equal(r2.episodes.length, 2, 'NK-SH3: darüber sind es zwei');
}

/* 4 · Zwei Symbole vermischen sich nicht. */
{
  const rows = [gruen('BTC', T0), gruen('ETH', T0 + B), gruen('BTC', T0 + 2 * B)];
  const r = await M.signalHistory({ DB: db(rows) }, 'coin', 7, 25);
  assert.equal(r.episodes.length, 2, 'NK-SH4: je Symbol eine eigene Episode');
  assert.deepEqual(r.episodes.map(e => e.symbol).sort(), ['BTC', 'ETH']);
}

/* 5 · Der Ausgang wird BENANNT, und „ohne Beleg" ist kein Misserfolg.
       Eine verworfene Zeile heisst „zu selten nachgesehen" — sie als
       Fehlschlag zu zaehlen waere genau die Verzerrung, vor der R3 warnt. */
{
  const f = (extra) => M.signalHistory({ DB: db([gruen('A', T0, extra)]) }, 'coin', 7, 25);
  assert.equal((await f({ success_ts: T0 + 3600_000 })).episodes[0].outcome, 'Ziel erreicht');
  assert.equal((await f({ resolved_ts: T0 + 3600_000 })).episodes[0].outcome, 'ausgewertet');
  assert.equal((await f({ dropped_ts: T0 + 3600_000 })).episodes[0].outcome, 'ohne Beleg');
  assert.equal((await f({})).episodes[0].outcome, 'offen');
}

/* 6 · Das beste und das schlechteste Ergebnis der Episode werden über alle
       Takte gebildet, nicht vom ersten übernommen. */
{
  const rows = [gruen('A', T0, { max_pct: 1, min_pct: -1 }), gruen('A', T0 + B, { max_pct: 74, min_pct: -3 }), gruen('A', T0 + 2 * B, { max_pct: 12, min_pct: -0.5 })];
  const r = await M.signalHistory({ DB: db(rows) }, 'coin', 7, 25);
  assert.equal(r.episodes[0].maxPct, 74, 'NK-SH6: der beste Ausschlag der Episode zaehlt');
  assert.equal(r.episodes[0].minPct, -3, 'NK-SH6: … und der schlechteste ebenso');
}

/* 7 · FAIL-CLOSED. Ein Lesefehler darf NICHT als leere Liste zurückkommen:
       „keine Freigaben gefunden" und „konnte nicht nachsehen" sähen sonst
       identisch aus, und das erste ist eine Behauptung. */
{
  const r = await M.signalHistory({ DB: db([], { fail: 'D1_ERROR: nope' }) }, 'coin', 7, 25);
  assert.equal(r.state, 'error', 'NK-SH7: ein Lesefehler muss als Fehler zurückkommen');
  assert.ok(r.reason, 'NK-SH7: … mit Begründung');
  assert.equal(r.episodes.length, 0, 'NK-SH7: … und ohne erfundene Einträge');
  const leer = await M.signalHistory({ DB: db([]) }, 'coin', 7, 25);
  assert.equal(leer.state, 'ok', 'NK-SH7: eine echte Leermenge ist KEIN Fehler');
}

/* 8 · Es gibt bewusst KEINE Trefferquote im Ergebnis. Bei einer Handvoll
       Episoden wäre sie eine Zahl ohne Aussage — dieselbe Regel wie im
       Musterlabor. */
{
  const r = await M.signalHistory({ DB: db([gruen('A', T0, { success_ts: T0 + 1 })]) }, 'coin', 7, 25);
  const keys = Object.keys(r).join(' ');
  assert.doesNotMatch(keys, /winRate|hitRate|trefferquote|quote/i,
    'NK-SH8: Der Verlauf zeigt Fälle, keine Statistik — eine Quote aus wenigen Fällen ist keine Quote');
}

console.log('✓ FusionPulse v4.2.9 Verlauf der Kauf-Freigaben (ausgefuehrt): OK');

/* ══ v4.3.2 · EIN LEERER TIEFENSCAN MUSS SEINEN GRUND NENNEN ═══════════════
   Zwei Tage Fehlersuche gingen dafuer drauf, dass „0 aktualisiert" ohne Grund
   dastand. Der Server kannte ihn je Titel und warf ihn in `console.warn` —
   also ins Worker-Log, das niemand liest. Von aussen sahen 401, 429, 404,
   Zeitueberschreitung und geschlossene Boerse identisch aus. */
{
  const w = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  const a = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(w, /scanErrors\.push\(\{symbol:sym,message:msg\}\)/,
    'v4.3.2: Ein geworfener Fehler muss gesammelt werden, nicht nur geloggt');
  assert.match(w, /scanErrors\.push\(\{symbol:sym,message:'keine analysierbaren Bars/,
    'v4.3.2: … und ein leeres Ergebnis ohne Wurf ebenso — das ist ein eigener Fall');
  assert.match(w, /deepScanErrors: scanErrorSummary/, 'v4.3.2: Die Zusammenfassung muss den Client erreichen');
  assert.match(w, /deepScanAttempted: syms\.length/,
    'v4.3.2: … samt der Zahl der ANGESETZTEN Titel. Ohne sie ist „keine Fehler" nicht von „nichts versucht" zu unterscheiden');

  /* Die Zusammenfassung ausgefuehrt: 20 Titel mit demselben 429 sind EIN
     Befund, nicht zwanzig Zeilen. */
  {
    const src = w.slice(w.indexOf('const scanErrorSummary=(()=>{'), w.indexOf('// v3.3.4: Bereits erfolgreich tief analysierte'));
    const fn = new Function('scanErrors', src + '; return scanErrorSummary;');
    const viele = Array.from({ length: 20 }, (_, i) => ({ symbol: `S${i}`, message: 'HTTP 429 rate limited' }));
    const eins = fn([...viele, { symbol: 'X', message: 'HTTP 401 unauthorized' }]);
    assert.equal(eins.length, 2, 'v4.3.2: Zwei verschiedene Meldungen ergeben zwei Zeilen');
    assert.equal(eins[0].count, 20, 'v4.3.2: … die haeufigste steht oben, mit ihrer Anzahl');
    assert.equal(eins[0].symbols.length, 5, 'v4.3.2: … und hoechstens fuenf Beispielsymbole');
    assert.deepEqual(fn([]), [], 'v4.3.2: Ohne Fehler bleibt die Liste leer');
  }

  const render = a.slice(a.indexOf("const el=$('#deepScanReason')"), a.indexOf('if(counts){const rc='));
  assert.match(render, /versucht===0/,
    'v4.3.2: „nichts angesetzt" muss von „alles gescheitert" unterschieden werden');
  assert.match(render, /KEIN Fehler gemeldet/,
    'v4.3.2: Angesetzt, nichts aktualisiert, kein Fehler — das ist selbst ein Befund und muss dastehen');
  assert.match(render, /e\.message/, 'v4.3.2: Die tatsaechliche Meldung muss ausgegeben werden, nicht ein Ersatztext');
}

console.log('✓ FusionPulse v4.3.2 Grund fuer leeren Tiefenscan (ausgefuehrt): OK');

/* ══ v4.3.4 · NULL ZEILEN SIND KEIN ERFOLG ═════════════════════════════════
   Die Kette, die die Aktien-Heatmap seit dem 01.09. eingefroren hat, und der
   Grund, warum sie mehrfach besprochen und nie gefunden wurde:

     1. Frischer Isolate → `stockMemo` leer. Der persistierte Cache-Zweig ist
        fuer `execution==='server'` ausgenommen — der Cron scannt also wirklich.
     2. Scheitern alle Tiefenanalysen, ist `fresh` leer, und weil `safeCarry`
        im frischen Isolate nichts zum Weitertragen hat, ist `rows` leer.
     3. `persistStockScan` beginnt mit `if(!env?.DB || !rows?.length) return` —
        kein Schreibvorgang, kein Fehler, keine Zustandsaenderung. Als Schutz
        richtig, aber stumm.
     4. Und der Cron meldete `setApiState('stocks','ok','0 Rows …')`.

   Vier Stellen, jede fuer sich vertretbar; zusammen ein System, das gruen
   meldet, nichts speichert und eine drei Tage alte Karte anzeigt. */
{
  const w = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  const zweig = w.slice(w.indexOf('}else if(stockMinute%2===0){'), w.indexOf("} else if(!cryptoMinute && !primaryStocks"));
  assert.ok(zweig.length > 500, 'v4.3.4: Der Deep-Scan-Zweig des Cron muss auffindbar sein');

  /* Kein unbedingtes 'ok' mehr. Das ist der Kern. */
  assert.doesNotMatch(zweig, /setApiState\('stocks','ok',`\$\{st\.rows\?\.length\|\|0\} Rows/,
    'v4.3.4: Ein Scan darf sich nicht unabhaengig von der Zeilenzahl als „ok" melden');
  assert.match(zweig, /const anzahl=st\.rows\?\.length\|\|0;/,
    'v4.3.4: Die Zeilenzahl muss die Entscheidung tragen');
  assert.match(zweig, /setApiState\('stocks','error',grund\)/,
    'v4.3.4: Null Zeilen muessen als Fehler gemeldet werden');
  assert.match(zweig, /st\.deepScanErrors/,
    'v4.3.4: … und zwar MIT dem tatsaechlichen Grund aus dem Scan, nicht mit einem Ersatztext');
  assert.match(zweig, /persistApiState\(env,'stocks','error',grund,now\)/,
    'v4.3.4: Der Grund muss den Cron-Lauf ueberleben — sonst sieht ihn wieder niemand');
  assert.ok(zweig.indexOf('anzahl>0') < zweig.indexOf("'error'"),
    'v4.3.4: Erst pruefen, dann melden');

  /* Und dieselbe Regel im Watchlist-Zweig — sonst gilt sie nur im halben Cron. */
  const wlZweig = w.slice(w.indexOf("} else if(wl.mode==='watchlist'){"), w.indexOf('}else if(radarDueNow('));
  assert.match(wlZweig, /wlAnzahl>0\?'ok':'error'/,
    'v4.3.4: Auch im Watchlist-Modus sind null analysierbare Titel kein Erfolg');

  /* Der stumme Schutz in persistStockScan bleibt — er ist richtig. Aber er
     darf nicht die EINZIGE Reaktion auf einen leeren Scan sein. */
  const persist = w.slice(w.indexOf('async function persistStockScan'), w.indexOf('async function readLatestPersistedStockScan'));
  assert.match(persist, /if\(!env\?\.DB \|\| !rows\?\.length\) return stockPersistState;/,
    'v4.3.4: Ein guter Stand darf weiterhin NICHT mit Nichts ueberschrieben werden');
}

console.log('✓ FusionPulse v4.3.4 Leerer Scan meldet sich als Fehler (ausgefuehrt): OK');
