/* ============================================================================
   FusionPulse v2.5.3 — Frontend
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
  maxTradeEur: 10000, minCrvCoin: 2.0, minCrvStock: 3.0,
  mutedPairs: [], mutedStocks: [], favoritePairs: [], favoriteStocks: [], components: [...ALL_COMPONENTS], stockSound: true,
};
const S = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('fp.settings') || '{}') };
if (!Array.isArray(S.components) || !S.components.length) S.components = [...ALL_COMPONENTS];
S.components = S.components.filter((c) => ALL_COMPONENTS.includes(c));
if (!S.components.length) S.components = [...ALL_COMPONENTS];
const saveSettings = () => localStorage.setItem('fp.settings', JSON.stringify(S));

let rows = [];
let meta = {};
let stockRows = [];
let stockMeta = {};
let stockTimer = null;
let healthTimer = null;
let timer = null;
let scanning = false;
let selected = null;        // aktuell fokussiertes Paar
let pinned = false;         // vom Nutzer gewählt → nicht automatisch wegspringen
let showRest = false;
let ac = null;
let health = {};
let quotaShownFor = '';     // verhindert Dauer-Popups für dieselbe Lage
let stockSearchBusy = false;

const state = new Map();      // pair   -> { light, since, streak, level, … }
const stockState = new Map(); // symbol -> { light, since, streak, level }
const rowNodes = new Map();   // pair   -> DOM-Zeile

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

const isMuted = (pair) => (S.mutedPairs || []).includes(pair);
const isStockMuted = (s) => (S.mutedStocks || []).includes(s);
const isFavPair = (pair) => (S.favoritePairs || []).includes(pair);
const isFavStock = (symbol) => (S.favoriteStocks || []).includes(symbol);

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
  S.favoriteStocks = [...set]; saveSettings(); renderStocks();
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
  return r.light === 'green' && r.inZone && Number(r.netCRV || 0) >= Number(S.minCrvCoin || 2);
}
const coinLevel = (r) => (buyReady(r) ? 3 : r.light === 'green' ? 2 : r.light === 'yellow' ? 1 : 0);
const stockLevel = (r) => (r.light === 'green' && r.score >= 8 && r.netCRV >= Number(S.minCrvStock || 3) ? 3
  : r.light === 'green' ? 2 : r.light === 'yellow' ? 1 : 0);

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
  if (/pullback/i.test(r.setup)) return 'Pullback an VWAP/EMA21: Der Kurs kommt nach einer Bewegung an einen dynamischen Durchschnitt zurück. Interessant, wenn die Zone hält und die übrigen Filter bestätigen.';
  if (/relative/i.test(r.setup)) return 'Relative Stärke: Der Coin entwickelt sich stärker als Bitcoin. Das ist ein Bestätigungsfaktor, kein eigenständiges Kaufsignal.';
  if (/reclaim/i.test(r.setup)) return 'Reclaim: Der Kurs erobert eine zuvor verlorene Referenz (VWAP) zurück. Zählt erst, wenn Volumen und kurzer Zeitrahmen mitziehen.';
  return 'Vom Scanner erkannte Setup-Art. Mouseover zeigt die Bedeutung; die Gesamtentscheidung berücksichtigt zusätzlich Kosten, Liquidität, Zonenlage und Risiko.';
}

/* --------------------------------------------------------------------- Ton */
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
  if (r.buyCapacity && notional > r.buyCapacity) { notional = r.buyCapacity; caps.push('liquidity'); }
  const qty = notional / r.entry;
  return {
    riskEur, qty, notional, rawNotional, capped: caps.length > 0, caps,
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
    s ? `Größe  ${eur(s.notional, 2)}  ≈ ${s.qty.toPrecision(6)} ${sym(r.pair)}${s.caps?.includes('liquidity') ? '  [wegen Marktliquidität reduziert]' : s.caps?.includes('maxTrade') ? '  [auf Maximalbetrag begrenzt]' : ''}` : '',
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
  const label = el.id === 'sysCrypto' ? 'Krypto (Bitpanda Fusion)' : 'Aktien (Twelve Data)';
  el.title = `${label}: ${STATE_TEXT[key]}${detail ? '\n' + detail : ''}\n\nGrün = verbunden · Gelb = eingeschränkt oder Rate-Limit · Rot = Fehler oder nicht verbunden`;
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
    short: q.creditsLeft != null ? `Credits ${q.creditsLeft}/${q.minuteLimit} · ${day}` : `Kontingent unbekannt · ${day}`,
    long: parts.join(' · '),
  };
}

