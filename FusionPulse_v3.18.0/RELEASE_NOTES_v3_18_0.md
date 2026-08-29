# FusionPulse v3.18.0 · Freigabe-Trichter, gemessene Zielweite, Sektor-Reserve

Anlass war eine Rückmeldung, die sich als berechtigt herausgestellt hat: *„seit einer
Woche gab es noch nie eine realistische Aktienempfehlung."* Gemeint waren **alle** Titel
der Fokuskarte, nicht nur Edelmetalle.

37 Testsuiten grün in zwei Zeitzonen, vier SHA-Blöcke unabhängig nachgerechnet,
fünf Negativkontrollen — zwei davon haben zuerst einen zu schwachen Test aufgedeckt.

---

## 1. Der Befund: ein Gate aus dem falschen Modell

`momentumOverlayRow()` ersetzt **14 Anzeigefelder**. `netCRV` ist nicht dabei.
`stockTradeability()` liest bei `claudeMode:false` aber genau `r.netCRV` als `gateCrv`
und prüft es gegen `S.minCrvStock` (3,0). Modus A lieferte also seinen Plan — und wurde
an der Kennzahl eines Plans gemessen, den der Overlay eine Zeile vorher ersetzt hatte.

Im Harness ausgeführt, mit einem aus Modus-A-Sicht makellosen Titel:

```
Ampel green · Score 7,5 · Ziel:Stop 5,29 · Plan-Effizienz 2,94 · Markt offen
→ stockLevel 2 = KEINE Freigabe
  einzige verletzte Bedingung: gateCrv 1,8 >= 3   ← Quelle: r.netCRV (fusion)
```

Gegenprobe: Momentum-Score 7,5 → **9,5** angehoben, Freigabe unverändert aus. Nur
`netCRV` 1,8 → 3,2 gehoben, **kein Modus-A-Feld angefasst** → `tradeability.ok` kippt.
Das Gate hing ausschließlich am anderen Modell.

Dazu ein Totband: `stockLevel` verlangt `score >= FUSION_MIN_SCORE_STOCK = 7,2`, Modus A
wird schon ab **6,8** grün. Jeder Titel dazwischen zeigte „Kauf-Setup · Momentum" und
bekam keine Freigabe.

Zweite Sperre: `fresh.key === 'live'` verlangt, dass der Titel in den `refreshedSymbols`
des laufenden Zyklus steht **und** `stockMeta.ts` jünger als 90 s ist. Der Deep-Scan läuft
in den Minuten {2,4,6,8} je 10 — das 90-s-Fenster deckt 6 von 10 Minuten ab, und je Zyklus
sind höchstens **20 von bis zu 80** Zeilen „refreshed".

## 2. Zwei mögliche Antworten, eine gewählt

**(1)** Modus A bekommt eigene Gates — mehr Mechanik, mehr geratene Schwellen.
**(2)** Modus A gibt gar keine Freigabe mehr. **Gewählt.**

Die Begründung ist älter als der Befund: seit v3.10.0 steht in der Übergabe, dass die
realistische Zielsetzung ein **Aufmerksamkeitsfilter** ist und kein Signalgeber. Der
Nutzer hat an CRWD und NVDA über 1.600 € verdient, ohne dass die App je BUY gesagt hat.
Eine Freigabe, die aus Sicherheitsgründen nie kommt, ist kein Schutz — sie ist eine
Zusage, die die App nicht einlöst.

**Was das konkret heißt:**

- `stockLevel()` deckelt in Modus A bei 2. Der Deckel steht **ganz oben** in der Funktion,
  damit keine spätere Bedingung ihn umgehen kann. Er kann ausschließlich abwerten.
- Eigener Kopfzeilen-Zweig `◆ Kandidat · Modus A`, **vor** dem BUY-Zweig — danach wäre er
  wirkungslos, derselbe Fehler wie bei der Terminwarnung in v3.8.2.
- Die Begründung kommt aus `r.blockers` (Modus A), **nicht mehr** aus dem Struktur-CRV des
  anderen Modells. Vorher stand an einem Modus-A-Titel ein Grund, der sich auf einen nicht
  angezeigten Plan bezog.
