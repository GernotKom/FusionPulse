/* ═══ v4.16.0 · NK94 · BEWEGUNGSMELDER DER WATCHLIST ════════════════════════
   BEFUND vom 14.09.: CRWD stand mit +15,4 % im Tag und lag in der Watchlist
   des Nutzers. Die App meldete nichts — kein Ton, keine Kachel, keine Zeile.
   Woertlich: „ist ja dann voellig umsonst."

   Der einzige akustische Melder bei Aktien hing an `stockLevel >= 2`, also an
   KAUF-Qualitaet. Ein Titel, der bereits 15 % gelaufen ist, faellt im
   Positionsmodus durch — weiter Stop, mieses CRV, Abstand zur EMA21. Diese
   Ablehnung ist richtig. Dass daraus Schweigen wurde, war es nicht.

   Geprueft wird AUSGEFUEHRT: eine Mustersuche haette „sessionMove existiert"
   bestaetigt, ohne dass je ein richtiger Prozentwert entstanden waere. */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

/** `sessionMove` mit den Zeitzonen-Helfern laden, die es wirklich benutzt. */
function ladeMove() {
  const teile = ['const NY_FMT', 'const RTH_OPEN_MIN', 'function nyParts', 'function regularSessionWindow', 'function sessionMove'];
  for (const t of teile) if (worker.indexOf(t) < 0) throw new Error(`${t} nicht gefunden`);
  const zeile = (marke) => worker.slice(worker.indexOf(marke), worker.indexOf('\n', worker.indexOf(marke)) + 1);
  const schnitt = (von, bis) => worker.slice(worker.indexOf(von), worker.indexOf(bis));
  /* NY_FMT steht vor `nyParts`, alles Weitere (RTH_*, nyOffsetMs,
     regularSessionWindow) liegt im Schnitt dazwischen. */
  const src = zeile('const NY_FMT')
    + schnitt('function nyParts', 'function sessionVwap')
    + schnitt('function sessionMove', '\nfunction analyseStock')
    + '; return sessionMove;';
  return new Function(src)();
}
const sessionMove = ladeMove();

/** 5-Minuten-Bars bauen. `tag` ist ein ET-Datum, `minET` die Minute nach Mitternacht ET. */
const OFF = 4 * 3600_000;                       // September: ET = UTC-4
const bar = (tag, minET, c, h = c, l = c) => ({
  dt: new Date(Date.UTC(2026, 8, tag, 0, minET) + OFF).toISOString(), c, h, l, v: 1000,
});

/* ── NK94a · DER GEMELDETE FALL ────────────────────────────────────────────
   Vortagsschluss 206,71 (Freitag 15:55 ET), heute 238,57. Das sind die echten
   Zahlen aus dem Bildschirmfoto: +15,4 %. */
{
  const bars = [
    bar(11, 15 * 60 + 50, 206.20), bar(11, 15 * 60 + 55, 206.71),   // Freitag, Schluss
    bar(14, 9 * 60 + 30, 219.00), bar(14, 11 * 60, 238.95, 238.95), // Montag, Hoch
    bar(14, 12 * 60 + 55, 238.57),
  ];
  const m = sessionMove(bars, { feed: 'tiingo-iex' });
  assert.equal(m.prevCloseUsd, 206.71, 'NK94a: der Vortagsschluss muss der letzte Bar VOR 09:30 ET sein');
  assert.ok(Math.abs(m.dayMovePct - 15.41) < 0.02, `NK94a: +15,4 % erwartet, war ${m.dayMovePct}`);
  assert.ok(Math.abs(m.dayHighPct - 15.60) < 0.05, `NK94a: das Tageshoch muss mitgerechnet werden, war ${m.dayHighPct}`);
  assert.ok(/11:00/.test(new Date(m.dayExtremeTs).toISOString().slice(11, 16))
    || m.dayExtremeTs.includes('T15:00'), 'NK94a: der Zeitstempel muss zum hoechsten Bar gehoeren');
  assert.equal(m.moveBasis, 'reguläre Sitzung', 'NK94a: die Basis gehoert benannt');
}

/* ── NK94b · VORBOERSE ZAEHLT GEGEN DENSELBEN VORTAGSSCHLUSS ───────────────
   Genau die Lage, in der ein Gap entsteht und die Meldung am meisten wert
   ist: vor 09:30 ET gibt es noch keinen Sitzungsbalken. Ein Melder, der dann
   schweigt, schweigt beim Gap. */
{
  const bars = [
    bar(11, 15 * 60 + 55, 100), bar(14, 5 * 60, 108), bar(14, 7 * 60, 112, 113),
  ];
  const m = sessionMove(bars, { feed: 'tiingo-iex' });
  assert.equal(m.prevCloseUsd, 100, 'NK94b: der Vortagsschluss bleibt derselbe');
  assert.ok(Math.abs(m.dayMovePct - 12) < 0.01, `NK94b: +12 % erwartet, war ${m.dayMovePct}`);
  assert.match(m.moveBasis, /Vorbörse/, 'NK94b: … und die Basis sagt, dass es Vorboerse ist');
}

