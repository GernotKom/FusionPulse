# FusionPulse – Übergabe für neuen Chat · v3.11.0 (Claude/Opus-Strang)

> ZUERST vollständig lesen, DANN den Code auditieren, DANN erst bauen.
> Ersetzt alle früheren HANDOVER-Dateien. Die Abschnitte „Der große Befund" und
> „Was der Nutzer WIRKLICH will" sind die wichtigsten — ohne sie baut man an der
> Sache vorbei, so wie ich es zehn Versionen lang getan habe.

---

## 1. Arbeitsbasis

- Aktuelles Archiv: `FusionPulse_v3.11.0.zip`
- Version steht in `package.json` → `node scripts/sync-version.mjs` schreibt sie in
  `src/version.js`, `public/version.js`, `public/index.html`, `public/sw.js`, `wrangler.jsonc`
- Tests: `npm run check` bzw. `node tests/safety-regression.mjs` → **23 Suiten, alle grün**
- `tests/client-harness.mjs` führt `public/app.js` in einer VM mit gestubbten Browser-APIs
  WIRKLICH aus. Top-Level-`const`/`let` landen nicht auf dem Kontext, deshalb hängt ein
  Epilog die zu prüfenden Bindungen als Accessoren an `globalThis.__fp`.
- `npm run audit:reach` sucht Bedienelemente hinter unsichtbaren Scrollbereichen —
  das Muster, das den Modul-0-Schalter zehn Versionen lang verborgen hat.
- Tests bei Zeitthemen zusätzlich mit `TZ=Europe/Vienna` und `TZ=America/Chicago` fahren.
- Nach jedem Deploy: `Cmd+Shift+R` (Service Worker cacht aggressiv).

## 2. NICHT VERHANDELBAR — Sicherheits-Invarianten

1. **Fail-closed.** Fehlende/stale/schlechtere Daten dürfen Score, BUY oder positiven Signalton
   NIEMALS verbessern. Was nicht bewertbar ist, wird ausgewiesen und NICHT geschätzt.
2. **Claude-Modus methodisch unverändert.** Die vier SHA-256-Blöcke MÜSSEN identisch bleiben:
   - coin   : `1a6acdf20ff3de5eb6642c7d4a5e99c979deb3112570aa6918f642db92917bb5`
   - stock  : `52f69351e1ff3367ed8e14b5adabf6aeb106c6ac5826ab2ed7c615a863baca4c`
   - client : `de85b209bbed1636b683c509b3256fd701ce5c15261c507d5f4682622e579cb2`
   - overlay: `9e6b5efc81bd1c3237ed7ca5b9e5564ea49abb1441bacd37f3be7d7849c1e73e`
   (In v3.9.0 unabhängig nachgerechnet, alle vier identisch. Immer selbst nachrechnen,
   nicht dem Testlauf glauben.)
3. **Additive Schichten verändern KEINEN Score.** Aladdin (Modul 1), Attribution (Modul 0),
   Portfolio (Modul 2), Sentiment, Terminwarnung: Anzeige bzw. Freigabe, nie Bewertung.
   Tests durchsuchen die Bewertungsfunktionen und fallen, wenn dort eine dieser Quellen auftaucht.
4. **Technische Stops/Ziele niemals verschieben**, nur damit CRV/EV „passt".
5. **Ehrlichkeitsprinzip.** Dünne Datenbasis wird als solche gekennzeichnet, inkl. Konfidenz.
6. **Kein Feature still streichen.** Offene Punkte bleiben sichtbar bis erledigt oder verschoben.
7. **Kopfzeile und Kleingedrucktes dürfen einander nie widersprechen.** `stockHeadline()` bzw.
   `coinHeadline()` sind die EINZIGE Quelle der Kopf-Anzeige — nie `r.light`/`r.verdict` direkt.
8. **Jeder angezeigte Fachbegriff hat einen Eintrag in `GLOSS`** (`public/app.js`), an EINER
   Stelle. Regel: was ist es, wozu dient es, was bedeutet es ausdrücklich NICHT. Ein Tooltip,
   der den Fachbegriff nur wiederholt, ist keiner. Ein Test erzwingt, dass jeder Eintrag auch
   im sichtbaren Glossar (Einstellungen) auftaucht.
9. **Jede neue Sperre darf ausschließlich abwerten** und muss standardmäßig AUS sein, solange
   sie das Verhalten des ChatGPT-Strangs verändern könnte.

## 3. WER MACHT WAS

Zwei parallele Bewertungssysteme in derselben App:
- **Claude-Modus** (EV-basiert): dieser Opus-Strang. SHA-verriegelt.
- **FusionPulse Adaptiv** (ChatGPT-Strang): eigenständig, läuft wenn der Claude-Schalter aus ist.

Beide teilen Situation Engine, Sizing, Discovery. Der Nutzer arbeitet mit BEIDEN Chats.
Änderungen des einen dürfen den anderen nicht beschädigen.

---

## 4. DER GROSSE BEFUND (v3.8.0) — bitte vollständig lesen

Der Nutzer fragte nach vielen Versionen: „Auch heute war keine einzige Empfehlung dabei …
maximaler Gewinn pro 10.000 € Einsatz um die 80–100 €. Das geht am Sinn der App vorbei."

Er hatte recht. Ich hatte zehn Versionen lang die *Anzeige* von Widersprüchen repariert und
nie gefragt, **warum es überhaupt nie ein BUY gibt**. Die Rechnung:

