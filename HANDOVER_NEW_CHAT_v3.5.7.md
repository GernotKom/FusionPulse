# FusionPulse – Übergabe für neuen Chat · v3.5.7 (Claude/Opus-Strang)

> Dieser Chat wurde bewusst gewechselt, weil der vorige lang wurde. Diese Datei
> ist der vollständige Kontext. Bitte ZUERST vollständig lesen, dann den Code
> auditieren, DANN erst bauen.

## Arbeitsbasis
- Aktuelles Archiv: `FusionPulse_v3.5.7.zip` (dieses Paket)
- Vorgänger-Doku bleibt gültig: `IMPROVEMENT_LIST.md`, `VL_STATUS_v3.5.6.md`, `RELEASE_NOTES.md`
- Versionsquelle ist `package.json` → `scripts/sync-version.mjs` schreibt src/version.js, public/version.js, index.html, wrangler.jsonc
- Tests: `node tests/safety-regression.mjs` (muss komplett grün sein, 7 Suiten)

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
   (Prüfmethode siehe tests/safety-regression.mjs, Abschnitt SHA-Lock.)
3. Aladdin-Layer (Modul 1) + Attribution (Modul 0) sind ADDITIVE Schichten. Sie verändern KEINEN Score,
   nur Anzeige bzw. BUY-Freigabe. Das muss so bleiben.
4. Technische Stops/Ziele niemals verschieben, nur damit CRV/EV „passt".
5. Ehrlichkeitsprinzip: dünne Datenbasis (20–40 Titel Stichprobe, kein Vollmarkt) wird überall
   als solche gekennzeichnet, inkl. Konfidenz. Lieber ehrlich unsicher als selbstsicher falsch.
6. Kein Feature wird still gestrichen. Offene Punkte bleiben sichtbar bis erledigt oder verschoben.

## WAS DIESER OPUS-STRANG BISHER GEBAUT HAT (chronologisch)
- **Claude-Modus** (v3.5.0): EV-basierte Parallelbewertung, weil die Legacy-Gates mathematisch
  unerreichbar waren (Plan-CRV ≥3:1 bei max. 2,525R brutto; 350€-Schwelle über eigenem Risikobudget).
- **Deep-Scan-Regler + Tiingo-Kontingent** (v3.5.1): „Aktien tief scannen (15–40)", serverseitig in D1.
  Kontingent ist ehrliche App-Eigenzählung (Tiingo liefert keine Header/Endpoint).
- **A/B-Fixes** (in 3.5.3 von ChatGPT umgesetzt, von uns auditiert): Zielfenster von 12-Bar-Trigger
  entkoppelt (36-Bar-Swing); wirtschaftliche Schwelle risikobudget-kalibriert statt heimlich ~6R.
- **Modul 0 · Attribution & Overfitting-Guard** (v3.5.4): ehrliche Out-of-Sample-Bilanz je Setup.
  Wilson-Untergrenze, OOS-Split, Mehrfachtest-Korrektur, MIN_SAMPLE=20. Nur Empfehlung, keine Auto-Abschaltung.
- **Modul 1 · Aladdin Market Intelligence** (v3.5.5): hierarchische Marktmeinung (Regime/Sektor/Stress/
  Szenario) + Kombinationsschicht (Setup × Marktpassung). Kachel oben im Aktien-Tab. Route /api/aladdin.
- **v3.5.6** (ChatGPT): reale Position im FokusScope (Kaufkurs+Stückzahl), Heatmap größer, Verkaufsalarm.
  Von uns auditiert, Claude-Lock intakt.
- **Paket A · Modul 0 wird scharf** (v3.5.7, DIESES Paket): Stummschalten statt Löschen.
  Gestummte Setups erzeugen kein BUY, laufen aber im Hintergrund weiter (Cron jede Minute).
  Rehabilitation mit HYSTERESE (höhere Reaktivierungs-Schwelle: OOS≥52%/Wilson≥45%, min 15 OOS-Episoden,
  min 5 Tage Stummdauer). Routen: /api/attribution/mute. Stummliste in D1 (fp_meta 'muted_setups').
  Mute wirkt in BEIDEN Modi (Claude + FusionPulse) über stockLevel.

