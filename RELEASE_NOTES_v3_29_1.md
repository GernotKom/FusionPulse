# FusionPulse v3.29.1 — warum die Vorabend-Liste leer war

## Was jetzt funktioniert

- **Die Kursabfrage holt wieder ein Datum.** Das war der Grund für die leere
  Liste: Es wurden 40 Titel abgerufen, aber ohne Datumsangabe war kein einziger
  Kurs verwertbar. Die App hat das korrekt bemerkt und alles verworfen — sie hat
  es nur nicht gesagt.
- **Ein Datenausfall heißt jetzt Datenausfall.** Vorher stand bei null
  brauchbaren Titeln „ist das der Normalfall" — derselbe beruhigende Satz wie
  bei einem echten leeren Ergebnis. Jetzt steht dort eine rote Meldung mit der
  Zahl der fehlgeschlagenen Abrufe und der ersten Fehlermeldung.
- **Die Kennzahlenzeile ist nicht mehr abgeschnitten**, und der Knopf
  „neu rechnen" ist sichtbar. Beides steckte in einer Zeile, der ich versehentlich
  eine feste Höhe von sechs Pixeln gegeben hatte.
- **Die Meldung läuft nicht mehr in einer Zeile zusammen.**
- **Die Kachelfarbe färbt jetzt sichtbar die Fläche**, nicht mehr nur den Rand.
  Die Mechanik war richtig, die Beimischung war mit 8 % zu schwach; jetzt 20 %.
- **Drei neue Prüfungen** sorgen dafür, dass genau diese Fehler nicht
  zurückkommen. Alle 47 Suiten laufen grün.

## Was noch offen ist

- **Die Liste hat immer noch nie echte Kandidaten geliefert.** Der Fehler ist
  behoben, aber ob nach dem Ausrollen fünf, fünfzehn oder null Namen kommen,
  weiß ich erst nach deinem nächsten Lauf.
- **Das Krypto-Fenster im Coins-Bereich** ist nicht angefasst — ich weiß nicht
  sicher, welche Kachel du meinst, und blind umsortieren wäre geraten.
- **Der Farbpinsel in jeder Kachel** ist nicht gebaut. Das ist eine eigene
  Version wert, keine Nebenarbeit.
- **Frischesperre und Nachrichtenzeile** stehen unverändert offen.