**Nötig** (10.000 € Einsatz, 11,50 € je Order, 27,5 % KESt): **~2,9 % Zielweite** für 120 € netto.
**Geliefert:** VEEV 1,20 % → 29 € netto. SOFI 1,60 % → 59 €.

**Der Beweis, dass es kein Zufall war:** Im Worker steht `fTp2 = min(rawTarget, entry + 8×risk)`.
Bei VEEV lag der Stop 0,307 % entfernt, 8R sind also 2,46 %. Selbst am **absoluten Maximum**
des erlaubten Zielbereichs wären nur 106 € netto herausgekommen — unter der 120-€-Schwelle.
**VEEV konnte unter keinen Umständen eine Freigabe bekommen.** Das gilt für jeden Titel mit
engem Stop, also für die meisten.

**Ursache war NICHT der Zeitrahmen** (mein erster, falscher Verdacht), **sondern das Universum:**
```js
// inclusion-only gate: unknown/small/micro-cap symbols cannot enter Radar
const LARGE_CAP_RADAR_SYMBOLS = new Set([ 48 Symbole ]);
```
Aus ~12.000 von Tiingo gescannten Titeln kamen 48 durch, alle Mega-Caps. Eine Apple bewegt
sich an einem normalen Tag 0,8 %. Die 1,2 % bei VEEV waren kein Fehler — das ist einfach, was
eine Mega-Cap tut. Die App suchte per Konstruktion an dem vorbei, was der Nutzer wollte.

---

## 5. WAS DER NUTZER WIRKLICH WILL (entscheidend)

Wörtlich: *„Ich wollte starke Momentum-Mover des Tages wie zuletzt Moderna oder Firmen nach
Quartalszahlen erkennen und im Uptrend anhand von Elliott-Wellen den Trend beurteilen und
relativ zügig kaufen und verkaufen."*

Und: *„Ich suche ja **nur interessante Titel**, die ich dann auf flatex und Google Finance checke."*

Daraus folgt für jede Designentscheidung:
- Die App ist ein **Suchwerkzeug**, keine Signalmaschine. Eine fehlende BUY-Freigabe ist kein
  Versagen. Eine Kandidatenliste ohne interessante Titel schon.
- **Transparenz schlägt Gating.** Die Euro-Zahl je Kandidat ist wichtiger als eine grüne Ampel.
- Er prüft ohnehin manuell nach → Datenlatenz ist ein kleineres Problem als gedacht.

**Handelsprofil:** flatex, **US-Direkthandel**, rund **10 € + 1–2 € = 11–12 € je Order**.

**GEKLÄRT in v3.9.0 — die alte Nachfrage zu `maxTradeEur` ist erledigt.** Der Nutzer setzt
**fix 10.000 € je Trade** ein. Das Risikoprozent interessiert ihn ausdrücklich nicht; er will
einen Uptrend erkennen, 10.000 € einsetzen, den Stop definieren und ein paar Prozent später
verkaufen. Woher das Kapital kommt (Eigenmittel oder Wertpapierkredit), war ihm nicht bekannt
und ist für die Rechnung auch nicht nötig — die App weist stattdessen den Verlust am Stop aus.
Deshalb gibt es jetzt `sizeMode: 'fixed'`. **Nicht erneut nachfragen.**

Das Konto-Equity-Feld bleibt in der Maske, weil Modul 2 (Portfolio-Risikobudget) es als
Bezugsgröße braucht. Für die Positionsgröße ist es im Fixmodus wirkungslos, und der
Hinweistext sagt das auch.

**Wichtig zur Handelsplatzwahl** (in v3.8.0 gerechnet): Für Momentum-Mover ist Tradegate der
falsche Ort. Bei einem US-Nebenwert im Nachrichten-Move kostet dort der Spread leicht 1–1,5 %
(≈ 100–150 € auf 10.000 €), an der US-Heimatbörse 0,1–0,2 %. Die 2 € höhere Ordergebühr für
US-Direkthandel sind dagegen belanglos. Für Modus B (Mega-Caps) bleibt Tradegate richtig.

---

## 6. WAS DIESER STRANG GEBAUT HAT (chronologisch)

- **v3.5.0** Claude-Modus (EV-basiert), weil die Legacy-Gates mathematisch unerreichbar waren
- **v3.5.1** Deep-Scan-Regler + Tiingo-Kontingent in D1
- **v3.5.3** A/B-Fixes (ChatGPT umgesetzt, von uns auditiert)
- **v3.5.4** Modul 0 · Attribution & Overfitting-Guard (Wilson, OOS, Mehrfachtest, MIN_SAMPLE=20)
- **v3.5.5** Modul 1 · Aladdin Market Intelligence
- **v3.5.6** (ChatGPT) reale Position im FokusScope, Heatmap, Verkaufsalarm
- **v3.5.7** Paket A · Modul 0 wird scharf: Stummschalten + Rehabilitation mit Hysterese
- **v3.5.8** P0: `stockHeadline()` — Kopfzeile vs. Wirtschaftlichkeit (SOFI-Widerspruch) + P2 Schalter
- **v3.5.9** Modul 2 · Portfolio-Risiko & Klumpung; Nebenbefund Kostenaufschlag am Stop
- **v3.6.0** Zentrales `GLOSS`-Glossar, alle Tooltips laientauglich
- **v3.6.1** `coinHeadline()` (P2b), ehrliche Heatmap, Crowd-Diagnose, sichtbares Glossar
- **v3.6.2** Hotfix Heatmap-Beschriftung (3.6.1-Labels liefen ineinander)
- **v3.6.3** Kennzahlen im Fokusfenster erklärt (Reife, Score, alle 9 Situationstypen)
- **v3.6.4** `dataSession()` Datenstand vs. Abfragezeit, ET→Ortszeit, Aktien-Planknopf, Spurrichtung
- **v3.6.5** SerpAPI-Budgetwächter (kritisch, siehe unten)
- **v3.7.0** P3 Krypto-Sentiment (Fear & Greed, alternative.me)
- **v3.8.0** Kostenmodell einstellbar + Momentum-Kandidatengitter statt Namensliste
- **v3.8.1** Kalibrierungsfehler im Gitter korrigiert + Diagnosezähler
- **v3.8.2** P6 Teil 1: Terminwarnung Quartalszahlen
- **v3.9.0** Fixbetrags-Sizing (`sizeMode`) + Modus A fertiggestellt (P-A1 erledigt)
- **v3.9.1** Wächter-Schalter wieder erreichbar (sticky + Kartenumbruch), Fokus/Heatmap
  zuerst auf beiden Seiten, flatex-Handelbarkeit als reiner Hinweis. Keine Bewertungslogik berührt.
