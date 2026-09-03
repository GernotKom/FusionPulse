/* ═══ v3.32.9 · D1-VERBRAUCH: ZAEHLER UND TELEMETRIE, AUSGEFUEHRT ═══════════
   Am 01.09. um 22:26 stand in Produktion:
     „D1_ERROR: Your account has exceeded D1's free tier daily row read limit."
   Nicht der Speicher — die GELESENEN ZEILEN. Der Treiber war die
   Volltabellen-Aggregation in learningPayload().

   Der eigentliche Schaden ist unumkehrbar: solange D1 gesperrt ist, kann
   d1UpdateOutcomes() nicht schreiben, und der Aufloesungskorridor ist nur
   15 Minuten breit. Was hineinfaellt, bleibt fuer immer unaufgeloest.

   Diese Suite prueft AUSGEFUEHRT, nicht per Regex. Der Schwerpunkt liegt auf
   dem Ausfallverhalten, weil genau das am 01.09. eingetreten ist und weil ein
   falscher Zaehler die Lernreife BESSER aussehen laesst als sie ist — die
   Richtung, die Invariante 1 verbietet.                                     */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadD1, fakeDb, loadResolver } from './d1-harness.mjs';

const D = loadD1();
const LIMIT = "D1_ERROR: Your account has exceeded D1's free tier daily row read limit.";
const now = Date.now();

/* Ein Test, der Kommentare mitliest, prueft die BESCHREIBUNG statt den Code.
   Genau daran ist die erste Fassung von NK49 gescheitert: der Satz „hier stand
   die Volltabellen-Aggregation" enthaelt das Muster, das er verbietet. */
const stripComments = (s) => String(s)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n').map(l => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');