function checkQuotaPopup(q, state) {
  // v2.5.3: Minutenknappheit/429 bleibt eine kleine gelbe Statusmeldung.
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
    setSys('#sysCrypto', health.status?.crypto?.state || 'unknown', health.status?.crypto?.message);
    setSys('#sysStocks', health.status?.stocks?.state || 'unknown', health.status?.stocks?.message);
    renderQuota(health.quota?.twelveData);
  } catch {
    setSys('#sysCrypto', 'error', 'Worker nicht erreichbar');
    setSys('#sysStocks', 'error', 'Worker nicht erreichbar');
  }
}

function renderQuota(q) {
  const el = $('#stockQuota'); if (!el) return;
  const t = quotaText(q);
  el.textContent = t.short;
  el.title = `Twelve Data Kontingent laut Antwort-Headern api-credits-used / api-credits-left.\n${t.long}\n\nDas Minutenkontingent liefert der Anbieter. Der Tagesverbrauch ist eine Eigenzählung dieses Workers; ein Tageslimit wird nur angezeigt, wenn es sich aus dem Minutenkontingent eindeutig ableiten lässt.`;
  const tight = q && ((q.dayLimit && q.dayCredits >= q.dayLimit * 0.9) || (q.creditsLeft != null && q.creditsLeft <= 1));
  el.className = 'badge' + (tight ? ' warn' : q?.creditsLeft != null ? ' ok' : '');
}

/* -------------------------------------------------------------- Update-Bar */
function showUpdateBar(text) {
  const bar = $('#updateBar');
  if (!bar || !bar.classList.contains('hidden')) return;
  if (text) $('#updateText').textContent = text;
  bar.classList.remove('hidden');
}
async function hardReload() {
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
  if (scanning) return;
  scanning = true;
  controller?.abort();
  controller = new AbortController();
  const t0 = performance.now();
  $('#status').dataset.state = 'busy';

  try {
    const q = new URLSearchParams({
      deep: S.deep, watch: S.watch, mode: S.analysisMode, comp: S.components.join(','), minCrv: S.minCrvCoin,
    });
    if (S.token) q.set('t', S.token);
    if (force) q.set('force', '1');
    const res = await fetch(`/api/scan?${q}`, { signal: controller.signal });
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
    $('#status').textContent = `${data.cached ? 'Cache' : 'Live'} · ${data.deepCount} gescannt / ${shown} angezeigt von ${data.universe} · ${data.requests ?? data.subrequests ?? '–'} API-Unterabfragen · ${Math.round(performance.now() - t0)} ms`;
    $('#status').title = 'Live/Cache = Datenquelle des letzten Scans · „gescannt“ = tief analysierte Coins, „angezeigt“ = Zeilen in dieser Liste (Einstellungen) · API-Unterabfragen = Bitpanda-Unterabfragen innerhalb dieses Scans, NICHT dein Cloudflare-Tagesverbrauch · ms = Dauer des Scans.';
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
    scanning = false;
  }
}

/* -------------------------------------------------------------- Aktienradar */
/** Positionsgröße in EUR. Ohne bekannten EUR/USD-Kurs wird bewusst NICHT
 *  gerechnet, statt USD und EUR stillschweigend zu vermischen. */
function stockSizing(r) {
  if (r.entryEur == null || r.stopEur == null || !(r.entryEur > r.stopEur)) return null;
  const riskEur = S.equity * (S.riskPct / 100);
  let qty = riskEur / (r.entryEur - r.stopEur);
  const maxTrade = Math.max(0, Number(S.maxTradeEur || 0));
  if (maxTrade && qty * r.entryEur > maxTrade) qty = maxTrade / r.entryEur;
  const g1 = (r.tp1Eur - r.entryEur) * qty;
  const g2 = (r.tp2Eur - r.entryEur) * qty;
  return {
    qty, notional: qty * r.entryEur, risk: (r.entryEur - r.stopEur) * qty,
    gross1: g1, gross2: g2,
    net1: Math.max(0, g1) * (1 - S.taxPct / 100),
    net2: Math.max(0, g2) * (1 - S.taxPct / 100),
  };
}

const VERDICT_ICON = { green: '🟢', yellow: '🟡', red: '🔴' };