- **v3.9.2** UI-Paket: Reiter Coins/Coin-Liste, Discovery-Kacheln nach oben, Premarket
  vs. Momentum-Mover eindeutig benannt, flatex-Hinweis in Liste/Detail, Krypto-Mover-Kachel,
  Erreichbarkeits-Audit als Werkzeug. Keine Bewertungslogik berührt.
- **v3.9.3** Heatmap-Spuren: Spur endet jetzt an ihrem Punkt (Kollisionsversatz), nicht
  messbare Werte werden nicht mehr als 0 gespeichert, Kürzel an der Aufwärtsspur.
- **v3.10.0** `sectorLag` fehlte auf dem primären Tiingo-Pfad komplett; Sektor-Nachzügler-
  Kachel, Kontextzeile an Momentum-Kandidaten. Kein Score, keine BUY-Logik berührt.
- **v3.11.0** Aufmerksamkeitsimpuls (nur stärkster NEUER Nachzügler, einmalig) und
  Quartalszahlen-Tafel nach Sektor. Reine Anzeige.

---

## 7. STAND DER MODI

### Modus A · Momentum (das aktive Werkzeug) — HALB FERTIG
**Gebaut:** `momentumRadarAllowed(r)` mit messbaren Kriterien statt Namensliste:
Mindestkurs 5 $, Mindest-Dollarumsatz **2 Mio. $ (IEX-Anteil!)**, Spread ≤ 0,60 %, Bewegung ≥ 3 %.
Fail-closed: fehlender Wert = kein Einlass. `radarCandidateAllowed()` = Large-Cap-Liste ODER Gitter.
Diagnosezähler `radarGateStats` zeigt über dem Situation Radar, woran Kandidaten scheitern.

**KALIBRIERUNGSRISIKO, unbedingt beachten:** Der Tiingo-Feed liefert das Volumen der Börse
**IEX**, die nur 2–3 % des US-Volumens hat. Ein erster Entwurf mit 20 Mio. $ hätte praktisch
alles ausgesperrt. Der Wert von 2 Mio. $ ist eine **Schätzung** und nach dem ersten Live-Lauf
anhand der Zähler nachzujustieren — nicht weiter raten.

**In v3.9.0 FERTIGGESTELLT** (`momentum`-Block in `src/worker.js`, additiv neben `claude`
und `fusion`; ein Test fällt, sobald einer der beiden ihn liest):
- `overextended`-Malus entfällt — der Abstand zur EMA21 ist hier die Eintrittskarte.
- Elliott-Gewicht 0. **Die 12 Prozentpunkte sind NICHT umverteilt**, `weighted()` normiert über
  die gesetzten Gewichte. Ein Test prüft die Gewichtssumme (0,95–1,00) und fällt bei
  Umverteilung — eine Umverteilung hätte den Score ohne neue Information angehoben.
- Zielprofil: Stop unter dem Konsolidierungstief der letzten 6 Bars (mit 0,25-ATR-Puffer),
  Ziel = Konsolidierungshoch + 1,0 × Tagesspanne. **Kein R-Deckel** (der 8R-Deckel des
  fusion-Blocks war der VEEV-Killer).
- Live-Quote-Pflicht: `MOM_MAX_QUOTE_AGE_SEC = 600`. Fail-closed, unbekanntes Alter zählt wie
  zu alt. Die Prüfung steht **in** der `mGreen`-Bedingung, nicht nur in der Anzeige.
- Umschalter `S.tradeMode` (`'off'` | `'A'`), Default `'off'`. Client-Overlay
  `momentumOverlayRow()` ersetzt auch Entry/Stop/TP1, nicht nur TP2 wie der Claude-Overlay.

**WICHTIG für den nächsten Bearbeiter:** Der Modus-A-Overlay steht **hinter** `function buyReady`,
nicht neben `claudeOverlayRow()`. Der SHA-Anker für den Claude-Overlay reicht von
`/* ---- Claude-Modus-Overlay` bis `function buyReady`; Code dazwischen ändert die Prüfsumme,
auch wenn er Claude-Code nicht anfasst. Genau das ist mir beim Bau von 3.9.0 passiert.
Eine eigene Assertion hält es fest.

