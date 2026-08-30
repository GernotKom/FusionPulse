# FusionPulse v3.27.0 — Der Situation-Score wird prüfbar

Additiv. **Kein einziger Wert wird anders berechnet als in v3.26.0** — das ist
mit 20.000 Zufallseingaben bewiesen, nicht behauptet.

---

## Warum ausgerechnet dieser Score

Er ist der **früheste und folgenreichste Eingriffspunkt der App**: er entscheidet,
welche Titel überhaupt in die Kandidatenliste kommen. Alles danach —
Kostenrechnung, Hitze, Erwartungswert, Rangfolge aus v3.20.0 bis v3.23.0 —
arbeitet nur noch mit dem, was er durchgelassen hat.

Er bestand aus einer Zahlenkette im Code:

```
24, 16, 14, 12, 45, 12, 8, −4, 7, −3, 0.16, −18, 42
```

Keine dieser Zahlen war je gegen ein Ergebnis geprüft. Sie stammen aus Annahmen.

**Und schlimmer:** die Zutaten wurden nirgends aufgezeichnet. Die Frage „trägt
dieser Koeffizient etwas bei" war nicht nur unbeantwortet, sondern
**unbeantwortbar**. Vierte Wiederholung derselben Lehre nach Situationstyp
(v3.17.0), Dollarumsatz (v3.18.0) und Spread (v3.23.0).

---

## Drei Schritte

### 1. Die Koeffizienten sind sichtbar

Alle in `SITU_W`, jeder mit seiner Behauptung daneben. Aus der Zahlenkette wird:

```js
brokeHigh:  24,   // Kurs über dem 60-Minuten-Hoch — stärkstes Einzelmerkmal
rvolMissing: -8,  // kein RVOL messbar → Abzug (fail-closed)
overextended: -18,// mehr als 3 ATR über EMA21 → Abzug
```

**Beweis, dass sich nichts geändert hat:** 20.000 Zufallseingaben plus
Randfälle, alte gegen neue Formel, null Abweichungen. Als Test dauerhaft
eingebaut. Zusätzlich verbietet eine Prüfung nackte Zahlen in der Formel —
sonst wäre die Tabelle Dekoration.

### 2. Die Beiträge werden aufgezeichnet

Jeder der zehn Terme schreibt seinen Punktbeitrag in den Snapshot
(`situParts`). Vier Zeichen je Term — die Alternative ist, die Frage nie
beantworten zu können.

**Nicht rückwirkend.** Die Auswertung beginnt bei null.

### 3. `/api/scoreaudit` und die Kachel „⚖️ Score-Audit"

Für jeden Term: *Sind die Fälle, in denen er Punkte vergeben hat, danach
häufiger ins Ziel gelaufen?* Plus die Frage, ob der Score **als Ganzes** trennt.

Vier mögliche Urteile, bewusst als Ursache formuliert:

| | |
|---|---|
| ✅ **trägt** | Trennschärfe über der Rauschgrenze, in der erwarteten Richtung |
| ⚪ **kein messbarer Beitrag** | Der Term vergibt Punkte, ohne dass sich das zeigt |
| 🔻 **wirkt verkehrt herum** | Er hebt die falschen Titel nach oben |
| … **nicht bewertbar** | Zu wenige Fälle — ausdrücklich **nicht** „neutral" |

---

## Ein Denkfehler, im Testlauf gefunden

Mein erster Entwurf meldete die **Überdehnung** als „wirkt verkehrt herum" —
obwohl die konstruierte Wahrheit sie korrekt gemacht hatte.

Der Grund: Überdehnung ist ein **Abzugsterm** (−18). Dass ihre Fälle seltener
ins Ziel laufen, ist genau richtig. Ein Abzugsterm, der die *besseren* Fälle
trifft, wäre kaputt — und wäre unentdeckt geblieben.

Das Vorzeichen des Gewichts bestimmt jetzt, was „richtig" heißt. Ein Test prüft
beide Richtungen und verlangt, dass dieselbe Trennschärfe bei Plus- und
Abzugsterm zu **entgegengesetzten** Urteilen führt.