- **Die Zahlen bleiben.** Entry, Stop, beide Ziele, Euro-Einsatz, Verlust am Stop und die
  Blocker sind weiter sichtbar. Der Einsatz ist als `Plan 10.000 €` gekennzeichnet, nicht
  als Empfehlung. Was verschwindet, ist die Behauptung einer Freigabe.
- **Der ChatGPT-Strang ist unberührt.** Jeder Zweig greift nur, wenn Modus A aktiv ist
  UND der Worker einen Momentum-Block geliefert hat. Bei `tradeMode:'off'` ist keine Zeile
  dieser Version wirksam — ein Test weist das nach (Invariante 9).
- **Fail-closed in beide Richtungen:** ein alter Cache ohne Momentum-Block sperrt nicht
  still alles, sondern fällt ins bisherige Verhalten zurück.

## 3. Erreichbarkeit der Prioritätssektoren — gemessen

| Sektor | Ticker | im Large-Cap-Radar | im Katalog | nur über Momentum-Gitter |
|---|---|---|---|---|
| Pharma/Healthcare | 63 | 7 | 7 | 83 % |
| Edelmetalle/Minen | 52 | **0** | 1 (AEM) | **98 %** |
| Technologie | 69 | 22 | 21 | 59 % |

Ein Edelmetall-Titel kann praktisch nur über das Momentum-Gitter herein: ≥ 3 % Bewegung
**und** ≥ 2 Mio. $ IEX-Umsatz. Bei 2–3 % IEX-Marktanteil sind das rund **80 Mio. $
Gesamtumsatz an einem Tag**. Die Sektor-Reserve aus v3.15.0 verfällt für Edelmetalle
deshalb an den meisten Tagen still an den allgemeinen Radar. Das ist noch nicht behoben
und steht unter „offen".

**Bereinigt:** `CS` (Credit Suisse, ADS am 12.6.2023 von der NYSE genommen) und `NGT`
(Newmonts Toronto-Listing) sind aus der Edelmetall-Liste entfernt — zwei tote Ticker auf
Listenplätzen.

## 4. Widerlegt: der Verdacht aus P-A3

Die echte Modus-A-Geometrie aus `worker.js` extrahiert und gegen 20.000 synthetische
Bar-Pfade ausgeführt:

| Szenario | Konsolidierung erkannt | Ziel:Stop ≥ 2,0 | Median Ziel:Stop |
|---|---|---|---|
| ruhiger Standardwert | 16,1 % | 100 % | 8,8 |
| Mover mit Beruhigung | **93,1 %** | 100 % | **18,5** |
| Mover ohne Beruhigung | 88,5 % | 100 % | 9,9 |

Seit v3.9.0 stand in P-A3, `consRange <= impulseUp * 0.62` sei vermutlich zu streng. Bei
93 % Trefferquote an echten Movern ist das **widerlegt** — der Punkt kann von der Liste.

Dafür fällt anderes auf: `MIN_REWARD_RISK_FIXED = 2,0` bindet in keinem Szenario. Ein
Gate, das nie greift, schützt nichts. Ursache ist die Zielformel
`Konsolidierungshoch + 1,0 × Tagesspanne` — bei einem Titel, der 8 % gelaufen ist, liegt
TP2 rund 8 % über dem Ausbruch. Der zweite P-A3-Punkt ist damit beantwortet: TP2 ist so
nicht realistisch erreichbar. Beides bleibt offen, weil es echte Zähler braucht.

---

## Nachweise

- 37 Suiten grün, `TZ=Europe/Vienna` und `TZ=America/Chicago`
- `npm run check` und `audit:reach` grün, vier Claude-SHA-Blöcke außerhalb des Testlaufs
  unabhängig nachgerechnet: identisch
- Eigene Fixture, nicht aus einer anderen Suite nachgenutzt; bewusst so gebaut, dass sie
  in **beiden** Strängen freigabefähig wäre — nur so beweist ein Level ≠ 3 etwas über
  Modus A statt über die Testdaten

### Negativkontrolle, jede Änderung einzeln zurückgedreht

