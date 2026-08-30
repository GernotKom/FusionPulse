# FusionPulse – Übergabe für neuen Chat · v3.29.2 (Claude/Opus-Strang)

> ZUERST vollständig lesen, DANN den Code auditieren, DANN erst bauen.
> Ersetzt alle früheren HANDOVER-Dateien.

## ⚠ WIE DIESE DATEI ZU LESEN IST

Sie ist über zehn Versionen gewachsen. Die Abschnitte 1–13 stammen aus der Zeit
von v3.18.0 und beschreiben die Grundlagen — **Rechenwerte und Suitenzahlen dort
sind veraltet**, die Denkweise nicht. Was seither passiert ist, steht in den
Abschnitten **8p bis 8z** am Ende. Bei Widerspruch gilt der spätere Abschnitt.

**Aktueller Stand:** v3.29.2 · `npm run check` → **47 Suiten grün** in zwei
Zeitzonen, plus Service-Worker-Prüfstand und Erreichbarkeits-Audit.
Was seit v3.28.0 passiert ist, steht in **Abschnitt 8z** ganz am Ende.
(`tests/safety-regression.mjs` plus `tests/sw-fault.mjs`, letzterer FÜHRT den
Service Worker unter Störungen AUS, plus `tests/reachability-audit.mjs`.)

## DIE VIER REGELN, DIE ALLES ANDERE ÜBERWIEGEN

**1 · „Effizienz" heißt in diesem Projekt EURO, nicht Rechenzeit.**
Ich habe das einmal verwechselt und eine ganze Version an der Frage vorbeigebaut
(8p gegen 8q). Bei jedem unscharfen Wort des Nutzers zuerst nachfragen, welche
Größe gemeint ist.

**2 · `Number(null)` ist 0, nicht NaN.** Fünf Mal derselbe Fehler in fünf
Versionen (8t, 8u, 8y): eine fehlende Angabe ging als „gültige Null" durch —
einmal wurden Kryptokosten verdoppelt, einmal fiel das Mindestziel von 2,04 %
auf 0,38 %, einmal wäre ein fehlender Spread als bestmöglicher Wert
durchgegangen. **Jede Zahl von außen läuft über `posNum` bzw. `feld()`.**
`Number.isFinite` allein reicht NICHT.

**3 · Ein `respondWith` darf niemals ablehnen** (8v). Ein Service Worker sitzt
zwischen der App und allem, was sie braucht; ein unbehandelter Fehler nimmt
nicht eine Datei aus dem Verkehr, sondern die ganze Anwendung. Das hat die App
einen halben Tag lang komplett stillgelegt.

**4 · Fehlende Daten dürfen NIE etwas verbessern.** Gilt überall: in den Kosten,
in der Rangfolge, im Urteil, in den Hürden. Fail-closed ist kein Stil, sondern
die tragende Regel dieser App.

## WAS TESTS IN DIESEM PROJEKT LEISTEN MÜSSEN

Abschnitt 11 listet sechs Fälle, in denen ein Test durchlief ohne etwas zu
sagen. Seither gilt:

- **Jede neue Prüfung braucht eine Negativkontrolle** — Code absichtlich kaputt
  machen, Fehlschlag beobachten, zurücksetzen. Protokoll in den Release Notes.
- **Regex sieht, was da ist — nie, was fehlt.** Ein fehlendes `.catch()` ist per
  Textprüfung unsichtbar. Alles, was zwischen App und Daten sitzt, muss unter
  Störung AUSGEFÜHRT werden (8v).
- **Unit-Tests der reinen Funktionen reichen nicht.** Drei Fehler saßen in der
  NAHT zwischen Parameterschicht und Rechnung. Jeder Endpunkt braucht einen
  Aufruf ohne jeden Parameter, der die dokumentierten Standardwerte bestätigt
  (8u).
- **Für jeden Schutzmechanismus einen Datensatz suchen, auf dem NUR er greift.**
  Zwei Schutzmechanismen, die dasselbe Ergebnis erzeugen, werden sonst nur als
  Vereinigung geprüft (8q).
- **Tests dürfen nicht von der Reihenfolge der Datei abhängen.** `sliceFn()`
  statt Schnitten bis zu entfernten Ankern (8x).
- **Für den Erfolgspfad zu testen findet die teuerste Fehlerklasse nie.** Der
  fünfte `Number(null)`-Fall wurde nur gefunden, weil „unbekannter Wert darf
  nicht durchgehen" für JEDES Feld einzeln geschrieben war (8y).

## DAS WIEDERKEHRENDE MUSTER — vier Mal derselbe Befund

Die App maß etwas anderes, als der Nutzer wollte:
v3.8.0 falsches Universum · v3.16.0 falsches Gate · v3.20.0 falsche
Erfolgsschwelle (5 % statt 2,04 %) · v3.22.0 Ertrag je Trade statt je Zeit.

Und vier Mal: **was nicht aufgezeichnet wird, kann nie kalibriert werden** —
Situationstyp (v3.17.0), Dollarumsatz (v3.18.0), Spread (v3.23.0),
Score-Beiträge (v3.27.0).

**Bei jeder Kennzahl, die über Erfolg entscheidet, zuerst prüfen: misst sie
dasselbe wie das erklärte Ziel des Nutzers?** Nicht, ob sie plausibel gewählt
ist.

## WORAUF DIE APP GERADE WARTET

Fast alles seit v3.20.0 braucht Laufzeit. `situParts` (v3.27.0) und `mae_pre`
(v3.21.0) sammeln sich erst; **rückwirkend ist nichts davon zu heilen**. Rechne
mit sechs bis acht Wochen bis zum ersten belastbaren Urteil. Das darf nicht
durch weichere Schwellen beschleunigt werden.

**Die einzige Ausnahme:** Auswertungen auf TAGESBALKEN. Historische Tagesdaten
sind abrufbar, also sofort rückwirkend prüfbar — und sie sind der Teil, den der
kostenlose Zugang in guter Qualität liefert (die IEX-Beschränkung trifft
Intraday-Quotes hart, Tages-OHLCV kaum).

## NÄCHSTER SCHRITT, mit dem Nutzer besprochen

**Die Vorabend-Liste.** Die App sucht Okkasionen zum falschen Zeitpunkt: ihr
längster Zeitrahmen sind 60-Minuten-Balken, sie sieht nur die Zündung. Eine
Okkasion entsteht aber am Vortag — mehrtägige Kompression, versiegender Umsatz,
Nähe zu einem mehrtägigen Widerstand, Termin voraus. Wer bei 2,04 % Zielweite
erst einsteigt, wenn die Bewegung sichtbar ist, hat oft ein Drittel davon
verloren.

Zu bauen: ein Lauf nach US-Handelsschluss gegen Tagesbalken der letzten 60 Tage,
Ergebnis 5–15 Namen für den nächsten Tag mit Trigger, Stop und Zielweite. Das
entscheidende Kriterium, das übliche Screener nicht haben: **der strukturelle
Stop muss innerhalb der erlaubten Stopweite liegen** — sonst ist der Kandidat
für diesen Nutzer unhandelbar, egal wie gut er aussieht.
Dazu eine rückwirkende Ereignisstudie: wie sahen die stärksten Bewegungen der
letzten Monate am Vortag aus?

Zweitens fehlt eine ganze Klasse: die App ist zu 100 % Momentum. Rückkehr-
bewegungen laufen oft schneller und mit engerem Stop — genau die Geometrie, die
die Kostenrechnung dieses Nutzers braucht. Getrennt aufzeichnen, getrennt
bewerten.

---

## 1. Arbeitsbasis

- Aktuelles Archiv: `FusionPulse_v3.18.0.zip`
- Version steht in `package.json` → `node scripts/sync-version.mjs` schreibt sie in
  `src/version.js`, `public/version.js`, `public/index.html`, `public/sw.js`, `wrangler.jsonc`,
  **seit v3.14.3 zusätzlich** in `--fp-css-version` (`public/style.css`), in die
  `?v=`-Parameter der Asset-URLs in `index.html` und in `SHELL_VERSIONED` (`public/sw.js`)
- Tests: `npm run check` bzw. `node tests/safety-regression.mjs` → **37 Suiten, alle grün**
- `tests/client-harness.mjs` führt `public/app.js` in einer VM mit gestubbten Browser-APIs
  WIRKLICH aus. Top-Level-`const`/`let` landen nicht auf dem Kontext, deshalb hängt ein
  Epilog die zu prüfenden Bindungen als Accessoren an `globalThis.__fp`.
- `npm run audit:reach` sucht Bedienelemente hinter unsichtbaren Scrollbereichen —
  das Muster, das den Modul-0-Schalter zehn Versionen lang verborgen hat.
- Tests bei Zeitthemen zusätzlich mit `TZ=Europe/Vienna` und `TZ=America/Chicago` fahren.
- Nach jedem Deploy: `Cmd+Shift+R`. **Seit v3.14.3 ist ein veralteter Cache aber
  strukturell unmöglich** — `app.js`, `style.css` und `version.js` tragen die Version im
  URL, eine neue Version ist damit eine neue Cache-Adresse.
- **Die Kopfzeile zeigt seit v3.14.5 dauerhaft beide Stände:** `v3.18.0 · Worker 3.18.0`.
  Weichen sie ab, wird die Anzeige gelb. Der Tooltip listet alle vier Stempel
  (version.js, Worker, index.html, style.css). **Das ist ab jetzt die erste Frage bei
  jedem gemeldeten Anzeige- oder Scrollfehler.**

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
- **v3.12.0** Kopfhöhe gemessen statt geraten (behebt anstoßendes Fokusfenster UND
  rutschende Leiste), zweistufige Navigation mit allen Rubriken, Kürzel/Richtung an
  jeder Heatmap-Spur, dokumentierte Ausnahmen im Erreichbarkeits-Audit.
- **v3.13.0** Live-Quote im Deep-Scan als STAPELABRUF (2 API-Aufrufe statt 40),
  Kursalter beim Anzeigen neu gerechnet. Reine Anzeige.
- **v3.14.0** Fußleiste gemessen (Fehler aus v3.12.0: Kopf gemessen, Fuß übersehen),
  Reiterleiste von sticky auf fixed, **Modus A per Migration aktiviert**.
- **v3.14.1** Konsistenzprüfung der Auslieferung: Shell-Stempel gegen FP_VERSION,
  einmalige Selbstheilung, danach ehrliche Warnung statt Reload-Schleife.
- **v3.14.2** Zweite Fußleiste `.dock` mitgemessen; Systemampel benennt die Quelle
- **v3.14.3** Assets tragen die Version im URL; Stempel im Stylesheet; Kopfzeile
  meldet den geladenen Code statt der Worker-Version
- **v3.14.4** `body{height:100%}` → `min-height`, Abstandhalter im Fluss.
  **Das war die eigentliche Ursache des Scrollfehlers aus v3.14.0/v3.14.2.**
- **v3.14.5** Kopfzeile zeigt Oberfläche UND Worker dauerhaft, gelb bei Abweichung
- **v3.14.6** Systemampel war unsichtbar: nur 2 von 4 Stufen hatten eine Textfarbe
- **v3.15.0** Modellvergleich (Claude/Aladdin · ChatGPT-Strang · Momentum nebeneinander),
  Sektor-Priorisierung der Deep-Scan-Queue, Kachelfarben (Variante A)
- **v3.16.0** **Modus A gibt keine Kauf-Freigabe mehr (Variante 2).** Ursache war ein Gate
  aus dem falschen Modell — siehe Abschnitt 8m, das ist der wichtigste Befund seit v3.8.0.

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

### P-A3 — Modus A am Livemarkt gegenprüfen · TEILWEISE ERLEDIGT in v3.16.0
- **Konsolidierungserkennung: WIDERLEGT, Punkt gestrichen.** Der Verdacht „0,62 ist zu
  streng" war falsch. Die echte Geometrie wurde aus `worker.js` extrahiert und gegen
  20.000 synthetische Bar-Pfade AUSGEFÜHRT: 93,1 % Trefferquote bei Movern mit
  Beruhigung, 88,5 % ohne, 16,1 % bei ruhigen Standardwerten. Die Erkennung arbeitet
  wie gedacht. **Nicht erneut daran drehen, ohne die Messung zu wiederholen.**
- **Zielweite `1,0 × Tagesspanne`: bestätigt als Problem, NICHT behoben.** Median
  Ziel:Stop = 18,5. Damit bindet `MIN_REWARD_RISK_FIXED = 2,0` in KEINEM Szenario —
  ein Gate, das nie greift, schützt nichts. Gleichzeitig liegt TP2 bei einem Titel, der
  8 % gelaufen ist, nochmal rund 8 % höher und ist damit praktisch unerreichbar.
  Braucht echte Zähler, nicht die nächste geratene Zahl.

### P-A4 — ERLEDIGT in v3.18.0 (Beschreibung als Kontext belassen)
Ausgezählt: von 52 Edelmetall-Tickern steht **0** in `LARGE_CAP_RADAR_SYMBOLS` und
**1** (AEM) im `STOCK_SEARCH_CATALOG`. 98 % sind damit nur über das Momentum-Gitter
erreichbar (≥ 3 % Bewegung UND ≥ 2 Mio. $ IEX-Umsatz ≈ 80 Mio. $ Gesamtumsatz). Der
reservierte Platz aus v3.15.0 zieht ausschließlich aus `radar.rows` und verfällt
deshalb meistens still.
Vorschlag: die Reserve darf zusätzlich aus dem Katalog ziehen, wenn der Radar für den
Sektor nichts liefert — klar getrennt gekennzeichnet, weil ein Katalogtitel keine
Radar-Nominierung ist. **Kein Score, kein Gate, keine Ampel.** Zum Vergleich:
Pharma 83 %, Technologie 59 % nur über das Gitter.

