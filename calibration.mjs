/* ═══ v4.17.0 · NK97 · SCHATTENTOR UND KALIBRIERUNG ═════════════════════════
   Nutzerfrage nach einem Monat ohne eine einzige Kauf-Freigabe: „was ist mit
   deinem Algorithmus Aladdin Style? kannst du den nicht kreativ optimieren?"

   Drei Befunde: eine achtfache UND-Kette, die dieselbe Evidenz mehrfach
   zaehlt; ein Erwartungswert, der an zwei GERATENEN Geraden haengt; und eine
   Kalibrierschleife, die der Code seit v3.5.x ankuendigt und nie geschlossen
   hat — weil die Nachmessung bis v4.15.0 kaputt war.

   Die gefaehrlichste Stelle dieser Version ist nicht das neue Tor, sondern die
   Moeglichkeit, dass es VERSEHENTLICH etwas entscheidet. Genau darauf zielt
   dieser Test. */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');

/* ── NK97a · DAS SCHATTENTOR DARF NIRGENDS ENTSCHEIDEN ────────────────────
   Die eine Zusage, die diese Version traegt. Ein Schattentor, das sich in eine
   Ampel schleicht, ist kein Vergleich mehr, sondern ein stiller Austausch —
   und zwar einer, den niemand bemerkt, weil er wie das Alte aussieht. */
{
  const von = worker.indexOf('const schatten = (() => {');
  assert.ok(von > 0, 'NK97a: das Schattentor muss existieren');
  const bis = worker.indexOf('    })();', von);
  const block = worker.slice(von, bis);

  for (const verboten of ['cGreen =', 'cYellow =', 'cScore =', 'cNetCRV =', 'cExpectancyR =']) {
    assert.ok(!block.includes(verboten),
      `NK97a: das Schattentor darf „${verboten}" nicht neu belegen — es rechnet daneben, nicht hinein`);
  }
  // Und der Rest des Workers darf `shadow` nirgends in eine Entscheidung ziehen.
  const ohneSchatten = worker.slice(0, von) + worker.slice(bis);
  for (const m of ohneSchatten.matchAll(/\.shadow\b[^\n]*/g)) {
    const zeile = m[0];
    const erlaubt = /shadow_light|shadow_ev|shadow\?\.light|shadow\?\.expectancyR/.test(zeile);
    assert.ok(erlaubt,
      `NK97a: „${zeile.trim().slice(0, 80)}" benutzt das Schattenurteil ausserhalb der Aufzeichnung`);
  }
}

/* ── NK97b · DIE SCHWELLE IST BEWUSST DIESELBE ────────────────────────────
   Verglichen werden soll die STRUKTUR des Tores, nicht eine zweite verstellte
   Zahl. Wer Struktur und Schwelle gleichzeitig aendert, kann hinterher nicht
   sagen, was gewirkt hat — das ist der klassische Weg, aus einem Experiment
   eine Meinung zu machen. */
{
  const von = worker.indexOf('const schatten = (() => {');
  const block = worker.slice(von, worker.indexOf('    })();', von));
  assert.match(block, /sEV >= 0\.15/,
    'NK97b: das Schattentor muss dieselbe 0,15R-Schwelle benutzen wie das Haupttor');
  assert.match(worker, /cExpectancyR < 0\.15/,
    'NK97b: … und die des Haupttors darf sich dabei nicht verschoben haben');
}

