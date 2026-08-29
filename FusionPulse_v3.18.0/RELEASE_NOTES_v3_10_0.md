# FusionPulse v3.10.0 · Sektor-Nachzügler

Ausgelöst durch einen echten Trade: **CRWD stand in der Momentum-Liste**, war vorher
nicht auf dem Schirm des Nutzers, und wurde nach starken NVDA-Zahlen früh gekauft.

Das ist die wichtigste Rückmeldung dieses Projekts bisher, weil sie die Diagnose
umdreht. Die Discovery funktioniert. Was fehlte, war der eine Hinweis daneben, der
den Zusammenhang erklärt hätte.

22 Testsuiten grün in zwei Zeitzonen, vier SHA-Blöcke identisch, Negativkontrolle für
alle acht Änderungen. **Kein Score, keine BUY-Logik berührt.**

---

## 1. Der Fehler · `sectorLag` war auf dem primären Pfad nie berechnet

Die Kennzahl „hinkt dieser Titel hinter seinem eigenen Sektor her" existiert seit
Langem. Die UI wertet sie an drei Stellen aus (`featureOf`, `edgeSignals`,
`stockHeatmapMark`). Berechnet wurde sie aber **ausschließlich im
Twelve-Data-Zweig** (`worker.js:1880`).

Der Tiingo-Deep-Scan — also der Pfad, der bei `TIINGO_STOCKS_MODE=primary` im
Normalbetrieb läuft — setzte den Wert in `tiingoAnalyseOne` auf `null` und hat ihn
nie nachgerechnet.

**Die Kennzahl war im produktiven Betrieb dauerhaft leer.**

Und es ist ausgerechnet die Kennzahl, die den CRWD-Fall beschreibt: NVDA meldet stark,
die Halbleiter- und Security-Nachbarschaft läuft an, CRWD hinkt noch — und ist genau
deshalb der Kandidat. Die App hatte den Titel, hatte die Rohdaten, und hat die
Verbindung nicht gezogen.

Behoben durch eine gemeinsame Funktion `applySectorLag(rows)`, die jetzt auf **beiden**
Pfaden läuft. Kostet nichts: alle Zeilen liegen im Speicher, keine zusätzliche
API-Abfrage.

### Fail-closed, und zwar mit Lehrgeld
Beim Testen fiel mir auf, dass `Number(null)` gleich `0` und damit endlich ist. Ein
reiner `isFinite`-Test hätte fehlende Werte als **gemessene Null** durchgelassen —
exakt der Fehler, der in v3.9.3 die Phantomspur in der Heatmap erzeugt hat. Jetzt wird
explizit auf `null`/`undefined`/`''` geprüft. Vier Testfälle nageln das fest.

Zusätzlich: Unter drei Vergleichstiteln entsteht **kein** Sektorurteil. Ein einzelner
Peer bildet keinen Sektor ab, und eine Scheinaussage ist schlechter als keine.

---

## 2. Neue Kachel · 🧲 Sektor-Nachzügler

Zeigt Titel, bei denen **zwei** Bedingungen zusammenkommen:

1. Der Sektor läuft — Anführer mindestens 0,8 % auf 15 Minuten
2. Der Titel hinkt — mindestens 0,6 Punkte Rückstand

Bedingung 1 ist entscheidend. Ein Rückstand in einem stehenden Sektor ist bedeutungslos.

Jede Karte zeigt Rückstand in Punkten, Sektor-Anführer gegen eigenen Wert, die
flatex-Handelbarkeit und den Auslöser. Klick öffnet den Titel im Fokusfenster.

Der Untertitel sagt ausdrücklich: **Grund hinzusehen, kein Kaufsignal.** Ein Titel kann
auch zurückbleiben, weil er zu Recht zurückbleibt — das entscheidet die Nachrichtenlage,
nicht diese Kennzahl.

---

## 3. Kontextzeile an jedem Momentum-Kandidaten

`whyNow` wurde im Worker längst befüllt (Radar-Gründe plus Situation-Gründe), stand aber
nur tief im Fokusfenster unter „Was hat sich geändert?" — also genau dort, wo man erst
hinschaut, wenn man den Titel bereits ausgewählt hat.

