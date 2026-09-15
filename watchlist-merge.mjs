/* ══════ v4.11.0 · Suite 68 · NK90 — WATCHLIST ÜBER MEHRERE GERAETE ═════════
   Der gemeldete Fall, als Test: Mac hat 36 Titel, Windows-PC hat einen. Ein
   Druck am Windows-PC ersetzte die 36 durch die 1.

   NK90a  Der gemeldete Fall darf sich nicht wiederholen — geprueft mit genau
          den Symbolen aus dem Screenshot.
   NK90b  Modus und Liste sind getrennt. Umschalten fasst die Liste nicht an.
   NK90c  Entfernen entfernt NUR das genannte Symbol.
   NK90d  Ein alter Client aus dem Service-Worker-Zwischenspeicher, der noch
          `{mode, symbols}` schickt, kann keinen Schaden mehr anrichten.
   NK90e  `replace` funktioniert weiterhin — sonst waere die Liste nie mehr
          aufzuraeumen, und NK90a waere auch dann gruen, wenn gar nichts geht.
   NK90f  Die Obergrenze verwirft, statt still abzuschneiden.
*/
import assert from 'node:assert/strict';
import { watchlistApply, normalizeWatchlist, WATCHLIST_MAX } from '../src/worker.js';

/* Die 36 aus dem gelben Kasten im Screenshot vom 10.09., unveraendert. */
const MAC36 = ['IONQ','MRNA','AEM','AG','AMXEF','ONTTF','CEG','RGTI','UTHR','VEEV','SDGR','ABSI',
  'PMI','PSNYW','MOH','NVDA','CRWD','PANW','DELL','LUMN','CRSP','EDIT','EBS','INTC','REGN','OXY',
  'SPOT','TSM','PLTR','FCX','IBRX','SPCX','QGEN','LITE','BWXT','AMZN'];

/* ═══ NK90a · DER GEMELDETE FALL ══════════════════════════════════════════ */
{
  const server = { mode: 'watchlist', symbols: MAC36 };
  /* Der Windows-PC kennt nur IONQ und drueckt den Knopf. Frueher hiess das
     „ersetze durch [IONQ]\". */
  const nachher = watchlistApply(server, { mode: 'radar', symbols: ['IONQ'] });
  assert.equal(nachher.symbols.length, 36,
    `der Windows-PC hat die Liste auf ${nachher.symbols.length} Titel verkuerzt`);
  for (const s of MAC36) assert.ok(nachher.symbols.includes(s), `${s} ist verschwunden`);

  /* Und der umgekehrte Fall: der Windows-PC kennt einen Titel, den der Mac
     nicht hat. Der muss ANKOMMEN — sonst waere die Zusicherung durch schlichtes
     Ignorieren erfuellt. */
  const mitNeu = watchlistApply(server, { op: 'merge', symbols: ['SOFI'] });
  assert.ok(mitNeu.symbols.includes('SOFI'), 'ein neuer Titel kommt gar nicht mehr an');
  assert.equal(mitNeu.symbols.length, 37);
}

/* ═══ NK90b · MODUS UND LISTE SIND GETRENNT ═══════════════════════════════
   Dass beides an EINEM Knopf hing, war der eigentliche Konstruktionsfehler. */
{
  const server = { mode: 'watchlist', symbols: MAC36 };
  const aus = watchlistApply(server, { op: 'mode', mode: 'radar' });
  assert.equal(aus.mode, 'radar');
  assert.deepEqual(aus.symbols, normalizeWatchlist(MAC36), 'das Umschalten hat die Liste veraendert');
  const an = watchlistApply(aus, { op: 'mode', mode: 'watchlist' });
  assert.equal(an.mode, 'watchlist');
  assert.equal(an.symbols.length, 36, 'das Zurueckschalten hat die Liste veraendert');
}

/* ═══ NK90c · ENTFERNEN TRIFFT NUR DAS GENANNTE SYMBOL ════════════════════ */
{
  const server = { mode: 'watchlist', symbols: MAC36 };
  const weg = watchlistApply(server, { op: 'remove', symbol: 'INTC' });
  assert.equal(weg.symbols.length, 35);
  assert.ok(!weg.symbols.includes('INTC'), 'INTC ist noch da');
  assert.ok(weg.symbols.includes('IONQ') && weg.symbols.includes('AMZN'), 'es wurde zu viel entfernt');

  /* Das letzte Symbol zu entfernen darf keinen Scanner hinterlassen, der
     nichts scannt. Dieselbe Regel wie in readWatchlist. */
  const leer = watchlistApply({ mode: 'watchlist', symbols: ['IONQ'] }, { op: 'remove', symbol: 'IONQ' });
  assert.equal(leer.symbols.length, 0);
  assert.equal(leer.mode, 'radar', 'Watchlist-Modus ohne Titel ist stehengeblieben');
  assert.ok(leer.grund, 'der Rueckfall auf Radar wird nicht begruendet');
}

