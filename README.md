# FusionPulse v2.4.0

## v2.4.0 – Alert-/Erklärungs-UX

- Grün/Gelb/Rot erhalten abgestufte Intensität aus **Dauer × Signalqualität**.
- **Pulsierendes Grün** ist exklusiv für eine konkrete Kauf-Freigabe reserviert (grünes Setup + Preis in Einstiegszone + Mindest-Netto-CRV).
- Haupt-Tonschalter oben sowie **Einzel-Stummschaltung pro Coin**; Einzelzustände werden lokal gespeichert.
- Akustische Schwellenalarme bleiben aktiv (CRV > 7,6 und höherer Alarm ab 8,0), sofern Hauptton und Coin-Ton aktiv sind.
- Mouseover-Hilfen für Marktregime/VWAP, Setup, Reife, Zonenlage, Netto-CRV, Kaufsumme, Q/H, Kosten und Slippage.
- Einstellungszahnrad wieder ganz rechts in der oberen Leiste.
- Positive Kennzahlen dezent grün, abwartende gelb und negative rot hinterlegt.


## v2.3.0 – Klarheits-/Limits-Update
- Drei Farbschemata: Dunkel, Hell, Hell/Warm.
- Analysemodus umschaltbar: Kombiniert, Elliott-Heuristik, Momentum+Volumen, Trend+VWAP/EMA, Orderbuch+Liquidität.
- Elliott ist bewusst als regelbasierte Heuristik gekennzeichnet, nicht als objektive Wellenzählung.
- Akustische CRV-Eskalation: >7,6 eigener Ton; ab 8,0 höherer Ton; globaler Ton-Schalter bleibt erhalten.
- Mouseover-Tradepreview mit Einsatz, Entry, Stop, TP1/TP2, CRV und geschätztem Gewinn nach konfigurierbarer Steuer.
- Steuerwert ist eine lokale Schätzung und standardmäßig 27,5 %, frei änderbar; keine Steuerberatung.
- Versionsstände in package.json, wrangler.jsonc und Service-Worker-Cache auf 2.2.0/2.2 angehoben.

## GH oder CF – was wird wo geändert?
**GH (GitHub)** ist die Quelle des Programmcodes. Änderungen an `src/worker.js`, `public/app.js`, `public/style.css`, `public/index.html`, `public/sw.js`, `package.json` und `wrangler.jsonc` zuerst in GH hochladen/committen.

**CF (Cloudflare)** führt den Worker aus und liefert die PWA aus. `FUSION_API_KEY` und `APP_TOKEN` bleiben ausschließlich als CF-Secrets. Bei einem mit GH verbundenen Worker löst ein Commit auf `main` normalerweise ein Deployment aus; sonst in CF unter Bereitstellungen die neue GH-Version deployen/befördern. Secrets niemals in GH eintragen.

Scanner für Momentum, Einstiegszonen und Ausführbarkeit auf Bitpanda Fusion (EUR-Paare).
Cloudflare Worker als API-Proxy + PWA-Frontend. Der API-Key verlässt den Server nie.

## Was sich gegenüber v1 geändert hat

**Kritische Fehler behoben**
| Problem | Wirkung | Lösung |
|---|---|---|
| `index.html` lud `/static/app.js`, Assets liegen aber unter `/` | weiße Seite, App war nicht lauffähig | Pfade korrigiert |
| `manifest` ohne Icons | Chrome zeigte kein "App installieren" | 192/512/maskable erzeugt |
| ~70 Subrequests pro Scan | Free-Plan-Limit ist 50 → harter Fehler | Budget auf ~32 gesenkt |
| Alle 15 s × 70 Requests = 280/min | Fusion Market-Data-Limit ist 240/min → 429 | Serverseitiger Cache + Single-Flight |
| Neuer `AudioContext` pro Beep | Browser deckelt bei ~6 → Ton fällt aus | ein wiederverwendeter Context |
| Service Worker cachte `/api/*` | veraltete Kurse offline ausgeliefert | API vom Cache ausgenommen |
| Kein Overlap-Schutz beim Polling | Scans stapelten sich | `AbortController` + Lock |
| Signale auf der laufenden Kerze | Repainting: Signale erschienen und verschwanden | Auswertung nur auf geschlossenen Bars |

**Logik**
- Multi-Timeframe (5m/15m/1h) aus *einem* Request durch Resampling
- Momentum und Volumen als z-Scores, ATR-normiert → Coins sind vergleichbar
- Wilder-ATR statt naivem True-Range-Mittel
- Volumen-Baseline überlappungsfrei (v1 verglich 12 Bars gegen ein Fenster, das dieselben 12 enthielt)
- Kurzer VWAP (24 Bars) als Zonenanker, langer (78) als Regimefilter
- Orderbuch-Tiefe wird ausgewertet: Imbalance, Kauf-/Verkaufskapazität bis 0,15 % Slippage
- Echte Gebührenstufe über `/v1/account`, Kosten = 2× Fee + Spread + Slippage
- Stop ATR- und kostenbasiert (kein fixer Prozentwert), Ziele an Struktur
- Marktbreite (% über VWAP) als globaler Risk-On/Risk-Off-Filter
- `blockers`: jede Kachel erklärt, *warum* sie nicht grün ist

