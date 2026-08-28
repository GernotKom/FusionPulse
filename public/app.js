/* ============================================================================
   FusionPulse v3.14.3 — Frontend
   Leitgedanke: das Auge soll nicht 20 gleichwertige Kacheln absuchen müssen.
   Drei Ebenen: EIN Fokus-Setup (groß) → 2D-Karte (Position = Bedeutung) →
   dichte Liste (ausgerichtete Spalten). Handeln ohne Modal.
   ========================================================================== */

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

/* Version: kommt aus /version.js, das aus package.json generiert wird. */
const FP_VERSION = (typeof self !== 'undefined' && self.FP_VERSION) || '0.0.0';


/* ---------------------------------------------------- Netzwerk-Stabilität */
const NET_TIMEOUT_MS = 12_000;
let lastSuccessfulScanTs = 0;
let scanStartedTs = 0;
let reconnectAttempt = 0;
let connectionWatchdogTimer = null;

async function fetchWithTimeout(url, options = {}, timeoutMs = NET_TIMEOUT_MS) {
  const outerSignal = options.signal;
  const ac = new AbortController();
  let outerAbort;
  if (outerSignal) {
    if (outerSignal.aborted) ac.abort();
    else { outerAbort = () => ac.abort(); outerSignal.addEventListener('abort', outerAbort, { once: true }); }
  }
  const timerId = setTimeout(() => ac.abort('timeout'), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ac.signal, cache: options.cache || 'no-store' });
  } catch (e) {
    if (ac.signal.aborted && !outerSignal?.aborted) {
      const err = new Error(`Zeitüberschreitung nach ${Math.round(timeoutMs/1000)} s`);
      err.name = 'TimeoutError';
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timerId);
    if (outerSignal && outerAbort) outerSignal.removeEventListener('abort', outerAbort);
  }
}

function showReconnectState(reason='Datenabruf hängt') {
  const el=$('#status'); if(!el)return;
  el.textContent=`Verbindung wird wiederhergestellt · ${reason}`;
  el.dataset.state='busy';
  el.title='FusionPulse hat einen festhängenden oder veralteten Datenabruf erkannt. Der Watchdog bricht ihn ab und startet automatisch einen neuen Abruf. Kein Browser-Neustart nötig.';
}

function startConnectionWatchdog(){
  clearInterval(connectionWatchdogTimer);
  connectionWatchdogTimer=setInterval(()=>{
    if(document.visibilityState!=='visible')return;
    const now=Date.now();
    const stuck=scanning && scanStartedTs && now-scanStartedTs>NET_TIMEOUT_MS+5_000;
    const stale=lastSuccessfulScanTs && now-lastSuccessfulScanTs>90_000;
    if(!stuck && !stale)return;
    reconnectAttempt++;
    showReconnectState(stuck?'Abruf reagiert nicht':'letzter erfolgreicher Scan zu alt');
    try{controller?.abort();}catch{}
    scanning=false;
    setMiniStatus('#miniCrypto','warn','Krypto: Reconnect läuft · kein manueller Browser-Neustart nötig');
    setTimeout(()=>{ if(document.visibilityState==='visible') { loadHealth(); scan(false); } }, Math.min(4000,500+reconnectAttempt*500));
  },15_000);
}

/* ------------------------------------------------------------ Einstellungen */
const ALL_COMPONENTS = ['vwap', 'ema21', 'rs', 'mtf', 'volume', 'book', 'squeeze', 'pullback', 'elliott'];
const DEFAULTS = {
  equity: 5000, riskPct: 0.75, interval: 20000, deep: 20,
  sound: true, token: '', watch: 'BTC-EUR,ETH-EUR,SOL-EUR', minQ: 0, onlyZone: false,
  theme: 'dark', taxPct: 27.5, analysisMode: 'composite', coinCount: 12, stockCount: 12,
  maxTradeEur: 10000, minCrvCoin: 2.0, minCrvStock: 3.0, minNetProfitStock: 30, minTp2PctStock: 2.0,
  claudeMode: false, stockDeep: 20,
  /* v3.11.0 · Aufmerksamkeitsimpuls. Standardmaessig AN, aber bewusst sparsam:
     nur der staerkste NEUE Sektor-Nachzuegler pulsiert, und nur einmal. Wenn
     alles blinkt, blinkt nichts — der Impuls ist nur so viel wert, wie er
     selten ist. Abschaltbar, und `prefers-reduced-motion` gewinnt immer. */
  attentionPulse: true,
  /* v3.9.0 · Positionsgroesse: zwei Modelle, ausdruecklich getrennt.
     'risk'  = bisheriges Verhalten. Risiko je Trade ist die Eingabe (equity x riskPct),
               die Kaufsumme das Ergebnis. Enger Stop -> grosse Position. maxTradeEur deckelt.
     'fixed' = Kaufsumme ist die Eingabe (fixedTradeEur), das Risiko am Stop ist das ERGEBNIS
               und wird als Worst-Case-Betrag ausgewiesen statt vorgegeben.
     Default bleibt 'risk', damit weder der ChatGPT-Strang noch bestehende Nutzer
     ihr Verhalten aendern (Invariante 9). */
  sizeMode: 'risk', fixedTradeEur: 10000, maxLossEur: 400,
  /* v3.9.0 · Handelsmodus. 'off' = unveraendertes Verhalten (Default).
     'A' = Momentum-Tageshandel, 'B' = Large Cap / Position (noch Konzept). */
  /* v3.14.0: Voreinstellung von 'off' auf 'A' geaendert — ausdruecklich vom
     Nutzer so entschieden. Modus A wurde in v3.9.0 fuer genau seinen Fall
     gebaut (Momentum-Tageshandel auf Nachrichtenlage) und war seitdem inaktiv,
     weil die Voreinstellung nie umgelegt wurde. Damit lief weiterhin die alte
     Bewertung inklusive des 8R-Deckels, der laut Uebergabe den VEEV-Fall
     unmoeglich gemacht hat. */
  tradeMode: 'A',
  // v3.5.9 · Modul 2: Gesamt-Risikobudget ueber ALLE offenen Positionen (nicht je Trade)
  // und Klumpungswarnung. Default 3x das Einzeltrade-Risiko = drei parallele Trades.
  portfolioRiskPct: 2.25, portfolioGuard: false,
  // v3.6.5: SerpAPI-Freitarif = 100 Suchen/Monat. Weniger Symbole = laenger nutzbar.
  crowdSymbolLimit: 6,
  // v3.8.0: Tatsaechliche Handelskosten. flatex US-Direkthandel ~11,50 € je Order;
  // Tradegate ~7,90 €. Der Reibungswert deckt Spread und Slippage je Seite ab —
  // an der US-Heimatboerse ~0,15 %, auf Tradegate bei Nebenwerten deutlich mehr.
  orderFeeEur: 11.50, venueFrictionPct: 0.15,
  mutedPairs: [], mutedStocks: [], favoritePairs: [], favoriteStocks: [], stockOrder: [], components: [...ALL_COMPONENTS], stockSound: true,
};
const storedSettings = (() => { try { return JSON.parse(localStorage.getItem('fp.settings') || '{}'); } catch { return {}; } })();
const S = { ...DEFAULTS, ...storedSettings };
// v3.5.2 settings migration: 350 EUR war der alte, mathematisch unerreichbare Default.
// Nur der exakte alte Default wird migriert; bewusst individuell gesetzte Werte bleiben unangetastet.
let settingsMigrated352=false;
if(Number(storedSettings.minNetProfitStock)===350 && !storedSettings.fusionAdaptive352){S.minNetProfitStock=75;S.fusionAdaptive352=true;settingsMigrated352=true;}
// v3.5.3: der 75-EUR-Default konnte bei 5.000 EUR / 0,75 % Risiko still ein ~6R-Ziel erzwingen.
if(Number(S.minNetProfitStock)===75 && !storedSettings.fusionAdaptive353){S.minNetProfitStock=30;S.fusionAdaptive353=true;settingsMigrated352=true;}
/* v3.14.0 · Modus A aktivieren — und warum eine Default-Aenderung allein NICHT reicht.
   `S = {...DEFAULTS, ...storedSettings}`: ein bereits gespeichertes `tradeMode:'off'`
   ueberschreibt jeden neuen Default. Wer die App schon benutzt hat, haette von der
   Umstellung nichts gemerkt — der Schalter waere weiterhin aus gewesen und der
   8R-Deckel weiterhin aktiv.
   Deshalb eine einmalige Migration, die NUR den alten Default 'off' anfasst. Wer
   den Modus bewusst auf 'off' gestellt hat, nachdem er ihn einmal geaendert hatte,
   traegt `tradeModeChosen` und bleibt unangetastet. Die Migration laeuft genau
   einmal und wird dem Nutzer angezeigt, statt still zu passieren. */
let tradeModeMigrated314=false;
if(!storedSettings.tradeModeMigrated314){
  if(storedSettings.tradeMode==='off' && !storedSettings.tradeModeChosen){
    S.tradeMode='A'; tradeModeMigrated314=true;
  }
  S.tradeModeMigrated314=true;
}
// Flatex AT / Tradegate cost model (v3.0.4): public base fee + minimum venue cost
// per execution. Spread/slippage cannot be known from the Twelve Data candle feed,
// therefore a separate conservative execution reserve is shown as an estimate.
/* v3.8.0: Die Ordergebuehr war eine Konstante mit einer Herleitung, die fuer
   den tatsaechlichen Handelsplatz des Nutzers nicht stimmte (US-Direkthandel
   bei flatex liegt bei rund 11–12 € je Order, nicht 10,75 €). Da diese Zahl in
   JEDE Wirtschaftlichkeitsschwelle eingeht, gehoert sie in die Einstellungen —
   eine falsche Konstante verzerrt sonst alles darueber. Die alten Werte bleiben
   als Rueckfall, damit nichts kaputtgeht, wenn die Einstellung fehlt. */
const STOCK_ORDER_FIXED_EUR_DEFAULT = 10.75;
const STOCK_EXECUTION_FRICTION_PCT_DEFAULT = 0.06;
const orderFeeEur = () => { const v=Number(S?.orderFeeEur); return Number.isFinite(v)&&v>=0 ? v : STOCK_ORDER_FIXED_EUR_DEFAULT; };
const venueFrictionPct = () => { const v=Number(S?.venueFrictionPct); return Number.isFinite(v)&&v>=0 ? v : STOCK_EXECUTION_FRICTION_PCT_DEFAULT; };
const OPPORTUNITY_MIN_NET_EUR = 20; // v3.5.3: kleine absolute Untergrenze; Hauptkalibrierung erfolgt gegen das reale Risikobudget
const OPPORTUNITY_HIGH_NET_EUR = 500; // priorisierte High-Opportunity, keine Erfolgswahrscheinlichkeit

const FUSION_MIN_SCORE_STOCK = 7.2;
const FUSION_MIN_PLAN_EFFICIENCY = 0.85; // 50/50-Plan nach Fixkosten muss mindestens 0,85R liefern; NICHT mit Struktur-CRV verwechseln
/* v3.9.0 · Mindestverhaeltnis Zielweite : Stopweite im Fixbetrags-Modus.
   Herleitung (10.000 EUR Einsatz, 11,50 EUR je Order, 0,15 % Reibung, 27,5 % KESt):
   Bei Stop -2 % kostet ein Verlusttrade rund 238 EUR. Ein Gewinntrade bei Ziel +2 %
   bringt netto rund 162 EUR -> noetige Trefferquote 60 %. Bei Ziel +4 % (= 2x Stop)
   sind es rund 362 EUR -> noetige Trefferquote 40 %. Die Asymmetrie kommt daher, dass
   Gewinne besteuert werden und Verluste die vollen Kosten mittragen.
   2,0 ist damit keine runde Zahl aus Gewohnheit, sondern die Grenze, ab der ein
   Momentum-Setup mit realistischer Trefferquote ueberhaupt tragfaehig ist. */
const MIN_REWARD_RISK_FIXED = 2.0;
const FUSION_MIN_NET_RISK_MULT = 0.75; // v3.5.3: wirtschaftliche Relevanz skaliert am realen Risikobudget, nicht am Notional
const fusionMinNetEur = (sz) => {
  const riskBudget=Math.max(0,Number(S.equity||0)*(Number(S.riskPct||0)/100));
  const riskCalibrated=Math.max(OPPORTUNITY_MIN_NET_EUR,riskBudget*FUSION_MIN_NET_RISK_MULT);
  // Ein bewusst hoeher gesetzter Nutzerwert bleibt sichtbar, darf aber nicht wieder
  // unbemerkt ein strukturell viel hoeheres CRV erzwingen: die effektive Schwelle
  // wird auf 1,0R des aktuellen Risikobudgets begrenzt.
  const userFloor=Math.max(0,Number(S.minNetProfitStock||0));
  const reachableCap=Math.max(OPPORTUNITY_MIN_NET_EUR,riskBudget);
  return Math.min(Math.max(userFloor,riskCalibrated),reachableCap);
};

/* ---- v3.5.0 Claude Modus --------------------------------------------------
   Legacy-Befund: Der 50/50-Plan (TP1=1,7R / TP2=3,35R) hat brutto max. 2,525R,
   das Gate verlangte aber Plan-CRV >= 3:1 netto UND >= 350 EUR netto bei einem
   Risikobudget, dessen Maximalplan (Equity 5000 x 0,75 % = 37,50 EUR Risiko)
   nach Kosten/KESt bei ~43 EUR endet. Beide Gates waren mathematisch
   unerfuellbar -> es konnte NIE eine Opportunity/BUY erscheinen.
   Der Claude-Modus nutzt serverseitig konsistent berechnete Struktur-Ziele,
   erreichbare Netto-CRV-Schwellen und skaliert die wirtschaftliche
   Mindestgroesse am Risikobudget statt an einer fixen 350-EUR-Wunschzahl.
   Alle Fail-Closed-Datenqualitaetsregeln bleiben unveraendert aktiv. */
const CLAUDE_MIN_CRV_STOCK = 1.6;   // Plan-CRV netto; mit Strukturzielen erreichbar
const CLAUDE_MIN_CRV_COIN = 1.4;    // netto nach Fee+Spread+Slippage
const CLAUDE_MIN_SCORE_STOCK = 7;   // statt 8 bei theoretischem Max. 8,74
const claudeMinNetEur = (riskEur) => Math.max(120, riskEur * 1.2); // >= 1,2R netto
if (!Array.isArray(S.components) || !S.components.length) S.components = [...ALL_COMPONENTS];
S.components = S.components.filter((c) => ALL_COMPONENTS.includes(c));
if (!S.components.length) S.components = [...ALL_COMPONENTS];
const saveSettings = () => { try { localStorage.setItem('fp.settings', JSON.stringify(S)); } catch {} };
if(settingsMigrated352) saveSettings();
/* v3.14.0: Die Modus-Migration muss gespeichert werden, sonst laeuft sie bei
   jedem Laden erneut und wuerde eine spaetere bewusste Abschaltung ueberschreiben. */
if(tradeModeMigrated314 || S.tradeModeMigrated314!==storedSettings.tradeModeMigrated314) saveSettings();

let rows = [];
let meta = {};
let stockRows = [];
// v3.3.0: Browser-Stock-Cache is versioned separately from the server cache.
// v1 could resurrect old Discovery ETFs after the Worker had already rejected them.
const LEGACY_STOCK_LAST_ROWS_KEY='fp.stockLastRows.v1';
const STOCK_LAST_ROWS_KEY='fp.stockLastRows.v2';
const UI_NON_COMMON_SYMBOL_DENY=new Set(['CRWU','AXTU']);
const UI_NON_COMMON_EQUITY_RE=/(?:\bETF\b|\bETN\b|\bETP\b|EXCHANGE[- ]TRADED|DAILY TARGET|\b2X\b|\b3X\b|ULTRA(?:PRO)?\b|\bINVERSE\b|LEVERAGED\b|DIREXION|PROSHARES|T-?REX|GRANITESHARES|DEFIANCE|ROUNDHILL|YIELDMAX|REX SHARES|TRADR|\bWARRANTS?\b|\bUNITS?\b|\bRIGHTS?\b|PREFERRED)/i;
function uiStockRowAllowed(r){
  const sym=String(r?.symbol||'').trim().toUpperCase();
  if(!sym || UI_NON_COMMON_SYMBOL_DENY.has(sym)) return false;
  if(r?.assetType && String(r.assetType).toLowerCase()!=='stock') return false;
  return !UI_NON_COMMON_EQUITY_RE.test(`${r?.securityName||''} ${r?.name||''} ${r?.description||''}`);
}
try{localStorage.removeItem(LEGACY_STOCK_LAST_ROWS_KEY);}catch{}
let stockLastRows=(()=>{try{const cached=JSON.parse(localStorage.getItem(STOCK_LAST_ROWS_KEY)||'[]');return new Map((Array.isArray(cached)?cached:[]).filter(r=>r?.symbol&&uiStockRowAllowed(r)).map(r=>[String(r.symbol).toUpperCase(),r]));}catch{return new Map();}})();
function rememberStockRows(rows){
  for(const r of rows||[])if(r?.symbol&&uiStockRowAllowed(r))stockLastRows.set(String(r.symbol).toUpperCase(),r);
  const vals=[...stockLastRows.values()].filter(uiStockRowAllowed).slice(-120);
  stockLastRows=new Map(vals.map(r=>[String(r.symbol).toUpperCase(),r]));
  try{localStorage.setItem(STOCK_LAST_ROWS_KEY,JSON.stringify(vals));}catch{}
}
function mergeFavoriteRows(rows){
  // Server rows are authoritative. Cache may only preserve a missing favorite OR
  // the explicitly focused stock; never silently replace the requested ticker.
  const m=new Map((rows||[]).filter(r=>r?.symbol&&uiStockRowAllowed(r)).map(r=>[String(r.symbol).toUpperCase(),r]));
  for(const [sym,old] of stockLastRows){
    if((!isFavStock(sym) && sym!==String(focusStock||'').toUpperCase()) || !old || !uiStockRowAllowed(old) || m.has(sym)) continue;
    m.set(sym,{...old,_staleLast:true,_staleFavorite:isFavStock(sym)});
  }
  return [...m.values()];
}
let focusStock = '';
let stockChartMinutes = '120';
const stockChartCache=new Map();
let stockMeta = {};
let stockTimer = null;
let healthTimer = null;
let timer = null;
let scanning = false, scanReqSeq = 0;
let lastCryptoDataTs = 0;
let selected = null;        // aktuell fokussiertes Paar
let pinned = false;         // vom Nutzer gewählt → nicht automatisch wegspringen
let showRest = false;
let ac = null;
let health = {};
let quotaShownFor = '';     // verhindert Dauer-Popups für dieselbe Lage
let stockSearchBusy = false;
let stockSearchLastTs = 0;
let stockLookupSeq = 0;
let openingRows = [];
let openingMeta = {};
let openingTimer = null;
let experimentalData = {};
let experimentalTimer = null;
let crowdMap = new Map();
let crowdMeta = {};
let crowdTimer = null;
let learningData = { configured:false, state:'loading', stats:{} };
let learningStock = new Map();
let learningCoin = new Map();
let learningTimer = null;

const state = new Map();      // pair   -> { light, since, streak, level, … }
const stockState = new Map(); // symbol -> { light, since, streak, level }
const rowNodes = new Map();   // pair   -> DOM-Zeile


/* v3.0.7: 120-Minuten-Historie über Reloads hinweg erhalten. */
const HISTORY_WINDOW_MS = 120 * 60_000;
const COIN_HISTORY_KEY = 'fp.coinHistory.v1';
const STOCK_HISTORY_KEY = 'fp.stockHistory.v1';
function loadHistoryStore(key) {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '{}');
    const cutoff = Date.now() - HISTORY_WINDOW_MS;
    for (const k of Object.keys(raw)) raw[k] = (raw[k] || []).filter(x => Number(x.ts) >= cutoff);
    return raw;
  } catch { return {}; }
}
let coinHistoryStore = loadHistoryStore(COIN_HISTORY_KEY);
let stockHistoryStore = loadHistoryStore(STOCK_HISTORY_KEY);
function persistHistory(key, store) {
  try { localStorage.setItem(key, JSON.stringify(store)); } catch { /* Speicher ggf. voll/blockiert */ }
}
function appendHistory(store, key, point) {
  const cutoff = Date.now() - HISTORY_WINDOW_MS;
  const h = (store[key] || []).filter(x => Number(x.ts) >= cutoff);
  const last = h.at(-1);
  if (!last || point.ts - last.ts >= 55_000 || last.light !== point.light) h.push(point);
  store[key] = h.slice(-140);
  return store[key];
}

/* ----------------------------------------------------------------- Formate */
const dp = (n) => (Math.abs(n) < 1 ? 5 : Math.abs(n) < 100 ? 3 : 2);
const eur = (n, d) => new Intl.NumberFormat('de-AT', {
  style: 'currency', currency: 'EUR',
  minimumFractionDigits: d ?? dp(n), maximumFractionDigits: d ?? dp(n),
}).format(n || 0);
const usd = (n, d) => new Intl.NumberFormat('de-AT', {
  style: 'currency', currency: 'USD',
  minimumFractionDigits: d ?? 2, maximumFractionDigits: d ?? 2,
}).format(n || 0);
const num = (n, d) => new Intl.NumberFormat('de-AT', {
  minimumFractionDigits: d ?? dp(n), maximumFractionDigits: d ?? dp(n),
}).format(n || 0);
const sym = (p) => p.replace('-EUR', '');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const mins = (ms) => {
  const m = Math.floor(ms / 60000);
  return m < 1 ? 'neu' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h`;
};

const clock = (ts) => {
  const d = new Date(Number(ts)||ts);
  return Number.isFinite(d.getTime()) ? d.toLocaleTimeString('de-AT',{hour:'2-digit',minute:'2-digit',second:'2-digit'}) : '–';
};
function stockFreshness(r){
  const refreshed=new Set(stockMeta?.refreshedSymbols||[]), sym=String(r?.symbol||'').toUpperCase();
  if(r?._staleLast) return {key:'cached',label:'ANGEZEIGT / NICHT DIESE RUNDE'};
  if(refreshed.has(sym) && Date.now()-Number(stockMeta?.ts||0)<90_000) return {key:'live',label:'AKTUELLER SCAN'};
  const raw=String(r?.updated||'').trim(); if(!raw) return {key:'na',label:'DATEN n. v.'};
  const t=Date.parse(raw.replace(' ','T')+'Z');
  if(Number.isFinite(t)){const age=Date.now()-t;if(age>24*60*60_000)return {key:'stale',label:'STALE'};if(age>20*60_000)return {key:'cached',label:'GECACHED'};}
  return {key:'cached',label:'ANGEZEIGT / NICHT DIESE RUNDE'};
}
/* v3.6.1: Wie oft wird DIESE Aktie eigentlich aktualisiert? Bisher war nur
   sichtbar, WANN zuletzt — nicht, ob sie oefter drankommt als die anderen.
   Gezaehlt wird clientseitig aus den tatsaechlich beobachteten Zeitstempeln;
   nichts wird geschaetzt, solange zu wenige Punkte vorliegen. */
const REFRESH_HIST_KEY='fp.refreshRate.v1';
let refreshHistory=(()=>{try{return JSON.parse(localStorage.getItem(REFRESH_HIST_KEY)||'{}')||{};}catch{return {};}})();
function trackRefresh(symbols){
  const now=Date.now(); let dirty=false;
  for(const sym of symbols||[]){
    const k=String(sym||'').toUpperCase(); if(!k) continue;
    const list=(refreshHistory[k]||[]).filter(t=>now-t<=6*60*60_000);
    if(!list.length||now-list[list.length-1]>=20_000){ list.push(now); dirty=true; }
    refreshHistory[k]=list.slice(-120);
  }
  if(dirty){try{localStorage.setItem(REFRESH_HIST_KEY,JSON.stringify(refreshHistory));}catch{}}
}
/** Beobachtete Aktualisierungen je Stunde, plus Vergleich zum Median aller. */
function refreshRate(symbol){
  const k=String(symbol||'').toUpperCase();
  const now=Date.now(), win=60*60_000;
  const cnt=(x)=>(refreshHistory[x]||[]).filter(t=>now-t<=win).length;
  const n=cnt(k);
  const spanMs=Math.min(win, now-Math.min(...((refreshHistory[k]||[]).length?refreshHistory[k]:[now])));
  if(n<3||spanMs<10*60_000) return {n,perHour:null,rel:null,label:'Frequenz wird noch gemessen',
    detail:'Für eine belastbare Aussage fehlen noch Messpunkte. Es wird bewusst nichts hochgerechnet.'};
  const perHour=n/(spanMs/win);
  const others=Object.keys(refreshHistory).filter(x=>x!==k).map(cnt).filter(v=>v>0).sort((a,b)=>a-b);
  const med=others.length?others[Math.floor(others.length/2)]:null;
  const rel=med?perHour/med:null;
  const label = rel==null ? `≈ ${num(perHour,1)}× pro Stunde`
    : rel>=1.6 ? `≈ ${num(perHour,1)}×/h · engmaschiger als der Rest`
    : rel<=0.6 ? `≈ ${num(perHour,1)}×/h · seltener als der Rest`
    : `≈ ${num(perHour,1)}×/h · wie der Rest`;
  return {n,perHour,rel,label,
    detail:`Tatsächlich beobachtete Aktualisierungen dieser Aktie in der letzten Stunde: ${n}.${med?` Median über alle beobachteten Titel: ${med}.`:''} Favoriten und die im Fokus stehende Aktie werden bevorzugt nachgeladen, der serverseitige Tiefenscan läuft davon unabhängig weiter.`};
}

const stockUpdateLabel = (r) => {const f=stockFreshness(r);return `${f.label} · Abfrage ${clock(stockMeta?.ts)} · Daten ${r?.updated||'–'}`;};
const regimeExplanation = () => $('#regime')?.dataset.tip || 'Marktregime noch nicht verfügbar.';

const isMuted = (pair) => (S.mutedPairs || []).includes(pair);
const isStockMuted = (s) => (S.mutedStocks || []).includes(s);
const isFavPair = (pair) => (S.favoritePairs || []).includes(pair);
const isFavStock = (symbol) => (S.favoriteStocks || []).includes(symbol);
const stockOrderIndex = (symbol) => { const i=(S.stockOrder||[]).indexOf(String(symbol||'').toUpperCase()); return i < 0 ? 99999 : i; };
function saveStockOrder(order){
  const clean=[...new Set((order||[]).map(x=>String(x||'').toUpperCase()).filter(Boolean))];
  S.stockOrder=clean; saveSettings();
}
function moveFavorite(from,to){
  const a=[...(S.favoriteStocks||[])], i=a.indexOf(from), j=a.indexOf(to); if(i<0||j<0||i===j)return;
  const [x]=a.splice(i,1); a.splice(j,0,x); S.favoriteStocks=a;
  const rest=(S.stockOrder||[]).filter(x=>!a.includes(x)); saveStockOrder([...a,...rest]); renderStocks();
}

function togglePairFavorite(pair, ev) {
  ev?.stopPropagation();
  const set = new Set(S.favoritePairs || []);
  if (set.has(pair)) set.delete(pair); else set.add(pair);
  S.favoritePairs = [...set]; saveSettings(); render();
}
function toggleStockFavorite(symbol, ev) {
  ev?.stopPropagation();
  const set = new Set(S.favoriteStocks || []);
  if (set.has(symbol)) set.delete(symbol); else set.add(symbol);
  S.favoriteStocks = [...set]; rememberStockRows(stockRows); stockRows=mergeFavoriteRows(stockRows); saveSettings(); renderStocks();
}

function togglePairMute(pair, ev) {
  ev?.stopPropagation();
  const set = new Set(S.mutedPairs || []);
  if (set.has(pair)) set.delete(pair); else set.add(pair);
  S.mutedPairs = [...set]; saveSettings(); renderList(); renderFocus();
}
function toggleStockMute(symbol, ev) {
  ev?.stopPropagation();
  const set = new Set(S.mutedStocks || []);
  if (set.has(symbol)) set.delete(symbol); else set.add(symbol);
  S.mutedStocks = [...set]; saveSettings(); renderStocks();
}

/* --- Signalstufen ----------------------------------------------------------
   Eine Stufe ist die Einheit, in der akustisch UND farblich gedacht wird.
   0 = kein Trade · 1 = beobachten · 2 = positives Setup · 3 = Kauf-Freigabe */
/* ---- Claude-Modus-Overlay -------------------------------------------------
   Idempotent und reversibel: Originalwerte werden einmalig unter r.fpBase
   gesichert; je nach S.claudeMode werden Anzeige-Felder aus r.claude oder aus
   r.fpBase gespeist. Zeilen ohne r.claude (alte Caches / alter Worker) bleiben
   vollstaendig im Legacy-Verhalten. */
const CLAUDE_VIEW_FIELDS = ['light', 'score', 'verdict', 'netCRV', 'tp2Usd', 'tp2Eur', 'tp2Pct', 'tp2Source', 'blockers'];
function claudeOverlayRow(r) {
  if (!r || typeof r !== 'object') return r;
  if (!r.fpBase) { r.fpBase = {}; for (const k of CLAUDE_VIEW_FIELDS) r.fpBase[k] = r[k]; }
  const useClaude = !!S.claudeMode && !!r.claude;
  for (const k of CLAUDE_VIEW_FIELDS) {
    const v = useClaude ? (r.claude[k] !== undefined ? r.claude[k] : r.fpBase[k]) : r.fpBase[k];
    if (v === undefined) delete r[k]; else r[k] = v;
  }
  r.claudeActive = useClaude;
  return r;
}
function applyAnalysisView() {
  (rows || []).forEach(claudeOverlayRow);
  (stockRows || []).forEach(claudeOverlayRow);
}

function buyReady(r) {
  const minCrv = (S.claudeMode && r.claude) ? CLAUDE_MIN_CRV_COIN : Number(S.minCrvCoin || DEFAULTS.minCrvCoin);
  return r.light === 'green' && r.inZone && Number(r.netCRV || 0) >= minCrv;
}
const coinLevel = (r) => (buyReady(r) ? 3 : r.light === 'green' ? 2 : r.light === 'yellow' ? 1 : 0);

/* ---- v3.9.0 Modus-A-Overlay ------------------------------------------------
   Steht bewusst HIER, hinter `function buyReady`, und nicht neben
   claudeOverlayRow(): der Testanker fuer den SHA-verriegelten Claude-Overlay
   reicht von '/* ---- Claude-Modus-Overlay' bis 'function buyReady'. Code in
   diesem Bereich aendert die Pruefsumme, auch wenn er den Claude-Code selbst
   nicht anfasst. Genau das ist mir beim ersten Versuch passiert — der Test hat
   es gefangen, was zeigt, dass die Verriegelung ihren Zweck erfuellt.

   Der Momentum-Overlay ueberschreibt Anzeigefelder nur, wenn Modus A aktiv ist
   UND der Worker einen Momentum-Block geliefert hat. Alte Caches fallen still
   ins bisherige Verhalten. Anders als der Claude-Modus, der nur TP2 verschiebt,
   ersetzt Modus A auch Entry/Stop/TP1 — daher die laengere Feldliste. */
const MOMENTUM_VIEW_FIELDS = ['light', 'score', 'verdict', 'tp2Usd', 'tp2Eur', 'tp2Pct', 'tp2Source', 'blockers',
  'entryUsd', 'entryEur', 'stopUsd', 'stopEur', 'tp1Usd', 'tp1Eur'];
const momentumModeOn = () => String(S?.tradeMode || 'off') === 'A';
function momentumOverlayRow(r) {
  if (!r || typeof r !== 'object') return r;
  if (!r.momBase) { r.momBase = {}; for (const k of MOMENTUM_VIEW_FIELDS) r.momBase[k] = r[k]; }
  const useMom = momentumModeOn() && !!r.momentum;
  for (const k of MOMENTUM_VIEW_FIELDS) {
    const v = useMom ? (r.momentum[k] !== undefined && r.momentum[k] !== null ? r.momentum[k] : r.momBase[k]) : r.momBase[k];
    if (v === undefined) delete r[k]; else r[k] = v;
  }
  r.momentumActive = useMom;
  return r;
}
/* Wird ueberall dort aufgerufen, wo bisher applyAnalysisView() stand. Der
   Claude-Overlay laeuft zuerst (unveraendert), Modus A danach: das speziellere
   Regelwerk gewinnt. */
function applyTradeModeView() {
  applyAnalysisView();
  (stockRows || []).forEach(momentumOverlayRow);
}

/* v3.9.0 · Der Hinweis in den Einstellungen rechnet dem Nutzer VOR, was seine
   Wahl bedeutet, statt sie nur zu benennen. Im Fixmodus ist die entscheidende
   Zahl nicht der Einsatz, sondern der Verlust bei typischen Stop-Distanzen —
   und die steht sonst nirgends, bevor der erste Trade auf dem Schirm ist. */
function renderSizeModeHint() {
  const el = $('#sRiskModeHint'); if (!el) return;
  const fee = orderFeeEur(), fric = venueFrictionPct();
  if (sizeModeFixed()) {
    const n = fixedTradeEur();
    const cost = fee * 2 + n * (fric / 100);
    const line = (pct) => `Stop ${String(pct).replace('.', ',')} % → Verlust rund ${eur(n * (pct / 100) + cost, 0)}`;
    el.innerHTML = `Aktiv: <b>fester Einsatz ${eur(n, 0)}</b>. Konto-Equity und Risiko-Prozent steuern die Positionsgröße dann <b>nicht</b> mehr.<br>`
      + `Was das im Verlustfall bedeutet (inkl. ${eur(cost, 0)} Ausführungskosten): ${line(1)} · ${line(2)} · ${line(4)}.`;
  } else {
    const riskEur = Number(S.equity) * (Number(S.riskPct) / 100);
    const bind = riskEur > 0 && S.maxTradeEur > 0 ? (riskEur / Number(S.maxTradeEur)) * 100 : null;
    el.innerHTML = `Aktiv: <b>risikobasiert</b>, ${eur(riskEur, 2)} je Trade (${num(S.riskPct, 2)} % von ${eur(S.equity, 0)}).`
      + (bind ? `<br>Bei einem Stop enger als <b>${num(bind, 2)} %</b> greift der Deckel von ${eur(S.maxTradeEur, 0)}`
        + (Number(S.maxTradeEur) > Number(S.equity) ? ` — dieser Deckel liegt <b>über</b> deinem Konto und bedeutet dann Wertpapierkredit.` : `.`) : '');
  }
}
function stockTradeability(r) {
  const claude = !!(S.claudeMode && r.claude);
  const sz = stockSizing(r); // Claude-Zweig bleibt unveraendert: Overlay liefert dessen Struktur-TP2.
  const tp2Pct = Number(r.tp2Pct ?? (r.entryUsd ? ((r.tp2Usd / r.entryUsd - 1) * 100) : 0));
  const netProfit = Number(sz?.planNet ?? 0);
  const planEfficiency = Number(sz?.planCrvAfterCosts ?? 0);
  const structuralCrv = Number(r.netCRV ?? 0);
  const gateCrv = claude ? planEfficiency : structuralCrv;
  const currentPhase = stockMeta?.market?.key || r.marketPhase;
  const marketOk = !!currentPhase && ['regular','opening'].includes(currentPhase);
  const riskEur = S.equity * (S.riskPct / 100);
  const minNet = claude ? claudeMinNetEur(riskEur) : fusionMinNetEur(sz);
  const minCrv = claude ? CLAUDE_MIN_CRV_STOCK : Number(S.minCrvStock || 3);
  const minTp2 = claude ? Math.max(Number(S.minTp2PctStock || 0), 0.6) : Number(S.minTp2PctStock || 0);
  const planOk = claude ? true : planEfficiency >= FUSION_MIN_PLAN_EFFICIENCY;

  /* v3.9.0 · Im Fixmodus ist ein Mindest-Nettogewinn in Euro die falsche Huerde.
     Bei fester Kaufsumme ist der Gewinn eine reine Funktion des Kursweges — die
     Schwelle wuerde nur noch messen, wie weit das Ziel weg ist, und zwar doppelt
     (minTp2 tut das bereits). Was im Fixmodus tatsaechlich ueber Gewinn und
     Verlust entscheidet, ist das Verhaeltnis von Zielweite zu Stopweite:
     Ziel >= 2x Stop laesst sich mit rund 34–40 % Trefferquote nach Kosten und
     KESt gewinnbringend handeln, Ziel = Stop braucht ueber 60 %.
     Die Schwelle kann ausschliesslich ABWERTEN: sie ersetzt keine bestehende
     Bedingung, sondern tritt zusaetzlich neben minTp2/minCrv. */
  const rewardRisk = Number(sz?.rewardRiskRaw ?? 0);
  const fixed = sizeModeFixed();
  const minRewardRisk = fixed ? MIN_REWARD_RISK_FIXED : 0;
  const rewardRiskOk = !fixed || (Number.isFinite(rewardRisk) && rewardRisk >= minRewardRisk);
  /* Der Mindest-Eurogewinn bleibt im Risikomodus scharf und wird im Fixmodus
     bewusst NICHT als erfuellt behandelt, sondern durch die haertere Bedingung
     ersetzt. Fail-closed: fehlt sz, ist nichts erfuellt. */
  const netOk = fixed ? !!sz : netProfit >= minNet;
  /* Worst Case: im Fixmodus vom Nutzer deckelbar. Auch das kann nur abwerten. */
  const maxLoss = Math.max(0, Number(S.maxLossEur || 0));
  const worstCase = Number(sz?.stopLossAfterCosts ?? NaN);
  const lossOk = !fixed || !maxLoss || (Number.isFinite(worstCase) && worstCase <= maxLoss);

  const ok = marketOk && tp2Pct >= minTp2
    && netOk
    && gateCrv >= minCrv
    && planOk
    && rewardRiskOk
    && lossOk;
  return { ok, tp2Pct, netProfit, netCrv:gateCrv, structuralCrv, planEfficiency, planOk, marketOk, minNet, minCrv, minPlanEfficiency:FUSION_MIN_PLAN_EFFICIENCY, claude,
    fixedSize:fixed, rewardRisk, minRewardRisk, rewardRiskOk, worstCase, maxLoss, lossOk, netOk };
}
/* ==== v3.6.0 · GLOSSAR ======================================================
   Ein zentraler Ort fuer jede Erklaerung, statt derselbe Begriff an fuenf
   Stellen in fuenf Varianten. Regel fuer jeden Eintrag:
   1. Erst in normaler Sprache sagen, WAS es ist.
   2. Dann sagen, WOZU es hier dient.
   3. Wo es sinnvoll ist: sagen, was es ausdruecklich NICHT bedeutet.
   Der Fachbegriff steht dabei, wird aber nie vorausgesetzt.                  */
const GLOSS = {
  /* --- Setup-Typen (das, was Modul 0 stummschalten kann) --- */
  pullback:'Pullback (Rücksetzer): Der Kurs ist zuerst gestiegen und gibt danach ein Stück nach. Die Idee dahinter ist, günstiger einzusteigen als am Hoch — aber nur, wenn der Aufwärtstrend danach wieder anspringt. Ein Rücksetzer allein ist noch kein Kaufsignal; er kann genauso gut der Anfang einer Trendwende sein.',
  breakout:'Breakout (Ausbruch): Der Kurs verlässt nach oben eine Spanne, in der er längere Zeit gefangen war. Die Idee ist, dass sich aufgestaute Kaufbereitschaft entlädt. Ausbrüche scheitern häufig („Fehlausbruch"), deshalb zählt hier zusätzlich das Volumen.',
  squeeze:'Squeeze (Kompression): Die täglichen Schwankungen sind ungewöhnlich klein geworden — der Kurs „staut sich auf". Danach folgt oft eine größere Bewegung, aber die Richtung sagt die Kompression NICHT voraus. Sie ist ein Timing-Hinweis, keine Richtungsprognose.',
  reclaim:'Reclaim (Rückeroberung): Der Kurs holt sich eine wichtige Marke zurück, die er vorher verloren hatte. Das gilt als Zeichen, dass die Verkäufer die Oberhand verlieren — zählt aber erst, wenn Volumen und kurzfristiger Trend mitziehen.',
  elliott:'Elliott/Fibonacci: Ein Versuch, Kursverläufe in wiederkehrende Wellen zu zerlegen (Impuls nach oben, Korrektur zurück). FusionPulse beschriftet keine Wellen von Hand, sondern rechnet daraus eine Kennzahl von 0 bis 10. Umstrittene Methode — hier bewusst nur EIN Baustein von mehreren.',
  relative:'Relative Stärke: Läuft dieser Titel besser als der Gesamtmarkt bzw. Bitcoin? Das ist ein Bestätigungsfaktor, kein eigenständiges Kaufsignal — auch ein starker Titel fällt in einem fallenden Markt mit.',

  /* --- Analysemethoden (die Häkchen in den Einstellungen) --- */
  vwap:'VWAP = Volumengewichteter Durchschnittspreis. Der Durchschnittskurs des Tages, bei dem große Umsätze stärker zählen als kleine. Praktisch: der Preis, den „der Markt im Schnitt bezahlt hat". Liegt der Kurs darüber, sind die Käufer im Vorteil. Dient hier als Anker für die Einstiegszone.',
  ema21:'EMA = Exponentieller gleitender Durchschnitt. Eine geglättete Kurslinie, bei der die jüngsten Kurse stärker zählen als ältere. Liegen die kurze (EMA9), mittlere (EMA21) und lange Linie (EMA50) sauber übereinander, spricht das für einen intakten Trend („Trendstaffelung").',
  rs:'Relative Stärke gegenüber Bitcoin, bereinigt um die unterschiedliche Schwankungsbreite. Beantwortet: bewegt sich dieser Coin aus eigener Kraft oder nur, weil der ganze Markt läuft?',
  mtf:'Multi-Timeframe = mehrere Zeitebenen gleichzeitig (5 Minuten, 15 Minuten, 1 Stunde). Ein Signal, das nur auf einer Ebene gut aussieht, ist oft Zufall. Kostet hier keine zusätzlichen Abfragen, weil alle drei aus denselben Daten gerechnet werden.',
  volume:'Volumen = wie viele Stücke tatsächlich gehandelt wurden. Wichtig, weil eine Kursbewegung ohne Umsatz wenig aussagt: sie kann von wenigen Orders stammen. Verglichen wird gegen einen eigenen früheren Zeitraum, damit „viel" auch wirklich viel ist.',
  book:'Orderbuch = die Liste aller aktuell offenen Kauf- und Verkaufsangebote. Zeigt, ob mehr Käufer oder Verkäufer warten (Imbalance), wie teuer der Ein- und Ausstieg wird (Spread) und ob deine Order den Kurs selbst bewegen würde (Slippage). Nur bei Krypto verfügbar; jede Abfrage kostet ein API-Kontingent.',

  /* --- Bewertungsgroessen --- */
  crv:'CRV = Chance-Risiko-Verhältnis. Wie viel du gewinnen kannst im Verhältnis zu dem, was du verlierst, wenn der Stop greift. 3:1 heißt: drei Euro möglicher Gewinn je Euro Risiko. „Netto" bedeutet: Gebühren, Spread und Steuerschätzung sind schon abgezogen.',
  planEff:'Plan-Effizienz: Das Chance-Risiko-Verhältnis deines TATSÄCHLICHEN Plans — also mit Teilverkauf von 50 % bei TP1 und 50 % bei TP2, nach allen geschätzten Kosten. Nicht mit dem Struktur-CRV verwechseln: das misst den Weg bis zum vollen Ziel, diese Zahl misst, was der reale Verkaufsplan davon übriglässt.',
  rMultiple:'R = eine Einheit Risiko, also genau der Betrag, den du bei ausgelöstem Stop verlierst. „+2R" heißt: der doppelte Einsatz gewonnen. Der Vorteil dieser Einheit: Trades verschiedener Größe werden vergleichbar.',
  expectancy:'Erwartungswert (EV): Was dieses Setup im Durchschnitt über viele Wiederholungen einbringt — Trefferquote und Gewinngröße gegeneinander verrechnet. Ein positiver Erwartungswert sagt NICHT, dass dieser eine Trade gewinnt. Er sagt, dass es sich lohnt, ihn oft zu wiederholen.',
  atr:'ATR = durchschnittliche Schwankungsbreite. Wie weit sich der Kurs an einem typischen Tag bewegt. Wird hier benutzt, um den Stop weit genug vom Kurs zu setzen — ein Stop innerhalb des normalen Rauschens wird fast sicher ausgelöst, ohne dass die Idee falsch war.',
  rvol:'Relatives Volumen (RVOL): Wie viel heute gehandelt wird im Vergleich zu einem normalen Tag. 2× heißt doppelt so viel Aufmerksamkeit wie üblich. Sagt nichts über die Richtung.',
  notional:'Kaufsumme (Notional): Was du insgesamt investierst — Stückzahl × Kurs. Nicht zu verwechseln mit dem Risiko: das ist nur der Teil, den du bis zum Stop verlieren kannst, üblicherweise ein kleiner Bruchteil davon.',
  /* v3.9.0 · Begriffe zu Positionsgröße und Handelsmodus. Jeder Eintrag sagt:
     was ist es, wozu dient es hier, was heißt es ausdrücklich NICHT. */
  sizeModeRisk:'Risikobasierte Positionsgröße: Du legst fest, wie viel Geld ein einzelner Trade dich im schlechtesten Fall kosten darf (z. B. 0,75 % von 5.000 € = 37,50 €). Die App rechnet daraus rückwärts, wie viele Stück du kaufen musst, damit genau dieser Betrag bis zum Stop auf dem Spiel steht. Folge: Je näher der Stop am Einstieg liegt, desto GRÖSSER wird die Position — bei einem Stop 0,375 % entfernt wären das bereits 10.000 €. Das ist kein Fehler, sondern die Logik des Modells. Es heißt ausdrücklich NICHT, dass dein Verlust auf diesen Betrag begrenzt ist: über Nacht kann ein Kurs unter deinem Stop eröffnen, und dann verlierst du mehr.',
  sizeModeFixed:'Fester Einsatz: Du legst fest, wie viel Geld du pro Trade investierst (z. B. immer 10.000 €), unabhängig davon, wo der Stop sitzt. Der mögliche Verlust ist dann das Ergebnis und keine Vorgabe — er steht auf jeder Karte als "Verlust am Stop inkl. Kosten". Wozu: Wer manuell handelt und nur wenige Titel pro Tag anfasst, denkt in Einsatzbeträgen, nicht in Risikoprozenten. Es heißt ausdrücklich NICHT, dass das Risiko dadurch verschwindet — es wird nur an anderer Stelle sichtbar, nämlich in der Stop-Distanz.',
  stopDistance:'Stop-Distanz: Wie weit dein Stop-Kurs prozentual unter dem Einstieg liegt. Bei festem Einsatz ist das die Zahl, die deinen Verlust bestimmt: 10.000 € Einsatz und 2 % Stop-Distanz bedeuten rund 200 € Kursverlust plus etwa 38 € Ausführungskosten. Sie sagt ausdrücklich NICHTS darüber, wie wahrscheinlich es ist, dass der Stop erreicht wird — ein enger Stop wird häufiger ausgelöst, ein weiter kostet mehr, wenn er ausgelöst wird.',
  rewardRisk:'Ziel : Stop (Chance-Risiko-Verhältnis in Kursweite): Wie oft die Zielentfernung in die Stop-Entfernung passt. Ziel +4 % bei Stop −2 % ergibt 2,0x. Warum das bei festem Einsatz die entscheidende Zahl ist: Gewinne werden mit KESt besteuert, Verluste tragen die vollen Gebühren mit. Bei 1,0x brauchst du über 60 % Trefferquote, um überhaupt bei null zu landen — bei 2,0x reichen rund 40 %. Deshalb gibt die App im Fixmodus unter 2,0x keine Kauf-Freigabe. Es ist ausdrücklich KEINE Vorhersage, dass das Ziel erreicht wird.',
  maxLoss:'Maximaler Verlust am Stop: Eine von dir gesetzte Obergrenze in Euro für das, was ein einzelner Trade im schlechtesten Fall kosten darf, inklusive aller Ausführungskosten. Setups mit einem so weit entfernten Stop, dass diese Grenze überschritten würde, bekommen keine Freigabe. Die Grenze kann ausschließlich abwerten: sie erzeugt nie eine Kauf-Freigabe, sie entzieht nur eine. 0 schaltet sie ab.',
  tradeModeA:'Modus A · Momentum-Tageshandel: Ein eigenes Regelwerk für Titel, die HEUTE stark bewegt sind — nach Quartalszahlen, Nachrichten oder einem Gap. Vier Unterschiede zum Positionsmodus: (1) Der Abstand zur EMA21 wird nicht mehr bestraft, denn genau dieser Abstand ist hier das Gesuchte und kein Warnsignal. (2) Elliott-Wellen werden gar nicht verwendet, weil ein Gap ohne Wellenhistorie der Methode keine Grundlage gibt. (3) Der Stop kommt unter das Konsolidierungstief nach dem Impuls, das Ziel ist ein Vielfaches der bisherigen Tagesspanne. (4) Ohne frischen Kurs gibt es keinen Plan. Modus A ist ausdrücklich KEIN besserer Modus, sondern ein anderer — für ruhige Standardwerte über Wochen ist er ungeeignet.',
  quoteAge:'Kursalter: Wie alt der jüngste verwendete Kurs ist. Der Feed liefert 5-Minuten-Balken, ein Kurs ist also fast immer einige Minuten alt. Wozu die Angabe dient: Bei einem Titel, der am Tag 12 % läuft, bewegen sich in zehn Minuten leicht 1–2 % — ein Plan auf altem Kurs hätte dann einen Stop, der real schon durchbrochen ist. Modus A verweigert deshalb ab 10 Minuten die Freigabe. Ein frischer Kurs bedeutet ausdrücklich NICHT, dass du zu diesem Kurs auch kaufen kannst; das entscheidet dein Handelsplatz.',
  consolidation:'Konsolidierung: Eine Beruhigungsphase nach einem starken Impuls — der Kurs läuft eine Weile seitwärts, statt weiter zu steigen oder zurückzufallen. Wozu sie hier dient: Ihr Tief ist der einzige Punkt, an dem sich in einem schnellen Momentum-Titel ein sinnvoller Stop definieren lässt. Fällt der Kurs darunter, war der Impuls verkauft. Ohne erkennbare Konsolidierung erstellt Modus A bewusst gar keinen Plan, statt einen Stop zu erfinden.',
  slippage:'Slippage: Die Differenz zwischen dem Kurs, den du siehst, und dem, den du tatsächlich bekommst. Entsteht, weil sich der Kurs zwischen Klick und Ausführung bewegt. Wird hier als Reserve geschätzt, nicht gemessen.',
  spread:'Spread: Der Abstand zwischen Kauf- und Verkaufskurs. Diese Differenz zahlst du sofort beim Einstieg — bei eng gehandelten Titeln kann sie einen kleinen Trade allein unwirtschaftlich machen.',
  tickerSym:'Kürzel (Ticker) = der Kurzname, unter dem eine Aktie an der Börse gehandelt wird. Das ist KEINE Kennzahl wie CRV oder RVOL, sondern nur ein Name: AAPL steht für Apple, SOFI für SoFi Technologies. Das Kürzel ist NICHT eindeutig über alle Börsen hinweg: derselbe Buchstabencode kann anderswo ein völlig anderes Papier bezeichnen. Deshalb steht der volle Firmenname immer daneben.',

  /* --- Zeit & Datenstand (v3.6.4) --- */
  fearGreed:'Fear & Greed Index (Angst-und-Gier-Index): ein Stimmungswert von 0 bis 100 für den Kryptomarkt. 0 = größtmögliche Angst, 100 = größtmögliche Gier. Er wird aus Schwankungsbreite, Marktmomentum, Social-Media-Aktivität, Bitcoin-Dominanz und Suchtrends zusammengesetzt und einmal täglich neu berechnet. WICHTIG: Er misst die Stimmung, nicht die Qualität eines Trades, sagt nichts über einen einzelnen Coin, und er gilt ausschließlich für Krypto — für Aktien hat er keine Aussagekraft. In FusionPulse hat er 0 % Gewicht in Score und Kauf-Freigabe; er ist Kontext, kein Signal.',
  contrarian:'Antizyklisch (contrarian) denken heißt: gegen die vorherrschende Stimmung handeln — kaufen, wenn alle ängstlich sind, verkaufen, wenn alle euphorisch sind. Historisch lagen Wendepunkte oft in Phasen extremer Stimmung. Daraus folgt aber KEINE Handelsregel: extreme Angst kann wochenlang extremer werden, bevor sie dreht. Wer allein darauf setzt, greift ins fallende Messer.',
  breadth:'Marktbreite (Breadth): Wie viele Titel einer Auswahl gerade über ihrem Tagesdurchschnittspreis liegen. „Risk-Off · 25 % über VWAP" heißt: nur ein Viertel der gescannten Titel handelt über diesem Durchschnitt. Das misst, was Kurse TUN — nicht, was Marktteilnehmer FÜHLEN. Es ist also kein Sentiment. Außerdem ist die Basis eine Stichprobe von rund 20 Titeln, kein Marktindex.',
  serpQuota:'SerpAPI ist der Dienst, über den FusionPulse misst, wie viel gerade über eine Aktie geredet wird (Reddit, X, Stocktwits). Jede Messung eines Symbols ist eine bezahlte Suchanfrage. Der kostenlose Tarif erlaubt rund 100 Suchen im MONAT — nicht pro Tag. Deshalb wird jedes Symbol höchstens alle sechs Stunden neu gemessen, pro Abruf werden nur wenige aufgefrischt, und bei erschöpftem Budget hört die App auf zu fragen, statt Werte zu erfinden.',
  dataFreshness:'Zwei verschiedene Zeitpunkte, die leicht verwechselt werden. „Abfrage 12:28" heißt nur: um 12:28 hat FusionPulse zuletzt beim Datenanbieter nachgesehen. „Kurs vom 25.08., reguläre US-Sitzung" heißt: so alt ist der Kurs selbst. Wenn die US-Börse geschlossen ist, liefert auch die frischeste Abfrage den letzten Schlusskurs — die Aktie sieht dann aktuell aus, ist es aber nicht. Deshalb steht der Datenstand jetzt getrennt daneben.',
  tradingHours:'Die US-Börse arbeitet in New Yorker Zeit (ET). Umgerechnet auf unsere Zeit: Premarket ab etwa 10:00, Eröffnung 15:30, regulärer Handel bis 22:00, After Hours bis 02:00 nachts. Im Winter jeweils eine Stunde später, weil die USA und Europa die Zeitumstellung an unterschiedlichen Terminen machen. Die App rechnet das automatisch um und zeigt beide Zeiten.',

  /* --- Kopfzeile der Fokus-Karte (v3.6.3) --- */
  score:'Score 0–10: die Gesamtnote des Kursmusters. Sie fasst zusammen, wie viele der aktivierten Analyseverfahren gerade dasselbe Bild zeigen — Trend, VWAP-Lage, Volumen, Elliott und so weiter. Hoch heißt: die Verfahren sind sich einig. Sie sagt NICHTS darüber, ob sich der Trade wirtschaftlich lohnt; das steht in CRV und Netto-Potenzial.',
  maturity:'Reife (0–100 %): Wie nah ist dieses Setup daran, alle Freigabebedingungen zu erfüllen? 95 % heißt: es fehlt nur noch wenig. Zusammengerechnet aus Musterqualität, Chance-Risiko-Verhältnis, Volumen, Situationsbewertung und Abstand zum Auslösepunkt. WICHTIG: Reife ist ein Fortschrittsbalken, kein Kaufsignal — ein Setup kann 95 % reif sein und trotzdem nie auslösen, oder wirtschaftlich uninteressant bleiben.',
  situationScore:'Situation 0–100: Wie ausgeprägt das erkannte Kursereignis gerade ist. 99/100 heißt: das Muster ist lehrbuchmäßig deutlich, nicht dass der Gewinn groß wird. Diese Zahl dient nur der Priorisierung — welche Titel schaut sich der Tiefenscan zuerst an. Sie hat 0 % Gewicht in der Kauf-Freigabe.',
  lifecyclePhase:'Phase im Ablauf eines Ereignisses. PREP = baut sich auf. IGNITION = zündet gerade. CONFIRM = bestätigt sich. LATE = der Zug ist abgefahren, Einstieg jetzt hat ein schlechteres Chance-Risiko-Verhältnis. WATCH = nur beobachten. Reine Einordnung, kein Kaufsignal.',
  sectorTag:'Branche des Unternehmens. Wichtig für zwei Dinge: sie erklärt, wodurch die Aktie wirtschaftlich bewegt werden kann, und sie geht in die Klumpungswarnung ein — mehrere Positionen derselben Branche fallen im Stressfall gemeinsam.',
  execScore:'Ausführbarkeit 0–10: Wie gut lässt sich der Titel praktisch handeln? Fließt ein: Abstand zwischen Kauf- und Verkaufskurs, Liquidität, und ob deine Ordergröße den Kurs selbst bewegen würde. Ein perfektes Muster in einem illiquiden Papier ist praktisch nicht handelbar.',

  /* --- Situationstypen der Situation Engine --- */
  sit_squeeze:'SQUEEZE RELEASE (Kompression löst sich): Die Schwankungen waren ungewöhnlich klein geworden, jetzt bricht der Kurs über das Hoch der letzten 60 Minuten aus und die Spanne weitet sich deutlich. Gilt als Startsignal einer größeren Bewegung. Wichtig: die Kompression sagt, dass etwas passiert — nicht, dass es nach oben geht und schon gar nicht, wie viel.',
  sit_breakoutStart:'BREAKOUT START (frischer Ausbruch): Der Kurs hat gerade das Hoch der letzten 60 Minuten überschritten und das kurzfristige Momentum zieht dabei an. Frühe Phase eines Ausbruchs. Ausbrüche scheitern häufig — deshalb zählt hier zusätzlich das Volumen.',
  sit_breakoutPressure:'BREAKOUT PRESSURE (Druck vor dem Ausbruch): Der Kurs steht dicht unter der Auslösemarke und das Momentum nimmt zu. Es ist noch nichts ausgebrochen — der Titel steht sozusagen an der Tür.',
  sit_reclaim:'RECLAIM (Rückeroberung): Der Kurs holt sich eine wichtige Marke zurück, die er vorher verloren hatte — den Tagesdurchschnittspreis VWAP oder die EMA21-Linie. Gilt als Zeichen, dass die Verkäufer die Oberhand verlieren.',
  sit_pullbackHold:'PULLBACK HOLD (Rücksetzer hält): Der Kurs ist zurückgekommen, aber auf der EMA21-Linie stehengeblieben und dreht dort wieder nach oben. Das gilt als der „gesunde" Rücksetzer im intakten Trend.',
  sit_acceleration:'ACCELERATION (Beschleunigung): Das Momentum der letzten 5 Minuten zieht deutlich gegenüber der 15-Minuten-Basis an. Der Kurs wird schneller — Richtung und Nachhaltigkeit sagt das noch nicht.',
  sit_nearHigh:'NEAR HIGH (nahe am Hoch): Der Kurs steht dicht unter einem relevanten Hoch. Beobachtungsgrund, kein Signal.',
  sit_openingDrive:'OPENING DRIVE (Eröffnungsschub): Auffällige gerichtete Bewegung direkt zur Börseneröffnung. Die erste Handelsstunde ist volatil und die Kurse springen — das ist Chance und Risiko zugleich.',
  sit_watch:'WATCH (nur beobachten): Kein besonderes Ereignis erkannt. Der Titel läuft normal mit und steht ohne konkreten Anlass in der Liste.',

  /* --- Modul 0: Selbstauswertung --- */
  inSample:'In-Sample = die Daten, an denen die Regel entstanden ist. Auf diesen Daten sieht praktisch jede Regel gut aus — sie wurde ja daran gebaut. Deshalb ist diese Zahl allein wertlos und steht hier nur zum Vergleich.',
  oos:'Out-of-Sample (OOS) = frische Daten, die die Regel vorher NIE gesehen hat. Nur hier zeigt sich, ob ein Muster wirklich funktioniert oder nur die Vergangenheit auswendig gelernt hat. Diese Spalte ist die ehrliche.',
  wilson:'Wilson-Untergrenze: Ein vorsichtiger Schätzwert für die echte Trefferquote. Bei 3 von 4 Treffern sind 75 % zwar richtig gerechnet, aber bei so wenigen Fällen fast bedeutungslos. Die Wilson-Grenze sagt: „mindestens so gut ist es wahrscheinlich" — je weniger Fälle, desto weiter liegt sie unter dem Rohwert.',
  sampleN:'n = Anzahl der ausgewerteten Fälle. Unter etwa 20 Fällen ist jede Trefferquote reines Rauschen. Der Wächter urteilt deshalb bewusst erst ab dieser Grenze und schreibt vorher „sammelt".',
  overfit:'Overfitting (Überanpassung): Eine Regel, die die Vergangenheit perfekt erklärt und in der Zukunft versagt — weil sie Zufall auswendig gelernt hat statt einen echten Zusammenhang. Der Wächter sucht gezielt nach diesem Muster: gut im Rückblick, schwach auf frischen Daten.',
  multiTest:'Mehrfachtest-Korrektur: Wer zehn Setups gleichzeitig prüft, findet auch dann ein „gutes", wenn alle wertlos sind — reiner Zufall. Deshalb wird die Messlatte höher gelegt, je mehr Setups gleichzeitig im Rennen sind.',
  mute:'Stummschalten heißt hier NICHT löschen. Das Setup erzeugt keine Kauf-Freigabe mehr, wird im Hintergrund aber weiter ausgewertet. So kann sich ein zu Unrecht abgeschaltetes Muster wieder rehabilitieren, statt für immer zu verschwinden.',
  brokerAvail:'Handelbarkeit bei flatex: Ob ein Titel im Handelsangebot deines Brokers ueberhaupt vorkommt. Die Anzeige leitet das aus dem Primaerlisting ab (NYSE/NASDAQ/AMEX = in der Regel ueber US-Direkthandel verfuegbar; OTC/Pink Sheets = meist nicht oder nur mit sehr schlechten Spreads). Sie ist ausdruecklich KEINE bestaetigte Verfuegbarkeit und keine Preisauskunft — bestaetigt ist erst, was die Ordermaske zeigt. Sie veraendert weder Score noch Kauf-Freigabe.',
  hysterese:'Hysterese: Die Hürde zum Wiedereinschalten liegt bewusst höher als die zum Abschalten. Ohne diesen Abstand würde reines Zufallsrauschen das System dauernd zwischen an und aus springen lassen.',

  /* --- Modul 2: Portfolio --- */
  riskPerTrade:'Risiko je Trade: Der Betrag, den du verlierst, wenn genau dieser eine Trade am Stop endet. NICHT die Kaufsumme — die ist ein Vielfaches davon.',
  portfolioBudget:'Gesamt-Risikobudget: Die Obergrenze für alles, was gleichzeitig auf dem Spiel steht. Wichtig, weil fünf Trades mit je „nur 0,75 %" zusammen 3,75 % ergeben. Die Einzelbegrenzung oben sagt darüber nichts.',
  cluster:'Klumpenrisiko: Mehrere Positionen, die vom selben Faktor abhängen — etwa alle aus derselben Branche. Im Ernstfall fallen sie gemeinsam. Dann hast du nicht drei unabhängige Risiken, sondern faktisch ein einziges großes.',
  diversify:'Streuung (Diversifikation) wirkt nur, wenn die Positionen wirklich unabhängig voneinander sind. Fünf Halbleiterwerte sind fünf Positionen, aber praktisch eine einzige Wette.',
  stopReal:'Warum das echte Risiko höher ist als gerechnet: Die Positionsgröße kalkuliert nur den Kursverlust bis zum Stop. Dazu kommen aber noch die Gebühren für Kauf und Verkauf sowie Spread und Slippage. Bei kleinen Positionen kann das den Verlust deutlich vergrößern.',
};
/** Erklärungstext zu einem Begriff; leer, wenn der Begriff nicht im Glossar steht. */
const gloss = (key) => GLOSS[key] || '';
/** Begriff mit gepunkteter Unterstreichung + Mouseover-Erklärung. */
function gl(label, key, extra){
  const t=[gloss(key), extra||''].filter(Boolean).join(' ');
  return t ? `<abbr class="gl" title="${esc(t)}">${esc(label)}</abbr>` : esc(label);
}
/** Situationstyp der Situation Engine auf seine Laien-Erklärung mappen. */
function glossForSituation(t){
  const k=String(t||'').toUpperCase().trim();
  if(k.startsWith('SQUEEZE')) return gloss('sit_squeeze');
  if(k==='BREAKOUT START') return gloss('sit_breakoutStart');
  if(k==='BREAKOUT PRESSURE') return gloss('sit_breakoutPressure');
  if(k.includes('RECLAIM')) return gloss('sit_reclaim');
  if(k.startsWith('PULLBACK')) return gloss('sit_pullbackHold');
  if(k.includes('ACCELERATION')) return gloss('sit_acceleration');
  if(k==='NEAR HIGH') return gloss('sit_nearHigh');
  if(k.startsWith('OPENING')) return gloss('sit_openingDrive');
  if(k==='WATCH') return gloss('sit_watch');
  return 'Von der Situation Engine erkanntes Kursereignis. Es dient nur der Priorisierung, welche Titel zuerst tief analysiert werden, und hat 0 % Gewicht in der Kauf-Freigabe.';
}

/** Setup-Schlüssel (PULLBACK, RECLAIM …) auf den passenden Glossareintrag mappen. */
function glossForSetup(key){
  const k=String(key||'').toLowerCase();
  if(/pullback|rücksetz|ruecksetz/.test(k)) return gloss('pullback');
  if(/squeeze|kompress/.test(k)) return gloss('squeeze');
  if(/breakout|ausbruch/.test(k)) return gloss('breakout');
  if(/reclaim/.test(k)) return gloss('reclaim');
  if(/elliott|fib/.test(k)) return gloss('elliott');
  if(/relative|rs\b/.test(k)) return gloss('relative');
  return 'Vom Scanner erkannte Setup-Art, also die Form des Kursmusters. Die Kauf-Entscheidung hängt zusätzlich an Kosten, Liquidität, Zonenlage und Risiko.';
}

/* ==== v3.5.9 · MODUL 2: Portfolio-Risiko & Klumpung (Paket B, Teil 1) ========
   Frage, die bisher niemand gestellt hat: Jeder Trade fuer sich haelt 0,75 %
   Risiko ein — aber was passiert, wenn fuenf davon gleichzeitig offen sind und
   alle vier am selben Faktor haengen? Dann ist das Einzeltrade-Risiko eine
   Illusion. Diese Schicht rechnet das zusammen.

   Additiv im Sinne von Invariante 3: sie veraendert KEINEN Score. Die
   Budget-Sperre ist standardmaessig AUS und kann, wenn eingeschaltet, nur
   ABWERTEN (BUY unterdruecken) — nie eine Freigabe erzeugen.

   Ehrlichkeitsgrenze: „Korrelation" ist hier eine Sektor-Naeherung, kein
   gerechneter Korrelationskoeffizient. Zwei Titel im selben Sektor koennen
   gegenlaeufig sein; zwei aus verschiedenen Sektoren koennen am selben
   Zinsfaktor haengen. Das wird im UI so gesagt, nicht verschwiegen.        */
const PORTFOLIO_CLUSTER_WARN_PCT = 50;  // Risikoanteil eines Sektors, ab dem gewarnt wird
const PORTFOLIO_BUDGET_WARN_PCT  = 80;  // Auslastung, ab der gewarnt wird
const portfolioBudgetEur = () => Math.max(0, Number(S.equity||0) * (Number(S.portfolioRiskPct ?? DEFAULTS.portfolioRiskPct)/100));

/** Sektor eines Symbols aus den geladenen Zeilen. Unbekannt bleibt unbekannt. */
function sectorOfSymbol(sym){
  const k=String(sym||'').trim().toUpperCase();
  const row=(stockRows||[]).find(r=>String(r?.symbol||'').toUpperCase()===k);
  const sec=String(row?.sector||'').trim();
  return (!sec || sec==='Discovery') ? null : sec;
}

/** Risiko einer offenen Position bis zum technischen Stop, inkl. Ausfuehrungskosten.
 *  Ohne geladene Zeile (kein Stop bekannt) wird NICHT geschaetzt, sondern als
 *  unbewertbar zurueckgegeben — fail-closed statt schoengerechnet. */
function positionRiskEur(sym){
  const k=posKey(sym), p=activePosition(k);
  if(!p) return null;
  const row=(stockRows||[]).find(r=>String(r?.symbol||'').toUpperCase()===k);
  const m=row?positionMetrics(row,p):null;
  if(m && Number.isFinite(Number(m.stopLoss))){
    const priceRisk=(Number.isFinite(Number(m.stop))&&Number(m.stop)>0)?Math.max(0,(Number(m.entry)-Number(m.stop))*Number(m.rest)):null;
    return {risk:Number(m.stopLoss), priceRisk, notional:Number(m.notional)||0, known:true};
  }
  const notional=Number(p.entryEur||0)*Number(p.restQty??p.qty??0);
  return {risk:null, notional, known:false};
}

/** Gesamtbild: ausgeschoepftes Risiko, Klumpung, offene Punkte. */
function portfolioExposure(){
  const budget=portfolioBudgetEur();
  const perTrade=Math.max(0, Number(S.equity||0)*(Number(S.riskPct||0)/100));
  const items=[]; let unknownCount=0, unknownNotional=0;
  for(const sym of Object.keys(stockPositions||{})){
    if(!activePosition(sym)) continue;
    const pr=positionRiskEur(sym); if(!pr) continue;
    if(!pr.known){ unknownCount++; unknownNotional+=pr.notional; }
    items.push({symbol:posKey(sym), risk:pr.known?pr.risk:null, priceRisk:pr.known?pr.priceRisk:null,
                notional:pr.notional, sector:sectorOfSymbol(sym), known:pr.known});
  }
  const usedRisk=items.reduce((a,x)=>a+(Number(x.risk)||0),0);
  const usedPriceRisk=items.reduce((a,x)=>a+(Number(x.priceRisk)||0),0);
  const usedPct=budget>0?(usedRisk/budget)*100:0;
  const freeRisk=Math.max(0,budget-usedRisk);
  /* Befund v3.5.9: Das Einzeltrade-Risiko (equity x riskPct) ist REINES
     Kursrisiko. Am Stop verlierst du zusaetzlich die Ausfuehrungskosten beider
     Seiten — aus 37,50 EUR werden real eher 60–65 EUR. Ein Budget aus n x 37,50
     EUR waere deshalb systematisch zu optimistisch. Die Restkapazitaet wird
     darum gegen das REALE Risiko je Trade gerechnet; der Aufschlag stammt, wenn
     moeglich, aus den eigenen offenen Positionen statt aus einer Annahme. */
  const knownItems=items.filter(x=>x.known&&Number(x.risk)>0);
  const costFactor=knownItems.length&&usedPriceRisk>0?Math.max(1,usedRisk/usedPriceRisk)
    :(perTrade>0?1+(orderFeeEur()*2)/perTrade:1);
  const perTradeReal=perTrade*costFactor;
  const slotsLeft=perTradeReal>0?Math.floor(freeRisk/perTradeReal):0;

  // Klumpung nach Sektor, gewichtet nach RISIKO (nicht nach Kaufsumme —
  // Risiko ist die Groesse, die im Stressfall gleichzeitig schlagend wird).
  const bySector=new Map();
  for(const it of items){
    if(!it.known) continue;
    const key=it.sector||'Sektor unbekannt';
    bySector.set(key,(bySector.get(key)||0)+Number(it.risk||0));
  }
  const sectors=[...bySector.entries()].map(([sector,risk])=>({sector,risk,pct:usedRisk>0?(risk/usedRisk)*100:0,
    n:items.filter(i=>i.known&&(i.sector||'Sektor unbekannt')===sector).length}))
    .sort((a,b)=>b.risk-a.risk);
  const top=sectors[0]||null;
  const clustered=!!(top && top.n>=2 && top.pct>=PORTFOLIO_CLUSTER_WARN_PCT && top.sector!=='Sektor unbekannt');

  const budgetWarn=budget>0 && usedPct>=PORTFOLIO_BUDGET_WARN_PCT;
  const budgetFull=budget>0 && usedRisk>=budget;
  return {budget,perTrade,perTradeReal,costFactor,items,usedRisk,usedPriceRisk,usedPct,freeRisk,slotsLeft,
          sectors,top,clustered,budgetWarn,budgetFull,unknownCount,unknownNotional,
          guard:!!S.portfolioGuard};
}

/** Sperrt die Budget-Sperre neue BUYs? Nur wenn ausdruecklich eingeschaltet.
 *  Kann ausschliesslich abwerten (Invariante 1). Bereits offene Positionen
 *  bleiben unberuehrt — die Sperre verhindert Zukauf, nie einen Ausstieg. */
function portfolioBlocksNewBuy(r){
  if(!S.portfolioGuard) return false;
  const k=posKey(r?.symbol);
  if(activePosition(k)) return false; // schon offen: nicht doppelt bestrafen
  const px=portfolioExposure();
  return px.budget>0 && px.freeRisk < px.perTradeReal;
}

/* Paket A: Menge der stummgeschalteten Setups (aus /api/attribution).
   Ein stummes Setup wird nie auf BUY (Stufe 3) gehoben – aber weiterhin
   angezeigt (Stufe 2/1), damit du es beobachten kannst. Kein Score-Eingriff. */
let mutedSetupSet = new Set();
function setupOf(r){ return String(r?.situation || r?.situationType || r?.setup || '').trim(); }
const stockLevel = (r) => {
  const t = stockTradeability(r);
  const fresh = stockFreshness(r);
  const minScore = (S.claudeMode && r.claude) ? CLAUDE_MIN_SCORE_STOCK : FUSION_MIN_SCORE_STOCK;
  const muted = mutedSetupSet.has(setupOf(r));
  // v3.5.9: Gesamt-Risikobudget erschoepft (nur bei eingeschalteter Sperre).
  const overBudget = portfolioBlocksNewBuy(r);
  // Safety: missing/stale data, a muted setup OR an exhausted risk budget can
  // never promote a row to BUY. Alle drei koennen ausschliesslich abwerten.
  return (r.light === 'green' && r.score >= minScore && t.ok && fresh.key === 'live' && !muted && !overBudget) ? 3
    : (muted || overBudget) && r.light === 'green' ? 1 // zurueckgestuft, nicht ausgeblendet
    : r.light === 'green' ? 2 : r.light === 'yellow' ? 1 : 0;
};

/** Intensität wächst mit der Anzahl BESTÄTIGENDER Scans, gedeckelt durch Qualität. */
function signalStrength(r) {
  const st = state.get(r.pair);
  const streak = st?.streak || 1;
  const byStreak = streak >= 6 ? 3 : streak >= 3 ? 2 : 1;
  if (r.light === 'red') return byStreak;
  const q = Number(r.quality || 0);
  const byQuality = q >= 8 ? 3 : q >= 7 ? 2 : 1;
  return Math.min(byStreak, byQuality);
}
function stockStrength(r) {
  const st = stockState.get(r.symbol);
  const streak = st?.streak || 1;
  const byStreak = streak >= 4 ? 3 : streak >= 2 ? 2 : 1;
  const byScore = r.score >= 8 ? 3 : r.score >= 6.5 ? 2 : 1;
  return Math.min(byStreak, byScore);
}

function explainSetup(r) {
  if (/elliott/i.test(r.setup)) return 'Elliott-Wellen-Heuristik: bewertet Impuls- und Korrekturstruktur aus Swing-Extremen, Trendstaffelung und Fibonacci-nahem Rücksetzer. Keine subjektive Wellenbeschriftung, sondern eine Kennzahl von 0–10.';
  if (/squeeze|breakout/i.test(r.setup)) return 'Squeeze → Breakout: Die Handelsspanne war komprimiert und beginnt sich nach oben aufzulösen. Noch kein Kauf allein – Zonenlage, Kosten, Liquidität und CRV müssen ebenfalls passen.';
  if (/pullback/i.test(r.setup)) return 'Pullback: Der Kurs ist zuerst gestiegen und kommt danach ein Stück zurück. Das kann eine günstigere zweite Einstiegschance sein, wenn der Aufwärtstrend danach wieder bestätigt wird. Ein Pullback allein ist noch kein Kaufsignal.';
  if (/relative/i.test(r.setup)) return 'Relative Stärke: Der Coin entwickelt sich stärker als Bitcoin. Das ist ein Bestätigungsfaktor, kein eigenständiges Kaufsignal.';
  if (/reclaim/i.test(r.setup)) return 'Reclaim: Der Kurs erobert eine zuvor verlorene Referenz (VWAP) zurück. Zählt erst, wenn Volumen und kurzer Zeitrahmen mitziehen.';
  return 'Vom Scanner erkannte Setup-Art. Mouseover zeigt die Bedeutung; die Gesamtentscheidung berücksichtigt zusätzlich Kosten, Liquidität, Zonenlage und Risiko.';
}

/* --------------------------------------------------------------------- Ton */

const SIGNAL_TTL_MS=5*60_000;
const SIGNAL_STORE_KEY='fp.signalEvents.v1';
let signalEvents=[];
try{signalEvents=JSON.parse(localStorage.getItem(SIGNAL_STORE_KEY)||'[]').filter(x=>x&&x.type&&x.id).slice(0,8);}catch{}
function persistSignals(){try{localStorage.setItem(SIGNAL_STORE_KEY,JSON.stringify(signalEvents.slice(0,8)));}catch{}}
function signalIsHot(type,id){const now=Date.now();return signalEvents.some(x=>x.type===type&&x.id===id&&now-x.ts<SIGNAL_TTL_MS);}
function signalReason(kind){
  if(/buy/.test(kind)) return 'BUY-Stufe neu erreicht';
  if(/green/.test(kind)) return 'Setup deutlich verbessert';
  if(/watch/.test(kind)) return 'neues Beobachtungssignal';
  return 'Signal';
}
function registerSignal(type,id,kind){
  const now=Date.now(), key=type+':'+id;
  signalEvents=signalEvents.filter(x=>(x.type+':'+x.id)!==key);
  signalEvents.unshift({type,id,kind,reason:signalReason(kind),ts:now});
  signalEvents=signalEvents.slice(0,8);
  persistSignals();
  renderSignalBanner();
  setTimeout(()=>{ if(type==='stock') renderStocks(); else render(); }, SIGNAL_TTL_MS+100);
}
function renderSignalBanner(){
  const el=$('#signalContent');if(!el)return;
  if(!signalEvents.length){el.classList.remove('hidden');el.innerHTML='<span class="signal-idle"><b>SIGNAL-INFO</b><span>Noch kein neues BUY-/Grün-Signal in dieser Sitzung.</span></span>';return;}
  el.classList.remove('hidden');
  el.innerHTML=signalEvents.map(x=>`<span class="signal-item"><button class="signal-chip ${x.type}" data-sigtype="${x.type}" data-sigid="${esc(x.id)}"><b>${x.type==='stock'?'AKTIE':'COIN'} · ${esc(x.type==='coin'?sym(x.id):x.id)}</b><span>${esc(x.reason)} · ${clock(x.ts)}</span></button><button class="signal-ack" data-sigack="${esc(x.type+':'+x.id)}" title="Signal quittieren">✓</button></span>`).join('');
  el.querySelectorAll('[data-sigtype]').forEach(b=>b.onclick=async()=>{const id=b.dataset.sigid;if(b.dataset.sigtype==='stock'){focusStock=id;renderStocks();$('#stocks')?.scrollIntoView({behavior:'smooth'});}else{select(id,true);$('#focus')?.scrollIntoView({behavior:'smooth'});}});
  el.querySelectorAll('[data-sigack]').forEach(b=>b.onclick=()=>{const key=b.dataset.sigack;signalEvents=signalEvents.filter(x=>x.type+':'+x.id!==key);persistSignals();renderSignalBanner();});
}


/* v3.5.6 — reale Position / Tradeplan im FokusScope.
   Reine Positionsverwaltung im Browser: technische Marken werden aus der
   Analyse übernommen und NICHT verschoben, um CRV oder Gewinn zu retten. */
const POSITION_STORE_KEY='fp.stockPositions.v1';
let stockPositions={};
try{stockPositions=JSON.parse(localStorage.getItem(POSITION_STORE_KEY)||'{}')||{};}catch{stockPositions={};}
function savePositions(){try{localStorage.setItem(POSITION_STORE_KEY,JSON.stringify(stockPositions));}catch{}}
function posKey(sym){return String(sym||'').trim().toUpperCase();}
function activePosition(sym){const p=stockPositions[posKey(sym)];return p&&p.active?p:null;}
function eurLevel(r,key){
  const v=Number(r?.[key+'Eur']); if(Number.isFinite(v)&&v>0)return v;
  const usd=Number(r?.[key+'Usd']);
  const refUsd=Number(r?.entryUsd||r?.priceUsd),refEur=Number(r?.entryEur||r?.priceEur);
  const fx=refUsd>0&&refEur>0?refEur/refUsd:null;
  return Number.isFinite(usd)&&usd>0&&fx?usd*fx:null;
}
function positionMetrics(r,p){
  if(!p)return null;
  const entry=Number(p.entryEur), qty=Number(p.qty), rest=Number(p.restQty??p.qty);
  const stop=eurLevel(r,'stop'),tp1=eurLevel(r,'tp1'),tp2=eurLevel(r,'tp2');
  const current=Number(r?.priceEur)||eurLevel(r,'price');
  if(!(entry>0&&qty>0))return null;
  const notional=entry*qty, stopGross=stop?Math.max(0,(entry-stop)*qty):null;
  const stopCosts=orderFeeEur()*2+notional*(venueFrictionPct()/100);
  const stopLoss=stopGross==null?null:stopGross+stopCosts;
  const tp1Gross=tp1?(tp1-entry)*qty:null, tp2Gross=tp2?(tp2-entry)*qty:null;
  const targetCosts=orderFeeEur()*2+notional*(venueFrictionPct()/100);
  const tp1Net=tp1Gross==null?null:Math.max(0,tp1Gross-targetCosts)*(1-S.taxPct/100);
  const tp2Net=tp2Gross==null?null:Math.max(0,tp2Gross-targetCosts)*(1-S.taxPct/100);
  const netCrv=stopLoss&&tp2Net!=null?Math.max(0,tp2Net)/stopLoss:null;
  const unreal=current?((current-entry)*rest):null;
  return {entry,qty,rest,notional,stop,tp1,tp2,current,stopLoss,tp1Net,tp2Net,netCrv,unreal};
}
function positionPanel(r){
  const k=posKey(r?.symbol),p=activePosition(k),m=positionMetrics(r,p);
  if(!p)return `<section class="position-panel"><div class="position-head"><b>📌 Reale Position</b><small>Kaufkurs in EUR/Tradegate + Stückzahl eingeben. Technischer SL/TP1/TP2 bleibt aus der Analyse unverändert.</small></div><div class="position-entry"><label>Kaufkurs €<input id="posEntry" inputmode="decimal" placeholder="z. B. 131,50"></label><label>Stückzahl<input id="posQty" inputmode="numeric" placeholder="z. B. 70"></label><button id="posActivate" type="button">Position übernehmen</button></div></section>`;
  return `<section class="position-panel active"><div class="position-head"><b>📌 AKTIVE POSITION · ${esc(k)}</b><small>Live-Berechnung aus realer Ausführung; technische Marken werden nicht zur CRV-Rettung verschoben.</small></div>${m?`<div class="position-metrics"><span>Investiert <b>${eur(m.notional,0)}</b></span><span>Aktuell <b>${m.current?eur(m.current,2):'–'}</b></span><span>SL <b>${m.stop?eur(m.stop,2):'–'}</b></span><span>Verlust am SL <b>${m.stopLoss!=null?eur(m.stopLoss,0):'–'}</b></span><span>TP1 <b>${m.tp1?eur(m.tp1,2):'–'}</b></span><span>Gewinn TP1 <b>${m.tp1Net!=null?eur(m.tp1Net,0):'–'}</b></span><span>TP2 <b>${m.tp2?eur(m.tp2,2):'–'}</b></span><span>Gewinn TP2 <b>${m.tp2Net!=null?eur(m.tp2Net,0):'–'}</b></span><span>Netto-CRV real <b>${m.netCrv!=null?num(m.netCrv,2)+' : 1':'–'}</b></span><span>Reststückzahl <b>${Math.max(0,m.rest)}</b></span><span>Unrealisiert <b>${m.unreal!=null?eur(m.unreal,0):'–'}</b></span></div>`:''}<div class="position-actions"><label>Teilverkauf Stück<input id="posSoldQty" inputmode="numeric" placeholder="z. B. 35"></label><button id="posPartial" type="button">Teilverkauf buchen</button><button id="posClose" type="button">Position beenden</button></div></section>`;
}
function bindPositionControls(r){
  const k=posKey(r?.symbol);
  document.querySelector('#posActivate')?.addEventListener('click',()=>{
    const entry=Number(String(document.querySelector('#posEntry')?.value||'').replace(',','.'));
    const qty=Math.floor(Number(String(document.querySelector('#posQty')?.value||'').replace(',','.')));
    if(!(entry>0&&qty>0)){alert('Bitte gültigen Kaufkurs in EUR und Stückzahl eingeben.');return;}
    stockPositions[k]={active:true,entryEur:entry,qty,restQty:qty,openedTs:Date.now(),lastAlarm:''};savePositions();renderStocks();
  });
  document.querySelector('#posPartial')?.addEventListener('click',()=>{
    const p=activePosition(k);if(!p)return;const sold=Math.floor(Number(document.querySelector('#posSoldQty')?.value||0));
    if(!(sold>0&&sold<=Number(p.restQty??p.qty))){alert('Teilverkauf muss größer 0 und höchstens die Reststückzahl sein.');return;}
    p.restQty=Number(p.restQty??p.qty)-sold;p.lastPartialTs=Date.now();p.lastPartialQty=sold;if(p.restQty<=0)p.active=false;savePositions();renderStocks();
  });
  document.querySelector('#posClose')?.addEventListener('click',()=>{const p=activePosition(k);if(!p)return;p.active=false;p.closedTs=Date.now();savePositions();clearPositionAlarm(k);renderStocks();});
}
let positionAlarmState={};
function clearPositionAlarm(sym){delete positionAlarmState[posKey(sym)];document.querySelector('#positionAlarm')?.remove();}
function showPositionAlarm(sym,kind,text){
  const k=posKey(sym),key=k+':'+kind;if(positionAlarmState[k]===key)return;positionAlarmState[k]=key;
  if(S.sound)beep(kind==='stop'?'buy':'green',false);
  let el=document.querySelector('#positionAlarm');if(!el){el=document.createElement('div');el.id='positionAlarm';el.className='position-alarm';document.body.appendChild(el);}
  el.innerHTML=`<div><b>${kind==='stop'?'🔴 VERKAUFSALARM':'🟢 POSITIONSALARM'} · ${esc(k)}</b><span>${esc(text)}</span><small>Hinweis/Warnung – FusionPulse führt keinen Verkauf automatisch aus.</small><button type="button" id="positionAlarmAck">Alarm bestätigen</button></div>`;
  el.querySelector('#positionAlarmAck')?.addEventListener('click',()=>clearPositionAlarm(k));
}
function monitorPosition(r){
  const p=activePosition(r?.symbol),m=positionMetrics(r,p);if(!p||!m||!m.current)return;
  const eps=Math.max(0.01,m.current*0.0025);
  if(m.stop&&m.current<=m.stop+eps)return showPositionAlarm(r.symbol,'stop',m.current<=m.stop?`Technischer Stop erreicht/unterschritten: aktuell ${eur(m.current,2)} · SL ${eur(m.stop,2)}.`:`SL-Gefahr: aktuell ${eur(m.current,2)} liegt sehr nahe am technischen SL ${eur(m.stop,2)}.`);
  if(m.tp2&&m.current>=m.tp2)return showPositionAlarm(r.symbol,'tp2',`TP2 erreicht: aktuell ${eur(m.current,2)} · TP2 ${eur(m.tp2,2)}. Restposition prüfen.`);
  if(m.tp1&&m.current>=m.tp1&&Number(p.restQty??p.qty)===Number(p.qty))return showPositionAlarm(r.symbol,'tp1',`TP1 erreicht: aktuell ${eur(m.current,2)} · TP1 ${eur(m.tp1,2)}. Geplanten Teilverkauf prüfen.`);
}

function audio() {
  if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
  if (ac.state === 'suspended') ac.resume();
  return ac;
}
function beep(kind, muted = false) {
  if (!S.sound || muted) return;
  const c = audio();
  const tone = (f, dur, delay = 0, gain = 0.18) => {
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.value = f;
    o.connect(g); g.connect(c.destination);
    const t = c.currentTime + delay;
    o.start(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.stop(t + dur + 0.03);
  };
  // Je höher die Signalstufe, desto markanter der Ton.
  if (kind === 'buy') { tone(1046, .13); tone(1318, .13, .14); tone(1568, .22, .28, .24); }
  else if (kind === 'green') { tone(784, .14); tone(1046, .16, .16); tone(1318, .22, .32); }
  else if (kind === 'watch') { tone(660, .12); tone(880, .14, .14); }
  else if (kind === 'stockbuy') { tone(932, .12); tone(1244, .12, .13); tone(1661, .20, .26, .22); }
  else if (kind === 'stockgreen') { tone(698, .14); tone(932, .18, .16); }
  else if (kind === 'stockwatch') { tone(587, .12, 0, .14); }
  else tone(520, .09, 0, .12);
}

/* ------------------------------------------------------- Positionsgrößen */
function sizing(r) {
  const perUnit = r.entry - r.stop;
  if (perUnit <= 0) return null;
  const caps = [];
  /* v3.9.0: dasselbe Sizing-Modell wie bei Aktien, damit die App nicht auf zwei
     Seiten zwei verschiedene Logiken zeigt. Im Fixmodus ist riskEur das Ergebnis. */
  let notional, riskEur;
  if (sizeModeFixed()) {
    notional = fixedTradeEur();
    riskEur = (perUnit / r.entry) * notional;
    caps.push('fixedSize');
  } else {
    riskEur = S.equity * (S.riskPct / 100);
    notional = (riskEur / perUnit) * r.entry;
  }
  const rawNotional = notional;
  const maxTrade = Math.max(0, Number(S.maxTradeEur || 0));
  if (!sizeModeFixed() && maxTrade && notional > maxTrade) { notional = maxTrade; caps.push('maxTrade'); }
  if (r.buyCapacity == null) caps.push('liquidityUnchecked');
  else if (r.buyCapacity > 0 && notional > r.buyCapacity) { notional = r.buyCapacity; caps.push('liquidity'); }
  const qty = notional / r.entry;
  const tp1Share = 0.5, tp2Share = 0.5, taxFactor = 1 - S.taxPct / 100;
  const profit1 = (r.tp1 - r.entry) * qty * tp1Share;
  const profit2 = (r.tp2 - r.entry) * qty * tp2Share;
  const netProfit1 = Math.max(0, profit1) * taxFactor;
  const netProfit2 = Math.max(0, profit2) * taxFactor;
  return {
    riskEur, qty, notional, rawNotional, capped: caps.length > 0, caps,
    tp1Share, tp2Share, profit1, profit2, netProfit1, netProfit2,
    planGross: profit1 + profit2, planNet: netProfit1 + netProfit2,
    realRisk: perUnit * qty,
  };
}

function orderPlan(r) {
  const s = sizing(r);
  return [
    `${sym(r.pair)} — ${r.setup}`,
    r.orderType === 'stop' ? 'STOP-BUY (Ausbruch abwarten)' : 'LIMIT-BUY (Rücksetzer)',
    `Zone   ${num(r.zoneLow)} – ${num(r.zoneHigh)}`,
    `Entry  ${num(r.entry)}`,
    `Stop   ${num(r.stop)}   (-${r.riskPct} %)`,
    `TP1    ${num(r.tp1)}`,
    `TP2    ${num(r.tp2)}   (${r.tp2Source})`,
    s ? `Größe  ${eur(s.notional, 2)}  ≈ ${s.qty.toPrecision(6)} ${sym(r.pair)}${s.caps?.includes('liquidity') ? '  [wegen Marktliquidität reduziert]' : s.caps?.includes('liquidityUnchecked') ? '  [ohne Liquiditätsprüfung]' : s.caps?.includes('maxTrade') ? '  [auf Maximalbetrag begrenzt]' : ''}` : '',
    `CRV    ${r.netCRV}:1 netto · Kosten ${r.costPct} %`,
    s ? `TP1 50 % netto*  ${eur(s.netProfit1, 2)} · TP2 Rest 50 % netto*  ${eur(s.netProfit2, 2)}` : '',
    s ? `Gesamtplan netto*  ${eur(s.planNet, 2)}  (*Steuerschätzung ${S.taxPct}%)` : '',
  ].filter(Boolean).join('\n');
}

/* v3.6.4: Krypto hatte seit jeher einen Plan-Kopierknopf, Aktien nicht —
   ohne erkennbaren Grund. Gerade bei Aktien ist das Abtippen von Entry, Stop
   und zwei Zielen in die Broker-Maske die fehleranfaelligste Stelle des ganzen
   Ablaufs. Der Text nennt auch ausdruecklich, was NICHT freigegeben ist. */
function stockOrderPlan(r){
  const sz=stockSizing(r), tr=stockTradeability(r), hl=stockHeadline(r), ds=dataSession(r);
  const buy=stockLevel(r)===3;
  const px=(u,e)=>e!=null?`${eur(e,2)} (${usd(u,2)})`:usd(u,2);
  return [
    `${r.symbol} — ${r.securityName||r.name||''}`.trim(),
    `${hl.icon} ${hl.text}${buy?'':'  ← KEINE KAUF-FREIGABE'}`,
    r.setup?`Setup  ${r.setup}${r.situationType?` · ${r.situationType}`:''}`:'',
    '',
    `Entry  ${px(r.entryUsd,r.entryEur)}`,
    `Stop   ${px(r.stopUsd,r.stopEur)}`,
    `TP1    ${px(r.tp1Usd,r.tp1Eur)}   (50 % verkaufen)`,
    `TP2    ${px(r.tp2Usd,r.tp2Eur)}   (Rest verkaufen)`,
    sz?`Größe  ${eur(sz.notional,2)}  ≈ ${Math.floor(sz.qty)} Stück${sz.sizeBasis==='fixed'?'  [fester Einsatz]':''}${sz.liquidityCapped?'  [wegen Marktliquidität reduziert]':''}`:'',
    '',
    r.momentumActive?'Regelwerk  Modus A · Momentum (ohne Elliott, ohne Überdehnungs-Malus)':'',
    `${S.claudeMode?'Plan-CRV':'Struktur-CRV'}  ${num(tr.netCrv,2)} : 1${Number(tr.netCrv)<Number(tr.minCrv||0)?'  [unter deiner Grenze]':''}`,
    sz&&sz.stopDistancePct!=null?`Stop-Distanz  ${num(sz.stopDistancePct,2)} %`:'',
    tr.fixedSize&&Number.isFinite(tr.rewardRisk)?`Ziel : Stop  ${num(tr.rewardRisk,2)} x${tr.rewardRiskOk?'':`  [unter ${num(tr.minRewardRisk,1)}x — keine Freigabe]`}`:'',
    `Weg bis TP2  ${num(tr.tp2Pct,2)} %`,
    sz?`TP1 netto ${eur(sz.tp1Net,2)} · TP2 netto ${eur(sz.tp2Net,2)} · Gesamtplan netto ${eur(sz.planNet,2)}`:'',
    sz?`Verlust am Stop inkl. Kosten  ${eur(sz.stopLossAfterCosts,2)}${tr.fixedSize&&tr.maxLoss>0?`  (deine Grenze ${eur(tr.maxLoss,0)}${tr.lossOk?'':' — ÜBERSCHRITTEN, keine Freigabe'})`:''}`:'',
    '',
    `Datenstand: ${ds.label}`,
    'EUR-Beträge sind umgerechnet, KEINE Tradegate-Kurse. Vor der Order den echten Kurs am Handelsplatz prüfen.',
    buy?'':'Hinweis: FusionPulse gibt diesen Trade aktuell NICHT frei. Grund siehe Kopfzeile oben.',
  ].filter(x=>x!==undefined&&x!==null).join('\n');
}

async function copy(text, el) {
  try {
    await navigator.clipboard.writeText(text);
    if (el) { const o = el.textContent; el.textContent = '✓ kopiert'; setTimeout(() => (el.textContent = o), 1200); }
    beep('tick');
  } catch { /* Clipboard blockiert */ }
}

/* ---------------------------------------------------- Status / Kontingent */
const STATE_TEXT = {
  ok: 'verbunden', busy: 'wird geprüft', ratelimit: 'Rate-Limit', daylimit: 'Tageslimit erreicht',
  nokey: 'API-Key fehlt', error: 'API-Fehler', unknown: 'Status noch nicht verifiziert', stale: 'Daten veraltet', warn: 'eingeschränkt', cpu: 'Ressourcenwarnung',
};
const STATE_TONE = { ok: 'ok', busy: 'busy', ratelimit: 'warn', daylimit: 'warn', nokey: 'err', error: 'err', unknown: 'busy', stale: 'warn', warn: 'warn', cpu: 'warn' };

function setSys(id, st, detail) {
  const el = $(id); if (!el) return;
  const key = STATE_TEXT[st] ? st : 'unknown';
  el.dataset.state = STATE_TONE[key];
  el.dataset.raw = key;
  const label = el.id === 'sysCrypto' ? 'Krypto (Bitpanda Fusion)' : 'Aktien (Tiingo/Twelve)';
  el.title = `${label}: ${STATE_TEXT[key]}${detail ? '\n' + detail : ''}\n\nGrün = verbunden · Gelb = eingeschränkt oder Rate-Limit · Rot = Fehler oder nicht verbunden`;
}

function setMiniStatus(id, st, detail = '') {
  const el = $(id); if (!el) return;
  const raw = String(st || 'busy').toLowerCase();
  const cls = raw === 'ok' ? 'ok' : ['warn','stale','ratelimit','daylimit','cpu'].includes(raw) ? 'warn' : ['err','error','nokey'].includes(raw) ? 'err' : 'busy';
  el.classList.remove('ok','warn','err','busy');
  el.classList.add(cls);
  const label = detail || (el.id === 'miniCrypto' ? 'Krypto-Datenquelle' : el.id === 'miniStocks' ? 'Aktien-Datenquelle' : el.id === 'miniTiingo' ? 'Tiingo-Aktienfeed' : 'Cloudflare/Worker');
  const legend='Grün = aktiv/stabil · Gelb = funktionsfähig, aber eingeschränkt/veraltet · Orange = relevante Ressourcenwarnung · Rot = Fehler/Handlungsbedarf · Grau = Status noch nicht verifiziert · Blinken = aktuelle Prüfung/Aktualisierung läuft.';
  el.dataset.tip = `${label} · ${legend}`;
  el.removeAttribute('title'); // eigener schneller Tooltip statt verzögertem Browser-Tooltip
}

function quotaText(q) {
  if (!q) return { short: 'Kontingent unbekannt', long: 'Es liegen keine Kontingentdaten vor.' };
  const parts = [];
  if (q.creditsLeft != null && q.minuteLimit) {
    parts.push(`${q.creditsLeft}/${q.minuteLimit} Credits diese Minute frei`);
  } else {
    parts.push('Minutenkontingent unbekannt');
  }
  const day = q.dayLimit
    ? `heute ${q.dayCredits}/${q.dayLimit}${q.dayLimitDerived ? ' (abgeleitet)' : ''}`
    : `heute ${q.dayCredits} verbraucht (Eigenzählung)`;
  parts.push(day);
  return {
    short: q.creditsLeft != null ? `Twelve Data Fallback · ${q.creditsLeft}/${q.minuteLimit} · ${day}` : `Twelve Data Fallback · Kontingent unbekannt · ${day}`,
    long: parts.join(' · '),
  };
}

function checkQuotaPopup(q, state) {
  // v3.0.7: Minutenknappheit/429 bleibt eine kleine gelbe Statusmeldung.
  // Ein Modal ist nur für das echte Tageslimit bzw. eine einmalige Tageswarnung sinnvoll.
  if (state === 'daylimit') return showQuotaWarning('daylimit');
  if (!q) return;
  if (q.dayLimit && q.dayCredits >= q.dayLimit * 0.9) return showQuotaWarning('daynear', quotaText(q).long);
  if (['daylimit', 'daynear'].includes(quotaShownFor) && (!q.dayLimit || q.dayCredits < q.dayLimit * 0.9)) quotaShownFor = '';
}

async function loadHealth() {
  try {
    const p = new URLSearchParams(); if (S.token) p.set('t', S.token);
    const r = await fetchWithTimeout('/api/health?' + p, { cache: 'no-store' }, 8_000);
    health = await r.json();
    if (health.version) {
      /* v3.14.3: Hier stand `'v' + health.version` — die Kopfzeile zeigte also die
         Version des WORKERS, nicht die des Codes im Browser. Sie wurde wenige
         Sekunden nach dem Laden ueber den Wert aus version.js geschrieben. Damit
         war die Nummer, die der Nutzer oben abliest, kein Beleg dafuer, dass die
         neue Oberflaeche geladen ist — genau die Fehlannahme, die uns die letzte
         Runde gekostet hat. Die Kopfzeile meldet jetzt den laufenden Code; die
         Servernummer kommt nur dazu, wenn sie abweicht. */
      const srv = String(health.version), ui = String(FP_VERSION);
      $('#appver').textContent = srv === ui ? 'v' + ui : `v${ui} · Server v${srv}`;
      const v = $('#settingsVer'); if (v) v.textContent = 'v' + health.version;
      // Version-Mismatch Frontend ↔ Backend: alter Cache oder halbes Deployment.
      if (health.version !== FP_VERSION) {
        showUpdateBar(`Neue FusionPulse-Version verfügbar – neu laden (Oberfläche v${FP_VERSION}, Server v${health.version})`);
      }
    }
    const cryptoHealthRaw = health.status?.crypto?.state || 'unknown';
    const cryptoAgeSec = lastCryptoDataTs ? Math.round((Date.now()-lastCryptoDataTs)/1000) : null;
    const cryptoHealth = cryptoHealthRaw==='ok' && (cryptoAgeSec==null || cryptoAgeSec>90) ? 'warn' : cryptoHealthRaw;
    const cryptoMsg = cryptoHealth==='warn' && cryptoHealthRaw==='ok' ? (cryptoAgeSec==null?'Worker erreichbar, aber noch kein frischer Kryptodatensatz bestätigt':`Worker erreichbar, aber letzter bestätigter Kryptodatensatz ist ${cryptoAgeSec}s alt`) : health.status?.crypto?.message;
    setSys('#sysCrypto', cryptoHealth, cryptoMsg);
    setSys('#sysStocks', health.status?.stocks?.state || 'unknown', health.status?.stocks?.message);
    setMiniStatus('#miniCrypto',cryptoHealth,'Krypto: '+(cryptoHealth==='ok'?`Datenfeed frisch · letzter Datensatz ${cryptoAgeSec}s alt · kein Handlungsbedarf`:(cryptoMsg||cryptoHealth)));
    setMiniStatus('#miniStocks',health.status?.stocks?.state||'unknown','Aktien: '+((health.status?.stocks?.state||'')==='ok'?'Datenfeed aktiv · kein Handlungsbedarf':(health.status?.stocks?.message||health.stocksProvider||'unbekannt')));
    setMiniStatus('#miniTiingo',health.tiingoConfigured?'ok':'warn',health.tiingoConfigured?'Tiingo: Aktien-Primärfeed verfügbar · kein Handlungsbedarf':'Tiingo nicht verfügbar · Aktien-Fallback/Details prüfen');
    const cfState=[health.status?.crypto?.state,health.status?.stocks?.state,health.status?.alpaca?.state].some(x=>['cpu','error'].includes(x))?'warn':'ok';
    setMiniStatus('#miniCloudflare',cfState,cfState==='ok'?'Cloudflare Worker erreichbar · kein gemeldeter CPU-Fehler':'Cloudflare erreichbar, aber ein Ressourcen-/Providerfehler wurde gemeldet');
    // Der große Krypto-Status darf nicht dauerhaft "Verbinde…" anzeigen, wenn
    // der Worker den Bitpanda-Provider bereits als erreichbar bestätigt hat.
    const mainStatus = $('#status');
    if (mainStatus && cryptoHealth === 'ok' && (mainStatus.textContent.trim() === 'Verbinde…' || mainStatus.dataset.state === 'busy')) {
      mainStatus.textContent = 'Bitpanda verbunden · erster Scan läuft…';
      mainStatus.dataset.state = 'busy';
    }
    renderQuota(health.quota?.twelveData); renderResourceStrip();
  } catch {
    setSys('#sysCrypto', 'error', 'Worker nicht erreichbar');
    setSys('#sysStocks', 'error', 'Worker nicht erreichbar');
    setMiniStatus('#miniCrypto','error','Worker nicht erreichbar'); setMiniStatus('#miniStocks','error','Worker nicht erreichbar'); setMiniStatus('#miniTiingo','error','Worker nicht erreichbar'); setMiniStatus('#miniCloudflare','error','Cloudflare Worker nicht erreichbar · Handlungsbedarf');
  }
}

function renderQuota(q) {
  const el = $('#stockQuota'); if (!el) return;
  const t = quotaText(q);
  el.textContent = t.short;
  el.title = `Twelve Data Kontingent laut Antwort-Headern api-credits-used / api-credits-left.\n${t.long}\n\nDas Minutenkontingent liefert der Anbieter. Der Tagesverbrauch (Eigenzählung je Worker-Instanz) ist eine Eigenzählung dieses Workers; ein Tageslimit wird nur angezeigt, wenn es sich aus dem Minutenkontingent eindeutig ableiten lässt.`;
  const tight = q && ((q.dayLimit && q.dayCredits >= q.dayLimit * 0.9) || (q.creditsLeft != null && q.creditsLeft <= 1));
  el.className = 'badge' + (tight ? ' warn' : q?.creditsLeft != null ? ' ok' : '');
}

/* -------------------------------------------------------------- Update-Bar */
function showUpdateBar(text) {
  if(Number(localStorage.getItem('fp.updateAckUntil')||0)>Date.now()) return;
  const bar = $('#updateBar');
  if (!bar || !bar.classList.contains('hidden')) return;
  if (text) $('#updateText').textContent = text;
  bar.classList.remove('hidden');
}
async function hardReload() {
  localStorage.setItem('fp.updateAckUntil',String(Date.now()+10*60_000));
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.() || [];
    for (const reg of regs) { reg.waiting?.postMessage({ type: 'SKIP_WAITING' }); await reg.update().catch(() => {}); }
    const keys = await caches?.keys?.() || [];
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch { /* egal – Reload ist die Hauptsache */ }
  location.reload();
}

/* ------------------------------------------------------------------ Scannen */
let controller = null;
function showQuotaWarning(kind, detail = '') {
  const modal = $('#quotaModal');
  const text = $('#quotaText');
  const title = $('#quotaTitle');
  if (!modal || !text) return;
  if (quotaShownFor === kind) return;         // nicht bei jedem Refresh erneut
  quotaShownFor = kind;
  const body = {
    cpu: ['Cloudflare CPU-Limit wahrscheinlich erreicht',
      `<p>Der Workers-Free-Plan erlaubt nur wenig CPU-Zeit pro Aufruf. Verringere zuerst „Coins scannen“ und/oder erhöhe das Scan-Intervall. Bricht der Scanner weiterhin regelmäßig ab, ist Workers Paid die nächste Stufe.</p><p class="hint">${esc(detail) || 'Deine Secrets und Berechtigungen bleiben unverändert.'}</p>`],
    requests: ['Request-Limit oder Rate-Limit erreicht',
      `<p>Weitere Aufrufe schlagen bis zum Zurücksetzen des Zählers fehl.</p><p class="hint">${esc(detail) || 'Prüfe Cloudflare → Workers & Pages → fusionpulse → Kennzahlen.'}</p>`],
    ratelimit: ['Twelve Data: Minutenkontingent erschöpft',
      `<p>Das Minutenkontingent ist aufgebraucht. Twelve Data setzt es zu Beginn jeder neuen Minute zurück. Der Krypto-Scanner läuft unverändert weiter.</p><p class="hint">${esc(detail)}</p>`],
    daylimit: ['Twelve Data: Tageslimit erreicht',
      `<p>Für heute sind keine Aktien-Credits mehr verfügbar. Der Aktienradar zeigt bis zum Zurücksetzen die zuletzt gecachten Werte; der Krypto-Scanner läuft weiter.</p><p class="hint">${esc(detail)}</p>`],
    daynear: ['Twelve Data: Tageskontingent fast erschöpft',
      `<p>Weniger als 10 % des Tageskontingents sind übrig. Erhöhe das Aktien-Intervall oder reduziere das Universum, wenn du bis Handelsschluss durchkommen willst.</p><p class="hint">${esc(detail)}</p>`],
    minutenear: ['Twelve Data: Minutenkontingent fast erschöpft',
      `<p>Im laufenden Minutenfenster ist fast kein Credit mehr frei. Das ist unkritisch – der nächste Zyklus startet mit vollem Kontingent.</p><p class="hint">${esc(detail)}</p>`],
  }[kind] || ['Limit erreicht', `<p class="hint">${esc(detail)}</p>`];
  title.textContent = body[0];
  text.innerHTML = body[1];
  modal.classList.add('open');
}

async function scan(force = false) {
  if (scanning && !force) return;
  const req = ++scanReqSeq;
  if (force) controller?.abort();
  scanning = true;
  controller = new AbortController();
  const localController = controller;
  const t0 = performance.now();
  scanStartedTs = Date.now();
  $('#status').dataset.state = 'busy';

  try {
    const q = new URLSearchParams({
      deep: S.deep, watch: S.watch, mode: S.analysisMode, comp: S.components.join(','), minCrv: S.minCrvCoin,
    });
    if (S.token) q.set('t', S.token);
    if (force) q.set('force', '1');
    const res = await fetchWithTimeout(`/api/scan?${q}`, { signal: localController.signal, cache:'no-store' }, NET_TIMEOUT_MS);
    const data = await res.json();
    if (!res.ok) {
      setSys('#sysCrypto', data.state || 'error', data.error);
      if (res.status === 429) showQuotaWarning('requests', data.error);
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    rows = data.rows || [];
    rows.forEach(claudeOverlayRow);
    meta = data;
    const serverTs=Number(data.ts||0); if(serverTs>0) lastCryptoDataTs=serverTs;
    const cryptoAgeSec=serverTs>0?Math.max(0,Math.round((Date.now()-serverTs)/1000)):null;
    const cryptoStale = !!(data.stale || data.staleWhileRefresh || cryptoAgeSec==null || cryptoAgeSec>90);
    setSys('#sysCrypto', cryptoStale ? 'warn' : 'ok', cryptoStale
      ? `Kein frischer Kryptodatensatz bestätigt · ${cryptoAgeSec==null?'Zeitstempel fehlt':`letzter Stand ${cryptoAgeSec}s alt`} · ${data.upstreamError || 'Reconnect/Refresh läuft'}`
      : `${data.deepCount} von ${data.universe} EUR-Paaren tief analysiert · Daten ${cryptoAgeSec}s alt`);
    if (data.version && data.version !== FP_VERSION) {
      showUpdateBar(`Neue FusionPulse-Version verfügbar – neu laden (Oberfläche v${FP_VERSION}, Server v${data.version})`);
    }
    track();
    render();

    const shown = Math.min(S.coinCount, visible().length);
    const sourceLabel = cryptoStale ? 'Letzter guter Stand · Reconnect läuft' : (data.warmStart ? 'Cron-Cache' : data.cached ? 'Cache' : 'Live');
    $('#status').textContent = `${sourceLabel} · ${data.deepCount} gescannt / ${shown} angezeigt von ${data.universe} · ${data.requests ?? data.subrequests ?? '–'} API-Unterabfragen · ${Math.round(performance.now() - t0)} ms`;
    $('#status').title = 'Live/Cache = Datenquelle des letzten Scans · „gescannt“ = tief analysierte Coins, „angezeigt“ = Zeilen in dieser Liste (Einstellungen) · API-Unterabfragen = Bitpanda-Unterabfragen innerhalb dieses Scans, NICHT dein Cloudflare-Tagesverbrauch (Eigenzählung je Worker-Instanz) · ms = Dauer des Scans.';
    $('#status').dataset.state = 'ok';
    lastSuccessfulScanTs = Date.now(); reconnectAttempt = 0;
    $('#stamp').textContent = new Date(data.ts).toLocaleTimeString('de-AT');
  } catch (e) {
    if (e.name === 'AbortError' && localController.signal.aborted && req !== scanReqSeq) return;
    const msg = String(e.message || e);
    if(e.name==='TimeoutError'){ showReconnectState(msg); setMiniStatus('#miniCrypto','warn','Krypto: Zeitüberschreitung · automatischer Reconnect läuft'); setTimeout(()=>{if(document.visibilityState==='visible')scan(false);},1200); }
    else { $('#status').textContent = `Fehler: ${msg}`; $('#status').dataset.state = 'err'; }
    if (/cpu|exceeded|resource|1102/i.test(msg)) showQuotaWarning('cpu', msg);
    else if (/429|too many|limit/i.test(msg)) showQuotaWarning('requests', msg);
  } finally {
    if (req === scanReqSeq) { scanning = false; scanStartedTs = 0; }
  }
}

/* -------------------------------------------------------------- Aktienradar */
/** Positionsgröße in EUR. Ohne bekannten EUR/USD-Kurs wird bewusst NICHT
 *  gerechnet, statt USD und EUR stillschweigend zu vermischen. */

function stockOpportunity(r){
  const sz=stockSizing(r), tr=stockTradeability(r), f=stockFreshness(r);
  const phase=stockMeta?.market?.key||r.marketPhase||'closed';
  const opportunityPhase=['premarket-early','premarket','opening','regular'].includes(phase);
  const claude=!!(S.claudeMode&&r.claude);
  const net=Number(sz?.planNet||0), crv=Number(tr.netCrv||0), planEff=Number(tr.planEfficiency||0), tp2=Number(tr.tp2Pct||0), score=Number(r.score||0);
  const riskEur=S.equity*(S.riskPct/100);
  const minNet=claude?claudeMinNetEur(riskEur):fusionMinNetEur(sz);
  const minCrv=claude?CLAUDE_MIN_CRV_STOCK:Number(S.minCrvStock||3);
  const minScore=claude?CLAUDE_MIN_SCORE_STOCK:FUSION_MIN_SCORE_STOCK;
  const minTp2=claude?Math.max(Number(S.minTp2PctStock||0),0.6):Number(S.minTp2PctStock||2);
  const ignoreBelow=claude?minNet*0.5:Math.max(50,minNet*0.6);
  const reasons=[];
  if(score>=minScore) reasons.push(`Score ${num(score,1)}/10`);
  if(crv>=minCrv) reasons.push(`${claude?'Plan-CRV':'Struktur-CRV'} ${num(crv,1)}:1`);
  if(!claude&&planEff>=FUSION_MIN_PLAN_EFFICIENCY) reasons.push(`Plan-Effizienz ${num(planEff,1)}:1`);
  if(net>=minNet) reasons.push(`Plan netto ${eur(net,0)}`);
  if(Number(r.relVol||0)>=1.5) reasons.push(`RVOL ${num(r.relVol,1)}×`);
  if(claude&&Number.isFinite(Number(r.claude.expectancyR))) reasons.push(`EV ${num(r.claude.expectancyR,2)}R`);
  const ready=r.light==='green'&&score>=minScore&&f.key==='live'&&opportunityPhase&&tr.ok&&crv>=minCrv&&net>=minNet&&tp2>=minTp2;
  const tier=ready?(net>=(claude?minNet*2:OPPORTUNITY_HIGH_NET_EUR)?'high':'opportunity'):(net>0&&net<ignoreBelow?'ignore':'watch');
  const cTag=claude?' · CLAUDE':'';
  const label=(tier==='high'?'HIGH OPPORTUNITY':tier==='opportunity'?'OPPORTUNITY':tier==='ignore'?'UNINTERESSANT':'NOCH KEINE OPPORTUNITY')+cTag;
  let why='';
  if(net>0&&net<ignoreBelow) why=`Nur ${eur(net,0)} realistisches Netto-Potenzial – für Aufwand/Risiko zu klein.`;
  else if(net>0&&net<minNet) why=`Netto-Potenzial ${eur(net,0)} liegt unter der Opportunity-Schwelle ${eur(minNet,0)}.`;
  else if(crv<minCrv) why=`${claude?'Plan-CRV':'Struktur-CRV'} ${num(crv,1)}:1 liegt unter ${num(minCrv,1)}:1.`;
  else if(!claude&&planEff<FUSION_MIN_PLAN_EFFICIENCY) why=`50/50-Plan nach Kosten nur ${num(planEff,2)}:1; Minimum ${num(FUSION_MIN_PLAN_EFFICIENCY,2)}:1.`;
  else if(tp2<minTp2) why=`Verbleibender realistischer Kursweg bis TP2 nur ${num(tp2,1)}%.`;
  else if(f.key!=='live') why='Daten sind nicht live – keine Opportunity-Freigabe.';
  else if(!opportunityPhase) why='Marktphase ist für eine Opportunity-Freigabe nicht aktiv.';
  if(claude&&!ready&&Array.isArray(r.claude.blockers)&&r.claude.blockers.length&&!why) why=r.claude.blockers.join(' · ');
  /* v3.5.8 (P0): Grundtyp der Blockade – EINE Wahrheitsquelle fuer die Kopfzeile.
     Rein additiv: keine Schwelle, kein Score, keine technische Marke wird beruehrt.
     Reihenfolge bewusst wirtschaftlich-zuerst: genau dieser Fall (gruenes Muster,
     aber CRV/Netto zu klein) hat den SOFI-Widerspruch erzeugt. */
  const econFail = !sz || !(net>=minNet) || !(crv>=minCrv) || !(tp2>=minTp2) || (!claude && !(planEff>=FUSION_MIN_PLAN_EFFICIENCY));
  const blockKind = ready ? null
    : (!sz ? 'data'
    : econFail ? 'economic'
    : f.key!=='live' ? 'data'
    : !opportunityPhase ? 'phase'
    : score<minScore ? 'quality'
    : !tr.ok ? 'executability'
    : 'quality');
  return {ready,tier,label,why,blockKind,reasons:reasons.slice(0,3),distance:Math.max(0,minScore-score),minNet};
}

/* ---- v3.5.8 · P0-Fix: Kopfzeile vs. wirtschaftliche Bewertung ---------------
   Befund (SOFI, 26.8., v3.5.6): Die Kopfzeile las `r.light`/`r.verdict` direkt und
   schrieb "🟢 Kauf-Setup · Claude", waehrend die Opportunity-Zeile darunter
   "UNINTERESSANT · nur 54 € – fuer Aufwand/Risiko zu klein" sagte. Der gruene Punkt
   bewertete NUR die Musterqualitaet, nie die Wirtschaftlichkeit.

   Diese Funktion ist reine ANZEIGELOGIK:
   - Sie veraendert weder Score noch BUY-Gate noch Entry/Stop/TP (Invarianten 2–4).
   - Sie darf gegenueber `r.light` nur ABWERTEN, niemals aufwerten (Invariante 1,
     fail-closed). Die Klemme unten erzwingt das strukturell.                    */
const HEADLINE_RANK = { red:0, muted:1, yellow:1, green:2 };

/* ---- v3.6.1 · P2b: dasselbe Prinzip fuer Krypto ----------------------------
   Befund aus dem 3.5.9-Audit: `renderCoin` faerbte die Karte ueber `r.light`
   und den Punkt ueber `dotc ${r.light}` — also allein nach Musterqualitaet,
   waehrend `buyReady(r)` die echte Freigabe prueft. Strukturell exakt der
   SOFI-Fall, nur auf der Krypto-Seite. Auch hier: reine ANZEIGELOGIK,
   dieselbe Klemme, kein Eingriff in Score oder Gates.                        */
function coinHeadline(r){
  const light=(r&&r.light)||'red';
  const cap=HEADLINE_RANK[light]??0;
  const clamp=(h)=>(HEADLINE_RANK[h.light]>cap)
    ? {...h, light, icon:VERDICT_ICON[light]||'🔴', text:String(r?.verdict||''), kind:'pattern'}
    : h;
  const base={light, icon:VERDICT_ICON[light]||'🔴', text:String(r?.verdict||''), kind:'pattern',
    title:'Bewertung allein des Kursmusters: 🟢 sauber, 🟡 unklar, 🔴 kein Trade.\n\nEine Kauf-Freigabe braucht zusätzlich die richtige Zonenlage und ein ausreichendes Chance-Risiko-Verhältnis.'};
  if(light!=='green') return clamp(base);
  if(buyReady(r)) return clamp({light:'green', icon:'🟢', text:'BUY', kind:'buy',
    title:'Alle Bedingungen erfüllt: Musterqualität, Einstieg in der geplanten Zone und ausreichendes Chance-Risiko-Verhältnis nach Kosten.\n\nVorschlag nach deinen eigenen Regeln, keine Prognose.'});
  const minCrv=(S.claudeMode&&r.claude)?CLAUDE_MIN_CRV_COIN:Number(S.minCrvCoin||DEFAULTS.minCrvCoin);
  const crv=Number(r.netCRV||0);
  const sz=sizing(r), net=Number(sz?.planNet||0);
  if(crv<minCrv) return clamp({light:'yellow', icon:'🟡', text:'Setup ok · CRV zu niedrig', kind:'economic',
    title:`Das Kursmuster sieht gut aus, aber das Chance-Risiko-Verhältnis liegt bei ${num(crv,1)}:1 und damit unter deiner Grenze von ${num(minCrv,1)}:1.${net>0?` Der Plan brächte netto nur ${eur(net,0)}.`:''}\n\nStop und Ziele werden NICHT verschoben, damit die Zahlen passen.\n\n${gloss('crv')}`});
  if(!r.inZone) return clamp({light:'yellow', icon:'🟡', text:'Setup ok · nicht in der Einstiegszone', kind:'zone',
    title:'Das Kursmuster sieht gut aus, aber der Kurs steht gerade nicht im geplanten Einstiegsbereich.\n\nÜber der Zone heißt: der Einstieg ist davongelaufen. Hinterherlaufen verschlechtert das Chance-Risiko-Verhältnis, weil der Stop dann weiter entfernt liegt.'});
  return clamp({light:'yellow', icon:'🟡', text:'Setup ok · keine Kauf-Freigabe', kind:'quality',
    title:'Das Kursmuster ist grün, aber mindestens eine Freigabebedingung fehlt noch.\n\nGrün heißt: das Muster stimmt. Kaufen heißt: das Muster stimmt UND die Zonenlage passt UND das Chance-Risiko-Verhältnis reicht.'});
}

function modeTagOf(r){ const m=/·\s*(Claude|FusionPulse)\s*$/.exec(String(r?.verdict||'')); return m?` · ${m[1]}`:''; }
function stockHeadline(r){
  const light = (r && r.light) || 'red';
  const cap = HEADLINE_RANK[light] ?? 0;
  const clamp = (h) => (HEADLINE_RANK[h.light] > cap)
    ? { ...h, light, icon: VERDICT_ICON[light]||'🔴', text: String(r?.verdict||'') } // darf nie aufwerten
    : h;
  if (light !== 'green') return clamp({
    light, icon: VERDICT_ICON[light]||'🔴', text: String(r?.verdict||''), kind:'pattern',
    title:'Bewertung allein des Kursmusters: 🟢 sauber, 🟡 unklar, 🔴 kein Trade.\n\nEine Kauf-Freigabe braucht zusätzlich: aktuelle Daten, offenen Markt, ausreichenden Kursweg und genug Gewinnpotenzial nach Kosten.'
  });
  /* v3.8.2: MUSS vor dem BUY-Zweig stehen. Ein Setup, das alle Bedingungen
     erfuellt, aber am selben Abend Zahlen hat, ist genau der Fall, den die
     Warnung abfangen soll — danach abzufragen waere wirkungslos gewesen. */
  const ewCrit = earningsWarning(r?.symbol);
  if (ewCrit && ewCrit.critical) return clamp({
    light:'yellow', icon:'⚠', text:`Setup ok · Quartalszahlen ${ewCrit.when}${modeTagOf(r)}`, kind:'event', title:ewCrit.detail });
  if (stockLevel(r) === 3) return clamp({
    light:'green', icon:'🟢', text:'BUY', kind:'buy',
    title:'Alle Bedingungen sind gleichzeitig erfüllt: Musterqualität, aktuelle Daten, offener Markt, ausführbare Größe und ein Gewinnpotenzial, das Risiko und Kosten rechtfertigt.\n\nDas ist ein Vorschlag nach deinen eigenen Regeln, keine Prognose. FusionPulse führt nichts automatisch aus.'
  });
  const tag = modeTagOf(r);
  if (mutedSetupSet.has(setupOf(r))) return clamp({
    light:'muted', icon:'🔇', text:`Setup stummgeschaltet · kein BUY${tag}`, kind:'muted',
    title:`Du hast diesen Mustertyp in der Selbstauswertung (Modul 0) stummgeschaltet.\n\n${gloss('mute')}`
  });
  if (portfolioBlocksNewBuy(r)) {
    const px = portfolioExposure();
    return clamp({ light:'yellow', icon:'🟡', text:`Setup ok · Risikobudget ausgeschoepft${tag}`, kind:'portfolio',
      title:`Das Muster ist gruen, aber dein Gesamt-Risikobudget ist ausgeschoepft: ${eur(px.usedRisk,0)} von ${eur(px.budget,0)} gebunden, frei nur noch ${eur(px.freeRisk,0)} bei real ${eur(px.perTradeReal,0)} Risiko je Trade (inkl. Ausfuehrungskosten am Stop). Die Budget-Sperre ist in den Einstellungen aktiv und kann dort abgeschaltet werden.` });
  }
  const opp = stockOpportunity(r);
  const detail = opp.why ? ` ${opp.why}` : '';
  const byKind = {
    economic:{ text:`Setup ok · wirtschaftlich uninteressant${tag}`,
      title:`Das Kursmuster sieht gut aus — aber der Trade lohnt sich rechnerisch nicht: zu wenig möglicher Gewinn im Verhältnis zu Risiko, Gebühren und Aufwand.${detail}\n\nWichtig: Stop und Ziele werden NICHT verschoben, damit die Zahlen besser aussehen. Lieber kein Trade als ein schöngerechneter.\n\n${gloss('crv')}` },
    data:{ text:`Setup ok · Daten nicht belastbar${tag}`,
      title:`Das Kursmuster sieht gut aus, aber die zugrunde liegenden Daten sind zu alt oder unvollständig.${detail}\n\nGrundregel von FusionPulse: schlechtere Daten dürfen ein Signal nie besser machen. Im Zweifel gibt es keine Freigabe.` },
    phase:{ text:`Setup ok · ausserhalb Handelsfenster${tag}`,
      title:`Das Kursmuster sieht gut aus, aber die US-Börse ist gerade nicht in einer Phase, in der du das vernünftig ausführen könntest.${detail}\n\nAußerhalb der Haupthandelszeit sind die Kurse dünner: größere Spreads, schlechtere Ausführung.\n\n${gloss('spread')}` },
    executability:{ text:`Setup ok · nicht ausfuehrbar${tag}`,
      title:`Das Kursmuster sieht gut aus, aber die Grenzen, die du dir selbst gesetzt hast (Mindestgewinn, Mindestkursweg, Marktphase), sind nicht erfüllt.${detail}\n\nDiese Grenzen stehen in den Einstellungen und lassen sich dort ändern.` },
    quality:{ text:`Setup ok · keine Kauf-Freigabe${tag}`,
      title:`Das Kursmuster ist grün, aber mindestens eine Freigabebedingung fehlt noch.${detail}\n\nGrün heißt hier: das Muster stimmt. Kaufen heißt: das Muster stimmt UND der Trade lohnt sich UND er ist ausführbar.` }
  };
  const pick = byKind[opp.blockKind] || byKind.quality;
  return clamp({ light:'yellow', icon:'🟡', text:pick.text, title:pick.title, kind:opp.blockKind||'quality' });
}

/* v3.9.0 · Welches Sizing-Modell gilt? An EINER Stelle beantwortet, damit
   Anzeige, Rechnung und Gates nie auseinanderlaufen. */
const sizeModeFixed = () => String(S?.sizeMode || 'risk') === 'fixed';
const fixedTradeEur = () => { const v = Number(S?.fixedTradeEur); return Number.isFinite(v) && v > 0 ? v : DEFAULTS.fixedTradeEur; };

function stockSizing(r) {
  if (r.entryEur == null || r.stopEur == null || !(r.entryEur > r.stopEur)) return null;
  const perUnit = r.entryEur - r.stopEur;
  const fixed = sizeModeFixed();
  let qty;
  let sizeBasis;
  if (fixed) {
    /* Kaufsumme ist die Eingabe. Das Risiko am Stop ergibt sich daraus und wird
       NICHT begrenzt — es wird ausgewiesen. Wer 10.000 EUR in einen Titel legt,
       dessen Stop 4 % entfernt liegt, riskiert 400 EUR plus Kosten. Diese Zahl
       zu verstecken waere die gefaehrlichere Variante. */
    qty = fixedTradeEur() / r.entryEur;
    sizeBasis = 'fixed';
  } else {
    const riskEur = S.equity * (S.riskPct / 100);
    qty = riskEur / perUnit;
    const maxTrade = Math.max(0, Number(S.maxTradeEur || 0));
    if (maxTrade && qty * r.entryEur > maxTrade) qty = maxTrade / r.entryEur;
    sizeBasis = 'risk';
  }
  /* Fail-closed und in BEIDEN Modellen wirksam: die Liquiditaetsgrenze des
     Titels darf nie ueberschritten werden. Im Fixmodus ist das wichtiger als je
     zuvor — 10.000 EUR in einen duennen Nebenwert zu druecken ist genau der
     Fall, in dem der Ausstieg teurer wird als der Einstieg. */
  const cap = Number(r.buyCapacityEur ?? r.buyCapacity);
  let liquidityCapped = false;
  if (Number.isFinite(cap) && cap > 0 && qty * r.entryEur > cap) { qty = cap / r.entryEur; liquidityCapped = true; }
  const notional = qty * r.entryEur;
  const tp1Share = 0.5, tp2Share = 0.5;
  const tp1Gross = (r.tp1Eur - r.entryEur) * qty * tp1Share;
  const tp2Gross = (r.tp2Eur - r.entryEur) * qty * tp2Share;
  const planGross = tp1Gross + tp2Gross;

  // Target path = Entry + TP1 + TP2 (3 executions). Stop path = Entry + Stop (2 executions).
  const targetFixedCosts = orderFeeEur() * 3;
  const stopFixedCosts = orderFeeEur() * 2;
  const frictionTarget = notional * (venueFrictionPct() / 100);
  const frictionStop = notional * (venueFrictionPct() / 100);
  const targetCosts = targetFixedCosts + frictionTarget;
  const stopCosts = stopFixedCosts + frictionStop;

  const planAfterCosts = planGross - targetCosts;
  const stopPriceLoss = (r.entryEur - r.stopEur) * qty;
  const stopLossAfterCosts = stopPriceLoss + stopCosts;
  const planCrvAfterCosts = stopLossAfterCosts > 0 ? Math.max(0, planAfterCosts) / stopLossAfterCosts : 0;
  const taxFactor = 1 - S.taxPct / 100;
  const taxablePlan = Math.max(0, planAfterCosts);
  const planNet = taxablePlan * taxFactor;
  const alloc = planGross > 0 ? Math.max(0, planAfterCosts) / planGross : 0;
  const tp1AfterCosts = Math.max(0, tp1Gross * alloc);
  const tp2AfterCosts = Math.max(0, tp2Gross * alloc);
  const tp1Net = tp1AfterCosts * taxFactor;
  const tp2Net = tp2AfterCosts * taxFactor;
  /* v3.9.0 · Im Fixmodus ist DAS die wichtigste Zahl der ganzen Karte:
     was kostet der Trade, wenn der Stop ausgeloest wird. Inklusive beider
     Ausfuehrungskosten, nicht nur der Kursdifferenz. */
  const stopDistancePct = r.entryEur > 0 ? (perUnit / r.entryEur) * 100 : null;
  const targetDistancePct = (r.entryEur > 0 && r.tp2Eur != null) ? ((r.tp2Eur / r.entryEur - 1) * 100) : null;
  const rewardRiskRaw = (stopDistancePct > 0 && targetDistancePct != null) ? targetDistancePct / stopDistancePct : null;
  return {
    qty, notional, risk: stopPriceLoss,
    sizeBasis, liquidityCapped, stopDistancePct, targetDistancePct, rewardRiskRaw,
    tp1Share, tp2Share, tp1Gross, tp2Gross, planGross,
    targetFixedCosts, stopFixedCosts, frictionTarget, frictionStop, targetCosts, stopCosts,
    planAfterCosts, stopLossAfterCosts, planCrvAfterCosts,
    tp1AfterCosts, tp2AfterCosts, tp1Net, tp2Net, planNet,
  };
}

const VERDICT_ICON = { green: '🟢', yellow: '🟡', red: '🔴' };

/** Aktienpreis: für den Nutzer EUR zuerst, der originale US-Kurs immer direkt in Klammern daneben. */
function stockPx(usdVal, eurVal, d = 2) {
  return eurVal != null
    ? `<span title="EUR ist eine Umrechnung des originalen US-Kurses mit dem aktuellen EUR/USD-Kurs; kein direkter Tradegate-Kurs.">${eur(eurVal, d)} <em class="conv">(${usd(usdVal, d)})</em></span>`
    : `<span title="Kein EUR/USD-Kurs verfügbar – daher nur originaler US-Kurs.">${usd(usdVal, d)}</span>`;
}

function stockSizeDisplay(r, sz, html = true) {
  if (!sz) return '–';
  const lvl = stockLevel(r);
  if (lvl === 3) return html ? `<span class="action-size">${eur(sz.notional,0)}</span>` : eur(sz.notional,0);
  if (r.light === 'yellow' || r.light === 'green') return html ? `<span class="potential-size" title="Nur theoretische Positionsgröße. Aktuell keine Kauf-Freigabe.">pot. ${eur(sz.notional,0)}</span>` : `pot. ${eur(sz.notional,0)}`;
  return html ? '<span class="no-trade-size">— kein Trade</span>' : '— kein Trade';
}
function stockStatusBand(r) { return historyBand(r._history || [], 'Aktien-Signalverlauf'); }

/** Rechte Preisleiter für den Aktien-Fokus. Die Twelve-Data-Quelle ist USD;
 *  bei verfügbarem FX-Kurs werden die Marken bewusst als EUR-Umrechnung
 *  dargestellt, damit SL/TP1/TP2 zur Tradeplanung auf einen Blick lesbar sind. */
function stockLadder(r) {
  const vals = [r.stopEur, r.entryEur, r.tp1Eur, r.tp2Eur, r.priceEur].map(Number);
  if (!vals.every(Number.isFinite)) return `<div class="stock-ladder stock-ladder-na"><small>Preisskala</small><span>EUR/USD fehlt</span></div>`;
  const [stop, entry, tp1, tp2, price] = vals;
  let lo = Math.min(stop, entry, price) * 0.9985;
  let hi = Math.max(tp2, tp1, entry, price) * 1.0015;
  if (!(hi > lo)) { hi = lo + Math.max(0.01, Math.abs(lo) * 0.01); }
  const y = (v) => Math.max(1.5, Math.min(98.5, (1 - (v - lo) / (hi - lo)) * 100));
  const usdMap={TP2:r.tp2Usd,TP1:r.tp1Usd,Entry:r.entryUsd,SL:r.stopUsd};
  const mark = (v, cls, label) => { const u=usdMap[label]; return `<div class="slv ${cls}" style="top:${y(v).toFixed(2)}%"><span>${label}</span><b>${eur(v,2)}${u!=null?` <em class="conv">(${usd(u,2)})</em>`:''}</b></div>`; };
  return `<div class="stock-ladder" title="Aktien-Preisskala: EUR zuerst, originaler US-Kurs in Klammern. EUR ist eine Umrechnung, kein direkter Tradegate-Kurs.">
    ${mark(tp2,'tp2','TP2')}
    ${mark(tp1,'tp1','TP1')}
    ${mark(entry,'entry','Entry')}
    ${mark(stop,'stop','SL')}
    <div class="sl-price" style="top:${y(price).toFixed(2)}%"><span>Aktuell</span><b>${eur(price,2)}${r.priceUsd!=null?` <em class="conv">(${usd(r.priceUsd,2)})</em>`:''}</b></div>
  </div>`;
}

function stockInterpretation(r){
  const c=crowdFor(r.symbol),crowd=c&&Number.isFinite(+c.score)?+c.score:null,accel=c&&Number.isFinite(+c.accel)?+c.accel:null;
  const rv=r.relVol==null?null:+r.relVol,mom=Math.max(+r.ret15||0,(+r.ret60||0)/2),lm=leadModel(r),tw=historicalTwin(r);
  const confirmations=[rv!=null&&rv>=1.5,mom>=1,+r.score>=7].filter(Boolean).length;
  if(crowd!=null&&(crowd>=70||(accel!=null&&accel>=8))&&confirmations===0)return 'Frühe Aufmerksamkeit: Crowd/Search zieht an, Marktvolumen und Momentum bestätigen noch nicht. Beobachten, ob die Marktseite nachzieht.';
  if(crowd!=null&&(crowd>=70||(accel!=null&&accel>=8))&&confirmations>=2)return 'Bestätigung setzt ein: Der frühe Crowd/Search-Impuls wird jetzt auch im Crowd→Markt-Tachometer durch Momentum/Volumen bzw. Technik bestätigt.'+((lm?.n>=5||tw?.n>=5)?' Das passt zu bereits beobachteten Vorläufer-/Twin-Mustern; weiter beobachten.':' Das Muster wird jetzt erstmals marktseitig bestätigt; Learning sammelt weitere Fälle.');
  if(crowd!=null&&crowd>=65&&confirmations===0&&(+r.ret15||0)<=0)return 'Crowd erhöht, aber bislang ohne Preis-/Volumenbestätigung. Noch kein belastbares Setup.';
  if(lm?.cur?.length>=2)return 'Mehrere Frühindikatoren laufen in Folge an ('+lm.cur.slice(0,4).map(k=>LEAD_LABEL[k]||k).join(' → ')+'). Das ist ein beobachtenswertes Muster, aber kein BUY-Signal.';
  if(tw?.n>=5&&tw.edge>=60)return 'Historische Twins sind auffällig positiv, aktuell fehlt aber noch eine klare neue Bestätigung. Beobachten statt vorwegnehmen.';
  return 'Noch kein klarer Vorläuferverbund. Einzelne Änderungen werden beobachtet; für eine Interpretation fehlen derzeit mehrere unabhängige Bestätigungen.';
}

function stockPeek(r) {
  const sz = stockSizing(r);
  const t = (label, tip, val) => `<div class="pk" title="${esc(tip)}"><span>${label}</span><b>${val}</b></div>`;
  return `<div class="stockpeek">
    <header>
      <b>${esc(r.name)}</b>
      <span class="pk-tic" title="Ticker-Symbol an der US-Börse ${esc(r.exchange)}">${esc(r.symbol)} · ${esc(r.exchange)}</span>
      ${(()=>{const h=stockHeadline(r);return `<span class="pk-verdict ${h.light}" title="${esc(h.title)}">${h.icon} ${esc(h.text)}</span>`;})()}
      ${(()=>{const ft=flatexTradability(r);return `<span class="flatex-hint ft-${ft.tone}" title="${esc(ft.detail)}">🏦 ${esc(ft.label)}</span>`;})()}
    </header>
    <div class="pkgrid">
      ${t('Branche', 'Sektor-Zuordnung innerhalb des Aktien-Universums.', esc(r.sector))}
      ${t('Kurs', 'Letzter Kurs aus dem aktiven US-5-Minuten-Marktdatenfeed.', stockPx(r.priceUsd, r.priceEur))}
      ${t('Score', 'Gesamtbewertung von 0–10 aus den aktivierten Analyseverfahren. Höher = mehr Verfahren bestätigen dasselbe Bild.', num(r.score, 1))}
      ${t(S.claudeMode?'Netto-CRV Tradeplan':'Struktur-CRV netto', S.claudeMode?'CRV des tatsächlichen 50/50-Tradeplans nach geschätzten Flatex/Tradegate-Ausführungskosten.':'CRV bis zum am Markt gemessenen Strukturziel. Im FusionPulse-Modus wird dieses 3:1-Kriterium bewusst NICHT mit dem 50/50-Teilverkaufsplan vermischt.', S.claudeMode?(sz?`${num(sz.planCrvAfterCosts,2)} : 1`:`${num(r.netCRV,1)} : 1`):`${num(r.netCRV,2)} : 1`)}
      ${t('50/50-Plan-Effizienz', 'Realer Standardplan nach geschätzten Fixkosten/Spread/Slippage im Verhältnis zum Stop-Pfad. Das ist eine eigene Kennzahl und muss im FusionPulse-Modus nicht 3:1 erreichen.', sz?`${num(sz.planCrvAfterCosts,2)} : 1`:'–')}
      ${t('Setup', 'Erkanntes Kursmuster aus EMA-Staffelung, VWAP-Lage und kurzfristigem Momentum.', esc(r.setup))}
      ${t('Trend', 'Richtung der EMA9 gegenüber der EMA21. EMA = exponentieller gleitender Durchschnitt.', esc(r.trend))}
      ${t('Entry-Zone', 'Preisbereich, in dem der geplante Kauf sinnvoll wird. Enger als ein Punkt, damit ein Tick keinen Trade zerstört.', stockPx(r.zoneLowUsd, r.zoneLowEur) + ' – ' + stockPx(r.zoneHighUsd, r.zoneHighEur))}
      ${t('Stop-Loss (SL)', 'Ausstiegskurs zur Verlustbegrenzung, hier 1,25 × ATR unter dem Einstieg. ATR = mittlere wahre Schwankungsbreite.', stockPx(r.stopUsd, r.stopEur))}
      ${t('TP1 · erster Teilverkauf', 'TP = Take Profit. TP1 ist der erste Teilverkauf, üblicherweise die halbe Position.', stockPx(r.tp1Usd, r.tp1Eur))}
      ${t('TP2 · Restposition', 'TP2 ist der Verkauf der verbleibenden Position.', stockPx(r.tp2Usd, r.tp2Eur))}
      ${t(stockLevel(r)===3?'Kaufsumme':'Potenzielle Größe', stockLevel(r)===3?'Empfohlener Euro-Einsatz bei echter BUY-Freigabe.':'Rechnerische Positionsgröße nur für den Fall, dass später alle BUY-Kriterien erfüllt werden. Aktuell keine Kaufempfehlung.', stockSizeDisplay(r, sz))}
      ${t('SL-Risiko inkl. Kosten', 'Stop-Szenario: Kursverlust plus Entry-/Stop-Ausführungskosten und geschätzte Spread-/Slippage-Reserve.', sz ? eur(sz.stopLossAfterCosts, 0) : '–')}
      ${t('Kosten Target-Pfad', 'Entry + TP1 + TP2: drei Ausführungen. Konservativer Ansatz für typische 5.000–10.000-€-Ausführungen: 9,90 € Flatex-Beispiel + mindestens 0,85 € Tradegate je Ausführung; Spread/Slippage zusätzlich als Schätzung.', sz ? eur(sz.targetCosts, 2) : '–')}
      ${t('Kosten Stop-Pfad', 'Entry + Stop: zwei Ausführungen plus geschätzte Spread-/Slippage-Reserve.', sz ? eur(sz.stopCosts, 2) : '–')}
      ${t('TP1 · 50 % Teilverkauf netto', 'Geschätzter Nettogewinn des ersten Teilverkaufs mit 50 % der Position.', sz ? eur(sz.tp1Net, 0) : '–')}
      ${t('TP2 · 50 % Restverkauf netto', 'Geschätzter Nettogewinn der verbleibenden 50 % der Position bei TP2.', sz ? eur(sz.tp2Net, 0) : '–')}
      ${t('Gesamtplan netto', 'Geschätzter Nettogewinn des Standardplans: 50 % bei TP1 und 50 % bei TP2.', sz ? eur(sz.planNet, 0) : '–')}
      ${t('ATR', 'ATR = Average True Range, mittlere Schwankungsbreite in Prozent des Kurses.', num(r.atrPct, 2) + ' %')}
      ${t('Rel. Volumen', 'Aktuelles Volumen im Verhältnis zum Mittel der letzten 20 Bars. Über 1× heißt überdurchschnittliches Interesse.', r.relVol==null ? 'n. v.' : num(r.relVol, 2) + '×')}
      ${t('5m / 15m / 1h', 'Kursveränderung über die letzten 5, 15 und 60 Minuten.', `${num(r.ret5, 2)} % / ${num(r.ret15, 2)} % / ${num(r.ret60, 2)} %`)}
    </div>
    <div class="stock-interpret"><b>Was hat sich geändert? · Interpretation</b><span>${esc(stockInterpretation(r))}</span><small>Crowd/Learning-Interpretation · 0 % BUY-Gewicht</small></div>
    <footer>US-Feed (${esc(r.exchange)}), Stand ${esc(r.updated || '–')}. Aktienkurse werden als EUR-Umrechnung mit originalem USD-Kurs in Klammern gezeigt${r.fxUsdPerEur ? ` (EUR/USD ${num(r.fxUsdPerEur, 4)})` : ''}; keine direkten Tradegate-Kurse.</footer>
  </div>`;
}

const STOCK_DISPLAY_META={
  MRNA:['Moderna, Inc.','Biotech / Pharma'], IONQ:['IonQ, Inc.','Technologie / Quantencomputing'],
  RGTI:['Rigetti Computing, Inc.','Technologie / Quantencomputing'], ABSI:['Absci Corporation','Biotech / KI-Wirkstoffentwicklung'],
  AEM:['Agnico Eagle Mines Limited','Rohstoffe / Gold'], AG:['First Majestic Silver Corp.','Rohstoffe / Silber'],
  CEG:['Constellation Energy Corporation','Energie / Kernenergie'], UTHR:['United Therapeutics Corporation','Biotech / Pharma'],
  VEEV:['Veeva Systems Inc.','Technologie / Life-Sciences-Software'], SDGR:['Schrödinger, Inc.','Biotech / Wirkstoffsoftware'],
  PLTR:['Palantir Technologies Inc.','Technologie / KI & Datenanalyse'], NVDA:['NVIDIA Corporation','Technologie / Halbleiter & KI'],
  MSFT:['Microsoft Corporation','Technologie / Software & Cloud'], AAPL:['Apple Inc.','Technologie / Hardware & Dienste'],
  AMZN:['Amazon.com, Inc.','Konsum / E-Commerce & Cloud'], TSLA:['Tesla, Inc.','Automobil / Elektromobilität']
};
function stockDisplayMeta(r){
  const m=STOCK_DISPLAY_META[String(r?.symbol||'').toUpperCase()];
  return {name:(m?.[0]||r?.name||r?.symbol||'–'), theme:(m?.[1]||r?.sector||'US-Aktie')};
}

/* v3.6.1: Was ein Punkt in der Heatmap WIRKLICH bedeutet.
   Beide Achsen sind technisch (Musterqualitaet hoch, Ausfuehrbarkeit rechts).
   Wirtschaftlichkeit steckt in KEINER der beiden — deshalb kommt sie hier
   ueber die Kopfbewertung in Farbe und Mouseover dazu. */
function stockHeatmapMark(r){
  const hl=stockHeadline(r), sz=stockSizing(r), tr=stockTradeability(r);
  const weak=hl.kind==='economic';
  const tip=[
    `${r.symbol}${r.name?' · '+r.name:''}`,
    `${hl.icon} ${hl.text}`,
    `Musterqualität ${num(r.score,1)}/10 · Ausführbarkeit ${Number.isFinite(Number(r.executability))?num(r.executability,1)+'/10':'n.v.'}`,
    `CRV ${num(tr.netCrv,1)}:1 · Weg TP2 ${num(tr.tp2Pct,1)} % · ${sz?`Plan netto ${eur(sz.planNet,0)}`:'Plan netto n.v.'}`,
    'Beide Achsen der Karte messen nur Technik. Ob sich der Trade lohnt, steckt in der Farbe und in der Zeile darüber — nicht in der Position.',
    'Klick: Aktie öffnen'
  ].join('\n');
  return {light:hl.light, weak, tip};
}

function stockHeatmap(shown) {
  const svg = $('#stockMap'); if (!svg) return;
  const g = (x) => 14 + (Math.max(0, Math.min(10, x)) / 10) * 172;
  const pts = shown.slice(0, 24).map((r) => {
    const ex = Number.isFinite(Number(r.executability)) ? Number(r.executability) : 0;
    return { r, x:g(ex), y:200-g(Number(r.score||0)), rad:5+Math.max(0,(Number(r.score||0)-5)*.7) };
  });
  for(let it=0;it<15;it++) for(let i=0;i<pts.length;i++) for(let j=i+1;j<pts.length;j++){
    const a=pts[i],b=pts[j],dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||.1,m=a.rad+b.rad+3;
    if(d<m){const q=(m-d)*.16,ux=dx/d,uy=dy/d;a.x-=ux*q;a.y-=uy*q;b.x+=ux*q;b.y+=uy*q;}
  }
  /* v3.6.4: Die Spur sagt jetzt, WOHIN sich ein Titel bewegt. Nach rechts oben
     = Muster wird sauberer UND besser handelbar; das ist die Ecke, in der ein
     Trade ueberhaupt erst moeglich wird. Solche Spuren werden gruen und mit
     Pfeilspitze gezeichnet, ruecklaeufige gedaempft. Die Spur des gerade
     ausgewaehlten Titels wird zusaetzlich hervorgehoben.
     WICHTIG: das ist eine Bewegungs-, keine Ertragsaussage — auch ein Titel,
     der sauber nach rechts oben wandert, kann wirtschaftlich uninteressant
     bleiben. Deshalb bleibt die hohle Punktdarstellung davon unberuehrt. */
  const focusSym=String(focusStock||'').toUpperCase();
  /* v3.9.3 · ZWEITER BEFUND, gemeldet als „der gruene Strich zeigt mir nicht die
     Aktie, die nach oben gezogen ist".
     Ursache: Die PUNKTE laufen oben durch 15 Runden Kollisionsaufloesung und werden
     dabei auseinandergeschoben. Die SPUREN wurden danach aus den Rohkoordinaten neu
     berechnet — ohne diese Verschiebung. Spurende und zugehoeriger Punkt lagen also
     systematisch woanders, und zwar umso weiter, je dichter das Feld ist. Im Cluster
     rechts oben sind das leicht 15–20 Punkte Versatz: die Spur endete im Nichts.
     Behoben, indem die Spur um denselben Vektor verschoben wird, den ihr Punkt
     erfahren hat. Damit endet jede Spur zwingend an ihrem eigenen Punkt.
     Zusaetzlich traegt die Pfeilspitze jetzt das Kuerzel — ein Tooltip allein ist
     in einem dichten Feld nicht treffbar. */
  const trails = pts.map(({r,x,y}) => {
    const h=(r._history||[])
      .filter(p=>Date.now()-p.ts<=HISTORY_WINDOW_MS)
      .filter(p=>Number.isFinite(Number(p.executability))&&Number.isFinite(Number(p.quality)))
      .slice(-8);
    if(h.length<2) return '';
    const raw=h.map(p=>({x:g(Number(p.executability)),y:200-g(Number(p.quality))}));
    const last=raw[raw.length-1];
    // Versatz aus der Kollisionsaufloesung, inklusive der Randbegrenzung der Punkte.
    const ox=Math.max(10,Math.min(190,x))-last.x, oy=Math.max(10,Math.min(190,y))-last.y;
    const xy=raw.map(p=>({x:p.x+ox,y:p.y+oy}));
    const points=xy.map(p=>`${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const a0=xy[0], a1=xy[xy.length-1];
    const dx=a1.x-a0.x, dy=a0.y-a1.y;            // dy>0 = nach oben
    const move=Math.hypot(dx,dy);
    const dir = move<6 ? 'flat' : (dx>=-2 && dy>=-2 && (dx+dy)>4) ? 'sweet' : (dx+dy)<-4 ? 'back' : 'side';
    const isFocus=String(r.symbol||'').toUpperCase()===focusSym;
    /* v3.12.0 · BEFUND: Kuerzel und Pfeilspitze hingen an `dir==='sweet'`, also
       ausschliesslich an AUFWAERTSspuren. Der Nutzer sah in der Heatmap fast nur
       abwaerts laufende Striche — und die trugen konstruktionsbedingt weder
       Kuerzel noch Richtung. Seine Meldung „ich sehe nur den Strich und leider
       nicht den Aktienticker" beschreibt exakt diese halbe Loesung.
       Die Einschraenkung auf 'sweet' war nie begruendet und faellt weg.

       Zwei Regeln bleiben aber, sonst wird die Karte unlesbar:
         - Nur Spuren ab MIN_TAG_MOVE bekommen ein Kuerzel. Ein Titel, der kaum
           wandert, sagt nichts aus und braucht auch keinen Namen — im dichten
           Cluster wuerden sich sonst fuenfzehn Kuerzel ueberlagern.
         - Das Kuerzel sitzt am ANFANG der Spur, die Pfeilspitze am ENDE. Damit
           liest sich jede Spur als „von wo nach wo", statt raten zu lassen,
           welches Ende das aktuelle ist. */
    const MIN_TAG_MOVE = 9;
    const showTag = move >= MIN_TAG_MOVE;
    // Pfeilspitze in die tatsaechliche Bewegungsrichtung drehen.
    const ang = Math.atan2(a1.y-a0.y, a1.x-a0.x);
    const ap = (len,off)=>`${(a1.x-Math.cos(ang-off)*len).toFixed(1)},${(a1.y-Math.sin(ang-off)*len).toFixed(1)}`;
    const head = dir==='flat' ? '' :
        `<polygon class="trailhead dir-${dir}" points="${(a1.x).toFixed(1)},${(a1.y).toFixed(1)} ${ap(5.2,.42)} ${ap(5.2,-.42)}"/>`
      + (showTag ? `<text class="trailtag dir-${dir}" x="${(a0.x).toFixed(1)}" y="${(a0.y+3.4).toFixed(1)}">${esc(String(r.symbol||'').slice(0,5))}</text>` : '');
    return `<g class="trailwrap dir-${dir}${isFocus?' focus':''}"><polyline class="stocktrail ${r.light}" points="${points}"/>${head}<title>${esc(`${r.symbol}: ${dir==='sweet'?'wandert Richtung rechts oben — Muster wird sauberer und besser handelbar':dir==='back'?'bewegt sich zurück nach links unten — Muster verliert an Qualität oder Handelbarkeit':dir==='flat'?'steht seit zwei Stunden praktisch still':'bewegt sich seitlich'}. Die Spur endet an ihrem eigenen Punkt. Bewegungsrichtung der letzten 2 Stunden, keine Ertragsaussage.`)}</title></g>`;
  }).join('');
  svg.innerHTML=`<rect class="stockbg" x="0" y="0" width="200" height="200" rx="8"/><rect class="quad qa" x="100" y="0" width="100" height="100"/><rect class="quad qb" x="0" y="0" width="100" height="100"/><rect class="quad qc" x="100" y="100" width="100" height="100"/><rect class="quad qd" x="0" y="100" width="100" height="100"/><line class="ax" x1="100" y1="0" x2="100" y2="200"/><line class="ax" x1="0" y1="100" x2="200" y2="100"/><text class="quad-label ql-tr" x="151" y="11">MUSTER STARK<tspan class="ql2" x="151" dy="7.4">gut handelbar</tspan></text><text class="quad-label ql-tl" x="49" y="11">MUSTER STARK<tspan class="ql2" x="49" dy="7.4">schwer handelbar</tspan></text><text class="quad-label ql-br" x="151" y="187">MUSTER SCHWACH<tspan class="ql2" x="151" dy="7.4">gut handelbar</tspan></text><text class="quad-label ql-bl" x="49" y="187">MUSTER SCHWACH<tspan class="ql2" x="49" dy="7.4">schwer handelbar</tspan></text>${trails}`+
    /* v3.6.1: Die Punktfarbe folgt jetzt der Kopf-Bewertung statt allein r.light,
     und der Mouseover nennt das Netto-Potenzial. Vorher konnte ein Titel im
     Feld oben rechts gruen leuchten, waehrend sein Plan netto 20 EUR brachte —
     die Achsen messen naemlich BEIDE nur Technik, nie Ertrag. */
  pts.map(({r,x,y,rad})=>{
    const hl=stockHeatmapMark(r);
    return `<g class="dot light-${hl.light} ${stockLevel(r)===3?'buy-ready':''} ${hl.weak?'econ-weak':''}" data-openstock="${esc(r.symbol)}" transform="translate(${Math.max(10,Math.min(190,x)).toFixed(1)} ${Math.max(10,Math.min(190,y)).toFixed(1)})"><circle class="hit" r="${rad+7}"/><circle class="core" r="${rad}"/><text x="0" y="2.2">${esc(r.symbol.slice(0,5))}</text><title>${esc(hl.tip)}</title></g>`;
  }).join('');
  svg.querySelectorAll('[data-openstock]').forEach(dot=>dot.addEventListener('click',async()=>{
    focusStock=dot.dataset.openstock||''; renderStocks();
    const found=stockRows.some(r=>r.symbol===focusStock); if(!found) await searchStockNow(focusStock);
    $('#stockFocus')?.scrollIntoView({behavior:'smooth',block:'start'});
  }));
}

/* v3.5.9 · Modul 2 UI: eine Kachel, die ehrlich sagt wie viel Risiko wirklich
   offen ist und ob alles am selben Faden haengt. Keine Betraege noetig, die
   nicht ohnehin schon da sind. */
/* v3.6.1: Das Glossar war bisher nur ueber Mouseover erreichbar. Wer nicht
   weiss, WO eine Erklaerung liegt, findet sie nicht. Deshalb zusaetzlich eine
   durchsuchbare Liste in den Einstellungen — dieselbe Quelle, kein Duplikat. */
const GLOSS_GROUPS = [
  {title:'Kursmuster (das, was Modul 0 stummschalten kann)', keys:['pullback','breakout','squeeze','reclaim','elliott','relative']},
  {title:'Analyseverfahren (die Häkchen oben)',              keys:['vwap','ema21','rs','mtf','volume','book']},
  {title:'Kennzahlen im Fokusfenster',                        keys:['score','maturity','situationScore','lifecyclePhase','execScore','sectorTag']},
  {title:'Zeit & Datenstand',                                 keys:['dataFreshness','tradingHours','serpQuota']},
  {title:'Marktstimmung & Marktbreite',                       keys:['fearGreed','contrarian','breadth']},
  {title:'Erkannte Kursereignisse (Situation Engine)',        keys:['sit_squeeze','sit_breakoutStart','sit_breakoutPressure','sit_reclaim','sit_pullbackHold','sit_acceleration','sit_nearHigh','sit_openingDrive','sit_watch']},
  {title:'Bewertung eines Trades',                            keys:['crv','planEff','rMultiple','expectancy','atr','rvol','notional','spread','slippage','tickerSym','rewardRisk','stopDistance']},
  {title:'Positionsgröße und Handelsmodus (v3.9.0)',          keys:['sizeModeRisk','sizeModeFixed','maxLoss','tradeModeA','consolidation','quoteAge']},
  {title:'Selbstauswertung (Modul 0)',                        keys:['sampleN','inSample','oos','wilson','overfit','multiTest','mute','hysterese']},
  {title:'Handelbarkeit beim Broker (v3.9.1)',                keys:['brokerAvail']},
  {title:'Portfolio-Risiko (Modul 2)',                        keys:['riskPerTrade','portfolioBudget','cluster','diversify','stopReal']},
];
const GLOSS_LABEL = {
  pullback:'Pullback / Rücksetzer', breakout:'Breakout / Ausbruch', squeeze:'Squeeze / Kompression',
  reclaim:'Reclaim / Rückeroberung', elliott:'Elliott-Wellen & Fibonacci', relative:'Relative Stärke',
  vwap:'VWAP', ema21:'EMA / Trendstaffelung', rs:'Relative Stärke vs. BTC', mtf:'Multi-Timeframe',
  volume:'Volumen', book:'Orderbuch', crv:'CRV / Chance-Risiko-Verhältnis', planEff:'Plan-Effizienz',
  rMultiple:'R (Risiko-Einheit)', expectancy:'Erwartungswert (EV)', atr:'ATR / Schwankungsbreite',
  rvol:'RVOL / relatives Volumen', notional:'Kaufsumme (Notional)', spread:'Spread', slippage:'Slippage',
  sizeModeRisk:'Risikobasierte Positionsgröße', sizeModeFixed:'Fester Einsatz je Trade',
  stopDistance:'Stop-Distanz (%)', rewardRisk:'Ziel : Stop (Kursweite)', maxLoss:'Maximaler Verlust am Stop',
  tradeModeA:'Modus A · Momentum-Tageshandel', quoteAge:'Kursalter / Live-Kurs-Pflicht',
  consolidation:'Konsolidierung nach dem Impuls',
  tickerSym:'Ticker-Kürzel (z. B. SOFI)', sampleN:'n / Fallzahl', inSample:'In-Sample', oos:'Out-of-Sample',
  wilson:'Wilson-Untergrenze', overfit:'Overfitting / Überanpassung', multiTest:'Mehrfachtest-Korrektur',
  mute:'Stummschalten', hysterese:'Hysterese', riskPerTrade:'Risiko je Trade',
  portfolioBudget:'Gesamt-Risikobudget', cluster:'Klumpenrisiko', diversify:'Streuung / Diversifikation',
  stopReal:'Warum das echte Risiko höher ist',
  dataFreshness:'Datenstand vs. Abfragezeit', tradingHours:'US-Handelszeiten in unserer Zeit',
  serpQuota:'SerpAPI-Kontingent (Crowd/Search)',
  fearGreed:'Fear & Greed Index (Krypto-Stimmung)', contrarian:'Antizyklisch denken', breadth:'Marktbreite / Risk-On–Risk-Off',
  score:'Score (0–10)', maturity:'Reife (0–100 %)', situationScore:'Situation (0–100)',
  lifecyclePhase:'Phase (PREP / IGNITION / CONFIRM / LATE)', execScore:'Ausführbarkeit (0–10)',
  sectorTag:'Branche / Sektor', brokerAvail:'flatex-Handelbarkeit (Hinweis)',
  sit_squeeze:'SQUEEZE RELEASE', sit_breakoutStart:'BREAKOUT START', sit_breakoutPressure:'BREAKOUT PRESSURE',
  sit_reclaim:'RECLAIM', sit_pullbackHold:'PULLBACK HOLD', sit_acceleration:'ACCELERATION',
  sit_nearHigh:'NEAR HIGH', sit_openingDrive:'OPENING DRIVE', sit_watch:'WATCH',
};
let glossQuery='';
function renderGlossary(){
  const el=$('#glossaryList'); if(!el) return;
  const q=glossQuery.trim().toLowerCase();
  const hit=(k)=>!q||(GLOSS_LABEL[k]||k).toLowerCase().includes(q)||String(GLOSS[k]||'').toLowerCase().includes(q);
  const blocks=GLOSS_GROUPS.map(g=>{
    const keys=g.keys.filter(k=>GLOSS[k]&&hit(k));
    if(!keys.length) return '';
    return `<section class="gloss-group"><h4>${esc(g.title)}</h4>${keys.map(k=>
      `<details class="gloss-item"${q?' open':''}><summary>${esc(GLOSS_LABEL[k]||k)}</summary><p>${esc(GLOSS[k])}</p></details>`).join('')}</section>`;
  }).filter(Boolean).join('');
  el.innerHTML = blocks || `<p class="hint">Kein Eintrag passt zu „${esc(glossQuery)}“.</p>`;
}

function renderPortfolioRisk(){
  const el=$('#portfolioRisk'); if(!el) return;
  const px=portfolioExposure();
  const head=`<div class="pf-head"><b>🧮 Portfolio-Risiko &amp; Klumpung</b><small>Summe ueber ALLE offenen Positionen · Sektor-Naeherung, keine gerechnete Korrelation · kein Score-Eingriff</small></div>`;
  if(!px.items.length){
    el.innerHTML=head+`<span class="hint">Noch keine aktive Position erfasst. Sobald du im Fokusfenster eine reale Position uebernimmst, wird hier das gebundene Gesamtrisiko und die Klumpung berechnet. Budget: <b>${eur(px.budget,0)}</b> (${num(S.portfolioRiskPct ?? DEFAULTS.portfolioRiskPct,2)} % von ${eur(S.equity,0)}) · das entspricht ${px.perTrade>0?Math.floor(px.budget/px.perTrade):0} parallelen Trades zu je ${eur(px.perTrade,0)}.</span>`;
    return;
  }
  const pctClamped=Math.max(0,Math.min(100,px.usedPct));
  const barTone=px.budgetFull?'full':px.budgetWarn?'warn':'ok';
  const bar=`<div class="pf-bar ${barTone}" title="${esc('Gebundenes Risiko bis zum Stop, inklusive geschätzter Ausführungskosten. Das ist NICHT die Kaufsumme — die ist ein Vielfaches davon. '+gloss('notional'))}"><span style="width:${pctClamped.toFixed(1)}%"></span></div>`;
  const budgetLine=`<div class="pf-budget"><span title="${esc('Summe dessen, was du bei allen offenen Positionen zusammen verlierst, wenn überall der Stop greift. '+gloss('riskPerTrade'))}">Gebunden <b>${eur(px.usedRisk,0)}</b></span><span title="${esc(gloss('portfolioBudget'))}">Budget <b>${eur(px.budget,0)}</b></span><span title="${esc('Anteil des Gesamtbudgets, der schon vergeben ist. Über 100 % heißt: du riskierst gleichzeitig mehr, als du dir selbst erlaubt hast.')}">Ausgeschoepft <b>${num(px.usedPct,0)} %</b></span><span title="Wie viele weitere Trades noch ins Budget passen — gerechnet mit dem REALEN Risiko je Trade von ${esc(eur(px.perTradeReal,0))}, nicht mit dem reinen Kursrisiko von ${esc(eur(px.perTrade,0))}.">Noch frei <b>${px.slotsLeft} Trade${px.slotsLeft===1?'':'s'}</b> (${eur(px.freeRisk,0)})</span></div>`;

  const secList=px.sectors.length?`<div class="pf-sectors">${px.sectors.map(sx=>`<span class="pf-sec${px.clustered&&px.top&&sx.sector===px.top.sector?' hot':''}" title="${esc(sx.sector+': '+eur(sx.risk,0)+' gebundenes Risiko aus '+sx.n+' Position'+(sx.n===1?'':'en')+'. '+gloss('cluster'))}"><b>${esc(sx.sector)}</b> ${num(sx.pct,0)} % · ${sx.n}</span>`).join('')}</div>`:'';

  let warn='';
  if(px.usedPriceRisk>0 && px.costFactor>1.15) warn+=`<div class="pf-warn cost" title="${esc(gloss('stopReal')+' '+gloss('spread')+' '+gloss('slippage'))}">💡 <b>Dein Einzeltrade-Risiko ist optimistischer als die Realitaet.</b> Die Positionsgroesse rechnet mit reinem Kursrisiko (${eur(px.usedPriceRisk,0)} gebunden). Am Stop kommen Ausfuehrungskosten dazu — real sind es ${eur(px.usedRisk,0)}, also das ${num(px.costFactor,2)}-fache. Ein Trade zu nominell ${eur(px.perTrade,0)} kostet dich am Stop eher ${eur(px.perTradeReal,0)}. Die Restkapazitaet oben ist deshalb bewusst gegen den realen Wert gerechnet.</div>`;
  if(px.clustered) warn+=`<div class="pf-warn cluster" title="${esc(gloss('cluster')+' '+gloss('diversify'))}">⚠ <b>${num(px.top.pct,0)} % deines offenen Risikos haengt an einem Faktor: ${esc(px.top.sector)}</b> (${px.top.n} Positionen). Im Stressfall bewegen sich diese Titel erfahrungsgemaess gemeinsam — dein tatsaechliches Risiko ist dann groesser als die Summe der Einzelrisiken suggeriert.</div>`;
  if(px.budgetFull) warn+=`<div class="pf-warn full">⛔ Gesamt-Risikobudget vollstaendig ausgeschoepft. ${px.guard?'Die Budget-Sperre ist aktiv: neue BUY-Freigaben werden bis zur Entlastung unterdrueckt.':'Die Budget-Sperre ist AUS — neue BUYs werden weiterhin freigegeben. Einschalten in den Einstellungen.'}</div>`;
  else if(px.budgetWarn) warn+=`<div class="pf-warn near">⚠ ${num(px.usedPct,0)} % des Gesamt-Risikobudgets sind gebunden. Nach dem naechsten Trade zu ${eur(px.perTrade,0)} waeren es ${num(px.budget>0?((px.usedRisk+px.perTrade)/px.budget)*100:0,0)} %.</div>`;
  if(px.unknownCount) warn+=`<div class="pf-warn unknown">ℹ ${px.unknownCount} Position${px.unknownCount===1?'':'en'} (${eur(px.unknownNotional,0)} Kaufsumme) ${px.unknownCount===1?'ist':'sind'} nicht bewertbar, weil die Aktie gerade nicht geladen ist und damit kein technischer Stop vorliegt. ${px.unknownCount===1?'Sie ist':'Sie sind'} bewusst NICHT geschaetzt und fehlt in der Summe oben — das gebundene Risiko ist also eher hoeher als angezeigt.</div>`;

  el.innerHTML=head+budgetLine+bar+secList+warn+
    `<small class="pf-note" title="Was diese Kachel bewusst NICHT tut.">Grundlage sind deine erfassten realen Positionen und die technischen Stops aus der Analyse. Die Klumpung ist eine <b>Sektor-Naeherung</b>: zwei Titel im selben Sektor koennen gegenlaeufig laufen, zwei aus verschiedenen Sektoren am selben Zins- oder Dollarfaktor haengen. Eine echte Preisreihen-Korrelation ist noch nicht gerechnet.${px.guard?'':' Die Budget-Sperre ist derzeit AUS: diese Kachel warnt, blockiert aber nichts.'}</small>`;
}

function renderDepotStrip() {
  const el=$('#depotStrip'); if(!el) return;
  const favs=S.favoriteStocks||[];
  if(!favs.length){el.innerHTML='<span><b>★ Favoriten / Depot</b> · noch leer — Stern bei einer Aktie antippen.</span>';return;}
  el.innerHTML=`<b>★ Favoriten / Depot (${favs.length})</b>`+favs.map(symb=>`<button class="depotchip" draggable="true" data-depot="${esc(symb)}" title="Ziehen zum Neuordnen · Klick öffnet ${esc(symb)}"><span class="dragmark" aria-hidden="true">⋮⋮</span>${esc(symb)}</button>`).join('');
  el.querySelectorAll('[data-depot]').forEach(b=>{
    b.onclick=async()=>{focusStock=b.dataset.depot;const q=$('#stockQ');if(q)q.value='';renderStocks();if(!stockRows.some(r=>r.symbol===focusStock)){await searchStockNow(focusStock);renderStocks();}};
    b.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/plain',b.dataset.depot);e.dataTransfer.effectAllowed='move';b.classList.add('dragging')});
    b.addEventListener('dragend',()=>b.classList.remove('dragging'));
    b.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='move'});
    b.addEventListener('drop',e=>{e.preventDefault();const from=e.dataTransfer.getData('text/plain');moveFavorite(from,b.dataset.depot)});
  });
  bindPointerReorder(el,'.depotchip','depot',moveFavorite);
}


function stars(n){
  const x=Math.max(0,Math.min(5,Math.round(Number(n)||0)));
  return '★'.repeat(x)+'☆'.repeat(5-x);
}
function crowdFor(symbol){ return crowdMap.get(String(symbol||'').toUpperCase()) || null; }
function crowdForFresh(symbol){
  const c=crowdFor(symbol);
  return c && Number.isFinite(Number(c.score)) && (!c._ts || Date.now()-Number(c._ts)<=60*60_000) ? c : null;
}
function crowdMarketConfirmation(r){
  const c=crowdForFresh(r?.symbol), crowd=c?+c.score:null;
  if(crowd==null) return {score:null,label:'n.v.',detail:'Noch keine Crowd/Search-Daten.'};
  const rv=r?.relVol==null?null:+r.relVol;
  const vol=rv==null?null:Math.max(0,Math.min(100,(rv-.7)*70));
  const mom=Math.max(0,Math.min(100,50+(+r?.ret15||0)*18+(+r?.ret5||0)*8));
  const tech=Math.max(0,Math.min(100,(+r?.score||0)*10));
  const vals=[[vol,.5],[mom,.3],[tech,.2]].filter(([v])=>Number.isFinite(v));
  const den=vals.reduce((z,[,wt])=>z+wt,0)||1;
  const market=vals.reduce((z,[v,wt])=>z+v*wt,0)/den;
  // Hoher Wert nur, wenn Aufmerksamkeit vorhanden UND Marktreaktion beginnt.
  const score=Math.round(Math.max(0,Math.min(100,(crowd*.35)+(market*.65))));
  return {score,label:score>=70?'bestätigt':score>=45?'beginnt':'noch ruhig',
    detail:`Crowd ${Math.round(crowd)}/100 · RVOL ${rv==null?'n.v.':num(rv,2)+'×'} · 15m ${num(+r?.ret15||0,2)} % · Technik ${num(+r?.score||0,1)}/10`};
}
function crowdGauge(symbol, compact=false){
  const c=crowdFor(symbol);
  const ok=!!(c && Number.isFinite(Number(c.score)) && (!c._ts || Date.now()-Number(c._ts)<=60*60_000));
  const v=ok?Math.max(0,Math.min(100,Number(c.score))):0;
  const cls=ok?'':' crowd-na';
  const title=ok
    ? `Crowd/Search ${num(v,0)}/100 · Suchdynamik ${stars(c.stars)}. Basis: ${c.source||'Google Trends'}. Frühsensor, unabhängig vom Marktvolumen.`
    : `Crowd/Search noch ohne Live-Suchdaten. ${crowdMeta.configured===false?'Optional SERPAPI_KEY in Cloudflare setzen.':'Daten werden geladen.'} Keine Werte werden erfunden.`;
  return `<span class="crowd-wrap${cls}" title="${esc(title)}"><span class="crowd-gauge" style="--v:${v}"><i class="crowd-needle"></i></span><span class="crowd-label"><b>${ok?num(v,0):'–'}</b>${compact?'Crowd':'Crowd/Search'} · ${ok?stars(c.stars):'n.v.'}</span></span>`;
}
function crowdConfirmGauge(r, compact=false){
  const c=crowdMarketConfirmation(r), ok=Number.isFinite(c.score), v=ok?c.score:0;
  return `<span class="crowd-wrap crowd-confirm${ok?'':' crowd-na'}" title="${esc('Crowd → Marktbestätigung '+(ok?v+'/100':'n.v.')+'. Bedeutet für Laien: Dieser Tacho schaut auf den tatsächlichen Handel – beginnen Volumen, Momentum und technische Stärke anzuziehen? Er kann auch hoch sein, wenn Crowd niedrig ist. Dann bewegt sich der Markt bereits, ohne dass die breite Suchaufmerksamkeit vorher auffällig war. Crowd hoch + Markt niedrig = nur frühe Aufmerksamkeit. Beide hoch = gegenseitige Bestätigung. '+c.detail+'. 0 % direktes BUY-Gewicht.')}" ><span class="crowd-gauge" style="--v:${v}"><i class="crowd-needle"></i></span><span class="crowd-label"><b>${ok?v:'–'}</b>${compact?'Crowd→Markt':'Crowd → Markt'} · ${esc(c.label)}</span></span>`;
}

/* v3.0 — lokales Fallback-Archiv. Primär wird jetzt D1 serverseitig verwendet;
 * lokaler Speicher bleibt nur als Rückfall, solange D1 noch nicht verbunden ist.
 * Lernt nur aus später
 * tatsächlich beobachteten Kursen; keine synthetischen Trefferquoten. */
const TWIN_KEY='fp.stockTwins.v1';
let twinStore=(()=>{try{return JSON.parse(localStorage.getItem(TWIN_KEY)||'{"pending":[],"done":[]}')}catch{return {pending:[],done:[]}}})();
function saveTwins(){try{localStorage.setItem(TWIN_KEY,JSON.stringify(twinStore))}catch{}}
function featureOf(r){const c=crowdForFresh(r.symbol),cc=crowdMarketConfirmation(r);return {score:+r.score||0,crv:+r.netCRV||0,rv:+r.relVol||0,r15:+r.ret15||0,r60:+r.ret60||0,atr:+r.atrPct||0,vac:+r.liquidityVacuum||0,lag:+r.sectorLag||0,crowd:c?+c.score:null,crowdConfirm:Number.isFinite(cc.score)?cc.score:null};}
function twinDist(a,b){const w={score:1.2,crv:.7,rv:.45,r15:.5,r60:.25,atr:.5,vac:.035,lag:.35,crowd:.025,crowdConfirm:.03};let z=0;for(const k in w)z+=Math.pow((a[k]-b[k])*w[k],2);return Math.sqrt(z)}
function historicalTwin(r){
  const srv=learningStock.get(String(r.symbol||'').toUpperCase())?.twin;
  if(srv&&Number(srv.n)>0)return {...srv,source:srv.source||'d1'};
  const f=featureOf(r),MAX_DIST=3.25,byEpisode=new Map();
  for(const x of (twinStore.done||[])){
    if(!(x.symbol===r.symbol || (!!r.sector && x.sector===r.sector)))continue;
    const dist=twinDist(f,x.f||{});if(!Number.isFinite(dist)||dist>MAX_DIST)continue;
    const day=new Date(Number(x.ts)||Number(x.resolved)||0).toISOString().slice(0,10);
    const key=`${String(x.symbol||'').toUpperCase()}:${day}`;
    const v={...x,d:dist},prev=byEpisode.get(key);if(!prev||dist<prev.d)byEpisode.set(key,v);
  }
  const d=[...byEpisode.values()].sort((a,b)=>a.d-b.d).slice(0,40),available=d.length;
  if(d.length<5)return {n:d.length,available,distinctSymbols:new Set(d.map(x=>x.symbol)).size,source:'local'};
  const stops=d.filter(x=>x.minPct<=-1.5).length,med=[...d].map(x=>x.maxPct).sort((a,b)=>a-b)[Math.floor(d.length/2)];
  let winW=0,totalW=0;for(const x of d){const w=1/Math.pow(1+Math.max(0,+x.d||0),2);totalW+=w;if(x.maxPct>=5)winW+=w;}
  return {n:d.length,available,distinctSymbols:new Set(d.map(x=>x.symbol)).size,stops,median:med,edge:totalW?Math.round(winW/totalW*100):0,source:'local',independent:true};
}
function learnStocks(){const now=Date.now(),pending=twinStore.pending||[],done=twinStore.done||[];for(const x of pending){const r=stockRows.find(z=>z.symbol===x.symbol);if(r){const pct=(r.priceUsd/x.px-1)*100;x.maxPct=Math.max(x.maxPct??pct,pct);x.minPct=Math.min(x.minPct??pct,pct)}}const keep=[];for(const x of pending){if(now-x.ts>=120*60_000)done.push({...x,resolved:now});else keep.push(x)}const bucket=Math.floor(now/(15*60_000));for(const r of stockRows){if(!keep.some(x=>x.symbol===r.symbol&&x.bucket===bucket))keep.push({symbol:r.symbol,sector:r.sector,ts:now,bucket,px:r.priceUsd,f:featureOf(r),maxPct:0,minPct:0})}twinStore={pending:keep.slice(-500),done:done.slice(-2500)};saveTwins();}
function edgeSignals(r){const c=crowdForFresh(r.symbol),crowd=c?+c.score:null;const quiet=Math.max(0,100-Math.min(100,Math.abs(+r.ret15||0)*18));const apd=crowd==null?null:Math.round(Math.max(0,Math.min(100,crowd*.72+quiet*.28)));const vac=Math.round(+r.liquidityVacuum||0);const lag=r.sectorLag==null?null:+r.sectorLag;const lagScore=Math.round(Math.max(0,Math.min(100,50+(lag??0)*18)));const tw=historicalTwin(r);return {apd,vac,lag,lagScore,tw};}

/* v3.0.7 — Early-Momentum-Learning. Lernt die Reihenfolge, in der unabhängige
 * Frühindikatoren VOR einer real beobachteten >=5%-Expansion anspringen.
 * Forschungsmodul: 0 % BUY-Gewicht, damit keine Selbstbestätigung entsteht. */
const LEAD_KEY='fp.stockLeadLearning.v1';
let leadStore=(()=>{try{return JSON.parse(localStorage.getItem(LEAD_KEY)||'{"active":{},"done":[],"cooldown":{}}')}catch{return {active:{},done:[],cooldown:{}}}})();
function saveLead(){try{localStorage.setItem(LEAD_KEY,JSON.stringify(leadStore))}catch{}}
const LEAD_LABEL={attention:'Attention',crowd:'Crowd',sector:'Sektor',rvol:'RVOL',vacuum:'Vacuum',structure:'Elliott',elliott:'Elliott',momentum:'Momentum',technical:'Technik'};
function leadFlags(r){const e=edgeSignals(r),c=crowdForFresh(r.symbol);return {
  attention:e.apd!=null&&e.apd>=70,
  crowd:c&&Number.isFinite(+c.score)&&+c.score>=70,
  sector:+r.sectorLag>=0.8,
  rvol:+r.relVol>=2,
  vacuum:+r.liquidityVacuum>=70,
  structure:+r.structurePct>=5,
  momentum:(+r.ret15>=1)||(+r.ret60>=2),
  technical:+r.score>=7
};}
function updateLeadLearning(){
  const now=Date.now(),active=leadStore.active||{},done=leadStore.done||[],cool=leadStore.cooldown||{};
  for(const r of stockRows){
    const sym=String(r.symbol||'').toUpperCase(),px=+r.priceUsd;if(!sym||!Number.isFinite(px)||px<=0)continue;
    const flags=leadFlags(r),names=Object.keys(flags).filter(k=>flags[k]);
    let ep=active[sym];
    if(!ep && names.length && (!cool[sym]||now>cool[sym])) ep=active[sym]={symbol:sym,sector:r.sector||'',start:now,basePx:px,triggers:{},maxPct:0,minPct:0};
    if(!ep)continue;
    const pct=(px/ep.basePx-1)*100;ep.maxPct=Math.max(ep.maxPct??pct,pct);ep.minPct=Math.min(ep.minPct??pct,pct);
    for(const k of names)if(!ep.triggers[k])ep.triggers[k]=now;
    const age=now-ep.start;
    if(pct>=5 || age>=180*60_000 || pct<=-3){
      const success=pct>=5;const seq=Object.entries(ep.triggers).sort((a,b)=>a[1]-b[1]).map(([k,ts])=>({k,leadMin:success?Math.max(0,(now-ts)/60000):null}));
      done.push({...ep,end:now,success,hitPct:pct,sequence:seq});delete active[sym];cool[sym]=now+45*60_000;
    }
  }
  leadStore={active,done:done.slice(-3000),cooldown:cool};saveLead();
}
function leadModel(r){
  const sym=String(r.symbol||'').toUpperCase();
  const srv=learningStock.get(sym)?.lead;
  const active=leadStore.active?.[sym];
  const cur=active?Object.entries(active.triggers||{}).sort((a,b)=>a[1]-b[1]).map(([k])=>k):[];
  if(srv&&Number.isFinite(Number(srv.n))) return {...srv,cur};
  const sector=String(r.sector||'');let pool=(leadStore.done||[]).filter(x=>x.success&&x.sequence?.length);
  const sec=pool.filter(x=>sector&&x.sector===sector);if(sec.length>=5)pool=sec;
  const n=pool.length;
  if(!n)return {n:0,cur};
  const first={};const leads={};for(const x of pool){const q=x.sequence||[];if(q[0])first[q[0].k]=(first[q[0].k]||0)+1;for(const z of q){(leads[z.k]??=[]).push(z.leadMin)}}
  const firstKey=Object.entries(first).sort((a,b)=>b[1]-a[1])[0]?.[0]||null;
  const med=k=>{const a=(leads[k]||[]).filter(Number.isFinite).sort((a,b)=>a-b);return a.length?a[Math.floor(a.length/2)]:null};
  const best=Object.keys(leads).map(k=>({k,m:med(k),n:leads[k].length})).filter(x=>x.n>=3).sort((a,b)=>b.m-a.m).slice(0,3);
  return {n,cur,firstKey,best};
}
function leadBadge(r){const m=leadModel(r);const cur=m.cur.length?m.cur.slice(0,4).map(k=>LEAD_LABEL[k]).join('→'):'wartet';let learned='lernt';if(m.n>=5){const f=m.firstKey?LEAD_LABEL[m.firstKey]:'–';const lead=m.best[0]&&Number.isFinite(m.best[0].m)?` · ${LEAD_LABEL[m.best[0].k]} ~${Math.round(m.best[0].m)}m vor +5%`:'';learned=`${f} zuerst · n=${m.n}${lead}`;}return `<span title="Early-Momentum-Learning: speichert, welcher Frühindikator wie viele Minuten VOR einer tatsächlich beobachteten +5%-Expansion angesprungen ist. Aktuelle Reihenfolge: ${esc(cur)}. Auswertung erst nach echten Fällen; 0 % BUY-Gewicht.">🧬 Lead ${esc(cur)} · ${esc(learned)}</span>`;}
function edgeStrip(r){const e=edgeSignals(r),tw=e.tw;const twinSrc=tw.source==='d1'?'D1':'lokal';const ds=tw.distinctSymbols!=null?` · ${tw.distinctSymbols} Titel`:'';const avail=tw.available!=null&&tw.available!==tw.n?`/${tw.available}`:'';const indep=tw.independent?' · unabhängig':'';const twin=tw.n>=5?`${tw.edge}% · n=${tw.n}${avail}${ds}${indep} · ${twinSrc}`:`lernt · n=${tw.n}${avail}${ds}${indep} · ${twinSrc}`;return `<div class="edge-strip"><span title="Attention-Price-Divergence: hohe Suchaufmerksamkeit bei noch relativ ruhigem Preis. Forschungsindikator, kein BUY allein.">⚡ Attention ${e.apd==null?'n.v.':e.apd+'/100'}</span><span title="Liquidity Vacuum: heuristisch wenig frühere Aktivität/Widerstand direkt oberhalb des Einstiegs. Höher kann schnellere Expansion begünstigen.">↗ Vacuum ${e.vac}/100</span><span title="Sector Leader-Lag: positiver Wert bedeutet, dass andere Titel derselben Branche kurzfristig stärker laufen. Beobachtet potenzielle Nachzügler.">⇢ Sektor-Lag ${e.lag==null?'n.v.':num(e.lag,1)+'%'}</span><span title="Historical Twin: bevorzugt serverseitig in Cloudflare D1 gelernte, ähnlichste frühere Markt-Snapshots; lokal nur Fallback. Prozent = Anteil der ähnlichen Fälle mit mindestens +5 % beobachteter Maximalbewegung. Erst ab 5 Fällen angezeigt.">🧠 Twin ${twin}</span>${leadBadge(r)}</div>`;}


function learningBadge(){
  const st=learningData?.stats||{};
  if(learningData?.configured===false) return '🧠 D1 nicht verbunden';
  if(learningData?.state==='error') return '🧠 Learning-Fehler';
  const age=st.lastTs?mins(Date.now()-st.lastTs):'–';
  return `🧠 ${Number(st.snapshots||0)} Setups · ${Number(st.resolved||0)} ausgewertet · letzter ${age}`;
}
/* v3.14.2 · Die Ampel nennt jetzt die Quelle.
   Gemeldet: „SYSTEM ist rot, was ist da los". Die Leiste sagte nur
   „Handlungsbedarf · Datenquelle oder Worker fehlerhaft" — WELCHE Quelle,
   stand nur im Tooltip. Dazu kommt: `alpaca` hat in der Kopfzeile gar keinen
   eigenen Punkt. Krypto, Aktien und Tiingo konnten also alle gruen leuchten,
   waehrend die Ampel wegen Alpaca rot war. Das ist derselbe Widerspruch
   zwischen Kopf und Kleingedrucktem wie bei SOFI in v3.5.8, nur eine Zeile
   hoeher. Die Bewertung bleibt unveraendert — es kommt nur der Name dazu. */
const RESOURCE_LABEL={crypto:'Krypto (Bitpanda)',stocks:'Aktien (Twelve Data)',alpaca:'Premarket/Opening (Alpaca)'};
function renderResourceStrip(){
  const box=$('#resourceStrip'), out=$('#resourceText'); if(!box||!out)return;
  const hs=health?.status||{}; const states=[hs.crypto?.state,hs.stocks?.state,hs.alpaca?.state].filter(Boolean);
  const red=states.some(x=>['error','nokey'].includes(x));
  const orange=states.some(x=>['cpu','daylimit'].includes(x));
  const yellow=states.some(x=>['ratelimit','stale','warn','unknown'].includes(x));
  const level=red?'red':orange?'orange':yellow?'yellow':'green';
  const bad=level==='green'?[]:Object.keys(RESOURCE_LABEL)
    .filter(k=>{const st=hs[k]?.state;if(!st||st==='ok')return false;
      return level==='red'?['error','nokey'].includes(st)
        :level==='orange'?['cpu','daylimit'].includes(st)
        :['ratelimit','stale','warn','unknown'].includes(st);})
    .map(k=>`${RESOURCE_LABEL[k]}: ${STATE_TEXT[hs[k].state]||hs[k].state}`);
  const who=bad.length?' · '+bad.join(' · '):'';
  const text=(level==='green'?'App läuft einwandfrei · Datenserver stabil · kein Handlungsbedarf':level==='yellow'?'App funktioniert · einzelne Datenquelle eingeschränkt · kein unmittelbarer Handlungsbedarf':level==='orange'?'App eingeschränkt · Ressourcen/Limit beobachten':'Handlungsbedarf · Datenquelle fehlerhaft')+who;
  out.textContent=text;
  box.classList.remove('warn','orange','err','ok'); box.classList.add(level==='green'?'ok':level==='yellow'?'warn':level==='orange'?'orange':'err');
  box.dataset.tip=`${text}. Krypto: ${hs.crypto?.state||'n.v.'}; Aktien: ${hs.stocks?.state||'n.v.'}; Opening: ${hs.alpaca?.state||'n.v.'}; Tiingo: ${health?.tiingoConfigured?'aktiv':'n.v.'}. Grün = alles stabil, Gelb = funktioniert mit kleiner Einschränkung, Orange = beobachten/zeitnah prüfen, Rot = konkreter Handlungsbedarf.`;
}

function renderLearningReport(){
  const el=$('#learningReport');if(!el)return;const st=learningData?.stats||{};const last=st.lastTs?clock(st.lastTs):'–';
  el.innerHTML=`<b>🧠 Nacht-/Learning-Bericht</b> <small>serverseitig · verändert keine Tradingregel automatisch</small><div class="lr-grid"><span><b>${Number(st.snapshots24h||0)}</b>Beobachtungen 24 h</span><span><b>${Number(st.resolved24h||0)}</b>ausgewertet 24 h</span><span><b>${Number(st.expansions24h||0)}</b>Expansionen 24 h</span><span><b>${last}</b>letztes Learning</span></div><small>Warum sinnvoll? FusionPulse soll nicht nur nachts laufen, sondern sichtbar machen, was gespeichert und später ausgewertet wurde. „Expansion“ bedeutet nur: Nach einer gespeicherten Situation folgte eine relevante Bewegung – noch kein Beweis für ein gutes Kaufsignal.</small>`;
}
function renderLearningStatus(){
  const el=$('#learningState'); if(!el)return;
  el.textContent=learningBadge();
  el.dataset.state=learningData?.configured===false?'warn':learningData?.state==='ok'?'ok':'busy';
  el.title=learningData?.configured===false
    ? 'Cloudflare D1 ist noch nicht als Binding DB verbunden. Bis dahin bleibt lokaler Browser-Speicher nur Fallback.'
    : learningData?.state==='error' ? `Learning-Fehler: ${learningData?.error||'unbekannter Fehler'}. Betrifft die Lern-/Historienanzeige, nicht automatisch die Provider-Verbindung oder Tradingregeln.` : `Serverseitiges Learning in Cloudflare D1. Browserdaten können gelöscht werden, ohne diese ${Number(learningData?.stats?.snapshots||0)} Snapshots zu verlieren.`;
}
function mergeServerHistories(){
  for(const r of stockRows){const h=learningStock.get(r.symbol)?.history;if(Array.isArray(h)&&h.length&&h.some(x=>Number(x.executability)>0))r._history=h;}
  for(const r of rows){const h=learningCoin.get(r.pair)?.history;if(Array.isArray(h)&&h.length&&h.some(x=>Number(x.quality)>0))r._history=h;}
}
let stockReqSeq=0, openingReqSeq=0, learningReqSeq=0, crowdReqSeq=0;
async function loadLearning(){
  const req=++learningReqSeq;
  const stocks=[...new Set([...(S.favoriteStocks||[]),...stockRows.slice(0,20).map(r=>r.symbol),...openingRows.slice(0,10).map(r=>r.symbol)])].slice(0,16);
  const coins=[...new Set([...(S.favoritePairs||[]),...rows.slice(0,20).map(r=>r.pair)])].slice(0,30);
  try{
    const q=new URLSearchParams(); if(stocks.length)q.set('stocks',stocks.join(','));if(coins.length)q.set('coins',coins.join(','));if(S.token)q.set('t',S.token);
    const r=await fetchWithTimeout('/api/learning?'+q,{cache:'no-store'},10_000);const d=await r.json();if(req!==learningReqSeq)return;learningData=d||{};
    learningStock=new Map(Object.entries(d.stocks||{}));learningCoin=new Map(Object.entries(d.coins||{}));
    mergeServerHistories();renderLearningStatus();renderLearningReport();render();renderStocks();
  }catch(e){learningData={configured:true,state:'error',error:String(e.message||e)};renderLearningStatus();}
}
function setLearningPoll(){clearInterval(learningTimer);learningTimer=setInterval(()=>{if(document.visibilityState==='visible'){loadLearning();loadAttribution();loadAladdin();}},120_000);}

/* Modul 1 UI: Aladdin-Style Market Recommendation oberhalb des Radars.
   Reine Anzeige der serverseitigen Marktmeinung; kein Score-Eingriff. */
let aladdinData={};
async function loadAladdin(){
  try{
    const q=new URLSearchParams(); if(S.token)q.set('t',S.token);
    const r=await fetchWithTimeout('/api/aladdin?'+q,{cache:'no-store'},10_000);
    aladdinData=await r.json()||{};
  }catch(e){ aladdinData={state:'error',error:String(e.message||e)}; }
  renderAladdin();
}
function regimeClass(label){ return label==='Risk-On'?'ala-on':label==='Risk-Off'?'ala-off':'ala-neutral'; }
function renderAladdin(){
  const el=$('#aladdinCard'); if(!el)return;
  const d=aladdinData||{};
  if(d.state==='error'){ el.innerHTML=`<div class="ala-head"><b>🧭 Market Intelligence</b><small class="err">${esc(d.error||'Fehler')}</small></div>`; return; }
  const rec=d.recommendation; if(!rec){ el.innerHTML=`<div class="ala-head"><b>🧭 Market Intelligence</b><small>Noch keine Marktdaten – Radar lädt.</small></div>`; return; }
  const reg=d.regime||{};
  const conf=reg.confidence!=null?`Konfidenz ${reg.confidence}%`:'';
  const thin=reg.thin||d.dataBasis?.sampledTitles<20;
  const lead=rec.leadership?.length?rec.leadership.join(' · '):'–';
  const avoid=rec.avoid?.length?rec.avoid.join(' · '):'–';
  const best=rec.best, alt=rec.alt;
  const bestLine=best?`<b>${esc(best.symbol)}</b> <small>${esc(best.why.join(' · '))}</small>`:'–';
  const altLine=alt?`<b>${esc(alt.symbol)}</b> <small>${esc(alt.why.join(' · '))}</small>`:'–';
  el.innerHTML=`
    <div class="ala-head">
      <b>🧭 FusionPulse Market Recommendation</b>
      <small>Aladdin-Style · speist die Empfehlung, ändert keinen Score${thin?' · ⚠ Stichprobe, kein Vollmarkt':''}</small>
    </div>
    <div class="ala-regime ${regimeClass(reg.label)}">
      <span class="ala-badge">${esc(rec.headline)}</span>
      <span class="ala-conf">${conf}${reg.sample?` · Basis ${reg.sample} Titel`:''}</span>
    </div>
    <div class="ala-grid">
      <div class="ala-cell"><span class="ala-k">Führung</span><span class="ala-v up">${esc(lead)}</span></div>
      <div class="ala-cell"><span class="ala-k">Vermeiden</span><span class="ala-v down">${esc(avoid)}</span></div>
      <div class="ala-cell"><span class="ala-k">Beste Situation</span><span class="ala-v">${bestLine}</span></div>
      <div class="ala-cell"><span class="ala-k">Alternative</span><span class="ala-v">${altLine}</span></div>
    </div>
    <div class="ala-stance"><b>Empfehlung:</b> ${esc(rec.stance)}</div>
    ${rec.marketRisk?.length?`<div class="ala-risk"><b>Marktrisiko:</b> ${esc(rec.marketRisk.join(' · '))}</div>`:''}
    ${rec.invalidation?.length?`<div class="ala-inval"><b>Was würde die Meinung ändern:</b> ${esc(rec.invalidation.join(' · '))}</div>`:''}
    <div class="ala-foot">${reg.reasons?.length?esc(reg.reasons.join(' · ')):''}</div>`;
  el.querySelectorAll('[data-openstock]').forEach(b=>b.addEventListener('click',()=>openStockFromDiscovery(b.dataset.openstock)));
}

/* Modul 0 UI: Attribution & Overfitting-Guard. Reine Anzeige der serverseitigen
   Auswertung; sie triggert keine Score-Aenderung, nur Empfehlungen. */
let attributionData={};
async function loadAttribution(){
  try{
    const q=new URLSearchParams(); if(S.token)q.set('t',S.token);
    const r=await fetchWithTimeout('/api/attribution?'+q,{cache:'no-store'},10_000);
    attributionData=await r.json()||{};
    // Paket A: Stummliste in das Set uebernehmen, das stockLevel liest.
    mutedSetupSet = new Set((attributionData.mutedSetups||[]).map(m=>String(m.setup||'').trim()));
    renderStocks(); // Freigabe-Suppression sofort wirksam machen
  }catch(e){ attributionData={configured:true,state:'error',error:String(e.message||e)}; }
  renderAttribution();
}
function attrBadge(v){
  return v==='overfit'?'🟥 Overfit':v==='disable'?'🟧 Abschalten?':v==='weak-watch'?'🟨 Schwach·beobachten':v==='keep'?'🟩 Edge hält':'⬜ Sammelt';
}
/* Paket A: Setup stummschalten / reaktivieren (serverseitig persistiert). */
async function muteSetupAction(setup, action){
  try{
    const q=new URLSearchParams(); q.set('setup',setup); q.set('action',action||'mute'); if(S.token)q.set('t',S.token);
    await fetchWithTimeout('/api/attribution/mute?'+q,{cache:'no-store'},10_000);
    await loadAttribution(); // Ansicht + Suppression aktualisieren
  }catch(e){ /* still, kein UI-Bruch */ }
}
function renderAttribution(){
  const el=$('#attributionReport'); if(!el)return;
  const d=attributionData||{};
  if(d.configured===false){ el.innerHTML=`<b>🔬 Selbstauswertung (Modul 0)</b> <small>D1 nicht verbunden – noch keine Attribution möglich.</small>`; return; }
  if(d.state==='error'){ el.innerHTML=`<b>🔬 Selbstauswertung (Modul 0)</b> <small class="err">Fehler: ${esc(d.error||'unbekannt')}</small>`; return; }
  const buckets=Array.isArray(d.buckets)?d.buckets:[];
  const recs=Array.isArray(d.disableRecommendations)?d.disableRecommendations:[];
  const reRecs=Array.isArray(d.reenableRecommendations)?d.reenableRecommendations:[];
  const mutedList=Array.isArray(d.mutedSetups)?d.mutedSetups:[];
  const rows=buckets.slice(0,12).map(b=>{
    const oos=b.oos?`${b.oos.pct}% <em>(Wilson ${b.oos.wilson}%, n=${b.oosN})</em>`:'–';
    const ins=b.inSample?`${b.inSample.pct}%`:'–';
    const mutedBadge=b.muted?` <span class="attr-muted-badge" title="gestummt seit ${b.mutedDays} Tagen – läuft im Hintergrund weiter">🔇 ${b.mutedDays}T</span>`:'';
    /* v3.5.8 (P2): Schalter statt Textlink. Zeigt Zustand UND Aktion in EINEM
       Element: rechts/an = aktiv, links/aus = gestummt. Jetzt fuer JEDE Zeile,
       nicht nur bei disable/overfit – du sollst jederzeit eingreifen koennen. */
    /* v3.6.0: Der Schalter erklaert jetzt auch, WAS er da schaltet. Wer
       „RECLAIM" nicht kennt, kann sonst nicht entscheiden. */
    const meaning = glossForSetup(b.key);
    const tTitle = (b.muted
      ? `„${b.key}" ist stummgeschaltet: erzeugt keine Kauf-Freigabe, wird aber weiter ausgewertet. Schalter nach rechts = wieder aktiv.`
      : `„${b.key}" ist aktiv und darf eine Kauf-Freigabe erzeugen. Schalter nach links = stummschalten (Auswertung läuft weiter).`)
      + `\n\nWas ist ${b.key}? ${meaning}\n\n${gloss('mute')}`;
    const action=`<label class="attr-toggle${b.muted?' is-muted':''}" title="${esc(tTitle)}">`
      +`<input type="checkbox" data-toggleset="${esc(b.key)}"${b.muted?'':' checked'} aria-label="${esc(tTitle)}">`
      +`<span class="attr-track"><span class="attr-knob"></span></span>`
      +`<em>${b.muted?'gestummt':'aktiv'}</em></label>`;
    /* v3.9.1: `data-lbl` traegt die Spaltenueberschrift in die Karten-Ansicht
       unter 900 px, wo der Tabellenkopf ausgeblendet ist. `attr-action` macht
       die Schalter-Spalte per CSS klebend, damit sie nie mehr aus dem Bild
       scrollt — das war der gemeldete Fehler. */
    return `<tr class="attr-${b.verdict?.status||'sammelt'}${b.muted?' attr-is-muted':''}"><td data-lbl="Setup">${gl(b.key,null,meaning)}${mutedBadge}</td><td data-lbl="n" title="${esc(gloss('sampleN'))}">${b.n}</td><td data-lbl="In-Sample" title="${esc(gloss('inSample'))}">${ins}</td><td data-lbl="Out-of-Sample" title="${esc(gloss('oos')+' '+gloss('wilson'))}">${oos}</td><td data-lbl="Wächter" title="${esc((b.verdict?.reason||'')+' '+gloss('overfit'))}">${attrBadge(b.verdict?.status)}</td><td class="attr-action" data-lbl="Aktion">${action}</td></tr>`;
  }).join('');
  el.innerHTML=`<b>🔬 Selbstauswertung · Modul 0</b> <small>ehrliche Out-of-Sample-Bilanz je Setup · Stummschalten unterdrückt BUY, Auswertung läuft im Hintergrund weiter · kein Score-Eingriff</small>`+
    (buckets.length?`<div class="attr-wrap"><table class="attr-table"><thead><tr><th title="${esc('Art des Kursmusters, das FusionPulse erkannt hat. Mouseover auf den Namen in der Zeile erklärt das jeweilige Muster.')}">Setup</th><th title="${esc(gloss('sampleN'))}">n</th><th title="${esc(gloss('inSample'))}">In-Sample</th><th title="${esc(gloss('oos'))}">Out-of-Sample</th><th title="${esc(gloss('overfit')+' '+gloss('multiTest'))}">Wächter</th><th class="attr-action" title="${esc(gloss('mute')+' '+gloss('hysterese'))}">Aktion</th></tr></thead><tbody>${rows}</tbody></table></div>`:`<span class="hint">Noch keine ausgewerteten Setups im ${d.horizonDays||21}-Tage-Fenster. Der Wächter urteilt erst ab ${d.guard?.MIN_SAMPLE||20} Episoden je Setup.</span>`)+
    (reRecs.length?`<div class="attr-recs reenable" title="${esc(gloss('hysterese'))}"><b>🔔 Wiedereinschalt-Empfehlungen (${reRecs.length})</b>${reRecs.map(r=>`<span class="rec-with-action" title="${esc(r.reason)}">${esc(r.setup)} (Wilson ${r.oosWilson}%) <button class="attr-btn ok" data-unmute="${esc(r.setup)}" title="„${esc(r.setup)}" sofort wieder aktivieren – ohne Umweg über die Tabelle.">▶ reaktivieren</button></span>`).join('')}<small>Diese Setups waren gestummt und haben sich out-of-sample über die (höhere) Reaktivierungs-Schwelle erholt.</small></div>`:'')+
    (recs.length?`<div class="attr-recs" title="${esc(gloss('overfit')+' '+gloss('multiTest'))}"><b>⚠ Abschalt-Empfehlungen (${recs.length})</b>${recs.map(r=>`<span title="${esc(r.reason)}">${esc(r.setup)}: ${r.status}</span>`).join('')}<small>Basiert auf Out-of-Sample-Evidenz mit Mehrfachtest-Korrektur (${d.multiTestPenalty||0} pp strenger). Du entscheidest – Button „stummschalten" in der Tabelle.</small></div>`:`<small>Keine Abschalt-Empfehlung – kein Setup ist out-of-sample klar durchgefallen.</small>`)+
    (mutedList.length?`<div class="attr-muted-list" title="${esc(gloss('mute'))}"><b>🔇 Aktuell gestummt (${mutedList.length})</b>${mutedList.map(m=>`<span>${esc(m.setup)} · ${m.mutedDays}T</span>`).join('')}<small>Gestummte Setups erzeugen kein BUY, werden aber weiter ausgewertet (Cron läuft im Hintergrund).</small></div>`:'')+
    /* v3.5.8 (P2): Ebenen-Klarstellung – Mute und die Analyse-Checkboxen sind zwei
       verschiedene Dinge. Das war die berechtigte Verwirrung aus v3.5.7. */
    `<small class="attr-scope-note" title="Zwei getrennte Ebenen. Modul 0 bewertet ganze Setup-TYPEN aus der Erfolgsstatistik. Die Checkboxen in den Einstellungen legen fest, welche Analyseverfahren überhaupt in den Score einfließen.">ℹ️ Der Schalter betrifft <b>Setup-Typen</b> (Pullback, Reclaim, Breakout …) – <b>nicht</b> die Analyse-Komponenten (VWAP, EMA21, MTF …) in den Einstellungen. Beide Ebenen bleiben bewusst getrennt: Stummschalten ändert deine Einstellungen nicht.</small>`;
  // Schalter- und Button-Handler
  el.querySelectorAll('[data-toggleset]').forEach(t=>t.addEventListener('change',()=>{
    // checked = aktiv => unmute; nicht checked = gestummt => mute
    muteSetupAction(t.dataset.toggleset, t.checked?'unmute':'mute');
  }));
  el.querySelectorAll('[data-mute]').forEach(b=>b.addEventListener('click',()=>muteSetupAction(b.dataset.mute,'mute')));
  el.querySelectorAll('[data-unmute]').forEach(b=>b.addEventListener('click',()=>muteSetupAction(b.dataset.unmute,'unmute')));
}

function renderExperimental(){
  const el=$('#experimentalPanel'); if(!el) return;
  const d=experimentalData||{};
  const cards=[
    ['🧲 Erdmagnetfeld',d.geomag,'Kp/geomagnetische Aktivität. Sterne = aktuelle Aktivität/Dynamik, nicht bullish/bearish.'],
    ['☀️ Sonnenwind',d.solar,'Sonnenwind/Solaraktivität. Experimentelle Regimevariable ohne BUY-Gewicht.'],
    ['🌍 Tektonik',d.seismic,'USGS M4,5+ Aktivität der letzten 24 h. Kein direkter Marktkausalitätsanspruch.'],
    ['🌙 Astro/Zyklen',d.astro,'Derzeit Mondphase/Zyklus. Planetare Ephemeriden werden erst mit sauberer Datenquelle ergänzt.'],
    ['🧠 GCP / GCI',d.collective,'Nur Forschungsvariable. Klassisches GCP beendete 2026 die aktive Datenerfassung; HeartMath hat keine öffentliche Live-API.']
  ];
  el.innerHTML=`<div class="exp-head"><b>🧪 Externe Dynamik · Experimental Lab</b><small title="Diese Ebene beeinflusst BUY derzeit bewusst nicht.">BUY-Gewicht 0 %</small></div><div class="exp-cards">`+
    cards.map(([name,x,help])=>{const ok=x&&Number.isFinite(Number(x.stars));return `<div class="exp-card${ok?'':' exp-na'}" title="${esc(help)}"><b>${name}</b><div class="exp-stars">${ok?stars(x.stars):'☆☆☆☆☆'}</div><small>${ok?esc(x.label||''):'nicht live verfügbar'}</small></div>`}).join('')+'</div>';
}
async function loadExperimental(force=false){
  try{const q=new URLSearchParams();if(S.token)q.set('t',S.token);if(force)q.set('force','1');const r=await fetch('/api/experimental?'+q,{cache:'no-store'});experimentalData=await r.json();renderExperimental();}
  catch(e){experimentalData={error:String(e.message||e)};renderExperimental();}
}
/* ==== v3.6.1 · Crowd-Tacho: warum er nie ausgeschlagen hat ==================
   Befund: `crowdPulse()` im Worker steigt ohne SERPAPI_KEY sofort aus und
   liefert fuer jedes Symbol score:null. Der Client zeigt dann "–" und blendet
   die Nadel aus. Der Grund stand ausschliesslich im Mouseover — ein dauerhaft
   totes Instrument, dessen Ursache versteckt ist, sieht aus wie ein Defekt.
   Zweiter Befund: der Worker setzt `accel:null` hart in jeder Zeile, waehrend
   `stockInterpretation()` auf `accel>=8` prueft. Toter Zweig, konnte nie
   feuern. Beschleunigung wird deshalb jetzt CLIENTSEITIG aus der eigenen
   Verlaufsablage gerechnet — kostet keine zusaetzliche Abfrage.            */
const CROWD_HIST_KEY='fp.crowdHistory.v1';
let crowdHistory=(()=>{try{return JSON.parse(localStorage.getItem(CROWD_HIST_KEY)||'{}')||{};}catch{return {};}})();
function saveCrowdHistory(){try{localStorage.setItem(CROWD_HIST_KEY,JSON.stringify(crowdHistory));}catch{}}
/** Neuen Messpunkt ablegen und die Aenderung je Stunde zurueckgeben. */
function crowdTrack(symbol,score,ts){
  const k=String(symbol||'').toUpperCase();
  if(!Number.isFinite(Number(score))) return null;
  const list=(crowdHistory[k]||[]).filter(x=>Date.now()-Number(x.t||0)<=24*60*60_000);
  const last=list[list.length-1];
  if(!last||Number(ts)-Number(last.t)>=5*60_000) list.push({t:Number(ts)||Date.now(),v:Number(score)});
  crowdHistory[k]=list.slice(-48); saveCrowdHistory();
  // Referenz: aeltester Punkt, der mindestens 45 Minuten zurueckliegt.
  const ref=[...list].reverse().find(x=>Number(ts)-Number(x.t)>=45*60_000);
  if(!ref) return null;
  const hours=Math.max(0.75,(Number(ts)-Number(ref.t))/3_600_000);
  return Math.round(((Number(score)-Number(ref.v))/hours)*10)/10;
}
/** Klartext-Zustand des Crowd-Sensors fuer die sichtbare Statuszeile. */
function crowdStatus(){
  const m=crowdMeta||{};
  if(m.configured===false||m.state==='nokey') return {ok:false,tone:'off',
    label:'Crowd/Search inaktiv – kein SERPAPI-Schlüssel hinterlegt',
    detail:'Der Tacho kann ohne Zugangsschlüssel keine Daten abrufen und bleibt deshalb dauerhaft leer. Das ist kein Defekt. Schlüssel als SERPAPI_KEY in den Cloudflare-Secrets hinterlegen. Ehrlicher Hinweis vorab: SerpAPI ist kostenpflichtig, der Gratis-Tarif liegt bei rund 100 Abfragen im Monat — FusionPulse fragt bis zu 15 Symbole je Lauf ab. Für den Dauerbetrieb reicht das nicht.'};
  if(m.state==='error') return {ok:false,tone:'err',label:'Crowd/Search: Abruf fehlgeschlagen',
    detail:`Der Abruf lief auf einen Fehler: ${String(m.error||'unbekannt')}. Es werden bewusst keine Ersatzwerte erfunden.`};
  const withData=[...crowdMap.values()].filter(x=>Number.isFinite(Number(x.score))).length;
  // v3.6.5: Kontingent gehoert in die Statuszeile, nicht ins Kleingedruckte.
  const q=m.quota||null;
  const qTxt=q?` · Kontingent ${q.used}/${q.budget} im ${q.month}, ${q.left} frei`:'';
  const qDetail=q?` SerpAPI-Kontingent: ${q.used} von ${q.budget} Suchen in diesem Monat verbraucht, ${q.left} frei. Jedes Symbol wird höchstens alle ${q.ttlHours} Stunden neu gesucht, pro Abruf werden nur wenige aufgefrischt${q.pending?`; ${q.pending} warten noch`:''}. Beim Freitarif sind 100 Suchen im Monat verfügbar — deshalb diese Sparsamkeit.${q.persistent?'':' ACHTUNG: Der Zähler kann gerade nicht dauerhaft gespeichert werden (keine D1-Verbindung), der echte Verbrauch kann höher liegen.'}`:'';
  if(m.state==='quota') return {ok:false,tone:'err',label:`Crowd/Search: Monatsbudget erschöpft${qTxt}`,
    detail:`Das SerpAPI-Kontingent für diesen Monat ist aufgebraucht. Es werden bewusst keine weiteren Abfragen gemacht und keine Werte geschätzt. Vorhandene Werte stammen aus dem Zwischenspeicher.${qDetail}`};
  if(!withData) return {ok:false,tone:'wait',label:`Crowd/Search: noch keine Messwerte${qTxt}`,
    detail:`Die Abfrage lief, hat aber noch keine verwertbaren Werte geliefert — entweder gab es keine Treffer, oder die Symbole warten noch auf ihre erste Abfrage. Der Tacho bleibt leer, statt eine Null zu behaupten.${qDetail}`};
  return {ok:true,tone:'ok',label:`Crowd/Search aktiv · ${withData} Symbol${withData===1?'':'e'} mit Messwerten${qTxt}`,
    detail:`Quelle: ${m.rows?.[0]?.source||'Community Search'}. Misst frische Aufmerksamkeit der letzten 24 Stunden — nicht Stimmung, nicht Kaufqualität. 0 % Gewicht im BUY-Score.${qDetail}`};
}
function renderCrowdStatus(){
  const el=$('#crowdStatus'); if(!el) return;
  const st=crowdStatus();
  el.className='crowd-status '+st.tone;
  el.innerHTML=`<b title="${esc(st.detail)}">${st.ok?'📡':st.tone==='off'?'🔌':st.tone==='err'?'⚠':'⏳'} ${esc(st.label)}</b><small>${esc(st.detail)}</small>`;
}

/* ==== v3.8.2 · P6 (Teil 1): Terminwarnung Quartalszahlen ====================
   Reine WARNUNG, niemals ein Signal. Sie kann ausschliesslich abwerten —
   dieselbe Klemme wie ueberall. Wenn Zahlen im Halte-Zeitraum liegen, ist ein
   Intraday-Plan mit 1–2 % Zielweite keine Aussage mehr ueber den Abend.     */
let earnData=null, earnTimer=null;

async function loadEarnings(force=false){
  try{
    const q=new URLSearchParams(); if(S.token)q.set('t',S.token); if(force)q.set('force','1');
    const r=await fetch('/api/earnings?'+q,{cache:'no-store'});
    earnData=await r.json();
  }catch(e){ earnData={state:'unavailable',error:String(e.message||e),auto:[],manual:[]}; }
  renderStocks();
}

/** Naechster bekannter Termin fuer ein Symbol. Manuell schlaegt automatisch. */
function earningsFor(symbol){
  const k=String(symbol||'').trim().toUpperCase(); if(!k||!earnData) return null;
  const pick=(list)=>(list||[]).filter(x=>String(x?.symbol||'').toUpperCase()===k)
    .sort((a,b)=>String(a.date).localeCompare(String(b.date)))[0]||null;
  const m=pick(earnData.manual), a=pick(earnData.auto);
  const hit=m||a; if(!hit) return null;
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:NY_TZ}).format(new Date());
  const days=Math.round((Date.parse(hit.date+'T12:00:00Z')-Date.parse(today+'T12:00:00Z'))/86_400_000);
  if(days<0||days>14) return null;
  const amc=!hit.time||/amc|after|post/i.test(hit.time);
  return {...hit, days, amc, manual:!!m, stale:earnData.state==='stale'};
}
function earningsWarning(symbol){
  const e=earningsFor(symbol); if(!e) return null;
  const when = e.days===0 ? (e.amc?'heute nach Börsenschluss':'heute vor Börsenbeginn')
    : e.days===1 ? (e.amc?'morgen nach Börsenschluss':'morgen vor Börsenbeginn')
    : `in ${e.days} Tagen`;
  const critical = e.days<=1;
  return { critical, days:e.days, when, date:e.date,
    label:`⚠ Quartalszahlen ${when}`,
    detail:[
      `Für diesen Titel sind Quartalszahlen am ${e.date} angesetzt (${e.amc?'nach Börsenschluss':'vor Börsenbeginn'}), also ${when}.`,
      'Was das bedeutet: Der Kurs kann sich danach um ein Vielfaches dessen bewegen, was ein Intraday-Plan als Ziel vorsieht — in beide Richtungen. Eine Position über die Zahlen zu halten ist eine ANDERE Entscheidung als das hier bewertete Setup.',
      'Diese Warnung ist kein Signal. Sie sagt nicht, dass die Zahlen gut oder schlecht werden, und sie kann die Bewertung ausschließlich herabstufen, niemals eine Kauf-Freigabe erzeugen.',
      e.manual?'Quelle: von dir manuell eingetragen.':'Quelle: automatischer Terminkalender.',
      e.stale?'ACHTUNG: Der Kalender war zuletzt nicht erreichbar, dieser Termin stammt aus dem Zwischenspeicher und kann veraltet sein.':'',
      'Vor einer Order den Termin gegenprüfen — Unternehmen verschieben ihn gelegentlich.'
    ].filter(Boolean).join('\n') };
}

/* ==== v3.7.0 · P3: Krypto-Sentiment im Client ===============================
   Additive Anzeigeschicht. Der Wert fliesst NICHT in Score, Level oder
   Freigabe ein — weder bei Krypto noch bei Aktien. Das steht auch im UI. */
let fngData=null, fngTimer=null;
const FNG_TONE_LABEL={'extreme-fear':'😱','fear':'😟','neutral':'😐','greed':'🤑','extreme-greed':'🔥','unknown':'—'};

async function loadSentiment(force=false){
  try{
    const q=new URLSearchParams(); if(S.token)q.set('t',S.token); if(force)q.set('force','1');
    const r=await fetch('/api/sentiment?'+q,{cache:'no-store'});
    fngData=await r.json();
  }catch(e){ fngData={state:'error',error:String(e.message||e),
    note:'Der Stimmungsindex konnte nicht geladen werden. Es wird bewusst kein Ersatzwert erfunden.'}; }
  renderSentiment();
}

function sentimentTitle(d){
  if(!d||d.state==='error') return `Krypto-Stimmungsindex nicht verfügbar. ${d?.error?`Grund: ${d.error}. `:''}Es wird bewusst kein Ersatzwert erfunden.`;
  const age=d.ts?Math.round((Date.now()-Number(d.ts))/3_600_000):null;
  return [
    `Fear & Greed Index ${d.value}/100 — „${d.de}".`,
    d.meaning,
    '',
    'WAS DAS IST: Ein Stimmungswert für den Kryptomarkt, zusammengesetzt aus Schwankungsbreite, Marktmomentum, Social-Media-Aktivität, Bitcoin-Dominanz und Suchtrends. 0 = größtmögliche Angst, 100 = größtmögliche Gier.',
    'WAS ES NICHT IST: Keine Prognose und keine Aussage über einen einzelnen Coin. Er gilt ausschließlich für Krypto — für Aktien sagt er nichts.',
    'Der Wert hat 0 % Gewicht in Score, Bewertung und Kauf-Freigabe. Er ist Kontext, kein Signal.',
    '',
    d.change1d!=null?`Veränderung zum Vortag: ${d.change1d>0?'+':''}${d.change1d}.${d.change7d!=null?` Zur Vorwoche: ${d.change7d>0?'+':''}${d.change7d}.`:''}`:'',
    age!=null?`Stand: vor ${age} Stunde${age===1?'':'n'}. Der Index wird einmal täglich aktualisiert.`:'',
    d.stale?'ACHTUNG: Die Quelle war zuletzt nicht erreichbar — dieser Wert ist nicht aktuell.':'',
    `Quelle: ${d.source||'alternative.me'}.`
  ].filter(Boolean).join('\n');
}

function renderSentiment(){
  const el=$('#sentimentCard'); if(!el) return;
  const d=fngData;
  if(!d||d.state==='error'||!Number.isFinite(Number(d.value))){
    el.className='sentiment-card off';
    el.innerHTML=`<b title="${esc(sentimentTitle(d))}">😐 Krypto-Stimmung nicht verfügbar</b><small>Es wird bewusst kein Ersatzwert erfunden.</small>`;
    return;
  }
  const v=Math.max(0,Math.min(100,Number(d.value)));
  const trend=d.change1d==null?'':d.change1d>0?`▲ +${d.change1d}`:d.change1d<0?`▼ ${d.change1d}`:'→ 0';
  el.className=`sentiment-card ${d.tone||'neutral'}${d.stale?' stale':''}`;
  el.innerHTML=`<b title="${esc(sentimentTitle(d))}">${FNG_TONE_LABEL[d.tone]||'😐'} Krypto-Stimmung: ${v}/100 · ${esc(d.de||'')}${d.stale?' (nicht aktuell)':''}</b>`
    +`<div class="fng-bar" title="${esc('0 = größtmögliche Angst, 100 = größtmögliche Gier. Die Markierung zeigt den heutigen Stand.')}"><span class="fng-mark" style="left:${v}%"></span></div>`
    +`<div class="fng-scale"><i>0 Angst</i><i>50</i><i>100 Gier</i></div>`
    +`<small title="${esc(sentimentTitle(d))}">${esc(d.meaning||'')}${trend?` · ${trend} zum Vortag`:''} <b>Kontext, kein Signal — 0 % Gewicht in der Kauf-Freigabe.</b></small>`;
}

/** Entfernt abgelaufene Crowd-Werte. Fail-closed: im Zweifel loeschen. */
function crowdPrune(maxAgeMs){
  const ttlH=Number(crowdMeta?.quota?.ttlHours)||6;
  const max=Number(maxAgeMs)||ttlH*2*60*60_000;
  const now=Date.now(); let removed=0;
  for(const [sym,v] of [...crowdMap.entries()]){
    const ts=Number(v?._ts||v?.ts||0);
    if(!ts||now-ts>max){ crowdMap.delete(sym); removed++; }
  }
  return removed;
}

async function loadCrowd(force=false){
  const req=++crowdReqSeq;
  /* v3.6.5: Weniger Symbole je Abfrage. Beim Freitarif sind 100 Suchen im
     MONAT verfuegbar — 15 Symbole je Lauf waeren nach sechs Laeufen aufgebraucht.
     Favoriten zuerst, dann die aussichtsreichsten Titel. Der Server frischt
     ohnehin nur wenige davon wirklich auf, der Rest kommt aus dem Cache. */
  const symbols=[...new Set([...(S.favoriteStocks||[]),...openingRows.slice(0,2).map(r=>r.symbol),...stockRows.slice(0,6).map(r=>r.symbol)])]
    .filter(Boolean).slice(0, Math.max(1, Math.min(15, Number(S.crowdSymbolLimit ?? DEFAULTS.crowdSymbolLimit))));
  if(!symbols.length)return;
  /* Invalidierung (Sicherheitsregel seit 3.0): ein Crowd-Wert darf nie ueber
     seine Gueltigkeit hinaus stehenbleiben. Bis 3.6.4 wurde dafuer pauschal
     alles geloescht — das geht jetzt nicht mehr, weil der Server bewusst
     zwischengespeicherte Staende liefert und ein leeres Feld dann eine
     Verschlechterung waere. Stattdessen wird gezielt entfernt:
     alles, was aelter ist als die doppelte Server-Gueltigkeit. Das ist
     strenger als vorher, weil es auch Symbole erfasst, die gar nicht mehr
     angefragt werden und sonst ewig haengengeblieben waeren. */
  crowdPrune();
  try{const q=new URLSearchParams({symbols:symbols.join(',')});if(S.token)q.set('t',S.token);if(force)q.set('force','1');const r=await fetch('/api/crowd?'+q,{cache:'no-store'});const d=await r.json();if(req!==crowdReqSeq)return;crowdMeta=d;
    for(const x of d.rows||[]){
      const ts=Number(x.ts||d.ts||Date.now());
      // v3.6.1: Beschleunigung clientseitig, weil der Worker hier immer null liefert.
      const accel=Number.isFinite(Number(x.accel))?Number(x.accel):crowdTrack(x.symbol,x.score,ts);
      crowdMap.set(x.symbol,{...x,accel,_ts:ts});
    }
    renderCrowdStatus(); renderStocks();}
  catch(e){crowdMeta={state:'error',error:String(e.message||e)};renderCrowdStatus();renderStocks();}
}
async function openStockFromDiscovery(symbol){
  const sym=String(symbol||'').trim().toUpperCase(); if(!sym)return;
  focusStock=sym;
  const focus=$('#stockFocus');
  const loaded=stockRows.find(r=>String(r.symbol||'').toUpperCase()===sym);
  if(loaded){
    renderStocks();
    requestAnimationFrame(()=>$('#stockFocus')?.scrollIntoView({behavior:'smooth',block:'start'}));
    return;
  }
  // P0 v3.3.8: Fokusfenster sofort sichtbar machen. Der Nutzer darf nicht auf
  // Live-Quote/Alpaca/Deep-Scan warten muessen, um zu sehen, was angeklickt wurde.
  if(focus){
    focus.innerHTML=`<div class="stockfocus-card yellow"><div class="stockfocus-loading"><small>AUSGEWÄHLTE AKTIE · ${esc(sym)}</small><h3>${esc(sym)}</h3><b>Analyse wird geladen…</b><span>Live-/Referenzkurs wird separat geprüft. Ein langsamer Datenprovider blockiert dieses Fenster nicht.</span></div></div>`;
    requestAnimationFrame(()=>focus.scrollIntoView({behavior:'smooth',block:'start'}));
  }
  const st=$('#stockState');
  if(st){st.textContent=`${sym} wird tief analysiert…`;st.className='badge';}
  try{
    const q=new URLSearchParams({lookup:sym,comp:S.components.join(','),minCrv:S.minCrvStock});if(S.token)q.set('t',S.token);
    const res=await fetchWithTimeout('/api/stocks?'+q,{cache:'no-store'},12_000),data=await res.json();
    if(data.row){
      const returnedSym=String(data.row.symbol||'').trim().toUpperCase();
      if(returnedSym!==sym){
        throw new Error(`Ticker-Mismatch: angefordert ${sym}, erhalten ${returnedSym||'leer'}`);
      }
      const m=new Map(stockRows.map(r=>[String(r.symbol||'').toUpperCase(),r]));m.set(sym,data.row);stockRows=[...m.values()];
      rememberStockRows([data.row]);stockRows=mergeFavoriteRows(stockRows);focusStock=sym;
      if(st){st.textContent=data.cached?'Treffer · Cache':'Treffer geladen';st.className='badge ok';}
    }else{
      if(st){st.textContent=data.error||`${sym} noch nicht tief analysierbar`;st.className='badge warn';}
      if(focus) focus.innerHTML=`<div class="stockfocus-card yellow"><div class="stockfocus-loading"><small>AUSGEWÄHLTE AKTIE · ${esc(sym)}</small><h3>${esc(sym)}</h3><b>Noch keine vollständige Deep-Analyse verfügbar</b><span>${esc(data.error||'Radar-Kandidat bleibt sichtbar; Live-Quote/Analyse kann beim nächsten Zyklus nachgeladen werden.')}</span></div></div>`;
    }
  }catch(e){
    if(st){st.textContent='Aktie konnte nicht geladen werden';st.className='badge err';st.title=String(e.message||e);}
    if(focus) focus.innerHTML=`<div class="stockfocus-card red"><div class="stockfocus-loading"><small>AUSGEWÄHLTE AKTIE · ${esc(sym)}</small><h3>${esc(sym)}</h3><b>Laden derzeit nicht möglich</b><span>${esc(String(e.message||e))}</span></div></div>`;
  }
  renderStocks();
  requestAnimationFrame(()=>$('#stockFocus')?.scrollIntoView({behavior:'smooth',block:'start'}));
}

function categoryFreshness(ts){
  const t=Number(ts||0);
  if(!t)return '<span class="freshness-chip red" title="Noch kein belastbarer Datenzeitpunkt vorhanden.">NICHT AKTUALISIERT</span>';
  const ageMs=Math.max(0,Date.now()-t), ageMin=ageMs/60000;
  const level=ageMin<3?'green':ageMin<5?'yellow':ageMin<10?'orange':'red';
  const ageTxt=ageMin<1?`${Math.max(0,Math.floor(ageMs/1000))} Sek.`:`${Math.floor(ageMin)} Min.`;
  const label=level==='green'?'AKTUALISIERT':level==='yellow'?'3+ MIN':level==='orange'?'5+ MIN':'10+ MIN · VERALTET';
  return `<span class="freshness-chip ${level}" title="Letzte tatsächlich empfangene Daten: ${clock(t)}. Grün <3 Min., Gelb 3–5 Min., Orange 5–10 Min., Rot ab 10 Min. Ein Klick/Request allein setzt diesen Status nicht zurück.">${label} · ${clock(t)} · vor ${ageTxt}</span>`;
}

function renderExtendedWatch(){
  const el=$('#extendedWatch');if(!el)return;const phase=String(openingMeta.phaseLabel||stockMeta.market?.label||'');
  const extended=/pre|after|overnight/i.test(phase);const cand=openingRows.slice(0,6);
  el.innerHTML=`<div class="ophead"><b>🌙 Nachbörse / Extended Hours</b><span>${esc(phase||'Sessionstatus wird geladen')}</span><small>Beobachtung · kein BUY allein</small>${categoryFreshness(openingMeta.ts)}</div>`+(cand.length?`<div class="opgrid">${cand.map(r=>{const sr=stockRows.find(x=>x.symbol===r.symbol);return `<button class="opcard ${Number(r.gapPct)>=0?'move-up':'move-down'}" data-openstock="${esc(r.symbol)}" title="${esc(r.symbol)} außerhalb/nahe der Hauptsession beobachten. Warum sinnvoll? Vor- und Nachbörse können frühe Aufmerksamkeit zeigen; breitere Spreads und weniger Volumen machen die Bewegung aber unsicherer."><b>${esc(r.symbol)}</b><span class="trend-pct ${Number(r.gapPct)>=0?'up':'down'}">${r.gapPct>=0?'+':''}${num(r.gapPct,1)}%</span>${spark((sr?.intraday||[]).slice(-12),120,28)}<em>${extended?'Extended Hours':'Opening/Session'}</em></button>`}).join('')}</div>`:'<span class="hint">Noch keine Extended-Hours-Kandidaten.</span>');
  el.querySelectorAll('[data-openstock]').forEach(b=>b.addEventListener('click',()=>openStockFromDiscovery(b.dataset.openstock)));
}
function renderOpeningPanel() {
  const el=$('#openingPanel'); if(!el) return;
  if(openingMeta.configured===false){el.innerHTML='<b>🚀 Premarket / Opening</b><span>Alpaca noch nicht verbunden. Benötigt zwei Cloudflare-Secrets: <code>ALPACA_API_KEY_ID</code> und <code>ALPACA_API_SECRET_KEY</code>.</span>';return;}
  const phase=openingMeta.phaseLabel||'Status wird geladen';
  const top=openingRows.slice(0,5);
  el.innerHTML=`<div class="ophead"><b>🚀 Premarket / Opening</b><span title="${esc(openingMeta.phaseHelp||'')} ">${esc(phase)}</span><small title="${esc((openingMeta.limitations||'Alpaca Marktdatenfeed')+' — Diese Kachel zeigt Gaps VOR der Eröffnung. Bewegungen im laufenden Handel stehen in der Kachel „Momentum-Mover“ darüber.')}">Alpaca · ${esc(openingMeta.feed||'IEX')} · vor der Eröffnung · 60 s</small>${categoryFreshness(openingMeta.ts)}</div>`+
    (top.length?`<div class="opgrid">${top.map(r=>`<button type="button" class="opcard ${r.light} ${Number(r.ret5)>=0?'move-up':'move-down'}" data-openstock="${esc(r.symbol)}" title="${esc(r.symbol)} im Aktienradar öffnen. Momentum-Score kombiniert Gap, Volumenbeschleunigung, kurzfristige Kursdynamik und Premarket-/Opening-Level. Kein BUY allein."><b>${esc(r.symbol)}${r.origin==='favorite'?' ★':''}</b><span class="trend-pct ${Number(r.gapPct)>=0?'up':'down'}">${r.gapPct>=0?'+':''}${num(r.gapPct,1)}% Gap</span><span>Mom ${num(r.momentumScore,1)}</span><span class="trend-pct ${Number(r.ret5)>=0?'up':'down'}" title="Speed = kurzfristige Kursänderung der letzten verfügbaren 5-Minuten-Periode gegenüber der vorherigen Periode. Positiv = Beschleunigung nach oben, negativ = Abschwächung/Rückgang, 0 % = kaum Veränderung. Kontextwert, kein eigenständiges BUY-Signal.">Speed ${Number(r.ret5)>=0?'+':''}${num(r.ret5,2)}%</span><span>RV ${r.relVol==null?'n.v.':num(r.relVol,1)+'×'}</span>${r.priceSource==='daily'?'<span class="warn" title="Alpaca liefert hier keinen aktuellen Minute-/Trade-Quote; verwendet wird nur der Tages-Bar als Discovery-Fallback. Kein Live-Kurs und kein BUY-Signal.">⚠ Tages-Bar/Fallback</span>':''}<span title="Elliott/Fibonacci-Strukturprojektion: grober möglicher Bewegungsraum aus aktuellem Impuls und 1,618-Projektion; kein garantiertes Kursziel.">Struktur ${num(r.structurePct,1)}%</span><em>${esc(r.phaseAction)}</em></button>`).join('')}</div>`:`<span class="hint">Noch keine verwertbaren Live-Daten im aktuellen ${esc(openingMeta.feed||'Alpaca')}-Zeitfenster.</span>`);
  el.querySelectorAll('[data-openstock]').forEach(btn=>btn.addEventListener('click',()=>openStockFromDiscovery(btn.dataset.openstock)));
}

function renderMarketGainers(){
  const el=$('#marketGainers'); if(!el)return;
  /* v3.8.1: Ohne diese Zeile laesst sich eine leere Kandidatenliste nicht von
     einer zu strengen Schwelle unterscheiden. Die Zaehler kommen direkt aus dem
     Einlassgitter im Worker und sind die Grundlage zum Nachkalibrieren. */
  const g=stockMeta.discovery?.radar?.gate;
  const gateLine=g&&g.seen?`<small class="gate-stats" title="${esc(`Von ${g.seen} bewerteten Titeln des Whole-Market-Radars kamen ${g.largeCap} über die kuratierte Large-Cap-Liste und ${g.momentum} über das messbare Momentum-Gitter durch.\n\nAbgelehnt wegen: Kurs unter 5 $ oder unbekannt ${g.failPrice} · zu dünner Umsatz ${g.failVolume} · zu breiter Spread ${g.failSpread} · Bewegung unter 3 % ${g.failMove}.\n\nStehen hier über längere Zeit 0 Momentum-Kandidaten und scheitert fast alles am Umsatz, ist die Schwelle zu streng — das ist bewusst sichtbar gemacht, statt es zu verstecken. Außerhalb der US-Handelszeiten ist eine leere Liste normal, weil der Tagesumsatz dann noch klein ist.`)}">Einlassgitter: ${g.seen} geprüft → ${g.largeCap} Large Cap + ${g.momentum} Momentum · abgelehnt: Umsatz ${g.failVolume}, Bewegung ${g.failMove}, Spread ${g.failSpread}, Kurs ${g.failPrice}</small>`:'';
  const radar=(stockMeta.discovery?.radar?.candidates||[]).slice(0,8);
  const gainers=(stockMeta.discovery?.radar?.gainers||[]);
  if(!radar.length){
    const openingRadar=openingRows.filter(r=>r.origin==='radar').slice(0,12).map(r=>({symbol:r.symbol,movePct:r.gapPct,speedPct:r.ret5,score:r.momentumScore,spreadPct:null}));
    if(openingRadar.length){
      el.innerHTML=`<div class="ophead"><b>📡 Momentum-Mover · Situation Radar</b><span>${openingRadar.length} verifizierte Opening-Radar-Kandidaten · Rückfallquelle</span><small title="Ersatzanzeige: der Tiingo-Radar hat gerade keine Kandidaten, deshalb werden hier Opening-Radar-Titel gezeigt.">Rückfall auf Opening-Radar · 0 % BUY-Gewicht</small>${categoryFreshness(openingMeta.ts)}</div><div class="opgrid">${openingRadar.map(r=>`<button type="button" class="opcard ${Number(r.movePct)>=0?'move-up':'move-down'}" data-openstock="${esc(r.symbol)}" title="Vom verifizierten Opening-Radar erkannt. Der serverseitige Deep Scan übernimmt geeignete Kandidaten automatisch; BUY erst nach Elliott/Qualität/CRV."><b>${esc(r.symbol)}${isFavStock(r.symbol)?' ★':''}</b><span class="trend-pct ${Number(r.movePct)>=0?'up':'down'}">${Number(r.movePct)>=0?'+':''}${num(r.movePct,1)}% Gap</span><span>Mom ${num(r.score,1)}</span><span>Opening verified</span><em>Radar · Elliott prüfen</em></button>`).join('')}</div>`;
      el.querySelectorAll('[data-openstock]').forEach(b=>b.addEventListener('click',()=>openStockFromDiscovery(b.dataset.openstock)));
      return;
    }
    el.innerHTML=`<div class="ophead"><b>📡 Momentum-Mover · Situation Radar</b><small title="Bewegung während der laufenden US-Handelszeit (Tiingo). Die Premarket-Kachel ist eine andere.">Tiingo · laufender Handel · 0 % BUY-Gewicht</small>${categoryFreshness(stockMeta.discovery?.radar?.ts||stockMeta.ts)}</div>${gateLine}<span class="hint">Noch keine verifizierten marktweiten Radar-Kandidaten. Favoriten sind davon getrennt.</span>`;return;
  }
  el.innerHTML=`<div class="ophead"><b>📡 Momentum-Mover · Situation Radar</b><span>${radar.length} verifizierte Kandidaten · Bewegung WÄHREND der Handelszeit</span><small title="Nicht mit „Premarket/Opening Momentum“ verwechseln: diese Kachel zeigt Titel, die sich JETZT im laufenden Handel bewegen (Tiingo). Die Premarket-Kachel darunter zeigt Gaps VOR der Eröffnung (Alpaca).">Tiingo · laufender Handel</small>${categoryFreshness(stockMeta.discovery?.radar?.ts||stockMeta.ts)}</div>${gateLine}<small class="stage-note" title="Diese Liste ist bewusst KEINE Kaufempfehlung und will auch keine sein. Sie beantwortet die Frage „wo lohnt der Blick jetzt“ — die Einordnung, ob eine Nachricht den Titel wirklich trägt, kann nur ein Mensch mit Kontext leisten. Eine fehlende BUY-Ampel bedeutet daher NICHT, dass hier nichts ist.">Kandidatenliste, keine Kaufempfehlung — die Einordnung der Nachrichtenlage bleibt bei dir</small><div class="opgrid">${radar.map(r=>`<button type="button" class="opcard ${Number(r.movePct)>=0?'move-up':'move-down'}" data-openstock="${esc(r.symbol)}" title="Situation-Radar: priorisiert frische Beschleunigung, Breakout-Druck, Opening-Drive, Reclaim, Volumenpuls und Spread-Qualität. Erst Deep-Analyse/Elliott/CRV kann BUY freigeben."><b>${esc(r.symbol)}${isFavStock(r.symbol)?' ★':''}</b><span class="situation-tag">${esc(r.lifecycle&&r.lifecycle!=='WATCH'?r.lifecycle+' · ':'')}${esc(r.situation||'WATCH')}</span><span class="trend-pct ${Number(r.movePct)>=0?'up':'down'}">${Number(r.movePct)>=0?'+':''}${num(r.movePct,1)}% Tag</span><span class="${r.speedPct!=null?'trend-pct '+(Number(r.speedPct)>=0?'up':'down'):''}">${r.speedPct!=null?'Speed '+(Number(r.speedPct)>=0?'+':'')+num(r.speedPct,2)+'%':'Situation '+num(r.situationScore??r.score,0)}</span><span>${r.spreadPct!=null?'Spread '+num(r.spreadPct,2)+'%':'Spread n.v.'}</span><em>${gainers.some(x=>x.symbol===r.symbol)?'Gainer · Deep Check':'Situation · Deep Check'}</em>${momentumContext(r.symbol)}</button>`).join('')}</div>`;
  el.querySelectorAll('[data-openstock]').forEach(b=>b.addEventListener('click',()=>openStockFromDiscovery(b.dataset.openstock)));
}

/* ==== v3.6.4 · US-Handelszeiten in unserer Zeit + ehrlicher Datenstand ======
   Zwei Rueckmeldungen aus dem Betrieb:
   (a) "ET" ist fuer uns hier nicht direkt nutzbar — ueberall die lokale Zeit
       dazuschreiben, statt vom Nutzer Kopfrechnen zu verlangen.
   (b) Aktien werden angezeigt, obwohl der Premarket noch nicht laeuft. Der
       Zeitstempel "Abfrage 12:28" liest sich dann wie ein tagesaktueller Kurs,
       obwohl die Daten vom Schluss des Vortages stammen. Der Scan IST aktuell —
       die Daten sind es nicht. Genau das muss dastehen.                      */
const NY_TZ='America/New_York';
function tzWallMinutes(tz,d){
  const f=new Intl.DateTimeFormat('en-US',{timeZone:tz,hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  const p=Object.fromEntries(f.formatToParts(d).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  return Date.UTC(+p.year,+p.month-1,+p.day,+(p.hour==='24'?'0':p.hour),+p.minute);
}
/** Differenz lokale Zeit minus New Yorker Zeit, in Minuten (DST-sicher). */
function nyDeltaMinutes(d=new Date()){
  const local=tzWallMinutes(Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC',d);
  return Math.round((local-tzWallMinutes(NY_TZ,d))/60_000);
}
const localTzLabel=()=>{
  try{ return new Intl.DateTimeFormat('de-DE',{timeZoneName:'short'}).formatToParts(new Date()).find(x=>x.type==='timeZoneName')?.value||'lokal'; }
  catch{ return 'lokal'; }
};
/** "09:30" (ET) -> "15:30" in unserer Zeit. */
function etClockToLocal(hhmm,d=new Date()){
  const m=/^(\d{1,2}):(\d{2})$/.exec(String(hhmm||'').trim()); if(!m) return null;
  const total=(+m[1]*60+ +m[2]+nyDeltaMinutes(d)+1440*2)%1440;
  return `${String(Math.floor(total/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`;
}
/** Ergaenzt jede "hh:mm ET"-Angabe in einem Text um unsere Ortszeit. */
function withLocalTime(text){
  const t=String(text||''); if(!/\bET\b/.test(t)) return t;
  const tz=localTzLabel();
  return t.replace(/(\d{1,2}:\d{2})(?:\s*[–-]\s*(\d{1,2}:\d{2}))?\s*ET/g,(all,a,b)=>{
    const la=etClockToLocal(a), lb=b?etClockToLocal(b):null;
    if(!la) return all;
    return `${all} (${la}${lb?'–'+lb:''} ${tz})`;
  });
}

/** Zu welcher US-Handelssitzung gehoert ein Datenzeitstempel? Klartext statt ET-Rätsel. */
const ET_SESSIONS=[
  {from:240, to:480, key:'premarket-early', name:'früher Premarket'},
  {from:480, to:570, key:'premarket',       name:'Premarket'},
  {from:570, to:660, key:'opening',         name:'Eröffnung (erste 90 Minuten)'},
  {from:660, to:960, key:'regular',         name:'reguläre US-Sitzung'},
  {from:960, to:1200,key:'after',           name:'After Hours'},
];
function dataSession(r){
  const raw=String(r?.updated||'').trim();
  if(!raw) return {known:false,label:'Datenstand unbekannt',tone:'warn',
    detail:'Zu diesem Titel liegt kein Zeitstempel der Kursdaten vor. Ohne Datenstand gibt es bewusst keine Kauf-Freigabe.'};
  const t=Date.parse(/[Zz]|[+-]\d{2}:?\d{2}$/.test(raw)?raw:raw.replace(' ','T')+'Z');
  if(!Number.isFinite(t)) return {known:false,label:'Datenstand nicht lesbar',tone:'warn',
    detail:`Der Zeitstempel „${raw}" konnte nicht interpretiert werden.`};
  const d=new Date(t);
  const f=new Intl.DateTimeFormat('en-US',{timeZone:NY_TZ,hour12:false,weekday:'short',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  const p=Object.fromEntries(f.formatToParts(d).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  const etMin=(+p.hour===24?0:+p.hour)*60+ +p.minute;
  const sess=ET_SESSIONS.find(x=>etMin>=x.from&&etMin<x.to);
  const etClock=`${String(p.hour).padStart(2,'0')}:${p.minute}`;
  const localClock=new Intl.DateTimeFormat('de-DE',{hour:'2-digit',minute:'2-digit',hour12:false}).format(d);
  const localDate=new Intl.DateTimeFormat('de-DE',{day:'2-digit',month:'2-digit'}).format(d);
  const ageMin=Math.max(0,Math.round((Date.now()-t)/60_000));
  const sameDay=new Intl.DateTimeFormat('de-DE',{day:'2-digit',month:'2-digit'}).format(new Date())===localDate;
  const ageTxt = ageMin<90 ? `${ageMin} Min. alt`
    : ageMin<48*60 ? `${(ageMin/60).toFixed(1).replace('.',',')} Std. alt`
    : `${Math.round(ageMin/1440)} Tage alt`;
  const name=sess?sess.name:'außerhalb der Handelszeiten';
  const tone = !sess ? 'warn' : (sameDay && ageMin<=30) ? 'ok' : (sameDay ? 'aged' : 'old');
  const label = sameDay
    ? `Kurs aus: ${name} · ${etClock} ET (${localClock}) · ${ageTxt}`
    : `Kurs vom ${localDate}: ${name} · ${etClock} ET (${localClock}) · ${ageTxt}`;
  const detail = [
    `Diese Kursdaten stammen aus der Sitzung „${name}" am ${localDate} um ${etClock} ET — bei uns ${localClock} Uhr (${localTzLabel()}). Sie sind ${ageTxt}.`,
    sameDay ? '' : 'ACHTUNG: Das ist NICHT von heute. Seitdem wurde an der US-Börse nicht mehr gehandelt (oder die Sitzung hat noch nicht begonnen). Der Zeitstempel der Abfrage sagt nur, wann FusionPulse zuletzt nachgesehen hat — nicht, dass sich der Kurs seither bewegt hätte.',
    !sess ? 'Der Zeitpunkt liegt außerhalb regulärer Handelszeiten; solche Kurse entstehen bei sehr dünnem Handel und sind entsprechend unzuverlässig.' : '',
    'Vor einer Order immer den tatsächlichen Kurs an deiner Handelsbörse prüfen.'
  ].filter(Boolean).join(' ');
  return {known:true,label,tone,detail,sameDay,ageMin,session:sess?.key||null,sessionName:name};
}

function focusQuoteMeta(r){
  /* v3.13.0: Seit der Deep-Scan Live-Quotes mitliefert, koennen Zeilen aus dem
     Server-Zwischenspeicher kommen. `liveQuoteAgeSec` wurde dann zum ZEITPUNKT
     DES SCANS berechnet und waere hier eine Luege — ein drei Minuten alter Kurs
     stuende weiterhin mit „8s alt" da. Deshalb wird das Alter aus dem
     Zeitstempel neu gerechnet, wann immer einer vorliegt, und die
     Frische-Entscheidung gleich mit. Fail-closed: ohne Zeitstempel bleibt es
     beim Serverwert, und ohne beides gilt der Kurs als nicht frisch. */
  const p=Number(r?.livePriceUsd);
  const ts=Number(r?.liveQuoteTs);
  const liveAge=Number.isFinite(ts)&&ts>0 ? Math.max(0,Math.round((Date.now()-ts)/1000)) : null;
  const age=liveAge!=null?liveAge:(Number.isFinite(Number(r?.liveQuoteAgeSec))?Number(r.liveQuoteAgeSec):null);
  const has=Number.isFinite(p)&&p>0;
  // Serverurteil gilt weiter, aber ein inzwischen abgelaufener Kurs verliert es.
  const phaseActive=/premarket|opening|regular|after/.test(String(stockMeta?.market?.key||''));
  const maxAge=phaseActive?120:900;
  const ok=has && r?.liveQuoteOk===true && (age==null || age<=maxAge);
  const label=ok?'LIVE / FRISCH':has?'NICHT LIVE / VERALTET':'KEIN LIVE-QUOTE';
  const cls=ok?'live':'stale';
  const when=r?.liveUpdated?clock(r.liveUpdated):'–';
  const src=r?.liveQuoteSource||r?.feed||'n.v.';
  const scope=r?.liveQuoteScope?` · ${r.liveQuoteScope}`:'';
  return {has,ok,label,cls,when,src,scope,age};
}
function focusDisplayPrice(r){
  return Number(r?.livePriceUsd)>0 ? stockPx(r.livePriceUsd,r.livePriceEur) : stockPx(r.priceUsd,r.priceEur);
}

/* ==== v3.9.1 · Handelbarkeit bei flatex (NUR ANZEIGE) =======================
   Anlass: Ein Kandidat, den der Nutzer bei seinem Broker gar nicht kaufen kann,
   ist fuer ihn wertlos — egal wie gut das Setup aussieht. Das Momentum-Gitter
   aus v3.8.0 prueft Liquiditaet, aber nicht, ob der Titel ueberhaupt im
   Handelsangebot steht.

   BEWUSSTE BESCHRAENKUNG: Es gibt keine abfragbare flatex-Instrumentenliste.
   Die Aussage stuetzt sich deshalb ausschliesslich auf das Primaerlisting aus
   den Tiingo-Metadaten (`exchangeCode`), das ohnehin schon mitgeliefert wird.
   Das ist eine Wahrscheinlichkeitsaussage, keine Bestaetigung — und sie wird
   auch so beschriftet.

   NULL EINFLUSS auf Score, BUY-Freigabe, Ampel oder Signalton. Reine Anzeige,
   nach Invariante 3 der Uebergabe. Fail-closed in der Formulierung: ein
   unbekannter Handelsplatz erzeugt NIE die positive Aussage, sondern die
   Aufforderung, vor der Order nachzusehen.                                  */
const FLATEX_LIKELY_EXCHANGE = /NASDAQ|NMS|NGS|NCM|NYSE|ARCA|AMEX|NYSEMKT|BATS|CBOE|IEX/;
const FLATEX_UNLIKELY_EXCHANGE = /OTC|PINK|GREY|EXPERT|NMFQS|CVEM|TSXV/;
function flatexTradability(row){
  const ex=String(row?.exchange||'').toUpperCase().trim();
  if(!ex) return {tone:'unknown',label:'Handelsplatz n.v.',
    detail:'Das Primaerlisting ist in den Metadaten nicht hinterlegt. Ob der Titel bei flatex handelbar ist, laesst sich daraus nicht ableiten — vor einer Order in der Ordermaske pruefen. Diese Anzeige veraendert weder Score noch Kauf-Freigabe.'};
  if(FLATEX_UNLIKELY_EXCHANGE.test(ex)) return {tone:'no',label:'flatex: eher nicht handelbar',
    detail:`Primaerlisting ${ex}. OTC-/Pink-Sheet-Titel sind bei flatex ueberwiegend nicht oder nur mit sehr schlechten Spreads verfuegbar. Behandle diesen Kandidaten als Information, nicht als Trade. Diese Anzeige veraendert weder Score noch Kauf-Freigabe.`};
  if(FLATEX_LIKELY_EXCHANGE.test(ex)) return {tone:'ok',label:'flatex: US-Direkthandel wahrscheinlich',
    detail:`Primaerlisting ${ex}. Regulaer gelistete US-Titel sind ueber den flatex-US-Direkthandel in aller Regel verfuegbar — rund 11–12 Euro je Order, dafuer deutlich engere Spreads als ueber Tradegate. Bestaetigt ist das erst in der Ordermaske. Diese Anzeige veraendert weder Score noch Kauf-Freigabe.`};
  return {tone:'unknown',label:'flatex: Verfuegbarkeit unklar',
    detail:`Primaerlisting ${ex} laesst sich keiner der bekannten Gruppen zuordnen. Vor einer Order in der Ordermaske pruefen. Diese Anzeige veraendert weder Score noch Kauf-Freigabe.`};
}

function googleFinanceUrl(row){
  const ticker=String(row?.symbol||'').toUpperCase();
  const ex=String(row?.exchange||'').toUpperCase();
  let gex='';
  if(/NASDAQ|NMS|NGS|NCM/.test(ex)) gex='NASDAQ';
  else if(/NYSE ARCA|ARCA/.test(ex)) gex='NYSEARCA';
  else if(/NYSE AMERICAN|AMEX|NYSEMKT/.test(ex)) gex='NYSEAMERICAN';
  else if(/NYSE/.test(ex)) gex='NYSE';
  return gex
    ? `https://www.google.com/finance/quote/${encodeURIComponent(ticker)}:${gex}?hl=de`
    : `https://www.google.com/finance/?q=${encodeURIComponent(ticker)}&hl=de`;
}

function renderStocks() {
  (stockRows||[]).forEach(claudeOverlayRow); // Claude-Modus-Ansicht idempotent anwenden
  (stockRows||[]).forEach(momentumOverlayRow); // v3.9.0: Modus A danach, ebenfalls idempotent
  const box=$('#stockGroups'),st=$('#stockState'),counts=$('#stockCounts'); if(!box||!st)return;
  renderDepotStrip(); renderPortfolioRisk(); renderCrowdStatus(); renderMarketGainers(); renderExtendedWatch(); renderOpeningPanel(); renderSectorLaggards(); renderEarningsBoard();
  if(stockMeta.configured===false){box.innerHTML='';st.textContent='Aktien-Datenquelle fehlt';st.className='badge err';if(counts)counts.textContent='Aktienradar nicht konfiguriert';stockHeatmap([]);return;}
  const search=($('#stockQ')?.value||'').trim().toUpperCase(); const filter=$('#stockF')?.value||'';
  let stockFiltered=stockRows.filter(r=>(!search||r.symbol.toUpperCase().includes(search)||String(r.name||'').toUpperCase().includes(search)));
  if(filter==='favorites') stockFiltered=stockFiltered.filter(r=>isFavStock(r.symbol));
  if(filter==='green'||filter==='yellow') stockFiltered=stockFiltered.filter(r=>r.light===filter);
  if(filter==='momentum') { const hot=new Set(openingRows.slice(0,20).map(r=>r.symbol)); stockFiltered=stockFiltered.filter(r=>hot.has(r.symbol)); }
  const shown=[...stockFiltered].sort((a,b)=>filter==='favorites'?((stockOrderIndex(a.symbol)-stockOrderIndex(b.symbol))||(Number(b.score)||0)-(Number(a.score)||0)):((Number(stockFreshness(b).key==='live')-Number(stockFreshness(a).key==='live'))||(Number(b.preSignalMaturity)||0)-(Number(a.preSignalMaturity)||0)||(Number(b.radarRank)||0)-(Number(a.radarRank)||0)||(Number(b.score)||0)-(Number(a.score)||0))).slice(0,S.stockCount);
  const scanned=stockMeta.scanned??stockRows.length, universeLabel=stockMeta.universeLabel||stockMeta.universe||21, stateKey=stockMeta.state||(stockRows.length?'ok':'unknown');
  const phase=stockMeta.market?.label||'';
  const phaseLocal=withLocalTime(phase); // v3.6.4: ET-Angaben um unsere Ortszeit ergaenzen
  st.textContent=(stateKey==='ok'?'Aktienfeed':STATE_TEXT[stateKey]||'Status unbekannt')+(phaseLocal?` · ${phaseLocal}`:'');
  st.className='badge '+(STATE_TONE[stateKey]==='ok'?'ok':STATE_TONE[stateKey]==='warn'?'warn':'err');
  st.title=withLocalTime(`${stockMeta.source||stockMeta.provider||'US-Aktienfeed'}. ${stockMeta.market?.help||''} ${phase||''}`)
    +`\n\nUS-Handelszeiten in unserer Zeit (${localTzLabel()}): Premarket ab ${etClockToLocal('04:00')}, Eröffnung ${etClockToLocal('09:30')}, regulärer Handel bis ${etClockToLocal('16:00')}, After Hours bis ${etClockToLocal('20:00')}.`
    +`\n\nAußerhalb der regulären US-Börsenzeit sind Analysen Vorbereitung und keine Live-BUY-Freigabe. Angezeigte Kurse stammen dann aus der letzten Sitzung — der Zeitstempel der Abfrage sagt nur, wann zuletzt nachgesehen wurde.`;
  trackRefresh(stockMeta?.refreshedSymbols||[]); // v3.6.1: Frequenz je Titel mitzaehlen
  if(counts){const rc=stockMeta.discovery?.radar?.candidates?.length||0,bc=stockMeta.discovery?.boats?.candidates?.length||0;counts.textContent=`${stockMeta.updatedThisCycle!=null?stockMeta.updatedThisCycle+' aktualisiert · ':''}${scanned} geladen / ${universeLabel} Universum · ${shown.length} angezeigt · ${rc?'RADAR '+rc+' · ':''}${bc?'BOATS '+bc+' · ':''}★ ${(S.favoriteStocks||[]).length} · Abfrage ${clock(stockMeta.ts)}`;}
  const srcLabel=$('#stockSourceLabel'); if(srcLabel)srcLabel.textContent=String(stockMeta.source||stockMeta.provider||'US-Aktienfeed').includes('Tiingo')?'Tiingo IEX, US-Markt (Primary)':'Twelve Data, US-Markt (Fallback)';
  stockHeatmap(shown);
  // v3.3.9 P0: Das Fokusfenster ist unabhängig vom aktuell sichtbaren/
  // gefilterten Listen-Slice. Ein aus Radar/Momentum angeklickter Titel darf
  // niemals auf shown[0] (z. B. PMI) zurückfallen, nur weil er außerhalb
  // der gerade angezeigten Top-N liegt.
  const topBox=$('#stockFocus');
  const focusedRow=focusStock?stockRows.find(r=>String(r?.symbol||'').toUpperCase()===String(focusStock).toUpperCase()):null;
  const top=focusedRow||(!focusStock?shown[0]:null);
  if(topBox){if(!top)topBox.innerHTML=search?`<div class="stockfocus-empty">Keine geladene Aktie passend zu „${esc(search)}“. Enter oder 🔎 lädt den Titel direkt.</div>`:(filter==='favorites'?'<div class="stockfocus-empty">Noch keine Aktien-Favoriten. Mit ☆ neben einem Titel hinzufügen.</div>':'');else{
    const sz=stockSizing(top), buy=stockLevel(top)===3, tr=stockTradeability(top), opp=stockOpportunity(top), qm=focusQuoteMeta(top); const struct=Number(top.structurePct||0);
    const hl=stockHeadline(top); // v3.5.8 P0: Kopfzeile darf der Opportunity-Zeile nicht widersprechen
    const ew=earningsWarning(top.symbol); // v3.8.2: Ereigniskontext, reine Warnung
    topBox.innerHTML=`<div class="stockfocus-card ${hl.light}${buy?' buy':''}"><div class="sf-focus-main"><div class="sf-title"><div><small title="Das große Fenster zeigt immer genau einen Titel im Detail — den zuletzt angeklickten oder, wenn du nichts ausgewählt hast, den aktuell aussichtsreichsten. Es wird bevorzugt nachgeladen, siehe Frequenzanzeige in der Zeile darunter.">AUSGEWÄHLTE AKTIE · ${esc(top.symbol)}</small><h3><button class="favbtn ${isFavStock(top.symbol)?'on':''}" data-favstock="${esc(top.symbol)}" title="Favorit / Depot">${isFavStock(top.symbol)?'★':'☆'}</button><b title="${esc(gloss('tickerSym'))}">${esc(top.symbol)}</b><a class="gfinance focus-link" href="${googleFinanceUrl(top)}" target="_blank" rel="noopener" title="${esc(top.symbol)} in Google Finance in einem neuen Tab öffnen">Google Finance ↗</a></h3><div class="focus-livebar ${qm.cls}"><b>${qm.label}</b><span>Kurs ${focusDisplayPrice(top)}</span><span>Quote ${qm.when}</span><span>${esc(qm.src+qm.scope)}</span>${qm.age!=null?`<span>${qm.age}s alt</span>`:''}${ew?`<span class="earn-warn${ew.critical?' critical':''}" title="${esc(ew.detail)}">${esc(ew.label)}</span>`:''}${(()=>{const ds=dataSession(top);return `<span class="data-session ${ds.tone}" title="${esc(ds.detail)}">🕒 ${esc(ds.label)}</span>`;})()}<span title="${esc('Wann FusionPulse zuletzt nachgesehen hat, und wie frisch die gelieferten Daten dabei waren. ACHTUNG: eine frische Abfrage bedeutet NICHT automatisch einen frischen Kurs — wenn die Börse zu ist, liefert auch die neueste Abfrage den letzten Schlusskurs.')}">${esc(stockUpdateLabel(top))}</span>${(()=>{const rr=refreshRate(top.symbol);return `<span class="focus-freq${rr.rel!=null&&rr.rel>=1.6?' hot':rr.rel!=null&&rr.rel<=0.6?' cold':''}" title="${esc(rr.detail)}">↻ ${esc(rr.label)}</span>`;})()}<button type="button" id="stockFocusPlan" title="${esc('Kompletten Tradeplan in die Zwischenablage kopieren: Entry, Stop, beide Ziele, Stückzahl, CRV und Datenstand. Zum Übertragen in die Ordermaske deines Brokers — spart das fehleranfällige Abtippen. Der Text sagt ausdrücklich dazu, wenn FusionPulse den Trade NICHT freigibt.')}">⧉ Plan</button><button type="button" id="stockFocusRefresh" title="Diese Aktie neu abfragen; der autonome Whole-Market-Scan bleibt serverseitig.">↻ Aktie</button></div><span class="company-name" title="Vollständiger Firmenname. Warum sinnvoll? Der Ticker allein kann leicht mit ähnlich benannten Wertpapieren verwechselt werden.">${esc((top.securityName&&top.securityName!==top.symbol)?top.securityName:(top.name&&top.name!==top.symbol?top.name:'Firmenname wird noch geladen'))}</span><small class="company-focus" title="Kurzbeschreibung des operativen Fokus aus den verfügbaren Unternehmens-Metadaten. Warum sinnvoll? Sie hilft einzuordnen, wodurch die Aktie wirtschaftlich bewegt werden kann.">${esc((top.companyDescription||'').slice(0,220)||((top.sector&&top.sector!=='Discovery')?top.sector:'Unternehmensfokus noch nicht verifiziert'))}${(!top.companyDescription||!/candidate|program|pipeline|therapy|therapeutic|device|platform|drug/i.test(top.companyDescription))?' · Lead Program/Candidate nicht verifiziert':''}</small><small class="company-exchange" title="Primäres Listing laut verfügbaren Metadaten. Warum sinnvoll? Die Hauptbörse hilft bei Handelszeiten, Liquidität und Dateninterpretation. Höchstes aktuelles Volumen wird nur behauptet, wenn es tatsächlich gemessen werden kann.">Börse: ${esc(top.exchange||'n.v.')}</small>${(()=>{const ft=flatexTradability(top);return `<small class="flatex-hint ft-${ft.tone}" title="${esc(ft.detail)}">🏦 ${esc(ft.label)}</small>`;})()}<small class="analysis-inline" title="Tatsächlich aktive Analyse-/Sicherheitsmethoden. Situation Engine priorisiert nur Kandidaten und verändert BUY nicht."><b>Analyse:</b> ${esc(analysisMethodsText())}</small><span class="sf-tags">${gl(top.sector,'sectorTag')}<i> · </i>${gl('Score '+num(top.score,1),'score')}${top.preSignalMaturity!=null?`<i> · </i>${gl('Reife '+Math.round(top.preSignalMaturity)+'%','maturity')}`:''}${top.situationType?`<i> · </i>${gl('Situation '+top.situationType,null,glossForSituation(top.situationType))}<i> </i>${gl(Math.round(Number(top.situationScore)||0)+'/100','situationScore')}`:''}${top.radarLifecycle&&top.radarLifecycle!=='WATCH'?`<i> · </i>${gl('Phase '+top.radarLifecycle,'lifecyclePhase')}`:''}</span></div><strong class="sf-verdict hl-${hl.light}" title="${esc(hl.title)}">${hl.icon} ${esc(hl.text)}</strong></div><div class="sf-grid"><span title="Aktueller Kurs. „Live-Quote" heißt: gerade frisch abgefragt. „Analyse-/Fallbackpreis" heißt: der letzte Kurs aus dem Analysedatensatz, möglicherweise einige Minuten alt — vor einer Order immer den echten Kurs bei deinem Broker prüfen.">Kurs <b>${focusDisplayPrice(top)}</b><small>${qm.ok?' Live-Quote':' Analyse-/Fallbackpreis'}</small></span><span title="Bei BUY empfohlene Kaufsumme; sonst nur theoretische Größe bzw. kein Trade.">${buy?'Kaufsumme':'Pot. Größe'} <b>${stockSizeDisplay(top,sz)}</b></span><span title="Der geplante Kaufkurs. Darüber zu kaufen verschlechtert das Chance-Risiko-Verhältnis, weil der Stop dann weiter entfernt liegt.">Entry <b>${stockPx(top.entryUsd,top.entryEur)}</b></span><span title="${esc('Stop-Loss: der Kurs, bei dem der Trade beendet wird, um den Verlust zu begrenzen. Er sitzt bewusst außerhalb der normalen Tagesschwankung. '+gloss('atr'))}">Stop <b>${stockPx(top.stopUsd,top.stopEur)}</b></span><span title="Take Profit 1: hier wird planmäßig die halbe Position verkauft. Das sichert einen Teil des Gewinns, bevor der Kurs drehen kann.">TP1 <b>${stockPx(top.tp1Usd,top.tp1Eur)}</b></span><span title="Take Profit 2: hier wird die verbleibende halbe Position verkauft. Das eigentliche Ziel des Trades.">TP2 <b>${stockPx(top.tp2Usd,top.tp2Eur)}</b></span><span title="Nettogewinn des ersten 50-%-Teilverkaufs bei TP1.">TP1 netto <b>${sz?eur(sz.tp1Net,0):'–'}</b></span><span title="Nettogewinn der verbleibenden 50 % bei TP2.">TP2 Rest netto <b>${sz?eur(sz.tp2Net,0):'–'}</b></span><span title="Gesamter Nettogewinn des Standardplans: 50 % bei TP1 + 50 % bei TP2.">Gesamtplan netto <b>${sz?eur(sz.planNet,0):'–'}</b></span><span title="Im FusionPulse-Modus ist dies das Netto-CRV bis zum gemessenen Strukturziel. Im Claude-Modus bleibt die dort definierte Plan-CRV-Logik unverändert.">${S.claudeMode?'Plan-CRV':'Struktur-CRV'} <b>${num(tr.netCrv,1)} : 1${Number(tr.netCrv)<Number(tr.minCrv||0)?' · zu niedrig':''}</b></span><span title="50/50-Plan nach geschätzten Fixkosten und Ausführungsreserve. Eigene Effizienzkennzahl; nicht mit dem Struktur-CRV verwechseln.">Plan-Effizienz <b>${sz?num(sz.planCrvAfterCosts,2)+' : 1':'–'}${!S.claudeMode&&sz&&sz.planCrvAfterCosts<FUSION_MIN_PLAN_EFFICIENCY?' · zu niedrig':''}</b></span><span title="Kursweg vom Einstieg bis TP2. Zu kleine Wege sind bei manueller Flatex-Ausführung praktisch schwer handelbar.">Weg TP2 <b>${num(tr.tp2Pct,1)}%</b></span><span title="Strukturpotenzial = geschätzter technisch plausibler Kursweg bis zum nächsten relevanten Widerstand/Ziel aus Chart-, Elliott-/Fibonacci- und Marktstruktur. Das ist kein erwarteter Gewinn und allein kein Kaufsignal.">Strukturpotenzial <b>${struct?num(struct,1)+'%':'–'}</b></span><span class="sf-crowd" title="Such-/Crowd-Aufmerksamkeit separat je Aktie. Dieser Wert verändert den BUY-Score derzeit nicht.">${crowdGauge(top.symbol)}${crowdConfirmGauge(top)}</span></div><div class="opportunity-watch ${opp.ready?'ready':'waiting'}"><b>${buy?'BUY FREIGEGEBEN':opp.label}</b><span>${opp.why?esc(opp.why):(opp.reasons.length?esc(opp.reasons.join(' · ')):'Wartet auf Qualität, CRV, Kursweg und wirtschaftlich relevantes Gewinnpotenzial.')}</span></div>${positionPanel(top)}<div class="intraday-chart" title="Kursverlauf. Intraday nutzt 5-Minuten-/IEX-Daten; längere Zeiträume werden passend aggregiert nachgeladen. Warum sinnvoll? Elliott-Strukturen sehen auf verschiedenen Zeitebenen unterschiedlich aus; der längere Chart liefert Kontext, aber kein BUY allein."><span>Chart · <select id="stockChartRange" title="Zeitraum wählen. Warum sinnvoll? Kurz zeigt Entry-Struktur, lang zeigt den übergeordneten Elliott-/Trend-Kontext.">${['5','10','30','60','120','180','240','300','1T','5T','1Wo','3Mo','6Mo','12Mo'].map(m=>`<option value="${m}"${String(m)===String(stockChartMinutes)?' selected':''}>${/^\d+$/.test(m)?m+' min':m}</option>`).join('')}</select></span>${spark((stockChartCache.get(top.symbol+'|'+stockChartMinutes)?.rows?.map(x=>x.c)||(top.intraday||[]).slice(-Math.max(1,Math.ceil((Number(stockChartMinutes)||120)/5)))),420,76)}</div><div class="sf-history" title="Verlauf der Setup-Ampel über die letzten 120 Minuten; 8 Segmente à 15 Minuten."><span>120-Min-Verlauf</span>${stockStatusBand(top)}</div>${edgeStrip(top)}<div class="stock-interpret"><b>Was hat sich geändert? · Interpretation</b><span>${top.whyNow?.length?`Warum jetzt? ${esc(top.whyNow.join(' · '))} · `:''}${esc(stockInterpretation(top))}</span><small>Radar/Crowd/Search dienen nur der Discovery · 0 % BUY-Gewicht</small></div><small>${tr.ok?'Ausführbarkeit erfüllt.':'⚠ Rechnerisches Setup, aber Ausführbarkeit/Marktphase erfüllt deine Grenzen noch nicht.'} ${buyGateHint(top)}</small></div>${stockLadder(top)}</div>`;
    topBox.querySelector('[data-favstock]')?.addEventListener('click',e=>toggleStockFavorite(top.symbol,e));
    topBox.querySelector('#stockChartRange')?.addEventListener('change',async e=>{stockChartMinutes=String(e.target.value||'120');const k=top.symbol+'|'+stockChartMinutes,hit=stockChartCache.get(k);if(!hit||Date.now()-Number(hit.ts||0)>120_000){try{const q=new URLSearchParams({symbol:top.symbol,range:stockChartMinutes});if(S.token)q.set('t',S.token);const rr=await fetchWithTimeout('/api/stock-chart?'+q,{cache:'no-store'},10_000);const dd=await rr.json();if(dd?.rows?.length)stockChartCache.set(k,{...dd,ts:Date.now()});}catch{}}renderStocks();});
    topBox.querySelector('#stockFocusRefresh')?.addEventListener('click',async()=>{await searchStockNow(top.symbol,true);renderStocks();});
    topBox.querySelector('#stockFocusPlan')?.addEventListener('click',e=>copy(stockOrderPlan(top),e.target));
    bindPositionControls(top); monitorPosition(top);
  }}
  const groups=new Map();
  if(filter==='favorites') groups.set('★ Favoritendepot',shown);
  else for(const r of shown){if(!groups.has(r.sector))groups.set(r.sector,[]);groups.get(r.sector).push(r);}
  box.innerHTML=[...groups.entries()].map(([sector,arr])=>`<section class="stock-sector${filter==='favorites'?' flat-favorites':''}">${filter==='favorites'?'':`<h3>${esc(sector)}</h3>`}${arr.map(r=>{const buy=stockLevel(r)===3,tone=stockStrength(r),tr=stockTradeability(r),sz=stockSizing(r),dm=stockDisplayMeta(r);const hl=stockHeadline(r);return `<div class="stockrow ${r.light} tone-${tone}${buy?' buy':''}${signalIsHot('stock',r.symbol)?' signal-hot':''}" draggable="true" data-sym="${esc(r.symbol)}"><div class="sr-head"><button class="draghandle" type="button" title="Aktienfenster ziehen und neu anordnen" aria-label="Aktienfenster neu anordnen">⋮⋮</button><b class="sr-tic" title="${esc(gloss('tickerSym'))}">${esc(r.symbol)}</b><button class="favbtn ${isFavStock(r.symbol)?'on':''}" data-favstock="${esc(r.symbol)}" title="${isFavStock(r.symbol)?'Aus Favoriten/Depot entfernen':'Zu Favoriten/Depot hinzufügen'}">${isFavStock(r.symbol)?'★':'☆'}</button><a class="gfinance mini" href="${googleFinanceUrl(r)}" target="_blank" rel="noopener" title="${esc(r.symbol)} in Google Finance öffnen">G↗</a><button class="rowmute" data-mutestock="${esc(r.symbol)}" title="${isStockMuted(r.symbol)?'Signalton für diesen Titel wieder einschalten':'Signalton nur für diesen Titel stummschalten. Die Analyse läuft unverändert weiter.'}">${isStockMuted(r.symbol)?'🔇':'🔊'}</button>${(()=>{const ft=flatexTradability(r);return `<span class="flatex-dot ft-${ft.tone}" title="${esc(ft.label+' — '+ft.detail)}">${ft.tone==='ok'?'🏦':ft.tone==='no'?'⛔':'❓'}</span>`;})()}</div><div class="sr-name"><b>${esc(dm.name)}</b><small>${esc(dm.theme)}</small></div><div class="sr-nums"><span title="Netto-CRV des 50/50-Tradeplans nach geschätzten Flatex/Tradegate-Kosten.">${num(sz?.planCrvAfterCosts ?? r.netCRV,1)} : 1</span><i>·</i><span title="${esc(gloss('score'))}">Score ${num(r.score,1)}</span>${r.preSignalMaturity!=null?`<i>·</i><span title="${esc(gloss('maturity'))}">Reife ${Math.round(r.preSignalMaturity)}%</span>`:''}${r.situationType?`<i>·</i><span title="${esc(glossForSituation(r.situationType)+' '+gloss('situationScore'))}">${esc(r.situationType)} ${Math.round(Number(r.situationScore)||0)}/100</span>`:''}<i>·</i><span title="Kursweg bis TP2">TP2 ${num(tr.tp2Pct,1)}%</span></div><div class="sr-verdict hl-${hl.light}" title="${esc(hl.title)}">${hl.icon} ${esc(hl.text)}</div><div class="sr-px">${stockPx(r.priceUsd,r.priceEur)}${sz?`<small> · ${buy?'Plan netto '+eur(sz.planNet,0):'keine Kauf-Freigabe'}</small>`:''}</div><div class="sr-hist" title="120-Minuten-Signalverlauf">${stockStatusBand(r)}</div>${crowdGauge(r.symbol,true)}${crowdConfirmGauge(r,true)}${(()=>{const ds=dataSession(r);return `<small class="stock-updated fresh-${stockFreshness(r).key} ds-${ds.tone}" title="${esc(ds.detail+' | '+stockUpdateLabel(r))}">${esc(ds.label)}</small>`;})()}${edgeStrip(r)}${stockPeek(r)}</div>`}).join('')}</section>`).join('');
  box.querySelectorAll('[data-mutestock]').forEach(b=>b.addEventListener('click',e=>toggleStockMute(b.dataset.mutestock,e)));
  box.querySelectorAll('.stockrow[data-sym]').forEach(row=>row.addEventListener('click',e=>{
    if(e.target.closest('button,a') || row.classList.contains('dragging')) return;
    focusStock=row.dataset.sym||''; renderStocks();
    $('#stockFocus')?.scrollIntoView({behavior:'smooth',block:'start'});
  }));
  box.querySelectorAll('[data-favstock]').forEach(b=>b.addEventListener('click',e=>toggleStockFavorite(b.dataset.favstock,e)));
  bindStockReorder(box);
  bindStockPeekDelay(box);
}

function reorderStock(from,to){
  if(!from||!to||from===to)return;
  const visible=stockRows.map(r=>String(r.symbol||'').toUpperCase()).filter(Boolean);
  const base=[...new Set([...(S.stockOrder||[]),...visible])];
  const i=base.indexOf(from),j=base.indexOf(to); if(i<0||j<0)return;
  const [x]=base.splice(i,1);base.splice(j,0,x);saveStockOrder(base);renderStocks();
}
function bindStockReorder(root){
  root.querySelectorAll('.stockrow[data-sym]').forEach(row=>{
    row.addEventListener('dragstart',e=>{if(e.target.closest('button:not(.draghandle)')){e.preventDefault();return;}e.dataTransfer.setData('text/plain',row.dataset.sym);e.dataTransfer.effectAllowed='move';row.classList.add('dragging')});
    row.addEventListener('dragend',()=>row.classList.remove('dragging'));
    row.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='move'});
    row.addEventListener('drop',e=>{e.preventDefault();reorderStock(e.dataTransfer.getData('text/plain'),row.dataset.sym)});
  });
  bindPointerReorder(root,'.stockrow[data-sym]','sym',reorderStock,'.draghandle');
}
function bindPointerReorder(root,selector,dataKey,onMove,handleSelector=null){
  let from=null,last=null;
  root.querySelectorAll(selector).forEach(item=>{
    const handle=handleSelector?item.querySelector(handleSelector):item; if(!handle)return;
    handle.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse')return;from=item.dataset[dataKey];last=null;item.classList.add('dragging');handle.setPointerCapture?.(e.pointerId);e.preventDefault();});
    handle.addEventListener('pointermove',e=>{if(!from)return;const t=document.elementFromPoint(e.clientX,e.clientY)?.closest(selector);if(t&&root.contains(t)&&t!==item)last=t.dataset[dataKey];});
    const finish=()=>{item.classList.remove('dragging');if(from&&last&&from!==last)onMove(from,last);from=null;last=null;};
    handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',finish);
  });
}

const stockPeekDelegates = new WeakSet();
function bindStockPeekDelay(root=document) {
  const host = root?.id === 'stockGroups' ? root : (root?.closest?.('#stockGroups') || $('#stockGroups'));
  if(!host || stockPeekDelegates.has(host)) return;
  stockPeekDelegates.add(host);
  let timer=null, active=null;
  host.addEventListener('mouseover',(e)=>{const row=e.target.closest('.stockrow');if(!row||!host.contains(row)||row===active)return;clearTimeout(timer);active=row;timer=setTimeout(()=>{if(active===row)row.classList.add('peek-open');},2300);});
  host.addEventListener('mouseout',(e)=>{const row=e.target.closest('.stockrow');if(!row)return;const to=e.relatedTarget;if(to&&row.contains(to))return;clearTimeout(timer);row.classList.remove('peek-open');if(active===row)active=null;});
}

/** Aktien-Alarme: nur bei NEUER Signalstufe, nie bei jedem Refresh. */
function trackStocks() {
  const now = Date.now();
  for (const r of stockRows) {
    const lvl = stockLevel(r);
    const st = stockState.get(r.symbol) || { light: null, since: now, streak: 0, level: -1, history: stockHistoryStore[r.symbol] || [] };
    if (st.light !== r.light) { st.since = now; st.streak = 1; } else st.streak++;
    st.light = r.light;
    // v3.0.12: akustisch nur handlungsrelevante Verbesserung.
    // WATCH/Crowd/Einzelindikatoren bleiben lautlos. CRV unter Minimum blockiert Ton.
    const sz=stockSizing(r), fresh=stockFreshness(r), tr=stockTradeability(r);
    // v3.1.1 Opportunity-Wächter: nur wirtschaftlich relevante, aktuelle Chancen melden.
    // BUY bleibt strikt; Opportunity darf Premarket vorbereiten, aber niemals BUY simulieren.
    const opportunityEligible=stockOpportunity(r).ready;
    const soundEligible = fresh.key==='live' && tr.marketOk && tr.ok;
    if (lvl > st.level && lvl >= 2 && st.level >= 0 && S.stockSound && (lvl===3?soundEligible:opportunityEligible)) {
      const sk=lvl === 3 ? 'stockbuy' : 'stockgreen';
      const sm=isStockMuted(r.symbol); if(S.sound&&!sm)beep(sk,sm); registerSignal('stock',r.symbol,sk);
    }
    st.level = lvl;
    st.history = appendHistory(stockHistoryStore, r.symbol, {
      /* v3.9.3 BEFUND: Hier stand `: 0`. Eine fehlende Ausfuehrbarkeit wurde damit
         als gemessene Null gespeichert und in der Heatmap auf die linke untere Ecke
         gezeichnet. Beim naechsten Scan mit echtem Wert entstand eine lange Spur quer
         durch das Feld — die wie eine gewaltige Aufwaertsbewegung aussah und keine war.
         Genau diese Phantomspur hat der Nutzer gemeldet. Jetzt `null` = nicht messbar;
         die Spur ueberspringt solche Punkte, statt eine Koordinate zu erfinden. */
      ts: now, quality: Number.isFinite(Number(r.score ?? r.quality)) ? Number(r.score ?? r.quality) : null,
      executability: Number.isFinite(Number(r.executability)) ? Number(r.executability) : null,
      light: r.light, crv: Number(r.netCRV || 0),
      crowd: Number(crowdFor(r.symbol)?.score ?? NaN),
      crowdConfirm: Number(crowdMarketConfirmation(r).score ?? NaN)
    });
    if (!learningStock.get(r.symbol)?.history?.length) r._history = st.history;
    stockState.set(r.symbol, st);
  }
  persistHistory(STOCK_HISTORY_KEY, stockHistoryStore);
  learnStocks();
  updateLeadLearning();
}

async function scanStocks(force = false) {
  const req=++stockReqSeq;
  try {
    const q = new URLSearchParams({ comp: S.components.join(','), minCrv: S.minCrvStock, favorites: (S.favoriteStocks||[]).join(',') });
    if (S.token) q.set('t', S.token);
    if (force) q.set('force', '1');
    const res = await fetchWithTimeout('/api/stocks?' + q, {cache:'no-store'}, force ? 26_000 : 12_000);
    const data = await res.json();
    if(req!==stockReqSeq)return;
    stockMeta = data;
    // Bei 429 oder einem frischen Worker-Isolate niemals bereits sichtbare
    // Aktien durch ein leeres Fallback-Array ersetzen. Letzte gute Werte bleiben
    // sichtbar, bis eine echte neue Teilgruppe angekommen ist.
    if (Array.isArray(data.rows) && data.rows.length) { rememberStockRows(data.rows); stockRows=mergeFavoriteRows(data.rows); } else { stockRows=mergeFavoriteRows(stockRows); }
    if (!res.ok) {
      setSys('#sysStocks', data.state || 'error', data.error);
      renderQuota(data.quota);
      checkQuotaPopup(data.quota, data.state);
      trackStocks();
      renderStocks();
      return;
    }
    const freshCount=Number(data.updatedThisCycle||0), forcedButStale=force&&(data.cached===true||freshCount===0);
    setSys('#sysStocks', data.configured === false ? 'nokey' : forcedButStale ? 'stale' : 'ok',
      data.configured === false ? ((data.source||'').includes('Tiingo')?'TIINGO_API_TOKEN fehlt':'Aktien-Datenquelle fehlt') : forcedButStale ? `Refresh ohne neue Deep-Daten · letzter Stand ${clock(data.ts)}` : `${freshCount} frisch analysiert · ${data.scanned ?? stockRows.length} geladen`);
    renderQuota(data.quota);
    checkQuotaPopup(data.quota, data.state);
    trackStocks();
    renderStocks();
  } catch (e) {
    setSys('#sysStocks', 'error', String(e.message || e));
    const st = $('#stockState');
    if (st) { st.textContent = 'Aktienfeed Fehler'; st.className = 'badge err'; st.title = String(e.message || e); }
  }
}
let stockSuggestTimer=null, stockSuggestSeq=0;
async function previewStockSearchLive(){
  const input=$('#stockQ'), preview=$('#stockSearchPreview'); if(!input||!preview)return;
  const raw=input.value.trim(); const seq=++stockSuggestSeq;
  clearTimeout(stockSuggestTimer);
  if(!raw){preview.textContent='';return;}
  const local=stockRows.filter(r=>r.symbol.toUpperCase().startsWith(raw.toUpperCase())||String(r.securityName||r.name||'').toUpperCase().includes(raw.toUpperCase())).slice(0,3);
  if(local.length){preview.innerHTML=local.map(r=>`<button type="button" data-suggeststock="${esc(r.symbol)}">✓ ${esc(r.symbol)} · ${esc(r.securityName||r.name||'Aktie')} <small>geladen</small></button>`).join('');}
  else preview.innerHTML='<span class="search-looking">Suche…</span>';
  stockSuggestTimer=setTimeout(async()=>{
    try{
      const q=new URLSearchParams({q:raw}); if(S.token)q.set('t',S.token);
      const res=await fetchWithTimeout('/api/stock-suggest?'+q,{cache:'no-store'},8_000), data=await res.json();
      if(seq!==stockSuggestSeq || input.value.trim()!==raw)return;
      const rows=data.rows||[];
      preview.innerHTML=rows.length?rows.map(r=>`<button type="button" data-suggeststock="${esc(r.symbol)}">✓ ${esc(r.symbol)} · ${esc(r.name||'Aktie')} <small>gefunden</small></button>`).join(''):'<span class="search-notfound">Noch kein Treffer</span>';
      preview.querySelectorAll('[data-suggeststock]').forEach(b=>b.addEventListener('click',()=>{input.value=b.dataset.suggeststock||'';searchStockNow();}));
    }catch{if(seq===stockSuggestSeq&&!local.length)preview.innerHTML='<span class="search-notfound">Trefferprüfung derzeit nicht erreichbar</span>';}
  },180);
  preview.querySelectorAll('[data-suggeststock]').forEach(b=>b.addEventListener('click',()=>{input.value=b.dataset.suggeststock||'';searchStockNow();}));
}

async function searchStockNow(symbolOverride='', force=false) {
  const input=$('#stockQ'), preview=$('#stockSearchPreview');
  const raw = String(symbolOverride || input?.value || '').trim();
  if (!raw || (!symbolOverride && (stockSearchBusy || Date.now()-stockSearchLastTs<800))) return;
  const req=++stockLookupSeq;
  if(!symbolOverride) stockSearchLastTs=Date.now();
  const showPreview=(row,msg='gefunden')=>{
    if(!preview)return;
    preview.innerHTML=`<button type="button" data-previewstock="${esc(row.symbol)}">✓ ${esc(row.symbol)} · ${esc(row.securityName||row.name||'Aktie')} ${esc(msg)}</button>`;
    preview.querySelector('[data-previewstock]')?.addEventListener('click',()=>{focusStock=row.symbol;renderStocks();$('#stockFocus')?.scrollIntoView({behavior:'smooth',block:'start'});});
  };
  const stock = stockRows.find((r) => r.symbol.toUpperCase() === raw.toUpperCase() || String(r.name || '').toUpperCase() === raw.toUpperCase() || String(r.securityName||'').toUpperCase()===raw.toUpperCase());
  if (stock && !force) { focusStock=stock.symbol; if(input)input.value=''; $('#stockSearchClear')?.classList.add('hidden'); showPreview(stock,'bereits geladen'); renderStocks(); return; }
  stockSearchBusy = true;
  const st = $('#stockState'); if (st) { st.textContent = 'Suche…'; st.className = 'badge'; }
  try {
    const q = new URLSearchParams({ lookup: raw, comp: S.components.join(','), minCrv: S.minCrvStock }); if(force)q.set('force','1'); if (S.token) q.set('t', S.token);
    const res = await fetchWithTimeout('/api/stocks?' + q, { cache: 'no-store' }, force ? 18_000 : 12_000); const data = await res.json();
    if(req!==stockLookupSeq)return;
    const requested=/^[A-Z0-9.\-]{1,12}$/i.test(raw)?raw.toUpperCase():null;
    const returned=String(data.row?.symbol||'').toUpperCase();
    if(requested && returned && returned!==requested) throw new Error(`Ticker-Mismatch: angefordert ${requested}, erhalten ${returned}`);
    stockMeta = { ...stockMeta, ...data, refreshedSymbols:data.cached?[]:[data.row?.symbol].filter(Boolean), ts:data.cached?(data.ts||stockMeta.ts):(data.ts||Date.now()) };
    if (data.row) { const m = new Map(stockRows.map((r) => [r.symbol, r])); m.set(data.row.symbol, data.row); stockRows = [...m.values()]; rememberStockRows([data.row]); stockRows=mergeFavoriteRows(stockRows); focusStock=data.row.symbol; }
    renderQuota(data.quota); checkQuotaPopup(data.quota, data.state);
    if (!res.ok || data.notFound) { if (st) { st.textContent = data.notFound ? 'Nicht gefunden' : 'Suche fehlgeschlagen'; st.className = 'badge warn'; st.title = data.error || 'Bitte Ticker versuchen.'; } if(preview)preview.textContent=data.error||'Kein Treffer gefunden.'; }
    else { if (st) { st.textContent = data.cached ? 'Treffer · Cache' : 'Treffer geladen'; st.className = 'badge ok'; } if(data.row){showPreview(data.row);if(input)input.value='';$('#stockSearchClear')?.classList.add('hidden');} }
    trackStocks(); renderStocks();
  } catch (e) { if (st) { st.textContent = 'Suche fehlgeschlagen'; st.className = 'badge err'; st.title = String(e.message || e); } if(preview)preview.textContent='Suche fehlgeschlagen: '+String(e.message||e); }
  finally { stockSearchBusy = false; }
}

async function scanOpeningMomentum(force = false) {
  const req=++openingReqSeq;
  try {
    const q = new URLSearchParams({favorites:(S.favoriteStocks||[]).join(',')}); if (S.token) q.set('t', S.token); if (force) q.set('force','1');
    const res = await fetchWithTimeout('/api/opening?' + q, { cache: 'no-store' }, 10_000);
    const data = await res.json(); if(req!==openingReqSeq)return; openingMeta = data; openingRows = data.rows || []; renderOpeningPanel(); renderStocks();
  } catch (e) { openingMeta = { state:'error', phaseLabel:'Alpaca nicht erreichbar', phaseHelp:String(e.message||e) }; renderOpeningPanel(); }
}
let stockRecoveryAttemptTs=0;
function stockSnapshotAgeMs(){const t=Number(stockMeta?.ts||0);return t>0?Math.max(0,Date.now()-t):Infinity;}
function stockRecoveryNeeded(){
  const phase=String(stockMeta?.market?.key||openingMeta?.phase||'');
  return ['premarket','opening','regular'].includes(phase) && stockSnapshotAgeMs()>=3*60_000;
}
function setStockPoll() {
  clearTimeout(stockTimer);
  const scheduleStockPoll = () => {
    const primaryTiingo = String(stockMeta?.provider||'').toLowerCase()==='tiingo' || String(stockMeta?.source||'').includes('Tiingo');
    const universe = Number(stockMeta?.universe || 21);
    const incomplete = Number.isFinite(universe) ? stockRows.length < universe : true;
    const recovery=primaryTiingo&&stockRecoveryNeeded();
    // v3.4.3: Opening/Regular darf nicht minutenlang stillstehen. Ab 3 Min.
    // Stale-Zeit darf der sichtbare Client einen echten Recovery-Scan anfordern,
    // jedoch max. einmal je 2 Minuten, damit mehrere Tabs Cloudflare nicht fluten.
    const delay = recovery ? 60_000 : primaryTiingo ? 2 * 60_000 : (incomplete ? 65_000 : 5 * 60_000);
    stockTimer = setTimeout(async () => {
      try {
        if (document.visibilityState === 'visible') {
          const need=stockRecoveryNeeded()&&Date.now()-stockRecoveryAttemptTs>=2*60_000;
          if(need)stockRecoveryAttemptTs=Date.now();
          await scanStocks(need);
        }
      } finally { scheduleStockPoll(); }
    }, delay);
  };
  scheduleStockPoll();
  clearInterval(openingTimer);
  openingTimer = setInterval(() => { if (document.visibilityState === 'visible') scanOpeningMomentum(false); }, 60_000);
  clearInterval(experimentalTimer); experimentalTimer=setInterval(()=>{if(document.visibilityState==='visible')loadExperimental(false);},15*60_000);
  clearInterval(crowdTimer); crowdTimer=setInterval(()=>{if(document.visibilityState==='visible')loadCrowd(false);},20*60_000);
  // Der Index wird nur einmal taeglich aktualisiert — halbstuendlich reicht mehr als aus.
  clearInterval(fngTimer); fngTimer=setInterval(()=>{if(document.visibilityState==='visible')loadSentiment(false);},30*60_000);
  // Termine aendern sich selten — zweistuendlich genuegt.
  clearInterval(earnTimer); earnTimer=setInterval(()=>{if(document.visibilityState==='visible')loadEarnings(false);},120*60_000);
}

/* ------------------------------------------------- Reifezeit + Alarmierung
   Ein Setup, das seit drei Stunden hält, ist eine gespannte Feder.
   Eines, das seit zehn Minuten besteht, ist Rauschen. Die Zeit im Zustand
   ist eine Dimension, die klassische Indikatoren strukturell nicht sehen.
   v3.0.7: Ton NUR bei neuer Signalstufe, nicht bei jedem Scan.            */
function track() {
  const now = Date.now();
  const cutoff = now - 120 * 60_000;
  for (const r of rows) {
    const st = state.get(r.pair)
      || { light: null, since: now, quality: r.quality, prevQ: r.quality, streak: 0, level: -1, crvBand: 0, history: coinHistoryStore[r.pair] || [] };
    const oldLight = st.light;
    const oldCrv = Number(st.netCRV ?? r.netCRV);
    if (st.light !== r.light) { st.since = now; st.streak = 1; } else st.streak++;
    st.prevQ = st.quality; st.quality = r.quality; st.light = r.light;
    st.prevCrv = oldCrv; st.netCRV = Number(r.netCRV || 0);
    st.prevLight = oldLight;

    const lvl = coinLevel(r);
    const crvBand = r.netCRV >= S.minCrvCoin + 1 ? 2 : r.netCRV >= S.minCrvCoin ? 1 : 0;
    const known = st.level >= 0;

    // v3.0.12: WATCH ist bewusst lautlos. Ein Coin mit CRV unter Minimum
    // oder roter Ampel darf keinen positiven Signalton erzeugen.
    const soundEligible = Number(r.netCRV||0) >= Number(S.minCrvCoin||DEFAULTS.minCrvCoin) && r.light !== 'red';
    if (known && lvl > st.level && lvl >= 2 && soundEligible) {
      const ck=lvl === 3 ? 'buy' : 'green'; const cm=isMuted(r.pair);
      if(S.sound&&!cm)beep(ck,cm); registerSignal('coin',r.pair,ck);
      notify(r);
    } else if (known && lvl >= 2 && crvBand > st.crvBand && soundEligible) {
      const ck=lvl >= 3 ? 'buy' : 'green'; const cm=isMuted(r.pair);
      if(S.sound&&!cm)beep(ck,cm); registerSignal('coin',r.pair,ck);
      notify(r);
    }

    st.level = lvl; st.crvBand = crvBand;
    st.history = appendHistory(coinHistoryStore, r.pair, { ts: now, quality: Number.isFinite(Number(r.quality)) ? Number(r.quality) : null, executability: Number.isFinite(Number(r.executability)) ? Number(r.executability) : null, light: r.light, crv: Number(r.netCRV || 0) });
    state.set(r.pair, st);

    r._age = now - st.since;
    r._streak = st.streak;
    r._delta = st.quality - st.prevQ;
    r._crvDelta = Number(r.netCRV || 0) - oldCrv;
    r._prevLight = oldLight;
    r._history = st.history;
  }
  persistHistory(COIN_HISTORY_KEY, coinHistoryStore);
}

function notify(r) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  new Notification(`${sym(r.pair)} · ${r.setup}`, {
    body: `Zone ${num(r.zoneLow)}–${num(r.zoneHigh)} · CRV ${r.netCRV}:1`,
    tag: r.pair, silent: true,
  });
}

/* --------------------------------------------------------------- Sparkline */
function spark(data, w = 78, h = 22) {
  if (!data?.length) return '';
  if (data.length === 1) { const y=(h-(Number(data[0])||0)/100*(h-2)-1).toFixed(1); return `<svg class="spk" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><circle cx="${(w/2).toFixed(1)}" cy="${y}" r="1.7" fill="currentColor"/></svg>`; }
  const pts = data.map((v, i) => `${((i / (data.length - 1)) * w).toFixed(1)},${(h - (v / 100) * (h - 2) - 1).toFixed(1)}`).join(' ');
  return `<svg class="spk" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.4" vector-effect="non-scaling-stroke"/></svg>`;
}

/* ---------------------------------------------------------- Zonenlage-Balken */
function zoneState(r){
  if(r.inZone) return {key:'in',label:'IN ZONE'};
  if(Number(r.price)<Number(r.zoneLow)) return {key:'below',label:'UNTER ZONE'};
  if(Number(r.price)>Number(r.zoneHigh)) return {key:'above',label:'ÜBER ZONE'};
  return {key:'na',label:'ZONE n.v.'};
}
function zoneBar(r) {
  const lo = Math.min(r.stop, r.zoneLow, r.price);
  const hi = Math.max(r.tp1, r.zoneHigh, r.price);
  const pos = (v) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
  const zl = pos(r.zoneLow), zh = pos(r.zoneHigh), p = pos(r.price), st = pos(r.stop);
  return `<div class="zb ${r.inZone ? 'hit' : ''}">
    <i class="zb-stop" style="left:${st}%"></i>
    <i class="zb-zone" style="left:${zl}%;width:${Math.max(2, zh - zl)}%"></i>
    <i class="zb-px" style="left:${p}%"></i></div>`;
}

/* -------------------------------------------------------------- Preisleiter */
function ladder(r) {
  const lo = Math.min(r.stop, r.price) * 0.9985;
  const hi = Math.max(r.tp2, r.price) * 1.0015;
  const y = (v) => (1 - (v - lo) / (hi - lo)) * 100;
  const s = sizing(r);
  const mark = (v, cls, label, right) => `
    <div class="lv ${cls}" style="top:${y(v).toFixed(2)}%">
      <span class="lvl">${label}</span><span class="lvv">${num(v)}</span>
      ${right ? `<span class="lvr">${right}</span>` : ''}
    </div>`;
  const zTop = y(r.zoneHigh), zBot = y(r.zoneLow);
  return `<div class="ladder">
    <div class="lzone" style="top:${zTop.toFixed(2)}%;height:${Math.max(1.5, zBot - zTop).toFixed(2)}%"></div>
    ${mark(r.tp2, 'tp2', 'TP2', s ? '+' + eur(s.profit2, 0) : '')}
    ${mark(r.tp1, 'tp1', 'TP1', s ? '+' + eur(s.profit1, 0) : '')}
    ${mark(r.entry, 'entry', 'Entry', '')}
    ${mark(r.stop, 'stop', 'Stop', s ? '−' + eur(s.realRisk, 0) : '')}
    <div class="lpx ${r.inZone ? 'inzone' : ''}" style="top:${y(r.price).toFixed(2)}%">
      <span>${num(r.price)}</span></div>
  </div>`;
}

/* ------------------------------------------------------------ Fokus-Panel */
function renderFocus() {
  const r = rows.find((x) => x.pair === selected);
  const el = $('#focus');
  if (!r) {
    el.className = 'focus empty';
    el.innerHTML = `<div class="fempty"><b>Kein handelbares Setup</b>
      <span>Warten ist auch eine Position. Der Scanner meldet sich.</span></div>`;
    $('#dock').classList.add('hidden');
    return;
  }
  const s = sizing(r);
  const strength = signalStrength(r); const ready = buyReady(r);
  el.className = `focus ${r.light} tone-${strength}${r.inZone ? ' inzone' : ''}${ready ? ' buy-ready' : ''}`;
  el.innerHTML = `
    <div class="fmain">
      <div class="fhead">
        <div>
          <h2>${sym(r.pair)} <small>${num(r.price)}</small></h2>
          <p class="fsetup" title="${esc(explainSetup(r))}">${r.orderType === 'stop' ? '▲ Stop-Buy' : '▼ Limit-Buy'} · ${esc(r.setup)}</p>
        </div>
        <div class="fpins">
          ${ready ? '<span class="buybadge" title="KAUFEN: Setup ist grün, Preis liegt in der Einstiegszone und das Mindest-CRV ist erfüllt.">🟢 KAUFEN</span>' : ''}
          <button class="pairmute" id="fmute" title="Akustische Signale nur für diesen Coin ein-/ausschalten">${isMuted(r.pair) ? '🔇' : '🔊'}</button>
          <span class="pin q" title="Q = Setup-Qualität von 0–10. Höher bedeutet: mehr aktivierte Analyseverfahren bestätigen dasselbe Setup.">Q <b>${r.quality}</b></span>
          <span class="pin h" title="H = Handelbarkeit/Ausführbarkeit von 0–10. Berücksichtigt Spread, Slippage und Orderbuchtiefe. Bleibt auch bei abgeschalteten Analyseverfahren aktiv.">H <b>${r.executability}</b></span>
          <span class="pin age" title="Reife: ${r._streak || 1} bestätigende Scans in diesem Zustand. Die Farbintensität steigt mit der Anzahl der Bestätigungen.">${mins(r._age)} · ${r._streak || 1}×</span>
        </div>
      </div>

      ${((r.light !== 'green' && r.blockers.length) || r.blockers.includes('Orderbuch ungeprüft'))
        ? `<div class="fblock"><b>${r.light === 'green' ? 'Vorbehalt:' : 'Nicht handeln, weil:'}</b> ${esc(r.blockers.join(' · '))}</div>` : ''}
      <div class="insightbar"><div><span>120-Min-Verlauf</span>${statusBand(r)} <b>${trendArrow(r)}</b></div><div title="BUY-Nähe ist keine Trefferwahrscheinlichkeit. Sie zeigt nur, wie viele aktuelle Voraussetzungen bereits erfüllt sind."><span>BUY-Nähe</span><b>${buyNear(r)} %</b></div><div><span>Was hat sich geändert?</span><b>${esc(changeSummary(r))}</b></div></div>

      <div class="fgrid">
        <div title="Einstiegszone: Preisbereich, in dem der geplante Kauf sinnvoll wird."><span>Einstiegszone</span><b>${num(r.zoneLow)} – ${num(r.zoneHigh)}</b></div>
        <div title="Bei echter BUY-Freigabe empfohlener Einsatz; vorher nur theoretische Größe."><span>${ready?'Kaufsumme':'Pot. Größe'}</span><b>${ready?(s?eur(s.notional,0):'–'):(r.light==='yellow'||r.light==='green'?(s?'pot. '+eur(s.notional,0):'–'):'—')}</b></div>
        <div class="metricbox ${r.netCRV >= S.minCrvCoin ? 'positive' : r.netCRV >= Math.max(1, S.minCrvCoin-.5) ? 'wait' : 'negative'}" title="Netto-CRV: erwarteter Ertrag im Verhältnis zum Risiko nach geschätzten Gebühren, Spread und Slippage. Beispiel 3:1 = 3 € potenzieller Ertrag pro 1 € Risiko."><span>Netto-CRV</span><b class="${r.netCRV >= S.minCrvCoin ? 'good' : 'bad'}">${r.netCRV}:1</b></div>
        <div title="Maximaler rechnerischer Verlust bis zum Stop-Loss bei der vorgeschlagenen Positionsgröße."><span>Risiko bis SL</span><b>${s ? eur(s.realRisk, 0) : '–'} · ${r.riskPct} %</b></div>
        <div class="metricbox ${r.costRatio >= 4 ? 'positive' : r.costRatio >= 2.5 ? 'wait' : 'negative'}" title="Kosten: geschätzte Gebühren + Spread + Slippage. Die ×-Zahl zeigt, wie oft die erwartete Bewegung diese Kosten deckt. Höher ist besser."><span>Kosten</span><b class="${r.costRatio < 2.5 ? 'bad' : ''}">${r.costPct} % · ${r.costRatio}×</b></div>
        <div class="metricbox ${r.slipBps == null ? 'wait' : r.slipBps <= 5 ? 'positive' : r.slipBps <= 15 ? 'wait' : 'negative'}" title="Slippage: erwartete Abweichung zwischen geplantem und tatsächlich erreichbarem Ausführungspreis. 1 Basispunkt (bp) = 0,01 %. Niedriger ist besser."><span>Slippage</span><b>${r.slipBps != null ? r.slipBps + ' bps' : '–'}</b></div>
        <div title="Geschätzter Nettogewinn des ersten 50-%-Teilverkaufs bei TP1."><span>TP1 · 50 % netto*</span><b class="good">${s ? eur(s.netProfit1, 0) : '–'}</b></div>
        <div title="Geschätzter Nettogewinn der verbleibenden 50 % bei TP2."><span>TP2 Rest · 50 % netto*</span><b class="good">${s ? eur(s.netProfit2, 0) : '–'}</b></div>
        <div title="Geschätzter Nettogewinn des Gesamtplans: 50 % bei TP1 + 50 % bei TP2."><span>Gesamtplan netto*</span><b class="good">${s ? eur(s.planNet, 0) : '–'}</b></div>
        <div title="Aktive Analyseverfahren. Sicherheitsfilter wie Liquidität, Spread und Kosten bleiben immer aktiv."><span>Analyse</span><b>${esc(r.analysisMode || S.analysisMode)} · ${(r.components || S.components).length}/9</b></div>
      </div>
      <small class="taxnote">* Schätzung mit ${num(S.taxPct, 1)} % auf positiven Gewinn; keine Steuerberatung.</small>
      <div class="tradeplan" title="Konkreter manueller Trade-Plan. TP1 = erster Teilverkauf; TP2 = Verkauf der Restposition.">
        <b>${ready ? '🟢 KAUFEN – TRADE-PLAN' : r.light === 'green' ? 'POSITIVES SETUP – EINSTIEG NOCH PRÜFEN' : 'BEOBACHTUNGS-PLAN'}</b>
        <span>Kaufsumme <strong>${s ? eur(s.notional, 0) : '–'}</strong></span>
        <span>Entry <strong>${num(r.entry)}</strong></span>
        <span>Stop-Loss <strong>${num(r.stop)}</strong></span>
        <span title="TP1 = Take Profit 1: erster Teilverkauf, üblicherweise die halbe Position.">TP1 · Teilverkauf 1 <strong>${num(r.tp1)}</strong></span>
        <span title="TP2 = Take Profit 2: Verkauf der Restposition.">TP2 · Restverkauf <strong>${num(r.tp2)}</strong></span>
      </div>

      <div class="factions">
        <button class="primary" id="fcopy">⧉ Order-Plan kopieren</button>
        <button id="fentry">⧉ ${num(r.entry)}</button>
        <button id="fstop">⧉ Stop</button>
        <button id="fqty">⧉ Menge</button>
        <button id="fdet">Details</button>
      </div>
      ${capNotice(s)}
    </div>
    ${ladder(r)}`;

  $('#fcopy').onclick = (e) => copy(orderPlan(r), e.target);
  $('#fentry').onclick = (e) => copy(String(r.entry), e.target);
  $('#fstop').onclick = (e) => copy(String(r.stop), e.target);
  $('#fqty').onclick = (e) => copy(s ? String(s.qty) : '0', e.target);
  $('#fdet').onclick = () => openDetail(r.pair);
  $('#fmute').onclick = (e) => togglePairMute(r.pair, e);

  $('#dsym').textContent = sym(r.pair);
  $('#dplan').textContent = `${r.orderType === 'stop' ? 'Stop' : 'Limit'} ${num(r.entry)} · SL ${num(r.stop)} · ${s ? eur(s.notional, 0) : '–'}`;
  $('#dock').classList.remove('hidden');
  $('#dock').className = `dock ${r.light}`;
}


function historyBand(hist, label = 'Signalverlauf') {
  const now = Date.now();
  const bins = [];
  for (let idx = 0; idx < 8; idx++) {
    const startAgo = 120 - idx * 15;
    const endAgo = startAgo - 15;
    const lo = now - startAgo * 60_000, hi = now - endAgo * 60_000;
    const inBin = (hist || []).filter(x => x.ts >= lo && x.ts < hi);
    const h = inBin.length ? inBin.at(-1) : null;
    const light = h?.light || 'none';
    const score = h ? Number(h.quality || 0) : null;
    bins.push(`<i class="hb ${light}" title="${startAgo}–${endAgo} Minuten zurück: ${light === 'green' ? 'grün' : light === 'yellow' ? 'gelb' : light === 'red' ? 'rot' : 'noch keine gespeicherten Daten'}${score!=null?' · Score '+num(score,1):''}"></i>`);
  }
  return `<span class="histband" title="${esc(label)} der letzten 120 Minuten, 8 Abschnitte à 15 Minuten. Die Historie bleibt bei Reloads lokal erhalten.">${bins.join('')}</span>`;
}
function statusBand(r) { return historyBand(r._history || [], 'Coin-Signalverlauf'); }
function trendArrow(r) {
  const h = r._history || [];
  if (h.length < 2) return '→';
  const first = h[0], last = h.at(-1);
  const d = (last.quality + last.executability) - (first.quality + first.executability);
  return d > 0.8 ? '↗' : d < -0.8 ? '↘' : '→';
}
function changeSummary(r) {
  const bits = [];
  if (r._prevLight && r._prevLight !== r.light) bits.push(`${r._prevLight === 'red' ? 'Rot' : r._prevLight === 'yellow' ? 'Gelb' : 'Grün'} → ${r.light === 'red' ? 'Rot' : r.light === 'yellow' ? 'Gelb' : 'Grün'}`);
  if (Math.abs(r._delta || 0) >= 0.15) bits.push(`Qualität ${(r._delta > 0 ? '+' : '') + num(r._delta, 1)}`);
  if (Math.abs(r._crvDelta || 0) >= 0.15) bits.push(`CRV ${(r._crvDelta > 0 ? '+' : '') + num(r._crvDelta, 1)}`);
  return bits.length ? bits.join(' · ') : 'Seit dem letzten Vergleich keine wesentliche Änderung';
}
function buyNear(r) {
  const q = Math.min(1, Number(r.quality || 0) / 7.4);
  const h = Math.min(1, Number(r.executability || 0) / 7.0);
  const c = Math.min(1, Number(r.netCRV || 0) / Math.max(.1, Number(S.minCrvCoin || 2)));
  const z = r.inZone ? 1 : .55;
  return Math.max(0, Math.min(100, Math.round((q*.3 + h*.2 + c*.3 + z*.2) * 100)));
}
function capNotice(s) {
  if (!s?.capped) return '';
  if (s.caps?.includes('liquidity')) return `<p class="fwarn"><b>⚠ Kaufsumme auf ${eur(s.notional, 0)} reduziert.</b><br>Eine größere Order könnte wegen zu geringer Marktliquidität zu einem schlechteren Kaufpreis führen. <span title="FusionPulse berücksichtigt dazu Orderbuchtiefe und erwartete Slippage.">Warum?</span></p>`;
  if (s.caps?.includes('liquidityUnchecked')) return `<p class="fwarn"><b>⚠ Kaufsumme ohne Liquiditätsprüfung.</b><br>Für dieses Setup liegt keine belastbare Orderbuchtiefe vor. Die angezeigte Positionsgröße wurde daher nicht anhand der Marktliquidität gekappt.</p>`;
  if (s.caps?.includes('maxTrade')) return `<p class="fwarn"><b>ℹ Kaufsumme auf ${eur(s.notional, 0)} begrenzt.</b><br>Das ist dein in den Einstellungen festgelegter Maximalbetrag pro Trade.</p>`;
  return '';
}

/* --------------------------------------------------------------- 2D-Karte */
function renderMap() {
  const svg = $('#map');
  const g = (x) => 12 + (x / 10) * 176;
  const pts = rows.map((r) => ({ r, x: g(r.executability), y: 200 - g(r.quality), baseX: g(r.executability), baseY: 200 - g(r.quality), rad: 4.5 + Math.max(0, Math.min(3.2, (Number(r.quality || 0) - 5) * .75)) }));
  // leichte Kollisionstrennung: analytische Position bleibt Basis, Kreise werden nur wenige Pixel auseinandergezogen
  for (let it = 0; it < 18; it++) for (let i = 0; i < pts.length; i++) for (let j = i+1; j < pts.length; j++) {
    const a=pts[i], b=pts[j], dx=b.x-a.x, dy=b.y-a.y, d=Math.hypot(dx,dy)||.01, min=a.rad+b.rad+2.5;
    if (d < min) { const push=(min-d)*.18, ux=dx/d, uy=dy/d; a.x-=ux*push; a.y-=uy*push; b.x+=ux*push; b.y+=uy*push; }
  }
  pts.forEach((p) => { p.x = Math.max(10, Math.min(190, p.x)); p.y = Math.max(10, Math.min(190, p.y)); });

  /* v3.9.3: Gleicher Befund wie in der Aktien-Heatmap — die Spuren wurden aus
     Rohkoordinaten gezeichnet, die Punkte aber vorher auseinandergeschoben und
     auf 10..190 begrenzt. Spurende und Punkt lagen deshalb nicht uebereinander.
     Ausserdem werden Punkte ohne messbaren Wert jetzt uebersprungen statt als
     Null in die linke untere Ecke gezeichnet. */
  const trails = pts.map(({r,x,y}) => {
    const h=(r._history||[])
      .filter((p)=>Date.now()-p.ts<=120*60_000)
      .filter((p)=>Number.isFinite(Number(p.executability))&&Number.isFinite(Number(p.quality)))
      .slice(-8);
    if (h.length < 2) return '';
    const raw=h.map((p)=>({x:g(Number(p.executability)),y:200-g(Number(p.quality))}));
    const last=raw[raw.length-1];
    const ox=x-last.x, oy=y-last.y;
    const points=raw.map((p)=>`${(p.x+ox).toFixed(1)},${(p.y+oy).toFixed(1)}`).join(' ');
    return `<polyline class="trail ${r.light}" points="${points}"/>`;
  }).join('');
  const dots = pts.map(({r,x,y,rad}) => {
    const sel=r.pair===selected, ready=buyReady(r);
    /* v3.6.1: Punktfarbe folgt der Kopf-Bewertung, nicht mehr allein r.light.
       Sonst leuchtet ein Coin gruen im Feld "STARK", waehrend die Karte
       darunter "CRV zu niedrig" sagt — derselbe Widerspruch wie bei SOFI. */
    const hl=coinHeadline(r), sz=sizing(r);
    return `<g class="dot light-${hl.light} ${sel?'sel':''} ${ready?'buy-ready':''} ${hl.kind==='economic'?'econ-weak':''}" data-pair="${r.pair}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">
      <circle class="hit" cx="0" cy="0" r="${rad+7}"/>
      <circle class="core" cx="0" cy="0" r="${sel?rad+1.5:rad}"/>
      <text x="0" y="2.2">${sym(r.pair).slice(0,5)}</text>
      <title>${sym(r.pair)} · ${hl.icon} ${hl.text}
Qualität ${r.quality}/10 · Handelbarkeit ${r.executability}/10 · CRV ${r.netCRV}:1${sz?` · Plan netto ${eur(sz.planNet,0)}`:''}
Achtung: beide Achsen sind TECHNISCH. Ob sich der Trade lohnt, steht in der Farbe und im Text oben.</title>
    </g>`;
  }).join('');

  /* v3.6.1: Quadranten-Beschriftung analog Aktien-Heatmap. Die Bezeichnungen
     sagen jetzt ausdruecklich "technisch" — die alten Aktien-Labels
     (frueher "stark/attraktiv") liessen sich als wirtschaftliche Aussage lesen,
     was sie nie waren. Beide Achsen messen Technik, nicht Ertrag. */
  svg.innerHTML = `
    <rect class="quad qa" x="100" y="0" width="100" height="100"/>
    <rect class="quad qb" x="0" y="0" width="100" height="100"/>
    <rect class="quad qc" x="100" y="100" width="100" height="100"/>
    <rect class="quad qd" x="0" y="100" width="100" height="100"/>
    <line class="ax" x1="100" y1="0" x2="100" y2="200"/><line class="ax" x1="0" y1="100" x2="200" y2="100"/>
    <text class="quad-label ql-tr" x="151" y="11">MUSTER STARK<tspan class="ql2" x="151" dy="7.4">gut handelbar</tspan></text>
    <text class="quad-label ql-tl" x="49" y="11">MUSTER STARK<tspan class="ql2" x="49" dy="7.4">schwer handelbar</tspan></text>
    <text class="quad-label ql-br" x="151" y="187">MUSTER SCHWACH<tspan class="ql2" x="151" dy="7.4">gut handelbar</tspan></text>
    <text class="quad-label ql-bl" x="49" y="187">MUSTER SCHWACH<tspan class="ql2" x="49" dy="7.4">schwer handelbar</tspan></text>
    ${trails}${dots}`;
  $$('#map .dot').forEach((d) => d.addEventListener('click', () => select(d.dataset.pair, true)));
}

/* ------------------------------------------------------------ Dichte Liste */
function visible() {
  const q = $('#q').value.trim().toUpperCase();
  const f = $('#f').value;
  return rows.filter((r) =>
    (!q || r.pair.includes(q)) &&
    ((!f || f === 'favorites') ? (f !== 'favorites' || isFavPair(r.pair)) : r.light === f) &&
    r.quality >= S.minQ &&
    (!S.onlyZone || r.inZone))
    .sort((a, b) => (Number(isFavPair(b.pair)) - Number(isFavPair(a.pair))) || b.quality - a.quality);
}

function rowHtml(r) {
  const s = sizing(r);
  const ready = buyReady(r);
  const d = r._delta > 0.4 ? '<i class="up">▲</i>' : r._delta < -0.4 ? '<i class="dn">▼</i>' : '';
  return `
    <span class="c-sym" title="Coin und aktueller Signalstatus. Pulsierender grüner Rahmen = konkrete Kauf-Freigabe nach den definierten Regeln."><button class="favbtn ${isFavPair(r.pair) ? 'on' : ''}" data-favpair="${r.pair}" title="${isFavPair(r.pair) ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'}">${isFavPair(r.pair) ? '★' : '☆'}</button><b class="dotc ${r.light}"></b>${sym(r.pair)}${d}<button class="rowmute" data-mute="${r.pair}" title="Ton nur für ${sym(r.pair)} ${isMuted(r.pair) ? 'einschalten' : 'ausschalten'}">${isMuted(r.pair) ? '🔇' : '🔊'}</button></span>
    <span class="c-spk" title="Kurzfristiger Kursverlauf der letzten Bars, normiert">${spark(r.spark)}${statusBand(r)}<small class="trendarr">${trendArrow(r)}</small></span>
    <span class="c-set fast-tip" data-tip="${esc(explainSetup(r))}">${r.orderType === 'stop' ? '▲' : '▼'} ${esc(r.setup)}</span>
    <span class="c-age ta" title="Reife: ${r._streak || 1} aufeinanderfolgende Scans haben diesen Signalzustand bestätigt. Die Farbintensität steigt mit der Bestätigungsdauer.">${mins(r._age)}<i class="stk">${r._streak || 1}×</i></span>
    <span class="c-zone fast-tip" data-tip="Zonenlage: UNTER ZONE = Kurs liegt noch unter dem geplanten Einstiegsbereich, warten. IN ZONE = Kurs ist im interessanten Einstiegsbereich, aber noch kein automatisches BUY. ÜBER ZONE = Einstieg ist bereits davongelaufen; nicht hinterherlaufen, auf Pullback/Retest oder neue Zone warten.">${zoneBar(r)}<small class="zone-label ${zoneState(r).key}">${zoneState(r).label}</small></span>
    <span class="c-r ta ${r.netCRV >= S.minCrvCoin ? 'positive' : r.netCRV >= Math.max(1, S.minCrvCoin-.5) ? 'wait' : 'negative'}" title="Netto-CRV nach Kosten: erwarteter Ertrag pro Einheit Risiko. Höher ist besser.">${r.netCRV.toFixed(1)}</span>
    <span class="c-sz ta" title="Bei echter BUY-Freigabe: empfohlene Kaufsumme. Sonst nur potenzielle Größe bzw. kein Trade.">${ready ? (s ? eur(s.notional,0) : '–') : (r.light==='yellow'||r.light==='green' ? (s ? 'pot. '+eur(s.notional,0) : '–') : '—')}</span>
    <span class="c-qh ta" title="Q = Setup-Qualität (0–10), H = Handelbarkeit/Ausführbarkeit (0–10)."><b>${r.quality}</b><i>·</i>${r.executability}</span>
    <span class="tradepeek"><b>${sym(r.pair)} · ${esc(r.setup)}</b><br>
      Einsatz ${s ? eur(s.notional, 0) : '–'} · Entry ${num(r.entry)} · SL ${num(r.stop)} · TP1 ${num(r.tp1)} · TP2 ${num(r.tp2)}<br>
      CRV ${r.netCRV}:1 · Gesamtplan netto* ${s ? eur(s.planNet, 0) : '–'}
    </span>`;
}

function renderList() {
  const list = visible().slice(0, S.coinCount);
  const hot = list.filter((r) => r.light !== 'red');
  const cold = list.filter((r) => r.light === 'red');
  const fill = Math.max(0, 8 - hot.length);          // Liste auf mind. 8 Zeilen auffuellen
  const main = [...hot, ...cold.slice(0, fill)];
  const rest = cold.slice(fill);
  paint($('#list'), main);
  paint($('#rest'), rest);
  $('#more').classList.toggle('hidden', rest.length === 0);
  $('#more').textContent = showRest ? `▾ ${rest.length} ausblenden` : `▸ ${rest.length} weitere anzeigen`;
  $('#rest').classList.toggle('hidden', !showRest);

  const c = { green: 0, yellow: 0, red: 0 };
  rows.forEach((r) => c[r.light]++);
  $('#gc').textContent = c.green; $('#yc').textContent = c.yellow; $('#rc').textContent = c.red;
}

function paint(container, list) {
  const seen = new Set();
  list.forEach((r, i) => {
    seen.add(r.pair);
    let el = rowNodes.get(r.pair);
    if (!el || el.parentElement !== container) {
      el = document.createElement('div');
      el.dataset.pair = r.pair;
      el.tabIndex = 0;
      el.addEventListener('click', () => select(r.pair, true));
      rowNodes.set(r.pair, el);
    }
    const strength = signalStrength(r); const ready = buyReady(r);
    el.className = `row ${r.light} tone-${strength}${r.pair === selected ? ' sel' : ''}${r.inZone ? ' inzone' : ''}${ready ? ' buy-ready' : ''}${signalIsHot('coin',r.pair)?' signal-hot':''}`;
    el.innerHTML = rowHtml(r);
    el.querySelector('[data-mute]')?.addEventListener('click', (e) => togglePairMute(r.pair, e));
    el.querySelector('[data-favpair]')?.addEventListener('click', (e) => togglePairFavorite(r.pair, e));
    if (container.children[i] !== el) container.insertBefore(el, container.children[i] || null);
  });
  [...container.children].forEach((el) => {
    if (!seen.has(el.dataset.pair)) { el.remove(); if (rowNodes.get(el.dataset.pair) === el) rowNodes.delete(el.dataset.pair); }
  });
}

/* ------------------------------------------------------------------ Render */


/* ==== v3.10.0 · Kontextzeile an Momentum-Kandidaten =========================
   Der Nutzer hat CRWD in der Momentum-Liste GESEHEN — die Discovery hat also
   funktioniert. Was fehlte, war der eine Satz daneben: warum bewegt der sich
   gerade, und haengt das mit etwas zusammen, das ich schon weiss?

   `whyNow` wird im Worker bereits befuellt (Radar-Gruende + Situation-Gruende),
   stand bisher aber nur tief im Fokusfenster unter "Was hat sich geaendert?".
   Hier kommt es an die Kachel, zusammen mit dem Sektor-Rueckstand — der Zeile,
   die den Zusammenhang "NVDA laeuft, CRWD hinkt" ueberhaupt erst sichtbar macht.

   Rein additiv: liest nur vorhandene Felder, kein Score-Eingriff.           */
function momentumContext(symbol){
  const r=(stockRows||[]).find(x=>String(x.symbol||'').toUpperCase()===String(symbol||'').toUpperCase());
  if(!r) return '';
  const bits=[];
  if(r.sectorLag!=null && Number(r.sectorLeaderRet15)>=SECTOR_RUN_MIN && Number(r.sectorLag)>=SECTOR_LAG_MIN){
    bits.push(`<span class="mc-lag" title="${esc(`Der Sektor ${r.sector||'?'} läuft mit ${num(Number(r.sectorLeaderRet15),2)} % auf 15 Minuten, dieser Titel steht bei ${num(Number(r.ret15),2)} %. Rückstand ${num(Number(r.sectorLag),2)} Punkte. Grund hinzusehen, kein Kaufsignal.`)}">🧲 ${esc(r.sector||'Sektor')} läuft · ${num(Number(r.sectorLag),1)} Pkt zurück</span>`);
  }
  const why=(r.whyNow||[]).filter(Boolean).slice(0,2).join(' · ');
  if(why) bits.push(`<span class="mc-why" title="${esc('Warum jetzt: die vom Radar und der Situation Engine erkannten Auslöser. Das sind gemessene Kursereignisse, KEINE Nachrichtenmeldungen — den Nachrichtenkontext musst du selbst dazulegen.')}">❓ ${esc(why)}</span>`);
  const ft=flatexTradability(r);
  if(ft.tone!=='ok') bits.push(`<span class="mc-ft ft-${ft.tone}" title="${esc(ft.detail)}">${ft.tone==='no'?'⛔ flatex eher nicht':'❓ Handelsplatz prüfen'}</span>`);
  return bits.length?`<span class="mom-context">${bits.join('')}</span>`:'';
}




/* ==== v3.12.0 · Hoehe der festen Kopfleiste MESSEN statt raten ==============
   Drei gemeldete Fehler hatten dieselbe Ursache: In der CSS standen feste
   Pixelwerte fuer die Hoehe von Kopfzeile und Reiterleiste (62 px, 104 px,
   52 px — an vier Stellen, teils mit !important gegeneinander).

     · Das Coin-Fokusfenster stiess beim Scrollen an, weil `body` nur die
       Kopfzeile abdeckte und die 44 px der Reiterleiste in keiner Rechnung
       standen.
     · Die Reiterleiste rutschte unter den Kopf, sobald dieser umbrach — er ist
       `flex-wrap`, seine Hoehe ist also nicht konstant.
     · Sprungziele landeten hinter der Leiste, die man gerade angeklickt hatte.

   Ein ResizeObserver misst jetzt beide Elemente und schreibt die echten Werte
   in CSS-Variablen. Damit stimmt der Abstand auch bei umgebrochener Kopfzeile,
   bei anderer Schriftgroesse und auf jedem Fenster — ohne dass irgendwo eine
   Zahl gepflegt werden muss.                                                 */
function measureChrome(){
  const head=document.querySelector('body>header');
  const nav=document.querySelector('.viewbar');
  const foot=document.querySelector('.signal-banner');
  const dock=document.querySelector('.dock');   // v3.14.2: zweite feste Fussleiste
  if(!head) return;
  const h=Math.round(head.getBoundingClientRect().height||0);
  const n=nav?Math.round(nav.getBoundingClientRect().height||0):0;
  if(!h) return;   // fail-closed: nicht messbar -> Startwerte behalten
  const root=document.documentElement.style;
  root.setProperty('--fp-head-h', h+'px');
  root.setProperty('--fp-nav-h', n+'px');
  root.setProperty('--fp-chrome-h', (h+n)+'px');
  /* v3.14.0: Der Fuss fehlte. Die untere Signalleiste ist `fixed` und ihre Hoehe
     variiert mit dem Inhalt — bei aktivem Plan traegt sie zwei Zeilen. Der feste
     Startwert von 108 px war zu klein, deshalb blieb das Seitenende dauerhaft
     verdeckt. Fail-closed wie oben: nicht messbar heisst Startwert behalten.

     v3.14.2 · DERSELBE FEHLER ZUM DRITTEN MAL, EINE ETAGE TIEFER.
     Unten liegen ZWEI feste Leisten uebereinander, nicht eine: die Aktions-
     Leiste `.dock` (Titel + Plan-Knopf) sitzt auf der Signalleiste. Gemessen
     wurde nur die Signalleiste. Am Screenshot vom 27.8. nachgerechnet:
     .dock 66 px + .signal-banner 51 px = 117 px verdeckt, freigeschoben wurden
     51+14 = 65 px. Es fehlten 52 px — genau die halb sichtbare Zeile
     „Kaufsumme / Entry / Stop-Loss\" am Ende der Fokuskarte.
     Der Fehler zeigt sich NUR bei aktivem Plan; ohne Auswahl ist .dock
     ausgeblendet und die Rechnung aus v3.14.0 stimmt. Deshalb sah der Fix
     funktionierend aus und versagte genau im Arbeitsfall.
     Zwei Variablen statt einer:
       --fp-banner-h = nur die Signalleiste (Bezugspunkt fuer `.dock{bottom}`)
       --fp-foot-h   = Signalleiste + Dock (Bezugspunkt fuer body padding-bottom)
     Ein ausgeblendetes Dock misst 0 und ist KEIN Messfehler — dann ist der Fuss
     korrekt nur die Signalleiste. Fail-closed gilt fuer die Signalleiste. */
  const f=foot?Math.round(foot.getBoundingClientRect().height||0):0;
  if(f){
    root.setProperty('--fp-banner-h', f+'px');
    const d=dock?Math.round(dock.getBoundingClientRect().height||0):0;
    root.setProperty('--fp-foot-h', (f+d)+'px');
  }
}
if(typeof ResizeObserver==='function'){
  const ro=new ResizeObserver(()=>measureChrome());
  const attach=()=>{
    const head=document.querySelector('body>header'), nav=document.querySelector('.viewbar');
    const foot=document.querySelector('.signal-banner');
    const dock=document.querySelector('.dock');
    if(head) ro.observe(head);
    if(nav) ro.observe(nav);
    if(foot) ro.observe(foot);   // v3.14.0: der Fuss aendert seine Hoehe mit dem Plan
    if(dock) ro.observe(dock);   // v3.14.2: .dock erscheint/verschwindet mit der Auswahl
    measureChrome();
  };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',attach,{once:true});
  else attach();
}
/* Defensiv: Der Testrahmen stellt nur ein Teil-`window` bereit, und ein
   fehlendes addEventListener darf das gesamte Skript nicht abbrechen lassen. */
if(typeof window!=='undefined' && typeof window.addEventListener==='function'){
  window.addEventListener('resize',measureChrome,{passive:true});
  window.addEventListener('orientationchange',()=>setTimeout(measureChrome,120),{passive:true});
}

/* ==== v3.11.0 · Quartalszahlen-Tafel nach Sektor ============================
   Wunsch: eine Liste vorausgewaehlter interessanter Aktien mit den nach
   Boersenschluss anstehenden Quartalszahlen, geordnet nach Sektor.

   BEWUSSTE BESCHRAENKUNG, damit die Tafel nicht mehr behauptet als sie weiss:
   Sie zeigt nur Titel, die FusionPulse tatsaechlich analysiert hat. Nur fuer
   die gibt es einen verifizierten Sektor — und ein Termin ohne Sektor waere in
   einer nach Sektoren geordneten Liste wertlos. „Vorausgewaehlt" heisst hier
   also: Favoriten, Radar-Kandidaten und Katalogtitel des laufenden Scans.

   Die automatische Quelle (Twelve Data `earnings_calendar`) ist im Basic-Tarif
   moeglicherweise nicht enthalten. Wenn sie nichts liefert, sagt die Tafel das
   ausdruecklich und zeigt weiterhin die manuell gepflegten Termine, statt leer
   und unerklaert dazustehen.

   Reine Terminliste: 0 % Gewicht in Score und Kauf-Freigabe.                 */
function renderEarningsBoard(){
  const el=$('#earningsBoard'); if(!el) return;
  const head=`<div class="ophead"><b>📅 Quartalszahlen · nach Sektor</b>`
    +`<span title="Anstehende Termine der Titel, die FusionPulse gerade analysiert. „nB“ = nach Börsenschluss, „vB“ = vor Börsenbeginn. Ein Termin ist keine Richtungsaussage — der Kurs kann danach in beide Richtungen weit laufen.">nächste 14 Tage · beobachtete Titel</span>`
    +`<small>Terminliste · 0 % BUY-Gewicht</small></div>`;

  if(!earnData){ el.innerHTML=head+'<span class="hint">Terminkalender wird geladen.</span>'; return; }

  const known=new Map((stockRows||[]).map(r=>[String(r.symbol||'').toUpperCase(),r]));
  const seen=new Map();
  for(const src of [earnData.manual||[], earnData.auto||[]]){
    for(const e of src){
      const sym=String(e?.symbol||'').toUpperCase();
      if(!sym || !known.has(sym) || seen.has(sym)) continue;   // manuell schlaegt automatisch
      const info=earningsFor(sym); if(!info) continue;          // nutzt dieselbe 0..14-Tage-Logik
      seen.set(sym,{...info, row:known.get(sym), manual:src===(earnData.manual||[])});
    }
  }

  if(!seen.size){
    const why = earnData.state==='nokey'
      ? 'Kein Twelve-Data-Schlüssel hinterlegt. Es werden ausschließlich manuell eingetragene Termine angezeigt — bisher keine.'
      : earnData.state==='empty'
      ? 'Der Terminkalender hat geantwortet, aber keine verwertbaren Termine geliefert. Möglicherweise ist er im gebuchten Tarif nicht enthalten. Manuell eingetragene Termine erscheinen hier weiterhin.'
      : earnData.state==='stale' || earnData.state==='unavailable'
      ? 'Der Terminkalender war zuletzt nicht erreichbar. Es wird bewusst nichts geschätzt.'
      : 'Für die aktuell beobachteten Titel steht in den nächsten 14 Tagen kein Termin an.';
    el.innerHTML=head+`<span class="hint">${esc(why)}</span>`; return;
  }

  const bySector=new Map();
  for(const e of seen.values()){
    const sec=e.row?.sector && e.row.sector!=='Discovery' ? e.row.sector : 'Sektor nicht verifiziert';
    const a=bySector.get(sec)||[]; a.push(e); bySector.set(sec,a);
  }
  // Sektoren mit dem naechstliegenden Termin zuerst — was zuerst kommt, steht oben.
  const sectors=[...bySector.entries()]
    .map(([sec,list])=>[sec,list.sort((a,b)=>a.days-b.days||String(a.symbol).localeCompare(String(b.symbol)))])
    .sort((a,b)=>a[1][0].days-b[1][0].days);

  el.innerHTML=head+sectors.map(([sec,list])=>
    `<div class="earn-sector"><b class="earn-sec-name">${esc(sec)}<i>${list.length}</i></b><div class="earn-rows">`
    +list.map(e=>{
      const ft=flatexTradability(e.row);
      const when=e.days===0?'heute':e.days===1?'morgen':`in ${e.days} T`;
      const slot=e.amc?'nB':'vB';
      return `<button type="button" class="earn-row${e.days<=1?' soon':''}" data-openstock="${esc(e.symbol)}" `
        +`title="${esc(`${e.symbol} · Quartalszahlen am ${e.date} ${e.amc?'nach Börsenschluss':'vor Börsenbeginn'}, also ${when}. Quelle: ${e.manual?'von dir manuell eingetragen':'automatischer Terminkalender'}. Der Kurs kann danach in BEIDE Richtungen weit laufen — der Termin sagt nichts über die Richtung. Diese Liste verändert weder Score noch Kauf-Freigabe. Vor einer Order gegenprüfen, Unternehmen verschieben Termine gelegentlich.`)}">`
        +`<b>${esc(e.symbol)}${isFavStock(e.symbol)?' ★':''}</b>`
        +`<span class="earn-when">${esc(when)} · ${slot}</span>`
        +`<span class="earn-date">${esc(e.date)}</span>`
        +`<span class="earn-src${e.manual?' manual':''}" title="${esc(e.manual?'Von dir manuell eingetragen.':'Aus dem automatischen Terminkalender.')}">${e.manual?'✎':'⟳'}</span>`
        +`<span class="earn-ft ft-${ft.tone}" title="${esc(ft.detail)}">${ft.tone==='ok'?'🏦':ft.tone==='no'?'⛔':'❓'}</span>`
        +`</button>`;
    }).join('')+'</div></div>').join('')
    +`<small class="hint">„nB“ = nach Börsenschluss, „vB“ = vor Börsenbeginn. Ein Termin ist keine Richtungsaussage. Eine Position über die Zahlen zu halten ist eine andere Entscheidung als der hier bewertete Intraday-Plan.</small>`;

  el.querySelectorAll('[data-openstock]').forEach(b=>b.addEventListener('click',()=>{
    focusStock=b.dataset.openstock||''; renderStocks();
    document.querySelector('.stockstage')?.scrollIntoView({behavior:'smooth',block:'start'});
  }));
}

/* ==== v3.11.0 · Aufmerksamkeitsimpuls =======================================
   Wunsch: Empfehlungen dieser Art sollen blinkend hervorgehoben werden.

   Umgesetzt, aber mit einer harten Einschraenkung, weil ein Dauerblinken die
   eigene Wirkung zerstoert: Wenn bei jedem Scan sechs Karten blinken, ist das
   nach zwei Minuten Tapete und der Nutzer sieht darueber hinweg. Der Impuls ist
   nur so viel wert, wie er selten ist.

   Deshalb pulsiert ausschliesslich der STAERKSTE NEUE Nachzuegler:
     - „neu"      = dieses Symbol hat in dieser Sitzung noch nicht pulsiert
     - „staerkste" = groesster Rueckstand des aktuellen Durchlaufs
     - einmalig   = nach PULSE_MS ist Schluss, kein Dauerzustand
   Ein Titel, der seit zwanzig Minuten hinterherhinkt, ist keine Neuigkeit mehr.

   `prefers-reduced-motion` gewinnt IMMER — das ist eine Systemeinstellung des
   Nutzers und keine Empfehlung. Zusaetzlich abschaltbar in den Einstellungen.  */
const PULSE_MS = 24_000;
const pulsedLaggards = new Set();   // pro Sitzung, absichtlich nicht persistiert
function markAttention(sym){
  if(S.attentionPulse === false) return '';
  if(!sym || pulsedLaggards.has(sym)) return '';
  pulsedLaggards.add(sym);
  setTimeout(()=>{ document.querySelectorAll(`.pulse-new[data-openstock="${CSS.escape(sym)}"]`)
    .forEach(el=>el.classList.remove('pulse-new')); }, PULSE_MS);
  return ' pulse-new';
}

/* ==== v3.10.0 · Sektor-Nachzuegler ==========================================
   Anlass ist ein realer Trade des Nutzers: Nach starken NVDA-Zahlen lief die
   Halbleiter-/Security-Nachbarschaft an. CRWD hinkte noch hinterher und war
   genau deshalb der Kandidat. Die App hat den Titel zwar in der Momentum-Liste
   gezeigt — aber ohne den einen Hinweis, der die Sache erklaert haette.

   Die Kachel beantwortet nicht "kaufen ja/nein", sondern "wo lohnt der Blick
   JETZT". Zwei Bedingungen muessen zusammenkommen:
     1. Der Sektor laeuft   (Anfuehrer mindestens SECTOR_RUN_MIN Prozent auf 15 Min)
     2. Der Titel hinkt     (Rueckstand mindestens SECTOR_LAG_MIN Prozentpunkte)
   Ein Rueckstand in einem stehenden Sektor ist bedeutungslos — deshalb Punkt 1.

   Reine Discovery: 0 % BUY-Gewicht, kein Score-Eingriff, keine API-Abfrage.
   Die Werte liegen im laufenden Scan bereits vor.                           */
const SECTOR_RUN_MIN = 0.8;   // % auf 15 Min, ab wann ein Sektor als "laufend" gilt
const SECTOR_LAG_MIN = 0.6;   // Prozentpunkte Rueckstand, ab wann es auffaellt
function renderSectorLaggards(){
  const el=$('#sectorLaggards'); if(!el) return;
  const head=`<div class="ophead"><b>🧲 Sektor-Nachzügler</b>`
    +`<span title="Der Sektor läuft bereits, dieser Titel noch nicht. Genau diese Konstellation war der CRWD-Fall nach den NVDA-Zahlen. Der Rückstand ist ein Grund hinzusehen, kein Kaufgrund — ein Titel kann auch zurückbleiben, weil er zu Recht zurückbleibt.">Sektor läuft, Titel hinkt noch — Grund hinzusehen, kein Kaufsignal</span>`
    +`<small>Discovery · 0 % BUY-Gewicht</small>${categoryFreshness(stockMeta.ts)}</div>`;

  const rows=(stockRows||[]).filter(r=>
    r.sectorLag!=null && r.sectorLeaderRet15!=null &&
    Number(r.sectorLeaderRet15)>=SECTOR_RUN_MIN &&
    Number(r.sectorLag)>=SECTOR_LAG_MIN);
  if(!rows.length){
    const why=(stockRows||[]).some(r=>r.sectorLag!=null)
      ? 'Kein Sektor läuft gerade deutlich genug, oder kein Titel hinkt messbar hinterher.'
      : 'Noch keine Sektor-Vergleichswerte im aktuellen Scan. Es wird bewusst nichts geschätzt.';
    el.innerHTML=head+`<span class="hint">${esc(why)}</span>`; return;
  }
  const cand=rows.sort((a,b)=>Number(b.sectorLag)-Number(a.sectorLag)).slice(0,6);
  // Nur der erste Eintrag ist der staerkste Rueckstand — nur er darf pulsieren.
  const pulseSym=cand[0]?.symbol||'';
  el.innerHTML=head+`<div class="opgrid">${cand.map((r,ix)=>{
    const lag=Number(r.sectorLag), lead=Number(r.sectorLeaderRet15), own=Number(r.ret15);
    const pulse=(ix===0 && r.symbol===pulseSym)?markAttention(r.symbol):'';
    const ft=flatexTradability(r);
    const why=(r.whyNow||[]).slice(0,2).join(' · ');
    return `<button type="button" class="opcard ${r.light} lag-card${pulse}" data-openstock="${esc(r.symbol)}" `
      +`title="${esc(`${r.symbol}: Der Sektor ${r.sector||'?'} läuft mit ${num(lead,2)} % auf 15 Minuten, dieser Titel steht bei ${num(own,2)} %. Rückstand ${num(lag,2)} Punkte über ${r.sectorPeers||0} Vergleichstitel. Das ist ein Grund hinzusehen und ausdrücklich kein Kaufsignal — der Titel kann auch zu Recht zurückbleiben. Klick öffnet ihn im Fokusfenster.`)}">`
      +`<b>${esc(r.symbol)}</b>`
      +`<span class="lag-gap" title="Rückstand auf den Sektor-Anführer in Prozentpunkten.">↑ ${num(lag,1)} Pkt Rückstand</span>`
      +`<span title="Sektor-Anführer gegen diesen Titel, jeweils 15-Minuten-Bewegung.">${esc(r.sector||'?')} ${num(lead,1)}% / hier ${num(own,1)}%</span>`
      +`<span class="lag-flatex ft-${ft.tone}" title="${esc(ft.detail)}">${ft.tone==='ok'?'🏦 handelbar':ft.tone==='no'?'⛔ bei flatex eher nicht':'❓ Verfügbarkeit prüfen'}</span>`
      +`<em>${esc(why||r.setup||'Beobachten')}</em></button>`;
  }).join('')}</div>`
  +`<small class="hint">Rückstand heißt: der Sektor bewegt sich, dieser Titel noch nicht. Ob er nachzieht oder zu Recht zurückbleibt, entscheidet die Nachrichtenlage — nicht diese Kennzahl.</small>`;
  el.querySelectorAll('[data-openstock]').forEach(b=>b.addEventListener('click',()=>{
    focusStock=b.dataset.openstock||''; renderStocks();
    document.querySelector('.stockstage')?.scrollIntoView({behavior:'smooth',block:'start'});
  }));
}

/* ==== v3.9.2 · Krypto-Mover (Gegenstueck zur Aktien-Discovery) ==============
   Der Nutzer fragte nach einer Premarket-Kachel fuer Coins. Die gibt es nicht
   und kann es nicht geben: Krypto handelt durchgehend, es existiert weder eine
   Eroeffnung noch eine Vorboerse. Ein Feld "Veraenderung 24 h" liefert der
   Scan ebenfalls NICHT — die Analyse arbeitet auf rund 82 Fuenfminutenbalken.

   Statt eine 24-Stunden-Zahl zu erfinden, zeigt die Kachel exakt das, was
   tatsaechlich gemessen wird: ret60 (letzte Stunde), ret15 als Beschleunigung
   und das relative Volumen. Der Titel sagt den Zeitraum ausdruecklich dazu.
   Reine Discovery, 0 % BUY-Gewicht, keine zusaetzliche API-Abfrage — die Werte
   liegen im laufenden Scan bereits vor.                                     */
function renderCryptoMovers(){
  const el=$('#cryptoMovers'); if(!el) return;
  const head=`<div class="ophead"><b>⚡ Krypto-Mover · letzte Stunde</b>`
    +`<span title="Krypto handelt durchgehend — es gibt weder Eroeffnung noch Premarket. Deshalb misst diese Kachel die Bewegung der letzten 60 Minuten aus dem laufenden Scan, statt eine 24-Stunden-Zahl auszuweisen, die der Datensatz gar nicht enthaelt.">gemessene 60-Minuten-Bewegung · kein Premarket-Aequivalent</span>`
    +`<small>Discovery · 0 % BUY-Gewicht</small>${categoryFreshness(meta.ts)}</div>`;
  const cand=(rows||[])
    .filter(r=>Number.isFinite(Number(r.ret60)))
    .sort((a,b)=>Math.abs(Number(b.ret60))-Math.abs(Number(a.ret60)))
    .slice(0,6);
  if(!cand.length){ el.innerHTML=head+'<span class="hint">Noch keine belastbare 60-Minuten-Bewegung im aktuellen Scan. Es wird bewusst kein Ersatzwert geschaetzt.</span>'; return; }
  el.innerHTML=head+`<div class="opgrid">${cand.map(r=>{
    const m=Number(r.ret60), acc=Number(r.ret15);
    return `<button type="button" class="opcard ${r.light} ${m>=0?'move-up':'move-down'}" data-opencoin="${esc(r.pair)}" title="${esc(sym(r.pair)+' im Fokusfenster oeffnen. Bewegung der letzten 60 Minuten aus dem laufenden Scan. Discovery-Anzeige — sie veraendert weder Score noch Kauf-Freigabe.')}">`
      +`<b>${esc(sym(r.pair))}</b>`
      +`<span class="trend-pct ${m>=0?'up':'down'}">${m>=0?'+':''}${num(m,2)}% / 60m</span>`
      +`<span class="${Number.isFinite(acc)?'trend-pct '+(acc>=0?'up':'down'):''}" title="Bewegung der letzten 15 Minuten — zeigt, ob die Stunde gerade beschleunigt oder ausläuft.">${Number.isFinite(acc)?'Speed '+(acc>=0?'+':'')+num(acc,2)+'%':'Speed n.v.'}</span>`
      +`<span title="Relatives Volumen gegen den eigenen Durchschnitt.">RV ${Number.isFinite(Number(r.relVol))?num(r.relVol,1)+'×':'n.v.'}</span>`
      +`<em>${esc(r.setup||'Beobachten')}</em></button>`;
  }).join('')}</div>`;
  el.querySelectorAll('[data-opencoin]').forEach(b=>b.addEventListener('click',()=>{
    selected=b.dataset.opencoin; pinned=true; render();
    document.querySelector('.stage')?.scrollIntoView({behavior:'smooth',block:'start'});
  }));
}

function render() {
  (rows||[]).forEach(claudeOverlayRow); // Claude-Modus-Ansicht idempotent anwenden
  if (!pinned || !rows.some((r) => r.pair === selected)) {
    const best = rows.find((r) => r.light === 'green') || rows.find((r) => r.light === 'yellow') || rows[0];
    selected = best?.pair ?? null;
    if (pinned && !rows.some((r) => r.pair === selected)) pinned = false;
  }
  const reg = $('#regime');
  reg.textContent = `${meta.marketRegime || '–'} · ${Math.round((meta.breadth || 0) * 100)} % über VWAP`;
  /* v3.7.0: Klarstellung, weil das oft als „Marktstimmung" gelesen wird — es ist
     Marktbreite. Stimmung steht seit 3.7.0 getrennt in der Fear-&-Greed-Kachel. */
  reg.dataset.tip = 'Marktregime = MARKTBREITE, nicht Stimmung. Risk-On heißt: ein Großteil der gescannten Titel liegt über seinem volumengewichteten Durchschnittspreis (VWAP), die Marktstruktur ist breit positiv. Risk-Off heißt das Gegenteil. Der Prozentwert nennt den Anteil.\n\nWICHTIG: Das misst, was Kurse TUN — nicht, was Marktteilnehmer FÜHLEN. Die Stimmung steht getrennt in der Kachel „Krypto-Stimmung" (Fear & Greed).\n\nGrundlage ist eine Stichprobe der gescannten Titel, kein Marktindex. Marktfilter, kein eigenständiges Kaufsignal.';
  reg.removeAttribute('title');
  reg.className = 'regime-btn '+(meta.marketRegime || '').toLowerCase().replace('-', '');
  const rex=$('#regimeExplain'); if(rex && !rex.classList.contains('hidden')) rex.innerHTML=regimeExplanation();
  renderCryptoMovers();

  renderFocus();
  renderMap();
  renderList();
  if ($('#modal').classList.contains('open')) refreshDetail();
}

function select(pair, byUser) {
  selected = pair;
  if (byUser) pinned = true;
  renderFocus(); renderMap(); renderList();
  rowNodes.get(pair)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function step(dir) {
  const list = [...visible()];
  const i = list.findIndex((r) => r.pair === selected);
  const n = list[Math.max(0, Math.min(list.length - 1, i + dir))];
  if (n) select(n.pair, true);
}

/* -------------------------------------------------------------- Detail-View */
let detailPair = null;
function openDetail(pair) { detailPair = pair; $('#modal').classList.add('open'); refreshDetail(); }
function closeDetail() { detailPair = null; $('#modal').classList.remove('open'); }

function factor(label, v, invert = false, active = true, tip = '') {
  const ok=v!=null && Number.isFinite(Number(v)), n=ok?Number(v):0, good = invert ? 10 - n : n;
  return `<div class="factor${active && ok ? '' : ' off'}" title="${esc(tip)}"><span>${label}${active && ok ? '' : ' <em>(n.v.)</em>'}</span>
    <div class="fbar"><i style="width:${active && ok ? n * 10 : 0}%;background:hsl(${8 + good * 12} 78% 52%)"></i></div><b>${active && ok ? n.toFixed(1) : '–'}</b></div>`;
}

function refreshDetail() {
  const r = rows.find((x) => x.pair === detailPair);
  if (!r) return;
  const on = new Set(r.components || S.components);
  $('#detail').innerHTML = `
    <header class="dhead ${r.light}">
      <div><h2>${sym(r.pair)}</h2><p>${esc(r.regime)} · ${esc(r.setup)} · seit ${mins(r._age)} (${r._streak || 1} Bestätigungen)</p></div>
      <div class="dscore"><b>${r.quality}</b><span>Qualität</span></div>
      <div class="dscore"><b>${r.executability}</b><span>Handelbarkeit</span></div>
    </header>
    <h3>Intraday-Kurs</h3><div class="intraday-chart coin-intraday"><span>Kurzfristiger Verlauf</span>${spark(r.spark,520,92)}</div>
    <h3>Faktoren (abgeschaltete Verfahren gehen nicht in den Score ein)</h3>
    ${factor('Multi-Timeframe', r.mtf, false, on.has('mtf'), 'Übereinstimmung von 5-Minuten-, 15-Minuten- und Stundenbild.')}
    ${factor('Volumen-Beschleunigung', r.volumeAcceleration, false, on.has('volume'), 'z-Score des jüngsten Volumens gegen ein disjunktes Basisfenster.')}
    ${factor('Relative Stärke (BTC)', r.relativeStrength, false, on.has('rs'), 'Volatilitätsnormierte Entwicklung gegenüber Bitcoin.')}
    ${factor('Kompression / Squeeze', r.compression, false, on.has('squeeze'), 'Enge der Bollinger-Bandbreite gegenüber dem eigenen Median.')}
    ${factor('Trendqualität (EMA)', r.trendQuality, false, on.has('ema21'), 'EMA-Staffelung 9/21/50 plus Bestimmtheitsmaß der Regression.')}
    ${factor('Orderbuch-Druck', r.bookScore, false, on.has('book'), 'Notional-Übergewicht der Bid-Seite im ±0,5-%-Fenster.')}
    ${factor('Liquidität', r.liquidity, false, on.has('book'), 'Spread und verfügbare Tiefe bis 0,15 % Preisbewegung.')}
    ${factor('Elliott-Wellen', r.elliott, false, on.has('elliott'), 'Impuls-/Korrekturstruktur, höhere Tiefs, Fibonacci-Nähe des Rücksetzers.')}
    ${factor('Erschöpfung', r.exhaustion, true, true, 'Dochte, Klimaxvolumen, RSI und VWAP-Abstand. Hoch ist schlecht; wirkt immer.')}
    <h3>Mikrostruktur</h3>
    <div class="metrics">
      <div class="metric">Spread<b>${r.spreadPct != null ? (r.spreadPct * 100).toFixed(3) + ' %' : '–'}</b></div>
      <div class="metric">Slippage 2k€<b>${r.slipBps != null ? r.slipBps + ' bps' : '–'}</b></div>
      <div class="metric">Kauftiefe ≤0,15 %<b>${r.buyCapacity != null ? eur(r.buyCapacity, 0) : '–'}</b></div>
      <div class="metric">Ausstiegstiefe<b>${r.sellCapacity != null ? eur(r.sellCapacity, 0) : '–'}</b></div>
      <div class="metric">Imbalance<b>${r.imbalance > 0 ? '+' : ''}${(r.imbalance * 100).toFixed(0)} %</b></div>
      <div class="metric">VWAP-Abstand<b>${r.vwapDev} ATR</b></div>
      <div class="metric">RSI(14)<b>${r.rsi}</b></div>
      <div class="metric">ATR<b>${r.atrPct} %</b></div>
    </div>
    <h3>Ziel-Herkunft</h3>
    <p class="hint">TP2 aus: <b>${esc(r.tp2Source)}</b> · Stop/Kosten-Deckung <b>${r.costRatio}×</b> · aktive Verfahren <b>${[...on].join(', ')}</b></p>
    <div class="journalbox">
      <button id="jlog">In Journal eintragen</button>
      <small>Lokal im Browser. Kein Auto-Trading — die Order setzt du in Bitpanda selbst.</small>
    </div>`;
  $('#jlog').onclick = () => logTrade(r);
}

/* --------------------------------------------------------------- Journal */
function logTrade(r) {
  const s = sizing(r);
  const j = JSON.parse(localStorage.getItem('fp.journal') || '[]');
  j.unshift({
    ts: Date.now(), pair: r.pair, setup: r.setup, regime: r.regime, market: meta.marketRegime,
    entry: r.entry, stop: r.stop, tp1: r.tp1, tp2: r.tp2,
    quality: r.quality, executability: r.executability, premove: r.premove, crv: r.netCRV,
    mtf: r.mtf, vol: r.volumeAcceleration, rs: r.relativeStrength, comp: r.compression,
    liq: r.liquidity, book: r.bookScore, exh: r.exhaustion, costRatio: r.costRatio,
    elliott: r.elliott, components: (r.components || []).join('+'),
    ageMin: Math.round(r._age / 60000), streak: r._streak || 1, notional: s?.notional ?? null,
    version: FP_VERSION,
  });
  localStorage.setItem('fp.journal', JSON.stringify(j.slice(0, 500)));
  $('#jlog').textContent = '✓ eingetragen';
}

function exportJournal() {
  const j = JSON.parse(localStorage.getItem('fp.journal') || '[]');
  if (!j.length) return;
  const cols = Object.keys(j[0]);
  const csv = [cols.join(';'), ...j.map((r) => cols.map((c) => r[c]).join(';'))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `fusionpulse-journal-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

/* ------------------------------------------------------- Bar-Close-Uhr */
setInterval(() => {
  const s = 300 - Math.floor((Date.now() / 1000) % 300);
  const el = $('#barclock');
  el.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  el.classList.toggle('soon', s <= 30);
}, 1000);

/* ------------------------------------------------------------ Einstellungen */
function openSettings() {
  if ($('#sTradeMode')) $('#sTradeMode').value = S.tradeMode || DEFAULTS.tradeMode;
  if ($('#sSizeMode')) $('#sSizeMode').value = S.sizeMode || DEFAULTS.sizeMode;
  if ($('#sFixedTrade')) $('#sFixedTrade').value = S.fixedTradeEur ?? DEFAULTS.fixedTradeEur;
  if ($('#sMaxLoss')) $('#sMaxLoss').value = S.maxLossEur ?? DEFAULTS.maxLossEur;
  renderSizeModeHint();
  $('#sEquity').value = S.equity; $('#sRisk').value = S.riskPct; $('#sMaxTrade').value = S.maxTradeEur; $('#sMinCrvCoin').value = S.minCrvCoin; $('#sMinCrvStock').value = S.minCrvStock; $('#sMinNetProfit').value = S.minNetProfitStock; $('#sMinTp2Pct').value = S.minTp2PctStock;
  $('#sDeep').value = S.deep; $('#sCoinCount').value = S.coinCount; $('#sStockCount').value = S.stockCount;
  $('#sStockDeep').value = S.stockDeep || DEFAULTS.stockDeep;
  $('#sWatch').value = S.watch; $('#sToken').value = S.token; $('#sMin').value = S.minQ;
  $('#sZone').checked = S.onlyZone; $('#sTheme').value = S.theme;
  if($('#sPulse')) $('#sPulse').checked = S.attentionPulse !== false;
  $('#sTax').value = S.taxPct; $('#sMode').value = S.analysisMode;
  $('#sStockSound').checked = !!S.stockSound;
  if ($('#sClaudeMode')) $('#sClaudeMode').checked = !!S.claudeMode;
  if ($('#sPortfolioRisk')) $('#sPortfolioRisk').value = S.portfolioRiskPct ?? DEFAULTS.portfolioRiskPct;
  if ($('#sPortfolioGuard')) $('#sPortfolioGuard').checked = !!S.portfolioGuard;
  if ($('#sCrowdLimit')) $('#sCrowdLimit').value = S.crowdSymbolLimit ?? DEFAULTS.crowdSymbolLimit;
  /* Der Hinweis muss sofort mitrechnen, sonst sieht der Nutzer die Konsequenz
     seiner Eingabe erst nach dem Speichern — also genau dann nicht, wenn er sie
     zum Abwaegen braucht. Live gegen die Feldwerte, nicht gegen S. */
  for (const id of ['#sSizeMode', '#sFixedTrade', '#sEquity', '#sRisk', '#sMaxTrade', '#sOrderFee', '#sVenueFriction']) {
    const f = $(id);
    if (f && !f.dataset.hintBound) {
      f.dataset.hintBound = '1';
      f.addEventListener('input', () => {
        const prev = { sizeMode: S.sizeMode, fixedTradeEur: S.fixedTradeEur, equity: S.equity, riskPct: S.riskPct, maxTradeEur: S.maxTradeEur, orderFeeEur: S.orderFeeEur, venueFrictionPct: S.venueFrictionPct };
        S.sizeMode = String($('#sSizeMode')?.value || S.sizeMode);
        S.fixedTradeEur = +$('#sFixedTrade')?.value || S.fixedTradeEur;
        S.equity = +$('#sEquity')?.value || S.equity;
        S.riskPct = +$('#sRisk')?.value || S.riskPct;
        S.maxTradeEur = +$('#sMaxTrade')?.value || S.maxTradeEur;
        /* `+undefined` ist NaN, nicht undefined — `??` wuerde hier NICHT greifen
           und NaN in die Anzeige tragen. Deshalb explizit auf Endlichkeit pruefen. */
        const numOr = (id, fallback) => { const v = Number($(id)?.value); return Number.isFinite(v) ? v : fallback; };
        S.orderFeeEur = numOr('#sOrderFee', S.orderFeeEur);
        S.venueFrictionPct = numOr('#sVenueFriction', S.venueFrictionPct);
        try { renderSizeModeHint(); } finally { Object.assign(S, prev); }
      });
    }
  }
  if ($('#sOrderFee')) $('#sOrderFee').value = S.orderFeeEur ?? DEFAULTS.orderFeeEur;
  if ($('#sVenueFriction')) $('#sVenueFriction').value = S.venueFrictionPct ?? DEFAULTS.venueFrictionPct;
  $$('#sComponents input[data-comp]').forEach((c) => { c.checked = S.components.includes(c.dataset.comp); });
  updateCountsInfo();
  loadTiingoQuota();
  renderGlossary();
  const gq=$('#glossarySearch');
  if(gq && !gq.dataset.bound){ gq.dataset.bound='1'; gq.addEventListener('input',()=>{glossQuery=gq.value||'';renderGlossary();}); }
  $('#settings').classList.add('open');
}
function updateCountsInfo() {
  const el = $('#sCountsInfo'); if (!el) return;
  el.innerHTML = `Zuletzt: <b>${meta.deepCount ?? '–'}</b> Coins gescannt von <b>${meta.universe ?? '–'}</b> verfügbaren EUR-Paaren · `
    + `<b>${stockMeta.scanned ?? stockRows.length}</b> Aktien analysiert von <b>${stockMeta.universe ?? 21}</b> im Universum. `
    + 'Gescannt und angezeigt sind bewusst getrennt: die Anzeige zu verkleinern spart keine API-Abfragen.';
}

function analysisMethodsText(){
  const labels={vwap:'VWAP',ema21:'EMA/Trend',rs:'Relative Stärke',mtf:'Momentum/MTF',volume:'RVOL/Volumen',book:'Orderbuch',squeeze:'Squeeze',pullback:'Pullback',elliott:'Elliott/Fibonacci'};
  // Immer aktive Aktien-Sicherheits-/Discovery-Methoden plus die explizit gewählten Komponenten.
  const core=['Situation Engine','ATR','CRV/Execution','Spread/Liquidität'];
  const base=[...new Set([...core,...(S.components||[]).map(x=>labels[x]||x)])].join(' · ');
  return (S.claudeMode?'🤖 CLAUDE MODUS (EV-basiert, unverändert) · ':'⚡ FUSIONPULSE ADAPTIV · ')+base;
}
/** Erklärt die aktuell wirksamen BUY-Gates; im Claude-Modus die EV-basierten. */
function buyGateHint(r){
  if(S.claudeMode&&r?.claude){
    const riskEur=S.equity*(S.riskPct/100);
    return `BUY (Claude): Score ≥${CLAUDE_MIN_SCORE_STOCK}, Plan-CRV ≥${num(CLAUDE_MIN_CRV_STOCK,1)}:1 netto, Plan netto ≥${eur(claudeMinNetEur(riskEur),0)} (1,2× Risikobudget), Erwartungswert ≥ +0,15R, Struktur-TP2.`;
  }
  const sz=stockSizing(r),minNet=fusionMinNetEur(sz);
  return `BUY (FusionPulse Adaptiv): Score ≥${num(FUSION_MIN_SCORE_STOCK,1)}, Struktur-CRV ≥${num(S.minCrvStock,1)}:1, 50/50-Plan-Effizienz ≥${num(FUSION_MIN_PLAN_EFFICIENCY,2)}:1, Plan netto ≥${eur(minNet,0)} (kalibriert auf ${num(FUSION_MIN_NET_RISK_MULT,2)}× Risikobudget), Kursweg ≥${num(S.minTp2PctStock,1)}%.`;
}
function renderAnalysisMethods(){
  const text=analysisMethodsText();
  const el=$('#analysisMethods'); if(el)el.textContent=text;
  const dock=$('#analysisMethodsDock'); if(dock)dock.textContent=text;
}
function applySettings() {
  const prevAnalysis = S.analysisMode + '|' + S.components.join(',') + '|' + S.minCrvStock;
  S.equity = +$('#sEquity').value || DEFAULTS.equity;
  S.riskPct = +$('#sRisk').value || DEFAULTS.riskPct;
  S.maxTradeEur = Math.max(100, +$('#sMaxTrade').value || DEFAULTS.maxTradeEur);
  /* v3.9.0 · Sizing-Modell und Handelsmodus. Unbekannte Werte fallen auf den
     Default zurueck, damit ein manipulierter localStorage nicht in einen
     undefinierten Zustand fuehrt (fail-closed auf 'unveraendertes Verhalten'). */
  const smRaw = String($('#sSizeMode')?.value || DEFAULTS.sizeMode);
  S.sizeMode = (smRaw === 'fixed' || smRaw === 'risk') ? smRaw : DEFAULTS.sizeMode;
  const tmRaw = String($('#sTradeMode')?.value || DEFAULTS.tradeMode);
  const tmNew = (tmRaw === 'A' || tmRaw === 'off') ? tmRaw : DEFAULTS.tradeMode;
  /* v3.14.0: Sobald der Nutzer den Modus SELBST setzt, ist die Wahl bewusst und
     darf von keiner kuenftigen Migration mehr ueberschrieben werden. */
  if(tmNew !== S.tradeMode) S.tradeModeChosen = true;
  S.tradeMode = tmNew;
  S.fixedTradeEur = Math.max(100, +$('#sFixedTrade')?.value || DEFAULTS.fixedTradeEur);
  S.maxLossEur = Math.max(0, +$('#sMaxLoss')?.value || 0);
  S.minCrvCoin = Math.max(1, +$('#sMinCrvCoin').value || DEFAULTS.minCrvCoin);
  S.minCrvStock = Math.max(1, +$('#sMinCrvStock').value || DEFAULTS.minCrvStock);
  S.minNetProfitStock = Math.max(0, +$('#sMinNetProfit').value || 0);
  S.minTp2PctStock = Math.max(0, +$('#sMinTp2Pct').value || 0);
  S.deep = Math.min(20, Math.max(4, +$('#sDeep').value || DEFAULTS.deep));
  S.coinCount = Math.min(50, Math.max(3, +$('#sCoinCount').value || DEFAULTS.coinCount));
  S.stockCount = Math.min(50, Math.max(3, +$('#sStockCount').value || DEFAULTS.stockCount));
  const prevStockDeep = S.stockDeep || DEFAULTS.stockDeep;
  S.stockDeep = Math.min(40, Math.max(15, +$('#sStockDeep').value || DEFAULTS.stockDeep));
  S.watch = $('#sWatch').value.toUpperCase().replace(/\s/g, '');
  S.token = $('#sToken').value.trim();
  S.minQ = +$('#sMin').value || 0;
  S.onlyZone = $('#sZone').checked;
  if($('#sPulse')) S.attentionPulse = $('#sPulse').checked;
  S.theme = $('#sTheme').value;
  S.taxPct = Math.min(60, Math.max(0, +$('#sTax').value || 0));
  S.analysisMode = $('#sMode').value;
  S.stockSound = $('#sStockSound').checked;
  S.claudeMode = !!$('#sClaudeMode')?.checked; // reine Client-/Anzeige-Umschaltung, kostet keine API-Credits
  // v3.5.9: Gesamtbudget mindestens ein Einzeltrade-Risiko, sonst waere sofort alles gesperrt.
  S.portfolioRiskPct = Math.min(20, Math.max(Number(S.riskPct||0), +$('#sPortfolioRisk')?.value || DEFAULTS.portfolioRiskPct));
  S.portfolioGuard = !!$('#sPortfolioGuard')?.checked;
  S.crowdSymbolLimit = Math.min(15, Math.max(1, +$('#sCrowdLimit')?.value || DEFAULTS.crowdSymbolLimit));
  S.orderFeeEur = Math.min(100, Math.max(0, +$('#sOrderFee')?.value ?? DEFAULTS.orderFeeEur));
  S.venueFrictionPct = Math.min(5, Math.max(0, +$('#sVenueFriction')?.value ?? DEFAULTS.venueFrictionPct));
  const picked = $$('#sComponents input[data-comp]').filter((c) => c.checked).map((c) => c.dataset.comp);
  S.components = picked.length ? picked : [...ALL_COMPONENTS];
  saveSettings(); applyTheme(); applyTradeModeView(); renderAnalysisMethods(); render(); renderStocks();
  $('#settings').classList.remove('open');
  scan(true);
  // Aktien nur dann frisch anfordern, wenn sich die Analyse geändert hat —
  // jeder erzwungene Aktien-Refresh kostet echte Twelve-Data-Credits.
  const changed = prevAnalysis !== S.analysisMode + '|' + S.components.join(',') + '|' + S.minCrvStock;
  scanStocks(changed);
  // Deep-Scan-Tiefe ist kontoweit (Cron laeuft auch bei geschlossener PWA) -> serverseitig persistieren.
  if (S.stockDeep !== prevStockDeep) loadTiingoQuota(S.stockDeep);
}

function applyTheme() {
  document.documentElement.dataset.theme = S.theme;
  const mc = document.querySelector('meta[name=theme-color]');
  if (mc) mc.content = S.theme === 'dark' ? '#080b14' : S.theme === 'warm' ? '#ded4c6' : '#e4e8ef';
}

/* --------------------------------------------------------------- Wake Lock */
let wl = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator) wl = await navigator.wakeLock.request('screen');
    else { await wl?.release(); wl = null; }
  } catch { /* nicht unterstützt */ }
  $('#wake').classList.toggle('on', !!wl);
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (wl === null && $('#wake').classList.contains('on')) keepAwake(true);
    scan();
    scanStocks(false);
    scanOpeningMomentum(false);
    loadHealth();
    if(!lastSuccessfulScanTs || Date.now()-lastSuccessfulScanTs>90_000){ scanning=false; scan(false); }
  }
});

/* ---------------------------------------------------------------- Intervall */
function setPoll(ms) {
  clearInterval(timer);
  S.interval = ms; saveSettings();
  timer = setInterval(() => { if (document.visibilityState === 'visible') scan(); }, ms);
}
function setHealthPoll() {
  clearInterval(healthTimer);
  healthTimer = setInterval(() => { if (document.visibilityState === 'visible') loadHealth(); }, 60_000);
}

/* ----------------------------------------------------------------- Hotkeys */
document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t && typeof t.matches === 'function' && t.matches('input,select,textarea')) {
    if (e.key === 'Escape') t.blur();
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;   // Browser-Shortcuts nicht kapern
  const r = rows.find((x) => x.pair === selected);
  switch (e.key) {
    case ' ': e.preventDefault(); scan(true); break;
    case '/': e.preventDefault(); $('#q').focus(); break;
    case 'j': e.preventDefault(); step(1); break;
    case 'k': e.preventDefault(); step(-1); break;
    case 'c': if (r) copy(orderPlan(r)); break;
    case 'd': if (r) openDetail(r.pair); break;
    case 'p': pinned = !pinned; render(); break;
    case '1': $('#f').value = 'green'; render(); break;
    case '2': $('#f').value = 'yellow'; render(); break;
    case '3': $('#f').value = 'red'; render(); break;
    case '0': $('#f').value = ''; render(); break;
    case 'z': S.onlyZone = !S.onlyZone; saveSettings(); render(); break;
    case 'm': $('#sound').click(); break;
    case 'Escape': closeDetail(); $('#settings').classList.remove('open'); pinned = false; break;
    default: break;
  }
});

renderAnalysisMethods();
// Freshness-Farben muessen auch dann altern, wenn KEINE neue API-Antwort kommt.
setInterval(()=>{if(document.visibilityState==='visible'){renderMarketGainers();renderExtendedWatch();renderOpeningPanel();renderSectorLaggards();renderEarningsBoard();}},30_000);

/* ------------------------------------------------------------------- Events */
$('#scan').onclick = async () => {
  // v3.4.2: manueller blauer Refresh bedeutet ECHTE Aktualisierung. FokusScope zuerst,
  // danach der gesamte Aktien-Snapshot; alte Cache-Daten duerfen nicht als Refresh gelten.
  if(focusStock) await searchStockNow(focusStock,true);
  await Promise.allSettled([scan(true), scanStocks(true), scanOpeningMomentum(true), loadExperimental(true), loadCrowd(true), loadSentiment(false), loadEarnings(false), loadLearning(), loadAttribution(), loadAladdin(), loadHealth()]);
};
$('#sound').onclick = () => {
  S.sound = !S.sound; saveSettings();
  $('#sound').textContent = S.sound ? '🔊' : '🔇';
  $('#sound').title = S.sound ? 'Haupt-Ton EIN – alle nicht einzeln stummgeschalteten Signale hörbar (m)' : 'Haupt-Ton AUS – alle akustischen Signale stumm (m)';
  if (S.sound) { audio(); beep('tick'); }
};
$('#wake').onclick = () => keepAwake(!wl);
$('#cog').onclick = openSettings;
$('#sApply').onclick = applySettings;
$('#sExport').onclick = exportJournal;
$('#sReset').onclick = hardReload;
$('#sCompAll').onclick = () => $$('#sComponents input[data-comp]').forEach((c) => { c.checked = true; });
$('#sCompElliott').onclick = () => $$('#sComponents input[data-comp]').forEach((c) => { c.checked = c.dataset.comp === 'elliott'; });
$('#sClose').onclick = () => $('#settings').classList.remove('open');
$('#q').oninput = () => render();
$('#f').onchange = () => render();
$('#stockQ').oninput = () => { $('#stockSearchClear')?.classList.toggle('hidden',!$('#stockQ').value); previewStockSearchLive(); };
$('#stockQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); searchStockNow(); } });
$('#stockSearchGo').onclick = searchStockNow;
$('#stockSearchClear').onclick = () => { $('#stockQ').value=''; $('#stockSearchClear').classList.add('hidden'); $('#stockSearchPreview').textContent=''; renderStocks(); };
$('#stockF').onchange = () => renderStocks();
$('#iv').onchange = () => setPoll(+$('#iv').value);
$('#x').onclick = closeDetail;
$('#qClose').onclick = () => $('#quotaModal').classList.remove('open');
$('#qDismiss').onclick = () => $('#quotaModal').classList.remove('open');
$('#modal').onclick = (e) => { if (e.target.id === 'modal') closeDetail(); };
$('#settings').onclick = (e) => { if (e.target.id === 'settings') $('#settings').classList.remove('open'); };
$('#more').onclick = () => { showRest = !showRest; renderList(); };
$('#updateReload').onclick = hardReload;

/* ==== v3.14.1 · Konsistenzpruefung der Auslieferung =========================
   Gemeldet: „die Version haengt". Im Screenshot sagte der Tab-Titel 3.11.0,
   die Kopfzeile v3.12.0. Das ist kein Schoenheitsfehler, sondern ein halb
   aktualisierter Stand: neues app.js/style.css auf altem index.html. Dabei
   fehlen Elemente, die der neue Code erwartet — die Folgefehler sehen aus wie
   Layout- oder Scrollprobleme, sind aber keine. Wir haben genau daran zwei
   Runden gesucht.

   Die App merkt das jetzt selbst: `<meta name="fp-shell-version">` steckt in
   index.html, `FP_VERSION` in version.js. Beide setzt sync-version.mjs aus
   package.json. Weichen sie ab, ist die Shell veraltet.

   EINMAL selbst heilen, dann die Wahrheit sagen: Ein automatischer Neuladen-
   Versuch (der leert auch die Caches). Bleibt der Fehlstand danach bestehen,
   liegt es an der Auslieferung und nicht am Browser — dann wird KEINE weitere
   Schleife gedreht, sondern eine dauerhafte Warnung gezeigt. Eine Reload-
   Schleife waere hier der schlimmere Fehler: sie versteckt das Problem und
   macht die App unbenutzbar.                                                 */
/* v3.14.3 · DIE LUECKE IN DIESER PRUEFUNG.
   Sie verglich index.html gegen version.js. Beide sind kleine Dateien, die
   praktisch immer gemeinsam frisch werden. `app.js` und `style.css` wurden
   NICHT geprueft — und genau dort lagen die Layoutkorrekturen aus v3.14.0 und
   v3.14.2. Der Zustand „index.html neu, version.js neu, style.css alt" war
   damit vollstaendig unsichtbar: Pruefung gruen, kein blauer Balken, Kopfzeile
   zeigt die neue Nummer — und das Scrollen ist trotzdem kaputt.
   Das Stylesheet traegt jetzt `--fp-css-version` und wird mitgeprueft.
   Der Wert steht in Anfuehrungszeichen, die getComputedStyle mitliefert. */
function cssVersion(){
  try{
    const v=getComputedStyle(document.documentElement).getPropertyValue('--fp-css-version');
    const t=String(v||'').trim().replace(/^["']|["']$/g,'');
    return t||null;
  }catch{ return null; }
}
function checkShellConsistency(){
  const shell=document.querySelector('meta[name="fp-shell-version"]')?.getAttribute('content')||null;
  const code=(typeof self!=='undefined' && self.FP_VERSION)?String(self.FP_VERSION):null;
  /* Fail-closed: ein fehlender Stempel ist KEIN Fehlstand. Ein altes CSS ohne
     die Variable darf keine Falschwarnung ausloesen — dieselbe Regel wie beim
     fehlenden Meta-Tag in v3.14.1. */
  const css=cssVersion();
  if(code && css && css!==code) return {ok:false,shell:css,code,part:'style.css',
    action: sessionStorage.getItem('fp.shellFixTried')===code ? 'warn' : (sessionStorage.setItem('fp.shellFixTried',code),'reload')};
  if(!shell||!code||shell===code) return {ok:true,shell,code,css};
  const KEY='fp.shellFixTried';
  const tried=sessionStorage.getItem(KEY)===code;
  if(!tried){
    sessionStorage.setItem(KEY,code);
    return {ok:false,shell,code,action:'reload'};
  }
  return {ok:false,shell,code,action:'warn'};
}

{
  const c=checkShellConsistency();
  if(!c.ok){
    console.warn(JSON.stringify({event:'shell_version_mismatch',shell:c.shell,code:c.code,action:c.action}));
    const bar=$('#updateBar'), txt=$('#updateText'), btn=$('#updateReload');
    if(c.action==='reload'){
      if(txt) txt.textContent=`Unvollständige Auslieferung erkannt (${c.part||'index.html'} ${c.shell}, Code ${c.code}). Wird einmalig neu geladen.`;
      if(bar) bar.classList.remove('hidden');
      setTimeout(()=>{ hardReload(); }, 900);
    }else if(bar&&txt&&btn){
      /* Zweiter Fehlstand in derselben Sitzung: Der Neuladeversuch hat nichts
         geaendert. Dann liegt es am Server, nicht am Browser — das gehoert
         gesagt, statt es weiter zu versuchen. */
      txt.textContent=`Die Auslieferung ist inkonsistent: ${c.part||'index.html'} meldet ${c.shell}, der Code ${c.code}. Ein Neuladen hat das nicht behoben — die alte Datei kommt vom Server. Bis das behoben ist, können Anzeige- und Scrollfehler auftreten, die NICHT an den Einstellungen liegen.`;
      btn.textContent='Verstanden';
      btn.onclick=()=>bar.classList.add('hidden');
      bar.classList.remove('hidden');
    }
  }
}

/* v3.14.0: Eine Migration, die das Bewertungsverhalten aendert, darf NICHT still
   passieren. Der Nutzer muss wissen, dass ab jetzt anders gerechnet wird — sonst
   erklaert er sich abweichende Ergebnisse falsch. Die frueheren Migrationen
   (v3.5.2/3.5.3) waren stumm; das war ein Fehler, der hier nicht wiederholt wird. */
if(tradeModeMigrated314){
  const bar=$('#updateBar'), txt=$('#updateText'), btn=$('#updateReload');
  if(bar&&txt&&btn){
    txt.textContent='Modus A · Momentum-Tageshandel ist jetzt aktiv. Die Bewertung verwendet ab sofort das Tagesziel statt des bisherigen 8R-Deckels. Umschaltbar in den Einstellungen.';
    btn.textContent='Verstanden';
    btn.onclick=()=>bar.classList.add('hidden');
    bar.classList.remove('hidden');
  }
}
$('#dcopy').onclick = (e) => {
  const r = rows.find((x) => x.pair === selected);
  if (r) copy(orderPlan(r), e.target);
};
/* ==== v3.12.0 · Zweistufige Navigation ======================================
   Wunsch: alle Rubriken oben erreichbar, Leiste dauerhaft sichtbar.

   Dreizehn Reiter passen auf 13 Zoll nicht in eine Zeile. Deshalb drei feste
   Bereiche, deren Unterrubriken wechseln. Zwei Dinge sind dabei nicht optional:
     · Jedes Sprungziel wird VOR dem Zeichnen geprueft. Ein Reiter, der ins Leere
       fuehrt, tut beim Klick einfach nichts — das faellt niemandem auf und ist
       genau die Sorte Fehler, die lange ueberlebt.
     · Der aktive Abschnitt wird beim Scrollen markiert. Eine dauerhaft sichtbare
       Leiste, die nicht zeigt wo man ist, ist nur eine Knopfreihe.            */
const VIEW_SECTIONS = {
  coins: [
    ['.stage',            'Fokus',        'Krypto-Fokusfenster mit Heatmap — der ausgewählte Coin im Detail.'],
    ['#cryptoMovers',     'Mover',        'Coins mit der stärksten gemessenen Bewegung der letzten Stunde.'],
    ['#sentimentCard',    'Stimmung',     'Fear-&-Greed-Index. Reine Einordnung, 0 % BUY-Gewicht.'],
    ['main',              'Coin-Liste',   'Die vollständige Trefferliste unterhalb von Fokus und Heatmap.'],
  ],
  stocks: [
    ['.stockstage',       'Fokus',        'Aktien-Fokusfenster mit Heatmap.'],
    ['#marketGainers',    'Mover',        'Momentum-Mover: Bewegung während der laufenden US-Handelszeit.'],
    ['#sectorLaggards',   'Nachzügler',   'Sektor läuft, Titel hinkt noch — Grund hinzusehen, kein Kaufsignal.'],
    ['#earningsBoard',    'Zahlen',       'Anstehende Quartalszahlen der beobachteten Titel, nach Sektor.'],
    ['#openingPanel',     'Premarket',    'Gaps vor der Eröffnung (Alpaca).'],
    ['#extendedWatch',    'Nachbörse',    'Bewegung nach Handelsschluss.'],
    ['#depotStrip',       'Depot',        'Deine mit ★ markierten Titel.'],
    ['#portfolioRisk',    'Risiko',       'Gesamtrisiko über alle offenen Positionen und Klumpungswarnung.'],
    ['#stockGroups',      'Liste',        'Die vollständige Aktien-Trefferliste.'],
  ],
  lab: [
    ['#learningReport',     'Learning',       'Was im Hintergrund gespeichert und ausgewertet wurde.'],
    ['#attributionReport',  'Selbstauswertung','Modul 0: ehrliche Out-of-Sample-Bilanz je Setup.'],
    ['#experimentalPanel',  'Lab',            'Experimentelle Einflussgrößen, 0 % BUY-Gewicht.'],
    ['#aladdinCard',        'Marktmeinung',   'Hierarchische Marktmeinung aus Regime, Rotation, Breadth und Stress.'],
  ],
};
let activeView = 'coins';

function jumpTo(sel){
  const el=document.querySelector(sel);
  if(!el) return false;
  el.scrollIntoView({behavior:'smooth',block:'start'});
  return true;
}

function renderViewSub(){
  const box=$('#viewSub'); if(!box) return;
  // Nur Rubriken zeigen, die es im Markup tatsaechlich gibt.
  const items=(VIEW_SECTIONS[activeView]||[]).filter(([sel])=>document.querySelector(sel));
  box.innerHTML=items.map(([sel,label,help])=>
    `<button class="vb-sec" data-jump="${esc(sel)}" title="${esc(help)}">${esc(label)}</button>`).join('');
  box.querySelectorAll('[data-jump]').forEach(b=>b.addEventListener('click',()=>jumpTo(b.dataset.jump)));
  markActiveSection();
}

function setView(v){
  activeView=v;
  $$('.vb-tab').forEach(b=>b.setAttribute('aria-selected', String(b.dataset.view===v)));
  renderViewSub();
  const first=(VIEW_SECTIONS[v]||[])[0];
  if(first) jumpTo(first[0]);
}

/* Markiert die Rubrik, in der man sich gerade befindet. Gemessen gegen die
   tatsaechliche Hoehe der Leiste, damit die Markierung nicht schon umspringt,
   waehrend der Abschnitt noch dahinter liegt. */
function markActiveSection(){
  const box=$('#viewSub'); if(!box) return;
  // Defensiv: getComputedStyle fehlt im Testrahmen; der Startwert reicht dort.
  const chrome=(typeof getComputedStyle==='function'
    ? parseInt(getComputedStyle(document.documentElement).getPropertyValue('--fp-chrome-h'),10)
    : NaN) || 106;
  let current=null;
  for(const b of box.querySelectorAll('[data-jump]')){
    const el=document.querySelector(b.dataset.jump); if(!el) continue;
    if(el.getBoundingClientRect().top - chrome - 14 <= 0) current=b;
  }
  box.querySelectorAll('[data-jump]').forEach(b=>b.classList.toggle('on', b===current));
}

$$('.vb-tab').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
renderViewSub();
let scrollTick=0;
if(typeof window!=='undefined' && typeof window.addEventListener==='function'){
  window.addEventListener('scroll',()=>{
    if(scrollTick) return;
    scrollTick=(typeof requestAnimationFrame==='function')
      ? requestAnimationFrame(()=>{ scrollTick=0; markActiveSection(); })
      : setTimeout(()=>{ scrollTick=0; markActiveSection(); },60);
  },{passive:true});
}
document.body.addEventListener('pointerdown', () => audio(), { once: true });

function applyPrimaryBlockOrder(){
  // v3.3.2 UX: Aktien sind der erste Hauptblock. Im Krypto-Block kommt
  // zuerst die Coin-Tabelle und erst danach das große Detail-/Fokusfenster.
  const viewbar=document.querySelector('.viewbar'), stocks=$('#stocks'), main=document.querySelector('main'), stage=document.querySelector('.stage');
  if(viewbar&&stocks) viewbar.insertAdjacentElement('afterend',stocks);
  if(main&&stage) main.insertAdjacentElement('afterend',stage);
}

/* --------------------------------------------------------------------- Boot */
applyPrimaryBlockOrder();
applyTheme();
renderSignalBanner();
$('#appver').textContent = 'v' + FP_VERSION;
$('#settingsVer').textContent = 'v' + FP_VERSION;
$('#sound').textContent = S.sound ? '🔊' : '🔇';
$('#sound').title = S.sound ? 'Haupt-Ton EIN – alle nicht einzeln stummgeschalteten Signale hörbar (m)' : 'Haupt-Ton AUS – alle akustischen Signale stumm (m)';
$('#iv').value = String(S.interval);
setSys('#sysCrypto', 'busy'); setSys('#sysStocks', 'busy');

if ('Notification' in window && Notification.permission === 'default') {
  document.body.addEventListener('pointerdown', () => Notification.requestPermission(), { once: true });
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((reg) => {
    reg.addEventListener('updatefound', () => showUpdateBar());
    setInterval(() => reg.update().catch(() => {}), 15 * 60_000);
  }).catch(() => {});
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'FP_ACTIVATED' && e.data.version !== FP_VERSION) showUpdateBar();
  });
  let reloaded = false;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return; reloaded = true; location.reload();
  });
}

async function runTiingoUiTest(){
  const out=$('#tiingoTestState'),btn=$('#tiingoTest'); if(!out||!btn)return;
  btn.disabled=true; out.className=''; out.textContent='Prüfe Token, IEX, Intraday und BOATS…';
  const qp=()=>{const q=new URLSearchParams();if(S.token)q.set('t',S.token);return q;};
  try{
    const q=qp();q.set('symbols','AAPL,NVDA,TSLA');
    const vr=await fetch('/api/tiingo/validate?'+q,{cache:'no-store'}), vd=await vr.json();
    if(vr.status===401){out.className='err';out.textContent='FusionPulse-Zugriff nicht autorisiert – zuerst APP_TOKEN in Einstellungen speichern.';setMiniStatus('#miniTiingo','error',out.textContent);return;}
    const t=vd?.tests||{}, hist=t.history||[];
    const token=!!t.auth?.ok, iex=!!t.iexSnapshot?.ok, intraday=hist.length>0&&hist.every(x=>x.usable??x.ok), volume=hist.length>0&&hist.every(x=>x.volumeKnown), boats=!!t.boats?.ok;
    const mark=x=>x?'✅':'❌';
    const detail=`TOKEN ${mark(token)} · IEX ${mark(iex)} · 5-MIN ${mark(intraday)} · VOLUMEN ${mark(volume)} · BOATS ${mark(boats)}`;
    const histDetail=hist.map(x=>`${x.symbol}: ${Number(x.bars||0)} Bars${x.ageMinutes!=null?` · letzter Bar vor ${x.ageMinutes} min`:''}${x.error?` · ${x.error}`:''}`).join(' | ');
    const suffix=histDetail?` · ${histDetail}`:'';
    if(vd?.readyForPrimary){out.className='ok';out.textContent=detail+' · Power + BOATS technisch vollständig nutzbar. Shadow bleibt aktiv, bis Primary bewusst freigegeben wird.'+suffix;setMiniStatus('#miniTiingo','ok',out.textContent);}
    else if(token){out.className='warn';out.textContent=detail+' · '+(vd?.note||'Mindestens ein Datenbaustein ist noch nicht verfügbar; noch keine Primary-Umschaltung.')+suffix;setMiniStatus('#miniTiingo','warn',out.textContent);}
    else {out.className='err';out.textContent=detail+' · '+(t.auth?.error||'Tiingo-Token nicht authentifiziert.');setMiniStatus('#miniTiingo','error',out.textContent);}
  }catch(e){out.className='err';out.textContent='Tiingo-Test fehlgeschlagen: '+(e?.message||e);setMiniStatus('#miniTiingo','error',out.textContent);}
  finally{btn.disabled=false;}
}

$('#tiingoTest')?.addEventListener('click',runTiingoUiTest);

/** Laedt Deep-Scan-Tiefe + App-eigene Tiingo-Kontingentschaetzung aus dem Worker.
 *  Ehrlich gekennzeichnet: Tiingo liefert weder Nutzungs-Header noch einen
 *  oeffentlichen usage-Endpoint, daher ist dies eine reine App-Zaehlung
 *  dieses Workers, kein von Tiingo bestaetigter Kontostand. */
async function loadTiingoQuota(applyStockDeep){
  const el=$('#tiingoQuotaState'); if(!el)return null;
  try{
    const q=new URLSearchParams(); if(S.token)q.set('t',S.token);
    if(applyStockDeep!=null)q.set('stockDeep',String(applyStockDeep));
    const r=await fetch('/api/tiingo/status?'+q,{cache:'no-store'}), d=await r.json();
    if(d?.stockDeep!=null){ S.stockDeep=d.stockDeep; if($('#sStockDeep'))$('#sStockDeep').value=d.stockDeep; }
    const qv=d?.quota;
    if(!qv){ el.textContent='Kontingent unbekannt (Tiingo-Token fehlt oder Antwort ohne Daten).'; return d; }
    const bar=(pct)=>pct>=90?'err':pct>=70?'warn':'ok';
    el.className=bar(Math.max(qv.hourPct,qv.dayPct));
    el.textContent=`Stunde: ${qv.hourCalls}/${qv.hourLimit} (${qv.hourPct}%) · Tag: ${qv.dayCalls}/${qv.dayLimit} (${qv.dayPct}%) · nur dieser Worker, App-Schätzung`;
    return d;
  }catch(e){ el.textContent='Kontingent konnte nicht geladen werden: '+(e?.message||e); return null; }
}
$('#regime')?.addEventListener('click',()=>{const el=$('#regimeExplain');if(!el)return;const opening=el.classList.contains('hidden');el.classList.toggle('hidden',!opening);el.innerHTML=regimeExplanation();$('#regime').setAttribute('aria-expanded',opening?'true':'false');});
document.addEventListener('click',(e)=>{if(!e.target.closest('.hstat')){const el=$('#regimeExplain');if(el&&!el.classList.contains('hidden')){el.classList.add('hidden');$('#regime')?.setAttribute('aria-expanded','false');}}});
renderSignalBanner();

loadHealth();
scan(false);
scanStocks(false);
scanOpeningMomentum(false);
loadExperimental(false);
loadCrowd(false);
loadSentiment(false);
loadEarnings(false);
loadLearning();
loadAttribution();
loadAladdin();
setPoll(S.interval);
setStockPoll();
setHealthPoll();
startConnectionWatchdog();
setLearningPoll();
