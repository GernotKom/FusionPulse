# FusionPulse v3.2.5

FusionPulse ist ein autonomer Momentum- und Opportunity-Waechter fuer Krypto und liquide US-Aktien. Ziel ist nicht moeglichst viele Signale, sondern wenige, wirtschaftlich relevante A-Setups: App starten, laufen lassen und nur dann aufmerksam werden, wenn Datenqualitaet, Handelbarkeit, CRV und realistisches absolutes Gewinnpotenzial zusammenpassen.

## Datenarchitektur v3.2.1

- **Krypto:** Bitpanda Fusion; serverseitiger Cron-Scan, PWA muss dafuer nicht geoeffnet sein.
- **Aktien Primary:** Tiingo Power / IEX 5-Minuten-Daten inklusive Volumen.
- **Overnight Discovery:** Tiingo BOATS. BOATS nominiert nur auffaellige Kandidaten und hat **0 % direkten BUY-Einfluss**.
- **Opening/Premarket Zusatzquelle:** Alpaca IEX bleibt vorerst als unabhaengige Opening-/Plausibilitaetsquelle erhalten.
- **Fallback/Referenz:** Twelve Data bleibt im Code vorhanden, ist in `primary` aber nicht der Hauptfeed.
- **Learning/Health:** Cloudflare D1; Aktien-Learning akzeptiert historische Samples aus Twelve Data und Tiingo IEX, ohne die Quellen unbemerkt zu vermischen.

## v3.2.1: Whole-Market Radar -> Deep Scan -> Opportunity -> BUY

1. **Whole-Market Radar:** ein Tiingo-`/iex`-Bulk-Snapshot beobachtet serverseitig jede Minute den verfuegbaren IEX-Markt. Discovery basiert auf frischer Beschleunigung, Aktivitaet, Spread, Range und Tagesstaerke; 0 % BUY-Gewicht.
2. **BOATS Discovery:** bleibt Overnight-/Extended-Hours-Fruehwarnung und hat ebenfalls 0 % BUY-Gewicht.
3. **Adaptive Deep-Scan-Queue:** maximal 20 Titel je 2-Minuten-Zyklus aus Favoriten, Recheck fast reifer Setups, Radar-Kandidaten, BOATS und Exploration.
4. **Opportunity Watch:** Live-Daten, Qualitaet, Netto-CRV, Kursweg und wirtschaftlich relevantes Netto-Euro-Potenzial bleiben Pflicht.
5. **BUY:** alle bestehenden harten Gates bleiben unveraendert; Discovery kann niemals BUY erzeugen.

## Zentrale Sicherheitsregeln

- Fehlende, stale oder qualitativ schlechtere Daten duerfen Score, BUY oder positiven Signalton niemals verbessern.
- WATCH bleibt akustisch stumm.
- BUY nur bei ausreichender Qualitaet, Handelbarkeit und Netto-CRV > 3:1.
- BOATS, Crowd, Learning und Elliott/Fibonacci sind Zusatz-/Discovery-Layer; sie duerfen ein schlechtes Setup nicht hochstufen.
- Ein bereits stark gelaufener Kurs ist keine Opportunity, wenn der attraktive Einstieg/CRV bereits vorbei ist.

## Opportunity-Value

FusionPulse beruecksichtigt neben CRV auch das realistische absolute Netto-Potenzial bei der Referenzposition. Kleine, formal korrekte Trades sollen nicht unnoetig Aufmerksamkeit binden. Aktuell gilt im Aktien-Opportunity-Waechter:

- unter ca. EUR 200 Netto-Potenzial: **UNINTERESSANT**
- ab ca. EUR 350 bei vollstaendigen Gates: **OPPORTUNITY**
- ab ca. EUR 500 bei vollstaendigen Gates: **HIGH OPPORTUNITY**

Diese Schwellen sind Selektions-/Rankinghilfen, keine Erfolgswahrscheinlichkeiten und ersetzen keine BUY-Gates.

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

## Deployment-Hinweis v3.2.1

v3.2.1 erweitert Tiingo Primary um den autonomen Whole-Market-Radar. Nach Deploy zuerst Radar-Universum, RADAR-Kandidaten, Deep-Scan-Queue, Freshness und Worker-Latenz beobachten. Twelve Data nicht loeschen, bevor Tiingo mehrere Sessions stabil gelaufen ist.
