# FusionPulse Verbesserungsliste – kumulativ

## In v3.5.2 umgesetzt — FusionPulse Adaptiv / Opportunity Lifecycle
- **Claude Modus geschützt:** Claude-Aktien- und Krypto-Methodik sowie die Claude-Client-Konstanten/Overlay sind gegenüber v3.5.1 byte-identisch und über SHA-256-Regressionstests gesperrt.
- **Eigener Aktienmodus mathematisch korrigiert:** Struktur-CRV und 50/50-Plan-Effizienz werden nicht mehr vermischt. Struktur-CRV muss weiterhin die eingestellte Grenze (standardmäßig 3:1) erfüllen; der reale Teilverkaufsplan besitzt eine separate Kosten-/Effizienzprüfung.
- **Wirtschaftliche Relevanz adaptiv:** absolute Untergrenze 75 EUR plus mindestens 1,25 % der tatsächlichen Positionsgröße; der alte 350-EUR-Default wird nur als exakt erkannter Alt-Default migriert.
- **Marktgemessenes Strukturziel:** Reclaim/Pullback -> reales vorheriges Hoch; Breakout/Squeeze -> gemessene Range-/Impulsprojektion. Kein künstliches Hochsetzen des Ziels, um CRV zu retten.
- **Aktien-Elliott repariert:** `analyseStock()` liefert jetzt einen echten Elliott/Fibonacci-Strukturwert; die bereits vorhandene Elliott-Gewichtung im Deep-Recheck ist damit erstmals real wirksam.
- **Opportunity Lifecycle:** PREP -> IGNITION -> CONFIRM -> LATE/WATCH aus Zustandswechseln zwischen aufeinanderfolgenden IEX-Radar-Snapshots. PREP/IGNITION werden bevorzugt, Late-Chase wird abgewertet. Discovery bleibt 0 % direktes BUY-Gewicht.
- **UI transparent:** FokusScope/Detail trennen Struktur-CRV und 50/50-Plan-Effizienz; Methodenfeld kennzeichnet FusionPulse Adaptiv versus unveränderten Claude Modus; Radar zeigt Lifecycle-Phase.

## Offen / verbindliche VL für nächste Versionen
- **Aktive Position im FokusScope:** Nach tatsächlichem Kauf Eingabefelder für Kaufkurs in EUR/Tradegate und Stückzahl. Daraus sofort investiertes Kapital, SL, TP1, TP2, Netto-CRV, Verlust am SL sowie Gewinn bei TP1/TP2 auf Basis der realen Ausführung berechnen. Technische Ziele/Stop dürfen nicht künstlich verschoben werden, nur um das CRV zu verbessern.
- **Verkaufsüberwachung mit Alarm:** Übernommene Position aktiv überwachen. Bei SL-Gefahr/SL, TP1, TP2 oder eindeutigem strukturellem Exit **TON + sehr auffällige grafische Meldung**. Alarm bleibt sichtbar, bis bestätigt; klare Unterscheidung Warnung versus echte Verkaufsaktion.
- **Positionsmanagement nach TP1:** Teilverkauf/Reststückzahl dokumentierbar; spätere Stop-Anpassung nur nach der jeweils aktiven Methodik und transparent anzeigen.

# FusionPulse Improvement List — Stand v3.4.3


## In v3.4.3 umgesetzt — Situation Engine / Freshness / sichtbare Methoden
- **Neue Situation Engine für Aktien-Discovery:** Der Large-Cap-Radar priorisiert jetzt frische Zustandswechsel statt nur große Tagesbewegungen: Opening Drive, Breakout Pressure, Early Acceleration, Reversal/Reclaim, Volumenpuls, Nähe zum Tageshoch und Spread-Verbesserung. Bereits stark gelaufene Titel ohne neue Beschleunigung werden abgewertet. Discovery bleibt **0 % direktes BUY-Gewicht**.
- **Deep Situation Engine im Fokus/Deep Scan:** Zusätzliche Erkennung von Breakout Start, Squeeze Release, VWAP-/EMA21-Reclaim, Pullback Hold und Beschleunigung 5m vs. 15m. `situationScore` steuert nur Priorisierung/Erklärung und verändert weder den bestehenden Qualitäts-Score noch BUY/CRV-Gates. Fehlendes Volumen deckelt die Situation-Bewertung fail-closed.
- **Früher statt später finden:** Re-Check-Queue und Pre-Signal-Reife berücksichtigen die Situation-Dynamik, damit Titel mit beginnender Bewegung früher erneut tief geprüft werden; große, aber bereits auslaufende Tagesrunner werden nicht blind bevorzugt.
- **Freshness pro Aktienkategorie:** Situation Radar, Opening Momentum und Extended Hours zeigen jeweils einen eigenen echten Datenstatus: Grün <3 Min., Gelb 3–5 Min., Orange 5–10 Min., Rot ab 10 Min. Ein Request/Klick setzt die Ampel nicht zurück; maßgeblich ist der Zeitstempel tatsächlich empfangener Daten. Die Farbe altert auch ohne neue API-Antwort automatisch.
- **Stale-Recovery:** Während Premarket/Opening/Regular fordert die PWA bei >3 Min. altem Aktien-Snapshot selbstständig einen echten Recovery-Scan an (throttled), statt bei ausgefallenem Cron minutenlang nur Altwerte zu zeigen. Manueller Force-Refresh wartet länger auf echte Deep-Daten und meldet sichtbar, wenn keine neuen Daten angekommen sind.
- **Analysemethoden wirklich sichtbar:** Das Methodenfeld sitzt jetzt permanent in der unteren Signal-Fußleiste und zusätzlich direkt im FokusScope. Angezeigt werden die tatsächlich verwendeten Kernmethoden inklusive Situation Engine, ATR, CRV/Execution, Spread/Liquidität plus aktivierte Analysekomponenten.
- **FokusScope bleibt höchste Priorität:** Einzelaktien-Refresh, Live-/Freshness-Prüfung und Deep-Analyse bleiben bevorzugt; fehlende/schlechtere Daten können weiterhin keine Freigabe verbessern.


