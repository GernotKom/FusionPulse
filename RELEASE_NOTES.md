# FusionPulse Release Notes — v3.2.7

## P0 ETF cache-leak hotfix
- Fixes a cache-path regression in v3.2.6: an early in-memory return could bypass the new common-stock gate and re-display old ETF/ETP candidates such as CRWU/AXTU.
- All fast/memo/stale stock-return paths now strip known non-common instruments before they reach the UI.
- Discovery data exposed from the memo path is restricted to already verified common stocks.
- Security metadata cache generation bumped to `v327` so stale classifications cannot be reused.
- Elliott-first discovery, Market Gainers, BUY gates, CRV rules and data-quality safety rules are unchanged.
