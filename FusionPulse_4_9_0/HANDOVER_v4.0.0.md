# FusionPulse v4.0.0 — Release Notes und Übergabe in einem Dokument

**Testlage:** 58 Prüfsuiten grün in `Europe/Vienna`, `America/Chicago`, `Asia/Tokyo`, `Pacific/Auckland` — auch im entpackten ZIP. `audit:reach` byte-identisch zur Baseline.
**Repository:** `github.com/GernotKom/FusionPulse` — Stand dort war zuletzt v3.32.7. Öffentlich: `git clone --depth 1 https://github.com/GernotKom/FusionPulse`.

> **Erste Nachricht für einen neuen Chat:** Lies dieses Dokument vollständig, dann Abschnitt 6. Prüfe zuerst, ob der Repo-Stand übereinstimmt — das stimmte dreimal in Folge nicht. Teste nach jedem Schritt gegen alle 58 Suiten in mindestens zwei Zeitzonen. Ohne ausdrückliche Freigabe **keine** Änderung an `stockLevel`, `stockTradeability` oder Blocker-Listen.

---

## 1 · Warum 4.0

Drei Versionen (3.32.8 bis 3.32.10) haben aufgeräumt, was jahrelang falsch gemessen wurde. Der gemeinsame Nenner aller Befunde ist derselbe Fehler in vier Modulen:

| Modul | Zähler | Nenner | Folge |
|---|---|---|---|
| CRV | Tagesspanne (10 %) | 6 × 5-Minuten-Bars (0,27 %) | CRV 14,3 : 1 aus Volatilitätskontraktion |
| Twin | lokal 5 % / D1 2,04 % | dieselbe Kachel | „Twin %" bedeutete zweierlei |
| Bandbreite | Eigenmessung seit Deploy | Monatskontingent des Kontos | 5 % angezeigt, 16,5 % real |
| Lernreife | `resolved` | `snapshots` ohne Abdeckung | Scheinverlierer als Ergebnis |

Vier Brüche, deren Hälften aus verschiedenen Bezugsrahmen stammen. Jeder einzelne sah plausibel aus. Deshalb 4.0.

---

## 2 · v4.0.0 · Der Radar lief rund um die Uhr

**Befund 02.09., 06:03 CEST = 00:03 ET, geschlossene Börse:** 125 Whole-Market-Abrufe zu je 11,2 MB in gut fünf Stunden. Der Alpaca-Block im Cron trägt einen Marktphasen-Wächter (`minsET>=480 && minsET<=1020 && phase.key!=='closed'`), der Tiingo-Block direkt darunter trug **keinen**. Er lief in etwa zwei von fünf Minuten — nachts, am Wochenende, an Feiertagen.

```
bisher (24/7)                576 Abrufe/Tag    185 GB/Monat
neue Kadenz                   70 Abrufe/Tag     17 GB/Monat
+ BOATS mit wirksamer Sperre                   ~ 4 GB/Monat
                                              ───────────────
                                              ~ 21 GB gegen 40
```

Tiingo meldete am zweiten Tag des Monats 6,61 GB verbraucht. **Bei dem alten Tempo wäre das Limit um den 7. September gerissen und der Aktienteil bis zum 1. Oktober tot gewesen.**

`RADAR_CADENCE_MIN`: opening 3 min, regular 8, premarket 15, premarket-early 60, after 15, after-limited 60, **closed `null` = nie**. Fail-closed: eine unbekannte Phase löst keinen Abruf aus.

**Ausdrücklich nicht gedrosselt:** der Deep Scan. Er läuft über `iex-chart` mit 16,1 KB je Abruf (611 Abrufe = 0,009 GB) und ist es, der `obs_n` füllt. Eine Drosselung dort würde die Beobachtungsabdeckung senken und Snapshots in den Verwurf treiben. **Bandbreite sparen darf nie die Messung beschädigen.**

### Ein selbst eingebauter Fehler, beim Nachrechnen gefunden

Die erste Kadenz (2/5/10/30) ergab beim Durchrechnen nur 36 Abrufe pro Tag, alle aus der Eröffnungsphase. Ursache: `cryptoMinute` ist `cronMinute % 5 === 0`, und der ganze Aktienblock wird in dieser Minute übersprungen. Jede Kadenz, die ein Vielfaches von 5 ist, fällt damit **immer** auf eine Kryptominute — der Radar wäre nie gelaufen. Behoben mit `RADAR_PHASE_OFFSET = 1`; NK76 sichert es ab.