/* ── NK97c · VETO NUR BEI UNBEKANNTEM ERWARTUNGSWERT ──────────────────────
   Das Prinzip hinter dem alternativen Tor. Ueberdehnung und schwaches RVOL
   machen den EV schlechter, nicht unberechenbar — sie gehoeren in p1, nicht in
   eine Veto-Kette. Sonst zaehlt die Kette dieselbe Evidenz wieder doppelt und
   der ganze Umbau war umsonst. */
{
  const von = worker.indexOf('const schatten = (() => {');
  const block = worker.slice(von, worker.indexOf('    })();', von));
  const sperren = [...block.matchAll(/sBlock\.push\(/g)].length;
  assert.ok(sperren >= 4 && sperren <= 6, `NK97c: vier bis sechs Sperren erwartet, gefunden ${sperren}`);
  for (const echt of ['volumeKnown', 'relVol == null', "situationType === 'WATCH'", 'frictionOk']) {
    assert.ok(block.includes(echt), `NK97c: „${echt}" muss weiterhin sperren — ohne das ist der EV nicht bildbar`);
  }
  assert.ok(!/if \(overextended\) sBlock\.push/.test(block),
    'NK97c: Ueberdehnung darf NICHT sperren, sie gehoert in p1');
  assert.ok(/overextended \? -0\.0\d/.test(block),
    'NK97c: … und muss dort auch tatsaechlich ankommen');
}

/* ── NK97d · DIE KALIBRIERUNG ZAEHLT NUR NACHGEMESSENE ZEILEN ─────────────
   Sonst waere es der Scheinverlierer-Fehler aus v4.15.0, eine Ebene hoeher:
   eine unberuehrte Zeile als „Ziel nicht erreicht" zu zaehlen macht aus einer
   fehlenden Messung ein schlechtes Ergebnis. */
{
  const von = worker.indexOf('async function calibrationReport(');
  assert.ok(von > 0, 'NK97d: calibrationReport muss existieren');
  const block = worker.slice(von, worker.indexOf('\nasync function signalHistory(', von));
  assert.match(block, /max_pct<>0 OR min_pct<>0 OR reach_ts IS NOT NULL/,
    'NK97d: die Abfrage MUSS auf nachgemessene Zeilen einschraenken');
  assert.match(block, /caveat:/,
    'NK97d: die Einschraenkung „beruehrt ist nicht verdient" muss mitgeliefert werden');
  assert.ok(!/UPDATE |INSERT |DELETE /.test(block),
    'NK97d: die Kalibrierung ist ein reiner Lesevorgang');
}

/* ── NK97e · DAS SCHATTENURTEIL WIRD AUFGEZEICHNET ────────────────────────
   Ohne Aufzeichnung zum Zeitpunkt der Freigabe gibt es in sechs Wochen nichts
   zu vergleichen — Score, RVOL und Situation von damals sind dann weg.
   Nachtraeglich rekonstruieren geht nicht. */
{
  assert.match(worker, /ADD COLUMN shadow_light TEXT/, 'NK97e: Spalte shadow_light fehlt');
  assert.match(worker, /ADD COLUMN shadow_ev REAL/, 'NK97e: Spalte shadow_ev fehlt');
  const ins = worker.slice(worker.indexOf('INSERT OR IGNORE INTO market_snapshots'));
  const kopf = ins.slice(0, 900);
  assert.match(kopf, /shadow_light,shadow_ev,payload/, 'NK97e: beide Spalten muessen im INSERT stehen');
  const spalten = (kopf.match(/\(ts,bucket5[^)]*\)/) || [''])[0].split(',').length;
  const platzhalter = ((kopf.match(/VALUES\(([?,]+)\)/) || ['', ''])[1].match(/\?/g) || []).length;
  assert.equal(spalten, platzhalter,
    `NK97e: Spaltenzahl (${spalten}) und Platzhalter (${platzhalter}) muessen uebereinstimmen`);
}

console.log('✓ FusionPulse v4.17.0 NK97 Schattentor und Kalibrierung: OK');

