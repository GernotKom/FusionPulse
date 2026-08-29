# FusionPulse v3.14.0 · Fußleiste gemessen, Modus A aktiv

26 Testsuiten grün in zwei Zeitzonen, vier SHA-Blöcke identisch, Negativkontrolle für
alle neun Änderungen.

---

## 1. „Passt immer noch nicht beim Scrollen" — mein Fehler aus v3.12.0

Ich hatte in v3.12.0 die **Kopfhöhe** durch Messung ersetzt und dabei geschrieben, damit
sei die Ursache behoben. Das war unvollständig: Unten stand weiterhin

```css
body{padding-bottom:108px}
```

Dieselbe geratene Zahl, nur am anderen Ende. Die untere Signalleiste ist `position:fixed`
und ihre Höhe **variiert mit dem Inhalt** — bei einem aktiven Plan trägt sie zwei Zeilen
statt einer. War sie höher als 108 Pixel, ließ sich das Seitenende nicht mehr
freischeiben: der untere Teil der Fokuskarte blieb dauerhaft verdeckt, auch am Ende des
Scrollbereichs. In deinem Screenshot ist genau das zu sehen — der Beobachtungs-Plan ist
mittendrin abgeschnitten, und der Scrollbalken steht bereits ganz unten.

Behoben: `--fp-foot-h` wird vom selben `ResizeObserver` gemessen wie Kopf und Leiste, und
die Signalleiste wird ausdrücklich mitbeobachtet, weil sie ihre Höhe mit dem Plan ändert.

---

## 2. Reiterleiste · von `sticky` auf `fixed`

Die Regel war korrekt (`position:sticky; top:var(--fp-head-h)`), die Leiste blieb im
Betrieb trotzdem nicht stehen — im Screenshot ist sie beim Scrollen verschwunden.

`sticky` hat mehrere stille Ausfallgründe: eine Elternbox mit begrenzter Höhe, ein
`overflow` an einem Vorfahren, ein Stapelkontext. Welcher davon zutrifft, sieht man einem
Screenshot nicht an, und ich wollte nicht die dritte Runde raten.

Da die Kopfzeile ohnehin `fixed` ist und ihre Höhe seit v3.12.0 gemessen wird, ist
`position:fixed; top:var(--fp-head-h)` hier die **deterministische** Lösung: Die Leiste
hängt immer exakt unter dem Kopf, ohne Bedingungen. Ein Test verbietet die Rückkehr der
sticky-Variante.

---

## 3. Modus A ist aktiv — und warum eine Default-Änderung allein nichts genützt hätte

Du hast dich für Modus A entschieden. Der Punkt, der dabei fast schiefgegangen wäre:

```js
const S = { ...DEFAULTS, ...storedSettings };
```

Ein bereits gespeichertes `tradeMode:'off'` **überschreibt jeden neuen Default**. Hätte
ich nur die Voreinstellung umgestellt, wäre bei dir gar nichts passiert — der Schalter
weiter aus, der 8R-Deckel weiter aktiv, und wir hätten uns beide gewundert.

Deshalb zusätzlich eine einmalige Migration mit vier geprüften Fällen:

| gespeicherter Zustand | Ergebnis |
|---|---|
| `tradeMode:'off'` (alter Default) | → Modus A, einmalig migriert |
| `tradeMode:'off'` **selbst gewählt** | bleibt aus, nicht angetastet |
| bereits migriert | läuft kein zweites Mal |
| neue Installation | Modus A über den Default |

Sobald du den Modus selbst setzt, wird `tradeModeChosen` gesetzt — keine künftige
Migration fasst deine Wahl mehr an.

**Und die Umstellung passiert nicht still.** Beim ersten Laden erscheint ein Hinweis, der
benennt was sich ändert: Die Bewertung verwendet ab sofort das Tagesziel statt des
bisherigen 8R-Deckels. Die früheren Migrationen (v3.5.2 und v3.5.3) waren stumm — das war
ein Fehler, weil man sich abweichende Ergebnisse sonst falsch erklärt.

### Was du jetzt anders sehen wirst
Setups, die bisher am 8R-Deckel scheiterten, können jetzt durchkommen. Laut Übergabe war
genau dieser Deckel es, der den VEEV-Fall unmöglich machte. Ob Modus A in der Praxis
trägt, ist damit **nicht** bewiesen — die Konsolidierungsschwelle (0,62) und die Zielweite
(1,0 × Tagesspanne) sind weiterhin Schätzungen, die nie an Live-Daten geprüft wurden.
Das bleibt P-A3 und braucht dich am Markt.

---

## Nachweise

- 26 Suiten grün, `TZ=Europe/Vienna` und `TZ=America/Chicago`
- Vier Claude-SHA-Blöcke unabhängig nachgerechnet: identisch
- Erreichbarkeits-Audit sauber
- **Funktionsnachweise, ausgeführt statt gelesen:** Kopf 74 + Leiste 61 → 135 px oben,
  Signalleiste 173 → 173 px unten (nicht 108) · nicht messbare Leiste überschreibt keinen
  Startwert · alle vier Migrationsfälle einzeln geprüft
- **Negativkontrolle**, jede Änderung einzeln zurückgedreht — alle neun fallen:

| zurückgedreht | Test |
|---|---|
| feste 108 px unten zurück | fällt |
| Fußmessung entfernt | fällt |
| Signalleiste nicht mehr beobachtet | fällt |
| Leiste zurück auf `sticky` | fällt |
| Default zurück auf `off` | fällt |
| Migration ohne Bedingung | fällt |
| Schutz der eigenen Wahl entfernt | fällt |
| Migration nicht gespeichert | fällt |
| Hinweistext entfernt | fällt |

---

## Eine Beobachtung zu deinem Screenshot

Der Tab-Titel sagte **3.11.0**, die Kopfzeile **v3.12.0**. Der Service Worker läuft
network-first, das sollte nicht passieren. Falls die Anzeige nach dem Deploy wieder
auseinanderläuft, sag Bescheid — dann sehe ich mir die Auslieferung an, statt gegen einen
halb aktualisierten Stand zu debuggen.

Nach dem Deploy `Cmd+Shift+R`.

**Offen bleibt** die Favoritenquote: 2 von 20 Plätzen pro Zyklus für 17 Favoriten heißt,
jeder Favorit kommt nur alle 20 bis 35 Minuten dran. Bei einem Nachrichten-Move von 20 bis
40 Minuten ist das knapp. Sechs Plätze wären die naheliegende Änderung.
