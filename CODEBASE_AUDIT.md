# Codebase Audit — Trading Research Rebuild

Produced: 2026-06-12  
Last updated: 2026-06-13  
Auditor: Claude Code (senior software architect review)
Source: Full inspection of all project files against `trading_robot_rebuild_plan.md`

> **Note:** This document was produced before implementation began. Sections 3, 4, and 6 describe the state at audit time. See the "Post-Implementation Update" section at the end for the current state of all items.

---

## Post-Implementation Update (2026-06-13)

### Items from Section 4 (Missing) that are now complete

| Item | Status | Notes |
|---|---|---|
| Database — all 14 tables | ✅ Live in Supabase | `prisma db push` confirmed all tables |
| Candle ingestion worker | 🔄 Code complete, deploying | `api/_lib/candle-ingestion.ts` + admin endpoints |
| Strategy version registry | ✅ Schema only | Tables exist; seed (Stage 4) not yet run |
| Crossfire setup storage | ✅ Schema only | Table exists; engine (Stage 5) not yet built |
| Signal storage | ✅ Schema only | Table exists; detection (Stage 6) not yet built |
| MFE/MAE tracking | ✅ Schema only | Table exists; engine (Stage 7) not yet built |
| Trade context capture | ✅ Schema only | Table exists |
| Sliced analytics | ✅ Schema only | Tables exist; engine (Stage 8) not yet built |
| BST/GMT timezone fix | ✅ Complete | `src/lib/time.ts`; all strategy code updated |

### Items from Section 3 (Should Be Removed) that are now complete

All Forex Battle game code has been removed from the `main` branch:
- `src/store/gameStore.ts` — removed
- `src/utils/gameLogic.ts` — removed
- `src/utils/forex.ts` — stripped to `getPairConfig`, `formatPrice`, `formatPriceDiff` only (GBM generator removed)
- `src/pages/Landing.tsx`, `Lobby.tsx`, `WaitingRoom.tsx`, `Game.tsx`, `Results.tsx` — removed
- `src/components/game/*` — removed
- `src/components/tournament/Leaderboard.tsx` — removed
- `src/hooks/useLiveRate.ts` — removed
- `src/types/index.ts` — stripped to `Candle` interface only
- Game types removed
- `useGameStore` removed from `ChartSandbox.tsx`

The full original codebase is preserved in the `forex-battle-v1` git branch.

### New files added since audit

| File | Purpose |
|---|---|
| `src/lib/time.ts` | BST-safe UK timezone utilities (`toUKHour`, `toUKDateString`, `toUKTimeString`) |
| `prisma/schema.prisma` | All 14 Prisma models; Prisma 7 (no URL in schema) |
| `prisma.config.ts` | Prisma CLI config; loads `.env.local` via dotenv |
| `api/_lib/db.ts` | Prisma 7 singleton with `@prisma/adapter-pg` |
| `api/_lib/oanda-client.ts` | Server-side OANDA REST client (direct, not via browser proxy) |
| `api/_lib/candle-ingestion.ts` | Candle fetch → validate → upsert → log |
| `api/admin/ingest.ts` | `POST /api/admin/ingest` — trigger candle import |
| `api/admin/candle-counts.ts` | `GET /api/admin/candle-counts` — candle counts per symbol/TF |
| `.env.example` | Documents all required environment variables |

### Architectural deviations from original audit recommendations

| Recommendation | What happened | Reason |
|---|---|---|
| Create `trading-research/` Next.js app | Reworked existing Vite app instead | Less overhead; existing API proxies work identically |
| `src/lib/db.ts` for Prisma client | `api/_lib/db.ts` | Vercel ESM bundling requires co-location with `api/` functions |
| `datasource db { url = env("DATABASE_URL") }` | URL removed from schema (Prisma 7 breaking change) | Prisma 7 requires driver adapter; URL managed via `prisma.config.ts` and `Pool` |
| Keep Forex Battle "completely untouched" | Archived to `forex-battle-v1` branch | Simpler than maintaining two parallel apps |

---

## Project Overview

The current codebase is a **Forex Battle prediction game** that has accumulated serious trading
infrastructure on top of it: a Crossfire backtesting sandbox, FTMO equity simulation, a live MT5
Expert Advisor, and Claude AI integration. The rebuild plan calls for separating these into a
dedicated trading research platform.

**Tech stack:** React 18 + TypeScript + Vite + Tailwind + Zustand. Deployed to Vercel. No database.

