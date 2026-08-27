# FusionPulse v3.9.1 · Erreichbarkeit, Reihenfolge, Handelbarkeit

Eine reine Bedien- und Anzeigeversion. **Keine Zeile Bewertungslogik geaendert.**
Die vier SHA-verriegelten Claude-Bloecke wurden unabhaengig nachgerechnet und sind
identisch. 19 Testsuiten gruen, in `Europe/Vienna` und `America/Chicago`.

---

## 1. Der Schalter, den es gab, den aber niemand sehen konnte

**Meldung des Nutzers:** *„Die Schalter rechts im Bild sind nicht zu sehen, kein
Scrollbalken."*

**Befund.** Die Aktions-Spalte der Selbstauswertung (Modul 0) lag ausserhalb des
sichtbaren Bereichs. Das war **kein** zu schmales Layout, sondern die Kombination
aus zwei Dingen:

```css
.attr-wrap{overflow-x:auto}      /* Scrollbereich existiert */
```
plus die macOS-Standardeinstellung *Scrollbalken nur beim Scrollen anzeigen*.
Der Scrollbereich war da — nur gab es keinerlei Hinweis darauf. Auf dem MacBook Air
in der zweispaltigen Ansicht ist das der Regelfall, nicht der Sonderfall.

Das ist die unangenehmere Sorte Fehler: Die Funktion war vollstaendig gebaut,
getestet und funktionsfaehig. Sie war nur unbedienbar. Ein Test, der prueft, ob ein
Schalter *existiert*, faengt das nicht — er prueft die falsche Frage.

**Behoben mit drei Massnahmen, absichtlich zusammen und nicht einzeln:**

1. Die Aktions-Spalte klebt rechts (`position:sticky`) und bleibt immer im Bild.
2. Der horizontale Scrollbalken wird dauerhaft sichtbar erzwungen — damit ueberhaupt
   erkennbar ist, dass die Tabelle seitlich laeuft.
3. Unter 900 px bricht die Tabelle in Karten um. Jede Zelle traegt ihre Spalten­ueber­schrift
   in `data-lbl`, weil der Tabellenkopf dort ausgeblendet ist.

Massnahme 2 allein waere Symptombehandlung gewesen: sichtbarer Scrollbalken, aber
weiterhin ein Schalter, den man erst suchen muss.

---

## 2. Fokusfenster und Heatmap zuerst

**Wunsch des Nutzers:** *„Lass uns bei Aktien und Coins das Skope-Fenster und die
Heatmap als erstes anzeigen und dann erst den Rest."*

Die Krypto-Seite war bereits so aufgebaut. Die Aktienseite nicht: dort standen Depot,
Crowd, Portfolio, Radar, Learning und Aladdin **vor** dem Fokusfenster. Beim Oeffnen
sah man also zuerst den Rueckblick und musste zum aktuellen Zustand scrollen.

Neue Reihenfolge im Aktienradar:

| vorher | jetzt |
|---|---|
| Kopf + Suche | Kopf + Suche |
| Depot, Crowd, Portfolio | **Fokusfenster + Heatmap** |
| Radar, Extended, Opening | Depot, Crowd, Portfolio |
| Learning, Selbstauswertung, Lab | Radar, Extended, Opening |
| Aladdin | Learning, Selbstauswertung, Lab |
| **Fokusfenster + Heatmap** | Aladdin |
| Gruppenliste | Gruppenliste |

Auf der Krypto-Seite steht die Stimmungskachel (Fear & Greed) jetzt ebenfalls hinter
Fokus und Heatmap statt davor — dieselbe Logik, konsistent auf beiden Seiten.

Der Test misst die **tatsaechliche Position im Markup**, nicht das Vorhandensein eines
Kommentars. Verschiebt jemand die Stage spaeter wieder nach unten, faellt er.

---

## 3. Handelbarkeit bei flatex (neu, reine Anzeige)

**Anlass aus dem Gespraech:** *„Wichtig ist, dass die Titel bei flatex gelistet sind."*

Ein Kandidat, den der Nutzer bei seinem Broker nicht kaufen kann, ist fuer ihn wertlos —
unabhaengig davon, wie sauber das Setup aussieht. Das Momentum-Gitter aus v3.8.0 prueft
Kurs, Umsatz, Spread und Bewegung, also **Liquiditaet**. Es prueft nicht, ob der Titel
ueberhaupt im Handelsangebot steht.

Das Fokusfenster zeigt jetzt neben der Boerse einen Hinweis:

