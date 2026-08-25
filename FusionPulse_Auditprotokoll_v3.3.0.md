# AUDITPROTOKOLL

## Release-/Regressions-Audit FusionPulse

| Feld | Eintrag |
|---|---|
| **Protokoll-Nr.** | FP-AUD-2026-08-25-01 |
| **Audittyp** | Abschließender Release-/Regressions-Audit (statisch, read-only) |
| **Auftraggeber** | Betreiber / Entwickler FusionPulse |
| **Prüfer** | Claude Opus 5 (Anthropic), statische Code-Analyse |
| **Auditdatum** | 25.08.2026 |
| **Auftragsgegenstand laut Anforderung** | FusionPulse **v3.3.9** |
| **Tatsächlich vorgelegter Prüfgegenstand** | FusionPulse **v3.3.0** |
| **Auftragsumfang** | Fehler, Regressionen, Inkonsistenzen, Laufzeitprobleme. **Ausdrücklich ausgeschlossen:** neue Features, Änderungen an Tradingregeln oder Schwellenwerten |
| **Prüfergebnis** | **NOT READY — Release blockiert** |

---

## 0. Vorbehalt zum Prüfgegenstand (Audit-Blocker)

Das übergebene Archiv enthält **nicht** die zu auditierende Version.

| Artefakt | Erwartet | Vorgefunden |
|---|---|---|
| `package.json` → `version` | 3.3.9 | **3.3.0** |
| `src/version.js` → `APP_VERSION` | 3.3.9 | **3.3.0** |
| `public/version.js` → `self.FP_VERSION` | 3.3.9 | **3.3.0** |
| `public/sw.js` → `APP_VERSION` | 3.3.9 | **3.3.0** |
| `public/index.html` → `<title>` | 3.3.9 | **3.3.0** |
| `wrangler.jsonc` → `vars.APP_VERSION` | 3.3.9 | **3.3.0** |

**Bewertung:** Die Versionskonsistenz *innerhalb* des vorgelegten Builds ist einwandfrei — alle sechs Artefakte tragen dieselbe Nummer, `scripts/sync-version.mjs` funktioniert. Prüfpunkt 7 „Versionskonsistenz" ist damit für 3.3.0 **erfüllt**.

**Zusätzlicher Beleg für die Versionslücke:** Der unter Prüfpunkt 5 geforderte **Google-Finance-Link existiert im gesamten Build nicht**. Suche über `public/index.html` ergibt außer Manifest, Apple-Touch-Icon und Stylesheet keinerlei `href`; Volltextsuche auf `google` in `public/app.js` trifft ausschließlich einen Tooltip-Text zu Google Trends. Das Feature ist in 3.3.0 nicht implementiert.

**Konsequenz:** Alle nachfolgenden Feststellungen beziehen sich verbindlich auf **v3.3.0**. Eine Aussage über v3.3.9 ist auf dieser Grundlage nicht möglich. Das Audit wurde dennoch vollständig durchgeführt, weil die vom Auftraggeber gemeldeten Kernfehler in diesem Stand **nachweisbar vorhanden** sind.

---

## 1. Prüfgegenstand — Artefaktverzeichnis

**Quellarchiv:** `FusionPulse_v3_3_0.zip`
**SHA-256 (Archiv):** `e1197e7418f262cbaa4d95003999f5a850655db949b98a8c2f0db6b7e7bd7291`

| Datei | Zeilen | SHA-256 | Änderungszeit |
|---|---:|---|---|
| `public/app.js` | 1.879 | `5ee1ad92…f93d1e` | 25.08.2026 06:12 |
| `src/worker.js` | 2.394 | `860d960d…66621e` | 25.08.2026 06:12 |
| `public/index.html` | 259 | `5894741a…ca18b6` | 25.08.2026 06:11 |
| `public/style.css` | 644 | `2b857763…cd5c1d` | 25.08.2026 06:11 |
| `public/sw.js` | 56 | `8857f7d1…381d46` | 25.08.2026 06:09 |
| `public/version.js` | 2 | `17dc89cc…2fbfd0` | 25.08.2026 06:13 |
| `src/version.js` | 10 | `f1e8f133…fe9bb0` | 25.08.2026 06:09 |
| `package.json` | — | `04207c7d…f36bb8` | 25.08.2026 06:09 |
| `wrangler.jsonc` | — | `62f52164…601f9c` | 25.08.2026 06:09 |
| `tests/safety-regression.mjs` | 108 | `1b78ab92…78e05b` | — |
| `scripts/sync-version.mjs` | 49 | `b6e2abc4…4165ee` | — |

**Geprüfter Codeumfang:** 5.232 Zeilen produktiver Code (JS/HTML/CSS), zzgl. Konfiguration, Migrationen und Testharness.

---

## 2. Prüfmethodik und Prüftiefe

| Verfahren | Werkzeug / Vorgehen | Ergebnis |
|---|---|---|
| Syntaxprüfung | `node --check` auf `app.js`, `worker.js`, `sw.js` | **bestanden** (3/3) |
| Bestehende Sicherheits-Regression | `node tests/safety-regression.mjs` | **bestanden** |
| Symbolauflösung Frontend | Skriptgestützter Abgleich aller Aufrufbezeichner gegen Deklarationen | **1 undefinierte Funktion** (→ F-05) |
| DOM-Selektor-Abgleich | Alle `$('#…')` gegen `id="…"` in `index.html` | 7 Treffer, 6 unkritisch (Detail-Templates), 1 verifiziert vorhanden |
| Kontrollflussanalyse Fokus-Kette | Manuelle Verfolgung aller 6 Einstiegspunkte → `focusStock` → `renderStocks()` → API | **4 Defekte** |
| Nebenläufigkeitsanalyse | Manuelle Prüfung aller `async`-Handler auf Sequenz-Guards und geteilten Zustand | **2 Race Conditions** |
| Datenintegritätspfade | Verfolgung Kurs / Timestamp / Spread / RVOL / ATR / MTF / Crowd / CRV vom Provider bis zur Anzeige | **3 Defekte** |
| Provider-/Ausfallverhalten | Tiingo, Twelve Data, Alpaca, SerpApi — Timeout, Retry, Fallback, Isolation | **1 struktureller Mangel** |
| Krypto-/Aktien-Isolation | Routen, Memos, Timer, Fehlerpfade | **konform** (eine Ausnahme durch F-05) |

**Prüftiefe:** statisch, ohne Laufzeitausführung gegen Live-Provider (keine API-Token vorliegend). Feststellungen, die nur unter Laufzeitbedingungen final verifizierbar wären, sind in Abschnitt 6 **ausdrücklich als Vermutung** ausgewiesen und **nicht** als Fehler gewertet.

---

## 3. Feststellungsübersicht

