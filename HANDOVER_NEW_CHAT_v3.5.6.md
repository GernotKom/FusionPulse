# FusionPulse – Übergabe für neuen Chat · v3.5.6

## Arbeitsbasis
- Archiv: `FusionPulse_v3.5.6.zip`
- Kumulative VL: `IMPROVEMENT_LIST.md` + `VL_STATUS_v3.5.6.md`
- Release Notes: `RELEASE_NOTES.md`

## Nicht verhandelbar
1. Fehlende/stale/schlechtere Daten dürfen Score, BUY oder positiven Signalton niemals verbessern.
2. FokusScope hat höchste Daten-/Analysepriorität; aktive Position direkt danach.
3. Claude-Modus methodisch nicht verändern; SHA-Locks müssen grün bleiben.
4. Aladdin v3.5.5 bleibt additive, geschützte Marktmeinung und verändert keinen Claude-/FusionPulse-Score.
5. Technische Stops/Ziele niemals verschieben, nur damit CRV/EV „passt“.
6. Kein VL-Punkt wird still gestrichen. Offene Punkte bleiben in `VL_STATUS_v3.5.6.md` sichtbar, bis sie umgesetzt oder vom Nutzer ausdrücklich verschoben wurden.

## Neu in v3.5.6
- größere Aktien-Heatmap + vier direkte Quadrantenbeschriftungen + vorhandene Trails
- reale Position im FokusScope: Kaufkurs EUR/Tradegate + Stückzahl
- Live-Berechnung: Investition, technischer SL, TP1/TP2, Netto-CRV, Verlust am SL, Gewinne TP1/TP2, unrealisiertes Ergebnis
- Teilverkauf/Reststückzahl
- persistenter Verkaufsalarm bei SL-Gefahr/SL/TP1/TP2; Ton falls aktiviert; keine automatische Order
- neue Regressionen für diese Funktionen

## Vor nächstem Release zuerst
1. `npm run check`
2. `VL_STATUS_v3.5.6.md` komplett gegen Code/UI prüfen
3. offene P0/P1 vor P2/P3 abarbeiten
4. vollständiger Live-Smoke: Freshness, Refresh, Heatmap, Position/Alarm, Learning/TWIN, Planleiste
5. erst danach neue Version als fertig bezeichnen
