# FusionPulse · Release Notes

**Eine Datei für alle Versionen.** Bis v3.31.0 lag für jede Version eine eigene
Notes-Datei im Repository — über hundert Dateien, von denen niemand mehr eine
gelesen hat. Sie sind hier zusammengeführt: die beiden jüngsten Versionen im
Volltext, alles davor als Chronik.

Die *Begründungen* und die daraus gezogenen Lehren stehen nicht hier, sondern in
`HANDOVER.md`. Diese Datei sagt, **was** sich geändert hat; das Handover sagt,
**warum** und **was daraus für die nächste Änderung folgt**.

---

# v3.32.3 — Korrektur eines eigenen Fehlers aus v3.32.0

Am 01.09. um 06:08 stand in der Systemleiste rot **„Kein Zugriff ·
Zugriffs-Token fehlt"** — während die App danebenmeldete: *20 gescannt, 5
angezeigt von 216, 32 API-Unterabfragen, 753 ms*, alle vier Ampeln grün, Kurse
auf dem Schirm. Die Anzeige hat einem eigenen Merker mehr geglaubt als den
Daten, die vor ihr lagen.

**Der Konstruktionsfehler, den ich in v3.32.0 eingebaut habe:**

```js
if (/nicht autorisiert|unauthorized|\b401\b/i.test(msg)) authDenied = true;
```

Zwei Fehler in einer Zeile. Erstens ein **Textmuster über fremde
Fehlermeldungen** statt des HTTP-Status — das greift bei jeder Meldung, in der
zufällig „401" vorkommt. Zweitens: **Setzer breit, Rücknahme schmal.** Gesetzt
wurde bei jedem beliebigen Fehler, zurückgenommen nur an einer einzigen Stelle,
im Erfolgspfad des Krypto-Scans. Ein solcher Zustand läuft immer in eine
Richtung und bleibt dann kleben.

> **Merksatz:** Ein klebriges Flag braucht eine Rücknahme, die mindestens so
> breit ist wie der Setzer — sonst ist es keine Statusanzeige, sondern ein
> Einwegschalter. Und: ein Statuscode ist eine Tatsache, ein Textmuster über
> fremde Fehlermeldungen eine Vermutung.

**Behoben, dreifach:**

1. Das Flag wird nur noch durch einen **echten HTTP-401** gesetzt.
2. Die Rücknahme sitzt im regelmäßigen `/api/health`-Abruf: Liefert der Server
   einen `status`-Block, hat er uns authentifiziert — anders gibt er ihn nicht
   heraus. Selbstheilend statt an einen Pfad gebunden.
3. **Widerspruchsregel** in der Systemleiste: Liegt eine Statusauskunft vor,
   wird ein alter Merker verworfen. Was messbar da ist, schlägt was gemerkt
   wurde. Ein Test prüft, dass diese Regel *vor* der roten Abbiegung greift.

| # | Sabotage | Ergebnis |
|---|---|---|
| 29 | Textmuster kehrt zurück | fällt |
| 30 | Rücknahme im Health-Abruf entfernt | fällt |
| 31 | Widerspruchsregel entfernt | fällt |
| 32 | Widerspruchsregel steht nach der roten Abbiegung | fällt |

## Nachtrag: ein latenter Zeitzonenfehler, den der Monatswechsel aufgedeckt hat

Beim Abschlusslauf am 01.09. um 04:11 UTC fiel eine Prüfung in
`America/Chicago` durch, die in `Europe/Vienna` grün war: *„Ein Kurs vom Vortag
darf nicht als heutig gelten."*

`dataSession()` bestimmte `sameDay` aus der **Browser-Ortszeit**, während alles
andere in der Funktion in ET rechnet. Eine Fixture „vor 24 Stunden" liegt in
Chicago um 23:11 Ortszeit noch auf demselben Kalendertag — also `sameDay: true`.
Die Prüfung war **47 Versionen lang latent kaputt** und fiel nur nie auf, weil
sie nie zu dieser Tageszeit lief.

Der Anwendungsfehler dahinter ist der wichtigere. Die Frage lautet: *Ist das die
heutige US-Sitzung?* Maßgeblich ist der Handelstag in New York, nicht der
Kalendertag am Wohnort. Ein Wiener, der um 01:00 MESZ nachsieht, bekam einen
Kurs aus der noch laufenden ET-Sitzung als „nicht von heute" ausgewiesen —
umgekehrt galt in Chicago ein 24 Stunden alter Kurs als heutig.

`sameDay` vergleicht jetzt den ET-Handelstag. Das Label zeigt weiterhin das
lokale Datum — der Nutzer liest sein eigenes; nur die **Bewertung** richtet sich
nach der Börse. Geprüft in fünf Zeitzonen (Wien, Chicago, New York, Tokio,
Auckland), dazu zwei ausdrückliche Fälle im Test: ein Kurs aus dem laufenden
ET-Tag muss als heutig gelten, einer von einem anderen ET-Tag nie.

**NK33:** Rückbau auf die Ortszeit → fällt in `America/Chicago`.

