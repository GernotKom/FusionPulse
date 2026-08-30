# FusionPulse v3.28.0 — Ein Name, und ein Tagebuch

Zwei Bausteine. Der eine ist der, nach dem du gefragt hast. Der andere ist der,
ohne den alles andere ins Leere misst.

---

## 1. „Nimmt Fahrt auf" — ein Name, oder Schweigen

Ganz oben, über beiden Märkten. Sie nennt **einen** Titel oder sie schweigt.

Der schwierige Teil war nicht das Finden, sondern das Schweigen. Eine Kachel,
die immer etwas anzeigt, wird nach zwei Wochen nicht mehr gelesen. Und bei
2,04 % Zielweite hat jemand, der einem Titel hinterherläuft, der schon oben
steht, sein Ziel bereits hinter sich.

**Alle Hürden müssen erfüllt sein:**

| Hürde | Warum |
|---|---|
| frischer Zustandswechsel | ein Titel, der seit zwanzig Minuten oben steht, nimmt keine Fahrt mehr auf |
| Umsatzstoß ≥ 60 % | ohne Umsatz ist Bewegung nur Rauschen |
| **Auslöser**: Quartalstermin ±3 Tage **oder** Eröffnungslücke ≥ 1,5 % | ohne Antrieb keine größere Position |
| Spread ≤ 30 % des Stopbudgets | 0,31 % — darüber frisst der Spread den Plan |
| noch nicht über 94 % der Tagesspanne | wer oben steht, hat das Ziel hinter sich |
| Restweg zum Tageshoch ≥ Zielweite | sonst ist der Plan geometrisch unmöglich |

**Was die App dabei nicht kann, und deshalb nicht behauptet:** Sie hat **keine
Nachrichtenquelle**. Sie erkennt den *Fingerabdruck* eines Auslösers — Lücke,
Umsatzstoß, Zustandswechsel — nicht den Auslöser selbst. Der einzige harte Beleg
ist ein Quartalstermin aus dem Kalender. Das steht so in der Meldung.

Im Ruhezustand zeigt sie klein, wie viele Kandidaten geprüft wurden und woran
die knappsten gescheitert sind. Eine Kachel, die nur schweigt, lässt offen, ob
sie noch lebt.

---

## 2. Die größere Position — aber richtig hergeleitet

Du sagst: bei gutem Momentum aus News oder Quartalszahlen ist ein größerer Trade
in Ordnung. Einverstanden — mit einer wichtigen Einschränkung.

**Größer ist erlaubt, weil der Stop enger sitzt. Nicht, weil das Setup sich
besser anfühlt.** Sonst ist „höhere Summe bei Überzeugung" nur ein anderes Wort
für „mehr riskieren, wenn man sich sicher fühlt" — und das ist der Weg, auf dem
Konten sterben.

Die Größe folgt deshalb aus einem **Risikobudget von 2 %**:

| Stop | Position | Verlust am Stop | Kostenlast |
|---|---|---|---|
| −2,00 % | 8.200 € | 199 € | 10,8 % |
| −1,02 % | **15.100 €** | 200 € | 14,8 % |
| −0,60 % | 20.000 € (gedeckelt) | 173 € | 22,1 % |

Bei 15.100 € statt 10.000 € bringt dasselbe 2,04 %-Ziel **194 € statt 120 €
netto** — bei unverändert 200 € Risiko.

**Ein Fehler, den mein erster Entwurf hatte:** das Budget rechnete nur den
Kursverlust. 200 € Budget ergaben eine Position, deren Stop tatsächlich 252 €
gekostet hätte — die Gebühren fielen genau dort unter den Tisch, wo die Position
wachsen soll. Jetzt ist das Budget der **volle** Verlust inklusive Kosten, und
ein Test verlangt, dass beide Zahlen übereinstimmen.

---

## 3. Handelstagebuch — Soll gegen Ist

**Das größte Loch der ganzen App, und es war nie im Code.** Sie misst den
*Markt*, nicht den *Händler*. Jede Lernschicht seit v3.20.0 rechnet mit einem
Phantom, das zum aufgezeichneten Preis kauft und exakt am Ziel verkauft.