| zurückgedreht | Test |
|---|---|
| Deckel in `stockLevel` entfernt | fällt |
| Modus-A-Zweig aus der Kopfzeile entfernt | fällt |
| Begründung wieder aus dem Struktur-CRV | fällt |
| Euro-Zahl in Modus A ausgeblendet | fällt |
| `MODE_A_NO_RELEASE` abgeschaltet | fällt |

### Zwei Tests waren zuerst zu schwach — von der Negativkontrolle aufgedeckt

1. `hl.kind === 'modeA'` bewies nichts: `kind` stammt aus `opp.blockKind` und fiel auch
   ohne den Kopfzeilen-Zweig auf `'modeA'`. Jetzt wird zusätzlich auf das eigene Symbol
   `◆` und den Begründungstext geprüft.
2. Die Prüfung „Euro-Zahl sichtbar" traf auch die alte Beschriftung `pot. 10.000 €`. Jetzt
   wird auf `^Plan ` geprüft, auf das Fehlen von `pot.` und auf den Tooltip.

Vierter und fünfter Fall der Klasse aus Abschnitt 11: **ein Test, der den Fehler nicht
sehen kann, ist kein Funktionsnachweis.**

### Nebenbefund am Arbeitsablauf

Das Skript der Negativkontrolle spielte am Ende eine vor den Glossar-Ergänzungen
gesicherte `app.js` zurück und überschrieb damit stillschweigend drei fertige Änderungen.
Aufgefallen ist es nur, weil nach jedem Schritt getestet wird — die Suitezahl fiel von 34
auf 33. Sicherungskopien für Negativkontrollen gehören nach der letzten inhaltlichen
Änderung gezogen, nicht davor.

---

## 5. Nachgereicht in v3.16.1: die Terminmaske ist jetzt nachgewiesen

In v3.16.0 lag der Code der Eingabemaske für Quartalstermine (P6 Teil 1b) im Archiv —
**ohne eine einzige Testzeile.** Nach Abschnitt 13 zählt das nicht als fertig, und so
stand es auch in der Übergabe. Der Nachweis ist nachgeholt, Suite 35.

**Was geprüft wird, ausgeführt:**
- Das Wirkungsfenster folgt exakt `earningsFor()`: Tag 0 und Tag 14 wirken, Tag 15 nicht,
  gestern nicht mehr, unbrauchbares Datum wird benannt. Weicht das ab, behauptet die
  Maske eine Wirkung, die es nicht gibt.
- Die Client-Bereinigung spiegelt `writeManualEarnings()`: Kleinschreibung, Kürzung auf
  8 Zeichen, Verwerfen falscher Datumsformate, Zusammenfassen von Doppeleinträgen.
- **Keine optimistische Anzeige.** Bei `Keine D1-Verbindung` bleibt `earnData.manual`
  unangetastet und der Serverfehler steht im Klartext da. Bei Erfolg wird die
  **Serverantwort** übernommen, nicht die eigene Eingabe.
- Die Eingabefelder stehen statisch im Markup. Ein Test verbietet ihr Vorkommen in
  `renderEarningsEditor()` — `renderEarningsBoard()` schreibt sein `innerHTML` bei jedem
  Scan neu und würde ein erzeugtes Formular samt Tippfokus verwerfen.

### Negativkontrolle

| zurückgedreht | Test |
|---|---|
| 14-Tage-Fenster auf 30 verstellt | fällt |
| Eingabe auch bei Serverfehler übernommen | fällt |
| Serverantwort ignoriert, eigene Liste als Wahrheit | fällt |
| Doppelte Einträge nicht mehr zusammengefasst | fällt |
| Eingabefeld aus dem Markup entfernt | fällt |

### Der Test fiel zuerst aus dem falschen Grund
Die Fixture wurde eine Mikrotask nach dem Setzen von `loadEarnings()` überschrieben —
der Client startet den Abruf beim Laden. Das sah aus wie ein Codefehler und war ein
Testfehler. Behoben durch Abwarten des Boot-Ticks, mit Kommentar an der Stelle.
**Sechster Fall der Klasse aus Abschnitt 11.**

