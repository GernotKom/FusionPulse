# FusionPulse v3.4.1 — P0 Hotfix

## Behoben
- Laufzeitfehler `priceSource is not defined` im Alpaca Opening-/Momentum-Pfad behoben.
- Preisquelle wird deterministisch als `minute`, `trade`, `daily` oder `none` gesetzt.
- Alpaca-Tages-Bar wird im Opening Momentum ausdrücklich als `⚠ Tages-Bar/Fallback` gekennzeichnet und nicht als Live-Quote dargestellt.
- Regressionstest für diesen konkreten Fehler ergänzt.

## Safety
- Keine Änderung an BUY-Gates, Netto-CRV, Sizing, Elliott-Logik oder Discovery-Gewichtung.
- Daily-Bar bleibt Discovery-Kontext mit 0 % direktem BUY-Gewicht.

## Basis
- Enthält vollständig den Audit-/VL-Stand von v3.4.0.

---

# FusionPulse v3.4.0 — Release Notes

Datum: 25.08.2026

## Schwerpunkt
Stabilitäts- und Sicherheitsrelease nach externem statischem Audit plus kumulierter VL. Keine Lockerung der Tradingregeln oder Schwellenwerte.

## Audit-Fixes
- Fokus bleibt strikt auf der angeforderten Aktie; aktiver Nicht-Favorit wird über Polls geschützt.
- Stock-Lookup besitzt eigenen Sequenz-Guard und keinen Suchfeld-Transportkanal mehr; Ticker-Mismatch wird fail-closed behandelt.
- `regimeExplanation()` ist definiert; Risk-On/Off/VWAP-Erklärung funktioniert wieder ohne Render-/Learning-Folgefehler.
- BUY ist zusätzlich an echte Live-Freshness und bekannte Opening/Regular-Marktphase gebunden; fehlende Daten können kein BUY erzeugen.
- Persistierte `refreshedSymbols` werden im Tiingo-Clientpfad wieder durchgereicht.
- Fokus zeigt Quote-/Freshness-Information und erhält einen Einzelaktien-Refresh.
- Frontend-/Provider-Fetches sind zeitbegrenzt; Aktien-Poll plant sich über `finally` weiter.
- Crowd-Aufruf aus dem minütlichen Opening-Scan entfernt; eigener 20-Minuten-Zyklus.
- Chart-Cache erhält 120-s-TTL.
- Tiingo-Radar verwirft Quotes älter als 30 Minuten.
- Alpaca kennzeichnet intern minute/trade/daily als Preisquelle.
- Sticky-Header verdeckt den Aktiennamen nach Sprung nicht mehr.
- VWAP-Text behauptet bei fehlender Volumenbasis nicht mehr fälschlich „über VWAP“.
- Erster Service-Worker-Claim löst keinen unnötigen Reload aus.

## VL/UI
- Opening Momentum: redundantes „· RADAR“ entfernt; Header zeigt Updatezeit und 60-s-Intervall.
- Speed bleibt in Radar und Opening Momentum mit Erklärung erhalten.
- Learning-Fehler-Tooltip unterscheidet Learning/D1 von Provider-Verbindungen.
- Einzelaktien-Refresh im Fokusfenster ergänzt.
- Fokus-Freshness zeigt Abfrage-/Datenstatus zusätzlich zum Quote-Status.

## Bewusst weiter offen
- Aktien-Heatmap: echte dynamische Bewegung/Trails und bessere visuelle Aussagekraft weiter verbessern.
- Aktienchart: echte Premarket-/After-Hours-Zeitreihe, Previous Close, Gap-Referenz und Sessiontrennung.
- Header-Zähler Aktien/Krypto eindeutig trennen.
- Twelve-Data-Kontingentdarstellung weiter vereinfachen, wenn Anbieterheader kein belastbares Restkontingent liefern.
- Untere Signal-/Planleiste weiter entschlacken: kein Coin darf ohne echtes aktives Signal/Plan wie eine Empfehlung wirken.
- Discovery-Unternehmensbeschreibung weiter spezialisieren (z. B. Biotech-Discovery/Lead Candidate nur verifiziert).
- Elliott-/Strukturkontext 30–180 min weiter evaluieren; keine Schwellenänderung ohne separaten Test/Audit.
- Shooting/Short-Radar bleibt zurückgestellt.

## Validierung
`npm run check` muss Syntax + vollständige Safety-Regression bestehen. Versionsnummer wird über `scripts/sync-version.mjs` auf alle Release-Artefakte synchronisiert.
