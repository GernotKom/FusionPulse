# FusionPulse v3.22.0 — Ertrag je Zeit, Kostenlast, getrennte Märkte

Additiv. **Score, Ampel, Gate, Sizing und Freigabe unverändert**, SHA-Blöcke
unberührt.

---

## Zur Frage „ist die Arithmetik so, wie du sie gestalten würdest?"

**Nein, sie war es nicht.** Bis v3.21.0 hat die App den Erwartungswert **je
Trade** optimiert. Gefragt war nach **schnell Geld verdienen** — das ist Ertrag
je *Zeit*, eine andere Größe. Zwei Dinge fehlten komplett.

### Fehlend 1: Die Frequenz

Ein Setup mit **+40 € netto, das dreimal täglich auftritt**, schlägt eines mit
**+80 €, das einmal pro Woche kommt**, um den Faktor zehn. Die App hatte alle
Daten dafür — Episoden und Handelstage stehen seit v3.0 in D1 — und hat sie nie
zusammengerechnet.

Neu je Situationstyp:

- **Gelegenheiten je Handelstag** (Episoden ÷ Handelstage im Fenster)
- **Erwarteter Euro je Handelstag** = EV × Gelegenheiten
- **Euro je Stunde Kapitalbindung** = EV ÷ Haltedauer

Sortiert wird jetzt nach **Euro je Handelstag**. Mit Deckel bei 3 Trades/Tag —
das ist keine Kosmetik: bei 10.000 € Fixeinsatz lassen sich nicht beliebig viele
Positionen gleichzeitig halten, und ohne den Deckel würde ein häufiger schwacher
Typ eine seltene starke Gelegenheit überholen. Rechnerisch richtig, praktisch
nicht ausführbar.

Die Fail-Closed-Stufen aus v3.20.0 stehen weiterhin darüber, und ein Kandidat
**ohne** Frequenzangabe kann einen **mit** nie überholen — sonst würde
Nichtwissen wieder nach oben helfen.

### Fehlend 2: Kleine Ziele sind strukturell die schlechtesten

Die 38 € Fixkosten sind unabhängig von der Zielweite. Also:

| Ziel | Gewinn | Verlust | nötige Trefferquote | Kostenlast |
|---|---|---|---|---|
| 1,5 % | 81 € | 113 € | **58,2 %** | 25,3 % |
| 2,04 % | 120 € | 140 € | 53,8 % | 18,6 % |
| 3 % | 190 € | 188 € | 49,7 % | 12,7 % |
| 4 % | 262 € | 238 € | 47,6 % | 9,5 % |
| 6 % | 407 € | 338 € | **45,3 %** | 6,3 % |

Bei 2 % Zielweite fressen die Fixkosten fast **ein Fünftel** des Bruttogewinns,
bei 6 % nur ein Sechzehntel. Die abgeleitete Mindestzielweite von 2,04 % ist
damit ein **Boden, kein Wunschwert** — und rechnerisch der schlechteste noch
zulässige Punkt. Die Kachel zeigt die Kostenlast jetzt an, statt dass man sie
sich denken muss.

### Ein dritter Fehler, gefunden beim Nachrechnen

Die Rastersuche aus v3.21.0 hat sich in Testläufen **nie** durchgesetzt, obwohl
sie klar bessere Paare fand. Ursache: ihr Ergebnis wurde auf dem 30 % großen
Nachweisteil geschätzt und gegen eine Vollstichproben-Schätzung des
Kostenmodell-Paars gestellt. Die schmalere Stichprobe hat eine breitere
Wilson-Untergrenze — das gesuchte Paar war systematisch benachteiligt.

Jetzt gilt die saubere Reihenfolge: **suchen** auf den älteren 70 %,
**bestätigen** auf den jüngeren 30 %, und erst **danach** auf allen Episoden
schätzen. Auswählen und Schätzen sind zwei Schritte. Ein überangepasstes Paar
kommt gar nicht bis dorthin. Im Testlauf hebt das den erwarteten Wert von
+105 € auf +158 € je Trade — bei identischen Daten.

---

## Märkte getrennt

Krypto und Aktien standen optisch ineinander. Das ist mehr als ein Schönheits-
problem: Bewegungsgrößen, Sessionphasen und Kostenrechnung unterscheiden sich,
und wer beim Scrollen den Bereich verwechselt, vergleicht Zahlen, die nicht
vergleichbar sind.

Jeder Bereich hat jetzt ein Kopfband (**🪙 KRYPTO** / **📈 AKTIEN**) und einen
durchgehenden Farbrand, der an allen Kacheln des Bereichs mitläuft — so bleibt
beim Scrollen sichtbar, wo man ist, auch ohne die Überschrift im Blick.

---

## Kachelfarben — sie gab es, aber an der falschen Stelle

Du hattest recht mit „scheinbar nie umgesetzt": die Einstellung existiert seit
v3.15.0, deckte aber **ausschließlich fünf Elemente innerhalb der
Aktien-Fokuskarte** ab. Die großen Discovery-Kacheln, die den meisten Platz
einnehmen, waren gar nicht dabei. Die Einstellung war also da und wirkungslos —
genau der Zustand, den man als „gibt's nicht" erlebt.

