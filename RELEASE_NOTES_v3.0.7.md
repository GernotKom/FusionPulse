# FusionPulse v3.0.7 – Stabilitäts- und Konsistenzrelease

## Grundlage

Dieses Release setzt die bestätigten P1-Befunde des unabhängigen v3.0.6-Code-Audits sowie mehrere klar abgegrenzte P2/P3-Korrekturen um. Es führt keinen neuen Trading-Algorithmus und keine neue Outcome-Kalibrierung ein.

## Behoben

- Aktiensuche: kurze Firmennamens-Fragmente erzeugen keine lautlosen falschen Katalogtreffer mehr.
- Twelve Data: `prepost`-Fallback reagiert nur auf tatsächliche Extended-Hours-/Tariffehler, nicht auf Credits/API-Key-Fehler.
- Aktien-Radar: Zyklus-Scan und Einzel-Lookup nutzen dieselbe Extended-Hours-Strategie.
- Aktien-Cache: aktive Analysekomponenten und Mindest-CRV sind Teil der Cache-Signatur.
- Alpaca Opening Momentum: New-York-Zeitformatter wird einmalig wiederverwendet statt pro Bar neu erzeugt.
- Learning: Cache-Key ist reihenfolgeunabhängig, Aktien-Twin-Limit reduziert, maximal acht Aktien pro Payload tief ausgewertet.
- Datenquellen: Twelve-Data-Aktienhistorie/Twin/Lead wird nicht mehr mit Alpaca-Opening-Scores vermischt; Alpaca wird als `asset_type=opening` gespeichert.
- Outcome-Resolver aktualisiert nur Snapshots derselben Assetklasse und Quelle.
- Hover: Aktien-Detail öffnet erst nach 2,3 s ruhigem Hover und überlebt Hintergrund-Re-Renders.
- Live-Routen `/api/scan` und `/api/stocks` verwenden `no-store`.
- Krypto-Warmcache-D1-Schreiben ist gedrosselt; unveränderte Paare werden im zweiten Analysepass nicht nochmals vollständig berechnet.
- Aktien-Heatmap fokussiert Titel ohne einen unsichtbaren Suchfilter zurückzulassen.
- Aktien-Heatmap und D1-Verlauf verwenden dieselbe `executability`-Definition.
- Unbekanntes Aktien-RVOL wird als `null`/„n. v.“ geführt; im Score bleibt es neutral.
- Unbekannte Krypto-Relative-Stärke wird nicht mehr als 0 ausgegeben.
- `micro`-Modus behandelt unbekannten Spread nicht mehr automatisch wie den schlechtesten Wert.
- Candle-Import verwirft ungültige/fehlende Zeitstempel.
- Coin-Force-Scan kann einen laufenden normalen Poll ablösen; ältere parallele Aktien-/Learning-Antworten werden verworfen.
- Countdown ist als „Nächster 5m-Takt“ eindeutig beschriftet.
- Service-Worker-Precache enthält auch das Maskable-Icon.
- User-Agent verwendet dynamisch die aktuelle `APP_VERSION`.

## Bewusst nicht geändert

- Keine Änderung der BUY-Schwellen oder des Trade-Regelwerks.
- Keine Änderung der +5 % / 180-Minuten-Outcome-Kalibrierung.
- Kein Yahoo-Finance-Scraping als Fallback.
- Kein kostenpflichtiges Alpaca-SIP-Abo vorausgesetzt; `ALPACA_FEED=iex` bleibt Standard.
