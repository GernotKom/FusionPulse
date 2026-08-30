# FusionPulse · Release Notes

**Eine Datei für alle Versionen.** Bis v3.31.0 lag für jede Version eine eigene
Notes-Datei im Repository — über hundert Dateien, von denen niemand mehr eine
gelesen hat. Sie sind hier zusammengeführt: die beiden jüngsten Versionen im
Volltext, alles davor als Chronik.

Die *Begründungen* und die daraus gezogenen Lehren stehen nicht hier, sondern in
`HANDOVER.md`. Diese Datei sagt, **was** sich geändert hat; das Handover sagt,
**warum** und **was daraus für die nächste Änderung folgt**.

---

# v3.31.0 — Datenquelle und Marktbreite werden ehrlich

**Anlass:** Bandbreiten-Audit des ChatGPT-Strangs vom 30.08.2026.
**Umfang:** der Teil des Audits, der im Public-Bereich liegt — §28 (sichtbare
Quellenkennzeichnung), §29 (Provider-Ausfall darf nichts verbessern), die
Anzeigeseite von §10 D.
**Bewertungslogik:** nicht berührt. Kein Score, kein Gate, keine Ampel, keine
Freigabe. Die vier SHA-256-Blöcke unabhängig nachgerechnet und unverändert.
**`src/worker.js`:** nicht angefasst.

## Was NICHT umgesetzt wurde, und warum

