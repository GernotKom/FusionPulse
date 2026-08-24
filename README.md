# FusionPulse v3.2.0

FusionPulse ist ein autonomer Momentum- und Opportunity-Waechter fuer Krypto und liquide US-Aktien. Ziel ist nicht moeglichst viele Signale, sondern wenige, wirtschaftlich relevante A-Setups: App starten, laufen lassen und nur dann aufmerksam werden, wenn Datenqualitaet, Handelbarkeit, CRV und realistisches absolutes Gewinnpotenzial zusammenpassen.

## Datenarchitektur v3.2.0

- **Krypto:** Bitpanda Fusion; serverseitiger Cron-Scan, PWA muss dafuer nicht geoeffnet sein.
- **Aktien Primary:** Tiingo Power / IEX 5-Minuten-Daten inklusive Volumen.
- **Overnight Discovery:** Tiingo BOATS. BOATS nominiert nur auffaellige Kandidaten und hat **0 % direkten BUY-Einfluss**.
- **Opening/Premarket Zusatzquelle:** Alpaca IEX bleibt vorerst als unabhaengige Opening-/Plausibilitaetsquelle erhalten.
- **Fallback/Referenz:** Twelve Data bleibt im Code vorhanden, ist in `primary` aber nicht der Hauptfeed.
- **Learning/Health:** Cloudflare D1; Aktien-Learning akzeptiert historische Samples aus Twelve Data und Tiingo IEX, ohne die Quellen unbemerkt zu vermischen.

## v3.2.0: Discovery -> Deep Scan -> Opportunity -> BUY

1. **BOATS Discovery:** breiter Overnight-Snapshot wird nach ungewoehnlicher Bewegung, Aktivitaet und Spread vorgefiltert.
2. **Deep Scan:** Favoriten + beste BOATS-Kandidaten + rotierende Basistitel gehen in die aufwendige Tiingo-IEX-5-Minuten-Analyse. Maximal 20 Kandidaten pro 2-Minuten-Zyklus.
3. **Opportunity Watch:** eine Aktie wird nur als Opportunity hervorgehoben, wenn Live-Daten, Qualitaet, Netto-CRV, verbleibender Kursweg und ein wirtschaftlich relevantes Netto-Euro-Potenzial passen.
4. **BUY:** bleibt hinter den bestehenden harten FusionPulse-Gates. Discovery oder Crowd koennen niemals allein BUY erzeugen.

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

`wrangler.jsonc` steht in v3.2.0 standardmaessig auf:

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
- Intraday-Chart in Aktien- und Coin-Details
- EUR-Kurs primär, originaler USD-Kurs direkt in Klammern
- schnelle Header-Tooltips fuer Risk-On/Off, Countdown und Statussymbole
- laienverstaendliche Tooltips fuer Zonenlage und Pullback
- Datenherkunft/Freshness sichtbar; gecachte/stale Daten werden nicht als Live dargestellt

## Versionierung

`package.json` ist die einzige technische Versionsquelle. `npm run sync-version` synchronisiert Worker, Frontend, Service Worker, HTML, Wrangler und README-Kopf. Release Notes und Verbesserungsliste werden je Release inhaltlich gepflegt. Keine Suffix-Versionen wie `-2.0`.

## Checks vor Deploy

```bash
npm install
npm run sync-version
npm run check
```

`npm run check` umfasst JS-Syntax und die Safety-Regressionssuite.

## Deployment-Hinweis v3.2.0

v3.2.0 ist die erste Version mit **Tiingo Primary standardmaessig aktiv**. Nach Deploy zuerst Health/Stock-Status, Aktien-Freshness, BOATS-Kandidaten und Signalton beobachten. Twelve Data nicht loeschen, bevor Tiingo im realen Premarket/Opening mehrere Sessions stabil gelaufen ist.
