# FusionPulse — Übergabe an den nächsten Chat

Stand: 05.09.2026, Version **4.4.1**. Diese Datei liegt im Repository, damit sie beim nächsten Upload mitwandert.


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

### 4.1.7 · Die Zahl stand nur im Roh-JSON
4.1.6 hat das Schreibbudget messbar gemacht — abzulesen war es aber nur über `/api/health?t=…` von Hand in der Adresszeile. Das ist **derselbe Rat, den v3.32.5 schon einmal als schlecht erkannt hat**: enthält der Token ein `+`, `&`, `#`, `/` oder `%`, zerlegt der Browser die Adresse falsch, der Server lehnt ab, und es sieht nach einem kaputten Token aus. Dieselbe Lehre, zweite Anwendung.

Neu: `d1Note()` im Client, gebaut wie `bandwidthNote()`. Sichtbar im **Lernbericht** unter den Beobachtungszahlen (`Schreibbudget: 12.340 von 100.000 (12 %)`), mit Takt, tragfähigem Takt und Restlaufzeit im Hilfetext; dieselbe Zeile zusätzlich im Hilfetext der Systemleiste.

Fail-closed in vier Fällen, jeder einzeln geprüft: kein `d1`-Zweig, `measured:false`, fehlende Zahlen, Nenner 0. In allen vieren steht „nicht gemessen", **kein Prozentwert** und der ausdrückliche Hinweis, dass daraus nicht auf Reserve geschlossen werden darf. Ohne Token heißt es „nicht abrufbar", nicht „null verbraucht".

Der Test hat dabei eine Unstimmigkeit gefunden, die vorher niemand gesehen hätte: einer der vier Zweige trug den Warnsatz nicht. Korrigiert.

### 4.1.8 · Die Fehlmeldung schickte zum falschen Konto
Ausgangspunkt war die Frage, ob die App beim Erreichen des Limits stoppt. Antwort: sie stoppt nicht, und abzuschalten ist auch nichts — **sie meldet nur das Falsche.**

Cloudflare meldet das erschöpfte Kontingent als `D1_ERROR: Your account has exceeded D1's free tier daily row write limit.` Dieser Text enthält „daily", also stufte `classifyError` ihn als `daylimit` ein. Und weil `d1StoreRows()` im selben try-Block liegt wie der Datenabruf, landete die Einstufung auf der Lampe der **Datenquelle**. Das Modal behauptete daraufhin „Twelve Data: Tageslimit erreicht · Für heute sind keine Aktien-Credits mehr verfügbar" — bei einem Betrieb auf Tiingo, dessen Anbieter einwandfrei geantwortet hatte.

Eine Fehlmeldung, die zum falschen Konto schickt, ist teurer als gar keine: man prüft den Anbieter, findet nichts, und die Ursache läuft weiter. Sie hat vermutlich zur bisherigen Verwirrung um offenen Punkt 1 beigetragen.

Neu: eigener Zustand `dblimit`, geprüft **vor** der `daily`-Regel. Alle sechs Cron-Fänger laufen jetzt über `noteProviderFailure()`, das bei `dblimit` die Anbieterlampe unberührt lässt und unter `d1` protokolliert — der Abruf war ja erfolgreich. Eigener Modaltext, der die Datenbank nennt, den Reset um 00:00 UTC angibt und ausdrücklich sagt, dass nichts abgeschaltet werden muss.

### 4.2.0 · Session-VWAP je Symbol, Benchmark statt Breadth
Drei Befunde aus der Analyse, bevor Code entstand:

**1. „Risk-On · 80 % über VWAP" ist Krypto, nicht Aktien.** Der Wert entsteht in `worker.js:772` im Krypto-Scanner (`analyse()`, Bitpanda-Paare, `btcTrend` in der Schwelle) und steht im globalen `<header>` — also auch sichtbar, während eine Aktie im Fokus liegt. Gleichzeitig nennt die Market-Recommendation-Karte darunter die US-Aktien-Breadth aus `aladdinRegime` mit **identischer Formulierung**. Zwei Zahlen, zwei Universen, ein Bildschirm, keine nennt ihres. Behoben durch Beschriftung: „Krypto · …" und „US-Aktien: … der Stichprobe über VWAP", plus Warnung im Glossareintrag.

**2. Ein Symbol-VWAP existierte, war aber nicht sitzungsverankert.** `worker.js:1545` rechnet über `bars.slice(-26)` — ein rollendes 130-Minuten-Fenster. Um 10:00 ET stammen 6 dieser Bars aus der laufenden Sitzung und 20 aus dem Vortagsschluss. Neu ist `sessionVwap()`: Fenster 09:30–16:00 ET des laufenden ET-Handelstags, Grenze **einmal** als Epoch-ms berechnet (`Intl.formatToParts` pro Bar wären 78 × 100 Aufrufe je Zyklus).

**Das alte Feld bleibt unverändert.** `vwapUsd`/`aboveVwap` speisen Score (0,20), `SITU_W`, `reclaimVwap` und `aladdinRegime.vwapBreadth`. Ein Austausch verschöbe Score, Ampel, Titelauswahl und Marktregime gleichzeitig — ohne Beleg, dass die neue Rangfolge besser trifft. Der neue Wert ist reine Anzeige. Tests halten beides fest.

**Der Preis ist Verfügbarkeit.** Um 09:35 ET existiert ein Bar; unter drei Bars steht `UNAVAILABLE`. Der rollende VWAP hatte dieses Problem nie, weil er sich still beim Vortag bedient hat — genau deshalb war er stabil und falsch.

**3. Relative Stärke gegen SPY, nicht gegen die Breadth.** Zwei Gründe, beide in den Daten:
- Die Breadth entsteht aus `stockMemo.rows` — Titel, die der Deep-Scan ausgewählt hat, *weil* sie sich bewegen. Als Referenz ist sie nach oben verzerrt; „Markt stark, Aktie schwach" feuerte systematisch zu oft.
- Sie zählt `r.aboveVwap`, also den rollenden Wert. Ihre Differenz zum neuen sitzungsverankerten Symbolwert enthielte zuerst einen Definitionsunterschied und erst danach vielleicht ein Signal — am stärksten morgens.

`benchmarkSessionVwap()` holt SPY einmal je Deep-Scan (4 Minuten gecacht, ein Tiingo-Abruf), gleiche Formel, gleicher Anker, keine Vorauswahl. `relativeVwapStrengthPct` ist null, sobald eine Seite nicht VALID ist — nie null als Zahl.

**Nicht angefasst, bewusst:** `marketRecommendation` (`worker.js:6150/6151`) koppelt Regime und `aboveVwap` bereits — und bestraft „Risk-Off + über VWAP" mit −0,15, also genau die Konstellation, die als relative Stärke gilt. Das ist ein Regimefilter, kein Relative-Strength-Maß; beides kann sich keine Zahl teilen. `vwapDistancePct`, `vwapState` und `relVwapStrengthPct` werden ab jetzt in `market_snapshots` mitgeschrieben, damit `/api/attribution` überhaupt erst beantworten kann, ob die Divergenz out-of-sample etwas wert ist.

### 4.2.1 · Tagesobergrenze für Schreibvorgänge
Der letzte Baustein vor einem Wechsel auf Workers Paid. **Cloudflare bietet für D1 keine Ausgabenobergrenze** — Budget-Alerts informieren, sie halten nichts an. Auf Free ist ein Schreibfehler ein Stillstand; auf Paid ist derselbe Fehler eine Rechnung. Die Schleife vom 02./03.09. lief bei 3.333 Zeilen/min: auf Paid rund 144 Mio./Monat, knapp das Dreifache der enthaltenen 50 Mio., etwa 94 USD Überschreitung für einen Fehler, den man erst auf der Abrechnung sieht.

`D1_WRITE_BUDGET` in `wrangler.jsonc`, Vorgabe **90.000/Tag**. Bewusst unter Cloudflares 100.000, weil die Eigenmessung eine Untergrenze ist und die Bremse deshalb ohnehin zu spät greift. Für Paid steht der Richtwert im Kommentar: 50 Mio./Monat sind rund 1.667.000/Tag, ein Wert um 1.500.000 bleibt sicher darunter.

**Vier Entwurfsentscheidungen, die begründet werden müssen:**

1. **Die Prüfung steht VOR der Leseabfrage.** `d1StoreRows` liest bis zu 3.000 unaufgelöste Zeilen, bevor es schreibt. Eine Bremse dahinter hätte die Kosten gebremst und die Leseseite laufen lassen. Ein Test prüft die Reihenfolge in beiden Schreibern per Index.

2. **Die Bremse hält ihre eigene Anzeige nicht mit an.** Gestoppt werden nur die großen Schreiber; `d1MeterFlush` und die Zustandsschreiber in `fp_meta` laufen weiter. Sonst fröre genau die Zahl ein, die die Bremsung sichtbar macht. Zwei Tests halten das fest — auf den *Aufruf*, nicht auf die Erwähnung, weil der Flush die Bremse im Kommentar nennt.

3. **Fail-OPEN beim Lesen, bewusst gegen den Reflex.** Ist der Tagesstand nicht lesbar, wird geschrieben. Fail-closed klänge sicherer, wäre es aber nicht: ein einzelner Lesefehler legte die Lernschicht für den Rest des Tages still, und dieser Zustand ist von einem echten Ausfall nicht zu unterscheiden. Ein Lesefehler auf D1 bedeutet ohnehin meist, dass auch die Schreibvorgänge scheitern.

4. **Kein zusätzlicher Verbrauch.** `d1MeterFlush` gibt den frischen Tagesstand über `d1CapNoteMeter()` direkt an die Bremse zurück. Eine eigene Abfrage entsteht nur einmal je Isolate bzw. bei Datumswechsel — ohne diesen einen Lesevorgang schriebe ein frisch gestartetes Isolate seinen ersten Lauf ungebremst.

**Sie ist eine Bremse, keine Garantie.** Der Zähler zählt `.first()`-Abfragen nicht mit; die Grenze greift später als bei vollständiger Messung. Sie ist mit Abstand zu setzen, nicht auf die Kante. Die Anzeige misst ab jetzt gegen die selbst gesetzte Grenze und nennt im Hilfetext ausdrücklich, dass es nicht das Tariflimit ist.

### 4.2.2 · Beides stand da, beides war unsichtbar
Befund aus dem Betrieb (Screenshot 03.09., 21:20, v4.2.1 live). Zwei Meldungen, eine Ursache.

**Das Schreibbudget stand auf dem falschen Tab.** `renderLearningReport` schreibt es nach `#learningReport`, und das liegt im Tab „Lab / Learning". Auf „Aktien", wo täglich gearbeitet wird, war die Zahl unsichtbar — ausgerechnet die, an der die Tarifentscheidung hängt. Jetzt steht sie als `DB 12k/90k` in der Systemleiste, die auf allen Ansichten sichtbar ist, mit Ampel und vollem Hilfetext.

**Die VWAP-Kachel fehlte ersatzlos.** `vwapNote` gab `null` zurück, wenn der Datensatz die Felder nicht trägt — die Kachel verschwand dann spurlos. Genau das trat im wichtigsten Fall ein: die Oberfläche wird aus dem **persistierten** Scan bedient (`stock_scan:last` in `fp_meta`, `worker.js:7769`). Kann der Cron nicht mehr schreiben, friert dieser Stand ein und liefert weiter Zeilen von vor 4.2.0. Die App sah aus, als gäbe es die Funktion nicht.

Neuer Zustand `PENDING`: Platz bleibt sichtbar, Strich statt Zahl, und der Hilfetext nennt die eigentliche Ursache samt Verweis auf das Schreibbudget. Nach wie vor wird **nichts im Browser nachgerechnet**.

**Die gemeinsame Lehre:** ein Feld, das bei einer Störung spurlos verschwindet, ist schlechter als eines, das die Störung benennt. Dasselbe gilt für den Kurzwert in der Leiste — eine fehlende Messung steht dort als „DB n. gem.", nicht als Leerstelle, weil eine Leerstelle wie „alles in Ordnung" aussieht.

**Zusammenhang, der dabei sichtbar wurde:** Das D1-Schreiblimit hält nicht nur die Lernschicht an. Weil der angezeigte Scan über `fp_meta` persistiert und von dort ausgeliefert wird, friert bei blockierten Schreibvorgängen auch die **Anzeige samt Heatmap** ein — „0 aktualisiert", Kurse von vorgestern, identische Punktwolke bei jedem Start. Das ist kein Anzeigefehler, sondern dieselbe Ursache.

### 4.2.3 · Die Lernschicht hat nichts gelernt, weil ein Draht durchtrennt war

**Das ist der schwerwiegendste Befund seit Beginn dieser Übergabe.** Er ist statisch belegt und ausgeführt nachgestellt, nicht vermutet.

