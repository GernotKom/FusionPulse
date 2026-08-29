# FusionPulse v3.21.0 — Was einen Pick wirklich wertvoll macht

Additiv, aber diesmal mit einem Eingriff in die Lernschicht selbst. **Score,
Ampel, Gate, Sizing und Freigabe sind unverändert**, die vier SHA-verriegelten
Claude-Modus-Blöcke ebenfalls.

---

## 1. Die 5-%-Schwelle ist weg — überall

Bis v3.20.0 stand an vier Stellen die Zahl 5: `ATTR.WIN_PCT`, `d1TwinFor`,
`patternLab` und der Auflöser. Sie war nie hergeleitet. Ab jetzt wird die
Schwelle **gerechnet**:

```
ECON_FIX_EUR = 2 × 11,50 € + 0,15 % × 10.000 €        =  38,00 €
ECON_WIN_PCT = (120 € / 0,725 + 38 €) / 10.000 × 100  =   2,04 %
ECON_STOP_PCT = −ECON_WIN_PCT / 2                      =  −1,02 %
```

Ändert sich eine Kostenkonstante, wandert die Schwelle mit — und mit ihr jede
Statistik der App. Die alte Zahl bleibt als `LEGACY_WIN_PCT` erhalten, steuert
aber nichts mehr; sie wird nur noch **zum Vergleich daneben** angezeigt.

Das macht die historischen Auswertungen nicht unvergleichbar, sondern erstmals
richtig: dieselben Aufzeichnungen werden neu ausgezählt, nur gegen die Schwelle,
die für dich zählt.

---

## 2. Die Messung, die gefehlt hat: `mae_pre`

`min_pct` ist das Minimum über das **ganze** Lernfenster — auch nach dem Ziel.
Wer damit prüft, ob ein Stop gerissen hätte, bestraft Gewinner für einen
Rückgang, den sie nie miterlebt haben: der Trade war da längst zu.

Neu wird **MAE-vor-MFE** aufgezeichnet — die schlimmste Gegenbewegung, die man
aushalten musste, *bevor* der Höchststand kam.

Der erste Entwurf fror den Wert an der 2-%-Marke ein. Das war falsch: dann wäre
die Zahl nur für Ziele bis 2 % gültig gewesen, und ein Setup, das 1,8 % Luft
braucht und dafür 4,2 % liefert, wäre fälschlich als unhandelbar ausgewiesen
worden. Jetzt gilt: um `max_pct` zu erreichen, musste man `mae_pre` aushalten —
für jedes kleinere Ziel ist das eine **Obergrenze**, also die vorsichtige
Richtung.

Fehlt der Wert (alte Zeilen), wird auf `min_pct` zurückgefallen. Fail-closed:
fehlende Daten machen es nie besser.

---

## 3. Die eigentliche Neuerung: zwei Fragen auseinanderhalten

Ein Situationstyp kann aus **zwei gegensätzlichen Gründen** nichts einbringen:

| Ursache | Was du dagegen tun kannst |
|---|---|
| 💤 **bewegt sich nicht weit genug** | anderer Kandidatenkreis — ein engerer Stop hilft *nicht* |
| 🌊 **bewegt sich, schüttelt aber vorher heraus** | anderer Stop, anderer Einstieg, andere Positionsgröße |

Vorher waren beide als „Erwartungswert negativ" ununterscheidbar. Genau das war
die Sackgasse: man sah, dass nichts herauskam, aber nicht, warum.

Die Kachel zeigt jetzt je Typ die **nötige Luft** — den Stopabstand, der 80 %
der Gewinner im Trade gehalten hätte. Liegt er über deinem erlaubten Stop, steht
da wörtlich: *„Diese Bewegung ist da, sie ist mit 10.000 € fix nur nicht
greifbar."*

Ein Beispiel aus dem Testlauf, das genau diesen Fall zeigt: ein Typ mit **62 %
Trefferquote auf 4,5 % Bewegung** — nach jeder üblichen Kennzahl hervorragend —
scheitert an 2,2 % nötiger Luft. Bei 2,04 % Ziel sind nur 1,02 % erlaubt. Kein
Score dieser Welt hätte das gezeigt.

---

## 4. Rastersuche nach dem besten Ziel/Stop-Paar

Das Kostenmodell liefert ein *zulässiges* Paar (2,04 % / −1,02 %), nicht
zwangsläufig das beste. Die App durchsucht deshalb rund 350 Kombinationen
(Ziel 2,04–6,0 %, Stop 0,3 % bis Ziel/2) und meldet das ertragreichste.

**Mit Überanpassungs-Bremse**, denn genau hier lauert die Selbsttäuschung:

- Gesucht wird auf den **älteren 70 %** der Episoden, geurteilt auf den
  **jüngeren 30 %**.
- Der Nachweisteil braucht mindestens 12 Episoden — die Rastersuche läuft
  damit erst ab rund 40 Episoden überhaupt an.
- Der Abstand zwischen Such- und Nachweisteil wird mit **gleicher Rechenart**
  gebildet. *(Mein erster Entwurf verglich Punktschätzung gegen
  Wilson-Untergrenze — dabei sieht buchstäblich jedes Paar überangepasst aus,
  weil der Unterschied aus der Rechenart kommt und nicht aus den Daten.)*
