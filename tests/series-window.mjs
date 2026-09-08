/* ══════ v4.6.1 · Suite 64 · NK85 — DAS ZEITFENSTER DER KURSREIHE ════════════
   ANLASS, gemessen und nicht vermutet. `/api/tiingo/probe` gegen NVDA am
   08.09. um 10:10 ET, mit der URL der App:

     zeilen: 8 · hatDatum: true · felder: [date,open,high,low,close,volume]

   Die Abfrage war immer richtig. Es kamen acht Balken, und `analyseStock`
   steigt bei `bars.length < 24` aus. Ursache: das Fenster reichte 36 Stunden
   zurueck und traf auf Wochenende plus Labor Day. Es ist aber KEIN
   Feiertagsfall — Freitag 16:00 ET bis Montag 09:30 ET sind 65 Stunden, die
   App war an jedem Montagvormittag bis etwa 11:30 ET blind.

   Dieser Prueflauf sichert zwei Dinge, beide AUSGEFUEHRT:
     NK85a  Die Schwelle liegt wirklich bei 24 — nicht bei einer Zahl, die ich
            aus dem Quelltext abgelesen zu haben glaube.
     NK85b  Mehr Historie VORNE aendert die Bewertung nicht. Ohne diesen
            Nachweis waere die Fensterverlaengerung ein stiller Eingriff in
            die Bewertung, und genau das darf in dieser App nicht passieren.

   WARNUNG AN SPAETERE LESER, aus eigenem Fehler: Der erste Versuch dieses
   Tests erzeugte fuer jede Laenge eine NEUE Reihe. Damit war auch der Schwanz
   verschieden, und der Test meldete eine CRV-Abweichung von 3,56 gegen 2,34 —
   ein Fehlalarm aus dem Pruefstand, nicht aus dem Code. Die Reihe wird
   deshalb EINMAL gebaut und nur vorne beschnitten. Wer das aendert, prueft
   wieder etwas anderes als er glaubt. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { analyseStock } from '../src/worker.js';

const w = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');

/* Eine einzige deterministische Reihe. `values` erwartet neueste zuerst. */
const N = 300, START = Date.UTC(2026, 8, 1, 13, 30, 0);
const ALLE = [];
{
  let c = 100;
  for (let i = 0; i < N; i++) {
    c += Math.sin(i / 7) * 0.35 + 0.02;
    ALLE.push({ datetime: new Date(START + i * 300000).toISOString(),
      open: String(c - 0.05), high: String(c + 0.28), low: String(c - 0.26),
      close: String(c), volume: String(90000 + Math.round(Math.sin(i / 5) * 20000) + i * 40) });
  }
}
const quelle = (n) => ({ meta: { name: 'T', exchange: 'NASDAQ', currency: 'USD' },
  values: ALLE.slice(N - n).slice().reverse() });
const KOMP = new Set(['ema21', 'mtf', 'volume', 'vwap']);
const lauf = (n) => analyseStock('T', 'Technologie', quelle(n), 1.17, KOMP, 3);

/* ═══ NK85a · Die Schwelle ═════════════════════════════════════════════════ */
{
  /* Acht Balken sind der real gemessene Fall vom 08.09. Nebenbefund beim Bau
     dieses Tests: unterhalb von 13 Balken STUERZT analyseStock ab
     (`bars.at(-13).c` auf undefined). Die 24er-Schwelle ist also nicht nur ein
     Qualitaetsfilter, sondern haelt einen Absturz auf. Wer sie senkt, bekommt
     keine schlechteren Signale, sondern eine Ausnahme. */
  assert.equal(lauf(8),  null, 'Acht Balken — genau der gemessene Fall — muessen null ergeben');
  assert.doesNotThrow(() => lauf(13), 'Ab 13 Balken darf es hoechstens null geben, nie eine Ausnahme');
  assert.equal(lauf(23), null, 'Unter 24 Balken darf nicht bewertet werden');
  assert.ok(lauf(24), 'Ab 24 Balken muss bewertet werden');

  /* Die Konstante im Worker muss zur gemessenen Schwelle passen.
     ACHTUNG, eigener Fehler beim Bau dieses Tests: hier stand zuerst ein
     `assert.match(w, ...)` ueber die GANZE Datei. Der Ausdruck traf den
     Kommentar an SERIES_LOOKBACK_DAYS, in dem die Zahl 24 ebenfalls vorkommt —
     der Test bestaetigte also meine eigene Prosa und liess eine auf 8 gesenkte
     Schwelle anstandslos durch. Deshalb wird der Ausdruck jetzt auf den
     RUMPF von analyseStock eingegrenzt. */
  const rumpf = (() => {
    const i = w.indexOf('function analyseStock');
    assert.ok(i > 0, 'analyseStock nicht gefunden');
    return w.slice(i, w.indexOf('\nfunction ', i + 20));
  })();
  assert.match(rumpf, /bars\.length\s*<\s*24\s*\)\s*return null/,
    'Die 24er-Schwelle in analyseStock muss unveraendert bleiben');
  assert.ok(!/bars\.length\s*<\s*(?!24\b)\d+\s*\)\s*return null/.test(rumpf),
    'Es darf keine ZWEITE, abweichende Balkenschwelle in analyseStock geben');
}