> **Merksatz:** Ein Test, der von der realen Uhrzeit abhängt, besteht so lange,
> bis er zufällig zur falschen Stunde läuft. Zwei Zeitzonen im Testlauf reichen
> nicht — es braucht Fixtures, die aus der geprüften Zeitzone selbst abgeleitet
> sind.

---

# v3.32.2 — Die Systemampel meldete Grün, während nichts lief

Im Bildschirmfoto vom 30.08., 23:20 stand nebeneinander: rot „Fehler: Nicht
autorisiert", Krypto-Punkt rot, keine einzige Zahl auf dem Schirm — und daneben
in Grün: **„App läuft einwandfrei · Datenserver stabil · kein
Handlungsbedarf".**

**Ursache.** `/api/health` antwortet ohne gültigen Token mit
`{ok:true, protected:true}` und **ohne** `status`. Damit ist die Liste der
Zustände leer, keine der Bedingungen für rot/orange/gelb greift, und der
Rückfall am Ende der Kette heißt `green`. Die Ampel hat *keine Fehlermeldung*
als *alles in Ordnung* gelesen.

Das ist der dritte Fall derselben Klasse in dieser Sitzung — nach dem
Bandbreiten-429 und der Quellenzeile — und die schärfste Ausprägung: **Wo eine
Ampel aus dem Fehlen von Meldungen auf Grün schließt, ist sie ausgerechnet im
Ausfall am unauffälligsten.** Lehre 8x: „nicht bewertbar" ist nicht „in
Ordnung".

**Behoben, fail-closed:**

- Bei fehlendem Token: **rot**, mit dem Text, dass keine Daten geladen werden —
  ausdrücklich **weder Aktien noch Krypto**.
- Ohne jede Statusauskunft: **orange**, „Zustand nicht abrufbar". Nicht grün.
- Beide Abbiegungen stehen *vor* der Levelberechnung. Ein Test prüft die
  Reihenfolge, denn dahinter platziert würden sie nie greifen.

**Klarstellung zu Krypto.** Die Krypto-Kurse hängen aus demselben Grund. Meine
frühere Aussage, Krypto sei „davon völlig unabhängig", galt der
Tiingo-Bandbreite und stimmt dafür — nicht aber für den Zugriffs-Token:
`/api/scan` läuft über dieselbe geschützte Route wie alles andere. Ohne Token
fragt der Worker Bitpanda gar nicht erst.

| # | Sabotage | Ergebnis |
|---|---|---|
| 25 | 401-Abbiegung entfernt, Ampel wird wieder grün | fällt |
| 26 | fehlende Auskunft fällt wieder auf grün zurück | fällt |
| 27 | 401-Fall nur gelb statt rot | fällt |
| 28 | Abbiegung steht nach der Levelberechnung (greift nie) | fällt |

---

# v3.32.1 — Zugriffs-Token: warum er trotz Eintrag nicht griff

Aus dem Betrieb gemeldet: Token eingetragen, trotzdem „Nicht autorisiert".
Drei Ursachen, zwei davon im Code behoben.

**1 · Unsichtbare Zeichen im Secret.** `echo "xyz" | wrangler secret put
APP_TOKEN` hängt ein `\n` an. Der strikte Vergleich `t === env.APP_TOKEN` trifft
dann nie — und niemand sieht warum, weil beide Seiten im Klartext identisch
aussehen. Beide Seiten werden jetzt getrimmt. Das schwächt nichts ab: ein
Geheimnis, dessen Sicherheit an einem führenden Leerzeichen hängt, ist keines.
Ein **leerer** Token gilt weiterhin nie als gültig — sonst hätte das Trimmen den
Zugang geöffnet statt repariert.

**2 · Das Feld war ein Passwortfeld.** Safari auf iOS ignoriert
`autocomplete="off"` bei `type="password"` und bietet ungefragt die
Passwortverwaltung an. Danach steht ein generierter Wert im Feld, der wie ein
eingetragener Token aussieht — Punkte sind Punkte. Jetzt Klartext, mit
`autocapitalize="none"`, `spellcheck="false"` und Sperren für gängige
Passwortmanager. Der Token ist ein Gerätezugang, kein Kontopasswort, und er muss
lesbar sein, um Tippfehler zu finden.

**3 · Der Fehler sagte nicht, woran es liegt.** Bisher kam nur „Nicht
autorisiert." — ob überhaupt etwas ankam, ob es zu kurz oder schlicht falsch
war, blieb offen. Wieder derselbe Satz für drei Zustände (Lehre 8aa). Die
401-Antwort enthält jetzt einen Hinweis, der die drei Fälle unterscheidet:
nichts angekommen (nicht gespeichert) · falsche Länge (Autofill) · falscher Wert
(Tippfehler, typisch 0/O und 1/l/I).

**Was der Hinweis nicht verrät:** weder das Geheimnis noch seine Länge. Nur zwei
Ja/Nein. Ein Test verbietet ausdrücklich, dass `want.length` in die Antwort
gelangt.

