/* ══════ v3.32.0 · Suite 51 · Bandbreite, Subset-Abruf, Taktung, R11 ═════════
   Prueft die vier Bausteine aus dem Bandbreiten-Audit, die im Worker liegen:
     §10 D  Bandbreite je Pfad MESSEN (nicht schaetzen)
     §10 A  symbolbegrenzter IEX-Abruf mit Selbsterkennung
     §10 B  sessionabhaengige Radar-Taktung
     R11    die Umsatzschwelle haengt am Massstab des benutzten Feeds

   Der Worker laeuft nicht in Node (Cloudflare-Laufzeit, `fetch` gegen Tiingo).
   Deshalb werden die reinen Rechenfunktionen in einer VM AUSGEFUEHRT und der
   Rest ueber den Quelltext geprueft. Wo nur der Quelltext geprueft wird, steht
   es dabei — Regex sieht, was da ist, nie was fehlt (Lehre 8v).

   Negativkontrollen: Protokoll in RELEASE_NOTES.md. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const w = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
/* Kommentare raus, BEVOR eine Verbotspruefung laeuft (Lehre v3.12.0: ein
   Erklaerkommentar, der den alten Wert zitiert, laesst `doesNotMatch`
   anschlagen). */
const code = w.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* Reine Funktionen in eine VM heben. Es werden nur Funktionen gezogen, die
   ohne Netz und ohne D1 laufen. */
function ladeWorkerTeile() {
  const ctx = { console, Math, Date, JSON, Number, String, Boolean, Object, Array, Map, Set, RegExp, Error, isNaN, parseInt, parseFloat, Intl };
  vm.createContext(ctx);
  const teile = [
    'const MOM_MIN_DOLLARVOL   = 2_000_000;',
    w.slice(w.indexOf('const BREADTH_FACTOR'), w.indexOf('function momentumRadarAllowed')),
    w.slice(w.indexOf('const RADAR_TTL_MS'), w.indexOf('async function tiingoIexMarketRadar')),
    w.slice(w.indexOf('function tiingoBwBucket'), w.indexOf('let tiingoBwPersistTimer')),
    w.slice(w.indexOf('function tiingoMonthKeyUTC'), w.indexOf('/* Pfad -> Kategorie')),
    w.slice(w.indexOf('const TIINGO_BW_CAP_GB'), w.indexOf('let tiingoBwLimitHit')),
    w.slice(w.indexOf('function tiingoBandwidthView'), w.indexOf('async function tiingoFetch')),
    /* Das Gitter SELBST, nicht nur die Schwellenfunktion. NK8 hat gezeigt,
       warum das noetig ist: eine Sabotage, die im Gitter zur festen Konstante
       zurueckkehrt, liess die Suite durchlaufen — sie prueft `momMinDollarVol`
       in Isolation, und die blieb ja korrekt. Vierte Wiederholung der Lehre
       aus 8z: pruefen, was der Nutzer trifft, nicht was leicht zu pruefen ist. */
    'const MOM_MIN_PRICE_USD = 5;',
    w.slice(w.indexOf('function momentumRadarAllowed'), w.indexOf('/** Einlass in den Radar')),
  ];
  for (const t of teile) assert.ok(t && t.length > 20, 'Ein Quelltext-Ausschnitt ist leer — Anker pruefen');  // Lehre v3.11.0
  vm.runInContext(teile.join('\n') + `
;globalThis.__w = { momMinDollarVol, marketBreadthKey, BREADTH_FACTOR, MOM_MIN_DOLLARVOL,
  radarTtlMs, RADAR_TTL_MS, tiingoBwBucket, tiingoBandwidthView, momentumRadarAllowed,
  setBw:(v)=>{ tiingoBw = v; }, getBw:()=>tiingoBw };`, ctx, { filename: 'worker-teile.js' });
  return ctx.__w;
}
const W = ladeWorkerTeile();

