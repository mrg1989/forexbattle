# Implementation Plan — Trading Research Platform

Produced: 2026-06-12  
Last updated: 2026-06-13

Prerequisite reading: `trading_robot_rebuild_plan.md` (goals and requirements), `CODEBASE_AUDIT.md` (what exists)

---

## Current Status

| Stage | Name | Status |
|---|---|---|
| 0 | Timezone Foundation | ✅ Complete |
| 1 | Project Separation | ✅ Complete (architectural deviation — see below) |
| 2 | Database Schema | ✅ Complete |
| 3 | Candle Ingestion Worker | ✅ Complete |
| 4 | Strategy Registry | ✅ Complete |
| 5 | Crossfire Setup Engine | ✅ Complete |
| 6 | Signal Detection + Trade Simulation | ✅ Complete |
| 7 | MFE and MAE Tracking | ✅ Complete |
| 8 | Analytics Engine + FTMO Simulation | ⏳ In Progress |
| 9 | Chart + Trade Review Integration | ⏳ Not Started |
| 10 | AI Research Layer | ⏳ Not Started |

---

## Guiding Principles

1. Each stage must be independently testable and leave the project in a working state.
2. No stage depends on unfinished future work.
3. Forex Battle is never modified — zero file changes to the existing app.
4. All reusable components identified in the audit are preserved and copied, not rewritten.
5. The smallest functional research platform (MVP) is built first before analytics or AI.
6. AI is a research analyst: it reads summaries, suggests filters, and requires human approval.
   It does not directly change live strategy settings.

---

## Technology Decisions

| Concern | Choice | Reason |
|---|---|---|
| Framework | **Vite (existing app reworked)** | See architectural decisions below |
| Database | Supabase (Postgres) | Relational, dashboard access, Vercel-compatible |
| ORM | Prisma 7 | Type-safe queries, migration management, schema as code |
| UI state | Zustand | Already familiar, lightweight |
| Styling | Tailwind CSS | Already configured |
| Forex Battle archive | `forex-battle-v1` git branch | Game features removed from main app; archived permanently |

---

## Architectural Decisions

These decisions deviate from the original plan and are recorded here permanently.

### Decision 1: Rework existing Vite app instead of creating a new Next.js app

**Original plan:** Create a separate `trading-research/` Next.js 14 app alongside the existing Forex Battle Vite app.

**What was done:** The existing Vite app was reworked into the trading research platform. All Forex Battle game features were removed. The game was archived to the `forex-battle-v1` git branch.

**Why:** The existing Vite app already had a working chart, OANDA proxy, Crossfire strategy engine, and AI analysis. Rebuilding all of that in Next.js would have been pure overhead with no user benefit. The Vercel `api/` serverless function pattern works identically in Vite — there was no technical reason to switch frameworks. Maintaining two apps in parallel (Forex Battle + trading-research) also creates confusion about which is canonical. A clean archive branch is simpler.

**Impact:** All file paths in this document that reference `trading-research/` should be read as the project root. The `api/` directory and `src/` directory are at the root level.

### Decision 2: Server-only library files at `api/_lib/` not `src/lib/`

**Original plan:** Prisma client and server-only utilities at `src/lib/db.ts`, `src/lib/candle-ingestion.ts`, etc.

**What was done:** All server-only files live at `api/_lib/db.ts`, `api/_lib/candle-ingestion.ts`, `api/_lib/oanda-client.ts`.

**Why:** `"type": "module"` in `package.json` causes `@vercel/node` v5 to run serverless functions as native Node.js ESM without esbuild bundling. In native ESM, relative imports must use explicit `.js` extensions and the referenced file must be co-located with the function. Files in `src/lib/` are not included in the serverless function deployment bundle. Files in `api/_lib/` (the `_` prefix prevents Vercel treating them as function endpoints) are co-located and correctly deployed.

### Decision 3: Prisma 7 driver adapter pattern

**Original plan:** `new PrismaClient()` singleton, URL in `schema.prisma` via `datasource db { url = env("DATABASE_URL") }`.

**What was done:** `new PrismaClient({ adapter: new PrismaPg(pool) })`, URL managed separately via `prisma.config.ts` with dotenv for CLI and `process.env.DATABASE_URL` for runtime.

**Why:** Prisma 7 removed the URL-in-schema approach. Driver adapters (`@prisma/adapter-pg`) are now required. The CLI uses `prisma.config.ts` which loads `.env.local` via dotenv (Prisma CLI only auto-loads `.env`, not `.env.local`). Runtime uses the adapter with `pg.Pool`.

### Decision 4: Stage 3 initial scope — M5 and M15 only

**Original plan:** Import M5, M15, H1, H4, D1 from Stage 3.

**What was done:** Admin endpoints built to accept any timeframe. Initial validation uses EUR_USD M5 and M15 only.

**Why:** Validate the ingestion pipeline end-to-end before importing the full set. The code already supports all timeframes — expanding after validation is trivial.

---

## Environment Variables Required

```
DATABASE_URL        Supabase pooler connection string (for runtime)
DIRECT_URL          Supabase direct connection string (for Prisma migrations only)
OANDA_TOKEN         OANDA practice account bearer token
OANDA_ACCOUNT       OANDA account ID
ANTHROPIC_API_KEY   Anthropic API key
ADMIN_SECRET        Simple shared secret to protect admin API routes
```

---

## Stage Overview

| # | Name | Depends On | Est. Effort | MVP? |
|---|---|---|---|---|
| 0 | Timezone Foundation | — | 0.5 days | Yes |
| 1 | Project Separation | 0 | 1 day | Yes |
| 2 | Database Schema | 1 | 1 day | Yes |
| 3 | Candle Ingestion Worker | 2 | 2 days | Yes |
| 4 | Strategy Registry | 2 | 0.5 days | Yes |
| 5 | Crossfire Setup Engine | 3, 4 | 2 days | Yes |
| 6 | Signal Detection + Trade Simulation | 5 | 2 days | Yes |
| 7 | MFE and MAE Tracking | 6 | 1 day | No |
| 8 | Analytics Engine + FTMO Simulation | 6, 7 | 2 days | No |
| 9 | Chart + Trade Review Integration | 3, 6 | 1 day | Yes |
| 10 | AI Research Layer | 8 | 1 day | No |

---

## Stage 0: Timezone Foundation ✅ COMPLETE

### Objective
Fix the BST/GMT bug that causes the 1pm UK candle to be misidentified for approximately
7 months of the year. This is a prerequisite for every subsequent stage — no backtest data
can be trusted until this is correct.

The bug: `d.getHours() === 13` assumes UTC equals UK time. During BST (late March – late
October), UK 1pm = UTC 12:00. The strategy currently fires on the wrong candle for the
entire BST period.

### Files Affected
```
trading-research/
  src/
    lib/
      time.ts                    [NEW]
```
No existing Forex Battle files are modified.

### Database Changes
None.

### Dependencies
None. This stage has no upstream requirements.

### Implementation Detail
Create `time.ts` with three exports:

```typescript
// Convert any UTC timestamp (ms) to UK wall-clock hour (0–23).
// Handles GMT (UTC+0) and BST (UTC+1) correctly via IANA timezone data.
export function toUKHour(tsMs: number): number

// Return a stable YYYY-MM-DD date string in UK local time.
export function toUKDateString(tsMs: number): string

// Return UK HH:MM string.
export function toUKTimeString(tsMs: number): string
```

Implementation uses `Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London' })`. No
third-party library needed. Supported in Node 18+, all modern browsers, and Vercel runtimes.