| ID | Prio | Kurztitel | Datei | Betroffener Prüfpunkt |
|---|---|---|---|---|
| F-01 | **P0** | Fokusfenster fällt auf ersten Listeneintrag zurück | `app.js` | 1, 5 |
| F-02 | **P0** | Race Condition bei schnellem Aktienwechsel | `app.js` | 1, 7 |
| F-03 | **P0** | Kein Abgleich angeforderter ↔ gelieferter Ticker | `app.js` / `worker.js` | 1 |
| F-04 | **P0** | Fokus springt nach jedem Poll selbsttätig weg | `app.js` / `worker.js` | 1, 5 |
| F-05 | **P0** | `regimeExplanation()` undefiniert — ReferenceError | `app.js` | 7, 4 |
| F-06 | **P0** | BUY-Badge ohne Freshness-Gate; `marketOk` fail-open | `app.js` | 2, 6 |
| F-07 | **P0** | Fokusfenster zeigt Kurs ohne Freshness-Kennzeichnung | `app.js` | 2, 5 |
| F-08 | **P0** | „AKTUELLER SCAN" im Produktivpfad unerreichbar | `app.js` / `worker.js` | 2, 3 |
| F-09 | P1 | Kein Timeout/AbortController; Poll-Kette bricht dauerhaft | `app.js` / `worker.js` | 3, 7 |
| F-10 | P1 | Crowd-Pulse feuert minütlich statt alle 20 min | `app.js` / `worker.js` | 7 |
| F-11 | P1 | Chart-Cache ohne TTL — Fokuschart friert ein | `app.js` | 7 |
| F-12 | P1 | Ohne D1-Binding dauerhaft leerer Aktienradar | `worker.js` | 3 |
| F-13 | P1 | Cache-Treffer wird als frischer Scan etikettiert | `app.js` | 2 |
| F-14 | P1 | Alpaca: stiller Fallback auf Tages-Bar | `worker.js` | 3 |
| F-15 | P1 | Radar-Quotes altersgeprüft, aber nicht altersgefiltert | `worker.js` | 2, 3 |
| F-16 | P1 | Erste Session lädt sich selbst neu (Service Worker) | `sw.js` / `app.js` | 7 |
| F-17 | P2 | Fokus verschwindet unter Sticky Header | `style.css` | 5 |
| F-18 | P2 | Irreführendes VWAP-Label bei unbekanntem Volumen | `worker.js` | 2 |
| F-19 | P2 | Timer-Akkumulation in `registerSignal()` | `app.js` | 7 |
| F-20 | P2 | Divergierendes Nicht-Stammaktien-Regelwerk UI ↔ Server | `app.js` / `worker.js` | — |
| F-21 | P2 | Update-Banner und Auto-Reload konkurrieren | `sw.js` / `app.js` | 7 |

**Summe:** 8 × P0 · 8 × P1 · 5 × P2

---

## 4. Einzelfeststellungen

### F-01 · P0 · Fokusfenster fällt auf ersten Listeneintrag zurück

- **Datei / Codebereich:** `public/app.js` → `renderStocks()`, Zeile 1015
- **Ursache:** `const top = shown.find(r=>r.symbol===focusStock) || shown[0];`
  `shown` ist durch Suchfeld und `#stockF` gefiltert **und** durch `.slice(0, S.stockCount)` (Default 12) gekürzt. Jedes Symbol außerhalb dieser 12 sichtbaren Zeilen fällt in `|| shown[0]`.
  Ein hartcodiertes „PMI" existiert **nicht** — PMI ist der Titel, der aktuell nach `preSignalMaturity` auf Rang 1 sortiert. Das Symptom ist damit vollständig erklärt.
  **Verschärfend:** Drei der sechs Einstiegspunkte besitzen keinerlei Nachlade-Fallback und setzen nur `focusStock=…; renderStocks();`:
  `renderMarketGainers()` Z. 994 · `renderExtendedWatch()` Z. 972 · `renderSignalBanner()` Z. 283.
  Deren Kandidaten stammen aus `stockMeta.discovery.radar.gainers` bzw. `openingRows` — Quellen, die per Konstruktion nicht in `stockRows` enthalten sein müssen.
- **Reproduktion:** Aktienbereich öffnen → im Panel „📈 Market Gainer" eine Aktie anklicken, die nicht unter den ersten 12 Listenzeilen steht → Fokusfenster zeigt den Listenkopf. Deterministisch reproduzierbar.
- **Minimal-invasive Lösung:** Fallback nur bei leerem `focusStock` zulassen:
  `const top = focusStock ? shown.find(r=>r.symbol===focusStock) : shown[0];`
  Im `!top`-Zweig (Z. 1016) statt der Suchmeldung einen expliziten Ladezustand `„${focusStock} wird geladen…"` ausgeben. Die drei Handler auf das Muster von `renderOpeningPanel()` (Z. 981–986) angleichen. Keine Regeländerung.

---

### F-02 · P0 · Race Condition bei schnellem Wechsel zwischen zwei Aktien

- **Datei / Codebereich:** `public/app.js` → `searchStockNow()` Z. 1144–1147; Handler Z. 752–753, Z. 764, Z. 981–986
- **Ursache:** Zwei Sperren kollidieren mit der Zweckentfremdung des Suchfelds als Transportkanal.
  Sperre: `if (!raw || stockSearchBusy || Date.now()-stockSearchLastTs<5000) return;`
  Handler: `const old=q.value; q.value=focusStock; await searchStockNow(); q.value=old;`
  Ablauf: Klick A setzt `q.value='A'` und wartet. Klick B innerhalb 5 s liest `old = 'A'`, setzt `q.value='B'`, `searchStockNow()` kehrt wegen `stockSearchBusy`/5-s-Sperre **sofort und ohne Rückmeldung** zurück, anschließend `q.value = 'A'`. Das Suchfeld enthält nun A, `renderStocks()` filtert `stockFiltered` auf A, `focusStock='B'` liegt nicht in `shown` → F-01 greift.
- **Ergebnis:** Der Nutzer klickt B und sieht **A** — die zuvor selektierte Aktie. Exakt das gemeldete Symptom in seiner schärfsten Ausprägung.
- **Reproduktion:** Zwei Titel im Opening-Momentum-Panel, die beide nicht in `stockRows` enthalten sind, innerhalb von 5 Sekunden nacheinander anklicken.
- **Minimal-invasive Lösung:** Suchfeld nicht mehr als Parameterkanal verwenden. `searchStockNow(symbolOverride)` um einen optionalen Parameter erweitern, der `raw` direkt setzt und die 5-s-Drosselung überspringt (diese gilt dem Tippen, nicht dem Klick). Zusätzlich Sequenz-Guard analog `stockReqSeq`: `const req = ++stockLookupSeq; … if (req !== stockLookupSeq) return;`

---

### F-03 · P0 · Kein Abgleich zwischen angefordertem und geliefertem Ticker

