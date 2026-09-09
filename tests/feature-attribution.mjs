/* ══════ v4.8.0 · Suite 66 · NK87 — MERKMALS-ATTRIBUTION ══════════════════════
   Diese Suite fuehrt Modul 0b AUS. Sie liest keinen Quelltext, um zu pruefen,
   ob eine Regel dasteht — das ist in dieser Reihe zehnmal schiefgegangen. Sie
   baut Episoden mit BEKANNTER Wahrheit und verlangt, dass die Auswertung sie
   findet UND dass sie das Nichtvorhandene nicht findet.

   Der zweite Teil ist der wichtigere. Ein Attributionsmodul, das gepflanzte
   Signale entdeckt, aber auch in reinem Rauschen fuendig wird, ist schlimmer
   als keines: es liefert Begruendungen fuer Gewichtungen, die es nicht gibt.
   NK87b ist deshalb die eigentliche Zusicherung dieser Suite. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  fattrReport, fattrRankIC, fattrAuc, fattrBenjaminiHochberg,
  fattrPermutationP, fattrRanks, aucSeparation, ATTR, FATTR,
} from '../src/worker.js';

const w = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');

/* Derselbe deterministische Generator wie im Worker — hier bewusst
   NACHGEBAUT und nicht importiert: der Test soll seine Eingabe selbst
   erzeugen koennen, auch wenn der Worker seinen RNG einmal austauscht. */
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

/** Baut Episoden. `bau(i, r, signal)` liefert die `situParts` je Episode;
 *  `chanceOf(signal, r)` den tatsaechlichen Ausgang. So steht die Wahrheit im
 *  Test und nicht in der Auswertung. */
function episoden(n, seed, bau, chanceOf) {
  const r = rng(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const signal = r();
    const chance = chanceOf(signal, r, i, n);
    out.push({
      symbol: 'SYM' + (i % 40), ts: T0 + i * 3_600_000,
      max_pct: Math.max(0, chance), min_pct: -Math.abs(r() * 2),
      light: chance >= ATTR.WIN_PCT ? 'green' : 'red',
      score: 50 + r() * 10, crv: 3.3,
      payload: JSON.stringify({ setup: i % 3 === 0 ? 'A' : 'B', situParts: bau(i, r, signal) }),
    });
  }
  return out;
}
const nimm = (rep, name) => rep.merkmale.find((m) => m.name === 'situ.' + name);

/* ═══ NK87a · Ein gepflanztes Signal MUSS gefunden werden ══════════════════ */
{
  const eps = episoden(400, 11, (i, r, s) => ({ echt: s * 100, rausch: r() * 100 }),
    (s, r) => s * 6 - 1 + (r() - 0.5) * 2);
  const rep = fattrReport(eps, {});
  assert.equal(rep.state, 'ok', 'bei 400 Episoden muss ein Urteil moeglich sein');
  const echt = nimm(rep, 'echt');
  assert.ok(echt, 'das gepflanzte Merkmal fehlt im Bericht');
  assert.equal(echt.urteil, 'traegt', `gepflanztes Signal nicht erkannt: ${echt.grund}`);
  assert.ok(echt.icOos > 0.2, `OOS-IC zu schwach: ${echt.icOos}`);
  /* Die Terzil-Tafel ist die interpretierbare Seite: oben muss haeufiger
     getroffen werden als unten, sonst sagt der IC etwas anderes als die Tafel. */
  const t = echt.terzile;
  assert.ok(t && t.length === 3, 'Terzil-Tafel fehlt');
  assert.ok(t[2].trefferPct > t[0].trefferPct + 10,
    `oberes Terzil ${t[2].trefferPct} % vs. unteres ${t[0].trefferPct} % – die Tafel widerspricht dem IC`);
  assert.ok(rep.tragend.includes('situ.echt'));
}

