# FusionPulse v2.5.0 Review-Punkte
1. Twelve-Data-Batchantwort sowohl für Einzel- als auch Multi-Symbol-Form validieren.
2. Sicherstellen, dass 8 Credits/min im Free-Modus nie überschritten werden (7 Aktien + gelegentlich EUR/USD).
3. Tagesverbrauch bei regulären US-Handelszeiten überschlagen und unter 800 Credits halten.
4. Keine API-Keys ins Frontend leaken; TWELVE_API_KEY nur Worker-Secret.
5. Aktien-GRÜN nur bei Score >=8 und CRV >3; weiterhin als Radar-Kandidat kennzeichnen, nicht als Auto-Order.
6. EUR-Anzeige klar als Umrechnung und nicht Tradegate kennzeichnen.
7. Stock-Fehler dürfen Krypto-Scanner nicht beeinträchtigen.
8. Mobile/Tablet-Layout für Branchenkarten prüfen.
9. Mouseover/Title-Texte auf Touch-Geräten durch Fokus/Accessible Labels ergänzen.
10. Service Worker darf /api/stocks nie cachen.
