# FusionPulse v3.2.0

## Major Step: Tiingo Primary
- `TIINGO_STOCKS_MODE` standardmaessig auf `primary`.
- Tiingo IEX 5-Minuten-Daten + Volumen sind der primaere Aktien-Deep-Scan.
- Twelve Data bleibt als vorhandener Fallback/Referenz im Code, wird im Primary-Modus aber nicht fuer den normalen Aktienradar verbraucht.

## BOATS Discovery
- Ein BOATS-Bulk-Snapshot dient als breiter Overnight-Discovery-Layer.
- Kandidaten werden ausschliesslich nach Auffaelligkeit/Aktivitaet/Spread vorselektiert.
- BOATS-Discovery hat **0 % direktes BUY-/Score-Gewicht**.
- Deep Scan kombiniert bis zu 5 Favoriten, bis zu 10 BOATS-Kandidaten und rotierende Basistitel; maximal 20 Titel je 2-Minuten-Zyklus.
- Deep-Scan-Kandidaten muessen anschliessend vollstaendige IEX-5-Minuten-Daten bestehen.

## Suche
- Unbekannte Aktien koennen im Tiingo-Primary-Modus ueber Tiingos Search-Endpoint aufgeloest werden; lokaler Katalog bleibt erster, stabiler Trefferweg.

## Learning
- Stock-Learning akzeptiert historische D1-Samples aus `Twelve Data` und `Tiingo IEX`.
- Server-Learning nutzt im Primary-Modus Tiingo statt weiterhin Twelve Data zu verbrauchen.
- Bestehende Datenqualitaets- und Twin-Gates bleiben erhalten.

## Safety
- Keine BUY-/CRV-Schwelle gelockert.
- Discovery, Crowd und Learning bleiben vom direkten BUY getrennt.
- Safety-Regressionssuite: OK.
- JS-Syntax und Worker-Import: OK.

## Betrieb
- v3.1.8-Livetest vor Erstellung dieser Version: Token, IEX, 5-Minuten-Historie, Volumen und BOATS erfolgreich.
- Nach erstem Deploy v3.2.0 Tiingo im realen Premarket/Opening plausibilisieren, bevor Twelve Data dauerhaft entfernt wird.
