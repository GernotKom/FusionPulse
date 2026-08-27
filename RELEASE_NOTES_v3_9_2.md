# FusionPulse v3.9.2 · UI-Paket

Sechs Änderungen, alle reine Oberfläche. **Keine Zeile Bewertungslogik.** Die vier
SHA-verriegelten Claude-Blöcke unabhängig nachgerechnet und identisch. 20 Testsuiten
grün in `Europe/Vienna` und `America/Chicago`, Negativkontrolle für alle sechs Punkte.

Bewusst als reines UI-Paket geschnitten: Wenn nach dem Deploy etwas nicht stimmt, ist
die Ursache in einer Schicht zu suchen, nicht in zweien.

---

## 1. Reiter · „Coins" ergänzt

**Vorher:** Radar · Aktien · Lab. „Radar" sprang auf das **Krypto**-Fokusfenster — das
war aus dem Label nicht zu erraten, und ein eigener Einstieg in die Coin-Trefferliste
fehlte ganz.

**Jetzt:** Coins · Coin-Liste · Aktien · Lab / Learning. Die Reiter heißen nach dem,
wohin sie führen.

Ein Test prüft zusätzlich, dass **jedes** `data-jump`-Ziel im Markup wirklich existiert.
Ein toter Reiter wäre vorher niemandem aufgefallen — er hätte einfach nichts getan.

---

## 2. Discovery-Kacheln nach oben

Nach v3.9.1 standen Fokus und Heatmap zwar oben, aber danach kamen Depot, Crowd und
Portfolio — also der eigene Bestand vor den Kandidaten.

| vorher | jetzt |
|---|---|
| Fokus + Heatmap | Fokus + Heatmap |
| Depot, Crowd, Portfolio | **Momentum-Mover, Premarket, Nachbörse** |
| Momentum-Mover, Premarket, Nachbörse | Depot, Crowd, Portfolio |
| Learning, Selbstauswertung, Lab | Learning, Selbstauswertung, Lab |
| Aladdin | Aladdin |

Die Reihenfolge folgt jetzt der Arbeitsweise: erst **welche Titel sind auffällig**, dann
der eigene Bestand, dann der Rückblick.

---

## 3. Premarket und Momentum-Mover sind nicht dasselbe

**Rückfrage des Nutzers:** *„Bei den Momentum-Covers auch so eine Premarket-Kachel, oder
sind das die Momentum-Movers?"*

Berechtigte Frage — die Kacheln hießen fast gleich, und beide zeigten Prozentzahlen mit
Sparklines. Es sind aber zwei verschiedene Datenquellen und zwei verschiedene Zeitfenster:

| Kachel neu | zeigt | Quelle | Zeitfenster |
|---|---|---|---|
| 📡 **Momentum-Mover · Situation Radar** | Bewegung im laufenden Handel | Tiingo | während der Session |
| 🚀 **Premarket / Opening** | Gaps vor der Eröffnung | Alpaca | vor der Session |
| 🌙 **Nachbörse / Extended Hours** | Bewegung nach Handelsschluss | Alpaca | nach der Session |

Die Tooltips verweisen jetzt gegenseitig aufeinander. Tests verbieten die Rückkehr der
alten, mehrdeutigen Titel.

**Falls die Premarket-Kachel bei dir leer bleibt,** gibt es genau zwei mögliche Gründe,
und die Kachel sagt beide selbst an: entweder fehlen die Cloudflare-Secrets
`ALPACA_API_KEY_ID` und `ALPACA_API_SECRET_KEY`, oder der kostenlose IEX-Feed liefert
vor 08:00 ET keine Daten. Das ist am Livemarkt in zehn Sekunden geklärt.

---

## 4. flatex-Hinweis jetzt überall

Der Hinweis aus v3.9.1 stand nur im Fokusfenster. Jetzt zusätzlich:

- **Trefferliste:** ein Zeichen mit Tooltip — 🏦 wahrscheinlich handelbar, ⛔ eher nicht,
  ❓ unklar. Bewusst nur ein Zeichen: die Zeile ist dicht, und die Aussage ist eine
  Wahrscheinlichkeit — sie soll keine Kennzahl verdrängen.
- **Detailfenster:** der vollständige Hinweis neben dem Urteil.

Unverändert: reine Anzeige, fail-closed, kein Einfluss auf Score oder BUY-Freigabe.

---

## 5. Krypto-Mover-Kachel — und warum sie nicht „Overnight" heißt

