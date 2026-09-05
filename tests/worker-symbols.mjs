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
import { undefinedCalls, SHARED_GLOBALS } from './symbol-check.mjs';

const raw = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');

/* Laufzeitumgebung: Cloudflare Workers. Kein window, kein document. */
const WORKER_GLOBALS = new Set([...SHARED_GLOBALS,
  'caches', 'addEventListener', 'globalThis', 'navigator', 'WebSocketPair', 'HTMLRewriter',
  'DOMException', 'EventTarget', 'CustomEvent', 'Event', 'ExecutionContext', 'ArrayBuffer', 'Uint8Array']);

const liste = undefinedCalls(raw, WORKER_GLOBALS);
assert.deepEqual(liste, [],
  'v4.3.6: In src/worker.js werden Namen aufgerufen, die es dort nicht gibt:\n  '
  + liste.join('\n  ')
  + '\n  Das faellt erst zur Laufzeit auf — bei einer Route im Browser des Nutzers, '
  + 'bei einem Cron-Lauf ueberhaupt nicht.');

/* Gegenprobe im Test selbst: der historische Fehler MUSS gefunden werden.
   Ohne sie waere nicht belegt, dass die Pruefung ueberhaupt etwas sieht. */
{
  const kaputt = raw.replace("if(request.method==='POST'){\n          const body=await request.json()",
                             "if(req.method==='POST'){\n          const body=await req.json()");
  assert.notEqual(kaputt, raw, 'v4.3.6: Der Ankertext fuer die Gegenprobe muss existieren');
  const gefunden = undefinedCalls(kaputt, WORKER_GLOBALS);
  assert.ok(gefunden.length > 0,
    'v4.3.6: Der historische Fehler `req.json()` MUSS von dieser Pruefung gefunden werden — sonst prueft sie nichts');
}

/* Und der Handler heisst weiterhin `request`. Wuerde jemand ihn in `req`
   umbenennen, waeren die Routen wieder stimmig, aber `authed(req, …)` und
   `authHint(req, …)` bekaemen ihren Parameter aus dem aeusseren Namen —
   deshalb wird der Name hier festgehalten. */
assert.match(raw, /async fetch\(request, env, ctx\)/,
  'v4.3.6: Der Fetch-Handler heisst `request` — Routen muessen diesen Namen benutzen');

console.log('✓ FusionPulse v4.3.6 Alle aufgerufenen Namen im Worker existieren (ausgefuehrt): OK');
