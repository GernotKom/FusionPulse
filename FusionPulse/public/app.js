/* ============================================================================
   FusionPulse v2 — Frontend
   Ziel: von "Signal gesehen" zu "Order platziert" in unter 10 Sekunden.
   ========================================================================== */

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

/* ------------------------------------------------------------ Einstellungen */
const DEFAULTS = {
  equity: 5000, riskPct: 0.75, interval: 20000, deep: 20,
  sound: true, token: '', watch: 'BTC-EUR,ETH-EUR,SOL-EUR', minScore: 0, onlyZone: false,
};
const S = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('fp.settings') || '{}') };
const saveSettings = () => localStorage.setItem('fp.settings', JSON.stringify(S));

let rows = [];
let meta = {};
let timer = null;
let scanning = false;
let frozen = false;               // eingefroren, solange der Detail-Dialog offen ist
let ac = null;                    // EIN AudioContext, nicht pro Beep einer
const lightState = new Map();     // pair -> { light, streak, lastAlert }
const nodes = new Map();          // pair -> DOM-Kachel (Diff-Rendering)

/* ----------------------------------------------------------------- Formate */
const eur = (n, dp) => new Intl.NumberFormat('de-AT', {
  style: 'currency', currency: 'EUR',
  minimumFractionDigits: dp ?? (Math.abs(n) < 1 ? 5 : Math.abs(n) < 100 ? 3 : 2),
  maximumFractionDigits: dp ?? (Math.abs(n) < 1 ? 5 : Math.abs(n) < 100 ? 3 : 2),
}).format(n || 0);
const pct = (x, d = 2) => `${(x * 100).toFixed(d)} %`;
const sym = (p) => p.replace('-EUR', '');

/* --------------------------------------------------------------------- Ton */
function audio() {
  if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
  if (ac.state === 'suspended') ac.resume();
  return ac;
}
function beep(kind) {
  if (!S.sound) return;
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
  if (kind === 'green') { tone(784, 0.14); tone(1046, 0.16, 0.16); tone(1318, 0.22, 0.32); }
  else if (kind === 'zone') { tone(660, 0.12); tone(880, 0.14, 0.14); }
  else tone(520, 0.09, 0, 0.12);
}

/* ------------------------------------------------------- Positionsgrößen */
function sizing(r) {
  const riskEur = S.equity * (S.riskPct / 100);
  const perUnit = r.entry - r.stop;
  if (perUnit <= 0) return null;
  const qty = riskEur / perUnit;
  let notional = qty * r.entry;
  let capped = false;
  if (r.buyCapacity && notional > r.buyCapacity) { notional = r.buyCapacity; capped = true; }
  return {
    riskEur, qty: notional / r.entry, notional, capped,
    profit1: (r.tp1 - r.entry) * (notional / r.entry),
    profit2: (r.tp2 - r.entry) * (notional / r.entry),
  };
}

function orderPlan(r) {
  const s = sizing(r);
  const type = r.orderType === 'stop' ? 'STOP-BUY (Ausbruch)' : 'LIMIT-BUY (Rücksetzer)';
  return [
    `${sym(r.pair)} · ${r.setup}`,
    `${type}`,
    `Zone   ${eur(r.zoneLow)} – ${eur(r.zoneHigh)}`,
    `Entry  ${eur(r.entry)}`,
    `Stop   ${eur(r.stop)}  (-${r.riskPct} %)`,
    `TP1    ${eur(r.tp1)}   TP2 ${eur(r.tp2)}`,
    s ? `Größe  ${eur(s.notional, 2)} ≈ ${s.qty.toPrecision(6)} ${sym(r.pair)}${s.capped ? ' (auf Buchtiefe gedeckelt)' : ''}` : '',
    `CRV    ${r.netCRV}:1 netto · Kosten ${r.costPct} %`,
  ].filter(Boolean).join('\n');
}

async function copy(text, el) {
  try {
    await navigator.clipboard.writeText(text);
    if (el) { const o = el.textContent; el.textContent = '✓ kopiert'; setTimeout(() => (el.textContent = o), 1200); }
  } catch { /* Clipboard blockiert */ }
}

