# FusionPulse v3.0.8 — Release Notes

Stand: 24.08.2026

## Schwerpunkt

Kleiner Stabilitäts-Hotfix für das automatische US-Aktienradar unter dem Twelve-Data-Free-Kontingent. Krypto, Learning-Modell, BUY-Regeln und die manuelle Aktiensuche bleiben funktional unverändert.

## Änderungen

- Automatischer Twelve-Data-Scan in vier quota-sichere Teilgruppen aufgeteilt (6/5/5/5).
- Pro Minutenfenster bleiben bewusst Credits als Reserve für FX und manuelle Aktionen frei.
- Automatischer Batch verwendet kein `prepost=true` mehr. Premarket/Opening Momentum bleibt separat bei Alpaca.
- Dadurch entfällt die frühere doppelte Batch-Anfrage, wenn Extended Hours im Twelve-Data-Tarif nicht freigeschaltet ist.
- Bei HTTP 429 werden bereits geladene Aktien im Frontend nicht mehr durch eine leere Liste ersetzt.
- Cold Start lädt fehlende Teilgruppen minutenweise nach; danach läuft der konservative Teilscan weiter.
- Manuelle Aktiensuche wurde nicht verändert.

## Nicht geändert

- Bitpanda/Krypto-Scan und Krypto-Scoring.
- D1-Learning-Logik und Outcome-Regeln.
- BUY-/CRV-Schwellen.
- Alpaca Opening Momentum.

## Prüfung

- Versions-Synchronisierung über `npm run sync-version`.
- JavaScript-Syntaxcheck über `npm run check`.
- ZIP-Integritätsprüfung vor Freigabe.
