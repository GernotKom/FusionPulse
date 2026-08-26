# FusionPulse – Übergabe für neuen Chat · v3.6.4 (Claude/Opus-Strang)

> Diese Datei ist der vollständige Kontext. ZUERST vollständig lesen, dann den Code
> auditieren, DANN erst bauen. Sie ersetzt HANDOVER_NEW_CHAT_v3.6.1.md.

## Arbeitsbasis
- Aktuelles Archiv: `FusionPulse_v3.6.4.zip` (dieses Paket)
- Vorgänger-Doku bleibt gültig: `IMPROVEMENT_LIST.md`, `VL_STATUS_v3.5.6.md`, `RELEASE_NOTES.md`
- Versionsquelle ist `package.json` → `scripts/sync-version.mjs` schreibt src/version.js, public/version.js, index.html, wrangler.jsonc
- Tests: `node tests/safety-regression.mjs` (muss komplett grün sein, **jetzt 13 Suiten**)
- NEU: `tests/client-harness.mjs` führt `public/app.js` in einer VM mit gestubbten
  Browser-APIs wirklich aus. Damit sind Client-Tests funktional statt nur Regex.
  Top-Level-`const`/`let` landen nicht auf dem Kontext — der Harness hängt die zu
  prüfenden Bindungen über einen Epilog als Accessoren an (`globalThis.__fp`).

## WER MACHT WAS (wichtig für Rollenverständnis)
Es gibt ZWEI parallele Bewertungssysteme in derselben App:
- **Claude-Modus** (EV-basiert): von diesem Opus-Strang gebaut. SHA-256-verriegelt.
- **FusionPulse Adaptiv** (ChatGPT-Strang): eigenständige Bewertung, läuft wenn Claude-Schalter aus ist.
Beide teilen sich Situation Engine, Sizing, Discovery. Der Nutzer arbeitet mit BEIDEN Chats
(hier Opus, separat ChatGPT). Änderungen des einen dürfen den anderen nicht beschädigen.

## NICHT VERHANDELBAR (Sicherheits-Invarianten)
1. Fehlende/stale/schlechtere Daten dürfen Score, BUY oder positiven Signalton NIEMALS verbessern (fail-closed).
2. Claude-Modus methodisch nicht verändern. Die vier SHA-256-Blöcke MÜSSEN identisch bleiben:
   - coin  : 1a6acdf20ff3de5eb6642c7d4a5e99c979deb3112570aa6918f642db92917bb5
   - stock : 52f69351e1ff3367ed8e14b5adabf6aeb106c6ac5826ab2ed7c615a863baca4c
   - client: de85b209bbed1636b683c509b3256fd701ce5c15261c507d5f4682622e579cb2
   - overlay: 9e6b5efc81bd1c3237ed7ca5b9e5564ea49abb1441bacd37f3be7d7849c1e73e
   (In v3.5.8 unabhängig nachgerechnet, alle vier identisch.)
3. Aladdin-Layer (Modul 1) + Attribution (Modul 0) sind ADDITIVE Schichten. Sie verändern KEINEN Score,
   nur Anzeige bzw. BUY-Freigabe. Das muss so bleiben.
4. Technische Stops/Ziele niemals verschieben, nur damit CRV/EV „passt".
5. Ehrlichkeitsprinzip: dünne Datenbasis (20–40 Titel Stichprobe, kein Vollmarkt) wird überall
   als solche gekennzeichnet, inkl. Konfidenz. Lieber ehrlich unsicher als selbstsicher falsch.
6. Kein Feature wird still gestrichen. Offene Punkte bleiben sichtbar bis erledigt oder verschoben.
7. **NEU (v3.5.8):** Kopfzeile und Kleingedrucktes dürfen einander nie widersprechen. Wenn die
   wirtschaftliche Bewertung „uninteressant" sagt, darf keine Ampel oben „Kauf" rufen.
   `stockHeadline()` ist dafür die EINZIGE Quelle der Kopf-Anzeige — nicht `r.light`/`r.verdict` direkt.