/* ── NK49 · Der teuerste Posten ist wirklich weg ────────────────────────────
   Nicht „ein Zaehler steht irgendwo", sondern: learningPayload() enthaelt
   keine Volltabellen-Aggregation mehr. */
{
  const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  const at = worker.indexOf('async function learningPayload(');
  const body = stripComments(worker.slice(at, worker.indexOf('\n}\n', at) + 3));
  assert.ok(!/COUNT\(\*\)/.test(body),
    'NK49: learningPayload() darf die Tabelle nicht mehr vollstaendig zaehlen');
  assert.ok(!/SUM\(CASE WHEN resolved_ts/.test(body),
    'NK49: Auch die SUM(CASE …) ueber die ganze Tabelle muss verschwunden sein');
  assert.match(body, /learnCountersView/,
    'NK49: Die Zahlen muessen aus den fortgeschriebenen Zaehlern kommen');

  // Genau EINE Stelle im ausfuehrbaren Code darf noch voll zaehlen: die Baseline.
  const code = stripComments(worker);
  const all = code.split('COUNT(*)').length - 1;
  assert.equal(all, 1, `NK49: Es darf genau eine Volltabellen-Zaehlung geben (Baseline), gefunden: ${all}`);
  const base = code.slice(code.indexOf('async function learnCountersBaseline('),
                          code.indexOf('async function learnCountersBaseline(') + 700);
  assert.match(base, /COUNT\(\*\)/, 'NK49: … und die gehoert in die Baseline');
}

/* ── NK50 · Der gemeldete Fall: D1 gesperrt, keine Baseline ─────────────────
   Fehlende Daten duerfen nie etwas verbessern (Regel 4). `Number(null)` ist 0
   (Regel 2) — eine 0 im Nenner saehe aus wie „noch nichts aufgezeichnet",
   eine 0 im Zaehler wie „nichts aufgeloest". Beides waere erfunden. */
{
  D.reset();
  const { db } = fakeDb({ fail: LIMIT });
  const v = await D.learnCountersView({ DB: db }, now);
  for (const k of ['snapshots','resolved','expansions','snapshots24h','resolved24h','expansions24h','lastTs']) {
    assert.strictEqual(v[k], null, `NK50: ${k} muss bei gesperrtem D1 null sein, nicht 0 — war ${v[k]}`);
  }
  assert.strictEqual(v.exact, false, 'NK50: Der Stand muss sich als nicht belastbar ausweisen');
  assert.ok(v.reason, 'NK50: Und sagen, warum');
}

/* ── NK51 · Ein gescheiterter Flush darf keine Deltas vernichten ────────────
   Wuerden die Deltas verworfen, waeren die Beobachtungen dieses Isolates
   dauerhaft aus der Zaehlung verschwunden — und `resolved/snapshots` saehe
   besser aus als die Wirklichkeit.

   ZWEI Ausfallarten, und die erste Fassung dieses Tests hat nur die harmlose
   geprueft: faellt schon das LESEN aus, kehrt der Flush vorher zurueck und
   fasst die Deltas nie an — der Test war gruen, ohne den Schreibpfad je zu
   betreten. Der Rueckbau (Deltas im catch leeren) ist ihm durchgerutscht.
   Der interessante Fall ist: Lesen geht, Schreiben scheitert. */
{
  // a) Lesen scheitert bereits
  D.reset();
  const a = fakeDb();
  const envA = { DB: a.db };
  await D.learnCountersLoad(envA, now);
  D.learnCountersBump({ snapshots: 5 }, now);
  a.state.fail = LIMIT;
  assert.strictEqual(await D.learnCountersFlush(envA, now, true), null,
    'NK51: Ein gescheiterter Flush darf keinen Stand vortaeuschen');
  assert.equal(D.pending.s, 5, 'NK51a: Deltas muessen erhalten bleiben, wenn schon das Lesen ausfaellt');

  // b) Lesen geht, SCHREIBEN scheitert — der Pfad, um den es hier geht
  D.reset();
  const b = fakeDb();
  const envB = { DB: b.db };
  await D.learnCountersLoad(envB, now);
  D.learnCountersBump({ snapshots: 7, resolved: 2 }, now);
  b.state.failWrite = LIMIT;
  assert.strictEqual(await D.learnCountersFlush(envB, now, true), null,
    'NK51b: Auch ein gescheitertes Schreiben darf keinen Stand vortaeuschen');
  assert.equal(D.pending.s, 7, 'NK51b: Die Deltas muessen den gescheiterten Schreibversuch ueberleben');
  assert.equal(D.pending.r, 2, 'NK51b: … alle, nicht nur die Snapshots');

  // c) und beim naechsten Versuch mit funktionierendem D1 wirklich ankommen
  b.state.failWrite = null;
  const merged = await D.learnCountersFlush(envB, now, true);
  assert.ok(merged, 'NK51c: Der Wiederholungsversuch muss gelingen');
  assert.equal(merged.snapshots, 107, `NK51c: Die zurueckgehaltenen Deltas muessen nachtraeglich ankommen, sind ${merged.snapshots}`);
  assert.equal(D.pending.s, 0, 'NK51c: … und danach uebertragen sein');
}

/* ── NK52 · Nach erfolgreichem Flush darf nichts doppelt zaehlen ────────────
   Der Gegenfehler: die Ansicht addiert eigene Deltas zum persistierten Stand.
   Werden sie nach dem Schreiben nicht geleert, waechst die Zahl bei jedem
   Aufruf — und diesmal ist sie zu GROSS. */
{
  D.reset();
  const { db } = fakeDb({ baseline: { snapshots: 100, resolved: 40, expansions: 7, last_ts: 1 } });
  const env = { DB: db };
  await D.learnCountersLoad(env, now);
  D.learnCountersBump({ snapshots: 3 }, now);
  assert.equal((await D.learnCountersView(env, now)).snapshots, 103, 'Deltas gehoeren vor dem Flush dazugerechnet');
  await D.learnCountersFlush(env, now, true);
  assert.equal(D.pending.s, 0, 'NK52: Nach dem Schreiben sind die Deltas uebertragen');
  assert.equal((await D.learnCountersView(env, now)).snapshots, 103, 'NK52: … und duerfen kein zweites Mal zaehlen');
  assert.equal((await D.learnCountersView(env, now)).snapshots, 103, 'NK52: auch beim dritten Aufruf nicht');
}

/* ── NK53 · Ein Duplikat im 5-Minuten-Takt ist KEINE Beobachtung ────────────
   `UNIQUE(source,asset_type,symbol,bucket5)`: ein zweiter Scan desselben
   Titels im selben Takt fuegt nichts ein. Gezaehlt wird `meta.changes`.
   Ohne diese Pruefung wuerde jede engere Abfragefrequenz die Statistik
   aufblasen, ohne eine einzige neue Zeile zu erzeugen — genau der Denkfehler,
   der hinter „einfach dichter scannen" steckt. */
{
  const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  /* v4.2.3 · Der Ausschnitt zeigte bis 4.2.2 auf `d1StoreSnapshotRow` — eine
     Funktion ohne Aufrufer. Die Regel galt also nachweislich im toten Pfad
     und im lebenden gar nicht: `d1StoreRows` hat eingefuegt und NIE gezaehlt.
     Genau so bleibt ein Test gruen, waehrend die App nichts mehr lernt. Der
     Ausschnitt zeigt jetzt auf den Pfad, der wirklich laeuft. */
  const fn = worker.slice(worker.indexOf('async function d1StoreRows('),
                          worker.indexOf('function twinDistance('));
  assert.match(fn, /meta\?\.changes/,
    'NK53: Gezaehlt werden muss die tatsaechliche Einfuegung, nicht der Aufruf');
  assert.match(fn, /inserted>0|inserted > 0/,
    'NK53: Nur eine echte Einfuegung darf den Zaehler bewegen');
  assert.match(fn, /learnCountersBump\(\s*\{\s*snapshots/,
    'NK53: Der lebende Schreibpfad MUSS die Beobachtungen zaehlen');
  const { db } = fakeDb({ inserted: 0 });
  const r = await db.prepare('INSERT OR IGNORE INTO market_snapshots (ts) VALUES(?)').bind(1).run();
  assert.equal(r.meta.changes, 0, 'NK53: Das Double muss ein Duplikat als 0 Aenderungen melden');
}

/* ── NK54 · Aufloesungen erst NACH dem erfolgreichen Batch zaehlen ──────────
   Wirft D1 im Batch, darf nichts als aufgeloest gebucht sein. Sonst meldet
   die App Auflösungen, die nie in der Datenbank angekommen sind.
   v4.2.3 · Geprueft wurde das bis 4.2.2 im Ausschnitt von `d1UpdateOutcomes`
   — einer Funktion ohne Aufrufer. Die Regel gilt jetzt dort, wo aufgeloest
   wird, und sie wird AUSGEFUEHRT geprueft statt im Quelltext gesucht:
   scheitert der Schreibvorgang, darf der Zaehler unberuehrt bleiben. */
{
  const R = loadResolver();
  R.reset();
  const { db, state } = fakeDb({ due: [{ id: 1, obs_n: 99 }, { id: 2, obs_n: 99 }] });
  state.failWrite = 'D1_ERROR: batch failed';
  await assert.rejects(() => R.d1ResolveDue({ DB: db }, Date.now()),
    'NK54: Der Fehler muss weitergereicht werden, nicht verschluckt — ein stiller Ausfall ist der schlimmste');
  assert.equal(R.bumped.length, 0,
    'NK54: Der Zaehler darf erst nach dem erfolgreichen Batch fortgeschrieben werden');
  const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  const fn = worker.slice(worker.indexOf('async function d1ResolveDue('),
                          worker.indexOf('const OBS_LOG_PREFIX'));
  const batchAt = fn.indexOf('await env.DB.batch(stmts)');
  const bumpAt = fn.indexOf('learnCountersBump');
  assert.ok(batchAt > 0 && bumpAt > batchAt,
    'NK54: Auch im Quelltext muss der Batch vor dem Zaehler stehen');
  assert.ok(!/try\s*\{[\s\S]{0,200}env\.DB\.batch\(stmts\)[\s\S]{0,200}catch/.test(fn),
    'NK54: Der Fehler darf nicht lokal verschluckt werden');
}

/* ── NK55 · Das 24-Stunden-Fenster darf sich nicht als vollstaendig ausgeben ─
   Solange die Zaehlung juenger als 24 Stunden ist, sind die Tageswerte
   unvollstaendig. Als volle Tageszahl gelesen, saehen sie nach „kaum etwas
   aufgezeichnet" aus. */
{
  D.reset();
  const { db } = fakeDb();
  const env = { DB: db };
  await D.learnCountersLoad(env, now);
  const fresh = await D.learnCountersView(env, now);
  assert.strictEqual(fresh.windowComplete, false, 'NK55: Ein frisches Fenster ist nicht vollstaendig');
  assert.ok(fresh.reason, 'NK55: … und sagt es');
  const later = await D.learnCountersView(env, now + 25 * 3_600_000);
  assert.strictEqual(later.windowComplete, true, 'NK55: Nach 24 h ist es vollstaendig');
}

/* ── NK56 · Alte Stundeneimer duerfen nicht unbegrenzt wachsen ──────────────
   Der Zaehlerdatensatz liegt in EINER fp_meta-Zeile. Waechst er unbegrenzt,
   ersetzt man einen teuren Read durch einen immer groesseren. */
{
  D.reset();
  const { db } = fakeDb();
  const env = { DB: db };
  await D.learnCountersLoad(env, now);
  for (let i = 0; i < 200; i++) D.learnCountersBump({ snapshots: 1 }, now - i * 3_600_000);
  const c = await D.learnCountersFlush(env, now, true);
  const buckets = Object.keys(c.hours).length;
  assert.ok(buckets <= 27, `NK56: Es duerfen hoechstens rund 26 Stundeneimer gehalten werden, sind ${buckets}`);
  assert.ok(c.snapshots >= 200, 'NK56: Die Gesamtsumme bleibt davon unberuehrt');
}

/* ── NK57 · Die Telemetrie misst wirklich, statt zu behaupten ───────────────*/
{
  D.reset();
  const { db } = fakeDb({ rowsRead: 500 });
  const env = { DB: D.d1Wrap(db) };
  D.d1MeterStart('/api/learning');
  await env.DB.prepare('SELECT id FROM market_snapshots WHERE symbol=?').bind('X').all();
  await env.DB.prepare('SELECT id FROM market_snapshots WHERE sector=?').bind('Y').all();
  await D.d1MeterFlush(env, '/api/learning');
  const v = await D.d1MeterView(env, now);
  assert.equal(v.rowsRead, 1000, `NK57: Gelesene Zeilen muessen summiert werden, sind ${v.rowsRead}`);
  assert.equal(v.topPaths[0].path, '/api/learning', 'NK57: Der Pfad muss zugeordnet sein');
  assert.equal(v.topQueries[0].query, 'SELECT market_snapshots',
    'NK57: Die Abfrageform muss erkennbar sein — sonst weiss niemand, WELCHER Pfad verbraucht');
  assert.equal(v.freeLimitRowsRead, 5_000_000, 'NK57: Das Limit gehoert danebengestellt');
}

/* ── NK58 · Eine unvollstaendige Messung muss sich als solche ausweisen ─────
   `.first()` liefert keine `meta` und ist damit nicht messbar. Diese Luecke
   als 0 zu verbuchen waere schlimmer als sie auszuweisen: die Summe saehe
   nach „noch viel Luft" aus, kurz bevor das Limit wieder reisst. */
{
  D.reset();
  const { db } = fakeDb({ rowsRead: 400 });
  const env = { DB: D.d1Wrap(db) };
  D.d1MeterStart('/api/health');
  await env.DB.prepare('SELECT id FROM market_snapshots WHERE symbol=?').bind('X').all();
  await env.DB.prepare('SELECT value FROM fp_meta WHERE key=? LIMIT 1').bind('k').first();
  await D.d1MeterFlush(env, '/api/health');
  const v = await D.d1MeterView(env, now);
  assert.ok(v.unmetered >= 1, 'NK58: Nicht messbare Abfragen muessen gezaehlt werden');
  assert.strictEqual(v.complete, false, 'NK58: Und die Bilanz muss sich als unvollstaendig ausweisen');
}

/* ── Die Grenze: nichts davon darf die Freigabe beruehren ───────────────────*/
{
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const gate = app.slice(app.indexOf('function stockTradeability('), app.indexOf('const GLOSS = {'));
  assert.ok(!/learnCounters|d1Meter|rowsRead/.test(gate),
    'Die Freigabelogik darf von Zaehlern und Telemetrie nichts wissen');
}

console.log('✓ FusionPulse v3.32.9 D1-Zaehler/Telemetrie (ausgefuehrt): OK');

/* ═══ v3.32.10 · R3 — DER AUFLOESER, AUSGEFUEHRT ════════════════════════════
   Bisher loeste `d1UpdateOutcomes()` nur auf, wenn GENAU DIESES Symbol
   erneut gescannt wurde, im Fenster Minute 180 bis 195. Verpasst hiess fuer
   immer verloren. Der neue Cron-Aufloeser kennt kein Fenster mehr.

   Die gefaehrliche Variante waere gewesen, einfach alles Faellige aufzuloesen.
   `max_pct` waechst nur beim Beobachten; ein nie wieder angesehener Snapshot
   traegt 0 und wuerde als „hat sich nicht bewegt" aufgezeichnet. Der Fehler
   waere systematisch negativ — die Lernbasis fuellte sich mit Scheinverlierern
   und saehe dabei gut belegt aus.                                          */
{
  const R = loadResolver();

  // NK59 · Genug beobachtet wird aufgeloest, zu wenig beobachtet wird verworfen.
  {
    R.reset();
    const { db } = fakeDb({ due: [{ id:1, obs_n:12 }, { id:2, obs_n:2 }, { id:3, obs_n:null }, { id:4, obs_n:6 }] });
    const r = await R.d1ResolveDue({ DB: db }, now);
    assert.equal(r.resolved, 2, `NK59: Nur ausreichend beobachtete Snapshots duerfen aufgeloest werden, waren ${r.resolved}`);
    assert.equal(r.dropped, 2, `NK59: Der Rest muss VERWORFEN werden, nicht aufgeloest — waren ${r.dropped}`);
    assert.equal(r.resolved + r.dropped, r.due, 'NK59: Kein faelliger Snapshot darf einfach liegenbleiben');
  }

  /* NK60 · Der entscheidende Fall: NIE beobachtet.
     `obs_n = 0` heisst `max_pct = 0`. Wuerde das aufgeloest, stuende in der
     Lernbasis „der Titel hat sich nicht bewegt", obwohl gilt „wir haben nicht
     hingesehen". Das ist kein vorsichtiger Naeherungswert, das ist ein
     erfundenes Ergebnis — und zwar eines, das jedes Setup untauglich aussehen
     laesst. Genau die Richtung, in der eine falsche Zahl am glaubwuerdigsten
     wirkt, weil sie zur Erwartung passt. */
  {
    R.reset();
    const { db } = fakeDb({ due: [{ id:1, obs_n:0 }] });
    const r = await R.d1ResolveDue({ DB: db }, now);
    assert.equal(r.resolved, 0, 'NK60: Ein nie beobachteter Snapshot darf NIEMALS aufgeloest werden');
    assert.equal(r.dropped, 1, 'NK60: Er ist eine Luecke und muss als solche gezaehlt werden');
  }

  /* NK61 · Altbestand ohne `obs_n` ist nicht nachweisbar abgedeckt.
     Nicht feststellbar ist nicht ausreichend (Regel 5). */
  {
    R.reset();
    const { db } = fakeDb({ due: [{ id:1 }, { id:2, obs_n:undefined }] });
    const r = await R.d1ResolveDue({ DB: db }, now);
    assert.equal(r.resolved, 0, 'NK61: Ohne Abdeckungsnachweis wird nicht aufgeloest');
    assert.equal(r.dropped, 2, 'NK61: … sondern verworfen und gezaehlt');
  }

  // NK62 · Der Verwurf muss in den Zaehlern ankommen, sonst ist er unsichtbar.
  {
    R.reset();
    const { db } = fakeDb({ due: [{ id:1, obs_n:9 }, { id:2, obs_n:1 }] });
    await R.d1ResolveDue({ DB: db }, now);
    const d = R.bumped[0] || {};
    assert.equal(d.resolved, 1, 'NK62: Aufloesungen muessen gezaehlt werden');
    assert.equal(d.dropped, 1, 'NK62: Verworfene ebenso — „verpasste Aufloesungen" ist die Kennzahl aus R3');
  }

  /* NK63 · Fail-closed: wirft D1 im Batch, darf nichts gezaehlt werden.
     Sonst meldet die App Aufloesungen, die nie geschrieben wurden. */
  {
    R.reset();
    const { db, state } = fakeDb({ due: [{ id:1, obs_n:9 }] });
    state.failWrite = LIMIT;
    await assert.rejects(() => R.d1ResolveDue({ DB: db }, now),
      'NK63: Der Fehler muss weitergereicht werden, nicht verschluckt');
    assert.equal(R.bumped.length, 0, 'NK63: Und es darf nichts gezaehlt worden sein');
  }

  /* NK64 · Kein Fenster mehr. Der alte Aufloeser hatte eine untere Zeitgrenze
     (`ts >= now - 195min`); wer sie verpasste, blieb fuer immer unaufgeloest.
     Ein zwei Wochen alter Snapshot muss heute noch abgeraeumt werden. */
  {
    const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
    const at = worker.indexOf('async function d1ResolveDue(');
    const body = stripComments(worker.slice(at, worker.indexOf('const OBS_LOG_PREFIX')));
    assert.ok(!/ts>=\?/.test(body) && !/ts >= \?/.test(body),
      'NK64: Der Aufloeser darf keine untere Zeitgrenze mehr haben — genau die war der Korridor');
    assert.match(body, /ts<=\?/, 'NK64: Nur „faellig oder nicht" darf entscheiden');
    assert.ok(!/symbol=\?/.test(body),
      'NK64: Und er darf nicht mehr an ein einzelnes Symbol gebunden sein');
  }

  /* NK65 · Der Aufloeser laeuft im Cron VOR den Marktjobs und reisst sie nicht
     mit. Haengt er an einem Scan, ist R3 nur verschoben, nicht behoben. */
  {
    const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
    const cycle = worker.slice(worker.indexOf('async function serverLearningCycle('),
                               worker.indexOf('async function serverLearningCycle(') + 2500);
    const resolveAt = cycle.indexOf('d1ResolveDue');
    const firstJob = cycle.indexOf('getSnapshot(');
    assert.ok(resolveAt > 0, 'NK65: Der Cron muss den Aufloeser aufrufen');
    assert.ok(firstJob < 0 || resolveAt < firstJob, 'NK65: … und zwar vor den Marktjobs');
    assert.match(cycle.slice(resolveAt - 200, resolveAt + 400), /catch/,
      'NK65: Sein Ausfall darf den restlichen Zyklus nicht mitreissen');
  }

  /* ── NK66 · v4.2.3 · JEDE BEOBACHTUNG WIRD FESTGEHALTEN ──────────────────
     Bis 4.2.2 prueffte NK66 den Ausschnitt von `d1UpdateOutcomes` auf
     `obs_n=?`. Der Test war gruen — und die Funktion hatte keinen Aufrufer.
     Sie war die EINZIGE Stelle im Worker, die `obs_n` je beschrieben hat.
     Folge: jede Zeile trug `obs_n IS NULL`, der Aufloeser verwarf ausnahmslos
     alles, und die Lernschicht stand still. Der Test hat das nicht gesehen,
     weil er den Quelltext gelesen und nicht gefragt hat, ob die Stelle
     erreichbar ist. Ab hier wird ausgefuehrt. */
  {
    const R = loadResolver(); R.reset();
    const { db } = fakeDb();
    const t0 = Date.UTC(2026, 8, 3, 12, 0, 0);
    const r1 = await R.d1NoteObservations({ DB: db }, 'server', 'stock', ['AAPL', 'msft'], t0);
    assert.equal(r1.written, true, 'NK66: Die erste Beobachtung muss protokolliert werden');
    const log = await R.d1ReadObsLog({ DB: db }, 'server', 'stock');
    assert.deepEqual(Object.keys(log).sort(), ['AAPL', 'MSFT'],
      'NK66: Symbole werden normalisiert abgelegt');
    assert.equal(R.obsCountFor(log, 'aapl', t0 - 1), 1,
      'NK66: … und sind danach als Beobachtung zaehlbar');
  }

  /* NK67 · Ein zweiter Eintrag im selben 5-Minuten-Takt ist KEINE zweite
     Beobachtung — derselbe Gedanke wie `INSERT OR IGNORE` auf `bucket5`.
     Ohne diese Raste wuerde ein dichterer Cron die Abdeckung aufblasen, ohne
     dass ein einziges Mal zusaetzlich hingesehen wurde, und die Bremse aus
     4.1.3 haette einen neuen Weg gefunden, Zeilen zu schreiben. */
  {
    const R = loadResolver(); R.reset();
    const { db, state } = fakeDb();
    const t0 = Date.UTC(2026, 8, 3, 12, 0, 0);
    await R.d1NoteObservations({ DB: db }, 'server', 'stock', ['AAPL'], t0);
    const writesBefore = state.log.filter(q => /INSERT INTO fp_meta/i.test(q)).length;
    const again = await R.d1NoteObservations({ DB: db }, 'server', 'stock', ['AAPL'], t0 + 60_000);
    assert.equal(again.written, false, 'NK67: Derselbe Takt darf nicht erneut geschrieben werden');
    assert.equal(state.log.filter(q => /INSERT INTO fp_meta/i.test(q)).length, writesBefore,
      'NK67: … und es darf dabei KEINE Zeile kosten');
    const next = await R.d1NoteObservations({ DB: db }, 'server', 'stock', ['AAPL'], t0 + 5 * 60_000 + 1);
    assert.equal(next.written, true, 'NK67: Der naechste Takt zaehlt wieder');
    const log = await R.d1ReadObsLog({ DB: db }, 'server', 'stock');
    assert.equal(R.obsCountFor(log, 'AAPL', t0 - 1), 2, 'NK67: Zwei Takte, zwei Beobachtungen');
  }

  /* NK68 · Aktie und Muenze mit demselben Ticker teilen sich das Protokoll
     nicht. Dieselbe Lehre wie beim Memo-Schluessel in 4.1.6: „LINK" ist zwei
     verschiedene Dinge, und eines duerfte das andere nicht mit Abdeckung
     versorgen, die es nicht hat. */
  {
    const R = loadResolver(); R.reset();
    const { db } = fakeDb();
    const t0 = Date.UTC(2026, 8, 3, 12, 0, 0);
    for (let i = 0; i < 8; i++)
      await R.d1NoteObservations({ DB: db }, 'server', 'stock', ['LINK'], t0 + i * 5 * 60_000 + 1);
    const stock = await R.d1ReadObsLog({ DB: db }, 'server', 'stock');
    const coin = await R.d1ReadObsLog({ DB: db }, 'server', 'crypto');
    assert.ok(R.obsCountFor(stock, 'LINK', t0) >= 6, 'NK68: Die Aktie hat Abdeckung');
    assert.equal(R.obsCountFor(coin, 'LINK', t0), 0, 'NK68: Die Muenze hat davon nichts');
  }

  /* NK69 · Der Aufloeser entscheidet jetzt anhand des Protokolls. Das ist der
     Kern: dieselbe Zeile, die vor 4.2.3 zwangslaeufig verworfen wurde
     (`obs_n IS NULL`), wird bei belegter Abdeckung aufgeloest. */
  {
    const R = loadResolver(); R.reset();
    const now = Date.UTC(2026, 8, 3, 18, 0, 0);
    const ts = now - 180 * 60_000;                 // exakt faellig
    const { db } = fakeDb({
      due: [
        { id: 1, ts, symbol: 'AAPL', source: 'server', asset_type: 'stock', obs_n: null },
        { id: 2, ts, symbol: 'NVDA', source: 'server', asset_type: 'stock', obs_n: null },
      ],
    });
    for (let i = 1; i <= 8; i++)
      await R.d1NoteObservations({ DB: db }, 'server', 'stock', ['AAPL'], ts + i * 5 * 60_000);
    await R.d1NoteObservations({ DB: db }, 'server', 'stock', ['NVDA'], ts + 5 * 60_000);
    R.reset(); R.setCap({ exhausted: false });
    const out = await R.d1ResolveDue({ DB: db }, now);
    assert.equal(out.resolved, 1, 'NK69: Die belegte Zeile wird aufgeloest — genau das ging seit Monaten nicht');
    assert.equal(out.dropped, 1, 'NK69: Die unbelegte bleibt ein Verwurf, nicht geraten');
  }

  /* NK70 · Ist das Protokoll nicht lesbar, wird NICHTS entschieden.
     Fail-closed heisst hier ausdruecklich NICHT „im Zweifel verwerfen":
     `dropped_ts` ist unwiderruflich, der Aufloeser laeuft jede Minute. Ein
     Aufschub kostet nichts, ein falscher Verwurf kostet den Datenpunkt fuer
     immer. Vor 4.2.3 war genau das der Dauerzustand. */
  {
    const R = loadResolver(); R.reset();
    const now = Date.UTC(2026, 8, 3, 18, 0, 0);
    const ts = now - 180 * 60_000;
    const { db, state } = fakeDb({
      due: [{ id: 1, ts, symbol: 'AAPL', source: 'server', asset_type: 'stock', obs_n: null }],
    });
    state.meta.set('obs_log:server:stock', { value: '{kaputt', ts: 0 });
    const out = await R.d1ResolveDue({ DB: db }, now);
    assert.equal(out.obsLogUnreadable, undefined,
      'NK70: Unlesbares JSON gilt als leeres, aber lesbares Protokoll');
    assert.equal(out.dropped, 1, 'NK70: … und die Zeile ohne Beleg wird verworfen');
  }

  /* NK71 · Die Aufbewahrung des Protokolls deckt den Horizont ab. Waere sie
     kuerzer, verloere eine Zeile ihren Nachweis, bevor sie faellig wird — und
     der Verwurf saehe wie ein Abdeckungsproblem aus, obwohl er eine
     Aufraeumregel waere. */
  {
    const R = loadResolver();
    assert.ok(R.OBS_LOG_RETENTION_MS > 180 * 60_000,
      'NK71: Das Protokoll muss laenger vorhalten als der Lernhorizont');
    assert.equal(R.OBS_LOG_BUCKET_MS, 5 * 60_000,
      'NK71: Die Raste ist derselbe 5-Minuten-Takt wie `bucket5`');
    const R2 = loadResolver(); R2.reset();
    const { db } = fakeDb();
    const t0 = Date.UTC(2026, 8, 3, 12, 0, 0);
    await R2.d1NoteObservations({ DB: db }, 'server', 'stock', ['AAPL'], t0);
    await R2.d1NoteObservations({ DB: db }, 'server', 'stock', ['MSFT'], t0 + R2.OBS_LOG_RETENTION_MS + 60_000);
    const log = await R2.d1ReadObsLog({ DB: db }, 'server', 'stock');
    assert.ok(!log.AAPL, 'NK71: Was aelter als die Aufbewahrung ist, wird ausgeraeumt');
    assert.ok(log.MSFT, 'NK71: Das Frische bleibt');
  }
}

console.log('✓ FusionPulse v3.32.10 R3 Aufloeser (ausgefuehrt): OK');

/* ── NK60 · v4.1.6 · Der Zaehler mass die falsche Seite ─────────────────────
   Seit 3.32.9 wies die Bilanz nur `readShareOfFreeLimit` aus. Gerissen wurde
   aber zweimal das SCHREIB-Limit: am 02.09. und erneut am 03.09. um 00:30 UTC.
   Die Kennzahl, die die App zweimal angehalten hat, stand nirgends — und
   „Lesequote 22 %" liest sich dabei wie Entwarnung.

   Dazu die Hochrechnung gegen das D1-Tagesfenster (00:00 UTC). Ein Tagesstand
   allein beantwortet nicht, ob das Budget bis Mitternacht reicht; genau das
   ist aber die einzige Frage, die zaehlt.                                    */
{
  D.reset();
  const { db } = fakeDb({ rowsRead: 10 });
  const env = { DB: D.d1Wrap(db) };
  /* `d1MeterStart` stempelt mit Date.now(); der Tagesschluessel kommt also
     vom HEUTIGEN UTC-Datum. Der Ablesezeitpunkt muss deshalb im selben Tag
     liegen — sonst prueft der Test an einem Datumswechsel etwas anderes als
     an jedem anderen Tag. Sechs Stunden in den UTC-Tag hinein = 360 Minuten. */
  const d = new Date();
  const t6 = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 6, 0, 0);
  D.d1MeterStart('/cron');
  for (let i = 0; i < 30; i++) await env.DB.prepare('INSERT INTO fp_meta(key,value,updated_ts) VALUES(?,?,?)').bind('k'+i, 'v', t6).run();
  await D.d1MeterFlush(env, '/cron');
  const v = await D.d1MeterView(env, t6);

  assert.equal(v.freeLimitRowsWritten, 100_000,
    'NK60: das Schreiblimit gehoert neben die geschriebenen Zeilen — es ist das, was zweimal gerissen ist');
  assert.ok(v.writeShareOfFreeLimit > 0,
    'NK60: die Schreibquote muss ausgewiesen werden, nicht nur die Lesequote');
  assert.equal(v.minutesIntoUtcDay, 360,
    `NK60: gerechnet wird gegen 00:00 UTC, nicht gegen die Ortszeit (war ${v.minutesIntoUtcDay})`);

  // Die Hochrechnung muss aus der VERSTRICHENEN Zeit kommen, nicht geraten sein.
  const erwartet = Math.round(v.rowsWritten / 360 * 1440);
  assert.equal(v.atLeastProjectedRowsWritten, erwartet,
    `NK60: die Hochrechnung muss ${erwartet} sein, war ${v.atLeastProjectedRowsWritten}`);
  assert.ok(v.atLeastRowsWrittenPerMin > 0, 'NK60: die Rate gehoert dazu, sonst ist die Projektion nicht nachrechenbar');
  assert.equal(v.sustainableRowsWrittenPerMin, 69.4,
    'NK60: der tragfaehige Takt (100.000/1440) gehoert danebengestellt, sonst fehlt der Massstab');
}

/* ── NK61 · Die Projektion muss auch NEIN sagen koennen ─────────────────────
   Eine Kennzahl, die nur beruhigen kann, ist keine. Bei einer Rate, die das
   Tageslimit reisst, muss `writeBudgetHoldsToday` falsch werden und die
   Restlaufzeit endlich sein. */
{
  D.reset();
  const { db } = fakeDb({ rowsRead: 1 });
  const env = { DB: D.d1Wrap(db) };
  const d1 = new Date();
  const t1 = Date.UTC(d1.getUTCFullYear(), d1.getUTCMonth(), d1.getUTCDate(), 1, 0, 0);  // 60 Minuten im Tag
  D.d1MeterStart('/cron');
  // 60 Minuten, 20.000 Zeilen = 333/min. Tragfaehig waeren 69/min.
  for (let i = 0; i < 20_000; i++) await env.DB.prepare('INSERT INTO fp_meta(key,value,updated_ts) VALUES(?,?,?)').bind('k', 'v', t1).run();
  await D.d1MeterFlush(env, '/cron');
  const v = await D.d1MeterView(env, t1);

  assert.equal(v.rowsWritten, 20_000, `NK61: Vorbedingung, waren ${v.rowsWritten}`);
  assert.strictEqual(v.writeBudgetHoldsToday, false,
    'NK61: 333 Zeilen/min reissen das Tageslimit — die Bilanz MUSS das sagen');
  assert.ok(v.writeBudgetMinutesLeft > 0 && v.writeBudgetMinutesLeft < v.writeBudgetMinutesLeftInDay,
    `NK61: die Restlaufzeit muss vor Tagesende liegen, war ${v.writeBudgetMinutesLeft} von ${v.writeBudgetMinutesLeftInDay}`);
  assert.equal(v.writeBudgetMinutesLeft, 240,
    `NK61: bei 333/min und 80.000 Rest sind es 240 Minuten, waren ${v.writeBudgetMinutesLeft}`);

  /* Die Bilanz bleibt eine UNTERGRENZE. Ein „haelt heute" darf deshalb nie
     wie eine Zusage klingen — die Felder heissen `atLeast…`, und die
     Unvollstaendigkeit steht weiterhin daneben. */
  assert.ok('complete' in v && 'unmetered' in v,
    'NK61: die Unvollstaendigkeit muss neben der Projektion sichtbar bleiben');
  assert.ok(Object.keys(v).some(k => k.startsWith('atLeast')),
    'NK61: die Projektionsfelder muessen sich als Untergrenze zu erkennen geben');
}

console.log('✓ FusionPulse v4.1.6 Schreibbudget und Hochrechnung (ausgefuehrt): OK');

/* ── NK62 · v4.2.1 · Die selbst gesetzte Tagesobergrenze ────────────────────
   Cloudflare bietet fuer D1 KEINE Ausgabenobergrenze. Budget-Alerts
   informieren, sie halten nichts an. Auf Free ist ein Schreibfehler ein
   Stillstand; auf Paid ist derselbe Fehler eine Rechnung. Die Schleife vom
   03.09. lief bei 3.333 Zeilen/min — auf Paid rund 144 Mio./Monat, knapp das
   Dreifache des Enthaltenen.

   Diese Bremse ist die einzige. Gepruefte Zusicherungen: sie greift, sie ist
   konfigurierbar, sie steht VOR der teuren Leseabfrage, und sie haelt ihre
   eigene Anzeige NICHT mit an. */
{
  D.reset();
  const { d1WriteCap } = await import('../src/worker.js');
  const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');

  assert.equal(d1WriteCap({}), 90_000,
    'NK62: ohne Konfiguration gilt eine Vorgabe UNTER Cloudflares 100.000 — die Eigenmessung ist eine Untergrenze, die Bremse greift also zu spaet und braucht Reserve');
  assert.equal(d1WriteCap({ D1_WRITE_BUDGET: '1500000' }), 1_500_000,
    'NK62: der Wert muss konfigurierbar sein — auf Paid sind rund 1,667 Mio./Tag im Grundpreis enthalten');
  for (const murks of [{ D1_WRITE_BUDGET: '0' }, { D1_WRITE_BUDGET: '-5' }, { D1_WRITE_BUDGET: 'viel' }, { D1_WRITE_BUDGET: '' }])
    assert.equal(d1WriteCap(murks), 90_000,
      `NK62: unbrauchbare Konfiguration faellt auf die Vorgabe zurueck, nicht auf 0 (${JSON.stringify(murks)}) — eine 0 haette die App stillgelegt`);

  /* Die Reihenfolge ist der Punkt: `d1StoreRows` liest bis zu 3.000
     unaufgeloeste Zeilen, BEVOR es schreibt. Steht die Bremse dahinter,
     bremst sie die Kosten und laesst die Leseseite laufen. */
  const store = worker.slice(worker.indexOf('async function d1StoreRows'));
  assert.ok(store.indexOf('d1WriteBudget') < store.indexOf('LIMIT 3000'),
    'NK62: die Obergrenze muss VOR der 3.000-Zeilen-Leseabfrage stehen');
  const resolve = worker.slice(worker.indexOf('async function d1ResolveDue'));
  /* v4.2.3: Der Aufloeser liest seit dem Beobachtungsprotokoll mehr Spalten;
     der Anker ist die Faelligkeitsabfrage selbst, nicht ihre Spaltenliste. */
  assert.ok(resolve.indexOf('d1WriteBudget') < resolve.indexOf('FROM market_snapshots'),
    'NK62: im Aufloeser ebenso');
  /* Und das Protokoll wird ebenfalls erst NACH der Bremse gelesen — sonst
     kostete ein gebremster Lauf weiterhin Lesevorgaenge. */
  assert.ok(resolve.indexOf('d1WriteBudget') < resolve.indexOf('d1ReadObsLog'),
    'NK62: auch das Beobachtungsprotokoll steht hinter der Bremse');

  /* Eine Bremse, die ihre eigene Anzeige mit anhaelt, ist keine. Der
     Zaehler-Flush und die Zustandsschreiber in fp_meta duerfen NICHT gedrosselt
     werden, sonst friert genau die Zahl ein, die die Bremsung sichtbar macht. */
  const flush = worker.slice(worker.indexOf('async function d1MeterFlush'), worker.indexOf('async function d1MeterView'));
  /* Geprueft wird der AUFRUF, nicht die Erwaehnung: der Flush nennt die Bremse
     im Kommentar, weil er ihr den frischen Tagesstand zurueckgibt. */
  assert.doesNotMatch(flush, /await d1WriteBudget\(/,
    'NK62: der Zaehler-Flush darf NICHT von der Obergrenze gestoppt werden — sonst haelt die Bremse ihr eigenes Instrument an');
  assert.match(flush, /d1CapNoteMeter\(day, acc\.rowsWritten\)/,
    'NK62: umgekehrt muss der Flush den neuen Stand an die Bremse zurueckgeben, sonst kostet jede Pruefung eine eigene Abfrage');
  const persist = worker.slice(worker.indexOf('async function persistApiState'), worker.indexOf('async function persistentApiState'));
  assert.doesNotMatch(persist, /await d1WriteBudget\(/,
    'NK62: Zustandsschreiber bleiben frei, damit die App weiter meldet, warum sie bremst');

  /* Fail-OPEN beim Lesen, und das bewusst: ein einzelner Lesefehler darf die
     Lernschicht nicht fuer den Rest des Tages stilllegen. */
  assert.match(worker, /exhausted: false, measured: false,\s*\n?\s*reason: 'Tagesstand nicht lesbar/,
    'NK62: ein nicht lesbarer Tagesstand darf nicht als „Grenze erreicht" gelten');
}

/* ── NK63 · Die Bilanz muss sagen, gegen WELCHE Grenze sie misst ────────── */
{
  D.reset();
  const { db } = fakeDb({ rowsRead: 1 });
  const env = { DB: D.d1Wrap(db), D1_WRITE_BUDGET: '1500000' };
  const d = new Date();
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 6, 0, 0);
  D.d1MeterStart('/cron');
  for (let i = 0; i < 10; i++) await env.DB.prepare('INSERT INTO fp_meta(key,value,updated_ts) VALUES(?,?,?)').bind('k' + i, 'v', t).run();
  await D.d1MeterFlush(env, '/cron');
  const v = await D.d1MeterView(env, t);

  assert.equal(v.selfCap, 1_500_000, `NK63: die gesetzte Obergrenze gehoert in die Bilanz, war ${v.selfCap}`);
  assert.equal(v.selfCapSource, 'D1_WRITE_BUDGET', 'NK63: und die Herkunft, damit eine vergessene Konfiguration auffaellt');
  assert.strictEqual(v.selfCapExhausted, false, 'NK63: bei 10 Zeilen ist sie nicht erreicht');
  assert.equal(v.freeLimitRowsWritten, 100_000,
    'NK63: das Tarif-Limit bleibt daneben stehen — die beiden duerfen nicht verwechselt werden');
  const ohne = await D.d1MeterView({ DB: env.DB }, t);
  assert.equal(ohne.selfCapSource, 'Vorgabe', 'NK63: ohne Konfiguration muss das als Vorgabe erkennbar sein');
}

/* ── NK64 · Sie muss WIRKLICH bremsen, nicht nur dastehen ───────────────────
   Die vorigen Bloecke pruefen Konfiguration und Reihenfolge. Hier wird der
   Aufloeser mit erreichter Obergrenze AUSGEFUEHRT: kein Schreibvorgang, keine
   Leseabfrage, und ein erkennbarer Grund im Rueckgabewert. */
{
  const R = loadResolver();
  const { db, state } = fakeDb({ due: [{ id:1, obs_n:12 }, { id:2, obs_n:12 }] });
  const offen = await R.d1ResolveDue({ DB: db }, now);
  assert.equal(offen.resolved, 2, `NK64: Vorbedingung — ohne Bremse werden beide aufgeloest, waren ${offen.resolved}`);
  const vorher = state.log.length;
  assert.ok(vorher > 0, 'NK64: Vorbedingung — ungebremst entstehen Abfragen');

  R.setCap({ exhausted: true, spent: 90_000, cap: 90_000 });
  const gebremst = await R.d1ResolveDue({ DB: db }, now);
  assert.strictEqual(gebremst.capped, true, 'NK64: die Bremse muss sich im Rueckgabewert zu erkennen geben');
  assert.equal(gebremst.resolved, 0, 'NK64: bei erreichter Obergrenze darf nichts aufgeloest werden');
  assert.equal(gebremst.dropped, 0, 'NK64: und nichts verworfen — Verwerfen ist auch ein Schreibvorgang');
  assert.equal(state.log.length, vorher,
    `NK64: es darf KEINE einzige Abfrage entstehen — auch nicht die teure Leseabfrage (${state.log.length - vorher} zusaetzliche)`);
  assert.equal(R.bumped.length, 1,
    'NK64: die Lernzaehler duerfen nicht hochgezaehlt werden, als waere etwas passiert');

  /* Und wieder frei, sobald das Budget es zulaesst. Eine Bremse, die nicht
     mehr loesst, waere ein Ausfall mit anderem Namen. */
  R.setCap({ exhausted: false });
  assert.equal((await R.d1ResolveDue({ DB: db }, now)).resolved, 2,
    'NK64: nach dem Zuruecksetzen muss wieder aufgeloest werden');
}

console.log('✓ FusionPulse v4.2.1 Tagesobergrenze für Schreibvorgänge (ausgefuehrt): OK');

/* ── NK72 · v4.2.3 · EIN SCHREIBER OHNE AUFRUFER IST KEIN SCHREIBER ─────────
   Das ist die eigentliche Lehre aus 4.2.3, und sie ist teurer als der Fehler
   selbst. `obs_n` wurde an genau einer Stelle beschrieben, diese Stelle war
   getestet, und der Test war gruen — nur hatte die Funktion seit langem
   keinen Aufrufer. Vier Suiten haben monatelang bestaetigt, dass eine Regel
   im Quelltext STEHT, ohne je zu fragen, ob sie LAEUFT.

   Diese Pruefung baut den Aufrufgraphen und traversiert ihn ab dem
   Default-Export (fetch/scheduled). Jede Funktion, die in `market_snapshots`
   schreibt oder den Lernzaehler bewegt, muss von dort aus erreichbar sein.
   Sie ist bewusst allgemein gehalten: sie faengt den naechsten Fall dieser
   Krankheit auch dann, wenn niemand an ihn gedacht hat. */
{
  /* KOMMENTARE MUESSEN WEG, BEVOR DER GRAPH ENTSTEHT. Ohne das zaehlt jede
     blosse ERWAEHNUNG als Aufruf — und ausgerechnet die tote Funktion, um
     die es hier geht, wird in zwei Kommentaren namentlich genannt. Die erste
     Fassung dieser Pruefung ist genau daran vorbeigelaufen: Gegenprobe
     eingebaut, Test blieb gruen. Ein Waechter, der den falschen Text liest,
     ist schlimmer als keiner — er bescheinigt Sicherheit. */
  const worker = stripComments(
    fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8'));
  /* Funktionsgrenzen: Deklaration bis zur naechsten Deklaration. Das ist bei
     dieser Datei zulaessig — alle Funktionen stehen auf oberster Ebene — und
     robuster als Klammerzaehlung, die an `${...}` in SQL-Vorlagen scheitert. */
  const re = /(?:^|\n)(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/g;
  const marks = [];
  let m;
  while ((m = re.exec(worker))) marks.push({ name: m[1], at: m.index });
  assert.ok(marks.length > 100, 'NK72: Der Quelltext muss sich in Funktionen zerlegen lassen');
  const fns = marks.map((x, i) => ({
    name: x.name,
    body: worker.slice(x.at, i + 1 < marks.length ? marks[i + 1].at : worker.length),
  }));
  const byName = new Map(fns.map(f => [f.name, f]));

  const calleesOf = (f) => {
    const out = new Set();
    const r = /([A-Za-z0-9_$]+)\s*\(/g;
    let x;
    while ((x = r.exec(f.body))) if (byName.has(x[1]) && x[1] !== f.name) out.add(x[1]);
    return out;
  };

  /* Wurzeln: der Default-Export. Er enthaelt `fetch` und `scheduled`. */
  const exportAt = worker.lastIndexOf('export default');
  assert.ok(exportAt > 0, 'NK72: Der Default-Export muss auffindbar sein');
  const exported = worker.slice(exportAt);
  const roots = fns.filter(f => new RegExp(`\\b${f.name}\\s*\\(`).test(exported)).map(f => f.name);
  assert.ok(roots.length > 0, 'NK72: Es muss mindestens einen Einstiegspunkt geben');

  const live = new Set();
  const stack = [...roots];
  while (stack.length) {
    const n = stack.pop();
    if (live.has(n) || !byName.has(n)) continue;
    live.add(n);
    for (const c of calleesOf(byName.get(n))) stack.push(c);
  }

  /* Gegenprobe, damit die Traversierung selbst nicht stillschweigend kaputt
     sein kann: der lebende Schreibpfad MUSS als erreichbar herauskommen. */
  for (const must of ['d1StoreRows', 'd1ResolveDue', 'd1NoteObservations'])
    assert.ok(live.has(must), `NK72: ${must} muss erreichbar sein — sonst misst diese Pruefung nichts`);

  const critical = fns.filter(f =>
    /INTO market_snapshots|UPDATE market_snapshots|learnCountersBump\(/.test(f.body));
  assert.ok(critical.length >= 2, 'NK72: Es muss kritische Schreiber geben');
  const orphaned = critical.filter(f => !live.has(f.name)).map(f => f.name);
  assert.deepEqual(orphaned, [],
    `NK72: Diese Funktionen schreiben in die Lernschicht, werden aber von niemandem aufgerufen: ${orphaned.join(', ')}. `
    + 'Genau so ist der 4.2.3-Fehler entstanden — `obs_n` hatte einen getesteten Schreiber ohne Aufrufer, '
    + 'und der Aufloeser hat daraufhin monatelang 100 % verworfen.');
}

/* ── NK73 · Beobachtet wird VOR der Schreibschwelle ─────────────────────────
   Stuende `d1NoteObservations` hinter `onlyChanged`, zaehlte nur noch
   Bewegung als Beobachtung. Die Lernbasis fuellte sich dann systematisch mit
   Bewegern, und die ruhige Zeile — der Gegenfall, den jede Auswertung
   braucht — verschwaende als „zu wenig beobachtet". Dieselbe Verzerrung wie
   in R3, nur mit umgekehrtem Vorzeichen. */
{
  const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  const store = worker.slice(worker.indexOf('async function d1StoreRows'),
                             worker.indexOf('function twinDistance('));
  const noteAt = store.indexOf('await d1NoteObservations(');
  const gateAt = store.indexOf('if(opts.onlyChanged)');
  assert.ok(noteAt > 0, 'NK73: Der lebende Schreibpfad muss die Beobachtung protokollieren');
  assert.ok(gateAt > 0, 'NK73: Die Schreibschwelle muss noch da sein');
  assert.ok(noteAt < gateAt,
    'NK73: Die Beobachtung muss VOR der Schreibschwelle protokolliert werden');
}

console.log('✓ FusionPulse v4.2.3 Beobachtungsprotokoll und Erreichbarkeit (ausgefuehrt): OK');

/* ── NK74 · v4.2.3 · DER VERWURF MUSS SICHTBAR SEIN ────────────────────────
   `learnCountersView` liefert `dropped`/`dropped24h` seit v3.32.10. Bis 4.2.2
   hat `learningPayload` sie nicht in die Nutzlast uebernommen, und
   `public/app.js` kannte das Wort nicht. Gezaehlt, transportiert, weggeworfen
   — und damit war ein Verwurf von 100 % von einem stillstehenden Cron nicht
   zu unterscheiden. Beides sah aus wie eine Null. */
{
  const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  const payload = worker.slice(worker.indexOf('async function learningPayload('),
                               worker.indexOf('const RADAR_CADENCE_MIN'));
  assert.match(payload, /dropped:counts\.dropped/,
    'NK74: Die Verwurfszahl muss den Client erreichen');
  assert.match(payload, /dropped24h:counts\.dropped24h/,
    'NK74: … auch im 24-Stunden-Fenster');
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /function coverageNote\(/, 'NK74: Der Client muss die Abdeckung benennen');
  const render = app.slice(app.indexOf('function renderLearningReport('),
                           app.indexOf('function renderLearningStatus('));
  assert.match(render, /coverageNote\(/,
    'NK74: … und sie im Lernbericht auch berechnen');
  /* Die erste Fassung endete hier — und die Gegenprobe (Anzeige entfernt,
     Berechnung stehen lassen) blieb gruen. „Wird berechnet" ist genau die
     Zusage, die in dieser App schon zweimal zu wenig war: bei `dropped`, das
     gezaehlt und nicht uebertragen wurde, und bei der VWAP-Kachel in 4.2.2.
     Geprueft wird deshalb die AUSGABE. */
  const tpl = render.slice(render.indexOf('el.innerHTML='));
  assert.match(tpl, /\$\{esc\(cov\.label\)\}/,
    'NK74: Die Abdeckung muss im Lernbericht AUSGEGEBEN werden, nicht nur berechnet');
  assert.match(tpl, /cov\.tone/,
    'NK74: … samt Ampel, sonst faellt ein Totalverwurf optisch nicht auf');
}

console.log('✓ FusionPulse v4.2.3 Verwurf sichtbar (ausgefuehrt): OK');
