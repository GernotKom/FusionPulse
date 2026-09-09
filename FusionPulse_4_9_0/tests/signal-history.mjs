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
  + '\nreturn { signalHistory, SIGNAL_EPISODE_GAP_MS, signalHistoryMemo };';
const M = new Function(src)();

/* Ein Prüfstand, der genau das liefert, was D1 liefern würde. */
function db(rows, opts = {}) {
  return { prepare(sql) { return { bind() { return {
    async all() { if (opts.fail) throw new Error(opts.fail); return { results: rows }; },
  }; } }; } };
}
const T0 = Date.UTC(2026, 8, 1, 12, 0, 0), B = 5 * 60_000;
/* v4.3.7 · `signalHistory` haelt seit dem gerissenen Leselimit einen Vorrat
   von zehn Minuten. Das ist gewolltes Produktionsverhalten, im Test aber eine
   Falle: alle Faelle benutzen denselben Schluessel und bekaemen sonst das
   Ergebnis des ersten zurueck. Deshalb vor jedem Fall leeren — und zwar
   ausdruecklich, damit der Vorrat sichtbar bleibt statt umgangen zu werden. */
const frisch = () => { M.signalHistoryMemo.clear(); };
const gruen = (symbol, ts, extra = {}) => ({ ts, symbol, source: 'Bitpanda Fusion', price: 1, score: 7, crv: 2,
  max_pct: null, min_pct: null, mae_pre: null, success_ts: null, reach_ts: null, resolved_ts: null, dropped_ts: null, payload: null, ...extra });

/* 1 · Zwölf aufeinanderfolgende Takte sind EINE Gelegenheit, nicht zwölf. */
{
  frisch();
  const rows = Array.from({ length: 12 }, (_, i) => gruen('USELESS', T0 + i * B));
  const r = await (frisch(), M.signalHistory)({ DB: db(rows) }, 'coin', 7, 25);
  assert.equal(r.state, 'ok');
  assert.equal(r.episodes.length, 1,
    'NK-SH1: Aufeinanderfolgende gruene Takte sind EINE Episode — sonst zaehlt eine ruhige Stunde als zwoelf Empfehlungen');
  assert.equal(r.episodes[0].buckets, 12, 'NK-SH1: … die Zahl der Takte bleibt aber sichtbar');
  assert.equal(r.episodes[0].minutes, 60, 'NK-SH1: … und die Dauer stimmt');
}

/* 2 · Eine echte Lücke trennt. Genau das meint „2x empfohlen". */
{
  frisch();
  const rows = [
    ...Array.from({ length: 4 }, (_, i) => gruen('USELESS', T0 + i * B)),
    ...Array.from({ length: 3 }, (_, i) => gruen('USELESS', T0 + 20 * 3600_000 + i * B)),
  ];
  const r = await (frisch(), M.signalHistory)({ DB: db(rows) }, 'coin', 7, 25);
  assert.equal(r.episodes.length, 2, 'NK-SH2: Zwei getrennte Phasen sind zwei Episoden');
  assert.ok(r.episodes[0].firstTs > r.episodes[1].firstTs, 'NK-SH2: die jüngste steht oben');
}

/* 3 · Knapp unter der Lückengrenze wird NICHT getrennt. Der Grenzfall
       entscheidet, ob aus einer Gelegenheit zwei werden. */
{
  const knapp = M.SIGNAL_EPISODE_GAP_MS - 60_000;
  const r1 = await (frisch(), M.signalHistory)({ DB: db([gruen('X', T0), gruen('X', T0 + knapp)]) }, 'coin', 7, 25);
  assert.equal(r1.episodes.length, 1, 'NK-SH3: knapp unter der Grenze bleibt es eine Episode');
  const r2 = await (frisch(), M.signalHistory)({ DB: db([gruen('X', T0), gruen('X', T0 + M.SIGNAL_EPISODE_GAP_MS + 60_000)]) }, 'coin', 7, 25);
  assert.equal(r2.episodes.length, 2, 'NK-SH3: darüber sind es zwei');
}

/* 4 · Zwei Symbole vermischen sich nicht. */
{
  frisch();
  const rows = [gruen('BTC', T0), gruen('ETH', T0 + B), gruen('BTC', T0 + 2 * B)];
  const r = await (frisch(), M.signalHistory)({ DB: db(rows) }, 'coin', 7, 25);
  assert.equal(r.episodes.length, 2, 'NK-SH4: je Symbol eine eigene Episode');
  assert.deepEqual(r.episodes.map(e => e.symbol).sort(), ['BTC', 'ETH']);
}

