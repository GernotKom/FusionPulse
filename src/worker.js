/* ============================================================================
   FusionPulse v2 — Cloudflare Worker
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
    .filter((c) => c.c > 0)
    .sort((a, b) => a.t - b.t);
}

/** 5m-Kerzen zu höherem TF verdichten (bucketSec = 900 → 15m, 3600 → 1h). */
function resample(cs, bucketSec) {
  const out = [];
  let cur = null;
  for (const c of cs) {
    const b = Math.floor(c.t / bucketSec) * bucketSec;
    if (!cur || cur.t !== b) { cur = { t: b, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v }; out.push(cur); }
    else { cur.h = Math.max(cur.h, c.h); cur.l = Math.min(cur.l, c.l); cur.c = c.c; cur.v += c.v; }
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
function analyse({ pair, c5, btc5, book, fee, mode = 'composite' }) {
  if (c5.length < 60) return null;

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
  const c15 = resample(cs, 900);
  const c60 = resample(cs, 3600);
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
  const volZ = z(vRecent, vBase);
  const volumeAcceleration = clamp(5 + volZ * 1.8);

  // --- Kompression / Squeeze ----------------------------------------------
  const bbNow = bbWidth(cl, 20);
  const bbHist = [];
  for (let i = 20; i <= 60; i += 4) bbHist.push(bbWidth(cl.slice(0, cl.length - i + 20), 20));
  const bbMed = median(bbHist.filter((x) => x > 0)) || bbNow || 1;
  const compression = clamp(10 - (bbNow / bbMed) * 5);

  // --- Relative Stärke vs. BTC (vol-normiert) ------------------------------
  let relativeStrength = 5, btcBias = 0;
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

  if (flushLeg && reclaimLeg && volZ > 0.9) {
    regime = 'Reversal'; setup = 'Flush → Reclaim'; orderType = 'limit'; setupFit = 8.2;
  } else if (b60 > 0.05 && emaDev > -2.6 && emaDev < 0.5 && rsi14 >= 33 && rsi14 <= 64 && momentum < 6.6) {
    regime = 'Pullback'; setup = 'Pullback an VWAP/EMA21'; orderType = 'limit'; setupFit = 9.3;
  } else if (compression >= 6.0 && volumeAcceleration >= 5.4 && posInRange >= 0.55 && b60 >= -0.15) {
    regime = 'Kompression'; setup = 'Squeeze → Breakout'; orderType = 'stop'; setupFit = 8.9;
  } else if (wasBelow && vwapDev > 0.1 && vwapDev < 1.6 && volZ > 0.6 && b15 > 0) {
    regime = 'Reclaim'; setup = 'VWAP-Reclaim'; orderType = 'limit'; setupFit = 8.7;
  } else if (relativeStrength >= 6.9 && Math.abs(btcBias) < 1.0 && b60 >= -0.05 && exhaustion < 6) {
    regime = 'RS-Rotation'; setup = 'Relative Stärke vs. BTC'; orderType = 'limit'; setupFit = 8.0;
  } else if (momentum > 6.5 && volumeAcceleration > 5.8 && exhaustion < 6.5) {
    regime = 'Expansion'; setup = 'Trend-Expansion (spät)'; orderType = 'stop'; setupFit = 6.2;
  }

  // --- Einstiegszone statt Einstiegspunkt ---------------------------------
  const anchor = orderType === 'stop'
    ? Math.max(hi20, px) + 0.10 * A                     // Ausbruchs-Trigger
    : Math.max(Math.min(px, Math.max(vwapS, e21)), px - 0.9 * A); // Rücksetzer-Anker
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
  const quality = clamp(
    setupFit * 0.30 + mtf * 0.21 + volumeAcceleration * 0.16 +
    relativeStrength * 0.13 + compression * 0.11 + trendQuality * 0.09 -
    Math.max(0, exhaustion - 5) * 0.34
  );
  const spreadScore = spread == null ? 5.5 : clamp(10 - spread * 1100);
  const executability = clamp(
    liquidity * 0.38 + Math.min(10, costRatio * 2) * 0.30 +
    spreadScore * 0.18 + Math.min(10, (netCRV / 3) * 10) * 0.14
  );

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

  // --- Scores --------------------------------------------------------------
  const score = clamp(
    mtf * 0.18 + setupFit * 0.16 + liquidity * 0.14 + volumeAcceleration * 0.12 +
    relativeStrength * 0.11 + trendQuality * 0.10 + bookScore * 0.09 +
    compression * 0.06 + momentum * 0.04 - exhaustion * 0.10
  );
  // Pre-Move: was passiert BEVOR die Bewegung sichtbar ist
  const premove = clamp(
    compression * 0.26 + volumeAcceleration * 0.22 + bookScore * 0.16 +
    relativeStrength * 0.14 + mtf * 0.12 + liquidity * 0.10 -
    Math.max(0, momentum - 7.2) * 1.4
  );
  let modeScore = score, modeQuality = quality;
  if (mode === 'elliott') { modeScore = elliott; modeQuality = elliott; }
  else if (mode === 'momentum') { modeScore = clamp(momentum*.38 + volumeAcceleration*.34 + compression*.18 + relativeStrength*.10); modeQuality = modeScore; }
  else if (mode === 'trend') { modeScore = clamp(mtf*.38 + trendQuality*.30 + setupFit*.22 + (aboveVwap?10:3)*.10); modeQuality = modeScore; }
  else if (mode === 'micro') { modeScore = clamp(liquidity*.40 + bookScore*.32 + spreadScore*.18 + Math.min(10,costRatio*2)*.10); modeQuality = modeScore; }


  // --- Ampel ---------------------------------------------------------------
  let light = 'red';
  const viable = netCRV >= 1.0 && costRatio >= 2.5 && exhaustion < 8.5;
  const tradable = viable && netCRV >= 1.8 && (spread == null || spread <= 0.0025)
                   && liquidity >= 6 && exhaustion < 7;
  if (modeQuality >= 7.0 && executability >= 6.5 && tradable && (mode === 'elliott' || setupFit >= 7)) light = 'green';
  else if (viable && (modeQuality >= 6.0 || (mode === 'composite' && premove >= 7.2))) light = 'yellow';

  // Quadrant fuer die 2D-Karte im Dashboard
  const quadrant = modeQuality >= 6 
    ? (executability >= 6 ? 'handeln' : 'blockiert')   // gutes Setup, teuer
    : (executability >= 6 ? 'liquide'  : 'ignorieren');

  // Warum NICHT grün? (spart im Trade-Alltag enorm viel Grübelzeit)
  const blockers = [];
  if (netCRV < 1.8) blockers.push(`CRV nur ${r2(netCRV)}`);
  if (costRatio < 2.5) blockers.push(`Kosten fressen den Stop (${r1(costRatio)}x)`);
  if (spread != null && spread > 0.0025) blockers.push(`Spread ${(spread * 100).toFixed(2)} %`);
  if (liquidity < 6) blockers.push('dünne Tiefe');
  if (exhaustion >= 7) blockers.push('überdehnt');
  if (setupFit < 7) blockers.push('kein klares Setup');
  if (modeScore < 7.4) blockers.push(`Score ${r1(modeScore)}`);

  // Sparkline: letzte 48 Closes normalisiert 0..100
  const sp = cl.slice(-48);
  const spLo = minOf(sp), spHi = maxOf(sp);
  const spark = sp.map((c) => Math.round(spHi > spLo ? ((c - spLo) / (spHi - spLo)) * 100 : 50));

  return {
    pair, light, score: r1(modeScore), premove: r1(premove), regime, setup, orderType,
    quality: r1(modeQuality), executability: r1(executability), quadrant, analysisMode: mode,
    blockers,
    // Faktoren
    momentum: r1(momentum), volumeAcceleration: r1(volumeAcceleration),
    relativeStrength: r1(relativeStrength), compression: r1(compression),
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
  const pre = chosen.map((p) => {
    const cs = candleMap.get(p);
    if (!cs || cs.length < 60) return null;
    return analyse({ pair: p, c5: cs, btc5: p === 'BTC-EUR' ? null : btc5, book: null, fee, mode: opts.mode || 'composite' });
  }).filter(Boolean);

  pre.sort((a, b) => (b.score + b.premove) - (a.score + a.premove));
  const bookPairs = pre.slice(0, CFG.BOOK_MAX).map((x) => x.pair);

  const bookMap = new Map();
  await pool(bookPairs, CFG.POOL, async (p) => {
    try { bookMap.set(p, bookMetrics(await c.get(`orderbook/${p}`, { depth: CFG.BOOK_DEPTH }))); }
    catch { bookMap.set(p, null); }
  });

  // Finale Analyse mit Orderbuch, wo vorhanden
  const rows = chosen.map((p) => {
    const cs = candleMap.get(p);
    if (!cs || cs.length < 60) return null;
    return analyse({ pair: p, c5: cs, btc5: p === 'BTC-EUR' ? null : btc5, book: bookMap.get(p) || null, fee, mode: opts.mode || 'composite' });
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
    ts: Date.now(),
    fee, feeBps: Math.round(fee * 10_000),
    universe: eur.length, liquidCount: liquid.length, deepCount: rows.length, bookCount: bookPairs.length,
    subrequests: c.used, marketRegime, breadth: r2(breadth), btcTrend: r1(btcTrend),
    rows,
  };
}

/* ============================================= Cache + Single-Flight-Schutz */
let memo = { ts: 0, data: null };
let inflight = null;
let btcRef = null;        // letzte BTC-Kerzen fuer die RS-Berechnung im Einzelabruf

async function getSnapshot(env, opts, force) {
  const fresh = Date.now() - memo.ts < CFG.TTL_MS;
  if (!force && fresh && memo.data) return { ...memo.data, cached: true };
  if (inflight) return { ...(await inflight), cached: true };

  inflight = (async () => {
    try {
      const data = await runScan(env.FUSION_API_KEY, opts);
      memo = { ts: Date.now(), data };
      if (env.SNAP) await env.SNAP.put('snapshot', JSON.stringify(data), { expirationTtl: 60 });
      return data;
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

function authed(req, url, env) {
  if (!env.APP_TOKEN) return true;                      // kein Token gesetzt → offen
  const t = req.headers.get('x-fp-token') || url.searchParams.get('t');
  return t === env.APP_TOKEN;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return json({
        ok: true,
        version: env.APP_VERSION || '2.3.0',
        configured: !!env.FUSION_API_KEY,
        protected: !!env.APP_TOKEN,
        kv: !!env.SNAP,
        cacheAgeMs: memo.ts ? Date.now() - memo.ts : null,
      });
    }

    if (url.pathname.startsWith('/api/')) {
      if (!env.FUSION_API_KEY) return json({ error: 'FUSION_API_KEY fehlt (Secret setzen).' }, 500);
      if (!authed(request, url, env)) return json({ error: 'Nicht autorisiert.' }, 401);
    }

    if (url.pathname === '/api/scan') {
      try {
        const opts = {
          deep: +url.searchParams.get('deep') || CFG.DEEP_MAX,
          watch: (url.searchParams.get('watch') || '').split(',').filter(Boolean),
          mode: ['composite','elliott','momentum','trend','micro'].includes(url.searchParams.get('mode')) ? url.searchParams.get('mode') : 'composite',
        };
        const force = url.searchParams.get('force') === '1';
        return json(await getSnapshot(env, opts, force));
      } catch (e) {
        return json({ error: e.message || String(e) }, 502);
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
        });
        return row ? json({ ts: Date.now(), row }) : json({ error: 'Zu wenig Daten.' }, 404);
      } catch (e) {
        return json({ error: e.message || String(e) }, 502);
      }
    }

    return env.ASSETS.fetch(request);
  },

  // Cron wärmt den Cache vor → erster App-Start ist sofort da
  async scheduled(event, env, ctx) {
    if (!env.FUSION_API_KEY) return;
    ctx.waitUntil(getSnapshot(env, {}, true).catch(() => {}));
  },
};