8. **NEU (v3.6.0):** Jeder Fachbegriff, den die App anzeigt, hat eine Erklärung in `GLOSS`
   (`public/app.js`) — an EINER Stelle, nicht dupliziert. Neue Kennzahlen, Schalter oder Spalten
   ohne Glossareintrag gelten als unfertig. Regel je Eintrag: was ist es, wozu dient es hier,
   was bedeutet es ausdrücklich NICHT. Ein Tooltip, der den Fachbegriff nur wiederholt, ist keiner.
9. **NEU (v3.5.9):** Was nicht bewertbar ist, wird ausgewiesen und NICHT geschätzt. Eine Position ohne
   bekannten technischen Stop fällt aus der Risikosumme heraus und wird explizit als fehlend genannt.
   Jede neue Sperre (Mute, Budget) darf ausschließlich abwerten und muss standardmäßig AUS sein,
   solange sie das Verhalten des ChatGPT-Strangs verändern könnte.

## WAS DIESER OPUS-STRANG BISHER GEBAUT HAT (chronologisch)
- **Claude-Modus** (v3.5.0): EV-basierte Parallelbewertung, weil die Legacy-Gates mathematisch
  unerreichbar waren (Plan-CRV ≥3:1 bei max. 2,525R brutto; 350€-Schwelle über eigenem Risikobudget).
- **Deep-Scan-Regler + Tiingo-Kontingent** (v3.5.1): serverseitig in D1, ehrliche App-Eigenzählung.
- **A/B-Fixes** (3.5.3, ChatGPT umgesetzt, von uns auditiert): Zielfenster von 12-Bar-Trigger
  entkoppelt (36-Bar-Swing); wirtschaftliche Schwelle risikobudget-kalibriert statt heimlich ~6R.
- **Modul 0 · Attribution & Overfitting-Guard** (v3.5.4): Wilson-Untergrenze, OOS-Split,
  Mehrfachtest-Korrektur, MIN_SAMPLE=20. Nur Empfehlung, keine Auto-Abschaltung.
- **Modul 1 · Aladdin Market Intelligence** (v3.5.5): hierarchische Marktmeinung + Kombinationsschicht.
- **v3.5.6** (ChatGPT): reale Position im FokusScope, Heatmap größer, Verkaufsalarm. Auditiert.
- **Paket A · Modul 0 wird scharf** (v3.5.7): Stummschalten statt Löschen, Rehabilitation mit
  Hysterese (OOS≥52 %/Wilson≥45 %, min 15 OOS-Episoden, min 5 Tage). Route `/api/attribution/mute`.
- **v3.5.8 · P0 (SOFI-Widerspruch) + P2 (Modul-0-Schalter).**
- **v3.5.9 · Modul 2: Portfolio-Risiko & Klumpung.**
- **v3.6.0 · Glossar / Laien-Erklärungen.**
- **v3.6.1 · Krypto-Konsistenz, ehrliche Heatmap, Crowd-Diagnose, sichtbares Glossar.**
- **v3.6.2 · Hotfix Heatmap-Beschriftung** (3.6.1-Labels waren zu lang und liefen ineinander).
- **v3.6.3 · Kennzahlen im Fokusfenster erklärt** (Reife, Score, alle 9 Situationstypen, Entry/Stop/TP).
- **v3.6.4 · Datenstand, Zeitzonen, Aktien-Planknopf, Heatmap-Spuren (DIESES Paket, siehe unten).**

### v3.6.4 — GEBAUT
- **`dataSession(r)`**: ordnet den Kurs-Zeitstempel einer US-Sitzung zu und sagt im Klartext,
  wie alt der Kurs ist — getrennt von der Abfragezeit. Das war die Ursache der Verwirrung
  „Abfrage 12:28, aber Daten von gestern". Ohne Zeitstempel wird nichts behauptet.
