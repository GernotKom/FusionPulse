# FusionPulse v3.5.2 · FusionPulse Adaptiv + Opportunity Lifecycle

## Wichtig: Claude Modus methodisch unverändert
- Die beiden serverseitigen Claude-Bewertungsblöcke für Krypto und Aktien wurden **byte-identisch** aus v3.5.1 übernommen. Auch Claude-Konstanten und Client-Overlay sind unverändert.
- Neue Regressionstests prüfen SHA-256-Locks dieser Blöcke. Eine spätere versehentliche Änderung der Claude-Methodik lässt `npm run check` fehlschlagen.
- Die folgenden Änderungen betreffen den **normalen FusionPulse-Modus** und die gemeinsame Discovery/Priorisierung, nicht die Claude-Bewertungsformeln.

## Kernkorrektur im eigenen Aktienmodus
Der Audit-Befund aus v3.5.0 wurde auf den normalen FusionPulse-Modus übertragen, ohne Claude zu kopieren: Eine Kennzahl darf nicht gegen eine mathematisch andere Auszahlung geprüft werden. Bis v3.5.1 wurde der 50/50-Plan nach Fixkosten gegen die 3:1-CRV-Grenze gehalten, obwohl sein festes TP1/TP2-Schema diese Grenze konstruktiv nicht erreichen konnte.

FusionPulse Adaptiv trennt jetzt drei Ebenen:
1. **Struktur-CRV:** CRV bis zu einem am Chart gemessenen Strukturziel. Dieses CRV muss weiterhin die eingestellte Aktiengrenze erfüllen (standardmäßig 3:1).
2. **50/50-Plan-Effizienz:** Ergebnis des realen Standardplans nach geschätzten Flatex-/Tradegate-Fixkosten und Ausführungsreserve. Eigene Mindestschwelle 0,85:1; sie wird nicht mehr fälschlich als 3:1-Struktur-CRV behandelt.
3. **Wirtschaftliche Relevanz:** mindestens der Nutzerwert, mindestens 75 EUR und zusätzlich mindestens 1,25 % der tatsächlich berechneten Positionsgröße. Bei 10.000 EUR Einsatz sind damit mindestens 125 EUR netto erforderlich. Der alte Default 350 EUR wird einmalig nur dann auf 75 EUR migriert, wenn er noch exakt dem alten Default entspricht.

## Strukturziel statt selbstgebautem Ziel
- Der FusionPulse-Modus verwendet für Aktien kein konstantes TP2-R-Multiple mehr als Freigabegrundlage.
- Reclaim/Pullback zielt zunächst auf das reale vorherige Hoch; Breakout/Squeeze projiziert die tatsächlich gemessene Range bzw. den vorherigen Impuls (Measured Move/Fibonacci).
- Reicht dieser Markt-Strukturraum nicht für das eingestellte Struktur-CRV, bleibt das Setup blockiert. Es wird kein höheres Ziel erfunden, nur damit das Gate passt.
- Überdehnte Titel (>3 ATR über EMA21) bleiben blockiert.

## Elliott-Fix im eigenen Aktienmodus
- `deepRecheckRank()` gewichtete schon länger `r.elliott`, aber `analyseStock()` lieferte bis v3.5.1 bei Aktien gar kein `elliott`-Feld. Der behauptete Elliott-Anteil der Recheck-Priorität war dadurch faktisch immer 0.
- v3.5.2 berechnet im normalen FusionPulse-Aktienmodus eine explizite Elliott/Fibonacci-Struktur aus Impulsbreite, höherem Tief, Trendstaffelung und Nähe zu 0,382/0,5/0,618-Retracements.
- Fehlende Daten verbessern den Wert nicht; Elliott bleibt nur ein Teil der Gesamtanalyse.

## Neue Opportunity-Lifecycle-Logik
Der marktweite Large-Cap-Radar bewertet nicht mehr nur den aktuellen Zustand, sondern auch den **Zustandswechsel gegenüber dem vorherigen Radar-Snapshot**:
- `PREP`: Druck direkt unter dem Trigger, noch ohne Ausbruch.
- `IGNITION`: frischer Wechsel z. B. WATCH/NEAR HIGH -> BREAKOUT PRESSURE/ACCELERATION.
- `CONFIRM`: Bewegung bestätigt sich nach dem Start.
- `LATE`: Kurs bereits stark gelaufen, Geschwindigkeit fällt; wird bewusst abgewertet.
- `WATCH`: noch keine belastbare Situation.