Das Audit richtet sich an den Worker-Strang und sagt das selbst zweimal
(§1 und Kurzfassung Punkt 9: *„Nur `src/worker.js` ändern, solange der
Parallelstrang an den Public-Dateien arbeitet"*). Beim Worker liegen deshalb:

| Audit | Thema |
|---|---|
| §10 A, §14.2 | symbolbegrenzter `/iex`-Abruf statt Whole-Market-Bulk |
| §10 B, §15 | sessionabhängige Taktung der Discovery |
| §10 C, §17 | BOATS messen und takten |
| §10 D | Bandbreite **messen** (die Anzeige dafür ist hier gebaut) |
| §22–§34 | Provider-Failover Tiingo → Alpaca → Twelve Data |
| §11, R4 | Nachrichtenzeile, erst nach bestätigtem HTTP 200 |

## Der Befund

§28 war nicht nur offen — die App hat aktiv das Falsche behauptet:

```js
.includes('Tiingo') ? 'Tiingo IEX, US-Markt (Primary)'
                    : 'Twelve Data, US-Markt (Fallback)'
```

Eine binäre Behauptung über ein offenes Feld. Jede Nicht-Tiingo-Quelle wurde als
*Twelve Data* ausgewiesen — auch ein leeres Feld, auch ein unbekannter Wert, und
insbesondere **auch Alpaca**. Der geplante Failover hätte in der Kopfzeile den
falschen Anbieter genannt. Derselbe Fehler ein zweites Mal in `RESOURCE_LABEL`
(`stocks: 'Aktien (Twelve Data)'`, obwohl Tiingo primär liefert).

Zweiter Befund: Dass der IEX-Feed nur rund **2–3 % des US-Volumens** sieht,
stand seit v3.8.1 in den Notizen — es war der Grund, `MOM_MIN_DOLLARVOL` von
20 auf 2 Mio. $ zu korrigieren — und war nie sichtbar.

## Was gebaut wurde

- **`feedInfo(meta, opening)`** — eine Wahrheitsquelle für Anbieter, Rolle und
  Marktbreite. Kein `else`-Zweig, der einen Namen setzt: ein unbekanntes Feld
  bleibt unbekannt. Unbekannt wird nie `primary` und nie `full`; auch ein
  bekannter Anbieter mit unbekanntem Feed nicht. „nicht bestimmbar" ist
  sprachlich von „vollständig" getrennt.
- **`#stockFeed`** — sichtbares Badge im Aktienkopf statt einer Fußnote unter
  der Liste.
- **`bandwidthNote(meta)`** — fail-closed. Der Worker liefert diese Zahlen noch
  nicht; fehlt ein Feld, steht **„nicht gemessen"** samt dem Hinweis, dass daraus
  keine Reserve folgt. Nie eine 0. Sobald Zahlen kommen, rechnet die Anzeige
  ohne weitere Änderung; 40 von 40 GB ist rot.
- **Rate-Limit-Text** nennt bei Aktien die Monatsbandbreite als mögliche
  Ursache — die geht durch Warten nicht weg.
- Kein Alpaca-Tarifname im Code (§33.8); ein Test verbietet `Algo Trader`,
  `Alpaca Plus`, `Alpaca Basic`.

## Suite 50 · `tests/provider-breadth.mjs` · Negativkontrollen

| # | Sabotage | Ergebnis |
|---|---|---|
| 1 | alte binäre Quellenzeile wiederhergestellt | fällt |
| 2 | unbekannte Quelle wird als Twelve Data geraten | fällt |
| 3 | unbekannte Marktbreite gilt als voll | **erst blind** |
| 4 | fehlende Bandbreite als 0 gemeldet | fällt |
| 5 | 40/40 GB nur noch als Warnung statt Fehler | fällt |
| 6 | Herkunftsanzeige hebt `r.score` um 0,1 | fällt |
| 7 | Feed-Badge aus dem Markup entfernt | fällt |

**NK3 lief zuerst durch.** Ich hatte nur „gar nichts bekannt" geprüft — das
trifft den Alpaca-Zweig nicht, also konnte eine Sabotage genau dort nicht
auffallen. Die Lücke beschreibt den Zustand *Anbieter bekannt, Feed noch nicht
geladen*, der bei jedem Start auftritt. Dritte Wiederholung der Lehre: ein Test
muss den Wert benutzen, der die Abwehr tatsächlich erreicht.

Nebenbefund: Die erste Negativprüfung schlug auf dem eigenen Erklärkommentar an,
der die alte Zeile zitiert — wörtlich der Fehler aus v3.12.0. Alle
Verbotsprüfungen laufen jetzt auf kommentarbereinigtem Quelltext.

## Bewusst nicht gemacht

- **Client-Poll-Takt nicht angefasst** (R10). `setStockPoll()` prüft den
  Anbieternamen und wird bei Alpaca-Fallback träge. Jede Beschleunigung erhöht
  Abrufe; ohne Bandbreitenzahlen wäre die Änderung geraten.
- **Keine Einsparungsprognose** — §19 des Audits verbietet sie zu Recht.
- **Kein Provider-Umschalter in der Oberfläche** (§26).

## Was jetzt funktioniert

Im Aktienkopf steht, **wer die Daten liefert und wie breit der Markt ist, den
dieser Anbieter sieht**. Und es steht zum ersten Mal sichtbar dabei, dass der
aktuelle Feed nur rund 2–3 % des US-Handelsvolumens sieht — das war immer so,
es stand nur nirgends. Wenn die App „Rate-Limit" meldet, steht dabei, dass das
bei Aktien auch die aufgebrauchte Monatsbandbreite sein kann.

## Was noch offen ist

- Das eigentliche Bandbreitenproblem liegt im Server-Teil. Diese Version macht
  den Zustand sichtbar, sie senkt den Verbrauch nicht.
- Die beiden neuen Prüfungen laufen noch nicht automatisch mit (R9).
- Der Aktualisierungstakt bremst sich aus, sobald nicht Tiingo liefert (R10).

---

# v3.30.0 — R1 · Das Skope-Fenster im Coins-Bereich

**Bewertungslogik:** nicht berührt. **`src/worker.js`:** nicht angefasst.

## Der Befund — warum R1 zwanzig Versionen offen war

R1 lautete: *„Das Fenster, in dem alles über einen Coin steht, steht zuletzt und
soll oben stehen — wie bei Aktien der Fokus."* Das wurde seit v3.9.1 als
Reihenfolge-Frage gelesen und war als solche längst erledigt: `.stage` ist seit
v3.9.1 das erste Element des Kryptobereichs. Zweimal als erledigt verbucht —
danach fünfmal erneut gemeldet.

**Die Meldung war richtig, geprüft wurde am falschen Ort.** Nicht die Position
war falsch, sondern der Inhalt. Das erste Fenster enthielt den *Plan* (Zone,
Kaufsumme, CRV, Kosten, TP1/TP2, Preisleiter). Die *Analyse* — Kursverlauf,
neun Faktoren, Mikrostruktur, Ziel-Herkunft — lag ausschließlich im Modal hinter
dem letzten Knopf der Karte. Im Aktienbereich steht genau das seit jeher im
Fokusfenster.

## Was gebaut wurde

- **`coinScopeBlocks(r)`** — eine Quelle, zwei Anzeigen. Fokusfenster (neu) und
  Detailfenster (unverändert erreichbar). Ein Test verbietet eine zweite Kopie
  der Faktorzeilen.
- **`.coinscope`** als drittes Kind der Fokuskarte mit `grid-column:1/-1`. Ohne
  die Spannung über beide Spalten zöge der lange Block die Preisleiter
  (`height:100%`, prozentuale Marken) unlesbar in die Länge.
- **Sechs fail-closed-Lücken** geschlossen, die im alten Modal seit v3.0 offen
  waren: `imbalance` ergab `NaN %`, `vwapDev`/`rsi`/`atrPct`/`costRatio`
  `null …`, `tp2Source` blieb leer. `null × 100 = 0` hätte eine nicht gemessene
  Orderbuch-Schieflage als ausgeglichenes Buch ausgewiesen.

## Suite 48 · `tests/coin-scope.mjs` · Negativkontrollen

| # | Sabotage | Ergebnis |
|---|---|---|
| 1 | `coinScopeBlocks(r)` aus `renderFocus` entfernt | fällt |
| 2 | `grid-column:1/-1` aus dem CSS entfernt | fällt |
| 3 | Faktorzeilen ein zweites Mal im Quelltext | fällt |
| 4 | Faktoren ganz aus `coinScopeBlocks` entfernt | fällt |
| 4b | Faktoren im Quelltext, Ausgabe abgeschaltet | fällt |
| 5 | Fokusfenster hinter die Top-Picks-Kachel verschoben | fällt |
| 6 | fehlenden RSI wieder ungeschützt eingesetzt | fällt |
| 7 | Skope-Block ohne ausgewählten Coin behauptet | fällt |

**4b ist die wichtigste:** Nach 4 fiel der Test an einer Quelltextprüfung. Ob
der *ausgeführte* Nachweis Zähne hat, war damit nicht gezeigt. 4b lässt den
Quelltext unverändert und schaltet nur die Ausgabe ab.

## Bewusst nicht gemacht

Modal und `Details`-Knopf bleiben. Kein Auf-/Zuklappen (ein `<details>` springt
bei jedem Scan in den Ausgangszustand zurück und verwirft den Klick). Die
Coin-Suchleiste wurde nicht verschoben (R8). Kein neuer Glossareintrag — es ist
kein neuer Fachbegriff hinzugekommen.

---

# Chronik v3.5.0 – v3.29.2

Die ausführlichen Begründungen stehen in `HANDOVER.md`, Abschnitte 8b–8ab.

| Version | Was |
|---|---|
| v3.29.2 | Vorabend-Liste auf Tiingo-Stundenlimit umgebaut: Balken je Titel 20 h gecacht, `FETCH_BUDGET: 6`, harter Abbruch bei 429. Aufbauphase ist kein Ausfall |
| v3.29.1 | Erster echter Abendlauf lieferte nichts: `columns=` ohne `date` → jeder Balken verworfen; Ausfall wurde als Normalfall gemeldet; `.eve-bar` auf 6 px gestutzt |
| v3.29.0 | Vorabend-Liste (`/api/evening`): Kandidaten für den nächsten Tag aus Tagesbalken, Trigger, struktureller Stop, Restweg. Drei blinde Tests gefunden |
| v3.28.0 | `rideNow()` — ein Name oder Schweigen, neun Hürden. `rideSize()`. Handelstagebuch (`trades`, `/api/journal`): misst erstmals den Händler statt nur den Markt |
| v3.27.0 | Situation-Score prüfbar: `SITU_W` an einer Stelle, `situParts` im Snapshot, `scoreAudit()` mit Mehrfachtestkorrektur |
| v3.26.0 | Bereichsordnung: Überschrift ins Element, das sie überschreibt; Auswertungen in eigenen Bereich `#labZone`; Positionskette als Test |
| v3.25.0 | Der Ausfall vom 29.08.: `respondWith` ohne `.catch()` legte die App still. `tests/sw-fault.mjs` führt den Service Worker unter Störung AUS |
| v3.24.0 | Boot-Wächter inline in `index.html`, Notausstieg `?fpreset=1`, `posNum()` — drei Parameterfehler derselben `Number(null)`-Ursache |
| v3.23.0 | Kryptoschiene für Top Picks: `PICK_COST.kind='fixed'` gegen `COIN_COST.kind='proportional'`. Fail-closed-Verstoß beim Spread gefunden |
| v3.22.0 | Ertrag je **Zeit** statt je Trade (`tempoOf`), Kostenlast-Tabelle, dritter Fehler in der Rastersuche |
| v3.21.0 | Ursachentrennung (`heatProfile`, `pickVerdict`), `mae_pre`, `optimizeGrid` mit vier realen Fallen |
| v3.20.0 | Top Picks nach Netto-Euro. Die Erfolgsschwelle war falsch: 5 % statt der wirtschaftlich nötigen 2,04 % |
| v3.19.0 | Renderbudget: Service Worker cache-first für versionierte Assets, `paintPanel`, ruhende Sekundenuhr |
| v3.18.0 | Freigabe-Trichter, Kalibrierung im Musterlabor, Sektor-Reserve zieht aus dem Katalog nach |
| v3.17.0 | Musterlabor (`/api/patterns`): Snapshot schrieb nur `setup` — Situationstyp, Lebenszyklus und Reife wurden nie mitgeschrieben |
| v3.16.0/.1 | **Modus A gibt keine Kauf-Freigabe mehr.** Das Gate hing an `netCRV`, einer Kennzahl des anderen Modells. Terminmaske nachgewiesen |
| v3.15.0 | Modellvergleich, Sektor-Priorisierung, Kachelfarben mit reservierten Ampelfarben |
| v3.14.x | Die teuerste Fehlersuche: `body{height:100%}` machte jede Fußleisten-Korrektur wirkungslos. Versionsstempel in allen Assets, Shell-Konsistenzprüfung, sichtbare Systemampel |
| v3.13.0 | Live-Quote im Deep-Scan als Stapelabruf: zwei API-Aufrufe statt vierzig |
| v3.12.0 | Kopfhöhe gemessen statt geraten, zweistufige Navigation, Heatmap-Spuren mit Richtung |
| v3.11.0 | Aufmerksamkeitsimpuls (nur der stärkste, nur der neue), Quartalszahlen-Tafel |
| v3.10.0 | `sectorLag` war auf dem primären Datenpfad nie berechnet. Sektor-Nachzügler-Kachel |
| v3.9.x | Fixbetrags-Sizing, Wächter-Schalter wieder erreichbar, Reiter Coins/Aktien/Lab, Heatmap-Spuren enden am Punkt |
| v3.8.x | **Der große Befund:** Das Universum war eine 48-Symbol-Mega-Cap-Liste; die App suchte per Konstruktion an dem vorbei, was gewollt war. Momentum-Gitter statt Namensliste, einstellbares Kostenmodell |
| v3.5.x–v3.7.0 | Claude-Modus (EV-basiert), Modul 0 Attribution, Aladdin, Modul 2 Portfolio-Risiko, zentrales Glossar, Krypto-Sentiment |