- **Datei / Codebereich:** `public/app.js` Z. 1157–1159 · `src/worker.js` → `tiingoStockLookup()` Z. 2204–2214, `resolveStockQueryLive()` Z. 1168–1196
- **Ursache:** Der Worker löst freie Eingaben über Tiingo-Search bzw. Twelve-Data-`symbol_search` auf und liefert `row.symbol` = **aufgelöstes**, nicht angefragtes Symbol. Das Frontend übernimmt ungeprüft: `m.set(data.row.symbol, data.row); stockRows = [...m.values()];`
  An keiner Stelle existiert ein Vergleich `data.row.symbol === angefragterTicker`. Bei Abweichung bleibt `focusStock` auf dem angefragten Ticker, die Zeile landet unter einem anderen Symbol → F-01 → fremder Titel im Fokus, ohne jeden Hinweis.
- **Reproduktion:** Suchfeld → mehrdeutigen Firmennamen eingeben, der bei Tiingo/Twelve auf ein anderes Listing (ADR, Zweitnotiz) auflöst.
- **Minimal-invasive Lösung:** Nach `const data = await res.json()` prüfen. Bei Abweichung `focusStock = data.row.symbol` nachziehen **und** sichtbaren Hinweis „Angefragt X → geliefert Y" ausgeben, statt still zu divergieren. Reiner Guard, keine Logikänderung.

---

### F-04 · P0 · Fokus springt nach jedem Poll selbsttätig auf einen anderen Titel

- **Datei / Codebereich:** `public/app.js` → `scanStocks()` Z. 1122, `mergeFavoriteRows()` Z. 60–68 · `src/worker.js` → `tiingoStockSnapshot()` Z. 2129–2131
- **Ursache:** Der Worker filtert im Client-Pfad die persistierten Rows hart auf
  `(catalogSet.has(sym) || favs.includes(sym) || allowed.has(sym))`.
  Ein per Suche oder Radar-Klick geladener Titel, der weder im Basiskatalog noch in den Favoriten noch im verifizierten Radar steht, fehlt in der **nächsten** Antwort. Im Frontend ersetzt `stockRows = mergeFavoriteRows(data.rows)` die Liste vollständig; `mergeFavoriteRows()` rettet aus dem Cache **ausschließlich Favoriten** (`if(!isFavStock(sym)) continue`). Der aktive Fokus-Titel verschwindet, Z. 1015 setzt auf `shown[0]`.
- **Reproduktion:** Nicht-Favoriten-Titel über die Suche in den Fokus holen, nichts weiter anklicken, ca. 2 Minuten warten (Tiingo-Poll `2*60_000`, Z. 1187). Der Fokus wechselt eigenständig auf den Listenkopf.
- **Minimal-invasive Lösung:** In `mergeFavoriteRows()` den aktiven Fokus einschließen:
  `if(!isFavStock(sym) && sym !== focusStock) continue;`
  Die zurückgeholte Zeile trägt bereits `_staleLast:true` und wird dadurch korrekt als „ANGEZEIGT / NICHT DIESE RUNDE" gekennzeichnet.

---

### F-05 · P0 · `regimeExplanation()` undefiniert — ReferenceError blockiert den gesamten Krypto-Render

- **Datei / Codebereich:** `public/app.js` Z. 1556 (`render()`) und Z. 1865 (Klick-Handler `#regime`)
- **Ursache:** Die Funktion wird zweimal aufgerufen und **nirgends deklariert**. Volltextsuche über `app.js` und `index.html` ergibt ausschließlich diese beiden Aufrufe.
  **Fehlerkette beim Klick auf den Regime-Button:**
  1. Z. 1865 `el.classList.toggle('hidden', false)` → Panel wird sichtbar
  2. `el.innerHTML = regimeExplanation()` → **`ReferenceError: regimeExplanation is not defined`**, uncaught; `aria-expanded` wird nie gesetzt
  3. Der Outside-Click-Handler (Z. 1866) prüft `!e.target.closest('.hstat')`. `#regime` liegt laut `index.html` Z. 26–27 **innerhalb** von `.hstat` → das Panel bleibt sichtbar
  4. Ab diesem Zeitpunkt trifft **jeder** `render()`-Durchlauf die Zeile 1556 und wirft erneut → `renderFocus()`, `renderMap()`, `renderList()` werden nie erreicht
  5. In `scan()` fängt der `catch` den Fehler ab: Statuszeile zeigt `Fehler: regimeExplanation is not defined`, `dataset.state='err'`, das Krypto-Fokusfenster friert auf dem letzten Stand ein
- **Kollateralschaden:** `loadLearning()` (Z. 940–941) ruft `render()` innerhalb seines `try` auf. Der ReferenceError wird dort als Learning-Fehler fehlinterpretiert (`learningData={state:'error'}`), **und das in derselben Zeile folgende `renderStocks()` wird übersprungen** — der Aktienbereich aktualisiert ebenfalls nicht mehr. Damit ist dies der einzige Pfad, der die sonst saubere Krypto-/Aktien-Isolation durchbricht.
- **Reproduktion:** Einmaliger Klick auf die Regime-Anzeige im Header. Konsole öffnen.
- **Minimal-invasive Lösung:** Kein neues Feature implementieren. Beide Aufrufe auf den bereits vorhandenen statischen Text umleiten, der in Z. 1553 als `reg.dataset.tip` gesetzt wird:
  `const regimeExplanation = () => $('#regime')?.dataset.tip || '';`
  Eine Zeile. Kein neues Verhalten.

---

### F-06 · P0 · BUY-Badge ohne Freshness-Gate; `marketOk` fail-open

- **Datei / Codebereich:** `public/app.js` → `stockTradeability()` Z. 214–224, `stockLevel()` Z. 226–230
- **Ursache A — Freshness fehlt im BUY-Pfad:** `stockLevel(r)===3`, die Bedingung für den sichtbaren `🟢 BUY`-Badge in Zeile und Fokus, prüft `light`, `score>=8` und `stockTradeability()`. **`stockFreshness()` kommt darin nicht vor.** Freshness wird nur an zwei anderen Stellen ausgewertet: im Tonpfad (`soundEligible`, Z. 1088) und in `stockOpportunity()` (Z. 574). Der visuelle BUY-Badge ist ungeschützt.
  `mergeFavoriteRows()` holt Favoriten mit `_staleLast:true` aus `localStorage` zurück (Z. 65). Nach einem Reload kann eine stundenalte Favoritenzeile mit `light:'green'` und `score>=8` unmittelbar `🟢 BUY` mit dem alten Kurs anzeigen.