### Validation Criteria
1. `toUKHour(Date.UTC(2024, 2, 31, 12, 0, 0))` → `13` (BST started 31 March 2024; UTC 12 = UK 13)
2. `toUKHour(Date.UTC(2024, 2, 30, 12, 0, 0))` → `12` (still GMT the day before)
3. `toUKHour(Date.UTC(2024, 9, 27, 12, 0, 0))` → `12` (BST ended 27 Oct 2024; UTC 12 = UK 12)
4. `toUKHour(Date.UTC(2024, 9, 26, 12, 0, 0))` → `13` (still BST the day before)
5. `toUKDateString(Date.UTC(2024, 0, 1, 0, 30, 0))` → `"2024-01-01"` (not Dec 31)
6. Write a Node test script iterating one sample date per month across 2022–2026. Spot-check
   March and October DST transitions manually.

### Risks
Low. `Intl.DateTimeFormat` is universally available in target runtimes. The risk is
misreading test assertions — the validation cases above cover both transitions in both
directions.

### Expected Outcome
A single, tested, importable utility that all future strategy and backtest code depends on
for UK time operations. No existing files changed.

### Completion Notes
- `src/lib/time.ts` created with module-level cached `Intl.DateTimeFormat` formatter (avoids per-call construction overhead that caused 100% CPU regression)
- `src/utils/strategies.ts` fully updated — all `getHours() === 13` replaced with `toUKHour(ts) === 13`, all `toDateString()` replaced with `toUKDateString(ts)`
- `src/utils/tradeFeatures.ts` updated with BST-fixed version

---

## Stage 1: Project Separation ✅ COMPLETE (with architectural deviation)

> **Deviation:** A new Next.js app was NOT created. The existing Vite app was reworked into the trading research platform. See Architectural Decision 1 above.

### Objective
~~Create a new `trading-research/` Next.js 14 app at the repo root.~~

**Actual objective achieved:** Stripped all Forex Battle game features from the existing Vite app. Preserved chart, OANDA proxy, Crossfire strategy engine, AI analysis, and FTMO logic. Archived the full Forex Battle game to the `forex-battle-v1` git branch. Copy reusable components
from Forex Battle into it. Establish routing, API proxy config, and environment variable
wiring. Verify the chart loads live OANDA candles in the new app. Forex Battle is completely
untouched throughout.

### Files Affected
```
trading-research/                          [NEW directory]
  package.json
  tsconfig.json
  next.config.ts
  tailwind.config.ts
  postcss.config.js
  .env.local                               [copy keys from parent .env.local]
  src/
    app/
      layout.tsx                           [root layout, dark theme]
      page.tsx                             [redirect → /chart]
      chart/
        page.tsx                           [ChartSandbox migrated here]
      admin/
        page.tsx                           ["coming soon" placeholder]
    lib/
      time.ts                              [from Stage 0]
    utils/
      strategies.ts                        [copied; imports time.ts instead of getHours()]
      tradeFeatures.ts                     [copied; imports time.ts]
    components/
      chart/
        CandlestickChart.tsx               [copied — zero changes]
      AiAnalysisPanel.tsx                  [copied — zero changes]
      ui/
        Button.tsx                         [copied — zero changes]
  api/
    oanda/
      [...path]/
        route.ts                           [Next.js App Router catch-all proxy]
    oanda-stream/
      [...path]/
        route.ts
    ai/
      [...path]/
        route.ts
```

Forex Battle: **zero file changes.**

### Database Changes
None.

### Dependencies
- Stage 0 complete (`time.ts` available)
- Node 18+
- OANDA_TOKEN, OANDA_ACCOUNT, ANTHROPIC_API_KEY available

### Implementation Detail
`next.config.ts` rewrites:
- `/api/oanda/**` → `https://api-fxpractice.oanda.com/v3`
- `/api/oanda-stream/**` → `https://stream-fxpractice.oanda.com/v3`
- `/api/ai/**` → `https://api.anthropic.com`

The `strategies.ts` copy replaces all `new Date(ts).getHours()` calls with
`toUKHour(ts)` imported from `../lib/time`. The `ChartSandbox` chart page is a direct
migration with no logic changes — only import paths update.

### Validation Criteria
1. `cd trading-research && npm run dev` starts on port 3001 without errors.
2. `/chart` page loads and renders OANDA candles for EUR_USD M15.
3. Crossfire backtest runs and draws green/red trendlines on the chart.
4. AI analysis panel opens and streams a Claude response.
5. From the repo root: `npm run dev` still starts the Forex Battle game on port 3000 and
   the game is fully functional.
6. `grep -r "from '../../src/" trading-research/` returns nothing — no cross-app imports.

### Risks
- **Next.js App Router proxy syntax** differs from Vite. The catch-all `[...path]` pattern
  must handle all OANDA sub-paths including account IDs. Test both candle history and streaming.
- **Tailwind config** must be fully independent. Do not import or extend the root config.
- Run apps on different ports to avoid conflicts (3000 and 3001).

### Expected Outcome
A standalone Next.js trading research app with working chart and AI analysis, running
alongside Forex Battle with zero shared files.

### Completion Notes
- Forex Battle game archived to `forex-battle-v1` branch
- `src/App.tsx` now renders `ChartSandbox` directly (no routing/game screens)
- `src/utils/forex.ts` stripped to keep only `getPairConfig`, `formatPrice`, `formatPriceDiff`
- `src/types/index.ts` stripped to `Candle` interface only
- All `useGameStore` references removed from `ChartSandbox.tsx`
- BST-fixed `strategies.ts` and `tradeFeatures.ts` in place
- Chart performance regression fixed: module-level formatter cache; deep backtest deferred via `useEffect` + `setTimeout(0)`
- `npm run dev` and `npm run build` pass cleanly

---

## Stage 2: Database Schema ✅ COMPLETE

### Objective
Create the complete Postgres schema for the trading research system. All 14 tables, all
foreign keys, all unique constraints, all indexes. No data ingestion yet. This stage
establishes the Prisma client that every subsequent stage imports.

### Files Affected
```
trading-research/
  prisma/
    schema.prisma                          [NEW — all 14 models]
    migrations/
      0001_init/
        migration.sql                      [generated by prisma migrate dev]
  src/
    lib/
      db.ts                                [NEW — Prisma client singleton]
```

### Database Changes
Creates all 14 tables. No data inserted.

