# Strategy Architecture V2
## A Modular Framework for Crossfire Strategy Research

**Status:** Design only — not implemented  
**Date:** 2026-06-13  
**Scope:** Database structure, versioning approach, naming conventions, migration plan

---

## 1. Problem Statement

The current architecture conflates three distinct concerns into a single `StrategyVersion.settingsJson` blob:

```json
{
  "setupTimeUK": "13:00",           ← setup geometry
  "lineTimeframe": "M15",           ← setup geometry
  "referenceStartTimeUK": "08:00",  ← setup geometry
  "entryMode": "candle_close_beyond_line",  ← signal rule
  "tradingWindowEndUK": "16:00",    ← signal rule
  "maxTradesPerDay": 1,             ← signal rule
  "stopLossMode": "dynamic",        ← trade management
  "riskReward": 3,                  ← trade management
  "breakEvenAtR": null              ← trade management
}
```

**Consequence:** To test a different signal rule (e.g., body-only breakouts instead of any-close breakouts) you must create a new `StrategyVersion` and re-run everything from scratch — including setup detection, which is identical to the previous run. There is no mechanism to share setups across signal variants, and no way to compare trade management rules against the same set of detected signals.

---

## 2. Design Principles

**The setup is the foundation.** The Crossfire setup — identifying the 13:00 UK candle, computing the 08:00–12:45 swing high/low, drawing trendlines — does not change when you change signal or trade rules. It should be computed once and reused.

**Each concern has one reason to change.**
- Setup geometry changes when you redefine what constitutes a valid price structure
- Signal rules change when you redefine what constitutes a breakout entry
- Trade management changes when you redefine how risk, SL, TP, or break-even are applied

**Immutable versions.** A module version, once created, is never edited. Changing a setting always creates a new version. The full chain from setup → signal → trade is always traceable to specific, frozen module versions.

**Additive not destructive.** All existing `StrategyVersion` rows, `BacktestRun` rows, and associated data remain intact. The V2 schema is additive — new tables run alongside the old ones.

---

## 3. The Three Module Types

### 3.1 Setup Module

Defines how setups are geometrically identified on each trading day.

**What it controls:**
- Which timeframe defines the session structure (M15)
- The setup anchor time (13:00 UK)
- The reference window start and end (08:00–12:45 UK)
- How HH and LL are identified within that window (e.g. highest high, EMA-filtered high)
- What constitutes an invalid setup (no anchor candle, no reference candles)

**What it does NOT control:**
- Symbol — this is a BacktestRun parameter, not a module setting
- Signal detection rules
- Trade management rules

**Output:** One `CrossfireSetup` row per weekday, containing the frozen trendline parameters for that day. These rows are shared by all signal modules that reference the same setup module version.

**Crossfire Setup v1 settings:**
```json
{
  "anchorTimeUK": "13:00",
  "anchorTimeframe": "M15",
  "referenceWindowStartUK": "08:00",
  "referenceWindowEndUK": "12:45",
  "hhDefinition": "highest_high_in_window",
  "llDefinition": "lowest_low_in_window",
  "lineAnchor": "extreme_candle_to_anchor_candle",
  "invalidIfNoAnchorCandle": true,
  "invalidIfNoReferenceCandles": true
}
```

---

### 3.2 Signal Module

Defines how a signal is detected from an existing setup on each day.

**What it controls:**
- Which timeframe to scan for entries (M5)
- When scanning begins, expressed as offset from the setup candle close (`scanStartOffsetMinutes: 15` — the look-ahead fix is encoded here, not just in the implementation)
- When scanning ends (tradingWindowEndUK: "16:00")
- What price action constitutes a signal (close beyond line, body-only close, wick break)
- Direction priority (buy-first, sell-first, both independently)
- Maximum signals per day (1)
- Optional filters: day-of-week, entry-hour, breakout-strength threshold

**What it does NOT control:**
- Setup geometry (reads frozen parameters from the setup row)
- SL or TP placement
- Trade management

**Output:** One `Signal` row per eligible setup, per signal module version. The `Signal` is keyed on `(signalModuleVersionId, setupId, direction)`.

