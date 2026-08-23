/* ============================================================================
   FusionPulse v2.3 — Frontend
   Leitgedanke: das Auge soll nicht 20 gleichwertige Kacheln absuchen müssen.
   Drei Ebenen: EIN Fokus-Setup (groß) → 2D-Karte (Position = Bedeutung) →
   dichte Liste (ausgerichtete Spalten). Handeln ohne Modal.
   ========================================================================== */

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

/* ------------------------------------------------------------ Einstellungen */
const DEFAULTS = {
  equity: 5000, riskPct: 0.75, interval: 20000, deep: 20,
  sound: true, token: '', watch: 'BTC-EUR,ETH-EUR,SOL-EUR', minQ: 0, onlyZone: false,
  theme: 'dark', taxPct: 27.5, analysisMode: 'composite', coinCount: 12, stockCount: 12,
};
const S = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('fp.settings') || '{}') };
const saveSettings = () => localStorage.setItem('fp.settings', JSON.stringify(S));

let rows = [];
let meta = {};
let timer = null;
let scanning = false;
let selected = null;        // aktuell fokussiertes Paar
let pinned = false;         // vom Nutzer gewählt → nicht automatisch wegspringen
let showRest = false;
let ac = null;

const state = new Map();    // pair -> { light, since, quality, prevQ, streak, lastAlert }
const rowNodes = new Map(); // pair -> DOM-Zeile