/* ═══ NK90d · DER ALTE CLIENT AUS DEM ZWISCHENSPEICHER ════════════════════
   Eine PWA laedt nach einem Update nicht zwingend neu. Der alte Client schickt
   weiter `{mode, symbols}` und MEINT „ersetze\". Er darf trotzdem nichts
   kosten — sonst haengt die Zusicherung daran, dass jeder rechtzeitig neu
   laedt, und das ist keine Zusicherung. */
{
  const server = { mode: 'watchlist', symbols: MAC36 };
  for (const alt of [
    { mode: 'radar', symbols: ['IONQ'] },
    { mode: 'watchlist', symbols: ['IONQ'] },
    { mode: 'watchlist', symbols: [] },
    { symbols: [] },
    {},
  ]) {
    const n = watchlistApply(server, alt);
    assert.ok(n.symbols.length >= 36,
      `ein alter Client hat die Liste auf ${n.symbols.length} verkuerzt: ${JSON.stringify(alt)}`);
  }
}

/* ═══ NK90e · GEGENPROBE — AUSDRUECKLICHES ERSETZEN GEHT NOCH ═════════════
   Ohne diese Kontrolle waere NK90a auch dann gruen, wenn `watchlistApply`
   schlicht jede Aenderung verweigert. Eine Liste, die nie kleiner wird, waere
   ebenfalls kaputt — nur langsamer. */
{
  const server = { mode: 'watchlist', symbols: MAC36 };
  const neu = watchlistApply(server, { op: 'replace', symbols: ['IONQ', 'NVDA'] });
  assert.deepEqual(neu.symbols, ['IONQ', 'NVDA'], 'ausdrueckliches Ersetzen wirkt nicht');
  assert.ok(neu.grund, 'das Ersetzen wird nicht als solches benannt');
}

/* ═══ NK90f · OBERGRENZE VERWIRFT SICHTBAR ════════════════════════════════
   `slice(0,40)` haette hier still abgeschnitten. Was nicht aufgenommen wurde,
   muss benannt werden — sonst fehlt ein Titel, den man zu setzen glaubte. */
{
  const voll = Array.from({ length: WATCHLIST_MAX }, (_, i) => `SYM${i}`);
  const n = watchlistApply({ mode: 'watchlist', symbols: voll }, { op: 'merge', symbols: ['IONQ'] });
  assert.equal(n.symbols.length, WATCHLIST_MAX, 'die Obergrenze wurde ueberschritten');
  assert.ok(n.abgewiesen.includes('IONQ'), 'der verworfene Titel wird nicht genannt');
  assert.ok(/voll/i.test(n.grund || ''), 'es fehlt der Grund');
  /* Ein bereits enthaltener Titel darf an der vollen Liste NICHT scheitern. */
  const doppelt = watchlistApply({ mode: 'watchlist', symbols: voll }, { op: 'merge', symbols: ['SYM0'] });
  assert.equal(doppelt.abgewiesen.length, 0, 'ein bereits enthaltener Titel wurde abgewiesen');
}

/* ═══ NK90g · UNVERAENDERT IST UNVERAENDERT ═══════════════════════════════
   `changed` steuert, ob ueberhaupt geschrieben wird. Ein falsches `true` waere
   ein Schreibvorgang je Seitenaufruf — die Sorte Kosten, die in 3.32.9 das
   D1-Limit gerissen hat. */
{
  const server = { mode: 'watchlist', symbols: MAC36 };
  assert.equal(watchlistApply(server, { op: 'merge', symbols: ['INTC'] }).changed, false,
    'ein bereits enthaltener Titel loest einen Schreibvorgang aus');
  assert.equal(watchlistApply(server, { op: 'mode', mode: 'watchlist' }).changed, false,
    'derselbe Modus loest einen Schreibvorgang aus');
  assert.equal(watchlistApply(server, { op: 'merge', symbols: ['SOFI'] }).changed, true,
    'eine echte Aenderung wird nicht als solche erkannt');
}

console.log('✓ FusionPulse v4.11.0 NK90 Watchlist ueber mehrere Geraete (ausgefuehrt): OK');