### P-A5 — Palladium ist strukturell nicht erreichbar (NEU, dokumentiert, nicht behebbar)
Es gibt kein US-gelistetes Pure-Play. Die Produzenten sitzen in Russland und Südafrika;
PALL ist ein ETF und wird von `NON_COMMON_EQUITY_RE` bewusst verworfen. Von der Liste hat
nur SBSW nennenswerten Pd-Anteil, PLG scheitert an `MOM_MIN_PRICE_USD`. **Das ist kein
Fehler und keine Einstellung — es gehört nur dokumentiert, damit es nicht dreimal
untersucht wird.**

### P6 Teil 1b — Eingabemaske Termine — **ERLEDIGT in v3.16.1**
Suite 35 mit fünf Negativkontrollen. Drei Fallen sind im Code dokumentiert und getestet:
die Route ERSETZT die Liste (nicht ergänzen), `earningsFor()` wirkt nur im Fenster
0–14 Tage, und die Tafel zeigt nur analysierte Titel. **Wer hier etwas ändert:** die
Eingabefelder müssen STATISCH im Markup bleiben — `renderEarningsBoard()` schreibt sein
`innerHTML` bei jedem Scan neu und würde ein erzeugtes Formular samt Tippfokus verwerfen.
Ein Test verbietet ihr Vorkommen in `renderEarningsEditor()`.

### P-L1 — Musterlabor nach Situationstyp auswerten (NEU, wartet auf Daten)
`snapshotPayload()` schreibt `situation`/`lifecycle`/`maturity` seit v3.17.0 mit. Sobald
je Typ ATTR.MIN_SAMPLE Episoden aufgelaufen sind (Schaetzung: einige Wochen), kann das
Labor zusaetzlich nach Situationstyp gruppieren statt nur nach Ausgang. **Vorher nicht
bauen** — die Gruppen waeren leer und die Oberflaeche behauptete eine Auswertung, die
keine ist. `situationCoverage` im Endpunkt zeigt den Fuellstand.

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

## 8h. WAS v3.12.0 GEÄNDERT HAT

**Zwei der drei gemeldeten Fehler hatten dieselbe Ursache.** Feste Pixelwerte für die
Höhe von Kopfzeile und Reiterleiste (62/104/52 px an vier Stellen, teils `!important`).

1. **`measureChrome()` + ResizeObserver.** Schreibt die gemessene Höhe in
   `--fp-head-h`, `--fp-nav-h`, `--fp-chrome-h`. `body{padding-top:var(--fp-chrome-h)}`,
   `.viewbar{top:var(--fp-head-h)}`, `scroll-margin-top` aus derselben Quelle.
   → **Wer hier etwas ändert:** NIE wieder eine feste Pixelhöhe eintragen. Die Kopfzeile
   ist `flex-wrap`, ihre Höhe ist keine Konstante. Tests verbieten die alten Werte
   ausdrücklich (nach Entfernen der CSS-Kommentare — die zitieren sie).
2. **Zweistufige Navigation.** `VIEW_SECTIONS` in app.js definiert die Rubriken je
   Bereich; `renderViewSub()` zeichnet nur Rubriken, deren Ziel im Markup existiert;
   `markActiveSection()` markiert beim Scrollen. Ein Test prüft ALLE Sprungziele gegen
   das Markup — ein toter Reiter tut beim Klick nichts und fällt sonst niemandem auf.
3. **Heatmap-Spuren.** Kürzel und Pfeilspitze hingen an `dir==='sweet'`, also nur an
   Aufwärtsspuren — das war meine halbe Lösung aus v3.9.3 und exakt der gemeldete
   Fehler. Jetzt jede bewegte Spur, Pfeil per `atan2` in die echte Richtung, Kürzel erst
   ab `MIN_TAG_MOVE` (sonst überlagern sich im Cluster fünfzehn Kürzel).
   Abwärts ist Orange, **nicht Rot** — eine Beobachtung, kein Alarm.
4. **Audit-Ausnahmen.** `/* reach-audit-ok: .klasse — Begründung */` in der CSS. Ohne
   Begründung keine Ausnahme (nachgeprüft). Die Ausnahme bleibt im Bericht sichtbar.

### Drei weitere Testschwächen (Abschnitt 11)
- Negativprüfung schlug auf dem **eigenen Erklärkommentar** an, der den alten Wert
  zitiert → CSS-Kommentare vor Negativprüfungen entfernen.
- `new Function('document', …)()` band das Argument zum falschen Zeitpunkt → Fabrik
  pro Aufruf binden.
- Farbprüfung per geratenem Muster (`/#[ef][0-9a-f]{2}[0-5]/`) traf Orange als Rot →
  Farben nie nach Muster prüfen, gegen konkrete Werte vergleichen.

## 8i. WAS v3.13.0 GEÄNDERT HAT — Live-Quote im Deep-Scan

**Befund:** `freshestStockQuote` lief NUR im manuellen Suchpfad (`tiingoStockLookup`).
Der Deep-Scan rief sie nie auf → jede Scanner-Zeile hatte `liveQuoteOk` undefiniert →
die UI zeigte dauerhaft „KEIN LIVE-QUOTE", auch mitten in der US-Handelszeit.

1. **`freshestStockQuotesBatch(env, symbols)`** — GENAU ZWEI API-Aufrufe pro Durchlauf,
   unabhängig von der Symbolzahl. Möglich, weil `tiingoIexSnapshot` ohnehin `/iex` für
   den ganzen Markt holt und Alpacas `/v2/stocks/snapshots` eine Symbolliste nimmt.
   → **WICHTIG für den nächsten Bearbeiter:** Der naive Weg (Aufruf je Symbol) kostet
   bei 20 Titeln 40 Abfragen je Zyklus und sprengt das Budget. Ein Test führt die
   Funktion mit 40 Symbolen aus und verlangt Zähler == 1. Nicht lockern.
2. **`freshestStockQuote` ist jetzt nur ein Stapelaufruf mit einem Symbol.** Damit gibt
   es EINE Frischelogik. Direkte Lehre aus v3.10.0 (`sectorLag` auf nur einem Pfad).
3. **`attachLiveQuotes(rows, quotes, fx)`** — rein additiv. Zeile ohne Quote bleibt
   unverändert, KEIN Ersatzwert. Test mit Gegenprobe.
4. **`focusQuoteMeta` rechnet das Kursalter beim ANZEIGEN neu.** Ohne das hätte eine
   Zeile aus dem Server-Cache einen 3 Minuten alten Kurs als „8s alt · LIVE / FRISCH"
   ausgewiesen — eine Lüge in genau der Anzeige, die vor Plänen auf altem Kurs schützt.
   Ein Kurs über der Grenze verliert sein „frisch", auch wenn der Server ihn so schickt.
5. **`stockMemo.liveQuoteHits`** zeigt, wie viele Zeilen einen Quote bekamen. Dauerhaft
   0 heißt: Alpaca-Secrets fehlen in Cloudflare.

### Offen (unverändert)
- **Favoritenquote** 2 von 20 pro Zyklus ist zu wenig für 17 Favoriten → 6 wären richtig
- **`tradeMode: 'off'`** — Modus A weiterhin inaktiv, 8R-Deckel greift noch

## 8j. WAS v3.14.0 GEÄNDERT HAT

1. **`--fp-foot-h` — mein Fehler aus v3.12.0.** Dort hatte ich den KOPF gemessen und
   geschrieben, die Ursache sei behoben. Unten stand weiter `body{padding-bottom:108px}`.
   Die Signalleiste ist `fixed` und wird mit aktivem Plan zweizeilig; war sie höher als
   108 px, blieb das Seitenende dauerhaft verdeckt. → **Lehre:** Wenn eine Ursache
   „feste Pixelwerte" heißt, ALLE Stellen suchen, nicht nur die gemeldete.
2. **`.viewbar` von `sticky` auf `fixed`.** Die sticky-Regel war korrekt und wirkte
   trotzdem nicht. Sticky hat stille Ausfallgründe (Elternbox, overflow, Stapelkontext),
   die man einem Screenshot nicht ansieht. Da der Kopf `fixed` ist und gemessen wird,
   ist `fixed` deterministisch. Test verbietet die Rückkehr von sticky.
3. **Modus A aktiviert — Default UND Migration.**
   → **WICHTIG:** `S = {...DEFAULTS, ...storedSettings}` bedeutet, dass eine
   Default-Änderung bestehende Nutzer NICHT erreicht. Ein gespeichertes `'off'`
   überschreibt sie. Deshalb `tradeModeMigrated314`: migriert NUR den alten Default,
   respektiert `tradeModeChosen` (wird gesetzt, sobald der Nutzer selbst wählt), läuft
   genau einmal, wird gespeichert. Vier Fälle im Test einzeln nachgewiesen.
   Die Umstellung wird dem Nutzer **angezeigt** — die stummen Migrationen v3.5.2/3.5.3
   waren ein Fehler, weil man sich abweichende Ergebnisse sonst falsch erklärt.

### Folge für P-A3
Modus A ist jetzt scharf, aber **nicht validiert**: Konsolidierungsschwelle (0,62) und
Zielweite (1,0 × Tagesspanne) sind unverändert Schätzungen. Erste Livebeobachtung
abwarten, bevor daran geschraubt wird.

### Offen
- **Favoritenquote** 2 von 20 pro Zyklus bei 17 Favoriten → jeder Favorit alle 20–35 Min.
  Bei Nachrichten-Moves von 20–40 Min zu langsam. 6 Plätze wären die naheliegende Änderung.
- **Versionsmischung beobachten:** Im Screenshot vom 27.08. 22:26 zeigte der Tab-Titel
  3.11.0, die Kopfzeile v3.12.0. Der SW läuft network-first, das sollte nicht passieren.
  Bei Wiederauftreten die Auslieferung prüfen, nicht die Layout-Regeln.

## 8k. WAS v3.14.1 GEÄNDERT HAT — und die wichtigste Lehre dieses Strangs

**Anlass:** Der Nutzer meldete „die Version hängt". Tab-Titel 3.11.0, Kopfzeile v3.12.0.

**Warum das zentral ist:** Der Titel kommt aus `index.html`, die Kopfzeile aus
`version.js`. Laufen sie auseinander, läuft NEUER CODE AUF ALTER SHELL. Dem neuen Code
fehlen Elemente, die er erwartet, und die Folgefehler sehen aus wie Layout- oder
Scrollprobleme. **Ich habe zwei Versionen lang an Layout-Regeln gearbeitet, während die
Ursache möglicherweise die Auslieferung war.** Die Versionsmischung war im Screenshot vom
27.08. 21:20 schon sichtbar und ich habe sie erst beim dritten Mal ernst genommen.

1. **`<meta name="fp-shell-version">`** in index.html, von `sync-version.mjs` gesetzt.
   → **Wer sync-version.mjs anfasst:** Der Stempel MUSS mitwandern, sonst meldet die
   Prüfung bei jeder Auslieferung fälschlich einen Fehlstand. Ein Test prüft das.
2. **`checkShellConsistency()`** vergleicht Stempel gegen `FP_VERSION`.
   Fehlstand → EINMAL `hardReload()` (leert Caches + SW), danach dauerhafte Warnung.
   → **NIE eine Reload-Schleife bauen.** Ein nicht behebbarer Fehlstand würde die App
   unbenutzbar machen. Der Versuch läuft genau einmal je Sitzung (`sessionStorage`),
   ein Test dreht den Schutz zurück und verlangt, dass der zweite Lauf warnt.
3. **Die Warnung sagt ausdrücklich, dass es NICHT an den Einstellungen liegt.** Genau
   diese Fehlzuordnung hat hier zwei Runden gekostet.
4. **Test vergleicht alle drei Stempel** (Titel, Shell-Meta, FP_VERSION) gegen
   package.json. Ein Auseinanderlaufen fällt jetzt vor dem Deploy auf.

### Regel für den nächsten Bearbeiter
Bei JEDER gemeldeten Anzeige-, Layout- oder Scrollauffälligkeit ZUERST prüfen, ob
Tab-Titel und Kopfzeile dieselbe Version zeigen. Stimmt das nicht, ist jede weitere
Fehlersuche im Code verlorene Zeit — erst den Stand sauber machen.

### Weiterhin offen
- **Scrollproblem Kryptofenster:** Die Fußleisten-Messung aus v3.14.0 sollte es beheben.
  Belastbar ist das erst mit konsistenter Shell.
- **Favoritenquote** 2 von 20 pro Zyklus bei 17 Favoriten → 6 Plätze wären richtig.
- **P-A3** Modus A ist scharf, aber nicht validiert.

## 8l. WAS v3.14.2 BIS v3.14.4 GEÄNDERT HAT — die teuerste Fehlersuche dieses Strangs

Der Nutzer meldete über **fünf Versionen hinweg** denselben Fehler: *„ich kann den Screen
nicht weiter runter scrollen."* Es waren drei verschiedene Ursachen übereinander, und ich
habe sie einzeln abgetragen, statt sie zu trennen.

