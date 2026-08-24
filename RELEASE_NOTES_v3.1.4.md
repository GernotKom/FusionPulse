# FusionPulse v3.1.4

## Tiingo Test-first / Primary-ready
- Neuer read-only Endpoint `/api/tiingo/validate?symbols=AAPL,NVDA,TSLA` testet Auth, IEX-Snapshot, EUR/USD und 5-Minuten-Historie mit maximal drei Symbolen.
- Testlauf hat 0 % Einfluss auf BUY/Score und verändert den produktiven Aktienpfad nicht.
- `TIINGO_STOCKS_MODE` ist standardmäßig `shadow`. Erst nach erfolgreicher Validierung auf `primary` setzen.
- Im Modus `primary` nutzt `/api/stocks` Tiingo IEX für 5-Minuten-Aktienbars und Tiingo FX für EUR/USD; Twelve Data bleibt unangetasteter Fallback.
- Maximal fünf Deep-Scan-Titel je Tiingo-Batch, serverseitiger Cache.
- Bestehende BUY-/CRV-/Freshness-/Opportunity-Gates unverändert.

## Testablauf
1. v3.1.4 deployen, `TIINGO_STOCKS_MODE=shadow` belassen.
2. `/api/tiingo/validate?symbols=AAPL,NVDA,TSLA` aufrufen.
3. Nur wenn `state=ok`, Daten aktuell und `volumeKnown=true`: Power aktivieren bzw. bestätigen.
4. Danach Cloudflare Variable `TIINGO_STOCKS_MODE=primary` setzen.
5. `/api/stocks?force=1` prüfen; erst danach regulären Betrieb freigeben.

BOATS bleibt separat und wird erst nach Entitlement-Test in Discovery eingebunden.