```
candles
  - id, symbol, timeframe, timestamp_utc (DateTime), open, high, low, close,
    volume, spread, source, created_at
  - UNIQUE(symbol, timeframe, timestamp_utc)

import_logs
  - id, symbol, timeframe, from_date, to_date, inserted, skipped, invalid,
    status, error_message, created_at

strategies
  - id, name, description, status, created_at, updated_at

strategy_versions
  - id, strategy_id (FK), version_number (Int), version_name, settings_json (Json),
    notes, is_active, is_live_approved, created_at, created_by
  - UNIQUE(strategy_id, version_number)

crossfire_setups
  - id, strategy_version_id (FK), symbol, date_uk, setup_time_utc, setup_candle_id,
    reference_start_time_uk, previous_high_price, previous_high_time_utc,
    previous_low_price, previous_low_time_utc, green_line_slope, green_line_intercept,
    green_line_origin_ts, red_line_slope, red_line_intercept, red_line_origin_ts,
    setup_valid, invalid_reason, created_at
  - UNIQUE(strategy_version_id, symbol, date_uk)

signals
  - id, setup_id (FK), strategy_version_id (FK), symbol, direction, signal_time_utc,
    signal_candle_open/high/low/close, breakout_type, breakout_distance_pips,
    body_size, wick_ratio, spread_at_signal, signal_valid, invalid_reason, created_at

trades
  - id, signal_id (FK), setup_id (FK), strategy_version_id (FK), backtest_run_id (FK),
    symbol, direction, entry_time_utc, entry_price, stop_loss_price, take_profit_price,
    risk_pips, reward_pips, risk_reward_ratio, result, exit_time_utc, exit_price,
    profit_loss_r, exit_reason, created_at

trade_path_analysis
  - id, trade_id (FK UNIQUE), max_favourable_price, max_adverse_price,
    max_favourable_r, max_adverse_r, reached_0_5r, reached_1r, reached_1_5r,
    reached_2r, reached_2_5r, reached_3r, returned_to_entry_after_1r,
    would_be_have_helped, would_trailing_stop_have_helped,
    time_to_1r_minutes, time_to_2r_minutes, time_to_3r_minutes,
    time_to_exit_minutes, created_at

trade_context
  - id, trade_id (FK UNIQUE), trend_m15, trend_h1, trend_h4, daily_bias,
    range_0800_to_1300_pips, atr_m5, atr_m15, atr_h1,
    previous_day_high, previous_day_low, near_previous_day_high,
    near_previous_day_low, near_round_number, market_condition,
    volatility_condition, created_at

backtest_runs
  - id, strategy_version_id (FK), symbol, start_date, end_date,
    timeframes_used, initial_balance, risk_per_trade, spread_mode,
    settings_snapshot_json (Json), status, started_at, completed_at,
    total_trades, wins, losses, win_rate, notes, created_at

analytics_summaries
  - id, backtest_run_id (FK), strategy_version_id (FK), summary_type,
    summary_json (Json), created_at

ai_reviews
  - id, backtest_run_id (FK), strategy_version_id (FK), review_type,
    input_summary_json (Json), ai_model, ai_prompt, ai_response,
    recommendations_json (Json), created_at

strategy_recommendations
  - id, ai_review_id (FK), strategy_version_id (FK), recommendation_type,
    description, proposed_settings_json (Json), reasoning, expected_benefit,
    risk, status, created_at, approved_at, rejected_at

funded_account_tests
  - id, strategy_version_id (FK), backtest_run_id (FK), account_size,
    profit_target_percent, max_daily_loss_percent, max_total_loss_percent,
    risk_per_trade_percent, start_balance, end_balance, peak_balance,
    lowest_balance, passed, failed, failure_reason, trades_to_pass,
    days_to_pass, max_drawdown_percent, max_daily_drawdown_percent, created_at
```

**Prisma client singleton** (`lib/db.ts`):
```typescript
import { PrismaClient } from '@prisma/client'
const globalForPrisma = global as unknown as { prisma: PrismaClient }
export const db = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
export default db
```

### Dependencies
- Stage 1 complete (trading-research app exists)
- Supabase project created; DATABASE_URL and DIRECT_URL in `.env.local`
- `npm install prisma @prisma/client` run in trading-research

### Validation Criteria
1. `npx prisma migrate dev --name init` completes without errors.
2. `npx prisma studio` opens and shows all 14 tables with correct columns.
3. Insert one `candles` row; attempt a duplicate insert — unique constraint rejects it.
4. Insert a `strategies` row and a linked `strategy_versions` row — FK constraint satisfied.
5. Attempt to insert a `strategy_versions` row with a non-existent `strategy_id` — FK
   constraint rejects it.
6. `import { db } from '@/lib/db'` resolves in a test API route without runtime error.

### Risks
- **Supabase free tier connection limits.** Next.js serverless functions may exhaust the
  default 20 Postgres connections. Set `DATABASE_URL` to the Supabase PgBouncer pooler URL
  in production. Use `DIRECT_URL` for Prisma migrations. Configure
  `datasource db { directUrl = env("DIRECT_URL") }` in schema.prisma.
- **Prisma shadow database** for migrations is not supported on Supabase free tier. Use
  `prisma db push` during initial development; switch to `prisma migrate dev` with a local
  Postgres instance or paid Supabase tier for production migration management.

### Expected Outcome
A complete, version-controlled schema. Prisma client available to all future API routes.
The app continues to run and the chart continues to work — no existing functionality broken.

### Completion Notes
- `prisma/schema.prisma` — all 14 models, all constraints, all unique indexes. Datasource block has no URL (Prisma 7 requirement).
- `prisma.config.ts` — loads `.env.local` via dotenv before reading `DIRECT_URL`; used by Prisma CLI only
- `api/_lib/db.ts` — Prisma 7 singleton using `@prisma/adapter-pg` + `pg.Pool` (see Architectural Decision 2 and 3)
- `.env.example` — documents all required environment variables
- `package.json` — `postinstall: prisma generate`; deps: `@prisma/adapter-pg`, `@prisma/client`, `pg`
- All 14 tables confirmed live in Supabase via `npx prisma db push`

---

## Stage 3: Candle Ingestion Worker ✅ COMPLETE

### Objective
Build the system that imports historical OANDA candles into the database. An admin page shows
import progress. After this stage the database contains real, queryable candle data for the
first time.

Initial targets: EUR_USD and GBP_USD, M5 and M15 timeframes, from 2022-01-01 to today.
H1, H4, and D1 are imported in the same stage via the same mechanism.

### Files Affected
```
trading-research/
  src/
    lib/
      oanda.ts                           [NEW — typed OANDA REST client]
      candle-ingestion.ts                [NEW — fetch, validate, upsert]
    app/
      admin/
        page.tsx                         [updated — candle import admin UI]
      api/
        admin/
          ingest/
            route.ts                     [POST: trigger import job]
          candle-counts/
            route.ts                     [GET: counts per symbol + timeframe]
```

### Database Changes
Populates `candles` and `import_logs`. No schema changes.

### Dependencies
- Stage 2 complete (schema and Prisma client exist)
- OANDA_TOKEN and OANDA_ACCOUNT in .env.local

### Implementation Detail

**`lib/oanda.ts`** — typed wrapper around the OANDA proxy:
```typescript
export async function fetchOandaCandles(
  instrument: string,       // "EUR_USD"
  granularity: 'M5' | 'M15' | 'H1' | 'H4' | 'D',
  from: Date,
  to: Date
): Promise<OandaCandle[]>
```
Automatically pages through OANDA's 5,000-candle limit per request. Adds a 200ms delay
between batch requests. Transforms the Oanda `{ o, h, l, c, volume }` mid-price response
into the `candles` table schema shape.

**`lib/candle-ingestion.ts`**:
```typescript
export async function ingestCandles(
  symbol: string,
  timeframe: 'M5' | 'M15' | 'H1' | 'H4' | 'D1',
  from: Date,
  to: Date
): Promise<IngestResult>
// Returns { inserted, skipped, invalid, durationMs }
```
Steps:
1. Fetch candles from OANDA in batches via `oanda.ts`.
2. Validate each candle: `high >= max(open, close)` and `low <= min(open, close)`.
3. Upsert via `db.candle.createMany({ data, skipDuplicates: true })`.
4. Log result to `import_logs`.
5. Return summary counts.

**Admin page** (`admin/page.tsx`):
- Table showing: symbol × timeframe × candle count × earliest timestamp × latest timestamp.
- Form: select symbol, timeframe, date range → POST to `/api/admin/ingest`.
- Progress polling: `/api/admin/candle-counts` refreshes every 5 seconds during an active job.

### Validation Criteria
1. Import EUR_USD M5 for 2024-01-01 to 2024-12-31. Admin UI shows ≈ 72,000–74,000 candles.
2. Run the same import a second time. `import_logs` shows `inserted: 0, skipped: ~73000`.
   Zero duplicates added.
3. Direct SQL: `SELECT COUNT(*) FROM candles WHERE symbol='EUR_USD' AND timeframe='M5'`
   matches the admin UI count.