/* ═══ NK87b · REINES RAUSCHEN darf nichts hergeben ═════════════════════════
   Zwoelf unabhaengige Rauschmerkmale gegen einen zufaelligen Ausgang. Ohne
   Mehrfachtestkorrektur waere hier im Schnitt ein "Fund" pro Durchlauf zu
   erwarten — genau die erfundene Regelmaessigkeit, die wie Wissen aussieht.
   Geprueft ueber acht Startwerte, damit das Ergebnis nicht an einem
   guenstigen Zufall haengt. */
{
  let funde = 0, laeufe = 0;
  for (let seed = 100; seed < 108; seed++) {
    const eps = episoden(400, seed, (i, r) => {
      const o = {};
      for (let k = 0; k < 12; k++) o['n' + k] = r() * 100;
      return o;
    }, (s, r) => r() * 6 - 1);
    const rep = fattrReport(eps, {});
    assert.equal(rep.state, 'ok');
    funde += rep.tragend.length;
    laeufe++;
  }
  assert.ok(funde <= 1,
    `${funde} "tragende" Merkmale in ${laeufe} Rauschlaeufen zu je 12 Kandidaten – die Mehrfachtestkorrektur greift nicht`);
}

/* ═══ NK87c · Vorzeichenwechsel heisst overfit, nicht "traegt" ═════════════
   Das ist der Fall, der eine Gewichtung teuer macht: in-sample ueberzeugend,
   out-of-sample verkehrt herum. Signifikanz allein duerfte ihn nicht retten. */
{
  const eps = episoden(400, 21, (i, r, s) => ({ dreht: i < 280 ? s * 100 : (1 - s) * 100 }),
    (s, r) => s * 6 - 1 + (r() - 0.5) * 2);
  const rep = fattrReport(eps, {});
  const m = nimm(rep, 'dreht');
  assert.equal(m.urteil, 'overfit', `Vorzeichenwechsel nicht erkannt: ${m.grund}`);
  assert.ok(rep.overfit.includes('situ.dreht'));
  assert.ok(!rep.tragend.includes('situ.dreht'), 'ein overfit-Merkmal darf nie in der Tragend-Liste stehen');
}

/* ═══ NK87d · FEHLEND IST NICHT NULL ══════════════════════════════════════
   Der teuerste wiederkehrende Fehler dieses Projekts (`Number(null)===0` in
   4.2.3 und noch einmal in 4.3.8). Ein Merkmal, das nur in 30 % der Episoden
   steht, muss als unbelegt gelten — und die Abdeckung muss 30 sagen, nicht
   100. Die zweite Zusicherung ist die schaerfere: wuerden fehlende Werte als
   0 mitgezaehlt, waere die Abdeckung voll und der IC kaeme aus den Nullen. */
{
  const eps = episoden(400, 31, (i, r, s) => {
    const o = {};
    if (i % 10 < 3) o.selten = s * 100;   // 30 % — unter der Belegschwelle
    if (i % 10 < 6) o.halb = s * 100;     // 60 % — darueber, aber lueckenhaft
    return o;
  }, (s, r) => s * 6 - 1 + (r() - 0.5) * 2);
  const rep = fattrReport(eps, {});
  const m = nimm(rep, 'selten');
  assert.ok(m, 'auch ein selten belegtes Merkmal muss im Bericht auftauchen');
  assert.equal(m.abdeckungPct, 30, `Abdeckung ${m.abdeckungPct} % – fehlende Werte wurden mitgezaehlt`);
  assert.equal(m.urteil, 'unbelegt');
  assert.ok(/KEINE Null unterstellt/.test(m.grund), 'der Grund muss die Regel benennen');
  assert.ok(!rep.tragend.includes('situ.selten'));

  /* Die Anzeige allein beweist nichts. Der erste Entwurf dieser Suite prueft
     genau hier zu weich: die Abdeckung wurde getrennt gezaehlt, also blieb der
     Test gruen, als in der IC-Rechnung fehlende Werte durch 0 ersetzt wurden.
     Aufgefallen ist das erst an der Negativkontrolle. Geprueft wird deshalb
     die PAARZAHL, aus der der IC entsteht — sie muss der Belegung folgen. */
  const h = nimm(rep, 'halb');
  assert.equal(h.nIn + h.nOos, 240, `${h.nIn + h.nOos} Paare bei 60 % von 400 – fehlende Werte sind in die Rechnung geraten`);
  assert.ok(h.nOos < rep.oosN, 'ein luecken­haftes Merkmal darf nicht so viele Paare haben wie es Episoden gibt');
  assert.equal(m.nIn + m.nOos, 120, 'auch beim unbelegten Merkmal darf die Paarzahl nicht aufgefuellt werden');
  assert.equal(h.urteil, 'traegt', `ausreichend belegt und stark: ${h.grund}`);
}

