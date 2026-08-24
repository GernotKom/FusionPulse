# FusionPulse v3.0.11

Momentum- und Einstiegszonen-Scanner für Bitpanda Fusion (EUR) plus US-Aktienradar über Twelve Data und Alpaca. Läuft als PWA auf einem Cloudflare Worker. Keine Order-Automatik — FusionPulse liefert Trade-Pläne, ausgeführt wird manuell.

## Datenquellen

- **Krypto:** Bitpanda Fusion; serverseitiger Cron-Scan, die PWA muss dafür nicht geöffnet sein.
- **Aktien-Radar und Suche:** Twelve Data. Extended Hours werden genutzt, sofern der Tarif sie freigibt; sonst sauberer Intraday-Fallback.
- **Opening/Premarket Momentum:** Alpaca. Standard `ALPACA_FEED=iex`; SIP ist vorbereitet, aber nicht erforderlich für v3.0.8.
- **Learning/Health:** Cloudflare D1. Aktien-Learning trennt Twelve Data jetzt explizit von Alpaca Opening-Daten.

## Neu in v3.0.8

- **Twelve-Data-Quota-Hotfix:** Der automatische Aktienradar-Scan nutzt vier Teilgruppen (6/5/5/5) statt das Minutenkontingent auszureizen.
- **Kein doppelter Extended-Hours-Batch:** Der automatische Radar-Scan nutzt Regular-Hours-Daten; Premarket/Opening bleibt bei Alpaca. Dadurch entfällt die teure `prepost=true`-Fallback-Doppelabfrage.
- **429 ohne leeres Radar:** Bei Rate-Limit bleiben bereits geladene Aktien in der PWA sichtbar; der nächste Teilscan setzt automatisch fort.
- **Manuelle Aktiensuche unverändert:** Die funktionierende Suche bleibt bewusst unangetastet.

- Aktiensuche bei kurzen/generischen Eingaben korrigiert; eindeutige Ticker bleiben lokal, sonst wird die Live-Suche genutzt.
- Twelve-Data-`prepost`-Fallback verdoppelt bei Credit-/API-Key-Problemen keine Requests mehr.
- Aktien-Zyklus und Einzel-Lookup verwenden konsistente Extended-Hours-Semantik.
- Aktien-Cache berücksichtigt aktive Komponenten und Mindest-CRV.
- Alpaca-Zeitformatierung deutlich CPU-schonender; Opening-D1-Schreiben auf 5-Minuten-Takt reduziert.
- `/api/learning` stark entlastet und Cache stabilisiert; Aktien-Learning/History nutzt Twelve Data als definierte Quelle.
- Aktien-Hover-Detail öffnet zuverlässig erst nach 2,3 Sekunden ruhigem Hover und nicht mehr sofort durch Fokus/Scrollen.
- Heatmap-Klick fokussiert eine Aktie ohne versteckten Dauerfilter.
- Live-Scan-Routen sind `no-store`; erzwungene Coin-Scans können einen laufenden Poll wirklich ersetzen.
- Unbekannte Messwerte bleiben `null`/„n. v.“ statt als scheinbar gemessene 0 oder 1 ausgegeben zu werden.
- Krypto-Warmcache-Schreiblast gedrosselt; doppelte Krypto-Analyse ohne Orderbuch vermieden.
- Countdown oben ist jetzt als **„Nächster 5m-Takt“** beschriftet.
- Versionsführung vollständig auf v3.0.8 synchronisiert.

## Versionierung

`package.json` ist die verbindliche Versionsquelle. `npm run sync-version` synchronisiert Worker, Frontend, Service Worker, HTML und Wrangler-Konfiguration. README und Release Notes werden bei jedem Release zusätzlich inhaltlich geprüft.

## Alpaca Feed umstellen

Standard:

```json
"ALPACA_FEED": "iex"
```

Nach Aktivierung eines Alpaca-Tarifs mit SIP-Zugriff:

```json
"ALPACA_FEED": "sip"
```

Danach neu deployen. Die vorhandenen `ALPACA_API_KEY_ID` und `ALPACA_API_SECRET_KEY` bleiben bestehen.

## Checks

```bash
npm install
npm run sync-version
npm run check
```
