# FusionPulse v3.24.0 — Boot-Wächter und drei Parameterfehler

Anlass: Am 29.08. stand die Oberfläche still. Statusampeln grau, Version „v–",
Taktuhr „--:--", alle Kacheln leer.

---

## Was der Screenshot verraten hat

Alle Anzeigen standen auf ihren **statischen Startwerten aus `index.html`** —
`v–`, `--:--`, `Verbinde…`. Das heißt: `app.js` lief überhaupt nicht. Nicht
„keine Daten", sondern „kein JavaScript".

**Die Ursache lässt sich daraus nicht bestimmen**, und das ist der eigentliche
Mangel. Der ausgelieferte Code bootet in der Simulation sauber, ist syntaktisch
fehlerfrei und alle Dateien sind im Paket. Das Problem liegt also außerhalb des
Codes — in der Auslieferung, im Service-Worker-Cache oder in einem Browserfehler,
den nur die Konsole zeigt.

**Eine App, die lautlos stirbt, sieht aus wie eine App, die nur wartet.** Genau
das hat die Diagnose unmöglich gemacht. Das ist hiermit behoben.

---

## 1. Boot-Wächter

Ein **inline** in `index.html` liegendes Skript — bewusst nicht extern, denn
eine externe Datei könnte am selben Problem scheitern. Meldet sich `app.js`
nicht innerhalb von 8 Sekunden, erscheint ein Warnkasten mit einer echten
Diagnose:

```
Oberfläche nach 8 s nicht gestartet.
FP_VERSION: FEHLT — /version.js wurde nicht ausgeführt
app.js: HTTP 200 · text/html; charset=utf-8
   ⚠ HTML statt JavaScript — die Datei fehlt auf dem Server.
version.js: HTTP 200 · text/html; charset=utf-8
   ⚠ HTML statt JavaScript — die Datei fehlt auf dem Server.
API /api/health: HTTP 200 · application/json
Service Worker: 2 registriert
```

Der Fall in diesem Beispiel ist der häufigste stille Totalausfall überhaupt: der
Server liefert für eine fehlende Datei die `index.html` aus. Der Browser bekommt
HTML statt JavaScript, führt nichts aus — und meldet auch nichts.

Zusätzlich fängt ein `error`-Listener den Fall ab, dass die Datei zwar lädt,
aber beim Ausführen abbricht.

`app.js` setzt `self.__fpBooted = true` als **allerletzte Anweisung**. Bricht
irgendetwas davor ab, bleibt die Warnung stehen. Ein Test besteht darauf, dass
diese Zeile wirklich die letzte ist.

## 2. Notausstieg `?fpreset=1`

Meldet den Service Worker ab, löscht alle Caches, lädt neu. Steht **ganz oben**
in `app.js` — wenn ein kaputter Cache-Eintrag die App lahmlegt, darf die Rettung
nicht hinter dem Code stehen, der gerade nicht läuft.

Die Einstellungen im `localStorage` bleiben unberührt; gelöscht wird nur, was
sich jederzeit neu holen lässt. Ein Test verbietet ein `localStorage.clear()`
an dieser Stelle.

Ein Knopf im Warnkasten führt direkt dorthin.

---

## 3. Drei echte Fehler, beim Suchen gefunden

Alle drei dieselbe Ursache: **`Number(null)` und `Number('')` sind 0, nicht
NaN.** Eine Prüfung mit `Number.isFinite(Number(x))` hält einen nicht gesetzten
Suchparameter deshalb für eine gültige Null.

| Parameter | Folge |
|---|---|
| `spreadPct`, `feePct` | Krypto rechnete mit **0,80 % statt 0,40 %** Rundlauf |
| `netEur` | Mindestziel fiel von **2,04 % auf 0,38 %**, zulässiger Stop von 1,02 % auf 0,19 % |

Der zweite ist der schwerwiegendere: das Mindestziel kollabierte auf die reine
Kostenschwelle. Alles darunter — Trefferquote, Erwartungswert, Rangfolge — war
damit falsch, sobald der Endpunkt ohne `netEur` aufgerufen wurde.

Ich hatte denselben Fallstrick in v3.23.0 eine Ebene tiefer bereits behoben
(`pickCosts`) und ihn hier übersehen. Jetzt läuft jede Zahl von außen über
**einen** Helfer `posNum`, und ein Test verbietet `Number.isFinite(Number(opts.x))`
in `topPicks`.

### Warum 42 grüne Suiten das nicht gefunden haben

Sie prüfen `requiredMovePct` und `pickCosts` **direkt und mit sauberen Zahlen**.
Die **Naht** zwischen Parameterschicht und Rechnung war nie geprüft — genau dort
saß der Fehler.

Suite 43 ruft deshalb den **echten Endpunkt** auf: ohne Parameter, mit leeren,
mit kaputten (`''`, `0`, `abc`, `-5`). Sechs Negativkontrollen, alle greifen —
darunter beide Originalfehler, die die Suite jetzt reproduzierbar fangen.

43 Suiten grün, Erreichbarkeits-Audit ohne Fund.

---

## Was du jetzt tun kannst

**Zuerst:** `https://fusionpulse.kommetter-599.workers.dev/?fpreset=1` aufrufen.
Das setzt Cache und Service Worker zurück. Wenn es danach läuft, war es ein
Cache-Zustand.

**Wenn nicht:** v3.24.0 deployen. Der Warnkasten sagt dir dann in Klartext,
woran es liegt — HTTP-Status und Inhaltstyp jeder Datei.

**Falls du vorher schon wissen willst, was los ist:** In Safari
*Entwickler → JavaScript-Konsole* öffnen und neu laden. Ein einzelner roter
Fehler in der ersten Zeile beantwortet die Frage sofort. Im Reiter *Netzwerk*
zeigt die Zeile `app.js` Status und Typ — steht dort `text/html` statt
`text/javascript`, fehlt die Datei auf dem Server.

## Was noch offen ist

- **Ich weiß weiterhin nicht, warum es ausgefallen ist.** Diese Version macht es
  sichtbar, sie behebt es nicht. Wenn der Warnkasten erscheint, schick mir seinen
  Inhalt — damit ist es in einem Zug lösbar.
- Der Verdacht, dass die Cache-first-Regel aus v3.19.0 beteiligt ist, ließ sich
  weder belegen noch ausräumen. Sie ist an die Version des Service Workers
  gebunden und kann deshalb strukturell nichts Veraltetes ausliefern — aber ein
  unvollständig installierter Service Worker ist eine andere Sache. `?fpreset=1`
  räumt genau diesen Fall ab.
- Alle offenen Punkte aus v3.18.0 und der Live-`situationScore`.