---

## 6. Neu in v3.17.0: Das Musterlabor

**Die Frage war: „Haben wir aus den aufgezeichneten Daten etwas gelernt?"**
Der Cron schreibt seit v3.0 jede Minute Snapshots nach D1 — je zehn gemessene Kennzahlen
und, nach Ablauf des Lernhorizonts, das tatsächliche Ergebnis (`max_pct`/`min_pct`).
Ausgewertet wurde daraus bisher **nur die Trefferquote je Setup** (Modul 0). Die Frage,
*wie ein Titel VOR der Bewegung aussah*, hat nie jemand gestellt.

### Befund beim Nachsehen: der wichtigste Teil wurde nie mitgeschrieben

`payload` speicherte `{setup, phaseAction, verdict}`. Die **neun Situationstypen** der
Situation Engine (SQUEEZE RELEASE, BREAKOUT PRESSURE, …), die Lebenszyklus-Phase und die
Reife — also genau das, was die Oberfläche seit v3.4.3 anzeigt und woran der Nutzer sich
orientiert — standen **nie** im Snapshot. Modul 0 gruppiert deshalb bis heute nach dem
alten, groben `setup` und konnte über die Situationstypen strukturell nichts lernen.

**Das lässt sich nicht rückwirkend heilen.** Was nicht aufgezeichnet wurde, ist weg. Ab
v3.17.0 schreibt `snapshotPayload()` Situation, Lebenszyklus, Reife und Prioritätssektor
mit — an **einer** Stelle für beide Schreibpfade (Lehre aus v3.10.0, wo `sectorLag` nur
auf einem Pfad berechnet wurde). Ein Test zählt die Aufrufer. In der Oberfläche steht
ausdrücklich, wie viele der ausgewerteten Fälle schon einen Situationstyp tragen.

### Was das Labor rechnet

Eine **Ereignisstudie** über aufgelöste Snapshots, gruppiert nach Ausgang: gestiegen
(≥ 5 %), gefallen (≤ −1,5 %), seitwärts.

- **Fingerabdruck:** je Kennzahl der Median der Fälle, die danach stiegen, gegen den der
  Fälle, die danach fielen. Liegen die Balken übereinander, kündigt die Kennzahl nichts an.
- **Verlauf:** der mediane Kursweg von 60 Minuten vor bis 120 Minuten nach der
  Aufzeichnung. Die linke Hälfte ist die interessante.
- **Trennschärfe** als AUC gegen eine Zufallsgrenze, die mit sinkender Fallzahl steigt.

### Vier Ehrlichkeitsregeln, die hier härter greifen als sonst

1. Nur aufgelöste Snapshots — kein Repainting.
2. **Episoden statt Snapshots.** Vier Aufnahmen derselben Bewegung sind nicht vier Fälle.
3. Unter 20 Fällen je Gruppe gibt es **kein** Urteil — auch kein vorsichtiges.
4. **Mehrfachtestkorrektur.** Siehe unten; das ist der wichtigste Punkt.

### Der Regressionstest hat sofort einen echten Fehler gefunden

Der erste Entwurf prüfte alle zehn Kennzahlen gegen 95 %. Bei zehn gleichzeitigen Tests
findet man rein rechnerisch in jedem zweiten Durchlauf eine „Entdeckung", die keine ist —
und genau das meldete der Test beim ersten Lauf. Die Zufallsgrenze bezieht sich jetzt auf
die Zahl der geprüften Kennzahlen (α = 0,05/k, bei k = 10 also z = 2,81 statt 1,96). Die
Hürde steigt von 0,604 auf 0,649 bei 60/60 Fällen. Modul 0 korrigiert seit v3.5.4 aus
demselben Grund.

**Das war kein Testfehler, sondern ein Codefehler** — gefunden, weil gegen bekannte
Wahrheit geprüft wird statt gegen Plausibilität.

### Nachweise, ausgeführt gegen gestellte Daten mit bekanntem Inhalt

