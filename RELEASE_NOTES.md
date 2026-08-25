# FusionPulse v3.3.9

Patch auf Basis v3.3.8.

- Aktien-Fokus: Netto-CRV als eigene, deutlich sichtbare Kennzahl; bei Unterschreitung der Mindestgrenze mit „zu niedrig“ markiert.
- Netto-CRV-Mouseover laienverständlich erweitert (Nettogewinn/Risiko nach Kosten, Spread, Slippage).
- Strukturpotenzial-Mouseover präzisiert: technisch plausibler Zielraum, kein erwarteter Gewinn und kein eigenständiges BUY-Signal.
- Unternehmensfokus im Fokusfenster erweitert; bei nicht verifiziertem Lead Program/Candidate wird dies ausdrücklich angezeigt statt Angaben zu erfinden.
- Versionsreferenzen auf 3.3.9 synchronisiert.

### P0 Hotfix – Radar-Fokus eindeutig
- Klick auf Whole-Market Radar / Opening Momentum / Extended Hours bindet das Fokusfenster jetzt strikt an den angeklickten Ticker.
- Das Fokusfenster fällt nicht mehr auf den ersten sichtbaren Listentitel (z. B. PMI) zurück, wenn der angeklickte Titel außerhalb des aktuellen Listen-Slices liegt.
- API-Antworten mit abweichendem Ticker werden fail-closed als Ticker-Mismatch verworfen statt die falsche Aktie anzuzeigen.