/* ------------------------------------------------------------------ Scannen */
let controller = null;
async function scan(force = false) {
  if (scanning || (frozen && !force)) return;
  scanning = true;
  controller?.abort();
  controller = new AbortController();
  const t0 = performance.now();
  $('#status').dataset.state = 'busy';

  try {
    const q = new URLSearchParams({ deep: S.deep, watch: S.watch });
    if (S.token) q.set('t', S.token);
    if (force) q.set('force', '1');
    const res = await fetch(`/api/scan?${q}`, { signal: controller.signal });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    rows = data.rows || [];
    meta = data;
    handleAlerts();
    render();

    const ms = Math.round(performance.now() - t0);
    $('#status').textContent = `${data.cached ? 'CACHE' : 'LIVE'} · ${data.deepCount}/${data.universe} · ${data.subrequests ?? '–'} req · ${ms} ms`;
    $('#status').dataset.state = 'ok';
    $('#stamp').textContent = new Date(data.ts).toLocaleTimeString('de-AT');
  } catch (e) {
    if (e.name === 'AbortError') return;
    $('#status').textContent = `Fehler: ${e.message}`;
    $('#status').dataset.state = 'err';
  } finally {
    scanning = false;
  }
}

/* --------------------------------------------- Alarme mit Hysterese/Cooldown
   Ein Signal muss ZWEI Scans halten, bevor es piept. Das eliminiert das
   Flackern an der Schwelle, das sonst zu Fehl-Einstiegen führt.            */
function handleAlerts() {
  const now = Date.now();
  for (const r of rows) {
    const st = lightState.get(r.pair) || { light: null, streak: 0, lastAlert: 0 };
    st.streak = r.light === st.light ? st.streak + 1 : 1;
    const rose = st.light !== 'green' && r.light === 'green';
    st.light = r.light;

    const cooled = now - st.lastAlert > 90_000;
    if (rose && st.streak >= 2 && cooled) { beep('green'); notify(r); st.lastAlert = now; }
    else if (r.light === 'green' && r.inZone && st.streak >= 2 && cooled) { beep('zone'); st.lastAlert = now; }
    lightState.set(r.pair, st);
  }
}

function notify(r) {
  if (Notification?.permission !== 'granted') return;
  new Notification(`${sym(r.pair)} · ${r.setup}`, {
    body: `Zone ${eur(r.zoneLow)}–${eur(r.zoneHigh)} · CRV ${r.netCRV}:1`,
    tag: r.pair, silent: true,
  });
}