**v3.14.2 — die zweite Fußleiste.** Unten liegen ZWEI feste Leisten übereinander, nicht
eine: `.dock` (Titel + Plan-Knopf) sitzt auf `.signal-banner`. `measureChrome()` maß nur
die Signalleiste. Am Screenshot nachgerechnet: 66 px Dock + 51 px Leiste = 117 px verdeckt,
freigeschoben wurden 65 px. Es fehlten 52 px. Zusätzlich saß `.dock` auf `bottom:52px`,
einem geratenen Festwert — verboten seit v3.12.0, hier übersehen.
Der Fehler tritt **nur bei aktivem Plan** auf; ohne Auswahl ist `.dock` ausgeblendet.
Genau deshalb blieb er unentdeckt.

**v3.14.3 — die Auslieferung war nicht prüfbar.** Es gab drei Versionsstempel
(`index.html`, `version.js`, Worker), und die beiden Dateien mit den Korrekturen hatten
KEINEN: `app.js` und `style.css`. Der Zustand „index.html neu · version.js neu ·
style.css alt" war vollständig unsichtbar. Dazu zeigte die Kopfzeile `'v'+health.version`,
also die Version des **Workers**, nicht des geladenen Codes.
→ Assets tragen jetzt `?v=<version>` im URL, das Stylesheet trägt `--fp-css-version`.

**v3.14.4 — DIE EIGENTLICHE URSACHE.** In Zeile 8 der `style.css` stand:
```css
html,body{margin:0;height:100%}
```
`height:100%` macht die body-Box exakt fensterhoch. Der Inhalt ist ein Vielfaches davon
und läuft heraus. Damit sitzt `body{padding-bottom:…}` am unteren Rand **der Box** — rund
eine Fensterhöhe weit oben, mitten im Inhalt — und nicht hinter dem letzten Element. Zur
Scrollhöhe des Dokuments trägt es **nichts** bei.

**Jede Fußleisten-Korrektur seit v3.14.0 war deshalb wirkungslos.** Nicht falsch gerechnet:
die Messung war ab v3.14.2 nachweislich korrekt. Die Zahl floss in eine Eigenschaft, die
an dieser Stelle keine Wirkung haben KANN.

**Das Signal, das ich fünf Versionen lang übersehen habe:** `padding-top` funktionierte
immer, `padding-bottom` nie. Diese Asymmetrie stand seit v3.14.0 in meinen eigenen Notizen.
Ich habe daraus dreimal geschlossen, die Messung sei falsch.

**Lösung, bewusst nicht über padding:** ein echtes Element im Fluss als letztes Kind des
Dokuments, `.foot-spacer` mit `height:calc(var(--fp-foot-h) + 14px)`. Ein Block im
normalen Fluss erzeugt Scrollfläche ohne jede Bedingung — unabhängig von Boxmodell,
Überlauf oder Stapelkontext. Dieselbe Überlegung wie beim Wechsel sticky → fixed.
Ein Test hält fest, dass hinter dem Abstandhalter nie wieder Inhalt landet.

## 8m. WAS v3.14.5 UND v3.14.6 GEÄNDERT HAT

**v3.14.5 — Kopfzeile.** Ich hatte die Worker-Version so gebaut, dass sie nur bei
Abweichung erscheint. Der Nutzer hielt das für einen vergessenen Punkt, und er hatte
recht mit dem Einwand: bei Gleichstand ist von außen nicht unterscheidbar, ob der
Vergleich stattgefunden hat oder ob die Anzeige auf die alte Einquellen-Logik
zurückgefallen ist. **Ein sichtbarer Gleichstand ist die nützlichere Information als ein
stilles Nichts.** Beide Nummern stehen jetzt immer da.

**v3.14.6 — die Systemampel war keine Ampel.** Vier Stufen, aber nur zwei hatten eine
Textfarbe (`orange`, `err`). `ok` und `warn` färbten ausschließlich den 1px-Rahmen, bei
`warn` mit 47 % Deckkraft (`#f2c01577`). Der Zustand war korrekt berechnet und praktisch
unsichtbar. Als einziges Statuselement im Kopf hatte die Leiste zudem keinen Punkt.
→ Jede Stufe hat jetzt Punkt, Rahmen, Textfarbe und Flächentönung. **Die Bewertung ist
unverändert**; ein Test rechnet die Zuordnung Zustand → Stufe nach.

## 8n. WAS v3.15.0 GEÄNDERT HAT — drei additive Erweiterungen

Gemeinsame Invariante: **keine davon verändert Score, Gate, Ampel oder Freigabe.**

**1. Modellvergleich.** Der Worker rechnete schon immer drei Urteile im selben Datensatz
(`src/worker.js`, `claude, fusion, momentum`); angezeigt wurde nur das des aktiven Modus.
Jetzt stehen alle drei in der Fokuskarte nebeneinander, der aktive ist markiert.
`modelCompare()` **liest nur** — ein Test verbietet `S.minCrvStock`, `buyReady` und jede
Score-Zuweisung in diesem Block.
**Wichtig für den nächsten Bearbeiter:** Übereinstimmung wird ausdrücklich NICHT als
Bestätigung ausgegeben. Die drei Modelle teilen sich dieselben Kursdaten, ihre Fehler sind
korreliert. Eine Negativkontrolle verhindert, dass daraus je „alle Modelle bestätigen das
Setup" wird.

**2. Sektor-Priorisierung** (Wunsch: Pharma/Healthcare, Edelmetalle/Minen, Technologie).
`PRIORITY_SECTORS` in `src/worker.js`, ~180 kuratierte Ticker in dieser Reihenfolge.
**Warum kuratiert und nicht abgefragt:** Der Sektor stand nur im statischen Katalog mit
**26 Einträgen**; alles aus dem Whole-Market-Radar trägt `sector:'Discovery'`. Tiingo
liefert Sektor/Industrie nur im kostenpflichtigen Fundamentals-Paket. Die Liste ist
ausdrücklich als kuratiert und unvollständig gekennzeichnet.
Sie verändert nur, WELCHE Titel tief analysiert werden — pro Sektor ein reservierter Platz
vor dem allgemeinen Radar, gefüllt ausschließlich aus Titeln, die der Radar ohnehin
nominiert hat. **Aufmerksamkeit, kein Bonus.** Ein Test durchsucht jede Zeile mit
`prioritySector` auf Berührung mit Score, Ampel oder CRV.
`SECTOR_RESERVE_PER_SECTOR = 1` ist **geraten, nicht gemessen** — gehört auf dieselbe
Liste wie `MOM_MIN_DOLLARVOL` (siehe P-A2).

**3. Kachelfarben — Variante A, vom Nutzer so gewählt.** Einstellbar sind Rahmen und
Flächentönung von fünf neutralen Kachelgruppen. **Ampelfarben sind geschützt**: Punkt und
Text der Systemleiste, Verdict-Band, Ampelspalten im Modellvergleich, Statusband.
Begründung, die erhalten bleiben muss: in v3.14.6 war die Systemampel unsichtbar, weil
eine Farbe zu schwach war. Eine Einstellung, mit der sich derselbe Zustand wiederherstellen
ließe, wäre ein Rückschritt mit Bedienoberfläche.
Zwei Sicherungen: die vier Ampelfarben sind in `RESERVED_TINTS` reserviert und werden
verworfen statt übernommen; nur echte Hex-Werte kommen in die Variable (fail-closed gegen
manipulierten localStorage). Ein Test prüft **jede** CSS-Regel mit `var(--tint-…)` darauf,
dass ihr Selektor keine Ampel berührt.

**Nebenbefund am Testwerkzeug:** `tests/client-harness.mjs` stubbte `documentElement.style`
als nacktes Objekt ohne `setProperty`/`removeProperty`. Der Harness fiel mit einem
`TypeError` statt mit einer Aussage. Der Stub merkt sich die Werte jetzt und ist prüfbar.

### Weiterhin offen nach v3.15.0
- **`status.alpaca.message`** unter `/api/health` — Ursache der roten Systemampel vom
  27.08. Durch Ausschluss eingekreist (Cloudflare-Punkt gelb ⇒ `cpu`/`error`; rot statt
  orange ⇒ `error`; Krypto und Aktien grün) — es ist `alpaca`. Der Klartext fehlt noch.
  **Alpaca hat in der Kopfzeile keinen eigenen Punkt** — deshalb konnte die Ampel rot sein,
  während vier Punkte grün leuchteten. Seit v3.14.2 nennt die Leiste die Quelle im Text.
- P-A2 / P-A3 unverändert (siehe Abschnitt 8)
- `SECTOR_RESERVE_PER_SECTOR` geraten

---

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

- **Symptom fünfmal repariert, Ursache nie gesucht** (v3.14.0–v3.14.4, der teuerste
  Fehler dieses Strangs): Fünf Versionen an der Fußleiste gearbeitet, während die Ursache
  `body{height:100%}` in Zeile 8 stand und `padding-bottom` dort keine Wirkung haben
  KONNTE. → Wenn dieselbe Eigenschaft oben greift und unten nicht, ist nicht der Wert
  falsch, sondern die Annahme über den Mechanismus. **Bei einem Fix, der rechnerisch
  stimmt und trotzdem nichts bewirkt: prüfen, ob die Eigenschaft an dieser Stelle
  überhaupt wirken kann** — nicht die Zahl nachjustieren.
- **Auf einen Mechanismus gesetzt, der still ausfallen kann** (v3.14.0–v3.14.3):
  `padding-bottom` scheitert lautlos. → Wo möglich die deterministische Lösung wählen
  (Element im Fluss statt padding, `fixed` statt `sticky`), nicht die bedingte.
- **Prüfung an die falschen Dateien gehängt** (v3.14.1): Die Konsistenzprüfung verglich
  `index.html` gegen `version.js` — die zwei am leichtesten zu vergleichenden Dateien,
  nicht die zwei, in denen die Fehler liegen (`app.js`, `style.css`). → Eine Prüfung
  gehört an die Datei mit dem Risiko, nicht an die mit dem einfachen Zugriff.
- **Zustand korrekt berechnet, aber unsichtbar** (bis v3.14.6): Die Systemampel hatte für
  zwei von vier Stufen keine Textfarbe und einen Rahmen mit 47 % Deckkraft. → Nach jeder
  Statusanzeige fragen: kann man den Zustand am Bildschirm ABLESEN, nicht nur im DOM finden?
  (Vierter Fall derselben Klasse nach dem Modul-0-Schalter aus v3.9.1.)
- **Anzeige nur bei Abweichung** (v3.14.3–v3.14.4): Die Worker-Version erschien nur im
  Fehlerfall. Bei Gleichstand ist dann nicht unterscheidbar, ob der Vergleich lief oder
  ob die Anzeige zurückgefallen ist. → Ein sichtbarer Gleichstand ist mehr wert als ein
  stilles Nichts.
- **Test fällt aus dem falschen Grund** (v3.14.3, v3.15.0): Ein Slice-Anker mit falschem
  Escaping und ein unvollständiger Harness-Stub führten zu `ReferenceError` bzw.
  `TypeError` statt zu einer Aussage. → Wiederholt aus Abschnitt 11: **ein fallender Test
  ist kein Beweis, solange nicht klar ist, WARUM er fällt.**
- **Negativkontrolle deckte einen zu schwachen Test auf** (v3.14.3): Der Test suchte eine
  Zeichenkette irgendwo in `sync-version.mjs`; eine andere Zeile enthielt sie ebenfalls und
  deckte die entfernte Prüfung. Ohne die Negativkontrolle wäre das durchgegangen.
- **Versionsmischung nicht ernst genommen** (v3.12.0–v3.14.1): Tab-Titel und Kopfzeile
  zeigten verschiedene Versionen. Ich habe zweimal an Layout-Regeln gearbeitet, statt
  zuerst den Auslieferungsstand zu klären. → Bei Anzeige-/Scrollfehlern IMMER zuerst die
  Versionskonsistenz prüfen.
- **Ursache nur an der gemeldeten Stelle behoben** (v3.12.0→v3.14.0): „Feste Pixelwerte"
  war die Ursache; ich habe den Kopf gemessen und den Fuß stehen lassen. Der Nutzer
  meldete denselben Fehler zwei Versionen später erneut. Bei einer Ursachenklasse ALLE
  Vorkommen suchen (`grep`), nicht nur das gemeldete Symptom.
- **Default-Änderung erreicht bestehende Nutzer nicht** (v3.14.0): `{...DEFAULTS,
  ...storedSettings}` — gespeicherte Werte gewinnen. Verhaltensänderungen brauchen eine
  Migration, die nur den alten Default anfasst, und einen sichtbaren Hinweis.
- **Negativprüfung trifft den eigenen Kommentar** (v3.12.0): Ein Kommentar, der den
  alten Wert zur Erklärung zitiert, lässt `doesNotMatch` anschlagen. Kommentare vor
  Negativprüfungen entfernen.
- **Farbe nach Muster geprüft** (v3.12.0): `/#[ef][0-9a-f]{2}[0-5]/` sollte Rot finden
  und traf Orange `#e6a06a`. Farben gegen konkrete Werte vergleichen, nie gegen Muster.
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
- **Gate aus dem falschen Modell** (v3.9.0–v3.15.0, behoben v3.16.0): Modus A ersetzte
  14 Anzeigefelder, aber nicht `netCRV` — und genau `netCRV` war das Gate. Das Setup
  konnte beliebig gut sein, entschieden hat eine Kennzahl des anderen Strangs. → Bei
  jedem Overlay prüfen: welche Felder liest die FREIGABE, und sind die alle ersetzt?
  Eine Feldliste ist unvollständig, bis man die Konsumenten durchgezählt hat.
