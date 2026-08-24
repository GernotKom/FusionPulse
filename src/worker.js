import { APP_VERSION } from './version.js';

/* ============================================================================
   FusionPulse v3.0.8 — Cloudflare Worker
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
const r1 = (x) => Math.round(x * 10) / 10;
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
function makeClient(key) {
  let used = 0;
  return {
    get used() { return used; },
    async get(path, params = {}) {
      used++;
      const u = new URL(`${API}/${path}`);
      for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
      const res = await fetch(u, { headers: { 'x-api-key': key, accept: 'application/json' } });
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
    : 5.5;
  const bookScore = clamp(5 + imbalance * 4.5);

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
  const executability = clamp(execParts.reduce((a,x)=>a+x[1]*x[2],0) / execWeight);

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
  const tradable = viable && netCRV >= minCrv && (spread == null || spread <= 0.0025)
                   && (!bookKnown || liquidity >= 6) && exhaustion < 7;
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

  // Sparkline: letzte 48 Closes normalisiert 0..100
  const sp = cl.slice(-48);
  const spLo = minOf(sp), spHi = maxOf(sp);
  const spark = sp.map((c) => Math.round(spHi > spLo ? ((c - spLo) / (spHi - spLo)) * 100 : 50));

  return {
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
  if (!force && inflight && inflightSig === sig) return { ...(await inflight), cached: true };
  if (inflight) { try { await inflight; } catch { /* alte Anfrage egal */ }
    if (!force && inflight && inflightSig === sig) return { ...(await inflight), cached: true };
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
  ['Rohstoffe','AEM','Agnico Eagle Mines Limited'], ['Rohstoffe','AG','First Majestic Silver Corp.']
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
function noteQuota(res, creditsSpent) {
  const day = utcDayKey();
  if (tdQuota.dayKey !== day) { tdQuota.dayKey = day; tdQuota.dayCredits = 0; }
  tdQuota.dayCredits += creditsSpent;

  const used = res?.headers?.get?.('api-credits-used');
  const left = res?.headers?.get?.('api-credits-left');
  if (used != null && left != null && used !== '' && left !== '') {
    const u = Number(used), l = Number(left);
    if (Number.isFinite(u) && Number.isFinite(l)) {
      tdQuota.creditsUsed = u; tdQuota.creditsLeft = l;
      tdQuota.minuteLimit = u + l;
      tdQuota.lastHeaderTs = Date.now();
      // Abgeleitet, nicht erfunden: 8 Credits/Minute ist der Basic-/Trial-Tarif,
      // dessen Tageskontingent laut Anbieter 800 Credits beträgt.
      if (tdQuota.minuteLimit === 8) { tdQuota.dayLimit = 800; tdQuota.dayLimitDerived = true; }
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
function usMarketPhase(date = new Date(), feed = null) {
  const p=nyParts(date), weekend=['Sat','Sun'].includes(p.weekday), mins=Number(p.hour)*60+Number(p.minute);
  const iex = feed === 'iex';
  let key='closed', label='US-Markt geschlossen', help='Aktienwerte dienen nur der Vorbereitung; keine Live-BUY-Freigabe.';
  if(!weekend){
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
  const vwap = vv > 0 ? pv / vv : last.c;

  const ret5 = (last.c / prev.c - 1) * 100;
  const ret15 = (last.c / bars.at(-4).c - 1) * 100;
  const ret60 = (last.c / bars.at(-13).c - 1) * 100;
  const vbaseArr = vs.slice(-21, -1).filter((v) => v > 0);
  const vbase = vbaseArr.length >= 8 ? mean(vbaseArr) : null;
  const relVol = vbase > 0 ? last.v / vbase : null; // null = Volumenbasis nicht belastbar
  const relVolScore = relVol ?? 1; // intern neutral, extern bleibt unbekannt = null

  // Gewichteter Mittelwert über AKTIVE Komponenten — abgeschaltet ≠ negativ.
  const trendScore = 5 + (last.c > ema21 ? 1.9 : -1.9) + (ema9 > ema21 ? 1.5 : -1.1);
  const momoScore = 5 + Math.max(-3.5, Math.min(3.5, ret15 * 2.2)) + Math.max(-1.5, Math.min(1.5, ret60 * 0.7));
  const volScore = 5 + Math.max(-2.0, Math.min(3.5, (relVolScore - 1) * 3.0));
  const vwapScore = last.c >= vwap ? 7.6 : 3.4;
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
  const grossCRV = (tp2 - entry) / risk;
  const costPct = 0.18;                                   // Broker + Spread, konservativ
  const netCRV = +Math.max(0, grossCRV - (costPct / 100 * entry / risk)).toFixed(1);

  const eurPerUsd = usdPerEur ? 1 / usdPerEur : null;      // usdPerEur = EUR/USD-Kurs
  const e = (x) => (eurPerUsd ? x * eurPerUsd : null);

  const score = +q.toFixed(1);
  const executability = +clamp(4 + relVolScore * 1.2 + Math.min(2, Math.abs(ret15))).toFixed(1);
  const light = score >= 8 && netCRV >= minCrv ? 'green' : score >= 6.5 ? 'yellow' : 'red';
  const verdict = light === 'green' ? 'Kauf-Setup' : light === 'yellow' ? 'Beobachten' : 'Kein Trade';
  const setup = ema9 > ema21 && ret15 > 0 ? 'Trend / Momentum'
    : last.c > ema21 ? 'Pullback über EMA21'
    : last.c >= vwap ? 'Über VWAP, aber ohne Trend' : 'Unter EMA21 – Schwäche';
  const trend = ema9 > ema21 ? 'aufwärts' : ema9 < ema21 ? 'abwärts' : 'seitwärts';

  return {
    symbol, sector, name: src?.meta?.name || STOCK_NAMES[symbol] || symbol,
    exchange: src?.meta?.exchange || 'US', currency: src?.meta?.currency || 'USD',
    score, executability, light, verdict, setup, trend,
    priceUsd: last.c, priceEur: e(last.c),
    entryUsd: entry, entryEur: e(entry),
    stopUsd: stop, stopEur: e(stop),
    tp1Usd: tp1, tp1Eur: e(tp1),
    tp2Usd: tp2, tp2Eur: e(tp2), tp2Pct: +tp2Pct.toFixed(2),
    swingTargetUsd: swingTarget, swingTargetEur: e(swingTarget), structurePct: +structurePct.toFixed(2),
    zoneLowUsd: entry - 0.25 * atr, zoneHighUsd: entry + 0.25 * atr,
    zoneLowEur: e(entry - 0.25 * atr), zoneHighEur: e(entry + 0.25 * atr),
    netCRV, atrPct: +((atr / last.c) * 100).toFixed(2),
    ret5: +ret5.toFixed(2), ret15: +ret15.toFixed(2), ret60: +ret60.toFixed(2),
    relVol: relVol == null ? null : +relVol.toFixed(2), vwapUsd: vwap, aboveVwap: last.c >= vwap,
    liquidityVacuum: +liquidityVacuum.toFixed(0),
    updated: last.dt, feed: 'Twelve Data US', tradegate: false, marketPhase: usMarketPhase().key,
    fxUsdPerEur: usdPerEur || null, fxKnown: !!usdPerEur,
    components: [...on],
  };
}

async function twelveJSON(path, params, key, creditsSpent = 1) {
  const u = new URL('https://api.twelvedata.com/' + path);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
  u.searchParams.set('apikey', key);
  const r = await fetch(u);
  noteQuota(r, creditsSpent);
  const j = await r.json();
  if (!r.ok || j?.status === 'error') {
    const err = new Error(j?.message || `Twelve Data ${r.status}`);
    err.code = j?.code || r.status;
    throw err;
  }
  return j;
}

async function getFx(key) {
  if (fxMemo.usdPerEur && Date.now() - fxMemo.ts < 30 * 60_000) return fxMemo.usdPerEur;
  try {
    const j = await twelveJSON('price', { symbol: 'EUR/USD' }, key, 1);
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
    const j = await twelveJSON('symbol_search', { symbol: q, outputsize: '12', show_plan: 'true' }, env.TWELVE_API_KEY, 1);
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
  const fx = await getFx(env.TWELVE_API_KEY);
  let j;
  let extendedHours = true;
  try {
    j = await twelveJSON('time_series', { symbol: info.symbol, interval: '5min', outputsize: '40', prepost: 'true', format: 'JSON' }, env.TWELVE_API_KEY, 1);
  } catch (e) {
    // Twelve Data stellt aktuelle Extended-Hours je nach Tarif bereit. Ein
    // Treffer darf deshalb nicht komplett scheitern, nur weil prepost=true im
    // vorhandenen Plan nicht freigeschaltet ist.
    const m = String(e?.message || e || '');
    if (!/pre.?post|extended|plan|subscription|access|permission/i.test(m)) throw e;
    extendedHours = false;
    j = await twelveJSON('time_series', { symbol: info.symbol, interval: '5min', outputsize: '40', format: 'JSON' }, env.TWELVE_API_KEY, 1);
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

async function stockSnapshot(env, force = false, comp, minCrv = 3) {
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
  const cycle = minuteSlot % 4;
  const sig = [...(comp instanceof Set ? comp : new Set(ALL_ON))].sort().join('.') + '|' + minCrv;
  if (!force && stockMemo.rows.length && stockMemo.cycle === cycle && stockMemo.sig === sig && Date.now() - stockMemo.ts < 55_000) {
    return { configured: true, state: 'ok', cached: true,
             rows: stockMemo.rows, ts: stockMemo.ts, cycle, universe: STOCK_UNIVERSE.length,
             scanned: stockMemo.rows.length, quota: quotaView(), version: APP_VERSION,
             market: usMarketPhase(new Date(), null), note: 'US-Marktdaten; EUR ist eine gekennzeichnete Umrechnung, kein Tradegate-Kurs' };
  }

  const batch = STOCK_UNIVERSE.filter((_, i) => i % 4 === cycle);
  const syms = batch.map((x) => x[1]);
  const fx = await getFx(env.TWELVE_API_KEY);
  // v3.0.8 QUOTA-HOTFIX: Der automatische Teil-Batch verwendet bewusst keine
  // prepost-Abfrage. Auf Tarifen ohne Extended Hours kostete v3.0.7 zuerst 7
  // Credits fuer prepost=true und danach nochmals 7 Credits fuer den Fallback.
  // Premarket/Opening wird bereits separat und passend ueber Alpaca geliefert.
  // Einzel-Lookups duerfen weiterhin prepost testen (max. 1+1 Credit).
  const j = await twelveJSON('time_series', {
    symbol: syms.join(','), interval:'5min', outputsize:'40', format:'JSON'
  }, env.TWELVE_API_KEY, syms.length);

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
  const sectorMap = new Map();
  for (const r of rows) { const a=sectorMap.get(r.sector)||[]; a.push(r); sectorMap.set(r.sector,a); }
  for (const r of rows) {
    const peers=(sectorMap.get(r.sector)||[]).filter(x=>x.symbol!==r.symbol);
    const leader=peers.length?Math.max(...peers.map(x=>Number(x.ret15||0))):Number(r.ret15||0);
    r.sectorLeaderRet15=+leader.toFixed(2);
    r.sectorLag=+Math.max(-10,Math.min(10,leader-Number(r.ret15||0))).toFixed(2);
  }
  rows.sort((a, b) => b.score - a.score);
  stockMemo = { ts: Date.now(), rows, cycle, sig };
  setApiState('stocks', 'ok');

  return {
    configured: true, state: 'ok', cached: false, rows, ts: stockMemo.ts, cycle,
    universe: STOCK_UNIVERSE.length, scanned: rows.length, updatedThisCycle: fresh.length,
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
const OPENING_UNIVERSE = [
  'MRNA','IONQ','RGTI','PLTR','MSTR','NVDA','AMD','AVGO','SMCI','ARM','TSLA','META','AAPL','MSFT','AMZN','GOOGL','NFLX','COIN','HOOD','SOFI','CRWD','SNOW','UBER','RKLB','AEM','AG','LLY','BA','GE','CAT'
];
let openingMemo={ts:0,data:null};
function alpacaFeed(env){
  return String(env.ALPACA_FEED || 'iex').toLowerCase() === 'sip' ? 'sip' : 'iex';
}
function alpacaFeedLabel(env){ return alpacaFeed(env) === 'sip' ? 'SIP (All US Exchanges)' : 'IEX (Free)'; }
async function alpacaJSON(path, params, env){
  const u=new URL('https://data.alpaca.markets'+path); for(const [k,v] of Object.entries(params||{})) if(v!=null)u.searchParams.set(k,v);
  const r=await fetch(u,{headers:{'APCA-API-KEY-ID':env.ALPACA_API_KEY_ID,'APCA-API-SECRET-KEY':env.ALPACA_API_SECRET_KEY,accept:'application/json'}});
  if(r.status===429) throw new Error('Alpaca Rate-Limit (429)');
  if(!r.ok) throw new Error(`Alpaca ${r.status}: ${(await r.text()).slice(0,180)}`);
  return r.json();
}
function barTimeET(ts){
  const p=nyParts(new Date(ts)); return Number(p.hour)*60+Number(p.minute);
}
function momentumFromAlpaca(symbol, snap, bars=[]){
  if(!snap)return null;
  const prevClose=Number(snap.prevDailyBar?.c||0), latest=Number(snap.minuteBar?.c||snap.latestTrade?.p||snap.dailyBar?.c||0);
  if(!(latest>0&&prevClose>0))return null;
  const bs=(bars||[]).map(b=>({t:b.t,c:+b.c,h:+b.h,l:+b.l,v:+b.v||0})).filter(b=>b.c>0).sort((a,b)=>new Date(a.t)-new Date(b.t));
  const closeAgoBars=(n)=>bs.length>n?bs.at(-1-n).c:bs[0]?.c||latest;
  const ret5=(latest/closeAgoBars(1)-1)*100, ret15=(latest/closeAgoBars(3)-1)*100, ret60=(latest/closeAgoBars(Math.max(1,Math.min(12,bs.length-1)))-1)*100;
  const vols=bs.slice(-25).map(b=>b.v); const baseArr=vols.slice(0,-3).filter(v=>v>0); const base=baseArr.length>=8?mean(baseArr):null; const recent=mean(vols.slice(-3).filter(v=>v>0)); const relVol=base>0?recent/base:1; // unbekannt = keine Volumenbestaetigung
  const gapPct=(latest/prevClose-1)*100;
  const pre=bs.filter(b=>{const m=barTimeET(b.t);return m>=240&&m<570;});
  const preHigh=pre.length?maxOf(pre.map(b=>b.h)):null, preLow=pre.length?minOf(pre.map(b=>b.l)):null;
  const open=bs.filter(b=>{const m=barTimeET(b.t);return m>=570&&m<585;}); const openingHigh=open.length?maxOf(open.map(b=>b.h)):null;
  const priceScore=clamp(5+ret15*1.3+ret60*.35,0,10), volScore=clamp(4+(relVol-1)*2.3,0,10);
  const gapScore=clamp(5+Math.max(-3,Math.min(4,gapPct*.6)),0,10);
  const levelScore=preHigh?clamp(5+((latest/preHigh)-1)*250,0,10):5;
  const momentumScore=r1(weighted([[null,priceScore,.35],[null,volScore,.30],[null,gapScore,.20],[null,levelScore,.15]],ALL_ON));
  const phase=usMarketPhase();
  const impulsePct=Math.max(Math.abs(gapPct),Math.abs(ret60),bs.length?((maxOf(bs.slice(-60).map(b=>b.h))/minOf(bs.slice(-60).map(b=>b.l))-1)*100):0);
  const structurePct=r1(Math.min(20,Math.max(0,impulsePct*1.618)));
  const light=momentumScore>=8?'green':momentumScore>=6.5?'yellow':'red';
  const actionable=['opening','regular'].includes(phase.key)&&momentumScore>=8;
  const phaseAction=['premarket-early','premarket'].includes(phase.key)?(momentumScore>=7.5?'VORBEREITEN':'beobachten'):actionable?'Opening-Bestätigung prüfen':phase.key==='closed'?'Vorbereitung':'beobachten';
  return {symbol,priceUsd:latest,gapPct:r1(gapPct),ret5:r1(ret5),ret15:r1(ret15),ret60:r1(ret60),relVol:r1(relVol),momentumScore,preHigh,preLow,openingHigh,breakPremarketHigh:!!(preHigh&&latest>preHigh),structurePct,structureTargetUsd:r2(latest*(1+structurePct/100)),light,phaseAction,marketPhase:phase.key,updated:snap.minuteBar?.t||snap.latestTrade?.t||null};
}
async function openingMomentum(env, force=false){
  const phase=usMarketPhase();
  const feed=alpacaFeed(env), feedLabel=alpacaFeedLabel(env);
  const phaseLabel=feed==='sip' && phase.key==='premarket-early' ? 'Premarket 04:00–08:00 ET · SIP live' : phase.label;
  const phaseHelp=feed==='sip' && phase.key==='premarket-early' ? 'Alpaca SIP liefert den konsolidierten US-Gesamtmarkt auch im frühen Premarket.' : phase.help;
  if(!env.ALPACA_API_KEY_ID||!env.ALPACA_API_SECRET_KEY){setApiState('alpaca','nokey','Alpaca Secrets fehlen');return {configured:false,state:'nokey',rows:[],feed:feedLabel,phase:phase.key,phaseLabel,phaseHelp,version:APP_VERSION};}
  if(!force&&openingMemo.data&&Date.now()-openingMemo.ts<45_000)return {...openingMemo.data,cached:true};
  // 1 Snapshot-Request + 1 Multi-Symbol-Bars-Request. 5-Minuten-Bars reichen
  // für unser Momentum-Modell und decken mit 8h Historie den kompletten
  // 04:00-ET-Premarket ab, ohne unnötig große Multi-Symbol-Antworten.
  const symbols=OPENING_UNIVERSE.join(',');
  const [snaps,hist]=await Promise.all([
    alpacaJSON('/v2/stocks/snapshots',{symbols,feed},env),
    alpacaJSON('/v2/stocks/bars',{symbols,timeframe:'5Min',start:isoAgo(480),limit:'10000',feed,sort:'asc'},env),
  ]);
  const rows=OPENING_UNIVERSE.map(sym=>momentumFromAlpaca(sym,snaps?.[sym],hist?.bars?.[sym]||[])).filter(Boolean).sort((a,b)=>b.momentumScore-a.momentumScore);
  const limitations=feed==='sip'?'SIP: konsolidierter Echtzeit-Feed aller US-Börsen einschließlich Extended Hours.':'IEX Free: nur eine US-Börse; frühe Premarket-Daten sind unvollständig.';
  const data={configured:true,state:'ok',rows,scanned:rows.length,universe:OPENING_UNIVERSE.length,feed:feedLabel,phase:phase.key,phaseLabel,phaseHelp,limitations,ts:Date.now(),version:APP_VERSION};
  openingMemo={ts:Date.now(),data}; setApiState('alpaca','ok',`${rows.length} Momentum-Titel · ${phase.label}`); return data;
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
  const r=await fetch(url,{headers:{accept:'application/json','user-agent':`FusionPulse/${APP_VERSION}`}});
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
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
function trendScore(values){
  const a=(values||[]).map(Number).filter(Number.isFinite); if(a.length<3)return null;
  const recent=mean(a.slice(-3)); const base=mean(a.slice(0,Math.max(1,a.length-3)))||recent||1;
  const accel=(recent-base)/(Math.abs(base)+1)*100;
  const score=clamp(50+accel*2.2,0,100); const stars=star5(1+Math.abs(accel)/8);
  return {score:r1(score),stars,accel:r1(accel),recent:r1(recent)};
}
async function crowdPulse(env,symbols,force=false){
  const syms=[...new Set(String(symbols||'').split(',').map(x=>x.trim().toUpperCase()).filter(x=>/^[A-Z0-9.\-]{1,8}$/.test(x)))].slice(0,15);
  const key=syms.join(',');
  if(!env.SERPAPI_KEY)return {configured:false,state:'nokey',rows:syms.map(symbol=>({symbol,score:null,stars:null,source:'Google Trends'})),note:'SERPAPI_KEY fehlt; keine Suchwerte werden erfunden.',version:APP_VERSION};
  if(!force&&crowdMemo.data&&crowdMemo.key===key&&Date.now()-crowdMemo.ts<55*60_000)return {...crowdMemo.data,cached:true};
  const rows=[];
  // Bis zu fünf Begriffe pro Google-Trends-Aufruf. 55-Min-Cache: Crowd ist bewusst ein vorgelagerter Aufmerksamkeitsindikator; Marktvolumen ist keine Voraussetzung.
  for(let i=0;i<syms.length;i+=5){
    const group=syms.slice(i,i+5),queries=group.map(crowdQueryName);
    const u=new URL('https://serpapi.com/search.json');u.searchParams.set('engine','google_trends');u.searchParams.set('q',queries.join(','));u.searchParams.set('date','now 4-H');u.searchParams.set('geo','US');u.searchParams.set('data_type','TIMESERIES');u.searchParams.set('api_key',env.SERPAPI_KEY);
    try{
      const j=await fetchJSONPublic(u.toString()); const tl=j?.interest_over_time?.timeline_data||[];
      for(let gi=0;gi<group.length;gi++){
        const vals=tl.map(t=>Number(t?.values?.[gi]?.extracted_value??t?.values?.[gi]?.value)).filter(Number.isFinite);
        const m=trendScore(vals);rows.push({symbol:group[gi],score:m?.score??null,stars:m?.stars??null,accel:m?.accel??null,interest:m?.recent??null,source:'Google Trends via SerpApi'});
      }
    }catch(e){for(const symbol of group)rows.push({symbol,score:null,stars:null,source:'Google Trends via SerpApi',error:String(e.message||e)});}
  }
  const data={configured:true,state:'ok',rows,cacheMinutes:55,note:'Crowd/Search ist ein vorgelagerter Aufmerksamkeitsindikator. Marktvolumen ist keine Voraussetzung; 0 % BUY-Gewicht.',ts:Date.now(),version:APP_VERSION};
  crowdMemo={ts:Date.now(),key,data};return data;
}



/* ========================================================================
   FusionPulse 3.0 — serverseitiges D1-Learning
   DB-Binding: env.DB (Cloudflare D1). Die PWA bleibt funktionsfähig, wenn D1
   noch nicht verbunden ist; dann zeigt /api/learning state="nodb".
   Gespeichert werden echte Markt-Snapshots und nachfolgend beobachtete
   Outcomes. Browser-/PWA-Speicher ist damit nicht mehr die einzige Quelle.
   ======================================================================== */
const LEARN_HORIZON_MS = 180 * 60_000;
const LEARN_HISTORY_MS = 120 * 60_000;
const LEARN_SIGNAL_LABELS = ['attention','crowd','sector','rvol','vacuum','elliott','momentum','technical'];

let d1SchemaReady=false;
let learnMemo={ts:0,key:'',data:null};
async function ensureD1Schema(env){
  if(!env.DB||d1SchemaReady)return !!env.DB;
  const ddl=[
    `CREATE TABLE IF NOT EXISTS market_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT,ts INTEGER NOT NULL,bucket5 INTEGER NOT NULL,source TEXT NOT NULL,asset_type TEXT NOT NULL,symbol TEXT NOT NULL,sector TEXT,phase TEXT,price REAL NOT NULL,score REAL,crv REAL,rvol REAL,ret15 REAL,ret60 REAL,atr_pct REAL,liquidity_vacuum REAL,sector_lag REAL,crowd_score REAL,structure_pct REAL,executability REAL,light TEXT,max_pct REAL NOT NULL DEFAULT 0,min_pct REAL NOT NULL DEFAULT 0,success_ts INTEGER,resolved_ts INTEGER,payload TEXT,UNIQUE(source,asset_type,symbol,bucket5))`,
    `CREATE INDEX IF NOT EXISTS idx_snap_symbol_ts ON market_snapshots(symbol, ts DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_snap_unresolved ON market_snapshots(resolved_ts, ts)`,
    `CREATE INDEX IF NOT EXISTS idx_snap_sector_resolved ON market_snapshots(sector, resolved_ts, ts DESC)`,
    `CREATE TABLE IF NOT EXISTS signal_events (id INTEGER PRIMARY KEY AUTOINCREMENT,symbol TEXT NOT NULL,ts INTEGER NOT NULL,bucket5 INTEGER NOT NULL,signal TEXT NOT NULL,price REAL NOT NULL,strength REAL,source TEXT,UNIQUE(symbol,bucket5,signal))`,
    `CREATE INDEX IF NOT EXISTS idx_event_symbol_ts ON signal_events(symbol, ts DESC)`,
    `CREATE TABLE IF NOT EXISTS crowd_cache (symbol TEXT PRIMARY KEY,ts INTEGER NOT NULL,score REAL,stars INTEGER,accel REAL,interest REAL,source TEXT)`,
    `CREATE TABLE IF NOT EXISTS fp_meta (key TEXT PRIMARY KEY,value TEXT,updated_ts INTEGER NOT NULL)`
  ];
  for(const q of ddl)await env.DB.prepare(q).run();
  try { await env.DB.prepare('ALTER TABLE market_snapshots ADD COLUMN executability REAL').run(); }
  catch { /* column already exists */ }
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
    `SELECT id,ts,price,max_pct,min_pct,success_ts FROM market_snapshots
     WHERE symbol=? AND asset_type=? AND source=? AND resolved_ts IS NULL AND ts>=? ORDER BY ts ASC LIMIT 500`
  ).bind(symbol, assetType, source, now-LEARN_HORIZON_MS-15*60_000).all()).results||[];
  if(!rows.length) return;
  const stmts=[];
  for(const x of rows){
    const pct=(price/Number(x.price)-1)*100;
    const mx=Math.max(Number(x.max_pct)||0,pct), mn=Math.min(Number(x.min_pct)||0,pct);
    const successTs=x.success_ts || (mx>=5 ? now : null);
    const resolved=(now-Number(x.ts)>=LEARN_HORIZON_MS) ? now : null;
    stmts.push(env.DB.prepare('UPDATE market_snapshots SET max_pct=?,min_pct=?,success_ts=COALESCE(success_ts,?),resolved_ts=COALESCE(resolved_ts,?) WHERE id=?')
      .bind(mx,mn,successTs,resolved,x.id));
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
    f.score,f.crv,f.rv,f.r15,f.r60,f.atr,f.vac,f.lag,crowdScore,f.structure,dbNum(row.executability),row.light||null,safeJson({setup:row.setup||null,phaseAction:row.phaseAction||null,verdict:row.verdict||null})).run();
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
async function d1StoreRows(env, rows, opts){
  if(!env.DB || !rows?.length) return;
  for(const row of rows.slice(0,60)) await d1StoreSnapshotRow(env,row,opts);
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
async function d1TwinFor(env, symbol){
  if(!env.DB) return {n:0};
  const cur=await env.DB.prepare(`SELECT sector,score,crv,rvol rv,ret15 r15,ret60 r60,atr_pct atr,liquidity_vacuum vac,sector_lag lag,crowd_score crowd,structure_pct structure
    FROM market_snapshots WHERE symbol=? AND asset_type='stock' AND source='Twelve Data' ORDER BY ts DESC LIMIT 1`).bind(symbol).first();
  if(!cur) return {n:0};
  const q=cur.sector
    ? env.DB.prepare(`SELECT symbol,score,crv,rvol rv,ret15 r15,ret60 r60,atr_pct atr,liquidity_vacuum vac,sector_lag lag,crowd_score crowd,structure_pct structure,max_pct,min_pct
       FROM market_snapshots WHERE resolved_ts IS NOT NULL AND asset_type='stock' AND source='Twelve Data' AND sector=? ORDER BY ts DESC LIMIT 200`).bind(cur.sector)
    : env.DB.prepare(`SELECT symbol,score,crv,rvol rv,ret15 r15,ret60 r60,atr_pct atr,liquidity_vacuum vac,sector_lag lag,crowd_score crowd,structure_pct structure,max_pct,min_pct
       FROM market_snapshots WHERE resolved_ts IS NOT NULL AND asset_type='stock' AND source='Twelve Data' ORDER BY ts DESC LIMIT 200`);
  const rows=(await q.all()).results||[];
  const nearest=rows.map(x=>({...x,d:twinDistance(cur,x)})).filter(x=>x.d<9999).sort((a,b)=>a.d-b.d).slice(0,12);
  if(nearest.length<5)return {n:nearest.length};
  const vals=nearest.map(x=>Number(x.max_pct)||0).sort((a,b)=>a-b);
  return {n:nearest.length,edge:Math.round(nearest.filter(x=>Number(x.max_pct)>=5).length/nearest.length*100),stops:nearest.filter(x=>Number(x.min_pct)<=-1.5).length,median:r1(vals[Math.floor(vals.length/2)]||0)};
}
async function d1LeadModel(env, symbol){
  if(!env.DB)return {n:0};
  const successes=(await env.DB.prepare(`SELECT ts,success_ts FROM market_snapshots WHERE symbol=? AND asset_type='stock' AND source='Twelve Data' AND success_ts IS NOT NULL ORDER BY success_ts DESC LIMIT 40`).bind(symbol).all()).results||[];
  if(!successes.length)return {n:0};
  const minTs=Math.min(...successes.map(s=>Number(s.ts)))-60*60_000;
  const maxTs=Math.max(...successes.map(s=>Number(s.success_ts)));
  const allEvents=(await env.DB.prepare(`SELECT signal,ts FROM signal_events WHERE symbol=? AND source='Twelve Data' AND ts BETWEEN ? AND ? ORDER BY ts ASC`).bind(symbol,minTs,maxTs).all()).results||[];
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
  const sourceClause = assetType === 'stock' ? " AND source='Twelve Data'" : '';
  const rows=(await env.DB.prepare(`SELECT ts,score,crv,executability,light,price FROM market_snapshots
    WHERE symbol=? AND asset_type=?${sourceClause} AND ts>=? ORDER BY ts ASC`).bind(symbol,assetType,Date.now()-LEARN_HISTORY_MS).all()).results||[];
  // ein Punkt je 15-Minuten-Segment, serverseitig und geräteunabhängig
  const bins=new Map();
  for(const x of rows) bins.set(Math.floor(Number(x.ts)/(15*60_000)),{ts:Number(x.ts),quality:Number(x.score)||0,executability:Number(x.executability)||0,light:x.light||'red',crv:Number(x.crv)||0,price:Number(x.price)||0});
  return [...bins.values()].slice(-8);
}
async function learningPayload(env, stocks=[], coins=[]){
  if(!env.DB)return {configured:false,state:'nodb',message:'D1-Binding DB fehlt',version:APP_VERSION};
  await ensureD1Schema(env);
  const now=Date.now();
  const key=[...stocks.slice(0,8).sort(), '|', ...coins.slice(0,30).sort()].join(',');
  if(learnMemo.data && learnMemo.key===key && now-learnMemo.ts<60_000) return learnMemo.data;
  const counts=await env.DB.prepare(`SELECT
    COUNT(*) snapshots,
    SUM(CASE WHEN resolved_ts IS NOT NULL THEN 1 ELSE 0 END) resolved,
    SUM(CASE WHEN success_ts IS NOT NULL THEN 1 ELSE 0 END) expansions,
    MAX(ts) last_ts FROM market_snapshots`).first();
  const stockOut={};
  for(const sym of stocks.slice(0,8)) stockOut[sym]={twin:await d1TwinFor(env,sym),lead:await d1LeadModel(env,sym),history:await d1History(env,sym,'stock')};
  const coinOut={};
  for(const sym of coins.slice(0,30)) coinOut[sym]={history:await d1History(env,sym,'coin')};
  const data={configured:true,state:'ok',ts:now,stats:{snapshots:Number(counts?.snapshots)||0,resolved:Number(counts?.resolved)||0,expansions:Number(counts?.expansions)||0,lastTs:Number(counts?.last_ts)||null},stocks:stockOut,coins:coinOut,version:APP_VERSION};
  learnMemo={ts:now,key,data}; return data;
}
async function serverLearningCycle(env, scheduledTime=Date.now()){
  if(!env.DB) return;
  await ensureD1Schema(env);
  const now=Number(scheduledTime)||Date.now(), phase=usMarketPhase(new Date(now));
  if(env.FUSION_API_KEY && Math.floor(now/60_000)%5===0){
    try{
      const snap=await getSnapshot(env,{},true);
      await d1StoreRows(env,snap.rows||[],{source:'Bitpanda Fusion',assetType:'coin',now});
      setApiState('crypto','ok'); await persistApiState(env,'crypto','ok',`${snap.rows?.length||0} Rows`,now);
    }catch(e){
      const state=classifyError(e); setApiState('crypto',state,e?.message);
      await persistApiState(env,'crypto',state,e?.message,now); cronLog('crypto',state,e?.message);
    }
  }
  const np=nyParts(new Date(now)),minsET=Number(np.hour)*60+Number(np.minute);
  if(env.ALPACA_API_KEY_ID&&env.ALPACA_API_SECRET_KEY&&minsET>=480&&minsET<=1020&&phase.key!=='closed'){
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
  if(env.TWELVE_API_KEY && Math.floor(now/60_000)%30===1){
    try{
      const st=await stockSnapshot(env,false,new Set(ALL_ON),3);
      await d1StoreRows(env,st.rows||[],{source:'Twelve Data',assetType:'stock',now});
      setApiState('stocks','ok',`${st.rows?.length||0} Rows`);
      await persistApiState(env,'stocks','ok',`${st.rows?.length||0} Rows`,now);
    }catch(e){
      const state=classifyError(e); setApiState('stocks',state,e?.message);
      await persistApiState(env,'stocks',state,e?.message,now); cronLog('stocks',state,e?.message);
    }
  }
}

function authed(req, url, env) {
  if (!env.APP_TOKEN) return true;                      // kein Token gesetzt → offen
  const t = req.headers.get('x-fp-token') || url.searchParams.get('t');
  return t === env.APP_TOKEN;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      // Version kommt aus dem DEPLOYTEN Code, nicht aus einer CF-Variable.
      // Weicht env.APP_VERSION ab, ist die Variable veraltet – das wird gemeldet.
      const [cryptoHealth,stocksHealth,alpacaHealth] = await Promise.all([
        persistentApiState(env,'crypto',!!env.FUSION_API_KEY),
        persistentApiState(env,'stocks',!!env.TWELVE_API_KEY),
        persistentApiState(env,'alpaca',!!(env.ALPACA_API_KEY_ID && env.ALPACA_API_SECRET_KEY)),
      ]);
      return json({
        ok: true,
        version: APP_VERSION,
        varVersion: env.APP_VERSION || null,
        versionVarInSync: !env.APP_VERSION || env.APP_VERSION === APP_VERSION,
        configured: !!env.FUSION_API_KEY,
        protected: !!env.APP_TOKEN,
        stocksConfigured: !!env.TWELVE_API_KEY,
        alpacaConfigured: !!(env.ALPACA_API_KEY_ID && env.ALPACA_API_SECRET_KEY),
        crowdConfigured: !!env.SERPAPI_KEY,
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
      if (!authed(request, url, env)) return json({ error: 'Nicht autorisiert.' }, 401);
      // Der Fusion-Key wird nur für die Krypto-Routen gebraucht. Der Aktienradar
      // soll auch dann laufen, wenn nur TWELVE_API_KEY gesetzt ist.
      const needsFusion = url.pathname === '/api/scan' || url.pathname.startsWith('/api/pair/');
      if (needsFusion && !env.FUSION_API_KEY) {
        setApiState('crypto', 'nokey', 'FUSION_API_KEY fehlt');
        return json({ error: 'FUSION_API_KEY fehlt (Secret in Cloudflare setzen).', state: 'nokey' }, 500);
      }
    }


    if (url.pathname === '/api/learning') {
      try {
        const stocks=(url.searchParams.get('stocks')||'').split(',').map(x=>x.trim().toUpperCase()).filter(Boolean);
        const coins=(url.searchParams.get('coins')||'').split(',').map(x=>x.trim().toUpperCase()).filter(Boolean);
        return json(await learningPayload(env,stocks,coins),200,{ 'cache-control':'no-store' });
      } catch(e) { return json({configured:!!env.DB,state:'error',error:e.message||String(e),version:APP_VERSION},502,{ 'cache-control':'no-store' }); }
    }

    if (url.pathname === '/api/experimental') {
      try { return json(await experimentalPulse(url.searchParams.get('force') === '1'), 200, { 'cache-control':'no-store' }); }
      catch (e) { return json({state:'error',error:e.message||String(e),version:APP_VERSION},502,{ 'cache-control':'no-store' }); }
    }

    if (url.pathname === '/api/crowd') {
      try { const d=await crowdPulse(env,url.searchParams.get('symbols'),url.searchParams.get('force') === '1'); if(env.DB&&d.rows?.length) ctx.waitUntil(d1StoreCrowd(env,d.rows).catch(()=>{})); return json(d,200,{ 'cache-control':'no-store' }); }
      catch (e) { return json({state:'error',configured:!!env.SERPAPI_KEY,error:e.message||String(e),rows:[],version:APP_VERSION},502,{ 'cache-control':'no-store' }); }
    }

    if (url.pathname === '/api/opening') {
      try { return json(await openingMomentum(env, url.searchParams.get('force') === '1'), 200, { 'cache-control':'no-store' }); }
      catch (e) { const state=classifyError(e); setApiState('alpaca',state,e?.message); return json({configured:!!(env.ALPACA_API_KEY_ID&&env.ALPACA_API_SECRET_KEY),state,error:e.message||String(e),rows:openingMemo.data?.rows||[],feed:alpacaFeedLabel(env),phaseLabel:usMarketPhase().label,phaseHelp:usMarketPhase().help,version:APP_VERSION},state==='ratelimit'?429:502,{ 'cache-control':'no-store' }); }
    }

    if (url.pathname === '/api/stocks') {
      try {
        const comp = parseComponents(url.searchParams.get('comp'));
        const minCrv = Math.max(1, +url.searchParams.get('minCrv') || 3);
        const lookup = url.searchParams.get('lookup');
        if (lookup) return json(await stockLookup(env, lookup, comp, minCrv), 200, { 'cache-control':'no-store' });
        return json(await stockSnapshot(env, url.searchParams.get('force') === '1', comp, minCrv), 200, { 'cache-control':'no-store' });
      } catch (e) {
        const state = classifyError(e);
        setApiState('stocks', state, e?.message);
        return json({
          error: e.message || String(e), state, configured: !!env.TWELVE_API_KEY,
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
        return json(await getSnapshot(env, opts, force), 200, { 'cache-control':'no-store' });
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
