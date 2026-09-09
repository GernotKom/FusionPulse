/* ══════ v4.9.0 · Suite 67 · NK88 — HEATMAP: REGLER UND BESCHRIFTUNG ═════════
   ANLASS (Screenshot 09.09., 19:48): „bei den Heatmaps sind die Aktien/Coins
   zumeist unuebersichtlich, weil alle Punkte uebereinander liegen und somit
   die Differenzierung von unattraktiven zu beobachtbaren kaum moeglich ist."

   Zwei Ursachen, die zufaellig gleich aussehen:

     A  Es wird alles gezeigt. Drei Regler nach der Stufe, die die App ohnehin
        berechnet, teilen die Karte in handeln / beobachten / uebrige.
     B  Die Aktien-Karte trennte nach dem KREIS (`radA+radB+3`) und druckte
        JEDER Zeile den Namen auf. Die Rechteck-Trennung und die Vergaberegel
        aus 4.2.4 hat nur die COIN-Karte je bekommen. Im Screenshot liegen
        „REGN", „FCX" und „LUMN" deshalb vollstaendig uebereinander.

   B ist der eigentliche Befund: eine Reparatur, die nur einen von zwei
   Ausgabepfaden erreicht hat — nach 4.1.6, 4.4.1 und 4.5.x der vierte Fall.
   Diese Suite prueft deshalb BEIDE Karten gegen DIESELBE Funktion. */
import assert from 'node:assert/strict';
import { loadClient } from './client-harness.mjs';

const C = loadClient();

/* Zeilen wie im Screenshot: dicht beieinander, hohe Musterqualitaet,
   mittelmaessige Handelbarkeit — genau die Wolke, die unlesbar war. */
function wolke(n) {
  const namen = ['ABSI','EDIT','CRSP','INTC','RGTI','REGN','FCX','LUMN','UTHR','AMZN',
    'MO','IONQ','SPCX','MRNA','VEEV','AG','AEM','NVDA','ELL','OXY','ALAB','VXX','ZI','MRVL'];
  return namen.slice(0, n).map((s, i) => ({
    symbol: s, pair: s + '-EUR',
    score: 7 + ((i * 37) % 15) / 10,        // 7,0 bis 8,4
    quality: 7 + ((i * 37) % 15) / 10,
    executability: 4.5 + ((i * 53) % 12) / 10,
  }));
}
const punkte = (rows, g = (x) => 14 + (Math.max(0, Math.min(10, x)) / 10) * 172) =>
  rows.map((r) => ({ r, x: g(r.executability), y: 200 - g(r.score), rad: 5 + Math.max(0, (r.score - 5) * .7) }));
/** Zaehlt sich ueberdeckende BESCHRIFTUNGEN, nicht Kreise. */
const ueberdeckungen = (pts) => {
  let n = 0;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    const a = pts[i], b = pts[j];
    if ((a.halfW + b.halfW) - Math.abs(b.x - a.x) > 0 && (a.halfH + b.halfH) - Math.abs(b.y - a.y) > 0) n++;
  }
  return n;
};

