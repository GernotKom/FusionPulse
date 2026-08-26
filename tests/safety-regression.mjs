import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { analyse, analyseStock, aladdinIntelligence } from '../src/worker.js';

function coinBars(n=82){
  const out=[]; const t0=1_700_000_000;
  for(let i=0;i<n;i++){
    const base=100 + i*0.07 + Math.sin(i/5)*0.35;
    out.push({t:t0+i*300,o:base-0.08,h:base+0.25,l:base-0.25,c:base,v:900+i*5});
  }
  return out;
}
function stockSrc(withVolume=true){
  const values=[];
  const start=Date.UTC(2026,7,24,12,0,0);
  for(let i=0;i<40;i++){
    const c=100+i*0.16+Math.sin(i/4)*0.2;
    values.unshift({datetime:new Date(start+i*300000).toISOString().slice(0,19).replace('T',' '),open:String(c-.1),high:String(c+.25),low:String(c-.25),close:String(c),volume:withVolume?String(100000+i*2500):'0'});
  }
  return {meta:{name:'Fixture Inc.',exchange:'NASDAQ',currency:'USD'},values};
}

function stockFusionBreakout(late=false){
  const values=[]; const start=Date.UTC(2026,7,25,13,0,0); let c=94;
  for(let i=0;i<40;i++){
    if(i<20)c+=0.30;
    else if(i<34)c+=(i%2?0.015:-0.012);
    else c+=(late?[0.20,0.30,0.60,1.00,1.50,2.00]:[0.02,0.03,0.05,0.18,0.32,0.45])[i-34]||0;
    const vol=i<34?110000:200000+(i-34)*80000;
    const range=i<34?(i<20?0.42:0.22):(late?0.8+(i-34)*0.2:0.35+(i-34)*0.08);
    values.unshift({datetime:new Date(start+i*300000).toISOString(),open:String(c-.07),high:String(c+range),low:String(c-range*.65),close:String(c),volume:String(vol)});
  }
  return {meta:{name:'Fusion Fixture Inc.',exchange:'NASDAQ',currency:'USD'},values};
}

// 1) Coin ohne Orderbuch darf nicht grün werden und die Executability-Grenze nie erreichen.
const fullCoin=analyse({pair:'TST-EUR',c5:coinBars(),btc5:coinBars(),book:{spread:0.0004,imbalance:0.2,buyCapacity:200000,slipBps:3},fee:0.001,mode:'composite',minCrv:2});
const noBook=analyse({pair:'TST-EUR',c5:coinBars(),btc5:coinBars(),book:null,fee:0.001,mode:'composite',minCrv:2});
assert.ok(noBook,'Coin-Fixture muss analysierbar sein');
assert.notEqual(noBook.light,'green','Fehlendes Orderbuch darf kein grünes Coin-Signal erzeugen');
assert.ok(Number(noBook.executability)<=6.4,'Executability ohne Orderbuch muss <= 6.4 bleiben');
if(fullCoin) assert.ok(Number(noBook.executability)<=Math.max(6.4,Number(fullCoin.executability)),'Fehlendes Buch darf Executability nicht künstlich erhöhen');

// 2) Aktie ohne Volumen darf durch fehlende VWAP/RVOL-Komponenten nicht kaufbar werden.
const volStock=analyseStock('FIX','Technologie',stockSrc(true),1.17,new Set(['ema21','mtf','volume','vwap']),3);
const noVolStock=analyseStock('FIX','Technologie',stockSrc(false),1.17,new Set(['ema21','mtf','volume','vwap']),3);
assert.ok(noVolStock,'Aktien-Fixture ohne Volumen muss analysierbar bleiben');
assert.equal(noVolStock.volumeKnown,false,'Volumenstatus muss explizit unbekannt sein');
assert.notEqual(noVolStock.light,'green','Fehlendes Volumen darf kein grünes Aktien-Signal erzeugen');
assert.ok(Number(noVolStock.score)<=6.4,'Score ohne belastbares Volumen muss im Beobachtungsbereich bleiben');
assert.equal(noVolStock.executability,null,'Executability ohne Volumenbasis muss n.v. bleiben');

// 3-5) Frontend-Sicherheitsregeln als Guard gegen spätere Regressionen.
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
assert.match(app,/const soundEligible = fresh\.key==='live' && tr\.marketOk && tr\.ok/,'Aktien-Ton muss Live-Freshness und Marktphase prüfen');
assert.match(app,/v!=null && Number\.isFinite\(Number\(v\)\)/,'Detailfaktoren müssen null-sicher sein und null explizit als n.v. behandeln');
/* v3.6.5: Die Regel bleibt (Crowd-Werte duerfen nicht ueber ihre Gueltigkeit
   hinaus stehenbleiben), die Umsetzung wurde STRENGER. Vorher wurden nur die
   gerade angefragten Symbole pauschal geloescht — Symbole, die aus der Liste
   fielen, blieben ewig haengen. Jetzt laeuft alles ueber Alter ab, unabhaengig
   davon, ob es noch angefragt wird. Pauschales Loeschen ist ausserdem nicht
   mehr moeglich, weil der Server bewusst zwischengespeicherte Staende liefert,
   um das SerpAPI-Kontingent zu schonen. */
assert.match(app,/function crowdPrune\(maxAgeMs\)/,'Crowd-Werte brauchen eine Ablauflogik');
assert.match(app,/if\(!ts\|\|now-ts>max\)\{ crowdMap\.delete\(sym\); removed\+\+; \}/,'Abgelaufene Crowd-Werte müssen entfernt werden');
assert.match(app,/crowdPrune\(\);/,'Die Ablauflogik muss vor jeder neuen Abfrage laufen');
assert.match(app,/\$\{eur\(eurVal, d\)\}.*\(\$\{usd\(usdVal, d\)\}\)/s,'Aktienkurse müssen EUR zuerst und USD in Klammern anzeigen');


