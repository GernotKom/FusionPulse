# FusionPulse v3.25.0 — Der Ausfall vom 29.08.: Ursache, Behebung, Prüfstand

**Die Konsole hat es beantwortet. Es war mein Fehler, aus v3.19.0.**

---

## Was passiert ist

Safari meldete drei Zeilen:

```
Service Worker context closed
Cannot load .
Failed to load resource: Service Worker context closed
```

Zwei Fehler, beide von mir, beide im Cache-first-Zweig, den ich in v3.19.0
eingebaut habe.

### 1. Der tödliche: kein `.catch()`

```js
// v3.19.0 – so war es
e.respondWith(
  caches.match(e.request).then((hit) => hit || fetch(e.request).then(...))
);   // ← keine Fehlerbehandlung
```

Lehnt `caches.match()` ab — in Safari genügt Speicherdruck oder eine
ITP-Räumung —, dann lehnt auch `respondWith()` ab. Für den Browser heißt das
nicht „nimm halt das Netz", sondern **„diese Datei existiert nicht"**.
`app.js` kam nie an.

Der Network-first-Zweig hatte seit jeher einen `.catch()` und lief weiter. Also
wurde `index.html` ausgeliefert, das Grundgerüst erschien — und genau das ließ
den Totalausfall wie „keine Daten" aussehen.

### 2. Der stille: kein `waitUntil()`

Die Cache-Schreibvorgänge im Hintergrund lagen nicht in `e.waitUntil()`. Sobald
`respondWith` fertig war, durfte der Browser den Service Worker beenden —
mitten im Schreiben. Daher „Service Worker context closed".

---

## Nachgestellt, nicht vermutet

Ich habe den Service Worker in einer nachgebauten Umgebung ausgeführt und
gestört. Alte gegen neue Fassung, dieselbe Anfrage:

| Störung | v3.24.0 | v3.25.0 |
|---|---|---|
| Normalbetrieb | NETZ | NETZ |
| **Cache-API wirft** | **ABGELEHNT (QuotaExceededError)** | NETZ |
| Offline, Cache leer | **ABGELEHNT (Load failed)** | sichtbarer 504 |
| Offline, Cache-Treffer | CACHE | CACHE |
| Hintergrund-Schreibvorgang gehalten | nein | **ja** |

Zeile 2 ist der Ausfall vom 29.08., reproduziert.

---

## Die Regel, die daraus folgt

> **Ein `respondWith` darf niemals ablehnen.**
> Ein Service Worker sitzt zwischen der App und allem, was sie braucht. Jeder
> unbehandelte Fehler darin nimmt nicht eine Datei aus dem Verkehr, sondern die
> ganze Anwendung.

Jeder Zweig endet jetzt in einer Antwort: Netz, Cache oder eine erkennbare
504-Meldung mit Text. Nie in einem stillen Nichts.

---

## Neu: `tests/sw-fault.mjs` — ein ausführender Prüfstand

**43 grüne Suiten haben den Fehler nicht gefunden.** Der Grund ist lehrreich:
sie prüfen `sw.js` nur als **Text** — Regex auf Regeln, die vorhanden sein
sollen. Ein *fehlendes* `.catch()` sieht man so nicht. Man sieht nur, was da
ist, nie was fehlt.

Der neue Prüfstand **führt den Service Worker aus**, unter jeder Kombination aus
kaputtem Cache, fehlendem Netz und scheiterndem Schreibvorgang, für Assets und
für die Shell. Er verlangt, dass **immer** eine Antwort herauskommt.

Fünf Negativkontrollen, alle greifen — darunter der Originalfehler, der jetzt
reproduzierbar gefangen wird.

`npm run check` führt ihn mit aus. **45 Prüfungen grün.**

---

## Zusätzlich: Selbstheilung

Falls doch einmal ein Service Worker hängt: Nach 12 Sekunden **ohne verarbeitete
Antwort** meldet die App ihn selbst ab, löscht die Caches und lädt neu.

Zwei Details, die wichtiger sind als sie klingen:

- **Auslöser ist eine verarbeitete Antwort** (`__fpScanOk`), nicht das bloße
  Starten von `app.js`. Ein kaputter Service Worker kann alles nach dem Start
  blockieren.
- **Sperrfrist von 6 Stunden.** Eine Neulade-Schleife wäre schlimmer als der
  Fehler, den sie beheben soll.

Die Einstellungen bleiben unberührt. Gelöscht wird nur, was sich neu holen lässt.

Dazu weiterhin der Boot-Wächter und `?fpreset=1` aus v3.24.0.

---

## Was du tun musst

**v3.25.0 deployen.** Der neue Service Worker wird vom Netz geholt und ersetzt
den kaputten; `skipWaiting` und `clients.claim` sorgen dafür, dass er sofort
übernimmt.

Sollte die Seite sich weigern: einmal
`https://fusionpulse.kommetter-599.workers.dev/?fpreset=1` aufrufen (aus
v3.24.0), oder in Safari *Entwickler → Leeren der Caches*.

---

## Was ich falsch gemacht habe

Ich habe in v3.19.0 eine Optimierung eingebaut, gemessen dass sie wirkt, und
Tests geschrieben, die prüfen **dass die Regel da ist** — aber nicht, **was
passiert, wenn sie scheitert**. Bei einem Service Worker ist das der
entscheidende Fall, weil er im Fehlerfall die ganze Anwendung mitnimmt und nicht
nur sich selbst.

Der Prüfstand ist die Konsequenz. Er hätte den Fehler am Tag seiner Entstehung
gefangen.
