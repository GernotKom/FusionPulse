# FusionPulse Release Notes

## v3.2.4 — Cloudflare CPU Hotfix
- P0: Whole-Market-Radar und Deep Scan auf getrennte Cron-Minuten verteilt. Ungerade Minute: Tiingo-IEX-Bulk-Radar; gerade Minute: Deep Scan aus dem persistierten Radar.
- P0: Die PWA startet den teuren autonomen Aktien-Scan nicht mehr parallel. Normale `/api/stocks`-Abfragen lesen den letzten serverseitigen D1-Batch.
- P0: ETF/ETP/Common-Stock-Verifikation aus dem Whole-Market-Bulk-Radar herausgelöst und erst vor dem Deep Scan auf der kleinen Kandidatenmenge ausgeführt.
- Instrument-Metadatenprüfung auf maximal 24 Top-Kandidaten und 4 parallele Prüfungen begrenzt.
- ETF/ETP/ETN, gehebelte/inverse Fondsprodukte, Warrants, Units, Rights und Preferreds bleiben vom Aktien-Deep-Scan ausgeschlossen.
- BUY-, Score-, CRV-, Freshness- und Datenqualitäts-Gates unverändert.
- Release-Dokumentation gemäß VL konsolidiert: nur noch diese eine `RELEASE_NOTES.md`.

## Aktueller Funktionsstand aus v3.2.1–v3.2.3
- Tiingo IEX Primary + BOATS Discovery mit 0 % BUY-Gewicht.
- Whole-Market-Discovery, adaptive 20er Deep-Scan-Queue, Pre-Signal-Reife und „Warum jetzt?“.
- „Alle Aktien“ zeigt autonome Kandidaten statt nur Favoriten.
- Dynamische Datenquellenanzeige Tiingo IEX / Twelve Data Fallback.
- Aktienchart-Zeiträume 5/10/30/60/120/180/240/300 Minuten.
