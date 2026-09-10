/* ══════ v4.12.0 · Suite 69 · NK91 — SPAET BEFUELLTE MERKMALE ═══════════════
   BEFUND vom 10.09., Kryptoseite, 544 Episoden:

     situ.rvol   IC out-of-sample −0.644   IC in-sample  –   q 0.0175   traegt
     Modell      OOS-AUC 0.398 gegen score 0.729 — schlechter als Muenzwurf

   Der staerkste Wert der ganzen Tafel hatte kein In-Sample-Gegenstueck. Die
   Overfit-Kontrolle verlangt `aIn !== null` und wurde uebersprungen; das
   Merkmal fiel direkt in „traegt\" und wurde seit v4.10.0 zur Reihungsgrundlage
   der Kandidatenliste, sobald das Modell durchfiel — und das Modell fiel durch.

   Diese Suite stellt genau diese Lage her: ein Merkmal, das NUR im hinteren
   (Pruef-)Teil der Zeitreihe befuellt ist und dort zufaellig mit dem Ausgang
   laeuft. In der Wirklichkeit ist das ein Merkmal, das ab einem Codestand
   mitgeschrieben wird. Gemessen wird dann der Stichtag, nicht der Zusammenhang.

     NK91a  Ein nur spaet befuelltes Merkmal darf NICHT „traegt\" heissen.
     NK91b  Gegenprobe: durchgehend belegte Merkmale gehen normal durch.
     NK91c  Es darf nicht Reihungsgrundlage der Kandidatenliste werden.
     NK91d  Es darf nicht ins Modell.
     NK91e  Die getrennte Abdeckung macht den Stichtag sichtbar.
     NK91f  Unplausibel grosse IC werden gemeldet, ohne ein Urteil zu kippen.
*/
import assert from 'node:assert/strict';
import { fattrReport, reihungBasis, ATTR, FATTR } from '../src/worker.js';

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
const T0 = Date.parse('2026-06-01T13:35:00Z');

/** DIE FALLE, und der erste Entwurf dieser Suite ist hineingelaufen:
 *  ein Merkmal einfach WEGZULASSEN erzeugt eine Gesamtabdeckung von 25 %, und
 *  die faengt schon der alte `unbelegt`-Zweig ab (Grenze 50 %). Die Suite war
 *  gruen — und waere es auch vor v4.12.0 gewesen. Ein Fehlanker.
 *
 *  Der wirkliche Fall sieht anders aus, und er erklaert auch, warum
 *  `situ.rvol` am 10.09. auf 100 % Abdeckung kam: das Merkmal war IMMER da,
 *  aber im aelteren Teil KONSTANT (ein Vorgabewert, bevor es wirklich
 *  gemessen wurde) und begann erst spaeter zu schwanken. `fattrRankIC` gibt
 *  fuer eine konstante Reihe `null` zurueck — also kein In-Sample-IC, bei
 *  voller Abdeckung. Genau die Kombination, die durch jede Kontrolle fiel.
 *
 *  `ehrlich` ist durchgehend da und traegt echt, `rausch` traegt nichts. */
function episoden(n, seed, { abTeil = 0.75, fehltFrueh = false } = {}) {
  const r = rng(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const ehrlich = r(), rauschen = r();
    const chance = ehrlich * 6 - 1 + (r() - 0.5) * 2;
    const situ = { ehrlich: ehrlich * 100, rausch: rauschen * 100 };
    if (fehltFrueh) { if (i >= Math.floor(n * abTeil)) situ.spaet = chance * 10 + (r() - 0.5) * 4; }
    else situ.spaet = i >= Math.floor(n * abTeil) ? chance * 10 + (r() - 0.5) * 4 : 1;
    out.push({
      symbol: 'S' + (i % 40), ts: T0 + i * 3_600_000,
      max_pct: Math.max(0, chance), min_pct: -Math.abs(r() * 2),
      light: chance >= ATTR.WIN_PCT ? 'green' : 'red',
      score: 50 + r() * 10, crv: 3.2,
      payload: JSON.stringify({ setup: i % 3 === 0 ? 'A' : 'B', situParts: situ }),
    });
  }
  return out;
}

