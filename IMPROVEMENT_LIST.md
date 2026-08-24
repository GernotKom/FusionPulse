# FusionPulse – Verbesserungsliste v3.2.6

## In v3.2.6 umgesetzt
- P0 ETF/ETN/ETP/Leveraged/Inverse-Produkte aus normalem Aktien-Daytrading-Pfad härter ausgeschlossen; Security-Cache auf neue Generation gesetzt und alte Discovery-Caches beim UI-Lesen fail-closed bereinigt.
- Bekannte Fehlklassifikationen CRWU/AXTU defensiv blockiert; Namens-/Metadaten-Gate bleibt primär.
- Starke US-Market-Gainer bei Eröffnung/Regular Session separat als reine Discovery-Liste sichtbar; nur verifizierte Common Stocks.
- Elliott-Wellenanalyse wieder explizit als zentrale Strukturachse der Deep-Scan-Priorisierung verstärkt. Momentum, RVOL, Spread, CRV und Freshness bestätigen, ersetzen Elliott aber nicht.
- Adaptive Deep-Scan-Queue reserviert Plätze für verifizierte Market-Gainer, ohne BUY-Gates zu lockern.
- Historical Twin transparenter: n = tatsächlich verwendete beste Twins (max. 12), zusätzlich verfügbare qualifizierte Fälle sichtbar (z.B. n=12/47).
- Bestehende Sicherheitsregeln unverändert: Discovery 0 % BUY-Gewicht; fehlende/schlechtere Daten dürfen nie verbessern; BUY nur bei ausreichender Qualität und Netto-CRV > 3:1.

## Weiter offen / beobachten
- Short/Shooting-Radar separat konzipieren; inverse/gehebelte Produkte nicht in Long-Scanner mischen.
- „Nächster 5m-Takt“ vs. 2-Minuten-Deep-Scan UI eindeutig trennen.
- BOATS → Premarket → Opening Learning anhand echter Outcomes kalibrieren.

## v3.2.7 Beobachtung / nächste Punkte
- ETF/ETN/ETP-Ausschluss live verifizieren; insbesondere CRWU und AXTU dürfen weder in Discovery, Heatmap noch Top-Aktie erscheinen.
- Market-Gainer-Liste zur US-Eröffnung weiter beobachten und auf verwertbare Einzelaktien kalibrieren.
- Elliott-Wellenanalyse bleibt zentrale Strukturachse; Momentum/RVOL/Technik bestätigen nur.
- Historical Twin: echte qualifizierte Fallzahl transparent darstellen und Unabhängigkeit/Qualität der Fälle weiter prüfen.
- Shooting/Short-Radar als getrennten Workflow prüfen; keine Vermischung mit Long-BUY-Logik.
- Countdown 5-Minuten-Takt vs. 2-Minuten-Deep-Scan eindeutig trennen.