/* ----------------------------------------------------------------- Formate */
const dp = (n) => (Math.abs(n) < 1 ? 5 : Math.abs(n) < 100 ? 3 : 2);
const eur = (n, d) => new Intl.NumberFormat('de-AT', {
  style: 'currency', currency: 'EUR',
  minimumFractionDigits: d ?? dp(n), maximumFractionDigits: d ?? dp(n),
}).format(n || 0);
const num = (n, d) => new Intl.NumberFormat('de-AT', {
  minimumFractionDigits: d ?? dp(n), maximumFractionDigits: d ?? dp(n),
}).format(n || 0);
const sym = (p) => p.replace('-EUR', '');
const mins = (ms) => {
  const m = Math.floor(ms / 60000);
  return m < 1 ? 'neu' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h`;
};

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
  if (kind === 'crv8') { tone(1046,.13); tone(1318,.13,.14); tone(1568,.20,.28,.24); }
  else if (kind === 'crv76') { tone(880,.14); tone(1175,.20,.16,.22); }
  else if (kind === 'green') { tone(784, .14); tone(1046, .16, .16); tone(1318, .22, .32); }
  else if (kind === 'zone') { tone(660, .12); tone(880, .14, .14); }
  else tone(520, .09, 0, .12);
}

/* ------------------------------------------------------- Positionsgrößen */
function sizing(r) {
  const riskEur = S.equity * (S.riskPct / 100);
  const perUnit = r.entry - r.stop;
  if (perUnit <= 0) return null;
  let notional = (riskEur / perUnit) * r.entry;
  let capped = false;
  if (r.buyCapacity && notional > r.buyCapacity) { notional = r.buyCapacity; capped = true; }
  const qty = notional / r.entry;
  return {
    riskEur, qty, notional, capped,
    profit1: (r.tp1 - r.entry) * qty,
    profit2: (r.tp2 - r.entry) * qty,
    netProfit1: Math.max(0, (r.tp1 - r.entry) * qty) * (1 - S.taxPct / 100),
    netProfit2: Math.max(0, (r.tp2 - r.entry) * qty) * (1 - S.taxPct / 100),
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
    s ? `Größe  ${eur(s.notional, 2)}  ≈ ${s.qty.toPrecision(6)} ${sym(r.pair)}${s.capped ? '  [auf Buchtiefe gedeckelt]' : ''}` : '',
    `CRV    ${r.netCRV}:1 netto · Kosten ${r.costPct} %`,
    s ? `Gewinn TP2 nach ${S.taxPct}% Steuer (Schätzung)  ${eur(s.netProfit2, 2)}` : '',
  ].filter(Boolean).join('\n');
}

async function copy(text, el) {
  try {
    await navigator.clipboard.writeText(text);
    if (el) { const o = el.textContent; el.textContent = '✓ kopiert'; setTimeout(() => (el.textContent = o), 1200); }
    beep('tick');
  } catch { /* Clipboard blockiert */ }
}

/* ------------------------------------------------------------------ Scannen */
let controller = null;
function showQuotaWarning(kind, detail = '') {
  const modal = $('#quotaModal');
  const text = $('#quotaText');
  if (!modal || !text) return;
  const cpu = kind === 'cpu';
  text.innerHTML = cpu
    ? `<p><b>Cloudflare Free CPU-Limit wahrscheinlich erreicht.</b></p><p>Der Free-Plan erlaubt nur sehr wenig CPU-Zeit pro Worker-Aufruf. Verringere zuerst den Tiefen-Scan und/oder erhöhe das Scan-Intervall. Falls der Scanner trotzdem regelmäßig abbricht, ist Workers Paid die sinnvolle nächste Stufe.</p><p class="hint">Deine Bitpanda-READ-Berechtigung und deine Secrets bleiben davon unverändert.</p>`
    : `<p><b>Cloudflare Free Request-Limit / Rate-Limit möglicherweise erreicht.</b></p><p>Der Scanner pausiert nicht automatisch auf einen Bezahlplan. Auf Free schlagen weitere Worker-Aufrufe nach Erreichen des Limits fehl. Der Tageszähler wird von Cloudflare zurückgesetzt.</p><p class="hint">${detail || 'Prüfe Cloudflare → Workers & Pages → fusionpulse → Kennzahlen/Nutzung.'}</p>`;
  modal.classList.add('open');
}

async function loadVersion(){
  try {
    const q = new URLSearchParams(); if (S.token) q.set('t', S.token);
    const r = await fetch('/api/health?' + q);
    const h = await r.json();
    if (h.version) { $('#appver').textContent = 'v' + h.version; const v=$('#settingsVer'); if(v) v.textContent='v'+h.version; }
  } catch {}
}

async function scan(force = false) {
  if (scanning) return;
  scanning = true;
  controller?.abort();
  controller = new AbortController();
  const t0 = performance.now();
  $('#status').dataset.state = 'busy';

  try {
    const q = new URLSearchParams({ deep: S.deep, watch: S.watch, mode: S.analysisMode });
    if (S.token) q.set('t', S.token);
    if (force) q.set('force', '1');
    const res = await fetch(`/api/scan?${q}`, { signal: controller.signal });
    const data = await res.json();
    if (!res.ok) { if (res.status === 429) showQuotaWarning('requests'); throw new Error(data.error || `HTTP ${res.status}`); }

    rows = data.rows || [];
    meta = data;
    track();
    render();

    $('#status').textContent = `${data.cached ? 'Cache' : 'Live'} · ${data.deepCount}/${data.universe} Coins · ${data.requests ?? '–'} API-Unterabfragen · ${Math.round(performance.now() - t0)} ms`;
    $('#status').dataset.state = 'ok';
    $('#stamp').textContent = new Date(data.ts).toLocaleTimeString('de-AT');
  } catch (e) {
    if (e.name === 'AbortError') return;
    const msg=String(e.message||e); $('#status').textContent = `Fehler: ${msg}`; if (/cpu|exceeded|resource|1102/i.test(msg)) showQuotaWarning('cpu', msg); else if (/429|too many|limit/i.test(msg)) showQuotaWarning('requests', msg);
    $('#status').dataset.state = 'err';
  } finally {
    scanning = false;
  }
}

/* ------------------------------------------------- Reifezeit + Alarmierung
   Ein Setup, das seit drei Stunden hält, ist eine gespannte Feder.
   Eines, das seit zehn Minuten besteht, ist Rauschen. Die Zeit im Zustand
   ist eine Dimension, die klassische Indikatoren strukturell nicht sehen. */
function track() {
  const now = Date.now();
  for (const r of rows) {
    const st = state.get(r.pair) || { light: null, since: now, quality: r.quality, prevQ: r.quality, streak: 0, lastAlert: 0 };
    if (st.light !== r.light) { st.since = now; st.streak = 1; } else st.streak++;
    const rose = st.light && st.light !== 'green' && r.light === 'green';
    st.prevQ = st.quality; st.quality = r.quality;
    st.light = r.light;

    const cooled = now - st.lastAlert > 90_000;
    const crvBand = r.netCRV >= 8.0 ? 2 : r.netCRV > 7.6 ? 1 : 0;
    if (crvBand > (st.crvBand || 0) && cooled) { beep(crvBand === 2 ? 'crv8' : 'crv76'); notify(r); st.lastAlert = now; }
    else if (rose && st.streak >= 2 && cooled) { beep('green'); notify(r); st.lastAlert = now; }
    else if (r.light === 'green' && r.inZone && st.streak >= 2 && cooled) { beep('zone'); st.lastAlert = now; }
    st.crvBand = crvBand;
    state.set(r.pair, st);

    r._age = now - st.since;
    r._delta = st.quality - st.prevQ;
  }
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
  const pts = data.map((v, i) => `${((i / (data.length - 1)) * w).toFixed(1)},${(h - (v / 100) * (h - 2) - 1).toFixed(1)}`).join(' ');
  return `<svg class="spk" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.4" vector-effect="non-scaling-stroke"/></svg>`;
}