/* ═══ v4.18.0 · NK98 · DAS FRISCHE-FENSTER UND DIE BILANZ ══════════════════
   Nutzer, nach einem Monat ohne sichtbare Empfehlung: „ich brauche nur
   kreative/innovative App mit zuverlaessigen Empfehlungen." Und: „vergiss
   nicht zu checken wie deine Empfehlungen gelaufen sind."

   Beides haengt an derselben Stelle. Stufe 3 verlangte einen Scan aus den
   letzten 90 SEKUNDEN — eine Regel aus der Zeit, als der Browser selbst
   scannte. Seit v4.0.0 rotiert der Cron mit acht von 37 Titeln je
   Zwei-Minuten-Takt; ein Titel war damit rund 15 % der Zeit freigabefaehig.
   Kein Qualitaetsmassstab, ein Ueberbleibsel. */
{
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

  /* ── NK98a · Das alte Fenster darf nicht mehr entscheiden ─────────────── */
  const lvl = app.slice(app.indexOf('const stockLevel = (r) => {'), app.indexOf('/** Intensität wächst'));
  assert.ok(!/fresh\.key === 'live'/.test(lvl),
    'NK98a: das 90-Sekunden-Fenster darf ueber die Freigabe nicht mehr bestimmen');
  assert.match(lvl, /freshEnoughForBuy\(r\)/,
    'NK98a: … die Freigabe muss die neue Pruefung benutzen');

  /* ── NK98b · Aber der Schutz muss BLEIBEN ──────────────────────────────
     Der ganze Zweck der alten Regel war: nicht auf einem Freitagskurs kaufen.
     Ein Fenster zu weiten, das diesen Schutz mitnimmt, waere kein Fortschritt,
     sondern der schlimmere Fehler. */
  const fn = app.slice(app.indexOf('function freshEnoughForBuy(r){'), app.indexOf('const stockLevel = (r) => {'));
  assert.ok(fn.length > 200, 'NK98b: freshEnoughForBuy muss gefunden werden');
  assert.match(fn, /if \(!ds\.known\) return \{ ok:false/,
    'NK98b: ohne lesbaren Zeitstempel KEINE Freigabe — fail-closed bleibt fail-closed');
  assert.match(fn, /if \(!ds\.sameDay\) return \{ ok:false/,
    'NK98b: ein Kurs von gestern darf niemals freigeben — genau davor schuetzte die alte Regel');
  assert.match(fn, /alter > BUY_MAX_AGE_MIN/,
    'NK98b: … und ein zu alter Kurs aus der laufenden Sitzung ebenso wenig');
  const grenze = Number((app.match(/const BUY_MAX_AGE_MIN = (\d+)/) || [])[1]);
  assert.ok(grenze >= 10 && grenze <= 30,
    `NK98b: die Grenze muss zwischen 10 und 30 Minuten liegen (Rotationszyklus ~10 Min.), ist ${grenze}`);

  /* ── NK98c · Ton und Freigabe duerfen nicht auseinanderlaufen ──────────
     Ein Ton ohne Freigabe (oder eine Freigabe ohne Ton) ist ein Widerspruch
     auf demselben Bildschirm — und der Nutzer glaubt dann keinem von beiden. */
  assert.ok(!/soundEligible = fresh\.key==='live'/.test(app),
    'NK98c: der Ton muss demselben Massstab folgen wie die Freigabe');
  assert.match(app, /soundEligible = freshEnoughForBuy\(r\)\.ok/,
    'NK98c: … naemlich freshEnoughForBuy');

  /* ── NK98d · Die Bilanz darf keine Rendite behaupten ───────────────────
     „Ziel beruehrt" ist nicht „verdient". Ohne diesen Satz liest sich die
     Trefferquote wie ein Kontoauszug, und das waere die eine Unehrlichkeit,
     die alles andere entwertet. */
  const bil = app.slice(app.indexOf('function renderBilanz(){'), app.indexOf('\nfunction renderCalibration('));
  assert.ok(bil.length > 500, 'NK98d: die Bilanz-Kachel muss gefunden werden');
  assert.match(bil, /Ausführung, Slippage/,
    'NK98d: die Einschraenkung zur Ausfuehrung MUSS in der Anzeige stehen');
  assert.match(bil, /BELASTBAR/,
    'NK98d: es muss eine Stichprobengrenze geben — eine Quote aus zwoelf Faellen ist kein Ergebnis');
  assert.match(bil, /Ein leerer Vergleich ist kein Gleichstand/,
    'NK98d: ein leerer Schattenvergleich darf nicht wie ein Unentschieden aussehen');
  for (const verboten of ['stockLevel(', 'buyReady(']) {
    assert.ok(!bil.includes(verboten), `NK98d: die Bilanz darf „${verboten}" nicht benutzen — sie wertet aus, sie entscheidet nicht`);
  }
}

console.log('✓ FusionPulse v4.18.0 NK98 Frische-Fenster und Bilanz: OK');

/* ═══ v4.19.0 · NK99 · AUSGANG ERKLAEREN, TICKER OEFFNEN ═══════════════════
   Zwei Nutzerbefunde am 15.09.:
     „bitte auch beim Mouse Over beschreibung der Auswertung (was bedeutet Ziel
      erreicht, oder ausgewertet … ist fuer mich nicht schluessig)"
     „auch sollte man in den Listen Aktien/Coins den Ticker anklicken koennen
      und dieser sollte dann aktualisiert im Skope Fenster geoeffnet werden" */
{
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

  /* ── NK99a · Jeder der vier Ausgaenge traegt eine Erklaerung ───────────
     Die vier Woerter tragen sehr verschiedene Aussagen, und drei davon sind
     Nicht-Aussagen: „ohne Beleg" ist KEIN Ergebnis, „offen" ist noch keins.
     Wer das nicht weiss, liest beide als Misserfolg. */
  const von = worker.indexOf('outcomeWhy:');
  assert.ok(von > 0, 'NK99a: der Erklaertext muss im Worker gebildet werden');
  const block = worker.slice(von, von + 1800);
  assert.match(block, /OHNE BEFUND — kein Fehlschlag/,
    'NK99a: „ohne Beleg" MUSS als fehlende Messung erklaert werden, nicht als Misserfolg');
  assert.match(block, /berührt heißt nicht verdient/,
    'NK99a: „Ziel erreicht" darf nicht als Gewinn gelesen werden koennen');
  assert.match(block, /NOCH LÄUFT DIE MESSUNG/,
    'NK99a: „offen" muss als Zwischenstand kenntlich sein');
  assert.match(block, /\$\{PICK_REACH_PCT\}/,
    'NK99a: die Schwelle gehoert als VARIABLE in den Text — als feste Zahl waere sie beim naechsten Gebuehrenwechsel still falsch');

  /* ── NK99b · … und die Erklaerung erreicht auch die Anzeige ───────────
     Ein Text, den der Server bildet und die Oberflaeche wegwirft, ist keine
     Erklaerung. Genau so ist in diesem Projekt schon einmal eine ganze
     Messung verschwunden. */
  assert.match(app, /title="\$\{esc\(e\.outcomeWhy \|\| ''\)\}"/,
    'NK99b: der Ausgang muss den Erklaertext als Mouseover tragen');
  assert.match(app, /class="sig-out"/,
    'NK99b: … sichtbar gekennzeichnet, sonst sucht dort niemand');

  /* ── NK99c · Ticker oeffnet das Skope-Fenster, aktualisiert ───────────
     Aktien rotieren im Deep Scan: der angeklickte Titel zeigte den Stand der
     letzten Runde, im Zweifel zehn Minuten alt. Gerade der angeklickte Titel
     ist aber der, fuer den man einen frischen Kurs will. */
  assert.match(app, /openStockFromDiscovery\(row\.dataset\.sym\|\|'', true\)/,
    'NK99c: der Klick auf eine Aktienzeile muss mit Neuabfrage ins Skope-Fenster fuehren');
  assert.match(app, /async function openStockFromDiscovery\(symbol, aktualisieren=false\)/,
    'NK99c: … und die Funktion muss das Aktualisieren ueberhaupt kennen');
  assert.match(app, /if\(!aktualisieren\) return;/,
    'NK99c: ohne Anforderung bleibt es beim alten Verhalten — Discovery-Kacheln sollen nicht bei jedem Klick nachladen');

  /* ── NK99d · Coins: Blick ins Fenster, nicht auf die Zeile ────────────
     Die angeklickte Zeile stand ohnehin schon im sichtbaren Bereich, sonst
     haette man sie nicht anklicken koennen. Das Analysefenster liegt weiter
     oben und blieb dadurch unsichtbar. */
  const sel = app.slice(app.indexOf('function select(pair, byUser) {'), app.indexOf('function step(dir) {'));
  assert.match(sel, /if \(byUser\) requestAnimationFrame\(\(\) => \$\('#focus'\)/,
    'NK99d: ein Klick des Nutzers muss das Skope-Fenster in den Blick holen');
  assert.match(sel, /else rowNodes\.get\(pair\)/,
    'NK99d: … automatische Auswahl darf die Ansicht NICHT verspringen lassen');
}

console.log('✓ FusionPulse v4.19.0 NK99 Ausgangs-Erklaerung und Ticker-Klick: OK');

/* ═══ v4.20.0 · NK100 · DIE SCHWELLE ERKLAEREN, DEN PEAK DATIEREN ══════════
   Zwei Nutzerbefunde am 15.09.:
     „die ziel grenze 2,02 % erscheint in der Beschreibung trotzdem nicht
      logisch — was bedeutet das."
     „auch sollte in den Listen bezueglich Ziel erreicht auch stehen —
      Empfehlung Uhrzeit und wann der hoechste Peak … zu messen war." */
{
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

  /* ── NK100a · Die Schwelle traegt ihre Herleitung mit ──────────────────
     Sie folgt seit v3.21.0 zwingend aus den Handelskosten — nur konnte das
     niemand LESEN, und eine hergeleitete Zahl ohne Herleitung sieht wie eine
     gegriffene aus. Entscheidend: der Text wird aus den KONSTANTEN gebildet.
     Abgetippt waere er beim naechsten Gebuehrenwechsel still falsch. */
  assert.match(worker, /const ECON_WIN_EXPLAIN = /,
    'NK100a: die Herleitung muss im Worker gebildet werden, nicht in der Anzeige');
  const erkl = worker.slice(worker.indexOf('const ECON_WIN_EXPLAIN = '), worker.indexOf('const LEGACY_WIN_PCT'));
  for (const teil of ['ECON_NET_EUR', 'PICK_COST.taxPct', 'PICK_COST.orderFeeEur', 'PICK_COST.frictionPct', 'ECON_WIN_PCT']) {
    assert.ok(erkl.includes(teil),
      `NK100a: „${teil}" muss als VARIABLE in die Herleitung eingehen — eine feste Zahl veraltet unbemerkt`);
  }
  assert.ok(!/2[,.]0[0-9] ?%/.test(erkl),
    'NK100a: die Schwelle darf im Erklaertext nirgends abgetippt stehen');
  /* Die Definition steht im Quelltext NACH `signalHistory` — das ist kein
     Fehler: sie wird erst zur Laufzeit im Funktionskoerper gelesen, und bis
     dahin ist das Modul vollstaendig ausgewertet. Geprueft wird deshalb, was
     tatsaechlich zaehlt: sie muss auf Modulebene stehen (Spalte 0), nicht in
     einer Funktion — sonst waere sie beim Aufruf nicht sichtbar. */
  assert.match(worker, /\nconst ECON_WIN_EXPLAIN = /,
    'NK100a: die Herleitung muss auf Modulebene stehen, sonst ist sie zur Laufzeit nicht sichtbar');
  const oW = worker.slice(worker.indexOf('outcomeWhy:'), worker.indexOf('outcomeWhy:') + 1800);
  assert.ok((oW.match(/ECON_WIN_EXPLAIN/g) || []).length >= 2,
    'NK100a: die Herleitung gehoert an BEIDE gemessenen Ausgaenge, nicht nur an den Erfolg');

  /* ── NK100b · Der Peak bekommt einen Zeitpunkt ─────────────────────────
     „+19,2 %" nach zehn Minuten und „+19,2 %" nach zweidreiviertel Stunden
     sind voellig verschiedene Aussagen. Der ABSTAND ist die Information. */
  assert.match(worker, /ADD COLUMN max_ts INTEGER/, 'NK100b: die Spalte max_ts fehlt');
  assert.match(worker, /const neuesHoch = mx > \(Number\(x\.max_pct\)\|\|0\) \+ 1e-9;/,
    'NK100b: der Zeitpunkt darf NUR bei einem tatsaechlich neuen Hoechststand gesetzt werden');
  assert.ok(!/max_ts=COALESCE/.test(worker),
    'NK100b: kein COALESCE — der Zeitpunkt muss mit dem Hoechststand mitwandern');
  assert.match(worker, /peakAfterMin: e\.maxTs \? Math\.max\(0, Math\.round\(\(e\.maxTs-e\.firstTs\)\/60_000\)\) : null/,
    'NK100b: der Abstand zur Freigabe muss geliefert werden');

  /* ── NK100c · Fehlende Zeit wird als fehlend ausgewiesen ───────────────
     Altbestand hat keinen Zeitpunkt. Ihn leer zu lassen hiesse, dass der
     Nutzer ihn fuer „sofort" haelt — dieselbe Verwechslung wie bei den
     0,0 % in v4.15.0, nur eine Spalte weiter. */
  const rend = app.slice(app.indexOf('const spanne = (m) =>'), app.indexOf('return `<tr data-tone='));
  assert.match(rend, /Hoch · Zeit n\.v\./,
    'NK100c: ohne aufgezeichneten Zeitpunkt muss „Zeit n.v." dastehen, nicht nichts');
  assert.match(rend, /e\.peakAfterMin != null && e\.maxTs/,
    'NK100c: … und beides muss vorliegen, bevor eine Zeit behauptet wird');
  assert.match(rend, /Ziel \$\{esc\(uhr\(e\.reachTs\)\)\}/,
    'NK100c: auch der Zeitpunkt des Zielkontakts gehoert in die Liste');
}

console.log('✓ FusionPulse v4.20.0 NK100 Schwellen-Herleitung und Peak-Zeitpunkt: OK');
