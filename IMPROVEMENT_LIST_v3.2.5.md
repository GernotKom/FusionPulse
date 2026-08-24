# FusionPulse Verbesserungsliste v3.2.5

## In v3.2.5 umgesetzt
- v3.2.3 + v3.2.4 technisch fusioniert: robuster ETF-/Instrument-Filter plus Cloudflare-CPU-Entkopplung.
- Veraltete/falsch gecachte Instrument-Klassifikationen werden durch neue Cache-Generation verworfen.
- ETF-/Derivat-Filter gilt für IEX-Radar und BOATS-Kandidaten.
- Heatmap/Discovery zeigt nur verifizierte Common Stocks; keine rohen IEX-Kandidaten als scheinbar handelbare Aktien.
- Alte Discovery-Kandidaten aus früheren fehlerhaften Scans werden nicht endlos weitergetragen.
- Krypto-Cron erhält alle 5 Minuten exklusives CPU-Fenster; keine Aktien-/Alpaca-Schwerarbeit im selben Cron-Aufruf.
- Release Notes auf genau eine Datei reduziert.

## Bereits umgesetzt und beizubehalten
- „Alle Aktien“ zeigt tatsächlich analysierte/autonom entdeckte Aktien und nicht nur Favoriten.
- Aktienchart im großen Fenster auswählbar: 5 / 10 / 30 / 60 / 120 / 180 / 240 / 300 Minuten.
- Datenquelle dynamisch: `Tiingo IEX, US-Markt`; nur bei echtem Fallback `Twelve Data (Fallback), US-Markt`.
- ETFs/ETPs/ETNs sowie gehebelte/inverse Fondsprodukte nicht im normalen Long-Aktien-Daytrading zulassen.
- Fehlende/stale/schlechtere Daten dürfen ein Setup niemals verbessern; Discovery 0 % BUY-Gewicht; BUY nur bei ausreichender Qualität/Handelbarkeit und Netto-CRV > 3:1.

## Offen / nächster Patch
- Timer oben prüfen: „Nächster 5m-Takt“ darf nicht auf den 2-Minuten-Deep-Scan-Countdown zeigen. Datentakt und Scan-Takt klar trennen.
- Whole-Market-Radar anhand realer Sessions kalibrieren: frühe Runner erkennen, späte Chaser/Pennies/Illiquidität begrenzen.
- D1-Radar-Gedächtnis bei Bedarf auf explizite 1/3/5/15-Minuten-Sequenzen erweitern.
- BOATS -> Premarket -> Opening -> Regular Session als explizite Session-Sequenz im Learning speichern.
- Opportunity-Reife/„Warum jetzt?“ gegen reale Outcomes kalibrieren.
- Twelve Data erst nach mehreren stabilen Tiingo-Sessions weiter reduzieren.
- NYSE Half-Days/Sonderzeiten weiter härten.
- **Shooting / Short Radar prüfen:** gehebelte Short-/Inverse-Produkte NICHT einfach in den bestehenden Long-Scanner mischen. Eigene Registerkarte bzw. eigener Short-Workflow evaluieren. Für Short-Setups Elliott/Trend/Momentum/CRV spiegelbildlich und explizit short-seitig definieren; Underlying-Aktie bevorzugt analysieren, gehebeltes Produkt höchstens als Discovery-Sensor bzw. separat gekennzeichnetes Instrument. Vor Umsetzung eigener Safety-/Backtest-Check.