---

## 1. What Already Exists and Can Be Reused

### OANDA API Proxies
`api/oanda.ts` and `api/oanda-stream.ts`

Fully working Vercel serverless proxies for the OANDA v3 REST API and streaming API. API keys
stay server-side. Supports historical candle fetching (count, granularity, to, price params)
with up to 5,000 candles per request. Currently fetches mid-price ("M") only — bid/ask/spread
will need to be added when spread data is required. Directly reusable for the candle ingestion
worker with minimal changes.

### AI Proxy
`api/ai.ts`

Clean Vercel proxy to Anthropic Claude API with full Server-Sent Events (SSE) passthrough for
streaming responses. API key stays server-side. Currently wired to `claude-opus-4-5`. Production-
ready and reusable as-is for the AI research layer.

### CandlestickChart
`src/components/chart/CandlestickChart.tsx` (~612 lines)

High-performance canvas-based OHLC chart. Features: pan/zoom, infinite scroll-back with automatic
candle loading, trendline overlays, entry/exit markers with win/loss chips, SL/TP lines, background
fill zones, crosshair with price/time labels, volume bars. Receives a flat `Candle[]` array from
its parent — zero coupling to data source. This is the most complex and valuable component in the
project. It must be kept and wired to database data, not rewritten.

**Existing overlay types already supported:**
- Trendlines with slope (Crossfire green/red lines)
- Entry arrows (buy/sell) with result indicators
- Horizontal SL/TP lines
- Background shaded zones (trading windows)

### Crossfire Strategy Engine
`src/utils/strategies.ts` (~800 lines)

Already implements the core Crossfire logic:
- 1pm UK candle identification
- 8am–1pm swing high/low detection (HH/LL)
- Green/red trendline calculation with slope and intercept
- Entry detection: candle close beyond trendline
- Static and dynamic SL/TP calculation
- Full backtest loop (up to 60 sessions)
- AI-enhanced variant with 8 data-derived entry filters

This is the strategy engine. It needs to be extracted and hardened into separate layers, not
rewritten.

### Trade Feature Extraction
`src/utils/tradeFeatures.ts`

Per-trade feature extraction: body pips, wick ratio, total range, entry timing (minutesSince1pm,
hourOfEntry), pre-session range, H1 trend bias, previous day result. Solid foundation for the
analytics engine. Requires the BST/GMT fix before it can be trusted.

### FTMO Equity Simulation
`src/components/AiAnalysisPanel.tsx` (lines 128–180)

Working equity curve with Phase 1/Phase 2 milestone tracking, 5% daily loss limit, 10% max
drawdown, and pass/fail detection. Currently embedded inside a React component — needs to be
extracted into a standalone, testable pure function (`lib/ftmo.ts`).

### AI Analysis Panel
`src/components/AiAnalysisPanel.tsx` (663 lines total)

Two-panel layout: local statistical analysis (instant, no API) and Claude AI narrative with
streaming. Includes a full equity curve table, interactive date filtering, and FTMO mode toggle.
Recently updated with a chronological sort fix for accurate equity curves (entryTs ascending).
The UI shell is reusable; the FTMO calc and analytics logic inside it should be extracted.

### MT5 Expert Advisor Reference
`CrossfireEA.mq5`

The live MT5 EA implements trailing stops, breakeven logic, risk-based lot sizing, signal polling,
and broker-agnostic order execution. It is the authoritative reference for how the Crossfire
strategy behaves on a real broker. Use it as documentation when codifying exact strategy rules.
Do not copy MQL5 code into TypeScript — translate the intent.

### SMC Strategy
`src/utils/smcStrategy.ts`

A complete Smart Money Concepts backtester: liquidity sweep detection, order block identification,
Fibonacci retracement zones, entry/exit simulation. Well-implemented but not mentioned in the
rebuild plan. Keep in Forex Battle scope; do not bring into the trading-research platform.

### Shared UI Components
`src/components/ui/Button.tsx` — theme-aware button variants (primary, up/down, gold, ghost, danger).
Reusable as-is.

### TypeScript Interfaces (partial reuse)
From `src/utils/strategies.ts`:
- `BacktestTrade` — direction, sessionDate, entryTs/Price, slPrice, tpPrice, exitTs, result, pnlPips
- `BacktestStats` — wins, losses, winRate, avgWin, avgLoss, expectancy

