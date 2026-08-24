# FusionPulse v3.1.6

## Fixes
- Tiingo-Verbindungstest in der PWA repariert: fehlende `setMiniStatus()`-Hilfsfunktion ergänzt.
- Der Tiingo-Test kann nun Token/Auth, IEX-Snapshot und Intraday-Historie anzeigen, ohne BUY/Score zu beeinflussen.
- Schnelle eigene Tooltips in der Kopfzeile für Risk-On/Risk-Off, Countdown und Krypto/Aktien/Tiingo-Ministatus. Hover-Verzögerung ca. 220 ms; native verzögerte `title`-Tooltips werden dort vermieden.

## Sicherheit
- `TIINGO_STOCKS_MODE` bleibt standardmäßig `shadow`.
- Keine Änderung an BUY-, CRV- oder Opportunity-Schwellenwerten.