**Close Breakout v1 settings (current behaviour, post look-ahead fix):**
```json
{
  "scanTimeframe": "M5",
  "scanStartOffsetMinutes": 15,
  "scanWindowEndUK": "16:00",
  "entryMode": "candle_close_beyond_line",
  "allowWickBreak": false,
  "maxSignalsPerDay": 1,
  "directionPriority": "buy_first",
  "dayOfWeekFilter": null,
  "breakoutStrengthFilter": null,
  "entryHourFilter": null
}
```

**Example variant — Body Only v1** (only `strong_body_close` qualifies):
```json
{
  "scanTimeframe": "M5",
  "scanStartOffsetMinutes": 15,
  "scanWindowEndUK": "16:00",
  "entryMode": "candle_close_beyond_line",
  "allowWickBreak": false,
  "maxSignalsPerDay": 1,
  "directionPriority": "buy_first",
  "dayOfWeekFilter": null,
  "breakoutStrengthFilter": "strong_body_close_only",
  "entryHourFilter": null
}
```

**Example variant — Day Filter v1** (excludes Tuesdays):
```json
{
  "scanTimeframe": "M5",
  "scanStartOffsetMinutes": 15,
  "scanWindowEndUK": "16:00",
  "entryMode": "candle_close_beyond_line",
  "allowWickBreak": false,
  "maxSignalsPerDay": 1,
  "directionPriority": "buy_first",
  "dayOfWeekFilter": ["monday", "wednesday", "thursday", "friday"],
  "breakoutStrengthFilter": null,
  "entryHourFilter": null
}
```

---

### 3.3 Trade Module

Defines how a trade is constructed and managed from a detected signal.

**What it controls:**
- Entry price (signal candle close vs next candle open)
- SL placement (dynamic opposite trendline at entry, fixed pips, fixed ATR multiple)
- TP placement (fixed R:R, trailing, partial close)
- Risk:reward ratio
- Break-even logic
- Which side wins when SL and TP are both breached in the same candle

**What it does NOT control:**
- When or why a signal fires
- Setup geometry

**Output:** One `Trade` row per signal, per trade module version. The same signal can have multiple trade rows under different trade modules, enabling direct comparison of trade management approaches against identical entry points.

**Dynamic SL Fixed RR 3:1 v1 settings (current behaviour):**
```json
{
  "entryPriceMode": "signal_candle_close",
  "stopLossMode": "dynamic_opposite_trendline",
  "stopLossOffsetPips": 0,
  "takeProfitMode": "fixed_rr",
  "riskReward": 3,
  "breakEvenAtR": null,
  "trailingStopAtR": null,
  "partialCloseAtR": null,
  "partialClosePercent": null,
  "slPriorityOnSimultaneousBreach": true,
  "sessionExitMode": "flat_at_session_close"
}
```

**Example variant — Dynamic SL Break-Even at 1R:**
```json
{
  "entryPriceMode": "signal_candle_close",
  "stopLossMode": "dynamic_opposite_trendline",
  "stopLossOffsetPips": 0,
  "takeProfitMode": "fixed_rr",
  "riskReward": 3,
  "breakEvenAtR": 1.0,
  "trailingStopAtR": null,
  "partialCloseAtR": null,
  "partialClosePercent": null,
  "slPriorityOnSimultaneousBreach": true,
  "sessionExitMode": "flat_at_session_close"
}
```

---

## 4. StrategyConfig — The Combination Layer

A `StrategyConfig` binds one version of each module into a named, reusable combination. This is what a `BacktestRun` references.

```
StrategyConfig
├── setupModuleVersionId      → SetupModuleVersion (which setup geometry)
├── signalModuleVersionId     → SignalModuleVersion (which signal rules)
└── tradeModuleVersionId      → TradeModuleVersion  (which trade management)
```

A `StrategyConfig` is created once and never modified. Changing any module creates a new config.

---

## 5. What Gets Reused When Each Module Changes

This is the primary efficiency gain of the modular design.

| Change | SetupDetection | SignalDetection | TradeSimulation | PathAnalysis | Analytics |
|---|---|---|---|---|---|
| New Setup Module version | Regenerate | Regenerate | Regenerate | Regenerate | Regenerate |
| New Signal Module version | **Reuse** | Regenerate | Regenerate | Regenerate | Regenerate |
| New Trade Module version | **Reuse** | **Reuse** | Regenerate | Regenerate | Regenerate |

