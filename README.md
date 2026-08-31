# FusionPulse v3.32.0

Autonomer Momentum- und Opportunity-Wächter für Krypto (Bitpanda Fusion) und
liquide US-Aktien, betrieben als Cloudflare Worker mit PWA-Oberfläche.

**Was die App ist:** ein Suchwerkzeug. Sie soll wenige, wirtschaftlich relevante
Kandidaten sichtbar machen — nicht möglichst viele Signale erzeugen. Eine
fehlende Kauf-Freigabe ist kein Versagen; eine Kandidatenliste ohne interessante
Titel schon.

**Was die App nicht ist:** kein Auto-Trading, keine Anlageberatung, keine
Nachrichtenquelle. Orders setzt der Nutzer selbst bei seinem Broker.

## Repository-Struktur

```
README.md          diese Datei — Installation, Deploy, Secrets, D1
HANDOVER.md        Wissensbasis: Invarianten, Befunde, Lehren, Rückstand.
                   Vor jeder Änderung vollständig lesen.
RELEASE_NOTES.md   Release-Historie, eine Datei
src/worker.js      Cloudflare Worker: Scan, Bewertung, Lernschicht, API
public/            PWA: index.html, app.js, style.css, sw.js
tests/             Regressionssuiten
scripts/           sync-version.mjs
migrations/        D1-Schema
```

Ab v3.31.0 gilt: **eine neue Version legt keine neue Markdown-Datei an.**
`HANDOVER.md` und `RELEASE_NOTES.md` werden fortgeschrieben. Vorher lagen hier
über hundert Versionsdateien plus eine vollständige Zweitkopie des Projekts.

## Entwickeln und ausliefern

```bash
npm install
npm run check      # Syntaxprüfung + 52 Prüfläufe + Service-Worker-Prüfstand
npm run dev        # wrangler dev (synchronisiert vorher die Version)
npm run deploy     # wrangler deploy (synchronisiert vorher die Version)
```

Seit v3.32.0 laufen alle Suiten mit `npm run check`. Zusätzlich:

```bash
npm run audit:reach              # sucht Bedienelemente hinter unsichtbaren Scrollbereichen
```

Bei Zeitthemen zusätzlich mit `TZ=Europe/Vienna` und `TZ=America/Chicago` fahren.

### Version

`package.json` → `version` ist die **einzige** Wahrheit.
`node scripts/sync-version.mjs` schreibt sie in `src/version.js`,
`public/version.js`, `public/sw.js`, `public/index.html` (Titel, Shell-Stempel
und die `?v=`-Parameter aller Assets), `public/style.css`
(`--fp-css-version`), `README.md` und `wrangler.jsonc`.

Die Kopfzeile der App zeigt dauerhaft beide Stände: `v3.31.0 · Worker 3.31.0`.
Weichen sie ab, wird sie gelb. **Das ist die erste Frage bei jedem gemeldeten
Anzeige- oder Scrollfehler** — vor jeder Fehlersuche im Code.

## Cloudflare-Konfiguration

### Secrets

```bash
wrangler secret put APP_TOKEN               # schützt alle /api/-Routen
wrangler secret put TIINGO_API_TOKEN        # Aktien: Radar, Quotes, Tagesbalken
wrangler secret put ALPACA_API_KEY_ID       # Premarket / Opening
wrangler secret put ALPACA_API_SECRET_KEY
wrangler secret put TWELVE_DATA_API_KEY     # Fallback: 5-Minuten-Bars
wrangler secret put SERPAPI_KEY             # optional: Crowd/Search
```

Keine Schlüssel im Frontend oder im Repository.

### Variablen

| Variable | Werte | Wirkung |
|---|---|---|
| `ALPACA_FEED` | `iex` (Vorgabe) \| `sip` | Feed für Alpaca-Live-Quotes; `sip` erfordert ein entsprechendes Abo |
| `RADAR_FEED` | `iex` (Vorgabe) \| `sip` | **Maßstab der Umsatzschwelle.** Muss mitgezogen werden, wenn der Radar je auf einen konsolidierten Feed wechselt — sonst ist das Einlassgitter faktisch aus (R11) |
| `TIINGO_STOCKS_MODE` | `primary` | Tiingo als primäre Aktienquelle |
| `SERPAPI_MONTHLY_BUDGET` | Zahl, Vorgabe 90 | hartes Monatsbudget des Crowd-Sensors |

Seit v3.32.0 hängt `MOM_MIN_DOLLARVOL` an `RADAR_FEED` statt an einer festen
Zahl. Der Umrechnungsfaktor ist **hergeleitet, nicht gemessen** — nach dem
ersten Lauf mit konsolidiertem Feed anhand von `radarGateStats`
nachkalibrieren. Siehe `HANDOVER.md`, R11.

