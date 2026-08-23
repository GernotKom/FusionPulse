# FusionPulse v2.5.2

Momentum- und Einstiegszonen-Scanner für Bitpanda Fusion (EUR) plus US-Aktienradar
über Twelve Data. Läuft als PWA auf einem Cloudflare Worker. Keine Order-Automatik —
FusionPulse liefert Trade-Pläne, ausgeführt wird manuell.

## Was in v2.5.2 neu ist

| Bereich | Änderung |
|---|---|
| Aktienradar | Firmenname unter dem Ticker, größere Karte, Klartext-Einschätzung (🟢/🟡/🔴) |
| Aktienradar | Mouseover-Detailfläche mit Branche, Kurs, Score, Netto-CRV, Setup/Trend, Entry-Zone, SL, TP1/TP2, Kaufsumme in €, Gewinn brutto und netto nach KESt — jedes Feld mit Tooltip |
| Währung | USD ist die Quelle, EUR wird immer sichtbar als Umrechnung markiert (`≈ … umger.`), nie als Tradegate-Kurs ausgegeben |
| Farblogik | Intensität wächst mit der **Anzahl bestätigender Scans**; Pulsieren nur bei echter Kauf-Freigabe |
| Audio | Töne nur bei **neuer Signalstufe**, nicht bei jedem Refresh; Hauptschalter plus Einzelschalter je Coin **und** je Aktie |
| Analyse | 9 Verfahren einzeln zu-/abschaltbar; abgeschaltete Verfahren werden aus der Gewichtung entfernt statt als „negativ“ gewertet |
| Analyse | Modus „Nur Elliott-Wellen“ per Schalter oder Analysemodus |
| Anzeige | „gescannt“ und „angezeigt“ sind überall getrennt ausgewiesen |
| Themes | Light Mode entweißt: gedämpftes Off-White, kräftigere Signalfarben, stärkere Flächenfüllung |
| Quota | Twelve-Data-Kontingent aus den Headern `api-credits-used` / `api-credits-left`; ohne Header steht dort „unbekannt“, keine erfundenen Restkontingente |
| Status | Kopfzeile `Krypto ● | Aktien ● | v2.5.2` mit erklärenden Tooltips |
| Version | Eine einzige Quelle (`package.json`) → Tab-Titel, UI, Worker, Cache-Name; Mismatch-Banner „Neue FusionPulse-Version verfügbar – neu laden“ |

## Versionierung

`package.json` → `version` ist die **einzige** Wahrheit.

```bash
npm run sync-version    # schreibt die Nummer in alle Artefakte
```

Der Sync aktualisiert `src/version.js`, `public/version.js`, `public/sw.js`
(Cache-Name), `public/index.html` (`<title>`) und `wrangler.jsonc`.
`predev` und `predeploy` rufen ihn automatisch auf — ein Deployment mit
auseinanderlaufenden Versionsnummern ist damit nicht mehr möglich.

## Deployment

```bash
npm install
npx wrangler secret put FUSION_API_KEY     # Bitpanda Fusion, READ genügt
npx wrangler secret put TWELVE_API_KEY     # optional, für den Aktienradar
npx wrangler secret put APP_TOKEN          # optional, schützt /api/*
npm run deploy
```

Danach PWA neu laden. Oben muss `v2.5.2` stehen — an derselben Stelle wie im
Browser-Tab. Erscheint das Update-Banner, hat der Browser noch einen alten
Service-Worker; „Jetzt neu laden“ räumt Cache und Worker auf.

## Kontingente

* **Bitpanda Fusion** — 240 Requests/Minute. Ein Scan verbraucht 1 (Account) + 1
  (Tickers) + n (Kerzen) + bis zu 10 (Orderbuch). Orderbuch abschalten spart die
  letzten 10 Requests.
* **Twelve Data Basic/Trial** — 8 Credits/Minute, 800/Tag. FusionPulse holt
  7 Symbole je 5-Minuten-Zyklus plus gelegentlich EUR/USD: ca. 8 Credits pro
  Zyklus, rund 200 pro Handelstag.
* **Cloudflare** — der kontoweite Verbrauch ist ohne zusätzlichen CF-API-Token
  nicht auslesbar. FusionPulse zeigt deshalb keinen, sondern reagiert auf
  429- und Ressourcenfehler mit einem Hinweis.

## Sicherheit

Alle Keys liegen als Cloudflare-Secrets ausschließlich im Worker. Das Frontend
kennt sie nicht und ruft nur `/api/*` auf. Ist `APP_TOKEN` gesetzt, muss das
Token in den Einstellungen hinterlegt werden; es bleibt im `localStorage` des
Geräts.


## Änderungen v2.5.2
- Max. Kaufsumme pro Trade als harter, variabler Deckel in den Einstellungen.
- Mindest-Netto-CRV separat für Krypto und Aktien einstellbar.
- Gemeinsames Suchfeld für Coins, Aktien-Ticker und Firmennamen.
- Verständliche Meldung bei liquiditätsbedingter Reduktion der Kaufsumme.
- Heatmap mit klar getrennten, beschrifteten Kreisen, Qualitätsgröße und 120-Minuten-Bewegungsschweif.
- 120-Minuten-Signalband, Trendpfeil, BUY-Nähe und „Was hat sich geändert?“.
- Großes Fokusfenster für die aktuell interessanteste Aktie.


## v2.5.3
- Suche erweitert: geladene Coins/Aktien werden sofort gefiltert; Enter oder 🔎 lädt zusätzliche US-Aktien gezielt über Twelve Data (Ticker, plus lokale Namensauflösung für wichtige Watchlist-Titel).
- Favoriten für Coins und Aktien (☆/★), lokal im Browser gespeichert; Filter „★ Favoriten“.
- Favoriten werden in den Listen priorisiert.
- Twelve-Data-Minutenknappheit/429 erzeugt kein wiederkehrendes großes Popup mehr; der gelbe Status bleibt sichtbar. Große Warnung nur noch bei Tageslimit bzw. fast erreichtem Tageslimit.
