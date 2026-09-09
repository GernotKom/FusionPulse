/* ══ v4.3.6 · DER WAECHTER, DER `req.method` GEFUNDEN HAETTE ════════════════
   In /api/watchlist stand seit v4.1.0 `req.method` — der Handler heisst
   `request`. Jeder POST warf `ReferenceError: req is not defined`, das catch
   fing ihn, und die Oberflaeche meldete „Der Modus konnte nicht gespeichert
   werden." Der Watchlist-Modus liess sich dadurch NIE speichern; der Cron hat
   ihn nie gesehen. Sichtbar wurde es erst, als 4.3.0 bei `reason:'unknown'`
   die tatsaechliche Meldung durchreichte statt des Ersatztextes.

   `node --check` findet so etwas nicht (syntaktisch einwandfrei), und die
   Muster-Pruefung in tests/client-symbols.mjs auch nicht (kein Aufruf,
   sondern ein Zugriff). Dafuer braucht es einen Parser mit
   Gueltigkeitsbereichen. Genau eine Regel ist eingeschaltet: `no-undef`.
   Keine Stilregeln — die waeren nur Rauschen und wuerden dazu fuehren, dass
   der Lauf ignoriert wird. */
export default [
  {
    files: ['src/**/*.js', 'public/app.js', 'public/sw.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        // Browser
        window:'readonly', document:'readonly', console:'readonly', fetch:'readonly',
        setTimeout:'readonly', clearTimeout:'readonly', setInterval:'readonly', clearInterval:'readonly',
        requestAnimationFrame:'readonly', localStorage:'readonly', sessionStorage:'readonly',
        navigator:'readonly', location:'readonly', history:'readonly', alert:'readonly', confirm:'readonly',
        atob:'readonly', btoa:'readonly', matchMedia:'readonly', getComputedStyle:'readonly',
        IntersectionObserver:'readonly', MutationObserver:'readonly', ResizeObserver:'readonly',
        performance:'readonly', crypto:'readonly', Image:'readonly', Audio:'readonly',
        CustomEvent:'readonly', Event:'readonly', AbortController:'readonly', FileReader:'readonly',
        Blob:'readonly', File:'readonly', FormData:'readonly', Headers:'readonly',
        Request:'readonly', Response:'readonly', URL:'readonly', URLSearchParams:'readonly',
        TextEncoder:'readonly', TextDecoder:'readonly', structuredClone:'readonly',
        AbortSignal:'readonly', Notification:'readonly', CSS:'readonly',
        // Service Worker / Cloudflare Workers
        self:'readonly', caches:'readonly', clients:'readonly', addEventListener:'readonly',
        skipWaiting:'readonly', ServiceWorkerGlobalScope:'readonly', ExtendableEvent:'readonly',
        queueMicrotask:'readonly', WebSocketPair:'readonly', HTMLRewriter:'readonly',
      },
    },
    linterOptions: { reportUnusedDisableDirectives: true },
    rules: { 'no-undef': 'error' },
  },
];