/* ═══ NK88a · Der Eimer folgt der FARBE DES PUNKTES ══════════════════════
   BEFUND aus dem Betrieb (09.09., 20:29): RGTI stand in der Karte als
   „Beobachten", die Heatmap zeigte bei eingeschaltetem Regler „beobachten"
   aber `0 von 20`. Erst „übrige" brachte alle 20 Punkte zurück. Auf der
   Coin-Seite dasselbe.

   URSACHE, und sie ist ein Namensfehler: die erste Fassung sortierte nach
   `stockLevel` (0–3). Stufe 2 verlangt dort `light === 'green'`; an diesem
   Nachmittag war KEINE Zeile gruen (Kopfzeile 0/2/18). Alles fiel damit in
   „übrige", auch die zwei gelben. Gleichzeitig nennt die App an drei anderen
   Stellen — `COUNT_LABEL`, `MODEL_VERDICT` und die Kopfzeile der Fokuskarte —
   genau diese gelben Zeilen „Beobachten".

   Zwei verschiedene Dinge, ein Wort. Dieselbe Krankheit wie „Reife" in 4.1.5,
   die dort Sortierschluessel UND Bestaetigungs-Streak hiess.

   Der Eimer folgt jetzt derselben Funktion, die den Punkt EINFAERBT. Damit
   kann kein gelber Punkt mehr ausserhalb von „beobachten" liegen. */
{
  const H = C.stockHeadline;
  const gruen = { symbol: 'X', light: 'green', verdict: 'v' };
  const gelb = { symbol: 'RGTI', light: 'yellow', score: 5.9, executability: 4.1, verdict: 'Beobachten' };
  const rot = { symbol: 'Z', light: 'red', verdict: 'v' };

  /* Der gemeldete Fall selbst, als Zusicherung: was die Karte „Beobachten"
     nennt, muss unter „beobachten" liegen. */
  assert.equal(H(gelb).text, 'Beobachten', 'NK88a: Vorbedingung — die Kopfzeile nennt RGTI „Beobachten"');
  assert.equal(C.heatBucketOf(gelb, H), 'watch',
    'NK88a: genau der gemeldete Fehler — die Karte sagt „Beobachten", der Regler sortiert woanders hin');

  /* Und die allgemeine Fassung: der Eimer ist IMMER die Punktfarbe. Eine
     Stichprobe ueber alle drei Ampeln, gerechnet mit derselben Funktion, die
     `stockHeatmapMark` fuer die Farbe benutzt. */
  for (const r of [gruen, gelb, rot]) {
    const farbe = H(r).light;
    const erwartet = farbe === 'green' ? 'trade' : farbe === 'yellow' ? 'watch' : 'rest';
    assert.equal(C.heatBucketOf(r, H), erwartet,
      `NK88a: ${r.symbol} wird ${farbe} gezeichnet und muss deshalb in „${erwartet}" liegen`);
  }
  /* Ein gruenes Muster OHNE Freigabe wird gelb gezeichnet — es gehoert dann
     auch unter „beobachten" und nicht unter „handeln". Sonst waere der Regler
     wieder etwas anderes als das, was man sieht. */
  assert.equal(H(gruen).light, 'yellow', 'NK88a: Vorbedingung — gruenes Muster ohne Freigabe wird gelb gezeichnet');
  assert.equal(C.heatBucketOf(gruen, H), 'watch');
}

/* ═══ NK88b · Die Beschriftung hat EINE Quelle ═══════════════════════════
   Der Fehler oben war moeglich, weil ich fuer die Regler eigene Woerter
   erfunden habe, waehrend die App dieselben Zustaende schon benennt. Die
   Beschriftung kommt jetzt aus `COUNT_LABEL`. */
{
  assert.equal(C.HEAT_BUCKETS.length, 3, 'NK88b: es sind genau drei Regler bestellt');
  assert.equal(new Set(C.HEAT_BUCKETS.map((b) => b.flag)).size, 3,
    'NK88b: zwei Regler duerfen nicht auf dieselbe Einstellung zeigen');
  assert.equal(new Set(C.HEAT_BUCKETS.map((b) => b.light)).size, 3,
    'NK88b: die drei Eimer muessen ueberschneidungsfrei sein');
  for (const b of C.HEAT_BUCKETS) {
    assert.equal(C.heatBucketLabel(b), String(C.COUNT_LABEL[b.light]).toLowerCase(),
      `NK88b: die Aufschrift von „${b.key}" muss aus COUNT_LABEL kommen — ein eigenes Wort waere die dritte Bezeichnung fuer dieselbe Sache`);
  }
}

/* ═══ NK88c · Der Filter filtert — und zwar AUSGEFUEHRT ══════════════════ */
{
  const H = C.stockHeadline;
  const rows = [
    { symbol: 'A', light: 'yellow', verdict: 'v' }, { symbol: 'B', light: 'yellow', verdict: 'v' },
    { symbol: 'C', light: 'red', verdict: 'v' }, { symbol: 'D', light: 'red', verdict: 'v' },
  ];
  const setze = (t, w, re) => { C.S.heatTrade = t; C.S.heatWatch = w; C.S.heatRest = re; };

  setze(true, true, true);
  assert.equal(C.heatFilter(rows, H).length, 4, 'NK88c: alle drei an muss der bisherige Zustand sein');
  setze(false, true, false);
  assert.equal(C.heatFilter(rows, H).map((r) => r.symbol).join(''), 'AB',
    'NK88c: der gemeldete Fall — „beobachten" allein muss die gelben Titel zeigen, nicht nichts');
  setze(false, false, true);
  assert.equal(C.heatFilter(rows, H).map((r) => r.symbol).join(''), 'CD');
  setze(true, true, false);
  assert.equal(C.heatFilter(rows, H).length, 2,
    'NK88c: „Rest" aus ist der Griff, der die Karte am staerksten aufraeumt');

  /* Die eigentliche Zusicherung: der Regler aendert die ANZEIGE, sonst nichts. */
  const vorher = JSON.stringify(rows);
  setze(false, false, false);
  C.heatFilter(rows, H);
  assert.equal(JSON.stringify(rows), vorher,
    'NK88c: der Filter darf die Zeilenliste nicht anfassen — die Trefferliste unter der Karte haengt daran');
  assert.equal(rows.map((r) => H(r).light).join(','), 'yellow,yellow,red,red',
    'NK88c: … und die Bewertung erst recht nicht. Ein Anzeigefilter, der bewertet, waere eine stille Regelaenderung');
}

