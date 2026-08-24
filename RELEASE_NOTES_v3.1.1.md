# FusionPulse v3.1.1 — Audit-Hardening + Opportunity Watch

- Claude-OPUS P0/P1-Sicherheitsbefunde umgesetzt: unbekanntes Orderbuch, fehlendes Pre/Post-Volumen, stale Signalton und BTC-Detail-null.
- Aktien-Freshness auf UTC und zeitlich begrenzte Live-Markierung korrigiert.
- Twin-Learning: keine globale Sektor-Fallback-Stichprobe; mindestens 3 h Abstand für D1-Twins; lokaler Twin-Pool auf Symbol/Sektor begrenzt.
- Crowd: alte Werte werden vor Abruf entfernt und nach 60 min als n.v. behandelt.
- Tiingo BOATS: Batch-Endpoint für >5 Symbole, Cap 25. BUY-Einfluss weiterhin 0 %.
- NYSE-Feiertags-Gate verhindert Aktien-BUY/Signal auf geschlossenen US-Handelstagen.
- Opportunity Watch: positiver Aktienhinweis nur bei Live-Daten, Score >=8, Netto-CRV >= Mindestwert, TP2-Weg >= Mindestwert und realistischem Netto-Planertrag >= 250 EUR bei konfigurierter Positionsgröße. Premarket darf Opportunity melden, BUY bleibt Opening/Regular vorbehalten.
- UI: Signalbanner/Dock sauber gestapelt, Crowd-/Freshness-Anzeige gehärtet, Sparkline- und null-sichere Detaildarstellung.

Keine Trading-Schwellenwerte wurden gelockert. Fehlende Daten dürfen keinen Score/BUY/Ton verbessern.
