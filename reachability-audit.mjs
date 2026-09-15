/* ============================================================================
   FusionPulse · Erreichbarkeits-Audit (v3.9.2)

   ANLASS: Der Wächter-Schalter in Modul 0 war seit v3.5.7 vollständig gebaut,
   getestet und funktionsfähig — und für den Nutzer unsichtbar, weil er hinter
   dem rechten Rand eines Scrollbereichs lag, dessen Scrollbalken unter macOS
   ausgeblendet ist. Alle Tests waren grün. Sie prüften, ob das Bedienelement
   EXISTIERT, nicht, ob man es ERREICHT.

   Dieses Werkzeug sucht deshalb gezielt nach dem Muster, das den Fehler
   erzeugt hat, statt nach dem Fehler selbst:

     ein Container mit overflow-x/auto|scroll
     + interaktive Elemente darin
     + KEINE sticky-Spalte und KEIN Umbruch unter Mobilbreite
     = potenziell unerreichbar

   Es ist bewusst ein AUDIT und kein Regressionstest: es urteilt nicht, es
   listet auf. Ein Fund ist eine Frage ("kommt man da hin?"), kein Beweis.
   `--strict` lässt es bei Funden mit Code 1 enden, für die CI.
   ==========================================================================*/
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const idx = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const strict = process.argv.includes('--strict');

/* -- 1. Alle Klassen mit horizontalem Scrollbereich einsammeln -------------- */
const scrollers = new Map(); // klasse -> {sticky, breakpoint, scrollbar}
for (const m of css.matchAll(/\.([a-zA-Z0-9_-]+)\s*\{([^}]*)\}/g)) {
  const [, cls, body] = m;
  if (!/overflow-x\s*:\s*(auto|scroll)/.test(body)) continue;
  scrollers.set(cls, { sticky: false, breakpoint: false, scrollbar: false });
}
for (const cls of scrollers.keys()) {
  const s = scrollers.get(cls);
  // sticky-Spalte irgendwo im Umfeld dieser Klasse?
  s.sticky = new RegExp(`\\.${cls}[^{]*\\{[^}]*position:sticky|position:sticky[^}]*\\}[^]*?\\.${cls}`).test(css)
    || new RegExp(`${cls}[\\s\\S]{0,600}position:sticky`).test(css);
  s.scrollbar = new RegExp(`\\.${cls}::-webkit-scrollbar`).test(css)
    || new RegExp(`\\.${cls}\\{[^}]*scrollbar-width`).test(css);
  // Umbruch unter Mobilbreite?
  for (const mq of css.matchAll(/@media\([^)]*max-width:\s*(\d+)px[^)]*\)\s*\{([\s\S]*?)\n\}/g)) {
    if (Number(mq[1]) >= 600 && mq[2].includes(cls)) s.breakpoint = true;
  }
}

/* -- 1b. Dokumentierte Ausnahmen -------------------------------------------
   Manchmal ist horizontales Scrollen die richtige Antwort und Umbruch die
   falsche. Damit solche Faelle nicht stillschweigend ignoriert werden, muessen
   sie in der CSS ausdruecklich begruendet sein:

     /* reach-audit-ok: .klasse — Begruendung *​/

   Ohne Begruendung keine Ausnahme. Das Audit zeigt sie weiterhin an, aber als
   bewusste Entscheidung statt als offene Frage — und die Begruendung steht
   dort, wo der naechste Bearbeiter sie findet: neben dem Code.                */
const exempt = new Map();
for (const m of css.matchAll(/\/\*\s*reach-audit-ok:\s*\.([a-zA-Z0-9_-]+)\s*[—-]\s*([^*]+)\*\//g)) {
  exempt.set(m[1], m[2].trim().replace(/\s+/g, ' '));
}

/* -- 2. Interaktive Elemente je Scrollbereich ------------------------------- */
const INTERACTIVE = /<(button|input|select|textarea|a\s)|class="[^"]*\b(attr-toggle|favbtn|rowmute|draghandle)\b/;
const findings = [];
for (const [cls, s] of scrollers) {
  // Wird die Klasse überhaupt mit interaktivem Inhalt gerendert?
  const uses = [...app.matchAll(new RegExp(`class="${cls}"[\\s\\S]{0,4000}`, 'g'))]
    .concat([...idx.matchAll(new RegExp(`class="${cls}"[\\s\\S]{0,4000}`, 'g'))]);
  const interactive = uses.some(u => INTERACTIVE.test(u[0]));
  if (!interactive) continue;
  const missing = [];
  if (!s.sticky) missing.push('keine sticky-Spalte');
  if (!s.breakpoint) missing.push('kein Umbruch unter Mobilbreite');
  if (!s.scrollbar) missing.push('Scrollbalken nicht erzwungen');
  findings.push({ cls, missing, ok: missing.length === 0, reason: exempt.get(cls) || null });
}

/* -- 3. Bericht ------------------------------------------------------------ */
console.log('FusionPulse · Erreichbarkeits-Audit');
console.log('='.repeat(58));
if (!scrollers.size) {
  console.log('Keine horizontalen Scrollbereiche gefunden.');
} else {
  console.log(`Horizontale Scrollbereiche: ${scrollers.size}`);
  console.log(`davon mit Bedienelementen:  ${findings.length}\n`);
}
let open = 0;
for (const f of findings) {
  if (f.ok) { console.log(`  OK   .${f.cls} — sticky + Umbruch + sichtbarer Scrollbalken`); continue; }
  if (f.reason) {
    // Begruendete Ausnahme: sichtbar bleiben, aber nicht als offene Frage zaehlen.
    console.log(`  DOK  .${f.cls} — bewusste Ausnahme: ${f.reason}`);
    console.log(`       (${f.missing.join(', ')} — geprueft und so gewollt)`);
    continue;
  }
  open++;
  console.log(`  PRÜF .${f.cls} — ${f.missing.join(', ')}`);
  console.log(`       Frage: Ist jedes Bedienelement in .${f.cls} auf 1280 px und auf 390 px erreichbar,`);
  console.log('       ohne dass der Nutzer einen unsichtbaren Scrollbalken erraten muss?');
}

/* -- 4. Zweite Prüfung: Bedienelemente ohne jede Beschriftung --------------- */
const unlabeled = [];
for (const m of app.matchAll(/<button([^>]*)>/g)) {
  const attrs = m[1];
  if (/title=|aria-label=/.test(attrs)) continue;
  const ctx = app.slice(m.index, m.index + 120).replace(/\s+/g, ' ');
  unlabeled.push(ctx.slice(0, 90));
}
if (unlabeled.length) {
  console.log(`\nBedienelemente ohne title/aria-label: ${unlabeled.length}`);
  for (const u of unlabeled.slice(0, 12)) console.log(`  · ${u}`);
  if (unlabeled.length > 12) console.log(`  … und ${unlabeled.length - 12} weitere`);
}

console.log('\n' + '='.repeat(58));
console.log(open === 0
  ? 'Kein Scrollbereich mit Bedienelementen ohne Absicherung.'
  : `${open} Scrollbereich(e) zur manuellen Sichtprüfung.`);
console.log('Hinweis: Dieses Audit ersetzt keinen Blick auf den echten Bildschirm.');
console.log('Es findet das MUSTER, das den Modul-0-Schalter verborgen hat — nicht jeden Fall.');

if (strict && open > 0) process.exit(1);