/* ── NK94c · OHNE BASIS WIRD NICHTS BEHAUPTET ──────────────────────────────
   Fail-closed, dieselbe Regel wie in `sessionVwap`. Eine Bewegung ohne
   Vortagsschluss waere eine Zahl ohne Bezug — und eine Zahl ohne Bezug ist in
   dieser App schlimmer als keine Zahl. */
{
  const nurHeute = [bar(14, 9 * 60 + 30, 50), bar(14, 10 * 60, 55)];
  const ohne = sessionMove(nurHeute, { feed: 'tiingo-iex' });
  assert.equal(ohne.dayMovePct, null, 'NK94c: ohne Vortagsschluss keine Tagesbewegung');
  assert.match(String(ohne.moveReason), /Vortagsschluss/, 'NK94c: … und der Grund steht dabei');

  const fremd = sessionMove([bar(11, 15 * 60 + 55, 100), bar(14, 10 * 60, 110)], { feed: 'twelve-data' });
  assert.equal(fremd.dayMovePct, null, 'NK94c: Twelve Data traegt keine Vortagsbasis — dort wird nichts gerechnet');
  assert.match(String(fremd.moveReason), /twelve-data/, 'NK94c: … mit Nennung der Quelle');
}

/* ── NK94d · DIE BEZUGSSITZUNG IST DIE DER DATEN, NICHT DIE DER UHR ────────
   Sonntagabend ist die letzte Sitzung Freitag. Wuerde die Sitzung aus der
   laufenden Kalenderuhr gebildet, waere sie leer und die Anzeige saegte
   „keine Bewegung", wo „Freitag +15 %" richtig ist. */
{
  const bars = [bar(10, 15 * 60 + 55, 200), bar(11, 9 * 60 + 30, 210), bar(11, 15 * 60 + 55, 230)];
  const m = sessionMove(bars, { feed: 'tiingo-iex', now: new Date(Date.UTC(2026, 8, 13, 18, 0)) });
  assert.equal(m.prevCloseUsd, 200, 'NK94d: Bezug ist die Sitzung des juengsten Bars');
  assert.ok(Math.abs(m.dayMovePct - 15) < 0.01, `NK94d: +15 % erwartet, war ${m.dayMovePct}`);
}

/* ── NK94e · DIE ZAHL DARF NICHTS BEWERTEN ────────────────────────────────
   Die wichtigste Zusage dieser Version. Der Bewegungsmelder ist eine
   BEOBACHTUNG. Kaeme er in Score, Ampel oder Freigabe an, waere aus „der
   Titel hat sich bewegt" stillschweigend „der Titel ist kaufenswert" geworden
   — und genau diese Vermischung lehnt das Regelwerk zu Recht ab. */
{
  const felder = ['dayMovePct', 'dayHighPct', 'dayLowPct', 'prevCloseUsd', 'dayExtremeTs'];
  const bewertend = [
    worker.slice(worker.indexOf('function analyseStock'), worker.indexOf('  return {', worker.indexOf('function analyseStock'))),
  ].join('\n');
  for (const f of felder) {
    const treffer = [...bewertend.matchAll(new RegExp(`\\b${f}\\b`, 'g'))].length;
    assert.equal(treffer, 0,
      `NK94e: „${f}" darf im Rechenteil von analyseStock nicht vorkommen — es ist eine Anzeige, kein Eingang`);
  }
  // Die Kachel selbst darf keine Ampel ziehen.
  const kachel = app.slice(app.indexOf('function renderWatchMoves()'), app.indexOf("\nfunction renderTopPicks"));
  assert.ok(kachel.length > 500, 'NK94e: die Kachel muss gefunden werden');
  for (const verboten of ['stockLevel(', 'buyReady(', 'stockHeadline(']) {
    assert.ok(!kachel.includes(verboten),
      `NK94e: die Kachel darf „${verboten}" nicht benutzen — sie bewertet nicht`);
  }
  assert.match(kachel, /keine Kauf-Freigabe/, 'NK94e: … und sagt das auch dem Nutzer');
}

