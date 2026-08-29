# FusionPulse v3.11.0 · Aufmerksamkeitsimpuls und Quartalszahlen-Tafel

Zwei Wünsche, beide umgesetzt. Beim Blinken habe ich eine Einschränkung eingebaut, die
ich unten begründe — sie ist der Grund, warum der Impuls überhaupt funktioniert.

23 Testsuiten grün in zwei Zeitzonen, vier SHA-Blöcke identisch, Negativkontrolle für
alle acht Änderungen. **Kein Score, keine BUY-Logik berührt.**

---

## 1. Aufmerksamkeitsimpuls — bewusst sparsam

Der Wunsch war, Empfehlungen dieser Art blinkend hervorzuheben. Umgesetzt, aber mit
einer harten Regel:

> **Es pulsiert ausschließlich der stärkste NEUE Sektor-Nachzügler, und nur einmal.**

Der Grund ist praktisch, nicht kosmetisch. Wenn bei jedem Scan sechs Karten blinken, ist
das nach zwei Minuten Tapete, und du siehst darüber hinweg. Der Impuls ist genau so viel
wert, wie er selten ist. Ein Titel, der seit zwanzig Minuten hinterherhinkt, ist keine
Neuigkeit mehr — der pulsiert nicht noch einmal.

Konkret:

- **neu** = dieses Symbol hat in dieser Sitzung noch nicht pulsiert
- **stärkster** = größter Rückstand des aktuellen Durchlaufs, also nur eine Karte
- **einmalig** = nach 24 Sekunden ist Schluss, kein Dauerzustand
- Zusätzlich ein Eckabzeichen **NEU**, damit die Karte auch ohne Bewegung erkennbar ist

**Weicher Puls statt hartem Blinken.** Hartes Blinken ermüdet bei längerer
Bildschirmarbeit, ist in seltenen Fällen ein Auslöser für photosensitive Reaktionen, und
es lässt sich schlecht ignorieren, wenn man gerade etwas anderes liest. Der Puls fällt
auf, ohne sich aufzudrängen.

**`prefers-reduced-motion` gewinnt immer.** Das ist eine Systemeinstellung des Nutzers
und keine Empfehlung — dort bleibt der Rahmen statisch hervorgehoben, ohne Animation.
Dazu ein eigener Schalter in den Einstellungen: *Neuen Sektor-Nachzügler kurz
hervorheben*, standardmäßig an.

---

## 2. Quartalszahlen-Tafel nach Sektor

📅 **Quartalszahlen · nach Sektor** — die nächsten 14 Tage, gruppiert nach Branche,
innerhalb der Gruppe nach Nähe des Termins sortiert. Sektoren mit dem nächstliegenden
Termin stehen oben.

Jede Zeile zeigt Ticker, „heute/morgen/in N Tagen", **nB** (nach Börsenschluss) oder
**vB** (vor Börsenbeginn), das Datum, die Quelle und die flatex-Handelbarkeit. Klick
öffnet den Titel im Fokusfenster. Termine binnen 24 Stunden sind farblich hervorgehoben
— und nur die, sonst verliert die Hervorhebung ihren Zweck.

### Zwei Beschränkungen, die ich bewusst gesetzt habe

**Nur Titel, die FusionPulse tatsächlich analysiert hat.** Das ist die Antwort auf
„vorausgewählte interessante Aktien": Favoriten, Radar-Kandidaten und Katalogtitel des
laufenden Scans. Der Grund ist zwingend — nur für diese Titel gibt es einen verifizierten
Sektor, und ein Termin ohne Sektor wäre in einer nach Sektoren geordneten Liste wertlos.

**Manuell gepflegte Termine schlagen automatische.** Wenn du einen Termin selbst
eingetragen hast, gilt deiner.

### Was du wahrscheinlich sehen wirst

Die automatische Quelle ist `earnings_calendar` von Twelve Data, und ob die im gebuchten
Tarif enthalten ist, war schon bei der Implementierung in v3.8.2 unklar. Wenn sie nichts
liefert, sagt die Tafel das ausdrücklich:

> *Der Terminkalender hat geantwortet, aber keine verwertbaren Termine geliefert.
> Möglicherweise ist er im gebuchten Tarif nicht enthalten. Manuell eingetragene Termine
> erscheinen hier weiterhin.*

Statt leer und unerklärt dazustehen. Jeder der vier möglichen Ausfallgründe hat einen
eigenen Text, und ein Test prüft, dass keiner davon verschwindet.

**Falls die automatische Quelle leer bleibt**, wird die Tafel erst mit **P6 Teil 1b**
richtig nützlich — der Eingabemaske für manuelle Termine. Die Route `POST /api/earnings`
funktioniert bereits, nur die Oberfläche fehlt. Das ist kleiner Aufwand und wäre der
logische nächste Schritt.

---

## Nachweise

- 23 Suiten grün, `TZ=Europe/Vienna` und `TZ=America/Chicago`
- Vier Claude-SHA-Blöcke unabhängig nachgerechnet: identisch
- Erreichbarkeits-Audit sauber
- **Funktionsnachweis:** `markAttention` wird aus dem Quelltext extrahiert und
  ausgeführt — erster Aufruf pulsiert, zweiter mit demselben Symbol nicht mehr,
  abgeschaltet nie.
- **Negativkontrolle**, jede Änderung einzeln zurückgedreht:

| zurückgedreht | Test |
|---|---|
| `prefers-reduced-motion`-Block | fällt |
| Abschaltmöglichkeit des Impulses | fällt |
| Impuls auf allen Karten statt nur der stärksten | fällt |
| Wiederholungssperre pro Sitzung | fällt |
| Beschränkung auf analysierte Titel | fällt |
| Erklärtext bei leerem Kalender | fällt |
| Sortierung nach Termin-Nähe | fällt |
| Quartalszahlen-Tafel umbenannt | fällt |

### Ein Fehler in meinem eigenen Test
Zwei Rückdrehungen blieben zunächst grün. Ursache war beide Male der Test, nicht der
Code: Ich hatte die Terminliste **vor** dem Impuls-Block eingefügt, mein Slice lief also
rückwärts und war leer — ein leerer String besteht jede `assert.match`-Prüfung nicht,
aber der davor liegende Slice-Fehler ließ die falsche Zeile schlagen. Jetzt prüft eine
Zeile ausdrücklich, dass der Block überhaupt gefunden wurde:

```js
assert.ok(pulse.length > 100, 'leerer Slice waere ein blinder Test');
```

Das ist die dritte Testschwäche in vier Versionen, die erst die Negativkontrolle
aufgedeckt hat. Sie bleibt fester Bestandteil jeder Auslieferung.

Nach dem Deploy `Cmd+Shift+R`.
