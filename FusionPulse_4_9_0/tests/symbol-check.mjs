/* ══ GEMEINSAMER SYMBOL-PRUEFER (v4.3.6) ═══════════════════════════════════
   Wird von `client-symbols.mjs` UND `worker-symbols.mjs` benutzt. Bewusst EIN
   Modul: zwei Kopien derselben Zerlegung waeren genau die Zweitwahrheit, an
   der diese Codebasis in dieser Serie neunmal gescheitert ist.

   Findet Aufrufe von Namen, die in der geprueften Datei nirgends definiert
   sind. So etwas ist syntaktisch einwandfrei und faellt sonst erst zur
   Laufzeit auf — im Browser des Nutzers oder, schlimmer, in einem Cron-Lauf,
   den niemand ansieht. Genau so blieb `req is not defined` in
   /api/watchlist seit v4.1.0 unentdeckt. */
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

export { stripCode };

export function definedNames(src) {
  const defined = new Set();
  for (const re of [
    /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g,
    /\b(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=/g,   // auch verschachtelt, nicht nur am Zeilenanfang
  /* Mehrfachdeklarationen (`const a=[],b=[]`), Schleifenbindungen
     (`for(const x of …)`) und Destrukturierung (`const {a,b}=…`). Ohne diese
     drei meldete die Lesepruefung 26 Fehlalarme — durchweg lokale Variablen,
     die der Extraktor schlicht nicht gesehen hat. Ein Waechter mit
     Fehlalarmen wird ignoriert und ist damit wertlos. */
  /\b(?:const|let|var)\s+([A-Za-z0-9_$,\s]+?)(?==[^=])/g,
  /,\s*([A-Za-z0-9_$]+)\s*=/g,   // zweiter und weiterer Deklarator: `const rh=…, rl=…`
  /\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z0-9_$]+)\s+(?:of|in)\b/g,
  /\bfor\s*\(\s*(?:const|let|var)\s*[[{]([^\]}]*)[\]}]\s+(?:of|in)\b/g,   // `for(const [a,b] of …)`
  /\b(?:const|let|var)\s*[{[]([^}\]]*)[}\]]\s*=/g,
    /(?:^|\n)\s*class\s+([A-Za-z0-9_$]+)/g,
    /([A-Za-z0-9_$]+)\s*[:=]\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>)/g,
    /* Kurzform-Methoden in Objekten und Klassen: `async get(path){…}`,
     `scheduled(event, env){…}`. Ohne sie gilt die DEFINITION selbst als
     Aufruf eines unbekannten Namens — die Pruefung meldete daraufhin
     `get()`, `handle()` und `scheduled()` als Fehler. Schluesselwoerter wie
     `if(` faengt die Globals-Liste ab. */
  /\n\s*(?:async\s+)?[A-Za-z0-9_$]+\s*\(([^)]*)\)\s*\{/g,   // deren Parameter (z. B. `async fetch(request, env, ctx)`)
  /\n\s*(?:async\s+)?([A-Za-z0-9_$]+)\s*\([^)]*\)\s*\{/g,
  /(?:function(?:\s+[A-Za-z0-9_$]+)?|catch)\s*\(([^)]*)\)/g,   // benannte Funktionen haben auch Parameter
    /\(([^()]*)\)\s*=>/g,                                        // Pfeilfunktionen ebenso
    /(?:^|[^\w$])([A-Za-z0-9_$]+)\s*=>/g,
  ]) { let m; while ((m = re.exec(src))) for (const t of m[1].split(',')) {
    const n = t.trim().replace(/[={].*$/, '').replace(/^\.\.\./, '').replace(/^.*:\s*/, '').replace(/[[\]{}()]/g, '').trim();
    if (/^[A-Za-z0-9_$]+$/.test(n)) defined.add(n);
  } }
  return defined;
}

export function undefinedCalls(raw, globals) {
  const src = stripCode(raw);
  const defined = definedNames(src);
  const problem = new Map();
  const call = /(?<![.\w$])([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
  let m;
  while ((m = call.exec(src))) {
    const name = m[1];
    if (defined.has(name) || globals.has(name)) continue;
    if (!problem.has(name)) problem.set(name, src.slice(0, m.index).split('\n').length);
  }
  return [...problem.entries()].map(([n, z]) => `${n}() in Zeile ${z}`);
}

export const KEYWORDS = ['if','for','while','switch','catch','return','typeof','new','function','await','async','of','in','do','else','try','case','delete','void','yield','instanceof','throw'];
export const SHARED_GLOBALS = new Set(['console','fetch','setTimeout','clearTimeout','setInterval','clearInterval',
  'Promise','Object','Array','String','Number','Boolean','Math','JSON','Date','Map','Set','WeakMap','WeakSet',
  'Error','TypeError','RangeError','RegExp','Symbol','Proxy','Reflect','BigInt','Intl','parseInt','parseFloat',
  'isNaN','isFinite','encodeURIComponent','decodeURIComponent','encodeURI','decodeURI','structuredClone',
  'URL','URLSearchParams','Headers','Request','Response','FormData','Blob','File','AbortController','AbortSignal',
  'atob','btoa','queueMicrotask','crypto','TextEncoder','TextDecoder','performance','ReadableStream','WritableStream',
  ...KEYWORDS]);

/* ══ v4.3.6 · AUFRUFE REICHEN NICHT ════════════════════════════════════════
   Die erste Fassung suchte nur Aufrufe: `name(`. Der historische Fehler
   `req.method` / `req.json()` ist aber KEIN Aufruf eines unbekannten Namens —
   `json` steht hinter einem Punkt und wird korrekt uebersprungen; `req` selbst
   wird nur GELESEN. Der Waechter lief exakt an dem Fehler vorbei, fuer den er
   gebaut wurde. Aufgefallen ist das nur, weil die Gegenprobe im Test den
   historischen Fehler wieder einbaut und rot werden MUSS.

   Deshalb zusaetzlich: Namen, auf deren Eigenschaften zugegriffen wird
   (`name.` oder `name?.`), muessen ebenfalls definiert sein. Das ist eng
   genug, um rauscharm zu bleiben, und faengt genau diese Klasse. */
export function undefinedReads(raw, globals) {
  const src = stripCode(raw);
  const defined = definedNames(src);
  const problem = new Map();
  /* NUR der harte Punkt. `name?.` ist eine ausdrueckliche Absicherung gegen
     „gibt es vielleicht nicht" und damit kein Fehler — `toast?.(…)` etwa ist
     bewusst so geschrieben. Der historische Fehler lautete `req.json()`,
     ohne Fragezeichen, und wird weiterhin gefunden. */
  const read = /(?<![.\w$?])([A-Za-z_$][A-Za-z0-9_$]*)\s*\.(?!\.)/g;
  let m;
  while ((m = read.exec(src))) {
    const name = m[1];
    if (defined.has(name) || globals.has(name)) continue;
    if (!problem.has(name)) problem.set(name, src.slice(0, m.index).split('\n').length);
  }
  return [...problem.entries()].map(([n, z]) => `${n}.… in Zeile ${z}`);
}
