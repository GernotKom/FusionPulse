# FusionPulse v3.1.7

## Tiingo Power + BOATS Diagnose
- PWA-Test zeigt Token, IEX-Snapshot, 5-Minuten-Historie, Volumen und BOATS getrennt als ✅/❌.
- BOATS wird mit demselben `TIINGO_API_TOKEN` über das Entitlement geprüft; kein zweiter Token im Code erforderlich.
- Test bleibt read-only; `TIINGO_STOCKS_MODE` bleibt standardmäßig `shadow` und hat 0 % BUY-/Score-Einfluss.

## Opportunity Value
- Aktien-Opportunity erfordert zusätzlich ein wirtschaftlich relevantes Netto-Potenzial.
- Unter 200 EUR realistischer Plan-Nettoertrag wird ausdrücklich als `UNINTERESSANT` erklärt.
- `OPPORTUNITY` erst ab mindestens 350 EUR (oder höherer Nutzerschwelle); `HIGH OPPORTUNITY` ab 500 EUR.
- Bestehende Sicherheitsregeln bleiben erhalten: Live-Daten, Score, CRV, Kursweg und Marktphase müssen zusätzlich passen.

## VL / Erklärungen
- Zonenlage erklärt per schnellem Mouseover `UNTER ZONE`, `IN ZONE`, `ÜBER ZONE` und die jeweilige Konsequenz.
- Pullback wird laienverständlich erklärt und ausdrücklich nicht als eigenständiges Kaufsignal dargestellt.
