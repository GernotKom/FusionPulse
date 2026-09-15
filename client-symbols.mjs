/* ══ v4.3.1 · JEDE AUFGERUFENE FUNKTION MUSS ES AUCH GEBEN ═════════════════
   Anlass ist ein Fehler, den ICH gebaut habe: in `toggleWatchlist` stand
   `loadStocks(true)` — eine Funktion, die es in `public/app.js` nie gab. Sie
   heisst `scanStocks`. Folge: das Umschalten meldete „Umschalten
   fehlgeschlagen: Can't find variable: loadStocks", OBWOHL der Modus bereits
   gesetzt war. Ein Erfolg, ausgegeben als Fehlschlag — dieselbe Sorte
   Fehlmeldung, die v4.1.2 an dieser Stelle schon einmal beseitigt hat.

   Warum keine Suite das gefunden hat: `node --check` prueft nur die Syntax,
   und alle Pruefungen zu diesem Bereich vergleichen QUELLTEXT mit regulaeren
   Ausdruecken. Ein Aufruf einer nicht existierenden Funktion ist syntaktisch
   einwandfrei und faellt erst zur Laufzeit auf — im Browser des Nutzers.
   Achter Fall derselben Krankheit in dieser Serie: geprueft wurde der Name,
   nicht die Wirkung.

   Diese Pruefung sammelt alle in app.js DEFINIERTEN Namen plus die bekannten
   Browser-Globals und meldet jeden Aufruf, der zu keinem davon passt. */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const DATEIEN = ['../public/app.js', '../src/worker.js'];
/* Kommentare und Zeichenketten raus — sonst zaehlen Beispiele in Kommentaren
   und Funktionsnamen in Meldungstexten als Aufrufe. Genau dieser Fehler hat
   NK72 im Worker beim ersten Anlauf unbrauchbar gemacht. */
/* ══ ZEICHENKETTEN UND KOMMENTARE MUESSEN SAUBER WEG ═══════════════════════
   Die erste Fassung dieser Pruefung hat dafuer regulaere Ausdruecke benutzt
   und 162 „Fehler" gemeldet — darunter `Handelszeit()`, `ffnung()` und
   `Basispunkt()`, also deutsche Woerter aus Meldungstexten. Gleichzeitig
   verschwanden echte Definitionen, weil das Stripping den Quelltext
   zerschnitt: `loadAladdin` galt als undefiniert, obwohl es dasteht.

   Ein Pruefwerkzeug, das seinen Eingabetext falsch zerlegt, meldet beides
   falsch — zu viel UND zu wenig. Deshalb hier ein echter Zeichenscanner mit
   Zustand: er kennt einfache und doppelte Anfuehrungszeichen, Backticks samt
   verschachteltem Ausdruck, beide Kommentarformen und Regex-Literale. Langsamer, aber er liest, was dasteht. */
function stripCode(t) {
  let out = '', i = 0, n = t.length;
  const tmplStack = [];
  let prevSignificant = '';
  while (i < n) {
    const c = t[i], c2 = t[i + 1];
    if (c === '/' && c2 === '*') { const e = t.indexOf('*/', i + 2); const seg = t.slice(i, e < 0 ? n : e + 2);
      out += seg.replace(/[^\n]/g, ' '); i = e < 0 ? n : e + 2; continue; }
    if (c === '/' && c2 === '/') { const e = t.indexOf('\n', i); out += ' '.repeat((e < 0 ? n : e) - i); i = e < 0 ? n : e; continue; }
    if (c === "'" || c === '"') { const q = c; let j = i + 1;
      while (j < n && t[j] !== q) { if (t[j] === '\\') j++; j++; }
      out += q + q + ' '.repeat(Math.max(0, j - i - 1)); i = j + 1; prevSignificant = q; continue; }
    if (c === '`') { let j = i + 1;
      while (j < n) {
        if (t[j] === '\\') { j += 2; continue; }
        if (t[j] === '`') break;
        if (t[j] === '$' && t[j + 1] === '{') {           // Ausdruck IM Template bleibt Code
          out += ' '.repeat(j - i + 2); let depth = 1, k = j + 2, start = k;
          while (k < n && depth > 0) { if (t[k] === '{') depth++; else if (t[k] === '}') depth--; k++; }
          out += stripCode(t.slice(start, k - 1)) + ' ';
          i = k; j = k; continue;
        }
        j++;
      }
      out += ' '.repeat(Math.max(0, j - i + 1)); i = j + 1; continue; }
    /* Regex-Literal nur dort, wo ein Wert beginnen darf — sonst ist / eine Division. */
    if (c === '/' && !/[\w$)\]]/.test(prevSignificant)) { let j = i + 1, cls = false;
      while (j < n) { if (t[j] === '\\') { j += 2; continue; } if (t[j] === '[') cls = true;
        else if (t[j] === ']') cls = false; else if (t[j] === '/' && !cls) break; else if (t[j] === '\n') break; j++; }
      if (j < n && t[j] === '/') { out += ' '.repeat(j - i + 1); i = j + 1; prevSignificant = ')'; continue; } }
    out += c; if (!/\s/.test(c)) prevSignificant = c; i++;
  }
  return out;
}

