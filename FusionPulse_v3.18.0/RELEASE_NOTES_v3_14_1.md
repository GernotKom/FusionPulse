# FusionPulse v3.14.1 · Konsistenzprüfung der Auslieferung

Ein Hotfix auf die Meldung *„die Version hängt"* — und zwar an der Stelle, die uns beide
zwei Runden gekostet hat.

27 Testsuiten grün in zwei Zeitzonen, vier SHA-Blöcke identisch, Negativkontrolle für
alle sechs Änderungen.

---

## Das eigentliche Problem

In deinem Screenshot sagte der **Tab-Titel 3.11.0** und die **Kopfzeile v3.12.0**. Das
ist kein Schönheitsfehler.

Der Titel kommt aus `index.html`, die Kopfzeile aus `version.js`. Wenn die
auseinanderlaufen, läuft **neuer Code auf alter Shell**: aktualisiertes `app.js` und
`style.css` gegen ein altes `index.html`. Dem neuen Code fehlen dann Elemente, die er
erwartet — und die Folgefehler sehen aus wie Layout- oder Scrollprobleme, sind aber
keine.

Genau das ist passiert. Ich habe in v3.12.0 und v3.14.0 zweimal an Layout-Regeln
gearbeitet, während die Ursache möglicherweise ganz woanders lag. Das war die falsche
Baustelle, und ich hätte die Versionsmischung ernster nehmen müssen, als ich sie das
erste Mal gesehen habe.

---

## Was jetzt passiert

**Die App prüft sich beim Start selbst.** `<meta name="fp-shell-version">` steckt in
`index.html`, `FP_VERSION` in `version.js`. Beide setzt `sync-version.mjs` aus der
`package.json` — es gibt also weiterhin genau eine Wahrheit.

Weichen sie ab:

1. **Einmal selbst heilen.** Ein automatischer Neuladeversuch über `hardReload()`, der
   auch die Caches und den Service Worker leert.
2. **Danach die Wahrheit sagen.** Bleibt der Fehlstand bestehen, liegt es an der
   Auslieferung und nicht am Browser. Dann wird **keine weitere Schleife gedreht**,
   sondern eine dauerhafte Warnung gezeigt:

> Die Auslieferung ist inkonsistent: index.html meldet 3.11.0, der Code 3.12.0. Ein
> Neuladen hat das nicht behoben — die alte Datei kommt vom Server. Bis das behoben ist,
> können Anzeige- und Scrollfehler auftreten, die **nicht** an den Einstellungen liegen.

Der letzte Satz ist der wichtigste. Genau diese Fehlzuordnung hat uns die zwei Runden
gekostet.

**Keine Reload-Schleife.** Ein Fehlstand, der sich nicht beheben lässt, darf die App
nicht unbenutzbar machen. Der Versuch läuft genau einmal pro Sitzung; ein Test dreht das
zurück und prüft, dass der zweite Durchlauf warnt statt neu zu laden.

**Die drei Stempel werden im Test verglichen.** Tab-Titel, Shell-Stempel und `FP_VERSION`
müssen alle zur `package.json` passen. Ein Auseinanderlaufen fällt jetzt schon vor dem
Deploy auf, nicht erst in deinem Browser.

---

## Was du jetzt tun solltest

Bevor wir weiter an Scroll- oder Layoutfragen arbeiten, muss der Stand sauber sein:

1. **Deployen.** Prüf danach, ob in Cloudflare wirklich `3.14.1` ausgeliefert wird.
2. **In Safari hart neu laden:** `Cmd+Shift+R`. Falls der Titel danach immer noch eine
   andere Version zeigt als die Kopfzeile, meldet sich die App jetzt von selbst.
3. Falls die Warnung erscheint: Dann liegt es an der Auslieferung — Cloudflare liefert
   ein altes `index.html` aus dem Edge-Cache. Dann sag Bescheid, das ist eine
   Deploy-Frage und keine Code-Frage.

Erst danach ist eine Aussage über das Scrollproblem belastbar. Die Fußleisten-Messung aus
v3.14.0 ist enthalten und sollte es beheben — aber gegen eine halb aktualisierte Shell
kann ich das nicht garantieren, und ich will dir nichts versprechen, was ich nicht prüfen
kann.

---

## Nachweise

- 27 Suiten grün, `TZ=Europe/Vienna` und `TZ=America/Chicago`
- Vier Claude-SHA-Blöcke unabhängig nachgerechnet: identisch
- **Funktionsnachweis, ausgeführt statt gelesen:** gleiche Versionen → in Ordnung ·
  fehlender Stempel → keine Falschwarnung · Fehlstand → einmal neu laden ·
  zweiter Durchlauf → warnen statt erneut laden
- **Negativkontrolle**, jede Änderung einzeln zurückgedreht — alle sechs fallen:

| zurückgedreht | Test |
|---|---|
| Shell-Stempel auf alte Version | fällt |
| Stempel nicht mehr in sync-version | fällt |
| Konsistenzprüfung entfernt | fällt |
| Schleifenschutz entfernt | fällt |
| Hinweis auf die Ursache entfernt | fällt |
| Meta-Tag entfernt | fällt |
