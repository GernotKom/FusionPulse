# FusionPulse v3.6.2 · Hotfix: Heatmap-Beschriftung

## Was schiefging
Mein Fix in 3.6.1 hat die Quadranten-Labels korrekt gemacht, aber unlesbar. Die alten Bezeichnungen waren kurz und mittig ueber dem Quadranten gesetzt — das war gestalterisch die bessere Loesung. Ich habe sie durch lange, randbuendige Einzeiler ersetzt („MUSTER SCHWACH · SCHWER HANDELBAR"), die ineinanderliefen und die Punkte ueberlagerten. Im Screenshot stand am unteren Rand „MUSMUSTERSCHWACHHZSCHWER HANDELBAR". Das war ein Rueckschritt in der Bedienbarkeit, um eine inhaltliche Korrektur zu erkaufen — beides zusammen geht.

## Der Hotfix
- **Zurueck zur bewaehrten Geometrie**: mittig ueber dem Quadranten (x=151 bzw. 49), nicht randbuendig.
- **Zweizeilig statt lang**: Zeile 1 `MUSTER STARK` / `MUSTER SCHWACH` in Versalien, Zeile 2 `gut handelbar` / `schwer handelbar` kleiner und gedaempft. Beide Zeilen bleiben deutlich unter der halben Kartenbreite, koennen also nicht mehr kollidieren.
- **Halo gegen die Punkte**: Kontur in Hintergrundfarbe, damit die Beschriftung auch unter dichten Punktwolken lesbar bleibt.
- **Farbige Quadranten wiederhergestellt**, inklusive des vierten Feldes, das der Krypto-Karte bisher ganz fehlte. Die Krypto-Karte hatte auch keine Label-Formatierung — die ist jetzt da.

## Die inhaltliche Korrektur bleibt
Die ausfuehrliche Erklaerung ist nicht verlorengegangen, sie steht jetzt dort, wo Platz ist: im Mouseover der Karte selbst.

> Beide Achsen messen nur Technik. Ob sich ein Trade wirtschaftlich lohnt, steht NICHT in der Position, sondern in der Farbe: voller Punkt = auch wirtschaftlich tragfaehig, hohler Punkt mit gestricheltem Ring = gutes Muster, aber der Plan bringt zu wenig.

Auch die Achsenbeschriftung ist praeziser: „Musterqualitaet ↑" statt „Qualitaet ↑".

## Test angepasst
Der 3.6.1-Test pruefte die zusammengesetzten Langstrings. Er prueft jetzt das Zeilenpaar — und zusaetzlich eine **Laengengrenze** (Zeile 1 max. 16, Zeile 2 max. 17 Zeichen), damit genau dieser Fehler nicht wiederkommen kann. Ausserdem wird geprueft, dass jeder der vier Quadranten in **beiden** Karten genau einmal beschriftet ist.

Alle 11 Suiten gruen, SHA-Bloecke identisch.

---

# FusionPulse v3.6.1 · Krypto-Konsistenz, ehrliche Heatmap, Crowd-Diagnose, sichtbares Glossar

## 1. Warum heute alles „stark und attraktiv" war und trotzdem nichts brachte
Berechtigte Beobachtung — und derselbe Fehler wie bei SOFI, nur zum dritten Mal an anderer Stelle.

Die Heatmap hat **zwei Achsen, und beide messen Technik**: Musterqualitaet nach oben, Ausfuehrbarkeit nach rechts. Wirtschaftlichkeit — CRV, Netto-Potenzial, Kursweg — steckt in **keiner von beiden**. Das Feld oben rechts hiess trotzdem „STARK · ATTRAKTIV". Diese Beschriftung hat etwas behauptet, das die Karte gar nicht messen kann.

Behoben:
- Quadranten heissen jetzt, was sie sind: **MUSTER STARK · GUT HANDELBAR** statt „STARK · ATTRAKTIV". Kein Wort mehr, das nach Ertrag klingt.
- Die **Punktfarbe folgt der Kopfbewertung** statt allein `r.light`. Ein technisch starker, wirtschaftlich schwacher Titel leuchtet nicht mehr gruen.
- Punkte mit gutem Muster, aber unwirtschaftlichem Plan werden **hohl gezeichnet** (gestrichelter Ring). Voll = auch wirtschaftlich tragfaehig.
- Der Mouseover nennt jetzt **Plan netto und CRV** und sagt ausdruecklich: beide Achsen messen nur Technik, ob sich der Trade lohnt steht in der Farbe.

Der alte Test bestand auf den irrefuehrenden Labels. Er wurde bewusst ersetzt, mit Begruendung im Testcode — plus einem Guard, der verhindert, dass „ATTRAKTIV" zurueckkehrt.

## 2. Krypto: P2b erledigt
`coinHeadline(r)` gebaut, dieselbe Mechanik wie bei Aktien: dieselbe Fail-closed-Klemme, kann nur abwerten. Die Krypto-Karte faerbte Punkte bisher allein nach `r.light`, waehrend `buyReady()` die echte Freigabe prueft. Jetzt konsistent, mit drei benannten Gruenden: **CRV zu niedrig**, **nicht in der Einstiegszone**, **keine Kauf-Freigabe**.

Die Krypto-Karte hat ausserdem die Quadranten-Beschriftung der Aktien-Heatmap bekommen — inklusive des bisher fehlenden vierten Feldes.

## 3. Crowd-Tacho: warum er nie ausgeschlagen hat
**Kein Defekt, sondern ein fehlender Schluessel — schlecht kommuniziert.** `crowdPulse()` im Worker steigt ohne `SERPAPI_KEY` sofort aus und liefert fuer jedes Symbol `score:null`. Der Client blendet dann die Nadel aus. Der Grund stand ausschliesslich im Mouseover.

Jetzt gibt es eine **sichtbare Statuszeile** ueber den Aktien: „Crowd/Search inaktiv – kein SERPAPI-Schluessel hinterlegt", mit der Klarstellung, dass das kein Fehler ist. Und mit der Kostenwahrheit **bevor** man losgeht: SerpAPI ist kostenpflichtig, der Gratis-Tarif liegt bei rund 100 Abfragen im Monat, FusionPulse fragt bis zu 15 Symbole je Lauf ab — fuer Dauerbetrieb reicht das nicht.

**Zweiter Befund, unabhaengig davon:** Der Worker setzte `accel:null` hart in jeder Zeile, waehrend `stockInterpretation()` auf `accel>=8` prueft. Toter Zweig, konnte nie feuern — auch mit gueltigem Schluessel nicht. Die Beschleunigung wird jetzt **clientseitig** aus einer lokalen Verlaufsablage gerechnet (Aenderung je Stunde gegen einen mindestens 45 Minuten alten Referenzpunkt). Ohne Referenzpunkt: `null`, keine erfundene Null.

## 4. Glossar: jetzt auffindbar
Berechtigte Frage — es war bisher **nur** ueber Mouseover erreichbar. Wer nicht weiss, wo eine Erklaerung liegt, findet sie nicht.

In den Einstellungen gibt es jetzt **📖 Glossar · alle Begriffe erklaert**: durchsuchbar, in fuenf Gruppen (Kursmuster, Analyseverfahren, Trade-Bewertung, Selbstauswertung, Portfolio-Risiko), zum Aufklappen. Dieselbe Quelle wie die Mouseover-Texte — kein Duplikat, das auseinanderlaufen kann. Ein Test erzwingt, dass **jeder** Glossareintrag auch in der sichtbaren Liste auftaucht.

## 5. Scope-Fenster: Aktualisierungsfrequenz sichtbar
Neben dem Zeitstempel steht jetzt „↻ ≈ 4,2×/h · engmaschiger als der Rest". Gemessen aus den tatsaechlich beobachteten Aktualisierungen, verglichen mit dem Median aller beobachteten Titel. Unter drei Messpunkten oder bei zu kurzem Beobachtungsfenster steht „Frequenz wird noch gemessen" — es wird bewusst nichts hochgerechnet.

## Kosten
Alles rein clientseitig. **Keine zusaetzlichen Tiingo-, Twelve-Data- oder Cloudflare-Abfragen.** Der einzige Posten, der Geld kostet, waere ein SerpAPI-Schluessel — und der ist optional.

## Nachweis
Ein echter Laufzeitfehler kam beim Testen ans Licht: die Crowd-Beschleunigung nutzte `r1()`, eine **Worker**-Hilfsfunktion, die es im Client gar nicht gibt. Im Browser haette das bei jedem Crowd-Laden eine Exception geworfen. Genau dafuer ist der Harness da, der `app.js` wirklich ausfuehrt statt nur Regex zu pruefen.

Zwei Negativkontrollen gefahren: Krypto-Punktfarbe wieder auf `r.light` zurueckgedreht → Suite faellt. Beschleunigung ohne Referenzpunkt als 0 statt null → Suite faellt.

Alle **11** Suiten gruen, `npm run check` gruen, alle vier SHA-256-Bloecke unabhaengig nachgerechnet und identisch. Kein Score veraendert, keine Schwelle angefasst.

---

# FusionPulse v3.6.0 · Laien-Erklaerungen: ein Glossar statt verstreuter Halbsaetze

## Das Problem
Die App war voller Tooltips — geschrieben fuer jemanden, der die Begriffe schon kennt. „z-Score der juengsten Umsaetze gegen ein disjunktes Basisfenster" erklaert nichts, es uebersetzt Fachjargon in anderen Fachjargon. Und an den neuen Stellen (Modul-0-Schalter, Portfolio-Kachel, Kopfzeile) fehlten sie zum Teil ganz. Wer „RECLAIM" nicht kennt, kann nicht entscheiden, ob er es stummschalten soll.

## Was neu ist: ein zentrales Glossar
`GLOSS` in `public/app.js` — **ein** Ort fuer jede Erklaerung, statt derselbe Begriff an fuenf Stellen in fuenf Varianten. Jeder Eintrag folgt derselben Regel:

1. Erst in normaler Sprache sagen, **was** es ist.
2. Dann sagen, **wozu** es hier dient.
3. Wo es sinnvoll ist: sagen, was es ausdruecklich **nicht** bedeutet.

Der letzte Punkt ist der wichtigste. Beispiele:
- **Squeeze**: sagt, dass eine groessere Bewegung wahrscheinlich wird — die Richtung sagt er NICHT voraus.
- **In-Sample**: auf diesen Daten sieht jede Regel gut aus, sie wurde ja daran gebaut. Die Zahl allein ist wertlos.
- **Erwartungswert**: sagt nicht, dass DIESER Trade gewinnt, sondern dass es sich lohnt, ihn oft zu wiederholen.
- **Kaufsumme**: nicht zu verwechseln mit dem Risiko — das ist nur der Bruchteil bis zum Stop.

Erklaerte Begriffe bekommen eine dezente gepunktete Unterstreichung (`<abbr class="gl">`), damit man sieht, **wo** ueberhaupt eine Erklaerung hinterlegt ist.

## Wo es jetzt greift
- **Modul-0-Schalter**: Der Tooltip sagt nicht mehr nur „stummschalten", sondern erklaert, WAS da geschaltet wird — „Was ist RECLAIM? Der Kurs holt sich eine wichtige Marke zurueck, die er vorher verloren hatte …" plus den Hinweis, dass Stummschalten nicht Loeschen bedeutet.
- **Modul-0-Tabelle**: Alle Spaltenkoepfe (n, In-Sample, Out-of-Sample, Waechter) und die Setup-Namen selbst.
- **Portfolio-Kachel**: Gebunden, Budget, Ausgeschoepft, jeder Sektor-Chip, jede Warnung — inklusive der Erklaerung, warum das echte Risiko hoeher liegt als die Positionsgroesse rechnet.
- **Kopfzeile**: Alle fuenf Bloeckierungsgruende neu formuliert. Statt „Musterqualitaet ok, aber Ausfuehrbarkeit nicht erfuellt" jetzt „Das Kursmuster sieht gut aus, aber die Grenzen, die du dir selbst gesetzt hast, sind nicht erfuellt — sie stehen in den Einstellungen".
- **Ticker-Kuerzel**: SOFI & Co. erklaeren jetzt, dass das Kuerzel nicht boersenuebergreifend eindeutig ist und deshalb der volle Firmenname danebensteht.
- **Analysemethoden in den Einstellungen**: alle neun neu geschrieben. Aus „VWAP: volumengewichteter Durchschnittspreis. Anker fuer Einstiegszone und Regimefilter" wurde „der Durchschnittskurs des Tages, bei dem grosse Umsaetze staerker zaehlen als kleine — also der Preis, den der Markt im Schnitt tatsaechlich bezahlt hat. Liegt der Kurs darueber, sind die Kaeufer im Vorteil."

## Ebenen-Verwechslung noch einmal adressiert
Ueber der Komponentenliste steht jetzt ein Vorspann, der ausdruecklich sagt: **Nicht verwechseln** mit den Schaltern in der Selbstauswertung. Hier schaltest du Messmethoden ab, dort ganze Kursmuster stumm. Das war die Verwirrung aus v3.5.7 — jetzt an beiden Enden erklaert, nicht nur an einem.

## Funktionsnachweis
Die Tests pruefen nicht nur, ob ein Tooltip **existiert** — das waere billig. Sie pruefen, dass Fachbegriffe **aufgeloest** statt wiederholt werden (CRV muss „Chance-Risiko-Verhaeltnis" enthalten, ATR muss „Schwankungsbreite" enthalten), dass jede Erklaerung mindestens 80 Zeichen hat, dass jede Analysemethode mindestens 120 Zeichen bekommt, dass die vier haeufigsten Fehldeutungen explizit adressiert sind, und dass die alten Rohbegriffe („z-Score der", „volatilitaetsnormiert", „Bollinger-Bandbreite") nicht unerklaert zurueckkehren.

Zwei Negativkontrollen gefahren: ein Tooltip, der den Fachbegriff nur wiederholt → Suite faellt. Der Setup-Schalter ohne Bedeutungserklaerung → Suite faellt.

Alle **10** Suiten gruen. Kein Score veraendert, keine Schwelle angefasst, alle vier SHA-256-Bloecke unabhaengig nachgerechnet und identisch.

---

# FusionPulse v3.5.9 · Modul 2: Portfolio-Risiko & Klumpung (Paket B, Teil 1)

## Die Luecke
Jeder einzelne Trade haelt brav 0,75 % Risiko ein. Fuenf gleichzeitig offene Trades halten dann 3,75 % — und wenn vier davon im selben Sektor haengen, ist auch das noch geschoent, weil sie im Stressfall gemeinsam fallen. Bisher hat das nichts in der App zusammengerechnet. Das Einzeltrade-Risiko war eine korrekte Zahl mit einer irrefuehrenden Bedeutung.

## Was neu ist
Eine Kachel im Aktien-Tab (`🧮 Portfolio-Risiko & Klumpung`), die drei Dinge sagt:

1. **Gebundenes Gesamtrisiko** ueber alle erfassten realen Positionen, gegen ein neues, explizit einstellbares **Gesamt-Risikobudget** (Standard 2,25 % = drei parallele Trades). Balken, Prozentwert, und wie viele Trades noch reinpassen.
2. **Klumpung nach Sektor, risikogewichtet** — nicht nach Stueckzahl und nicht nach Kaufsumme, sondern nach dem Risiko, das im Stressfall gleichzeitig schlagend wird. Ab 50 % Anteil und mindestens zwei Positionen: „⚠ X % deines offenen Risikos haengt an einem Faktor".
3. **Was nicht bewertbar ist**, wird ausgewiesen statt geschaetzt. Eine Position, deren Aktie gerade nicht geladen ist, hat keinen bekannten technischen Stop — sie faellt aus der Summe heraus und wird explizit genannt, mit dem Hinweis, dass das echte Risiko damit eher hoeher liegt als angezeigt. Fail-closed statt schoengerechnet.

## Nebenbefund beim Bau: dein Einzeltrade-Risiko ist optimistischer als die Realitaet
Beim Rechnen an echten Fixtures ist aufgefallen: `equity x riskPct` ist **reines Kursrisiko**. Am Stop verlierst du zusaetzlich die Ausfuehrungskosten beider Seiten. Bei 5.000 € und 0,75 % werden aus nominell 37,50 € real eher **63 €** — Faktor 1,69 im getesteten Fall. Ein Budget aus „n × 37,50 €" waere also systematisch zu optimistisch gewesen.

Konsequenz: Die Restkapazitaet wird gegen das **reale** Risiko je Trade gerechnet, und der Aufschlag stammt nicht aus einer Annahme, sondern aus deinen eigenen offenen Positionen. Die Kachel zeigt den Faktor offen an, statt ihn in einer Konstante zu verstecken.

Drei parallele Trades zu je „0,75 %" sprengen ein 2,25-%-Budget deshalb rechnerisch — 157 % Auslastung. Das ist kein Rechenfehler der Kachel, sondern genau der Punkt, den sie sichtbar machen soll.

## Budget-Sperre: optional, und sie kann nur abwerten
Neu in den Einstellungen: **„Budget-Sperre: kein neues BUY bei ausgeschoepftem Gesamtrisiko"**.
- **Standardmaessig AUS.** Ohne sie warnt die Kachel nur und aendert am Verhalten nichts — der ChatGPT-Strang bleibt unberuehrt.
- Eingeschaltet unterdrueckt sie neue BUY-Freigaben (Rueckstufung auf „beobachten", nicht ausblenden), sobald das Budget fuer einen weiteren Trade nicht mehr reicht.
- Sie kann **ausschliesslich abwerten**, nie eine Freigabe erzeugen — dieselbe Mechanik wie beim Stummschalten, im Test ueber alle Ampelzustaende geprueft.
- Bereits offene Positionen sind ausgenommen: die Sperre verhindert Zukauf, blockiert aber niemals einen Ausstieg.
- Die Kopfzeile nennt den Grund: **🟡 Setup ok · Risikobudget ausgeschoepft**, mit den konkreten Zahlen im Tooltip.

## Ehrlichkeitsgrenze (steht so im UI)
„Korrelation" ist hier eine **Sektor-Naeherung**, kein gerechneter Korrelationskoeffizient. Zwei Titel im selben Sektor koennen gegenlaeufig laufen; zwei aus verschiedenen Sektoren koennen am selben Zins- oder Dollarfaktor haengen. Eine echte Preisreihen-Korrelation kostet zusaetzliche Tiingo-Last und ist bewusst noch nicht gebaut — sie steht als offener Punkt, nicht als stillschweigend erledigt.

## Sicherheit
Kein Score veraendert. Keine technische Marke verschoben. Keine bestehende Schwelle angefasst. Alle vier SHA-256-Bloecke des Claude-Modus unabhaengig nachgerechnet und identisch. Alle **9** Testsuiten gruen, `npm run check` gruen.

Zwei Negativkontrollen gefahren: Klumpung nach Stueckzahl statt Risiko gewichtet → Suite faellt. Unbewertbares Risiko geschaetzt statt ausgewiesen → Suite faellt. Die Tests koennen die jeweiligen Fehler also tatsaechlich sehen.

---

# FusionPulse v3.5.8 · P0: Kopfzeile und Wirtschaftlichkeit sagen wieder dasselbe

## Der Befund (SOFI, 26.8., v3.5.6)
Die Fokus-Karte zeigte oben gross **"🟢 Kauf-Setup · Claude"** (Score 8,3, PULLBACK 74/100), waehrend direkt darunter stand: Plan-CRV 1,1:1 "zu niedrig", Weg TP2 nur 1,6 %, Gesamtplan netto 54 € — und die Opportunity-Zeile sagte klar "UNINTERESSANT · nur 54 € – fuer Aufwand/Risiko zu klein".

**Ursache:** Die Kopfzeile las stur `r.light` und `r.verdict`. Beide bewerten ausschliesslich die **Musterqualitaet**. Die wirtschaftliche Pruefung (CRV, Netto-Potenzial, Kursweg) lief voellig getrennt in `stockOpportunity()` und hatte auf die Kopf-Ampel keinerlei Einfluss. Der gruene Punkt hat also nie behauptet, was der Nutzer verstaendlicherweise gelesen hat — aber genau das ist der Fehler: eine Anzeige, die man falsch lesen MUSS, ist eine falsche Anzeige. Sie verfuehrt zu einem Trade, den das System selbst im Kleingedruckten ablehnt.

## Der Fix
Neu ist `stockHeadline(r)` — eine **reine Anzeigefunktion**, die Musterqualitaet, Freigabe-Status und wirtschaftliche Bewertung zu EINER Aussage zusammenfuehrt. Statt "🟢 Kauf-Setup · Claude" steht im SOFI-Fall jetzt:

> **🟡 Setup ok · wirtschaftlich uninteressant · Claude**
> (Tooltip: "Das technische Muster ist in Ordnung, der Trade lohnt sich wirtschaftlich aber nicht. Plan-CRV 1,1:1 liegt unter 1,6:1. Technische Marken werden dafuer NICHT verschoben.")

Die Kopfzeile unterscheidet jetzt fuenf Gruende: `economic` (CRV/Netto/Kursweg), `data` (nicht live), `phase` (ausserhalb Handelsfenster), `executability`, `quality`. Der Grundtyp kommt aus `stockOpportunity().blockKind` — **eine** Wahrheitsquelle, keine zweite Schwellenlogik.

Umgestellt sind alle drei Anzeigestellen: Fokus-Karte, Aktienzeile und Peek-Karte. Die Farbe folgt mit (gruener Rahmen/gruene Schrift verschwinden bei Abwertung).

## Was ausdruecklich NICHT passiert ist
- **Kein Score veraendert.** Die Musterbewertung bleibt gruen — sie ist ja korrekt.
- **Keine technische Marke verschoben.** Entry/Stop/TP1/TP2 sind unangetastet (Invariante 4). Der Trade wird nicht "passend gerechnet", er wird ehrlich als unattraktiv beschrieben.
- **Keine Schwelle veraendert.** Weder Claude- noch FusionPulse-Gates wurden angefasst.
- **Alle vier SHA-256-Bloecke unabhaengig nachgeprueft und identisch.**

## Fail-closed strukturell erzwungen
`HEADLINE_RANK` + eine Klemme in `stockHeadline` sorgen dafuer, dass die Kopfzeile gegenueber `r.light` nur **abwerten**, niemals aufwerten kann. Ein gelbes oder rotes Muster kann durch keinen Pfad eine gruene Kopfzeile bekommen (Invariante 1). Das ist im Test ueber alle drei Ampelzustaende geprueft.

Zusaetzlich: ein ueber Modul 0 **gestummtes** Setup zeigt im Kopf jetzt "🔇 Setup stummgeschaltet · kein BUY" statt weiterhin "Kauf-Setup" — derselbe Widerspruch, nur eine Ebene tiefer.

## P2 · Modul 0 bekommt echte Schalter
- Jede Setup-Zeile hat statt des Textlinks einen **Schieberegler**: rechts/gruen = aktiv, links/grau = gestummt. Zustand und Aktion in einem Element, und jetzt fuer **jede** Zeile — nicht mehr nur bei Abschalt-Empfehlung.
- Die 🔔 Wiedereinschalt-Empfehlung hat einen eigenen Direktbutton ("▶ reaktivieren"), man muss nicht mehr die Tabelle suchen.
- Neue Klarstellung im UI: Der Schalter betrifft **Setup-Typen** (Pullback, Reclaim, Breakout …), **nicht** die Analyse-Komponenten (VWAP, EMA21, MTF …) in den Einstellungen. Beide Ebenen bleiben getrennt — das war korrekt so, aber nicht kommuniziert.

## Funktionsnachweis (kein Regex-Versprechen)
Neu ist `tests/client-harness.mjs`: `public/app.js` wird in einer VM mit gestubbten Browser-APIs **wirklich ausgefuehrt**. Die neue 8. Testsuite baut den SOFI-Fall numerisch nach (Entry 25,00 / Stop 24,90 / TP1 25,20 / TP2 25,40 bei 5.000 € Kapital und 0,75 % Risiko → Plan-CRV 1,16:1, Weg TP2 1,6 %, Gesamtplan netto 54 €) und prueft die Kopfzeile am laufenden Code.

Gegenprobe eingebaut: ein wirtschaftlich tragfaehiger Trade (netto 448 €, Plan-CRV 9,6:1) zeigt weiterhin **🟢 BUY**. Negativkontrolle gefahren: mit kuenstlich zurueckgedrehtem Fix faellt die Suite — der Test kann den Fehler also tatsaechlich sehen.

Alle 8 Suiten gruen. `npm run check` gruen.

---

# FusionPulse v3.5.7 · Paket A: Modul 0 wird scharf (Stummschalten + Rehabilitation)

## Was neu ist
Modul 0 war bisher reine Anzeige. Jetzt kannst du seine Abschalt-Empfehlungen tatsaechlich annehmen – aber mit einem entscheidenden Unterschied zum simplen "Loeschen":

**"Abschalten" heisst STUMMSCHALTEN, nicht loeschen.** Ein gestummtes Setup wird nicht mehr als BUY vorgeschlagen (kein gruenes Signal), aber die Auswertung laeuft im Hintergrund weiter – der Cron sammelt jede Minute Snapshots, unabhaengig davon, ob dein PC laeuft. Dadurch kann ein gestummtes Setup, das sich wieder erholt, eine Wiedereinschalt-Empfehlung ausloesen.

## Der Lebenszyklus
1. **Stummschalten:** Button an jeder Abschalt-/Overfit-Empfehlung in der Modul-0-Tabelle. Das Setup bekommt ein 🔇-Badge und erzeugt kein BUY mehr (wird auf "beobachten" zurueckgestuft, nicht ausgeblendet).
2. **Weiterlaufen:** Gestummte Setups bleiben in der Tabelle mit laufender Statistik sichtbar. Der Cron wertet sie weiter aus.
3. **Rehabilitation:** Erholt sich ein gestummtes Setup out-of-sample, erscheint eine 🔔 Wiedereinschalt-Empfehlung mit Reaktivieren-Button.

## Hysterese gegen Flackern (wichtig)
Die Wiedereinschalt-Huerde liegt bewusst HOEHER als die Abschalt-Huerde: Reaktivierung erst ab OOS-Punktschaetzung ≥ 52 % UND Wilson-Untergrenze ≥ 45 % (Abschaltung war < 40 %/< 33 %), mit mindestens 15 neuen OOS-Episoden UND einer Mindest-Stummdauer von 5 Tagen. Ohne diese Hysterese wuerde Stichprobenrauschen das System nervoes zwischen an/aus springen lassen. Im Funktionsnachweis bestaetigt: ein vor 1 Stunde gestummtes Setup ist nicht reaktivierbar (Mindestdauer greift), ein vor 6 Tagen gestummtes mit OOS-Wilson 90 % wird korrekt zur Wiedereinschaltung empfohlen.

## Sicherheit
Die Stummliste liegt serverseitig in D1 (gilt auch bei geschlossener PWA), unterdrueckt nur die BUY-Freigabe und veraendert KEINEN Score. Alle vier SHA-256-Bloecke des Claude-Modus sind nach dem Einbau verifiziert identisch. Neue Routen: /api/attribution/mute.

# FusionPulse v3.5.6 · kumulative VL-Integration

## Neu umgesetzt
- **Aktien-Heatmap deutlich größer** und direkt im Diagramm mit vier verständlichen Quadranten beschriftet: „FRÜH · INTERESSANT“, „STARK · ATTRAKTIV“, „SCHWACH · UNINTERESSANT“, „ÜBERDEHNT · SPÄT“. Die vorhandenen Trails bleiben erhalten.
- **Reale Position im FokusScope:** Kaufkurs in EUR/Tradegate und Stückzahl können nach dem Kauf übernommen und lokal persistent gespeichert werden.
- **Realer Tradeplan:** Investiertes Kapital, unveränderter technischer SL, TP1, TP2, geschätzter €-Verlust am SL, €-Gewinn bei TP1/TP2, unrealisiertes Ergebnis und Netto-CRV aus der realen Ausführung werden sofort berechnet. Technische Marken werden nicht verschoben, nur damit CRV oder Ergebnis besser aussehen.
- **Teilverkauf / Restposition:** Teilverkäufe können in Stück gebucht werden; verbleibende Reststückzahl bleibt sichtbar.
- **Verkaufsüberwachung:** aktive Fokusposition wird bei neuen Daten gegen SL-Gefahr/SL, TP1 und TP2 geprüft. Alarm ist hörbar (wenn Ton aktiviert), grafisch persistent und muss bestätigt werden. Die UI stellt ausdrücklich klar: Warnung/Alarm, keine automatische Verkaufsorder.
- **VL als Pflichtbestandteil:** neue `VL_STATUS_v3.5.6.md` und aktualisierte kumulative `IMPROVEMENT_LIST.md`; keine stillen Auslassungen.
- **Regressionen:** zusätzliche v3.5.6-Guards für Heatmap-Quadranten, Positionspersistenz, reale Berechnung, Teilverkauf und Alarm.

## Erhalten / geschützt
- Claude-Modus methodisch unverändert; bestehende SHA-256-Locks müssen identisch bleiben.
- v3.5.5 Aladdin-Style Market Intelligence bleibt additive Empfehlungsschicht und verändert keinen Claude-/FusionPulse-Score.
- Freshness, FokusScope-Priorität, Einzel-/Global-Refresh, Methodenfeld, Learning/Attribution und wirtschaftliche Gates bleiben bestehen.

## Abnahmehinweis
`npm run check` ist lokal grün. Ein Release gilt trotzdem erst nach dem verpflichtenden **UI-Smoke-Test im deployten System** als vollständig abgenommen (echte Datenzeit, Refresh, Fokusposition/Alarm, Heatmap-Bewegung, Learning/TWIN, Planleiste).

# FusionPulse v3.5.5 · Modul 1: Aladdin-Style Market Intelligence

## Die Idee
Nicht "noch ein Indikator", sondern eine hierarchische Marktmeinung im Geist von BlackRocks Aladdin: mehrere Datenebenen zu einer konsistenten, nachvollziehbaren Entscheidung zusammenfuehren. FusionPulse sagt jetzt nicht nur "diese Aktie hat ein Setup", sondern bildet oberhalb des Radars eine "FusionPulse Market Recommendation":

MARKTLAGE: RISK-ON 72 % · Fuehrung: Semiconductors · Software · Vermeiden: ... · Beste Situation: NVDA (Sektor fuehrt, RVOL 2,4, Strukturraum 4,1 %) · Empfehlung: Long bevorzugen, keine Late-Chases · Marktrisiko: ... · Was wuerde die Meinung aendern: ...

## Architektur (entscheidend)
Der Aladdin-Layer ist ein **eigener Layer, der die Empfehlung speist – er veraendert WEDER den Claude- noch den FusionPulse-Score**. Die Kombination (Setup x Marktpassung x Liquiditaet) passiert in einer separaten, ungelockten Schicht. Grund: So kann Modul 0 Setup-Edge und Markt-Edge **getrennt** auf Erfolg tracken. Verschmolzen waere diese Information fuer immer verloren. Alle vier SHA-256-Bloecke des Claude-Modus sind nach dem Einbau verifiziert identisch.

## Ebenen
- **Regime:** Risk-On / Neutral / Risk-Off mit Wahrscheinlichkeit, aus Breadth (Anteil positiver 1h-Returns), VWAP-Breite und Volumenbestaetigung.
- **Sektor-Rotation:** relative Staerke je Sektor (↑/→/↓) aus 1h-Grundtrend, 15m-Beschleunigung und Volumen. Nur Sektoren mit ≥3 Titeln werden bewertet.
- **Stress-Layer:** atypische Zustaende (erhoehte Median-ATR, hohe Gleichrichtung/Konzentration, weite Spreads).
- **Szenario-Engine:** lineare Was-waere-wenn-Sensitivitaet (Nasdaq -1 %, Renditen +10 bp, BTC -3 %) mit transparenten Beta-Annahmen, ausdruecklich kein Faktormodell.
- **Opportunity-Ranking:** Setup-Qualitaet x Marktpassung x Liquiditaet, mit Late-Chase-Malus und Sektor-Leader-Bonus.

## Ehrlichkeits-Prinzip (wie Modul 0)
Unsere Marktabdeckung ist eine **Stichprobe** (20-40 rotierende Titel), kein Vollmarkt. Jede Ebene weist Datenbasis und Konfidenz aus. Eine Breadth-Aussage aus 22 Titeln wird als Stichprobe etikettiert, nicht als Marktbreite-Index. Im Funktionsnachweis bestaetigt: bei 14 Titeln zeigt der Layer "Risk-On 89 %" ABER Konfidenz nur 16 und markiert die duenne Basis explizit als Marktrisiko. Lieber ehrlich unsicher als selbstsicher falsch.

## Funktionsnachweis
Synthetische Marktzustaende bestaetigen: breite Staerke -> Risk-On, breite Schwaeche -> Risk-Off, zu wenige Titel -> "Unklar" (statt falscher Sicherheit), Late-Chase (viel gelaufen, Tempo raus) wird trotz hohem Setup-Score aus der Spitzenposition verdraengt.

## Neu
Route /api/aladdin · Market-Recommendation-Kachel oberhalb des Aktienradars.

# FusionPulse v3.5.4 · Modul 0: Selbstauswertung & Overfitting-Wächter

## Was neu ist
Erster Baustein des selbst-trackenden Claude-Ökosystems. Die App wertet ab jetzt **ehrlich aus, welche Setups tatsächlich einen Vorteil hatten** – statt es zu behaupten. Sichtbar im Tab „Lab / Learning".

Wichtig: Modul 0 ist eine **reine Auswertungs- und Empfehlungsschicht**. Es verändert weder den Claude-Score noch den FusionPulse-Score noch irgendein BUY-Gate. Es liest ausschließlich bereits aufgelöste Outcomes aus `market_snapshots` (max_pct/min_pct/success_ts) – kein Repainting, keine neue Datenerhebung.

## Der Overfitting-Wächter (das eigentliche Herzstück)
Drei eingebaute Schutzmechanismen gegen Selbstbetrug, weil „die App verbessert sich täglich selbst" ohne diese Wächter garantiert auf Rauschen optimiert:

1. **Mindest-Stichprobe (20 Episoden/Setup):** Darunter gibt es KEIN Urteil, nur „sammelt noch". Kein Algorithmus kann aus 5 Trades Edge von Zufall unterscheiden.
2. **Out-of-Sample-Split (30 %):** Der Edge wird an älteren Trades geschätzt und an den jüngsten, NICHT zum Schätzen benutzten Trades geprüft. Bricht die Trefferquote out-of-sample ein → Overfitting-Flag.
3. **Mehrfachtest-Korrektur (Bonferroni-artig):** Wer viele Setups parallel testet, findet zufällig eines, das gut aussieht. Der Wächter hebt die Schwelle entsprechend an.

Zusätzlich: **Wilson-Untergrenze** statt naiver Trefferquote – „3 von 4" (75 %) wird korrekt als schwache Evidenz behandelt, nicht als starker Edge.

## Kalibrierung gegen False Positives (im Bau selbst gefunden)
Beim Funktionsnachweis fiel auf, dass eine zu strenge Wilson-Schwelle bei kleinen Out-of-Sample-Stichproben **echte Gewinner fälschlich zur Abschaltung empfahl**. Ein Wächter, der gute Setups köpft, ist genauso schädlich wie einer, der schlechte durchlässt. Korrigiert: Abschaltung wird nur empfohlen, wenn (a) Punktschätzung UND Wilson-Untergrenze schwach sind UND (b) mindestens 15 Out-of-Sample-Episoden vorliegen. Sonst „schwach · beobachten" statt vorschneller Abschaltung. Ein synthetischer Beweis mit vier konstruierten Setups (echter Edge / Overfit-Falle / zu-klein / klarer Verlierer) bestätigt jetzt korrekte Einordnung aller vier.

## Empfehlung, nicht Automatik
Der Wächter gibt **Abschalt-Empfehlungen**, schaltet aber nichts selbst ab. Du entscheidest und siehst, warum. Das ist die einzige Version von „selbst-verbessernd", die tatsächlich funktioniert statt sich selbst zu betrügen.

## Unverändert
Claude-Modus (alle vier SHA-256-Blöcke verifiziert identisch), FusionPulse Adaptiv, Deep-Scan-Regler, Tiingo-Kontingent. Neue Route: `/api/attribution`.

# FusionPulse v3.5.3 · Claude-Audit A/B

## Kernfixes
- Claude-Modus methodisch **nicht verändert**; bestehende SHA-256-Locks bleiben grün.
- FusionPulse-Strukturziel nutzt nun ein unabhängiges 36-Bar-Swingfenster statt der kurzen 12-Bar-Triggerreferenz. Dadurch bleibt bei einem echten bereits laufenden Breakout ein belastbarer Projektionsraum vorhanden.
- Breakout/Squeeze: Range-/Impulsprojektion mit nächster 1,618-Erweiterung, falls die erste Projektion schon überlaufen ist; weiterhin maximal 8R und kein künstliches Ziel zur CRV-Rettung.
- Wirtschaftliche Mindestschwelle im normalen FusionPulse-Modus auf das **reale Risikobudget** kalibriert: 20 EUR absolute Basis, 0,75R Standard, maximal 1,0R als wirksame Schwelle. Alter 75-EUR-Default wird auf 30 EUR migriert.
- UI nennt die tatsächlich wirksame risikobudget-basierte Schwelle.

## Tests
`npm run check` muss Syntax, Safety, Claude-SHA-Locks sowie v3.5.3 Target-/Economic-Regressionen bestehen.

---

# FusionPulse v3.5.2 · FusionPulse Adaptiv + Opportunity Lifecycle

## Wichtig: Claude Modus methodisch unverändert
- Die beiden serverseitigen Claude-Bewertungsblöcke für Krypto und Aktien wurden **byte-identisch** aus v3.5.1 übernommen. Auch Claude-Konstanten und Client-Overlay sind unverändert.
- Neue Regressionstests prüfen SHA-256-Locks dieser Blöcke. Eine spätere versehentliche Änderung der Claude-Methodik lässt `npm run check` fehlschlagen.
- Die folgenden Änderungen betreffen den **normalen FusionPulse-Modus** und die gemeinsame Discovery/Priorisierung, nicht die Claude-Bewertungsformeln.

## Kernkorrektur im eigenen Aktienmodus
Der Audit-Befund aus v3.5.0 wurde auf den normalen FusionPulse-Modus übertragen, ohne Claude zu kopieren: Eine Kennzahl darf nicht gegen eine mathematisch andere Auszahlung geprüft werden. Bis v3.5.1 wurde der 50/50-Plan nach Fixkosten gegen die 3:1-CRV-Grenze gehalten, obwohl sein festes TP1/TP2-Schema diese Grenze konstruktiv nicht erreichen konnte.

FusionPulse Adaptiv trennt jetzt drei Ebenen:
1. **Struktur-CRV:** CRV bis zu einem am Chart gemessenen Strukturziel. Dieses CRV muss weiterhin die eingestellte Aktiengrenze erfüllen (standardmäßig 3:1).
2. **50/50-Plan-Effizienz:** Ergebnis des realen Standardplans nach geschätzten Flatex-/Tradegate-Fixkosten und Ausführungsreserve. Eigene Mindestschwelle 0,85:1; sie wird nicht mehr fälschlich als 3:1-Struktur-CRV behandelt.
3. **Wirtschaftliche Relevanz:** mindestens der Nutzerwert, mindestens 75 EUR und zusätzlich mindestens 1,25 % der tatsächlich berechneten Positionsgröße. Bei 10.000 EUR Einsatz sind damit mindestens 125 EUR netto erforderlich. Der alte Default 350 EUR wird einmalig nur dann auf 75 EUR migriert, wenn er noch exakt dem alten Default entspricht.

## Strukturziel statt selbstgebautem Ziel
- Der FusionPulse-Modus verwendet für Aktien kein konstantes TP2-R-Multiple mehr als Freigabegrundlage.
- Reclaim/Pullback zielt zunächst auf das reale vorherige Hoch; Breakout/Squeeze projiziert die tatsächlich gemessene Range bzw. den vorherigen Impuls (Measured Move/Fibonacci).
- Reicht dieser Markt-Strukturraum nicht für das eingestellte Struktur-CRV, bleibt das Setup blockiert. Es wird kein höheres Ziel erfunden, nur damit das Gate passt.
- Überdehnte Titel (>3 ATR über EMA21) bleiben blockiert.

## Elliott-Fix im eigenen Aktienmodus
- `deepRecheckRank()` gewichtete schon länger `r.elliott`, aber `analyseStock()` lieferte bis v3.5.1 bei Aktien gar kein `elliott`-Feld. Der behauptete Elliott-Anteil der Recheck-Priorität war dadurch faktisch immer 0.
- v3.5.2 berechnet im normalen FusionPulse-Aktienmodus eine explizite Elliott/Fibonacci-Struktur aus Impulsbreite, höherem Tief, Trendstaffelung und Nähe zu 0,382/0,5/0,618-Retracements.
- Fehlende Daten verbessern den Wert nicht; Elliott bleibt nur ein Teil der Gesamtanalyse.

## Neue Opportunity-Lifecycle-Logik
Der marktweite Large-Cap-Radar bewertet nicht mehr nur den aktuellen Zustand, sondern auch den **Zustandswechsel gegenüber dem vorherigen Radar-Snapshot**:
- `PREP`: Druck direkt unter dem Trigger, noch ohne Ausbruch.
- `IGNITION`: frischer Wechsel z. B. WATCH/NEAR HIGH -> BREAKOUT PRESSURE/ACCELERATION.
- `CONFIRM`: Bewegung bestätigt sich nach dem Start.
- `LATE`: Kurs bereits stark gelaufen, Geschwindigkeit fällt; wird bewusst abgewertet.
- `WATCH`: noch keine belastbare Situation.

Frische IGNITION-/PREP-Übergänge erhalten in der Deep-Scan-Reife Vorrang; ein später Tagesrunner verliert Rang. Radar/BOATS bleiben weiterhin **0 % direktes BUY-Gewicht**.

## UI / Erklärung
- Normalmodus wird in der Methodenanzeige als **FUSIONPULSE ADAPTIV** gekennzeichnet; Claude weiterhin klar separat.
- FokusScope und Detailansicht trennen **Struktur-CRV** und **Plan-Effizienz** sichtbar.
- Situation-Radar zeigt zusätzlich die Lifecycle-Phase, z. B. `IGNITION · BREAKOUT PRESSURE`.
- BUY-Hinweis erklärt die tatsächlich wirksamen FusionPulse-Gates.

## Nachweis
- Funktionsfixture „frischer Ausbruch nach Impuls + Kompression“ kann im FusionPulse-Modus Grün erreichen und erfüllt dabei Struktur-CRV >= 3:1.
- Stark überdehnte Late-Chase-Fixture bleibt blockiert.
- Ohne Aktienvolumen bleibt FusionPulse fail-closed.
- Claude-Blöcke werden zusätzlich per SHA-256 gegen v3.5.1 verriegelt.
- `npm run check`: muss vor Release vollständig grün sein.

# FusionPulse v3.5.1 · Deep-Scan-Regler & Tiingo-Kontingent

## Neu
- **Regler „Aktien tief scannen (15–40)"** in den Einstellungen. Ersetzt die bisher fest verdrahtete 20er-Grenze im Deep-Scan. Anders als der Krypto-Regler ist dieser Wert **serverseitig in D1 persistiert** (`stock_deep_limit`), weil der Aktien-Deep-Scan über einen Cron läuft, der auch bei geschlossener PWA aktiv bleibt – ein reiner Client-Zustand hätte den Cron nicht erreicht. Alle Warteschlangen-Anteile (Favoriten, Gainer, Radar, Recheck, BOATS, Explore) skalieren proportional zur bisherigen 20er-Baseline mit; die finale Kappung via `.slice(0, deepLimit)` verhindert in jedem Fall eine Überschreitung.
- **Tiingo-Kontingentanzeige** in den Einstellungen. Wichtig zu wissen: Tiingo liefert – anders als Twelve Data – **keine Nutzungs-Header** in der REST-Antwort und **keinen öffentlichen usage-Endpoint**. Es gibt daher keinen Weg, das reale Kontokontingent aus der API selbst auszulesen. Die Anzeige ist deshalb eine **ausdrücklich gekennzeichnete App-Eigenzählung** (`state: 'app-estimate'`): sie zählt nur Requests, die dieser Worker selbst absetzt (nicht das gesamte Tiingo-Konto, z.B. Dashboard-Zugriffe zählen nicht mit), gegen die öffentlich dokumentierten Power-Plan-Grenzwerte (10.000 Requests/Stunde, 100.000/Tag; BOATS teilt sich dasselbe Kontingent als Entitlement ohne eigenes Limit).

## Im Funktionsnachweis gefundener und behobener Bug
Beim Testen des `/api/tiingo/status`-Routings gegen den echten Produktionscode fiel auf: Schlägt der Tiingo-Auth-Check fehl (Netzwerkfehler, Rate-Limit, 429 etc.), fehlten `quota` und `stockDeep` in der Fehlerantwort – **genau dann, wenn die Kontingentanzeige am wichtigsten gewesen wäre**, blieb sie leer. Der catch-Zweig liefert diese Felder jetzt ebenfalls mit. Ein Regressionstest sichert das ab.

## Technischer Nachweis (gegen den echten Worker-Handler, nicht nur Unit-Logik)
- Persistenz-Rundreise über ein simuliertes D1 bestätigt: `stockDeep=33` gesetzt → nächster Aufruf ohne Parameter liefert weiterhin 33.
- Clamping bestätigt: `stockDeep=999` → 40 (Obergrenze), `stockDeep=1` → 15 (Untergrenze).
- Kontingentzählung bestätigt: jeder Tiingo-Call (auch fehlgeschlagene) erhöht `hourCalls`/`dayCalls` korrekt, `hourLimit`/`dayLimit` entsprechen den Power-Plan-Werten.

# FusionPulse v3.5.0 · Claude Modus

## Kernbefund des Audits (warum nie ein BUY erschien)
1. **Aktien, mathematisch unerfüllbar:** Der 50/50-Plan (TP1 = 1,7R, TP2 = 3,35R) hat brutto maximal **2,525R**. Das Gate `planCrvAfterCosts >= 3,0` konnte daher **niemals** erfüllt werden – unabhängig vom Markt.
2. **Aktien, zweites unerfüllbares Gate:** Bei Default-Risikobudget (5.000 € × 0,75 % = 37,50 €) endet der maximale Plan nach Fixkosten (3 × 10,75 €), Friction und 27,5 % KESt bei **~43 € netto**. Gate: ≥ 350 €. Faktor 8 daneben.
3. **Score-Falle:** `score >= 8` bei theoretischem Komponenten-Maximum von 8,74 verlangte ~92 % des Bestwerts gleichzeitig.
4. **Krypto:** `netCRV = (2,2r − c)/(r + c) >= 2,0` erfordert costRatio r/c ≥ **15**; der Code begrenzt den Stop aber auf 2,6 ATR und verlangt nur ≥ 2,5 – bei realen Bitpanda-Kosten praktisch unerreichbar (außer seltene weite Strukturziele), kombiniert mit ~10 weiteren UND-Bedingungen.

## Claude Modus (additiv, Schalter in Einstellungen → Analyseverfahren)
- Serverseitig wird **immer** eine parallele `claude`-Bewertung je Zeile berechnet; der Schalter ist eine reine Client-Umschaltung ohne zusätzliche API-Kosten. Legacy bleibt vollständig erhalten und rückschaltbar (`r.fpBase`-Overlay).
- **Aktien:** TP2 aus Elliott/Fibonacci-**Strukturziel** (gedeckelt 6R) statt konstantem 3,35R; Score rekalibriert inkl. Situation Engine (20 %) und Liquidity Vacuum (12 %); Gates: Score ≥ 7, Netto-CRV ≥ 1,8, RVOL ≥ 1,3, kein WATCH-Zustand, nicht > 3 ATR überdehnt, Kursweg ≥ 3× Kosten.
- **Krypto:** erreichbare, kostenehrliche Gates (Netto-CRV ≥ 1,4, costRatio ≥ 3,2, Qualität ≥ 6,6) statt des unerreichbaren 2,0-CRV.
- **Erwartungswert-Gate** (beide): Drei-Ausgänge-Modell mit Breakeven-Stop nach TP1: EV = p1·0,5·R1 + p1·p2·0,5·R2 − (1−p1)·1 − 1,2·Kosten/R. Aktien ≥ +0,15R, Krypto ≥ +0,10R. p1/p2 sind konservative Heuristik-Startwerte und über D1-Outcomes kalibrierbar.
- **Wirtschaftliche Mindestgröße** skaliert am Risikobudget (Plan netto ≥ max(120 €, 1,2 × Risiko/Trade)) statt fixer 350 €, die das eigene Sizing nie erreichen konnte.
- **Alle Fail-Closed-Regeln bleiben:** ohne Volumen kein Aktien-Grün, ohne Orderbuch kein Coin-Grün, Stale-Daten blocken weiterhin. Neue Regression-Tests sichern das ab.

## Trade-Management-Konvention im Claude Modus
Nach TP1 (50 % Teilverkauf) Stop auf Breakeven ziehen – der EV rechnet exakt mit dieser Regel.

# FusionPulse Release Notes — v3.4.3

## Situation Engine — frühere, bessere Opportunitätenerkennung
- Neuer Large-Cap Situation Radar erkennt frische Zustandswechsel: Opening Drive, Breakout Pressure, Early Acceleration, Reversal/Reclaim, Volumenpuls, Nähe zum Tageshoch und enger werdenden Spread. Ein schon stark gelaufener Titel ohne neue Beschleunigung wird bewusst abgewertet.
- Neue Deep Situation Engine bewertet Breakout Start, Squeeze Release, VWAP-/EMA21-Reclaim, Pullback Hold, 5m-vs-15m-Beschleunigung, RVOL, VWAP-Lage und Overextension.
- `situationScore`, `situationType` und `situationReasons` dienen ausschließlich Discovery, Reihenfolge und Erklärung. Sie erhöhen **nicht** den BUY-Score und umgehen weder Netto-CRV noch Freshness/Marktphase/Sizing.
- Re-Check-Queue und Vorwarn-/Reifeanzeige sehen beginnende Situationen früher, ohne BUY-Schwellen zu lockern.

## Aktien-Freshness / Refresh-Stabilität
- Eigene Freshness-Ampel für Situation Radar, Opening Momentum und Extended Hours: Grün <3 Min., Gelb 3–5 Min., Orange 5–10 Min., Rot ab 10 Min.
- Ampel basiert auf tatsächlich empfangenen Daten, nicht auf dem Zeitpunkt eines Klicks oder gestarteten Requests, und altert automatisch auch ohne neue Antwort.
- Während Premarket/Opening/Regular startet die PWA ab >3 Min. altem Aktien-Snapshot einen gedrosselten echten Recovery-Scan; damit soll ein 10–12-Minuten-Stillstand nicht mehr still toleriert werden.
- Force-Refresh hat längeren Timeout; ein Refresh ohne neue Deep-Daten wird nicht mehr als normaler grüner Erfolg dargestellt.

## Sichtbare Analysemethoden
- Methodenanzeige ist jetzt permanent in der unteren SIGNAL-INFO-Fußleiste sichtbar und zusätzlich direkt im FokusScope.
- Sie zeigt Kernmethoden (Situation Engine, ATR, CRV/Execution, Spread/Liquidität) sowie die aktivierten Komponenten.
- Korrektur zu v3.4.2: Dort existierte zwar ein statischer Methodenbereich am Seitenende, war im tatsächlichen Fokus-Workflow aber nicht dauerhaft sichtbar.

## Safety
- Large-Cap-only automatische Discovery bleibt bestehen.
- Fehlende/schlechtere Daten verbessern kein Setup.
- BUY-/CRV-/Sizing-/Marktphasen-Gates unverändert.
- `npm run check` und erweiterte Safety-Regression bestehen.

---

# FusionPulse Release Notes — v3.4.2

## Refresh, FokusScope und Analyseanzeige
- Einzelaktien-Refresh im FokusScope erzwingt jetzt eine echte Neuanalyse und umgeht den lokalen 5-Minuten-Lookup-Cache.
- Der blaue globale Refresh erzwingt jetzt auch den Aktien-Snapshot statt nur den serverseitigen Cache erneut anzuzeigen; die Fokusaktie wird dabei zuerst aktualisiert.
- Aktive Analysemethoden werden kompakt in der Fußleiste angezeigt und aktualisieren sich mit den Einstellungen.
- FokusScope ist als höchste Daten-/Analysepriorität behandelt; Safety-Gates bleiben unverändert fail-closed.

## Large-Cap-Radar / Flatex-Praxisfilter
- Automatische Aktien-Discovery (Whole-Market Radar) ist jetzt inclusion-only auf eine kuratierte Large-Cap-/hochliquide US-Whitelist begrenzt. Small-/Micro-Caps können nicht mehr automatisch in den Radar gelangen.
- Opening Momentum verwendet denselben Large-Cap-Basiskatalog; dynamische Radar-Kandidaten müssen den Large-Cap-Gate ebenfalls bestehen.
- Common-Stock-/ETF-Sicherheitsfilter bleiben zusätzlich aktiv. Fehlende/unklare Metadaten können keinen Kandidaten freischalten.
- Manuelle Aktiensuche und Favoriten bleiben bewusst getrennt, damit ein vom Nutzer explizit gewünschter Ticker weiterhin aufrufbar ist.
- Trading-/BUY-Regeln, CRV, Sizing, Elliott-Logik und Discovery-Gewichtung (0 % direktes BUY-Gewicht) bleiben unverändert.

# FusionPulse v3.4.1 — P0 Hotfix

## Behoben
- Laufzeitfehler `priceSource is not defined` im Alpaca Opening-/Momentum-Pfad behoben.
- Preisquelle wird deterministisch als `minute`, `trade`, `daily` oder `none` gesetzt.
- Alpaca-Tages-Bar wird im Opening Momentum ausdrücklich als `⚠ Tages-Bar/Fallback` gekennzeichnet und nicht als Live-Quote dargestellt.
- Regressionstest für diesen konkreten Fehler ergänzt.

## Safety
- Keine Änderung an BUY-Gates, Netto-CRV, Sizing, Elliott-Logik oder Discovery-Gewichtung.
- Daily-Bar bleibt Discovery-Kontext mit 0 % direktem BUY-Gewicht.

## Basis
- Enthält vollständig den Audit-/VL-Stand von v3.4.0.

---

# FusionPulse v3.4.0 — Release Notes

Datum: 25.08.2026

## Schwerpunkt
Stabilitäts- und Sicherheitsrelease nach externem statischem Audit plus kumulierter VL. Keine Lockerung der Tradingregeln oder Schwellenwerte.

## Audit-Fixes
- Fokus bleibt strikt auf der angeforderten Aktie; aktiver Nicht-Favorit wird über Polls geschützt.
- Stock-Lookup besitzt eigenen Sequenz-Guard und keinen Suchfeld-Transportkanal mehr; Ticker-Mismatch wird fail-closed behandelt.
- `regimeExplanation()` ist definiert; Risk-On/Off/VWAP-Erklärung funktioniert wieder ohne Render-/Learning-Folgefehler.
- BUY ist zusätzlich an echte Live-Freshness und bekannte Opening/Regular-Marktphase gebunden; fehlende Daten können kein BUY erzeugen.
- Persistierte `refreshedSymbols` werden im Tiingo-Clientpfad wieder durchgereicht.
- Fokus zeigt Quote-/Freshness-Information und erhält einen Einzelaktien-Refresh.
- Frontend-/Provider-Fetches sind zeitbegrenzt; Aktien-Poll plant sich über `finally` weiter.
- Crowd-Aufruf aus dem minütlichen Opening-Scan entfernt; eigener 20-Minuten-Zyklus.
- Chart-Cache erhält 120-s-TTL.
- Tiingo-Radar verwirft Quotes älter als 30 Minuten.
- Alpaca kennzeichnet intern minute/trade/daily als Preisquelle.
- Sticky-Header verdeckt den Aktiennamen nach Sprung nicht mehr.
- VWAP-Text behauptet bei fehlender Volumenbasis nicht mehr fälschlich „über VWAP“.
- Erster Service-Worker-Claim löst keinen unnötigen Reload aus.

## VL/UI
- Opening Momentum: redundantes „· RADAR“ entfernt; Header zeigt Updatezeit und 60-s-Intervall.
- Speed bleibt in Radar und Opening Momentum mit Erklärung erhalten.
- Learning-Fehler-Tooltip unterscheidet Learning/D1 von Provider-Verbindungen.
- Einzelaktien-Refresh im Fokusfenster ergänzt.
- Fokus-Freshness zeigt Abfrage-/Datenstatus zusätzlich zum Quote-Status.

## Bewusst weiter offen
- Aktien-Heatmap: echte dynamische Bewegung/Trails und bessere visuelle Aussagekraft weiter verbessern.
- Aktienchart: echte Premarket-/After-Hours-Zeitreihe, Previous Close, Gap-Referenz und Sessiontrennung.
- Header-Zähler Aktien/Krypto eindeutig trennen.
- Twelve-Data-Kontingentdarstellung weiter vereinfachen, wenn Anbieterheader kein belastbares Restkontingent liefern.
- Untere Signal-/Planleiste weiter entschlacken: kein Coin darf ohne echtes aktives Signal/Plan wie eine Empfehlung wirken.
- Discovery-Unternehmensbeschreibung weiter spezialisieren (z. B. Biotech-Discovery/Lead Candidate nur verifiziert).
- Elliott-/Strukturkontext 30–180 min weiter evaluieren; keine Schwellenänderung ohne separaten Test/Audit.
- Shooting/Short-Radar bleibt zurückgestellt.

## Validierung
`npm run check` muss Syntax + vollständige Safety-Regression bestehen. Versionsnummer wird über `scripts/sync-version.mjs` auf alle Release-Artefakte synchronisiert.