Als Gegenstück zur Aktien-Discovery. Zwei Dinge musste ich dabei ehrlich benennen,
statt sie zu umgehen:

**Es gibt bei Krypto kein Premarket.** Der Markt läuft durchgehend, es existiert weder
Eröffnung noch Vorbörse. Eine Kachel „Krypto-Premarket" hätte ein Aktien-Konzept
nachgeahmt, das dort keine Entsprechung hat.

**Der Coin-Datensatz enthält keine 24-Stunden-Veränderung.** Ich habe die Feldliste von
`analyse()` durchgesehen: es gibt `ret15`, `ret60`, `relVol`, `spark` — aber kein
Tagesfeld. Die Analyse arbeitet auf rund 82 Fünfminutenbalken, also etwa sieben Stunden.

Die Kachel heißt deshalb **⚡ Krypto-Mover · letzte Stunde** und zeigt genau das, was
gemessen wird: 60-Minuten-Bewegung, 15-Minuten-Beschleunigung, relatives Volumen. Der
Untertitel sagt ausdrücklich, dass es kein Premarket-Äquivalent gibt.

Ein Test verbietet `change24`, `chg24` und `pct24` in dieser Funktion. Die naheliegende
„Verbesserung" wäre hier eine erfundene Zahl gewesen — und die Negativkontrolle zeigt,
dass der Test das auch wirklich fängt.

Kosten: null. Die Werte liegen im laufenden Scan bereits vor, es gibt keine zusätzliche
API-Abfrage.

---

## 6. Erreichbarkeits-Audit als Werkzeug

`npm run audit:reach` · `tests/reachability-audit.mjs`

Der Wächter-Schalter war seit v3.5.7 gebaut, getestet und unbedienbar. Alle Tests grün —
sie prüften, ob das Element **existiert**, nicht, ob man es **erreicht**. Das Werkzeug
sucht deshalb nach dem **Muster**, nicht nach dem Fehler:

> horizontaler Scrollbereich + Bedienelemente darin + keine sticky-Spalte +
> kein Umbruch unter Mobilbreite + unsichtbarer Scrollbalken

**Erster Lauf, zwei neue Funde:** `.signal-banner` und `.signal-content` — die
Signalleiste am unteren Rand scrollt horizontal und enthält anklickbare Signal-Chips.
Chips weit rechts waren nicht auffindbar. Behoben mit erzwungenem Scrollbalken; eine
sticky-Spalte wäre hier falsch, weil die Chips gleichrangig sind und es keine
„wichtigste" gibt.

Nebenbefund: 20 Bedienelemente ohne `title` oder `aria-label`. Der Stummschalt-Knopf in
der Aktienzeile ist behoben, der Rest ist als Liste sichtbar und offen.

Das Audit **urteilt nicht**, es listet auf und stellt eine Frage. Ein Fund ist kein
Beweis. `--strict` beendet mit Code 1 für die CI.

---

## Nachweise

- 20 Suiten grün, `TZ=Europe/Vienna` und `TZ=America/Chicago`
- Vier Claude-SHA-Blöcke unabhängig nachgerechnet: alle identisch
- **Negativkontrolle**, jede Änderung einzeln zurückgedreht:

| zurückgedreht | Test |
|---|---|
| Reiter „Coins" → „Radar" | fällt |
| Discovery-Kacheln wieder nach unten | fällt |
| Premarket-Kachel wieder „Opening Momentum" | fällt |
| Krypto-Mover auf erfundenes `change24h` | fällt |
| flatex-Symbol aus der Trefferliste | fällt |
| Scrollbalken der Signalleiste | fällt |

Kein Test ist blind.

---

## Was bewusst NICHT drin ist

`MOM_MIN_DOLLARVOL`, Konsolidierungsschwellen, Modus-A-Default, News-Trigger, Vorfilter,
Messung verpasster Mover. Das ist v3.10 und braucht Zähler aus einem echten US-Handelstag.

Für den Livelauf: Die Zeile **„Einlassgitter: N geprüft → X Large Cap + Y Momentum"**
steht in der Momentum-Mover-Kachel. Steht dort während der US-Handelszeit dauerhaft
`Momentum 0` und scheitert fast alles am Umsatz, ist die 2-Mio.-Schwelle zu hoch. Das ist
die Zahl, mit der wir kalibrieren — dann mit Messwerten statt mit Schätzungen.
