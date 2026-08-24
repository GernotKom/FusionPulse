# FusionPulse v3.1.5

## Schwerpunkt
Sicherer Tiingo-Test direkt aus der geschützten PWA, ohne Umschaltung des produktiven Aktienfeeds. `TIINGO_STOCKS_MODE` bleibt standardmäßig `shadow`.

## Änderungen
- Neuer Tiingo-Verbindungstest in Einstellungen: prüft zuerst Token-Authentifizierung und danach IEX Snapshot/Intraday für AAPL, NVDA und TSLA.
- Klare UI-Ausgabe: Token OK, Tarif/Entitlement unzureichend, FusionPulse-APP_TOKEN fehlt oder technischer Fehler.
- Kompakte Datenquellen-Statussymbole oben links neben dem 5-Minuten-Countdown (Krypto, Aktien, Tiingo).
- Marktregime RISK ON / RISK OFF / Neutral ist anklickbar und zeigt wieder eine verständliche Erklärung der Marktbreite und ihrer Bedeutung.
- SIGNAL-INFO-Banner wird beim App-Start explizit initialisiert und per CSS dauerhaft sichtbar gehalten; weiterhin am unteren Rand.
- Keine Änderung an BUY-/CRV-Schwellenwerten und kein Tiingo-Einfluss auf BUY im Shadow-Modus.

## Teststatus
- `npm run check`: OK
- Safety-Regressionssuite: OK
- Worker-Import: OK

## Deployment
Nach Deploy v3.1.5: Einstellungen öffnen → Zugriffs-Token (APP_TOKEN, falls gesetzt) speichern → `Tiingo prüfen` klicken. Erst nach erfolgreichem Test eine spätere Umschaltung auf `TIINGO_STOCKS_MODE=primary` erwägen.
