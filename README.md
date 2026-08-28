# FusionPulse v3.14.6

**Aktueller Stand:** v3.5.6 integriert die kumulative Pflicht-VL in die aktuelle v3.5.5-Arbeitsbasis, ohne Claude- oder Aladdin-Bewertungsmethodik zu verändern. Neu im FokusScope sind reale Positionsübernahme (Kaufkurs EUR/Tradegate + Stückzahl), sofortige SL/TP1/TP2-/Netto-CRV-/€-Berechnung, Teilverkauf/Restposition und persistente Verkaufsalarme. Die Aktien-Heatmap ist deutlich größer, besitzt direkt beschriftete Quadranten und behält Trails/Dynamik. Bereits vorhandene Refresh-/Freshness-/Methoden-/Learning-/Aladdin-Schichten bleiben erhalten und werden durch Safety-Regressionen geschützt. Vor Produktivfreigabe bleibt der UI-Smoke-Test nach Deployment verpflichtend.

- Zielprojektion: unabhängiges 36-Bar-Swingfenster statt kurzer 12-Bar-Triggerreferenz.
- Wirtschaftliches Gate: risikobudget-kalibriert statt Notional-/75-EUR-Falle.
- Alle Fail-Closed-Regeln bleiben bestehen.

## Schwerpunkt · FusionPulse Adaptiv + Opportunity Lifecycle

- **Claude Modus bleibt methodisch unverändert.** Seine Worker-Bewertungen, Konstanten und das Client-Overlay sind per SHA-256-Regression gegen die hochgeladene v3.5.1 verriegelt. Änderungen in v3.5.2 betreffen den normalen FusionPulse-Aktienmodus und die gemeinsame Discovery/Priorisierung.
- **FusionPulse Adaptiv trennt Struktur-CRV von Plan-Effizienz.** Das Markt-Strukturziel muss weiterhin das eingestellte Aktien-CRV erreichen (Default 3:1); der reale 50/50-Auszahlungsplan wird separat nach Kosten auf Effizienz geprüft, statt gegen ein mathematisch unpassendes 3:1-Gate.
- **Wirtschaftliche Relevanz ist positionsbezogen.** Im normalen Aktienmodus gilt mindestens der Nutzerwert, mindestens EUR 75 und mindestens 1,25 % der berechneten Positionsgröße. Bei EUR 10.000 Einsatz sind damit mindestens EUR 125 Netto-Potenzial erforderlich.
- **Strukturziele kommen aus dem Markt.** Reclaim/Pullback nutzt das vorherige reale Hoch; Breakout/Squeeze nutzt gemessene Range/Impulsprojektion. Reicht der Strukturraum nicht, bleibt das Setup blockiert – kein künstliches Ziel, nur um ein Gate zu erfüllen.
- **Aktien-Elliott/Fibonacci ist jetzt tatsächlich berechnet.** Bis v3.5.1 wurde `r.elliott` in der Recheck-Priorität gewichtet, obwohl `analyseStock()` bei Aktien kein solches Feld lieferte. v3.5.2 liefert eine explizite, fail-closed Strukturwertung.
- **Opportunity Lifecycle:** `PREP`, `IGNITION`, `CONFIRM`, `LATE`, `WATCH`. Frische Zustandswechsel und Triggernähe werden früher tief geprüft; bereits gelaufene, verlangsamende Runner werden abgewertet.
- **Large-Cap-Discovery, FokusScope-Priorität, Freshness-Ampeln und sichtbare Analysemethoden** bleiben erhalten.
- **Krypto-Normalmodus wurde in v3.5.2 bewusst nicht methodisch umgebaut.** Erst die Aktienlogik wurde mit eigenen Fixtures und Regressionen neu kalibriert.

## Historie

- **v3.5.1:** Deep-Scan-Regler 15–40 und Tiingo-Kontingent als klar gekennzeichnete App-Eigenschätzung.
- **v3.5.0:** Claude Modus als parallele, umschaltbare Bewertung; Details bleiben historisch in `RELEASE_NOTES.md` dokumentiert.
- **v3.4.3:** Situation Engine, Kategorie-Freshness, Stale-Recovery und sichtbare Analysemethoden.
- Frühere Stabilitäts-/Audit-Releases: siehe `RELEASE_NOTES.md` und `IMPROVEMENT_LIST.md`.

FusionPulse ist ein autonomer Momentum- und Opportunity-Waechter fuer Krypto und liquide US-Aktien. Ziel ist nicht moeglichst viele Signale, sondern wenige, wirtschaftlich relevante A-Setups: App starten, laufen lassen und nur dann aufmerksam werden, wenn Datenqualitaet, Handelbarkeit, CRV und realistisches absolutes Gewinnpotenzial zusammenpassen.

## Datenarchitektur v3.2.1

