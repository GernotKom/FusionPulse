/* ══════ v4.5.8 · Suite 63 · NK82 — DIE KOPFZEILE WIRD GERENDERT, NICHT GELESEN
   ANLASS, unangenehm und protokollpflichtig: In 4.5.7 habe ich `flex-wrap:wrap`
   auf `header` und `.hcenter-tools` gesetzt, um den Zusammenbruch bei rotem
   Status zu beheben. NK81a hat das geprueft — per Regex im Stylesheet. Der Test
   war gruen, die Regel stand da, und im Browser wurde es SCHLIMMER: statt einer
   70-Pixel-Saeule stand die Kopfzeile jetzt 650 Pixel hoch und schob den Inhalt
   aus dem Bild. Genau die Lehre, die dieses Projekt seit v3.32.7 aufgeschrieben
   hat und die ich hier trotzdem verletzt habe: Ein Muster im Quelltext beweist,
   dass etwas dasteht — nicht, dass es das Richtige tut.

   Layout ist nicht per Regex pruefbar. Dieser Prueflauf startet Chromium,
   laedt die ECHTE index.html mit dem ECHTEN style.css, setzt die Statusleiste
   auf den echten Fehlertext vom 08.09. und MISST.

   Drei Groessen, alle in Pixeln, alle nachrechenbar:
     hoehe       Bauhoehe der Kopfzeile. Sie ist `sticky` — was sie belegt,
                 fehlt dem Inhalt fuer immer.
     titelBreite Breite des Regime-Titels. Faellt er unter ~140 px, bricht
                 „Krypto · Risk-Off · 20 % ueber VWAP" in Einzelwoerter.
     inhalt      Was unterhalb der Kopfzeile im Sichtfenster uebrig bleibt.

   Gemessen wird in BEIDEN Zustaenden. Der gruene Fall ist die Kontrolle: er
   war nie kaputt und darf durch keine Reparatur schlechter werden. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const hier = path.dirname(fileURLToPath(import.meta.url));
const pub  = path.join(hier, '..', 'public');
const css  = fs.readFileSync(path.join(pub, 'style.css'), 'utf8');
const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');

/* Nur die Kopfzeile aus der echten index.html — kein app.js, keine Netzaufrufe.
   Gemessen wird das Layout, nicht das Verhalten. */
const kopf = html.slice(html.indexOf('<header'), html.indexOf('</header>') + 9);
assert.ok(kopf.length > 500, 'Kopfzeile nicht aus index.html geschnitten — Anker pruefen');

/* Der echte Text vom 08.09., 15:23. Nicht gekuerzt: seine Laenge IST der
   Ausloeser, und ein kuerzerer Platzhalter wuerde den Fehler verstecken. */
const FEHLERTEXT = 'Handlungsbedarf · Datenquelle fehlerhaft · Aktien (Tiingo, Fallback Twelve Data): '
  + 'API-Fehler — Watchlist · 0 von 36 analysierbar. Häufigster Grund (36x): keine '
  + 'analysierbaren Bars (tiingoAnalyseOne lieferte nichts)';
const GRUENTEXT = 'App läuft einwandfrei · Datenserver stabil · kein Handlungsbedarf';

const VIEWPORTS = [
  { name: 'Desktop 1440', width: 1440, height: 900 },
  { name: 'Laptop 1280',  width: 1280, height: 800 },
  { name: 'Handy 390',    width: 390,  height: 844 },
];