**Practical example:** Testing 4 signal variants against the same Crossfire setups for EUR_USD 2023–2024:

1. Run setup detection once → 500 `CrossfireSetup` rows created under `crossfire-setup-v1`
2. Run Close Breakout v1 → generates signals and trades. 1 run.
3. Run Body Only v1 → reads the **same 500 setups**, generates different signals and trades. No setup re-computation.
4. Run Day Filter v1 → same again. Setup detection skipped entirely.
5. Run Hour Filter v1 → same again.

Total setup detection runs: **1**. Signal + trade runs: **4**. If setup detection takes 60 seconds, you've saved 3 minutes of compute and 3 minutes of Vercel serverless time per additional variant.

---

## 6. Proposed Database Structure

### New tables

#### `setup_modules`
| Column | Type | Notes |
|---|---|---|
| `id` | cuid PK | |
| `name` | String unique | Human label, e.g. "Crossfire Setup" |
| `slug` | String unique | Machine key, e.g. "crossfire-setup" |
| `description` | String? | |
| `created_at` | DateTime | |

#### `setup_module_versions`
| Column | Type | Notes |
|---|---|---|
| `id` | cuid PK | |
| `setup_module_id` | FK → setup_modules | |
| `version_number` | Int | Auto-incremented per module |
| `settings_json` | Json | Reference window, anchor time, HH/LL definition |
| `is_active` | Boolean | One active per module |
| `notes` | String? | |
| `created_at` | DateTime | |
| **unique** | `(setup_module_id, version_number)` | |

#### `signal_modules`
| Column | Type | Notes |
|---|---|---|
| `id` | cuid PK | |
| `name` | String unique | e.g. "Close Breakout" |
| `slug` | String unique | e.g. "close-breakout" |
| `description` | String? | |
| `created_at` | DateTime | |

#### `signal_module_versions`
| Column | Type | Notes |
|---|---|---|
| `id` | cuid PK | |
| `signal_module_id` | FK → signal_modules | |
| `version_number` | Int | |
| `settings_json` | Json | Scan window, entry mode, filters |
| `is_active` | Boolean | |
| `notes` | String? | |
| `created_at` | DateTime | |
| **unique** | `(signal_module_id, version_number)` | |

#### `trade_modules`
| Column | Type | Notes |
|---|---|---|
| `id` | cuid PK | |
| `name` | String unique | e.g. "Dynamic SL Fixed RR" |
| `slug` | String unique | e.g. "dynamic-sl-fixed-rr" |
| `description` | String? | |
| `created_at` | DateTime | |

#### `trade_module_versions`
| Column | Type | Notes |
|---|---|---|
| `id` | cuid PK | |
| `trade_module_id` | FK → trade_modules | |
| `version_number` | Int | |
| `settings_json` | Json | SL mode, TP mode, R:R, break-even |
| `is_active` | Boolean | |
| `notes` | String? | |
| `created_at` | DateTime | |
| **unique** | `(trade_module_id, version_number)` | |

#### `strategy_configs`
| Column | Type | Notes |
|---|---|---|
| `id` | cuid PK | |
| `name` | String | Human label |
| `slug` | String unique | Derived from module slugs — see Section 7 |
| `setup_module_version_id` | FK → setup_module_versions | |
| `signal_module_version_id` | FK → signal_module_versions | |
| `trade_module_version_id` | FK → trade_module_versions | |
| `is_active` | Boolean | |
| `notes` | String? | |
| `created_at` | DateTime | |

---

### Modified existing tables

The following changes are all **additive** (new nullable columns). No existing columns are removed or renamed.

#### `crossfire_setups` — add one column
| New column | Type | Notes |
|---|---|---|
| `setup_module_version_id` | String? nullable FK → setup_module_versions | Null for old rows; populated for new V2 rows |

The unique constraint changes from `(strategy_version_id, symbol, date_uk)` to `(setup_module_version_id, symbol, date_uk)` for new rows. Both constraints coexist; old rows are unaffected because the new column is nullable and not part of the old constraint.