Frische IGNITION-/PREP-Übergänge erhalten in der Deep-Scan-Reife Vorrang; ein später Tagesrunner verliert Rang. Radar/BOATS bleiben weiterhin **0 % direktes BUY-Gewicht**.

## UI / Erklärung
- Normalmodus wird in der Methodenanzeige als **FUSIONPULSE ADAPTIV** gekennzeichnet; Claude weiterhin klar separat.
- FokusScope und Detailansicht trennen **Struktur-CRV** und **Plan-Effizienz** sichtbar.
- Situation-Radar zeigt zusätzlich die Lifecycle-Phase, z. B. `IGNITION · BREAKOUT PRESSURE`.
- BUY-Hinweis erklärt die tatsächlich wirksamen FusionPulse-Gates.

## Nachweis
- Funktionsfixture „frischer Ausbruch nach Impuls + Kompression“ kann im FusionPulse-Modus Grün erreichen und erfüllt dabei Struktur-CRV >= 3:1.
- Stark überdehnte Late-Chase-Fixture bleibt blockiert.
- Ohne Aktienvolumen bleibt FusionPulse fail-closed.
- Claude-Blöcke werden zusätzlich per SHA-256 gegen v3.5.1 verriegelt.
- `npm run check`: muss vor Release vollständig grün sein.

# FusionPulse v3.5.1 · Deep-Scan-Regler & Tiingo-Kontingent

## Neu
- **Regler „Aktien tief scannen (15–40)"** in den Einstellungen. Ersetzt die bisher fest verdrahtete 20er-Grenze im Deep-Scan. Anders als der Krypto-Regler ist dieser Wert **serverseitig in D1 persistiert** (`stock_deep_limit`), weil der Aktien-Deep-Scan über einen Cron läuft, der auch bei geschlossener PWA aktiv bleibt – ein reiner Client-Zustand hätte den Cron nicht erreicht. Alle Warteschlangen-Anteile (Favoriten, Gainer, Radar, Recheck, BOATS, Explore) skalieren proportional zur bisherigen 20er-Baseline mit; die finale Kappung via `.slice(0, deepLimit)` verhindert in jedem Fall eine Überschreitung.
- **Tiingo-Kontingentanzeige** in den Einstellungen. Wichtig zu wissen: Tiingo liefert – anders als Twelve Data – **keine Nutzungs-Header** in der REST-Antwort und **keinen öffentlichen usage-Endpoint**. Es gibt daher keinen Weg, das reale Kontokontingent aus der API selbst auszulesen. Die Anzeige ist deshalb eine **ausdrücklich gekennzeichnete App-Eigenzählung** (`state: 'app-estimate'`): sie zählt nur Requests, die dieser Worker selbst absetzt (nicht das gesamte Tiingo-Konto, z.B. Dashboard-Zugriffe zählen nicht mit), gegen die öffentlich dokumentierten Power-Plan-Grenzwerte (10.000 Requests/Stunde, 100.000/Tag; BOATS teilt sich dasselbe Kontingent als Entitlement ohne eigenes Limit).

## Im Funktionsnachweis gefundener und behobener Bug
Beim Testen des `/api/tiingo/status`-Routings gegen den echten Produktionscode fiel auf: Schlägt der Tiingo-Auth-Check fehl (Netzwerkfehler, Rate-Limit, 429 etc.), fehlten `quota` und `stockDeep` in der Fehlerantwort – **genau dann, wenn die Kontingentanzeige am wichtigsten gewesen wäre**, blieb sie leer. Der catch-Zweig liefert diese Felder jetzt ebenfalls mit. Ein Regressionstest sichert das ab.

