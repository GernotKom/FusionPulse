# Tiingo Testplan v3.1.4

Der erste Deploy läuft bewusst im `shadow`-Modus. Damit kann der vorhandene Tiingo-Token live geprüft werden, ohne den bisherigen Aktienpfad umzuschalten.

**Smoke-Test:** `/api/tiingo/validate?symbols=AAPL,NVDA,TSLA`

Erwartung: `tests.auth.ok=true`, `tests.iexSnapshot.ok=true`, mindestens zwei `history`-Einträge mit `ok=true`, mindestens 24 Bars und `volumeKnown=true`. `tests.fx.ok=true` ist für EUR-Anzeigen erwünscht.

Erst nach erfolgreichem Test `TIINGO_STOCKS_MODE` von `shadow` auf `primary` ändern. Der Code ist bereits vorbereitet; kein weiterer Code-Patch ist dafür nötig.

BOATS wird in diesem Test nicht vorausgesetzt. Der bestehende `/api/tiingo/boats`-Endpoint bleibt isoliert.