> Implementation note: Prisma does not support two independent unique constraints on the same set of optional columns cleanly. The practical solution is: the new V2 backtest runner enforces uniqueness at the application layer when writing new rows, and the original constraint remains for V1 rows. A composite unique index on `(setup_module_version_id, symbol, date_uk)` where `setup_module_version_id IS NOT NULL` can be added via a partial index in a raw migration.

#### `signals` — add one column
| New column | Type | Notes |
|---|---|---|
| `signal_module_version_id` | String? nullable FK → signal_module_versions | Null for old rows |

The existing unique constraint `(setup_id, direction)` enforces one signal per direction per setup. In V2, this allows one signal per direction per **setup row** — but since V2 setup rows are keyed differently from V1 rows, there is no collision. If the same day needs two signals under different signal modules, the V2 runner creates two separate setup rows (one per setup module version × symbol × date), each getting their own signal rows.

#### `trades` — add one column
| New column | Type | Notes |
|---|---|---|
| `strategy_config_id` | String? nullable FK → strategy_configs | Null for V1 trades |

Existing `strategy_version_id` is kept. V1 trades have `strategy_version_id` set and `strategy_config_id` null. V2 trades have `strategy_config_id` set and `strategy_version_id` null (or set to a sentinel "v2-placeholder" if the FK is non-nullable — see migration notes).

#### `backtest_runs` — add one column
| New column | Type | Notes |
|---|---|---|
| `strategy_config_id` | String? nullable FK → strategy_configs | Null for V1 runs |

Existing `strategy_version_id` is kept. The Research Dashboard run list queries both FKs to display all runs.

#### `funded_account_tests` — add one column
| New column | Type | Notes |
|---|---|---|
| `strategy_config_id` | String? nullable FK → strategy_configs | Null for V1 tests |

---

### Unchanged tables

`Candle`, `ImportLog`, `TradePathAnalysis`, `TradeContext`, `AnalyticsSummary`, `AiReview`, `StrategyRecommendation` — no changes required. Analytics, path analysis, AI review all operate on `BacktestRun.id` or `Trade.id` and do not need to know about the module structure.

---

## 7. Naming Convention

### Module slugs (machine-readable, stored in DB)

Format: `{family}-{variant}[-v{N}]`

No version number in the slug — the version is tracked by `version_number` column. The slug identifies the module concept, not the specific version.

| Module type | Slug | Human name |
|---|---|---|
| Setup | `crossfire-setup` | Crossfire Setup |
| Signal | `close-breakout` | Close Breakout |
| Signal | `body-close-only` | Body-Only Close Breakout |
| Signal | `dow-filter` | Day-of-Week Filter Breakout |
| Signal | `early-session` | Early Session Only (13:15–14:30) |
| Trade | `dynamic-sl-fixed-rr` | Dynamic SL Fixed R:R |
| Trade | `dynamic-sl-be1r` | Dynamic SL Break-Even at 1R |
| Trade | `dynamic-sl-trailing` | Dynamic SL Trailing Stop |

### StrategyConfig slugs (machine-readable)

Format: `{setup-slug}|{signal-slug}|{trade-slug}`

The slug encodes which module is used but not which version, since the version is stored in the FK columns. Two configs using the same module family but different versions would have the same slug — this is intentional, because the slug reflects the conceptual combination. The `name` field provides the human label with version detail if needed.

| Config slug | Human name |
|---|---|
| `crossfire-setup\|close-breakout\|dynamic-sl-fixed-rr` | Crossfire / Close Breakout / Dynamic 1:3 |
| `crossfire-setup\|body-close-only\|dynamic-sl-fixed-rr` | Crossfire / Body-Only / Dynamic 1:3 |
| `crossfire-setup\|close-breakout\|dynamic-sl-be1r` | Crossfire / Close Breakout / Dynamic 1:3 + BE |
| `crossfire-setup\|dow-filter\|dynamic-sl-fixed-rr` | Crossfire / Mon-Wed-Thu-Fri / Dynamic 1:3 |

### Version notes convention (human-readable, stored in `notes` field)

Module version notes should record the specific change from the previous version:

- `v1: Initial version. Close beyond line, 13:15–16:00 UK, buy-first, max 1/day.`
- `v2: Added breakout strength filter — strong_body_close only.`
- `v3: Added day-of-week filter — excludes Tuesdays.`

### BacktestRun naming (display label in the UI)

Format: `{CONFIG_NAME} — {SYMBOL} {FROM}–{TO}`

Example: `Crossfire / Body-Only / Dynamic 1:3 — EUR_USD 2023-01-01 to 2024-12-31`

---

## 8. Reuse Logic

When a new backtest run is initiated via `StrategyConfig`, the pipeline checks at each stage whether existing data can be reused:

### Setup reuse check
```
Does CrossfireSetup exist WHERE
  setup_module_version_id = {config.setupModuleVersionId}
  AND symbol = {symbol}
  AND date_uk BETWEEN {from} AND {to}?

→ YES for all weekdays in range: skip setup detection
→ NO for some or all: run setup detection for missing dates only
```

### Signal reuse check
```
Does Signal exist (via its setup) WHERE
  setup.setup_module_version_id = {config.setupModuleVersionId}
  AND signal.signal_module_version_id = {config.signalModuleVersionId}
  AND setup.symbol = {symbol}
  AND setup.date_uk BETWEEN {from} AND {to}?

→ YES for all setups: skip signal detection
→ NO: run signal detection against existing setups
```

### Trade reuse check
```
Does Trade exist WHERE
  signal.setup.setup_module_version_id = {config.setupModuleVersionId}
  AND signal.signal_module_version_id = {config.signalModuleVersionId}
  AND trade.strategy_config_id = {strategyConfigId}
  AND trade.symbol = {symbol}?

→ YES: skip trade simulation
→ NO: run simulation against existing signals
```

Reuse is opt-in, not automatic. A "force re-run" flag bypasses all reuse checks. This is important when fixing a bug in the simulation logic — you want to regenerate even if rows already exist.

---

## 9. Migration Plan from Crossfire V1

The V1 architecture (`Strategy` → `StrategyVersion` → everything) is not deleted. It remains as the "legacy" path. The migration is purely additive.

### Phase 1 — Schema additions (no data changes)

Apply via Prisma migration:

1. Create `setup_modules` table
2. Create `setup_module_versions` table
3. Create `signal_modules` table
4. Create `signal_module_versions` table
5. Create `trade_modules` table
6. Create `trade_module_versions` table
7. Create `strategy_configs` table
8. Add `setup_module_version_id` (nullable) to `crossfire_setups`
9. Add `signal_module_version_id` (nullable) to `signals`
10. Add `strategy_config_id` (nullable) to `trades`
11. Add `strategy_config_id` (nullable) to `backtest_runs`
12. Add `strategy_config_id` (nullable) to `funded_account_tests`
13. Add partial unique index: `crossfire_setups(setup_module_version_id, symbol, date_uk)` WHERE `setup_module_version_id IS NOT NULL`
14. Add partial unique index: `signals(signal_module_version_id, setup_id, direction)` WHERE `signal_module_version_id IS NOT NULL`

All existing rows remain untouched. All new nullable columns default to null.

**Risk:** Low. Pure additions. No data is modified. No constraints are removed.

---

### Phase 2 — Seed V2 module registry

Run a one-time seed operation (idempotent, safe to re-run):

**Seed SetupModule: "Crossfire Setup"**
- slug: `crossfire-setup`
- v1 settingsJson: anchor=13:00, timeframe=M15, reference=08:00–12:45, HH=highest_high, LL=lowest_low

**Seed SignalModule: "Close Breakout"**
- slug: `close-breakout`
- v1 settingsJson: scanOffset=15min, endUK=16:00, entryMode=candle_close_beyond_line, maxPerDay=1, priority=buy_first, no filters

**Seed TradeModule: "Dynamic SL Fixed RR"**
- slug: `dynamic-sl-fixed-rr`
- v1 settingsJson: entryMode=signal_close, SL=dynamic_opposite_trendline, TP=fixed_rr, RR=3, BE=null, SLpriority=true

