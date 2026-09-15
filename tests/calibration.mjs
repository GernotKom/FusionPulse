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