### Modus B · Large Cap / Position — KONZEPT, NICHT GEBAUT
Vom Nutzer gewünscht: Tagesbalken, **3–6 Monate** Sicht, bestehendes 21-Titel-Universum,
**Elliott höher gewichtet** (auf Tagesbalken hat die Methode überhaupt erst Struktur; auf
5-Minuten-Balken über 3 Stunden ist sie Rauschen). Keine BUY-Freigaben im Minutentakt, sondern
eine Beobachtungsliste mit Einstiegszonen. Kein Signalton. Tagesbalken sind zudem billig.

**Der Umschalter muss beide REGELWERKE steuern, nicht nur die Anzeige.**

---

## 8. OFFENE PUNKTE — VORRANG

### P-A1 — Modus A fertigstellen — **ERLEDIGT in v3.9.0**

### P-A2 — Kalibrierung nachziehen (JETZT DRAN, braucht den Nutzer)
Nach dem ersten Live-Lauf die Zeile „Einlassgitter: N geprüft → X Large Cap + Y Momentum"
auswerten. Steht dort während US-Handelszeit dauerhaft „Momentum 0" und scheitert fast alles
am Umsatz, ist `MOM_MIN_DOLLARVOL` zu hoch. **Mit echten Zahlen korrigieren, nicht schätzen.**

### P-A3 — Modus A am Livemarkt gegenprüfen
Der `momentum`-Block ist noch nie gegen echte Bars gelaufen. Zwei Zahlen sind Schätzungen und
gehören nach dem ersten Handelstag überprüft, nicht weiter geraten:
- **Konsolidierungserkennung**: `consRange <= impulseUp * 0.62` und `consLow >= impulseLow +
  impulseUp * 0.38`. Wenn in der Praxis fast alles an „keine Konsolidierung" scheitert, ist
  0,62 zu streng.
- **Zielweite** `1,0 × Tagesspanne`. Bei einem Titel, der schon 12 % gelaufen ist, ergibt das
  ein sehr weites Ziel — dann greift eher die 2x-Bedingung als Bindung, was in Ordnung ist.
  Prüfen, ob TP2 realistisch erreichbar bleibt.

### P-B — Modus B (3–6 Monate, Tagesbalken, Elliott stark)

### P6 Teil 1b — Eingabemaske für manuelle Termine
Route `POST /api/earnings` steht und funktioniert, die Oberfläche fehlt. Kleiner Aufwand,
großer Nutzen: der Nutzer schaut ohnehin bei Google Finance nach.

### P6 Teil 2 — Ereignistage im Modul-0-Learning markieren
Ein Scheitern im Ausnahmezustand darf nicht in dieselbe Statistik fallen wie eines im ruhigen Markt.

### P-C — Aktien-Sentiment
Bewusst NICHT gebaut. Es gibt keine vergleichbare freie, seriöse Einzelquelle (CNN F&G ohne
offene API; Put/Call, VIX-Struktur, AAII entweder kostenpflichtig, wochentaktig oder schwer
sauber zu interpretieren). Lieber keine Kennzahl als eine zusammengeschusterte.

### P-D — Restliche Konsistenz-Baustellen
- Krypto-Fokuskarte (`el.className = 'focus '+r.light`) und Signalton-Stufen sind noch nicht
  auf `coinHeadline` umgestellt.
- Glossar ist auf der Krypto-Seite und in der Aladdin-Kachel noch nicht verdrahtet.
- Crowd: `accel` kommt jetzt vom Server; die clientseitige Notlösung aus 3.6.1 bleibt als Rückfall.

---

## 8b. POSITIONSGRÖSSE (neu in v3.9.0) — vor jeder Änderung lesen

Zwei Modelle, `S.sizeMode`:
- `'risk'` (Default, unverändertes Altverhalten): Risiko ist die Eingabe, Kaufsumme das
  Ergebnis, `maxTradeEur` deckelt.
- `'fixed'`: `S.fixedTradeEur` ist die Eingabe, das Risiko ist das Ergebnis. `maxTradeEur`
  ist dort wirkungslos (ein Test weist das nach).

**In beiden Modellen greift der Liquiditätsdeckel** (`r.buyCapacityEur ?? r.buyCapacity`).
Das war vorher nur im Krypto-Zweig sauber. Bei 10.000 € fixem Einsatz in einen Nebenwert ist
es der wichtigste Schutz überhaupt — fail-closed.

**Das Gate ist im Fixmodus ein anderes.** `minNetProfitStock` (Euro) wird ersetzt durch
`MIN_REWARD_RISK_FIXED = 2.0` (Ziel : Stop in Kursweite). Begründung steht als Kommentar an
der Konstante; kurz: Gewinne werden mit KESt besteuert, Verluste tragen die vollen Gebühren,
deshalb braucht 1,0x über 60 % Trefferquote und 2,0x rund 40 %. Zusätzlich optional
`S.maxLossEur`. **Beide können ausschließlich abwerten**, beide sind so getestet.

**Nicht rückgängig machen, ohne den Nutzer zu fragen:** dass der Mindest-Eurogewinn im
Fixmodus wegfällt, ist Absicht und kein vergessener Zweig. Bei fester Kaufsumme misst er nur
noch die Zielweite ein zweites Mal.

## 8c. WAS v3.9.1 GEÄNDERT HAT — und was ausdrücklich NICHT

Reine Bedien-/Anzeigeversion. Drei Punkte, alle aus dem Nutzergespräch:

1. **Aktions-Spalte in Modul 0 war unerreichbar.** `overflow-x:auto` plus die macOS-Overlay-
   Scrollbalken — der Scrollbereich existierte, war aber unsichtbar. Jetzt `position:sticky`
   auf der Spalte, erzwungener Scrollbalken, unter 900 px Kartenumbruch mit `data-lbl`.
   **Lehre:** Ein Test, der prüft, ob ein Bedienelement *existiert*, prüft die falsche Frage.
   Die Funktion war vollständig gebaut, getestet und unbedienbar.
2. **Reihenfolge.** `.stockstage` (Fokus + Heatmap) steht jetzt vor Depot/Crowd/Portfolio/
   Learning/Aladdin; auf der Krypto-Seite steht `#sentimentCard` hinter `.stage`.
   Der Test misst die tatsächliche Position im Markup, nicht einen Kommentar.
3. **`flatexTradability(row)`** in `public/app.js`, direkt vor `googleFinanceUrl`.
   Leitet aus dem Primärlisting (`row.exchange`, Tiingo `exchangeCode`) ab, ob der Titel
   bei flatex wahrscheinlich handelbar ist. **Reine Anzeige, fail-closed:** leerer oder
   unbekannter Handelsplatz ergibt NIE `tone:'ok'`. Tests verbieten das Vorkommen im
   Worker und im Umfeld von `buyReady`. GLOSS-Eintrag `brokerAvail`.

**NICHT angefasst — bewusst:** `MOM_MIN_DOLLARVOL`, `MOM_MIN_MOVE_PCT`, die
Konsolidierungsschwellen und jede andere Zahl aus P-A2/P-A3. Diese Werte sind Schätzungen
und brauchen echte Live-Zähler. Zweimal steht in Abschnitt 11 schon der Fehler
„Schwelle geraten statt gemessen" — er wird hier nicht zum dritten Mal gemacht.

### Korrekturen an mündlichen Aussagen aus dem Gespräch vor v3.9.1
Beide von mir, beide falsch, beide am Code widerlegt — nicht wieder einbauen:
- **„20 gescannt / 5 angezeigt von 218 heißt, der Aktienscanner sieht nur 20 Titel."**
  FALSCH. Diese Zeile (`public/app.js:1199`) gehört zur **Krypto**-Seite; 218 sind
  Bitpanda-EUR-Paare. Der Aktienradar läuft gegen `12.000+ Tiingo/IEX`.
- **„Der Large-Cap-Filter blockiert vermutlich noch."** FALSCH, seit v3.8.0 erledigt.
  `radarCandidateAllowed` ist ein ODER aus Namensliste und Momentum-Gitter.
  `OPENING_UNIVERSE` wird in `src/worker.js:1987` mit Radar und Favoriten vereinigt und
  schließt nichts aus.

## 8d. WAS v3.9.2 GEÄNDERT HAT

Reines UI-Paket, sechs Punkte, alle aus dem Nutzergespräch. Keine Bewertungslogik.

1. **Reiter.** „Radar" sprang auf das Krypto-Fokusfenster — nicht erratbar. Jetzt
   Coins / Coin-Liste / Aktien / Lab. Ein Test prüft, dass jedes `data-jump`-Ziel im
   Markup wirklich existiert (ein toter Reiter fiel vorher niemandem auf).
2. **Discovery-Kacheln nach oben**, direkt hinter Fokus/Heatmap und vor Depot,
   Portfolio und Learning. Reihenfolge folgt der Arbeitsweise: erst welche Titel sind
   auffällig, dann der eigene Bestand, dann der Rückblick.
3. **Trennschärfe der drei Kacheln.** Der Nutzer fragte, ob die Momentum-Kacheln die
   Premarket-Kachel seien. Sie hießen tatsächlich fast gleich. Jetzt:
   `🚀 Premarket / Opening` (Alpaca, Gaps VOR der Eröffnung),
   `📡 Momentum-Mover · Situation Radar` (Tiingo, laufender Handel),
   `🌙 Nachbörse / Extended Hours`. Tests verbieten die Rückkehr der alten Titel.
4. **flatex-Hinweis in Trefferliste und Detailfenster.** In der Zeile als ein Zeichen
   (🏦/⛔/❓) mit Tooltip, im Detailfenster als voller Hinweis. Weiterhin reine Anzeige.
5. **`renderCryptoMovers()`** — Gegenstück zur Aktien-Discovery. **WICHTIG für den
   nächsten Bearbeiter:** Die Kachel verwendet `ret60`/`ret15`/`relVol`, weil der
   Coin-Datensatz KEINE 24-Stunden-Veränderung enthält (siehe Feldliste von `analyse`).
   Ein Test verbietet `change24`/`chg24`/`pct24` in dieser Funktion ausdrücklich —
   die naheliegende „Verbesserung" wäre hier eine erfundene Zahl gewesen.
   Und es gibt bei Krypto kein Premarket: der Markt läuft durchgehend. Die Kachel
   sagt das im Untertitel, statt ein Aktien-Konzept nachzuahmen.
6. **`tests/reachability-audit.mjs`** (`npm run audit:reach`). Sucht das Muster, das
   den Modul-0-Schalter verborgen hat: horizontaler Scrollbereich + Bedienelemente +
   keine sticky-Spalte + kein Umbruch + unsichtbarer Scrollbalken. Fand beim ersten
   Lauf zwei weitere Fälle (`.signal-banner`, `.signal-content` — die Signalleiste
   unten enthält anklickbare Chips). Beide behoben. Das Audit **urteilt nicht**, es
   listet auf; `--strict` beendet mit Code 1 für die CI.