const rep = fattrReport(episoden(600, 4711), {});
const von = (name) => rep.merkmale.find((m) => m.name === name);
assert.equal(rep.state, 'ok', `kein Urteil moeglich: ${rep.reason}`);

/* ═══ NK91a · DAS SPAET BEFUELLTE MERKMAL ═════════════════════════════════ */
{
  const m = von('situ.spaet');
  assert.ok(m, 'situ.spaet fehlt in der Tafel – dann prueft diese Suite nichts');
  assert.notEqual(m.urteil, 'traegt',
    `situ.spaet steht auf "traegt" (OOS-IC ${m.icOos}, In-Sample ${m.icIn}) – genau der Fall vom 10.09.`);
  /* Ausdruecklich `ungeprueft`, nicht „ungeprueft ODER unbelegt". Der erste
     Entwurf liess beides zu und lief damit in den ALTEN `unbelegt`-Zweig
     (Abdeckung 25 % < 50 %) — gruen, aber ohne v4.12.0 zu pruefen. Hier ist die
     Abdeckung 100 %; nur der neue Zweig kann greifen. */
  assert.equal(m.urteil, 'ungeprueft',
    `unerwartetes Urteil "${m.urteil}" bei Abdeckung ${m.abdeckungPct} % – erwartet wird ungeprueft`);
  assert.equal(m.abdeckungPct, 100,
    'die Abdeckung ist nicht voll – dann faengt der alte unbelegt-Zweig ab und v4.12.0 wird nicht geprueft');
  assert.ok(m.grund && /Lernteil|Abdeckung|vorhanden/i.test(m.grund),
    `der Grund benennt das fehlende Lernteil nicht: ${m.grund}`);
}

/* ═══ NK91b · GEGENPROBE — DURCHGEHEND BELEGTE MERKMALE GEHEN DURCH ═══════
   Ohne diese Kontrolle waere NK91a auch dann gruen, wenn v4.12.0 einfach jedes
   Merkmal abweist. Eine Tafel, die nie etwas belegt, ist ebenso kaputt. */
{
  const e = von('situ.ehrlich');
  assert.ok(e, 'situ.ehrlich fehlt');
  assert.equal(e.urteil, 'traegt',
    `das ehrliche Merkmal wurde mit abgewiesen: "${e.urteil}" – ${e.grund}`);
  assert.ok(rep.tragend.includes('situ.ehrlich'), 'das ehrliche Merkmal fehlt in `tragend`');
  assert.ok(!rep.tragend.includes('situ.spaet'), 'das spaete Merkmal steht in `tragend`');
}

/* ═══ NK91c · NICHT REIHUNGSGRUNDLAGE ═════════════════════════════════════
   Der Weg, auf dem der Fehler bis in die Kandidatenliste durchgeschlagen ist. */
{
  const b = reihungBasis(rep);
  if (b.basis === 'merkmal') {
    assert.notEqual(b.merkmal.name, 'situ.spaet',
      'die Kandidatenliste wird nach dem spaet befuellten Merkmal geordnet');
  }
  /* Und die schaerfere Fassung: auf welcher Basis auch immer gereiht wird, in
     der Begruendung darf dieses Merkmal nicht als Beleg auftauchen. */
  assert.ok(!/situ\.spaet/.test(b.grund || ''),
    `situ.spaet wird als Beleg fuer die Reihung genannt: ${b.grund}`);
}