- **Ursache B — Marktphasen-Gate öffnet bei fehlenden Daten:** Z. 218–219
  ```
  const currentPhase = stockMeta?.market?.key || r.marketPhase;
  const marketOk = !currentPhase || ['regular','opening'].includes(currentPhase);
  ```
  Fehlt `stockMeta.market` — im Fehlerpfad von `/api/stocks` (`worker.js` Z. 2340–2345) enthält die Antwort **kein `market`-Feld**, und `scanStocks()` Z. 1123 führt `stockMeta = data` als Vollersatz aus — und ist `r.marketPhase` auf der Cache-Zeile leer, ergibt `!currentPhase` → **`marketOk = true`**. Fehlende Daten öffnen das Gate. Das ist die Umkehrung des geforderten Fail-closed-Prinzips.
- **Reproduktion (A):** Favorit mit grünem Setup, Browser neu laden, vor der ersten Serverantwort den Aktienbereich betrachten.
- **Reproduktion (B):** `/api/stocks` einen 502 liefern lassen (Tiingo-Token temporär entziehen) → `stockMeta.market` entfällt → Marktphasen-Gate inaktiv.
- **Minimal-invasive Lösung:** Zwei Guards, **keine** Schwellenwertänderung:
  `const marketOk = !!currentPhase && ['regular','opening'].includes(currentPhase);`
  und in `stockLevel()`: bei `stockFreshness(r).key !== 'live'` das Ergebnis auf `Math.min(2, …)` deckeln. BUY wird auf „beobachten" begrenzt; alle bestehenden Schwellen bleiben unverändert.

---

### F-07 · P0 · Fokusfenster zeigt Kurs ohne jede Freshness-Kennzeichnung

- **Datei / Codebereich:** `public/app.js` → `renderStocks()`, Fokus-Template Z. 1018
- **Ursache:** Die Listenzeile (Z. 1035) enthält `<small class="stock-updated fresh-${…}">${stockUpdateLabel(r)}</small>`. Im Fokus-Template — der Fläche, auf der die Handelsentscheidung fällt — kommt weder `stockUpdateLabel` noch `stockFreshness` noch `_staleLast` vor. Verifiziert durch Volltextsuche im gesamten Template-String Z. 1018.
  Das Feld `Kurs <b>${stockPx(top.priceUsd, top.priceEur)}</b>` ist bei einem vier Stunden alten Cache-Wert optisch identisch mit einem Live-Wert.
- **Verstoß gegen:** Prüfpunkt 2 — „Ein nicht aktueller Aktienkurs muss klar als verzögert/Fallback/nicht live gekennzeichnet sein."
- **Reproduktion:** Favoriten-Titel nach Marktschluss öffnen. Das Fokusfenster zeigt einen Kurs ohne jeden Hinweis auf dessen Alter.
- **Minimal-invasive Lösung:** Den bestehenden `<small class="stock-updated fresh-…">`-Baustein in das Fokus-Template übernehmen, unmittelbar unter das Kurs-Feld. Reines Anzeigeelement, kein Logikeingriff.

---

### F-08 · P0 · „AKTUELLER SCAN" im Produktivpfad unerreichbar — Opportunity-Freigabe und Aktien-Ton dauerhaft inaktiv

- **Datei / Codebereich:** `public/app.js` → `stockFreshness()` Z. 156–164 · `src/worker.js` → `tiingoStockSnapshot()` Z. 2115, 2131, 2134
- **Ursache:** `stockFreshness()` besitzt **genau einen** Pfad zu `key:'live'` — `refreshedSymbols` muss das Symbol enthalten. Im Client-Pfad liefert der Worker jedoch in **allen drei** Rückgabezweigen (Memo-Cache, Persistent-Cache, Stale) fest `refreshedSymbols: []`. Ein nicht leeres Array entsteht ausschließlich bei `execution === 'server'` (Cron, Z. 1810) oder `force=1`. Das Frontend ruft `scanStocks(false)` (Z. 1187, 1738, 1780); `force` wird nur bei Einstellungsänderung gesetzt.
- **Folge:** `f.key` ist im Normalbetrieb nie `'live'`.
  - `stockOpportunity().ready` (Z. 574) kann nie `true` werden → OPPORTUNITY/HIGH OPPORTUNITY erscheint nie
  - `soundEligible` (Z. 1088) ist nie erfüllt → der Aktien-BUY-Ton feuert nie
- **Besondere Bedeutung:** Dieser Defekt **maskiert F-06**. Beim Testen entsteht der Eindruck, das Freshness-Gate greife flächendeckend — tatsächlich greift es nirgends sichtbar. Zwei Fehler, die einander gegenseitig tarnen.
- **Reproduktion:** App während der US-Handelszeit laufen lassen. Jede Aktienzeile zeigt dauerhaft „ANGEZEIGT / NICHT DIESE RUNDE" oder „GECACHED", niemals „AKTUELLER SCAN".
- **Minimal-invasive Lösung (bevorzugt):** Im Worker `refreshedSymbols` aus `persisted.meta.refreshedSymbols` durchreichen — der Wert wird in Z. 2201 bereits geschrieben, im Client-Pfad jedoch verworfen.
  **Alternative:** In `stockFreshness()` einen zweiten, datenbasierten Live-Pfad ergänzen (`updated` jünger als 6 Minuten **und** Marktphase `regular`/`opening`). Keine Lockerung einer Schwelle, sondern Nachziehen eines fehlenden Wegs.

---

### F-09 · P1 · Kein Timeout / kein AbortController — Poll-Kette bricht dauerhaft ab

- **Datei / Codebereich:** `public/app.js` — `scanStocks()`, `scanOpeningMomentum()`, `loadCrowd()`, `loadLearning()`, `loadExperimental()`, `searchStockNow()`, Chart-Fetch Z. 1020; `setStockPoll()` Z. 1183–1189. Serverseitig: `tiingoFetch()` Z. 1833, `twelveJSON()` Z. 1143, `alpacaJSON()` Z. 1344, `fetchJSONPublic()` Z. 1411
- **Ursache:** Ausschließlich `scan()` (Krypto, Z. 515) verwendet einen `AbortController`. Alle übrigen Fetches besitzen weder Signal noch Timeout. Kritisch wird dies durch die Planungsreihenfolge in `setStockPoll()`:
  `stockTimer = setTimeout(async () => { … await scanStocks(false); scheduleStockPoll(); }, delay);`
  Die Folgerunde wird erst **nach** dem `await` geplant. Hängt der Request ohne Timeout, wird nie wieder ein Aktien-Poll eingeplant — bis zum Reload.
  Retry-Logik existiert im gesamten Projekt an keiner Stelle. Die Anforderung „Timeouts, Retry und Fallback" (Prüfpunkt 3) ist nur im Teil „Fallback" erfüllt.
- **Reproduktion:** Netzwerk-Throttling auf „Offline" schalten, nachdem ein Request abgesetzt wurde.
- **Minimal-invasive Lösung:** `AbortSignal.timeout(20_000)` an alle genannten Frontend-Fetches; `scheduleStockPoll()` in ein `finally` verlagern. Serverseitig `signal: AbortSignal.timeout(…)` in den vier Fetch-Wrappern.

---

