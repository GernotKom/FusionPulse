# FusionPulse v3.9.3 · Heatmap-Spuren

Ein Hotfix auf eine Meldung: *„Der grüne Strich zeigt mir nicht die Aktie, die nach
oben gezogen ist."*

Die Meldung war berechtigt und hat **zwei unabhängige Fehler** aufgedeckt, plus einen
dritten in meinem eigenen Test. Keine Bewertungslogik berührt, vier SHA-Blöcke identisch,
21 Suiten grün.

---

## Befund 1 · Die Spur endete nicht an ihrem Punkt

Der eigentliche Fehler, und ein hübsch versteckter.

Die Punkte der Heatmap laufen durch **15 Runden Kollisionsauflösung**: überlappende
Kreise werden auseinandergeschoben, damit alle Kürzel lesbar bleiben. Danach werden sie
zusätzlich auf den Bereich 10–190 begrenzt.

Die **Spuren** wurden anschließend aus den Rohkoordinaten neu berechnet — ohne diese
Verschiebung:

```js
// vorher
const xy = h.map(x => ({ x: g(x.executability), y: 200 - g(x.quality) }));
```

Spurende und zugehöriger Punkt lagen damit systematisch auseinander, und zwar **umso
weiter, je dichter das Feld ist**. In deinem Cluster oben rechts drängen sich fünfzehn
Titel — dort sind das leicht 15 bis 20 Bildpunkte. Die Spur endete buchstäblich im
Nichts, und keiner der Punkte gehörte sichtbar dazu.

Behoben, indem die Spur um genau den Vektor verschoben wird, den ihr Punkt erfahren hat.
Damit endet jede Spur zwingend an ihrem eigenen Punkt.

**Die Krypto-Heatmap hatte denselben Fehler** — dort sogar zusätzlich mit der
Randbegrenzung. Beide sind korrigiert.

---

## Befund 2 · Der lange Strich aus der linken unteren Ecke war ein Phantom

Beim Speichern der Verlaufspunkte stand:

```js
executability: Number.isFinite(Number(r.executability)) ? Number(r.executability) : 0
```

Eine **nicht messbare** Ausführbarkeit wurde damit als **gemessene Null** abgelegt. In
der Heatmap ist Null die linke untere Ecke. Sobald beim nächsten Scan ein echter Wert
kam, entstand eine Spur quer durch das gesamte Feld — die aussah wie eine gewaltige
Aufwärtsbewegung und keine war.

Genau so eine Spur läuft in deinem Screenshot von unten links bis in den Cluster.

Das verstößt direkt gegen Invariante 1 der Übergabe: *was nicht bewertbar ist, wird
ausgewiesen und NICHT geschätzt.* Jetzt wird `null` gespeichert, und beide Spur-Funktionen
überspringen solche Punkte, statt eine Koordinate zu erfinden. Ebenso im Krypto-Zweig,
wo `Number(r.quality || 0)` denselben Effekt hatte.

Alte Einträge mit einer falschen Null altern innerhalb von zwei Stunden aus dem
Verlaufsfenster heraus.

---

## Befund 3 · Man konnte nicht sehen, zu welchem Titel die Spur gehört

Die Zuordnung existierte nur als `<title>`-Tooltip. In einem Feld mit fünfzehn
überlappenden Punkten ist der schlicht nicht treffbar.

Die Aufwärtsspur trägt jetzt das **Kürzel am Spuranfang** — bewusst am Anfang und nicht
an der Pfeilspitze, weil dort die Punkte stehen und es sonst überdeckt würde. Mit
Kontur hinterlegt, damit es über den Quadranten lesbar bleibt, und `pointer-events:none`,
damit es keine Klicks auf die Punkte abfängt.

---

## Befund 4 · Mein eigener Test war blind

Die Negativkontrolle hat einen Fehler in meiner Prüfung gefunden, nicht im Code.

Ich hatte geprüft, ob der Versatz-Ausdruck **existiert**:

```js
assert.match(fn, /const ox=/);   // besteht auch bei `const ox=0`
```

Dazu eine Geometrie-Rechnung, die die Verschiebung sauber nachwies — aber in der
Testdatei selbst, ohne den Produktivcode zu berühren. Beides zusammen: grün, obwohl der
Fix zurückgedreht war. Das ist derselbe Fehlertyp, der in Abschnitt 11 der Übergabe als
*„tautologischer Test"* steht.

Jetzt wird der echte Ausdruck aus dem Quelltext **herausgelöst und ausgeführt**:

```js
const m = fn.match(/const ox=(.+?), oy=(.+?);/);
const offset = new Function('x','y','last', `return [${m[1]}, ${m[2]}];`);
offset(120, 60, {x:100, y:90})   // muss [20, -30] ergeben
offset(100, 90, {x:100, y:90})   // muss [0, 0] ergeben
```

Damit prüft der Test die Rechnung, nicht die Schreibweise.

---

## Nachweise

- 21 Suiten grün, `TZ=Europe/Vienna` und `TZ=America/Chicago`
- Vier Claude-SHA-Blöcke unabhängig nachgerechnet: alle identisch
- Erreichbarkeits-Audit sauber
- **Negativkontrolle**, jede Änderung einzeln zurückgedreht:

| zurückgedreht | Test |
|---|---|
| Versatz Aktien-Heatmap → 0 | fällt |
| Versatz Krypto-Heatmap → 0 | fällt |
| fehlende Ausführbarkeit wieder als 0 | fällt |
| fehlende Krypto-Qualität wieder als 0 | fällt |
| Überspringen nicht messbarer Punkte | fällt |
| Kürzel an der Spur | fällt |

Beim ersten Durchlauf blieben die ersten beiden grün. Das war der Anlass für Befund 4.

---

## Was du nach dem Deploy sehen solltest

- Jede Spur endet **sichtbar an einem Punkt**, nicht mehr daneben.
- Grüne Aufwärtsspuren tragen das Kürzel am Anfang.
- Der lange Strich aus der linken unteren Ecke ist weg, sofern er ein Phantom war.
  Bleibt er, ist es eine **echte** Bewegung, und dann sagt dir das Kürzel jetzt, welche.

Nach dem Deploy `Cmd+Shift+R` — der Service Worker cacht aggressiv.