/* ═══ NK87e · Konstant ist nicht "kein Zusammenhang" ══════════════════════ */
{
  const eps = episoden(400, 41, (i, r, s) => ({ fest: 42, echt: s * 100 }),
    (s, r) => s * 6 - 1 + (r() - 0.5) * 2);
  const rep = fattrReport(eps, {});
  const m = nimm(rep, 'fest');
  assert.equal(m.urteil, 'konstant', 'ein konstanter Wert darf nicht als "traegt nicht" durchgehen');
  assert.equal(m.icOos, null, 'ein konstanter Wert hat keinen IC – auch nicht 0');
}

/* ═══ NK87f · Die schnelle AUC ist dieselbe wie die paarweise ═════════════
   `fattrAuc` rechnet ueber Raenge, `aucSeparation` paarweise. Zwei Wege zur
   selben Zahl sind sonst eine zweite Wahrheit – dieselbe Falle wie die
   abgeschriebenen Heatmap-Konstanten in 4.2.4. */
{
  const r = rng(55);
  for (let run = 0; run < 20; run++) {
    const s = [], l = [];
    for (let i = 0; i < 40; i++) { s.push(Math.round(r() * 5)); l.push(r() > 0.5 ? 1 : 0); }
    const schnell = fattrAuc(s, l);
    const paarweise = aucSeparation(s.filter((_, i) => l[i] === 1), s.filter((_, i) => l[i] === 0));
    if (schnell === null || paarweise === null) continue;
    assert.ok(Math.abs(schnell - paarweise) < 1e-9,
      `Rang-AUC ${schnell} weicht von der paarweisen ${paarweise} ab`);
  }
  /* Bindungen sind hier der Normalfall (ganzzahlige Scores, Ampeln). Der
     Vergleich oben laeuft ausdruecklich auf gerundeten Werten, damit er sie
     trifft statt sie zu umgehen. */
  assert.deepEqual(fattrRanks([5, 5, 1]), [2.5, 2.5, 1], 'Bindungen brauchen Durchschnittsraenge');
}

/* ═══ NK87g · Derselbe Eingang, dieselbe Antwort ═════════════════════════
   Ein p-Wert aus `Math.random` waere bei jedem Aufruf ein anderer. Dann liesse
   sich weder ein Befund nachvollziehen noch ein Test darauf schreiben. */
{
  const eps = episoden(300, 61, (i, r, s) => ({ a: s * 100, b: r() * 100 }), (s, r) => s * 5 + r());
  const a = fattrReport(eps, {}), b = fattrReport(eps, {});
  assert.deepEqual(a.merkmale, b.merkmale, 'zwei Laeufe auf demselben Eingang weichen ab');
  const ic = fattrRankIC([1, 2, 3, 4, 5, 6, 7, 8], [2, 1, 4, 3, 6, 5, 8, 7]);
  assert.equal(fattrPermutationP(ic.rx, ic.ry, 200, 7), fattrPermutationP(ic.rx, ic.ry, 200, 7));
  assert.ok(fattrPermutationP(ic.rx, ic.ry, 200, 7) > 0, 'ein Permutations-p darf nie 0 sein');
}

