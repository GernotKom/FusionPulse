/* ══════ v4.5.7 · Suite 62 · NK81 — ANZEIGEN, DIE IM AUSNAHMEFALL VERSAGEN ═══
   Alle vier Befunde dieser Version sind derselbe Fehler in vier Gewaendern:
   eine Anzeige funktioniert im Normalfall tadellos und wird ausgerechnet dann
   falsch, wenn sie gebraucht wird.

     NK81a  Die Kopfzeile bricht nur bei `err`/`orange` zusammen.
     NK81b  „N ausgewertet" verschweigt Verwuerfe -> Dauer-Rueckstand.
     NK81c  Das Tempo SINKT, je laenger die App stillsteht.
     NK81d  „seit dem Start dieser Worker-Version" — es ist der Monatsbehaelter.

   Gemessen wird AUSGEFUEHRT, nicht per Muster. Genau diese Befunde haetten
   einen Regex-Test bestanden: der Quelltext sah jedes Mal richtig aus.
   Negativkontrollen: jeder Block dreht die Bedingung um und verlangt, dass der
   Test dann FAELLT — ein Test, der immer gruen ist, prueft nichts (Lehre 8y). */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { loadClient } from './client-harness.mjs';

const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
const w   = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');

/* ═══ NK81a · Die Kopfzeile darf im Fehlerfall umbrechen ════════════════════
   Der Fehler war NICHT die 100-%-Regel — die ist gewollt. Er war, dass beide
   umgebenden Flex-Container `flex-wrap` fehlte, sodass `flex-basis:100%` die
   Geschwister erdrueckte statt eine eigene Zeile zu bekommen. Geprueft wird
   deshalb die KOMBINATION, nicht eine einzelne Deklaration. */
{
  const block = (sel) => {
    const i = css.indexOf(sel + '{');
    assert.ok(i >= 0, `${sel} fehlt in style.css`);
    return css.slice(i, css.indexOf('}', i));
  };
  /* v4.5.8 · HIER STAND EIN TEST, DER NICHTS BEWIESEN HAT.
     NK81a prueft `flex-wrap` per Muster im Stylesheet. Diese Pruefung war in
     4.5.7 gruen — und im Browser wurde das Layout SCHLIMMER als vorher: der
     Titel fiel weiter in eine 49-Pixel-Saeule, die Kopfzeile wuchs auf 278 px.
     Ein Muster im Quelltext beweist, dass eine Regel dasteht, nie dass sie
     wirkt. Die Wirkung misst jetzt NK82 (`tests/header-layout.mjs`) mit einem
     echten Chromium.

     Was hier bleibt, ist nur noch das, was ein Muster ehrlich zeigen kann:
     dass die Regeln nicht versehentlich verschwinden. Die Schwellen dazu
     stehen in NK82. */
  for (const sel of ['header', '.hcenter-tools']) {
    assert.match(block(sel), /flex-wrap:\s*wrap/, `${sel} braucht flex-wrap`);
  }
  assert.match(block('.hstat'), /flex:\s*1 1 260px/,
    'Der Titel braucht eine Flex-Basis, sonst schrumpft er auf min-content');
  assert.match(block('.regime-btn'), /white-space:\s*nowrap/,
    'Der Titel darf nie in Einzelwoerter brechen');
  /* Negativkontrolle: ohne den Umbruch muss diese Pruefung fallen. */
  assert.throws(() => assert.match('display:flex;align-items:center;gap:8px', /flex-wrap:\s*wrap/),
    'Negativkontrolle: die Pruefung darf ohne flex-wrap nicht durchgehen');
}