Bei 1,02 % Stopweite sind zwei Zehntelprozent Ausführungsabweichung **ein
Fünftel deines Budgets**. Solange das nicht gemessen wird, kann die App beliebig
recht haben und der Kontostand trotzdem sinken.

Ein Rechenbeispiel aus dem Testlauf:

```
Plan   : 2,04 %  ->  252 € netto
Ist    : 1,72 %  ->  206 € netto     (0,18 % teurer eingestiegen)
Abstand:              −46 €          = 18 % des ganzen Vorteils
```

Du legst einen Trade als *geplant* an — mit einem Klick aus der Fahrt-Meldung
heraus — und trägst später die Kurse nach, die du **wirklich** bekommen hast.
Vier Zustände: geplant · offen · abgeschlossen · übersprungen. Ein
übersprungener Trade ist eine Information, kein Fehler, und verfälscht die
Bilanz der ausgeführten nicht.

Die Zusammenfassung nennt die einzige Zahl, die zählt: **was die Ausführung je
Trade kostet.** Die gehört in jede Erwartungsrechnung der App.

Keine Bewertung, keine Note. Ein Tagebuch, das seinen Führer belehrt, wird nicht
geführt.

---

## Fünftes Mal derselbe Fallstrick — diesmal vom eigenen Test gefangen

`Number(null)` ist **0**, nicht `NaN`. Ein fehlender Spread wäre als 0 %
durchgegangen, also als bestmöglicher Wert — ausgerechnet an der Hürde, die vor
unhandelbaren Titeln schützt.

Nach `pickCosts` (v3.23.0) und den drei Endpunkt-Parametern (v3.24.0) ist das
der fünfte Fall. Er wurde nur deshalb gefunden, weil ich diesmal die Prüfung
„unbekannter Wert darf nicht durchgehen" für *jedes* Feld einzeln geschrieben
habe, statt für den Idealfall.

---

## Prüfung

Suite 48, sieben Negativkontrollen, alle greifen:

Kosten aus dem Risikobudget · fehlender Spread als 0 · Katalysator-Pflicht
entfernt · Positionsdeckel entfernt · fehlende Nachrichtenquelle verschwiegen ·
leere Meldung belegt Platz · Risiko ohne Gebühren ausgewiesen.

Zusätzlich: jede der neun Hürden einzeln gebrochen, jede muss für sich zum
Schweigen führen. Und für jedes unbekannte Feld eine eigene Prüfung.

**48 Prüfungen grün**, Erreichbarkeits-Audit ohne Fund.

---

## Was du jetzt tun solltest

**Führe das Tagebuch, bevor du größere Positionen eingehst.** Zehn Einträge
reichen, um zu sehen, wie weit deine Ausführung vom Plan der App entfernt liegt.
Wenn dort systematisch 0,3 % stehen, ist die ganze 2-%-Rechnung tot — und dann
ist es besser, das nach zwei Wochen zu wissen als nach einem Jahr.

Die Fahrt-Meldung wird selten anschlagen. Das ist Absicht.

## Was noch offen ist

- **Der Auslöser bleibt unbekannt.** Ohne Nachrichtenquelle sieht die App nur
  den Abdruck. Prüfe die Meldungslage selbst, bevor du eine größere Position
  eingehst — die Meldung ist ein Grund hinzusehen, kein Kaufsignal.
- **Der Tageszeit-Effekt** ist weiter nicht abgebildet. Die erste halbe Stunde
  verhält sich anders als der Mittag.
- **Verpasste Gelegenheiten** werden nicht festgehalten. Eine App, die nie
  feuert, sieht in jeder Statistik großartig aus.
- **Größe nach Beleglage** — also die Position an den gemessenen Erwartungswert
  koppeln — wäre der nächste Schritt, aber ausdrücklich erst, wenn mehrere
  Situationstypen belastbare Urteile haben. Vorher wäre es Überanpassung mit
  Echtgeld.