**Die Kette.** Die einzige Anweisung im gesamten Worker, die je `obs_n` beschrieben hat, stand in `d1UpdateOutcomes`. Diese Funktion hatte genau einen Aufrufer, `d1StoreSnapshotRow` — und der hatte keinen. Das ist der bisherige offene Punkt 8, dort aber nur als aufzuräumender Altbestand geführt. Der lebende Schreibpfad ist seit langem `d1StoreRows`, und der führt `obs_n` weder im INSERT noch im UPDATE mit.

Folge: **jede Zeile in `market_snapshots` trug dauerhaft `obs_n IS NULL`.** `d1ResolveDue` verlangt `obs >= LEARN_MIN_OBS` (6). Ausgeführt gegen den Prüfstand mit `obs_n:null`:

```
{ due: 3, resolved: 0, dropped: 3 }
```

Null Prozent ausgewertet, hundert Prozent `dropped_ts`, und `dropped_ts` ist unwiderruflich. **Damit hängen die offenen Punkte 6 und 7 an einer Tabelle, in der nichts auswertbar steht.**

**Zweiter durchtrennter Draht, gleiche Ursache.** `learnCountersBump({snapshots})` stand ebenfalls ausschließlich in `d1StoreSnapshotRow`. Der lebende Pfad hat eingefügt und nie gezählt; die Beobachtungszahl im Bericht konnte gar nicht wachsen.

**Dritter, eine Ebene weiter.** `learnCountersView` liefert `dropped` und `dropped24h` seit v3.32.10. `learningPayload` hat sie nie in die Nutzlast übernommen, und `public/app.js` kannte das Wort `dropped` kein einziges Mal. Gezählt, transportiert, weggeworfen.

**Warum es niemandem auffiel — der teuerste Teil.** Ein Verwurf ist ein legitimer Zustand. Er liest sich als „zu wenig beobachtet", also als Abdeckungsproblem, das man mit dichterem Scannen löst. Genau diese Diagnose stand auch im Kommentar zur Radar-Kadenz: *„Der Deep Scan wird nicht gedrosselt: er ist es, der `obs_n` füllt."* Eine richtige Schlussfolgerung aus einer falschen Prämisse — die unangenehmste Sorte, weil sie jede Nachfrage beantwortet. Dazu erzeugte das gerissene D1-Schreiblimit dieselben Nullen. Zwei Ursachen, ein Symptombild, und die eine Zahl, die sie unterschieden hätte, kam nie im Browser an.

**Warum KEIN Zähler in der Zeile.** Naheliegend wäre, `obs_n` in das UPDATE von `d1StoreRows` aufzunehmen. Das ist genau der Widerspruch, der den Fehler überleben ließ: ein persistierter Zähler kann nur wachsen, wenn die Zeile geschrieben wird — und 4.1.3/4.1.6 existieren, um die unveränderte Zeile *nicht* zu schreiben. Beides zusammen ergäbe wieder die Schleife mit 3.333 Zeilen/min. **Zähler und Schreibschwelle schließen einander konstruktiv aus.**

**Deshalb wird die Abdeckung hergeleitet.** `d1NoteObservations` führt je Quelle und Anlageklasse ein Protokoll in `fp_meta` (`obs_log:{source}:{assetType}`): welches Symbol wann gesehen wurde, auf `bucket5` gerastert und auf Horizont + 60 min beschnitten. Höchstens ein Schreibvorgang je 5-Minuten-Takt und Pfad — rund 288/Tag statt 1.440, also ein niedriger vierstelliger Anteil des Tagesbudgets von 90.000. Der Auflöser liest daraus (`obsCountFor`) und nimmt den höheren Wert aus Protokoll und `obs_n`, falls die Spalte je wieder gefüllt wird.

**Die Reihenfolge im Aufrufer ist der Punkt.** Protokolliert wird **vor** `onlyChanged`. Beobachtet wurde jedes abgerufene Symbol, auch das ruhige. Stünde das Protokoll hinter der Schwelle, zählte nur noch Bewegung als Beobachtung, und die Lernbasis füllte sich systematisch mit Bewegern — dieselbe Verzerrung, vor der R3 warnt, mit umgekehrtem Vorzeichen. NK73 prüft die Reihenfolge per Index.

**Zwei Fehlerarten, die sich ähnlich anfühlen und getrennt behandelt werden.** Antwortet die Datenbank nicht, ist die Abdeckung unbekannt: der Auflöser entscheidet dann **gar nichts** und schiebt auf. Das ist ausdrücklich nicht „im Zweifel verwerfen" — `dropped_ts` ist unwiderruflich, der Auflöser läuft jede Minute, ein Aufschub kostet nichts. Ist dagegen der *Inhalt* unbrauchbar (kaputtes JSON), gilt er als lesbar und leer. Anders ginge auch der Schreiber nicht mehr an dem Wert vorbei, der ihn blockiert — er liest vor dem Schreiben —, und ein einziges Zeichen legte das Protokoll dauerhaft still.

**Sichtbar gemacht.** Neue Zeile im Lernbericht: `Abdeckung 24 h: 61 ausgewertet · 18 verworfen (77 %)`, mit Ampel und vollem Hilfetext. Fail-closed in vier Fällen mit „nicht gemessen" und **ohne** Prozentwert. Der erste Testlauf hat dabei sofort ein Loch gefunden: `Number(null)` ist 0, eine fehlende Verwurfszahl galt also als „null Verwürfe" — Entwarnung aus Unwissen. Korrigiert.

**Aufgeräumt.** `d1UpdateOutcomes` und `d1StoreSnapshotRow` entfernt (offener Punkt 8 erledigt), Snapshot-Zähler im lebenden Pfad verdrahtet, die zwei Kommentare mit falscher Prämisse korrigiert.

### 4.2.4 · Vier Betriebsbefunde aus der Coin-Seite

Gemeldet wurden drei Dinge. Zwei bestätigten sich, eines traf anders zu als vermutet. Alle vier Befunde sind gerechnet oder ausgeführt belegt.

**1. „Die Coin-Suche fehlt komplett."** Sie fehlte nicht — sie war unerreichbar. Das Feld `#q` und die Filteroption `★ Coin-Favoriten` stehen seit langem in `index.html`. Nur hatte `.coinbar` kein Sprungziel in `VIEW_SECTIONS.coins`: „Coin-Liste" springt auf `main` und damit **an der Leiste unmittelbar darüber vorbei**, die danach oben aus dem Bild ist.

**2. Ein Favorit kam nie am Server vorbei.** Von 216 EUR-Paaren werden `deep` (20) tief gescannt, ausgewählt nach Umsatz × Tagesrange. Ein Favorit ohne Umsatzdruck fällt heraus und existiert in `rows` nicht — der Filter hat nichts zu filtern, die Suche nichts zu finden, die Heatmap zeichnet nichts. `runScan` kennt seit jeher `watch` und setzt diese Paare vor die Umsatzrangfolge; verdrahtet war der Parameter nur mit dem Einstellungsfeld.

Ein reiner Browser-Parameter hätte nicht gereicht: der Cron rief `getSnapshot(env, {}, true)` mit leeren Optionen auf und schreibt den Stand nach `crypto_scan:last`, aus dem die Oberfläche zwischen zwei eigenen Scans bedient wird. **Dieselbe Lehre wie beim Watchlist-Modus in 4.1.0**, deshalb dasselbe Muster: `focus:coinwatch` in `fp_meta`, Route `/api/coinwatch`, Cron liest mit. Dazu `mergeFavoriteCoinRows`, damit ein Favorit sichtbar bleibt, den der laufende Durchlauf nicht gewählt hat — **`buyReady()` gibt auf `_remembered` niemals frei**, sonst erzeugte ausgerechnet die Sichtbarkeitshilfe ein grünes Signal auf altem Kurs.

**3. „BTC trendet mit >5 % und steht nicht in der Heatmap."** BTC stand darin — unter APT und XRP. `runScan` setzt `BTC-EUR` an die **erste** Stelle der Auswahl; es ist immer im Scan. Die Ursache ist ein Maßstabsfehler in der Kollisionstrennung: der Mindestabstand war `radA + radB + 2,5` (12–17 Einheiten, gerechnet für Kreise mit Radius 4,5–7,7), die Aufschrift darunter ist bei `font-size: 5.8px` aber bis zu **18 Einheiten breit und nur 6 hoch**. Punkte konnten sauber getrennt sein und ihre Namen vollständig übereinander liegen.

Die Trennung rechnet jetzt mit einem liegenden Rechteck je Punkt. Das allein genügt nicht: gemessen bleiben rund 26 sich berührende Paare, und **mehr Iterationen oder stärkerer Druck verbessern das nicht** — sie vergrößern nur den Versatz. Deshalb zusätzlich eine Vergaberegel nach Rang (ausgewählt → Favorit → Freigabe → Qualität): wer keinen freien Platz hat, behält Punkt, Farbe, Klickfläche und Mouseover, nur die Aufschrift entfällt. Ein Name unter zwei anderen ist keine Information, er sieht nur wie eine aus.

**Zur Erwartung dahinter:** beide Achsen sind Musterqualität × Handelbarkeit. Ein Tag mit +5,34 % geht in keine der beiden ein. Auch ein perfekt lesbares BTC säße dort, wo sein Setup es hinstellt. Ob die Coin-Heatmap eine Bewegungsachse braucht, ist eine offene Frage, keine erledigte.

**4. „Keine Coin-BUY-Signale."** Nachgerechnet mit der EV-Formel des Claude-Modus, bei typischer Geometrie (R1 = 1,0, R2 = 2,2, Stop = 5,8× Kosten):

| Qualität | Erwartungswert | |
|---|---|---|
| 6,6 (= die geforderte Untergrenze) | −0,13 R | blockiert |
| 7,5 | −0,01 R | blockiert |
| 8,0 | +0,07 R | blockiert |
| **8,4** | **+0,12 R** | **erste Freigabe** |

**`modeQuality >= 6.6` ist als Gatter wirkungslos.** Die echte Hürde liegt bei rund 8,4, weil `p1` erst dort seinen Deckel von 0,66 erreicht. Alles dazwischen scheitert ausschließlich am Erwartungswert — und „Erwartungswert −0,03R < +0,10R" liest sich dabei wie ein knappes Verfehlen, obwohl fast zwei Qualitätspunkte fehlen.

**Die Zahlen sind unverändert.** Eine gelockerte Schwelle würde Signale herstellen statt finden. Geändert ist nur, was der Blocker behauptet: er nennt die nötige Qualität, hergeleitet durch numerisches Auflösen derselben Formel.

**Der SHA-Riegel hat dabei gefeuert und hatte recht.** Der erste Versuch schrieb den Hinweis in den verriegelten `claude`-Block. Auch ein reiner Textzusatz verändert die Prüfsumme, gegen die jede spätere Änderung verglichen wird — wer sie für Text nachzieht, hat den Riegel abgeschafft. Der Block bleibt byte-identisch, die Ergänzung hängt sich dahinter.

**Drittes Mal an einem Tag: ein Test las den falschen Text.** Die Heatmap-Prüfung hatte `CHAR_W`/`LABEL_H` eingetippt statt aus `app.js` zu lesen; die Gegenprobe blieb grün, weil der Test seine eigene Zweitwahrheit rechnete. Er liest die Konstanten jetzt aus der Quelle. Nach NK72 und NK74 ist das der dritte Fall — die Krankheit ist offenbar strukturell und nicht zufällig.

**Sechs Negativkontrollen**, alle gefeuert und zurückgesetzt: Sprungziel entfernt · Cron ohne `watch` · gemerkte Zeile freigeben lassen · Trennung zurück auf den Kreis · Vergaberegel abgeschaltet · Hinweis zurück in den verriegelten Block.

**Nachgezogen:** Die Coin-Suche lädt jetzt auch Paare außerhalb des Scans über `/api/pair/{PAAR}` — der Endpunkt existierte seit jeher, nur die Verdrahtung im Client fehlte. Einzeln geladene Zeilen sind `_remembered` und geben nie frei: die Einzelabfrage umgeht BTC-Referenz und Orderbuch des Scans.

### 4.2.5 · Beide Marktbereiche sind ab jetzt gleich gebaut

Nutzeranmerkung vom 03.09.: *„die Sektionen sollten gleich aufgebaut sein … das hatten wir schon extrem oft besprochen."* Der Zusatz ist der eigentliche Befund — es war mehrfach besprochen und trotzdem jedes Mal zurückgefallen. Der Grund steht im Testverzeichnis.