- **`withLocalTime()` / `etClockToLocal()`**: ET-Angaben werden überall um unsere Ortszeit
  ergänzt, DST-sicher über die echte Zonendifferenz (USA und EU stellen an verschiedenen
  Terminen um — der Abstand ist zeitweise 5 statt 6 Stunden).
- **`stockOrderPlan(r)`** + Knopf `#stockFocusPlan`: das fehlende Gegenstück zu `orderPlan()`
  bei Krypto. Nennt ausdrücklich, wenn KEINE Freigabe vorliegt.
- **Heatmap-Spuren mit Richtung**: `dir-sweet` (rechts oben, grün + Pfeilspitze), `dir-side`,
  `dir-back`, `dir-flat`. Fokussierter Titel hervorgehoben. Im Mouseover steht ausdrücklich,
  dass das eine Bewegungs- und keine Ertragsaussage ist.
- **Legende `.maplegend2`** erklärt voller vs. hohler Punkt — die gestrichelten Ringe aus 3.6.1
  waren nirgends erklärt.
- MERKE: Ein erster Testentwurf leitete den Erwartungswert aus der geprüften Funktion selbst ab.
  Die Negativkontrolle fiel deshalb NICHT. Gegenrechnungen müssen einen unabhängigen Pfad nehmen.

## WAS IN v3.5.8 PASSIERT IST

### P0 — SOFI-Widerspruch: ERLEDIGT
Ursache gefunden und am Code belegt: Die Kopfzeile las stur `r.light` + `r.verdict`
(= reine Musterqualität). Die wirtschaftliche Prüfung lief getrennt in `stockOpportunity()`
und hatte auf die Kopf-Ampel null Einfluss. Deshalb „🟢 Kauf-Setup" über „UNINTERESSANT · 54 €".

Fix (reine Anzeigelogik, `public/app.js`):
- `stockOpportunity()` liefert additiv `blockKind`: `economic | data | phase | executability | quality`.
  Reihenfolge bewusst wirtschaftlich-zuerst. Keine neue Schwelle, keine Duplikation.
- Neu `stockHeadline(r)` → `{light, icon, text, title, kind}`. Fasst Musterqualität,
  BUY-Freigabe (`stockLevel`), Mute-Status und Wirtschaftlichkeit zu EINER Aussage zusammen.
- `HEADLINE_RANK` + Klemme: die Kopfzeile darf gegenüber `r.light` nur ABWERTEN, nie aufwerten.
  Das ist strukturell erzwungen, nicht nur konventionell.
- Umgestellt: Fokus-Karte (`sf-verdict`), Aktienzeile (`sr-verdict`), Peek-Karte (`pk-verdict`),
  jeweils inkl. Farbe. Kartenklasse der Fokus-Karte folgt jetzt `hl.light` statt `top.light`.
- Gestummtes Setup zeigt im Kopf „🔇 Setup stummgeschaltet · kein BUY".
- NICHT verändert: Score, Schwellen, Entry/Stop/TP, Gates, SHA-Blöcke.

### v3.6.0 · Glossar & Laien-Erklärungen: GEBAUT
- `GLOSS` + Helfer `gloss(key)`, `gl(label,key,extra)`, `glossForSetup(key)` in `public/app.js`.
- Verdrahtet in: Modul-0-Tabelle (Spaltenköpfe, Setup-Namen, Toggle-Tooltip mit Setup-Bedeutung),
  Modul-2-Kachel (jede Kennzahl, jede Warnung), `stockHeadline` (alle fünf Blockierungsgründe
  neu formuliert), Ticker-Kürzel, alle neun Analysemethoden in den Einstellungen.
- `<abbr class="gl">` mit gepunkteter Unterstreichung markiert, WO eine Erklärung hinterlegt ist.
- Vorspann über der Komponentenliste grenzt Analysemethoden von Setup-Typen ab (Verwirrung aus 3.5.7).
- Tests prüfen Auflösung statt Existenz: Mindestlängen, aufgelöste Fachbegriffe, adressierte
  Fehldeutungen, und dass die alten Rohbegriffe nicht zurückkehren.
