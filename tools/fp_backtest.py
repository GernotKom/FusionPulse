#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FusionPulse Rückwärtstest v5.1.0 · Windows und macOS · nur Python-Standardbibliothek

FRAGE: Bringen Aktien nach einem starken Kurssprung mit hohem Umsatz
(typisch nach Quartalszahlen) in den folgenden Tagen verlässlich > 2 %?
Und ist das besser als ein zufälliger Kauf derselben Aktien?

START
  Windows:  py fp_backtest.py            (Python von python.org, "Add to PATH" anhaken)
  macOS:    python3 fp_backtest.py
  Probelauf ohne Tiingo:  py fp_backtest.py --demo

Der Tiingo-Token wird abgefragt (oder Umgebungsvariable TIINGO_API_TOKEN).
Kursdaten werden im Ordner fp_cache gespeichert: ein zweiter Lauf kostet
keine Bandbreite.

EREIGNIS (Tag D)
  Eröffnung D mindestens GAP % über Schluss D-1, Schluss D >= Eröffnung D,
  Umsatz D mindestens VOL-fach des 20-Tage-Schnitts, Kurs >= 5 USD,
  Dollarumsatz im Schnitt >= 5 Mio USD.
  Tiingo Power liefert keinen Quartalszahlen-Kalender. Das Muster ist daher
  ein Stellvertreter: die meisten solchen Tage sind Zahlen- oder Nachrichtentage.

EINSTIEG: Eröffnung am Tag D+1 (Liste am Abend, Kauf am nächsten Tag).

REGELN (alle mit 10.000 EUR fix, 2 x 11,50 EUR, 0,15 % Reibung,
27,5 % KESt auf den Jahressaldo, also mit Verlustausgleich wie bei flatex AT)
  A  Ziel +ZIEL %, sonst Verkauf am Schluss nach HALTE Tagen, KEIN Stop
  B  wie A, aber Stop unter dem Tief von Tag D
  Trifft ein Tag Ziel UND Stop, wird der Stop gezählt (vorsichtig).