/* ── NK94f · DER TON SCHLAEGT NUR EINMAL JE TITEL UND HANDELSTAG AN ────────
   Ein Melder, der bei jedem Takt piept, wird nach zwei Tagen abgeschaltet und
   ist dann genauso wertlos wie das Schweigen davor. */
{
  const src = app.slice(app.indexOf('function trackWatchMoves('), app.indexOf('function renderWatchMoves()'));
  assert.ok(src.length > 200, 'NK94f: der Tracker muss gefunden werden');
  const store = { day: null, syms: {} };
  let toene = 0;
  const fn = new Function('S', 'DEFAULTS', 'moveSeenStore', 'moveEtDay', 'moveThreshold', 'localStorage', 'beep',
    src + '; return {trackWatchMoves, hol:()=>moveSeenStore};')(
    { sound: true, moveAlertSound: true, moveAlertPct: 5 }, { moveAlertPct: 5 }, store,
    () => '2026-09-14', () => 5, { setItem() {} }, () => { toene++; });

  const liste = (mv) => [{ r: { symbol: 'CRWD' }, mv }];
  fn.trackWatchMoves(liste(15.4));
  assert.equal(toene, 1, 'NK94f: das erste Reissen der Schwelle meldet sich');
  fn.trackWatchMoves(liste(15.6));
  fn.trackWatchMoves(liste(16.9));
  assert.equal(toene, 1, 'NK94f: … jeder weitere Takt desselben Titels nicht mehr');
  fn.trackWatchMoves([{ r: { symbol: 'DELL' }, mv: -8 }]);
  assert.equal(toene, 2, 'NK94f: ein ANDERER Titel meldet sich wieder — auch nach unten');
  fn.trackWatchMoves([{ r: { symbol: 'INTC' }, mv: 3 }]);
  assert.equal(toene, 2, 'NK94f: unter der Schwelle bleibt es still, auch wenn die Kachel die Zeile zeigt');
}

/* ═══ NK95 · DIESELBE SERIE IM SELBEN TAKT NUR EINMAL HOLEN ════════════════
   Aus dem Tiingo-Konto (14.09.): `iex-chart` bei 93.852 Abrufen und 1,831 GB,
   31 % der Bandbreite. Der Kommentar, der in v4.12.x den Rueckblick auf sechs
   Tage verlaengerte, rechnete mit „0,049 GB im Monat" — Faktor 37 daneben.
   Die Antwortgroesse war richtig geschaetzt, die ANZAHL der Abrufe nicht. */
{
  const von = worker.indexOf('const iexSeriesMemo = new Map()');
  const bis = worker.indexOf('\n/* ══ v4.2.0', von);
  assert.ok(von > 0 && bis > von, 'NK95: der Memo-Abschnitt muss gefunden werden');
  let abrufe = 0;
  const mod = new Function('tiingoFetch', 'seriesLookbackDays', 'STOCK_NAMES', 'STOCK_SEARCH_BY_SYMBOL',
    worker.slice(von, bis) + '; return {tiingoIexSeries, memo:iexSeriesMemo};')(
    async () => { abrufe++; return Array.from({ length: 30 }, (_, i) => ({ date: `2026-09-14T1${i % 10}:00:00Z`, open: 1, high: 1, low: 1, close: 1, volume: 5 })); },
    () => 6, {}, new Map());

  await mod.tiingoIexSeries({}, 'CRWD');
  await mod.tiingoIexSeries({}, 'CRWD');
  await mod.tiingoIexSeries({}, 'CRWD');
  assert.equal(abrufe, 1, 'NK95: derselbe Titel im selben 5-Minuten-Takt darf nur EINEN Abruf kosten');
  await mod.tiingoIexSeries({}, 'DELL');
  assert.equal(abrufe, 2, 'NK95: ein anderer Titel wird selbstverstaendlich geholt');

  /* Der Takt steht im Schluessel — damit kann der Memo keinen Balken
     zurueckhalten, den der Feed schon haette. Nachgewiesen, indem der
     Eintrag unter einem alten Takt abgelegt und erneut gefragt wird. */
  const alt = [...mod.memo.keys()].find((k) => k.startsWith('CRWD'));
  const takt = Number(alt.split('|').pop());
  assert.ok(Number.isFinite(takt) && takt > 0, 'NK95: der Schluessel muss den 5-Minuten-Takt tragen');
  mod.memo.delete(alt);
  mod.memo.set(alt.replace(String(takt), String(takt - 1)), { values: [] });
  await mod.tiingoIexSeries({}, 'CRWD');
  assert.equal(abrufe, 3, 'NK95: mit dem naechsten Takt wird neu geholt — kein Aktualitaetsverlust');
}

/* ── NK95b · EINE LEERE ANTWORT WIRD NICHT GEMERKT ─────────────────────────
   Einen Aussetzer fuenf Minuten festzuhalten waere die teuerste Art zu
   sparen: sie macht den Titel eine Runde lang unanalysierbar. */
{
  const von = worker.indexOf('const iexSeriesMemo = new Map()');
  const bis = worker.indexOf('\n/* ══ v4.2.0', von);
  let abrufe = 0;
  const mod = new Function('tiingoFetch', 'seriesLookbackDays', 'STOCK_NAMES', 'STOCK_SEARCH_BY_SYMBOL',
    worker.slice(von, bis) + '; return {tiingoIexSeries};')(
    async () => { abrufe++; return []; }, () => 6, {}, new Map());
  await mod.tiingoIexSeries({}, 'LEER');
  await mod.tiingoIexSeries({}, 'LEER');
  assert.equal(abrufe, 2, 'NK95b: eine unbrauchbare Antwort darf nicht gemerkt werden');
}

console.log('✓ FusionPulse v4.16.0 NK94/NK95 Bewegungsmelder und Serien-Memo (ausgefuehrt): OK');