- OFFEN: Krypto-Seite und Aladdin-Kachel haben noch keine Glossar-Anbindung.

### v3.5.9 · Modul 2 — Portfolio-Risiko & Klumpung: GEBAUT
- `portfolioExposure()` summiert das Risiko bis zum technischen Stop über alle aktiven Positionen
  (`stockPositions`), gruppiert risikogewichtet nach Sektor, und meldet Klumpung ab 50 % Anteil
  bei ≥2 Positionen.
- Neues Setting `portfolioRiskPct` (Default 2,25 % = drei parallele Trades), nie kleiner als `riskPct`.
- **Nebenbefund, wichtig:** `equity × riskPct` ist REINES Kursrisiko. Am Stop kommen die
  Ausführungskosten beider Seiten dazu — aus 37,50 € werden real ~63 € (Faktor 1,69 im Test).
  Die Restkapazität rechnet deshalb gegen `perTradeReal`; der Kostenfaktor wird aus den EIGENEN
  offenen Positionen abgeleitet, nicht aus einer Konstante, und im UI offen angezeigt.
- `portfolioGuard` (Default AUS): eingeschaltet unterdrückt sie neue BUY-Freigaben bei
  erschöpftem Budget. Wirkt in `stockLevel` und kann nur abwerten. Bereits offene Positionen
  ausgenommen — die Sperre verhindert Zukauf, nie einen Ausstieg.
- Kopfzeile: `kind:'portfolio'` → „🟡 Setup ok · Risikobudget ausgeschöpft".
- Grenze steht im UI: Sektor-Näherung, kein Korrelationskoeffizient.

### P2 — Modul-0-UI: ERLEDIGT
- Schieberegler pro Setup-Zeile (`data-toggleset`), rechts/grün = aktiv, links/grau = gestummt.
  Jetzt für JEDE Zeile, nicht nur bei Abschalt-Empfehlung.
- 🔔 Wiedereinschalt-Empfehlung mit eigenem Direktbutton „▶ reaktivieren".
- Klarstellung im UI (`.attr-scope-note`): Mute betrifft SETUP-TYPEN, nicht die
  Analyse-Komponenten-Checkboxen. Zwei getrennte Ebenen — bleibt so, ist jetzt erklärt.

## OFFENE PUNKTE — VORRANG FÜR DEN NEUEN CHAT (in dieser Reihenfolge)

### P1a — Paket B Rest: Scope-Frequenz + echte Korrelation (JETZT DRAN)
Modul 2 (Klumpung + Gesamt-Risikobudget) ist in v3.5.9 gebaut. Offen bleibt aus Paket B:
- **Scope-Frequenz-Regler:** Favoriten/Depot engmaschiger scannen als Discovery. Kostet mehr
  Tiingo-Requests (Kontingent-Anzeige zeigt den Effekt). Optional/einstellbar, weil höhere
  Frequenz auch Overtrading fördert. Braucht Worker-Änderung (Deep-Scan-Auswahl in D1).
- **ECHTE Korrelation** (Preisreihen-Korrelationskoeffizient über die vorhandenen Intraday-Serien)
  statt der Sektor-Näherung. Erst bauen, wenn die Näherung sich als zu grob erweist — sie ist
  im UI ausdrücklich als Näherung gekennzeichnet, also keine stille Schuld.
- **Klumpung auch über geplante Ideen**, nicht nur offene Positionen: „drei deiner vier
  BUY-Kandidaten sind Halbleiter". Daten liegen vor (stockRows + stockLevel), nur nicht verdrahtet.