**Create StrategyConfig: "Crossfire / Close Breakout / Dynamic 1:3"**
- slug: `crossfire-setup|close-breakout|dynamic-sl-fixed-rr`
- links all three v1 versions

**Risk:** Zero. New rows only. Nothing read or modified from existing tables.

---

### Phase 3 — Backfill existing setups (optional)

For each existing `CrossfireSetup` row where `setup_module_version_id IS NULL`:

```sql
UPDATE crossfire_setups
SET setup_module_version_id = {crossfire_setup_v1_id}
WHERE setup_module_version_id IS NULL
  AND strategy_version_id = {crossfire_strategy_v1_id}
```

This bridges the old rows into the new module system, allowing existing setups to be reused by the new signal module pipeline without re-running setup detection.

**Risk:** Low. Only updates a nullable column to a known FK value. Reversible by setting back to null.

**Decision point:** This backfill is optional if you intend to re-run setup detection anyway (e.g., after extending the date range). It is useful only if you want to reuse existing setup rows immediately without re-running detection.

---

### Phase 4 — First V2 backtest run

After Phase 2 (and optionally Phase 3), initiate a new backtest using `strategyConfigId` instead of `strategyVersionId`. The new backtest runner:

1. Reads `StrategyConfig` to get the three module version IDs
2. Checks for existing setups under the `setup_module_version_id` → reuses if found (Phase 3 backfill), runs detection otherwise
3. Runs signal detection under `signal_module_version_id`
4. Runs trade simulation under `strategy_config_id`
5. Creates `BacktestRun` with `strategy_config_id` populated, `strategy_version_id` null (or a migration sentinel)
6. Path analysis, analytics, FTMO, and AI review all operate on `BacktestRun.id` — unchanged

**Outcome:** Both V1 and V2 backtest runs coexist. The Research Dashboard run list shows all of them.

---

### Phase 5 — V1 deprecation (not yet, future decision)

Once all active research uses V2 configs:
- Mark V1 `StrategyVersion` rows as `status: 'archived'`
- Hide V1 runs from the default dashboard view (filter by `strategyConfigId IS NOT NULL`)
- Do not delete V1 data — it remains for historical reference

**This phase is deferred until the V2 engine is validated and producing trusted results.**

---

## 10. The Setup Reuse Mechanism in Detail

The key structural question: how does the system know that a particular day's `CrossfireSetup` belongs to "Crossfire Setup v1" rather than "Crossfire Setup v2" (hypothetical future)?

**Answer:** The `setup_module_version_id` column on `CrossfireSetup`.

When the V2 setup detection runner creates a setup row, it writes `setup_module_version_id = {crossfire_setup_v1_id}`. When a signal module later queries for setups, it filters by `setup_module_version_id`:

```
SELECT * FROM crossfire_setups
WHERE setup_module_version_id = {crossfire_setup_v1_id}
  AND symbol = 'EUR_USD'
  AND date_uk BETWEEN '2023-01-01' AND '2024-12-31'
  AND setup_valid = true
```

This returns exactly the setups generated by that specific setup module version. A different setup module (hypothetical: "Crossfire Setup v2 — uses ATR-filtered HH/LL") would write `setup_module_version_id = {crossfire_setup_v2_id}`, producing different rows for the same dates, and its signal module would query against those different rows.

The two sets of setup rows coexist in the `crossfire_setups` table without conflict because the partial unique index is `(setup_module_version_id, symbol, date_uk)` — one row per module version per day per symbol.

---

## 11. Worked Example: Testing Three Signal Variants

**Goal:** Compare three signal approaches on EUR_USD, 2023–2024, using identical Crossfire setups.

### Step 1 — Create module versions
- `crossfire-setup v1` (already seeded)
- `close-breakout v1` (already seeded)
- `body-close-only v1` (new: same as close-breakout but `breakoutStrengthFilter: "strong_body_close_only"`)
- `dow-filter v1` (new: same as close-breakout but `dayOfWeekFilter: ["monday","wednesday","thursday","friday"]`)
- `dynamic-sl-fixed-rr v1` (already seeded)

