# FusionPulse Improvement List — Stand v3.3.4

## In v3.3.4 zusätzlich umgesetzt

- Radar → Deep Scan: marktweite Kandidaten vor Cache-Rechecks priorisiert; verifizierte Nicht-Favoriten bleiben zwischen Zyklen sichtbar.
- Radar-/Opening-/Extended-Hours-Karten laden beim Klick fehlende Deep-Analyse direkt und öffnen anschließend das große Aktienfenster.

## In v3.3.3 zusätzlich umgesetzt
- Whole-Market-Radar-Fallback aus verifizierten Opening-Radar-Kandidaten; persistente Übergabe an den autonomen Deep Scan.
- Favoritenrotation im Deep Scan, damit nicht dauerhaft nur die ersten zwei Favoriten frisch gerechnet werden.
- Health-Ampel an persistente echte Provider-/Freshness-Bestätigungen gekoppelt; Tooltip erklärt Grau/Blinken und alle Farben.
- Google Finance öffnet bei bekanntem Primary Listing direkt den aktuell ausgewählten Ticker.

## In v3.3.2 umgesetzt
- Whole-Market-Radar sichtbar auch ohne +2-%-Gainer-Schwelle; Favoriten klar getrennt markiert.
- Opening Momentum erhält robusten persistenten Radar-Fallback und zeigt Herkunft (RADAR/Favorit).
- Aktiensuche mit Live-Treffervorschau während der Eingabe; Return lädt die vollständige Analyse.
- „Alle Aktien“ sprachlich zu „Alle analysierten Aktien“ präzisiert.


## In v3.3.2 umgesetzt
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

- Momentum-/Opening-/Extended-Hours-Prozentwerte selbst grün/rot; Karten zusätzlich dezent richtungsabhängig hinterlegt.
- Hauptreihenfolge: Aktien als erster Block, Krypto als zweiter Block. Im Krypto-Bereich zuerst Coin-Tabelle, danach großes Coin-Fokusfenster.
- Google-Finance-Link im großen Aktien-Detailfenster prominent und eindeutig beschriftet; öffnet in neuem Tab.
