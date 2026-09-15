/* ══════ v4.13.0 · Suite 70 · NK92 — LISTE DER ERFASSTEN POSITIONEN ═════════
   BEFUND vom 11.09.: Die Risiko-Kachel zeigte „588 % ausgeschoepft" — und der
   Nutzer fragte, wo er das eingegeben habe. `stockPositions` wurde an genau
   zwei Stellen beruehrt (Eintragen, Aufsummieren) und an KEINER aufgelistet.

   Diese Suite fuehrt die Kachel aus. Sie prueft nicht, dass eine Regel
   dasteht, sondern dass die Namen sichtbar sind.
*/
import assert from 'node:assert/strict';
import { loadClient } from './client-harness.mjs';

const C = loadClient();
C.S.equity = 22500; C.S.portfolioRiskPct = 1;
C.stockPositions = {
  INTC: { active: true, entryEur: 91.12, qty: 70, restQty: 70, openedTs: Date.parse('2026-09-01T10:00:00Z') },
  IONQ: { active: true, entryEur: 42.50, qty: 30, restQty: 30, openedTs: Date.parse('2026-09-03T10:00:00Z') },
};
C.renderPortfolioRisk();
const html = C.el('#portfolioRisk').innerHTML;
const sichtbar = html.replace(/\s(?:title)="[^"]*"/g, '').replace(/<[^>]*>/g, ' ');

/* ═══ NK92a · DIE NAMEN STEHEN DA ════════════════════════════════════════
   Der Kern des Befunds. Eine Prozentzahl ohne Namen ist nicht aufraeumbar. */
for (const sym of ['INTC', 'IONQ']) {
  assert.match(sichtbar, new RegExp(sym), `${sym} steht nicht in der SICHTBAREN Kachel`);
}

/* ═══ NK92b · STUECKZAHL UND KAUFKURS STEHEN DABEI ═══════════════════════
   Ohne sie kann niemand entscheiden, ob ein Eintrag noch stimmt. */
assert.match(sichtbar, /70\s*Stk/, 'die Stueckzahl fehlt');
assert.match(sichtbar, /30\s*Stk/, 'die Stueckzahl der zweiten Position fehlt');

/* ═══ NK92c · JEDE ZEILE HAT EINEN AUSTRAGE-KNOPF ════════════════════════ */
const knoepfe = [...html.matchAll(/data-closepos="([^"]+)"/g)].map((m) => m[1]);
assert.equal(knoepfe.length, 2, `${knoepfe.length} Knoepfe fuer 2 Positionen`);
assert.deepEqual(knoepfe.slice().sort(), ['INTC', 'IONQ']);

/* ═══ NK92d · NICHT BEWERTBARE POSITIONEN VERSCHWINDEN NICHT ═════════════
   Ist der Titel nicht geladen, liefert `positionRiskEur` `known:false`; die
   Position faellt aus der Risikosumme. Genau DIESE Eintraege muessen in der
   Liste stehen — eine Aufraeumliste, die die Problemfaelle verschweigt, waere
   keine. Ohne geladene `stockRows` sind hier beide unbewertbar. */
assert.match(sichtbar, /nicht bewertbar/, 'unbewertbare Positionen werden verschwiegen');
const px = C.portfolioExposure();
assert.equal(px.items.length, 2, 'die Kachel kennt nicht beide Positionen');
assert.equal(px.unknownCount, 2, 'die Unbewertbarkeit wird nicht gezaehlt');

/* ═══ NK92e · LEERZUSTAND MIT GRUND, NIE EINE LEERE FLAECHE ══════════════ */
{
  C.stockPositions = {};
  C.renderPortfolioRisk();
  const leer = C.el('#portfolioRisk').innerHTML.replace(/<[^>]*>/g, ' ');
  assert.ok(!/data-closepos/.test(C.el('#portfolioRisk').innerHTML), 'Knoepfe ohne Positionen');
  assert.match(leer, /Noch keine aktive Position/, 'der Leerzustand wird nicht benannt');
}

/* ═══ NK92f · DIE LISTE SAGT, DASS SIE LOKAL IST ═════════════════════════
   Dieselbe Falle wie bei den Sternen vor v4.11.0: was nur im Browser liegt,
   muss das dranstehen haben — sonst sucht man den Eintrag auf dem anderen
   Rechner. */
{
  C.stockPositions = { INTC: { active: true, entryEur: 91.12, qty: 70, restQty: 70 } };
  C.renderPortfolioRisk();
  const h = C.el('#portfolioRisk').innerHTML.replace(/\s(?:title)="[^"]*"/g, '').replace(/<[^>]*>/g, ' ');
  assert.match(h, /lokal auf diesem Gerät/i, 'die Liste verschweigt, dass sie nur lokal existiert');
}

console.log('✓ FusionPulse v4.13.0 NK92 Positionsliste (ausgefuehrt): OK');