4. Spot-check a BST-period candle: query for EUR_USD M15 at `timestamp_utc = 2024-06-04T12:00:00Z`.
   Row must exist (this is the 1pm UK candle in BST, stored at its correct UTC time).
5. Deliberately create a candle with `high < close`; confirm validation rejects it and
   `import_logs.invalid` count increments.
6. Admin page loads without errors.

### Risks
- **OANDA rate limits.** Practice accounts allow ~100 req/sec. EUR_USD M5 for 2 years ≈ 29
  requests. The 200ms inter-batch delay keeps this well within limits.
- **Candle gaps.** OANDA has gaps for weekends, bank holidays, and DST rollover days. These
  are expected — do not flag them as errors. Only log gaps longer than 3 consecutive weekdays.
- **Storage.** EUR_USD M5 + M15 + H1 + H4 + D1 for 2 years across 2 instruments ≈ 400MB.
  Plan for a Supabase paid tier before importing all 5 instruments across 4 years.

### Expected Outcome
Admin page shows real candle counts per symbol and timeframe. The database has queryable,
deduplicated OHLCV data. The chart continues to work from live OANDA — no chart changes yet.

### Completion Notes (code)
**Actual file locations (see Architectural Decision 2):**
- `api/_lib/oanda-client.ts` — server-side OANDA REST client; paginates at 5,000 candles/request; calls OANDA directly (not via browser proxy)
- `api/_lib/candle-ingestion.ts` — fetch → validate (`high >= max(open,close)`) → upsert (`createMany skipDuplicates`) → log to `import_logs`
- `api/admin/ingest.ts` — `POST /api/admin/ingest`; auth via `Authorization: Bearer ADMIN_SECRET`; accepts `{ symbol, timeframe, from, to }`; allowed symbols: `EUR_USD`, `GBP_USD`; allowed timeframes: `M5`, `M15`
- `api/admin/candle-counts.ts` — `GET /api/admin/candle-counts`; returns `{ symbol, timeframe, count, earliestDate, latestDate }[]`
- `vercel.json` — `api/admin/ingest.ts` maxDuration 300s, `api/admin/candle-counts.ts` maxDuration 30s
- `.env.example` — `ADMIN_SECRET` documented

**Deployment fix confirmed:** `@vercel/node` v5 with `"type": "module"` runs native ESM without bundling. All `api/_lib/` relative imports must use explicit `.js` extensions. Fix deployed and validated.

**No admin UI built** — admin endpoints are curl-accessible. A UI can be added later if needed; it is not required for validation.

---

## Stage 4: Strategy Registry ✅ COMPLETE

### Objective
Make strategy settings a first-class, versioned, database-backed concept. Seed Crossfire v1
from the current hardcoded constants. Every downstream operation from this stage onwards
receives a `strategyVersionId`. No more magic numbers in code.

### Files Affected
```
trading-research/
  prisma/
    seed.ts                              [NEW — seeds Crossfire v1]
  src/
    lib/
      strategy-registry.ts              [NEW — getActiveVersion(), createVersion()]
    app/
      api/
        strategies/
          route.ts                      [GET: list strategies and versions]
      admin/
        strategies/
          page.tsx                      [NEW — read-only version history viewer]
```

### Database Changes
Inserts one row into `strategies` and one row into `strategy_versions`.

**Crossfire v1 settings_json:**
```json
{
  "symbol": "EUR_USD",
  "setupTimeUK": "13:00",
  "lineTimeframe": "M15",
  "entryTimeframe": "M5",
  "referenceStartTimeUK": "08:00",
  "entryMode": "candle_close_beyond_line",
  "allowWickBreak": false,
  "riskReward": 3,
  "stopLossMode": "dynamic",
  "takeProfitMode": "fixed_rr",
  "breakEvenAtR": null,
  "maxTradesPerDay": 1,
  "previousHighDefinition": "highest_high_0800_1300",
  "previousLowDefinition": "lowest_low_0800_1300",
  "tradingWindowEndUK": "16:00",
  "avoidNewsMinutesBefore": 0,
  "avoidNewsMinutesAfter": 0
}
```

### Dependencies
- Stage 2 complete (schema exists)

### Implementation Detail

**`lib/strategy-registry.ts`**:
```typescript
export async function getActiveStrategyVersion(
  strategyName: string
): Promise<StrategyVersion>

export async function createStrategyVersion(
  strategyId: string,
  settings: CrossfireSettings,
  notes: string,
  createdBy: string
): Promise<StrategyVersion>
```

`createStrategyVersion` always inserts a new row — never updates an existing one. Uses a
database transaction to atomically: set `is_active = false` on the current active version,
then insert the new version with `is_active = true`. Old versions remain permanently queryable.

**Admin strategies page** — read-only table showing all versions with their settings JSON,
created_at timestamp, and active/inactive badge.

### Validation Criteria
1. `npx prisma db seed` completes without errors.
2. Admin strategies page shows "Crossfire — v1 (active)".
3. `getActiveStrategyVersion('Crossfire')` returns the v1 row with correct settings_json.
4. Call `createStrategyVersion` with modified settings → new row with `version_number: 2`,
   v1 row now shows `is_active: false`.
5. v1 row is still readable after v2 is created. History is immutable.

### Risks
Low. Purely data seeding with no external dependencies. The only design choice is whether
`version_number` is user-provided or auto-incremented. Recommendation: auto-incremented
integer with an optional human-readable `version_name` string.

### Expected Outcome
Strategy settings are in the database. Every future backtest run links to a `strategyVersionId`.
The admin page provides visibility into version history.

### Completion Notes
No CLI seed tool needed. Implemented as idempotent admin endpoints (consistent with the rest of the admin tooling):
- `api/_lib/strategy-registry.ts` — `CrossfireSettings` type, `CROSSFIRE_V1_SETTINGS` constant, `getActiveStrategyVersion()`, `createStrategyVersion()` (transactional deactivation + insert), `ensureCrossfireV1()` (idempotent upsert)
- `api/admin/seed-strategies.ts` — `POST /api/admin/seed-strategies`: calls `ensureCrossfireV1()`, returns created/existing strategy + version
- `api/admin/strategies.ts` — `GET /api/admin/strategies`: lists all strategies with all versions
- `vercel.json` updated for both new endpoints

---

## Stage 5: Crossfire Setup Engine ✅ COMPLETE

### Objective
For every trading day in the candle database, detect the 13:00 UK setup candle, compute
the 08:00–13:00 swing high/low, calculate green and red Crossfire line parameters (slope
and intercept), and save one `crossfire_setups` row per symbol per day. Mark invalid setups
with a reason code. This is the first stage that produces persistent strategy state.

### Files Affected
```
trading-research/
  src/
    lib/
      crossfire-setup.ts                 [NEW — detectAndSaveCrossfireSetup()]
    app/
      api/
        admin/
          run-setup-detection/
            route.ts                     [POST: detect setups for a date range]
          setup-counts/
            route.ts                     [GET: setup counts per symbol]
      admin/
        setups/
          page.tsx                       [NEW — setup detection admin UI]
```

The existing in-memory chart backtest path in `strategies.ts` is not modified.
`crossfire-setup.ts` is a new, DB-backed parallel path.

### Database Changes
Populates `crossfire_setups`. No schema changes.

### Dependencies
- Stage 3 complete (M15 candles in DB for target date range)
- Stage 4 complete (`strategyVersionId` available)
- Stage 0 complete (`time.ts` imported for UK time detection)

### Implementation Detail

