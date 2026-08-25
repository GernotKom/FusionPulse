# FusionPulse Release Notes — v3.3.2

## v3.3.2 – Whole-Market-Sichtbarkeit & Live-Suche
- Opening Momentum liest bei fehlendem verifiziertem Deep-Scan-Cache direkt den persistenten Tiingo Whole-Market-Radar und verifiziert nur die kleine Top-Kandidatenmenge über den bestehenden Security-Metadaten-Cache. Kein zusätzlicher schwerer /iex-Bulk-Scan aus der PWA.
- Whole-Market-Radar zeigt jetzt verifizierte Kandidaten unabhängig davon, ob sie bereits +2 % Market-Gainer sind; Favoriten werden mit ★ kenntlich gemacht.
- Filterbezeichnung präzisiert: „Alle analysierten Aktien“ statt missverständlichem „Alle Aktien“.
- Aktiensuche zeigt Treffer bereits während der Eingabe (280-ms-Debounce, maximal fünf Vorschläge); Return bleibt zum vollständigen Laden/Analysieren.
- BUY-Gates, Elliott-first, Netto-CRV und Safety-Regeln unverändert.


## Schwerpunkt
Stabilisierungsrelease nach dem ersten Live-Test von v3.3.0. Keine Änderung an BUY-Gates, Elliott-first, CRV oder Safety-Regeln.

## Behoben / verbessert
- **Opening Momentum breiter:** Kandidaten werden bevorzugt aus dem bereits serverseitig verifizierten Tiingo-IEX-Whole-Market-Radar des letzten Cron-Batches übernommen und mit Favoriten/Basiskatalog ergänzt. Die PWA startet dafür keinen zusätzlichen schweren Markt-Scan.
- **Aktien-Suche:** deutlich sichtbarer, X zum Löschen, direkter Treffer-Preview; nach erfolgreicher Suche wird der Suchtext automatisch geleert, damit er nicht unbemerkt als Filter stehen bleibt.
- **Signal-Herkunft:** Aktien-/Coin-Signale bleiben mit Ticker, Signalart und Uhrzeit im Footer sichtbar und überleben einen Browser-Neustart, bis sie mit ✓ quittiert werden. Die 5-Minuten-Hervorhebung der Karte bleibt davon getrennt.
- **Funktionalitätsampel:** Krypto, Aktien, Tiingo und Cloudflare sind verständlich beschriftet. Gesamtstatus nutzt einheitlich Grün/Gelb/Orange/Rot und sagt ausdrücklich, ob Handlungsbedarf besteht.
- **Opening/Market-Richtung:** steigende Kandidaten werden grün, fallende rot hervorgehoben.
- **Google Finance:** direkter Link aus Aktien-Fokus und Aktienzeile; öffnet in neuem Tab/Fenster.
- **Refresh-Erklärung:** der blaue Refresh lädt den neuesten verfügbaren Stand; der schwere Whole-Market-/Deep-Scan bleibt CPU-schonend serverseitig und wird nicht parallel aus der PWA gestartet.

## Safety unverändert
- Elliott-Wellenanalyse bleibt struktureller Ausgangspunkt der Aktienanalyse.
- Radar, Opening Momentum, Market Gainer, Extended Hours und Crowd bleiben Discovery/Context mit 0 % direktem BUY-Gewicht.
- BUY nur bei ausreichender Qualität, zulässigen/frischen Daten und Netto-CRV > 3:1.
- Fehlende oder schlechtere Daten dürfen ein Setup niemals verbessern.

- UX-Nachschärfung: Aktienblock vor Krypto; im Krypto-Bereich Übersicht vor Detailfenster.
- Momentum-/Opening-Prozentwerte farbcodiert und Karten dezent grün/rot hinterlegt.
- Google-Finance-Link im großen Aktienfenster deutlich sichtbar.
