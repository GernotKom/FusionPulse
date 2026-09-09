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

/* ═══ NK88a · Die drei Eimer sind vollstaendig und ueberschneidungsfrei ════
   Ueberlappende Schalter waeren der Anfang der naechsten Zweitwahrheit. Jede
   Stufe 0..3 muss in genau einem Eimer landen, und jeder Eimer muss von genau
   einem Regler geschaltet werden. */
{
  const eimer = [0, 1, 2, 3].map((l) => C.heatBucketOf(l));
  assert.deepEqual(eimer, ['rest', 'rest', 'watch', 'trade'],
    'NK88a: die Zuordnung Stufe -> Eimer stimmt nicht');
  assert.equal(C.HEAT_BUCKETS.length, 3, 'NK88a: es sind genau drei Regler bestellt');
  /* Vergleich ueber `join`, nicht `deepEqual`: `HEAT_BUCKETS` stammt aus dem
     vm-Kontext des Pruefstands und traegt dessen Array-Prototyp. `deepStrictEqual`
     faellt dann trotz gleichem Inhalt — ein Test, der aus dem falschen Grund
     faellt, ist kein Test. */
  assert.equal(C.HEAT_BUCKETS.map((b) => b.key).sort().join(','), 'rest,trade,watch');
  assert.equal(new Set(C.HEAT_BUCKETS.map((b) => b.flag)).size, 3,
    'NK88a: zwei Regler duerfen nicht auf dieselbe Einstellung zeigen');
}

/* ═══ NK88b · Der Filter filtert — und zwar AUSGEFUEHRT ═══════════════════ */
{
  const rows = [
    { symbol: 'A', lvl: 3 }, { symbol: 'B', lvl: 3 },
    { symbol: 'C', lvl: 2 }, { symbol: 'D', lvl: 2 }, { symbol: 'E', lvl: 2 },
    { symbol: 'F', lvl: 1 }, { symbol: 'G', lvl: 0 },
  ];
  const lvl = (r) => r.lvl;
  const setze = (t, w, re) => { C.S.heatTrade = t; C.S.heatWatch = w; C.S.heatRest = re; };

  setze(true, true, true);
  assert.equal(C.heatFilter(rows, lvl).length, 7, 'NK88b: alle drei an muss der bisherige Zustand sein');
  setze(true, false, false);
  assert.equal(C.heatFilter(rows, lvl).map((r) => r.symbol).join(''), 'AB');
  setze(false, true, false);
  assert.equal(C.heatFilter(rows, lvl).map((r) => r.symbol).join(''), 'CDE');
  setze(false, false, true);
  assert.equal(C.heatFilter(rows, lvl).map((r) => r.symbol).join(''), 'FG');
  setze(true, true, false);
  assert.equal(C.heatFilter(rows, lvl).length, 5,
    'NK88b: „übrige\" aus ist der Griff, der die Karte am staerksten aufraeumt');

  /* Die eigentliche Zusicherung: der Regler aendert die ANZEIGE, sonst nichts.
     Weder die uebergebene Liste noch die Stufen duerfen sich bewegen. */
  const vorher = JSON.stringify(rows);
  setze(false, false, false);
  C.heatFilter(rows, lvl);
  assert.equal(JSON.stringify(rows), vorher,
    'NK88b: der Filter darf die Zeilenliste nicht anfassen — die Trefferliste unter der Karte haengt daran');
  assert.equal(rows.map(lvl).join(','), '3,3,2,2,2,1,0',
    'NK88b: … und die Stufen erst recht nicht. Ein Anzeigefilter, der bewertet, waere eine stille Regeländerung');
}

/* ═══ NK88c · Alle Regler aus heisst SAGEN, nicht schweigen ═══════════════
   Eine leere Karte ohne Erklaerung sieht aus wie ein Fehler. Das war in 4.2.2
   schon einmal der teure Fall („die VWAP-Kachel fehlte ersatzlos"). */
{
  C.S.heatTrade = false; C.S.heatWatch = false; C.S.heatRest = false;
  const t = C.heatCountLabel(0, 24);
  assert.match(t, /0 von 24/, 'NK88c: die Zahl gehoert dazu');
  assert.match(t, /Regler/, 'NK88c: … und der GRUND, sonst sieht die leere Karte wie ein Ausfall aus');
  assert.equal(C.heatCountLabel(0, 0), 'keine Daten',
    'NK88c: „keine Daten\" und „alles weggefiltert\" duerfen nicht gleich aussehen');
  assert.equal(C.heatCountLabel(7, 24), '7 von 24');
}

/* ═══ NK88d · Eine fehlende Einstellung zeigt AN ══════════════════════════
   Ein gespeicherter Stand von vor 4.9.0 kennt die Schalter nicht. Fail-open
   ist hier richtig: ein unbekannter Zustand ist kein ausgeschalteter. Der
   umgekehrte Fall waere eine Karte, die nach dem Update leer startet. */
{
  delete C.S.heatTrade; delete C.S.heatWatch; delete C.S.heatRest;
  assert.equal(C.heatBucketOn('trade'), true);
  assert.equal(C.heatBucketOn('watch'), true);
  assert.equal(C.heatBucketOn('rest'), true);
  assert.equal(C.heatBucketOn('gibtsnicht'), true,
    'NK88d: ein unbekannter Eimer darf nichts ausblenden');
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