## In v3.4.2 umgesetzt — Refresh/FokusScope/Analysemethoden
- **FokusScope höchste Priorität:** Ein manueller Refresh der Fokusaktie umgeht den 5-Minuten-Lookup-Cache und erzwingt eine neue Deep-Analyse plus frischesten verfügbaren Quote. Fehlende/schlechtere Daten bleiben fail-closed.
- **Blauer globaler Refresh repariert:** Der blaue Pfeil erzwingt jetzt zuerst die Fokusaktie und danach einen echten neuen Aktien-Snapshot (`force=1`) sowie Opening/Krypto/Crowd/Learning/Health. Ein bloßes Neurendern alter Aktien-Cache-Daten gilt nicht als erfolgreicher manueller Refresh.
- **Analysemethoden in der Fußleiste:** Die aktuell aktivierten Verfahren werden kompakt unten angezeigt; die Anzeige folgt den Einstellungen und verändert keine Gewichtung.
- **Priorität:** FokusScope vor breiter Discovery. BUY-/CRV-/Sizing-Sicherheitsregeln unverändert.

## In v3.4.2 umgesetzt — Large-Cap-/Flatex-Filter
- **Automatischer Aktien-Radar nur noch Large Caps:** Whole-Market Radar und automatische Opening-Momentum-Discovery sind inclusion-only auf einen kuratierten Large-Cap-/hochliquiden US-Titelkatalog begrenzt. Small-/Micro-Caps werden nicht mehr automatisch angezeigt.
- **Flatex-Praxisziel:** Weniger theoretische Momentum-Treffer, dafür Kandidaten mit deutlich höherer Wahrscheinlichkeit realer Handelbarkeit über Flatex/Tradegate. Eine einzelne Broker-Verfügbarkeit kann technisch nicht garantiert werden.
- **Manuelle Suche/Favoriten bleiben möglich:** Der Filter gilt für automatische Discovery; bewusst gesuchte oder favorisierte Titel werden nicht pauschal gesperrt.
- Common-Stock-/ETF-Gate bleibt zusätzlich aktiv; Trading-/BUY-Schwellen, Netto-CRV, Sizing und Elliott bleiben unverändert.


## In v3.4.1 umgesetzt — P0 Hotfix
- **P0 Laufzeitfehler Opening/Alpaca:** `momentumFromAlpaca()` definierte `priceSource` vor dem Return nicht. Der dadurch ausgelöste `ReferenceError: priceSource is not defined` konnte Opening Momentum/Extended-Hours-Aktienpfade abbrechen. `priceSource` wird jetzt deterministisch als `minute`, `trade`, `daily` oder `none` gesetzt.
- **Daily-Bar klar fail-closed gekennzeichnet:** Wenn Alpaca weder Minute-Bar noch Latest Trade liefert, erscheint der Tages-Bar nur als `⚠ Tages-Bar/Fallback` im Discovery-Bereich; er wird nicht als Live-Quote dargestellt und bleibt 0 % BUY-Gewicht.
- **Regressionstest ergänzt:** Safety-Suite prüft jetzt explizit, dass `priceSource` vor der Rückgabe definiert ist und der Daily-Fallback sichtbar gekennzeichnet bleibt.
- Keine Änderung an BUY-Schwellen, CRV, Sizing, Elliott-Logik oder Discovery-Gewichtung.

