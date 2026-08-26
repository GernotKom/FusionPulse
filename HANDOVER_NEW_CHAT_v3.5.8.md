# FusionPulse – Übergabe für neuen Chat · v3.5.8 (Claude/Opus-Strang)

> Diese Datei ist der vollständige Kontext. ZUERST vollständig lesen, dann den Code
> auditieren, DANN erst bauen. Sie ersetzt HANDOVER_NEW_CHAT_v3.5.7.md.

## Arbeitsbasis
- Aktuelles Archiv: `FusionPulse_v3.5.8.zip` (dieses Paket)
- Vorgänger-Doku bleibt gültig: `IMPROVEMENT_LIST.md`, `VL_STATUS_v3.5.6.md`, `RELEASE_NOTES.md`
- Versionsquelle ist `package.json` → `scripts/sync-version.mjs` schreibt src/version.js, public/version.js, index.html, wrangler.jsonc
- Tests: `node tests/safety-regression.mjs` (muss komplett grün sein, **jetzt 8 Suiten**)
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
- **v3.5.8 · P0 + P2 (DIESES Paket, siehe unten).**

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

### P2 — Modul-0-UI: ERLEDIGT
- Schieberegler pro Setup-Zeile (`data-toggleset`), rechts/grün = aktiv, links/grau = gestummt.
  Jetzt für JEDE Zeile, nicht nur bei Abschalt-Empfehlung.
- 🔔 Wiedereinschalt-Empfehlung mit eigenem Direktbutton „▶ reaktivieren".
- Klarstellung im UI (`.attr-scope-note`): Mute betrifft SETUP-TYPEN, nicht die
  Analyse-Komponenten-Checkboxen. Zwei getrennte Ebenen — bleibt so, ist jetzt erklärt.

## OFFENE PUNKTE — VORRANG FÜR DEN NEUEN CHAT (in dieser Reihenfolge)

### P1 — Paket B: Portfolio-/Korrelationssicht + Scope-Frequenz (JETZT DRAN)
Fundament existiert: v3.5.6 hat Positionsdaten pro Aktie
(`POSITION_STORE_KEY='fp.stockPositions.v1'`, `stockPositions`, `positionPanel` im Client).
BAUEN:
- Klumpungs-/Korrelationswarnung über Favoriten + aktive Positionen (einfache Variante: gleicher
  Sektor = geklumpt; „⚠ X % deiner Long-Ideen hängen am selben Faktor"). Braucht nur Sektor-Zuordnung.
- Gesamt-Risikobudget über alle aktiven Positionen (Summe Risiko/Trade; „danach 90 % Budget
  ausgeschöpft"). Braucht die Positionsbeträge, die es schon gibt.
- Scope-Frequenz-Regler: Favoriten/Depot engmaschiger scannen als Discovery. Kostet mehr
  Tiingo-Requests (Kontingent-Anzeige zeigt Effekt). Optional, weil höhere Frequenz Overtrading fördert.
- ECHTE Korrelation (Preisreihen-Korrelationskoeffizient) nur wenn Sektor-Näherung zu grob.

### P3 — Sentiment/Fear&Greed (vorbesprochen, noch nicht gebaut)
BLOCKER ZU PRÜFEN: Cloudflare-Worker hat ausgehende Domain-Whitelist. alternative.me (Krypto,
gratis, key-frei) und ein Aktien-F&G-Dienst müssten erst in der Worker-Egress-Whitelist erlaubt
werden — das kann nur der Nutzer im Cloudflare-Dashboard. OHNE Freischaltung blockt Cloudflare.
Erst klären, ob das geht, dann bauen. Aktuelles „Risk-On/Off" in der Aladdin-Kachel ist NUR
Stichproben-Breadth (~20 Titel), KEIN echtes Sentiment. Das ehrlich halten.

### P4 — Konsistenz-Audit über die restliche UI (neu, aus P0 abgeleitet)
Der SOFI-Fall war vermutlich kein Einzelfall des Musters „Ampel bewertet A, Text bewertet B".
Zu prüfen: Heatmap-Punkte (`stockLevel(r)===3 ? 'buy-ready'` — konsistent, aber Farbe folgt
`r.light`), Signalton-Stufen, Verkaufsalarm, Krypto-Seite (`coinLevel`/`buyReady` haben dieselbe
Trennung wie vor dem Fix bei Aktien!). **Konkreter Verdacht: die Krypto-Karten haben denselben
Widerspruch und noch kein Gegenstück zu `stockHeadline`.** Das wäre der nächste ehrliche Fund.

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
1. `node tests/safety-regression.mjs` → alle **8** Suiten grün?
2. SHA-256 der vier Claude-Blöcke gegen die Werte oben prüfen (unabhängig, nicht nur Testlauf glauben).
3. Diff gegen dieses 3.5.8 machen, falls der Nutzer eine spätere Version schickt.
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