| # | Sabotage | Ergebnis |
|---|---|---|
| 20 | Trim im Vergleich entfernt | fällt |
| 21 | leerer Token gilt nach dem Trimmen als gültig | fällt |
| 22 | Hinweis verrät die Länge des Secrets | fällt |
| 23 | Feld wieder als Passwortfeld | fällt |
| 24 | Client verwirft den Server-Hinweis | fällt |

**Protokollnotiz:** NK20 und NK24 meldeten zunächst „blind" — die Sabotage hatte
ihren Anker gar nicht getroffen (`assert` schlug fehl, der Testlauf lief auf
unverändertem Code). Eine Negativkontrolle, die nichts verändert, beweist nichts.
Mit korrigierten Ankern fallen beide.

---

# v3.32.0 — Das Bandbreiten-Audit im Worker umgesetzt

**Bewertungslogik:** nicht berührt. Die vier SHA-256-Blöcke unabhängig
nachgerechnet und unverändert.

## 1. Bandbreite messen, bevor umgebaut wird (§10 D)

Das Audit schätzt: ~48 Whole-Market-Downloads je Stunde, ~34.000 im Monat, also
rund 1,2 MB je Antwort. Plausibel — aber nirgends nachgewiesen. Und §20 Schritt 1
des Audits sagt selbst *„nur auditieren und messen"*, während §14–§18 schon die
ganze Zielarchitektur ableiten.

Jede Tiingo-Antwort wird jetzt gewogen und einem Pfad zugeordnet
(`iex-wholemarket`, `iex-symbols`, `iex-chart`, `boats-bulk`, `daily-bars`, …).
`content-length` ist die exakte Zahl; fehlt der Header, wird die Textlänge
genommen und als **Näherung getrennt gezählt**. Eine Näherung wird als Näherung
ausgewiesen — Regel 4 gilt auch für Messwerte über uns selbst.

Ausgeliefert in `/api/health` unter `bandwidth`. Solange nichts gewogen wurde,
meldet der Worker `measured:false`, und die Anzeige schreibt „nicht gemessen"
statt einer beruhigenden Null. Der Wert ist ausdrücklich als **untere Schranke**
gekennzeichnet: er kennt weder den Verbrauch vor dieser Version noch andere
Clients.

**Bonus:** Ein Tiingo-429 heißt jetzt nicht mehr pauschal „Rate-Limit". Enthält
die Antwort das Wort *bandwidth*, steht im Fehlertext, dass sich das erst zum
Monatswechsel löst und nicht durch Warten. Genau diese Verwechslung hat am 30.08.
in die Irre geführt.

## 2. Symbolbegrenzter IEX-Abruf mit Selbsterkennung (§10 A / §14.2)

**Befund bestätigt:** `tiingoIexSnapshot(env, symbols)` nahm eine Symbolliste
entgegen, holte intern aber `/iex` für den *ganzen* Markt und filterte lokal. Für
20 Titel wurden ~12.000 übertragen.

Das Audit sagt „prüfen, ob Tiingo einen symbolbegrenzten Abruf unterstützt" — es
weiß es nicht, und ich kann es hier nicht prüfen (kein Token, und der Zugang
antwortet mit 429). Blind umstellen wäre geraten; von Hand testen verschiebt die
Lösung auf den 1. September.

Deshalb probiert die App es **einmal selbst** und merkt sich das Ergebnis in D1:

- `?tickers=` versuchen → kommen die angefragten Symbole zurück **und** ist die
  Antwort nicht offensichtlich der ganze Markt → ab jetzt immer schmal.
- Fehler, leere Antwort oder ignorierter Parameter → ab jetzt wieder
  Whole-Market. Nach sieben Tagen wird erneut probiert, falls Tiingo nachrüstet.

**Der Rückfall ist der alte, funktionierende Weg — nicht ein leeres Ergebnis.**
Ein misslungener Sparversuch darf die Quote nicht verschlechtern, nur die
Ersparnis kosten. Die Erkennung ist streng: eine leere Antwort zählt nicht als
Erfolg, sonst hätte ein Versuch außerhalb der Handelszeit „funktioniert"
gemeldet und danach dauerhaft nichts mehr gefunden.

## 3. Sessionabhängige Radar-Taktung (§10 B / §15)

Der Radar-Cache lag pauschal bei 50 Sekunden — bei minütlichem Cron rund 1.440
Whole-Market-Downloads am Tag, auch nachts um drei, auch samstags. Neu gestaffelt
nach Marktphase: Opening und regulärer Handel unverändert 50 s, Premarket 2–3 min,
After-Hours 3–5 min, geschlossener Markt 15 min. Rechnerisch rund 60 % weniger
Downloads, und die Ersparnis kommt vollständig aus den 16 handelsfreien Stunden.

**Regel 4 gewahrt, und das war hier nicht selbstverständlich** — längeres Cachen
macht Daten älter: Der Radar hat 0 % BUY-Gewicht, der bestehende
Alterungsfilter (`ageMin <= maxAge`) bleibt unverändert, und eine **unbekannte
Phase bekommt den sparsamen Wert, nicht den schnellen**. BOATS ist unangetastet —
die Overnight-Session läuft genau dann, wenn der IEX-Radar schweigt.

