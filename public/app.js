/* ============================================================================
   FusionPulse v3.3.0 — Frontend
   Leitgedanke: das Auge soll nicht 20 gleichwertige Kacheln absuchen müssen.
   Drei Ebenen: EIN Fokus-Setup (groß) → 2D-Karte (Position = Bedeutung) →
   dichte Liste (ausgerichtete Spalten). Handeln ohne Modal.
   ========================================================================== */

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

/* Version: kommt aus /version.js, das aus package.json generiert wird. */
const FP_VERSION = (typeof self !== 'undefined' && self.FP_VERSION) || '0.0.0';

/* ------------------------------------------------------------ Einstellungen */
const ALL_COMPONENTS = ['vwap', 'ema21', 'rs', 'mtf', 'volume', 'book', 'squeeze', 'pullback', 'elliott'];
const DEFAULTS = {
  equity: 5000, riskPct: 0.75, interval: 20000, deep: 20,
  sound: true, token: '', watch: 'BTC-EUR,ETH-EUR,SOL-EUR', minQ: 0, onlyZone: false,
  theme: 'dark', taxPct: 27.5, analysisMode: 'composite', coinCount: 12, stockCount: 12,
  maxTradeEur: 10000, minCrvCoin: 2.0, minCrvStock: 3.0, minNetProfitStock: 350, minTp2PctStock: 2.0,
  mutedPairs: [], mutedStocks: [], favoritePairs: [], favoriteStocks: [], stockOrder: [], components: [...ALL_COMPONENTS], stockSound: true,
};
const storedSettings = (() => { try { return JSON.parse(localStorage.getItem('fp.settings') || '{}'); } catch { return {}; } })();
const S = { ...DEFAULTS, ...storedSettings };
// Flatex AT / Tradegate cost model (v3.0.4): public base fee + minimum venue cost
// per execution. Spread/slippage cannot be known from the Twelve Data candle feed,
// therefore a separate conservative execution reserve is shown as an estimate.
const STOCK_ORDER_FIXED_EUR = 10.75; // conservative v3.0.4 estimate for typical 5k–10k executions: 9.90 € flatex example + 0.85 € Tradegate min. external cost
const STOCK_EXECUTION_FRICTION_PCT = 0.06; // estimated round-trip spread/slippage reserve, not a live Tradegate quote
const OPPORTUNITY_MIN_NET_EUR = 350; // wirtschaftlich relevante Untergrenze bei ~10k Referenzeinsatz
const OPPORTUNITY_HIGH_NET_EUR = 500; // priorisierte High-Opportunity, keine Erfolgswahrscheinlichkeit
if (!Array.isArray(S.components) || !S.components.length) S.components = [...ALL_COMPONENTS];
S.components = S.components.filter((c) => ALL_COMPONENTS.includes(c));
if (!S.components.length) S.components = [...ALL_COMPONENTS];
const saveSettings = () => { try { localStorage.setItem('fp.settings', JSON.stringify(S)); } catch {} };

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
  // Current server rows are authoritative for Discovery. A frontend last-row cache
  // may only fill a missing FAVORITE/DEPOT row; it must never repopulate old Discovery.
  const m=new Map((rows||[]).filter(r=>r?.symbol&&uiStockRowAllowed(r)).map(r=>[String(r.symbol).toUpperCase(),r]));
  for(const [sym,old] of stockLastRows){
    if(!isFavStock(sym) || !old || !uiStockRowAllowed(old) || m.has(sym)) continue;
    m.set(sym,{...old,_staleLast:true,_staleFavorite:true});
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
let selected = null;        // aktuell fokussiertes Paar
let pinned = false;         // vom Nutzer gewählt → nicht automatisch wegspringen
let showRest = false;
let ac = null;
let health = {};
let quotaShownFor = '';     // verhindert Dauer-Popups für dieselbe Lage
let stockSearchBusy = false;
let stockSearchLastTs = 0;
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
const stockUpdateLabel = (r) => {const f=stockFreshness(r);return `${f.label} · Abfrage ${clock(stockMeta?.ts)} · Daten ${r?.updated||'–'}`;};

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
function buyReady(r) {
  return r.light === 'green' && r.inZone && Number(r.netCRV || 0) >= Number(S.minCrvCoin || DEFAULTS.minCrvCoin);
}
const coinLevel = (r) => (buyReady(r) ? 3 : r.light === 'green' ? 2 : r.light === 'yellow' ? 1 : 0);
function stockTradeability(r) {
  const sz = stockSizing(r);
  const tp2Pct = Number(r.tp2Pct ?? (r.entryUsd ? ((r.tp2Usd / r.entryUsd - 1) * 100) : 0));
  const netProfit = Number(sz?.planNet ?? 0);
  const netCrv = Number(sz?.planCrvAfterCosts ?? r.netCRV ?? 0);
  const currentPhase = stockMeta?.market?.key || r.marketPhase;
  const marketOk = !currentPhase || ['regular','opening'].includes(currentPhase);
  const ok = marketOk && tp2Pct >= Number(S.minTp2PctStock || 0)
    && netProfit >= Math.max(Number(S.minNetProfitStock || 0), OPPORTUNITY_MIN_NET_EUR)
    && netCrv >= Number(S.minCrvStock || 3);
  return { ok, tp2Pct, netProfit, netCrv, marketOk };
}
const stockLevel = (r) => {
  const t = stockTradeability(r);
  return (r.light === 'green' && r.score >= 8 && t.ok) ? 3
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
let signalEvents=[];
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
  renderSignalBanner();
  setTimeout(()=>{ if(type==='stock') renderStocks(); else render(); }, SIGNAL_TTL_MS+100);
}
function renderSignalBanner(){
  const el=$('#signalBanner');if(!el)return;
  if(!signalEvents.length){el.classList.remove('hidden');el.innerHTML='<span class="signal-idle"><b>SIGNAL-INFO</b><span>Noch kein neues BUY-/Grün-Signal in dieser Sitzung.</span></span>';return;}
  el.classList.remove('hidden');
  el.innerHTML=signalEvents.map(x=>`<button class="signal-chip ${x.type}" data-sigtype="${x.type}" data-sigid="${esc(x.id)}"><b>${x.type==='stock'?'AKTIE':'COIN'} · ${esc(x.type==='coin'?sym(x.id):x.id)}</b><span>${esc(x.reason)}</span></button>`).join('');
  el.querySelectorAll('[data-sigtype]').forEach(b=>b.onclick=async()=>{const id=b.dataset.sigid;if(b.dataset.sigtype==='stock'){focusStock=id;renderStocks();$('#stocks')?.scrollIntoView({behavior:'smooth'});}else{select(id,true);$('#focus')?.scrollIntoView({behavior:'smooth'});}});
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
  const riskEur = S.equity * (S.riskPct / 100);
  const perUnit = r.entry - r.stop;
  if (perUnit <= 0) return null;
  let notional = (riskEur / perUnit) * r.entry;
  const rawNotional = notional;
  const caps = [];
  const maxTrade = Math.max(0, Number(S.maxTradeEur || 0));
  if (maxTrade && notional > maxTrade) { notional = maxTrade; caps.push('maxTrade'); }
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
  nokey: 'API-Key fehlt', error: 'API-Fehler', unknown: 'Status unbekannt',
};
const STATE_TONE = { ok: 'ok', busy: 'busy', ratelimit: 'warn', daylimit: 'warn', nokey: 'err', error: 'err', unknown: 'busy' };

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
  const cls = raw === 'ok' ? 'ok' : ['warn','ratelimit','daylimit'].includes(raw) ? 'warn' : ['err','error','nokey'].includes(raw) ? 'err' : 'busy';
  el.classList.remove('ok','warn','err','busy');
  el.classList.add(cls);
  const label = detail || (el.id === 'miniCrypto' ? 'Krypto-Datenquelle' : el.id === 'miniStocks' ? 'Aktien-Datenquelle' : 'Tiingo-Verbindung');
  el.dataset.tip = label;
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
    const r = await fetch('/api/health?' + p, { cache: 'no-store' });
    health = await r.json();
    if (health.version) {
      $('#appver').textContent = 'v' + health.version;
      const v = $('#settingsVer'); if (v) v.textContent = 'v' + health.version;
      // Version-Mismatch Frontend ↔ Backend: alter Cache oder halbes Deployment.
      if (health.version !== FP_VERSION) {
        showUpdateBar(`Neue FusionPulse-Version verfügbar – neu laden (Oberfläche v${FP_VERSION}, Server v${health.version})`);
      }
    }
    const cryptoHealth = health.status?.crypto?.state || 'unknown';
    setSys('#sysCrypto', cryptoHealth, health.status?.crypto?.message);
    setSys('#sysStocks', health.status?.stocks?.state || 'unknown', health.status?.stocks?.message);
    setMiniStatus('#miniCrypto',cryptoHealth,'Krypto: '+(health.status?.crypto?.message||cryptoHealth));
    setMiniStatus('#miniStocks',health.status?.stocks?.state||'unknown','Aktien: '+(health.status?.stocks?.message||health.stocksProvider||'unbekannt'));
    setMiniStatus('#miniTiingo',health.tiingoConfigured?'ok':'warn',health.tiingoConfigured?'Tiingo-Token ist im Worker hinterlegt · Modus '+(health.tiingoStocksMode||'shadow'):'Tiingo-Token fehlt');
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
    setMiniStatus('#miniCrypto','error','Worker nicht erreichbar'); setMiniStatus('#miniStocks','error','Worker nicht erreichbar'); setMiniStatus('#miniTiingo','error','Worker nicht erreichbar');
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
  $('#status').dataset.state = 'busy';

  try {
    const q = new URLSearchParams({
      deep: S.deep, watch: S.watch, mode: S.analysisMode, comp: S.components.join(','), minCrv: S.minCrvCoin,
    });
    if (S.token) q.set('t', S.token);
    if (force) q.set('force', '1');
    const res = await fetch(`/api/scan?${q}`, { signal: localController.signal });
    const data = await res.json();
    if (!res.ok) {
      setSys('#sysCrypto', data.state || 'error', data.error);
      if (res.status === 429) showQuotaWarning('requests', data.error);
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    rows = data.rows || [];
    meta = data;
    setSys('#sysCrypto', 'ok', `${data.deepCount} von ${data.universe} EUR-Paaren tief analysiert`);
    if (data.version && data.version !== FP_VERSION) {
      showUpdateBar(`Neue FusionPulse-Version verfügbar – neu laden (Oberfläche v${FP_VERSION}, Server v${data.version})`);
    }
    track();
    render();

    const shown = Math.min(S.coinCount, visible().length);
    $('#status').textContent = `${data.warmStart ? 'Cron-Cache' : data.cached ? 'Cache' : 'Live'} · ${data.deepCount} gescannt / ${shown} angezeigt von ${data.universe} · ${data.requests ?? data.subrequests ?? '–'} API-Unterabfragen · ${Math.round(performance.now() - t0)} ms`;
    $('#status').title = 'Live/Cache = Datenquelle des letzten Scans · „gescannt“ = tief analysierte Coins, „angezeigt“ = Zeilen in dieser Liste (Einstellungen) · API-Unterabfragen = Bitpanda-Unterabfragen innerhalb dieses Scans, NICHT dein Cloudflare-Tagesverbrauch (Eigenzählung je Worker-Instanz) · ms = Dauer des Scans.';
    $('#status').dataset.state = 'ok';
    $('#stamp').textContent = new Date(data.ts).toLocaleTimeString('de-AT');
  } catch (e) {
    if (e.name === 'AbortError') return;
    const msg = String(e.message || e);
    $('#status').textContent = `Fehler: ${msg}`;
    $('#status').dataset.state = 'err';
    if (/cpu|exceeded|resource|1102/i.test(msg)) showQuotaWarning('cpu', msg);
    else if (/429|too many|limit/i.test(msg)) showQuotaWarning('requests', msg);
  } finally {
    if (req === scanReqSeq) scanning = false;
  }
}

/* -------------------------------------------------------------- Aktienradar */
/** Positionsgröße in EUR. Ohne bekannten EUR/USD-Kurs wird bewusst NICHT
 *  gerechnet, statt USD und EUR stillschweigend zu vermischen. */

function stockOpportunity(r){
  const sz=stockSizing(r), tr=stockTradeability(r), f=stockFreshness(r);
  const phase=stockMeta?.market?.key||r.marketPhase||'closed';
  const opportunityPhase=['premarket-early','premarket','opening','regular'].includes(phase);
  const net=Number(sz?.planNet||0), crv=Number(sz?.planCrvAfterCosts||0), tp2=Number(tr.tp2Pct||0), score=Number(r.score||0);
  const minNet=Math.max(Number(S.minNetProfitStock||0),OPPORTUNITY_MIN_NET_EUR);
  const reasons=[];
  if(score>=8) reasons.push(`Score ${num(score,1)}/10`);
  if(crv>=Number(S.minCrvStock||3)) reasons.push(`Netto-CRV ${num(crv,1)}:1`);
  if(net>=minNet) reasons.push(`Plan netto ${eur(net,0)}`);
  if(Number(r.relVol||0)>=1.5) reasons.push(`RVOL ${num(r.relVol,1)}×`);
  const ready=r.light==='green'&&score>=8&&f.key==='live'&&opportunityPhase&&crv>=Number(S.minCrvStock||3)&&net>=minNet&&tp2>=Number(S.minTp2PctStock||2);
  const tier=ready?(net>=OPPORTUNITY_HIGH_NET_EUR?'high':'opportunity'):(net>0&&net<200?'ignore':'watch');
  const label=tier==='high'?'HIGH OPPORTUNITY':tier==='opportunity'?'OPPORTUNITY':tier==='ignore'?'UNINTERESSANT':'NOCH KEINE OPPORTUNITY';
  let why='';
  if(net>0&&net<200) why=`Nur ${eur(net,0)} realistisches Netto-Potenzial – für Aufwand/Risiko zu klein.`;
  else if(net>0&&net<minNet) why=`Netto-Potenzial ${eur(net,0)} liegt unter der Opportunity-Schwelle ${eur(minNet,0)}.`;
  else if(crv<Number(S.minCrvStock||3)) why=`CRV ${num(crv,1)}:1 liegt unter ${num(S.minCrvStock||3,1)}:1.`;
  else if(tp2<Number(S.minTp2PctStock||2)) why=`Verbleibender realistischer Kursweg bis TP2 nur ${num(tp2,1)}%.`;
  else if(f.key!=='live') why='Daten sind nicht live – keine Opportunity-Freigabe.';
  else if(!opportunityPhase) why='Marktphase ist für eine Opportunity-Freigabe nicht aktiv.';
  return {ready,tier,label,why,reasons:reasons.slice(0,3),distance:Math.max(0,8-score),minNet};
}

function stockSizing(r) {
  if (r.entryEur == null || r.stopEur == null || !(r.entryEur > r.stopEur)) return null;
  const riskEur = S.equity * (S.riskPct / 100);
  let qty = riskEur / (r.entryEur - r.stopEur);
  const maxTrade = Math.max(0, Number(S.maxTradeEur || 0));
  if (maxTrade && qty * r.entryEur > maxTrade) qty = maxTrade / r.entryEur;
  const notional = qty * r.entryEur;
  const tp1Share = 0.5, tp2Share = 0.5;
  const tp1Gross = (r.tp1Eur - r.entryEur) * qty * tp1Share;
  const tp2Gross = (r.tp2Eur - r.entryEur) * qty * tp2Share;
  const planGross = tp1Gross + tp2Gross;

  // Target path = Entry + TP1 + TP2 (3 executions). Stop path = Entry + Stop (2 executions).
  const targetFixedCosts = STOCK_ORDER_FIXED_EUR * 3;
  const stopFixedCosts = STOCK_ORDER_FIXED_EUR * 2;
  const frictionTarget = notional * (STOCK_EXECUTION_FRICTION_PCT / 100);
  const frictionStop = notional * (STOCK_EXECUTION_FRICTION_PCT / 100);
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
  return {
    qty, notional, risk: stopPriceLoss,
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
      <span class="pk-verdict ${r.light}">${VERDICT_ICON[r.light]} ${esc(r.verdict)}</span>
    </header>
    <div class="pkgrid">
      ${t('Branche', 'Sektor-Zuordnung innerhalb des Aktien-Universums.', esc(r.sector))}
      ${t('Kurs', 'Letzter Kurs aus dem aktiven US-5-Minuten-Marktdatenfeed.', stockPx(r.priceUsd, r.priceEur))}
      ${t('Score', 'Gesamtbewertung von 0–10 aus den aktivierten Analyseverfahren. Höher = mehr Verfahren bestätigen dasselbe Bild.', num(r.score, 1))}
      ${t('Netto-CRV Tradeplan', 'CRV des tatsächlichen 50/50-Tradeplans nach geschätzten Flatex/Tradegate-Ausführungskosten. Spread/Slippage sind mangels Live-Tradegate-Bid/Ask nur als Reserve geschätzt.', sz ? `${num(sz.planCrvAfterCosts, 2)} : 1` : `${num(r.netCRV, 1)} : 1`)}
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
  const trails = pts.map(({r}) => {
    const h=(r._history||[]).filter(x=>Date.now()-x.ts<=HISTORY_WINDOW_MS).slice(-8);
    if(h.length<2) return '';
    const points=h.map(x=>`${g(Number(x.executability||0)).toFixed(1)},${(200-g(Number(x.quality||0))).toFixed(1)}`).join(' ');
    return `<polyline class="stocktrail ${r.light}" points="${points}"/>`;
  }).join('');
  svg.innerHTML=`<rect class="stockbg" x="0" y="0" width="200" height="200" rx="8"/><rect class="quad qa" x="100" y="0" width="100" height="100"/><rect class="quad qb" x="0" y="0" width="100" height="100"/><rect class="quad qc" x="100" y="100" width="100" height="100"/><line class="ax" x1="100" y1="0" x2="100" y2="200"/><line class="ax" x1="0" y1="100" x2="200" y2="100"/>${trails}`+
    pts.map(({r,x,y,rad})=>`<g class="dot light-${r.light} ${stockLevel(r)===3?'buy-ready':''}" data-openstock="${esc(r.symbol)}" transform="translate(${Math.max(10,Math.min(190,x)).toFixed(1)} ${Math.max(10,Math.min(190,y)).toFixed(1)})"><circle class="hit" r="${rad+7}"/><circle class="core" r="${rad}"/><text x="0" y="2.2">${esc(r.symbol.slice(0,5))}</text><title>${esc(r.name)} · Score ${num(r.score,1)} · CRV ${num(r.netCRV,1)}:1 · RVOL ${r.relVol==null?'n.v.':num(r.relVol,1)} · Klick: Aktie öffnen</title></g>`).join('');
  svg.querySelectorAll('[data-openstock]').forEach(dot=>dot.addEventListener('click',async()=>{
    focusStock=dot.dataset.openstock||''; renderStocks();
    const found=stockRows.some(r=>r.symbol===focusStock); if(!found){const q=$('#stockQ'); if(q){const old=q.value;q.value=focusStock;await searchStockNow();q.value=old;}}
    $('#stockFocus')?.scrollIntoView({behavior:'smooth',block:'start'});
  }));
}

function renderDepotStrip() {
  const el=$('#depotStrip'); if(!el) return;
  const favs=S.favoriteStocks||[];
  if(!favs.length){el.innerHTML='<span><b>★ Favoriten / Depot</b> · noch leer — Stern bei einer Aktie antippen.</span>';return;}
  el.innerHTML=`<b>★ Favoriten / Depot (${favs.length})</b>`+favs.map(symb=>`<button class="depotchip" draggable="true" data-depot="${esc(symb)}" title="Ziehen zum Neuordnen · Klick öffnet ${esc(symb)}"><span class="dragmark" aria-hidden="true">⋮⋮</span>${esc(symb)}</button>`).join('');
  el.querySelectorAll('[data-depot]').forEach(b=>{
    b.onclick=async()=>{focusStock=b.dataset.depot;const q=$('#stockQ');if(q)q.value='';renderStocks();if(!stockRows.some(r=>r.symbol===focusStock)){if(q)q.value=focusStock;await searchStockNow();if(q)q.value='';renderStocks();}};
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
function renderResourceStrip(){
  const box=$('#resourceStrip'), out=$('#resourceText'); if(!box||!out)return;
  const hs=health?.status||{}; const states=[hs.crypto?.state,hs.stocks?.state,hs.alpaca?.state].filter(Boolean);
  const bad=states.some(x=>['cpu','error','ratelimit','daylimit'].includes(x)); const warn=states.some(x=>['stale','warn','unknown'].includes(x));
  const ti=health?.tiingoConfigured?'Tiingo aktiv':'Tiingo n.v.';
  out.textContent=bad?'Limit/Fehler erkannt':warn?'eingeschränkt · '+ti:'stabil · '+ti;
  box.classList.toggle('err',bad);box.classList.toggle('warn',!bad&&warn);
  box.dataset.tip=`Cloudflare/API-Systemstatus aus tatsächlich messbaren Provider-Zuständen. ${bad?'Mindestens ein Fehler/Limit wurde erkannt. Prüfe Details, bevor du dich auf einen vollständigen Scan verlässt.':warn?'Mindestens eine Quelle ist eingeschränkt oder nicht sicher messbar.':'Die zuletzt gemeldeten Quellen laufen stabil.'} Warum sinnvoll? Ein guter Scanner braucht nicht nur gute Regeln, sondern auch genug Serverzeit und frische Daten. Kostenpflichtige Aufstockung wird erst sinnvoll, wenn CPU-/Limitfehler wiederholt auftreten.`;
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
    : `Serverseitiges Learning in Cloudflare D1. Browserdaten können gelöscht werden, ohne diese ${Number(learningData?.stats?.snapshots||0)} Snapshots zu verlieren.`;
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
    const r=await fetch('/api/learning?'+q,{cache:'no-store'});const d=await r.json();if(req!==learningReqSeq)return;learningData=d||{};
    learningStock=new Map(Object.entries(d.stocks||{}));learningCoin=new Map(Object.entries(d.coins||{}));
    mergeServerHistories();renderLearningStatus();renderLearningReport();render();renderStocks();
  }catch(e){learningData={configured:true,state:'error',error:String(e.message||e)};renderLearningStatus();}
}
function setLearningPoll(){clearInterval(learningTimer);learningTimer=setInterval(()=>{if(document.visibilityState==='visible')loadLearning();},120_000);}

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
async function loadCrowd(force=false){
  const req=++crowdReqSeq;
  const symbols=[...new Set([...(S.favoriteStocks||[]),...openingRows.slice(0,5).map(r=>r.symbol),...stockRows.slice(0,12).map(r=>r.symbol)])].slice(0,15);
  if(!symbols.length)return;
  for(const sym of symbols)crowdMap.delete(sym);
  try{const q=new URLSearchParams({symbols:symbols.join(',')});if(S.token)q.set('t',S.token);if(force)q.set('force','1');const r=await fetch('/api/crowd?'+q,{cache:'no-store'});const d=await r.json();if(req!==crowdReqSeq)return;crowdMeta=d;for(const x of d.rows||[])crowdMap.set(x.symbol,{...x,_ts:Number(x.ts||d.ts||Date.now())});renderStocks();}
  catch(e){crowdMeta={state:'error',error:String(e.message||e)};renderStocks();}
}
function renderExtendedWatch(){
  const el=$('#extendedWatch');if(!el)return;const phase=String(openingMeta.phaseLabel||stockMeta.market?.label||'');
  const extended=/pre|after|overnight/i.test(phase);const cand=openingRows.slice(0,6);
  el.innerHTML=`<div class="ophead"><b>🌙 Extended-Hours Watch</b><span>${esc(phase||'Sessionstatus wird geladen')}</span><small>Beobachtung · kein BUY allein</small></div>`+(cand.length?`<div class="opgrid">${cand.map(r=>{const sr=stockRows.find(x=>x.symbol===r.symbol);return `<button class="opcard" data-openstock="${esc(r.symbol)}" title="${esc(r.symbol)} außerhalb/nahe der Hauptsession beobachten. Warum sinnvoll? Vor- und Nachbörse können frühe Aufmerksamkeit zeigen; breitere Spreads und weniger Volumen machen die Bewegung aber unsicherer."><b>${esc(r.symbol)}</b><span>${r.gapPct>=0?'+':''}${num(r.gapPct,1)}%</span>${spark((sr?.intraday||[]).slice(-12),120,28)}<em>${extended?'Extended Hours':'Opening/Session'}</em></button>`}).join('')}</div>`:'<span class="hint">Noch keine Extended-Hours-Kandidaten.</span>');
  el.querySelectorAll('[data-openstock]').forEach(b=>b.addEventListener('click',()=>{focusStock=b.dataset.openstock||'';renderStocks();$('#stockFocus')?.scrollIntoView({behavior:'smooth',block:'start'});}));
}
function renderOpeningPanel() {
  const el=$('#openingPanel'); if(!el) return;
  if(openingMeta.configured===false){el.innerHTML='<b>🚀 Opening Momentum</b><span>Alpaca noch nicht verbunden. Benötigt zwei Cloudflare-Secrets: <code>ALPACA_API_KEY_ID</code> und <code>ALPACA_API_SECRET_KEY</code>.</span>';return;}
  const phase=openingMeta.phaseLabel||'Status wird geladen';
  const top=openingRows.slice(0,5);
  el.innerHTML=`<div class="ophead"><b>🚀 Opening Momentum</b><span title="${esc(openingMeta.phaseHelp||'')} ">${esc(phase)}</span><small title="${esc(openingMeta.limitations||'Alpaca Marktdatenfeed')}">Alpaca · ${esc(openingMeta.feed||'IEX')}</small></div>`+
    (top.length?`<div class="opgrid">${top.map(r=>`<button type="button" class="opcard ${r.light}" data-openstock="${esc(r.symbol)}" title="${esc(r.symbol)} im Aktienradar öffnen. Momentum-Score kombiniert Gap, Volumenbeschleunigung, kurzfristige Kursdynamik und Premarket-/Opening-Level. Kein BUY allein."><b>${esc(r.symbol)}</b><span>${r.gapPct>=0?'+':''}${num(r.gapPct,1)}% Gap</span><span>Mom ${num(r.momentumScore,1)}</span><span>RV ${r.relVol==null?'n.v.':num(r.relVol,1)+'×'}</span><span title="Elliott/Fibonacci-Strukturprojektion: grober möglicher Bewegungsraum aus aktuellem Impuls und 1,618-Projektion; kein garantiertes Kursziel.">Struktur ${num(r.structurePct,1)}%</span><em>${esc(r.phaseAction)}</em></button>`).join('')}</div>`:`<span class="hint">Noch keine verwertbaren Live-Daten im aktuellen ${esc(openingMeta.feed||'Alpaca')}-Zeitfenster.</span>`);
  el.querySelectorAll('[data-openstock]').forEach(btn => btn.addEventListener('click', async () => {
    focusStock = btn.dataset.openstock || '';
    renderStocks();
    if (!stockRows.some(r=>r.symbol===focusStock)) { const q=$('#stockQ'); if(q){ const old=q.value; q.value=focusStock; await searchStockNow(); q.value=old; } }
    $('#stockFocus')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
}

function renderMarketGainers(){
  const el=$('#marketGainers'); if(!el)return;
  const g=(stockMeta.discovery?.radar?.gainers||[]).slice(0,8);
  if(!g.length){el.innerHTML='<div class="ophead"><b>📈 Market Gainer · Common Stocks</b><small>Elliott-first Discovery</small></div><span class="hint">Noch keine verifizierten starken Gainer im aktuellen Radar.</span>';return;}
  el.innerHTML=`<div class="ophead"><b>📈 Market Gainer · Common Stocks</b><span>US-Markt · nur Discovery</span><small>Elliott bleibt Deep-Scan-Basis</small></div><div class="opgrid">${g.map(r=>`<button type="button" class="opcard" data-openstock="${esc(r.symbol)}" title="Verifizierter Common Stock. Tagesbewegung ist nur Discovery; BUY erst nach Elliott-/Qualitäts-/CRV-Prüfung."><b>${esc(r.symbol)}</b><span>${Number(r.movePct)>=0?'+':''}${num(r.movePct,1)}% Tag</span><span>${r.speedPct!=null?'Speed '+num(r.speedPct,2)+'%':'Radar '+num(r.score,1)}</span><span>${r.spreadPct!=null?'Spread '+num(r.spreadPct,2)+'%':'Spread n.v.'}</span><em>Elliott prüfen</em></button>`).join('')}</div>`;
  el.querySelectorAll('[data-openstock]').forEach(b=>b.addEventListener('click',()=>{focusStock=b.dataset.openstock||'';renderStocks();$('#stockFocus')?.scrollIntoView({behavior:'smooth',block:'start'});}));
}

function renderStocks() {
  const box=$('#stockGroups'),st=$('#stockState'),counts=$('#stockCounts'); if(!box||!st)return;
  renderDepotStrip(); renderMarketGainers(); renderExtendedWatch(); renderOpeningPanel();
  if(stockMeta.configured===false){box.innerHTML='';st.textContent='Aktien-Datenquelle fehlt';st.className='badge err';if(counts)counts.textContent='Aktienradar nicht konfiguriert';stockHeatmap([]);return;}
  const search=($('#stockQ')?.value||'').trim().toUpperCase(); const filter=$('#stockF')?.value||'';
  let stockFiltered=stockRows.filter(r=>(!search||r.symbol.toUpperCase().includes(search)||String(r.name||'').toUpperCase().includes(search)));
  if(filter==='favorites') stockFiltered=stockFiltered.filter(r=>isFavStock(r.symbol));
  if(filter==='green'||filter==='yellow') stockFiltered=stockFiltered.filter(r=>r.light===filter);
  if(filter==='momentum') { const hot=new Set(openingRows.slice(0,20).map(r=>r.symbol)); stockFiltered=stockFiltered.filter(r=>hot.has(r.symbol)); }
  const shown=[...stockFiltered].sort((a,b)=>filter==='favorites'?((stockOrderIndex(a.symbol)-stockOrderIndex(b.symbol))||(Number(b.score)||0)-(Number(a.score)||0)):((Number(stockFreshness(b).key==='live')-Number(stockFreshness(a).key==='live'))||(Number(b.preSignalMaturity)||0)-(Number(a.preSignalMaturity)||0)||(Number(b.radarRank)||0)-(Number(a.radarRank)||0)||(Number(b.score)||0)-(Number(a.score)||0))).slice(0,S.stockCount);
  const scanned=stockMeta.scanned??stockRows.length, universeLabel=stockMeta.universeLabel||stockMeta.universe||21, stateKey=stockMeta.state||(stockRows.length?'ok':'unknown');
  const phase=stockMeta.market?.label||'';
  st.textContent=(stateKey==='ok'?'Aktienfeed':STATE_TEXT[stateKey]||'Status unbekannt')+(phase?` · ${phase}`:'');
  st.className='badge '+(STATE_TONE[stateKey]==='ok'?'ok':STATE_TONE[stateKey]==='warn'?'warn':'err');
  st.title=`${stockMeta.source||stockMeta.provider||'US-Aktienfeed'}. ${phase||''}\nAußerhalb der regulären US-Börsenzeit sind Analysen Vorbereitung und keine Live-BUY-Freigabe.`;
  if(counts){const rc=stockMeta.discovery?.radar?.candidates?.length||0,bc=stockMeta.discovery?.boats?.candidates?.length||0;counts.textContent=`${stockMeta.updatedThisCycle!=null?stockMeta.updatedThisCycle+' aktualisiert · ':''}${scanned} geladen / ${universeLabel} Universum · ${shown.length} angezeigt · ${rc?'RADAR '+rc+' · ':''}${bc?'BOATS '+bc+' · ':''}★ ${(S.favoriteStocks||[]).length} · Abfrage ${clock(stockMeta.ts)}`;}
  const srcLabel=$('#stockSourceLabel'); if(srcLabel)srcLabel.textContent=String(stockMeta.source||stockMeta.provider||'US-Aktienfeed').includes('Tiingo')?'Tiingo IEX, US-Markt (Primary)':'Twelve Data, US-Markt (Fallback)';
  stockHeatmap(shown);
  const topBox=$('#stockFocus'), top=shown.find(r=>r.symbol===focusStock)||shown[0];
  if(topBox){if(!top)topBox.innerHTML=search?`<div class="stockfocus-empty">Keine geladene Aktie passend zu „${esc(search)}“. Enter oder 🔎 lädt den Titel direkt.</div>`:(filter==='favorites'?'<div class="stockfocus-empty">Noch keine Aktien-Favoriten. Mit ☆ neben einem Titel hinzufügen.</div>':'');else{
    const sz=stockSizing(top), buy=stockLevel(top)===3, tr=stockTradeability(top), opp=stockOpportunity(top); const struct=Number(top.structurePct||0);
    topBox.innerHTML=`<div class="stockfocus-card ${top.light}${buy?' buy':''}"><div class="sf-focus-main"><div class="sf-title"><div><small>TOP-AKTIE AKTUELL</small><h3><button class="favbtn ${isFavStock(top.symbol)?'on':''}" data-favstock="${esc(top.symbol)}" title="Favorit / Depot">${isFavStock(top.symbol)?'★':'☆'}</button><b>${esc(top.symbol)}</b></h3><span class="company-name" title="Vollständiger Firmenname. Warum sinnvoll? Der Ticker allein kann leicht mit ähnlich benannten Wertpapieren verwechselt werden.">${esc((top.securityName&&top.securityName!==top.symbol)?top.securityName:(top.name&&top.name!==top.symbol?top.name:'Firmenname wird noch geladen'))}</span><small class="company-focus" title="Kurzbeschreibung des operativen Fokus aus den verfügbaren Unternehmens-Metadaten. Warum sinnvoll? Sie hilft einzuordnen, wodurch die Aktie wirtschaftlich bewegt werden kann.">${esc((top.companyDescription||'').slice(0,180)||top.sector||'Branche/Fokus noch nicht verfügbar')}</small><small class="company-exchange" title="Primäres Listing laut verfügbaren Metadaten. Warum sinnvoll? Die Hauptbörse hilft bei Handelszeiten, Liquidität und Dateninterpretation. Höchstes aktuelles Volumen wird nur behauptet, wenn es tatsächlich gemessen werden kann.">Börse: ${esc(top.exchange||'n.v.')}</small><span>${esc(top.sector)} · Score ${num(top.score,1)} · CRV ${num(sz?.planCrvAfterCosts ?? top.netCRV,1)}:1 netto${top.preSignalMaturity!=null?' · Reife '+Math.round(top.preSignalMaturity)+'%':''}</span></div><strong>${buy?'🟢 BUY':VERDICT_ICON[top.light]+' '+esc(top.verdict)}</strong></div><div class="sf-grid"><span>Kurs <b>${stockPx(top.priceUsd,top.priceEur)}</b></span><span title="Bei BUY empfohlene Kaufsumme; sonst nur theoretische Größe bzw. kein Trade.">${buy?'Kaufsumme':'Pot. Größe'} <b>${stockSizeDisplay(top,sz)}</b></span><span>Entry <b>${stockPx(top.entryUsd,top.entryEur)}</b></span><span>Stop <b>${stockPx(top.stopUsd,top.stopEur)}</b></span><span>TP1 <b>${stockPx(top.tp1Usd,top.tp1Eur)}</b></span><span>TP2 <b>${stockPx(top.tp2Usd,top.tp2Eur)}</b></span><span title="Nettogewinn des ersten 50-%-Teilverkaufs bei TP1.">TP1 netto <b>${sz?eur(sz.tp1Net,0):'–'}</b></span><span title="Nettogewinn der verbleibenden 50 % bei TP2.">TP2 Rest netto <b>${sz?eur(sz.tp2Net,0):'–'}</b></span><span title="Gesamter Nettogewinn des Standardplans: 50 % bei TP1 + 50 % bei TP2.">Gesamtplan netto <b>${sz?eur(sz.planNet,0):'–'}</b></span><span title="Kursweg vom Einstieg bis TP2. Zu kleine Wege sind bei manueller Flatex-Ausführung praktisch schwer handelbar.">Weg TP2 <b>${num(tr.tp2Pct,1)}%</b></span><span title="Größerer Elliott/Fibonacci-Zielraum aus der aktuellen Struktur. Ergänzende Projektion, kein unmittelbares Kaufsignal.">Strukturpotenzial <b>${struct?num(struct,1)+'%':'–'}</b></span><span class="sf-crowd" title="Such-/Crowd-Aufmerksamkeit separat je Aktie. Dieser Wert verändert den BUY-Score derzeit nicht.">${crowdGauge(top.symbol)}${crowdConfirmGauge(top)}</span></div><div class="opportunity-watch ${opp.ready?'ready':'waiting'}"><b>${buy?'BUY FREIGEGEBEN':opp.label}</b><span>${opp.why?esc(opp.why):(opp.reasons.length?esc(opp.reasons.join(' · ')):'Wartet auf Qualität, CRV, Kursweg und wirtschaftlich relevantes Gewinnpotenzial.')}</span></div><div class="intraday-chart" title="Kursverlauf. Intraday nutzt 5-Minuten-/IEX-Daten; längere Zeiträume werden passend aggregiert nachgeladen. Warum sinnvoll? Elliott-Strukturen sehen auf verschiedenen Zeitebenen unterschiedlich aus; der längere Chart liefert Kontext, aber kein BUY allein."><span>Chart · <select id="stockChartRange" title="Zeitraum wählen. Warum sinnvoll? Kurz zeigt Entry-Struktur, lang zeigt den übergeordneten Elliott-/Trend-Kontext.">${['5','10','30','60','120','180','240','300','1T','5T','1Wo','3Mo','6Mo','12Mo'].map(m=>`<option value="${m}"${String(m)===String(stockChartMinutes)?' selected':''}>${/^\d+$/.test(m)?m+' min':m}</option>`).join('')}</select></span>${spark((stockChartCache.get(top.symbol+'|'+stockChartMinutes)?.rows?.map(x=>x.c)||(top.intraday||[]).slice(-Math.max(1,Math.ceil((Number(stockChartMinutes)||120)/5)))),420,76)}</div><div class="sf-history" title="Verlauf der Setup-Ampel über die letzten 120 Minuten; 8 Segmente à 15 Minuten."><span>120-Min-Verlauf</span>${stockStatusBand(top)}</div>${edgeStrip(top)}<div class="stock-interpret"><b>Was hat sich geändert? · Interpretation</b><span>${top.whyNow?.length?`Warum jetzt? ${esc(top.whyNow.join(' · '))} · `:''}${esc(stockInterpretation(top))}</span><small>Radar/Crowd/Search dienen nur der Discovery · 0 % BUY-Gewicht</small></div><small>${tr.ok?'Ausführbarkeit erfüllt.':'⚠ Rechnerisches Setup, aber Ausführbarkeit/Marktphase erfüllt deine Grenzen noch nicht.'} BUY: Score ≥8, CRV ≥${num(S.minCrvStock,1)}:1, Plan netto ≥${eur(Math.max(Number(S.minNetProfitStock||0),OPPORTUNITY_MIN_NET_EUR),0)}, Kursweg ≥${num(S.minTp2PctStock,1)}%.</small></div>${stockLadder(top)}</div>`;
    topBox.querySelector('[data-favstock]')?.addEventListener('click',e=>toggleStockFavorite(top.symbol,e));
    topBox.querySelector('#stockChartRange')?.addEventListener('change',async e=>{stockChartMinutes=String(e.target.value||'120');const k=top.symbol+'|'+stockChartMinutes;if(!stockChartCache.has(k)){try{const q=new URLSearchParams({symbol:top.symbol,range:stockChartMinutes});if(S.token)q.set('t',S.token);const rr=await fetch('/api/stock-chart?'+q,{cache:'no-store'});const dd=await rr.json();if(dd?.rows?.length)stockChartCache.set(k,dd);}catch{}}renderStocks();});
  }}
  const groups=new Map();
  if(filter==='favorites') groups.set('★ Favoritendepot',shown);
  else for(const r of shown){if(!groups.has(r.sector))groups.set(r.sector,[]);groups.get(r.sector).push(r);}
  box.innerHTML=[...groups.entries()].map(([sector,arr])=>`<section class="stock-sector${filter==='favorites'?' flat-favorites':''}">${filter==='favorites'?'':`<h3>${esc(sector)}</h3>`}${arr.map(r=>{const buy=stockLevel(r)===3,tone=stockStrength(r),tr=stockTradeability(r),sz=stockSizing(r),dm=stockDisplayMeta(r);return `<div class="stockrow ${r.light} tone-${tone}${buy?' buy':''}${signalIsHot('stock',r.symbol)?' signal-hot':''}" draggable="true" data-sym="${esc(r.symbol)}"><div class="sr-head"><button class="draghandle" type="button" title="Aktienfenster ziehen und neu anordnen" aria-label="Aktienfenster neu anordnen">⋮⋮</button><b class="sr-tic">${esc(r.symbol)}</b><button class="favbtn ${isFavStock(r.symbol)?'on':''}" data-favstock="${esc(r.symbol)}" title="${isFavStock(r.symbol)?'Aus Favoriten/Depot entfernen':'Zu Favoriten/Depot hinzufügen'}">${isFavStock(r.symbol)?'★':'☆'}</button><button class="rowmute" data-mutestock="${esc(r.symbol)}">${isStockMuted(r.symbol)?'🔇':'🔊'}</button></div><div class="sr-name"><b>${esc(dm.name)}</b><small>${esc(dm.theme)}</small></div><div class="sr-nums"><span title="Netto-CRV des 50/50-Tradeplans nach geschätzten Flatex/Tradegate-Kosten.">${num(sz?.planCrvAfterCosts ?? r.netCRV,1)} : 1</span><i>·</i><span>Score ${num(r.score,1)}</span>${r.preSignalMaturity!=null?`<i>·</i><span title="Abstand zur vollständigen Opportunity-Freigabe; kein BUY-Signal.">Reife ${Math.round(r.preSignalMaturity)}%</span>`:''}<i>·</i><span title="Kursweg bis TP2">TP2 ${num(tr.tp2Pct,1)}%</span></div><div class="sr-verdict" title="${tr.ok?'Praktisch ausführbar nach deinen Grenzen.':'Noch nicht praktisch ausführbar: Marktphase, Mindestgewinn oder Mindestkursweg nicht erfüllt.'}">${buy?'🟢 BUY':VERDICT_ICON[r.light]+' '+esc(r.verdict)}</div><div class="sr-px">${stockPx(r.priceUsd,r.priceEur)}${sz?`<small> · ${buy?'Plan netto '+eur(sz.planNet,0):'keine Kauf-Freigabe'}</small>`:''}</div><div class="sr-hist" title="120-Minuten-Signalverlauf">${stockStatusBand(r)}</div>${crowdGauge(r.symbol,true)}${crowdConfirmGauge(r,true)}<small class="stock-updated fresh-${stockFreshness(r).key}">${esc(stockUpdateLabel(r))}</small>${edgeStrip(r)}${stockPeek(r)}</div>`}).join('')}</section>`).join('');
  box.querySelectorAll('[data-mutestock]').forEach(b=>b.addEventListener('click',e=>toggleStockMute(b.dataset.mutestock,e)));
  box.querySelectorAll('.stockrow[data-sym]').forEach(row=>row.addEventListener('click',e=>{
    if(e.target.closest('button') || row.classList.contains('dragging')) return;
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
      ts: now, quality: Number(r.score || r.quality || 0),
      executability: Number.isFinite(Number(r.executability)) ? Number(r.executability) : 0,
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
    const res = await fetch('/api/stocks?' + q);
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
    setSys('#sysStocks', data.configured === false ? 'nokey' : 'ok',
      data.configured === false ? ((data.source||'').includes('Tiingo')?'TIINGO_API_TOKEN fehlt':'Aktien-Datenquelle fehlt') : `${data.updatedThisCycle ?? 0} frisch analysiert · ${data.scanned ?? stockRows.length} geladen`);
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
async function searchStockNow() {
  const raw = ($('#stockQ')?.value || '').trim();
  if (!raw || stockSearchBusy || Date.now()-stockSearchLastTs<5000) return;
  stockSearchLastTs=Date.now();
  // Geladene Aktientreffer brauchen keinen API-Aufruf.
  const stock = stockRows.find((r) => r.symbol.toUpperCase() === raw.toUpperCase() || String(r.name || '').toUpperCase() === raw.toUpperCase());
  if (stock) { renderStocks(); return; }
  stockSearchBusy = true;
  const st = $('#stockState');
  if (st) { st.textContent = 'Suche…'; st.className = 'badge'; }
  try {
    const q = new URLSearchParams({ lookup: raw, comp: S.components.join(','), minCrv: S.minCrvStock });
    if (S.token) q.set('t', S.token);
    const res = await fetch('/api/stocks?' + q, { cache: 'no-store' });
    const data = await res.json();
    stockMeta = { ...stockMeta, ...data, refreshedSymbols:[data.row?.symbol].filter(Boolean), ts:Date.now() };
    if (data.row) {
      const m = new Map(stockRows.map((r) => [r.symbol, r])); m.set(data.row.symbol, data.row); stockRows = [...m.values()]; rememberStockRows([data.row]); stockRows=mergeFavoriteRows(stockRows);
    }
    renderQuota(data.quota); checkQuotaPopup(data.quota, data.state);
    if (!res.ok || data.notFound) {
      if (st) { st.textContent = data.notFound ? 'Nicht gefunden' : 'Suche fehlgeschlagen'; st.className = 'badge warn'; st.title = data.error || 'Bitte Ticker versuchen.'; }
    } else if (st) { st.textContent = data.cached ? 'Treffer · Cache' : 'Treffer geladen'; st.className = 'badge ok'; }
    trackStocks();
    renderStocks();
  } catch (e) {
    if (st) { st.textContent = 'Suche fehlgeschlagen'; st.className = 'badge err'; st.title = String(e.message || e); }
  } finally { stockSearchBusy = false; }
}

async function scanOpeningMomentum(force = false) {
  const req=++openingReqSeq;
  try {
    const q = new URLSearchParams(); if (S.token) q.set('t', S.token); if (force) q.set('force','1');
    const res = await fetch('/api/opening?' + q, { cache: 'no-store' });
    const data = await res.json(); if(req!==openingReqSeq)return; openingMeta = data; openingRows = data.rows || []; renderOpeningPanel(); renderStocks(); loadCrowd(false);
  } catch (e) { openingMeta = { state:'error', phaseLabel:'Alpaca nicht erreichbar', phaseHelp:String(e.message||e) }; renderOpeningPanel(); }
}
function setStockPoll() {
  clearTimeout(stockTimer);
  const scheduleStockPoll = () => {
    const primaryTiingo = String(stockMeta?.provider||'').toLowerCase()==='tiingo' || String(stockMeta?.source||'').includes('Tiingo');
    const universe = Number(stockMeta?.universe || 21);
    // Tiingo Power: Deep-Scan alle 2 Minuten. Twelve Data bleibt konservativ/quota-sicher.
    const incomplete = Number.isFinite(universe) ? stockRows.length < universe : true;
    const delay = primaryTiingo ? 2 * 60_000 : (incomplete ? 65_000 : 5 * 60_000);
    stockTimer = setTimeout(async () => {
      if (document.visibilityState === 'visible') await scanStocks(false);
      scheduleStockPoll();
    }, delay);
  };
  scheduleStockPoll();
  clearInterval(openingTimer);
  openingTimer = setInterval(() => { if (document.visibilityState === 'visible') scanOpeningMomentum(false); }, 60_000);
  clearInterval(experimentalTimer); experimentalTimer=setInterval(()=>{if(document.visibilityState==='visible')loadExperimental(false);},15*60_000);
  clearInterval(crowdTimer); crowdTimer=setInterval(()=>{if(document.visibilityState==='visible')loadCrowd(false);},60*60_000);
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
    st.history = appendHistory(coinHistoryStore, r.pair, { ts: now, quality: Number(r.quality || 0), executability: Number(r.executability || 0), light: r.light, crv: Number(r.netCRV || 0) });
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

  const trails = pts.map(({r}) => {
    const h=(r._history||[]).filter((x)=>Date.now()-x.ts<=120*60_000).slice(-8);
    if (h.length < 2) return '';
    const points=h.map((x)=>`${g(x.executability).toFixed(1)},${(200-g(x.quality)).toFixed(1)}`).join(' ');
    return `<polyline class="trail ${r.light}" points="${points}"/>`;
  }).join('');
  const dots = pts.map(({r,x,y,rad}) => {
    const sel=r.pair===selected, ready=buyReady(r);
    return `<g class="dot light-${r.light} ${sel?'sel':''} ${ready?'buy-ready':''}" data-pair="${r.pair}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">
      <circle class="hit" cx="0" cy="0" r="${rad+7}"/>
      <circle class="core" cx="0" cy="0" r="${sel?rad+1.5:rad}"/>
      <text x="0" y="2.2">${sym(r.pair).slice(0,5)}</text>
      <title>${sym(r.pair)} · Q ${r.quality} · H ${r.executability} · CRV ${r.netCRV}:1 · ${trendArrow(r)} ${r.light}</title>
    </g>`;
  }).join('');

  svg.innerHTML = `
    <rect class="quad qa" x="100" y="0" width="100" height="100"/>
    <rect class="quad qb" x="0" y="0" width="100" height="100"/>
    <rect class="quad qc" x="100" y="100" width="100" height="100"/>
    <line class="ax" x1="100" y1="0" x2="100" y2="200"/><line class="ax" x1="0" y1="100" x2="200" y2="100"/>
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
function render() {
  if (!pinned || !rows.some((r) => r.pair === selected)) {
    const best = rows.find((r) => r.light === 'green') || rows.find((r) => r.light === 'yellow') || rows[0];
    selected = best?.pair ?? null;
    if (pinned && !rows.some((r) => r.pair === selected)) pinned = false;
  }
  const reg = $('#regime');
  reg.textContent = `${meta.marketRegime || '–'} · ${Math.round((meta.breadth || 0) * 100)} % über VWAP`;
  reg.dataset.tip = 'Marktregime: Risk-On = breite positive Marktstruktur, Risk-Off = breite Schwäche. Der Prozentwert zeigt den Anteil der gescannten Coins oberhalb ihres volumengewichteten Durchschnittspreises (VWAP). Marktfilter, kein eigenständiges Kaufsignal.';
  reg.removeAttribute('title');
  reg.className = 'regime-btn '+(meta.marketRegime || '').toLowerCase().replace('-', '');
  const rex=$('#regimeExplain'); if(rex && !rex.classList.contains('hidden')) rex.innerHTML=regimeExplanation();

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
  $('#sEquity').value = S.equity; $('#sRisk').value = S.riskPct; $('#sMaxTrade').value = S.maxTradeEur; $('#sMinCrvCoin').value = S.minCrvCoin; $('#sMinCrvStock').value = S.minCrvStock; $('#sMinNetProfit').value = S.minNetProfitStock; $('#sMinTp2Pct').value = S.minTp2PctStock;
  $('#sDeep').value = S.deep; $('#sCoinCount').value = S.coinCount; $('#sStockCount').value = S.stockCount;
  $('#sWatch').value = S.watch; $('#sToken').value = S.token; $('#sMin').value = S.minQ;
  $('#sZone').checked = S.onlyZone; $('#sTheme').value = S.theme;
  $('#sTax').value = S.taxPct; $('#sMode').value = S.analysisMode;
  $('#sStockSound').checked = !!S.stockSound;
  $$('#sComponents input[data-comp]').forEach((c) => { c.checked = S.components.includes(c.dataset.comp); });
  updateCountsInfo();
  $('#settings').classList.add('open');
}
function updateCountsInfo() {
  const el = $('#sCountsInfo'); if (!el) return;
  el.innerHTML = `Zuletzt: <b>${meta.deepCount ?? '–'}</b> Coins gescannt von <b>${meta.universe ?? '–'}</b> verfügbaren EUR-Paaren · `
    + `<b>${stockMeta.scanned ?? stockRows.length}</b> Aktien analysiert von <b>${stockMeta.universe ?? 21}</b> im Universum. `
    + 'Gescannt und angezeigt sind bewusst getrennt: die Anzeige zu verkleinern spart keine API-Abfragen.';
}
function applySettings() {
  const prevAnalysis = S.analysisMode + '|' + S.components.join(',') + '|' + S.minCrvStock;
  S.equity = +$('#sEquity').value || DEFAULTS.equity;
  S.riskPct = +$('#sRisk').value || DEFAULTS.riskPct;
  S.maxTradeEur = Math.max(100, +$('#sMaxTrade').value || DEFAULTS.maxTradeEur);
  S.minCrvCoin = Math.max(1, +$('#sMinCrvCoin').value || DEFAULTS.minCrvCoin);
  S.minCrvStock = Math.max(1, +$('#sMinCrvStock').value || DEFAULTS.minCrvStock);
  S.minNetProfitStock = Math.max(0, +$('#sMinNetProfit').value || 0);
  S.minTp2PctStock = Math.max(0, +$('#sMinTp2Pct').value || 0);
  S.deep = Math.min(20, Math.max(4, +$('#sDeep').value || DEFAULTS.deep));
  S.coinCount = Math.min(50, Math.max(3, +$('#sCoinCount').value || DEFAULTS.coinCount));
  S.stockCount = Math.min(50, Math.max(3, +$('#sStockCount').value || DEFAULTS.stockCount));
  S.watch = $('#sWatch').value.toUpperCase().replace(/\s/g, '');
  S.token = $('#sToken').value.trim();
  S.minQ = +$('#sMin').value || 0;
  S.onlyZone = $('#sZone').checked;
  S.theme = $('#sTheme').value;
  S.taxPct = Math.min(60, Math.max(0, +$('#sTax').value || 0));
  S.analysisMode = $('#sMode').value;
  S.stockSound = $('#sStockSound').checked;
  const picked = $$('#sComponents input[data-comp]').filter((c) => c.checked).map((c) => c.dataset.comp);
  S.components = picked.length ? picked : [...ALL_COMPONENTS];
  saveSettings(); applyTheme(); renderStocks();
  $('#settings').classList.remove('open');
  scan(true);
  // Aktien nur dann frisch anfordern, wenn sich die Analyse geändert hat —
  // jeder erzwungene Aktien-Refresh kostet echte Twelve-Data-Credits.
  const changed = prevAnalysis !== S.analysisMode + '|' + S.components.join(',') + '|' + S.minCrvStock;
  scanStocks(changed);
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

/* ------------------------------------------------------------------- Events */
$('#scan').onclick = () => { scan(true); scanStocks(false); scanOpeningMomentum(true); loadExperimental(true); loadCrowd(true); loadLearning(); loadHealth(); };
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
$('#stockQ').oninput = () => renderStocks();
$('#stockQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); searchStockNow(); } });
$('#stockSearchGo').onclick = searchStockNow;
$('#stockF').onchange = () => renderStocks();
$('#iv').onchange = () => setPoll(+$('#iv').value);
$('#x').onclick = closeDetail;
$('#qClose').onclick = () => $('#quotaModal').classList.remove('open');
$('#qDismiss').onclick = () => $('#quotaModal').classList.remove('open');
$('#modal').onclick = (e) => { if (e.target.id === 'modal') closeDetail(); };
$('#settings').onclick = (e) => { if (e.target.id === 'settings') $('#settings').classList.remove('open'); };
$('#more').onclick = () => { showRest = !showRest; renderList(); };
$('#updateReload').onclick = hardReload;
$('#dcopy').onclick = (e) => {
  const r = rows.find((x) => x.pair === selected);
  if (r) copy(orderPlan(r), e.target);
};
$$('[data-jump]').forEach(b=>b.onclick=()=>document.querySelector(b.dataset.jump)?.scrollIntoView({behavior:'smooth',block:'start'}));
document.body.addEventListener('pointerdown', () => audio(), { once: true });

/* --------------------------------------------------------------------- Boot */
applyTheme();
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
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return; reloaded = true; location.reload();
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
$('#regime')?.addEventListener('click',()=>{const el=$('#regimeExplain');if(!el)return;const opening=el.classList.contains('hidden');el.classList.toggle('hidden',!opening);el.innerHTML=regimeExplanation();$('#regime').setAttribute('aria-expanded',opening?'true':'false');});
document.addEventListener('click',(e)=>{if(!e.target.closest('.hstat')){const el=$('#regimeExplain');if(el&&!el.classList.contains('hidden')){el.classList.add('hidden');$('#regime')?.setAttribute('aria-expanded','false');}}});
renderSignalBanner();

loadHealth();
scan(false);
scanStocks(false);
scanOpeningMomentum(false);
loadExperimental(false);
loadCrowd(false);
loadLearning();
setPoll(S.interval);
setStockPoll();
setHealthPoll();
setLearningPoll();