/* 5 · Der Ausgang wird BENANNT, und „ohne Beleg" ist kein Misserfolg.
       Eine verworfene Zeile heisst „zu selten nachgesehen" — sie als
       Fehlschlag zu zaehlen waere genau die Verzerrung, vor der R3 warnt. */
{
  frisch();
  const f = (extra) => { frisch(); return M.signalHistory({ DB: db([gruen('A', T0, extra)]) }, 'coin', 7, 25); };
  assert.equal((await f({ success_ts: T0 + 3600_000 })).episodes[0].outcome, 'Ziel erreicht');
  assert.equal((await f({ resolved_ts: T0 + 3600_000 })).episodes[0].outcome, 'ausgewertet');
  assert.equal((await f({ dropped_ts: T0 + 3600_000 })).episodes[0].outcome, 'ohne Beleg');
  assert.equal((await f({})).episodes[0].outcome, 'offen');
}

/* 6 · Das beste und das schlechteste Ergebnis der Episode werden über alle
       Takte gebildet, nicht vom ersten übernommen. */
{
  frisch();
  const rows = [gruen('A', T0, { max_pct: 1, min_pct: -1 }), gruen('A', T0 + B, { max_pct: 74, min_pct: -3 }), gruen('A', T0 + 2 * B, { max_pct: 12, min_pct: -0.5 })];
  const r = await (frisch(), M.signalHistory)({ DB: db(rows) }, 'coin', 7, 25);
  assert.equal(r.episodes[0].maxPct, 74, 'NK-SH6: der beste Ausschlag der Episode zaehlt');
  assert.equal(r.episodes[0].minPct, -3, 'NK-SH6: … und der schlechteste ebenso');
}

/* 7 · FAIL-CLOSED. Ein Lesefehler darf NICHT als leere Liste zurückkommen:
       „keine Freigaben gefunden" und „konnte nicht nachsehen" sähen sonst
       identisch aus, und das erste ist eine Behauptung. */
{
  frisch();
  const r = await (frisch(), M.signalHistory)({ DB: db([], { fail: 'D1_ERROR: nope' }) }, 'coin', 7, 25);
  assert.equal(r.state, 'error', 'NK-SH7: ein Lesefehler muss als Fehler zurückkommen');
  assert.ok(r.reason, 'NK-SH7: … mit Begründung');
  assert.equal(r.episodes.length, 0, 'NK-SH7: … und ohne erfundene Einträge');
  const leer = await (frisch(), M.signalHistory)({ DB: db([]) }, 'coin', 7, 25);
  assert.equal(leer.state, 'ok', 'NK-SH7: eine echte Leermenge ist KEIN Fehler');
}

