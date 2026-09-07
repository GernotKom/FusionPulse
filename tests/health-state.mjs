/* ══ v4.5.3 · EIN ALTER FEHLER IST KEIN AKTUELLER BEFUND ═══════════════════
   BEFUND aus dem Betrieb (07.09.2026, Sonntag 09:28 Wiener Zeit): Die
   Systemzeile stand auf ROT — „Handlungsbedarf · Datenquelle fehlerhaft ·
   Aktien (Tiingo, Fallback Twelve Data): API-Fehler — The operation was
   aborted due to timeout". Der Timeout war echt, nur eben von Freitagabend.

   Zwei Dinge trafen zusammen:
     1. `persistentApiState` wertete NUR einen alten Erfolg ab
        (`saved.state === 'ok' && age > staleAfter`). Ein alter FEHLER behielt
        seine volle Kraft, unbegrenzt lange.
     2. Bei geschlossener Boerse ueberspringt der Cron den gesamten
        Aktienblock. Es wird nichts versucht — also kann auch nichts einen
        alten Fehler ueberschreiben.

   Ergebnis: die Ampel stand ein ganzes Wochenende ohne Anlass auf Rot. Das
   ist die teuerste Sorte Fehlmeldung, weil sie das Ignorieren einuebt: beim
   naechsten echten Ausfall waere Rot schon die gewohnte Farbe.

   Geprueft wird AUSGEFUEHRT, mit steuerbarer Uhr. Ein Mustertest haette hier
   nichts gefunden — die Zeile stand ja da und war einwandfrei. */
import assert from 'node:assert/strict';
import { loadHealthState, fakeDb } from './d1-harness.mjs';

const H = loadHealthState();

/* Feste Zeitpunkte, sonst haengt das Ergebnis am Wochentag des Testlaufs. */
const SONNTAG   = Date.parse('2026-09-07T07:28:00Z');   // 09:28 Wien, Boerse zu
const MONTAG_LIVE = Date.parse('2026-09-08T18:00:00Z'); // 14:00 ET, regulaerer Handel

async function mitStand(which, state, message, ts) {
  const { db } = fakeDb({ rowsRead: 1 });
  await db.prepare('INSERT INTO fp_meta(key,value,updated_ts) VALUES(?,?,?)')
    .bind(`provider_health:${which}`, JSON.stringify({ state, message, ts }), ts).run();
  return { DB: db };
}

/* ── HS1 · Der beobachtete Fall: alter Fehler, Markt zu ─────────────────────
   Freitag 22:00 UTC ein Timeout, Sonntag 07:28 UTC die Abfrage. 57 Stunden
   dazwischen, in denen nichts abgerufen wurde. */
{
  const env = await mitStand('stocks', 'error', 'The operation was aborted due to timeout',
    Date.parse('2026-09-04T22:00:00Z'));
  const v = await H.persistentApiState(env, 'stocks', true, SONNTAG);

  assert.notEqual(v.state, 'error',
    'HS1: Ein 57 Stunden alter Timeout darf nicht als aktueller Fehler gelten — genau das stand am 07.09. zwei Tage lang in der Leiste');
  assert.equal(v.state, 'closed',
    `HS1: Bei geschlossener Boerse ist der Ruhezustand der Normalfall, nicht eine Einschraenkung (war "${v.state}")`);
  assert.equal(v.wasState, 'error',
    'HS1: Der urspruengliche Zustand darf nicht verlorengehen — sonst ist die Reifung ein Vertuschen');
  assert.match(v.message, /Markt geschlossen/,
    `HS1: Der Grund gehoert in den Text, nicht nur in die Farbe (war "${v.message}")`);
  assert.match(v.message, /timeout/i,
    'HS1: Und der alte Befund muss darin weiterhin nachlesbar sein');
  assert.match(v.message, /2,4 Tagen|2,3 Tagen/,
    `HS1: Das Alter gehoert benannt — „letzter Stand" ohne Alter ist keine Aussage (war "${v.message}")`);
}

/* ── HS2 · Derselbe alte Fehler bei OFFENEM Markt ist etwas anderes ─────────
   Wenn abgerufen werden koennte und trotzdem seit Stunden nichts ankam, ist
   das kein Ruhezustand. Dann lautet die ehrliche Aussage: unbekannt. */
{
  const env = await mitStand('stocks', 'error', 'The operation was aborted due to timeout',
    MONTAG_LIVE - 6 * 3600_000);
  const v = await H.persistentApiState(env, 'stocks', true, MONTAG_LIVE);

  assert.equal(v.state, 'stale',
    `HS2: Bei offenem Markt ist ein sechs Stunden alter Stand veraltet, nicht „geschlossen" (war "${v.state}")`);
  assert.equal(v.wasState, 'error', 'HS2: auch hier bleibt der urspruengliche Zustand erhalten');
  assert.match(v.message, /unbekannt, nicht bestaetigt/,
    'HS2: „keine neue Messung" darf sich nicht wie eine Entwarnung lesen — fehlende Information ist nicht Zustimmung');
}

