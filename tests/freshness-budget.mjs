/* ══════ v4.7.0 · Suite 65 · NK86 — AKTUALITAET GEGEN KOSTEN ═════════════════
   ANLASS: „so zuegig wie moeglich Empfehlungen fuer einen guten Trade,
   bevorzugt intraday. Die Kosten sollen aber nicht steigen.\"

   Zwei Aenderungen, die sich gegenseitig bezahlen:

     A  Das Kursreihen-Fenster rechnet mit dem Boersenkalender statt pauschal
        sechs Tage zu holen. Jahresschnitt 2,93 statt 6 Tage.
     B  `capFav` richtet sich nach der Listenlaenge statt fest auf 2 zu stehen.
        Bei 36 Favoriten 8 je Runde, voller Umlauf 10 statt 36 Minuten.

   A allein spart mehr, als B kostet. Genau DAS prueft NK86c nach — sonst
   waere „die Kosten steigen nicht\" eine Behauptung, und Behauptungen ueber
   Kosten sind in diesem Projekt schon dreimal falsch gewesen. */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const w = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');

/* Die reinen Funktionen aus dem Worker herausloesen und AUSFUEHREN. Ein Regex
   ueber den Quelltext haette in 4.5.7 schon einmal eine kaputte Reparatur
   durchgewinkt; hier wird gerechnet. */
const holen = (name) => {
  const i = w.indexOf('function ' + name + '(');
  assert.ok(i > 0, `${name} nicht gefunden`);
  return w.slice(i, w.indexOf('\nfunction ', i + 1));
};
const lookback = new Function(
  'const SERIES_LOOKBACK_DAYS=6, SERIES_SESSIONS_NEEDED=2;\n'
  + ['easterSundayUTC', 'observedFixedUTC', 'nthWeekdayUTC', 'lastWeekdayUTC',
     'nyseCalendar', 'seriesLookbackDays'].map(holen).join('\n')
  + '\nreturn seriesLookbackDays;')();

const tag = (iso) => Date.parse(iso + 'T14:00:00Z');

/* ═══ NK86a · Das Fenster deckt immer zwei volle Vorsitzungen ══════════════
   Die Zahl darf klein sein, aber nie so klein, dass die 24-Balken-Schwelle aus
   NK85 wieder reissen kann. Zwei Sitzungen sind rund 156 Balken. */
{
  const faelle = [
    ['Donnerstag, normale Woche',      '2026-09-10', 2],
    ['Freitag, normale Woche',         '2026-09-11', 2],
    ['Montag nach Wochenende',         '2026-09-14', 4],
    ['Dienstag nach Labor Day',        '2026-09-08', 5],
    ['Mittwoch, Feiertag noch in Reichweite', '2026-09-09', 5],
  ];
  for (const [name, datum, erwartet] of faelle) {
    assert.equal(lookback(tag(datum)), erwartet,
      `${name} (${datum}) braucht ${erwartet} Kalendertage`);
  }

  /* Der eigentliche Zweck, unabhaengig von einzelnen Daten: an JEDEM
     Handelstag des Jahres muessen im Fenster zwei Sitzungen liegen. */
  const kalender = new Function(
    ['easterSundayUTC', 'observedFixedUTC', 'nthWeekdayUTC', 'lastWeekdayUTC', 'nyseCalendar']
      .map(holen).join('\n') + '\nreturn nyseCalendar;')();
  let geprueft = 0, summe = 0;
  /* Ein VOLLES Jahr, nicht 250 Kalendertage. Hier stand zuerst 250 mit einer
     Erwartung von >200 Handelstagen — 250 Kalendertage enthalten aber nur rund
     173. Der Test fiel zu Recht, und die richtige Antwort war, den Zeitraum zu
     weiten statt die Erwartung zu senken. */
  for (let i = 0; i < 365; i++) {
    const t = tag('2026-01-05') + i * 86400_000, d = new Date(t);
    const feiertag = kalender(d.getUTCFullYear()).has(d.toISOString().slice(0, 10));
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6 || feiertag) continue;
    const tage = lookback(t);
    let sitzungen = 0;
    for (let b = 1; b <= tage; b++) {
      const x = new Date(t - b * 86400_000);
      if (x.getUTCDay() === 0 || x.getUTCDay() === 6) continue;
      if (kalender(x.getUTCFullYear()).has(x.toISOString().slice(0, 10))) continue;
      sitzungen++;
    }
    assert.ok(sitzungen >= 2,
      `${d.toISOString().slice(0, 10)}: nur ${sitzungen} Sitzung(en) im ${tage}-Tage-Fenster`);
    summe += tage; geprueft++;
  }
  assert.ok(geprueft >= 245, `zu wenige Handelstage geprueft (${geprueft}) — ein Boersenjahr hat rund 252`);

  /* Und es muss SPARSAMER sein als der pauschale 4.6.1-Stand, sonst war die
     ganze Uebung sinnlos. */
  const schnitt = summe / geprueft;
  assert.ok(schnitt < 3.5,
    `Jahresschnitt ${schnitt.toFixed(2)} Tage — kaum billiger als die pauschalen 6`);
  assert.ok(schnitt >= 2, `Jahresschnitt ${schnitt.toFixed(2)} Tage ist verdaechtig niedrig`);
}

/* ══ WICHTIG, aus eigenem Fehler ══════════════════════════════════════════
   Hier stand zuerst eine NACHBILDUNG der Formel im Test. Die Negativkontrolle
   „capFav wieder fest auf 2" lief daran vorbei: der Test bestaetigte meine
   eigene Arithmetik, nicht den Worker. Dieselbe Falle wie das Regex ueber die
   ganze Datei in 4.6.1 und die CSS-Pruefung in 4.5.7 — dreimal dasselbe.
   Die Formel wird jetzt AUS DEM WORKER geholt und dort ausgefuehrt. */
