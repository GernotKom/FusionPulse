# FusionPulse v3.0.3 – Cloudflare D1 Setup

## Wichtig vor dem Deployment
`wrangler.jsonc` enthält absichtlich den Platzhalter `REPLACE_WITH_YOUR_D1_DATABASE_ID`.
Er muss durch die echte UUID der D1-Datenbank ersetzt werden.

## Empfohlener Datenbankname
`fusionpulse-learning`

## 1. Abhängigkeiten installieren und Cloudflare anmelden
```bash
npm install
npx wrangler login
```

## 2. Neue D1-Datenbank anlegen (nur wenn noch keine existiert)
Für EU-Jurisdiction:
```bash
npx wrangler@latest d1 create fusionpulse-learning --jurisdiction=eu
```
Die Ausgabe enthält `database_id = "..."`.

Wenn bereits eine produktive `fusionpulse-learning` existiert, KEINE neue Datenbank erstellen. Stattdessen die bestehende UUID im Cloudflare-Dashboard bzw. über `npx wrangler d1 list` ermitteln.

## 3. database_id eintragen
In `wrangler.jsonc` ersetzen:
```json
"database_id": "REPLACE_WITH_YOUR_D1_DATABASE_ID"
```
durch die echte UUID.

Binding muss `DB` bleiben, weil FusionPulse die Datenbank als `env.DB` verwendet.

## 4. Migrationen prüfen
```bash
npx wrangler d1 migrations list fusionpulse-learning --remote
```
Im Projekt liegen:
- `0001_learning.sql`
- `0002_executability.sql`

## 5. Migrationen anwenden
```bash
npx wrangler d1 migrations apply fusionpulse-learning --remote
```
Bestätigung mit `Yes`.

## 6. Schema kontrollieren
```bash
npx wrangler d1 execute fusionpulse-learning --remote --command "SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name;"
```
Dann `executability` kontrollieren:
```bash
npx wrangler d1 execute fusionpulse-learning --remote --command "PRAGMA table_info(market_snapshots);"
```
In der Ausgabe muss `executability` vorkommen.

## 7. Syntaxcheck
```bash
npm run check
```

## 8. Deployment
```bash
npm run deploy
```

## 9. Nachkontrolle
Nach Deployment `/api/health` aufrufen und kontrollieren, dass die laufende Version `3.0.3` ist und D1 erkannt wird.

## Sicherheitsregel
Bei einer bestehenden D1 mit echten Learning-Daten niemals Tabellen löschen oder `0001_learning.sql` manuell erneut per `d1 execute --file` ausführen. Die Migrationen ausschließlich über `wrangler d1 migrations ...` verwalten.