/* ═══ 1 · R11 — die Schwelle darf sich bei Feed-Wechsel nicht selbst abschalten */
{
  /* Ist-Zustand: IEX. Die Schwelle ist der kalibrierte Wert. */
  assert.equal(W.momMinDollarVol({}), 2_000_000, 'Ohne RADAR_FEED gilt der belegte Ist-Zustand IEX');
  assert.equal(W.momMinDollarVol({ RADAR_FEED: 'iex' }), 2_000_000);

  /* Der Fall, der das Gitter faktisch abschalten wuerde. */
  const sip = W.momMinDollarVol({ RADAR_FEED: 'sip' });
  assert.ok(sip > 2_000_000 * 20,
    `Bei konsolidiertem Feed muss die Schwelle mitwachsen, sonst ist das Gitter aus (ist: ${sip})`);

  /* FAIL-CLOSED: ein unbekannter Feed bekommt NICHT die milde IEX-Schwelle.
     Wer nicht weiss, wie breit er sieht, darf nicht grosszuegig sein. */
  for (const v of ['polygon', 'consolidated-v2', 'SIP2', 'xyz', '0', 'true']) {
    const got = W.momMinDollarVol({ RADAR_FEED: v });
    assert.ok(got > 2_000_000,
      `Unbekannter Feed „${v}" darf nicht die IEX-Schwelle bekommen (ist: ${got})`);
  }
  /* Aber: leer/fehlend ist NICHT unbekannt — das ist der dokumentierte
     Ist-Zustand und muss die Liste nicht leeren. Sonst waere der Fix selbst
     der Fehler aus v3.8.1 (Schwelle zu hoch, Liste leer, sieht aus wie Defekt). */
  for (const meta of [{}, { RADAR_FEED: '' }, null, undefined]) {
    assert.equal(W.momMinDollarVol(meta), 2_000_000, 'Fehlende Angabe = Ist-Zustand IEX, keine Verschaerfung');
  }

  /* DIE WIRKUNG IM GITTER SELBST — nicht nur der Faktor.
     NK8 (Gitter kehrt zur festen Konstante zurueck) lief in der ersten Fassung
     dieser Suite DURCH: geprueft wurde `momMinDollarVol` in Isolation, und die
     blieb ja korrekt. Der Nutzer trifft aber `momentumRadarAllowed`. */
  const titel = { last: 42, volume: 900_000, spreadPct: 0.08, movePct: 14.2 };   // 37,8 Mio. $ IEX
  assert.equal(W.momentumRadarAllowed(titel, false, {}), true,
    'Ein liquider Nachrichten-Mover muss bei IEX-Massstab durchkommen (der MRNA-Fall aus v3.8.1)');
  assert.equal(W.momentumRadarAllowed(titel, false, { RADAR_FEED: 'sip' }), false,
    'Derselbe IEX-Umsatz darf am Gesamtmarkt-Massstab NICHT reichen — sonst ist das Gitter nach einem Feed-Wechsel aus');
  assert.equal(W.momentumRadarAllowed(titel, false, { RADAR_FEED: 'polygon' }), false,
    'Auch ein unbekannter Feed darf das Gitter nicht oeffnen');
  /* Und am Gesamtmarkt-Massstab muss ein entsprechend groesserer Titel
     durchkommen — sonst waere die Liste nach dem Wechsel leer, und das ist der
     Fehler aus v3.8.1 in der anderen Richtung. */
  assert.equal(W.momentumRadarAllowed({ last: 42, volume: 40_000_000, spreadPct: 0.08, movePct: 14.2 },
    false, { RADAR_FEED: 'sip' }), true,
    'Am Gesamtmarkt-Massstab muss ein entsprechend umsatzstarker Titel durchkommen');

  /* Kein Tarifname im Code (Audit §33.8). */
  assert.ok(!/Algo Trader|Alpaca Plus|Unlimited Plan/i.test(code),
    'Die Marktbreite darf nicht an einem Tarifnamen haengen, sondern am gemeldeten Feed');
}