---

## Drei Schutzmaßnahmen

**Zehn Terme sind zehn Tests.** Bei zehn Vergleichen liefert reiner Zufall
regelmäßig einen „signifikanten" Treffer. Die Rauschgrenze ist deshalb
mehrfachtestkorrigiert — dieselbe Bremse, die das Musterlabor seit v3.17.0
benutzt.

**Außerhalb der Stichprobe.** Geurteilt wird auf dem jüngeren Drittel.

**Fail-closed im Urteil.** Zu wenige Fälle ergeben „nicht bewertbar", niemals
„neutral". In der Kachel gestrichelt dargestellt, nicht grau — grau würde
„geprüft und harmlos" heißen.

**Das Modul ändert nichts.** Es empfiehlt, es schaltet nicht ab. Ein Test
verbietet jedes Überschreiben von `SITU_W`.

---

## Prüfung

Suite 47. Gegen konstruierte Wahrheit geprüft — 500 Fälle, in denen bekannt ist,
welcher Term wirklich trägt:

```
Term                  Pkt   AUC/Rausch   Treffer m/o    Urteil
Ausbruch / Trigger    +24    64% / 57%     55% / 28%    ✅ trägt
Liquiditätsvakuum      +6    47% / 57%     36% / 42%    ⚪ kein messbarer Beitrag
Überdehnung           −18    35% / 57%     21% / 51%    ✅ trägt (Abzugsterm)
Pullback hält         +12          —             —      … nicht bewertbar
```

Alle vier konstruierten Wahrheiten korrekt erkannt.

Sieben Negativkontrollen, alle greifen: Koeffizient still verändert · Beiträge
nicht aufgezeichnet · Mehrfachtestkorrektur entfernt · Fail-closed-Urteil
entfernt · auf allen Fällen statt außerhalb der Stichprobe urteilen ·
unbewertet sieht aus wie geprüft harmlos · Vorzeichen ignorieren.

**Nebenbei repariert:** vier Testschnitte griffen bis zu einem entfernten
Kommentar-Anker und zogen das neue Modul mit hinein. Ein Test, der von der
Reihenfolge der Datei abhängt, schlägt irgendwann falsch an. Jetzt schneidet
`sliceFn()` genau eine Funktion.

47 Prüfungen grün, Erreichbarkeits-Audit ohne Fund.

---

## Was jetzt funktioniert

- **Du siehst zum ersten Mal, was der Score wert ist** — als Ganzes und je Term.
- **Ein Term, der Punkte vergibt ohne Wirkung, fällt auf.** Bisher hätte er
  jahrelang mitlaufen können.
- **Ein Term, der die falschen Titel nach oben hebt, fällt auf.** Das ist der
  teuerste Fall, weil er aktiv schadet statt nur nichts zu tun.
- **Die Koeffizienten sind an einer Stelle änderbar** — mit dem Wissen, was jede
  Änderung bedeutet.

## Was noch offen ist

- **Die Auswertung beginnt bei null.** `situParts` wird erst seit dieser Version
  geschrieben und ist nicht rückwirkend zu heilen. Bei 40 nötigen Fällen je Term
  und Mehrfachtestkorrektur rechne mit mehreren Wochen, bis der erste Term ein
  Urteil bekommt — und mit deutlich mehr, bis alle zehn bewertbar sind.
- **Trennschärfe ist keine Ursache.** Ein Term kann trennen, weil er dasselbe
  misst wie ein anderer. Die Überschneidung zwischen Termen wird noch nicht
  ausgewiesen; das wäre der nächste Schritt und braucht mehr Daten.
- **Der Score wird weiter unverändert benutzt.** Das Audit empfiehlt. Ob und wie
  du Gewichte änderst, ist deine Entscheidung — und sollte erst fallen, wenn
  mehrere Terme belastbare Urteile haben.
- Alle offenen Punkte aus v3.18.0.