/* 8 · Es gibt bewusst KEINE Trefferquote im Ergebnis. Bei einer Handvoll
       Episoden wäre sie eine Zahl ohne Aussage — dieselbe Regel wie im
       Musterlabor. */
{
  frisch();
  const r = await (frisch(), M.signalHistory)({ DB: db([gruen('A', T0, { success_ts: T0 + 1 })]) }, 'coin', 7, 25);
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
  /* ══ v4.3.6 · DIE FELDER STANDEN IN DER FALSCHEN FUNKTION ════════════════
     Bis 4.3.5 lagen `deepScanAttempted`/`deepScanErrors` in `stockSnapshot`
     (Twelve-Data-Pfad) statt in `tiingoStockSnapshot` — die Ankertexte beider
     Rueckgaben sind fast gleich, und ich habe am falschen Ende eingesetzt.
     Dort war `scanErrorSummary` nicht einmal definiert (ReferenceError bei
     jedem Aufruf), und im Tiingo-Pfad fehlte die Diagnose ganz.
     Der Test prueffte nur „steht irgendwo in der Datei" und war deshalb gruen.
     Jetzt wird der AUSSCHNITT der richtigen Funktion geprueft. */
  const tiingo = w.slice(w.indexOf('async function tiingoStockSnapshot'), w.indexOf('async function tiingoStockLookup'));
  assert.ok(tiingo.length > 5000, 'v4.3.6: tiingoStockSnapshot muss auffindbar sein');
  assert.match(tiingo, /deepScanErrors:scanErrorSummary/,
    'v4.3.2: Die Zusammenfassung muss den Client erreichen — und zwar aus DEM Pfad, der scannt');
  assert.match(tiingo, /deepScanAttempted:syms\.length/,
    'v4.3.2: … samt der Zahl der ANGESETZTEN Titel. Ohne sie ist „keine Fehler" nicht von „nichts versucht" zu unterscheiden');
  assert.doesNotMatch(w.slice(w.indexOf('async function stockSnapshot'), w.indexOf('async function tiingoIexMarketRadar')),
    /scanErrorSummary/,
    'v4.3.6: Im Twelve-Data-Pfad darf `scanErrorSummary` NICHT vorkommen — dort existiert es nicht');

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

/* ══ v4.3.5 · DER RANG ALTERT, DER DATENSATZ NICHT ═════════════════════════
   Die zweite, vom Cron unabhaengige Ursache dafuer, dass die Aktien-Heatmap
   immer gleich aussieht. Gemessen mit der echten Sortierung:
   Bei 74 mitgeschleppten und 20 frisch analysierten Zeilen schaffte es vor
   4.3.5 KEINE EINZIGE frische Zeile in die zwoelf angezeigten Punkte. Der
   beste frische Titel landete auf Rang 68.

   Grund war eine Unwucht im Vergleich: `safeCarry` behaelt die Werte des
   LETZTEN GUTEN Standes — aus einem Moment, in dem die Zeile stark genug war,
   um angezeigt zu werden. Neu analysierte Titel werden mit den Zahlen von
   HEUTE bewertet. Alt schlaegt neu, dauerhaft. */
{
  const w = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  const from = w.indexOf('  const RANK_GRACE_MS=');
  const to = w.indexOf('  applySectorLag(rows);   // v3.10.0 FIX');
  assert.ok(from > 0 && to > from, 'v4.3.5: Die Rangbildung muss auffindbar sein');
  const sortiere = new Function('safeCarry', w.slice(from, to) + '\nreturn rows;');

  const now = Date.now();
  const mk = (praefix, n, alter, reifeVon, reifeBis) => {
    let seed = 7;
    const rnd = () => ((seed = seed * 16807 % 2147483647) - 1) / 2147483646;
    return Array.from({ length: n }, (_, i) => ({
      symbol: `${praefix}${i}`, frisch: alter === 0, analyzedTs: now - alter,
      preSignalMaturity: reifeVon + rnd() * (reifeBis - reifeVon),
      situationScore: 40 + rnd() * 50, radarRank: rnd() * 80, score: 5 + rnd() * 4,
    }));
  };
  const lauf = (arr) => sortiere(new Map(arr.map((r) => [r.symbol, r])));

  /* 1 · Drei Tage alt gegen frisch: die frischen muessen durchkommen. */
  {
    const alt = mk('ALT', 74, 3 * 86400_000, 4, 9);
    const neu = mk('NEU', 20, 0, 1, 5);
    const top12 = lauf([...alt, ...neu]).slice(0, 12);
    assert.ok(top12.filter((r) => r.frisch).length >= 6,
      `v4.3.5: Frisch analysierte Zeilen muessen sichtbar werden — es waren ${top12.filter((r) => r.frisch).length} von 12`);
  }

  /* 2 · INNERHALB einer Sitzung darf die Reihenfolge NICHT umkippen. Eine
     Zeile von vor zwei Stunden mit klar besserer Reife muss vorn bleiben —
     sonst waere aus der Alterung ein Zufallsgenerator geworden. */
  {
    const zweiStunden = mk('SESSION', 1, 2 * 3600_000, 8, 8)[0];
    const frischSchwach = mk('JETZT', 1, 0, 5, 5)[0];
    const r = lauf([zweiStunden, frischSchwach]);
    assert.equal(r[0].symbol, 'SESSION0',
      'v4.3.5: Innerhalb der Sitzung schlaegt die deutlich bessere Reife die blosse Frische');
  }

  /* 3 · Ruht der Scan, muss die Anzeige RUHEN. Ein Boden im Abschlag haelt
     die Reihenfolge der alten Zeilen untereinander stabil — sonst spraenge
     die Karte bei jedem Abruf um, ohne dass neue Daten da waeren. */
  {
    const alt = mk('ALT', 40, 3 * 86400_000, 4, 9);
    const a = lauf(alt).slice(0, 12).map((r) => r.symbol).join(' ');
    const b = lauf(alt).slice(0, 12).map((r) => r.symbol).join(' ');
    assert.equal(a, b, 'v4.3.5: Ohne frische Zeilen muss die Reihenfolge stabil bleiben');

    /* Die erste Fassung endete hier — und die Gegenprobe „Boden auf 0 setzen"
       blieb gruen. Zu Recht: bei Boden 0 bekommen ALLE alten Zeilen den
       Rangwert 0, sie sind gleichauf, und das naechste Kriterium entscheidet
       deterministisch. Zweimal derselbe Ablauf ergibt also zweimal dasselbe
       Ergebnis — der Test hat Determinismus geprueft, nicht Stabilitaet.

       Was der Boden wirklich schuetzt: die Reihenfolge der alten Zeilen bleibt
       ihre REIFENFOLGE. Ohne ihn kippt die ruhende Anzeige stillschweigend auf
       `situationScore` um, also auf ein anderes Kriterium, ohne dass eine
       einzige neue Zahl eingetroffen waere. */
    const nurAlt = lauf(alt);
    const reifen = nurAlt.map((r) => Number(r.preSignalMaturity));
    const absteigend = reifen.every((v, i) => i === 0 || reifen[i - 1] >= v - 1e-9);
    assert.ok(absteigend,
      'v4.3.5: Unter gleich alten Zeilen muss die Reife die Reihenfolge bestimmen — sonst kippt die ruhende Anzeige auf ein anderes Kriterium um');
  }

  /* 4 · Eine Zeile ohne Zeitstempel gilt als Altbestand, nicht als frisch.
     Andernfalls waere jede Zeile aus einer aelteren Programmversion beim
     ersten Lauf nach dem Deploy schlagartig ganz oben. */
  {
    const ohne = { symbol: 'OHNE', preSignalMaturity: 9, situationScore: 90, radarRank: 90, score: 9 };
    const neu = mk('NEU', 1, 0, 4, 4)[0];
    const r = lauf([ohne, neu]);
    assert.equal(r[0].symbol, 'NEU0',
      'v4.3.5: Ohne Zeitstempel gilt Altbestand — sonst ueberholt jede Zeile aus der Vorversion die frische Messung');
  }

  /* 5 · Der Zeitstempel muss beim Analysieren ueberhaupt gesetzt werden. */
  assert.match(w, /row\.analyzedTs=Date\.now\(\);/,
    'v4.3.5: Jede frisch analysierte Zeile braucht ihren Zeitstempel — ohne ihn ist die Alterung wirkungslos');
}

console.log('✓ FusionPulse v4.3.5 Rangalterung der Heatmap (ausgefuehrt): OK');

/* ══ v4.3.7 · DAS LESELIMIT WAR DIE GRENZE, NICHT DAS SCHREIBLIMIT ═════════
   Cloudflare hat am 04.09. das Tageslimit fuer `rows_read` gerissen: 5 Mio.
   im Free-Tier, 82 % um 13:39, ueberschritten um 20:17. Danach geben alle
   lesenden D1-Anfragen Fehler zurueck.

   Die App budgetiert Schreibzeilen bis auf die Stelle genau — eigener Zaehler,
   Bremse, Hochrechnung, Tagesobergrenze 90.000 von 100.000. Gelesene Zeilen
   hat nie jemand gemessen. Genau dort lag die Grenze.

   Ursache war `signalHistory` aus 4.2.9: Filter auf `light`, kein Index
   darauf, also ein Vollscan je Aufruf. 194 Aufrufe je offenem Tab und Tag
   ergeben bei 40.000 Zeilen 7,8 Mio. gelesene Zeilen — aus EINER Kachel. */
{
  const w = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  const a = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(w, /CREATE INDEX IF NOT EXISTS idx_snap_light ON market_snapshots\(asset_type, light, ts DESC\)/,
    'v4.3.7: Die Verlaufsabfrage filtert auf asset_type+light+ts und braucht genau darauf einen Index — sonst Vollscan');

  /* Die Spaltenfolge des Index MUSS zur WHERE-Klausel passen. Ein Index in
     falscher Reihenfolge sieht im Test gut aus und wird von SQLite ignoriert. */
  const abfrage = w.slice(w.indexOf('async function signalHistory'), w.indexOf('const STOCK_SNAPSHOT_LIVE_MS'));
  assert.match(abfrage, /WHERE light='green' AND asset_type=\? AND ts>=\?/,
    'v4.3.7: Aendert sich die WHERE-Klausel, muss der Index nachgezogen werden');

  assert.match(abfrage, /signalHistoryMemo\.set/, 'v4.3.7: Das Ergebnis muss serverseitig vorgehalten werden');
  assert.match(abfrage, /Date\.now\(\)-memo\.ts<SIGNAL_HISTORY_TTL_MS/,
    'v4.3.7: … damit mehrere Tabs und jedes Neuladen sich EINE Abfrage teilen');
  assert.match(w, /const SIGNAL_HISTORY_MAX_ROWS = 1200;/,
    'v4.3.7: Die Obergrenze der gelesenen Zeilen bleibt klein — der Verlauf zeigt 20 Episoden, nicht 4.000 Zeilen');

  const takt = a.match(/loadSignalHistory\('stock'\); \}, (\d+)\*60_000\)/);
  assert.ok(takt && Number(takt[1]) >= 60,
    'v4.3.7: Der Verlauf darf hoechstens stuendlich nachgeladen werden — er aendert sich nicht viertelstuendlich');

  /* Und die Rechnung, die zeigt WARUM: 194 Vollscans je Tab und Tag. */
  const aufrufeVorher = 2 * (1 + Math.floor(24 * 60 / 15));
  assert.ok(aufrufeVorher * 40000 > 5_000_000,
    'v4.3.7: Die alte Taktung sprengt das Leselimit rechnerisch — das ist der Beleg, nicht eine Vermutung');
  const aufrufeJetzt = 2 * (1 + Math.floor(24 * 60 / 60));
  assert.ok(aufrufeJetzt * 1200 < 100_000,
    'v4.3.7: … und die neue liegt weit darunter, selbst ohne den Index');
}