/* ------------------------------------------------------------- Sparkline */
function sparkSvg(spark, light) {
  if (!spark?.length) return '';
  const w = 100, h = 26;
  const pts = spark.map((v, i) => `${((i / (spark.length - 1)) * w).toFixed(1)},${(h - (v / 100) * h).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.6" vector-effect="non-scaling-stroke"/>
  </svg>`;
}

/* -------------------------------------------------- Rendering (Diff-basiert)
   Kein innerHTML-Neuaufbau alle 20 s: Scrollposition, Fokus und CSS-
   Animationen bleiben erhalten, und das Tablet bleibt flüssig.            */
function visibleRows() {
  const q = $('#q').value.trim().toUpperCase();
  const f = $('#f').value;
  return rows.filter((r) =>
    (!q || r.pair.includes(q)) &&
    (!f || r.light === f) &&
    r.score >= S.minScore &&
    (!S.onlyZone || r.inZone));
}

function tileHtml(r) {
  const s = sizing(r);
  return `
    <div class="top"><span class="sym">${sym(r.pair)}</span><span class="score">${r.score.toFixed(1)}</span></div>
    <div class="price">${eur(r.price)}</div>
    ${sparkSvg(r.spark)}
    <div class="setup" title="${r.setup}">${r.orderType === 'stop' ? '▲' : '▼'} ${r.setup}</div>
    <div class="zone ${r.inZone ? 'active' : ''}">${eur(r.zoneLow)} – ${eur(r.zoneHigh)}</div>
    <div class="bar"><i style="width:${Math.min(100, r.premove * 10)}%"></i></div>
    <div class="meta">
      <span>Pre ${r.premove.toFixed(1)}</span>
      <span>${r.netCRV.toFixed(2)}R</span>
      <span>${s ? eur(s.notional, 0) : '–'}</span>
    </div>
    <div class="mini">
      <span title="Multi-Timeframe">MTF ${r.mtf}</span>
      <span title="Volumen-z">Vol ${r.volumeAcceleration}</span>
      <span title="Orderbuch-Imbalance">Buch ${r.bookScore}</span>
    </div>`;
}

function render() {
  const list = visibleRows();
  const grid = $('#grid');
  const seen = new Set();

  list.forEach((r, idx) => {
    seen.add(r.pair);
    let el = nodes.get(r.pair);
    if (!el) {
      el = document.createElement('div');
      el.className = 'tile';
      el.dataset.pair = r.pair;
      el.tabIndex = 0;
      el.addEventListener('click', () => openDetail(r.pair));
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter') openDetail(r.pair); });
      nodes.set(r.pair, el);
    }
    el.className = `tile ${r.light}${r.inZone ? ' inzone' : ''}`;
    el.innerHTML = tileHtml(r);
    if (grid.children[idx] !== el) grid.insertBefore(el, grid.children[idx] || null);
  });

  for (const [pair, el] of nodes) if (!seen.has(pair)) { el.remove(); nodes.delete(pair); }

  const c = { green: 0, yellow: 0, red: 0 };
  rows.forEach((r) => c[r.light]++);
  $('#gc').textContent = c.green; $('#yc').textContent = c.yellow; $('#rc').textContent = c.red;

  const reg = $('#regime');
  reg.textContent = `${meta.marketRegime || '–'} · Breadth ${Math.round((meta.breadth || 0) * 100)} %`;
  reg.className = `regime ${(meta.marketRegime || '').toLowerCase().replace('-', '')}`;

  renderRail(list);
  if ($('#modal').classList.contains('open')) refreshDetail();
}

/* --------------------------------------------------- Action-Rail: Top-Trades */
function renderRail(list) {
  const top = list.filter((r) => r.light !== 'red').slice(0, 3);
  $('#rail').innerHTML = top.length
    ? top.map((r) => {
        const s = sizing(r);
        return `<div class="railcard ${r.light}${r.inZone ? ' inzone' : ''}" data-pair="${r.pair}">
          <div class="rl"><b>${sym(r.pair)}</b><span>${r.setup}</span></div>
          <div class="rm">
            <span>${r.orderType === 'stop' ? 'Stop-Buy' : 'Limit'} ${eur(r.entry)}</span>
            <span>SL ${eur(r.stop)}</span>
            <span>${r.netCRV.toFixed(2)}R</span>
            <span>${s ? eur(s.notional, 0) : '–'}</span>
          </div>
          <button class="rcopy" data-pair="${r.pair}">⧉ Plan</button>
        </div>`;
      }).join('')
    : '<div class="railempty">Kein handelbares Setup — warten ist auch eine Position.</div>';

  $$('.rcopy').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const r = rows.find((x) => x.pair === b.dataset.pair);
    if (r) copy(orderPlan(r), b);
  }));
  $$('.railcard').forEach((c) => c.addEventListener('click', () => openDetail(c.dataset.pair)));
}

/* -------------------------------------------------------------- Detail-View */
let detailPair = null;
function openDetail(pair) { detailPair = pair; frozen = true; $('#modal').classList.add('open'); refreshDetail(); }
function closeDetail() { detailPair = null; frozen = false; $('#modal').classList.remove('open'); }

function factor(label, v, invert = false) {
  const good = invert ? 10 - v : v;
  const hue = 8 + good * 12;
  return `<div class="factor"><span>${label}</span>
    <div class="fbar"><i style="width:${v * 10}%;background:hsl(${hue} 78% 52%)"></i></div><b>${v.toFixed(1)}</b></div>`;
}