/* ═══ 2 · Taktung — sparsamer bei geschlossenem Markt, unveraendert im Opening */
{
  /* v3.32.6: Die erste Fassung verlangte „im Opening gar nicht drosseln"
     (50 s, wie vorher). Die erste echte Messung hat das widerlegt: bei
     10,9 MB je Abruf — nicht 1,2 MB wie geschaetzt — kostet der 50-s-Takt
     allein im Opening 1,2 GB am Tag. Ein Test, der eine Zahl festschreibt,
     die auf einer falschen Annahme beruht, verteidigt den Fehler.
     Was geschuetzt bleiben MUSS, ist die Ordnung, nicht der Absolutwert:
     das Opening bleibt die engste Taktung aller Phasen, und eine Obergrenze
     verhindert, dass „sparen" die Eroeffnung unbrauchbar macht. */
  assert.ok(W.radarTtlMs('opening') <= 120_000,
    'Das Opening muss eng getaktet bleiben — hoechstens zwei Minuten, dort entsteht der Wert');
  for (const p of ['regular','premarket','premarket-early','after','after-limited','closed']) {
    assert.ok(W.radarTtlMs('opening') < W.radarTtlMs(p),
      `Das Opening muss enger getaktet sein als „${p}" — sonst wird am falschen Ende gespart`);
  }
  assert.ok(W.radarTtlMs('closed') >= 600_000, 'Bei geschlossenem Markt muss deutlich gedrosselt werden');
  assert.ok(W.radarTtlMs('closed') > W.radarTtlMs('after'), 'Nachts sparsamer als im After-Hours');
  assert.ok(W.radarTtlMs('after') > W.radarTtlMs('regular'), 'After-Hours sparsamer als der Handel');

  /* Die harte Grenze: mit der GEMESSENEN Antwortgroesse muss der Monat unter
     40 GB bleiben. Das ist die eigentliche Anforderung — die einzelnen
     Taktwerte sind nur ein Weg dorthin. Vorher stand hier ein prozentualer
     Vergleich mit dem alten Zustand; der konnte gruen sein und das Limit
     trotzdem reissen. */
  const GEMESSEN_MB = 10.9;   // /iex-Antwort, gemessen 01.09.2026
  const proTag = (h, key) => Math.floor((h * 3600_000) / W.radarTtlMs(key));
  const tagHandel = proTag(1.5,'opening') + proTag(5,'regular') + proTag(4,'premarket-early')
                  + proTag(1.5,'premarket') + proTag(1,'after') + proTag(3,'after-limited')
                  + proTag(8,'closed');
  const tagFrei = proTag(24,'closed');
  const gbMonat = (21*tagHandel + 9*tagFrei) * GEMESSEN_MB / 1024;
  assert.ok(gbMonat < 25,
    `Der Radar allein muss mit der gemessenen Antwortgroesse deutlich unter dem 40-GB-Limit bleiben (ist: ${gbMonat.toFixed(1)} GB)`);

  /* BOATS war in v3.32.0 ausdruecklich ausgenommen — und ist laut Messung
     36 % des Verbrauchs. Ausnahmen brauchen Zahlen, nicht Plausibilitaet. */
  assert.match(code, /const BOATS_TTL_MS = 20\*60_000;/,
    'Die Nachtsitzung muss gedrosselt sein — 184 Abrufe zu je 6,5 MB waren 36 % des Verbrauchs');
  assert.match(code, /now-tiingoDiscoveryMemo\.ts<BOATS_TTL_MS/,
    'Der BOATS-Cache muss den gedrosselten Wert benutzen');
  const boatsGb = (8*3600_000/20/60_000) * 30 * 6.5 / 1024;
  assert.ok(boatsGb < 6, `Auch BOATS muss klein bleiben (ist: ${boatsGb.toFixed(1)} GB/Monat)`);

  /* FAIL-CLOSED in die richtige Richtung: eine unbekannte Phase darf nicht
     HAEUFIGER laden. Das ist der Punkt, an dem so ein Umbau sonst kippt. */
  for (const p of ['', null, undefined, 'nachtschicht', 'PREMARKET', 42]) {
    const t = W.radarTtlMs(p);
    assert.ok(t >= 300_000,
      `Unbekannte Phase „${p}" muss den sparsamen Wert bekommen, nicht den schnellen (ist: ${t})`);
  }

  /* Der Alterungsfilter darf NICHT mitgelockert worden sein — sonst wuerde die
     Drosselung alte Daten durchreichen, statt sie zu verwerfen (Regel 4). */
  assert.match(code, /r\.ageMin==null\|\|r\.ageMin<=maxAge/,
    'Der Alterungsfilter des Radars muss unveraendert bleiben');
  assert.match(code, /\['opening','regular'\]\.includes\(phase\.key\)\?12:/,
    'Die maxAge-Staffel darf durch die Taktung nicht aufgeweicht werden');
}

/* ═══ 3 · Symbolbegrenzter Abruf — Rueckfall auf den ALTEN Weg, nicht auf leer */
{
  const fn = w.slice(w.indexOf('async function tiingoIexSnapshot'), w.indexOf('/* v3.2.1 Whole-Market Radar'));
  assert.ok(fn.length > 400, 'Schnitt tiingoIexSnapshot ist leer — Anker pruefen');
  assert.ok(fn.includes("tiingoFetch(env,`/iex?tickers="), 'Der schmale Abruf muss versucht werden');
  assert.ok(fn.includes("tiingoFetch(env,'/iex')"),
    'Der Rueckfall muss der ALTE, vollstaendige Weg sein — ein misslungener Sparversuch darf keine leere Liste liefern');
  assert.ok(fn.includes('saveIexSubsetMode'), 'Das Ergebnis des Versuchs muss gemerkt werden, sonst laeuft er endlos');
  /* Streng: eine leere Antwort darf NICHT als Erfolg zaehlen. Sonst haetten
     wir ausserhalb der Handelszeit „funktioniert" gemerkt und danach dauerhaft
     nichts mehr gefunden. */
  assert.ok(/rows\.length>0 && all<=/.test(fn),
    'Nur eine Antwort MIT angefragten Symbolen darf als tauglich gelten');
  assert.ok(fn.includes("state!=='unsupported'"), 'Ein erkanntes „geht nicht" muss den Versuch ueberspringen');
  /* Und der Zustand muss ablaufen koennen — Tiingo kann den Parameter
     nachruesten, ein einmaliger Fehlschlag darf die Ersparnis nicht fuer immer
     verbauen. */
  assert.match(code, /v\.state==='unsupported' && Date\.now\(\)-Number\(v\.ts\|\|0\) < 7\*86400_000/,
    'Ein „geht nicht" muss nach einer Frist erneut geprueft werden');
}

