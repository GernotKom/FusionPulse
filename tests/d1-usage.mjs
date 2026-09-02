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
import { loadD1, fakeDb } from './d1-harness.mjs';

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
  const fn = worker.slice(worker.indexOf('async function d1StoreSnapshotRow('),
                          worker.indexOf('async function d1BatchChunks('));
  assert.match(fn, /meta\?\.changes/,
    'NK53: Gezaehlt werden muss die tatsaechliche Einfuegung, nicht der Aufruf');
  assert.match(fn, /inserted > 0/,
    'NK53: Nur eine echte Einfuegung darf den Zaehler bewegen');
  const { db } = fakeDb({ inserted: 0 });
  const r = await db.prepare('INSERT OR IGNORE INTO market_snapshots (ts) VALUES(?)').bind(1).run();
  assert.equal(r.meta.changes, 0, 'NK53: Das Double muss ein Duplikat als 0 Aenderungen melden');
}

/* ── NK54 · Aufloesungen erst NACH dem erfolgreichen Batch zaehlen ──────────
   Wirft D1 im Batch, darf nichts als aufgeloest gebucht sein. Sonst meldet
   die App Auflösungen, die nie in der Datenbank angekommen sind. */
{
  const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  const fn = worker.slice(worker.indexOf('async function d1UpdateOutcomes('),
                          worker.indexOf('async function d1StoreSnapshotRow('));
  const batchAt = fn.indexOf('await env.DB.batch(stmts)');
  const bumpAt = fn.indexOf('learnCountersBump');
  assert.ok(batchAt > 0 && bumpAt > batchAt,
    'NK54: Der Zaehler darf erst nach dem erfolgreichen Batch fortgeschrieben werden');
  assert.ok(!/try\s*\{[\s\S]{0,200}env\.DB\.batch\(stmts\)[\s\S]{0,200}catch/.test(fn),
    'NK54: Der Fehler muss weitergereicht werden, nicht verschluckt — ein stiller Ausfall ist der schlimmste');
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