## In v3.4.0 umgesetzt — Audit + VL
- P0 Fokusbindung: Radar/Momentum/Extended/Suche dürfen niemals still auf ersten/vorherigen Ticker zurückfallen; aktiver Fokus wird über Polls erhalten.
- P0 Lookup-Race/Mismatch: eigener Sequenz-Guard; kein Suchfeld als Transportkanal; Ticker-Mismatch fail-closed.
- P0 `regimeExplanation()` repariert; Risk-On/Off/VWAP-Mouseover wieder funktionsfähig, kein falscher Learning-Fehler als Kollateralschaden.
- P0 BUY-Freshness fail-closed: BUY nur bei `live` und bekannter Opening/Regular-Marktphase; fehlende/schlechtere Daten verbessern nie ein Setup.
- P0 Tiingo-Freshness: persistierte `refreshedSymbols` im Clientpfad durchgereicht.
- Fokusfenster: Quote/Freshness/Abfragezeit sichtbar + Refreshbutton nur für die Einzelaktie.
- Provider-/Frontend-Timeouts ergänzt; Aktien-Poll wird auch nach Fehler/Timeout wieder geplant.
- Crowd nicht mehr minütlich durch Opening Momentum; 20-Minuten-Zyklus.
- Chart-Cache TTL 120 s.
- Radar-Quote >30 min wird verworfen; Alpaca-Preisquelle intern gekennzeichnet.
- Fokus-Sprung unter Sticky Header korrigiert.
- VWAP-Text bei fehlender Volumenbasis korrekt „n. v.“.
- Service-Worker: kein unnötiger Reload beim ersten Claim.
- Opening Momentum: redundantes `· RADAR` entfernt; Updatezeit + 60-s-Intervall im Header.
- Learning-Fehler erklärt ausdrücklich Learning/D1 statt pauschal Verbindung.
- Safety-Regression um Audit-Guards erweitert.

## Bereits aus v3.3.x erhalten
- Whole-Market Radar unabhängig von Favoriten; Discovery 0 % BUY-Gewicht.
- Speed in Radar und Opening Momentum mit Mouseover; kein eigenständiges BUY-Signal.
- Google-Finance-Link im Aktienfokus.
- Netto-CRV, Strukturpotenzial und wirtschaftlich relevantes Mindest-Netto-Potenzial im Fokus.
- Unternehmensbeschreibung/Lead Program nur bei verifizierbarer Datenbasis.
- Chart-Zeiträume 5/10/30/60/120/180/240/300 min, 1T/5T/1Wo/3Mo/6Mo/12Mo auswählbar.
- Tiingo IEX Primary / Twelve Data Fallback dynamisch beschriftet.

## Weiter offen / nächste VL
- **Heatmap Aktien:** Kugeln sollen sich mit neuen Analysen sichtbar dynamisch bewegen; Trails/Positionierung und Lesbarkeit verbessern. Premarket kann naturgemäß weniger dynamisch sein, darf aber nicht wie eingefroren wirken.
- **Aktienchart Extended Hours:** echte Premarket-/After-Hours-Zeitreihe, Previous Close und Gap-%; Sessions optisch trennen; keine künstliche Linie über Datenlücken.
- **Header-Zähler:** grün/gelb/rot eindeutig nach Aktien und Coins differenzieren; aktueller Sammelzähler ist missverständlich.
- **Aktien-Status oben vs Aktienfeed-Premarket:** doppelte/ähnliche Statusanzeigen zusammenführen oder klar in „Systemverbindung“ vs „Marktdatenphase“ trennen; jeweils letzte Abfrage und Intervall anzeigen.
- **Twelve Data Kontingent:** „Kontingent unbekannt“ nicht als scheinbaren Fehler darstellen; bei fehlenden Providerheadern klar „Restkontingent vom Anbieter nicht geliefert“ und nur belastbare Eigenzählung zeigen.
- **Signal-/Planleiste unten:** nur bei echtem aktiven Plan/BUY-Signal anzeigen; niemals zufälligen/zuletzt selektierten Coin (z. B. PUMP) dauerhaft wie Empfehlung darstellen. Eindeutig „AKTIVER KRYPTO-PLAN“/„AKTIVER AKTIEN-PLAN“ beschriften.
- **Discovery-Beschreibung:** fachlicher Kontext präzisieren, z. B. Biotech-Discovery und Lead Candidate + Indikation nur wenn verifiziert.
- **Elliott/Struktur:** 30–180-min-Kontext für Intraday-Setups gezielt evaluieren; längere Ebene als Kontext, nicht als automatische Verbesserung. Keine Änderung der BUY-Schwellen ohne separaten Test.
- **Gewinnrelevanz:** grünes Setup darf nicht mit wirtschaftlich irrelevanter absoluter Gewinnchance erscheinen; bestehende Netto-Potenzial-/CRV-Gates weiter regressionsfest halten.
- **Risk/VWAP:** Mouseover nach Live-Deploy explizit prüfen (Audit-Fix ist im Code); Begriff „% über VWAP“ muss klar sagen, welche Grundgesamtheit gemeint ist.
- **Shooting/Short-Radar:** separat, erst nach stabiler Long-Version und externem Audit.
- **Learning-Bericht:** „Was wurde verpasst?“ ergänzen.
- **Liquideste Börse:** nur mit echten Venue-Volumendaten behaupten.
- **Cloudflare Kosten/Upgrade:** nur bei gemessener Nähe zu Limits oder wiederholten CPU-Problemen empfehlen.