/* ═══ NK88d · Eine leere Karte nennt den RICHTIGEN Grund ═════════════════
   Im Screenshot vom 09.09. stand „0 von 20 — alle Regler aus", WAEHREND
   „beobachten" eingeschaltet war. Der Text war schlicht falsch und hat die
   Fehlersuche in die verkehrte Richtung geschickt. „Alle Regler aus" und
   „kein Titel in der gewaehlten Auswahl" sind zwei Zustaende. */
{
  C.S.heatTrade = false; C.S.heatWatch = true; C.S.heatRest = false;
  const t1 = C.heatCountLabel(0, 20);
  assert.match(t1, /0 von 20/, 'NK88d: die Zahl gehoert dazu');
  assert.ok(!/alle Regler aus/.test(t1),
    `NK88d: bei eingeschaltetem Regler darf dort nicht „alle Regler aus" stehen — genau das stand im Screenshot (${t1})`);
  assert.match(t1, /beobachten/, 'NK88d: … stattdessen muss die aktive Auswahl benannt werden');

  C.S.heatTrade = false; C.S.heatWatch = false; C.S.heatRest = false;
  assert.match(C.heatCountLabel(0, 20), /alle Regler aus/,
    'NK88d: und wenn wirklich alle aus sind, muss genau das dastehen');

  assert.equal(C.heatCountLabel(0, 0), 'keine Daten',
    'NK88d: „keine Daten" und „alles weggefiltert" duerfen nicht gleich aussehen');
  assert.equal(C.heatCountLabel(7, 20), '7 von 20');
  C.S.heatTrade = true; C.S.heatWatch = true; C.S.heatRest = true;
}

/* ═══ NK88e2 · Eine fehlende Einstellung zeigt AN ════════════════════════ */
{
  delete C.S.heatTrade; delete C.S.heatWatch; delete C.S.heatRest;
  assert.equal(C.heatBucketOn('trade'), true);
  assert.equal(C.heatBucketOn('watch'), true);
  assert.equal(C.heatBucketOn('rest'), true);
  assert.equal(C.heatBucketOn('gibtsnicht'), true, 'NK88e2: ein unbekannter Eimer darf nichts ausblenden');
  C.S.heatTrade = true; C.S.heatWatch = true; C.S.heatRest = true;
}

