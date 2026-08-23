# FusionPulse v2.2.0 – Review inputs for Claude

Bitte diese Punkte gezielt gegen Code und Trading-Logik prüfen, ohne Secrets in den Code zu schreiben:

1. **Elliott-Heuristik validieren:** Pivot-/Impuls-/Retracement-Score auf Look-ahead bias, Repainting und falsche Fib-Normalisierung prüfen. Nur geschlossene 5m-Bars verwenden.
2. **Analysemodi:** `composite`, `elliott`, `momentum`, `trend`, `micro` müssen wirklich den Signal-Score beeinflussen; Kosten, Spread, Slippage und Stop-Validierung dürfen in keinem Modus abgeschaltet werden.
3. **CRV-Alarme:** >7,6 und >=8,0 nur bei Schwellenübertritt/Hysterese auslösen, nicht bei jedem Poll. Globaler Ton-Schalter muss alle Töne muten.
4. **Steueranzeige:** Nur als konfigurierbare Schätzung darstellen. Prüfen, ob Gebühren bereits im Kursziel-CRV enthalten sind; keine doppelte Kosten-/Steuerrechnung.
5. **Mouseover:** Desktop Hover darf Zeilen nicht verschieben; auf Touch keine Hover-Falle. Fokus-Panel bleibt primäre mobile Ansicht.
6. **Themes:** Kontrast WCAG-nah prüfen, besonders gelb/grün/rot auf hellen Hintergründen. Keine Trading-Semantik allein über Farbe vermitteln.
7. **Deployment:** `package.json=2.2.0`, `wrangler.jsonc APP_VERSION=2.2.0`, SW cache `fusionpulse-v2.2`; `/api/health` soll Version melden.
8. **Sicherheit:** `FUSION_API_KEY` und `APP_TOKEN` ausschließlich CF-Secrets. Nie in GitHub, Frontend, Logs oder Export.
9. **Performance:** Free-Plan-Subrequest-Budget nach Analysemodusänderung unverändert halten; keine zusätzlichen Fusion-Requests nur für Elliott.
10. **Regression:** Auth 401/200, Scan, Einzelpaar, Service Worker, PWA-Install, Sound-Unlock Safari/Chrome, Desktop/Android testen.