/* ═══ NK91d · NICHT INS MODELL ════════════════════════════════════════════
   Im Modell ist der Schaden groesser als beim Einzel-IC: `medianOf(col) ?? 0`
   macht aus der leeren Lernspalte lauter Nullen. Das Gewicht wird gegen Nullen
   geschaetzt und out-of-sample auf echte Werte angewandt. */
{
  assert.ok(rep.modell, 'kein Modell geschaetzt – dann prueft NK91d nichts');
  const drin = rep.modell.gewichte.map((g) => g.merkmal);
  assert.ok(!drin.includes('situ.spaet'),
    `situ.spaet ist im Modell (Gewicht ${JSON.stringify(rep.modell.gewichte.find((g) => g.merkmal === 'situ.spaet'))})`);
  assert.ok(drin.includes('situ.ehrlich'), 'das ehrliche Merkmal fehlt im Modell');
  /* Ein Modell, das gegen Nullen gelernt hat, wird SCHLECHTER als Muenzwurf —
     das war der Befund 0.398. Ohne diese Merkmale muss es wenigstens auf der
     richtigen Seite von 0,5 liegen. */
  assert.ok(rep.modell.aucOos > 0.5,
    `Modell-AUC ${rep.modell.aucOos} liegt unter dem Muenzwurf – es zeigt falsch herum`);
}

/* ═══ NK91e · DER STICHTAG MUSS ABLESBAR SEIN ═════════════════════════════
   Eine gemeinsame Abdeckung von 25 % kann „ueberall ein Viertel" heissen oder
   „im Lernteil nichts, im Pruefteil alles". Zwei voellig verschiedene Lagen
   unter einer Zahl – und die zweite ist die gefaehrliche. */
{
  const e = von('situ.ehrlich');
  assert.equal(typeof e.abdeckungInPct, 'number', 'die Lernteil-Abdeckung fehlt in der Nutzlast');
  assert.equal(typeof e.abdeckungOosPct, 'number', 'die Pruefteil-Abdeckung fehlt in der Nutzlast');
  assert.ok(e.abdeckungInPct > 90 && e.abdeckungOosPct > 90,
    'beim durchgehenden Merkmal weichen die beiden Abdeckungen ab');
  /* Die zweite Spielart: das Merkmal ist frueh gar nicht da. Sie faellt schon
     dem alten `unbelegt`-Zweig zu — aber die getrennte Abdeckung muss den
     Stichtag trotzdem ZEIGEN, sonst steht dort nur „25 %" und niemand sieht,
     dass die 25 % vollstaendig hinten liegen. */
  const rep2 = fattrReport(episoden(600, 4711, { fehltFrueh: true }), {});
  const f = rep2.merkmale.find((x) => x.name === 'situ.spaet');
  assert.ok(f, 'situ.spaet fehlt in der zweiten Tafel');
  assert.ok(f.abdeckungInPct < 20 && f.abdeckungOosPct > 80,
    `der Stichtag ist nicht ablesbar: Lernteil ${f.abdeckungInPct} %, Pruefteil ${f.abdeckungOosPct} %`);
  assert.notEqual(f.urteil, 'traegt', 'ein frueh fehlendes Merkmal traegt');
}

/* ═══ NK91f · WARNUNG, ABER KEIN URTEILSWECHSEL ═══════════════════════════
   `IC_IMPLAUSIBEL` ist eine GERATENE Zahl. Sie darf deshalb melden, aber nicht
   entscheiden – sonst haengt ein Urteil an einem Wert, den niemand gemessen
   hat. */
{
  const gross = rep.merkmale.filter((m) => Number.isFinite(m.icOos) && Math.abs(m.icOos) >= FATTR.IC_IMPLAUSIBEL);
  for (const m of gross) assert.ok(m.unplausibel, `|IC| ${m.icOos} bei ${m.name} ohne Warnung`);
  const klein = rep.merkmale.filter((m) => Number.isFinite(m.icOos) && Math.abs(m.icOos) < FATTR.IC_IMPLAUSIBEL);
  for (const m of klein) assert.equal(m.unplausibel, null, `${m.name} traegt eine Warnung ohne Anlass`);
  /* Der Urteilsspruch selbst darf sich davon nicht aendern: `situ.ehrlich`
     traegt, ob mit oder ohne Warnung. */
  assert.equal(von('situ.ehrlich').urteil, 'traegt', 'die Warnung hat ein Urteil gekippt');
}

