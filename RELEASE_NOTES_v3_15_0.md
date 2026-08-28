# FusionPulse v3.15.0 · Modellvergleich, Sektor-Priorität, Kachelfarben

Alle drei Erweiterungen sind additiv. Gemeinsame Invariante: **keine davon verändert einen
Score, ein Gate, eine Ampel oder eine Freigabe.**

33 Testsuiten grün in zwei Zeitzonen, vier SHA-Blöcke unabhängig nachgerechnet,
Negativkontrolle für alle neun Änderungen.

---

## 1. Modellvergleich

Der Worker liefert seit jeher **drei unabhängig gerechnete Urteile im selben Datensatz**
(`worker.js:1723` — `claude, fusion, momentum`). Angezeigt wurde immer nur das des aktiven
Modus; die anderen beiden waren berechnet und unsichtbar.

| Strang | Methodik |
|---|---|
| Claude / Aladdin | Erwartungswert in R, Strukturziele, EV-Gate |
| ChatGPT-Strang | Struktur-CRV, Elliott/Fibonacci, Range-Projektion |
| Momentum (Modus A) | Kein Overextended-Malus, Ziel als Vielfaches der Tagesspanne |

Das Panel sitzt in der Fokuskarte über dem Positionsbereich und zeigt je Strang Ampel,
Urteil, Kennzahlen und den wichtigsten Blocker. Der **aktive** Strang ist markiert — er
allein bestimmt den Handelsvorschlag.

**Es rechnet nichts.** Es liest fertige Felder. Ein Test prüft, dass im gesamten Block
weder `S.minCrvStock` noch `buyReady` noch eine Score-Zuweisung vorkommt.

**Der Nutzen liegt im Dissens.** Wenn zwei Modelle verschieden urteilen, ist das eine
Information, die vorher nur im Rohdatensatz stand. Bei Uneinigkeit wird das Panel gelb
umrandet und sagt es im Klartext.

**Übereinstimmung ist ausdrücklich keine Bestätigung.** Die drei Modelle teilen sich
dieselben Kursdaten, ihre Fehler sind also korreliert. Genau das steht im Fußtext, und
eine Negativkontrolle verhindert, dass daraus je „alle Modelle bestätigen das Setup" wird.

---

## 2. Sektor-Priorität: Pharma/Healthcare · Edelmetalle/Minen · Technologie

**Warum eine kuratierte Liste und keine Abfrage:** Der Sektor stand bisher nur im
statischen Katalog, und der hat **26 Einträge** — 11 Technologie, 4 Gesundheit, 2
Rohstoffe. Alles, was aus dem Whole-Market-Radar über die ~37.000 Tiingo-Titel kommt,
trägt `sector: 'Discovery'`. Tiingo liefert Sektor und Industrie nur im kostenpflichtigen
Fundamentals-Paket. Eine Liste ist damit die einzige ehrliche Option — und sie ist als
**kuratiert und unvollständig** gekennzeichnet, statt Vollständigkeit zu behaupten.
Rund 180 Ticker in deiner Prioritätsreihenfolge.

**Was sie tut:** Sie verändert, *welche* Titel tief analysiert werden. Vor dem
allgemeinen Radar wird pro Prioritätssektor ein Platz reserviert — gefüllt ausschließlich
aus Titeln, die der Radar ohnehin nominiert hat. Es wird nichts erfunden, nur die
Reihenfolge geändert. Findet ein Sektor nichts, verfällt sein Platz an den allgemeinen
Radar statt leer zu bleiben.

**Was sie nicht tut:** keinen Score, kein Gate, keine Ampel, keine Freigabe. Ein Titel aus
einem Prioritätssektor bekommt **Aufmerksamkeit, keinen Bonus** — dieselbe Regel wie für
Radar und BOATS. Ein Test durchsucht jede Zeile, in der `prioritySector` vorkommt, auf
Berührung mit Score, Ampel oder CRV.

**Keine Verdrängung:** 3 Sektoren × 1 Platz gegen `capRadar ≥ 8` lässt dem allgemeinen
Radar die Mehrheit. Ein Test lässt die Reserve nicht über 3 wachsen — sonst wäre der Radar
wieder das, was er seit v3.3.4 ausdrücklich nicht mehr sein soll: ein Katalog-Pool.

