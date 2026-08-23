# FusionPulse v2

Scanner für Momentum, Einstiegszonen und Ausführbarkeit auf Bitpanda Fusion (EUR-Paare).
Cloudflare Worker als API-Proxy + PWA-Frontend. Der API-Key verlässt den Server nie.

## Was sich gegenüber v1 geändert hat

**Kritische Fehler behoben**
| Problem | Wirkung | Lösung |
|---|---|---|
| `index.html` lud `/static/app.js`, Assets liegen aber unter `/` | weiße Seite, App war nicht lauffähig | Pfade korrigiert |
| `manifest` ohne Icons | Chrome zeigte kein "App installieren" | 192/512/maskable erzeugt |
| ~70 Subrequests pro Scan | Free-Plan-Limit ist 50 → harter Fehler | Budget auf ~32 gesenkt |
| Alle 15 s × 70 Requests = 280/min | Fusion Market-Data-Limit ist 240/min → 429 | Serverseitiger Cache + Single-Flight |
| Neuer `AudioContext` pro Beep | Browser deckelt bei ~6 → Ton fällt aus | ein wiederverwendeter Context |
| Service Worker cachte `/api/*` | veraltete Kurse offline ausgeliefert | API vom Cache ausgenommen |
| Kein Overlap-Schutz beim Polling | Scans stapelten sich | `AbortController` + Lock |
| Signale auf der laufenden Kerze | Repainting: Signale erschienen und verschwanden | Auswertung nur auf geschlossenen Bars |

**Logik**
- Multi-Timeframe (5m/15m/1h) aus *einem* Request durch Resampling
- Momentum und Volumen als z-Scores, ATR-normiert → Coins sind vergleichbar
- Wilder-ATR statt naivem True-Range-Mittel
- Volumen-Baseline überlappungsfrei (v1 verglich 12 Bars gegen ein Fenster, das dieselben 12 enthielt)
- Kurzer VWAP (24 Bars) als Zonenanker, langer (78) als Regimefilter
- Orderbuch-Tiefe wird ausgewertet: Imbalance, Kauf-/Verkaufskapazität bis 0,15 % Slippage
- Echte Gebührenstufe über `/v1/account`, Kosten = 2× Fee + Spread + Slippage
- Stop ATR- und kostenbasiert (kein fixer Prozentwert), Ziele an Struktur
- Marktbreite (% über VWAP) als globaler Risk-On/Risk-Off-Filter
- `blockers`: jede Kachel erklärt, *warum* sie nicht grün ist

**Dashboard**
- Action-Rail mit den Top-3-Setups und Order-Plan in die Zwischenablage
- Einstiegs**zone** statt Einstiegspunkt, Rahmen leuchtet bei Preis in der Zone
- Positionsgröße aus Equity × Risiko %, gedeckelt auf die Orderbuchtiefe
- Countdown bis Schluss der 5m-Kerze
- Diff-Rendering statt `innerHTML`-Neuaufbau
- Alarme mit Hysterese (2 Scans) und 90-s-Cooldown
- Hotkeys, Wake Lock, Trade-Journal mit CSV-Export

## Deployment

1. Ordner in ein GitHub-Repo laden.
2. Cloudflare → Workers & Pages → Create application → Import repository → Deploy.
3. Settings → Variables and Secrets:
   - `FUSION_API_KEY` = Fusion-Key, **nur Read**
   - `APP_TOKEN` = frei gewähltes Passwort (sonst kann jeder mit der URL deine Rate-Limits verbrauchen)
4. Redeploy, `*.workers.dev` am Tablet öffnen, Token in ⚙ eintragen, "App installieren".

`GET /api/health` zeigt Konfiguration und Cache-Alter.

## Grenzen des Free Plans

50 externe Subrequests und 10 ms CPU pro Invocation. Der Scan liegt bei ~32 Subrequests
und ~15–40 ms CPU — je nach Paarzahl kann das über 10 ms gehen. Wenn im Log
`exceededResources` auftaucht: Tiefen-Scan in ⚙ reduzieren oder auf Workers Paid (5 $/Monat).
Auf `*.workers.dev` ist die Cache-API eingeschränkt; der In-Memory-Cache greift trotzdem.
Für einen Cache über Isolate-Grenzen hinweg optional ein KV-Namespace als `SNAP` binden.

## Hinweis

Kein Auto-Trading. Der Worker hat ausschließlich Lesezugriff und platziert keine Orders.
