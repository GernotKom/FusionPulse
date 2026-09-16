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

/* ═══ v4.21.0 · NK101 · ZUSTAND VOR ZAHLEN IN DER FUSSLEISTE ═══════════════
   Nutzer: „warum steht da ueberhaupt die UNI Empfehlung, ist eigentlich
   verwirrend — weil ja kein buy signal."

   Die Leiste zeigte vollstaendige Planwerte, fett, mit einem Knopf „Plan"
   daneben — und nirgends stand, dass die Ampel rot war. Das ist der teuerste
   Fehlertyp dieser App: keine falsche Zahl, sondern eine richtige Zahl ohne
   ihren Zustand. */
{
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

  /* ── NK101a · „KAUF-FREIGABE" nur bei echter Freigabe ─────────────────
     Der gefaehrlichste Weg zurueck in den alten Zustand waere ein
     Zustandswort, das schon bei gruener Ampel „Freigabe" sagt. Gruen ist
     NICHT freigegeben — dazwischen liegen Qualitaet, CRV, Ausfuehrbarkeit
     und Datenfrische. */
  const dv = app.slice(app.indexOf('function dockVerdict(r){'), app.indexOf('function renderDock('));
  assert.ok(dv.length > 200, 'NK101a: dockVerdict muss gefunden werden');
  assert.match(dv, /if \(buyReady\(r\)\) return \{ key:'buy'/,
    'NK101a: „KAUF-FREIGABE" darf ausschliesslich an buyReady haengen');
  const buyZeile = dv.slice(0, dv.indexOf('\n', dv.indexOf("key:'buy'")));
  assert.ok(!/light === 'green'/.test(buyZeile),
    'NK101a: eine gruene Ampel allein darf nicht als Freigabe ausgewiesen werden');
  assert.match(dv, /key:'near', text:'GRÜN, ABER NICHT FREI'/,
    'NK101a: … der Zwischenzustand braucht ein eigenes, unmissverstaendliches Wort');
  for (const zustand of ['KEIN KAUFSIGNAL', 'BEOBACHTEN']) {
    assert.ok(dv.includes(zustand), `NK101a: der Zustand „${zustand}" fehlt`);
  }

  /* ── NK101b · Die Null wird genannt, nicht verschwiegen ───────────────
     „0 Aktien · 0 Coins" beantwortet die Frage „warum sehe ich keine
     Empfehlung", bevor sie entsteht. Den Zaehler bei null auszublenden waere
     genau die Auslassung, die den Nutzer einen Monat lang raten liess. */
  const rd = app.slice(app.indexOf('function renderDock(r, s){'), app.indexOf('function historyBand('));
  assert.match(rd, /stockLevel\(x\) === 3/, 'NK101b: der Aktien-Zaehler muss die echte Freigabestufe zaehlen');
  assert.match(rd, /buyReady\(x\)/, 'NK101b: … und der Coin-Zaehler die echte Freigabe');
  assert.ok(!/if\s*\(\s*n[AC]\s*\)\s*reco\.innerHTML/.test(rd),
    'NK101b: der Zaehler darf bei null nicht ausgeblendet werden — die Null ist die Antwort');
  assert.match(rd, /KEINE Aktie mit Kauf-Freigabe\. Das ist ein Ergebnis, kein Fehler/,
    'NK101b: … und die Null muss als Ergebnis erklaert sein');

  /* ── NK101c · Planwerte ohne Freigabe werden gedaempft ────────────────
     Fett gesetzte Zahlen neben einem Knopf „Plan" lesen sich als Aufforderung,
     egal was danebensteht. */
  assert.match(css, /\.dock:not\(\.dock-buy\) #dplan\{opacity:/,
    'NK101c: ohne Freigabe muessen die Planwerte optisch zuruecktreten');
  assert.match(html, /id="dstate"/, 'NK101c: das Zustandswort braucht seinen Platz im HTML');
  assert.ok(html.indexOf('id="dstate"') < html.indexOf('id="dsym"'),
    'NK101c: der Zustand steht VOR dem Titel — er ist die Bedingung, nicht die Fussnote');

  /* ── NK101d · Das Lab traegt seine Rolle sichtbar ─────────────────────
     Im Lab steht Auswertung, im Handelsbereich Entscheidung. Gleiches
     Aussehen suggeriert gleiches Gewicht. */
  assert.match(css, /\.labzone::before\{content:"AUSWERTUNG/,
    'NK101d: die Lab-Zone muss sich selbst als Auswertung ausweisen');
  assert.match(css, /0 % Gewicht in Score, Ampel und Freigabe/,
    'NK101d: … einschliesslich der Zusage, dass dort nichts entschieden wird');
}

console.log('✓ FusionPulse v4.21.0 NK101 Fussleiste und Lab-Abgrenzung: OK');

/* ═══ v4.22.0 · NK102 · MODELLVERGLEICH BEI COINS, KLARTEXT, KNOPF ════════
   Drei Nutzerbefunde am 15.09.:
     „warum ist im Skopefenster der Coins nicht der Aladin, ChatGPT Strang
      angefuehrt"
     „Modul A sollte auch korrekt benannt werden und alle 3 brauchen eine gute
      Laienerklaerung beim Mouseover"
     „auch sollte man einen Update Button bei den Rubriken haben" */
{
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

  /* ── NK102a · Der Vergleich steht in BEIDEN Fokusfenstern ─────────────
     Dieselbe Luecke wie bei `heatSeparate` in v4.9.0: eine Verbesserung, die
     nur eine von zwei Karten erreicht hat. `analyse()` rechnet fuer Coins
     dieselben drei Straenge, sie lagen nur ungenutzt an der Zeile. */
  const treffer = [...app.matchAll(/\$\{modelCompare\(/g)].length;
  assert.ok(treffer >= 2,
    `NK102a: der Modellvergleich muss in BEIDEN Fokusfenstern stehen, gefunden ${treffer}x`);
  const coinFokus = app.slice(app.indexOf('function renderFocus() {'), app.indexOf("$('#fcopy').onclick"));
  assert.match(coinFokus, /\$\{modelCompare\(r\)\}/,
    'NK102a: … ausdruecklich auch im Coin-Fokusfenster');

  /* ── NK102b · Jedes Modell erklaert sich in Alltagssprache ────────────
     „EV-Gate", „Range-Projektion", „Overextended-Malus" sind Jargon fuer
     Leute, die den Code kennen. Wer die drei Urteile nicht abwaegen kann,
     nimmt am Ende einfach das erste. */
  const lab = app.slice(app.indexOf('const MODEL_LABEL={'), app.indexOf('const MODEL_VERDICT='));
  for (const k of ['claude', 'fusion', 'momentum']) {
    const teil = lab.slice(lab.indexOf(`${k}:{`), lab.indexOf('},', lab.indexOf(`${k}:{`)));
    assert.match(teil, /plain:/, `NK102b: „${k}" braucht eine Laienerklaerung`);
    const pl = (teil.match(/plain:'([^']*)'/) || [])[1] || '';
    assert.ok(pl.length > 150, `NK102b: die Erklaerung zu „${k}" ist zu duenn (${pl.length} Zeichen)`);
    for (const jargon of ['EV-Gate', 'Range-Projektion', 'Malus']) {
      assert.ok(!pl.includes(jargon),
        `NK102b: „${jargon}" gehoert nicht in die LAIEN-Erklaerung von „${k}"`);
    }
  }
  /* KORREKTUR innerhalb derselben Version. Hier stand zuerst: „Modus A" sei
     eine interne Bezeichnung und gehoere nicht in die Oberflaeche. Das war
     falsch, und zwar nachpruefbar: das Glossar fuehrt seit v3.14.0 einen
     Eintrag `tradeModeA`, der dem Nutzer woertlich „Modus A · Momentum-
     Tageshandel" erklaert, und die Fokuskachel schreibt „Regelwerk Modus A".
     Der Begriff war also laengst sichtbar — nur der Modellvergleich benutzte
     ihn NICHT und nannte denselben Strang „Momentum (Tageshandel)".
     Zwei Namen fuer dieselbe Sache, und der Nutzer musste sie selbst
     zusammenbringen. Genau darauf zielte seine Meldung: „Modul A sollte auch
     korrekt benannt werden." Ein einheitlicher Name ist keine Offenlegung von
     Interna, sondern die Abwesenheit einer zweiten Wahrheit. */
  assert.match(lab, /name:'Modus A · Momentum'/,
    'NK102b: der Strang muss ueberall denselben Namen tragen wie im Regelwerk');
  assert.ok(/tradeModeA:/.test(app),
    'NK102b: … und der Glossareintrag dazu muss weiterhin existieren, sonst steht der Name ohne Erklaerung da');
  assert.match(app, /const tip=\[L\.name, '', L\.plain/,
    'NK102b: im Mouseover steht die Laienerklaerung VOR der Technik');

  /* ── NK102c · Der Knopf holt nichts Zusaetzliches ─────────────────────
     Ein Aktualisieren-Knopf ohne Sperre waere bei 40 GB Monatskontingent ein
     Bandbreitenloch. Er stoesst den NORMALEN Abruf an, nichts weiter. */
  assert.match(app, /if\(Date\.now\(\)<refreshBusyUntil\) return;/,
    'NK102c: ohne Doppelklickschutz wird der Knopf zum Bandbreitenloch');
  assert.match(app, /scope==='coin' \? \(\) => scan\(true\)/,
    'NK102c: jede Rubrik muss ihren eigenen Abruf anstossen');
  assert.match(app, /document\.addEventListener\('click'/,
    'NK102c: ein Handler auf dem Dokument — die Kacheln werden staendig neu gezeichnet');
  assert.match(css, /\.fresh-refresh\{/, 'NK102c: der Knopf braucht seine Gestaltung');
  assert.match(app, /keine Extradaten, keine umgangene Sperre/,
    'NK102c: der Mouseover muss sagen, dass der Knopf keine Sperre umgeht');
}

console.log('✓ FusionPulse v4.22.0 NK102 Modellvergleich, Klartext und Aktualisieren: OK');

/* ── NK102e · Was es bei Coins NICHT gibt, wird auch nicht behauptet ──────
   Der Server liefert fuer Coins nur `claude` als Modellobjekt; `fusion` fehlt
   dort ganz und `momentum` ist eine ZAHL, kein Modell. Die Zellen erscheinen
   deshalb als „nicht berechnet". Das ist die ehrliche Anzeige — die Straenge
   existieren fuer Coins nicht, sie sind nicht ausgefallen. Sie zu erfinden
   waere eine Modellaenderung, keine Anzeigekorrektur. */
{
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const mc = app.slice(app.indexOf('function modelCompare(r){'), app.indexOf('const TINTABLE_TILES='));
  assert.match(mc, /if\(!m\|\|!m\.light\) return/,
    'NK102e: ein fehlendes Modell MUSS abgefangen werden, sonst rechnet die Anzeige mit einer Zahl als waere sie eine Ampel');
  assert.match(mc, /nicht berechnet/,
    'NK102e: … und als „nicht berechnet" ausgewiesen werden, nicht als rot');
  assert.match(app, /name:'Modus A · Momentum'/,
    'NK102e: der Strang heisst im Regelwerk „Modus A" — der Modellvergleich muss denselben Namen tragen');
}

console.log('✓ FusionPulse v4.22.0 NK102e Coin-Modelle ehrlich ausgewiesen: OK');

/* ═══ v4.23.0 · NK103 · HOCHRISIKO MIT GETRENNTEM KAPITAL ══════════════════
   Nutzer: „kreative Empfehlungen, die ein hohes Gewinn aber auch Verlustrisiko
   haben und auch als solche gekennzeichnet sind (der moegliche finanzielle
   Verlust ist mir bewusst und wird auch akzeptiert)." Und zur Groesse:
   „Startrisiko durchaus 5-10 % moeglich (das ist ja das Spielkapital)."

   Die Gefahr dieser Version ist nicht das Risiko — das ist ausdruecklich
   gewollt. Die Gefahr ist, dass die Kategorie sich in die regulaeren
   Freigaben mischt oder still am Hauptkapital zieht. */
{
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

  /* ── NK103a · Zwei Felder, nicht eines ────────────────────────────────
     „10 %" ist zweideutig: vom Hauptkapital waeren es 500 € je Trade, vom
     Spielkapital 50 €. Faktor zehn. Der getrennte Topf loest das, OHNE dass
     jemand meine Auslegung uebernehmen muss — wer 10 % vom Hauptkapital will,
     traegt dort 5000 ein. */
  assert.match(app, /hrEnabled: true, hrEquity: 500, hrRiskPct: 10/,
    'NK103a: Spielkapital und Prozentsatz muessen getrennte, freie Felder sein');
  const rf = app.slice(app.indexOf('function hrRiskEur(){'), app.indexOf('function hrSize(r){'));
  assert.ok(!/S\.equity|S\.riskPct/.test(rf),
    'NK103a: das Hochrisiko-Budget darf NIEMALS am Hauptkapital haengen — sonst zieht es still am Depot');

  /* ── NK103b · Groesse folgt aus dem Stop, nicht umgekehrt ─────────────
     Ein Setup mit 25 % Stopweite bei voller Kaufsumme ist kein Hochrisiko-
     Trade, sondern ein Totalschaden mit Extraschritten. */
  const sz = app.slice(app.indexOf('function hrSize(r){'), app.indexOf('function hrCandidates('));
  assert.match(sz, /Math\.floor\(budget \/ risikoJeStueck\)/,
    'NK103b: die Stueckzahl muss aus Risikobudget und Stopabstand folgen');
  assert.match(sz, /tooSmall:true/,
    'NK103b: passt nicht einmal ein Stueck, muss das gesagt werden statt aufgerundet');

  /* ── NK103c · Niemals in derselben Liste wie eine Freigabe ────────────
     Die eine Zusage, die diese Kategorie traegt. */
  const hc = app.slice(app.indexOf('function hrCandidates(list){'), app.indexOf('function renderHighRisk(){'));
  assert.match(hc, /if \(stockLevel\(r\) === 3\) return false;/,
    'NK103c: ein regulaer freigegebener Titel darf hier NICHT zusaetzlich auftauchen');
  assert.match(hc, /sh\.light !== 'green'\) return false/,
    'NK103c: ohne positiven Erwartungswert des Schattentors kein Kandidat');
  const rh = app.slice(app.indexOf('function renderHighRisk(){'), app.indexOf('\nfunction renderWatchMoves('));
  assert.match(rh, /keine<\/b> Kauf-Freigaben/,
    'NK103d: die Kachel muss ausdruecklich sagen, dass sie keine Freigaben zeigt');
  assert.match(rh, /kann dann GRÖSSER als/,
    'NK103d: die Gap-Mechanik gehoert genannt — der Stop haelt ueber Nacht nicht');
  assert.match(rh, /nicht geprüft/,
    'NK103d: … und dass die Kategorie noch unbelegt ist');

  /* ── NK103e · Eigene Farbe, und zwar keine Ampelfarbe ─────────────────
     Gruen, gelb und rot sind die Ampel. Eine Hochrisiko-Karte in Gruen waere
     genau die Verwechslung, die diese Kategorie verbietet. */
  assert.match(css, /\.hr-card\{/, 'NK103e: die Karten brauchen eigene Gestaltung');
  const hrCss = css.slice(css.indexOf('.hrpanel{'), css.indexOf('.hr-card em{'));
  assert.ok(!/var\(--green\)|var\(--yellow\)/.test(hrCss),
    'NK103e: Hochrisiko darf KEINE Ampelfarbe tragen');
}

console.log('✓ FusionPulse v4.23.0 NK103 Hochrisiko-Kategorie: OK');

/* ═══ v4.23.0 · NK104 · „+4,1 % TAG" WAR VON GESTERN ═══════════════════════
   BEFUND vom 15.09., 09:07 ET (Vorboerse): der Radar zeigte NFLX mit
   „+4,1 % Tag" unter der Ueberschrift „Bewegung WAEHREND der Handelszeit".
   Google Finance sagte im selben Moment „Geschlossen: 14. Sept." und
   Vorboerse −0,87 %. Nutzer: „was bringt mir die Info dieser alten Bewegung
   ueberhaupt?"
   Nichts. Sie ist nicht nur nutzlos, sondern irrefuehrend, weil die Plakette
   „AKTUALISIERT · vor 1 Min." danebensteht — die gilt fuer den ABRUF. */
{
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

  /* ── NK104a · Drei Zustaende, nicht zwei ──────────────────────────────
     „nicht entscheidbar" ist ein eigener Fall. Ihn als „alt" zu behandeln
     waere genauso falsch wie ihn als „heute" durchzulassen. */
  const ma = app.slice(app.indexOf('function moveAge(r){'), app.indexOf('function renderHighRisk(){'));
  assert.ok(ma.length > 400, 'NK104a: moveAge muss gefunden werden');
  assert.match(ma, /currentSession === true/, 'NK104a: der Frisch-Fall muss explizit geprueft werden');
  assert.match(ma, /currentSession === false/, 'NK104a: … der Alt-Fall ebenso');
  assert.match(ma, /Alter unbekannt/,
    'NK104a: und der dritte Fall — nicht entscheidbar — darf weder als heute noch als alt ausgegeben werden');
  assert.ok(!/currentSession\)/.test(ma.replace(/currentSession === (true|false)/g, '')),
    'NK104a: keine Wahrheitspruefung auf currentSession — null wuerde sonst still zu „alt" werden');

  /* ── NK104b · Die Zahl wird umbenannt, nicht versteckt ────────────────
     Ein Titel, der gestern 4 % gemacht hat, ist eine echte Beobachtung. Er ist
     nur keine Tagesbewegung. Verwerfen waere wieder eine stille Auslassung. */
  assert.match(app, /\$\{ma\.alt\?'\(Vortag\)':'Tag'\}/,
    'NK104b: eine alte Bewegung muss als Vortag beschriftet werden');
  assert.match(ma, /misst die Bewegung des Vortags/,
    'NK104b: … und im Mouseover erklaert sein');
  assert.ok(!/filter\(.*currentSession/.test(app),
    'NK104b: alte Bewegungen duerfen nicht herausgefiltert werden');

  /* ── NK104c · Keine Richtungsfarbe fuer eine Nicht-Tagesbewegung ──────
     Gruen/rot sagen „heute rauf/runter". Genau das ist die Aussage, die hier
     nicht zutrifft. */
  const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.trend-pct\.stale-move\{color:var\(--dim\)/,
    'NK104c: eine Bewegung von gestern darf nicht gruen oder rot erscheinen');

  /* ── NK104d · Der Server muss das Alter ueberhaupt liefern ────────────── */
  assert.match(worker, /const tradeTs=Date\.parse\(/, 'NK104d: der Zeitstempel des letzten Trades muss gelesen werden');
  assert.match(worker, /tradeTs:Number\.isFinite\(tradeTs\)\?tradeTs:null, currentSession:ausSitzung/,
    'NK104d: … und mit der Zeile ausgeliefert werden');
  assert.match(worker, /: null;\s*\/\/ null = nicht entscheidbar/,
    'NK104d: fehlt der Zeitstempel, ist das Ergebnis null — nicht false');
}

console.log('✓ FusionPulse v4.23.0 NK104 Vortagsbewegung im Radar: OK');

/* ═══ v4.23.1 · NK105 · EINE ZAHL, DIE MAN NICHT AENDERN KANN ══════════════
   Nutzer nach dem Deploy von 4.23.0: „wo ist da ein Regler". Zu Recht: die
   Kachel zeigte „€ 500 Topf · 10,0 %", aber es gab keine Eingabefelder dazu.
   Ich hatte die Werte als Voreinstellung gesetzt und den Dialog vergessen.
   Eine angezeigte Zahl ohne Bedienelement ist schlechter als gar keine — sie
   sieht aus wie eine Entscheidung des Nutzers und ist keine. */
{
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

  /* ── NK105a · Jeder angezeigte Wert hat ein Feld ──────────────────────── */
  for (const id of ['sHrOn', 'sHrEquity', 'sHrRisk']) {
    assert.ok(html.includes(`id="${id}"`), `NK105a: das Feld ${id} fehlt im Einstellungsdialog`);
    assert.ok(app.includes(`$('#${id}')`), `NK105a: ${id} wird nirgends gelesen`);
  }

  /* ── NK105b · Eine bewusste 0 darf nicht zurueckspringen ──────────────
     `+wert || DEFAULT` ist der uebliche Kurzschluss — und er macht aus „ich
     will hier nichts riskieren" still wieder die Vorgabe. Der Nutzer traegt 0
     ein, speichert, und die App rechnet weiter mit 10 %. */
  const save = app.slice(app.indexOf("if ($('#sHrOn')) S.hrEnabled"), app.indexOf("S.equity = +$('#sEquity').value"));
  assert.match(save, /Number\.isFinite\(te\) && te >= 0 \? te : DEFAULTS\.hrEquity/,
    'NK105b: eine eingetragene 0 beim Topf muss erhalten bleiben');
  assert.match(save, /Number\.isFinite\(tr\) && tr >= 0 \? Math\.min\(100, tr\)/,
    'NK105b: … und beim Prozentsatz ebenso, mit Deckel bei 100');
  assert.ok(!/S\.hrEquity = \+\$\('#sHrEquity'\)\.value \|\| /.test(app),
    'NK105b: kein `|| DEFAULT`-Kurzschluss auf diesen Feldern');

  /* ── NK105c · Die Folge der Eingabe steht sofort darunter ─────────────
     Sonst sieht der Nutzer die Konsequenz erst nach dem Speichern — also
     genau dann nicht, wenn er sie zum Abwaegen braucht. */
  const hint = app.slice(app.indexOf('function renderHrHint(){'), app.indexOf('function hrRiskEur(){'));
  assert.match(hint, /Risiko je Signal/, 'NK105c: der Hinweis muss den Eurobetrag je Signal nennen');
  assert.match(hint, /Sieben Fehlschläge in Folge/,
    'NK105c: … und die Folge mehrerer Fehlschlaege, weil sie aus den Eingaben zwingend folgt');
  assert.match(hint, /Konto-Equity bleibt davon unberührt/,
    'NK105c: … und dass der Topf das Hauptkapital nicht beruehrt');
  assert.match(app, /f\.addEventListener\('input', renderHrHint\)/,
    'NK105c: der Hinweis muss live mitrechnen, nicht erst beim Speichern');
}

console.log('✓ FusionPulse v4.23.1 NK105 Hochrisiko-Regler: OK');