- **Gate, das nie bindet** (v3.9.0, offen): `MIN_REWARD_RISK_FIXED = 2,0` gegen einen
  Median von 18,5. → Eine Schwelle, die in keinem Szenario greift, ist kein Schutz,
  sondern Dekoration. Verteilung messen, nicht nur die Schwelle setzen.
- **Fixture von einem Boot-Promise überschrieben** (v3.16.1): Der Client startet beim
  Laden `loadEarnings()`; dessen Promise löst eine Mikrotask NACH dem Setzen der
  Testfixture auf und überschrieb sie. Der Test fiel aus dem falschen Grund und sah wie
  ein Codefehler aus. → Im Harness vor dem Setzen einer Fixture den Boot-Tick abwarten.
- **Aufgezeichnet wurde nicht, was angezeigt wird** (v3.0–v3.16.1, ab v3.17.0 behoben):
  Der Snapshot speicherte `setup`, die UI zeigte `situationType`. Modul 0 lernte jahrelang
  ueber ein Label, das der Nutzer gar nicht sieht. → Bei jeder Lernschicht pruefen: ist das
  aufgezeichnete Merkmal DASSELBE, nach dem der Nutzer entscheidet?
- **Zehn Tests gegen 95 %** (v3.17.0, im Entwurf gefunden): Wer zehn Kennzahlen parallel
  prueft, findet in jedem zweiten Durchlauf eine Zufallsentdeckung. → Jede parallele
  Signifikanzpruefung braucht eine Mehrfachtestkorrektur, sonst produziert sie Wissen,
  das keines ist.
- **Fixture macht die Schutzfunktion unsichtbar** (v3.17.0): Jeder Fall hatte eigenes
  Symbol und eigenen Tag — `collapseEpisodes()` war damit wirkungslos und der Test konnte
  seinen Ausfall nicht bemerken. → Eine Fixture muss den Fall ENTHALTEN, gegen den die
  Funktion schuetzt.
- **Rueckbau-Skript ueberschreibt neue Arbeit** (v3.16.0 UND v3.18.0 — ZWEIMAL derselbe
  Fehler): Ein Negativkontroll-Skript stellt am Ende Sicherungen wieder her. Werden die
  vor spaeteren Aenderungen gezogen, loescht der Lauf diese Aenderungen. In v3.18.0 fiel
  die Suitezahl dadurch von 37 auf 7. → **Rueckbau-Skripte nach dem Lauf LOESCHEN.** Eine
  aufbewahrte Sicherung ist eine Zeitbombe, sobald weitergearbeitet wird. Der Schutz ist
  ausschliesslich der Test nach JEDEM Schritt.
- **Harness prueft Absturzfreiheit statt Aussage** (bis v3.18.0): `querySelector` gab
  jedes Mal ein neues Stub-Element zurueck. → Wenn ein Test eine render-Funktion aufruft,
  aber nichts auslesen kann, prueft er nichts.
- **Am Zweck vorbei gebaut** (v3.5.8–v3.7.0): zehn Versionen Anzeigefehler poliert, ohne zu
  fragen, warum nie eine Empfehlung kommt. **Immer zuerst fragen, wofür der Nutzer das Werkzeug
  benutzt.**

---

## 8m. WAS v3.16.0 GEÄNDERT HAT — der wichtigste Befund seit v3.8.0

**Meldung des Nutzers:** *„seit 1 Woche gab es noch nie eine realistische
Aktienempfehlung"* — gemeint waren ALLE Titel der Fokuskarte, nicht nur Edelmetalle.
(Ich hatte mich zuerst an „Palladium" festgebissen. Der Kernbefund ist nicht
sektorspezifisch.)

### Die Ursache

`momentumOverlayRow()` ersetzt 14 Anzeigefelder (`MOMENTUM_VIEW_FIELDS`).
**`netCRV` ist nicht dabei.** `stockTradeability()` liest bei `claudeMode:false` aber
genau `r.netCRV` als `gateCrv` und prüft gegen `S.minCrvStock` (3,0). Modus A lieferte
seinen Plan und wurde am Struktur-CRV eines Plans gemessen, den der Overlay bereits
ersetzt hatte.

Im Harness ausgeführt: Titel mit Momentum-Ampel grün, Score 7,5, Ziel:Stop 5,29 →
`stockLevel` 2. Momentum-Score auf 9,5 gehoben → unverändert keine Freigabe. Nur
`netCRV` 1,8 → 3,2 → Freigabe kippt. **Das Gate hing ausschließlich am anderen Modell.**

Zusätzlich ein Totband: `stockLevel` verlangt Score ≥ `FUSION_MIN_SCORE_STOCK` (7,2),
Modus A wird ab 6,8 grün. Und `fresh.key === 'live'` verlangt Mitgliedschaft in
`refreshedSymbols` des laufenden Zyklus UND `stockMeta.ts` < 90 s — bei ~20 von bis zu
80 Zeilen je Zyklus und Deep-Scans in den Minuten {2,4,6,8} je 10.

### Die Entscheidung: Variante 2

Der Nutzer hat zwischen „eigene Gates für Modus A" und „gar keine Freigabe" gewählt:
**gar keine Freigabe.** Konsequent zu v3.10.0 (Aufmerksamkeitsfilter statt Signalgeber).

- `MODE_A_NO_RELEASE = true`, `modeAActive(r)` als EINZIGE Wahrheitsquelle.
- `stockLevel()` deckelt bei 2 — der Deckel steht GANZ OBEN in der Funktion, damit keine
  spätere Bedingung ihn umgeht. Er kann ausschließlich abwerten.
- Kopfzeilen-Zweig `◆ Kandidat · Modus A` steht VOR dem BUY-Zweig (v3.8.2-Lehre).
- Begründung aus `r.blockers`, nicht mehr aus `netCRV`.
- Euro-Zahl bleibt, gekennzeichnet als `Plan …`, nicht als Empfehlung.
- **Der ChatGPT-Strang ist unberührt** — jeder Zweig hängt an `modeAActive(r)`. Ein Test
  weist nach, dass bei `tradeMode:'off'` weiterhin Level 3 erreichbar ist.
- Fail-closed in beide Richtungen: ohne Momentum-Block (alter Cache) greift nichts davon.

**WICHTIG für den nächsten Bearbeiter:** Wer Modus A jemals wieder eine Freigabe geben
will, muss ihm ZUERST eigene Gates geben. Einfach `MODE_A_NO_RELEASE` auf `false` zu
setzen, stellt den Fehlerzustand wieder her — das Gate wäre dann wieder `netCRV`.

### Zwei eigene Tests waren zu schwach — von der Negativkontrolle aufgedeckt

1. `hl.kind === 'modeA'` bewies nichts: `kind` kommt aus `opp.blockKind` und fiel auch
   ohne den Kopfzeilen-Zweig auf `'modeA'`. Jetzt zusätzlich Symbol `◆` und Titeltext.
2. „Euro-Zahl sichtbar" traf auch die alte Beschriftung `pot. 10.000 €`. Jetzt `^Plan `,
   Fehlen von `pot.` und der Tooltip.

### Nebenbefund am Arbeitsablauf
Das Negativkontroll-Skript spielte am Ende eine zu früh gesicherte `app.js` zurück und
überschrieb drei fertige Änderungen. Aufgefallen nur, weil nach jedem Schritt getestet
wird (34 → 33 Suiten). **Sicherungskopien für Negativkontrollen nach der letzten
inhaltlichen Änderung ziehen, nicht davor.**

### Bereinigt
`CS` (Credit Suisse, ADS am 12.6.2023 von der NYSE genommen) und `NGT` (Newmont Toronto)
aus `PRIORITY_SECTORS` / Edelmetalle entfernt.

### v3.18.0 · Freigabe-Trichter, Kalibrierung, Sektor-Reserve
- **`renderGateFunnel()` / `gateMissesOf()`** zaehlen, wo Kandidaten haengenbleiben.
  `stockTradeability()` gibt dafuer `crvOk`/`tp2Ok`/`hasSize`/`minTp2` mit heraus —
  **keine Zweitrechnung** aufbauen, das ist der Kern. In Modus A wird NICHT gezaehlt.
- **Kalibrierung** im Musterlabor: Verteilung `max_pct/atr_pct` aus vorhandenen D1-Daten.
  Damit ist die Begruendung "braucht Zaehler aus einem Handelstag" fuer die Zielweite
  hinfaellig — die Daten lagen die ganze Zeit da.
- **P-A4 erledigt:** Sektor-Reserve zieht aus dem Katalog nach, wenn der Radar nichts
  liefert. Radar behaelt Vorrang, Katalogtitel tragen `sectorFillFromCatalog`.
  Katalog fuer Edelmetalle von 2 auf 9, Pharma von 7 auf 11 erweitert. Ein Test verlangt
  je Sektor mindestens 5 — sonst wiederholt sich P-A4.
- **`dollarVol`** wird mitgeschrieben, damit `MOM_MIN_DOLLARVOL` messbar wird.
- **KORREKTUR einer eigenen Empfehlung:** `MIN_REWARD_RISK_FIXED` NICHT auf Verdacht
  entfernen. Der Median von 18,5 wurde nur an der Modus-A-Geometrie gemessen; im
  ChatGPT-Strang mit engeren Zielen kann die Schwelle binden. Der Trichter misst es.
- **Harness:** `querySelector` merkt sich Elemente je Selektor, auslesbar ueber `el(sel)`.
  Vorher liess sich Anzeige gar nicht pruefen, nur Absturzfreiheit.

### v3.17.0 · Musterlabor (`/api/patterns`, `#patternLab`)
Ereignisstudie ueber aufgeloeste Snapshots: was war VOR der Bewegung messbar?

**BEFUND, der das ausgeloest hat:** `payload` speicherte nur `setup`. Die neun
Situationstypen, Lebenszyklus und Reife wurden NIE mitgeschrieben — Modul 0 konnte
darueber strukturell nichts lernen. Ab v3.17.0 schreibt `snapshotPayload()` sie mit,
an EINER Stelle fuer beide Schreibpfade. **Rueckwirkend nicht heilbar.**

**WICHTIG fuer den naechsten Bearbeiter — die Mehrfachtestkorrektur nicht anfassen.**
Der erste Entwurf prueft alle zehn Kennzahlen gegen 95 %; bei zehn gleichzeitigen Tests
ist dann in jedem zweiten Durchlauf eine Zufallsentdeckung dabei. `aucNoiseFloor()`
bezieht die Grenze deshalb auf `PATTERN_FEATURES.length` (alpha = 0,05/k). Eine
Negativkontrolle faellt, sobald das entfernt wird.

**Zwei blinde Tests, beide von der Negativkontrolle gefunden:** die Fixture gab jedem
Fall eigenes Symbol UND eigenen Tag (damit war `collapseEpisodes` wirkungslos), danach
rutschten Fixture-Zeitpunkte ueber UTC-Mitternacht (das gruppiert `collapseEpisodes`
doppelt). Fixture liegt jetzt in der US-Sitzung, 14–19 Uhr UTC.

### v3.16.1 · Terminmaske nachgewiesen
In v3.16.0 war der Code ausgeliefert, aber ohne eine einzige Testzeile — und stand
deshalb zu Recht unter „offen". Suite 35 holt den Nachweis nach, fünf Negativkontrollen
fallen. **Regel dahinter, die hier fast gerissen wäre: ausgeliefert ist nicht fertig.**

---

## 12. AUDIT-CHECKLISTE (bevor gebaut wird)

1. `TZ=Europe/Vienna node tests/safety-regression.mjs` → alle **37** Suiten grün?
2. SHA-256 der vier Claude-Blöcke unabhängig nachrechnen, nicht dem Testlauf glauben.
3. Diff gegen dieses 3.18.0, falls der Nutzer eine spätere Version schickt.
4. Eigene synthetische Fixtures bauen, NICHT die aus der Testdatei nachnutzen.
5. Bei jedem Fund erst am echten Code verifizieren, dann urteilen.
6. Client-Änderungen über `tests/client-harness.mjs` funktional prüfen.
7. **Negativkontrolle fahren:** Fix künstlich zurückdrehen — fällt der Test dann wirklich?
   Ein Test, der den Fehler nicht sehen kann, ist kein Funktionsnachweis.
8. Ändert man eine bestehende Sicherheits-Assertion, ist die **Absicht** dahinter zu erhalten
   und die Änderung im Testcode zu begründen (Beispiele: v3.6.5 Crowd-Invalidierung,
   v3.8.0 Large-Cap-Gate).
9. **Bei Anzeige-/Layoutfehlern zuerst die Kopfzeile lesen** (`v… · Worker …`), erst dann
   Code ansehen.
10. **Kann die geänderte Eigenschaft an dieser Stelle überhaupt wirken?** Ein Wert, der
    rechnerisch stimmt und nichts bewirkt, ist ein Hinweis auf den falschen Mechanismus,
    nicht auf die falsche Zahl (v3.14.4).
11. **Ist der Zustand am Bildschirm ablesbar?** Nicht nur: steht er im DOM (v3.9.1, v3.14.6).
12. Fällt ein Test, zuerst klären WARUM. `ReferenceError` und `TypeError` sind keine Aussage.

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
- **PFLICHT seit v3.15.0 (Wunsch des Nutzers):** Jede Release-Notes-Datei endet mit zwei
  kurzen Blöcken in **Laiensprache**, ohne Dateinamen, ohne CSS-Eigenschaften, ohne
  Funktionsnamen:
  - **„Was jetzt funktioniert"** — was der Nutzer nach dem Deploy anders sieht oder kann.
  - **„Was noch offen ist"** — was fehlt, und was ich dafür von ihm brauche.
  Der Rest der Notes darf technisch bleiben; diese beiden Blöcke sind für jemanden
  geschrieben, der den Code nicht kennt. Ein Punkt gehört nur dann unter „funktioniert",
  wenn er nachweisbar getestet wurde — sonst unter „offen".
