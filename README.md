# FusionPulse v2.5.0

Krypto-Radar über Bitpanda Fusion + optionales US-Aktienradar über Twelve Data.

## Neu in v2.5.0
- echtes Aktienradar statt Platzhalter
- 21 liquide US-Aktien, gruppiert nach 7 Branchen
- Free-Mode-schonendes Rotationsprinzip: 7 Titel pro 5-Minuten-Zyklus, kompletter Korb ca. alle 15 Minuten
- Score 0–10, Setup, CRV, Entry, Stop, TP1, TP2 und risikobasierte Kaufsumme
- grün erst ab Score >= 8 und Ziel-CRV > 3:1
- EUR-Anzeige über USD/EUR-Umrechnung; ausdrücklich **nicht Tradegate**
- Mouseover erklärt Aktienwerte und zeigt Trade-Plan
- Aktienanzahl bleibt in den Einstellungen begrenzbar

## Datenquellen / Secrets in Cloudflare
- `FUSION_API_KEY` = Bitpanda Fusion, nur READ
- `APP_TOKEN` = eigenes Zugriffs-Passwort
- `TWELVE_API_KEY` = optionaler Twelve-Data-Key für US-Aktien

Alle Secrets gehören nur in Cloudflare, niemals in GitHub.

## Twelve Data Free-Modus
Der Basic-Tarif hat laut Anbieter 8 API-Credits pro Minute und 800 pro Tag. FusionPulse nutzt deshalb keine Vollmarkt-Dauerabfrage. Der 21-Titel-Korb wird in drei Gruppen rotiert. Beim ersten Zyklus kann zusätzlich 1 Credit für EUR/USD benötigt werden; FX wird danach 30 Minuten gecacht.

## Wichtige Einschränkung
Die Aktienwerte stammen aus einem US-Marktfeed. EUR-Werte sind lediglich umgerechnete USD-Werte. Vor einer Order über Tradegate muss der tatsächliche Tradegate-Kurs/Spread geprüft werden. Das Aktienradar ist ein Kandidatenfilter, keine automatische Orderfreigabe.

## Deployment
1. Inhalt dieses Ordners direkt in das GitHub-Repository hochladen (kein zusätzlicher Unterordner).
2. Cloudflare baut automatisch aus `main`; Stammverzeichnis `/`.
3. In Cloudflare `TWELVE_API_KEY` als **Geheimnis** ergänzen.
4. Neueste Secret-Version auf 100 % befördern, falls Cloudflare sie nicht automatisch aktiviert.
5. PWA neu laden; oben muss `v2.5.0` stehen.