/* ---------------------------------------------------------- Zonenlage-Balken
   Zeigt in einem Blick: liegt der Preis unter, in oder über der Zone?
   Kein Zahlenvergleich nötig — Position auf dem Balken genügt.          */
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

/* -------------------------------------------------------------- Preisleiter
   Die einzige Grafik, die im Trade wirklich zählt: wo stehe ich relativ
   zu Stop, Zone und Zielen. Lesbar ohne eine einzige Zahl.             */
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
  el.className = `focus ${r.light}${r.inZone ? ' inzone' : ''}`;
  el.innerHTML = `
    <div class="fmain">
      <div class="fhead">
        <div>
          <h2>${sym(r.pair)} <small>${num(r.price)}</small></h2>
          <p class="fsetup">${r.orderType === 'stop' ? '▲ Stop-Buy' : '▼ Limit-Buy'} · ${r.setup}</p>
        </div>
        <div class="fpins">
          <span class="pin q" title="Setup-Qualität">Q <b>${r.quality}</b></span>
          <span class="pin h" title="Handelbarkeit">H <b>${r.executability}</b></span>
          <span class="pin age" title="Wie lange hält dieser Zustand schon">${mins(r._age)}</span>
        </div>
      </div>

      ${r.light !== 'green' && r.blockers.length
        ? `<div class="fblock"><b>Nicht handeln, weil:</b> ${r.blockers.join(' · ')}</div>` : ''}

      <div class="fgrid">
        <div title="Einstiegszone: Preisbereich, in dem der geplante Kauf sinnvoll wird."><span>Einstiegszone</span><b>${num(r.zoneLow)} – ${num(r.zoneHigh)}</b></div>
        <div title="Kaufsumme: empfohlener Euro-Einsatz aus Konto-Einstellung, Risikoabstand und Orderbuchtiefe."><span>Kaufsumme</span><b>${s ? eur(s.notional, 0) : '–'}</b></div>
        <div title="Netto-CRV: erwarteter Ertrag im Verhältnis zum Risiko, nachdem geschätzte Kosten berücksichtigt wurden."><span>Netto-CRV</span><b class="${r.netCRV >= 1.8 ? 'good' : 'bad'}">${r.netCRV}:1</b></div>
        <div title="Maximaler rechnerischer Verlust bis zum Stop-Loss bei der vorgeschlagenen Positionsgröße."><span>Risiko bis SL</span><b>${s ? eur(s.realRisk, 0) : '–'} · ${r.riskPct} %</b></div>
        <div title="Geschätzte Handelskosten aus Spread, Slippage und Gebühren; × zeigt die Kosten-Deckung."><span>Kosten</span><b class="${r.costRatio < 2.5 ? 'bad' : ''}">${r.costPct} % · ${r.costRatio}×</b></div>
        <div title="Slippage: erwartete Preisabweichung durch die Ausführung im Orderbuch, angegeben in Basispunkten."><span>Slippage</span><b>${r.slipBps != null ? r.slipBps + ' bps' : '–'}</b></div>
        <div title="Geschätzter Gewinn bei TP2 nach dem in den Einstellungen hinterlegten Steuersatz."><span>TP2 Gewinn netto*</span><b class="good">${s ? eur(s.netProfit2, 0) : '–'}</b></div>
        <div title="Aktivierter Analysemodus. Sicherheitsfilter wie Liquidität, Spread und Kosten bleiben aktiv."><span>Analyse</span><b>${r.analysisMode || S.analysisMode}</b></div>
      </div>
      <small class="taxnote">* Schätzung mit ${S.taxPct}% auf positiven Gewinn; keine Steuerberatung.</small>
      <div class="tradeplan" title="Konkreter manueller Trade-Plan. TP1 = erster Teilverkauf; TP2 = zweiter/finaler Teilverkauf.">
        <b>${r.light === 'green' ? 'KAUF-PLAN' : 'BEOBACHTUNGS-PLAN'}</b>
        <span>Kaufsumme <strong>${s ? eur(s.notional,0) : '–'}</strong></span>
        <span>Entry <strong>${num(r.entry)}</strong></span>
        <span>Stop-Loss <strong>${num(r.stop)}</strong></span>
        <span title="TP1 = Take Profit 1: erster Teilverkauf. Standardmäßig z. B. 50 % der Position, sofern du keine andere Tranchierung festlegst.">TP1 · Teilverkauf 1 <strong>${num(r.tp1)}</strong></span>
        <span title="TP2 = Take Profit 2: zweiter bzw. finaler Teilverkauf der Restposition.">TP2 · Restverkauf <strong>${num(r.tp2)}</strong></span>
      </div>

      <div class="factions">
        <button class="primary" id="fcopy">⧉ Order-Plan kopieren</button>
        <button id="fentry">⧉ ${num(r.entry)}</button>
        <button id="fstop">⧉ Stop</button>
        <button id="fqty">⧉ Menge</button>
        <button id="fdet">Details</button>
      </div>
      ${s?.capped ? '<p class="fwarn">Auf Orderbuchtiefe gedeckelt — größer würde spürbar slippen.</p>' : ''}
    </div>
    ${ladder(r)}`;

  $('#fcopy').onclick = (e) => copy(orderPlan(r), e.target);
  $('#fentry').onclick = (e) => copy(String(r.entry), e.target);
  $('#fstop').onclick = (e) => copy(String(r.stop), e.target);
  $('#fqty').onclick = (e) => copy(s ? String(s.qty) : '0', e.target);
  $('#fdet').onclick = () => openDetail(r.pair);

  $('#dsym').textContent = sym(r.pair);
  $('#dplan').textContent = `${r.orderType === 'stop' ? 'Stop' : 'Limit'} ${num(r.entry)} · SL ${num(r.stop)} · ${s ? eur(s.notional, 0) : '–'}`;
  $('#dock').classList.remove('hidden');
  $('#dock').className = `dock ${r.light}`;
}