**Offen und ehrlich gekennzeichnet:** `SECTOR_RESERVE_PER_SECTOR = 1` ist **geraten, nicht
gemessen**. Der Wert gehört auf dieselbe Liste offener Kalibrierungen wie
`MOM_MIN_DOLLARVOL`.

In der Fokuskarte steht der Prioritätssektor als blaue Marke `◆ Technologie` — bewusst in
Akzentblau und **nicht** in einer Ampelfarbe, weil er nichts über Handelbarkeit aussagt.

---

## 3. Kachelfarben — Variante A

Einstellbar sind **Rahmen und Flächentönung** von fünf neutralen Kachelgruppen:
Kennzahlen-Kacheln, Interpretation, Chartbereich, Lernbericht und der Rahmen des
Modellvergleichs.

**Geschützt und nicht wählbar** bleiben: Punkt und Text der Systemleiste, das
Verdict-Band, die Ampelspalten im Modellvergleich, das 120-Minuten-Statusband. Diese
Farben *sind* die Aussage.

Die Trennung ist nicht kosmetisch gemeint. In v3.14.6 war die Systemampel praktisch
unsichtbar, weil eine Farbe zu schwach war. Eine Einstellung, mit der sich derselbe
Zustand wiederherstellen ließe, wäre ein Rückschritt mit Bedienoberfläche.

**Zwei Sicherungen, beide ausgeführt geprüft:**

1. Die vier Ampelfarben sind reserviert. Wird eine davon als Kachelton hinterlegt — etwa
   aus einem von Hand bearbeiteten `localStorage` — wird sie **verworfen**, nicht
   übernommen. Es wird dann gar keine CSS-Variable gesetzt.
2. Nur echte Hex-Werte kommen in die Variable. Fail-closed gegen manipulierten Speicher.

Dazu prüft ein Test **jede** CSS-Regel, die `var(--tint-…)` verwendet, darauf, dass ihr
Selektor keine Ampel berührt — kein `.hl-`, kein `.resource-strip`, kein `sf-verdict`,
kein `::before`.

---

## Nachweise

- 33 Suiten grün, `TZ=Europe/Vienna` und `TZ=America/Chicago`
- `client-harness` und `audit:reach` grün, `node --check src/worker.js` sauber
- Vier Claude-SHA-Blöcke unabhängig nachgerechnet, außerhalb des Testlaufs: identisch
- **Funktionsnachweise, ausgeführt statt gelesen:**
  Modellvergleich — Dissens erkannt · aktiver Strang markiert · Blocker sichtbar ·
  Übereinstimmung nicht als Bestätigung · fehlendes Modell als „nicht berechnet" ·
  aktiver Strang folgt dem Modus, nicht der Anzeigereihenfolge
  Sektoren — Zuordnung für alle drei · Kleinschreibung greift · Unbekanntes, Leerstring
  und `null` ordnen nichts zu · Reserve bleibt klein
  Kachelfarben — Ampelgrün, ‑gelb, ‑rot verworfen (auch in Großschreibung) · erlaubter Ton
  greift · Nicht-Hex verworfen · verworfene Farbe setzt gar keine Variable

### Negativkontrolle, jede Änderung einzeln zurückgedreht

| zurückgedreht | Test |
|---|---|
| Modellvergleich nicht mehr eingehängt | fällt |
| Dissens wird nicht mehr erkannt | fällt |
| Übereinstimmung als Bestätigung verkauft | fällt |
| Sektor-Reihenfolge verändert | fällt |
| Sektor-Reserve nicht mehr in der Queue | fällt |
| Sektor-Reserve hungert den Radar aus | fällt |
| Ampelfarben als Kachelton erlaubt | fällt |
| Hex-Prüfung des Farbwerts entfernt | fällt |
| Ampel-Verdict färbbar gemacht | fällt |

### Nebenbefund am Testwerkzeug

