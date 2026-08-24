# Verbesserungsliste v3.2.1

## In v3.2.1 umgesetzt
- IEX Whole-Market-Bulk-Radar als regulärer Session-Discovery-Layer.
- Server-Radar jede Minute, Deep Scan alle zwei Minuten auch bei geschlossener PWA.
- D1-Radar-Gedaechtnis fuer vorige Top-Kandidaten zur Erkennung frischer Beschleunigung.
- Adaptive 20er Deep-Scan-Queue: Favoriten + Recheck + Radar + BOATS + Exploration.
- Discovery-Radar und BOATS strikt 0 % BUY-Gewicht.
- Pre-Signal-Reife 0–100 % als Priorisierungswert, nicht als BUY-Freigabe.
- „Alle Aktien“ zeigt/priorisiert autonome Kandidaten statt nur Favoriten.
- Dynamische Datenquellenanzeige Tiingo IEX Primary / Twelve Data Fallback.
- Aktienchart-Zeitraum 5/10/30/60/120/180/240/300 Minuten.

## Weiter beobachten / kalibrieren
- Radar-Schwellen anhand realer Sessions kalibrieren: fruehe Runner finden, spaete Chaser und illiquide/Penny-Ausreisser begrenzen.
- Pruefen, wie gross der reale `/iex`-Bulk-Umfang je Session ist und wie viele Symbole nach Freshness-/Spread-Gates uebrig bleiben.
- Tiingo-Rate-Limit/Worker-Latenz mit 1-Minuten-Bulk + 2-Minuten-Deep-Scan live beobachten; bei Bedarf Queue-Groesse/Frequenz optimieren, aber Trading-Gates nicht lockern.
- D1-Radar-Gedaechtnis spaeter von Top-Snapshot auf explizite 1/3/5/15-Minuten-Sequenzen erweitern, falls reale Outcomes einen Mehrwert zeigen.
- `whyNow`-Gruende in der UI noch deutlicher als „Warum jetzt?“ visualisieren, wenn die ersten Sessions zeigen, welche Gruende wirklich nuetzlich sind.
- BOATS -> Premarket -> Opening -> Regular Session als explizite Session-Sequenz im Learning speichern.
- Pre-Signal-Reife gegen echte Outcomes kalibrieren; niedrige Stichprobe darf nie positiv/negativ ueberinterpretiert werden.
- Twelve Data erst nach mehreren stabilen Tiingo-Sessions weiter reduzieren.
- NYSE Half-Days/Sonderzeiten weiter haerten.

## Unveraenderte Leitregel
Fehlende, stale oder schlechtere Daten duerfen ein Setup niemals verbessern. Discovery dient nur dazu, die richtigen Titel frueher in den Deep Scan zu bringen. BUY bleibt nur bei ausreichender Qualitaet, Handelbarkeit und Netto-CRV > 3:1 zulaessig.

## In v3.2.2 umgesetzt
- P1 Hotfix: Whole-Market Radar auf verifizierte Common Stocks begrenzt; ETFs/ETPs/ETNs und gehebelte/inverse Fondsprodukte vor dem Deep Scan ausgeschlossen.
