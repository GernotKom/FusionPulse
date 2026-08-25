# FusionPulse Release Notes — v3.3.0

## Schwerpunkt
Transparenz + autonomes Learning sichtbar machen, Crowd auf Trader-Communities ausrichten und die bestehende Elliott-first Architektur erhalten.

## Neu
- Header permanent fixiert; Refresh bleibt beim Scrollen erreichbar und erklärt seinen Umfang.
- Kompakter Ressourcenstatus im Header für Cloudflare/API-Stabilität; keine erfundenen Kontingentwerte.
- Sichtbarer Nacht-/Learning-Bericht mit D1-Beobachtungen, ausgewerteten Verläufen und Expansionen der letzten 24 h.
- Crowd Pulse sucht vorrangig Reddit, X und Stocktwits über Community-Suchabfragen; 0 % direktes BUY-Gewicht.
- Extended-Hours-Watch mit Pre-/After-Hours-Kandidaten und kompakter Kurve, soweit Kursdaten vorhanden sind.
- Aktien-Detailkopf: Ticker, Firmenname, Kurzbeschreibung/Fokus und primäres Listing getrennt.
- Aktienchart erweitert: 5/10/30/60/120/180/240/300 min sowie 1T/5T/1Wo/3Mo/6Mo/12Mo; längere Bereiche werden passend über Tiingo nachgeladen.
- Update-Banner wird nach bestätigtem Reload für 10 Minuten quittiert, um Reload-Schleifen zu vermeiden.

## Unverändert / Safety
- Elliott-Wellenanalyse bleibt Kern der Setup-Qualifikation.
- Radar, Market Gainer, Extended Hours und Crowd sind Discovery/Context und erzeugen kein BUY allein.
- BUY-Gates, Netto-CRV > 3:1, Freshness und Datenqualitätsregeln bleiben unverändert.
- ETF-/ETP-Ausschluss aus v3.2.8+ bleibt erhalten.

## Noch nicht produktiv implementiert
- Shooting/Short-Radar bleibt separat geplant. Vor Aktivierung braucht es eine eigenständige Short-Elliott-/Risk-Logik und Audit; keine Vermischung mit Long-BUY.
