# FusionPulse v3.1.0 – Tiingo Power + BOATS Implementierungsplan

## Aktueller Stand
- Basis: v3.0.12.
- Tiingo wird zunächst **parallel** zu Twelve Data und Alpaca eingebunden.
- Neuer isolierter Worker-Endpunkt: `/api/tiingo/boats?symbols=AAPL,NVDA,...`.
- Secret ausschließlich serverseitig als `TIINGO_API_TOKEN`.
- Noch **keine** Tiingo-Daten im BUY-Score.

## Datenrollen
1. BOATS 20:00–03:59 ET: Overnight Discovery, Top-of-Book, Last Trade, Overnight-OHLC.
2. Tiingo Power/IEX bzw. Equity Realtime: Kandidaten-Plausibilisierung und spätere Regular-/Extended-Hours-Ergänzung.
3. Twelve Data bleibt vorerst als bestehender Deep-Scan-Fallback.
4. Alpaca/IEX bleibt vorerst für Opening Momentum.

## Geplante Reihenfolge
1. Token/Entitlement setzen und isolierten BOATS-Endpunkt gegen echte Symbole testen.
2. Antwortfelder und Aktualität validieren; 0 strikt von fehlenden Daten trennen.
3. Discovery-Cache im Worker einführen, damit nicht pro Browser-Refresh der Gesamtmarkt geladen wird.
4. Breiten BOATS-Snapshot serverseitig filtern (Gap, ungewöhnliche Bewegung/Volumen, Spread, Liquidität).
5. Nur Top-Kandidaten an den bestehenden Deep Scan übergeben.
6. Datenherkunft/Zeitstempel im Frontend anzeigen.
7. Sequenz-Learning Overnight → Crowd → Premarket → Opening erweitern.
8. Erst nach Paralleltest entscheiden, welche Twelve-Data-Aufgaben entfallen können.

## Kosten / Limits (Stand 24.08.2026)
- Power Individual: 30 USD/Monat oder 300 USD/Jahr.
- BOATS Add-on: +9 USD/Monat.
- Summe Individual: 39 USD/Monat.
- Power API: 10.000 Requests/Stunde, 100.000/Tag, 40 GB/Monat.
- BOATS: 12.000+ quotierbare US-Aktien, REST + WebSocket.

## Sicherheitsregel
Fehlende, stale oder qualitativ schlechtere Tiingo-Daten dürfen ein Setup niemals verbessern. Discovery erzeugt keinen BUY.

## Authentication smoke test
`/api/tiingo/status` calls Tiingo `/api/test/` server-side with `TIINGO_API_TOKEN`. It verifies only that the secret is present and accepted. It deliberately does not claim BOATS access. BOATS entitlement is tested separately only after subscription/activation.