- **Krypto:** Bitpanda Fusion; serverseitiger Cron-Scan, PWA muss dafuer nicht geoeffnet sein.
- **Aktien Primary:** Tiingo Power / IEX 5-Minuten-Daten inklusive Volumen.
- **Overnight Discovery:** Tiingo BOATS. BOATS nominiert nur auffaellige Kandidaten und hat **0 % direkten BUY-Einfluss**.
- **Opening/Premarket Zusatzquelle:** Alpaca IEX bleibt vorerst als unabhaengige Opening-/Plausibilitaetsquelle erhalten.
- **Fallback/Referenz:** Twelve Data bleibt im Code vorhanden, ist in `primary` aber nicht der Hauptfeed.
- **Learning/Health:** Cloudflare D1; Aktien-Learning akzeptiert historische Samples aus Twelve Data und Tiingo IEX, ohne die Quellen unbemerkt zu vermischen.

## Aktueller Ablauf: Large-Cap Radar -> Lifecycle -> Deep Scan -> Opportunity -> BUY

1. **Whole-Market/Large-Cap Radar:** automatische Discovery ist inclusion-only auf den kuratierten Large-Cap-/hochliquiden US-Katalog begrenzt. Radar bewertet Beschleunigung, Aktivitaet, Spread, Range, Tagesstaerke und den Zustandswechsel zum vorherigen Snapshot; **0 % direktes BUY-Gewicht**.
2. **Opportunity Lifecycle:** `PREP` erkennt Druck nahe am Trigger, `IGNITION` den frischen Zustandswechsel, `CONFIRM` die Fortsetzung, `LATE` einen bereits gelaufenen/verlangsamenden Move und `WATCH` noch unreife Situationen.
3. **BOATS Discovery:** bleibt Overnight-/Extended-Hours-Fruehwarnung und hat ebenfalls 0 % direktes BUY-Gewicht.
4. **Adaptive Deep-Scan-Queue:** 15–40 Titel je Zyklus, konfigurierbar und serverseitig persistiert; priorisiert Fokus/Favoriten, Recheck, frische Lifecycle-Übergänge, Radar, BOATS und Exploration.
5. **Opportunity Watch / FokusScope:** frische Live-Daten, Handelbarkeit, Struktur-CRV, Plan-Effizienz, Kursweg, Elliott/Fibonacci-Kontext und wirtschaftlich relevantes Netto-Euro-Potenzial bleiben Pflicht. FokusScope hat höchste Datenpriorität.
6. **BUY:** Discovery allein kann niemals BUY erzeugen; die jeweilige Bewertungslogik des gewählten Modus muss zusätzlich vollständig grün sein.

## Zentrale Sicherheitsregeln

- Fehlende, stale oder qualitativ schlechtere Daten duerfen Score, BUY oder positiven Signalton niemals verbessern.
- WATCH bleibt akustisch stumm.
- **FusionPulse Adaptiv / Aktien:** BUY nur bei ausreichender Qualität/Handelbarkeit, aktivem Setup, realem Strukturraum und Struktur-CRV mindestens auf der eingestellten Aktiengrenze (Default 3:1); die 50/50-Plan-Effizienz ist eine eigene Kennzahl und kein Ersatz-CRV.
- **Claude Modus:** verwendet weiterhin seine eigene, unveränderte EV-/Struktur-Logik; v3.5.2 greift diese Methodik nicht an.
- Radar, BOATS, Crowd und Learning bleiben Discovery-/Zusatzlayer und erzeugen nicht alleine BUY.
- Elliott/Fibonacci ist im FusionPulse-Aktienmodus ein echter, aber nur anteiliger Strukturbaustein; fehlende Daten verbessern den Wert nicht.
- Ein bereits stark gelaufener Kurs ist keine Opportunity, wenn der attraktive Einstieg/Strukturraum bereits vorbei ist.

## Opportunity-Value

Im **normalen FusionPulse-Aktienmodus** wird wirtschaftliche Relevanz nicht mehr über die alte starre EUR-350-Hürde erzwungen. Das Mindest-Netto-Potenzial des berechneten Tradeplans ist:

`max(Nutzerwert, EUR 75, 1,25 % der tatsächlichen Positionsgröße)`

Beispiele: Bei EUR 5.000 Positionsgröße sind mindestens EUR 75, bei EUR 10.000 mindestens EUR 125 Netto-Potenzial erforderlich. Ein eigener Nutzerwert kann die Schwelle erhöhen. Ein gespeicherter Wert von exakt EUR 350 aus dem alten Default wird einmalig auf EUR 75 migriert; individuell geänderte Werte bleiben erhalten.

Zusätzlich muss das **Struktur-CRV** die konfigurierte Aktiengrenze erfüllen (Default 3:1) und der reale 50/50-Plan nach Kosten mindestens die separate **Plan-Effizienz 0,85:1** erreichen. Diese Kennzahlen werden nicht mehr mathematisch vermischt.

