/* ═══ v4.15.0 · DIE NACHMESSUNG LIEF IM AKTIENPFAD PRAKTISCH NIE ═══════════
   Nutzerbefund, 11.09.: „Verlauf der Kauf-Freigaben · Aktien" zeigte in JEDER
   Zeile „bester Ausschlag 0,0 % · tiefster 0,0 %" bei Ausgang „ausgewertet".
   Also: als gemessen ausgewiesen, als bewegungslos behauptet — und beides
   falsch, denn gemessen wurde nie.

   Ursache in `d1StoreRows`: die Messung der Exkursionen stand HINTER der
   Schreibschwelle `onlyChanged`. Zwei Sperren, beide toedlich:
     1. `if(!kept.length) return;` — kein Titel ueber der Schwelle, kein Blick
        auf offene Snapshots.
     2. Die Symbolliste der Messabfrage stammte aus dem auf `kept`
        eingedampften `clean`; ein ruhiger Titel fiel also auch dann heraus,
        wenn ein anderer den Takt freigeschaltet hatte.
   Krypto riss die Schwelle fast immer und war deshalb unauffaellig. Aktien
   im 5-Minuten-Takt kaum je — nach 180 Minuten schrieb der Aufloeser
   `resolved_ts` auf eine Zeile mit `max_pct = 0`.

   Geprueft wird AUSGEFUEHRT, nicht per Muster: eine Textsuche haette „die
   Messung steht vor der Schwelle" bestaetigt, ohne dass je eine Aktualisierung
   entstanden waere. */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');

/* `d1StoreRows` wird mit gestubbter Umgebung geladen. Gestubbt wird nur, was
   NICHT zur Sache gehoert (Schema, Merkmale, Nutzlast); die Schwelle
   `snapshotWriteDecision` und die Messlogik laufen echt. */
function loadStore() {
  const from = worker.indexOf('async function d1StoreRows(');
  const to = worker.indexOf('function twinDistance(');
  if (from < 0 || to <= from) throw new Error('d1StoreRows nicht gefunden');
  const src = `
    const LEARN_HORIZON_MS = 180*60_000, PICK_REACH_PCT = 2, OUTCOME_MIN_STEP_PCT = 0.2;
    const LEARN_SIGNAL_LABELS = [];
    let capState = { cap: 90000, spent: 0, exhausted: false, measured: true };
    async function d1WriteBudget(){ return capState; }
    function cronLog(){}
    async function ensureD1Schema(){}
    function dbNum(v){ const n = Number(v); return Number.isFinite(n) ? n : null; }
    function learningFeatures(){ return {}; }
    function snapshotPayload(){ return null; }
    function serverLeadFlags(){ return {}; }
    function learnCountersBump(){}
    async function d1BatchChunks(env, stmts){ return env.DB.batch(stmts); }
    let noted = [];
    async function d1NoteObservations(env, source, assetType, symbols){ noted.push([...symbols]); return { written:true }; }
    const snapshotWriteMemo = new Map();
    const snapshotMemoKey = (s,a,y)=>\`\${s}|\${a}|\${y}\`;
    ${worker.slice(worker.indexOf('function snapshotWriteDecision('), worker.indexOf("let watchlistMemo="))}
    ${worker.slice(from, to)}
    return { d1StoreRows, snapshotWriteDecision, get noted(){return noted;},
             setCap(c){ capState = { ...capState, ...c }; },
             reset(){ noted = []; snapshotWriteMemo.clear(); capState = {cap:90000,spent:0,exhausted:false,measured:true}; } };`;
  return new Function(src)();
}

const M = loadStore();

/** D1-Attrappe, die die UPDATE-Anweisungen mit ihren Werten festhaelt. */
function fakeDb(unresolved) {
  const log = { updates: [], inserts: [], selects: [] };
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    async all() {
      log.selects.push({ sql, args });
      if (/FROM market_snapshots/i.test(sql)) return { results: unresolved, meta: {} };
      return { results: [], meta: {} };
    },
    async first() { return null; },
    async run() { return { meta: { changes: 1 } }; },
    get _sql() { return sql; },
    get _args() { return args; },
  });
  return {
    log,
    db: {
      prepare: (sql) => stmt(sql),
      async batch(stmts) {
        for (const s of stmts) {
          if (/UPDATE market_snapshots/i.test(s._sql)) log.updates.push(s._args);
          if (/INSERT OR IGNORE INTO market_snapshots/i.test(s._sql)) log.inserts.push(s._args);
        }
        return stmts.map(() => ({ meta: { changes: 1 } }));
      },
      async exec() { return {}; },
    },
  };
}

const T0 = Date.UTC(2026, 8, 10, 14, 0, 0);