/* --------------------------------------------------------------- 2D-Karte */
function renderMap() {
  const svg = $('#map');
  const g = (x) => 12 + (x / 10) * 176;          // 0..10 → Pixel
  const dots = rows.map((r) => {
    const cx = g(r.executability).toFixed(1);
    const cy = (200 - g(r.quality)).toFixed(1);
    const sel = r.pair === selected;
    const rad = sel ? 7 : r.light === 'green' ? 5.5 : 4;
    return `<g class="dot q-${r.quadrant} ${sel ? 'sel' : ''}" data-pair="${r.pair}">
      <circle cx="${cx}" cy="${cy}" r="${rad + 6}" fill="transparent"/>
      <circle cx="${cx}" cy="${cy}" r="${rad}"/>
      ${sel || r.light === 'green' ? `<text x="${cx}" y="${(+cy - rad - 4).toFixed(1)}">${sym(r.pair)}</text>` : ''}
    </g>`;
  }).join('');

  svg.innerHTML = `
    <rect class="quad qa" x="100" y="0"   width="100" height="100"/>
    <rect class="quad qb" x="0"   y="0"   width="100" height="100"/>
    <rect class="quad qc" x="100" y="100" width="100" height="100"/>
    <line class="ax" x1="100" y1="0" x2="100" y2="200"/>
    <line class="ax" x1="0" y1="100" x2="200" y2="100"/>
    ${dots}`;

  $$('#map .dot').forEach((d) => d.addEventListener('click', () => select(d.dataset.pair, true)));
}

