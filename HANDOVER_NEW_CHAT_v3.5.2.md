# FusionPulse – Übergabe für neuen Chat · v3.5.2

Stand: 25.08.2026  
Basis: vom Nutzer bereitgestellte `FusionPulse_v3.5.1.zip`  
Neue Arbeitsversion: `FusionPulse_v3.5.2`

## 1. Wichtigste Regel für jede weitere Entwicklung

**CLAUDE MODUS NICHT METHODISCH VERÄNDERN.**

Der Claude Modus aus v3.5.1 bleibt in v3.5.2 bewusst unverändert. Die neue Arbeit betrifft ausschließlich den normalen FusionPulse-Aktienmodus sowie gemeinsame Discovery-/Priorisierungslogik, soweit diese den Claude-Score bzw. dessen Formeln nicht verändert.

Zur technischen Absicherung prüft `tests/safety-regression.mjs` SHA-256-Locks auf vier Claude-Blöcke. Bei einer versehentlichen Änderung muss `npm run check` fehlschlagen.

Referenz-Hashes der aus v3.5.1 übernommenen Blöcke:
- Worker Claude Coin: `1a6acdf20ff3de5eb6642c7d4a5e99c979deb3112570aa6918f642db92917bb5`
- Worker Claude Stock: `52f69351e1ff3367ed8e14b5adabf6aeb106c6ac5826ab2ed7c615a863baca4c`
- App Claude Constants: `de85b209bbed1636b683c509b3256fd701ce5c15261c507d5f4682622e579cb2`
- App Claude Overlay: `9e6b5efc81bd1c3237ed7ca5b9e5564ea49abb1441bacd37f3be7d7849c1e73e`

## 2. Ausgangsbefund, aus dem v3.5.2 gelernt hat

Der wichtigste mathematische Fehler des früheren normalen Aktienmodus war die Vermischung verschiedener Größen:

- Der feste 50/50-Plan mit TP1 = 1,7R und TP2 = 3,35R liefert brutto maximal 2,525R. Ihn gegen ein Netto-Plan-CRV >= 3:1 zu prüfen war konstruktiv unerfüllbar.
- Ein starres Mindest-Netto von 350 EUR passte nicht zum eigenen Risikobudget und konnte dadurch ebenfalls praktisch jede Opportunity blockieren.
- `deepRecheckRank()` gewichtete `r.elliott`, aber `analyseStock()` lieferte bei Aktien bis v3.5.1 kein echtes `elliott`-Feld. Der Elliott-Anteil der Recheck-Priorität war damit faktisch 0.

Die Lehre für FusionPulse lautet: **Strukturqualität, reale Plan-Auszahlung und absolute wirtschaftliche Relevanz dürfen nicht als dieselbe Kennzahl behandelt werden.**

## 3. Neu in v3.5.2 – FusionPulse Adaptiv

Der normale Aktienmodus ist jetzt als **FusionPulse Adaptiv** getrennt vom Claude Modus aufgebaut.

### 3.1 Struktur-CRV statt mathematischer UND-Falle
- Das für die Freigabe relevante CRV bezieht sich auf ein **am Markt gemessenes Strukturziel**.
- Default bleibt die konfigurierte Aktiengrenze von 3:1.
- Reclaim/Pullback: Ziel zunächst reales vorheriges Hoch.
- Breakout/Squeeze: gemessene Range bzw. vorheriger Impuls als Measured-Move/Fibonacci-Projektion.
- Hard Cap 8R.
- Reicht der reale Strukturraum nicht, bleibt das Setup blockiert. Es wird kein Ziel hochgerechnet, nur damit ein Gate passt.

### 3.2 50/50-Plan-Effizienz separat
- Der reale Standardplan nach geschätzten Fixkosten/Ausführungsreserve wird als eigene **Plan-Effizienz** bewertet.
- Mindestwert im normalen FusionPulse-Modus: 0,85:1.
- Diese Kennzahl ist ausdrücklich **nicht** das Struktur-CRV.

### 3.3 Wirtschaftliche Relevanz positionsbezogen
Normalmodus Aktien:

`minNet = max(Nutzerwert, 75 EUR, 1,25 % der tatsächlichen Positionsgröße)`

Beispiele:
- 5.000 EUR Position -> mindestens 75 EUR netto.
- 10.000 EUR Position -> mindestens 125 EUR netto.

Der alte gespeicherte Default 350 EUR wird nur dann einmalig auf 75 EUR migriert, wenn er exakt 350 war. Individuell gesetzte Werte bleiben erhalten.

### 3.4 Eigener FusionPulse-Score
Der normale Modus kombiniert u. a. Trend, Momentum, Volumen/RVOL, VWAP, Situation Engine, Liquidity Vacuum, Triggerqualität sowie Elliott/Fibonacci. Grün erfordert weiterhin vollständige/fresh Daten, aktive Situation und ausreichende Handelbarkeit; fehlende Daten bleiben fail-closed.

### 3.5 Elliott/Fibonacci-Fix
Aktien liefern jetzt tatsächlich einen `elliott`-Wert. Die Strukturwertung nutzt Impulsbreite, höheres Tief, EMA-Trendstaffelung, Nähe zu 0,382/0,5/0,618-Retracements und eine Overextension-Strafe. Elliott ist ein echter Teil der eigenen Analyse, aber kein alleiniger BUY-Auslöser.

## 4. Neue Opportunity-Lifecycle-Logik

Der Large-Cap Radar bewertet jetzt nicht nur den Zustand, sondern den **Zustandswechsel zum vorherigen Radar-Snapshot**:

- `PREP`: Druck nahe am Trigger, noch kein sauberer Ausbruch.
- `IGNITION`: frischer Übergang in Breakout/Acceleration/Opening Drive.
- `CONFIRM`: gestartete Bewegung bestätigt sich.
- `LATE`: bereits stark gelaufen, Tempo lässt nach; bewusste Abwertung.
- `WATCH`: noch keine belastbare Situation.

Deep-Scan-Reife priorisiert PREP/IGNITION und Triggernähe. Ein später Tagesrunner wird nicht allein wegen seines Prozentgewinns bevorzugt. Radar/BOATS bleiben 0 % direktes BUY-Gewicht.

## 5. Bewusst nicht verändert

- **Claude Modus: Methodik, Konstanten, Overlay und serverseitige Bewertungen unverändert.**
- Krypto-Normalmodus wurde in v3.5.2 bewusst nicht neu kalibriert; Änderungen konzentrieren sich auf Aktien, damit keine zweite ungetestete Methodik gleichzeitig verändert wird.
- Fail-Closed-Grundsatz bleibt bestehen: fehlende, stale oder schlechtere Daten dürfen niemals ein Setup verbessern.
- Automatische Aktien-Discovery bleibt Large-Cap-/hochliquiditätsorientiert; manuelle Suche/Favoriten bleiben separat möglich.
- FokusScope hat höchste Daten-/Analysepriorität.

## 6. UI / Transparenz

- Methodenfeld kennzeichnet klar `FUSIONPULSE ADAPTIV` versus `CLAUDE MODUS`.
- FokusScope/Detail trennen sichtbar **Struktur-CRV** und **Plan-Effizienz**.
- Situation Radar zeigt Lifecycle, z. B. `IGNITION · BREAKOUT PRESSURE`.
- Kategorie-Freshness bleibt vorgesehen: Grün <3 min, Gelb 3–5, Orange 5–10, Rot ab 10 min, basierend auf tatsächlich eingetroffenen Daten.

## 7. Regression und Teststand

`npm run check` am finalen v3.5.2-Stand:

- `FusionPulse safety regressions: OK`
- `FusionPulse v3.5.1 deep-scan/quota regressions: OK`
- `FusionPulse v3.5.2 adaptive/lifecycle regressions: OK`

Zusätzlich abgesichert:
- frischer Ausbruch nach Impuls/Kompression kann im FusionPulse-Modus Grün erreichen,
- überdehnter Late-Chase bleibt blockiert,
- fehlendes Aktienvolumen bleibt fail-closed,
- stock `elliott` ist tatsächlich vorhanden,
- Struktur-CRV und Plan-Effizienz sind getrennte Gates,
- Claude-Blöcke bleiben hash-identisch zur v3.5.1-Basis.