## 8e. WAS v3.9.3 GEÄNDERT HAT — Heatmap-Spuren

Meldung: *„Der grüne Strich zeigt mir nicht die Aktie, die nach oben gezogen ist."*
Berechtigt, und sie hat zwei unabhängige Fehler aufgedeckt.

1. **Spur ≠ Punkt.** Die Punkte laufen durch 15 Runden Kollisionsauflösung und werden
   auf 10..190 begrenzt; die Spuren wurden danach aus ROHKOORDINATEN neu gezeichnet.
   Spurende und Punkt lagen systematisch auseinander, umso weiter je dichter das Feld.
   Behoben in **beiden** Heatmaps: die Spur wird um den Vektor `Punkt − Rohkoordinate`
   verschoben. **Wer hier etwas ändert:** dieser Versatz MUSS erhalten bleiben, sonst
   ist der Fehler sofort zurück.
2. **Phantomspur aus der linken unteren Ecke.** `executability: … : 0` speicherte eine
   nicht messbare Ausführbarkeit als gemessene Null → linke untere Ecke → beim nächsten
   Scan eine Spur quer durchs Feld, die wie eine riesige Aufwärtsbewegung aussah.
   Verstoß gegen Invariante 1. Jetzt `null`, und beide Spur-Funktionen überspringen
   nicht messbare Punkte. Gleiches im Krypto-Zweig (`Number(r.quality || 0)`).
3. **Kürzel an der Aufwärtsspur** (`.trailtag`), am Spuranfang. Ein Tooltip allein ist
   in einem dichten Punktfeld nicht treffbar.

### Fehler in meinem eigenen Test (Abschnitt 11, dritter Fall dieser Art)
Ich hatte auf `/const ox=/` geprüft — das besteht auch `const ox=0`. Dazu eine
Geometrie-Rechnung, die aber nur in der Testdatei lief und den Produktivcode nie
berührte. Die Negativkontrolle fiel deshalb NICHT, obwohl der Fix zurückgedreht war.
Jetzt wird der Ausdruck aus dem Quelltext herausgelöst und mit bekannten Werten
AUSGEFÜHRT (`new Function('x','y','last', …)`).
→ **Regel:** Ein Test auf „Zeichenkette kommt vor" ist bei einer Rechnung nie
ausreichend. Extrahieren und ausführen, oder es ist kein Funktionsnachweis.

## 8f. WAS v3.10.0 GEÄNDERT HAT — und der Anlass dazu

**Der Anlass ist wichtiger als der Code.** Der Nutzer hat CRWD in der Momentum-Liste
GESEHEN — vorher nicht auf dem Schirm — und nach starken NVDA-Zahlen früh gekauft.
Zusammen mit VEEV über 1.600 € an einem Tag. Ohne BUY-Signal der App.

Das dreht die Diagnose um: **Die Discovery funktioniert.** Was fehlte, war der Hinweis
daneben, der den Zusammenhang „NVDA läuft, CRWD hinkt" sichtbar macht.

1. **`sectorLag` war auf dem primären Pfad NIE berechnet.** Die Kennzahl existierte,
   die UI wertete sie an drei Stellen aus — berechnet wurde sie aber nur im
   Twelve-Data-Zweig. `tiingoAnalyseOne` setzte sie auf `null`, der Tiingo-Deep-Scan
   hat sie nie nachgerechnet. Bei `TIINGO_STOCKS_MODE=primary` also **dauerhaft leer**.
   Jetzt gemeinsame Funktion `applySectorLag(rows)` auf BEIDEN Pfaden.
   → **Wer hier etwas ändert:** beide Aufrufe müssen bleiben. Ein Test zählt sie.
2. **Fail-closed mit Lehrgeld.** `Number(null)` ist 0 und endlich — ein reiner
   `isFinite`-Test hätte fehlende Werte als gemessene Null durchgelassen, exakt der
   v3.9.3-Fehler. Jetzt explizite null/undefined/''-Prüfung. Unter drei Vergleichs-
   titeln entsteht kein Sektorurteil.
3. **`renderSectorLaggards()`** — neue Kachel. Zwei Bedingungen: Sektor läuft
   (`SECTOR_RUN_MIN` 0,8 %) UND Titel hinkt (`SECTOR_LAG_MIN` 0,6 Pkt). Bedingung 1
   ist entscheidend: Rückstand in einem stehenden Sektor ist bedeutungslos.
4. **`momentumContext(symbol)`** — hängt Sektor-Hinweis, `whyNow` und Handelbarkeit an
   jede Momentum-Karte. `whyNow` wurde längst befüllt, stand aber nur tief im
   Fokusfenster. Tooltip stellt klar: gemessene Kursereignisse, KEINE Nachrichten.
5. **Selbsteinordnung der Momentum-Liste.** Statt „Discovery · 0 % BUY-Gewicht" als
   Untertitel jetzt: *Kandidatenliste, keine Kaufempfehlung — die Einordnung der
   Nachrichtenlage bleibt bei dir.*

### Strategische Einordnung für den nächsten Bearbeiter
Nach zwei profitablen Handelstagen des Nutzers ohne App-Signal ist die realistische
Zielsetzung **Aufmerksamkeitsfilter, nicht Signalgeber**. Die App kann den
Nachrichtenkontext nicht liefern, der die Entscheidungen des Nutzers trägt
(Melanomdaten bei MRNA, NVDA-Durchgriff auf Security). Sie kann ihn zwei Minuten
früher zum richtigen Titel bringen. Weiteres Schrauben an BUY-Schwellen adressiert
das falsche Problem.