- **Erste Frage bei jedem gemeldeten Anzeige- oder Scrollfehler:** Was steht in der
  Kopfzeile? Seit v3.14.5 sagt sie `v… · Worker …`. Stimmen beide, ist es ein Codefehler;
  weichen sie ab, ist es die Auslieferung. **Vor dieser Prüfung nicht am Layout arbeiten** —
  das hat fünf Versionen gekostet.

---

## 8p. WAS v3.19.0 GEÄNDERT HAT — Renderbudget und Ladeweg

Erste Version dieses Strangs, die **nichts an der Bewertung** anfasst. Anlass war
die Aussage des Nutzers, die Effizienz der App sei nicht vorhanden. Sie stimmte,
und sie war messbar — siehe `RELEASE_NOTES_v3_19_0.md`.

Drei Eingriffe, alle klein und alle testgesichert:

1. **`public/sw.js`** liefert Assets, deren URL `?v=<APP_VERSION dieses SW>`
   trägt, cache-first aus. Die Bindung an die eigene Version ist der ganze
   Sicherheitsbeweis: eine neuere Shell fordert eine andere URL an und fällt
   automatisch auf Network-first zurück. `/api/` bleibt ungecacht, die Sperre
   steht im Code weiterhin VOR der Cache-Regel (ein Test prüft die Reihenfolge).
2. **`categoryFreshness` / `ageFreshness` / `paintPanel`** in `public/app.js`
   trennen „Markup aus Daten" von „Alterung aus der Uhr". Der 30-Sekunden-Takt
   baut damit nichts mehr neu, solange die Daten stehen.
3. Sekundenuhr ruht im Hintergrund-Tab und cacht ihren Knoten.

**Die Regel, die sich daraus für den nächsten Bearbeiter ergibt:**
Wer eine der fünf Takt-Kacheln anfasst, muss `paintPanel` benutzen und die
Klick-Handler hinter `if (wrote)` binden. Ohne das hängt nach zehn Minuten der
zwanzigste Handler am selben Knopf, und der Klick löst zwanzigmal aus — ein
Fehler, der beim Bauen unsichtbar ist und sich erst nach Minuten Laufzeit zeigt.
Suite 38 besteht darauf.

**Zum Abschnitt 11 (zu schwache eigene Tests):** diesmal wurden alle drei neuen
Kernprüfungen mit einer Negativkontrolle belegt — Code absichtlich kaputt
gemacht, Fehlschlag beobachtet, zurückgesetzt. Das Protokoll steht in den
Release Notes. Ich empfehle, das für jede weitere Suite so zu halten.

**Bewusst NICHT gemacht** (mit Begründung, damit es nicht als Versäumnis gelesen
wird): kein Aufteilen von `app.js` in nachladbare Teile (Umbau, keine
Optimierung), kein Datenversions-Zähler zum Überspringen des String-Baus (ein
vergessener Aufruf würde stillschweigend Veraltetes anzeigen — falscher Tausch
in einer Trading-App), keine CSS-Bereinigung (braucht einen echten Browser).

---

## 8q. WAS v3.20.0 GEÄNDERT HAT — Top Picks nach Netto-Euro

**Der wichtigste Abschnitt seit 8m (v3.16.0). Vor jeder Änderung an der
Lernschicht lesen.**

### Der Anlass — und eine Korrektur an mir selbst

Der Nutzer sagte in v3.19.0 „die Effizienz der App war nicht vorhanden". Ich
habe das als **Laufzeiteffizienz** gelesen und einen Renderbudget-Umbau gebaut.
Gemeint war die **Ergebnisqualität**: gewinnträchtige Kandidaten. Die v3.19.0-
Änderungen bleiben gültig und schaden nicht, sie beantworteten aber die falsche
Frage. Für den nächsten Bearbeiter: bei dem Wort „Effizienz" in diesem Projekt
zuerst nachfragen, ob Rechenzeit oder Euro gemeint sind. Die Antwort ist fast
immer Euro.

### Befund 1 — die Erfolgsschwelle war falsch gesetzt

Jede Lernstatistik misst Erfolg als `max_pct >= 5` (`ATTR.WIN_PCT`, der Auflöser
in `d1UpdateOutcomes`, `d1TwinFor`, `patternLab`) — bei einem Lernhorizont von
180 Minuten. Die wirtschaftliche Schwelle folgt aber aus den eigenen
Kostenkonstanten der App: 10.000 € Einsatz, 2 × 11,50 € Gebühr, 0,15 % Reibung,
27,5 % KESt → **2,04 % Zielweite für 120 € netto**.

Ein Setup, das zuverlässig +2,5 % liefert — genau das erklärte Ziel des Nutzers
— galt damit überall in dieser App als **Misserfolg**. Die Lernschicht hat die
seltenen volatilen Ausreißer belohnt und die tragfähigen Setups verworfen.

Das ist der **dritte Fall desselben Musters**: v3.8.0 falsches Universum,
v3.16.0 falsches Gate, jetzt falsche Zielscheibe. Regel daraus: bei jeder
Kennzahl, die über Erfolg entscheidet, zuerst prüfen, ob sie dasselbe misst wie
das erklärte Ziel des Nutzers. Nicht, ob sie plausibel gewählt ist.

### Befund 2 — der Stop war nie frei wählbar