## 4. R11 — der Fallstrick, den das Audit nicht sieht

`MOM_MIN_DOLLARVOL = 2 Mio. $` ist **keine absolute Größe**. Der Wert ist auf den
IEX-Anteil kalibriert; die Herleitung steht seit v3.8.1 im Code (20 Mio. $ hätten
fast alles ausgesperrt). Wechselt der Radar auf einen konsolidierten Feed —
was das Audit empfiehlt und ein Alpaca-Upgrade nahelegt — liefert derselbe Titel
das 30- bis 50-fache Volumen. **Dieselbe Schwelle wäre trivial erfüllbar und das
Einlassgitter faktisch aus.**

Es würde nicht auffallen: Die Liste würde nicht leer, sondern länger — und eine
längere Kandidatenliste sieht nach Erfolg aus. Die schlimmste Sorte Fehler in
diesem Projekt.

Die Schwelle hängt jetzt an der Marktbreite (`RADAR_FEED`), nicht an einer festen
Zahl. Fail-closed: ein **unbekannter** Feed bekommt den strengen
Gesamtmarkt-Faktor. Ein **fehlender** Eintrag bekommt IEX — das ist der belegte
Ist-Zustand, und eine Verschärfung ins Blaue hätte die Liste geleert, was
seinerseits wie ein Defekt aussieht.

Der Faktor 35 ist eine Herleitung (Mitte der 2–3-%-Spanne), keine Messung, und
gehört nach dem ersten Lauf mit konsolidiertem Feed anhand von `radarGateStats`
nachkalibriert.

## 5. Suite 51 · `tests/bandwidth-feed.mjs` — und R9 erledigt

Beide bisher eigenständigen Suiten (48, 50) und die neue 51 laufen jetzt mit
`npm run check`. Insgesamt **52 Prüfläufe**.

| # | Sabotage | Ergebnis |
|---|---|---|
| 1 | unbekannter Feed bekommt die milde IEX-Schwelle | fällt |
| 2 | Opening wird mitgedrosselt | fällt |
| 3 | unbekannte Phase lädt häufiger statt sparsamer | fällt |
| 4 | misslungener Sparversuch liefert leere Liste | fällt |
| 5 | unbrauchbare Größenangabe als 0 Bytes gebucht | fällt |
| 6 | fehlende Messung als 0 GB gemeldet | fällt |
| 7 | Alterungsfilter mit aufgeweicht | fällt |
| 8 | Gitter ignoriert den Feed wieder | **erst blind** |
| 9 | leere Antwort gilt als tauglicher Subset-Abruf | fällt |
| 10 | Client rechnet trotz `measured:false` weiter | fällt |
| 11 | Bandbreiten-429 wieder ununterscheidbar | fällt |
| 12 | SIP-Faktor so hoch, dass die Liste leer bleibt | fällt |

**NK8 lief durch.** Die Suite prüfte `momMinDollarVol` in Isolation — und die
blieb bei der Sabotage ja korrekt. Der Nutzer trifft aber
`momentumRadarAllowed`. Die Suite führt das Gitter jetzt selbst aus und prüft die
Wirkung: derselbe Titel muss bei IEX durchkommen und bei SIP scheitern.
**Vierte Wiederholung der Lehre:** prüfen, was den Nutzer trifft, nicht was
leicht zu prüfen ist.

NK12 sichert die Gegenrichtung ab — ein zu hoher Faktor würde die Liste leeren,
und das ist der Fehler aus v3.8.1.

## 6. Vier bestehende Tests angepasst

Vier Prüfungen in `safety-regression.mjs` klebten an der genauen Schreibweise von
`radarCandidateAllowed(r,true)` und `MOM_MIN_DOLLARVOL`. Der **Zweck** ist
unverändert geprüft; die Regexe hingen an der Argumentzahl. Ein Test, der die
Schreibweise statt der Sache prüft, blockiert richtige Änderungen.

## 7. Nachtrag aus dem Bildschirmfoto vom 30.08., 23:13

Das Bild zeigte v3.31.0 mit **„Fehler: Nicht autorisiert"** und darunter dreimal
Gelb: Datenquelle nicht bestimmbar · Marktbreite nicht bestimmbar · Bandbreite
nicht gemessen. Alle drei Zeilen waren technisch korrekt — und in der Summe
irreführend. Die Ursache war kein Datenproblem: **auf dem Gerät fehlte der
Zugriffs-Token.** Er liegt im lokalen Speicher des Browsers und wandert nicht
mit; wer die App am PC eingerichtet hat und sie am Handy öffnet, bekommt auf
jede `/api/`-Route ein 401.

Das ist Lehre 8aa in Reinform: derselbe Satz bei Ausfall und bei leerem
Ergebnis. `feedInfo` und `bandwidthNote` kennen den 401-Fall jetzt und nennen
ihn beim Namen, samt Weg zur Lösung und dem ausdrücklichen Hinweis, dass es
**kein Problem des Datenanbieters** ist.