/* ── M1 · DER GEMELDETE FALL ────────────────────────────────────────────────
   Ein Titel bewegt sich um 0,05 % — unter der Schreibschwelle von 0,15 %.
   Bis 4.14.0 kehrte `d1StoreRows` hier zurueck, ohne den offenen Snapshot
   auch nur anzusehen. Genau dieser Takt ist der Normalfall bei Aktien. */
{
  M.reset();
  const now = T0 + 30 * 60_000;
  /* Die aufgezeichnete Freigabe steht bei 100. Der laufende Kurs steht bereits
     bei 103 — die BEWEGUNG von Takt zu Takt betraegt aber nur 0,02 % und liegt
     damit unter der Schreibschwelle. Genau diese Lage ist der Normalfall bei
     Aktien: der Ausschlag gegenueber der Freigabe ist gross, die Bewegung im
     einzelnen Takt winzig. */
  const { db, log } = fakeDb([{ id: 1, symbol: 'RGTI', ts: T0, price: 100, max_pct: 0, min_pct: 0, success_ts: null, reach_ts: null, mae_pre: null }]);
  // Erster Aufruf setzt die Vergleichsbasis der Schwelle …
  await M.d1StoreRows({ DB: db }, [{ symbol: 'RGTI', price: 103, light: 'green' }], { source: 'Twelve Data', assetType: 'stock', now: T0, onlyChanged: true });
  log.updates.length = 0; log.inserts.length = 0;
  // … der zweite bewegt sich nur minimal und wird deshalb NICHT eingefuegt.
  await M.d1StoreRows({ DB: db }, [{ symbol: 'RGTI', price: 103.02, light: 'green' }], { source: 'Twelve Data', assetType: 'stock', now, onlyChanged: true });

  assert.ok(log.updates.length >= 1,
    'M1: Ein offener Snapshot MUSS nachgemessen werden, auch wenn der Titel die Schreibschwelle nicht reisst — genau hier stand der Verlauf auf 0,0 %');
  const [mx, mn] = log.updates[0];
  assert.ok(Math.abs(mx - 3.02) < 1e-9, `M1: der beste Ausschlag muss 3,02 % betragen, war ${mx}`);
  assert.ok(mn <= 0, 'M1: der schlechteste Wert darf nicht ueber null liegen');
  assert.equal(log.inserts.length, 0,
    'M1: … und die Kostenbremse bleibt: eine Bewegung unter der Schwelle legt KEINE neue Zeile an');
}

/* ── M2 · KEIN TITEL UEBER DER SCHWELLE, TROTZDEM GEMESSEN ──────────────────
   Der frueher toedliche Ruecksprung. Hier bewegt sich gar nichts ueber die
   Schwelle, und es muss dennoch nachgemessen werden. */
{
  M.reset();
  const { db, log } = fakeDb([{ id: 7, symbol: 'AAPL', ts: T0, price: 200, max_pct: 0, min_pct: 0, success_ts: null, reach_ts: null, mae_pre: null }]);
  await M.d1StoreRows({ DB: db }, [{ symbol: 'AAPL', price: 200, light: 'green' }], { source: 'Tiingo IEX', assetType: 'stock', now: T0, onlyChanged: true });
  log.updates.length = 0;
  await M.d1StoreRows({ DB: db }, [{ symbol: 'AAPL', price: 190, light: 'green' }], { source: 'Tiingo IEX', assetType: 'stock', now: T0 + 10 * 60_000, onlyChanged: true });
  assert.equal(log.updates.length, 1, 'M2: auch ohne jeden Schreibvorgang muss die Messung laufen');
  assert.ok(log.updates[0][1] <= -5, `M2: der Rueckgang von 5 % muss aufgezeichnet werden, war ${log.updates[0][1]}`);
}

/* ── M3 · DIE MESSUNG DECKT ALLE BEOBACHTETEN SYMBOLE AB ────────────────────
   Der zweite Teil des Fehlers: die Symbolliste der Messabfrage kam aus dem
   eingedampften `clean`. Ein ruhiger Titel neben einem bewegten fiel heraus. */
{
  M.reset();
  const { db, log } = fakeDb([
    { id: 1, symbol: 'RUHIG', ts: T0, price: 50, max_pct: 0, min_pct: 0, success_ts: null, reach_ts: null, mae_pre: null },
    { id: 2, symbol: 'BEWEGT', ts: T0, price: 50, max_pct: 0, min_pct: 0, success_ts: null, reach_ts: null, mae_pre: null },
  ]);
  const rows0 = [{ symbol: 'RUHIG', price: 51, light: 'green' }, { symbol: 'BEWEGT', price: 50, light: 'green' }];
  await M.d1StoreRows({ DB: db }, rows0, { source: 'Twelve Data', assetType: 'stock', now: T0, onlyChanged: true });
  log.updates.length = 0; log.selects.length = 0; log.inserts.length = 0;
  await M.d1StoreRows({ DB: db }, [
    // 0,01 % Bewegung im Takt — unter der Schreibschwelle. Gegenueber der
    // Freigabe bei 50 sind es aber 2,01 %, also ein messbarer Ausschlag.
    { symbol: 'RUHIG', price: 51.005, light: 'green' },
    { symbol: 'BEWEGT', price: 55, light: 'green' },     // 10 % — ueber der Schwelle
  ], { source: 'Twelve Data', assetType: 'stock', now: T0 + 20 * 60_000, onlyChanged: true });

  const mess = log.selects.find(s => /FROM market_snapshots/i.test(s.sql));
  assert.ok(mess, 'M3: die Messabfrage muss laufen');
  assert.ok(mess.args.includes('RUHIG') && mess.args.includes('BEWEGT'),
    `M3: BEIDE beobachteten Symbole muessen in der Messabfrage stehen, gebunden war ${JSON.stringify(mess.args)}`);
  assert.equal(log.updates.length, 2, 'M3: beide offenen Snapshots werden aktualisiert');
  assert.equal(log.inserts.length, 1, 'M3: eingefuegt wird trotzdem nur der bewegte Titel');
}