console.log('✓ FusionPulse v4.3.7 Leselimit und Verlaufsabfrage (ausgefuehrt): OK');

/* ══ v4.4.0 · WATCHLIST HEISST WATCHLIST ═══════════════════════════════════
   Betriebsbefund vom 05.09.: Bei aktiver Watchlist mit 36 Titeln zeigte die
   Heatmap 17 Punkte, davon 10 — 59 % — die gar nicht in der Watchlist stehen
   (GILD, GOLD, AMD, COIN, GOOGL, AVGO, OM, TSLA, RKLB, ABBV). Waehlte man im
   Filter zusaetzlich „★ Favoriten / Depot", bekam man ein ANDERES Bild:
   zwei Ansichten derselben Auswahl, die nicht uebereinstimmen.

   Ursache war `safeCarry` — es traegt jede je gesehene Katalogzeile
   unbegrenzt weiter. Im Radar-Betrieb richtig (die Anzeige soll zwischen
   Zyklen nicht ausduennen), im Watchlist-Modus ein Widerspruch zur eigenen
   Zusage: „Der Server untersucht ausschliesslich diese Titel." */
{
  const w = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  const von = w.indexOf('const wlSet = onlySymbols.length');
  const bis = w.indexOf('for(const r of fresh)safeCarry.set(r.symbol,r);');
  assert.ok(von > 0 && bis > von, 'v4.4.0: Die Uebernahmeregel muss auffindbar sein');

  const uebernehmen = new Function('onlySymbols', 'stockMemo', 'catalogSet', 'favs', 'verifiedDiscoveryNow',
    'const safeCarry=new Map();' + w.slice(von, bis) + '\nreturn [...safeCarry.keys()];');

  const memo = { rows: ['IONQ','EDIT','LITE','GILD','GOLD','AMD','TSLA','ABBV'].map(s => ({ symbol: s })) };
  const katalog = new Set(['IONQ','EDIT','LITE','GILD','GOLD','AMD','TSLA','ABBV']);

  /* 1 · Watchlist aktiv: NUR die Liste bleibt. */
  const wl = ['IONQ','EDIT','LITE'];
  const inWl = uebernehmen(wl, memo, katalog, [], new Set());
  assert.deepEqual(inWl.sort(), ['EDIT','IONQ','LITE'],
    'v4.4.0: Im Watchlist-Modus darf NICHTS ausserhalb der Liste in die Anzeige — sonst zeigt die Heatmap fremde Titel als eigene Auswahl');

  /* 2 · Radar-Betrieb: das Mitschleppen bleibt unveraendert. Ohne diese
     Gegenprobe waere nicht belegt, dass die Aenderung eng gefasst ist. */
  const imRadar = uebernehmen([], memo, katalog, [], new Set());
  assert.equal(imRadar.length, 8,
    'v4.4.0: Ohne Watchlist muss weiterhin jede Katalogzeile mitgetragen werden — die Anzeige soll zwischen Zyklen nicht ausduennen');

  /* 3 · Ein Titel, der im Katalog steht, aber nicht in der Watchlist, bleibt
     draussen. Genau dieser Fall war der Befund. */
  const nurKatalog = uebernehmen(['IONQ'], memo, katalog, [], new Set());
  assert.deepEqual(nurKatalog, ['IONQ'],
    'v4.4.0: Katalogzugehoerigkeit allein reicht im Watchlist-Modus NICHT');

  /* 4 · Auch Favoriten und frische Entdeckungen ueberschreiben die Liste
     nicht — sonst kaeme die Vermischung durch die Hintertuer zurueck. */
  const trotzFav = uebernehmen(['IONQ'], memo, katalog, ['TSLA','AMD'], new Set(['GILD']));
  assert.deepEqual(trotzFav, ['IONQ'],
    'v4.4.0: Weder Favoriten noch frische Entdeckungen duerfen die Watchlist aufweichen');
}

  /* ══ v4.4.1 · BEIDE PFADE, NICHT NUR EINER ═══════════════════════════════
     4.4.0 hat die Beschraenkung im LIVE-Pfad eingebaut. Der Browser bekommt
     aber den PERSISTIERTEN Cron-Stand — dort wirkte sie nicht, und die
     Heatmap zeigte nach dem Deploy unveraendert fremde Titel.
     Ein Test, der nur einen von zwei Ausgabepfaden prueft, bestaetigt eine
     Reparatur, die den Nutzer nicht erreicht. Deshalb wird hier die Regel in
     BEIDEN Zweigen verlangt. */
  {
    const w2 = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
    /* Endanker AB dem Startanker suchen: `stockMemo={ts:persisted.ts` kommt
       zweimal vor, und der erste Treffer liegt VOR dem Zweig. Ein Endanker
       vor dem Startanker ergibt einen leeren Ausschnitt und meldet einen
       Fehler, den es nicht gibt — in dieser Reihe der vierte solche Griff. */
    const pVon = w2.indexOf('const wlSetP = watchlistMode');
    const persistZweig = w2.slice(pVon, w2.indexOf('stockMemo={ts:persisted.ts', pVon));
    assert.ok(persistZweig.length > 200, 'v4.4.1: Der persistierte Zweig muss auffindbar sein');
    assert.match(persistZweig, /if\(wlSetP\) return wlSetP\.has\(sym\);/,
      'v4.4.1: Auch der persistierte Cron-Stand muss im Watchlist-Modus auf die Liste beschraenkt werden — das ist der Pfad, den die Oberflaeche sieht');
    const filter = new Function('watchlistMode','onlySymbols','persisted','catalogSet','favs','allowed',
      'const NON_COMMON_SYMBOL_DENY=new Set();const NON_COMMON_EQUITY_RE=/$^/;'
      + persistZweig + '\nreturn cleanRows.map(r=>r.symbol);');
    const rows = ['IONQ','EDIT','GILD','AMD','TSLA'].map(s=>({symbol:s}));
    const kat = new Set(['IONQ','EDIT','GILD','AMD','TSLA']);
    assert.deepEqual(filter(true, ['IONQ','EDIT'], { rows }, kat, ['TSLA'], new Set(['AMD'])), ['IONQ','EDIT'],
      'v4.4.1: Im Watchlist-Modus bleibt NUR die Liste — auch Favoriten und Radar-Funde nicht');
    assert.equal(filter(false, [], { rows }, kat, [], new Set()).length, 5,
      'v4.4.1: Ohne Watchlist bleibt der Filter unveraendert');
  }

console.log('✓ FusionPulse v4.4.1 Watchlist gilt in BEIDEN Ausgabepfaden (ausgefuehrt): OK');
