# FusionPulse v3.0.4 – Release Notes

## Release-Schwerpunkt
Stabilitäts- und Learning-Release auf Basis v3.0.3. Kein Deploy wurde aus diesem Paket heraus ausgeführt.

## Enthalten
- Krypto-Learning: `ret15`, `ret60` und echtes `relVol` aus vorhandenen Candle-/Volumendaten ergänzt; NULL-Semantik für nicht definierte Features bleibt erhalten.
- Krypto-Momentum-Lernsignal: Fallback auf `row.momentum` vor Gesamt-Score korrigiert; ebenso bei `signal_events.strength`.
- Cron-/Provider-Fehler: getrennte Provider-Isolation bleibt erhalten; Fehler werden klassifiziert, geloggt und Providerstatus aktualisiert statt still geschluckt.
- Health/Observability: Providerstatus persistent über D1/fp_meta bzw. letzte Snapshots ableitbar; `unknown`/`stale` robuster; Observability in `wrangler.jsonc` aktiviert.
- Aktien-Tradeplan: Zielpfad (Entry+TP1+TP2) und Stop-Pfad (Entry+Stop) mit getrennten geschätzten Kosten; Netto-CRV bezieht sich auf den tatsächlichen 50/50-Tradeplan. Für typische 5.000–10.000-€-Ausführungen wird konservativ mit 9,90 € Flatex-Orderprovision plus mindestens 0,85 € Tradegate-Fremdspesen je Ausführung gerechnet; Spread/Slippage bleiben mangels Live-Tradegate-Bid/Ask eine Reserve-Schätzung.
- TP1/TP2/Gesamtplan: Netto-Ergebnisse klarer getrennt.
- Aktien-Fokus: rechte vertikale Preisskala mit aktuellem Kurs, Entry, SL, TP1 und TP2; EUR-Werte sind ausdrücklich als Umrechnung gekennzeichnet, nicht als direkter Tradegate-Kurs.
- Versionsstand vollständig auf 3.0.4 synchronisiert.

## Bewusst nicht geändert
- Outcome-Erfolgsregel +5 % / 180 Minuten bleibt unverändert, bis genügend echte Outcome-Daten für eine asset-/volatilitätsabhängige Kalibrierung vorliegen.
- Krypto Twin-/Lead-Modell wurde nicht vorschnell aus dem Aktienmodell kopiert.
- Kein produktives Deployment durchgeführt.

## Prüfung
- `npm run check`: bestanden (public/app.js, src/worker.js, public/sw.js).
- `npx wrangler deploy --dry-run`: in der lokalen Ausführungsumgebung in ein Timeout gelaufen; daher weder als bestanden noch als Codefehler gewertet.
