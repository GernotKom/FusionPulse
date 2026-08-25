# FusionPulse – Übergabe für neuen Chat · v3.5.3

## Arbeitsbasis
- Release: `FusionPulse_v3.5.3`
- Basis: v3.5.2 + externer Claude-Audit zu den Punkten A/B
- Claude-Modus: methodisch gesperrt; Aktien/Krypto sowie Client-Konstanten/Overlay bleiben SHA-256-identisch zur geschützten Basis.
- Normaler FusionPulse-Aktienmodus: darf weiter verbessert werden, aber nur mit mathematisch erreichbaren Gates, fail-closed Datenregeln und Regressionstests.

## Externer Audit – bestätigte Punkte
Claude bestätigte für v3.5.2: Claude-Locks echt, Elliott-Fund korrekt, Deep-Scan/Tiingo intakt. Zwei neue Probleme wurden reproduziert:

A) Das Strukturziel hing zu stark am kurzen 12-Bar-`priorHigh`. Bei starken laufenden Breakouts konnte `priorHigh <= entry` werden und damit der Zielraum verschwinden.

B) Die wirtschaftliche Schwelle (75 EUR plus 1,25 % Notional) war bei Default 5.000 EUR Equity / 0,75 % Risiko deutlich strenger als die sichtbare 3:1-Struktur-CRV-Grenze und konnte faktisch etwa 6R erzwingen.

## In v3.5.3 umgesetzt
### A – Strukturziel entkoppelt
- Eigenständiges 36-Bar-Swingfenster für Zielreferenz.
- Letzte 4 Bars werden aus der Referenz ausgeblendet, damit der aktuelle Ausbruch nicht sein eigenes Swinghoch verschiebt.
- Referenzhoch ist das belastbar höhere aus 36-Bar-Swinghoch und kurzem priorHigh.
- Breakout/Squeeze projiziert die gemessene Range/Impulsbreite.
- Ist die erste Projektion bereits überschritten, wird die nächste 1,618-Erweiterung verwendet.
- Ziel bleibt auf maximal 8R begrenzt.
- Reclaim/Pullback verwendet weiterhin primär reale Swingstruktur; kein künstliches Ziel nur zur CRV-Rettung.

### B – wirtschaftliches Gate kalibriert
- Absolute Basis: 20 EUR.
- Standardkalibrierung: 0,75 × reales Risikobudget.
- Effektive Schwelle maximal 1,0 × Risikobudget, damit ein Nutzerwert nicht still ein wesentlich höheres Struktur-CRV erzwingt als die UI ausweist.
- Alter 75-EUR-Default wird auf 30 EUR migriert.
- Notional-Prozent-Gate 1,25 % ist entfernt.
- UI zeigt die risikobudget-basierte Schwelle transparent an.

## Was NICHT verändert wurde
- Claude-Aktienmethodik.
- Claude-Kryptomethodik.
- Claude-Client-Konstanten / Overlay.
- Fail-closed: stale/fehlende/schlechtere Daten dürfen kein Setup verbessern.
- Large-Cap-Discovery, Tiingo-Kontingent, Deep-Scan-Regler.
- Claude EV-/CRV-/Struktur-Logik.

## Tests
Finaler Stand:
- `FusionPulse safety regressions: OK`
- `FusionPulse v3.5.1 deep-scan/quota regressions: OK`
- `FusionPulse v3.5.3 adaptive/target/economic regressions: OK`

Neue Regressionen prüfen insbesondere:
- 36-Bar-Zielfenster ist vom 12-Bar-Trigger entkoppelt.
- Breakout erhält auch nach Überschreiten des kurzen priorHigh weiter Strukturzielraum.
- Wirtschaftliche Mindestschwelle skaliert am Risikobudget und ist gedeckelt.
- Claude-SHA-Hashes bleiben unverändert.

## Offene verbindliche VL
1. Aktive Position im FokusScope: tatsächlichen Kaufkurs in EUR/Tradegate + Stückzahl eingeben; SL/TP1/TP2, Verlust/Gewinn, CRV und Kapital sofort auf reale Ausführung umrechnen.
2. Verkaufsalarm: TON + auffällige persistente Grafik bei SL-Gefahr/SL, TP1, TP2 oder echtem strukturellem Exit; Bestätigung erforderlich.
3. Positionsmanagement nach TP1: Teilverkauf und Reststückzahl.
4. Stop-Logik nur im normalen FusionPulse-Modus prüfen: Swing-Low + ATR-/Volatilitäts-/Spread-Puffer statt nacktem Swing-Low; Claude-Modus nicht verändern.
5. Weitere kumulative VL-Punkte stehen in `IMPROVEMENT_LIST.md` und dürfen nicht verloren gehen.

## Smoke-Test nach Deploy
1. Sichtbare Version überall 3.5.3.
2. Claude-Modus ein/aus: keine methodische Änderung; Tests bleiben grün.
3. In FusionPulse bei frischem Breakout prüfen, dass kein Blocker `kein belastbarer Struktur-Zielraum` nur wegen bereits überschrittenem kurzem Hoch erscheint.
4. BUY-Hinweis muss die risikobudget-kalibrierte Netto-Schwelle nennen.
5. Stale/fehlendes Volumen weiterhin niemals Grün.
6. Opening/Radar/FokusScope Freshness weiter beobachten.

## Starttext für neuen Chat
> Wir entwickeln FusionPulse weiter. Arbeitsbasis ist `FusionPulse_v3.5.3.zip` plus das Übergabeprotokoll. Lies zuerst `HANDOVER_NEW_CHAT_v3.5.3.md`, `IMPROVEMENT_LIST.md` und `RELEASE_NOTES.md`, dann führe `npm run check` aus. Der Claude-Modus darf methodisch nicht verändert werden; seine SHA-Locks müssen grün bleiben. Der normale FusionPulse-Modus darf verbessert werden, aber nur mit mathematisch erreichbaren Gates, fail-closed Verhalten und Regressionstests. Die VL ist kumulativ und darf nicht verkürzt oder aufgeschoben werden.