### BOATS: eine TTL im Isolate ist keine TTL

`BOATS_TTL_MS = 20 min` wurde nur in `tiingoDiscoveryMemo` geprüft — einer Modulvariablen. Workers-Isolates starten ständig neu, und mit jedem Neustart ist die Sperre weg. Gemessen: 100 Abrufe zu 6,5 MB in fünf Stunden, wo fünfzehn hätten stehen dürfen. **Faktor sieben.**

Es ist derselbe Fehler wie beim 60-Sekunden-Memo von `learningPayload()`, das das D1-Limit gerissen hat. Die Sperre liegt jetzt in `fp_meta` (`ttlGate` / `ttlMark`), bei geschlossener Börse sechsfach länger. Fail-closed: ist D1 nicht lesbar, gilt die Sperre als **gesetzt** — ein unbekannter Stand darf keinen 6,5-MB-Abruf auslösen.

### Die Bandbreitenanzeige log nicht, aber sie täuschte

`1,98 von 40 GB (5 %)` bei real 6,61 GB (16,5 %). Der Kleingedruckte-Text darunter war korrekt; die Zahl davor stellte eine Eigenmessung seit dem Deploy gegen das Monatskontingent des Kontos.

Neu: `Bandbreite: mindestens 1,98 GB gemessen · Tempo 9,50 GB/Tag`, dazu die Hochrechnung im Titel. **Kein Prozentsatz eines fremden Limits mehr.** Der Ton richtet sich nach dem hochgerechneten Tempo — denn darauf *ist* die Eigenmessung eine gültige Auskunft.

Eine Zusicherung aus dem Bestandstest bleibt erhalten und wäre mir fast verlorengegangen: **40 von 40 GB muss rot sein.** Deshalb gilt: die untere Schranke darf den Ton **verschärfen, nie entspannen**. Ohne Zeitbasis gibt es keine Hochrechnung, und ohne Hochrechnung keine Entwarnung.

---

## 3 · v3.32.10 · R3, der Auflöser

Bisher löste `d1UpdateOutcomes()` nur auf, wenn **genau dasselbe Symbol** erneut gescannt wurde, im Fenster Minute 180–195. Verpasst hieß für immer verloren.

`d1ResolveDue()` läuft jetzt im Cron über alle fälligen Snapshots, symbolunabhängig, ohne untere Zeitgrenze. Erster Schritt des Zyklus, eigener Fehlerkanal.

**Die Zurückhaltung ist wichtiger als die Reparatur.** Einfach alles Fällige aufzulösen wäre gefährlicher gewesen als der Fehler: `max_pct` wächst nur beim Beobachten, ein nie wieder angesehener Snapshot trägt 0, und den aufzulösen hätte „hat sich nicht bewegt" aufgezeichnet, wo „wir haben nicht hingesehen" gilt. Systematisch negativ — die Lernbasis hätte sich mit Scheinverlierern gefüllt und dabei gut belegt ausgesehen.

Neue Spalten `obs_n`, `last_obs_ts`, `dropped_ts`. Aufgelöst wird ab `LEARN_MIN_OBS = 6`, der Rest wird **verworfen und gezählt** — das ist zugleich die Kennzahl „verpasste Auflösungen".

### Twin

`Twin 0% · n=19 · lokal` enthielt zwei Fehler: `lokal` hieß, die Zahl kam aus dem Client-Rückfall, D1 war leer. Und der lokale Zweig zählte auf 5 %, der D1-Zweig auf 2,04 %.

```
Fixkosten je Trade    38,00 €
Ziel +2,04 % → +110 €       Stop −1,02 % → −140 €
Break-even bei  10.000 €:   56,0 %
Break-even bei 100.000 €:   47,7 %
Boden (Größe → ∞):          46,8 %   ← Reibung + KESt bleiben prozentual
Gemessen (0/19), Wilson-Obergrenze:  16,8 %
```

Kachel: `≤16,8% · nötig 56%` plus Urteil **„nicht bezahlbar · auch nicht größer"**. `viable` wird nie `true`, nur `false` oder `null`.

---