### D1

Binding `DB` in `wrangler.jsonc`. Datenbank anlegen und Migrationen fahren:

```bash
wrangler d1 create fusionpulse
# die ausgegebene database_id in wrangler.jsonc eintragen
for f in migrations/*.sql; do wrangler d1 execute fusionpulse --remote --file "$f"; done
```

Tabellen: `snapshots` (Lernschicht), `trades` (Handelstagebuch), `fp_meta`
(Schlüssel/Wert: `stock_deep_limit`, `tiingo_quota`, `muted_setups`,
`serpapi_quota`, `crypto_fng:last`, `earnings:last`, `earnings:manual`,
`coin_live:last`). `ensureD1Schema()` zieht fehlende Spalten beim Start nach,
die Migrationsdateien bleiben trotzdem die Quelle der Wahrheit.

Modul 0 **sammelt** permanent und **bewertet** nur beim Abruf über
`/api/attribution`. Es ändert nie automatisch etwas am Score.

### Cron

`* * * * *` in `wrangler.jsonc`, im Worker gedrosselt.

## Datenquellen

| Quelle | Rolle | Einschränkung |
|---|---|---|
| Tiingo IEX | Aktien primär: Radar (~12.000 Symbole), Quotes, Tagesbalken | IEX sieht rund **2–3 %** des US-Volumens; Umsatzzahlen sind entsprechend ein Bruchteil. Die Monatsbandbreite ist der reale Engpass, nicht die Abfragezahl |
| Alpaca | Premarket / Opening / Extended Hours | Ohne `ALPACA_FEED=sip` ebenfalls nur IEX |
| Twelve Data | Fallback: 5-Minuten-Bars (`outputsize:40` ≈ 3 h 20 min) | Quartalstermine im Basis-Tarif vermutlich nicht enthalten |
| Bitpanda Fusion | Krypto | — |
| alternative.me | Krypto-Stimmung (Fear & Greed) | kein Schlüssel nötig |
| SerpAPI | Crowd/Search, optional | Freitarif ~100 Suchen **pro Monat**; ohne den Budgetwächter verbrennt ein Handelstag das Kontingent |

Die App weist die aktive Quelle und die Marktbreite seit v3.31.0 im Aktienkopf
aus. Ist die Quelle nicht bestimmbar, sagt sie das — sie rät keinen Anbieter.

## Die Regeln, an die sich jede Änderung halten muss

Ausführlich in `HANDOVER.md`. Kurz:

1. **Fail-closed.** Fehlende, veraltete oder schlechtere Daten dürfen Score,
   Freigabe, Rangfolge oder Signalton **niemals** verbessern. Was nicht bewertbar
   ist, wird ausgewiesen und nicht geschätzt.
2. **`Number(null)` ist 0, nicht NaN.** Jede Zahl von außen läuft über `posNum`
   bzw. `feld()`. `Number.isFinite` allein reicht nicht — dieser Fehler ist in
   fünf Versionen fünfmal aufgetreten.
3. **Ein `respondWith` im Service Worker darf niemals ablehnen.** Ein
   unbehandelter Fehler dort nimmt nicht eine Datei aus dem Verkehr, sondern die
   ganze Anwendung.
4. **Additive Schichten verändern keinen Score.** Attribution, Aladdin,
   Portfolio, Sentiment, Terminwarnung, Top Picks, Herkunftsanzeige: Anzeige
   oder Freigabe, nie Bewertung. Tests durchsuchen die Bewertungsfunktionen und
   fallen, wenn dort eine dieser Quellen auftaucht.
5. **Der Claude-Modus ist per SHA-256 verriegelt.** Vier Blöcke, unabhängig
   nachzurechnen — nicht dem Testlauf glauben.
6. **Jede neue Prüfung braucht eine Negativkontrolle.** Code absichtlich kaputt
   machen, Fehlschlag beobachten, zurücksetzen, Protokoll in die Release Notes.
   Ein Test, der den Fehler nicht sehen kann, ist kein Funktionsnachweis.
7. **Kein Feature still streichen.** Offene Punkte bleiben sichtbar, bis sie
   erledigt oder ausdrücklich verschoben sind.

## Haftung

FusionPulse trifft keine Anlageentscheidungen und gibt keine Anlageberatung.
Alle Kurse, Ziele, Stops und Euro-Beträge sind Schätzungen aus öffentlich
verfügbaren Daten und können falsch, veraltet oder unvollständig sein. Vor jeder
Order den tatsächlichen Kurs beim eigenen Broker prüfen.
