import assert from 'node:assert/strict';
import fs from 'node:fs';
import { analyse, analyseStock } from '../src/worker.js';

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
assert.match(app,/crowdMap\.delete\(sym\)/,'Crowd-Werte müssen vor einer neuen Abfrage invalidiert werden');
assert.match(app,/\$\{eur\(eurVal, d\)\}.*\(\$\{usd\(usdVal, d\)\}\)/s,'Aktienkurse müssen EUR zuerst und USD in Klammern anzeigen');


assert.match(app,/if \(data\.length === 1\)/,'Sparkline muss einen Einzelwert ohne Division durch 0 behandeln');
assert.match(app,/const opportunityEligible=stockOpportunity\(r\)\.ready/,'Opportunity-Regel darf im Tonpfad nicht doppelt implementiert sein');
assert.match(app,/function setMiniStatus\(/,'Tiingo-/Header-Ministatus-Helfer muss definiert sein');
const index=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
assert.match(index,/id="regime" class="regime-btn fast-tip"/,'Risk-Regime muss schnellen Tooltip verwenden');
assert.match(index,/id="miniTiingo" class="mini-dot busy fast-tip"/,'Tiingo-T muss schnellen Tooltip verwenden');
assert.match(index,/class="hclock fast-tip"/,'Countdown muss schnellen Tooltip verwenden');

// v3.1.7 UI/data guards
assert.match(app, /OPPORTUNITY_MIN_NET_EUR\s*=\s*350/, 'Opportunity floor must remain explicit');
assert.match(app, /BOATS \$\{mark\(boats\)\}/, 'Tiingo UI must report BOATS separately');
const workerText=fs.readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');
assert.match(workerText, /out\.tests\.boats=/, 'Tiingo validation must test BOATS separately');
assert.doesNotMatch(workerText, /d\.values\.length>=24/, 'Tiingo 5-min validation must not use the arbitrary 24-bar gate');
assert.match(workerText, /const usable=vals\.length>=2 && ohlcKnown/, 'Tiingo 5-min validation must test actual bar usability');
assert.match(app, /letzter Bar vor/, 'Tiingo UI must expose bar count/freshness for diagnosis');
assert.match(app, /UNTER ZONE = Kurs liegt noch unter/, 'Zone tooltip must explain below/in/above');
assert.match(app, /Pullback: Der Kurs ist zuerst gestiegen/, 'Pullback tooltip must be novice-readable');


// v3.2.0 Tiingo Primary / Discovery guards
const wrangler=fs.readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8');
assert.match(wrangler,/"TIINGO_STOCKS_MODE": "primary"/,'v3.2.0 must deploy with Tiingo Primary enabled');
assert.match(workerText,/Discovery only: unusual overnight move[\s\S]*NEVER enters analyseStock\/BUY/,'BOATS discovery must be explicitly isolated from BUY');
assert.match(workerText,/row\.discovery=\{\.\.\.discMap\.get\(sym\),buyWeight:0\}/,'BOATS candidate metadata must carry 0 BUY weight');
assert.match(workerText,/const syms=\[\.\.\.favPick,\.\.\.discoveryPick,\.\.\.base\]\.slice\(0,20\)/,'Deep scan must cap candidate batch at 20');
assert.match(workerText,/source IN \('Twelve Data','Tiingo IEX'\)/,'Learning must accept Tiingo IEX history after Primary migration');

console.log('✓ FusionPulse safety regressions: OK');