## 4 · v3.32.9 · D1 und v3.32.8 · CRV-Geometrie

**D1-Limit gerissen am 01.09.:** `learningPayload()` zählte bei jedem Aufruf die ganze Tabelle. Ersetzt durch fortgeschriebene Zähler in `fp_meta` (Baseline einmal). Gezählt wird `meta.changes`, nicht der Aufruf — wegen `UNIQUE(source,asset_type,symbol,bucket5)`. Read-modify-write gegen nebenläufige Isolates. Telemetrie unter `/api/health.d1`: `rows_read`/`rows_written` je Abfrageform und Pfad, inklusive Cron. `.first()` ist nicht messbar und wird als Lücke ausgewiesen (`complete:false`).

**CRV-Geometrie:** Fokuskarte weist Stopweite und Kostenanteil am Nenner aus, markiert CRV ab 8 : 1 mit „Nenner prüfen", zeigt den Struktur/TP2-Widerspruch ab Faktor 2. Ein Test schneidet den Bereich um `stockTradeability()` heraus und fällt, sobald die Diagnose dort gelesen wird.

---

## 5 · Die sieben Regeln

1. **„Effizienz" heißt hier Euro, nicht Rechenzeit.**
2. **`Number(null)` ist 0.** Sechsmal derselbe Fehler.
3. **Ein `respondWith` darf nie ablehnen.**
4. **Fehlende Daten dürfen nie etwas verbessern.**
5. **„Nicht bewertbar" ist nicht „in Ordnung", und ein Regex-Test ist kein Verhaltensnachweis.**
6. **Ein Negativtest muss den Pfad betreten, den er zu prüfen behauptet.** Drei Fälle: NK49 las den eigenen Kommentar, NK51 betrat den Lese- statt den Schreibpfad, NK66 fand sein Muster in der Nachbarfunktion. Alle drei grün, obwohl der Rückbau saß. **Jeder Rückbau wird vorher auf „greift überhaupt" geprüft.**
7. **Eine fehlende Beobachtung ist kein Messwert.** Die gefährlichste Sorte Fehler: systematisch in die erwartete Richtung, deshalb glaubwürdig.

**Neu aus v4.0.0:** *Eine Sperre, die im Prozessgedächtnis lebt, existiert bei Workers praktisch nicht.* Zweimal getroffen (learningPayload-Memo, BOATS-TTL). Jede TTL, jeder Cache, jede Drossel gehört nach `fp_meta`.

Und: *Ein Bestandstest, der eine Implementierungsformel festnagelt statt der Absicht, bricht bei jeder richtigen Änderung.* Der Radar-Test pinnte `stockMinute%2===1`, seine Aussage war „läuft serverseitig". Beim Prüfen solcher Tests: was steht in der Meldung, und prüft der Ausdruck das?

---

## 6 · Rückstand

### R2 · Modus-A-Freigabesperre — **P1, der wichtigste offene Punkt**

`MODE_A_NO_RELEASE = true` (app.js ~879, `stockLevel()` ~908) macht Stufe 3 strukturell unerreichbar. `tradeMode` steht per Default auf `'A'`. **Solange das so ist, erscheint keine Kaufempfehlung — egal wie gut die Messung wird.**

- **a)** Sperre bleibt, aber die App sagt es sichtbar in der Kopfzeile. **Reine Anzeige, ohne neue Freigabe baubar.** Empfehlung: sofort.
- **b)** Sperre fällt, dafür Momentum-Blocker scharf plus Mindest-Stopweite aus R1.1.
- **c)** Modus-Standard von `'A'` zurück auf den Positionsmodus.

### Eine Woche messen — **P1**

- `stats.resolved / stats.snapshots` — greift der neue Auflöser?
- `stats.dropped` — wie viel Beobachtung fehlt? Steht das hoch, ist nicht die Datenmenge das Problem, sondern die Abdeckung.
- `/api/health.d1` — welcher Pfad verbraucht die Reads?
- **Tiingo-Kontostand gegen die Eigenmessung** — der Faktor 3,3 vom 02.09. gehört nachgeprüft, sobald v4.0.0 einen vollen Tag läuft.

### R1 · CRV-Geometrie — Entscheidung nötig