Neu färbbar: Top Picks, Momentum-Mover, Premarket/Opening, Nachbörse,
Sektor-Nachzügler, Quartalszahlen, Krypto-Mover, Krypto-Stimmung,
Freigabe-Trichter, Portfolio-Risiko. Plus die beiden **Bereichsfarben**.

Die Ampelfarben bleiben als Auswahl gesperrt. In v3.14.6 war die Systemampel
praktisch unsichtbar, weil eine Farbe zu schwach war — eine Einstellung, mit der
sich das wiederherstellen ließe, wäre ein Rückschritt mit Bedienoberfläche.

Ein Test prüft jetzt für **jede** färbbare Kachel alle drei Teile: Schlüssel im
Code, Markierung im HTML, Regel im CSS. Fehlt einer, ist die Einstellung
wirkungslos — und genau das war passiert.

---

## Prüfung

Suite 41, `✓ FusionPulse v3.22.0 tempo/cost-load/domain regressions`.
**Sechs Negativkontrollen**, alle greifen:

1. Handels-Deckel entfernt → fällt
2. Frequenzaussage schon bei 3 Handelstagen → fällt
3. fehlende Frequenz darf wieder überholen → fällt
4. wieder nach Euro je Trade sortieren → fällt
5. Kachel im HTML nicht markiert → fällt
6. Ampelfarbensperre entfernt → fällt

Ende-zu-Ende, echter Worker-Kern durch echtes `app.js` in echtem DOM:

```
Typ                 Urteil                            Ziel/Stop    EV/Trade  ×/Tag  EV/Tag  Kostenlast
BREAKOUT PRESSURE   handelbar                         2,84/−1,40        158      3     474      13,4 %
NEAR HIGH           bewegt sich nicht weit genug      2,04/−1,02        −47      2     −94      18,6 %
OPENING DRIVE       zu verrauscht für 10.000 € fix    2,04/−1,02       −140      1    −140      18,6 %

Rangfolge:  SOFI (Live-Score 36) → LAUT (99) → MRNA (80)
```

Der laute Kandidat mit Score 99 steht unten, der unauffällige mit Score 36 oben.

41 Suiten grün, Erreichbarkeits-Audit ohne Fund.

---

## Was jetzt funktioniert

- **Die Rangfolge beantwortet endlich die richtige Frage.** Nicht „welcher Trade
  ist am besten", sondern „womit verdiene ich am meisten pro Tag" — mit einer
  realistischen Obergrenze, wie viele Trades du gleichzeitig halten kannst.
- **Du siehst, was die Gebühren wirklich kosten.** 18,6 % des Bruttogewinns bei
  2 % Zielweite, 6,3 % bei 6 %. Das ist das Argument gegen kleine Ziele, und es
  steht jetzt als Zahl da.
- **Du siehst, wie lange dein Geld gebunden ist** und was es pro Stunde bringt.
- **Die beiden Märkte sind optisch getrennt**, mit einstellbaren Bereichsfarben.
- **Alle großen Kacheln lassen sich einfärben** — vorher waren es nur fünf
  Elemente in der Fokuskarte.

## Was noch offen ist — und eine ehrliche Einordnung

**Die Arithmetik ist jetzt vollständig, die Datenlage nicht.** Alles oben rechnet
korrekt, aber es rechnet mit aufgezeichneten Episoden, und davon gibt es noch
wenige. `mae_pre` sammelt sich erst seit v3.21.0, Situationstypen seit v3.17.0,
Haltedauern seit v3.20.0. Rechne mit sechs bis acht Wochen, bis die erste
belastbare Aussage möglich ist.

**Und eine Sache, die keine Arithmetik lösen kann:** Bei 10.000 € Einsatz, 38 €
Fixkosten und 27,5 % KESt brauchst du selbst im günstigsten Fall rund 45 %
Trefferquote bei einem Ziel-Stop-Verhältnis von 2:1. Das ist erreichbar, aber es
ist kein großer Puffer. Wenn die Auswertung nach einigen Wochen zeigt, dass kein
Situationstyp einen positiven Ertrag je Handelstag trägt, ist das ein
belastbares Ergebnis und kein Anlass, die Schwellen weicher zu stellen. Die App
ist jetzt so gebaut, dass sie dir das sagen *kann* — das war vorher nicht so.

**Weiterhin offen:**
- Der Live-`situationScore` mit seinen 14 handgesetzten Koeffizienten ist
  ungeprüft. Ihn gegen die Ergebnisse zu testen ist der nächste logische Schritt.
- Keine Gruppierung nach Tageszeit. Ein Opening-Setup um 15:30 MEZ verhält sich
  anders als um 20:00 — dafür fehlt noch die Datenmenge.
- Der Erwartungswert unterstellt, dass du den Plan ausführst: Einstieg zum
  aufgezeichneten Preis, Ausstieg am Ziel.
- Krypto hat noch keine eigene Top-Picks-Auswertung. Die Struktur trägt es, die
  Kostenrechnung ist bei Bitpanda Fusion aber eine andere (Spread statt
  Fixgebühr) — das braucht eine eigene Herleitung, keine Kopie.
- Alle offenen Punkte aus v3.18.0.