const zeile = w.split('\n').find((l) => l.includes('const capFav=') && l.includes('favs.length'));
assert.ok(zeile, 'Die capFav-Formel muss von favs.length abhaengen, nicht fest verdrahtet sein');
const zyklen = w.match(/const FAV_TARGET_CYCLES\s*=\s*(\d+)/);
assert.ok(zyklen, 'Die Zielumlaufzeit muss benannt sein, nicht als Zahl versteckt');
const capFav = new Function('favs',
  `const FAV_TARGET_CYCLES=${zyklen[1]};\n${zeile.trim()}\nreturn capFav;`);

/* ═══ NK86b · Der Favoritenumlauf bleibt unter einer Viertelstunde ═════════
   36 Minuten waren der gemeldete Zustand. Intraday ist das kein Signal mehr,
   sondern ein Nachruf. */
{

  for (const n of [8, 20, 36, 60]) {
    const k = capFav({ length: n });
    const minuten = Math.ceil(n / k) * 2;   // Deep Scan alle zwei Minuten
    assert.ok(minuten <= 14,
      `${n} Favoriten brauchen ${minuten} Minuten fuer einen Umlauf`);
  }
  assert.equal(capFav({length:36}), 8, 'Bei 36 Favoriten muessen 8 je Runde gezogen werden');
  assert.equal(capFav({length:0}), 0, 'Ohne Favoriten wird keine Quote reserviert');

  /* Die Rotation darf keine Titel ueberspringen. Mit der alten festen
     Schrittweite 2 und einer Quote von 8 waeren sechs je Runde uebersprungen
     und beim naechsten Zyklus dieselben nochmal gezogen worden. */
  assert.match(w, /const startFav=\(cycle\*capFav\)%favs\.length/,
    'Die Schrittweite muss der Quote folgen, sonst entstehen Luecken');

  const n = 36, k = capFav({ length: n }), gesehen = new Set();
  for (let cycle = 0; cycle < Math.ceil(n / k); cycle++) {
    const start = (cycle * k) % n;
    for (let i = 0; i < k; i++) gesehen.add((start + i) % n);
  }
  assert.equal(gesehen.size, n,
    `Nach einem vollen Umlauf muessen alle ${n} Favoriten drangewesen sein, waren aber ${gesehen.size}`);
}

/* ═══ NK86c · Die Kosten duerfen nicht steigen ════════════════════════════
   Gemessen am 09.09.: 18.871 Deep-Scan-Abrufe je Tag, 26 KB je Abruf bei
   pauschal 6 Tagen Fenster. Die Bytes je Abruf skalieren mit der Fensterlaenge,
   weil der Feed Balken liefert und keine Kopfzeilen. */
{
  /* Auch hier: die Quote kommt aus dem Worker, das Fenster aus der
     ausgefuehrten `seriesLookbackDays`. Nur die GEMESSENEN Groessen vom 09.09.
     sind Konstanten — sie stammen aus der Pfadtabelle der App. */
  assert.match(w, /const start=new Date\(Date\.now\(\)-seriesLookbackDays\(\)\*86400_000\)/,
    'Die Kursreihe muss das Kalenderfenster benutzen, nicht wieder eine feste Zahl');
  const ABRUFE_ALT = 18871, KB_JE_TAG_FENSTER = 26 / 6;
  let sum = 0, tage = 0;
  for (let i = 0; i < 365; i++) {
    const t = tag('2026-01-05') + i * 86400_000, d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    sum += lookback(t); tage++;
  }
  const fenster = sum / tage;
  const QUOTEN_ALT = 2 + 4 + 8 + 2 + 2;
  const QUOTEN_NEU = capFav({ length: 36 }) + 4 + 8 + 2 + 2;

  const altGb = ABRUFE_ALT * (26) / 1e6;
  const neuAbrufe = ABRUFE_ALT * QUOTEN_NEU / QUOTEN_ALT;
  const neuGb = neuAbrufe * (KB_JE_TAG_FENSTER * fenster) / 1e6;

  assert.ok(neuGb < altGb,
    `Der Verbrauch muesste sinken, steigt aber von ${altGb.toFixed(2)} auf ${neuGb.toFixed(2)} GB/Tag`);
  /* Nicht nur „nicht mehr\", sondern spuerbar weniger — sonst ist der
     zusaetzliche Umlauf das Risiko nicht wert. */
  assert.ok(neuGb < altGb * 0.75,
    `Erwartet wurde ein Rueckgang um mindestens ein Viertel, gemessen ${(100 - neuGb / altGb * 100).toFixed(0)} %`);
}

/* ═══ NK86d · Keine dieser Aenderungen fasst eine Kauf-Freigabe an ═════════
   Aktualitaet und Kosten sind Betriebsgroessen. Die Schwellen fuer BUY sind
   die Definition des Nutzers und bleiben unberuehrt. */
{
  for (const feld of ['seriesLookbackDays', 'FAV_TARGET_CYCLES', 'capFav']) {
    const i = w.indexOf(feld);
    const umfeld = w.slice(Math.max(0, i - 600), i + 1200);
    for (const v of ['buyReady', 'tradable=', 'netCRV =']) {
      assert.ok(!umfeld.includes(v), `${feld} darf ${v} nicht beruehren`);
    }
  }
}

console.log('✓ FusionPulse v4.7.0 NK86 Aktualitaet gegen Kosten (ausgefuehrt): OK');
