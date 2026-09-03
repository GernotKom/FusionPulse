/* Funktionale D1-Harness (v3.32.9).
   Zweck: die Zaehler- und Telemetrielogik WIRKLICH ausfuehren, statt im
   Quelltext nach Mustern zu suchen. Drei Fehlversionen (3.32.2/3/6) sind an
   genau dieser Luecke vorbeigelaufen — ein Muster beweist, dass etwas dasteht,
   nicht dass es das Richtige tut.

   Das gefaelschte D1 kann drei Dinge, die das echte auch kann und die hier
   entscheidend sind: `meta.rows_read`/`rows_written` liefern, bei
   `INSERT OR IGNORE` ueber `meta.changes` melden, dass NICHTS eingefuegt
   wurde, und auf Kommando denselben Fehler werfen wie am 01.09.
   („exceeded free tier daily row read limit"). */
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');

/* v3.32.10 · Der Aufloeser wird eigenstaendig geladen: er ist der Kern von R3
   und muss AUSGEFUEHRT geprueft werden, nicht per Muster. */
export function loadResolver() {
  const from = worker.indexOf('async function d1ResolveDue(');
  /* v4.2.3 · Endanker war `d1StoreSnapshotRow` — eine Funktion ohne Aufrufer,
     die inzwischen entfernt ist. Neuer Anker ist `d1BatchChunks`; dadurch
     liegen `d1ReadObsLog`, `d1NoteObservations` und `obsCountFor` MIT im
     Ausschnitt und werden ausgefuehrt statt gestubbt. Genau um sie geht es:
     die Abdeckung entsteht seit 4.2.3 dort und nicht mehr in `obs_n`. */
  const to = worker.indexOf('async function d1BatchChunks(');
  if (from < 0 || to <= from) throw new Error('d1ResolveDue nicht gefunden');
  const consts = 'const LEARN_HORIZON_MS = 180*60_000, LEARN_MIN_OBS = 6, LEARN_RESOLVE_BUDGET = 400;\n';
  /* v4.2.1: `d1ResolveDue` fragt seit der Tagesobergrenze zuerst das
     Schreibbudget ab. Der Prueffstand haelt es standardmaessig auf „nicht
     erreicht" — die Bremse selbst wird in NK62/NK64 getestet, hier geht es um
     die Aufloesungslogik. `setCap` erlaubt den Gegenversuch. */
  const src = consts + 'let bumped = [];\nfunction learnCountersBump(d, now){ bumped.push(d); }\n'
    + 'let capState = { cap: 90000, spent: 0, exhausted: false, measured: true };\n'
    + 'async function d1WriteBudget(){ return capState; }\n'
    + 'function cronLog(){}\n'
    + worker.slice(from, to)
    + '\nreturn { d1ResolveDue, d1NoteObservations, d1ReadObsLog, obsCountFor,'
    + ' LEARN_MIN_OBS, OBS_LOG_RETENTION_MS, OBS_LOG_BUCKET_MS, obsLogKey,'
    + ' setCap(c){ capState = { ...capState, ...c }; },'
    + ' get bumped(){return bumped;}, reset(){bumped=[]; capState={cap:90000,spent:0,exhausted:false,measured:true};} };';
  return new Function(src)();
}

export function loadD1() {
  const from = worker.indexOf("const LEARN_COUNT_KEY = 'learn_counts';");
  const to = worker.indexOf('function learningFeatures(row){');
  if (from < 0 || to < 0 || to <= from) throw new Error('D1-Block nicht gefunden');
  const src = worker.slice(from, to)
    + '\nreturn {learnCountersLoad,learnCountersBump,learnCountersFlush,learnCountersView,'
    + 'learnCountersBaseline,learnHourKey,d1Wrap,d1MeterStart,d1MeterFlush,d1MeterView,d1QueryShape,'
    + 'get pending(){return learnPending;}, set pending(v){learnPending=v;},'
    + 'reset(){learnCounts=null;learnPending={s:0,r:0,e:0,ts:0,hours:{}};learnFlushTs=0;d1Meter=null;}};';
  return new Function(src)();
}

/** Minimales, aber ehrliches D1-Double. */
export function fakeDb(opts = {}) {
  const meta = new Map();                 // fp_meta
  const state = {
    fail: opts.fail || null,              // z. B. 'D1_ERROR: … row read limit'
    failWrite: opts.failWrite || null,    // nur Schreibvorgaenge scheitern
    rowsReadPerQuery: opts.rowsRead ?? 3,
    inserted: opts.inserted ?? 1,         // meta.changes fuer INSERT OR IGNORE
    log: [],
    due: opts.due || null,   // Zeilen, die der Aufloeser findet
    meta,
  };
  const boom = () => { if (state.fail) throw new Error(state.fail); };
  const boomW = () => { boom(); if (state.failWrite) throw new Error(state.failWrite); };
  const result = (results, written = 0) => ({
    results,
    meta: { rows_read: state.rowsReadPerQuery, rows_written: written, changes: written },
  });
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    all: async () => {
      boom(); state.log.push(sql);
      /* Faellige Snapshots fuer den Aufloeser. `rows` wird vom Test gesetzt. */
      if (/FROM market_snapshots/i.test(sql) && state.due) return result(state.due);
      return result([]);
    },
    first: async () => {
      boom(); state.log.push(sql);
      if (/FROM fp_meta/i.test(sql)) {
        const row = meta.get(String(args[0]));
        return row ? { value: row.value, updated_ts: row.ts } : null;
      }
      if (/COUNT\(\*\)/i.test(sql)) return { ...(opts.baseline || { snapshots: 100, resolved: 40, expansions: 7, last_ts: 1 }) };
      return null;
    },
    run: async () => {
      boomW(); state.log.push(sql);
      if (/INSERT INTO fp_meta/i.test(sql)) {
        meta.set(String(args[0]), { value: String(args[1]), ts: Number(args[2]) || 0 });
        return result([], 1);
      }
      if (/INSERT OR IGNORE INTO market_snapshots/i.test(sql)) return result([], state.inserted);
      return result([], 1);
    },
  });
  const db = {
    prepare: (sql) => stmt(sql),
    batch: async (stmts) => { boomW(); state.log.push('BATCH'); return stmts.map(() => result([], 1)); },
    exec: async () => ({}),
  };
  return { db, state };
}
