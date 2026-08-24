# FusionPulse v3.0.10 — Favoriten-/Crowd-Stabilisierung

Stand: 24.08.2026

## Ziel
Diese Version macht das Aktienmodul wieder praktisch nutzbar, ohne Krypto-, BUY- oder Learning-Kernlogik umzubauen.

## Änderungen
- Favoriten/Depot werden beim automatischen Twelve-Data-Scan priorisiert: pro Minute bis zu 3 Favoriten + 2 Titel aus dem Standarduniversum, insgesamt maximal 5 Aktiencredits pro Batch.
- Favoriten außerhalb des 21er-Standarduniversums dürfen im priorisierten Batch mitlaufen; bekannte letzte Werte bleiben lokal erhalten.
- Favoriten-Depot-Chips fokussieren den Titel, ohne einen versteckten Suchfilter zurückzulassen.
- Aktien-Heatmap nutzt weiterhin exakt die aktuell dargestellte Favoritenmenge.
- Abfragezeit wird direkt im Aktienradar angezeigt; jede Aktienzeile zeigt zusätzlich Abfragezeit und Zeitstempel des letzten Feed-Bars.
- Crowd wird in zwei getrennte Instrumente aufgeteilt:
  1. Crowd/Search = reine Aufmerksamkeit, unabhängig von Marktvolumen.
  2. Crowd → Markt = Marktbestätigung aus RVOL, kurzfristigem Momentum und Technikscore, kombiniert mit der vorhandenen Crowd-Aufmerksamkeit.
- Die Crowd→Markt-Bestätigung wird im lokalen Aktienverlauf und im lokalen Twin-Feature mitgeführt. Beide Crowd-Instrumente haben weiterhin 0 % direktes BUY-Gewicht.
- Interpretation „Was hat sich geändert?“ unterscheidet jetzt explizit frühe Aufmerksamkeit von späterer Marktbestätigung.

## Unverändert
- Krypto-/Bitpanda-Pipeline
- BUY-Schwellen und CRV-Regeln
- Alpaca Opening Momentum
- D1-Schema und 180-Minuten-Outcome-Regel

## Prüfungen
- `npm run sync-version`: bestanden
- `npm run check`: bestanden
- Version in Laufzeit-Artefakten: 3.0.10