### F-10 · P1 · Crowd-Pulse feuert minütlich statt alle 20 Minuten

- **Datei / Codebereich:** `public/app.js` Z. 1178, Z. 1191, Z. 1198, Z. 954 · `src/worker.js` → `crowdPulse()` Z. 1463–1481
- **Ursache:** `scanOpeningMomentum()` ruft am Ende `loadCrowd(false)` auf; `openingTimer` läuft im 60-Sekunden-Takt. Der separate `crowdTimer` (60 min, Z. 1198) ist dadurch faktisch wirkungslos.
  Der Server-Memo (Z. 1466, TTL 20 min) greift nicht: Der Cache-Key ist die exakte Symbolliste, gebildet aus `stockRows.slice(0,12)` (Z. 954). Deren Reihenfolge ändert sich bei jedem Scan → **Cache-Miss bei nahezu jedem Aufruf**. Der Worker durchläuft dann eine **sequenzielle** `for`-Schleife über bis zu 15 SerpApi-Calls innerhalb eines einzigen Requests.
- **Größenordnung:** ca. 21.600 statt ca. 1.000 SerpApi-Calls pro Tag, zzgl. erheblicher Worker-Wall-Time pro Aufruf.
- **Minimal-invasive Lösung:** `loadCrowd(false)` aus Z. 1178 entfernen (der `crowdTimer` deckt den Bedarf ab); Server-Cache-Key auf die **sortierte** Symbolliste normalisieren.

---

### F-11 · P1 · Chart-Cache ohne TTL — Fokuschart friert für die Sitzung ein

- **Datei / Codebereich:** `public/app.js` Z. 1020, `stockChartCache` Z. 72
- **Ursache:** `if(!stockChartCache.has(k)){ … }`. Die Map wird nie invalidiert und nie geleert. Sobald der Nutzer den Zeitraum einmal umstellt, zeigt der Chart bis zum Reload denselben Stand — auch nach mehreren Stunden. Der Default „120" nutzt `top.intraday` und ist nicht betroffen, was den Defekt schwer sichtbar macht.
- **Minimal-invasive Lösung:** Eintrag als `{ts, rows}` speichern und bei `Date.now()-ts > 120_000` neu laden.

---

### F-12 · P1 · Ohne D1-Binding dauerhaft leerer Aktienradar im Tiingo-Primary-Modus

- **Datei / Codebereich:** `src/worker.js` Z. 1768 (`serverLearningCycle`), Z. 909 (`persistStockScan`), Z. 934 (`readLatestPersistedStockScan`), Z. 1977 (`readPersistedIexRadar`), Z. 2121 · `wrangler.jsonc`
- **Ursache:** `serverLearningCycle()` beginnt mit `if(!env.DB) return;`. Sämtliche Persistenzfunktionen steigen ohne `env.DB` sofort aus. Da der Client-Pfad in `tiingoStockSnapshot()` **niemals selbst scannt** (Z. 2121: `if(execution!=='server'&&!force)`), verbleibt ohne D1 ausschließlich der `state:'stale'`-Zweig mit leerem `stockMemo` → dauerhaft leerer Aktienradar. `wrangler.jsonc` setzt `TIINGO_STOCKS_MODE: "primary"` als Default.
- **Reproduktion:** Deploy ohne D1-Binding.
- **Minimal-invasive Lösung:** In dieser Konstellation einen einmaligen clientseitigen Scan zulassen **oder** in `/api/health` bei `d1:false && tiingoMode:'primary'` einen expliziten Fehlerzustand erzeugen, den die UI sichtbar meldet.

---

### F-13 · P1 · Cache-Treffer wird als frischer Scan etikettiert

- **Datei / Codebereich:** `public/app.js` Z. 1158 · `src/worker.js` Z. 2210
- **Ursache:** `stockMeta = { …stockMeta, …data, refreshedSymbols:[data.row?.symbol].filter(Boolean), ts: Date.now() }`
  `data` kann aus `stockLookupMemo` stammen (TTL **5 Minuten**, Flag `cached:true`). Das Frontend setzt dennoch `ts = Date.now()` und trägt das Symbol in `refreshedSymbols` ein → `stockFreshness()` liefert `key:'live'`, Label **„AKTUELLER SCAN"** für einen bis zu fünf Minuten alten Wert. Zugleich wird `stockMeta.ts` für **alle** Zeilen überschrieben, sodass `stockUpdateLabel()` durchgängig „Abfrage \<jetzt\>" ausweist.
- **Minimal-invasive Lösung:** `ts` nur bei `data.cached !== true` setzen; `refreshedSymbols` bei Cache-Treffer leer lassen.

---

### F-14 · P1 · Alpaca-Snapshot: stiller Fallback auf den Tages-Bar

- **Datei / Codebereich:** `src/worker.js` → `momentumFromAlpaca()` Z. 1356, Z. 1379
- **Ursache:** `const latest = Number(snap.minuteBar?.c || snap.latestTrade?.p || snap.dailyBar?.c || 0);`
  Fehlen `minuteBar` und `latestTrade` — im IEX-Free-Feed außerhalb ca. 08:00–17:00 ET der Regelfall — wird `dailyBar.c` verwendet. `updated` bleibt dabei `null`; es existiert kein Flag, welche Ebene gegriffen hat. Die Extended-Hours- und Opening-Karten zeigen daraus `gapPct`, `Mom` und `Struktur`, ohne dass die Herkunft erkennbar ist.
- **Einstufung:** P1 statt P0, da es sich um die Discovery-Ebene mit dokumentierten 0 % BUY-Gewicht handelt. Der Widerspruch zu „Kein veralteter Premarket-Wert darf als aktueller Kurs ausgegeben werden" bleibt bestehen.
- **Minimal-invasive Lösung:** `priceSource: 'minute'|'trade'|'daily'` mitliefern; bei `'daily'` in den Karten ein `⚠` setzen.

---

### F-15 · P1 · Radar-Quotes werden altersgeprüft, aber nicht altersgefiltert

- **Datei / Codebereich:** `src/worker.js` → `iexRadarQuote()` Z. 1971; Konsumenten `tiingoIexMarketRadar()`, `filterRadarToCommonStocks()`, `openingGainers()`
- **Ursache:** `ageMin` wird berechnet und im Rückgabeobjekt geführt — **aber nirgends ausgewertet**. Am Wochenende und an Feiertagen liefert der `/iex`-Bulk den letzten Sessionstand; die Market-Gainer-Karten zeigen „+x % Tag" ohne Alterskennzeichnung.
  **Positiv:** Das Spread-Gate (Z. 1958) und der Score-Malus für fehlende Quotes (Z. 1966) sind korrekt fail-closed. Ausschließlich die Zeitachse fehlt.
- **Minimal-invasive Lösung:** `if (ageMin != null && ageMin > 30) return null;` in `iexRadarQuote()`.

---

### F-16 · P1 · Erste Session lädt sich selbst neu