From `src/utils/tradeFeatures.ts`:
- `TradeFeatures extends BacktestTrade` — bodyPips, wickRatio, minutesSince1pm, h1TrendBias, etc.

These need extension (add setup_id, signal_id, strategy_version_id, MFE/MAE fields) but are
good starting points.

---

## 2. What Exists But Should Be Refactored

### `src/utils/strategies.ts` — Split into three separate layers

Currently mixes: pure line math, backtest loop, overlay generation, session boundary logic, and
AI filter variants in one 800-line file. These concerns must be separated:

| New file | Content extracted from strategies.ts |
|---|---|
| `lib/crossfire-setup.ts` | Line math: HH/LL detection, slope/intercept calculation |
| `lib/signal-detection.ts` | Entry detection: candle close vs line price, breakout classification |
| `lib/trade-simulation.ts` | SL/TP simulation, exit scanning, R calculation |
| `lib/backtest-runner.ts` | Orchestration loop over date range |
| `components/chart/overlays.ts` | Overlay generation (visualization only, no logic) |

The existing in-memory chart backtest path (`ChartSandbox.tsx` → `strategies.ts`) should remain
working throughout the refactor. New DB-backed paths are additive, not replacements.

### `src/components/AiAnalysisPanel.tsx` — Extract three embedded concerns

663 lines mixing four unrelated responsibilities:

| New file | What to extract |
|---|---|
| `lib/ftmo.ts` | Pure equity curve + FTMO pass/fail logic (lines 128–180) |
| `lib/analytics.ts` | Feature stat computation and pattern detection |
| `lib/ai-prompt.ts` | Prompt building and Claude stream handling |

Keep AiAnalysisPanel.tsx as a thin React shell that imports from these modules.

### `src/pages/ChartSandbox.tsx` — Becomes the research app's main page

Currently conflates: live OANDA candle fetching, all backtest trigger logic, chart state management,
and multiple strategy modes. The Oanda fetching should move to a service/API layer. ChartSandbox
becomes the research platform's primary chart/review page.

### Candle timeframe list — Add H4 and D1

The `TIMEFRAMES` array in ChartSandbox.tsx stops at H1. The rebuild plan requires H4 and D1 for
higher-timeframe bias and daily range analysis. Add:
- `{ label: 'H4', oanda: 'H4', seconds: 14400 }`
- `{ label: 'D1', oanda: 'D', seconds: 86400 }`

### `BacktestTrade` type — Extend for the rebuild

Missing fields required by the plan:
- `setup_id`, `signal_id`, `strategy_version_id`, `backtest_run_id`
- `mfe_r`, `mae_r` (from `trade_path_analysis`)
- `breakout_type` (strong_body/weak_body/wick)
- `market_condition`, `atr_band`, `trend_h1`, `trend_h4` (from `trade_context`)

---

## 3. What Should Be Removed from the Research Platform

The following files are game-only concerns. They must stay in Forex Battle and must NOT be
copied into the trading-research app.

| File | Reason |
|---|---|
| `src/store/gameStore.ts` | Game state machine: screens, waiting room, AI bots, elimination |
| `src/utils/gameLogic.ts` | Point scoring, streak multipliers, player elimination, prize math |
| `src/utils/forex.ts` | GBM candle generator — research uses real OANDA data only |
| `src/pages/Landing.tsx` | Game landing page |
| `src/pages/Lobby.tsx` | Tournament browser |
| `src/pages/WaitingRoom.tsx` | Player countdown screen |
| `src/pages/Game.tsx` | Main battle UI |
| `src/pages/Results.tsx` | Final leaderboard |
| `src/components/game/*` | Timer, PredictionControls, RoundResultOverlay, EliminationOverlay, StreakBadge |
| `src/components/tournament/Leaderboard.tsx` | Tournament rank list |
| `src/hooks/useLiveRate.ts` | Frankfurter rate seed for GBM generator |
| `src/hooks/useOandaStream.ts` | Live tick streaming for game (not needed until paper trading) |
| `api/rates.ts` | Frankfurter FX rate proxy (GBM seed only) |
| Game types in `src/types/index.ts` | Player, RoundResult, TournamentTemplate, RiskConfig, etc. |

**`react-router-dom`** is installed as a dependency but never used (app uses Zustand screen state
instead). The research platform should use it properly with actual URL routing.

---

## 4. What Is Currently Missing