| # | Sabotage | Ergebnis |
|---|---|---|
| 13 | 401-Fall wieder als „nicht bestimmbar" gemeldet | fällt |
| 14 | Flag wird nach erfolgreichem Scan nicht zurückgenommen | **erst blind** |
| 15 | Bandbreite wird trotz 401 behauptet | fällt |

**NK14 lief durch.** Der Regex `/authDenied = false/` traf die *Deklaration*
und war damit immer erfüllt. Geprüft werden muss die Rücknahme im
**Erfolgspfad** — sonst bliebe der Token-Hinweis stehen, nachdem der Nutzer ihn
eingetragen hat, und die App würde einen behobenen Fehler weitermelden. Fünfte
Wiederholung derselben Lehre: der Test muss die Stelle treffen, die den Nutzer
trifft.

## 8. Nachtrag: der ZWEITE Whole-Market-Download

Beim Nachrechnen, ob die Maßnahmen reichen, kam heraus: **der Cron lädt den
ganzen Markt zweimal je Doppelminute**, nicht einmal. Einmal für den Radar
(`stockMinute%2===1`), einmal für den Deep-Scan, der über
`freshestStockQuotesBatch` → `tiingoIexSnapshot` frische Kurse für ~20 Titel
holt und dafür ebenfalls `/iex` zieht. Rund 1.440 Downloads am Tag, nicht 720 —
die Radar-Taktung allein hätte also nur die Hälfte gedeckelt.

Der Deep-Scan braucht 20 Zeilen, die der Radar Sekunden vorher heruntergeladen
hat. Der Radar hält seinen Rohabruf jetzt kurz vor (`iexRawMemo`), der Deep-Scan
bedient sich daraus. Ein Download statt zwei — **unabhängig davon, ob
`?tickers=` funktioniert.**

**Regel 4 ist hier scharf**, weil Wiederverwendung leicht alte Kurse frisch
aussehen lässt. Zwei Sicherungen: Der Vorrat wird nur innerhalb des
Frischefensters der aktuellen Marktphase benutzt (120 s im Handel, 900 s sonst
— dieselben Fenster, gegen die `classifyQuoteFreshness` ohnehin prüft), und die
**Zeitstempel der Zeilen bleiben unverändert**. Es wird nichts auf „jetzt"
gesetzt; ein zu alter Kurs fällt durch dieselbe Prüfung wie vorher. Die
Optimierung spart einen Download, sie fälscht keinen Wert.

| # | Sabotage | Ergebnis |
|---|---|---|
| 16 | Wiederverwendung entfernt, zweiter Download kehrt zurück | fällt |
| 17 | Vorrat ohne Altersgrenze benutzt | fällt |
| 18 | leerer Treffer liefert leere Liste statt Abruf | fällt |
| 19 | Frischefenster im Handel auf 15 Minuten aufgeweicht | fällt |

### Hochrechnung — mit den tatsächlichen Werten aus dem Code

Downloads je Monat: **~103.700 → ~15.200.**

| Antwortgröße | vorher | nachher |
|---|---|---|
| 0,6 MB | 61 GB | **8,9 GB** |
| 1,2 MB (Audit-Schätzung) | 122 GB | **17,8 GB** |
| 2,0 MB | 203 GB | **29,6 GB** |

Das sind Hochrechnungen aus den Taktwerten, **keine Messung** — die
Antwortgröße ist weiterhin die unbekannte Größe. Genau sie zählt die App ab
diesem Deploy mit.

## Was jetzt funktioniert

Ab dem nächsten Deploy zählt die App mit, **wie viele Bytes jeder Datenpfad
verbraucht**. Nach ein bis zwei Tagen steht schwarz auf weiß, was die 40 GB
frisst — statt der Schätzung aus dem Audit. Bis dahin steht ehrlich „nicht
gemessen" da.

Nachts, am Wochenende und an Feiertagen lädt der Radar alle 15 Minuten statt
jede Minute. Im Opening ändert sich nichts.

Und die App probiert selbstständig, ob Tiingo den schmalen Abruf beherrscht.
Wenn ja, sinkt der größte Posten sofort um etwa den Faktor 600 (20 Symbole statt
12.000). Wenn nein, läuft alles wie bisher weiter. Das Ergebnis steht im Log
unter `iex_subset_mode`.

## Was noch offen ist

- **Die Zahlen fehlen noch.** Erst nach ein, zwei Tagen Laufzeit lässt sich
  sagen, ob die Schätzung des Audits stimmt und ob die Maßnahmen reichen.
- **R10** (Client-Takt hängt am Anbieternamen) bleibt offen — jetzt aber mit
  Messgrundlage in Sicht.
- **Der Faktor 35 für SIP ist hergeleitet, nicht gemessen.**
- **BOATS** (§10 C, §17) ist unangetastet. Der Pfad ist derzeit nicht der
  Hauptverdächtige; die Messung wird das zeigen.

---

# v3.31.0 — Datenquelle und Marktbreite werden ehrlich