- **Datei / Codebereich:** `public/sw.js` Z. 20 (`skipWaiting`), Z. 28 (`clients.claim`) · `public/app.js` Z. 1838–1840
- **Ursache:** Beim allerersten Besuch ist `navigator.serviceWorker.controller === null`. `clients.claim()` löst dann `controllerchange` aus → `location.reload()` beim ersten Aufruf.
- **Minimal-invasive Lösung:** `if (!navigator.serviceWorker.controller) return;` vor dem Reload. Standard-Guard; das Update-Verhalten bei echten Deploys bleibt unverändert.

---

### F-17 bis F-21 · P2

| ID | Feststellung | Ort | Lösung |
|---|---|---|---|
| F-17 | `#stockFocus` besitzt **kein** `scroll-margin-top`; `header` ist `sticky;top:0` (Z. 29), `.viewbar` zusätzlich `sticky;top:58px` (Z. 544). Alle sechs `scrollIntoView({block:'start'})`-Aufrufe (Z. 754, 972, 985, 994, 1030, 1814) setzen die Oberkante auf Viewport-0 → Ticker und Firmenname liegen unter der Kopfleiste | `style.css` | `.stockfocus{scroll-margin-top:110px}` |
| F-18 | `: last.c >= vwap ? 'Über VWAP, aber ohne Trend'` (Z. 1110). Bei `volumeKnown===false` ist `vwap === null`, `last.c >= null` wird zu `preis >= 0` → **immer wahr**. Score und Ampel sind korrekt gedeckelt (Z. 1105/1107), nur der Text ist unzutreffend | `worker.js` | Bedingung auf `volumeKnown && last.c >= vwap` erweitern |
| F-19 | `registerSignal()` (Z. 277) setzt je Signal ein `setTimeout(…, 5 min)`, das ein vollständiges `renderStocks()`/`render()` auslöst. Kein Leak, aber vermeidbare Re-Renders | `app.js` | Sammel-Timer statt Einzel-Timer |
| F-20 | `UI_NON_COMMON_EQUITY_RE` (`app.js` Z. 44) und `NON_COMMON_EQUITY_RE` (`worker.js` Z. 1990) sind **nicht identisch**: der Server prüft zusätzlich `BEAR`, `BULL`, `FUND`, `MUTUAL FUND`, `CLOSED-END`, `DEPOSITARY SHARES`. Aktuell folgenlos, da der Client nur anzeigt, was der Server liefert — aber Wartungsfalle. Die Symbol-Deny-Sets sind identisch | `app.js` / `worker.js` | Einzige Quelle, vom Server durchgereicht |
| F-21 | `updatefound` zeigt das Update-Banner (Z. 1830), gleichzeitig lädt `controllerchange` die Seite selbsttätig neu. Das Banner ist nur Sekundenbruchteile sichtbar | `sw.js` / `app.js` | Auto-Reload nur bei explizit bestätigtem Update |

---

## 5. Konformitätsmatrix zu den Prüfvorgaben

| # | Prüfvorgabe | Status | Belegende Feststellungen |
|---|---|---|---|
| 1 | Aktienauswahl → Fokusfenster: exakt die geklickte Aktie | **NICHT ERFÜLLT** | F-01, F-02, F-03, F-04 |
| 1a | Kein Fallback auf ersten Listeneintrag / vorher selektierten Ticker | **NICHT ERFÜLLT** | F-01, F-04 |
| 1b | Race Conditions bei schnellem Wechsel | **NICHT ERFÜLLT** | F-02 |
| 1c | Verspätete API-Antworten setzen Fokus nicht zurück | **TEILWEISE** | Sequenz-Guards für Listen vorhanden (`stockReqSeq` u. a.), fehlen in `searchStockNow()` → F-02 |
| 1d | Ticker-Mismatch darf keinen falschen Titel zeigen | **NICHT ERFÜLLT** | F-03 |
| 2 | Fehlende/alte Daten dürfen kein Setup verbessern | **TEILWEISE** | Rechenschicht konform (s. Abschnitt 7); Präsentationsschicht → F-06, F-07, F-13 |
| 2a | Kurs / Timestamp / Freshness | **NICHT ERFÜLLT** | F-07, F-08, F-13, F-15 |
| 2b | Spread | ERFÜLLT | Gate `worker.js` Z. 1958, Malus Z. 1966 |
| 2c | RVOL | ERFÜLLT | `relVol = null` statt 0, Z. 1063 |
| 2d | ATR | ERFÜLLT | `stockATR()` Z. 1007, Division abgesichert |
| 2e | MTF / Komponentengewichtung | ERFÜLLT | `weighted()` renormiert nur aktive Komponenten |
| 2f | Crowd / Search | ERFÜLLT | Invalidierung vor Abfrage, keine erfundenen Werte |
| 2g | Crowd → Markt | ERFÜLLT | `crowdMarketConfirmation()` gewichtet nur finite Werte |
| 2h | CRV | ERFÜLLT | `stockSizing()` Z. 606–612, Kosten korrekt asymmetrisch |
| 2i | Kein Fallback darf live aussehen | **NICHT ERFÜLLT** | F-07, F-13 |
| 3 | Tiingo/IEX, Twelve-Data-Fallback, Alpaca, Priorisierung | **TEILWEISE** | Priorisierung korrekt; F-12, F-14 |
| 3a | Kein veralteter Premarket-Wert als aktueller Kurs | **NICHT ERFÜLLT** | F-14, F-15 |
| 3b | Timeouts, Retry, Fallback | **NICHT ERFÜLLT** | F-09 (kein Timeout, kein Retry) |
| 3c | Ausgefallener Provider blockiert nicht den Aktienbereich | **TEILWEISE** | Fehlerpfad liefert Cache-Rows; F-12 als Ausnahme |
| 4 | Krypto unabhängig, Fehler-/Timeout-Isolation | **ERFÜLLT**, mit Einschränkung | Architektur sauber (Abschnitt 7); Durchbruch nur über F-05 |
| 5 | Radar-Klick → richtiger Fokus | **NICHT ERFÜLLT** | F-01 |
| 5 | Momentum-Klick → richtiger Fokus | **NICHT ERFÜLLT** | F-02 |
| 5 | Extended-Hours-Klick → richtiger Fokus | **NICHT ERFÜLLT** | F-01 |
| 5 | Suche → richtiger Fokus | **NICHT ERFÜLLT** | F-03 |
| 5 | Favorit → richtiger Fokus | **TEILWEISE** | Depot-Handler leert das Suchfeld korrekt; Race F-02 bleibt |
| 5 | Google-Finance-Link | **NICHT PRÜFBAR** | Feature in v3.3.0 nicht implementiert (Abschnitt 0) |
| 5 | Aktienname nicht unter Sticky Header | **NICHT ERFÜLLT** | F-17 |
| 6 | BUY nur bei bestehenden Qualitätsbedingungen | **NICHT ERFÜLLT** | F-06 |
| 6a | Netto-CRV nicht durch fehlende Daten besser | **ERFÜLLT** | `stockSizing()` verifiziert |
| 6b | Keine Änderung bestehender Schwellenwerte | **ERFÜLLT** | Keine Abweichung festgestellt |
| 6c | Keine Lockerung der Sicherheitsregeln | **NICHT ERFÜLLT** | F-06 Ursache B: `marketOk` fail-open |
| 7 | JavaScript-Laufzeitfehler | **NICHT ERFÜLLT** | F-05 |
| 7 | Undefinierte Variablen | **NICHT ERFÜLLT** | F-05 |
| 7 | Event-Listener | ERFÜLLT | Delegation über `WeakSet` korrekt, keine Doppelbindung |
| 7 | Stale State | **NICHT ERFÜLLT** | F-04, F-11 |
| 7 | Race Conditions | **NICHT ERFÜLLT** | F-02 |
| 7 | AbortController / Timeouts | **NICHT ERFÜLLT** | F-09 |
| 7 | Promise-Fehlerbehandlung | **TEILWEISE** | Alle `async` mit `try/catch`; F-05 wird jedoch als Fremdfehler fehlinterpretiert |
| 7 | Cache-Probleme | **NICHT ERFÜLLT** | F-11, F-13 |
| 7 | Service Worker | **TEILWEISE** | Cache-Strategie korrekt; F-16, F-21 |
| 7 | API-Fehlerbehandlung | ERFÜLLT | `classifyError()`, HTTP-Codes korrekt gemappt |
| 7 | Endlosschleifen | ERFÜLLT | Keine gefunden (Abschnitt 7) |
| 7 | Unnötige API-Aufrufe | **NICHT ERFÜLLT** | F-10 |
| 7 | Versionskonsistenz | **ERFÜLLT für 3.3.0** | Abschnitt 0 |

