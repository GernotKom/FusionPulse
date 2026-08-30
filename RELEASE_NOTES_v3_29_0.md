# FusionPulse v3.29.0 — Die Vorabend-Liste

## Worum es geht

Die App sah bisher nur bis zum 60-Minuten-Balken zurück. Damit sieht sie die
Zündung, nicht die Ladung. Eine Gelegenheit entsteht aber am Vorabend: ein Titel
läuft mehrere Tage eng zusammen, der Umsatz versiegt, und direkt darüber liegt
ein Widerstand. Wer erst einsteigt, wenn die Bewegung sichtbar ist, hat bei
2,04 % Zielweite oft ein Drittel davon schon verloren.

Die neue Liste rechnet am Abend aus Tagesbalken, welche Titel am nächsten Tag
eine Auslösemarke haben — mit Einstieg, Stop und Ziel, die alle feststehen,
bevor der Handel beginnt.

## Was jetzt funktioniert

- **Die Vorabend-Liste steht im Aktienbereich** und füllt sich beim Öffnen der
  App sowie alle 30 Minuten. Sie zeigt zwei Arten getrennt: Ausbrüche aus einer
  Enge und Rückkehrbewegungen nach einem Rückschlag.
- **Jeder Kandidat hat einen vollständigen Plan in Euro**: Auslösemarke, Stop,
  Ziel, Positionsgröße, Gewinn und Verlust in Euro, und die Trefferquote, ab der
  sich der Trade nach Kosten gerade eben rechnet.
- **Titel, deren Stop breiter ist als dein Budget, verschwinden nicht.** Sie
  stehen in einer eigenen, aufklappbaren Gruppe mit dem Hinweis, dass der Stop
  nicht enger gerechnet wird. Nachweislich getestet: der Stop im Plan ist exakt
  der Stop aus dem Chartbild.
- **Fünf Hürden sind einzeln nachgewiesen**, jede mit einem Fall, der durchgeht,
  und einem, der genau an ihr scheitert: Stopbudget, Restweg zum nächsten
  Widerstand, Bewegungsfähigkeit des Titels, intakter längerer Trend, und
  vorhandene Enge mit versiegendem Umsatz.
- **Eine Rückkehrbewegung im Abwärtstrend wird abgelehnt.** Die Form allein
  genügt nicht; ohne den längeren Trend darüber ist es ein fallendes Messer.
- **Die rückwirkende Auswertung urteilt vorsichtig.** Unter 25 ausgelösten
  Fällen sagt sie „nicht bewertbar" statt „neutral", und sie beurteilt die
  untere Schranke der Schätzung: 30 Treffer aus 30 Fällen sind keine 100 %.
- **Alle 47 Prüfsuiten laufen grün**, in zwei Zeitzonen, dazu der
  Service-Worker-Prüfstand und die Erreichbarkeitsprüfung.

## Drei Fehler, die ich offenlegen muss

**Die Liste war fertig gerechnet und vollständig unsichtbar.** Beide Container
fehlten im Markup, und es gab keine einzige Gestaltungsregel für sie. Der
Menüpunkt hätte beim Klick nichts getan. Das ist der vierte Fall derselben
Klasse: korrekt berechnet, aber nicht ablesbar.

**Der eigene Test war zuerst blind.** Die Prüfung auf fehlende Daten benutzte
einen leeren Wert, der schon vorher abgefangen wird — die eigentliche Falle ist
eine Null, die als gültige Zahl durchgeht. Aufgefallen ist das erst, als ich die
Schutzbedingung im Code absichtlich entfernt habe und der Test trotzdem grün
blieb. Fünf solche Sabotageproben laufen jetzt, alle fünf werden erkannt.

**Ein Farbregler war seit der letzten Version ohne Wirkung.** Die Prüfung
verlangte nur, dass der Name der Kachel irgendwo in der Gestaltungsdatei
vorkommt. Eine leere Platzhalterregel erfüllte das. Geprüft wird jetzt, ob die
Farbe tatsächlich von einer Regel gelesen wird — dabei fiel der Altfehler auf.

## Was noch offen ist

- **Die Liste ist noch nie gegen echte Kursdaten gelaufen.** Alle Nachweise
  stammen aus konstruierten Tagesbalken. Wie viele Kandidaten ein realer Abend
  liefert und ob die Zahl im gewünschten Bereich von fünf bis fünfzehn landet,
  ist unbekannt.
- **Die rückwirkende Auswertung hat noch kein Urteil**, weil sie noch nicht mit
  echten Daten gelaufen ist. Sie wird bis dahin „nicht bewertbar" anzeigen. Das
  ist der beabsichtigte Zustand, kein Fehler.
- **Ein Lauf kostet einen Datenabruf je Titel**, höchstens vierzig pro Durchgang,
  Ergebnis sechs Stunden zwischengespeichert. Ob das in deinem Tarif angenehm
  liegt, zeigt erst der erste echte Abend.
- **Die 90-Sekunden-Frischesperre** und **die Nachrichtenzeile** stehen
  unverändert offen; beide brauchen eine Entscheidung von dir.
