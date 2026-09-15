/* ══ v4.3.6 · JEDE AUFGERUFENE FUNKTION IM WORKER MUSS ES AUCH GEBEN ═══════
   Anlass: In `/api/watchlist` stand `if(req.method==='POST')`. Der Handler
   heisst `request`. Jeder POST warf damit `ReferenceError: req is not
   defined` — gefangen vom catch darunter und gemeldet als `reason:'unknown'`
   mit dem nichtssagenden Satz „Der Modus konnte nicht gespeichert werden."

   DAS WAR DER GRUND, WARUM DER WATCHLIST-MODUS SEIT v4.1.0 NIE FUNKTIONIERT
   HAT. Ein Wort. Sichtbar wurde es erst, als v4.3.0 bei `unknown` die
   tatsaechliche Meldung durchreichte statt des Ersatztextes — und in der
   Zwischenzeit wurden Bandbreite, Kadenz, Rotation, Marktphase und
   Schreiblimit verdaechtigt und einzeln widerlegt.

   Dieselbe Verwechslung stand in /api/coinwatch, dort von mir in 4.2.4 beim
   Abschreiben des Musters uebernommen. Zwei Vorkommen, ein Tippfehler,
   monatelang unentdeckt: `node --check` prueft nur Syntax, und ein Aufruf
   eines nicht existierenden Namens ist syntaktisch einwandfrei.

   Das Gegenstueck fuer `public/app.js` gibt es seit 4.3.1. Beide benutzen
   denselben Zerleger aus `symbol-check.mjs` — zwei Kopien waeren genau die
   Zweitwahrheit, an der diese Codebasis in dieser Serie neunmal gescheitert
   ist. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { undefinedCalls, undefinedReads, stripCode, SHARED_GLOBALS } from './symbol-check.mjs';

const raw = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');

/* Laufzeitumgebung: Cloudflare Workers. Kein window, kein document. */
const WORKER_GLOBALS = new Set([...SHARED_GLOBALS,
  'caches', 'addEventListener', 'globalThis', 'navigator', 'WebSocketPair', 'HTMLRewriter',
  'DOMException', 'EventTarget', 'CustomEvent', 'Event', 'ExecutionContext', 'ArrayBuffer', 'Uint8Array',
  /* `this` ist eine Bindung, kein Name — sonst meldet die Lesepruefung die
     eine Stelle, an der der D1-Mantel `this.__inner` durchreicht. */
  'this']);

const liste = undefinedCalls(raw, WORKER_GLOBALS);
assert.deepEqual(liste, [],
  'v4.3.6: In src/worker.js werden Namen aufgerufen, die es dort nicht gibt:\n  '
  + liste.join('\n  ')
  + '\n  Das faellt erst zur Laufzeit auf — bei einer Route im Browser des Nutzers, '
  + 'bei einem Cron-Lauf ueberhaupt nicht.');

/* ══ v4.5.2 · DER WAECHTER LIEF AM EIGENEN ANLASSFALL VORBEI ═══════════════
   Diese Datei prueft seit 4.3.6 ausschliesslich mit `undefinedCalls` — und
   die Gegenprobe darunter ist seither ROT. Nicht aufgefallen, weil
   `worker-symbols.mjs` in `npm run check` gar nicht aufgerufen wird.

   Der Grund steht im Kommentar von `undefinedReads` ausbuchstabiert:
   `req.method` ist KEIN Aufruf eines unbekannten Namens. `method` steht
   hinter einem Punkt und wird uebersprungen, `req` selbst wird nur GELESEN.
   `undefinedReads` wurde in 4.3.6 genau dafuer geschrieben — und danach von
   keiner einzigen Suite benutzt. Gebaut, begruendet, nie eingeschaltet;
   dasselbe Muster wie bei den D1-Kennzahlen, nur eine Etage tiefer.

   Ab hier laufen beide Pruefungen, und die Gegenprobe geht gegen die, die
   den Fehler tatsaechlich sehen kann. */
const gelesen = undefinedReads(raw, WORKER_GLOBALS);
assert.deepEqual(gelesen, [],
  'v4.5.2: In src/worker.js wird auf Eigenschaften von Namen zugegriffen, die es dort nicht gibt:\n  '
  + gelesen.join('\n  ')
  + '\n  Genau diese Klasse war `req is not defined` in /api/watchlist.');

