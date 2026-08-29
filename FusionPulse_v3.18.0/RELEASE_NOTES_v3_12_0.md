# FusionPulse v3.12.0 · Gemessene Höhe, zweistufige Navigation, Spurrichtung

Drei gemeldete Punkte. **Zwei davon hatten dieselbe Ursache** — deshalb habe ich die
Ursache repariert und nicht zweimal am Symptom.

24 Testsuiten grün in zwei Zeitzonen, vier SHA-Blöcke identisch, Negativkontrolle für
alle elf Änderungen. **Kein Score, keine BUY-Logik berührt.**

---

## 1. Die gemeinsame Wurzel · feste Pixelwerte statt gemessener Höhe

In der CSS standen an vier Stellen geratene Höhen für Kopfzeile und Reiterleiste:
`62px`, `104px`, `52px`, teils mit `!important` gegeneinander. Daraus folgten drei
verschiedene Fehler, die wie drei Probleme aussahen:

**Das Coin-Fokusfenster stieß beim Scrollen an.** `body{padding-top:62px}` deckte nur
die Kopfzeile ab. Die rund 44 Pixel der Reiterleiste standen in keiner Rechnung — der
Inhalt begann zu weit oben und schob sich unter die Leiste. Das Fokusfenster ist das
erste Element darunter und traf es deshalb als Erstes.

**Die Reiterleiste rutschte unter den Kopf.** Die Kopfzeile ist `flex-wrap`, ihre Höhe
also nicht konstant. Sobald sie umbrach, stimmte kein einziger der festen Werte mehr.
In deinem Screenshot war das schon sichtbar: eine halb abgeschnittene Textzeile zwischen
Kopf und Reitern.

**Sprungziele landeten hinter der Leiste.** Kein `scroll-margin-top` — der Reiter
versteckte sein eigenes Ziel.

**Behoben durch Messung.** Ein `ResizeObserver` liest die tatsächliche Höhe beider
Elemente und schreibt sie in `--fp-head-h`, `--fp-nav-h` und `--fp-chrome-h`. Damit
stimmt der Abstand bei umgebrochener Kopfzeile, bei anderer Schriftgröße und auf jedem
Fenster — ohne dass irgendwo eine Zahl gepflegt werden muss. Fail-closed: Wenn nichts
messbar ist, bleiben die Startwerte stehen, statt auf 0 zu springen.

---

## 2. Zweistufige Navigation · alle Rubriken erreichbar

Der Wunsch war, alle Rubriken oben in die Leiste zu nehmen. Das wären dreizehn Reiter —
die passen auf 13 Zoll nicht in eine Zeile, und zwei Zeilen fressen genau den Platz, den
eine klebende Leiste sichtbar halten soll.

Deshalb zwei Ebenen: **Coins · Aktien · Lab/Learning** bleiben fest, die Rubriken
darunter wechseln.

| Bereich | Rubriken |
|---|---|
| Coins | Fokus · Mover · Stimmung · Coin-Liste |
| Aktien | Fokus · Mover · Nachzügler · Zahlen · Premarket · Nachbörse · Depot · Risiko · Liste |
| Lab | Learning · Selbstauswertung · Lab · Marktmeinung |

Zwei Dinge daran sind nicht Kosmetik:

- **Jedes Sprungziel wird vor dem Zeichnen geprüft.** Eine Rubrik ohne Ziel im Markup
  wird gar nicht erst gezeichnet. Ein Reiter, der beim Klick einfach nichts tut, fällt
  niemandem auf — das ist die Sorte Fehler, die lange überlebt. Ein Test prüft zusätzlich
  alle Ziele gegen das Markup.
- **Der aktive Abschnitt wird beim Scrollen markiert.** Eine dauerhaft sichtbare Leiste,
  die nicht zeigt wo man ist, ist nur eine Knopfreihe. Die Markierung rechnet gegen die
  gemessene Leistenhöhe, springt also nicht um, während der Abschnitt noch dahinter liegt.

---

## 3. Heatmap · Kürzel und Richtung an jeder Spur

**Mein Fehler aus v3.9.3.** Ich hatte Kürzel und Pfeilspitze an `dir==='sweet'` gehängt,
also ausschließlich an Aufwärtsspuren. In deinem Screenshot laufen die Striche fast alle
nach unten aus dem Cluster — die trugen konstruktionsbedingt weder Namen noch Richtung.
Deine Meldung beschrieb exakt diese halbe Lösung. Die Einschränkung war nie begründet.

