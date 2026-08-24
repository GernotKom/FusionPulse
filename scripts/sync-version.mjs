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

// 5) Dokumentation / Quellkopf
patch('README.md', /^# FusionPulse v[^\n]*/m, `# FusionPulse v${version}`);
patch('public/app.js', /FusionPulse v\d+\.\d+\.\d+ — Frontend/, `FusionPulse v${version} — Frontend`);

// 6) Cloudflare-Variable (nur Diagnose; der Code-Konstante wird der Vorzug gegeben)
patch('wrangler.jsonc', /"APP_VERSION":\s*"[^"]*"/, `"APP_VERSION": "${version}"`);

console.log(`✓ FusionPulse-Version überall auf ${version} gesetzt`);