/* ═══ NK85b · Mehr Historie vorne aendert nichts hinten ════════════════════
   Verglichen wird ab 36 Balken. Zwischen 24 und 35 kann `vs.slice(-36,-1)`
   nicht voll besetzt werden; dort WEICHT die Bewertung zulaessig ab, und das
   steht so auch im Kommentar an SERIES_LOOKBACK_DAYS. Diese Ausnahme wird
   unten ausdruecklich mitgeprueft, statt sie zu verschweigen. */
{
  const feld = (r) => r && { score: r.score, light: r.light, crv: r.netCRV ?? r.crv,
    setup: r.setup, entry: r.entry, stop: r.stop };
  const referenz = feld(lauf(36));
  assert.ok(referenz, 'Referenzlauf muss ein Ergebnis liefern');

  for (const n of [60, 84, 150, 300]) {
    assert.deepEqual(feld(lauf(n)), referenz,
      `${n} Balken muessen dieselbe Bewertung ergeben wie 36 — sonst ist die Fensterverlaengerung ein Eingriff in die Bewertung`);
  }

  /* Die benannte Ausnahme: bei genau 24 Balken DARF es abweichen. Wenn das
     eines Tages nicht mehr stimmt, ist der Kommentar falsch und muss weg. */
  const knapp = feld(lauf(24));
  assert.notDeepEqual(knapp, referenz,
    'Bei 24 Balken ist eine Abweichung dokumentiert — trifft sie nicht mehr zu, ist der Kommentar an SERIES_LOOKBACK_DAYS ueberholt');
  assert.ok(Math.abs(Number(knapp.crv) - Number(referenz.crv)) < 0.5,
    'Die dokumentierte Abweichung muss klein bleiben; ein Sprung waere ein anderer Fehler');
}

/* ═══ NK85c · Das Fenster deckt Wochenende und Feiertag ════════════════════ */
{
  const m = w.match(/const SERIES_LOOKBACK_DAYS\s*=\s*(\d+)/);
  assert.ok(m, 'SERIES_LOOKBACK_DAYS muss benannt sein, nicht als Zahl in der URL stehen');
  const tage = Number(m[1]);

  /* Freitag 16:00 ET bis Dienstag 09:35 ET nach einem Feiertagsmontag sind
     4 Tage und 17,5 Stunden. Weniger als 5 Tage waere die alte Luecke. */
  assert.ok(tage >= 5, `${tage} Tage reichen nicht ueber Wochenende plus Feiertag`);
  /* Der IEX-Feed liefert hoechstens 2000 Punkte. Bei 5min und 78 Balken je
     Sitzung sind das rund 25 Handelstage — die Obergrenze ist weit weg, aber
     sie gehoert benannt, damit niemand spaeter auf 60 Tage hochdreht. */
  assert.ok(tage <= 20, `${tage} Tage naehern sich der 2000-Punkte-Grenze des Feeds`);

  assert.match(w, /SERIES_LOOKBACK_DAYS\*24\*60\*60_000/,
    'Die Serie muss die Konstante benutzen, nicht wieder 36 Stunden fest verdrahten');
  assert.ok(!/Date\.now\(\)-36\*60\*60_000/.test(w),
    'Das alte 36-Stunden-Fenster darf nicht zurueckkehren');
}

/* ═══ NK85d · Die Selbstdiagnose darf ihren eigenen Befund nicht verdrehen ══
   Der erste Wurf meldete „die App benutzt Variante 1 — dort ist der Fehler\",
   OBWOHL Variante 1 der Treffer war. Eine Diagnose, die ihr Ergebnis falsch
   herum zusammenfasst, ist schlimmer als keine: sie schickt den Leser in die
   verkehrte Richtung, und zwar mit dem Anschein von Gewissheit. */
{
  const i = w.indexOf("url.pathname === '/api/tiingo/probe'");
  const block = w.slice(i, i + 4000);
  assert.ok(/MIN_BARS\s*=\s*24/.test(block),
    'Die Diagnose muss die 24er-Schwelle kennen — Zeilen allein genuegen nicht');
  assert.ok(/r\.zeilen >= MIN_BARS/.test(block),
    'Ein Treffer ist erst ein Treffer, wenn GENUG Zeilen kommen');
  assert.ok(/ZU WENIGE/.test(block),
    'Der Fall „Daten da, aber zu wenige\" muss eigens benannt werden — er war der reale Fall');
  assert.ok(/App-Abfrage selbst ist in Ordnung/.test(block),
    'Wenn Variante 1 traegt, muss die Diagnose das auch sagen');
}

console.log('✓ FusionPulse v4.6.1 NK85 Zeitfenster der Kursreihe (ausgefuehrt): OK');