### Step 2 — Create StrategyConfigs
| Config slug | Setup | Signal | Trade |
|---|---|---|---|
| `crossfire-setup\|close-breakout\|dynamic-sl-fixed-rr` | v1 | close-breakout v1 | v1 |
| `crossfire-setup\|body-close-only\|dynamic-sl-fixed-rr` | v1 | body-close-only v1 | v1 |
| `crossfire-setup\|dow-filter\|dynamic-sl-fixed-rr` | v1 | dow-filter v1 | v1 |

### Step 3 — Run backtests
1. Run Config A: setup detection runs (≈500 setups written). Signal + trade detection runs.
2. Run Config B: **setup detection skipped** (reuses the 500 rows from Step 1). Signal detection runs (only strong_body_close signals). Trade simulation runs.
3. Run Config C: **setup detection skipped again**. Signal detection runs (Mon/Wed/Thu/Fri only). Trade simulation runs.

### Step 4 — Compare in the dashboard
Three `BacktestRun` rows are shown for the same date range and symbol. Analytics for each are computed from their respective trades. The Overview tab shows the `StrategyConfig` name, making the comparison clear.

### What the comparison tells you
- Config A vs Config B: is restricting to strong body closes worth the reduction in trade count?
- Config A vs Config C: is excluding Tuesdays worth the reduction in trade count?
- All three share path analysis fields (MFE/MAE), allowing "would break-even have helped?" to be compared across the same market conditions with different entry filters.

---

## 12. Constraints and Tradeoffs

**The `Signal` unique key tension.** Currently `signals` has `@@unique([setupId, direction])` — one signal per direction per setup. In V2, the same setup row (same `setupId`) could theoretically be evaluated by two different signal modules. If both modules detect a buy signal on the same setup, they would conflict on the current unique key.

**Resolution:** In V2, signals generated by different signal modules reference **different setup rows** (because V1 and V2 setups are stored in separate rows keyed by `setup_module_version_id`). A V1 setup row and a V2 setup row for the same day are different rows with different PKs. Therefore, their associated signals never conflict on `(setupId, direction)`.

The `(signal_module_version_id, setup_id, direction)` partial unique index is a belt-and-suspenders guard for the case where two signal modules are evaluated against the same setup row — which only happens if signals are explicitly evaluated using the same setup version, in which case one module's output should overwrite the other's. This is the intended UPSERT behaviour.

**Setup row proliferation.** If you have 5 setup module versions × 2 symbols × 500 weekdays, that is 5,000 setup rows. This is not a concern at current scale (table size: ~500KB) but should be noted for future planning.

**StrategyConfig immutability.** Once a `StrategyConfig` is created and used by a `BacktestRun`, it should never be modified. The module version FKs are fixed. If you want to change any module, create a new `StrategyConfig` pointing to the new module version.

**The V1 `Trade.strategyVersionId` problem.** The current `Trade` schema has `strategy_version_id` as a non-nullable FK. V2 trades do not have a `strategyVersionId` — they have a `strategyConfigId`. Options:
- Make `strategy_version_id` nullable in the migration (cleaner, requires migration)
- Create a sentinel `StrategyVersion` row labelled "V2 Trades" as a placeholder FK (avoids the nullable migration but adds noise)
The recommendation is to make `strategy_version_id` nullable in Phase 1, accepting the migration.

---

## 13. Summary

| Concept | V1 | V2 |
|---|---|---|
| Strategy unit | `StrategyVersion` (monolithic JSON) | `StrategyConfig` (three linked module versions) |
| Setup ownership | `strategyVersionId` on `CrossfireSetup` | `setupModuleVersionId` on `CrossfireSetup` |
| Setup reuse | None — re-run per version | Yes — reused across all signal/trade variants |
| Signal ownership | FK to setup only | FK to setup + `signalModuleVersionId` |
| Trade ownership | `strategyVersionId` | `strategyConfigId` |
| Backtest reference | `strategyVersionId` | `strategyConfigId` |
| Testing a new signal rule | Full re-run from scratch | Setup reused; only signal+trade re-run |
| Testing a new trade rule | Full re-run from scratch | Setup + signal reused; only trade re-run |
| Historical data preserved | Yes | Yes (additive schema) |

The V2 architecture enables the research workflow described in the forward plan: fix the setup once, test many signal variants, pick the best, then test trade management variants against that signal.