/* ═══ NK87h · Kein Blick in die Zukunft ═══════════════════════════════════
   Median und Standardisierung kommen laut Regel 3 ausschliesslich aus dem
   In-Sample-Teil. Ausgefuehrt geprueft: verschiebt man NUR die OOS-Werte um
   eine grosse Konstante, darf sich der In-Sample-IC nicht bewegen. Rechnete
   die Auswertung ueber den ganzen Satz, waere er sofort ein anderer. */
{
  const bau = (i, r, s) => ({ echt: s * 100 });
  const chance = (s, r) => s * 6 - 1 + (r() - 0.5) * 2;
  const a = episoden(400, 71, bau, chance);
  const b = a.map((e, i) => {
    if (i < 280) return e;
    const p = JSON.parse(e.payload);
    p.situParts.echt += 10_000;
    return { ...e, payload: JSON.stringify(p) };
  });
  const repA = fattrReport(a, {}), repB = fattrReport(b, {});
  assert.equal(nimm(repA, 'echt').icIn, nimm(repB, 'echt').icIn, 'der In-Sample-IC haengt an OOS-Werten – Leck');
  assert.equal(nimm(repA, 'echt').nIn, nimm(repB, 'echt').nIn);

  /* UND der Modellpfad. Der erste Entwurf prueft nur den IC — der hat nie
     geleckt. Die Negativkontrolle "Median und Standardisierung ueber den
     ganzen Satz" blieb deshalb gruen: geprueft wurde die falsche Ebene, genau
     der Fehler, der in dieser Reihe zwoelfmal aufgetreten ist. Die Gewichte
     entstehen ausschliesslich aus dem In-Sample-Teil und muessen daher
     unveraendert bleiben, egal was hinter dem Schnitt passiert. */
  assert.deepEqual(repA.modell.gewichte, repB.modell.gewichte,
    'die Modellgewichte aendern sich, wenn nur OOS-Werte verschoben werden – Leck in Median oder Standardisierung');
  assert.equal(repA.modell.nIn, repB.modell.nIn);
}

/* ═══ NK87i · Das Modell ══════════════════════════════════════════════════ */
{
  const eps = episoden(500, 81, (i, r, s) => ({ echt: s * 100, rausch: r() * 100 }),
    (s, r) => s * 6 - 1 + (r() - 0.5) * 2);
  const rep = fattrReport(eps, {});
  assert.ok(rep.modell, 'bei genug belegten Merkmalen muss ein Modell geschaetzt werden');
  assert.ok(rep.modell.aucOos > 0.6, `Modell-AUC ${rep.modell.aucOos} – das gepflanzte Signal wird nicht genutzt`);
  assert.ok(rep.modell.pAuc <= 0.05, 'ein klares Signal muss den Permutationstest bestehen');
  const g = rep.modell.gewichte.find((x) => x.merkmal === 'situ.echt');
  const gr = rep.modell.gewichte.find((x) => x.merkmal === 'situ.rausch');
  assert.ok(Math.abs(g.gewicht) > Math.abs(gr.gewicht) * 2,
    `das echte Merkmal (${g.gewicht}) muss deutlich schwerer wiegen als das Rauschen (${gr.gewicht})`);
  assert.ok(/VORSCHLAG/.test(rep.modell.hinweis), 'der Vorschlagscharakter muss in der Antwort stehen');

  /* Gegenprobe: reines Rauschen darf kein "besser als heute" ergeben. */
  const noise = episoden(500, 82, (i, r) => ({ a: r() * 100, b: r() * 100 }), (s, r) => r() * 6 - 1);
  const rn = fattrReport(noise, {});
  assert.notEqual(rn.modell.urteil, 'besser als die heutige Reihung',
    'auf reinem Rauschen darf sich das Modell nicht als besser erklaeren');
}

