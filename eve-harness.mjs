import fs from 'node:fs';

const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
function sliceFn(src, header) {
  const i = src.indexOf(header);
  if (i < 0) throw new Error('nicht gefunden: ' + header);
  let d = 0, started = false;
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (ch === '{') { d++; started = true; }
    else if (ch === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  throw new Error('kein Ende: ' + header);
}
const cut = (a, b) => worker.slice(worker.indexOf(a), worker.indexOf(b));

export function loadEve() {
  const r2 = (x) => Math.round(x * 100) / 100;
  const src = [
    cut('const PICK_COST = {', 'const LEGACY_WIN_PCT = 5;'),
    sliceFn(worker, 'function wilsonLower('),
    cut('const PICK = {', 'const pickCfg ='),
    cut('const pickCfg =', '/** Wilson-OBERgrenze'),
    sliceFn(worker, 'function breakEvenHitRate('),
    cut('function costLoadPct(', '/* ---------------------------------------------------------------------------\n   v3.21.0'),
    cut('const RIDE = {', 'async function rideNow('),
    'const posNum = ' + worker.slice(worker.indexOf('const posNum = ('), worker.indexOf('};', worker.indexOf('const posNum = ('))).slice('const posNum = '.length) + '};',
    cut('const EVE = {', 'async function eveningList('),
    'return {EVE,EVE_KINDS,eveBars,eveAtr,evePivotHighs,eveGeometry,eveCheck,eveCandidate,'
    + 'eveStudyOne,eveStudySummary,eveUniverse,rideSize,pickCfg,requiredMovePct,netEurAtMove,'
    + 'lossEurAtStop,breakEvenHitRate,ECON_MIN_REWARD_RISK,PICK_COST,wilsonLower,rankPicks,pickTier};',
  ].join('\n');
  return new Function('r2', 'safeRadarSymbol', 'STOCK_SEARCH_CATALOG', src)(
    r2,
    (s) => { const x = String(s || '').trim().toUpperCase(); return /^[A-Z0-9.\-]{1,12}$/.test(x) ? x : null; },
    [['Technologie', 'KAT1', 'Katalog Eins'], ['Pharma', 'KAT2', 'Katalog Zwei']],
  );
}
