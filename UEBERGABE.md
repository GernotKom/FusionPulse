# FusionPulse — Übergabe an den nächsten Chat

Stand: 03.09.2026, Version **4.1.6**. Diese Datei liegt im Repository, damit sie beim nächsten Upload mitwandert.


---

## 0. Auslieferungsregel (gilt ab 4.1.4, Nutzerwunsch)

**Jede Version bringt drei Dinge mit: den Code, dieses Übergabeprotokoll und das Handbuch.** Damit lässt sich der Stand vollständig an einen neuen Chat übergeben, ohne den Verlauf mitzuschleppen.

Beides liegt **im Repository**, nicht nur im Chat:
- `UEBERGABE.md` — diese Datei. Bei jeder Version fortschreiben.
- `docs/FusionPulse_Handbuch.pdf` — erzeugt aus `scripts/build-handbuch.py`.

Ein Befehl erledigt den ganzen Release-Vorlauf:

```
npm run release      # sync-version  +  check (alle 6 Suiten)  +  handbuch
```

**Warum das Handbuch generiert und nicht getippt wird:** Die Versionsnummer kommt aus `package.json`, der Glossarteil wird aus dem `GLOSS`-Objekt in `public/app.js` geparst. Ein von Hand gepflegtes Glossar driftet zwangsläufig von der Anwendung weg und wird zur zweiten, stillen Wahrheit; eine eingetippte Versionsnummer veraltet unbemerkt, weil ein PDF nicht getestet wird. Bricht das Parsen ein, **bricht der Bau ab**, statt ein leeres Glossar zu drucken.

**Was Handarbeit bleibt:** Die Kapiteltexte in `scripts/build-handbuch.py` — Kacheln, Einstellungen, Datenquellen, Störungsbilder. Wer eine Kachel oder Einstellung hinzufügt, ergänzt dort den Abschnitt. Der Testlauf prüft, dass Handbuch, Übergabe und die beiden npm-Befehle existieren, aber er kann nicht prüfen, ob eine neue Kachel beschrieben wurde. Das bleibt Disziplin.

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


### 4.1.0 · Watchlist-Modus (Antwort auf das D1-Limit)
Am 02.09. um 10:32 meldete Cloudflare das tägliche D1-Limit von 100.000 `rows_written` als gerissen; Schreibvorgänge scheiterten bis 03.09. 00:00 UTC. **Kein Amoklauf, sondern Arithmetik:** 1.440 Cron-Läufe am Tag lassen 69 Zeilen je Lauf zu, und `rows_written` zählt **Indexeinträge mit** — `market_snapshots` trägt vier Indizes, ein INSERT kostet dort also fünf Zeilen. Zwanzig Snapshots pro Minute sind 144.000/Tag. Whole-Market passt nicht in den Free-Tarif.

Neu ist ein serverseitiger Schalter zwischen zwei Betriebsarten:
- **Radar** (unverändert): Whole-Market-Entdeckung, Deep Scan jede zweite Minute.
- **Watchlist**: ausschließlich die Favoriten des Nutzers, **jede Minute**, ohne Bulk-Radar (spart 11,2 MB je Abruf) und ohne BOATS.

Bausteine: `onlySymbols` in `tiingoStockSnapshot` (ersetzt die gesamte Kandidatenkür und wird **nicht** am Deep-Limit gekürzt — eine still beschnittene Watchlist wäre der schlimmste Fall), `readWatchlist`/`writeWatchlist` in `fp_meta` (kein neues Schema; der Cron braucht den Zustand serverseitig, ein Browser-Schalter wäre für ihn unsichtbar), Cron-Zweig, `GET/POST /api/watchlist`, Umschaltknopf neben dem Aktienfilter.

Dazu die Schreibschwelle `opts.onlyChanged` in `d1StoreRows`: ein Snapshot wird nur geschrieben, wenn der Kurs sich um ≥0,15 % bewegt hat oder die Ampel gewechselt ist. Fehlt ein Vergleichswert, wird geschrieben — ein unbekannter Zustand ist kein unveränderter.