/* ═══ NK87j · Zu wenig Daten heisst "sammelt", nicht "nichts gefunden" ════
   Der Unterschied ist der ganze Punkt: "keine Belege" und "Belege dagegen"
   duerfen nicht gleich aussehen. Dieselbe Regel wie beim Verlauf der
   Kauf-Freigaben in 4.2.9. */
{
  const wenig = fattrReport(episoden(20, 91, (i, r, s) => ({ echt: s * 100 }), (s) => s * 6), {});
  assert.equal(wenig.state, 'sammelt');
  assert.match(wenig.reason, /20\/40/);
  assert.deepEqual(wenig.merkmale, []);
  assert.equal(wenig.modell, null);
  assert.ok(!('tragend' in wenig), 'ohne Urteil darf keine Tragend-Liste erscheinen');
}

/* ═══ NK87k · Das Modul ist NIRGENDS verdrahtet ═══════════════════════════
   Die Zusicherung, auf der alles andere ruht. Ein Modell, das sich selbst
   scharf schaltet, veraendert die Auswahl, aus der die naechste Messung
   entsteht — dann misst es sich selbst. Geprueft wird an den AUFRUFSTELLEN,
   nicht an einer Erwaehnung: die Suche ignoriert Kommentare. */
{
  const ohneKommentar = w
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
  const stellen = (name) => (ohneKommentar.match(new RegExp('\\b' + name + '\\s*\\(', 'g')) || []).length;
  /* je eine Definition + je ein Aufruf. Mehr Aufrufer waeren eine Verdrahtung. */
  assert.equal(stellen('featureAttribution'), 2,
    'featureAttribution hat mehr als einen Aufrufer – das Modul ist verdrahtet');
  assert.equal(stellen('fattrReport'), 2,
    'fattrReport hat mehr als einen Aufrufer');
  const route = ohneKommentar.indexOf("'/api/attribution/features'");
  assert.ok(route > 0, 'die Route fehlt');
  const aufruf = ohneKommentar.indexOf('featureAttribution(env', route);
  assert.ok(aufruf > route && aufruf - route < 400,
    'der einzige Aufruf muss in der Route stehen, nicht anderswo');

  /* Der Cron-Pfad beginnt bei serverLearningCycle. Weder er noch die
     Bewertungsfunktionen duerfen das Modul beruehren. */
  for (const fn of ['serverLearningCycle', 'analyseStock', 'analyse']) {
    const i = ohneKommentar.indexOf('function ' + fn + '(');
    assert.ok(i > 0, fn + ' nicht gefunden');
    const rumpf = ohneKommentar.slice(i, ohneKommentar.indexOf('\nfunction ', i + 1));
    assert.ok(!/fattr|featureAttribution/.test(rumpf),
      `${fn} beruehrt Modul 0b – die Auswertung darf die Bewertung nicht anfassen`);
  }
}

/* ═══ NK87l · Der Bericht bleibt im CPU-Budget ═══════════════════════════
   `limits.cpu_ms` steht seit 4.5.2 auf 5.000. Ein Permutationstest ueber
   zwanzig Merkmale ist genau die Sorte Rechnung, die das reisst — deshalb
   gemessen und nicht angenommen. */
{
  const eps = episoden(FATTR.ROW_LIMIT / 4, 99, (i, r, s) => {
    const o = { echt: s * 100 };
    for (let k = 0; k < 14; k++) o['n' + k] = r() * 100;
    return o;
  }, (s, r) => s * 6 - 1 + (r() - 0.5) * 2);
  const t0 = Date.now();
  const rep = fattrReport(eps, {});
  const ms = Date.now() - t0;
  assert.equal(rep.state, 'ok');
  assert.ok(ms < 3000, `Bericht braucht ${ms} ms – zu nah an cpu_ms 5000`);
  assert.ok(rep.tragend.includes('situ.echt'), 'auch im grossen Lauf muss das Signal stehen');
}