**Anlass:** Bandbreiten-Audit des ChatGPT-Strangs vom 30.08.2026.
**Umfang:** der Teil des Audits, der im Public-Bereich liegt — §28 (sichtbare
Quellenkennzeichnung), §29 (Provider-Ausfall darf nichts verbessern), die
Anzeigeseite von §10 D.
**Bewertungslogik:** nicht berührt. Kein Score, kein Gate, keine Ampel, keine
Freigabe. Die vier SHA-256-Blöcke unabhängig nachgerechnet und unverändert.
**`src/worker.js`:** nicht angefasst.

## Was NICHT umgesetzt wurde, und warum

Das Audit richtet sich an den Worker-Strang und sagt das selbst zweimal
(§1 und Kurzfassung Punkt 9: *„Nur `src/worker.js` ändern, solange der
Parallelstrang an den Public-Dateien arbeitet"*). Beim Worker liegen deshalb:

| Audit | Thema |
|---|---|
| §10 A, §14.2 | symbolbegrenzter `/iex`-Abruf statt Whole-Market-Bulk |
| §10 B, §15 | sessionabhängige Taktung der Discovery |
| §10 C, §17 | BOATS messen und takten |
| §10 D | Bandbreite **messen** (die Anzeige dafür ist hier gebaut) |
| §22–§34 | Provider-Failover Tiingo → Alpaca → Twelve Data |
| §11, R4 | Nachrichtenzeile, erst nach bestätigtem HTTP 200 |

## Der Befund

§28 war nicht nur offen — die App hat aktiv das Falsche behauptet:

```js
.includes('Tiingo') ? 'Tiingo IEX, US-Markt (Primary)'
                    : 'Twelve Data, US-Markt (Fallback)'
```

Eine binäre Behauptung über ein offenes Feld. Jede Nicht-Tiingo-Quelle wurde als
*Twelve Data* ausgewiesen — auch ein leeres Feld, auch ein unbekannter Wert, und
insbesondere **auch Alpaca**. Der geplante Failover hätte in der Kopfzeile den
falschen Anbieter genannt. Derselbe Fehler ein zweites Mal in `RESOURCE_LABEL`
(`stocks: 'Aktien (Twelve Data)'`, obwohl Tiingo primär liefert).

Zweiter Befund: Dass der IEX-Feed nur rund **2–3 % des US-Volumens** sieht,
stand seit v3.8.1 in den Notizen — es war der Grund, `MOM_MIN_DOLLARVOL` von
20 auf 2 Mio. $ zu korrigieren — und war nie sichtbar.

## Was gebaut wurde

- **`feedInfo(meta, opening)`** — eine Wahrheitsquelle für Anbieter, Rolle und
  Marktbreite. Kein `else`-Zweig, der einen Namen setzt: ein unbekanntes Feld
  bleibt unbekannt. Unbekannt wird nie `primary` und nie `full`; auch ein
  bekannter Anbieter mit unbekanntem Feed nicht. „nicht bestimmbar" ist
  sprachlich von „vollständig" getrennt.
- **`#stockFeed`** — sichtbares Badge im Aktienkopf statt einer Fußnote unter
  der Liste.
- **`bandwidthNote(meta)`** — fail-closed. Der Worker liefert diese Zahlen noch
  nicht; fehlt ein Feld, steht **„nicht gemessen"** samt dem Hinweis, dass daraus
  keine Reserve folgt. Nie eine 0. Sobald Zahlen kommen, rechnet die Anzeige
  ohne weitere Änderung; 40 von 40 GB ist rot.
- **Rate-Limit-Text** nennt bei Aktien die Monatsbandbreite als mögliche
  Ursache — die geht durch Warten nicht weg.
- Kein Alpaca-Tarifname im Code (§33.8); ein Test verbietet `Algo Trader`,
  `Alpaca Plus`, `Alpaca Basic`.

## Suite 50 · `tests/provider-breadth.mjs` · Negativkontrollen

| # | Sabotage | Ergebnis |
|---|---|---|
| 1 | alte binäre Quellenzeile wiederhergestellt | fällt |
| 2 | unbekannte Quelle wird als Twelve Data geraten | fällt |
| 3 | unbekannte Marktbreite gilt als voll | **erst blind** |
| 4 | fehlende Bandbreite als 0 gemeldet | fällt |
| 5 | 40/40 GB nur noch als Warnung statt Fehler | fällt |
| 6 | Herkunftsanzeige hebt `r.score` um 0,1 | fällt |
| 7 | Feed-Badge aus dem Markup entfernt | fällt |

**NK3 lief zuerst durch.** Ich hatte nur „gar nichts bekannt" geprüft — das
trifft den Alpaca-Zweig nicht, also konnte eine Sabotage genau dort nicht
auffallen. Die Lücke beschreibt den Zustand *Anbieter bekannt, Feed noch nicht
geladen*, der bei jedem Start auftritt. Dritte Wiederholung der Lehre: ein Test
muss den Wert benutzen, der die Abwehr tatsächlich erreicht.

Nebenbefund: Die erste Negativprüfung schlug auf dem eigenen Erklärkommentar an,
der die alte Zeile zitiert — wörtlich der Fehler aus v3.12.0. Alle
Verbotsprüfungen laufen jetzt auf kommentarbereinigtem Quelltext.

## Bewusst nicht gemacht

- **Client-Poll-Takt nicht angefasst** (R10). `setStockPoll()` prüft den
  Anbieternamen und wird bei Alpaca-Fallback träge. Jede Beschleunigung erhöht
  Abrufe; ohne Bandbreitenzahlen wäre die Änderung geraten.
- **Keine Einsparungsprognose** — §19 des Audits verbietet sie zu Recht.
- **Kein Provider-Umschalter in der Oberfläche** (§26).

## Was jetzt funktioniert

Im Aktienkopf steht, **wer die Daten liefert und wie breit der Markt ist, den
dieser Anbieter sieht**. Und es steht zum ersten Mal sichtbar dabei, dass der
aktuelle Feed nur rund 2–3 % des US-Handelsvolumens sieht — das war immer so,
es stand nur nirgends. Wenn die App „Rate-Limit" meldet, steht dabei, dass das
bei Aktien auch die aufgebrauchte Monatsbandbreite sein kann.

## Was noch offen ist

- Das eigentliche Bandbreitenproblem liegt im Server-Teil. Diese Version macht
  den Zustand sichtbar, sie senkt den Verbrauch nicht.
- Die beiden neuen Prüfungen laufen noch nicht automatisch mit (R9).
- Der Aktualisierungstakt bremst sich aus, sobald nicht Tiingo liefert (R10).

---

# v3.30.0 — R1 · Das Skope-Fenster im Coins-Bereich

**Bewertungslogik:** nicht berührt. **`src/worker.js`:** nicht angefasst.

## Der Befund — warum R1 zwanzig Versionen offen war

R1 lautete: *„Das Fenster, in dem alles über einen Coin steht, steht zuletzt und
soll oben stehen — wie bei Aktien der Fokus."* Das wurde seit v3.9.1 als
Reihenfolge-Frage gelesen und war als solche längst erledigt: `.stage` ist seit
v3.9.1 das erste Element des Kryptobereichs. Zweimal als erledigt verbucht —
danach fünfmal erneut gemeldet.

**Die Meldung war richtig, geprüft wurde am falschen Ort.** Nicht die Position
war falsch, sondern der Inhalt. Das erste Fenster enthielt den *Plan* (Zone,
Kaufsumme, CRV, Kosten, TP1/TP2, Preisleiter). Die *Analyse* — Kursverlauf,
neun Faktoren, Mikrostruktur, Ziel-Herkunft — lag ausschließlich im Modal hinter
dem letzten Knopf der Karte. Im Aktienbereich steht genau das seit jeher im
Fokusfenster.

## Was gebaut wurde

- **`coinScopeBlocks(r)`** — eine Quelle, zwei Anzeigen. Fokusfenster (neu) und
  Detailfenster (unverändert erreichbar). Ein Test verbietet eine zweite Kopie
  der Faktorzeilen.
- **`.coinscope`** als drittes Kind der Fokuskarte mit `grid-column:1/-1`. Ohne
  die Spannung über beide Spalten zöge der lange Block die Preisleiter
  (`height:100%`, prozentuale Marken) unlesbar in die Länge.
- **Sechs fail-closed-Lücken** geschlossen, die im alten Modal seit v3.0 offen
  waren: `imbalance` ergab `NaN %`, `vwapDev`/`rsi`/`atrPct`/`costRatio`
  `null …`, `tp2Source` blieb leer. `null × 100 = 0` hätte eine nicht gemessene
  Orderbuch-Schieflage als ausgeglichenes Buch ausgewiesen.

## Suite 48 · `tests/coin-scope.mjs` · Negativkontrollen

| # | Sabotage | Ergebnis |
|---|---|---|
| 1 | `coinScopeBlocks(r)` aus `renderFocus` entfernt | fällt |
| 2 | `grid-column:1/-1` aus dem CSS entfernt | fällt |
| 3 | Faktorzeilen ein zweites Mal im Quelltext | fällt |
| 4 | Faktoren ganz aus `coinScopeBlocks` entfernt | fällt |
| 4b | Faktoren im Quelltext, Ausgabe abgeschaltet | fällt |
| 5 | Fokusfenster hinter die Top-Picks-Kachel verschoben | fällt |
| 6 | fehlenden RSI wieder ungeschützt eingesetzt | fällt |
| 7 | Skope-Block ohne ausgewählten Coin behauptet | fällt |

**4b ist die wichtigste:** Nach 4 fiel der Test an einer Quelltextprüfung. Ob
der *ausgeführte* Nachweis Zähne hat, war damit nicht gezeigt. 4b lässt den
Quelltext unverändert und schaltet nur die Ausgabe ab.

## Bewusst nicht gemacht

Modal und `Details`-Knopf bleiben. Kein Auf-/Zuklappen (ein `<details>` springt
bei jedem Scan in den Ausgangszustand zurück und verwirft den Klick). Die
Coin-Suchleiste wurde nicht verschoben (R8). Kein neuer Glossareintrag — es ist
kein neuer Fachbegriff hinzugekommen.

---

# Chronik v3.5.0 – v3.29.2

Die ausführlichen Begründungen stehen in `HANDOVER.md`, Abschnitte 8b–8ab.

| Version | Was |
|---|---|
| v3.29.2 | Vorabend-Liste auf Tiingo-Stundenlimit umgebaut: Balken je Titel 20 h gecacht, `FETCH_BUDGET: 6`, harter Abbruch bei 429. Aufbauphase ist kein Ausfall |
| v3.29.1 | Erster echter Abendlauf lieferte nichts: `columns=` ohne `date` → jeder Balken verworfen; Ausfall wurde als Normalfall gemeldet; `.eve-bar` auf 6 px gestutzt |
| v3.29.0 | Vorabend-Liste (`/api/evening`): Kandidaten für den nächsten Tag aus Tagesbalken, Trigger, struktureller Stop, Restweg. Drei blinde Tests gefunden |
| v3.28.0 | `rideNow()` — ein Name oder Schweigen, neun Hürden. `rideSize()`. Handelstagebuch (`trades`, `/api/journal`): misst erstmals den Händler statt nur den Markt |
| v3.27.0 | Situation-Score prüfbar: `SITU_W` an einer Stelle, `situParts` im Snapshot, `scoreAudit()` mit Mehrfachtestkorrektur |
| v3.26.0 | Bereichsordnung: Überschrift ins Element, das sie überschreibt; Auswertungen in eigenen Bereich `#labZone`; Positionskette als Test |
| v3.25.0 | Der Ausfall vom 29.08.: `respondWith` ohne `.catch()` legte die App still. `tests/sw-fault.mjs` führt den Service Worker unter Störung AUS |
| v3.24.0 | Boot-Wächter inline in `index.html`, Notausstieg `?fpreset=1`, `posNum()` — drei Parameterfehler derselben `Number(null)`-Ursache |
| v3.23.0 | Kryptoschiene für Top Picks: `PICK_COST.kind='fixed'` gegen `COIN_COST.kind='proportional'`. Fail-closed-Verstoß beim Spread gefunden |
| v3.22.0 | Ertrag je **Zeit** statt je Trade (`tempoOf`), Kostenlast-Tabelle, dritter Fehler in der Rastersuche |
| v3.21.0 | Ursachentrennung (`heatProfile`, `pickVerdict`), `mae_pre`, `optimizeGrid` mit vier realen Fallen |
| v3.20.0 | Top Picks nach Netto-Euro. Die Erfolgsschwelle war falsch: 5 % statt der wirtschaftlich nötigen 2,04 % |
| v3.19.0 | Renderbudget: Service Worker cache-first für versionierte Assets, `paintPanel`, ruhende Sekundenuhr |
| v3.18.0 | Freigabe-Trichter, Kalibrierung im Musterlabor, Sektor-Reserve zieht aus dem Katalog nach |
| v3.17.0 | Musterlabor (`/api/patterns`): Snapshot schrieb nur `setup` — Situationstyp, Lebenszyklus und Reife wurden nie mitgeschrieben |
| v3.16.0/.1 | **Modus A gibt keine Kauf-Freigabe mehr.** Das Gate hing an `netCRV`, einer Kennzahl des anderen Modells. Terminmaske nachgewiesen |
| v3.15.0 | Modellvergleich, Sektor-Priorisierung, Kachelfarben mit reservierten Ampelfarben |
| v3.14.x | Die teuerste Fehlersuche: `body{height:100%}` machte jede Fußleisten-Korrektur wirkungslos. Versionsstempel in allen Assets, Shell-Konsistenzprüfung, sichtbare Systemampel |
| v3.13.0 | Live-Quote im Deep-Scan als Stapelabruf: zwei API-Aufrufe statt vierzig |
| v3.12.0 | Kopfhöhe gemessen statt geraten, zweistufige Navigation, Heatmap-Spuren mit Richtung |
| v3.11.0 | Aufmerksamkeitsimpuls (nur der stärkste, nur der neue), Quartalszahlen-Tafel |
| v3.10.0 | `sectorLag` war auf dem primären Datenpfad nie berechnet. Sektor-Nachzügler-Kachel |
| v3.9.x | Fixbetrags-Sizing, Wächter-Schalter wieder erreichbar, Reiter Coins/Aktien/Lab, Heatmap-Spuren enden am Punkt |
| v3.8.x | **Der große Befund:** Das Universum war eine 48-Symbol-Mega-Cap-Liste; die App suchte per Konstruktion an dem vorbei, was gewollt war. Momentum-Gitter statt Namensliste, einstellbares Kostenmodell |
| v3.5.x–v3.7.0 | Claude-Modus (EV-basiert), Modul 0 Attribution, Aladdin, Modul 2 Portfolio-Risiko, zentrales Glossar, Krypto-Sentiment |
