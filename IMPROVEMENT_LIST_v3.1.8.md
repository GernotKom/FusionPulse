# Verbesserungsliste v3.1.8

## Umgesetzt
- Tiingo-5-Minuten-Test bewertet reale Verwendbarkeit statt einer starren Mindestzahl von 24 Bars.
- Diagnose zeigt je Testsymbol Anzahl der Bars und Alter des letzten Bars.
- `readyForPrimary` wird serverseitig explizit aus Token, IEX, verwendbarer 5-Min-Historie, Volumen und BOATS gebildet.
- Tiingo-Primary-Pfad bleibt implementiert, aber die Auslieferung bleibt standardmäßig `shadow`, bis der Live-Test vollständig erfolgreich ist.

## Sicherheitsprinzip
- Read-only-Diagnose hat weiterhin 0 % Einfluss auf BUY, Score und Signalton.
- Keine Trading-Schwellenwerte wurden gelockert.

## Nächster Schritt
- Nach erfolgreichem v3.1.8-Test `TIINGO_STOCKS_MODE` kontrolliert auf `primary` umstellen und Aktienfeed/Discovery im Livebetrieb plausibilisieren.
- BOATS zunächst ausschließlich als Discovery-/Frühwarn-Layer; kein direkter BUY-Einfluss.
