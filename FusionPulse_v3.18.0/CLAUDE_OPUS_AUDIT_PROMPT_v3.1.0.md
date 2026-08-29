# Claude OPUS Audit Auftrag – FusionPulse v3.1.0 Development

Prüfe die vollständige ZIP als unabhängiger Senior-Code-/Regression-Auditor. Keine Neuentwicklung und keine kosmetischen Refactorings ohne zwingenden Grund.

Priorität P0/P1:
1. Regressionen gegenüber v3.0.12: Krypto/Bitpanda, Aktienradar, Opening Momentum/Alpaca, Suche, Favoriten, Heatmap, Signaltöne, BUY/CRV/Executability.
2. Sicherheitsinvariante: fehlende, stale oder qualitativ schlechtere Daten dürfen niemals Score, BUY oder positiven Signalton verbessern. WATCH bleibt akustisch stumm; rote Ampel blockiert positiven Ton.
3. Tiingo: Secret ausschließlich serverseitig; `/api/tiingo/status` nur Auth-Test; BOATS isoliert; noch 0 % BUY-Einfluss. Prüfe aktuelle Endpoint-Annahmen und Cloudflare-Worker-Eignung.
4. Premarket/Alle Aktien: prüfe Favoriten-Priorisierung und neue Datenstatus-Kennzeichnung. Keine gecachte Karte darf wie ein in dieser Runde aktualisierter Titel erscheinen.
5. Twin Learning: prüfe D1-Symbolzuordnung, Begrenzung der tief geladenen Aktien, n=12-Logik und D1/local-Provenienz. Keine globale oder fremde Sample-Zuordnung.
6. Crowd: echte 0 vs keine Daten; stale Crowd-Werte dürfen nicht fortgeschrieben werden; Crowd und Crowd→Markt haben 0 % direktes BUY-Gewicht.
7. UI-VL: Klick Aktienliste -> großes Fenster; Intraday-Charts Aktie/Coin; persistentes Drag&Drop; permanenter unterer Signalbanner.

Ausgabe bitte als Tabelle: Priorität (P0/P1/P2), Datei+Zeile/Funktion, Befund, konkrete Auswirkung, minimal-invasive Korrektur. Danach ein Go/No-Go für einen Release Candidate. Keine Änderung der Trading-Schwellenwerte ohne nachgewiesenen Bug.