Jetzt trägt **jede bewegte Spur** eine Pfeilspitze, und zwar in die tatsächliche
Bewegungsrichtung gedreht (`atan2`), plus das Kürzel am Spuranfang. Damit liest sich jede
Spur als „von wo nach wo", statt raten zu lassen, welches Ende das aktuelle ist.

Farbe trägt die Aussage mit: grün nach rechts oben, gedämpftes Orange nach links unten,
grau seitwärts. **Bewusst kein Rot für abwärts** — das ist eine Beobachtung, kein Alarm.

**Gegen das Gedränge:** Nur Spuren ab einer Mindestbewegung bekommen ein Kürzel. Ein
Titel, der kaum wandert, sagt nichts aus und braucht auch keinen Namen — sonst
überlagern sich im Cluster fünfzehn Kürzel und die Karte wird unlesbar.

---

## 4. Erreichbarkeits-Audit · dokumentierte Ausnahmen

Das Audit meldete die neue Rubrikenzeile: horizontaler Scrollbereich mit Bedienelementen,
kein Umbruch. Die Frage war berechtigt, die Antwort „Umbruch einbauen" aber falsch — eine
zweite Zeile macht die Leiste hoch und frisst den Platz, den sie sparen soll.

Statt die Warnung zu ignorieren, kann eine Ausnahme jetzt **in der CSS begründet** werden:

```css
/* reach-audit-ok: .vb-sub — Umbruch wäre hier falsch: … */
```

Ohne Begründung keine Ausnahme — nachgeprüft, indem ich den Kommentar entfernt habe:
das Audit meldet den Fall sofort wieder. Die Ausnahme bleibt im Bericht sichtbar, aber
als bewusste Entscheidung statt als offene Frage. Und die Begründung steht dort, wo der
nächste Bearbeiter sie findet: neben dem Code.

---

## Nachweise

- 24 Suiten grün, `TZ=Europe/Vienna` und `TZ=America/Chicago`
- Vier Claude-SHA-Blöcke unabhängig nachgerechnet: identisch
- **Funktionsnachweis:** `measureChrome` wird aus dem Quelltext extrahiert und mit
  Attrappen ausgeführt — Kopf 74 px plus Leiste 61 px muss 135 px ergeben, nicht 74.
  Ohne messbare Höhe darf kein Wert überschrieben werden.
- **Negativkontrolle**, jede Änderung einzeln zurückgedreht — alle elf fallen:

| zurückgedreht | Test |
|---|---|
| fester `padding-top` zurück | fällt |
| Gesamthöhe ohne Leistenanteil | fällt |
| Fail-closed bei nicht messbarer Höhe | fällt |
| `scroll-margin-top` entfernt | fällt |
| Leiste auf `position:static` | fällt |
| Rubriken ohne Zielprüfung | fällt |
| Markierung des aktiven Abschnitts | fällt |
| Spuren wieder nur `sweet` beschriftet | fällt |
| Pfeilrichtung fest auf 0 | fällt |
| Mindestbewegung fürs Kürzel entfernt | fällt |
| Scrollbalken der Rubrikenzeile | fällt |

### Drei Fehler in meinen eigenen Tests
Alle drei von der Negativkontrolle bzw. beim ersten Lauf gefunden:

1. Die Prüfung „kein `padding-top:62px`" schlug auf **meinem eigenen Erklärkommentar**
   an, der den alten Wert zitiert. Jetzt werden CSS-Kommentare vor der Prüfung entfernt.
2. `new Function('document', …)()` band `document` zum falschen Zeitpunkt — die Attrappe
   kam nie an. Jetzt wird die Fabrik pro Aufruf gebunden.
3. Die Prüfung „kein Rot für Abwärtsspuren" nutzte ein geratenes Farbmuster
   (`/#[ef][0-9a-f]{2}[0-5]/`) und schlug prompt beim Orange `#e6a06a` an. Farben nach
   Muster zu raten ist unbrauchbar; geprüft wird jetzt gegen die konkreten Rottöne.

Nach dem Deploy `Cmd+Shift+R`. Du bist derzeit noch auf 3.10.0 — 3.11.0 mit Impuls und
Quartalszahlen-Tafel ist in diesem Paket enthalten.
