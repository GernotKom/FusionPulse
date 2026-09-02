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
/* v3.27.0 · Schneidet GENAU eine Top-Level-Funktion aus. Vorher endeten diese
   Schnitte an einem entfernten Kommentar-Anker; als in v3.27.0 ein neues Modul
   dazwischen kam, zog der Schnitt es mit hinein und meldete einen Fehler in
   Code, der gar nicht geprueft werden sollte. Ein Test, der von der Reihenfolge
   der Datei abhaengt, ist ein Test, der irgendwann falsch anschlaegt. */
function sliceFn(src, header) {
  const i = src.indexOf(header);
  if (i < 0) throw new Error('Funktion nicht gefunden: ' + header);
  const j = src.indexOf('\n}\n', i);
  if (j < 0) throw new Error('Funktionsende nicht gefunden: ' + header);
  return src.slice(i, j + 3);
}

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
assert.match(workerText,/const syms=\[\.\.\.favPick,\.\.\.recheckPick,\.\.\.gainerPick,\.\.\.sectorPick,\.\.\.radarPick,\.\.\.boatsPick,\.\.\.explore\]\.slice\(0,deepLimit\)/,'Deep scan must cap adaptive candidate batch at the configurable deep limit');
assert.match(workerText,/await tiingoFetch\(env,'\/iex'\)/,'Whole-market Radar must use Tiingo IEX bulk snapshot');
/* v4.0.0: Diese Zusicherung war an die KADENZFORMEL genagelt
   (`stockMinute%2===1`), obwohl ihre Aussage lautet „laeuft serverseitig".
   Damit haette jede Aenderung der Kadenz sie brechen muessen — und beim
   Einbau des Marktphasen-Waechters tat sie das auch. Geprueft wird jetzt die
   Absicht: der Radar wird aus dem Cron-Zyklus aufgerufen und dort getaktet. */
{
  const cycStart = workerText.indexOf('async function serverLearningCycle(');
  const cycle = workerText.slice(cycStart, workerText.indexOf('\n}\n', cycStart) + 3);
  assert.ok(cycle.length > 1000 && cycle.length < 12000,
    `Der geprueffte Ausschnitt muss der Cron-Zyklus sein, ist ${cycle.length} Zeichen`);
  assert.match(cycle,/radarDueNow\(phase\.key, ?stockMinute\)[\s\S]{0,200}tiingoIexMarketRadar\(env,80,true\)/,
    'Server scheduler must keep the market radar independent of the browser, gated by market phase');
}
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
/* v3.4.2 → v3.8.0: BEWUSSTE AENDERUNG einer Sicherheitsregel. Bitte lesen,
   bevor jemand sie wieder zurueckdreht.

   Die urspruengliche Absicht stand im Code-Kommentar: „The goal is practical
   broker tradability rather than maximum candidate count." Absicht war also
   HANDELBARKEIT — die Namensliste war nur das Mittel dazu.

   Das Mittel hatte einen Nebeneffekt, der erst im Betrieb auffiel: aus rund
   12.000 gescannten Titeln kamen 48 durch, alle Mega-Caps. Ein Nachrichten-
   Mover konnte den Radar nie erreichen. Fuer den Anwendungsfall des Nutzers
   (starke Tagesbewegungen finden) suchte die App per Konstruktion daran vorbei.

   Die Absicht bleibt, das Mittel wird MESSBAR: Mindestkurs, Mindest-Dollar-
   umsatz, maximaler Spread, Mindestbewegung. Das prueft Handelbarkeit direkt,
   statt sie ueber Bekanntheit zu schaetzen — und es veraltet nicht.
   Die Large-Cap-Liste bleibt als zusaetzlicher Einlasspfad bestehen.        */
assert.match(workerText,/const LARGE_CAP_RADAR_SYMBOLS = new Set/,'Die kuratierte Large-Cap-Liste muss als Einlasspfad erhalten bleiben');
/* v3.32.0: Regex geweitet. Die Funktion nimmt seit R11 ein drittes Argument
   (env), damit die Umsatzschwelle am Massstab des tatsaechlich benutzten Feeds
   prueft. Der ZWECK dieses Tests ist unveraendert — gefiltert wird, und mit
   Zaehlung. Ein Test, der an der Argumentzahl klebt, prueft die Schreibweise
   statt der Sache. */
assert.match(workerText,/\.filter\(r=>radarCandidateAllowed\(r,true[,)]/,'Der Whole-Market-Radar muss vor Ranking/Anzeige gefiltert werden — mit Zaehlung, damit eine leere Liste erklaerbar bleibt');
assert.match(workerText,/x=>x\?\.m\?\.tradableStock && radarCandidateAllowed\(x\?\.r[,)]/,'Verifizierte Kandidaten muessen das Handelbarkeitsgitter passieren');
assert.match(workerText,/if\(largeCapRadarAllowed\(r\?\.symbol\)\)\{ if\(count\)radarGateStats\.largeCap\+\+; return true; \}/,
  'Einlasspfad 1: kuratierte Large-Cap-Liste');
assert.match(workerText,/const ok=momentumRadarAllowed\(r,count[,)]/,'Einlasspfad 2: messbares Momentum-Gitter');
assert.doesNotMatch(workerText,/return true;\s*\}\s*function radarCandidateAllowed/,'Kein dritter, ungeprueffter Einlassweg');
// Das Gitter muss fail-closed sein: fehlende Werte duerfen NICHT durchlassen.
assert.match(workerText,/if\(!\(price>=MOM_MIN_PRICE_USD\)\)\{ if\(count\)radarGateStats\.failPrice\+\+; return false; \}/,'Ohne bekannten Kurs kein Einlass');
assert.match(workerText,/if\(!\(vol>0\) \|\| !\(price\*vol>=momMinDollarVol\(env\)\)\)\{ if\(count\)radarGateStats\.failVolume\+\+; return false; \}/,'Ohne bekannten Dollarumsatz kein Einlass');
// Und die Schwellen muessen nennenswert bleiben, sonst ist das Gitter Dekoration.
{
  const num=(k)=>Number((new RegExp(k+"\\s*=\\s*([0-9_\\.]+)").exec(workerText)||[])[1]?.replace(/_/g,''));
  assert.ok(num('MOM_MIN_PRICE_USD')>=5,'Mindestkurs muss Penny Stocks ausschliessen');
  /* v3.8.1 KALIBRIERUNG: Die Schwelle bezieht sich auf den IEX-ANTEIL des
     Umsatzes, nicht auf den Gesamtmarkt — IEX hat nur 2–3 % des US-Volumens.
     Der erste Entwurf (20 Mio. $) haette deshalb praktisch alles ausgesperrt.
     Untergrenze bleibt trotzdem nennenswert, damit das Gitter kein Feigenblatt
     wird; die Handelbarkeit sichern Kurs- und Spread-Kriterium zusaetzlich. */
  assert.ok(num('MOM_MIN_DOLLARVOL')>=1_000_000,'Mindest-Dollarumsatz muss echte Liquiditaet verlangen');
  assert.ok(num('MOM_MIN_DOLLARVOL')<=10_000_000,'Die Schwelle darf nicht am Gesamtmarkt kalibriert sein — IEX liefert nur einen Bruchteil');
  assert.ok(num('MOM_MAX_SPREAD_PCT')<=1.0,'Der zugelassene Spread muss eng genug bleiben, um den Ertrag nicht zu fressen');
  assert.ok(num('MOM_MIN_MOVE_PCT')>=2,'Ein Mover muss sich nennenswert bewegt haben');
}
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
  /* v3.8.0: Die Handelskosten sind seither einstellbar. Diese Fixture bildet
     einen ECHTEN Screenshot vom 26.8. nach und muss deshalb die damals
     geltenden Annahmen festnageln (10,75 € je Order, 0,06 % Reibung) —
     sonst verschiebt eine spaetere Einstellungsaenderung den Regressionstest. */
  C.S.orderFeeEur = 10.75; C.S.venueFrictionPct = 0.06;
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
  C.S.orderFeeEur = 10.75; C.S.venueFrictionPct = 0.06;   // Kostenannahmen festnageln (v3.8.0)

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
  /* v3.32.10 · DIESE FIXTURE WAR SELBST ZEITZONENABHAENGIG KAPUTT.
     Sie baute „gestern" aus UTC minus 24 Stunden und fragte dann nach dem
     US-HANDELSTAG. Zwischen 00:00 und 04:00 UTC (also 20:00–00:00 ET am Abend
     davor) liegt „vor 24 Stunden" noch auf DEMSELBEN ET-Kalendertag — die
     Fixture stellte also gar keinen Vortag dar, und der Test fiel, obwohl der
     Code richtig war. Genau die Konvention, die das Handover fordert:
     zeitzonenabhaengige Fixtures muessen aus der GEPRUEFTEN Zone abgeleitet
     werden, nicht aus UTC oder der Browserzone.
     Jetzt: vom ET-Kalendertag rueckwaerts gehen, bis ein anderer ET-Tag
     erreicht ist, und dort 15:55 ET einstellen. */
  const etDayOf=(ms)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',
    year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ms));
  const heuteEt=etDayOf(Date.now());
  let staleAt = Date.now();
  for (let i=0; i<48 && etDayOf(staleAt)===heuteEt; i++) staleAt -= 60*60_000;
  assert.notEqual(etDayOf(staleAt), heuteEt, 'Die Fixture muss auf einem anderen US-Handelstag liegen');
  for (let i=0;i<4;i++) staleAt += ((15*60+55) - nyWall(staleAt)) * 60_000;   // 15:55 ET, kurz vor Schluss
  assert.equal(nyWall(staleAt), 15*60+55, 'Die Fixture muss in New York 15:55 sein');
  assert.notEqual(etDayOf(staleAt), heuteEt, 'Und dabei auf dem Vortag bleiben — sonst prueft der Test nichts');
  const stale = C.dataSession({ updated: new Date(staleAt).toISOString() });
  assert.equal(stale.known, true, 'Der Zeitstempel muss lesbar sein');
  assert.equal(stale.sameDay, false, 'Ein Kurs vom Vortag darf nicht als heutig gelten');
  /* v3.32.3: Diese Pruefung war 47 Versionen lang latent kaputt. `sameDay`
     verglich die BROWSER-Ortszeit, waehrend die Frage den US-Handelstag
     betrifft. Am 01.09. um 04:11 UTC fiel sie erstmals auf: in
     `America/Chicago` liegt „vor 24 Stunden" um 23:11 Ortszeit noch auf
     demselben Kalendertag. Zwei ausdrueckliche Faelle, die den Unterschied
     festnageln — ohne sie kaeme derselbe Fehler beim naechsten Umbau zurueck. */
  // Ein Kurs aus der LAUFENDEN ET-Sitzung gilt als heutig, egal wo der Nutzer sitzt.
  let probe=Date.now(); while(etDayOf(probe)!==heuteEt) probe-=3600_000;
  assert.equal(C.dataSession({updated:new Date(probe).toISOString()}).sameDay, true,
    'Ein Kurs vom heutigen ET-Handelstag muss als heutig gelten — unabhaengig von der Zeitzone des Nutzers');
  // Und einer von einem anderen ET-Tag nicht, auch wenn er lokal „heute" waere.
  let vortag=Date.now(); while(etDayOf(vortag)===heuteEt) vortag-=3600_000;
  assert.equal(C.dataSession({updated:new Date(vortag).toISOString()}).sameDay, false,
    'Ein Kurs von einem anderen ET-Handelstag darf nie als heutig gelten');
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

// ---------------------------------------------------------------------------
// v3.7.0 · P3: Krypto-Sentiment (Fear & Greed, alternative.me).
// Wichtig ist hier weniger die Anzeige als die Abgrenzung: der Index darf
// NICHTS bewerten, gilt nur fuer Krypto, und ist etwas anderes als das
// Risk-On/Off-Badge (das ist Marktbreite).
{
  const { loadClient } = await import('./client-harness.mjs');
  const C = loadClient();
  const w = fs.readFileSync(new URL('../src/worker.js', import.meta.url),'utf8');
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url),'utf8');

  // -- Quelle und Route.
  assert.match(w, /api\.alternative\.me\/fng\//, 'Der Index muss von alternative.me kommen');
  assert.match(w, /url\.pathname === '\/api\/sentiment'/, 'Es braucht eine eigene Route');
  assert.match(w, /async function cryptoSentiment\(env, force=false\)/, 'Es braucht eine Sentiment-Funktion');
  // Kein Schluessel noetig — das ist der Grund, warum das sofort geht.
  const fngBody = w.slice(w.indexOf('async function cryptoSentiment'), w.indexOf('function moonPhase(){'));
  assert.ok(fngBody.length > 500 && fngBody.length < 6000, 'Der Funktionsausschnitt muss plausibel begrenzt sein');
  assert.doesNotMatch(fngBody, /api_key|API_KEY|SENTIMENT_KEY/,
    'Der Index darf keinen Zugangsschluessel brauchen — genau deshalb ist er sofort nutzbar');

  // -- Fail-closed: bei Ausfall wird nichts erfunden.
  assert.match(w, /kein Ersatzwert erfunden/, 'Bei Ausfall darf kein Wert erfunden werden');
  assert.match(w, /state:'stale', stale:true/, 'Ein alter Wert muss als alt gekennzeichnet werden');
  assert.match(w, /if\(!Number\.isFinite\(value\)\) throw new Error\('kein Zahlenwert'\)/, 'Unbrauchbare Antworten muessen abgewiesen werden');

  // -- Die Abgrenzung muss ueberall dranstehen.
  assert.match(w, /0 % Gewicht in Score und Kauf-Freigabe/, 'Der Worker muss die Nullgewichtung dokumentieren');
  assert.match(w, /Gilt NICHT fuer Aktien/, 'Die Krypto-Beschraenkung muss benannt sein');
  assert.match(app, /Kontext, kein Signal — 0 % Gewicht in der Kauf-Freigabe/, 'Die Kachel muss die Nullgewichtung sichtbar tragen');
  assert.match(app, /Er gilt ausschließlich für Krypto — für Aktien sagt er nichts/, 'Der Tooltip muss die Krypto-Beschraenkung nennen');

  // -- Der Wert darf NIRGENDS in eine Bewertung einfliessen (Invariante 3).
  /* Manche Bewertungsfunktionen sind als `const x = (r) => {`, andere als
     `function x(r){` geschrieben — beide Formen muessen gefunden werden,
     sonst prueft die Schleife stillschweigend gar nichts. */
  for (const fn of ['stockHeadline','coinHeadline','stockLevel','stockOpportunity','stockTradeability','stockStrength']) {
    const i = [app.indexOf(`function ${fn}(`), app.indexOf(`const ${fn} = (`), app.indexOf(`const ${fn}=(`)]
      .filter(x => x >= 0).sort((a,b)=>a-b)[0];
    assert.ok(i !== undefined && i >= 0, `${fn} muss auffindbar sein`);
    const body = app.slice(i, i + 3000);
    assert.doesNotMatch(body, /fngData|fearGreed|sentiment/i, `${fn} darf den Stimmungsindex nicht auswerten (Invariante 3)`);
  }

  // -- Anzeige: Werte werden korrekt eingeordnet, Extremwerte nicht als Signal verkauft.
  C.fngData = { state:'ok', value:12, tone:'extreme-fear', de:'Extreme Angst', meaning:'Test',
    change1d:-4, change7d:-11, ts:Date.now()-3*3600_000, source:'alternative.me' };
  const t = C.sentimentTitle(C.fngData);
  assert.match(t, /12\/100/, 'Der Zahlenwert muss im Tooltip stehen');
  assert.match(t, /Keine Prognose/, 'Es muss dastehen, dass es keine Prognose ist');
  assert.match(t, /einmal täglich aktualisiert/, 'Die Aktualisierungsfrequenz muss dastehen');
  C.fngData = { state:'error', error:'timeout' };
  assert.match(C.sentimentTitle(C.fngData), /kein Ersatzwert erfunden/, 'Auch im Fehlerfall bleibt die Regel sichtbar');
  assert.match(html, /id="sentimentCard"/, 'Die Kachel muss im Markup existieren');

  // -- Risk-On/Off ist NICHT Sentiment und muss das jetzt sagen.
  assert.match(app, /Marktregime = MARKTBREITE, nicht Stimmung/, 'Das Regime-Badge muss sich vom Sentiment abgrenzen');
  assert.match(app, /was Kurse TUN — nicht, was Marktteilnehmer FÜHLEN/, 'Der Unterschied muss im Klartext dastehen');
  assert.match(C.GLOSS.breadth, /kein Sentiment/, 'Das Glossar muss Marktbreite vom Sentiment abgrenzen');
  assert.match(C.GLOSS.fearGreed, /ausschließlich für Krypto/, 'Das Glossar muss die Krypto-Beschraenkung nennen');
  assert.match(C.GLOSS.contrarian, /KEINE Handelsregel|fallende Messer/, 'Antizyklisches Denken muss vor Fehldeutung warnen');
  const grouped = new Set(C.GLOSS_GROUPS.flatMap(g=>g.keys));
  for (const k of ['fearGreed','contrarian','breadth']) assert.ok(grouped.has(k), `"${k}" fehlt im sichtbaren Glossar`);
}

console.log('✓ FusionPulse v3.7.0 crypto-sentiment regressions: OK');

// ---------------------------------------------------------------------------
// v3.8.0 · Handelskosten als Einstellung + Momentum-Kandidatengitter.
// Anlass: Der Nutzer nutzt die App als SUCHWERKZEUG (Kandidaten finden, dann
// bei flatex und Google Finance selbst pruefen) und handelt US-Titel direkt
// fuer rund 11–12 € je Order. Die fest verdrahtete 10,75-€-Konstante ging in
// jede Wirtschaftlichkeitsschwelle ein — eine falsche Zahl an dieser Stelle
// verzerrt alles darueber.
{
  const { loadClient } = await import('./client-harness.mjs');
  const C = loadClient();
  const w = fs.readFileSync(new URL('../src/worker.js', import.meta.url),'utf8');
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url),'utf8');

  // -- Die Kosten duerfen nirgends mehr fest verdrahtet sein.
  assert.doesNotMatch(app, /STOCK_ORDER_FIXED_EUR\s*\*/, 'Die Ordergebuehr darf nicht mehr als Konstante gerechnet werden');
  assert.doesNotMatch(app, /STOCK_EXECUTION_FRICTION_PCT\s*\//, 'Die Reibung darf nicht mehr als Konstante gerechnet werden');
  assert.match(html, /id="sOrderFee"/, 'Die Ordergebuehr muss einstellbar sein');
  assert.match(html, /id="sVenueFriction"/, 'Die Spread-Reserve muss einstellbar sein');
  assert.match(html, /Preis-Leistungsverzeichnis/, 'Die Einstellung muss zur Pruefung beim eigenen Broker auffordern');

  // -- Die Einstellung muss tatsaechlich durchschlagen, nicht nur existieren.
  C.stockMeta = { ts:Date.now(), refreshedSymbols:['CST'], market:{key:'regular'} };
  const row = { symbol:'CST', name:'Cost Test', sector:'Tech', light:'green', score:8.3,
    verdict:'Kauf-Setup · Claude', claude:{light:'green',score:8.3,verdict:'Kauf-Setup · Claude',expectancyR:0.3,blockers:[]},
    entryEur:25.00, stopEur:24.90, tp1Eur:26.00, tp2Eur:27.50, priceEur:25.00,
    entryUsd:29.25, stopUsd:29.13, tp1Usd:30.42, tp2Usd:32.18, priceUsd:29.25,
    netCRV:3.2, tp2Pct:10, setup:'Pullback', situationType:'PULLBACK',
    updated:new Date().toISOString().slice(0,19).replace('T',' '), marketPhase:'regular' };
  C.S.equity=5000; C.S.riskPct=0.75; C.S.claudeMode=true; C.mutedSetupSet=new Set();
  C.S.orderFeeEur = 5.00;  C.S.venueFrictionPct = 0.05;
  const cheap = C.stockSizing(row).planNet;
  C.S.orderFeeEur = 20.00; C.S.venueFrictionPct = 0.50;
  const dear  = C.stockSizing(row).planNet;
  assert.ok(cheap > dear, `Hoehere Kosten muessen den Netto-Ertrag senken (${cheap.toFixed(0)} vs ${dear.toFixed(0)})`);
  assert.ok(cheap - dear > 40, 'Der Unterschied muss spuerbar durchschlagen, nicht nur kosmetisch sein');
  // Fehlende/unsinnige Angabe faellt auf den konservativen Standard zurueck.
  C.S.orderFeeEur = undefined; C.S.venueFrictionPct = undefined;
  assert.ok(Number.isFinite(C.stockSizing(row).planNet), 'Ohne Einstellung muss der Rueckfallwert greifen');
  C.S.orderFeeEur = C.DEFAULTS.orderFeeEur; C.S.venueFrictionPct = C.DEFAULTS.venueFrictionPct;
  assert.ok(C.DEFAULTS.orderFeeEur >= 10, 'Der Standard muss die realen US-Direkthandelskosten abbilden, nicht den guenstigsten Fall');

  // -- Das Momentum-Gitter: messbar, fail-closed, und es laesst echte Mover durch.
  const grid = w.slice(w.indexOf('function momentumRadarAllowed(r,count=false,env=null){'), w.indexOf('function radarCandidateAllowed'));
  assert.ok(grid.length > 200 && grid.length < 3000, 'Der Gitter-Ausschnitt muss plausibel begrenzt sein');
  /* v3.32.0 · R11: die Umsatzschwelle heisst hier jetzt momMinDollarVol(env),
     weil sie am Massstab des benutzten Feeds prueft. Die Konstante bleibt die
     Grundlage — geprueft wird beides. */
  assert.ok(grid.includes('MOM_MIN_PRICE_USD') && grid.includes('momMinDollarVol(env)')
    && grid.includes('MOM_MAX_SPREAD_PCT') && grid.includes('MOM_MIN_MOVE_PCT'),
    'Das Gitter muss alle vier messbaren Kriterien pruefen');
  assert.match(w, /const MOM_MIN_DOLLARVOL\s*=\s*2_000_000;/,
    'Die IEX-Grundschwelle muss als benannte Konstante erhalten bleiben');
  // Nachbau der Gitterlogik gegen konkrete Faelle — so faellt der Test auf,
  // wenn jemand eine Schwelle aufweicht, ohne es zu merken.
  const th = (k)=>Number((new RegExp(k+"\\s*=\\s*([0-9_\\.]+)").exec(w)||[])[1]?.replace(/_/g,''));
  const pass = (r)=> r.last>=th('MOM_MIN_PRICE_USD') && r.volume>0
    && r.last*r.volume>=th('MOM_MIN_DOLLARVOL')
    && !(Number.isFinite(r.spreadPct) && r.spreadPct>th('MOM_MAX_SPREAD_PCT'))
    && Math.abs(r.movePct)>=th('MOM_MIN_MOVE_PCT');
  // Ein echter Nachrichten-Mover wie MRNA muss durchkommen — das war der Anlass.
  assert.equal(pass({last:42, volume:900_000, spreadPct:0.08, movePct:14.2}), true,
    'Ein liquider Nachrichten-Mover muss den Radar erreichen koennen');
  // Und die Ausschlussfaelle muessen greifen.
  assert.equal(pass({last:2.10, volume:50_000_000, spreadPct:0.1, movePct:30}), false, 'Penny Stocks bleiben draussen');
  assert.equal(pass({last:60, volume:8_000, spreadPct:0.1, movePct:12}), false, 'Zu duenner Umsatz bleibt draussen');
  assert.equal(pass({last:60, volume:500_000, spreadPct:2.5, movePct:12}), false, 'Zu breiter Spread bleibt draussen');
  assert.equal(pass({last:60, volume:500_000, spreadPct:0.1, movePct:0.4}), false, 'Ruhige Titel sind keine Mover');
  assert.equal(pass({last:NaN, volume:500_000, spreadPct:0.1, movePct:12}), false, 'Ohne Kurs: fail-closed');
  assert.equal(pass({last:60, volume:NaN, spreadPct:0.1, movePct:12}), false, 'Ohne Umsatz: fail-closed');

  // -- Eine leere Liste muss erklaerbar sein, sonst sieht sie aus wie ein Defekt.
  assert.match(w, /let radarGateStats=/, 'Das Einlassgitter muss zaehlen, woran Kandidaten scheitern');
  assert.match(w, /gate:\{\.\.\.radarGateStats\}/, 'Die Zaehler muessen an die Oberflaeche durchgereicht werden');
  assert.match(app, /class="gate-stats"/, 'Die Zaehler muessen sichtbar sein, nicht nur im JSON');
  assert.match(app, /ist die Schwelle zu streng/, 'Der Tooltip muss sagen, wie eine leere Liste zu deuten ist');
}

console.log('✓ FusionPulse v3.8.0 cost-model/momentum-grid regressions: OK');

// ---------------------------------------------------------------------------
// v3.8.2 · P6 Teil 1: Terminwarnung Quartalszahlen.
// ANLASS: Am 26.8. hat die App VEEV analysiert und bewertet, ohne zu erwaehnen,
// dass an diesem Abend Zahlen kamen. Das Urteil ueber den Intraday-Plan war
// richtig — aber eine Information fehlte, die eine andere Frage sichtbar
// gemacht haette. Diese Suite stellt sicher, dass die Warnung existiert UND
// dass sie eine Warnung bleibt statt zu einem Signal zu werden.
{
  const { loadClient } = await import('./client-harness.mjs');
  const C = loadClient();
  const w = fs.readFileSync(new URL('../src/worker.js', import.meta.url),'utf8');
  C.S.equity=5000; C.S.riskPct=0.75; C.S.claudeMode=true; C.mutedSetupSet=new Set();
  C.S.orderFeeEur=11.5; C.S.venueFrictionPct=0.15;
  C.stockMeta={ts:Date.now(),refreshedSymbols:['EVT'],market:{key:'regular'}};

  const nyToday = new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date());
  const plusDays = (n) => new Date(Date.parse(nyToday+'T12:00:00Z')+n*86_400_000).toISOString().slice(0,10);

  const row = { symbol:'EVT', name:'Event Inc.', sector:'Tech', light:'green', score:8.4,
    verdict:'Kauf-Setup · Claude', claude:{light:'green',score:8.4,verdict:'Kauf-Setup · Claude',expectancyR:0.4,blockers:[]},
    entryEur:25.00, stopEur:24.90, tp1Eur:26.00, tp2Eur:27.50, priceEur:25.00,
    entryUsd:29.25, stopUsd:29.13, tp1Usd:30.42, tp2Usd:32.18, priceUsd:29.25,
    netCRV:3.2, tp2Pct:10, setup:'Pullback', situationType:'PULLBACK',
    updated:new Date().toISOString().slice(0,19).replace('T',' '), marketPhase:'regular' };

  // Ohne Termin: unveraendertes Verhalten. Die Warnung darf nichts kaputtmachen.
  C.earnData = { state:'ok', auto:[], manual:[] };
  assert.equal(C.earningsWarning('EVT'), null, 'Ohne Termin darf keine Warnung erscheinen');
  assert.equal(C.stockHeadline(row).text, 'BUY', 'Ohne Termin bleibt ein echter BUY unveraendert');

  // Der VEEV-Fall: Zahlen heute nach Boersenschluss.
  C.earnData = { state:'ok', auto:[{symbol:'EVT', date:plusDays(0), time:'amc'}], manual:[] };
  const wArn = C.earningsWarning('EVT');
  assert.ok(wArn, 'Ein Termin heute muss eine Warnung erzeugen');
  assert.equal(wArn.critical, true, 'Zahlen heute sind kritisch');
  assert.match(wArn.when, /heute nach Börsenschluss/, 'Der Zeitpunkt muss im Klartext dastehen');
  const hl = C.stockHeadline(row);
  assert.equal(hl.kind, 'event', 'Die Kopfzeile muss den Termin als Grund fuehren');
  assert.notEqual(hl.light, 'green', 'Vor Zahlen darf die Kopf-Ampel nicht gruen bleiben');
  assert.doesNotMatch(hl.text, /^BUY/, 'Vor Zahlen darf kein BUY stehen');
  assert.match(hl.title, /ANDERE Entscheidung/, 'Der Unterschied zwischen Setup und Halten ueber die Zahlen muss benannt sein');
  assert.match(hl.title, /kein Signal/, 'Es muss dastehen, dass die Warnung kein Signal ist');
  assert.match(hl.title, /in beide Richtungen/, 'Die Warnung darf keine Richtung suggerieren');

  // Fail-closed: die Warnung darf NIE aufwerten.
  for (const lt of ['red','yellow']) {
    const h = C.stockHeadline({ ...row, light:lt, verdict:'Test · Claude' });
    assert.ok(C.HEADLINE_RANK[h.light] <= C.HEADLINE_RANK[lt], `Die Terminwarnung darf ${lt} nicht aufwerten`);
  }

  // Zeitfenster: weit entfernte oder vergangene Termine warnen nicht kritisch.
  C.earnData = { state:'ok', auto:[{symbol:'EVT', date:plusDays(6), time:'amc'}], manual:[] };
  assert.equal(C.earningsWarning('EVT').critical, false, 'Ein Termin in sechs Tagen ist nicht kritisch');
  assert.equal(C.stockHeadline(row).text, 'BUY', 'Ein ferner Termin darf die Freigabe nicht blockieren');
  C.earnData = { state:'ok', auto:[{symbol:'EVT', date:plusDays(-1), time:'amc'}], manual:[] };
  assert.equal(C.earningsWarning('EVT'), null, 'Vergangene Termine duerfen nicht mehr warnen');
  C.earnData = { state:'ok', auto:[{symbol:'EVT', date:plusDays(30), time:'amc'}], manual:[] };
  assert.equal(C.earningsWarning('EVT'), null, 'Termine weit in der Zukunft sind keine Warnung fuer heute');

  // Manuell eingetragene Termine haben Vorrang und funktionieren ohne Fremddienst.
  C.earnData = { state:'unavailable', error:'plan', auto:[], manual:[{symbol:'EVT', date:plusDays(0), time:'amc'}] };
  const man = C.earningsWarning('EVT');
  assert.ok(man && man.critical, 'Manuelle Termine muessen auch ohne automatischen Kalender wirken');
  assert.match(man.detail, /manuell eingetragen/, 'Die Quelle muss benannt sein');
  C.earnData = { state:'ok', auto:[{symbol:'EVT', date:plusDays(5), time:'amc'}], manual:[{symbol:'EVT', date:plusDays(0), time:'amc'}] };
  assert.equal(C.earningsWarning('EVT').days, 0, 'Der manuelle Termin muss den automatischen ueberschreiben');

  // Ein veralteter Kalenderstand muss als solcher erkennbar sein.
  C.earnData = { state:'stale', auto:[{symbol:'EVT', date:plusDays(0), time:'amc'}], manual:[] };
  assert.match(C.earningsWarning('EVT').detail, /veraltet/, 'Ein alter Kalenderstand muss gekennzeichnet werden');

  // -- Worker: ehrlicher Umgang mit einem moeglicherweise gesperrten Endpunkt.
  assert.match(w, /url\.pathname === '\/api\/earnings'/, 'Es braucht eine Termin-Route');
  assert.match(w, /Basic-Tarif nicht enthalten/, 'Ein gesperrter Endpunkt muss als solcher benannt werden, statt stumm leer zu bleiben');
  assert.match(w, /async function writeManualEarnings/, 'Manuelle Termine muessen speicherbar sein');
  assert.match(w, /state:auto\.length\?'stale':'unavailable'/, 'Ein Ausfall muss vom Zwischenspeicher unterschieden werden');
  // Der Parser darf nichts hineininterpretieren.
  assert.match(w, /if\(!\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(d\)\) return;/, 'Nur echte Datumsangaben duerfen uebernommen werden');
  // Und aus der Warnung darf kein Score werden (Invariante 3).
  for (const fn of ['stockLevel','stockOpportunity','stockTradeability','stockStrength']) {
    const i = [app.indexOf(`function ${fn}(`), app.indexOf(`const ${fn} = (`)].filter(x=>x>=0).sort((a,b)=>a-b)[0];
    assert.doesNotMatch(app.slice(i, i+3000), /earnData|earningsFor|earningsWarning/,
      `${fn} darf den Terminkalender nicht auswerten — die Warnung ist Anzeige, kein Gate`);
  }
}

console.log('✓ FusionPulse v3.8.2 earnings-event-warning regressions: OK');

// ===========================================================================
// v3.9.0 · Fixbetrags-Sizing + Modus A (Momentum)
// Eigene Fixtures, bewusst NICHT aus den Suiten oben nachgenutzt. Zu jedem
// Funktionsnachweis gehoert hier eine Negativkontrolle: die Bedingung wird
// kuenstlich verletzt, und der Test MUSS dann kippen. Ein Test, der den Fehler
// nicht sehen kann, ist kein Nachweis (Lehre aus dem tautologischen Test v3.6.4).
// ===========================================================================
{
  const { loadClient } = await import('./client-harness.mjs');
  const C = loadClient();
  const S = C.S;

  // --- Fixture: Einstieg 100 EUR, Stop 98 EUR (2 % entfernt), TP2 104 EUR (4 % = 2x Stop).
  //     Bewusst runde Zahlen, damit jede Abweichung von Hand nachrechenbar ist.
  const mk = (over={}) => ({
    symbol:'TSTA', entryUsd:100, entryEur:100, stopUsd:98, stopEur:98,
    tp1Usd:102, tp1Eur:102, tp2Usd:104, tp2Eur:104, tp2Pct:4, netCRV:3.0,
    light:'green', score:8, verdict:'x', tp2Source:'y', blockers:[], ...over,
  });

  // ---------------------------------------------------------------- Sizing
  S.sizeMode='risk'; S.equity=5000; S.riskPct=0.75; S.maxTradeEur=10000;
  const szRisk = C.stockSizing(mk());
  // 37,50 EUR Risiko / 2 EUR je Stueck = 18,75 Stueck = 1.875 EUR Kaufsumme.
  assert.ok(Math.abs(szRisk.notional-1875)<0.01, `Risikomodus: 1.875 EUR erwartet, war ${szRisk.notional}`);
  assert.equal(szRisk.sizeBasis,'risk','Der Modus muss im Ergebnis benannt sein');

  // Der Deckel muss im Risikomodus greifen: bei 0,1 % Stopabstand waeren es 37.500 EUR.
  const szTight = C.stockSizing(mk({stopEur:99.9, stopUsd:99.9}));
  assert.ok(Math.abs(szTight.notional-10000)<0.01,
    `Enger Stop muss auf maxTradeEur gedeckelt werden, war ${szTight.notional}`);

  S.sizeMode='fixed'; S.fixedTradeEur=10000;
  const szFix = C.stockSizing(mk());
  assert.ok(Math.abs(szFix.notional-10000)<0.01, `Fixmodus: 10.000 EUR erwartet, war ${szFix.notional}`);
  assert.equal(szFix.sizeBasis,'fixed','Der Fixmodus muss im Ergebnis benannt sein');
  // NEGATIVKONTROLLE: der Deckel maxTradeEur darf im Fixmodus NICHT mehr wirken.
  S.maxTradeEur=500;
  assert.ok(Math.abs(C.stockSizing(mk()).notional-10000)<0.01,
    'Im Fixmodus darf maxTradeEur die Kaufsumme nicht mehr beschneiden');
  S.maxTradeEur=10000;

  // Das Risiko ist im Fixmodus das ERGEBNIS: 2 % von 10.000 = 200 EUR Kursverlust.
  assert.ok(Math.abs(szFix.risk-200)<0.01, `Kursverlust 200 EUR erwartet, war ${szFix.risk}`);
  // Plus Kosten: 2 Orders a 11,50 + 0,15 % von 10.000 = 23 + 15 = 38 EUR -> 238 EUR.
  S.orderFeeEur=11.50; S.venueFrictionPct=0.15;
  const szCost = C.stockSizing(mk());
  assert.ok(Math.abs(szCost.stopLossAfterCosts-238)<0.5,
    `Worst Case 238 EUR erwartet, war ${szCost.stopLossAfterCosts}`);
  assert.ok(Math.abs(szCost.stopDistancePct-2)<0.01,'Stop-Distanz muss 2 % sein');
  assert.ok(Math.abs(szCost.rewardRiskRaw-2)<0.01,'Ziel:Stop muss 2,0x sein');

  // Liquiditaetsdeckel muss auch im Fixmodus greifen (fail-closed).
  const szLiq = C.stockSizing(mk({buyCapacityEur:3000}));
  assert.ok(Math.abs(szLiq.notional-3000)<0.01,'Marktliquiditaet muss den festen Einsatz begrenzen');
  assert.equal(szLiq.liquidityCapped,true,'Die Kuerzung muss ausgewiesen werden');

  // ------------------------------------------------- Gate: Ziel : Stop >= 2x
  C.stockMeta = { market:{key:'regular'} };
  S.claudeMode=false; S.minTp2PctStock=2.0; S.minCrvStock=3.0; S.maxLossEur=0; S.taxPct=27.5;
  const trOk = C.stockTradeability(mk());
  assert.equal(trOk.fixedSize,true,'Der Fixmodus muss im Gate sichtbar sein');
  assert.ok(Math.abs(trOk.rewardRisk-2)<0.01,'Ziel:Stop 2,0x erwartet');
  assert.equal(trOk.rewardRiskOk,true,'Genau 2,0x muss die Schwelle erfuellen');

  // NEGATIVKONTROLLE: Ziel auf +3 % (= 1,5x Stop) -> Freigabe MUSS entfallen.
  const trBad = C.stockTradeability(mk({tp2Eur:103, tp2Usd:103, tp2Pct:3}));
  assert.equal(trBad.rewardRiskOk,false,'1,5x darf die Schwelle NICHT erfuellen');
  assert.equal(trBad.ok,false,'Ein Setup unter 2,0x darf im Fixmodus keine Freigabe bekommen');
  // Gegenprobe, dass wirklich DIESE Bedingung kippt und nicht eine andere:
  assert.equal(trBad.marketOk,true,'Die Marktphase war nicht der Grund');
  assert.ok(trBad.netCrv>=trBad.minCrv,'Das CRV war nicht der Grund');

  // Der Mindest-Eurogewinn darf im Fixmodus NICHT mehr als Huerde wirken —
  // er misst dort nur noch die Zielweite ein zweites Mal.
  S.minNetProfitStock=99999;
  assert.equal(C.stockTradeability(mk()).ok,true,
    'Im Fixmodus darf der Mindest-Eurogewinn nicht mehr blockieren');
  // NEGATIVKONTROLLE: im Risikomodus MUSS er weiter blockieren.
  S.sizeMode='risk';
  assert.equal(C.stockTradeability(mk()).ok,false,
    'Im Risikomodus muss der Mindest-Eurogewinn weiterhin scharf sein');
  S.sizeMode='fixed'; S.minNetProfitStock=30;

  // ------------------------------------------------- Gate: maximaler Verlust
  S.maxLossEur=400;
  assert.equal(C.stockTradeability(mk()).lossOk,true,'238 EUR liegen unter der 400-EUR-Grenze');
  // Stop auf 94 EUR = 6 % -> 600 EUR Kursverlust + Kosten -> ueber der Grenze.
  const trLoss = C.stockTradeability(mk({stopEur:94, stopUsd:94, tp2Eur:112, tp2Usd:112, tp2Pct:12}));
  assert.equal(trLoss.lossOk,false,'Ein Verlust ueber der Grenze muss die Freigabe entziehen');
  assert.equal(trLoss.ok,false,'Die Verlustgrenze muss auf das Gesamturteil durchschlagen');
  // Und sie darf ausschliesslich ABWERTEN: abgeschaltet ist dasselbe Setup wieder frei.
  S.maxLossEur=0;
  assert.equal(C.stockTradeability(mk({stopEur:94, stopUsd:94, tp2Eur:112, tp2Usd:112, tp2Pct:12})).ok,true,
    'Ohne Grenze darf dasselbe Setup nicht blockiert sein — die Sperre darf nur abwerten');
  S.maxLossEur=400;

  // --------------------------------------------------------- Modus-A-Overlay
  S.tradeMode='off';
  const row = mk({ momentum:{ light:'green', score:9.1, verdict:'Kauf-Setup · Momentum',
    entryUsd:200, entryEur:200, stopUsd:190, stopEur:190, tp1Usd:220, tp1Eur:220,
    tp2Usd:240, tp2Eur:240, tp2Pct:20, tp2Source:'Tagesspanne x 1,0', blockers:[] } });
  C.momentumOverlayRow(row);
  assert.equal(row.entryEur,100,'Bei ausgeschaltetem Modus A darf nichts ueberschrieben werden');
  assert.equal(row.momentumActive,false,'Der Zustand muss ausgewiesen sein');

  S.tradeMode='A';
  C.momentumOverlayRow(row);
  assert.equal(row.entryEur,200,'Modus A muss den Einstieg ersetzen');
  assert.equal(row.stopEur,190,'Modus A muss den Stop ersetzen');
  assert.equal(row.tp2Eur,240,'Modus A muss das Ziel ersetzen');
  assert.equal(row.momentumActive,true,'Der Zustand muss ausgewiesen sein');

  // Idempotenz und Reversibilitaet: zurueckschalten stellt das Original her.
  C.momentumOverlayRow(row); C.momentumOverlayRow(row);
  assert.equal(row.entryEur,200,'Mehrfaches Anwenden darf nichts veraendern');
  S.tradeMode='off'; C.momentumOverlayRow(row);
  assert.equal(row.entryEur,100,'Zurueckschalten muss die Originalwerte wiederherstellen');
  assert.equal(row.stopEur,98,'Auch der Stop muss zurueckkommen');

  // Eine Zeile aus einem alten Cache ohne momentum-Block bleibt unveraendert.
  S.tradeMode='A';
  const legacyRow = mk();
  C.momentumOverlayRow(legacyRow);
  assert.equal(legacyRow.entryEur,100,'Ohne Momentum-Block darf Modus A nichts erfinden');
  assert.equal(legacyRow.momentumActive,false,'Fail-closed: kein Block = kein Modus A');
  S.tradeMode='off';

  // ------------------------------------------------------------- Glossar
  for (const k of ['sizeModeRisk','sizeModeFixed','stopDistance','rewardRisk','maxLoss','tradeModeA','quoteAge','consolidation']) {
    assert.ok(C.GLOSS[k] && C.GLOSS[k].length>80, `GLOSS-Eintrag fehlt oder ist zu duenn: ${k}`);
    assert.ok(C.GLOSS_LABEL[k], `GLOSS_LABEL fehlt: ${k}`);
    assert.ok(C.GLOSS_GROUPS.some(g=>g.keys.includes(k)), `${k} taucht im sichtbaren Glossar nicht auf`);
  }
}

{
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url),'utf8');
  const w   = fs.readFileSync(new URL('../src/worker.js', import.meta.url),'utf8');
  const idx = fs.readFileSync(new URL('../public/index.html', import.meta.url),'utf8');

  // -- Der Momentum-Block muss additiv sein: claude und fusion duerfen ihn nie lesen.
  //    Sonst waere aus einer Anzeigeschicht eine Bewertungsschicht geworden (Invariante 3).
  // Achtung: 'const claude = (() => {' kommt ZWEIMAL vor — einmal im Krypto-Zweig
  // (Zeile ~543) und einmal im Aktien-Zweig. Beim ersten Entwurf traf der Marker
  // den Krypto-Block, und die Blockgrenze umspannte dann halb den Worker; der Test
  // fiel aus dem falschen Grund. lastIndexOf trifft den Aktien-Block.
  const claudeBlk = w.slice(w.lastIndexOf('const claude = (() => {'), w.indexOf('const fusion = (() => {'));
  // Die Grenze muss VOR dem Kommentarkopf des Momentum-Blocks liegen — der Kopf
  // erklaert den neuen Modus und enthaelt das Wort natuerlich, ohne dass fusion
  // ihn auswertet. Zweiter Fehlalarm beim Bau, ebenfalls hier festgehalten.
  const fusionBlk = w.slice(w.indexOf('const fusion = (() => {'), w.indexOf('// ---- v3.9.0 MODUS A'));
  for (const [name, blk] of [['claude',claudeBlk],['fusion',fusionBlk]]) {
    assert.ok(blk.length>500, `${name}-Block nicht gefunden — Marker geprueft?`);
    assert.doesNotMatch(blk,/momentum/i, `Der ${name}-Block darf den Momentum-Block nicht auswerten`);
  }

  // -- Modus A: kein Ueberdehnungs-Malus, kein Elliott.
  const momBlk = w.slice(w.indexOf('const momentum = (() => {'), w.indexOf('return {\n    claude, fusion, momentum,'));
  assert.ok(momBlk.length>1000,'Momentum-Block nicht gefunden');
  assert.doesNotMatch(momBlk,/overextended\s*\?/, 'Modus A darf keinen Ueberdehnungs-Malus anwenden');
  assert.doesNotMatch(momBlk,/stockElliott|ellRetr|ellFibDist/, 'Modus A darf Elliott nicht verwenden');
  assert.doesNotMatch(momBlk,/\b8\s*\*\s*risk\b|\b6\s*\*\s*risk\b/, 'Modus A darf keinen R-Deckel auf das Ziel setzen');
  // Live-Quote-Pflicht muss wirklich blockieren, nicht nur gemessen werden.
  assert.match(momBlk,/quoteFresh/, 'Modus A braucht eine Frischepruefung');
  assert.match(momBlk,/const mGreen = [^;]*quoteFresh/, 'Ein alter Kurs muss die Freigabe verhindern, nicht nur angezeigt werden');
  assert.match(momBlk,/consolidating[\s\S]{0,200}mGreen|const mGreen = [^;]*consolidating/, 'Ohne Konsolidierung darf es keine Freigabe geben');

  // -- Die Elliott-Gewichte duerfen NICHT umverteilt worden sein: das haette den
  //    Score ohne neue Information angehoben. Summe der Gewichte muss unter 1 liegen.
  const weights = [...momBlk.matchAll(/,\s*(0\.\d+)\],/g)].map(m=>Number(m[1]));
  const sum = weights.reduce((a,b)=>a+b,0);
  assert.ok(weights.length>=6, `Zu wenige Gewichte gefunden (${weights.length})`);
  assert.ok(sum>0.95 && sum<1.001, `Gewichtssumme ${sum.toFixed(3)} — Elliott wurde offenbar umverteilt statt ausgelassen`);

  // -- Der neue Schalter muss standardmaessig AUS sein (Invariante 9).
  assert.match(app,/sizeMode:\s*'risk'/, 'Das Sizing-Modell muss per Default unveraendert bleiben');
  assert.match(app,/tradeMode:\s*'off'/, 'Der Handelsmodus muss per Default aus sein');

  // -- Ungueltige gespeicherte Werte duerfen nicht in einen undefinierten Zustand fuehren.
  assert.match(app,/\(smRaw === 'fixed' \|\| smRaw === 'risk'\) \? smRaw : DEFAULTS\.sizeMode/, 'Unbekanntes Sizing-Modell muss auf den Default zurueckfallen');
  assert.match(app,/\(tmRaw === 'A' \|\| tmRaw === 'off'\) \? tmRaw : DEFAULTS\.tradeMode/, 'Unbekannter Handelsmodus muss auf den Default zurueckfallen');

  // -- Die Bedienelemente muessen existieren, sonst ist die Einstellung unerreichbar.
  for (const id of ['sTradeMode','sSizeMode','sFixedTrade','sMaxLoss','sRiskModeHint']) {
    assert.ok(idx.includes(`id="${id}"`), `Bedienelement fehlt in der Oberflaeche: ${id}`);
  }

  // -- Modus A ist ein Regelwerk, keine Anzeige: der Overlay muss auch beim
  //    normalen Rendern laufen, nicht nur beim Speichern der Einstellungen.
  const rs = app.slice(app.indexOf('function renderStocks() {'), app.indexOf('function renderStocks() {')+400);
  assert.match(rs,/momentumOverlayRow/, 'renderStocks muss den Modus-A-Overlay anwenden');

  // -- Der Momentum-Overlay darf NICHT im SHA-verriegelten Bereich stehen.
  //    (Genau dieser Fehler ist beim Bau von 3.9.0 passiert und wurde gefangen.)
  const lockedOverlay = app.slice(app.indexOf('/* ---- Claude-Modus-Overlay'), app.indexOf('function buyReady'));
  assert.doesNotMatch(lockedOverlay,/momentumOverlayRow|MOMENTUM_VIEW_FIELDS/,
    'Der Modus-A-Code darf nicht im verriegelten Claude-Overlay-Bereich liegen');
}

console.log('✓ FusionPulse v3.9.0 fixed-size/mode-A regressions: OK');

/* ====================================================================
   v3.9.1 · Bedienbarkeit (Wächter-Schalter), Anzeigereihenfolge und
   flatex-Handelbarkeit. Alle drei Punkte sind ANZEIGE — kein Test darf
   hier eine Score- oder BUY-Wirkung durchgehen lassen.
   ==================================================================== */
{
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const idx = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

  // -- P-UI1: Die Aktions-Spalte war real unerreichbar (Overlay-Scrollbalken
  //    unter macOS). Drei unabhaengige Massnahmen, alle drei werden geprueft.
  assert.match(app, /<th class="attr-action"/, 'Aktions-Spaltenkopf muss als attr-action markiert sein');
  assert.match(app, /<td class="attr-action" data-lbl="Aktion">/, 'Aktions-Zelle muss als attr-action markiert sein');
  assert.match(css, /\.attr-table th\.attr-action,\.attr-table td\.attr-action\{position:sticky;right:0/,
    'Die Aktions-Spalte muss rechts kleben, sonst scrollt der Schalter wieder aus dem Bild');
  assert.match(css, /\.attr-wrap::-webkit-scrollbar\{height:9px\}/,
    'Der horizontale Scrollbalken muss sichtbar erzwungen werden');
  assert.match(css, /@media\(max-width:900px\)\{[\s\S]*\.attr-table thead\{position:absolute/,
    'Unter 900 px muss die Tabelle in Karten umbrechen');

  // -- Negativkontrolle: In der Kartenansicht ist der Tabellenkopf versteckt.
  //    Ohne data-lbl an JEDER Zelle waeren die Werte dort unbeschriftet.
  for (const lbl of ['Setup','n','In-Sample','Out-of-Sample','Wächter','Aktion']) {
    assert.ok(app.includes(`data-lbl="${lbl}"`), `Kartenansicht ohne Beschriftung fuer Spalte: ${lbl}`);
  }

  // -- P-UI2: Fokusfenster + Heatmap stehen VOR den Nebenkacheln. Gemessen an
  //    der tatsaechlichen Position im Markup, nicht an einem Kommentar.
  const pos = (needle) => { const i = idx.indexOf(needle); assert.ok(i >= 0, `fehlt: ${needle}`); return i; };
  assert.ok(pos('<div class="stockstage">') < pos('id="depotStrip"'),
    'Aktien: Fokus/Heatmap muss vor dem Depot-Streifen stehen');
  assert.ok(pos('<div class="stockstage">') < pos('id="attributionReport"'),
    'Aktien: Fokus/Heatmap muss vor der Selbstauswertung stehen');
  assert.ok(pos('<div class="stockstage">') < pos('id="aladdinCard"'),
    'Aktien: Fokus/Heatmap muss vor der Aladdin-Kachel stehen');
  assert.ok(pos('<div class="stage" data-domain="coin">') < pos('id="sentimentCard"'),
    'Krypto: Fokus/Heatmap muss vor der Stimmungskachel stehen');
  assert.ok(pos('<div class="stockstage">') < pos('id="stockGroups"'),
    'Aktien: Fokus/Heatmap muss vor der Gruppenliste stehen');

  // -- P-UI3: flatex-Handelbarkeit ist AUSSCHLIESSLICH Anzeige.
  assert.match(app, /function flatexTradability\(row\)\{/, 'Handelbarkeits-Hinweis muss existieren');
  assert.match(app, /class="flatex-hint ft-\$\{ft\.tone\}"/, 'Der Hinweis muss im Fokusfenster gerendert werden');

  // Fail-closed: leerer und unbekannter Handelsplatz duerfen NIE 'ok' ergeben.
  const fnSrc = app.slice(app.indexOf('const FLATEX_LIKELY_EXCHANGE'), app.indexOf('function googleFinanceUrl'));
  const flatex = new Function(fnSrc + '; return flatexTradability;')();
  assert.equal(flatex({exchange:''}).tone, 'unknown', 'Fehlender Handelsplatz darf keine positive Aussage erzeugen');
  assert.equal(flatex({}).tone, 'unknown', 'Fehlendes Feld darf keine positive Aussage erzeugen');
  assert.equal(flatex({exchange:'XYZ-UNBEKANNT'}).tone, 'unknown', 'Unbekannter Handelsplatz darf keine positive Aussage erzeugen');
  assert.equal(flatex({exchange:'OTC'}).tone, 'no', 'OTC muss als eher nicht handelbar gekennzeichnet werden');
  assert.equal(flatex({exchange:'PINK'}).tone, 'no', 'Pink Sheets muessen als eher nicht handelbar gekennzeichnet werden');
  assert.equal(flatex({exchange:'NASDAQ'}).tone, 'ok', 'NASDAQ muss als wahrscheinlich handelbar gelten');
  assert.equal(flatex({exchange:'NYSE'}).tone, 'ok', 'NYSE muss als wahrscheinlich handelbar gelten');
  // Jede Variante muss den Nicht-Eingriff ausdruecklich benennen (Ehrlichkeitsprinzip).
  for (const ex of ['', 'OTC', 'NASDAQ', 'XYZ-UNBEKANNT']) {
    assert.match(flatex({exchange:ex}).detail, /veraendert weder Score noch Kauf-Freigabe/,
      `Hinweistext muss den Nicht-Eingriff benennen: ${ex || '(leer)'}`);
  }

  // -- Der Hinweis darf in KEINER Bewertungs- oder Freigabefunktion auftauchen.
  const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  assert.doesNotMatch(worker, /flatexTradability/, 'Der Handelbarkeits-Hinweis darf serverseitig nichts bewerten');
  const buyReadyBlock = app.slice(app.indexOf('function buyReady'), app.indexOf('function buyReady') + 1600);
  assert.doesNotMatch(buyReadyBlock, /flatexTradability|flatex-hint/,
    'Der Handelbarkeits-Hinweis darf die Kauf-Freigabe nicht beeinflussen');

  // -- Invariante 8: sichtbares Glossar.
  assert.match(app, /brokerAvail:'Handelbarkeit bei flatex/, 'GLOSS-Eintrag fehlt');
  assert.match(app, /keys:\['brokerAvail'\]/, 'GLOSS-Eintrag muss im sichtbaren Glossar auftauchen');
}

console.log('✓ FusionPulse v3.9.1 ui-reachability/order/broker-availability regressions: OK');

/* ====================================================================
   v3.9.2 · Navigation, Kachel-Reihenfolge, Kachel-Trennschaerfe,
   Handelbarkeit in Liste/Detail, Krypto-Mover. Alles ANZEIGE.
   ==================================================================== */
{
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const idx = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
  const pos = (n) => { const i = idx.indexOf(n); assert.ok(i >= 0, `fehlt: ${n}`); return i; };

  // -- Reiter. In v3.12.0 auf zwei Ebenen umgebaut: die Hauptbereiche stehen im
  //    Markup, die Rubriken darunter kommen aus VIEW_SECTIONS in app.js.
  //    Die Absicht des urspruenglichen Tests bleibt: „Coins" muss es geben, das
  //    irrefuehrende „Radar" nicht, und kein Sprungziel darf ins Leere fuehren.
  const nav = idx.slice(idx.indexOf('<nav class="viewbar"'), idx.indexOf('</nav>', idx.indexOf('<nav class="viewbar"')));
  assert.match(nav, />Coins</, 'Bereich „Coins" muss existieren');
  assert.match(nav, />Aktien</, 'Bereich „Aktien" muss existieren');
  assert.doesNotMatch(nav, />Radar</, 'Der irrefuehrende Reiter „Radar" darf nicht zurueckkehren');
  assert.ok(idx.includes('id="viewSub"'), 'Die Rubrikenzeile braucht einen Platz im Markup');

  // Jedes Sprungziel aus VIEW_SECTIONS muss im Markup wirklich existieren.
  // Ein Reiter, der ins Leere fuehrt, tut beim Klick nichts — das faellt
  // niemandem auf und ist genau die Sorte Fehler, die lange ueberlebt.
  {
    const block = app.slice(app.indexOf('const VIEW_SECTIONS'), app.indexOf('let activeView'));
    assert.ok(block.length > 200, 'VIEW_SECTIONS muss gefunden werden — leerer Slice waere ein blinder Test');
    const sels = [...block.matchAll(/\['([^']+)',\s*'([^']+)'/g)].map(m => m[1]);
    assert.ok(sels.length >= 12, `Es muessen alle Rubriken verdrahtet sein, gefunden: ${sels.length}`);
    for (const t of sels) {
      const exists = t.startsWith('#') ? idx.includes(`id="${t.slice(1)}"`)
                   : t.startsWith('.') ? idx.includes(`class="${t.slice(1)}"`)
                   : idx.includes(`<${t}`);
      assert.ok(exists, `Sprungziel existiert nicht im Markup: ${t}`);
    }
    // Die drei Bereiche im Markup muessen zu den Schluesseln in app.js passen.
    for (const v of ['coins', 'stocks', 'lab']) {
      assert.ok(block.includes(`${v}:`), `VIEW_SECTIONS fehlt der Bereich ${v}`);
      assert.ok(nav.includes(`data-view="${v}"`), `Im Markup fehlt der Bereich ${v}`);
    }
  }

  // -- Discovery-Kacheln stehen vor Depot/Portfolio/Learning, aber hinter Fokus/Heatmap.
  assert.ok(pos('<div class="stockstage">') < pos('id="marketGainers"'),
    'Fokus/Heatmap muss vor den Discovery-Kacheln stehen');
  assert.ok(pos('id="marketGainers"') < pos('id="depotStrip"'),
    'Discovery-Kacheln muessen vor dem Depot-Streifen stehen');
  assert.ok(pos('id="openingPanel"') < pos('id="portfolioRisk"'),
    'Premarket-Kachel muss vor dem Portfolio-Risiko stehen');
  assert.ok(pos('id="extendedWatch"') < pos('id="attributionReport"'),
    'Nachboerse-Kachel muss vor der Selbstauswertung stehen');

  // -- Trennschaerfe: Premarket und Momentum-Mover duerfen nicht mehr gleich heissen.
  //    Genau diese Verwechslung war die Rueckfrage des Nutzers.
  assert.match(app, /🚀 Premarket \/ Opening/, 'Die Alpaca-Kachel muss als Premarket benannt sein');
  assert.match(app, /📡 Momentum-Mover · Situation Radar/, 'Die Tiingo-Kachel muss als Momentum-Mover benannt sein');
  assert.match(app, /🌙 Nachboerse \/ Extended Hours|🌙 Nachbörse \/ Extended Hours/, 'Die Nachboerse-Kachel muss eindeutig benannt sein');
  assert.doesNotMatch(app, /<b>🚀 Opening Momentum<\/b>/, 'Der mehrdeutige alte Titel darf nicht zurueckkehren');
  assert.doesNotMatch(app, /<b>📡 Situation Radar<\/b>/, 'Der mehrdeutige alte Titel darf nicht zurueckkehren');

  // -- flatex-Hinweis jetzt auch in Trefferliste und Detailfenster.
  assert.match(app, /class="flatex-dot ft-\$\{ft\.tone\}"/, 'Trefferliste braucht das Handelbarkeits-Symbol');
  const peek = app.slice(app.indexOf('function stockPeek(r) {'), app.indexOf('function stockPeek(r) {') + 1200);
  assert.match(peek, /flatexTradability/, 'Detailfenster braucht den Handelbarkeits-Hinweis');
  assert.match(css, /\.flatex-dot\{/, 'Das Symbol in der Trefferliste braucht eine Formatierung');
  // Unveraendert: reine Anzeige, kein Eingriff.
  const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  assert.doesNotMatch(worker, /flatexTradability/, 'Der Hinweis darf serverseitig nichts bewerten');

  // -- Krypto-Mover: darf AUSSCHLIESSLICH gemessene Felder verwenden.
  //    Ein erfundenes 24-h-Feld waere hier der naheliegende Fehler gewesen.
  assert.match(app, /function renderCryptoMovers\(\)\{/, 'Krypto-Mover-Kachel muss existieren');
  assert.ok(idx.includes('id="cryptoMovers"'), 'Krypto-Mover braucht einen Platz im Markup');
  const cm = app.slice(app.indexOf('function renderCryptoMovers()'), app.indexOf('function render() {'));
  assert.match(cm, /r\.ret60/, 'Krypto-Mover muss die gemessene 60-Minuten-Bewegung verwenden');
  assert.doesNotMatch(cm, /change24|chg24|pct24|24hChange/,
    'Krypto-Mover darf keine 24-Stunden-Zahl verwenden — der Datensatz enthaelt keine');
  assert.match(cm, /Number\.isFinite\(Number\(r\.ret60\)\)/,
    'Fail-closed: Coins ohne belastbare Bewegung duerfen nicht in die Kachel');
  assert.match(cm, /kein Premarket-Aequivalent|kein Premarket-Äquivalent/,
    'Die Kachel muss ausdruecklich sagen, dass es bei Krypto kein Premarket gibt');
  assert.match(app, /renderCryptoMovers\(\);/, 'Die Kachel muss im Renderlauf aufgerufen werden');

  // -- Erreichbarkeit: alle horizontalen Scrollbereiche mit Bedienelementen abgesichert.
  assert.match(css, /\.signal-banner::-webkit-scrollbar,\.signal-content::-webkit-scrollbar\{height:7px\}/,
    'Die Signalleiste scrollt horizontal und enthaelt Chips — der Balken muss sichtbar sein');
  assert.match(app, /class="rowmute" data-mutestock="\$\{esc\(r\.symbol\)\}" title=/,
    'Der Stummschalt-Knopf in der Aktienzeile braucht eine Beschriftung');
}

console.log('✓ FusionPulse v3.9.2 navigation/tile-order/tile-clarity regressions: OK');

/* ====================================================================
   v3.9.3 · Heatmap-Spuren. Zwei Befunde des Nutzers:
   „Der grüne Strich zeigt mir nicht die Aktie, die nach oben gezogen ist."
   ==================================================================== */
{
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

  // -- Befund 1: Nicht messbare Werte dürfen NICHT als gemessene Null gespeichert
  //    werden. Sonst landet der Punkt in der linken unteren Ecke und erzeugt beim
  //    nächsten Scan eine Phantomspur quer durch das Feld.
  const stockAppend = app.slice(app.indexOf('appendHistory(stockHistoryStore'), app.indexOf("appendHistory(stockHistoryStore") + 1600);
  assert.match(stockAppend, /executability: Number\.isFinite\(Number\(r\.executability\)\) \? Number\(r\.executability\) : null/,
    'Fehlende Ausfuehrbarkeit muss als null gespeichert werden, nicht als 0');
  assert.doesNotMatch(stockAppend, /Number\(r\.executability\) : 0/,
    'Die alte Null-Ersetzung darf nicht zurueckkehren');
  const coinAppend = app.slice(app.indexOf('appendHistory(coinHistoryStore'), app.indexOf('appendHistory(coinHistoryStore') + 400);
  assert.doesNotMatch(coinAppend, /quality: Number\(r\.quality \|\| 0\)|executability: Number\(r\.executability \|\| 0\)/,
    'Auch im Krypto-Zweig darf ein fehlender Wert nicht als 0 gespeichert werden');

  // -- Beide Spur-Funktionen müssen nicht messbare Punkte überspringen.
  for (const [name, fn] of [
    ['Aktien-Heatmap', app.slice(app.indexOf('const focusSym=String(focusStock'), app.indexOf('svg.innerHTML=`<rect class="stockbg"'))],
    ['Krypto-Heatmap', app.slice(app.indexOf('const trails = pts.map(({r,x,y}) => {', app.indexOf('function renderMap()')), app.indexOf('${trails}${dots}'))],
  ]) {
    assert.match(fn, /Number\.isFinite\(Number\(p\.executability\)\)\s*&&\s*Number\.isFinite\(Number\(p\.quality\)\)/,
      `${name}: Punkte ohne messbaren Wert muessen uebersprungen werden`);
    /* Der Versatz muss GERECHNET werden. Eine Pruefung auf „const ox= existiert"
       waere blind gewesen: `const ox=0` haette sie bestanden. Die Negativkontrolle
       hat genau das aufgedeckt. Deshalb wird der echte Ausdruck aus dem Code
       herausgeloest und mit bekannten Werten AUSGEFUEHRT. */
    const m = fn.match(/const ox=(.+?), oy=(.+?);/);
    assert.ok(m, `${name}: Der Versatz-Ausdruck fehlt`);
    const offset = new Function('x', 'y', 'last', `return [${m[1]}, ${m[2]}];`);
    const [ox, oy] = offset(120, 60, { x: 100, y: 90 });
    assert.equal(ox, 20, `${name}: Der x-Versatz muss aus Punkt minus Rohkoordinate folgen, war ${ox}`);
    assert.equal(oy, -30, `${name}: Der y-Versatz muss aus Punkt minus Rohkoordinate folgen, war ${oy}`);
    // Und er muss verschwinden, wenn es nichts zu verschieben gibt.
    const [zx, zy] = offset(100, 90, { x: 100, y: 90 });
    assert.equal(zx, 0, `${name}: Ohne Kollision darf kein Versatz entstehen`);
    assert.equal(zy, 0, `${name}: Ohne Kollision darf kein Versatz entstehen`);
  }

  // -- Befund 2 (der eigentliche): Die Spur muss AN IHREM Punkt enden.
  //    Rechnerische Gegenkontrolle auf einem unabhaengigen Pfad — die Geometrie wird
  //    hier nachgebaut, NICHT aus der zu pruefenden Funktion uebernommen.
  {
    const g = (v) => 14 + (Math.max(0, Math.min(10, v)) / 10) * 172;
    // Zwei Titel auf praktisch derselben Position -> die Kollisionsaufloesung MUSS
    // sie auseinanderschieben. Genau dann divergieren Spur und Punkt im alten Code.
    const mk = (score, exec) => ({ x: g(exec), y: 200 - g(score), rad: 5 + Math.max(0, (score - 5) * 0.7) });
    const pts = [mk(8.6, 8.4), mk(8.5, 8.5)];
    const before = pts.map(p => ({ x: p.x, y: p.y }));
    for (let it = 0; it < 15; it++) for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i], b = pts[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || .1, m = a.rad + b.rad + 3;
      if (d < m) { const q = (m - d) * .16, ux = dx / d, uy = dy / d; a.x -= ux * q; a.y -= uy * q; b.x += ux * q; b.y += uy * q; }
    }
    const shift = Math.hypot(pts[0].x - before[0].x, pts[0].y - before[0].y);
    assert.ok(shift > 3, `Fixture taugt nicht: die Kollisionsaufloesung verschiebt nur ${shift.toFixed(1)} px`);

    // ALTES Verhalten: Spurende = Rohkoordinate. Abstand zum Punkt = der Versatz.
    const oldEnd = { x: before[0].x, y: before[0].y };
    const oldGap = Math.hypot(oldEnd.x - Math.max(10, Math.min(190, pts[0].x)), oldEnd.y - Math.max(10, Math.min(190, pts[0].y)));
    assert.ok(oldGap > 3, 'Gegenprobe: der alte Weg muss eine sichtbare Luecke erzeugen');

    // NEUES Verhalten: Spur um (Punkt - Rohkoordinate) verschieben -> Luecke = 0.
    const px = Math.max(10, Math.min(190, pts[0].x)), py = Math.max(10, Math.min(190, pts[0].y));
    const ox = px - before[0].x, oy = py - before[0].y;
    const newEnd = { x: before[0].x + ox, y: before[0].y + oy };
    const newGap = Math.hypot(newEnd.x - px, newEnd.y - py);
    assert.ok(newGap < 0.001, `Die Spur muss exakt am Punkt enden, Abstand war ${newGap.toFixed(3)}`);
  }

  // -- Die Aufwaertsspur muss den Titel BENENNEN. Ein Tooltip allein ist in einem
  //    dichten Punktfeld nicht treffbar — das war die Rueckmeldung.
  const stockTrail = app.slice(app.indexOf('const focusSym=String(focusStock'), app.indexOf('svg.innerHTML=`<rect class="stockbg"'));
  /* v3.12.0: Die Pruefung galt urspruenglich nur der Aufwaertsspur — das war die
     halbe Loesung und genau der gemeldete Fehler. Jetzt muss JEDE bewegte Spur
     Kuerzel und Richtung tragen. */
  assert.match(stockTrail, /class="trailtag dir-\$\{dir\}"/, 'Jede Spur muss ihr Kuerzel anzeigen');
  assert.doesNotMatch(stockTrail, /dir==='sweet'\s*\n?\s*\?\s*`<polygon class="trailhead"/,
    'Die Beschraenkung auf Aufwaertsspuren darf nicht zurueckkehren');
  assert.match(css, /\.stockmapwrap \.trailtag\{/, 'Das Kuerzel braucht eine Formatierung');
  assert.match(css, /\.trailtag\{[^}]*pointer-events:none/, 'Das Kuerzel darf keine Klicks auf die Punkte abfangen');
}

console.log('✓ FusionPulse v3.9.3 heatmap-trail regressions: OK');

/* ====================================================================
   v3.10.0 · Sektor-Nachzügler + Kontext an Momentum-Kandidaten.
   Anlass: Der Nutzer hat CRWD in der Momentum-Liste GESEHEN und daraus
   einen profitablen Trade gemacht — ohne dass die App den Zusammenhang
   „NVDA läuft, CRWD hinkt" gezeigt hätte. Sie konnte es nicht: sectorLag
   war auf dem primären Datenpfad nie berechnet.
   Alles hier ist DISCOVERY — kein Score, keine BUY-Wirkung.
   ==================================================================== */
{
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const idx = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
  const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');

  // -- Der eigentliche Fehler: sectorLag fehlte auf dem PRIMÄREN (Tiingo) Pfad.
  assert.match(worker, /function applySectorLag\(rows\)\{/, 'Gemeinsame Sektor-Berechnung muss existieren');
  const calls = [...worker.matchAll(/applySectorLag\(rows\)/g)].length;
  assert.ok(calls >= 3, `applySectorLag muss auf BEIDEN Datenpfaden laufen, gefunden: ${calls}`);
  // Twelve-Data-Zweig
  const twelve = worker.slice(worker.indexOf('rows.sort((a, b) => b.score - a.score);') - 900, worker.indexOf('rows.sort((a, b) => b.score - a.score);'));
  assert.match(twelve, /applySectorLag\(rows\)/, 'Twelve-Data-Pfad muss den Sektor-Rueckstand berechnen');
  // Tiingo-Zweig (der zuvor fehlende)
  // v3.13.0: Fenster vergroessert — dazwischen liegt jetzt der Live-Quote-Stapel.
  const tiingo = worker.slice(worker.indexOf("stockMemo={ts:Date.now(),rows,cycle,sig}") - 1400, worker.indexOf("stockMemo={ts:Date.now(),rows,cycle,sig}"));
  assert.ok(tiingo.length > 600, 'Der Tiingo-Abschnitt muss gefunden werden — leerer Slice waere ein blinder Test');
  assert.match(tiingo, /applySectorLag\(rows\)/, 'Tiingo-Pfad muss den Sektor-Rueckstand berechnen — hier fehlte er');

  // -- Funktionsnachweis: der Ausdruck wird AUSGEFÜHRT, nicht auf Vorkommen geprüft.
  //    (Lehre aus v3.9.3: ein Test auf Schreibweise ist bei Rechnungen blind.)
  {
    const i = worker.indexOf('function applySectorLag');
    const src = worker.slice(i, worker.indexOf('\n}', worker.indexOf('return rows;', i)) + 2);
    const applySectorLag = new Function(src + '; return applySectorLag;')();

    // Der reale Fall: NVDA zieht, CRWD hinkt am weitesten hinterher.
    const rows = [
      { symbol:'NVDA', sector:'Technologie', ret15: 4.2 },
      { symbol:'AMD',  sector:'Technologie', ret15: 2.1 },
      { symbol:'AVGO', sector:'Technologie', ret15: 1.8 },
      { symbol:'CRWD', sector:'Technologie', ret15: 0.4 },
    ];
    applySectorLag(rows);
    const byS = Object.fromEntries(rows.map(r => [r.symbol, r]));
    assert.equal(byS.CRWD.sectorLeaderRet15, 4.2, 'Der Sektor-Anfuehrer muss NVDA sein');
    assert.equal(byS.CRWD.sectorLag, 3.8, 'CRWD muss 3,8 Punkte Rueckstand zeigen');
    const worst = [...rows].sort((a,b)=>b.sectorLag-a.sectorLag)[0];
    assert.equal(worst.symbol, 'CRWD', 'Der groesste Nachzuegler muss oben stehen');
    assert.ok(byS.NVDA.sectorLag < 0, 'Der Anfuehrer selbst darf keinen positiven Rueckstand haben');

    // Fail-closed: fehlende Werte duerfen NICHT als gemessene Null durchgehen.
    // `Number(null)` ist 0 und endlich — genau der Fehler aus v3.9.3.
    const gaps = [
      { symbol:'A', sector:'Tech', ret15: 3 }, { symbol:'B', sector:'Tech', ret15: 2 },
      { symbol:'C', sector:'Tech', ret15: 1 },
      { symbol:'NULLV', sector:'Tech', ret15: null },
      { symbol:'UNDEF', sector:'Tech' },
      { symbol:'EMPTY', sector:'Tech', ret15: '' },
      { symbol:'DISC',  sector:'Discovery', ret15: 5 },
    ];
    applySectorLag(gaps);
    for (const sym of ['NULLV','UNDEF','EMPTY','DISC']) {
      const r = gaps.find(x => x.symbol === sym);
      assert.equal(r.sectorLag, null, `${sym}: fehlender/ungueltiger Wert darf keinen Rueckstand erzeugen`);
    }
    // Ein einzelner Vergleichstitel ist kein Sektor.
    const thin = [{ symbol:'X', sector:'Nische', ret15: 1 }, { symbol:'Y', sector:'Nische', ret15: 5 }];
    applySectorLag(thin);
    assert.equal(thin[0].sectorLag, null, 'Unter drei Titeln darf kein Sektorurteil entstehen');
  }

  // -- Die Kachel muss existieren, im Renderlauf hängen und fail-closed filtern.
  assert.ok(idx.includes('id="sectorLaggards"'), 'Nachzuegler-Kachel braucht einen Platz im Markup');
  assert.match(app, /function renderSectorLaggards\(\)\{/, 'Nachzuegler-Renderer muss existieren');
  assert.match(app, /renderSectorLaggards\(\);/, 'Die Kachel muss im Renderlauf aufgerufen werden');
  const lag = app.slice(app.indexOf('function renderSectorLaggards()'), app.indexOf('function renderCryptoMovers()'));
  assert.match(lag, /r\.sectorLag!=null/, 'Nur Titel mit gemessenem Rueckstand duerfen in die Kachel');
  assert.match(lag, /Number\(r\.sectorLeaderRet15\)>=SECTOR_RUN_MIN/,
    'Ein Rueckstand in einem STEHENDEN Sektor ist bedeutungslos — der Sektor muss laufen');
  // Der Nicht-Kaufsignal-Charakter muss im Text stehen, nicht nur im Kommentar.
  assert.match(lag, /kein Kaufsignal/, 'Die Kachel muss ausdruecklich sagen, dass sie kein Kaufsignal ist');

  // -- Kontextzeile an den Momentum-Karten.
  assert.match(app, /function momentumContext\(symbol\)\{/, 'Kontextzeile muss existieren');
  assert.match(app, /<em>\$\{gainers\.some[\s\S]{0,90}\}<\/em>\$\{momentumContext\(r\.symbol\)\}/,
    'Die Kontextzeile muss an der Momentum-Karte haengen');
  const mc = app.slice(app.indexOf('function momentumContext'), app.indexOf('function renderSectorLaggards'));
  assert.match(mc, /r\.whyNow/, 'Der Auslöser-Kontext muss verwendet werden');
  assert.match(mc, /KEINE Nachrichtenmeldungen/,
    'Der Hinweis muss klarstellen, dass whyNow Kursereignisse sind und keine Nachrichten');

  // -- Die Liste darf sich nicht mehr als Trostpreis darstellen.
  assert.match(app, /Kandidatenliste, keine Kaufempfehlung/,
    'Die Momentum-Kachel muss ihre eigene Rolle benennen');
  assert.match(css, /\.mc-lag\{/, 'Der Sektor-Hinweis braucht eine Formatierung');

  // -- Unverändert: alles hier ist Discovery, nichts davon bewertet.
  assert.doesNotMatch(worker, /applySectorLag[\s\S]{0,200}score\s*[+*]=/, 'Sektor-Rueckstand darf keinen Score veraendern');
  const buyReadyBlock = app.slice(app.indexOf('function buyReady'), app.indexOf('function buyReady') + 1600);
  assert.doesNotMatch(buyReadyBlock, /sectorLag|momentumContext|renderSectorLaggards/,
    'Der Sektor-Rueckstand darf die Kauf-Freigabe nicht beeinflussen');
}

console.log('✓ FusionPulse v3.10.0 sector-laggard/momentum-context regressions: OK');

/* ====================================================================
   v3.11.0 · Aufmerksamkeitsimpuls + Quartalszahlen nach Sektor.
   Beides ANZEIGE. Der Impuls ist zusätzlich auf Sparsamkeit geprüft:
   ein Dauerblinken wäre technisch korrekt und praktisch wertlos.
   ==================================================================== */
{
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const idx = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

  // -- Impuls: Barrierefreiheit ist nicht verhandelbar.
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{[\s\S]{0,220}\.opcard\.pulse-new\{animation:none/,
    'Bei „Bewegung reduzieren" darf nichts animiert werden');
  assert.match(css, /@keyframes fp-attn/, 'Der Impuls braucht eine Animation');
  assert.match(app, /attentionPulse: true/, 'Der Impuls muss abschaltbar und standardmaessig an sein');
  assert.ok(idx.includes('id="sPulse"'), 'Der Impuls braucht einen Schalter in den Einstellungen');
  assert.match(app, /S\.attentionPulse = \$\('#sPulse'\)\.checked/, 'Der Schalter muss gespeichert werden');
  assert.match(app, /if\(S\.attentionPulse === false\) return ''/, 'Abgeschaltet darf kein Impuls entstehen');

  // -- Sparsamkeit: nur der STAERKSTE und nur einmal pro Sitzung.
  const pulse = app.slice(app.indexOf('const PULSE_MS'), app.indexOf('/* ==== v3.10.0 · Sektor-Nachzuegler'));
  assert.ok(pulse.length > 100, 'Der Impuls-Block muss gefunden werden — leerer Slice waere ein blinder Test');
  assert.match(pulse, /pulsedLaggards\.has\(sym\)/, 'Ein bereits gezeigter Titel darf nicht erneut pulsieren');
  assert.match(pulse, /pulsedLaggards\.add\(sym\)/, 'Gezeigte Titel muessen gemerkt werden');
  assert.match(pulse, /setTimeout\([\s\S]{0,180}PULSE_MS\)/, 'Der Impuls muss von selbst enden');
  const lagFn = app.slice(app.indexOf('function renderSectorLaggards()'), app.indexOf('function renderCryptoMovers()'));
  assert.match(lagFn, /ix===0 && r\.symbol===pulseSym/,
    'Nur der staerkste Nachzuegler darf pulsieren — sonst blinkt alles und nichts faellt auf');

  // -- Funktionsnachweis: markAttention wird AUSGEFUEHRT, nicht nur gelesen.
  {
    const src = app.slice(app.indexOf('const PULSE_MS'), app.indexOf('\n}', app.indexOf('return \' pulse-new\';')) + 2);
    const mk = new Function('S', 'document', 'CSS', 'setTimeout',
      src + '; return markAttention;');
    const noop = { querySelectorAll: () => [] };
    const on = mk({ attentionPulse: true }, noop, { escape: (x) => x }, () => {});
    assert.equal(on('CRWD'), ' pulse-new', 'Ein neuer Titel muss pulsieren');
    assert.equal(on('CRWD'), '', 'Derselbe Titel darf in der Sitzung NICHT erneut pulsieren');
    assert.equal(on('VEEV'), ' pulse-new', 'Ein anderer neuer Titel muss pulsieren');
    const off = mk({ attentionPulse: false }, noop, { escape: (x) => x }, () => {});
    assert.equal(off('CRWD'), '', 'Abgeschaltet darf nie ein Impuls entstehen');
  }

  // -- Quartalszahlen-Tafel.
  assert.ok(idx.includes('id="earningsBoard"'), 'Die Tafel braucht einen Platz im Markup');
  assert.match(app, /function renderEarningsBoard\(\)\{/, 'Der Renderer muss existieren');
  assert.match(app, /renderEarningsBoard\(\);/, 'Die Tafel muss im Renderlauf aufgerufen werden');
  const earn = app.slice(app.indexOf('function renderEarningsBoard()'), app.indexOf('/* ==== v3.11.0 · Aufmerksamkeitsimpuls'));
  assert.match(earn, /!known\.has\(sym\)/,
    'Nur analysierte Titel duerfen erscheinen — nur fuer die gibt es einen verifizierten Sektor');
  assert.match(earn, /const info=earningsFor\(sym\)/,
    'Die Tafel muss dieselbe Termin-Logik nutzen wie die Warnung, nicht eine zweite eigene');
  // Jeder Ausfallgrund muss benannt werden, statt leer dazustehen.
  for (const st of ['nokey', 'empty', 'stale']) {
    assert.ok(earn.includes(`'${st}'`), `Der Zustand ${st} muss dem Nutzer erklaert werden`);
  }
  assert.match(earn, /manuell schlaegt automatisch|src===\(earnData\.manual/,
    'Manuell gepflegte Termine muessen Vorrang vor automatischen haben');
  assert.match(earn, /a\.days-b\.days/, 'Innerhalb eines Sektors muss nach Naehe des Termins sortiert werden');
  assert.match(earn, /keine Richtungsaussage/,
    'Die Tafel muss sagen, dass ein Termin nichts ueber die Richtung aussagt');
  assert.match(css, /\.earn-row\.soon\{/, 'Termine binnen 24 h brauchen eine Hervorhebung');

  // -- Unveraendert: beides ist Anzeige, nichts davon bewertet.
  const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  assert.doesNotMatch(worker, /markAttention|renderEarningsBoard/, 'Anzeige-Code gehoert nicht in den Worker');
  const buyReadyBlock = app.slice(app.indexOf('function buyReady'), app.indexOf('function buyReady') + 1600);
  assert.doesNotMatch(buyReadyBlock, /markAttention|earningsBoard|attentionPulse/,
    'Weder Impuls noch Terminliste duerfen die Kauf-Freigabe beeinflussen');
}

console.log('✓ FusionPulse v3.11.0 attention-pulse/earnings-board regressions: OK');

/* ====================================================================
   v3.12.0 · Drei gemeldete Fehler, EINE Ursache bei zweien davon.
   1. Coin-Fokusfenster stösst beim Scrollen an
   2. Reiterleiste verschwindet / soll alle Rubriken tragen
      → beide: feste Pixelwerte statt gemessener Höhe
   3. Heatmap-Spuren ohne Ticker (nur Aufwärtsspuren waren beschriftet)
   ==================================================================== */
{
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const idx = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const cssRaw = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
  /* Kommentare entfernen: Die Notizen erklaeren die alten Pixelwerte und wuerden
     die Negativpruefungen sonst faelschlich ausloesen. Geprueft wird der Code. */
  const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');

  // -- Die festen Pixelwerte müssen WEG sein. Sie waren die gemeinsame Ursache.
  assert.doesNotMatch(css, /body\{padding-top:62px\}/, 'Der geratene 62-px-Abstand darf nicht zurueckkehren');
  assert.doesNotMatch(css, /body\{padding-top:104px\}/, 'Der geratene 104-px-Abstand darf nicht zurueckkehren');
  assert.doesNotMatch(css, /\.viewbar\{top:62px!important\}/, 'Fester Leisten-Versatz darf nicht zurueckkehren');
  assert.doesNotMatch(css, /\.viewbar\{top:104px!important\}/, 'Fester Leisten-Versatz darf nicht zurueckkehren');
  assert.match(css, /body\{padding-top:var\(--fp-chrome-h\)\}/, 'Der Abstand muss aus der gemessenen Hoehe kommen');
  /* v3.14.0: von `sticky` auf `fixed` umgestellt. Sticky blieb im Betrieb trotz
     korrekter Regel nicht stehen — es hat stille Ausfallgruende (Elternbox,
     overflow, Stapelkontext), die man einem Screenshot nicht ansieht. Da die
     Kopfzeile ohnehin `fixed` ist und gemessen wird, ist `fixed` deterministisch.
     Geprueft wird beides: fixiert UND Versatz aus der Messung. */
  assert.match(css, /\.viewbar\{position:fixed!important;top:var\(--fp-head-h\)!important/,
    'Die Leiste muss fixiert sein und ihren Versatz aus der Messung beziehen');
  assert.doesNotMatch(css, /\.viewbar\{top:var\(--fp-head-h\)!important;position:sticky\}/,
    'Die unzuverlaessige sticky-Variante darf nicht zurueckkehren');
  assert.match(css, /scroll-margin-top:calc\(var\(--fp-chrome-h\)/,
    'Sprungziele muessen unter der Leiste hervorkommen, nicht dahinter landen');
  // v3.14.0: --fp-foot-h ist dazugekommen; jede Variable einzeln pruefen statt
  // die exakte Reihenfolge einer Zeile festzuschreiben.
  for (const v of ['--fp-head-h', '--fp-nav-h', '--fp-chrome-h', '--fp-foot-h']) {
    assert.match(css, new RegExp(`${v}:\\d+px`), `Startwert fuer ${v} fehlt`);
  }

  // -- Die Messung muss laufen und fail-closed sein.
  assert.match(app, /function measureChrome\(\)\{/, 'Die Hoehenmessung muss existieren');
  assert.match(app, /new ResizeObserver\(\(\)=>measureChrome\(\)\)/,
    'Ein ResizeObserver muss die Hoehe nachfuehren — die Kopfzeile bricht um');
  const mc = app.slice(app.indexOf('function measureChrome()'), app.indexOf('if(typeof ResizeObserver'));
  assert.ok(mc.length > 200, 'measureChrome muss gefunden werden — leerer Slice waere ein blinder Test');
  assert.match(mc, /if\(!h\) return;/, 'Fail-closed: nicht messbar heisst Startwerte behalten, nicht 0 setzen');
  assert.match(mc, /--fp-chrome-h', \(h\+n\)\+'px'/,
    'Der Gesamtabstand muss Kopfzeile UND Leiste enthalten — das war der eigentliche Fehler');

  // -- Funktionsnachweis: measureChrome wird AUSGEFÜHRT, nicht auf Text geprüft.
  {
    const mkFn = new Function('document', mc + '; return measureChrome;');
    const set = {};
    const doc = {
      querySelector: (sel) => sel === 'body>header' ? { getBoundingClientRect: () => ({ height: 74 }) }
                            : sel === '.viewbar'    ? { getBoundingClientRect: () => ({ height: 61 }) } : null,
      documentElement: { style: { setProperty: (k, v) => { set[k] = v; } } },
    };
    mkFn(doc)();
    assert.equal(set['--fp-head-h'], '74px', 'Die Kopfhoehe muss gemessen uebernommen werden');
    assert.equal(set['--fp-nav-h'], '61px', 'Die Leistenhoehe muss gemessen uebernommen werden');
    assert.equal(set['--fp-chrome-h'], '135px', 'Der Gesamtabstand muss die SUMME sein, nicht nur der Kopf');

    // Fail-closed: ohne messbare Kopfzeile darf NICHTS gesetzt werden.
    const set2 = {};
    const doc2 = {
      querySelector: (sel) => sel === 'body>header' ? { getBoundingClientRect: () => ({ height: 0 }) } : null,
      documentElement: { style: { setProperty: (k, v) => { set2[k] = v; } } },
    };
    mkFn(doc2)();
    assert.deepEqual(set2, {}, 'Ohne messbare Hoehe darf kein Wert ueberschrieben werden');
  }

  // -- Zweistufige Navigation: alle Rubriken erreichbar, aktiver Abschnitt markiert.
  assert.match(app, /function renderViewSub\(\)\{/, 'Die Rubrikenzeile muss gerendert werden');
  assert.match(app, /function markActiveSection\(\)\{/,
    'Eine dauerhaft sichtbare Leiste muss zeigen, wo man ist');
  const rv = app.slice(app.indexOf('function renderViewSub()'), app.indexOf('function setView'));
  assert.match(rv, /\.filter\(\(\[sel\]\)=>document\.querySelector\(sel\)\)/,
    'Rubriken ohne Ziel im Markup duerfen gar nicht erst gezeichnet werden');
  assert.match(css, /\.vb-sec\.on\{/, 'Der aktive Abschnitt braucht eine Markierung');
  assert.match(css, /\.vb-sub\{[^}]*overflow-x:auto/, 'Die Rubrikenzeile muss bei Platzmangel scrollen');
  assert.match(css, /\.vb-sub::-webkit-scrollbar\{height:6px\}/,
    'Auch hier muss der Scrollbalken sichtbar sein — sonst derselbe Fehler wie in Modul 0');

  // -- Heatmap-Spuren: Kürzel und Richtung an JEDER Spur.
  const st = app.slice(app.indexOf('const focusSym=String(focusStock'), app.indexOf('svg.innerHTML=`<rect class="stockbg"'));
  assert.ok(st.length > 400, 'Der Spur-Block muss gefunden werden');
  assert.match(st, /const showTag = move >= MIN_TAG_MOVE/,
    'Kurze Zappler duerfen kein Kuerzel bekommen, sonst wird das Cluster unlesbar');
  assert.match(st, /const head = dir==='flat' \? '' :/,
    'Jede BEWEGTE Spur muss eine Richtung tragen, nicht nur die aufwaerts laufende');
  assert.match(st, /Math\.atan2\(a1\.y-a0\.y, a1\.x-a0\.x\)/,
    'Die Pfeilspitze muss in die tatsaechliche Bewegungsrichtung zeigen');
  assert.match(st, /class="trailtag dir-\$\{dir\}"/, 'Das Kuerzel muss die Richtung mittragen');
  for (const d of ['sweet', 'back', 'side']) {
    assert.ok(css.includes(`.trailhead.dir-${d}{`), `Richtung ${d} braucht eine Farbe`);
    assert.ok(css.includes(`.trailtag.dir-${d}{`), `Kuerzel ${d} braucht eine Farbe`);
  }
  /* Abwärts ist eine Beobachtung, kein Alarm — kein Rot.
     Der erste Versuch prüfte hier auf ein Farbmuster (/#[ef][0-9a-f]{2}[0-5]/)
     und schlug prompt beim Orange #e6a06a an. Ein Muster zu raten ist bei Farben
     unbrauchbar; geprüft wird jetzt gegen die konkreten Rottöne der App. */
  const backFill = (css.match(/\.trailhead\.dir-back\{fill:([^;}]+)/) || [])[1] || '';
  assert.ok(backFill, 'Die Abwaertsspur braucht eine eigene Farbe');
  for (const red of ['var(--red)', '#ef5a5a', '#e5484d', 'red']) {
    assert.notEqual(backFill.trim(), red, 'Abwaerts ist eine Beobachtung und kein Alarm — kein Rot');
  }
}

console.log('✓ FusionPulse v3.12.0 chrome-measure/nav/trail-direction regressions: OK');

/* ====================================================================
   v3.13.0 · Live-Quote im Deep-Scan.
   Befund: `freshestStockQuote` lief NUR im manuellen Suchpfad. Jede Zeile
   aus dem Scanner hatte `liveQuoteOk` undefiniert — die Oberfläche zeigte
   deshalb dauerhaft „KEIN LIVE-QUOTE", auch mitten in der US-Handelszeit.
   Der naive Fix (Aufruf je Symbol) hätte 40 Abfragen je Zyklus bedeutet.
   ==================================================================== */
{
  const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

  // -- Der Deep-Scan muss Quotes holen. Das war der eigentliche Fehler.
  const deep = worker.slice(worker.indexOf('applySectorLag(rows);   // v3.10.0 FIX'),
                            worker.indexOf('stockMemo={ts:Date.now(),rows,cycle,sig}'));
  assert.ok(deep.length > 300, 'Der Deep-Scan-Abschnitt muss gefunden werden');
  assert.match(deep, /freshestStockQuotesBatch\(env,rows\.map\(r=>r\.symbol\)\)/,
    'Der Deep-Scan muss die Live-Quotes im Stapel holen');
  assert.match(deep, /attachLiveQuotes\(rows,q,fx\)/, 'Die Quotes muessen an die Zeilen gehaengt werden');
  assert.match(deep, /catch\(e\)\{ console\.warn/, 'Ein Ausfall darf den Scan nicht abbrechen');

  // -- ES DARF NUR EINE Frischelogik geben. Der Einzelabruf muss den Stapel nutzen.
  //    (Lehre aus v3.10.0: sectorLag lief nur auf einem von zwei Pfaden.)
  const single = worker.slice(worker.indexOf('async function freshestStockQuote(env,symbol){'),
                              worker.indexOf('function attachLiveQuotes'));
  assert.ok(single.length > 80, 'Der Einzelabruf muss gefunden werden');
  assert.match(single, /freshestStockQuotesBatch\(env,\[sym\]\)/,
    'Der Einzelabruf muss den Stapel verwenden, nicht eine zweite Implementierung');
  assert.doesNotMatch(single, /alpacaJSON|tiingoIexSnapshot/,
    'Im Einzelabruf darf keine eigene Abfragelogik stehen');

  // -- Kostennachweis: GENAU ZWEI Aufrufe, unabhängig von der Symbolzahl.
  //    Das ist der Grund, warum der Fix überhaupt tragbar ist — deshalb gemessen
  //    und nicht behauptet.
  {
    const src = worker.slice(worker.indexOf('async function freshestStockQuotesBatch'),
                             worker.indexOf('/* Einzelabruf = Stapel'));
    assert.ok(src.length > 600, 'Die Stapelfunktion muss gefunden werden');
    let alpacaCalls = 0, tiingoCalls = 0, alpacaSymbolArg = null;
    const fn = new Function(
      'safeRadarSymbol', 'alpacaFeed', 'alpacaFeedLabel', 'alpacaJSON',
      'tiingoIexSnapshot', 'usMarketPhase', 'classifyQuoteFreshness', 'console',
      src + '; return freshestStockQuotesBatch;'
    )(
      (x) => String(x || '').trim().toUpperCase() || null,
      () => 'iex',
      () => 'IEX (Free)',
      async (_p, params) => { alpacaCalls++; alpacaSymbolArg = params.symbols;
        return Object.fromEntries(String(params.symbols).split(',')
          .map(s => [s, { latestTrade: { p: 100, t: new Date().toISOString() } }])); },
      async () => { tiingoCalls++; return []; },
      () => ({ key: 'regular' }),
      (q) => ({ ...q, ageSec: 5, live: true }),
      { warn() {} }
    );

    const syms = Array.from({ length: 40 }, (_, i) => `SYM${i}`);
    const res = await fn({ ALPACA_API_KEY_ID: 'k', ALPACA_API_SECRET_KEY: 's', TIINGO_API_TOKEN: 't' }, syms);
    assert.equal(alpacaCalls, 1, `40 Symbole duerfen GENAU 1 Alpaca-Abfrage kosten, waren ${alpacaCalls}`);
    assert.equal(tiingoCalls, 1, `40 Symbole duerfen GENAU 1 Tiingo-Abfrage kosten, waren ${tiingoCalls}`);
    assert.equal(String(alpacaSymbolArg).split(',').length, 40, 'Alle Symbole muessen in EINEN Aufruf gebuendelt werden');
    assert.equal(res.size, 40, 'Jedes Symbol muss ein Ergebnis bekommen');

    // Ohne Symbole darf gar nichts abgefragt werden.
    alpacaCalls = 0; tiingoCalls = 0;
    const empty = await fn({ ALPACA_API_KEY_ID: 'k', ALPACA_API_SECRET_KEY: 's', TIINGO_API_TOKEN: 't' }, []);
    assert.equal(empty.size, 0, 'Ohne Symbole kein Ergebnis');
    assert.equal(alpacaCalls + tiingoCalls, 0, 'Ohne Symbole darf keine Abfrage erfolgen');
  }

  // -- attachLiveQuotes ist rein additiv: keine Quote heisst unveraenderte Zeile.
  {
    const src = worker.slice(worker.indexOf('function attachLiveQuotes'),
                             worker.indexOf('\n}', worker.indexOf('return hit;')) + 2);
    const attach = new Function(src + '; return attachLiveQuotes;')();
    const rows = [{ symbol: 'AAPL', priceUsd: 190 }, { symbol: 'OHNE', priceUsd: 5 }];
    const q = new Map([['AAPL', { priceUsd: 191.5, ts: 1, updated: 'x', ageSec: 7, source: 'S', scope: 'C', live: true }]]);
    const hit = attach(rows, q, 0.9);
    assert.equal(hit, 1, 'Nur Zeilen mit Quote duerfen gezaehlt werden');
    assert.equal(rows[0].liveQuoteOk, true, 'Die Zeile mit Quote muss sie bekommen');
    assert.equal(rows[0].livePriceEur.toFixed(2), (191.5 / 0.9).toFixed(2), 'Der Euro-Kurs muss ueber den Kurs umgerechnet werden');
    assert.equal(rows[1].livePriceUsd, undefined, 'Eine Zeile ohne Quote darf KEINEN erfundenen Wert bekommen');
    assert.equal(rows[1].liveQuoteOk, undefined, 'Eine Zeile ohne Quote darf nicht als frisch gelten');
    assert.equal(rows[1].priceUsd, 5, 'Bestehende Felder duerfen nicht veraendert werden');
  }

  // -- Das Kursalter muss beim ANZEIGEN neu gerechnet werden.
  //    Sonst zeigt eine zwischengespeicherte Zeile einen alten Kurs als frisch.
  {
    const src = app.slice(app.indexOf('function focusQuoteMeta(r){'), app.indexOf('function focusDisplayPrice'));
    assert.ok(src.length > 400, 'focusQuoteMeta muss gefunden werden');
    assert.match(src, /Math\.round\(\(Date\.now\(\)-ts\)\/1000\)/,
      'Das Kursalter muss aus dem Zeitstempel neu gerechnet werden');
    const mk = new Function('stockMeta', 'clock', src + '; return focusQuoteMeta;');
    const meta = { market: { key: 'regular' } };
    const fq = mk(meta, () => '12:00');

    const fresh = fq({ livePriceUsd: 100, liveQuoteTs: Date.now() - 5_000, liveQuoteOk: true, liveQuoteAgeSec: 5 });
    assert.equal(fresh.ok, true, 'Ein eben geholter Kurs muss frisch sein');
    assert.ok(fresh.age <= 6, `Das Alter muss aus dem Zeitstempel kommen, war ${fresh.age}`);

    // Der Kern: Server sagte „frisch", der Kurs ist inzwischen 10 Minuten alt.
    const stale = fq({ livePriceUsd: 100, liveQuoteTs: Date.now() - 600_000, liveQuoteOk: true, liveQuoteAgeSec: 8 });
    assert.equal(stale.ok, false, 'Ein abgelaufener Kurs darf NICHT mehr als frisch gelten');
    assert.ok(stale.age > 500, `Das alte Serveralter (8s) darf nicht durchschlagen, war ${stale.age}`);
    assert.match(stale.label, /VERALTET/, 'Ein abgelaufener Kurs muss als veraltet beschriftet werden');

    const none = fq({ priceUsd: 100 });
    assert.equal(none.has, false, 'Ohne Live-Kurs darf keiner behauptet werden');
    assert.match(none.label, /KEIN LIVE-QUOTE/, 'Fehlender Kurs muss als solcher beschriftet werden');
  }

  // -- Unveraendert: der Live-Quote ist Anzeige, er bewertet nichts.
  const buyReadyBlock = app.slice(app.indexOf('function buyReady'), app.indexOf('function buyReady') + 1600);
  assert.doesNotMatch(buyReadyBlock, /livePriceUsd|liveQuoteOk|focusQuoteMeta/,
    'Der Live-Quote darf die Kauf-Freigabe nicht beeinflussen');
}

console.log('✓ FusionPulse v3.13.0 live-quote-batch regressions: OK');

/* ====================================================================
   v3.14.0 · Zwei Punkte:
   1. „Passt immer noch nicht beim Scrollen" — ich hatte in v3.12.0 den
      KOPF gemessen und den FUSS übersehen. Feste 108 px für die untere
      Signalleiste ließen das Seitenende dauerhaft verdeckt.
   2. Modus A aktivieren. Eine Default-Änderung allein erreicht bestehende
      Nutzer NICHT — gespeicherte Einstellungen überschreiben sie.
   ==================================================================== */
{
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const cssRaw = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
  const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');

  // -- Der Fuss darf keine geratene Hoehe mehr haben.
  assert.doesNotMatch(css, /body\{padding-bottom:108px\}/,
    'Die geratenen 108 px fuer die Signalleiste duerfen nicht zurueckkehren');
  assert.match(css, /body\{padding-bottom:calc\(var\(--fp-foot-h\)/,
    'Der untere Abstand muss aus der gemessenen Hoehe kommen');

  const mc = app.slice(app.indexOf('function measureChrome()'), app.indexOf('if(typeof ResizeObserver'));
  assert.ok(mc.length > 300, 'measureChrome muss gefunden werden');
  assert.match(mc, /querySelector\('\.signal-banner'\)/, 'Die Signalleiste muss gemessen werden');
  /* v3.14.2: Die Struktur hat sich geaendert (zwei Variablen statt einer), das
     Fail-closed-Verhalten NICHT. Der Nachweis dafuer steht jetzt ausgefuehrt im
     v3.14.2-Block, Fall 3; hier bleibt nur die Bedingung selbst. */
  assert.match(mc, /if\(f\)\{/, 'Fail-closed: nicht messbare Signalleiste setzt keinen Wert');
  assert.match(mc, /setProperty\('--fp-foot-h'/, 'Der untere Abstand muss gesetzt werden');
  assert.match(app, /if\(foot\) ro\.observe\(foot\)/,
    'Die Signalleiste aendert ihre Hoehe mit dem Plan und muss beobachtet werden');

  // -- Funktionsnachweis: Kopf UND Fuss, beide gemessen, beide fail-closed.
  {
    const mkFn = new Function('document', mc + '; return measureChrome;');
    const set = {};
    const mkDoc = (headH, navH, footH) => ({
      querySelector: (s) => s === 'body>header' ? (headH ? { getBoundingClientRect: () => ({ height: headH }) } : null)
                          : s === '.viewbar' ? { getBoundingClientRect: () => ({ height: navH }) }
                          : s === '.signal-banner' ? (footH ? { getBoundingClientRect: () => ({ height: footH }) } : null) : null,
      documentElement: { style: { setProperty: (k, v) => { set[k] = v; } } },
    });
    mkFn(mkDoc(74, 61, 173))();
    assert.equal(set['--fp-chrome-h'], '135px', 'Oben muss die Summe aus Kopf und Leiste stehen');
    assert.equal(set['--fp-foot-h'], '173px',
      'Unten muss die GEMESSENE Leistenhoehe stehen — die festen 108 px waren der Fehler');

    // Ohne messbare Signalleiste darf der Startwert nicht ueberschrieben werden.
    const set2 = {};
    const doc2 = mkDoc(74, 61, 0);
    doc2.documentElement.style.setProperty = (k, v) => { set2[k] = v; };
    mkFn(doc2)();
    assert.equal(set2['--fp-foot-h'], undefined, 'Nicht messbarer Fuss darf keinen Wert setzen');
    assert.equal(set2['--fp-chrome-h'], '135px', 'Der Kopf muss trotzdem gemessen werden');
  }

  // -- Modus A: Default UND Migration. Der Default allein reicht nicht.
  assert.match(app, /tradeMode: 'A',/, 'Die Voreinstellung muss auf Modus A stehen');
  const mig = app.slice(app.indexOf('let tradeModeMigrated314'), app.indexOf('// Flatex AT / Tradegate'));
  assert.ok(mig.length > 100, 'Die Migration muss gefunden werden — leerer Slice waere ein blinder Test');
  assert.match(mig, /storedSettings\.tradeMode==='off' && !storedSettings\.tradeModeChosen/,
    'Nur der alte Default darf migriert werden, keine bewusste Wahl');
  assert.match(app, /if\(tmNew !== S\.tradeMode\) S\.tradeModeChosen = true;/,
    'Eine eigene Wahl muss vor kuenftigen Migrationen geschuetzt werden');
  assert.ok(app.includes('if(tradeModeMigrated314 || S.tradeModeMigrated314!==storedSettings.tradeModeMigrated314) saveSettings();'),
    'Die Migration muss gespeichert werden, sonst laeuft sie bei jedem Laden erneut');

  // -- Funktionsnachweis der Migrationsregel, alle vier Faelle.
  {
    const decide = (stored) => {
      const S = { tradeMode: stored.tradeMode ?? 'A' };
      let migrated = false;
      if (!stored.tradeModeMigrated314) {
        if (stored.tradeMode === 'off' && !stored.tradeModeChosen) { S.tradeMode = 'A'; migrated = true; }
        S.tradeModeMigrated314 = true;
      }
      return { mode: S.tradeMode, migrated };
    };
    assert.deepEqual(decide({ tradeMode: 'off' }), { mode: 'A', migrated: true },
      'Der alte Default muss auf Modus A wandern');
    assert.deepEqual(decide({ tradeMode: 'off', tradeModeChosen: true }), { mode: 'off', migrated: false },
      'Eine BEWUSSTE Abschaltung darf NICHT ueberschrieben werden');
    assert.deepEqual(decide({ tradeMode: 'off', tradeModeMigrated314: true }), { mode: 'off', migrated: false },
      'Die Migration darf nur EINMAL laufen');
    assert.deepEqual(decide({}), { mode: 'A', migrated: false },
      'Ein neuer Nutzer bekommt Modus A ueber den Default, ohne Migration');
  }

  // -- Die Umstellung aendert das Bewertungsverhalten und darf nicht still passieren.
  assert.match(app, /if\(tradeModeMigrated314\)\{[\s\S]{0,400}bar\.classList\.remove\('hidden'\)/,
    'Der Nutzer muss ueber die Umstellung informiert werden');
  assert.match(app, /Modus A · Momentum-Tageshandel ist jetzt aktiv/,
    'Der Hinweis muss benennen, was sich aendert');
}

console.log('✓ FusionPulse v3.14.0 footer-measure/mode-A-migration regressions: OK');

/* ====================================================================
   v3.14.1 · Konsistenzprüfung der Auslieferung.
   Gemeldet: „die Version hängt" — Tab-Titel 3.11.0, Kopfzeile v3.12.0.
   Das ist kein Schönheitsfehler: neuer Code auf alter Shell erzeugt
   Folgefehler, die wie Layout- oder Scrollprobleme aussehen. Wir haben
   zwei Runden daran gesucht.
   ==================================================================== */
{
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const idx = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const sync = fs.readFileSync(new URL('../scripts/sync-version.mjs', import.meta.url), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const verjs = fs.readFileSync(new URL('../public/version.js', import.meta.url), 'utf8');

  // -- Die drei Versionsstempel müssen übereinstimmen. Das ist der Kern.
  const shell = (idx.match(/<meta name="fp-shell-version" content="([^"]+)">/) || [])[1];
  const code = (verjs.match(/self\.FP_VERSION = '([^']+)'/) || [])[1];
  const title = (idx.match(/<title>FusionPulse ([^<]+)<\/title>/) || [])[1];
  assert.ok(shell, 'index.html braucht einen Shell-Versionsstempel');
  assert.equal(shell, pkg.version, 'Der Shell-Stempel muss zur package.json passen');
  assert.equal(code, pkg.version, 'version.js muss zur package.json passen');
  assert.equal(title, pkg.version, 'Der Tab-Titel muss zur package.json passen');

  // -- sync-version.mjs muss den Stempel mitziehen, sonst meldet die Pruefung
  //    bei JEDER Auslieferung faelschlich einen Fehlstand.
  assert.match(sync, /patch\('public\/index\.html', \/<meta name="fp-shell-version"/,
    'sync-version.mjs muss den Shell-Stempel mitziehen');

  // -- Die Pruefung selbst.
  assert.match(app, /function checkShellConsistency\(\)\{/, 'Die Konsistenzpruefung muss existieren');
  /* v3.14.3: Die Pruefung ruft jetzt zusaetzlich cssVersion() auf. Der Slice muss
     ab dort beginnen, sonst faellt der Nachweis mit einem ReferenceError statt
     mit einer echten Aussage — und ein Test, der aus dem falschen Grund faellt,
     ist kein Test. Die geprueften Invarianten von v3.14.1 bleiben unveraendert. */
  const chk = app.slice(app.indexOf('function cssVersion()'), app.indexOf('\n}', app.indexOf("return {ok:false,shell,code,action:'warn'}")) + 2);
  assert.ok(chk.length > 200, 'Die Pruefung muss gefunden werden — leerer Slice waere ein blinder Test');
  assert.ok(chk.includes('function checkShellConsistency()'), 'Der Slice muss die Pruefung selbst enthalten');

  // -- Funktionsnachweis: alle vier Fälle ausgeführt, nicht gelesen.
  {
    const mk = (metaVersion, fpVersion, store) => {
      const session = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } };
      const doc = { querySelector: () => (metaVersion ? { getAttribute: () => metaVersion } : null), documentElement: {} };
      // v3.14.3: Der CSS-Stempel wird hier bewusst als PASSEND gestubbt, damit dieser
      // Block weiterhin genau den index.html-Fehlstand prueft und nichts anderes.
      const gcs = () => ({ getPropertyValue: () => (fpVersion ? `"${fpVersion}"` : '') });
      return new Function('document', 'self', 'sessionStorage', 'getComputedStyle', chk + '; return checkShellConsistency;')(
        doc, { FP_VERSION: fpVersion }, session, gcs);
    };
    assert.deepEqual(mk('3.14.1', '3.14.1', {})().ok, true, 'Gleiche Versionen sind in Ordnung');
    assert.equal(mk(null, '3.14.1', {})().ok, true, 'Ohne Stempel darf nicht faelschlich gewarnt werden');
    assert.equal(mk('3.14.1', null, {})().ok, true, 'Ohne FP_VERSION darf nicht faelschlich gewarnt werden');

    // Der eigentliche Fall: Shell alt, Code neu.
    const store = {};
    const first = mk('3.11.0', '3.12.0', store)();
    assert.equal(first.ok, false, 'Ein Fehlstand muss erkannt werden');
    assert.equal(first.action, 'reload', 'Beim ersten Mal wird einmalig neu geladen');

    // KEINE Schleife: der zweite Durchlauf darf nicht wieder neu laden.
    const second = mk('3.11.0', '3.12.0', store)();
    assert.equal(second.action, 'warn',
      'Nach einem erfolglosen Versuch darf NICHT erneut neu geladen werden — eine Reload-Schleife waere der schlimmere Fehler');
  }

  // -- Die Warnung muss sagen, dass es NICHT an den Einstellungen liegt.
  //    Genau diese Fehlzuordnung hat hier zwei Runden gekostet.
  assert.match(app, /die alte Datei kommt vom Server/,
    'Die Warnung muss die Ursache benennen');
  assert.match(app, /NICHT an den Einstellungen liegen/,
    'Die Warnung muss die naheliegende Fehlzuordnung ausschliessen');
  assert.match(app, /setTimeout\(\(\)=>\{ hardReload\(\); \}, 900\)/,
    'Der Selbstheilungsversuch muss die Caches leeren (hardReload)');
}

console.log('✓ FusionPulse v3.14.1 shell-consistency regressions: OK');

/* ====================================================================
   v3.14.2 · Der Fussleisten-Fehler zum DRITTEN Mal, eine Etage tiefer.
   v3.12.0 hat den Kopf gemessen und den Fuss uebersehen.
   v3.14.0 hat den Fuss gemessen und die Aktions-Leiste `.dock` uebersehen.
   Unten liegen zwei feste Leisten uebereinander. Nachgerechnet am
   Screenshot: 66 px Dock + 51 px Signalleiste = 117 px verdeckt,
   freigeschoben wurden 65 px. Es fehlten 52 px.
   Der Fehler tritt NUR bei aktivem Plan auf — ohne Auswahl ist das Dock
   ausgeblendet und v3.14.0 stimmt. Genau deshalb blieb er unentdeckt.
   Zweiter Punkt: die Systemampel nennt jetzt die betroffene Quelle.
   ==================================================================== */
{
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const cssRaw = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
  const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');   // Kommentare zitieren die alten Werte

  // -- Das Dock darf keine geratene Hoehe der Signalleiste mehr annehmen.
  assert.doesNotMatch(css, /\.dock\{[^}]*bottom:52px/,
    'Die geratenen 52 px fuer die Signalleiste duerfen nicht zurueckkehren');
  assert.match(css, /\.dock\{[^}]*bottom:var\(--fp-banner-h\)/,
    'Das Dock muss auf der GEMESSENEN Leistenhoehe sitzen');
  for (const v of ['--fp-banner-h', '--fp-foot-h']) {
    assert.ok(new RegExp(`:root\\{[^}]*\\${v}:`).test(css), `Startwert fuer ${v} muss existieren`);
  }

  const mc = app.slice(app.indexOf('function measureChrome()'), app.indexOf('if(typeof ResizeObserver'));
  assert.ok(mc.length > 400, 'measureChrome muss gefunden werden — leerer Slice waere ein blinder Test');
  assert.match(mc, /querySelector\('\.dock'\)/, 'Die Aktions-Leiste muss gemessen werden');
  assert.match(app, /if\(dock\) ro\.observe\(dock\)/,
    'Das Dock erscheint und verschwindet mit der Auswahl und muss beobachtet werden');

  /* -- Funktionsnachweis: AUSGEFUEHRT, nicht auf Zeichenketten geprueft.
        Regel aus v3.9.3 — bei einer Rechnung ist ein Textmatch kein Nachweis. */
  {
    const mkFn = new Function('document', mc + '; return measureChrome;');
    const mkDoc = (headH, navH, bannerH, dockH, sink) => ({
      querySelector: (s) => s === 'body>header' ? (headH ? { getBoundingClientRect: () => ({ height: headH }) } : null)
                          : s === '.viewbar' ? { getBoundingClientRect: () => ({ height: navH }) }
                          : s === '.signal-banner' ? (bannerH ? { getBoundingClientRect: () => ({ height: bannerH }) } : null)
                          : s === '.dock' ? { getBoundingClientRect: () => ({ height: dockH }) } : null,
      documentElement: { style: { setProperty: (k, v) => { sink[k] = v; } } },
    });

    // Fall 1 — der gemeldete Fall: Plan aktiv, Dock sichtbar. 51 + 66 = 117.
    const a = {}; mkFn(mkDoc(74, 61, 51, 66, a))();
    assert.equal(a['--fp-banner-h'], '51px', 'Das Dock braucht die Leistenhoehe ALLEIN als Bezug');
    assert.equal(a['--fp-foot-h'], '117px',
      'Der untere Abstand muss BEIDE Leisten decken — 51 px allein war der Fehler');

    // Fall 2 — keine Auswahl, Dock ausgeblendet (Hoehe 0). Kein Messfehler.
    const b = {}; mkFn(mkDoc(74, 61, 51, 0, b))();
    assert.equal(b['--fp-foot-h'], '51px', 'Ohne sichtbares Dock ist der Fuss nur die Signalleiste');
    assert.equal(b['--fp-banner-h'], '51px', 'Die Leistenhoehe bleibt davon unberuehrt');

    // Fall 3 — fail-closed: nicht messbare Signalleiste setzt gar nichts.
    const c = {}; mkFn(mkDoc(74, 61, 0, 66, c))();
    assert.equal(c['--fp-foot-h'], undefined, 'Nicht messbarer Fuss darf keinen Wert setzen');
    assert.equal(c['--fp-banner-h'], undefined, 'Auch der Bezug fuer das Dock bleibt dann der Startwert');
    assert.equal(c['--fp-chrome-h'], '135px', 'Der Kopf muss trotzdem gemessen werden');

    // Fall 4 — der Startwert muss den gemeldeten Fall abdecken, falls nie gemessen wird.
    // Es gibt mehrere :root-Bloecke (Farbpalette zuerst) — den mit den Hoehen nehmen.
    const rootM = css.match(/:root\{([^}]*--fp-foot-h[^}]*)\}/);
    assert.ok(rootM, 'Der :root-Block mit den Layout-Hoehen muss gefunden werden');
    const root = rootM[1];
    const foot0 = Number(root.match(/--fp-foot-h:(\d+)px/)[1]);
    const banner0 = Number(root.match(/--fp-banner-h:(\d+)px/)[1]);
    assert.ok(foot0 >= 117, `Startwert --fp-foot-h muss beide Leisten decken (117 px gemessen), ist ${foot0}`);
    assert.ok(foot0 > banner0, 'Der Startwert des Fusses muss groesser sein als der der Leiste allein');
  }

  // -- Die Systemampel muss die betroffene Quelle benennen, nicht nur "Datenquelle".
  const rs = app.slice(app.indexOf('const RESOURCE_LABEL='), app.indexOf('function renderLearningReport'));
  assert.ok(rs.length > 400, 'renderResourceStrip muss gefunden werden');
  assert.match(rs, /alpaca:'Premarket\/Opening \(Alpaca\)'/,
    'Alpaca hat keinen eigenen Punkt in der Kopfzeile und MUSS deshalb im Text stehen');
  assert.doesNotMatch(rs, /'Handlungsbedarf · Datenquelle oder Worker fehlerhaft'/,
    'Der alte Text ohne Quellenangabe darf nicht zurueckkehren');

  /* -- Funktionsnachweis der Namensauswahl. Der gemeldete Zustand:
        Krypto ok, Aktien ok, Alpaca error -> rot, und der Text muss Alpaca nennen. */
  {
    const STATE_TEXT = { ok:'verbunden', error:'API-Fehler', nokey:'API-Key fehlt', stale:'Daten veraltet', cpu:'Ressourcenwarnung' };
    const RESOURCE_LABEL = { crypto:'Krypto (Bitpanda)', stocks:'Aktien (Twelve Data)', alpaca:'Premarket/Opening (Alpaca)' };
    const pick = (hs) => {
      const states=[hs.crypto?.state,hs.stocks?.state,hs.alpaca?.state].filter(Boolean);
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
      return { level, who: bad.join(' · ') };
    };
    const real = pick({ crypto:{state:'ok'}, stocks:{state:'ok'}, alpaca:{state:'error'} });
    assert.equal(real.level, 'red', 'Ein error muss weiterhin rot ergeben — die Bewertung aendert sich NICHT');
    assert.equal(real.who, 'Premarket/Opening (Alpaca): API-Fehler',
      'Der gemeldete Zustand muss Alpaca beim Namen nennen');
    assert.equal(pick({ crypto:{state:'ok'}, stocks:{state:'ok'}, alpaca:{state:'ok'} }).level, 'green',
      'Alles ok bleibt gruen');
    assert.equal(pick({ crypto:{state:'ok'}, stocks:{state:'ok'}, alpaca:{state:'ok'} }).who, '',
      'Im gruenen Fall darf kein Quellenanhang entstehen');
    assert.equal(pick({ crypto:{state:'stale'}, stocks:{state:'ok'}, alpaca:{state:'error'} }).who,
      'Krypto (Bitpanda): API-Fehler'.replace('Krypto (Bitpanda): API-Fehler','Premarket/Opening (Alpaca): API-Fehler'),
      'Bei rot werden nur die roten Quellen genannt, nicht die gelben');
  }
}

console.log('✓ FusionPulse v3.14.2 dock-measure/system-source regressions: OK');

/* ====================================================================
   v3.14.3 · Warum „oben steht 3.14.2" NICHTS bewiesen hat.
   Es gab drei Versionsstempel — index.html, version.js, Worker — und
   die beiden Dateien, in denen die Layoutkorrekturen tatsaechlich
   liegen, hatten KEINEN: app.js und style.css. Der Zustand
   „index.html neu · version.js neu · style.css alt" war damit
   vollstaendig unsichtbar: Konsistenzpruefung gruen, kein blauer
   Balken, Kopfzeile mit neuer Nummer, Scrollen trotzdem kaputt.
   Dazu kam: die Kopfzeile zeigte die Version des WORKERS, nicht die
   des geladenen Codes. Die Nummer, die der Nutzer abliest, war also
   gar kein Beleg fuer die geladene Oberflaeche.
   ==================================================================== */
{
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const cssRaw = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
  const index = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const sw = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  const sync = fs.readFileSync(new URL('../scripts/sync-version.mjs', import.meta.url), 'utf8');
  const pkgV = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

  // -- 1. Verhinderung: eine neue Version ist eine neue URL.
  for (const f of ['style\\.css', 'app\\.js', 'version\\.js']) {
    const m = index.match(new RegExp(`(?:href|src)="/${f}\\?v=([^"]+)"`));
    assert.ok(m, `${f} muss in index.html die Version im URL tragen — sonst kann ein alter Cache-Eintrag getroffen werden`);
    assert.equal(m[1], pkgV, `${f} muss auf die Version aus package.json zeigen, nicht auf eine alte`);
  }
  assert.doesNotMatch(index, /(?:href|src)="\/(?:style\.css|app\.js|version\.js)"/,
    'Kein Asset darf ohne Versionsstempel eingebunden bleiben');
  // Der Sync muss das selbst schreiben — von Hand gepflegt waere es der naechste Fehlstand.
  /* Der Stempel muss VOM SYNC kommen. Ein von Hand gepflegter Stempel waere
     exakt der naechste Fehlstand. Geprueft wird pro Datei die konkrete
     patch()-Zeile auf index.html — ein blosses includes() waere hier zu
     schwach: die SHELL-Zeile fuer sw.js enthaelt dieselben Zeichenketten
     und wuerde einen entfernten index.html-Stempel decken. */
  const syncIndexLines = sync.split('\n').filter((l) => l.includes("patch('public/index.html'"));
  for (const f of ['/style.css?v=', '/app.js?v=', '/version.js?v=']) {
    assert.ok(syncIndexLines.some((l) => l.includes(f)),
      `sync-version.mjs muss ${f} in index.html selbst schreiben`);
  }
  assert.ok(sync.split('\n').some((l) => l.includes('SHELL_VERSIONED') && l.includes("patch('public/sw.js'")),
    'sync-version.mjs muss auch die SW-Liste selbst schreiben');
  assert.match(sw, /SHELL_VERSIONED = \['\/version\.js\?v=/,
    'Der Service-Worker-Cache muss dieselben URLs vorhalten, sonst greift die Offline-Ebene ins Leere');
  assert.ok(sw.includes(`?v=${pkgV}`), 'Die SW-Liste muss mitwandern');

  // -- 2. Erkennung: das Stylesheet traegt einen pruefbaren Stempel.
  const cssV = cssRaw.match(/--fp-css-version:"([^"]+)"/);
  assert.ok(cssV, 'style.css braucht einen eigenen Versionsstempel — ohne ihn ist ein altes CSS nicht erkennbar');
  assert.equal(cssV[1], pkgV, 'Der CSS-Stempel muss zur package.json passen');
  assert.match(app, /function cssVersion\(\)/, 'Die App muss den CSS-Stempel auslesen koennen');
  assert.match(app, /--fp-css-version/, 'Die Konsistenzpruefung muss das Stylesheet einbeziehen');

  // -- 3. Die Kopfzeile darf nicht die Serverversion als laufenden Code ausgeben.
  assert.doesNotMatch(app, /\$\('#appver'\)\.textContent = 'v' \+ health\.version;/,
    'Die Kopfzeile darf NICHT die Worker-Version anzeigen — genau diese Fehlannahme kostete eine Runde');
  /* v3.14.5: Die Anzeige wanderte in renderVersionBadge() und zeigt beide Nummern
     jetzt IMMER, nicht nur bei Abweichung. Die Invariante von v3.14.3 ist
     unveraendert: die Kopfzeile meldet den laufenden Code, nicht den Worker.
     Der ausgefuehrte Nachweis dafuer steht im v3.14.5-Block. */
  assert.match(app, /renderVersionBadge\(String\(health\.version\)\)/,
    'Die Kopfzeile muss ueber renderVersionBadge laufen');
  assert.match(app, /function renderVersionBadge\(serverVersion\)\{/,
    'renderVersionBadge muss existieren');

  /* -- Funktionsnachweis, AUSGEFUEHRT: die Pruefung selbst, alle vier Faelle.
        Ein Textmatch waere hier kein Nachweis — es geht um eine Fallunterscheidung. */
  {
    const startAt = app.indexOf('function cssVersion()');
    const tail = "return {ok:false,shell,code,action:'warn'};";
    const tailAt = app.indexOf(tail);
    assert.ok(startAt >= 0 && tailAt > startAt, 'Die Anker der Pruefung muessen gefunden werden');
    const endAt = app.indexOf('}', tailAt + tail.length) + 1;   // schliessende Klammer mitnehmen
    const src = app.slice(startAt, endAt);
    assert.ok(src.length > 500 && src.length < 3000,
      'Der Slice muss GENAU die Pruefung enthalten — ein zu grosser Slice waere ein blinder Test');
    assert.ok(src.includes('function checkShellConsistency()'), 'Der Slice muss beide Funktionen enthalten');
    const mk = (shellV, codeV, cssV, tried) => {
      const store = { 'fp.shellFixTried': tried || null };
      const document = {
        querySelector: () => shellV ? { getAttribute: () => shellV } : null,
        documentElement: {},
      };
      const fn = new Function('document', 'self', 'sessionStorage', 'getComputedStyle',
        src + '; return checkShellConsistency;');
      return fn(document, { FP_VERSION: codeV },
        { getItem: (k) => store[k], setItem: (k, v) => { store[k] = v; } },
        () => ({ getPropertyValue: () => cssV == null ? '' : `"${cssV}"` }))();
    };

    // Der gemeldete Fall: alles neu, nur das Stylesheet alt. Bis v3.14.2 unsichtbar.
    const stale = mk('3.14.3', '3.14.3', '3.14.2', null);
    assert.equal(stale.ok, false, 'Ein veraltetes style.css MUSS auffallen — das war die Luecke');
    assert.equal(stale.part, 'style.css', 'Die Meldung muss die betroffene Datei benennen');
    assert.equal(stale.action, 'reload', 'Erster Fehlstand: einmal selbst heilen');

    // Zweiter Durchlauf derselben Sitzung: warnen statt erneut laden.
    assert.equal(mk('3.14.3', '3.14.3', '3.14.2', '3.14.3').action, 'warn',
      'Keine Reload-Schleife — nach dem einen Versuch wird gewarnt');

    // Alles gleich -> in Ordnung.
    assert.equal(mk('3.14.3', '3.14.3', '3.14.3', null).ok, true, 'Gleiche Versionen duerfen nicht warnen');

    // Fail-closed: fehlender CSS-Stempel ist KEIN Fehlstand (altes CSS ohne die Variable).
    assert.equal(mk('3.14.3', '3.14.3', null, null).ok, true,
      'Ein fehlender Stempel darf keine Falschwarnung ausloesen');

    // Die alte index.html-Pruefung aus v3.14.1 muss weiter greifen.
    const shellBad = mk('3.14.2', '3.14.3', '3.14.3', null);
    assert.equal(shellBad.ok, false, 'Der Shell-Fehlstand aus v3.14.1 muss erhalten bleiben');
  }
}

console.log('✓ FusionPulse v3.14.3 asset-stamp/css-consistency regressions: OK');

/* ====================================================================
   v3.14.4 · Warum drei Fussleisten-Korrekturen wirkungslos blieben.
   `html,body{height:100%}` macht die body-Box genau fensterhoch. Der
   Inhalt ist ein Vielfaches davon und laeuft heraus. `padding-bottom`
   sitzt damit am unteren Rand DER BOX — rund eine Fensterhoehe weit
   oben, mitten im Inhalt — und nicht hinter dem letzten Element. Zur
   Scrollhoehe des Dokuments traegt es nichts bei.
   Die Messung aus v3.14.2 war richtig, die Zahl stimmte, und sie floss
   in eine Eigenschaft, die an dieser Stelle keine Wirkung haben KANN.
   Belegende Asymmetrie: `padding-top` hat immer funktioniert, weil es
   VOR dem Inhalt steht. `padding-bottom` nie.
   ==================================================================== */
{
  const cssRaw = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
  const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');   // Kommentare zitieren die alte Regel
  const index = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

  // -- 1. Die Ursache selbst darf nicht zurueckkehren.
  assert.doesNotMatch(css, /html\s*,\s*body\s*\{[^}]*height:100%/,
    'body darf NICHT auf feste Fensterhoehe gesetzt werden — dann ist padding-bottom wirkungslos');
  assert.doesNotMatch(css, /(^|\})\s*body\s*\{[^}]*[^-]height:100%/,
    'Auch einzeln darf body keine feste Hoehe von 100% bekommen');
  assert.match(css, /body\{margin:0;min-height:100%\}/,
    'Die Box muss mit dem Inhalt wachsen duerfen');

  // -- 2. Der tragende Mechanismus ist ein echtes Element im Fluss.
  assert.match(css, /\.foot-spacer\{[^}]*height:calc\(var\(--fp-foot-h\) \+ 14px\)/,
    'Der Abstandhalter muss seine Hoehe aus derselben Messung beziehen');
  assert.match(index, /<div class="foot-spacer" aria-hidden="true"><\/div>/,
    'Der Abstandhalter muss im Dokument existieren');

  /* Er muss das LETZTE Element im Fluss sein — steht noch Inhalt dahinter,
     schiebt er die falsche Stelle frei. Skripte zaehlen nicht, die erzeugen
     keine Box. */
  {
    const body = index.slice(index.indexOf('<body'), index.indexOf('</body>'));
    const after = body.slice(body.indexOf('<div class="foot-spacer"'));
    const rest = after
      .replace('<div class="foot-spacer" aria-hidden="true"></div>', '')
      .replace(/<script[\s\S]*?<\/script>/g, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .trim();
    assert.equal(rest, '', `Nach dem Abstandhalter darf kein Inhalt mehr folgen, gefunden: ${rest.slice(0, 120)}`);
  }

  // -- 3. Das padding bleibt als korrektes Boxmodell, ersetzt den Halter aber nicht.
  assert.match(css, /body\{padding-bottom:calc\(var\(--fp-foot-h\) \+ 14px\)\}/,
    'Das padding bleibt erhalten — es ist jetzt nur nicht mehr der einzige Mechanismus');

  /* -- Funktionsnachweis, AUSGEFUEHRT: das Boxmodell nachgerechnet.
        Gemessen am Screenshot vom 28.8.: zwei feste Leisten verdecken 117 px.
        Mit fester Hoehe endet die body-Box eine Fensterhoehe weit oben; das
        padding liegt dann VOR dem Inhaltsende und traegt null bei. */
  {
    const VIEWPORT = 715;      // sichtbare Hoehe in CSS-Pixeln
    const CONTENT  = 9800;     // tatsaechliche Inhaltshoehe (langer Aktienradar)
    const FOOT     = 117;      // .dock 66 + .signal-banner 51, am Screenshot gemessen
    const PAD      = FOOT + 14;
    const SPACER   = FOOT + 14;

    // Scrollhoehe = Unterkante der body-Box ODER Unterkante des Inhalts, je nachdem was tiefer liegt.
    const scrollHeight = (bodyBoxHeight, spacer) =>
      Math.max(bodyBoxHeight + PAD, CONTENT + spacer);
    const freeAtEnd = (h, spacer) => scrollHeight(h, spacer) - CONTENT;

    // Vorher: feste Fensterhoehe, kein Abstandhalter.
    assert.equal(freeAtEnd(VIEWPORT, 0), 0,
      'Mit height:100% erzeugt padding-bottom KEINE Scrollflaeche — das war der Fehler');
    // Nachher: Abstandhalter im Fluss.
    assert.equal(freeAtEnd(VIEWPORT, SPACER), 131,
      'Der Abstandhalter muss die volle Leistenhoehe plus Reserve freischieben');
    assert.ok(freeAtEnd(VIEWPORT, SPACER) >= FOOT,
      'Freigeschobene Flaeche muss mindestens beide Leisten decken');
    // Auch mit korrigierter Box bleibt der Halter der tragende Mechanismus.
    assert.ok(freeAtEnd(CONTENT, SPACER) >= FOOT, 'min-height darf das Ergebnis nicht verschlechtern');
  }
}

console.log('✓ FusionPulse v3.14.4 body-box/foot-spacer regressions: OK');

/* ====================================================================
   v3.14.5 · Die Worker-Version steht jetzt dauerhaft im Kopf.
   Bis v3.14.4 erschien sie NUR bei Abweichung. Bei Gleichstand stand
   dort eine einzelne Nummer — und genau dann ist von aussen nicht
   unterscheidbar, ob der Vergleich stattgefunden hat oder ob die
   Anzeige auf die alte Einquellen-Logik zurueckgefallen ist. Nach drei
   Runden Auslieferungsproblemen ist ein SICHTBARER Gleichstand die
   nuetzlichere Information als ein stilles Nichts.
   ==================================================================== */
{
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const cssRaw = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
  const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');

  assert.match(css, /\.sys\.ver\.mismatch\{color:var\(--yellow\)\}/,
    'Ein Fehlstand muss im Kopf sichtbar sein, nicht nur im Tooltip');

  const rv = app.slice(app.indexOf('function renderVersionBadge(serverVersion){'),
                       app.indexOf('renderVersionBadge(null);'));
  assert.ok(rv.length > 400 && rv.length < 3000, 'renderVersionBadge muss gefunden werden');
  assert.doesNotMatch(rv, /srv===ui\s*\?/, 'Die Worker-Version darf nicht mehr an eine Bedingung geknuepft sein');

  /* -- Funktionsnachweis, AUSGEFUEHRT. Sechs Faelle. */
  {
    const mk = (ui, srv, shell, cssV) => {
      const el = { textContent: '', title: '', classList: { _m: false, toggle(_, v) { this._m = v; } } };
      const doc = {
        querySelector: (s) => s === '#appver' ? el
          : s === 'meta[name="fp-shell-version"]' ? (shell ? { getAttribute: () => shell } : null) : null,
        documentElement: {},
      };
      const fn = new Function('$', 'document', 'FP_VERSION', 'cssVersion',
        rv + '; return renderVersionBadge;');
      fn((s) => doc.querySelector(s), doc, ui, () => cssV)(srv);
      return { text: el.textContent, title: el.title, mismatch: el.classList._m };
    };

    // 1. Gleichstand: BEIDE Nummern muessen trotzdem dastehen.
    const ok = mk('3.14.5', '3.14.5', '3.14.5', '3.14.5');
    assert.equal(ok.text, 'v3.14.5 · Worker 3.14.5',
      'Bei Gleichstand muss die Worker-Version SICHTBAR bleiben — das war der Wunsch');
    assert.equal(ok.mismatch, false, 'Gleichstand darf nicht als Fehlstand eingefaerbt werden');
    assert.match(ok.title, /alle Stempel identisch/, 'Der Tooltip muss den Gleichstand benennen');

    // 2. Vor der ersten Health-Antwort: ehrlicher Platzhalter statt falscher Nummer.
    assert.equal(mk('3.14.5', null, '3.14.5', '3.14.5').text, 'v3.14.5 · Worker …',
      'Ein unbekannter Worker-Stand darf nicht als Zahl erfunden werden');

    // 3. Worker voraus (Deploy gelaufen, Browser noch alt).
    const drift = mk('3.14.4', '3.14.5', '3.14.4', '3.14.4');
    assert.equal(drift.text, 'v3.14.4 · Worker 3.14.5', 'Beide Staende muessen ablesbar sein');
    assert.equal(drift.mismatch, true, 'Eine Abweichung muss eingefaerbt werden');

    // 4. Der Fall aus v3.14.3: alles neu, nur das Stylesheet alt.
    const staleCss = mk('3.14.5', '3.14.5', '3.14.5', '3.14.4');
    assert.equal(staleCss.mismatch, true, 'Ein veraltetes Stylesheet muss auch hier auffallen');
    assert.match(staleCss.title, /Stylesheet \(style\.css\): 3\.14\.4/,
      'Der Tooltip muss den abweichenden Stempel beim Namen nennen');

    // 5. Fail-closed: fehlende Stempel sind KEIN Fehlstand.
    assert.equal(mk('3.14.5', '3.14.5', null, null).mismatch, false,
      'Fehlende Stempel duerfen keine Falschwarnung ausloesen');

    // 6. Die Kopfzeile meldet den laufenden Code, nicht den Worker — Invariante aus v3.14.3.
    assert.ok(mk('3.14.4', '3.14.5', '3.14.4', '3.14.4').text.startsWith('v3.14.4'),
      'Die fuehrende Nummer muss der geladene Code sein, nicht der Server');
  }
}

console.log('✓ FusionPulse v3.14.5 version-badge regressions: OK');

/* ====================================================================
   v3.14.6 · Die Systemampel war keine Ampel mehr.
   Vier Zustaende, aber nur zwei davon hatten eine Textfarbe: `orange`
   und `err`. `ok` und `warn` faerbten ausschliesslich den 1px-Rahmen,
   und zwar mit 47 % Deckkraft. Der Zustand war korrekt berechnet, aber
   nicht ablesbar. Als einziges Statuselement im Kopf hatte die Leiste
   ausserdem keinen Punkt, waehrend Krypto/Aktien/Tiingo/Cloudflare
   daneben welche haben.
   Geaendert wird ausschliesslich die DARSTELLUNG. Die Zuordnung
   Zustand -> Stufe bleibt unveraendert; ein Test rechnet sie nach.
   ==================================================================== */
{
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');   // Kommentare zitieren die alten Werte

  // -- Jeder der vier Zustaende braucht einen Punkt UND eine Textfarbe.
  for (const lvl of ['ok', 'warn', 'orange', 'err']) {
    assert.ok(new RegExp(`\\.resource-strip\\.${lvl} b::before\\{background:`).test(css),
      `Stufe "${lvl}" braucht einen sichtbaren Punkt in der Zustandsfarbe`);
    assert.ok(new RegExp(`\\.resource-strip\\.${lvl} span\\{color:`).test(css),
      `Stufe "${lvl}" braucht eine Textfarbe — ok und warn hatten keine, das war der Fehler`);
  }
  // -- Die unsichtbaren Rahmen duerfen nicht zurueckkehren.
  assert.doesNotMatch(css, /\.resource-strip\.warn\{border-color:#f2c01577\}/,
    'Der 47-%-Rahmen war praktisch unsichtbar und darf nicht zurueckkehren');
  assert.match(css, /\.resource-strip b::before\{content:""/,
    'Die Leiste braucht ueberhaupt einen Punkt, wie die Statuspunkte daneben');

  /* -- Die BEWERTUNG darf sich nicht geaendert haben. Ausgefuehrt nachgerechnet:
        dieselbe Stufenlogik wie in renderResourceStrip, gegen die Klassenabbildung. */
  {
    const map = app.match(/box\.classList\.add\((level==='green'[^;]*)\);/);
    assert.ok(map, 'Die Abbildung Stufe -> CSS-Klasse muss gefunden werden');
    const toClass = new Function('level', `return ${map[1]};`);
    assert.equal(toClass('green'), 'ok', 'gruen muss auf ok abbilden');
    assert.equal(toClass('yellow'), 'warn', 'gelb muss auf warn abbilden');
    assert.equal(toClass('orange'), 'orange', 'orange muss auf orange abbilden');
    assert.equal(toClass('red'), 'err', 'rot muss auf err abbilden');

    const level = (states) => {
      const red = states.some((x) => ['error', 'nokey'].includes(x));
      const orange = states.some((x) => ['cpu', 'daylimit'].includes(x));
      const yellow = states.some((x) => ['ratelimit', 'stale', 'warn', 'unknown'].includes(x));
      return red ? 'red' : orange ? 'orange' : yellow ? 'yellow' : 'green';
    };
    // Der Zustand aus dem Screenshot vom 28.8.: Aktien stale, Rest ok -> gelb.
    assert.equal(toClass(level(['ok', 'stale', 'ok'])), 'warn',
      'Ein veralteter Aktienfeed muss gelb bleiben — die Bewertung aendert sich NICHT');
    assert.equal(toClass(level(['ok', 'ok', 'ok'])), 'ok', 'Alles ok bleibt gruen');
    assert.equal(toClass(level(['ok', 'ok', 'error'])), 'err', 'Ein Fehler bleibt rot');
    assert.equal(toClass(level(['cpu', 'ok', 'ok'])), 'orange', 'Ressourcenwarnung bleibt orange');
  }
}

console.log('✓ FusionPulse v3.14.6 system-lamp-visibility regressions: OK');

/* ====================================================================
   v3.15.0 · Drei additive Erweiterungen. Gemeinsame Invariante:
   KEINE davon veraendert einen Score, ein Gate, eine Ampel oder eine
   Freigabe. Das ist der Punkt, an dem diese Suite scharf sein muss —
   die Ergaenzungen sind gross, ihr erlaubter Wirkbereich ist klein.
     1. Modellvergleich (Claude/Aladdin, ChatGPT-Strang, Momentum)
     2. Sektor-Prioritaet der Deep-Scan-Queue
     3. Kachelfarben, Variante A: Ampelfarben sind geschuetzt
   ==================================================================== */
{
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  const index = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  /* ---- 1. Modellvergleich ------------------------------------------------ */
  const mcSrc = app.slice(app.indexOf('const MODEL_LABEL='), app.indexOf('const TINTABLE_TILES='));
  assert.ok(mcSrc.length > 800 && mcSrc.length < 6000, 'Der Modellvergleich muss gefunden werden');
  // Er darf LESEN, nicht RECHNEN. Keine Score-/Gate-Arithmetik in diesem Block.
  for (const forbidden of ['S.minCrvStock', 'S.minCrvCoin', 'buyReady', 'light=', 'score=']) {
    assert.ok(!mcSrc.includes(forbidden),
      `Der Modellvergleich darf nichts bewerten — "${forbidden}" gehoert nicht hinein`);
  }
  assert.match(app, /\$\{modelCompare\(top\)\}\$\{positionPanel\(top\)\}/,
    'Der Modellvergleich muss in der Fokuskarte eingehaengt sein');
  assert.match(worker, /claude, fusion, momentum,/,
    'Alle drei Urteile muessen weiterhin im selben Datensatz ausgeliefert werden');

  /* Funktionsnachweis, AUSGEFUEHRT: Dissens erkennen, aktiven Strang markieren,
     Uebereinstimmung NICHT als Bestaetigung ausgeben. */
  {
    const fn = new Function('esc', 'num', 'S', 'momentumModeOn',
      mcSrc + '; return {modelCompare, activeModelKey};');
    const api = fn((x) => String(x), (x) => String(x), { claudeMode: true }, () => false);

    const r1 = { claude: { light: 'red', score: 5, blockers: ['CRV zu niedrig'] },
                 fusion: { light: 'yellow', score: 6 }, momentum: { light: 'green', score: 7 } };
    const out1 = api.modelCompare(r1);
    assert.match(out1, /model-compare dissent/, 'Verschiedene Urteile muessen als Dissens markiert werden');
    assert.match(out1, /UNEINIG/, 'Der Dissens muss im Klartext benannt werden');
    assert.match(out1, /Claude \/ Aladdin · aktiv/, 'Der aktive Strang muss markiert sein');
    assert.match(out1, /CRV zu niedrig/, 'Der wichtigste Blocker muss sichtbar sein');

    const same = { light: 'green', score: 8 };
    const out2 = api.modelCompare({ claude: same, fusion: same, momentum: same });
    assert.doesNotMatch(out2, /dissent/, 'Gleiche Urteile duerfen nicht als Dissens erscheinen');
    assert.match(out2, /KEINE Bestätigung/,
      'Uebereinstimmung darf NICHT als Bestaetigung verkauft werden — die Modelle teilen sich die Kursdaten');

    // Der aktive Strang folgt dem Modus, nicht der Anzeigereihenfolge.
    assert.equal(fn((x) => x, (x) => x, { claudeMode: false }, () => false).activeModelKey(), 'fusion');
    assert.equal(fn((x) => x, (x) => x, { claudeMode: true }, () => true).activeModelKey(), 'momentum');
    // Ein fehlender Strang darf nicht zu einer erfundenen Aussage werden.
    assert.match(api.modelCompare({ claude: { light: 'green' } }), /nicht berechnet/,
      'Ein fehlendes Modell muss als "nicht berechnet" erscheinen, nicht stillschweigend fehlen');
  }

  /* ---- 2. Sektor-Prioritaet ---------------------------------------------- */
  const secSrc = worker.slice(worker.indexOf('const PRIORITY_SECTORS ='),
                              worker.indexOf('const OPENING_UNIVERSE ='));
  assert.ok(secSrc.length > 600, 'Die Sektorliste muss gefunden werden');
  {
    const fn = new Function(secSrc + '; return {prioritySectorOf, PRIORITY_SECTORS, SECTOR_RESERVE_PER_SECTOR};');
    const api = fn();
    assert.deepEqual(api.PRIORITY_SECTORS.map((x) => x[0]),
      ['Pharma/Healthcare', 'Edelmetalle/Minen', 'Technologie'],
      'Die Reihenfolge ist die gewuenschte Prioritaet und darf nicht stillschweigend wechseln');
    assert.equal(api.prioritySectorOf('LLY'), 'Pharma/Healthcare');
    assert.equal(api.prioritySectorOf('NEM'), 'Edelmetalle/Minen');
    assert.equal(api.prioritySectorOf('NVDA'), 'Technologie');
    assert.equal(api.prioritySectorOf('nvda'), 'Technologie', 'Kleinschreibung muss greifen');
    assert.equal(api.prioritySectorOf('BRK.B'), null, 'Unbekanntes darf nicht zugeordnet werden');
    assert.equal(api.prioritySectorOf(''), null, 'Leereingabe darf nichts zuordnen');
    assert.equal(api.prioritySectorOf(null), null, 'null darf nichts zuordnen');
    // Die Reserve darf den allgemeinen Radar nicht aushungern (capRadar >= 8).
    assert.ok(api.SECTOR_RESERVE_PER_SECTOR * api.PRIORITY_SECTORS.length <= 3,
      'Die Sektor-Reserve muss klein gegen capRadar bleiben, sonst wird der Radar wieder ein Katalog-Pool');
  }
  assert.match(worker, /row\.prioritySector=prioritySectorOf\(sym\);/,
    'Der Sektor muss am Datensatz gekennzeichnet werden');
  // Der Sektor darf NIRGENDS in eine Bewertung einfliessen.
  for (const m of worker.match(/prioritySector[^\n]*/g) || []) {
    assert.ok(!/score|Score|light|buy|BUY|crv|CRV|gate/.test(m.replace('row.prioritySector=prioritySectorOf(sym);', '')),
      `Der Prioritaetssektor darf keine Bewertung beruehren: ${m.slice(0, 90)}`);
  }
  assert.match(app, /prio-sector/, 'Der Sektor muss im Client gekennzeichnet sein');
  assert.doesNotMatch(css, /\.prio-sector\{[^}]*color:var\(--green\)/,
    'Die Sektor-Kennzeichnung darf keine Ampelfarbe tragen — sie sagt nichts ueber Handelbarkeit');

  /* ---- 3. Kachelfarben, Variante A --------------------------------------- */
  const tintSrc = app.slice(app.indexOf('const TINTABLE_TILES='), app.indexOf('function positionPanel(r){'));
  assert.ok(tintSrc.length > 800, 'Der Kachelfarb-Block muss gefunden werden');
  assert.match(index, /id="tileTintBox"/, 'Die Einstellung muss im Dialog existieren');

  /* Der Kern von Variante A: kein faerbbarer Selektor darf eine Ampel beruehren. */
  {
    const tintRules = css.split('\n').filter((l) => l.includes('var(--tint-'));
    assert.ok(tintRules.length >= 5, 'Es muessen faerbbare Kacheln existieren');
    for (const rule of tintRules) {
      const sel = rule.split('{')[0];
      for (const guarded of ['.hl-', '.mc-cell.hl', '.resource-strip', 'sf-verdict', 'status-band', '::before']) {
        assert.ok(!sel.includes(guarded),
          `Variante A: "${guarded}" ist eine Ampel und darf nicht faerbbar sein — Regel: ${sel}`);
      }
    }
  }

  /* Funktionsnachweis, AUSGEFUEHRT: reservierte Ampelfarben werden VERWORFEN. */
  {
    const mk = (tints) => {
      const set = new Map();
      const root = { setProperty: (k, v) => set.set(k, v), removeProperty: (k) => set.delete(k) };
      const doc = { documentElement: { style: root } };
      const fn = new Function('S', 'document', '$', 'esc',
        tintSrc + '; return {tintFor, applyTileTints};');
      const api = fn({ tileTints: tints }, doc, () => null, (x) => x);
      api.applyTileTints();
      return { api, set };
    };
    assert.equal(mk({ sfGrid: '#13cf8b' }).api.tintFor('sfGrid'), '',
      'Ampelgruen darf NICHT als Kachelton uebernommen werden');
    assert.equal(mk({ sfGrid: '#F2C015' }).api.tintFor('sfGrid'), '',
      'Ampelgelb darf nicht uebernommen werden, auch nicht in Grossschreibung');
    assert.equal(mk({ sfGrid: '#ef4f57' }).api.tintFor('sfGrid'), '', 'Ampelrot darf nicht uebernommen werden');
    assert.equal(mk({ sfGrid: '#5b8cff' }).api.tintFor('sfGrid'), '#5b8cff', 'Ein erlaubter Ton muss greifen');
    assert.equal(mk({ sfGrid: 'javascript:x' }).api.tintFor('sfGrid'), '',
      'Nur echte Hex-Werte duerfen in die CSS-Variable — fail-closed gegen manipulierten localStorage');
    assert.equal(mk({}).api.tintFor('sfGrid'), '', 'Ohne Einstellung bleibt es beim Standard');

    const applied = mk({ sfGrid: '#5b8cff', interpret: '#13cf8b' }).set;
    assert.equal(applied.get('--tint-sfGrid'), '#5b8cff', 'Der erlaubte Ton muss gesetzt werden');
    assert.ok(!applied.has('--tint-interpret'),
      'Eine verworfene Ampelfarbe darf gar keine Variable setzen, nicht nur eine andere');
  }
}

console.log('✓ FusionPulse v3.15.0 model-compare/sector-priority/tile-tint regressions: OK');

/* ====================================================================
   v3.16.0 · VARIANTE 2: Modus A gibt keine Kauf-Freigabe mehr.

   Anlass (gemessen, nicht vermutet): `momentumOverlayRow()` ersetzt 14
   Anzeigefelder, `netCRV` ist NICHT dabei. `stockTradeability()` prueft
   bei claudeMode:false aber genau `r.netCRV` gegen `S.minCrvStock`.
   Modus A wurde also an einer Kennzahl des ChatGPT-Strangs gemessen,
   die zu einem Plan gehoert, den der Overlay bereits ersetzt hatte.

   Diese Suite prueft AUSGEFUEHRT (Abschnitt 11: nicht auf Vorkommen
   einer Zeichenkette, sondern auf die Aussage):
     1. Modus A kann Stufe 3 nicht mehr erreichen.
     2. Der ChatGPT-Strang gibt weiterhin frei — er ist unberuehrt.
     3. Ohne Momentum-Block faellt alles ins bisherige Verhalten.
     4. Die Begruendung kommt aus den Modus-A-Blockern.
     5. Die Euro-Zahl bleibt sichtbar, gekennzeichnet als Plan.
   ==================================================================== */
{
  const { loadClient } = await import('./client-harness.mjs');
  const C = loadClient();
  const S = C.S;
  S.claudeMode = false; S.sizeMode = 'fixed'; S.fixedTradeEur = 10000;
  S.equity = 20000; S.riskPct = 1; S.minCrvStock = 3; S.minTp2PctStock = 0;
  C.stockMeta = { market:{ key:'regular' }, refreshedSymbols:['TEST'], ts: Date.now() };

  /* Eigene Fixture, NICHT aus einer anderen Suite nachgenutzt (Checkliste 4).
     Bewusst so gebaut, dass sie in BEIDEN Strangen freigabefaehig waere —
     nur so beweist ein Level != 3 etwas ueber Modus A statt ueber die Daten. */
  const mk = () => ({
    symbol:'TEST', name:'Test Inc.', sector:'Technologie',
    priceUsd:50, priceEur:46, marketPhase:'regular',
    liveQuoteOk:true, liveQuoteAgeSec:30, updated:new Date().toISOString(),
    light:'green', score:8.0, netCRV:4.0, tp2Pct:6.5, relVol:2.0,
    entryUsd:50, stopUsd:49.4, tp1Usd:51.6, tp2Usd:53.3, buyCapacityEur:500000,
    entryEur:46, stopEur:45.5, tp1Eur:47.5, tp2Eur:49.0,
    momentum:{ light:'green', score:7.5, verdict:'Kauf-Setup · Momentum',
      blockers:['RVOL 1.4x < 1,5x'], entryUsd:50, stopUsd:49.2, tp1Usd:52, tp2Usd:54,
      entryEur:46, stopEur:45.3, tp1Eur:47.9, tp2Eur:49.7, tp2Pct:8.0, stopPct:1.6,
      rewardRisk:5.0, quoteFresh:true, quoteAgeSec:30 },
  });
  const look = (mode) => { S.tradeMode = mode; const r = mk(); C.stockRows = [r];
    C.momentumOverlayRow(r); return r; };

  // ---- 1. Modus A: keine Freigabe, trotz in JEDER Hinsicht perfektem Titel.
  const a = look('A');
  assert.equal(C.MODE_A_NO_RELEASE, true, 'Variante 2 muss eingeschaltet sein');
  assert.equal(C.modeAActive(a), true, 'Modus A muss an diesem Datensatz wirksam sein');
  assert.notEqual(C.stockLevel(a), 3,
    'Modus A darf Stufe 3 (BUY) nicht mehr erreichen — das ist der Kern von Variante 2');
  assert.equal(C.stockLevel(a), 2, 'Gruen wird zu Stufe 2: abgewertet, nicht ausgeblendet');

  // Die Kopfzeile muss den EIGENEN Zweig nehmen. `kind` allein reicht als
  // Nachweis NICHT — es stammt aus opp.blockKind und faellt auch ohne den
  // Zweig auf 'modeA'. Die Negativkontrolle hat genau das aufgedeckt.
  const hl = C.stockHeadline(a);
  assert.equal(hl.kind, 'modeA', 'Kopfzeile muss den Modus-A-Zweig melden');
  assert.equal(hl.icon, '◆', 'Der Modus-A-Zweig hat ein eigenes Symbol, keine Ampel');
  assert.match(hl.title, /Aufmerksamkeitsfilter/,
    'Die Kopfzeile muss erklaeren, WARUM es keine Freigabe gibt');
  assert.doesNotMatch(hl.text, /\bBUY\b/, 'Die Kopfzeile darf kein BUY behaupten');
  assert.match(C.stockOrderPlan(a), /KEINE KAUF-FREIGABE/,
    'Auch der kopierbare Plan muss die fehlende Freigabe ausdruecklich nennen');

  // ---- 4. Die Begruendung stammt aus Modus A, nicht aus dem anderen Modell.
  const opp = C.stockOpportunity(a);
  assert.equal(opp.ready, false, 'Auch das Opportunity-Band gibt keine Freigabe');
  assert.match(opp.why, /RVOL 1\.4x/, 'Der Grund muss aus r.blockers (Modus A) kommen');
  assert.doesNotMatch(opp.why, /Struktur-CRV/,
    'Der Grund darf NICHT mehr das Struktur-CRV des ChatGPT-Strangs zitieren');
  assert.match(opp.reasons.join(' '), /Plan netto/, 'Die Euro-Zahl bleibt in den Gruenden');

  // ---- 5. Die Euro-Zahl bleibt, gekennzeichnet als Plan statt als Empfehlung.
  const szTxt = C.stockSizeDisplay(a, C.stockSizing(a), false);
  const szHtml = C.stockSizeDisplay(a, C.stockSizing(a), true);
  assert.match(szTxt, /^Plan\s/, 'Der Einsatz muss als Plangroesse gekennzeichnet sein');
  assert.doesNotMatch(szTxt, /pot\./, 'Nicht die alte "pot."-Beschriftung des anderen Zweigs');
  assert.match(szHtml, /keine Kaufempfehlung/,
    'Der Tooltip muss klarstellen, dass die Zahl keine Empfehlung ist');

  // ---- 2. Der ChatGPT-Strang bleibt unberuehrt. Ohne diesen Nachweis waere
  //         Variante 2 eine Verschlechterung fuer den parallelen Strang.
  const b = look('off');
  assert.equal(C.stockLevel(b), 3,
    'Ohne Modus A muss die Freigabe erreichbar bleiben — Invariante 9');
  assert.equal(C.stockHeadline(b).kind, 'buy', 'Die Kopfzeile des anderen Strangs ist unveraendert');
  assert.equal(C.modeAActive(b), false, 'Bei tradeMode off darf der Zweig nicht greifen');

  // ---- 3. Fail-closed in die andere Richtung: ein alter Cache ohne
  //         Momentum-Block darf nicht stillschweigend alles sperren.
  S.tradeMode = 'A';
  const c = mk(); delete c.momentum; C.stockRows = [c]; C.momentumOverlayRow(c);
  assert.equal(C.modeAActive(c), false, 'Ohne Momentum-Block ist Modus A nicht wirksam');
  assert.equal(C.stockLevel(c), 3, 'Alte Caches fallen ins bisherige Verhalten zurueck');
  S.tradeMode = 'off';

  // ---- Glossar: der neue Begriff braucht einen Eintrag an genau EINER Stelle.
  assert.ok(C.GLOSS.modeANoRelease && C.GLOSS.modeANoRelease.length > 80,
    'GLOSS-Eintrag modeANoRelease fehlt oder ist zu duenn');
  assert.ok(C.GLOSS_LABEL.modeANoRelease, 'GLOSS_LABEL fehlt: modeANoRelease');
  assert.ok(C.GLOSS_GROUPS.some((g) => g.keys.includes('modeANoRelease')),
    'modeANoRelease taucht im sichtbaren Glossar nicht auf');
}

console.log('✓ FusionPulse v3.16.0 mode-A-no-release regressions: OK');

/* ====================================================================
   v3.16.1 · P6 Teil 1b: Eingabemaske fuer manuelle Quartalstermine.
   Die Route POST /api/earnings gibt es seit v3.8.2, die Oberflaeche nie.
   In v3.16.0 war der Code ausgeliefert, aber OHNE Funktionsnachweis —
   nach Abschnitt 13 zaehlt das nicht als fertig. Hier ist er.

   Geprueft wird AUSGEFUEHRT, nicht per Regex:
     1. Das Wirkungsfenster folgt exakt earningsFor() (0..14 Tage).
     2. Die Client-Bereinigung spiegelt writeManualEarnings().
     3. Keine optimistische Anzeige: bei Serverfehler bleibt der Stand.
   ==================================================================== */
{
  const { loadClient } = await import('./client-harness.mjs');
  let reply = null, sent = null;
  const C = loadClient({ fetch: async (u, o) => { sent = { url:String(u), body:JSON.parse(o.body) }; return reply; } });
  /* Der Client startet beim Laden loadEarnings(). Dessen Promise loest eine
     Mikrotask spaeter auf und ueberschrieb die Fixture — beim ersten Anlauf
     fiel dieser Test deshalb aus dem FALSCHEN Grund (Abschnitt 11). */
  await new Promise((r) => setImmediate(r));

  // ---- 1. Wirkungsfenster. Weicht es von earningsFor() ab, behauptet die
  //         Maske eine Wirkung, die es nicht gibt.
  assert.equal(C.EARN_WINDOW_DAYS, 14, 'Fensterbreite muss zu earningsFor() passen');
  const T = '2026-08-28';
  assert.equal(C.earnEntryStatus('2026-08-28', T).state, 'active', 'Heute wirkt');
  assert.equal(C.earnEntryStatus('2026-09-11', T).state, 'active', 'Tag 14 wirkt noch');
  assert.equal(C.earnEntryStatus('2026-09-12', T).state, 'ahead', 'Tag 15 wirkt noch nicht');
  assert.equal(C.earnEntryStatus('2026-08-27', T).state, 'past', 'Gestern wirkt nicht mehr');
  assert.equal(C.earnEntryStatus('quatsch', T).state, 'invalid', 'Unbrauchbares Datum wird benannt');
  assert.equal(C.earnEntryStatus('2026-09-12', T).active, false,
    'Ausserhalb des Fensters darf nichts als wirksam gelten — fail-closed');

  // ---- 2. Bereinigung spiegelt den Server. Was hier durchkommt, kommt dort
  //         ebenfalls durch — sonst luegt die Vorschau.
  const n = C.earnNormalizeRows([
    { symbol:' mrna ', date:'2026-09-01', time:'AMC' },
    { symbol:'toolongsymbol', date:'2026-09-02' },
    { symbol:'X', date:'01.09.2026' },
    { symbol:'MRNA', date:'2026-09-01', time:'bmo' },
    { symbol:'', date:'2026-09-03' }]);
  assert.equal(n.filter((x) => x.symbol === 'MRNA').length, 1, 'Doppelte werden zusammengefasst');
  assert.equal(n.find((x) => x.symbol === 'MRNA').time, 'bmo', 'Der spaetere Eintrag gewinnt');
  assert.ok(!n.some((x) => x.date === '01.09.2026'), 'Falsches Datumsformat wird verworfen');
  assert.ok(!n.some((x) => !x.symbol), 'Leeres Kuerzel wird verworfen');
  assert.ok(n.every((x) => x.symbol.length <= 8), 'Kuerzel wird wie serverseitig auf 8 gekuerzt');

  // ---- 3. Keine optimistische Anzeige. Das ist der Kern: der Server kuerzt
  //         und wirft ohne D1. Wer seine eigene Eingabe anzeigt, zeigt einen
  //         Termin, den es nicht gibt.
  C.earnData = { state:'ok', auto:[], manual:[{ symbol:'ALT', date:'2026-09-05', time:'amc' }] };
  reply = { ok:false, status:500, json: async () => ({ state:'error', error:'Keine D1-Verbindung' }) };
  assert.equal(await C.saveManualEarnings([{ symbol:'NEU', date:'2026-09-06', time:'amc' }]), false,
    'Ein Serverfehler muss als Fehlschlag zurueckkommen');
  assert.equal(C.earnData.manual.length, 1, 'Bei Serverfehler bleibt der bisherige Stand unangetastet');
  assert.equal(C.earnData.manual[0].symbol, 'ALT', 'Es wird nichts lokal hinzuerfunden');
  assert.equal(sent.body.rows[0].symbol, 'NEU', 'Es wird die VOLLSTAENDIGE Liste geschickt — die Route ersetzt');

  reply = { ok:true, status:200, json: async () => ({ state:'ok', rows:[{ symbol:'SRV', date:'2026-09-07', time:'bmo' }] }) };
  assert.equal(await C.saveManualEarnings([{ symbol:'IRGENDWAS', date:'2026-09-09', time:'amc' }]), true);
  assert.equal(C.earnData.manual[0].symbol, 'SRV',
    'Uebernommen wird die SERVERANTWORT, nicht die eigene Eingabe');

  // ---- Oberflaeche und Glossar
  const index = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(index, /id="earningsEditor"/, 'Die Maske braucht einen sichtbaren Ort');
  for (const id of ['earnSym', 'earnDate', 'earnSlot', 'earnAdd', 'earnManualList', 'earnEditState'])
    assert.ok(index.includes(`id="${id}"`), `Bedienelement fehlt im Markup: ${id}`);
  // Die Felder muessen STATISCH im Markup stehen: renderEarningsBoard() schreibt
  // sein innerHTML bei jedem Scan neu und wuerde ein erzeugtes Formular samt
  // Eingabefokus mitten im Tippen verwerfen.
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const editor = app.slice(app.indexOf('function renderEarningsEditor'), app.indexOf('function wireEarningsEditor'));
  assert.ok(editor.length > 400, 'Der Editor-Block muss gefunden werden');
  assert.ok(!/id="earnSym"|id="earnDate"|id="earnSlot"/.test(editor),
    'Die Eingabefelder duerfen NICHT neu gerendert werden — sonst geht der Tippfokus verloren');
  assert.ok(C.GLOSS.earnManual && C.GLOSS.earnManual.length > 80, 'GLOSS-Eintrag earnManual fehlt');
  assert.ok(C.GLOSS_LABEL.earnManual, 'GLOSS_LABEL fehlt: earnManual');
  assert.ok(C.GLOSS_GROUPS.some((g) => g.keys.includes('earnManual')),
    'earnManual taucht im sichtbaren Glossar nicht auf');
}

console.log('✓ FusionPulse v3.16.1 manual-earnings-editor regressions: OK');

/* ====================================================================
   v3.17.0 · MUSTERLABOR. Ereignisstudie ueber die serverseitig
   aufgezeichneten Snapshots: Was war VOR einer Bewegung messbar?

   Diese Suite ist die wichtigste der ganzen Datei, weil hier zum ersten
   Mal eine STATISTISCHE Aussage entsteht. Eine falsch-positive Statistik
   ist gefaehrlicher als gar keine — sie sieht aus wie Wissen.
   Geprueft wird deshalb gegen BEKANNTE Wahrheit, ausgefuehrt:
     A) eingebauter Unterschied  -> MUSS gefunden werden
     B) reines Rauschen          -> darf NICHT gemeldet werden
     C) kleine Stichprobe        -> KEIN Urteil, nicht "schwacher Effekt"
     D) keine Datenbank          -> keine Behauptung
   ==================================================================== */
{
  const w = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  const cut = (a, b) => { const i = w.indexOf(a), j = w.indexOf(b, i);
    assert.ok(i >= 0 && j > i, `Anker fehlt: ${a}`); return w.slice(i, j); };
  const src = cut('const PATTERN_FEATURES =', 'async function patternLab(env){')
    + cut('async function patternLab(env){', '\n/* ============================================================================\n   PAKET A');
  assert.ok(src.length > 2500, 'Der Musterlabor-Block muss gefunden werden');
  // Die Auswertung darf NICHTS bewerten. Kein Gate, kein Score, keine Ampel.
  for (const forbidden of ['buyReady', 'minCrvStock', 'light=', 'score=', 'tradeMode'])
    assert.ok(!src.includes(forbidden), `Das Musterlabor darf nichts bewerten: "${forbidden}"`);

  const deps = cut('function collapseEpisodes(rows){', 'function bucketStats(');
  assert.ok(src.includes('aucNoiseFloor(nUp,nDown,PATTERN_FEATURES.length)'),
    'Die Zufallsgrenze muss auf die ZAHL der geprueften Kennzahlen bezogen sein');
  const api = new Function('ATTR', 'LEGACY_WIN_PCT', 'APP_VERSION', 'ensureD1Schema', 'safeJson',
    deps + src + '; return {patternLab, aucSeparation, aucNoiseFloor, medianOf, zQuantile};')(
    { MIN_SAMPLE: 20, WIN_PCT: 5, STOP_PCT: -1.5 }, 5, 'test', async () => {}, JSON.stringify);

  // Eigene Fixture (Checkliste 4). Jeder Fall bekommt ein eigenes Symbol UND
  // einen eigenen Tag, damit collapseEpisodes ihn als eigene Episode zaehlt.
  const DAY = 86400000;
  const mkDB = (n, separable, rnd) => {
    const rows = [];
    for (let i = 0; i < n; i++) {
      /* Zeitpunkte bewusst INNERHALB der US-Sitzung (14–19 Uhr UTC).
         `collapseEpisodes()` gruppiert nach UTC-Kalendertag; eine Episode, die
         ueber Mitternacht laeuft, zaehlte doppelt. In Produktion kann das nicht
         vorkommen (US-Handel liegt 13:30–20:00 UTC) — die Fixture darf es dann
         auch nicht kuenstlich erzeugen, sonst prueft der Test einen Fall, den
         es nicht gibt, und verdeckt den, den es gibt. */
      const up = i % 2 === 0;
      const midnight = Math.floor(Date.now() / DAY) * DAY;
      const ts = midnight - (12 - Math.floor(i / 6)) * DAY + 14 * 3600_000 + (i % 6) * 3600_000;
      const noise = () => rnd() * 2 - 1;
      const rvol = separable ? (up ? 2.4 : 1.1) + noise() * 0.25 : 1.7 + noise() * 0.9;
      const base = { symbol: 'S' + i, ts, bucket5: Math.floor(ts / 300000), price: 100,
        score: 6 + noise(), crv: 2 + noise(), rvol, ret15: noise(), ret60: noise(),
        atr_pct: 1.5 + noise() * 0.2, liquidity_vacuum: noise(), sector_lag: noise(),
        crowd_score: 50 + noise() * 10, structure_pct: 3 + noise(),
        max_pct: up ? 7 : 0.4, min_pct: up ? -0.3 : -3.0,
        resolved_ts: ts + 2 * 3600_000, payload: '{"setup":"breakout"}' };
      rows.push(base);
      /* Drei WEITERE aufgeloeste Aufnahmen DERSELBEN Bewegung (gleiches Symbol,
         gleicher Tag, andere 5-Minuten-Bucket). Ohne collapseEpisodes zaehlten
         sie als vier unabhaengige Faelle — die Stichprobe waere vervierfacht und
         jede Zufallsschwankung sähe signifikant aus. Erst diese Zeilen machen
         die Negativkontrolle dazu ueberhaupt sichtbar. */
      for (const dup of [5, 10, 15]) rows.push({ ...base, ts: ts + dup * 60000,
        bucket5: Math.floor((ts + dup * 60000) / 300000) });
      for (const dm of [-30, 30]) rows.push({ ...base, ts: ts + dm * 60000,
        bucket5: Math.floor((ts + dm * 60000) / 300000),
        price: 100 * (1 + (up ? dm / 25 : -dm / 33) / 100), resolved_ts: null });
    }
    return { prepare: () => ({ bind: () => ({ all: async () => ({ results: rows }) }) }) };
  };
  // Deterministischer Zufall: ein Test, der mal faellt und mal nicht, ist keiner.
  const mulberry = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296; };

  // ---- A) Der eingebaute Unterschied MUSS gefunden werden.
  const A = await api.patternLab({ DB: mkDB(120, true, mulberry(7)) });
  assert.equal(A.state, 'ok');
  assert.ok(A.enoughOverall, 'Bei 60/60 Faellen muss ein Urteil moeglich sein');
  const rv = A.features.find((f) => f.key === 'rvol');
  assert.equal(rv.verdict, 'trennt', 'Ein eingebauter Unterschied MUSS erkannt werden');
  assert.ok(rv.auc > rv.noiseFloor, 'Die Trennschaerfe muss ueber der Zufallsgrenze liegen');
  assert.ok(rv.medianUp > rv.medianDown, 'Die Richtung des Unterschieds muss stimmen');
  const others = A.features.filter((f) => f.key !== 'rvol' && f.enough);
  assert.ok(others.length >= 8, 'Die uebrigen Kennzahlen muessen mitausgewertet werden');
  assert.ok(others.every((f) => f.verdict === 'kein Signal'),
    'Kennzahlen ohne eingebauten Unterschied duerfen NICHTS melden');
  assert.ok(A.path.up.some((p) => p.m < 0 && p.pct != null),
    'Der Verlauf braucht Stuetzstellen VOR dem Ereignis — das ist der Sinn der Sache');

  /* Episoden statt Snapshots. Die Fixture enthaelt je Fall VIER aufgeloeste
     Aufnahmen derselben Bewegung. Werden sie nicht zusammengefasst, ist die
     Stichprobe vervierfacht und jede Zufallsschwankung sieht signifikant aus —
     der gefaehrlichste denkbare Fehler in dieser Auswertung. */
  assert.ok(A.resolvedRows >= 4 * A.episodes,
    'Die Fixture muss mehrere Aufnahmen je Bewegung enthalten, sonst prueft dieser Test nichts');
  assert.equal(A.episodes, 120,
    'Aufnahmen derselben Bewegung duerfen NICHT als unabhaengige Faelle zaehlen');
  assert.equal(A.counts.up + A.counts.down + A.counts.flat, A.episodes,
    'Jede Episode gehoert in genau eine Gruppe');

  // ---- B) Rauschen darf keine Funde erzeugen. Das ist die eigentliche Huerde:
  //         ohne Zufallsgrenze findet man bei 10 Kennzahlen fast immer etwas.
  let falsePositives = 0;
  for (let k = 0; k < 5; k++) {
    const B = await api.patternLab({ DB: mkDB(120, false, mulberry(100 + k)) });
    falsePositives += B.features.filter((f) => f.enough && /^trennt/.test(f.verdict)).length;
  }
  assert.equal(falsePositives, 0,
    `Rauschen darf KEINE Funde erzeugen, war ${falsePositives} von 50. Ohne die Mehrfachtestkorrektur ist genau das der Fall — der erste Entwurf meldete hier regelmaessig eine "Entdeckung".`);
  // Die Korrektur muss die Huerde messbar anheben, nicht nur dastehen.
  assert.ok(api.aucNoiseFloor(60, 60, 10) > api.aucNoiseFloor(60, 60, 1) + 0.03,
    'Die Mehrfachtestkorrektur muss die Zufallsgrenze spuerbar anheben');
  assert.ok(Math.abs(api.zQuantile(0.975) - 1.96) < 0.001, 'Die Quantilfunktion muss stimmen');

  // ---- C) Kleine Stichprobe: KEIN Urteil, auch kein vorsichtiges.
  const C = await api.patternLab({ DB: mkDB(20, true, mulberry(3)) });
  assert.equal(C.enoughOverall, false, 'Bei 10/10 Faellen darf es kein Gesamturteil geben');
  assert.ok(C.features.every((f) => f.verdict === 'zu wenige Fälle'),
    'Zu wenige Faelle ergeben KEIN schwaches Urteil, sondern gar keines — fail-closed');

  // ---- D) Ohne Datenbank wird nichts behauptet.
  const D = await api.patternLab({});
  assert.equal(D.state, 'nodb');
  assert.equal(D.configured, false, 'Ohne D1 darf kein Ergebnis vorgetaeuscht werden');

  // ---- Der Situationstyp wird ab jetzt mitgeschrieben. Er FEHLTE bisher —
  //      deshalb konnte Modul 0 ueber die neun Situationstypen nie etwas lernen.
  assert.match(w, /function snapshotPayload\(row\)\{/, 'Eine Stelle fuer den Payload, nicht zwei');
  assert.equal((w.match(/snapshotPayload\(row\)/g) || []).length, 3,
    'Beide Schreibpfade muessen denselben Payload benutzen (Lehre aus v3.10.0)');
  for (const k of ['situation', 'lifecycle', 'maturity'])
    assert.ok(new RegExp(`${k}:`).test(w.slice(w.indexOf('function snapshotPayload'), w.indexOf('async function d1StoreRows'))),
      `Der Snapshot muss "${k}" mitschreiben`);

  // ---- Darstellung: keine Ampelfarben. Eine Beobachtung ueber die
  //      Vergangenheit darf sich die Bedeutung "handelbar" nicht ausleihen.
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const tone = app.slice(app.indexOf('const PAT_TONE='), app.indexOf('const PAT_NAME='));
  for (const lamp of ['#13cf8b', '#f2c015', '#ef4f57', 'var(--green)', 'var(--red)', 'var(--yellow)'])
    assert.ok(!tone.includes(lamp), `Das Musterlabor darf keine Ampelfarbe verwenden: ${lamp}`);
  const index = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(index, /id="patternLab"/, 'Das Musterlabor braucht einen sichtbaren Ort');
  assert.match(app, /loadPatterns\(\)/, 'Es muss beim Start geladen werden');
  // Luecken bleiben Luecken (Lehre aus v3.9.3: nicht messbare Werte nie als 0).
  const pathFn = app.slice(app.indexOf('function patternPath(d){'), app.indexOf('function renderPatternLab()'));
  assert.match(pathFn, /if\(!Number\.isFinite\(p\.pct\)\)\{\s*open=false;\s*continue;\s*\}/,
    'Fehlende Stuetzstellen muessen die Linie unterbrechen, nicht interpoliert werden');
}

console.log('✓ FusionPulse v3.17.0 pattern-lab regressions: OK');

/* ====================================================================
   v3.18.0 · Vier Punkte aus einem Befund:
     1. Freigabe-Trichter — zaehlt, WO die Kandidaten haengenbleiben.
        Der Fehler aus v3.16.0 (`netCRV` als Gate fuer Modus A) war eine
        Woche lang unsichtbar, weil es diese Zaehlung nicht gab.
     2. Kalibrierung der Zielweite aus VORHANDENEN Aufzeichnungen.
     3. Sektor-Reserve darf aus dem Katalog nachziehen (P-A4).
     4. Dollarumsatz wird mitgeschrieben, damit MOM_MIN_DOLLARVOL
        irgendwann messbar wird statt geraten zu bleiben.
   ==================================================================== */
{
  const { loadClient } = await import('./client-harness.mjs');
  const C = loadClient(); const S = C.S;
  await new Promise((r) => setImmediate(r));
  S.claudeMode = false; S.tradeMode = 'off'; S.sizeMode = 'fixed'; S.fixedTradeEur = 10000;
  S.equity = 20000; S.riskPct = 1; S.minCrvStock = 3; S.minTp2PctStock = 0; S.maxLossEur = 0;
  C.stockMeta = { market:{ key:'regular' }, refreshedSymbols:['OK','BAD'], ts: Date.now() };
  const good = () => ({ symbol:'OK', name:'Gut', priceUsd:50, priceEur:46, marketPhase:'regular',
    liveQuoteOk:true, liveQuoteAgeSec:20, updated:new Date().toISOString(),
    light:'green', score:8.0, netCRV:4.0, tp2Pct:6.5, relVol:2,
    entryUsd:50, stopUsd:49.4, tp1Usd:51.6, tp2Usd:53.3, buyCapacityEur:500000,
    entryEur:46, stopEur:45.5, tp1Eur:47.5, tp2Eur:49.0 });

  // ---- 1a. Der Trichter benennt die EINZIGE offene Bedingung.
  const bad = good(); bad.symbol = 'BAD'; bad.netCRV = 1.2;
  C.stockRows = [bad];
  /* Inhalt vergleichen, nicht Identitaet: der Client laeuft in einem eigenen
     VM-Kontext, seine Arrays haben einen anderen Prototyp und scheitern an
     deepStrictEqual — ein Test, der aus DIESEM Grund faellt, sagt nichts aus. */
  assert.equal(C.gateMissesOf(bad).join(','), 'crv',
    'Bei nur verletztem CRV darf genau diese eine Bedingung gemeldet werden');
  assert.equal(C.gateMissesOf(good()).join(','), '',
    'Ein einwandfreier Kandidat hat keine offene Bedingung');

  // ---- 1b. KEINE Zweitrechnung. Der Trichter liest die Urteile, die die
  //          Freigabe ohnehin faellt — sonst koennen beide auseinanderlaufen
  //          (Lehre aus v3.10.0, `sectorLag` nur auf einem Datenpfad).
  const tr = C.stockTradeability(bad);
  assert.equal(tr.crvOk, false, 'stockTradeability muss das CRV-Urteil herausgeben');
  assert.equal(tr.hasSize, true, 'stockTradeability muss melden, ob eine Groesse berechenbar war');
  assert.equal(tr.tp2Ok, true, 'stockTradeability muss das Ziel-Urteil herausgeben');
  assert.notEqual(C.stockLevel(bad), 3, 'Trichter und Freigabe muessen dasselbe sagen');
  assert.equal(C.stockLevel(good()), 3, 'Der einwandfreie Kandidat muss weiterhin frei sein');

  // ---- 1c. Die Anzeige. Erst durch das gemerkte Stub-Element im Harness
  //          ueberhaupt pruefbar — vorher liess sich nur feststellen, dass
  //          die render-Funktion nicht abstuerzt.
  C.stockRows = [good(), bad, { ...good(), symbol:'X1', light:'yellow', netCRV:1.0 }];
  C.renderGateFunnel();
  const html = C.el('#gateFunnel').innerHTML;
  assert.ok(html.length > 100, 'Der Trichter muss tatsaechlich etwas schreiben');
  assert.match(html, /1 von 3 frei/, 'Freie Kandidaten werden gezaehlt');
  assert.match(html, /CRV unter Mindestwert/, 'Die bindende Bedingung muss erscheinen');
  assert.match(html, /nie gegriffen/, 'Tote Gitter muessen ausgewiesen werden');
  /* Die kursive Zahl ist der EIGENTLICHE Nutzen des Trichters: wie oft war
     diese Bedingung die EINZIGE offene? Nur sie beantwortet "woran haengt es
     wirklich". Ohne diese Pruefung merkt der Test nicht, wenn die Zaehlung
     wegfaellt — die Negativkontrolle hat genau das aufgedeckt. */
  assert.match(html, /CRV unter Mindestwert <b>2<\/b><i>·1<\/i>/,
    'Der Trichter muss zeigen, wie oft eine Bedingung die EINZIGE offene war');
  assert.match(html, /Ampel nicht grün <b>1<\/b>(?!<i>)/,
    'Eine Bedingung, die nie allein blockiert, darf keine Entscheider-Zahl tragen');
  assert.doesNotMatch(html, /BUY|Kauf-Freigabe erteilt/, 'Der Trichter erteilt keine Freigabe');

  // ---- 1d. In Modus A gibt es keine Freigabekette. Sie trotzdem zu zaehlen,
  //          waere irrefuehrend — dann stuende dort "Ampel nicht gruen" als
  //          Grund, obwohl die Kette gar nicht durchlaufen wird.
  S.tradeMode = 'A';
  const m = good();
  m.momentum = { light:'green', score:7.5, verdict:'x', blockers:[], entryUsd:50, stopUsd:49.2,
    tp1Usd:52, tp2Usd:54, entryEur:46, stopEur:45.3, tp1Eur:47.9, tp2Eur:49.7,
    tp2Pct:8, stopPct:1.6, rewardRisk:5, quoteFresh:true, quoteAgeSec:20 };
  C.stockRows = [m]; C.momentumOverlayRow(m); C.renderGateFunnel();
  const hA = C.el('#gateFunnel').innerHTML;
  assert.match(hA, /keine Freigabekette/, 'In Modus A muss der Trichter erklaeren statt zu zaehlen');
  assert.doesNotMatch(hA, /CRV unter/, 'Keine irrefuehrende Zaehlung in Modus A');
  S.tradeMode = 'off';

  // ---- 2. Kalibrierung: unter der Mindestzahl KEIN Faktor, nur Fuellstand.
  const thin = C.patternCalibration({ calibration:{ n:5, enough:false,
    note:'Noch 15 Episoden bis zur ersten belastbaren Messung.' } });
  assert.match(thin, /Noch 15 Episoden/, 'Zu wenig Daten ergibt den Fuellstand, keinen Faktor');
  assert.doesNotMatch(thin, /%<\/b>/, 'Ohne belastbare Messung darf keine Quote erscheinen');
  const cal = C.patternCalibration({ calibration:{ n:80, enough:true, p50:1.4, p75:2.6,
    currentTargetMultiple:1,
    reach:[{k:0.5,pct:71},{k:1,pct:58},{k:1.5,pct:44},{k:2,pct:31},{k:3,pct:18}] } });
  assert.match(cal, /58%/, 'Die Erreichungsquote je Zielweite muss erscheinen');
  assert.match(cal, /current/, 'Der heute eingestellte Faktor muss markiert sein');
  assert.match(cal, /setzt nichts automatisch/,
    'Es muss dranstehen, dass die Messung nichts automatisch veraendert');

  // ---- 3./4. Worker: Reserve-Pool und Dollarumsatz.
  const w = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  const lines = w.split('\n');
  const endOf = (start) => { for (let i = start; i < lines.length; i++)
    if (lines[i].trim() === '];') return i + 1; };
  const grab = (head, name) => { const a = lines.findIndex((x) => x.startsWith(head)) + 1;
    return lines.slice(a - 1, endOf(a)).join('\n').replace(head, `const ${name}`); };
  const uni = new Function(grab('const STOCK_UNIVERSE', 'U') + '; return U;')();
  const cat = new Function(`const STOCK_UNIVERSE=${JSON.stringify(uni)};`
    + grab('const STOCK_SEARCH_CATALOG', 'C') + '; return C;')();
  const prio = new Function(grab('const PRIORITY_SECTORS', 'P') + '; return P;')();
  const catSyms = new Set(cat.map((x) => x[1]));

  /* P-A4: Die Katalog-Reserve nuetzt nur so viel, wie im Katalog steht. Genau
     das war der Fehler von v3.15.0 in neuer Form — die Reserve gab es, sie lief
     nur ins Leere. Jeder Prioritaetssektor braucht deshalb einen Pool, der eine
     Rotation ueberhaupt zulaesst. */
  for (const [name, set] of prio) {
    const pool = [...set].filter((x) => catSyms.has(x));
    assert.ok(pool.length >= 5,
      `Sektor "${name}" hat nur ${pool.length} Katalogtitel — die Reserve zieht dann immer dieselben`);
  }
  // Der Katalog ist ein Ansehpfad. Ein Titel daraus ist KEINE Radar-Nominierung.
  assert.match(w, /sectorFillFromCatalog/, 'Katalog-Nachzieher muessen gekennzeichnet sein');
  const reserve = w.slice(w.indexOf('const sectorPick=[]'), w.indexOf('for(const x of radar.rows||[]){if(!picked.has'));
  assert.match(reserve, /if\(took>=SECTOR_RESERVE_PER_SECTOR\) continue;/,
    'Der Katalog darf NUR einspringen, wenn der Radar den Platz nicht gefuellt hat');
  for (const forbidden of ['score', 'light', 'crv', 'buyReady'])
    assert.ok(!reserve.includes(forbidden),
      `Die Sektor-Reserve darf nichts bewerten: "${forbidden}"`);

  // Dollarumsatz: die Groesse, gegen die MOM_MIN_DOLLARVOL prueft, stand nie
  // in der Aufzeichnung. Deshalb liess sich die Schwelle nur raten.
  const payload = w.slice(w.indexOf('function snapshotPayload'), w.indexOf('async function d1StoreRows'));
  assert.match(payload, /dollarVol:/, 'Der Dollarumsatz muss mitgeschrieben werden');
  assert.match(w, /dollarVolCoverage/, 'Der Fuellstand des neuen Feldes muss ausgewiesen werden');
}

console.log('✓ FusionPulse v3.18.0 gate-funnel/calibration/sector-reserve regressions: OK');

/* ═══════════════════════════════════ v3.19.0 · Effizienz-Invarianten ════════
   ANLASS: Der 30-Sekunden-Takt hat fuenf Kacheln vollstaendig neu gebaut, nur
   damit die Frischeplakette altern kann — gemessen 5 innerHTML-Ersetzungen,
   ~18 kB Markup und ~19 neu gebundene Klick-Handler je Takt, bei identischem
   Inhalt. Das kostete nicht nur Rechenzeit: der Neubau hat offene Tooltips,
   Tastaturfokus und die Scrollposition in der Kachel jedes Mal mitgenommen.

   Diese Pruefungen halten die Trennung fest, die das behoben hat. Sie sind
   bewusst als HARTE Aussagen formuliert, nicht als Stilhinweise — ein spaeterer
   Bearbeiter, der `paintPanel` durch `el.innerHTML=` ersetzt, faellt hier auf. */
{
  // 1) Die Plakette darf KEINE Uhrzeit im Markup tragen, sonst ist das Markup
  //    zeitabhaengig und das Memo in paintPanel greift nie.
  const cf = app.slice(app.indexOf('function categoryFreshness('), app.indexOf('function ageFreshness('));
  assert.ok(!/Date\.now\(\)/.test(cf),
    'categoryFreshness darf nicht von der Uhr abhaengen — sonst baut jeder Takt alles neu');
  assert.match(cf, /data-fresh-ts="\$\{t\}"/,
    'Die Plakette muss ihren Zeitstempel als data-fresh-ts tragen');

  // 2) Die Alterung passiert an Ort und Stelle, ohne Knoten zu zerstoeren.
  const af = app.slice(app.indexOf('function ageFreshness('), app.indexOf('function renderExtendedWatch('));
  assert.match(af, /querySelectorAll\('\[data-fresh-ts\]'\)/, 'ageFreshness muss die Plaketten selbst finden');
  assert.ok(!/innerHTML/.test(af), 'ageFreshness darf kein innerHTML schreiben');
  assert.match(af, /ageMin<3\?'green':ageMin<5\?'yellow':ageMin<10\?'orange':'red'/,
    'Die Schwellen der Frischeampel muessen unveraendert bleiben (gruen <3, gelb 3-5, orange 5-10, rot ab 10 Min.)');

  // 3) Das Memo selbst.
  const pp = app.slice(app.indexOf('function paintPanel('), app.indexOf('/* Plakette ohne Uhrzeit'));
  assert.match(pp, /el\.__fpHtml === html/, 'paintPanel muss unveraendertes Markup erkennen');
  assert.match(pp, /return false/, 'paintPanel muss melden, wenn NICHT geschrieben wurde');

  // 4) Klick-Handler duerfen nur an NEUE Knoten. Wird das Markup nicht ersetzt,
  //    haengt sonst bei jedem Takt ein weiterer Handler am selben Knopf und der
  //    Klick loest mehrfach aus — ein Fehler, der erst nach Minuten auffaellt.
  for (const fn of ['renderExtendedWatch', 'renderOpeningPanel', 'renderMarketGainers',
                    'renderSectorLaggards', 'renderEarningsBoard']) {
    const start = app.indexOf(`function ${fn}(`);
    assert.ok(start > 0, `${fn} nicht gefunden`);
    const body = app.slice(start, start + 12000);
    const head = body.slice(0, body.indexOf(`function `, 10) === -1 ? body.length : body.indexOf(`\nfunction `));
    assert.ok(!/\bel\.innerHTML\s*=/.test(head),
      `${fn} darf nicht direkt el.innerHTML schreiben — sonst laeuft der 30-s-Takt wieder voll durch`);
    if (/el\.querySelectorAll\('\[data-openstock\]'\)/.test(head))
      assert.match(head, /if\(wrote\w*\) el\.querySelectorAll\('\[data-openstock\]'\)/,
        `${fn} darf Klick-Handler nur binden, wenn die Knoten neu sind`);
  }

  // 5) Der Takt selbst.
  const tick = app.slice(app.indexOf("if(document.visibilityState!=='visible') return;\n  ageFreshness();") - 400);
  assert.match(tick.slice(0, 900), /ageFreshness\(\);/,
    'Der 30-Sekunden-Takt muss die Plaketten altern lassen');

  // 6) Sekundenuhr: kein Leerlauf im Hintergrund-Tab.
  const clockIdx = app.indexOf('let barclockNode = null;');
  assert.ok(clockIdx > 0, 'Die Sekundenuhr muss ihren Knoten zwischenspeichern');
  assert.match(app.slice(clockIdx, clockIdx + 500), /visibilityState !== 'visible'/,
    'Die Sekundenuhr darf im Hintergrund-Tab nicht weiterlaufen');
}

/* Service Worker: versionierte Assets sind unveraenderlich und muessen aus dem
   Cache kommen. Vorher zog jeder Start ~160 kB (gzip) ueber das Netz. */
{
  const sw = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /url\.searchParams\.get\('v'\) === APP_VERSION/,
    'Der Service Worker muss versionierte Assets cache-first ausliefern');
  assert.match(sw, /if \(url\.pathname\.startsWith\('\/api\/'\)\) return;/,
    'API-Antworten duerfen NIE gecacht werden');
  const cacheFirstIdx = sw.indexOf("url.searchParams.get('v') === APP_VERSION");
  const apiIdx = sw.indexOf("url.pathname.startsWith('/api/')");
  assert.ok(apiIdx < cacheFirstIdx,
    'Die /api/-Sperre muss VOR der Cache-first-Regel stehen, sonst koennte ein Kurs gecacht werden');
  // Die Bindung an APP_VERSION ist der ganze Sicherheitsbeweis: eine neuere
  // Shell fordert ?v=<neu> an, trifft den Vergleich nicht und faellt auf
  // Network-first zurueck. Ein Vergleich gegen "irgendein ?v=" waere unsicher.
  assert.ok(!/searchParams\.has\('v'\)/.test(sw),
    'Cache-first darf nicht auf einen beliebigen ?v=-Parameter reagieren, nur auf die eigene Version');
}

console.log('✓ FusionPulse v3.19.0 render-budget/sw-cache regressions: OK');

/* ═══════════════════════════════════ v3.20.0 · TOP PICKS / Erwartungswert ═══
   Der Befund dahinter (dritter Fall nach v3.8.0 und v3.16.0): jede
   Lernstatistik der App misst Erfolg bei +5 %, die wirtschaftliche Schwelle des
   Nutzers liegt aus den EIGENEN Kostenkonstanten aber bei rund 2 %. Ein Setup,
   das zuverlaessig +2,5 % liefert, galt damit ueberall als Misserfolg.

   Diese Suite prueft die Rechnung AUSGEFUEHRT, nicht per Regex. Grund:
   Abschnitt 11 des Handovers listet sechs Faelle, in denen ein Test durchlief,
   ohne etwas auszusagen. Bei einer Euro-Rechnung waere das besonders teuer. */
{
  const worker = workerText;
  const src = worker.slice(worker.indexOf('const PICK = {'),
                           worker.indexOf('async function topPicks('));
  assert.ok(src.length > 2000, 'Das Top-Picks-Kernmodul muss auffindbar sein');
  const wl = (w, n) => { if (n <= 0) return 0; const z = 1.96, p = w / n;
    const d = 1 + z * z / n, c = p + z * z / (2 * n);
    const m = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n);
    return Math.max(0, (c - m) / d); };
  // v3.21.0: Die Schwellen kommen jetzt aus dem Kostenmodell. Der Test bindet
  // sie GENAU SO wie der Worker sie bildet — sonst prueft er eine andere App.
  const econSrc = worker.slice(worker.indexOf('const PICK_COST = {'),
                               worker.indexOf('const LEGACY_WIN_PCT = 5;') + 26);
  const ECON = new Function(econSrc + '\nreturn {PICK_COST,ECON_NET_EUR,ECON_FIX_EUR,ECON_WIN_PCT,ECON_MIN_REWARD_RISK,ECON_STOP_PCT,PICK_REACH_PCT,LEGACY_WIN_PCT};')();
  assert.equal(ECON.ECON_FIX_EUR, 38, 'Fixkosten muessen 38 EUR sein');
  assert.equal(ECON.ECON_WIN_PCT, 2.04, 'Die gerechnete Erfolgsschwelle muss 2,04 % sein');
  assert.equal(ECON.ECON_STOP_PCT, -1.02, 'Die abgeleitete Stopweite muss -1,02 % sein');
  assert.equal(ECON.PICK_REACH_PCT, ECON.ECON_WIN_PCT,
    'Zeitmessung und Erfolgsschwelle MUESSEN dieselbe Zahl sein — zwei Schwellen waeren genau der behobene Fehler');
  const M = new Function('wilsonLower', 'LEARN_HORIZON_MS', 'ECON_NET_EUR', 'ECON_MIN_REWARD_RISK', 'PICK_COST', src +
    '; return {PICK,PICK_COST,pickCfg,pickCosts,netEurAtMove,lossEurAtStop,requiredMovePct,' +
    'wilsonUpper,pickOutcome,pickExpectancy,breakEvenHitRate,evidenceTier,pickTier,rankPicks,PICK_RANK};')(wl, 180 * 60_000, ECON.ECON_NET_EUR, ECON.ECON_MIN_REWARD_RISK, ECON.PICK_COST);
  // Beide Wege zur selben Zahl: die ausgeschriebene Konstante und die Funktion.
  assert.ok(Math.abs(M.requiredMovePct(ECON.ECON_NET_EUR) - ECON.ECON_WIN_PCT) < 0.005,
    'Die ausgeschriebene Konstante und requiredMovePct muessen uebereinstimmen');

  /* -- 1. Die Kostenrechnung selbst ---------------------------------------- */
  // 10.000 EUR, 2 x 11,50 EUR, 0,15 % Reibung = 23 + 15 = 38 EUR Fixkosten.
  assert.equal(M.pickCosts(), 38, 'Fixkosten eines vollstaendigen Trades muessen 38 EUR sein');
  // Umkehrung und Hinrechnung muessen zueinander passen — sonst ist die ganze
  // Rangfolge auf Sand gebaut.
  for (const target of [30, 120, 250, 500]) {
    const pct = M.requiredMovePct(target);
    assert.ok(Math.abs(M.netEurAtMove(pct) - target) < 0.01,
      `requiredMovePct(${target}) und netEurAtMove muessen invers sein`);
  }
  const req120 = M.requiredMovePct(120);
  assert.ok(req120 > 1.9 && req120 < 2.2,
    `120 EUR netto brauchen ~2,0 % Zielweite, gerechnet wurden ${req120}`);

  /* -- 2. DER KERNBEFUND, als Zahl ----------------------------------------- */
  // Die alte Lernschwelle liegt bei 5 %. Was haette der Nutzer bei 5 % netto
  // verdient — und wie weit ist das von dem entfernt, was er braucht?
  assert.ok(M.requiredMovePct(120) < 5,
    'Die wirtschaftliche Schwelle MUSS unter der alten Lernschwelle von 5 % liegen — sonst gaebe es diesen Befund nicht');
  const net5 = M.netEurAtMove(5);
  assert.ok(net5 > 330,
    `Bei +5 % waeren es ~${Math.round(net5)} EUR netto — die alte Schwelle verlangte also fast das Dreifache des Ziels`);

  /* -- 3. Reihenfolge ist NICHT aufgezeichnet: die pessimistische Lesart ---- */
  // Eine Episode, die BEIDES beruehrt hat, muss als ausgestoppt zaehlen.
  const beides = [{ max_pct: 4, min_pct: -1.5, ts: 0, reach_ts: 0 }];
  const o1 = M.pickOutcome(beides, 2, -1);
  assert.equal(o1.hit, 0, 'Eine Episode, die auch den Stop gerissen hat, darf NICHT als Treffer zaehlen');
  assert.equal(o1.stopped, 1, 'Sie muss als ausgestoppt zaehlen');
  assert.equal(o1.ambiguous, 1, 'Und der Unsicherheitsanteil muss ausgewiesen werden');

  /* -- 3b. ZWEITER BEFUND: die Stopweite folgt aus dem Ziel ---------------- */
  // Bei Ziel 2,035 % und Stop -2 % braucht es 66,5 % Trefferquote. Die gibt es
  // im Intraday-Momentum nicht. Deshalb MUSS der Stop abgeleitet werden.
  const zielPct = M.requiredMovePct(120);
  assert.ok(M.breakEvenHitRate(zielPct, -2) > 0.65,
    'Mit einem 2-%-Stop muss die noetige Trefferquote ueber 65 % liegen — das ist der Befund');
  const maxStop = zielPct / M.PICK.MIN_REWARD_RISK;
  assert.ok(maxStop > 0.99 && maxStop < 1.05,
    `Der maximal zulaessige Stop muss bei ~1,02 % liegen, war ${maxStop}`);
  assert.ok(M.breakEvenHitRate(zielPct, -maxStop) < 0.55,
    'Am abgeleiteten Stop muss die noetige Trefferquote unter 55 % fallen');
  // Und die Ableitung muss monoton sein: engerer Stop -> niedrigere Huerde.
  let prev = 1;
  for (const st of [2, 1.5, 1.0, 0.75, 0.5]) {
    const be = M.breakEvenHitRate(zielPct, -st);
    assert.ok(be < prev, `Ein engerer Stop muss die noetige Trefferquote senken (${st} %)`);
    prev = be;
  }

  /* -- 4. Der Fall, den die alte Schwelle verworfen hat --------------------- */
  // 30 Episoden: 20 erreichten +2,6 % ohne den (abgeleiteten) 1,02-%-Stop zu
  // reissen, 10 wurden ausgestoppt. Bei 5 % Schwelle: 0 Treffer -> "wertlos".
  const t0 = 1_700_000_000_000;
  /* Die Groesse dieser Stichprobe ist selbst eine Aussage: bei 30 Episoden und
     67 % beobachteter Trefferquote liegt die Wilson-Untergrenze bei 48,8 % und
     damit UNTER der Break-even-Quote von 53,5 % — der Erwartungswert bleibt
     negativ. Erst rund 60 Episoden bei 75 % tragen. Das ist keine Schwaeche des
     Tests, sondern die ehrliche Antwort auf "ab wann weiss die App etwas". */
  const realistisch = [
    ...Array.from({ length: 45 }, (_, i) => ({ symbol: `A${i}`, ts: t0, reach_ts: t0 + 45 * 60_000, max_pct: 2.6, min_pct: -0.6 })),
    ...Array.from({ length: 15 }, (_, i) => ({ symbol: `B${i}`, ts: t0, reach_ts: null, max_pct: 0.4, min_pct: -1.4 })),
  ];
  const oNeu = M.pickOutcome(realistisch, zielPct, -maxStop);
  const oAlt = M.pickOutcome(realistisch, 5, -maxStop);
  assert.equal(oNeu.hit, 45, 'An der wirtschaftlichen Schwelle muessen 45 Treffer stehen');
  assert.equal(oAlt.hit, 0, 'An der alten 5-%-Schwelle stehen dieselben 45 Episoden als NULL Treffer — das ist der Befund');
  assert.equal(oNeu.medianMinutes, 45, 'Die Haltedauer bis zum Ziel muss aus reach_ts kommen');

  const eNeu = M.pickExpectancy(oNeu, zielPct, -maxStop);
  assert.ok(eNeu.evEur > 0, `Dieses Muster muss einen positiven Erwartungswert haben, war ${eNeu.evEur} EUR`);
  /* WICHTIG fuer den naechsten Bearbeiter — hier hatte mein erster Test ein Loch:
     Solange jede Episode entweder Treffer ODER Stop ist, gilt exakt
     wilsonLower(h,n) + wilsonUpper(n-h,n) = 1. Die Kuerzungsregel in
     pickExpectancy stellt dieselbe Zahl dann von selbst wieder her — ein Test
     auf diesem Datensatz kann eine entfernte Wilson-Untergrenze NICHT bemerken.
     Die Vorsicht muss deshalb an einem Datensatz MIT flat-Episoden geprueft
     werden, wo die Kuerzung nicht greift. */
  const mitFlat = [
    ...Array.from({ length: 30 }, (_, i) => ({ symbol: `E${i}`, ts: t0, reach_ts: t0 + 60_000, max_pct: 3, min_pct: -0.3 })),
    ...Array.from({ length: 10 }, (_, i) => ({ symbol: `F${i}`, ts: t0, max_pct: 0.3, min_pct: -1.5 })),
    ...Array.from({ length: 20 }, (_, i) => ({ symbol: `G${i}`, ts: t0, max_pct: 0.9, min_pct: -0.4 })),
  ];
  const oFlat = M.pickOutcome(mitFlat, 2, -1);
  assert.equal(oFlat.flat, 20, 'Episoden ohne Ziel und ohne Stop muessen als flat zaehlen');
  const eFlat = M.pickExpectancy(oFlat, 2, -1);
  assert.ok(eFlat.pHit < eFlat.pointHit - 5,
    `Die Wilson-Untergrenze muss deutlich unter der Punktschaetzung liegen (${eFlat.pHit} vs ${eFlat.pointHit})`);
  // Und flat darf nicht gratis sein: die Fixkosten fallen trotzdem an.
  assert.ok(eFlat.evEur < Math.round(eFlat.pHit / 100 * eFlat.winEur - eFlat.pStop / 100 * eFlat.lossEur),
    'Ergebnislose Episoden muessen die Fixkosten weiterhin abziehen');

  /* -- 5. Vorsicht bei kleiner Stichprobe ---------------------------------- */
  // 3 von 3 Treffern duerfen nicht wie ein sicherer Gewinn aussehen.
  const winzig = Array.from({ length: 3 }, (_, i) => ({ symbol: `C${i}`, ts: t0, reach_ts: t0 + 60_000, max_pct: 6, min_pct: -0.2 }));
  const eWinzig = M.pickExpectancy(M.pickOutcome(winzig, 2, -1), 2, -1);
  assert.ok(eWinzig.pHit <= 45,
    `3 von 3 duerfen hoechstens ~44 % Trefferquote ergeben, waren ${eWinzig.pHit} %`);
  assert.equal(M.evidenceTier(3), 'unbelegt', '3 Episoden sind unbelegt');
  assert.equal(M.evidenceTier(10), 'duenn', '10 Episoden sind duenn');
  assert.equal(M.evidenceTier(20), 'belegt', '20 Episoden sind belegt');

  /* -- 6. Die beiden Schranken duerfen sich nicht widersprechen ------------ */
  assert.ok(M.wilsonUpper(1, 5) > wl(1, 5), 'Obergrenze muss ueber der Untergrenze liegen');
  assert.equal(M.wilsonUpper(0, 0), 1, 'Ohne Daten ist die Stopquote-Obergrenze 1 — maximal vorsichtig');
  assert.equal(wl(0, 0), 0, 'Ohne Daten ist die Trefferquote-Untergrenze 0');
  // Gegenprobe zur Fail-Closed-Idee: mehr Unsicherheit darf den Erwartungswert
  // nur SENKEN, nie heben.
  const viele = Array.from({ length: 60 }, (_, i) => ({ symbol: `D${i}`, ts: t0, reach_ts: t0 + 60_000, max_pct: i < 40 ? 3 : 0.2, min_pct: i < 40 ? -0.5 : -1.5 }));
  const quote = (a) => { const o = M.pickOutcome(a, 2, -1); return o.hit / o.n; };
  // Gleiche QUOTE (2/3), kleinere Stichprobe — nicht einfach die ersten sechs,
  // das waeren nur Gewinner gewesen und der Test haette nichts gezeigt.
  const wenige = [...viele.slice(0, 6), ...viele.slice(40, 43)];
  const evViele = M.pickExpectancy(M.pickOutcome(viele, 2, -1), 2, -1).evEur;
  const evWenige = M.pickExpectancy(M.pickOutcome(wenige, 2, -1), 2, -1).evEur;
  assert.ok(Math.abs(quote(viele) - quote(wenige)) < 0.02,
    'Beide Stichproben muessen DIESELBE Trefferquote haben, sonst misst der Vergleich etwas anderes');
  assert.ok(evWenige < evViele,
    `Dieselbe Quote bei kleinerer Stichprobe muss einen NIEDRIGEREN Erwartungswert ergeben (${evWenige} vs ${evViele})`);

  /* -- 7. FAIL-CLOSED IN DER RANGFOLGE ------------------------------------- */
  // Ein unbelegter Kandidat mit maximalem Live-Score darf einen belegten
  // positiven Kandidaten mit minimalem Live-Score NIE ueberholen.
  const geordnet = M.rankPicks([
    { symbol: 'LAUT', tier: 'unbelegt', evEur: null, liveScore: 99, rank: M.pickTier('unbelegt', null) },
    { symbol: 'BELEGT', tier: 'belegt', evEur: 12, liveScore: 3, rank: M.pickTier('belegt', 12) },
    { symbol: 'DUENN', tier: 'duenn', evEur: 80, liveScore: 50, rank: M.pickTier('duenn', 80) },
    { symbol: 'NEGATIV', tier: 'belegt', evEur: -40, liveScore: 95, rank: M.pickTier('belegt', -40) },
  ]).map((x) => x.symbol);
  assert.deepEqual(geordnet, ['BELEGT', 'DUENN', 'LAUT', 'NEGATIV'],
    'Rangfolge muss sein: belegt-positiv, duenn-positiv, unbelegt, belegt-negativ');

  // Und die Kernregel noch einmal einzeln, damit sie nicht mit der Liste kippt:
  assert.ok(M.PICK_RANK.belegtPositiv < M.PICK_RANK.unbelegt,
    'Fehlende Belege duerfen einen Kandidaten NIE nach oben bringen');
  assert.ok(M.PICK_RANK.unbelegt < M.PICK_RANK.belegtNegativ,
    'Ein belegt schlechter Kandidat gehoert unter einen unbewerteten — Wissen schlaegt Nichtwissen in BEIDE Richtungen');

  /* -- 7b. Die Stopweite muss im Aufruf ABGELEITET werden ------------------ */
  // Ohne diese Pruefung koennte jemand maxStopPct wieder auf eine feste Zahl
  // setzen, und alle Rechnungen oben blieben trotzdem gruen.
  assert.match(worker, /const maxStopPct = targetPct \/ PICK\.MIN_REWARD_RISK;/,
    'topPicks muss die Stopweite aus dem Ziel ableiten, nicht festschreiben');
  assert.match(worker, /const stopPct = -Math\.min\(maxStopPct,/,
    'Ein vom Nutzer gewuenschter Stop darf den abgeleiteten Hoechstwert nicht ueberschreiten');

  /* -- 8. Das Modul darf nichts bewerten ----------------------------------- */
  const mod = sliceFn(worker, 'async function topPicks(');
  assert.match(mod, /buyWeight: 0/, 'Top Picks muessen 0 % BUY-Gewicht ausweisen');
  for (const verboten of ['light:', 'crv:', 'buyReady', 'score:'])
    assert.ok(!mod.includes(verboten),
      `Top Picks duerfen keine Bewertungsgroesse setzen: "${verboten}"`);

  /* -- 9. reach_ts: die Zeitmessung darf nicht an der 5-%-Schwelle haengen -- */
  assert.match(worker, /const PICK_REACH_PCT = ECON_WIN_PCT;/,
    'Die Haltedauer muss an DERSELBEN Schwelle gemessen werden wie der Erfolg');
  assert.doesNotMatch(worker, /WIN_PCT: 5,/,
    'Die hart gesetzte 5-%-Schwelle darf nirgends mehr steuern');
  assert.match(worker, /reach_ts=COALESCE\(reach_ts,\?\)/,
    'Der Aufloeser muss reach_ts mitschreiben');
  assert.match(worker, /ADD COLUMN reach_ts INTEGER/,
    'Bestehende Produktions-D1 muessen die Spalte nachgezogen bekommen');
}

console.log('✓ FusionPulse v3.20.0 top-picks/expectancy regressions: OK');

/* ══════════════════════ v3.21.0 · Hitze, Urteil, Rastersuche ════════════════
   Was diese Version hinzufuegt, ist nicht "noch eine Kennzahl", sondern eine
   URSACHENTRENNUNG. Ein Situationstyp kann aus zwei gegensaetzlichen Gruenden
   nichts einbringen:
     A) er bewegt sich nicht weit genug -> anderer Kandidatenkreis noetig
     B) er bewegt sich, schuettelt aber vorher heraus -> anderer Stop/Einstieg
   Vorher waren beide als "Erwartungswert negativ" ununterscheidbar. Die Tests
   unten pruefen, dass die Trennung wirklich traegt — mit Fixtures, die sich
   NUR in diesem einen Punkt unterscheiden. */
{
  const worker = workerText;
  const econSrc = worker.slice(worker.indexOf('const PICK_COST = {'),
                               worker.indexOf('const LEGACY_WIN_PCT = 5;') + 26);
  const core = worker.slice(worker.indexOf('const PICK = {'),
    worker.indexOf('/* ---------------------------------------------------------------------------\n   v3.21.0 · DIE ZWEI FRAGEN'));
  const diag = worker.slice(worker.indexOf('/* ---------------------------------------------------------------------------\n   v3.21.0 · DIE ZWEI FRAGEN'),
    worker.indexOf('/* ---------------------------------------------------------------------------\n   Auswertung: Situationstypen'));
  assert.ok(diag.length > 2000, 'Der Diagnoseblock muss auffindbar sein');
  const wl = (w, n) => { if (n <= 0) return 0; const z = 1.96, p = w / n;
    const d = 1 + z * z / n, c = p + z * z / (2 * n);
    const m = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n);
    return Math.max(0, (c - m) / d); };
  const r1 = (x) => Math.round(x * 10) / 10, r2 = (x) => Math.round(x * 100) / 100;
  const D = new Function('wilsonLower', 'LEARN_HORIZON_MS', 'r1', 'r2',
    econSrc + core + diag +
    ';return {PICK,GRID,pickCfg,pickOutcome,pickExpectancy,heatProfile,pickVerdict,optimizeGrid,quantile,netEurAtMove,lossEurAtStop,ECON_WIN_PCT};'
  )(wl, 180 * 60_000, r1, r2);

  const cfg = D.pickCfg(), TARGET = D.ECON_WIN_PCT, MAXSTOP = TARGET / 2;
  const t0 = 1_700_000_000_000, H = 3_600_000;

  /* -- 1. mae_pre MUSS die Entscheidung erreichen -------------------------- */
  // Derselbe Gewinner, einmal mit gemessener Vor-Hitze, einmal ohne.
  // min_pct enthaelt auch den Absturz NACH dem Ziel — er darf nicht zaehlen.
  const gewinnerMitRuecklauf = [{ symbol: 'X', ts: t0, max_pct: 3.0, min_pct: -5.0, mae_pre: -0.4 }];
  assert.equal(D.pickOutcome(gewinnerMitRuecklauf, TARGET, -MAXSTOP).hit, 1,
    'Ein Gewinner darf nicht am Rueckgang NACH dem Ziel scheitern — dafuer gibt es mae_pre');
  assert.equal(D.pickOutcome(gewinnerMitRuecklauf, TARGET, -MAXSTOP, { strictHeat: true }).hit, 0,
    'Mit strictHeat muss dieselbe Episode am Fensterminimum scheitern — sonst wirkt mae_pre gar nicht');
  const ohneMessung = [{ symbol: 'X', ts: t0, max_pct: 3.0, min_pct: -5.0 }];
  assert.equal(D.pickOutcome(ohneMessung, TARGET, -MAXSTOP).hit, 0,
    'Fehlt mae_pre, muss auf die pessimistische Variante zurueckgefallen werden — fail-closed');
  assert.equal(D.pickOutcome(gewinnerMitRuecklauf, TARGET, -MAXSTOP).heatMeasuredN, 1,
    'Der Anteil gemessener Gegenbewegung muss ausgewiesen werden');

  /* -- 2. Die Ursachentrennung ---------------------------------------------- */
  // Zwei Fixtures, die sich AUSSCHLIESSLICH in der Vor-Hitze unterscheiden.
  const mk = (n, winEvery, mfe, heat, tag) => Array.from({ length: n }, (_, i) => {
    const win = i % winEvery !== 0;
    return { symbol: `${tag}${i}`, ts: t0 + i * H,
      max_pct: win ? mfe : 0.5, min_pct: -(heat + 1), mae_pre: win ? -heat : -(heat + 1),
      reach_ts: win ? t0 + i * H + 40 * 60_000 : null };
  });
  const traege  = mk(60, 1, 0.9, 0.4, 'T');          // bewegt sich nie weit genug
  const laut    = mk(60, 3, 4.2, 1.9, 'L');          // bewegt sich, aber 1,9 % Hitze
  const sauber  = mk(60, 3, 4.2, 0.5, 'S');          // gleiche Bewegung, 0,5 % Hitze

  const urteil = (eps) => { const o = D.pickOutcome(eps, TARGET, -MAXSTOP);
    const h = D.heatProfile(eps, TARGET);
    return D.pickVerdict({ n: o.n, hit: o.hit, heat: h, targetPct: TARGET, maxStopPct: MAXSTOP, minSample: 20 }).verdict; };

  assert.equal(urteil(traege), 'bewegt sich nicht weit genug',
    'Ein Typ ohne ausreichende Bewegung muss als solcher benannt werden');
  assert.equal(urteil(laut), 'zu verrauscht fuer diese Positionsgroesse',
    'Ein Typ, der sich bewegt und herausschuettelt, ist ein ANDERES Problem — und muss anders heissen');
  assert.equal(urteil(sauber), 'handelbar',
    'Dieselbe Bewegung mit wenig Gegenbewegung muss handelbar sein');
  // Der entscheidende Beweis: laut und sauber unterscheiden sich NUR in der Hitze.
  assert.equal(D.pickOutcome(laut, TARGET, -MAXSTOP).n, D.pickOutcome(sauber, TARGET, -MAXSTOP).n);
  assert.equal(D.heatProfile(laut, TARGET).winners, D.heatProfile(sauber, TARGET).winners,
    'Beide Fixtures muessen gleich viele Zielberuehrungen haben — sonst misst der Vergleich etwas anderes');

  /* -- 3. Der Stopabstand fuer 80 % der Gewinner --------------------------- */
  const hLaut = D.heatProfile(laut, TARGET);
  assert.equal(hLaut.heatSource, 'gemessen', 'Bei genug mae_pre-Werten muss "gemessen" ausgewiesen werden');
  assert.ok(hLaut.stopFor80 > MAXSTOP,
    `Die noetige Luft (${hLaut.stopFor80} %) muss ueber dem erlaubten Stop (${r2(MAXSTOP)} %) liegen — das IST die Aussage`);
  assert.equal(D.heatProfile(ohneMessung.concat(ohneMessung), 2.0).heatSource, 'Obergrenze',
    'Ohne gemessene Werte muss die Herkunft als Obergrenze gekennzeichnet sein');

  /* -- 4. Rastersuche: findet sie das bessere Paar? ------------------------ */
  // Bewegung bis 3,4 % bei 0,6 % Hitze. Das Kostenmodell-Paar (2,04/1,02) ist
  // zulaessig, aber nicht optimal — ein weiteres Ziel bringt mehr.
  const gut = Array.from({ length: 240 }, (_, i) => {
    const win = i % 5 < 3;
    return { symbol: `G${i}`, ts: t0 + i * H, max_pct: win ? 3.4 : 0.4,
      min_pct: -1.6, mae_pre: win ? -0.6 : -1.6, reach_ts: win ? t0 + i * H + 35 * 60_000 : null };
  });
  const g = D.optimizeGrid(gut, TARGET, cfg);
  assert.ok(g.available, `Die Rastersuche muss bei 240 Episoden anlaufen: ${g.reason || ''}`);
  assert.ok(g.gridPoints > 100, 'Der Suchraum muss mehr als hundert Paare umfassen');
  assert.ok(g.targetPct > TARGET,
    `Bei 3,4 % Bewegung muss ein weiteres Ziel als ${r2(TARGET)} % gefunden werden, war ${g.targetPct} %`);
  assert.ok(Math.abs(g.stopPct) <= g.targetPct / 2 + 1e-9,
    'Das gefundene Paar muss das Ziel-Stop-Verhaeltnis einhalten');
  const fix = D.pickExpectancy(D.pickOutcome(gut, TARGET, -MAXSTOP), TARGET, -MAXSTOP, cfg);
  assert.ok(g.evOos > fix.evEur,
    `Das gesuchte Paar muss besser sein als das Kostenmodell-Paar (${g.evOos} vs ${fix.evEur})`);
  assert.ok(!g.overfit, `Ein sauberer, gleichverteilter Datensatz darf nicht als ueberangepasst gelten: ${g.note}`);

  /* -- 5. Die Ueberanpassungs-Bremse muss WIRKLICH bremsen ----------------- */
  // Datensatz mit Bruch: die erste Haelfte laeuft, die zweite nicht.
  const bruch = Array.from({ length: 240 }, (_, i) => {
    const win = i < 168 ? i % 5 < 4 : i % 20 === 0;
    return { symbol: `B${i}`, ts: t0 + i * H, max_pct: win ? 3.6 : 0.3,
      min_pct: -1.6, mae_pre: win ? -0.5 : -1.6, reach_ts: win ? t0 + i * H + 30 * 60_000 : null };
  });
  const gb = D.optimizeGrid(bruch, TARGET, cfg);
  assert.ok(gb.available, 'Auch der Bruch-Datensatz muss ausgewertet werden');
  assert.ok(gb.overfit,
    `Ein Datensatz, dessen zweite Haelfte nicht mehr laeuft, MUSS als ueberangepasst auffallen (Abstand ${gb.drop} EUR, Grenze ${gb.overfitLimit} EUR)`);

  /* -- 6. Vergleich nur bei GLEICHER Rechenart ----------------------------- */
  // Der Fehler meines ersten Entwurfs: Punktschaetzung im Suchteil gegen
  // Wilson-Untergrenze im Nachweisteil. Dann sieht alles ueberangepasst aus.
  assert.ok(typeof g.evOosPoint === 'number',
    'Fuer den Ueberanpassungsvergleich muss ein Punktwert des Nachweisteils vorliegen');
  assert.equal(g.drop, Math.round(g.evIn - g.evOosPoint),
    'Der Abstand MUSS aus zwei Punktschaetzungen gebildet werden, nicht aus verschiedenen Schaetzarten');
  assert.ok(g.evOos <= g.evOosPoint,
    'Die vorsichtige Schaetzung darf nie ueber der Punktschaetzung liegen');

  /* -- 7. Die Rauschgrenze muss mit der Stichprobe atmen ------------------- */
  assert.ok(g.overfitLimit >= D.GRID.OVERFIT_DROP_EUR,
    'Die feste Untergrenze muss erhalten bleiben');
  assert.ok(g.seEur > 0, 'Der Standardfehler des Nachweisteils muss beziffert werden');
  assert.match(worker, /1\.5 \* seEur/,
    'Die Ueberanpassungsgrenze muss am Stichprobenrauschen haengen, nicht an einer festen Zahl');

  /* -- 8. Rundung vor der Auswertung --------------------------------------- */
  // Sonst sucht das Raster mit 1,7999999 und prueft mit 1,80 — genau an der
  // Grenze kippt das Ergebnis. Der Fehler war real und hat einen tragfaehigen
  // Fall faelschlich als ueberangepasst ausgewiesen.
  assert.match(worker, /const tR = r2\(t\), stR = r2\(st\);/,
    'Ziel und Stop muessen VOR der Auswertung gerundet werden');
  assert.equal(g.targetPct, r2(g.targetPct), 'Das Ziel muss auf zwei Stellen gerundet sein');
  assert.equal(g.stopPct, r2(g.stopPct), 'Der Stop muss auf zwei Stellen gerundet sein');

  /* -- 9. Ein ueberangepasstes Paar darf nicht ranken ---------------------- */
  const mod = sliceFn(worker, 'async function topPicks(');
  assert.match(mod, /evBest: grid\.available && !grid\.overfit \? grid\.evFull : null/,
    'Nur ein im Nachweisteil bestaetigtes Paar darf in die Rangfolge eingehen');
  /* v3.22.0: geschaetzt wird nach bestandener Pruefung auf ALLEN Episoden.
     Die Reihenfolge Suchen -> Bestaetigen -> Schaetzen muss erhalten bleiben;
     ein `evFull` ohne vorherige `overfit`-Pruefung waere Selbstbetrug. */
  assert.match(worker, /const oFull = pickOutcome\(eps, best\.targetPct, best\.stopPct\);/,
    'Nach der Bestaetigung muss auf allen Episoden nachgerechnet werden');
  const overfitIdx = worker.indexOf('const overfitLimit = Math.max(GRID.OVERFIT_DROP_EUR');
  const fullIdx = worker.indexOf('const oFull = pickOutcome(eps, best.targetPct');
  assert.ok(overfitIdx > 0 && fullIdx > overfitIdx,
    'Die Ueberanpassungspruefung muss VOR der Nachrechnung stehen');
  assert.match(mod, /const useGrid = evGrid != null && \(evFix == null \|\| evGrid > evFix\)/,
    'Genommen werden muss der bessere der beiden Plaene, nicht blind der gesuchte');
}

console.log('✓ FusionPulse v3.21.0 heat/verdict/grid regressions: OK');

/* ═════════════════ v3.22.0 · Tempo, Kostenlast, Bereichstrennung ════════════
   ANLASS (Nutzerfrage): "Ist die Arithmetik so, wie du sie gestalten wuerdest,
   um SCHNELL Geld zu verdienen?" Nein — bis v3.21.0 wurde der Erwartungswert
   JE TRADE optimiert. Ertrag je ZEIT ist eine andere Groesse, und nach der war
   gefragt. Ein Setup mit +40 EUR dreimal taeglich schlaegt eines mit +80 EUR
   pro Woche um den Faktor zehn. */
{
  const worker = workerText;
  const idx = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
  const econSrc = worker.slice(worker.indexOf('const PICK_COST = {'),
                               worker.indexOf('const LEGACY_WIN_PCT = 5;') + 26);
  const core = worker.slice(worker.indexOf('const PICK = {'),
    worker.indexOf('/* ---------------------------------------------------------------------------\n   v3.21.0 · DIE ZWEI FRAGEN'));
  const diag = worker.slice(worker.indexOf('/* ---------------------------------------------------------------------------\n   v3.21.0 · DIE ZWEI FRAGEN'),
    worker.indexOf('/* ---------------------------------------------------------------------------\n   Auswertung: Situationstypen'));
  const wl = (w, n) => { if (n <= 0) return 0; const z = 1.96, p = w / n;
    const d = 1 + z * z / n, c = p + z * z / (2 * n);
    const m = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n);
    return Math.max(0, (c - m) / d); };
  const r1 = (x) => Math.round(x * 10) / 10, r2 = (x) => Math.round(x * 100) / 100;
  const T = new Function('wilsonLower', 'LEARN_HORIZON_MS', 'r1', 'r2',
    econSrc + core + diag +
    ';return {TEMPO,PICK,pickCfg,tempoOf,costLoadPct,rankPicks,pickTier,netEurAtMove,lossEurAtStop,ECON_WIN_PCT};'
  )(wl, 180 * 60_000, r1, r2);
  const cfg = T.pickCfg();

  /* -- 1. Kostenlast: warum kleine Ziele die schlechtesten sind ------------ */
  // 38 EUR Fixkosten fressen bei 2 % Zielweite fast ein Fuenftel des Brutto,
  // bei 6 % nur noch ein Sechzehntel. Die Mindestzielweite ist ein BODEN.
  const l2 = T.costLoadPct(2.04, cfg), l6 = T.costLoadPct(6, cfg);
  assert.ok(l2 > 18 && l2 < 19, `Kostenlast bei 2,04 % muss ~18,6 % sein, war ${l2}`);
  assert.ok(l6 < 7, `Kostenlast bei 6 % muss unter 7 % liegen, war ${l6}`);
  assert.ok(l2 > l6 * 2, 'Die Kostenlast muss mit kleinerem Ziel deutlich steigen');
  // Und die Folge davon: die noetige Trefferquote SINKT mit groesserem Ziel.
  const be = (t) => { const s = t / 2, w = T.netEurAtMove(t, cfg), lo = T.lossEurAtStop(-s, cfg);
    return lo / (w + lo); };
  let prev = 1;
  for (const t of [1.5, 2.04, 3, 4, 6]) {
    const q = be(t);
    assert.ok(q < prev, `Ein groesseres Ziel muss die noetige Trefferquote senken (${t} %)`);
    prev = q;
  }
  assert.ok(be(1.5) > 0.57 && be(6) < 0.46,
    'Der Unterschied muss gross sein: ~58 % bei 1,5 % Ziel gegen ~45 % bei 6 %');

  /* -- 2. Ertrag je Handelstag --------------------------------------------- */
  const eps = (n) => Array.from({ length: n }, (_, i) => ({ symbol: `X${i}`, ts: i }));
  const haeufig = T.tempoOf(eps(63), 21, 40, 30);   // 3x taeglich, 40 EUR, 30 Min
  const selten  = T.tempoOf(eps(4),  21, 80, 30);   // 0,19x taeglich, 80 EUR
  assert.equal(haeufig.evPerDay, 120, 'Drei Gelegenheiten zu 40 EUR sind 120 EUR je Handelstag');
  assert.ok(selten.evPerDay < 20, 'Ein seltenes Setup darf trotz hoeherem Einzelwert nicht vorn liegen');
  assert.ok(haeufig.evPerDay > selten.evPerDay * 5,
    'Genau das ist der Punkt: haeufig und klein schlaegt selten und gross');
  assert.equal(haeufig.evPerHour, 80, '40 EUR in 30 Minuten sind 80 EUR je Stunde Kapitalbindung');

  /* -- 3. Der Deckel ist keine Kosmetik ------------------------------------ */
  // Ohne ihn wuerde ein sehr haeufiges, schwaches Setup rechnerisch gewinnen,
  // obwohl sich so viele Positionen mit einem Fixeinsatz nicht halten lassen.
  const sehrHaeufig = T.tempoOf(eps(210), 21, 10, 30);  // 10x taeglich
  assert.equal(sehrHaeufig.perDay, 10, 'Die gemessene Haeufigkeit muss ehrlich ausgewiesen werden');
  assert.equal(sehrHaeufig.perDayUsed, T.TEMPO.MAX_TRADES_PER_DAY,
    'Gerechnet werden darf nur mit der ausfuehrbaren Zahl');
  assert.ok(sehrHaeufig.capped, 'Die Deckelung muss als solche gekennzeichnet sein');
  assert.equal(sehrHaeufig.evPerDay, 10 * T.TEMPO.MAX_TRADES_PER_DAY,
    'Der Deckel muss wirklich greifen');

  /* -- 4. Keine Frequenzaussage bei zu kurzem Fenster ---------------------- */
  const kurz = T.tempoOf(eps(20), 3, 50, 30);
  assert.equal(kurz.evPerDay, null, 'Unter fuenf Handelstagen darf keine Haeufigkeit behauptet werden');
  assert.match(kurz.tempoNote, /geraten/, 'Und es muss dabeistehen, warum nicht');

  /* -- 5. Rangfolge: Euro je Tag schlaegt Euro je Trade -------------------- */
  const ranked = T.rankPicks([
    { symbol: 'GROSS', tier: 'belegt', evEur: 90, evPerDay: 30, rank: T.pickTier('belegt', 90) },
    { symbol: 'HAEUFIG', tier: 'belegt', evEur: 35, evPerDay: 105, rank: T.pickTier('belegt', 35) },
  ]).map((x) => x.symbol);
  assert.deepEqual(ranked, ['HAEUFIG', 'GROSS'],
    'Sortiert werden muss nach Ertrag je Handelstag, nicht je Trade');
  // Fail-closed bleibt: fehlende Frequenz darf nicht nach oben helfen.
  const mitLuecke = T.rankPicks([
    { symbol: 'OHNE', tier: 'belegt', evEur: 200, evPerDay: null, rank: T.pickTier('belegt', 200) },
    { symbol: 'MIT', tier: 'belegt', evEur: 20, evPerDay: 60, rank: T.pickTier('belegt', 20) },
  ]).map((x) => x.symbol);
  assert.deepEqual(mitLuecke, ['MIT', 'OHNE'],
    'Ein Kandidat OHNE Frequenzangabe darf einen MIT nie ueberholen — sonst hilft Nichtwissen wieder nach oben');
  // Und die Stufenordnung aus v3.20.0 muss ueber allem stehen.
  const stufen = T.rankPicks([
    { symbol: 'UNBELEGT', tier: 'unbelegt', evEur: null, evPerDay: null, liveScore: 99, rank: T.pickTier('unbelegt', null) },
    { symbol: 'BELEGT', tier: 'belegt', evEur: 5, evPerDay: 5, rank: T.pickTier('belegt', 5) },
  ]).map((x) => x.symbol);
  assert.deepEqual(stufen, ['BELEGT', 'UNBELEGT'],
    'Die Beleg-Stufe muss weiterhin VOR jeder Tempo-Sortierung greifen');

  /* -- 6. Bereichstrennung und Kachelfarben -------------------------------- */
  assert.match(idx, /id="bandCoin" class="domain-band" data-domain="coin"/, 'Der Kryptobereich muss ausgewiesen sein');
  assert.match(idx, /id="bandStock" class="domain-band" data-domain="stock"/, 'Der Aktienbereich muss ausgewiesen sein');
  assert.match(idx, /id="bandLab" class="domain-band" data-domain="lab"/, 'Der Auswertungsbereich muss ausgewiesen sein');
  assert.match(css, /\[data-domain="coin"\]\{ --domain:var\(--domain-coin\); \}/,
    'Die Bereichsfarbe muss ueber eine CSS-Variable laufen, damit sie einstellbar ist');
  // Jede faerbbare Kachel braucht BEIDES: den Schluessel im Code und den Haken
  // im HTML. Fehlt eines, ist die Einstellung wirkungslos — genau der Zustand,
  // den der Nutzer als "wurde nie umgesetzt" erlebt hat.
  const tintKeys = [...app.matchAll(/^\s*\['([a-zA-Z]+)','[^']*'\],?$/gm)].map((m) => m[1]);
  /* Frueher lief diese Schleife ueber eine HANDGEPFLEGTE Liste, waehrend
     `tintKeys` berechnet und nie benutzt wurde. Jede spaeter hinzugefuegte
     Kachel war damit ungeprueft — v3.29.0 hat genau so zwei Kacheln ohne eine
     einzige CSS-Regel in die App bekommen. Geprueft wird jetzt, was
     REGISTRIERT ist, nicht was jemand daran gedacht hat einzutragen. */
  assert.ok(tintKeys.length >= 12,
    `Die Kachelliste muss gefunden werden, sonst prueft die Schleife nichts. Gefunden: ${tintKeys.length}`);
  for (const key of ['topPicks', 'gainers', 'opening', 'extended', 'laggards',
                     'earnings', 'cryptoMovers', 'sentiment', 'gate', 'portfolio'])
    assert.ok(tintKeys.includes(key), `Kachelton "${key}" muss in TINTABLE_TILES stehen`);
  for (const key of tintKeys) {
    /* Manche Kacheln haengen an `data-tile`, andere an einer Klasse
       (`.learning-report`, `.sf-grid`). Beides ist zulaessig — die Frage ist
       nicht WIE, sondern OB die Einstellung ueberhaupt irgendwo ankommt.
       Deshalb wird geprueft, dass die Farbvariable von einer Regel VERBRAUCHT
       wird. Ein Kachelton, den kein `var(--tint-…)` liest, ist ein Regler
       ohne Draht. */
    assert.ok(css.includes(`--tint-${key}`),
      `Kachelton "${key}" ist registriert, wird aber von keiner CSS-Regel gelesen — der Regler haette keine Wirkung`);
  }
  // Ampelfarben bleiben gesperrt (der Fehler aus v3.14.6 darf nicht per
  // Einstellung wiederherstellbar sein).
  assert.match(app, /const RESERVED_TINTS=new Set\(\['#13cf8b','#f2c015','#ef4f57','#ff8a3d'\]\)/,
    'Die Ampelfarben muessen als Kachelton gesperrt bleiben');
  for (const [, choice] of [...app.matchAll(/\['(#[0-9a-f]{6})','[A-ZÄÖÜ][a-zäöüß]+'\]/g)].map((m) => [0, m[1]]))
    assert.ok(!['#13cf8b', '#f2c015', '#ef4f57', '#ff8a3d'].includes(choice),
      `Ampelfarbe ${choice} darf nicht zur Auswahl stehen`);
}

console.log('✓ FusionPulse v3.22.0 tempo/cost-load/domain regressions: OK');

/* ══════════════════════ v3.23.0 · Kryptoschiene, eigenes Kostenmodell ═══════
   Die Wahrscheinlichkeitsrechnung ist fuer beide Maerkte dieselbe, die
   KOSTENFUNKTION nicht — und der Unterschied ist strukturell, nicht numerisch:

     Aktien (flatex): FIXE 11,50 EUR je Order. Der Kostenanteil FAELLT mit der
       Positionsgroesse. Kleine Positionen sind unwirtschaftlich.
     Krypto (Bitpanda Fusion): keine Fixgebuehr, alles proportional
       (Taker-Fee je Seite + Spread). Der Kostenanteil ist von der
       Positionsgroesse UNABHAENGIG.

   Bei 10.000 EUR liegen beide zufaellig fast gleichauf (0,38 % gegen 0,40 %).
   Genau diese Scheingleichheit macht die Tests noetig: sie darf nicht dazu
   verfuehren, ein Modell fuer beide zu benutzen. */
{
  const worker = workerText;
  const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
  const idx = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const econSrc = worker.slice(worker.indexOf('const PICK_COST = {'),
                               worker.indexOf('const LEGACY_WIN_PCT = 5;') + 26);
  const core = worker.slice(worker.indexOf('const PICK = {'),
    worker.indexOf('/* ---------------------------------------------------------------------------\n   v3.21.0 · DIE ZWEI FRAGEN'));
  const diag = worker.slice(worker.indexOf('/* ---------------------------------------------------------------------------\n   v3.21.0 · DIE ZWEI FRAGEN'),
    worker.indexOf('/* ---------------------------------------------------------------------------\n   Auswertung: Situationstypen'));
  const wl = (w, n) => { if (n <= 0) return 0; const z = 1.96, p = w / n;
    const d = 1 + z * z / n, c = p + z * z / (2 * n);
    const m = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n);
    return Math.max(0, (c - m) / d); };
  const r1 = (x) => Math.round(x * 10) / 10, r2 = (x) => Math.round(x * 100) / 100;
  const K = new Function('wilsonLower', 'LEARN_HORIZON_MS', 'r1', 'r2',
    econSrc + core + diag +
    ';return {PICK_COST,COIN_COST,TEMPO,tempoCap,pickCfg,pickCosts,roundTripPct,netEurAtMove,lossEurAtStop,requiredMovePct,costLoadPct,breakEvenHitRate,tempoOf};'
  )(wl, 180 * 60_000, r1, r2);

  const S = K.PICK_COST, C = K.COIN_COST;

  /* -- 1. Die beiden Modelle muessen wirklich verschieden rechnen ---------- */
  assert.equal(S.kind, 'fixed', 'Das Aktienmodell muss als fix gekennzeichnet sein');
  assert.equal(C.kind, 'proportional', 'Das Kryptomodell muss als proportional gekennzeichnet sein');
  assert.equal(K.pickCosts(S), 38, 'Aktien: 2x11,50 EUR + 0,15 % von 10.000 = 38 EUR');
  assert.ok(Math.abs(K.pickCosts(C) - 40) < 0.01, 'Krypto: (2x0,15 % + 0,10 %) von 10.000 = 40 EUR');

  /* -- 2. DER STRUKTURELLE UNTERSCHIED ------------------------------------- */
  // Halbe Position: bei Krypto bleibt der Kostenanteil GLEICH, bei Aktien nicht.
  const halbS = { ...S, notionalEur: 5000 }, halbC = { ...C, notionalEur: 5000 };
  assert.equal(K.roundTripPct(C), K.roundTripPct(halbC),
    'Krypto: der Rundlauf in Prozent MUSS von der Positionsgroesse unabhaengig sein');
  assert.ok(K.roundTripPct(halbS) > K.roundTripPct(S) * 1.5,
    `Aktien: der Rundlauf in Prozent MUSS bei halber Position deutlich steigen (${K.roundTripPct(halbS)} vs ${K.roundTripPct(S)})`);
  // Und bei 10.000 EUR liegen sie fast gleichauf — die Falle, gegen die getestet wird.
  assert.ok(Math.abs(K.roundTripPct(S) - K.roundTripPct(C)) < 0.05,
    'Bei 10.000 EUR sind beide fast gleich — deshalb braucht es diese Tests');
  // Konsequenz in Euro: kleine Kryptopositionen bleiben tragfaehig.
  assert.ok(K.requiredMovePct(120, halbC) < K.requiredMovePct(120, halbS),
    'Bei halber Position muss Krypto die niedrigere Huerde haben');

  /* -- 3. Der Spread ist bei Krypto die halbe Rechnung --------------------- */
  const eng = { ...C, spreadPct: 0.05 }, weit = { ...C, spreadPct: 0.80 };
  assert.ok(Math.abs(K.pickCosts(eng) - 35) < 0.01, 'Enger Spread: 35 EUR Rundlauf');
  assert.ok(Math.abs(K.pickCosts(weit) - 110) < 0.01, 'Weiter Spread: 110 EUR Rundlauf');
  assert.ok(K.requiredMovePct(120, weit) - K.requiredMovePct(120, eng) > 0.7,
    'Ein weiter Spread muss die noetige Zielweite spuerbar anheben — sonst ist er nicht wirksam');
  // Fail-closed: ein fehlender/kaputter Spread darf es nie BESSER machen.
  // Fail-closed bei fehlenden Angaben: teurer, nicht guenstiger, und nicht NaN.
  for (const kaputt of [undefined, null, NaN, 'abc', '', 0, -1]) {
    const cost = K.pickCosts({ ...C, spreadPct: kaputt });
    assert.ok(Number.isFinite(cost), 'Ein fehlender Spread darf nicht NaN ergeben: ' + String(kaputt));
    assert.ok(cost > K.pickCosts(eng),
      'Ein fehlender Spread muss TEURER rechnen als ein gemessener enger: ' + String(kaputt));
    assert.ok(cost > K.pickCosts(C),
      'Er muss auch teurer sein als die Standardannahme — sonst verbessert Nichtwissen das Ergebnis');
  }
  for (const kaputt of [undefined, null, NaN]) {
    assert.ok(Number.isFinite(K.pickCosts({ ...S, orderFeeEur: kaputt })),
      'Auch im Aktienmodell darf eine fehlende Gebuehr nicht NaN ergeben');
    assert.ok(Number.isFinite(K.pickCosts({ ...C, feePct: kaputt })),
      'Eine fehlende Taker-Gebuehr darf nicht NaN ergeben');
  }

  /* -- 4. Die Zielweiten-Logik gilt in BEIDEN Maerkten --------------------- */
  for (const [name, cfg] of [['Aktien', S], ['Krypto', C]]) {
    let prev = 1;
    for (const t of [1.5, 2.04, 3, 4, 6]) {
      const q = K.breakEvenHitRate(t, -t / 2, cfg);
      assert.ok(q < prev, `${name}: ein groesseres Ziel muss die noetige Trefferquote senken (${t} %)`);
      prev = q;
    }
    assert.ok(K.costLoadPct(2.04, cfg) > K.costLoadPct(6, cfg) * 2,
      `${name}: die Kostenlast muss bei kleinem Ziel deutlich hoeher sein`);
    // Hin- und Rueckrechnung muessen auch im zweiten Modell invers sein.
    for (const target of [60, 120, 300])
      assert.ok(Math.abs(K.netEurAtMove(K.requiredMovePct(target, cfg), cfg) - target) < 0.01,
        `${name}: requiredMovePct und netEurAtMove muessen invers sein`);
  }

  /* -- 5. 24/7 heisst mehr Gelegenheiten, aber nicht beliebig viele -------- */
  assert.ok(K.tempoCap('coin') > K.tempoCap('stock'),
    'Krypto laeuft durchgehend — der Deckel muss hoeher liegen als bei Aktien');
  assert.ok(K.tempoCap('coin') <= 8,
    'Er darf aber nicht ins Unrealistische wachsen: der Markt laeuft 24/7, der Mensch nicht');
  const eps = (n) => Array.from({ length: n }, (_, i) => ({ symbol: `X${i}`, ts: i }));
  const c = K.tempoOf(eps(210), 21, 20, 30, 'coin');
  const st = K.tempoOf(eps(210), 21, 20, 30, 'stock');
  assert.equal(c.perDayUsed, K.tempoCap('coin'), 'Der Kryptodeckel muss greifen');
  assert.equal(st.perDayUsed, K.tempoCap('stock'), 'Der Aktiendeckel muss greifen');
  assert.ok(c.evPerDay > st.evPerDay, 'Dieselbe Haeufigkeit ergibt bei Krypto mehr Ertrag je Tag');

  /* -- 6. Die Auswertung darf NICHT zwei Code-Pfade haben ------------------ */
  const mod = sliceFn(worker, 'async function topPicks(');
  assert.match(mod, /const asset = opts\.asset === 'coin' \? 'coin' : 'stock';/,
    'Die Anlageklasse muss ein Parameter sein');
  assert.match(mod, /const baseCost = coin \? COIN_COST : PICK_COST;/,
    'Nur das Kostenmodell darf sich unterscheiden');
  assert.match(mod, /source IN \(\$\{srcHolder\}\)/,
    'Die Quellen muessen je Anlageklasse gefiltert werden');
  assert.ok(!mod.includes('async function topPicksCoin'),
    'Es darf KEINEN zweiten Auswertungspfad geben — dort laufen sonst zwei Wahrheiten auseinander');
  // Krypto-Quellen duerfen nicht in der Aktienauswertung landen und umgekehrt.
  assert.match(mod, /const sources = coin \? \['Bitpanda Fusion'\] : \['Twelve Data', 'Tiingo IEX'\];/,
    'Die Quellenlisten muessen sauber getrennt sein');

  /* -- 7. Der Spread muss aufgezeichnet werden ----------------------------- */
  // Dieselbe Lehre wie bei Situationstyp (v3.17.0) und Dollarumsatz (v3.18.0).
  const pStart = worker.indexOf('function snapshotPayload(row)');
  const payload = worker.slice(pStart, pStart + worker.slice(pStart).indexOf('\n}'));
  assert.match(payload, /^\s+spreadPct: Number\.isFinite/m,
    'Der Spread muss im Snapshot mitgeschrieben werden — als eigenes Feld, nicht unter anderem Namen');
  assert.match(worker, /async function persistCoinLive\(env, rows\)/,
    'Es braucht einen Zwischenspeicher fuer lebende Coin-Kandidaten');
  assert.match(worker, /await persistCoinLive\(env,snap\.rows\|\|\[\]\);/,
    'Der Cron muss ihn auch fuellen');

  /* -- 8. Oberflaeche: eigene Kachel im Kryptobereich ---------------------- */
  assert.match(idx, /id="topPicksCoin"[^>]*data-domain="coin"/,
    'Die Krypto-Top-Picks muessen im Kryptobereich stehen, nicht bei den Aktien');
  assert.match(idx, /id="topPicks"[^>]*data-domain="stock"/,
    'Und die Aktien-Top-Picks im Aktienbereich — die Zuordnung darf nicht nur aus der Verschachtelung folgen');
  assert.match(app, /const PICK_PANEL = \{ stock:'#topPicks', coin:'#topPicksCoin' \};/,
    'Beide Kacheln muessen ueber denselben Renderer laufen');
  assert.ok(!app.includes('function renderTopPicksCoin'),
    'Kein zweiter Renderer — sonst driften die Darstellungen auseinander');
  assert.ok(app.includes("['topPicksCoin','Top Picks · Krypto']"),
    'Auch die Kryptokachel muss faerbbar sein');
  assert.ok(idx.includes('data-tile="topPicksCoin"') && css.includes('[data-tile="topPicksCoin"]'),
    'Und dafuer HTML-Markierung und CSS-Regel haben');
}

console.log('✓ FusionPulse v3.23.0 coin-lane/cost-model regressions: OK');

/* ═══════════════════ v3.24.0 · Der Endpunkt selbst, nicht nur die Rechnung ══
   ANLASS: Die Oberfläche stand still, und aus dem Bildschirmfoto liess sich die
   Ursache nicht bestimmen — alle Anzeigen standen auf ihren statischen
   Startwerten. Beim Nachsehen fielen drei Fehler derselben Sorte auf, die
   KEINE der 42 bestehenden Suiten gefunden hat.

   DIE URSACHE ALLER DREI: `Number(null)` und `Number('')` sind 0, nicht NaN.
   Eine Pruefung mit `Number.isFinite(Number(x))` haelt einen nicht gesetzten
   Suchparameter deshalb fuer eine gueltige Null.
     - spreadPct/feePct → Krypto rechnete mit 0,80 % statt 0,40 % Rundlauf
     - netEur           → das Mindestziel fiel von 2,04 % auf 0,38 %, also auf
                          die reine Kostenschwelle. Alles darunter war falsch.

   WARUM DIE ALTEN TESTS DAS NICHT FANDEN: sie pruefen `requiredMovePct` und
   `pickCosts` direkt und mit sauberen Zahlen. Die NAHT zwischen Parameter-
   schicht und Rechnung war nie geprueft. Genau dort sass der Fehler.
   Diese Suite ruft deshalb den ECHTEN Endpunkt auf — ohne Parameter, mit
   leeren, mit kaputten. */
{
  const worker = workerText;
  const mod = await import('../src/worker.js');
  const call = async (qs) => {
    const r = await mod.default.fetch(
      new Request('https://t.local/api/toppicks' + qs), {}, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(r.status, 200, `${qs} muss 200 liefern`);
    return r.json();
  };

  /* -- 1. OHNE Parameter muessen die dokumentierten Werte herauskommen ----- */
  const st = await call('');
  assert.equal(st.asset, 'stock', 'Ohne asset-Parameter gilt Aktien');
  assert.equal(st.roundTripPct, 0.38, 'Aktien-Rundlauf muss 0,38 % sein');
  assert.equal(st.targetPct, 2.04,
    `Ohne netEur muss das Mindestziel 2,04 % sein, war ${st.targetPct} — hier stand der Fehler`);
  assert.equal(st.maxStopPct, 1.02, 'Und der zulaessige Stop 1,02 %');
  assert.equal(st.netEurTarget, 120, 'Die Zielgroesse muss auf den Standardwert fallen, nicht auf 0');

  const co = await call('?asset=coin');
  assert.equal(co.asset, 'coin', 'asset=coin muss greifen');
  assert.equal(co.costKind, 'proportional', 'Krypto muss proportional rechnen');
  assert.equal(co.roundTripPct, 0.4,
    `Krypto-Rundlauf muss 0,40 % sein, war ${co.roundTripPct} — hier stand der zweite Fehler`);
  assert.equal(co.cost.spreadPct, 0.1, 'Der Standard-Spread darf nicht auf 0 gesetzt werden');
  assert.equal(co.cost.feePct, 0.15, 'Die Standard-Gebuehr darf nicht auf 0 gesetzt werden');

  /* -- 2. Leere und kaputte Parameter duerfen nichts verstellen ------------ */
  for (const qs of ['?netEur=', '?netEur=0', '?netEur=abc', '?netEur=-5',
                    '?stopPct=', '?stopPct=0', '?spreadPct=', '?feePct=']) {
    const d = await call('?asset=stock&' + qs.slice(1));
    assert.equal(d.targetPct, 2.04, `${qs} darf das Mindestziel nicht verstellen (war ${d.targetPct})`);
    assert.equal(d.maxStopPct, 1.02, `${qs} darf den zulaessigen Stop nicht verstellen`);
  }
  for (const qs of ['?spreadPct=', '?spreadPct=0', '?spreadPct=abc', '?feePct=0']) {
    const d = await call('?asset=coin&' + qs.slice(1));
    assert.equal(d.roundTripPct, 0.4, `${qs} darf die Kryptokosten nicht verstellen (war ${d.roundTripPct})`);
  }

  /* -- 3. GUELTIGE Werte muessen dagegen sehr wohl wirken ------------------ */
  const teuer = await call('?asset=coin&spreadPct=0.8');
  assert.ok(teuer.roundTripPct > 1, 'Ein echter weiter Spread muss durchschlagen');
  assert.ok(teuer.targetPct > co.targetPct + 0.5, 'Und die noetige Zielweite anheben');
  assert.ok(teuer.breakEvenHitPct > co.breakEvenHitPct + 8,
    'Ein weiter Spread muss die noetige Trefferquote sichtbar erhoehen');
  const gross = await call('?asset=stock&netEur=250');
  assert.ok(gross.targetPct > 3.5, 'Ein hoeheres Nettoziel muss die Zielweite anheben');
  assert.ok(gross.breakEvenHitPct < st.breakEvenHitPct,
    'Und dabei die noetige Trefferquote SENKEN — die Fixkosten verteilen sich besser');

  /* -- 4. Kein Endpunkt darf am fehlenden D1-Binding sterben --------------- */
  // Ohne DB ist die ehrliche Antwort "keine Daten", nicht ein Fehler 500.
  for (const qs of ['', '?asset=coin']) {
    const d = await call(qs);
    assert.equal(d.state, 'nodb', 'Ohne D1 muss der Zustand ausgewiesen werden');
    assert.deepEqual(d.picks, [], 'Und es darf nichts erfunden werden');
    assert.ok(String(d.note).length > 20, 'Mit einer Begruendung, die man lesen kann');
  }

  /* -- 5. Der Boot-Waechter -------------------------------------------------
     Eine App, die lautlos stirbt, sieht aus wie eine App, die nur wartet.
     Genau das hat die Diagnose unmoeglich gemacht. */
  const idx = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(idx, /window\.__fpBootWatch = setTimeout/,
    'Der Boot-Waechter muss vorhanden sein');
  assert.ok(idx.indexOf('__fpBootWatch') < idx.indexOf('src="/app.js'),
    'Er muss VOR app.js stehen — sonst laeuft er genau dann nicht, wenn er gebraucht wird');
  assert.ok(!/<script src=[^>]*bootwatch/.test(idx),
    'Und INLINE sein: eine externe Datei koennte am selben Problem scheitern');
  assert.match(idx, /HTML statt JavaScript/,
    'Der haeufigste stille Totalausfall (Server liefert index.html statt der Datei) muss benannt werden');
  assert.match(idx, /id="bootFail"/, 'Es braucht einen sichtbaren Kasten');
  assert.match(app, /^self\.__fpBooted = true;$/m,
    'app.js muss den Start bestaetigen — als aktive Anweisung, nicht auskommentiert');
  assert.ok(app.trimEnd().endsWith("document.getElementById('bootFail')?.setAttribute('hidden','');"),
    'Die Bestaetigung muss die LETZTE Anweisung sein — ein Abbruch mittendrin soll die Warnung stehen lassen');

  /* -- 6. Notausstieg ------------------------------------------------------ */
  assert.match(app, /\/\[\?&\]fpreset=1\//, 'Es braucht einen Weg, Cache und Service Worker zurueckzusetzen');
  const resetIdx = app.indexOf('fpreset=1'), scanIdx = app.indexOf('async function scan(');
  assert.ok(resetIdx > 0 && resetIdx < scanIdx,
    'Die Rettung muss VOR dem Code stehen, der moeglicherweise gerade nicht laeuft');
  assert.ok(!/localStorage\.clear\(\)/.test(app.slice(resetIdx, resetIdx + 900)),
    'Der Notausstieg darf die Einstellungen NICHT loeschen — nur das, was sich neu holen laesst');

  /* -- 7. Die Regel, die aus allen drei Fehlern folgt ---------------------- */
  assert.match(worker, /const posNum = \(v, fallback = null\) =>/,
    'Zahlen von aussen muessen ueber einen gemeinsamen Helfer laufen');
  const picksBlock = sliceFn(worker, 'async function topPicks(');
  assert.ok(!/Number\.isFinite\(Number\(opts\./.test(picksBlock),
    'In topPicks darf `Number.isFinite(Number(opts.x))` nicht mehr vorkommen — das war die Fehlerquelle');
}

console.log('✓ FusionPulse v3.24.0 endpoint-seam/boot-watchdog regressions: OK');

/* ═════════════════════ v3.26.0 · Bereichsordnung und Abfolge ════════════════
   ANLASS (Nutzer): „leg die Überschrift Aktien wirklich über die Aktien und
   nicht unten bei den Coins hin. Abfolge Überschrift-Scope-Momentum … dann LAB"

   Er hatte recht, und es waren zwei getrennte Fehler:

   1) Das AKTIEN-Band stand ZWISCHEN Coin-Liste und Aktienabschnitt. Technisch
      „über den Aktien", gelesen aber als Abschluss der Coin-Liste — weil die
      Coin-Liste lang ist und nichts sie abschliesst. Eine Ueberschrift gehoert
      INS Element, das sie ueberschreibt.
   2) Die Auswertungsbereiche (Learning, Musterlabor, Modul 0, Lab,
      Marktmeinung) lagen INNERHALB von `#stocks`. Wer nach unten scrollte,
      landete zwischen zwei Aktienkacheln ploetzlich in der Selbstauswertung.
      Sie werten BEIDE Maerkte aus und sind Rueckblick, keine Handlungsgrundlage.

   Diese Suite prueft die tatsaechliche Reihenfolge im Markup — nicht, dass die
   Elemente irgendwo vorkommen. Genau dieser Unterschied war das Problem. */
{
  const idx = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
  const at = (needle, label) => {
    const i = idx.indexOf(needle);
    assert.ok(i > 0, `${label} nicht gefunden: ${needle}`);
    return i;
  };

  /* -- 1. Die Ueberschrift steht IM Bereich, den sie ueberschreibt --------- */
  const stocksOpen = at('<section id="stocks"', 'Aktienabschnitt');
  const bandStock = at('id="bandStock"', 'Aktien-Band');
  const radar = at('<h2>Aktienradar</h2>', 'Aktienradar-Ueberschrift');
  assert.ok(stocksOpen < bandStock,
    'Das AKTIEN-Band muss INNERHALB des Aktienabschnitts liegen — ausserhalb liest es sich als Ende der Coin-Liste');
  assert.ok(bandStock < radar, 'Und direkt ueber „Aktienradar"');
  // Es darf auch nichts Krypto-Bezogenes mehr dazwischenstehen.
  const coinList = at('<section id="list"', 'Coin-Liste');
  assert.ok(coinList < stocksOpen, 'Die Coin-Liste muss vor dem Aktienabschnitt enden');

  /* -- 2. Die geforderte Abfolge im Aktienbereich -------------------------- */
  const reihenfolge = [
    ['id="bandStock"',       'Überschrift'],
    ['<h2>Aktienradar</h2>', 'Umfang/Suche'],
    ['class="stockstage"',   'Fokus'],
    ['id="topPicks"',        'Top Picks'],
    ['id="marketGainers"',   'Momentum'],
    ['id="openingPanel"',    'Premarket'],
    ['id="extendedWatch"',   'Nachbörse'],
    ['id="sectorLaggards"',  'Nachzügler'],
    ['id="earningsBoard"',   'Zahlen'],
    ['id="gateFunnel"',      'Trichter'],
    ['id="depotStrip"',      'Depot'],
    ['id="portfolioRisk"',   'Risiko'],
    ['id="stockGroups"',     'Liste'],
  ];
  let vorher = -1, vorLabel = 'Anfang';
  for (const [needle, label] of reihenfolge) {
    const pos = at(needle, label);
    assert.ok(pos > vorher, `Abfolge verletzt: „${label}" muss NACH „${vorLabel}" stehen`);
    vorher = pos; vorLabel = label;
  }

  /* -- 3. LAB liegt HINTER den Aktien, nicht darin ------------------------- */
  const stocksClose = idx.indexOf('</section>', at('id="stockGroups"', 'Aktienliste'));
  for (const [needle, label] of [['id="learningReport"', 'Learning'],
                                 ['id="patternLab"', 'Musterlabor'],
                                 ['id="attributionReport"', 'Selbstauswertung'],
                                 ['id="experimentalPanel"', 'Lab'],
                                 ['id="aladdinCard"', 'Marktmeinung']]) {
    const pos = at(needle, label);
    assert.ok(pos > stocksClose,
      `${label} darf nicht mehr INNERHALB des Aktienabschnitts liegen — es wertet beide Maerkte aus`);
  }
  assert.ok(at('id="bandLab"', 'Lab-Band') < at('id="learningReport"', 'Learning'),
    'Der Auswertungsbereich braucht seine Ueberschrift davor');
  assert.ok(at('id="labZone"', 'Lab-Zone') > stocksClose, 'Und einen eigenen Behaelter');

  /* -- 4. Drei Bereiche, drei Farben, alle einstellbar --------------------- */
  for (const d of ['coin', 'stock', 'lab']) {
    assert.ok(idx.includes(`data-domain="${d}"`), `Bereich ${d} muss im Markup markiert sein`);
    assert.ok(css.includes(`[data-domain="${d}"]{ --domain:var(--domain-${d}); }`),
      `Bereich ${d} braucht seine Farbvariable`);
    assert.ok(app.includes(`['${d}','Bereichsfarbe`), `Bereich ${d} muss einstellbar sein`);
  }

  /* -- 5. Die Rubrikenleiste MUSS der DOM-Reihenfolge folgen --------------- */
  // Sonst springt die Markierung beim Scrollen vor und zurueck, weil
  // `markActiveSection` von oben nach unten laeuft und den letzten Treffer
  // nimmt. Ein Fehler, der sich wie ein Zufall anfuehlt.
  const block = app.slice(app.indexOf('const VIEW_SECTIONS'), app.indexOf('let activeView'));
  for (const view of ['coins', 'stocks', 'lab']) {
    const start = block.indexOf(`${view}: [`);
    // Ende der Liste ist die Zeile "  ]," — NICHT das erste "],", das steht
    // schon am Ende des ersten Eintrags. (Erster Anlauf hat genau das gefunden
    // und dann "braucht mehrere Rubriken" gemeldet, obwohl alles da war.)
    const end = block.indexOf('\n  ],', start);
    const sels = [...block.slice(start, end).matchAll(/\['([^']+)',/g)].map((m) => m[1]);
    assert.ok(sels.length >= 4, `${view} braucht mehrere Rubriken`);
    let last = -1;
    for (const sel of sels) {
      if (!sel.startsWith('#')) continue;              // 'main' u. ae. sind Container
      const pos = idx.indexOf(`id="${sel.slice(1)}"`);
      assert.ok(pos > 0, `${view}: Sprungziel ${sel} fehlt im Markup`);
      assert.ok(pos > last,
        `${view}: die Rubrik ${sel} steht in der Leiste vor einem Element, das im Markup DAHINTER liegt`);
      last = pos;
    }
  }
}

console.log('✓ FusionPulse v3.26.0 section-order regressions: OK');

/* ══════════════════ v3.27.0 · Der Situation-Score wird prüfbar ══════════════
   DER SCORE ist der früheste und folgenreichste Eingriffspunkt der App: er
   entscheidet, WELCHE Titel überhaupt in die Kandidatenliste kommen. Alles
   danach — Kostenrechnung, Hitze, Erwartungswert, Rangfolge — arbeitet nur noch
   mit dem, was er durchgelassen hat.

   Seine elf Terme standen als Zahlenkette im Code: 24, 16, 14, 12, 45, 12, 8,
   -4, 7, -3, 0.16, -18, 42. Keine davon war je gegen ein Ergebnis geprüft.
   Schlimmer: die ZUTATEN wurden nirgends aufgezeichnet — die Frage „trägt
   dieser Koeffizient etwas bei" war nicht nur unbeantwortet, sondern
   unbeantwortBAR. Vierte Wiederholung derselben Lehre nach Situationstyp
   (v3.17.0), Dollarumsatz (v3.18.0) und Spread (v3.23.0). */
{
  const worker = workerText;
  const idx = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

  /* -- 1. DIE UMSTELLUNG DARF NICHTS VERÄNDERN ----------------------------- */
  // Ohne diesen Nachweis wäre das Herausziehen der Koeffizienten eine stille
  // Verhaltensänderung an der folgenreichsten Stelle der App.
  const W = new Function(worker.slice(worker.indexOf('const SITU_W = {'),
    worker.indexOf('};', worker.indexOf('const SITU_W = {')) + 2) + '\nreturn SITU_W;')();
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const alt = (i) => {                       // v3.26.0, wortwörtlich
    let s = 0;
    s += i.brokePriorHigh ? 24 : i.nearBreakout ? 16 : 0;
    s += i.squeezeRelease ? 16 : 0;
    s += (i.reclaimVwap || i.reclaimEma21) ? 14 : 0;
    s += i.pullbackHold ? 12 : 0;
    s += Math.min(14, Math.max(0, i.accel5v15) * 45);
    s += i.relVolScore == null ? -8 : Math.min(14, Math.max(0, i.relVolScore - 0.8) * 12);
    s += i.volumeKnown && i.aboveVwap ? 8 : -4;
    s += i.emaUp ? 7 : -3;
    s += Math.min(8, Math.max(0, i.liquidityVacuum - 50) * 0.16);
    if (i.overextended) s -= 18;
    if (!i.volumeKnown) s = Math.min(s, 42);
    return +clamp(s, 0, 100).toFixed(0);
  };
  const neu = (i) => {                       // Tabellenfassung, aus SITU_W
    const t = {
      breakout: i.brokePriorHigh ? W.brokeHigh : i.nearBreakout ? W.nearBreak : 0,
      squeeze: i.squeezeRelease ? W.squeeze : 0,
      reclaim: (i.reclaimVwap || i.reclaimEma21) ? W.reclaim : 0,
      pullback: i.pullbackHold ? W.pullback : 0,
      accel: Math.min(W.accelCap, Math.max(0, i.accel5v15) * W.accelMul),
      rvol: i.relVolScore == null ? W.rvolMissing
        : Math.min(W.rvolCap, Math.max(0, i.relVolScore - W.rvolBase) * W.rvolMul),
      vwap: i.volumeKnown && i.aboveVwap ? W.aboveVwap : W.belowVwap,
      emaStack: i.emaUp ? W.emaUp : W.emaDown,
      vacuum: Math.min(W.vacCap, Math.max(0, i.liquidityVacuum - W.vacBase) * W.vacMul),
      extended: i.overextended ? W.overextended : 0,
    };
    let s = Object.values(t).reduce((a, b) => a + b, 0);
    if (!i.volumeKnown) s = Math.min(s, W.noVolumeCap);
    return +clamp(s, 0, 100).toFixed(0);
  };
  let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let k = 0; k < 20000; k++) {
    const i = { brokePriorHigh: rnd() < .3, nearBreakout: rnd() < .3, squeezeRelease: rnd() < .15,
      reclaimVwap: rnd() < .2, reclaimEma21: rnd() < .2, pullbackHold: rnd() < .2,
      accel5v15: (rnd() - 0.4) * 0.8, relVolScore: rnd() < .12 ? null : rnd() * 4,
      volumeKnown: rnd() < .85, aboveVwap: rnd() < .5, emaUp: rnd() < .5,
      liquidityVacuum: rnd() * 100, overextended: rnd() < .1 };
    assert.equal(neu(i), alt(i),
      `Die Tabellenfassung muss EXAKT die alten Werte liefern: ${JSON.stringify(i)}`);
  }
  // Und die Formel im Worker muss wirklich die Tabelle benutzen, keine Zahlen mehr.
  const formel = worker.slice(worker.indexOf('const situ = {'), worker.indexOf('const grossCRV'));
  assert.ok(!/[?:]\s*(24|16|14|12|45|18|42)\b/.test(formel.replace(/SITU_W\.\w+/g, 'W')),
    'In der Score-Formel darf keine nackte Zahl mehr stehen — sonst ist die Tabelle Dekoration');
  for (const k of ['brokeHigh', 'nearBreak', 'squeeze', 'reclaim', 'pullback', 'accelMul',
                   'rvolMul', 'aboveVwap', 'emaUp', 'vacMul', 'overextended', 'noVolumeCap'])
    assert.ok(formel.includes(`SITU_W.${k}`) || worker.includes(`SITU_W.${k}`),
      `Der Koeffizient ${k} muss aus der Tabelle kommen`);

  /* -- 2. DIE ZUTATEN MÜSSEN AUFGEZEICHNET WERDEN -------------------------- */
  // Ohne das bleibt der Score dauerhaft unprüfbar — der eigentliche Befund.
  const payload = sliceFn(worker, 'function snapshotPayload(row)');
  assert.match(payload, /situParts:/, 'Die Einzelbeiträge müssen im Snapshot landen');
  assert.match(payload, /situScore:/, 'Und der Score selbst');
  assert.match(worker, /situParts: Object\.fromEntries/,
    'Die Beiträge müssen die Scanfunktion überhaupt verlassen');

  /* -- 3. DAS URTEIL: erkennt es Unsinn? ----------------------------------- */
  const A = new Function('r2', 'aucSeparation', 'aucNoiseFloor',
    worker.slice(worker.indexOf('const AUDIT = {'), worker.indexOf('async function scoreAudit(')) +
    '\nreturn {AUDIT,SITU_TERMS,auditVerdict};')(
    (x) => Math.round(x * 100) / 100,
    (a, b) => { const A2 = a.filter(Number.isFinite), B2 = b.filter(Number.isFinite);
      if (!A2.length || !B2.length) return null; let w = 0;
      for (const x of A2) for (const y of B2) w += x > y ? 1 : x === y ? 0.5 : 0;
      return w / (A2.length * B2.length); },
    () => 0.58);

  assert.equal(A.SITU_TERMS.length, 10, 'Alle Terme des Score müssen im Audit auftauchen');
  // Ein klar tragender Term
  assert.equal(A.auditVerdict({ n: 400, nActive: 180, nIdle: 220, auc: 0.68, floor: 0.58, weight: 20 }).verdict,
    'traegt', 'Ein deutlich trennender Term muss als tragend erkannt werden');
  // Reiner Zufall
  assert.equal(A.auditVerdict({ n: 400, nActive: 180, nIdle: 220, auc: 0.53, floor: 0.58, weight: 20 }).verdict,
    'kein messbarer Beitrag', 'Ein Term innerhalb der Rauschgrenze darf nicht als tragend gelten');
  // Verkehrt herum — der teuerste Fall: er hebt die falschen Titel nach oben
  const inv = A.auditVerdict({ n: 400, nActive: 180, nIdle: 220, auc: 0.40, floor: 0.58, weight: 20 });
  assert.equal(inv.verdict, 'wirkt verkehrt herum',
    'Ein Term, dessen Fälle SELTENER ins Ziel liefen, muss als solcher benannt werden');
  assert.match(inv.why, /falschen Titel/, 'Und die Folge muss dabeistehen');
  /* ABZUGSTERME: das Vorzeichen bestimmt, was "richtig" heisst.
     Die Ueberdehnung (-18) SOLL die schlechteren Faelle treffen. Mein erster
     Entwurf hat sie deshalb als "wirkt verkehrt herum" gemeldet — genau wenn
     sie tat, wofuer sie gebaut wurde. Und ein KAPUTTER Abzugsterm waere
     unentdeckt geblieben. Beide Richtungen werden jetzt geprueft. */
  assert.equal(A.auditVerdict({ n: 400, nActive: 180, nIdle: 220, auc: 0.35, floor: 0.58, weight: -18 }).verdict,
    'traegt', 'Ein Abzugsterm, der die schlechteren Faelle trifft, arbeitet RICHTIG');
  const kaputterAbzug = A.auditVerdict({ n: 400, nActive: 180, nIdle: 220, auc: 0.68, floor: 0.58, weight: -18 });
  assert.equal(kaputterAbzug.verdict, 'wirkt verkehrt herum',
    'Ein Abzugsterm, der die BESSEREN Faelle trifft, ist kaputt — und muss auffallen');
  assert.match(kaputterAbzug.why, /richtigen Titel nach unten/,
    'Und die Folge muss in der richtigen Richtung benannt werden');
  // Symmetrie: dieselbe Trennschaerfe, entgegengesetztes Gewicht, entgegengesetztes Urteil.
  for (const auc of [0.30, 0.35, 0.65, 0.70]) {
    const plus = A.auditVerdict({ n: 400, nActive: 180, nIdle: 220, auc, floor: 0.58, weight: 20 }).verdict;
    const minus = A.auditVerdict({ n: 400, nActive: 180, nIdle: 220, auc, floor: 0.58, weight: -20 }).verdict;
    assert.notEqual(plus, minus,
      `Bei AUC ${auc} muessen Plus- und Abzugsterm entgegengesetzt beurteilt werden`);
  }

  // FAIL-CLOSED: zu wenig ist NICHT "neutral"
  for (const c of [{ n: 20, nActive: 8, nIdle: 12 }, { n: 400, nActive: 5, nIdle: 395 },
                   { n: 400, nActive: 395, nIdle: 5 }]) {
    assert.equal(A.auditVerdict({ ...c, auc: 0.9, floor: 0.58, weight: 20 }).verdict, 'nicht bewertbar',
      'Zu wenige Fälle müssen "nicht bewertbar" ergeben — niemals "neutral" und niemals "trägt"');
  }

  /* -- 4. Mehrfachtestkorrektur: elf Terme sind elf Tests ------------------ */
  // Bei elf Vergleichen liefert reiner Zufall regelmäßig einen "Treffer".
  const auditSrc = worker.slice(worker.indexOf('const AUDIT = {'), worker.indexOf('async function scoreAudit('));
  const fullSrc = worker.slice(worker.indexOf('async function scoreAudit('));
  assert.match(fullSrc, /aucNoiseFloor\(active\.length, idle\.length, SITU_TERMS\.length\)/,
    'Die Rauschgrenze MUSS über die Zahl der Terme korrigiert werden, sonst ist jeder Zufallstreffer signifikant');
  assert.match(fullSrc, /const oos = cases\.slice\(splitAt\)/,
    'Geurteilt werden muss außerhalb der Stichprobe');
  assert.ok(!/rows = SITU_TERMS\.map\(\(\[key[^)]*\) => \{\s*const active = cases/.test(fullSrc),
    'Es darf nicht auf ALLEN Fällen geurteilt werden');

  /* -- 5. Das Modul darf nichts ändern ------------------------------------- */
  const mod = sliceFn(worker, 'async function scoreAudit(');
  assert.match(mod, /changesNothing: true/, 'Das Audit muss ausweisen, dass es nichts verändert');
  for (const verboten of ['SITU_W.brokeHigh =', 'SITU_W[', 'buyReady', 'light ='])
    assert.ok(!mod.includes(verboten), `Das Audit darf nichts setzen: "${verboten}"`);
  assert.ok(!/SITU_W\.\w+\s*=/.test(worker.slice(worker.indexOf('async function scoreAudit('))),
    'Die Gewichte dürfen NIE automatisch überschrieben werden — empfehlen, nicht handeln');

  /* -- 6. Oberfläche: im Auswertungsbereich, nicht bei den Aktien ---------- */
  const stocksClose = idx.indexOf('</section>', idx.indexOf('id="stockGroups"'));
  assert.ok(idx.indexOf('id="scoreAudit"') > stocksClose,
    'Das Audit gehört in den Auswertungsbereich, nicht in die Aktien');
  assert.ok(app.includes("['scoreAudit','Score-Audit']"), 'Die Kachel muss färbbar sein');
  assert.ok(css.includes('[data-tile="scoreAudit"]'), 'Und eine CSS-Regel haben');
  assert.match(app, /0 % Gewicht in Score, Ampel und Freigabe/,
    'Die Kachel muss ihre Wirkungslosigkeit selbst ausweisen');
  // "nicht bewertbar" darf NIE wie "geprüft harmlos" aussehen.
  assert.match(css, /\.a-none\{border-style:dashed/,
    'Unbewertete Terme brauchen eine eigene Darstellung — grau wäre "geprüft und harmlos"');
}

console.log('✓ FusionPulse v3.27.0 score-audit regressions: OK');

/* ═══════════════ v3.28.0 · Fahrt-Meldung und Handelstagebuch ═══════════════
   ZWEI ANLIEGEN DES NUTZERS, beide mit einem eigenen Fallstrick.

   1) „Ich brauche nur den NAMEN der Aktie, die Fahrt aufnimmt."
      Der Fallstrick ist nicht das Finden, sondern das Schweigen. Eine Kachel,
      die immer etwas anzeigt, wird nach zwei Wochen nicht mehr gelesen — und
      wer bei 2,04 % Zielweite einem Titel hinterherläuft, der schon oben steht,
      hat sein Ziel hinter sich. Die Hürden müssen also HOCH sein, und der
      Normalfall muss Schweigen sein.

   2) „Ein Trade mit höherer Summe bei gutem Momentum ist ok."
      Ja — aber eine größere Position ist NUR erlaubt, weil der Stop enger
      sitzt, nicht weil das Setup sich besser anfühlt. Der Euro-Verlust bleibt
      gedeckelt. Sonst ist „höhere Summe bei Überzeugung" nur ein anderes Wort
      für „mehr riskieren, wenn man sich sicher fühlt".

   Und das Tagebuch schließt die Lücke, die alle anderen Auswertungen offen
   lassen: sie messen den MARKT, nicht die AUSFÜHRUNG. */
{
  const worker = workerText;
  const idx = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
  const econ = worker.slice(worker.indexOf('const PICK_COST = {'), worker.indexOf('const LEGACY_WIN_PCT = 5;') + 26);
  const cost = worker.slice(worker.indexOf('const pickCfg ='), worker.indexOf('/** Wilson-OBERgrenze'));
  const ride = worker.slice(worker.indexOf('const RIDE = {'), worker.indexOf('async function rideNow('));
  const jr = worker.slice(worker.indexOf('const JOURNAL = {'), worker.indexOf('async function journalList('));
  const r2 = (x) => Math.round(x * 100) / 100;
  const clp = worker.slice(worker.indexOf('function costLoadPct('), worker.indexOf('const evidenceTier'));
  const R = new Function('r2', econ + cost + clp + ride + jr +
    ';return {RIDE,pickCfg,requiredMovePct,lossEurAtStop,netEurAtMove,costLoadPct,rideSize,rideCheck,journalRow,journalSummary,ECON_MIN_REWARD_RISK,COIN_COST,PICK_COST};')(r2);

  const cfg = R.pickCfg(), T = R.requiredMovePct(120, cfg), MS = T / R.ECON_MIN_REWARD_RISK;

  /* -- 1. DAS RISIKOBUDGET MUSS DIE KOSTEN ENTHALTEN ----------------------- */
  // Mein erster Entwurf rechnete nur den Kursverlust: 200 EUR Budget ergaben
  // eine Position, deren Stop tatsächlich 252 EUR gekostet hätte — die
  // Gebühren fielen genau dort unter den Tisch, wo die Position wachsen soll.
  for (const [name, c] of [['Aktien', R.PICK_COST], ['Krypto', R.COIN_COST]]) {
    for (const stop of [2.0, 1.02, 0.75]) {
      const sz = R.rideSize(stop, c);
      const budget = c.notionalEur * R.RIDE.RISK_BUDGET_PCT / 100;
      if (sz.capped) continue;
      assert.ok(Math.abs(sz.riskEur - budget) <= 2,
        `${name} bei Stop ${stop} %: der VOLLE Verlust am Stop (${sz.riskEur} EUR) muss dem Budget (${budget} EUR) entsprechen`);
      assert.ok(Math.abs(R.lossEurAtStop(-stop, sz.cfg) - sz.riskEur) <= 1,
        `${name}: riskEur muss mit lossEurAtStop übereinstimmen — zwei Zahlen für dasselbe wären ein Widerspruch in der Anzeige`);
      assert.ok(sz.priceRiskEur < sz.riskEur,
        `${name}: der reine Kursverlust muss KLEINER sein als der volle Verlust`);
    }
  }
  // Enger Stop -> größere Position, aber gleiches Risiko. Das ist die ganze Idee.
  const eng = R.rideSize(1.02, cfg), weit = R.rideSize(2.0, cfg);
  assert.ok(eng.notionalEur > weit.notionalEur * 1.5,
    'Ein engerer Stop MUSS eine deutlich größere Position erlauben');
  assert.ok(Math.abs(eng.riskEur - weit.riskEur) <= 2,
    'Bei beiden muss derselbe Euro-Betrag auf dem Spiel stehen — sonst ist es nicht Risiko-, sondern Bauchgefühl-Größe');
  // Der Deckel muss greifen.
  const winzig = R.rideSize(0.2, cfg);
  assert.ok(winzig.capped && winzig.notionalEur <= cfg.notionalEur * R.RIDE.MAX_NOTIONAL_MULT,
    'Ein sehr enger Stop darf die Position nicht ins Unendliche wachsen lassen');

  /* -- 2. DIE HÜRDEN: Schweigen ist der Normalfall ------------------------- */
  const gut = { ignition: true, volPulsePct: 140, gapPct: 3.2, spreadPct: 0.12,
    rangePosition: 0.62, rangePct: 6.0, movePct: 4.1, lifecycle: 'IGNITION' };
  const ctx = { targetPct: T, maxStopPct: MS };
  assert.ok(R.rideCheck(gut, ctx).ok, 'Der Idealfall muss gemeldet werden');
  assert.equal(R.rideCheck(gut, ctx).catalyst, 'Eroeffnungsluecke', 'Und sein Auslöser benannt werden');
  // Jede einzelne Hürde muss für sich zum Schweigen führen.
  const bricht = [
    ['kein Zustandswechsel', { ignition: false, lifecycle: 'CONFIRM' }],
    ['Umsatz normal', { volPulsePct: 12 }],
    ['kein Auslöser', { gapPct: 0.3 }],
    ['Spread zu weit', { spreadPct: 0.45 }],
    ['schon am Tageshoch', { rangePosition: 0.97 }],
    ['Restweg zu kurz', { rangePct: 2.0, rangePosition: 0.80 }],
    ['Tagesbilanz negativ', { movePct: -1.2 }],
    ['Spread unbekannt', { spreadPct: null }],
    ['Spanne unbekannt', { rangePosition: null }],
  ];
  for (const [name, over] of bricht) {
    const c = R.rideCheck({ ...gut, ...over }, ctx);
    assert.ok(!c.ok, `Hürde „${name}" muss zum Schweigen führen`);
    assert.ok(c.fail.length >= 1, `Und der Grund muss benannt werden: ${name}`);
  }
  // Der Quartalstermin ist der einzige HARTE Beleg — er ersetzt die Lücke.
  assert.ok(R.rideCheck({ ...gut, gapPct: 0.2 }, { ...ctx, earnDays: 1 }).ok,
    'Ein Quartalstermin muss als Auslöser genügen, auch ohne Eröffnungslücke');
  assert.equal(R.rideCheck({ ...gut, gapPct: 0.2 }, { ...ctx, earnDays: 1 }).catalyst, 'Quartalstermin');
  assert.ok(!R.rideCheck({ ...gut, gapPct: 0.2 }, { ...ctx, earnDays: 9 }).ok,
    'Ein weit entfernter Termin ist kein Auslöser');
  // FAIL-CLOSED: unbekannte Werte dürfen nie durchgehen.
  for (const feld of ['volPulsePct', 'spreadPct', 'rangePosition'])
    assert.ok(!R.rideCheck({ ...gut, [feld]: undefined }, ctx).ok,
      `Ein unbekanntes ${feld} darf NICHT zu einer Meldung führen`);

  /* -- 3. Die App darf keine Nachricht behaupten, die sie nicht hat -------- */
  const mod = sliceFn(worker, 'async function rideNow(');
  assert.match(mod, /noNewsFeed: true/, 'Die App muss ausweisen, dass sie keine Nachrichtenquelle hat');
  assert.match(mod, /FINGERABDRUCK eines Ausloesers .*nicht der Ausloeser selbst/,
    'Und den Unterschied zwischen Fingerabdruck und Auslöser benennen');
  assert.match(mod, /buyWeight: 0/, 'Kein Gewicht in der Bewertung');
  assert.match(app, /Kein Kaufsignal\. Die App hat keine Nachrichtenquelle/,
    'Der Hinweis muss auch in der Anzeige stehen, nicht nur in der Antwort');

  /* -- 4. HANDELSTAGEBUCH: Soll gegen Ist ---------------------------------- */
  const t = { id: 'a', ts: 1, symbol: 'sofi', plan_entry: 100, plan_target: 102.04, plan_stop: 98.98,
    plan_notional: 19600, fill_entry: 100.18, fill_entry_ts: 1000,
    fill_exit: 101.90, fill_exit_ts: 1000 + 42 * 60000, skipped: 0 };
  const r = R.journalRow(t);
  assert.equal(r.symbol, 'SOFI', 'Symbole werden vereinheitlicht');
  assert.equal(r.state, 'abgeschlossen');
  assert.equal(r.planMovePct, 2.04, 'Die geplante Bewegung muss aus Plan-Einstieg und Ziel folgen');
  assert.equal(r.realMovePct, 1.72, 'Die echte Bewegung aus den Ist-Kursen');
  assert.equal(r.slipEntryPct, 0.18, 'Und die Einstiegsabweichung dazwischen');
  assert.ok(r.realNet < r.planNet, 'Ein teurerer Einstieg muss weniger Netto ergeben');
  assert.ok(r.deltaEur < 0, 'Und der Abstand muss negativ ausgewiesen werden');
  assert.equal(r.holdMin, 42, 'Die Haltedauer folgt aus den Zeitstempeln');
  // Die Zustände müssen sich unterscheiden — „geplant" ist nicht „abgeschlossen".
  assert.equal(R.journalRow({ ...t, fill_entry: null, fill_exit: null }).state, 'geplant');
  assert.equal(R.journalRow({ ...t, fill_exit: null }).state, 'offen');
  assert.equal(R.journalRow({ ...t, skipped: 1 }).state, 'uebersprungen');
  // Ein übersprungener Trade ist eine Information, kein Fehler — und darf die
  // Bilanz der ausgeführten nicht verfälschen.
  const gemischt = [r, R.journalRow({ ...t, id: 'b', skipped: 1 }), R.journalRow({ ...t, id: 'c', fill_exit: null })];
  const sum = R.journalSummary(gemischt);
  assert.equal(sum.done, 1, 'Nur abgeschlossene Trades zählen in die Bilanz');
  assert.equal(sum.skipped, 1, 'Übersprungene werden getrennt ausgewiesen');
  assert.equal(sum.open, 1, 'Offene ebenfalls');
  assert.ok(sum.costPerTradeEur < 0, 'Der Abstand je Trade muss die Ausführungskosten zeigen');
  assert.equal(sum.deltaSumEur, sum.realSumEur - sum.planSumEur, 'Der Abstand muss die Differenz sein');
  // Ohne Ist-Werte darf nichts erfunden werden.
  const leer = R.journalRow({ id: 'x', ts: 1, symbol: 'X', plan_entry: 100, plan_target: 102, skipped: 0 });
  assert.equal(leer.realNet, null, 'Ohne Ist-Kurse darf kein Ergebnis erfunden werden');
  assert.equal(leer.deltaEur, null, 'Und kein Abstand');

  /* -- 5. Oberfläche ------------------------------------------------------- */
  assert.ok(idx.indexOf('id="rideAlert"') < idx.indexOf('id="bandCoin"'),
    'Die Fahrt-Meldung gehört GANZ nach oben — eine Meldung, die man suchen muss, ist keine');
  assert.match(css, /\.ridealert:empty\{display:none\}/,
    'Ohne Inhalt darf die Meldung keinen Platz belegen');
  assert.match(css, /\.ride-name b\{font-size:3\dpx/,
    'Der NAME ist die Botschaft und muss entsprechend groß sein');
  const stocksClose = idx.indexOf('</section>', idx.indexOf('id="stockGroups"'));
  assert.ok(idx.indexOf('id="tradeJournal"') > stocksClose,
    'Das Tagebuch gehört in den Auswertungsbereich');
  for (const k of ['ride', 'journal'])
    assert.ok(app.includes(`['${k}',`) && css.includes(`[data-tile="${k}"]`),
      `Kachel ${k} muss färbbar sein und eine CSS-Regel haben`);
}

console.log('✓ FusionPulse v3.28.0 ride/journal regressions: OK');

// ---------------------------------------------------------------------------
// v3.29.0 · DIE VORABEND-LISTE
// Bis hierher pruefte die Suite die neue Schicht nur ueber das Glossar und die
// Erreichbarkeit — also ob Begriffe erklaert sind und Container existieren.
// Beides war rot und ist behoben, aber beides sagt NICHTS ueber die Geometrie.
// Ein Setup-Filter, dessen Huerden nie an einem Gegenbeispiel gemessen wurden,
// ist eine Liste, die immer etwas ausgibt. Deshalb hat jede Huerde hier ein
// Paar: einen Fall, der durchgeht, und einen, der genau an ihr scheitert.
{
  const { loadEve } = await import('./eve-harness.mjs');
  const { compressionBars, reversalBars } = await import('./eve-fixtures.mjs');
  const E = loadEve();
  const ctx = { econTargetPct: 2.04, maxStopPct: 1.02,
    cfg: { equity: 10000, riskPct: 1, feeEur: 5.9, spreadPct: 0.05 } };
  const geo = (raw, kind) => E.eveGeometry(E.eveBars(raw), kind);
  const chk = (raw, kind) => E.eveCheck(geo(raw, kind), ctx);

  // -- POSITIVKONTROLLE. Ohne sie ist jede Ablehnung unten wertlos: ein Filter,
  //    der alles aussortiert, besteht jeden Negativtest.
  const okBox = chk(compressionBars({}), 'momentum');
  assert.ok(okBox.ok, `Eine saubere Kompression muss durchkommen, scheitert an: ${okBox.fail.join(' | ')}`);
  const okRev = chk(reversalBars({ hammer: true, tightPct: 0.05, barRangePct: 0.5, dropPct: 5.5 }), 'rueckkehr');
  assert.ok(okRev.ok, `Eine saubere Rueckkehr muss durchkommen, scheitert an: ${okRev.fail.join(' | ')}`);

  // -- DER STOP WIRD NIE ENGER GERECHNET (Sicherheits-Invariante 4).
  //    Der teuerste denkbare Fehler dieser Schicht waere, den Stop ins Budget
  //    zu biegen, damit das CRV passt. Der Kandidat muss stattdessen sichtbar
  //    in die getrennte Gruppe wandern — verschwinden darf er nicht (Inv. 6).
  const wideRaw = reversalBars({ hammer: true, tightPct: 0.05, barRangePct: 0.9, dropPct: 5.5 });
  const wideG = geo(wideRaw, 'rueckkehr');
  const wideC = E.eveCheck(wideG, ctx);
  assert.ok(wideG.stopPct > ctx.maxStopPct,
    'Der Aufbau des Falls stimmt nicht — er soll das Stopbudget ueberschreiten');
  assert.equal(wideC.ok, false, 'Ein Stop ueber Budget darf nicht als handelbar gelten');
  assert.equal(wideC.budgetOnly, true,
    `Nur am Budget gescheitert muss getrennt ausgewiesen sein, Gruende: ${wideC.fail.join(' | ')}`);
  assert.ok(wideC.fail.some((f) => /Stopbudget/.test(f)),
    'Der Grund muss benannt sein, nicht bloss die Ablehnung');
  const wideCand = E.eveCandidate('WIDE', E.eveBars(wideRaw), 'rueckkehr', ctx);
  assert.equal(wideCand.geometry.stop, wideG.stop,
    'Der Stop im Plan muss exakt der strukturelle Stop sein — kein enger gerechneter');
  assert.ok(wideCand.plan, 'Ein zu breiter Kandidat behaelt seinen Plan, er wird nur nicht empfohlen');

  // -- FEHLENDE DATEN DUERFEN NIE ETWAS VERBESSERN (Regel 4, `Number(null)`).
  //    Ein Kurs oder Umsatz von 0 waere an jeder Abstandsrechnung der
  //    bestmoegliche Wert. Fuenf Versionen lang derselbe Fehler.
  const nulled = compressionBars({}).map((b, i) => (i > 60 ? { ...b, close: null } : b));
  assert.ok(E.eveBars(nulled).length < E.eveBars(compressionBars({})).length,
    'Balken ohne Schlusskurs muessen verworfen werden, nicht auf 0 gesetzt');
  const noVol = compressionBars({}).map((b) => ({ ...b, volume: 0 }));
  const noVolC = chk(noVol, 'momentum');
  assert.equal(noVolC.ok, false, 'Ohne Umsatzangabe darf kein Kandidat entstehen');
  assert.ok(noVolC.fail.some((f) => /unbekannt/.test(f)),
    `Fehlende Daten muessen als unbekannt gemeldet werden, nicht als erfuellt: ${noVolC.fail.join(' | ')}`);
  /* Der Unterschied, an dem diese Fehlerklasse fuenf Versionen lang haengen
     geblieben ist: eine 0 ist KEINE Beobachtung. Wuerde sie als Zahl
     durchgehen, waere sie an jeder Abstandsrechnung der beste Wert und der
     Umsatzverlauf sagte "versiegt" statt "unbekannt". Ein `null` faengt schon
     der `??`-Operator ab — nur die 0 prueft die eigentliche Abwehr. */
  const zeroG = geo(noVol, 'momentum');
  assert.equal(zeroG.dollarVol, null, 'Ein Umsatz von 0 darf nicht als Dollarumsatz gelten');
  assert.equal(zeroG.volRatio, null, 'Ein Umsatz von 0 darf nicht als "Umsatz versiegt" gelesen werden');
  assert.ok(noVolC.fail.some((f) => /Umsatzverlauf unbekannt/.test(f)),
    'Der versiegende Umsatz ist eine Bedingung — unbekannt darf sie nie erfuellen');

  // -- RESTWEG. Ein altes Hoch dichter als die Zielweite heisst: die Bewegung
  //    laeuft vorher in fremdes Angebot. Der Fall unterscheidet sich vom
  //    Positivfall NUR durch dieses eine Hoch.
  const capped = chk(compressionBars({ capPct: 1.2 }), 'momentum');
  assert.equal(capped.ok, false, 'Ein Widerstand innerhalb der Zielweite muss den Kandidaten stoppen');
  assert.ok(capped.fail.some((f) => /Restweg/.test(f)),
    `Der Restweg muss der genannte Grund sein: ${capped.fail.join(' | ')}`);

  // -- BEWEGUNGSFAEHIGKEIT. Der Befund aus v3.8.0 als messbare Huerde statt als
  //    Namensliste: ein Titel, der 0,5 % am Tag laeuft, kann 2,04 % nicht
  //    liefern — auch wenn seine Kompression mustergueltig aussieht.
  const sleepy = chk(compressionBars({ baseRangePct: 0.5, boxRangePct: 0.2 }), 'momentum');
  assert.equal(sleepy.ok, false, 'Ein bewegungsunfaehiger Titel darf nicht auf der Liste stehen');
  assert.ok(sleepy.fail.some((f) => /Basisspannen/.test(f)),
    `Die Bewegungsfaehigkeit muss der Grund sein: ${sleepy.fail.join(' | ')}`);

  // -- FALLENDES MESSER. Dieselbe Geometrie unterhalb des laengeren Trends ist
  //    ausdruecklich KEIN Kandidat. Die Form allein genuegt nicht.
  const knife = chk(reversalBars({ hammer: true, tightPct: 0.05, barRangePct: 0.5,
    dropPct: 5.5, downtrend: true }), 'rueckkehr');
  assert.equal(knife.ok, false, 'Eine Rueckkehr im Abwaertstrend darf nicht durchgehen');
  assert.ok(knife.fail.some((f) => /Messer|laengeren Trend/.test(f)),
    `Der Trend muss der genannte Grund sein: ${knife.fail.join(' | ')}`);

  // -- KOMPRESSION IST BEDINGUNG, NICHT SCHMUCK. Ohne Enge und ohne
  //    versiegenden Umsatz ist der enge Stop nicht gerechtfertigt.
  const loose = chk(compressionBars({ boxRangePct: 2.6, volFactor: 1.4 }), 'momentum');
  assert.equal(loose.ok, false, 'Ohne Kompression darf kein Ausbruchskandidat entstehen');

  // -- DIE BEIDEN ARTEN BLEIBEN GETRENNT. Zusammengelegt wuerde eine gute Quote
  //    der einen die schlechte der anderen verdecken — dann ist keine von
  //    beiden mehr beurteilbar.
  const mk = (n, outcome) => Array.from({ length: n }, () => ({ outcome, held: 2, targetPct: 2.04, stopPct: 1.0, ambiguous: false }));
  const sMom = E.eveStudySummary([...mk(20, 'Ziel'), ...mk(20, 'ausgestoppt')], 'momentum', ctx);
  const sRev = E.eveStudySummary([...mk(20, 'Ziel'), ...mk(20, 'ausgestoppt')], 'rueckkehr', ctx);
  assert.equal(sMom.kind, 'momentum');
  assert.equal(sRev.kind, 'rueckkehr');
  assert.notEqual(sMom.label, sRev.label, 'Beide Arten brauchen eine eigene, lesbare Bezeichnung');

  // -- FAIL-CLOSED IM URTEIL. Zu wenige Faelle heissen "nicht bewertbar" —
  //    nicht "neutral" und schon gar nicht "traegt".
  const thin = E.eveStudySummary(mk(5, 'Ziel'), 'momentum', ctx);
  assert.equal(thin.verdict, 'nicht bewertbar',
    `Unter ${E.EVE.STUDY_MIN_N} Faellen darf kein Urteil entstehen, war: ${thin.verdict}`);
  assert.match(thin.why, /Datenlage/,
    'Die Begruendung muss klarstellen, dass es an den Daten liegt und nicht an der Art');
  const perfect = E.eveStudySummary(mk(30, 'Ziel'), 'momentum', ctx);
  assert.ok(perfect.hitPctLower < 100,
    'Beurteilt wird die untere Schranke — 30 aus 30 sind keine 100 % Trefferquote');

  // -- NICHT AUSGELOEST IST KEIN VERLUST. Ein Trigger, der nicht erreicht wird,
  //    ist ein Tag ohne Trade und darf die Quote nicht verwaessern.
  const withMisses = E.eveStudySummary([...mk(30, 'Ziel'), ...mk(50, 'nicht ausgeloest')], 'momentum', ctx);
  assert.equal(withMisses.n, 30, 'Nicht ausgeloeste Faelle gehoeren nicht in den Nenner');
  assert.equal(withMisses.notTriggered, 50, 'Sie muessen aber sichtbar bleiben');

  // -- 0 % GEWICHT. Diese Schicht liefert Kandidaten, kein Urteil. Taucht hier
  //    je ein Score oder eine Ampel auf, ist die Trennung gebrochen.
  const cand = E.eveCandidate('OK', E.eveBars(compressionBars({})), 'momentum', ctx);
  for (const k of ['score', 'verdict', 'gate', 'release', 'ampel', 'buy'])
    assert.ok(!(k in cand), `Der Vorabend-Kandidat darf kein Feld "${k}" tragen`);
  // -- DAS DATUM MUSS ANGEFORDERT WERDEN. Tiingo liefert es nur mit, solange
  //    `columns` gar nicht gesetzt ist. Fehlt es, verwirft `eveBars()` korrekt
  //    JEDEN Balken — 40 Abrufe, 0 verwertbar, kein einziger Fehler. Genau so
  //    ist v3.29.0 beim Nutzer gelandet.
  {
    const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
    const fn = worker.slice(worker.indexOf('async function eveDailyBars('),
                            worker.indexOf('async function eveningList('));
    assert.match(fn, /columns=date,/,
      'Die Spaltenliste MUSS mit `date` beginnen, sonst kommt kein Datum zurueck');
    // Und die Abwehr muss echt sein: ein Balken ohne Datum bleibt draussen.
    const undated = compressionBars({}).map(({ date, ...rest }) => rest);
    assert.equal(E.eveBars(undated).length, 0,
      'Balken ohne Datum sind keine Beobachtung und duerfen nie durchgehen');
  }

  // -- EIN LAUF OHNE VERWERTBARE DATEN IST KEIN ERGEBNIS.
  //    Die alte Meldung sagte auch bei NULL geprueften Titeln "ist das der
  //    Normalfall" und hat einen Totalausfall beruhigend verpackt.
  {
    const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
    const fn = worker.slice(worker.indexOf('async function eveningList('),
                            worker.indexOf('async function eveReadCache('));
    assert.match(fn, /dataOk: barsOk > 0/,
      'Der Lauf muss ausweisen, ob ueberhaupt Daten ankamen');
    assert.match(fn, /barsOk === 0[\s\S]{0,400}AUSFALL/,
      'Bei null verwertbaren Titeln muss die Meldung von einem Ausfall sprechen');
    const normal = fn.slice(fn.indexOf('Normalfall') - 400, fn.indexOf('Normalfall'));
    assert.ok(!/barsOk === 0/.test(normal.slice(-120)),
      'Der Normalfall-Satz darf nie fuer einen Ausfall verwendet werden');
    const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
    assert.match(app, /dataOk === false[\s\S]{0,200}Datenausfall/,
      'Die Anzeige muss einen Ausfall als Ausfall kennzeichnen');
  }

  // -- DAS ABRUFBUDGET. Der erste echte Lauf holte 40 Titel auf einen Schlag
  //    und bekam 40 mal 429. Der kostenlose Zugang erlaubt rund 50 Symbole je
  //    Stunde, geteilt mit allem anderen. Ein Lauf darf das nie ausreizen.
  {
    const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
    assert.ok(E.EVE.FETCH_BUDGET > 0 && E.EVE.FETCH_BUDGET <= 10,
      `Das Abrufbudget je Lauf muss klein bleiben, ist ${E.EVE.FETCH_BUDGET}`);
    assert.ok(E.EVE.FETCH_BUDGET < E.EVE.MAX_SYMBOLS,
      'Ein Lauf darf nie das ganze Universum abrufen');
    const fn = worker.slice(worker.indexOf('async function eveningList('),
                            worker.indexOf('/* Tagesbalken je Titel'));
    assert.match(fn, /slice\(0, EVE\.FETCH_BUDGET\)/,
      'Die Abrufliste muss am Budget abgeschnitten werden');
    assert.match(fn, /if \(rateLimited\) return/,
      'Nach einem 429 darf kein weiterer Abruf mehr rausgehen');
    assert.match(fn, /rateLimited = true/,
      'Ein 429 muss den Lauf umschalten, nicht nur gezaehlt werden');
    // Tagesbalken werden laenger gehalten als das Gesamtergebnis — sonst
    // kostet jeder erneute Lauf wieder das volle Kontingent.
    assert.ok(E.EVE.BARS_TTL_MS > E.EVE.CACHE_MS,
      'Balken muessen laenger vorgehalten werden als das Ergebnis');
    assert.match(worker, /async function eveReadBars\(/, 'Balken-Zwischenspeicher fehlt');
    assert.match(worker, /async function eveWriteBars\(/, 'Balken werden nie geschrieben');
  }

  // -- AUFBAUPHASE IST KEIN AUSFALL. Solange nur das Budget fehlt, ist die
  //    leere Liste ein Zwischenstand — und darf nicht rot als Fehler stehen.
  {
    const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
    const fn = worker.slice(worker.indexOf('async function eveningList('),
                            worker.indexOf('/* Tagesbalken je Titel'));
    assert.match(fn, /barsOk === 0 && deferred > 0 && !failedFetch/,
      'Ein Zwischenstand ohne Fehler muss von einem echten Ausfall getrennt sein');
    assert.match(fn, /dataOk: barsOk > 0 \|\| \(deferred > 0 && !failedFetch\)/,
      'Die Aufbauphase darf nicht als Datenausfall gemeldet werden');
  }

  // -- DIE KENNZAHLENZEILE IST KEIN FORTSCHRITTSBALKEN.
  //    `.eve-bar` bekam `height:6px;overflow:hidden`, weil ich die Klasse am
  //    NAMEN gelesen habe statt im Markup. Damit waren die Kennzahlen UND der
  //    "neu rechnen"-Knopf auf sechs Pixel gestutzt und unsichtbar.
  {
    const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
    const rule = css.slice(css.indexOf('.eve-bar{'), css.indexOf('}', css.indexOf('.eve-bar{')));
    assert.ok(!/height:\s*\d+px/.test(rule),
      'Die Kennzahlenzeile darf keine feste Hoehe haben — sie enthaelt Text und einen Knopf');
    assert.ok(!/overflow:\s*hidden/.test(rule),
      'Nichts in dieser Zeile darf abgeschnitten werden');
    const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
    assert.ok(app.includes('id="eveReload"') && app.indexOf('id="eveReload"') > app.indexOf('class="eve-bar"'),
      'Der Knopf sitzt in dieser Zeile — deshalb darf sie ihn nicht kappen');
    assert.match(css, /\.eve-bar>button/,
      'Der Knopf in der Kennzahlenzeile braucht eine eigene Regel');
  }
}

/* ═══ v3.32.7 · Die Systemleiste, AUSGEFUEHRT statt gelesen ══════════════════
   Drei Fassungen hintereinander (3.32.2, 3.32.3, 3.32.6) haben denselben
   Fehler nicht beseitigt, sondern verschoben — und alle drei hatten gruene
   Regex-Tests. Der Grund ist immer derselbe: Ein Muster im Quelltext beweist,
   dass etwas DASTEHT, nicht dass es das Richtige TUT.

   Gemeldet am 01.09.: richtiger Token eingetragen, Daten laufen, alle
   Einzelampeln gruen — Systemleiste rot mit „Zugriffs-Token fehlt auf diesem
   Geraet". Ursache: `/api/health` liefert `protected: !!env.APP_TOKEN`. Das
   beschreibt die INSTALLATION („hier ist ein Token noetig") und ist wahr,
   sobald ueberhaupt einer gesetzt ist. Der Client las es als Urteil ueber den
   ANRUFER. Die Meldung erschien also genau dann, als der Schutz zu wirken
   begann. */
{
  const { loadClient } = await import('./client-harness.mjs');
  const strip = (health) => {
    const C = loadClient();
    C.health = health;
    C.renderResourceStrip();
    return { text: C.el('#resourceText').textContent,
             cls: [...C.el('#resourceStrip').classList._classes] };
  };
  const OK_STATUS = { crypto:{state:'ok'}, stocks:{state:'ok'}, alpaca:{state:'ok'} };

  /* 1 · Der gemeldete Fall. Geschuetzte Installation, autorisierter Anrufer. */
  const a = strip({ ok:true, protected:true, authenticated:true, status:OK_STATUS });
  assert.ok(!/Zugriffs-Token fehlt/.test(a.text),
    'Eine geschuetzte Installation mit gueltigem Token darf NICHT „Token fehlt" melden');
  assert.ok(!a.cls.includes('err'),
    'Und sie darf dabei nicht rot sein — genau das war der Befund vom 01.09.');

  /* 2 · Die Gegenprobe: ein echt abgewiesener Anrufer MUSS rot bleiben. Ohne
     diesen Fall waere der Fix ein Rueckbau von v3.32.2. */
  const b = strip({ ok:true, protected:true, authenticated:false });
  assert.match(b.text, /Zugriffs-Token fehlt/,
    'Ein abgewiesener Anrufer muss weiterhin klar gemeldet werden');
  assert.ok(b.cls.includes('err'), 'Und zwar rot, nicht gelb oder orange');
  assert.match(b.text, /weder Aktien noch Krypto/,
    'Es muss dastehen, dass AUCH Krypto betroffen ist — dieselbe geschuetzte Route');

  /* 3 · Ein Worker vor v3.32.7 sendet `authenticated` gar nicht. „Nicht
     gesagt" ist nicht „verneint" — sonst faerbt allein das Client-Update
     jede aeltere Installation dauerhaft rot. */
  const c = strip({ ok:true, protected:true, status:OK_STATUS });
  assert.ok(!c.cls.includes('err'),
    'Ein fehlendes `authenticated` darf nicht als Verneinung gelten');

  /* 4 · Und der ungeschuetzte Fall bleibt, wie er war. */
  const d = strip({ ok:true, protected:false, authenticated:true, status:OK_STATUS });
  assert.ok(!d.cls.includes('err'), 'Ohne APP_TOKEN war und bleibt die Leiste nicht rot');
}

console.log('✓ FusionPulse v3.32.7 Systemleiste (ausgefuehrt): OK');

/* ═══ v3.32.8 · R1.3/R1.4 — CRV-Geometrie, AUSGEFUEHRT ══════════════════════
   Befund MRNA 01.09.: Plan-CRV 14,3 : 1 bei 0,268 % Stopweite; der Nenner
   bestand zu 59 % aus Gebuehren. Zaehler und Nenner messen verschiedene
   Zeitraeume — beruhigt sich ein Titel nach einem Impuls, explodiert das
   Verhaeltnis rein mechanisch.

   Diese Suite prueft AUSSCHLIESSLICH Diagnose. Sie darf nie gruen werden,
   weil eine Bedingung nicht bewertbar ist (Invariante 5), und die letzten
   zwei Faelle sichern ab, dass die Freigabelogik unberuehrt bleibt.        */
{
  const { loadClient } = await import('./client-harness.mjs');
  const C = loadClient();
  const G = C.crvGeometry;

  /* Der reale Fall, nachgerechnet: 26,78 EUR Kursrisiko + 38,00 EUR Kosten
     = 64,78 EUR Nenner, davon 58,66 % Gebuehren. */
  const MRNA_SZ = { stopDistancePct: 0.268, stopLossAfterCosts: 64.78, stopCosts: 38.00 };
  const MRNA_TR = { netCrv: 14.29, tp2Pct: 12.3 };
  const MRNA_R  = { structurePct: 3.4 };

  // NK41 · Der Kostenanteil muss ueberhaupt erscheinen und die 59 % treffen.
  const g = G(MRNA_R, MRNA_SZ, MRNA_TR);
  assert.ok(g.costSharePct > 58 && g.costSharePct < 59,
    `Kostenanteil am Nenner muss ~58,7 % sein, ist ${g.costSharePct}`);
  assert.strictEqual(g.costHeavy, true,
    'NK41: Ein Nenner, der mehrheitlich aus Gebuehren besteht, muss angezeigt werden');

  // NK42 · Die Stopweite ist die Zahl, die im Screenshot gefehlt hat.
  assert.strictEqual(g.stopPct, 0.268, 'NK42: Die Stopweite muss unveraendert durchgereicht werden');

  // NK43 · CRV ueber der Schwelle wird als pruefbeduerftig markiert.
  assert.strictEqual(g.crvInflated, true,
    `NK43: ${MRNA_TR.netCrv} : 1 liegt ueber ${C.CRV_INFLATION_WARN} und muss markiert werden`);

  // NK44 · Der Widerspruch aus R1.3: 12,3 % Weg gegen 3,4 % Struktur = Faktor 3,6.
  assert.ok(g.structFactor > 3.5 && g.structFactor < 3.7,
    `Faktor muss ~3,6 sein, ist ${g.structFactor}`);
  assert.strictEqual(g.conflict, true, 'NK44: Faktor 3,6 muss als Widerspruch gelten');

  /* NK45 · FAIL-CLOSED, der wichtigste Fall. Fehlende Daten duerfen nie
     etwas verbessern (Regel 4). Ohne Sizing ist NICHTS bewertbar — und
     „nicht bewertbar" ist nicht „in Ordnung" (Regel 5). Deshalb `null`,
     niemals `false`. Genau hier wuerde `Number(null) === 0` (Regel 2) einen
     Kostenanteil von 0 % erfinden und Entwarnung geben. */
  const empty = G({}, null, null);
  assert.strictEqual(empty.costHeavy, null, 'NK45: Ohne Sizing darf der Kostenanteil nicht als unauffaellig gelten');
  assert.strictEqual(empty.crvInflated, null, 'NK45: Ohne CRV darf nicht Entwarnung gegeben werden');
  assert.strictEqual(empty.conflict, null, 'NK45: Ohne Struktur darf kein Widerspruch VERNEINT werden');
  assert.strictEqual(empty.stopPct, null, 'NK45: Eine fehlende Stopweite ist nicht 0 %');
  assert.strictEqual(empty.costSharePct, null, 'NK45: Ein fehlender Kostenanteil ist nicht 0 %');

  // NK46 · Ein Nenner von 0 darf keine Division ergeben, sondern „nicht bewertbar".
  const zero = G({ structurePct: 0 }, { stopDistancePct: 0, stopLossAfterCosts: 0, stopCosts: 12 }, { netCrv: 0, tp2Pct: 0 });
  assert.strictEqual(zero.costSharePct, null, 'NK46: Nenner 0 darf keinen Kostenanteil erzeugen');
  assert.strictEqual(zero.conflict, null, 'NK46: Strukturpotenzial 0 ist nicht bewertbar, nicht widerspruchsfrei');

  // NK47 · Der unauffaellige Fall muss auch wirklich unauffaellig sein, sonst
  //        warnt die Anzeige immer und niemand liest sie mehr.
  const ok = G({ structurePct: 6.0 }, { stopDistancePct: 1.8, stopLossAfterCosts: 180, stopCosts: 20 }, { netCrv: 3.1, tp2Pct: 7.0 });
  assert.strictEqual(ok.costHeavy, false, 'NK47: 11 % Kostenanteil ist unauffaellig');
  assert.strictEqual(ok.crvInflated, false, 'NK47: 3,1 : 1 ist unauffaellig');
  assert.strictEqual(ok.conflict, false, 'NK47: Faktor 1,17 ist kein Widerspruch');
  assert.strictEqual(crvRowText(C, ok), '', 'NK47: Ohne Befund darf keine Zeile erscheinen');

  /* NK48 · Die Zeile muss den Befund WIRKLICH ausgeben — Text, nicht nur ein
     Muster im Quelltext. Und „nicht bewertbar" muss sichtbar sein, statt
     stillschweigend zu fehlen. */
  const shown = crvRowText(C, g);
  assert.match(shown, /Widerspruch/, 'NK48: Der Widerspruch muss in der Karte stehen');
  assert.match(shown, /Nenner/, 'NK48: Der Hinweis auf den Nenner muss in der Karte stehen');
  assert.match(shown, /Kostenanteil/, 'NK48: Der Kostenanteil muss in der Karte stehen');
  const thin = crvRowText(C, G({}, MRNA_SZ, { netCrv: 3.0, tp2Pct: null }));
  assert.match(thin, /nicht bewertbar/,
    'NK48: Ein nicht bewertbarer Strukturabgleich muss dastehen, nicht verschwinden');

  /* Die Grenze zur Handelslogik. R1.1 und R1.2 sind NICHT freigegeben —
     diese Version darf die Freigabe nachweislich nicht beruehrt haben. */
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const gate = app.slice(app.indexOf('function stockTradeability('), app.indexOf('const GLOSS = {'));
  assert.ok(!/crvGeometry|crvInflated|costHeavy|conflict/.test(gate),
    'Die Freigabelogik darf die Diagnose nicht lesen — sonst waere R1.1/R1.2 durch die Hintertuer gebaut');
  const lvl = app.slice(app.indexOf('function stockLevel('), app.indexOf('function stockLevel(') + 1400);
  assert.ok(!/crvGeometry/.test(lvl), 'stockLevel() bleibt unveraendert');
}

function crvRowText(C, g) {
  return String(C.crvGeometryRow(g)).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

console.log('✓ FusionPulse v3.32.8 CRV-Geometrie R1.3/R1.4 (ausgefuehrt): OK');

/* ═══ v3.32.10 · TWIN: DIE ZAHL, DIE ZWEI DINGE BEDEUTETE ═══════════════════
   Screenshot vom 01.09.: `Twin 0% · n=19 · 10 Titel · unabhaengig · lokal`.

   Zwei Befunde stecken darin. Erstens sagt `lokal`, dass die Zahl NICHT aus
   D1 kam, sondern aus dem Client-Rueckfall — die D1-Twins waren leer, und
   genau das behebt R3. Zweitens zaehlte der lokale Zweig auf `maxPct >= 5`,
   die alte 5-%-Marke, waehrend der D1-Zweig auf ECON_WIN_PCT (2,04 %) zaehlt.
   Dieselbe Kachel bedeutete je nach Datenquelle etwas anderes, und der
   Tooltip nannte nur die alte Zahl.

   Und „0 %" war ohnehin die falsche Zahl: 0 von 19 heisst statistisch
   hoechstens 16,8 %. Erst der Vergleich mit der noetigen Trefferquote macht
   daraus eine Aussage.                                                     */
{
  const { loadClient } = await import('./client-harness.mjs');
  const C = loadClient();
  /* Dieselben Schluessel wie `featureOf()`. Fehlt einer, ergibt `twinDist()`
     NaN und die Episode wird stillschweigend uebersprungen — die Fixture
     haette dann null Episoden geliefert und der Test waere aus dem falschen
     Grund gefallen. */
  const FEAT = { score:0, crv:0, rv:0, r15:0, r60:0, atr:0, vac:0, lag:0, crowd:null, crowdConfirm:null };

  /* NK67 · Client und Worker muessen dieselben wirtschaftlichen Schwellen
     rechnen. Sie sind an zwei Stellen implementiert — ohne diese Pruefung
     driften sie auseinander, und dann bedeutet „Twin %" wieder zweierlei. */
  {
    const w = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
    const num = (name) => {
      const m = w.match(new RegExp(`${name}\\s*=\\s*([^;]+);`));
      return m ? m[1] : null;
    };
    assert.equal(C.econWinPct(), 2.04, `NK67: Zielweite muss 2,04 % sein, ist ${C.econWinPct()}`);
    assert.equal(C.econStopPct(), -1.02, `NK67: Stop muss -1,02 % sein, ist ${C.econStopPct()}`);
    assert.ok(String(num('const ECON_NET_EUR')).includes('120'),
      'NK67: Beide Seiten muessen von derselben Zielgroesse ausgehen');
    assert.equal(C.econBreakEvenPct(), 56, `NK67: Break-even muss 56 % sein, ist ${C.econBreakEvenPct()}`);
  }

  /* NK68 · Der Boden. „Einfach groesser handeln" ist die naheliegende Antwort
     auf eine zu hohe Break-even-Quote — und sie ist falsch. Fixkosten
     verschwinden mit der Groesse, Reibung und Steuer nicht. */
  {
    const floor = C.econBreakEvenFloorPct();
    assert.ok(floor > 46 && floor < 48, `NK68: Der Boden muss bei rund 46,8 % liegen, ist ${floor}`);
    assert.ok(floor < C.econBreakEvenPct(),
      'NK68: Groesser handeln senkt den Break-even — aber nur bis zum Boden');
    assert.ok(C.wilsonUpperPct(0, 19) < floor,
      'NK68: Und bei 0 von 19 liegt selbst die Obergrenze unter dem Boden — keine Groesse hilft');
  }

  /* NK69 · Wilson: 0 Treffer sind nicht 0 %. Der haeufigste Fehlschluss in
     dieser App waere, aus einer Punktschaetzung von 0 eine Gewissheit zu
     machen — oder umgekehrt „zu wenig Daten" zu sagen, obwohl die Sache
     entschieden ist. */
  {
    assert.equal(C.wilsonUpperPct(0, 19), 16.8, `NK69: 0 von 19 muss 16,8 % ergeben, ist ${C.wilsonUpperPct(0,19)}`);
    assert.ok(C.wilsonUpperPct(0, 100) < C.wilsonUpperPct(0, 19),
      'NK69: Mehr Episoden muessen die Obergrenze senken');
    assert.strictEqual(C.wilsonUpperPct(0, 0), null,
      'NK69: Ohne Episoden gibt es keine Grenze — null, nicht 0');
  }

  /* NK70 · Der lokale Twin muss auf DIESELBE Schwelle zaehlen wie D1.
     Fixture: 19 unabhaengige Episoden, davon 4 zwischen 2,04 % und 5 %.
     Unter der alten Regel waeren das 0 Treffer, unter der richtigen 4. */
  {
    const mk = (i, maxPct) => ({ symbol: `S${i}`, sector: 'Tech', ts: Date.UTC(2026,0,1+i),
      maxPct, minPct: -0.5, f: FEAT });
    C.twinStore = { done: Array.from({length:19}, (_,i) => mk(i, i < 4 ? 3.1 : 0.4)) };
    const tw = C.historicalTwin({ symbol: 'S0', sector: 'Tech' });
    assert.equal(tw.source, 'local', 'Fixture muss den lokalen Zweig treffen');
    assert.equal(tw.n, 19, `NK70: 19 unabhaengige Episoden erwartet, waren ${tw.n}`);
    assert.equal(tw.hits, 4,
      `NK70: Vier Episoden ueber 2,04 % muessen zaehlen — unter der alten 5-%-Marke waeren es 0 (waren ${tw.hits})`);
    assert.equal(tw.winPct, 2.04, 'NK70: Und die Kachel muss sagen, auf welche Schwelle sie zaehlt');
  }

  /* NK71 · Fail-closed: `viable` darf nie `true` werden.
     Diese App erteilt keine Freigabe aus Statistik. Ein guter Twin ist ein
     fehlendes Gegenargument, kein Argument. */
  {
    const mk = (i, maxPct) => ({ symbol: `T${i}`, sector: 'Tech', ts: Date.UTC(2026,0,1+i),
      maxPct, minPct: -0.2, f: FEAT });
    C.twinStore = { done: Array.from({length:19}, (_,i) => mk(i, 9)) };   // alle Treffer
    const good = C.historicalTwin({ symbol: 'T0', sector: 'Tech' });
    assert.equal(good.hits, 19, 'Fixture: alle Episoden sind Treffer');
    assert.strictEqual(good.viable, null,
      'NK71: Selbst bei 19 von 19 Treffern darf nie `true` herauskommen — nur `false` oder `null`');
    assert.strictEqual(good.sizeHelps, null, 'NK71: Dasselbe fuer die Groessenfrage');
  }

  /* NK72 · Der Screenshot-Fall, in der Anzeige. 0 Treffer bei 19 Episoden:
     die Kachel muss die Obergrenze zeigen, die noetige Quote danebenstellen
     und das Urteil ausgeben. „0 %" allein waere weiterhin die falsche Zahl. */
  {
    const mk = (i) => ({ symbol: `U${i}`, sector: 'Tech', ts: Date.UTC(2026,0,1+i),
      maxPct: 0.3, minPct: -0.4, f: FEAT });
    C.twinStore = { done: Array.from({length:19}, (_,i) => mk(i)) };
    const tw = C.historicalTwin({ symbol: 'U0', sector: 'Tech' });
    assert.equal(tw.hits, 0, 'Fixture: keine Treffer');
    assert.strictEqual(tw.viable, false,
      'NK72: Liegt die Obergrenze unter dem Break-even, ist das Ergebnis entschieden');
    assert.strictEqual(tw.sizeHelps, false,
      'NK72: Und unter dem Boden heisst: auch mehr Kapital hilft nicht');
    const html = C.edgeStrip({ symbol: 'U0', sector: 'Tech' });
    const text = String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    assert.match(text, /≤16,8%|≤16\.8%/, 'NK72: Die Obergrenze muss in der Kachel stehen, nicht „0 %"');
    assert.match(text, /nötig 56%/, 'NK72: Und die noetige Trefferquote daneben');
    assert.match(text, /nicht bezahlbar/, 'NK72: Das Urteil muss ausgesprochen werden');
    assert.match(text, /auch nicht größer/, 'NK72: Einschliesslich der Antwort auf „dann eben groesser"');
  }

  /* NK73 · Ohne genug Episoden wird nichts behauptet. */
  {
    C.twinStore = { done: [] };
    const tw = C.historicalTwin({ symbol: 'V0', sector: 'Tech' });
    assert.ok(tw.n < 5, 'Fixture: zu wenige Episoden');
    assert.strictEqual(tw.viable, undefined,
      'NK73: Unter fuenf Episoden darf gar kein Urteil entstehen');
    const text = String(C.edgeStrip({ symbol: 'V0', sector: 'Tech' })).replace(/<[^>]*>/g, ' ');
    assert.match(text, /lernt/, 'NK73: Die Kachel muss sagen, dass sie noch lernt');
    assert.ok(!/nicht bezahlbar/.test(text), 'NK73: Und kein Urteil ausgeben');
  }
}

console.log('✓ FusionPulse v3.32.10 Twin-Auswertung (ausgefuehrt): OK');

console.log('✓ FusionPulse v3.29.0 evening-list geometry/study regressions: OK');