/* ═══ NK91g · DIE ANZEIGE, AUSGEFUEHRT ════════════════════════════════════
   „Korrekt berechnet, aber nicht ablesbar" ist in diesem Projekt viermal
   passiert. Ein neues Urteil, das nur in der Nutzlast steht, waere der fuenfte
   Fall — und ausgerechnet dieses Urteil ist die Warnung vor dem staerksten
   Wert der Tafel. */
{
  const { loadClient } = await import('./client-harness.mjs');
  const C = loadClient();
  C.featureData = rep;
  C.renderFeatureAttribution();
  const html = C.el('#featureReport').innerHTML;
  const sichtbar = html.replace(/\s(?:title)="[^"]*"/g, '').replace(/<[^>]*>/g, ' ');
  assert.match(sichtbar, /ungepr/i,
    'das Urteil "ungeprüft" steht nirgends in der SICHTBAREN Tafel');
  assert.ok(!/ungepr[^\s]*\s*(trägt nicht|sammelt)/i.test(sichtbar),
    '"ungeprüft" wird mit einem anderen Urteil zusammengelegt');
  /* Und die getrennte Abdeckung muss im Zeilentext ankommen — sie ist der
     Beleg, an dem der Stichtag ablesbar wird. */
  /* NICHT auf /Lernteil/ pruefen: das Wort steht auch im Begruendungstext des
     Urteils, die Kontrolle war damit gruen, obwohl die Abdeckungsanzeige
     entfernt war. Zweiter Fehlanker dieser Bauart nach NK89h — an der
     Gegenkontrolle gefunden, nicht beim Schreiben.
     `Prüfteil` kommt ausschliesslich in der zusammengesetzten Abdeckungszeile
     vor, und geprueft wird das ganze Muster. */
  assert.match(html, /Abdeckung \d+ % \(Lernteil \d+ %, Prüfteil \d+ %\)/,
    'die getrennte Abdeckung fehlt in der Anzeige');
}

