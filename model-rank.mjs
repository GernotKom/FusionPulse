/* ══════ v4.10.0 · Suite 67 · NK89 — MODELLREIHUNG ═══════════════════════════
   Diese Suite FUEHRT Modul 0c aus. Sie liest den Quelltext nicht, um zu
   pruefen, ob eine Regel dasteht — das ist in dieser Reihe elfmal schiefgegangen.

   Die vier Zusicherungen, in der Reihenfolge ihrer Wichtigkeit:

     NK89a  Ein Modell, das out-of-sample NICHT bestanden hat, darf NICHT reihen.
            Das ist die eigentliche Zusicherung. Eine Rangliste aus einem
            Zufallsmodell sieht exakt so aus wie eine aus einem echten — sie
            waere die teuerste Art, dieses Modul falsch zu bauen.
     NK89b  Ein gepflanztes Signal MUSS die Reihenfolge bestimmen.
     NK89c  Die Reihung veraendert die Eingabezeilen nicht — kein Score, keine
            Ampel, keine Freigabe. Geprueft an einer Tiefenkopie.
     NK89d  Eine Zeile ohne Merkmalsbelegung bekommt KEINEN Wert, sondern faellt
            heraus und wird gezaehlt. `Number(null) === 0`, sechster Fall.
*/
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  reihungRank, reihungBasis, reihungFeatures, reihungModellWert,
  fattrReport, ATTR, REIHUNG,
} from '../src/worker.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const T0 = Date.parse('2026-08-01T13:35:00Z');

/** Episoden mit BEKANNTER Wahrheit: `situParts.echt` treibt den Ausgang,
 *  `situParts.rausch` nicht. Die Wahrheit steht im Test, nicht in der
 *  Auswertung. */
function episoden(n, seed, { echtWirkt }) {
  const r = rng(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const echt = r(), rausch = r();
    const chance = echtWirkt ? echt * 6 - 1 + (r() - 0.5) * 2 : (r() * 6 - 1);
    out.push({
      symbol: 'SYM' + (i % 40), ts: T0 + i * 3_600_000,
      max_pct: Math.max(0, chance), min_pct: -Math.abs(r() * 2),
      light: chance >= ATTR.WIN_PCT ? 'green' : 'red',
      score: 50 + r() * 10, crv: 3.3,
      payload: JSON.stringify({ setup: i % 3 === 0 ? 'A' : 'B', situParts: { echt: echt * 100, rausch: rausch * 100 } }),
    });
  }
  return out;
}

/** Eine LEBENDE Zeile, so wie `tiingoStockSnapshot` sie liefert. Bewusst mit
 *  den Feldnamen der App, nicht mit denen der Datenbank — der Merkmalsbau
 *  muss die Uebersetzung selbst leisten, sonst leistet sie irgendwann jemand
 *  ein zweites Mal. */
function zeile(symbol, { echt, rausch = 50, score = 55, light = 'red', crv = 3.1 } = {}) {
  return {
    symbol, light, score, netCRV: crv, verdict: 'Muster unklar',
    situationType: 'Kompression', situationScore: 60,
    situParts: { echt, rausch },
    setup: 'A', preSignalMaturity: 2, prioritySector: 'Tech',
    vwapDistancePct: 0.4, relativeVwapStrengthPct: 0.2, spreadPct: 0.05,
    dollarVol: 25_000_000, phaseAction: 'regular', vwapState: 'ueber',
  };
}

/* ═══ NK89a · EIN ZUFALLSMODELL DARF NICHT REIHEN ══════════════════════════
   Reines Rauschen: der Ausgang haengt an nichts. Modul 0b muss das Modell als
   "vom Zufall nicht zu trennen" ausweisen, und die Reihung darf sich dann
   NICHT darauf stuetzen.

   EIN Startwert genuegt hier NICHT, und das ist der eigentliche Befund dieser
   Suite. Der erste Entwurf pruefte Startwert 21 und war gruen — ueber 30
   Rauschlaeufe hat dieselbe Regel in 2 Faellen ein Zufallsmodell zur
   Reihungsbasis gemacht. Ein 5-%-Test liefert in 5 % der Faelle einen Treffer;
   wer ihn an einem Startwert prueft, prueft seinen Startwert. */
{
  let modellbasis = 0;
  const N = 30;
  for (let s = 100; s < 100 + N; s++) {
    const rep = fattrReport(episoden(400, s, { echtWirkt: false }), {});
    const b = reihungBasis(rep);
    if (b.basis === 'modell') modellbasis++;
    assert.ok(b.basisText || REIHUNG.BASIS_LABEL[b.basis], 'Basis ohne Benennung');
    assert.ok(b.grund, 'Basis ohne Begruendung');
  }
  assert.equal(modellbasis, 0,
    `in ${modellbasis} von ${N} reinen Rauschlaeufen hat ein Zufallsmodell die Reihung uebernommen`);

  const rep = fattrReport(episoden(400, 122, { echtWirkt: false }), {});   // der Fall, der es aufgedeckt hat
  const out = reihungRank(rep, [zeile('AAA', { echt: 95 }), zeile('BBB', { echt: 5 }), zeile('CCC', { echt: 50 })]);
  assert.notEqual(out.basis, 'modell', 'die Rangliste nennt ein Modell als Basis, das nicht bestanden hat');
  assert.ok(out.basisText && out.grund, 'die Basis muss benannt und begruendet sein, egal welche es ist');
}

