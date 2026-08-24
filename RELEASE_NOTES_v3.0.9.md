# FusionPulse v3.0.9 — Favoriten, Heatmap & Early-Crowd

Stand: 24.08.2026

## Änderungen
- Favoriten-Aktien bleiben bei gestaffelten Twelve-Data-Teilscans über den letzten bekannten Datensatz sichtbar und verschwinden nicht mehr aus dem Favoritendepot.
- Favoriten bleiben damit auch im Datenbestand für die Aktien-Heatmap verfügbar; beim Filter „Favoritendepot“ zeigt die Heatmap dieselben Favoriten wie die Liste.
- Letzte bekannte Aktienzeilen werden begrenzt lokal persistiert (max. 120), damit Favoriten auch nach Reload/Teilscan nicht nur von der gerade aktualisierten Gruppe abhängen.
- Im Aktien-Detail und im Top-Aktienfenster gibt es jetzt „Was hat sich geändert? · Interpretation“.
- Die Interpretation verwendet ausschließlich vorhandene Crowd-, Lead-, Twin-, Momentum-, Volumen- und Technikdaten. Sie verändert den BUY-Score nicht (0 % BUY-Gewicht).
- Crowd/Search ist explizit als vorgelagerter Aufmerksamkeitsindikator ausgelegt: Marktvolumen ist keine Voraussetzung für ein frühes Crowd-Signal.
- Crowd-Cache von 4 Stunden auf 55 Minuten verkürzt, passend zum bestehenden stündlichen Crowd-Poll. Dadurch kann frühe Aufmerksamkeit deutlich zeitnäher sichtbar werden, ohne bei jedem UI-Refresh neue SerpApi-Abfragen zu erzeugen.

## Bewusst unverändert
- BUY-Regeln und Mindest-CRV
- Krypto-Scan und Bitpanda-Pipeline
- D1-Learning-Erfolgsdefinition
- Twelve-Data-Quota-Staffelung aus v3.0.8
- Alpaca Opening Momentum

## Prüfung
- npm run sync-version: bestanden
- npm run check: bestanden
