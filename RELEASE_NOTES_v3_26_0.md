# FusionPulse v3.26.0 — Bereichsordnung

Rein strukturell. Keine Änderung an Rechnung, Score, Ampel oder Freigabe.

---

## Zwei Fehler, die du richtig benannt hast

**1. Die Aktien-Überschrift stand bei den Coins.** Sie lag *zwischen* Coin-Liste
und Aktienabschnitt — technisch „über den Aktien", gelesen aber als Abschluss der
Coin-Liste, weil die Coin-Liste lang ist und nichts sie abschließt. Eine
Überschrift gehört **in** das Element, das sie überschreibt. Jetzt steht sie als
erstes Kind von `<section id="stocks">`, direkt über „Aktienradar".

**2. Der Auswertungsteil lag mitten in den Aktien.** Learning, Musterlabor,
Modul 0, Experimental Lab und Marktmeinung waren Kinder von `#stocks`. Wer nach
unten scrollte, landete zwischen zwei Aktienkacheln plötzlich in der
Selbstauswertung. Sie werten **beide** Märkte aus und sind Rückblick, keine
Handlungsgrundlage — jetzt ein eigener dritter Bereich am Ende.

**Und einer, den ich beim Prüfen selbst gefunden habe:** das Krypto-Fokusfenster
stand *über* seiner eigenen Überschrift, im Aktienbereich war es umgekehrt. Zwei
Bereiche, die gleich aufgebaut sind, muss man nicht zweimal lernen.

---

## Die Abfolge jetzt

```
━━━ 🪙 KRYPTO                     ━━━ 📈 AKTIEN
    Fokus + Heatmap                   Fokus + Heatmap
    Top Picks                         Top Picks
    Momentum-Mover                    Momentum-Mover
    Stimmung                          Premarket
    Coin-Liste                        Nachbörse
                                      Sektor-Nachzügler
                                      Quartalszahlen
                                      Termin-Editor
                                      Freigabe-Trichter
                                      Depot · Crowd · Portfolio-Risiko
                                      Aktien-Liste

━━━ 🔬 AUSWERTUNG / LAB
    Learning · Musterlabor · Selbstauswertung · Experimental Lab · Marktmeinung
```

Beide Handelsbereiche haben denselben Kopf: **Überschrift → Fokus → Top Picks →
Momentum → …**. Vorher standen im Aktienteil Quartalstermine und der
Freigabe-Trichter *vor* den Kandidatenkacheln — also Kontext vor Kandidaten.

---

## Was sich sonst ändert

- **Dritter Bereich mit eigener Farbe.** Neutralgrau, weil der Auswertungsteil
  nicht um Aufmerksamkeit konkurrieren soll mit den beiden, in denen tatsächlich
  gehandelt wird. Wie die anderen beiden in den Einstellungen umstellbar.
- **Die Bandüberschriften bleiben beim Scrollen oben stehen** (sticky). Man
  sieht damit jederzeit, in welchem Markt man gerade liest — was bei
  unterschiedlichen Kostenmodellen und Bewegungsgrößen kein Luxus ist.
- **Bänder haben Luft darüber, wenig darunter.** Genau umgekehrt war es der
  Fehler: viel Abstand nach unten ließ die Überschrift als Abschluss des
  vorigen Abschnitts lesen.
- **Die Rubrikenleiste folgt jetzt der DOM-Reihenfolge**, mit „Krypto",
  „Aktien" und „Auswertung" als erstem Sprungziel je Bereich.

---

## Prüfung

Suite 46 prüft die **tatsächliche Reihenfolge** im Markup — nicht, dass die
Elemente irgendwo vorkommen. Genau dieser Unterschied war das Problem: alles war
da, nur an der falschen Stelle.

Geprüft wird die vollständige Kette *Überschrift → Umfang → Fokus → Top Picks →
Momentum → Premarket → Nachbörse → Nachzügler → Zahlen → Trichter → Depot →
Risiko → Liste*, dass das Aktien-Band **innerhalb** von `#stocks` liegt, und dass
kein Auswertungsteil mehr darin steckt.

Dazu eine Prüfung, die vorher gefehlt hat: **die Rubrikenleiste muss der
DOM-Reihenfolge folgen.** Sonst springt die Markierung beim Scrollen vor und
zurück, weil `markActiveSection` von oben nach unten läuft und den letzten
Treffer nimmt — ein Fehler, der sich wie ein Zufall anfühlt und deshalb lange
überlebt.

Fünf Negativkontrollen, alle greifen, darunter beide Originalfehler:
Aktien-Band wieder nach außen → fällt. Learning zurück in die Aktien → fällt.

46 Prüfungen grün, Erreichbarkeits-Audit ohne Fund.

---

## Was noch offen ist

- **Der Live-`situationScore`** mit seinen 14 handgesetzten Koeffizienten ist
  weiterhin ungeprüft. Das bleibt der größte offene Punkt — er entscheidet,
  welche Kandidaten überhaupt in der Liste landen.
- Die live gelesene Bitpanda-Gebührenstufe ist noch nicht mit der
  Krypto-Auswertung verbunden.
- Alle offenen Punkte aus v3.18.0.
