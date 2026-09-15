/* ══════ v4.14.0 · Suite 71 · NK93 — MARKTKONTEXT ═══════════════════════════
   ANLASS: „Sollte man nicht einbeziehen, ob der Markt mehrere Tage
   ruecklaeufig war?\" — eine plausible Hypothese, die GEMESSEN und nicht
   geglaubt werden soll.

   NK93a  KEIN BLICK IN DIE ZUKUNFT. Die wichtigste Zusicherung dieser Suite.
   NK93b  Ein gepflanzter Rueckgang wird als solcher erkannt.
   NK93c  Die Zaehlung aufeinanderfolgender Minustage stimmt.
   NK93d  Der Kontext kommt ueber das DATUM an der Episode an.
   NK93e  Ohne Tafel entstehen die Schluessel gar nicht erst — kein stilles 0.
   NK93f  Volle Abdeckung in BEIDEN Haelften, sonst waere alles umsonst.
*/
import assert from 'node:assert/strict';
import { marktKontextAusBalken, fattrFeatures, fattrReport, MARKT_TAGE, ATTR } from '../src/worker.js';

/** Tagesbalken mit BEKANNTEM Verlauf. Die Wahrheit steht im Test. */
function balken(n, start = 100, schritt = (i) => (i % 7 < 3 ? -1 : +1)) {
  const out = []; let c = start;
  const d = new Date(Date.UTC(2026, 0, 5));   // ein Montag
  for (let i = 0; i < n; i++) {
    c = c * (1 + schritt(i) / 100);
    out.push({ date: d.toISOString().slice(0, 10), close: Math.round(c * 1e4) / 1e4 });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/* ═══ NK93a · KEIN BLICK IN DIE ZUKUNFT ═══════════════════════════════════
   Der Kontext eines Tages darf ausschliesslich aus Tagen DAVOR stammen.
   Naehme er den Schlusskurs des Tages selbst mit, saehe das Merkmal wie ein
   starker Praediktor aus — es wuerde den Ausgang mitmessen, den es erklaeren
   soll. Ein solcher Fehler faellt in KEINER Kennzahl auf; er sieht wie ein
   Erfolg aus. Deshalb steht diese Kontrolle an erster Stelle.

   Geprueft wird, indem der letzte Tag manipuliert wird: sein Kontext darf sich
   dadurch NICHT aendern. */
{
  const bs = balken(40);
  const k1 = marktKontextAusBalken(bs);
  const letzter = bs[bs.length - 1].date;
  const manipuliert = bs.map((b, i) => (i === bs.length - 1 ? { ...b, close: b.close * 5 } : b));
  const k2 = marktKontextAusBalken(manipuliert);
  assert.ok(k1[letzter], 'der letzte Tag hat gar keinen Kontext – dann prueft NK93a nichts');
  assert.deepEqual(k2[letzter], k1[letzter],
    'der Kontext eines Tages aendert sich, wenn man den Schlusskurs DIESES Tages aendert – Blick in die Zukunft');

  /* Gegenprobe: der Tag DAVOR muss sehr wohl durchschlagen, sonst waere die
     Zusicherung durch Nichtstun erfuellt. */
  const vorletzterVeraendert = bs.map((b, i) => (i === bs.length - 2 ? { ...b, close: b.close * 5 } : b));
  const k3 = marktKontextAusBalken(vorletzterVeraendert);
  assert.notDeepEqual(k3[letzter], k1[letzter],
    'der Vortag wirkt nicht auf den Kontext – die Tafel misst gar nichts');
}

/* ═══ NK93b · GEPFLANZTER RUECKGANG WIRD ERKANNT ══════════════════════════ */
{
  const fallend = marktKontextAusBalken(balken(30, 100, () => -1));
  const steigend = marktKontextAusBalken(balken(30, 100, () => +1));
  const f = Object.values(fallend).at(-1), s = Object.values(steigend).at(-1);
  assert.ok(f.tageN < -2, `fallender Markt ergibt tageN ${f.tageN} – erwartet deutlich negativ`);
  assert.ok(s.tageN > +2, `steigender Markt ergibt tageN ${s.tageN} – erwartet deutlich positiv`);
  assert.equal(MARKT_TAGE, 3, 'die Fensterbreite hat sich geaendert, ohne dass der Test es wusste');
}

/* ═══ NK93c · ZAEHLUNG AUFEINANDERFOLGENDER MINUSTAGE ═════════════════════ */
{
  const dauerMinus = marktKontextAusBalken(balken(30, 100, () => -1));
  const letzte = Object.values(dauerMinus).at(-1);
  assert.ok(letzte.folge >= 5, `bei lauter Minustagen wird folge=${letzte.folge} gezaehlt`);
  const dauerPlus = marktKontextAusBalken(balken(30, 100, () => +1));
  assert.equal(Object.values(dauerPlus).at(-1).folge, 0, 'bei lauter Plustagen wird eine Minusfolge gezaehlt');
}

/* ═══ NK93d · DER KONTEXT KOMMT AN DER EPISODE AN ═════════════════════════ */
{
  const bs = balken(40);
  const k = marktKontextAusBalken(bs);
  const tag = Object.keys(k).at(-1);
  const ts = Date.parse(tag + 'T14:00:00Z');
  const feat = fattrFeatures({ ts, score: 60, crv: 3, light: 'red', payload: '{}' }, k);
  assert.ok(Number.isFinite(feat.num['markt.tage' + MARKT_TAGE]),
    `markt.tage${MARKT_TAGE} fehlt im Merkmalsvektor – die Verknuepfung ueber das Datum greift nicht`);
  assert.ok(Number.isFinite(feat.num['markt.minusTage']), 'markt.minusTage fehlt');
}

/* ═══ NK93e · OHNE TAFEL KEIN SCHLUESSEL ══════════════════════════════════
   Ein `null` an dieser Stelle waere spaeter eine 0 — die Lehre, die dieses
   Projekt sechsmal gekostet hat. Der Schluessel darf gar nicht erst entstehen. */
{
  const ohne = fattrFeatures({ ts: Date.now(), score: 60, crv: 3, light: 'red', payload: '{}' }, null);
  for (const key of Object.keys(ohne.num)) {
    assert.ok(!key.startsWith('markt.'), `ohne Tafel entsteht der Schluessel ${key}`);
  }
  /* Und ein Datum, das die Tafel nicht kennt, darf ebenfalls nichts erzeugen. */
  const fremd = fattrFeatures({ ts: Date.parse('1999-01-04T14:00:00Z'), score: 60, crv: 3, light: 'red', payload: '{}' },
    marktKontextAusBalken(balken(40)));
  for (const key of Object.keys(fremd.num)) {
    assert.ok(!key.startsWith('markt.'), `ein unbekanntes Datum erzeugt ${key}`);
  }
}

/* ═══ NK93f · VOLLE ABDECKUNG IN BEIDEN HAELFTEN ══════════════════════════
   DER GANZE ZWECK der Datums-Verknuepfung. Wuerde der Kontext ab heute in die
   Episoden geschrieben, haette er im Lernteil 0 % Abdeckung und Modul 0b
   wuerde ihn — voellig zu Recht — als `stichtag` abweisen. Hier muss er von
   Anfang an in BEIDEN Haelften voll belegt sein. */
{
  const bs = balken(400);
  const k = marktKontextAusBalken(bs);
  const tage = Object.keys(k);
  const eps = [];
  for (let i = 0; i < 600; i++) {
    const tag = tage[Math.floor((i / 600) * tage.length)];
    const chance = ((i * 37) % 100) / 12 - 1;
    eps.push({
      symbol: 'S' + (i % 40), ts: Date.parse(tag + 'T14:00:00Z'),
      max_pct: Math.max(0, chance), min_pct: -Math.abs(((i * 13) % 50) / 25),
      light: chance >= ATTR.WIN_PCT ? 'green' : 'red',
      score: 50 + (i % 10), crv: 3.2, payload: JSON.stringify({ setup: 'A' }),
    });
  }
  const rep = fattrReport(eps, { marktKontext: k });
  assert.equal(rep.state, 'ok', `kein Urteil moeglich: ${rep.reason}`);
  const m = rep.merkmale.find((x) => x.name === 'markt.tage' + MARKT_TAGE);
  assert.ok(m, `markt.tage${MARKT_TAGE} taucht in der Tafel nicht auf`);
  assert.equal(m.abdeckungInPct, 100, `Lernteil nur ${m.abdeckungInPct} % belegt`);
  assert.equal(m.abdeckungOosPct, 100, `Pruefteil nur ${m.abdeckungOosPct} % belegt`);
  assert.notEqual(m.urteil, 'stichtag',
    'der Marktkontext gilt als Stichtag – dann war die ganze Datums-Verknuepfung umsonst');
  assert.notEqual(m.urteil, 'ungeprueft', 'der Marktkontext gilt als ungeprueft');
}

console.log('✓ FusionPulse v4.14.0 NK93 Marktkontext (ausgefuehrt): OK');