### Database — Nothing exists
Zero database, zero ORM, zero schema, zero persistence of any kind. All 14 tables described
in the rebuild plan are completely absent:

```
candles, import_logs, strategies, strategy_versions,
crossfire_setups, signals, trades, trade_path_analysis,
trade_context, backtest_runs, analytics_summaries,
ai_reviews, strategy_recommendations, funded_account_tests
```

All backtest results are computed on demand from in-memory candle arrays and discarded on
page reload. This is the single largest gap in the project.

**Recommended stack:** Supabase (Postgres) + Prisma ORM

### Candle Ingestion Worker
No bulk import mechanism exists. The current `ChartSandbox.tsx` fetches candles on-demand
for chart display only — loading up to ~100,000 candles into memory, discarded on reload.
A proper import worker is needed that fetches by symbol + timeframe + date range, deduplicates
via upsert, validates candle integrity, and logs results to `import_logs`.

### Strategy Version Registry
Crossfire strategy parameters are hardcoded constants scattered through `strategies.ts`. There
is no versioning, no storage, and no way to link a set of backtest trades to the exact settings
that produced them. Two consecutive backtests with different constants produce results that
cannot be compared or reproduced.

### Crossfire Setup Storage
`strategies.ts` calculates Crossfire lines but does not save a `crossfire_setups` row. There
is no persistent record of whether a given day's setup was valid or invalid, what the anchor
candles were, or what the line formula values were.

### Signal Storage
`api/signal.ts` holds one pending signal as a module-level variable (resets on Vercel cold
start). There is no database of all detected breakout signals, their classifications, or their
validation status.

### MFE/MAE Tracking
`BacktestTrade` tracks `pnlPips` but contains no excursion data. The `trade_path_analysis`
table and all R-milestone tracking (reached_1r, reached_2r, reached_3r, break-even analysis,
time_to_1r_minutes) is entirely absent.

### Trade Context Capture
`tradeFeatures.ts` computes context fields (ATR, H1 trend, pre-session range) on demand
but does not persist them. The `trade_context` table is absent. All context is computed
and immediately discarded.

### Sliced Analytics
`BacktestStats` produces overall win rate and expectancy. There are no breakdowns by:
- Symbol
- Day of week
- Entry hour / session time
- Breakout type (strong body / weak body / wick)
- ATR band (low / normal / high volatility)
- Trend alignment (with / against H1 or H4)
- Distance from previous day high/low

### BST/GMT Timezone Handling
**This is a live bug.** All UK-time detection uses `d.getHours() === 13` which assumes
UTC equals UK time. During British Summer Time (late March – late October), UK 1pm equals
UTC 12:00 — not 13:00. This means the strategy misidentifies the setup candle for
approximately 7 months of every year. Any backtests that span BST periods are using the
wrong 1pm candle.

### H4 and D1 Timeframes
The chart timeframe selector stops at H1. H4 and D1 candles are not fetched, stored, or
displayed. Higher-timeframe bias and daily range context (required by sections 4 and 13 of
the rebuild plan) cannot be computed without them.

### Walk-Forward and Out-of-Sample Testing
No anti-overfitting infrastructure of any kind: no in-sample/out-of-sample split, no
walk-forward testing, no random start-date testing, no minimum sample size enforcement.

### Admin and Management Pages
No candle import status page, no strategy management UI, no trade explorer, no backtest
history dashboard.

---

## 5. Architectural Concerns

### UTC ≠ UK Time (Severity: Critical)

All strategy logic uses `new Date(ts).getHours() === 13` to identify the 1pm UK setup candle.
This assumes the runtime clock is in UTC and that UTC equals UK time. During BST (last Sunday
of March through last Sunday of October), UK clocks are UTC+1. The 1pm UK candle occurs at
12:00 UTC, not 13:00 UTC.

**Impact:** Approximately 7 months of every year, the strategy fires on the 12:00 UTC candle
instead of the 13:00 UTC candle (actual UK 1pm). All backtests covering any BST period are
producing results for the wrong setup candle.

**Fix:** Build a `toUKHour(tsMs)` utility using
`Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London' })` and replace all `getHours()`
calls before any other strategy code is touched.

### In-Memory Signal Relay (Severity: High for live use)

`api/signal.ts` stores the pending MT5 trade signal as a module-level JavaScript variable.
Vercel serverless functions are stateless — the function is torn down between invocations and
cold-started on the next request. If Vercel cold-starts the function between the signal being
posted and the MT5 EA polling for it (every 10 seconds), the signal is silently lost with no
error. Signals must be persisted to the database before any live alert mode is used.