**`lib/crossfire-setup.ts`**:
```typescript
export async function detectAndSaveCrossfireSetup(
  symbol: string,
  dateUK: string,              // "2024-06-04"
  strategyVersionId: string
): Promise<CrossfireSetup>
```

Steps:
1. Load M15 candles for `symbol` on `dateUK` from the `candles` table (full UK calendar day).
2. Find the 13:00 UK candle: `toUKHour(candle.timestamp_utc) === 13`.
3. If not found: save setup with `setup_valid = false, invalid_reason = 'no_1300_candle'`.
4. Find highest high (HH) in candles where `toUKHour(ts) >= 8 && toUKHour(ts) < 13`.
5. Find lowest low (LL) in same window.
6. Calculate green trendline: passes through `(HH.timestamp, HH.high)` and
   `(setup_candle.timestamp, setup_candle.high)`.
   `slope = (setup.high - HH.high) / (setup.timestamp - HH.timestamp)`
7. Calculate red trendline: passes through `(LL.timestamp, LL.low)` and
   `(setup_candle.timestamp, setup_candle.low)`.
8. Upsert into `crossfire_setups` with all anchor fields, line params, `setup_valid = true`.

**Line price at any future time t:**
`linePrice(t) = slope × (t - originTimestamp) + originPrice`

**Admin setups page** — trigger detection for a date range, show count, breakdown of
`setup_valid` vs `setup_invalid` by reason code.

### Validation Criteria
1. Detect setups for EUR_USD 2024-01-01 to 2024-12-31. Valid setup count ≈ 250–260.
2. BST check: 2024-03-15 setup candle `timestamp_utc` = `2024-03-15T12:00:00Z` (not 13:00).
   This confirms the Stage 0 fix is active.
3. GMT check: 2024-12-20 setup candle `timestamp_utc` = `2024-12-20T13:00:00Z`.
4. Weekend check: 2024-06-08 (Saturday) returns `setup_valid = false,
   invalid_reason = 'no_1300_candle'`.
5. Manual verification on one known date: query the setup row and confirm green line start
   point matches the visible HH between 08:00–13:00 UK on TradingView.
6. Re-run detection for the same range — upsert produces zero new rows (idempotent).

### Risks
- **Line slope precision.** Slope in price-per-millisecond is a small float (~0.000000001 for
  EUR_USD). Postgres `FLOAT8` (double precision, 15 decimal digits) handles this correctly.
- **Multi-symbol.** Strategy v1 specifies `symbol: EUR_USD`. The setup engine accepts `symbol`
  as an explicit parameter, independent of the strategy_version settings_json, so it can run
  GBP_USD setups against the same strategy version.

### Expected Outcome
One `crossfire_setups` row per trading day per symbol, with correct line parameters. Invalid
days are recorded with a reason code. The admin page surfaces the detection stats.

---

## Stage 6: Signal Detection and Trade Simulation ✅ COMPLETE

### Objective
Walk M5 candles in the 13:00–16:00 UK trading window for each valid setup. Detect breakout
signals. Classify them. Simulate the resulting trade (entry, SL, TP, exit). Save signals
and trades to the database. This is the first stage that produces real P&L data.

### Files Affected
```
trading-research/
  src/
    lib/
      signal-detection.ts               [NEW — detectSignals()]
      trade-simulation.ts               [NEW — simulateTrade()]
      backtest-runner.ts                [NEW — runBacktest() orchestrator]
    app/
      api/
        admin/
          run-backtest/
            route.ts                    [POST: trigger backtest for date range + symbol]
      admin/
        backtest/
          page.tsx                      [NEW — backtest trigger + summary results]
```

### Database Changes
Populates `signals`, `trades`, `backtest_runs`. No schema changes.

### Dependencies
- Stage 5 complete (`crossfire_setups` populated)
- Stage 3 complete (M5 candles in DB for the trading window)

### Implementation Detail

**`lib/signal-detection.ts`**:
```typescript
export async function detectSignals(
  setupId: string,
  strategyVersionId: string
): Promise<Signal[]>
```

Steps:
1. Load setup row (line params, `setup_valid`). Return early if invalid.
2. Load M5 candles for this symbol in the 13:00–16:00 UK window on this day.
3. For each candle, compute the current line prices:
   `greenPrice = greenSlope × (candle.ts - greenOriginTs) + greenOriginPrice`
4. Detect signals:
   - Buy: `candle.close > greenPrice`
   - Sell: `candle.close < redPrice`
5. Enforce `maxTradesPerDay = 1`: only the first signal per direction per session.
6. Classify breakout type:
   - `strong_body_close`: `min(candle.open, candle.close) > linePrice`
   - `weak_body_close`: `candle.close > linePrice` but body straddles the line
   - `wick_break_only`: `candle.close <= linePrice` (flagged invalid if strategy requires close)
7. Save to `signals`.

**`lib/trade-simulation.ts`**:
```typescript
export async function simulateTrade(
  signal: Signal,
  strategyVersion: StrategyVersion,
  backtestRunId: string
): Promise<Trade>
```

Steps:
1. Entry price = signal candle close.
2. SL (dynamic mode): distance = `|entry - oppositeLinePrice(signal.ts)|`.
   Buy SL = `entry - distance`. Sell SL = `entry + distance`.
3. TP = `entry ± (distance × riskReward)`.
4. Walk forward M5 candles from entry until: TP hit, SL hit, or 16:00 UK.
5. If candle `high >= tp` (buy) → win. If `low <= sl` (buy) → loss.
   If both in same candle → SL wins (conservative convention).
6. Result: `win | loss | open`. `profit_loss_r`: `+rr` / `-1.0` / `0`.
7. Save to `trades`.

**`lib/backtest-runner.ts`** orchestrates:
1. Creates `backtest_runs` row with `status = 'running'`.
2. For each calendar date in range: calls `detectAndSaveCrossfireSetup`, then `detectSignals`,
   then `simulateTrade` for each valid signal.
3. Updates `backtest_runs` with summary stats and `status = 'completed'`.

### Validation Criteria
1. Run backtest for EUR_USD 2024-01-01 to 2024-12-31.
2. `backtest_runs` row created with `status = 'completed'`.
3. Trade count is reasonable: expect 30–120 trades across 250 trading days (max 1/day,
   many no-signal days).
4. Cross-reference: run the same range in the existing `ChartSandbox.tsx`. DB win rate should
   match within ±3% (small differences expected from the BST fix in the new path).
5. Spot-check one known trade date on TradingView. Confirm entry price, SL, TP, and result
   match the `trades` row.
6. Every `trades` row has non-null: `signal_id`, `setup_id`, `strategy_version_id`,
   `backtest_run_id`. No orphan rows.
7. Every `signals` row has a corresponding `trades` row (or explicitly null if the signal
   was invalid and not traded).

### Risks
- **Ambiguous candle.** If a single M5 candle's high and low both cross SL and TP, order is
  unknown. Convention: SL wins (conservative). Document this in code comments.
- **Open trades at session end.** Trades not hitting SL or TP by 16:00 UK are marked `open`.
  The analytics engine must exclude these from win/loss rates and expectancy calculations.
- **BST crossover days.** Very rare days where DST changes during the session window. Flag
  these in `import_logs` rather than crashing.

### Expected Outcome
Full historical backtest results in the database, linked from trade → signal → setup →
strategy_version → backtest_run. Win rate and expectancy are directly queryable from Postgres.
The existing chart backtest path is untouched.

---

## Stage 7: MFE and MAE Tracking ✅ COMPLETE

### Architecture Note (deviation from original plan)
The trading-research Next.js app was not created (Stage 1 architectural deviation — the
Forex Battle Vite/Vercel app was converted in place instead). All server-side code lives
in `api/_lib/` and all admin endpoints are consolidated in `api/admin.ts` with `?action=`
routing to stay within Vercel Hobby's 12-function limit.