/* ═══ NK89a2 · NEGATIVKONTROLLE ZU NK89a ═══════════════════════════════════
   Ohne diese Gegenprobe koennte NK89a auch dadurch gruen sein, dass die
   Modellbasis ueberhaupt nie erreichbar ist — eine Regel, die alles abweist,
   weist auch Rauschen ab und beweist nichts. Beide Bedingungen werden einzeln
   gehoben: erst das Urteil, dann die Bestaetigung durch ein Einzelmerkmal. */
{
  const rep = fattrReport(episoden(400, 122, { echtWirkt: false }), {});
  assert.ok(rep.modell, 'ohne geschaetztes Modell sagt diese Kontrolle nichts');
  const nurUrteil = { ...rep, modell: { ...rep.modell, urteil: 'besser als die heutige Reihung' }, merkmale: rep.merkmale.map((m) => ({ ...m, urteil: 'traegt nicht' })) };
  assert.notEqual(reihungBasis(nurUrteil).basis, 'modell',
    'das Urteil allein reicht — die zweite, unabhaengige Bedingung wirkt nicht');
  const beides = { ...nurUrteil, merkmale: rep.merkmale.map((m, i) => (i === 0 ? { ...m, urteil: 'traegt', icOos: 0.31, nOos: 120, q: 0.01 } : m)) };
  assert.equal(reihungBasis(beides).basis, 'modell',
    'die Modellbasis ist unerreichbar — NK89a waere dann wertlos');
}

/* ═══ NK89b · EIN GEPFLANZTES SIGNAL MUSS DIE REIHENFOLGE BESTIMMEN ════════ */
{
  const rep = fattrReport(episoden(400, 11, { echtWirkt: true }), {});
  assert.equal(rep.state, 'ok', 'bei 400 Episoden muss ein Urteil moeglich sein');
  const b = reihungBasis(rep);
  /* Ausdruecklich `modell` und nicht `modell ODER merkmal`: sonst waere die
     Suite auch dann gruen, wenn der Modellpfad nie ausgefuehrt wird — und
     genau der ist hier zu pruefen. Ueber 30 Signallaeufe gemessen: 30/30. */
  assert.equal(b.basis, 'modell',
    `belegtes Signal, aber gereiht wird nach "${b.basis}": ${b.grund}`);

  const rows = [zeile('NIEDRIG', { echt: 5 }), zeile('HOCH', { echt: 95 }), zeile('MITTE', { echt: 50 })];
  const out = reihungRank(rep, rows);
  assert.equal(out.state, 'ok', 'die Liste ist leer, obwohl drei Zeilen bewertbar sind');
  assert.equal(out.liste.length, 3);
  assert.equal(out.liste[0].symbol, 'HOCH', `falsche Reihenfolge: ${out.liste.map((x) => x.symbol).join(' > ')}`);
  assert.equal(out.liste[2].symbol, 'NIEDRIG', `falsche Reihenfolge: ${out.liste.map((x) => x.symbol).join(' > ')}`);
  assert.ok(out.liste[0].treiber.length, 'kein Treiber genannt — eine Reihung ohne Begruendung ist ein Orakel');
  /* Umkehrprobe: dreht man das Signal in den Zeilen um, muss die Liste kippen.
     Eine Reihung, die auf beide Eingaben dasselbe antwortet, reiht nichts. */
  const gedreht = reihungRank(rep, [zeile('NIEDRIG', { echt: 95 }), zeile('HOCH', { echt: 5 })]);
  assert.equal(gedreht.liste[0].symbol, 'NIEDRIG', 'die Reihung reagiert nicht auf die Eingabe');
}

