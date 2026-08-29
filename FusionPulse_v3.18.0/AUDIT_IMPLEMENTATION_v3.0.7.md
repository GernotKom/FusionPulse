# FusionPulse v3.0.7 – Umsetzung des v3.0.6-Audits

## P1 umgesetzt
- P1-1 Aktiensuche: kurze/generische Substring-Treffer beseitigt.
- P1-2 prepost-Fallback: Credits/API-Key lösen keinen zweiten Request aus.
- P1-3 Extended-Hours-Semantik für Lookup und Zyklus vereinheitlicht.
- P1-4 Aktien-Cache enthält Komponenten-/minCRV-Signatur.
- P1-5 New-York-Intl-Formatter auf Modulebene wiederverwendet.
- P1-6 Learning-Cache stabilisiert und D1-Lesevolumen reduziert.
- P1-7 Aktien-Learning/History explizit auf Twelve Data; Alpaca als asset_type=opening; Outcome-Resolver quellen-/asset-spezifisch.
- P1-8 Aktien-Hover über delegierten 2,3-s-Handler; kein sofortiges focus-within.

## Zusätzlich umgesetzt
- Live-Routen /api/scan und /api/stocks: no-store.
- Krypto-D1-Warmcache-Schreiben gedrosselt.
- Alpaca-D1-Persistierung auf 5-Minuten-Takt.
- Heatmap-/Opening-Klick fokussiert ohne versteckten Dauerfilter.
- Aktien-executability serverseitig gespeichert; unbekanntes RVOL bleibt null/n. v.
- Relative Stärke null bleibt null; micro-Modus behandelt unbekannten Spread neutral.
- Ungültige Candle-Zeitstempel werden verworfen.
- Doppelberechnung im Krypto-Zweitpass reduziert.
- Force-Scan und Response-Reihenfolge robuster.
- Countdown als „Nächster 5m-Takt“ beschriftet.
- Maskable-Icon in Service-Worker-Precache aufgenommen.
- Versions-Sync und User-Agent auf APP_VERSION vereinheitlicht.

## Bewusst nicht geändert
- BUY-Regeln und Schwellen.
- +5 % / 180-Minuten-Outcome-Kalibrierung.
- Kein Yahoo-Finance-Fallback.
- Kein SIP-Abo vorausgesetzt; ALPACA_FEED bleibt standardmäßig iex.
