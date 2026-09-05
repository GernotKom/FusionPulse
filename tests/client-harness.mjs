/* Funktionale Client-Harness (v3.5.8).
   Zweck: public/app.js WIRKLICH ausfuehren, statt nur per Regex im Quelltext zu
   suchen. Nur so laesst sich beweisen, dass die Kopfzeile der wirtschaftlichen
   Bewertung nicht mehr widerspricht. Alle Browser-APIs werden minimal gestubbt;
   Timer/Netz sind bewusst tot, damit der Test nichts pollt. */
import fs from 'node:fs';
import vm from 'node:vm';

function stubEl() {
  const el = {
    /* v3.15.0: `style` war ein nacktes Objekt. Der Client setzt und ENTFERNT
       CSSOM-Eigenschaften (measureChrome, applyTileTints). Ohne setProperty/
       removeProperty faellt der Harness mit einem TypeError statt mit einer
       Aussage — und ein Test, der aus dem falschen Grund faellt, ist kein Test.
       Der Stub merkt sich die Werte, damit man sie pruefen kann. */
    style: (()=>{ const m=new Map(); return {
      _map:m,
      setProperty(k,v){ m.set(k,String(v)); },
      removeProperty(k){ const v=m.get(k)??''; m.delete(k); return v; },
      getPropertyValue(k){ return m.get(k)??''; },
    };})(), dataset: {},
    /* v3.32.7: `classList` verwarf bisher alles. Damit liess sich die FARBE
       einer Anzeige nie pruefen — nur ihr Text. Die Klassen werden jetzt
       mitgeschrieben (`_classes`), OHNE `contains()` zu aendern: das gab
       bisher immer `false` zurueck, und Code, der sich darauf verlaesst,
       soll sich nicht unbemerkt anders verhalten. Nur Beobachtung. */
    classList: (()=>{ const c=new Set(); return {
      _classes:c,
      add(...k){ k.forEach(x=>c.add(x)); },
      remove(...k){ k.forEach(x=>c.delete(x)); },
      toggle(k,on){ if(on===undefined){ c.has(k)?c.delete(k):c.add(k); } else if(on){ c.add(k); } else { c.delete(k); } },
      contains(){ return false; },
    };})(),
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
  /* v3.18.0: `querySelector` gab bei JEDEM Aufruf ein NEUES Stub-Element
     zurueck. Damit liess sich nicht pruefen, was eine render-Funktion
     tatsaechlich geschrieben hat — man konnte nur pruefen, dass sie nicht
     abstuerzt. Genau dieselbe Luecke wie beim `style`-Stub in v3.15.0: der
     Harness lief durch und sagte nichts aus.
     Elemente werden jetzt je Selektor gemerkt und sind ueber `el(sel)`
     auslesbar. Das macht die Anzeige zum ersten Mal ueberpruefbar. */
  const elCache = new Map();
  const elFor = (sel) => { const k=String(sel);
    if(!elCache.has(k)) elCache.set(k, stubEl());
    return elCache.get(k); };
  const doc = {
    readyState: 'complete',
    documentElement: stubEl(),
    body: stubEl(),
    head: stubEl(),
    hidden: false,
    visibilityState: 'visible',
    createElement(){ return stubEl(); },
    createTextNode(){ return stubEl(); },
    getElementById(id){ return elFor('#'+id); },
    querySelector(sel){ return elFor(sel); },
    querySelectorAll(){ return []; },
    addEventListener(){}, removeEventListener(){}
  };
  const ctx = {
    console,
    /* Brücke in den VM-Kontext: der Epilog wird IM Kontext ausgewertet,
       `elFor` liegt aber draußen. */
    __elFor: elFor,
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
  planFreshness, bitpandaUrl, bitpandaTitle, googleFinanceUrl,   // v4.0.6
  HEADLINE_RANK, VERDICT_ICON,
  get mutedSetupSet(){return mutedSetupSet;}, set mutedSetupSet(v){mutedSetupSet=v;},
  get stockMeta(){return stockMeta;}, set stockMeta(v){stockMeta=v;},
  get stockRows(){return stockRows;}, set stockRows(v){stockRows=v;},
  get stockPositions(){return stockPositions;}, set stockPositions(v){stockPositions=v;},
  portfolioExposure, portfolioBlocksNewBuy, portfolioBudgetEur, sectorOfSymbol, positionRiskEur,
  stockStrength, DEFAULTS,
  GLOSS, gloss, gl, glossForSetup, glossForSituation, GLOSS_GROUPS, GLOSS_LABEL,
  el: __elFor,
  stockOpportunity, momentumOverlayRow,
  gateMissesOf, renderGateFunnel, GATE_LABEL, GATE_ORDER, patternCalibration,
  coinHeadline, buyReady, sizing, stockHeatmapMark, crowdStatus, crowdTrack, refreshRate,
  get crowdMeta(){return crowdMeta;}, set crowdMeta(v){crowdMeta=v;},
  get crowdMap(){return crowdMap;}, set crowdMap(v){crowdMap=v;},
  get crowdHistory(){return crowdHistory;}, set crowdHistory(v){crowdHistory=v;},
  get refreshHistory(){return refreshHistory;}, set refreshHistory(v){refreshHistory=v;},
  trackRefresh, crowdPrune, earningsFor, earningsWarning,
  /* v3.16.0: Variante 2 muss AUSGEFUEHRT geprueft werden koennen, nicht per
     Regex. Ohne diese Bindungen liesse sich nur nachweisen, dass der Code
     dasteht — nicht, dass Modus A wirklich keine Freigabe mehr erzeugt. */
  modeAActive, modeABlockText, modeAAgeTag, MODE_A_NO_RELEASE,
  stockSizeDisplay, stockLevel, stockTradeability, stockOrderPlan,
  earnEntryStatus, earnNormalizeRows, earnDaysUntil, EARN_WINDOW_DAYS,
  saveManualEarnings, addManualEarningFromForm, removeManualEarning, renderEarningsEditor,
  get earnData(){return earnData;}, set earnData(v){earnData=v;}, fngPlainOk:true, sentimentTitle, renderSentiment, loadSentiment,
  get fngData(){return fngData;}, set fngData(v){fngData=v;},
  dataSession, withLocalTime, etClockToLocal, nyDeltaMinutes, localTzLabel,
  stockOrderPlan, orderPlan,
  momentumOverlayRow, momentumModeOn, applyTradeModeView, sizeModeFixed, fixedTradeEur,
  MOMENTUM_VIEW_FIELDS, MIN_REWARD_RISK_FIXED,
  get focusStock(){return focusStock;}, set focusStock(v){focusStock=v;},
  /* v3.32.7: Die Systemleiste war bisher nur per Regex pruefbar. Drei
     Fehlversionen hintereinander (3.32.2 / 3.32.3 / 3.32.6) sind genau daran
     vorbeigelaufen: Der Quelltext sah jedes Mal richtig aus, das Verhalten war
     es nicht. Ausgefuehrt wird der Unterschied sichtbar. */
  renderResourceStrip,
  /* v3.32.8: R1.3/R1.4 muessen AUSGEFUEHRT prueffbar sein, nicht per Regex.
     Genau diese Luecke hat drei Fehlversionen durchgelassen. Ein Muster im
     Quelltext beweist, dass etwas dasteht — nicht, dass es das Richtige tut. */
  crvGeometry, crvGeometryRow,
  /* v4.1.5: Die Zerlegung des Vorrangs muss AUSGEFUEHRT prueffbar sein — vor
     allem der Fall ohne Zerlegung (Zeilen aus einem Scan vor 4.1.5). Ein
     Regex im Quelltext koennte nicht zeigen, dass dort nichts erfunden wird. */
  maturityTag,
  /* v4.1.7: Die Schreibbudget-Anzeige muss AUSGEFUEHRT prueffbar sein — vor
     allem die Faelle ohne Messung, in denen nichts beruhigt werden darf. */
  d1Note, vwapNote, coverageNote, d1ReadNote,
  /* v4.1.8: die Zustandstabellen, damit der neue Datenbank-Zustand AUSGEFUEHRT
     geprueft werden kann statt per Regex im Quelltext. */
  STATE_TEXT, STATE_TONE,
  /* v3.32.10 · Twin-Auswertung. Der lokale Zweig zaehlte auf die alte
     5-%-Marke, der D1-Zweig auf 2,04 % — dieselbe Kachel bedeutete je nach
     Quelle etwas anderes. Das ist nur AUSGEFUEHRT nachweisbar. */
  historicalTwin, edgeStrip, econWinPct, econStopPct,
  wilsonUpperPct, econBreakEvenPct, econBreakEvenFloorPct,
  get twinStore(){return twinStore;}, set twinStore(v){twinStore=v;},
  CRV_INFLATION_WARN, CRV_COST_SHARE_WARN, CRV_STRUCT_CONFLICT_FACTOR,
  get health(){return health;}, set health(v){health=v;},
  get authDenied(){return authDenied;}, set authDenied(v){authDenied=v;},
  get lastHttpStatus(){return lastHttpStatus;}, set lastHttpStatus(v){lastHttpStatus=v;}
};`;
  const src = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  vm.createContext(ctx);
  vm.runInContext(src + epilogue, ctx, { filename: 'app.js' });
  return ctx.__fp;
}
