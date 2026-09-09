#!/usr/bin/env node
/* ============================================================================
   sync-version.mjs — package.json "version" ist die EINZIGE Wahrheit.
   Schreibt die Nummer in alle Artefakte, die sie zur Laufzeit brauchen.
   Läuft automatisch vor "npm run dev" und "npm run deploy".
   ========================================================================== */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (f) => join(root, f);
const version = JSON.parse(readFileSync(p('package.json'), 'utf8')).version;

if (!/^\d+\.\d+\.\d+[a-z]?$/i.test(version)) {
  console.error(`✗ Ungültige Version in package.json: "${version}"`);
  process.exit(1);
}

const patch = (file, re, replacement) => {
  const before = readFileSync(p(file), 'utf8');
  if (!re.test(before)) { console.error(`✗ Muster nicht gefunden in ${file}`); process.exit(1); }
  const after = before.replace(re, replacement);
  if (after !== before) writeFileSync(p(file), after);
  return after !== before;
};

const header = `/* GENERIERT von scripts/sync-version.mjs — nicht editieren. */\n`;

// 1) Worker
patch('src/version.js', /export const APP_VERSION = '[^']*';/, `export const APP_VERSION = '${version}';`);

// 2) Frontend (wird von index.html vor app.js geladen)
writeFileSync(p('public/version.js'), `${header}self.FP_VERSION = '${version}';\n`);

// 3) Service Worker — Bytewechsel erzwingt SW-Update + neuen Cache-Namen
patch('public/sw.js', /const APP_VERSION = '[^']*';/, `const APP_VERSION = '${version}';`);

// 4) Browser-Tab
patch('public/index.html', /<title>FusionPulse [^<]*<\/title>/, `<title>FusionPulse ${version}</title>`);
// v3.14.1: Der Shell-Stempel MUSS mitwandern, sonst meldet die Konsistenzpruefung
// bei jeder Auslieferung faelschlich einen Fehlstand.
patch('public/index.html', /<meta name="fp-shell-version" content="[^"]*">/, `<meta name="fp-shell-version" content="${version}">`);

/* 7) v3.14.3 · DIE LUECKE, DIE DREI RUNDEN GEKOSTET HAT.
   Bis v3.14.2 gab es drei Stempel: index.html, version.js und den Worker.
   `app.js` und `style.css` hatten KEINEN. Genau in diesen beiden Dateien lagen
   aber die Layoutkorrekturen. Ein frisches index.html + frisches version.js
   neben einem alten style.css war damit vollstaendig unsichtbar: die
   Konsistenzpruefung aus v3.14.1 war gruen, der blaue Balken kam nicht, und die
   Kopfzeile zeigte trotzdem die neue Nummer.
   Jetzt tragen beide Dateien die Version IM URL. Eine neue Version ist eine
   neue URL — ein alter Cache-Eintrag kann gar nicht mehr getroffen werden.
   Das ist Verhinderung statt Erkennung; die Pruefung unten bleibt als
   Rueckfallebene fuer den Fall, dass index.html selbst veraltet ausgeliefert wird. */
patch('public/index.html', /href="\/style\.css(\?v=[^"]*)?"/, `href="/style.css?v=${version}"`);
patch('public/index.html', /src="\/version\.js(\?v=[^"]*)?"/, `src="/version.js?v=${version}"`);
patch('public/index.html', /src="\/app\.js(\?v=[^"]*)?"/, `src="/app.js?v=${version}"`);
// Der Service Worker muss dieselben URLs vorhalten, sonst greift die
// Offline-Rueckfallebene ins Leere.
patch('public/sw.js', /const SHELL_VERSIONED = \[[^\]]*\];/,
  `const SHELL_VERSIONED = ['/version.js?v=${version}', '/app.js?v=${version}', '/style.css?v=${version}'];`);
// Stempel IM Stylesheet: erlaubt der App, ein veraltetes CSS direkt zu erkennen,
// statt es aus Folgefehlern zu erraten.
patch('public/style.css', /--fp-css-version:"[^"]*"/, `--fp-css-version:"${version}"`);

// 5) Dokumentation / Quellkopf
patch('README.md', /^# FusionPulse v[^\n]*/m, `# FusionPulse v${version}`);
patch('public/app.js', /FusionPulse v\d+\.\d+\.\d+ — Frontend/, `FusionPulse v${version} — Frontend`);

// 6) Cloudflare-Variable (nur Diagnose; der Code-Konstante wird der Vorzug gegeben)
patch('wrangler.jsonc', /"APP_VERSION":\s*"[^"]*"/, `"APP_VERSION": "${version}"`);

console.log(`✓ FusionPulse-Version überall auf ${version} gesetzt`);
