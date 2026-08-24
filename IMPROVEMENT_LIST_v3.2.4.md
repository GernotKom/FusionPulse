# FusionPulse Verbesserungsliste v3.2.4

## In v3.2.4 umgesetzt
- P0 Cloudflare CPU-Limit: Whole-Market-Bulk-Radar und Deep Scan laufen nicht mehr im selben Cron-Aufruf.
- P0 PWA/Browser entkoppelt: normale Aktienabfragen lesen den serverseitig persistierten Scan statt einen parallelen Deep Scan zu starten.
- ETF-/Instrumentprüfung aus dem Bulk-Radar herausgelöst und auf die kleine Deep-Scan-Kandidatenmenge begrenzt.
- Release-Notes reduziert: künftig nur eine Datei `RELEASE_NOTES.md`.

## Bereits umgesetzt und beizubehalten
- „Alle Aktien“ zeigt tatsächlich analysierte/autonom entdeckte Aktien und nicht nur Favoriten.
- Aktienchart im großen Fenster auswählbar: 5 / 10 / 30 / 60 / 120 / 180 / 240 / 300 Minuten.
- Datenquelle dynamisch: `Tiingo IEX, US-Markt`; nur bei echtem Fallback `Twelve Data (Fallback), US-Markt`.
- ETFs/ETPs/ETNs sowie gehebelte/inverse Fondsprodukte nicht als Daytrading-Aktien zulassen.
- Fehlende/stale/schlechtere Daten dürfen ein Setup niemals verbessern; Discovery hat 0 % BUY-Gewicht; BUY nur bei ausreichender Qualität/Handelbarkeit und Netto-CRV > 3:1.

## Offen / nächster Patch
- Timer oben prüfen: Beschriftung „Nächster 5m-Takt“ darf nicht auf einen ~1:55-Countdown des 2-Minuten-Deep-Scans zeigen. 5-Minuten-Kerzentakt und 2-Minuten-Radar/Deep-Scan-Takt klar trennen und korrekt beschriften.
- Whole-Market-Radar anhand realer Sessions kalibrieren: frühe Runner erkennen, späte Chaser/Pennies/Illiquidität begrenzen, ohne BUY-Gates zu lockern.
- D1-Radar-Gedächtnis bei Bedarf auf explizite 1/3/5/15-Minuten-Sequenzen erweitern.
- BOATS -> Premarket -> Opening -> Regular Session als explizite Session-Sequenz im Learning speichern.
- Opportunity-Reife/„Warum jetzt?“ gegen reale Outcomes kalibrieren.
- Twelve Data erst nach mehreren stabilen Tiingo-Sessions weiter reduzieren.
- NYSE Half-Days/Sonderzeiten weiter härten.