VERGLEICH: dieselben Aktien an zufälligen Tagen, gleiche Regeln.
Ein Vorteil zählt nur, wenn das Ereignis den Zufall deutlich schlägt.
"""
import argparse, csv, io, json, os, random, statistics, sys, time, zipfile
import urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta

NOTIONAL, FEE, FRICTION, TAX = 10000.0, 11.5, 0.15, 27.5
CACHE = "fp_cache"
TICKERS_URL = "https://apimedia.tiingo.com/docs/tiingo/daily/supported_tickers.zip"


# ───────────────────────────── Daten ─────────────────────────────
def http_get(url, tries=4):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "FusionPulse-Backtest"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                sys.exit("Tiingo lehnt den Token ab (HTTP %d). Token prüfen." % e.code)
            if e.code == 404:
                return None
            if e.code == 429:
                time.sleep(30 * (i + 1)); continue
            time.sleep(2 * (i + 1))
        except Exception:
            time.sleep(2 * (i + 1))
    return None


def load_universe(years, limit, tickers_file):
    if tickers_file:
        with open(tickers_file, encoding="utf-8") as f:
            return [t.strip().upper() for t in f if t.strip()][:limit]
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, "supported_tickers.zip")
    if not os.path.exists(path):
        print("Lade Titelliste von Tiingo …")
        raw = http_get(TICKERS_URL)
        if not raw:
            sys.exit("Titelliste nicht ladbar. Alternative: --tickers datei.txt (ein Symbol je Zeile).")
        open(path, "wb").write(raw)
    z = zipfile.ZipFile(path)
    rows = csv.DictReader(io.TextIOWrapper(z.open(z.namelist()[0]), encoding="utf-8"))
    need_start = (date.today() - timedelta(days=365 * years + 30)).isoformat()
    need_end = (date.today() - timedelta(days=14)).isoformat()
    out = []
    for r in rows:
        t = (r.get("ticker") or "").upper()
        if r.get("assetType") != "Stock" or r.get("priceCurrency") != "USD":
            continue
        if r.get("exchange") not in ("NYSE", "NASDAQ", "NYSE MKT", "NYSE ARCA"):
            continue
        if not t.isalpha() or len(t) > 5:
            continue
        if not r.get("startDate") or r["startDate"] > need_start or (r.get("endDate") or "") < need_end:
            continue
        out.append(t)
    random.Random(42).shuffle(out)  # fester Zufall: reproduzierbar, aber keine Buchstaben-Schlagseite
    return out[:limit]


def load_prices(sym, token, start):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f"{sym}_{start}.json")
    if os.path.exists(path):
        try:
            return json.load(open(path, encoding="utf-8"))
        except Exception:
            pass
    url = (f"https://api.tiingo.com/tiingo/daily/{sym}/prices?startDate={start}"
           f"&columns=date,adjOpen,adjHigh,adjLow,adjClose,adjVolume&token={token}")
    raw = http_get(url)
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except Exception:
        return None
    bars = [{"d": b["date"][:10], "o": b["adjOpen"], "h": b["adjHigh"], "l": b["adjLow"],
             "c": b["adjClose"], "v": b["adjVolume"]} for b in data
            if all(b.get(k) not in (None, 0) for k in ("adjOpen", "adjHigh", "adjLow", "adjClose"))]
    json.dump(bars, open(path, "w", encoding="utf-8"))
    return bars


def demo_prices(sym, days=780):
    """Synthetische Kurse ohne Vorteil: prüft nur, ob das Skript rechnet."""
    rnd = random.Random(sym)
    p, bars, d = rnd.uniform(10, 200), [], date(2023, 1, 2)
    for _ in range(days):
        gap = rnd.gauss(0, 0.012) + (rnd.uniform(0.05, 0.15) if rnd.random() < 0.01 else 0)
        o = p * (1 + gap); c = o * (1 + rnd.gauss(0, 0.02))
        h = max(o, c) * (1 + abs(rnd.gauss(0, 0.01))); l = min(o, c) * (1 - abs(rnd.gauss(0, 0.01)))
        v = rnd.uniform(5e5, 2e6) * (4 if abs(gap) > 0.04 else 1)
        bars.append({"d": d.isoformat(), "o": o, "h": h, "l": l, "c": c, "v": v}); p = c
        d += timedelta(days=1 if d.weekday() < 4 else 3)
    return bars


# ───────────────────────────── Rechnung ─────────────────────────────
def pre_tax_eur(ret_pct):
    return NOTIONAL * ret_pct / 100 - 2 * FEE - NOTIONAL * FRICTION / 100


def is_event(b, i, gap, volx):
    if i < 21:
        return False
    prev, day = b[i - 1], b[i]
    avg_v = statistics.fmean(x["v"] for x in b[i - 20:i])
    avg_dv = statistics.fmean(x["v"] * x["c"] for x in b[i - 20:i])
    return (day["o"] >= prev["c"] * (1 + gap / 100) and day["c"] >= day["o"]
            and avg_v > 0 and day["v"] >= volx * avg_v and day["c"] >= 5 and avg_dv >= 5e6)


def simulate(b, i, target, hold, use_stop):
    """Einstieg Eröffnung i+1. Liefert Ergebnis oder None (zu wenig Folgetage)."""
    if i + hold >= len(b):
        return None
    entry = b[i + 1]["o"]
    stop = b[i]["l"] * 0.995 if use_stop else None
    tgt = entry * (1 + target / 100)
    if stop is not None and stop >= entry:
        return None
    mae = 0.0
    for k in range(i + 1, i + 1 + hold):
        bar = b[k]
        mae = min(mae, (bar["l"] / entry - 1) * 100)
        if stop is not None and bar["l"] <= stop:
            px = min(stop, bar["o"])  # Gap unter den Stop: Verkauf zur Eröffnung
            return dict(ret=(px / entry - 1) * 100, days=k - i, exit="Stop", mae=mae)
        if bar["h"] >= tgt:
            px = max(tgt, bar["o"])   # Gap über das Ziel: Verkauf zur Eröffnung
            return dict(ret=(px / entry - 1) * 100, days=k - i, exit="Ziel", mae=mae)
    last = b[i + hold]
    return dict(ret=(last["c"] / entry - 1) * 100, days=hold, exit="Zeit", mae=mae)


def summarize(name, trades):
    if not trades:
        print(f"\n{name}: keine Trades."); return None
    n = len(trades)
    eur = [pre_tax_eur(t["ret"]) for t in trades]
    by_year = {}
    for t, e in zip(trades, eur):
        by_year.setdefault(t["date"][:4], []).append(e)
    tax = sum(max(0.0, sum(v)) * TAX / 100 for v in by_year.values())  # Jahressaldo
    net_total = sum(eur) - tax
    hits = sum(1 for t in trades if t["exit"] == "Ziel")
    print(f"\n{name}")
    print(f"  Trades {n} · Ziel erreicht {hits / n * 100:.1f} % · Stop {sum(t['exit']=='Stop' for t in trades)/n*100:.1f} %"
          f" · Zeitausstieg {sum(t['exit']=='Zeit' for t in trades)/n*100:.1f} %")
    print(f"  Ø Rendite je Trade {statistics.fmean(t['ret'] for t in trades):+.2f} % · Median {statistics.median(t['ret'] for t in trades):+.2f} %"
          f" · Ø Tiefpunkt zwischendurch {statistics.fmean(t['mae'] for t in trades):.1f} %")
    print(f"  Ø Netto je Trade nach Kosten und KESt {net_total / n:+.0f} EUR · Summe {net_total:+,.0f} EUR")
    print("  je Jahr (vor Steuer): " + " · ".join(f"{y} {sum(v):+,.0f} EUR ({len(v)})" for y, v in sorted(by_year.items())))
    return dict(n=n, per_trade=net_total / n, hit=hits / n, years=[sum(v) > 0 for v in by_year.values()])


# ───────────────────────────── Ablauf ─────────────────────────────
def main():
    ap = argparse.ArgumentParser(description="FusionPulse Rückwärtstest")
    ap.add_argument("--years", type=int, default=3)
    ap.add_argument("--limit", type=int, default=2500, help="max. Anzahl Aktien")
    ap.add_argument("--gap", type=float, default=5.0, help="Mindest-Kurssprung zur Eröffnung in %")
    ap.add_argument("--volx", type=float, default=2.0, help="Mindest-Umsatzvielfaches")
    ap.add_argument("--target", type=float, default=5.0, help="Kursziel in % (>= 2,04 für 120 EUR netto)")
    ap.add_argument("--hold", type=int, default=10, help="max. Haltedauer in Handelstagen")
    ap.add_argument("--tickers", help="eigene Liste, ein Symbol je Zeile")
    ap.add_argument("--demo", action="store_true", help="synthetische Daten, kein Tiingo")
    a = ap.parse_args()

    start = (date.today() - timedelta(days=365 * a.years + 40)).isoformat()
    if a.demo:
        syms = [f"DEMO{i}" for i in range(min(a.limit, 300))]
        fetch = lambda s: demo_prices(s)
    else:
        token = os.environ.get("TIINGO_API_TOKEN") or input("Tiingo API-Token: ").strip()
        if not token:
            sys.exit("Ohne Token geht es nicht.")
        syms = load_universe(a.years, a.limit, a.tickers)
        fetch = lambda s: load_prices(s, token, start)

    print(f"{len(syms)} Aktien · {a.years} Jahre · Sprung >= {a.gap} % · Umsatz >= {a.volx}x · "
          f"Ziel {a.target} % · max. {a.hold} Tage")
    series, done = {}, 0
    with ThreadPoolExecutor(max_workers=1 if a.demo else 6) as ex:
        futs = {ex.submit(fetch, s): s for s in syms}
        for f in as_completed(futs):
            done += 1
            bars = f.result()
            if bars and len(bars) > 60:
                series[futs[f]] = bars
            if done % 100 == 0 or done == len(syms):
                print(f"  Kurse geladen {done}/{len(syms)}", end="\r", flush=True)
    print()

    rnd = random.Random(7)
    ev = {"A": [], "B": []}; base = {"A": [], "B": []}; rows = []
    for sym, b in series.items():
        idx = [i for i in range(len(b) - a.hold - 1) if is_event(b, i, a.gap, a.volx)]
        pool = list(range(21, len(b) - a.hold - 1))
        for i in idx:
            for rule, st in (("A", False), ("B", True)):
                r = simulate(b, i, a.target, a.hold, st)
                if r:
                    r.update(sym=sym, date=b[i]["d"]); ev[rule].append(r)
                    rows.append(dict(regel=rule, symbol=sym, ereignis=b[i]["d"], **{k: round(v, 3) if isinstance(v, float) else v for k, v in r.items() if k not in ("sym", "date")}))
            for _ in range(3):  # drei Zufallstage je Ereignis, gleiche Aktie
                j = rnd.choice(pool)
                for rule, st in (("A", False), ("B", True)):
                    r = simulate(b, j, a.target, a.hold, st)
                    if r:
                        r.update(sym=sym, date=b[j]["d"]); base[rule].append(r)

    print("\n" + "=" * 78)
    ea = summarize(f"REGEL A · Ereignis · Ziel {a.target} %, kein Stop", ev["A"])
    za = summarize("REGEL A · ZUFALL (gleiche Aktien)", base["A"])
    eb = summarize("REGEL B · Ereignis · Stop unter Tagestief", ev["B"])
    zb = summarize("REGEL B · ZUFALL (gleiche Aktien)", base["B"])
    print("\n" + "=" * 78 + "\nURTEIL (vorab festgelegt: >= 150 Trades, >= +50 EUR netto je Trade,"
          "\n        mindestens 2/3 der Jahre positiv, und besser als Zufall)")
    for label, e, z in (("A", ea, za), ("B", eb, zb)):
        if not e or not z:
            print(f"  Regel {label}: zu wenig Daten"); continue
        ok = e["n"] >= 150 and e["per_trade"] >= 50 and sum(e["years"]) >= len(e["years"]) * 2 / 3 and e["per_trade"] > z["per_trade"] + 25
        print(f"  Regel {label}: {'BESTANDEN' if ok else 'NICHT BESTANDEN'} · Ereignis {e['per_trade']:+.0f} EUR je Trade gegen Zufall {z['per_trade']:+.0f} EUR")

    out = "fp_backtest_trades.csv"
    if rows:
        with open(out, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()), delimiter=";"); w.writeheader(); w.writerows(rows)
        print(f"\nAlle Einzeltrades: {os.path.abspath(out)} (öffnet in Excel)")
    if a.demo:
        print("\nDEMO: Zufallsdaten ohne Vorteil. Ein 'NICHT BESTANDEN' ist hier das erwartete Ergebnis.")


if __name__ == "__main__":
    main()
