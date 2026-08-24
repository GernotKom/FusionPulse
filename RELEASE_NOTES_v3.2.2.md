# FusionPulse v3.2.2

## Hotfix: Common-Stocks-only im Whole-Market Radar

- ETFs, ETNs/ETPs, gehebelte/inverse Produkte und fondsartige Instrumente werden vor der Aktien-Deep-Scan-Queue ausgeschlossen.
- Tiingo-Suchmetadaten verifizieren Radar-Kandidaten als aktive Aktien; fondsartige Namen werden zusätzlich defensiv erkannt.
- Fail-closed: Kann der Instrumenttyp nicht verifiziert werden, gelangt der Kandidat nicht in den Aktien-Deep-Scan.
- Metadaten werden 7 Tage in Cloudflare D1 gecacht; maximal 20 neue Metadatenprüfungen pro Radar-Lauf und höchstens 6 parallel, um das Worker-Subrequest-Budget zu schützen.
- Radar/Discovery bleibt 0 % BUY-Gewicht; BUY-, CRV- und Datenqualitätsregeln bleiben unverändert.

## Tests

- JavaScript-Syntax: OK
- Safety Regression Suite inkl. neuer Common-Stock-Gates: OK
- Tiingo Primary bleibt aktiviert.
