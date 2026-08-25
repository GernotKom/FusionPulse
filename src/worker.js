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
  ['Gesundheit','SDGR','Schrödinger, Inc.']
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
    relVol: relVol == null ? null : +relVol.toFixed(2), volumeKnown, vwapUsd: vwap, aboveVwap: volumeKnown ? last.c >= vwap : null,
    liquidityVacuum: +liquidityVacuum.toFixed(0),
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
async function crowdPulse(env,symbols,force=false){
  const syms=[...new Set(String(symbols||'').split(',').map(x=>x.trim().toUpperCase()).filter(x=>/^[A-Z0-9.\-]{1,8}$/.test(x)))].slice(0,15);
  const key=syms.join(',');
  if(!env.SERPAPI_KEY)return {configured:false,state:'nokey',rows:syms.map(symbol=>({symbol,score:null,stars:null,source:'Reddit/X/Stocktwits Search'})),note:'SERPAPI_KEY fehlt; Crowd-Werte werden nicht erfunden.',version:APP_VERSION};
  if(!force&&crowdMemo.data&&crowdMemo.key===key&&Date.now()-crowdMemo.ts<20*60_000)return {...crowdMemo.data,cached:true};
  const rows=[];
  for(const symbol of syms){
    const u=new URL('https://serpapi.com/search.json');u.searchParams.set('engine','google');u.searchParams.set('q',crowdCommunityQuery(symbol));u.searchParams.set('location','United States');u.searchParams.set('hl','en');u.searchParams.set('num','20');u.searchParams.set('tbs','qdr:d');u.searchParams.set('api_key',env.SERPAPI_KEY);
    try{
      const j=await fetchJSONPublic(u.toString());const org=(j?.organic_results||[]).slice(0,20);
      const domains=new Set(),texts=[];
      for(const x of org){const link=String(x?.link||'').toLowerCase();if(link.includes('reddit.com'))domains.add('Reddit');if(link.includes('x.com'))domains.add('X');if(link.includes('stocktwits.com'))domains.add('Stocktwits');texts.push(`${x?.title||''} ${x?.snippet||''}`.toLowerCase());}
      const mentions=org.length, breadth=domains.size;
      // Attention only: no fabricated sentiment. Breadth + fresh result count become a transparent 0..100 attention score.
      const score=clamp(mentions*4+breadth*8,0,100);const stars=mentions?star5(1+score/25):null;
      rows.push({symbol,score:r1(score),stars,accel:null,interest:mentions,source:[...domains].join(' + ')||'Community Search',sources:[...domains],mentions24h:mentions,note:'Community-Aufmerksamkeit der letzten 24 h; keine Sentiment- oder BUY-Aussage.'});
    }catch(e){rows.push({symbol,score:null,stars:null,source:'Reddit/X/Stocktwits Search',error:String(e.message||e)});}
  }
  const data={configured:true,state:'ok',rows,cacheMinutes:20,note:'Crowd Pulse sucht vorrangig Reddit, X und Stocktwits. Er misst frische Aufmerksamkeit/Quellenbreite, nicht Wahrheit oder Kaufqualität; 0 % BUY-Gewicht.',ts:Date.now(),version:APP_VERSION};
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
  // Bestehende Produktions-D1 aus älteren Versionen sicher nachziehen.
  const cols=(await env.DB.prepare('PRAGMA table_info(market_snapshots)').all()).results||[];
  if(!cols.some(c=>String(c.name)==='executability')) await env.DB.prepare('ALTER TABLE market_snapshots ADD COLUMN executability REAL').run();
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
async function d1BatchChunks(env, stmts, size=50){
  for(let i=0;i<stmts.length;i+=size) await env.DB.batch(stmts.slice(i,i+size));
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
  const unresolved=(await env.DB.prepare(`SELECT id,symbol,ts,price,max_pct,min_pct,success_ts FROM market_snapshots
    WHERE symbol IN (${placeholders}) AND asset_type=? AND source=? AND resolved_ts IS NULL AND ts>=? ORDER BY ts ASC LIMIT 3000`)
    .bind(...symbols,assetType,source,now-LEARN_HORIZON_MS-15*60_000).all()).results||[];
  const pxBySym=new Map(clean.map(x=>[x.symbol,x.price])), updates=[];
  for(const x of unresolved){
    const price=pxBySym.get(String(x.symbol).toUpperCase()); if(!(price>0)||!(Number(x.price)>0)) continue;
    const pct=(price/Number(x.price)-1)*100, mx=Math.max(Number(x.max_pct)||0,pct), mn=Math.min(Number(x.min_pct)||0,pct);
    const successTs=x.success_ts || (mx>=5?now:null), resolved=(now-Number(x.ts)>=LEARN_HORIZON_MS)?now:null;
    updates.push(env.DB.prepare('UPDATE market_snapshots SET max_pct=?,min_pct=?,success_ts=COALESCE(success_ts,?),resolved_ts=COALESCE(resolved_ts,?) WHERE id=?')
      .bind(mx,mn,successTs,resolved,x.id));
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
        safeJson({setup:row.setup||null,phaseAction:row.phaseAction||null,verdict:row.verdict||null})));
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
  for(const x of twins){const w=1/Math.pow(1+Math.max(0,Number(x.d)||0),2);totalW+=w;if(Number(x.max_pct)>=5)winW+=w;}
  return {n:twins.length,available,distinctSymbols,edge:totalW?Math.round(winW/totalW*100):0,stops:twins.filter(x=>Number(x.min_pct)<=-1.5).length,median:r1(vals[Math.floor(vals.length/2)]||0),source:'d1',independent:true};
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

function authed(req, url, env) {
  if (!env.APP_TOKEN) return true;                      // kein Token gesetzt → offen
  const t = req.headers.get('x-fp-token') || url.searchParams.get('t');
  return t === env.APP_TOKEN;
}


/* ------------------------------------------------ Tiingo v3.1.0 isolated layer */
async function tiingoFetch(env, path) {
  if (!env.TIINGO_API_TOKEN) throw new Error('TIINGO_API_TOKEN fehlt');
  const res = await fetch(`https://api.tiingo.com${path}`, {
    headers: { accept: 'application/json', authorization: `Token ${env.TIINGO_API_TOKEN}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 429) throw new Error('Tiingo Rate-Limit (429)');
  if (!res.ok) throw new Error(`Tiingo ${res.status}: ${(await res.text()).slice(0,180)}`);
  return res.json();
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
async function tiingoBoatsDiscovery(env,limit=15,force=false){
  const now=Date.now();
  if(!force && tiingoDiscoveryMemo.rows.length && now-tiingoDiscoveryMemo.ts<5*60_000) return tiingoDiscoveryMemo;
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
async function tiingoIexSnapshot(env, rawSymbols){
  const symbols=[...new Set(String(rawSymbols||'').split(',').map(x=>x.trim().toUpperCase()).filter(x=>/^[A-Z0-9.\-]{1,12}$/.test(x)))].slice(0,50);
  if(!symbols.length) return [];
  const d=await tiingoFetch(env,'/iex');
  const wanted=new Set(symbols);
  return (Array.isArray(d)?d:[]).filter(x=>wanted.has(String(x.ticker||x.symbol||'').toUpperCase()));
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
  // Long-Opportunity-Radar: frische Aufwaertsbeschleunigung zaehlt staerker als ein bereits gelaufener Tagesmove.
  // Ein negativer Tagesmove kann trotzdem nominiert werden, wenn gerade eine deutliche Reversal-Beschleunigung beginnt.
  const activity=Number.isFinite(volume)&&volume>0?Math.min(7,Math.log10(volume+1)):0;
  let score=Math.max(0,movePct)*0.85 + Math.max(0,speedPct)*9 + Math.max(0,openPct||0)*0.35 + Math.min(4,Math.max(0,rangePct||0)*0.35) + activity*0.45 + Math.min(3,spreadImprove*4);
  if(movePct>8 && speedPct<0.05) score-=Math.min(4,(movePct-8)*0.25); // spaete Runner nicht blind bevorzugen
  if(movePct<0 && speedPct<=0) score-=2;
  if(spreadPct==null) score-=0.6; // fehlender Quote verbessert niemals
  const reasons=[];
  if(speedPct>=0.35) reasons.push(`Beschleunigung +${speedPct.toFixed(2)} %`);
  if(volDelta>0) reasons.push('Volumen zieht an');
  if(spreadImprove>=0.05) reasons.push('Spread wird enger');
  if(movePct>=2) reasons.push(`Tagesstaerke +${movePct.toFixed(1)} %`);
  if(movePct<0&&speedPct>=0.25) reasons.push('Reversal-Versuch');
  const ts=radarTs(x), ageMin=ts?Math.max(0,(Date.now()-ts)/60000):null;
  if(ageMin!=null && ageMin>30) return null;
  return {symbol,last,prevClose,open:Number.isFinite(open)?open:null,high:Number.isFinite(high)?high:null,low:Number.isFinite(low)?low:null,volume:Number.isFinite(volume)?volume:null,movePct,openPct,rangePct,spreadPct,speedPct,volDelta,score:Math.max(0,score),reasons,ts,ageMin,source:'Tiingo IEX Radar',buyWeight:0};
}
async function readPersistedIexRadar(env){
  if(!env?.DB) return null;
  try{await ensureD1Schema(env);const r=await env.DB.prepare('SELECT value,updated_ts FROM fp_meta WHERE key=? LIMIT 1').bind('iex_radar:last').first();if(!r?.value)return null;const p=JSON.parse(r.value);return p?.rows?.length?{ts:Number(p.ts||r.updated_ts||0),rows:p.rows,universe:Number(p.universe||0)}:null;}catch{return null;}
}
async function persistIexRadar(env,data){
  if(!env?.DB||!data?.rows?.length)return;
  try{await ensureD1Schema(env);const ts=Date.now(),payload=safeJson({ts,universe:data.universe,rows:data.rows.slice(0,120).map(r=>({symbol:r.symbol,last:r.last,prevClose:r.prevClose,open:r.open,high:r.high,low:r.low,volume:r.volume,spreadPct:r.spreadPct,movePct:r.movePct,openPct:r.openPct,rangePct:r.rangePct,speedPct:r.speedPct,volDelta:r.volDelta,score:r.score,reasons:r.reasons,ts:r.ts}))});await env.DB.prepare(`INSERT INTO fp_meta(key,value,updated_ts) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_ts=excluded.updated_ts`).bind('iex_radar:last',payload,ts).run();}catch(e){console.warn(JSON.stringify({event:'iex_radar_cache_write_failed',message:String(e?.message||e),ts:Date.now()}));}
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
  return checked.filter(x=>x?.m?.tradableStock).map(x=>({...x.r,securityName:x.m.name,companyDescription:x.m.description||'',exchange:x.m.exchange||'',assetType:'stock',securityVerified:true})).slice(0,limit);
}

function verifiedCommonOnly(rows){
  return (rows||[]).filter(r=>r?.securityVerified===true && !NON_COMMON_SYMBOL_DENY.has(String(r?.symbol||'').toUpperCase()) && !NON_COMMON_EQUITY_RE.test(`${r?.securityName||''} ${r?.name||''}`));
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

async function tiingoIexMarketRadar(env,limit=80,force=false){
  const now=Date.now();
  if(!force&&tiingoIexRadarMemo.rows.length&&now-tiingoIexRadarMemo.ts<50_000)return tiingoIexRadarMemo;
  const persisted=tiingoIexRadarMemo.rows.length?tiingoIexRadarMemo:await readPersistedIexRadar(env);
  const prevMap=new Map((persisted?.rows||[]).map(r=>[r.symbol,r]));
  const d=await tiingoFetch(env,'/iex'), all=Array.isArray(d)?d:[];
  const phase=usMarketPhase(new Date(now),'iex');
  const maxAge=['opening','regular'].includes(phase.key)?12:['premarket','after'].includes(phase.key)?30:90;
  const ranked=all.map(x=>iexRadarQuote(x,prevMap.get(String(x?.ticker||x?.symbol||'').toUpperCase()))).filter(Boolean)
    .filter(r=>r.ageMin==null||r.ageMin<=maxAge)
    .sort((a,b)=>b.score-a.score);
  // Instrument-Metadaten bewusst NICHT hier prüfen: Der Bulk-Radar soll CPU-arm
  // bleiben. ETF/ETP/Common-Stock-Verifikation erfolgt erst im getrennten Deep-
  // Scan-Cron auf den wenigen Top-Kandidaten.
  const rows=ranked.slice(0,Math.max(24,Math.min(120,limit)));
  tiingoIexRadarMemo={ts:now,rows,universe:all.length,phase:phase.key,source:'Tiingo IEX Whole-Market Radar · prefiltered',buyWeight:0};
  await persistIexRadar(env,tiingoIexRadarMemo);
  return tiingoIexRadarMemo;
}
function deepRecheckRank(r){
  const score=Number(r?.score)||0,crv=Number(r?.netCRV)||0,rv=Number(r?.relVol)||0,ret15=Number(r?.ret15)||0,structure=Number(r?.structurePct)||0;
  const ell=Number(r?.elliott)||0;
  // v3.2.6: Elliott ist wieder die zentrale Strukturachse. Momentum/CRV/RVOL bestätigen, ersetzen sie aber nicht.
  return ell*18 + score*6 + Math.min(26,Math.max(0,crv-1)*7) + Math.min(14,Math.max(0,rv-1)*5) + Math.min(10,Math.max(0,ret15)*1.5) + Math.min(12,Math.max(0,structure));
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
async function freshestStockQuote(env,symbol){
  const sym=safeRadarSymbol(symbol); if(!sym) return null;
  const candidates=[];
  const add=(price,ts,source,scope)=>{
    const p=Number(price),ms=ts?Date.parse(ts):NaN;
    if(Number.isFinite(p)&&p>0)candidates.push({priceUsd:p,ts:Number.isFinite(ms)?ms:null,updated:ts||null,source,scope});
  };
  if(env.ALPACA_API_KEY_ID&&env.ALPACA_API_SECRET_KEY){
    try{
      const feed=alpacaFeed(env),d=await alpacaJSON('/v2/stocks/snapshots',{symbols:sym,feed},env),snap=d?.[sym];
      if(snap){
        add(snap.latestTrade?.p,snap.latestTrade?.t,`Alpaca ${alpacaFeedLabel(env)}`,feed==='sip'?'konsolidierter US-Feed':'IEX-Teilmarkt');
        add(snap.minuteBar?.c,snap.minuteBar?.t,`Alpaca ${alpacaFeedLabel(env)}`,feed==='sip'?'konsolidierter US-Feed':'IEX-Teilmarkt');
      }
    }catch(e){console.warn(JSON.stringify({event:'stock_fresh_quote_alpaca_failed',symbol:sym,message:String(e?.message||e),ts:Date.now()}));}
  }
  if(env.TIINGO_API_TOKEN){
    try{
      const arr=await tiingoIexSnapshot(env,sym),x=arr?.[0];
      if(x)add(x.tngoLast??x.last??x.lastPrice,x.timestamp||x.lastSaleTimestamp||x.quoteTimestamp||x.lastUpdated, 'Tiingo IEX','IEX-Teilmarkt');
    }catch(e){console.warn(JSON.stringify({event:'stock_fresh_quote_tiingo_failed',symbol:sym,message:String(e?.message||e),ts:Date.now()}));}
  }
  if(!candidates.length)return null;
  candidates.sort((a,b)=>(b.ts||0)-(a.ts||0));
  const q=candidates[0],ageSec=q.ts?Math.max(0,Math.round((Date.now()-q.ts)/1000)):null;
  const phase=usMarketPhase();
  const active=['premarket-early','premarket','opening','regular','after'].includes(phase.key);
  const live=active ? (ageSec!=null && ageSec<=120) : (ageSec!=null && ageSec<=900);
  return {...q,ageSec,live,marketPhase:phase.key};
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
    return {configured:true,state:'ok',cached:true,rows:cleanMemo,ts:stockMemo.ts,cycle,universe:tiingoIexRadarMemo.universe||12000,universeLabel:`${tiingoIexRadarMemo.universe||'12.000+'} Tiingo/IEX`,scanned:cleanMemo.length,updatedThisCycle:0,refreshedSymbols:Array.isArray(stockMemo.refreshedSymbols)?stockMemo.refreshedSymbols:[],favoritePriority:favs.length,source:'Tiingo IEX',provider:'Tiingo',market:usMarketPhase(),discovery:{radar:{source:'Tiingo IEX Whole-Market Radar · verified cache only',ts:tiingoIexRadarMemo.ts,candidates:memoRadar,gainers:openingGainers(memoRadar),buyWeight:0},boats:{...tiingoDiscoveryMemo,rows:memoBoats,candidates:memoBoats,buyWeight:0}},version:APP_VERSION};
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
      return {configured:true,state:'ok',cached:true,persistent:true,rows:cleanRows,ts:persisted.ts,cycle:persisted.cycle,universe:radar?.universe||12000,universeLabel:`${radar?.universe||'12.000+'} Tiingo/IEX`,scanned:cleanRows.length,updatedThisCycle:0,refreshedSymbols:Array.isArray(persisted.meta?.refreshedSymbols)?persisted.meta.refreshedSymbols:[],favoritePriority:favs.length,source:'Tiingo IEX',provider:'Tiingo',market:usMarketPhase(),discovery:{radar:{source:'Tiingo IEX Whole-Market Radar · verified',ts:persisted.ts||0,candidates:verifiedRadar,gainers:openingGainers(verifiedRadar),buyWeight:0},boats:{source:'Tiingo BOATS · verified',ts:persisted.ts||0,candidates:verifiedBoats,buyWeight:0}},version:APP_VERSION,note:'Server-Cache: autonomer Cron-Radar/Deep-Scan; PWA startet keinen Doppel-Scan. Nur verifizierte Common Stocks werden an die UI gereicht.'};
    }
    const staleRows=stripKnownNonCommon(stockMemo.rows||[]);
    return {configured:true,state:'stale',cached:true,rows:staleRows,ts:stockMemo.ts||0,cycle,universe:tiingoIexRadarMemo.universe||12000,universeLabel:`${tiingoIexRadarMemo.universe||'12.000+'} Tiingo/IEX`,scanned:staleRows.length,updatedThisCycle:0,refreshedSymbols:[],favoritePriority:favs.length,source:'Tiingo IEX',provider:'Tiingo',market:usMarketPhase(),discovery:{radar:{source:'Tiingo IEX Whole-Market Radar',ts:tiingoIexRadarMemo.ts,candidates:(tiingoIexRadarMemo.rows||[]).slice(0,20),buyWeight:0},boats:tiingoDiscoveryMemo},version:APP_VERSION,note:'Warte auf ersten serverseitigen Cron-Batch.'};
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

  const picked=new Set(), favPick=[], recheckPick=[], radarPick=[], boatsPick=[], explore=[];
  // Favoriten bleiben vertreten, blockieren aber nicht mehr die gesamte Queue.
  // Favoriten rotieren pro Deep-Scan-Zyklus. v3.3.2 nahm immer nur die ersten
  // zwei Favoriten und ließ spätere Favoriten dadurch unnötig lange stale.
  if(favs.length){
    const startFav=(cycle*2)%favs.length;
    for(let i=0;i<favs.length&&favPick.length<2;i++){
      const sym=favs[(startFav+i)%favs.length];
      if(!picked.has(sym)){picked.add(sym);favPick.push(sym);}
    }
  }
  // v3.3.4: Whole-Market-Kandidaten werden VOR alten Rechecks priorisiert.
  // So kann der Deep Scan nicht wieder faktisch zu einem Favoriten-/Cache-Pool werden.
  const gainerPick=[];
  for(const x of openingGainers(radar.rows||[],8)){if(!picked.has(x.symbol)){picked.add(x.symbol);gainerPick.push(x.symbol);}if(gainerPick.length>=4)break;}
  for(const x of radar.rows||[]){if(!picked.has(x.symbol)){picked.add(x.symbol);radarPick.push(x.symbol);}if(radarPick.length>=8)break;}
  // Nur zwei starke Altanalysen pro Zyklus nachziehen; Discovery hat Vorrang.
  for(const r of [...(stockMemo.rows||[])].sort((a,b)=>deepRecheckRank(b)-deepRecheckRank(a))){const sym=String(r?.symbol||'').toUpperCase();if(sym&&!picked.has(sym)){picked.add(sym);recheckPick.push(sym);}if(recheckPick.length>=2)break;}
  // Overnight/Extended-Hours-Kandidaten duerfen die Queue ergaenzen, aber nie BUY setzen.
  for(const x of boats.rows||[]){if(!picked.has(x.symbol)){picked.add(x.symbol);boatsPick.push(x.symbol);}if(boatsPick.length>=2)break;}
  // Exploration verhindert Tunnelblick und sorgt fuer fortlaufende Rotation des stabilen Basiskatalogs.
  const start=(cycle*7)%STOCK_SEARCH_CATALOG.length;
  for(let i=0;i<STOCK_SEARCH_CATALOG.length&&picked.size<20;i++){const sym=STOCK_SEARCH_CATALOG[(start+i)%STOCK_SEARCH_CATALOG.length][1];if(!picked.has(sym)){picked.add(sym);explore.push(sym);}}
  const syms=[...favPick,...recheckPick,...gainerPick,...radarPick,...boatsPick,...explore].slice(0,20), fx=await getTiingoFx(env);
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
      const q=Math.max(0,Math.min(10,Number(row.score)||0)),crv=Math.max(0,Number(row.netCRV)||0),rv=Math.max(0,Number(row.relVol)||0);
      row.preSignalMaturity=Math.round(Math.max(0,Math.min(100,q/8*50 + Math.min(1,crv/3)*25 + Math.min(1,rv/1.8)*15 + (rm?.speedPct>0.2?10:0))));
      row.whyNow=(rm?.reasons||[]).slice(0,3);
      row.radarRank=Number(rm?.score)||0;
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
  const rows=[...safeCarry.values()].sort((a,b)=>(Number(b.preSignalMaturity)||0)-(Number(a.preSignalMaturity)||0)||(Number(b.radarRank)||0)-(Number(a.radarRank)||0)||(Number(b.score)||0)-(Number(a.score)||0)).slice(0,100);
  stockMemo={ts:Date.now(),rows,cycle,sig}; setApiState('stocks',fresh.length?'ok':'stale',fresh.length?null:'Tiingo lieferte keine analysierbaren Bars');
  await persistStockScan(env,sig,cycle,rows,{provider:'Tiingo IEX',fxUsdPerEur:fx||null,refreshedSymbols:fresh.map(r=>r.symbol),queue:{favorites:favPick,recheck:recheckPick,gainers:gainerPick,radar:radarPick,boats:boatsPick,explore},verifiedRadar:(radar.rows||[]).slice(0,20),verifiedBoats:(boats.rows||[]).slice(0,12)});
  return {configured:true,state:fresh.length?'ok':'stale',cached:false,rows,ts:stockMemo.ts,cycle,universe:radar.universe||12000,universeLabel:`${radar.universe||'12.000+'} Tiingo/IEX`,scanned:rows.length,deepCandidates:syms.length,updatedThisCycle:fresh.length,refreshedSymbols:fresh.map(r=>r.symbol),favoritePriority:favs.length,fxUsdPerEur:fx||null,source:'Tiingo IEX',provider:'Tiingo',market:phase,queue:{favorites:favPick.length,recheck:recheckPick.length,gainers:gainerPick.length,radar:radarPick.length,boats:boatsPick.length,explore:explore.length},discovery:{radar:{source:'Tiingo IEX Whole-Market Radar',ts:radar.ts,universe:radar.universe,candidates:(radar.rows||[]).slice(0,20),gainers:openingGainers(radar.rows||[]),buyWeight:0},boats:{source:'Tiingo BOATS',ts:boats.ts,session:boats.session,candidates:(boats.rows||[]).slice(0,15),buyWeight:0}},version:APP_VERSION,note:'Tiingo Primary: Whole-Market IEX Radar + BOATS Discovery (beide 0 % BUY-Gewicht) -> adaptive 20er Deep-Scan-Queue -> IEX 5-Min Analyse. BUY-Gates unveraendert.'};
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

async function tiingoStockLookup(env,raw,comp,minCrv=3){
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
  const cached=stockLookupMemo.get(info.symbol);if(cached&&Date.now()-cached.ts<5*60_000){
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
export { analyse, analyseStock };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      if (env.APP_TOKEN && !authed(request, url, env)) return json({ok:true,version:APP_VERSION,protected:true},200,{ 'cache-control':'no-store' });
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
        protected: !!env.APP_TOKEN,
        stocksConfigured: tiingoStocksMode(env)==='primary' ? !!env.TIINGO_API_TOKEN : !!env.TWELVE_API_KEY,
        stocksProvider: tiingoStocksMode(env)==='primary' ? 'Tiingo IEX' : 'Twelve Data',
        tiingoStocksMode: tiingoStocksMode(env),
        alpacaConfigured: !!(env.ALPACA_API_KEY_ID && env.ALPACA_API_SECRET_KEY),
        crowdConfigured: !!env.SERPAPI_KEY,
        tiingoConfigured: !!env.TIINGO_API_TOKEN,
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



    if (url.pathname === '/api/tiingo/validate') {
      try { return json(await tiingoValidation(env,url.searchParams.get('symbols')),200,{ 'cache-control':'no-store' }); }
      catch(e){ return json({configured:!!env.TIINGO_API_TOKEN,state:'error',error:String(e.message||e),version:APP_VERSION},502,{ 'cache-control':'no-store' }); }
    }

    if (url.pathname === '/api/tiingo/status') {
      if(!env.TIINGO_API_TOKEN) return json({configured:false,authenticated:false,state:'nokey',version:APP_VERSION},200,{ 'cache-control':'no-store' });
      try { const d=await tiingoFetch(env,'/api/test/'); return json({configured:true,authenticated:true,state:'ok',message:d?.message||'Tiingo authentication successful',boatsEntitlement:'not-tested',version:APP_VERSION},200,{ 'cache-control':'no-store' }); }
      catch(e){ return json({configured:true,authenticated:false,state:'error',error:String(e.message||e),version:APP_VERSION},502,{ 'cache-control':'no-store' }); }
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

    if (url.pathname === '/api/experimental') {
      try { return json(await experimentalPulse(url.searchParams.get('force') === '1'), 200, { 'cache-control':'no-store' }); }
      catch (e) { return json({state:'error',error:e.message||String(e),version:APP_VERSION},502,{ 'cache-control':'no-store' }); }
    }

    if (url.pathname === '/api/crowd') {
      try { const d=await crowdPulse(env,url.searchParams.get('symbols'),url.searchParams.get('force') === '1'); if(env.DB&&d.rows?.length) ctx.waitUntil(d1StoreCrowd(env,d.rows).catch(()=>{})); return json(d,200,{ 'cache-control':'no-store' }); }
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
          if(tiingoStocksMode(env)==='primary') return json(await tiingoStockLookup(env,lookup,comp,minCrv),200,{ 'cache-control':'no-store' });
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