### Objective
For every trade in the database, scan M5 candles from entry to exit and record:
- MFE (maximum favourable excursion) and MAE (maximum adverse excursion) in price units and R-multiples
- Which R milestones (1R, 2R, 3R) were first reached, and how long they took
- Whether moving SL to break-even after 1R would have saved a losing trade
- Time spent in trade (entry to exit in minutes)

### Schema Coverage vs User Requirements

The existing `trade_path_analysis` schema covers:

| User requirement | Schema field | Notes |
|---|---|---|
| MFE in R | `mfe_r` | ✓ |
| MAE in R | `mae_r` | ✓ |
| MFE in pips | `mfe_pips` | Stored as raw price distance (not ×10000) |
| MAE in pips | `mae_pips` | Stored as raw price distance (not ×10000) |
| Time to 1R | `time_to_1r_minutes` | ✓ |
| Time to TP (3R) | `time_to_3r_minutes` | ✓ (Crossfire v1 TP = 3R) |
| Time to SL | `time_to_exit_minutes` | ✓ for loss trades (exit = SL) |
| Time in trade | `time_to_exit_minutes` | ✓ |
| Reached 1R / 2R / 3R | `reached_1r`, `reached_2r`, `reached_3r` | ✓ |
| Break-even analysis | `break_even_would_help` | ✓ |
| Reached 4R / 5R | — | Not in schema; derive from `mfe_r >= 4.0` in analytics |
| Time to 2R | — | Not in schema; only 1R and 3R milestones stored |
| % time positive/negative | — | Not in schema; requires schema extension |

### Files Affected
```
api/
  _lib/
    trade-path-analysis.ts             [NEW — computePathAnalysis() pure function]
  admin.ts                             [UPDATED — add run-trade-analysis, trade-analysis-results]
```

### Database Changes
Populates `trade_path_analysis`. No schema changes.

### Admin Endpoints
```
POST /api/admin?action=run-trade-analysis
  Body: { backtestRunId }  OR  { symbol, from, to }
  Loads all trades in scope. Batch-loads M5 candles in one query.
  Upserts trade_path_analysis on tradeId (idempotent).

GET  /api/admin?action=trade-analysis-results[&symbol=EUR_USD]
  Returns aggregate stats: avg MFE/MAE R, milestone pcts, break-even count.
```

### Dependencies
- Stage 6 complete (`trades` table populated)
- Stage 3 complete (M5 candles available for the trade window)

### Implementation Detail

**`api/_lib/trade-path-analysis.ts`** — pure function, no DB access:
```typescript
export function computePathAnalysis(
  trade: Trade,
  tradeCandles: Candle[],  // M5, timestampUtc > entryTs and <= exitTs, ascending
): PathAnalysisResult
```

Scan logic:
1. Track `maxHigh` / `minLow` across all trade candles in a single sequential pass.
2. For buy: `mfePips = max(0, maxHigh − entry)`, `maePips = max(0, entry − minLow)`.
3. For sell: `mfePips = max(0, entry − minLow)`, `maePips = max(0, maxHigh − entry)`.
4. Running-max pass tracks when MFE first crossed 1R and 3R → `timeTo1rMinutes`, `timeTo3rMinutes`.
5. `breakEvenWouldHelp = (result === 'loss') && (mfeR >= 1.0)` — price reached 1R before SL.

Batch loading in `run-trade-analysis`:
- One query for all target trades.
- One query for M5 candles between `min(entryTs)` and `max(exitTs)`.
- Filter to each trade's window in memory (`ts > entryTs && ts <= exitTs`).
- Upsert per trade via `tradeId` unique key. No N+1 queries.

### Validation Criteria
1. Run path analysis for the 2024-01-08 to 2024-01-12 test trades (3 trades from Stage 6).
2. Every `trades` row has a linked `trade_path_analysis` row (`trade-analysis-results` count = 3).
3. Known winning trade: `reached_3r = true`, `mfe_r >= 3.0`.
4. Known losing trade: `mae_r >= 1.0` (SL was hit at 1R adverse).
5. `mfe_r` for all winning trades ≥ 3.0 (Crossfire v1 TP = 3R).
6. `break_even_would_help = true` on any losing trade whose `mfe_r >= 1.0`.

### Risks
- **Candle window boundary.** Path analysis starts from the first M5 candle AFTER the
  signal candle (`ts > entryTs`), matching the trade simulation's `postSignalCandles`.
  Including the signal candle would double-count price movement that happened before entry.
- **Open trades.** `exitTs` is set for all trades including open ones (last session candle).
  The scan uses `exitTs` as the upper bound for all trade types.
- **4R/5R in analytics (Stage 8).** These can be derived in the analytics layer from
  `mfe_r >= 4.0` — no separate boolean stored.

### Expected Outcome
Every trade has a path analysis row. The analytics engine (Stage 8) can answer: should we
use break-even? Are stops too tight? Is 1:3 R:R realistic? What % of trades reached each
milestone before stopping out?

---

## Stage 8: Analytics Engine and FTMO Simulation ⏳ IN PROGRESS

### Architecture Note (deviation from original plan)
Same as Stage 7 — all server-side code lives in `api/_lib/` (not `trading-research/src/lib/`).
Admin endpoints are consolidated in `api/admin.ts` with `?action=` routing.
No frontend analytics dashboard is built in Stage 8 (out of scope per user requirements).

### Objective
Produce clean, code-computed analytics from the trade and path-analysis database.
Save six summary types to `analytics_summaries`. Simulate FTMO challenge rules
for 8% and 10% profit targets and save results to `funded_account_tests`.

### Schema Notes

**`analytics_summaries`:** `@@unique([backtestRunId, summaryType])` — upsert on that key.
One row per (backtestRun, summaryType). Re-running `run-analytics` overwrites with fresh data.

**`funded_account_tests`:** No unique constraint — each call to `run-ftmo-evaluation` creates
new rows (audit trail). Schema fields available: `accountSize`, `riskPercent`, `rrRatio`,
`dailyLossLimit`, `maxDrawdownLimit`, `passed`, `peakBalance`, `worstDrawdown`, `dailyBreachCount`,
`failureReason`, `equityCurveJson`. Note: no `profitTarget` column; stored in `equityCurveJson` metadata.

### Files Affected
```
api/
  _lib/
    analytics.ts     [NEW — pure summary computation functions]
    ftmo.ts          [NEW — pure FTMO simulation function]
  admin.ts           [UPDATED — add run-analytics, analytics-results,
                                run-ftmo-evaluation, ftmo-results]
```

### Database Changes
Populates `analytics_summaries` and `funded_account_tests`. No schema changes.

### Admin Endpoints
```
POST /api/admin?action=run-analytics        { backtestRunId }
  Loads trades + pathAnalysis + signal.breakoutType.
  Computes 6 summary types (pure functions).
  Upserts each summary into analytics_summaries. Idempotent.

GET  /api/admin?action=analytics-results    ?backtestRunId=xxx
  Returns all analytics_summaries rows for that run.

POST /api/admin?action=run-ftmo-evaluation  { backtestRunId }
  Runs two FTMO simulations: 8% and 10% profit targets.
  Creates 2 FundedAccountTest rows (audit trail, not idempotent).

GET  /api/admin?action=ftmo-results         ?backtestRunId=xxx [OR ?symbol=EUR_USD]
  Returns FundedAccountTest rows (latest 20).
```

### Dependencies
- Stage 6 complete (`trades` populated)
- Stage 7 complete (`trade_path_analysis` populated for MFE/MAE stats)