## Technischer Nachweis (gegen den echten Worker-Handler, nicht nur Unit-Logik)
- Persistenz-Rundreise über ein simuliertes D1 bestätigt: `stockDeep=33` gesetzt → nächster Aufruf ohne Parameter liefert weiterhin 33.
- Clamping bestätigt: `stockDeep=999` → 40 (Obergrenze), `stockDeep=1` → 15 (Untergrenze).
- Kontingentzählung bestätigt: jeder Tiingo-Call (auch fehlgeschlagene) erhöht `hourCalls`/`dayCalls` korrekt, `hourLimit`/`dayLimit` entsprechen den Power-Plan-Werten.

# FusionPulse v3.5.0 · Claude Modus

## Kernbefund des Audits (warum nie ein BUY erschien)
1. **Aktien, mathematisch unerfüllbar:** Der 50/50-Plan (TP1 = 1,7R, TP2 = 3,35R) hat brutto maximal **2,525R**. Das Gate `planCrvAfterCosts >= 3,0` konnte daher **niemals** erfüllt werden – unabhängig vom Markt.
2. **Aktien, zweites unerfüllbares Gate:** Bei Default-Risikobudget (5.000 € × 0,75 % = 37,50 €) endet der maximale Plan nach Fixkosten (3 × 10,75 €), Friction und 27,5 % KESt bei **~43 € netto**. Gate: ≥ 350 €. Faktor 8 daneben.
3. **Score-Falle:** `score >= 8` bei theoretischem Komponenten-Maximum von 8,74 verlangte ~92 % des Bestwerts gleichzeitig.
4. **Krypto:** `netCRV = (2,2r − c)/(r + c) >= 2,0` erfordert costRatio r/c ≥ **15**; der Code begrenzt den Stop aber auf 2,6 ATR und verlangt nur ≥ 2,5 – bei realen Bitpanda-Kosten praktisch unerreichbar (außer seltene weite Strukturziele), kombiniert mit ~10 weiteren UND-Bedingungen.

## Claude Modus (additiv, Schalter in Einstellungen → Analyseverfahren)
- Serverseitig wird **immer** eine parallele `claude`-Bewertung je Zeile berechnet; der Schalter ist eine reine Client-Umschaltung ohne zusätzliche API-Kosten. Legacy bleibt vollständig erhalten und rückschaltbar (`r.fpBase`-Overlay).
- **Aktien:** TP2 aus Elliott/Fibonacci-**Strukturziel** (gedeckelt 6R) statt konstantem 3,35R; Score rekalibriert inkl. Situation Engine (20 %) und Liquidity Vacuum (12 %); Gates: Score ≥ 7, Netto-CRV ≥ 1,8, RVOL ≥ 1,3, kein WATCH-Zustand, nicht > 3 ATR überdehnt, Kursweg ≥ 3× Kosten.
- **Krypto:** erreichbare, kostenehrliche Gates (Netto-CRV ≥ 1,4, costRatio ≥ 3,2, Qualität ≥ 6,6) statt des unerreichbaren 2,0-CRV.
- **Erwartungswert-Gate** (beide): Drei-Ausgänge-Modell mit Breakeven-Stop nach TP1: EV = p1·0,5·R1 + p1·p2·0,5·R2 − (1−p1)·1 − 1,2·Kosten/R. Aktien ≥ +0,15R, Krypto ≥ +0,10R. p1/p2 sind konservative Heuristik-Startwerte und über D1-Outcomes kalibrierbar.
- **Wirtschaftliche Mindestgröße** skaliert am Risikobudget (Plan netto ≥ max(120 €, 1,2 × Risiko/Trade)) statt fixer 350 €, die das eigene Sizing nie erreichen konnte.
- **Alle Fail-Closed-Regeln bleiben:** ohne Volumen kein Aktien-Grün, ohne Orderbuch kein Coin-Grün, Stale-Daten blocken weiterhin. Neue Regression-Tests sichern das ab.

## Trade-Management-Konvention im Claude Modus
Nach TP1 (50 % Teilverkauf) Stop auf Breakeven ziehen – der EV rechnet exakt mit dieser Regel.

# FusionPulse Release Notes — v3.4.3

