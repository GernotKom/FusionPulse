# FusionPulse Improvement List — Stand v3.3.1

## In v3.3.1 umgesetzt
- Opening Momentum an verifizierte Whole-Market-Radar-Kandidaten angebunden; statischer Basiskatalog nur noch Ergänzung/Fallback.
- Aktien-Suchfeld heller; X zum Löschen; Treffer-Preview; Suchtext nach erfolgreicher Suche automatisch leeren.
- Persistente Signal-Herkunft im Footer mit AKTIE/COIN, Ticker, Signalart, Uhrzeit und Quittierung.
- Einheitliche Funktionalitätsampel: Grün = stabil/kein Handlungsbedarf, Gelb = funktioniert mit kleiner Einschränkung, Orange = beobachten/zeitnah prüfen, Rot = konkreter Handlungsbedarf.
- Klar beschriftete Quellenstatus für Krypto, Aktien, Tiingo und Cloudflare statt kryptischer Punkte/T.
- Opening-/Momentum-Karten: Kursrichtung grün/rot schneller erkennbar.
- Direkter Google-Finance-Link bei Aktien, öffnet separat.
- Refresh-Tooltip präzisiert: PWA lädt neuesten Stand; schwerer Markt-/Deep-Scan bleibt serverseitig.

## Live-Test vor externem Audit
- Header/Funktionalitätsampel inkl. verständlichem Handlungsbedarf.
- Aktien/Krypto stabil; Whole-Market-Kandidaten sichtbar; keine ETF-Leaks.
- Opening Momentum zeigt auch automatisch nominierte Nicht-Favoriten.
- Signalton lässt sich eindeutig einem persistent sichtbaren Aktien-/Coin-Signal zuordnen.
- Nachtbericht, Extended Hours, Crowd und längere Charts prüfen.
- Cloudflare Logs auf wiederholte `exceededCpu`-Ereignisse prüfen.
- Erst bei stabilem RC den nächsten Claude/Opus-Audit durchführen.

## Weiter offen
- Shooting/Short-Radar separat und erst nach externem Audit produktivieren.
- Learning-Bericht um „Was wurde verpasst?“ erweitern.
- Liquideste Börse nur mit echten Venue-Volumendaten anzeigen.
- Cloudflare-Kosten-/Upgrade-Empfehlung nur bei tatsächlich gemessener Nähe zu Limits oder wiederholten CPU-Problemen.