/* ═══ NK89c · DIE REIHUNG DARF DIE ZEILEN NICHT ANFASSEN ═══════════════════
   Dieselbe Zusicherung wie NK88b fuer die Heatmap-Regler: das Modul ordnet,
   es bewertet nicht um. Geprueft an einer Tiefenkopie VOR dem Aufruf. */
{
  const rep = fattrReport(episoden(400, 11, { echtWirkt: true }), {});
  const rows = [zeile('AAA', { echt: 95, light: 'red', score: 51 }), zeile('BBB', { echt: 5, light: 'yellow', score: 72 })];
  const vorher = JSON.parse(JSON.stringify(rows));
  const out = reihungRank(rep, rows);
  assert.deepEqual(rows, vorher, 'die Reihung hat die Eingabezeilen veraendert');
  /* Und die Ampel wandert nicht in den Rang: die rote Zeile darf oben stehen,
     bleibt aber rot — sonst waere die Liste eine verkappte Freigabe. */
  const aaa = out.liste.find((x) => x.symbol === 'AAA');
  assert.equal(aaa.licht, 'red', 'die Liste hat die Ampel der Zeile veraendert');
  assert.ok(/keine Kauf-Freigabe/i.test(out.hinweis), 'der Liste fehlt die Abgrenzung zur Freigabe');
}

/* ═══ NK89d · UNBELEGTE ZEILEN BEKOMMEN KEINEN WERT ════════════════════════
   Eine Zeile ohne jede Merkmalsbelegung wuerde vollstaendig aus Medianen
   gerechnet — das Ergebnis waere eine Wahrscheinlichkeit aus Unwissen. */
{
  const rep = fattrReport(episoden(400, 11, { echtWirkt: true }), {});
  const b = reihungBasis(rep);
  const leer = { symbol: 'LEER', light: 'red' };   // kein Score, keine situParts, nichts
  const out = reihungRank(rep, [zeile('GUT', { echt: 95 }), leer]);
  assert.ok(!out.liste.some((x) => x.symbol === 'LEER'),
    `die unbelegte Zeile hat einen Wert bekommen (Basis ${b.basis})`);
  assert.equal(out.ohneWert, 1, 'die uebergangene Zeile wird nicht gezaehlt — sie verschwindet still');
  assert.ok(out.ohneWertGrund, 'es fehlt der Grund, warum eine Zeile fehlt');

  /* Gegenprobe auf der Ebene darunter: fehlt dem Modell die Skala, gibt es
     gar keinen Wert statt eines gegen ein fremdes mu gerechneten. */
  if (rep.modell) {
    const ohneSd = { ...rep.modell, gewichte: rep.modell.gewichte.map((g) => ({ ...g, sd: null })) };
    assert.equal(reihungModellWert(ohneSd, reihungFeatures(zeile('X', { echt: 50 }))), null,
      'ein Modell ohne Streuung hat trotzdem gerechnet');
  }
}

/* ═══ NK89e · DER MERKMALSBAU DER LEBENDEN ZEILE IST DERSELBE ══════════════
   `reihungFeatures` muss dieselben Namen liefern, gegen die das Modell
   geschaetzt wurde. Faellt das auseinander, rechnet das Modell gegen lauter
   fehlende Werte und die Liste sieht trotzdem plausibel aus. */
{
  const rep = fattrReport(episoden(400, 11, { echtWirkt: true }), {});
  const feat = reihungFeatures(zeile('X', { echt: 42 }));
  const namen = new Set(Object.keys(feat.num));
  assert.ok(namen.has('situ.echt'), 'situParts kommen im Merkmalsbau der lebenden Zeile nicht an');
  assert.ok(namen.has('score') && namen.has('crv'), 'Score/CRV fehlen im Merkmalsbau');
  if (rep.modell) {
    const bekannt = rep.modell.gewichte.filter((g) => namen.has(g.merkmal)).length;
    assert.ok(bekannt >= Math.ceil(rep.modell.gewichte.length * 0.6),
      `nur ${bekannt} von ${rep.modell.gewichte.length} Modellmerkmalen sind an der lebenden Zeile belegbar`);
  }
}

/* ═══ NK89f · LEERE EINGABE ═══════════════════════════════════════════════
   Keine Zeilen heisst "leer" MIT Grund, nicht eine leere Liste ohne Text.
   Lehre aus 4.2.2: eine leere Flaeche ohne Erklaerung sieht aus wie ein
   Ausfall. */
{
  const out = reihungRank(fattrReport(episoden(400, 11, { echtWirkt: true }), {}), []);
  assert.equal(out.state, 'leer');
  assert.ok(out.grund, 'leere Liste ohne Grund');
  assert.equal(out.liste.length, 0);
}