- Die Grenze für „überangepasst" ist **keine feste Zahl**, sondern wächst mit
  dem Stichprobenrauschen: erst ein Abstand über 1,5 Standardfehlern zählt.
  Eine feste 40-€-Grenze hätte bei zwölf Nachweis-Episoden ständig ausgeschlagen.
- Ein Paar, das die Prüfung nicht besteht, wird **angezeigt, aber nicht zum
  Ranken benutzt**.

Rangiert wird am Ende mit dem **besseren** der beiden Pläne — dem aus dem
Kostenmodell oder dem gesuchten, letzterer nur bestätigt.

Ein Rundungsfehler war dabei real und hat einen tragfähigen Fall fälschlich
verworfen: gesucht wurde mit 1,7999999, geprüft mit 1,80 — genau an der Grenze,
wo die Gegenbewegung den Stop berührt, kippt das Ergebnis. Jetzt wird **vor** der
Auswertung gerundet.

---

## Wie das geprüft ist

Neue Suite 40, `✓ FusionPulse v3.21.0 heat/verdict/grid regressions`. Die
Ursachentrennung wird mit Fixtures geprüft, die sich **ausschließlich** in der
Vor-Hitze unterscheiden — gleiche Episodenzahl, gleiche Zielberührungen, nur
0,5 % gegen 1,9 % Luft. Ergibt „handelbar" gegen „zu verrauscht".

**Sechs Negativkontrollen gefahren**, alle greifen:

1. `mae_pre` wird ignoriert → fällt
2. fehlendes `mae_pre` optimistisch als 0 behandelt → fällt
3. Verrauscht-Erkennung abgeschaltet → fällt
4. Überanpassungs-Bremse gelöst → fällt
5. Rundung wieder nach hinten verschoben → fällt
6. Vergleich wieder mit verschiedenen Rechenarten → fällt

Ende-zu-Ende-Lauf mit vier Situationstypen: echter Worker-Kern rechnet, echtes
`app.js` rendert. Ergebnis der Rangfolge:

```
SOFI   belegtPositiv   EV  +40 €   Ziel 3,24 / Stop −0,70   Live-Score 38
NEU    duennPositiv    EV  +42 €   Ziel 2,04 / Stop −1,02   Live-Score 80
LAUT   belegtNegativ   EV  −92 €   bewegt sich nicht weit genug   Live-Score 99
MRNA   belegtNegativ   EV −140 €   zu verrauscht                  Live-Score 71
```

Beachte Platz 1 und 2: `NEU` hat den **höheren** Erwartungswert (+42 gegen +40)
und steht trotzdem darunter — weil er auf 9 Episoden beruht und `SOFI` auf 240.
Das ist die Fail-Closed-Regel bei der Arbeit. Und `LAUT` mit Live-Score 99 steht
unten.

`npm run check` → 40 Suiten grün. `npm run audit:reach` → ohne Fund.

---

## Was jetzt funktioniert

- **Jeder Pick kommt mit einem konkreten Plan.** Nicht „Score 71", sondern
  „Ziel 3,24 %, Stop −0,70 %, typisch 38 Minuten, erwartet +40 € netto".
- **Du siehst die Ursache, nicht nur das Ergebnis.** Wenn ein Setup nichts
  einbringt, steht dabei ob es sich zu wenig bewegt oder ob es dich vorher
  herausschüttelt. Das sind völlig verschiedene Konsequenzen: im ersten Fall
  brauchst du andere Titel, im zweiten einen anderen Stop.
- **Die App findet selbst das beste Ziel/Stop-Paar** — und sagt dazu, ob der
  Fund einen unabhängigen Nachweis überstanden hat oder nur schön aussah.
- **Alle Statistiken messen endlich dasselbe** wie deine Kostenrechnung.
- **Ein lauter Kandidat ohne Beleg drängelt sich nicht mehr vor**, und einer mit
  dünnem Beleg nicht vor einen mit dickem — selbst wenn seine Zahl höher ist.

## Was noch offen ist

- **`mae_pre` ist nicht rückwirkend füllbar.** Der Kursverlauf zwischen den
  Aufzeichnungen ist nicht gespeichert. Für alte Zeilen fällt die App auf die
  pessimistische Variante zurück, was Setups schlechter aussehen lässt, als sie
  sind. Das legt sich über einige Wochen von selbst.
- **Die Rastersuche braucht rund 40 Episoden je Typ**, ein belastbares Urteil
  eher 150–250. Vorher zeigt die Kachel Zwischenstände und sagt das auch.
- **Der Erwartungswert unterstellt, dass du den Plan auch ausführst** — Einstieg
  zum aufgezeichneten Preis, Ausstieg am Ziel. Er misst, ob der Kurs die
  Zielweite berührt hat, nicht ob du dort verkauft hättest.
- **Gruppiert wird nach Situationstyp, nicht je Symbol.** Feiner (Typ × Sektor,
  Typ × Tageszeit) wäre möglich, erzeugt bei der aktuellen Datenmenge aber
  Rauschen statt Erkenntnis.
- **Der Live-Score wurde nicht angefasst.** Die 14 handgesetzten Koeffizienten
  in `situationScore` sind weiterhin ungeprüft. Sobald genug Episoden vorliegen,
  ließe sich jeder einzelne gegen die Ergebnisse testen — das wäre der nächste
  Schritt und ist bewusst nicht in dieser Version.
- **Alle offenen Punkte aus v3.18.0 bleiben offen.**
