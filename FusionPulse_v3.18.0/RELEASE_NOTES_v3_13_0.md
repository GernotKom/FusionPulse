# FusionPulse v3.13.0 · Live-Quote im Deep-Scan

Der Befund aus der Fehlersuche vor ein paar Tagen ist behoben — und der naive Weg wäre
teuer geworden.

25 Testsuiten grün in zwei Zeitzonen, vier SHA-Blöcke identisch, Negativkontrolle für
alle sechs Änderungen. **Kein Score, keine BUY-Logik berührt.**

---

## 1. Der Fehler

`freshestStockQuote()` wurde an genau **zwei** Stellen aufgerufen — beide im manuellen
Suchpfad (`tiingoStockLookup`, Zeilen 3734 und 3741). Der automatische Deep-Scan hat sie
**nie** aufgerufen.

Jede Zeile aus dem Scanner hatte deshalb `liveQuoteOk` undefiniert, und die Oberfläche
zeigte folgerichtig **„KEIN LIVE-QUOTE"** — mitten in der US-Handelszeit, auch für den
Titel im Fokusfenster. Genau das war in deinem Screenshot vom 27.08. um 15:15 zu sehen.

---

## 2. Warum der naive Fix nicht ging

Die Funktion einfach je Symbol im Scan aufzurufen hätte bei 20 Titeln **20 Alpaca- plus
20 Tiingo-Abfragen pro Zyklus** bedeutet. Bei einem Deep-Scan alle zwei Minuten über den
Handelstag sind das mehrere tausend zusätzliche Abfragen täglich. Das hätte das
API-Budget gesprengt, und zwar sofort.

**Der Ausweg lag schon im Bestand:** `tiingoIexSnapshot` holt `/iex` für den **gesamten
Markt** in einem Aufruf und filtert erst danach lokal. Und Alpacas
`/v2/stocks/snapshots` nimmt eine Symbolliste entgegen. Beide Quellen sind von Natur aus
Stapelabfragen — es hat nur nie jemand so benutzt.

---

## 3. Was jetzt passiert

`freshestStockQuotesBatch(env, symbols)` macht pro Durchlauf **genau zwei Aufrufe**,
unabhängig davon, ob 1 oder 100 Titel abgefragt werden:

| Quelle | Aufrufe bei 40 Symbolen | vorher (naiv) |
|---|---|---|
| Alpaca Snapshots | 1 | 40 |
| Tiingo `/iex` | 1 | 40 |

Der Kostenvorteil ist der Grund, warum die Änderung überhaupt tragbar ist — deshalb wird
er **gemessen und nicht behauptet**: Ein Test führt die Funktion mit Attrappen und 40
Symbolen aus und prüft, dass jeder Zähler auf exakt 1 steht.

**Der Einzelabruf ist jetzt nur noch ein Stapelaufruf mit einem Symbol.** Damit gibt es
genau **eine** Frischelogik statt zweier, die auseinanderlaufen können. Das ist die
direkte Lehre aus v3.10.0, wo `sectorLag` nur auf einem von zwei Datenpfaden gerechnet
wurde und deshalb im Normalbetrieb dauerhaft leer war.

---

## 4. Das Folgeproblem, das dabei aufgefallen ist

Sobald der Deep-Scan Quotes mitliefert, kommen Zeilen auch aus dem Server-Zwischenspeicher.
`liveQuoteAgeSec` wurde dann **zum Zeitpunkt des Scans** berechnet — ein drei Minuten
alter Kurs hätte weiterhin mit „8s alt" und grünem **LIVE / FRISCH** dagestanden.

Das wäre eine Lüge in genau der Anzeige gewesen, die dich vor einem Plan auf veraltetem
Kurs schützen soll.

Behoben: Das Alter wird beim **Anzeigen** aus dem Zeitstempel neu gerechnet, und die
Frische-Entscheidung gleich mit. Ein Kurs, der die Grenze inzwischen überschritten hat,
verliert sein „frisch" — auch wenn der Server ihn so geschickt hat. Fail-closed: ohne
Zeitstempel bleibt es beim Serverwert, ohne beides gilt der Kurs als nicht frisch.

---

## 5. Rein additiv

`attachLiveQuotes` schreibt nur an Zeilen, für die tatsächlich ein Quote vorliegt. Eine
Zeile ohne Quote behält ihre Felder **unverändert** und wird von der Oberfläche korrekt
als „kein Live-Quote" beschriftet. Kein erfundener Wert, kein Rückfall auf den
Analysepreis. Ein Test prüft das ausdrücklich, inklusive der Gegenprobe, dass ein
untergeschobener Ersatzwert auffliegt.

Scheitert der Stapelabruf ganz, bricht der Scan nicht ab — die Zeilen bleiben wie zuvor.

---

## Nachweise

- 25 Suiten grün, `TZ=Europe/Vienna` und `TZ=America/Chicago`
- Vier Claude-SHA-Blöcke unabhängig nachgerechnet: identisch
- Erreichbarkeits-Audit sauber
- **Funktionsnachweise, alle ausgeführt statt gelesen:**
  40 Symbole → 1 Alpaca-Aufruf, 1 Tiingo-Aufruf, 40 Ergebnisse ·
  0 Symbole → 0 Aufrufe · Zeile ohne Quote bleibt unverändert ·
  10 Minuten alter Kurs verliert sein „frisch"
- **Negativkontrolle**, jede Änderung einzeln zurückgedreht — alle sechs fallen:

| zurückgedreht | Test |
|---|---|
| Quotes nicht mehr an Zeilen hängen | fällt |
| Stapelabruf aus dem Deep-Scan entfernt | fällt |
| Alpaca-Abruf je Symbol statt gebündelt | fällt |
| Altersprüfung beim Anzeigen entfernt | fällt |
| Ersatzwert für Zeilen ohne Quote | fällt |
| Leerlaufschutz ohne Symbole entfernt | fällt |

---

## Was du nach dem Deploy sehen solltest

Während der US-Handelszeit sollte im Fokusfenster **LIVE / FRISCH** stehen statt
„KEIN LIVE-QUOTE", mit Quelle und Alter in Sekunden. Außerhalb der Handelszeiten bleibt
die Anzeige korrekt auf „veraltet" — das ist kein Fehler, sondern der ehrliche Zustand.

Falls weiterhin nichts kommt, gibt es genau zwei Möglichkeiten, und beide sind schnell
zu prüfen: Die Alpaca-Secrets `ALPACA_API_KEY_ID` und `ALPACA_API_SECRET_KEY` fehlen in
Cloudflare, oder Tiingos `/iex` liefert für die Titel gerade nichts. Der Zähler
`liveQuoteHits` im Scan-Ergebnis zeigt, wie viele Zeilen einen Quote bekommen haben —
steht er dauerhaft auf 0, ist es die erste Möglichkeit.

**Das ist damit Punkt 1 der drei offenen Befunde.** Es bleiben: die Favoritenquote von 2
auf 6 pro Zyklus, und `tradeMode: 'off'` — Modus A ist weiterhin nicht aktiv, der 8R-Deckel
greift also noch. Der Schalter steht in den Einstellungen und kostet nichts.

Nach dem Deploy `Cmd+Shift+R`.