## 8g. WAS v3.11.0 GEÄNDERT HAT

1. **`markAttention(sym)` + `.pulse-new`** — Aufmerksamkeitsimpuls auf der Nachzügler-
   Kachel. **Die Sparsamkeit ist die Funktion, nicht eine Einschränkung davon:** nur der
   STÄRKSTE (`ix===0`) und nur der NEUE (`pulsedLaggards`-Set pro Sitzung), einmalig für
   24 s. Wer das lockert, macht das Feature wertlos — pulsiert alles, fällt nichts auf.
   `prefers-reduced-motion` schaltet die Animation ab (Systemeinstellung, nicht
   verhandelbar). Schalter `#sPulse` / `S.attentionPulse`, Default an.
2. **`renderEarningsBoard()`** — Quartalszahlen nach Sektor, 14 Tage.
   **Bewusst auf `stockRows` begrenzt:** nur analysierte Titel haben einen verifizierten
   Sektor. Nutzt `earningsFor()` statt einer zweiten Terminlogik. Manuelle Termine
   schlagen automatische. Alle vier Ausfallzustände (`nokey`, `empty`, `stale`,
   `unavailable`) haben einen eigenen Erklärtext — Tests prüfen, dass keiner verschwindet.
   **Erwartung:** `earnings_calendar` ist im Twelve-Data-Basic-Tarif vermutlich nicht
   enthalten. Dann bleibt die Tafel bis **P6 Teil 1b** (Eingabemaske, Route existiert
   bereits) weitgehend leer — das ist kein Fehler, sondern der dokumentierte Zustand.

### Dritte Testschwäche in vier Versionen (Abschnitt 11)
Zwei Negativkontrollen blieben grün, weil mein Slice rückwärts lief (Terminliste wurde
VOR den Impuls-Block eingefügt) und deshalb leer war. → **Regel:** Bei jedem
`app.slice(indexOf(A), indexOf(B))` zusätzlich prüfen, dass das Ergebnis nicht leer ist.
Eine Zeile `assert.ok(block.length > 100)` hätte alle drei Fälle sofort gefangen.

## 9. TECHNISCHE FAKTEN

- **Cron** `* * * * *` in `wrangler.jsonc`, im Worker gedrosselt. Modul 0 SAMMELT permanent,
  BEWERTET nur beim Abruf (`/api/attribution`), ändert nie automatisch etwas.
- **D1-Binding** `env.DB`. `fp_meta` ist key/value (`stock_deep_limit`, `tiingo_quota`,
  `muted_setups`, `serpapi_quota`, `crypto_fng:last`, `earnings:last`, `earnings:manual`).
- **`APP_TOKEN`** schützt alle `/api/`-Routen, Client schickt `?t=<token>`.
- **Datenquellen:** Tiingo IEX (Radar ~12.000 Symbole, Quotes), Twelve Data (5min-Bars,
  `outputsize:40` = 3 h 20 min), SerpAPI (Crowd, optional), alternative.me (Krypto-Sentiment,
  kein Schlüssel).
