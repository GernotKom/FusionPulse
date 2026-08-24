# FusionPulse v3.1.2

## Sicherheits- und Infrastruktur-Optimierung
- Twelve-Data-Tagesverbrauch wird über D1/fp_meta worker-/isolate-übergreifend atomar gespiegelt.
- Aktienbatch wird zusätzlich in D1 warmgecacht, damit Cron und mehrere PWA-Clients denselben Minutenbatch nicht unnötig erneut abrufen.
- Learning-Persistenz `d1StoreRows()` gebündelt: Outcomes in einer Sammelabfrage, Crowd-Scores in einer Sammelabfrage, Inserts/Events in D1-Batches statt hunderten sequenziellen Round-Trips.
- Ohne belastbares Aktienvolumen bleibt der Score maximal im Beobachtungsbereich; BUY ist gesperrt und Executability bleibt `n.v.`.
- Automatische Safety-Regressionstests für fehlendes Orderbuch, fehlendes Volumen und zentrale Frontend-Gates. `npm run check` führt sie mit aus.

## UI / VL
- Aktienkurse werden überall primär in EUR gezeigt; der originale USD-Kurs steht unmittelbar in Klammern daneben, z. B. `€ 114,58 ($ 133,76)`.
- Gilt für Kurs, Entry, Stop, TP1, TP2, Entry-Zonen, Karten und rechte Preisleiter.

## Versionierung
- Einheitlich `3.1.2` in package.json, Worker, PWA, Service Worker, HTML und Wrangler.