for (const datei of DATEIEN) {
const raw = fs.readFileSync(new URL(datei, import.meta.url), 'utf8');
const src = stripCode(raw);
const defined = new Set();
for (const re of [
  /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g,
  /\b(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=/g,   // auch verschachtelt, nicht nur am Zeilenanfang
  /(?:^|\n)\s*class\s+([A-Za-z0-9_$]+)/g,
  /([A-Za-z0-9_$]+)\s*[:=]\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>)/g,
  /(?:function(?:\s+[A-Za-z0-9_$]+)?|catch)\s*\(([^)]*)\)/g,   // benannte Funktionen haben auch Parameter
  /(?:^|[,{;\n])\s*(?:async\s+)?[A-Za-z0-9_$]+\s*\(([^)]*)\)\s*\{/g,   // … und Methoden-Kurzschreibweise
  /\(([^()]*)\)\s*=>/g,                                        // Pfeilfunktionen ebenso
  /(?:^|[^\w$])([A-Za-z0-9_$]+)\s*=>/g,
  /* Kurzschreibweise fuer Methoden in Objektliteralen — `scheduled(c,env,ctx){}`,
     `get(){}`. Ohne diese Regel gelten sie als AUFRUFE und der Waechter meldet
     drei Fehlalarme im Worker. */
  /(?:^|[,{;\n])\s*(?:async\s+)?([A-Za-z0-9_$]+)\s*\([^)]*\)\s*\{/g,
]) { let m; while ((m = re.exec(src))) for (const t of m[1].split(',')) {
  const n = t.trim().replace(/[={].*$/, '').replace(/^\.\.\./, '').trim();
  if (/^[A-Za-z0-9_$]+$/.test(n)) defined.add(n);
} }

const BROWSER = new Set(['window','document','console','fetch','setTimeout','clearTimeout','setInterval','clearInterval',
  'requestAnimationFrame','cancelAnimationFrame','Promise','Object','Array','String','Number','Boolean','Math','JSON','Date',
  'Map','Set','WeakMap','WeakSet','Error','TypeError','RangeError','RegExp','Symbol','Proxy','Reflect','BigInt','Intl',
  'parseInt','parseFloat','isNaN','isFinite','encodeURIComponent','decodeURIComponent','encodeURI','decodeURI','structuredClone',
  'URL','URLSearchParams','Headers','Request','Response','FormData','Blob','File','FileReader','AbortController','AbortSignal',
  'localStorage','sessionStorage','navigator','location','history','alert','confirm','prompt','atob','btoa','queueMicrotask',
  'IntersectionObserver','MutationObserver','ResizeObserver','PerformanceObserver','performance','crypto','Notification',
  'CustomEvent','Event','EventTarget','Image','Audio','Worker','BroadcastChannel','matchMedia','getComputedStyle','scrollTo',
  'if','for','while','switch','catch','return','typeof','new','function','await','async','of','in','do','else','try','case','delete','void','yield','instanceof','throw']);

const problem = new Map();
/* ══ v4.3.6 · WAS DIESE PRUEFUNG KANN — UND WAS NICHT ════════════════════
   Sie findet AUFRUFE nicht existierender Funktionen. Genau so wurde
   `loadStocks(true)` gefunden.

   Sie findet NICHT den teuersten Fehler dieser Serie: in /api/watchlist stand
   seit v4.1.0 `req.method` — der Handler heisst `request`. Das ist kein
   Aufruf, sondern ein Zugriff. Ein Versuch, auch `name.` zu pruefen, ergab
   48 Fehlalarme (Destrukturierung, Marken, Vorlagen-Platzhalter): fuer
   Zugriffe reicht ein regulaerer Ausdruck nicht, dafuer braucht es einen
   echten Parser mit Gueltigkeitsbereichen. Der laeuft in `npm run lint`
   (ESLint, `no-undef`) — siehe UEBERGABE.md.

   Ein Waechter, der seine Grenze kennt, ist brauchbar. Einer, der 48
   Fehlalarme meldet, wird nach zwei Tagen ignoriert. */
for (const muster of [/(?<![.\w$])([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g]) {
  let m;
  while ((m = muster.exec(src))) {
    const name = m[1];
    if (defined.has(name) || BROWSER.has(name)) continue;
    if (!problem.has(name)) problem.set(name, src.slice(0, m.index).split('\n').length);
  }
}

const liste = [...problem.entries()].map(([n, z]) => `${n}() in Zeile ${z}`);
assert.deepEqual(liste, [],
  `v4.3.6: In ${datei} werden Funktionen aufgerufen, die es dort nicht gibt:\n  `
  + liste.join('\n  ')
  + '\n  Das faellt erst im Browser des Nutzers auf und meldet sich dort als „Can\'t find variable".');

}

/* Gegenprobe im Test selbst: ohne sie waere nicht belegt, dass die Pruefung
   ueberhaupt etwas findet. Sie laeuft gegen eine kleine, vollstaendig
   kontrollierte Quelle statt gegen die echten Dateien — so haengt sie nicht
   an deren Inhalt. */
{
  const probe = 'function a(x){ return b(x) + nichtDa(x); }\nfunction b(y){ return y; }\n';
  const p = stripCode(probe);
  const def = new Set();
  let m2;
  const rd = /(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g;
  while ((m2 = rd.exec(p))) def.add(m2[1]);
  const gefunden = [];
  const rc = /(?<![.\w$])([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
  while ((m2 = rc.exec(p))) if (!def.has(m2[1])) gefunden.push(m2[1]);
  assert.deepEqual(gefunden, ['nichtDa'],
    'v4.3.6: Die Pruefung muss einen Aufruf ohne Definition finden — und NUR den');
}

console.log('✓ FusionPulse v4.3.1 Alle aufgerufenen Funktionen existieren (ausgefuehrt): OK');
