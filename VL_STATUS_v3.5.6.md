# FusionPulse v3.5.6 · kumulative Pflicht-VL · Status

Grundregel: Kein VL-Punkt darf still verloren gehen. „Im Code vorhanden“ ist erst nach Live-/UI-Smoke-Test vollständig abgenommen. Claude-Modus und der von Claude gelieferte Aladdin-Layer bleiben methodisch geschützt.

| Bereich | Pflichtpunkt | Stand v3.5.6 |
|---|---|---|
| Heatmap | deutlich größer | **IM CODE UMGESETZT** · Smoke ausständig |
| Heatmap | vier Quadranten direkt beschriften | **IM CODE UMGESETZT** · Smoke ausständig |
| Heatmap | Dynamik / Trails | **ERHALTEN + VERSTÄRKT** · echte Bewegung im Live-Smoke prüfen |
| FokusScope | höchste Genauigkeit / Ressourcenpriorität | **BEREITS VORHANDEN** · regressions-/liveprüfen |
| Refresh | Einzelaktien-Refresh echte neue Daten + Deep-Analyse | **BEREITS VORHANDEN** · Live-Smoke verpflichtend |
| Refresh | blauer globaler Refresh echter neuer Aktienzyklus | **BEREITS VORHANDEN** · Live-Smoke verpflichtend |
| Freshness | Status je Aktienkategorie | **BEREITS VORHANDEN** · Grün <3 / Gelb 3–5 / Orange 5–10 / Rot >10 |
| Freshness | echte Datenzeit statt Requestzeit | **BEREITS VORHANDEN** · Live-Smoke verpflichtend |
| Analysemethoden | kleines Methodenfeld sichtbar | **BEREITS VORHANDEN** |
| Analysemethoden | nur tatsächlich aktive/ergänzende Methoden transparent | **BEREITS VORHANDEN** · UI-Smoke |
| Position | Kaufkurs + Stückzahl eingeben | **NEU v3.5.6 UMGESETZT** |
| Position | realer Tradeplan sofort berechnen | **NEU v3.5.6 UMGESETZT** |
| Position | Teilverkauf / Restposition | **NEU v3.5.6 UMGESETZT** |
| Alarm | Verkaufsalarm Ton + grafisch, persistent | **NEU v3.5.6 UMGESETZT** · Browser-Ton/Live-Smoke |
| Stop | FusionPulse-Stop mit Struktur + ATR + Spread/Slippage-Puffer | **OFFEN** · Logikänderung absichtlich nicht ohne separate Fixtures in geschützte Releasebasis hineingedrückt |
| Learning/TWIN | Lernstatus + Evidenz | **TEILWEISE/BEREITS VORHANDEN** (D1-Status, n, Updates, Attribution) |
| Learning/TWIN | konkrete gelernte Regeln/Muster + Evidenz | **TEILWEISE** · Attribution/Lead/Twin vorhanden, vereinheitlichte Top-Regel-UI offen |
| Learning/TWIN | Learning Impact Log letzte 5–10 Fälle | **OFFEN** |
| Learning/TWIN | Shadow „ohne TWIN“ vs „mit TWIN“ | **OFFEN** |
| Learning/TWIN | Overfitting-Selbstkontrolle | **BEREITS v3.5.4 VORHANDEN** |
| Learning/TWIN | Top 3 Regeln + Top 3 Hypothesen + „Was wurde verpasst?“ | **OFFEN/TEILWEISE** |
| ALADDIN | Claude-ALADDIN separat integrieren, nicht umschreiben | **v3.5.5 VORHANDEN / GESCHÜTZT** |
| Chart | Extended-Hours-Zeitreihe + Previous Close + Gap + Sessiontrennung | **OFFEN** |
| Header | Aktien-/Coins-Zähler trennen | **OFFEN** |
| Header | Systemverbindung vs Marktdatenphase trennen | **TEILWEISE** |
| Provider | Twelve-Data-Kontingent verständlich | **TEILWEISE** |
| Signal-/Planleiste | nur echte aktive Pläne / keine zufällige Coin-Empfehlung | **TEILWEISE** · Signalhistorie enthält echte Events; endgültige Plantrennung offen |
| Discovery | Unternehmensbeschreibung nur verifiziert | **BEREITS FAIL-CLOSED ANGELEGT** · liveprüfen |
| Elliott/Struktur | 30–180-min Kontext evaluieren | **BEREITS ALS CHARTKONTEXT VERFÜGBAR** · Schwellenänderung bewusst offen |
| Gewinnrelevanz | wirtschaftlich irrelevante Grün-Signale verhindern | **BEREITS REGRESSIONSGESCHÜTZT** |
| Risk/VWAP | Begriffe/Mouseover live prüfen | **CODE VORHANDEN** · Smoke offen |
| Short | Shooting/Short-Radar erst nach stabiler Long-Version + Audit | **OFFEN / P3** |
| Venue | liquideste Börse nur mit echten Venue-Volumendaten behaupten | **BEREITS FAIL-CLOSED ANGELEGT** |
| Ressourcen | Cloudflare Upgrade nur datenbasiert | **BEREITS ALS REGEL VORHANDEN** · vollständiges Ressourcenfenster weiter prüfen |
| Versionierung | alle Versionsreferenzen synchron | **v3.5.6 TECHNISCH SYNCHRONISIERT** · historische Release-Historie bleibt absichtlich erhalten |

## Release-Abnahme

- `npm run check`: **GRÜN**.
- Claude-SHA-Locks: **GRÜN**.
- Aladdin v3.5.5 Regressionen: **GRÜN**.
- v3.5.6 Heatmap/Position/Alarm Regressionen: **GRÜN**.
- **Noch nicht erledigt:** Produktiv-Deploy + vollständiger UI-Smoke-Test mit echten Providerdaten.

Diese Datei ist ab v3.5.6 die kompakte Statusmatrix. Die ausführliche Historie bleibt in `IMPROVEMENT_LIST.md` erhalten.
