# FusionPulse v3.0.6 – Stabilitäts- und Premarket-Update

## Änderungen

- Persistenter Krypto-Warmstart aus D1 nach Deploy/Cold Start.
- PWA muss für serverseitige Bitpanda-Cron-Scans nicht offen sein.
- Startup verwendet vorhandenen Cron-Cache statt grundsätzlich einen Full-Scan zu erzwingen.
- Twelve-Data-Aktiensuche fällt bei nicht verfügbarem `prepost=true` automatisch auf reguläre Intraday-Daten zurück.
- Aktien-Heatmap-Kugeln sind anklickbar; Help-Cursor entfernt.
- Aktien-Mouseover-Detail öffnet erst nach 2,3 Sekunden.
- Alpaca Opening Momentum unterstützt konfigurierbar `iex` und `sip`.
- Opening-Momentum-Bars auf 5 Minuten umgestellt und auf 8 Stunden Historie erweitert; Premarket-High berücksichtigt 04:00–09:30 ET.
- README und Release-Dokumentation auf v3.0.6 bereinigt.

## Bewusst nicht umgesetzt

- Kein Yahoo-Finance-Scraping als Produktions-Fallback. Marktdatenquellen bleiben dokumentierte APIs.
- Keine Änderung der BUY-Regeln oder der Outcome-Kalibrierung.
