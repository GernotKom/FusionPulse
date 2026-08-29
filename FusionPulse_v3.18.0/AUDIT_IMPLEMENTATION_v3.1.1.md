# FusionPulse v3.1.1 – Umsetzung Claude-OPUS-Audit

## Release-blocker behoben
- P0-1: unbekanntes Orderbuch ist kein neutraler Wert mehr; kein grüner Coin ohne bekanntes Orderbuch; Executability bei unbekanntem Buch < Grün-Schwelle gedeckelt.
- P0-2: fehlendes Aktienvolumen/VWAP wird als unbekannt behandelt und aus der Gewichtung entfernt; `volumeKnown` wird ausgeliefert.
- P0-3: Aktien-Signalton benötigt aktuelle Daten und passende Marktphase; stale Daten können keinen positiven Ton auslösen.
- P0-4: Detailfaktoren sind null-sicher; BTC-EUR ohne Relative-Strength-Referenz bricht das Detailfenster nicht mehr.

## P1 umgesetzt
- UTC-Zeitbasis bei Twelve-Data `time_series`; Live-Markierung auf 90 Sekunden begrenzt und Lookup setzt seine eigene Aktualisierungsmetadaten.
- Signalbanner und Dock werden unten gestapelt statt überlagert.
- Twin-Learning: kein globaler Fallback ohne Sektor; D1-Twins mindestens 3 Stunden Abstand; lokale Twins nur gleicher Titel oder gleicher Sektor; Server-Tiefe auf 16 Aktien erhöht.
- Tiingo BOATS: bei >5 Symbolen ein Gesamt-Snapshot statt Einzel-Fetches; maximal 25 gewünschte Symbole.
- Alpaca RVOL bleibt `null`, wenn keine belastbare Volumenbasis vorhanden ist.
- Aktien-Executability bleibt `null`, wenn RVOL unbekannt ist.
- Crowd wird vor einem neuen Abruf invalidiert; Werte älter als 60 Minuten gelten als n.v.
- NYSE-Feiertage werden algorithmisch berücksichtigt; geschlossene Tage erhalten keine Live-BUY-Freigabe.
- D1-Schema hat nur noch eine kanonische `executability`-Definition; Migration 0002 ist ein No-op.

## Opportunity Watch v3.1.1
- Ziel: wenige, wirtschaftlich relevante Hinweise statt vieler formal guter, aber kleiner Trades.
- Positive Opportunity-Meldung für Aktien nur bei Live-Daten, Score >= 8, Netto-CRV >= Benutzergrenze, Mindest-TP2-Weg und realistischem Netto-Planertrag >= 250 EUR (Standardwert, einstellbar).
- Premarket darf eine `OPPORTUNITY` melden; `BUY` bleibt Opening/Regular vorbehalten.
- Das große Aktienfenster zeigt den Opportunity-Status und die wichtigsten Gründe (Score, Netto-CRV, Plan-Netto, RVOL).
- Fehlende Daten lockern keine Schwellenwerte und können keine Opportunity/BUY-Freigabe erzeugen.

## Noch nicht als RC freigegeben
- P1-14: Twelve-Data-Kontingent ist weiterhin Isolate-lokal. Die UI bezeichnet die Tageszahl jetzt ausdrücklich als Eigenzählung je Worker-Instanz. Globaler D1-Quota-Lock ist ein eigener Infrastruktur-Schritt.
- P1-15: D1-Persistenz läuft weiterhin zeilenweise. Das ist ein Performance-/Cron-Risiko und soll vor einem voll produktiven Learning-Ausbau gebündelt werden.

Diese beiden Punkte ändern keine BUY-Schwellenwerte, sind aber vor einer endgültigen RC-Freigabe erneut zu prüfen.