1. **Mindest-Stopweite** `max(0,6 × ATR, 3 × Kostenschwelle)`. Empfehlung: bauen.
2. **Plausibilitätsdeckel im Momentum-Zweig** `min(Tagesspannen-Projektion, Strukturpotenzial × 1,5)`. Erst nach 1. messen.

**Anzeigefehler, offen:** „Plan-CRV" und „Plan-Effizienz" sind im Claude-Modus dieselbe Zahl, nur anders gerundet.

### R4 · Lernreife-Balken — P2

Vier Balken: Aufzeichnung, Lernreife (`twin.n / 5`), **Streuung** (`distinctSymbols`), **Abdeckung** (`dropped/(resolved+dropped)`). Nie grün, wenn `stats.exact === false`.

### R5 · D1-Effizienz — Punkte 1 und 2 erledigt

Offen: Attribution/Pattern bis 8.000 Zeilen, unresolved-Batches bis 3.000, Twins 500 je Sektor, 46 Symbolabfragen in `learningPayload()`. Workers Paid sinnvoll als Puffer, kein Ersatz für die Behebung.

### R14 · Alpaca-Snapshots — **jetzt hochgestuft**

Live-Quotes der ~20 Deep-Scan-Titel über `/v2/stocks/snapshots?symbols=…` statt Tiingo. Code liegt bereits da. War ein Bandbreiten-Argument, ist jetzt der direkteste Hebel auf `obs_n`: mehr Beobachtungen → weniger Verwurf → mehr verwertbare Episoden.

### R6 · Repository aufräumen — P3

186 Dateien, 118 im Root, 48 `RELEASE_NOTES*`, 27 `HANDOVER_NEW_CHAT*`. Kern vorher in **eine** Lehren-Datei. `migrations/` behalten. **Ab dieser Version wird nur noch ein Dokument je Release erzeugt.**

---

## 7 · Testkonventionen

- `npm run check` = `node --check` auf app.js/worker.js/sw.js + 6 Suiten, **58 grüne Prüfungen**.
- Mindestens **zwei Zeitzonen**; Fixtures aus der geprüften Zone ableiten, nie aus UTC oder der Browserzone.
- **Rückbau-Probe fahren, nicht behaupten** — und vorher prüfen, ob sie greift. Aktuell bis **NK79**.
- Bei Fehlerfällen: welcher `return` wird tatsächlich erreicht? Bei Musterprüfungen: endet der Slice vor der Nachbarfunktion? Kommentare vorher entfernen (`stripComments`).
- Harnesses: `client-harness.mjs` (führt app.js aus), `d1-harness.mjs` (`loadD1`, `loadResolver`, Double mit `rows_read`/`changes`, getrennte Lese-/Schreibausfälle).
- Fixtures für `historicalTwin` brauchen **alle** Schlüssel aus `featureOf()`, sonst ergibt `twinDist()` NaN.
- `assert.strictEqual` gegen `null`, nicht `assert.ok`.
- ZIP nach dem Packen **entpacken und erneut prüfen**.

---

## 8 · Offene Beobachtungen

- **Kopfzeile gegen Radar:** oben „20 gescannt / 2 angezeigt von 216", im Radar „Universum · 20 angezeigt · RADAR 20". Zwei Zahlen für dieselbe Sache. **Ungeklärt.**
- **„Risk-On · 85 % über VWAP"** bei geschlossener Börse aus lauter Schlusskursen, ohne dass die Kopfzeile den Datenstand mitträgt. Am Vortag stand dort „Risk-Off · 15 %" — der Komplementärwert.
- **Client und Worker rechnen die wirtschaftlichen Schwellen doppelt** (`econWinPct()` / `ECON_WIN_PCT`). NK67 sichert die Übereinstimmung. Sauberer wäre, den Wert vom Server zu beziehen.
- **Fokus-Fenster zeigte im Coins-Bereich einen Aktientitel** (MRNA) mit Coin-CRV-Fußzeile; im zweiten Screenshot BWXT mit USDC-Fußzeile. **Zweimal beobachtet, noch nicht geprüft** — wenn das Fenster bereichsübergreifend gefüllt wird, sind Geometriekacheln und Twin-Kachel dort falsch zugeordnet.
- „Twelve Data Fallback" trotz freiem Tiingo — bei Wiederauftreten während einer US-Sitzung Umschaltlogik prüfen.