/** Preisdarstellung: USD ist die Quelle, EUR immer als Umrechnung markiert. */
function stockPx(usdVal, eurVal, d = 2) {
  return eurVal != null
    ? `<span title="Quelle ist der US-Kurs in USD. Der Euro-Betrag ist eine Umrechnung mit dem aktuellen EUR/USD-Kurs und kein Tradegate-Kurs.">${usd(usdVal, d)} <em class="conv">≈ ${eur(eurVal, d)} umger.</em></span>`
    : `<span title="Kein EUR/USD-Kurs verfügbar – es wird ausschließlich der US-Kurs gezeigt.">${usd(usdVal, d)}</span>`;
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
      ${t('Kurs', 'Letzter Kurs aus dem 5-Minuten-Feed von Twelve Data (US-Markt).', stockPx(r.priceUsd, r.priceEur))}
      ${t('Score', 'Gesamtbewertung von 0–10 aus den aktivierten Analyseverfahren. Höher = mehr Verfahren bestätigen dasselbe Bild.', num(r.score, 1))}
      ${t('Netto-CRV', 'CRV = Chance-Risiko-Verhältnis nach geschätzten Kosten. 2,4 : 1 heißt: 2,40 € erwarteter Ertrag je 1,00 € Risiko.', `${num(r.netCRV, 1)} : 1`)}
      ${t('Setup', 'Erkanntes Kursmuster aus EMA-Staffelung, VWAP-Lage und kurzfristigem Momentum.', esc(r.setup))}
      ${t('Trend', 'Richtung der EMA9 gegenüber der EMA21. EMA = exponentieller gleitender Durchschnitt.', esc(r.trend))}
      ${t('Entry-Zone', 'Preisbereich, in dem der geplante Kauf sinnvoll wird. Enger als ein Punkt, damit ein Tick keinen Trade zerstört.', stockPx(r.zoneLowUsd, r.zoneLowEur) + ' – ' + stockPx(r.zoneHighUsd, r.zoneHighEur))}
      ${t('Stop-Loss (SL)', 'Ausstiegskurs zur Verlustbegrenzung, hier 1,25 × ATR unter dem Einstieg. ATR = mittlere wahre Schwankungsbreite.', stockPx(r.stopUsd, r.stopEur))}
      ${t('TP1 · erster Teilverkauf', 'TP = Take Profit. TP1 ist der erste Teilverkauf, üblicherweise die halbe Position.', stockPx(r.tp1Usd, r.tp1Eur))}
      ${t('TP2 · Restposition', 'TP2 ist der Verkauf der verbleibenden Position.', stockPx(r.tp2Usd, r.tp2Eur))}
      ${t('Kaufsumme', 'Empfohlener Euro-Einsatz aus Konto-Equity, Risiko pro Trade und Stop-Abstand.', sz ? eur(sz.notional, 0) : 'ohne EUR/USD-Kurs nicht berechenbar')}
      ${t('Risiko bis SL', 'Rechnerischer Verlust, wenn der Stop-Loss ausgelöst wird.', sz ? eur(sz.risk, 0) : '–')}
      ${t('Gewinn TP1 brutto', 'Erwarteter Rohgewinn beim ersten Teilverkauf, vor Steuer.', sz ? eur(sz.gross1, 0) : '–')}
      ${t('Gewinn TP2 brutto', 'Erwarteter Rohgewinn beim Verkauf der Restposition, vor Steuer.', sz ? eur(sz.gross2, 0) : '–')}
      ${t(`Netto TP1 nach ${num(S.taxPct, 1)} % KESt`, 'KESt = österreichische Kapitalertragsteuer, Standardsatz 27,5 % auf realisierte Kursgewinne. Schätzung ohne Verlustausgleich.', sz ? eur(sz.net1, 0) : '–')}
      ${t(`Netto TP2 nach ${num(S.taxPct, 1)} % KESt`, 'Geschätzter Gewinn der Restposition nach Kapitalertragsteuer.', sz ? eur(sz.net2, 0) : '–')}
      ${t('ATR', 'ATR = Average True Range, mittlere Schwankungsbreite in Prozent des Kurses.', num(r.atrPct, 2) + ' %')}
      ${t('Rel. Volumen', 'Aktuelles Volumen im Verhältnis zum Mittel der letzten 20 Bars. Über 1× heißt überdurchschnittliches Interesse.', num(r.relVol, 2) + '×')}
      ${t('5m / 15m / 1h', 'Kursveränderung über die letzten 5, 15 und 60 Minuten.', `${num(r.ret5, 2)} % / ${num(r.ret15, 2)} % / ${num(r.ret60, 2)} %`)}
    </div>
    <footer>US-Feed (${esc(r.exchange)}), Stand ${esc(r.updated || '–')}. EUR-Beträge sind Umrechnungen${r.fxUsdPerEur ? ` zu EUR/USD ${num(r.fxUsdPerEur, 4)}` : ''}, keine Tradegate-Kurse.</footer>
  </div>`;
}

function renderStocks() {
  const box = $('#stockGroups'), st = $('#stockState'), counts = $('#stockCounts');
  if (!box || !st) return;

  if (stockMeta.configured === false) {
    box.innerHTML = '';
    st.textContent = 'TWELVE_API_KEY fehlt';
    st.className = 'badge err';
    st.title = 'Cloudflare → Workers & Pages → fusionpulse → Einstellungen → Variablen und Geheimnisse: TWELVE_API_KEY als Geheimnis anlegen.';
    if (counts) counts.textContent = 'Aktienradar nicht konfiguriert';
    return;
  }

  const search = ($('#q')?.value || '').trim().toUpperCase();
  const favOnly = $('#f')?.value === 'favorites';
  const stockFiltered = stockRows.filter((r) => (!search || r.symbol.toUpperCase().includes(search) || String(r.name || '').toUpperCase().includes(search)) && (!favOnly || isFavStock(r.symbol)));
  const shown = [...stockFiltered].sort((a, b) => (Number(isFavStock(b.symbol)) - Number(isFavStock(a.symbol))) || b.score - a.score).slice(0, S.stockCount);
  const scanned = stockMeta.scanned ?? stockRows.length;
  const universe = stockMeta.universe || 21;

  const stateKey = stockMeta.state || (stockRows.length ? 'ok' : 'unknown');
  st.textContent = stateKey === 'ok' ? 'Live-Feed' : STATE_TEXT[stateKey] || 'Status unbekannt';
  st.className = 'badge ' + (STATE_TONE[stateKey] === 'ok' ? 'ok' : STATE_TONE[stateKey] === 'warn' ? 'warn' : 'err');
  st.title = `Twelve Data US-Aktienfeed. 7 Titel je 5-Minuten-Zyklus, das gesamte Universum ist nach etwa 15 Minuten einmal erneuert.\nStatus: ${STATE_TEXT[stateKey] || stateKey}`;
  if (counts) {
    counts.textContent = `${scanned} von ${universe} gescannt · ${shown.length} angezeigt`;
    counts.title = 'Gescannt = Titel mit vorliegender Analyse im rotierenden Universum. Angezeigt = Zeilen in dieser Liste (Einstellungen → Aktien anzeigen).';
  }

  const topBox = $('#stockFocus');
  const top = shown[0];
  if (topBox) {
    if (!top) topBox.innerHTML = search ? `<div class="stockfocus-empty">Keine geladene Aktie passend zu „${esc(search)}“. <b>Enter</b> oder 🔎 lädt den Titel direkt über Twelve Data.</div>` : (favOnly ? `<div class="stockfocus-empty">Noch keine Aktien-Favoriten. Mit ☆ neben einem Titel hinzufügen.</div>` : '');
    else {
      const sz = stockSizing(top); const buy = stockLevel(top) === 3;
      topBox.innerHTML = `<div class="stockfocus-card ${top.light}${buy ? ' buy' : ''}"><div class="sf-title"><div><small>TOP-AKTIE AKTUELL</small><h3>${esc(top.name)} <b>${esc(top.symbol)}</b></h3><span>${esc(top.sector)} · Score ${num(top.score,1)} · CRV ${num(top.netCRV,1)}:1</span></div><strong>${VERDICT_ICON[top.light]} ${esc(top.verdict)}</strong></div><div class="sf-grid"><span>Kurs <b>${stockPx(top.priceUsd, top.priceEur)}</b></span><span>Kaufsumme <b>${sz ? eur(sz.notional,0) : '–'}</b></span><span>Entry <b>${stockPx(top.entryUsd, top.entryEur)}</b></span><span>Stop <b>${stockPx(top.stopUsd, top.stopEur)}</b></span><span>TP1 <b>${stockPx(top.tp1Usd, top.tp1Eur)}</b></span><span>TP2 <b>${stockPx(top.tp2Usd, top.tp2Eur)}</b></span></div><small>EUR = Umrechnung, kein Tradegate-Kurs. BUY nur wenn Score ≥ 8 und dein Mindest-CRV ${num(S.minCrvStock,1)}:1 erfüllt ist.</small></div>`;
    }
  }

  const groups = new Map();
  for (const r of shown) { if (!groups.has(r.sector)) groups.set(r.sector, []); groups.get(r.sector).push(r); }

  box.innerHTML = [...groups.entries()].map(([sector, arr]) => `
    <section class="stock-sector">
      <h3>${esc(sector)}</h3>
      ${arr.map((r) => {
        const buy = stockLevel(r) === 3;
        const tone = stockStrength(r);
        return `<div class="stockrow ${r.light} tone-${tone}${buy ? ' buy' : ''}" data-sym="${esc(r.symbol)}">
          <div class="sr-head">
            <b class="sr-tic" title="Ticker-Symbol an der US-Börse ${esc(r.exchange)}">${esc(r.symbol)}</b>
            <button class="favbtn ${isFavStock(r.symbol) ? 'on' : ''}" data-favstock="${esc(r.symbol)}" title="${isFavStock(r.symbol) ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'}">${isFavStock(r.symbol) ? '★' : '☆'}</button>
            <button class="rowmute" data-mutestock="${esc(r.symbol)}" title="Ton nur für ${esc(r.symbol)} ${isStockMuted(r.symbol) ? 'einschalten' : 'ausschalten'}">${isStockMuted(r.symbol) ? '🔇' : '🔊'}</button>
          </div>
          <div class="sr-name" title="${esc(r.name)} · Branche ${esc(r.sector)}">${esc(r.name)}</div>
          <div class="sr-nums">
            <span title="CRV = Chance-Risiko-Verhältnis nach geschätzten Kosten.">${num(r.netCRV, 1)} : 1</span>
            <i>·</i>
            <span title="Gesamtbewertung 0–10 aus den aktivierten Analyseverfahren.">Score ${num(r.score, 1)}</span>
          </div>
          <div class="sr-verdict" title="Einschätzung des Systems: Grün = handelbares Setup, Gelb = beobachten, Rot = kein Trade.">${VERDICT_ICON[r.light]} ${esc(r.verdict)}</div>
          <div class="sr-px" title="Letzter US-Kurs; EUR ist eine Umrechnung.">${stockPx(r.priceUsd, r.priceEur)}</div>
          ${stockPeek(r)}
        </div>`;
      }).join('')}
    </section>`).join('');

  box.querySelectorAll('[data-mutestock]').forEach((b) => {
    b.addEventListener('click', (e) => toggleStockMute(b.dataset.mutestock, e));
  });
  box.querySelectorAll('[data-favstock]').forEach((b) => {
    b.addEventListener('click', (e) => toggleStockFavorite(b.dataset.favstock, e));
  });
}

/** Aktien-Alarme: nur bei NEUER Signalstufe, nie bei jedem Refresh. */
function trackStocks() {
  const now = Date.now();
  for (const r of stockRows) {
    const lvl = stockLevel(r);
    const st = stockState.get(r.symbol) || { light: null, since: now, streak: 0, level: -1 };
    if (st.light !== r.light) { st.since = now; st.streak = 1; } else st.streak++;
    st.light = r.light;
    if (lvl > st.level && lvl >= 1 && st.level >= 0 && S.stockSound) {
      beep(lvl === 3 ? 'stockbuy' : lvl === 2 ? 'stockgreen' : 'stockwatch', isStockMuted(r.symbol));
    }
    st.level = lvl;
    stockState.set(r.symbol, st);
  }
}

async function scanStocks(force = false) {
  try {
    const q = new URLSearchParams({ comp: S.components.join(','), minCrv: S.minCrvStock });
    if (S.token) q.set('t', S.token);
    if (force) q.set('force', '1');
    const res = await fetch('/api/stocks?' + q);
    const data = await res.json();
    stockMeta = data;
    if (data.rows) stockRows = data.rows;
    if (!res.ok) {
      setSys('#sysStocks', data.state || 'error', data.error);
      renderQuota(data.quota);
      checkQuotaPopup(data.quota, data.state);
      renderStocks();
      return;
    }
    setSys('#sysStocks', data.configured === false ? 'nokey' : 'ok',
      data.configured === false ? 'TWELVE_API_KEY fehlt' : `${data.scanned ?? stockRows.length} von ${data.universe} Titeln analysiert`);
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
  const raw = ($('#q')?.value || '').trim();
  if (!raw || stockSearchBusy) return;
  // Geladene Coin-/Aktientreffer brauchen keinen API-Aufruf.
  const coin = rows.find((r) => r.pair.toUpperCase().includes(raw.toUpperCase()));
  const stock = stockRows.find((r) => r.symbol.toUpperCase() === raw.toUpperCase() || String(r.name || '').toUpperCase() === raw.toUpperCase());
  if (coin) { select(coin.pair, true); return; }
  if (stock) { renderStocks(); return; }
  stockSearchBusy = true;
  const st = $('#stockState');
  if (st) { st.textContent = 'Suche…'; st.className = 'badge'; }
  try {
    const q = new URLSearchParams({ lookup: raw, comp: S.components.join(','), minCrv: S.minCrvStock });
    if (S.token) q.set('t', S.token);
    const res = await fetch('/api/stocks?' + q, { cache: 'no-store' });
    const data = await res.json();
    stockMeta = { ...stockMeta, ...data };
    if (data.row) {
      const m = new Map(stockRows.map((r) => [r.symbol, r])); m.set(data.row.symbol, data.row); stockRows = [...m.values()];
    }
    renderQuota(data.quota); checkQuotaPopup(data.quota, data.state);
    if (!res.ok || data.notFound) {
      if (st) { st.textContent = data.notFound ? 'Nicht gefunden' : 'Suche fehlgeschlagen'; st.className = 'badge warn'; st.title = data.error || 'Bitte Ticker versuchen.'; }
    } else if (st) { st.textContent = data.cached ? 'Treffer · Cache' : 'Treffer geladen'; st.className = 'badge ok'; }
    renderStocks();
  } catch (e) {
    if (st) { st.textContent = 'Suche fehlgeschlagen'; st.className = 'badge err'; st.title = String(e.message || e); }
  } finally { stockSearchBusy = false; }
}

function setStockPoll() {
  clearInterval(stockTimer);
  stockTimer = setInterval(() => { if (document.visibilityState === 'visible') scanStocks(false); }, 5 * 60_000);
}

/* ------------------------------------------------- Reifezeit + Alarmierung
   Ein Setup, das seit drei Stunden hält, ist eine gespannte Feder.
   Eines, das seit zehn Minuten besteht, ist Rauschen. Die Zeit im Zustand
   ist eine Dimension, die klassische Indikatoren strukturell nicht sehen.
   v2.5.1: Ton NUR bei neuer Signalstufe, nicht bei jedem Scan.            */
function track() {
  const now = Date.now();
  const cutoff = now - 120 * 60_000;
  for (const r of rows) {
    const st = state.get(r.pair)
      || { light: null, since: now, quality: r.quality, prevQ: r.quality, streak: 0, level: -1, crvBand: 0, history: [] };
    const oldLight = st.light;
    const oldCrv = Number(st.netCRV ?? r.netCRV);
    if (st.light !== r.light) { st.since = now; st.streak = 1; } else st.streak++;
    st.prevQ = st.quality; st.quality = r.quality; st.light = r.light;
    st.prevCrv = oldCrv; st.netCRV = Number(r.netCRV || 0);
    st.prevLight = oldLight;

    const lvl = coinLevel(r);
    const crvBand = r.netCRV >= S.minCrvCoin + 1 ? 2 : r.netCRV >= S.minCrvCoin ? 1 : 0;
    const known = st.level >= 0;

    if (known && lvl > st.level && lvl >= 1) {
      beep(lvl === 3 ? 'buy' : lvl === 2 ? 'green' : 'watch', isMuted(r.pair));
      if (lvl >= 2) notify(r);
    } else if (known && crvBand > st.crvBand) {
      beep('buy', isMuted(r.pair));
      notify(r);
    }

    st.level = lvl; st.crvBand = crvBand;
    st.history = (st.history || []).filter((h) => h.ts >= cutoff);
    const lastH = st.history.at(-1);
    if (!lastH || now - lastH.ts >= 55_000 || lastH.light !== r.light) {
      st.history.push({ ts: now, quality: Number(r.quality || 0), executability: Number(r.executability || 0), light: r.light, crv: Number(r.netCRV || 0) });
    }
    state.set(r.pair, st);

    r._age = now - st.since;
    r._streak = st.streak;
    r._delta = st.quality - st.prevQ;
    r._crvDelta = Number(r.netCRV || 0) - oldCrv;
    r._prevLight = oldLight;
    r._history = st.history;
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

/* ---------------------------------------------------------- Zonenlage-Balken */
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

      ${r.light !== 'green' && r.blockers.length
        ? `<div class="fblock"><b>Nicht handeln, weil:</b> ${esc(r.blockers.join(' · '))}</div>` : ''}
      <div class="insightbar"><div><span>120-Min-Verlauf</span>${statusBand(r)} <b>${trendArrow(r)}</b></div><div title="BUY-Nähe ist keine Trefferwahrscheinlichkeit. Sie zeigt nur, wie viele aktuelle Voraussetzungen bereits erfüllt sind."><span>BUY-Nähe</span><b>${buyNear(r)} %</b></div><div><span>Was hat sich geändert?</span><b>${esc(changeSummary(r))}</b></div></div>

      <div class="fgrid">
        <div title="Einstiegszone: Preisbereich, in dem der geplante Kauf sinnvoll wird."><span>Einstiegszone</span><b>${num(r.zoneLow)} – ${num(r.zoneHigh)}</b></div>
        <div title="Kaufsumme: empfohlener Euro-Einsatz aus Konto-Einstellung, Risikoabstand und Orderbuchtiefe."><span>Kaufsumme</span><b>${s ? eur(s.notional, 0) : '–'}</b></div>
        <div class="metricbox ${r.netCRV >= S.minCrvCoin ? 'positive' : r.netCRV >= Math.max(1, S.minCrvCoin-.5) ? 'wait' : 'negative'}" title="Netto-CRV: erwarteter Ertrag im Verhältnis zum Risiko nach geschätzten Gebühren, Spread und Slippage. Beispiel 3:1 = 3 € potenzieller Ertrag pro 1 € Risiko."><span>Netto-CRV</span><b class="${r.netCRV >= S.minCrvCoin ? 'good' : 'bad'}">${r.netCRV}:1</b></div>
        <div title="Maximaler rechnerischer Verlust bis zum Stop-Loss bei der vorgeschlagenen Positionsgröße."><span>Risiko bis SL</span><b>${s ? eur(s.realRisk, 0) : '–'} · ${r.riskPct} %</b></div>
        <div class="metricbox ${r.costRatio >= 4 ? 'positive' : r.costRatio >= 2.5 ? 'wait' : 'negative'}" title="Kosten: geschätzte Gebühren + Spread + Slippage. Die ×-Zahl zeigt, wie oft die erwartete Bewegung diese Kosten deckt. Höher ist besser."><span>Kosten</span><b class="${r.costRatio < 2.5 ? 'bad' : ''}">${r.costPct} % · ${r.costRatio}×</b></div>
        <div class="metricbox ${r.slipBps == null ? 'wait' : r.slipBps <= 5 ? 'positive' : r.slipBps <= 15 ? 'wait' : 'negative'}" title="Slippage: erwartete Abweichung zwischen geplantem und tatsächlich erreichbarem Ausführungspreis. 1 Basispunkt (bp) = 0,01 %. Niedriger ist besser."><span>Slippage</span><b>${r.slipBps != null ? r.slipBps + ' bps' : '–'}</b></div>
        <div title="Geschätzter Gewinn bei TP2 nach dem in den Einstellungen hinterlegten Steuersatz (Österreich: KESt 27,5 %)."><span>TP2 Gewinn netto*</span><b class="good">${s ? eur(s.netProfit2, 0) : '–'}</b></div>
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


function statusBand(r) {
  const hist = r._history || [];
  const now = Date.now();
  const bins = [];
  for (let i = 5; i >= 0; i--) {
    const lo = now - (i + 1) * 20 * 60_000, hi = now - i * 20 * 60_000;
    const h = [...hist].reverse().find((x) => x.ts >= lo && x.ts < hi) || (i === 0 ? hist.at(-1) : null);
    const light = h?.light || 'none';
    bins.push(`<i class="hb ${light}" title="${120-i*20}–${100-i*20} Minuten zurück: ${light === 'green' ? 'grün' : light === 'yellow' ? 'gelb' : light === 'red' ? 'rot' : 'keine Daten'}"></i>`);
  }
  return `<span class="histband" title="Signalverlauf der letzten 120 Minuten, 6 Abschnitte à 20 Minuten">${bins.join('')}</span>`;
}
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
    (!f || f === 'favorites' ? (f !== 'favorites' || isFavPair(r.pair)) : r.light === f) &&
    r.quality >= S.minQ &&
    (!S.onlyZone || r.inZone))
    .sort((a, b) => (Number(isFavPair(b.pair)) - Number(isFavPair(a.pair))) || b.quality - a.quality);
}

function rowHtml(r) {
  const s = sizing(r);
  const d = r._delta > 0.4 ? '<i class="up">▲</i>' : r._delta < -0.4 ? '<i class="dn">▼</i>' : '';
  return `
    <span class="c-sym" title="Coin und aktueller Signalstatus. Pulsierender grüner Rahmen = konkrete Kauf-Freigabe nach den definierten Regeln."><button class="favbtn ${isFavPair(r.pair) ? 'on' : ''}" data-favpair="${r.pair}" title="${isFavPair(r.pair) ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'}">${isFavPair(r.pair) ? '★' : '☆'}</button><b class="dotc ${r.light}"></b>${sym(r.pair)}${d}<button class="rowmute" data-mute="${r.pair}" title="Ton nur für ${sym(r.pair)} ${isMuted(r.pair) ? 'einschalten' : 'ausschalten'}">${isMuted(r.pair) ? '🔇' : '🔊'}</button></span>
    <span class="c-spk" title="Kurzfristiger Kursverlauf der letzten Bars, normiert">${spark(r.spark)}${statusBand(r)}<small class="trendarr">${trendArrow(r)}</small></span>
    <span class="c-set" title="${esc(explainSetup(r))}">${r.orderType === 'stop' ? '▲' : '▼'} ${esc(r.setup)}</span>
    <span class="c-age ta" title="Reife: ${r._streak || 1} aufeinanderfolgende Scans haben diesen Signalzustand bestätigt. Die Farbintensität steigt mit der Bestätigungsdauer.">${mins(r._age)}<i class="stk">${r._streak || 1}×</i></span>
    <span class="c-zone" title="Zonenlage: zeigt, wo der aktuelle Preis relativ zu Stop und Einstiegszone liegt. Grün markiert einen Preis innerhalb der Einstiegszone.">${zoneBar(r)}</span>
    <span class="c-r ta ${r.netCRV >= S.minCrvCoin ? 'positive' : r.netCRV >= Math.max(1, S.minCrvCoin-.5) ? 'wait' : 'negative'}" title="Netto-CRV nach Kosten: erwarteter Ertrag pro Einheit Risiko. Höher ist besser.">${r.netCRV.toFixed(1)}</span>
    <span class="c-sz ta" title="Kaufsumme: aus Konto-Equity, Risiko pro Trade, Stop-Abstand und verfügbarer Orderbuchtiefe berechneter Euro-Einsatz.">${s ? eur(s.notional, 0) : '–'}</span>
    <span class="c-qh ta" title="Q = Setup-Qualität (0–10), H = Handelbarkeit/Ausführbarkeit (0–10)."><b>${r.quality}</b><i>·</i>${r.executability}</span>
    <span class="tradepeek"><b>${sym(r.pair)} · ${esc(r.setup)}</b><br>
      Einsatz ${s ? eur(s.notional, 0) : '–'} · Entry ${num(r.entry)} · SL ${num(r.stop)} · TP1 ${num(r.tp1)} · TP2 ${num(r.tp2)}<br>
      CRV ${r.netCRV}:1 · TP2 nach Steuer* ${s ? eur(s.netProfit2, 0) : '–'}
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
    el.className = `row ${r.light} tone-${strength}${r.pair === selected ? ' sel' : ''}${r.inZone ? ' inzone' : ''}${ready ? ' buy-ready' : ''}`;
    el.innerHTML = rowHtml(r);
    el.querySelector('[data-mute]')?.addEventListener('click', (e) => togglePairMute(r.pair, e));
    el.querySelector('[data-favpair]')?.addEventListener('click', (e) => togglePairFavorite(r.pair, e));
    if (container.children[i] !== el) container.insertBefore(el, container.children[i] || null);
  });
  [...container.children].forEach((el) => {
    if (!seen.has(el.dataset.pair)) { el.remove(); rowNodes.delete(el.dataset.pair); }
  });
}

