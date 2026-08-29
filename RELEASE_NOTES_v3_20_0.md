# FusionPulse v3.20.0 — Top Picks: Rangfolge nach Netto-Euro

Additiv. **Keine Änderung an Score, Ampel, Gate, Sizing oder Freigabe.** Die vier
SHA-verriegelten Claude-Modus-Blöcke sind unberührt. Neu ist eine Auswertungs-
und Ordnungsschicht *über* dem Bestehenden.

---

## Zwei Befunde — beide gerechnet, nicht vermutet

### Befund 1: Die Zielscheibe stand an der falschen Stelle

Jede Lernstatistik dieser App definiert Erfolg als `max_pct >= 5`:
`ATTR.WIN_PCT`, der Auflöser in `d1UpdateOutcomes`, `d1TwinFor`, das Musterlabor.
Der Lernhorizont beträgt dabei **180 Minuten**.

Die wirtschaftliche Schwelle des Nutzers folgt aber aus den **eigenen
Kostenkonstanten der App**:

| | |
|---|---|
| Einsatz | 10.000 € |
| Ordergebühr | 2 × 11,50 € |
| Ausführungsreibung | 0,15 % = 15 € |
| KESt | 27,5 % |
| **Zielweite für 120 € netto** | **2,04 %** |

Ein Setup, das zuverlässig +2,5 % in zwei Stunden liefert — also **genau das,
was du wolltest** („ein paar Prozent später verkaufen") — zählte in jeder
Statistik dieser App als **Misserfolg**. Die Lernschicht hat damit systematisch
die seltenen volatilen Ausreißer belohnt und die tragfähigen Setups verworfen.

Das ist der dritte Fall derselben Art: v3.8.0 (falsches Universum), v3.16.0
(falsches Gate), jetzt die falsche Erfolgsschwelle. Das Muster ist jedes Mal
identisch — die App misst etwas anderes, als der Nutzer will.

### Befund 2: Der Stop war nicht frei wählbar, wurde aber so behandelt

Bei 10.000 € Einsatz gilt für ein Ziel von 2,04 %:

| Stop | Verlust am Stop | nötige Trefferquote |
|---|---|---|
| −2,00 % | 238 € | **66,5 %** |
| −1,50 % | 188 € | 61,0 % |
| −1,00 % | 138 € | 53,5 % |
| −0,75 % | 113 € | 48,5 % |

Eine Trefferquote über 60 % gibt es im Intraday-Momentum nicht dauerhaft.
**Mit einem 2-%-Stop ist ein 2-%-Ziel rechnerisch unmöglich** — völlig unabhängig
davon, wie gut die Kandidaten sind. Die Asymmetrie kommt daher, dass Gewinne
versteuert werden und Verluste die vollen Gebühren mittragen.

`MIN_REWARD_RISK_FIXED = 2.0` steht seit v3.9.0 im Client. Die Konsequenz daraus
— **dein Stop darf höchstens 1,02 % entfernt sein** — stand nirgends. Jetzt wird
die Stopweite aus dem Ziel *abgeleitet* statt geraten.

---

## Was gebaut wurde

### `/api/toppicks` (neu) und die Kachel „🎯 Top Picks"

Die Kachel zeigt zuerst die **Kopfrechnung**, und zwar auch dann, wenn noch keine
einzige Episode aufgezeichnet ist: Zielweite, maximal zulässiger Stop, nötige
Trefferquote, Gewinn gegen Verlust. Das allein beantwortet schon die Frage,
warum bisher nichts Gewinnträchtiges herauskam.

Darunter je **Situationstyp** (BREAKOUT PRESSURE, OPENING DRIVE, …), aus den
aufgezeichneten und abgeschlossenen Episoden:

- wie viele erreichten deine Zielweite, **ohne vorher den Stop zu reißen**
- der daraus folgende **Erwartungswert in Euro je Trade**
- die **typische Haltedauer** bis zum Ziel — eine Zahl, die die App nie hatte
- zum Vergleich daneben: wie viele es an der alten 5-%-Schwelle gewesen wären

Zuletzt die **lebenden Radar-Kandidaten**, sortiert nach dem Erwartungswert ihres
Situationstyps statt nach dem Live-Score.

### Drei Ehrlichkeitsregeln, hart im Code verankert

**1 · Die Reihenfolge ist nicht aufgezeichnet.** `max_pct` und `min_pct` sind
zwei unabhängige Extremwerte über den Horizont. Ob der Stop *vor* dem Ziel kam,
steht nirgends. Eine Episode, die beides berührt hat, zählt deshalb als
**ausgestoppt** — die pessimistische Lesart. Wie groß dieser Unsicherheitsanteil
ist, wird als `ambiguous` getrennt ausgewiesen.

**2 · Vorsichtige Schranken statt Punktschätzung.** Die Trefferquote geht mit der
Wilson-*Unter*grenze ein, die Stopquote mit der Wilson-*Ober*grenze. Eine kleine
Stichprobe kann damit nie gut aussehen — sie sieht unbestimmt aus, und das ist
richtig. Konkret: 30 Episoden bei 67 % beobachteter Trefferquote ergeben eine
Untergrenze von 48,8 % und damit **immer noch einen negativen Erwartungswert**.
Erst rund 60 Episoden bei 75 % tragen. Das ist die ehrliche Antwort auf „ab wann
weiß die App etwas".

**3 · Fail-closed in der Rangfolge.** Die Stufen sind: belegt-positiv →
dünn-positiv → **unbelegt** → belegt-negativ. Ein Kandidat ohne Beleglage kann
einen belegten positiven Kandidaten **nie** überholen, egal wie laut sein
Live-Score ist. Umgekehrt steht ein belegt schlechter Kandidat *unter* einem
unbewerteten: Wissen schlägt Nichtwissen in beide Richtungen. Die Rangstufe ist
am Kartenrand sichtbar, nicht nur in der Sortierung versteckt.

### `reach_ts` (neue Spalte, `migrations/0003_toppicks.sql`)

`success_ts` misst den Zeitpunkt von +5 % und ist für die Frage „wie lange muss
ich halten" unbrauchbar. Neu wird der Zeitpunkt der ersten **2,0-%-Berührung**
mitgeschrieben — feste Referenz, bewusst nicht an die Nutzereinstellung
gekoppelt, damit die Zeitreihe über Monate vergleichbar bleibt. Der Worker zieht
die Spalte beim Start selbst nach; bestehende Produktionsdaten bleiben erhalten.

**Rückwirkend füllbar ist sie nicht.** Der Kursverlauf zwischen den
Aufzeichnungen ist nicht gespeichert. Die Haltedauer-Anzeige beginnt bei null und
wird über Wochen belastbar.

---

## Wie das geprüft ist

Neue Suite 39, `✓ FusionPulse v3.20.0 top-picks/expectancy regressions` — die
Rechnung wird **ausgeführt**, nicht per Regex gesucht. Unter anderem:

- Hin- und Rückrechnung müssen invers sein (`requiredMovePct` ↔ `netEurAtMove`)
- eine Episode, die beides berührt hat, darf nicht als Treffer zählen
- dieselben 45 Episoden ergeben an der wirtschaftlichen Schwelle 45 Treffer und
  an der alten 5-%-Schwelle **null** — der Befund als Testfall
- gleiche Quote bei kleinerer Stichprobe muss einen *niedrigeren* Erwartungswert
  ergeben
- unbelegt darf belegt-positiv nicht überholen

**Vier Negativkontrollen gefahren**, Code jeweils absichtlich kaputt gemacht:

1. Mehrdeutige Episode als Treffer werten → fällt ✓
2. Wilson-Untergrenze durch Punktschätzung ersetzt → fällt ✓
3. Fail-Closed-Rangfolge umgedreht → fällt ✓
4. Stopweite wieder festgeschrieben statt abgeleitet → fällt ✓

**Kontrolle 2 hat beim ersten Anlauf NICHT ausgelöst.** Grund: solange jede
Episode entweder Treffer oder Stop ist, gilt exakt
`wilsonLower(h,n) + wilsonUpper(n−h,n) = 1`; die Kürzungsregel stellt dieselbe
Zahl dann von selbst wieder her. Der Test wurde auf einen Datensatz **mit**
ergebnislosen Episoden umgestellt, wo die Kürzung nicht greift. Der Hinweis
steht als Kommentar im Test — es ist genau die Sorte stiller Testschwäche, die
Abschnitt 11 des Handovers sechsmal auflistet.

Zusätzlich ein Ende-zu-Ende-Lauf: der echte Worker-Kern rechnet, das echte
`app.js` rendert daraus in einem echten DOM. Ergebnis: `SOFI` (belegt, +23 €
erwartet) steht **über** `LAUT` (+8,1 % Tagesbewegung, aber ohne Beleg).

`npm run check` → 39 Suiten grün. `npm run audit:reach` → ohne Fund.

---

## Was jetzt funktioniert

- **Du siehst zum ersten Mal, was ein Kandidat wert ist — in Euro.** Nicht als
  Punktzahl von 0 bis 100, sondern als „dieser Setup-Typ hat in 60
  aufgezeichneten Fällen im Schnitt 23 € netto eingebracht".
- **Du siehst, warum bisher nichts Gewinnträchtiges dabei war.** Die Kopfrechnung
  in der Kachel steht immer da: 2,04 % Zielweite nötig, Stop höchstens 1,02 %,
  54 % Trefferquote nötig. Wenn ein Kandidat einen 2-%-Stop braucht, ist er nach
  dieser Rechnung erledigt, bevor irgendein Score ihn bewertet.
- **Du siehst, wie lange du halten musst.** Median-Minuten bis zum Ziel je
  Situationstyp — die Zahl entscheidet, ob ein Kandidat überhaupt zu deinem
  Handelsstil passt.
- **Laute Kandidaten ohne Beleg drängeln sich nicht mehr vor.** Ein Titel mit
  +8 % Tagesbewegung, dessen Situationstyp noch nie ausgewertet wurde, steht
  jetzt unter einem unauffälligen Titel mit belegter Historie — und es steht
  dabei, warum.
- **Wenn nichts trägt, sagt es das.** „Kein belegter Situationstyp trägt bei
  2,04 % Zielweite einen positiven Erwartungswert" ist ein Ergebnis, kein Fehler.

## Was noch offen ist

- **Die Auswertung braucht Laufzeit.** Sie rechnet ausschließlich mit
  abgeschlossenen Aufzeichnungen. Situationstypen werden erst seit v3.17.0
  mitgeschrieben, die Haltedauer erst ab dieser Version. Rechne mit einigen
  Wochen, bis die ersten Typen die 20-Episoden-Marke reißen — und mit deutlich
  mehr, bis der Erwartungswert belastbar positiv oder negativ ist. Das lässt
  sich nicht abkürzen und wird bewusst nicht geschönt.
- **Die alte 5-%-Schwelle steht weiterhin in Modul 0, im Musterlabor und in der
  Twin-Statistik.** Ich habe sie **nicht** angefasst: der ChatGPT-Strang und die
  bestehenden Abschalt-Empfehlungen hängen daran, und eine Änderung würde alle
  historischen Auswertungen unvergleichbar machen. Die neue Kachel stellt die
  richtige Zahl **daneben**, statt die alte still zu überschreiben. Ob die
  anderen Module nachgezogen werden, ist eine Entscheidung für dich.
- **Gruppiert wird nach Situationstyp, nicht je Symbol.** Ein einzelnes Symbol
  hat nie genug Episoden für eine belastbare Quote. Sobald genug Daten da sind,
  wäre eine feinere Aufteilung möglich (Typ × Sektor, Typ × Tageszeit) — mit dem
  bekannten Risiko, dass mehr Gruppen bei gleicher Datenmenge nur Rauschen
  erzeugen.
- **Der Erwartungswert unterstellt, dass du das Ziel auch nimmst.** Er misst, ob
  der Kurs die Zielweite berührt hat — nicht, ob du dort verkauft hättest.
- **Alle offenen Punkte aus v3.18.0 bleiben offen** (P-A2 Kalibrierung, P-A3
  Livemarkt-Gegenprüfung, P-B Modus B, P-C Aktien-Sentiment).
