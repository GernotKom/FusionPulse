# Verbesserungsliste v3.2.0

## In v3.2.0 umgesetzt
- Tiingo Power/IEX als primaerer Aktienfeed.
- Tiingo BOATS als breiter, strikt read-only Discovery-/Fruehwarn-Layer.
- Deep Scan auf bis zu 20 Kandidaten je 2-Minuten-Zyklus erweitert.
- Favoriten werden weiterhin priorisiert; BOATS-Kandidaten ergaenzen die Auswahl.
- Tiingo-Suche fuer unbekannte Aktien im Primary-Modus.
- Aktien-Learning auf Tiingo-IEX-Quelle erweitert.
- Twelve Data im Primary-Modus aus dem normalen Aktien-Scan und dem serverseitigen Learning herausgenommen.
- Saubere Versionierung auf 3.2.0 ohne Suffix.

## Bereits umgesetzt / beibehaltene VL
- Aktien/Favoriten per Drag & Drop neu anordnen und persistent speichern.
- Klick auf Aktienliste -> grosses Aktienfenster.
- Intraday-Kurs in grossem Aktien- und Coin-Detailfenster.
- permanenter SIGNAL-INFO-Banner unten.
- kompakte Statussymbole oben; schnelle Mouseover-Hilfen bei Risk-On/Off, Timer und Statussymbolen.
- Zonenlage-Mouseover: UNTER / IN / UEBER ZONE laienverstaendlich erklaeren.
- Pullback-Mouseover laienverstaendlich erklaeren.
- EUR-Kurse bei Aktien primaer, originaler USD-Kurs direkt in Klammern.
- Opportunity-Value: wirtschaftlich uninteressante Setups trotz formalem CRV aussortieren/priorisieren.
- Premarket/Freshness klar zwischen live, cached, stale und n.v. unterscheiden.
- Twin-Learning-Stichproben und Herkunft sichtbar/konservativ behandeln.

## Naechste Beobachtungs-/Optimierungspunkte
- BOATS-Ranking im realen Overnight-Betrieb kalibrieren: zu viele Penny-/Illiquiditaets-Ausreisser vermeiden, ohne fruehe echte Runner zu verpassen.
- Premarket 04:00-09:30 ET: BOATS-Sequenz in die bestehende Alpaca/IEX-Bestaetigung ueberfuehren; keine Overnight-Auffaelligkeit blind fortschreiben.
- Opportunity-Value anhand realer Outcomes kalibrieren (nicht mehr Signale, sondern bessere und finanziell relevante Signale).
- Session-Sequenzen BOATS -> Premarket -> Opening im D1-Learning explizit speichern und auswerten.
- Datenquellen/Freshness in jeder Aktienkarte weiterhin eindeutig sichtbar halten.
- Nach mehreren stabilen Sessions entscheiden, welche Twelve-Data-Pfade noch gebraucht werden.
- Halbtag/NYSE-Sonderzeiten weiter haerten.
- Automatische Regressionstests um BOATS-Discovery-Fixtures erweitern.

## Unveraenderte Leitregel
Fehlende, stale oder schlechtere Daten duerfen ein Setup niemals verbessern. BUY bleibt nur bei ausreichender Qualitaet, Handelbarkeit und Netto-CRV > 3:1 zulaessig.