| Fall | Erwartung | Ergebnis |
|---|---|---|
| Eingebauter Unterschied in RVOL, 120 Fälle | wird gefunden | AUC 1,0 > Grenze 0,649 → „trennt" |
| Die neun übrigen Kennzahlen | melden nichts | alle „kein Signal" |
| Reines Rauschen, 5 × 10 Kennzahlen | keine Funde | **0 von 50** |
| 10/10 Fälle | kein Urteil | alle „zu wenige Fälle" |
| Keine Datenbank | keine Behauptung | `state:'nodb'` |

### Negativkontrolle

| zurückgedreht | Test |
|---|---|
| Mehrfachtestkorrektur entfernt | fällt |
| Zufallsgrenze abgeschafft | fällt |
| Mindeststichprobe ignoriert | fällt |
| Episoden nicht mehr zusammengefasst | fällt |
| Situationstyp wieder aus dem Snapshot entfernt | fällt |
| Lücken im Verlauf interpoliert | fällt |
| Ampelgrün als Musterfarbe | fällt |

### Zwei Tests waren zuerst blind — beide von der Negativkontrolle aufgedeckt

1. Die Fixture gab jedem Fall ein eigenes Symbol **und** einen eigenen Tag. Damit war
   `collapseEpisodes()` wirkungslos und der Test konnte gar nicht sehen, ob Episoden
   zusammengefasst werden. Jetzt enthält die Fixture vier Aufnahmen je Bewegung.
2. Danach fiel der Test aus dem falschen Grund: Fixture-Zeitpunkte rutschten über
   UTC-Mitternacht, und `collapseEpisodes()` gruppiert nach Kalendertag. In Produktion
   unmöglich — US-Handel liegt 13:30–20:00 UTC. Die Fixture liegt jetzt in der Sitzung.

### Gestaltung: bewusst keine Ampelfarben

Blau = stieg danach, Violett = fiel danach, Grau = seitwärts. Grün/gelb/rot bedeuten in
dieser App „handelbar" — eine Beobachtung über die Vergangenheit darf sich diese Bedeutung
nicht ausleihen, sonst liest man ein Kaufsignal in eine Statistik hinein. Ein Test verbietet
jede Ampelfarbe in der Farbtabelle.

**0 % Gewicht in Score, Gate, Ampel und Freigabe. Es wird nichts automatisch geändert.**

---

## 7. Neu in v3.18.0 — vier Punkte aus einem Befund

### 7.1 Freigabe-Trichter: woran hängt es?

**Das ist die eigentliche Konsequenz aus der verlorenen Woche.** Um herauszufinden, dass
`netCRV` das Gate war, brauchte es ein Wegwerf-Skript. Für den Radar gibt es seit v3.4.0
`radarGateStats` — für die **Freigabekette** gab es nichts. Deshalb war ein Fehler, der in
jedem Durchlauf passierte, wochenlang unsichtbar.

Der Trichter zählt zwei Zahlen je Gitter:
- **fett** — wie oft war diese Bedingung verletzt
- **kursiv** — wie oft war sie die **einzige** verletzte

Die kursive Zahl ist die wichtige. Sie beantwortet „woran hängt es wirklich" und entlarvt
zugleich **tote Gitter**: eine Bedingung, die nie greift, sichert nichts — sie täuscht
Sicherheit vor. Bedingungen ohne einen einzigen Treffer werden als „nie gegriffen"
ausgewiesen.

**Keine Zweitrechnung.** `stockTradeability()` gibt seine Einzelurteile jetzt mit heraus
(`crvOk`, `tp2Ok`, `hasSize`, `minTp2`) — dieselben Ausdrücke, nur zusätzlich benannt.
Eine zweite Rechnung könnte von der ersten abweichen; genau das hat in v3.10.0 `sectorLag`
auf einem Datenpfad verhungern lassen.

**In Modus A wird nicht gezählt, sondern erklärt.** Dort gibt es per Entwurf keine
Freigabekette. Sie trotzdem zu zählen, hieße „Ampel nicht grün" als Grund anzuzeigen,
obwohl die Kette gar nicht durchlaufen wird.

### 7.2 Korrektur meiner eigenen Empfehlung zum toten Gate

