# FusionPulse v3.0.5 – Hotfix

## Produktions-Hotfix nach v3.0.4

- Krypto-Hauptstatus zeigt bei bereits bestätigter Bitpanda-Verbindung nicht mehr dauerhaft „Verbinde…“, sondern „Bitpanda verbunden · erster Scan läuft…“, bis der Scan abgeschlossen ist.
- Aktien-Suche nutzt weiterhin den lokalen schnellen Katalog, fällt bei unbekannten Namen/Tickern aber auf Twelve Data `/symbol_search` zurück.
- Direkte Aktien-Lookups verwenden `prepost=true`, damit Extended-Hours-Daten bei der Einzelanalyse mit einbezogen werden können.
- Opening-Momentum-Karten sind anklickbar und laden den gewählten Ticker direkt in den Aktienradar.
- Keine Änderung der BUY-Regeln, des Learning-Modells, der D1-Schemata oder des Cron-Rhythmus.

## Prüfung

- `npm run sync-version`: bestanden
- `npm run check`: bestanden
- Versionsstand in Worker, Frontend, Service Worker, HTML und wrangler.jsonc: 3.0.5