| Primaerlisting | Anzeige |
|---|---|
| NYSE, NASDAQ, AMEX, ARCA, BATS, CBOE, IEX | 🏦 flatex: US-Direkthandel wahrscheinlich |
| OTC, PINK, GREY, EXPERT, NMFQS | 🏦 flatex: eher nicht handelbar |
| leer oder nicht zuordenbar | 🏦 Handelsplatz n.v. / Verfuegbarkeit unklar |

**Was der Hinweis ausdruecklich NICHT ist.** Es gibt keine abfragbare
flatex-Instrumentenliste. Die Aussage stuetzt sich ausschliesslich auf das
Primaerlisting aus den Tiingo-Metadaten, das ohnehin schon mitgeliefert wurde. Sie ist
eine **Wahrscheinlichkeitsaussage**, keine bestaetigte Verfuegbarkeit und keine
Preisauskunft. Bestaetigt ist erst, was die Ordermaske zeigt — der Hinweistext sagt
das auch.

**Fail-closed.** Ein fehlender oder unbekannter Handelsplatz erzeugt NIE die positive
Aussage, sondern die Aufforderung, nachzusehen. Vier Testfaelle nageln das fest.

**Null Wirkung auf Score, BUY-Freigabe, Ampel oder Signalton.** Tests pruefen, dass
`flatexTradability` weder im Worker noch im Umfeld von `buyReady` vorkommt.

---

## 4. Was ich beim Audit gefunden habe — und was ich vorher falsch gesagt hatte

Zwei Korrekturen an meinen eigenen muendlichen Aussagen aus dem Gespraech davor:

**Falsch 1: „20 von 218 gescannt heisst, der Aktienscanner sieht nur 20 Titel."**
Nein. Diese Statuszeile gehoert zur **Krypto**-Seite; 218 sind die verfuegbaren
Bitpanda-EUR-Paare. Der Aktienradar laeuft gegen `12.000+ Tiingo/IEX` — nachgelesen in
`public/app.js:1199` und `src/worker.js:3574`. Ich habe eine Zahl gedeutet, ohne
nachzusehen, woher sie kommt.

**Falsch 2: „Der Large-Cap-Filter blockiert wahrscheinlich immer noch."**
Nein, der ist seit v3.8.0 erledigt. In `src/worker.js:1012` steht:

```js
function radarCandidateAllowed(r,count=false){
  if(largeCapRadarAllowed(r?.symbol)) return true;   // 48 Mega-Caps
  return momentumRadarAllowed(r,count);              // ODER messbares Gitter
}
```
Das ist ein ODER, kein UND. Ein Nachrichten-Mover kommt ueber Kurs ≥ 5 $, Dollar­umsatz
≥ 2 Mio. $ (IEX-Anteil), Spread ≤ 0,60 % und Bewegung ≥ 3 % herein, ohne auf der
Namensliste zu stehen. `OPENING_UNIVERSE` ist zwar aus der Large-Cap-Liste gebaut, wird
aber in Zeile 1987 mit Radarsymbolen und Favoriten vereinigt — es schliesst nichts aus.

**Damit bleibt der eigentliche offene Punkt unveraendert P-A2:** Die Schwelle
`MOM_MIN_DOLLARVOL = 2_000_000` ist eine **Schaetzung** und noch nie gegen echte
Live-Zahlen geprueft worden. Ich habe sie in dieser Version bewusst **nicht** angefasst.
Ohne die Zaehler aus einem echten US-Handelstag waere jede Aenderung wieder nur Raten —
und genau dieser Fehler steht schon zweimal in der Fehlerliste der Uebergabe.

---

## 5. Nachweise

- 19 Suiten gruen, `TZ=Europe/Vienna` und `TZ=America/Chicago`
- Vier Claude-SHA-Bloecke unabhaengig nachgerechnet: coin, stock, client, overlay — alle identisch
- **Negativkontrolle gefahren**, jeder Fix einzeln zurueckgedreht:

| zurueckgedreht | Test |
|---|---|
| `position:sticky` → `static` | faellt |
| Stage wieder nach unten verschoben | faellt |
| leerer Handelsplatz → `tone:'ok'` | faellt |
| ein `data-lbl` entfernt | faellt |

Kein Test ist blind.

---

## 6. Offen (unveraendert aus v3.9.0)

- **P-A2** Kalibrierung `MOM_MIN_DOLLARVOL` — braucht Zaehler aus einem echten Handelstag
- **P-A3** Modus A am Livemarkt gegenpruefen (Konsolidierungserkennung, Zielweite)
- **P-B** Modus B (3–6 Monate, Tagesbalken, Elliott stark)
- **P6 Teil 1b** Eingabemaske fuer manuelle Termine
- **P-C** Aktien-Sentiment (bewusst nicht gebaut)
- **P-D** Krypto-Fokuskarte auf `coinHeadline` umstellen, Glossar Krypto/Aladdin verdrahten