/* ── M4 · DIE KOSTENBREMSE BLEIBT EINE BREMSE ───────────────────────────────
   Seit die Messung ALLE beobachteten Symbole erfasst, entscheidet die
   Schrittweite ueber den Verbrauch. Eine Bewegung unterhalb davon darf keinen
   Schreibvorgang ausloesen — sonst schreibt jede offene Zeile jedes Titels in
   jedem Takt. */
{
  M.reset();
  const { db, log } = fakeDb([{ id: 3, symbol: 'X', ts: T0, price: 100, max_pct: 1, min_pct: -1, mae_pre: -1, success_ts: null, reach_ts: null }]);
  await M.d1StoreRows({ DB: db }, [{ symbol: 'X', price: 100, light: 'green' }], { source: 'Twelve Data', assetType: 'stock', now: T0, onlyChanged: true });
  log.updates.length = 0;
  // 1,05 % liegt nur 0,05 Punkte ueber dem gespeicherten Hoechststand.
  await M.d1StoreRows({ DB: db }, [{ symbol: 'X', price: 101.05, light: 'green' }], { source: 'Twelve Data', assetType: 'stock', now: T0 + 5 * 60_000, onlyChanged: true });
  assert.equal(log.updates.length, 0, 'M4: eine Aenderung unterhalb der Schrittweite darf nicht geschrieben werden');
  // 1,5 % liegt darueber.
  await M.d1StoreRows({ DB: db }, [{ symbol: 'X', price: 101.5, light: 'green' }], { source: 'Twelve Data', assetType: 'stock', now: T0 + 10 * 60_000, onlyChanged: true });
  assert.equal(log.updates.length, 1, 'M4: … darueber schon');
}

/* ── M5 · ZIELSCHWELLEN BLEIBEN EXAKT ───────────────────────────────────────
   Die Schrittweite ist eine Kostenbremse, keine Messgrenze. Wird die
   Zielschwelle beruehrt, MUSS der Zeitstempel fallen — auch wenn der
   Extremwert sich nur minimal aendert. Sonst verschoebe eine Kostenbremse
   still die Erfolgsdefinition. */
{
  M.reset();
  const { db, log } = fakeDb([{ id: 4, symbol: 'Y', ts: T0, price: 100, max_pct: 1.95, min_pct: 0, mae_pre: 0, success_ts: null, reach_ts: null }]);
  await M.d1StoreRows({ DB: db }, [{ symbol: 'Y', price: 100, light: 'green' }], { source: 'Twelve Data', assetType: 'stock', now: T0, onlyChanged: true });
  log.updates.length = 0;
  await M.d1StoreRows({ DB: db }, [{ symbol: 'Y', price: 102.0, light: 'green' }], { source: 'Twelve Data', assetType: 'stock', now: T0 + 5 * 60_000, onlyChanged: true });
  assert.equal(log.updates.length, 1,
    'M5: das Beruehren der Zielschwelle muss den Schreibvorgang ausloesen, obwohl der Zuwachs unter der Schrittweite liegt');
  const args = log.updates[0];
  assert.ok(Number(args[3]) > 0, 'M5: … und `reach_ts` muss dabei gesetzt werden');
}

/* ── M6 · BEOBACHTET WIRD WEITERHIN VOR ALLEM ANDEREN ───────────────────────
   Die Reihenfolge aus NK73 darf durch den Umbau nicht gekippt sein: Der
   Protokolleintrag entsteht vor der Schwelle UND vor der Messung, und er
   fuehrt ALLE beobachteten Symbole. */
{
  M.reset();
  const { db } = fakeDb([]);
  await M.d1StoreRows({ DB: db }, [
    { symbol: 'A', price: 10, light: 'green' },
    { symbol: 'B', price: 20, light: 'red' },
  ], { source: 'Twelve Data', assetType: 'stock', now: T0, onlyChanged: true });
  assert.deepEqual(M.noted.at(-1), ['A', 'B'],
    'M6: das Beobachtungsprotokoll fuehrt alle beobachteten Symbole, nicht nur die geschriebenen');
}

console.log('✓ FusionPulse v4.15.0 Nachmessung der Kauf-Freigaben (ausgefuehrt): OK');