/* ═══ 3b · Der zweite Whole-Market-Download darf nicht zurueckkehren ═══════ */
{
  const fn = w.slice(w.indexOf('async function tiingoIexSnapshot'), w.indexOf('/* v3.2.1 Whole-Market Radar'));
  assert.ok(fn.includes('iexRawMemo.bySymbol'),
    'Der Deep-Scan muss den Vorrat des Radar-Abrufs nutzen — sonst laedt der Cron den Markt zweimal je Doppelminute');
  assert.ok(fn.includes('Date.now()-iexRawMemo.ts < iexRawFreshMs()'),
    'Der Vorrat darf nur innerhalb des Frischefensters benutzt werden');
  assert.ok(fn.includes('if(hits.length) return hits;'),
    'Ein leerer Treffer im Vorrat muss zum regulaeren Abruf fuehren, nicht zu einer leeren Liste');
  /* Regel 4: die Zeitstempel duerfen NICHT auf „jetzt" gesetzt werden. Sonst
     saehe ein alter Kurs frisch aus, und genau das ist die Sorte Fehler, die
     ein Sparumbau gern einschleppt. */
  assert.ok(!/iexRawMemo[\s\S]{0,400}?timestamp:\s*(Date\.now|now)/.test(w),
    'Die Wiederverwendung darf keine Zeitstempel neu setzen');
  assert.ok(w.includes('iexRawMemo={ts:now,bySymbol:new Map('),
    'Der Radar muss seinen Rohabruf fuer den Deep-Scan bereitstellen');

  /* Das Frischefenster muss zur Marktphase passen und im Handel eng sein. */
  const ff = w.slice(w.indexOf('function iexRawFreshMs'), w.indexOf('async function tiingoIexSnapshot'));
  assert.ok(/120_000/.test(ff) && /900_000/.test(ff),
    'Im Handel 2 Minuten, sonst 15 — dieselben Fenster, gegen die classifyQuoteFreshness prueft');
  assert.ok(/'regular'/.test(ff), 'Der regulaere Handel muss zum engen Fenster gehoeren');
}