/* ══ v4.5.2 · WARUM DIE GEGENPROBE NICHT ZU RETTEN WAR, WIE SIE DASTAND ═════
   Die alte Gegenprobe baute `req.json()` wieder ein und verlangte, dass die
   Pruefung rot wird. Sie wurde es nie — und der Grund ist nicht ein Loch im
   Waechter, sondern ein Denkfehler in seiner Anlage:

     `req` IST in src/worker.js definiert. Zeile 7226, `function authed(req,
     url, env)`, und noch einmal in `authHint`. Der historische Fehler war
     also nie „diesen Namen gibt es nicht", sondern „diesen Namen gibt es
     hier nicht". Das ist eine Frage des GUELTIGKEITSBEREICHS, und ein
     dateiweiter Namensvergleich kann sie grundsaetzlich nicht beantworten —
     gleichgueltig, ob man ihn mit `undefinedCalls` oder `undefinedReads`
     fuehrt.

   Die Gegenprobe hat damit von Anfang an etwas verlangt, was die Pruefung
   nicht leisten kann. Sie war rot, seit es sie gibt, und niemand hat es
   gesehen, weil `worker-symbols.mjs` in `npm run check` nicht vorkommt.

   Statt sie stillzulegen wird sie hier auf eine Pruefung gedreht, die den
   Fehler wirklich sehen kann: der Rumpf des fetch-Handlers wird
   herausgeschnitten und darin nach `req` gesucht. Der Handler-Parameter
   heisst `request`; ein `req` darin ist immer der Tippfehler von 4.1.0.
   Eng, nachweislich wirksam, und die Gegenprobe darunter belegt es. */
function rumpfVon(text, signatur) {
  const at = text.indexOf(signatur);
  if (at < 0) return null;
  const i = text.indexOf('{', at);
  let tiefe = 0;
  for (let j = i; j < text.length; j++) {
    if (text[j] === '{') tiefe++;
    else if (text[j] === '}') { tiefe--; if (tiefe === 0) return text.slice(i, j + 1); }
  }
  return null;
}
/* BEIDE Methoden, nicht nur `fetch`. Der erste Anlauf schnitt nur `fetch`
   heraus — der ist ein duenner Mantel von 946 Zeichen, der sofort an
   `this.handle(...)` weiterreicht. Saemtliche Routen, und damit auch die
   beiden historischen Tippfehler in /api/watchlist und /api/coinwatch, liegen
   in `handle`. Ein Schnitt, der die fragliche Stelle gar nicht enthaelt,
   waere ein weiterer gruener Haken ohne Deckung. */
const HANDLER = ['async fetch(request, env, ctx)', 'async handle(request, env, ctx, url)'];

const reqImRumpf = (text) => HANDLER.flatMap((sig) => {
  const r = rumpfVon(text, sig);
  return r ? [...r.matchAll(/(?<![.\w$])req\s*[.[]/g)].map(() => sig) : [];
});
{
  for (const sig of HANDLER) {
    const r = rumpfVon(stripCode(raw), sig);
    assert.ok(r && r.length > 500,
      `v4.5.2: \`${sig}\` muss auffindbar sein, sonst prueft der Schnitt ins Leere`);
  }
  const treffer = reqImRumpf(stripCode(raw));
  assert.deepEqual(treffer, [],
    `v4.5.2: In den Routen steht \`req\` — der Parameter heisst \`request\`. `
    + 'Genau dieser Tippfehler hat den Watchlist-Modus von v4.1.0 bis v4.3.6 lahmgelegt, '
    + 'gefangen vom catch darunter und gemeldet als nichtssagendes `unknown`.');

  /* Gegenprobe: der historische Fehler MUSS gefunden werden. Ohne sie waere
     nicht belegt, dass die Pruefung ueberhaupt etwas sieht. */
  const kaputt = raw.replace("if(request.method==='POST'){\n          const body=await request.json()",
                             "if(req.method==='POST'){\n          const body=await req.json()");
  assert.notEqual(kaputt, raw, 'v4.3.6: Der Ankertext fuer die Gegenprobe muss existieren');
  assert.ok(reqImRumpf(stripCode(kaputt)).length > 0,
    'v4.3.6: Der historische Fehler `req.json()` MUSS von dieser Pruefung gefunden werden — sonst prueft sie nichts');

  /* Und der Nachweis, WARUM es diesen Schnitt braucht: die beiden dateiweiten
     Pruefungen sehen denselben Fehler nicht, weil `req` als Parameter von
     `authed()` existiert. Steht das nicht fest, wird dieser Block beim
     naechsten Aufraeumen als Dopplung entfernt. */
  assert.equal(undefinedCalls(kaputt, WORKER_GLOBALS).length, 0,
    'v4.5.2: Ein dateiweiter Namensvergleich kann diese Klasse nicht sehen — das ist der Grund fuer den Schnitt');
  assert.equal(undefinedReads(kaputt, WORKER_GLOBALS).length, 0,
    'v4.5.2: Auch die Lesepruefung nicht — `req` ist in dieser Datei definiert, nur nicht an dieser Stelle');
}

assert.match(raw, /async fetch\(request, env, ctx\)/,
  'v4.3.6: Der Fetch-Handler heisst `request` — Routen muessen diesen Namen benutzen');

console.log('✓ FusionPulse v4.3.6 Alle aufgerufenen Namen im Worker existieren (ausgefuehrt): OK');
