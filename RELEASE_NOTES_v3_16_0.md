# FusionPulse v3.16.0 · Modus A gibt keine Kauf-Freigabe mehr (Variante 2)

Anlass war eine Rückmeldung, die sich als berechtigt herausgestellt hat: *„seit einer
Woche gab es noch nie eine realistische Aktienempfehlung."* Gemeint waren **alle** Titel
der Fokuskarte, nicht nur Edelmetalle.

34 Testsuiten grün in zwei Zeitzonen, vier SHA-Blöcke unabhängig nachgerechnet,
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

- 34 Suiten grün, `TZ=Europe/Vienna` und `TZ=America/Chicago`
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

**Drei Zahlen im Momentum-Modus sind weiterhin geschätzt.** Wie viel Umsatz ein Titel
haben muss und wie eng eine Kursberuhigung sein darf. Dafür brauche ich die Zähler aus
einem US-Handelstag.

**Immerhin eine Vermutung ist erledigt.** Ich hatte seit Monaten notiert, die Erkennung
einer Kursberuhigung sei vermutlich zu streng. Ich habe es an 20.000 simulierten
Kursverläufen durchgerechnet: Sie greift bei 93 % der echten Bewegungstitel. Der Punkt
war falsch und ist von der Liste.

**Die Eingabemaske für Quartalstermine liegt fertig, aber ungetestet.** Ich hatte sie
begonnen, bevor deine Rückmeldung kam, und dann zugunsten dieser Sache liegen lassen. Sie
kommt in der nächsten Version.