- **SerpAPI-Budget:** Freitarif ~100 Suchen/**Monat**. Ohne den Wächter aus 3.6.5 hätte EIN
  Handelstag das Kontingent verbrannt. Drei Schichten: D1-Cache wird gelesen (6 h TTL),
  hartes Monatsbudget in `fp_meta` (Standard 90), max. 3 echte Abfragen je Aufruf.
  `force=1` umgeht das Budget NICHT. Über `SERPAPI_MONTHLY_BUDGET` anhebbar.
- **Sizing/Modus:** `S.sizeMode`, `S.fixedTradeEur`, `S.maxLossEur`, `S.tradeMode`. Ungültige
  gespeicherte Werte fallen per Whitelist auf den Default zurück (fail-closed auf
  „unverändertes Verhalten"), damit ein manipulierter localStorage keinen undefinierten
  Zustand erzeugt.
- **Kostenmodell:** `S.orderFeeEur` (Standard 11,50) und `S.venueFrictionPct` (Standard 0,15).
  Die alten Konstanten sind entfernt; ein Test verhindert ihre Rückkehr. Historische Fixtures
  in den Suiten 3.5.8/3.5.9 nageln 10,75/0,06 fest, weil sie echte Screenshots nachbilden.

---

## 10. KORREKTUREN AN MEINEN EIGENEN FRÜHEREN AUSSAGEN

Zwei Dinge habe ich falsch behauptet und später berichtigt. Bitte nicht wieder einbauen:

1. **„Cloudflare-Egress-Whitelist blockiert externe Domains."** FALSCH. Cloudflare Workers
   dürfen per `fetch()` jede Domain aufrufen. Ich hatte das mit der Beschränkung meiner eigenen
   Arbeitsumgebung verwechselt. P3 und P6 waren nie blockiert.
2. **„Die Kostenannahme 10,75 € ist zu hoch."** FALSCH für diesen Nutzer. Meine Recherche traf
   den Tradegate-Fall (7,90 €); er handelt US direkt für 11–12 €. Die Konstante war eher zu niedrig.

---

## 11. FEHLER, DIE ICH GEMACHT HABE — nicht wiederholen

- **Leerer Slice als blinder Test** (v3.11.0): `app.slice(indexOf(A), indexOf(B))` mit
  B vor A ergibt einen leeren String; die Prüfung darauf schlägt dann an der falschen
  Stelle fehl oder gar nicht. Immer `assert.ok(block.length > 100)` dazusetzen.
- **Kennzahl auf nur EINEM Datenpfad berechnet** (bis v3.10.0): `sectorLag` lief nur
  im Twelve-Data-Zweig, während produktiv der Tiingo-Zweig aktiv war. Die UI wertete
  einen dauerhaft leeren Wert aus, ohne dass es auffiel. → Bei jeder Kennzahl prüfen:
  wird sie auf ALLEN Datenpfaden gefüllt, oder nur auf dem, den ich gerade ansehe?
- **Test auf Schreibweise statt auf Rechnung** (v3.9.3): `/const ox=/` besteht auch
  `const ox=0`. Der Fix war zurückgedreht, der Test blieb grün. Bei jeder Berechnung
  den Ausdruck extrahieren und ausführen, nicht auf sein Vorkommen prüfen.
- **Tautologischer Test** (v3.6.4): Der Erwartungswert der Zeitzonenprüfung kam aus derselben
  Funktion, die geprüft werden sollte. Die Negativkontrolle fiel deshalb nicht.
  → Gegenrechnungen müssen einen **unabhängigen Pfad** nehmen.
- **Worker-Helfer im Client** (v3.6.1): `r1()` existiert nur im Worker. Im Browser hätte das
  bei jedem Crowd-Laden eine Exception geworfen. Der Harness fängt so etwas, Regex-Tests nicht.
- **Prüfung an der falschen Stelle** (v3.8.2): Die Terminwarnung stand zuerst NACH dem BUY-Zweig
  und hätte genau den VEEV-Fall verpasst, für den sie gebaut wurde.
- **Schwelle am falschen Maßstab** (v3.8.1): 20 Mio. $ gegen einen Feed, der nur 2–3 % des
  Volumens sieht. Hätte die Liste leer gelassen und wie ein Defekt ausgesehen.
- **Code im verriegelten Bereich abgelegt** (v3.9.0): Der neue Modus-A-Overlay landete
  zwischen `/* ---- Claude-Modus-Overlay` und `function buyReady` und brach den SHA, obwohl
  keine Zeile Claude-Code angefasst war. → Vor jedem Einfügen prüfen, welcher Testanker die
  Stelle umspannt.
- **Blockmarker traf das falsche Vorkommen** (v3.9.0): `const claude = (() => {` existiert
  zweimal (Krypto ~543, Aktien ~1407). Der Test fiel — aber aus dem falschen Grund.
  → Ein fallender Test ist kein Beweis, solange nicht klar ist, WARUM er fällt.
- **Funktion gebaut, Bedienbarkeit nie geprüft** (bis v3.9.1): Der Wächter-Schalter in
  Modul 0 war seit v3.5.7 vollständig funktionsfähig — und seitdem für den Nutzer
  unsichtbar, weil er hinter dem rechten Rand eines unsichtbaren Scrollbereichs lag.
  Alle Tests waren grün, weil sie die Existenz prüften, nicht die Erreichbarkeit.
  → Bei jedem Bedienelement zusätzlich fragen: **ist es im realen Viewport sichtbar?**
- **Am Zweck vorbei gebaut** (v3.5.8–v3.7.0): zehn Versionen Anzeigefehler poliert, ohne zu
  fragen, warum nie eine Empfehlung kommt. **Immer zuerst fragen, wofür der Nutzer das Werkzeug
  benutzt.**

---

## 12. AUDIT-CHECKLISTE (bevor gebaut wird)

1. `TZ=Europe/Vienna node tests/safety-regression.mjs` → alle **18** Suiten grün?
2. SHA-256 der vier Claude-Blöcke unabhängig nachrechnen, nicht dem Testlauf glauben.
3. Diff gegen dieses 3.9.0, falls der Nutzer eine spätere Version schickt.
4. Eigene synthetische Fixtures bauen, NICHT die aus der Testdatei nachnutzen.
5. Bei jedem Fund erst am echten Code verifizieren, dann urteilen.
6. Client-Änderungen über `tests/client-harness.mjs` funktional prüfen.
7. **Negativkontrolle fahren:** Fix künstlich zurückdrehen — fällt der Test dann wirklich?
   Ein Test, der den Fehler nicht sehen kann, ist kein Funktionsnachweis.
8. Ändert man eine bestehende Sicherheits-Assertion, ist die **Absicht** dahinter zu erhalten
   und die Änderung im Testcode zu begründen (Beispiele: v3.6.5 Crowd-Invalidierung,
   v3.8.0 Large-Cap-Gate).

---

## 13. ARBEITSSTIL

- Ehrliche, direkte Einschätzung ohne Schönfärberei. Eigene Fehler offen benennen.
- Bei Funden: Zahlen und Beweise, nicht Behauptungen.
- Kein Feature als „fertig" bezeichnen ohne Funktionsnachweis.
- Der Nutzer ist Arzt, technisch versiert, denkt kritisch mit und findet echte Widersprüche —
  SOFI, die Heatmap-Labels, die fehlende Wirtschaftlichkeit, VEEV. Diese Rückmeldungen ernst
  nehmen: sie waren jedes Mal berechtigt.
- Deutsch, prägnant. Bei Gedankenexperimenten mutig mitdenken, bei Fakten/Geld/Sicherheit klar bleiben.
- Keine unnützen Rückfragen am Ende einer Antwort.
- Jede Version: Release Notes fortschreiben, Übergabe aktualisieren, ZIP ausliefern
  (**das Ausliefern nicht vergessen — in v3.5.8 ist mir genau das passiert**).
