/* Funktionale Client-Harness (v3.5.8).
   Zweck: public/app.js WIRKLICH ausfuehren, statt nur per Regex im Quelltext zu
   suchen. Nur so laesst sich beweisen, dass die Kopfzeile der wirtschaftlichen
   Bewertung nicht mehr widerspricht. Alle Browser-APIs werden minimal gestubbt;
   Timer/Netz sind bewusst tot, damit der Test nichts pollt. */
import fs from 'node:fs';
import vm from 'node:vm';

function stubEl() {
  const el = {
    style: {}, dataset: {}, classList: { add(){}, remove(){}, toggle(){}, contains(){return false;} },
    children: [], value: '', textContent: '', innerHTML: '', checked: false, hidden: false,
    addEventListener(){}, removeEventListener(){}, appendChild(){}, remove(){}, insertAdjacentHTML(){},
    setAttribute(){}, removeAttribute(){}, getAttribute(){return null;}, focus(){}, click(){}, scrollIntoView(){},
    insertAdjacentElement(){}, insertBefore(){}, replaceChildren(){}, prepend(){}, append(){}, contains(){return false;},
    setPointerCapture(){}, releasePointerCapture(){}, animate(){return {cancel(){},finished:Promise.resolve()};},
    querySelector(){ return stubEl(); }, querySelectorAll(){ return []; }, closest(){ return null; },
    getBoundingClientRect(){ return {top:0,left:0,width:0,height:0,bottom:0,right:0}; }
  };
  return el;
}

export function loadClient(overrides = {}) {
  const store = new Map();
  const doc = {
    readyState: 'complete',
    documentElement: stubEl(),
    body: stubEl(),
    head: stubEl(),
    hidden: false,
    visibilityState: 'visible',
    createElement(){ return stubEl(); },
    createTextNode(){ return stubEl(); },
    getElementById(){ return stubEl(); },
    querySelector(){ return stubEl(); },
    querySelectorAll(){ return []; },
    addEventListener(){}, removeEventListener(){}
  };
  const ctx = {
    console,
    document: doc,
    navigator: { userAgent: 'node', onLine: true, serviceWorker: { register: async()=>({}), getRegistrations: async()=>[], addEventListener(){}, removeEventListener(){}, controller:null, ready: new Promise(()=>{}) }, vibrate(){} },
    location: { href: 'https://test.local/', search: '', hostname: 'test.local', protocol: 'https:', reload(){} },
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k,v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
      clear: () => store.clear()
    },
    fetch: async () => { throw new Error('Netzwerk im Test bewusst deaktiviert'); },
    AbortController, AbortSignal, URL, URLSearchParams, TextEncoder, TextDecoder,
    Intl, Math, Date, JSON, Map, Set, Promise, Array, Object, Number, String, Boolean, RegExp, Error,
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
    matchMedia: () => ({ matches:false, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){} }),
    AudioContext: function(){ return { state:'suspended', resume(){}, createOscillator(){return {connect(){},start(){},stop(){},frequency:{setValueAtTime(){},value:0},type:''};}, createGain(){return {connect(){},gain:{setValueAtTime(){},exponentialRampToValueAtTime(){},linearRampToValueAtTime(){},value:0}};}, destination:{}, currentTime:0 }; },
    Notification: function(){}, Audio: function(){ return { play(){}, pause(){} }; },
    performance: { now: () => 0 },
    crypto: { randomUUID: () => 'test-uuid', getRandomValues: a => a }
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.self = ctx;
  ctx.Notification.permission = 'denied';
  ctx.Notification.requestPermission = async () => 'denied';
  Object.assign(ctx, overrides);

  /* Top-Level `const`/`let` eines Scripts landen NICHT auf dem Kontextobjekt.
     Deshalb haengt ein Epilog die zu pruefenden Bindungen als Accessoren an,
     ohne die Quelldatei selbst zu veraendern. */
  const epilogue = `
;globalThis.__fp = {
  get S(){return S;},
  stockHeadline, stockOpportunity, stockLevel, stockSizing, stockTradeability, stockFreshness,
  HEADLINE_RANK, VERDICT_ICON,
  get mutedSetupSet(){return mutedSetupSet;}, set mutedSetupSet(v){mutedSetupSet=v;},
  get stockMeta(){return stockMeta;}, set stockMeta(v){stockMeta=v;},
  get stockRows(){return stockRows;}, set stockRows(v){stockRows=v;},
  get stockPositions(){return stockPositions;}, set stockPositions(v){stockPositions=v;},
  portfolioExposure, portfolioBlocksNewBuy, portfolioBudgetEur, sectorOfSymbol, positionRiskEur,
  stockStrength, DEFAULTS,
  GLOSS, gloss, gl, glossForSetup, GLOSS_GROUPS, GLOSS_LABEL,
  coinHeadline, buyReady, sizing, stockHeatmapMark, crowdStatus, crowdTrack, refreshRate,
  get crowdMeta(){return crowdMeta;}, set crowdMeta(v){crowdMeta=v;},
  get crowdMap(){return crowdMap;}, set crowdMap(v){crowdMap=v;},
  get crowdHistory(){return crowdHistory;}, set crowdHistory(v){crowdHistory=v;},
  get refreshHistory(){return refreshHistory;}, set refreshHistory(v){refreshHistory=v;},
  trackRefresh
};`;
  const src = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  vm.createContext(ctx);
  vm.runInContext(src + epilogue, ctx, { filename: 'app.js' });
  return ctx.__fp;
}