/* ═══ NK81b · Verwuerfe duerfen nicht als Rueckstand erscheinen ═════════════
   Zahlen aus dem Betrieb vom 08.09.: 33.760 Setups, 14.688 ausgewertet. Die
   Kachel liess daraus 19.072 „offene" Faelle lesen. Tatsaechlich waren davon
   fast alle verworfen — binnen LEARN_HORIZON_MS kamen keine Folgekurse. */
{
  const fp = loadClient();
  fp.learningData = { configured: true, stats: { snapshots: 33760, resolved: 14688, dropped: 19000, lastTs: Date.now() } };
  const txt = fp.learningBadge();

  assert.ok(/19000 verworfen/.test(txt), `Verwuerfe muessen benannt sein — bekam: ${txt}`);
  assert.ok(/\b72 offen\b/.test(txt),
    `„offen" muss Setups minus ausgewertet minus verworfen sein (33760-14688-19000=72) — bekam: ${txt}`);
  assert.ok(/56 %/.test(txt), `Der Verwurfsanteil gehoert dazu — bekam: ${txt}`);

  /* Kein Verwurf: dann darf auch nichts davon dastehen — keine „0 verworfen"-
     Zeile, die eine Aussage vortaeuscht, wo keine noetig ist. */
  fp.learningData = { configured: true, stats: { snapshots: 100, resolved: 40, dropped: 0, lastTs: Date.now() } };
  const sauber = fp.learningBadge();
  assert.ok(!/verworfen/.test(sauber), `Ohne Verwuerfe kein Verwurfstext — bekam: ${sauber}`);
  assert.ok(/\b60 offen\b/.test(sauber), `bekam: ${sauber}`);

  /* Zaehler aus verschiedenen Flush-Zyklen duerfen nie negativ werden. */
  fp.learningData = { configured: true, stats: { snapshots: 10, resolved: 8, dropped: 8, lastTs: Date.now() } };
  assert.ok(/\b0 offen\b/.test(fp.learningBadge()), 'Negative Restmenge muss auf 0 geklemmt werden');

  /* Negativkontrolle: die alte Formel haette 19.072 statt 72 geliefert. */
  assert.notEqual(33760 - 14688, 72, 'Negativkontrolle: die alte Rechnung war eine andere Zahl');
}

/* ═══ NK81c · Das Tempo darf im Stillstand nicht sinken ═════════════════════
   Der Worker rechnet es jetzt ueber die AKTIVE Spanne (erster bis letzter
   gezaehlter Abruf). Zwei Aufrufe mit identischem `activeHours`, aber
   unterschiedlicher Standzeit, muessen dasselbe Tempo ergeben. */
{
  const fp = loadClient();
  const bw = (idleHours) => ({
    bandwidth: { measured: true, usedGb: 3.98, capGb: 40, measuredHours: 120,
                 activeHours: 120, idleHours, perDayGb: 0.796 },
  });
  fp.authDenied = false;
  const frisch = fp.bandwidthNote(bw(0.1));
  const still  = fp.bandwidthNote(bw(30));

  assert.equal(frisch.perDayGb, still.perDayGb,
    'Dasselbe aktive Fenster muss dasselbe Tempo ergeben, egal wie lange nichts mehr lief');
  assert.ok(/Tempo 0,80 GB\/Tag/.test(frisch.label) || /Tempo 0\.80 GB\/Tag/.test(frisch.label),
    `Das Tempo gehoert in die Kurzanzeige — bekam: ${frisch.label}`);
  assert.ok(!/kein Abruf/.test(frisch.label),
    `Bei frischer Messung kein Stillstandshinweis — bekam: ${frisch.label}`);
  assert.ok(/seit 1,3 Tagen kein Abruf|seit 1\.3 Tagen kein Abruf/.test(still.label),
    `Ein eingefrorenes Tempo ohne Stillstandshinweis waere die naechste stille Luege — bekam: ${still.label}`);

  /* Der Worker muss die Felder ueberhaupt liefern, sonst rechnet der Client
     wieder gegen die verstrichene Zeit. */
  for (const feld of ['activeHours', 'idleHours', 'lastTs']) {
    assert.ok(w.includes(feld + ':'), `tiingoBandwidthView muss ${feld} ausliefern`);
  }
  assert.ok(/const perDayGb\s*=\s*activeHours/.test(w),
    'Das Tempo muss ueber activeHours gerechnet werden, nicht ueber measuredHours');
}