/* ═══ NK89g · OHNE BERICHT FAELLT DIE REIHUNG AUF DEN SCORE ZURUECK ════════
   Der Normalzustand am ersten Tag: D1 hat noch nichts aufgeloest. Die App muss
   trotzdem eine Liste zeigen — und sie muss sie als das benennen, was sie ist. */
{
  const out = reihungRank(null, [zeile('A', { echt: 10, score: 40 }), zeile('B', { echt: 90, score: 80 })]);
  assert.equal(out.basis, 'reihung', 'ohne Bericht wird eine Lernbasis behauptet');
  assert.equal(out.liste[0].symbol, 'B', 'der Rueckfall reiht nicht nach Score');
  assert.ok(/Score/.test(out.grund), 'der Rueckfall nennt seine Basis nicht');
  assert.equal(REIHUNG.BASIS_LABEL[out.basis], out.basisText);
}

/* ═══ NK89h · DIE ANZEIGE, AUSGEFUEHRT ════════════════════════════════════
   „Korrekt berechnet, aber nicht ablesbar\" ist in diesem Projekt viermal
   passiert (Modul-0-Schalter, Fussleiste, Waechter-Spalte, Vorabend-Schicht)
   und dreimal in der Variante „berechnet, uebertragen, weggeworfen\"
   (`dropped` 4.2.3, Lesezahlen 4.3.8, `topQueries` 4.5.5). Deshalb wird der
   Renderer AUSGEFUEHRT, in derselben Version wie die Rechnung — und fuer
   BEIDE Karten, weil in 4.9.0 eine Reparatur nur eine von zweien erreicht hat. */
{
  const { loadClient } = await import('./client-harness.mjs');
  const C = loadClient();
  /* Der Harness liefert fuer JEDEN Selektor ein Stub-Element. `assert.ok(el)`
     waere hier deshalb immer wahr gewesen — ein Fehlanker derselben Bauart wie
     der in NK87m dokumentierte. Das Markup wird direkt gelesen. */
  const markup = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const rep = fattrReport(episoden(400, 11, { echtWirkt: true }), {});
  const daten = reihungRank(rep, [zeile('HOCH', { echt: 95, light: 'red' }), zeile('TIEF', { echt: 5, light: 'yellow' })]);

  for (const [sel, halter] of [['#stockRank', 'stockRangliste'], ['#coinRank', 'coinRangliste']]) {
    assert.ok(markup.includes(`id="${sel.slice(1)}"`),
      `${sel} fehlt im Markup – die Reihung waere unsichtbar, und der Renderer wuerde still nichts tun`);
    C[halter] = daten;
    C.renderReihung(sel, daten);
    const html = C.el(sel).innerHTML;
    /* NUR DER SICHTBARE TEXT. Erster Entwurf pruefte das rohe HTML — und blieb
       gruen, als die Abgrenzung aus der Zeile verschwand, weil sie AUCH im
       Tooltip steht. Genau der Fehlanker, den NK87m fuer die Kopfzeile von
       Modul 0b dokumentiert; hier zum zweiten Mal, an der Negativkontrolle
       gefunden. Was man ohne Mauszeiger liest, ist der Massstab. */
    const sichtbar = html.replace(/\s(?:title)="[^"]*"/g, '').replace(/<[^>]*>/g, ' ');
    assert.match(html, /HOCH/, `${sel}: der erste Kandidat steht nicht in der Anzeige`);
    assert.match(sichtbar, /Basis:/, `${sel}: die Basis wird nicht benannt`);
    assert.match(sichtbar, /keine Kauf-Freigabe/i, `${sel}: die Abgrenzung zur Freigabe fehlt in der SICHTBAREN Zeile`);
    /* Die Ampel der Zeile muss mitkommen. Eine Rangliste ohne Ampel liest sich
       wie eine Freigabeliste — genau der Kurzschluss, den 4.9.1 gekostet hat. */
    assert.match(sichtbar, /🔴/, `${sel}: die Ampel der Zeile fehlt`);

    // Leerzustand: MIT Grund, nie eine leere Flaeche (Lehre aus 4.2.2).
    C.renderReihung(sel, reihungRank(rep, []));
    const leer = C.el(sel).innerHTML;
    assert.match(leer, /Keine Reihung/, `${sel}: der Leerzustand wird nicht benannt`);
    assert.ok(leer.replace(/<[^>]*>/g, '').trim().length > 20, `${sel}: Leerzustand ohne Text`);

    // Noch nichts geladen: bewusst NICHTS. Ausfall und Wartezustand duerfen
    // nicht gleich aussehen.
    C.renderReihung(sel, null);
    assert.equal(C.el(sel).innerHTML, '', `${sel}: der Wartezustand sieht aus wie ein Ergebnis`);
  }
}

console.log('✓ FusionPulse v4.10.0 NK89 Modellreihung (ausgefuehrt): OK');
