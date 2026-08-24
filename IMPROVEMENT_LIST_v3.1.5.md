# FusionPulse v3.1.3 – Verbesserungsliste (VL)

Stand: 2026-08-24

## Bereits in der Entwicklungsfassung umgesetzt
- Favoriten und Aktienkarten manuell neu anordnen; Reihenfolge persistent speichern.
- SIGNAL-INFO dauerhaft als untere Leiste sichtbar; Signale bleiben in der Sitzung erhalten, Karten-Hervorhebung darf zeitlich auslaufen.
- Klick auf eine Aktie in der unteren Aktienliste öffnet sie im großen oberen Aktienfenster.
- Intraday-Kursverlauf im großen Aktienfenster aus bereits geladenen 5-Minuten-Bars, ohne zusätzlichen API-Request.
- Intraday-Kursverlauf im großen Coin-Detailfenster aus den bereits vorhandenen Spark-/Bar-Daten.
- Tiingo serverseitig isoliert vorbereitet; kein direkter BUY-/Score-Einfluss.

## Vor Claude-OPUS-Audit noch zu diagnostizieren / fertigzustellen
- Premarket: bei „Alle Aktien“ klar zwischen aktiv aktualisiert, angezeigt/gecached, stale und n. v. unterscheiden. Favoriten-Priorisierung transparent kennzeichnen.
- Twin Learning: GOOGL `Twin 0% · n=12` und Sample-Persistenz/Symbolzuordnung prüfen; keine Schwellenwerte blind verändern.
- Crowd-Tacho 1: `/api/crowd` diagnostizieren; echte 0 strikt von fehlenden Daten unterscheiden.
- Tiingo: echten Token-/REST-Test, danach Power/BOATS-Entitlement und Discovery-Layer; Datenherkunft + Aktualität pro Aktie sichtbar machen.
- Regression: Krypto/Bitpanda, Opening Momentum, Suche, Heatmap, Favoriten, Signaltöne, BUY/CRV/Executability.

## Sicherheitsregel
Fehlende, stale oder qualitativ schlechtere Daten dürfen ein Setup niemals verbessern. Discovery allein erzeugt keinen BUY.

## VL-Runde 2 – 2026-08-24 umgesetzt/diagnostiziert
- Premarket/Alle Aktien: jede sichtbare Aktienkarte kennzeichnet jetzt, ob sie im aktuellen Twelve-Data-Teilscan wirklich aktualisiert wurde (`AKTUELLER SCAN`) oder nur aus Cache/älterem Scan angezeigt wird (`ANGEZEIGT / NICHT DIESE RUNDE`, `GECACHED`, `STALE`, `DATEN n. v.`). Favoriten-Priorisierung bleibt wegen Twelve-Free-Limit bestehen, wird aber nicht mehr mit Live-Status verwechselt.
- Twin Learning: Herkunft wird sichtbar (`D1` oder `lokal`). `n=12` ist die Maximalzahl der ähnlichsten historischen D1-Snapshots, die die aktuelle Twin-Funktion auswertet; dass nur einzelne Titel n=12 zeigen können, hängt zusätzlich damit zusammen, dass der Learning-Endpunkt bewusst nur eine begrenzte Zahl von Aktien tief aus D1 lädt. Vor Release bleibt ein Regressionstest der Symbolzuordnung Pflicht.
- Crowd: bei jeder neuen Crowd-Abfrage werden die angefragten Symbole zunächst aus der Frontend-Map entfernt. Ein alter Crowd-Wert kann dadurch nicht mehr unbemerkt als aktueller Wert stehen bleiben, wenn die neue Antwort für diesen Titel keine Daten liefert.
- Tiingo: zusätzlicher isolierter `/api/tiingo/status`-Endpoint prüft nur Token/Authentifizierung über Tiingos `/api/test/`; BOATS bleibt bis zum Entitlement getrennt und beeinflusst BUY/Score weiterhin nicht.

## v3.1.2 umgesetzt
- Opportunity Watch: nur wirtschaftlich relevante Live-Chancen melden; Mindest-Nettoertrag 250 EUR bei Standard-Setup, Netto-CRV und Mindestkursweg bleiben harte Gates.
- DISCOVERY → OPPORTUNITY → BUY als klare Zustände; Opportunity darf keine BUY-Regel lockern.
- Claude-OPUS-Audit P0/P1-Sicherheitskorrekturen integriert.


## Erledigt in v3.1.2
- [x] D1-Globalisierung der Twelve-Data-Tageszählung / Cross-Isolate-Warmcache.
- [x] D1-Learning-Persistenz gebündelt.
- [x] Safety-Regressionssuite.
- [x] Aktienkurse: EUR zuerst, USD-Kurs immer in Klammern daneben.


## v3.1.3 – Claude-Zwischenaudit + UI
- [x] `null` bleibt in Coin-Liquidität/Orderbuch und Detailfaktoren wirklich `n.v.` statt zu 0 zu kollabieren.
- [x] Crowd-D1-Batching nutzt nur Scores der letzten 6 Stunden.
- [x] Produktions-D1 zieht `executability` bei Alt-Schema automatisch nach.
- [x] Twin-Nachbarschaft schließt denselben Titel aus; Badge kann Zahl unterschiedlicher Titel zeigen; `n=0` fällt lokal zurück.
- [x] Stock-Heatmap/History imputiert fehlende Executability nicht erneut.
- [x] Opportunity-Logik zentralisiert; Tonpfad benutzt dieselbe Regel.
- [x] Aktien-Preisleiter nutzt originale USD-Marken statt Rückrechnung aus gerundetem EUR.
- [x] Stale-Anzeige CSS repariert; Dock-Safe-Area korrigiert; Sparkline mit 1 Datenpunkt robust.
- [x] `/api/health` gibt bei aktivem APP_TOKEN unauthentifiziert nur reduzierte Statusdaten aus.
- [x] Coin-Deep-Scan UI auf tatsächliches Maximum 20 synchronisiert.
- [x] Coin-Liste: Zonenlage bleibt sichtbar und erhält Klartext `UNTER ZONE / IN ZONE / ÜBER ZONE`.
- [ ] Alpaca-Momentum-Neutralwert/renormierte Score-Invariante separat strukturell überarbeiten, bevor er BUY-Gewicht erhält. Aktuell kein BUY-/Ton-Pfad.
- [ ] Tiingo-Bulk-Datenmenge beobachten; bei realem BOATS-Einsatz serverseitigen Cache/Filterstrategie messen.

## Ergänzungen v3.1.5
- [x] Tiingo-Test direkt in der geschützten PWA statt manueller unauthentifizierter URL.
- [x] Kompakte Statussymbole oben links neben Countdown.
- [x] RISK ON/OFF/Neutral-Erklärungsfenster wieder sichtbar/anklickbar.
- [x] SIGNAL-INFO-Banner beim Start explizit initialisieren und dauerhaft sichtbar halten.
- [ ] Nach erfolgreichem Tiingo-Test Power/BOATS aktivieren und erst danach Primary-Umschaltung prüfen.
