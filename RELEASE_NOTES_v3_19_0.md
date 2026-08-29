# FusionPulse v3.19.0 — Renderbudget und Ladeweg

Additive Version. **Keine Änderung an Bewertung, Score, Freigabe, Sizing oder
Datenquellen.** Die vier SHA-verriegelten Claude-Modus-Blöcke sind unberührt.
Es geht ausschließlich darum, wie oft die App etwas tut und wie viel sie dafür
über das Netz zieht.

---

## Der Anlass

Der Nutzer sagte: „Bisher war die Effizienz der App nicht vorhanden." Ich habe
das nicht geglaubt oder bestritten, sondern gemessen — mit einer Wegwerf-Harness,
die `public/app.js` in einem echten DOM (jsdom) ausführt und mitzählt, was
tatsächlich passiert.

**Befund am 30-Sekunden-Takt** (`app.js`, Dateiende), mit realistischer Nutzlast
von 12 Radar-Kandidaten:

| gemessen je Takt | vorher | nachher |
|---|---|---|
| innerHTML-Ersetzungen | 5 | 0 |
| neu erzeugtes Markup | ~18 400 Zeichen | 0 |
| neu gebundene Klick-Handler | 19 | 0 |
| Zeit im Messaufbau (jsdom) | 19,7 ms | 7,0 ms |

