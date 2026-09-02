# FusionPulse — Übergabe an den nächsten Chat

Stand: 02.09.2026, Version **4.0.6**. Diese Datei liegt im Repository, damit sie beim nächsten Upload mitwandert.

---

## 1. Das Wichtigste zuerst: Deploy-Fallen

**Zielpfad.** `worker.js` gehört nach `src/worker.js`. Im Root liegt eine gleichnamige Altdatei aus v2.5.1, die nie deployt wird — `wrangler.jsonc` zeigt mit `"main": "src/worker.js"` ausschließlich auf den Unterordner. Landet ein Upload im Root, ändert sich nichts an der laufenden App, und der Deploy meldet trotzdem Erfolg. **Empfehlung: die fünf Root-Altdateien (`worker.js`, `app.js`, `style.css`, `index.html`, `sw.js`) im Repository löschen.** Ein ZIP-Upload löscht sie nicht.

**Kein `limits`-Block auf dem Free-Plan.** Das Konto ist auf Workers Free. In v4.0.3/4.0.4 stand ein `limits`-Block in `wrangler.jsonc`; jeder Build brach ab mit:

```
✘ CPU limits are not supported for the Free plan. [code: 100328]
```

Der Block ist in 4.0.5 auskommentiert, samt durchgerechneter Werte. **Nach einem Upgrade auf Workers Paid einfach wieder einkommentieren** — vorher nicht.

**Versionsstempel.** Einzige Quelle ist `"version"` in `package.json`. Daraus generiert `npm run sync-version` neun Artefakte (`src/version.js`, `public/version.js`, `public/sw.js`, `public/index.html`, `public/style.css`, `README.md`, Kopf von `public/app.js`, `wrangler.jsonc`). Wer die Nummer nur in `package.json` ändert und über GitHub hochlädt, ohne den Sync laufen zu lassen, erzeugt einen Fehlstand: die Kopfzeile zeigt weiter die alte Nummer.

**`package-lock.json` muss im Repository liegen.** Cloudflare Workers Builds führt `npm clean-install` aus; ohne Lockfile bricht das ab.

## 2. Was in 4.0.1 bis 4.0.6 geändert wurde