### Summary Types

| summaryType | Key content |
|---|---|
| `overall` | totalTrades, wins, losses, winRatePct, avgR, expectancy, profitFactor, avgMfeR, avgMaeR, pctReaching1r–5r, breakEvenImprovementRate, avgTradeDurationMinutes |
| `strategy_evaluation` | winRatePct, profitFactor, expectancy, maxDrawdownR, longestLosingStreak, longestWinningStreak, avgMonthlyR, avgYearlyR, monthlyBreakdown |
| `mfe_mae_summary` | avgMfeR, avgMaeR, avgMfeRForWins, avgMaeRForLosses, pctReaching1r–5r, breakEvenWouldHelpPct, avgTimeTo1rMinutes |
| `by_day_of_week` | monday–friday: wins, losses, winRatePct, totalR |
| `by_entry_hour` | 13, 14, 15: wins, losses, winRatePct, totalR |
| `by_breakout_type` | strong_body_close / weak_body_close: wins, losses, winRatePct |

Notes on summary content:
- `open` trades excluded from win/loss counts and winRatePct. Shown separately as `opens`.
- 4R/5R reaching percentages derived from `mfeR >= 4.0` / `mfeR >= 5.0` — no separate DB field needed.
- `profitFactor = grossWinR / grossLossR` (infinite if no losses; null if no trades).
- `maxDrawdownR` computed from running equity curve in R units.

### FTMO Simulation Parameters (both scenarios)
- `accountSize`: 100,000
- `riskPercent`: 1% (fixed risk per trade, not compounding)
- `dailyLossLimit`: 5% of initial account
- `maxDrawdownLimit`: 10% of initial account (absolute from start, not trailing from peak)
- Scenario A `profitTarget`: 8%
- Scenario B `profitTarget`: 10%

`profitTarget` stored in `equityCurveJson` metadata (no dedicated schema column).

### Implementation Detail

**`api/_lib/analytics.ts`** — pure synchronous functions, no DB access:
```typescript
export interface TradeRecord { id, direction, entryTs, result, profitLossR, breakoutType, pathAnalysis }
export function computeAllSummaries(trades: TradeRecord[]): Record<SummaryType, object>
```

**`api/_lib/ftmo.ts`** — pure simulation:
```typescript
export function simulateFtmo(
  trades: { entryTs: Date, profitLossR: number | null }[],
  config:  FtmoConfig
): FtmoResult
// Fail on: absolute drawdown >= maxDrawdownLimit or daily loss >= dailyLossLimit
// Pass on: balance >= accountSize * (1 + profitTarget) with no failure
```

**Batch loading in `run-analytics`:**
One `db.trade.findMany` with `include: { pathAnalysis: true, signal: { select: { breakoutType } } }`.
All computation is synchronous in memory. Upsert 6 rows after.

### Validation Criteria
1. Run analytics for the 2024-01-08 to 2024-01-12 backtest (3 trades). Response: `{ summariesGenerated: 6 }`.
2. `analytics-results?backtestRunId=xxx` returns 6 rows (one per summaryType).
3. `overall.winRatePct` from the returned JSON matches: `(wins / decidedTrades) × 100`.
4. `mfe_mae_summary.pctReaching3r` matches `(trades with mfeR >= 3.0) / total × 100`.
5. Re-running `run-analytics` with the same `backtestRunId` returns `{ summariesGenerated: 6 }` again
   and row `createdAt` values do NOT change (upsert on update — only `summaryJson` changes).
6. `run-ftmo-evaluation` returns 2 rows with distinct `profitTarget` values (8% and 10%).

### Risks
- **`open` trades in expectancy.** These have `profitLossR = 0` but are NOT included in
  win/loss ratio calculations. They're tracked separately in the `overall.opens` field.
- **Profit factor with no losses.** Guard against division by zero — return `null`.
- **FTMO daily grouping.** Trades grouped by `toUKDateString(entryTs)`. A day with zero
  trades has no entry in the equity curve (not an error).

### Expected Outcome
Six analytics summary rows per backtest run, queryable by summaryType. Two FTMO simulation
rows showing whether the strategy's backtest period would have passed a funded challenge.
All analytics computable without modifying the trade simulation or strategy settings.

---

## Stage 9: Chart and Trade Review Integration ⏳ NOT STARTED

### Objective
Connect the chart to the database. The chart page accepts a `?backtestRunId` query parameter.
When present, it loads candles from the `candles` table and trade overlays from the `trades`
table. When absent, it falls back to the existing live OANDA fetch. `CandlestickChart.tsx`
receives zero changes.

### Files Affected
```
trading-research/
  src/
    app/
      chart/
        page.tsx                        [updated: DB candles + trade overlays when backtestRunId present]
      api/
        candles/
          route.ts                      [GET: candles from DB]
        trades/
          [backtestRunId]/
            route.ts                    [GET: trade overlays for a backtest run]
    components/
      TradeReviewSidebar.tsx            [NEW — trade detail panel]
      chart/
        CandlestickChart.tsx            [ZERO CHANGES]
```

### Database Changes
None. Read-only queries.

### Dependencies
- Stage 3 complete (candles in DB)
- Stage 6 complete (trades in DB)

### Implementation Detail

**`/api/candles?symbol=EUR_USD&timeframe=M5&from=...&to=...`**
Queries `candles` table. Returns `{ timestamp, open, high, low, close, volume }[]` — the
exact shape `CandlestickChart` already expects. Zero component changes required.

**`/api/trades/[backtestRunId]?symbol=EUR_USD`**
Returns trades shaped as `LineOverlay[]` for the chart's existing overlay system. Field
mapping done in the API route, not in the component.

**Chart page:**
- `?backtestRunId` present → load from DB, load trade overlays.
- `?backtestRunId` absent → existing live OANDA path unchanged.
- URL is fully shareable (bookmarkable link to a specific backtest review).

**TradeReviewSidebar** — right-side panel:
- Scrollable trade list for the backtest run.
- Click a trade → chart scrolls to that entry date.
- Selected trade: date, direction, entry/exit price, R result, MFE/MAE bar.
- "View on TradingView" link for manual verification.

### Validation Criteria
1. Load `/chart?backtestRunId=[2024 EUR_USD run]`. Chart shows M5 candles. Browser Network
   tab shows calls to `/api/candles`, not `/api/oanda`.
2. Trade overlays appear: buy/sell arrow, SL line, TP line, exit marker with W/L chip.
3. Click a trade in the sidebar → chart scrolls to that date.
4. Load `/chart` (no backtestRunId) → live OANDA candles load as before.
5. `git diff src/components/chart/CandlestickChart.tsx` → no changes.

### Risks
- **Candle pagination.** 6 months of M5 data = ~39,000 candles. Use cursor-based pagination
  matching the chart's existing infinite scroll-back pattern (200 candles per request as user
  scrolls left) rather than loading everything in one call.
- **LineOverlay field mapping.** Map DB fields to the existing `LineOverlay` type in the API
  route, not in the component. This keeps the component stable.

### Expected Outcome
The chart is a database-backed research tool. Any backtest run is fully reviewable visually,
trade by trade. The chart component is unchanged — only its data source changes.

---

## Stage 10: AI Research Layer ⏳ NOT STARTED

### Objective
Feed `analytics_summaries` (not raw candles) to Claude. Store every prompt, response, and
structured recommendation. Add a simple approval workflow: AI suggests, human approves,
approved suggestions create a new `strategy_version` row. AI cannot directly modify any
live strategy setting.

