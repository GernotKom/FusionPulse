# FusionPulse v3.1.3

Entwicklungs-/RC-Kandidat nach Claude-OPUS-Zwischenaudit.

## Sicherheits- und Datenqualitätsfixes
- Nullwerte werden in Orderbuch/Liquidität und Detailfaktoren nicht als gemessene 0 dargestellt.
- Crowd-Snapshots aus D1 nur mit maximal 6 Stunden alten Crowd-Daten.
- Bestehende D1-DBs erhalten fehlende `executability`-Spalte automatisch.
- Twin-Learning schließt denselben Titel aus und zeigt `distinctSymbols`; D1 n=0 fällt lokal zurück.
- Fehlende Stock-Executability wird im Frontend nicht erneut imputiert.
- Opportunity-Entscheidung zentralisiert.

## UI
- Coin-Zonenlage in der Liste bleibt bestehen und zeigt zusätzlich UNTER ZONE / IN ZONE / ÜBER ZONE.
- Aktienpreise weiterhin EUR zuerst, originaler USD-Kurs in Klammern; Preisleiter verwendet die originalen USD-Marken.
- STALE-Farbe, iOS-Dock-Abstand und 1-Punkt-Sparkline korrigiert.

## Sonstiges
- `/api/health` bei APP_TOKEN unauthentifiziert reduziert.
- Coin-Deep-Scan UI auf 4–20 synchronisiert.
- Safety-Regressionstests erweitert.
