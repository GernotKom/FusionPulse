/* Synthetische Tagesbalken, deterministisch. Ein Fehlschlag muss reproduzierbar
   sein — ein Test, der "manchmal" faellt, wird abgeschaltet statt verstanden. */
export function rng(seed = 42) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const day = (i) => new Date(Date.UTC(2025, 0, 6) + i * 86400000).toISOString().slice(0, 10);

/** Aufwaertstrend, danach Kompression AM HOCH — die Lage, um die es geht.
 *  `capPct > 0` legt zusaetzlich ein altes Hoch `capPct` % ueber die Box. */
export function compressionBars({
  n = 90, boxDays = 8, price = 50, baseRangePct = 1.8, boxRangePct = 0.6,
  volBase = 900_000, volFactor = 0.6, riseFrom = 0.86, capPct = 0, capAt = 0.75,
  seed = 7, aboveSma50 = true,
} = {}) {
  const r = rng(seed), out = [];
  const nBase = n - boxDays;
  const start = price * (aboveSma50 ? riseFrom : 1.18);
  for (let i = 0; i < nBase; i++) {
    const t = i / (nBase - 1);
    const c = start + (price - start) * t;
    const rangeAbs = c * baseRangePct / 100;
    const pos = 0.25 + r() * 0.5;
    const l = c - rangeAbs * pos, h = l + rangeAbs;
    out.push({ date: day(i), open: l + rangeAbs * 0.4, high: h, low: l, close: c,
      volume: Math.round(volBase * (0.85 + r() * 0.3)) });
  }
  if (capPct > 0) {
    const k = Math.floor(nBase * capAt);
    out[k] = { ...out[k], high: price * (1 + capPct / 100), close: Math.min(out[k].close, price * (1 + capPct / 100)) };
  }
  const lo = price * (1 - boxRangePct / 100), hi = price;
  for (let i = 0; i < boxDays; i++) {
    const span = hi - lo;
    const mid = lo + span * (0.3 + r() * 0.35);
    const h = i === 0 ? hi : Math.min(hi, mid + span * 0.28);
    const l = i === 1 ? lo : Math.max(lo, mid - span * 0.28);
    const cl = i === boxDays - 1 ? h - span * 0.1 : mid;
    out.push({ date: day(nBase + i), open: mid, high: h, low: l,
      close: Math.min(h, Math.max(l, cl)),
      volume: Math.round(volBase * volFactor * (0.9 + r() * 0.2)) });
  }
  return out;
}

/** Scharfer Rueckgang im intakten Aufwaertstrend, letzter Balken stabilisiert. */
export function reversalBars({ n = 90, price = 50, baseRangePct = 1.8, dropPct = 7,
  volBase = 900_000, closePos = 0.85, riseFrom = 0.80, seed = 11, downtrend = false, tightPct = 0.4, hammer = false, barRangePct = 1.4 } = {}) {
  const r = rng(seed), out = [];
  const nBase = n - 4;
  const start = downtrend ? price * 1.35 : price * riseFrom;
  for (let i = 0; i < nBase; i++) {
    const t = i / (nBase - 1);
    const c = start + (price - start) * t;
    const rangeAbs = c * baseRangePct / 100;
    const pos = 0.25 + r() * 0.5;
    const l = c - rangeAbs * pos, h = l + rangeAbs;
    out.push({ date: day(i), open: l + rangeAbs * 0.4, high: h, low: l, close: c,
      volume: Math.round(volBase * (0.85 + r() * 0.3)) });
  }
  const top = price;
  for (let i = 0; i < 3; i++) {
    const c = top * (1 - dropPct / 100 * (i + 1) / 3);
    out.push({ date: day(nBase + i), open: c * 1.008, high: c * 1.011, low: c * 0.993,
      close: c, volume: Math.round(volBase * 1.7) });
  }
  const prev = out[out.length - 1];
  // Umkehrbalken: unterbietet das Vortagestief und schliesst oben (Hammer).
  const l = hammer ? prev.low * (1 - tightPct / 100) : prev.close * (1 - tightPct / 100);
  const h = l * (1 + barRangePct / 100);
  out.push({ date: day(nBase + 3), open: l + (h - l) * 0.3, high: h, low: l,
    close: l + (h - l) * closePos, volume: Math.round(volBase * 1.25) });
  return out;
}

export function withNextDay(bars, { open, high, low, close, volume = 1_000_000 }) {
  const last = bars[bars.length - 1];
  const d = new Date(Date.parse(last.date) + 86400000).toISOString().slice(0, 10);
  return [...bars, { date: d, open, high, low, close, volume }];
}