Der **Claude Modus** behält seine eigene EV-/Plan-Logik aus v3.5.0 unverändert; deren Schwellen werden in v3.5.2 nicht modifiziert.

## Tiingo Betrieb

`wrangler.jsonc` steht in v3.2.1 standardmaessig auf:

```json
"TIINGO_STOCKS_MODE": "primary"
```

Erforderliches Cloudflare Secret:

- `TIINGO_API_TOKEN`

Der Token bleibt ausschliesslich serverseitig. Der v3.1.8-Livetest hat Token, IEX, 5-Minuten-Historie, Volumen und BOATS erfolgreich bestaetigt.

## UI / VL Stand

- permanenter SIGNAL-INFO-Banner unten
- Aktien-Favoriten und Karten frei sortierbar, Reihenfolge persistent
- Klick auf Aktie in der Liste oeffnet das grosse Detailfenster
- Intraday-Chart in Aktien- und Coin-Details; Aktien 5/10/30/60/120/180/240/300 Minuten waehlen
- EUR-Kurs primär, originaler USD-Kurs direkt in Klammern
- schnelle Header-Tooltips fuer Risk-On/Off, Countdown und Statussymbole
- laienverstaendliche Tooltips fuer Zonenlage und Pullback
- Datenherkunft/Freshness sichtbar; Tiingo IEX Primary / Twelve Data Fallback dynamisch gekennzeichnet
- „Alle Aktien“ priorisiert autonom entdeckte/reife Kandidaten statt nur Favoriten

## Versionierung

`package.json` ist die einzige technische Versionsquelle. `npm run sync-version` synchronisiert Worker, Frontend, Service Worker, HTML, Wrangler und README-Kopf. Release Notes und Verbesserungsliste werden je Release inhaltlich gepflegt. Keine Suffix-Versionen wie `-2.0`.

## Checks vor Deploy

```bash
npm install
npm run sync-version
npm run check
```

`npm run check` umfasst JS-Syntax und die Safety-Regressionssuite.

## Deployment-Hinweis v3.5.2

Nach Deploy zuerst sichtbare Version 3.5.2, Claude-Schalter in beiden Richtungen, Large-Cap-Radar, Lifecycle-Labels, FokusScope-Freshness und Worker-Latenz prüfen. Im FusionPulse-Modus müssen Struktur-CRV und Plan-Effizienz getrennt erscheinen. Stale/fehlende Daten dürfen weiterhin nie Grün erzeugen. Twelve Data nicht löschen, bevor Tiingo mehrere Sessions stabil gelaufen ist.


## v3.3.0
Siehe RELEASE_NOTES.md. Elliott-first bleibt die zentrale Aktienanalyse; neue Crowd-, Extended-Hours- und Learning-Flächen sind ergänzende Discovery-/Transparenzebenen.

## v3.3.2
Stabilisierungsrelease nach dem Live-Test: dynamischeres Opening Momentum aus dem serverseitigen Whole-Market-Radar, persistente Signal-Herkunft, verständliche Funktionalitätsampel, verbesserte Aktien-Suche, Richtungsfarben und Google-Finance-Link. Trading-/Safety-Regeln bleiben unverändert. Siehe RELEASE_NOTES.md.



## v3.3.4 Stabilisierung

- Whole-Market Radar ist Discovery (0 % BUY-Gewicht), speist aber jetzt priorisiert die autonome Deep-Scan-Queue.
- Verifizierte, bereits tief analysierte Radar-Titel bleiben in „Alle analysierten Aktien“ sichtbar, solange sie im aktuellen Discovery-Pool bestätigt sind.
- Klicks auf Whole-Market Radar, Opening Momentum und Extended Hours öffnen auch noch nicht geladene Titel zuverlässig im großen Aktienfenster; dafür wird gezielt die bestehende Einzelaktien-Analyse geladen.
- BUY-Gates, Elliott-first und Netto-CRV > 3:1 bleiben unverändert.

## v3.3.3 Stabilisierung
Radar-Pipeline zwischen Opening/Whole-Market und Deep Scan geschlossen, Favoriten zyklisch aktualisiert, Health-Freshness persistent gemacht und Google-Finance-Deep-Link auf den ausgewählten Ticker präzisiert. Safety-/BUY-Regeln unverändert.


## v3.3.5 P0 Connection Watchdog
Harte Frontend-Timeouts und automatischer Reconnect verhindern einen dauerhaft hängenden „Verbinde…“-Zustand. Trading- und Safety-Regeln bleiben unverändert.

### v3.3.7 P0 Feed-Isolation
Der Browser ist nicht mehr an einen einzelnen langsamen Bitpanda/Fusion-Request gekoppelt. Upstream-Aufrufe werden Worker-seitig nach 5,5 s beendet. Während eines Fehlers bleibt der letzte gute Datensatz sichtbar und wird ausdrücklich als veraltet/Reconnect markiert. Safety bleibt fail-closed: veraltete Daten erzeugen keine frische BUY-Freigabe.