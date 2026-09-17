/* v5.1.0 · NK106 · Potenzial > 2 % ohne Chance-Risiko-Sperre.
   Die Funktionen werden aus app.js herausgeschnitten und mit Stubs
   ausgefuehrt — geprueft wird das Verhalten, nicht nur der Text. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const idx = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const a = app.indexOf('const POT_MIN_NET_EUR'), b = app.indexOf('function renderPotential(){');
assert.ok(a > 0 && b > a, 'NK106: Potenzial-Block muss gefunden werden');
const src = app.slice(a, b);

const ctx = { S: { maxTradeEur: 10000 }, stockFreshness: (r) => ({ key: r._fk || 'cached' }) };
vm.createContext(ctx);
vm.runInContext(src + ';this.potNetEur=potNetEur;this.potLossEur=potLossEur;this.potCandidates=potCandidates;', ctx);

// NK106a · Rechnung: 2,04 % auf 10.000 EUR ergibt knapp 120 EUR netto (Worker-Herleitung ECON_WIN_PCT)
assert.ok(Math.abs(ctx.potNetEur(2.04) - 120.35) < 0.01, `NK106a: 2,04 % muessen 120,35 EUR netto ergeben, war ${ctx.potNetEur(2.04)}`);
assert.ok(ctx.potNetEur(2.0) < 120, 'NK106a: 2,00 % liegen knapp unter der Schwelle');
assert.ok(Math.abs(ctx.potLossEur(1) - 138) < 0.01, 'NK106a: 1 % Stop = 100 + 23 + 15 EUR');

// NK106b · Ein Titel mit weitem Stop (CRV < 1) MUSS erscheinen — genau das ist der Zweck
const row = (sym, entry, tp2, stop, extra = {}) => ({ symbol: sym, entryUsd: entry, tp2Usd: tp2, stopUsd: stop, ...extra });
const list = [
  row('WIDE', 100, 104, 94),                          // +4 %, Stop 6 % -> CRV 0,67
  row('SMALL', 100, 101.5, 99.5),                     // +1,5 % -> unter Schwelle
  row('BIG', 100, 110, 95),                           // +10 %
  row('OLD', 100, 110, 95, { _fk: 'stale' }),         // veraltet
  row('NA', 100, 110, 95, { _fk: 'na' }),
  row('REM', 100, 110, 95, { _remembered: true }),
  row('YEST', 100, 110, 95, { currentSession: false }),
  row('BAD', 0, 110, 95),
  row('NULL', null, null, null),
];
const out = ctx.potCandidates(list).map(x => x.r.symbol);
assert.deepEqual(out, ['BIG', 'WIDE'], `NK106b: erwartet BIG, WIDE — war ${out.join(',')}`);
const wide = ctx.potCandidates(list).find(x => x.r.symbol === 'WIDE');
assert.ok(Math.abs(wide.stopPct - 6) < 1e-9 && wide.loss > 600, 'NK106c: Stop und Verlust werden als Information mitgeliefert');

// NK106d · Additiv: kein Tor darf die neue Kachel lesen
const trade = app.slice(app.indexOf('function stockTradeability(r) {'), app.indexOf('/* ==== v3.6.0 · GLOSSAR'));
assert.ok(!/potCandidates|potNetEur|POT_MIN_NET_EUR/.test(trade), 'NK106d: stockTradeability darf die Potenzial-Kachel nicht lesen');
assert.match(app, /renderPotential\(\);/, 'NK106e: die Kachel muss gerendert werden');
assert.match(idx, /id="potentialList"/, 'NK106e: der Platz im Markup muss existieren');
assert.match(app.slice(b, b + 4000), /<b>Keine<\/b> Kauf-Freigabe/, 'NK106f: die Kachel muss sagen, dass sie keine Freigabe ist');

console.log('✓ FusionPulse v5.1.0 NK106 Potenzial > 2 % ohne CRV-Sperre: OK');