function refreshDetail() {
  const r = rows.find((x) => x.pair === detailPair);
  if (!r) return;
  const s = sizing(r);
  $('#detail').innerHTML = `
    <header class="dhead ${r.light}">
      <div><h2>${sym(r.pair)}</h2><p>${r.regime} · ${r.setup}</p></div>
      <div class="dscore"><b>${r.score.toFixed(1)}</b><span>Score</span></div>
    </header>

    ${r.blockers.length && r.light !== 'green'
      ? `<div class="blockers"><b>Nicht grün, weil:</b> ${r.blockers.join(' · ')}</div>` : ''}

    <div class="plan ${r.inZone ? 'inzone' : ''}">
      <div class="planrow"><span>Ordertyp</span><b>${r.orderType === 'stop' ? 'Stop-Buy über Widerstand' : 'Limit-Buy im Rücksetzer'}</b></div>
      <div class="planrow"><span>Einstiegszone</span><b>${eur(r.zoneLow)} – ${eur(r.zoneHigh)}</b></div>
      <div class="planrow"><span>Aktuell</span><b>${eur(r.price)} ${r.inZone ? '· IN DER ZONE' : ''}</b></div>
      <div class="planrow"><span>Stop-Loss</span><b>${eur(r.stop)} (−${r.riskPct} %)</b></div>
      <div class="planrow"><span>TP1 / TP2</span><b>${eur(r.tp1)} / ${eur(r.tp2)} <small>(${r.tp2Source})</small></b></div>
      <div class="planrow"><span>Netto-CRV</span><b>${r.netCRV}:1 &nbsp;(TP1 ${r.netCRV1}:1)</b></div>
      <div class="planrow"><span>Kosten roundtrip</span><b>${r.costPct} % <small>(Fee ${meta.feeBps} bps + Spread + Slippage)</small></b></div>
      <div class="planrow"><span>Stop / Kosten</span><b class="${r.costRatio < 2.5 ? 'bad' : ''}">${r.costRatio}×</b></div>
    </div>

    ${s ? `<div class="size">
      <div><span>Risiko</span><b>${eur(s.riskEur, 2)}</b></div>
      <div><span>Positionsgröße</span><b>${eur(s.notional, 0)}</b></div>
      <div><span>Menge</span><b>${s.qty.toPrecision(6)}</b></div>
      <div><span>Gewinn TP2</span><b>${eur(s.profit2, 2)}</b></div>
      ${s.capped ? '<div class="warn">Auf Orderbuchtiefe gedeckelt — größer würde spürbar slippen.</div>' : ''}
    </div>` : ''}

    <div class="actions">
      <button class="primary" id="cp">⧉ Order-Plan kopieren</button>
      <button id="cpEntry">⧉ ${eur(r.entry)}</button>
      <button id="cpStop">⧉ SL</button>
      <button id="cpQty">⧉ Menge</button>
    </div>

    <h3>Faktoren</h3>
    ${factor('Multi-Timeframe', r.mtf)}
    ${factor('Volumen-Beschleunigung', r.volumeAcceleration)}
    ${factor('Relative Stärke (BTC)', r.relativeStrength)}
    ${factor('Kompression', r.compression)}
    ${factor('Trendqualität', r.trendQuality)}
    ${factor('Orderbuch-Druck', r.bookScore)}
    ${factor('Liquidität', r.liquidity)}
    ${factor('Erschöpfung', r.exhaustion, true)}

    <h3>Mikrostruktur</h3>
    <div class="metrics">
      <div class="metric">Spread<b>${r.spreadPct != null ? pct(r.spreadPct, 3) : '–'}</b></div>
      <div class="metric">Slippage 2k€<b>${r.slipBps != null ? r.slipBps + ' bps' : '–'}</b></div>
      <div class="metric">Kauftiefe ≤0,15 %<b>${r.buyCapacity != null ? eur(r.buyCapacity, 0) : '–'}</b></div>
      <div class="metric">Ausstiegstiefe<b>${r.sellCapacity != null ? eur(r.sellCapacity, 0) : '–'}</b></div>
      <div class="metric">Imbalance<b>${r.imbalance > 0 ? '+' : ''}${(r.imbalance * 100).toFixed(0)} %</b></div>
      <div class="metric">VWAP-Abstand<b>${r.vwapDev} ATR</b></div>
      <div class="metric">RSI(14)<b>${r.rsi}</b></div>
      <div class="metric">ATR<b>${r.atrPct} %</b></div>
    </div>

    <div class="journalbox">
      <button id="jlog">In Journal eintragen</button>
      <small>Lokal im Browser. Kein Auto-Trading — die Order setzt du in Bitpanda selbst.</small>
    </div>`;

  $('#cp').onclick = (e) => copy(orderPlan(r), e.target);
  $('#cpEntry').onclick = (e) => copy(String(r.entry), e.target);
  $('#cpStop').onclick = (e) => copy(String(r.stop), e.target);
  $('#cpQty').onclick = (e) => copy(s ? String(s.qty) : '0', e.target);
  $('#jlog').onclick = () => logTrade(r, s);
}