`tests/client-harness.mjs` stubbte `documentElement.style` als nacktes Objekt ohne
`setProperty`/`removeProperty`. Der Harness fiel dadurch mit einem `TypeError` statt mit
einer Aussage — ein Test, der aus dem falschen Grund fällt, ist kein Test. Der Stub merkt
sich die Werte jetzt und ist prüfbar.

---

# Kurzfassung ohne Technik

## Was jetzt funktioniert

**Du siehst drei Meinungen statt einer.** In der Fokuskarte stehen jetzt die Urteile von
drei verschiedenen Bewertungsverfahren nebeneinander — Claude, der ChatGPT-Strang und der
Momentum-Modus. Gerechnet wurden sie schon immer, sichtbar war bisher nur eines. Sind sie
sich uneinig, wird der Kasten gelb und sagt es dir. Entscheidend bleibt das Verfahren, das
gerade eingeschaltet ist; die anderen zwei stehen zur Einordnung daneben.

**Sind sich alle drei einig, heißt das ausdrücklich nicht, dass die Sache sicher ist.** Sie
schauen auf dieselben Kursdaten und können sich deshalb gemeinsam irren. Das steht auch so
in der App.

**Der Scanner schaut zuerst in deine drei Wunschbereiche.** Bei jedem Durchlauf ist je ein
Platz für Pharma/Gesundheit, Edelmetalle/Minen und Technologie reserviert. Ausgewählt wird
nur aus Titeln, die der Scanner ohnehin auffällig fand — es wird nichts hinzuerfunden.
Ein Titel aus diesen Bereichen bekommt dadurch **Aufmerksamkeit, aber keine bessere Note**.
Erkennbar an der blauen Marke ◆ neben dem Firmennamen.

**Kacheln lassen sich einfärben.** In den Einstellungen kannst du fünf Kachelgruppen in
Rahmen und Hintergrund umfärben. Die Ampelfarben — grün, gelb, orange, rot — sind gesperrt.
Versuchst du eine davon einzustellen, wird sie stillschweigend ignoriert. Grund: an diesen
Farben liest du ab, ob etwas handelbar ist. Wären sie frei wählbar, könntest du dir die
wichtigste Information selbst unsichtbar machen.

**Die Systemanzeige oben hat wieder Farbe.** Sie hatte für zwei ihrer vier Zustände gar
keine Farbe und einen fast durchsichtigen Rahmen. Der Zustand war richtig berechnet, nur
nicht zu sehen. Jetzt hat jeder Zustand einen farbigen Punkt wie die Anzeigen daneben.
**Was die Anzeige bedeutet, hat sich nicht geändert** — nur ob du es erkennst.

## Was noch offen ist

**Warum die Systemanzeige gestern rot war.** Ich habe den Verursacher eingekreist: es ist
der Premarket-Datendienst (Alpaca). Was genau dort schiefgeht, sagt mir erst der
Fehlertext. Ruf dazu `/api/health` im Browser auf, wenn die Anzeige wieder rot ist, und
schick mir den Eintrag zu `alpaca`. Betroffen ist nur die Premarket-Kachel — die übrige
Analyse hängt nicht daran.

**Drei Zahlen im Momentum-Modus sind geschätzt, nicht gemessen.** Sie bestimmen, wie viel
Handelsumsatz ein Titel haben muss und wie eng eine Kursberuhigung sein darf. Dafür brauche
ich die Zähler aus einem laufenden US-Handelstag. Ohne echte Zahlen würde ich nur weiter
raten, und genau das steht dreimal auf meiner Fehlerliste.

**Auch die Sektor-Reserve ist geschätzt.** Ein Platz pro Bereich und Durchlauf ist ein
gewählter Wert, kein gemessener. Wenn dir auffällt, dass zu wenige oder zu viele Titel aus
deinen drei Bereichen kommen, sag es — dann justiere ich nach.

**Modus B ist weiterhin nur ein Konzept.** Der Langfrist-Modus über drei bis sechs Monate
mit Tagesbalken und stärker gewichteten Elliott-Wellen ist besprochen, aber nicht gebaut.

**Eine Eingabemaske für Termine fehlt.** Quartalstermine kann die App bereits entgegennehmen,
es gibt nur noch kein Feld dafür. Kleiner Aufwand, den du wahrscheinlich oft nutzen würdest.
