# FusionPulse v3.1.0 – Release Notes (erste Entwicklungsfassung)

## Neu
- Aktien-Favoriten/Depot können per Drag & Drop neu angeordnet werden; Reihenfolge wird gespeichert.
- Aktienkarten erhalten einen Drag-Handle und eine persistente manuelle Reihenfolge.
- SIGNAL-INFO ist als permanente untere Leiste umgesetzt. Der letzte Signalhinweis bleibt sichtbar; nur die Karten-Hervorhebung läuft weiterhin zeitlich aus.
- Tiingo Power + BOATS als isolierter serverseitiger Datenlayer vorbereitet.
- Neuer Diagnose-/Snapshot-Endpunkt: `/api/tiingo/boats?symbols=AAPL,NVDA,...`.
- `TIINGO_API_TOKEN` bleibt ausschließlich Cloudflare-Secret und wird nie ins Frontend/GitHub geschrieben.
- `/api/health` zeigt, ob Tiingo konfiguriert ist.

## Noch bewusst nicht verbunden
- Tiingo beeinflusst BUY, Score, CRV und Executability noch nicht.
- Breiter BOATS-US-Discovery-Scan und serverseitiger Cache folgen nach Live-Validierung des Entitlements.
- Twelve Data und Alpaca bleiben unverändert aktiv.

## Stabilitätsregel
Fehlende, veraltete oder schlechtere Daten dürfen ein Setup niemals verbessern. Discovery erzeugt keinen BUY.

## VL development pass – 2026-08-24
- Stock rows now open the selected symbol in the large upper stock focus view.
- Large stock focus includes an intraday 5-minute chart derived from already fetched bars (no extra request).
- Coin detail view includes the available short-term/intraday price chart.
- Persistent bottom SIGNAL-INFO and reorderable stock/favourite UI retained.
- Added `IMPROVEMENT_LIST_v3.1.0.md` as the parallel VL ledger for remaining diagnostics before audit/deploy.
- VL Runde 2: Stock cards now distinguish refreshed-this-cycle from cached/stale/unavailable data; favorite priority no longer visually implies equal live coverage.
- Twin badge now exposes D1 vs local provenance to explain differing sample counts.
- Crowd refresh clears requested symbols before applying the latest response, preventing stale crowd values from masquerading as current data.
- Added `/api/tiingo/status` for isolated token authentication testing without requiring BOATS entitlement.