**Fail-open an zwei Stellen:** Lesefehler ergeben `radar`, nicht `watchlist`; eine Watchlist ohne Symbole fällt auf `radar` zurück. Der Modus rührt Score, Ampel und BUY-Gates nicht an, er bestimmt nur die Titelauswahl. Die Oberfläche sagt ausdrücklich, dass eine leere Trefferliste hier „keine in deiner Auswahl" bedeutet und nicht „keine Gelegenheit am Markt".


### 4.1.1 · Zwei Betriebsbefunde
1. **Der Hinweis meldete „unbekanntem Alter", obwohl das Alter dastand.** Die Karte zeigte gleichzeitig „70756s alt" und „Daten 2026-09-01T19:55:00.000Z". Ursache: `raw.replace(' ','T')+'Z'` hängt ein Z an einen Zeitstempel, der bereits auf Z endet — `...000ZZ` ist ungültig, `Date.parse` gibt NaN. Die Ergänzung stammt aus der Zeit, als der Server `YYYY-MM-DD hh:mm:ss` ohne Zone lieferte. **Betroffen war nicht nur der neue Hinweis:** `stockFreshness` trug dieselbe Zeile und fiel deshalb immer in den Rückfallzweig „ANGEZEIGT / NICHT DIESE RUNDE" — die Schwellen für GECACHED (>20 Min.) und STALE (>24 Std.) waren praktisch unerreichbar. Jetzt ein Parser (`rowTs`), zwei Aufrufer; Rückfall auf `liveQuoteTs`, wenn `updated` fehlt.
2. **Die Heatmap sprang auf eine andere Punktmenge und wieder zurück.** Kein Datenfehler, ein Zustandsfehler: `stockMemo` lebt **im Isolate**, und Cloudflare verteilt Anfragen auf beliebig viele. Der normale Abruf liest den persistierten Scan und ist überall gleich; ein erzwungener Abruf (`force=1`, Knopf „↻ Aktie") umgeht ihn und rechnet auf dem gerade bedienenden Isolate, dessen Memo frisch und fast leer ist → kleinere Population, danach wieder die große. Gelöst nicht durch Beschneiden von `force`, sondern indem sich jedes Isolate aus dem gemeinsamen persistierten Stand impft, sobald sein Memo leer oder älter ist. Kostet einen D1-Lesevorgang, keine geschriebene Zeile.


### 4.1.3 · Die eigentliche Ursache des D1-Schreiblimits
**Befund:** Cloudflare setzte das Tageslimit am 03.09. um 00:00 UTC zurück — um 00:30 UTC waren die 100.000 Zeilen erneut verbraucht. Rund **3.300 Zeilen pro Minute**. Das ist keine Arithmetik mehr, sondern eine Schleife, und sie war älter als alle Änderungen der 4.0er- und 4.1er-Reihe.

**Ort:** `d1UpdateOutcomes`/`d1StoreRows`, der Resolver. Er lädt bis zu **3.000** offene Snapshots (`LIMIT 3000`) und aktualisierte **jeden einzelnen bedingungslos** — auch wenn `max_pct`, `min_pct`, `mae_pre` und alle drei Zeitstempel exakt dieselben Werte behielten. Ein Titel, der sich seit einer Stunde nicht bewegt, wurde sechzigmal mit identischem Inhalt überschrieben. SQLite schreibt die Tabellenzeile trotzdem neu, und `rows_written` zählt sie. Worst case 3.000 × 1.440 = 4,3 Mio. Zeilen/Tag; das Limit fällt damit in gut 30 Minuten.

**Fix:** Eine Änderungsprüfung vor dem `updates.push`. Geschrieben wird nur noch bei neuem Extrem oder bei einem Zeitstempel, der zum ersten Mal gesetzt wird (`success_ts`, `reach_ts`, `resolved_ts`). Auf vier Nachkommastellen gerundet, weil Gleitkomma-Rauschen sonst eine Änderung vortäuscht und der Fix wirkungslos bliebe. **Die Auswertung selbst ist unangetastet** — es wird nichts weggelassen, nur nichts Identisches wiederholt.


### 4.1.4 · Handbuch und Übergabe werden mitgeliefert
Neue Auslieferungsregel (siehe Kapitel 0). `scripts/build-handbuch.py` erzeugt `docs/FusionPulse_Handbuch.pdf` aus `package.json` (Version) und `public/app.js` (Glossar, 72 Einträge). Neue npm-Befehle `handbuch` und `release`. Der Testlauf prüft, dass beide Dokumente vorhanden sind, dass die Version gelesen statt eingetippt wird, dass der Bau bei kaputtem Glossar-Parsing abbricht — und dass die vier Deploy-Fallen (`src/worker.js`, Free-Plan, `sync-version`, `package-lock.json`) in dieser Übergabe stehen.

### 4.1.5 · „Reife %" hieß, als wäre sie eine zweite Meinung
Erledigt offenen Punkt 4 der 4.1.4-Übergabe. Die Kachel stand neben Score, CRV und Situation und las sich wie eine unabhängige Bestätigung. Sie ist aber der **Sortierschlüssel** — sie entscheidet die Reihenfolge und den Schnitt auf 100 Titel, sonst nichts.

**Die Zahl ist bitgenau unverändert.** Eine neue Formel wäre eine andere Titelauswahl ohne Beleg gewesen. Geändert wurde nur, was der Wert behauptet: `maturityBreakdown(row, lifecycle)` in `src/worker.js` (exportiert, eine Stelle statt inline) liefert zusätzlich `echo` und `fresh`; die Oberfläche zeigt über `maturityTag()` „Vorrang 78 · 62 bekannt + 16 neu" statt „Reife 78 %".

**Fail-closed:** Zeilen aus einem persistierten Scan vor 4.1.5 tragen die Aufteilung nicht. Sie wird dann **weggelassen und nicht im Client nachgerechnet** — eine zweite Formel im Browser wäre genau die stille Zweitwahrheit, die beim Glossar bereits beseitigt wurde.

**Zwei Befunde aus der Zerlegung, die vorher nicht sichtbar waren.** Die alte Formulierung „dieselben Größen wie im Score" war zu milde:
1. **Der CRV-Term ist praktisch eine Konstante.** `tp2 = entry + 3,35 · risk` ist feste Geometrie, das Brutto-CRV also *immer* 3,35; abgezogen werden nur Kosten. `min(1, crv/3)` steht damit bei nahezu jedem Kandidaten am Deckel — 20 Punkte, die die Skala anheben und nichts unterscheiden. Der Test hält das fest: CRV 3,0 und CRV 9,9 ergeben denselben Anteil.
2. **Das Volumen zählt doppelt.** `relVol` ist im Score bereits mit 20 % enthalten (`volScore`) und bekommt hier weitere 10 Punkte.

Von 100 Punkten tragen realistisch nur Phase (−14 bis +16) und Auslöserabstand (0 bis 10) etwas bei, das nicht schon daneben steht. **Das ist ein Kandidat für eine echte Formeländerung — aber erst, wenn es einen Beleg gibt, welche Rangfolge besser trifft.** Bis dahin bleibt die Zahl, wie sie ist, und sagt nur ehrlicher, was sie ist.

Nebenbefund miterledigt: „Reife" hieß auch der Bestätigungs-Streak in der Coin-Zeile — zwei verschiedene Dinge, ein Wort. Umbenannt in „Bestätigungen".

### 4.1.6 · Die Schwelle hing an einem von fünf Schreibpfaden
**Ausgangspunkt waren zwei Dashboard-Aufnahmen vom 03.09.** (06:55 und 09:03 UTC). Die Rekonstruktion gegen den Reset um 00:00 UTC:

| | Schreiben | Lesen | Abfragen |
|---|---|---|---|
| Mittel bis 06:55 UTC | 247/min | 2.699/min | 77/min |
| zwischen den Aufnahmen (128 min) | **7,8/min** | 156/min | 9,5/min |
| tragfähig für 24 h | 69/min | 3.472/min | — |

Die späte Rate über die 385 Minuten seit 00:30 UTC erklärt 3.008 Zeilen; beobachtet wurden 2.670. Das passt, und daraus folgt der eigentliche Befund: **die 100.000 Zeilen waren in den ersten ~30 Minuten nach dem Reset verbraucht — 3.333/min, exakt der 4.1.3-Befund.** Zu diesem Zeitpunkt lief noch der alte Code; 4.1.4 ging erst um 05:20 UTC live.

**Daraus folgt, was diese Zahlen NICHT zeigen: ob 4.1.3 wirkt.** Das Kontingent war vor dem Deploy erschöpft, alles danach ist ein Rinnsal hinter einer geschlossenen Tür. Die erste belastbare Messung ist der nächste Reset. Das Rinnsal von 7,8/min bei geschlossenem Kontingent zeigt übrigens, dass Cloudflare nicht hart abriegelt, sondern durchsickern lässt — verlässlich ist die Sperre trotzdem.

**Was beim Nachsehen auffiel und nicht gemessen werden muss, weil es im Code steht:** `opts.onlyChanged` war seit 4.1.0 vorhanden, getestet — und **nur im Watchlist-Zweig verdrahtet**. Radar-Deep-Scan, Krypto, Opening und Twelve Data schrieben unverändert weiter. Radar ist der Ausfallzustand von `readWatchlist`, also lief die Schwelle bei jedem Nutzer ins Leere, der nicht ausdrücklich umgeschaltet hatte. Jetzt tragen alle fünf Pfade sie; ein Test läuft über **alle** `d1StoreRows`-Aufrufe und fällt beim ersten ohne Schwelle.

**Nebenwirkung auf der Leseseite, die den Aufwand mit rechtfertigt:** greift die Schwelle, kehrt `d1StoreRows` vor der `LIMIT 3000`-Abfrage zurück. Ein übersprungener Schreibvorgang spart damit auch bis zu 3.000 gelesene Zeilen.

**Vorbedingung war der Schlüssel des Memos.** `snapshotWriteMemo` war nur nach Symbol geschlüsselt. Für einen einzigen Pfad reicht das; sobald Krypto dazukommt, wären „LINK" die Aktie und „LINK" die Münze derselbe Eintrag und die eine unterdrückte den Schreibvorgang der anderen. Der Schlüssel trägt jetzt Quelle und Anlageklasse — dieselbe Zusammensetzung wie der UNIQUE-Index von `market_snapshots`. Die Entscheidung selbst steht in `snapshotWriteDecision()` und ist damit ausgeführt prüfbar.

**Der Zähler maß die falsche Seite.** Seit 3.32.9 wies `/api/health` nur `readShareOfFreeLimit` aus. Gerissen ist zweimal das *Schreib*-Limit — die Kennzahl, die die App angehalten hat, stand nirgends, und „Lesequote 22 %" liest sich dabei wie Entwarnung. Neu: `freeLimitRowsWritten`, `writeShareOfFreeLimit`, `atLeastRowsWrittenPerMin` neben `sustainableRowsWrittenPerMin` (69,4), `atLeastProjectedRowsWritten`, `writeBudgetMinutesLeft` und `writeBudgetHoldsToday`. Gerechnet wird gegen 00:00 UTC, nicht gegen die Ortszeit. Alle Projektionsfelder heißen `atLeast…`, weil die Eigenmessung `.first()`-Abfragen nicht erfasst und deshalb eine **Untergrenze** bleibt.

## 3. Verifikation

`node --check` auf `src/worker.js`, `public/app.js`, `public/sw.js`; alle sechs Suiten grün (`safety`, `coinscope`, `provider`, `bandwidth`, `d1`, `sw`). Zusätzlich `npx wrangler deploy --dry-run` mit Wrangler 4.128.0 — derselbe Schritt, an dem der Build gescheitert war: sauber, keine Warnungen, `env.APP_VERSION ("4.0.6")`.

Neue ausgeführte Regressionstests in `tests/safety-regression.mjs`:
- **v4.0.2 Gap-Bezugstag** — mit den echten MRNA-Zahlen (154,27 statt 137,40; `gapPct ≈ −2,2`), nicht mit runden Platzhaltern.
- **v4.0.6 Plan-Alter / Coin-Link / Kartengeometrie** — `planFreshness` wird ausgeführt, nicht per Regex gesucht; `bitpandaUrl()` wird gegen erfundene Paar-Pfade geprüft; die CSS-Geometrie beider Karten wird verglichen und die alte feste Höhe ausdrücklich ausgeschlossen.

- **v4.1.5 Vorrang statt Reife** — 3.000 Rasterfälle vergleichen `maturityBreakdown` gegen eine **bewusst duplizierte** wörtliche Abschrift der 4.1.4-Formel. Die Duplikation ist der Punkt: ein Test, der dieselbe Funktion aufruft, könnte keine Drift sehen. Dazu Rekonstruktion `echo + fresh ≈ value`, der CRV-Deckel-Befund, der negative Phasenanteil als Abzug, und der Fail-closed-Fall ohne gelieferte Zerlegung.

- **v4.1.6 Schreibschwelle und Schreibbudget** — `snapshotWriteDecision` ausgeführt: unbekannt schreibt, 0,05 % nicht, 0,2 % wieder, Ampelwechsel auch ohne Kursbewegung. Die Vergleichsbasis ist der zuletzt **geschriebene** Zustand, nicht der zuletzt gesehene (drei Schritte zu 0,05 % lösen beim dritten aus, weil er von der Basis aus 0,16 % entfernt ist). Aktie und Münze mit demselben Ticker erhalten getrennte Einträge. Ein Durchlauf über **alle** `d1StoreRows`-Aufrufe im Worker fällt beim ersten ohne `onlyChanged`. Der Zähler wird in `tests/d1-usage.mjs` (NK60/NK61) gegen einen festen Ablesezeitpunkt gerechnet, unter `TZ=Europe/Vienna` und `TZ=America/Chicago` geprüft.

**Negativkontrollen zu 4.1.6**, alle fünf haben gefeuert und wurden zurückgesetzt:
- `onlyChanged` im Radar-Pfad entfernt → der Durchlauf über die Schreibpfade fällt.
- Memo-Schlüssel zurück auf nur das Symbol → die Münze wird von der gleichnamigen Aktie unterdrückt, der Test fällt.
- Vergleichsbasis bei verworfenem Abruf mitwandern lassen → die Schwellentests fallen.
- Hochrechnung auf feste 1.440 Minuten statt verstrichener Zeit → NK60 fällt.
- `writeBudgetHoldsToday` fest auf `true` → NK61 fällt.

Dafür exportiert `src/worker.js` zusätzlich `alpacaPrevClose`, `momentumFromAlpaca`, `maturityBreakdown` und `snapshotWriteDecision`; `tests/client-harness.mjs` reicht `planFreshness`, `bitpandaUrl`, `bitpandaTitle`, `googleFinanceUrl` und `maturityTag` durch.

**Negativkontrollen zu 4.1.5** (Regel 6 aus dem README), alle drei haben gefeuert und wurden zurückgesetzt:
- Koeffizient `q/8*38` → `q/8*39` im Worker → der Rastertest fällt („der Vorrang hat sich verändert").
- `const split = true` im Client erzwungen → der Fail-closed-Test fällt („ohne gelieferte Zerlegung darf keine erfunden werden").
- `row.maturityEcho=mb.echo` entfernt → der Verdrahtungstest fällt („der bekannte Anteil muss an der Zeile hängen").

Eine ältere Regex-Zusicherung auf die Inline-Formel (`safety-regression.mjs`, Zeile 329) musste leerzeichentolerant werden, weil die Formel jetzt in einer Funktion steht. Der Anspruch bleibt derselbe; die Werte prüft der 4.1.5-Block ausgeführt nach.

## 4. Offene Punkte

1. **Der Aktienfeed liefert während der Sitzung nicht.** Am 02.09. um 11:05 ET, mitten im regulären Handel, war die neueste Zeile 19 Stunden alt; Kopfzeile „Letzter guter Stand · Reconnect läuft", Aktien-Lampe gelb. Das ist die eigentliche Störung — die Anzeigefixes behandeln nur das Symptom. **Zuerst `/api/health` aufrufen und `bandwidth` ansehen.** Verdacht: das Tiingo-Bandbreitenkontingent (40 GB), das am 30.08. schon mit HTTP 429 zugemacht hat. Der `d1`-Zweig derselben Antwort liefert seit 4.0.5 wieder echte Zahlen statt `true`.
2. **Tiingo-`prevClose` auf denselben Fehler prüfen wie Alpaca.** `iexRadarQuote` (~Zeile 6713) nimmt `x.prevClose ?? x.previousClose`. Ob Tiingo dieselbe Rollover-Eigenheit im Premarket hat, lässt sich nur mit einem echten Abruf zwischen 04:00 und 09:30 ET belegen, nicht aus dem Code. Offen, nicht behauptet.
3. **Kaltstart-Lücke im Premarket.** `analyseStock` braucht ≥24 Fünf-Minuten-Bars; IEX bildet 04:00–08:00 ET kaum ab. Ohne analysierbare Bars bleibt `rows` leer, und `persistStockScan` schreibt bei leerem Array nichts. Bewusst nicht angefasst — ein künstlicher Seed wäre eine Zahl ohne Deckung. Seit 4.0.1 ist das Symptom entschärft, weil der Vortagesstand sichtbar bleibt.
4. **Bandbreite gegen den echten Kontostand prüfen**, nicht gegen `/api/health`. Die Eigenmessung ist eine *untere* Schranke; am 02.09. zeigte der reale Tiingo-Stand das 3,3-fache.
5. **Der Vorrang wäre auch inhaltlich zu verbessern** — nachgezogen aus dem erledigten Punkt 4. Die Beschriftung ist seit 4.1.5 ehrlich, die Formel bleibt schwach: der CRV-Term unterscheidet fast nichts (siehe 4.1.5), das Volumen zählt doppelt. Eine bessere Rangfolge wäre denkbar, **aber sie braucht einen Beleg** — welche Reihenfolge trifft im Nachhinein besser? Die Daten dafür liegen in `snapshots` (Modul 0, `/api/attribution`). Ohne diese Auswertung wäre jede neue Gewichtung nur eine andere Meinung, und die Titelauswahl änderte sich ohne Grund.

6. **Die erste belastbare Messung der Schreibrate steht noch aus.** Alles bis 03.09. ist unbrauchbar, weil das Kontingent vor dem Deploy von 4.1.3/4.1.4 erschöpft war (siehe 4.1.6). Der nächste Reset um 00:00 UTC ist der erste ehrliche Lauf. Seit 4.1.6 beantwortet die App das selbst: `/api/health` → `d1` → `atLeastRowsWrittenPerMin` gegen `sustainableRowsWrittenPerMin` (69,4) und `writeBudgetHoldsToday`. Fällt die Rate nicht deutlich unter die 3.333/min vom 03.09., wirkt 4.1.3 nicht und der nächste Schritt ist `topQueries` im selben Zweig — der Zähler weist seit 3.32.9 nach Abfrageform aus, welche Form verbraucht.
7. **`d1StoreSnapshotRow` und `d1UpdateOutcomes` haben keinen Aufrufer mehr.** Gefunden bei der 4.1.6-Analyse. `d1UpdateOutcomes` trägt eine eigene `LIMIT 500`-Abfrage **pro Symbol** und liest wie ein zweiter, lebender Auflöser neben `d1StoreRows` — genau die Sorte Fund, die beim nächsten Bandbreitenproblem falsch verdächtigt wird. Bewusst nicht gelöscht: totes Entfernen ist eine eigene Änderung mit eigenem Risiko, und die Suite deckt diesen Pfad nicht ab. Vor dem Löschen prüfen, ob die Aufrufer wirklich alle weg sind (`grep -n 'd1StoreSnapshotRow('`).

**Erledigt in 4.1.5:** der frühere Punkt 4 („Reife %" liest sich wie eine zweite Meinung).
**Erledigt in 4.1.6:** die Änderungsschwelle greift auf allen fünf Schreibpfaden, nicht nur im Watchlist-Zweig.

## 5. Kosten und Cloudflare-Plan

Aktuell **Workers Free**: es gibt keine Abrechnung, bei Erreichen der Limits wird abgewiesen. Kostenrisiko null — aber am 02.09. wurde das tägliche D1-Schreiblimit gerissen, weshalb der Watchlist-Modus aus 4.1.0 entstanden ist.

**Korrektur in 4.1.6 zur bisherigen Aufstiegsrechnung.** Hier stand, der Betrieb liege bei geschätzt 6–9 Mio. Writes/Monat und damit bei 15–18 % der auf Paid enthaltenen 50 Mio. **Diese Zahl war nie gemessen.** Die einzige tatsächlich gemessene Rate ist die vom 03.09.: 3.333 geschriebene Zeilen pro Minute. Ungebremst hochgerechnet sind das rund 144 Mio. pro Monat — knapp das Dreifache des Enthaltenen, und auf Paid würde die Überschreitung ohne Rückfrage abgerechnet. Ob 4.1.3 und 4.1.6 das auf ein tragfähiges Maß drücken, ist noch nicht gemessen (offener Punkt 6).

**Praktische Folge: vor dem Aufstieg auf Paid erst die echte Rate messen.** Auf Free ist ein Fehler ein Stillstand, auf Paid ist derselbe Fehler eine Rechnung — und genau diese Sorte Schreibschleife ist in dieser App innerhalb einer Woche zweimal aufgetreten. Der Reihenfolge nach: erst eine saubere Tagesmessung unter 69 Zeilen/min, dann der `limits`-Block, dann der Aufstieg.

Bei einem Upgrade auf Workers Paid (5 USD Mindestgebühr) wird Überschreitung **automatisch abgerechnet, ohne Rückfrage**. Budget-Alerts sind ausdrücklich nur informativ und deckeln nichts. Die einzigen harten Bremsen sind der auskommentierte `limits`-Block (`cpu_ms` deckelt Rechenzeit, `subrequests` deckelt Zugriffe — letzteres ist die wichtigere, weil D1-Wartezeit nicht zur CPU-Zeit zählt) und strukturell der Minutentakt des Crons: rund 43.200 Aufrufe im Monat.

## 6. Arbeitsweise (Nutzerwunsch)

Autonom arbeiten, kleine gezielte Änderungen, nach jedem relevanten Schritt testen, Fehler selbst beheben, nicht unnötig die ganze Codebasis neu einlesen. **Bei Releaseänderungen genau eine Datei ausgeben** — keine Release Notes, keine Word-/PDF-Zusammenfassungen, keine Kopien alter Versionen. Wenn das gesamte PWA-Verzeichnis gewünscht ist: ein ZIP, Inhalt ohne Unterebene, damit es direkt ins Repository-Root passt. Direkte Antworten mit eigener Einschätzung, keine Rückfragen am Ende.