## OFFENE PUNKTE — VORRANG FÜR DEN NEUEN CHAT (in dieser Reihenfolge)

### P0 — SOFI-WIDERSPRUCH (zuerst untersuchen, VOR Paket B!)
Der Nutzer hat einen echten inneren Widerspruch entdeckt (Screenshots vom 26.8., v3.5.6):
Kopfzeile zeigte „🟢 Kauf-Setup · Claude" (SOFI, Score 8,3, PULLBACK HOLD 74/100),
ABER darunter: Plan-CRV 1,1:1 „zu niedrig", Weg TP2 nur 1,6%, Gesamtplan netto nur 54€,
und die Opportunity-Zeile sagte klar „UNINTERESSANT · CLAUDE · nur 54€ – für Aufwand/Risiko zu klein".
→ Widersprüchliche Kommunikation: Kopf schreit „Kauf", Kleingedrucktes sagt „lohnt nicht".
→ Das ist gefährlich: verführt zu schlechtem Trade.
AUFGABE: Im Code prüfen, ob die grüne Kopf-Ampel („Kauf-Setup") die wirtschaftliche
Opportunity-Bewertung (CRV/Netto-Potenzial) berücksichtigt. Vermutlich bezieht sich der grüne Punkt
nur auf `light===green` (Musterqualität), während die Opportunity-Prüfung separat läuft.
FIX-RICHTUNG: Die Kopfzeile darf nicht „Kauf-Setup" sagen, wenn die Opportunity-Bewertung „uninteressant"
ist. Entweder Kopf an Opportunity koppeln, oder klar trennen in „technisches Setup OK, aber wirtschaftlich
uninteressant". NICHT die technischen Marken verschieben, um CRV zu retten (Invariante 4).
Betrifft wahrscheinlich Client-Render der Fokus-Karte (stockFocus) + evtl. worker claude/fusion verdict-Text.
WICHTIG: Claude-Score-Block ist gelockt — der Fix ist Anzeige-/Kommunikationslogik, NICHT der Score.

### P1 — Paket B: Portfolio-/Korrelationssicht + Scope-Frequenz
War der ursprüngliche Plan. Fundament existiert schon: v3.5.6 hat Positionsdaten pro Aktie
(POSITION_STORE_KEY='fp.stockPositions.v1', stockPositions, positionPanel im Client).
BAUEN:
- Klumpungs-/Korrelationswarnung über Favoriten+aktive Positionen (einfache Variante: gleicher Sektor =
  geklumpt; „⚠ X% deiner Long-Ideen hängen am selben Faktor"). Braucht KEINE Beträge, nur Sektor-Zuordnung.
- Gesamt-Risikobudget über alle aktiven Positionen (Summe Risiko/Trade; „danach 90% Budget ausgeschöpft").
  Braucht die Positionsbeträge, die es schon gibt.
- Scope-Frequenz-Regler: Favoriten/Depot engmaschiger scannen als Discovery. Kostet mehr Tiingo-Requests
  (Kontingent-Anzeige zeigt Effekt). Optional/einstellbar, weil höhere Frequenz auch Overtrading fördert.
- ECHTE Korrelation (Preisreihen-Korrelationskoeffizient) nur wenn Sektor-Näherung zu grob — mehr Tiingo-Last.

### P2 — UI-Verbesserungen Modul 0 (vom Nutzer explizit gewünscht)
- Der „reaktivieren"/„stummschalten" Text-Link ist NICHT klar genug. Nutzer wünscht **Switch/Schieberegler
  (Toggle)** pro Setup-Zeile: rechts=aktiv, links=gestummt. Zeigt Zustand UND Aktion in einem Element.
- Wiedereinschalt-Empfehlung (🔔) soll AUCH dort einen direkten Button/Toggle haben, nicht nur in der Tabelle.
- Klarstellung im UI: Mute betrifft SETUP-TYPEN (Pullback, Reclaim…), NICHT die Analyse-Komponenten-Checkboxen
  in den Einstellungen (VWAP/EMA/…). Der Nutzer war (berechtigt) verwirrt, dass Mute die Settings nicht ändert.
  Das ist KORREKT so (zwei getrennte Ebenen), aber muss klarer kommuniziert werden.

### P3 — Sentiment/Fear&Greed (vorbesprochen, noch nicht gebaut)
Idee: echten Fear&Greed-Index reinholen, um die „fade" Aladdin-Kachel aussagekräftiger zu machen
(echte Extreme Panik<20/Gier>65 sind handelbarer als bloße Stichproben-Breadth).
BLOCKER ZU PRÜFEN: Cloudflare-Worker hat ausgehende Domain-Whitelist. alternative.me (Krypto, gratis,
key-frei) und ein Aktien-F&G-Dienst (z.B. feargreedchart.com, gratis JSON) müssten erst in der Worker-
Egress-Whitelist erlaubt werden — das kann nur der Nutzer im Cloudflare-Dashboard. OHNE Freischaltung
blockt Cloudflare den Abruf. Erst klären, ob das geht, dann bauen.
Aktuelles „Risk-On/Off" in der Aladdin-Kachel ist NUR Stichproben-Breadth (Anteil positiver 1h-Returns +
VWAP-Breite + Volumen aus ~20 Titeln), KEIN echtes Sentiment. Das dem Nutzer gegenüber ehrlich halten.

## TECHNISCHE FAKTEN
- Cron: `wrangler.jsonc` triggers crons `* * * * *` (jede Minute), im Worker gedrosselt.
  → market_snapshots werden serverseitig geschrieben, auch bei ausgeschaltetem PC. Modul 0 SAMMELT permanent,
    BEWERTET aber nur beim Abruf (/api/attribution), ändert nie automatisch. Das ist bewusst so (Anti-Overfitting).
- D1-Binding: env.DB. fp_meta ist key/value-Tabelle (stock_deep_limit, tiingo_quota, muted_setups).
- market_snapshots hat max_pct/min_pct/success_ts/resolved_ts + payload(JSON mit 'setup'). Basis für Modul 0.
- APP_TOKEN schützt alle /api/-Routen. Client schickt ?t=<token>. Bei manuellem URL-Test: Token anhängen.
- Service Worker (public/sw.js) cacht aggressiv → nach Deploy ggf. Cmd+Shift+R oder SW deregistrieren.
  (War in v3.5.6 auf 3.5.6 hochgezogen; bei neuer Version APP_VERSION in sw.js mitziehen — sync-version macht das.)

## AUDIT-CHECKLISTE FÜR DEN NEUEN CHAT (bevor gebaut wird)
1. `node tests/safety-regression.mjs` → alle 7 Suiten grün?
2. SHA-256 der vier Claude-Blöcke gegen die Werte oben prüfen (unabhängig, nicht nur Testlauf glauben).
3. Diff gegen dieses 3.5.7 machen, falls der Nutzer eine spätere Version schickt.
4. Eigene synthetische Fixtures bauen, NICHT die aus der Testdatei nachnutzen (deckt Fehler besser auf).
5. Bei jedem Fund: erst am echten Code verifizieren, dann urteilen.

## ARBEITSSTIL (was der Nutzer schätzt)
- Ehrliche, direkte Einschätzung ohne Schönfärberei. Auch eigene Fehler offen benennen.
- Bei Funden: Zahlen/Beweise, nicht nur Behauptungen.
- Kein Feature als „fertig" bezeichnen ohne Funktionsnachweis (synthetische Fixtures + Tests).
- Der Nutzer ist Arzt, technisch versiert, denkt kritisch mit und findet echte Widersprüche (siehe SOFI).
- Deutsch. Prägnant. Bei Gedankenexperimenten mutig mitdenken, aber bei Fakten/Geld/Sicherheit klar bleiben.