/* ═══ 4 · Bandbreite messen — und eine Naeherung als Naeherung ausweisen */
{
  assert.equal(W.tiingoBwBucket('/iex'), 'iex-wholemarket');
  assert.equal(W.tiingoBwBucket('/iex?tickers=AAPL,MSFT'), 'iex-symbols');
  assert.equal(W.tiingoBwBucket('/iex/AAPL/prices?startDate=x'), 'iex-chart');
  assert.equal(W.tiingoBwBucket('/boats'), 'boats-bulk');
  assert.equal(W.tiingoBwBucket('/boats/AAPL'), 'boats-symbol');
  assert.equal(W.tiingoBwBucket('/tiingo/daily/AAPL/prices'), 'daily-bars');
  assert.equal(W.tiingoBwBucket('/was-auch-immer'), 'other', 'Unbekannte Pfade duerfen nicht stillschweigend einsortiert werden');

  /* Ohne Messung: KEINE Null. Genau der Fehler aus 8f — eine UI, die einen
     dauerhaft leeren Wert auswertet, sieht aus wie eine Messung. */
  W.setBw({ monthKey: '', paths: {}, exact: 0, approx: 0, loadedFromD1: true });
  const leer = W.tiingoBandwidthView();
  assert.equal(leer.measured, false, 'Ohne Messung darf nicht „gemessen" gemeldet werden');
  assert.equal(leer.usedGb, undefined, 'Es darf keine 0 GB behauptet werden');
  assert.match(leer.note, /KEIN niedriger Verbrauch/, 'Der Unterschied muss im Klartext dastehen');

  /* Mit Messung: gerechnet, sortiert, und der Monatswert als untere Schranke
     gekennzeichnet — er ist NICHT der Kontostand bei Tiingo. */
  const mk = new Date().toISOString().slice(0, 7);
  W.setBw({ monthKey: mk, exact: 90, approx: 10, loadedFromD1: true, paths: {
    'iex-wholemarket': { calls: 1000, bytes: 1_200_000 * 1000 },
    'iex-chart':       { calls: 500,  bytes: 20_000 * 500 },
  }});
  const v = W.tiingoBandwidthView();
  assert.equal(v.measured, true);
  assert.equal(v.paths[0].path, 'iex-wholemarket', 'Der groesste Verbraucher muss oben stehen');
  assert.ok(v.paths[0].avgKb > 1000, 'Die mittlere Antwortgroesse muss ablesbar sein — sie ist der Beweis');
  assert.ok(v.usedGb > 1.1 && v.usedGb < 1.2, `Die Summe muss stimmen (ist ${v.usedGb})`);
  assert.equal(v.capGb, 40);
  assert.match(v.note, /Nicht der Kontostand/, 'Die Grenze der Eigenmessung muss dabeistehen');
  assert.equal(v.approxSamples, 10, 'Naeherungen muessen getrennt gezaehlt werden');

  /* Die Messung selbst darf nichts erfinden. */
  const note = w.slice(w.indexOf('function noteTiingoBytes'), w.indexOf('async function loadTiingoBwOnce'));
  assert.ok(note.includes('if(!Number.isFinite(n)||n<0) return;'),
    'Eine unbrauchbare Groessenangabe darf nicht als 0 Bytes gebucht werden');
  /* content-length ist exakt, Textlaenge ist eine Naeherung — und das muss
     unterschieden werden, sonst ist die „Messung" selbst geraten. */
  const fetchFn = w.slice(w.indexOf('async function tiingoFetch'), w.indexOf('async function tiingoStockChart'));
  assert.ok(fetchFn.includes("res.headers.get('content-length')"), 'Die exakte Groesse muss bevorzugt werden');
  assert.ok(/noteTiingoBytes\(env, path, text\.length, false\)/.test(fetchFn),
    'Die Naeherung muss als Naeherung gebucht werden');

  /* 429 muss die beiden Ursachen unterscheiden (Lehre 8aa). */
  assert.ok(/MONATSBANDBREITE erschoepft/.test(fetchFn),
    'Ein Bandbreiten-429 muss anders heissen als ein Raten-429 — Warten hilft nur gegen eines von beidem');
}

/* ═══ 5 · Alles davon darf keine Bewertung anfassen ═════════════════════════ */
{
  const bloecke = [
    w.slice(w.indexOf('const TIINGO_BW_CAP_GB'), w.indexOf('async function tiingoStockChart')),
    w.slice(w.indexOf('const RADAR_TTL_MS'), w.indexOf('async function tiingoIexMarketRadar')),
    w.slice(w.indexOf('const BREADTH_FACTOR'), w.indexOf('function momentumRadarAllowed')),
  ].map(b => b.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''));
  for (const b of bloecke) {
    assert.ok(b.length > 200, 'Schnitt ist leer — Anker pruefen');
    for (const verboten of ['quality', 'executability', 'netCRV', 'buyReady', 'light=', 'situationScore']) {
      assert.ok(!b.includes(verboten),
        `Bandbreite, Taktung und Marktbreite duerfen ${verboten} nicht beruehren`);
    }
  }
  /* Der Radar behaelt sein ausdrueckliches 0-%-BUY-Gewicht. */
  assert.ok(w.includes("source:'Tiingo IEX Large-Cap Radar · prefiltered',buyWeight:0"),
    'Der Radar muss weiterhin als 0 % BUY-Gewicht ausgewiesen sein');
}

/* ═══ 6 · Der Client zeigt die Messung an, ohne sie zu beschoenigen ═════════ */
{
  assert.ok(app.includes('bandwidthNote(health)'),
    'Der Client muss die Bandbreite aus /api/health lesen — dort liefert der Worker sie');
  assert.ok(/bw\.measured === false/.test(app),
    'Ein ausdrueckliches „nicht gemessen" muss jede Herleitung aus Restfeldern schlagen');
  assert.ok(w.includes('bandwidth: tiingoBandwidthView()'),
    '/api/health muss die Messung ausliefern, sonst zeigt der Client dauerhaft „nicht gemessen"');
}

console.log('✓ FusionPulse v3.32.0 bandwidth/feed (Audit §10, R11) regressions: OK');