assert.match(app,/if \(data\.length === 1\)/,'Sparkline muss einen Einzelwert ohne Division durch 0 behandeln');
assert.match(app,/const opportunityEligible=stockOpportunity\(r\)\.ready/,'Opportunity-Regel darf im Tonpfad nicht doppelt implementiert sein');
assert.match(app,/function setMiniStatus\(/,'Tiingo-/Header-Ministatus-Helfer muss definiert sein');
const index=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
assert.match(index,/id="regime" class="regime-btn fast-tip"/,'Risk-Regime muss schnellen Tooltip verwenden');
assert.match(index,/id="miniTiingo" class="mini-dot busy fast-tip"/,'Tiingo-T muss schnellen Tooltip verwenden');
assert.match(index,/class="hclock fast-tip"/,'Countdown muss schnellen Tooltip verwenden');

// v3.1.7 UI/data guards
assert.match(app, /OPPORTUNITY_MIN_NET_EUR\s*=\s*20/, 'FusionPulse adaptive absolute opportunity floor must remain explicit and reachable');
assert.match(app, /BOATS \$\{mark\(boats\)\}/, 'Tiingo UI must report BOATS separately');
const workerText=fs.readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');
assert.match(workerText, /out\.tests\.boats=/, 'Tiingo validation must test BOATS separately');
assert.doesNotMatch(workerText, /d\.values\.length>=24/, 'Tiingo 5-min validation must not use the arbitrary 24-bar gate');
assert.match(workerText, /const usable=vals\.length>=2 && ohlcKnown/, 'Tiingo 5-min validation must test actual bar usability');
assert.match(app, /letzter Bar vor/, 'Tiingo UI must expose bar count/freshness for diagnosis');
assert.match(app, /UNTER ZONE = Kurs liegt noch unter/, 'Zone tooltip must explain below/in/above');
assert.match(app, /Pullback: Der Kurs ist zuerst gestiegen/, 'Pullback tooltip must be novice-readable');


// v3.2.1 Tiingo Primary / Whole-Market Radar guards
const wrangler=fs.readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8');
assert.match(wrangler,/"TIINGO_STOCKS_MODE": "primary"/,'Tiingo Primary must remain enabled');
assert.match(workerText,/Discovery only: unusual overnight move[\s\S]*NEVER enters analyseStock\/BUY/,'BOATS discovery must be explicitly isolated from BUY');
assert.match(workerText,/row\.discovery=\{type:'iex-radar',\.\.\.rm,buyWeight:0\}/,'IEX Radar candidate metadata must carry 0 BUY weight');
assert.match(workerText,/row\.discovery=\{type:'boats',\.\.\.bm,buyWeight:0\}/,'BOATS candidate metadata must carry 0 BUY weight');
assert.match(workerText,/const syms=\[\.\.\.favPick,\.\.\.recheckPick,\.\.\.gainerPick,\.\.\.radarPick,\.\.\.boatsPick,\.\.\.explore\]\.slice\(0,deepLimit\)/,'Deep scan must cap adaptive candidate batch at the configurable deep limit');
assert.match(workerText,/await tiingoFetch\(env,'\/iex'\)/,'Whole-market Radar must use Tiingo IEX bulk snapshot');
assert.match(workerText,/stockMinute%2===1[\s\S]*tiingoIexMarketRadar\(env,80,true\)/,'Server scheduler must keep the market radar independent of the browser');
assert.match(workerText,/execution!=='server'&&!force[\s\S]*readLatestPersistedStockScan/,'Browser stock requests must consume the persisted server scan instead of starting a duplicate market scan');
assert.match(workerText,/source IN \('Twelve Data','Tiingo IEX'\)/,'Learning must accept Tiingo IEX history after Primary migration');

// v3.2.2 Common-stock gate: ETFs/ETPs must not consume stock deep-scan slots.
assert.match(workerText,/const (?:FUND_NAME_RE|NON_COMMON_EQUITY_RE)=/,'Radar must define a defensive fund/product name gate');
assert.match(workerText,/DAILY TARGET/,'Radar fund gate must catch leveraged daily-target products');
assert.match(workerText,/radar=\{\.\.\.radar,rows:await filterRadarToCommonStocks\(env,radar\.rows\|\|\[\],20\)/,'Deep-scan radar candidates must pass through common-stock validation before analysis');
assert.match(workerText,/tradableStock:Boolean\(active&&!nonCommon\)/,'Only active verified common stocks may enter the radar queue');
assert.match(workerText,/Metadaten(?:prüfung|pruefung) fehlgeschlagen/,'Metadata failure must fail closed instead of admitting an unknown instrument');
assert.match(workerText,/\/tiingo\/daily\/\$\{encodeURIComponent\(sym\)\}/,'Common-stock validation must use stable Tiingo EOD metadata');


// v3.2.6 Elliott-first / Market-Gainer guards
assert.match(workerText,/const ell=Number\(r\?\.elliott\)\|\|0/,'Deep recheck ranking must explicitly include Elliott structure');
assert.match(workerText,/openingGainers\(radar\.rows\|\|\[\],capGainer\)/,'Verified market gainers must receive dedicated discovery slots (now scaled with the configurable deep limit)');
assert.match(workerText,/security_meta:v327:/,'Security cache generation must be invalidated for v3.2.6');
assert.match(workerText,/independentTwinEpisodes\(cur,rows\)/,'Historical Twin must collapse correlated snapshots into independent episodes');
assert.doesNotMatch(workerText,/eligible\.slice\(0,12\)/,'Historical Twin must not hard-fill a fixed n=12 sample');
assert.match(workerText,/MAX_DIST=3\.25/,'Historical Twin must use a fixed similarity gate instead of filling to a target n');


// v3.3.4 Radar-to-Deep-Scan / click-through guards
assert.match(workerText,/verifiedDiscoveryNow=new Set/,'Currently verified Discovery titles must be eligible for safe carry between deep-scan cycles');
assert.match(workerText,/radarPick\.length>=capRadar/,'Whole-Market Radar must have meaningful priority in the deep-scan queue (now scaled with the configurable deep limit)');
assert.match(app,/async function openStockFromDiscovery\(symbol\)/,'Discovery cards need a dedicated deep-load/open path');
assert.match(app,/openStockFromDiscovery\(b\.dataset\.openstock\)/,'Whole-Market/Extended discovery cards must use the dedicated open path');
// v3.2.7 ETF cache-leak regression guard
assert.match(workerText,/function stripKnownNonCommon\(rows\)/,'Cached stock rows must have a hard non-common sanitizer');
assert.match(workerText,/const cleanMemo=stripKnownNonCommon\(stockMemo\.rows\)/,'Fast memo return must sanitize cached ETF\/ETP rows');
assert.match(workerText,/const staleRows=stripKnownNonCommon\(stockMemo\.rows\|\|\[\]\)/,'Stale return must sanitize cached ETF\/ETP rows');


// v3.2.8 browser cache regression: stale Discovery must never bypass the Worker ETF gate.
assert.match(app,/const STOCK_LAST_ROWS_KEY='fp\.stockLastRows\.v2'/,'Browser stock cache must use a new generation');
assert.match(app,/localStorage\.removeItem\(LEGACY_STOCK_LAST_ROWS_KEY\)/,'Legacy v1 stock cache must be purged');
assert.match(app,/sym!==String\(focusStock\|\|''\)\.toUpperCase\(\)/,'Cached fallback may preserve only the explicitly focused non-favorite stock');
assert.match(app,/!uiStockRowAllowed\(old\) \|\| m\.has\(sym\)/,'Cached fallback rows must remain sanitized');
assert.match(app,/UI_NON_COMMON_SYMBOL_DENY=new Set\(\['CRWU','AXTU'\]\)/,'Frontend defensive deny-set must block known polluted ETF symbols');

// v3.3.8 discovery-focus regression guards
assert.match(app,/qm=focusQuoteMeta\(top\)/,'Selected-stock focus must define quote metadata before rendering the live bar');
assert.match(app,/stockfocus-loading/,'Discovery click must show the selected ticker immediately while deep analysis loads');
assert.match(app,/Speed = kurzfristige Kursänderung der letzten verfügbaren 5-Minuten-Periode/,'Opening Momentum must explain and display Speed');

// v3.4.0 audit regression guards
assert.match(app,/const marketOk = !!currentPhase/,'Missing market phase must fail closed');
assert.match(app,/fresh\.key === 'live'/,'Stock BUY level must require live freshness');
assert.match(app,/const regimeExplanation =/,'Regime explanation must be defined');
assert.match(app,/let stockLookupSeq = 0/,'Stock lookup needs a sequence guard');
assert.match(app,/if\(req!==stockLookupSeq\)return/,'Late stock lookup responses must be ignored');
assert.match(app,/stockFocusRefresh/,'Focus window must offer per-stock refresh');
assert.match(app,/Date\.now\(\)-Number\(hit\.ts\|\|0\)>120_000/,'Chart cache needs TTL');
assert.match(workerText,/if\(ageMin!=null && ageMin>30\) return null/,'Old radar quotes must be filtered');
assert.match(workerText,/signal: AbortSignal\.timeout\(20_000\)/,'Provider fetches need timeouts');
// v3.4.1 P0 runtime regression guard
assert.match(workerText,/const priceSource = Number\(snap\.minuteBar\?\.c\|\|0\)>0 \? 'minute'/,'Alpaca momentum must define priceSource before returning it');
assert.match(app,/Tages-Bar\/Fallback/,'Daily Alpaca fallback must be visibly labelled and must not look live');
// v3.4.2 Large-cap-only automatic stock discovery
assert.match(workerText,/const LARGE_CAP_RADAR_SYMBOLS = new Set/,'Automatic stock discovery must use an explicit large-cap allowlist');
assert.match(workerText,/\.filter\(r=>largeCapRadarAllowed\(r\.symbol\)\)/,'Whole-market radar must exclude non-large-cap symbols before ranking/display');
assert.match(workerText,/x=>x\?\.m\?\.tradableStock && largeCapRadarAllowed\(x\?\.r\?\.symbol\)/,'Verified radar candidates must still pass the large-cap gate');
assert.match(workerText,/const OPENING_UNIVERSE = \[\.\.\.LARGE_CAP_RADAR_SYMBOLS\]/,'Opening Momentum base universe must be large-cap only');

// v3.4.3 Situation Engine / freshness / visible methods guards
assert.match(workerText,/v3\.4\.3 Situation Engine/,'Radar must explicitly use the v3.4.3 Situation Engine');
assert.match(workerText,/situation='OPENING DRIVE'/,'Situation Engine must identify opening-drive transitions');
assert.match(workerText,/situation='BREAKOUT PRESSURE'/,'Situation Engine must identify breakout pressure');
assert.match(workerText,/situation='REVERSAL RECLAIM'/,'Situation Engine must identify reversal/reclaim states');
assert.match(workerText,/source:'Tiingo IEX Situation Radar',buyWeight:0/,'Situation Radar must remain pure Discovery with 0 direct BUY weight');
assert.match(workerText,/Situation-\/Erklaerungsfelder: Discovery bleibt 0 % direktes BUY-Gewicht/,'Situation Radar must remain 0 % direct BUY weight even though FusionPulse Adaptiv may use deep-situation evidence');
assert.ok(Number(noVolStock.situationScore)<=42,'Missing stock volume must cap Situation Score instead of improving Discovery');
assert.match(index,/id="analysisMethodsDock"/,'Active analysis methods must be visible in the permanent bottom signal bar');
assert.match(app,/ageMin<3\?'green':ageMin<5\?'yellow':ageMin<10\?'orange':'red'/,'Category freshness must use green <3, yellow 3-5, orange 5-10, red >=10 minutes');
assert.match(app,/stockRecoveryNeeded\(\)/,'Stock polling must include stale-recovery logic');
assert.match(app,/stockSnapshotAgeMs\(\)>=3\*60_000/,'Opening\/regular stock recovery must start after 3 minutes of stale data');

// v3.5.0 Claude-Modus: additive Parallelbewertung mit erhaltenen Fail-Closed-Regeln
{
  // Jede analysierte Zeile muss ein claude-Objekt tragen (Server rechnet immer, Client schaltet nur um).
  assert.ok(fullCoin?.claude && typeof fullCoin.claude.light==='string','Coin-Analyse muss claude-Bewertung liefern');
  const stFull=analyseStock('TST','Test',stockSrc(true),1.08,undefined,3);
  assert.ok(stFull?.claude && typeof stFull.claude.light==='string','Aktien-Analyse muss claude-Bewertung liefern');
  // Fail-closed bleibt: ohne Orderbuch darf auch der Claude-Modus niemals grün werden.
  assert.notEqual(noBook?.claude?.light,'green','Claude-Modus: fehlendes Orderbuch darf kein Grün erzeugen');
  // Fail-closed bleibt: ohne Volumenbasis darf der Claude-Modus bei Aktien niemals grün werden.
  const stNoVol=analyseStock('TST','Test',stockSrc(false),1.08,undefined,3);
  assert.notEqual(stNoVol?.claude?.light,'green','Claude-Modus: fehlendes Aktienvolumen darf kein Grün erzeugen');
  // Erwartungswert muss ausgewiesen und endlich sein — kein NaN in die UI.
  assert.ok(Number.isFinite(Number(stFull.claude.expectancyR)),'Claude-Erwartungswert (Aktie) muss endlich sein');
  assert.ok(Number.isFinite(Number(fullCoin.claude.expectancyR)),'Claude-Erwartungswert (Coin) muss endlich sein');
  // Claude bleibt parallel. Ab v3.5.2 ist die normale Ansicht FusionPulse Adaptiv; Legacy wird separat fuer Audit/Vergleich mitgeliefert.
  assert.ok(stFull.legacy && ['red','yellow','green'].includes(stFull.legacy.light),'Legacy-Ampel muss separat fuer Audit/Vergleich vorhanden bleiben');
  // Client: Umschaltung, Overlay und Gate-Konstanten muessen existieren.
  assert.match(app,/const CLAUDE_MIN_CRV_STOCK = 1\.6/,'Claude-Aktien-CRV-Gate muss definiert sein');
  assert.match(app,/const CLAUDE_MIN_CRV_COIN = 1\.4/,'Claude-Coin-CRV-Gate muss definiert sein');
  assert.match(app,/function claudeOverlayRow/,'Claude-Overlay muss existieren');
  assert.match(app,/r\.fpBase/,'Claude-Overlay muss Originalwerte reversibel sichern');
  assert.match(app,/S\.claudeMode && r\.claude/,'Claude-Gates duerfen nur mit vorhandener claude-Bewertung greifen');
  assert.match(index,/id="sClaudeMode"/,'Settings muessen den Claude-Modus-Schalter enthalten');
}

console.log('✓ FusionPulse safety regressions: OK');

// v3.5.1 Konfigurierbare Aktien-Scan-Tiefe + Tiingo-Kontingent-Schätzung
{
  assert.match(workerText,/const STOCK_DEEP_MIN=15, STOCK_DEEP_MAX=40, STOCK_DEEP_DEFAULT=20;/,'Deep-scan slider bounds must be defined');
  assert.match(workerText,/async function readStockDeepLimit\(env\)/,'Deep-scan limit must be readable server-side (persisted, cron-shared)');
  assert.match(workerText,/async function persistStockDeepLimit\(env, n\)/,'Deep-scan limit must be persistable server-side');
  assert.match(workerText,/const deepLimit=await readStockDeepLimit\(env\);/,'Deep-scan queue must actually use the configurable limit, not a hardcoded 20');
  // Tiingo hat keinen öffentlichen usage-Endpoint/Header -> App-Zählung muss explizit als solche gekennzeichnet sein.
  assert.match(workerText,/state:'app-estimate'/,'Tiingo quota must be honestly labelled as an app-side estimate, not vendor-confirmed usage');
  assert.match(workerText,/const TIINGO_PLAN_LIMITS = \{ hourly: 10_000, daily: 100_000 \};/,'Tiingo plan limits must reflect the public Power pricing page');
  assert.match(workerText,/function noteTiingoCall\(env\)/,'Every Tiingo call must be counted for the quota estimate');
assert.match(index,/id="sStockDeep"/,'Settings must contain the stock deep-scan slider');
  assert.match(index,/id="tiingoQuotaBox"/,'Settings must show the Tiingo quota estimate box');
  assert.match(app,/async function loadTiingoQuota/,'Client must load quota/deep-limit from the worker');
  // Bug gefunden im Funktionsnachweis: bei einem Tiingo-Fetch-Fehler (z.B. Rate-Limit,
  // Netzwerkproblem) fiel quota/stockDeep aus der Fehlerantwort -> genau dann, wenn
  // die Kontingentanzeige am wichtigsten ist, blieb sie leer. Muss auch im catch-Zweig da sein.
  const statusRouteBlock = workerText.slice(workerText.indexOf("url.pathname === '/api/tiingo/status'"), workerText.indexOf("url.pathname === '/api/tiingo/boats'"));
  assert.match(statusRouteBlock,/catch\(e\)\{ return json\(\{configured:true,authenticated:false,state:'error',error:String\(e\.message\|\|e\),version:APP_VERSION,quota:tiingoQuotaView\(\),stockDeep:deepLimit/,'Tiingo status error path must still return quota + stockDeep for diagnosis');
}

console.log('✓ FusionPulse v3.5.1 deep-scan/quota regressions: OK');

// v3.5.3 FusionPulse Adaptiv + Opportunity Lifecycle + Audit A/B. Claude-Methodik ist LOCKED.
{
  const sha=(x)=>crypto.createHash('sha256').update(x).digest('hex');
  const block=(text,marker)=>{const a=text.indexOf(marker);assert.ok(a>=0,`Marker fehlt: ${marker}`);const b=text.indexOf('  })();',a);assert.ok(b>a,`Blockende fehlt: ${marker}`);return text.slice(a,b+'  })();'.length);};
  assert.equal(sha(block(workerText,'// ---- v3.5.0 CLAUDE-MODUS (additiv)')),'1a6acdf20ff3de5eb6642c7d4a5e99c979deb3112570aa6918f642db92917bb5','Claude Coin-Methodik darf nicht veraendert werden');
  assert.equal(sha(block(workerText,'// ---- v3.5.0 CLAUDE-MODUS (additiv, verändert Legacy-Werte NICHT)')),'52f69351e1ff3367ed8e14b5adabf6aeb106c6ac5826ab2ed7c615a863baca4c','Claude Aktien-Methodik darf nicht veraendert werden');
  const ca=app.slice(app.indexOf('/* ---- v3.5.0 Claude Modus'),app.indexOf('if (!Array.isArray(S.components)',app.indexOf('/* ---- v3.5.0 Claude Modus')));
  assert.equal(sha(ca),'de85b209bbed1636b683c509b3256fd701ce5c15261c507d5f4682622e579cb2','Claude Client-Konstanten duerfen nicht veraendert werden');
  const ov=app.slice(app.indexOf('/* ---- Claude-Modus-Overlay'),app.indexOf('function buyReady',app.indexOf('/* ---- Claude-Modus-Overlay')));
  assert.equal(sha(ov),'9e6b5efc81bd1c3237ed7ca5b9e5564ea49abb1441bacd37f3be7d7849c1e73e','Claude Overlay muss unveraendert bleiben');

  assert.match(workerText,/v3\.5\.3 FUSIONPULSE ADAPTIV/,'Eigener adaptiver Aktienmodus muss serverseitig separat existieren');
  assert.match(workerText,/targetRefWindow=bars\.slice\(-40,-4\)\.slice\(-36\)/,'v3.5.3 target projection must use an independent 36-bar swing window');
  assert.match(workerText,/if\(squeezeRelease\|\|brokePriorHigh\)\{[\s\S]*1\.618\*projectionBase/,'Breakout target must remain available even after entry has already cleared the short priorHigh');
  assert.match(workerText,/deepRecheckRank\(\)[\s\S]*const ell=Number\(r\?\.elliott\)/,'Deep recheck must still read Elliott evidence');
  const st=analyseStock('TST','Tech',stockFusionBreakout(false),1.17,new Set(['ema21','mtf','volume','vwap','elliott']),3);
  assert.ok(st?.fusion,'FusionPulse adaptive assessment must be returned separately');
  assert.equal(st.light,'green','A fresh high-quality measured-structure breakout must be reachable in FusionPulse mode');
  assert.ok(Number(st.netCRV)>=3,'FusionPulse green stock must satisfy configured structural CRV >=3');
  assert.ok(Number(st.elliott)>=5.8,'Stock Elliott evidence must now be real and finite, not the former missing field');
  const late=analyseStock('TST','Tech',stockFusionBreakout(true),1.17,new Set(['ema21','mtf','volume','vwap','elliott']),3);
  assert.notEqual(late.light,'green','Overextended late chase must not become green in FusionPulse mode');
  const nv=analyseStock('TST','Tech',stockSrc(false),1.17,new Set(['ema21','mtf','volume','vwap','elliott']),3);
  assert.notEqual(nv.light,'green','FusionPulse mode remains fail-closed without stock volume');

  assert.match(app,/const structuralCrv = Number\(r\.netCRV \?\? 0\)/,'FusionPulse client must separate structural CRV from 50\/50 plan efficiency');
  assert.match(app,/planEfficiency >= FUSION_MIN_PLAN_EFFICIENCY/,'FusionPulse plan efficiency must be a separate reachable gate');
  assert.match(app,/FUSION_MIN_NET_RISK_MULT = 0\.75/,'Economic relevance must scale with the real risk budget rather than notional');
  assert.match(app,/reachableCap=Math\.max\(OPPORTUNITY_MIN_NET_EUR,riskBudget\)/,'Economic gate must be capped by the current risk budget so it cannot silently force ~6R');
  assert.match(app,/Number\(S\.minNetProfitStock\)===75[\s\S]*S\.minNetProfitStock=30/,'v3.5.3 must migrate the former 75-EUR default to a risk-calibrated reachable floor');
  assert.match(workerText,/const lifecycle=decelerating\?'LATE':ignition\?'IGNITION':prep\?'PREP'/,'Radar must model opportunity lifecycle states');
  assert.match(workerText,/NEU: \$\{prevSituation\} -> \$\{situation\}/,'Fresh state transitions must be explicitly visible in why-now reasons');
  assert.match(workerText,/lifeBonus=life==='IGNITION'\?16:life==='PREP'\?10/,'Deep-scan maturity must prioritize ignition\/prep over late continuation');
}

console.log('✓ FusionPulse v3.5.3 adaptive/target/economic regressions: OK');

// v3.5.4 Modul 0: Attribution & Overfitting-Guard. Reine Auswertung, veraendert keinen Score.
{
  // Statische Vertragspruefungen: die Sicherheitslogik des Guards muss erhalten bleiben.
  assert.match(workerText,/MODUL 0 · CLAUDE ATTRIBUTION & OVERFITTING GUARD/,'Attribution-Guard-Modul muss vorhanden sein');
  assert.match(workerText,/function wilsonLower\(wins, n\)/,'Wilson-Untergrenze muss fuer ehrliche Kleinstichproben verwendet werden');
  assert.match(workerText,/function collapseEpisodes\(rows\)/,'Snapshots derselben Bewegung muessen zu einer Episode kollabieren (keine Mehrfachzaehlung)');
  assert.match(workerText,/OOS_CONFIDENT: 15/,'Abschaltung darf erst ab ausreichender OOS-Groesse erlaubt sein');
  assert.match(workerText,/pointWeak && wilsonWeak && b\.oosN>=ATTR\.OOS_CONFIDENT/,'Disable erfordert schwachen Punkt UND schwaches Wilson UND genug OOS-Evidenz');
  assert.match(workerText,/status:'overfit'/,'Overfitting-Status muss existieren');
  assert.match(workerText,/Reine Auswertung aufgeloester Outcomes/,'Guard muss als reine Auswertungsschicht dokumentiert sein');
  assert.match(workerText,/url\.pathname === '\/api\/attribution'/,'Attribution-Route muss existieren');
  // Der Guard darf keinen Score/Light/BUY veraendern: er referenziert analyseStock/analyse NICHT.
  const attrBlock=workerText.slice(workerText.indexOf('MODUL 0 · CLAUDE ATTRIBUTION'),workerText.indexOf('async function learningPayload'));
  assert.ok(!/analyseStock\(|\.claude\.|\.fusion\./.test(attrBlock),'Guard darf die Bewertungslogik nicht beruehren (reine Nachbetrachtung)');

  // Verhaltenspruefung der Wilson-Untergrenze: 3/4 darf NICHT als starker Edge gelten.
  const wl=(w,n)=>{const z=1.96,p=w/n,d=1+z*z/n,c=p+z*z/(2*n),mgn=z*Math.sqrt((p*(1-p)+z*z/(4*n))/n);return Math.max(0,(c-mgn)/d);};
  assert.ok(wl(3,4)<0.5,'Wilson: 3 von 4 Treffern darf keine >=50%-Sicherheit vortaeuschen');
  assert.ok(wl(30,40)>wl(3,4),'Wilson: groessere Stichprobe mit gleicher Quote muss mehr Vertrauen ergeben');
}

console.log('✓ FusionPulse v3.5.4 attribution/overfitting-guard regressions: OK');
// v3.5.5 Modul 1: Aladdin-Style Market Intelligence. Marktmeinung, KEIN Score-Eingriff.
{
  assert.match(workerText,/MODUL 1 · ALADDIN-STYLE MARKET INTELLIGENCE/,'Aladdin-Layer muss vorhanden sein');
  assert.match(workerText,/function aladdinRegime\(rows\)/,'Regime-Ebene muss existieren');
  assert.match(workerText,/function aladdinSectors\(rows\)/,'Sektor-Rotations-Ebene muss existieren');
  assert.match(workerText,/function aladdinStress\(rows, regime\)/,'Stress-Ebene muss existieren');
  assert.match(workerText,/function marketRecommendation\(rows, regime, sectors\)/,'Kombinationsschicht (Setup x Marktpassung) muss existieren');
  assert.match(workerText,/url\.pathname === '\/api\/aladdin'/,'Aladdin-Route muss existieren');
  // Der Layer darf keinen gelockten Score veraendern: er ruft analyseStock/analyse NICHT.
  const alaBlock=workerText.slice(workerText.indexOf('MODUL 1 · ALADDIN'),workerText.indexOf('async function learningPayload'));
  assert.ok(!/analyseStock\(|function analyse\(/.test(alaBlock),'Aladdin-Layer darf die Bewertungslogik nicht erzeugen/veraendern (reine Aggregation)');
  assert.match(alaBlock,/kein Vollmarkt/,'Ehrlichkeit: Datenbasis muss explizit als Stichprobe gekennzeichnet sein');

  // Verhaltenspruefung mit synthetischen Marktzustaenden.
  const mkRow=(sym,sec,r15,r60,rv,vwap,sc)=>({symbol:sym,sector:sec,ret15:r15,ret60:r60,relVol:rv,aboveVwap:vwap,score:sc,atrPct:2,structurePct:3,light:sc>=8?'green':sc>=6?'yellow':'red',volumeKnown:true,breakout60m:r60>3,spreadPct:0.05});
  const on=[];for(let i=0;i<14;i++)on.push(mkRow('S'+i,i<4?'Semiconductors':i<8?'Software':'Industrials',1.5,3.0,1.8,true,7.5));
  const A=aladdinIntelligence(on);
  assert.equal(A.regime.label,'Risk-On','Breite Staerke muss als Risk-On erkannt werden');
  assert.ok(A.regime.confidence<70,'Bei Stichprobe darf die Konfidenz nicht hoch tun');
  assert.ok(A.recommendation.marketRisk.some(x=>/Stichprobe|duenn/i.test(x)) || A.regime.sample>=20,'Duenne Basis muss als Marktrisiko ausgewiesen werden');
  const off=on.map(r=>({...r,ret15:-1,ret60:-2,aboveVwap:false,relVol:1.0,score:4}));
  assert.equal(aladdinIntelligence(off).regime.label,'Risk-Off','Breite Schwaeche muss als Risk-Off erkannt werden');
  const thin=aladdinIntelligence(on.slice(0,6));
  assert.equal(thin.regime.label,'Unklar','Zu wenige Titel muessen zu "Unklar" fuehren, nicht zu falscher Sicherheit');
}

console.log('✓ FusionPulse v3.5.5 aladdin market-intelligence regressions: OK');

// v3.5.6 VL-Integration: Heatmap/Position/Alarm. Claude/Aladdin-Methodik bleibt unberuehrt.
{
  /* BEWUSSTE AENDERUNG in v3.6.1 (vorher: "STARK · ATTRAKTIV" usw.).
     Der Nutzer hat berichtet, dass Titel im Feld "STARK · ATTRAKTIV" standen,
     obwohl ihr Plan netto kaum etwas brachte. Zu Recht: BEIDE Achsen der Karte
     messen Technik (Musterqualitaet hoch, Ausfuehrbarkeit rechts) — die
     Wirtschaftlichkeit steckt in keiner von beiden. "ATTRAKTIV" war damit eine
     Aussage, die die Karte gar nicht treffen kann. Die Anforderung bleibt
     bestehen (alle vier Quadranten beschriftet), nur ohne die Fehldeutung. */
  /* Hotfix v3.6.2: Labels sind jetzt zweizeilig (Titel + tspan), weil die
     einzeilige Langfassung ineinandergelaufen ist und die Punkte ueberlagert
     hat. Geprueft wird deshalb das Paar aus Zeile 1 und Zeile 2, nicht der
     zusammengesetzte String. */
  const quadPairs = [...app.matchAll(/class="quad-label ql-(tr|tl|br|bl)"[^>]*>([^<]+)<tspan[^>]*>([^<]+)</g)]
    .map(m=>({q:m[1], l1:m[2].trim(), l2:m[3].trim()}));
  assert.ok(quadPairs.length>=8,`Beide Heatmaps brauchen alle vier Quadranten beschriftet, gefunden: ${quadPairs.length}`);
  for(const p of quadPairs){
    assert.match(p.l1,/^MUSTER (STARK|SCHWACH)$/,`Zeile 1 von ${p.q} muss die Musterqualitaet nennen`);
    assert.match(p.l2,/^(gut|schwer) handelbar$/,`Zeile 2 von ${p.q} muss die Handelbarkeit nennen`);
    assert.ok(p.l1.length<=16 && p.l2.length<=17,`Label ${p.q} ist zu lang und laeuft in den Nachbarn (${p.l1}/${p.l2})`);
  }
  for(const q of ['tr','tl','br','bl']) assert.ok(quadPairs.filter(p=>p.q===q).length===2,`Quadrant ${q} muss in beiden Karten genau einmal beschriftet sein`);
  assert.doesNotMatch(app,/STARK · ATTRAKTIV/,'Die Karte darf nicht "attraktiv" behaupten — sie misst keine Wirtschaftlichkeit');
  assert.match(app,/const POSITION_STORE_KEY='fp\.stockPositions\.v1'/,'Reale Positionen muessen persistent verwaltet werden');
  assert.match(app,/function positionMetrics\(r,p\)/,'Reale Ausfuehrung muss einen eigenen Tradeplan berechnen');
  assert.match(app,/technische Marken werden nicht zur CRV-Rettung verschoben/,'Positions-UI muss explizit verhindern, dass SL\/TP zur CRV-Rettung verschoben werden');
  assert.match(app,/function monitorPosition\(r\)/,'Aktive Position muss bei neuen Fokusdaten ueberwacht werden');
  assert.match(app,/FusionPulse führt keinen Verkauf automatisch aus/,'Alarm muss Warnung und automatische Verkaufsaktion klar trennen');
  assert.match(app,/Teilverkauf buchen/,'Restposition nach TP1 muss dokumentierbar sein');
}
console.log('✓ FusionPulse v3.5.6 VL heatmap/position/alarm regressions: OK');

// v3.5.7 Paket A: Stummschalten + Rehabilitation. Unterdrueckt BUY, kein Score-Eingriff.
{
  assert.match(workerText,/PAKET A · MODUL 0 SCHARF/,'Paket-A-Block muss vorhanden sein');
  assert.match(workerText,/async function muteSetup\(env, setup, reason\)/,'muteSetup muss existieren');
  assert.match(workerText,/async function unmuteSetup\(env, setup\)/,'unmuteSetup muss existieren');
  assert.match(workerText,/REENABLE_POINT: 52/,'Reaktivierungs-Schwelle (Punkt) muss ueber Abschaltung (40) liegen – Hysterese');
  assert.match(workerText,/REENABLE_WILSON: 45/,'Reaktivierungs-Schwelle (Wilson) muss ueber Abschaltung (33) liegen – Hysterese');
  assert.match(workerText,/MIN_MUTE_MS: 5\*24\*60\*60_000/,'Mindest-Stummdauer (5 Tage) muss gelten');
  assert.match(workerText,/url\.pathname === '\/api\/attribution\/mute'/,'Mute-Route muss existieren');
  // Gestummte Setups duerfen NICHT gleichzeitig in disable-Empfehlungen stehen (Doppelung).
  assert.match(workerText,/evaluated\.filter\(b=>!b\.muted &&/,'disable-Empfehlungen muessen gestummte Setups ausschliessen');
  // Client: Stummliste muss die BUY-Freigabe unterdruecken.
  assert.match(app,/let mutedSetupSet = new Set\(\)/,'Client muss Stummliste fuehren');
  // v3.5.9: stockLevel prueft zusaetzlich das Gesamt-Risikobudget. Die Mute-Bedingung
  // muss dabei erhalten bleiben — beide duerfen ausschliesslich abwerten.
  assert.match(app,/!muted && !overBudget\) \? 3/,'stockLevel muss BUY (Stufe 3) fuer gestummte Setups weiterhin unterdruecken');
  assert.match(app,/async function muteSetupAction/,'Client muss Stummschalt-Aktion haben');
  // Rehabilitation braucht mehr OOS-Evidenz als eine normale Bewertung.
  assert.match(workerText,/oosN>=REHAB\.REENABLE_OOS_MIN/,'Rehabilitation muss genug OOS-Episoden verlangen');
}

console.log('✓ FusionPulse v3.5.7 mute/rehabilitation regressions: OK');

// ---------------------------------------------------------------------------
// v3.5.8 · P0: Kopfzeile darf der wirtschaftlichen Bewertung nicht widersprechen.
// Anders als die Suiten oben wird der Client hier WIRKLICH ausgefuehrt
// (tests/client-harness.mjs), damit das nicht nur ein Regex-Versprechen ist.
// Alle Fixtures sind eigens fuer diesen Befund gebaut.
{
  const { loadClient } = await import('./client-harness.mjs');
  const C = loadClient();
  const nowSql = () => new Date().toISOString().slice(0,19).replace('T',' ');

  /** Basis: Entry 25,00 / Stop 24,90 => 375 Stueck bei 37,50 EUR Risiko (5.000 EUR, 0,75 %). */
  const row = (over={}) => ({
    symbol:'SOFI', name:'SoFi Technologies', sector:'Financials',
    light:'green', score:8.3, verdict:'Kauf-Setup · Claude',
    claude:{ light:'green', score:8.3, verdict:'Kauf-Setup · Claude', expectancyR:0.31, blockers:[] },
    entryEur:25.00, stopEur:24.90, tp1Eur:25.20, tp2Eur:25.40, priceEur:25.02,
    entryUsd:29.25, stopUsd:29.13, tp1Usd:29.48, tp2Usd:29.72, priceUsd:29.27,
    netCRV:1.1, tp2Pct:1.6, relVol:1.7,
    setup:'Pullback', situationType:'PULLBACK', situationScore:74,
    updated: nowSql(), marketPhase:'regular', ...over
  });
  const live = (sym='SOFI') => { C.stockMeta = { ts:Date.now(), refreshedSymbols:[sym], market:{key:'regular'} }; };

  C.S.claudeMode = true;
  C.mutedSetupSet = new Set();
  live();

  // -- 1) Der reproduzierte SOFI-Fall (Screenshots 26.8., v3.5.6).
  const sofi = row();
  const sz = C.stockSizing(sofi), opp = C.stockOpportunity(sofi), hl = C.stockHeadline(sofi);
  assert.ok(Math.abs(sz.planNet - 54) < 3, `Fixture muss den 54-EUR-Plan reproduzieren, ist ${sz.planNet.toFixed(1)}`);
  assert.ok(Math.abs(sz.planCrvAfterCosts - 1.1) < 0.12, `Fixture muss Plan-CRV ~1,1:1 reproduzieren, ist ${sz.planCrvAfterCosts.toFixed(2)}`);
  assert.equal(sofi.light, 'green', 'Musterqualitaet bleibt gruen – der Score wird NICHT angefasst');
  assert.equal(C.stockLevel(sofi), 2, 'Es gab und gibt keine BUY-Freigabe fuer diesen Trade');
  assert.equal(opp.blockKind, 'economic', 'Blockade muss als wirtschaftlich erkannt werden');
  assert.equal(hl.light, 'yellow', 'P0: Kopf-Ampel darf bei unwirtschaftlichem Plan nicht mehr gruen sein');
  assert.equal(hl.kind, 'economic', 'Kopfzeile muss den wirtschaftlichen Grund fuehren');
  assert.doesNotMatch(hl.text, /Kauf-Setup/, 'P0: Kopfzeile darf nicht mehr "Kauf-Setup" sagen, wenn der Trade sich nicht lohnt');
  assert.match(hl.text, /wirtschaftlich uninteressant/, 'Kopfzeile muss den Widerspruch benennen statt ihn zu verstecken');
  assert.match(hl.text, /· Claude/, 'Die Modus-Kennzeichnung darf durch den Fix nicht verlorengehen');
  // Technische Marken bleiben unangetastet (Invariante 4).
  assert.equal(sofi.entryEur, 25.00); assert.equal(sofi.stopEur, 24.90);
  assert.equal(sofi.tp1Eur, 25.20);  assert.equal(sofi.tp2Eur, 25.40);
  assert.equal(sofi.score, 8.3, 'Der Score darf durch reine Anzeigelogik nicht veraendert werden');

  // -- 2) Gegenprobe: ein wirtschaftlich tragfaehiger Trade MUSS weiter BUY zeigen.
  //       Sonst waere der Fix eine stille Feature-Abschaltung.
  const good = row({ tp1Eur:26.00, tp2Eur:27.50, tp1Usd:30.42, tp2Usd:32.18, tp2Pct:10, netCRV:3.2 });
  const gz = C.stockSizing(good), gh = C.stockHeadline(good);
  assert.ok(gz.planNet >= 120, `Gegenprobe muss ueber der Claude-Schwelle liegen, ist ${gz.planNet.toFixed(0)} EUR`);
  assert.equal(C.stockLevel(good), 3, 'Gegenprobe muss eine echte BUY-Freigabe sein');
  assert.equal(gh.light, 'green', 'Ein echter BUY darf nicht faelschlich abgewertet werden');
  assert.equal(gh.text, 'BUY', 'Echter BUY muss unveraendert als BUY erscheinen');

  // -- 3) Fail-closed: die Kopfzeile darf NIEMALS besser sein als r.light (Invariante 1).
  for (const lt of ['red','yellow','green']) {
    const h = C.stockHeadline(row({ light:lt, verdict:'Test · Claude' }));
    assert.ok(C.HEADLINE_RANK[h.light] <= C.HEADLINE_RANK[lt],
      `Kopfzeile darf ${lt} nicht aufwerten (wurde ${h.light})`);
  }
  assert.notEqual(C.stockHeadline(row({ light:'yellow' })).light, 'green', 'Gelbes Muster darf nie gruene Kopfzeile bekommen');
  assert.notEqual(C.stockHeadline(row({ light:'red' })).light, 'green', 'Rotes Muster darf nie gruene Kopfzeile bekommen');

  // -- 4) Stumme Setups (Paket A) duerfen im Kopf nicht als Kauf-Setup erscheinen.
  C.mutedSetupSet = new Set(['PULLBACK']);
  const muted = C.stockHeadline(good);
  assert.equal(muted.kind, 'muted', 'Gestummtes Setup muss im Kopf als stumm erkennbar sein');
  assert.doesNotMatch(muted.text, /Kauf-Setup|^BUY/, 'Gestummtes Setup darf keinen Kauf-Eindruck erzeugen');
  assert.notEqual(muted.light, 'green', 'Gestummtes Setup darf keine gruene Kopf-Ampel behalten');
  C.mutedSetupSet = new Set();

  // -- 5) Nicht-live Daten: gruenes Muster, aber Datenlage traegt keine Freigabe.
  C.stockMeta = { ts:0, refreshedSymbols:[], market:{key:'regular'} };
  const stale = C.stockHeadline(row({ tp1Eur:26.00, tp2Eur:27.50, tp2Pct:10, updated:'2020-01-01 12:00:00' }));
  assert.notEqual(stale.light, 'green', 'Stale Daten duerfen keine gruene Kopfzeile erzeugen (fail-closed)');
  assert.equal(stale.kind, 'data', 'Stale Daten muessen als Datenproblem benannt werden');
  live();

  // -- 6) Ausserhalb des Handelsfensters darf die Kopfzeile ebenfalls nicht "Kauf" rufen.
  C.stockMeta = { ts:Date.now(), refreshedSymbols:['SOFI'], market:{key:'closed'} };
  const closed = C.stockHeadline(row({ tp1Eur:26.00, tp2Eur:27.50, tp2Pct:10 }));
  assert.notEqual(closed.light, 'green', 'Geschlossener Markt darf keine gruene Kauf-Kopfzeile erzeugen');
  live();

  // -- 7) Render-Guards: alle drei Anzeigestellen muessen ueber stockHeadline laufen.
  assert.match(app, /function stockHeadline\(r\)/, 'stockHeadline muss existieren');
  assert.doesNotMatch(app, /VERDICT_ICON\[top\.light\]/, 'Fokus-Karte darf die Ampel nicht mehr direkt aus r.light lesen');
  assert.doesNotMatch(app, /VERDICT_ICON\[r\.light\] *\+/, 'Aktienzeile/Peek duerfen die Ampel nicht mehr direkt aus r.light lesen');
  assert.match(app, /<strong class="sf-verdict hl-\$\{hl\.light\}"/, 'Fokus-Kopf muss die Headline-Ampel rendern');
  assert.match(app, /<div class="sr-verdict hl-\$\{hl\.light\}"/, 'Aktienzeile muss die Headline-Ampel rendern');
  assert.match(app, /class="pk-verdict \$\{h\.light\}"/, 'Peek-Kopf muss die Headline-Ampel rendern');
  const css = fs.readFileSync(new URL('../public/style.css', import.meta.url),'utf8');
  assert.match(css, /\.stockrow \.sr-verdict\.hl-yellow\{color:var\(--yellow\)\}/, 'Abgewertete Kopfzeile muss auch farblich abgewertet sein');

  // -- 8) P2: Schalter statt Textlink in Modul 0 (vom Nutzer explizit gewuenscht).
  assert.match(app, /data-toggleset="\$\{esc\(b\.key\)\}"/, 'Jede Setup-Zeile muss einen Schalter statt eines Textlinks haben');
  assert.match(app, /\$\{b\.muted\?'':' checked'\}/, 'Schalterstellung muss den Zustand abbilden: aktiv = rechts/an');
  assert.match(app, /muteSetupAction\(t\.dataset\.toggleset, t\.checked\?'unmute':'mute'\)/, 'Schalter muss aktiv=unmute / gestummt=mute abbilden');
  assert.doesNotMatch(app, /data-unmute="\$\{esc\(b\.key\)\}">reaktivieren</, 'Der alte Textlink darf nicht zurueckkehren');
  assert.match(app, /reenable[\s\S]{0,600}data-unmute="\$\{esc\(r\.setup\)\}"/, 'Wiedereinschalt-Empfehlung braucht einen eigenen Direktbutton');
  assert.match(app, /attr-scope-note[\s\S]{0,400}Setup-Typen/, 'UI muss klarstellen, dass Mute Setup-TYPEN betrifft');
  assert.match(app, /attr-scope-note[\s\S]{0,600}nicht<\/b> die Analyse-Komponenten/, 'UI muss die Abgrenzung zu den Analyse-Checkboxen benennen');
  const css2 = fs.readFileSync(new URL('../public/style.css', import.meta.url),'utf8');
  assert.match(css2, /\.attr-toggle input:checked\+\.attr-track/, 'Schalter braucht einen sichtbaren Ein-Zustand');
  assert.match(css2, /translateX\(16px\)/, 'Schalterknopf muss im aktiven Zustand nach rechts wandern');
}

console.log('✓ FusionPulse v3.5.8 headline/economic-consistency regressions: OK');

// ---------------------------------------------------------------------------
// v3.5.9 · Modul 2: Portfolio-Risiko & Klumpung (Paket B, Teil 1).
// Funktional gegen den laufenden Client geprueft, eigene Fixtures.
{
  const { loadClient } = await import('./client-harness.mjs');
  const C = loadClient();
  C.S.equity = 5000; C.S.riskPct = 0.75; C.S.portfolioRiskPct = 2.25; C.S.portfolioGuard = false;
  C.S.claudeMode = true; C.mutedSetupSet = new Set();

  const rows = [
    { symbol:'AAA', sector:'Technologie', entryEur:25.00, stopEur:24.90, tp1Eur:26.00, tp2Eur:27.50, priceEur:25.00 },
    { symbol:'BBB', sector:'Technologie', entryEur:50.00, stopEur:49.00, tp1Eur:52.00, tp2Eur:55.00, priceEur:50.00 },
    { symbol:'CCC', sector:'Healthcare',  entryEur:10.00, stopEur: 9.50, tp1Eur:11.00, tp2Eur:12.00, priceEur:10.00 },
  ];
  C.stockRows = rows;
  C.stockPositions = {
    AAA:{active:true, entryEur:25, qty:375, restQty:375},
    BBB:{active:true, entryEur:50, qty:37,  restQty:37},
    CCC:{active:true, entryEur:10, qty:60,  restQty:60},
  };

  const px = C.portfolioExposure();
  assert.equal(px.budget, 112.5, 'Gesamtbudget muss equity x portfolioRiskPct sein');
  assert.equal(px.items.length, 3, 'Alle aktiven Positionen muessen erfasst werden');
  assert.ok(px.usedRisk > px.usedPriceRisk, 'Reales Risiko muss ueber dem reinen Kursrisiko liegen (Ausfuehrungskosten)');
  assert.ok(px.costFactor > 1.15, `Kostenfaktor muss den Aufschlag sichtbar machen, ist ${px.costFactor.toFixed(2)}`);
  assert.ok(px.perTradeReal > px.perTrade, 'Reales Risiko je Trade muss ueber dem nominellen liegen');
  assert.ok(px.budgetFull, 'Drei parallele Trades muessen ein 2,25-%-Budget rechnerisch sprengen');

  // Klumpung: risikogewichtet, nicht nach Stueckzahl oder Kaufsumme.
  assert.equal(px.top.sector, 'Technologie', 'Groesster Risikoblock muss der Technologie-Sektor sein');
  assert.ok(px.top.pct >= 50, `Klumpungsanteil muss ueber der Warnschwelle liegen, ist ${px.top.pct.toFixed(0)} %`);
  assert.equal(px.clustered, true, 'Zwei Positionen mit >50 % Risikoanteil muessen als Klumpung gelten');
  const sum = px.sectors.reduce((a,x)=>a+x.pct,0);
  assert.ok(Math.abs(sum-100) < 0.01, 'Sektor-Anteile muessen sich auf 100 % addieren');

  // Ein einzelner Titel ist keine Klumpung (sonst waere jede erste Position eine Warnung).
  C.stockPositions = { AAA:{active:true, entryEur:25, qty:375, restQty:375} };
  assert.equal(C.portfolioExposure().clustered, false, 'Eine einzelne Position darf keine Klumpungswarnung ausloesen');

  // Unbewertbare Position wird NICHT geschaetzt, sondern ausgewiesen (fail-closed).
  C.stockPositions = { ZZZ:{active:true, entryEur:80, qty:20, restQty:20} };
  const unknown = C.portfolioExposure();
  assert.equal(unknown.unknownCount, 1, 'Position ohne geladene Zeile muss als unbewertbar gezaehlt werden');
  assert.equal(unknown.usedRisk, 0, 'Unbewertbares Risiko darf NICHT geschaetzt in die Summe einfliessen');
  assert.ok(unknown.unknownNotional > 0, 'Die Kaufsumme der unbewertbaren Position muss trotzdem sichtbar sein');

  // -- Budget-Sperre: standardmaessig AUS, und sie darf nur abwerten.
  C.stockRows = rows;
  C.stockPositions = {
    AAA:{active:true, entryEur:25, qty:375, restQty:375},
    BBB:{active:true, entryEur:50, qty:37,  restQty:37},
  };
  C.stockMeta = { ts:Date.now(), refreshedSymbols:['DDD'], market:{key:'regular'} };
  const cand = {
    symbol:'DDD', name:'Kandidat', sector:'Energie', light:'green', score:8.3, verdict:'Kauf-Setup · Claude',
    claude:{ light:'green', score:8.3, verdict:'Kauf-Setup · Claude', expectancyR:0.4, blockers:[] },
    entryEur:25.00, stopEur:24.90, tp1Eur:26.00, tp2Eur:27.50, priceEur:25.00,
    entryUsd:29.25, stopUsd:29.13, tp1Usd:30.42, tp2Usd:32.18, priceUsd:29.25,
    netCRV:3.2, tp2Pct:10, relVol:1.7, setup:'Pullback', situationType:'PULLBACK',
    updated:new Date().toISOString().slice(0,19).replace('T',' '), marketPhase:'regular'
  };
  C.S.portfolioGuard = false;
  assert.equal(C.portfolioBlocksNewBuy(cand), false, 'Ohne eingeschaltete Sperre darf nichts blockiert werden');
  assert.equal(C.stockLevel(cand), 3, 'Default-Verhalten muss unveraendert bleiben (kein stiller Eingriff)');
  assert.equal(C.stockHeadline(cand).text, 'BUY', 'Default-Kopfzeile muss unveraendert BUY sein');

  C.S.portfolioGuard = true;
  assert.equal(C.portfolioBlocksNewBuy(cand), true, 'Bei erschoepftem Budget muss die aktive Sperre greifen');
  assert.equal(C.stockLevel(cand), 1, 'Gesperrtes Gruen wird zurueckgestuft, nicht ausgeblendet');
  const gh = C.stockHeadline(cand);
  assert.equal(gh.kind, 'portfolio', 'Kopfzeile muss das Risikobudget als Grund nennen');
  assert.notEqual(gh.light, 'green', 'Gesperrter Kandidat darf keine gruene Kopf-Ampel behalten');
  assert.doesNotMatch(gh.text, /^BUY/, 'Gesperrter Kandidat darf nicht als BUY erscheinen');

  // Die Sperre darf NIE aufwerten und nie einen bestehenden Trade behindern.
  for (const lt of ['red','yellow']) {
    const h = C.stockHeadline({ ...cand, light:lt, verdict:'Test · Claude' });
    assert.ok(C.HEADLINE_RANK[h.light] <= C.HEADLINE_RANK[lt], `Sperre darf ${lt} nicht aufwerten`);
  }
  C.stockPositions = { ...C.stockPositions, DDD:{active:true, entryEur:25, qty:375, restQty:375} };
  assert.equal(C.portfolioBlocksNewBuy(cand), false, 'Eine bereits offene Position darf nicht zusaetzlich gesperrt werden');
  C.S.portfolioGuard = false;

  // Default-Sicherheit: die Sperre ist ausgeliefert AUS (kein Eingriff in den ChatGPT-Strang).
  assert.equal(C.DEFAULTS.portfolioGuard, false, 'Budget-Sperre muss standardmaessig ausgeschaltet sein');
  assert.ok(C.DEFAULTS.portfolioRiskPct >= C.DEFAULTS.riskPct, 'Gesamtbudget darf nie unter dem Einzeltrade-Risiko liegen');

  // UI-Guards
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url),'utf8');
  assert.match(html, /id="portfolioRisk"/, 'Portfolio-Kachel muss im Markup existieren');
  assert.match(html, /id="sPortfolioRisk"/, 'Gesamtbudget muss einstellbar sein');
  assert.match(html, /id="sPortfolioGuard"/, 'Budget-Sperre muss einstellbar sein');
  assert.match(app, /renderDepotStrip\(\); renderPortfolioRisk\(\);/, 'Kachel muss bei jedem Aktien-Render aktualisiert werden');
  assert.match(app, /Sektor-Naeherung/, 'Die Naeherungs-Grenze muss im UI ehrlich benannt sein');
}

console.log('✓ FusionPulse v3.5.9 portfolio-risk/cluster regressions: OK');

// ---------------------------------------------------------------------------
// v3.6.0 · Laien-Erklaerungen. Ein Tooltip, den nur versteht wer den Begriff
// schon kennt, ist kein Tooltip. Deshalb wird hier nicht nur die EXISTENZ
// geprueft, sondern auch, dass Fachbegriffe aufgeloest statt wiederholt werden.
{
  const { loadClient } = await import('./client-harness.mjs');
  const C = loadClient();
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url),'utf8');
  const css  = fs.readFileSync(new URL('../public/style.css',  import.meta.url),'utf8');

  // -- Glossar existiert und ist eine einzige Quelle.
  assert.ok(Object.keys(C.GLOSS).length >= 25, `Glossar muss die verwendeten Begriffe abdecken, hat ${Object.keys(C.GLOSS).length}`);
  for (const [k,v] of Object.entries(C.GLOSS)) {
    assert.ok(v.length >= 80, `Glossareintrag "${k}" ist zu knapp fuer eine echte Erklaerung (${v.length} Zeichen)`);
  }

  // -- Fachbegriffe muessen AUFGELOEST werden, nicht nur wiederholt.
  //    Jeder Eintrag nennt das Kuerzel und erklaert es im selben Text.
  assert.match(C.gloss('crv'), /Chance-Risiko-Verh/, 'CRV muss ausgeschrieben werden');
  assert.match(C.gloss('vwap'), /Durchschnittspreis/, 'VWAP muss ausgeschrieben werden');
  assert.match(C.gloss('ema21'), /gleitender Durchschnitt/, 'EMA muss ausgeschrieben werden');
  assert.match(C.gloss('atr'), /Schwankungsbreite/, 'ATR muss in normaler Sprache erklaert sein');
  assert.match(C.gloss('oos'), /nie gesehen|frische Daten/i, 'Out-of-Sample muss in normaler Sprache erklaert sein');
  assert.match(C.gloss('rMultiple'), /Einheit Risiko/, 'R-Vielfaches muss erklaert sein');
  assert.match(C.gloss('tickerSym'), /SOFI/, 'Das Ticker-Kuerzel muss am konkreten Beispiel erklaert sein');

  // -- Setup-Namen aus Modul 0 muessen alle eine Erklaerung finden.
  for (const key of ['PULLBACK','RECLAIM','SQUEEZE','BREAKOUT','ELLIOTT','RELATIVE_STRENGTH']) {
    const t = C.glossForSetup(key);
    assert.ok(t.length >= 80, `Setup "${key}" braucht eine Laien-Erklaerung`);
  }
  // Auch ein unbekannter Setup-Name darf nie ohne Erklaerung dastehen.
  assert.ok(C.glossForSetup('IRGENDWAS_NEUES').length >= 60, 'Unbekannte Setups brauchen einen sinnvollen Fallback-Text');

  // -- Die Erklaerung muss auch sagen, was NICHT gemeint ist (haeufigste Fehldeutung).
  assert.match(C.gloss('squeeze'), /NICHT voraus|keine Richtungsprognose/i, 'Squeeze muss klarstellen, dass er keine Richtung vorhersagt');
  assert.match(C.gloss('inSample'), /wertlos|allein/i, 'In-Sample muss vor Fehldeutung warnen');
  assert.match(C.gloss('expectancy'), /NICHT/, 'Erwartungswert muss klarstellen, dass er nichts ueber den Einzeltrade sagt');
  assert.match(C.gloss('notional'), /Nicht zu verwechseln|nicht die Kaufsumme/i, 'Kaufsumme muss vom Risiko abgegrenzt werden');

  // -- gl() erzeugt eine erkennbare, bedienbare Markierung.
  const tag = C.gl('PULLBACK', null, C.glossForSetup('PULLBACK'));
  assert.match(tag, /^<abbr class="gl" title="/, 'Begriffe muessen als <abbr class="gl"> mit title gerendert werden');
  assert.match(tag, /PULLBACK<\/abbr>$/, 'Das Label muss sichtbar bleiben');
  assert.equal(C.gl('XYZ','gibtesnicht'), 'XYZ', 'Ohne Glossareintrag darf keine leere Erklaerung vorgegaukelt werden');
  assert.match(css, /abbr\.gl\{[^}]*cursor:help/, 'Erklaerte Begriffe muessen als solche erkennbar sein');

  // -- Modul 0: Tabellenkopf, Setup-Zelle und Schalter erklaeren sich.
  assert.match(app, /<th title="\$\{esc\(gloss\('sampleN'\)\)\}">n<\/th>/, 'Spalte n braucht eine Erklaerung');
  assert.match(app, /<th title="\$\{esc\(gloss\('inSample'\)\)\}">In-Sample/, 'Spalte In-Sample braucht eine Erklaerung');
  assert.match(app, /<th title="\$\{esc\(gloss\('oos'\)\)\}">Out-of-Sample/, 'Spalte Out-of-Sample braucht eine Erklaerung');
  assert.match(app, /const meaning = glossForSetup\(b\.key\)/, 'Der Schalter muss die Bedeutung des Setups kennen');
  assert.match(app, /Was ist \$\{b\.key\}\?/, 'Der Schalter-Tooltip muss erklaeren, WAS er da schaltet');
  assert.match(app, /\$\{gl\(b\.key,null,meaning\)\}/, 'Der Setup-Name in der Tabelle muss erklaert sein');

  // -- Modul 2: jede Kennzahl der Kachel hat eine Erklaerung.
  assert.match(app, /gloss\('portfolioBudget'\)/, 'Gesamt-Risikobudget muss erklaert sein');
  assert.match(app, /gloss\('cluster'\)/, 'Klumpenrisiko muss erklaert sein');
  assert.match(app, /gloss\('stopReal'\)/, 'Der Kostenaufschlag am Stop muss erklaert sein');

  // -- Ticker: SOFI & Co. bekommen ihre Erklaerung.
  assert.match(app, /class="sr-tic" title="\$\{esc\(gloss\('tickerSym'\)\)\}"/, 'Das Ticker-Kuerzel in der Aktienzeile muss erklaert sein');

  // -- Einstellungen: Analysemethoden in normaler Sprache, ohne unerklaerten Jargon.
  const compBlock = html.slice(html.indexOf('id="sComponents"'), html.indexOf('</div>', html.indexOf('id="sComponents"')));
  assert.doesNotMatch(compBlock, /z-Score der/, 'Rohbegriff "z-Score" darf nicht unerklaert stehen bleiben');
  assert.doesNotMatch(compBlock, /volatilitätsnormiert/, 'Rohbegriff "volatilitätsnormiert" darf nicht unerklaert stehen bleiben');
  assert.doesNotMatch(compBlock, /Bollinger-Bandbreite/, 'Rohbegriff "Bollinger-Bandbreite" darf nicht unerklaert stehen bleiben');
  for (const comp of ['vwap','ema21','rs','mtf','volume','book','squeeze','pullback','elliott']) {
    const i = compBlock.indexOf(`data-comp="${comp}"`);
    assert.ok(i > 0, `Komponente ${comp} muss existieren`);
    const label = compBlock.lastIndexOf('<label', i);
    const title = /title="([^"]*)"/.exec(compBlock.slice(label, i))?.[1] || '';
    assert.ok(title.length >= 120, `Erklaerung fuer "${comp}" ist zu knapp fuer einen Laien (${title.length} Zeichen)`);
  }
  // Die Ebenen-Verwechslung (Methoden vs. Setup-Typen) muss auch hier adressiert sein.
  assert.match(html, /class="complist-note"/, 'Die Komponentenliste braucht einen erklaerenden Vorspann');
  assert.match(html, /Nicht verwechseln<\/b> mit den Schaltern in der Selbstauswertung/, 'Der Vorspann muss die beiden Schalter-Ebenen abgrenzen');
}

console.log('✓ FusionPulse v3.6.0 glossary/plain-language regressions: OK');

// ---------------------------------------------------------------------------
// v3.6.1 · Krypto-Kopfzeile (P2b), Heatmap-Ehrlichkeit, Crowd-Diagnose,
// sichtbares Glossar und Scope-Frequenz. Alles funktional am laufenden Client.
{
  const { loadClient } = await import('./client-harness.mjs');
  const C = loadClient();
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url),'utf8');
  const css  = fs.readFileSync(new URL('../public/style.css',  import.meta.url),'utf8');
  C.S.equity = 5000; C.S.riskPct = 0.75; C.S.minCrvCoin = 2.0; C.S.claudeMode = false;

  // ---- P2b: Krypto-Kopfzeile darf nicht mehr allein an r.light haengen.
  const coin = (over={}) => ({ pair:'TST-EUR', light:'green', verdict:'Kauf-Setup',
    quality:8.1, executability:7.4, netCRV:1.1, inZone:true,
    entry:100, stop:98, tp1:101, tp2:102, price:100, ...over });

  const weak = C.coinHeadline(coin());
  assert.equal(C.buyReady(coin()), false, 'Ein Coin unter der CRV-Grenze darf keine Freigabe haben');
  assert.notEqual(weak.light, 'green', 'P2b: unwirtschaftlicher Coin darf keine gruene Kopfzeile behalten');
  assert.equal(weak.kind, 'economic', 'Der Grund muss als wirtschaftlich benannt werden');
  assert.doesNotMatch(weak.text, /Kauf-Setup/, 'Die Kopfzeile darf nicht mehr "Kauf-Setup" sagen');

  const outOfZone = C.coinHeadline(coin({ netCRV:3.4, inZone:false }));
  assert.equal(outOfZone.kind, 'zone', 'Ausserhalb der Einstiegszone muss als eigener Grund erscheinen');
  assert.notEqual(outOfZone.light, 'green', 'Ausserhalb der Zone darf die Kopf-Ampel nicht gruen bleiben');

  const good = C.coinHeadline(coin({ netCRV:3.4, inZone:true }));
  assert.equal(good.text, 'BUY', 'Ein echter Krypto-BUY muss weiterhin als BUY erscheinen');
  assert.equal(good.light, 'green', 'Ein echter Krypto-BUY darf nicht faelschlich abgewertet werden');

  // Fail-closed: dieselbe Klemme wie bei Aktien, ueber alle Ampelzustaende.
  for (const lt of ['red','yellow','green']) {
    const h = C.coinHeadline(coin({ light:lt, netCRV:3.4, inZone:true }));
    assert.ok(C.HEADLINE_RANK[h.light] <= C.HEADLINE_RANK[lt], `Krypto-Kopfzeile darf ${lt} nicht aufwerten`);
  }
  assert.doesNotMatch(app, /class="dot light-\$\{r\.light\}/, 'Kartenpunkte duerfen die Farbe nicht mehr direkt aus r.light lesen');

  // ---- Heatmap: beide Achsen sind technisch, das muss dranstehen.
  assert.match(app, /function stockHeatmapMark\(r\)/, 'Heatmap braucht eine eigene, ehrliche Punktbewertung');
  assert.match(app, /Beide Achsen der Karte messen nur Technik/, 'Der Mouseover muss die Grenze der Karte benennen');
  assert.match(css, /\.dot\.econ-weak \.core\{fill:transparent/, 'Wirtschaftlich schwache Punkte muessen sichtbar anders gezeichnet sein');
  C.stockMeta = { ts:Date.now(), refreshedSymbols:['MRG'], market:{key:'regular'} };
  const marginal = { symbol:'MRG', name:'Marginal Inc.', sector:'Tech', light:'green', score:8.4,
    verdict:'Kauf-Setup · FusionPulse', executability:8.2,
    entryEur:25.00, stopEur:24.90, tp1Eur:25.20, tp2Eur:25.40, priceEur:25.00,
    entryUsd:29.25, stopUsd:29.13, tp1Usd:29.48, tp2Usd:29.72, priceUsd:29.25,
    netCRV:1.1, tp2Pct:1.6, setup:'Pullback', situationType:'PULLBACK',
    updated:new Date().toISOString().slice(0,19).replace('T',' '), marketPhase:'regular' };
  const mark = C.stockHeatmapMark(marginal);
  assert.equal(mark.weak, true, 'Ein technisch starker, wirtschaftlich schwacher Titel muss als schwach markiert werden');
  assert.notEqual(mark.light, 'green', 'Er darf in der Karte nicht gruen leuchten');
  assert.match(mark.tip, /Plan netto/, 'Der Mouseover muss das Netto-Potenzial nennen');

  // ---- Crowd: der Grund fuer den toten Tacho muss sichtbar sein, nicht nur im Tooltip.
  C.crowdMeta = { configured:false, state:'nokey' }; C.crowdMap = new Map();
  const off = C.crowdStatus();
  assert.equal(off.ok, false, 'Ohne Schluessel darf kein Messwert behauptet werden');
  assert.match(off.label, /SERPAPI/, 'Der fehlende Schluessel muss beim Namen genannt werden');
  assert.match(off.detail, /kein Defekt/, 'Es muss klargestellt sein, dass das kein Fehler ist');
  assert.match(off.detail, /kostenpflichtig/, 'Die Kostenfolge muss VOR dem Besorgen des Schluessels dastehen');
  C.crowdMeta = { state:'error', error:'timeout' };
  assert.equal(C.crowdStatus().tone, 'err', 'Ein Abruffehler muss als solcher erscheinen');
  assert.match(html, /id="crowdStatus"/, 'Die Statuszeile muss im Markup existieren');
  assert.match(app, /renderCrowdStatus\(\)/, 'Die Statuszeile muss bei jedem Render aktualisiert werden');

  // ---- Crowd-Beschleunigung: war serverseitig hart null, wird jetzt gerechnet.
  assert.match(app, /const CROWD_HIST_KEY='fp\.crowdHistory\.v1'/, 'Crowd-Verlauf muss lokal gefuehrt werden');
  const t0 = Date.now();
  C.crowdHistory = { ACC: [ {t:t0-90*60_000, v:20}, {t:t0-60*60_000, v:28} ] };
  const accel = C.crowdTrack('ACC', 50, t0);
  assert.ok(Number.isFinite(accel) && accel > 0, `Beschleunigung muss aus dem Verlauf berechenbar sein, ist ${accel}`);
  C.crowdHistory = {};
  assert.equal(C.crowdTrack('NEU', 50, t0), null, 'Ohne Referenzpunkt darf keine Beschleunigung erfunden werden');

  // ---- Scope-Frequenz: gemessen, nicht geschaetzt.
  C.refreshHistory = {};
  assert.equal(C.refreshRate('LEER').perHour, null, 'Ohne genug Messpunkte darf keine Frequenz behauptet werden');
  assert.match(C.refreshRate('LEER').detail, /nichts hochgerechnet/, 'Die Zurueckhaltung muss begruendet sein');
  const now = Date.now();
  C.refreshHistory = {
    FOK: Array.from({length:12},(_,i)=>now-i*5*60_000),
    AND: [now-50*60_000, now-25*60_000, now-5*60_000],
  };
  const rr = C.refreshRate('FOK');
  assert.ok(rr.perHour > 0, 'Beobachtete Frequenz muss berechnet werden');
  assert.ok(rr.rel > 1.5, `Der engmaschiger gescannte Titel muss als solcher erkannt werden (rel=${rr.rel})`);
  assert.match(rr.label, /engmaschiger als der Rest/, 'Der Vergleich muss im Klartext dastehen');
  assert.match(app, /class="focus-freq/, 'Die Frequenz muss im Fokusfenster angezeigt werden');

  // ---- Glossar sichtbar und vollstaendig gruppiert.
  assert.match(html, /id="glossaryList"/, 'Das Glossar braucht einen sichtbaren Ort');
  assert.match(html, /id="glossarySearch"/, 'Das Glossar muss durchsuchbar sein');
  const grouped = new Set(C.GLOSS_GROUPS.flatMap(g=>g.keys));
  for (const k of Object.keys(C.GLOSS)) {
    assert.ok(grouped.has(k), `Glossareintrag "${k}" fehlt in der sichtbaren Liste`);
    assert.ok(C.GLOSS_LABEL[k], `Glossareintrag "${k}" braucht eine lesbare Ueberschrift`);
  }
}

console.log('✓ FusionPulse v3.6.1 coin-headline/heatmap/crowd/glossary regressions: OK');

// ---------------------------------------------------------------------------
// v3.6.3 · Die Kennzahlen im Fokusfenster ("Reife", "SQUEEZE RELEASE", "Score")
// standen ohne jede Erklaerung da. Das war die groesste verbliebene Luecke:
// ausgerechnet die Zeile, die man zuerst liest, war die einzige ohne Mouseover.
{
  const { loadClient } = await import('./client-harness.mjs');
  const C = loadClient();

  // -- Jede Kennzahl der Kopfzeile ist erklaert, und zwar in normaler Sprache.
  for (const k of ['score','maturity','situationScore','lifecyclePhase','execScore','sectorTag']) {
    assert.ok(C.GLOSS[k] && C.GLOSS[k].length >= 120, `Kennzahl "${k}" braucht eine Laien-Erklaerung`);
    assert.ok(C.GLOSS_LABEL[k], `Kennzahl "${k}" braucht eine Ueberschrift im sichtbaren Glossar`);
  }
  // Die haeufigsten Fehldeutungen muessen ausdruecklich adressiert sein.
  assert.match(C.gloss('maturity'), /kein Kaufsignal|Fortschrittsbalken/, 'Reife muss klarstellen, dass sie kein Kaufsignal ist');
  assert.match(C.gloss('situationScore'), /0 % Gewicht|Priorisierung/, 'Situation muss klarstellen, dass sie die Freigabe nicht beeinflusst');
  assert.match(C.gloss('score'), /NICHTS|nicht.*lohnt/i, 'Score muss von der Wirtschaftlichkeit abgegrenzt werden');

  // -- Alle Situationstypen, die der Worker erzeugen kann, sind erklaert.
  const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url),'utf8');
  const produced = [...new Set([...worker.matchAll(/situation(?:Type)?\s*=\s*'([A-Z][A-Z ]+)'/g)].map(m=>m[1]))];
  assert.ok(produced.length >= 6, `Es muessen mehrere Situationstypen gefunden werden, gefunden: ${produced.length}`);
  for (const t of produced) {
    const txt = C.glossForSituation(t);
    assert.ok(txt.length >= 100, `Situationstyp "${t}" braucht eine Erklaerung (hat ${txt.length} Zeichen)`);
    assert.ok(!/^Von der Situation Engine erkanntes/.test(txt),
      `Situationstyp "${t}" faellt auf den Platzhaltertext zurueck — es fehlt ein eigener Glossareintrag`);
  }
  // Der Fall aus dem Screenshot, namentlich.
  assert.match(C.glossForSituation('SQUEEZE RELEASE'), /Kompression|Schwankungen/, 'SQUEEZE RELEASE muss in normaler Sprache erklaert sein');
  assert.match(C.glossForSituation('SQUEEZE RELEASE'), /nicht.*nach oben|sagt.*nicht/i, 'SQUEEZE RELEASE muss klarstellen, dass es keine Richtung vorhersagt');

  // -- Im Fokusfenster sind die Begriffe einzeln markiert, nicht als ein Block.
  assert.match(app, /class="sf-tags"/, 'Die Kennzahlenzeile braucht eine eigene, erklaerbare Struktur');
  assert.match(app, /gl\('Score '\+num\(top\.score,1\),'score'\)/, 'Score im Fokus muss erklaert sein');
  assert.match(app, /gl\('Reife '\+Math\.round\(top\.preSignalMaturity\)\+'%','maturity'\)/, 'Reife im Fokus muss erklaert sein');
  assert.match(app, /glossForSituation\(top\.situationType\)/, 'Der Situationstyp im Fokus muss erklaert sein');
  assert.match(app, /gl\(top\.sector,'sectorTag'\)/, 'Die Branche im Fokus muss erklaert sein');
  assert.doesNotMatch(app, /<span>\$\{esc\(top\.sector\)\} · Score/, 'Die alte Zeile ohne Mouseover darf nicht zurueckkehren');

  // -- Entry/Stop/TP1/TP2 im Fokus hatten ebenfalls keinen Mouseover.
  for (const [label,needle] of [['Entry',/Der geplante Kaufkurs/],['Stop',/Stop-Loss: der Kurs/],
                                ['TP1',/halbe Position verkauft/],['TP2',/verbleibende halbe Position/]]) {
    assert.match(app, needle, `${label} im Fokusfenster braucht eine Erklaerung`);
  }

  // -- Vollstaendigkeit: kein Glossareintrag ohne sichtbaren Platz (Regel aus 3.6.0).
  const grouped = new Set(C.GLOSS_GROUPS.flatMap(g=>g.keys));
  for (const k of Object.keys(C.GLOSS)) assert.ok(grouped.has(k), `Neuer Glossareintrag "${k}" fehlt in der sichtbaren Liste`);
}

console.log('✓ FusionPulse v3.6.3 focus-metrics/situation glossary regressions: OK');

// ---------------------------------------------------------------------------
// v3.6.4 · Fuenf Rueckmeldungen aus dem Betrieb: ET ohne Ortszeit, Kurse aus
// der Vortagssitzung die wie tagesaktuell aussehen, fehlender Plan-Knopf bei
// Aktien, unerklaerte gestrichelte Punkte, Spuren ohne Richtungsaussage.
{
  const { loadClient } = await import('./client-harness.mjs');
  const C = loadClient();
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url),'utf8');
  const css  = fs.readFileSync(new URL('../public/style.css',  import.meta.url),'utf8');
  C.S.equity = 5000; C.S.riskPct = 0.75; C.S.claudeMode = true;

  // -- ET-Angaben bekommen ueberall unsere Ortszeit dazu.
  const withLocal = C.withLocalTime('Premarket 04:00–08:00 ET');
  assert.notEqual(withLocal, 'Premarket 04:00–08:00 ET', 'ET-Zeiten muessen um die Ortszeit ergaenzt werden');
  assert.match(withLocal, /\(\d{2}:\d{2}–\d{2}:\d{2} /, 'Die Ortszeit muss als Spanne in Klammern erscheinen');
  assert.equal(C.withLocalTime('kein Zeitbezug'), 'kein Zeitbezug', 'Texte ohne ET duerfen nicht veraendert werden');
  /* Die Gegenrechnung muss UNABHAENGIG sein. Ein erster Entwurf hat die
     erwartete Zeit aus derselben Funktion abgeleitet, die geprueft werden
     sollte — die Negativkontrolle (fester Offset statt Zonenrechnung) ist
     deshalb NICHT gefallen. Jetzt wird der echte Zeitpunkt gesucht, dessen
     New Yorker Wanduhr 09:30 zeigt, und unabhaengig lokal formatiert. */
  const nyWall = (ms) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour12:false,
      hour:'2-digit',minute:'2-digit'}).formatToParts(new Date(ms))
      .filter(x=>x.type!=='literal').map(x=>[x.type,+x.value]));
    return (p.hour===24?0:p.hour)*60 + p.minute;
  };
  const nyDate = new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',
    year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  let inst = Date.parse(`${nyDate}T09:30:00Z`);
  for (let i=0;i<4;i++) inst += ((9*60+30) - nyWall(inst)) * 60_000;   // konvergiert in 2 Schritten
  assert.equal(nyWall(inst), 9*60+30, 'Der gesuchte Zeitpunkt muss in New York 09:30 sein');
  const expected = new Intl.DateTimeFormat('de-DE',{hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(inst));
  assert.equal(C.etClockToLocal('09:30'), expected,
    'Die Ortszeit der US-Eroeffnung muss DST-sicher aus der echten Zonendifferenz kommen, nicht aus einem festen Offset');

  // -- Datenstand: ein Kurs vom Vortag darf nicht wie tagesaktuell aussehen.
  //    Fixture: gestern 19:55 UTC = 15:55 ET = regulaere Sitzung, kurz vor Schluss.
  const y = new Date(Date.now() - 24*60*60_000);
  const iso = (d,h,m)=>new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate(),h,m)).toISOString();
  const stale = C.dataSession({ updated: iso(y,19,55) });
  assert.equal(stale.known, true, 'Der Zeitstempel muss lesbar sein');
  assert.equal(stale.sameDay, false, 'Ein Kurs vom Vortag darf nicht als heutig gelten');
  assert.match(stale.label, /^Kurs vom /, 'Das Datum muss im Label stehen, wenn die Daten nicht von heute sind');
  assert.match(stale.detail, /NICHT von heute/, 'Es muss ausdruecklich dastehen, dass die Daten nicht von heute sind');
  assert.match(stale.detail, /wann FusionPulse zuletzt nachgesehen/, 'Der Unterschied Abfrage vs. Kursalter muss erklaert sein');
  assert.match(stale.label, /ET \(\d{2}:\d{2}\)/, 'Die Sitzungszeit muss in ET UND unserer Zeit stehen');
  assert.equal(stale.session, 'regular', '15:55 ET gehoert in die regulaere Sitzung');
  // Ohne Zeitstempel wird nichts behauptet.
  const none = C.dataSession({});
  assert.equal(none.known, false, 'Ohne Zeitstempel darf kein Datenstand behauptet werden');
  assert.match(none.detail, /keine Kauf-Freigabe/, 'Fehlender Datenstand muss fail-closed begruendet sein');
  assert.match(app, /class="data-session \$\{ds\.tone\}"/, 'Der Datenstand muss im Fokusfenster erscheinen');

  // -- Aktien brauchen denselben Plan-Kopierknopf wie Krypto.
  assert.match(app, /id="stockFocusPlan"/, 'Die Aktien-Fokuskarte braucht einen Plan-Knopf');
  assert.match(app, /function stockOrderPlan\(r\)/, 'Es muss einen Aktien-Orderplan geben');
  assert.match(app, /stockFocusPlan'\)\?\.addEventListener\('click',e=>copy\(stockOrderPlan\(top\),e\.target\)\)/, 'Der Plan-Knopf muss den Aktienplan kopieren');
  C.stockMeta = { ts:Date.now(), refreshedSymbols:['PLN'], market:{key:'regular'} };
  const row = { symbol:'PLN', name:'Plan Inc.', securityName:'Plan Incorporated', sector:'Tech',
    light:'green', score:8.3, verdict:'Kauf-Setup · Claude', setup:'Pullback', situationType:'PULLBACK',
    claude:{light:'green',score:8.3,verdict:'Kauf-Setup · Claude',expectancyR:0.3,blockers:[]},
    entryEur:25.00, stopEur:24.90, tp1Eur:25.20, tp2Eur:25.40, priceEur:25.00,
    entryUsd:29.25, stopUsd:29.13, tp1Usd:29.48, tp2Usd:29.72, priceUsd:29.25,
    netCRV:1.1, tp2Pct:1.6, updated:new Date().toISOString().slice(0,19).replace('T',' '), marketPhase:'regular' };
  const plan = C.stockOrderPlan(row);
  for (const needle of [/Entry\s/, /Stop\s/, /TP1\s/, /TP2\s/, /Größe/, /Datenstand:/]) {
    assert.match(plan, needle, `Der Aktienplan muss ${needle} enthalten`);
  }
  // Der Plan muss ehrlich sein, wenn kein BUY vorliegt.
  assert.equal(C.stockLevel(row), 2, 'Fixture darf keine Freigabe haben');
  assert.match(plan, /KEINE KAUF-FREIGABE/, 'Ein Plan ohne Freigabe muss das im Text sagen');
  assert.match(plan, /NICHT frei/, 'Der Hinweis am Ende muss die fehlende Freigabe wiederholen');
  assert.match(plan, /KEINE Tradegate-Kurse/, 'Die EUR-Umrechnung muss im kopierten Text als solche gekennzeichnet sein');

  // -- Heatmap: gestrichelte Punkte und Spurrichtung sind erklaert.
  assert.match(html, /class="maplegend2"/, 'Die Heatmap braucht eine Legende');
  assert.match(html, /Muster ok, Plan zu klein/, 'Der hohle Punkt muss in der Legende erklaert sein');
  assert.match(html, /wandert nach rechts oben/, 'Die gruene Spur muss in der Legende erklaert sein');
  assert.match(app, /const dir = move<6 \? 'flat'/, 'Die Spur muss eine Richtung bestimmen');
  assert.match(app, /class="trailwrap dir-\$\{dir\}/, 'Die Richtung muss die Darstellung steuern');
  assert.match(app, /keine Ertragsaussage/, 'Die Spur muss klarstellen, dass sie keinen Ertrag verspricht');
  assert.match(css, /\.dir-sweet \.stocktrail\{stroke:var\(--green\)/, 'Bewegung nach rechts oben muss gruen gezeichnet werden');
  assert.match(css, /\.trailwrap\.focus \.stocktrail\{stroke-width:2\.4/, 'Die Spur des ausgewaehlten Titels muss hervorgehoben sein');
}

console.log('✓ FusionPulse v3.6.4 session/timezone/plan/trail regressions: OK');

// ---------------------------------------------------------------------------
// v3.6.5 · SerpAPI-Budgetwaechter. Der Nutzer hat einen Freitarif-Schluessel
// hinterlegt; ohne diese Schicht haette EIN Handelstag das Monatskontingent
// verbraucht. Hier wird der Worker-Code strukturell geprueft, weil er ohne
// echten D1-Kontext nicht ausfuehrbar ist — plus die Client-Ablauflogik
// funktional am laufenden Client.
{
  const { loadClient } = await import('./client-harness.mjs');
  const C = loadClient();
  const w = fs.readFileSync(new URL('../src/worker.js', import.meta.url),'utf8');
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url),'utf8');

  // -- Der D1-Cache muss GELESEN werden, nicht nur beschrieben.
  //    Genau das war der Fehler: crowd_cache war reines Schreibziel, und
  //    crowdMemo lebt nur im Isolate — also faktisch kein Cache.
  assert.match(w, /async function d1ReadCrowd\(env,syms\)/, 'Der Crowd-Cache muss auch gelesen werden');
  assert.match(w, /const cache=await d1ReadCrowd\(env,syms\)/, 'crowdPulse muss den persistenten Cache nutzen');
  assert.ok(w.indexOf('SELECT symbol,ts,score,stars,accel,interest,source FROM crowd_cache') > 0,
    'Der Cache muss per SQL gelesen werden, nicht aus dem Arbeitsspeicher');

  // -- Hartes Monatsbudget, das auch "force" nicht umgehen kann.
  assert.match(w, /async function crowdBudgetRead\(env\)/, 'Es braucht eine Budget-Erfassung');
  assert.match(w, /async function crowdBudgetAdd\(env,n\)/, 'Verbrauch muss gezaehlt werden');
  assert.match(w, /'serpapi_quota'/, 'Das Budget muss persistent in fp_meta liegen');
  assert.match(w, /const allowed=Math\.max\(0,Math\.min\(CROWD_MAX_FETCH_CALL, quota\.left, stale\.length\)\)/,
    'Die Zahl echter Abfragen muss durch das Restbudget begrenzt sein');
  assert.match(w, /const ttl=force\?CROWD_TTL_FORCED_MS:CROWD_TTL_MS/,
    'Auch ein erzwungener Abruf braucht einen Mindestabstand');
  assert.ok(/CROWD_TTL_FORCED_MS\s*=\s*60\*60_000/.test(w), 'Der erzwungene Mindestabstand muss mindestens eine Stunde betragen');
  assert.ok(/CROWD_MAX_FETCH_CALL\s*=\s*3/.test(w), 'Pro Aufruf duerfen nur wenige echte Abfragen laufen');
  const budget = /CROWD_DEFAULT_BUDGET\s*=\s*(\d+)/.exec(w);
  assert.ok(budget && Number(budget[1]) < 100, `Das Standardbudget muss unter dem Freitarif-Limit liegen, ist ${budget?.[1]}`);

  // -- Bei erschoepftem Budget wird NICHTS geschaetzt.
  assert.match(w, /SerpAPI-Monatsbudget erschöpft; es wird bewusst nichts geschätzt/,
    'Bei erschoepftem Budget muss das ausdruecklich dastehen statt eines Ersatzwerts');
  assert.match(w, /state:after<=0&&stale\.length>spent\?'quota':'ok'/, 'Der erschoepfte Zustand muss eigens gemeldet werden');

  // -- Nur echte Neuabfragen duerfen in den Cache zurueckgeschrieben werden,
  //    sonst verjuengt sich ein alter Wert bei jedem Abruf selbst.
  assert.match(w, /x\.cached===false&&Number\.isFinite\(Number\(x\.score\)\)/,
    'Zurueckgelesene Cache-Werte duerfen nicht erneut gespeichert werden');

  // -- Client: weniger Symbole, einstellbar, und Kontingent sichtbar.
  assert.ok(C.DEFAULTS.crowdSymbolLimit <= 8, `Standardmaessig duerfen nur wenige Symbole beobachtet werden, sind ${C.DEFAULTS.crowdSymbolLimit}`);
  assert.match(html, /id="sCrowdLimit"/, 'Die Symbolzahl muss einstellbar sein');
  assert.match(html, /100 Suchen im MONAT/, 'Die Kostenfolge muss bei der Einstellung dastehen');
  C.crowdMeta = { configured:true, state:'ok', quota:{month:'2026-08',used:42,budget:90,left:48,ttlHours:6,pending:2,persistent:true} };
  C.crowdMap = new Map([['AAA',{symbol:'AAA',score:30,_ts:Date.now()}]]);
  const st = C.crowdStatus();
  assert.match(st.label, /Kontingent 42\/90/, 'Das Kontingent muss in der Statuszeile stehen, nicht im Kleingedruckten');
  assert.match(st.detail, /48 frei/, 'Der Rest muss beziffert sein');
  C.crowdMeta = { configured:true, state:'quota', quota:{month:'2026-08',used:90,budget:90,left:0,ttlHours:6,pending:5,persistent:true} };
  const ex = C.crowdStatus();
  assert.equal(ex.ok, false, 'Erschoepftes Budget ist kein Normalzustand');
  assert.match(ex.detail, /keine Werte geschätzt/, 'Auch hier darf nichts erfunden werden');
  // Fehlende Persistenz muss als Unsicherheit benannt werden, nicht verschwiegen.
  C.crowdMeta = { configured:true, state:'ok', quota:{month:'2026-08',used:5,budget:90,left:85,ttlHours:6,pending:0,persistent:false} };
  assert.match(C.crowdStatus().detail, /kann.*höher liegen/, 'Ohne D1 muss die Unsicherheit des Zaehlers dastehen');

  // -- Ablauflogik: nichts darf ueber die Gueltigkeit hinaus stehenbleiben.
  C.crowdMeta = { quota:{ttlHours:6} };
  const now = Date.now();
  C.crowdMap = new Map([
    ['FRESH',{symbol:'FRESH',score:50,_ts:now-60_000}],
    ['OLD',  {symbol:'OLD',  score:70,_ts:now-13*60*60_000}],
    ['NOTS', {symbol:'NOTS', score:20}],
  ]);
  const removed = C.crowdPrune();
  assert.equal(removed, 2, 'Abgelaufene und zeitstempellose Werte muessen entfernt werden');
  assert.ok(C.crowdMap.has('FRESH'), 'Gueltige Werte duerfen nicht verworfen werden');
  assert.ok(!C.crowdMap.has('OLD'), 'Ein 13 Stunden alter Wert ist bei 6 h Gueltigkeit abgelaufen');
  assert.ok(!C.crowdMap.has('NOTS'), 'Ohne Zeitstempel gilt fail-closed: entfernen');
}

console.log('✓ FusionPulse v3.6.5 serpapi-budget/crowd-cache regressions: OK');