async function miss(page, vp, zustand) {
  await page.setViewport({ width: vp.width, height: vp.height });
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head>`
    + `<body>${kopf}<main id="probe" style="height:2000px"></main></body></html>`,
    { waitUntil: 'load' });

  await page.evaluate(({ text, klasse }) => {
    const strip = document.querySelector('#resourceStrip');
    strip.className = 'resource-strip fast-tip ' + klasse;
    document.querySelector('#resourceText').textContent = text;
    document.querySelector('#regime').textContent = 'Krypto · Risk-Off · 20 % über VWAP';
    document.querySelector('#appver').textContent = 'v4.5.8 · Worker 4.5.8';
    document.querySelector('#sysDb').textContent = 'DB 72k/1000k · Lesen 96k/806,5M';
  }, zustand);

  return page.evaluate(() => {
    const h = document.querySelector('header').getBoundingClientRect();
    const t = document.querySelector('#regime').getBoundingClientRect();
    return { hoehe: Math.round(h.height), titelBreite: Math.round(t.width),
             titelHoehe: Math.round(t.height), inhalt: Math.round(innerHeight - h.height) };
  });
}

/* Chromium/Chrome wird gesucht, nicht vorausgesetzt. Auf einem MacBook liegt
   er woanders als im Prueflauf-Container, und `npm run check` darf nicht
   scheitern, nur weil dieser eine Test seinen Browser nicht findet. Fehlt er,
   wird ausdruecklich UEBERSPRUNGEN und gesagt warum — ein stillschweigend
   ausgelassener Test ist schlimmer als gar keiner. */
const KANDIDATEN = [
  process.env.CHROME_PATH,
  '/opt/google/chrome/chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
].filter(Boolean);
const exe = KANDIDATEN.find(p => { try { return fs.existsSync(p); } catch { return false; } });
if (!exe) {
  console.log('⊘ NK82 UEBERSPRUNGEN: kein Chrome/Chromium gefunden.');
  console.log('  Layout laesst sich nur gerendert pruefen. Pfad ueber CHROME_PATH setzen:');
  console.log('  CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run test:header');
  process.exit(0);
}

const browser = await puppeteer.launch({
  executablePath: exe,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
});
const page = await browser.newPage();
const protokoll = [];
let fehler = 0;

try {
  for (const vp of VIEWPORTS) {
    const gruen = await miss(page, vp, { text: GRUENTEXT, klasse: 'ok' });
    const rot   = await miss(page, vp, { text: FEHLERTEXT, klasse: 'err' });
    protokoll.push({ vp: vp.name, gruen, rot });

    const pruefe = (bed, txt) => { if (!bed) { fehler++; protokoll.push({ FEHLER: `${vp.name}: ${txt}` }); } };

    /* 1 · Die Kopfzeile darf im Fehlerfall wachsen — aber nicht das Bild fressen.
           Ein Drittel des Sichtfensters ist die Grenze; darueber ist die App
           nicht mehr bedienbar, und genau das war die Meldung vom 08.09. */
    pruefe(rot.hoehe <= vp.height / 3,
      `Kopfzeile ${rot.hoehe} px frisst mehr als ein Drittel von ${vp.height} px`);

    /* 2 · Der Titel darf nie in Einzelwoerter fallen. Unter 140 px passt
           „Risk-Off" nicht mehr neben „Krypto ·". Auf dem Handy ist der Titel
           ohnehin voll breit, dort greift die Hoehenpruefung. */
    if (vp.width >= 1280) {
      pruefe(rot.titelBreite >= 140,
        `Titel nur ${rot.titelBreite} px breit — faellt in eine Saeule`);
      pruefe(rot.titelHoehe <= 60,
        `Titel ${rot.titelHoehe} px hoch — er stapelt sich statt zu stehen`);
    }

    /* 3 · Der gruene Fall war nie kaputt und darf durch keine Reparatur
           schlechter werden — Kontrolle gegen Uebertherapie. Der Massstab ist
           auch hier das Sichtfenster, NICHT eine feste Pixelzahl: auf 390 px
           Breite bricht die Kopfzeile zwangslaeufig um, und das ist richtig so.
           Eine absolute Schwelle von 120 px hat hier zuerst gestanden und nur
           bewiesen, dass ich eine Desktop-Zahl auf ein Handy angewandt hatte. */
    pruefe(gruen.hoehe <= vp.height / 4,
      `gruene Kopfzeile ${gruen.hoehe} px bei ${vp.height} px Sichtfenster`);
    pruefe(gruen.titelBreite >= 140 || vp.width < 1280,
      `gruener Titel nur ${gruen.titelBreite} px breit`);

    /* 4 · Was beim Fehler NICHT passieren darf, ist der Verlust der
           Orientierung — und die haengt am Titel, nicht an der Bauhoehe. Hier
           stand zuerst „Sprung hoechstens doppelt". Diese Schwelle war frei
           erfunden und haette eine Kopfzeile von 188 px verworfen, die 79 % des
           Bildes stehen laesst. Gemessen wird jetzt, was gemeldet wurde: der
           Titel muss im Fehlerfall genauso lesbar bleiben wie im Normalfall.
           Die Bauhoehe deckt bereits Pruefung 1 ab. */
    pruefe(rot.titelBreite >= gruen.titelBreite - 2,
      `Titel schrumpft im Fehlerfall von ${gruen.titelBreite} auf ${rot.titelBreite} px`);
    pruefe(rot.titelHoehe <= gruen.titelHoehe + 2,
      `Titel waechst im Fehlerfall von ${gruen.titelHoehe} auf ${rot.titelHoehe} px`);

    /* 5 · v4.5.9, ausdruecklich vom Nutzer gefordert: „war besser, als sie nur
           klein war ... darunter war mehr Uebersicht." Die Kopfzeile darf im
           Fehlerfall nicht mehr nennenswert wachsen. 24 px Toleranz decken eine
           zweite Textzeile ab, nicht eine zweite Kopfzeile. Diese Pruefung
           haelt jede kuenftige „die Meldung muss auffaelliger werden"-Idee auf,
           bevor sie wieder Bildflaeche kostet. */
    pruefe(rot.hoehe <= gruen.hoehe + 24,
      `Kopfzeile waechst im Fehlerfall von ${gruen.hoehe} auf ${rot.hoehe} px`);
  }
} finally {
  await browser.close();
}

console.table(protokoll.filter(p => !p.FEHLER).map(p => ({
  Viewport: p.vp,
  'grün Höhe': p.gruen.hoehe, 'grün Titel': p.gruen.titelBreite,
  'rot Höhe': p.rot.hoehe,   'rot Titel': p.rot.titelBreite, 'rot Inhalt': p.rot.inhalt,
})));
for (const p of protokoll.filter(p => p.FEHLER)) console.error('  ✗ ' + p.FEHLER);

assert.equal(fehler, 0, `${fehler} Layout-Verstoesse — siehe oben`);
console.log('✓ FusionPulse v4.5.8 NK82 Kopfzeile gerendert und gemessen: OK');