/* --------------------------------------------------------------- Journal */
function logTrade(r, s) {
  const j = JSON.parse(localStorage.getItem('fp.journal') || '[]');
  j.unshift({
    ts: Date.now(), pair: r.pair, setup: r.setup, regime: r.regime,
    entry: r.entry, stop: r.stop, tp1: r.tp1, tp2: r.tp2,
    score: r.score, premove: r.premove, crv: r.netCRV,
    notional: s?.notional ?? null, market: meta.marketRegime,
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

/* ------------------------------------------------- Bar-Close-Countdown ---
   Für Daytrading entscheidend: die meisten Fehlsignale entstehen, wenn man
   mitten in einer Kerze einsteigt. Die Uhr zeigt, wann die 5m-Kerze schließt. */
setInterval(() => {
  const s = 300 - Math.floor((Date.now() / 1000) % 300);
  const el = $('#barclock');
  el.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  el.classList.toggle('soon', s <= 30);
}, 1000);

/* ------------------------------------------------------------ Einstellungen */
function openSettings() {
  $('#sEquity').value = S.equity; $('#sRisk').value = S.riskPct;
  $('#sDeep').value = S.deep; $('#sWatch').value = S.watch;
  $('#sToken').value = S.token; $('#sMin').value = S.minScore;
  $('#sZone').checked = S.onlyZone;
  $('#settings').classList.add('open');
}
function applySettings() {
  S.equity = +$('#sEquity').value || DEFAULTS.equity;
  S.riskPct = +$('#sRisk').value || DEFAULTS.riskPct;
  S.deep = Math.min(30, Math.max(4, +$('#sDeep').value || DEFAULTS.deep));
  S.watch = $('#sWatch').value.toUpperCase().replace(/\s/g, '');
  S.token = $('#sToken').value.trim();
  S.minScore = +$('#sMin').value || 0;
  S.onlyZone = $('#sZone').checked;
  saveSettings(); $('#settings').classList.remove('open'); scan(true);
}

/* --------------------------------------------------------------- Wake Lock */
let wl = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator) { wl = await navigator.wakeLock.request('screen'); }
    else { await wl?.release(); wl = null; }
  } catch { /* nicht unterstützt */ }
  $('#wake').classList.toggle('on', !!wl);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && wl === null && $('#wake').classList.contains('on')) keepAwake(true); });

/* ---------------------------------------------------------------- Intervall */
function setInterval_(ms) {
  clearInterval(timer);
  S.interval = ms; saveSettings();
  timer = setInterval(() => { if (document.visibilityState === 'visible') scan(); }, ms);
}

/* ----------------------------------------------------------------- Hotkeys */
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input,select,textarea')) { if (e.key === 'Escape') e.target.blur(); return; }
  switch (e.key) {
    case ' ': e.preventDefault(); scan(true); break;
    case '/': e.preventDefault(); $('#q').focus(); break;
    case '1': $('#f').value = 'green'; render(); break;
    case '2': $('#f').value = 'yellow'; render(); break;
    case '3': $('#f').value = 'red'; render(); break;
    case '0': $('#f').value = ''; render(); break;
    case 'z': S.onlyZone = !S.onlyZone; saveSettings(); render(); break;
    case 'm': $('#sound').click(); break;
    case 'c': { const t = visibleRows().find((r) => r.light !== 'red'); if (t) copy(orderPlan(t)); break; }
    case 'Escape': closeDetail(); $('#settings').classList.remove('open'); break;
    default: break;
  }
});

/* ------------------------------------------------------------------- Events */
$('#scan').onclick = () => scan(true);
$('#sound').onclick = () => {
  S.sound = !S.sound; saveSettings();
  $('#sound').textContent = S.sound ? '🔊' : '🔇';
  if (S.sound) { audio(); beep('tick'); }
};
$('#wake').onclick = () => keepAwake(!wl);
$('#cog').onclick = openSettings;
$('#sApply').onclick = applySettings;
$('#sExport').onclick = exportJournal;
$('#sClose').onclick = () => $('#settings').classList.remove('open');
$('#q').oninput = render;
$('#f').onchange = render;
$('#iv').onchange = () => setInterval_(+$('#iv').value);
$('#x').onclick = closeDetail;
$('#modal').onclick = (e) => { if (e.target.id === 'modal') closeDetail(); };
document.body.addEventListener('pointerdown', () => audio(), { once: true });

/* --------------------------------------------------------------------- Boot */
$('#sound').textContent = S.sound ? '🔊' : '🔇';
$('#iv').value = String(S.interval);
if ('Notification' in window && Notification.permission === 'default') {
  document.body.addEventListener('pointerdown', () => Notification.requestPermission(), { once: true });
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
scan(true);
setInterval_(S.interval);