**Die Abweichung war getestet — und zwar falsch herum.** `tests/coin-scope.mjs` verlangte die Coin-Suche zwischen Stimmung und Trefferliste, also ganz unten, während die Aktiensuche seit jeher direkt unter der Überschrift steht. Ein Test, der eine Asymmetrie festschreibt, macht sie unsichtbar: **jede Änderung in Richtung Symmetrie ließ ihn rot werden und sah damit nach einem Fehler aus.** Genau so überlebt eine Abweichung mehrere Gespräche.

**Die alte Coin-Reihenfolge:** Band → Fokus → Top Picks → Mover → Stimmung → Suche → Liste.
**Die Aktien-Reihenfolge:** Band → Überschrift → Suche → Fokus → Kacheln → ★-Leiste → Liste.

**Ab 4.2.5 gilt die zweite für beide.** Neu im Kryptobereich: `<h2>Coin-Radar</h2>` mit `#coinCounts` (Gegenstück zu `#stockCounts`), darunter `#coinTools` mit Suchfeld, Löschknopf, Ladeknopf, Rückmeldung, Filter und Intervall — dieselben Klassen wie `.stocktools`, damit auch das Aussehen nicht auseinanderläuft. Die ★-Leiste steht wie `#depotStrip` unmittelbar über der Liste.

**Der Stern fehlte im großen Fokusfenster.** Die Aktien-Fokuskarte trug ihn seit jeher, die Coin-Fokuskarte nicht. Wer einen Coin im Fokus hatte, musste zum Markieren erst in der Liste danach suchen — obwohl der Fokus die Stelle ist, an der man sich für einen Titel entscheidet. Er hängt am selben Umschalter wie der in der Zeile; ein eigener Pfad wäre die nächste stille Zweitwahrheit, und der Test zählt die Aufrufe.

**Der Test prüft ab jetzt die Bauform BEIDER Bereiche gegeneinander**, nicht mehr eine feste Liste je Bereich. Weicht einer ab, fällt er — gleich welcher. Das ist die einzige Formulierung, die verhindert, dass die Seiten wieder auseinanderlaufen; eine Liste je Bereich hätte auch diesmal wieder nur den Ist-Zustand zementiert. Geprüft werden Reihenfolge, Suchfeld, Löschknopf, Ladeknopf, Rückmeldung, Favoritenfilter und der Fokus-Stern — beidseitig.

**Vier Negativkontrollen**, alle gefeuert und zurückgesetzt: Coin-Suche zurück ans Ende · Stern aus dem Coin-Fokus · Löschknopf entfernt · **Stern aus dem Aktien-Fokus** (die Symmetrie muss in beide Richtungen greifen, sonst prüft der Test nur eine Seite).

### 4.2.6 · Die Drossel des Beobachtungsprotokolls war wirkungslos

Beim Nachsehen zur ersten Schreibmessung gefunden, eigener Fehler aus 4.2.3. Es gab EINEN Merker `changed`, den sowohl das Aufräumen als auch das Anhängen setzten. Das Aufräumen läuft bei **jedem** Aufruf — irgendein Zeitstempel fällt immer aus dem Fenster. Damit war der Merker praktisch immer wahr, und die 5-Minuten-Raste hat nie gegriffen: geschrieben wurde bei jedem `d1StoreRows`-Aufruf statt höchstens alle fünf Minuten. Der Kommentar versprach 288 Schreibvorgänge je Pfad und Tag, tatsächlich waren es bis zu 1.440.

**Derselbe Fehlertyp wie 4.2.3 selbst: eine Zusage, die im Kommentar stand und im Code nicht.** Jetzt zwei getrennte Merker; reines Aufräumen rechtfertigt keinen Schreibvorgang. Die alten Einträge stören niemanden — `obsCountFor` filtert ohnehin nach Zeitfenster, und beim nächsten echten Anhängen verschwinden sie kostenlos mit.

**NK67 hat das nicht gefunden**, weil er zwei Aufrufe prüft und der Fehler erst greift, wenn das Aufräumen nach Ablauf der Aufbewahrung etwas zu tun bekommt — Stunden später. **NK75** rechnet deshalb acht Stunden Cron im Minutentakt durch und verlangt höchstens die 5-Minuten-Takte. Gegenprobe mit dem alten Code: 144 statt 96 Schreibvorgänge.

**Zur ersten Messung selbst:** Die Kachel zeigte `DB 191/90k`. Das sind **191 Zeilen**, nicht 191k — `kurz()` setzt das „k" erst ab 10.000, und `191k` stünde als `191k` da. Bei 240 Minuten in den UTC-Tag sind das 0,8 Zeilen/min gegen 62,5 tragfähige. Aussagekräftig wird die Messung aber erst nach einer US-Sitzung; zum Ablesezeitpunkt war der Aktienmarkt geschlossen.

### 4.2.7 · Die Suche gehört INS Skope-Fenster, und die Auswertung braucht eine Zäsur

4.2.5 hatte beide Bereiche gleich gebaut — aber die Suche als eigene Leiste **oberhalb** des Fensters. Symmetrisch und trotzdem falsch platziert: **die Suche entscheidet, WAS im großen Fenster steht, also gehört sie hinein.** Beide Skope-Bereiche sind zweispaltige Raster (Fokuskarte + Heatmap); die Leiste läuft jetzt als volle Breite oben durch (`grid-column:1/-1`), damit sie über beiden Spalten steht und nicht neben einer.

Die Bauform lautet damit: **Band → Überschrift → Skope-Fenster mit Suche darin → Kacheln → ★-Leiste → Liste.**

**Der Test prüft ab jetzt die Verschachtelung, nicht die Reihenfolge.** Eine reine Reihenfolgeprüfung wäre auch dann grün, wenn die Leiste wieder davorstünde — sie liegt in der Datei ja ohnehin vorher. Verlangt wird: Leiste zwischen dem öffnenden Tag des Skope-Fensters und der Fokuskarte.

**Und ein vierter Fehlanker an einem Tag:** die Prüfung suchte `class="stocktools"`, was seit 4.2.5 in BEIDEN Bereichen steht — der erste Treffer im Dokument war immer die Coin-Leiste, die Aktienseite wurde nie geprüft. Die Aktienleiste hat jetzt `id="stockTools"` als eigene Kennung, analog zu `#coinTools`.

**Die Auswertung als eigene Sektion.** Alle drei Bereiche liegen in EINEM Dokument; die Reiter springen, sie blenden nichts aus. Wer scrollt, läuft von den Aktien direkt in den Rückblick. `#bandLab` gab es, war aber optisch so leise wie die beiden Markt-Bänder — dabei trennt es etwas Grundsätzlicheres: davor Handlungsgrundlagen, danach ausschließlich Rückblick über BEIDE Märkte mit 0 % Gewicht in Score, Ampel und Freigabe. Jetzt Trennlinie, abgesetzte Überschrift, größerer Abstand. Der Test verlangt beides.

**Drei Negativkontrollen**, alle gefeuert: Coin-Suche zurück vor das Fenster · Aktien-Suche zurück vor das Fenster · Trennlinie der Auswertung entfernt.

### 4.2.8 · Eine zweite, unsichtbare Reihenfolge neben dem Markup

**Das ist die Erklärung dafür, warum die Anordnung der Coin-Sektion mehrfach zurückkam — und der schwerwiegendste Testbefund dieser Serie.**

In `applyPrimaryBlockOrder()` stand seit v3.3.2:

```js
if(main && stage) main.insertAdjacentElement('afterend', stage);
```

Diese Zeile schob das Krypto-Skope-Fenster **beim Booten** hinter `<main>`. Und in `<main>` lagen die Coin-Liste, der gesamte Aktienbereich UND die Auswertung. Das Fenster landete damit ganz am Ende der Seite, hinter dem Lab.

**Die Reihenfolge im Markup war seit 4.2.5 richtig. Alle Prüfungen darauf waren grün. Der Browser sah trotzdem etwas anderes.** Ein Test, der `index.html` liest, kann das grundsätzlich nicht bemerken — und alle taten das. Jede Korrektur am Markup war wirkungslos, und weil sie „grün" war, sah es jedes Mal nach Erledigung aus.

**Die neue Reihenfolge, in beiden Bereichen:** Band → Überschrift → Skope-Fenster (mit Suche darin) → ★-Leiste → Trefferliste → Empfehlungen. Erst was IST, dann was VORGESCHLAGEN wird. Bis 4.2.7 stand die Aktienliste hinter neun Kacheln am Ende des Abschnitts; wer den Fokus gelesen hatte, musste an allem vorbeiscrollen.

Dafür musste die Coin-Liste aus `<main>` heraus in einen eigenen Abschnitt `#coinList` — vorher lag sie zusammen mit Aktien und Auswertung in einem Container und war gar nicht frei positionierbar.

**Der neue Test prüft die FUNKTION, nicht die Datei.** `applyPrimaryBlockOrder` darf genau EINEN Umzug ausführen: den Aktienblock nach oben. Jedes weitere `insertAdjacentElement`, `insertBefore`, `append` oder `prepend` dort ist eine neue Zweitwahrheit und wird rot, bevor sie ein Layouträtsel wird. Zusätzlich: im gesamten Boot-Pfad darf kein weiterer Block umgehängt werden.

**Drei Negativkontrollen**, alle gefeuert: die gelöschte Zeile wieder eingebaut (der eigentliche Fehler) · Coin-Liste zurück hinter die Empfehlungen · Aktienliste zurück ans Ende.

**Zwei Zusicherungen wurden bewusst umgedreht statt gelöscht:** „Discovery-Kacheln vor dem Depot-Streifen" (v3.9.2) und die Abfolgeliste des Aktienbereichs. Eine gelöschte Zusicherung lässt die neue Reihenfolge ungeschützt; eine umgedrehte hält sie fest.

**Fünfter Fall derselben Krankheit in dieser Serie** — nach NK72 (Kommentare als Aufrufe), NK74 (Berechnung statt Anzeige), den abgeschriebenen Heatmap-Konstanten und dem mehrdeutigen `class="stocktools"`-Anker. Der gemeinsame Nenner: **der Test hat nicht das gelesen, was tatsächlich wirkt.**

### 4.2.9 · Verlauf der Kauf-Freigaben — die Daten lagen seit Monaten bereit

Anlass war eine Nutzerfrage: *„USELESS wurde vor Tagen 2x empfohlen und ist heute um 74 % gestiegen — spezielles Muster oder Zufall?"*

Die Frage war nicht beantwortbar, obwohl **alle** Daten dafür seit Langem aufgezeichnet werden. `market_snapshots` hält `light`, den Kurs zum Zeitpunkt und seit v3.32.x auch den Ausgang (`max_pct`, `min_pct`, `mae_pre`, `success_ts`, `reach_ts`). Es fehlte nur die Abfrage. **Fünfte Wiederholung der Lehre aus 4.2.3, mit umgekehrtem Vorzeichen: aufgezeichnet war alles, gelesen wurde es nie.**

**Episoden statt Zeilen.** Eine grüne Lage steht typischerweise über viele 5-Minuten-Takte. Jede Zeile einzeln zu zeigen ergäbe hundert „Empfehlungen" für eine einzige Gelegenheit — und wer die zählt, hält eine ruhige Phase für viele Treffer. Aufeinanderfolgende grüne Takte desselben Symbols werden zu EINER Episode zusammengefasst; erst eine Lücke von 45 Minuten beginnt eine neue. Das ist auch die Zählweise, die der Nutzer meint, wenn er sagt „zweimal empfohlen".