### 4.0.1 · Aktienradar war außerhalb der Handelszeit leer
v4.0.0 legte den Radar bei `phase.key==='closed'` still (richtig, das war der Bandbreitenfresser), aber die Leseseite hatte ein hartes 4-Minuten-Fenster. Sobald der Cron nichts mehr schreibt, war der letzte Batch unsichtbar, obwohl er in D1 unter `stock_scan:last` liegt. Die Abfragezeit „01:00:00" war Epoch 0 in MESZ. Jetzt: `STOCK_SNAPSHOT_LIVE_MS` (4 min, „gilt als aktuell") getrennt von `STOCK_SNAPSHOT_MAX_AGE_MS` (72 h, „darf angezeigt werden"), Zustand ehrlich `ok` vs. `stale`.

### 4.0.2 · Premarket-Gap war eine Sitzung zu alt
`momentumFromAlpaca` nahm `snap.prevDailyBar.c` als Vortagesschluss. Das Feld ist nur der vorletzte Tagesbalken; solange auf IEX kein Trade des laufenden Tages gedruckt hat, ist `dailyBar` noch gestern. MRNA erschien deshalb mit +9,8 % statt −2,2 %. Neu: `alpacaPrevClose(snap, now)` entscheidet am **Datum**, fail-closed (kein Datum → keine Zeile). Zusatzfelder `prevCloseUsd`, `prevCloseDate`, `prevCloseField`.

### 4.0.5 · Doppelter Schlüssel `d1` in `/api/health`
Aus dem Build-Protokoll: `Duplicate key "d1"`. Das Objekt hatte `d1` zweimal — oben die Messung aus v3.32.9, unten ein `!!env.DB`. In JavaScript gewinnt der letzte Schlüssel, die Messung wurde also überschrieben. `/api/health` lieferte `d1: true` statt der Zeilenzählung. Der Wahrheitswert heißt jetzt `d1Bound`.

### 4.0.6 · Drei Punkte
1. **Plan auf altem Kurs wird entwertet.** Am 02.09. um 11:05 ET zeigte die Fokuskarte BWXT mit Entry 161,60 $ auf einer 19,2 Stunden alten Zeile, während der Titel real bei 156,16 $ stand. Neu: `planFreshness(r)` mit Schwelle `PLAN_STALE_MS = 20 min` (dieselbe Grenze, ab der `stockFreshness` „GECACHED" führt — bewusst kein zweiter Grenzwert). Ist die Zeile älter, erscheint über dem Zahlenraster der Hinweis „PLAN AUF ALTEM KURS · N Std. Alter" und die Werte werden gedämpft und durchgestrichen. Fail-closed: fehlender Zeitstempel gilt als veraltet.
2. **Coin-Karte hat jetzt einen Ausgang.** Spiegelbildlich zum Google-Finance-Link der Aktienkarte: `Bitpanda Fusion ↗` in der Fokuskarte, `B↗` in den Listenzeilen. **Wichtig:** Bitpanda dokumentiert kein Deeplink-Schema auf ein einzelnes Paar. Verlinkt wird der belegte Einstiegspunkt `https://web.bitpanda.com/fusion`; das Paar steht im Titeltext. Ein geratener Pfad wie `/trade/BTC-EUR` wäre schlimmer als kein Link. Sobald ein Schema belegt ist, ändert sich nur `bitpandaUrl()`.
3. **Beide Heatmaps teilen jetzt eine Geometrie.** Krypto stand auf `.stage{1fr 250px}` mit `aspect-ratio:1`, Aktien auf `.stockstage{1.7fr .8fr}` mit fester Höhe 215 px. Dieselbe 200×200-viewBox wurde dadurch einmal quadratisch und einmal gestaucht gezeichnet — gleiche Punktabstände bedeuteten in den zwei Feldern nicht dasselbe, obwohl die Achsen identisch beschriftet sind. Jetzt identisch in Spaltenaufteilung, Seitenverhältnis, Rahmen, Radius und Innenabstand.

## 3. Verifikation

`node --check` auf `src/worker.js`, `public/app.js`, `public/sw.js`; alle sechs Suiten grün (`safety`, `coinscope`, `provider`, `bandwidth`, `d1`, `sw`). Zusätzlich `npx wrangler deploy --dry-run` mit Wrangler 4.128.0 — derselbe Schritt, an dem der Build gescheitert war: sauber, keine Warnungen, `env.APP_VERSION ("4.0.6")`.

Neue ausgeführte Regressionstests in `tests/safety-regression.mjs`:
- **v4.0.2 Gap-Bezugstag** — mit den echten MRNA-Zahlen (154,27 statt 137,40; `gapPct ≈ −2,2`), nicht mit runden Platzhaltern.
- **v4.0.6 Plan-Alter / Coin-Link / Kartengeometrie** — `planFreshness` wird ausgeführt, nicht per Regex gesucht; `bitpandaUrl()` wird gegen erfundene Paar-Pfade geprüft; die CSS-Geometrie beider Karten wird verglichen und die alte feste Höhe ausdrücklich ausgeschlossen.

Dafür exportiert `src/worker.js` zusätzlich `alpacaPrevClose` und `momentumFromAlpaca`; `tests/client-harness.mjs` reicht `planFreshness`, `bitpandaUrl`, `bitpandaTitle`, `googleFinanceUrl` durch.

## 4. Offene Punkte

1. **Der Aktienfeed liefert während der Sitzung nicht.** Am 02.09. um 11:05 ET, mitten im regulären Handel, war die neueste Zeile 19 Stunden alt; Kopfzeile „Letzter guter Stand · Reconnect läuft", Aktien-Lampe gelb. Das ist die eigentliche Störung — die Anzeigefixes behandeln nur das Symptom. **Zuerst `/api/health` aufrufen und `bandwidth` ansehen.** Verdacht: das Tiingo-Bandbreitenkontingent (40 GB), das am 30.08. schon mit HTTP 429 zugemacht hat. Der `d1`-Zweig derselben Antwort liefert seit 4.0.5 wieder echte Zahlen statt `true`.
2. **Tiingo-`prevClose` auf denselben Fehler prüfen wie Alpaca.** `iexRadarQuote` (~Zeile 6713) nimmt `x.prevClose ?? x.previousClose`. Ob Tiingo dieselbe Rollover-Eigenheit im Premarket hat, lässt sich nur mit einem echten Abruf zwischen 04:00 und 09:30 ET belegen, nicht aus dem Code. Offen, nicht behauptet.
3. **Kaltstart-Lücke im Premarket.** `analyseStock` braucht ≥24 Fünf-Minuten-Bars; IEX bildet 04:00–08:00 ET kaum ab. Ohne analysierbare Bars bleibt `rows` leer, und `persistStockScan` schreibt bei leerem Array nichts. Bewusst nicht angefasst — ein künstlicher Seed wäre eine Zahl ohne Deckung. Seit 4.0.1 ist das Symptom entschärft, weil der Vortagesstand sichtbar bleibt.
4. **„Reife %" ist keine zweite Meinung.** `preSignalMaturity` summiert Score, CRV, RVOL, Situationsscore und Lebenszyklus-Bonus — dieselben Größen, die auch in den Score eingehen. Die Kachel liest sich wie eine unabhängige Bestätigung, ist aber dieselbe Aussage doppelt. Kandidat für eine ehrlichere Beschriftung.
5. **Bandbreite gegen den echten Kontostand prüfen**, nicht gegen `/api/health`. Die Eigenmessung ist eine *untere* Schranke; am 02.09. zeigte der reale Tiingo-Stand das 3,3-fache.

## 5. Kosten und Cloudflare-Plan

Aktuell **Workers Free**: es gibt keine Abrechnung, bei Erreichen der Limits wird abgewiesen. Kostenrisiko null.

Bei einem Upgrade auf Workers Paid (5 USD Mindestgebühr) wird Überschreitung **automatisch abgerechnet, ohne Rückfrage**. Budget-Alerts sind ausdrücklich nur informativ und deckeln nichts. Die einzigen harten Bremsen sind der auskommentierte `limits`-Block (`cpu_ms` deckelt Rechenzeit, `subrequests` deckelt Zugriffe — letzteres ist die wichtigere, weil D1-Wartezeit nicht zur CPU-Zeit zählt) und strukturell der Minutentakt des Crons: rund 43.200 Aufrufe im Monat.

## 6. Arbeitsweise (Nutzerwunsch)

Autonom arbeiten, kleine gezielte Änderungen, nach jedem relevanten Schritt testen, Fehler selbst beheben, nicht unnötig die ganze Codebasis neu einlesen. **Bei Releaseänderungen genau eine Datei ausgeben** — keine Release Notes, keine Word-/PDF-Zusammenfassungen, keine Kopien alter Versionen. Wenn das gesamte PWA-Verzeichnis gewünscht ist: ein ZIP, Inhalt ohne Unterebene, damit es direkt ins Repository-Root passt. Direkte Antworten mit eigener Einschätzung, keine Rückfragen am Ende.