Jetzt hängt an jeder Karte der Momentum-Liste:

- 🧲 **Sektor-Hinweis**, wenn der Sektor läuft und der Titel hinterherhinkt
- ❓ **Warum jetzt** — die erkannten Auslöser
- ⛔ **Handelbarkeit**, nur wenn sie problematisch ist

Der Tooltip stellt klar, dass `whyNow` **gemessene Kursereignisse** sind und keine
Nachrichtenmeldungen. Den Nachrichtenkontext legst du dazu — das ist genau der Teil, den
die App nicht leisten kann und bei dem du im CRWD-Fall die Arbeit gemacht hast.

---

## 4. Die Momentum-Liste hört auf, sich zu entschuldigen

Sie trug den Untertitel „Discovery · 0 % BUY-Gewicht" — was formal stimmt und praktisch
wie ein Trostpreis liest. Diese Liste hat CRWD gefunden, bevor der Nutzer ihn kannte.
Das ist das Produkt, nicht die Restekiste.

Neu darunter:

> *Kandidatenliste, keine Kaufempfehlung — die Einordnung der Nachrichtenlage bleibt bei dir*

Das ist ehrlicher in beide Richtungen. Es verspricht kein Signal, und es tut nicht so,
als sei eine fehlende BUY-Ampel gleichbedeutend mit „hier ist nichts".

---

## Nachweise

- 22 Suiten grün, `TZ=Europe/Vienna` und `TZ=America/Chicago`
- Vier Claude-SHA-Blöcke unabhängig nachgerechnet: identisch
- Erreichbarkeits-Audit sauber
- **Funktionsnachweis statt Textprüfung:** `applySectorLag` wird aus dem Quelltext
  extrahiert und mit dem realen NVDA/AMD/AVGO/CRWD-Fall ausgeführt. Erwartung:
  Anführer 4,2 %, CRWD-Rückstand 3,8 Punkte, CRWD an erster Stelle. (Lehre aus v3.9.3 —
  ein Test auf Schreibweise ist bei Rechnungen blind.)
- **Negativkontrolle**, jede Änderung einzeln zurückgedreht:

| zurückgedreht | Test |
|---|---|
| `applySectorLag` aus dem Tiingo-Pfad | fällt |
| `applySectorLag` aus dem Twelve-Pfad | fällt |
| Null-Schutz auf reines `isFinite` | fällt |
| Bedingung „Sektor läuft" entfernt | fällt |
| Nachzügler-Kachel umbenannt | fällt |
| Kontextzeile von der Karte entfernt | fällt |
| Selbsteinordnung der Liste entfernt | fällt |
| Mindestzahl Vergleichstitel entfernt | fällt |

---

## Was das nicht löst — und was ich davon halte

Die drei Punkte aus der Analyse davor bleiben offen und richtig:

- `freshestStockQuote` läuft nur im manuellen Suchpfad, nie im Deep-Scan
- Favoritenquote 2 von 20 pro Zyklus ist zu wenig für 17 Favoriten
- `tradeMode: 'off'` bedeutet, dass der 8R-Deckel weiterhin greift

Aber die ehrliche Einschätzung nach zwei profitablen Handelstagen ohne App-Signal:
**Diese App wird dir CRWD nicht kaufen.** Sie wird dir CRWD zeigen — das hat sie getan —
und ab v3.10.0 auch, warum er gerade auffällt. Die Entscheidung, dass NVDA-Zahlen auf
Security durchschlagen und dass ein früher Anstieg tragfähig ist, kam von dir und wird
von dir kommen.

Das ist keine Kapitulation, sondern eine bessere Arbeitsteilung. Ein Aufmerksamkeitsfilter,
der dir zwei Minuten früher den richtigen Titel zeigt, ist bei deiner Trefferquote mehr
wert als eine Ampel, die versucht, deine Einschätzung zu ersetzen und daran scheitert.

Nach dem Deploy `Cmd+Shift+R`. Die Nachzügler-Kachel braucht mindestens drei Titel eines
Sektors im Scan — außerhalb der US-Handelszeiten bleibt sie mit Begründung leer.