**Was bewusst NICHT drinsteht:**
- **Keine Trefferquote.** Bei einer Handvoll Episoden wäre sie eine Zahl ohne Aussage — dieselbe Regel wie im Musterlabor („eine Trefferquote aus sieben Fällen ist keine Quote"). Ein Test prüft, dass kein Feld dieser Art im Ergebnis auftaucht.
- **Kein Urteil über den Einzelfall.** Die Liste stellt ihn neben die anderen; die Einordnung macht der Mensch.

**„Ohne Beleg" ist kein Fehlschlag.** Eine verworfene Zeile heißt „zu selten nachgesehen" — sie als Misserfolg zu zählen wäre genau die Verzerrung, vor der R3 warnt. Der Ausgang wird deshalb in vier Zuständen benannt: Ziel erreicht · ausgewertet · offen · ohne Beleg.

**Fail-closed:** Ein Lesefehler kommt als Fehler zurück, nicht als leere Liste. „Keine Freigaben gefunden" und „konnte nicht nachsehen" dürfen nicht gleich aussehen — das erste ist eine Behauptung.

**Kosten:** ein D1-Lesevorgang je Abruf, geholt beim Start und danach alle 15 Minuten. Ein Abruf im Scan-Takt wäre Dauerlast ohne Erkenntnisgewinn.

**Neue Suite** `tests/signal-history.mjs`, acht ausgeführte Prüfungen: Zusammenfassung, echte Lücke, Grenzfall knapp unter/über der Lückengrenze, Symboltrennung, alle vier Ausgänge, bester/schlechtester Ausschlag über die ganze Episode, Fail-closed, keine Quote. **Vier Negativkontrollen**, alle gefeuert: Lesefehler als leere Liste · Episodenbildung abgeschaltet · Ausschlag nur aus dem ersten Takt · Symbole zusammengeworfen.

### 4.3.0 · Der Sparschalter war eine Beschriftung, und der teuerste Endpunkt hatte einen zweiten Aufrufer

**Befund 1 · `freshestStockQuotesBatch` zog den ganzen Markt.**
`tiingoIexSnapshot()` versucht zuerst `/iex?tickers=…`; steht `iexSubsetMode` auf `unsupported`, fällt es auf ein blankes `/iex` zurück — **10,8 MB**. In der Verbrauchstabelle des Nutzers steht **kein einziger `iex-symbols`-Abruf**: der sparsame Weg ist dauerhaft abgeschaltet, Tiingo hat den Parameter irgendwann ignoriert.

Aufgerufen wurde das bei **jedem** Deep Scan (bis zu 367/Tag), geschützt nur durch den Radar-Vorrat mit 120 Sekunden Haltbarkeit — den der Radar aber nur 68× täglich füllt.

| | Abrufe/Tag | GB/Tag |
|---|---|---|
| Radar laut Kadenzmodell | 68 | 0,72 |
| gemessen `iex-wholemarket` | ~122 | 1,29 |
| **Differenz, nicht vom Radar** | **54** | **0,57** |

**Der Test hat das gedeckt statt gefunden.** Er sicherte zu: „GENAU ZWEI Aufrufe, unabhängig von der Symbolzahl." Richtig gezählt und trotzdem irreführend — zwei Aufrufe können 20 KB oder 22 MB sein. Er prüft jetzt, dass der Live-Quote-Stapel **gar keinen** Tiingo-Netzabruf mehr auslöst; Kurse kommen aus dem vorhandenen Vorrat oder von Alpaca, sonst gar nicht und die Zeile trägt korrekt „kein Live-Quote".

**Befund 2 · Der Watchlist-Modus wirkte auf dem Browser-Pfad nie.**
`tiingoStockSnapshot` schaltet nur über `opts.onlySymbols` um. Gesetzt wurde das an **genau einer** Stelle: im Cron. Die Route `/api/stocks` hat `opts` nie mitgegeben — `watchlistMode` war dort **immer false**, volle Entdeckung inklusive Radar-Abruf, unabhängig vom gespeicherten Zustand. Genau dieser Pfad läuft, wenn die Oberfläche offen ist, also gerade dann, wenn jemand Bandbreite sparen will.

**Befund 3 · Die Sparbremse brauchte genau das, was klemmte.**
Der Modus liegt in D1. Schlägt der Schreibvorgang fehl, ließ sich bis 4.2.9 gar nicht umschalten. Eine Bremse, die die überlastete Komponente voraussetzt, ist im Ernstfall keine.

Ab 4.3.0 sind **gespeichert** und **angewendet** zwei Felder. Der Modus gilt für die Sitzung auch ohne Speicherung: die Oberfläche schickt ihn bei jedem Abruf als `wlMode`/`wl` mit, und der Deep Scan beachtet ihn dort. Was nicht geht, wird ausdrücklich gesagt — der Hintergrundlauf kennt ihn nicht. Kein stiller Halberfolg.

**Und der Fehlertext sagte nichts.** Bei `reason: 'unknown'` stand „Der Modus konnte nicht gespeichert werden." Der tatsächliche Grund lag im Feld `error` daneben und wurde nie angezeigt, weil die Oberfläche `hint` bevorzugt. Beim bekannten Fall bleibt der erklärende Text, beim unbekannten gewinnt jetzt die Wahrheit.

**Vier Negativkontrollen**, alle gefeuert: Vollmarkt-Rückfall wieder eingebaut · Watchlist-Modus nicht übergeben · angewendet und gespeichert zusammengeworfen · Modus nicht mehr mitgeschickt.

**Und wieder ein zu schwacher Anker:** die erste Fassung der Verdrahtungsprüfung suchte nur den Namen `stockOpts` im Text. Die Gegenprobe „Übergabe auf ein leeres Objekt setzen" blieb grün, weil der Name noch dastand. Geprüft wird jetzt, dass `wlSyms` tatsächlich in `onlySymbols` landet.

### 4.3.1 · Ein Aufruf ins Leere — und die Prüfung, die es künftig fängt

**Selbst verursacht.** In `toggleWatchlist` stand `loadStocks(true)`. Die Funktion heißt `scanStocks`. `loadStocks` gab es in `public/app.js` nie.

Folge: das Umschalten meldete *„Umschalten fehlgeschlagen: Can't find variable: loadStocks"* — **obwohl der Modus bereits gesetzt war**. Der Knopf zeigte „Watchlist · 34", die Meldung darüber sprach von Fehlschlag. Genau die Sorte Fehlmeldung, die v4.1.2 an dieser Stelle schon einmal beseitigt hat, diesmal von der anderen Seite.

Nebenbei belegt der Fehler, dass 4.3.0 funktioniert: der Ablauf war im Zweig „angewendet, aber nicht gespeichert" — der Modus galt für die Sitzung, D1 nahm ihn weiterhin nicht an.

**Warum keine Suite das fand.** `node --check` prüft Syntax; ein Aufruf einer nicht existierenden Funktion ist syntaktisch einwandfrei. Alle Prüfungen zu diesem Bereich vergleichen Quelltext mit regulären Ausdrücken. Der Fehler fällt erst im Browser auf. **Achter Fall derselben Krankheit in dieser Serie: geprüft wurde der Name, nicht die Wirkung.**

**Neue Suite `tests/client-symbols.mjs`:** sammelt alle in `app.js` definierten Namen — Funktionen, Variablen, Klassen, Objektmethoden, Funktions- und Pfeilparameter, `catch`-Bindungen — plus die bekannten Browser-Globals, und meldet jeden Aufruf, der zu keinem davon passt.

**Die erste Fassung war selbst unbrauchbar** und ist es wert, festgehalten zu werden: sie entfernte Zeichenketten und Kommentare per regulärem Ausdruck und meldete daraufhin **162 „Fehler"** — darunter `Handelszeit()`, `Basispunkt()` und `ffnung()`, also deutsche Wörter aus Meldungstexten. Gleichzeitig verschwanden echte Definitionen, weil das Stripping den Quelltext zerschnitt; `loadAladdin` galt als undefiniert, obwohl es dasteht. **Ein Prüfwerkzeug, das seinen Eingabetext falsch zerlegt, irrt in beide Richtungen zugleich.** Ersetzt durch einen echten Zeichenscanner mit Zustand, der Anführungszeichen, Backticks samt verschachteltem Ausdruck, beide Kommentarformen und Regex-Literale kennt. Ergebnis: null Fehlalarme.

**Zwei Negativkontrollen**, beide gefeuert: der echte Fehler wieder eingebaut · ein frei erfundener Tippfehler in einem anderen Aufruf.

### 4.3.2 · Zwei Tage Fehlersuche, weil der Grund weggeworfen wurde

**Was die neuen Messungen ausschließen:** Tiingo meldet am 04.09. **27,97 GB von 40 GB frei** — verbraucht sind 12 GB im Monat. Tagesanfragen 1.390 von 100.000, Stundenanfragen 50 von 10.000. **Die Bandbreiten- und Kontingenttheorie ist damit tot.** Und die Kadenz stimmt rechnerisch (68 Radar-Abrufe/Tag, Minute für Minute nachgerechnet). Beides waren plausible Verdächtigungen — beide falsch.

**Was tatsächlich fehlt:** Bei LIVE laufender US-Sitzung steht weiterhin `0 aktualisiert`, die Aktiendaten stammen vom 01.09. 19:55 UTC.

**Warum das zwei Tage gekostet hat.** In `tiingoStockSnapshot` steht seit jeher:

```js
}catch(e){ console.warn(...); return null; }
```

Jeder Symbolfehler landete ausschließlich im Worker-Log und wurde zu `null`. Der Zustand `stale` trägt daraufhin die Begründung „Tiingo lieferte keine analysierbaren Bars" — **eine Vermutung, fest im Code, nicht aus dem tatsächlichen Fehler gebildet.** Ob 401, 429, 404, Zeitüberschreitung oder Parse-Fehler: von außen sah alles identisch aus. Und identisch zu einem geschlossenen Markt.

**Neunter Fall derselben Krankheit in dieser Reihe:** die App kennt den Grund, transportiert ihn nicht, und die Diagnose wird zum Ratespiel.

Ab 4.3.2 werden die Fehler gesammelt, nach Meldung zusammengefasst (20 Titel mit demselben 429 sind EIN Befund, nicht zwanzig) und als `deepScanErrors` mitgeliefert, zusammen mit `deepScanAttempted`. Die Oberfläche zeigt sie im Skope-Fenster und unterscheidet dabei drei Fälle, die vorher alle „0" hießen:
- **nichts angesetzt** — kein Fehler, etwa bei geschlossener Börse;
- **angesetzt und gescheitert** — häufigste Meldung mit Anzahl und Beispielsymbolen;
- **angesetzt, nichts aktualisiert, kein Fehler gemeldet** — selbst ein Befund, und ausdrücklich als solcher benannt.

Kein Verhalten ändert sich, nur die Sichtbarkeit. **Drei Negativkontrollen**, alle gefeuert.

**Offen und wichtig:** Cloudflare meldet für die aktive Bereitstellung **61,8 % Fehlerrate** (670 Fehler/24 h). Vorher 0,6 %. Das ist der nächste Verdächtige und möglicherweise dieselbe Ursache. Der entscheidende Beleg ist das Worker-Log (`wrangler tail` oder Reiter „Beobachtbarkeit"), nicht ein weiterer Screenshot.

### 4.3.3 · „0 aktualisiert" bedeutete etwas ganz anderes als angenommen

**Die Auflösung nach zwei Tagen, und sie ist unspektakulär.**

`tiingoStockSnapshot` hat **drei** Cache-Zweige, nicht einen. Der dritte — der persistierte Cron-Stand — ist derjenige, den die Oberfläche praktisch immer bekommt, weil der Browser seit v4.0.0 **absichtlich keinen eigenen Tiefenscan startet** („PWA startet keinen Doppel-Scan"). Sein eigener Hinweistext sagt das sogar: *„Letzter Stand der Vorsitzung, N Min. alt."*

**`0 aktualisiert` heißt auf diesem Pfad also nicht „gescheitert", sondern „hier wird nicht gescannt".** Die Zahl, auf die es ankommt, ist das ALTER des Standes — und die stand nirgends.

Ausgerechnet dieser meistgesehene Zweig lieferte weder `persist` (Speicherstatus, seit 4.2.9 vorhanden) noch eine Herkunftsangabe. **Beide Diagnosen waren genau in dem Zustand unsichtbar, in dem man sie braucht.** Auch die neue Fehlerliste aus 4.3.2 erscheint dort nicht — zu Recht, denn es gab keinen Scanversuch. Deshalb blieb die Anzeige nach dem Deploy von 4.3.2 leer, und das war korrekt und trotzdem nutzlos.

Ab 4.3.3 tragen alle vier Antwortpfade ein Feld `servedBy` (`live` · `memo` · `cron-persistent` · `awaiting-cron`), der persistierte Zweig zusätzlich `persist`, `cronScanTs` und `cronScanAgeMin`. Die Oberfläche schreibt daraus einen Satz: *„Der Browser startet keinen Tiefenscan — angezeigt wird der Stand des Hintergrundlaufs, N alt"*, und hängt den Speicherfehler an, falls einer vorliegt. Über drei Stunden Alter wird die Zeile gelb.

**Damit verschiebt sich die offene Frage**, und zwar auf festen Boden: nicht mehr „warum scheitert der Scan", sondern **„warum hat der Cron seit dem 01.09. keinen neuen Stand abgelegt"**. Zwei Kandidaten, beide jetzt ablesbar: `persist.ok === false` (D1 nimmt den Stand nicht an) oder der Cron kommt gar nicht bis zum Scan.

**Und ein Fehler, der mir beim Schreiben unterlaufen ist:** die neuen Zweige enden mit `return`. Ich hatte sie in einen bloßen Block `{ … }` gesetzt — das wäre ein Rücksprung aus `renderStocks()` gewesen, und Zähler, Liste und sämtliche Kacheln wären ausgefallen. Beim Nachlesen aufgefallen, in eine sofort aufgerufene Funktion umgebaut, und eine Zusicherung dafür ergänzt. Die Gegenprobe musste dafür syntaktisch gültig gebaut werden, sonst hätte nur `node --check` angeschlagen und nicht die Zusicherung selbst.

**Drei Negativkontrollen**, alle gefeuert: `persist` aus dem persistierten Pfad entfernt · Alter weggelassen · Block statt Funktion.

### 4.3.4 · Warum die Aktien-Heatmap seit dem 01.09. eingefroren war

**Vier Stellen, jede fuer sich vertretbar, zusammen ein System das gruen meldet und nichts tut.**

1. Frischer Isolate → `stockMemo` ist leer. Der persistierte Cache-Zweig ist fuer `execution==='server'` ausgenommen — der Cron scannt also tatsaechlich, das war nie das Problem.
2. Scheitern alle Tiefenanalysen, ist `fresh` leer. Und weil `safeCarry` im frischen Isolate nichts zum Weitertragen hat, ist auch `rows` leer.
3. `persistStockScan` beginnt mit `if(!env?.DB || !rows?.length) return stockPersistState;` — **kein Schreibvorgang, kein Fehler, keine Zustandsaenderung.** Als Schutz richtig (ein guter Stand darf nicht mit Nichts ueberschrieben werden), aber vollstaendig stumm.
4. Und der Cron meldete `setApiState('stocks','ok', '0 Rows · Radar …')`. **Null Zeilen als Erfolg.**

Ergebnis: Der Cron laeuft im Zweiminutentakt, meldet gruen, speichert nichts, und die Oberflaeche bekommt weiter den Stand vom 01.09. 19:55. Kein Alarm, keine Spur. Genau das Bild „die Heatmap ist immer gleich".

**Warum es mehrfach besprochen und nie gefunden wurde:** jeder einzelne Verdacht war plausibel und pruefbar — Bandbreite (Tiingo hat 28 von 40 GB frei), Kadenz (rechnerisch korrekt, 68 Abrufe/Tag), Rotation (existiert, cycle-basiert), Marktphase (erklaerte nur die Nacht). Alle vier waren falsch, weil der eigentliche Befund als Erfolg gemeldet wurde und deshalb in keiner Statusanzeige auftauchte.

**Ab 4.3.4** entscheidet die Zeilenzahl: `anzahl > 0` heisst `ok`, sonst `error` — mit dem tatsaechlichen Grund aus `deepScanErrors` (seit 4.3.2 vorhanden, aber bis hier verworfen, weil niemand die Cron-Antwort liest). Der Grund geht durch `persistApiState`, ueberlebt also den Lauf und erscheint im Anbieterzustand der App. Dieselbe Regel im Watchlist-Zweig — sonst gaelte sie nur im halben Cron.

Der stumme Schutz in `persistStockScan` bleibt unveraendert und ist durch eine Zusicherung festgehalten: ein guter Stand darf weiterhin nicht mit Nichts ueberschrieben werden. Er darf nur nicht die einzige Reaktion sein.

**Vier Negativkontrollen**, alle gefeuert: leerer Scan wieder als `ok` · Grund durch Ersatztext ersetzt · Grund nicht persistiert · Watchlist-Zweig wieder immer `ok`.

**Was nach dem Deploy zu erwarten ist:** Steht die Aktien-Ampel auf Rot mit einem konkreten Grund, ist die Ursache endlich benannt und behebbar. Bleibt sie gruen und die Zeilenzahl steigt, hat der Scan ohnehin wieder gearbeitet. Beides ist ein Fortschritt gegenueber drei Tagen stiller Wiederholung.

### 4.3.5 · Die zweite, unabhängige Ursache der immer gleichen Heatmap

4.3.4 hat den Cron zum Reden gebracht. Damit war die Frage offen, ob sich die Karte überhaupt ändern WÜRDE, sobald der Scan wieder liefert. **Sie hätte es nicht.**

**Gemessen mit der echten Sortierung** aus `tiingoStockSnapshot`: bei 74 mitgeschleppten und 20 frisch analysierten Zeilen schafft es **keine einzige** frische Zeile in die zwölf angezeigten Punkte. Der beste frische Titel landet auf **Rang 68 von 94**. Selbst einer mit Reife 6,5 kommt nur auf Rang 49 — die zwölfte Zeile hat 8,43.

**Die Ursache ist eine Unwucht im Vergleich, nicht in den Zahlen.** `safeCarry` trägt jede je gesehene Katalogzeile unbegrenzt weiter, und sie behält die Werte ihres LETZTEN GUTEN Standes — aus einem Moment, in dem sie stark genug war, um angezeigt zu werden. Ein neu analysierter Titel wird dagegen mit den Zahlen von HEUTE bewertet, oft in einem ruhigen Markt. Alt schlägt neu, dauerhaft und systematisch.

**Gealtert wird das Ranggewicht, nicht der Datensatz.** Die Zeile bleibt sichtbar und beschriftet, sie verliert nur ihren Vorrang: volles Gewicht bis 15 Minuten, danach linear abfallend bis auf ein Viertel nach sechs Stunden. Jede frisch analysierte Zeile bekommt dafür `analyzedTs`.

**Der Boden von 0,25 ist Absicht.** Ohne ihn fallen alle alten Zeilen auf den Rangwert 0, sind gleichauf, und das nächste Kriterium entscheidet — die ruhende Anzeige kippt still von der Reifenfolge auf `situationScore` um, ohne dass eine einzige neue Zahl eingetroffen wäre.

Wirkung, ausgeführt gemessen: aus 0 von 12 werden 12 von 12 frische Zeilen. Innerhalb einer Sitzung bleibt die Reihenfolge erhalten — eine Zeile von vor zwei Stunden mit Reife 8 schlägt weiterhin eine frische mit Reife 5. Über Tage hinweg gewinnt die Messung von heute.

**Was NICHT geändert wurde:** die Reife selbst, die Kriterienfolge und sämtliche Gatter. Ein gealterter Rang erzeugt keine Kauf-Freigabe und keinen Score.

**Fünf Negativkontrollen**, alle gefeuert: Alterung abgeschaltet · Boden entfernt · fehlender Zeitstempel gilt als frisch · Zeitstempel nicht gesetzt · Abklingzeit auf eine Minute verkürzt (Frische schlüge dann jede Reife).

**Und wieder ein zu schwacher Test:** Die erste Fassung der Stabilitätsprüfung verglich zwei Läufe desselben Eingangs. Die Gegenprobe „Boden auf 0" blieb grün — zu Recht, denn bei Gleichstand entscheidet das nächste Kriterium deterministisch. Der Test prüfte Determinismus, nicht Stabilität. Er verlangt jetzt, dass unter gleich alten Zeilen die Reife die Reihenfolge bestimmt.

### 4.3.6 · Die Wurzel: ein undefinierter Bezeichner, seit v4.2.0

**`attachRelativeVwap(row, await benchmarkSessionVwap(env, now));`**

`now` gibt es in `tiingoStockSnapshot` nicht. Seit v4.2.0 warf damit **JEDE** Symbolanalyse `ReferenceError: now is not defined` — drei Zeilen vor dem `return row`. Das `catch` darunter fing es, schrieb eine Zeile ins Worker-Log und lieferte `null`.

Die ganze Kette daraus: `fresh` immer leer → `rows` immer leer → `persistStockScan` schreibt nie (Schutz gegen Überschreiben mit Nichts) → die Oberfläche zeigt dauerhaft den letzten Stand vor dem 4.2.0-Deploy. **Das ist die eingefrorene Aktien-Heatmap, vollständig erklärt.**

Ich habe vier Verdächtige sauber widerlegt — Bandbreite (28 von 40 GB frei), Kadenz (rechnerisch korrekt), Rotation (existiert), Marktphase (erklärte nur die Nacht) — und die Ursache war ein Tippfehler im Gültigkeitsbereich. **ESLint mit `no-undef` hat ihn in der ersten Sekunde gefunden.**

**Zwei weitere echte Fehler im selben Lauf:**
- `toast?.(…)` an zwei Stellen im Tagebuch. Das Fragezeichen schützt vor `null`/`undefined`, **nicht** vor einem undeklarierten Bezeichner. Beide Zeilen warfen — ausgerechnet im Fehlerpfad. Jetzt gibt es `toast()`.
- `deepScanAttempted`/`deepScanErrors` lagen seit 4.3.2 in `stockSnapshot` (Twelve-Data-Pfad) statt in `tiingoStockSnapshot`. Die Ankertexte beider Rückgaben sind fast gleich, ich habe am falschen Ende eingesetzt. Dort war `scanErrorSummary` nicht definiert (ReferenceError bei jedem Aufruf), und im Tiingo-Pfad fehlte die Diagnose ganz. **Mein eigener Test war grün, weil er nur „steht irgendwo in der Datei" prüfte.**

**Und `req.method` statt `request.method`** in `/api/watchlist`, seit v4.1.0. Jeder POST warf, das `catch` meldete `reason:'unknown'` mit dem nichtssagenden Satz „Der Modus konnte nicht gespeichert werden." Der Watchlist-Modus ließ sich **nie** speichern. Dieselbe Verwechslung hatte ich in 4.2.4 nach `/api/coinwatch` kopiert.

### Die eigentliche Lehre dieser ganzen Serie

Zehn Befunde, ein Muster: **geprüft wurde der Name, nicht die Wirkung.** `node --check` findet Syntax. Die Muster-Prüfungen finden Text. Keine von beiden findet einen Bezeichner, den es nicht gibt — und genau das waren drei der teuersten Fehler.

`npm run lint` läuft ab 4.3.6 als **erster Schritt** von `npm run check`. Genau eine Regel ist eingeschaltet: `no-undef`. Keine Stilregeln — die wären Rauschen, und ein Lauf mit Rauschen wird nach zwei Tagen ignoriert.

Der Muster-Wächter `tests/client-symbols.mjs` bleibt, kennt aber jetzt seine Grenze im Kommentar: er findet **Aufrufe** nicht existierender Funktionen (so wurde `loadStocks` gefunden), nicht **Zugriffe** wie `req.method`. Ein Versuch, auch `name.` per regulärem Ausdruck zu prüfen, ergab 48 Fehlalarme.

**Drei Negativkontrollen**, alle gefeuert — jede baut einen der drei echten Fehler wieder ein, und der Linter meldet ihn mit Zeile und Spalte.

### 4.3.7 · Die Grenze war `rows_read`, und die hat nie jemand gemessen

**Cloudflare-Warnungen vom 04.09.: 82 % um 13:39, Limit überschritten um 20:17.** Nicht `rows_written` — **`rows_read`**, 5 Millionen im Free-Tier. Danach geben alle lesenden D1-Anfragen Fehler zurück. Das sind die „Serverprobleme am frühen Nachmittag".

**Die App budgetiert Schreibzeilen bis auf die Stelle genau**: eigener Zähler, Bremse, Hochrechnung, Tagesobergrenze 90.000 von 100.000, `writeBudgetHoldsToday`, `topQueries`. Zwei Tage lang haben wir auf `DB 27k/90k` geschaut und beruhigt festgestellt, dass alles im Rahmen liegt. **Gelesene Zeilen kommen in der gesamten Messung nicht vor.**

**Ursache ist `signalHistory` aus 4.2.9 — von mir.** Die Abfrage filtert auf `light='green' AND asset_type=? AND ts>=?`, und auf `light` gab es keinen Index. SQLite liest damit bei jedem Aufruf die ganze Tabelle. Zweimal beim Laden und zweimal alle 15 Minuten sind 194 Vollscans je offenem Tab und Tag; bei 40.000 Zeilen **7,8 Millionen gelesene Zeilen — das Anderthalbfache des Tageslimits, aus einer einzigen Kachel.**

Vier Eingriffe:
- **`idx_snap_light (asset_type, light, ts DESC)`** — die Spaltenfolge folgt der WHERE-Klausel; ein Index in falscher Reihenfolge sieht im Test gut aus und wird von SQLite ignoriert. Ein Test hält beides zusammen.
- **Obergrenze von 4.000 auf 1.200 Zeilen.** Der Verlauf zeigt höchstens 20 Episoden; 4.000 war „für den Fall der Fälle" gewählt und ist bei gerissenem Leselimit genau der falsche Fall.
- **Serverseitiger Vorrat von zehn Minuten.** Mehrere Tabs und jedes Neuladen teilten sich bisher nichts.
- **Client-Taktung von 15 auf 60 Minuten.**

Rechnerisch: von 7,8 Mio. auf unter 100.000 gelesene Zeilen pro Tag, und das **ohne** den Index mitzurechnen.

**Fünfter Index auf `market_snapshots`.** Die Zusicherung aus v4.1.0 nennt die Zahl ausdrücklich, weil jeder Index beim INSERT eine geschriebene Zeile kostet. Sie wurde bewusst nachgezogen, nicht stillschweigend erhöht: eine geschriebene Zeile je INSERT gegen Millionen gelesene ist kein knapper Handel.

**Was offen bleibt und beim nächsten Mal zuerst drankommt:** Es gibt keinen Lesezähler. `d1Meter` misst ausschließlich `rows_written`. Solange das so ist, kann dieselbe Klasse Fehler jederzeit wiederkommen — die nächste Abfrage ohne passenden Index fällt genauso lautlos aus. **Ein Gegenstück zu `d1WriteBudget` für Lesezeilen gehört gebaut**, samt Anzeige neben `DB 27k/90k`.

**Vier Negativkontrollen**, alle gefeuert: Index entfernt · Vorrat abgeschaltet · Obergrenze zurück auf 4.000 · Taktung zurück auf 15 Minuten.

### 4.3.8 · Das Lesebudget wird angezeigt und beurteilt (offener Punkt 21 erledigt)

Der Server misst `rowsRead` **seit jeher** und liefert `readShareOfFreeLimit`, `atLeastRowsReadPerMin`, `sustainableRowsReadPerMin`, `atLeastProjectedRowsRead` und sogar `freeLimitRowsRead: 5_000_000` mit. Gefehlt haben genau zwei Dinge:

1. `readBudgetHoldsToday` — das eine Feld, das aus einer **Zahl** eine **Aussage** macht. Die Schreibseite hatte es seit v4.2.1.
2. Die Anzeige. Die Kachel nannte ausschließlich Schreibzeilen.

Deshalb meldete die App am 04.09., während Cloudflare das Leselimit riss, unbeirrt `DB 27k/90k` in Grün. **Elfter Fall desselben Musters: gemessen, übertragen, nie ausgewertet.**

Die Kachel zeigt jetzt beide Seiten (`27k/90k · Lesen 1,2M/5,0M`), und **die schlechtere der beiden Ampeln färbt** — eine grüne Hälfte darf eine rote nicht überdecken, genau das ist am 04.09. passiert.

**Ausdrücklich KEINE Lesebremse.** Schreibvorgänge lassen sich aufschieben, Lesevorgänge nicht: wer sie sperrt, legt die App still, während D1 noch antworten würde. Gewarnt wird, gebremst nicht. Ein Test hält fest, dass keine entsteht.

**Und ein Fehler, den ich trotz Kenntnis wiederholt habe:** `Number(null)` ist 0 — eine fehlende Lesezahl hätte als „null gelesene Zeilen" gegolten, also als bestmögliche Reserve. Entwarnung aus Unwissen, dieselbe Falle, die ich in 4.2.3 bei `coverageNote` schon einmal beseitigt hatte. Der Test hat sie beim ersten Lauf gefangen; ohne ihn wäre sie durchgegangen.

**Vier Negativkontrollen**, alle gefeuert: Leseurteil entfernt · Kachel zeigt nur Schreibzeilen · grüne Schreibampel überdeckt rote Leseampel · fehlende Lesezahl wieder als 0.

### 4.3.9 · „API-Fehler" ist keine Diagnose

Die rote Systemzeile nannte ausschliesslich den ZUSTAND: *„Aktien (Tiingo, Fallback Twelve Data): API-Fehler"*. Der konkrete Grund liegt seit jeher in `apiState[…].message` — seit 4.3.4 sogar mit der häufigsten Meldung des Tiefenscans samt Beispielsymbolen. **Angezeigt wurde er nie.** Zwölfter Fall desselben Musters.

Die Zeile hängt ihn jetzt an, auf 150 Zeichen gekürzt. Fehlt eine Begründung, bleibt die Zeile unverändert — kein leerer Gedankenstrich.

**Und ein Test von mir war zu wörtlich:** er verlangte `slice(0, 150)` mit Leerzeichen, im Code steht keines. Der Lauf wurde rot, obwohl die Änderung korrekt war. Ein Muster, das die Schreibweise statt der Sache prüft — dieselbe Krankheit wie überall in dieser Reihe, nur mit umgekehrtem Vorzeichen: diesmal meldete es einen Fehler, den es nicht gab.

### Stand der Messungen am 05.09., 07:07 UTC

- **Lesebudget: 90.000 von 5.000.000 (1,8 %).** Der Eingriff aus 4.3.7 wirkt: von rechnerisch 7,8 Millionen auf 90.000. Die Ursache war bestätigt.
- **Schreibbudget: 56.483 von 90.000 (63 %) nach 427 Minuten** — rund 132 Zeilen/min gegen 62,5 tragfähige. **Bei diesem Takt ist die selbst gesetzte Obergrenze gegen 11:20 UTC erreicht.** Die Leseseite ist gelöst, die Schreibseite ist es nicht.
- **Lernschicht arbeitet:** 1.530 Beobachtungen und 1.017 Auswertungen in 24 h, Abdeckung 81 %. Vor 4.2.3 stand dort dauerhaft null.
- **Aktien-Ampel rot** — das ist 4.3.4 bei der Arbeit: ein Scan mit null Zeilen meldet sich nicht mehr als Erfolg.

### 4.4.0 · Der Watchlist-Modus zeigte fremde Titel als eigene Auswahl

**Nutzerbefund vom 05.09., und er ist präzise:** *„Bei den gescreenten Aktien werden die Favoriten in der Beschreibung angeführt — wenn ich zusätzlich im Dropdown Favoriten auswähle, gibt es eine andere Anzeige in der Heatmap. Wie geht das? Sind ja dieselben Positionen."*

Nachgezählt: bei aktiver Watchlist mit 36 Titeln zeigte die Heatmap 17 Punkte, davon **10 — also 59 % — die gar nicht in der Watchlist stehen**: GILD, GOLD, AMD, COIN, GOOGL, AVGO, OM, TSLA, RKLB, ABBV. Wer im Filter zusätzlich „★ Favoriten / Depot" wählte, bekam folgerichtig ein anderes Bild. Zwei Ansichten derselben Auswahl, die nicht übereinstimmen.

**Ursache ist `safeCarry`.** Es trägt jede je gesehene Katalogzeile unbegrenzt weiter. Im Radar-Betrieb ist das richtig — die Anzeige soll zwischen zwei Zyklen nicht ausdünnen. Im Watchlist-Modus widerspricht es der ausdrücklichen Zusage direkt darüber: *„Der Server untersucht ausschließlich diese Titel."* Die mitgeschleppten Zeilen stammten zudem vom Vortag; der Nutzer sah alte Whole-Market-Funde als Teil seiner eigenen Auswahl.

Ab 4.4.0 gilt im Watchlist-Modus die Liste, und nur sie. Es fehlt dadurch nichts: die 36 Titel werden jede Minute analysiert und dünnen nicht aus. **Im Radar-Betrieb bleibt das Mitschleppen unverändert** — eine Gegenprobe hält fest, dass die Änderung eng gefasst ist.

Weder Favoriten noch frische Entdeckungen dürfen die Liste aufweichen, sonst käme die Vermischung durch die Hintertür zurück. Auch dafür gibt es eine Zusicherung.

**Drei Negativkontrollen**, alle gefeuert: Beschränkung entfernt · Favoriten weichen die Liste auf · Beschränkung auch im Radar-Betrieb (zu weit gefasst).

### Was der Nutzer nebenbei bestätigt hat

- **Lesebudget 125.000 von 5.000.000 (2,5 %)** — der Eingriff aus 4.3.7 hält über einen ganzen Tag.
- **Die rote Systemzeile nennt jetzt den Grund:** *„API-Fehler — The operation was aborted due to timeout"*. Das ist 4.3.9 bei der Arbeit; vorher stand dort nur die Kategorie. **Zeitüberschreitung** ist damit die konkrete Spur für den nächsten Schritt, nicht mehr „irgendwas mit der API".
- **Schreibbudget 86.000 von 90.000** um 18:42 — die selbst gesetzte Obergrenze wird heute erreicht. Offener Punkt 23 bleibt der nächste Schritt, und `topQueries` ist das Feld dafür.

### 4.4.1 · Ich habe den falschen von zwei Ausgabepfaden repariert

4.4.0 baute die Watchlist-Beschränkung in `safeCarry` ein — im **Live-Pfad**. Der Browser bekommt aber den **persistierten Cron-Stand** („Der Browser startet keinen Tiefenscan"), und der filterte weiter nach Katalog und Favoriten. Ergebnis: 4.4.0 war aufgespielt, und die Heatmap zeigte unverändert GILD, GOLD, AMD, COIN, GOOGL, AVGO, TSLA, RKLB, ABBV.

**Verschärfend:** der persistierte Stand stammt aus einer Zeit, in der der Watchlist-Modus serverseitig gar nicht speicherbar war (`req is not defined`, bis 4.3.6). Er enthält also zwangsläufig Whole-Market-Funde und wird sie behalten, bis der Cron einen reinen Watchlist-Stand geschrieben hat. Der Filter greift ab 4.4.1 sofort.

Der Test verlangt die Regel jetzt in **beiden** Zweigen. Ein Test, der nur einen von zwei Ausgabepfaden prüft, bestätigt eine Reparatur, die den Nutzer nicht erreicht — genau das ist passiert.

**Und wieder ein Fehlanker:** `stockMemo={ts:persisted.ts` kommt zweimal vor; der erste Treffer liegt vor dem geprüften Zweig, der Ausschnitt war leer, und der Test meldete einen Fehler, den es nicht gab. Vierter Griff dieser Art in dieser Reihe. Der Endanker wird jetzt AB dem Startanker gesucht.

### Kostenrechnung für die Plan-Entscheidung

Cloudflare Workers Paid: 5 $/Monat Mindestbetrag, laut Cloudflares eigener Warnmail **25 Milliarden gelesene und 50 Millionen geschriebene Zeilen enthalten**.

| | heute (30 Tage) | enthalten | Sicherheitsfaktor |
|---|---|---|---|
| geschrieben | 2,6 Mio. | 50 Mio. | **19×** |
| gelesen | 3,8 Mio. | 25.000 Mio. | **6.562×** |

Teurer als 5 $ würde es erst ab 1,67 Mio. geschriebenen Zeilen pro Tag (heute 87.000) oder 833 Mio. gelesenen (heute 0,13 Mio.). **Der Verbrauch müsste sich verneunzehnfachen.**

Der Plan löst zusätzlich zwei Dinge, die heute Zeit kosten: das Schreiblimit als Stillstandsursache entfällt, und das Subrequest-Limit von 50 je Aufruf steigt auf 1.000 — Letzteres ist ein plausibler Mitverursacher der Zeitüberschreitungen im Deep Scan.

### Zwei Entscheidungen, die dabei getroffen wurden

**1. Der Altbestand wird nicht zurückgeholt.** Alles vor 4.2.3 trägt irrtümlich `dropped_ts`; die Rohdaten stehen noch da. Ein Zurücksetzen wäre technisch ein Einzeiler, brächte aber nichts: ohne Protokolleinträge für diese Zeitfenster verwürfe der Auflöser dieselben Zeilen sofort wieder, und der Versuch kostete Schreibzeilen aus dem knappen Budget. **Die Messung beginnt bei null.** Die erste auswertbare Basis entsteht damit frühestens nach einigen Handelstagen — das ist der Preis dafür, dass vorher nichts entstanden ist.

**2. `LEARN_MIN_OBS` bleibt bei 6.** Der Wert war bis jetzt nie erreichbar und ist damit auch nie kalibriert worden. Ihn gleichzeitig mit dem Mechanismus zu ändern, hieße zwei Unbekannte auf einmal zu bewegen. Bei 5-Minuten-Raster über 180 Minuten sind bis zu 36 Beobachtungen möglich; im Watchlist-Modus realistisch fast alle, im Radar-Modus deutlich weniger, weil der Deep Scan nur jede zweite Minute läuft und nicht immer dieselben Titel wählt. **Nachkalibrieren nach dem ersten sauberen Tag anhand der neuen Abdeckungszeile.**

## 3. Verifikation

`node --check` auf `src/worker.js`, `public/app.js`, `public/sw.js`; alle sechs Suiten grün (`safety`, `coinscope`, `provider`, `bandwidth`, `d1`, `sw`). Zusätzlich `npx wrangler deploy --dry-run` mit Wrangler 4.128.0 — derselbe Schritt, an dem der Build gescheitert war: sauber, keine Warnungen, `env.APP_VERSION ("4.0.6")`.

Neue ausgeführte Regressionstests in `tests/safety-regression.mjs`:
- **v4.0.2 Gap-Bezugstag** — mit den echten MRNA-Zahlen (154,27 statt 137,40; `gapPct ≈ −2,2`), nicht mit runden Platzhaltern.
- **v4.0.6 Plan-Alter / Coin-Link / Kartengeometrie** — `planFreshness` wird ausgeführt, nicht per Regex gesucht; `bitpandaUrl()` wird gegen erfundene Paar-Pfade geprüft; die CSS-Geometrie beider Karten wird verglichen und die alte feste Höhe ausdrücklich ausgeschlossen.

- **v4.1.5 Vorrang statt Reife** — 3.000 Rasterfälle vergleichen `maturityBreakdown` gegen eine **bewusst duplizierte** wörtliche Abschrift der 4.1.4-Formel. Die Duplikation ist der Punkt: ein Test, der dieselbe Funktion aufruft, könnte keine Drift sehen. Dazu Rekonstruktion `echo + fresh ≈ value`, der CRV-Deckel-Befund, der negative Phasenanteil als Abzug, und der Fail-closed-Fall ohne gelieferte Zerlegung.

- **v4.1.6 Schreibschwelle und Schreibbudget** — `snapshotWriteDecision` ausgeführt: unbekannt schreibt, 0,05 % nicht, 0,2 % wieder, Ampelwechsel auch ohne Kursbewegung. Die Vergleichsbasis ist der zuletzt **geschriebene** Zustand, nicht der zuletzt gesehene (drei Schritte zu 0,05 % lösen beim dritten aus, weil er von der Basis aus 0,16 % entfernt ist). Aktie und Münze mit demselben Ticker erhalten getrennte Einträge. Ein Durchlauf über **alle** `d1StoreRows`-Aufrufe im Worker fällt beim ersten ohne `onlyChanged`. Der Zähler wird in `tests/d1-usage.mjs` (NK60/NK61) gegen einen festen Ablesezeitpunkt gerechnet, unter `TZ=Europe/Vienna` und `TZ=America/Chicago` geprüft.

- **v4.1.7 Schreibbudget in der App** — `d1Note` ausgeführt über Normalfall, reißende Projektion, aufgebrauchtes Budget, vier Nichtmessungs-Fälle und den Token-Fall.

- **v4.1.8 Datenbanklimit statt Anbieterschuld** — `classifyError` ausgeführt gegen die echten Cloudflare-Meldungstexte (Schreib- und Leselimit) sowie gegen die Anbieterfälle, die dabei nicht mitgerissen werden dürfen. Ein Durchlauf über alle Cron-Fänger fällt, sobald einer die Anbieterlampe wieder direkt setzt.

- **v4.2.0 Session-VWAP** — alle 13 geforderten Fälle ausgeführt, dazu Sommer-/Winterzeit der Sitzungsgrenze und die Live-Quote aus dem Premarket gegen einen Regular-Session-VWAP. Ein Bar-Satz mit Vortag, Premarket und After Hours (je mit riesigem Volumen) muss den Wert **exakt unverändert** lassen.

- **v4.2.1 Tagesobergrenze** — NK62/NK63 prüfen Konfiguration, Rückfall bei Unsinn (`0`, `-5`, `viel`, leer → Vorgabe, nie 0), Reihenfolge und Herkunft. NK64 führt den Auflöser mit erreichter Grenze aus: nichts aufgelöst, nichts verworfen, **keine einzige zusätzliche Abfrage**, Lernzähler unberührt — und nach dem Zurücksetzen wieder frei.

- **v4.2.2 Sichtbarkeit** — Kurzwert `DB 12k/90k` gegen die selbst gesetzte Grenze, Platz in der Systemleiste, `PENDING`-Zustand der VWAP-Kachel, und die Nichtmessung als eigener Kurzwert.

**Neue ausgeführte Prüfungen zu 4.2.3:**
- **NK66–NK71** (`tests/d1-usage.mjs`) — das Beobachtungsprotokoll ausgeführt: erste Beobachtung wird protokolliert und ist zählbar; ein zweiter Eintrag im selben 5-Minuten-Takt kostet **keine** Zeile; Aktie und Münze mit demselben Ticker teilen sich das Protokoll nicht; die vor 4.2.3 zwangsläufig verworfene Zeile wird bei belegter Abdeckung **aufgelöst**, die unbelegte bleibt ein Verwurf; kaputtes JSON gilt als leer statt als blockierend; die Aufbewahrung überdeckt den Lernhorizont.
- **NK72 · Erreichbarkeit** — baut den Aufrufgraphen aus `src/worker.js` und traversiert ihn ab dem Default-Export. Jede Funktion, die in `market_snapshots` schreibt oder den Lernzähler bewegt, muss erreichbar sein. **Das ist die eigentliche Lehre**: vier Suiten haben monatelang bestätigt, dass eine Regel im Quelltext *steht*, ohne je zu fragen, ob sie *läuft*.
- **NK73** — Beobachtung vor der Schreibschwelle, per Index.
- **NK74** — `dropped`/`dropped24h` erreichen den Client und werden **ausgegeben**, nicht nur berechnet.
- **v4.2.3 Abdeckung** (`tests/safety-regression.mjs`) — `coverageNote` ausgeführt über Normalfall, den Totalverwurf-Befund selbst, vier Nichtmessungs-Zweige, das leere Fenster und das unvollständige 24-Stunden-Fenster.

**Negativkontrollen zu 4.2.3**, alle neun haben gefeuert und wurden zurückgesetzt:
- Beobachtung hinter die Schreibschwelle geschoben → NK73 fällt.
- Toten Schreiber wieder eingesetzt → NK72 fällt.
- Auflöser wieder allein auf `obs_n` gestellt → NK69 fällt.
- Taktraste entfernt → NK67 fällt (jeder Aufruf schriebe wieder).
- Snapshot-Zähler entfernt → NK53 fällt.
- `dropped` aus der Nutzlast genommen → NK74 fällt.
- Abdeckungszeile aus dem Bericht entfernt → NK74 fällt.
- Fehlende Zahl wieder als 0 verbucht → der Fail-closed-Test fällt.
- Leeres Fenster als Totalverwurf ausgegeben → der Ampel-Test fällt.

**Zwei Prüfungen mussten dabei selbst repariert werden — beide Male dieselbe Krankheit:**
1. **NK72 lief an der eigenen Gegenprobe vorbei.** Der Aufrufgraph entstand aus dem ungefilterten Quelltext, also zählte jede bloße *Erwähnung* als Aufruf — und ausgerechnet die tote Funktion wird in zwei Kommentaren namentlich genannt. Erst mit `stripComments` feuert der Wächter. Ein Wächter, der den falschen Text liest, ist schlimmer als keiner: er bescheinigt Sicherheit.
2. **NK74 prüfte die Berechnung statt der Anzeige.** Die Gegenprobe „Anzeigezeile entfernen, Berechnung stehen lassen" blieb grün. Geprüft wird jetzt die Ausgabe im Template. Das ist derselbe Anspruch wie bei der VWAP-Kachel in 4.2.2, nur eine Ebene tiefer.

**Anker in den Suiten nachgezogen**, weil zwei Funktionen entfernt wurden: `tests/d1-harness.mjs` (`loadResolver` endet jetzt bei `d1BatchChunks`, dadurch liegen die Protokollfunktionen **mit** im ausgeführten Ausschnitt), NK53 zeigt auf `d1StoreRows` statt auf den toten Pfad, NK54 prüft den Auflöser ausgeführt statt per Muster, NK62 und NK64 auf neue Ankertexte. In `tests/safety-regression.mjs` wurde die feste Zahl 3 für `snapshotPayload(row)` ersetzt: geprüft wird jetzt, dass **jedes** `INSERT INTO market_snapshots` durch denselben Payload-Bauer geht. Eine feste Zahl hätte einen neuen, abweichenden Bauer nicht bemerkt, solange die Summe stimmt.

**Negativkontrollen zu 4.2.2**, alle vier haben gefeuert und wurden zurückgesetzt:
- `vwapNote` wieder `null` zurückgeben lassen → die Sichtbarkeitsprüfung fällt.
- Kurzwert bei fehlender Messung geleert → der Leerstellen-Test fällt.
- `#sysDb` aus der Leiste entfernt → der Platzhalter-Test fällt.
- Gegen das Tariflimit statt gegen die Eigengrenze gemessen → der Kurzwert-Test fällt.

**Negativkontrollen zu 4.2.1**, alle fünf haben gefeuert und wurden zurückgesetzt:
- Bremse hinter die Leseabfrage geschoben → der Reihenfolgetest fällt.
- Vorgabe auf 100.000 ohne Reserve → der Vorgabentest fällt.
- Unbrauchbare Konfiguration als `0` übernommen → der Rückfalltest fällt (eine `0` hätte die App stillgelegt).
- Zähler-Flush mitgebremst → der Instrumententest fällt.
- Nicht lesbaren Tagesstand als „erreicht" gewertet → der Fail-open-Test fällt.

**Negativkontrollen zu 4.2.0**, alle sechs haben gefeuert und wurden zurückgesetzt:
- Sitzungsfilter entfernt → der Vortag zählt mit, der Bar-Zähler fällt.
- Fester UTC-Versatz statt `nyOffsetMs` → der Winterzeit-Test fällt.
- Twelve Data zugelassen → der Datenquellen-Test fällt.
- Relative Stärke als 0 statt null erfunden → der Fail-closed-Test fällt.
- Veralteten Kurs trotzdem bewerten lassen → die Kernforderung-Prüfung fällt.
- Distanz in `vwapScore` gehängt → der Score-Unveränderlichkeits-Test fällt.

**Negativkontrollen zu 4.1.8**, alle drei haben gefeuert und wurden zurückgesetzt:
- `dblimit`-Regel hinter die `daily`-Regel geschoben → die Einstufung fällt zurück auf `daylimit`, der Test fällt.
- Anbieterlampe im Fänger wieder direkt gesetzt → der Durchlauf über die Fänger fällt.
- Modaltext wieder Twelve Data beschuldigen lassen → der Text-Test fällt.

**Negativkontrollen zu 4.1.7**, alle vier haben gefeuert und wurden zurückgesetzt:
- fehlende Messung als `0`/Standardnenner verbuchen → die Fail-closed-Schleife fällt.
- Untergrenzen-Hinweis entfernen → der Zusagen-Test fällt.
- Warnton fest auf `ok` → die reißende Projektion bliebe unauffällig, der Test fällt.
- Anzeige aus dem Lernbericht entfernen → der Sichtbarkeitstest fällt.

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
5. **Vor dem Wechsel auf Paid: Reihenfolge einhalten.** Erst eine saubere Tagesmessung unter 69 Zeilen/min abwarten (offener Punkt 7), dann `D1_WRITE_BUDGET` auf einen Paid-tauglichen Wert setzen (Richtwert 1.500.000), dann den `limits`-Block aktivieren, dann den Tarif wechseln. Nicht umgekehrt: auf Free kostet ein Fehler nichts, auf Paid kostet derselbe Fehler Geld, und diese Sorte Schreibschleife ist in einer Woche zweimal aufgetreten.

6. **Der Vorrang wäre auch inhaltlich zu verbessern** — nachgezogen aus dem erledigten Punkt 4. Die Beschriftung ist seit 4.1.5 ehrlich, die Formel bleibt schwach: der CRV-Term unterscheidet fast nichts (siehe 4.1.5), das Volumen zählt doppelt. Eine bessere Rangfolge wäre denkbar, **aber sie braucht einen Beleg** — welche Reihenfolge trifft im Nachhinein besser? Die Daten dafür liegen in `snapshots` (Modul 0, `/api/attribution`). Ohne diese Auswertung wäre jede neue Gewichtung nur eine andere Meinung, und die Titelauswahl änderte sich ohne Grund.

7. **Die erste belastbare Messung der Schreibrate steht noch aus.** Alles bis 03.09. ist unbrauchbar, weil das Kontingent vor dem Deploy von 4.1.3/4.1.4 erschöpft war (siehe 4.1.6). Der nächste Reset um 00:00 UTC ist der erste ehrliche Lauf. Seit 4.1.7 steht die Antwort im **Lernbericht** der App, Rohwerte weiterhin unter `/api/health` → `d1` → `atLeastRowsWrittenPerMin` gegen `sustainableRowsWrittenPerMin` (69,4) und `writeBudgetHoldsToday`. Fällt die Rate nicht deutlich unter die 3.333/min vom 03.09., wirkt 4.1.3 nicht und der nächste Schritt ist `topQueries` im selben Zweig — der Zähler weist seit 3.32.9 nach Abfrageform aus, welche Form verbraucht.
8. ~~**`d1StoreSnapshotRow` und `d1UpdateOutcomes` haben keinen Aufrufer mehr.**~~ **Erledigt in 4.2.3 — und der Punkt war unterschätzt.** Hier stand, totes Entfernen sei „eine eigene Änderung mit eigenem Risiko". Das stimmte, aber der eigentliche Schaden war nicht das Herumliegen: `d1UpdateOutcomes` war der **einzige** `obs_n`-Schreiber und `d1StoreSnapshotRow` der einzige Snapshot-Zähler. Beide Zahlen waren damit seit dem Wegfall des Aufrufers tot. Wer die Funktionen nur gelöscht hätte, ohne den Ersatz zu bauen, hätte den Befund mitgelöscht.

9. **Die erste Abdeckungsmessung steht aus.** Sie ist ab dem ersten vollen Handelstag nach dem Deploy von 4.2.3 im Lernbericht ablesbar (`Abdeckung 24 h`). Erwartung: im Watchlist-Modus deutlich über 60 %, im Radar-Modus niedriger. Steht der Wert nahe null, wirkt das Protokoll nicht — dann zuerst prüfen, ob `obs_log:server:stock` in `fp_meta` überhaupt Einträge trägt, bevor an `LEARN_MIN_OBS` gedreht wird.

10. **`LEARN_MIN_OBS = 6` ist erstmals eine echte Hürde und nie kalibriert worden.** Nach der ersten Messung anhand des Verhältnisses ausgewertet/verworfen nachziehen — nicht vorher, sonst bewegen sich zwei Unbekannte gleichzeitig.

11. **Der Altbestand bleibt verworfen.** Bewusste Entscheidung (siehe 4.2.3). Falls er je zurückgeholt werden soll: die Rohdaten stehen noch in `market_snapshots`, aber ohne Protokolleinträge für die betreffenden Zeitfenster verwirft der Auflöser sie sofort erneut. Ein Zurückholen wäre nur zusammen mit einer rückwirkenden Abdeckungsschätzung sinnvoll — und die wäre geraten.

**Erledigt in 4.1.5:** der frühere Punkt 4 („Reife %" liest sich wie eine zweite Meinung).
**Erledigt in 4.1.6:** die Änderungsschwelle greift auf allen fünf Schreibpfaden, nicht nur im Watchlist-Zweig.

12. **Die Coin-Heatmap kennt keine Bewegungsachse.** Beide Achsen sind technisch (Qualität × Handelbarkeit). Der Nutzerbefund „BTC trendet und steht nicht da" war zwar ein Lesbarkeitsproblem, zeigt aber eine echte Lücke: die Tagesbewegung ist in der Karte nirgends codiert, obwohl es auf der Aktienseite eigene Mover-Kacheln gibt. Kandidat für eine dritte Codierung (Punktrand, Größe) — **aber erst mit einer Entscheidung, welche Größe genau**, nicht nebenbei.

13. **`modeQuality >= 6.6` im Claude-Coin-Modus ist eine tote Schwelle.** Sie steht zwei Punkte unter der Hürde, die tatsächlich bindet (rund 8,4 über den Erwartungswert). Die Beschriftung ist seit 4.2.4 ehrlich, die Schwelle selbst bleibt — sie zu heben wäre kosmetisch, sie zu senken wäre eine Methodikänderung hinter dem SHA-Riegel. Wenn, dann als eigene, begründete Änderung mit neuem SHA.

14. **Die Coin-Suche über `/api/pair/` kostet zwei Unterabfragen je Aufruf** und umgeht das Orderbuch des Scans. Für den Einzelblick ist das richtig; falls sie häufig genutzt wird, im Bandbreitenzweig von `/api/health` nachsehen.

15. **Wenn eine Anforderung mehrfach zurückfällt, zuerst im Testverzeichnis nachsehen.** Die Bereichs-Symmetrie war „extrem oft besprochen" und kam jedes Mal zurück, weil eine Suite die Abweichung festgeschrieben hatte. Das ist ein Muster, kein Einzelfall: heute sind vier Prüfungen aufgefallen, die grün blieben, während das Geprüfte falsch war (NK72, NK74, die Heatmap-Konstanten, und diese hier). Vor der nächsten „das hatten wir doch schon"-Meldung lohnt die Frage, welcher Test den alten Zustand verteidigt.

16. **Die Aktien-Heatmap zeigt immer dieselben Titel — noch nicht abschließend geklärt.** Bei geschlossener US-Börse ist das erwartbar: `0 aktualisiert`, `Daten veraltet`, die Oberfläche wird aus dem serverseitig persistierten Scan bedient, und ein Neustart der App ändert daran nichts. Die Rotation im Code ist vorhanden und hängt an `cycle = Math.floor(minuteSlot/2)`, also alle zwei Minuten — sowohl für Favoriten (`(cycle*2)%favs.length`) als auch für die Sektorreserve und die Exploration (`(cycle*7)%KATALOG`). **Offen ist, ob sie während der US-Sitzung tatsächlich greift.** Zu prüfen an einem Screenshot bei offener Börse: ändert sich die Punktwolke zwischen zwei Deep-Scans, und was steht in `queue` (favorites/recheck/gainers/radar/boats/explore) aus `/api/stocks`? Steht dort `explore: 0`, verfällt die Rotationsquelle, weil die vorherigen Töpfe `deepLimit` bereits füllen.

17. **Alle Punkte der Heatmap liegen im Quadranten „Muster stark / gut handelbar".** Eine Karte, auf der alles in einer Ecke sitzt, trägt keine Information. Unabhängig von Punkt 16 zu klären, ob Qualität und Handelbarkeit sättigen oder ob die Skalierung zu eng ist.

18. **Die Tiingo-Bandbreite reißt das Kontingent.** Gemessen am 04.09.: 1,91 GB/Tag, hochgerechnet 57 GB/Monat gegen die im Kadenz-Kommentar angenommenen 40 GB. Die Größe je Abruf stimmt exakt (10,8 MB gegen 11,2 MB angenommen) — es ist die ANZAHL, die nicht stimmt: 232 Radar- und 180 BOATS-Abrufe gegen erwartete rund 70. Entweder greift `radarDueNow` nicht wie gedacht, oder der Zähler läuft über mehr Tage als angenommen. **Erst prüfen, dann drosseln** — die Kadenztabelle ist sorgfältig hergeleitet, ein blindes Absenken beschädigt die Marktbreite.

19. **Seit 01.09. 19:55 UTC kein erfolgreicher Aktien-Deep-Scan.** `updatedThisCycle: 0` über zwei Handelstage, `state: 'stale'`, Begründung „Tiingo lieferte keine analysierbaren Bars". Zusammen mit Punkt 18 der wahrscheinliche Grund für die eingefrorene Aktien-Heatmap. Zu belegen am Tiingo-Zweig von `/api/health`: HTTP-Status und Fehlertext der letzten Abrufe.

20. **`safeCarry` kennt keine Altersgrenze.** Jede je gesehene Katalogzeile wird unbegrenzt mitgeschleppt und mit ihren EINGEFRORENEN Werten (`preSignalMaturity`, `situationScore`, `radarRank`, `score`) gegen frisch gemessene Titel sortiert. Ein neu explorierter Titel muss sich gegen bis zu 100 alte Zeilen durchsetzen, die nach ihrem letzten guten Stand bewertet sind. **Damit ist die Rotation der Scan-Warteschlange in der Anzeige unsichtbar** — sie wählt andere Symbole, aber die Rangliste ändert sich nicht. Vorschlag (noch nicht umgesetzt, weil es die täglich gelesene Reihenfolge verändert): das Ranggewicht altern lassen, nicht den Datensatz. Die Zeile bleibt sichtbar und beschriftet, verliert aber mit der Zeit ihren Vorrang.

21. ~~**Es gibt keinen Zähler für GELESENE D1-Zeilen.**~~ **Erledigt in 4.3.8** — der Zähler existierte, es fehlten das Urteil (`readBudgetHoldsToday`) und die Anzeige. Ursprünglicher Text: `d1Meter` misst ausschliesslich `rows_written`; das Free-Tier-Limit von 5 Mio. `rows_read` pro Tag wurde am 04.09. gerissen, ohne dass irgendeine Anzeige in der App das hätte zeigen können. Ein Gegenstück zu `d1WriteBudget` — Zähler, Hochrechnung, `topQueries` nach gelesenen Zeilen — ist der nächste sinnvolle Schritt. Ohne ihn fällt die nächste Abfrage ohne passenden Index genauso lautlos aus.

22. **Jede neue D1-Abfrage braucht einen passenden Index, bevor sie ausgeliefert wird.** `signalHistory` (4.2.9) filterte auf eine Spalte ohne Index und hat damit allein das Tageslimit gesprengt. Prüfregel für den nächsten Zusatz: Welche Spalten stehen im WHERE, in welcher Reihenfolge, und deckt ein Index sie ab?

23. **Das SCHREIBbudget läuft am 05.09. auf 132 Zeilen/min** (56.483 nach 427 Minuten) gegen 62,5 tragfähige — Obergrenze gegen 11:20 UTC erreicht. Der fünfte Index aus 4.3.7 kostet dabei eine zusätzliche Zeile je INSERT (+20 % auf Einfügungen), erklärt aber bei weitem nicht alles. **Zu klären am Feld `topQueries` aus `/api/health`** — es nennt die Anweisung mit dem grössten Verbrauch und ist genau dafür gebaut. Erst messen, dann drosseln: die Änderungsschwelle in `d1StoreRows` ist bereits scharf, ein blindes Absenken beschädigt die Lernschicht, die seit 4.2.3 gerade erst wieder arbeitet.

24. **Der Aktien-Deep-Scan läuft in Zeitüberschreitungen.** Seit 4.3.9 steht der Grund in der roten Systemzeile: „The operation was aborted due to timeout". Das ist die konkrete Spur zum eingefrorenen Aktienstand — zu prüfen sind die Zeitbudgets in `tiingoAnalyseOne`/`fetchWithTimeout` und die Parallelität des `pool(syms, 6, …)`. Sechs gleichzeitige Abrufe je Zyklus gegen einen Anbieter, der pro Titel mehrere Kursreihen liefert, ist der naheliegende Verdächtige.

## 5. Kosten und Cloudflare-Plan

Aktuell **Workers Free**: es gibt keine Abrechnung, bei Erreichen der Limits wird abgewiesen. Kostenrisiko null — aber am 02.09. wurde das tägliche D1-Schreiblimit gerissen, weshalb der Watchlist-Modus aus 4.1.0 entstanden ist.

**Korrektur in 4.1.6 zur bisherigen Aufstiegsrechnung.** Hier stand, der Betrieb liege bei geschätzt 6–9 Mio. Writes/Monat und damit bei 15–18 % der auf Paid enthaltenen 50 Mio. **Diese Zahl war nie gemessen.** Die einzige tatsächlich gemessene Rate ist die vom 03.09.: 3.333 geschriebene Zeilen pro Minute. Ungebremst hochgerechnet sind das rund 144 Mio. pro Monat — knapp das Dreifache des Enthaltenen, und auf Paid würde die Überschreitung ohne Rückfrage abgerechnet. Ob 4.1.3 und 4.1.6 das auf ein tragfähiges Maß drücken, ist noch nicht gemessen (offener Punkt 7).

**Praktische Folge: vor dem Aufstieg auf Paid erst die echte Rate messen.** Auf Free ist ein Fehler ein Stillstand, auf Paid ist derselbe Fehler eine Rechnung — und genau diese Sorte Schreibschleife ist in dieser App innerhalb einer Woche zweimal aufgetreten. Der Reihenfolge nach: erst eine saubere Tagesmessung unter 69 Zeilen/min, dann der `limits`-Block, dann der Aufstieg.

Bei einem Upgrade auf Workers Paid (5 USD Mindestgebühr) wird Überschreitung **automatisch abgerechnet, ohne Rückfrage**. Budget-Alerts sind ausdrücklich nur informativ und deckeln nichts. Die einzigen harten Bremsen sind der auskommentierte `limits`-Block (`cpu_ms` deckelt Rechenzeit, `subrequests` deckelt Zugriffe — letzteres ist die wichtigere, weil D1-Wartezeit nicht zur CPU-Zeit zählt) und strukturell der Minutentakt des Crons: rund 43.200 Aufrufe im Monat.

## 6. Arbeitsweise (Nutzerwunsch)

Autonom arbeiten, kleine gezielte Änderungen, nach jedem relevanten Schritt testen, Fehler selbst beheben, nicht unnötig die ganze Codebasis neu einlesen. **Bei Releaseänderungen genau eine Datei ausgeben** — keine Release Notes, keine Word-/PDF-Zusammenfassungen, keine Kopien alter Versionen. Wenn das gesamte PWA-Verzeichnis gewünscht ist: ein ZIP, Inhalt ohne Unterebene, damit es direkt ins Repository-Root passt. Direkte Antworten mit eigener Einschätzung, keine Rückfragen am Ende.