### P3 — Sentiment/Fear&Greed (vorbesprochen, noch nicht gebaut)
BLOCKER ZU PRÜFEN: Cloudflare-Worker hat ausgehende Domain-Whitelist. alternative.me (Krypto,
gratis, key-frei) und ein Aktien-F&G-Dienst müssten erst in der Worker-Egress-Whitelist erlaubt
werden — das kann nur der Nutzer im Cloudflare-Dashboard. OHNE Freischaltung blockt Cloudflare.
Erst klären, ob das geht, dann bauen. Aktuelles „Risk-On/Off" in der Aladdin-Kachel ist NUR
Stichproben-Breadth (~20 Titel), KEIN echtes Sentiment. Das ehrlich halten.

### v3.6.1 — GEBAUT
- **P2b erledigt:** `coinHeadline(r)` mit derselben Fail-closed-Klemme wie `stockHeadline`.
  Kartenpunkte färben über die Kopfbewertung statt über `r.light`. Gründe: `economic`, `zone`, `quality`.
- **Heatmap-Widerspruch behoben (dritter Fund desselben Musters):** Beide Achsen messen Technik,
  die Labels behaupteten mit „STARK · ATTRAKTIV" aber Wirtschaftlichkeit. Neu: „MUSTER STARK ·
  GUT HANDELBAR". Punktfarbe aus `stockHeatmapMark()`, wirtschaftlich schwache Punkte hohl.
  Die alte 3.5.6-Assertion wurde bewusst ersetzt, mit Begründung im Testcode + Rückkehr-Guard.
- **Crowd-Tacho diagnostiziert:** war nie defekt — `crowdPulse()` steigt ohne `SERPAPI_KEY` aus.
  Sichtbare Statuszeile `#crowdStatus` statt stummer Nadel, inkl. Kostenwahrheit (SerpAPI gratis
  ~100 Abfragen/Monat, wir fragen bis 15 Symbole je Lauf → reicht nicht).
  ZWEITER FUND: Worker setzt `accel:null` hart, Client prüft `accel>=8` → toter Zweig.
  Beschleunigung jetzt clientseitig aus `fp.crowdHistory.v1`.
- **Glossar sichtbar:** durchsuchbares Panel in den Einstellungen, `GLOSS_GROUPS` + `GLOSS_LABEL`.
  Test erzwingt, dass jeder `GLOSS`-Eintrag dort auftaucht — kein verstecktes Wissen mehr.
- **Scope-Frequenz:** `refreshRate(symbol)` aus `fp.refreshRate.v1`, Vergleich gegen den Median.
  Unter 3 Messpunkten: „wird noch gemessen", nichts hochgerechnet.
- LAUFZEITFEHLER GEFUNDEN: `r1()` ist eine Worker-Funktion und existiert im Client nicht.
  Merke: Worker-Helfer nie in `app.js` verwenden — der Harness fängt das, Regex-Tests nicht.

### P5 — Crowd/Sentiment weiterbauen (OFFEN, braucht Nutzer-Entscheidung)
- Ohne `SERPAPI_KEY` bleibt der Tacho leer. Erst klären, ob ein bezahlter Tarif gewollt ist.
- Alternative prüfen: eigene Reddit-/Stocktwits-Abfrage ohne SerpAPI (braucht Egress-Freigabe).

### P6 — Ereigniskontext: Geopolitik / US-Regierung (OFFEN, BLOCKIERT)
Vorbesprochen. Machbar über `whitehouse.gov` (RSS, frei) und `federalregister.gov`
(offene JSON-API mit Branchen-Metadaten). BLOCKER: Cloudflare-Egress-Whitelist — nur der Nutzer
kann freischalten (`www.whitehouse.gov`, `www.federalregister.gov`, für P3 zusätzlich `alternative.me`).
WICHTIG — Designentscheidung, nicht verhandelbar: Daraus wird KEIN Score-Signal. Der Weg von
„Executive Order" zu „dieser Trade ist besser" ist nicht kausal berechenbar, sondern eine Erzählung.
Gebaut wird ein reiner KONTEXT-/EREIGNISFILTER: (a) Terminwarnung vor Einstieg — kann nur abwerten,
nie freigeben; (b) nachträgliche Markierung von Ereignistagen im Modul-0-Learning, damit ein
Scheitern im Ausnahmezustand nicht in dieselbe Statistik fällt wie eines im ruhigen Markt.