Der Inhalt war dabei jedes Mal identisch. Gebaut wurde alles nur deshalb neu,
damit die Frischeplakette („AKTUALISIERT · 14:03 · vor 2 Min.") altern kann.

**Die Rechenzeit war dabei nicht einmal das Schlimmste.** Ein `innerHTML`-Neubau
zerstört die alten Knoten. Alle 30 Sekunden verlor die Kachel damit:
offene Tooltips, den Tastaturfokus und die Scrollposition. Das erzeugt genau die
Sorte Fehler, die sich wie ein Layoutproblem anfühlt und keines ist —
dieselbe Falle wie in Abschnitt 8l des Handovers.

**Befund am Ladeweg:** `app.js` (128 kB gzip), `style.css` (26 kB) und
`version.js` tragen seit v3.14.3 die Version im URL. Ein Eintrag unter dieser URL
kann per Konstruktion nicht veralten. Der Service Worker lieferte sie trotzdem
**network-first** aus — jeder App-Start zog rund 160 kB über das Netz, um am Ende
byteidentisch das zu bekommen, was schon im Cache lag.

---

## Was geändert wurde

### 1. Service Worker: cache-first für versionierte Assets (`public/sw.js`)

```js
if (url.searchParams.get('v') === APP_VERSION) { /* Cache zuerst */ }
```

Die Bindung an `APP_VERSION` **ist** der Sicherheitsbeweis, nicht bloß eine
Bequemlichkeit. Liegt eine neuere Shell auf dem Server, fordert deren
`index.html` `?v=3.20.0` an. Das trifft den Vergleich nicht mehr und fällt
automatisch auf Network-first zurück. Ein veralteter Treffer ist damit
**strukturell unmöglich** — dieselbe Logik wie in v3.14.3, nur endlich zu Ende
gedacht.

Unverändert network-first bleiben: `/`, `/index.html` und alles ohne
Versionsstempel. Unverändert **niemals** gecacht: alles unter `/api/`. Die
Reihenfolge im Code stellt sicher, dass die API-Sperre vor der Cache-Regel
greift; ein Test prüft genau diese Reihenfolge.

### 2. Zeichnen nur bei Bedarf (`public/app.js`)

Drei kleine Bausteine, kein Framework:

- **`categoryFreshness(ts)`** liefert die Plakette jetzt *ohne* Uhrzeit im
  Markup, nur mit `data-fresh-ts`. Damit hängt das Markup einer Kachel
  ausschließlich von den Daten ab, nicht mehr von der Uhr.
- **`ageFreshness()`** zieht alle Plaketten an Ort und Stelle nach — Klasse,
  Text, Titel. Kein `innerHTML`, keine zerstörten Knoten. Die Schwellen
  (grün <3, gelb 3–5, orange 5–10, rot ab 10 Min.) sind unverändert.
- **`paintPanel(el, html)`** schreibt nur, wenn sich das Markup wirklich
  geändert hat, und meldet per Rückgabewert, ob die Knoten neu sind.

Der letzte Punkt ist wichtiger, als er aussieht: die Kacheln binden ihre
Klick-Handler nach dem Schreiben. Würde man den Schreibvorgang überspringen und
die Handler trotzdem binden, hinge nach zehn Minuten der zwanzigste Handler am
selben Knopf und ein Klick löste zwanzigmal aus. Deshalb steht überall
`if (wrote) el.querySelectorAll(…)` — und ein Test besteht darauf.

Umgestellt sind die fünf Kacheln des Takts: Momentum-Mover, Nachbörse,
Premarket/Opening, Sektor-Nachzügler, Quartalszahlen.

### 3. Sekundenuhr (`app.js`)

Der Countdown zur 5-Minuten-Grenze lief bisher auch im Hintergrund-Tab weiter
und suchte sein Element bei jedem der 86 400 Ticks pro Tag neu. Beides ohne
Nutzen. Jetzt: Sichtbarkeitsprüfung und gemerkter Knoten.

---

## Wie das geprüft ist

Vier neue Regressionsprüfungen in `tests/safety-regression.mjs`
(**Suite 38**, `✓ FusionPulse v3.19.0 render-budget/sw-cache regressions`).

Weil dieser Strang laut Handover-Abschnitt 11 wiederholt Tests hatte, die
durchliefen ohne etwas auszusagen, habe ich **drei Negativkontrollen gefahren**:

1. `paintPanel` in `renderMarketGainers` auf `el.innerHTML=` zurückgedreht
   → Test fällt: *„darf nicht direkt el.innerHTML schreiben"* ✓
2. `Date.now()` zurück in `categoryFreshness`
   → Test fällt: *„darf nicht von der Uhr abhaengen"* ✓
3. Cache-first auf ein beliebiges `?v=` gelockert statt auf die eigene Version
   → Test fällt: *„muss versionierte Assets cache-first ausliefern"* ✓

Zusätzlich ein Verhaltenstest im echten DOM: Plakette grün bei 30 Sek., orange
bei 7 Min., rot bei 12 Min. — **am selben, nicht neu gebauten Knoten**. Bei
unveränderten Daten null Schreibvorgänge, bei neuen Daten genau einer, und der
neue Titel steht danach in der Kachel.

`npm run check` → 38 Suiten grün. `npm run audit:reach` → ohne Fund.

---

## Was ausdrücklich NICHT geändert wurde

- Keine Rechenlogik, keine Schwelle, kein Gate, keine Datenquelle.
- Kein Bündler, kein Framework, keine Abhängigkeit. `package.json` hat
  weiterhin genau eine devDependency.
- `/api/` bleibt vollständig ungecacht. Ein veralteter Kurs bleibt gefährlicher
  als ein Fehler.
- Die 364 kB `app.js` wurden nicht aufgeteilt. Das wäre der nächste große
  Schritt, aber es ist ein Umbau und keine Optimierung — siehe unten.

---

## Was jetzt funktioniert

- **Die App startet spürbar schneller.** Beim zweiten und jedem weiteren Start
  holt sie das Programm und das Aussehen aus dem eigenen Speicher statt aus dem
  Netz. Über das Netz geht nur noch die kleine Startseite (16 kB statt 175 kB).
  Am Handy im Zug ist das der Unterschied zwischen „ist sofort da" und
  „lädt kurz". Ein alter Stand kann dabei nicht hängenbleiben: eine neue
  Version hat eine neue Adresse und wird immer frisch geholt.
- **Die Kacheln flackern nicht mehr.** Bisher wurden alle 30 Sekunden fünf
  Kacheln komplett neu aufgebaut, auch wenn sich nichts geändert hatte. Wer
  gerade mit dem Finger in einer Kachel scrollte oder einen Hinweistext offen
  hatte, verlor das jedes Mal. Jetzt wird nur noch die kleine
  Aktualitäts-Plakette weitergezählt; der Rest bleibt stehen, bis wirklich neue
  Daten kommen.
- **Weniger Akkuverbrauch.** Der Sekunden-Countdown und die Kachel-Aktualisierung
  ruhen jetzt, solange der Tab im Hintergrund liegt.
- **Alles Fachliche ist unverändert.** Score, Ampel, Positionsgröße, Freigabe,
  Elliott, Sektorlogik — kein einziger Wert wird anders berechnet als in
  v3.18.0.

## Was noch offen ist

- **Die Programmdatei ist mit 364 kB weiterhin sehr groß** und wird beim
  allerersten Besuch komplett geladen. Sie in Teile zu zerlegen, die erst bei
  Bedarf nachgeladen werden (Musterlabor, Einstellungen, Lernmodul), würde den
  Erststart deutlich verkürzen. Das ist aber ein Umbau der Dateistruktur und
  kein kleiner Eingriff — bewusst nicht in dieser Version gemacht.
- **Die Kacheln bauen ihren Text intern noch immer bei jedem Takt zusammen**,
  auch wenn er dann verworfen wird. Gemessen sind das rund 7 ms im Messaufbau,
  im echten Browser deutlich weniger. Das ließe sich mit einem Zähler beheben,
  der bei jeder neuen Antwort hochgezählt wird. Ich habe darauf verzichtet:
  wird eine einzige Stelle vergessen, die Daten ändert, zeigt die Kachel
  stillschweigend Veraltetes an. In einer Trading-App ist das der falsche
  Tausch für ein paar Millisekunden.
- **Die Stildatei (`style.css`, 108 kB)** ist nie darauf geprüft worden, wie
  viel davon überhaupt benutzt wird. Das braucht einen echten Browser und ist
  von hier aus nicht messbar.
- **Alle offenen Punkte aus v3.18.0 bleiben offen** (P-A2 Kalibrierung, P-A3
  Livemarkt-Gegenprüfung, P-B Modus B, P-C Aktien-Sentiment). Diese Version
  hat daran nichts angefasst.
