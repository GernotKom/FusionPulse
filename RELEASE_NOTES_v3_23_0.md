# FusionPulse v3.23.0 — Kryptoschiene mit eigener Kostenrechnung

Additiv. Score, Ampel, Gate, Sizing und Freigabe unverändert, SHA-Blöcke unberührt.

---

## Warum keine Kopie der Aktienrechnung

Die Wahrscheinlichkeitsrechnung ist für beide Märkte dieselbe. Die
**Kostenfunktion** nicht — und der Unterschied ist strukturell, nicht numerisch:

| | Aktien (flatex US-Direkthandel) | Krypto (Bitpanda Fusion) |
|---|---|---|
| Gebühr | **fix** 11,50 € je Order | **proportional** ~0,15 % je Seite |
| Spread | in der Reibung enthalten | eigener, oft größerer Block |
| Kostenanteil | **fällt** mit der Positionsgröße | **konstant** |

Bei 10.000 € liegen beide Rundlaufkosten fast gleichauf — 0,38 % gegen 0,40 %.
**Genau diese Scheingleichheit ist die Falle.** Bei 2.500 € Einsatz sind es
0,86 % gegen weiterhin 0,40 %:

| Einsatz | Aktien: nötig für 120 € | Krypto (0,1 % Spread) |
|---|---|---|
| 2.500 € | 7,69 % | 7,02 % |
| 5.000 € | 3,92 % | 3,71 % |
| 10.000 € | 2,04 % | 2,06 % |
| 20.000 € | 1,09 % | 1,23 % |

**Praktische Folge:** kleine Aktienpositionen sind unwirtschaftlich, kleine
Kryptopositionen nicht. Bei Krypto kannst du die Positionsgröße frei wählen,
ohne dafür bestraft zu werden — bei Aktien nicht.

---

## Was gebaut wurde

**`/api/toppicks?asset=coin`** — dieselbe Auswertung, anderes Kostenmodell.
Bewusst **kein zweiter Code-Pfad**: nur `baseCost` und die Quellenliste
unterscheiden sich. Ein Duplikat wäre die nächste Stelle, an der zwei Wahrheiten
auseinanderlaufen. Ein Test verbietet ein zweites `topPicksCoin`.

**Eigene Kachel `#topPicksCoin` im Kryptobereich**, über denselben Renderer.
Auch hier kein zweiter Renderer, und ein Test besteht darauf.

**Der Spread wird jetzt aufgezeichnet** (`snapshotPayload`). Dritte Wiederholung
derselben Lehre nach Situationstyp (v3.17.0) und Dollarumsatz (v3.18.0): *was
man nicht aufzeichnet, kann man nie kalibrieren.* Bis genug Werte da sind,
rechnet die App mit einer Annahme und **sagt das auch** — bei Krypto ist der
Spread die halbe Kostenrechnung, eine Annahme als Messung auszugeben wäre hier
besonders teuer.

**`persistCoinLive`** — Zwischenspeicher für lebende Coin-Kandidaten. Der
Aktienradar hatte so etwas, Coins nicht; ohne ihn wäre die Kachel bei jedem
Seitenaufruf leer, an dem gerade kein Scan läuft.

**24/7-Deckel.** Der Markt läuft durchgehend, der Mensch nicht. Gerechnet wird
mit ~16 wachen Stunden, also **5 statt 3** Trades je Tag. Bewusst niedrig: ein
zu hoher Deckel ließe häufige schwache Setups gewinnen, die sich gar nicht alle
halten lassen.

---

## Ein Fail-closed-Verstoß, den der Test gefunden hat

Mein erster Entwurf prüfte fehlende Kostenangaben mit `Number.isFinite`.
`Number(null)` und `Number('')` sind aber **0, nicht NaN** — eine fehlende
Spread-Angabe wäre damit als **kostenlos** durchgegangen. Der teuerste denkbare
Fehler an dieser Stelle.