### P2b — Krypto-Seite (ERLEDIGT in v3.6.1, Rest offen)
Belegt, aber noch nicht gefixt: In `renderCoin` steht `el.className = 'focus ' + r.light` und in der
Coin-Zeile `<b class="dotc ${r.light}">`. Beide hängen allein an der Musterqualität, während
`buyReady(r)`/`coinLevel(r)` die tatsächliche Freigabe prüfen. Das ist strukturell exakt der
SOFI-Fall, nur auf der Krypto-Seite — und dort gibt es noch kein Gegenstück zu `stockHeadline`.
ERLEDIGT: `coinHeadline(r)` gebaut, Kartenpunkte konsistent. NOCH OFFEN am selben Muster:
Signalton-Stufen (`coinLevel`-Übergänge) und die Krypto-Fokuskarte (`el.className = 'focus '+r.light`)
sind noch nicht auf `coinHeadline` umgestellt. Auch das Glossar ist auf der Krypto-Seite und in der
Aladdin-Kachel noch nicht verdrahtet.

## TECHNISCHE FAKTEN
- Cron: `wrangler.jsonc` triggers crons `* * * * *` (jede Minute), im Worker gedrosselt.
  → market_snapshots werden serverseitig geschrieben, auch bei ausgeschaltetem PC. Modul 0 SAMMELT
    permanent, BEWERTET aber nur beim Abruf (/api/attribution), ändert nie automatisch.
- D1-Binding: env.DB. fp_meta ist key/value-Tabelle (stock_deep_limit, tiingo_quota, muted_setups).
- market_snapshots hat max_pct/min_pct/success_ts/resolved_ts + payload(JSON mit 'setup').
- APP_TOKEN schützt alle /api/-Routen. Client schickt ?t=<token>.
- Service Worker (public/sw.js) cacht aggressiv → nach Deploy ggf. Cmd+Shift+R oder SW deregistrieren.
  APP_VERSION in sw.js zieht `sync-version` mit (jetzt 3.5.8).

## AUDIT-CHECKLISTE FÜR DEN NEUEN CHAT (bevor gebaut wird)
1. `node tests/safety-regression.mjs` → alle **13** Suiten grün?
2. SHA-256 der vier Claude-Blöcke gegen die Werte oben prüfen (unabhängig, nicht nur Testlauf glauben).
3. Diff gegen dieses 3.6.4 machen, falls der Nutzer eine spätere Version schickt.
4. Eigene synthetische Fixtures bauen, NICHT die aus der Testdatei nachnutzen.
5. Bei jedem Fund: erst am echten Code verifizieren, dann urteilen.
6. **NEU:** Bei Client-Änderungen den Harness nutzen (`tests/client-harness.mjs`) und eine
   Negativkontrolle fahren: Fix künstlich zurückdrehen — fällt der Test dann wirklich?
   Ein Test, der den Fehler nicht sehen kann, ist kein Funktionsnachweis.

## ARBEITSSTIL (was der Nutzer schätzt)
- Ehrliche, direkte Einschätzung ohne Schönfärberei. Auch eigene Fehler offen benennen.
- Bei Funden: Zahlen/Beweise, nicht nur Behauptungen.
- Kein Feature als „fertig" bezeichnen ohne Funktionsnachweis (synthetische Fixtures + Tests).
- Der Nutzer ist Arzt, technisch versiert, denkt kritisch mit und findet echte Widersprüche (siehe SOFI).
- Deutsch. Prägnant. Bei Gedankenexperimenten mutig mitdenken, aber bei Fakten/Geld/Sicherheit klar bleiben.
- Keine unnützen Rückfragen am Ende einer Antwort.