### Files Affected
```
trading-research/
  src/
    lib/
      ai-research.ts                   [NEW — buildAnalyticsPrompt(), parseRecommendations()]
    app/
      api/
        ai-review/
          route.ts                     [POST: trigger AI review for a backtest run]
        recommendations/
          [id]/
            approve/
              route.ts                 [POST: approve → creates new strategy_version]
            reject/
              route.ts                 [POST: reject with optional notes]
      research/
        page.tsx                       [NEW — AI research dashboard]
```

### Database Changes
Populates `ai_reviews` and `strategy_recommendations`. No schema changes.

### Dependencies
- Stage 8 complete (`analytics_summaries` populated)
- ANTHROPIC_API_KEY configured

### Implementation Detail

**`lib/ai-research.ts`**:
```typescript
export function buildAnalyticsPrompt(
  summaries: AnalyticsSummary[],
  strategyVersion: StrategyVersion
): string
```

Prompt format (target: under 2,000 tokens):
```
You are reviewing backtest results for the Crossfire trading strategy (version [n]).

Overall: [win_rate]% win rate, [n] trades, expectancy [x]R, max drawdown [x]%

Day of week:  Mon [x]% (n=[n]) | Tue [x]% | Wed [x]% | Thu [x]% | Fri [x]%
Breakout type: strong_body [x]% (n=[n]) | weak_body [x]% | wick [x]%
MFE: [x]% of all trades reach 1R before stopping. Break-even at 1R would save [x]% of losses.

Current settings: [compact settings_json]

Identify up to 5 testable filters that could improve robustness. Avoid filters with n < 30.
Return a JSON array: [{ filter, rationale, proposed_setting_change, expected_benefit, overfitting_risk }]
```

**Governance (hard-coded, never bypassed):**
- AI response is stored; never auto-applied.
- All recommendations created with `status = 'suggested'`.
- `/api/recommendations/[id]/approve` calls `createStrategyVersion()` with proposed settings,
  sets recommendation `status = 'accepted'`. Original version is unchanged.
- `/api/recommendations/[id]/reject` sets `status = 'rejected'` with notes.

**Research dashboard** shows:
- AI reviews list with expandable prompt/response.
- Recommendations table: description, status badge, proposed settings.
- Approve/Reject buttons with confirmation.
- Side-by-side diff: current settings_json vs proposed settings_json.

### Validation Criteria
1. Trigger AI review for 2024 EUR_USD backtest. `ai_reviews` row created with non-null
   `ai_response` and valid `recommendations_json` array.
2. `strategy_recommendations` rows created (expect 3–5 per review).
3. Approve one recommendation → new `strategy_versions` row with `version_number: 2` and
   the proposed settings. Original v1 row unchanged and still readable.
4. The new v2 can be passed to `runBacktest()` (Stage 6) as its `strategyVersionId`.
5. Confirm the approve route does not UPDATE any existing `strategy_versions` row.
6. Reject a recommendation → `status = 'rejected'`. Rejected recommendations are queryable
   (permanent record to avoid re-testing the same idea).

### Risks
- **Recommendation quality.** Claude may suggest filters based on very small sample sizes.
  The prompt instructs "avoid filters with n < 30" but this must also be enforced in
  `parseRecommendations()` — reject any recommendation where the underlying segment has
  fewer than 30 trades.
- **Cost.** Each review ≈ 2,000 prompt tokens + 500 response tokens. At current pricing
  this is under $0.10 per review. Manual trigger only — no automatic reviews.

### Expected Outcome
Claude reviews analytics summaries, not raw candle data. All prompts, responses, and
recommendations are permanently logged. Recommendations require explicit human approval.
The audit chain is complete: ai_review → recommendation → strategy_version → backtest_run
→ trades.

---

## Cross-Cutting Concerns

### API Response Shape
All API routes return `{ success: boolean, data?: unknown, error?: string }`. Prisma errors
are caught and logged server-side; never expose ORM error messages to the client.

### Admin Route Protection
All `/api/admin/*` routes check for `Authorization: Bearer ${ADMIN_SECRET}` header. The
research app is single-user at MVP stage — no full auth system needed.

### Partial Failure Handling
Import and backtest jobs that partially fail record `status = 'partial'` in `import_logs`
and `backtest_runs`. The error message is stored. Jobs are re-runnable (upsert-safe).

### Candle Gap Detection
After each import run, scan for unexpectedly long gaps (> 3 consecutive weekdays with no
candles). Log these to `import_logs.error_message`. Do not treat expected gaps (weekends,
bank holidays) as errors.

---

## MVP Release Scope

**Stages 0, 1, 2, 3, 4, 5, 6, and 9.**

The MVP delivers:
- Standalone `trading-research/` Next.js app, separated from Forex Battle
- BST-correct UK time handling throughout all strategy logic
- EUR_USD and GBP_USD M5 + M15 candles imported from 2022 to today
- Crossfire strategy v1 stored and versioned in the database
- Daily setup detection for the full historical range
- Signal detection and full trade simulation with P&L results
- Chart review page: DB-backed candles + trade overlays + trade review sidebar

The MVP answers: *"Does the Crossfire strategy have an edge, and what does each individual
trade look like on the chart?"*

**Not in MVP:**
- MFE/MAE tracking (Stage 7)
- Analytics slicing (Stage 8)
- DB-backed FTMO simulation (Stage 8) — the in-memory version in AiAnalysisPanel still works
- AI research layer (Stage 10)

---

## Phase 2 Enhancements

**Stages 7, 8, and 10.**

Delivers:
- MFE/MAE tracking for every trade
- Analytics engine: win rate by day, session, breakout type, ATR band, trend alignment
- DB-backed FTMO equity simulation (extracted from AiAnalysisPanel)
- AI research layer with approval workflow
- Analytics dashboard showing all slices in one page

Phase 2 answers: *"When does the strategy work? When does it fail? What conditions should be
avoided? Can it survive FTMO rules?"*

---

## Future Enhancements

Deliberately excluded to avoid scope creep. In approximate priority order:

**H1, H4, D1 candle import + higher-timeframe bias**
Extend candle ingestion to H1, H4, D1. Wire H1 trend into signal classification. Wire H4/D1
into `trade_context` for richer analytics.

**Trade context capture (`trade_context` table)**
ATR at each timeframe, trend direction, position in daily range, proximity to previous day
high/low and round numbers. Feeds the `by_atr_band` and `by_trend_alignment` analytics slices.
Requires H1, H4, D1 candles.

**Walk-forward and out-of-sample testing**
Split data into training/testing windows. Optimise on in-sample, validate on out-of-sample.
Requires only a date-range parameter added to `runBacktest()` — the engine already supports it.

**Anti-overfitting safeguards**
Minimum sample size enforcement before accepting any filter recommendation. Random start-date
testing. Worst-case starting-point analysis. Losing-streak stress tests.

**MT5 signal relay hardening**
Move `/api/signal.ts` from in-memory to database-backed. Required before any live alert mode
(signals currently lost on Vercel cold start).

**Paper trading mode**
Connect live OANDA candle stream. Detect signals in real time. Save paper trades. Compare
paper performance to backtest expectations over 30, 50, and 100 trades.

**Multi-strategy and multi-symbol support**
GBP_USD and XAU_USD strategy versions. SMC strategy port from `smcStrategy.ts`. Requires
`settings_json` schema to be flexible per strategy type.

**Full monorepo extraction**
After the trading-research app is proven, extract shared packages (`@trading/chart`,
`@trading/strategy-engine`, `@trading/analytics`, `@trading/shared-types`) into a Turborepo
workspace. This is a refactor, not a feature — do not start here.

**Demo execution**
Connect to OANDA demo account for automated order execution. Only after paper trading has been
validated over 100+ trades with a documented performance comparison.