Ich hatte vorgeschlagen, `MIN_REWARD_RISK_FIXED = 2,0` zu entfernen, weil es nie bindet.
**Diese Empfehlung war zu schnell.** Gemessen habe ich einen Median von 18,5 — aber nur an
der *Modus-A-Geometrie*. Im ChatGPT-Strang mit seinen deutlich engeren Zielen kann dieselbe
Schwelle sehr wohl binden. Statt sie auf Verdacht zu streichen, misst der Trichter jetzt,
ob sie greift. Entfernt wird sie erst, wenn Daten dafür sprechen.

### 7.3 Zielweite: gemessen statt geraten

Seit v3.9.0 stand dreimal „geraten, nicht gemessen" auf der Liste, mit der Begründung, es
brauche Zähler aus einem laufenden Handelstag. **Das stimmte nicht:** `max_pct` und
`atr_pct` liegen längst je Snapshot in D1.

Das Musterlabor rechnet jetzt die Verteilung von `max_pct / atr_pct` — wie viele
Schwankungsbreiten eine Bewegung nach der Aufzeichnung noch läuft. Ausgewiesen wird die
**Erreichungsquote je Zielweite** („Ziel bei 1,0× wurde in 58 % der Fälle erreicht"), weil
das aussagekräftiger ist als jedes Perzentil. Der heute eingestellte Faktor 1,0 ist
markiert. Unter 20 Episoden gibt es wieder nur den Füllstand, kein Ergebnis.

Für `MOM_MIN_DOLLARVOL` fehlte die Größe in der Aufzeichnung — derselbe Fall wie die
Situationstypen. Ab v3.18.0 wird der Dollarumsatz mitgeschrieben. **Rückwirkend geht auch
das nicht.**

### 7.4 Sektor-Reserve zieht aus dem Katalog (P-A4)

Der reservierte Platz zog bisher nur aus `radar.rows`. Bei 0 von 52 Edelmetall-Tickern im
Large-Cap-Radar verfiel er an den meisten Tagen still. Jetzt springt der Katalog ein, wenn
der Radar für einen Sektor nichts liefert — **mit Vorrang für den Radar** und mit eigener
Kennzeichnung (`sectorFillFromCatalog`), weil ein Katalogtitel keine Radar-Nominierung ist.

Beim Testen fiel auf, dass die Reserve damit nur so viel nützt wie der Katalog hergibt —
und dort standen für Edelmetalle **genau zwei** Titel. Der rotierende Einstieg hätte immer
dieselben gezogen. Der Katalog ist deshalb ergänzt:

| Sektor | Reserve-Pool vorher | jetzt |
|---|---|---|
| Pharma/Healthcare | 7 | 11 |
| Edelmetalle/Minen | 2 | **9** |
| Technologie | 21 | 21 |

Ein Test verlangt für jeden Prioritätssektor mindestens fünf Katalogtitel — sonst wiederholt
sich P-A4 in neuer Form.

### Negativkontrolle

| zurückgedreht | Test |
|---|---|
| Trichter rechnet die Gates selbst nach | fällt |
| „einzige offene Bedingung" nicht mehr gezählt | fällt |
| Tote Gitter nicht mehr ausgewiesen | fällt |
| Trichter zählt auch in Modus A | fällt |
| Kalibrierung zeigt Faktor trotz zu weniger Daten | fällt |
| Katalog-Reserve springt immer ein | fällt |
| Edelmetall-Katalog wieder dünn | fällt |
| Dollarumsatz nicht mehr mitgeschrieben | fällt |

### Der Harness konnte Anzeige gar nicht prüfen

`querySelector` gab bei **jedem** Aufruf ein neues Stub-Element zurück. Damit ließ sich nur
feststellen, dass eine render-Funktion nicht abstürzt — nicht, was sie schreibt. Dieselbe
Lücke wie beim `style`-Stub in v3.15.0. Elemente werden jetzt je Selektor gemerkt und sind
über `el(sel)` auslesbar. Erst dadurch ist der Trichter überhaupt nachweisbar.

### Zwei Tests waren zuerst blind

1. Die Prüfung des Trichters sah nicht, wenn die Zählung „einzige offene Bedingung"
   wegfällt — also genau der Teil, der den ganzen Nutzen ausmacht.
2. Ein Vergleich fiel aus dem falschen Grund: Arrays aus dem VM-Kontext des Clients haben
   einen anderen Prototyp und scheitern an `deepStrictEqual`. Jetzt wird der Inhalt
   verglichen, nicht die Identität.

### Fehler im Arbeitsablauf — zum zweiten Mal derselbe

Ein Rückbau-Skript aus v3.17.0 stellte am Ende Sicherungskopien wieder her, die **vor** den
v3.18.0-Änderungen gezogen worden waren, und überschrieb damit die halbe Version.
Aufgefallen ist es sofort — die Suitezahl fiel von 37 auf 7. Wiederhergestellt aus der
Sicherung des aktuellen Stands, danach alle Nachweise erneut geführt.

**Ich hatte genau diese Lehre in v3.16.0 selbst aufgeschrieben und sie trotzdem wiederholt.**
Die Konsequenz steht jetzt schärfer in der Übergabe: Rückbau-Skripte gehören nach dem Lauf
gelöscht, nicht aufbewahrt.

---

# Kurzfassung ohne Technik

## Was jetzt funktioniert

**Die App verspricht dir keine Kaufempfehlung mehr, die sie nie einlösen konnte.** Im
Momentum-Modus stand bisher irgendwo ein Kauf in Aussicht, der praktisch nie kam. Der
Grund war ein Konstruktionsfehler: Der Momentum-Modus rechnet seinen eigenen Plan —
Einstieg, Stop, Ziele — und wurde dann an einer Kennzahl des **anderen** Bewertungs-
verfahrens gemessen, die zu einem ganz anderen Plan gehört. Der wurde dir nie gezeigt.
Deshalb konnte fast nichts durchkommen, egal wie gut ein Titel lief.

**Statt einer Ampel steht jetzt ehrlich „Kandidat".** Du bekommst weiterhin alles, was du
zum Entscheiden brauchst: den vollständigen Plan mit Einstieg, Stop und beiden Zielen, den
Euro-Betrag, was du am Stop verlierst, und in Klartext, woran es gerade noch hängt. Was
weg ist, ist die Behauptung, die App habe für dich entschieden. Das war der Punkt, an dem
sie unehrlich war.

**Das andere Verfahren bleibt unverändert.** Wenn du den Momentum-Modus in den
Einstellungen ausschaltest, gibt es weiter echte Kauf-Freigaben nach den bisherigen
Regeln. Daran wurde nichts angefasst, und es wird eigens geprüft.

**Du kannst Quartalstermine jetzt selbst eintragen.** Unter der Terminliste steht ein
Feld für Kürzel, Datum und „vor Börsenbeginn / nach Börsenschluss". Ein selbst
eingetragener Termin gilt vor dem automatischen Kalender und funktioniert auch dann, wenn
der im gebuchten Tarif nichts liefert. An jedem Eintrag steht dabei, ob er gerade wirkt:
Eine Warnung erscheint nur für Termine von heute bis in 14 Tage, und in der Liste darüber
erscheinen nur Titel, die gerade analysiert werden. Ohne diese Hinweise hättest du einen
Termin eingetragen, nichts gesehen und die Maske für kaputt gehalten. Angezeigt wird immer
der Stand vom Server: Was dort steht, ist wirklich gespeichert. Löschen braucht zwei
Klicks, weil damit auch die Warnung vor den Zahlen verschwindet.

**Zwei tote Aktienkürzel sind raus.** In der Edelmetall-Liste stand Credit Suisse — die
Aktie wurde im Juni 2023 von der Börse genommen — und ein kanadisches Kürzel, das im
US-Datenstrom gar nicht vorkommt. Beide haben nur Platz belegt.

## Was noch offen ist

**Edelmetalle erreichen den Scanner fast nie.** Ich habe es ausgezählt: Von 52 Titeln
deiner Edelmetall-Liste steht **kein einziger** auf der Schnellliste des Scanners und nur
einer im festen Katalog. Alle anderen kommen nur herein, wenn sie an einem Tag über 3 %
laufen **und** sehr hohen Umsatz haben — für einen Minenwert eine seltene Kombination. Der
„eine reservierte Platz pro Bereich" aus der letzten Version läuft für Edelmetalle deshalb
meistens ins Leere. Zu beheben, indem die Reserve auch aus dem festen Katalog ziehen darf.

**Palladium bekommst du über diese App gar nicht.** Es gibt keine US-Aktie, die reines
Palladium abbildet. Die großen Produzenten sitzen in Russland und Südafrika, der einzige
handelbare Weg wäre ein Rohstoff-Fonds — und Fonds sortiert die App bewusst aus, weil sie
Aktien analysiert und keine Fondsanteile. Von deiner Liste hat nur Sibanye-Stillwater
nennenswerten Palladium-Anteil. Das ist keine Einstellung, die man ändern kann; das ist
der Markt.

**Das Kursziel im Momentum-Modus ist zu weit.** Es liegt eine volle Tagesspanne über dem
Ausbruch. Bei einem Titel, der schon 8 % gelaufen ist, heißt das nochmal 8 % obendrauf —
das wird selten erreicht. Ich möchte das nicht ohne echte Zahlen aus einem laufenden
Handelstag nachjustieren, sonst rate ich nur anders.

**Die Situationstypen haben noch keine Historie.** Ich habe beim Nachsehen gemerkt, dass
ausgerechnet die neun Mustertypen, die dir die App anzeigt, nie mitaufgezeichnet wurden —
gespeichert wurde nur ein älterer, gröberer Name. Ab jetzt wird es mitgeschrieben, aber
rückwirkend geht das nicht. In ein paar Wochen kann das Labor auch danach auswerten. Bis
dahin steht in der App, wie viele Fälle schon einen Typ tragen.

**Drei Zahlen im Momentum-Modus sind weiterhin geschätzt.** Wie viel Umsatz ein Titel
haben muss und wie eng eine Kursberuhigung sein darf. Dafür brauche ich die Zähler aus
einem US-Handelstag.

**Immerhin eine Vermutung ist erledigt.** Ich hatte seit Monaten notiert, die Erkennung
einer Kursberuhigung sei vermutlich zu streng. Ich habe es an 20.000 simulierten
Kursverläufen durchgerechnet: Sie greift bei 93 % der echten Bewegungstitel. Der Punkt
war falsch und ist von der Liste.

**Du siehst jetzt, woran es hängt.** Über der Kandidatenliste steht eine Zeile wie
„3 von 18 frei" und darunter, welche Bedingung wie oft im Weg war — und vor allem, bei wie
vielen sie die **einzige** war. Genau diese Anzeige hätte den Fehler der letzten Woche in
einer Stunde sichtbar gemacht statt in sieben Tagen.

**Die Zielweite ist zum ersten Mal gemessen.** Die App rechnet aus den eigenen
Aufzeichnungen aus, wie oft ein Kursziel in der Vergangenheit tatsächlich erreicht wurde.
Sie ändert damit nichts automatisch — aber du siehst schwarz auf weiß, ob das eingestellte
Ziel realistisch ist.

**Deine drei Wunschbereiche kommen jetzt wirklich dran.** Der reservierte Platz für
Edelmetalle lief bisher meistens leer, weil der Scanner in diesem Bereich fast nie etwas
fand. Jetzt zieht er ersatzweise aus einer festen Liste — und die ist für Edelmetalle von
zwei auf neun Titel gewachsen.

**Das Musterlabor kann dir sagen, ob überhaupt etwas drinsteckt.** Und das ist der
ehrlichste Teil: Es zeigt genauso deutlich, wenn KEIN Muster da ist. Wenn die blauen und
violetten Balken übereinanderliegen, heißt das: Diese Kennzahlen kündigen die Bewegung
nicht an. Das ist ein Ergebnis, kein Fehler — und es ist mehr wert als eine erfundene
Regelmäßigkeit, die wie Wissen aussieht.

**Nichts mehr offen aus dem vorherigen Gespräch.** Die Eingabemaske für Quartalstermine
ist jetzt auch geprüft und gilt damit als fertig.