## Situation Engine — frühere, bessere Opportunitätenerkennung
- Neuer Large-Cap Situation Radar erkennt frische Zustandswechsel: Opening Drive, Breakout Pressure, Early Acceleration, Reversal/Reclaim, Volumenpuls, Nähe zum Tageshoch und enger werdenden Spread. Ein schon stark gelaufener Titel ohne neue Beschleunigung wird bewusst abgewertet.
- Neue Deep Situation Engine bewertet Breakout Start, Squeeze Release, VWAP-/EMA21-Reclaim, Pullback Hold, 5m-vs-15m-Beschleunigung, RVOL, VWAP-Lage und Overextension.
- `situationScore`, `situationType` und `situationReasons` dienen ausschließlich Discovery, Reihenfolge und Erklärung. Sie erhöhen **nicht** den BUY-Score und umgehen weder Netto-CRV noch Freshness/Marktphase/Sizing.
- Re-Check-Queue und Vorwarn-/Reifeanzeige sehen beginnende Situationen früher, ohne BUY-Schwellen zu lockern.

## Aktien-Freshness / Refresh-Stabilität
- Eigene Freshness-Ampel für Situation Radar, Opening Momentum und Extended Hours: Grün <3 Min., Gelb 3–5 Min., Orange 5–10 Min., Rot ab 10 Min.
- Ampel basiert auf tatsächlich empfangenen Daten, nicht auf dem Zeitpunkt eines Klicks oder gestarteten Requests, und altert automatisch auch ohne neue Antwort.
- Während Premarket/Opening/Regular startet die PWA ab >3 Min. altem Aktien-Snapshot einen gedrosselten echten Recovery-Scan; damit soll ein 10–12-Minuten-Stillstand nicht mehr still toleriert werden.
- Force-Refresh hat längeren Timeout; ein Refresh ohne neue Deep-Daten wird nicht mehr als normaler grüner Erfolg dargestellt.

## Sichtbare Analysemethoden
- Methodenanzeige ist jetzt permanent in der unteren SIGNAL-INFO-Fußleiste sichtbar und zusätzlich direkt im FokusScope.
- Sie zeigt Kernmethoden (Situation Engine, ATR, CRV/Execution, Spread/Liquidität) sowie die aktivierten Komponenten.
- Korrektur zu v3.4.2: Dort existierte zwar ein statischer Methodenbereich am Seitenende, war im tatsächlichen Fokus-Workflow aber nicht dauerhaft sichtbar.

## Safety
- Large-Cap-only automatische Discovery bleibt bestehen.
- Fehlende/schlechtere Daten verbessern kein Setup.
- BUY-/CRV-/Sizing-/Marktphasen-Gates unverändert.
- `npm run check` und erweiterte Safety-Regression bestehen.

---

# FusionPulse Release Notes — v3.4.2

## Refresh, FokusScope und Analyseanzeige
- Einzelaktien-Refresh im FokusScope erzwingt jetzt eine echte Neuanalyse und umgeht den lokalen 5-Minuten-Lookup-Cache.
- Der blaue globale Refresh erzwingt jetzt auch den Aktien-Snapshot statt nur den serverseitigen Cache erneut anzuzeigen; die Fokusaktie wird dabei zuerst aktualisiert.
- Aktive Analysemethoden werden kompakt in der Fußleiste angezeigt und aktualisieren sich mit den Einstellungen.
- FokusScope ist als höchste Daten-/Analysepriorität behandelt; Safety-Gates bleiben unverändert fail-closed.

## Large-Cap-Radar / Flatex-Praxisfilter
- Automatische Aktien-Discovery (Whole-Market Radar) ist jetzt inclusion-only auf eine kuratierte Large-Cap-/hochliquide US-Whitelist begrenzt. Small-/Micro-Caps können nicht mehr automatisch in den Radar gelangen.
- Opening Momentum verwendet denselben Large-Cap-Basiskatalog; dynamische Radar-Kandidaten müssen den Large-Cap-Gate ebenfalls bestehen.
- Common-Stock-/ETF-Sicherheitsfilter bleiben zusätzlich aktiv. Fehlende/unklare Metadaten können keinen Kandidaten freischalten.
- Manuelle Aktiensuche und Favoriten bleiben bewusst getrennt, damit ein vom Nutzer explizit gewünschter Ticker weiterhin aufrufbar ist.
- Trading-/BUY-Regeln, CRV, Sizing, Elliott-Logik und Discovery-Gewichtung (0 % direktes BUY-Gewicht) bleiben unverändert.

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