### No Strategy Versioning = Unrepeatable Backtests (Severity: High)

There is currently no way to know which parameter values produced a given set of backtest
results. The `rrRatio`, `minBodyPips`, `maxBodyPips`, H1 trend filter threshold, and other
constants in `strategies.ts` can change between runs without any record of what was set.
Every backtest is unrepeatable. This must be resolved before any backtest data is considered
meaningful for research purposes.

### Chart Data Source Coupling (Severity: Low — clean architecture)

`CandlestickChart.tsx` correctly receives a flat `Candle[]` array from its parent with no
awareness of the data source. The parent (`ChartSandbox.tsx`) owns all data fetching. This
is clean and makes the migration to database-backed data straightforward — only the parent
needs to change, not the chart component.

### Monolith vs Monorepo Timing (Severity: Low — sequencing risk)

The rebuild plan recommends a full monorepo structure (`/apps`, `/packages`). This is the
right end state but adds significant tooling overhead upfront (Turborepo, workspace resolution,
shared package builds). Starting with a separate `trading-research/` Next.js app at the repo
root first is lower risk. Extract shared packages into a monorepo structure after the system
is proven. Do not block the first three stages on monorepo setup.

### Crossfire Rule Ambiguities Still Exist (Severity: Medium)

The rebuild plan correctly identifies several vague rules. In the current code:
- Previous high = highest high between 08:00 and 13:00 (not fractal high, not swing high)
- Breakout = candle close beyond trendline (not wick, not body-only)
- Stop loss = configurable static or dynamic pips from the opposite line

These are implemented but the definitions are not stored as strategy settings. Before building
the setup detection engine (Stage 5), the user must confirm and lock these exact definitions.
Changing them later requires a new strategy version and a full re-backtest.

### Missing H4 and D1 in Chart and Backtest (Severity: Medium)

The higher-timeframe bias required by sections 4 and 13 of the rebuild plan (H4 trend,
daily range, previous day high/low) cannot be computed without H4 and D1 candles. The candle
ingestion worker must include these timeframes from the start, even if the analysis features
that use them come later.

---

## 6. Summary Table

| Component | Status | Action Required |
|---|---|---|
| OANDA REST proxy | Reuse | Add bid/ask price mode |
| OANDA stream proxy | Reuse | No changes needed |
| AI (Claude) proxy | Reuse | No changes needed |
| CandlestickChart.tsx | Reuse | Wire to DB data source |
| strategies.ts | Refactor | Split into 5 separate layers |
| tradeFeatures.ts | Refactor | Fix BST bug, add persistence |
| AiAnalysisPanel.tsx | Refactor | Extract FTMO, analytics, AI prompt |
| BacktestTrade types | Extend | Add setup/signal/version IDs, MFE/MAE |
| CrossfireEA.mq5 | Reference | Documentation only |
| smcStrategy.ts | Keep in Forex Battle | Do not copy to research app |
| gameStore.ts | Keep in Forex Battle | Not needed in research app |
| gameLogic.ts | Keep in Forex Battle | Not needed in research app |
| forex.ts (GBM) | Keep in Forex Battle | Research uses real data |
| All game pages/components | Keep in Forex Battle | Not needed in research app |
| useLiveRate.ts | Keep in Forex Battle | Research uses DB candles |
| useOandaStream.ts | Keep in Forex Battle | Not needed until paper trading |
| api/rates.ts | Keep in Forex Battle | GBM seed only |
| Database | Missing | Build from scratch (Supabase + Prisma) |
| Candle ingestion worker | Missing | Build in Stage 3 |
| Strategy version registry | Missing | Build in Stage 4 |
| Crossfire setup engine | Missing | Build in Stage 5 |
| Signal detection | Missing | Build in Stage 6 |
| Trade simulation (DB) | Missing | Build in Stage 6 |
| MFE/MAE tracking | Missing | Build in Stage 7 |
| Analytics engine | Missing | Build in Stage 8 |
| FTMO simulation (DB) | Missing | Build in Stage 8 |
| AI research layer | Missing | Build in Stage 10 |
| BST/GMT fix | Missing | Build in Stage 0 (first) |
| H4/D1 timeframes | Missing | Add in Stage 3 candle ingestion |
| Admin pages | Missing | Built progressively with each stage |