**Dashboard (v2.1)**

Drei Ebenen statt eines Rasters aus 20 gleichwertigen Kacheln:

1. **Fokus-Panel** — das eine Setup, um das es gerade geht, bewusst groß.
   Enthält die *Preisleiter*: Stop, Einstiegszone, TP1, TP2 und der aktuelle
   Preis als wandernder Marker auf einer vertikalen Achse. Ablesbar ohne
   eine einzige Zahl zu vergleichen. Order-Plan mit einem Tap kopierbar.
2. **2D-Karte** — Setup-Qualität (y) gegen Handelbarkeit (x). Position
   kodiert Bedeutung, das Auge lernt auf oben-rechts zu schauen. Macht den
   Quadranten *gutes Setup, schlechte Ausführbarkeit* sichtbar: dort wartet
   man auf Spread-Verengung, statt das Setup zu verwerfen.
3. **Dichte Liste** — ausgerichtete Spalten mit Sparkline, Reifezeit und
   Zonenlage-Balken. Rote Zeilen sind eingeklappt.

Weiter:
- **Reifezeit**: wie lange hält ein Zustand schon? Kompression seit drei
  Stunden ist eine gespannte Feder, Kompression seit zehn Minuten ist Rauschen.
- **Zonenlage-Balken**: unter / in / über der Zone auf einen Blick
- Positionsgröße aus Equity × Risiko %, gedeckelt auf die Orderbuchtiefe
- Aktions-Dock unten, auf dem Tablet immer mit dem Daumen erreichbar
- Countdown bis Schluss der 5m-Kerze
- Diff-Rendering statt `innerHTML`-Neuaufbau
- Alarme mit Hysterese (2 Scans) und 90-s-Cooldown
- Hotkeys (j/k blättern, c kopieren, d Details, p anheften), Wake Lock
- Journal loggt den vollständigen Faktorvektor → nach ~50 Trades per
  Regression auswertbar, welche Faktoren bei *dir* mit Gewinnen korrelieren

## v2.3.0 – Klarheit und Limits
- „Größe“ heißt jetzt **Kaufsumme**; Fokus-Panel zeigt Kaufsumme, Entry, Stop-Loss, TP1 Teilverkauf 1 und TP2 Restverkauf explizit.
- Erklärungen per Mouseover/Tooltip für zentrale Kennzahlen.
- Einstellbare Zahl sichtbarer Coins und vorbereitete Zahl sichtbarer Aktien.
- Helle Themes deutlich abgedunkelt, damit Ampelfarben unterscheidbar bleiben.
- Aktienradar-Sektion nach Branchen vorbereitet; sie zeigt bewusst keine Fake-Daten, bis eine separate US-Aktien-Datenquelle angebunden ist.
- Cloudflare-Free-Limit-Popup bei 429/Ressourcenfehlern; „API-Unterabfragen“ wird ausdrücklich von Cloudflare-Worker-Aufrufen unterschieden.
- v2.3.0 hatte APP_VERSION/Package/Service-Worker konsistent gesetzt; die aktuelle v2.4.0 übernimmt dies und enthält weiterhin keine unsupported `limits`-Sektion in wrangler.jsonc.

## Deployment

1. Ordner in ein GitHub-Repo laden.
2. Cloudflare → Workers & Pages → Create application → Import repository → Deploy.
3. Settings → Variables and Secrets:
   - `FUSION_API_KEY` = Fusion-Key, **nur Read**
   - `APP_TOKEN` = frei gewähltes Passwort (sonst kann jeder mit der URL deine Rate-Limits verbrauchen)
4. Redeploy, `*.workers.dev` am Tablet öffnen, Token in ⚙ eintragen, "App installieren".

`GET /api/health` zeigt Konfiguration und Cache-Alter.

## Grenzen des Free Plans

50 externe Subrequests und 10 ms CPU pro Invocation. Der Scan liegt bei ~32 Subrequests
und ~15–40 ms CPU — je nach Paarzahl kann das über 10 ms gehen. Wenn im Log
`exceededResources` auftaucht: Tiefen-Scan in ⚙ reduzieren oder auf Workers Paid (5 $/Monat).
Auf `*.workers.dev` ist die Cache-API eingeschränkt; der In-Memory-Cache greift trotzdem.
Für einen Cache über Isolate-Grenzen hinweg optional ein KV-Namespace als `SNAP` binden.

## Getestet

- Worker gegen gemockte Fusion-API: 32 Subrequests, Cache greift, Single-Flight
  hält 5 parallele Anfragen zusammen, Auth gibt 401/200
- Analyse gegen konstruierte Szenarien (Pullback, Squeeze, Flush, Parabolik,
  Seitwärts) — auf reinem Random Walk entstehen **keine** grünen Signale
- Frontend headless via jsdom: Rendering, Koordinaten aller SVG-Elemente,
  Klick, Hotkeys, Filter, Modal, Diff-Rendering

Ein Pixel-Render-Test war in der Sandbox nicht möglich. Layout auf dem
Zielgerät gegenprüfen.

## Hinweis

Kein Auto-Trading. Der Worker hat ausschließlich Lesezugriff und platziert keine Orders.
