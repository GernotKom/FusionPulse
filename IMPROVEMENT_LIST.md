# FusionPulse Improvement List — Stand v3.4.0

## In v3.4.0 umgesetzt — Audit + VL
- P0 Fokusbindung: Radar/Momentum/Extended/Suche dürfen niemals still auf ersten/vorherigen Ticker zurückfallen; aktiver Fokus wird über Polls erhalten.
- P0 Lookup-Race/Mismatch: eigener Sequenz-Guard; kein Suchfeld als Transportkanal; Ticker-Mismatch fail-closed.
- P0 `regimeExplanation()` repariert; Risk-On/Off/VWAP-Mouseover wieder funktionsfähig, kein falscher Learning-Fehler als Kollateralschaden.
- P0 BUY-Freshness fail-closed: BUY nur bei `live` und bekannter Opening/Regular-Marktphase; fehlende/schlechtere Daten verbessern nie ein Setup.
- P0 Tiingo-Freshness: persistierte `refreshedSymbols` im Clientpfad durchgereicht.
- Fokusfenster: Quote/Freshness/Abfragezeit sichtbar + Refreshbutton nur für die Einzelaktie.
- Provider-/Frontend-Timeouts ergänzt; Aktien-Poll wird auch nach Fehler/Timeout wieder geplant.
- Crowd nicht mehr minütlich durch Opening Momentum; 20-Minuten-Zyklus.
- Chart-Cache TTL 120 s.
- Radar-Quote >30 min wird verworfen; Alpaca-Preisquelle intern gekennzeichnet.
- Fokus-Sprung unter Sticky Header korrigiert.
- VWAP-Text bei fehlender Volumenbasis korrekt „n. v.“.
- Service-Worker: kein unnötiger Reload beim ersten Claim.
- Opening Momentum: redundantes `· RADAR` entfernt; Updatezeit + 60-s-Intervall im Header.
- Learning-Fehler erklärt ausdrücklich Learning/D1 statt pauschal Verbindung.
- Safety-Regression um Audit-Guards erweitert.

## Bereits aus v3.3.x erhalten
- Whole-Market Radar unabhängig von Favoriten; Discovery 0 % BUY-Gewicht.
- Speed in Radar und Opening Momentum mit Mouseover; kein eigenständiges BUY-Signal.
- Google-Finance-Link im Aktienfokus.
- Netto-CRV, Strukturpotenzial und wirtschaftlich relevantes Mindest-Netto-Potenzial im Fokus.
- Unternehmensbeschreibung/Lead Program nur bei verifizierbarer Datenbasis.
- Chart-Zeiträume 5/10/30/60/120/180/240/300 min, 1T/5T/1Wo/3Mo/6Mo/12Mo auswählbar.
- Tiingo IEX Primary / Twelve Data Fallback dynamisch beschriftet.

## Weiter offen / nächste VL
- **Heatmap Aktien:** Kugeln sollen sich mit neuen Analysen sichtbar dynamisch bewegen; Trails/Positionierung und Lesbarkeit verbessern. Premarket kann naturgemäß weniger dynamisch sein, darf aber nicht wie eingefroren wirken.
- **Aktienchart Extended Hours:** echte Premarket-/After-Hours-Zeitreihe, Previous Close und Gap-%; Sessions optisch trennen; keine künstliche Linie über Datenlücken.
- **Header-Zähler:** grün/gelb/rot eindeutig nach Aktien und Coins differenzieren; aktueller Sammelzähler ist missverständlich.
- **Aktien-Status oben vs Aktienfeed-Premarket:** doppelte/ähnliche Statusanzeigen zusammenführen oder klar in „Systemverbindung“ vs „Marktdatenphase“ trennen; jeweils letzte Abfrage und Intervall anzeigen.
- **Twelve Data Kontingent:** „Kontingent unbekannt“ nicht als scheinbaren Fehler darstellen; bei fehlenden Providerheadern klar „Restkontingent vom Anbieter nicht geliefert“ und nur belastbare Eigenzählung zeigen.
- **Signal-/Planleiste unten:** nur bei echtem aktiven Plan/BUY-Signal anzeigen; niemals zufälligen/zuletzt selektierten Coin (z. B. PUMP) dauerhaft wie Empfehlung darstellen. Eindeutig „AKTIVER KRYPTO-PLAN“/„AKTIVER AKTIEN-PLAN“ beschriften.
- **Discovery-Beschreibung:** fachlicher Kontext präzisieren, z. B. Biotech-Discovery und Lead Candidate + Indikation nur wenn verifiziert.
- **Elliott/Struktur:** 30–180-min-Kontext für Intraday-Setups gezielt evaluieren; längere Ebene als Kontext, nicht als automatische Verbesserung. Keine Änderung der BUY-Schwellen ohne separaten Test.
- **Gewinnrelevanz:** grünes Setup darf nicht mit wirtschaftlich irrelevanter absoluter Gewinnchance erscheinen; bestehende Netto-Potenzial-/CRV-Gates weiter regressionsfest halten.
- **Risk/VWAP:** Mouseover nach Live-Deploy explizit prüfen (Audit-Fix ist im Code); Begriff „% über VWAP“ muss klar sagen, welche Grundgesamtheit gemeint ist.
- **Shooting/Short-Radar:** separat, erst nach stabiler Long-Version und externem Audit.
- **Learning-Bericht:** „Was wurde verpasst?“ ergänzen.
- **Liquideste Börse:** nur mit echten Venue-Volumendaten behaupten.
- **Cloudflare Kosten/Upgrade:** nur bei gemessener Nähe zu Limits oder wiederholten CPU-Problemen empfehlen.