/* ═══ NK88e · Die gemeinsame Trennung schlaegt die alte Kreisregel ════════
   Gerechnet auf der Wolke aus dem Screenshot. Verglichen werden BESCHRIFTUNGS-
   ueberdeckungen, nicht Kreisabstaende — die Kreise waren nie das Problem. */
{
  const alt = punkte(wolke(20));
  // die Fassung bis 4.8.0: Trennung nach dem Kreis
  for (let it = 0; it < 15; it++) for (let i = 0; i < alt.length; i++) for (let j = i + 1; j < alt.length; j++) {
    const a = alt[i], b = alt[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || .1, m = a.rad + b.rad + 3;
    if (d < m) { const q = (m - d) * .16, ux = dx / d, uy = dy / d; a.x -= ux * q; a.y -= uy * q; b.x += ux * q; b.y += uy * q; }
  }
  // Rechteckmasse fuer den VERGLEICH nachtraeglich anlegen, ohne zu verschieben
  const neu = punkte(wolke(20));
  C.heatSeparate(neu, {
    charsOf: (p) => p.r.symbol.length,
    rankOf: () => 3,
    tieOf: (p) => p.r.score,
  });
  for (const p of alt) { const q = neu.find((x) => x.r.symbol === p.r.symbol); p.halfW = q.halfW; p.halfH = q.halfH; }

  const uAlt = ueberdeckungen(alt), uNeu = ueberdeckungen(neu);
  assert.ok(uNeu < uAlt,
    `NK88e: die gemeinsame Trennung muss weniger Beschriftungs-Ueberdeckungen erzeugen (alt ${uAlt}, neu ${uNeu})`);

  /* Und die ganze Zusage leistet die Vergaberegel: unter den GESETZTEN
     Aufschriften ueberdeckt sich keine einzige. */
  const gesetzt = neu.filter((p) => p.label);
  assert.equal(ueberdeckungen(gesetzt), 0,
    'NK88e: unter den gesetzten Aufschriften darf sich keine ueberdecken');
  assert.ok(gesetzt.length < neu.length,
    'NK88e: … und es bleiben nachweislich Punkte ohne Aufschrift, sonst waere die Vergaberegel wirkungslos');
  assert.ok(gesetzt.length >= 3,
    `NK88e: bei 20 Punkten duerfen nicht fast alle Namen entfallen (gesetzt: ${gesetzt.length})`);
}

/* ═══ NK88f · Rang 0 bekommt seinen Namen IMMER ══════════════════════════
   Die Zusage an den Nutzer: der ausgewaehlte Titel ist auf der Karte immer
   beschriftet, egal wie dicht es dort ist. */
{
  const pts = punkte(wolke(20));
  C.heatSeparate(pts, {
    charsOf: (p) => p.r.symbol.length,
    rankOf: (p) => (p.r.symbol === 'LUMN' ? 0 : 3),
    tieOf: (p) => p.r.score,
  });
  const l = pts.find((p) => p.r.symbol === 'LUMN');
  assert.equal(l.label, true,
    'NK88f: der ausgewaehlte Titel muss seinen Namen behalten — sonst sucht man ihn genau dann, wenn es eng wird');
}

/* ═══ NK88g · Die Punkte bleiben im Bild ═════════════════════════════════
   Ein Punkt, den die Trennung aus dem Sichtfeld schiebt, ist schlimmer als
   ein ueberdeckter Name: er ist weg und sagt es nicht. */
{
  const pts = punkte(wolke(24));
  C.heatSeparate(pts, { charsOf: (p) => p.r.symbol.length, rankOf: () => 3 });
  for (const p of pts) {
    assert.ok(p.x >= 10 && p.x <= 190 && p.y >= 10 && p.y <= 190,
      `NK88g: ${p.r.symbol} liegt bei ${p.x.toFixed(1)}/${p.y.toFixed(1)} ausserhalb des Feldes`);
  }
}

/* ═══ NK88h · Die Regler stehen auf BEIDEN Karten und teilen den Zustand ══
   Zwei getrennte Reglersaetze waeren die naechste Stelle, an der die Bereiche
   auseinanderlaufen — genau das Muster, das 4.2.5 bis 4.2.8 dreimal
   zurueckgeholt hat. */
{
  const fs = await import('node:fs');
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  for (const seite of ['coin', 'stock']) {
    const i = html.indexOf(`data-heatside="${seite}"`);
    assert.ok(i > 0, `NK88h: der Reglersatz der ${seite}-Karte fehlt`);
    const block = html.slice(i, html.indexOf('</div>', i));
    for (const k of ['trade', 'watch', 'rest']) {
      assert.ok(block.includes(`data-heat="${k}"`), `NK88h: Regler „${k}\" fehlt auf der ${seite}-Karte`);
    }
  }
  assert.ok(html.includes('id="coinMapCount"') && html.includes('id="stockMapCount"'),
    'NK88h: beide Karten brauchen ihre eigene Zaehlanzeige');
  /* Der Zustand liegt in den Einstellungen, nicht am Element: ein Umschalten
     auf der einen Karte muss auf der anderen gelten. Ausgefuehrt geprueft. */
  C.S.heatRest = false;
  C.syncHeatFilterUI();
  assert.equal(C.heatBucketOn('rest'), false);
  C.S.heatRest = true;
}

console.log('✓ FusionPulse v4.9.0 NK88 Heatmap-Regler und Beschriftung (ausgefuehrt): OK');