---

## 6. Ausdrücklich als Vermutung gekennzeichnet — nicht als Fehler gewertet

Gemäß Auftrag werden folgende Punkte **nicht** als Feststellungen geführt, da sie ohne Laufzeitzugang zu den Providern nicht verifizierbar sind:

| Nr. | Vermutung | Grund der Nichtverifizierbarkeit |
|---|---|---|
| V-1 | Das 36-Stunden-Fenster in `tiingoIexSeries()` (Z. 2069) wird durch `.slice(0,10)` auf ein Datum reduziert. Ob Tiingo an Wochenenden und Feiertagen genügend Bars für die Schwelle `bars.length >= 24` liefert, ist offen. Greift die Schwelle nicht, liefert `analyseStock()` `return null` — das Verhalten wäre also **fail-closed**. | Kein Live-Token verfügbar |
| V-2 | `d1StoreRows()` / `d1BatchChunks()` verarbeiten 50er-Batches bei bis zu 100 Rows zzgl. Radar-Persistenz in derselben Cron-Minute. Ein Streifen des CPU-Budgets im Free-Plan ist denkbar. Der Code verteilt bereits bewusst auf gerade/ungerade Minuten (Z. 1804–1806). | Keine Laufzeitmessung durchgeführt |

---

## 7. Positivbefunde — geprüft und konform

Diese Bereiche wurden gezielt geprüft und **entsprechen** den Anforderungen. Sie werden protokolliert, damit sie bei der Nachbesserung nicht versehentlich angefasst werden.

| Bereich | Befund | Belegstelle |
|---|---|---|
| **Krypto-/Aktien-Isolation** | `/api/scan` und `/api/stocks` sind getrennte Routen mit getrennten Memos. `needsFusion` gilt nur für Krypto-Routen. Im Frontend sind `scan()`, `scanStocks()`, `scanOpeningMomentum()` unabhängige Fetches ohne geteilten Zustand. Der Cron gibt Krypto alle 5 Minuten exklusiv den Worker. **Einzige Durchbrechung: F-05.** | `worker.js` Z. 2266, Z. 1771–1785 |
| **Datenqualitäts-Gates in `analyseStock()`** | Korrekt fail-closed. `volumeKnown===false` deckelt den Score auf 6.4 und sperrt Grün. `relVol` bleibt `null` statt 0. `weighted()` renormiert abgeschaltete Komponenten, ohne fehlende zu belohnen. | `worker.js` Z. 1063, 1105, 1107 |
| **Netto-CRV-Berechnung** | Rechnet mit 3 Ausführungen im Zielpfad und 2 im Stop-Pfad, addiert Kosten auf den Verlust und subtrahiert sie vom Gewinn. Fehlende Daten machen den Netto-CRV **nicht** besser. | `app.js` Z. 606–612 |
| **Fehlender FX-Kurs** | `e()` gibt `null` zurück, `stockSizing()` bricht ab, die Preisleiter meldet „EUR/USD fehlt". Keine stille USD/EUR-Vermischung. | `app.js` Z. 589, 652 |
| **Sequenz-Guards** | `stockReqSeq`, `openingReqSeq`, `learningReqSeq`, `crowdReqSeq`, `scanReqSeq` vorhanden und korrekt implementiert; schützen die Datenlisten vor verspäteten Antworten. Lücke nur in `searchStockNow()` → F-02. | `app.js` |
| **Endlosschleifen** | Keine gefunden. `pool()` terminiert; die Kollisionsauflösung in `stockHeatmap` ist auf 15 Iterationen begrenzt; alle Poll-Timer werden vor Neuvergabe gelöscht. | `worker.js` Z. 68; `app.js` Z. 739 |
| **Service-Worker-Cache-Strategie** | `/api/` wird niemals gecacht, App-Shell network-first, alte Caches werden bei `activate` gelöscht. | `sw.js` Z. 41, Z. 25–26 |
| **Versions-Sync** | `scripts/sync-version.mjs` validiert das Versionsformat, bricht bei fehlendem Muster ab und beschreibt alle sechs Artefakte. Als `predev`/`predeploy` verdrahtet. | `scripts/sync-version.mjs`, `package.json` |
| **Discovery-Isolation** | Radar, Market Gainer, BOATS und Crowd tragen durchgängig `buyWeight:0` und fließen nicht in `analyseStock()` ein. Im Fehlerfall des BOATS-Security-Gates wird explizit `rows:[]` gesetzt (fail-closed). | `worker.js` Z. 2158–2161 |

---

## 8. Bewertung der bestehenden Testabdeckung

`tests/safety-regression.mjs` (108 Zeilen) läuft fehlerfrei durch und **hat keinen einzigen der acht P0-Befunde erkannt**. Ursachenanalyse:

