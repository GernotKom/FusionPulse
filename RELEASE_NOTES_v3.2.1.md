# FusionPulse v3.2.1

## Autonomous Market Radar
- Neuer **Tiingo IEX Whole-Market Radar**: ein Bulk-Snapshot ueber `/iex` beobachtet den verfuegbaren US-IEX-Markt statt nur Favoriten/kleinen Basiskatalog.
- Radar bewertet nur Discovery-Merkmale wie frische Kursbeschleunigung, Tagesstaerke, Aktivitaet, Spreadverbesserung und Range Expansion.
- Radar-Metadaten tragen explizit **`buyWeight: 0`** und koennen `analyseStock()`/BUY nicht direkt hochstufen.
- Spaete bereits stark gelaufene Runner werden im Discovery-Ranking konservativ abgewertet, wenn keine neue Beschleunigung mehr vorliegt.

## Serverseitiger Hintergrundscan
- Cloudflare-Cron fuehrt den Whole-Market-Radar im Tiingo-Primary-Modus **jede Minute** aus, unabhaengig davon, ob die PWA bzw. der PC laeuft.
- Der aufwendige IEX-5-Minuten-Deep-Scan laeuft serverseitig **alle 2 Minuten**.
- Top-Radar-Snapshots werden kompakt in D1 (`fp_meta`) gespeichert, damit ein browserunabhaengiges Bewegungs-Gedaechtnis entsteht.

## Adaptive Deep-Scan-Queue
- Maximal weiterhin **20 Titel je Deep-Scan-Zyklus**.
- Kapazitaet wird dynamisch auf Favoriten, zuletzt fast reife Setups, Whole-Market-Radar-Kandidaten, BOATS-Kandidaten und Exploration verteilt.
- Whole-Market-Radar-Kandidaten erhalten den groessten Anteil der Queue; Favoriten blockieren nicht mehr die Discovery des restlichen Markts.
- Bereits analysierte starke Setups werden gezielt erneut geprueft, statt jede Runde gleich behandelt zu werden.

## Opportunity-Reife / Why Now
- Analysierte Aktien erhalten eine konservative **Pre-Signal-Reife 0–100 %** als Abstand zur vollstaendigeren Opportunity-Reife; dies ist kein BUY-Signal.
- Radar kann kurze `whyNow`-Gruende mitfuehren, z. B. neue Beschleunigung, anziehendes Volumen oder enger werdenden Spread.
- Reife/Radar-Ranking dienen nur der Priorisierung der Analysekapazitaet; die harten BUY-Gates bleiben unveraendert.

## UI
- **„Alle Aktien“** priorisiert jetzt autonom gefundene/reife Kandidaten statt Favoriten immer zuerst zu zeigen.
- Favoriten/Depot bleibt ein eigener Filter mit persistenter manueller Reihenfolge.
- Aktienradar zeigt getrennt `RADAR`- und `BOATS`-Kandidaten.
- Datenquellenhinweis ist nicht mehr statisch auf Twelve Data festgeschrieben; Tiingo IEX wird im Primary-Betrieb korrekt angezeigt, Twelve Data nur als Fallback.
- Aktienchart im grossen Detailfenster: Zeitraum waehlen zwischen **5 / 10 / 30 / 60 / 120 / 180 / 240 / 300 Minuten**; keine zusaetzliche API-Abfrage.
- Intraday-Puffer auf bis zu 60 vorhandene 5-Minuten-Bars erweitert, damit 300 Minuten dargestellt werden koennen.

## Safety
- **Keine Trading-Schwelle gelockert.**
- Fehlende/stale/schlechtere Daten duerfen weiterhin niemals Score, BUY oder positiven Ton verbessern.
- BUY bleibt hinter bestehender Qualitaet, Handelbarkeit und Netto-CRV > 3:1.
- BOATS und IEX-Radar haben explizit 0 % BUY-Gewicht.
- Deep-Scan-Cap bleibt 20.

## Tests
- `node --check public/app.js`: OK
- `node --check src/worker.js`: OK
- `node --check public/sw.js`: OK
- Worker-Import: OK
- `npm run test:safety`: OK