Jetzt gilt: nur ein **positiver** Zahlenwert zählt als Angabe. Fehlt sie, wird
mit bewusst pessimistischen Rückfallwerten gerechnet (0,30 % Spread, 0,25 %
Gebühr) — teurer als die Standardannahme, nicht günstiger. Fehlende Information
darf das Ergebnis nie verbessern.

Der Test prüft das jetzt gegen `undefined`, `null`, `NaN`, `'abc'`, `''`, `0`
und `-1`.

---

## Prüfung

Suite 42, `✓ FusionPulse v3.23.0 coin-lane/cost-model regressions`.
**Sechs Negativkontrollen**, alle greifen:

1. Krypto rechnet mit dem Aktienmodell → fällt
2. fehlender Spread wird kostenlos → fällt
3. Quellen vermischt → fällt
4. 24/7 wird ignoriert (Deckel gleich) → fällt
5. Spread nicht mehr aufgezeichnet → fällt
6. Kryptokachel im Aktienbereich → fällt

Ende-zu-Ende, echter Worker-Kern durch echtes `app.js` in echtem DOM:

```
STOCK (fixed)        Rundlauf 0,38 %  Mindestziel 2,04 %  Deckel 3/Tag
  BREAKOUT PRESSURE  handelbar                 2,84/−1,40   158 €   474 €/Tag
  OPENING DRIVE      zu verrauscht            2,04/−1,02  −140 €  −140 €/Tag
  → SOFI (Score 36) vor MRNA (Score 88)

COIN (proportional)  Rundlauf 0,40 %  Mindestziel 2,06 %  Deckel 5/Tag
  SQUEEZE RELEASE    handelbar                 3,06/−0,70    86 €   344 €/Tag
  PULLBACK HOLD      bewegt sich nicht weit    2,06/−1,03   −49 €   −98 €/Tag
  → SOL-EUR (Score 44) vor DOGE-EUR (Score 91)
```

42 Suiten grün, Erreichbarkeits-Audit ohne Fund.

---

## Was jetzt funktioniert

- **Krypto hat eine eigene, hergeleitete Kostenrechnung** statt einer Kopie.
- **Die Kachel sagt dir, was die Positionsgröße bedeutet.** Bei Aktien steht im
  Tooltip, dass kleine Positionen unwirtschaftlich sind; bei Krypto, dass du
  frei skalieren kannst.
- **Der Spread wird gemessen statt geraten** — ab jetzt, nicht rückwirkend.
- **Beide Märkte sind optisch und rechnerisch getrennt**, laufen aber durch
  dieselbe Auswertung.

## Was noch offen ist

- **Der Spread füllt sich erst.** Bis rund 20 Aufzeichnungen je Auswertung
  vorliegen, steht die Annahme da — mit Hinweis. Prüfe sie in der
  Spread-Anzeige im Coin-Detail.
- **Bitpanda Fusion staffelt die Taker-Gebühr nach Volumen.** Der Worker liest
  sie beim Scan live aus `/account`, die Top-Picks-Auswertung nimmt derzeit
  0,15 % an. Die Verbindung beider Stellen ist ein kleiner, sauberer nächster
  Schritt.
- **Krypto kennt keine Sektoren.** Die Sektor-Nachzügler-Logik bleibt
  aktienspezifisch. Ein Krypto-Äquivalent (BTC-Dominanz, L1/L2/Meme-Kohorten)
  wäre denkbar, braucht aber eine eigene Herleitung.
- **Keine Steuerbesonderheit für Krypto abgebildet.** Gerechnet wird mit 27,5 %
  wie bei Aktien. Für in Österreich gehaltenes Neuvermögen ist das der
  Sondersteuersatz; Staking, Lending und Tauschgeschäfte können anders
  behandelt werden. Das ist eine Frage an deinen Steuerberater, keine, die eine
  App entscheiden sollte.
- Alle offenen Punkte aus v3.18.0 und der Live-`situationScore`.
