# FusionPulse Release Notes

## v3.2.5 — Stabilitäts-Fusion aus v3.2.3 + v3.2.4

### P0/P1 Fixes
- Führt die robusten Instrument-/ETF-Sicherungen aus v3.2.3 mit der Cloudflare-CPU-Entkopplung aus v3.2.4 zusammen.
- Security-Metadaten-Cache generationiert (`security_meta:v325:*`), damit eventuell falsche ETF/Common-Stock-Entscheidungen aus älteren Versionen nicht 7 Tage weiterleben.
- ETF/ETP/ETN/Fonds/leveraged/inverse/Warrants/Units/Rights/Preferreds werden fail-closed aus Radar UND BOATS-Aktienkandidaten entfernt.
- UI/Heatmap erhält nur noch verifizierte Common-Stock-Discovery-Kandidaten aus dem persistierten Deep-Scan-Batch; der rohe IEX-Bulk-Radar wird nicht mehr direkt als handelbare Kandidatenliste gerendert.
- Alte autonom entdeckte Kandidaten werden nicht unbegrenzt aus einem fehlerhaften Cache weitergetragen; außerhalb des Basiskatalogs müssen sie im aktuellen Zyklus erneut verifiziert/analysiert werden.
- Cloudflare-Cron: alle 5 Minuten erhält der Bitpanda-Kryptoscan den Worker exklusiv. Aktien-Radar/Deep-Scan und Alpaca laufen in dieser Minute nicht im selben Worker-Aufruf. Dadurch werden CPU-Spitzen reduziert, ohne BUY-/CRV-Regeln zu lockern.
- CPU-Limit-Fehler werden als eigener Provider-Status `cpu` klassifiziert.

### Unverändert sicherheitskritisch
- Discovery/BOATS/Radar haben 0 % BUY-Gewicht.
- Fehlende, stale oder schlechtere Daten dürfen Score/BUY/positiven Ton niemals verbessern.
- BUY nur bei ausreichender Qualität, Handelbarkeit und Netto-CRV > 3:1.
- Tiingo bleibt Primary; Twelve Data bleibt Fallback.

### Dokumentation
- Es gibt nur noch eine Release-Notes-Datei: `RELEASE_NOTES.md`.