/* ------------------------------------------------------------ Dichte Liste */
function visible() {
  const q = $('#q').value.trim().toUpperCase();
  const f = $('#f').value;
  return rows.filter((r) =>
    (!q || r.pair.includes(q)) &&
    (!f || r.light === f) &&
    r.quality >= S.minQ &&
    (!S.onlyZone || r.inZone));
}

function rowHtml(r) {
  const s = sizing(r);
  const d = r._delta > 0.4 ? '<i class="up">▲</i>' : r._delta < -0.4 ? '<i class="dn">▼</i>' : '';
  return `
    <span class="c-sym"><b class="dotc ${r.light}"></b>${sym(r.pair)}${d}</span>
    <span class="c-spk">${spark(r.spark)}</span>
    <span class="c-set">${r.orderType === 'stop' ? '▲' : '▼'} ${r.setup}</span>
    <span class="c-age ta">${mins(r._age)}</span>
    <span class="c-zone">${zoneBar(r)}</span>
    <span class="c-r ta ${r.netCRV >= 1.8 ? 'good' : ''}">${r.netCRV.toFixed(1)}</span>
    <span class="c-sz ta">${s ? eur(s.notional, 0) : '–'}</span>
    <span class="c-qh ta"><b>${r.quality}</b><i>·</i>${r.executability}</span>
    <span class="tradepeek"><b>${sym(r.pair)} · ${r.setup}</b><br>
      Einsatz ${s ? eur(s.notional,0) : '–'} · Entry ${num(r.entry)} · SL ${num(r.stop)} · TP1 ${num(r.tp1)} · TP2 ${num(r.tp2)}<br>
      CRV ${r.netCRV}:1 · TP2 nach Steuer* ${s ? eur(s.netProfit2,0) : '–'}
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
    el.className = `row ${r.light}${r.pair === selected ? ' sel' : ''}${r.inZone ? ' inzone' : ''}`;
    el.innerHTML = rowHtml(r);
    if (container.children[i] !== el) container.insertBefore(el, container.children[i] || null);
  });
  [...container.children].forEach((el) => {
    if (!seen.has(el.dataset.pair)) { el.remove(); rowNodes.delete(el.dataset.pair); }
  });
}

/* ------------------------------------------------------------------ Render */
function render() {
  // Auto-Fokus auf das beste Setup, solange der Nutzer nichts angeheftet hat
  if (!pinned || !rows.some((r) => r.pair === selected)) {
    const best = rows.find((r) => r.light === 'green') || rows.find((r) => r.light === 'yellow') || rows[0];
    selected = best?.pair ?? null;
  }
  const reg = $('#regime');
  reg.textContent = `${meta.marketRegime || '–'} · ${Math.round((meta.breadth || 0) * 100)} % über VWAP`;
  reg.className = (meta.marketRegime || '').toLowerCase().replace('-', '');

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

function factor(label, v, invert = false) {
  const good = invert ? 10 - v : v;
  return `<div class="factor"><span>${label}</span>
    <div class="fbar"><i style="width:${v * 10}%;background:hsl(${8 + good * 12} 78% 52%)"></i></div><b>${v.toFixed(1)}</b></div>`;
}

function refreshDetail() {
  const r = rows.find((x) => x.pair === detailPair);
  if (!r) return;
  $('#detail').innerHTML = `
    <header class="dhead ${r.light}">
      <div><h2>${sym(r.pair)}</h2><p>${r.regime} · ${r.setup} · seit ${mins(r._age)}</p></div>
      <div class="dscore"><b>${r.quality}</b><span>Qualität</span></div>
      <div class="dscore"><b>${r.executability}</b><span>Handelbarkeit</span></div>
    </header>
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
    <p class="hint">TP2 aus: <b>${r.tp2Source}</b> · Stop/Kosten-Deckung <b>${r.costRatio}×</b></p>
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
    ageMin: Math.round(r._age / 60000), notional: s?.notional ?? null,
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
  $('#sEquity').value = S.equity; $('#sRisk').value = S.riskPct;
  $('#sDeep').value = S.deep; $('#sCoinCount').value = S.coinCount; $('#sStockCount').value = S.stockCount; $('#sWatch').value = S.watch;
  $('#sToken').value = S.token; $('#sMin').value = S.minQ;
  $('#sZone').checked = S.onlyZone; $('#sTheme').value = S.theme; $('#sTax').value = S.taxPct; $('#sMode').value = S.analysisMode;
  $('#settings').classList.add('open');
}
function applySettings() {
  S.equity = +$('#sEquity').value || DEFAULTS.equity;
  S.riskPct = +$('#sRisk').value || DEFAULTS.riskPct;
  S.deep = Math.min(30, Math.max(4, +$('#sDeep').value || DEFAULTS.deep)); S.coinCount = Math.min(50, Math.max(3, +$('#sCoinCount').value || DEFAULTS.coinCount)); S.stockCount = Math.min(50, Math.max(3, +$('#sStockCount').value || DEFAULTS.stockCount));
  S.watch = $('#sWatch').value.toUpperCase().replace(/\s/g, '');
  S.token = $('#sToken').value.trim();
  S.minQ = +$('#sMin').value || 0;
  S.onlyZone = $('#sZone').checked; S.theme = $('#sTheme').value; S.taxPct = Math.min(60, Math.max(0, +$('#sTax').value || 0)); S.analysisMode = $('#sMode').value;
  saveSettings(); applyTheme(); $('#settings').classList.remove('open'); scan(true);
}

