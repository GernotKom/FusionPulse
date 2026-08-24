# FusionPulse v3.1.8

## Tiingo-Validierung
- Korrigiert den zu strengen 5-Minuten-Test aus v3.1.7: nicht mehr `>=24` Bars als pauschale Voraussetzung.
- Prüft stattdessen, ob mindestens zwei gültige OHLC-Bars mit verwertbarem Zeitstempel vorliegen; Volumen bleibt ein separater Pflichtcheck.
- PWA zeigt pro Testsymbol Bar-Anzahl und Alter des letzten Bars.
- Worker liefert `readyForPrimary` als explizites Diagnoseergebnis.

## Betrieb
- `TIINGO_STOCKS_MODE` bleibt standardmäßig `shadow`.
- Tiingo-Diagnose bleibt read-only und beeinflusst weder BUY noch Score/Ton.
- Bestehender Tiingo-IEX-Primary-Pfad ist vorbereitet; Umschaltung erst nach erfolgreichem Test.