/* ═══ NK91h · STICHTAG UND DUENN SIND ZWEI VERSCHIEDENE DINGE ═════════════
   v4.12.0 legte beide unter „ungeprueft\". In der Tafel stand daraufhin bei
   `situ.extended` ein In-Sample-IC von −0,21 NEBEN dem Urteil „ungeprueft\" —
   wenn dort eine Zahl steht, IST die Kontrolle gelaufen.

   Geprueft wird an den beiden Faellen, an denen die Schwelle ausgerichtet ist:
     · Lernteil 42 %, Pruefteil 100 %  (gemessen am 10.09. an situ.extended)
     · Lernteil 45 %, Pruefteil 48 %   (gleichmaessig duenn)
   Der erste MUSS „stichtag\" heissen, der zweite darf es NICHT. */
{
  /** `x` ist im Lernteil nur zu `cIn`, im Pruefteil zu `cOos` belegt — und
   *  traegt, wo es belegt ist, echt. Die Wahrheit steht im Test. */
  const mitAbdeckung = (n, seed, cIn, cOos) => {
    const r = rng(seed);
    const out = [];
    const grenze = Math.floor(n * (1 - 0.3));
    for (let i = 0; i < n; i++) {
      const ehrlich = r(), wuerfel = r();
      const chance = ehrlich * 6 - 1 + (r() - 0.5) * 2;
      const situ = { ehrlich: ehrlich * 100 };
      if (wuerfel < (i < grenze ? cIn : cOos)) situ.x = chance * 8 + (r() - 0.5) * 6;
      out.push({
        symbol: 'S' + (i % 40), ts: T0 + i * 3_600_000,
        max_pct: Math.max(0, chance), min_pct: -Math.abs(r() * 2),
        light: chance >= ATTR.WIN_PCT ? 'green' : 'red',
        score: 50 + r() * 10, crv: 3.2,
        payload: JSON.stringify({ setup: 'A', situParts: situ }),
      });
    }
    return out;
  };

  const bruch = fattrReport(mitAbdeckung(900, 90210, 0.42, 1.0), {});
  const xb = bruch.merkmale.find((m) => m.name === 'situ.x');
  assert.ok(xb, 'situ.x fehlt in der Bruch-Tafel');
  assert.equal(xb.urteil, 'stichtag',
    `Lernteil ${xb.abdeckungInPct} %, Pruefteil ${xb.abdeckungOosPct} % ergibt "${xb.urteil}" statt "stichtag"`);
  assert.ok(/Grundgesamtheiten|Zeittrennung/.test(xb.grund), `der Grund benennt den Bruch nicht: ${xb.grund}`);
  assert.ok(!bruch.tragend.includes('situ.x'), 'das gebrochene Merkmal steht in `tragend`');
  assert.ok(!(bruch.modell?.gewichte || []).some((g) => g.merkmal === 'situ.x'),
    'das gebrochene Merkmal ist im Modell');

  /* ══ DIE GEGENPROBE, und sie ist der eigentliche Zweck von v4.12.1 ═══════
     Gleichmaessig duenn ist KEIN Stichtag. Ohne diese Kontrolle waere v4.12.1
     von v4.12.0 nicht zu unterscheiden. */
  /* 62 % / 66 % und nicht 45 % / 48 %. Der erste Entwurf nahm 45/48 — und die
     Gesamtabdeckung lag damit bei 46 %, also unter der 50-%-Schranke. Das
     Merkmal bekam „unbelegt\" vom ALTEN Zweig, und die Gegenprobe prueft dann
     nichts von v4.12.1. Dritter Fehlanker dieser Bauart in dieser Reihe,
     wieder an der Negativkontrolle gefunden.
     Die Zusicherung darunter macht es unmoeglich, dass es unbemerkt
     zurueckrutscht. */
  const duenn = fattrReport(mitAbdeckung(900, 90210, 0.62, 0.66), {});
  const xd = duenn.merkmale.find((m) => m.name === 'situ.x');
  assert.ok(xd, 'situ.x fehlt in der duennen Tafel');
  assert.ok(xd.abdeckungPct >= 50,
    `Gesamtabdeckung ${xd.abdeckungPct} % – unter 50 % faengt der alte unbelegt-Zweig ab und diese Gegenprobe prueft nichts`);
  assert.ok(Math.abs(xd.abdeckungInPct - xd.abdeckungOosPct) < 25,
    'die beiden Haelften liegen zu weit auseinander – das ist dann kein duenner, sondern ein gebrochener Fall');
  assert.notEqual(xd.urteil, 'stichtag',
    `gleichmaessig duenn (${xd.abdeckungInPct} % / ${xd.abdeckungOosPct} %) wurde als Stichtag abgetan`);
  assert.notEqual(xd.urteil, 'ungeprueft',
    `gleichmaessig duenn wurde als ungeprueft abgetan – genau der Fehler aus v4.12.0`);
  assert.ok(Number.isFinite(xd.icIn),
    'ohne In-Sample-IC prueft diese Gegenprobe nicht, was sie soll');

  /* ══ DER WIDERSPRUCH AUS DER OBERFLAECHE, als Regel ══════════════════════
     Steht ein In-Sample-IC da, darf das Urteil NICHT „ungeprueft" sein.
     Genau das war am 10.09. in der Tafel zu sehen. Geprueft ueber alle
     Merkmale beider Tafeln, nicht nur ueber das gepflanzte. */
  for (const rep2 of [bruch, duenn, rep]) {
    for (const m of rep2.merkmale) {
      if (m.urteil === 'ungeprueft') {
        assert.equal(m.icIn, null,
          `${m.name} heisst "ungeprueft", zeigt aber einen In-Sample-IC von ${m.icIn} – Widerspruch in der Tafel`);
      }
    }
  }
}

console.log('✓ FusionPulse v4.12.1 NK91 spaet befuellte Merkmale (ausgefuehrt): OK');
