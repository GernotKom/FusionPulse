# FusionPulse Release Notes — v3.2.9

## Historical Twin Hotfix
- Entfernt die harte `.slice(0,12)`-Logik als Stichprobenmechanismus.
- D1-Twins werden nur bei echter Ähnlichkeit (feste Distanzgrenze) zugelassen; es wird nicht auf eine Wunsch-Stichprobengröße aufgefüllt.
- Mehrere korrelierte Snapshots desselben Titels am selben Tag werden zu einer unabhängigen Episode zusammengefasst.
- Lokaler Fallback verwendet dieselbe Unabhängigkeits- und Ähnlichkeitslogik.
- `n` ist nun die tatsächlich verwendete Zahl qualifizierter unabhängiger Episoden; bei n<5 wird nur „lernt“ angezeigt.
- Nahe Twins werden für die historische Erfolgsquote stärker gewichtet als grenzwertige Twins.
- 0 % BUY-Gewicht unverändert; Elliott-/BUY-/CRV-/Freshness-Regeln unverändert.

## Unverändert beibehalten
- Common-Stock-/ETF-Schutz aus v3.2.8.
- Elliott-first Discovery, Market-Gainer und Whole-Market-Radar.
- Nur eine RELEASE_NOTES.md und eine IMPROVEMENT_LIST.md.
