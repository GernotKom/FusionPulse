# FusionPulse Release Notes — v3.2.8

## P0 Browser-cache ETF leak hotfix
- Fixes the remaining ETF/ETP resurrection path in the browser frontend. `fp.stockLastRows.v1` could re-add stale Discovery rows after the Worker had correctly removed them.
- Stock last-row cache migrated to `fp.stockLastRows.v2`; the legacy v1 cache is purged once on load.
- Cached fallback rows are now allowed only for explicit Favorites/Depot symbols. Old non-favorite Discovery candidates are never reintroduced by the browser.
- Frontend adds an exclusion-only defensive non-common-instrument sanitizer (including CRWU/AXTU and obvious ETF/ETN/ETP/leveraged/inverse naming). Server-side common-stock verification remains authoritative.
- Elliott-first Discovery, Market Gainers, BUY gates, data-quality rules and net CRV > 3:1 remain unchanged.
- Shooting/Short remains a separate planned workflow and is not mixed into the Long scanner in this hotfix.