/* ------------------------------------------------------------------ Render */
function render() {
  if (!pinned || !rows.some((r) => r.pair === selected)) {
    const best = rows.find((r) => r.light === 'green') || rows.find((r) => r.light === 'yellow') || rows[0];
    selected = best?.pair ?? null;
  }
  const reg = $('#regime');
  reg.textContent = `${meta.marketRegime || '–'} · ${Math.round((meta.breadth || 0) * 100)} % über VWAP`;
  reg.title = 'Marktregime: Risk-On = breite positive Marktstruktur, Risk-Off = breite Schwäche. Der Prozentwert zeigt den Anteil der gescannten Coins oberhalb ihres volumengewichteten Durchschnittspreises (VWAP). Das ist ein Marktfilter, kein eigenständiges Kaufsignal.';
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

function factor(label, v, invert = false, active = true, tip = '') {
  const good = invert ? 10 - v : v;
  return `<div class="factor${active ? '' : ' off'}" title="${esc(tip)}"><span>${label}${active ? '' : ' <em>(aus)</em>'}</span>
    <div class="fbar"><i style="width:${active ? v * 10 : 0}%;background:hsl(${8 + good * 12} 78% 52%)"></i></div><b>${active ? v.toFixed(1) : '–'}</b></div>`;
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
  $('#sEquity').value = S.equity; $('#sRisk').value = S.riskPct; $('#sMaxTrade').value = S.maxTradeEur; $('#sMinCrvCoin').value = S.minCrvCoin; $('#sMinCrvStock').value = S.minCrvStock;
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
  S.deep = Math.min(30, Math.max(4, +$('#sDeep').value || DEFAULTS.deep));
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
$('#scan').onclick = () => { scan(true); scanStocks(false); loadHealth(); };
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
$('#q').oninput = () => { render(); renderStocks(); };
$('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); searchStockNow(); } });
$('#searchGo').onclick = searchStockNow;
$('#f').onchange = () => { render(); renderStocks(); };
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

loadHealth();
scan(true);
scanStocks(false);
setPoll(S.interval);
setStockPoll();
setHealthPoll();
