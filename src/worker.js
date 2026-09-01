import { APP_VERSION } from './version.js';

/* ============================================================================
   FusionPulse v3.4.0 — Cloudflare Worker
   Momentum- & Einstiegszonen-Scanner für Bitpanda Fusion (EUR-Paare)

   Design-Prinzipien:
   - Subrequest-Budget hart begrenzt (Free Plan: 50 externe fetch()/Invocation)
   - Fusion Market-Data-Limit: 240 req/min → serverseitiger Cache + Single-Flight
   - Signale NUR auf geschlossenen Kerzen (kein Repainting), Live-Bar separat
   - Multi-Timeframe aus EINEM 5m-Request (Resampling 15m/1h) → 0 Extra-Requests
   - Orderbuch wird für Slippage/Depth genutzt, nicht nur für den Spread
   ========================================================================== */

const API = 'https://api.fusion.bitpanda.com/v1';

const CFG = {
  CANDLE_LIMIT: 200,      // 200 × 5m ≈ 16,6 h Historie
  DEEP_MAX: 20,           // Paare mit Kerzen-Download
  BOOK_MAX: 10,           // Paare mit Orderbuch (nur Top-Kandidaten)
  BOOK_DEPTH: 50,         // Level pro Seite (max 100)
  POOL: 6,                // CF: max 6 gleichzeitige ausgehende Verbindungen
  TTL_MS: 18_000,         // Snapshot-Gültigkeit
  SLIP_BAND: 0.0015,      // 0,15 % → bis hierhin gilt "ohne nennenswerte Slippage"
  IMB_BAND: 0.005,        // ±0,5 % Fenster für Orderbuch-Imbalance
  DEFAULT_FEE: 0.0015,    // Fallback-Taker-Fee falls /account nicht lesbar
};

/* ------------------------------------------------- Analyse-Komponenten v3.0.7
   Jede Komponente ist einzeln abschaltbar. Wichtig: eine abgeschaltete
   Komponente darf NICHT als "negativ ausgefallen" in den Score eingehen.
   Deshalb wird nicht mit 0 multipliziert, sondern das Gewicht aus der Summe
   entfernt und der Rest neu normiert (gewichteter Mittelwert statt Summe). */
const COMPONENTS = ['vwap', 'ema21', 'rs', 'mtf', 'volume', 'book', 'squeeze', 'pullback', 'elliott'];
const ALL_ON = new Set(COMPONENTS);

/** parts = [[componentKey|null, wert, gewicht], …]; null = immer aktiv. */
function weighted(parts, on) {
  let sum = 0, w = 0;
  for (const [key, val, weight] of parts) {
    if (key && !on.has(key)) continue;
    if (!Number.isFinite(val)) continue;
    sum += val * weight; w += weight;
  }
  return w > 0 ? sum / w : 5;              // nichts aktiv → neutral, nicht 0
}

function parseComponents(raw) {
  if (raw == null || raw === '') return new Set(ALL_ON);
  const wanted = String(raw).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const on = new Set(wanted.filter((x) => COMPONENTS.includes(x)));
  return on.size ? on : new Set(ALL_ON);   // leere Auswahl wäre unbrauchbar
}

/* ---------------------------------------------------------------- Utilities */
const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };
const clamp = (x, lo = 0, hi = 10) => Math.max(lo, Math.min(hi, Number.isFinite(x) ? x : lo));
const r1 = (x) => x == null || !Number.isFinite(Number(x)) ? null : Math.round(Number(x) * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const sd = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const z = (x, arr) => { const s = sd(arr); return s > 0 ? (x - mean(arr)) / s : 0; };
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const i = s.length >> 1; return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2; };
const maxOf = (a) => a.reduce((m, x) => (x > m ? x : m), -Infinity);
const minOf = (a) => a.reduce((m, x) => (x < m ? x : m), Infinity);

/** Begrenzte Parallelität — respektiert CF-Limit von 6 offenen Verbindungen. */
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  });
  await Promise.all(workers);
  return out;
}

/* -------------------------------------------------------------- Fusion-Fetch */
const FUSION_UPSTREAM_TIMEOUT_MS = 5_500;
async function fetchUpstreamWithTimeout(url, options = {}, timeoutMs = FUSION_UPSTREAM_TIMEOUT_MS) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort('timeout'), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ac.signal });
  } catch (e) {
    if (ac.signal.aborted) throw new Error(`Fusion Upstream Timeout nach ${Math.round(timeoutMs/1000)} s`);
    throw e;
  } finally { clearTimeout(timer); }
}
function makeClient(key) {
  let used = 0;
  return {
    get used() { return used; },
    async get(path, params = {}) {
      used++;
      const u = new URL(`${API}/${path}`);
      for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
      const res = await fetchUpstreamWithTimeout(u, { headers: { 'x-api-key': key, accept: 'application/json' } });
      if (res.status === 429) throw new Error('Fusion Rate-Limit (429) – Intervall erhöhen');
      if (!res.ok) throw new Error(`Fusion ${res.status} @ ${path}: ${(await res.text()).slice(0, 140)}`);
      return res.json();
    },
  };
}

/* ------------------------------------------------------ Kerzen & Resampling */
function toCandles(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => ({
      t: num(c.timestamp) * (num(c.timestamp) > 1e11 ? 0.001 : 1), // Doku: Sekunden
      o: num(c.open), h: num(c.high), l: num(c.low), c: num(c.close), v: num(c.volume),
    }))
    .filter((c) => c.c > 0 && c.t > 0)
    .sort((a, b) => a.t - b.t);
}

/** 5m-Kerzen zu höherem TF verdichten (bucketSec = 900 → 15m, 3600 → 1h). */
function resample(cs, bucketSec, closedOnly = false) {
  const out = [];
  let cur = null;
  for (const c of cs) {
    const b = Math.floor(c.t / bucketSec) * bucketSec;
    if (!cur || cur.t !== b) { cur = { t: b, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v }; out.push(cur); }
    else { cur.h = Math.max(cur.h, c.h); cur.l = Math.min(cur.l, c.l); cur.c = c.c; cur.v += c.v; }
  }
  if (closedOnly && out.length && cs.length > 1) {
    const diffs = cs.slice(1).map((c, i) => c.t - cs[i].t).filter((d) => d > 0);
    const step = diffs.length ? Math.min(...diffs) : 0;
    if (cs.at(-1).t + step < out.at(-1).t + bucketSec) out.pop();
  }
  return out;
}

/* ------------------------------------------------------------- Indikatoren */
function ema(vals, n) {
  if (!vals.length) return [];
  const k = 2 / (n + 1); const out = [vals[0]];
  for (let i = 1; i < vals.length; i++) out.push(vals[i] * k + out[i - 1] * (1 - k));
  return out;
}

/** Wilder-ATR (nicht der naive Mittelwert der True Ranges). */
function atr(cs, n = 14) {
  if (cs.length < n + 1) return 0;
  const tr = [];
  for (let i = 1; i < cs.length; i++) {
    const p = cs[i - 1].c;
    tr.push(Math.max(cs[i].h - cs[i].l, Math.abs(cs[i].h - p), Math.abs(cs[i].l - p)));
  }
  let a = mean(tr.slice(0, n));
  for (let i = n; i < tr.length; i++) a = (a * (n - 1) + tr[i]) / n;
  return a;
}

function rsi(closes, n = 14) {
  if (closes.length < n + 1) return 50;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = closes[i] - closes[i - 1]; d >= 0 ? (g += d) : (l -= d); }
  g /= n; l /= n;
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n;
    l = (l * (n - 1) + Math.max(-d, 0)) / n;
  }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}

/** Rollender VWAP über n Bars (Typical Price × Volumen). */
function vwap(cs, n) {
  const w = cs.slice(-n);
  let pv = 0, vv = 0;
  for (const c of w) { const tp = (c.h + c.l + c.c) / 3; pv += tp * c.v; vv += c.v; }
  return vv > 0 ? pv / vv : (w.length ? w.at(-1).c : 0);
}

/** Steigung + Bestimmtheitsmaß einer linearen Regression → Trendqualität. */
function linreg(vals) {
  const n = vals.length; if (n < 3) return { slope: 0, rsq: 0 };
  const xm = (n - 1) / 2, ym = mean(vals);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = i - xm, dy = vals[i] - ym; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  const slope = sxx ? sxy / sxx : 0;
  const rsq = sxx && syy ? (sxy * sxy) / (sxx * syy) : 0;
  return { slope, rsq };
}

/** Bollinger-Bandbreite (relativ) — Basis für Kompression/Squeeze. */
function bbWidth(closes, n = 20) {
  const w = closes.slice(-n); if (w.length < n) return 0;
  const m = mean(w); return m ? (2 * sd(w)) / m : 0;
}

/* ---------------------------------------------------------------- Orderbuch */
/**
 * Statt nur Best-Bid/Ask: echte Tiefe auswerten.
 * - spread          relativer Spread
 * - imbalance       Notional-Übergewicht Bid vs. Ask im ±0,5 %-Fenster (-1..+1)
 * - buyCapacity     EUR, die man kaufen kann bevor der Preis 0,15 % läuft
 * - sellCapacity    dito für den Ausstieg (wichtig für den Stop!)
 * - slipBps         erwartete Slippage in bps für eine Referenzgröße
 */
function bookMetrics(book, refNotional = 2000) {
  if (!book?.bids?.length || !book?.asks?.length) return null;
  const bids = book.bids.map((b) => ({ p: num(b.price), q: num(b.quantity) })).filter((x) => x.p > 0 && x.q > 0);
  const asks = book.asks.map((a) => ({ p: num(a.price), q: num(a.quantity) })).filter((x) => x.p > 0 && x.q > 0);
  if (!bids.length || !asks.length) return null;

  const bid = bids[0].p, ask = asks[0].p, mid = (bid + ask) / 2;
  const spread = mid > 0 ? (ask - bid) / mid : null;

  const inBand = (arr, lo, hi) => arr.filter((x) => x.p >= lo && x.p <= hi)
    .reduce((s, x) => s + x.p * x.q, 0);
  const bidN = inBand(bids, mid * (1 - CFG.IMB_BAND), mid);
  const askN = inBand(asks, mid, mid * (1 + CFG.IMB_BAND));
  const imbalance = bidN + askN > 0 ? (bidN - askN) / (bidN + askN) : 0;

  const cap = (arr, limitPrice, up) => arr
    .filter((x) => (up ? x.p <= limitPrice : x.p >= limitPrice))
    .reduce((s, x) => s + x.p * x.q, 0);
  const buyCapacity = cap(asks, ask * (1 + CFG.SLIP_BAND), true);
  const sellCapacity = cap(bids, bid * (1 - CFG.SLIP_BAND), false);

  // VWAP-Slippage für refNotional gegen die Ask-Seite
  let rest = refNotional, cost = 0, qty = 0;
  for (const a of asks) {
    const n = Math.min(rest, a.p * a.q);
    cost += n; qty += n / a.p; rest -= n;
    if (rest <= 0) break;
  }
  const fillPx = qty > 0 ? cost / qty : ask;
  const slipBps = rest > 0 ? 999 : Math.max(0, (fillPx / ask - 1) * 10_000);

  return { bid, ask, mid, spread, imbalance, buyCapacity, sellCapacity, slipBps };
}


/* ==== v3.10.0 · Sektor-Nachzuegler ==========================================
   BEFUND: `sectorLag` wurde ausschliesslich im Twelve-Data-Zweig berechnet
   (siehe unten). Der Tiingo-Deep-Scan — also der PRIMAERE Pfad — setzte den
   Wert in `tiingoAnalyseOne` auf null und hat ihn nie nachgerechnet. Damit war
   die Kennzahl im Normalbetrieb dauerhaft leer, obwohl die UI sie auswertet.

   Praktische Folge, am realen Fall des Nutzers: Nach starken NVDA-Zahlen laeuft
   die Halbleiter- und Security-Nachbarschaft an. Ein Titel wie CRWD, der noch
   hinterherhinkt, IST der Nachzuegler — und genau das haette diese Kennzahl
   angezeigt. Sie war auf dem produktiven Pfad schlicht nicht vorhanden.

   Kostet nichts: alle Zeilen liegen bereits im Speicher, keine API-Abfrage.
   Verändert KEINEN Score und KEINE BUY-Freigabe — reine Discovery.          */
function applySectorLag(rows){
  /* ACHTUNG: `Number(null)` ist 0 und damit endlich. Ein reiner isFinite-Test
     laesst fehlende Werte als gemessene Null durch — genau der Fehlertyp, der
     in v3.9.3 die Phantomspur in der Heatmap erzeugt hat. Deshalb hier explizit
     auf null/undefined/'' pruefen, bevor gerechnet wird. */
  const measured=(v)=>v!=null && v!=='' && Number.isFinite(Number(v));
  const bySector=new Map();
  for(const r of rows||[]){
    const sec=r?.sector; if(!sec||sec==='Discovery') continue;
    if(!measured(r.ret15)) continue;   // fail-closed: nicht schaetzen
    const a=bySector.get(sec)||[]; a.push(r); bySector.set(sec,a);
  }
  for(const r of rows||[]){
    const sec=r?.sector;
    if(!sec||sec==='Discovery'||!measured(r.ret15)){
      r.sectorLeaderRet15=null; r.sectorLag=null; r.sectorPeers=0; continue;
    }
    const peers=(bySector.get(sec)||[]).filter(x=>x.symbol!==r.symbol);
    // Ein einzelner Titel bildet keinen Sektor ab. Unter drei Vergleichstiteln
    // bleibt der Wert bewusst leer statt eine Scheinaussage zu erzeugen.
    if(peers.length<2){ r.sectorLeaderRet15=null; r.sectorLag=null; r.sectorPeers=peers.length; continue; }
    const leader=Math.max(...peers.map(x=>Number(x.ret15)));
    r.sectorLeaderRet15=+leader.toFixed(2);
    r.sectorLag=+Math.max(-10,Math.min(10,leader-Number(r.ret15))).toFixed(2);
    r.sectorPeers=peers.length;
  }
  return rows;
}

/* ============================================================== Kern-Analyse */
function analyse({ pair, c5, btc5, book, fee, mode = 'composite', comp, minCrv = 2 }) {
  if (c5.length < 60) return null;
  // "Nur Elliott" ist ein Modus, kein Sonderfall im Scoring: die Komponenten-
  // auswahl wird auf Elliott reduziert, alles andere läuft unverändert weiter.
  const on = mode === 'elliott' ? new Set(['elliott']) : (comp instanceof Set ? comp : new Set(ALL_ON));

  // --- Anti-Repaint: laufende Kerze abtrennen -------------------------------
  const live = c5.at(-1);
  const cs = c5.slice(0, -1);                 // nur geschlossene Bars
  if (cs.length < 55) return null;

  const cl = cs.map((x) => x.c);
  const vol = cs.map((x) => x.v);
  const px = cs.at(-1).c;
  const A = atr(cs, 14);
  const atrPct = px ? A / px : 0.01;
  if (atrPct <= 0) return null;

  // --- Multi-Timeframe aus denselben Daten ---------------------------------
  const c15 = resample(cs, 900, true);
  const c60 = resample(cs, 3600, true);
  const tfBias = (c) => {
    const v = c.map((x) => x.c); if (v.length < 12) return 0;
    const e9 = ema(v, 9).at(-1), e21 = ema(v, 21).at(-1);
    const { slope, rsq } = linreg(v.slice(-12));
    const dir = Math.sign(e9 - e21);
    return dir * Math.min(1, Math.abs(slope) / (A || 1e-9) * 3) * (0.4 + 0.6 * rsq);
  };
  const b15 = tfBias(c15), b60 = tfBias(c60);
  const mtf = clamp(5 + b15 * 2.6 + b60 * 2.4);           // 0..10, 5 = neutral

  // --- Momentum, volatilitätsnormiert (cross-asset vergleichbar) -----------
  const ret = (k) => (cl.length > k ? px / cl.at(-1 - k) - 1 : 0);
  const rAtr = (k) => ret(k) / (atrPct * Math.sqrt(k));    // Return in ATR-Einheiten
  const momoRaw = rAtr(3) * 1.0 + rAtr(6) * 0.7 + rAtr(12) * 0.45;
  const momentum = clamp(5 + momoRaw * 1.9);

  // --- Volumenbeschleunigung als echter z-Score (kein Overlap) -------------
  const vRecent = mean(vol.slice(-3));
  const vBase = vol.slice(-27, -3);                        // sauber disjunkt
  const vBaseMean = mean(vBase);
  const volZ = z(vRecent, vBase);
  const relVol = vBaseMean > 0 ? vRecent / vBaseMean : null;
  const ret15 = ret(3) * 100;                              // 3 × 5 Minuten
  const ret60 = ret(12) * 100;                             // 12 × 5 Minuten
  const volumeAcceleration = clamp(5 + volZ * 1.8);

  // --- Kompression / Squeeze ----------------------------------------------
  const bbNow = bbWidth(cl, 20);
  const bbHist = [];
  for (let i = 20; i <= 60; i += 4) bbHist.push(bbWidth(cl.slice(0, cl.length - i + 20), 20));
  const bbMed = median(bbHist.filter((x) => x > 0)) || bbNow || 1;
  const compression = clamp(10 - (bbNow / bbMed) * 5);

  // --- Relative Stärke vs. BTC (vol-normiert) ------------------------------
  let relativeStrength = null, btcBias = 0;
  if (btc5 && btc5.length > 40) {
    const bc = btc5.slice(0, -1).map((x) => x.c);
    const bAtrPct = atr(btc5.slice(0, -1), 14) / (bc.at(-1) || 1);
    const bRet = (k) => bc.at(-1) / bc.at(-1 - k) - 1;
    const d6 = ret(6) / atrPct - bRet(6) / (bAtrPct || 1e-9);
    const d12 = ret(12) / atrPct - bRet(12) / (bAtrPct || 1e-9);
    relativeStrength = clamp(5 + d6 * 1.1 + d12 * 0.7);
    btcBias = bRet(12) / (bAtrPct || 1e-9);
  }

  // --- Trendqualität -------------------------------------------------------
  const e9 = ema(cl, 9).at(-1), e21 = ema(cl, 21).at(-1), e50 = ema(cl, 50).at(-1);
  const { slope, rsq } = linreg(cl.slice(-20));
  const stack = (e9 > e21 ? 1 : -1) + (e21 > e50 ? 1 : -1);
  const trendQuality = clamp(5 + stack * 1.3 + (slope / (A || 1e-9)) * 2.2 * rsq + rsq * 1.4);

  // --- VWAP-Struktur: zwei Zeitfenster, zwei Aufgaben ----------------------
  // Kurz (24 Bars ~ 2 h): Anker fuer die Einstiegszone. Ein langer Rolling-VWAP
  // liegt in einem Trend dauerhaft 5-15 ATR unter dem Preis und taugt dafuer nicht.
  // Lang (78 Bars ~ 6,5 h): Regime-Filter und Marktbreite.
  const vwapS = vwap(cs, 24);
  const vwapL = vwap(cs, 78);
  const vwapDev = A ? (px - vwapS) / A : 0;                // Abweichung in ATR
  const emaDev = A ? (px - e21) / A : 0;                   // Abstand zur EMA21 in ATR
  const aboveVwap = px >= vwapL;
  const wasBelow = cl.slice(-10, -2).some((c) => c < vwapS - 0.4 * A);

  // --- Range / Position ----------------------------------------------------
  const w20 = cs.slice(-20);
  const hi20 = maxOf(w20.map((x) => x.h)), lo20 = minOf(w20.map((x) => x.l));
  const posInRange = hi20 > lo20 ? (px - lo20) / (hi20 - lo20) : 0.5;
  const swingLow = minOf(cs.slice(-8).map((x) => x.l));
  const swingHigh = maxOf(cs.slice(-24).map((x) => x.h));

  // --- Erschöpfung: Dochte + Klimax-Volumen + RSI + VWAP-Distanz ----------
  const rsi14 = rsi(cl, 14);
  const last3 = cs.slice(-3);
  const wickRatio = mean(last3.map((c) => {
    const rng = c.h - c.l; return rng > 0 ? (c.h - Math.max(c.o, c.c)) / rng : 0;
  }));
  const extended = vwapDev > 1.5;                          // nur dann ist Klimax = Erschoepfung
  const exhaustion = clamp(
    Math.max(0, rsi14 - 70) * 0.18 +
    Math.max(0, vwapDev - 2) * 1.6 +
    Math.max(0, wickRatio - 0.45) * 5.0 +
    Math.max(0, volZ - 3) * (extended ? 1.2 : 0.18)
  );

  // --- Orderbuch -----------------------------------------------------------
  const bm = book || null;
  const spread = bm?.spread ?? null;
  const imbalance = bm?.imbalance ?? 0;
  const bookKnown = !!bm;
  const liquidity = bm
    ? clamp(10 - (spread ?? 0.004) * 900 - Math.max(0, 3 - Math.log10(Math.max(bm.buyCapacity, 1))) * 1.6)
    : null;
  const bookScore = bookKnown ? clamp(5 + imbalance * 4.5) : null;

  // --- Setup-Klassifikation ------------------------------------------------
  let regime = 'Neutral', setup = 'Beobachten', orderType = 'limit', setupFit = 4;

  // Reihenfolge = Prioritaet. Spezifische Muster vor unspezifischen.
  const diag = { b60: r2(b60), b15: r2(b15), vwapDev: r2(vwapDev), emaDev: r2(emaDev), rsi: Math.round(rsi14),
                 posInRange: r2(posInRange), volZ: r2(volZ), momentum: r1(momentum) };
  const flushLeg = ret(10) < -1.6 * atrPct;               // vorheriger Abverkauf
  const reclaimLeg = ret(3) > 0.5 * atrPct;               // aktuelle Gegenbewegung

  // v3.0.7: Ein Muster wird nur noch erkannt, wenn seine Komponente aktiv ist.
  // Abgeschaltete Volumenprüfung heißt "nicht geprüft", nicht "nicht erfüllt".
  const cVol = on.has('volume');
  const cEma = on.has('ema21');

  if (flushLeg && reclaimLeg && (!cVol || volZ > 0.9)) {
    regime = 'Reversal'; setup = 'Flush → Reclaim'; orderType = 'limit'; setupFit = 8.2;
  } else if (on.has('pullback') && b60 > 0.05 && (!cEma || (emaDev > -2.6 && emaDev < 0.5))
             && rsi14 >= 33 && rsi14 <= 64 && momentum < 6.6) {
    regime = 'Pullback'; setup = 'Pullback an VWAP/EMA21'; orderType = 'limit'; setupFit = 9.3;
  } else if (on.has('squeeze') && compression >= 6.0 && (!cVol || volumeAcceleration >= 5.4)
             && posInRange >= 0.55 && b60 >= -0.15) {
    regime = 'Kompression'; setup = 'Squeeze → Breakout'; orderType = 'stop'; setupFit = 8.9;
  } else if (on.has('vwap') && wasBelow && vwapDev > 0.1 && vwapDev < 1.6
             && (!cVol || volZ > 0.6) && b15 > 0) {
    regime = 'Reclaim'; setup = 'VWAP-Reclaim'; orderType = 'limit'; setupFit = 8.7;
  } else if (on.has('rs') && relativeStrength >= 6.9 && Math.abs(btcBias) < 1.0
             && b60 >= -0.05 && exhaustion < 6) {
    regime = 'RS-Rotation'; setup = 'Relative Stärke vs. BTC'; orderType = 'limit'; setupFit = 8.0;
  } else if (on.has('mtf') && momentum > 6.5 && (!cVol || volumeAcceleration > 5.8) && exhaustion < 6.5) {
    regime = 'Expansion'; setup = 'Trend-Expansion (spät)'; orderType = 'stop'; setupFit = 6.2;
  }

  // --- Einstiegszone statt Einstiegspunkt ---------------------------------
  // Rücksetzer-Anker nur aus den aktiven Struktur-Komponenten. Ist keine aktiv,
  // bleibt der ATR-Rahmen als Anker — nicht ein Wert aus einer abgeschalteten Analyse.
  const anchorRefs = [];
  if (on.has('vwap')) anchorRefs.push(vwapS);
  if (on.has('ema21')) anchorRefs.push(e21);
  const structAnchor = anchorRefs.length ? maxOf(anchorRefs) : px - 0.45 * A;
  const anchor = orderType === 'stop'
    ? Math.max(hi20, px) + 0.10 * A                     // Ausbruchs-Trigger
    : Math.max(Math.min(px, structAnchor), px - 0.9 * A); // Rücksetzer-Anker
  const zoneLow = orderType === 'stop' ? anchor : anchor - 0.30 * A;
  const zoneHigh = orderType === 'stop' ? anchor + 0.25 * A : anchor + 0.30 * A;
  const entry = (zoneLow + zoneHigh) / 2;

  // --- Echte Kosten zuerst: 2x Gebuehr + Spread + geschaetzte Slippage ----
  // Der Stop muss die Kosten kennen, sonst baut man Setups, die der Spread frisst.
  const slip = (bm?.slipBps ?? 12) / 10_000;
  const costPct = fee * 2 + (spread ?? 0.0018) + slip;
  const cost = entry * costPct;

  // --- Stop: strukturell, aber ATR- und kostenbezogen begrenzt ------------
  // KEIN fixer Prozentboden: 1,5 % sind bei BTC absurd weit und bei einem
  // volatilen Small Cap viel zu eng. Der Referenzrahmen ist immer die ATR.
  const structStop = swingLow - 0.25 * A;          // knapp unter das letzte Swing-Tief
  // Strukturstop nehmen, aber nie weiter als 1,6 ATR:
  const preferred = entry - Math.max(structStop, entry - 1.6 * A);
  // Untergrenze: 1,0 ATR (enger wird auf 5m routinemaessig ausgestoppt) UND
  // mindestens 2,8x die Roundtrip-Kosten.
  const minDist = Math.max(1.0 * A, cost * 2.8);
  const maxDist = 2.60 * A;                        // sonst ist der Trade kein Daytrade mehr
  const riskPerUnit = Math.min(maxDist, Math.max(minDist, preferred));
  // Wenn der Stop nicht mindestens 2,5x die Roundtrip-Kosten ist, ist das Setup
  // mathematisch tot - egal wie huebsch die Indikatoren aussehen.
  const costRatio = cost > 0 ? riskPerUnit / cost : 99;
  const stop = entry - riskPerUnit;
  if (riskPerUnit <= 0 || stop <= 0) return null;

  // --- Ziele: Struktur zuerst, sonst R-Vielfaches --------------------------
  const structTarget = swingHigh - 0.15 * A;
  const tp1 = entry + riskPerUnit * 1.0;
  const tp2 = structTarget >= entry + riskPerUnit * 1.8 ? structTarget : entry + riskPerUnit * 2.2;
  const tp2Source = tp2 === structTarget ? 'Struktur (Swing-Hoch)' : '2,2 R';
  const netCRV = (tp2 - entry - cost) / (riskPerUnit + cost);
  const netCRV1 = (tp1 - entry - cost) / (riskPerUnit + cost);

  // --- Zwei unabhaengige Achsen -------------------------------------------
  // "Rot" hatte bisher zwei voellig verschiedene Bedeutungen: kein Setup
  // (Signalproblem) oder zu teuer (Ausfuehrungsproblem). Getrennt gemessen
  // wird der interessanteste Fall sichtbar: gutes Setup, schlechte
  // Ausfuehrbarkeit -> auf Spread-Verengung warten statt verwerfen.
  // Die Handelbarkeit ist eine Sicherheitsachse (Kosten, Spread, Tiefe) und
  // bleibt bewusst IMMER aktiv, auch wenn Analysekomponenten abgeschaltet sind.
  const spreadScore = spread == null ? null : clamp(10 - spread * 1100);
  const execParts = [
    [bookKnown, liquidity, 0.38],
    [true, Math.min(10, costRatio * 2), 0.30],
    [spreadScore != null, spreadScore, 0.18],
    [true, Math.min(10, (netCRV / 3) * 10), 0.14],
  ].filter(([known]) => known);
  const execWeight = execParts.reduce((a,x)=>a+x[2],0) || 1;
  let executability = clamp(execParts.reduce((a,x)=>a+x[1]*x[2],0) / execWeight);
  // Sicherheitsinvariante: unbekanntes Orderbuch darf niemals grün ermöglichen.
  if (!bookKnown) executability = Math.min(executability, 6.4);

  // --- Elliott-Wellen-Heuristik ---------------------------------------------
  // Keine subjektive Wellenbeschriftung: bewertet Impuls-/Korrekturstruktur aus
  // Swing-Extremen, Trendstaffelung und Fibonacci-nahem Pullback. Ergänzend nutzen.
  const recent = cs.slice(-34);
  const rh = recent.map(x=>x.h), rl = recent.map(x=>x.l);
  const impulse = (maxOf(rh.slice(-18,-7)) - minOf(rl.slice(-26,-18))) / (A || 1);
  const pullHi = maxOf(rh.slice(-12,-4)), pullLo = minOf(rl.slice(-8));
  const retr = pullHi > pullLo && impulse > 0 ? (pullHi - px) / Math.max(A, pullHi-pullLo) : 0;
  const fibFit = Math.min(Math.abs(retr-.382), Math.abs(retr-.5), Math.abs(retr-.618));
  const higherStructure = cl.at(-1) > cl.at(-13) && minOf(rl.slice(-8)) >= minOf(rl.slice(-20,-8));
  const elliott = clamp(5 + Math.min(2.2, impulse*.28) + (higherStructure?1.4:-1.0) + Math.max(0,1.5-fibFit*5) - Math.max(0,exhaustion-6)*.35);

  if (mode === 'elliott') {
    setup = elliott >= 7 ? 'Impulsstruktur (Elliott)'
          : elliott >= 5 ? 'Korrektur / unklar (Elliott)'
          : 'Gegen die Wellenstruktur';
    regime = 'Elliott';
    setupFit = clamp(elliott);
  }

  // --- Scores (v3.0.7: gewichteter Mittelwert über AKTIVE Komponenten) ------
  const quality = clamp(weighted([
    [null,       setupFit,            0.30],
    ['mtf',      mtf,                 0.21],
    ['volume',   volumeAcceleration,  0.16],
    ['rs',       relativeStrength,    0.13],
    ['squeeze',  compression,         0.11],
    ['ema21',    trendQuality,        0.09],
    ['vwap',     aboveVwap ? 8.5 : 3.5, 0.09],
    ['elliott',  elliott,             0.12],
  ], on) - Math.max(0, exhaustion - 5) * 0.34);

  const score = clamp(weighted([
    ['mtf',      mtf,                 0.18],
    [null,       setupFit,            0.16],
    ['book',     liquidity,           0.14],
    ['volume',   volumeAcceleration,  0.12],
    ['rs',       relativeStrength,    0.11],
    ['ema21',    trendQuality,        0.10],
    ['book',     bookScore,           0.09],
    ['squeeze',  compression,         0.06],
    ['mtf',      momentum,            0.04],
    ['vwap',     aboveVwap ? 8.5 : 3.5, 0.08],
    ['elliott',  elliott,             0.10],
  ], on) - exhaustion * 0.10);

  // Pre-Move: was passiert BEVOR die Bewegung sichtbar ist
  const premove = clamp(weighted([
    ['squeeze',  compression,         0.26],
    ['volume',   volumeAcceleration,  0.22],
    ['book',     bookScore,           0.16],
    ['rs',       relativeStrength,    0.14],
    ['mtf',      mtf,                 0.12],
    ['book',     liquidity,           0.10],
    ['elliott',  elliott,             0.10],
  ], on) - Math.max(0, momentum - 7.2) * 1.4);

  let modeScore = score, modeQuality = quality;
  if (mode === 'elliott') { modeScore = elliott; modeQuality = elliott; }
  else if (mode === 'momentum') { modeScore = clamp(momentum*.38 + volumeAcceleration*.34 + compression*.18 + relativeStrength*.10); modeQuality = modeScore; }
  else if (mode === 'trend') { modeScore = clamp(mtf*.38 + trendQuality*.30 + setupFit*.22 + (aboveVwap?10:3)*.10); modeQuality = modeScore; }
  else if (mode === 'micro') { modeScore = clamp(weighted([[null,liquidity,.40],['book',bookScore,.32],['book',spreadScore,.18],[null,Math.min(10,costRatio*2),.10]], on)); modeQuality = modeScore; }


  // --- Ampel ---------------------------------------------------------------
  let light = 'red';
  const viable = netCRV >= 1.0 && costRatio >= 2.5 && exhaustion < 8.5;
  const tradable = viable && netCRV >= minCrv && bookKnown && (spread == null || spread <= 0.0025)
                   && liquidity >= 6 && exhaustion < 7;
  if (modeQuality >= 7.0 && executability >= 6.5 && tradable && (mode === 'elliott' || setupFit >= 7)) light = 'green';
  else if (viable && (modeQuality >= 6.0 || (mode === 'composite' && premove >= 7.2))) light = 'yellow';

  // Quadrant fuer die 2D-Karte im Dashboard
  const quadrant = modeQuality >= 6 
    ? (executability >= 6 ? 'handeln' : 'blockiert')   // gutes Setup, teuer
    : (executability >= 6 ? 'liquide'  : 'ignorieren');

  // Warum NICHT grün? (spart im Trade-Alltag enorm viel Grübelzeit)
  const blockers = [];
  if (netCRV < minCrv) blockers.push(`CRV ${r2(netCRV)}:1 < Minimum ${r2(minCrv)}:1`);
  if (costRatio < 2.5) blockers.push(`Kosten fressen den Stop (${r1(costRatio)}x)`);
  if (spread != null && spread > 0.0025) blockers.push(`Spread ${(spread * 100).toFixed(2)} %`);
  if (bookKnown && liquidity < 6) blockers.push('dünne Tiefe');
  if (!bookKnown) blockers.push('Orderbuch ungeprüft');
  if (exhaustion >= 7) blockers.push('überdehnt');
  if (setupFit < 7) blockers.push('kein klares Setup');
  if (modeScore < 7.0) blockers.push(`Score ${r1(modeScore)}`);

  // ---- v3.5.0 CLAUDE-MODUS (additiv) ---------------------------------------
  // Befund: netCRV = (2,2r - c)/(r + c) erreicht 2,0 erst ab costRatio r/c >= 15;
  // der Code selbst limitiert den Stop aber auf max. 2,6 ATR und verlangt nur
  // costRatio >= 2,5 -> "gruen" war bei realen Bitpanda-Kosten praktisch
  // unerreichbar (ausser bei seltenen weiten Strukturzielen). Der Claude-Modus
  // nutzt erreichbare, aber weiterhin kostenehrliche Gates plus Erwartungswert.
  // Sicherheitsinvarianten bleiben: ohne Orderbuch niemals gruen.
  const claude = (() => {
    // Drei-Ausgaenge-EV (Management: nach TP1 Stop -> Breakeven), Kosten 1,2x je Einheit Risiko.
    const p1 = Math.max(0.40, Math.min(0.66,
      0.44 + (modeQuality - 5) * 0.045 + (setupFit - 5) * 0.02 - Math.max(0, exhaustion - 5) * 0.02));
    const p2 = Math.max(0.35, Math.min(0.55, 0.42 + (modeQuality - 6) * 0.02));
    const R1 = (tp1 - entry) / riskPerUnit, R2 = (tp2 - entry) / riskPerUnit;
    const costR = (cost / riskPerUnit) * 1.2;
    const cHit = p1;
    const cNetPlanR = ((0.5 * (tp1 - entry) + 0.5 * (tp2 - entry)) - cost) / (riskPerUnit + cost);
    const cExpectancyR = +((p1 * 0.5 * R1 + p1 * p2 * 0.5 * R2 - (1 - p1) * 1 - costR)).toFixed(2);
    const setupOk = mode === 'elliott' ? elliott >= 6.6 : setupFit >= 6.5;
    const cGreen = viable && bookKnown && (spread == null || spread <= 0.0035)
      && liquidity >= 5.5 && exhaustion < 7 && costRatio >= 3.2 && netCRV >= 1.4
      && modeQuality >= 6.6 && executability >= 6.0 && setupOk && cExpectancyR >= 0.10;
    const cYellow = !cGreen && viable && (modeQuality >= 5.6 || premove >= 6.8);
    const cBlockers = [];
    if (!bookKnown) cBlockers.push('Orderbuch ungeprueft (fail-closed)');
    if (spread != null && spread > 0.0035) cBlockers.push(`Spread ${(spread * 100).toFixed(2)} %`);
    if (bookKnown && liquidity < 5.5) cBlockers.push('duenne Tiefe');
    if (costRatio < 3.2) cBlockers.push(`Stop nur ${r1(costRatio)}x Kosten (< 3,2x)`);
    if (netCRV < 1.4) cBlockers.push(`Netto-CRV ${r2(netCRV)}:1 < 1,4:1`);
    if (modeQuality < 6.6) cBlockers.push(`Qualitaet ${r1(modeQuality)} < 6,6`);
    if (!setupOk) cBlockers.push('kein klares Setup-Muster');
    if (exhaustion >= 7) cBlockers.push('ueberdehnt');
    if (cExpectancyR < 0.10) cBlockers.push(`Erwartungswert ${cExpectancyR}R < +0,10R`);
    return {
      light: cGreen ? 'green' : cYellow ? 'yellow' : 'red',
      score: r1(modeScore), netCRV: r2(netCRV),
      planR: r2(cNetPlanR), hitPct: Math.round(cHit * 100), expectancyR: cExpectancyR,
      blockers: cBlockers.slice(0, 5),
    };
  })();

  // Sparkline: letzte 48 Closes normalisiert 0..100
  const sp = cl.slice(-48);
  const spLo = minOf(sp), spHi = maxOf(sp);
  const spark = sp.map((c) => Math.round(spHi > spLo ? ((c - spLo) / (spHi - spLo)) * 100 : 50));

  return {
    claude,
    pair, light, score: r1(modeScore), premove: r1(premove), regime, setup, orderType,
    quality: r1(modeQuality), executability: r1(executability), quadrant, analysisMode: mode,
    components: [...on], blockers,
    // Faktoren
    momentum: r1(momentum), volumeAcceleration: r1(volumeAcceleration),
    ret15: r2(ret15), ret60: r2(ret60), relVol: relVol == null ? null : r2(relVol),
    relativeStrength: relativeStrength == null ? null : r1(relativeStrength), compression: r1(compression),
    trendQuality: r1(trendQuality), mtf: r1(mtf), bookScore: r1(bookScore),
    exhaustion: r1(exhaustion), liquidity: r1(liquidity), elliott: r1(elliott),
    // Preise
    price: live.c, closedPrice: px, zoneLow, zoneHigh, entry, stop, tp1, tp2,
    vwap: vwapS, vwapLong: vwapL, emaDev: r2(emaDev), ema21: e21, vwapDev: r2(vwapDev), rsi: Math.round(rsi14), atrPct: r2(atrPct * 100),
    riskPct: r2((riskPerUnit / entry) * 100),
    netCRV: r2(netCRV), netCRV1: r2(netCRV1), costPct: r2(costPct * 100),
    costRatio: r1(costRatio), tp2Source, diag,
    // Orderbuch
    spreadPct: spread, imbalance: r2(imbalance),
    buyCapacity: bm ? Math.round(bm.buyCapacity) : null,
    sellCapacity: bm ? Math.round(bm.sellCapacity) : null,
    slipBps: bm ? Math.round(bm.slipBps) : null,
    inZone: live.c >= zoneLow && live.c <= zoneHigh,
    aboveVwap, spark,
    barCloseIn: Math.max(0, 300 - Math.floor((Date.now() / 1000 - live.t) % 300)),
  };
}

/* ============================================================================
   v3.27.0 · DIE ELF TERME DES SITUATION-SCORE, EINZELN BENANNT
   ----------------------------------------------------------------------------
   Jede Zahl hier ist eine BEHAUPTUNG darueber, wie viel ein Merkmal wert ist.
   Keine davon ist bisher gegen ein Ergebnis geprueft worden. Sie stehen ab
   jetzt an einer Stelle, damit `/api/scoreaudit` sie einzeln nachrechnen kann.

   Werte unveraendert gegenueber v3.26.0 — ein Test beweist das an
   Zufallseingaben. Wer eine Zahl aendert, aendert damit, welche Titel ueberhaupt
   in der Kandidatenliste erscheinen. Das ist der frueheste und folgenreichste
   Eingriffspunkt der ganzen App.
   ========================================================================== */
const SITU_W = {
  brokeHigh:    24,   // Kurs ueber dem 60-Minuten-Hoch — staerkstes Einzelmerkmal
  nearBreak:    16,   // nahe an der Triggerzone, aber noch nicht darueber
  squeeze:      16,   // Kompression loest sich (enge Vorphase + Ausbruch + Range-Ausweitung)
  reclaim:      14,   // VWAP oder EMA21 zurueckerobert
  pullback:     12,   // Ruecksetzer haelt die EMA21 und dreht
  accelMul:     45,   // Beschleunigung 5 gegen 15 Minuten, Faktor
  accelCap:     14,   //   ... gedeckelt
  rvolBase:    0.8,   // relatives Volumen ab dieser Schwelle zaehlt
  rvolMul:      12,   //   ... Faktor
  rvolCap:      14,   //   ... gedeckelt
  rvolMissing:  -8,   // kein RVOL messbar -> Abzug (fail-closed)
  aboveVwap:     8,   // ueber VWAP
  belowVwap:    -4,   // darunter oder Volumen unbekannt
  emaUp:         7,   // EMA9 ueber EMA21
  emaDown:      -3,   //   ... darunter
  vacBase:      50,   // Liquiditaetsvakuum ab hier zaehlt
  vacMul:     0.16,   //   ... Faktor
  vacCap:        8,   //   ... gedeckelt
  overextended: -18,  // mehr als 3 ATR ueber EMA21 -> Abzug
  noVolumeCap:  42,   // ohne belastbares Volumen Deckel auf Beobachtungsniveau
};

/* ================================================================= Scanning */
async function runScan(key, opts = {}) {
  const c = makeClient(key);
  const deepMax = Math.min(CFG.DEEP_MAX, Math.max(4, opts.deep || CFG.DEEP_MAX));

  // Gebührenstufe einmal live holen — macht das CRV ehrlich (1 Subrequest)
  let fee = CFG.DEFAULT_FEE;
  try {
    const acc = await c.get('account');
    const f = num(acc?.takerFee ?? acc?.feeTier?.takerFee ?? acc?.fees?.taker);
    if (f > 0 && f < 0.02) fee = f > 1 ? f / 10_000 : f;
  } catch { /* Key ohne Account-Recht → Fallback */ }

  // Breiter Filter: 1 Subrequest für alle Paare
  const tickers = await c.get('tickers');
  const eur = (Array.isArray(tickers) ? tickers : [])
    .filter((t) => String(t.pair || '').endsWith('-EUR') && num(t.price) > 0);
  if (!eur.length) throw new Error('Keine EUR-Paare in /tickers');

  // Ticker-"volume" ist je nach Paar Basis- oder Quote-Menge.
  // Heuristik über BTC-EUR: rohe Menge in BTC ist klein → dann × Preis rechnen.
  const btcT = eur.find((t) => t.pair === 'BTC-EUR');
  const volIsBase = btcT ? num(btcT.volume) < 1e6 : true;
  const notional = (t) => (volIsBase ? num(t.volume) * num(t.price) : num(t.volume));

  // Vorauswahl: Umsatz × Tagesrange (= wo heute wirklich Bewegung ist)
  const scored = eur.map((t) => {
    const p = num(t.price), hi = num(t.high), lo = num(t.low);
    const range = p > 0 && hi > lo ? (hi - lo) / p : 0;
    return { pair: t.pair, price: p, notional: notional(t), pressure: notional(t) * (0.3 + range * 8) };
  });
  scored.sort((a, b) => b.pressure - a.pressure);

  // Liquiditaetsschwelle RELATIV zum Median, nicht absolut: eine harte Euro-Grenze
  // wuerde das Universum je nach Marktphase still auf eine Handvoll Paare schrumpfen.
  const medNot = median(scored.map((x) => x.notional).filter((x) => x > 0)) || 0;
  const floorNot = Math.max(10_000, medNot * 0.15);
  const liquid = scored.filter((x) => x.notional >= floorNot);
  const rest = scored.filter((x) => x.notional < floorNot);

  const watch = (opts.watch || []).filter((p) => eur.some((t) => t.pair === p));
  const chosen = [...new Set(['BTC-EUR', ...watch, ...liquid.map((x) => x.pair), ...rest.map((x) => x.pair)])]
    .slice(0, deepMax);

  // Kerzen: 1 Subrequest je Paar, daraus 5m + 15m + 1h
  const candleMap = new Map();
  await pool(chosen, CFG.POOL, async (p) => {
    try { candleMap.set(p, toCandles(await c.get(`candles/${p}`, { interval: '5m', limit: CFG.CANDLE_LIMIT }))); }
    catch { candleMap.set(p, []); }
  });
  const btc5 = candleMap.get('BTC-EUR') || [];
  btcRef = btc5;

  // Vorlauf ohne Orderbuch → nur die besten Kandidaten bekommen Tiefe
  const mode = opts.mode || 'composite';
  const minCrv = Math.max(1, Number(opts.minCrv || 2));
  const comp = opts.comp instanceof Set ? opts.comp : new Set(ALL_ON);
  const useBook = comp.has('book');

  const pre = chosen.map((p) => {
    const cs = candleMap.get(p);
    if (!cs || cs.length < 60) return null;
    return analyse({ pair: p, c5: cs, btc5: p === 'BTC-EUR' ? null : btc5, book: null, fee, mode, comp, minCrv });
  }).filter(Boolean);

  pre.sort((a, b) => (b.score + b.premove) - (a.score + a.premove));
  // Orderbuch abgeschaltet → keine Orderbuch-Requests. Spart echte API-Calls.
  const bookPairs = useBook ? pre.slice(0, CFG.BOOK_MAX).map((x) => x.pair) : [];

  const bookMap = new Map();
  await pool(bookPairs, CFG.POOL, async (p) => {
    try { bookMap.set(p, bookMetrics(await c.get(`orderbook/${p}`, { depth: CFG.BOOK_DEPTH }))); }
    catch { bookMap.set(p, null); }
  });

  // Finale Analyse mit Orderbuch, wo vorhanden
  const preByPair = new Map(pre.map((r) => [r.pair, r]));
  const rows = chosen.map((p) => {
    const cs = candleMap.get(p);
    if (!cs || cs.length < 60) return null;
    if (!bookMap.has(p)) return preByPair.get(p) || null;
    return analyse({ pair: p, c5: cs, btc5: p === 'BTC-EUR' ? null : btc5, book: bookMap.get(p) || null, fee, mode, comp, minCrv });
  }).filter(Boolean);

  // --- Marktregime: Breadth statt Bauchgefühl -----------------------------
  const above = rows.filter((x) => x.aboveVwap).length;
  const breadth = rows.length ? above / rows.length : 0;
  const btcRow = rows.find((x) => x.pair === 'BTC-EUR');
  const btcTrend = btcRow ? btcRow.mtf : 5;
  let marketRegime = 'Neutral';
  if (breadth >= 0.62 && btcTrend >= 5.5) marketRegime = 'Risk-On';
  else if (breadth <= 0.32 || btcTrend <= 3.8) marketRegime = 'Risk-Off';

  // Im Risk-Off keine grünen Longs außer echten Reversals
  if (marketRegime === 'Risk-Off') {
    for (const row of rows) {
      if (row.light === 'green' && row.regime !== 'Reversal') {
        row.light = 'yellow'; row.blockers.unshift('Marktregime Risk-Off');
      }
    }
  }

  const rank = { green: 3, yellow: 2, red: 1 };
  rows.sort((a, b) => rank[b.light] - rank[a.light] || b.score - a.score || b.premove - a.premove);

  return {
    ts: Date.now(), version: APP_VERSION,
    fee, feeBps: Math.round(fee * 10_000),
    universe: eur.length, liquidCount: liquid.length, deepCount: rows.length, bookCount: bookPairs.length,
    // scanned = tatsächlich tief analysiert. Die Anzeigemenge legt das Frontend fest.
    scanned: rows.length, requested: chosen.length,
    subrequests: c.used, requests: c.used,        // "requests" = Alias fürs Frontend
    mode, components: [...comp],
    marketRegime, breadth: r2(breadth), btcTrend: r1(btcTrend),
    rows,
  };
}

/* ============================================= Cache + Single-Flight-Schutz */
let memo = { ts: 0, data: null };
let inflight = null;
let inflightSig = '';
let btcRef = null;        // letzte BTC-Kerzen fuer die RS-Berechnung im Einzelabruf

/* ------------------------------------------------------- Verbindungsstatus
   Speist die Ampeln „Krypto ● | Aktien ●“ in der Kopfzeile. Es wird nur
   berichtet, was aus echten Antworten ableitbar ist — nichts geschätzt. */
const apiState = {
  crypto: { state: 'unknown', ts: 0, message: null },
  stocks: { state: 'unknown', ts: 0, message: null },
  alpaca: { state: 'unknown', ts: 0, message: null },
};
function setApiState(which, state, message = null) {
  apiState[which] = { state, ts: Date.now(), message: message ? String(message).slice(0, 220) : null };
}
function classifyError(e) {
  const m = String(e?.message || e || '');
  if (/api[_-]?key|unauthor|401|403/i.test(m)) return 'nokey';
  if (/day|daily|täglich|out of api credits for the day/i.test(m)) return 'daylimit';
  if (/429|rate|too many|run out of api credits/i.test(m)) return 'ratelimit';
  if (/cpu|exceeded|resource|1102/i.test(m)) return 'cpu';
  return 'error';
}

function cronLog(provider, state, message, extra = {}) {
  console.error(JSON.stringify({
    event: 'fusionpulse_cron_provider', provider, state,
    message: message ? String(message).slice(0, 300) : null,
    ts: Date.now(), ...extra,
  }));
}
async function persistApiState(env, which, state, message = null, ts = Date.now()) {
  if (!env?.DB) return;
  try {
    await ensureD1Schema(env);
    const value = safeJson({ state, message: message ? String(message).slice(0, 220) : null, ts });
    await env.DB.prepare(
      `INSERT INTO fp_meta(key,value,updated_ts) VALUES(?,?,?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_ts=excluded.updated_ts`
    ).bind(`provider_health:${which}`, value, ts).run();
  } catch (e) {
    console.warn(JSON.stringify({ event:'fusionpulse_health_persist_failed', provider:which, message:String(e?.message||e), ts:Date.now() }));
  }
}
async function persistentApiState(env, which, configured) {
  if (!configured) return { state:'nokey', ts:0, message:'nicht konfiguriert', persistent:true };
  const local = apiState[which] || { state:'unknown', ts:0, message:null };
  if (!env?.DB) return { ...local, persistent:false };
  try {
    await ensureD1Schema(env);
    const meta = await env.DB.prepare('SELECT value,updated_ts FROM fp_meta WHERE key=? LIMIT 1')
      .bind(`provider_health:${which}`).first();
    let saved = null;
    if (meta?.value) { try { saved = JSON.parse(meta.value); } catch {} }
    if (saved?.state) {
      const age = Date.now() - Number(saved.ts || meta.updated_ts || 0);
      const staleAfter = which === 'crypto' ? 20*60_000 : 45*60_000;
      return { state: saved.state === 'ok' && age > staleAfter ? 'stale' : saved.state,
        ts:Number(saved.ts || meta.updated_ts || 0), message:saved.message || null, persistent:true, ageMs:age };
    }
    const source = which === 'crypto' ? 'Bitpanda Fusion' : which === 'stocks' ? 'Twelve Data' : 'Alpaca IEX';
    const snap = await env.DB.prepare('SELECT MAX(ts) ts FROM market_snapshots WHERE source=?').bind(source).first();
    if (Number(snap?.ts) > 0) {
      const age = Date.now() - Number(snap.ts);
      const staleAfter = which === 'crypto' ? 20*60_000 : 45*60_000;
      return { state:age > staleAfter ? 'stale' : 'ok', ts:Number(snap.ts), message:'aus letztem D1-Snapshot abgeleitet', persistent:true, ageMs:age };
    }
  } catch (e) {
    console.warn(JSON.stringify({ event:'fusionpulse_health_read_failed', provider:which, message:String(e?.message||e), ts:Date.now() }));
  }
  return { ...local, persistent:false };
}

/** Der Cache muss die Analyse-Einstellung kennen, sonst liefert ein Moduswechsel
 *  bis zu 18 s lang noch das Ergebnis der alten Einstellung. */
function snapSig(opts) {
  return [
    opts.mode || 'composite',
    [...(opts.comp || ALL_ON)].sort().join('.'),
    opts.deep || '',
    (opts.watch || []).join('.'),
    opts.minCrv || '',
  ].join('|');
}

// Persistenter Warm-Start für die PWA. Nach einem Worker-Deploy ist der
// In-Memory-Cache leer, der Cloudflare-Cron läuft aber unabhängig von der PWA.
// Der letzte vollständige Scan wird daher zusätzlich in D1/fp_meta abgelegt.
let lastCryptoPersistTs = 0;
async function persistCryptoScan(env, sig, data) {
  if (!env?.DB || !data?.rows?.length) return;
  if (Date.now() - lastCryptoPersistTs < 60_000) return;
  lastCryptoPersistTs = Date.now();
  try {
    await ensureD1Schema(env);
    const payload = safeJson({ ts: Date.now(), sig, data });
    await env.DB.prepare(
      `INSERT INTO fp_meta(key,value,updated_ts) VALUES(?,?,?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_ts=excluded.updated_ts`
    ).bind('crypto_scan:last', payload, Date.now()).run();
  } catch (e) {
    console.warn(JSON.stringify({ event:'fusionpulse_crypto_cache_write_failed', message:String(e?.message||e), ts:Date.now() }));
  }
}
async function readPersistedCryptoScan(env, sig) {
  if (!env?.DB) return null;
  try {
    await ensureD1Schema(env);
    const row = await env.DB.prepare('SELECT value,updated_ts FROM fp_meta WHERE key=? LIMIT 1').bind('crypto_scan:last').first();
    if (!row?.value) return null;
    const p = JSON.parse(row.value);
    const data = p?.data;
    const ts = Number(p?.ts || row.updated_ts || data?.ts || 0);
    if (!data?.rows?.length || !ts || Date.now() - ts > 20*60_000) return null;
    // Exakte Einstellungen bevorzugen. Ein abweichender letzter Cron-Scan ist
    // trotzdem besser als minutenlang gar keine Coins; er wird als warmStart
    // markiert und beim nächsten normalen Scan ersetzt.
    return { ...data, ts: data.ts || ts, cached:true, persistent:true, warmStart:p?.sig !== sig };
  } catch (e) {
    console.warn(JSON.stringify({ event:'fusionpulse_crypto_cache_read_failed', message:String(e?.message||e), ts:Date.now() }));
    return null;
  }
}

async function getSnapshot(env, opts, force) {
  const sig = snapSig(opts);
  const fresh = memo.sig === sig && Date.now() - memo.ts < CFG.TTL_MS;
  if (!force && fresh && memo.data) return { ...memo.data, cached: true };
  if (!force && !memo.data) {
    const persisted = await readPersistedCryptoScan(env, sig);
    if (persisted) {
      memo = { ts: Date.now(), sig, data: persisted };
      setApiState('crypto', 'ok', 'Persistenter Cron-Scan geladen');
      return persisted;
    }
  }
  // v3.3.7: Ein langsamer/defekter Upstream darf den Browser niemals an ein
  // bereits laufendes Promise ketten. Bevorzugt wird der letzte gute Snapshot;
  // der laufende Refresh darf im Hintergrund zu Ende laufen oder fehlschlagen.
  if (!force && inflight && inflightSig === sig) {
    if (memo.data) return { ...memo.data, cached:true, staleWhileRefresh:true, cacheAgeMs:Date.now()-memo.ts };
    const persisted = await readPersistedCryptoScan(env, sig);
    if (persisted) return { ...persisted, staleWhileRefresh:true };
  }
  if (force && inflight) {
    // Kein await auf den alten Request: Force muss einen unabhängigen Neuversuch erlauben.
    inflight = null; inflightSig = '';
  }

  inflightSig = sig;
  inflight = (async () => {
    try {
      const data = await runScan(env.FUSION_API_KEY, opts);
      memo = { ts: Date.now(), sig, data };
      setApiState('crypto', 'ok');
      if (env.SNAP) await env.SNAP.put('snapshot', JSON.stringify(data), { expirationTtl: 60 });
      await persistCryptoScan(env, sig, data);
      return data;
    } catch (e) {
      setApiState('crypto', classifyError(e), e?.message);
      // Fail-open nur für die ANZEIGE des letzten guten Datensatzes, niemals für
      // BUY-Freigaben: alte Daten werden als stale/cached markiert und das Frontend
      // kann damit keine frische grüne Freigabe erzeugen.
      if (memo.data) return { ...memo.data, cached:true, stale:true, upstreamError:String(e?.message||e), cacheAgeMs:Date.now()-memo.ts };
      const persisted = await readPersistedCryptoScan(env, sig);
      if (persisted) return { ...persisted, stale:true, upstreamError:String(e?.message||e) };
      throw e;
    } finally { inflight = null; }
  })();
  return { ...(await inflight), cached: false };
}

/* ================================================================== Routing */
const json = (o, status = 200, extra = {}) => new Response(JSON.stringify(o), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=5, s-maxage=15, stale-while-revalidate=30',
    ...extra,
  },
});


/* ========================================================================
   US-Aktienradar — Twelve Data (optional)                       v3.0.7
   Free-freundlich: 21 liquide Titel, pro 5-Minuten-Slot nur 7 Titel. Damit
   wird jeder Titel etwa alle 15 Minuten aktualisiert; FX wird 30 Min gecacht.
   Firmennamen kommen aus einer LOKALEN Tabelle — kein zusätzlicher Request
   pro Refresh. Liefert time_series ein meta.name mit, wird es bevorzugt.
   US-Feed, nicht Tradegate. EUR-Werte sind gekennzeichnete Umrechnungen.
   ======================================================================== */
const STOCK_UNIVERSE = [
  ['Technologie',  'NVDA',  'NVIDIA Corporation'],
  ['Technologie',  'MSFT',  'Microsoft Corporation'],
  ['Technologie',  'AAPL',  'Apple Inc.'],
  ['Kommunikation','META',  'Meta Platforms, Inc.'],
  ['Kommunikation','GOOGL', 'Alphabet Inc.'],
  ['Kommunikation','NFLX',  'Netflix, Inc.'],
  ['Konsum',       'AMZN',  'Amazon.com, Inc.'],
  ['Konsum',       'TSLA',  'Tesla, Inc.'],
  ['Konsum',       'COST',  'Costco Wholesale Corporation'],
  ['Finanzen',     'JPM',   'JPMorgan Chase & Co.'],
  ['Finanzen',     'BAC',   'Bank of America Corporation'],
  ['Finanzen',     'GS',    'The Goldman Sachs Group, Inc.'],
  ['Gesundheit',   'LLY',   'Eli Lilly and Company'],
  ['Gesundheit',   'UNH',   'UnitedHealth Group Incorporated'],
  ['Gesundheit',   'ABBV',  'AbbVie Inc.'],
  ['Energie',      'XOM',   'Exxon Mobil Corporation'],
  ['Energie',      'CVX',   'Chevron Corporation'],
  ['Energie',      'COP',   'ConocoPhillips'],
  ['Industrie',    'CAT',   'Caterpillar Inc.'],
  ['Industrie',    'BA',    'The Boeing Company'],
  ['Industrie',    'GE',    'GE Aerospace'],
];
const STOCK_NAMES = Object.fromEntries(STOCK_UNIVERSE.map(([, s, n]) => [s, n]));
// v3.4.2: Automatic stock discovery is intentionally restricted to a curated
// large-cap / highly liquid US universe. The goal is practical broker
// tradability (Flatex/Tradegate) rather than maximum candidate count. This is
// an inclusion-only gate: unknown/small/micro-cap symbols cannot enter Radar
// or Opening Momentum automatically. Manual search/favorites remain separate.
const LARGE_CAP_RADAR_SYMBOLS = new Set([
  'AAPL','ABBV','AMD','AMAT','AMZN','ARM','AVGO','BA','BAC','CAT','CEG','COP','COST',
  'CRM','CRWD','CVX','DIS','GE','GOOG','GOOGL','GS','HD','HOOD','IBM','INTC','JNJ',
  'JPM','LLY','MA','META','MRK','MSFT','MSTR','MU','NFLX','NKE','NVDA','ORCL','PFE',
  'PLTR','QCOM','TMO','TSLA','UBER','UNH','V','WMT','XOM'
]);
function largeCapRadarAllowed(symbol){
  return LARGE_CAP_RADAR_SYMBOLS.has(String(symbol||'').trim().toUpperCase().replace(/\./g,'-'));
}

/* ==== v3.8.0 · MOMENTUM-MODUS: messbares Gitter statt Namensliste ===========
   BEFUND: Bis 3.7.0 war `largeCapRadarAllowed` ein Einlass-Gate, das aus rund
   12.000 von Tiingo gescannten Titeln genau 48 durchliess — alles Mega-Caps.
   Ein Nachrichten-Mover wie MRNA konnte den Radar deshalb NIE von selbst
   erreichen, obwohl die Daten dafuer laengst vorlagen. Der Nutzer sucht aber
   genau solche Titel; die App suchte per Konstruktion daran vorbei.

   Ersetzt durch ein Gitter aus MESSBAREN Groessen. Das ist ehrlicher als eine
   gepflegte Namensliste, weil es Handelbarkeit prueft statt Bekanntheit — und
   es veraltet nicht. Bewusst konservativ, weil Illiquiditaet beim schnellen
   Ein- und Aussteigen teurer ist als eine verpasste Gelegenheit.

   Der Large-Cap-Pfad bleibt unveraendert bestehen und ist weiterhin Default.
   Der Momentum-Pfad ist ein ZWEITER Modus, keine Ersetzung.                 */
const MOM_MIN_PRICE_USD   = 5;        // unter 5 $ beginnt das Penny-Stock-Gebiet
/* ACHTUNG, Kalibrierungsrisiko (v3.8.1): Der Tiingo-IEX-Feed liefert das
   Volumen der Boerse IEX — und IEX hat nur rund 2–3 % des US-Handelsvolumens.
   Ein Titel mit 500 Mio. $ Gesamtumsatz zeigt hier vielleicht 10–15 Mio. $.
   Eine Schwelle von 20 Mio. $ (erster Entwurf) haette deshalb fast alles
   ausgeschlossen — die Liste waere leer geblieben und haette wie ein Defekt
   ausgesehen. Der Wert ist bewusst als IEX-ANTEIL gesetzt, mit grosszuegiger
   Reserve nach unten; die Handelbarkeit sichern zusaetzlich Kurs- und
   Spread-Kriterium ab. Nach dem ersten Live-Lauf anhand der Zaehler in
   `radarGateStats` nachkalibrieren statt weiter zu schaetzen.            */
const MOM_MIN_DOLLARVOL   = 2_000_000; // IEX-Anteil, entspricht grob 60–100 Mio. $ gesamt

/* ═══════════ v3.32.0 · R11 · DIE SCHWELLE HAENGT AN DER MARKTBREITE ════════
   DAS PROBLEM, das im Bandbreiten-Audit fehlt und das mich am Alpaca-Upgrade
   am meisten stoert:

   `MOM_MIN_DOLLARVOL = 2 Mio. $` ist KEINE absolute Groesse. Der Wert ist auf
   den IEX-ANTEIL kalibriert — auf einen Feed, der rund 2–3 % des US-Volumens
   sieht. Die Herleitung steht direkt darueber: 20 Mio. $ (erster Entwurf)
   haetten fast alles ausgesperrt, weil die Zahl im Nenner ein Bruchteil ist.

   Wechselt der Feed auf SIP — was das Audit in §22–§34 empfiehlt und was ein
   Alpaca-Upgrade nahelegt — liefert derselbe Titel plotzlich das 30- bis
   50-fache Volumen. Dieselbe Schwelle waere dann trivial erfuellbar und das
   Einlassgitter faktisch AUS. Das ist exakt der Fehler „Schwelle am falschen
   Massstab" aus v3.8.1, nur in die andere Richtung, und er verstoesst gegen
   Regel 4: ein Feed-Wechsel darf nichts erleichtern.

   Er wuerde auch nicht auffallen. Die Liste wuerde nicht leer, sondern LAENGER
   — und eine laengere Kandidatenliste sieht nach Erfolg aus. Die schlimmste
   Sorte Fehler in diesem Projekt.

   LOESUNG: Die Schwelle wird an die tatsaechliche Marktbreite gekoppelt. Nicht
   an einen Tarifnamen (§33.8), sondern an den Feed, den die App gerade
   benutzt. Fail-closed: ein unbekannter Feed bekommt den STRENGEN
   Gesamtmarkt-Faktor, nicht den milden IEX-Faktor — wer nicht weiss, wie breit
   er sieht, darf nicht die grosszuegige Schwelle bekommen.

   Der Faktor 35 ist die Mitte der 2–3-%-Spanne (1/0,028 ≈ 35). Er ist
   ausdruecklich eine HERLEITUNG, keine Messung, und gehoert nach dem ersten
   Lauf mit konsolidiertem Feed anhand von `radarGateStats` nachkalibriert —
   dieselbe Auflage, die schon fuer den IEX-Wert gilt. Bis dahin ist er die
   ehrlichere Naeherung als ein Wert, der nachweislich fuer den falschen Feed
   gilt. */
const BREADTH_FACTOR = { iex: 1, sip: 35, unknown: 35 };

function marketBreadthKey(env){
  /* Der Aktien-Radar laeuft ueber Tiingo IEX. Solange das so ist, ist die
     Marktbreite IEX — unabhaengig davon, was Alpaca fuer die Live-Quotes
     macht. Erst wenn der Radar selbst auf einen konsolidierten Feed umgestellt
     wird, aendert sich der Massstab.
     Die Umstellung wird ueber RADAR_FEED gesteuert. Fehlt die Variable,
     gilt IEX — das ist der Ist-Zustand und der einzige, der belegt ist. */
  const raw=String(env?.RADAR_FEED||'').toLowerCase();
  if(raw==='sip'||raw==='consolidated') return 'sip';
  if(raw==='iex'||raw==='') return 'iex';
  return 'unknown';
}
function momMinDollarVol(env){
  const key=marketBreadthKey(env);
  const f=BREADTH_FACTOR[key];
  return MOM_MIN_DOLLARVOL * (Number.isFinite(f)?f:BREADTH_FACTOR.unknown);
}
/* v3.9.0 · Hoechstalter des juengsten Bars fuer eine Modus-A-Freigabe.
   Begruendung: Bei 10–15 % Tagesbewegung laeuft ein Titel in 10 Minuten leicht
   1–2 % weiter. Ein Plan auf Basis eines solchen Kurses hat einen Stop, der real
   schon durchbrochen ist, oder ein Ziel, das bereits erreicht wurde. Der Feed
   liefert 5-Minuten-Bars; 600 Sekunden lassen genau einen verspaeteten Bar zu,
   danach ist der Plan nicht mehr belastbar. Fail-closed: unbekanntes Alter zaehlt
   wie zu alt. */
const MOM_MAX_QUOTE_AGE_SEC = 600;
const MOM_MAX_SPREAD_PCT  = 0.60;     // darueber frisst die Spanne den Ertrag
const MOM_MIN_MOVE_PCT    = 3.0;      // darunter ist es kein Mover

/* Zaehlt, woran Kandidaten scheitern. Ohne diese Zahlen laesst sich eine leere
   Liste nicht von einer zu strengen Schwelle unterscheiden — und genau das
   waere hier der wahrscheinlichste Fehler. */
let radarGateStats={ts:0,seen:0,largeCap:0,momentum:0,failPrice:0,failVolume:0,failSpread:0,failMove:0};
function resetRadarGateStats(){ radarGateStats={ts:Date.now(),seen:0,largeCap:0,momentum:0,failPrice:0,failVolume:0,failSpread:0,failMove:0}; }
function momentumRadarAllowed(r,count=false,env=null){
  const price=Number(r?.last);
  const vol=Number(r?.volume);
  const spread=Number(r?.spreadPct);
  const move=Math.abs(Number(r?.movePct));
  if(!(price>=MOM_MIN_PRICE_USD)){ if(count)radarGateStats.failPrice++; return false; }   // fail-closed
  // v3.32.0 · R11: Schwelle am Massstab des tatsaechlich benutzten Feeds.
  if(!(vol>0) || !(price*vol>=momMinDollarVol(env))){ if(count)radarGateStats.failVolume++; return false; }
  if(Number.isFinite(spread) && spread>MOM_MAX_SPREAD_PCT){ if(count)radarGateStats.failSpread++; return false; }
  if(!(move>=MOM_MIN_MOVE_PCT)){ if(count)radarGateStats.failMove++; return false; }
  return true;
}
/** Einlass in den Radar: Large-Cap-Liste ODER messbar handelbarer Mover. */
function radarCandidateAllowed(r,count=false,env=null){
  if(count) radarGateStats.seen++;
  if(largeCapRadarAllowed(r?.symbol)){ if(count)radarGateStats.largeCap++; return true; }
  const ok=momentumRadarAllowed(r,count,env);
  if(ok&&count) radarGateStats.momentum++;
  return ok;
}
const STOCK_SEARCH_CATALOG = [
  ...STOCK_UNIVERSE,
  ['Technologie','PLTR','Palantir Technologies Inc.'], ['Technologie','IONQ','IonQ, Inc.'],
  ['Technologie','RGTI','Rigetti Computing, Inc.'], ['Technologie','MSTR','Strategy Inc.'],
  ['Gesundheit','MRNA','Moderna, Inc.'], ['Technologie','AMD','Advanced Micro Devices, Inc.'],
  ['Technologie','AVGO','Broadcom Inc.'], ['Technologie','ARM','Arm Holdings plc'],
  ['Technologie','SMCI','Super Micro Computer, Inc.'], ['Finanzen','COIN','Coinbase Global, Inc.'],
  ['Finanzen','HOOD','Robinhood Markets, Inc.'], ['Finanzen','SOFI','SoFi Technologies, Inc.'],
  ['Technologie','CRWD','CrowdStrike Holdings, Inc.'], ['Technologie','SNOW','Snowflake Inc.'],
  ['Konsum','UBER','Uber Technologies, Inc.'], ['Industrie','RKLB','Rocket Lab USA, Inc.'],
  ['Rohstoffe','AEM','Agnico Eagle Mines Limited'], ['Rohstoffe','AG','First Majestic Silver Corp.'],
  ['Gesundheit','ABSI','Absci Corporation'], ['Energie','CEG','Constellation Energy Corporation'],
  ['Gesundheit','UTHR','United Therapeutics Corporation'], ['Technologie','VEEV','Veeva Systems Inc.'],
  ['Gesundheit','SDGR','Schrödinger, Inc.'],
  /* v3.18.0 · Nachtrag zu P-A4. Die Katalog-Reserve nuetzt nur so viel, wie im
     Katalog steht — und fuer Edelmetalle standen dort GENAU ZWEI Titel. Der
     rotierende Einstieg haette also immer dieselben zwei gezogen. Ergaenzt sind
     liquide, US-gelistete Werte aus der Prioritaetsliste; alles darunter
     scheitert ohnehin am Preis- oder Umsatz-Gitter.
     Sie bekommen dadurch AUFMERKSAMKEIT, keinen Bonus: der Katalog ist ein
     Ansehpfad, kein Score-Eingang. */
  ['Rohstoffe','NEM','Newmont Corporation'], ['Rohstoffe','GOLD','Barrick Mining Corporation'],
  ['Rohstoffe','FCX','Freeport-McMoRan Inc.'], ['Rohstoffe','WPM','Wheaton Precious Metals Corp.'],
  ['Rohstoffe','KGC','Kinross Gold Corporation'], ['Rohstoffe','PAAS','Pan American Silver Corp.'],
  ['Rohstoffe','SBSW','Sibanye Stillwater Limited'], ['Rohstoffe','HL','Hecla Mining Company'],
  /* Pharma war mit 7 von 63 ebenfalls duenn vertreten. */
  ['Gesundheit','VRTX','Vertex Pharmaceuticals Incorporated'], ['Gesundheit','REGN','Regeneron Pharmaceuticals, Inc.'],
  ['Gesundheit','GILD','Gilead Sciences, Inc.'], ['Gesundheit','BMY','Bristol-Myers Squibb Company']
];
const STOCK_SEARCH_BY_SYMBOL = new Map(STOCK_SEARCH_CATALOG.map(([sector, symbol, name]) => [symbol, { sector, symbol, name }]));
function resolveStockQuery(raw) {
  const q = String(raw || '').trim().toUpperCase();
  if (!q) return null;
  if (STOCK_SEARCH_BY_SYMBOL.has(q)) return STOCK_SEARCH_BY_SYMBOL.get(q);
  const hit = STOCK_SEARCH_CATALOG.find(([sector, symbol, name]) => name.toUpperCase() === q || (q.length >= 3 && name.toUpperCase().startsWith(q)));
  if (hit) return { sector: hit[0], symbol: hit[1], name: hit[2] };
  if (/^[A-Z][A-Z0-9.\-]{0,7}$/.test(q)) return { sector: 'Watchlist', symbol: q, name: q };
  return null;
}

let stockMemo = { ts: 0, rows: [], cycle: -1, sig: '' };
let fxMemo = { ts: 0, usdPerEur: null };
const stockLookupMemo = new Map();

async function persistStockScan(env, sig, cycle, rows, meta={}) {
  if(!env?.DB || !rows?.length) return;
  try {
    await ensureD1Schema(env);
    const ts=Date.now();
    const payload=safeJson({ts,sig,cycle,rows,meta});
    await env.DB.prepare(`INSERT INTO fp_meta(key,value,updated_ts) VALUES(?,?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_ts=excluded.updated_ts`)
      .bind('stock_scan:last',payload,ts).run();
  } catch(e){ console.warn(JSON.stringify({event:'fusionpulse_stock_cache_write_failed',message:String(e?.message||e),ts:Date.now()})); }
}
async function readPersistedStockScan(env, sig, cycle) {
  if(!env?.DB) return null;
  try {
    await ensureD1Schema(env);
    const row=await env.DB.prepare('SELECT value,updated_ts FROM fp_meta WHERE key=? LIMIT 1').bind('stock_scan:last').first();
    if(!row?.value) return null;
    const p=JSON.parse(row.value), ts=Number(p?.ts||row.updated_ts||0);
    if(!p?.rows?.length || p.sig!==sig || Number(p.cycle)!==Number(cycle) || Date.now()-ts>55_000) return null;
    return {rows:p.rows,ts,meta:p.meta||{}};
  } catch(e){ console.warn(JSON.stringify({event:'fusionpulse_stock_cache_read_failed',message:String(e?.message||e),ts:Date.now()})); return null; }
}
// v3.2.4: UI-Requests lesen den letzten serverseitigen Aktienbatch unabhängig
// von Favoriten-/UI-Signaturen. Dadurch startet jeder Browser/Worker-Isolate
// NICHT erneut den teuren Whole-Market-/Deep-Scan. Der Cron bleibt die einzige
// Instanz, die den autonomen Aktien-Hintergrundscan erzeugt.
async function readLatestPersistedStockScan(env,maxAgeMs=4*60_000){
  if(!env?.DB)return null;
  try{
    await ensureD1Schema(env);
    const row=await env.DB.prepare('SELECT value,updated_ts FROM fp_meta WHERE key=? LIMIT 1').bind('stock_scan:last').first();
    if(!row?.value)return null;
    const x=JSON.parse(row.value),ts=Number(x?.ts||row.updated_ts||0);
    if(!x?.rows?.length||Date.now()-ts>maxAgeMs)return null;
    return {rows:x.rows,ts,cycle:Number(x.cycle)||-1,sig:String(x.sig||''),meta:x.meta||{}};
  }catch(e){console.warn(JSON.stringify({event:'fusionpulse_stock_latest_cache_read_failed',message:String(e?.message||e),ts:Date.now()}));return null;}
}

/* ---- v3.5.1: konfigurierbare Deep-Scan-Tiefe -----------------------------
   Die 20-Titel-Grenze war fest verdrahtet und ohne UI-Regler; die Warteschlange
   wird vom serverseitigen Cron gebaut (laeuft auch bei geschlossener PWA),
   daher ist die Tiefe eine geteilte Konto-Einstellung in D1, kein reiner
   Client-Zustand. Persistierter Wert; Fallback 20, wenn D1 fehlt/leer ist. */
const STOCK_DEEP_MIN=15, STOCK_DEEP_MAX=40, STOCK_DEEP_DEFAULT=20;
let stockDeepMemo={value:STOCK_DEEP_DEFAULT,ts:0};
function clampStockDeep(n){ const v=Math.round(Number(n)); return Number.isFinite(v)?Math.max(STOCK_DEEP_MIN,Math.min(STOCK_DEEP_MAX,v)):STOCK_DEEP_DEFAULT; }
async function readStockDeepLimit(env){
  if(stockDeepMemo.value && Date.now()-stockDeepMemo.ts<60_000) return stockDeepMemo.value;
  if(!env?.DB){ stockDeepMemo={value:STOCK_DEEP_DEFAULT,ts:Date.now()}; return STOCK_DEEP_DEFAULT; }
  try{
    await ensureD1Schema(env);
    const row=await env.DB.prepare('SELECT value FROM fp_meta WHERE key=? LIMIT 1').bind('stock_deep_limit').first();
    const v=clampStockDeep(row?.value);
    stockDeepMemo={value:v,ts:Date.now()};
    return v;
  }catch(e){ console.warn(JSON.stringify({event:'stock_deep_read_failed',message:String(e?.message||e),ts:Date.now()})); return STOCK_DEEP_DEFAULT; }
}
async function persistStockDeepLimit(env, n){
  const v=clampStockDeep(n);
  stockDeepMemo={value:v,ts:Date.now()};
  if(!env?.DB) return v;
  try{
    await ensureD1Schema(env);
    await env.DB.prepare('INSERT INTO fp_meta(key,value,updated_ts) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_ts=excluded.updated_ts')
      .bind('stock_deep_limit',String(v),Date.now()).run();
  }catch(e){ console.warn(JSON.stringify({event:'stock_deep_write_failed',message:String(e?.message||e),ts:Date.now()})); }
  return v;
}

/* ---- v3.5.1: Tiingo-Kontingent — App-Eigenzaehlung -----------------------
   Tiingo liefert (anders als Twelve Data) KEINE Nutzungs-Header in der
   REST-Antwort und KEINEN oeffentlichen usage-Endpoint. Es gibt daher keinen
   Weg, das reale Kontingent aus der API selbst auszulesen. Diese Zaehlung ist
   ausdrueckliche eine App-Schaetzung: sie zaehlt nur Requests, die DIESER
   Worker absetzt, nicht das gesamte Tiingo-Konto (z.B. Web-Dashboard-Zugriffe
   zaehlen nicht mit). Ehrlich als "state:'app-estimate'" gekennzeichnet.
   Plan-Obergrenzen laut oeffentlicher Tiingo-Preisseite (Power, Stand 2026):
   10.000 Requests/Stunde, 100.000 Requests/Tag. BOATS ist ein Entitlement
   ohne separates Limit, zaehlt gegen dasselbe Kontingent. */
const TIINGO_PLAN_LIMITS = { hourly: 10_000, daily: 100_000 };
const tiingoHourKey = (d=new Date()) => `${d.toISOString().slice(0,13)}`; // YYYY-MM-DDTHH
const tiingoDayKeyUTC = (d=new Date()) => d.toISOString().slice(0,10);
let tiingoQuota = { hourKey:'', hourCalls:0, dayKey:'', dayCalls:0, loadedFromD1:false };
async function loadTiingoQuotaOnce(env){
  if(tiingoQuota.loadedFromD1 || !env?.DB) return;
  try{
    await ensureD1Schema(env);
    const row=await env.DB.prepare('SELECT value FROM fp_meta WHERE key=? LIMIT 1').bind('tiingo_quota').first();
    if(row?.value){
      const p=JSON.parse(row.value);
      const hk=tiingoHourKey(), dk=tiingoDayKeyUTC();
      tiingoQuota={
        hourKey:p.hourKey===hk?hk:hk, hourCalls:p.hourKey===hk?(Number(p.hourCalls)||0):0,
        dayKey:p.dayKey===dk?dk:dk, dayCalls:p.dayKey===dk?(Number(p.dayCalls)||0):0,
        loadedFromD1:true,
      };
    } else tiingoQuota.loadedFromD1=true;
  }catch(e){ console.warn(JSON.stringify({event:'tiingo_quota_load_failed',message:String(e?.message||e),ts:Date.now()})); tiingoQuota.loadedFromD1=true; }
}
let tiingoQuotaPersistTimer=0;
function noteTiingoCall(env){
  const hk=tiingoHourKey(), dk=tiingoDayKeyUTC();
  if(tiingoQuota.hourKey!==hk){ tiingoQuota.hourKey=hk; tiingoQuota.hourCalls=0; }
  if(tiingoQuota.dayKey!==dk){ tiingoQuota.dayKey=dk; tiingoQuota.dayCalls=0; }
  tiingoQuota.hourCalls++; tiingoQuota.dayCalls++;
  // Persistenz throttlen: nicht bei jedem Call synchron auf D1 schreiben.
  if(env?.DB && Date.now()-tiingoQuotaPersistTimer>15_000){
    tiingoQuotaPersistTimer=Date.now();
    const payload=JSON.stringify(tiingoQuota);
    ensureD1Schema(env).then(()=>env.DB.prepare(
      'INSERT INTO fp_meta(key,value,updated_ts) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_ts=excluded.updated_ts'
    ).bind('tiingo_quota',payload,Date.now()).run()).catch(e=>console.warn(JSON.stringify({event:'tiingo_quota_persist_failed',message:String(e?.message||e),ts:Date.now()})));
  }
}
function tiingoQuotaView(){
  const hk=tiingoHourKey(), dk=tiingoDayKeyUTC();
  const hourCalls = tiingoQuota.hourKey===hk?tiingoQuota.hourCalls:0;
  const dayCalls = tiingoQuota.dayKey===dk?tiingoQuota.dayCalls:0;
  return {
    state:'app-estimate', // ehrlich: keine echten Tiingo-Nutzungsdaten verfuegbar (kein Header, kein API-Endpoint)
    hourCalls, hourLimit:TIINGO_PLAN_LIMITS.hourly, hourPct:+Math.min(100,(hourCalls/TIINGO_PLAN_LIMITS.hourly)*100).toFixed(1),
    dayCalls, dayLimit:TIINGO_PLAN_LIMITS.daily, dayPct:+Math.min(100,(dayCalls/TIINGO_PLAN_LIMITS.daily)*100).toFixed(1),
    note:'App-eigene Zaehlung dieses Workers; Tiingo liefert keine Nutzungs-Header/Endpoint. Kein Konto-weiter Wert.',
  };
}


/* --- Kontingent-Überwachung ------------------------------------------------
   Twelve Data liefert bei JEDER Antwort die Header api-credits-used und
   api-credits-left. Beides wird 1:1 übernommen. Es wird NICHTS erfunden:
   fehlen die Header, bleibt der Wert null und die UI schreibt „unbekannt“.
   Das Minutenlimit ergibt sich aus used + left. Der Tagesverbrauch ist eine
   ausdrücklich als solche gekennzeichnete Eigenzählung dieses Workers. */
let tdQuota = {
  creditsUsed: null, creditsLeft: null, minuteLimit: null,
  dayKey: '', dayCredits: 0, dayLimit: null, dayLimitDerived: false,
  lastHeaderTs: 0,
};
const utcDayKey = () => new Date().toISOString().slice(0, 10);
async function noteQuota(env, res, creditsSpent) {
  const day = utcDayKey();
  if (tdQuota.dayKey !== day) { tdQuota.dayKey = day; tdQuota.dayCredits = 0; }
  // Lokal sofort fortschreiben; D1 spiegelt den Tagesverbrauch anschließend atomar
  // worker-/isolate-übergreifend. Dadurch ist die UI nicht mehr nur eine Instanzzählung.
  tdQuota.dayCredits += creditsSpent;

  const used = res?.headers?.get?.('api-credits-used');
  const left = res?.headers?.get?.('api-credits-left');
  if (used != null && left != null && used !== '' && left !== '') {
    const u = Number(used), l = Number(left);
    if (Number.isFinite(u) && Number.isFinite(l)) {
      tdQuota.creditsUsed = u; tdQuota.creditsLeft = l;
      tdQuota.minuteLimit = u + l;
      tdQuota.lastHeaderTs = Date.now();
      if (tdQuota.minuteLimit === 8) { tdQuota.dayLimit = 800; tdQuota.dayLimitDerived = true; }
    }
  }
  if (env?.DB && creditsSpent > 0) {
    try {
      await ensureD1Schema(env);
      const key=`twelve_quota:${day}`;
      await env.DB.prepare(
        `INSERT INTO fp_meta(key,value,updated_ts) VALUES(?,?,?)
         ON CONFLICT(key) DO UPDATE SET value=CAST(COALESCE(CAST(fp_meta.value AS INTEGER),0)+? AS TEXT),updated_ts=excluded.updated_ts`
      ).bind(key,String(creditsSpent),Date.now(),creditsSpent).run();
      const row=await env.DB.prepare('SELECT value FROM fp_meta WHERE key=? LIMIT 1').bind(key).first();
      const global=Number(row?.value);
      if(Number.isFinite(global)) tdQuota.dayCredits=global;
    } catch (e) {
      console.warn(JSON.stringify({event:'fusionpulse_quota_persist_failed',message:String(e?.message||e),ts:Date.now()}));
    }
  }
}
function quotaView() {
  const fresh = tdQuota.lastHeaderTs && Date.now() - tdQuota.lastHeaderTs < 10 * 60_000;
  return {
    creditsUsed: fresh ? tdQuota.creditsUsed : null,
    creditsLeft: fresh ? tdQuota.creditsLeft : null,
    minuteLimit: tdQuota.minuteLimit,
    dayCredits: tdQuota.dayCredits,          // Eigenzählung dieses Workers
    dayKey: tdQuota.dayKey,
    dayLimit: tdQuota.dayLimit,              // null = Anbieter liefert das nicht
    dayLimitDerived: tdQuota.dayLimitDerived,
    headerAgeMs: tdQuota.lastHeaderTs ? Date.now() - tdQuota.lastHeaderTs : null,
  };
}

const emaN = (arr, n) => { if (!arr.length) return 0; const k = 2 / (n + 1); let e = arr[0]; for (const x of arr.slice(1)) e = x * k + e * (1 - k); return e; };
const stockATR = (bars, n = 14) => { if (bars.length < 2) return 0; const tr = []; for (let i = 1; i < bars.length; i++) { const b = bars[i], p = bars[i - 1]; tr.push(Math.max(b.h - b.l, Math.abs(b.h - p.c), Math.abs(b.l - p.c))); } return tr.slice(-n).reduce((a, b) => a + b, 0) / Math.max(1, tr.slice(-n).length); };

const NY_FMT = new Intl.DateTimeFormat('en-US', { timeZone:'America/New_York', weekday:'short', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' });
function nyParts(date = new Date()) {
  const parts = NY_FMT.formatToParts(date);
  return Object.fromEntries(parts.map(p=>[p.type,p.value]));
}
function easterSundayUTC(year){
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),month=Math.floor((h+l-7*m+114)/31),day=((h+l-7*m+114)%31)+1;
  return new Date(Date.UTC(year,month-1,day));
}
function nthWeekdayUTC(year,month,weekday,n){const d=new Date(Date.UTC(year,month,1));const add=(weekday-d.getUTCDay()+7)%7+7*(n-1);d.setUTCDate(1+add);return d;}
function lastWeekdayUTC(year,month,weekday){const d=new Date(Date.UTC(year,month+1,0));d.setUTCDate(d.getUTCDate()-((d.getUTCDay()-weekday+7)%7));return d;}
function observedFixedUTC(year,month,day){const d=new Date(Date.UTC(year,month,day));if(d.getUTCDay()===6)d.setUTCDate(d.getUTCDate()-1);else if(d.getUTCDay()===0)d.setUTCDate(d.getUTCDate()+1);return d;}
function nyseCalendar(year){
  const easter=easterSundayUTC(year), goodFriday=new Date(easter);goodFriday.setUTCDate(easter.getUTCDate()-2);
  const dates=[observedFixedUTC(year,0,1),nthWeekdayUTC(year,0,1,3),nthWeekdayUTC(year,1,1,3),goodFriday,lastWeekdayUTC(year,4,1),observedFixedUTC(year,5,19),observedFixedUTC(year,6,4),nthWeekdayUTC(year,8,1,1),nthWeekdayUTC(year,10,4,4),observedFixedUTC(year,11,25)];
  return new Set(dates.map(d=>d.toISOString().slice(0,10)));
}
function usMarketPhase(date = new Date(), feed = null) {
  const p=nyParts(date), weekend=['Sat','Sun'].includes(p.weekday), mins=Number(p.hour)*60+Number(p.minute), y=Number(p.year), ymd=`${p.year}-${p.month}-${p.day}`, holiday=nyseCalendar(y).has(ymd);
  const iex = feed === 'iex';
  let key='closed', label='US-Markt geschlossen', help='Aktienwerte dienen nur der Vorbereitung; keine Live-BUY-Freigabe.';
  if(!weekend && !holiday){
    if(mins>=240&&mins<480){key='premarket-early';label='Premarket 04:00–08:00 ET';help=iex?'Voller US-Premarket läuft; IEX Free bildet diesen frühen Abschnitt nur eingeschränkt ab.':'US-Premarket / Extended Hours.';}
    else if(mins>=480&&mins<570){key='premarket';label=iex?'Premarket · IEX':'Premarket';help=iex?'IEX liefert Live-Daten, bildet aber nur einen Teil des US-Marktes ab.':'US-Premarket / Extended Hours.';}
    else if(mins>=570&&mins<660){key='opening';label='US-Opening · erste 90 Min.';help='Prioritätsfenster für Opening Momentum, Premarket-High, VWAP und Volumenbeschleunigung.';}
    else if(mins>=660&&mins<960){key='regular';label='US-Markt LIVE';help='Regulärer US-Handel.';}
    else if(mins>=960&&mins<1020){key='after';label=iex?'After Hours · IEX':'After Hours';help=iex?'IEX hat nur begrenzte Extended-Hours-Abdeckung.':'US-After-Hours.';}
    else if(mins>=1020&&mins<1200){key='after-limited';label=iex?'After Hours · IEX eingeschränkt':'After Hours';help=iex?'Voller US-Aftermarket läuft weiter, IEX Free ist hier eingeschränkt.':'US-After-Hours.';}
  }
  return { key,label,help, ny:`${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} ET`, weekday:p.weekday };
}
function isoAgo(minutes){ return new Date(Date.now()-minutes*60_000).toISOString(); }

function analyseStock(symbol, sector, src, usdPerEur, comp, minCrv = 3) {
  const on = comp instanceof Set ? comp : new Set(ALL_ON);
  const vals = src?.values;
  const bars = (vals || []).map((v) => ({ c: +v.close, h: +v.high, l: +v.low, o: +v.open, v: +v.volume || 0, dt: v.datetime }))
    .filter((b) => Number.isFinite(b.c)).reverse();
  if (bars.length < 24) return null;

  const cs = bars.map((b) => b.c), vs = bars.map((b) => b.v);
  const last = bars.at(-1), prev = bars.at(-2);
  const ema9 = emaN(cs.slice(-30), 9), ema21 = emaN(cs.slice(-40), 21), atr = stockATR(bars, 14);

  // VWAP über die vorliegenden Bars (Typical Price × Volumen)
  let pv = 0, vv = 0;
  for (const b of bars.slice(-26)) { const tp = (b.h + b.l + b.c) / 3; pv += tp * b.v; vv += b.v; }
  const volumeKnown = vv > 0;
  const vwap = volumeKnown ? pv / vv : null;

  const ret5 = (last.c / prev.c - 1) * 100;
  const ret15 = (last.c / bars.at(-4).c - 1) * 100;
  const ret60 = (last.c / bars.at(-13).c - 1) * 100;
  const vbaseArr = vs.slice(-21, -1).filter((v) => v > 0);
  const vbase = vbaseArr.length >= 8 ? mean(vbaseArr) : null;
  const relVol = vbase > 0 ? last.v / vbase : null; // null = Volumenbasis nicht belastbar
  const relVolScore = relVol == null ? null : relVol;

  // Gewichteter Mittelwert über AKTIVE Komponenten — abgeschaltet ≠ negativ.
  const trendScore = 5 + (last.c > ema21 ? 1.9 : -1.9) + (ema9 > ema21 ? 1.5 : -1.1);
  const momoScore = 5 + Math.max(-3.5, Math.min(3.5, ret15 * 2.2)) + Math.max(-1.5, Math.min(1.5, ret60 * 0.7));
  const volScore = relVolScore == null ? null : 5 + Math.max(-2.0, Math.min(3.5, (relVolScore - 1) * 3.0));
  const vwapScore = volumeKnown ? (last.c >= vwap ? 7.6 : 3.4) : null;
  const q = clamp(weighted([
    ['ema21', trendScore, 0.30],
    ['mtf',   momoScore,  0.30],
    ['volume', volScore,  0.20],
    ['vwap',  vwapScore,  0.20],
  ], on));

  const entry = Math.max(ema9, last.c - 0.20 * atr);
  const stop = entry - 1.25 * atr;
  const risk = Math.max(0.0001, entry - stop);
  const tp1 = entry + 1.7 * risk, tp2 = entry + 3.35 * risk;
  const tp2Pct = (tp2 / entry - 1) * 100;
  // Größerer Struktur-Zielraum: Elliott/Fibonacci-Heuristik, bewusst separat vom kurzfristigen TP2.
  // Grundlage ist der größere der aktuellen Impuls-/ATR-Spannen; 1,618 ist die klassische Fib-Extension.
  const impulsePct = Math.max(Math.abs(ret60), atr > 0 ? (atr / last.c) * 100 * 3 : 0);
  const structurePct = Math.max(0, Math.min(20, impulsePct * 1.618));
  const swingTarget = entry * (1 + structurePct / 100);
  // Liquidity-Vacuum-Heuristik: wie wenig frühere 5m-Aktivität direkt oberhalb
  // des Einstiegs liegt. 0 = viel Overhead, 100 = relativ freie Preiszone.
  const overhead = bars.slice(-36,-1).filter(b => b.c > entry && b.c <= entry + Math.max(atr*4, entry*.05));
  const avgVol = mean(vs.slice(-36,-1)) || 1;
  const overheadVol = overhead.reduce((a,b)=>a+b.v,0) / Math.max(1,overhead.length) / avgVol;
  const liquidityVacuum = clamp(100 - overheadVol*45 - overhead.length*2.2, 0, 100);

  // v3.4.3 Deep Situation Engine -------------------------------------------------
  // Ziel: fruehe, klar benennbare Markt-Situationen erkennen, OHNE den BUY-Score
  // anzuheben. Die Situation steuert nur Discovery-Reihenfolge/Erklaerung.
  const priorBars=bars.slice(-13,-1);
  const priorHigh=priorBars.length?Math.max(...priorBars.map(b=>b.h).filter(Number.isFinite)):null;
  const priorLow=priorBars.length?Math.min(...priorBars.map(b=>b.l).filter(Number.isFinite)):null;
  const triggerDistancePct=priorHigh>0?((priorHigh/last.c)-1)*100:null;
  const brokePriorHigh=priorHigh>0&&last.c>=priorHigh*1.0005;
  const nearBreakout=triggerDistancePct!=null&&triggerDistancePct>=-0.4&&triggerDistancePct<=0.7;
  const prevEma9=emaN(cs.slice(-31,-1),9), prevEma21=emaN(cs.slice(-41,-1),21);
  let ppv=0,pvv=0;
  for(const b of bars.slice(-27,-1)){const tp=(b.h+b.l+b.c)/3;ppv+=tp*b.v;pvv+=b.v;}
  const prevVwap=pvv>0?ppv/pvv:null;
  const reclaimVwap=volumeKnown&&prevVwap>0&&prev.c<prevVwap&&last.c>=vwap;
  const reclaimEma21=Number.isFinite(prevEma21)&&prev.c<=prevEma21&&last.c>ema21;
  const pullbackHold=last.c>ema21&&Math.min(...bars.slice(-4).map(b=>b.l))<=ema21*1.004&&ret5>0;
  const accel5v15=ret5-ret15/3;
  const priorRanges=bars.slice(-9,-1).map(b=>Math.max(0,b.h-b.l)).filter(Number.isFinite);
  const priorRangeMean=mean(priorRanges)||0;
  const currentRange=Math.max(0,last.h-last.l);
  const rangeExpansion=priorRangeMean>0?currentRange/priorRangeMean:null;
  const preWindow=bars.slice(-8,-1);
  const preRangePct=preWindow.length?((Math.max(...preWindow.map(b=>b.h))-Math.min(...preWindow.map(b=>b.l)))/last.c)*100:null;
  const squeezeRelease=preRangePct!=null&&atr>0&&preRangePct<Math.max(0.8,(atr/last.c*100)*2.1)&&brokePriorHigh&&rangeExpansion!=null&&rangeExpansion>=1.25;
  const extensionAtr=atr>0?(last.c-ema21)/atr:null;
  const overextended=extensionAtr!=null&&extensionAtr>3.0;

  let situationType='WATCH';
  const situationReasons=[];
  if(squeezeRelease){situationType='SQUEEZE RELEASE';situationReasons.push('Kompression loest sich am 60-Min-Hoch');}
  else if(brokePriorHigh&&accel5v15>0.05){situationType='BREAKOUT START';situationReasons.push('frischer Ausbruch ueber 60-Min-Hoch');}
  else if(reclaimVwap||reclaimEma21){situationType='RECLAIM';situationReasons.push(reclaimVwap?'VWAP zurueckerobert':'EMA21 zurueckerobert');}
  else if(pullbackHold){situationType='PULLBACK HOLD';situationReasons.push('Pullback haelt EMA21 und dreht');}
  else if(nearBreakout&&accel5v15>0.04){situationType='BREAKOUT PRESSURE';situationReasons.push('Triggerzone nahe und Momentum zieht an');}
  else if(accel5v15>0.10&&ret5>0){situationType='ACCELERATION';situationReasons.push('5-Min-Momentum beschleunigt gegen 15-Min-Basis');}
  if(relVolScore!=null&&relVolScore>=1.4)situationReasons.push(`RVOL ${relVolScore.toFixed(1)}x`);
  if(volumeKnown&&last.c>=vwap)situationReasons.push('ueber VWAP');
  if(liquidityVacuum>=70)situationReasons.push('wenig Overhead-Aktivitaet');
  if(overextended)situationReasons.push('bereits >3 ATR ueber EMA21');

  /* ══════════════════════════════════════ v3.27.0 · Score aufgeschluesselt ══
     Bis hierher standen die elf Terme als Zahlenkette im Code: 24, 16, 14, 12,
     45, 12, 8, -4, 7, -3, 0.16, -18, 42. Keine dieser Zahlen ist je gegen ein
     Ergebnis geprueft worden — sie stammen aus meinen und deinen Annahmen. Und
     genau dieser Score entscheidet, WELCHE Kandidaten ueberhaupt in der Liste
     landen. Er sitzt damit VOR jeder Kostenrechnung und jeder Rangfolge, die in
     v3.20.0 bis v3.23.0 entstanden ist.

     Die Zahlen sind unveraendert. Was sich aendert: sie stehen jetzt an EINER
     Stelle, jede mit ihrer Behauptung daneben, und jeder Beitrag wird einzeln
     mitgeschrieben. Erst dadurch wird die Frage "traegt dieser Term etwas bei
     oder schadet er" ueberhaupt beantwortbar.
     Ein Test stellt sicher, dass die Umstellung rechnerisch nichts veraendert.
     ═══════════════════════════════════════════════════════════════════════ */
  const situ = {
    breakout:  brokePriorHigh ? SITU_W.brokeHigh : nearBreakout ? SITU_W.nearBreak : 0,
    squeeze:   squeezeRelease ? SITU_W.squeeze : 0,
    reclaim:   (reclaimVwap || reclaimEma21) ? SITU_W.reclaim : 0,
    pullback:  pullbackHold ? SITU_W.pullback : 0,
    accel:     Math.min(SITU_W.accelCap, Math.max(0, accel5v15) * SITU_W.accelMul),
    rvol:      relVolScore == null ? SITU_W.rvolMissing
               : Math.min(SITU_W.rvolCap, Math.max(0, relVolScore - SITU_W.rvolBase) * SITU_W.rvolMul),
    vwap:      volumeKnown && last.c >= vwap ? SITU_W.aboveVwap : SITU_W.belowVwap,
    emaStack:  ema9 > ema21 ? SITU_W.emaUp : SITU_W.emaDown,
    vacuum:    Math.min(SITU_W.vacCap, Math.max(0, liquidityVacuum - SITU_W.vacBase) * SITU_W.vacMul),
    extended:  overextended ? SITU_W.overextended : 0,
  };
  let situationScore = Object.values(situ).reduce((a, b) => a + b, 0);
  if (!volumeKnown) situationScore = Math.min(situationScore, SITU_W.noVolumeCap);
  situationScore = +clamp(situationScore, 0, 100).toFixed(0);

  const grossCRV = (tp2 - entry) / risk;
  const costPct = 0.18;                                   // Broker + Spread, konservativ
  const netCRV = +Math.max(0, grossCRV - (costPct / 100 * entry / risk)).toFixed(1);

  const eurPerUsd = usdPerEur ? 1 / usdPerEur : null;      // usdPerEur = EUR/USD-Kurs
  const e = (x) => (eurPerUsd ? x * eurPerUsd : null);

  // Datenqualitäts-Gate: fehlendes Volumen darf durch Renormierung niemals ein
  // vermeintlich starkes Aktien-Setup erzeugen. Ohne belastbares Volumen bleibt
  // die Qualitätsanzeige maximal im Beobachtungsbereich und BUY ist gesperrt.
  const score = +(volumeKnown ? q : Math.min(q, 6.4)).toFixed(1);
  const executability = relVolScore == null ? null : +clamp(4 + relVolScore * 1.2 + Math.min(2, Math.abs(ret15))).toFixed(1);
  const light = volumeKnown && score >= 8 && netCRV >= minCrv ? 'green' : score >= 6.5 ? 'yellow' : 'red';
  const verdict = light === 'green' ? 'Kauf-Setup' : light === 'yellow' ? 'Beobachten' : 'Kein Trade';
  const setup = ema9 > ema21 && ret15 > 0 ? 'Trend / Momentum'
    : last.c > ema21 ? 'Pullback über EMA21'
    : volumeKnown && last.c >= vwap ? 'Über VWAP, aber ohne Trend' : volumeKnown ? 'Unter EMA21 – Schwäche' : 'VWAP n. v. – Volumenbasis fehlt';
  const trend = ema9 > ema21 ? 'aufwärts' : ema9 < ema21 ? 'abwärts' : 'seitwärts';

  // ---- v3.5.0 CLAUDE-MODUS (additiv, verändert Legacy-Werte NICHT) ----------
  // Befund: Der Legacy-50/50-Plan hat brutto maximal 0,5*1,7R + 0,5*3,35R =
  // 2,525R; das Client-Gate verlangt Plan-CRV >= 3:1 netto -> BUY war
  // strukturell unerreichbar. Ebenso: score>=8 bei theoretischem Maximum 8,74.
  // Der Claude-Modus bewertet stattdessen (a) Struktur-Ziele statt konstantem
  // 3,35R-Vielfachen, (b) mathematisch erreichbare Netto-CRV-Gates und
  // (c) einen expliziten Erwartungswert in R. Alle Fail-Closed-Datenregeln
  // (volumeKnown, Freshness, keine Aufwertung durch fehlende Daten) gelten weiter.
  const claude = (() => {
    const cCost = (costPct / 100) * entry;                 // Reibung je Einheit
    const structUp = swingTarget - entry;                  // Elliott/Fib-Strukturziel
    const cTp2 = structUp >= 2.0 * risk
      ? Math.min(swingTarget, entry + 6 * risk)            // Struktur, gedeckelt bei 6R
      : entry + 2.5 * risk;                                // sonst konservatives R-Ziel
    const cTp2Pct = (cTp2 / entry - 1) * 100;
    const cNetCRV = +(((cTp2 - entry) - cCost) / (risk + cCost)).toFixed(2);
    const cPlanR = 0.5 * ((tp1 - entry) / risk) + 0.5 * ((cTp2 - entry) / risk);
    const situ10 = situationScore / 10;
    const cScore = +clamp(weighted([
      ['ema21', trendScore, 0.20],
      ['mtf', momoScore, 0.20],
      ['volume', volScore, 0.16],
      ['vwap', vwapScore, 0.12],
      [null, situ10, 0.20],                                // Situation Engine zaehlt hier
      [null, liquidityVacuum / 10, 0.12],                  // Overhead-freie Preiszone
    ], on) - (overextended ? 1.2 : 0)).toFixed(1);
    // Erwartungswert als Drei-Ausgaenge-Modell (Management: nach TP1 Stop -> Breakeven):
    //   (1) Stop vor TP1: -1R mit (1-p1)
    //   (2) TP1 erreicht, Rest auf Breakeven ausgestoppt: +0.5*R1 mit p1*(1-p2)
    //   (3) TP1 und TP2: +0.5*R1 + 0.5*R2 mit p1*p2
    // Kosten einmal je Einheit Risiko, Aufschlag 1,2x fuer Teil-Exits.
    // Heuristische Startwerte; ueber D1-Outcomes kalibrierbar.
    const p1 = Math.max(0.38, Math.min(0.62, 0.40 + (cScore - 5) * 0.04 + situ10 * 0.012));
    const p2 = Math.max(0.35, Math.min(0.55, 0.42 + (cScore - 6) * 0.02));
    const R1 = (tp1 - entry) / risk, R2 = (cTp2 - entry) / risk;
    const costR = (cCost / risk) * 1.2;
    const cHit = p1; // ausgewiesene Trefferannahme = P(TP1)
    const cExpectancyR = +((p1 * 0.5 * R1 + p1 * p2 * 0.5 * R2 - (1 - p1) * 1 - costR)).toFixed(2);
    const frictionOk = cTp2Pct >= Math.max(0.6, costPct * 3); // Weg muss 3x Kosten decken
    const cBlockers = [];
    if (!volumeKnown) cBlockers.push('Volumenbasis fehlt (fail-closed)');
    if (relVol == null) cBlockers.push('RVOL nicht messbar');
    else if (relVol < 1.3) cBlockers.push(`RVOL ${relVol.toFixed(1)}x < 1,3x`);
    if (cScore < 7) cBlockers.push(`Claude-Score ${cScore} < 7`);
    if (cNetCRV < 1.8) cBlockers.push(`Netto-CRV ${cNetCRV}:1 < 1,8:1`);
    if (!frictionOk) cBlockers.push(`Kursweg ${cTp2Pct.toFixed(2)} % deckt 3x Kosten nicht`);
    if (situationType === 'WATCH') cBlockers.push('kein aktives Situationsmuster');
    if (overextended) cBlockers.push('>3 ATR ueber EMA21 ueberdehnt');
    if (cExpectancyR < 0.15) cBlockers.push(`Erwartungswert ${cExpectancyR}R < +0,15R`);
    const cGreen = volumeKnown && relVol != null && relVol >= 1.3 && cScore >= 7
      && cNetCRV >= 1.8 && frictionOk && situationType !== 'WATCH' && !overextended
      && cExpectancyR >= 0.15;
    const cYellow = !cGreen && volumeKnown && cScore >= 5.8 && cNetCRV >= 1.2;
    return {
      light: cGreen ? 'green' : cYellow ? 'yellow' : 'red',
      score: cScore, netCRV: cNetCRV,
      tp2Usd: cTp2, tp2Eur: e(cTp2), tp2Pct: +cTp2Pct.toFixed(2),
      tp2Source: structUp >= 2.0 * risk ? 'Struktur (Elliott/Fib 1,618)' : '2,5 R',
      planR: +cPlanR.toFixed(2), hitPct: Math.round(cHit * 100),
      expectancyR: cExpectancyR,
      verdict: cGreen ? 'Kauf-Setup · Claude' : cYellow ? 'Beobachten · Claude' : 'Kein Trade · Claude',
      blockers: cBlockers.slice(0, 5),
    };
  })();

  // ---- v3.5.3 FUSIONPULSE ADAPTIV (eigener Modus; Claude-Block oben LOCKED) --
  // Lehre aus dem v3.5.0 Audit: Ein Gate muss gegen SEINE eigene Auszahlungslogik
  // mathematisch erreichbar sein. Der FusionPulse-Modus trennt deshalb:
  //   1) Struktur-CRV bis zu einem am Markt gemessenen Ziel (BUY-Haupt-CRV),
  //   2) 50/50-Plan-Effizienz nach realen Fixkosten (Client),
  //   3) wirtschaftliche Relevanz relativ zur tatsaechlichen Positionsgroesse.
  // Es wird KEIN Ziel erfunden, nur damit das CRV passt. Fehlt Strukturraum, bleibt
  // das Setup gelb/rot. Der Claude-Modus wird dadurch weder berechnet noch veraendert.
  const fusion = (() => {
    const rangeWidth = priorHigh>priorLow ? priorHigh-priorLow : 0;

    // Explizite Elliott/Fibonacci-Struktur fuer Aktien. Bis v3.5.1 las
    // deepRecheckRank() zwar r.elliott, analyseStock() lieferte dieses Feld aber
    // ueberhaupt nicht -> der behauptete Elliott-Anteil in der Recheck-Prioritaet war 0.
    const ellWindow=bars.slice(-36);
    const ellEarly=ellWindow.slice(0,Math.max(6,Math.floor(ellWindow.length*0.45)));
    const ellLate=ellWindow.slice(Math.max(0,ellWindow.length-12));
    const ellLow=ellEarly.length?Math.min(...ellEarly.map(b=>b.l)):last.l;
    const ellHigh=ellWindow.length?Math.max(...ellWindow.map(b=>b.h)):last.h;
    const ellPullLow=ellLate.length?Math.min(...ellLate.map(b=>b.l)):last.l;
    const ellImpulse=Math.max(0,ellHigh-ellLow);
    const ellRetr=ellImpulse>0?(ellHigh-ellPullLow)/ellImpulse:null;
    const ellFibDist=ellRetr==null?1:Math.min(Math.abs(ellRetr-.382),Math.abs(ellRetr-.5),Math.abs(ellRetr-.618));
    const ellHigherLow=ellPullLow>=ellLow+ellImpulse*0.18;
    const ellTrend=ema9>ema21&&last.c>ema21;
    const ellImpulseAtr=atr>0?ellImpulse/atr:0;
    const stockElliott=clamp(5 + (ellTrend?1.25:-0.9) + (ellHigherLow?1.1:-0.7)
      + Math.min(1.25,ellImpulseAtr*.16) + Math.max(0,1.4-ellFibDist*5.5) - (overextended?1.25:0));

    // v3.5.3: Zielreferenz bewusst vom kurzen 12-Bar-Situationstrigger entkoppelt.
    // Ein echter Breakout liegt definitionsgemaess oft bereits UEBER priorHigh; priorHigh>entry
    // war deshalb eine systematische UND-Falle. Fuer die Zielprojektion nutzen wir ein
    // unabhaengiges 36-Bar-Swing-Fenster (wie Elliott) und blenden die letzten 4 Bars aus,
    // damit der laufende Ausbruch seine eigene Referenz nicht nach oben verschiebt.
    const targetRefWindow=bars.slice(-40,-4).slice(-36);
    const targetHigh=targetRefWindow.length?Math.max(...targetRefWindow.map(b=>b.h).filter(Number.isFinite)):priorHigh;
    const targetLow=targetRefWindow.length?Math.min(...targetRefWindow.map(b=>b.l).filter(Number.isFinite)):priorLow;
    const targetBaseHigh=Math.max(Number.isFinite(targetHigh)?targetHigh:-Infinity,Number.isFinite(priorHigh)?priorHigh:-Infinity);
    const targetRange=targetBaseHigh>targetLow?targetBaseHigh-targetLow:rangeWidth;
    const broadLow=ellWindow.length?Math.min(...ellWindow.slice(0,Math.max(8,ellWindow.length-8)).map(b=>b.l)):targetLow;
    const impulseRange=targetBaseHigh>broadLow?targetBaseHigh-broadLow:targetRange;
    const projectionBase=Math.max(targetRange,impulseRange,risk);
    let rawTarget=null;
    if(squeezeRelease||brokePriorHigh){
      const ext=stockElliott>=7.0?1.0:stockElliott>=6.2?0.786:0.618;
      rawTarget=targetBaseHigh + ext*projectionBase;
      // Falls der Breakout die erste Projektion bereits erreicht hat, auf die naechste
      // Fibonacci-Erweiterung wechseln statt faelschlich 'kein Zielraum' zu melden.
      if(!(rawTarget>entry)) rawTarget=targetBaseHigh + 1.618*projectionBase;
    } else if(nearBreakout){
      rawTarget=targetBaseHigh + 0.50*projectionBase;
      if(!(rawTarget>entry)) rawTarget=targetBaseHigh + 1.0*projectionBase;
    } else {
      // Reclaim/Pullback: naechstes reales Swing-Hoch ist primaer; wenn es bereits
      // ueberlaufen wurde, keine erfundene BUY-Freigabe, sondern nur konservative Projektion.
      rawTarget=targetBaseHigh>entry?targetBaseHigh:null;
    }
    const fTp2 = rawTarget>entry ? Math.min(rawTarget, entry + 8 * risk) : entry;
    const fTp2Pct = fTp2>entry ? (fTp2/entry-1)*100 : 0;
    const fCost = (costPct/100)*entry;
    const fNetCRV = fTp2>entry ? Math.max(0,((fTp2-entry)-fCost)/(risk+fCost)) : 0;

    const sit10=situationScore/10;
    const rv10=relVolScore==null?null:clamp(5+(relVolScore-1)*2.7);
    const trigger10=squeezeRelease?9.2:brokePriorHigh?8.7:nearBreakout?7.4:(reclaimVwap||reclaimEma21)?7.1:pullbackHold?6.8:5.0;
    const fScore=+clamp(weighted([
      [null,trendScore,0.16],
      [null,momoScore,0.16],
      ['volume',volScore,0.13],
      ['vwap',vwapScore,0.09],
      [null,sit10,0.18],
      [null,liquidityVacuum/10,0.08],
      [null,trigger10,0.08],
      ['elliott',stockElliott,0.12],
    ],on) - (overextended?1.35:0)).toFixed(1);
    const activeSituation=situationType!=='WATCH' && situationScore>=38;
    const structureOk=fTp2>tp1 && fNetCRV>=minCrv;
    const rvOk=relVolScore!=null&&relVolScore>=1.2;
    const fBlockers=[];
    if(!volumeKnown)fBlockers.push('Volumenbasis fehlt (fail-closed)');
    if(relVolScore==null)fBlockers.push('RVOL nicht messbar');
    else if(!rvOk)fBlockers.push(`RVOL ${relVolScore.toFixed(1)}x < 1,2x`);
    if(!activeSituation)fBlockers.push('Situation noch nicht aktiv/reif');
    if(stockElliott<5.8)fBlockers.push(`Elliott-Struktur ${stockElliott.toFixed(1)} < 5,8`);
    if(fScore<7.2)fBlockers.push(`Fusion-Score ${fScore} < 7,2`);
    if(!rawTarget)fBlockers.push('kein belastbarer Struktur-Zielraum');
    else if(fNetCRV<minCrv)fBlockers.push(`Struktur-CRV ${fNetCRV.toFixed(2)}:1 < ${Number(minCrv).toFixed(1)}:1`);
    if(overextended)fBlockers.push('>3 ATR ueber EMA21 - nicht hinterherlaufen');
    const fGreen=volumeKnown&&rvOk&&activeSituation&&stockElliott>=5.8&&fScore>=7.2&&structureOk&&!overextended;
    const fYellow=!fGreen&&volumeKnown&&fScore>=5.8&&(activeSituation||nearBreakout||reclaimVwap||reclaimEma21);
    return {
      light:fGreen?'green':fYellow?'yellow':'red', score:fScore, netCRV:+fNetCRV.toFixed(2),
      tp2Usd:fTp2, tp2Eur:e(fTp2), tp2Pct:+fTp2Pct.toFixed(2),
      tp2Source:rawTarget?'36-Bar-Swingstruktur / Range-Projektion':'kein Strukturziel',
      verdict:fGreen?'Kauf-Setup · FusionPulse':fYellow?'Beobachten · FusionPulse':'Kein Trade · FusionPulse',
      blockers:fBlockers.slice(0,6), elliott:+stockElliott.toFixed(1),
      targetR:+((fTp2-entry)/risk).toFixed(2), activeSituation,
    };
  })();

  // ---- v3.9.0 MODUS A · MOMENTUM (additiv; claude UND fusion bleiben unberuehrt) --
  // Warum ein eigener Block statt Schalter in fusion/claude:
  //   - Der Claude-Block ist SHA-verriegelt und darf sich nicht aendern.
  //   - Der fusion-Block gehoert dem parallelen ChatGPT-Strang. Ein modusabhaengiger
  //     Zweig darin haette dessen Verhalten aendern koennen (Invariante 9).
  // Dieser Block wird IMMER berechnet, aber nur angezeigt/verwendet, wenn der Nutzer
  // Modus A aktiv einschaltet. Er veraendert keinen anderen Score.
  //
  // Der inhaltliche Unterschied zu beiden bestehenden Modi:
  //  1. KEIN overextended-Malus. Der Abstand zur EMA21 ist hier die Eintrittskarte,
  //     kein Warnsignal. Der Malus bestrafte bisher genau die gesuchten Titel.
  //  2. Elliott-Gewicht = 0. Bei einem Gap ohne Wellenhistorie misst die Kennzahl
  //     Rauschen. Lieber weglassen als so tun, als sei sie aussagekraeftig.
  //  3. Eigenes Zielprofil: Stop unter dem Konsolidierungstief NACH dem Impuls,
  //     Ziel als Vielfaches der bisherigen Tagesspanne statt als R-Vielfaches.
  //     Damit faellt auch der 8R-Deckel weg, der den VEEV-Fall unmoeglich machte.
  //  4. Live-Quote-Pflicht: bei zweistelliger Tagesbewegung ist ein fuenf Minuten
  //     alter Kurs kein Schoenheitsfehler. Fehlt der frische Kurs, gibt es keinen Plan.
  const momentum = (() => {
    // --- Konsolidierung nach dem Impuls: das Tief der letzten 6 Bars, sofern sie
    //     tatsaechlich eine Beruhigung gegenueber dem Impuls davor darstellen.
    const consWindow = bars.slice(-6);
    const impulseWindow = bars.slice(-18, -6);
    const consLow = consWindow.length ? Math.min(...consWindow.map(b => b.l).filter(Number.isFinite)) : null;
    const consHigh = consWindow.length ? Math.max(...consWindow.map(b => b.h).filter(Number.isFinite)) : null;
    const impulseLow = impulseWindow.length ? Math.min(...impulseWindow.map(b => b.l).filter(Number.isFinite)) : null;
    const impulseHigh = impulseWindow.length ? Math.max(...impulseWindow.map(b => b.h).filter(Number.isFinite)) : null;
    const impulseUp = (impulseHigh != null && impulseLow != null) ? impulseHigh - impulseLow : null;
    const consRange = (consHigh != null && consLow != null) ? consHigh - consLow : null;
    // Echte Konsolidierung: die juengste Spanne ist deutlich enger als der Impuls
    // davor UND das Tief liegt nicht unter dem halben Impuls (sonst ist es ein Abverkauf).
    const consolidating = impulseUp > 0 && consRange != null
      && consRange <= impulseUp * 0.62
      && consLow >= impulseLow + impulseUp * 0.38;

    // --- Stop: unter das Konsolidierungstief, mit ATR-Puffer gegen Zufallsausloesung.
    //     Fail-closed: ohne brauchbares Konsolidierungstief kein Stop und kein Plan.
    const mStop = (consolidating && consLow > 0) ? consLow - 0.25 * atr : null;
    const mEntry = last.c;
    const mRisk = (mStop != null && mEntry > mStop) ? mEntry - mStop : null;
    const mStopPct = mRisk != null ? (mRisk / mEntry) * 100 : null;

    // --- Ziel als Vielfaches der Eroeffnungs-/Tagesspanne statt als R-Vielfaches.
    //     Ein Titel, der heute 8 % gelaufen ist, laeuft erfahrungsgemaess eher
    //     weitere Bruchteile DIESER Spanne als ein starres Vielfaches eines
    //     zufaellig engen Stops. Kein Deckel bei 8R: der Deckel stammt aus dem
    //     Risikomodell und hat hier keine Entsprechung.
    const dayWindow = bars.slice(-78); // rund ein US-Handelstag in 5-Min-Bars
    const dayLow = dayWindow.length ? Math.min(...dayWindow.map(b => b.l).filter(Number.isFinite)) : null;
    const dayHigh = dayWindow.length ? Math.max(...dayWindow.map(b => b.h).filter(Number.isFinite)) : null;
    const dayRange = (dayHigh != null && dayLow != null && dayHigh > dayLow) ? dayHigh - dayLow : null;
    const mTp1 = (dayRange && consHigh != null) ? Math.max(consHigh, mEntry) + 0.5 * dayRange : null;
    const mTp2 = (dayRange && consHigh != null) ? Math.max(consHigh, mEntry) + 1.0 * dayRange : null;
    const mTp2Pct = (mTp2 != null && mEntry > 0) ? (mTp2 / mEntry - 1) * 100 : null;
    const mRewardRisk = (mRisk > 0 && mTp2 != null) ? (mTp2 - mEntry) / mRisk : null;

    // --- Score OHNE Elliott und OHNE overextended-Malus.
    //     Die 12 % Elliott-Gewicht werden NICHT umverteilt: eine Umverteilung
    //     wuerde den Score ohne neue Information anheben (Invariante 1/3).
    //     weighted() normiert ueber die tatsaechlich gesetzten Gewichte; die
    //     fehlende Komponente wird damit sauber ausgelassen statt geschaetzt.
    const mSit10 = situationScore / 10;
    const mTrigger10 = squeezeRelease ? 9.2 : brokePriorHigh ? 8.7 : nearBreakout ? 7.4 : (reclaimVwap || reclaimEma21) ? 7.1 : pullbackHold ? 6.8 : 5.0;
    const mScore = +clamp(weighted([
      [null, trendScore, 0.16],
      [null, momoScore, 0.20],          // Momentum zaehlt hier mehr als im Positionsmodus
      ['volume', volScore, 0.16],
      ['vwap', vwapScore, 0.10],
      [null, mSit10, 0.20],
      [null, mTrigger10, 0.12],
      [null, liquidityVacuum / 10, 0.06],
    ], on)).toFixed(1);

    // --- Live-Quote-Pflicht. `last.dt` ist der Zeitstempel des juengsten Bars.
    //     Aelter als MOM_MAX_QUOTE_AGE_SEC -> kein Plan, ausgewiesen als nicht bewertbar.
    const barMs = Date.parse(last?.dt || '');
    const quoteAgeSec = Number.isFinite(barMs) ? Math.max(0, Math.round((Date.now() - barMs) / 1000)) : null;
    const quoteFresh = quoteAgeSec != null && quoteAgeSec <= MOM_MAX_QUOTE_AGE_SEC;

    const mBlockers = [];
    if (!volumeKnown) mBlockers.push('Volumenbasis fehlt (fail-closed)');
    if (relVolScore == null) mBlockers.push('RVOL nicht messbar');
    else if (relVolScore < 1.5) mBlockers.push(`RVOL ${relVolScore.toFixed(1)}x < 1,5x`);
    if (!consolidating) mBlockers.push('keine Konsolidierung nach dem Impuls - kein definierbarer Stop');
    if (mRisk == null) mBlockers.push('Stop nicht bestimmbar (fail-closed)');
    if (!dayRange) mBlockers.push('Tagesspanne nicht messbar');
    if (quoteAgeSec == null) mBlockers.push('Kursalter unbekannt (fail-closed)');
    else if (!quoteFresh) mBlockers.push(`Kurs ${Math.round(quoteAgeSec / 60)} Min alt - Modus A verlangt Live-Kurs`);
    if (mRewardRisk != null && mRewardRisk < 2.0) mBlockers.push(`Ziel nur ${mRewardRisk.toFixed(1)}x Stopweite < 2,0x`);
    if (mScore < 6.8) mBlockers.push(`Momentum-Score ${mScore} < 6,8`);
    if (situationType === 'WATCH') mBlockers.push('kein aktives Situationsmuster');

    const mGreen = volumeKnown && relVolScore != null && relVolScore >= 1.5
      && consolidating && mRisk != null && !!dayRange && quoteFresh
      && mRewardRisk != null && mRewardRisk >= 2.0
      && mScore >= 6.8 && situationType !== 'WATCH';
    const mYellow = !mGreen && volumeKnown && mScore >= 5.5 && (consolidating || brokePriorHigh || squeezeRelease);
    return {
      light: mGreen ? 'green' : mYellow ? 'yellow' : 'red',
      score: mScore,
      entryUsd: mEntry, stopUsd: mStop, tp1Usd: mTp1, tp2Usd: mTp2,
      entryEur: e(mEntry), stopEur: mStop == null ? null : e(mStop),
      tp1Eur: mTp1 == null ? null : e(mTp1), tp2Eur: mTp2 == null ? null : e(mTp2),
      tp2Pct: mTp2Pct == null ? null : +mTp2Pct.toFixed(2),
      stopPct: mStopPct == null ? null : +mStopPct.toFixed(2),
      rewardRisk: mRewardRisk == null ? null : +mRewardRisk.toFixed(2),
      tp2Source: dayRange ? 'Tagesspanne x 1,0 ueber Konsolidierungshoch' : 'kein Zielraum',
      consolidating, dayRangePct: dayRange ? +((dayRange / mEntry) * 100).toFixed(2) : null,
      quoteAgeSec, quoteFresh,
      elliottUsed: false, overextendedApplied: false,
      verdict: mGreen ? 'Kauf-Setup · Momentum' : mYellow ? 'Beobachten · Momentum' : 'Kein Trade · Momentum',
      blockers: mBlockers.slice(0, 6),
    };
  })();

  return {
    claude, fusion, momentum,
    // v3.5.3: Legacy bleibt fuer Audit/Vergleich erhalten; die normale FusionPulse-Ansicht
    // nutzt ab jetzt die mathematisch konsistente adaptive Bewertung. Claude bleibt parallel.
    legacy:{light,score,netCRV,tp2Usd:tp2,tp2Eur:e(tp2),tp2Pct:+tp2Pct.toFixed(2),verdict,blockers:[]},
    symbol, sector, name: src?.meta?.name || STOCK_NAMES[symbol] || symbol,
    exchange: src?.meta?.exchange || 'US', currency: src?.meta?.currency || 'USD',
    score:fusion.score, executability, light:fusion.light, verdict:fusion.verdict, setup, trend,
    priceUsd: last.c, priceEur: e(last.c),
    entryUsd: entry, entryEur: e(entry),
    stopUsd: stop, stopEur: e(stop),
    tp1Usd: tp1, tp1Eur: e(tp1),
    tp2Usd:fusion.tp2Usd, tp2Eur:fusion.tp2Eur, tp2Pct:fusion.tp2Pct, tp2Source:fusion.tp2Source,
    swingTargetUsd: swingTarget, swingTargetEur: e(swingTarget), structurePct: +structurePct.toFixed(2),
    zoneLowUsd: entry - 0.25 * atr, zoneHighUsd: entry + 0.25 * atr,
    zoneLowEur: e(entry - 0.25 * atr), zoneHighEur: e(entry + 0.25 * atr),
    netCRV:fusion.netCRV, elliott:fusion.elliott, atrPct: +((atr / last.c) * 100).toFixed(2),
    ret5: +ret5.toFixed(2), ret15: +ret15.toFixed(2), ret60: +ret60.toFixed(2),
    relVol: relVol == null ? null : +relVol.toFixed(2), volumeKnown, vwapUsd: vwap, aboveVwap: volumeKnown ? last.c >= vwap : null,
    liquidityVacuum: +liquidityVacuum.toFixed(0),
    // Situation-/Erklaerungsfelder: Discovery bleibt 0 % direktes BUY-Gewicht; FusionPulse Adaptiv nutzt nur die Deep-Situation als Analysekomponente.
    situationType, situationScore, situationReasons:situationReasons.slice(0,4),
    /* v3.27.0: die EINZELBEITRAEGE, gerundet. Ohne sie laesst sich nie
       feststellen, welcher Term den Score getragen hat und welcher ihn nur
       verwaessert. Vier Zeichen je Term im Snapshot — die Alternative ist,
       die Frage nie beantworten zu koennen. */
    situParts: Object.fromEntries(Object.entries(situ).map(([k, v]) => [k, +Number(v).toFixed(1)])),
    triggerUsd: priorHigh, triggerEur:e(priorHigh), triggerDistancePct:triggerDistancePct==null?null:+triggerDistancePct.toFixed(2),
    breakout60m:brokePriorHigh, nearBreakout, reclaimVwap, reclaimEma21, pullbackHold, squeezeRelease,
    accel5v15:+accel5v15.toFixed(2), rangeExpansion:rangeExpansion==null?null:+rangeExpansion.toFixed(2), overextended,
    updated: last.dt, feed: 'Twelve Data US', tradegate: false, marketPhase: usMarketPhase().key,
    fxUsdPerEur: usdPerEur || null, fxKnown: !!usdPerEur,
    // v3.1.0: Intraday-Verlauf aus den ohnehin geladenen 5-Minuten-Bars; keine Zusatz-API-Kosten.
    intraday: (() => {
      const xs = bars.slice(-60).map(b => b.c).filter(Number.isFinite);
      if (!xs.length) return [];
      const lo=Math.min(...xs), hi=Math.max(...xs);
      return xs.map(c => Math.round(hi>lo ? ((c-lo)/(hi-lo))*100 : 50));
    })(),
    components: [...on],
  };
}

async function twelveJSON(path, params, key, creditsSpent = 1, env = null) {
  const u = new URL('https://api.twelvedata.com/' + path);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
  u.searchParams.set('apikey', key);
  const r = await fetch(u,{signal:AbortSignal.timeout(20_000)});
  await noteQuota(env, r, creditsSpent);
  const j = await r.json();
  if (!r.ok || j?.status === 'error') {
    const err = new Error(j?.message || `Twelve Data ${r.status}`);
    err.code = j?.code || r.status;
    throw err;
  }
  return j;
}

async function getFx(key, env = null) {
  if (fxMemo.usdPerEur && Date.now() - fxMemo.ts < 30 * 60_000) return fxMemo.usdPerEur;
  try {
    const j = await twelveJSON('price', { symbol: 'EUR/USD' }, key, 1, env);
    const x = +j.price;
    if (x > 0) { fxMemo = { ts: Date.now(), usdPerEur: x }; return x; }
  } catch { /* FX optional: ohne Kurs zeigt die UI nur USD */ }
  return fxMemo.usdPerEur;
}

async function resolveStockQueryLive(env, raw) {
  const local = resolveStockQuery(raw);
  const q = String(raw || '').trim();
  // Lokale Treffer sind kostenlos und eindeutig. Für unbekannte Namen/Symbole
  // dient Twelve Data /symbol_search als vollständiger Discovery-Fallback.
  if (local && STOCK_SEARCH_BY_SYMBOL.has(local.symbol)) return local;
  if (!q || !env.TWELVE_API_KEY) return local;
  try {
    const j = await twelveJSON('symbol_search', { symbol: q, outputsize: '12', show_plan: 'true' }, env.TWELVE_API_KEY, 1, env);
    const data = Array.isArray(j?.data) ? j.data : [];
    const us = data.filter(x => {
      const country = String(x.country || '').toUpperCase();
      const currency = String(x.currency || '').toUpperCase();
      const type = String(x.instrument_type || '').toUpperCase();
      return (country === 'UNITED STATES' || country === 'US' || currency === 'USD') && (!type || /STOCK|COMMON|EQUITY|ADR/.test(type));
    });
    const hit = us[0] || data[0];
    if (hit?.symbol) return {
      sector: local?.sector || 'Watchlist',
      symbol: String(hit.symbol).toUpperCase(),
      name: hit.instrument_name || local?.name || String(hit.symbol).toUpperCase(),
      exchange: hit.exchange || null,
    };
  } catch (e) {
    // Bei einem Discovery-Fehler bleibt ein syntaktisch gültiger Ticker nutzbar.
    if (local) return local;
    throw e;
  }
  return local;
}

async function stockLookup(env, raw, comp, minCrv = 3) {
  if (!env.TWELVE_API_KEY) return { configured: false, state: 'nokey', error: 'TWELVE_API_KEY fehlt', quota: quotaView(), version: APP_VERSION };
  const info = await resolveStockQueryLive(env, raw);
  if (!info) return { configured: true, state: 'ok', notFound: true, error: 'Kein eindeutiger US-Aktientreffer gefunden. Bitte Firmenname oder Ticker versuchen.', quota: quotaView(), version: APP_VERSION };
  const cached = stockLookupMemo.get(info.symbol);
  if (cached && Date.now() - cached.ts < 5 * 60_000) return { configured: true, state: 'ok', cached: true, lookup: true, row: cached.row, quota: quotaView(), version: APP_VERSION };
  const fx = await getFx(env.TWELVE_API_KEY, env);
  let j;
  let extendedHours = true;
  try {
    j = await twelveJSON('time_series', { symbol: info.symbol, interval: '5min', outputsize: '40', prepost: 'true', format: 'JSON', timezone: 'UTC' }, env.TWELVE_API_KEY, 1, env);
  } catch (e) {
    // Twelve Data stellt aktuelle Extended-Hours je nach Tarif bereit. Ein
    // Treffer darf deshalb nicht komplett scheitern, nur weil prepost=true im
    // vorhandenen Plan nicht freigeschaltet ist.
    const m = String(e?.message || e || '');
    if (!/pre.?post|extended|plan|subscription|access|permission/i.test(m)) throw e;
    extendedHours = false;
    j = await twelveJSON('time_series', { symbol: info.symbol, interval: '5min', outputsize: '40', format: 'JSON', timezone: 'UTC' }, env.TWELVE_API_KEY, 1, env);
  }
  const row = analyseStock(info.symbol, info.sector, j, fx, comp, minCrv);
  if (!row) return { configured: true, state: 'ok', notFound: true, error: 'Titel gefunden, aber noch nicht genügend 5-Minuten-Daten für die Analyse.', quota: quotaView(), version: APP_VERSION };
  if ((!row.name || row.name === row.symbol) && info.name) row.name = info.name;
  row.extendedHours = extendedHours;
  row.sectorLeaderRet15 = null; row.sectorLag = null;
  if (stockLookupMemo.size > 200) stockLookupMemo.clear();
  stockLookupMemo.set(info.symbol, { ts: Date.now(), row });
  const old = new Map(stockMemo.rows.map((r) => [r.symbol, r])); old.set(row.symbol, row); stockMemo.rows = [...old.values()].sort((a,b) => b.score-a.score);
  setApiState('stocks', 'ok');
  return { configured: true, state: 'ok', cached: false, lookup: true, row, quota: quotaView(), version: APP_VERSION };
}

async function stockSnapshot(env, force = false, comp, minCrv = 3, favoriteSymbols = []) {
  if (!env.TWELVE_API_KEY) {
    setApiState('stocks', 'nokey', 'TWELVE_API_KEY fehlt');
    return { configured: false, state: 'nokey', rows: [], universe: STOCK_UNIVERSE.length,
             note: 'TWELVE_API_KEY fehlt', quota: quotaView(), version: APP_VERSION };
  }
  // v3.0.8: vier Teilgruppen (6/5/5/5). Der automatische Radar-Scan lässt
  // bewusst mindestens zwei Twelve-Data-Credits pro Minute als Reserve für
  // FX/Health bzw. eine manuelle Suche. Während eines Cold Starts fordert die
  // UI die Gruppen minutenweise nacheinander an; danach bleibt der konservative
  // 5-Minuten-Poll bestehen.
  const minuteSlot = Math.floor(Date.now() / 60_000);
  const favs=[...new Set((favoriteSymbols||[]).map(x=>String(x).trim().toUpperCase()).filter(x=>/^[A-Z0-9.\-]{1,8}$/.test(x)))].slice(0,30);
  const cycle = minuteSlot; // Cache-Slot: exakt ein automatischer Aktienbatch pro Minute
  const sig = [...(comp instanceof Set ? comp : new Set(ALL_ON))].sort().join('.') + '|' + minCrv + '|fav:' + favs.join('.');
  if (!force && stockMemo.rows.length && stockMemo.cycle === cycle && stockMemo.sig === sig && Date.now() - stockMemo.ts < 55_000) {
    return { configured: true, state: 'ok', cached: true,
             rows: stockMemo.rows, ts: stockMemo.ts, cycle, universe: STOCK_UNIVERSE.length,
             scanned: stockMemo.rows.length, updatedThisCycle: 0, refreshedSymbols: [], favoritePriority: favs.length, quota: quotaView(), version: APP_VERSION,
             market: usMarketPhase(new Date(), null), note: 'US-Marktdaten; EUR ist eine gekennzeichnete Umrechnung, kein Tradegate-Kurs' };
  }

  if (!force && !stockMemo.rows.length) {
    const persisted=await readPersistedStockScan(env,sig,cycle);
    if(persisted){
      stockMemo={ts:persisted.ts,rows:persisted.rows,cycle,sig};
      setApiState('stocks','ok','Persistenter Aktienbatch geladen');
      return {configured:true,state:'ok',cached:true,persistent:true,rows:stockMemo.rows,ts:stockMemo.ts,cycle,
        universe:STOCK_UNIVERSE.length,scanned:stockMemo.rows.length,updatedThisCycle:0,refreshedSymbols:[],favoritePriority:favs.length,
        quota:quotaView(),version:APP_VERSION,market:usMarketPhase(new Date(),null),note:'US-Marktdaten; EUR ist eine gekennzeichnete Umrechnung, kein Tradegate-Kurs'};
    }
  }

  // v3.0.10: Depot/Favoriten haben Scan-Priorität. Maximal fünf Twelve-Data-
  // Credits pro Minute; dadurch bleiben Reserve-Credits für FX/Suche und 429
  // wird vermieden. Favoriten außerhalb des Standarduniversums sind erlaubt.
  const favPick=[];
  if(favs.length){
    const start=(minuteSlot*3)%favs.length;
    for(let i=0;i<Math.min(3,favs.length);i++) favPick.push(favs[(start+i)%favs.length]);
  }
  const basePick=[];
  const favSet=new Set(favPick);
  const baseStart=(minuteSlot*2)%STOCK_UNIVERSE.length;
  for(let i=0;i<STOCK_UNIVERSE.length && basePick.length<Math.max(0,5-favPick.length);i++){
    const x=STOCK_UNIVERSE[(baseStart+i)%STOCK_UNIVERSE.length];
    if(!favSet.has(x[1])) basePick.push(x);
  }
  const favRows=favPick.map(symbol=>{
    const info=STOCK_SEARCH_BY_SYMBOL.get(symbol);
    const core=STOCK_UNIVERSE.find(([,s])=>s===symbol);
    return core || [info?.sector||null,symbol,info?.name||symbol];
  });
  const batch=[...favRows,...basePick].slice(0,5);
  const syms = batch.map((x) => x[1]);
  const fx = await getFx(env.TWELVE_API_KEY, env);
  // v3.0.8 QUOTA-HOTFIX: Der automatische Teil-Batch verwendet bewusst keine
  // prepost-Abfrage. Auf Tarifen ohne Extended Hours kostete v3.0.7 zuerst 7
  // Credits fuer prepost=true und danach nochmals 7 Credits fuer den Fallback.
  // Premarket/Opening wird bereits separat und passend ueber Alpaca geliefert.
  // Einzel-Lookups duerfen weiterhin prepost testen (max. 1+1 Credit).
  const j = await twelveJSON('time_series', {
    symbol: syms.join(','), interval:'5min', outputsize:'40', format:'JSON', timezone:'UTC' }, env.TWELVE_API_KEY, syms.length, env);

  const fresh = [];
  for (const [sector, symbol] of batch) {
    const src = j[symbol] || (syms.length === 1 ? j : null);
    const r = analyseStock(symbol, sector, src, fx, comp, minCrv);
    if (r) fresh.push(r);
  }
  const old = new Map(stockMemo.rows.map((r) => [r.symbol, r]));
  for (const r of fresh) old.set(r.symbol, r);
  const rows = [...old.values()];
  // Sector-Leader/Lag: misst, ob der eigene Sektor bereits läuft, während der
  // Titel selbst noch hinterherhinkt. Positiv = potenzieller Nachzügler.
  applySectorLag(rows);   // v3.10.0: gemeinsame Berechnung, siehe applySectorLag
  rows.sort((a, b) => b.score - a.score);
  stockMemo = { ts: Date.now(), rows, cycle, sig };
  setApiState('stocks', 'ok');
  // Cross-Isolate-Warmcache: verhindert, dass Cron und mehrere PWA-Clients denselben
  // Twelve-Data-Batch innerhalb derselben Minute erneut verbrauchen.
  await persistStockScan(env,sig,cycle,rows,{fxUsdPerEur:fx||null,refreshedSymbols:fresh.map(r=>r.symbol)});

  return {
    configured: true, state: 'ok', cached: false, rows, ts: stockMemo.ts, cycle,
    universe: STOCK_UNIVERSE.length, scanned: rows.length, updatedThisCycle: fresh.length, refreshedSymbols: fresh.map(r=>r.symbol), favoritePriority: favs.length,
    fxUsdPerEur: fx || null, fxApprox: !!fx, quota: quotaView(), version: APP_VERSION,
    market: usMarketPhase(new Date(), null), note: 'US-Marktdaten; EUR ist eine gekennzeichnete Umrechnung, kein Tradegate-Kurs',
  };
}


/* ========================================================================
   Opening Momentum — Alpaca Market Data (v3.0.8)
   Free/Test: feed=iex. IEX ist eine einzelne US-Börse und handelt nur ca.
   08:00–17:00 ET; deshalb ist 04:00–08:00 ET im Free-Tarif NICHT vollständig
   live abdeckbar. Die UI kennzeichnet das ausdrücklich. Keine Orders.
   ======================================================================== */
/* ============================================================================
   v3.15.0 · SEKTOR-PRIORISIERUNG DER DEEP-SCAN-QUEUE (additiv, 0 % BUY-Gewicht)
   Wunsch: den Aktienmarkt bevorzugt nach Pharma/Healthcare, Edelmetalle/Minen
   und Technologie scannen.
   WARUM ES EINE KURATIERTE LISTE IST UND KEINE ABFRAGE: der Sektor steht bisher
   nur im statischen Katalog, und der hat 26 Eintraege. Alles, was aus dem
   Whole-Market-Radar ueber die ~37.000 Tiingo-Titel kommt, traegt
   `sector:'Discovery'`. Tiingo liefert Sektor/Industrie nur im
   kostenpflichtigen Fundamentals-Paket. Eine Liste ist damit die einzige
   ehrliche Option — und sie wird ausdruecklich als KURATIERT und
   UNVOLLSTAENDIG gekennzeichnet, statt Vollstaendigkeit zu behaupten.
   WAS SIE TUT: sie veraendert, WELCHE Titel tief analysiert werden.
   WAS SIE NICHT TUT: sie veraendert keinen Score, kein Gate, keine Ampel und
   keine Freigabe. Ein Titel aus einem Prioritaetssektor bekommt Aufmerksamkeit,
   keinen Bonus. Damit gilt dieselbe Regel wie fuer Radar und BOATS.
   KEINE VERDRAENGUNG: die Reserve ist gedeckelt, damit der allgemeine
   Whole-Market-Radar nicht ausgehungert wird. Faende die Priorisierung nur noch
   die eigenen drei Sektoren, waere der Radar wieder das, was er in v3.3.4
   ausdruecklich nicht mehr sein sollte — ein Katalog-Pool. */
const PRIORITY_SECTORS = [
  ['Pharma/Healthcare', new Set(['LLY','JNJ','MRK','PFE','ABBV','AMGN','GILD','BMY','VRTX','REGN','MRNA','BIIB','ZTS','ISRG','UNH','CVS','TMO','DHR','ABT','MDT','SYK','BSX','HCA','ELV','CI','BAX','EW','IDXX','IQV','RMD','DXCM','ALNY','INCY','NBIX','UTHR','EXEL','HALO','SRPT','ABSI','RXRX','CRSP','NTLA','BEAM','VEEV','MOH','ZBH','HOLX','PODD','CTLT','JAZZ','NVAX','SGEN','ARWR','APLS','KRTX','MDGL','CYTK','ITCI','RARE','FOLD','PTCT','BPMC','DNLI'])],
  /* v3.16.0 · Bereinigt. 'CS' war Credit Suisse — die ADS wurden am 12.6.2023
     von der NYSE genommen, ein toter Ticker auf einem Listenplatz. 'NGT' ist
     Newmonts Toronto-Listing und kommt im US-Feed nicht vor. Beide entfernt. */
  ['Edelmetalle/Minen', new Set(['NEM','GOLD','AEM','KGC','AU','WPM','FNV','RGLD','PAAS','AGI','BTG','HMY','EGO','SSRM','CDE','HL','EXK','FSM','MAG','GFI','SBSW','IAG','NGD','OR','SAND','DRD','SILV','MUX','GATO','SKE','ORLA','PLG','FCX','SCCO','TECK','RIO','BHP','VALE','AA','MP','ALB','UEC','CCJ','DNN','NXE','ERO','HBM','TFPM','EQX','ASM'])],
  ['Technologie',       new Set(['AAPL','MSFT','NVDA','AVGO','AMD','INTC','QCOM','TXN','MU','AMAT','LRCX','KLAC','ADI','MRVL','NXPI','ON','SWKS','MPWR','TER','ENTG','GOOGL','META','AMZN','CRM','ORCL','ADBE','NOW','INTU','PANW','CRWD','ZS','SNOW','DDOG','NET','MDB','TEAM','WDAY','SHOP','PLTR','SMCI','DELL','ANET','CSCO','IBM','ACN','UBER','ABNB','COIN','HOOD','PYPL','ARM','IONQ','RGTI','QBTS','AFRM','ZM','CEG','SDGR','MSTR','CRWV','APP','TSM','ASML','AMBA','ALAB','CRDO','LSCC','RMBS','SITM'])],
];
const PRIORITY_SECTOR_BY_SYMBOL = (() => {
  const m = new Map();
  for (const [name, set] of PRIORITY_SECTORS) for (const sym of set) if (!m.has(sym)) m.set(sym, name);
  return m;
})();
const norm1 = (x) => String(x || '').trim().toUpperCase().replace(/\./g, '-');
function prioritySectorOf(symbol){ return PRIORITY_SECTOR_BY_SYMBOL.get(norm1(symbol)) || null; }
/* Wie viele Plaetze pro Zyklus je Prioritaetssektor reserviert werden. Bewusst
   klein: drei Sektoren x 1 Platz gegen capRadar >= 8 laesst dem allgemeinen
   Radar die Mehrheit. Der Wert ist GERATEN und nicht gemessen — er gehoert auf
   dieselbe Liste offener Kalibrierungen wie MOM_MIN_DOLLARVOL. */
const SECTOR_RESERVE_PER_SECTOR = 1;
const OPENING_UNIVERSE = [...LARGE_CAP_RADAR_SYMBOLS];
let openingMemo={ts:0,data:null};
function alpacaFeed(env){
  return String(env.ALPACA_FEED || 'iex').toLowerCase() === 'sip' ? 'sip' : 'iex';
}
function alpacaFeedLabel(env){ return alpacaFeed(env) === 'sip' ? 'SIP (All US Exchanges)' : 'IEX (Free)'; }
async function alpacaJSON(path, params, env){
  const u=new URL('https://data.alpaca.markets'+path); for(const [k,v] of Object.entries(params||{})) if(v!=null)u.searchParams.set(k,v);
  const r=await fetch(u,{headers:{'APCA-API-KEY-ID':env.ALPACA_API_KEY_ID,'APCA-API-SECRET-KEY':env.ALPACA_API_SECRET_KEY,accept:'application/json'},signal:AbortSignal.timeout(20_000)});
  if(r.status===429) throw new Error('Alpaca Rate-Limit (429)');
  if(!r.ok) throw new Error(`Alpaca ${r.status}: ${(await r.text()).slice(0,180)}`);
  return r.json();
}
function barTimeET(ts){
  const p=nyParts(new Date(ts)); return Number(p.hour)*60+Number(p.minute);
}
function momentumFromAlpaca(symbol, snap, bars=[]){
  if(!snap)return null;
  // v3.4.1 P0: Die Preisquelle muss vor dem Return immer definiert sein.
  // Reihenfolge bleibt bewusst minute -> trade -> daily; daily ist nur Discovery-Fallback
  // und darf in der UI nicht wie ein frischer Extended-Hours-Quote aussehen.
  const priceSource = Number(snap.minuteBar?.c||0)>0 ? 'minute' : Number(snap.latestTrade?.p||0)>0 ? 'trade' : Number(snap.dailyBar?.c||0)>0 ? 'daily' : 'none';
  const prevClose=Number(snap.prevDailyBar?.c||0), latest=Number(snap.minuteBar?.c||snap.latestTrade?.p||snap.dailyBar?.c||0);
  if(!(latest>0&&prevClose>0))return null;
  const bs=(bars||[]).map(b=>({t:b.t,c:+b.c,h:+b.h,l:+b.l,v:+b.v||0})).filter(b=>b.c>0).sort((a,b)=>new Date(a.t)-new Date(b.t));
  const closeAgoBars=(n)=>bs.length>n?bs.at(-1-n).c:bs[0]?.c||latest;
  const ret5=(latest/closeAgoBars(1)-1)*100, ret15=(latest/closeAgoBars(3)-1)*100, ret60=(latest/closeAgoBars(Math.max(1,Math.min(12,bs.length-1)))-1)*100;
  const vols=bs.slice(-25).map(b=>b.v); const baseArr=vols.slice(0,-3).filter(v=>v>0); const base=baseArr.length>=8?mean(baseArr):null; const recent=mean(vols.slice(-3).filter(v=>v>0)); const relVol=base>0?recent/base:null; // unbekannt bleibt unbekannt
  const gapPct=(latest/prevClose-1)*100;
  const pre=bs.filter(b=>{const m=barTimeET(b.t);return m>=240&&m<570;});
  const preHigh=pre.length?maxOf(pre.map(b=>b.h)):null, preLow=pre.length?minOf(pre.map(b=>b.l)):null;
  const open=bs.filter(b=>{const m=barTimeET(b.t);return m>=570&&m<585;}); const openingHigh=open.length?maxOf(open.map(b=>b.h)):null;
  const priceScore=clamp(5+ret15*1.3+ret60*.35,0,10), volScore=relVol==null?null:clamp(4+(relVol-1)*2.3,0,10);
  const gapScore=clamp(5+Math.max(-3,Math.min(4,gapPct*.6)),0,10);
  const levelScore=preHigh?clamp(5+((latest/preHigh)-1)*250,0,10):5;
  const measuredMomentum=weighted([[null,priceScore,.35],[null,volScore,.30],[null,gapScore,.20],[null,levelScore,.15]],ALL_ON);
  // Unbekanntes Volumen darf den Momentumwert niemals durch Renormierung verbessern.
  // Konservativer Unknown-Score 4 entspricht dem Modell-Basispunkt und blockiert künstlichen Bonus.
  const momentumScore=r1(relVol==null?weighted([[null,priceScore,.35],[null,4,.30],[null,gapScore,.20],[null,levelScore,.15]],ALL_ON):measuredMomentum);
  const phase=usMarketPhase();
  const impulsePct=Math.max(Math.abs(gapPct),Math.abs(ret60),bs.length?((maxOf(bs.slice(-60).map(b=>b.h))/minOf(bs.slice(-60).map(b=>b.l))-1)*100):0);
  const structurePct=r1(Math.min(20,Math.max(0,impulsePct*1.618)));
  const light=momentumScore>=8?'green':momentumScore>=6.5?'yellow':'red';
  const actionable=['opening','regular'].includes(phase.key)&&momentumScore>=8;
  const phaseAction=['premarket-early','premarket'].includes(phase.key)?(momentumScore>=7.5?'VORBEREITEN':'beobachten'):actionable?'Opening-Bestätigung prüfen':phase.key==='closed'?'Vorbereitung':'beobachten';
  return {symbol,priceUsd:latest,gapPct:r1(gapPct),ret5:r1(ret5),ret15:r1(ret15),ret60:r1(ret60),relVol:r1(relVol),momentumScore,preHigh,preLow,openingHigh,breakPremarketHigh:!!(preHigh&&latest>preHigh),structurePct,structureTargetUsd:r2(latest*(1+structurePct/100)),light,phaseAction,marketPhase:phase.key,updated:snap.minuteBar?.t||snap.latestTrade?.t||snap.dailyBar?.t||null,priceSource};
}
async function openingMomentum(env, force=false, favoriteSymbols=[]){
  const phase=usMarketPhase();
  const feed=alpacaFeed(env), feedLabel=alpacaFeedLabel(env);
  const phaseLabel=feed==='sip' && phase.key==='premarket-early' ? 'Premarket 04:00–08:00 ET · SIP live' : phase.label;
  const phaseHelp=feed==='sip' && phase.key==='premarket-early' ? 'Alpaca SIP liefert den konsolidierten US-Gesamtmarkt auch im frühen Premarket.' : phase.help;
  if(!env.ALPACA_API_KEY_ID||!env.ALPACA_API_SECRET_KEY){setApiState('alpaca','nokey','Alpaca Secrets fehlen');return {configured:false,state:'nokey',rows:[],feed:feedLabel,phase:phase.key,phaseLabel,phaseHelp,version:APP_VERSION};}
  if(!force&&openingMemo.data&&Date.now()-openingMemo.ts<45_000)return {...openingMemo.data,cached:true};
  // v3.3.1: Opening Momentum ist nicht mehr auf den alten statischen 30er-Katalog
  // beschränkt. Es übernimmt bevorzugt die vom autonomen Tiingo-Whole-Market-Radar
  // bereits als Common Stocks verifizierten Kandidaten aus dem letzten Cron-Batch.
  // Dadurch entsteht KEIN zusätzlicher schwerer Markt-Scan aus der PWA heraus.
  const favs=[...new Set((favoriteSymbols||[]).map(x=>String(x).trim().toUpperCase()).filter(x=>/^[A-Z0-9.\-]{1,12}$/.test(x)))].slice(0,12);
  let radarRows=[], radarSource='none';
  try{
    // Bevorzugt den bereits sicherheitsgeprüften Deep-Scan-Cache.
    const persisted=await readLatestPersistedStockScan(env,30*60_000);
    radarRows=verifiedCommonOnly(Array.isArray(persisted?.meta?.verifiedRadar)?persisted.meta.verifiedRadar:[]).slice(0,24);
    if(radarRows.length) radarSource='verified-deep-cache';
  }catch{}
  if(!radarRows.length){
    try{
      // v3.3.2: Fallback direkt auf den persistenten Whole-Market-Radar.
      // Nur die kleine Top-Menge wird durch den bestehenden 7-Tage-Metadaten-Cache
      // als Common Stock verifiziert. Kein neuer /iex-Bulk-Scan aus der PWA.
      const raw=(tiingoIexRadarMemo.rows.length&&Date.now()-tiingoIexRadarMemo.ts<10*60_000)?tiingoIexRadarMemo:await readPersistedIexRadar(env);
      radarRows=await filterRadarToCommonStocks(env,raw?.rows||[],18);
      if(radarRows.length) radarSource='persistent-whole-market-radar';
    }catch(e){console.warn(JSON.stringify({event:'opening_radar_fallback_failed',message:String(e?.message||e),ts:Date.now()}));}
  }
  const radarSyms=radarRows.map(x=>x.symbol).slice(0,24);
  const dynamicUniverse=[...new Set([...radarSyms,...favs,...OPENING_UNIVERSE])].slice(0,48);
  // 1 Snapshot-Request + 1 Multi-Symbol-Bars-Request. 5-Minuten-Bars reichen
  // für unser Momentum-Modell und decken mit 8h Historie den kompletten
  // 04:00-ET-Premarket ab, ohne unnötig große Multi-Symbol-Antworten.
  const symbols=dynamicUniverse.join(',');
  const [snaps,hist]=await Promise.all([
    alpacaJSON('/v2/stocks/snapshots',{symbols,feed},env),
    alpacaJSON('/v2/stocks/bars',{symbols,timeframe:'5Min',start:isoAgo(480),limit:'10000',feed,sort:'asc'},env),
  ]);
  const rows=dynamicUniverse.map(sym=>momentumFromAlpaca(sym,snaps?.[sym],hist?.bars?.[sym]||[])).filter(Boolean).sort((a,b)=>b.momentumScore-a.momentumScore);
  const limitations=(feed==='sip'?'SIP: konsolidierter Echtzeit-Feed aller US-Börsen einschließlich Extended Hours.':'IEX Free: nur eine US-Börse; frühe Premarket-Daten sind unvollständig.')+' Kandidaten: Whole-Market-Radar + Favoriten + Basiskatalog; Opening bleibt Discovery mit 0 % BUY-Gewicht.';
  const data={configured:true,state:'ok',rows:rows.map(r=>({...r,origin:radarSyms.includes(r.symbol)?'radar':favs.includes(r.symbol)?'favorite':'base'})),scanned:rows.length,universe:dynamicUniverse.length,radarCandidates:radarSyms.length,radarSource,feed:feedLabel,phase:phase.key,phaseLabel,phaseHelp,limitations,ts:Date.now(),version:APP_VERSION};
  openingMemo={ts:Date.now(),data};
  setApiState('alpaca','ok',`${rows.length} Momentum-Titel · ${phase.label}`);
  // Nur Kandidaten, die aus dem bereits Common-Stock-verifizierten Radar kamen,
  // werden persistiert. Die Alpaca-Momentumwerte selbst sind kein Security-Gate.
  const openingVerified=radarRows.filter(r=>radarSyms.includes(String(r.symbol||'').toUpperCase()));
  await Promise.allSettled([
    persistVerifiedOpeningRadar(env,openingVerified),
    persistApiState(env,'alpaca','ok',`${rows.length} Momentum-Titel · ${phase.label}`)
  ]);
  return data;
}


/* ========================================================================
   Experimental Lab + Crowd/Search (v3.0.7)
   Diese Daten sind reine Forschungs-/Kontextvariablen und haben 0 % Gewicht
   im BUY-Score. Keine kausale Aussage wird unterstellt.
   ======================================================================== */
let experimentalMemo={ts:0,data:null};
let crowdMemo={ts:0,key:'',data:null};
function star5(x){return Math.max(1,Math.min(5,Math.round(Number(x)||1)));}
async function fetchJSONPublic(url){
  const r=await fetch(url,{headers:{accept:'application/json','user-agent':`FusionPulse/${APP_VERSION}`},signal:AbortSignal.timeout(20_000)});
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
/* ==== v3.8.2 · P6 (Teil 1): Termine der Quartalszahlen =====================
   ANLASS, konkret: Am 26.8. hat die App VEEV analysiert, bewertet und dabei
   mit keinem Wort erwaehnt, dass an diesem Abend Zahlen kommen. Der Nutzer
   hat einen Intraday-Plan mit 1,2 % Zielweite gesehen; abends bewegte sich
   die Aktie nach den Zahlen um ein Vielfaches davon. Das Urteil ueber den
   Intraday-Plan war richtig — aber die App hat eine Information verschwiegen,
   die sie haette haben koennen, und dadurch eine ANDERE Frage unsichtbar
   gemacht, die der Nutzer haette stellen wollen.

   Bewusste Designentscheidung: Daraus wird KEIN Signal. Der Weg von
   „Zahlen heute Abend" zu „dieser Trade ist besser" ist nicht berechenbar.
   Die Information ist eine WARNUNG, die ausschliesslich abwerten kann.

   Zwei Quellen, weil eine allein nicht verlaesslich ist:
   1. Twelve Data `earnings_calendar` — ob das im Basic-Tarif enthalten ist,
      ist nicht dokumentiert. Statt zu raten, wird es versucht und der echte
      Fehler durchgereicht, damit sichtbar ist WARUM nichts kommt.
   2. Manuell gepflegte Termine. Funktioniert immer, ohne Tarif und ohne
      Fremddienst — und der Nutzer schaut ohnehin bei Google Finance nach. */
const EARN_TTL_MS = 12*60*60_000;   // Termine aendern sich selten
let earnMemo={ts:0,data:null};

function parseEarningsPayload(j){
  /* Das Antwortformat ist nicht sicher dokumentiert. Tolerant parsen und im
     Zweifel NICHTS zurueckgeben, statt etwas hineinzuinterpretieren. */
  const out=new Map();
  const push=(sym,date,time)=>{
    const k=String(sym||'').trim().toUpperCase(); if(!k) return;
    const d=String(date||'').trim(); if(!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    const prev=out.get(k);
    if(!prev||d<prev.date) out.set(k,{symbol:k,date:d,time:String(time||'').trim()||null});
  };
  const walk=(node,dateHint)=>{
    if(!node) return;
    if(Array.isArray(node)){ for(const x of node) walk(x,dateHint); return; }
    if(typeof node!=='object') return;
    if(node.symbol) push(node.symbol, node.date||node.report_date||dateHint, node.time||node.hour);
    for(const [k,v] of Object.entries(node)){
      if(/^\d{4}-\d{2}-\d{2}$/.test(k)) walk(v,k); else if(typeof v==='object') walk(v,dateHint);
    }
  };
  walk(j?.earnings ?? j?.data ?? j, null);
  return [...out.values()];
}

async function earningsCalendar(env, force=false){
  const now=Date.now();
  if(!force && earnMemo.data && now-earnMemo.ts<EARN_TTL_MS) return {...earnMemo.data, cached:true};
  const manual=await readManualEarnings(env);
  if(!env?.TWELVE_API_KEY){
    const data={state:'nokey',auto:[],manual,source:null,
      note:'Kein Twelve-Data-Schlüssel hinterlegt. Es werden nur manuell eingetragene Termine verwendet.',ts:now,version:APP_VERSION};
    earnMemo={ts:now,data}; return data;
  }
  const d0=new Date(now), d1=new Date(now+14*86_400_000);
  const iso=(d)=>d.toISOString().slice(0,10);
  try{
    const j=await twelveJSON('earnings_calendar',{start_date:iso(d0),end_date:iso(d1),format:'JSON'},env.TWELVE_API_KEY,1,env);
    const auto=parseEarningsPayload(j);
    const data={state:auto.length?'ok':'empty',auto,manual,source:'Twelve Data earnings_calendar',
      note:auto.length?'Termine der Quartalszahlen. Reine Warnung — 0 % Gewicht in Score und Kauf-Freigabe.'
        :'Der Kalender antwortete, lieferte aber keine verwertbaren Termine. Möglicherweise ist er im Basic-Tarif nicht enthalten. Manuell eingetragene Termine wirken weiterhin.',
      ts:now,version:APP_VERSION};
    earnMemo={ts:now,data};
    if(env?.DB&&auto.length){ try{ await ensureD1Schema(env);
      await env.DB.prepare(`INSERT INTO fp_meta(key,value,updated_ts) VALUES(?,?,?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_ts=excluded.updated_ts`)
        .bind('earnings:last',safeJson({ts:now,auto}),now).run(); }catch{} }
    return data;
  }catch(e){
    // Letzten bekannten Stand nutzen, aber als alt kennzeichnen.
    let auto=[],staleTs=0;
    if(env?.DB){ try{ await ensureD1Schema(env);
      const r=await env.DB.prepare('SELECT value,updated_ts FROM fp_meta WHERE key=? LIMIT 1').bind('earnings:last').first();
      if(r?.value){ const p=JSON.parse(r.value); auto=p?.auto||[]; staleTs=Number(p?.ts||r.updated_ts||0); } }catch{} }
    const data={state:auto.length?'stale':'unavailable',auto,manual,staleTs,error:String(e.message||e),
      source:'Twelve Data earnings_calendar',
      note:`Der automatische Terminkalender ist nicht verfügbar: ${String(e.message||e)}. Sehr wahrscheinlich ist dieser Endpunkt im Basic-Tarif nicht enthalten. Manuell eingetragene Termine wirken unabhängig davon.`,
      ts:now,version:APP_VERSION};
    earnMemo={ts:now,data}; return data;
  }
}
async function readManualEarnings(env){
  if(!env?.DB) return [];
  try{ await ensureD1Schema(env);
    const r=await env.DB.prepare('SELECT value FROM fp_meta WHERE key=? LIMIT 1').bind('earnings:manual').first();
    if(!r?.value) return [];
    const p=JSON.parse(r.value);
    return Array.isArray(p?.rows)?p.rows.filter(x=>x?.symbol&&/^\d{4}-\d{2}-\d{2}$/.test(String(x.date||''))):[];
  }catch{ return []; }
}
async function writeManualEarnings(env,rows){
  if(!env?.DB) throw new Error('Keine D1-Verbindung');
  await ensureD1Schema(env);
  const clean=(Array.isArray(rows)?rows:[]).filter(x=>x?.symbol&&/^\d{4}-\d{2}-\d{2}$/.test(String(x.date||'')))
    .map(x=>({symbol:String(x.symbol).trim().toUpperCase().slice(0,8),date:String(x.date),time:String(x.time||'amc').slice(0,4)})).slice(0,200);
  await env.DB.prepare(`INSERT INTO fp_meta(key,value,updated_ts) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_ts=excluded.updated_ts`)
    .bind('earnings:manual',safeJson({rows:clean}),Date.now()).run();
  earnMemo={ts:0,data:null};
  return clean;
}

/* ==== v3.7.0 · P3: Krypto-Sentiment (Fear & Greed) ==========================
   Quelle: alternative.me — kostenlos, kein Schluessel, keine Registrierung.
   (Der frueher von mir behauptete Cloudflare-Egress-Blocker existiert nicht;
   Workers duerfen per fetch jede Domain aufrufen. Das war ein Irrtum.)

   Was der Index IST: ein zusammengesetzter Stimmungswert 0–100 aus
   Volatilitaet, Marktmomentum, Social-Media-Aktivitaet, Bitcoin-Dominanz und
   Suchtrends. Er misst die STIMMUNG, nicht die Qualitaet eines Trades.
   Was er NICHT ist: eine Prognose, und er gilt ausschliesslich fuer Krypto —
   nicht fuer Aktien. Additive Schicht: 0 % Gewicht in Score und Freigabe.

   Der Index wird einmal taeglich aktualisiert; deshalb ein langer Cache und
   ein D1-Rueckfall, damit ein Ausfall der Quelle nicht zu Luecken fuehrt.  */
const FNG_TTL_MS = 30*60_000;
let fngMemo = {ts:0, data:null};

function fngPlain(v){
  const n=Number(v);
  if(!Number.isFinite(n)) return {tone:'unknown', de:'unbekannt', meaning:''};
  if(n<=24) return {tone:'extreme-fear', de:'Extreme Angst',
    meaning:'Die Marktteilnehmer sind stark verunsichert und verkaufen eher. Historisch waren solche Phasen oft eher Boden als Anfang vom Ende — belastbar vorhersagen laesst sich das aber nicht.'};
  if(n<=44) return {tone:'fear', de:'Angst',
    meaning:'Vorsichtige, eher pessimistische Stimmung. Kurse bewegen sich in solchen Phasen oft ruckartig nach oben, wenn positive Nachrichten kommen.'};
  if(n<=55) return {tone:'neutral', de:'Neutral',
    meaning:'Weder ausgepraegte Angst noch Euphorie. Aus der Stimmung allein laesst sich hier am wenigsten ableiten.'};
  if(n<=74) return {tone:'greed', de:'Gier',
    meaning:'Optimistische bis euphorische Stimmung. Es wird eher gekauft — was Rueckschlaege heftiger ausfallen laesst, weil viele bereits investiert sind.'};
  return {tone:'extreme-greed', de:'Extreme Gier',
    meaning:'Sehr euphorische Stimmung. Historisch waren solche Phasen oft nahe an lokalen Hochs. Das ist eine Beobachtung ueber die Vergangenheit, keine Vorhersage.'};
}

async function cryptoSentiment(env, force=false){
  const now=Date.now();
  if(!force && fngMemo.data && now-fngMemo.ts<FNG_TTL_MS) return {...fngMemo.data, cached:true};
  try{
    const j=await fetchJSONPublic('https://api.alternative.me/fng/?limit=14&format=json');
    const arr=Array.isArray(j?.data)?j.data:[];
    if(!arr.length) throw new Error('leere Antwort');
    const cur=arr[0];
    const value=Number(cur?.value);
    if(!Number.isFinite(value)) throw new Error('kein Zahlenwert');
    const hist=arr.map(x=>({v:Number(x?.value), ts:Number(x?.timestamp)*1000}))
                  .filter(x=>Number.isFinite(x.v)&&Number.isFinite(x.ts));
    const prev=hist[1]?.v, weekAgo=hist[7]?.v;
    const p=fngPlain(value);
    const data={ state:'ok', configured:true, value, ...p,
      classificationRaw:String(cur?.value_classification||''),
      ts:Number(cur?.timestamp)*1000 || now,
      nextUpdateSec:Number(j?.data?.[0]?.time_until_update)||null,
      change1d: Number.isFinite(prev)?value-prev:null,
      change7d: Number.isFinite(weekAgo)?value-weekAgo:null,
      history: hist,
      source:'alternative.me Crypto Fear & Greed Index',
      scope:'crypto',
      note:'Stimmungsindex fuer den Kryptomarkt aus Volatilitaet, Momentum, Social Media, BTC-Dominanz und Suchtrends. Gilt NICHT fuer Aktien. 0 % Gewicht in Score und Kauf-Freigabe.',
      version:APP_VERSION, ts_fetched:now };
    fngMemo={ts:now, data};
    if(env?.DB) { try{ await ensureD1Schema(env);
      await env.DB.prepare(`INSERT INTO fp_meta(key,value,updated_ts) VALUES(?,?,?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_ts=excluded.updated_ts`)
        .bind('crypto_fng:last', safeJson(data), now).run(); }catch{} }
    return data;
  }catch(e){
    // Rueckfall auf den letzten gespeicherten Stand — aber ausdruecklich als alt gekennzeichnet.
    if(env?.DB){ try{ await ensureD1Schema(env);
      const row=await env.DB.prepare('SELECT value,updated_ts FROM fp_meta WHERE key=? LIMIT 1').bind('crypto_fng:last').first();
      if(row?.value){ const old=JSON.parse(row.value);
        return {...old, state:'stale', stale:true, error:String(e.message||e),
          note:`${old.note} ACHTUNG: Die Quelle war zuletzt nicht erreichbar; dieser Wert stammt vom ${new Date(Number(row.updated_ts)||0).toISOString()} und ist nicht aktuell.`}; }
    }catch{} }
    return { state:'error', configured:true, value:null, error:String(e.message||e),
      source:'alternative.me Crypto Fear & Greed Index', scope:'crypto',
      note:'Der Stimmungsindex konnte nicht geladen werden. Es wird bewusst kein Ersatzwert erfunden.', version:APP_VERSION };
  }
}

function moonPhase(){
  const syn=29.53058867, known=Date.UTC(2000,0,6,18,14,0); // known new moon
  let days=(Date.now()-known)/86400000; let age=((days%syn)+syn)%syn; let f=age/syn;
  const names=['Neumond','zunehmende Sichel','erstes Viertel','zunehmender Mond','Vollmond','abnehmender Mond','letztes Viertel','abnehmende Sichel'];
  const idx=Math.floor((f*8)+0.5)%8;
  const dynamic=Math.abs(Math.sin(2*Math.PI*f)); // quarter phases more "dynamic" for the display only
  return {phase:names[idx],ageDays:+age.toFixed(1),stars:star5(1+dynamic*4),label:`${names[idx]} · Alter ${age.toFixed(1)} Tage`};
}
function parseKp(raw){
  try{
    if(Array.isArray(raw)&&raw.length){
      const rows=Array.isArray(raw[0])?raw.slice(1):raw;
      const last=rows.at(-1); const kp=Array.isArray(last)?Number(last[1]??last[2]):Number(last?.kp_index??last?.kp??last?.Kp);
      if(Number.isFinite(kp))return kp;
    }
  }catch{}
  return null;
}
async function experimentalPulse(force=false){
  if(!force&&experimentalMemo.data&&Date.now()-experimentalMemo.ts<10*60_000)return {...experimentalMemo.data,cached:true};
  let kp=null,solarSpeed=null,seismic=null;
  try{kp=parseKp(await fetchJSONPublic('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json'));}catch{}
  try{const x=await fetchJSONPublic('https://services.swpc.noaa.gov/products/summary/solar-wind-speed.json');solarSpeed=Number(x?.WindSpeed??x?.wind_speed??x?.speed??x?.value??(Array.isArray(x)?x.at(-1)?.[1]:null));if(!Number.isFinite(solarSpeed))solarSpeed=null;}catch{}
  try{const q=await fetchJSONPublic('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson');const fs=q?.features||[];const maxMag=Math.max(0,...fs.map(f=>Number(f?.properties?.mag)||0));seismic={count:fs.length,maxMag};}catch{}
  const geomag=kp==null?null:{stars:star5(1+kp/2),label:`Kp ${kp.toFixed(1)} · ${kp>=5?'Sturmaktivität':'ruhig bis aktiv'}`,value:kp};
  const solar=solarSpeed==null?null:{stars:star5((solarSpeed-250)/100),label:`Sonnenwind ${Math.round(solarSpeed)} km/s`,value:solarSpeed};
  const seis=seismic?{stars:star5(1+Math.max(0,seismic.maxMag-4.5)*1.1+Math.min(1.5,seismic.count/15)),label:`${seismic.count}× M4,5+ · max M${seismic.maxMag.toFixed(1)}`,count:seismic.count,maxMag:seismic.maxMag}:null;
  const data={configured:true,state:'ok',geomag,solar,seismic:seis,astro:moonPhase(),collective:{stars:null,label:'GCP klassisch beendet 03.04.2026 · GCI ohne öffentliche Live-API'},notes:'Nur Dynamik/Aktivität; 0 % BUY-Gewicht.',ts:Date.now(),version:APP_VERSION};
  experimentalMemo={ts:Date.now(),data};return data;
}
function crowdQueryName(sym){
  const n=STOCK_SEARCH_BY_SYMBOL.get(sym)?.name||STOCK_NAMES[sym]||sym;
  return `${String(n).replace(/,/g,' ')} stock`;
}
function crowdCommunityQuery(sym){
  const n=STOCK_SEARCH_BY_SYMBOL.get(sym)?.name||STOCK_NAMES[sym]||sym;
  // v3.3.0: trader/community-first. SerpApi is used only as a search transport;
  // Reddit/X/Stocktwits are the sources being discovered, not mainstream news.
  return `(${sym} OR \"${String(n).replace(/[,]/g,' ')}\") (site:reddit.com OR site:x.com OR site:stocktwits.com)`;
}
function trendScore(values){
  const a=(values||[]).map(Number).filter(Number.isFinite); if(a.length<3)return null;
  const recent=mean(a.slice(-3)); const base=mean(a.slice(0,Math.max(1,a.length-3)))||recent||1;
  const accel=(recent-base)/(Math.abs(base)+1)*100;
  const score=clamp(50+accel*2.2,0,100); const stars=star5(1+Math.abs(accel)/8);
  return {score:r1(score),stars,accel:r1(accel),recent:r1(recent)};
}
/* ==== v3.6.5 · SerpAPI-Budgetwaechter ======================================
   BEFUND (kritisch): Bis 3.6.4 hat jeder Aufruf ohne warmen Isolate-Cache
   ALLE bis zu 15 Symbole neu gesucht. `crowdMemo` liegt im Arbeitsspeicher
   des Workers — Cloudflare-Isolates sind kurzlebig und es gibt viele davon,
   der Cache greift also unzuverlaessig. Der Client ruft alle 20 Minuten ab
   und beim manuellen Refresh mit force=1 (Cache komplett umgangen).
   Rechnung: 100 Freiabfragen/Monat / 15 Symbole = 6,6 vollstaendige Laeufe.
   IM GANZEN MONAT. Ein einziger Handelstag haette das Kontingent verbrannt.

   Behoben durch drei Schichten, jede fuer sich fail-closed:
   1. D1-Cache `crowd_cache` wird jetzt auch GELESEN (war bisher nur Schreib-
      ziel). Ueberlebt Isolate-Neustarts.
   2. Harte Monatsbudget-Zaehlung in fp_meta. Ist das Budget erschoepft,
      werden KEINE Abfragen mehr gemacht — auch nicht mit force=1.
   3. Pro Aufruf maximal wenige echte Abfragen; der Rest kommt aus dem Cache
      oder bleibt null. Lieber ein leeres Feld als ein verbranntes Budget. */
const CROWD_TTL_MS          = 6*60*60_000;  // ein Symbol wird hoechstens alle 6 h neu gesucht
const CROWD_TTL_FORCED_MS   = 60*60_000;    // auch "force" respektiert eine Stunde Mindestabstand
const CROWD_MAX_FETCH_CALL  = 3;            // hoechstens 3 echte SerpAPI-Abfragen je Aufruf
const CROWD_DEFAULT_BUDGET  = 90;           // Freitarif = 100/Monat, 10 als Reserve

const monthKey = (d=new Date()) => `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;

async function crowdBudgetRead(env){
  const budget=Math.max(0, Number(env?.SERPAPI_MONTHLY_BUDGET ?? CROWD_DEFAULT_BUDGET) || 0);
  const month=monthKey();
  if(!env?.DB) return {month,used:0,budget,left:budget,persistent:false};
  try{
    await ensureD1Schema(env);
    const row=await env.DB.prepare('SELECT value FROM fp_meta WHERE key=? LIMIT 1').bind('serpapi_quota').first();
    let v=null; if(row?.value){ try{ v=JSON.parse(row.value); }catch{} }
    const used=(v&&v.month===month)?Math.max(0,Number(v.used)||0):0;  // Monatswechsel setzt zurueck
    return {month,used,budget,left:Math.max(0,budget-used),persistent:true};
  }catch{ return {month,used:0,budget,left:budget,persistent:false}; }
}
async function crowdBudgetAdd(env,n){
  if(!env?.DB||!(n>0)) return;
  try{
    await ensureD1Schema(env);
    const q=await crowdBudgetRead(env);
    await env.DB.prepare(`INSERT INTO fp_meta(key,value,updated_ts) VALUES(?,?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_ts=excluded.updated_ts`)
      .bind('serpapi_quota', safeJson({month:q.month,used:q.used+n}), Date.now()).run();
  }catch(e){ console.warn(JSON.stringify({event:'fusionpulse_crowd_budget_persist_failed',message:String(e?.message||e)})); }
}
async function d1ReadCrowd(env,syms){
  const out=new Map();
  if(!env?.DB||!syms.length) return out;
  try{
    await ensureD1Schema(env);
    const ph=syms.map(()=>'?').join(',');
    const rs=await env.DB.prepare(`SELECT symbol,ts,score,stars,accel,interest,source FROM crowd_cache WHERE symbol IN (${ph})`).bind(...syms).all();
    for(const r of rs?.results||[]) out.set(String(r.symbol).toUpperCase(),r);
  }catch{}
  return out;
}

async function crowdPulse(env,symbols,force=false){
  const syms=[...new Set(String(symbols||'').split(',').map(x=>x.trim().toUpperCase()).filter(x=>/^[A-Z0-9.\-]{1,8}$/.test(x)))].slice(0,15);
  const key=syms.join(',');
  if(!env.SERPAPI_KEY)return {configured:false,state:'nokey',rows:syms.map(symbol=>({symbol,score:null,stars:null,source:'Reddit/X/Stocktwits Search'})),note:'SERPAPI_KEY fehlt; Crowd-Werte werden nicht erfunden.',version:APP_VERSION};

  const quota=await crowdBudgetRead(env);
  const cache=await d1ReadCrowd(env,syms);
  const now=Date.now();
  const ttl=force?CROWD_TTL_FORCED_MS:CROWD_TTL_MS;

  // Wer ist wirklich veraltet? Aelteste zuerst, damit nichts dauerhaft haengenbleibt.
  const stale=syms.filter(sym=>{ const c=cache.get(sym); return !c||!(now-Number(c.ts||0)<ttl); })
    .sort((a,b)=>Number(cache.get(a)?.ts||0)-Number(cache.get(b)?.ts||0));
  const allowed=Math.max(0,Math.min(CROWD_MAX_FETCH_CALL, quota.left, stale.length));
  const toFetch=new Set(stale.slice(0,allowed));

  const rows=[]; let spent=0;
  for(const symbol of syms){
    const c=cache.get(symbol);
    if(!toFetch.has(symbol)){
      rows.push(c
        ? {symbol,score:dbNum(c.score),stars:c.stars==null?null:Number(c.stars),accel:dbNum(c.accel),
           interest:dbNum(c.interest),source:c.source||'Community Search',ts:Number(c.ts)||null,cached:true,
           note:'Aus dem Zwischenspeicher; zur Schonung des SerpAPI-Kontingents nicht neu abgefragt.'}
        : {symbol,score:null,stars:null,accel:null,source:'Community Search',cached:false,
           note:quota.left<=0?'SerpAPI-Monatsbudget erschöpft; es wird bewusst nichts geschätzt.'
                             :'Noch nicht abgefragt; wird nach und nach nachgeholt, um das Kontingent zu schonen.'});
      continue;
    }
    const u=new URL('https://serpapi.com/search.json');u.searchParams.set('engine','google');u.searchParams.set('q',crowdCommunityQuery(symbol));u.searchParams.set('location','United States');u.searchParams.set('hl','en');u.searchParams.set('num','20');u.searchParams.set('tbs','qdr:d');u.searchParams.set('api_key',env.SERPAPI_KEY);
    try{
      const j=await fetchJSONPublic(u.toString());spent++;
      const org=(j?.organic_results||[]).slice(0,20);
      const domains=new Set(),texts=[];
      for(const x of org){const link=String(x?.link||'').toLowerCase();if(link.includes('reddit.com'))domains.add('Reddit');if(link.includes('x.com'))domains.add('X');if(link.includes('stocktwits.com'))domains.add('Stocktwits');texts.push(`${x?.title||''} ${x?.snippet||''}`.toLowerCase());}
      const mentions=org.length, breadth=domains.size;
      // Attention only: no fabricated sentiment. Breadth + fresh result count become a transparent 0..100 attention score.
      const score=clamp(mentions*4+breadth*8,0,100);const stars=mentions?star5(1+score/25):null;
      // Beschleunigung gegen den vorherigen gespeicherten Wert — echte Aenderung, keine Schaetzung.
      const prev=c&&Number.isFinite(Number(c.score))?{v:Number(c.score),t:Number(c.ts)||0}:null;
      const hrs=prev?Math.max(0.5,(now-prev.t)/3_600_000):0;
      const accel=prev&&hrs>=0.5?r1((score-prev.v)/hrs):null;
      rows.push({symbol,score:r1(score),stars,accel,interest:mentions,source:[...domains].join(' + ')||'Community Search',sources:[...domains],mentions24h:mentions,ts:now,cached:false,note:'Community-Aufmerksamkeit der letzten 24 h; keine Sentiment- oder BUY-Aussage.'});
    }catch(e){spent++;rows.push({symbol,score:dbNum(c?.score),stars:c?.stars==null?null:Number(c.stars),source:'Reddit/X/Stocktwits Search',ts:c?Number(c.ts):null,cached:!!c,error:String(e.message||e)});}
  }
  if(spent>0) await crowdBudgetAdd(env,spent);

  const after=Math.max(0,quota.left-spent);
  const data={configured:true,state:after<=0&&stale.length>spent?'quota':'ok',rows,
    cacheMinutes:Math.round(CROWD_TTL_MS/60_000),
    quota:{month:quota.month,used:quota.used+spent,budget:quota.budget,left:after,spentThisCall:spent,
           pending:Math.max(0,stale.length-spent),ttlHours:Math.round(CROWD_TTL_MS/3_600_000),persistent:quota.persistent},
    note:'Crowd Pulse sucht vorrangig Reddit, X und Stocktwits. Er misst frische Aufmerksamkeit/Quellenbreite, nicht Wahrheit oder Kaufqualität; 0 % BUY-Gewicht. Jede echte Abfrage kostet SerpAPI-Kontingent, deshalb wird pro Aufruf nur eine Handvoll Symbole aufgefrischt.',
    ts:now,version:APP_VERSION};
  crowdMemo={ts:now,key,data};return data;
}


/* ========================================================================
   FusionPulse 3.0 — serverseitiges D1-Learning
   DB-Binding: env.DB (Cloudflare D1). Die PWA bleibt funktionsfähig, wenn D1
   noch nicht verbunden ist; dann zeigt /api/learning state="nodb".
   Gespeichert werden echte Markt-Snapshots und nachfolgend beobachtete
   Outcomes. Browser-/PWA-Speicher ist damit nicht mehr die einzige Quelle.
   ======================================================================== */
/* ============================================================================
   v3.21.0 · DIE WIRTSCHAFTLICHE SCHWELLE IST JETZT DIE EINZIGE WAHRHEIT
   ----------------------------------------------------------------------------
   Bis v3.20.0 stand an vier Stellen die Zahl 5: ATTR.WIN_PCT, d1TwinFor,
   patternLab und der Aufloeser. Sie war nie hergeleitet. Die Schwelle, die
   zaehlt, folgt aus den Handelskosten des Nutzers und wird deshalb ab hier
   GERECHNET, nicht gesetzt. Aendert sich eine Kostenkonstante, wandert die
   Schwelle mit — und mit ihr jede Statistik der App.

   Absichtlich ohne Funktionsaufruf ausgeschrieben: diese Konstanten werden beim
   Laden des Moduls ausgewertet, `pickCfg` und `requiredMovePct` stehen erst
   weiter unten. Ein Test prueft, dass beide Wege dieselbe Zahl ergeben.
   ========================================================================== */
/* Zwei STRUKTURELL verschiedene Kostenmodelle. Der Unterschied ist keine
   Zahlenfrage, er aendert die Strategie:
     Aktien (flatex US-Direkthandel): FIXE 11,50 EUR je Order. Der Kostenanteil
       faellt mit der Positionsgroesse — kleine Positionen sind unwirtschaftlich.
     Krypto (Bitpanda Fusion): KEINE Fixgebuehr, alles proportional (Taker-Fee
       je Seite plus Spread). Der Kostenanteil ist von der Positionsgroesse
       UNABHAENGIG — man kann beliebig klein handeln, ohne bestraft zu werden.
   Zufaellig liegen beide Rundlaufkosten bei 10.000 EUR fast gleichauf
   (0,38 % gegen 0,40 % bei 0,1 % Spread). Das taeuscht: bei 2.500 EUR Einsatz
   sind es 0,86 % gegen weiterhin 0,40 %. */
const PICK_COST = { kind: 'fixed', notionalEur: 10000, orderFeeEur: 11.5, frictionPct: 0.15, taxPct: 27.5 };
const COIN_COST = { kind: 'proportional', notionalEur: 10000, feePct: 0.15, spreadPct: 0.10, taxPct: 27.5 };
/* Rueckfallwerte, wenn Gebuehr oder Spread FEHLEN. Bewusst PESSIMISTISCH und
   nicht gleich den Standardwerten: 0,10 % Spread gilt fuer BTC und ETH, nicht
   fuer den Rest. Ein unbekannter Spread muss teurer rechnen als ein gemessener
   enger, sonst verbessert fehlende Information das Ergebnis — genau die Regel,
   gegen die diese App an jeder Stelle gebaut ist. */
const COIN_SPREAD_UNKNOWN = 0.30;
const COIN_FEE_UNKNOWN = 0.25;
const ECON_NET_EUR = 120;                       // Zielgroesse aus Handover Abschnitt 4
const ECON_FIX_EUR = PICK_COST.orderFeeEur * 2 + PICK_COST.notionalEur * (PICK_COST.frictionPct / 100);
/** Zielweite, ab der ein Trade ECON_NET_EUR netto uebrig laesst: 2,04 %. */
const ECON_WIN_PCT = Math.round(((ECON_NET_EUR / (1 - PICK_COST.taxPct / 100) + ECON_FIX_EUR)
  / PICK_COST.notionalEur * 100) * 100) / 100;
/** Weiter darf der Stop nicht weg sein. Gewinne werden versteuert, Verluste
 *  tragen die vollen Gebuehren — bei 1:1 braeuchte es ueber 66 % Trefferquote. */
const ECON_MIN_REWARD_RISK = 2.0;
const ECON_STOP_PCT = -Math.round(ECON_WIN_PCT / ECON_MIN_REWARD_RISK * 100) / 100;
/** Zeitstempel-Referenz. Identisch mit der wirtschaftlichen Schwelle: eine
 *  zweite, abweichende Zahl waere genau der Fehler, der hier behoben wird. */
const PICK_REACH_PCT = ECON_WIN_PCT;
/** Die alte Zahl bleibt NUR als Vergleichsgroesse in der Anzeige erhalten,
 *  damit der Unterschied sichtbar ist statt behauptet. Sie steuert nichts. */
const LEGACY_WIN_PCT = 5;
const LEARN_HORIZON_MS = 180 * 60_000;
const LEARN_HISTORY_MS = 120 * 60_000;
const LEARN_SIGNAL_LABELS = ['attention','crowd','sector','rvol','vacuum','elliott','momentum','technical'];

let d1SchemaReady=false;
let learnMemo={ts:0,key:'',data:null};
async function ensureD1Schema(env){
  if(!env.DB||d1SchemaReady)return !!env.DB;
  const ddl=[
    `CREATE TABLE IF NOT EXISTS market_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT,ts INTEGER NOT NULL,bucket5 INTEGER NOT NULL,source TEXT NOT NULL,asset_type TEXT NOT NULL,symbol TEXT NOT NULL,sector TEXT,phase TEXT,price REAL NOT NULL,score REAL,crv REAL,rvol REAL,ret15 REAL,ret60 REAL,atr_pct REAL,liquidity_vacuum REAL,sector_lag REAL,crowd_score REAL,structure_pct REAL,executability REAL,light TEXT,max_pct REAL NOT NULL DEFAULT 0,min_pct REAL NOT NULL DEFAULT 0,success_ts INTEGER,reach_ts INTEGER,mae_pre REAL,resolved_ts INTEGER,payload TEXT,UNIQUE(source,asset_type,symbol,bucket5))`,
    `CREATE INDEX IF NOT EXISTS idx_snap_symbol_ts ON market_snapshots(symbol, ts DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_snap_unresolved ON market_snapshots(resolved_ts, ts)`,
    `CREATE INDEX IF NOT EXISTS idx_snap_sector_resolved ON market_snapshots(sector, resolved_ts, ts DESC)`,
    `CREATE TABLE IF NOT EXISTS signal_events (id INTEGER PRIMARY KEY AUTOINCREMENT,symbol TEXT NOT NULL,ts INTEGER NOT NULL,bucket5 INTEGER NOT NULL,signal TEXT NOT NULL,price REAL NOT NULL,strength REAL,source TEXT,UNIQUE(symbol,bucket5,signal))`,
    `CREATE INDEX IF NOT EXISTS idx_event_symbol_ts ON signal_events(symbol, ts DESC)`,
    `CREATE TABLE IF NOT EXISTS crowd_cache (symbol TEXT PRIMARY KEY,ts INTEGER NOT NULL,score REAL,stars INTEGER,accel REAL,interest REAL,source TEXT)`,
    `CREATE TABLE IF NOT EXISTS fp_meta (key TEXT PRIMARY KEY,value TEXT,updated_ts INTEGER NOT NULL)`
  ];
  for(const q of ddl)await env.DB.prepare(q).run();
  // Bestehende Produktions-D1 aus älteren Versionen sicher nachziehen.
  const cols=(await env.DB.prepare('PRAGMA table_info(market_snapshots)').all()).results||[];
  if(!cols.some(c=>String(c.name)==='executability')) await env.DB.prepare('ALTER TABLE market_snapshots ADD COLUMN executability REAL').run();
  /* v3.20.0: Zeitpunkt, an dem eine Aufzeichnung erstmals die WIRTSCHAFTLICHE
     Schwelle erreicht hat (PICK_REACH_PCT). `success_ts` misst +5 % und ist
     damit fuer die Frage "wie lange muss ich halten" unbrauchbar — im
     180-Minuten-Horizont erreichen das die wenigsten. Rueckwirkend laesst sich
     das NICHT ergaenzen; die Spalte fuellt sich ab jetzt. */
  if(!cols.some(c=>String(c.name)==='reach_ts')) await env.DB.prepare('ALTER TABLE market_snapshots ADD COLUMN reach_ts INTEGER').run();
  /* v3.21.0 · DIE MESSUNG, DIE GEFEHLT HAT.
     `min_pct` ist das Minimum ueber das GANZE Fenster — auch nach dem Ziel.
     Fuer die entscheidende Frage "welchen Stop haette ich gebraucht, um diesen
     Gewinner zu BEHALTEN" ist das unbrauchbar: ein Titel, der +3 % lief und
     danach -5 % fiel, sieht dort aus wie ein Katastrophentrade.
     `mae_pre` friert die schlimmste Gegenbewegung VOR dem Erreichen der
     wirtschaftlichen Schwelle ein. Erst damit laesst sich trennen, ob ein Setup
     sich nicht weit genug bewegt oder ob es sich bewegt und einen nur vorher
     herausschuettelt. Das sind zwei voellig verschiedene Probleme. */
  if(!cols.some(c=>String(c.name)==='mae_pre')) await env.DB.prepare('ALTER TABLE market_snapshots ADD COLUMN mae_pre REAL').run();
  d1SchemaReady=true;return true;
}
const dbNum = (x) => Number.isFinite(Number(x)) ? Number(x) : null;
function safeJson(x){ try { return JSON.stringify(x); } catch { return null; } }
function learningFeatures(row){
  return {
    score: dbNum(row.score ?? row.momentumScore),
    crv: dbNum(row.netCRV),
    rv: dbNum(row.relVol),
    r15: dbNum(row.ret15),
    r60: dbNum(row.ret60),
    atr: dbNum(row.atrPct),
    vac: dbNum(row.liquidityVacuum),
    lag: dbNum(row.sectorLag),
    crowd: dbNum(row.crowdScore),
    structure: dbNum(row.structurePct),
  };
}
function serverLeadFlags(row){
  const crowd = dbNum(row.crowdScore);
  const ret15 = Math.abs(dbNum(row.ret15) ?? 0);
  const attention = crowd == null ? false : (crowd >= 65 && ret15 <= 2.5);
  return {
    attention,
    crowd: crowd != null && crowd >= 70,
    sector: (dbNum(row.sectorLag) ?? 0) >= 1,
    rvol: (dbNum(row.relVol) ?? 0) >= 1.8,
    vacuum: (dbNum(row.liquidityVacuum) ?? 0) >= 70,
    elliott: (dbNum(row.structurePct) ?? 0) >= 5,
    momentum: (dbNum(row.momentumScore) ?? dbNum(row.momentum) ?? dbNum(row.score) ?? 0) >= 7.5,
    technical: (dbNum(row.score) ?? 0) >= 7.5,
  };
}
async function d1CrowdScore(env, symbol){
  if(!env.DB) return null;
  try{
    const r=await env.DB.prepare('SELECT score FROM crowd_cache WHERE symbol=? AND ts>? LIMIT 1')
      .bind(symbol, Date.now()-6*60*60_000).first();
    return dbNum(r?.score);
  }catch{return null;}
}
async function d1StoreCrowd(env, rows){
  if(!env.DB || !rows?.length) return;
  await ensureD1Schema(env);
  const now=Date.now();
  const stmts=rows.filter(x=>x?.symbol).map(x=>env.DB.prepare(
    `INSERT INTO crowd_cache(symbol,ts,score,stars,accel,interest,source)
     VALUES(?,?,?,?,?,?,?) ON CONFLICT(symbol) DO UPDATE SET
     ts=excluded.ts,score=excluded.score,stars=excluded.stars,accel=excluded.accel,
     interest=excluded.interest,source=excluded.source`
  ).bind(String(x.symbol).toUpperCase(), now, dbNum(x.score), dbNum(x.stars), dbNum(x.accel), dbNum(x.interest), x.source||'Crowd'));
  if(stmts.length) await env.DB.batch(stmts);
}
async function d1UpdateOutcomes(env, symbol, price, now=Date.now(), assetType='stock', source='server'){
  if(!env.DB || !(price>0) || !symbol) return;
  const rows=(await env.DB.prepare(
    `SELECT id,ts,price,max_pct,min_pct,success_ts,reach_ts,mae_pre FROM market_snapshots
     WHERE symbol=? AND asset_type=? AND source=? AND resolved_ts IS NULL AND ts>=? ORDER BY ts ASC LIMIT 500`
  ).bind(symbol, assetType, source, now-LEARN_HORIZON_MS-15*60_000).all()).results||[];
  if(!rows.length) return;
  const stmts=[];
  for(const x of rows){
    const pct=(price/Number(x.price)-1)*100;
    const mx=Math.max(Number(x.max_pct)||0,pct), mn=Math.min(Number(x.min_pct)||0,pct);
    const successTs=x.success_ts || (mx>=5 ? now : null);
    const reachTs=x.reach_ts || (mx>=PICK_REACH_PCT ? now : null);
    /* MAE-vor-MFE: die schlimmste Gegenbewegung, die man aushalten musste, BEVOR
       der bisherige Hoechststand erreicht war. Wird immer dann neu festgehalten,
       wenn ein neuer Hoechststand entsteht.
       Warum nicht "bis zur 2-%-Marke einfrieren" (so stand es im ersten Entwurf):
       dann waere die Zahl nur fuer Ziele bis 2 % gueltig gewesen und jedes
       groessere Ziel haette auf `min_pct` zurueckfallen muessen — also auf einen
       Wert, der auch den Rueckgang NACH dem Ausstieg enthaelt. Ein Setup, das
       1,8 % Luft braucht und dafuer 4,2 % liefert, waere so faelschlich als
       unhandelbar ausgewiesen worden.
       So gemessen gilt: um `max_pct` zu erreichen, musste man `mae_pre`
       aushalten. Fuer jedes KLEINERE Ziel ist das eine Obergrenze — also die
       vorsichtige Richtung. */
    const setsNewMax = pct > (Number(x.max_pct) || 0);
    const maePre = setsNewMax ? mn : (Number.isFinite(Number(x.mae_pre)) ? Number(x.mae_pre) : mn);
    const resolved=(now-Number(x.ts)>=LEARN_HORIZON_MS) ? now : null;
    stmts.push(env.DB.prepare('UPDATE market_snapshots SET max_pct=?,min_pct=?,success_ts=COALESCE(success_ts,?),reach_ts=COALESCE(reach_ts,?),mae_pre=?,resolved_ts=COALESCE(resolved_ts,?) WHERE id=?')
      .bind(mx,mn,successTs,reachTs,maePre,resolved,x.id));
  }
  if(stmts.length) await env.DB.batch(stmts);
}
async function d1StoreSnapshotRow(env, row, {source='server',assetType='stock',now=Date.now()}={}){
  if(!env.DB || !row) return;
  await ensureD1Schema(env);
  const symbol=String(row.symbol||row.pair||'').toUpperCase();
  const price=dbNum(row.priceUsd ?? row.price ?? row.livePrice ?? row.priceEur);
  if(!symbol || !(price>0)) return;
  await d1UpdateOutcomes(env,symbol,price,now,assetType,source);
  const crowdScore = dbNum(row.crowdScore) ?? await d1CrowdScore(env,symbol);
  const enriched={...row,crowdScore};
  const f=learningFeatures(enriched), bucket5=Math.floor(now/(5*60_000));
  await env.DB.prepare(
    `INSERT OR IGNORE INTO market_snapshots
     (ts,bucket5,source,asset_type,symbol,sector,phase,price,score,crv,rvol,ret15,ret60,atr_pct,liquidity_vacuum,sector_lag,crowd_score,structure_pct,executability,light,payload)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(now,bucket5,source,assetType,symbol,row.sector||null,row.marketPhase||row.phase||null,price,
    f.score,f.crv,f.rv,f.r15,f.r60,f.atr,f.vac,f.lag,crowdScore,f.structure,dbNum(row.executability),row.light||null,snapshotPayload(row)).run();
  const flags=serverLeadFlags(enriched);
  const ev=[];
  for(const k of LEARN_SIGNAL_LABELS){
    if(!flags[k]) continue;
    const strength = k==='crowd'?crowdScore : k==='rvol'?f.rv : k==='vacuum'?f.vac : k==='sector'?f.lag : k==='elliott'?f.structure : k==='technical'?f.score : k==='momentum'?(dbNum(row.momentumScore)??dbNum(row.momentum)??f.score) : crowdScore;
    ev.push(env.DB.prepare('INSERT OR IGNORE INTO signal_events(symbol,ts,bucket5,signal,price,strength,source) VALUES(?,?,?,?,?,?,?)')
      .bind(symbol,now,bucket5,k,price,strength,source));
  }
  if(ev.length) await env.DB.batch(ev);
}
async function d1BatchChunks(env, stmts, size=50){
  for(let i=0;i<stmts.length;i+=size) await env.DB.batch(stmts.slice(i,i+size));
}
/* v3.17.0 · BEFUND: Der Snapshot speicherte nur `setup` — den ALTEN, groben
   Musternamen. Die neun Typen der Situation Engine (SQUEEZE RELEASE, BREAKOUT
   PRESSURE, ...), die Lebenszyklus-Phase und die Reife, also genau das, was die
   Oberflaeche seit v3.4.3 anzeigt und woran der Nutzer sich orientiert, wurden
   NIE mitgeschrieben. Modul 0 gruppiert deshalb bis heute nach `setup` und
   konnte ueber die Situationstypen gar nichts lernen.

   Das laesst sich nicht rueckwirkend heilen: was nicht aufgezeichnet wurde, ist
   weg. Ab hier wird es mitgeschrieben, damit die Auswertung in einigen Wochen
   eine echte Grundlage hat. Bis dahin steht in der Oberflaeche ausdruecklich,
   dass die Situationstypen noch keine Historie haben — geschaetzt wird nichts.

   Eine Stelle, zwei Aufrufer: sonst laufen die beiden Schreibpfade auseinander,
   und genau das war in v3.10.0 schon einmal der Fehler (`sectorLag` nur auf
   EINEM Datenpfad berechnet). */
function snapshotPayload(row){
  return safeJson({
    setup: row?.setup || null,
    phaseAction: row?.phaseAction || null,
    verdict: row?.verdict || null,
    situation: row?.situationType || row?.situation || null,
    lifecycle: row?.radarLifecycle || row?.lifecycle || null,
    maturity: Number.isFinite(Number(row?.preSignalMaturity)) ? Math.round(Number(row.preSignalMaturity)) : null,
    prioritySector: row?.prioritySector || null,
    /* v3.18.0: Der IEX-Dollarumsatz wird ab hier MITGESCHRIEBEN. Er ist die
       Groesse, gegen die MOM_MIN_DOLLARVOL prueft — und sie stand nirgends in
       der Aufzeichnung. Deshalb liess sich die Schwelle seit v3.9.0 nur raten.
       Dieselbe Lehre wie beim Situationstyp: was man nicht aufzeichnet, kann
       man nie kalibrieren. Rueckwirkend ist auch das nicht zu heilen. */
    dollarVol: Number.isFinite(Number(row?.dollarVol)) ? Math.round(Number(row.dollarVol))
      : (Number.isFinite(Number(row?.volume)) && Number.isFinite(Number(row?.priceUsd))
         ? Math.round(Number(row.volume)*Number(row.priceUsd)) : null),
    /* v3.23.0: Der SPREAD ist bei Krypto der groesste Kostenblock ueberhaupt —
       bei Bitpanda Fusion gibt es keine Fixgebuehr, alles ist proportional.
       Er stand bisher NICHT in der Aufzeichnung, also liess sich die
       Kryptorechnung nur mit einer Annahme fuehren. Dritte Wiederholung
       derselben Lehre nach Situationstyp (v3.17.0) und Dollarumsatz (v3.18.0):
       was man nicht aufzeichnet, kann man nie kalibrieren. */
    spreadPct: Number.isFinite(Number(row?.spreadPct))
      ? Math.round(Number(row.spreadPct) * 10000) / 10000 : null,
    /* v3.27.0 · VIERTE Wiederholung derselben Lehre, nach Situationstyp
       (v3.17.0), Dollarumsatz (v3.18.0) und Spread (v3.23.0):
       was man nicht aufzeichnet, kann man nie kalibrieren.
       Der `situationScore` entscheidet, WELCHE Titel ueberhaupt in die
       Kandidatenliste kommen — er sitzt vor jeder Kostenrechnung und jeder
       Rangfolge. Seine elf Terme waren bis hierher nirgends gespeichert.
       Damit war die Frage "traegt dieser Koeffizient etwas bei" nicht nur
       unbeantwortet, sondern unbeantwortBAR. */
    situScore: Number.isFinite(Number(row?.situationScore)) ? Math.round(Number(row.situationScore)) : null,
    situParts: row?.situParts && typeof row.situParts === 'object' ? row.situParts : null,
  });
}
async function d1StoreRows(env, rows, opts={}){
  if(!env.DB || !rows?.length) return;
  await ensureD1Schema(env);
  const source=opts.source||'server', assetType=opts.assetType||'stock', now=opts.now||Date.now();
  const clean=[];
  for(const row of rows.slice(0,60)){
    const symbol=String(row?.symbol||row?.pair||'').toUpperCase();
    const price=dbNum(row?.priceUsd ?? row?.price ?? row?.livePrice ?? row?.priceEur);
    if(symbol && price>0) clean.push({row,symbol,price});
  }
  if(!clean.length) return;
  const symbols=[...new Set(clean.map(x=>x.symbol))];
  const placeholders=symbols.map(()=>'?').join(',');

  // Outcomes in EINER Abfrage laden und anschließend gebündelt aktualisieren.
  const unresolved=(await env.DB.prepare(`SELECT id,symbol,ts,price,max_pct,min_pct,success_ts,reach_ts,mae_pre FROM market_snapshots
    WHERE symbol IN (${placeholders}) AND asset_type=? AND source=? AND resolved_ts IS NULL AND ts>=? ORDER BY ts ASC LIMIT 3000`)
    .bind(...symbols,assetType,source,now-LEARN_HORIZON_MS-15*60_000).all()).results||[];
  const pxBySym=new Map(clean.map(x=>[x.symbol,x.price])), updates=[];
  for(const x of unresolved){
    const price=pxBySym.get(String(x.symbol).toUpperCase()); if(!(price>0)||!(Number(x.price)>0)) continue;
    const pct=(price/Number(x.price)-1)*100, mx=Math.max(Number(x.max_pct)||0,pct), mn=Math.min(Number(x.min_pct)||0,pct);
    const successTs=x.success_ts || (mx>=5?now:null), resolved=(now-Number(x.ts)>=LEARN_HORIZON_MS)?now:null;
    const reachTs=x.reach_ts || (mx>=PICK_REACH_PCT ? now : null);
    const setsNewMax = pct > (Number(x.max_pct) || 0);   // MAE-vor-MFE, siehe d1UpdateOutcomes
    const maePre = setsNewMax ? mn : (Number.isFinite(Number(x.mae_pre)) ? Number(x.mae_pre) : mn);
    updates.push(env.DB.prepare('UPDATE market_snapshots SET max_pct=?,min_pct=?,success_ts=COALESCE(success_ts,?),reach_ts=COALESCE(reach_ts,?),mae_pre=?,resolved_ts=COALESCE(resolved_ts,?) WHERE id=?')
      .bind(mx,mn,successTs,reachTs,maePre,resolved,x.id));
  }
  if(updates.length) await d1BatchChunks(env,updates);

  // Crowd-Scores ebenfalls in einer Abfrage statt pro Symbol.
  const crowdRows=(await env.DB.prepare(`SELECT symbol,score FROM crowd_cache WHERE symbol IN (${placeholders}) AND ts > ?`).bind(...symbols,now-6*60*60_000).all()).results||[];
  const crowdBySym=new Map(crowdRows.map(x=>[String(x.symbol).toUpperCase(),dbNum(x.score)]));
  const bucket5=Math.floor(now/(5*60_000)), inserts=[], events=[];
  for(const {row,symbol,price} of clean){
    const crowdScore=dbNum(row.crowdScore) ?? crowdBySym.get(symbol) ?? null;
    const enriched={...row,crowdScore}, f=learningFeatures(enriched);
    inserts.push(env.DB.prepare(`INSERT OR IGNORE INTO market_snapshots
      (ts,bucket5,source,asset_type,symbol,sector,phase,price,score,crv,rvol,ret15,ret60,atr_pct,liquidity_vacuum,sector_lag,crowd_score,structure_pct,executability,light,payload)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(now,bucket5,source,assetType,symbol,row.sector||null,row.marketPhase||row.phase||null,price,
        f.score,f.crv,f.rv,f.r15,f.r60,f.atr,f.vac,f.lag,crowdScore,f.structure,dbNum(row.executability),row.light||null,
        snapshotPayload(row)));
    const flags=serverLeadFlags(enriched);
    for(const k of LEARN_SIGNAL_LABELS){
      if(!flags[k]) continue;
      const strength=k==='crowd'?crowdScore:k==='rvol'?f.rv:k==='vacuum'?f.vac:k==='sector'?f.lag:k==='elliott'?f.structure:k==='technical'?f.score:k==='momentum'?(dbNum(row.momentumScore)??dbNum(row.momentum)??f.score):crowdScore;
      events.push(env.DB.prepare('INSERT OR IGNORE INTO signal_events(symbol,ts,bucket5,signal,price,strength,source) VALUES(?,?,?,?,?,?,?)')
        .bind(symbol,now,bucket5,k,price,strength,source));
    }
  }
  if(inserts.length) await d1BatchChunks(env,inserts);
  if(events.length) await d1BatchChunks(env,events);
}
function twinDistance(a,b){
  const w={score:1.2,crv:.7,rv:.45,r15:.5,r60:.25,atr:.5,vac:.035,lag:.35,crowd:.025,structure:.08};
  let z=0,n=0;
  for(const k of Object.keys(w)){
    const av=dbNum(a[k]),bv=dbNum(b[k]); if(av==null||bv==null)continue;
    z+=Math.pow((av-bv)*w[k],2); n++;
  }
  return n>=3?Math.sqrt(z):9999;
}
// v3.2.9 — Historical Twin uses independent, genuinely similar episodes instead of
// blindly filling a fixed Top-12 list with highly correlated snapshots.
function independentTwinEpisodes(cur, rows){
  const MAX_DIST=3.25; // fixed similarity gate; never loosened to manufacture a sample size
  const bestByEpisode=new Map();
  for(const raw of rows||[]){
    const d=twinDistance(cur,raw);
    if(!Number.isFinite(d)||d>=9999||d>MAX_DIST) continue;
    const ts=Number(raw.ts)||0;
    // One observation per symbol and UTC trading date. This collapses the many overlapping
    // 5-minute snapshots of the same move into one independent historical episode.
    const day=ts?new Date(ts).toISOString().slice(0,10):String(raw.bucket5||'unknown');
    const key=`${String(raw.symbol||'').toUpperCase()}:${day}`;
    const x={...raw,d};
    const prev=bestByEpisode.get(key);
    if(!prev||d<prev.d) bestByEpisode.set(key,x);
  }
  return [...bestByEpisode.values()].sort((a,b)=>a.d-b.d).slice(0,40);
}
async function d1TwinFor(env, symbol){
  if(!env.DB) return {n:0,source:'none'};
  const cur=await env.DB.prepare(`SELECT sector,score,crv,rvol rv,ret15 r15,ret60 r60,atr_pct atr,liquidity_vacuum vac,sector_lag lag,crowd_score crowd,structure_pct structure
    FROM market_snapshots WHERE symbol=? AND asset_type='stock' AND source IN ('Twelve Data','Tiingo IEX') ORDER BY ts DESC LIMIT 1`).bind(symbol).first();
  if(!cur) return {n:0,source:'d1'};
  if(!cur.sector) return {n:0,source:'d1',reason:'kein Sektor'};
  const curBucket=Math.floor(Date.now()/(5*60_000));
  const q=env.DB.prepare(`SELECT symbol,ts,bucket5,score,crv,rvol rv,ret15 r15,ret60 r60,atr_pct atr,liquidity_vacuum vac,sector_lag lag,crowd_score crowd,structure_pct structure,max_pct,min_pct
       FROM market_snapshots WHERE resolved_ts IS NOT NULL AND asset_type='stock' AND source IN ('Twelve Data','Tiingo IEX') AND sector=? AND bucket5<=? ORDER BY ts DESC LIMIT 500`).bind(cur.sector,curBucket-36);
  const rows=(await q.all()).results||[];
  const twins=independentTwinEpisodes(cur,rows);
  const available=twins.length;
  const distinctSymbols=new Set(twins.map(x=>String(x.symbol||'').toUpperCase())).size;
  if(twins.length<5)return {n:twins.length,available,distinctSymbols,source:'d1',reason:'zu wenige unabhängige ähnliche Episoden'};
  const vals=twins.map(x=>Number(x.max_pct)||0).sort((a,b)=>a-b);
  // Distance-weighted outcome: close historical analogues count more than marginal ones.
  let winW=0,totalW=0;
  for(const x of twins){const w=1/Math.pow(1+Math.max(0,Number(x.d)||0),2);totalW+=w;if(Number(x.max_pct)>=ECON_WIN_PCT)winW+=w;}
  return {n:twins.length,available,distinctSymbols,edge:totalW?Math.round(winW/totalW*100):0,stops:twins.filter(x=>Number(x.min_pct)<=ECON_STOP_PCT).length,median:r1(vals[Math.floor(vals.length/2)]||0),source:'d1',independent:true};
}
async function d1LeadModel(env, symbol){
  if(!env.DB)return {n:0};
  const successes=(await env.DB.prepare(`SELECT ts,success_ts FROM market_snapshots WHERE symbol=? AND asset_type='stock' AND source IN ('Twelve Data','Tiingo IEX') AND success_ts IS NOT NULL ORDER BY success_ts DESC LIMIT 40`).bind(symbol).all()).results||[];
  if(!successes.length)return {n:0};
  const minTs=Math.min(...successes.map(s=>Number(s.ts)))-60*60_000;
  const maxTs=Math.max(...successes.map(s=>Number(s.success_ts)));
  const allEvents=(await env.DB.prepare(`SELECT signal,ts FROM signal_events WHERE symbol=? AND source IN ('Twelve Data','Tiingo IEX') AND ts BETWEEN ? AND ? ORDER BY ts ASC`).bind(symbol,minTs,maxTs).all()).results||[];
  const leads={}, first={}; let used=0;
  for(const s of successes){
    const start=Number(s.ts)-60*60_000,end=Number(s.success_ts);
    const bySignal=new Map();
    for(const e of allEvents){const t=Number(e.ts);if(t<start||t>end||bySignal.has(e.signal))continue;bySignal.set(e.signal,t);}
    const events=[...bySignal].map(([signal,ts])=>({signal,ts})).sort((a,b)=>a.ts-b.ts);
    if(!events.length)continue; used++;
    first[events[0].signal]=(first[events[0].signal]||0)+1;
    for(const e of events){(leads[e.signal]??=[]).push(Math.max(0,(end-Number(e.ts))/60000));}
  }
  const med=a=>{const x=[...(a||[])].sort((a,b)=>a-b);return x.length?x[Math.floor(x.length/2)]:null};
  const firstKey=Object.entries(first).sort((a,b)=>b[1]-a[1])[0]?.[0]||null;
  const best=Object.entries(leads).map(([k,a])=>({k,m:med(a),n:a.length})).filter(x=>x.n>=3).sort((a,b)=>b.m-a.m).slice(0,3);
  return {n:used,firstKey,best};
}
async function d1History(env, symbol, assetType){
  if(!env.DB)return [];
  const sourceClause = assetType === 'stock' ? " AND source IN ('Twelve Data','Tiingo IEX')" : '';
  const rows=(await env.DB.prepare(`SELECT ts,score,crv,executability,light,price FROM market_snapshots
    WHERE symbol=? AND asset_type=?${sourceClause} AND ts>=? ORDER BY ts ASC`).bind(symbol,assetType,Date.now()-LEARN_HISTORY_MS).all()).results||[];
  // ein Punkt je 15-Minuten-Segment, serverseitig und geräteunabhängig
  const bins=new Map();
  for(const x of rows) bins.set(Math.floor(Number(x.ts)/(15*60_000)),{ts:Number(x.ts),quality:Number(x.score)||0,executability:Number(x.executability)||0,light:x.light||'red',crv:Number(x.crv)||0,price:Number(x.price)||0});
  return [...bins.values()].slice(-8);
}

/* ============================================================================
   MODUL 0 · CLAUDE ATTRIBUTION & OVERFITTING GUARD (v3.5.4, additiv)
   ----------------------------------------------------------------------------
   Zweck: ehrlich messen, welche Setups/Lifecycle-Zustaende tatsaechlich einen
   Vorteil hatten, statt es zu behaupten. Der Guard verhindert dabei drei
   klassische Selbstbetrugsfehler, die genau bei "die App verbessert sich
   taeglich selbst" auftreten:

   (1) Zu wenig Daten: Unter MIN_SAMPLE Trades gibt es KEIN Urteil, nur
       "sammelt noch". Kein Algorithmus kann aus 5 Trades Edge von Zufall
       unterscheiden. Ohne dieses Tor wuerde die App auf Rauschen optimieren.
   (2) In-Sample-Illusion: Der Edge wird an aelteren Trades geschaetzt und an
       den juengsten, NICHT zum Schaetzen benutzten Trades geprueft
       (Out-of-Sample). Bricht OOS gegenueber In-Sample ein -> Overfitting-Flag.
   (3) Mehrfachtest-Problem: Wer 8 Setups testet, findet zufaellig eines, das
       gut aussieht. Der Guard rechnet die Anzahl paralleler Tests heraus
       (Bonferroni-artige Schwellenanhebung) statt naiv das beste zu feiern.

   Wichtig: Der Guard gibt ABSCHALT-EMPFEHLUNGEN, keine automatische Abschaltung.
   Der Mensch bestaetigt. Er veraendert NICHTS am Claude- oder FusionPulse-Score;
   er ist eine reine Auswertungs-/Empfehlungsschicht ueber bereits vorhandenen,
   in market_snapshots aufgeloesten Outcomes (max_pct/min_pct/success_ts).
   Datenquelle sind ausschliesslich resolved Snapshots -> kein Repainting.
   ============================================================================ */
const ATTR = {
  MIN_SAMPLE: 20,        // unter dieser Trade-Zahl je Bucket: kein Urteil
  OOS_FRACTION: 0.30,    // juengste 30 % der Episoden sind Out-of-Sample
  OOS_MIN: 6,            // aber mindestens so viele OOS-Episoden noetig
  OOS_CONFIDENT: 15,     // erst ab so vielen OOS-Episoden ist "disable" erlaubt;
                         //   darunter nur "beobachten", weil die Wilson-Untergrenze
                         //   bei kleinem n selbst echte Gewinner erschlagen wuerde.
  /* v3.21.0: war hart auf 5 / -1,5. Beide Zahlen waren nie hergeleitet und
     haben jede Auswertung dieser App an der Sache vorbeimessen lassen — ein
     Setup mit zuverlaessigen +2,5 % galt als Misserfolg. Jetzt gerechnet. */
  WIN_PCT: ECON_WIN_PCT,
  STOP_PCT: ECON_STOP_PCT,
  DISABLE_POINT: 40,     // OOS-Punktschaetzung < 40 % UND
  DISABLE_WILSON: 33,    //   Wilson-Untergrenze < 33 % -> erst dann Abschalt-Empfehlung.
                         //   Zwei Kriterien verhindern, dass Stichprobenrauschen allein
                         //   (breites Konfidenzintervall) einen echten Edge abschaltet.
  OVERFIT_DROP: 20,      // In-Sample - OOS >= 20 Prozentpunkte -> Overfit-Flag
  HISTORY_MS: 21*24*60*60_000, // Bewertungsfenster: 3 Wochen
};
// Wilson-Score-Untergrenze (95 %): ehrliche Trefferquote bei kleiner Stichprobe.
// Verhindert, dass "3 von 4" (75 %) als starker Edge missverstanden wird.
function wilsonLower(wins, n){
  if(n<=0) return 0;
  const z=1.96, p=wins/n;
  const denom=1+z*z/n;
  const centre=p+z*z/(2*n);
  const margin=z*Math.sqrt((p*(1-p)+z*z/(4*n))/n);
  return Math.max(0,(centre-margin)/denom);
}
/** Eine Episode je Symbol+Tag+Bucket-Gruppe: verhindert, dass 5-Minuten-
 *  Snapshots derselben Bewegung als unabhaengige Trades mehrfach zaehlen. */
function collapseEpisodes(rows){
  const byEp=new Map();
  for(const r of rows){
    const day=r.ts?new Date(Number(r.ts)).toISOString().slice(0,10):'?';
    const key=`${r.symbol}:${day}`;
    const prev=byEp.get(key);
    // beste (frueheste) Momentaufnahme der Episode behalten
    if(!prev||Number(r.ts)<Number(prev.ts)) byEp.set(key,r);
  }
  return [...byEp.values()].sort((a,b)=>Number(a.ts)-Number(b.ts));
}
function bucketStats(episodes){
  const n=episodes.length;
  if(!n) return {n:0};
  const splitAt=Math.max(1,Math.floor(n*(1-ATTR.OOS_FRACTION)));
  const inSample=episodes.slice(0,splitAt);
  const oos=episodes.slice(splitAt);
  const winRate=(arr)=>{ if(!arr.length) return null; const w=arr.filter(x=>Number(x.max_pct)>=ATTR.WIN_PCT).length; return {w,n:arr.length,pct:Math.round(w/arr.length*100),wilson:Math.round(wilsonLower(w,arr.length)*100)}; };
  const stopRate=(arr)=>arr.length?Math.round(arr.filter(x=>Number(x.min_pct)<=ATTR.STOP_PCT).length/arr.length*100):null;
  const medianMax=(arr)=>{ if(!arr.length) return 0; const s=arr.map(x=>Number(x.max_pct)||0).sort((a,b)=>a-b); return r1(s[Math.floor(s.length/2)]); };
  return {
    n, inSampleN:inSample.length, oosN:oos.length,
    all:winRate(episodes), inSample:winRate(inSample), oos:winRate(oos),
    stopRateAll:stopRate(episodes), medianMaxAll:medianMax(episodes),
  };
}
/* ============================================================================
   v3.20.0 · TOP PICKS — Rangfolge nach erwartetem NETTO-EURO
   ----------------------------------------------------------------------------
   DER BEFUND, DER DIESES MODUL AUSGELOEST HAT (dritter Fall derselben Art nach
   v3.8.0 "falsches Universum" und v3.16.0 "falsches Gate"):

   Jede Lernstatistik dieser App definiert Erfolg als `max_pct >= 5`
   (ATTR.WIN_PCT, d1TwinFor, patternLab, der Aufloeser in d1UpdateOutcomes).
   Der Lernhorizont betraegt aber nur 180 Minuten (LEARN_HORIZON_MS), und die
   wirtschaftliche Schwelle des Nutzers liegt aus den EIGENEN Kostenkonstanten
   der App bei rund 2,0 %:

     10.000 EUR Einsatz, 2 x 11,50 EUR Ordergebuehr, 0,15 % Reibung, 27,5 % KESt
     -> fuer 120 EUR netto sind ~2,04 % Zielweite noetig, nicht 5 %.

   Folge: ein Setup, das zuverlaessig +2,5 % in zwei Stunden liefert — also
   GENAU das, was der Nutzer will ("ein paar Prozent spaeter verkaufen") —
   zaehlt in jeder Statistik dieser App als MISSERFOLG. Die Lernschicht hat
   damit systematisch die seltenen, volatilen Ausreisser bevorzugt und die
   tragfaehigen Setups verworfen. Nicht die Kandidaten waren schlecht; die
   Zielscheibe stand an der falschen Stelle.

   WAS DIESES MODUL TUT:
   Es bewertet Situationstypen gegen die WIRTSCHAFTLICHE Schwelle des Nutzers
   und rechnet das Ergebnis in Euro um. Keine Vorhersage — eine Auszaehlung
   aufgeloester Aufzeichnungen.

   DREI EHRLICHKEITSREGELN, die hier haerter greifen als anderswo:

   1. REIHENFOLGE IST NICHT AUFGEZEICHNET. `max_pct` und `min_pct` sind zwei
      unabhaengige Extremwerte ueber den Horizont. Ob der Stop VOR dem Ziel
      erreicht wurde, steht nirgends. Deshalb gilt eine Episode, die BEIDES
      beruehrt hat, als AUSGESTOPPT — die pessimistische Lesart. Ihre Anzahl
      wird als `ambiguous` getrennt ausgewiesen, damit sichtbar bleibt, wie
      gross dieser Unsicherheitsanteil ist.
   2. VORSICHTIGE SCHRANKEN STATT PUNKTSCHAETZUNG. Die Trefferquote geht mit
      der Wilson-UNTERgrenze ein, die Stopquote mit der Wilson-OBERgrenze.
      Beides zieht den Erwartungswert nach unten. Eine kleine Stichprobe kann
      damit nie gut aussehen — sie sieht unbestimmt aus, und das ist richtig.
   3. FAIL-CLOSED IN DER RANGFOLGE. Ein Kandidat ohne ausreichende Beleglage
      wird NIE ueber einen belegten positiven Kandidaten gereiht. Fehlende
      Daten verbessern nichts. Sie werden ausgewiesen, nicht geschaetzt.

   0 % Gewicht in Score, Ampel, Gate und Freigabe. Dieses Modul ordnet an,
   es bewertet nicht neu.
   ========================================================================== */
const PICK = {
  MIN_EVIDENCE: 20,     // ab hier "belegt"
  THIN_EVIDENCE: 6,     // darunter "unbelegt"
  DEFAULT_NET_EUR: ECON_NET_EUR,
  /* v3.20.0 · ZWEITER BEFUND, gerechnet statt vermutet.
     Die Stopweite darf NICHT frei gewaehlt werden. Bei 10.000 EUR, 38 EUR
     Fixkosten und 27,5 % KESt gilt fuer ein 120-EUR-Ziel (= 2,035 % Zielweite):
       Stop -2,0 %  -> Verlust 238 EUR -> noetige Trefferquote 66,5 %
       Stop -1,5 %  -> Verlust 188 EUR -> noetige Trefferquote 61,0 %
       Stop -1,0 %  -> Verlust 138 EUR -> noetige Trefferquote 53,5 %
       Stop -0,75 % -> Verlust 113 EUR -> noetige Trefferquote 48,5 %
     Eine Trefferquote ueber 60 % gibt es im Intraday-Momentum nicht dauerhaft.
     Mit einem 2-%-Stop ist ein 2-%-Ziel deshalb rechnerisch unmoeglich — ganz
     unabhaengig davon, wie gut die Kandidaten sind. Das erklaert die zweite
     Haelfte der Frage "warum kommt nichts Gewinntraechtiges heraus".
     MIN_REWARD_RISK steht seit v3.9.0 im Client auf 2,0; hier wird die Stopweite
     daraus ABGELEITET statt geraten. */
  MIN_REWARD_RISK: ECON_MIN_REWARD_RISK,
  WINDOW_MS: 21 * 24 * 60 * 60_000,
  ROW_LIMIT: 8000,
};

const pickCfg = (cfg) => ({ ...PICK_COST, ...(cfg || {}) });
/** Fixkosten eines vollstaendigen Trades: zwei Orders plus Ausfuehrungsreibung. */
function pickCosts(cfg) {
  const c = pickCfg(cfg);
  /* `Number(null)` und `Number('')` sind 0, nicht NaN. Eine reine
     `Number.isFinite`-Pruefung haette eine fehlende Angabe deshalb als
     KOSTENLOS durchgelassen — der teuerste denkbare Fehler an dieser Stelle.
     Es gilt deshalb: nur ein POSITIVER Zahlenwert zaehlt als Angabe. */
  const given = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.abs(n) : null; };
  if (c.kind === 'proportional') {
    const fee = given(c.feePct) ?? COIN_FEE_UNKNOWN;
    const spread = given(c.spreadPct) ?? COIN_SPREAD_UNKNOWN;
    return c.notionalEur * ((fee * 2 + spread) / 100);
  }
  const fixed = given(c.orderFeeEur) ?? 11.5;
  const fric = given(c.frictionPct) ?? 0.15;
  return fixed * 2 + c.notionalEur * (fric / 100);
}
/** Rundlaufkosten in Prozent des Einsatzes. Bei Krypto ist das eine Konstante,
 *  bei Aktien haengt sie an der Positionsgroesse — genau darin liegt der
 *  strategische Unterschied zwischen beiden Maerkten. */
function roundTripPct(cfg) {
  const c = pickCfg(cfg);
  return c.notionalEur > 0 ? pickCosts(c) / c.notionalEur * 100 : null;
}
/** Netto-Euro eines Gewinntrades bei Zielweite `pct` %. Kosten mindern den
 *  steuerpflichtigen Gewinn — genau so rechnet auch `sizing()` im Client. */
function netEurAtMove(pct, cfg) {
  const c = pickCfg(cfg);
  return (c.notionalEur * (pct / 100) - pickCosts(c)) * (1 - c.taxPct / 100);
}
/** Netto-Verlust am Stop. Bewusst OHNE Steuergutschrift: sie ist nicht
 *  garantiert und wuerde den Verlust kleiner rechnen, als er sicher ist. */
function lossEurAtStop(stopPct, cfg) {
  const c = pickCfg(cfg);
  return c.notionalEur * (Math.abs(stopPct) / 100) + pickCosts(c);
}
/** Umkehrung: welche Zielweite braucht es fuer `netEur` netto? Das ist die
 *  Zahl, gegen die gelernt werden muss — nicht die 5 % aus ATTR.WIN_PCT. */
function requiredMovePct(netEur, cfg) {
  const c = pickCfg(cfg);
  return ((Number(netEur) || 0) / (1 - c.taxPct / 100) + pickCosts(c)) / c.notionalEur * 100;
}
/** Wilson-OBERgrenze, Gegenstueck zu wilsonLower. Fuer die Stopquote. */
function wilsonUpper(hits, n) {
  if (n <= 0) return 1;
  const z = 1.96, p = hits / n;
  const denom = 1 + z * z / n;
  const centre = p + z * z / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n);
  return Math.min(1, (centre + margin) / denom);
}

/** Auszaehlung einer Episodengruppe gegen Ziel- und Stopweite.
 *  Beruehrt eine Episode beides, gilt sie als ausgestoppt (Regel 1). */
function pickOutcome(episodes, targetPct, stopPct, opts = {}) {
  const eps = (episodes || []).filter((e) =>
    Number.isFinite(Number(e.max_pct)) && Number.isFinite(Number(e.min_pct)));
  const n = eps.length;
  let hit = 0, stopped = 0, ambiguous = 0, measured = 0;
  const minutes = [];
  for (const e of eps) {
    const mx = Number(e.max_pct);
    /* v3.21.0 · WELCHE Gegenbewegung zaehlt.
       `min_pct` ist das Minimum ueber das GANZE Fenster, auch NACH dem Ziel.
       Wer damit prueft, ob ein Stop gerissen haette, bestraft Gewinner fuer
       einen Rueckgang, den sie gar nicht mehr miterlebt haben — der Trade war
       da schon zu. `mae_pre` ist die Gegenbewegung VOR dem Ziel und damit die
       einzige Zahl, die die Frage beantwortet.
       Fehlt sie (alte Zeilen), wird auf die pessimistische Variante
       zurueckgefallen. Fail-closed: fehlende Daten machen es nie besser.
       `strictHeat` erzwingt die pessimistische Variante fuer Gegenproben. */
    const pre = Number(e.mae_pre);
    const usePre = !opts.strictHeat && Number.isFinite(pre);
    if (usePre) measured++;
    const mn = usePre ? pre : Number(e.min_pct);
    const reached = mx >= targetPct, breached = mn <= stopPct;
    if (breached) { stopped++; if (reached) ambiguous++; }
    else if (reached) {
      hit++;
      const t0 = Number(e.ts), t1 = Number(e.reach_ts || e.success_ts);
      if (t0 > 0 && t1 > t0) minutes.push((t1 - t0) / 60000);
    }
  }
  minutes.sort((a, b) => a - b);
  return {
    n, hit, stopped, ambiguous, flat: n - hit - stopped,
    heatMeasuredN: measured, heatStrict: !!opts.strictHeat,
    medianMinutes: minutes.length ? Math.round(minutes[Math.floor(minutes.length / 2)]) : null,
    minutesN: minutes.length,
  };
}

/** Erwarteter Netto-Euro je Trade, mit vorsichtigen Schranken (Regel 2). */
function pickExpectancy(outcome, targetPct, stopPct, cfg) {
  const { n, hit, stopped } = outcome;
  if (!n) return { evEur: null, pHit: null, pStop: null, reason: 'keine Episoden' };
  let pHit = wilsonLower(hit, n);
  let pStop = wilsonUpper(stopped, n);
  // Beide Schranken zeigen nach aussen; ihre Summe kann 1 ueberschreiten. Dann
  // wird die GUENSTIGE Groesse gekuerzt, nicht die unguenstige.
  if (pHit + pStop > 1) pHit = Math.max(0, 1 - pStop);
  const pFlat = Math.max(0, 1 - pHit - pStop);
  const win = netEurAtMove(targetPct, cfg);
  const loss = lossEurAtStop(stopPct, cfg);
  const flatCost = pickCosts(cfg);           // weder Ziel noch Stop: Kosten bleiben
  return {
    evEur: Math.round(pHit * win - pStop * loss - pFlat * flatCost),
    pHit: Math.round(pHit * 100), pStop: Math.round(pStop * 100),
    pointHit: Math.round(hit / n * 100),
    winEur: Math.round(win), lossEur: Math.round(loss),
  };
}

/** Trefferquote, ab der ein Setup nach Kosten und Steuer bei null landet.
 *  Die Zahl, die der Nutzer eigentlich braucht — sie stand nirgends. */
function breakEvenHitRate(targetPct, stopPct, cfg) {
  const win = netEurAtMove(targetPct, cfg), loss = lossEurAtStop(stopPct, cfg);
  return win + loss > 0 ? loss / (win + loss) : 1;
}

/* ============================================================================
   v3.22.0 · "SCHNELL GELD VERDIENEN" IST EINE ANDERE FRAGE ALS "GUTER TRADE"
   ----------------------------------------------------------------------------
   Bis v3.21.0 hat die App den Erwartungswert JE TRADE optimiert. Das ist nicht
   dieselbe Groesse wie Ertrag je Zeit — und nach der zweiten war gefragt.

   Ein Setup mit +40 EUR, das dreimal taeglich auftritt, schlaegt eines mit
   +80 EUR, das einmal pro Woche kommt, um den Faktor zehn. Genauso zaehlt, wie
   lange das Kapital gebunden ist: 40 EUR in 30 Minuten sind etwas anderes als
   40 EUR in sechs Stunden, weil im ersten Fall danach noch ein Trade passt.

   Drei Groessen, alle aus vorhandenen Daten:
     - Gelegenheiten je Handelstag  (Episoden / Handelstage im Fenster)
     - Erwarteter Euro je Handelstag (EV x Gelegenheiten, gedeckelt)
     - Euro je Stunde Kapitalbindung (EV / Haltedauer)

   Der Deckel ist wichtig und keine Kosmetik: bei 10.000 EUR Fixeinsatz lassen
   sich nicht beliebig viele Trades gleichzeitig halten. Ohne ihn wuerde ein
   haeufiger, schwacher Typ eine seltene, starke Gelegenheit ueberholen —
   rechnerisch richtig, praktisch nicht ausfuehrbar.
   ========================================================================== */
const TEMPO = {
  /* Aktien: eine US-Session dauert 6,5 Stunden. Bei rund 40 Minuten typischer
     Haltedauer und einer Position je Trade sind drei Durchgaenge realistisch.
     Krypto: der Markt laeuft 24/7, der Mensch nicht. Gerechnet wird mit rund
     16 wachen Stunden, also fuenf statt drei. Beides sind bewusst NIEDRIGE
     Annahmen: ein zu hoher Deckel liesse haeufige schwache Setups gewinnen,
     die sich in Wirklichkeit gar nicht alle halten lassen. */
  MAX_TRADES_PER_DAY: 3,
  MAX_TRADES_PER_DAY_COIN: 5,
  MIN_DAYS: 5,             // unter so vielen Tagen keine Frequenzaussage
};
const tempoCap = (asset) => asset === 'coin' ? TEMPO.MAX_TRADES_PER_DAY_COIN : TEMPO.MAX_TRADES_PER_DAY;
function tempoOf(episodes, tradingDays, evEur, medianMinutes, asset) {
  const n = (episodes || []).length;
  if (!n || !(tradingDays >= TEMPO.MIN_DAYS))
    return { perDay: null, evPerDay: null, evPerHour: null,
      tempoNote: `Weniger als ${TEMPO.MIN_DAYS} Handelstage im Fenster — eine Aussage zur Haeufigkeit waere geraten.` };
  const cap = tempoCap(asset);
  const perDayRaw = n / tradingDays;
  const perDay = Math.min(cap, perDayRaw);
  const capped = perDayRaw > cap;
  return {
    perDay: r2(perDayRaw), perDayUsed: r2(perDay), capped,
    evPerDay: evEur == null ? null : Math.round(evEur * perDay),
    evPerHour: (evEur == null || !(medianMinutes > 0)) ? null
      : Math.round(evEur / (medianMinutes / 60)),
    tempoNote: capped
      ? `${r2(perDayRaw)} Gelegenheiten je Tag gemessen, gerechnet wird mit ${cap} — mehr laesst sich mit einer Position je Trade nicht halten.`
      : `${r2(perDayRaw)} Gelegenheiten je Tag ueber ${tradingDays} Tage.`,
  };
}
/** Wie viel vom Bruttogewinn fressen die Fixkosten? Die Zahl erklaert, warum
 *  kleine Ziele strukturell die schlechtesten sind: bei 2 % Zielweite gehen
 *  18,6 % des Bruttogewinns fuer Gebuehren und Reibung drauf, bei 6 % nur 6,3 %.
 *  Deshalb ist die abgeleitete Mindestzielweite ein BODEN, kein Wunschwert. */
function costLoadPct(targetPct, cfg) {
  const c = pickCfg(cfg), gross = c.notionalEur * (targetPct / 100);
  return gross > 0 ? Math.round(pickCosts(c) / gross * 1000) / 10 : null;
}

const evidenceTier = (n) =>
  n >= PICK.MIN_EVIDENCE ? 'belegt' : n >= PICK.THIN_EVIDENCE ? 'duenn' : 'unbelegt';

/** Rangfolge. Die Reihenfolge der Stufen IST die Fail-Closed-Regel (Regel 3):
 *  unbelegt kann belegt-positiv nie ueberholen, egal wie hoch der Live-Score. */
const PICK_RANK = { belegtPositiv: 0, duennPositiv: 1, unbelegt: 2, belegtNegativ: 3 };
function pickTier(tier, evEur) {
  if (tier === 'unbelegt' || evEur == null) return 'unbelegt';
  if (evEur > 0) return tier === 'belegt' ? 'belegtPositiv' : 'duennPositiv';
  return tier === 'belegt' ? 'belegtNegativ' : 'unbelegt';
}
function rankPicks(picks) {
  return [...(picks || [])].sort((a, b) => {
    const ra = PICK_RANK[a.rank] ?? 9, rb = PICK_RANK[b.rank] ?? 9;
    if (ra !== rb) return ra - rb;
    if (a.rank === 'unbelegt') return (b.liveScore || 0) - (a.liveScore || 0);
    /* v3.22.0: sortiert wird nach Euro JE HANDELSTAG, nicht je Trade — das war
       die Frage. Fehlt die Frequenzaussage (zu wenige Handelstage), faellt der
       Vergleich auf den Wert je Trade zurueck; ein Kandidat OHNE Frequenzangabe
       darf dadurch aber nie einen MIT ueberholen, sonst wuerde fehlendes Wissen
       wieder nach oben helfen. */
    const av = a.evPerDay ?? null, bv = b.evPerDay ?? null;
    if (av != null && bv != null && av !== bv) return bv - av;
    if (av != null && bv == null) return -1;
    if (av == null && bv != null) return 1;
    return (b.evEur ?? -1e9) - (a.evEur ?? -1e9);
  });
}

/* ---------------------------------------------------------------------------
   v3.21.0 · DIE ZWEI FRAGEN AUSEINANDERHALTEN
   Ein Situationstyp kann aus zwei voellig verschiedenen Gruenden nichts
   einbringen, und die Konsequenzen sind gegensaetzlich:

     A) Er bewegt sich nicht weit genug  -> anderer Kandidatenkreis noetig
     B) Er bewegt sich, schuettelt aber vorher heraus -> anderer Stop/Einstieg

   Bis hierher waren beide Faelle als \"Erwartungswert negativ\" ununterscheidbar.
   `mae_pre` trennt sie: es misst die Gegenbewegung VOR dem Ziel.
   ------------------------------------------------------------------------- */
const quantile = (sorted, q) => sorted.length
  ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))] : null;

/** Wie viel Gegenbewegung mussten die Gewinner aushalten? */
function heatProfile(episodes, targetPct) {
  const winners = (episodes || []).filter((e) => Number(e.max_pct) >= targetPct);
  const measured = [], upper = [];
  for (const e of winners) {
    const pre = Number(e.mae_pre);
    if (Number.isFinite(pre)) measured.push(Math.abs(pre));
    else upper.push(Math.abs(Number(e.min_pct) || 0));
  }
  const use = measured.length >= 5 ? measured : [...measured, ...upper];
  use.sort((a, b) => a - b);
  return {
    winners: winners.length,
    heatSource: measured.length >= 5 ? 'gemessen' : (use.length ? 'Obergrenze' : 'keine'),
    measuredN: measured.length,
    heatMedian: use.length ? Math.round(quantile(use, 0.5) * 100) / 100 : null,
    // Stopabstand, der 80 % der Gewinner im Trade gehalten haette.
    stopFor80: use.length ? Math.round(quantile(use, 0.8) * 100) / 100 : null,
  };
}

/** Zerlegt das Ergebnis in eine Ursache statt in eine Note. */
function pickVerdict({ n, hit, heat, targetPct, maxStopPct, minSample }) {
  if (n < minSample) return { verdict: 'zu wenige Faelle', why: `${n} von ${minSample} noetigen Episoden.` };
  const reachRate = n ? hit / n : 0;
  if (heat.winners / Math.max(1, n) < 0.15)
    return { verdict: 'bewegt sich nicht weit genug',
      why: `Nur ${heat.winners} von ${n} Episoden haben ${r2(targetPct)} % ueberhaupt beruehrt. Ein engerer Stop hilft hier nicht — der Kandidatenkreis ist der falsche.` };
  if (heat.stopFor80 != null && heat.stopFor80 > maxStopPct)
    return { verdict: 'zu verrauscht fuer diese Positionsgroesse',
      why: `${heat.winners} Episoden haben das Ziel erreicht, brauchten dafuer aber ${r2(heat.stopFor80)} % Luft. Erlaubt sind bei ${r2(targetPct)} % Ziel nur ${r2(maxStopPct)} %. Diese Bewegung ist da, sie ist mit 10.000 EUR fix nur nicht greifbar.` };
  if (reachRate <= 0)
    return { verdict: 'keine sauberen Treffer', why: 'Jede Zielberuehrung ging mit einem Stopdurchbruch einher.' };
  return { verdict: 'handelbar',
    why: `${hit} von ${n} Episoden haben ${r2(targetPct)} % erreicht, ohne mehr als ${r2(maxStopPct)} % Luft zu brauchen.` };
}

/* ---------------------------------------------------------------------------
   Rastersuche nach dem besten Ziel/Stop-Paar — MIT Ueberanpassungs-Bremse.
   Optimiert wird auf dem AELTEREN Teil der Episoden, geurteilt auf dem
   juengeren. Das beste Paar auf denselben Daten zu finden UND zu feiern, auf
   denen es gesucht wurde, ist die haeufigste Selbsttaeuschung ueberhaupt.
   Der Abstand zwischen beiden Werten wird ausgewiesen, nicht versteckt.
   ------------------------------------------------------------------------- */
const GRID = {
  TARGET_MAX: 6.0, TARGET_STEP: 0.2,
  STOP_MIN: 0.3, STOP_STEP: 0.1,
  /* 12 statt 8: mit weniger Episoden im Nachweisteil ist die vorsichtige
     Schaetzung so breit, dass sie auch echte Gewinner erschlaegt. Die
     Rastersuche braucht damit rund 40 Episoden, bevor sie ueberhaupt anlaeuft. */
  OOS_FRACTION: 0.3, OOS_MIN: 12,
  OVERFIT_DROP_EUR: 40,
};
function optimizeGrid(episodes, minTargetPct, cfg) {
  const eps = [...(episodes || [])].sort((a, b) => Number(a.ts) - Number(b.ts));
  const splitAt = Math.max(1, Math.floor(eps.length * (1 - GRID.OOS_FRACTION)));
  const inSample = eps.slice(0, splitAt), oos = eps.slice(splitAt);
  if (oos.length < GRID.OOS_MIN)
    return { available: false, reason: `Nur ${oos.length} Episoden im Nachweisteil, noetig sind ${GRID.OOS_MIN}.`, oosN: oos.length };

  let best = null, points = 0;
  for (let t = minTargetPct; t <= GRID.TARGET_MAX + 1e-9; t += GRID.TARGET_STEP) {
    const stopCap = t / ECON_MIN_REWARD_RISK;
    for (let st = GRID.STOP_MIN; st <= stopCap + 1e-9; st += GRID.STOP_STEP) {
      points++;
      /* Gerundet wird VOR der Auswertung, nicht danach. Sonst sucht das Raster
         mit 1,7999999 und der Nachweisteil prueft mit 1,80 — und genau an der
         Grenze, wo die Gegenbewegung den Stop beruehrt, kippt das Ergebnis.
         Der Fehler war in meinem ersten Entwurf drin und hat einen tragfaehigen
         Fall als ueberangepasst ausgewiesen. */
      const tR = r2(t), stR = r2(st);
      const o = pickOutcome(inSample, tR, -stR);
      if (!o.hit) continue;
      // In-Sample bewusst mit Punktschaetzung: hier wird GESUCHT, nicht geurteilt.
      const ev = o.hit / o.n * netEurAtMove(tR, cfg)
               - o.stopped / o.n * lossEurAtStop(-stR, cfg)
               - o.flat / o.n * pickCosts(cfg);
      if (!best || ev > best.evIn) best = { targetPct: tR, stopPct: -stR, evIn: Math.round(ev), inN: o.n, inHit: o.hit };
    }
  }
  if (!best) return { available: false, reason: 'Kein Paar im Suchraum hat ueberhaupt einen Treffer erzeugt.', oosN: oos.length, gridPoints: points };

  const oOut = pickOutcome(oos, best.targetPct, best.stopPct);
  // Zwei Zahlen mit VERSCHIEDENEN Aufgaben:
  //  - evOosPoint : gleiche Schaetzart wie im Suchteil. NUR damit laesst sich
  //    Ueberanpassung erkennen. (Mein erster Entwurf verglich Punktschaetzung
  //    gegen Wilson-Untergrenze — dabei sieht ALLES ueberangepasst aus, weil
  //    der Unterschied aus der Schaetzart kommt und nicht aus den Daten.)
  //  - eOut.evEur : vorsichtige Schaetzung. Nur die darf ranken und angezeigt
  //    werden.
  const evOosPoint = oOut.n
    ? Math.round(oOut.hit / oOut.n * netEurAtMove(best.targetPct, cfg)
               - oOut.stopped / oOut.n * lossEurAtStop(best.stopPct, cfg)
               - oOut.flat / oOut.n * pickCosts(cfg))
    : null;
  const eOut = pickExpectancy(oOut, best.targetPct, best.stopPct, cfg);
  const drop = best.evIn - (evOosPoint ?? 0);
  /* Wie gross muss der Abstand sein, damit er nicht blosses Rauschen ist?
     Eine feste Euro-Grenze war die falsche Antwort: bei zwoelf Episoden im
     Nachweisteil schwankt der Punktwert allein durch die Stichprobe um weit
     mehr als 40 EUR, und dann sieht JEDES Paar ueberangepasst aus.
     Die Grenze waechst deshalb mit dem Stichprobenrauschen: erst ein Abstand
     ueber 1,5 Standardfehlern gilt als Ueberanpassung. Die feste Zahl bleibt
     als Untergrenze stehen, damit auch bei sehr grossen Stichproben nicht
     jeder Zufallstreffer durchgeht. */
  const pOos = oOut.n ? oOut.hit / oOut.n : 0;
  const spread = netEurAtMove(best.targetPct, cfg) + lossEurAtStop(best.stopPct, cfg);
  const seEur = Math.sqrt(Math.max(0.01, pOos * (1 - pOos)) / Math.max(1, oOut.n)) * spread;
  const overfitLimit = Math.max(GRID.OVERFIT_DROP_EUR, 1.5 * seEur);
  /* Nach bestandener Pruefung wird auf ALLEN Episoden nachgerechnet.
     Warum das kein Schummeln ist: GESUCHT wurde nur auf dem aelteren Teil,
     BESTAETIGT auf dem juengeren. Auswaehlen und Schaetzen sind zwei Schritte;
     erst nach dem zweiten darf die volle Stichprobe fuer die Schaetzung dienen.
     Warum es noetig ist: der Nachweisteil ist nur 30 % gross, seine
     Wilson-Untergrenze entsprechend breit. Ihn gegen die Vollstichproben-
     Schaetzung des Kostenmodell-Paars zu stellen hiess, das gesuchte Paar
     systematisch zu bestrafen — in meinen Testlaeufen hat es NIE gewonnen,
     auch wenn es klar besser war. Ein ueberangepasstes Paar kommt hier nicht
     durch: `evBest` uebernimmt nur, wenn `overfit` falsch ist. */
  const oFull = pickOutcome(eps, best.targetPct, best.stopPct);
  const eFull = pickExpectancy(oFull, best.targetPct, best.stopPct, cfg);
  return {
    available: true, gridPoints: points,
    ...best, oosN: oos.length, oosHit: oOut.hit, evOos: eOut.evEur, evOosPoint,
    evFull: eFull.evEur, fullN: oFull.n, fullHit: oFull.hit,
    medianMinutesFull: oFull.medianMinutes,
    pHitOos: eOut.pHit, medianMinutes: oOut.medianMinutes,
    overfit: drop >= overfitLimit,
    overfitLimit: Math.round(overfitLimit), seEur: Math.round(seEur),
    heatNote: `Gegenbewegung gemessen als MAE-vor-MFE. Fuer Ziele unter dem Hoechststand ist das eine Obergrenze — die vorsichtige Richtung.`,
    drop: Math.round(drop),
    note: drop >= overfitLimit
      ? `Suchteil ${best.evIn} EUR, Nachweisteil ${evOosPoint} EUR bei gleicher Rechenart — der Abstand von ${Math.round(drop)} EUR liegt ueber der Rauschgrenze von ${Math.round(overfitLimit)} EUR und spricht fuer Ueberanpassung. Das Paar wird angezeigt, aber nicht zum Ranken benutzt.`
      : `Suchteil ${best.evIn} EUR, Nachweisteil ${evOosPoint} EUR bei gleicher Rechenart (${oOut.n} unabhaengige Episoden). Der Abstand von ${Math.round(drop)} EUR liegt unter der Rauschgrenze von ${Math.round(overfitLimit)} EUR. Auf allen ${oFull.n} Episoden vorsichtig nachgerechnet: ${eFull.evEur} EUR.`,
  };
}

/* ---------------------------------------------------------------------------
   Auswertung: Situationstypen gegen die wirtschaftliche Schwelle des Nutzers.
   EINE D1-Abfrage, danach nur noch Rechnen. Gruppiert wird nach Situationstyp,
   nicht je Symbol — ein einzelnes Symbol hat nie genug Episoden fuer eine
   belastbare Quote, ein Situationstyp ueber alle Symbole schon.
   ------------------------------------------------------------------------- */
/* v3.24.0 · EIN Helfer fuer alle Zahlen, die von aussen kommen.
   Grund: `Number(null)` und `Number('')` sind 0, nicht NaN. Eine Pruefung mit
   `Number.isFinite(Number(x))` haelt einen NICHT gesetzten Suchparameter
   deshalb fuer eine gueltige Null. Genau das ist dreimal passiert:
     - spreadPct/feePct → Kryptokosten liefen mit 0,80 % statt 0,40 % Rundlauf
     - netEur           → das Mindestziel fiel von 2,04 % auf 0,38 %, also auf
                          die reine Kostenschwelle, und der zulaessige Stop
                          gleich mit. Alles darunter war damit falsch.
   Die Unit-Tests haben das NICHT gefunden, weil sie `requiredMovePct` direkt
   geprueft haben und nie den Endpunkt OHNE Parameter. Die Naht zwischen
   Parameterschicht und Rechnung war ungetestet — dort sass der Fehler.
   Regel ab hier: Zahlen von aussen ausschliesslich ueber `posNum`. */
const posNum = (v, fallback = null) => {
  const n = Number(v);
  return (v !== null && v !== '' && Number.isFinite(n) && n > 0) ? n : fallback;
};

async function topPicks(env, opts = {}) {
  const netEur = posNum(opts.netEur, PICK.DEFAULT_NET_EUR);
  /* v3.23.0 · Zwei Anlageklassen, EINE Auswertung, aber ZWEI Kostenmodelle.
     Bewusst kein zweiter Code-Pfad: die Wahrscheinlichkeitsrechnung ist
     identisch, nur die Kostenfunktion unterscheidet sich. Ein Duplikat waere
     die naechste Stelle, an der zwei Wahrheiten auseinanderlaufen. */
  const asset = opts.asset === 'coin' ? 'coin' : 'stock';
  const coin = asset === 'coin';
  const baseCost = coin ? COIN_COST : PICK_COST;
  const override = { ...(opts.cost || {}) };
  if (coin) {
    /* Spread und Gebuehr sind bei Krypto die ganze Kostenrechnung, deshalb von
       aussen setzbar (Gebuehrenstufe, gemessener Spread).
       v3.24.0 · BUGFIX. Hier stand `Number.isFinite(Number(x))`. Da ein nicht
       gesetzter Suchparameter `null` ist und `Number(null)` gleich 0 ergibt,
       hat diese Pruefung IMMER zugeschlagen und beide Werte auf 0 gesetzt.
       `pickCosts` hat daraufhin — korrekt — die pessimistischen Rueckfallwerte
       genommen, und die Kryptorechnung lief still mit 0,80 % Rundlauf statt
       0,40 %. Die noetige Zielweite war damit fast doppelt so hoch wie richtig.
       Derselbe Fallstrick, den ich eine Ebene tiefer in v3.23.0 schon behoben
       hatte — und den ich hier uebersehen habe. Es gilt ueberall dieselbe
       Regel: nur ein POSITIVER Zahlenwert zaehlt als Angabe. */
    const sp = posNum(opts.spreadPct), fp = posNum(opts.feePct);
    if (sp != null) override.spreadPct = sp;
    if (fp != null) override.feePct = fp;
  }
  const cfg = { ...baseCost, ...override };
  const targetPct = requiredMovePct(netEur, cfg);
  // Der maximal zulaessige Stop folgt aus dem Ziel, nicht umgekehrt.
  const maxStopPct = targetPct / PICK.MIN_REWARD_RISK;
  const wanted = posNum(Math.abs(Number(opts.stopPct) || 0));
  const stopPct = -Math.min(maxStopPct, wanted ?? maxStopPct);
  const base = {
    configured: true, version: APP_VERSION, asset,
    costKind: cfg.kind, roundTripPct: r2(roundTripPct(cfg)),
    horizonMin: Math.round(LEARN_HORIZON_MS / 60_000),
    windowDays: Math.round(PICK.WINDOW_MS / 86_400_000),
    cost: cfg, netEurTarget: netEur, stopPct,
    targetPct: r2(targetPct),
    winEur: Math.round(netEurAtMove(targetPct, cfg)),
    lossEur: Math.round(lossEurAtStop(stopPct, cfg)),
    legacyWinPct: LEGACY_WIN_PCT, reachRefPct: PICK_REACH_PCT,
    maxStopPct: r2(maxStopPct), minRewardRisk: PICK.MIN_REWARD_RISK,
    breakEvenHitPct: Math.round(breakEvenHitRate(targetPct, stopPct, cfg) * 100),
    minEvidence: PICK.MIN_EVIDENCE, thinEvidence: PICK.THIN_EVIDENCE,
    maxTradesPerDay: tempoCap(asset),
    costLoadAtMin: costLoadPct(targetPct, cfg),
  };
  if (!env?.DB) return { ...base, state: 'nodb', situations: [], picks: [], note: 'Ohne D1 gibt es keine aufgezeichneten Ergebnisse. Es wird bewusst nichts geschaetzt.' };
  await ensureD1Schema(env);

  const since = Date.now() - PICK.WINDOW_MS;
  const sources = coin ? ['Bitpanda Fusion'] : ['Twelve Data', 'Tiingo IEX'];
  const srcHolder = sources.map(() => '?').join(',');
  const rows = (await env.DB.prepare(
    `SELECT symbol,ts,bucket5,max_pct,min_pct,success_ts,reach_ts,mae_pre,atr_pct,score,payload
       FROM market_snapshots
      WHERE resolved_ts IS NOT NULL AND asset_type=?
        AND source IN (${srcHolder}) AND ts>=?
      ORDER BY ts DESC LIMIT ?`).bind(asset, ...sources, since, PICK.ROW_LIMIT).all()).results || [];

  // Episoden statt Snapshots — dieselbe Regel wie in Modul 0 und im Musterlabor.
  const episodes = collapseEpisodes(rows);
  /* Handelstage im Fenster: die Zahl, gegen die Haeufigkeit gerechnet wird.
     Kalendertage waeren falsch — an Wochenenden zeichnet die App nichts auf. */
  const tradingDays = new Set(episodes.map((e) =>
    new Date(Number(e.ts)).toISOString().slice(0, 10))).size;
  const bySituation = new Map();
  let withSituation = 0;
  for (const e of episodes) {
    let situation = null;
    try { situation = JSON.parse(e.payload || '{}').situation || null; } catch { situation = null; }
    if (!situation) continue;
    withSituation++;
    const key = String(situation).toUpperCase();
    (bySituation.get(key) ?? bySituation.set(key, []).get(key)).push(e);
  }

  const situations = [...bySituation.entries()].map(([situation, eps]) => {
    const outcome = pickOutcome(eps, targetPct, stopPct);
    const exp = pickExpectancy(outcome, targetPct, stopPct, cfg);
    const heat = heatProfile(eps, targetPct);
    const diag = pickVerdict({ n: outcome.n, hit: outcome.hit, heat, targetPct,
      maxStopPct, minSample: PICK.MIN_EVIDENCE });
    const grid = outcome.n >= PICK.MIN_EVIDENCE ? optimizeGrid(eps, targetPct, cfg)
      : { available: false, reason: 'zu wenige Episoden fuer eine Rastersuche' };
    /* Der Tempowert haengt am PLAN, der auch gehandelt wuerde — also am
       bestaetigten Rasterpaar, wenn es eines gibt, sonst am Kostenmodell. */
    const usable = grid.available && !grid.overfit && (grid.evFull ?? -1e9) > (exp.evEur ?? -1e9);
    const planTarget = usable ? grid.targetPct : r2(targetPct);
    const planEv = usable ? grid.evFull : exp.evEur;
    const planMin = usable ? (grid.medianMinutesFull ?? grid.medianMinutes) : outcome.medianMinutes;
    const tempo = tempoOf(eps, tradingDays, planEv, planMin, asset);
    // Gegenprobe an der alten 5-%-Schwelle. Sie steht bewusst DANEBEN, damit
    // der Unterschied sichtbar ist, statt behauptet werden zu muessen.
    const legacy = pickOutcome(eps, LEGACY_WIN_PCT, stopPct);
    const tier = evidenceTier(outcome.n);
    return {
      situation, tier, ...outcome, ...exp, ...heat, ...diag, grid, ...tempo,
      costLoadPct: costLoadPct(planTarget, cfg),
      /* Die Rangzahl ist der NACHWEIS-Wert, nicht der Suchwert. Ein Paar, das
         nur im Suchteil gut aussah, darf die Liste nicht anfuehren. */
      evBest: grid.available && !grid.overfit ? grid.evFull : null,
      legacyHit: legacy.hit, legacyPct: outcome.n ? Math.round(legacy.hit / outcome.n * 100) : null,
      symbols: new Set(eps.map((x) => String(x.symbol || '').toUpperCase())).size,
    };
  }).sort((a, b) => (b.evPerDay ?? -1e9) - (a.evPerDay ?? -1e9)
                 || (Math.max(b.evEur ?? -1e9, b.evBest ?? -1e9)) - (Math.max(a.evEur ?? -1e9, a.evBest ?? -1e9)));

  const evidence = new Map(situations.map((s) => [s.situation, s]));
  /* Gemessener Spread aus den Aufzeichnungen — ab v3.23.0 mitgeschrieben.
     Solange er fehlt, steht die Annahme aus dem Kostenmodell da UND der Hinweis
     darauf. Eine Annahme als Messung auszugeben waere hier besonders teuer:
     bei Krypto ist der Spread die halbe Kostenrechnung. */
  const spreads = [];
  for (const e of episodes) {
    try { const v = Number(JSON.parse(e.payload || '{}').spreadPct);
      if (Number.isFinite(v) && v >= 0) spreads.push(v * (v < 0.05 ? 100 : 1)); } catch { /* ignorieren */ }
  }
  spreads.sort((a, b) => a - b);
  const spreadMeasured = spreads.length >= 20 ? r2(spreads[Math.floor(spreads.length / 2)]) : null;

  // Lebende Kandidaten aus dem persistierten Radar mit der Beleglage verbinden.
  /* Lebende Kandidaten: bei Aktien aus dem persistierten IEX-Radar, bei Krypto
     aus dem letzten Scan-Snapshot. Fehlt er, bleibt die Liste leer — die
     Auswertung der Situationstypen steht trotzdem. */
  const radar = coin ? await readCoinLive(env) : await readPersistedIexRadar(env);
  const live = (radar?.rows || []).slice(0, 40);
  const picks = rankPicks(live.map((r) => {
    const key = String(r.situation || 'WATCH').toUpperCase();
    const ev = evidence.get(key);
    const tier = ev ? ev.tier : 'unbelegt';
    /* Wenn die Rastersuche ein Paar gefunden hat, das den Nachweisteil
       ueberstanden hat, ist DAS die ehrlichere Zahl — sie beschreibt einen
       Plan, den man wirklich handeln koennte. Ueberangepasste Paare zaehlen
       ausdruecklich nicht mit (evBest ist dann null). */
    /* Es gibt zwei moegliche Plaene: den aus dem Kostenmodell abgeleiteten und
       den von der Rastersuche gefundenen. Genommen wird der BESSERE — aber der
       gefundene nur, wenn er den Nachweisteil ueberstanden hat. Ein Plan, der
       nur im Suchteil gut aussah, darf weder ranken noch angezeigt werden. */
    const evFix = ev && tier !== 'unbelegt' ? ev.evEur : null;
    const evGrid = ev && tier !== 'unbelegt' ? ev.evBest : null;
    const useGrid = evGrid != null && (evFix == null || evGrid > evFix);
    const evEur = useGrid ? evGrid : evFix;
    const plan = useGrid
      ? { targetPct: ev.grid.targetPct, stopPct: ev.grid.stopPct,
          source: `Rastersuche über ${ev.grid.gridPoints} Ziel/Stop-Paare, im Nachweisteil über ${ev.grid.oosN} Episoden bestätigt` }
      : { targetPct: r2(targetPct), stopPct: r2(stopPct), source: 'Kostenmodell' };
    return {
      symbol: String(r.symbol || '').toUpperCase(),
      situation: key, lifecycle: r.lifecycle || 'WATCH',
      liveScore: Number(r.situationScore ?? r.score ?? 0),
      movePct: r.movePct ?? null, speedPct: r.speedPct ?? null, spreadPct: r.spreadPct ?? null,
      reasons: Array.isArray(r.reasons) ? r.reasons.slice(0, 3) : [],
      tier, evEur,
      n: ev?.n ?? 0, pHit: ev?.pHit ?? null, pStop: ev?.pStop ?? null,
      medianMinutes: ev?.grid?.medianMinutes ?? ev?.medianMinutes ?? null, ambiguous: ev?.ambiguous ?? 0,
      verdict: ev?.verdict ?? 'zu wenige Faelle', why: ev?.why ?? '', plan,
      evPerDay: tier === 'unbelegt' ? null : (ev?.evPerDay ?? null),
      evPerHour: tier === 'unbelegt' ? null : (ev?.evPerHour ?? null),
      perDay: ev?.perDay ?? null, costLoadPct: ev?.costLoadPct ?? null,
      heatMedian: ev?.heatMedian ?? null, stopFor80: ev?.stopFor80 ?? null,
      rank: pickTier(tier, evEur),
      buyWeight: 0,
    };
  }));

  const belegt = situations.filter((s) => s.tier === 'belegt');
  const positiv = belegt.filter((s) => (s.evEur ?? -1) > 0);
  const note = !episodes.length
    ? 'Noch keine aufgeloesten Aufzeichnungen im Fenster. Die Auswertung braucht Laufzeit, sie laesst sich nicht rueckwirkend erzeugen.'
    : !withSituation
    ? 'Aufzeichnungen vorhanden, aber ohne Situationstyp. Der Typ wird erst seit v3.17.0 mitgeschrieben — aeltere Zeilen kennen ihn nicht.'
    : !belegt.length
    ? `Kein Situationstyp hat bisher ${PICK.MIN_EVIDENCE} unabhaengige Episoden. Angezeigt wird der Zwischenstand, geurteilt wird nichts.`
    : positiv.length
    ? `${positiv.length} von ${belegt.length} belegten Situationstypen tragen bei ${r1(targetPct)} % Zielweite einen positiven Erwartungswert.`
    : `KEIN belegter Situationstyp traegt bei ${r1(targetPct)} % Zielweite einen positiven Erwartungswert. Das ist ein Ergebnis, kein Fehler: die aufgezeichneten Setups haben die Kosten bisher nicht verdient.`;
  const best = situations.find((x) => (x.evPerDay ?? -1e9) > 0);
  const tempoNote = best
    ? `Schnellster belegter Weg derzeit: ${best.situation} mit rund ${best.evPerDay} EUR je Handelstag (${best.perDayUsed ?? best.perDay} Gelegenheiten, ~${best.medianMinutes ?? '?'} Min. Kapitalbindung).`
    : 'Kein Situationstyp traegt derzeit einen positiven Ertrag je Handelstag.';

  return {
    ...base, state: episodes.length ? 'ok' : 'empty',
    spreadAssumedPct: coin ? r2(cfg.spreadPct) : null,
    spreadMeasuredPct: coin ? spreadMeasured : null,
    spreadNote: !coin ? null
      : spreadMeasured == null
      ? `Der Spread wird seit v3.23.0 mitgeschrieben, aber noch nicht in ausreichender Zahl. Gerechnet wird mit der Annahme ${r2(cfg.spreadPct)} % — pruefe sie an der Spread-Anzeige im Coin-Detail.`
      : `Gemessener Median-Spread ${spreadMeasured} % ueber ${spreads.length} Aufzeichnungen. Gerechnet wird mit ${r2(cfg.spreadPct)} %.`,
    rowsScanned: rows.length, rowsCapped: rows.length >= PICK.ROW_LIMIT,
    episodes: episodes.length, withSituation, tradingDays,
    situations, picks, radarTs: radar?.ts || null, note, tempoNote,
  };
}

/* ============================================================================
   v3.28.0 · HANDELSTAGEBUCH — der Abstand zwischen Plan und Wirklichkeit
   ----------------------------------------------------------------------------
   DAS GRÖSSTE LOCH DER GANZEN APP, und es war nie im Code: sie misst den MARKT,
   nicht den HÄNDLER. Jede Lernschicht seit v3.20.0 rechnet mit einem Phantom,
   das zum aufgezeichneten Preis kauft und exakt am Ziel verkauft.

   Der Abstand zwischen diesem Phantom und einem echten Menschen ist in aller
   Regel groesser als der ganze Vorteil, den die App zu vermessen versucht:
   Bei 1,02 % Stopweite sind zwei Zehntelprozent Ausfuehrungsabweichung bereits
   ein Fuenftel des Budgets. Solange das nicht gemessen wird, kann die App
   beliebig recht haben und der Kontostand trotzdem sinken.

   WAS HIER AUFGEZEICHNET WIRD: was die App vorgeschlagen hat (Soll) und was
   tatsaechlich passiert ist (Ist) — Einstiegskurs, Ausstiegskurs, Zeiten.
   Daraus folgt die einzige Zahl, die den Unterschied wirklich beziffert:
   die Abweichung in Euro, je Trade und in Summe.

   WAS HIER NICHT PASSIERT: keine Bewertung, keine Note, keine automatische
   Aenderung an irgendeiner Regel. Ein Tagebuch, das seinen Fuehrer belehrt,
   wird nicht gefuehrt.
   ========================================================================== */
const JOURNAL = { MAX_ROWS: 500, WINDOW_MS: 365 * 24 * 60 * 60_000 };

async function journalSchema(env) {
  await ensureD1Schema(env);
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS trades(
    id TEXT PRIMARY KEY,
    ts INTEGER NOT NULL,
    symbol TEXT NOT NULL,
    asset TEXT NOT NULL DEFAULT 'stock',
    origin TEXT,
    plan_entry REAL, plan_target REAL, plan_stop REAL,
    plan_notional REAL, plan_net_eur REAL,
    fill_entry REAL, fill_entry_ts INTEGER,
    fill_exit REAL, fill_exit_ts INTEGER,
    real_net_eur REAL,
    skipped INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    updated_ts INTEGER NOT NULL
  )`).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_trades_ts ON trades(ts DESC)').run();
}

/** Rechnet Soll und Ist eines Eintrags gegeneinander. Reine Funktion. */
function journalRow(t) {
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const planEntry = num(t.plan_entry), planTarget = num(t.plan_target), planStop = num(t.plan_stop);
  const fillEntry = num(t.fill_entry), fillExit = num(t.fill_exit);
  const notional = num(t.plan_notional) || PICK_COST.notionalEur;

  // Abweichung beim EINSTIEG: teurer gekauft als geplant = negativ fuer dich.
  const slipEntryPct = (planEntry && fillEntry) ? (fillEntry - planEntry) / planEntry * 100 : null;
  // Abweichung beim AUSSTIEG gegen das geplante Ziel.
  const slipExitPct = (planTarget && fillExit) ? (fillExit - planTarget) / planTarget * 100 : null;

  const realMovePct = (fillEntry && fillExit) ? (fillExit - fillEntry) / fillEntry * 100 : null;
  const planMovePct = (planEntry && planTarget) ? (planTarget - planEntry) / planEntry * 100 : null;

  const cfg = { ...PICK_COST, notionalEur: notional };
  const realNet = num(t.real_net_eur) ?? (realMovePct != null ? Math.round(netEurAtMove(realMovePct, cfg)) : null);
  const planNet = num(t.plan_net_eur) ?? (planMovePct != null ? Math.round(netEurAtMove(planMovePct, cfg)) : null);

  return {
    id: t.id, ts: Number(t.ts), symbol: String(t.symbol || '').toUpperCase(),
    asset: t.asset || 'stock', origin: t.origin || null,
    skipped: !!Number(t.skipped), note: t.note || null,
    planEntry, planTarget, planStop, notional,
    fillEntry, fillExit,
    fillEntryTs: num(t.fill_entry_ts), fillExitTs: num(t.fill_exit_ts),
    planMovePct: planMovePct == null ? null : r2(planMovePct),
    realMovePct: realMovePct == null ? null : r2(realMovePct),
    slipEntryPct: slipEntryPct == null ? null : r2(slipEntryPct),
    slipExitPct: slipExitPct == null ? null : r2(slipExitPct),
    planNet, realNet,
    deltaEur: (planNet != null && realNet != null) ? Math.round(realNet - planNet) : null,
    holdMin: (num(t.fill_entry_ts) && num(t.fill_exit_ts))
      ? Math.round((num(t.fill_exit_ts) - num(t.fill_entry_ts)) / 60_000) : null,
    state: Number(t.skipped) ? 'uebersprungen'
      : (fillEntry && fillExit) ? 'abgeschlossen'
      : fillEntry ? 'offen' : 'geplant',
  };
}

/** Zusammenfassung. Bewusst OHNE Note: die Zahlen sprechen fuer sich. */
function journalSummary(rows) {
  const done = rows.filter((r) => r.state === 'abgeschlossen');
  const withSlip = done.filter((r) => r.slipEntryPct != null);
  const med = (a) => { const s = [...a].sort((x, y) => x - y);
    return s.length ? s[Math.floor(s.length / 2)] : null; };
  const slipMed = withSlip.length ? med(withSlip.map((r) => r.slipEntryPct)) : null;
  const planSum = done.reduce((a, r) => a + (r.planNet ?? 0), 0);
  const realSum = done.reduce((a, r) => a + (r.realNet ?? 0), 0);
  return {
    total: rows.length, done: done.length,
    skipped: rows.filter((r) => r.skipped).length,
    open: rows.filter((r) => r.state === 'offen').length,
    planSumEur: Math.round(planSum), realSumEur: Math.round(realSum),
    deltaSumEur: Math.round(realSum - planSum),
    slipEntryMedianPct: slipMed == null ? null : r2(slipMed),
    slipEntryN: withSlip.length,
    winners: done.filter((r) => (r.realNet ?? 0) > 0).length,
    holdMedianMin: med(done.map((r) => r.holdMin).filter(Number.isFinite)),
    /* Die eigentliche Aussage: was kostet der Abstand zwischen App und
       Wirklichkeit, umgerechnet auf einen Trade? */
    costPerTradeEur: done.length ? Math.round((realSum - planSum) / done.length) : null,
  };
}

async function journalList(env) {
  await journalSchema(env);
  const res = (await env.DB.prepare(
    `SELECT * FROM trades WHERE ts>=? ORDER BY ts DESC LIMIT ?`)
    .bind(Date.now() - JOURNAL.WINDOW_MS, JOURNAL.MAX_ROWS).all()).results || [];
  const rows = res.map(journalRow);
  const summary = journalSummary(rows);
  return {
    configured: true, state: 'ok', version: APP_VERSION, rows, summary, buyWeight: 0,
    note: !rows.length
      ? 'Noch nichts eingetragen. Ohne Ist-Werte misst jede Auswertung dieser App einen Händler, den es nicht gibt.'
      : summary.done < 10
      ? `${summary.done} abgeschlossene Trades. Ab etwa zehn wird die Abweichung zwischen Plan und Wirklichkeit ablesbar.`
      : summary.costPerTradeEur != null && summary.costPerTradeEur < 0
      ? `Der Abstand zwischen Plan und Wirklichkeit kostet im Schnitt ${Math.abs(summary.costPerTradeEur)} EUR je Trade. Diese Zahl gehört in jede Erwartungsrechnung.`
      : 'Die Ausführung liegt im Schnitt nicht unter dem Plan.',
  };
}

async function journalWrite(env, body) {
  await journalSchema(env);
  const now = Date.now();
  const id = String(body?.id || `t_${now}_${Math.random().toString(36).slice(2, 8)}`);
  const num = (v) => (Number.isFinite(Number(v)) && Number(v) !== 0 ? Number(v) : null);

  if (body?.action === 'delete') {
    await env.DB.prepare('DELETE FROM trades WHERE id=?').bind(id).run();
    return { ok: true, deleted: id };
  }
  const sym = String(body?.symbol || '').trim().toUpperCase();
  if (!sym) return { ok: false, error: 'Symbol fehlt' };

  const prev = await env.DB.prepare('SELECT * FROM trades WHERE id=? LIMIT 1').bind(id).first();
  const merged = {
    id, ts: Number(prev?.ts) || now, symbol: sym,
    asset: body?.asset === 'coin' ? 'coin' : (prev?.asset || 'stock'),
    origin: body?.origin ?? prev?.origin ?? null,
    plan_entry: num(body?.planEntry) ?? prev?.plan_entry ?? null,
    plan_target: num(body?.planTarget) ?? prev?.plan_target ?? null,
    plan_stop: num(body?.planStop) ?? prev?.plan_stop ?? null,
    plan_notional: num(body?.notional) ?? prev?.plan_notional ?? null,
    plan_net_eur: num(body?.planNet) ?? prev?.plan_net_eur ?? null,
    fill_entry: num(body?.fillEntry) ?? prev?.fill_entry ?? null,
    fill_entry_ts: num(body?.fillEntryTs) ?? prev?.fill_entry_ts ?? (num(body?.fillEntry) ? now : null),
    fill_exit: num(body?.fillExit) ?? prev?.fill_exit ?? null,
    fill_exit_ts: num(body?.fillExitTs) ?? prev?.fill_exit_ts ?? (num(body?.fillExit) ? now : null),
    real_net_eur: num(body?.realNet) ?? prev?.real_net_eur ?? null,
    skipped: body?.skipped != null ? (body.skipped ? 1 : 0) : (Number(prev?.skipped) || 0),
    note: body?.note ?? prev?.note ?? null,
    updated_ts: now,
  };
  await env.DB.prepare(
    `INSERT INTO trades(id,ts,symbol,asset,origin,plan_entry,plan_target,plan_stop,plan_notional,
       plan_net_eur,fill_entry,fill_entry_ts,fill_exit,fill_exit_ts,real_net_eur,skipped,note,updated_ts)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET symbol=excluded.symbol,asset=excluded.asset,origin=excluded.origin,
       plan_entry=excluded.plan_entry,plan_target=excluded.plan_target,plan_stop=excluded.plan_stop,
       plan_notional=excluded.plan_notional,plan_net_eur=excluded.plan_net_eur,
       fill_entry=excluded.fill_entry,fill_entry_ts=excluded.fill_entry_ts,
       fill_exit=excluded.fill_exit,fill_exit_ts=excluded.fill_exit_ts,
       real_net_eur=excluded.real_net_eur,skipped=excluded.skipped,note=excluded.note,
       updated_ts=excluded.updated_ts`)
    .bind(merged.id, merged.ts, merged.symbol, merged.asset, merged.origin,
      merged.plan_entry, merged.plan_target, merged.plan_stop, merged.plan_notional,
      merged.plan_net_eur, merged.fill_entry, merged.fill_entry_ts, merged.fill_exit,
      merged.fill_exit_ts, merged.real_net_eur, merged.skipped, merged.note, merged.updated_ts).run();
  return { ok: true, id, row: journalRow(merged) };
}

/* ============================================================================
   v3.28.0 · „NIMMT FAHRT AUF" — ein Name, oder Schweigen
   ----------------------------------------------------------------------------
   Der Nutzer braucht keine Liste. Er braucht EINEN Namen, wenn wirklich etwas
   losgeht, und sonst Ruhe. Eine Kachel, die immer etwas anzeigt, ist eine
   Kachel, die man nach zwei Wochen nicht mehr liest.

   WAS DIESE ERKENNUNG NICHT KANN — und was sie deshalb nicht behauptet:
   Die App hat KEINE Nachrichtenquelle. Sie kann nicht wissen, ob eine Meldung
   der Ausloeser war. Was sie messen kann, ist der FINGERABDRUCK einer
   Nachricht: eine Eroeffnungsluecke, ein Umsatzstoss weit ueber dem Ueblichen,
   und ein frischer Zustandswechsel. Das ist ein Hinweis auf einen Ausloeser,
   nicht seine Identifikation. Genau so steht es auch in der Anzeige.
   Ein Quartalstermin in der Naehe ist der einzige harte Beleg, den die App hat
   — der kommt aus dem Terminkalender und wird getrennt ausgewiesen.

   WARUM DIE HUERDEN SO HOCH SIND:
   Bei 10.000 EUR Einsatz und 2,04 % Zielweite darf der Stop hoechstens 1,02 %
   entfernt liegen. Ein Spread von 0,3 % frisst davon fast ein Drittel. Ein
   Titel, der schon 9 % gelaufen ist, hat sein Ziel hinter sich. Deshalb wird
   hier nicht "auffaellig" gesucht, sondern "auffaellig UND noch handelbar".
   ========================================================================== */
const RIDE = {
  MIN_VOL_PULSE: 60,      // % Umsatzstoss gegen die Vorperiode
  MIN_GAP_PCT: 1.5,       // Eroeffnungsluecke als Nachrichten-Fingerabdruck
  MAX_SPREAD_SHARE: 0.30, // Spread darf hoechstens 30 % des Stopbudgets fressen
  MAX_RANGE_POS: 0.94,    // nicht am absoluten Tageshoch hinterherlaufen
  MIN_RUNWAY_MULT: 1.0,   // Restweg bis zum Tageshoch >= Zielweite
  EARN_WINDOW_DAYS: 3,    // Quartalstermin in diesem Fenster gilt als Beleg
  RISK_BUDGET_PCT: 2.0,   // Anteil des Kapitals, der je Trade riskiert wird
  MAX_NOTIONAL_MULT: 2.0, // hoechstens doppelte Grundposition
};

/** Positionsgroesse aus dem RISIKO, nicht aus der Ueberzeugung.
 *  Das ist der einzige ehrliche Weg zu "hoehere Summe bei gutem Setup": eine
 *  groessere Position ist erlaubt, WEIL der Stop enger sitzt — nicht, weil das
 *  Setup sich besser anfuehlt. Der Euro-Verlust am Stop bleibt konstant. */
function rideSize(stopPct, cfg) {
  const c = pickCfg(cfg);
  const budget = c.notionalEur * (RIDE.RISK_BUDGET_PCT / 100);
  const stop = Math.abs(Number(stopPct) || 0);
  if (!(stop > 0)) return null;
  /* Das Budget muss die KOSTEN einschliessen, sonst ist es keine Obergrenze.
     Mein erster Entwurf rechnete nur den Kursverlust: 200 EUR Budget ergaben
     eine Position, deren Stop tatsaechlich 252 EUR gekostet haette — die
     Gebuehren fielen unter den Tisch, ausgerechnet an der Stelle, an der die
     Position groesser werden soll.
     Kosten sind ein fester plus ein anteiliger Block:
       verlust(N) = N*stop/100 + fix + N*rate  =  budget
       -> N = (budget - fix) / (stop/100 + rate)                            */
  const fix = c.kind === 'proportional' ? 0 : (Number(c.orderFeeEur) || 0) * 2;
  const rate = (c.kind === 'proportional'
    ? (Number(c.feePct) || 0) * 2 + (Number(c.spreadPct) || 0)
    : (Number(c.frictionPct) || 0)) / 100;
  const raw = Math.max(0, (budget - fix) / (stop / 100 + rate));
  const notional = Math.min(raw, c.notionalEur * RIDE.MAX_NOTIONAL_MULT);
  const scaled = { ...c, notionalEur: Math.round(notional / 100) * 100 };
  return {
    notionalEur: scaled.notionalEur,
    // Der VOLLE Verlust am Stop, Gebuehren eingerechnet. Genau das ist das Budget.
    riskEur: Math.round(lossEurAtStop(-stop, scaled)),
    priceRiskEur: Math.round(scaled.notionalEur * (stop / 100)),
    budgetEur: Math.round(budget),
    capped: raw > c.notionalEur * RIDE.MAX_NOTIONAL_MULT,
    costLoadPct: costLoadPct(Math.abs(stopPct) * ECON_MIN_REWARD_RISK, scaled),
    cfg: scaled,
  };
}

/** Prueft EINEN Kandidaten gegen alle Huerden und benennt die, an denen er
 *  scheitert. Das Ausweisen der Gruende ist kein Beiwerk: eine Kachel, die nur
 *  "nichts gefunden" sagt, laesst offen ob sie funktioniert. */
function rideCheck(r, ctx) {
  const { targetPct, maxStopPct, earnDays } = ctx;
  const fail = [];
  /* FUENFTES Mal derselbe Fallstrick — und diesmal hat ihn der eigene Test
     gefangen: `Number(null)` und `Number('')` sind 0, nicht NaN. Ein FEHLENDER
     Spread waere damit als 0 % durchgegangen, also als bestmoeglicher Wert,
     ausgerechnet an der Huerde, die vor unhandelbaren Titeln schuetzt.
     `feld()` behandelt fehlende Werte als fehlend. Nirgends `Number(x)` direkt. */
  const feld = (v) => { if (v === null || v === undefined || v === '') return NaN;
    const n = Number(v); return Number.isFinite(n) ? n : NaN; };
  const move = feld(r.movePct);
  const gap = feld(r.gapPct);
  const pulse = feld(r.volPulsePct);
  const spread = feld(r.spreadPct);
  const pos = feld(r.rangePosition);

  if (!r.ignition && r.lifecycle !== 'IGNITION') fail.push('kein frischer Zustandswechsel');
  if (!(pulse >= RIDE.MIN_VOL_PULSE)) fail.push(`Umsatzstoss ${Number.isFinite(pulse) ? r2(pulse) + ' %' : 'unbekannt'} unter ${RIDE.MIN_VOL_PULSE} %`);

  // Katalysator: Quartalstermin (harter Beleg) ODER Eroeffnungsluecke
  // (Fingerabdruck). Fehlt beides, bewegt sich der Titel ohne erkennbaren
  // Grund — dann fehlt der Antrieb, der eine groessere Position rechtfertigt.
  const earnHit = Number.isFinite(earnDays) && Math.abs(earnDays) <= RIDE.EARN_WINDOW_DAYS;
  const gapHit = Number.isFinite(gap) && Math.abs(gap) >= RIDE.MIN_GAP_PCT;
  if (!earnHit && !gapHit) fail.push('kein Quartalstermin und keine Eroeffnungsluecke');

  // Handelbarkeit: der Spread darf das Stopbudget nicht auffressen.
  const spreadCap = maxStopPct * RIDE.MAX_SPREAD_SHARE;
  if (!Number.isFinite(spread)) fail.push('Spread unbekannt');
  else if (spread > spreadCap) fail.push(`Spread ${r2(spread)} % ueber der Grenze von ${r2(spreadCap)} %`);

  // Restweg: wer schon oben steht, hat sein Ziel hinter sich.
  if (Number.isFinite(pos)) {
    if (pos > RIDE.MAX_RANGE_POS) fail.push(`bereits bei ${Math.round(pos * 100)} % der Tagesspanne`);
    const runway = Number.isFinite(feld(r.rangePct)) ? feld(r.rangePct) * (1 - pos) : null;
    if (runway != null && runway < targetPct * RIDE.MIN_RUNWAY_MULT)
      fail.push(`Restweg zum Tageshoch ${r2(runway)} % unter der Zielweite ${r2(targetPct)} %`);
  } else fail.push('Lage in der Tagesspanne unbekannt');

  if (Number.isFinite(move) && move < 0) fail.push('Tagesbilanz negativ');

  return {
    ok: !fail.length, fail,
    catalyst: earnHit ? 'Quartalstermin' : gapHit ? 'Eroeffnungsluecke' : null,
    earnDays: Number.isFinite(earnDays) ? earnDays : null,
    gapPct: Number.isFinite(gap) ? r2(gap) : null,
    volPulsePct: Number.isFinite(pulse) ? r2(pulse) : null,
    spreadPct: Number.isFinite(spread) ? r2(spread) : null,
  };
}

async function rideNow(env, opts = {}) {
  const netEur = posNum(opts.netEur, PICK.DEFAULT_NET_EUR);
  const asset = opts.asset === 'coin' ? 'coin' : 'stock';
  const cfg = pickCfg(asset === 'coin' ? COIN_COST : PICK_COST);
  const targetPct = requiredMovePct(netEur, cfg);
  const maxStopPct = targetPct / ECON_MIN_REWARD_RISK;
  const base = {
    configured: true, version: APP_VERSION, asset,
    targetPct: r2(targetPct), maxStopPct: r2(maxStopPct),
    rules: RIDE, buyWeight: 0,
    noNewsFeed: true,
    disclaimer: 'Diese App hat keine Nachrichtenquelle. Erkannt wird der FINGERABDRUCK eines Ausloesers (Luecke, Umsatzstoss, Zustandswechsel), nicht der Ausloeser selbst.',
  };
  const radar = asset === 'coin' ? await readCoinLive(env) : await readPersistedIexRadar(env);
  if (!radar?.rows?.length)
    return { ...base, state: 'empty', hit: null, checked: 0, near: [],
      note: 'Kein aktueller Radar-Stand. Ohne ihn wird bewusst nichts gemeldet.' };

  // Quartalstermine nur fuer Aktien und nur, wenn der Kalender etwas liefert.
  let earnMap = new Map();
  if (asset === 'stock') {
    try {
      const e = await earningsCalendar(env);
      for (const x of [...(e?.manual || []), ...(e?.auto || [])]) {
        const sym = String(x.symbol || '').toUpperCase();
        const d = Date.parse(x.date || x.reportDate || '');
        if (sym && Number.isFinite(d)) {
          const days = Math.round((d - Date.now()) / 86_400_000);
          if (!earnMap.has(sym) || Math.abs(days) < Math.abs(earnMap.get(sym))) earnMap.set(sym, days);
        }
      }
    } catch { /* Kalender fehlt -> earnHit bleibt false, fail-closed */ }
  }

  const ctx = { targetPct, maxStopPct };
  const scored = radar.rows.map((r) => {
    const sym = String(r.symbol || '').toUpperCase();
    const chk = rideCheck(r, { ...ctx, earnDays: earnMap.get(sym) });
    return { symbol: sym, situation: r.situation || r.situationType || 'WATCH',
      lifecycle: r.lifecycle || null, score: Number(r.situationScore ?? r.score ?? 0),
      movePct: Number.isFinite(Number(r.movePct)) ? r2(Number(r.movePct)) : null,
      speedPct: Number.isFinite(Number(r.speedPct)) ? r2(Number(r.speedPct)) : null,
      rangePosition: Number.isFinite(Number(r.rangePosition)) ? r2(Number(r.rangePosition)) : null,
      reasons: Array.isArray(r.reasons) ? r.reasons.slice(0, 3) : [], ...chk };
  });

  const passed = scored.filter((x) => x.ok).sort((a, b) => b.score - a.score);
  const hit = passed[0] || null;
  const size = hit ? rideSize(maxStopPct, cfg) : null;

  /* Die knappsten Verfehlungen werden gezeigt. Eine Kachel, die nur schweigt,
     laesst offen, ob sie noch arbeitet — und ob die Huerden sinnvoll stehen. */
  const near = scored.filter((x) => !x.ok && x.fail.length <= 2)
    .sort((a, b) => a.fail.length - b.fail.length || b.score - a.score)
    .slice(0, 3)
    .map((x) => ({ symbol: x.symbol, situation: x.situation, score: x.score, fail: x.fail }));

  return {
    ...base, state: 'ok', ts: radar.ts || null, checked: scored.length,
    hit: hit ? {
      ...hit,
      plan: {
        targetPct: r2(targetPct), stopPct: -r2(maxStopPct),
        notionalEur: size?.notionalEur ?? cfg.notionalEur,
        riskEur: size?.riskEur ?? null,
        winEur: Math.round(netEurAtMove(targetPct, size?.cfg ?? cfg)),
        lossEur: Math.round(lossEurAtStop(-maxStopPct, size?.cfg ?? cfg)),
        costLoadPct: size?.costLoadPct ?? costLoadPct(targetPct, cfg),
        capped: !!size?.capped,
        sizedBy: `Risikobudget ${RIDE.RISK_BUDGET_PCT} % von ${eurRaw(cfg.notionalEur)}`,
      },
    } : null,
    near,
    note: hit
      ? `${hit.symbol} erfuellt alle Huerden. Ausloeser: ${hit.catalyst}. Kein Kaufsignal — ein Grund hinzusehen.`
      : `${scored.length} Kandidaten geprueft, keiner erfuellt alle Huerden. Das ist der Normalfall.`,
  };
}
const eurRaw = (n) => `${Math.round(Number(n) || 0).toLocaleString('de-AT')} EUR`;

/* ============================================================================
   v3.27.0 · SCORE-AUDIT — was ist jeder Koeffizient wirklich wert?
   ----------------------------------------------------------------------------
   DER SITUATION-SCORE ist der frueheste und folgenreichste Eingriffspunkt der
   App: er entscheidet, WELCHE Titel ueberhaupt in die Kandidatenliste kommen.
   Alles danach — Kostenrechnung, Hitze, Erwartungswert, Rangfolge — arbeitet
   nur noch mit dem, was er durchgelassen hat. Seine elf Terme sind bis heute
   nie gegen ein Ergebnis geprueft worden.

   WAS HIER GEMESSEN WIRD, und was ausdruecklich nicht:
   Fuer jeden Term wird gefragt: "Wenn dieser Term Punkte vergeben hat, sind die
   betroffenen Faelle danach haeufiger ins Ziel gelaufen als die anderen?"
   Das ist eine Trennschaerfe (AUC), keine Ursache. Ein Term kann trennen, weil
   er dasselbe misst wie ein anderer — deshalb wird zusaetzlich die Ueber-
   schneidung ausgewiesen.

   DREI SCHUTZMASSNAHMEN, weil hier besonders leicht Unsinn entsteht:
   1) ELF TERME = ELF TESTS. Bei elf Vergleichen liefert reiner Zufall regel-
      maessig einen "signifikanten" Treffer. Die Rauschgrenze wird deshalb
      mehrfachtestkorrigiert (`aucNoiseFloor` mit tests = Anzahl Terme) —
      dieselbe Bremse, die das Musterlabor seit v3.17.0 benutzt.
   2) AUSSERHALB DER STICHPROBE. Gemessen wird auf dem juengeren Drittel,
      nachdem die Terme auf dem aelteren Teil beobachtet wurden. Ein Term, der
      nur rueckblickend trennt, faellt damit auf.
   3) FAIL-CLOSED IM URTEIL. Wer zu wenige Faelle hat, bekommt "nicht
      bewertbar" — nicht "neutral". Ein unbewerteter Term darf nie so aussehen
      wie ein geprueft harmloser.

   DIESES MODUL AENDERT NICHTS. Es empfiehlt, es schaltet nicht ab. Dieselbe
   Trennung wie bei Modul 0: der Ueberanpassungswaechter darf raten, nicht
   handeln.
   ========================================================================== */
const AUDIT = {
  MIN_CASES: 40,        // je Term, sonst "nicht bewertbar"
  MIN_PER_GROUP: 12,    // je Gruppe (Term aktiv / inaktiv)
  OOS_FRACTION: 0.35,
  WINDOW_MS: 28 * 24 * 60 * 60_000,
  ROW_LIMIT: 12000,
};
const SITU_TERMS = [
  ['breakout', 'Ausbruch / Triggerzone', 'Kurs ueber dem 60-Minuten-Hoch oder dicht davor'],
  ['squeeze',  'Kompression loest sich',  'enge Vorphase, Ausbruch, Range weitet sich'],
  ['reclaim',  'VWAP/EMA21 zurueckerobert', 'Kurs holt sich eine verlorene Marke zurueck'],
  ['pullback', 'Pullback haelt',          'Ruecksetzer haelt die EMA21 und dreht'],
  ['accel',    'Beschleunigung',          '5-Minuten-Momentum zieht gegen die 15-Minuten-Basis an'],
  ['rvol',     'Relatives Volumen',       'mehr Umsatz als ueblich zu dieser Tageszeit'],
  ['vwap',     'Lage zum VWAP',           'ueber oder unter dem volumengewichteten Schnitt'],
  ['emaStack', 'EMA-Stapel',              'EMA9 ueber oder unter EMA21'],
  ['vacuum',   'Liquiditaetsvakuum',      'wenig Aktivitaet oberhalb des Kurses'],
  ['extended', 'Ueberdehnung',            'mehr als 3 ATR ueber der EMA21 — Abzugsterm'],
];

/** Urteil je Term. Bewusst als URSACHE formuliert, nicht als Note. */
function auditVerdict({ n, nActive, nIdle, auc, floor, weight }) {
  if (n < AUDIT.MIN_CASES || nActive < AUDIT.MIN_PER_GROUP || nIdle < AUDIT.MIN_PER_GROUP)
    return { verdict: 'nicht bewertbar',
      why: `${nActive} Faelle mit, ${nIdle} ohne diesen Term. Noetig sind ${AUDIT.MIN_CASES} insgesamt und ${AUDIT.MIN_PER_GROUP} je Gruppe.` };
  if (auc == null) return { verdict: 'nicht bewertbar', why: 'Keine vergleichbaren Ergebnisse.' };
  /* Das VORZEICHEN des Gewichts bestimmt, was "richtig" heisst.
     Ein ABZUGSTERM wie die Ueberdehnung (-18) SOLL die schlechteren Faelle
     treffen. Wuerde man ihn wie einen Pluspunkt bewerten, faende man ihn
     "verkehrt herum", genau wenn er tut, wofuer er gebaut wurde — und
     umgekehrt bliebe ein kaputter Abzugsterm unentdeckt.
     Mein erster Entwurf hat genau diesen Fehler gemacht; er ist im Testlauf
     aufgefallen, weil der Abzugsterm als einziger "wirkt verkehrt herum"
     meldete, obwohl die konstruierte Wahrheit ihn korrekt gemacht hatte. */
  const soll = weight >= 0 ? 1 : -1;
  const edge = (auc - 0.5) * soll;
  const band = floor - 0.5;
  const richtung = soll > 0 ? 'haeufiger' : 'seltener';
  const gegen = soll > 0 ? 'seltener' : 'haeufiger';
  if (Math.abs(edge) < band)
    return { verdict: 'kein messbarer Beitrag',
      why: `Trennschaerfe ${(auc * 100).toFixed(0)} % liegt innerhalb der Rauschgrenze von ${(floor * 100).toFixed(0)} %. Der Term vergibt ${weight > 0 ? '+' : ''}${weight} Punkte, ohne dass sich das im Ergebnis zeigt.` };
  if (edge < 0)
    return { verdict: 'wirkt verkehrt herum',
      why: soll > 0
        ? `Faelle MIT diesem Term liefen ${gegen} ins Ziel (${(auc * 100).toFixed(0)} %). Bei +${weight} Punkten hebt er damit die falschen Titel nach oben.`
        : `Dieser Abzugsterm trifft die BESSEREN Faelle (${(auc * 100).toFixed(0)} %). Bei ${weight} Punkten zieht er damit die richtigen Titel nach unten.` };
  return { verdict: 'traegt',
    why: soll > 0
      ? `Faelle mit diesem Term liefen ${richtung} ins Ziel (${(auc * 100).toFixed(0)} % gegen ${(floor * 100).toFixed(0)} % Rauschgrenze).`
      : `Abzugsterm arbeitet richtig: die betroffenen Faelle liefen ${richtung} ins Ziel (${(auc * 100).toFixed(0)} %, Rauschgrenze ${(floor * 100).toFixed(0)} %).` };
}

async function scoreAudit(env, opts = {}) {
  const netEur = posNum(opts.netEur, PICK.DEFAULT_NET_EUR);
  const cfg = pickCfg(opts.cost);
  const targetPct = requiredMovePct(netEur, cfg);
  const stopPct = -(targetPct / ECON_MIN_REWARD_RISK);
  const base = {
    configured: true, version: APP_VERSION,
    targetPct: r2(targetPct), stopPct: r2(stopPct),
    weights: SITU_W, terms: SITU_TERMS.map(([k, label, help]) => ({ key: k, label, help })),
    minCases: AUDIT.MIN_CASES, oosFraction: AUDIT.OOS_FRACTION,
    windowDays: Math.round(AUDIT.WINDOW_MS / 86_400_000),
    changesNothing: true,
  };
  if (!env?.DB) return { ...base, state: 'nodb', rows: [], note: 'Ohne D1 gibt es keine Aufzeichnungen. Es wird bewusst nichts geschaetzt.' };
  await ensureD1Schema(env);

  const raw = (await env.DB.prepare(
    `SELECT symbol,ts,bucket5,max_pct,min_pct,mae_pre,payload
       FROM market_snapshots
      WHERE resolved_ts IS NOT NULL AND asset_type='stock' AND ts>=?
      ORDER BY ts DESC LIMIT ?`).bind(Date.now() - AUDIT.WINDOW_MS, AUDIT.ROW_LIMIT).all()).results || [];
  const episodes = collapseEpisodes(raw);

  // Nur Episoden, die die Beitraege wirklich mitgebracht haben.
  const cases = [];
  for (const e of episodes) {
    let p = null;
    try { p = JSON.parse(e.payload || '{}'); } catch { continue; }
    if (!p?.situParts || typeof p.situParts !== 'object') continue;
    const o = pickOutcome([e], targetPct, stopPct);
    cases.push({ ts: Number(e.ts), parts: p.situParts, score: Number(p.situScore),
      win: o.hit === 1, maxPct: Number(e.max_pct) });
  }
  cases.sort((a, b) => a.ts - b.ts);
  const splitAt = Math.floor(cases.length * (1 - AUDIT.OOS_FRACTION));
  const oos = cases.slice(splitAt);

  const rows = SITU_TERMS.map(([key, label, help]) => {
    // "Aktiv" heisst: der Term hat ueberhaupt einen Beitrag geliefert.
    const active = oos.filter((c) => Math.abs(Number(c.parts[key]) || 0) > 0.05);
    const idle = oos.filter((c) => Math.abs(Number(c.parts[key]) || 0) <= 0.05);
    const auc = aucSeparation(active.map((c) => (c.win ? 1 : 0)), idle.map((c) => (c.win ? 1 : 0)));
    const floor = aucNoiseFloor(active.length, idle.length, SITU_TERMS.length);
    const weight = Math.round((active.reduce((a, c) => a + (Number(c.parts[key]) || 0), 0) /
      Math.max(1, active.length)) * 10) / 10;
    const v = auditVerdict({ n: oos.length, nActive: active.length, nIdle: idle.length, auc, floor, weight });
    return {
      key, label, help, weight,
      nActive: active.length, nIdle: idle.length,
      hitActive: active.length ? Math.round(active.filter((c) => c.win).length / active.length * 100) : null,
      hitIdle: idle.length ? Math.round(idle.filter((c) => c.win).length / idle.length * 100) : null,
      auc: auc == null ? null : Math.round(auc * 100), floor: Math.round(floor * 100),
      ...v,
    };
  });

  // Der Score als Ganzes: trennt er ueberhaupt?
  const hi = oos.filter((c) => Number.isFinite(c.score) && c.score >= 60);
  const lo = oos.filter((c) => Number.isFinite(c.score) && c.score < 60);
  const wholeAuc = aucSeparation(hi.map((c) => (c.win ? 1 : 0)), lo.map((c) => (c.win ? 1 : 0)));
  const wholeFloor = aucNoiseFloor(hi.length, lo.length, 1);

  const bewertbar = rows.filter((r) => r.verdict !== 'nicht bewertbar');
  const traegt = rows.filter((r) => r.verdict === 'traegt');
  const verkehrt = rows.filter((r) => r.verdict === 'wirkt verkehrt herum');
  const note = !episodes.length
    ? 'Noch keine aufgeloesten Aufzeichnungen im Fenster.'
    : !cases.length
    ? 'Aufzeichnungen vorhanden, aber ohne die Einzelbeitraege des Score. Sie werden erst seit v3.27.0 mitgeschrieben — rueckwirkend ist das nicht zu heilen.'
    : !bewertbar.length
    ? `${cases.length} Faelle aufgezeichnet, davon ${oos.length} im Nachweisteil. Kein Term hat bisher genug Faelle fuer ein Urteil.`
    : `${bewertbar.length} von ${rows.length} Termen sind bewertbar: ${traegt.length} tragen, ${verkehrt.length} wirken verkehrt herum.`;

  return {
    ...base, state: cases.length ? 'ok' : 'empty',
    episodes: episodes.length, cases: cases.length, oosCases: oos.length,
    rows,
    whole: {
      auc: wholeAuc == null ? null : Math.round(wholeAuc * 100),
      floor: Math.round(wholeFloor * 100),
      nHigh: hi.length, nLow: lo.length,
      verdict: (wholeAuc == null || hi.length < AUDIT.MIN_PER_GROUP || lo.length < AUDIT.MIN_PER_GROUP)
        ? 'nicht bewertbar'
        : (wholeAuc - 0.5) < (wholeFloor - 0.5) ? 'kein messbarer Beitrag'
        : wholeAuc < 0.5 ? 'wirkt verkehrt herum' : 'traegt',
    },
    note,
  };
}

/* ============================================================================
   v3.29.0 · DIE VORABEND-LISTE — eine Okkasion entsteht am VORTAG
   ----------------------------------------------------------------------------
   DER BEFUND, der diese Version ausgeloest hat (Handover, "NAECHSTER SCHRITT"):
   der laengste Zeitrahmen der App sind 60-Minuten-Balken. Sie sieht damit die
   ZUENDUNG, nicht die Ladung. Eine Okkasion entsteht aber am Vortag —
   mehrtaegige Kompression, versiegender Umsatz, ein mehrtaegiger Widerstand
   direkt darueber. Wer bei 2,04 % Zielweite erst einsteigt, wenn die Bewegung
   sichtbar ist, hat oft ein Drittel davon schon verloren.

   WARUM DAS SOFORT GEHT, waehrend fast alles seit v3.20.0 auf Laufzeit wartet:
   historische TAGESBALKEN sind abrufbar. Die IEX-Beschraenkung des kostenlosen
   Zugangs trifft Intraday-Quotes hart, Tages-OHLCV kaum. Diese Schicht ist
   deshalb die einzige, die sich RUECKWIRKEND pruefen laesst — und genau das
   tut `eveStudy()`.

   DIE GEOMETRIE, und warum sie so und nicht anders ist
   ----------------------------------------------------------------------------
   Dieser Nutzer braucht bei 10.000 EUR Einsatz rund 2,04 % Zielweite fuer
   120 EUR netto, und bei einem Chance-Risiko-Verhaeltnis von 2,0 damit einen
   Stop von hoechstens 1,02 %. Das ist ein VIERTEL einer normalen Tagesspanne.
   Ein solcher Stop ist bei fast jedem Setup reines Rauschen — mit EINER
   Ausnahme: wenn der Titel gerade eng laeuft. Dann liegt die strukturelle
   Ungueltigkeit tatsaechlich einen Prozentpunkt entfernt.

   Daraus folgt der ganze Aufbau:
     - Die KOMPRESSION liefert den engen Stop (Box der letzten 8 Tage).
     - Die Zielweite muss trotzdem erreichbar sein. Gemessen wird sie NICHT an
       der Schwankungsbreite der Kompression — die ist per Definition klein und
       wuerde jeden Kandidaten aussortieren — sondern an der Schwankungsbreite
       der Zeit DAVOR (`baseAtrPct`). Das ist die Bewegung, zu der der Titel
       faehig ist, wenn er sich wieder bewegt. Ein Kandidat, dessen Basisspanne
       zu klein ist, kann die 2,04 % nicht liefern; das ist derselbe Befund wie
       v3.8.0 (eine Mega-Cap laeuft 0,8 % am Tag und kann nie freigegeben
       werden), nur diesmal als messbare Huerde statt als Namensliste.
     - Der RESTWEG zum naechsten mehrtaegigen Widerstand muss die Zielweite
       hergeben. Sonst steht das Ziel hinter fremdem Angebot.

   ZWEI ARTEN, GETRENNT AUFGEZEICHNET UND GETRENNT BEWERTET
   ----------------------------------------------------------------------------
   Die App war bis hierher zu 100 % Momentum. Rueckkehrbewegungen laufen oft
   schneller und mit engerem Stop — genau die Geometrie, die die Kostenrechnung
   dieses Nutzers braucht. Sie bekommen deshalb eine eigene Art (`rueckkehr`),
   eine eigene Auswertung und eine eigene Trefferquote. Zusammengelegt waeren
   beide unbeurteilbar: ein gutes Momentum-Ergebnis wuerde eine schlechte
   Rueckkehr-Quote verdecken und umgekehrt.

   WAS NICHT VERSCHOBEN WIRD
   ----------------------------------------------------------------------------
   Der Stop ist STRUKTURELL (Sicherheits-Invariante 4). Er wird nie enger
   gerechnet, damit das Chance-Risiko-Verhaeltnis passt. Passt er nicht ins
   Budget, faellt der Kandidat in die getrennte Gruppe "strukturell zu breit" —
   sichtbar, mit ehrlichem Plan, aber ausserhalb der Liste. Ein stilles
   Streichen waere ein Verstoss gegen Invariante 6.

   0 % GEWICHT. Diese Schicht liefert eine Kandidatenliste, keinen Score, keine
   Ampel, keine Freigabe. Wie Modul 0, Modul 1 und Modul 2.
   ========================================================================== */
const EVE = {
  HISTORY_DAYS: 420,        // Kalendertage Tagesbalken je Titel (ein Abruf deckt Liste UND Studie)
  MIN_BARS: 45,             // darunter ist nichts bewertbar — und nichts wird gemeldet
  LOOK_DAYS: 60,            // Fenster fuer Widerstaende (Handover: "mehrtaegiger Widerstand")
  BOX_DAYS: 8,              // die Kompression, aus der der enge Stop kommt
  BASE_DAYS: 20,            // Vergleichszeitraum davor: Spanne, Umsatz, Bewegungsfaehigkeit
  ATR_N: 14,
  MAX_CONTRACTION: 0.75,    // Boxspanne <= 75 % der Basisspanne  == "Kompression"
  MAX_VOL_RATIO: 0.85,      // Boxumsatz <= 85 % des Basisumsatzes == "versiegender Umsatz"
  TRIGGER_BUFFER_ATR: 0.10, // Aufschlag ueber die Box: ein Ausbruch ist kein Antippen
  STOP_BUFFER_ATR: 0.05,    // Abschlag unter das Tief: exakt am Tief steht das Rauschen
  MAX_TRIGGER_REACH_ATR: 1.20, // Trigger weiter als 1,2 Tagesspannen weg -> passiert morgen nicht
  /* Ein Widerstand innerhalb einer Tagesspanne ueber der Box gehoert ZUM
     Ausbruch: der Trigger wandert auf ihn hinauf. Alles darueber steht dem
     Ziel im Weg und zaehlt als Restweg-Grenze. */
  RESIST_MERGE_ATR: 1.0,
  /* Die Zielweite muss zur Bewegungsfaehigkeit des Titels passen. Gemessen an
     der Spanne VOR der Kompression, nicht an der Kompression selbst. 2,0 heisst:
     das Ziel darf hoechstens zwei normale Tagesspannen entfernt liegen. */
  MAX_TARGET_BASE_ATR: 2.0,
  MIN_PRICE_USD: 5,
  MIN_DOLLARVOL: 3_000_000, // Tagesumsatz in USD, Mittel ueber BASE_DAYS
  REV_DAYS: 3,              // Rueckkehr: Fenster des Rueckgangs
  REV_MIN_DROP_PCT: 5,      // ... und seine Mindesttiefe
  REV_MIN_CLOSE_POS: 0.55,  // Stabilisierungsbalken: Schluss im oberen Teil der eigenen Spanne
  REV_TREND_TOL_PCT: 3,     // Rueckkehr nur im intakten laengeren Aufwaertstrend
  TREND_SMA: 50,
  MAX_SYMBOLS: 40,          // Obergrenze des Universums
  /* ABRUFBUDGET JE LAUF. Der kostenlose Tiingo-Zugang erlaubt rund 50 Symbole
     pro Stunde — geteilt mit allem anderen, was die App ohnehin abfragt.
     40 Titel auf einen Schlag sprengen das Fenster garantiert; genau das ist
     beim ersten echten Lauf passiert (40 von 40 Abrufen mit 429).
     Deshalb holt ein Lauf nur wenige NEUE Titel; der Rest kommt aus dem
     Zwischenspeicher oder beim naechsten Lauf. Die Liste baut sich auf,
     statt in einem Zug zu scheitern. */
  FETCH_BUDGET: 6,
  BARS_TTL_MS: 20 * 60 * 60_000,  // Tagesbalken aendern sich einmal taeglich
  MAX_ROWS: 15,             // Handover: "Ergebnis 5-15 Namen"
  STUDY_DAYS: 260,          // rund ein Handelsjahr fuer die Ereignisstudie
  STUDY_HOLD_DAYS: 3,       // Haltefenster: Vorabend-Setups sind keine Wochenpositionen
  STUDY_MIN_N: 25,          // darunter: "nicht bewertbar" — NICHT "neutral"
  CACHE_MS: 6 * 60 * 60_000,
};
const EVE_KINDS = ['momentum', 'rueckkehr'];
const EVE_KIND_LABEL = { momentum: 'Kompression', rueckkehr: 'Rueckkehr' };

/* Zahlen aus Tagesbalken sind Zahlen von aussen. `Number(null)` ist 0, nicht
   NaN — fuenf Mal derselbe Fehler in fuenf Versionen (8t, 8u, 8y). Ein Kurs
   von 0 waere hier der bestmoegliche Wert an jeder Abstandsrechnung. */
const evePos = (v) => { if (v === null || v === undefined || v === '') return NaN;
  const n = Number(v); return Number.isFinite(n) && n > 0 ? n : NaN; };
const eveMean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;

/** Tagesbalken vereinheitlichen. Unplausible Balken werden VERWORFEN, nicht
 *  repariert: ein Balken mit Hoch unter Tief ist keine Beobachtung. */
function eveBars(raw) {
  const out = [];
  for (const x of (Array.isArray(raw) ? raw : [])) {
    if (!x) continue;
    const d = String(x.date ?? x.d ?? '').slice(0, 10);
    const o = evePos(x.open ?? x.o), h = evePos(x.high ?? x.h),
          l = evePos(x.low ?? x.l), c = evePos(x.close ?? x.c);
    const v = evePos(x.volume ?? x.v);   // Umsatz 0 heisst "keine Angabe", nicht "kein Handel"
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    if (![o, h, l, c].every(Number.isFinite)) continue;
    if (h < l || h < c || h < o || l > c || l > o) continue;
    out.push({ d, o, h, l, c, v });
  }
  out.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  // Doppelte Tage (Anbieter liefern gelegentlich Korrekturzeilen): der spaetere gewinnt.
  return out.filter((b, i) => i === out.length - 1 || b.d !== out[i + 1].d);
}

/** Durchschnittliche echte Tagesspanne. Gleiche Formel wie `atr()` fuer
 *  Minutenkerzen — hier bewusst eigenstaendig, damit der Block als Ganzes
 *  pruefbar bleibt (Lehre aus 8x: Testschnitte duerfen nicht an entfernten
 *  Ankern haengen). */
function eveAtr(bars, n = EVE.ATR_N) {
  if (!Array.isArray(bars) || bars.length < n + 1) return NaN;
  const tr = [];
  for (let i = 1; i < bars.length; i++) {
    const p = bars[i - 1].c;
    tr.push(Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - p), Math.abs(bars[i].l - p)));
  }
  let a = eveMean(tr.slice(0, n));
  for (let i = n; i < tr.length; i++) a = (a * (n - 1) + tr[i]) / n;
  return Number.isFinite(a) && a > 0 ? a : NaN;
}

/** Wendepunkt-Hochs: ein Hoch, das die `k` Balken davor UND danach ueberragt.
 *  Ein einzelner Docht ist kein Widerstand; ein Wendepunkt ist einer. */
function evePivotHighs(bars, k = 2) {
  const out = [];
  for (let i = k; i < bars.length - k; i++) {
    let top = true;
    for (let j = i - k; j <= i + k; j++) if (j !== i && bars[j].h >= bars[i].h) { top = false; break; }
    if (top) out.push(bars[i].h);
  }
  return out;
}

/** Die vollstaendige Geometrie EINES Kandidaten am Abend des letzten Balkens.
 *  Gibt `null` zurueck, wenn zu wenig Material da ist — nicht etwa
 *  Standardwerte. Fehlende Daten duerfen nie etwas verbessern (Regel 4). */
function eveGeometry(bars, kind) {
  const b = Array.isArray(bars) ? bars : [];
  const need = Math.max(EVE.MIN_BARS, EVE.BOX_DAYS + EVE.BASE_DAYS + EVE.ATR_N + 1);
  if (b.length < need) return null;
  const n = b.length, last = b[n - 1];
  const win = b.slice(Math.max(0, n - EVE.LOOK_DAYS));
  const box = b.slice(n - EVE.BOX_DAYS);
  const base = b.slice(n - EVE.BOX_DAYS - EVE.BASE_DAYS, n - EVE.BOX_DAYS);

  /* Die AKTUELLE Schwankungsbreite — sie skaliert die Puffer. Wer hier ein
     breiteres Fenster nimmt, misst die Zeit VOR der Kompression mit und macht
     die Puffer genau dort zu gross, wo es eng werden soll. */
  const atrAbs = eveAtr(b.slice(-(EVE.ATR_N + 1)));
  /* Die Bewegungsfaehigkeit VOR der Kompression. Genau hier steckt der
     Unterschied zwischen "eng, weil ausgetrocknet" und "eng, weil geladen". */
  const baseAtrAbs = eveAtr(b.slice(n - EVE.BOX_DAYS - EVE.BASE_DAYS - EVE.ATR_N - 1, n - EVE.BOX_DAYS));
  if (!Number.isFinite(atrAbs) || !Number.isFinite(baseAtrAbs)) return null;

  const boxHigh = Math.max(...box.map((x) => x.h)), boxLow = Math.min(...box.map((x) => x.l));
  const baseHigh = Math.max(...base.map((x) => x.h)), baseLow = Math.min(...base.map((x) => x.l));
  const boxRangePct = (boxHigh - boxLow) / last.c * 100;
  const baseRangePct = (baseHigh - baseLow) / last.c * 100;
  const contraction = baseRangePct > 0 ? boxRangePct / baseRangePct : NaN;

  const boxVols = box.map((x) => x.v).filter(Number.isFinite);
  const baseVols = base.map((x) => x.v).filter(Number.isFinite);
  // Fehlende Umsaetze machen die Aussage nicht besser, sondern unmoeglich.
  const boxVol = boxVols.length === box.length ? eveMean(boxVols) : NaN;
  const baseVol = baseVols.length === base.length ? eveMean(baseVols) : NaN;
  const volRatio = (baseVol > 0) ? boxVol / baseVol : NaN;
  const dvBars = b.slice(-EVE.BASE_DAYS);
  const dollarVol = dvBars.every((x) => Number.isFinite(x.v))
    ? eveMean(dvBars.map((x) => x.c * x.v)) : NaN;

  const sma20 = eveMean(b.slice(-20).map((x) => x.c));
  const sma50 = b.length >= EVE.TREND_SMA ? eveMean(b.slice(-EVE.TREND_SMA).map((x) => x.c)) : NaN;

  /* Widerstaende aus der Zeit VOR der Box. Die Box-Hochs sind der Ausbruchs-
     punkt selbst und koennen ihm nicht im Weg stehen. k=3, damit ein einzelner
     Docht nicht als Widerstand durchgeht. */
  const priorPivots = evePivotHighs(win.slice(0, Math.max(0, win.length - EVE.BOX_DAYS)), 3)
    .sort((a, x) => a - x);

  let trigger, stop, deepStop, dropPct = NaN, closePos = NaN, mergedResist = 0;
  if (kind === 'rueckkehr') {
    /* Rueckeroberung: der Einstieg ist das Hoch des Stabilisierungstages, die
       Ungueltigkeit sein Tief. Beides steht fest, bevor der Trade beginnt. */
    const revLow = Math.min(...b.slice(-2).map((x) => x.l));
    trigger = last.h + EVE.TRIGGER_BUFFER_ATR * atrAbs;
    stop = revLow - EVE.STOP_BUFFER_ATR * atrAbs;
    deepStop = Math.min(...b.slice(-(EVE.REV_DAYS + 2)).map((x) => x.l));
    /* Die Tiefe des Rueckschlags wird vom LOKALEN HOCH gemessen, nicht von
       einem festen Balken. Ein fester Rueckblick misst je nach Verlauf mal die
       ganze Bewegung und mal ihr letztes Drittel — derselbe Rueckschlag
       bekaeme zwei verschiedene Zahlen. */
    const swingHigh = Math.max(...b.slice(-(EVE.REV_DAYS + 2)).map((x) => x.h));
    dropPct = swingHigh > 0 ? (last.c - swingHigh) / swingHigh * 100 : NaN;
    closePos = (last.h > last.l) ? (last.c - last.l) / (last.h - last.l) : NaN;
  } else {
    /* Ausbruch aus der Box: Einstieg knapp ueber der Boxoberkante, Ungueltigkeit
       am Boxtief. Das ist die einzige Stelle, an der die Kompression zaehlt —
       sie macht diesen Abstand klein genug fuer das Budget dieses Nutzers.

       ABER: liegt ein mehrtaegiger Widerstand DICHT ueber der Box, ist nicht
       die Boxoberkante der Ausbruchspunkt, sondern er. Genau diese Lage meint
       der Befund "Naehe zu einem mehrtaegigen Widerstand" — sie ist das
       Kennzeichen der Okkasion, nicht ihr Hindernis. Wer den Trigger unter dem
       Widerstand laesst, kauft in fremdes Angebot hinein und wird an einer
       Stelle ausgestoppt, die vorher sichtbar war. */
    const capHigh = boxHigh + EVE.RESIST_MERGE_ATR * atrAbs;
    const nearby = priorPivots.filter((h) => h > boxHigh && h <= capHigh);
    mergedResist = nearby.length;
    trigger = (nearby.length ? Math.max(...nearby) : boxHigh) + EVE.TRIGGER_BUFFER_ATR * atrAbs;
    stop = boxLow - EVE.STOP_BUFFER_ATR * atrAbs;
    deepStop = baseLow;
  }
  if (!(trigger > 0) || !(stop > 0) || !(trigger > stop)) return null;

  const stopPct = (trigger - stop) / trigger * 100;
  const deepStopPct = (deepStop > 0 && deepStop < trigger) ? (trigger - deepStop) / trigger * 100 : NaN;
  /* Der naechste Widerstand OBERHALB des Triggers. Nur er steht dem Ziel im
     Weg — alles darunter gehoert zum Ausbruch. */
  const resist = priorPivots.filter((h) => h > trigger).sort((a, b2) => a - b2)[0] ?? null;
  const runwayPct = resist != null ? (resist - trigger) / trigger * 100 : null;

  return {
    kind, date: last.d, price: last.c, bars: n,
    trigger: Math.round(trigger * 1000) / 1000,
    stop: Math.round(stop * 1000) / 1000,
    stopPct: r2(stopPct),
    deepStopPct: Number.isFinite(deepStopPct) ? r2(deepStopPct) : null,
    resist, runwayPct: runwayPct != null ? r2(runwayPct) : null,
    mergedResist,
    atrPct: r2(atrAbs / last.c * 100),
    baseAtrPct: r2(baseAtrAbs / last.c * 100),
    boxRangePct: r2(boxRangePct), contraction: Number.isFinite(contraction) ? r2(contraction) : null,
    volRatio: Number.isFinite(volRatio) ? r2(volRatio) : null,
    dollarVol: Number.isFinite(dollarVol) ? Math.round(dollarVol) : null,
    triggerReachAtr: r2((trigger - last.c) / atrAbs),
    aboveSma50: Number.isFinite(sma50) ? last.c >= sma50 : null,
    sma20, sma50,
    meanPct: Number.isFinite(sma20) && sma20 > trigger ? r2((sma20 - trigger) / trigger * 100) : null,
    dropPct: Number.isFinite(dropPct) ? r2(dropPct) : null,
    closePos: Number.isFinite(closePos) ? r2(closePos) : null,
  };
}

/** Alle Huerden, jede einzeln benannt. Genau wie bei `rideCheck`: die Gruende
 *  auszuweisen ist kein Beiwerk — eine Liste, die nur leer bleibt, laesst
 *  offen, ob sie ueberhaupt arbeitet.
 *  `budgetFail` wird GETRENNT gefuehrt: ein Kandidat, dessen struktureller Stop
 *  breiter ist als das Budget, ist nicht schlecht, sondern fuer DIESEN Nutzer
 *  unhandelbar. Er verschwindet nicht, er wandert in eine eigene Gruppe. */
function eveCheck(g, ctx) {
  if (!g) return { ok: false, fail: ['zu wenige Tagesbalken'], budgetOnly: false, targetPct: null };
  const { econTargetPct, maxStopPct } = ctx;
  const f = (v) => { if (v === null || v === undefined || v === '') return NaN;
    const x = Number(v); return Number.isFinite(x) ? x : NaN; };
  const fail = [], budgetFail = [];

  const stopPct = f(g.stopPct);
  /* Die Zielweite folgt aus dem SCHLECHTEREN von beidem: dem wirtschaftlichen
     Minimum und dem Zweifachen des tatsaechlichen Stops. Nie darunter. */
  const targetPct = Number.isFinite(stopPct)
    ? Math.max(econTargetPct, stopPct * ECON_MIN_REWARD_RISK) : NaN;

  // ---- 1. DIE ENTSCHEIDENDE HUERDE, die uebliche Screener nicht haben ----
  if (!Number.isFinite(stopPct)) fail.push('struktureller Stop unbekannt');
  else if (stopPct > maxStopPct)
    budgetFail.push(`struktureller Stop ${r2(stopPct)} % ueber dem Stopbudget von ${r2(maxStopPct)} %`);

  // ---- 2. Erreichbarkeit: kann der Titel die Zielweite ueberhaupt liefern? --
  const baseAtr = f(g.baseAtrPct);
  if (!Number.isFinite(baseAtr)) fail.push('Bewegungsfaehigkeit unbekannt');
  else if (Number.isFinite(targetPct) && targetPct > baseAtr * EVE.MAX_TARGET_BASE_ATR)
    fail.push(`Zielweite ${r2(targetPct)} % ueber ${EVE.MAX_TARGET_BASE_ATR} Basisspannen (${r2(baseAtr)} %)`);

  // ---- 3. Restweg: das Ziel darf nicht hinter fremdem Angebot liegen -------
  const runway = g.runwayPct == null ? null : f(g.runwayPct);
  if (runway != null && Number.isFinite(targetPct) && runway < targetPct)
    fail.push(`Restweg zum Widerstand ${r2(runway)} % unter der Zielweite ${r2(targetPct)} %`);

  // ---- 4. Handelbarkeit -----------------------------------------------------
  const price = f(g.price), dv = f(g.dollarVol);
  if (!(price >= EVE.MIN_PRICE_USD)) fail.push(`Kurs unter ${EVE.MIN_PRICE_USD} USD`);
  if (!Number.isFinite(dv)) fail.push('Dollarumsatz unbekannt');
  else if (dv < EVE.MIN_DOLLARVOL) fail.push(`Dollarumsatz ${Math.round(dv / 1e6)} Mio. unter ${EVE.MIN_DOLLARVOL / 1e6} Mio.`);

  // ---- 5. Der Trigger muss morgen erreichbar sein --------------------------
  const reach = f(g.triggerReachAtr);
  if (!Number.isFinite(reach)) fail.push('Abstand zum Trigger unbekannt');
  else if (reach < 0) fail.push('Trigger liegt bereits unter dem Schlusskurs');
  else if (reach > EVE.MAX_TRIGGER_REACH_ATR)
    fail.push(`Trigger ${r2(reach)} Tagesspannen entfernt`);

  // ---- 6. Art-spezifisch ----------------------------------------------------
  if (g.kind === 'rueckkehr') {
    const drop = f(g.dropPct), pos = f(g.closePos);
    if (!Number.isFinite(drop)) fail.push('Rueckgang nicht messbar');
    else if (drop > -EVE.REV_MIN_DROP_PCT) fail.push(`Rueckgang ${r2(drop)} % zu flach fuer eine Rueckkehr`);
    if (!Number.isFinite(pos)) fail.push('Stabilisierung nicht messbar');
    else if (pos < EVE.REV_MIN_CLOSE_POS) fail.push(`Schluss bei ${Math.round(pos * 100)} % der Tagesspanne — keine Stabilisierung`);
    if (g.meanPct == null) fail.push('kein Weg zurueck zur Mitte');
    /* Eine Rueckkehr im intakten Aufwaertstrend ist ein Rueckschlag; dieselbe
       Geometrie im Abwaertstrend ist ein fallendes Messer. */
    if (g.aboveSma50 === null) fail.push('laengerer Trend unbekannt');
    else if (!g.aboveSma50 && !(Number.isFinite(f(g.sma50)) && price >= f(g.sma50) * (1 - EVE.REV_TREND_TOL_PCT / 100)))
      fail.push('unter dem laengeren Trend — fallendes Messer');
  } else {
    const con = f(g.contraction), vr = f(g.volRatio);
    if (!Number.isFinite(con)) fail.push('Kompression nicht messbar');
    else if (con > EVE.MAX_CONTRACTION) fail.push(`keine Kompression (Boxspanne ${Math.round(con * 100)} % der Basisspanne)`);
    if (!Number.isFinite(vr)) fail.push('Umsatzverlauf unbekannt');
    else if (vr > EVE.MAX_VOL_RATIO) fail.push(`Umsatz versiegt nicht (${Math.round(vr * 100)} % der Basis)`);
    if (g.aboveSma50 === null) fail.push('laengerer Trend unbekannt');
    else if (!g.aboveSma50) fail.push('unter dem laengeren Trend');
  }

  return {
    ok: !fail.length && !budgetFail.length,
    /* Nur an der Budgetgrenze gescheitert: alles andere passt, der Titel ist
       fuer diesen Nutzer nur zu breit. Das ist eine andere Aussage als
       "schlechtes Setup" und wird getrennt gezeigt. */
    budgetOnly: !fail.length && budgetFail.length > 0,
    fail: [...fail, ...budgetFail],
    targetPct: Number.isFinite(targetPct) ? r2(targetPct) : null,
  };
}

/** Kandidat + Plan in Euro. Die Positionsgroesse kommt aus `rideSize()` und
 *  damit aus dem RISIKO: ein engerer Stop erlaubt mehr Stueck, der Euro-Verlust
 *  bleibt gleich. Genau das ist der Grund, warum Rueckkehrbewegungen fuer die
 *  Kostenrechnung dieses Nutzers interessanter sind als Ausbrueche. */
function eveCandidate(symbol, bars, kind, ctx) {
  const g = eveGeometry(bars, kind);
  const chk = eveCheck(g, ctx);
  if (!g) return { symbol, kind, ...chk, geometry: null, plan: null };
  const size = rideSize(g.stopPct, ctx.cfg);
  const cfg = size?.cfg ?? ctx.cfg;
  const t = chk.targetPct;
  const plan = (t != null && size) ? {
    trigger: g.trigger, stop: g.stop,
    targetPrice: Math.round(g.trigger * (1 + t / 100) * 1000) / 1000,
    targetPct: t, stopPct: -g.stopPct,
    rewardRisk: r2(t / g.stopPct),
    notionalEur: size.notionalEur,
    riskEur: size.riskEur,
    winEur: Math.round(netEurAtMove(t, cfg)),
    lossEur: Math.round(lossEurAtStop(-g.stopPct, cfg)),
    costLoadPct: costLoadPct(t, cfg),
    capped: !!size.capped,
    breakEvenPct: Math.round(breakEvenHitRate(t, -g.stopPct, cfg) * 100),
  } : null;
  return { symbol, kind, ...chk, geometry: g, plan };
}

/* ----------------------------------------------------------------------------
   DIE RUECKWIRKENDE EREIGNISSTUDIE
   ----------------------------------------------------------------------------
   Sie laeuft ueber DIESELBEN Funktionen wie die Liste. Das ist der Punkt: eine
   Studie mit eigenen, aehnlichen Regeln misst etwas anderes als die App tut —
   das ist der Fehler, der in diesem Projekt vier Mal passiert ist (v3.8.0,
   v3.16.0, v3.20.0, v3.22.0).

   DREI EHRLICHKEITSREGELN, weil Tagesbalken weniger wissen als sie scheinen:
   1) Wird an einem Tag SOWOHL das Ziel als auch der Stop beruehrt, gilt der
      Fall als AUSGESTOPPT. Tagesbalken kennen die Reihenfolge innerhalb des
      Tages nicht. Dieselbe Regel wie in `pickOutcome`.
   2) Eroeffnet der Ausloesungstag ueber dem Trigger, wird zur EROEFFNUNG
      gekauft, nicht zum Trigger. Wer die Luecke wegrechnet, misst einen
      Einstieg, den es nicht gab. Wird der Stopabstand dadurch groesser als das
      Budget, zaehlt der Fall als "nicht handelbar" — nicht als Gewinn.
   3) Ein nicht ausgeloester Kandidat ist KEIN Verlust. Er ist ein Fall, in dem
      nicht gehandelt wurde, und wird getrennt gezaehlt.
   -------------------------------------------------------------------------- */
function eveStudyOne(bars, kind, ctx) {
  const cases = [];
  const b = Array.isArray(bars) ? bars : [];
  const need = Math.max(EVE.MIN_BARS, EVE.BOX_DAYS + EVE.BASE_DAYS + EVE.ATR_N + 1);
  const from = Math.max(need, b.length - EVE.STUDY_DAYS);
  for (let i = from; i < b.length - 1; i++) {
    const g = eveGeometry(b.slice(0, i + 1), kind);
    const chk = eveCheck(g, ctx);
    if (!chk.ok) continue;
    const next = b[i + 1];
    if (next.h < g.trigger) { cases.push({ d: g.date, outcome: 'nicht ausgeloest' }); continue; }
    // Regel 2: die Luecke wird bezahlt, nicht wegdefiniert.
    const entry = Math.max(g.trigger, next.o);
    const stopPct = (entry - g.stop) / entry * 100;
    if (stopPct > ctx.maxStopPct) { cases.push({ d: g.date, outcome: 'nicht handelbar' }); continue; }
    const targetPct = Math.max(ctx.econTargetPct, stopPct * ECON_MIN_REWARD_RISK);
    const targetPrice = entry * (1 + targetPct / 100);
    let outcome = 'offen', held = 0, ambiguous = false;
    for (let j = i + 1; j <= Math.min(b.length - 1, i + EVE.STUDY_HOLD_DAYS); j++) {
      held = j - i;
      const bar = b[j];
      const reached = bar.h >= targetPrice, breached = bar.l <= g.stop;
      if (breached) { outcome = 'ausgestoppt'; ambiguous = reached; break; }  // Regel 1
      if (reached) { outcome = 'Ziel'; break; }
    }
    if (outcome === 'offen') outcome = 'ausgelaufen';
    cases.push({ d: g.date, outcome, held, ambiguous, targetPct: r2(targetPct), stopPct: r2(stopPct) });
  }
  return cases;
}

/** Zusammenfassung ueber alle Titel EINER Art. Getrennt je Art — zusammengelegt
 *  waere keine der beiden mehr beurteilbar. */
function eveStudySummary(cases, kind, ctx) {
  const all = cases || [];
  const triggered = all.filter((c) => c.outcome !== 'nicht ausgeloest' && c.outcome !== 'nicht handelbar');
  const n = triggered.length;
  const hit = triggered.filter((c) => c.outcome === 'Ziel').length;
  const stopped = triggered.filter((c) => c.outcome === 'ausgestoppt').length;
  const ambiguous = triggered.filter((c) => c.ambiguous).length;
  const flat = n - hit - stopped;
  const holds = triggered.filter((c) => c.outcome === 'Ziel').map((c) => c.held).sort((a, b) => a - b);
  const targets = triggered.map((c) => c.targetPct).filter(Number.isFinite).sort((a, b) => a - b);
  const stops = triggered.map((c) => c.stopPct).filter(Number.isFinite).sort((a, b) => a - b);
  const med = (a) => a.length ? a[Math.floor(a.length / 2)] : null;
  const targetPct = med(targets) ?? ctx.econTargetPct;
  const stopPct = med(stops) ?? ctx.maxStopPct;
  const breakEven = Math.round(breakEvenHitRate(targetPct, -stopPct, ctx.cfg) * 100);

  /* FAIL-CLOSED IM URTEIL. Zu wenige Faelle heissen "nicht bewertbar", nicht
     "neutral" und schon gar nicht "traegt". Beurteilt wird ausserdem die
     UNTERE Wilson-Schranke, nicht die Punktschaetzung: eine Quote von 3 aus 4
     ist keine 75-%-Trefferquote. */
  const pLower = n > 0 ? Math.round(wilsonLower(hit, n) * 100) : null;
  let verdict, why;
  if (n < EVE.STUDY_MIN_N) {
    verdict = 'nicht bewertbar';
    why = `${n} ausgeloeste Faelle, noetig sind ${EVE.STUDY_MIN_N}. Das ist keine Aussage ueber die Art, sondern ueber die Datenlage.`;
  } else if (pLower >= breakEven) {
    verdict = 'traegt';
    why = `Auch am unteren Rand der Schaetzung (${pLower} %) liegt die Trefferquote ueber der Schwelle, ab der sich der Trade nach Kosten und Steuer rechnet (${breakEven} %).`;
  } else if (Math.round(hit / n * 100) >= breakEven) {
    verdict = 'knapp';
    why = `Die gemessene Quote (${Math.round(hit / n * 100)} %) liegt ueber der Schwelle von ${breakEven} %, die untere Schranke (${pLower} %) aber darunter. Zu wenig, um sich darauf zu verlassen.`;
  } else {
    verdict = 'traegt nicht';
    why = `Die Trefferquote bleibt unter den ${breakEven} %, die es nach Kosten und Steuer braucht.`;
  }

  return {
    kind, label: EVE_KIND_LABEL[kind],
    cases: all.length,
    notTriggered: all.filter((c) => c.outcome === 'nicht ausgeloest').length,
    notTradable: all.filter((c) => c.outcome === 'nicht handelbar').length,
    n, hit, stopped, flat, ambiguous,
    hitPct: n ? Math.round(hit / n * 100) : null,
    hitPctLower: pLower,
    breakEvenPct: breakEven,
    medianTargetPct: targetPct != null ? r2(targetPct) : null,
    medianStopPct: stopPct != null ? r2(stopPct) : null,
    medianHoldDays: med(holds),
    verdict, why,
    ambiguousNote: ambiguous > 0
      ? `${ambiguous} von ${n} Faellen haben Ziel UND Stop am selben Tag beruehrt. Tagesbalken kennen die Reihenfolge nicht; sie zaehlen als ausgestoppt.`
      : null,
  };
}

/* Universum: die Titel, die heute schon auffaellig waren, plus die Favoriten,
   plus der Suchkatalog als Auffuellung. Der Katalog ist ausdruecklich
   gekennzeichnet — ein Katalogtitel ist keine Nominierung des Radars. */
function eveUniverse(radarRows, favorites) {
  const seen = new Map();
  const add = (sym, src) => {
    const s = safeRadarSymbol(sym);
    if (s && !seen.has(s)) seen.set(s, src);
  };
  for (const f of (favorites || [])) add(f, 'Favorit');
  for (const r of (radarRows || [])) add(r?.symbol, 'Radar');
  for (const [, sym] of STOCK_SEARCH_CATALOG) add(sym, 'Katalog');
  return [...seen.entries()].slice(0, EVE.MAX_SYMBOLS).map(([symbol, source]) => ({ symbol, source }));
}

async function eveDailyBars(env, symbol) {
  const start = new Date(Date.now() - EVE.HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);
  /* `date` MUSS in der Spaltenliste stehen. Tiingo liefert das Datum nur
     solange mit, wie man `columns` GAR NICHT angibt; sobald die Liste gesetzt
     ist, kommt ausschliesslich das Angeforderte. Ohne Datum verwirft
     `eveBars()` voellig korrekt jeden Balken — 40 Abrufe, 0 verwertbar, und
     kein einziger Fehler, weil technisch alles geklappt hat. */
  const d = await tiingoFetch(env,
    `/tiingo/daily/${encodeURIComponent(symbol)}/prices?startDate=${start}&columns=date,open,high,low,close,volume`);
  return eveBars(d);
}

async function eveningList(env, opts = {}) {
  const netEur = posNum(opts.netEur, PICK.DEFAULT_NET_EUR);
  const cfg = pickCfg(PICK_COST);
  const econTargetPct = requiredMovePct(netEur, cfg);
  const maxStopPct = econTargetPct / ECON_MIN_REWARD_RISK;
  const ctx = { econTargetPct, maxStopPct, cfg };
  const phase = usMarketPhase();
  const base = {
    configured: !!env?.TIINGO_API_TOKEN, version: APP_VERSION, asset: 'stock',
    buyWeight: 0, changesNothing: true,
    econTargetPct: r2(econTargetPct), maxStopPct: r2(maxStopPct),
    rules: EVE, kinds: EVE_KINDS, phaseLabel: phase.label,
    source: 'Tiingo EOD · Tagesbalken',
    disclaimer: 'Kandidatenliste fuer den naechsten Handelstag, keine Kauf-Freigabe. '
      + 'Der Stop ist STRUKTURELL und wird nie enger gerechnet, damit das Chance-Risiko-Verhaeltnis passt. '
      + 'Gepruefte Titel sind nur die, die heute schon auffaellig waren, plus Favoriten und Katalog — kein Vollmarkt-Screening.',
  };
  if (!env?.TIINGO_API_TOKEN)
    return { ...base, state: 'nokey', rows: [], wide: [], study: null,
      note: 'Ohne TIINGO_API_TOKEN gibt es keine Tagesbalken. Es wird bewusst nichts geschaetzt.' };

  const force = opts.force === true || opts.force === '1';
  if (!force && env?.DB) {
    const cached = await eveReadCache(env);
    if (cached && Date.now() - cached.ts < EVE.CACHE_MS && cached.netEur === netEur)
      return { ...cached.payload, cached: true, ts: cached.ts };
  }

  const radar = await readPersistedIexRadar(env);
  const favorites = String(opts.favorites || '').split(',').map((x) => x.trim()).filter(Boolean);
  const universe = eveUniverse(radar?.rows || [], favorites);
  if (!universe.length)
    return { ...base, state: 'empty', rows: [], wide: [], study: null, checked: 0,
      note: 'Kein Universum. Ohne Kandidaten wird nichts gemeldet.' };

  /* Zuerst der Zwischenspeicher, DANN das Abrufbudget. Ein Titel, dessen
     Tagesbalken von heute frueh stammen, braucht keinen zweiten Abruf. */
  const cachedBars = await eveReadBars(env, universe.map((u) => u.symbol));
  const needFetch = universe.filter((u) => !cachedBars[u.symbol]);
  const toFetch = needFetch.slice(0, EVE.FETCH_BUDGET);
  const deferred = needFetch.length - toFetch.length;

  let rateLimited = false;
  const fetched = await pool(toFetch, 2, async ({ symbol, source }) => {
    /* Nach einem 429 wird NICHT weitergefragt. Jeder weitere Abruf verlaengert
       nur das gesperrte Zeitfenster und liefert garantiert nichts. */
    if (rateLimited) return { symbol, source, bars: [], error: 'uebersprungen nach Rate-Limit' };
    try {
      const bars = await eveDailyBars(env, symbol);
      return { symbol, source, bars, error: null };
    } catch (e) {
      const msg = String(e?.message || e);
      if (/429|rate.?limit/i.test(msg)) rateLimited = true;
      return { symbol, source, bars: [], error: msg };
    }
  });
  await eveWriteBars(env, fetched.filter((f) => !f.error && f.bars.length >= EVE.MIN_BARS));

  const results = universe.map((u) => {
    const got = fetched.find((f) => f.symbol === u.symbol);
    if (got) return got;
    const c = cachedBars[u.symbol];
    if (c) return { symbol: u.symbol, source: u.source, bars: c, error: null, fromCache: true };
    return { symbol: u.symbol, source: u.source, bars: [], error: null, pending: true };
  });

  const rows = [], wide = [], nearMiss = [];
  const studyCases = { momentum: [], rueckkehr: [] };
  let barsOk = 0, failedFetch = 0, thinBars = 0, firstError = null;
  for (const res of results) {
    if (res.pending) continue;   // noch nicht an der Reihe, kein Befund
    if (res.error || res.bars.length < EVE.MIN_BARS) {
      if (res.error) { failedFetch++; if (!firstError) firstError = res.error; }
      else thinBars++;
      continue;
    }
    barsOk++;
    for (const kind of EVE_KINDS) {
      const cand = eveCandidate(res.symbol, res.bars, kind, ctx);
      cand.source = res.source;
      if (cand.ok && cand.plan) rows.push(cand);
      else if (cand.budgetOnly && cand.plan) wide.push(cand);
      else if (cand.geometry && cand.fail.length <= 2) nearMiss.push({ symbol: res.symbol, kind, fail: cand.fail });
      studyCases[kind].push(...eveStudyOne(res.bars, kind, ctx));
    }
  }

  const study = Object.fromEntries(EVE_KINDS.map((k) => [k, eveStudySummary(studyCases[k], k, ctx)]));
  /* Die Rangfolge kommt aus der EURO-Erwartung, nicht aus dem Setup-Gefuehl:
     die Trefferquote der eigenen Art (untere Schranke, ausserhalb der
     Stichprobe gibt es hier nichts zu schoenen) trifft auf die tatsaechliche
     Geometrie des Kandidaten. Eine Art ohne belastbares Urteil liefert KEINEN
     Erwartungswert — und ihre Kandidaten koennen belegte nie ueberholen. */
  for (const c of [...rows, ...wide]) {
    const s = study[c.kind];
    const p = (s && s.verdict !== 'nicht bewertbar' && s.hitPctLower != null) ? s.hitPctLower / 100 : null;
    c.evidence = s ? { n: s.n, verdict: s.verdict, hitPctLower: s.hitPctLower } : null;
    c.evEur = (p != null && c.plan)
      ? Math.round(p * c.plan.winEur - (1 - p) * c.plan.lossEur) : null;
    c.rank = pickTier(s && s.n >= EVE.STUDY_MIN_N ? 'belegt' : 'unbelegt', c.evEur);
    c.liveScore = (c.geometry?.contraction != null ? (1 - c.geometry.contraction) * 50 : 0)
      + (c.geometry?.volRatio != null ? (1 - c.geometry.volRatio) * 30 : 0)
      + (c.plan ? Math.min(20, c.plan.rewardRisk * 5) : 0);
  }
  const ranked = rankPicks(rows).slice(0, EVE.MAX_ROWS);
  const rankedWide = rankPicks(wide).slice(0, 6);

  const payload = {
    ...base, state: 'ok', ts: Date.now(), cached: false,
    checked: universe.length, withBars: barsOk, failedFetch, thinBars, firstError,
    /* Ein Lauf ohne einen einzigen verwertbaren Titel ist KEIN Ergebnis. Ihn
       als solches zu melden, war der eigentliche Fehler dieser Version. */
    dataOk: barsOk > 0 || (deferred > 0 && !failedFetch),
    rows: ranked, wide: rankedWide,
    near: nearMiss.sort((a, b) => a.fail.length - b.fail.length).slice(0, 4),
    study,
    counts: Object.fromEntries(EVE_KINDS.map((k) => [k, ranked.filter((r) => r.kind === k).length])),
    /* FAIL-CLOSED IN DER MELDUNG. Kein Kandidat aus 40 geprueften Titeln ist
       ein Befund. Kein Kandidat aus NULL geprueften Titeln ist ein Ausfall —
       und muss auch so heissen. Die alte Fassung sagte in beiden Faellen
       "ist das der Normalfall" und hat einen Totalausfall beruhigend
       verpackt. */
    deferred, rateLimited,
    note: barsOk === 0 && deferred > 0 && !failedFetch
      ? `Noch keine Tagesbalken im Speicher. Je Lauf werden hoechstens ${EVE.FETCH_BUDGET} neue Titel geholt, `
        + `damit das Stundenlimit nicht reisst — ${deferred} stehen noch aus. Nach einigen Laeufen ist die Liste vollstaendig.`
      : barsOk === 0
      ? `AUSFALL: von ${universe.length} Titeln lieferte KEINER verwertbare Tagesbalken`
        + `${failedFetch ? ` (${failedFetch} Abrufe mit Fehler` + (firstError ? `, erster: ${firstError}` : '') + ')' : ''}`
        + `${thinBars ? ` (${thinBars} Abrufe ohne Fehler, aber mit zu wenigen Balken — typisch, wenn die Antwort kein Datumsfeld enthaelt)` : ''}`
        + `. Das ist kein Ergebnis, sondern ein Datenproblem. Es wird bewusst nichts geschaetzt.`
      : ranked.length
      ? `${ranked.length} Kandidat${ranked.length === 1 ? '' : 'en'} fuer den naechsten Handelstag aus ${barsOk} geprueften Titeln.`
      : `${barsOk} Titel mit geprueften Tagesbalken, kein Kandidat erfuellt alle Huerden. Bei einem Stopbudget von ${r2(maxStopPct)} % ist das der Normalfall.`
        + (deferred ? ` ${deferred} Titel stehen noch aus (Abrufbudget).` : ''),
  };
  if (env?.DB) await eveWriteCache(env, payload, netEur).catch(() => {});
  return payload;
}

/* Tagesbalken je Titel, getrennt vom Gesamtergebnis zwischengespeichert.
   Der Sinn: das Ergebnis veraltet nach sechs Stunden, die BALKEN aber erst am
   naechsten Handelstag. Ohne diese Trennung kostet jeder erneute Lauf wieder
   40 Abrufe — und genau das hat das Stundenlimit gesprengt. */
async function eveReadBars(env, symbols) {
  const out = {};
  if (!env?.DB || !symbols?.length) return out;
  try {
    await ensureD1Schema(env);
    const cutoff = Date.now() - EVE.BARS_TTL_MS;
    const marks = symbols.map(() => '?').join(',');
    const rs = await env.DB.prepare(
      `SELECT key,value,updated_ts FROM fp_meta WHERE key IN (${marks})`)
      .bind(...symbols.map((x) => `evebars:${x}`)).all();
    for (const r of (rs?.results || [])) {
      if (Number(r.updated_ts || 0) < cutoff) continue;
      const sym = String(r.key).slice('evebars:'.length);
      try {
        const bars = JSON.parse(r.value);
        if (Array.isArray(bars) && bars.length >= EVE.MIN_BARS) out[sym] = bars;
      } catch { /* unlesbar heisst nicht vorhanden — nie geraten */ }
    }
  } catch { /* ohne Zwischenspeicher wird normal abgerufen */ }
  return out;
}

async function eveWriteBars(env, items) {
  if (!env?.DB || !items?.length) return;
  try {
    await ensureD1Schema(env);
    const ts = Date.now();
    for (const it of items) {
      const value = safeJson(it.bars);
      if (!value) continue;
      await env.DB.prepare('INSERT INTO fp_meta(key,value,updated_ts) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_ts=excluded.updated_ts')
        .bind(`evebars:${it.symbol}`, value, ts).run();
    }
  } catch { /* Schreibfehler darf den Lauf nicht kippen */ }
}

async function eveReadCache(env) {
  if (!env?.DB) return null;
  try {
    await ensureD1Schema(env);
    const r = await env.DB.prepare('SELECT value,updated_ts FROM fp_meta WHERE key=? LIMIT 1').bind('evening:last').first();
    if (!r?.value) return null;
    const p = JSON.parse(r.value);
    return p?.payload ? { ts: Number(p.ts || r.updated_ts || 0), netEur: Number(p.netEur), payload: p.payload } : null;
  } catch { return null; }
}
async function eveWriteCache(env, payload, netEur) {
  if (!env?.DB) return;
  await ensureD1Schema(env);
  const ts = Date.now(), value = safeJson({ ts, netEur, payload });
  if (!value) return;
  await env.DB.prepare('INSERT INTO fp_meta(key,value,updated_ts) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_ts=excluded.updated_ts')
    .bind('evening:last', value, ts).run();
}

/* ============================================================================
   v3.17.0 · MUSTERLABOR — was ging einem Anstieg voraus, was einem Abfall?
   ----------------------------------------------------------------------------
   DIE UR-IDEE: Der Cron zeichnet seit v3.0 jede Minute Snapshots in D1 auf.
   Jeder Snapshot traegt neun gemessene Kennzahlen UND — nach Ablauf des
   Lernhorizonts — sein tatsaechliches Ergebnis (`max_pct`/`min_pct`). Damit
   laesst sich die Frage beantworten, die noch nie gestellt wurde:
   *Sahen die Titel, die danach stiegen, VORHER anders aus als die, die fielen?*

   Das ist eine Ereignisstudie, kein Modell. Sie sagt nicht voraus. Sie zeigt,
   ob in den aufgezeichneten Daten ueberhaupt ein Unterschied steckt — und
   zeigt genauso deutlich, wenn KEINER drin ist. Der zweite Fall ist der
   wahrscheinlichere und der wertvollere: dann weiss der Nutzer, dass diese
   Kennzahlen die Bewegung nicht ankuendigen, statt es weiter zu vermuten.

   VIER EHRLICHKEITSREGELN, die hier haerter greifen als sonst irgendwo:
   1. Nur AUFGELOESTE Snapshots (`resolved_ts`). Kein Repainting.
   2. Episoden statt Snapshots: 5-Minuten-Aufnahmen derselben Bewegung sind
      keine unabhaengigen Faelle. `collapseEpisodes()` wie in Modul 0.
   3. Unter ATTR.MIN_SAMPLE je Gruppe gibt es KEIN Urteil — die Kennzahl wird
      als "zu wenige Faelle" ausgewiesen, nicht als schwacher Effekt.
   4. Die Trennschaerfe wird gegen eine ZUFALLSGRENZE gestellt. Bei kleinem n
      erreicht auch reines Rauschen scheinbar hohe Werte; die Grenze waechst
      deshalb mit sinkendem n. Wer sie nicht reisst, gilt als "kein Signal".

   0 % Gewicht in Score, Gate, Ampel und Freigabe. Reine Beobachtung.
   ============================================================================ */
const PATTERN_FEATURES = [
  ['rvol',      'RVOL',              'rv'],
  ['ret15',     'Bewegung 15 Min',   'r15'],
  ['ret60',     'Bewegung 60 Min',   'r60'],
  ['atr_pct',   'Schwankungsbreite', 'atr'],
  ['score',     'Score',             'score'],
  ['crv',       'CRV',               'crv'],
  ['liquidity_vacuum','Liquiditaetsvakuum','vac'],
  ['sector_lag','Sektor-Rueckstand', 'lag'],
  ['crowd_score','Crowd/Search',     'crowd'],
  ['structure_pct','Strukturpotenzial','structure'],
];
const PATTERN = {
  WINDOW_MS: 14*24*60*60_000,  // zwei Wochen: genug Faelle, ohne die CPU zu sprengen
  ROW_LIMIT: 6000,
  PRE_MIN: 60, POST_MIN: 120, STEP_MIN: 5,   // Verlaufsfenster um das Ereignis
};
/** Flaeche unter der ROC-Kurve ohne Sortierbibliothek: Wahrscheinlichkeit, dass
 *  ein zufaelliger Fall aus A einen hoeheren Wert hat als einer aus B.
 *  0,5 = kein Unterschied. Bindungen zaehlen als halber Treffer. */
function aucSeparation(a, b){
  const A=a.filter(Number.isFinite), B=b.filter(Number.isFinite);
  if(!A.length || !B.length) return null;
  let wins=0;
  for(const x of A) for(const y of B) wins += x>y ? 1 : x===y ? 0.5 : 0;
  return wins/(A.length*B.length);
}
/** Inverse Standardnormalverteilung (Acklam-Naeherung, Fehler < 1e-9 im
 *  benoetigten Bereich). Gebraucht fuer die Mehrfachtestkorrektur unten. */
function zQuantile(p){
  if(!(p>0&&p<1)) return NaN;
  const a=[-3.969683028665376e+01,2.209460984245205e+02,-2.759285104469687e+02,1.383577518672690e+02,-3.066479806614716e+01,2.506628277459239e+00];
  const b=[-5.447609879822406e+01,1.615858368580409e+02,-1.556989798598866e+02,6.680131188771972e+01,-1.328068155288572e+01];
  const c=[-7.784894002430293e-03,-3.223964580411365e-01,-2.400758277161838e+00,-2.549732539343734e+00,4.374664141464968e+00,2.938163982698783e+00];
  const d=[7.784695709041462e-03,3.224671290700398e-01,2.445134137142996e+00,3.754408661907416e+00];
  const pl=0.02425;
  if(p<pl){const q=Math.sqrt(-2*Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);}
  if(p>1-pl){const q=Math.sqrt(-2*Math.log(1-p));
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);}
  const q=p-0.5,r=q*q;
  return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q/(((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
}
/** Ab welcher Trennschaerfe ist der Wert bei DIESER Stichprobe mehr als Zufall?
 *  Naeherung ueber die Standardabweichung der AUC unter der Nullhypothese
 *  (Hanley/McNeil-Vereinfachung).
 *
 *  MEHRFACHTESTKORREKTUR, und zwar aus einem konkreten Anlass: Der erste Entwurf
 *  pruefte alle zehn Kennzahlen gegen 95 %. Bei zehn gleichzeitigen Tests findet
 *  man dann rein rechnerisch in jedem zweiten Durchlauf eine "Entdeckung", die
 *  keine ist — der Regressionstest hat genau das sofort aufgedeckt. Modul 0
 *  korrigiert seit v3.5.4 aus demselben Grund (siehe ATTR/Bonferroni).
 *  Die Schwelle wird deshalb auf die ZAHL DER GEPRUEFTEN KENNZAHLEN bezogen:
 *  alpha = 0,05 / k. Bei k=10 entspricht das z = 2,81 statt 1,96 — die Huerde
 *  steigt sichtbar, und das ist beabsichtigt. Lieber ein echter Fund weniger
 *  als eine erfundene Regelmaessigkeit, die wie Wissen aussieht. */
function aucNoiseFloor(nA, nB, tests=1){
  if(!(nA>0 && nB>0)) return null;
  const k=Math.max(1,Number(tests)||1);
  const z=zQuantile(1-0.05/(2*k));
  const sd=Math.sqrt((nA+nB+1)/(12*nA*nB));
  return Math.min(0.98, 0.5 + z*sd);
}
function medianOf(arr){
  const v=arr.filter(Number.isFinite).sort((x,y)=>x-y);
  if(!v.length) return null;
  const m=Math.floor(v.length/2);
  return v.length%2 ? v[m] : (v[m-1]+v[m])/2;
}
async function patternLab(env){
  if(!env?.DB) return {configured:false,state:'nodb',
    note:'Ohne D1-Verbindung gibt es keine Aufzeichnung und damit nichts auszuwerten.',version:APP_VERSION};
  await ensureD1Schema(env);
  const since=Date.now()-PATTERN.WINDOW_MS;
  const rows=(await env.DB.prepare(
    `SELECT symbol,ts,bucket5,price,score,crv,rvol,ret15,ret60,atr_pct,liquidity_vacuum,
            sector_lag,crowd_score,structure_pct,max_pct,min_pct,resolved_ts,payload
     FROM market_snapshots
     WHERE asset_type='stock' AND source IN ('Twelve Data','Tiingo IEX') AND ts>=?
     ORDER BY ts ASC LIMIT ${PATTERN.ROW_LIMIT}`).bind(since).all()).results||[];

  // --- Ereignisse: nur aufgeloeste Faelle, danach zu Episoden zusammengefasst.
  const resolved=rows.filter(r=>r.resolved_ts!=null);
  const episodes=collapseEpisodes(resolved);
  const groupOf=(r)=>Number(r.max_pct)>=ATTR.WIN_PCT ? 'up'
    : Number(r.min_pct)<=ATTR.STOP_PCT ? 'down' : 'flat';
  const groups={up:[],down:[],flat:[]};
  for(const e of episodes) groups[groupOf(e)].push(e);

  // --- Fingerabdruck: Median je Kennzahl und Gruppe + Trennschaerfe up/down.
  const features=PATTERN_FEATURES.map(([col,label])=>{
    const val=(g)=>groups[g].map(x=>Number(x[col]));
    const up=val('up'), down=val('down');
    const nUp=up.filter(Number.isFinite).length, nDown=down.filter(Number.isFinite).length;
    const auc=aucSeparation(up,down), floor=aucNoiseFloor(nUp,nDown,PATTERN_FEATURES.length);
    const enough=nUp>=ATTR.MIN_SAMPLE && nDown>=ATTR.MIN_SAMPLE;
    // Fail-closed: zu wenige Faelle ergeben KEIN schwaches Urteil, sondern gar keines.
    const verdict = !enough ? 'zu wenige Fälle'
      : auc==null ? 'nicht messbar'
      : (auc>=floor ? 'trennt' : auc<=1-floor ? 'trennt invers' : 'kein Signal');
    return {key:col,label,
      medianUp:medianOf(up), medianDown:medianOf(down), medianFlat:medianOf(val('flat')),
      nUp,nDown, auc:auc==null?null:+auc.toFixed(3),
      noiseFloor:floor==null?null:+floor.toFixed(3), enough, verdict};
  });

  /* --- Kursverlauf um das Ereignis. Der Snapshot-Raster ist bewusst LUECKIG:
     der Deep-Scan sieht pro Zyklus nur rund 20 von bis zu 80 Titeln. Es wird
     deshalb je Zeitfenster gemittelt, was DA ist, und die Zahl der Beitraege
     mitgeliefert — statt Luecken zu interpolieren und Dichte vorzutaeuschen. */
  const bySymbol=new Map();
  for(const r of rows){ const k=String(r.symbol);
    (bySymbol.get(k) ?? bySymbol.set(k,[]).get(k)).push(r); }
  const offsets=[]; for(let m=-PATTERN.PRE_MIN;m<=PATTERN.POST_MIN;m+=PATTERN.STEP_MIN) offsets.push(m);
  const acc={up:new Map(),down:new Map(),flat:new Map()};
  for(const g of ['up','down','flat']) for(const m of offsets) acc[g].set(m,[]);
  for(const g of ['up','down','flat']){
    for(const anchor of groups[g].slice(0,400)){
      const base=Number(anchor.price); if(!(base>0)) continue;
      const list=bySymbol.get(String(anchor.symbol))||[];
      for(const r of list){
        const dm=Math.round((Number(r.ts)-Number(anchor.ts))/60_000);
        if(dm<-PATTERN.PRE_MIN||dm>PATTERN.POST_MIN) continue;
        const slot=Math.round(dm/PATTERN.STEP_MIN)*PATTERN.STEP_MIN;
        const px=Number(r.price); if(!(px>0)) continue;
        acc[g].get(slot)?.push((px/base-1)*100);
      }
    }
  }
  const path=Object.fromEntries(['up','down','flat'].map(g=>[g,
    offsets.map(m=>{ const v=acc[g].get(m)||[];
      return {m, pct:v.length?+(medianOf(v)).toFixed(3):null, n:v.length}; })]));

  /* --- v3.18.0 · KALIBRIERUNG AUS VORHANDENEN DATEN -------------------------
     Seit v3.9.0 steht dreimal "geraten, nicht gemessen" auf der offenen Liste,
     mit der Begruendung, es brauche Zaehler aus einem laufenden Handelstag.
     DAS STIMMT NICHT: `max_pct` und `atr_pct` liegen laengst je Snapshot in D1.

     Gerechnet wird die Verteilung von `max_pct / atr_pct` — wie viele
     Schwankungsbreiten eine Bewegung NACH der Aufzeichnung noch laeuft. Genau
     diese Zahl braucht die Zielformel, die heute `1,0 x Tagesspanne` raet.

     Ausgewiesen werden Perzentile UND die Erreichungsquote je Vielfachem. Die
     Quote ist die ehrlichere Zahl: "Ziel bei 1,0 ATR wurde in 38 % der Faelle
     erreicht" sagt mehr als jedes Perzentil. Unter ATR.MIN_SAMPLE gibt es
     wieder KEIN Ergebnis, nur den Fuellstand. */
  const ratios=episodes.map(e=>{
    const atr=Number(e.atr_pct), mx=Number(e.max_pct);
    return (atr>0 && Number.isFinite(mx)) ? mx/atr : null;
  }).filter(Number.isFinite).sort((a,b)=>a-b);
  const pct=(q)=>ratios.length?+(ratios[Math.min(ratios.length-1,Math.floor(q*ratios.length))]).toFixed(2):null;
  const hitRate=(k)=>ratios.length?Math.round(ratios.filter(x=>x>=k).length/ratios.length*100):null;
  let withDollarVol=0;
  for(const e of episodes){ try{ if(JSON.parse(e.payload||'{}').dollarVol!=null) withDollarVol++; }catch{} }
  const calibration={
    n:ratios.length, enough:ratios.length>=ATTR.MIN_SAMPLE,
    p50:pct(0.50), p60:pct(0.60), p75:pct(0.75), p90:pct(0.90),
    reach:[0.5,1,1.5,2,3].map(k=>({k, pct:hitRate(k)})),
    currentTargetMultiple:1.0,
    dollarVolCoverage:{withDollarVol,total:episodes.length},
    note: ratios.length>=ATTR.MIN_SAMPLE
      ? 'Gemessen an aufgeloesten Aufzeichnungen: so viele Schwankungsbreiten lief eine Bewegung nach der Aufzeichnung noch. Beschreibt die Vergangenheit, setzt nichts automatisch.'
      : `Noch ${ATTR.MIN_SAMPLE-ratios.length} Episoden bis zur ersten belastbaren Messung.`,
  };

  // --- Situationstypen: erst ab v3.17.0 aufgezeichnet. Ehrlich ausweisen.
  let withSituation=0;
  for(const e of episodes){ try{ if(JSON.parse(e.payload||'{}').situation) withSituation++; }catch{} }

  const nTotal=episodes.length;
  const enoughOverall=groups.up.length>=ATTR.MIN_SAMPLE && groups.down.length>=ATTR.MIN_SAMPLE;
  return {
    configured:true, state:nTotal?'ok':'empty',
    windowDays:Math.round(PATTERN.WINDOW_MS/86_400_000),
    rowsScanned:rows.length, rowsCapped:rows.length>=PATTERN.ROW_LIMIT,
    resolvedRows:resolved.length, episodes:nTotal,
    counts:{up:groups.up.length,down:groups.down.length,flat:groups.flat.length},
    minSample:ATTR.MIN_SAMPLE, winPct:ATTR.WIN_PCT, stopPct:ATTR.STOP_PCT, legacyWinPct:LEGACY_WIN_PCT,
    enoughOverall, features, offsets, path, calibration,
    situationCoverage:{withSituation,total:nTotal,
      note:'Die Situationstypen werden erst seit v3.17.0 mitgeschrieben. Aeltere Aufzeichnungen kennen sie nicht — das laesst sich nicht rueckwirkend ergaenzen.'},
    note: !nTotal ? 'Noch keine aufgeloesten Aufzeichnungen im Fenster.'
      : enoughOverall ? 'Ereignisstudie ueber aufgeloeste Aufzeichnungen. Beschreibt, was VOR der Bewegung messbar war — keine Vorhersage, 0 % Gewicht in Score und Freigabe.'
      : `Zu wenige Faelle fuer ein Urteil: mindestens ${ATTR.MIN_SAMPLE} je Gruppe noetig. Angezeigt wird der Zwischenstand, bewertet wird nichts.`,
    version:APP_VERSION,
  };
}

/* ============================================================================
   PAKET A · MODUL 0 SCHARF: Stummschalten + Rehabilitation (v3.5.7, additiv)
   ----------------------------------------------------------------------------
   "Abschalten" bedeutet NICHT loeschen, sondern STUMMSCHALTEN: das Setup wird
   nicht mehr als BUY vorgeschlagen, aber die Auswertung laeuft im Hintergrund
   weiter (der Cron sammelt jede Minute Snapshots, unabhaengig vom PC). Dadurch
   kann ein gestummtes Setup, das sich out-of-sample wieder erholt, eine
   Wiedereinschalt-Empfehlung ausloesen.

   HYSTERESE gegen Flackern: Die Wiedereinschalt-Huerde liegt bewusst HOEHER als
   die Abschalt-Huerde. Sonst wuerde Stichprobenrauschen das System nervoes
   zwischen an/aus springen lassen. Ausserdem gilt eine Mindest-Stummdauer,
   bevor ueberhaupt ueber Rehabilitation nachgedacht wird.

   Die Stummliste liegt in D1 (fp_meta key 'muted_setups'), damit sie
   serverseitig gilt - der Cron/Scan respektiert sie auch bei geschlossener PWA.
   Sie veraendert KEINEN Score; sie unterdrueckt nur die BUY-Freigabe fuer
   betroffene Setups (reine Anzeige-/Freigabeschicht).
   ============================================================================ */
const REHAB = {
  MIN_MUTE_MS: 5*24*60*60_000,   // erst nach 5 Tagen Stummschaltung ueber Rehab nachdenken
  REENABLE_POINT: 52,            // OOS-Punktschaetzung >= 52 % (Abschaltung war < 40 %)
  REENABLE_WILSON: 45,           // UND Wilson-Untergrenze >= 45 % (Abschaltung war < 33 %)
  REENABLE_OOS_MIN: 15,          // UND mindestens so viele neue OOS-Episoden
};
let mutedMemo={map:null,ts:0};
async function readMutedSetups(env){
  if(mutedMemo.map && Date.now()-mutedMemo.ts<30_000) return mutedMemo.map;
  const map={};
  if(env?.DB){
    try{
      await ensureD1Schema(env);
      const row=await env.DB.prepare('SELECT value FROM fp_meta WHERE key=? LIMIT 1').bind('muted_setups').first();
      if(row?.value){ const p=JSON.parse(row.value); if(p&&typeof p==='object') Object.assign(map,p); }
    }catch(e){ console.warn(JSON.stringify({event:'muted_read_failed',message:String(e?.message||e),ts:Date.now()})); }
  }
  mutedMemo={map,ts:Date.now()};
  return map;
}
async function writeMutedSetups(env, map){
  mutedMemo={map,ts:Date.now()};
  if(!env?.DB) return map;
  try{
    await ensureD1Schema(env);
    await env.DB.prepare('INSERT INTO fp_meta(key,value,updated_ts) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_ts=excluded.updated_ts')
      .bind('muted_setups',JSON.stringify(map),Date.now()).run();
  }catch(e){ console.warn(JSON.stringify({event:'muted_write_failed',message:String(e?.message||e),ts:Date.now()})); }
  return map;
}
/** Setup stummschalten (Grund + Zeitstempel festhalten). */
async function muteSetup(env, setup, reason){
  const key=String(setup||'').trim(); if(!key) return {ok:false,error:'kein Setup angegeben'};
  const map=await readMutedSetups(env);
  map[key]={mutedTs:Date.now(),reason:String(reason||'manuell')};
  await writeMutedSetups(env,map);
  return {ok:true,muted:key,map};
}
/** Stummschaltung aufheben (Rehabilitation bestaetigt oder manuell). */
async function unmuteSetup(env, setup){
  const key=String(setup||'').trim(); if(!key) return {ok:false,error:'kein Setup angegeben'};
  const map=await readMutedSetups(env);
  if(map[key]) delete map[key];
  await writeMutedSetups(env,map);
  return {ok:true,unmuted:key,map};
}
/** Ist ein Setup aktuell stummgeschaltet? (fuer die BUY-Freigabe im Scan) */
function isSetupMuted(mutedMap, setup){
  const key=String(setup||'').trim();
  return !!(mutedMap && mutedMap[key]);
}

/** Kernauswertung: gruppiert resolved Snapshots nach Setup und Lifecycle,
 *  liefert je Bucket eine ehrliche Bewertung inkl. Guard-Verdikt. */
async function claudeAttribution(env){
  if(!env?.DB) return {configured:false,state:'nodb',version:APP_VERSION};
  await ensureD1Schema(env);
  const since=Date.now()-ATTR.HISTORY_MS;
  // Nur aufgeloeste Aktien-Snapshots mit bekanntem Ergebnis. payload traegt das Setup.
  const rows=(await env.DB.prepare(
    `SELECT symbol,ts,max_pct,min_pct,success_ts,light,score,crv,payload
     FROM market_snapshots
     WHERE asset_type='stock' AND source IN ('Twelve Data','Tiingo IEX')
       AND resolved_ts IS NOT NULL AND ts>=? ORDER BY ts ASC LIMIT 8000`
  ).bind(since).all()).results||[];
  // Nach Setup gruppieren (aus payload). Fallback 'unklassifiziert'.
  const bySetup=new Map();
  for(const r of rows){
    let setup='unklassifiziert';
    try{ const p=JSON.parse(r.payload||'{}'); if(p.setup) setup=String(p.setup); }catch{}
    (bySetup.get(setup)??bySetup.set(setup,[]).get(setup)).push(r);
  }
  const buckets=[];
  for(const [setup,rs] of bySetup){
    const episodes=collapseEpisodes(rs);
    const st=bucketStats(episodes);
    buckets.push({ key:setup, ...st });
  }
  // Mehrfachtestkorrektur: je mehr Buckets mit ausreichender Stichprobe parallel
  // geprueft werden, desto strenger die Edge-Schwelle (Bonferroni-artig auf die
  // Wilson-Untergrenze). So wird nicht zufaellig das beste von vielen gefeiert.
  const testable=buckets.filter(b=>b.n>=ATTR.MIN_SAMPLE);
  const m=Math.max(1,testable.length);
  const bonferroniBump=Math.min(8,Math.round((1-1/Math.sqrt(m))*12)); // 0..~8 Punkte strenger auf die Punktschaetzung
  const verdictFor=(b)=>{
    if(b.n<ATTR.MIN_SAMPLE) return {status:'sammelt',reason:`${b.n}/${ATTR.MIN_SAMPLE} Episoden – zu wenig fuer ein Urteil`};
    if(!b.oos||b.oosN<ATTR.OOS_MIN) return {status:'sammelt',reason:`Out-of-Sample zu klein (${b.oosN}/${ATTR.OOS_MIN})`};
    const inP=b.inSample?.pct??0, oosP=b.oos?.pct??0, oosWilson=b.oos?.wilson??0;
    const drop=inP-oosP;
    // Overfitting bleibt der schaerfste Befund: gute Vergangenheit, die out-of-sample bricht.
    if(drop>=ATTR.OVERFIT_DROP && oosP < inP) return {status:'overfit',reason:`In-Sample ${inP}% bricht auf ${oosP}% ein (Δ${drop}pp) – Overfitting-Verdacht`};
    const pointWeak = oosP < (ATTR.DISABLE_POINT + bonferroniBump);
    const wilsonWeak = oosWilson < ATTR.DISABLE_WILSON;
    // Abschaltung nur, wenn BEIDE Kriterien schwach sind UND genug OOS-Evidenz vorliegt.
    // Sonst wuerde ein breites Konfidenzintervall (kleines n) echte Gewinner faelschlich toeten.
    if(pointWeak && wilsonWeak && b.oosN>=ATTR.OOS_CONFIDENT)
      return {status:'disable',reason:`OOS ${oosP}% (Wilson ${oosWilson}%) unter Schwelle ${ATTR.DISABLE_POINT+bonferroniBump}%/${ATTR.DISABLE_WILSON}% bei n=${b.oosN} – Abschaltung empfohlen`};
    if(pointWeak && wilsonWeak)
      return {status:'weak-watch',reason:`OOS schwach (${oosP}%, Wilson ${oosWilson}%), aber nur ${b.oosN} OOS-Episoden – erst mehr Daten, dann Entscheidung`};
    if(pointWeak)
      return {status:'weak-watch',reason:`OOS-Punktschaetzung ${oosP}% grenzwertig, Wilson ${oosWilson}% aber tragfaehig – beobachten`};
    return {status:'keep',reason:`OOS ${oosP}% (Wilson ${oosWilson}%) haelt In-Sample ${inP}% stand`};
  };
  const evaluated=buckets.map(b=>({...b,verdict:verdictFor(b)}))
    .sort((a,b)=>(b.oos?.wilson??-1)-(a.oos?.wilson??-1)||b.n-a.n);
  // Stummliste einlesen und je Bucket den Mute-Status + Rehabilitations-Pruefung anhaengen.
  const muted=await readMutedSetups(env);
  const now=Date.now();
  for(const b of evaluated){
    const m=muted[b.key];
    b.muted = !!m;
    b.mutedSince = m?.mutedTs || null;
    b.mutedDays = m?.mutedTs ? Math.floor((now-m.mutedTs)/86400000) : null;
    // Rehabilitation: nur fuer gestummte Setups, nach Mindest-Stummdauer, mit
    // HOEHEREN Schwellen als die Abschaltung (Hysterese) und genug neuer OOS-Evidenz.
    b.rehabEligible=false;
    if(m && (now-m.mutedTs)>=REHAB.MIN_MUTE_MS && b.oos){
      const oosP=b.oos.pct??0, oosW=b.oos.wilson??0, oosN=b.oosN||0;
      if(oosP>=REHAB.REENABLE_POINT && oosW>=REHAB.REENABLE_WILSON && oosN>=REHAB.REENABLE_OOS_MIN){
        b.rehabEligible=true;
        b.rehabReason=`gestummt seit ${b.mutedDays} T · OOS wieder ${oosP}% (Wilson ${oosW}%, n=${oosN}) ueber Reaktivierungs-Schwelle ${REHAB.REENABLE_POINT}%/${REHAB.REENABLE_WILSON}% – Wiedereinschaltung empfohlen`;
      }
    }
  }
  // Abschalt-Empfehlungen: nur fuer NICHT bereits gestummte Setups (sonst doppelt).
  const disableRecs=evaluated.filter(b=>!b.muted && (b.verdict.status==='disable'||b.verdict.status==='overfit'))
    .map(b=>({setup:b.key,status:b.verdict.status,reason:b.verdict.reason,n:b.n,oosWilson:b.oos?.wilson??null}));
  // Wiedereinschalt-Empfehlungen fuer erholte gestummte Setups.
  const reenableRecs=evaluated.filter(b=>b.rehabEligible)
    .map(b=>({setup:b.key,reason:b.rehabReason,mutedDays:b.mutedDays,oosWilson:b.oos?.wilson??null}));
  const mutedList=Object.entries(muted).map(([setup,m])=>({setup,mutedSince:m.mutedTs,mutedDays:Math.floor((now-m.mutedTs)/86400000),reason:m.reason}));
  return {
    configured:true, state:'ok', version:APP_VERSION,
    horizonDays:Math.round(ATTR.HISTORY_MS/86400000),
    totalEpisodes:rows.length, testableSetups:testable.length,
    multiTestPenalty:bonferroniBump, guard:ATTR, rehab:REHAB,
    buckets:evaluated, disableRecommendations:disableRecs,
    reenableRecommendations:reenableRecs, mutedSetups:mutedList,
    note:'Reine Auswertung aufgeloester Outcomes. Stummschalten unterdrueckt BUY-Freigabe, veraendert keinen Score. Auswertung laeuft im Hintergrund weiter (Cron).',
  };
}

/* ============================================================================
   MODUL 1 · ALADDIN-STYLE MARKET INTELLIGENCE (v3.5.5, additiv)
   ----------------------------------------------------------------------------
   Nicht "noch ein Indikator", sondern eine hierarchische Marktmeinung aus den
   bereits vorhandenen Zeilen-Signalen. Der Layer speist die Empfehlung OBERHALB
   des Radars; er veraendert WEDER den Claude- noch den FusionPulse-Score. Die
   Kombination (Setup x Marktpassung) passiert in einer eigenen, ungelockten
   Schicht (marketRecommendation), damit Modul 0 Setup-Edge und Markt-Edge
   getrennt tracken kann.

   EHRLICHKEITS-PRINZIP (wie Modul 0): Unsere Marktabdeckung ist eine Stichprobe
   (20-40 rotierende Titel), kein Vollmarkt. Jede Ebene weist ihre Datenbasis und
   eine Konfidenz aus. Eine Breadth-Aussage aus 22 Titeln ist eine Stichprobe,
   kein Marktbreite-Index - und wird genau so etikettiert. Lieber ehrlich
   unsicher als selbstsicher falsch.
   ============================================================================ */
const ALADDIN = {
  MIN_SAMPLE_REGIME: 12,   // darunter: Regime = 'Unklar' mit niedriger Konfidenz
  MIN_SECTOR_MEMBERS: 3,   // Sektor-Aussage erst ab so vielen Titeln im Sektor
  RISK_ON_THRESH: 0.60,    // Anteil positiver/starker Titel fuer Risk-On-Neigung
  RISK_OFF_THRESH: 0.35,
};
const clampNum=(x,lo,hi)=>Math.max(lo,Math.min(hi,Number.isFinite(Number(x))?Number(x):lo));
/** Konfidenz aus Stichprobengroesse: klein -> niedrig, wird nie 100 %. */
function sampleConfidence(n, floor=12, full=40){
  if(n<=0) return 0;
  return Math.round(clampNum((n-floor)/(full-floor),0,1)*70 + Math.min(30, n/full*30));
}
/** Regime aus Zeilen-Signalen: Anteil Titel ueber VWAP, positive ret60,
 *  RVOL-Schub, Situationsdruck. Alles bereits pro Zeile vorhanden. */
function aladdinRegime(rows){
  const usable=rows.filter(r=>r && Number.isFinite(Number(r.ret60)));
  const n=usable.length;
  if(n<ALADDIN.MIN_SAMPLE_REGIME){
    return {label:'Unklar',prob:50,confidence:sampleConfidence(n),sample:n,
      reasons:[`nur ${n} analysierbare Titel – zu duenn fuer eine belastbare Regime-Aussage`],
      breadth:null,thin:true};
  }
  const above=usable.filter(r=>r.aboveVwap===true).length;
  const posRet60=usable.filter(r=>Number(r.ret60)>0).length;
  const strongRvol=usable.filter(r=>Number(r.relVol)>=1.5).length;
  const breadth=posRet60/n;                       // Anteil Titel mit positivem 1h-Return
  const vwapBreadth=above/n;
  const rvolShare=strongRvol/n;
  // gewichteter Risk-On-Score 0..1
  const riskOnScore=clampNum(breadth*0.5 + vwapBreadth*0.3 + rvolShare*0.2,0,1);
  let label='Neutral';
  if(riskOnScore>=ALADDIN.RISK_ON_THRESH) label='Risk-On';
  else if(riskOnScore<=ALADDIN.RISK_OFF_THRESH) label='Risk-Off';
  const prob=Math.round(riskOnScore*100);
  const reasons=[];
  reasons.push(`${Math.round(breadth*100)} % der Titel mit positivem 1h-Return (Breadth)`);
  reasons.push(`${Math.round(vwapBreadth*100)} % ueber VWAP`);
  if(rvolShare>=0.3) reasons.push(`${Math.round(rvolShare*100)} % mit RVOL ≥ 1,5x – Volumen bestaetigt Bewegung`);
  else reasons.push(`nur ${Math.round(rvolShare*100)} % mit erhoehtem Volumen – Bewegung schwach getragen`);
  return {label,prob,confidence:sampleConfidence(n),sample:n,breadth:+breadth.toFixed(2),
    vwapBreadth:+vwapBreadth.toFixed(2),rvolShare:+rvolShare.toFixed(2),riskOnScore:+riskOnScore.toFixed(2),
    reasons,thin:n<20};
}
/** Sektor-Rotation: relative Staerke je Sektor (ret15/ret60), Volumen, Beschleunigung.
 *  Nur Sektoren mit genug Mitgliedern werden bewertet; Rest = 'zu wenig Daten'. */
function aladdinSectors(rows){
  const bySector=new Map();
  for(const r of rows){
    const s=r?.sector; if(!s||s==='Discovery') continue;
    (bySector.get(s)??bySector.set(s,[]).get(s)).push(r);
  }
  const sectors=[];
  for(const [sector,rs] of bySector){
    const n=rs.length;
    const avg=(f)=>{const v=rs.map(x=>Number(x[f])).filter(Number.isFinite);return v.length?v.reduce((a,b)=>a+b,0)/v.length:null;};
    const ret15=avg('ret15'), ret60=avg('ret60'), rvol=avg('relVol');
    const accel=(ret15!=null&&ret60!=null)?(ret15 - ret60/4):null; // 15m-Tempo vs. 1h-Grundtrend
    if(n<ALADDIN.MIN_SECTOR_MEMBERS){
      sectors.push({sector,members:n,status:'zu wenig Daten',ret15:r1(ret15),ret60:r1(ret60),rvol:r1(rvol),thin:true});
      continue;
    }
    // Trend: kombiniert 1h-Grundrichtung, 15m-Beschleunigung, Volumenbestaetigung
    const trendScore=(ret60||0)*0.5 + (accel||0)*0.8 + ((rvol||1)-1)*1.5;
    const arrow=trendScore>=1.2?'↑':trendScore<=-1.2?'↓':'→';
    sectors.push({sector,members:n,status:'ok',arrow,
      ret15:r1(ret15),ret60:r1(ret60),rvol:r1(rvol),accel:r1(accel),trendScore:+trendScore.toFixed(2),thin:false});
  }
  const rated=sectors.filter(s=>s.status==='ok').sort((a,b)=>b.trendScore-a.trendScore);
  return {
    leaders:rated.filter(s=>s.arrow==='↑').slice(0,3),
    laggards:rated.filter(s=>s.arrow==='↓').slice(0,3),
    all:sectors.sort((a,b)=>(b.trendScore??-99)-(a.trendScore??-99)),
    ratedCount:rated.length,
  };
}
/** Stress-Layer: atypische Zustaende in der Stichprobe (Spread/ATR/Korrelation/
 *  Liquiditaet). Ehrlich als Stichproben-Signal, nicht als VIX-Ersatz. */
function aladdinStress(rows, regime){
  const usable=rows.filter(r=>r&&Number.isFinite(Number(r.atrPct)));
  const n=usable.length;
  const flags=[];
  if(n>=8){
    const atrs=usable.map(r=>Number(r.atrPct)).sort((a,b)=>a-b);
    const medATR=atrs[Math.floor(atrs.length/2)];
    if(medATR>=4) flags.push(`erhoehte Volatilitaet (Median-ATR ${medATR.toFixed(1)} %)`);
    // Korrelations-Proxy: laufen fast alle Titel gleichgerichtet? (Konzentrationsrisiko)
    const up=usable.filter(r=>Number(r.ret60)>0).length/n;
    if(up>=0.85||up<=0.15) flags.push(`hohe Gleichrichtung (${Math.round(up*100)} % gleiche Richtung) – wenig Diversifikation`);
    const wideSpread=usable.filter(r=>r.spreadPct!=null&&Number(r.spreadPct)>=0.15).length;
    if(wideSpread/n>=0.3) flags.push(`${Math.round(wideSpread/n*100)} % mit weiten Spreads – Liquiditaet angespannt`);
  }
  const level=flags.length>=2?'erhoeht':flags.length===1?'leicht':'normal';
  return {level,flags,sample:n,thin:n<12};
}
/** Szenario-/Stress-What-if: verschiebt Kandidaten-Kennzahlen unter Annahmen
 *  (Nasdaq -1 %, Renditen +10bp -> Tech-Beta-Druck, BTC -3 % -> Krypto-nahe Titel).
 *  Bewusst als lineare Sensitivitaet gekennzeichnet, kein echtes Faktormodell. */
function aladdinScenario(candidates, shock){
  // shock: {nasdaqPct, yieldBp, btcPct}. Grobe, transparente Beta-Annahmen.
  const nas=Number(shock?.nasdaqPct)||0, yld=Number(shock?.yieldBp)||0, btc=Number(shock?.btcPct)||0;
  return candidates.map(c=>{
    const cryptoProxy=/MSTR|COIN|MARA|RIOT|CLSK|HOOD|HUT/i.test(c.symbol)?1:0;
    const techBeta=/Semiconduct|Software|Technolog|Info/i.test(c.sector||'')?1.2:0.8;
    // lineare Naeherung: Marktschock * Beta + Zins-Gegenwind fuer Tech + BTC-Kopplung
    const est=nas*techBeta + (yld/10)*-0.4*techBeta + (cryptoProxy?btc*0.9:0);
    return {symbol:c.symbol, estMovePct:+est.toFixed(2),
      note:cryptoProxy?'krypto-gekoppelt':techBeta>1?'zinssensitiv (Tech-Beta)':'defensiver'};
  });
}

/** KOMBINATIONSSCHICHT (ungelockt, von Modul 0 trackbar):
 *  finaleEmpfehlung = Setup-Qualitaet x Marktpassung x Liquiditaet.
 *  Aendert NICHTS am Claude-/FusionPulse-Score, sondern re-rankt die vorhandenen
 *  Kandidaten nach Passung zum aktuellen Marktregime. Late-Chases werden
 *  abgewertet, Titel im fuehrenden Sektor bevorzugt. */
function marketRecommendation(rows, regime, sectors){
  const leaderSet=new Set(regime.label==='Risk-On'?sectors.leaders.map(s=>s.sector):[]);
  const laggardSet=new Set(sectors.laggards.map(s=>s.sector));
  const scored=rows.filter(r=>r&&r.light&&r.volumeKnown!==false).map(r=>{
    const setupQ=clampNum(Number(r.score)||0,0,10)/10;
    // Marktpassung: fuehrt der Sektor? passt Richtung zum Regime? nicht ueberdehnt?
    let fit=0.5;
    if(leaderSet.has(r.sector)) fit+=0.25;
    if(laggardSet.has(r.sector)) fit-=0.25;
    if(regime.label==='Risk-On' && r.aboveVwap===true) fit+=0.1;
    if(regime.label==='Risk-Off' && r.aboveVwap===true) fit-=0.15; // Long im Risk-Off skeptisch
    // Late-Chase-Malus: viel gelaufen (ret60 hoch) aber Tempo raus (ret15 schwach)
    const lateChase=Number(r.ret60)>4 && Number(r.ret15)<Number(r.ret60)*0.15;
    if(lateChase) fit-=0.35; // stark genug, damit die "keine Late-Chases"-Empfehlung die Rangliste nicht konterkariert
    fit=clampNum(fit,0,1);
    const liq=r.relVol==null?0.5:clampNum(Number(r.relVol)/2.5,0.2,1);
    const combined=+(setupQ*0.5 + fit*0.35 + liq*0.15).toFixed(3);
    const why=[];
    if(leaderSet.has(r.sector)) why.push(`Sektor ${r.sector} fuehrt`);
    if(Number(r.relVol)>=1.5) why.push(`RVOL ${Number(r.relVol).toFixed(1)}x`);
    if(r.breakout60m) why.push('60m-Ausbruch');
    if(Number(r.structurePct)>0) why.push(`Strukturraum ${Number(r.structurePct).toFixed(1)} %`);
    if(Number(r.ret60)>4 && Number(r.ret15)<Number(r.ret60)*0.15) why.push('⚠ spaet – Tempo laesst nach');
    return {symbol:r.symbol, sector:r.sector, light:r.light, score:r1(r.score),
      setupQ:+setupQ.toFixed(2), marketFit:+fit.toFixed(2), liquidity:+liq.toFixed(2),
      combined, relVol:r.relVol, aboveVwap:r.aboveVwap, ret60:r.ret60, ret15:r.ret15,
      structurePct:r.structurePct, why:why.slice(0,5)};
  }).sort((a,b)=>b.combined-a.combined);
  return scored;
}
/** Top-Level-Assembler: fuehrt alle Ebenen zur "FusionPulse Market Recommendation"
 *  zusammen. Reine Meinung ueber vorhandenen Daten; kein Score-Eingriff. */
function aladdinIntelligence(rows, opts={}){
  const clean=(rows||[]).filter(r=>r&&r.symbol);
  const regime=aladdinRegime(clean);
  const sectors=aladdinSectors(clean);
  const stress=aladdinStress(clean,regime);
  const ranked=marketRecommendation(clean,regime,sectors);
  const best=ranked[0]||null;
  const alt=ranked[1]||null;
  // Empfehlungssatz aus dem Regime ableiten – konservativ, mit Invalidation.
  let stance='Neutral agieren – kein klarer Vorteil einer Seite.';
  if(regime.label==='Risk-On') stance='Long-Seite bevorzugen, aber keine Late-Chases.';
  else if(regime.label==='Risk-Off') stance='Defensiv – Long nur bei klarem Sektor-Leader und starkem Setup.';
  const invalidation=[];
  if(regime.breadth!=null) invalidation.push(`Regime kippt, wenn Breadth unter ${Math.round((ALADDIN.RISK_OFF_THRESH)*100)} % faellt`);
  if(sectors.leaders[0]) invalidation.push(`${sectors.leaders[0].sector} verliert Fuehrung (Trend dreht auf →/↓)`);
  if(best) invalidation.push(`${best.symbol}: Setup ungueltig unter Stop/VWAP-Verlust`);
  const marketRisk=[];
  if(regime.thin) marketRisk.push(`duenne Datenbasis (${regime.sample} Titel) – Aussage ist Stichprobe, kein Vollmarkt`);
  if(stress.level!=='normal') marketRisk.push(...stress.flags);
  if(regime.rvolShare!=null && regime.rvolShare<0.3) marketRisk.push('Bewegung schwach durch Volumen bestaetigt');
  return {
    generatedTs:Date.now(),
    regime, sectors, stress,
    recommendation:{
      headline:`${regime.label==='Unklar'?'MARKTLAGE UNKLAR':'MARKTLAGE: '+regime.label.toUpperCase()} ${regime.prob} %`,
      confidence:regime.confidence,
      leadership:sectors.leaders.map(s=>s.sector),
      avoid:sectors.laggards.map(s=>s.sector),
      best, alt, stance,
      marketRisk, invalidation:invalidation.slice(0,3),
    },
    ranked:ranked.slice(0,8),
    dataBasis:{sampledTitles:clean.length,ratedSectors:sectors.ratedCount,
      honesty:'Stichprobe aus rotierendem Deep-Scan; Breadth/Rotation sind Naeherungen, kein Vollmarkt-Index.'},
    note:'Aladdin-Style Marktmeinung. Speist die Empfehlung, veraendert KEINEN Claude-/FusionPulse-Score. Kombination (Setup x Marktpassung) ist separat trackbar.',
    version:APP_VERSION,
  };
}

async function learningPayload(env, stocks=[], coins=[]){
  if(!env.DB)return {configured:false,state:'nodb',message:'D1-Binding DB fehlt',version:APP_VERSION};
  await ensureD1Schema(env);
  const now=Date.now();
  const key=[...stocks.slice(0,16).sort(), '|', ...coins.slice(0,30).sort()].join(',');
  if(learnMemo.data && learnMemo.key===key && now-learnMemo.ts<60_000) return learnMemo.data;
  const counts=await env.DB.prepare(`SELECT
    COUNT(*) snapshots,
    SUM(CASE WHEN resolved_ts IS NOT NULL THEN 1 ELSE 0 END) resolved,
    SUM(CASE WHEN success_ts IS NOT NULL THEN 1 ELSE 0 END) expansions,
    MAX(ts) last_ts,
    SUM(CASE WHEN ts>=${now-24*60*60_000} THEN 1 ELSE 0 END) snapshots24h,
    SUM(CASE WHEN ts>=${now-24*60*60_000} AND resolved_ts IS NOT NULL THEN 1 ELSE 0 END) resolved24h,
    SUM(CASE WHEN ts>=${now-24*60*60_000} AND success_ts IS NOT NULL THEN 1 ELSE 0 END) expansions24h FROM market_snapshots`).first();
  const stockOut={};
  for(const sym of stocks.slice(0,16)) stockOut[sym]={twin:await d1TwinFor(env,sym),lead:await d1LeadModel(env,sym),history:await d1History(env,sym,'stock')};
  const coinOut={};
  for(const sym of coins.slice(0,30)) coinOut[sym]={history:await d1History(env,sym,'coin')};
  const data={configured:true,state:'ok',ts:now,stats:{snapshots:Number(counts?.snapshots)||0,resolved:Number(counts?.resolved)||0,expansions:Number(counts?.expansions)||0,snapshots24h:Number(counts?.snapshots24h)||0,resolved24h:Number(counts?.resolved24h)||0,expansions24h:Number(counts?.expansions24h)||0,lastTs:Number(counts?.last_ts)||null},stocks:stockOut,coins:coinOut,version:APP_VERSION};
  learnMemo={ts:now,key,data}; return data;
}
async function serverLearningCycle(env, scheduledTime=Date.now()){
  if(!env.DB) return;
  await ensureD1Schema(env);
  const now=Number(scheduledTime)||Date.now(), phase=usMarketPhase(new Date(now));
  const cronMinute=Math.floor(now/60_000);
  const cryptoMinute=cronMinute%5===0;
  // v3.2.5: pro Cron-Aufruf maximal EIN schwerer Marktjob. Alle 5 Minuten
  // besitzt Krypto den Worker exklusiv; dadurch kollidiert Bitpanda nicht mehr
  // mit Whole-Market-Radar oder Aktien-Deep-Scan im selben CPU-Budget.
  if(env.FUSION_API_KEY && cryptoMinute){
    try{
      const snap=await getSnapshot(env,{},true);
      await d1StoreRows(env,snap.rows||[],{source:'Bitpanda Fusion',assetType:'coin',now});
      await persistCoinLive(env,snap.rows||[]);
      setApiState('crypto','ok'); await persistApiState(env,'crypto','ok',`${snap.rows?.length||0} Rows`,now);
    }catch(e){
      const state=classifyError(e); setApiState('crypto',state,e?.message);
      await persistApiState(env,'crypto',state,e?.message,now); cronLog('crypto',state,e?.message);
    }
  }
  const np=nyParts(new Date(now)),minsET=Number(np.hour)*60+Number(np.minute);
  if(!cryptoMinute && env.ALPACA_API_KEY_ID&&env.ALPACA_API_SECRET_KEY&&minsET>=480&&minsET<=1020&&phase.key!=='closed'){
    try{
      const op=await openingMomentum(env,true);
      if(Math.floor(now/60_000)%5===0) await d1StoreRows(env,op.rows||[],{source:alpacaFeed(env)==='sip'?'Alpaca SIP':'Alpaca IEX',assetType:'opening',now});
      setApiState('alpaca','ok',`${op.rows?.length||0} Rows`);
      await persistApiState(env,'alpaca','ok',`${op.rows?.length||0} Rows`,now);
    }catch(e){
      const state=classifyError(e); setApiState('alpaca',state,e?.message);
      await persistApiState(env,'alpaca',state,e?.message,now); cronLog('alpaca',state,e?.message);
    }
  }
  const stockMinute=cronMinute, primaryStocks=tiingoStocksMode(env)==='primary';
  if(!cryptoMinute && primaryStocks && env.TIINGO_API_TOKEN){
    // v3.2.4 CPU-Hotfix: schwere Jobs werden auf getrennte Cron-Minuten verteilt.
    // Ungerade Minute = Whole-Market-Bulk-Radar. Gerade Minute = Deep Scan aus
    // dem persistierten Radar. So laufen JSON-Bulk-Ranking und 20 Historien-
    // Analysen nie mehr im selben Worker-Aufruf.
    if(stockMinute%2===1){
      try{
        const rd=await tiingoIexMarketRadar(env,80,true);
        setApiState('stocks','ok',`Whole-Market Radar aktualisiert · ${rd?.rows?.length||0} Kandidaten`);
        await persistApiState(env,'stocks','ok',`Whole-Market Radar aktualisiert · ${rd?.rows?.length||0} Kandidaten`,now);
      }
      catch(e){const state=classifyError(e);setApiState('stocks',state,e?.message);await persistApiState(env,'stocks',state,e?.message,now);cronLog('iex-radar',state,e?.message);}
    }else{
      try{
        const st=await tiingoStockSnapshot(env,false,new Set(ALL_ON),3,[],'server');
        await d1StoreRows(env,st.rows||[],{source:'Tiingo IEX',assetType:'stock',now});
        setApiState('stocks','ok',`${st.rows?.length||0} Rows · Radar ${st.discovery?.radar?.universe||0}`);
        await persistApiState(env,'stocks','ok',`${st.rows?.length||0} Rows · Radar ${st.discovery?.radar?.universe||0}`,now);
      }catch(e){const state=classifyError(e);setApiState('stocks',state,e?.message);await persistApiState(env,'stocks',state,e?.message,now);cronLog('stocks',state,e?.message);}
    }
  } else if(!cryptoMinute && !primaryStocks && env.TWELVE_API_KEY && stockMinute%10===1){
    try{
      const st=await stockSnapshot(env,false,new Set(ALL_ON),3);
      await d1StoreRows(env,st.rows||[],{source:'Twelve Data',assetType:'stock',now});
      setApiState('stocks','ok',`${st.rows?.length||0} Rows`);
      await persistApiState(env,'stocks','ok',`${st.rows?.length||0} Rows`,now);
    }catch(e){const state=classifyError(e);setApiState('stocks',state,e?.message);await persistApiState(env,'stocks',state,e?.message,now);cronLog('stocks',state,e?.message);}
  }
}

/* ═══════════════ v3.32.1 · AUTH: DIE ZWEI HAEUFIGSTEN STOLPERSTEINE ════════
   Befund aus dem Betrieb: Token im Feld eingetragen, trotzdem 401.

   URSACHE 1 — unsichtbare Zeichen im Secret. `echo "xyz" | wrangler secret put
   APP_TOKEN` haengt ein `\n` an. Der strikte Vergleich `t === env.APP_TOKEN`
   trifft dann NIE, und niemand sieht warum: beide Seiten sehen im Klartext
   identisch aus. Dasselbe bei einem kopierten Leerzeichen am Ende.
   Beide Seiten werden jetzt getrimmt. Das schwaecht nichts ab — ein Geheimnis,
   dessen Sicherheit an einem fuehrenden Leerzeichen haengt, ist keines.

   URSACHE 2 — der Nutzer sieht nicht, WORAN es scheitert. Bisher kam nur
   „Nicht autorisiert." zurueck. Ob ueberhaupt ein Token ankam, ob er zu kurz
   oder schlicht falsch war, blieb offen. Das ist Lehre 8aa: derselbe Satz fuer
   drei verschiedene Zustaende.

   Was der Hinweis NICHT verraet: weder das Geheimnis noch seine Laenge.
   Gemeldet wird nur, ob etwas ankam und ob die Laenge passt — zwei Ja/Nein.
   Das reicht zur Unterscheidung „nichts angekommen" (Token nicht gespeichert)
   von „falscher Wert" (Tippfehler oder Autofill) und gibt einem Angreifer
   nichts, was er nicht durch Probieren ohnehin haette. */
function authed(req, url, env) {
  if (!env.APP_TOKEN) return true;                      // kein Token gesetzt → offen
  const want = String(env.APP_TOKEN).trim();
  const got  = String(req.headers.get('x-fp-token') || url.searchParams.get('t') || '').trim();
  return !!got && got === want;
}

/** Diagnose fuer die 401-Antwort. Verraet weder Wert noch Laenge. */
function authHint(req, url, env) {
  if (!env.APP_TOKEN) return null;
  const want = String(env.APP_TOKEN).trim();
  const raw  = req.headers.get('x-fp-token') || url.searchParams.get('t') || '';
  const got  = String(raw).trim();
  if (!got) return 'Es kam gar kein Zugriffs-Token an. In der App: Zahnrad → „Zugriffs-Token" eintragen UND unten auf Speichern tippen — ohne Speichern bleibt das Feld nur beschriftet.';
  if (got.length !== want.length) return 'Ein Token kam an, hat aber die falsche Länge. Häufigste Ursache auf dem iPhone: die Passwortverwaltung hat das Feld selbst ausgefüllt. Feld leeren, Vorschlag ablehnen, Wert von Hand einsetzen.';
  return 'Ein Token korrekter Länge kam an, stimmt aber nicht überein. Zeichenweise vergleichen — bei Groß-/Kleinschreibung und bei 0/O, 1/l/I passiert das am ehesten.';
}


/* ------------------------------------------------ Tiingo v3.1.0 isolated layer */
/* ═══════════════════ v3.32.0 · §10 D · BANDBREITE JE PFAD MESSEN ═══════════
   ANLASS: Am 30.08. lehnte Tiingo mit HTTP 429 ab — nicht wegen der Abrufzahl
   (10.000/h frei), sondern weil die MONATSBANDBREITE erschoepft war: 0,00 von
   40,00 GB uebrig. Das Audit hat den Hauptverdaechtigen benannt (der
   vollstaendige `/iex`-Marktsnapshot) und ueberschlagen: ~48 Downloads je
   Stunde, ~34.000 im Monat. Das waeren rund 1,2 MB je Antwort.

   Plausibel — aber GESCHAETZT. Das Audit sagt in §20 Schritt 1 selbst „nur
   auditieren und messen" und leitet in §14–§18 trotzdem schon die ganze
   Zielarchitektur ab. Genau die Reihenfolge, die sich dieses Projekt in
   zwanzig Versionen abgewoehnt hat (8y: „Der Test hat nicht geprueft, ob die
   Zahl STIMMT, sondern nur, ob eine da ist").

   Deshalb zuerst: zaehlen. Jede Antwort wird gewogen und einem Pfad
   zugeordnet. Danach laesst sich belegen statt vermuten, welcher Pfad die
   40 GB verbraucht — und die spaetere Einsparung ist messbar, nicht behauptet.

   EHRLICHKEIT DER MESSUNG: `content-length` ist die exakte Zahl der
   uebertragenen Bytes, wird aber bei komprimierten Antworten nicht immer
   gesetzt. Fehlt der Header, wird die Textlaenge genommen und die Quelle als
   `approx` gekennzeichnet — eine Naeherung wird als Naeherung ausgewiesen und
   nicht als Messung ausgegeben. Regel 4 gilt auch fuer Messwerte ueber uns
   selbst.

   NULL WIRKUNG AUF DIE BEWERTUNG. Reine Beobachtung. */
const TIINGO_BW_CAP_GB = 40;   // Tarif „Power", Stand 30.08.2026. Siehe /api/health.
let tiingoBw = { monthKey:'', paths:{}, exact:0, approx:0, loadedFromD1:false };
let tiingoBwLimitHit = 0;   // Zeitpunkt des letzten Bandbreiten-429, 0 = nie

function tiingoMonthKeyUTC(){ return new Date().toISOString().slice(0,7); }

/* Pfad -> Kategorie. Bewusst grob: es geht um „welcher DATENPFAD frisst die
   Bandbreite", nicht um einzelne URLs. Die Namen sind dieselben, die das
   Audit in §10 D vorschlaegt, damit beide Straenge dieselbe Sprache sprechen. */
function tiingoBwBucket(path){
  const p=String(path||'');
  if(/^\/iex\/[^/]+\/prices/.test(p))      return 'iex-chart';
  if(/^\/iex\?tickers=/.test(p))           return 'iex-symbols';
  if(/^\/iex(\?|$)/.test(p))               return 'iex-wholemarket';
  if(/^\/boats\/[^/]/.test(p))             return 'boats-symbol';
  if(/^\/boats(\?|$)/.test(p))             return 'boats-bulk';
  if(/^\/tiingo\/daily\/[^/]+\/prices/.test(p)) return 'daily-bars';
  if(/^\/tiingo\/news/.test(p))            return 'news';
  if(/^\/tiingo\/fundamentals/.test(p))    return 'fundamentals';
  return 'other';
}

let tiingoBwPersistTimer=0;
function noteTiingoBytes(env, path, bytes, exact){
  const n=Number(bytes);
  if(!Number.isFinite(n)||n<0) return;          // Regel 2: nichts erfinden
  const mk=tiingoMonthKeyUTC();
  if(tiingoBw.monthKey!==mk){ tiingoBw={monthKey:mk,paths:{},exact:0,approx:0,loadedFromD1:tiingoBw.loadedFromD1}; }
  const b=tiingoBwBucket(path);
  const cur=tiingoBw.paths[b]||{calls:0,bytes:0};
  cur.calls++; cur.bytes+=n; tiingoBw.paths[b]=cur;
  if(exact) tiingoBw.exact++; else tiingoBw.approx++;
  if(env?.DB && Date.now()-tiingoBwPersistTimer>30_000){
    tiingoBwPersistTimer=Date.now();
    const payload=JSON.stringify(tiingoBw);
    ensureD1Schema(env).then(()=>env.DB.prepare(
      'INSERT INTO fp_meta(key,value,updated_ts) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_ts=excluded.updated_ts'
    ).bind('tiingo_bandwidth',payload,Date.now()).run()).catch(e=>console.warn(JSON.stringify({event:'tiingo_bw_persist_failed',message:String(e?.message||e),ts:Date.now()})));
  }
}

async function loadTiingoBwOnce(env){
  if(tiingoBw.loadedFromD1 || !env?.DB) return;
  try{
    await ensureD1Schema(env);
    const r=await env.DB.prepare('SELECT value FROM fp_meta WHERE key=?').bind('tiingo_bandwidth').first();
    const v=r?.value?JSON.parse(r.value):null;
    if(v && v.monthKey===tiingoMonthKeyUTC() && v.paths && typeof v.paths==='object'){
      tiingoBw={monthKey:v.monthKey,paths:v.paths,exact:Number(v.exact)||0,approx:Number(v.approx)||0,loadedFromD1:true};
    } else { tiingoBw.monthKey=tiingoMonthKeyUTC(); tiingoBw.loadedFromD1=true; }
  }catch(e){ tiingoBw.loadedFromD1=true; console.warn(JSON.stringify({event:'tiingo_bw_load_failed',message:String(e?.message||e),ts:Date.now()})); }
}

/* Sichtbare Auswertung. WICHTIG (Lehre 8f): Solange nichts gemessen wurde,
   wird KEINE Null gemeldet, sondern `measured:false`. Der Client zeigt dann
   „nicht gemessen" — eine fehlende Messung darf nie wie freie Reserve
   aussehen. Der Monatswert dieses Workers ist ausserdem NICHT der
   Kontostand bei Tiingo: andere Clients, frueherer Verbrauch im selben Monat
   und der Zeitraum vor dieser Version fehlen darin. Das steht als `note` dabei
   und nicht nur in dieser Quelltextzeile. */
function tiingoBandwidthView(){
  const mk=tiingoMonthKeyUTC();
  if(tiingoBw.monthKey!==mk || !Object.keys(tiingoBw.paths).length){
    return { measured:false, monthKey:mk, capGb:TIINGO_BW_CAP_GB,
      note:'Seit dem Start dieser Worker-Instanz wurde in diesem Monat noch kein Tiingo-Abruf gewogen. Das ist eine fehlende Messung, KEIN niedriger Verbrauch.' };
  }
  const rows=Object.entries(tiingoBw.paths)
    .map(([path,v])=>({path,calls:v.calls,bytes:v.bytes,
      avgKb:v.calls?+((v.bytes/v.calls)/1024).toFixed(1):null,
      gb:+(v.bytes/1073741824).toFixed(4)}))
    .sort((a,b)=>b.bytes-a.bytes);
  const total=rows.reduce((s,r)=>s+r.bytes,0);
  const usedGb=+(total/1073741824).toFixed(4);
  return {
    measured:true, monthKey:mk, usedGb, capGb:TIINGO_BW_CAP_GB,
    pct:+Math.min(999,(usedGb/TIINGO_BW_CAP_GB)*100).toFixed(1),
    paths:rows,
    exactSamples:tiingoBw.exact, approxSamples:tiingoBw.approx,
    note:'Eigenmessung DIESES Workers ab v3.32.0. Nicht der Kontostand bei Tiingo — frueherer Verbrauch im selben Monat und andere Clients fehlen. Als untere Schranke lesen.',
  };
}

async function tiingoFetch(env, path) {
  if (!env.TIINGO_API_TOKEN) throw new Error('TIINGO_API_TOKEN fehlt');
  await loadTiingoQuotaOnce(env);
  await loadTiingoBwOnce(env);
  noteTiingoCall(env);
  const res = await fetch(`https://api.tiingo.com${path}`, {
    headers: { accept: 'application/json', authorization: `Token ${env.TIINGO_API_TOKEN}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 429) {
    /* v3.32.0: 429 heisst bei Tiingo BEIDES — Abrufrate oder Monatsbandbreite.
       Der Text unterscheidet das, die alte Meldung tat es nicht und hat den
       Nutzer am 30.08. auf die falsche Faehrte geschickt (warten hilft gegen
       Bandbreite bis zum Monatswechsel nicht). Lehre 8aa. */
    const body=(await res.text().catch(()=>'')).slice(0,300);
    const bandwidth=/bandwidth/i.test(body);
    tiingoBwLimitHit = bandwidth ? Date.now() : tiingoBwLimitHit;
    throw new Error(bandwidth
      ? 'Tiingo 429: MONATSBANDBREITE erschoepft — loest sich erst zum Monatswechsel, nicht durch Warten'
      : 'Tiingo Rate-Limit (429)');
  }
  if (!res.ok) throw new Error(`Tiingo ${res.status}: ${(await res.text()).slice(0,180)}`);
  const cl = Number(res.headers.get('content-length'));
  if (Number.isFinite(cl) && cl > 0) {
    noteTiingoBytes(env, path, cl, true);
    return res.json();
  }
  const text = await res.text();
  noteTiingoBytes(env, path, text.length, false);   // Naeherung, als solche gezaehlt
  return JSON.parse(text);
}
async function tiingoStockChart(env,symbol,range='120'){
  const sym=safeRadarSymbol(symbol);if(!sym)throw new Error('Ungültiger Ticker');
  const now=new Date(), end=now.toISOString().slice(0,10);let start=new Date(now),path='';
  const long={ '1T':1,'5T':5,'1Wo':7,'3Mo':92,'6Mo':183,'12Mo':366 };
  if(long[range]){
    start.setUTCDate(start.getUTCDate()-long[range]);const sd=start.toISOString().slice(0,10);
    if(long[range]<=7){const freq=long[range]<=1?'15min':'1hour';path=`/iex/${encodeURIComponent(sym)}/prices?startDate=${sd}&resampleFreq=${freq}&columns=open,high,low,close,volume`;}
    else path=`/tiingo/daily/${encodeURIComponent(sym)}/prices?startDate=${sd}&endDate=${end}&columns=open,high,low,close,volume`;
  }else{
    const mins=Math.max(5,Math.min(300,Number(range)||120));start=new Date(Date.now()-(mins+180)*60_000);const sd=start.toISOString();path=`/iex/${encodeURIComponent(sym)}/prices?startDate=${encodeURIComponent(sd)}&resampleFreq=5min&columns=open,high,low,close,volume`;
  }
  const d=await tiingoFetch(env,path),rows=(Array.isArray(d)?d:[]).map(x=>({t:x.date||x.timestamp||null,c:Number(x.close),v:Number(x.volume)})).filter(x=>Number.isFinite(x.c));
  return {symbol:sym,range,rows,source:long[range]&&long[range]>7?'Tiingo EOD':'Tiingo IEX',ts:Date.now(),version:APP_VERSION};
}
async function tiingoBoatsSnapshot(env, rawSymbols) {
  const symbols=[...new Set(String(rawSymbols||'').split(',').map(x=>x.trim().toUpperCase()).filter(x=>/^[A-Z0-9.\-]{1,12}$/.test(x)))].slice(0,25);
  if(!symbols.length) return {configured:!!env.TIINGO_API_TOKEN,state:'idle',rows:[],source:'Tiingo BOATS',version:APP_VERSION};
  let rows=[];
  if(symbols.length>5){
    const d=await tiingoFetch(env,'/boats');
    const wanted=new Set(symbols); rows=(Array.isArray(d)?d:[]).filter(x=>wanted.has(String(x.ticker||x.symbol||'').toUpperCase())).map(x=>({symbol:String(x.ticker||x.symbol||'').toUpperCase(),...x}));
  }else{
    rows=await pool(symbols,Math.min(5,symbols.length),async symbol=>{try{const d=await tiingoFetch(env,`/boats/${encodeURIComponent(symbol)}`);const r=Array.isArray(d)?d[0]:d;return r?{symbol,...r}:null;}catch(e){return {symbol,error:e.message||String(e)};}});
  }
  return {configured:true,state:'ok',rows:rows.filter(Boolean),source:'Tiingo BOATS',session:'20:00–03:59 ET',ts:Date.now(),version:APP_VERSION};
}



let tiingoDiscoveryMemo={ts:0,rows:[],session:null};
function boatsDiscoveryScore(r){
  const last=Number(r?.tngoLast ?? r?.last ?? r?.mid);
  const prev=Number(r?.prevClose), bid=Number(r?.bidPrice), ask=Number(r?.askPrice), vol=Number(r?.volume);
  if(!(last>0) || !(prev>0) || last<2) return null;
  const movePct=(last/prev-1)*100;
  const mid=bid>0&&ask>0?(bid+ask)/2:last;
  const spreadPct=bid>0&&ask>0&&mid>0?((ask-bid)/mid)*100:null;
  // Discovery only: unusual overnight move + real activity + acceptable quote.
  // This score NEVER enters analyseStock/BUY and is only used to choose Deep-Scan candidates.
  if(spreadPct!=null && spreadPct>3.0) return null;
  if(Number.isFinite(vol) && vol<100) return null;
  const activity=Number.isFinite(vol)&&vol>0?Math.log10(vol+1):0;
  const score=Math.abs(movePct)*2.4 + Math.min(8,activity) - (spreadPct==null?1.5:Math.min(6,spreadPct*2));
  return {score,movePct,spreadPct,volume:Number.isFinite(vol)?vol:null,last,prev};
}
/* v3.32.6 · BOATS war der blinde Fleck. In v3.32.0 habe ich ihn ausdruecklich
   ausgenommen („laeuft genau dann, wenn der IEX-Radar schweigt") — das war
   richtig fuer die Frage der Aktualitaet und falsch fuer die Bandbreite. Die
   Messung zeigt 184 Abrufe zu je 6,5 MB = 36 % des Gesamtverbrauchs, rund
   49 GB im Monat. Der Cache lag bei 5 Minuten.
   Die Nachtsitzung ist duenn; wer dort im 100-Sekunden-Takt nachsieht, kauft
   Rauschen fuer 6,5 MB je Blick. 20 Minuten reichen — die Vorabend-Liste
   entsteht ohnehin aus Tagesbalken, nicht hieraus. */
const BOATS_TTL_MS = 20*60_000;
async function tiingoBoatsDiscovery(env,limit=15,force=false){
  const now=Date.now();
  if(!force && tiingoDiscoveryMemo.rows.length && now-tiingoDiscoveryMemo.ts<BOATS_TTL_MS) return tiingoDiscoveryMemo;
  try{
    const d=await tiingoFetch(env,'/boats');
    const rows=(Array.isArray(d)?d:[]).map(x=>{
      const symbol=String(x.ticker||x.symbol||'').toUpperCase();
      if(!/^[A-Z0-9\-]{1,12}$/.test(symbol)) return null;
      const m=boatsDiscoveryScore(x); if(!m) return null;
      return {symbol,...m,timestamp:x.timestamp||x.quoteTimestamp||x.lastSaleTimestamp||null,source:'Tiingo BOATS'};
    }).filter(Boolean).sort((a,b)=>b.score-a.score).slice(0,Math.max(1,Math.min(30,limit)));
    tiingoDiscoveryMemo={ts:now,rows,session:'BOATS 20:00–04:00 ET'};
    return tiingoDiscoveryMemo;
  }catch(e){
    console.warn(JSON.stringify({event:'tiingo_boats_discovery_failed',message:String(e?.message||e),ts:now}));
    return tiingoDiscoveryMemo.rows.length?tiingoDiscoveryMemo:{ts:now,rows:[],session:'BOATS unavailable',error:String(e?.message||e)};
  }
}

function tiingoStocksMode(env){
  const m=String(env.TIINGO_STOCKS_MODE||'shadow').toLowerCase();
  return m==='primary'?'primary':'shadow';
}
let tiingoFxMemo={ts:0,usdPerEur:null};
async function getTiingoFx(env){
  if(tiingoFxMemo.usdPerEur && Date.now()-tiingoFxMemo.ts<30*60_000) return tiingoFxMemo.usdPerEur;
  try{
    const d=await tiingoFetch(env,'/tiingo/fx/eurusd/top');
    const r=Array.isArray(d)?d[0]:d;
    const x=Number(r?.midPrice ?? ((Number(r?.bidPrice)+Number(r?.askPrice))/2));
    if(Number.isFinite(x)&&x>0){tiingoFxMemo={ts:Date.now(),usdPerEur:x};return x;}
  }catch(e){ console.warn(JSON.stringify({event:'tiingo_fx_failed',message:String(e?.message||e),ts:Date.now()})); }
  return tiingoFxMemo.usdPerEur;
}
/* ═════════ v3.32.0 · §10 A / §14.2 · SYMBOLBEGRENZTER IEX-ABRUF ════════════
   BEFUND, bestaetigt im Code: `tiingoIexSnapshot(env, symbols)` nahm zwar eine
   Symbolliste entgegen, holte intern aber `/iex` fuer den GESAMTEN Markt und
   filterte erst danach lokal. Fuer 20 Titel wurden also ~12.000 uebertragen.
   Das Audit hat damit recht — und das ist der groesste Hebel im ganzen
   Dokument, weil dieser Pfad laut Audit-Schaetzung zweimal je Aktienzyklus
   laeuft (`freshestStockQuotesBatch` und `tiingoIexMarketRadar`).

   DAS PROBLEM MIT DEM FIX: Das Audit sagt „Pruefen, ob Tiingo einen
   symbolbegrenzten Abruf unterstuetzt" — es weiss es nicht. Ich auch nicht,
   und ich kann es hier nicht pruefen: kein Tiingo-Token, und der Zugang
   antwortet ohnehin mit 429, bis die Monatsbandbreite zurueckgesetzt wird.

   Blind auf `?tickers=` umstellen waere geraten. Ein Vorab-Test von Hand
   verschiebt die Loesung auf den 1. September. Deshalb: die App probiert es
   EINMAL selbst und merkt sich das Ergebnis.

     unbekannt -> `?tickers=` versuchen
                    |- Antwort enthaelt die angefragten Symbole -> „geht",
                    |  ab jetzt immer schmal
                    `- Fehler ODER verdaechtig grosse/leere Antwort -> „geht
                       nicht", ab jetzt wieder Whole-Market

   ENTSCHEIDEND FUER REGEL 4: Der Rueckfall ist der ALTE, funktionierende Weg —
   nicht ein leeres Ergebnis. Ein misslungener Sparversuch darf die Quote
   nicht verschlechtern, sondern nur die Ersparnis kosten. Und die Erkennung
   ist bewusst STRENG: nur wenn mindestens ein angefragtes Symbol wirklich
   zurueckkommt, gilt der schmale Weg als tauglich. Eine leere Antwort koennte
   auch bedeuten, dass Tiingo den Parameter ignoriert und ausserhalb der
   Handelszeit nichts liefert — das darf nicht als Erfolg zaehlen.

   Der Zustand ist sichtbar (`/api/health` -> `iexSubset`) und wird in D1
   gehalten, damit nicht jede neue Isolate-Instanz erneut probiert. */
let iexSubsetMode = { state:'unknown', ts:0, evidence:null, loadedFromD1:false };

async function loadIexSubsetModeOnce(env){
  if(iexSubsetMode.loadedFromD1 || !env?.DB) return;
  try{
    await ensureD1Schema(env);
    const r=await env.DB.prepare('SELECT value FROM fp_meta WHERE key=?').bind('iex_subset_mode').first();
    const v=r?.value?JSON.parse(r.value):null;
    /* Ein „geht nicht" laeuft nach 7 Tagen ab: Tiingo kann den Parameter
       nachruesten, und ein einmaliger Fehlschlag soll die Ersparnis nicht
       fuer immer verbauen. Ein „geht" bleibt stehen. */
    if(v && (v.state==='ok' || (v.state==='unsupported' && Date.now()-Number(v.ts||0) < 7*86400_000))){
      iexSubsetMode={...v,loadedFromD1:true};
    } else iexSubsetMode.loadedFromD1=true;
  }catch(e){ iexSubsetMode.loadedFromD1=true; }
}
function saveIexSubsetMode(env,state,evidence){
  iexSubsetMode={state,ts:Date.now(),evidence,loadedFromD1:true};
  console.warn(JSON.stringify({event:'iex_subset_mode',state,evidence,ts:Date.now()}));
  if(env?.DB){
    const payload=JSON.stringify({state,ts:iexSubsetMode.ts,evidence});
    ensureD1Schema(env).then(()=>env.DB.prepare(
      'INSERT INTO fp_meta(key,value,updated_ts) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_ts=excluded.updated_ts'
    ).bind('iex_subset_mode',payload,Date.now()).run()).catch(()=>{});
  }
}

/* ═══════ v3.32.0 · DER ZWEITE WHOLE-MARKET-DOWNLOAD FAELLT WEG ════════════
   BEFUND beim Nachrechnen, ob die Massnahmen reichen: Der Cron laedt den
   ganzen Markt ZWEIMAL je Doppelminute — einmal fuer den Radar
   (`stockMinute%2===1`) und einmal fuer den Deep-Scan, der ueber
   `freshestStockQuotesBatch` -> `tiingoIexSnapshot` frische Kurse fuer ~20
   Titel holt und dafuer ebenfalls `/iex` zieht. Rund 1.440 Downloads am Tag,
   nicht 720. Die Radar-Taktung allein haette also nur die HAELFTE gedeckelt.

   Der Deep-Scan braucht 20 Zeilen, die der Radar Sekunden vorher schon
   heruntergeladen hat. Also wiederverwenden statt neu laden.

   REGEL 4, und hier ist sie scharf: Wiederverwendung darf keine veralteten
   Kurse als frisch ausgeben. Zwei Sicherungen:
   · Der Vorrat wird nur benutzt, solange er juenger ist als das
     Frischefenster der aktuellen Marktphase (120 s im Handel, 900 s sonst) —
     dasselbe Fenster, gegen das `classifyQuoteFreshness` ohnehin prueft.
   · Die ZEITSTEMPEL der Zeilen bleiben unveraendert. Es wird nichts auf
     „jetzt" gesetzt. Ein zu alter Kurs faellt weiterhin durch dieselbe
     Pruefung wie vorher.
   Damit kann diese Optimierung nichts frischer erscheinen lassen, als es ist.
   Sie spart einen Download, sie faelscht keinen Wert. */
let iexRawMemo={ts:0,bySymbol:null};
function iexRawFreshMs(){
  const k=usMarketPhase(new Date(),'iex').key;
  return ['premarket-early','premarket','opening','regular','after'].includes(k) ? 120_000 : 900_000;
}

async function tiingoIexSnapshot(env, rawSymbols){
  const symbols=[...new Set(String(rawSymbols||'').split(',').map(x=>x.trim().toUpperCase()).filter(x=>/^[A-Z0-9.\-]{1,12}$/.test(x)))].slice(0,50);
  if(!symbols.length) return [];
  const wanted=new Set(symbols);
  const pick=(d)=>(Array.isArray(d)?d:[]).filter(x=>wanted.has(String(x.ticker||x.symbol||'').toUpperCase()));

  /* Vorrat aus dem Radar-Abruf — kein Netzverkehr, keine Bandbreite. */
  if(iexRawMemo.bySymbol && Date.now()-iexRawMemo.ts < iexRawFreshMs()){
    const hits=symbols.map(sy=>iexRawMemo.bySymbol.get(sy)).filter(Boolean);
    /* Nur wenn WIRKLICH etwas dabei ist. Ein leerer Treffer koennte auch
       heissen, dass die Symbole gar nicht im Vorrat stehen — dann muss
       regulaer geladen werden, statt eine leere Liste zurueckzugeben. */
    if(hits.length) return hits;
  }

  await loadIexSubsetModeOnce(env);

  if(iexSubsetMode.state!=='unsupported'){
    try{
      const d=await tiingoFetch(env,`/iex?tickers=${symbols.map(encodeURIComponent).join(',')}`);
      const rows=pick(d);
      const all=Array.isArray(d)?d.length:0;
      /* Streng: mindestens ein angefragtes Symbol muss dabei sein UND die
         Antwort darf nicht offensichtlich der ganze Markt sein (dann haette
         Tiingo den Parameter ignoriert und wir haetten nichts gespart). */
      if(rows.length>0 && all<=Math.max(symbols.length*3,60)){
        if(iexSubsetMode.state!=='ok') saveIexSubsetMode(env,'ok',`${rows.length}/${symbols.length} Symbole in einer ${all}-Zeilen-Antwort`);
        return rows;
      }
      saveIexSubsetMode(env,'unsupported',all>0
        ? `Parameter wirkungslos: ${all} Zeilen fuer ${symbols.length} angefragte Symbole`
        : 'leere Antwort auf ?tickers=');
      if(rows.length>0) return rows;   // brauchbar, aber nicht sparsam
    }catch(e){
      saveIexSubsetMode(env,'unsupported',String(e?.message||e).slice(0,160));
    }
  }
  // Rueckfall: der alte, funktionierende Weg. Teuer, aber vollstaendig.
  const d=await tiingoFetch(env,'/iex');
  return pick(d);
}

/* v3.2.1 Whole-Market Radar -------------------------------------------------
   Ein einzelner Tiingo-/iex-Bulk-Call beobachtet den gesamten verfuegbaren
   IEX-Snapshot. Der Radar nominiert nur Kandidaten. Er veraendert weder
   analyseStock() noch Score/Ampel/BUY und hat damit explizit 0 % BUY-Gewicht.
   Die Top-Kandidaten werden kompakt in D1 gespeichert, damit auch bei
   geschlossenem Browser ein serverseitiges Bewegungs-Gedaechtnis entsteht. */
let tiingoIexRadarMemo={ts:0,rows:[],universe:0};
function radarTs(x){
  const raw=x?.timestamp||x?.quoteTimestamp||x?.lastSaleTimestamp||x?.lastUpdated||null;
  const ms=raw?Date.parse(raw):NaN; return Number.isFinite(ms)?ms:null;
}
function iexRadarQuote(x,prev=null){
  const symbol=String(x?.ticker||x?.symbol||'').toUpperCase();
  if(!/^[A-Z0-9.\-]{1,12}$/.test(symbol)) return null;
  const last=Number(x?.tngoLast ?? x?.last ?? x?.lastPrice ?? x?.mid);
  const prevClose=Number(x?.prevClose ?? x?.previousClose);
  const open=Number(x?.open ?? x?.openPrice);
  const high=Number(x?.high ?? x?.highPrice), low=Number(x?.low ?? x?.lowPrice);
  const bid=Number(x?.bidPrice ?? x?.bid), ask=Number(x?.askPrice ?? x?.ask);
  const volume=Number(x?.volume ?? x?.tngoVolume);
  if(!(last>=2) || !(prevClose>0)) return null;
  const mid=bid>0&&ask>0?(bid+ask)/2:last;
  const spreadPct=bid>0&&ask>0&&mid>0?(ask-bid)/mid*100:null;
  if(spreadPct!=null && spreadPct>2.5) return null;
  const movePct=(last/prevClose-1)*100;
  const openPct=open>0?(last/open-1)*100:null;
  const rangePct=high>0&&low>0&&last>0?(high-low)/last*100:null;
  const prevLast=Number(prev?.last), prevVol=Number(prev?.volume);
  const speedPct=prevLast>0?(last/prevLast-1)*100:0;
  const volDelta=volume>=0&&prevVol>=0?Math.max(0,volume-prevVol):0;
  const spreadImprove=prev?.spreadPct!=null&&spreadPct!=null?Math.max(0,Number(prev.spreadPct)-spreadPct):0;
  // v3.4.3 Situation Engine: Discovery sucht nicht mehr primaer nach bereits grossen
  // Tagesgewinnern, sondern nach FRISCHEN Zustandswechseln. Alle Werte bleiben reine
  // Nominierung (0 % BUY-Gewicht); fehlende Quote-/Volumendaten koennen den Rang nur senken.
  const activity=Number.isFinite(volume)&&volume>0?Math.min(7,Math.log10(volume+1)):0;
  const gapPct=open>0?(open/prevClose-1)*100:null;
  const rangePosition=high>low?(last-low)/(high-low):null;
  const prevSpeed=Number(prev?.speedPct);
  const accelPct=Number.isFinite(prevSpeed)?speedPct-prevSpeed:speedPct;
  const volPulsePct=prevVol>0&&volume>=prevVol?(volume/prevVol-1)*100:null;
  const nearHigh=rangePosition!=null&&rangePosition>=0.82;
  const cleanSpread=spreadPct!=null&&spreadPct<=0.8;
  const volumePulse=volPulsePct!=null&&volPulsePct>=2;
  const freshAccel=speedPct>=0.10&&accelPct>=0.03;
  const breakoutPressure=nearHigh&&speedPct>=0.06&&movePct>=0.4;
  const openingDrive=gapPct!=null&&gapPct>=0.8&&openPct!=null&&openPct>=0.15&&speedPct>=0.04;
  const reversalReclaim=movePct<0&&openPct!=null&&openPct>0&&speedPct>=0.10;
  const quietToActive=Math.abs(movePct)<2.5&&speedPct>=0.16&&(volumePulse||activity>=5.5);

  let situation='WATCH';
  if(openingDrive) situation='OPENING DRIVE';
  else if(breakoutPressure&&freshAccel) situation='BREAKOUT PRESSURE';
  else if(reversalReclaim) situation='REVERSAL RECLAIM';
  else if(quietToActive) situation='EARLY ACCELERATION';
  else if(freshAccel) situation='ACCELERATION';
  else if(breakoutPressure) situation='NEAR HIGH';

  // v3.5.2 Opportunity Lifecycle: nicht nur Zustand, sondern die AENDERUNG des
  // Zustands zaehlt. Ein frischer Uebergang WATCH/NEAR HIGH -> IGNITION bekommt
  // Vorrang vor einem Titel, der schon minutenlang einfach nur oben steht.
  const prevSituation=String(prev?.situation||'WATCH');
  const transitioned=situation!=='WATCH'&&situation!==prevSituation;
  const ignition=transitioned&&['OPENING DRIVE','BREAKOUT PRESSURE','REVERSAL RECLAIM','EARLY ACCELERATION','ACCELERATION'].includes(situation)
    && ['WATCH','NEAR HIGH'].includes(prevSituation);
  const prep=situation==='NEAR HIGH'&&cleanSpread&&(volumePulse||speedPct>=0.03);
  const decelerating=movePct>4&&rangePosition!=null&&rangePosition>=0.85&&Number.isFinite(prevSpeed)&&speedPct<Math.max(0.02,prevSpeed*0.55);
  const lifecycle=decelerating?'LATE':ignition?'IGNITION':prep?'PREP':(['BREAKOUT PRESSURE','OPENING DRIVE','ACCELERATION'].includes(situation)?'CONFIRM':'WATCH');

  let situationScore=0;
  situationScore += Math.min(28,Math.max(0,speedPct)*55);
  situationScore += Math.min(14,Math.max(0,accelPct)*45);
  situationScore += nearHigh?12:0;
  situationScore += openingDrive?12:0;
  situationScore += reversalReclaim?10:0;
  situationScore += volumePulse?Math.min(12,4+Math.max(0,volPulsePct||0)*0.20):0;
  situationScore += cleanSpread?8:(spreadPct==null?-6:Math.max(-8,6-spreadPct*5));
  situationScore += Math.min(8,activity*1.1);
  situationScore += Math.min(6,Math.max(0,spreadImprove)*8);
  situationScore += Math.min(8,Math.max(0,movePct)*0.7);
  situationScore += ignition?18:transitioned?7:prep?8:0;
  if(lifecycle==='LATE') situationScore-=22;
  if(movePct>7&&speedPct<0.05) situationScore-=Math.min(18,(movePct-7)*1.2);
  if(rangePosition!=null&&rangePosition<0.35&&speedPct<=0) situationScore-=10;
  if(spreadPct==null) situationScore-=6;

  const reasons=[];
  if(ignition) reasons.push(`NEU: ${prevSituation} -> ${situation}`);
  else if(prep) reasons.push('Vorbereitung direkt unter Trigger');
  if(lifecycle==='LATE') reasons.push('spaete Bewegung / Tempo faellt');
  if(openingDrive) reasons.push('Gap mit Follow-through');
  if(breakoutPressure) reasons.push('nahe Tageshoch mit Druck');
  if(freshAccel) reasons.push(`Beschleunigung +${speedPct.toFixed(2)} %`);
  if(reversalReclaim) reasons.push('Reversal/Reclaim startet');
  if(volumePulse) reasons.push('Volumenpuls');
  if(spreadImprove>=0.05) reasons.push('Spread wird enger');
  if(!reasons.length&&movePct>=2) reasons.push(`Tagesstaerke +${movePct.toFixed(1)} %`);
  const ts=radarTs(x), ageMin=ts?Math.max(0,(Date.now()-ts)/60000):null;
  if(ageMin!=null && ageMin>30) return null;
  if(ageMin!=null) situationScore-=Math.min(18,ageMin*0.7);
  const score=Math.max(0,situationScore);
  return {symbol,last,prevClose,open:Number.isFinite(open)?open:null,high:Number.isFinite(high)?high:null,low:Number.isFinite(low)?low:null,volume:Number.isFinite(volume)?volume:null,movePct,openPct,gapPct,rangePct,rangePosition,spreadPct,speedPct,accelPct,volDelta,volPulsePct,score,situationScore:score,situation,prevSituation,lifecycle,transitioned,ignition,reasons,ts,ageMin,source:'Tiingo IEX Situation Radar',buyWeight:0};
}
/* v3.23.0 · Lebende Coin-Kandidaten fuer die Krypto-Top-Picks.
   Der Aktienradar hat mit `iex_radar:last` bereits so einen Zwischenspeicher;
   fuer Coins gab es keinen, weil der Scan bisher immer live lief. Fuer die
   Auswertung braucht es aber einen Stand, der auch dann da ist, wenn gerade
   kein Scan laeuft — sonst waere die Kachel bei jedem Seitenaufruf leer.
   Bewusst schlank: nur die Felder, die die Rangfolge braucht. */
async function persistCoinLive(env, rows){
  if(!env?.DB || !Array.isArray(rows) || !rows.length) return;
  try{
    await ensureD1Schema(env);
    const ts=Date.now(), clean=rows.slice(0,40).map(r=>({
      symbol:String(r.pair||r.symbol||'').toUpperCase(),
      situation:r.situationType||r.situation||'WATCH',
      lifecycle:r.lifecycle||null,
      situationScore:dbNum(r.situationScore)??dbNum(r.quality)??0,
      movePct:dbNum(r.ret60)??dbNum(r.ret15)??null,
      speedPct:dbNum(r.ret15)??null,
      spreadPct:dbNum(r.spreadPct)!=null?dbNum(r.spreadPct)*100:null,  // Bruch -> Prozent
      reasons:Array.isArray(r.situationReasons)?r.situationReasons.slice(0,3):[],
      ts,
    })).filter(x=>x.symbol);
    if(!clean.length) return;
    await env.DB.prepare(`INSERT INTO fp_meta(key,value,updated_ts) VALUES(?,?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_ts=excluded.updated_ts`)
      .bind('coin_live:last',safeJson({ts,rows:clean}),ts).run();
  }catch(e){ console.warn(JSON.stringify({event:'coin_live_cache_write_failed',message:String(e?.message||e),ts:Date.now()})); }
}
async function readCoinLive(env, maxAgeMs=30*60_000){
  if(!env?.DB) return null;
  try{
    await ensureD1Schema(env);
    const r=await env.DB.prepare('SELECT value,updated_ts FROM fp_meta WHERE key=? LIMIT 1').bind('coin_live:last').first();
    if(!r?.value) return null;
    const p=JSON.parse(r.value), ts=Number(p?.ts||r.updated_ts||0);
    if(!ts || Date.now()-ts>maxAgeMs) return null;
    return p?.rows?.length ? {ts,rows:p.rows} : null;
  }catch{ return null; }
}
async function readPersistedIexRadar(env){
  if(!env?.DB) return null;
  try{await ensureD1Schema(env);const r=await env.DB.prepare('SELECT value,updated_ts FROM fp_meta WHERE key=? LIMIT 1').bind('iex_radar:last').first();if(!r?.value)return null;const p=JSON.parse(r.value);return p?.rows?.length?{ts:Number(p.ts||r.updated_ts||0),rows:p.rows,universe:Number(p.universe||0)}:null;}catch{return null;}
}
async function persistIexRadar(env,data){
  if(!env?.DB||!data?.rows?.length)return;
  try{await ensureD1Schema(env);const ts=Date.now(),payload=safeJson({ts,universe:data.universe,rows:data.rows.slice(0,120).map(r=>({symbol:r.symbol,last:r.last,prevClose:r.prevClose,open:r.open,high:r.high,low:r.low,volume:r.volume,spreadPct:r.spreadPct,movePct:r.movePct,openPct:r.openPct,gapPct:r.gapPct,rangePct:r.rangePct,rangePosition:r.rangePosition,speedPct:r.speedPct,accelPct:r.accelPct,volDelta:r.volDelta,volPulsePct:r.volPulsePct,score:r.score,situationScore:r.situationScore,situation:r.situation,prevSituation:r.prevSituation,lifecycle:r.lifecycle,transitioned:r.transitioned,ignition:r.ignition,reasons:r.reasons,ts:r.ts}))});await env.DB.prepare(`INSERT INTO fp_meta(key,value,updated_ts) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_ts=excluded.updated_ts`).bind('iex_radar:last',payload,ts).run();}catch(e){console.warn(JSON.stringify({event:'iex_radar_cache_write_failed',message:String(e?.message||e),ts:Date.now()}));}
}

// v3.3.3: Opening Momentum kann im Premarket bereits verifizierte marktweite
// Kandidaten liefern, bevor der normale Deep-Scan sie übernommen hat. Diese
// kleine, bereits durch filterRadarToCommonStocks() geprüfte Menge wird separat
// persistiert. Sie bleibt reine Discovery (0 % BUY-Gewicht), darf aber den
// nächsten serverseitigen Deep-Scan nominieren und den Radar in der UI füllen.
async function persistVerifiedOpeningRadar(env, rows){
  if(!env?.DB||!Array.isArray(rows)||!rows.length)return;
  try{
    await ensureD1Schema(env);
    const ts=Date.now(), clean=rows.slice(0,24).map(r=>({
      symbol:String(r.symbol||'').toUpperCase(), last:r.last??r.priceUsd??null,
      movePct:r.movePct??r.gapPct??null, speedPct:r.speedPct??r.ret5??null,
      spreadPct:r.spreadPct??null, volume:r.volume??null, score:r.score??r.momentumScore??0,
      situationScore:r.situationScore??r.momentumScore??0, situation:r.situation||r.situationType||'OPENING MOMENTUM',
      reasons:Array.isArray(r.reasons)?r.reasons.slice(0,3):['Opening Momentum'],
      securityVerified:true, securityName:r.securityName||r.name||r.symbol,
      companyDescription:r.companyDescription||'', exchange:r.exchange||'', ts:r.ts||ts,
      buyWeight:0, source:'Opening Momentum · verified'
    })).filter(r=>r.symbol);
    if(!clean.length)return;
    const payload=safeJson({ts,rows:clean});
    await env.DB.prepare(`INSERT INTO fp_meta(key,value,updated_ts) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_ts=excluded.updated_ts`).bind('opening_radar_verified:last',payload,ts).run();
  }catch(e){console.warn(JSON.stringify({event:'opening_radar_cache_write_failed',message:String(e?.message||e),ts:Date.now()}));}
}
async function readVerifiedOpeningRadar(env,maxAgeMs=30*60_000){
  if(!env?.DB)return [];
  try{
    await ensureD1Schema(env);
    const r=await env.DB.prepare('SELECT value,updated_ts FROM fp_meta WHERE key=? LIMIT 1').bind('opening_radar_verified:last').first();
    if(!r?.value)return [];
    const p=JSON.parse(r.value), ts=Number(p?.ts||r.updated_ts||0);
    if(!ts||Date.now()-ts>maxAgeMs)return [];
    return verifiedCommonOnly(Array.isArray(p?.rows)?p.rows:[]).slice(0,24);
  }catch{return [];}
}
// v3.2.3 Security-master gate: keep the broad IEX radar, but validate
// candidates with Tiingo's stable EOD metadata endpoint instead of the beta
// Search endpoint. This avoids a production dependency on Search and keeps
// ETFs/ETPs/funds/warrants/units/preferreds out of the stock Deep Scan.
const NON_COMMON_EQUITY_RE=/(?:\bETF\b|\bETN\b|\bETP\b|EXCHANGE[- ]TRADED|DAILY TARGET|\b2X\b|\b3X\b|ULTRA(?:PRO)?\b|BEAR\b|BULL\b|INVERSE\b|LEVERAGED\b|DIREXION|PROSHARES|T-?REX|GRANITESHARES|DEFIANCE|ROUNDHILL|YIELDMAX|REX SHARES|TRADR|\bFUND\b|MUTUAL FUND|CLOSED[- ]END|\bWARRANTS?\b|\bUNITS?\b|\bRIGHTS?\b|PREFERRED|DEPOSITARY SHARES?)/i;
// Known single-stock leveraged/inverse product symbols that have already polluted Discovery.
// Metadata/name remains the primary gate; this deny-set is a defensive last line and can only EXCLUDE.
const NON_COMMON_SYMBOL_DENY=new Set(['CRWU','AXTU']);
const nonEquityMemo=new Map();
function safeRadarSymbol(raw){
  const sym=String(raw||'').trim().toUpperCase().replace(/\./g,'-');
  return /^[A-Z][A-Z0-9-]{0,11}$/.test(sym)?sym:'';
}
async function radarEquityMeta(env,symbol){
  const sym=safeRadarSymbol(symbol);
  if(!sym)return {ts:Date.now(),tradableStock:false,name:String(symbol||''),assetType:'invalid',reason:'Ungueltiges Symbolformat'};
  const mem=nonEquityMemo.get(sym);
  if(mem&&Date.now()-mem.ts<7*86400_000)return mem;
  const key=`security_meta:v327:${sym}`;
  if(env?.DB){
    try{await ensureD1Schema(env);const r=await env.DB.prepare('SELECT value,updated_ts FROM fp_meta WHERE key=? LIMIT 1').bind(key).first();if(r?.value&&Date.now()-Number(r.updated_ts||0)<7*86400_000){const v=JSON.parse(r.value);const out={ts:Number(r.updated_ts||Date.now()),...v};nonEquityMemo.set(sym,out);return out;}}catch{}
  }
  let out={ts:Date.now(),tradableStock:false,name:sym,assetType:'unknown',reason:'Metadaten nicht verifiziert'};
  try{
    // Stable Tiingo EOD metadata endpoint; no query string / beta Search API.
    const hit=await tiingoFetch(env,`/tiingo/daily/${encodeURIComponent(sym)}`);
    const name=String(hit?.name||sym),desc=String(hit?.description||''),exchange=String(hit?.exchangeCode||'');
    const text=`${name} ${desc}`;
    const nonCommon=NON_COMMON_SYMBOL_DENY.has(sym) || NON_COMMON_EQUITY_RE.test(text) || /-P(?:-|$)/.test(sym);
    const active=hit?.endDate==null || Date.parse(hit.endDate)>=Date.now()-7*86400_000;
    out={ts:Date.now(),tradableStock:Boolean(active&&!nonCommon),name,description:desc.slice(0,500),assetType:nonCommon?'non-common':'stock',exchange,reason:!active?'inaktiv':nonCommon?'ETF/ETP/Fonds/Derivat erkannt':'Common-Stock verifiziert'};
  }catch(e){out.reason=`Metadatenpruefung fehlgeschlagen: ${String(e?.message||e).slice(0,90)}`;}
  nonEquityMemo.set(sym,out);
  if(env?.DB){try{await ensureD1Schema(env);await env.DB.prepare(`INSERT INTO fp_meta(key,value,updated_ts) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_ts=excluded.updated_ts`).bind(key,safeJson({tradableStock:out.tradableStock,name:out.name,description:out.description||'',assetType:out.assetType,exchange:out.exchange||'',reason:out.reason}),out.ts).run();}catch{}}
  return out;
}
async function filterRadarToCommonStocks(env,rows,limit){
  // Work through a larger ranked buffer so rejected ETFs are replaced by the
  // next common stocks. Metadata checks are cached for seven days.
  const source=(rows||[]).map(r=>({...r,symbol:safeRadarSymbol(r?.symbol)})).filter(r=>r.symbol).slice(0,24);
  const checked=await pool(source,4,async r=>{try{return {r,m:await radarEquityMeta(env,r.symbol)};}catch(e){return {r,m:{tradableStock:false,reason:String(e?.message||e)}};}});
  return checked.filter(x=>x?.m?.tradableStock && radarCandidateAllowed(x?.r,false,env)).map(x=>({...x.r,securityName:x.m.name,companyDescription:x.m.description||'',exchange:x.m.exchange||'',assetType:'stock',securityVerified:true,largeCapRadar:largeCapRadarAllowed(x?.r?.symbol),momentumRadar:!largeCapRadarAllowed(x?.r?.symbol)&&momentumRadarAllowed(x?.r,false,env)})).slice(0,limit);
}

function verifiedCommonOnly(rows){
  return (rows||[]).filter(r=>r?.securityVerified===true && (largeCapRadarAllowed(r?.symbol)||r?.momentumRadar===true) && !NON_COMMON_SYMBOL_DENY.has(String(r?.symbol||'').toUpperCase()) && !NON_COMMON_EQUITY_RE.test(`${r?.securityName||''} ${r?.name||''}`));
}
// v3.2.7 P0: Never let a previously cached/persisted non-common instrument leak
// back into the visible stock scanner. This is deliberately exclusion-only.
function stripKnownNonCommon(rows){
  return (rows||[]).filter(r=>{
    const sym=String(r?.symbol||'').trim().toUpperCase();
    if(!sym || NON_COMMON_SYMBOL_DENY.has(sym)) return false;
    return !NON_COMMON_EQUITY_RE.test(`${r?.securityName||''} ${r?.name||''} ${r?.description||''}`);
  });
}
function openingGainers(rows,limit=12){
  return verifiedCommonOnly(rows).filter(r=>Number(r.movePct)>=2).sort((a,b)=>(Number(b.movePct)||0)-(Number(a.movePct)||0)).slice(0,limit);
}

/* ═════════════ v3.32.0 · §10 B / §15 · SESSIONABHAENGIGE RADAR-TAKTUNG ═════
   BEFUND: Der Radar-Cache lag pauschal bei 50 Sekunden. Bei minuetlichem Cron
   heisst das rund 1.440 Whole-Market-Downloads am Tag — auch nachts um drei,
   auch samstags, auch an Feiertagen, wenn IEX ueberhaupt nicht handelt. Genau
   das meint das Audit mit „unnoetige Bytes" (§21).

   Die Staffelung folgt der Marktphase, die `usMarketPhase()` ohnehin schon
   kennt. Sie ist bewusst NICHT aggressiv im Opening: dort zaehlt jede Sekunde,
   und die Ersparnis holt man in den 16 handelsfreien Stunden, nicht in den
   90 Minuten, auf die es ankommt.

   REGEL 4 IST GEWAHRT, und das ist hier nicht selbstverstaendlich — eine
   laengere Zwischenspeicherung macht Daten AELTER, und aeltere Daten duerfen
   nichts verbessern:
   · Der Radar hat 0 % BUY-Gewicht. Er nominiert Kandidaten, er bewertet nicht.
   · Der bestehende Filter `r.ageMin <= maxAge` bleibt unveraendert. Bei
     geschlossenem Markt sind 90 Minuten erlaubt; eine Zwischenspeicherung von
     15 Minuten liegt darunter. Zu alte Zeilen fallen weiterhin raus, statt
     stillschweigend weiterverwendet zu werden.
   · Das Alter ist ablesbar (`radar.ts` in `/api/stocks`).
   Damit kostet die Drosselung Aktualitaet in Phasen, in denen es keine
   Bewegung gibt — und keine Freigabe, keinen Score, keine Rangfolge.

   BOATS bleibt unangetastet: die Overnight-Session laeuft 20:00–03:59 ET, also
   genau dann, wenn der IEX-Radar schweigt. Wer beides zusammen drosselt,
   nimmt der Vorabend-Liste ihre Grundlage. */
/* v3.32.6 · NACHKALIBRIERT MIT DER ERSTEN ECHTEN MESSUNG.
   Die Werte unten stammen nicht mehr aus einer Schaetzung. Gemessen am
   01.09.2026, 17:04, nach rund 17 Stunden Laufzeit:

     Pfad               Abrufe   Ø Antwort   Anteil
     iex-wholemarket       198   10.893 KB     64 %
     boats-bulk            184    6.544 KB     36 %
     iex-chart           1.085        8 KB      0 %

   Die Audit-Schaetzung lag bei 1,2 MB je `/iex`-Antwort. Gemessen sind
   **10,9 MB** — Faktor 9 daneben. Der Grund steht in der App: das Universum
   umfasst 42.627 Symbole, nicht die angenommenen ~12.000.

   Hochrechnung mit den echten Zahlen: 87 GB/Monat allein fuer den Radar, dazu
   49 GB fuer BOATS. Zusammen 136 GB bei 40 GB Limit. Die Taktung aus v3.32.0
   war also richtig gedacht und um den Faktor 3-4 zu schwach dimensioniert.

   Neue Werte, hergeleitet aus dem Ziel „unter 40 GB inklusive Reserve":
   Bei 10,9 MB je Abruf sind 40 GB rund 3.750 Abrufe im Monat, also ~125 am
   Tag fuer ALLE Pfade zusammen. Das Opening bleibt trotzdem eng getaktet —
   dort entsteht der Wert; gespart wird in den 16 handelsfreien Stunden. */
const RADAR_TTL_MS = {
  'opening':         120_000,   // 1,5 h → 45 Abrufe. Engste Taktung, hier entsteht der Wert
  'regular':         900_000,   // 5 h   → 20
  'premarket':      1200_000,   // 1,5 h →  4
  'premarket-early':2400_000,   // 4 h   →  6
  'after':          1200_000,   // 1 h   →  3
  'after-limited':  2400_000,   // 3 h   →  4
  'closed':         7200_000,   // 8 h   →  4. IEX handelt nicht
};
/* Ergibt 86 Abrufe je Handelstag und 12 je freiem Tag → rund 20 GB im Monat.
   Der erste Anlauf mit 120/300 s lag bei 34,9 GB und wurde von der eigenen
   Testgrenze zurueckgewiesen — richtig so: der Test verteidigt das ZIEL
   („unter 40 GB mit Reserve"), nicht die Taktwerte. Waere die Grenze als
   prozentuale Ersparnis gegenueber vorher formuliert gewesen, waere sie gruen
   gewesen und das Limit trotzdem gerissen.

   DER GROESSERE HEBEL BLEIBT OFFEN: Die Live-Quotes der ~20 Deep-Scan-Titel
   koennten ueber Alpaca `/v2/stocks/snapshots?symbols=…` kommen — das nimmt
   eine Symbolliste, ist bereits implementiert und kostet null
   Tiingo-Bandbreite. Dann waere der `/iex`-Abruf nur noch fuer die Discovery
   noetig und koennte noch weiter gedrosselt werden. Steht als R14. */
function radarTtlMs(phaseKey){
  const t = RADAR_TTL_MS[phaseKey];
  /* Unbekannte Phase -> der SPARSAME Wert, nicht der schnelle. Eine Phase, die
     wir nicht kennen, ist kein Grund, oefter zu laden. */
  return Number.isFinite(t) ? t : 300_000;
}

async function tiingoIexMarketRadar(env,limit=80,force=false){
  const now=Date.now();
  const phaseNow=usMarketPhase(new Date(now),'iex');
  const ttl=radarTtlMs(phaseNow.key);
  if(!force&&tiingoIexRadarMemo.rows.length&&now-tiingoIexRadarMemo.ts<ttl)return tiingoIexRadarMemo;
  /* Auch der persistierte Stand zaehlt: nach einem Isolate-Neustart mitten in
     der Nacht soll nicht sofort neu geladen werden, nur weil das Memo leer
     ist. Genau dieser Fall macht bei Cloudflare Workers den Unterschied. */
  const persisted=tiingoIexRadarMemo.rows.length?tiingoIexRadarMemo:await readPersistedIexRadar(env);
  if(!force&&persisted?.rows?.length&&Number.isFinite(Number(persisted.ts))&&now-Number(persisted.ts)<ttl){
    tiingoIexRadarMemo=persisted;
    return tiingoIexRadarMemo;
  }
  const prevMap=new Map((persisted?.rows||[]).map(r=>[r.symbol,r]));
  const d=await tiingoFetch(env,'/iex'), all=Array.isArray(d)?d:[];
  /* v3.32.0: Die Rohzeilen kurz aufbewahren. Der Deep-Scan braucht gleich
     Kurse fuer ~20 Titel und hat sie hier bereits vor sich liegen — ein
     zweiter Download desselben Marktes waere reine Verschwendung. Siehe
     `iexRawMemo` unten. Kein zusaetzlicher Speicher: es sind dieselben
     Objekte, sie leben nur laenger. */
  iexRawMemo={ts:now,bySymbol:new Map(all.map(x=>[String(x?.ticker||x?.symbol||'').toUpperCase(),x]))};
  const phase=phaseNow;
  const maxAge=['opening','regular'].includes(phase.key)?12:['premarket','after'].includes(phase.key)?30:90;
  resetRadarGateStats();
  const ranked=all.map(x=>iexRadarQuote(x,prevMap.get(String(x?.ticker||x?.symbol||'').toUpperCase()))).filter(Boolean)
    .filter(r=>radarCandidateAllowed(r,true,env))
    .filter(r=>r.ageMin==null||r.ageMin<=maxAge)
    .sort((a,b)=>b.score-a.score);
  // Instrument-Metadaten bewusst NICHT hier prüfen: Der Bulk-Radar soll CPU-arm
  // bleiben. ETF/ETP/Common-Stock-Verifikation erfolgt erst im getrennten Deep-
  // Scan-Cron auf den wenigen Top-Kandidaten.
  const rows=ranked.slice(0,Math.max(24,Math.min(120,limit)));
  tiingoIexRadarMemo={ts:now,rows,universe:all.length,phase:phase.key,ttlMs:ttl,source:'Tiingo IEX Large-Cap Radar · prefiltered',buyWeight:0};
  await persistIexRadar(env,tiingoIexRadarMemo);
  return tiingoIexRadarMemo;
}
function deepRecheckRank(r){
  const score=Number(r?.score)||0,crv=Number(r?.netCRV)||0,rv=Number(r?.relVol)||0,ret15=Number(r?.ret15)||0,structure=Number(r?.structurePct)||0,sit=Number(r?.situationScore)||0;
  const ell=Number(r?.elliott)||0;
  // v3.4.3: SituationScore priorisiert, WANN erneut hingesehen wird; Elliott/Qualitaet/CRV entscheiden weiterhin, OB ein Trade freigegeben werden kann.
  return ell*18 + score*6 + Math.min(18,sit*0.18) + Math.min(26,Math.max(0,crv-1)*7) + Math.min(14,Math.max(0,rv-1)*5) + Math.min(10,Math.max(0,ret15)*1.5) + Math.min(12,Math.max(0,structure));
}
async function tiingoIexSeries(env,symbol){
  const start=new Date(Date.now()-36*60*60_000).toISOString().slice(0,10);
  const path=`/iex/${encodeURIComponent(symbol)}/prices?startDate=${start}&resampleFreq=5min&columns=open,high,low,close,volume`;
  const d=await tiingoFetch(env,path);
  const arr=Array.isArray(d)?d:[];
  return {meta:{symbol,name:STOCK_NAMES[symbol]||STOCK_SEARCH_BY_SYMBOL.get(symbol)?.name||symbol,exchange:'US',currency:'USD'},values:arr.map(x=>({datetime:x.date,open:x.open,high:x.high,low:x.low,close:x.close,volume:x.volume})).reverse()};
}
async function tiingoAnalyseOne(env,symbol,sector,comp,minCrv,fx){
  const src=await tiingoIexSeries(env,symbol);
  const r=analyseStock(symbol,sector,src,fx,comp,minCrv);
  if(r){r.feed='Tiingo IEX';r.dataSource='tiingo-iex';}
  return r;
}

// v3.3.7 P0: A Deep-Scan close is an analysis price, not automatically the
// current executable/reference quote. For a user-selected stock we fetch the
// freshest available independent quote and expose source + timestamp. Missing
// freshness never improves a setup; the UI can therefore label/block stale data.
//
/* ==== v3.13.0 · BEFUND UND UMBAU ============================================
   `freshestStockQuote` wurde an genau ZWEI Stellen aufgerufen — beide im
   manuellen Suchpfad (`tiingoStockLookup`). Der automatische Deep-Scan hat sie
   NIE aufgerufen. Jede Zeile aus dem Scanner hatte deshalb `liveQuoteOk`
   undefiniert, und die Oberflaeche zeigte folgerichtig „KEIN LIVE-QUOTE" —
   selbst waehrend der US-Handelszeit, selbst fuer den Titel im Fokusfenster.

   Der naive Fix waere gewesen, die Funktion je Symbol im Scan aufzurufen: bei
   20 Titeln also 20 Alpaca- plus 20 Tiingo-Abfragen pro Zyklus. Das haette das
   API-Budget gesprengt.

   Entscheidend ist eine Eigenschaft, die im Bestand schon vorhanden war:
   `tiingoIexSnapshot` holt `/iex` fuer den GESAMTEN Markt in einem Aufruf und
   filtert erst danach lokal. Und Alpacas `/v2/stocks/snapshots` nimmt eine
   Symbolliste entgegen. Beide Quellen sind also von Natur aus Stapelabfragen.

   Deshalb: eine Stapelfunktion, die pro Durchlauf GENAU ZWEI Aufrufe macht —
   unabhaengig davon, ob 1 oder 100 Titel abgefragt werden. Der Einzelabruf ist
   nur noch ein Aufruf des Stapels mit einem Symbol, damit es weiterhin genau
   EINE Frischelogik gibt und nicht zwei, die auseinanderlaufen koennen.
   (Genau dieser Fehler war `sectorLag` in v3.10.0: eine Kennzahl, die nur auf
   einem von zwei Pfaden gerechnet wurde.)

   Unveraendert: Frische verbessert NIE ein Setup. Die Werte sind reine Anzeige,
   sie fliessen in keinen Score und in keine Kauf-Freigabe.                    */
function classifyQuoteFreshness(q){
  const ageSec=q.ts?Math.max(0,Math.round((Date.now()-q.ts)/1000)):null;
  const phase=usMarketPhase();
  const active=['premarket-early','premarket','opening','regular','after'].includes(phase.key);
  const live=active ? (ageSec!=null && ageSec<=120) : (ageSec!=null && ageSec<=900);
  return {...q,ageSec,live,marketPhase:phase.key};
}

async function freshestStockQuotesBatch(env,rawSymbols){
  const syms=[...new Set((Array.isArray(rawSymbols)?rawSymbols:String(rawSymbols||'').split(','))
    .map(x=>safeRadarSymbol(x)).filter(Boolean))].slice(0,100);
  const out=new Map();
  if(!syms.length) return out;
  const bucket=new Map();   // symbol -> Kandidatenliste
  const add=(sym,price,ts,source,scope)=>{
    const p=Number(price),ms=ts?Date.parse(ts):NaN;
    if(!Number.isFinite(p)||p<=0) return;
    const a=bucket.get(sym)||[]; a.push({priceUsd:p,ts:Number.isFinite(ms)?ms:null,updated:ts||null,source,scope});
    bucket.set(sym,a);
  };

  // --- Alpaca: EIN Aufruf fuer alle Symbole ---------------------------------
  if(env.ALPACA_API_KEY_ID&&env.ALPACA_API_SECRET_KEY){
    try{
      const feed=alpacaFeed(env);
      const d=await alpacaJSON('/v2/stocks/snapshots',{symbols:syms.join(','),feed},env);
      const scope=feed==='sip'?'konsolidierter US-Feed':'IEX-Teilmarkt';
      for(const sym of syms){
        const snap=d?.[sym]; if(!snap) continue;
        add(sym,snap.latestTrade?.p,snap.latestTrade?.t,`Alpaca ${alpacaFeedLabel(env)}`,scope);
        add(sym,snap.minuteBar?.c,snap.minuteBar?.t,`Alpaca ${alpacaFeedLabel(env)}`,scope);
      }
    }catch(e){console.warn(JSON.stringify({event:'stock_fresh_quote_alpaca_failed',count:syms.length,message:String(e?.message||e),ts:Date.now()}));}
  }

  // --- Tiingo: EIN Aufruf, /iex liefert ohnehin den ganzen Markt -------------
  if(env.TIINGO_API_TOKEN){
    try{
      const arr=await tiingoIexSnapshot(env,syms.join(','));
      for(const x of (arr||[])){
        const sym=String(x?.ticker||x?.symbol||'').toUpperCase();
        if(!sym) continue;
        add(sym,x.tngoLast??x.last??x.lastPrice,x.timestamp||x.lastSaleTimestamp||x.quoteTimestamp||x.lastUpdated,'Tiingo IEX','IEX-Teilmarkt');
      }
    }catch(e){console.warn(JSON.stringify({event:'stock_fresh_quote_tiingo_failed',count:syms.length,message:String(e?.message||e),ts:Date.now()}));}
  }

  for(const [sym,cands] of bucket){
    if(!cands.length) continue;
    cands.sort((a,b)=>(b.ts||0)-(a.ts||0));
    out.set(sym,classifyQuoteFreshness(cands[0]));
  }
  return out;
}

/* Einzelabruf = Stapel mit einem Symbol. Bewusst KEINE zweite Implementierung. */
async function freshestStockQuote(env,symbol){
  const sym=safeRadarSymbol(symbol); if(!sym) return null;
  const m=await freshestStockQuotesBatch(env,[sym]);
  return m.get(sym)||null;
}

/* Haengt die Stapel-Quotes an Zeilen. Rein additiv: eine Zeile ohne Quote
   behaelt ihre Felder unveraendert und wird von der Oberflaeche korrekt als
   „kein Live-Quote" beschriftet — kein erfundener Wert. */
function attachLiveQuotes(rows,quotes,fx){
  let hit=0;
  for(const r of rows||[]){
    const q=quotes?.get(String(r?.symbol||'').toUpperCase());
    if(!q) continue;
    r.livePriceUsd=q.priceUsd; r.livePriceEur=fx?q.priceUsd/fx:null;
    r.liveUpdated=q.updated; r.liveQuoteTs=q.ts; r.liveQuoteAgeSec=q.ageSec;
    r.liveQuoteSource=q.source; r.liveQuoteScope=q.scope; r.liveQuoteOk=!!q.live;
    hit++;
  }
  return hit;
}

async function tiingoValidation(env,rawSymbols){
  const symbols=[...new Set(String(rawSymbols||'AAPL,NVDA,TSLA').split(',').map(x=>x.trim().toUpperCase()).filter(x=>/^[A-Z0-9.\-]{1,12}$/.test(x)))].slice(0,3);
  const out={configured:!!env.TIINGO_API_TOKEN,mode:tiingoStocksMode(env),symbols,version:APP_VERSION,tests:{},safe:true};
  if(!env.TIINGO_API_TOKEN){out.state='nokey';return out;}
  try{const d=await tiingoFetch(env,'/api/test/');out.tests.auth={ok:true,message:d?.message||'authenticated'};}catch(e){out.tests.auth={ok:false,error:String(e.message||e)};out.state='error';return out;}
  try{const snaps=await tiingoIexSnapshot(env,symbols.join(','));out.tests.iexSnapshot={ok:snaps.length>0,count:snaps.length,rows:snaps.map(x=>({ticker:x.ticker,timestamp:x.timestamp,last:x.last,tngoLast:x.tngoLast,volume:x.volume}))};}catch(e){out.tests.iexSnapshot={ok:false,error:String(e.message||e)};}
  try{const fx=await getTiingoFx(env);out.tests.fx={ok:Number.isFinite(fx)&&fx>0,usdPerEur:fx||null};}catch(e){out.tests.fx={ok:false,error:String(e.message||e)};}
  out.tests.history=[];
  for(const sym of symbols.slice(0,2)){
    try{
      const d=await tiingoIexSeries(env,sym), vals=d.values||[], latest=vals[0]?.datetime||null, latestMs=latest?Date.parse(latest):NaN;
      const ohlcKnown=vals.length>0 && vals.slice(0,Math.min(3,vals.length)).every(x=>[x.open,x.high,x.low,x.close].every(v=>Number.isFinite(Number(v))));
      const ageMinutes=Number.isFinite(latestMs)?Math.max(0,Math.round((Date.now()-latestMs)/60000)):null;
      // Verwendbarkeit statt willkuerlicher Mindestzahl: wenige aktuelle Bars sind fuer einen Live-Test ausreichend.
      // Die Analyse selbst entscheidet spaeter anhand ihrer benoetigten Historie, ob ein Titel tief genug analysierbar ist.
      const usable=vals.length>=2 && ohlcKnown && Number.isFinite(latestMs);
      out.tests.history.push({symbol:sym,ok:usable,usable,bars:vals.length,latest,ageMinutes,ohlcKnown,volumeKnown:vals.some(x=>Number(x.volume)>0)});
    }catch(e){out.tests.history.push({symbol:sym,ok:false,usable:false,error:String(e.message||e)});}
  }
  try{const b=await tiingoBoatsSnapshot(env,symbols.slice(0,2).join(','));const valid=(b.rows||[]).filter(r=>!r.error);out.tests.boats={ok:valid.length>0,count:valid.length,rows:valid.map(r=>({symbol:r.symbol||r.ticker,last:r.last??r.lastPrice??null,bid:r.bidPrice??r.bid??null,ask:r.askPrice??r.ask??null,timestamp:r.timestamp??r.quoteTimestamp??null}))};if(!valid.length&&b.rows?.some(r=>r.error))out.tests.boats.error=b.rows.map(r=>r.error).filter(Boolean).join(' | ');}catch(e){out.tests.boats={ok:false,error:String(e.message||e)};}
  out.readyForPrimary=!!(out.tests.auth?.ok && out.tests.iexSnapshot?.ok && out.tests.history.length>0 && out.tests.history.every(x=>x.usable&&x.volumeKnown) && out.tests.boats?.ok);
  out.state=out.readyForPrimary?'ok':'partial';
  out.safe=true;out.note='Read-only-Test mit 0 % Einfluss auf BUY/Score. 5-MIN wird nach echter Verwendbarkeit (Bars, OHLC, Zeitstempel) statt nach einer starren Anzahl von 24 Bars bewertet. Primary bleibt bis zur ausdruecklichen Umschaltung im Shadow-Modus.';
  return out;
}
async function tiingoStockSnapshot(env,force=false,comp,minCrv=3,favoriteSymbols=[],execution='client'){
  if(!env.TIINGO_API_TOKEN) return {configured:false,state:'nokey',rows:stockMemo.rows||[],source:'Tiingo IEX',version:APP_VERSION,note:'TIINGO_API_TOKEN fehlt'};
  const minuteSlot=Math.floor(Date.now()/60_000), favs=[...new Set((favoriteSymbols||[]).map(x=>String(x).trim().toUpperCase()).filter(x=>/^[A-Z0-9.\-]{1,12}$/.test(x)))].slice(0,30);
  const cycle=Math.floor(minuteSlot/2); // Deep Scan alle 2 Minuten - Browser und Cron verwenden denselben Zyklus.
  const sig=[...(comp instanceof Set?comp:new Set(ALL_ON))].sort().join('.')+'|'+minCrv+'|tiingo-primary-radar|fav:'+favs.join('.');
  if(!force&&stockMemo.rows.length&&stockMemo.cycle===cycle&&stockMemo.sig===sig&&Date.now()-stockMemo.ts<110_000){
    const cleanMemo=stripKnownNonCommon(stockMemo.rows);
    if(cleanMemo.length!==stockMemo.rows.length) stockMemo={...stockMemo,rows:cleanMemo};
    const memoRadar=verifiedCommonOnly(tiingoIexRadarMemo.rows||[]).slice(0,20);
    const memoBoats=verifiedCommonOnly(tiingoDiscoveryMemo.rows||[]).slice(0,15);
    return {configured:true,state:'ok',cached:true,rows:cleanMemo,ts:stockMemo.ts,cycle,universe:tiingoIexRadarMemo.universe||12000,universeLabel:`${tiingoIexRadarMemo.universe||'12.000+'} Tiingo/IEX`,scanned:cleanMemo.length,updatedThisCycle:0,refreshedSymbols:Array.isArray(stockMemo.refreshedSymbols)?stockMemo.refreshedSymbols:[],favoritePriority:favs.length,source:'Tiingo IEX',provider:'Tiingo',market:usMarketPhase(),discovery:{radar:{source:'Tiingo IEX Whole-Market Radar · verified cache only',ts:tiingoIexRadarMemo.ts,candidates:memoRadar,gainers:openingGainers(memoRadar),buyWeight:0,gate:{...radarGateStats}},boats:{...tiingoDiscoveryMemo,rows:memoBoats,candidates:memoBoats,buyWeight:0}},version:APP_VERSION};
  }

  // Browser/PWA darf den autonomen Markt-Scan nicht mehr selbst starten.
  // Sie liest den letzten Cron-Batch. Das verhindert parallele CPU-Spitzen bei
  // mehreren Tabs/Geraeten und auf frisch gestarteten Worker-Isolates.
  if(execution!=='server'&&!force){
    const persisted=await readLatestPersistedStockScan(env,4*60_000);
    if(persisted){
      let verifiedRadar=verifiedCommonOnly(Array.isArray(persisted.meta?.verifiedRadar)?persisted.meta.verifiedRadar:[]);
      const openingVerified=await readVerifiedOpeningRadar(env,30*60_000);
      if(openingVerified.length){
        const bySym=new Map([...verifiedRadar,...openingVerified].map(x=>[String(x.symbol||'').toUpperCase(),x]));
        verifiedRadar=[...bySym.values()].slice(0,24);
      }
      const verifiedBoats=verifiedCommonOnly(Array.isArray(persisted.meta?.verifiedBoats)?persisted.meta.verifiedBoats:[]);
      const allowed=new Set([...verifiedRadar,...verifiedBoats].map(x=>String(x.symbol||'').toUpperCase()));
      const catalogSet=new Set(STOCK_SEARCH_CATALOG.map(x=>x[1]));
      const cleanRows=(persisted.rows||[]).filter(r=>{const sym=String(r?.symbol||'').toUpperCase();return !NON_COMMON_SYMBOL_DENY.has(sym) && !NON_COMMON_EQUITY_RE.test(`${r?.securityName||''} ${r?.name||''}`) && (catalogSet.has(sym)||favs.includes(sym)||allowed.has(sym));});
      stockMemo={ts:persisted.ts,rows:cleanRows,cycle:persisted.cycle,sig:persisted.sig,refreshedSymbols:Array.isArray(persisted.meta?.refreshedSymbols)?persisted.meta.refreshedSymbols:[]};
      const radar=await readPersistedIexRadar(env);
      return {configured:true,state:'ok',cached:true,persistent:true,rows:cleanRows,ts:persisted.ts,cycle:persisted.cycle,universe:radar?.universe||12000,universeLabel:`${radar?.universe||'12.000+'} Tiingo/IEX`,scanned:cleanRows.length,updatedThisCycle:0,refreshedSymbols:Array.isArray(persisted.meta?.refreshedSymbols)?persisted.meta.refreshedSymbols:[],favoritePriority:favs.length,source:'Tiingo IEX',provider:'Tiingo',market:usMarketPhase(),discovery:{radar:{source:'Tiingo IEX Whole-Market Radar · verified',ts:persisted.ts||0,candidates:verifiedRadar,gainers:openingGainers(verifiedRadar),buyWeight:0,gate:{...radarGateStats}},boats:{source:'Tiingo BOATS · verified',ts:persisted.ts||0,candidates:verifiedBoats,buyWeight:0}},version:APP_VERSION,note:'Server-Cache: autonomer Cron-Radar/Deep-Scan; PWA startet keinen Doppel-Scan. Nur verifizierte Common Stocks werden an die UI gereicht.'};
    }
    const staleRows=stripKnownNonCommon(stockMemo.rows||[]);
    return {configured:true,state:'stale',cached:true,rows:staleRows,ts:stockMemo.ts||0,cycle,universe:tiingoIexRadarMemo.universe||12000,universeLabel:`${tiingoIexRadarMemo.universe||'12.000+'} Tiingo/IEX`,scanned:staleRows.length,updatedThisCycle:0,refreshedSymbols:[],favoritePriority:favs.length,source:'Tiingo IEX',provider:'Tiingo',market:usMarketPhase(),discovery:{radar:{source:'Tiingo IEX Whole-Market Radar',ts:tiingoIexRadarMemo.ts,candidates:(tiingoIexRadarMemo.rows||[]).slice(0,20),buyWeight:0,gate:{...radarGateStats}},boats:tiingoDiscoveryMemo},version:APP_VERSION,note:'Warte auf ersten serverseitigen Cron-Batch.'};
  }

  const phase=usMarketPhase(new Date(),'iex');
  // v3.2.1: waehrend der US-Session ist /iex der marktweite Primaer-Radar.
  // BOATS bleibt Overnight-/Uebergangs-Discovery. Beide Layer nominieren nur und haben 0 % BUY-Gewicht.
  let radar={ts:0,rows:[],universe:12000,source:'Tiingo IEX Whole-Market Radar',buyWeight:0};
  try{
    radar=(tiingoIexRadarMemo.rows.length&&Date.now()-tiingoIexRadarMemo.ts<4*60_000)?tiingoIexRadarMemo:(await readPersistedIexRadar(env)||radar);
    // ETF/ETP-Gate jetzt auf der kleinen Kandidatenmenge und getrennt vom Bulk-Radar.
    radar={...radar,rows:await filterRadarToCommonStocks(env,radar.rows||[],20),source:'Tiingo IEX Whole-Market Radar · Common Stocks verified'};
    const openingVerified=await readVerifiedOpeningRadar(env,30*60_000);
    if(openingVerified.length){
      const merged=new Map([...(radar.rows||[]),...openingVerified].map(x=>[String(x.symbol||'').toUpperCase(),x]));
      radar={...radar,rows:[...merged.values()].slice(0,24),source:'Tiingo IEX Whole-Market Radar + Opening verified'};
    }
  }catch(e){console.warn(JSON.stringify({event:'iex_market_radar_cache_failed',message:String(e?.message||e),ts:Date.now()}));}
  let boats=await tiingoBoatsDiscovery(env,20,false);
  try{
    boats={...boats,rows:await filterRadarToCommonStocks(env,boats.rows||[],12),source:'Tiingo BOATS · Common Stocks verified'};
  }catch(e){
    console.warn(JSON.stringify({event:'boats_security_gate_failed',message:String(e?.message||e),ts:Date.now()}));
    boats={...boats,rows:[]}; // fail-closed: keine unbestätigten BOATS-Instrumente in den Aktien-Deep-Scan
  }

  const deepLimit=await readStockDeepLimit(env);
  const scale=deepLimit/STOCK_DEEP_DEFAULT; // proportional zur bisherigen 20er-Baseline
  const capFav=2, capGainer=Math.max(4,Math.round(4*scale)), capRadar=Math.max(8,Math.round(8*scale)),
        capRecheck=Math.max(2,Math.round(2*scale)), capBoats=Math.max(2,Math.round(2*scale));
  const picked=new Set(), favPick=[], recheckPick=[], radarPick=[], boatsPick=[], explore=[];
  // Favoriten bleiben vertreten, blockieren aber nicht mehr die gesamte Queue.
  // Favoriten rotieren pro Deep-Scan-Zyklus. v3.3.2 nahm immer nur die ersten
  // zwei Favoriten und ließ spätere Favoriten dadurch unnötig lange stale.
  if(favs.length){
    const startFav=(cycle*2)%favs.length;
    for(let i=0;i<favs.length&&favPick.length<capFav;i++){
      const sym=favs[(startFav+i)%favs.length];
      if(!picked.has(sym)){picked.add(sym);favPick.push(sym);}
    }
  }
  // v3.3.4: Whole-Market-Kandidaten werden VOR alten Rechecks priorisiert.
  // So kann der Deep Scan nicht wieder faktisch zu einem Favoriten-/Cache-Pool werden.
  const gainerPick=[];
  for(const x of openingGainers(radar.rows||[],capGainer)){if(!picked.has(x.symbol)){picked.add(x.symbol);gainerPick.push(x.symbol);}if(gainerPick.length>=capGainer)break;}
  /* v3.15.0: Sektor-Reserve VOR dem allgemeinen Radar. Sie zieht nur Titel, die
     der Radar ohnehin nominiert hat — es wird also nichts erfunden, nur die
     Reihenfolge geaendert. Reicht ein Sektor nicht, verfaellt sein Platz an den
     allgemeinen Radar statt leer zu bleiben. */
  /* v3.18.0 · P-A4: ZWEITE Quelle fuer die Reserve — der statische Katalog.
     ANLASS, ausgezaehlt: von 52 Edelmetall-Tickern steht KEINER in
     LARGE_CAP_RADAR_SYMBOLS und genau einer im Katalog. 98 % sind damit nur
     ueber das Momentum-Gitter erreichbar (>=3 % Bewegung UND >=2 Mio. $
     IEX-Umsatz ~ 80 Mio. $ Gesamtumsatz). Der reservierte Platz verfiel
     deshalb an den meisten Tagen still — die Sektor-Priorisierung aus v3.15.0
     war fuer Edelmetalle praktisch wirkungslos.

     Die Radarquelle behaelt VORRANG. Der Katalog springt nur ein, wenn der
     Radar fuer diesen Sektor nichts hergibt. Ein Katalogtitel ist ausdruecklich
     KEINE Radar-Nominierung: der Radar hat ihn nicht auffaellig gefunden, er
     wird nur angesehen. Deshalb traegt er `sectorFillFromCatalog` und wird in
     der Oberflaeche anders beschriftet.

     Was das NICHT tut: keinen Score, kein Gate, keine Ampel, keine Freigabe.
     Ein Titel aus einem Prioritaetssektor bekommt Aufmerksamkeit, keinen
     Bonus — dieselbe Regel wie fuer Radar und BOATS seit v3.3.4. */
  const sectorPick=[], sectorFromCatalog=new Set();
  for(const [name] of PRIORITY_SECTORS){
    let took=0;
    for(const x of radar.rows||[]){
      if(took>=SECTOR_RESERVE_PER_SECTOR)break;
      if(picked.has(x.symbol))continue;
      if(prioritySectorOf(x.symbol)!==name)continue;
      picked.add(x.symbol);sectorPick.push(x.symbol);took++;
    }
    if(took>=SECTOR_RESERVE_PER_SECTOR) continue;
    // Rotierender Einstieg, damit nicht jeden Zyklus derselbe Titel kommt.
    const pool=STOCK_SEARCH_CATALOG.filter(e=>prioritySectorOf(e[1])===name);
    for(let i=0;i<pool.length && took<SECTOR_RESERVE_PER_SECTOR;i++){
      const sym=String(pool[(i+cycle)%pool.length][1]||'').toUpperCase();
      if(!sym||picked.has(sym))continue;
      picked.add(sym);sectorPick.push(sym);sectorFromCatalog.add(sym);took++;
    }
  }
  for(const x of radar.rows||[]){if(!picked.has(x.symbol)){picked.add(x.symbol);radarPick.push(x.symbol);}if(radarPick.length>=capRadar)break;}
  // Nur zwei starke Altanalysen pro Zyklus nachziehen; Discovery hat Vorrang.
  for(const r of [...(stockMemo.rows||[])].sort((a,b)=>deepRecheckRank(b)-deepRecheckRank(a))){const sym=String(r?.symbol||'').toUpperCase();if(sym&&!picked.has(sym)){picked.add(sym);recheckPick.push(sym);}if(recheckPick.length>=capRecheck)break;}
  // Overnight/Extended-Hours-Kandidaten duerfen die Queue ergaenzen, aber nie BUY setzen.
  for(const x of boats.rows||[]){if(!picked.has(x.symbol)){picked.add(x.symbol);boatsPick.push(x.symbol);}if(boatsPick.length>=capBoats)break;}
  // Exploration verhindert Tunnelblick und sorgt fuer fortlaufende Rotation des stabilen Basiskatalogs.
  const start=(cycle*7)%STOCK_SEARCH_CATALOG.length;
  for(let i=0;i<STOCK_SEARCH_CATALOG.length&&picked.size<deepLimit;i++){const sym=STOCK_SEARCH_CATALOG[(start+i)%STOCK_SEARCH_CATALOG.length][1];if(!picked.has(sym)){picked.add(sym);explore.push(sym);}}
  const syms=[...favPick,...recheckPick,...gainerPick,...sectorPick,...radarPick,...boatsPick,...explore].slice(0,deepLimit), fx=await getTiingoFx(env);
  const radarMap=new Map((radar.rows||[]).map(x=>[x.symbol,x])), boatsMap=new Map((boats.rows||[]).map(x=>[x.symbol,x]));
  const fresh=(await pool(syms,6,async sym=>{
    const inf=STOCK_SEARCH_BY_SYMBOL.get(sym)||{sector:'Discovery',name:sym};
    try{
      const row=await tiingoAnalyseOne(env,sym,inf.sector,comp,minCrv,fx);
      if(!row)return null;
      if(NON_COMMON_SYMBOL_DENY.has(sym)||NON_COMMON_EQUITY_RE.test(`${row?.name||''} ${row?.securityName||''}`))return null;
      const rm=radarMap.get(sym),bm=boatsMap.get(sym);
      if(rm){ row.discovery={type:'iex-radar',...rm,buyWeight:0}; row.securityVerified=rm.securityVerified===true; row.securityName=rm.securityName||row.name; row.companyDescription=rm.companyDescription||''; row.exchange=rm.exchange||''; }
      else if(bm){ row.discovery={type:'boats',...bm,buyWeight:0}; row.securityVerified=bm.securityVerified===true; row.securityName=bm.securityName||row.name; row.companyDescription=bm.companyDescription||''; row.exchange=bm.exchange||''; }
      const q=Math.max(0,Math.min(10,Number(row.score)||0)),crv=Math.max(0,Number(row.netCRV)||0),rv=Math.max(0,Number(row.relVol)||0),sit=Math.max(0,Math.min(100,Number(row.situationScore)||0));
      // Reife bleibt reine Vorwarnung: Situation kann frueh Aufmerksamkeit erzeugen,
      // aber weder Score noch CRV noch BUY-Gates verbessern.
      const life=String(rm?.lifecycle||'WATCH');
      const lifeBonus=life==='IGNITION'?16:life==='PREP'?10:life==='CONFIRM'?6:life==='LATE'?-14:0;
      const triggerProx=row.triggerDistancePct==null?0:Math.max(0,10-Math.min(10,Math.abs(Number(row.triggerDistancePct))*12));
      row.preSignalMaturity=Math.round(Math.max(0,Math.min(100,q/8*38 + Math.min(1,crv/3)*20 + Math.min(1,rv/1.8)*10 + sit*0.18 + lifeBonus + triggerProx)));
      row.whyNow=[...(rm?.reasons||[]),...(row.situationReasons||[])].filter(Boolean).slice(0,5);
      row.radarRank=Number(rm?.situationScore??rm?.score)||0;
      row.radarSituation=rm?.situation||null;
      row.radarLifecycle=life;
      // v3.15.0: nur Kennzeichnung. Kein Score, kein Gate, keine Ampel haengt daran.
      row.prioritySector=prioritySectorOf(sym);
      // v3.18.0: Aufmerksamkeit aus dem Katalog ist KEINE Radar-Nominierung.
      if(sectorFromCatalog.has(sym)) row.sectorFillFromCatalog=true;
      return row;
    }catch(e){console.warn(JSON.stringify({event:'tiingo_stock_failed',symbol:sym,message:String(e?.message||e),ts:Date.now()}));return null;}
  })).filter(Boolean);
  // v3.3.4: Bereits erfolgreich tief analysierte Radar-Titel bleiben sichtbar, solange
  // sie im AKTUELL verifizierten Discovery-Pool stehen. Das ist fail-closed, weil
  // unbestätigte/alte Discovery-Titel weiterhin herausfallen, verhindert aber, dass
  // die UI zwischen Zyklen wieder fast nur Favoriten zeigt.
  const safeCarry=new Map();
  const catalogSet=new Set(STOCK_SEARCH_CATALOG.map(x=>x[1]));
  const verifiedDiscoveryNow=new Set([...(radar.rows||[]),...(boats.rows||[])].map(x=>String(x?.symbol||'').toUpperCase()).filter(Boolean));
  for(const r of stockMemo.rows||[]){
    const sym=String(r?.symbol||'').toUpperCase();
    if(catalogSet.has(sym)||favs.includes(sym)||verifiedDiscoveryNow.has(sym)) safeCarry.set(sym,r);
  }
  for(const r of fresh)safeCarry.set(r.symbol,r);
  // Hohe Radar-/Setup-Relevanz oben halten; Freshness-Gates bleiben unveraendert.
  const rows=[...safeCarry.values()].sort((a,b)=>(Number(b.preSignalMaturity)||0)-(Number(a.preSignalMaturity)||0)||(Number(b.situationScore)||0)-(Number(a.situationScore)||0)||(Number(b.radarRank)||0)-(Number(a.radarRank)||0)||(Number(b.score)||0)-(Number(a.score)||0)).slice(0,100);
  applySectorLag(rows);   // v3.10.0 FIX: fehlte auf dem primaeren Pfad komplett
  /* v3.13.0 FIX: Der Deep-Scan hat NIE einen Live-Quote geholt — jede Zeile aus
     dem Scanner hatte `liveQuoteOk` undefiniert, die Oberflaeche zeigte deshalb
     dauerhaft „KEIN LIVE-QUOTE". Der Stapelabruf kostet GENAU ZWEI Aufrufe pro
     Zyklus (Alpaca-Snapshots mit Symbolliste, Tiingo /iex fuer den ganzen Markt),
     unabhaengig von der Zeilenzahl. Rein additiv, kein Score-Eingriff:
     scheitert der Abruf, bleiben die Zeilen unveraendert und werden von der
     Oberflaeche weiterhin korrekt als „kein Live-Quote" beschriftet. */
  let liveQuoteHits=0;
  try{
    const q=await freshestStockQuotesBatch(env,rows.map(r=>r.symbol));
    liveQuoteHits=attachLiveQuotes(rows,q,fx);
  }catch(e){ console.warn(JSON.stringify({event:'deep_scan_live_quotes_failed',message:String(e?.message||e),ts:Date.now()})); }
  stockMemo={ts:Date.now(),rows,cycle,sig}; setApiState('stocks',fresh.length?'ok':'stale',fresh.length?null:'Tiingo lieferte keine analysierbaren Bars');
  stockMemo.liveQuoteHits=liveQuoteHits;   // v3.13.0: stiller Ausfall soll sichtbar sein
  await persistStockScan(env,sig,cycle,rows,{provider:'Tiingo IEX',fxUsdPerEur:fx||null,refreshedSymbols:fresh.map(r=>r.symbol),queue:{favorites:favPick,recheck:recheckPick,gainers:gainerPick,radar:radarPick,boats:boatsPick,explore},verifiedRadar:(radar.rows||[]).slice(0,20),verifiedBoats:(boats.rows||[]).slice(0,12)});
  return {configured:true,state:fresh.length?'ok':'stale',cached:false,rows,ts:stockMemo.ts,cycle,universe:radar.universe||12000,universeLabel:`${radar.universe||'12.000+'} Tiingo/IEX`,scanned:rows.length,deepCandidates:syms.length,updatedThisCycle:fresh.length,refreshedSymbols:fresh.map(r=>r.symbol),favoritePriority:favs.length,fxUsdPerEur:fx||null,source:'Tiingo IEX',provider:'Tiingo',market:phase,queue:{favorites:favPick.length,recheck:recheckPick.length,gainers:gainerPick.length,radar:radarPick.length,boats:boatsPick.length,explore:explore.length},discovery:{radar:{source:'Tiingo IEX Whole-Market Radar',ts:radar.ts,universe:radar.universe,candidates:(radar.rows||[]).slice(0,20),gainers:openingGainers(radar.rows||[]),buyWeight:0,gate:{...radarGateStats}},boats:{source:'Tiingo BOATS',ts:boats.ts,session:boats.session,candidates:(boats.rows||[]).slice(0,15),buyWeight:0}},version:APP_VERSION,note:'Tiingo Primary: Large-Cap Opportunity Lifecycle Radar + BOATS Discovery (beide 0 % direktes BUY-Gewicht) -> adaptive Deep-Scan-Queue -> IEX 5-Min Analyse.'};
}
async function tiingoStockSuggest(env,raw){
  const query=String(raw||'').trim();
  if(query.length<1) return {configured:!!env.TIINGO_API_TOKEN,state:'idle',rows:[],version:APP_VERSION};
  const local=resolveStockQuery(query);
  const out=[];
  if(local) out.push({symbol:local.symbol,name:local.name||local.symbol,sector:local.sector||null,source:'catalog'});
  if(env.TIINGO_API_TOKEN && query.length>=2){
    try{
      const q=encodeURIComponent(query);
      const d=await tiingoFetch(env,`/tiingo/utilities/search?query=${q}`);
      for(const hit of (Array.isArray(d)?d:[])){
        if(hit?.isActive===false) continue;
        const asset=String(hit?.assetType||'').toLowerCase();
        if(asset && asset!=='stock') continue;
        const symbol=String(hit?.ticker||'').toUpperCase().replace(/\./g,'-');
        if(!/^[A-Z][A-Z0-9-]{0,11}$/.test(symbol) || NON_COMMON_SYMBOL_DENY.has(symbol)) continue;
        const name=String(hit?.name||symbol);
        if(NON_COMMON_EQUITY_RE.test(name)) continue;
        if(!out.some(x=>x.symbol===symbol)) out.push({symbol,name,exchange:hit?.exchangeCode||hit?.exchange||null,source:'tiingo-search'});
        if(out.length>=5) break;
      }
    }catch(e){
      if(!out.length) return {configured:true,state:'partial',rows:[],error:String(e?.message||e),version:APP_VERSION};
    }
  }
  return {configured:!!env.TIINGO_API_TOKEN,state:'ok',rows:out.slice(0,5),version:APP_VERSION};
}

async function tiingoStockLookup(env,raw,comp,minCrv=3,force=false){
  let info=resolveStockQuery(raw);
  if(!info){
    try{
      const q=encodeURIComponent(String(raw||'').trim());
      const d=await tiingoFetch(env,`/tiingo/utilities/search?query=${q}`);
      const hit=(Array.isArray(d)?d:[]).find(x=>x?.isActive!==false && String(x?.assetType||'').toLowerCase()==='stock') || (Array.isArray(d)?d:[])[0];
      if(hit?.ticker) info={symbol:String(hit.ticker).toUpperCase().replace(/\./g,'-'),name:hit.name||hit.ticker,sector:null,exchange:null};
    }catch(e){ console.warn(JSON.stringify({event:'tiingo_search_failed',query:String(raw||''),message:String(e?.message||e),ts:Date.now()})); }
  }
  if(!info) return {configured:true,state:'ok',notFound:true,error:'Ticker/Firmenname bei Tiingo nicht gefunden.',source:'Tiingo IEX',version:APP_VERSION};
  const cached=stockLookupMemo.get(info.symbol);if(!force&&cached&&Date.now()-cached.ts<5*60_000){
    const row={...cached.row};
    const fq=await freshestStockQuote(env,info.symbol);
    if(fq){const fx=await getTiingoFx(env);row.livePriceUsd=fq.priceUsd;row.livePriceEur=fx?fq.priceUsd/fx:null;row.liveUpdated=fq.updated;row.liveQuoteTs=fq.ts;row.liveQuoteAgeSec=fq.ageSec;row.liveQuoteSource=fq.source;row.liveQuoteScope=fq.scope;row.liveQuoteOk=!!fq.live;}
    return {configured:true,state:'ok',cached:true,lookup:true,row,source:'Tiingo IEX',version:APP_VERSION};
  }
  const fx=await getTiingoFx(env),row=await tiingoAnalyseOne(env,info.symbol,info.sector,comp,minCrv,fx);
  if(!row)return {configured:true,state:'ok',notFound:true,error:'Noch nicht genügend Tiingo-5-Minuten-Daten.',source:'Tiingo IEX',version:APP_VERSION};
  if(info.name&&row.name===row.symbol)row.name=info.name;
  const fq=await freshestStockQuote(env,info.symbol);
  if(fq){
    row.livePriceUsd=fq.priceUsd; row.livePriceEur=fx?fq.priceUsd/fx:null;
    row.liveUpdated=fq.updated; row.liveQuoteTs=fq.ts; row.liveQuoteAgeSec=fq.ageSec;
    row.liveQuoteSource=fq.source; row.liveQuoteScope=fq.scope; row.liveQuoteOk=!!fq.live;
    row.analysisPriceUsd=row.priceUsd; row.analysisUpdated=row.updated;
  }else{row.liveQuoteOk=false;row.liveQuoteSource='kein separater Live-Quote verfügbar';}
  stockLookupMemo.set(info.symbol,{ts:Date.now(),row});const old=new Map(stockMemo.rows.map(r=>[r.symbol,r]));old.set(row.symbol,row);stockMemo.rows=[...old.values()].sort((a,b)=>b.score-a.score).slice(0,80);
  return {configured:true,state:'ok',cached:false,lookup:true,row,source:'Tiingo IEX',provider:'Tiingo',version:APP_VERSION};
}
export { analyse, analyseStock, aladdinIntelligence, aladdinRegime, aladdinSectors, marketRecommendation };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      /* ═══ v3.32.7 · `protected` BESCHREIBT DIE INSTALLATION, NICHT DEN ANRUFER ═══
         `protected: !!env.APP_TOKEN` heisst „diese Instanz verlangt einen
         Token" — das ist eine Eigenschaft des Deployments und bleibt wahr,
         auch wenn der Anrufer sauber autorisiert ist. Der Client hat dieses
         Feld bis v3.32.6 als „auf diesem Geraet fehlt der Token" gelesen und
         war deshalb ab dem Moment dauerhaft rot, in dem ueberhaupt ein
         APP_TOKEN gesetzt war.
         Neu ist `authenticated`: eine Aussage ueber DIESE Anfrage. Nur sie
         darf die Systemleiste rot faerben. Alte Clients ignorieren das Feld,
         alte Worker liefern es nicht — die Pruefung im Client ist deshalb
         ausdruecklich `=== false` und nicht `!== true`. */
      if (env.APP_TOKEN && !authed(request, url, env)) return json({ok:true,version:APP_VERSION,protected:true,authenticated:false},200,{ 'cache-control':'no-store' });
      /* v3.32.0: aus D1 nachladen, sonst meldet eine frisch gestartete
         Worker-Instanz „nichts gemessen", obwohl im selben Monat schon
         gemessen wurde. Isolate-Neustarts sind bei Workers der Normalfall. */
      await loadTiingoBwOnce(env);
      // Version kommt aus dem DEPLOYTEN Code, nicht aus einer CF-Variable.
      // Weicht env.APP_VERSION ab, ist die Variable veraltet – das wird gemeldet.
      const [cryptoHealth,stocksHealth,alpacaHealth] = await Promise.all([
        persistentApiState(env,'crypto',!!env.FUSION_API_KEY),
        persistentApiState(env,'stocks',tiingoStocksMode(env)==='primary'?!!env.TIINGO_API_TOKEN:!!env.TWELVE_API_KEY),
        persistentApiState(env,'alpaca',!!(env.ALPACA_API_KEY_ID && env.ALPACA_API_SECRET_KEY)),
      ]);
      return json({
        ok: true,
        version: APP_VERSION,
        varVersion: env.APP_VERSION || null,
        versionVarInSync: !env.APP_VERSION || env.APP_VERSION === APP_VERSION,
        configured: !!env.FUSION_API_KEY,
        protected: !!env.APP_TOKEN,   // Eigenschaft der INSTALLATION
        authenticated: true,          // v3.32.7: Aussage ueber DIESE Anfrage — bis hierher kommt nur, wer autorisiert ist
        stocksConfigured: tiingoStocksMode(env)==='primary' ? !!env.TIINGO_API_TOKEN : !!env.TWELVE_API_KEY,
        stocksProvider: tiingoStocksMode(env)==='primary' ? 'Tiingo IEX' : 'Twelve Data',
        tiingoStocksMode: tiingoStocksMode(env),
        alpacaConfigured: !!(env.ALPACA_API_KEY_ID && env.ALPACA_API_SECRET_KEY),
        crowdConfigured: !!env.SERPAPI_KEY,
        tiingoConfigured: !!env.TIINGO_API_TOKEN,
        /* v3.32.0 · Audit §10 D: gemessene Bandbreite je Datenpfad. Der Client
           liest daraus `bandwidth.usedGb` / `bandwidth.capGb`; fehlt die
           Messung, meldet `measured:false` und die Anzeige schreibt „nicht
           gemessen" statt einer beruhigenden Null. */
        bandwidth: tiingoBandwidthView(),
        bandwidthLimitHitTs: tiingoBwLimitHit || null,
        kv: !!env.SNAP,
        d1: !!env.DB,
        cacheAgeMs: memo.ts ? Date.now() - memo.ts : null,
        components: COMPONENTS,
        status: {
          crypto: cryptoHealth,
          stocks: stocksHealth,
          alpaca: alpacaHealth,
        },
        quota: { twelveData: quotaView() },
      }, 200, { 'cache-control': 'no-store' });
    }

    if (url.pathname.startsWith('/api/')) {
      if (!authed(request, url, env)) return json({ error: 'Nicht autorisiert.', hint: authHint(request, url, env) }, 401);
      // Der Fusion-Key wird nur für die Krypto-Routen gebraucht. Der Aktienradar
      // soll auch dann laufen, wenn nur TWELVE_API_KEY gesetzt ist.
      const needsFusion = url.pathname === '/api/scan' || url.pathname.startsWith('/api/pair/');
      if (needsFusion && !env.FUSION_API_KEY) {
        setApiState('crypto', 'nokey', 'FUSION_API_KEY fehlt');
        return json({ error: 'FUSION_API_KEY fehlt (Secret in Cloudflare setzen).', state: 'nokey' }, 500);
      }
    }



    if (url.pathname === '/api/tiingo/validate') {
      try { return json(await tiingoValidation(env,url.searchParams.get('symbols')),200,{ 'cache-control':'no-store' }); }
      catch(e){ return json({configured:!!env.TIINGO_API_TOKEN,state:'error',error:String(e.message||e),version:APP_VERSION},502,{ 'cache-control':'no-store' }); }
    }

    if (url.pathname === '/api/tiingo/status') {
      const wantDeep=url.searchParams.get('stockDeep');
      if(wantDeep!=null) await persistStockDeepLimit(env,wantDeep);
      const deepLimit=await readStockDeepLimit(env);
      await loadTiingoQuotaOnce(env);
      if(!env.TIINGO_API_TOKEN) return json({configured:false,authenticated:false,state:'nokey',version:APP_VERSION,quota:tiingoQuotaView(),stockDeep:deepLimit,stockDeepRange:{min:STOCK_DEEP_MIN,max:STOCK_DEEP_MAX}},200,{ 'cache-control':'no-store' });
      try { const d=await tiingoFetch(env,'/api/test/'); return json({configured:true,authenticated:true,state:'ok',message:d?.message||'Tiingo authentication successful',boatsEntitlement:'not-tested',version:APP_VERSION,quota:tiingoQuotaView(),stockDeep:deepLimit,stockDeepRange:{min:STOCK_DEEP_MIN,max:STOCK_DEEP_MAX}},200,{ 'cache-control':'no-store' }); }
      catch(e){ return json({configured:true,authenticated:false,state:'error',error:String(e.message||e),version:APP_VERSION,quota:tiingoQuotaView(),stockDeep:deepLimit,stockDeepRange:{min:STOCK_DEEP_MIN,max:STOCK_DEEP_MAX}},502,{ 'cache-control':'no-store' }); }
    }
    if (url.pathname === '/api/tiingo/boats') {
      try { return json(await tiingoBoatsSnapshot(env,url.searchParams.get('symbols')),200,{ 'cache-control':'no-store' }); }
      catch(e) { return json({configured:!!env.TIINGO_API_TOKEN,state:'error',error:e.message||String(e),rows:[],source:'Tiingo BOATS',version:APP_VERSION},502,{ 'cache-control':'no-store' }); }
    }

    if (url.pathname === '/api/learning') {
      try {
        const stocks=(url.searchParams.get('stocks')||'').split(',').map(x=>x.trim().toUpperCase()).filter(Boolean);
        const coins=(url.searchParams.get('coins')||'').split(',').map(x=>x.trim().toUpperCase()).filter(Boolean);
        return json(await learningPayload(env,stocks,coins),200,{ 'cache-control':'no-store' });
      } catch(e) { return json({configured:!!env.DB,state:'error',error:e.message||String(e),version:APP_VERSION},502,{ 'cache-control':'no-store' }); }
    }

    // Modul 0: Attribution & Overfitting-Guard. Reine Auswertung, veraendert keinen Score.
    if (url.pathname === '/api/attribution') {
      try { return json(await claudeAttribution(env),200,{ 'cache-control':'no-store' }); }
      catch(e) { return json({configured:!!env.DB,state:'error',error:e.message||String(e),version:APP_VERSION},502,{ 'cache-control':'no-store' }); }
    }

    // Paket A: Setup stummschalten / reaktivieren. Unterdrueckt nur die BUY-Freigabe,
    // veraendert keinen Score. Auswertung laeuft im Hintergrund weiter.
    if (url.pathname === '/api/attribution/mute') {
      try {
        const setup=url.searchParams.get('setup'); const reason=url.searchParams.get('reason')||'manuell';
        const action=url.searchParams.get('action')||'mute';
        const res = action==='unmute' ? await unmuteSetup(env,setup) : await muteSetup(env,setup,reason);
        return json({...res,version:APP_VERSION},res.ok?200:400,{ 'cache-control':'no-store' });
      } catch(e) { return json({ok:false,error:e.message||String(e),version:APP_VERSION},502,{ 'cache-control':'no-store' }); }
    }

    // Modul 1: Aladdin-Style Market Intelligence. Marktmeinung ueber vorhandenem
    // Aktien-Cache; veraendert keinen Claude-/FusionPulse-Score.
    if (url.pathname === '/api/aladdin') {
      try {
        const src=(stockMemo.rows&&stockMemo.rows.length)?stockMemo.rows:(await readLatestPersistedStockScan(env))?.rows||[];
        return json(aladdinIntelligence(src),200,{ 'cache-control':'no-store' });
      } catch(e) { return json({state:'error',error:e.message||String(e),version:APP_VERSION},502,{ 'cache-control':'no-store' }); }
    }

    if (url.pathname === '/api/experimental') {
      try { return json(await experimentalPulse(url.searchParams.get('force') === '1'), 200, { 'cache-control':'no-store' }); }
      catch (e) { return json({state:'error',error:e.message||String(e),version:APP_VERSION},502,{ 'cache-control':'no-store' }); }
    }

    if (url.pathname === '/api/journal') {
      try {
        if (!env?.DB) return json({configured:true,state:'nodb',rows:[],summary:null,
          note:'Ohne D1 laesst sich nichts aufzeichnen.'},200,{ 'cache-control':'no-store' });
        if (request.method === 'POST') return json(await journalWrite(env, await request.json()),200,{ 'cache-control':'no-store' });
        return json(await journalList(env),200,{ 'cache-control':'no-store' });
      } catch(e){ return json({configured:true,state:'error',error:String(e.message||e),version:APP_VERSION},502,{ 'cache-control':'no-store' }); }
    }

    if (url.pathname === '/api/ride') {
      try { return json(await rideNow(env,{asset:url.searchParams.get('asset'),netEur:url.searchParams.get('netEur')}),200,{ 'cache-control':'no-store' }); }
      catch(e){ return json({configured:true,state:'error',error:String(e.message||e),version:APP_VERSION},502,{ 'cache-control':'no-store' }); }
    }

    // v3.29.0 · Vorabend-Liste. Laeuft gegen TAGESBALKEN und ist damit die
    // einzige Schicht, die sich rueckwirkend pruefen laesst. 0 % Gewicht.
    if (url.pathname === '/api/evening') {
      try { return json(await eveningList(env,{
        netEur: url.searchParams.get('netEur'),
        favorites: url.searchParams.get('favorites'),
        force: url.searchParams.get('force'),
      }),200,{ 'cache-control':'no-store' }); }
      catch(e){ return json({configured:!!env.TIINGO_API_TOKEN,state:'error',rows:[],wide:[],study:null,error:String(e.message||e),version:APP_VERSION},502,{ 'cache-control':'no-store' }); }
    }

    if (url.pathname === '/api/scoreaudit') {
      try { return json(await scoreAudit(env,{netEur:url.searchParams.get('netEur')}),200,{ 'cache-control':'no-store' }); }
      catch(e){ return json({configured:true,state:'error',error:String(e.message||e),version:APP_VERSION},502,{ 'cache-control':'no-store' }); }
    }

    if (url.pathname === '/api/toppicks') {
      try {
        return json(await topPicks(env, {
          asset: url.searchParams.get('asset'),
          netEur: url.searchParams.get('netEur'),
          stopPct: url.searchParams.get('stopPct'),
          spreadPct: url.searchParams.get('spreadPct'),
          feePct: url.searchParams.get('feePct'),
        }), 200, { 'cache-control':'no-store' });
      } catch(e){ return json({configured:true,state:'error',error:String(e.message||e),version:APP_VERSION},502,{ 'cache-control':'no-store' }); }
    }

    if (url.pathname === '/api/patterns') {
      try { return json(await patternLab(env),200,{ 'cache-control':'no-store' }); }
      catch(e){ return json({configured:true,state:'error',error:String(e.message||e),version:APP_VERSION},502,{ 'cache-control':'no-store' }); }
    }

    if (url.pathname === '/api/earnings') {
      if(request.method==='POST'){
        try{ const body=await request.json(); const rows=await writeManualEarnings(env, body?.rows);
          return json({state:'ok',rows,version:APP_VERSION},200,{ 'cache-control':'no-store' }); }
        catch(e){ return json({state:'error',error:String(e.message||e),version:APP_VERSION},500,{ 'cache-control':'no-store' }); }
      }
      const d=await earningsCalendar(env, url.searchParams.get('force')==='1');
      return json(d,200,{ 'cache-control':'no-store' });
    }

    if (url.pathname === '/api/sentiment') {
      const d=await cryptoSentiment(env, url.searchParams.get('force')==='1');
      return json(d, d.state==='error'?502:200, { 'cache-control':'no-store' });
    }

    if (url.pathname === '/api/crowd') {
      try { const d=await crowdPulse(env,url.searchParams.get('symbols'),url.searchParams.get('force') === '1'); const fresh=(d.rows||[]).filter(x=>x&&x.cached===false&&Number.isFinite(Number(x.score)));
             if(env.DB&&fresh.length) ctx.waitUntil(d1StoreCrowd(env,fresh).catch(()=>{})); return json(d,200,{ 'cache-control':'no-store' }); }
      catch (e) { return json({state:'error',configured:!!env.SERPAPI_KEY,error:e.message||String(e),rows:[],version:APP_VERSION},502,{ 'cache-control':'no-store' }); }
    }

    if (url.pathname === '/api/opening') {
      try { return json(await openingMomentum(env, url.searchParams.get('force') === '1', (url.searchParams.get('favorites')||'').split(',').filter(Boolean)), 200, { 'cache-control':'no-store' }); }
      catch (e) { const state=classifyError(e); setApiState('alpaca',state,e?.message); return json({configured:!!(env.ALPACA_API_KEY_ID&&env.ALPACA_API_SECRET_KEY),state,error:e.message||String(e),rows:openingMemo.data?.rows||[],feed:alpacaFeedLabel(env),phaseLabel:usMarketPhase().label,phaseHelp:usMarketPhase().help,version:APP_VERSION},state==='ratelimit'?429:502,{ 'cache-control':'no-store' }); }
    }

    if (url.pathname === '/api/stock-chart') {
      try { return json(await tiingoStockChart(env,url.searchParams.get('symbol'),url.searchParams.get('range')||'120'),200,{ 'cache-control':'public, max-age=60' }); }
      catch(e){ return json({state:'error',error:String(e.message||e),rows:[],version:APP_VERSION},502,{ 'cache-control':'no-store' }); }
    }

    if (url.pathname === '/api/stock-suggest') {
      try { return json(await tiingoStockSuggest(env,url.searchParams.get('q')),200,{ 'cache-control':'no-store' }); }
      catch(e){ return json({configured:!!env.TIINGO_API_TOKEN,state:'error',rows:[],error:String(e.message||e),version:APP_VERSION},502,{ 'cache-control':'no-store' }); }
    }

    if (url.pathname === '/api/stocks') {
      try {
        const comp = parseComponents(url.searchParams.get('comp'));
        const minCrv = Math.max(1, +url.searchParams.get('minCrv') || 3);
        const lookup = url.searchParams.get('lookup');
        if (lookup) {
          if(tiingoStocksMode(env)==='primary') return json(await tiingoStockLookup(env,lookup,comp,minCrv,url.searchParams.get('force')==='1'),200,{ 'cache-control':'no-store' });
          const qv=quotaView();
          if(Number.isFinite(qv.creditsLeft) && qv.creditsLeft<=2) return json({state:'ratelimit',error:'Twelve-Data-Reserve geschützt: Suche kurz warten.',quota:qv,version:APP_VERSION},429,{ 'cache-control':'no-store' });
          return json(await stockLookup(env, lookup, comp, minCrv), 200, { 'cache-control':'no-store' });
        }
        const favorites=(url.searchParams.get('favorites')||'').split(',').filter(Boolean);
        return json(tiingoStocksMode(env)==='primary' ? await tiingoStockSnapshot(env,url.searchParams.get('force')==='1',comp,minCrv,favorites,'client') : await stockSnapshot(env,url.searchParams.get('force')==='1',comp,minCrv,favorites),200,{ 'cache-control':'no-store' });
      } catch (e) {
        const state = classifyError(e);
        setApiState('stocks', state, e?.message);
        return json({
          error: e.message || String(e), state, configured: tiingoStocksMode(env)==='primary' ? !!env.TIINGO_API_TOKEN : !!env.TWELVE_API_KEY,
          rows: stockMemo.rows, cached: true, universe: STOCK_UNIVERSE.length,
          quota: quotaView(), version: APP_VERSION,
        }, state === 'ratelimit' || state === 'daylimit' ? 429 : 502, { 'cache-control':'no-store' });
      }
    }

    if (url.pathname === '/api/scan') {
      try {
        const opts = {
          deep: +url.searchParams.get('deep') || CFG.DEEP_MAX,
          watch: (url.searchParams.get('watch') || '').split(',').filter(Boolean),
          mode: ['composite','elliott','momentum','trend','micro'].includes(url.searchParams.get('mode')) ? url.searchParams.get('mode') : 'composite',
          comp: parseComponents(url.searchParams.get('comp')),
          minCrv: Math.max(1, +url.searchParams.get('minCrv') || 2),
        };
        const force = url.searchParams.get('force') === '1';
        const snap=await getSnapshot(env, opts, force);
        if(snap?.rows?.length) ctx.waitUntil(persistApiState(env,'crypto','ok',`${snap.rows.length} Rows · PWA bestätigt`).catch(()=>{}));
        return json(snap, 200, { 'cache-control':'no-store' });
      } catch (e) {
        const state = classifyError(e);
        return json({ error: e.message || String(e), state, version: APP_VERSION },
                    state === 'ratelimit' || state === 'daylimit' ? 429 : 502, { 'cache-control':'no-store' });
      }
    }

    // Einzelpaar auf Anfrage — frisch, 2 Subrequests, für den Detail-Dialog
    if (url.pathname.startsWith('/api/pair/')) {
      const pair = decodeURIComponent(url.pathname.slice('/api/pair/'.length)).toUpperCase();
      if (!/^[A-Z0-9]{2,12}-EUR$/.test(pair)) return json({ error: 'Ungültiges Paar.' }, 400);
      try {
        const c = makeClient(env.FUSION_API_KEY);
        const [c5, bk] = await Promise.all([
          c.get(`candles/${pair}`, { interval: '5m', limit: CFG.CANDLE_LIMIT }).then(toCandles),
          c.get(`orderbook/${pair}`, { depth: CFG.BOOK_DEPTH }).then(bookMetrics).catch(() => null),
        ]);
        // BTC-Referenz aus dem letzten Scan wiederverwenden -> kein Extra-Subrequest
        const row = analyse({
          pair, c5, btc5: pair === 'BTC-EUR' ? null : btcRef,
          book: bk, fee: memo.data?.fee ?? CFG.DEFAULT_FEE,
          mode: ['composite','elliott','momentum','trend','micro'].includes(url.searchParams.get('mode')) ? url.searchParams.get('mode') : (memo.data?.mode || 'composite'),
          comp: parseComponents(url.searchParams.get('comp')), minCrv: Math.max(1, +url.searchParams.get('minCrv') || 2),
        });
        return row ? json({ ts: Date.now(), row }) : json({ error: 'Zu wenig Daten.' }, 404);
      } catch (e) {
        return json({ error: e.message || String(e) }, 502);
      }
    }

    return env.ASSETS.fetch(request);
  },

  // v3.0: Cron sammelt unabhängig von einer geöffneten PWA Markt- und Learning-Daten.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(serverLearningCycle(env,event.scheduledTime).catch((e) => {
      cronLog('scheduler','error',e?.message,{scheduledTime:event.scheduledTime});
      return persistApiState(env,'scheduler','error',e?.message,Number(event.scheduledTime)||Date.now());
    }));
  },
};