function applyTheme(){
  document.documentElement.dataset.theme = S.theme;
  const mc = document.querySelector('meta[name=theme-color]');
  if (mc) mc.content = S.theme === 'dark' ? '#080b14' : S.theme === 'warm' ? '#d8cdbd' : '#d9dee7';
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
  }
});

/* ---------------------------------------------------------------- Intervall */
function setPoll(ms) {
  clearInterval(timer);
  S.interval = ms; saveSettings();
  timer = setInterval(() => { if (document.visibilityState === 'visible') scan(); }, ms);
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
$('#iv').onchange = () => setPoll(+$('#iv').value);
$('#x').onclick = closeDetail; $('#qClose').onclick = () => $('#quotaModal').classList.remove('open'); $('#qDismiss').onclick = () => $('#quotaModal').classList.remove('open');
$('#modal').onclick = (e) => { if (e.target.id === 'modal') closeDetail(); };
$('#more').onclick = () => { showRest = !showRest; renderList(); };
$('#dcopy').onclick = (e) => {
  const r = rows.find((x) => x.pair === selected);
  if (r) copy(orderPlan(r), e.target);
};
document.body.addEventListener('pointerdown', () => audio(), { once: true });

/* --------------------------------------------------------------------- Boot */
applyTheme();
loadVersion();
$('#sound').textContent = S.sound ? '🔊' : '🔇';
$('#iv').value = String(S.interval);
if ('Notification' in window && Notification.permission === 'default') {
  document.body.addEventListener('pointerdown', () => Notification.requestPermission(), { once: true });
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
scan(true);
setPoll(S.interval);