Bei Ziel 2,04 %: Stop −2,0 % → 238 € Verlust → **66,5 % Trefferquote nötig**.
Stop −1,0 % → 138 € → 53,5 %. Die Asymmetrie kommt aus KESt auf Gewinne bei
vollen Kosten auf Verluste. `MIN_REWARD_RISK_FIXED = 2.0` stand seit v3.9.0 im
Client — die Konsequenz („Stop höchstens 1,02 %") stand nirgends. In `topPicks`
wird der Stop jetzt aus dem Ziel **abgeleitet**, ein Nutzerwunsch kann ihn nur
verengen, nie erweitern.

### Was neu ist

- `PICK` / `pickCosts` / `netEurAtMove` / `lossEurAtStop` / `requiredMovePct` /
  `wilsonUpper` / `pickOutcome` / `pickExpectancy` / `breakEvenHitRate` /
  `evidenceTier` / `pickTier` / `rankPicks` — reine, testbare Funktionen in
  `src/worker.js`, extrahierbar als zusammenhängender Block.
- `topPicks(env, opts)` + `GET /api/toppicks?netEur=&stopPct=` — **eine** D1-
  Abfrage, danach nur noch Rechnen. Gruppiert nach **Situationstyp**, nicht je
  Symbol: ein Symbol hat nie genug Episoden.
- Spalte `reach_ts` (`migrations/0003_toppicks.sql`, plus Nachzug in
  `ensureD1Schema`), gefüllt bei erster Berührung von `PICK_REACH_PCT = 2.0`.
  **Feste** Referenz, bewusst nicht an die Nutzereinstellung gekoppelt — sonst
  wäre die Zeitreihe nicht über Monate vergleichbar. Nicht rückwirkend füllbar.
- Client: `loadTopPicks` / `renderTopPicks`, Kachel `#topPicks`, 5-Minuten-Takt,
  über `paintPanel` (v3.19.0-Regel).

### Drei Regeln, die NICHT aufgeweicht werden dürfen

1. **Reihenfolge ist nicht aufgezeichnet.** `max_pct` und `min_pct` sind zwei
   unabhängige Extremwerte. Eine Episode, die beides berührt hat, zählt als
   ausgestoppt. Wer das lockert, um die Quoten schöner zu machen, baut genau
   die Selbsttäuschung ein, gegen die die ganze Datei geschrieben ist.
2. **Wilson-Untergrenze für Treffer, -Obergrenze für Stops.** Kleine Stichproben
   dürfen nie gut aussehen.
3. **Fail-closed in der Rangfolge**: belegt-positiv → dünn-positiv → unbelegt →
   belegt-negativ. Fehlende Belege heben nichts nach oben.

### Eine Testschwäche, die ich selbst gefunden habe (Abschnitt 11, siebter Fall)

Negativkontrolle 2 (Wilson-Untergrenze durch Punktschätzung ersetzt) lief beim
ersten Anlauf **durch**. Grund: solange jede Episode entweder Treffer oder Stop
ist, gilt exakt `wilsonLower(h,n) + wilsonUpper(n−h,n) = 1`; die Kürzungsregel
in `pickExpectancy` stellt dieselbe Zahl dann von selbst wieder her. Der Test
konnte den entfernten Schutz gar nicht bemerken. Er läuft jetzt auf einem
Datensatz **mit** ergebnislosen Episoden, wo die Kürzung nicht greift. Der
Hinweis steht als Kommentar im Test.

**Verallgemeinerung für den nächsten Bearbeiter:** wenn zwei Schutzmechanismen
dasselbe Ergebnis erzeugen, prüft ein Test nur ihre Vereinigung, nicht jeden
einzelnen. Für jeden Schutz einen Datensatz suchen, auf dem NUR er greift.

### Bewusst NICHT gemacht

- `ATTR.WIN_PCT = 5` bleibt unverändert. Modul 0, Musterlabor, Twin-Statistik
  und der ChatGPT-Strang hängen daran; eine Änderung würde alle historischen
  Auswertungen unvergleichbar machen. Die neue Kachel stellt die richtige Zahl
  **daneben**. Ob nachgezogen wird, ist eine Nutzerentscheidung.
- Keine feinere Gruppierung (Typ × Sektor, Typ × Tageszeit). Mehr Gruppen bei
  gleicher Datenmenge erzeugen Rauschen, nicht Erkenntnis. Erst wenn ein Typ
  deutlich über 60 Episoden liegt.
- Kein Eingriff in Score, Ampel, Gate oder Freigabe. `buyWeight: 0`, und ein
  Test verbietet dem Modul, `light`, `crv`, `score` oder `buyReady` zu setzen.

---

## 8r. WAS v3.21.0 GEÄNDERT HAT — die Ursachentrennung

**Zusammen mit 8q der wichtigste Teil der Lernschicht. Vor jeder Änderung daran
lesen.**

### Die 5 ist weg

`ATTR.WIN_PCT` und `ATTR.STOP_PCT` werden nicht mehr gesetzt, sondern aus dem
Kostenmodell gerechnet: `ECON_WIN_PCT = 2,04 %`, `ECON_STOP_PCT = −1,02 %`,
`PICK_REACH_PCT = ECON_WIN_PCT`. Die alte Zahl lebt nur noch als
`LEGACY_WIN_PCT` in der Anzeige weiter und steuert nichts.

**Regel:** wer eine Kostenkonstante ändert, ändert damit jede Statistik der App.
Das ist beabsichtigt. Ein Test prüft, dass die ausgeschriebene Konstante und
`requiredMovePct()` dieselbe Zahl ergeben — beide Wege müssen übereinstimmen.

### `mae_pre` — MAE vor MFE

Neue Spalte (`migrations/0004_mae_pre.sql` + Nachzug in `ensureD1Schema`). Sie
hält die schlimmste Gegenbewegung fest, die VOR dem bisherigen Höchststand
ausgehalten werden musste. Aktualisiert wird sie im Auflöser genau dann, wenn
ein neuer Höchststand entsteht.

**Der Denkfehler, der dabei fast passiert wäre:** der erste Entwurf fror den
Wert beim Erreichen der 2-%-Marke ein. Dann wäre er nur für Ziele bis 2 % gültig
gewesen, und jedes größere Ziel hätte auf `min_pct` zurückfallen müssen — also
auf einen Wert, der auch den Rückgang NACH dem Ausstieg enthält. Ein Setup mit
1,8 % Luft und 4,2 % Ertrag wäre so als unhandelbar ausgewiesen worden. Mit
MAE-vor-MFE gilt: um `max_pct` zu erreichen, musste man `mae_pre` aushalten; für
kleinere Ziele ist das eine Obergrenze, also die vorsichtige Richtung.

`pickOutcome` benutzt `mae_pre` und fällt bei fehlendem Wert auf `min_pct`
zurück. **Diese Reihenfolge ist nicht verhandelbar** — umgekehrt wäre sie eine
Beschönigung.

### Die Ursachentrennung (`heatProfile`, `pickVerdict`)

Ein Typ kann aus zwei gegensätzlichen Gründen nichts einbringen:
`bewegt sich nicht weit genug` (anderer Kandidatenkreis nötig) oder
`zu verrauscht fuer diese Positionsgroesse` (anderer Stop/Einstieg). Vorher
waren beide als „EV negativ" ununterscheidbar — das war die eigentliche
Sackgasse. `stopFor80` nennt den Stopabstand, der 80 % der Gewinner gehalten
hätte; liegt er über `maxStopPct`, ist die Bewegung da und nur nicht greifbar.

### `optimizeGrid` — und vier Fallen, die alle real waren

1. **Rundung nach der Suche.** Gesucht mit 1,7999999, geprüft mit 1,80 — an der
   Grenze kippt das Ergebnis. Jetzt `const tR = r2(t), stR = r2(st)` VOR der
   Auswertung. Ein Test besteht darauf.
2. **Verschiedene Rechenarten im Vergleich.** Punktschätzung im Suchteil gegen
   Wilson-Untergrenze im Nachweisteil ließ jedes Paar überangepasst aussehen.
   `drop` wird jetzt aus `evIn` und `evOosPoint` gebildet — beides
   Punktschätzungen. Zum Ranken und Anzeigen dient weiterhin nur `evOos`
   (vorsichtig).
3. **Feste Überanpassungsgrenze.** 40 € schlug bei zwölf Nachweis-Episoden
   ständig aus. Die Grenze wächst jetzt mit dem Stichprobenrauschen
   (`1.5 * seEur`), die feste Zahl bleibt als Untergrenze.
4. **Zu kleiner Nachweisteil.** `GRID.OOS_MIN` von 8 auf 12 — die Rastersuche
   braucht damit rund 40 Episoden, bevor sie überhaupt anläuft.

Ein überangepasstes Paar geht NICHT in `evBest` und damit nicht in die
Rangfolge. Genommen wird der bessere der beiden Pläne (Kostenmodell oder
bestätigte Rastersuche), nicht blind der gesuchte.

### Sechs Negativkontrollen

mae_pre ignorieren · fehlendes mae_pre als 0 · Verrauscht-Erkennung aus ·
Bremse gelöst · Rundung nach hinten · gemischte Rechenarten — alle sechs lassen
die Suite fallen. Protokoll in den Release Notes.

**Verallgemeinerung aus 8q und 8r zusammen:** für jeden Schutzmechanismus einen
Datensatz suchen, auf dem NUR er greift. Zwei Schutzmechanismen, die dasselbe
Ergebnis erzeugen, werden von einem Test nur als Vereinigung geprüft.

### Bewusst NICHT gemacht

- Der Live-`situationScore` mit seinen 14 handgesetzten Koeffizienten wurde
  nicht angefasst. Ihn gegen die Ergebnisse zu testen ist der logische nächste
  Schritt, braucht aber deutlich mehr Episoden — und ist ein Eingriff in die
  Bewertung, nicht in die Auswertung.
- Keine feinere Gruppierung (Typ × Sektor, Typ × Tageszeit): bei der aktuellen
  Datenmenge erzeugt das Rauschen statt Erkenntnis.

---

## 8s. WAS v3.22.0 GEÄNDERT HAT — Ertrag je Zeit statt je Trade

Anlass war die Nutzerfrage: „Ist die Arithmetik so, wie du sie gestalten
würdest, um SCHNELL Geld zu verdienen?" Die ehrliche Antwort war nein.

### Der Befund

Bis v3.21.0 wurde der Erwartungswert **je Trade** optimiert. Gefragt war nach
Ertrag je **Zeit**. Ein Setup mit +40 € dreimal täglich schlägt eines mit +80 €
pro Woche um den Faktor zehn. Die Daten lagen seit v3.0 in D1 und wurden nie
zusammengerechnet.

`tempoOf()` liefert jetzt Gelegenheiten je Handelstag, Euro je Handelstag und
Euro je Stunde Kapitalbindung. `rankPicks` sortiert nach Euro je Handelstag.

**Der Deckel (`TEMPO.MAX_TRADES_PER_DAY = 3`) ist keine Kosmetik.** Ohne ihn
überholt ein häufiger schwacher Typ eine seltene starke Gelegenheit —
rechnerisch richtig, mit einer Position je Trade nicht ausführbar. Ein Test
besteht darauf. Ebenso darauf, dass ein Kandidat ohne Frequenzangabe einen mit
nie überholt: sonst hilft Nichtwissen wieder nach oben.

### Kostenlast — warum kleine Ziele die schlechtesten sind

38 € Fixkosten sind unabhängig von der Zielweite. Bei 1,5 % Ziel braucht es
58,2 % Trefferquote, bei 6 % nur 45,3 %. Die abgeleitete Mindestzielweite von
2,04 % ist damit ein **Boden, kein Wunschwert**. `costLoadPct()` zeigt den
Anteil der Fixkosten am Bruttogewinn.

**Regel:** Wer künftig über die Zielweite nachdenkt, prüft zuerst diese Tabelle.
Kleiner ist nie besser.

### Der dritte Fehler in der Rastersuche (nach Rundung und Schätzart)

Die Suche hat sich in Testläufen NIE durchgesetzt, obwohl sie klar bessere Paare
fand. Ursache: ihr Ergebnis wurde auf dem 30 % großen Nachweisteil geschätzt und
gegen eine Vollstichproben-Schätzung des Kostenmodell-Paars gestellt. Die
schmalere Stichprobe hat eine breitere Wilson-Untergrenze — systematische
Benachteiligung, kein Datenbefund.

Jetzt: **suchen** (ältere 70 %) → **bestätigen** (jüngere 30 %) → **schätzen**
(alle Episoden, `evFull`). Auswählen und Schätzen sind zwei Schritte. Ein
überangepasstes Paar erreicht `evBest` gar nicht. Ein Test hält die Reihenfolge
fest (`overfitLimit` muss VOR `oFull` stehen).

**Verallgemeinerung, jetzt dreimal bestätigt:** Wenn ein Vergleich immer in
dieselbe Richtung ausfällt, liegt es fast nie an den Daten, sondern daran, dass
die beiden Seiten unterschiedlich behandelt werden.

### Oberfläche

- `data-domain="coin"` / `"stock"` + `.domain-band` trennen die Märkte optisch;
  der Farbrand läuft an allen Kacheln des Bereichs mit.
- `TINTABLE_TILES` deckte bis v3.21.0 NUR fünf Elemente der Aktien-Fokuskarte
  ab. Die großen Discovery-Kacheln fehlten — deshalb wirkte die Einstellung, als
  gäbe es sie nicht. Jetzt zehn weitere plus zwei Bereichsfarben.
- **Ein Test prüft für jede färbbare Kachel alle DREI Teile**: Schlüssel in
  `TINTABLE_TILES`, `data-tile` im HTML, Regel im CSS. Fehlt einer, ist die
  Einstellung wirkungslos. Genau das war der Zustand.
- `RESERVED_TINTS` (Ampelfarben) bleibt gesperrt — der Fehler aus v3.14.6 darf
  nicht per Einstellung wiederherstellbar sein.

### Bewusst NICHT gemacht

- **Keine Krypto-Top-Picks.** Die Struktur trüge es, aber die Kostenrechnung ist
  bei Bitpanda Fusion eine andere (Spread statt Fixgebühr). Eine Kopie der
  Aktien-Herleitung wäre falsch; das braucht eine eigene.
- Keine Gruppierung nach Tageszeit — die Datenmenge trägt es noch nicht.
- Der Live-`situationScore` bleibt unangetastet.

---

## 8t. WAS v3.23.0 GEÄNDERT HAT — Kryptoschiene

### Der Grund, warum es keine Kopie sein durfte

Wahrscheinlichkeitsrechnung identisch, **Kostenfunktion strukturell anders**:
Aktien haben eine FIXE Ordergebühr (Kostenanteil fällt mit der Positionsgröße),
Krypto hat gar keine (Kostenanteil konstant). Bei 10.000 € liegen beide
Rundlaufkosten fast gleichauf (0,38 % gegen 0,40 %) — **diese Scheingleichheit
ist die Falle.** Bei 2.500 € sind es 0,86 % gegen 0,40 %.

`PICK_COST.kind = 'fixed'`, `COIN_COST.kind = 'proportional'`. `pickCosts()`
verzweigt danach; alles andere ist gemeinsam.

### Ein Code-Pfad, zwei Modelle

`topPicks(env, {asset})` — nur `baseCost` und `sources` unterscheiden sich.
Client: `PICK_PANEL = {stock:'#topPicks', coin:'#topPicksCoin'}`, ein Renderer.
**Zwei Tests verbieten ausdrücklich ein zweites `topPicksCoin` bzw.
`renderTopPicksCoin`** — dort würden zwei Wahrheiten auseinanderlaufen.

### Fail-closed-Verstoß, vom eigenen Test gefunden

Erster Entwurf prüfte fehlende Kostenangaben mit `Number.isFinite`.
`Number(null)` und `Number('')` sind **0, nicht NaN** → eine fehlende
Spread-Angabe wäre als KOSTENLOS durchgegangen.

**Regel für den nächsten Bearbeiter:** bei jeder Kosten-, Gebühren- oder
Spread-Angabe gilt `Number.isFinite(n) && n > 0`, sonst pessimistischer
Rückfallwert. `Number.isFinite` allein reicht NICHT.
Rückfallwerte: `COIN_SPREAD_UNKNOWN = 0.30`, `COIN_FEE_UNKNOWN = 0.25` —
bewusst teurer als die Standardannahmen.

### Weiteres

- `spreadPct` in `snapshotPayload` (dritte Wiederholung der Lehre nach
  Situationstyp v3.17.0 und Dollarumsatz v3.18.0).
- `persistCoinLive` / `readCoinLive` (`fp_meta` key `coin_live:last`).
- `TEMPO.MAX_TRADES_PER_DAY_COIN = 5` statt 3 — 24/7-Markt, aber ~16 wache
  Stunden. Bewusst niedrig gehalten.
- `#topPicksCoin` im Kryptobereich, färbbar, `data-domain="coin"`.

### Bewusst NICHT gemacht

- Die live gelesene Bitpanda-Gebührenstufe (`runScan` → `/account`) ist noch
  nicht mit der Top-Picks-Auswertung verbunden. Kleiner, sauberer nächster
  Schritt.
- Kein Krypto-Äquivalent zur Sektorlogik (BTC-Dominanz, L1/L2/Meme-Kohorten):
  braucht eine eigene Herleitung, keine Umbenennung der Aktienlogik.
- Keine Sonderbehandlung für Staking/Lending/Tausch in der Steuerrechnung.

---

## 8u. WAS v3.24.0 GEÄNDERT HAT — Boot-Wächter und die Naht

### Anlass

Die Oberfläche stand still: alle Anzeigen auf den STATISCHEN Startwerten aus
`index.html` (`v–`, `--:--`, `Verbinde…`). Also lief `app.js` gar nicht. Der
ausgelieferte Code bootet sauber und ist vollständig — die Ursache lag außerhalb
und war aus einem Bildschirmfoto nicht bestimmbar.

**Die Lehre:** eine App, die lautlos stirbt, sieht aus wie eine App, die nur
wartet. Solange der Ausfall nicht von „lädt noch" unterscheidbar ist, ist jede
Ferndiagnose Raterei.

### Boot-Wächter (`public/index.html`, INLINE)

- 8-Sekunden-Timer, prüft `window.__fpBooted`.
- Sondiert `app.js`, `version.js`, `/api/health` und meldet **HTTP-Status und
  Content-Type**. Erkennt ausdrücklich den häufigsten stillen Totalausfall:
  Server liefert `index.html` statt der Datei → Browser bekommt HTML statt
  JavaScript und meldet nichts.
- Zusätzlich ein `error`-Listener für Abbrüche beim Ausführen.
- **Muss inline und vor `app.js` stehen** — eine externe Datei könnte am selben
  Problem scheitern. Zwei Tests halten beides fest.
- `app.js` setzt `self.__fpBooted = true` als **allerletzte Anweisung**. Ein
  Test prüft, dass es wirklich die letzte ist; sonst würde ein Abbruch
  mittendrin als erfolgreicher Start gelten.

### Notausstieg `?fpreset=1` (ganz oben in `app.js`)

SW abmelden, alle Caches löschen, neu laden. **Nicht** `localStorage.clear()` —
ein Test verbietet es. Muss vor allem anderen stehen: wenn ein kaputter Cache
die App lahmlegt, darf die Rettung nicht hinter dem toten Code liegen.

### Drei Parameterfehler — dieselbe Ursache

`Number(null)` und `Number('')` sind **0, nicht NaN**. `Number.isFinite(Number(x))`
hält einen nicht gesetzten Suchparameter deshalb für eine gültige Null.

- `spreadPct`/`feePct` → Krypto rechnete mit 0,80 % statt 0,40 % Rundlauf.
- `netEur` → Mindestziel fiel von 2,04 % auf 0,38 %, Stop von 1,02 % auf 0,19 %.
  Alles darunter war damit falsch.

Behoben durch **einen** Helfer `posNum(v, fallback)`. Ein Test verbietet
`Number.isFinite(Number(opts.x))` in `topPicks`.

**Regel:** jede Zahl, die von außen kommt, läuft über `posNum`. `Number.isFinite`
allein reicht NICHT. (Dieselbe Regel steht schon in 8t für `pickCosts` — ich
hatte sie dort behoben und hier übersehen. Wer eine solche Regel aufstellt, muss
alle Aufrufstellen durchsehen, nicht nur die, an der es aufgefallen ist.)

### Die Testlücke, die das möglich gemacht hat

42 grüne Suiten haben keinen der drei Fehler gefunden, weil sie
`requiredMovePct` und `pickCosts` **direkt und mit sauberen Zahlen** prüfen.
Die **Naht** zwischen Parameterschicht und Rechnung war nie geprüft.

Suite 43 ruft den ECHTEN Endpunkt auf — ohne Parameter, mit leeren, mit
kaputten. **Für den nächsten Bearbeiter:** Unit-Tests der reinen Funktionen
reichen nicht. Jeder Endpunkt braucht mindestens einen Aufruf ohne jeden
Parameter, der die dokumentierten Standardwerte bestätigt.

---

## 8v. WAS v3.25.0 GEÄNDERT HAT — der Ausfall vom 29.08. und seine Ursache

**Der wichtigste Abschnitt für jeden, der `public/sw.js` anfasst.**

### Ursache

Safari: „Service Worker context closed" / „Failed to load resource". `app.js`
wurde nie ausgeführt, die Oberfläche blieb auf den statischen Startwerten.

Zwei Fehler, beide in v3.19.0 von mir eingebaut:

1. **Der Cache-first-Zweig hatte kein `.catch()`.** Lehnt `caches.match()` ab —
   in Safari genügt Speicherdruck oder ITP-Räumung —, lehnt `respondWith()` ab,
   und für den Browser existiert die Datei dann nicht. Der Network-first-Zweig
   hatte einen `.catch()`, lieferte `index.html` aus, das Grundgerüst erschien —
   deshalb sah der Totalausfall wie „keine Daten" aus.
2. **Hintergrund-Schreibvorgänge lagen nicht in `e.waitUntil()`.** Der Browser
   durfte den Service Worker mitten im Schreiben beenden.

### Die Regel

> **Ein `respondWith` darf NIEMALS ablehnen.** Ein Service Worker sitzt zwischen
> der App und allem, was sie braucht. Jeder unbehandelte Fehler darin nimmt
> nicht eine Datei aus dem Verkehr, sondern die ganze Anwendung.

Jeder Zweig endet in einer Antwort: Netz, Cache oder `lastResort()` (504 mit
lesbarem Text). Nie in einem stillen Nichts. Alle Cache-Schreibvorgänge laufen
über `cachePut(e, req, res)`, das `e.waitUntil()` benutzt.

### Die Testlücke — und warum sie exemplarisch ist

43 grüne Suiten haben den Fehler nicht gefunden, weil sie `sw.js` nur als TEXT
prüfen. **Regex sieht, was da ist, nie was fehlt.** Ein fehlendes `.catch()` ist
per Textprüfung unsichtbar.

`tests/sw-fault.mjs` (via `npm run test:sw`, in `check` eingehängt) baut eine
Service-Worker-Umgebung nach und FÜHRT den echten `sw.js` aus — unter kaputtem
Cache, fehlendem Netz, scheiterndem Schreibvorgang, für Assets und Shell. Die
Kernforderung: es muss IMMER eine Antwort herauskommen.

**Verallgemeinerung für den nächsten Bearbeiter:** Für jede Komponente, die
zwischen der App und ihren Daten sitzt (Service Worker, Netzwerkschicht,
Cache-Schichten), reicht eine Textprüfung nicht. Sie muss unter Störung
ausgeführt werden. Der Fehlerpfad ist dort der wichtige Pfad, nicht der
Erfolgspfad.

### Selbstheilung (`public/app.js`, ganz oben)

Nach 12 s ohne verarbeitete Antwort: Service Worker abmelden, Caches löschen,
neu laden.
- Auslöser ist `self.__fpScanOk` (im Erfolgspfad von `scan()` gesetzt), NICHT
  das bloße Starten von app.js — ein kaputter SW blockiert alles danach.
- Sperrfrist 6 h über `localStorage['fp_sw_healed_at']`. Ohne sie entstünde eine
  Neulade-Schleife, die schlimmer wäre als der Fehler.
- Kein `localStorage.clear()`. Tests halten alle drei Punkte fest.

---

## 8w. WAS v3.26.0 GEÄNDERT HAT — Bereichsordnung

Rein strukturell, keine Rechnung angefasst.

### Zwei Fehler, vom Nutzer benannt

1. **Das AKTIEN-Band lag ZWISCHEN Coin-Liste und `#stocks`.** Technisch „über
   den Aktien", gelesen als Abschluss der Coin-Liste. **Regel: eine Überschrift
   gehört INS Element, das sie überschreibt.** Jetzt erstes Kind von `#stocks`.
2. **Learning, Musterlabor, Modul 0, Lab und Marktmeinung waren Kinder von
   `#stocks`.** Sie werten BEIDE Märkte aus und sind Rückblick. Jetzt ein
   dritter Bereich `#labZone` mit `#bandLab`, hinter Coins und Aktien.

Dritter Fehler, beim Prüfen selbst gefunden: das Krypto-Fokusfenster stand ÜBER
seiner Überschrift, im Aktienbereich darunter. Beide Bereiche sind jetzt gleich
aufgebaut: Band → Fokus → Top Picks → Momentum → …

### Neue Invarianten (Suite 46)

- Die **vollständige Abfolge** im Aktienbereich wird als Positionskette geprüft,
  nicht als Vorhandensein. „Alles da, aber an der falschen Stelle" war genau der
  Fehler.
- Kein Auswertungsteil mehr innerhalb von `#stocks`.
- **`VIEW_SECTIONS` muss der DOM-Reihenfolge folgen.** Sonst springt die
  Markierung beim Scrollen, weil `markActiveSection` von oben nach unten läuft
  und den letzten Treffer nimmt — fühlt sich wie ein Zufall an und überlebt
  deshalb lange.

### Sprungziele

Die drei Bänder haben IDs (`#bandCoin`, `#bandStock`, `#bandLab`) und sind das
erste Sprungziel ihres Reiters. Ein `[data-domain=…]`-Selektor wäre eleganter
gewesen, aber die bestehende Sprungziel-Prüfung versteht nur `#id`, `.class` und
Tagnamen — IDs sind hier der ehrlichere Weg als eine aufgeweichte Prüfung.

### Bänder

`.domain-band` hat viel Luft OBEN, wenig UNTEN. Umgekehrt war es der Fehler.
`.domain-head` ist sticky unter der Kopfleiste — bei zwei Märkten mit
verschiedenen Kostenmodellen ist „wo bin ich gerade" keine Kosmetik.
Dritte Bereichsfarbe `--domain-lab`, neutralgrau, in den Einstellungen änderbar.

---

## 8x. WAS v3.27.0 GEÄNDERT HAT — der Situation-Score wird prüfbar

### Warum dieser Score

Er entscheidet, WELCHE Titel überhaupt in die Kandidatenliste kommen — vor jeder
Kostenrechnung und jeder Rangfolge aus v3.20.0–v3.23.0. Er bestand aus einer
Zahlenkette (24, 16, 14, 12, 45, 12, 8, −4, 7, −3, 0.16, −18, 42), von der keine
Zahl je gegen ein Ergebnis geprüft war. Und die Zutaten wurden nirgends
aufgezeichnet — die Frage war **unbeantwortbar**, nicht nur unbeantwortet.
Vierte Wiederholung der Lehre nach v3.17.0, v3.18.0 und v3.23.0.

### Drei Teile

1. **`SITU_W`** — alle Koeffizienten an einer Stelle, jeder mit seiner
   Behauptung. **Ein Test beweist mit 20.000 Zufallseingaben, dass die
   Umstellung rechnerisch nichts ändert**, und verbietet nackte Zahlen in der
   Formel (sonst wäre die Tabelle Dekoration).
2. **`situParts`** im Snapshot — jeder Term schreibt seinen Punktbeitrag mit.
   Nicht rückwirkend.
3. **`scoreAudit()` / `/api/scoreaudit`** + Kachel `#scoreAudit` im
   Auswertungsbereich.

### Der Denkfehler, den der Testlauf gefunden hat

Der erste Entwurf meldete die **Überdehnung** (−18) als „wirkt verkehrt herum",
obwohl sie korrekt arbeitete. **Das Vorzeichen des Gewichts bestimmt, was
richtig heißt:** ein Abzugsterm SOLL die schlechteren Fälle treffen. Ein
Abzugsterm, der die besseren trifft, ist kaputt — und wäre unentdeckt geblieben.

**Regel:** bei jeder Auswertung, die „gut" und „schlecht" unterscheidet, zuerst
klären, in welche Richtung der geprüfte Mechanismus überhaupt wirken SOLL. Ein
Test verlangt, dass dieselbe Trennschärfe bei Plus- und Abzugsterm zu
entgegengesetzten Urteilen führt.

### Nicht aufweichbar

- **Rauschgrenze mehrfachtestkorrigiert** über `SITU_TERMS.length`. Zehn Terme
  sind zehn Tests; ohne Korrektur ist jeder Zufallstreffer „signifikant".
- **Urteil außerhalb der Stichprobe** (jüngeres Drittel).
- **„nicht bewertbar" ist nicht „neutral"** — und wird gestrichelt dargestellt,
  nicht grau. Grau hieße „geprüft und harmlos".
- **`SITU_W` darf nie automatisch überschrieben werden.** Empfehlen, nicht
  handeln — dieselbe Trennung wie bei Modul 0.

### Testschnitte repariert

Vier Prüfungen schnitten `topPicks` bis zu einem entfernten Kommentar-Anker;
als v3.27.0 ein Modul dazwischenlegte, zog der Schnitt es mit hinein und meldete
einen Fehler in Code, der gar nicht geprüft werden sollte. **`sliceFn(src,
header)` schneidet jetzt genau eine Funktion.** Ein Test, der von der Reihenfolge
der Datei abhängt, schlägt irgendwann falsch an.

### Nächster Schritt

Die **Überschneidung zwischen Termen** wird noch nicht ausgewiesen. Ein Term
kann trennen, weil er dasselbe misst wie ein anderer — Trennschärfe ist keine
Ursache. Das braucht mehr Daten als für die Einzelurteile.

---

## 8y. WAS v3.28.0 GEÄNDERT HAT — Fahrt-Meldung und Handelstagebuch

### `rideNow()` / `/api/ride` — ein Name oder Schweigen

Der schwierige Teil ist das SCHWEIGEN. Eine Kachel, die immer etwas anzeigt,
wird nach zwei Wochen nicht gelesen. Neun Hürden, ALLE müssen erfüllt sein
(`RIDE`-Konstanten). Der Ruhezustand zeigt die knappsten Verfehlungen — eine
Kachel, die nur schweigt, lässt offen ob sie noch lebt.

**Die App hat keine Nachrichtenquelle.** Erkannt wird der FINGERABDRUCK eines
Auslösers (Lücke, Umsatzstoß, Zustandswechsel), nicht der Auslöser. Einziger
harter Beleg: Quartalstermin aus dem Kalender. `noNewsFeed: true` und der
Hinweis in der Anzeige sind testgesichert — das darf nie stillschweigend
weggelassen werden.

### `rideSize()` — größere Position, richtig hergeleitet

**Regel:** größer ist erlaubt, WEIL der Stop enger sitzt — nicht weil das Setup
sich besser anfühlt. Größe folgt aus einem Risikobudget von 2 %, gedeckelt bei
der doppelten Grundposition.

**Der Fehler im ersten Entwurf:** das Budget rechnete nur den Kursverlust. 200 €
Budget ergaben eine Position, deren Stop 252 € gekostet hätte. Kosten sind ein
fester plus ein anteiliger Block:
`N = (budget − fix) / (stop/100 + rate)`. Tests verlangen, dass `riskEur` und
`lossEurAtStop()` übereinstimmen — zwei Zahlen für dasselbe wären ein
Widerspruch in der Anzeige.

### Handelstagebuch (`trades`-Tabelle, `/api/journal`)

**Das größte Loch der App, und es war nie im Code:** sie misst den MARKT, nicht
den HÄNDLER. Jede Lernschicht seit v3.20.0 rechnet mit einem Phantom, das zum
aufgezeichneten Preis kauft und exakt am Ziel verkauft. Bei 1,02 % Stopweite
sind 0,2 % Ausführungsabweichung ein Fünftel des Budgets.

`journalRow()` und `journalSummary()` sind reine Funktionen und getestet.
Vier Zustände: geplant · offen · abgeschlossen · übersprungen. Übersprungene
zählen NICHT in die Bilanz der ausgeführten — ein übersprungener Trade ist eine
Information, kein Fehler. Ohne Ist-Kurse wird nichts erfunden.

**Keine Bewertung, keine Note.** Ein Tagebuch, das seinen Führer belehrt, wird
nicht geführt.

### FÜNFTES Mal `Number(null) === 0`

Ein fehlender Spread wäre in `rideCheck` als 0 % durchgegangen — als
bestmöglicher Wert, an der Hürde, die vor unhandelbaren Titeln schützt.
Nach `pickCosts` (v3.23.0) und drei Endpunkt-Parametern (v3.24.0) der fünfte
Fall.

**Gefunden wurde er nur, weil der Test „unbekannter Wert darf nicht durchgehen"
für JEDES Feld einzeln geschrieben war, statt nur für den Idealfall.** Das ist
die eigentliche Lehre: Tests für den Erfolgspfad finden diese Klasse nie.

`rideCheck` benutzt jetzt `feld()`; nirgends mehr `Number(x)` direkt auf
Eingaben.

### Nächste Schritte, in dieser Reihenfolge

1. **Tageszeit-Konditionierung** — die erste halbe Stunde verhält sich anders
   als der Mittag. Billig, sobald Daten da sind.
2. **Verpasste Gelegenheiten aufzeichnen** — eine App, die nie feuert, sieht in
   jeder Statistik großartig aus.
3. **Größe nach Beleglage** — erst wenn mehrere Situationstypen belastbare
   Urteile haben. Vorher wäre es Überanpassung mit Echtgeld.

---

## 8z · v3.29.0 — DIE VORABEND-LISTE, und drei blinde Tests

### Ausgangslage
Der Block war beim Übernehmen bereits vollständig in `src/worker.js` integriert
(16 Funktionen, `/api/evening` am Router) und `public/app.js` hatte Renderer,
Glossartexte und Aufrufer. **Fertig war er nicht.** Der Testlauf brach bei
Suite 11 ab.

### Was rot war und warum es rot war
1. **`GLOSS_LABEL` fehlten alle fünf Vorabend-Überschriften.** Die Texte standen
   in `GLOSS`, die Gruppierung in `GLOSS_GROUPS` — nur die Überschriften nicht.
2. **`#eveningList` und `#eveStudy` gab es im Markup nicht.** Beide standen in
   `VIEW_SECTIONS`; ein Klick im Menü hätte nichts getan.
3. **Es gab keine einzige CSS-Regel für die Schicht.** 17 erzeugte Klassen,
   null Regeln.

Punkte 2 und 3 sind der **vierte Fall** der Klasse „korrekt berechnet, aber
nicht ablesbar" (nach Modul-0-Schalter, Fußleiste, Wächter-Spalte).

### Die eigentliche Lücke: es gab keine Suite für die neue Schicht
Die 46 grünen Suiten prüften die Vorabend-Liste nur über Glossar und
Erreichbarkeit — also ob Begriffe erklärt sind und Container existieren.
**Über die Geometrie sagte davon nichts etwas.** Ein Setup-Filter, dessen Hürden
nie an einem Gegenbeispiel gemessen wurden, ist eine Liste, die immer etwas
ausgibt.

Neu ist `v3.29.0 evening-list geometry/study`. Jede Hürde hat ein **Paar**:
einen Fall, der durchgeht, und einen, der genau an ihr scheitert. Dazu eine
**Positivkontrolle** — ohne sie ist jeder Negativtest wertlos, weil ein Filter,
der alles aussortiert, jeden davon besteht.

Aus `_dev_eve.mjs` und `_dev_fix2.mjs` wurden `tests/eve-harness.mjs` und
`tests/eve-fixtures.mjs`. `_dev_fix.mjs` war überholt und ist gelöscht.

### DIE WICHTIGSTE LEHRE DIESER VERSION
**Eine Suite, die beim ersten Lauf grün ist, ist verdächtig — nicht fertig.**
Ich habe fünf Sabotageproben gefahren (Stopbudget, Restweg, fallendes Messer,
Mindestfallzahl, Nullwert-Abwehr) und jedes Mal geprüft, ob der Test anschlägt.
**Vier von fünf schlugen an. Einer nicht.**

Der blinde war ausgerechnet die `Number(null)`-Falle — Regel 2 dieses Projekts.
Der Grund ist lehrreich: mein Test setzte `volume: null`, aber im Code steht
`evePos(x.volume ?? x.v)`. Der `??`-Operator fängt `null` ab, bevor die
Schutzbedingung überhaupt erreicht wird. **Die echte Falle ist die 0**, nicht
`null` — genau das, was der Codekommentar sagt („Umsatz 0 heisst keine Angabe").
Mit `volume: 0` schlägt der Test an.

> **Merksatz:** Ein Test gegen eine Fehlerklasse muss den Wert benutzen, der die
> Abwehr tatsächlich erreicht. Sonst prüft er einen Schutz, der weiter vorne
> schon greift, und bescheinigt Sicherheit für eine Lücke, die offen ist.

### Ein Altfehler, den der verschärfte Test fand
Die Kachel-Prüfung lief über eine **handgepflegte Liste**, während die Variable
`tintKeys` mit allen registrierten Schlüsseln berechnet und **nie benutzt**
wurde. Jede später hinzugefügte Kachel war ungeprüft.

Beim Umstellen fiel `[data-tile="ride"]{--x:0}` auf — eine Platzhalterregel aus
v3.28.0, die den alten Test erfüllte (der Name kam im CSS vor) und den Kachelton
nie las. **Der Farbregler für die Ride-Kachel war eine Version lang ohne
Wirkung.**

Das neue Kriterium: nicht „kommt der Name vor", sondern **„wird `var(--tint-…)`
von einer Regel gelesen"**. Beim Beheben habe ich denselben Fehler fast
wiederholt und auf eine Klasse `.ride-card` gezielt, die es nicht gibt — der
Test wäre grün geblieben. Erst die Gegenprobe im Markup zeigte `.ride-hit` und
`.ride-quiet`.

> **Merksatz:** Wenn ein Test durch das Vorkommen einer Zeichenkette erfüllt
> wird, prüft er Schreibweise, nicht Wirkung.

### Was v3.29.0 NICHT kann
- **Die Liste ist nie gegen echte Kursdaten gelaufen.** Alle Nachweise stammen
  aus konstruierten Tagesbalken. Trefferzahl je Abend: unbekannt.
- **Die Ereignisstudie hat kein Urteil** und zeigt „nicht bewertbar", bis echte
  Daten da sind. Beabsichtigt.
- **Kostenrahmen ungeprüft:** ein Abruf je Titel, max. 40 je Lauf, 6 h Cache.

### NÄCHSTER SCHRITT
Einen **echten Abendlauf** gegen den Tiingo-Schlüssel fahren und drei Fragen
beantworten: Wie viele Kandidaten kommen? Liegt die Zahl bei 5–15? Und laufen
die 40 Abrufe im Tarif angenehm durch? Erst danach lohnt Feinarbeit an den
Schwellen — vorher wäre jede Änderung an `EVE` eine Anpassung an konstruierte
Balken.

---

## 8aa · v3.29.1 — der erste echte Lauf, und warum er nichts lieferte

Der Nutzer hat v3.29.0 ausgerollt. Deploy sauber, alle Stempel 3.29.0, die
Kachel erschien. Geliefert hat sie nichts. **Drei Ursachen, alle meine.**

### 1 · Das Datum wurde nie angefordert (der eigentliche Ausfall)
`eveDailyBars()` rief Tiingo mit `columns=open,high,low,close,volume` auf.
Tiingo liefert das Datum **nur mit, solange `columns` gar nicht gesetzt ist**;
sobald die Liste steht, kommt ausschliesslich das Angeforderte. `eveBars()`
verwarf daraufhin voellig korrekt jeden einzelnen Balken.

Ergebnis beim Nutzer: **40 Titel abgerufen, 0 verwertbar, kein einziger
Fehler** — technisch hatte ja alles geklappt. Behoben durch `columns=date,…`.

> **Merksatz:** Wenn eine Feldliste an eine fremde API geht, muss der
> Schluessel, an dem die eigene Validierung haengt, ausdruecklich drinstehen.
> Eine API, die per Voreinstellung mehr liefert, liefert es nicht mehr, sobald
> man auswaehlt.

### 2 · Der Ausfall wurde als Normalfall gemeldet
Die Meldung lautete bei NULL geprueften Titeln: „0 Titel gepruefte Tagesbalken,
kein Kandidat erfuellt alle Huerden. Bei einem Stopbudget von 1,91 % ist das der
Normalfall." Das ist beruhigend formuliert und beschreibt einen Totalausfall.
`failedFetch` wurde gezaehlt und nirgends angezeigt.

Neu: `dataOk`, `thinBars`, `firstError` im Ergebnis; bei `barsOk === 0` heisst
die Meldung **AUSFALL** und nennt die Zahl der Fehlabrufe samt erster
Fehlermeldung. Die Anzeige faerbt sie rot.

> **Merksatz:** Fail-closed gilt auch fuer SAETZE. Ein Satz, der bei einem
> Ausfall dasselbe sagt wie bei einem leeren Ergebnis, ist eine Falschaussage.

### 3 · Ich habe eine CSS-Klasse am Namen gelesen statt im Markup
`.eve-bar` klang nach Fortschrittsbalken. Ich gab ihr `height:6px;
overflow:hidden`. Tatsaechlich enthaelt sie die Kennzahlenzeile **und den
"neu rechnen"-Knopf**. Beides war auf sechs Pixel gestutzt — der Nutzer sah
eine abgeschnittene Zeile und keinen Knopf.

**Das ist derselbe Fehler wie `.ride-card` in 8z, im selben Lauf, eine Stunde
spaeter.** Ich habe die Lehre aufgeschrieben und mich nicht daran gehalten.

> **Regel, ab jetzt ohne Ausnahme:** Vor JEDER neuen CSS-Regel erst
> `grep -o 'class="…"' public/app.js` fuer den Block, dann schreiben. Der
> Klassenname ist kein Hinweis auf den Inhalt.

Ausserdem: `.eve-quiet` war `display:block`, wodurch die Meldung als eine Zeile
zusammenlief („…fuer morgen.0 Titel gepruefte…"). Jetzt Flex-Spalte.

### 4 · Kachelfarbe wirkte nur auf den Rand
Die Flaeche wurde mit `color-mix(… 8%, var(--panel))` gemischt — zu wenig, um
sichtbar zu sein. Auf 20 % angehoben. Die Mechanik war korrekt, nur unsichtbar.

### NEUE TESTS (in der v3.29.0-Suite)
- `columns=date,` muss in `eveDailyBars` stehen; und ein Balken ohne Datum muss
  von `eveBars()` verworfen werden (beide Seiten, nicht nur die Zeichenkette).
- `dataOk` muss existieren, und bei `barsOk === 0` muss „AUSFALL" fallen.
- `.eve-bar` darf **keine feste Hoehe und kein `overflow:hidden`** haben, und
  braucht eine Regel fuer den enthaltenen Knopf.

---

## OFFENER RUECKSTAND (Stand v3.29.2)

Was hier steht, ueberlebt jeden neuen Chat. Was nur im Chat gesagt wurde, ist weg.

| Nr | Thema | Stand |
|----|-------|-------|
| R1 | **Skope-Fenster im Coins-Bereich zuerst zeigen** — gemeint ist das Fenster, in dem ALLES ueber einen Coin steht. Steht derzeit zuletzt, soll oben stehen (wie bei Aktien der Fokus). Vom Nutzer schon vor v3.9.0 gefordert. | offen, jetzt eindeutig |
| R2 | **Farbpinsel je Kachel** — kleiner Knopf IN jeder Kachel statt zentraler Liste. Braucht Knopf-Injektion in `paintPanel()`, Popover, Persistenz ueber `--tint-…`. | offen, eigene Version |
| R3 | 90-Sekunden-Frischesperre | Entscheidung Nutzer offen |
| R4 | Nachrichtenzeile — Testaufruf gegen Tiingo-Schluessel noetig | offen |
| R5 | **Erster echter Abendlauf mit Kandidaten** | offen, siehe 8ab |
| R6 | **Lab-/Auswertungsmethoden auch fuer Coins** — Musterlabor, Score-Audit, Selbstauswertung, Ereignisstudie laufen bisher nur auf Aktien. Der Nutzer handelt aber Coins mit. GROSS: betrifft mehrere Auswertungen und deren Datenpfade. | offen, mehrere Versionen |
| R7 | Vorabend-Liste fuer Coins (folgt aus R6, aber eigener Datenpfad) | offen |

### ARBEITSREGEL ZUR GROESSE EINES LAUFS
Drei bis fuenf zusammenhaengende Themen je Lauf, mit Test nach jedem Schritt.
Alles Weitere gehoert in diese Tabelle, NICHT in den Chatverlauf. Wenn der
Nutzer etwas nennt, das nicht sofort dran ist: **hier eintragen, nicht
bestaetigen und vergessen.**

---

## 8ab · v3.29.2 — das eigentliche Hindernis: das Stundenlimit

Der zweite echte Lauf (v3.29.1) zeigte dank der ehrlichen Meldung sofort die
Ursache: **`Tiingo Rate-Limit (429)`, 40 von 40 Abrufen.**

Der kostenlose Tiingo-Zugang erlaubt rund **50 Symbole pro Stunde**, geteilt mit
allem, was die App ohnehin abfragt (im Screenshot: 32 API-Unterabfragen im
laufenden Scan). Ein Vorabend-Lauf mit 40 Titeln kann unter diesen Bedingungen
NIE funktionieren — nicht gelegentlich, sondern nie.

**Der Denkfehler war die Annahme, ein Lauf muesse vollstaendig sein.** Muss er
nicht. Tagesbalken aendern sich einmal taeglich.

Umgebaut auf drei Dinge:
1. **`eveReadBars` / `eveWriteBars`** — Tagesbalken je Titel getrennt vom
   Gesamtergebnis gespeichert. Ergebnis veraltet nach 6 h, **Balken erst nach
   20 h**. Ohne diese Trennung kostet jeder Lauf wieder das volle Kontingent.
2. **`FETCH_BUDGET: 6`** — ein Lauf holt hoechstens sechs NEUE Titel. Die Liste
   baut sich ueber mehrere Laeufe auf, statt in einem Zug zu scheitern.
3. **Harter Abbruch bei 429** — nach dem ersten Rate-Limit geht kein weiterer
   Abruf raus. Jeder weitere verlaengert nur das gesperrte Fenster.

Dazu getrennt: **Aufbauphase ist kein Ausfall.** Solange nur das Budget fehlt
und kein Abruf gescheitert ist, meldet die App einen Zwischenstand, keinen
Fehler. Nur echte Fehlabrufe sind rot.

> **Merksatz:** Bevor eine Schicht gebaut wird, die N Fremdabrufe braucht, erst
> pruefen, wie viele der Tarif in dem Zeitfenster ueberhaupt hergibt. Ich habe
> `MAX_SYMBOLS: 40` gesetzt, ohne diese Zahl je gegen das Kontingent zu halten.

### NAECHSTER SCHRITT
Nach dem Ausrollen mehrmals „neu rechnen" druecken (mit ein paar Minuten
Abstand). Erwartetes Verhalten: die Zahl „x von 40 Titeln mit Tagesbalken"
steigt Lauf fuer Lauf um bis zu sechs. Sobald sie stabil ueber ~20 liegt, ist
die Liste erstmals aussagefaehig.