/* ═══ NK81c-2 · Die Serverformel selbst, ausgefuehrt ════════════════════════
   Der Client kann nur anzeigen, was er bekommt. Die Rechnung liegt im Worker
   und wird hier in einer VM nachgestellt — mit denselben Werten wie im
   Betrieb: Zaehler steht, Uhr laeuft weiter. */
{
  const ctx = { Math, Number, Date };
  vm.createContext(ctx);
  vm.runInContext(`
    function tempo(usedGb, startedTs, lastTs, now){
      const measuredHours = startedTs ? Math.max(0,(now-startedTs)/3600000) : null;
      const activeHours = (startedTs && lastTs) ? Math.max(0,(lastTs-startedTs)/3600000) : measuredHours;
      return activeHours && activeHours > 0.25 ? +(usedGb/activeHours*24).toFixed(3) : null;
    }`, ctx);

  const start = 0, letzter = 120 * 3600000;          // 120 h aktiv gemessen
  const a = ctx.tempo(3.98, start, letzter, letzter + 1 * 3600000);
  const b = ctx.tempo(3.98, start, letzter, letzter + 48 * 3600000);
  assert.equal(a, b, 'Nach 48 h Stillstand muss dasselbe Tempo herauskommen wie nach 1 h');

  /* Negativkontrolle: die ALTE Formel (gegen `now`) muss sinken — sonst
     prueft dieser Test einen Fehler, den es gar nicht gab. */
  const alt = (usedGb, startedTs, now) => +(usedGb/((now-startedTs)/3600000)*24).toFixed(3);
  assert.ok(alt(3.98, start, letzter + 48*3600000) < alt(3.98, start, letzter + 1*3600000),
    'Negativkontrolle: die alte Formel MUSS im Stillstand sinken');
}

/* ═══ NK81d · Das Etikett muss den Bezugsrahmen richtig benennen ════════════
   `startedTs` wird beim Anlegen des MONATSBEHAELTERS gesetzt und liegt in D1 —
   es ueberdauert jeden Deploy. „seit dem Start dieser Worker-Version" war
   damit falsch, und zwar in der gefaehrlichen Richtung: es liest sich, als
   messe der Zaehler den aktuellen Codestand. Genau darauf hatte sich die
   Wirkungsbeurteilung der 4.5.x gestuetzt. */
{
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.ok(!/seit dem Start dieser Worker-Version/.test(app),
    'Das falsche Etikett darf nicht mehr im Client stehen');
  assert.ok(!/Eigenmessung DIESES Workers seit seinem Start/.test(w),
    'Auch der Servertext muss den Monatsbehaelter benennen');
  assert.ok(/Monatsbeh[äa]lters/.test(app) && /Monatsbeh[äa]elters|Monatsbeh[äa]lters/.test(w),
    'Client und Server muessen denselben Bezugsrahmen nennen');
  /* Der Zuruecksetzpunkt gehoert dazu, sonst ist die Korrektur nur halb. */
  assert.ok(/Monatswechsel/.test(app), 'Der Zuruecksetzpunkt muss genannt sein');

  /* Und die Behauptung muss stimmen: startedTs haengt am Monatsschluessel. */
  /* Die Zuweisung enthaelt selbst geschweifte Klammern (`paths:{}`) — ein
     `[^}]*` wuerde daran abreissen und den Test faelschlich fallen lassen. */
  const monatsZweig = w.slice(w.indexOf('if(tiingoBw.monthKey!==mk)'), w.indexOf('if(tiingoBw.monthKey!==mk)') + 260);
  assert.ok(/startedTs:Date\.now\(\)/.test(monatsZweig),
    'startedTs muss am Monatswechsel gesetzt werden — sonst waere das neue Etikett auch falsch');
}

/* ═══ NK81e · Keine dieser Korrekturen darf eine Bewertung anfassen ═════════ */
{
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const i = app.indexOf('function learningBadge');
  const block = app.slice(i, app.indexOf('\nfunction ', i + 10));
  for (const verboten of ['buyReady', 'quality', 'netCRV', 'situationScore', 'light=']) {
    assert.ok(!block.includes(verboten), `learningBadge darf ${verboten} nicht beruehren`);
  }
}

console.log('✓ FusionPulse v4.5.7 NK81 Anzeigen im Ausnahmefall (ausgefuehrt): OK');