| Testblock | Art | Aussagekraft |
|---|---|---|
| Block 1–2 (Z. 24–38) | Echte Funktionsaufrufe gegen Fixtures (`analyse`, `analyseStock`) | **Hoch.** Prüft die Rechenschicht substanziell |
| Block 3–5 (Z. 42–71) | `assert.match()` / `assert.doesNotMatch()` gegen den **Quelltext als Zeichenkette** | **Gering.** Prüft, ob bestimmte Zeichenfolgen im Code vorkommen — nicht, ob sie wirken |

**Beispiel:** Z. 42 verifiziert per Regex, dass `soundEligible` die Live-Freshness prüft. Der Test besteht. Er kann aber nicht erkennen, dass `fresh.key` im Produktivpfad nie `'live'` wird (F-08) — die Zeile ist vorhanden und wirkungslos.

**Empfehlung (kein Auftragsgegenstand, zur Kenntnis):** Die P0-Befunde F-01, F-04 und F-06 sind mit reinen Unit-Tests gegen die betroffenen Funktionen abdeckbar, ohne Browser und ohne Provider. Ein Test, der `renderStocks()`-Logik gegen ein `focusStock` außerhalb von `shown` stellt, hätte den gemeldeten Hauptfehler verhindert.

---

## 9. Prüfergebnis

> ## RELEASE STATUS: **NOT READY**

### 9.1 Zwingend vor Deploy zu beheben

| Rang | ID | Maßnahme | Aufwand |
|---|---|---|---|
| 1 | **F-05** | `regimeExplanation` definieren | 1 Zeile |
| 2 | **F-01** | `|| shown[0]` in `renderStocks()` Z. 1015 entfernen | 1 Zeile + Ladezustand |
| 3 | **F-02** | Suchfeld als Transportkanal aufgeben, Sequenz-Guard in `searchStockNow()` | klein |
| 4 | **F-03** | Ticker-Mismatch-Guard im Frontend | klein |
| 5 | **F-04** | `focusStock` in `mergeFavoriteRows()` schützen | 1 Zeile |
| 6 | **F-06** | `marketOk` fail-closed drehen; Freshness in `stockLevel()` aufnehmen | klein |
| 7 | **F-07** | Freshness-Label in das Fokus-Template übernehmen | klein |
| 8 | **F-08** | `refreshedSymbols` im Client-Pfad durchreichen | klein |

**Bestätigung zum Auftragsumfang:** Alle acht Maßnahmen sind lokale Eingriffe. **Keine** berührt eine Tradingregel, einen Schwellenwert, die Elliott-Logik, die CRV-Berechnung oder die Sizing-Formel. Es entsteht kein neues Feature.

### 9.2 Abhängigkeit zwischen den Maßnahmen

F-06 und F-08 sind **gemeinsam** zu beheben. F-08 allein behoben würde F-06 erstmals scharf schalten und könnte BUY-Badges auf Zeilen erzeugen, die zuvor stumm blieben. F-06 allein behoben bliebe wirkungslos, solange F-08 besteht.

F-01 ist Voraussetzung dafür, dass F-02, F-03 und F-04 überhaupt sichtbar korrigierbar sind — alle drei enden derzeit im selben Fallback.

### 9.3 Nachprüfung

Ein erneuter Audit ist erforderlich, sobald

1. die acht P0-Maßnahmen umgesetzt sind, **und**
2. der tatsächliche Stand **v3.3.9** vorliegt.

Die vorliegende Bewertung ist ausschließlich für v3.3.0 verbindlich.

---

## 10. Erklärung des Prüfers

Der Audit wurde ausschließlich statisch und read-only durchgeführt. Es wurden keine Dateien des Prüfgegenstands verändert. Alle Feststellungen sind mit Datei, Zeilennummer und Codezitat belegt. Feststellungen, die nicht mit Belegstelle nachweisbar waren, wurden in Abschnitt 6 als Vermutung ausgewiesen und **nicht** als Fehler gewertet — entsprechend der ausdrücklichen Auftragsvorgabe.

Nicht Gegenstand dieses Audits waren: Bewertung der Handelsstrategie, Angemessenheit der Schwellenwerte, Marktkorrektheit der Elliott-Heuristik, Wirtschaftlichkeit oder rechtliche Zulässigkeit des Systems.

| | |
|---|---|
| **Prüfer** | Claude Opus 5 (Anthropic) |
| **Datum** | 25.08.2026 |
| **Protokoll-Nr.** | FP-AUD-2026-08-25-01 |
| **Ergebnis** | **NOT READY** — 8 × P0, 8 × P1, 5 × P2 |

---

## Anhang A — Persönliche Einschätzung des Prüfers

*Nicht Teil der formalen Feststellungen. Ausdrücklich als Meinung gekennzeichnet.*

Die **Rechenschicht** ist ehrlich gebaut. Die `volumeKnown`-Deckelung, `relVol = null` statt 0, die Nicht-Renormierung in `weighted()`, die asymmetrische Kostenrechnung für Ziel- und Stop-Pfad — das ist diszipliniert. „Unbekannt bleibt unbekannt" konsequent durchzuhalten, statt es an einer Stelle stillschweigend zu 0 zu machen, sieht man selten.

Der Bruch liegt in der **Präsentationsschicht**. Dort existiert das Konzept „Freshness" (`stockFreshness`, `_staleLast`), ist aber an drei Stellen verdrahtet und an den zwei wichtigsten nicht: nicht am BUY-Badge, nicht im Fokusfenster. Und weil F-08 dafür sorgt, dass praktisch nie etwas `'live'` ist, sieht es beim Testen so aus, als greife das Gate überall. Es greift nur nirgends sichtbar. Zwei Fehler, die einander gegenseitig tarnen — das halte ich für den gefährlichsten Befund dieses Audits, gefährlicher als den Fokus-Bug, weil er niemandem auffällt.

Der `|| shown[0]`-Fallback ist ein klassisches Defensivmuster, das hier die Grundregel des Systems verletzt: **niemals stillschweigend etwas anderes zeigen, als angefordert wurde.** Ein leeres Fenster mit „wird geladen" ist immer richtiger als ein gefülltes mit dem falschen Titel. Diese Regel sollte im Projekt explizit festgeschrieben werden — sie hätte F-01, F-03 und F-04 gemeinsam verhindert.

Zur Architektur: Die Verlagerung des Deep Scans in den Cron (`execution !== 'server'`) ist richtig gedacht, macht D1 aber zur harten Abhängigkeit des gesamten Aktienbereichs, ohne dass das irgendwo sichtbar wird (F-12). Und `refreshedSymbols` ist bei diesem Umbau auf der Strecke geblieben — das riecht nach genau der Regression, die gesucht wurde.

Die Diskrepanz zwischen 3.3.0 und 3.3.9 sollte vor allem anderen geklärt werden. Der fehlende Google-Finance-Link legt nahe, dass zwischen diesem Archiv und dem Arbeitsstand mindestens neun Patch-Stände liegen. Mehrere der hier dokumentierten Befunde könnten dort bereits erledigt sein — andere könnten dort erst entstanden sein.