## 8. Pflicht-Smoke-Test nach Deploy

1. Sichtbare Version muss überall **3.5.2** sein.
2. Claude Modus EIN/AUS testen; Claude darf sich methodisch gegenüber v3.5.1 nicht verändert haben.
3. Während US-Premarket/Opening/Regular prüfen, ob Aktienzeitstempel tatsächlich fortlaufen; keine 10–12 Minuten alten Daten als normal akzeptieren.
4. Radar/Opening/Extended: Freshness-Ampeln auf echte Datenzeit prüfen.
5. FokusScope: Einzelaktien-Refresh muss echte neue Abfrage/Deep-Analyse auslösen; Fokus hat höchste Priorität.
6. FusionPulse Adaptiv: Struktur-CRV und Plan-Effizienz müssen getrennt sichtbar sein.
7. Situation Radar: PREP/IGNITION/CONFIRM/LATE prüfen; insbesondere keine Small-/Micro-Caps in automatischer Discovery.
8. Stale/fehlende Daten dürfen kein grünes BUY erzeugen.
9. Analysemethoden-Feld muss in der UI sichtbar sein.
10. Live beobachten, ob PREP/IGNITION tatsächlich früher zu brauchbaren Deep-Checks führen als reine Tagesgainer-Logik.

## 9. Kumulative VL – besonders wichtig für nächste Versionen

`IMPROVEMENT_LIST.md` ist die kanonische kumulative VL und darf nicht stillschweigend gekürzt werden. Besonders neu/offen:

- **Aktive Position im FokusScope:** Nach echtem Kauf Eingabe von Kaufkurs EUR/Tradegate + Stückzahl; sofort reales Kapital, SL, TP1, TP2, Netto-CRV, Verlust am SL und Gewinn an TP1/TP2 aus der tatsächlichen Ausführung berechnen. Technische Marken nicht künstlich verschieben.
- **Verkaufsüberwachung:** Bei SL-Gefahr/SL, TP1, TP2 oder eindeutigem strukturellem Exit **TON + sehr auffällige grafische Meldung**; Alarm bleibt sichtbar bis bestätigt; Warnung und echte Verkaufsaktion klar unterscheiden.
- **Positionsmanagement nach TP1:** Teilverkauf/Reststückzahl dokumentieren; Stop-Anpassung nur nach aktiver Methodik und transparent.
- Alle übrigen offenen VL-Punkte aus `IMPROVEMENT_LIST.md` bleiben erhalten.

## 10. Wichtige Dateien

- `src/worker.js` – Serveranalyse, Radar/Lifecycle, Deep Scan.
- `public/app.js` – Client-Gates, Modusumschaltung, Fokus/UI, Opportunity.
- `tests/safety-regression.mjs` – Safety, Claude SHA-Locks, v3.5.2 Fixtures.
- `RELEASE_NOTES.md` – technische Änderungen je Version.
- `IMPROVEMENT_LIST.md` – kumulative VL.
- `README.md` – aktueller Betriebs-/Architekturüberblick.

## 11. Starttext für einen neuen Chat

> Wir entwickeln FusionPulse weiter. Arbeitsbasis ist **FusionPulse_v3.5.2.zip** plus dieses Übergabeprotokoll. Lies zuerst `HANDOVER_NEW_CHAT_v3.5.2.md`, `IMPROVEMENT_LIST.md` und `RELEASE_NOTES.md`, dann führe `npm run check` aus. **Der Claude Modus darf methodisch nicht verändert werden; seine SHA-Locks müssen grün bleiben.** Änderungen am normalen FusionPulse-Modus sind erlaubt, aber nur mit nachvollziehbarer Mathematik, fail-closed Verhalten und Regressionstests. Die Aktie im FokusScope hat höchste Priorität auf Datenqualität. Die VL ist kumulativ und darf nicht verkürzt werden. Vor einer neuen Version erst Befund, dann minimal nachvollziehbare Änderung, Tests, Versions-Sync und Übergabe.