/* ── HS3 · Ein FRISCHER Fehler muss weiterhin voll durchschlagen ────────────
   Die Gegenprobe. Ohne sie waere nicht belegt, dass die Reifung nur alte
   Staende betrifft — eine Regel, die auch echte Ausfaelle abmildert, waere
   schlimmer als der Fehler, den sie behebt. Ein Anbieter, der wirklich gerade
   scheitert, wird im Minutentakt neu geschrieben und bleibt damit frisch. */
{
  const env = await mitStand('stocks', 'error', 'HTTP 500', MONTAG_LIVE - 2 * 60_000);
  const v = await H.persistentApiState(env, 'stocks', true, MONTAG_LIVE);
  assert.equal(v.state, 'error',
    `HS3: Ein zwei Minuten alter Fehler MUSS rot bleiben (war "${v.state}")`);
  assert.equal(v.message, 'HTTP 500', 'HS3: und seine Meldung unveraendert durchreichen');
}

/* ── HS4 · Auch bei geschlossenem Markt bleibt ein frischer Fehler rot ──────
   Die Boerse ist zu, aber der Abruf lief trotzdem und ist gerade eben
   gescheitert — etwa der Krypto-Pfad oder ein Tageslauf am Rand des Fensters.
   „Markt zu" darf kein Freibrief werden, sonst verdeckt der Ruhezustand
   genau die Stoerungen, die am Wochenende auftreten. */
{
  const env = await mitStand('stocks', 'error', 'HTTP 500', SONNTAG - 3 * 60_000);
  const v = await H.persistentApiState(env, 'stocks', true, SONNTAG);
  assert.equal(v.state, 'error',
    `HS4: Innerhalb der Frist gilt der gemessene Zustand, unabhaengig von der Marktphase (war "${v.state}")`);
}

/* ── HS5 · Krypto kennt keine Boersenschlusszeiten ──────────────────────────
   Der Kryptomarkt laeuft durch. Ein alter Stand dort ist immer veraltet und
   nie „geschlossen" — sonst wuerde ein echter Ausfall am Sonntag gruen. */
{
  const env = await mitStand('crypto', 'error', 'Bitpanda 502', SONNTAG - 3 * 3600_000);
  const v = await H.persistentApiState(env, 'crypto', true, SONNTAG);
  assert.equal(v.state, 'stale',
    `HS5: Krypto darf nie in den Zustand „Markt geschlossen" fallen (war "${v.state}")`);
}

/* ── HS6 · Ein frischer Erfolg bleibt ein Erfolg ────────────────────────────
   Die zweite Gegenprobe, damit der Test nicht bloss immer abwertet. */
{
  const env = await mitStand('stocks', 'ok', '33 Rows', MONTAG_LIVE - 5 * 60_000);
  const v = await H.persistentApiState(env, 'stocks', true, MONTAG_LIVE);
  assert.equal(v.state, 'ok', `HS6: fuenf Minuten alt und erfolgreich bleibt gruen (war "${v.state}")`);
}

/* ── HS7 · Der Regelbruch von 4.5.2 darf nicht zurueckkehren ────────────────
   Die alte Bedingung lautete `saved.state === 'ok' && age > staleAfter`. Sie
   sah harmlos aus und war unsymmetrisch. Steht sie wieder da, faellt das hier
   auf: ein alter Fehler muesste dann seinen Zustand behalten. */
{
  for (const [zustand, wann] of [['error', SONNTAG], ['nokey', MONTAG_LIVE], ['ratelimit', MONTAG_LIVE]]) {
    const env = await mitStand('stocks', zustand, 'alt', wann - 24 * 3600_000);
    const v = await H.persistentApiState(env, 'stocks', true, wann);
    assert.notEqual(v.state, zustand,
      `HS7: Ein 24 Stunden alter Zustand "${zustand}" darf nicht unveraendert weitergemeldet werden — die Reifung muss fuer JEDEN Zustand gelten, nicht nur fuer 'ok'`);
  }
}

/* ── HS8 · Die Farbe muss auf der Client-Seite ankommen ─────────────────────
   Der Server kann `closed` melden, so oft er will — wenn die Oberflaeche den
   Zustand nicht kennt, faellt er auf „Status noch nicht verifiziert" durch und
   die Leiste steht grau statt gruen. Beim Einbau ist genau das passiert:
   `STATE_TONE` kannte `closed`, `setMiniStatus` fuehrte daneben eine ZWEITE
   Liste derselben Zustaende und kannte ihn nicht. */
{
  const { loadClient } = await import('./client-harness.mjs');
  const C = loadClient();
  assert.equal(C.STATE_TONE.closed, 'ok',
    'HS8: Der geschlossene Markt ist der Normalfall — gruen, nicht gelb und nicht grau');
  assert.ok(C.STATE_TEXT.closed,
    'HS8: … und er braucht einen lesbaren Text, sonst zeigt die Kachel den rohen Schluessel');
  /* Die Zweitwahrheit darf nicht zurueckkehren: `setMiniStatus` muss dieselbe
     Tabelle benutzen. Geprueft am Verhalten, nicht am Quelltext. */
  for (const [zustand, farbe] of Object.entries(C.STATE_TONE)) {
    if (zustand === 'busy') continue;
    C.setMiniStatus('#miniStocks', zustand, 'Test');
    const el = C.el('#miniStocks');
    /* `contains()` gibt im Pruefstand bewusst immer `false` zurueck; die
       gesetzten Klassen stehen in `_classes`. */
    assert.ok(el && el.classList._classes.has(farbe),
      `HS8: setMiniStatus muss "${zustand}" wie STATE_TONE auf "${farbe}" abbilden — zwei Listen derselben Zustaende laufen unweigerlich auseinander`);
  }
}

console.log('✓ FusionPulse v4.5.3 Reifung der Anbieter-Ampel (ausgefuehrt): OK');