/* ═══ NK87m · Die Anzeige ═════════════════════════════════════════════════
   Berechnet und uebertragen war in diesem Projekt schon dreimal zu wenig
   (`dropped` 4.2.3, Lesezahlen 4.3.8, `topQueries` 4.5.5). Deshalb wird die
   Anzeige AUSGEFUEHRT geprueft, nicht per Muster — und in derselben Version
   wie die Rechnung, nicht in der naechsten. */
{
  const { loadClient } = await import('./client-harness.mjs');
  const C = loadClient();

  // Normalfall: Urteil, Modell und Merkmalsname muessen im Kasten stehen.
  const eps = episoden(400, 111, (i, r, s) => ({ echt: s * 100, rausch: r() * 100 }),
    (s, r) => s * 6 - 1 + (r() - 0.5) * 2);
  C.featureData = fattrReport(eps, {});
  C.renderFeatureAttribution();
  const html = C.el('#featureReport').innerHTML;
  assert.match(html, /situ\.echt/, 'das tragende Merkmal steht nicht in der Anzeige');
  assert.match(html, /trägt/, 'das Urteil fehlt');
  assert.match(html, /OOS-AUC/, 'der Modellvergleich fehlt');
  /* Der erste Entwurf prueft hier zu weich: `nirgends verdrahtet` steht
     AUCH im Tooltip des Modellblocks, also blieb der Test gruen, als der
     Hinweis aus der Kopfzeile verschwand. Zwoelfter Fehlanker dieser Reihe,
     gefunden an der Negativkontrolle. Geprueft wird jetzt die KOPFZEILE —
     der Teil, den man ohne Mauszeiger liest. */
  const kopfzeile = html.slice(0, html.indexOf('<div class="lr-grid"'));
  assert.ok(kopfzeile.length > 0, 'die Kopfzeile fehlt');
  assert.match(kopfzeile, /nirgends verdrahtet/,
    'die sichtbare Kopfzeile muss sagen, dass die Gewichte nichts steuern – sonst liest sich die Tafel wie eine Umstellung');
  assert.match(html.slice(html.indexOf('OOS-AUC') - 800, html.indexOf('OOS-AUC')), /VORSCHLAG/,
    'auch der Modellblock selbst muss seinen Vorschlagscharakter tragen');

  // Sammelzustand: benannt, mit Zahl, und OHNE Prozentwert aus Unwissen.
  C.featureData = fattrReport(eps.slice(0, 20), {});
  C.renderFeatureAttribution();
  const leer = C.el('#featureReport').innerHTML;
  assert.match(leer, /Sammelt/, 'zu wenig Daten muss als Zustand benannt werden');
  assert.match(leer, /20\/40/, 'die Zahl gehoert dazu – „sammelt“ allein ist keine Auskunft');
  /* Auch dieser Ausdruck war zuerst falsch: `[^>]*>` verschluckt den Text VOR
     jedem Tag und liess damit alles durch. Ein Pruefausdruck, der seine
     Eingabe falsch zerlegt, irrt in beide Richtungen — dieselbe Lehre wie beim
     Zeichenscanner in 4.3.1. Entfernt werden jetzt nur die Tags. */
  assert.ok(!/\d+\s*%/.test(leer.replace(/<[^>]*>/g, ' ')),
    'im Sammelzustand darf kein Prozentwert erscheinen – das waere Entwarnung aus Unwissen');

  // Fehlerfall darf nicht wie ein leerer Befund aussehen.
  C.featureData = { configured: true, state: 'error', error: 'D1 nicht erreichbar' };
  C.renderFeatureAttribution();
  assert.match(C.el('#featureReport').innerHTML, /Fehler: D1 nicht erreichbar/,
    '„konnte nicht nachsehen“ und „nichts gefunden“ duerfen nicht gleich aussehen');
}

console.log('✓ FusionPulse v4.8.0 NK87 Merkmals-Attribution (ausgefuehrt): OK');
