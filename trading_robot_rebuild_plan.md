# Trading Robot Rebuild Plan

## Purpose

This document is the ground-up build plan for separating the trading robot, strategy engine, data storage, backtesting, AI analysis and visual charting system from the existing Forex Battle game setup.

The goal is not to build an AI that randomly changes settings after every trade. The goal is to build a proper data-led trading research system where:

1. Market candle data is stored cleanly.
2. Strategy rules are stored and versioned.
3. Every setup, signal and trade is recorded.
4. Backtests are calculated by code, not guessed by AI.
5. Clean analytics are generated automatically.
6. AI reviews the clean results and suggests improvements.
7. The user can visually inspect trades on a TradingView-style chart.
8. Any changes to live strategy settings must be approved, tested and versioned.

The system should treat AI as a research analyst, not as the final decision-maker.

---

# 1. Core Design Principle

## The correct architecture

```text
Oanda Market Data
        ↓
Raw Candle Database
        ↓
Strategy Engine
        ↓
Backtest Engine
        ↓
Trade Result Database
        ↓
Analytics Engine
        ↓
AI Research Layer
        ↓
Human Review
        ↓
Approved Strategy Version
        ↓
Live/Paper Trading Robot
```

## What should not happen

The AI should not directly alter live strategy settings every time it sees a losing trade.

Bad approach:

```text
Trade loses
   ↓
AI changes settings
   ↓
Next trade uses untested settings
```

Correct approach:

```text
Trade loses
   ↓
Data is stored
   ↓
Analytics update
   ↓
AI reviews a batch of trades
   ↓
AI suggests a hypothesis
   ↓
Backtest engine tests it
   ↓
Human approves or rejects
```

---

# 2. Project Separation

## Current issue

The trading analysis tool is currently bolted onto the Forex Battle game. This creates confusion between:

- A trading education/game concept
- A real trading research platform
- A future automated trading robot

These should be split.

## Required structure

Create a separate app/module for the trading robot research system.

Suggested monorepo structure:

```text
/apps
  /forex-battle
  /trading-research
  /trading-admin

/packages
  /market-data
  /strategy-engine
  /backtest-engine
  /analytics-engine
  /ai-research
  /charting
  /shared-types
```

## Action checklist

- [ ] Identify current Forex Battle files used by the trading chart.
- [ ] Identify reusable chart components.
- [ ] Identify strategy/backtest logic currently mixed into the game.
- [ ] Create a new `trading-research` app.
- [ ] Move reusable charting code into `/packages/charting`.
- [ ] Move strategy logic into `/packages/strategy-engine`.
- [ ] Remove all direct dependency on Forex Battle game state.
- [ ] Keep Forex Battle separate as a game/product.
- [ ] Keep Trading Research separate as the serious trading robot platform.

---

# 3. Data Source

## Current data source

Oanda API is currently providing candle-by-candle data and appears to match TradingView visually.

This is a good starting point.

## Data ingestion requirements

The system must not rely only on chart-loaded data. Data must be saved into a database so it can be analysed, replayed and backtested consistently.

## Instruments to support first

Start small.

Recommended first instruments:

```text
EUR/USD
GBP/USD
XAU/USD
```

Do not start with every pair. Prove the system on a small group first.

## Action checklist

- [ ] Confirm Oanda instrument names.
- [ ] Confirm Oanda candle fields returned.
- [ ] Confirm bid/ask/mid candle availability.
- [ ] Confirm spread data availability.
- [ ] Confirm timezone handling.
- [ ] Confirm historical candle depth.
- [ ] Build candle import worker.
- [ ] Store imported data in database.
- [ ] Add duplicate protection.
- [ ] Add missing candle detection.
- [ ] Add candle quality validation.

---

# 4. Timeframes to Store

## Minimum required timeframes

For the Crossfire strategy, store these first:

```text
M5
M15
H1
H4
D1
```

## Why each timeframe is needed

### M5
Used for:

- Entry trigger
- Breakout confirmation
- Candle close beyond line
- Wick/body analysis
- Stop/TP progression
- MFE/MAE tracking

### M15
Used for:

- Crossfire line drawing
- 13:00 UK setup candle
- Previous high/low reference points
- Setup structure

### H1
Used for:

- Intraday trend context
- London session context
- New York crossover context
- Whether price is trending or ranging

### H4
Used for:

- Higher timeframe bias
- Major structure
- Broader trend direction
- Avoiding trades against strong macro intraday momentum

### D1
Used for:

- Previous day high/low
- Daily range
- Daily bias
- Whether price is near major levels
- ATR and volatility regime

## Optional later timeframes

```text
M1
M30
W1
```

### M1
Useful later for precise execution, spread/slippage analysis and realistic live trade simulation.

Do not add M1 until the core system works, as it massively increases data volume.

### M30
Useful as an intermediate timeframe, but not essential at the start.

### W1
Useful for long-term market regime analysis, but not needed for the first build.

## Action checklist

- [ ] Store M5 candles.
- [ ] Store M15 candles.
- [ ] Store H1 candles.
- [ ] Store H4 candles.
- [ ] Store D1 candles.
- [ ] Do not start with M1 unless needed.
- [ ] Ensure all candles are timestamped consistently.
- [ ] Store both UTC time and UK-local derived time.

---

# 5. Raw Candle Database

## Database choice

Recommended options:

### Best practical option

```text
Postgres via Supabase or Neon
```

This gives:

- Reliable relational data
- Good querying
- Easy dashboard/admin access
- API support
- Works well with Vercel

## Main candle table

Table name:

```text
candles
```

Fields:

```text
id
symbol
timeframe
timestamp_utc
timestamp_uk
open
high
low
close
volume
tick_volume
spread
source
created_at
updated_at
```

## Important candle-derived fields

These can either be stored directly or calculated into a derived table:

```text
body_size
upper_wick_size
lower_wick_size
full_range
body_percentage
upper_wick_percentage
lower_wick_percentage
is_bullish
is_bearish
is_doji
```

## Candle validation rules

For every candle:

- High must be greater than or equal to open, close and low.
- Low must be less than or equal to open, close and high.
- Timestamp must match the timeframe interval.
- Duplicate candles must not be inserted.
- Missing candles should be logged.

## Unique key

Use a unique index:

```text
symbol + timeframe + timestamp_utc
```

## Action checklist

- [ ] Create `candles` table.
- [ ] Add unique index on `symbol`, `timeframe`, `timestamp_utc`.
- [ ] Store Oanda candle data.
- [ ] Store timestamp in UTC.
- [ ] Store UK-local derived timestamp.
- [ ] Add candle validation.
- [ ] Add missing candle detection.
- [ ] Add import logs.
- [ ] Add re-sync function for a date range.

---

# 6. Market Session Data

Because the Crossfire strategy is time-based, session data is critical.

## Required session fields

For each candle and trade, derive:

```text
uk_time
utc_time
session_name
is_london_session
is_new_york_session
is_london_new_york_overlap
is_asian_session
is_pre_london
is_post_new_york
day_of_week
month
quarter
is_monday
is_friday
is_bank_holiday
is_major_news_window
```

## Key session times

Store times relative to UK time:

```text
08:00 London open reference
13:00 Crossfire setup time
13:00-16:00 London/New York overlap focus
```

Be careful with daylight saving time.

## Action checklist

- [ ] Build timezone conversion utility.
- [ ] Correctly handle UK BST/GMT shifts.
- [ ] Store session classification for every candle or calculate it reliably.
- [ ] Add day-of-week analysis.
- [ ] Add session overlap flags.
- [ ] Add news calendar integration later.

---

# 7. Strategy Registry

## Purpose

Every strategy must be stored as a versioned object. This avoids the issue where settings change but nobody knows which settings produced which results.

## Table name

```text
strategies
```

## Fields

```text
id
name
description
status
created_at
updated_at
```

Example strategy:

```text
Crossfire Strategy
```

## Strategy version table

Table name:

```text
strategy_versions
```

Fields:

```text
id
strategy_id
version_name
version_number
settings_json
notes
created_at
created_by
is_active
is_live_approved
```

## Example settings JSON

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
  "stopLossMode": "structure",
  "takeProfitMode": "fixed_rr",
  "breakEvenAtR": null,
  "maxTradesPerDay": 1,
  "avoidNewsMinutesBefore": 30,
  "avoidNewsMinutesAfter": 30
}
```

## Action checklist

- [ ] Create `strategies` table.
- [ ] Create `strategy_versions` table.
- [ ] Store every settings change as a new version.
- [ ] Never overwrite old settings.
- [ ] Link every backtest to a strategy version.
- [ ] Link every trade to a strategy version.

---

# 8. Crossfire Strategy Definition

## Current understanding

The Crossfire strategy works by:

1. Looking at the 15-minute chart.
2. Using the 13:00 UK candle as the setup reference.
3. Drawing one line from the top wick to the previous relevant high.
4. Drawing one line from the bottom wick to the previous relevant low.
5. Creating a cross-style structure.
6. Looking for price to break above or below one of the lines.
7. Entering on the 5-minute chart.
8. Buying above the green line.
9. Selling below the red line.

## Critical rule definitions needed

These must be made exact before the strategy can be automated properly.

### Previous high definition

The system needs a clear rule for selecting the previous high.

Possible definitions:

```text
Highest high between 08:00 and 13:00 UK
Most recent swing high before 13:00
Highest high from previous X candles
Last confirmed fractal high
Manual marked high
```

This must not be vague.

### Previous low definition

Possible definitions:

```text
Lowest low between 08:00 and 13:00 UK
Most recent swing low before 13:00
Lowest low from previous X candles
Last confirmed fractal low
Manual marked low
```

### Breakout definition

Possible definitions:

```text
Wick breaks line
Candle closes beyond line
Candle body closes beyond line
Break plus retest
Break by minimum pip distance
Break by ATR percentage
```

### Entry definition

Possible definitions:

```text
Enter at M5 candle close
Enter on next candle open
Enter immediately when price crosses line
Enter after retest
Enter with limit order
```

### Stop loss definition

Possible definitions:

```text
Fixed pips
Opposite side of breakout candle
Recent swing high/low
ATR-based
Structure-based
```

### Take profit definition

Possible definitions:

```text
Fixed 1:3 RR
Previous session high/low
Daily high/low
Structure-based target
Trailing exit
Partial close then runner
```

## Action checklist

- [ ] Convert every vague Crossfire rule into an exact coded rule.
- [ ] Define previous high logic.
- [ ] Define previous low logic.
- [ ] Define green line calculation.
- [ ] Define red line calculation.
- [ ] Define breakout condition.
- [ ] Define entry condition.
- [ ] Define stop loss condition.
- [ ] Define take profit condition.
- [ ] Define invalidation rules.
- [ ] Define maximum trades per day.
- [ ] Define whether both long and short can trigger on the same day.
- [ ] Define whether first signal only is used.
- [ ] Define what happens after one loss.
- [ ] Define whether strategy stops after one win.

---

# 9. Crossfire Setup Storage

## Purpose

Every day, for every symbol, the system should save the Crossfire setup even if no trade triggers.

This is important because no-trade days are also data.

## Table name

```text
crossfire_setups
```

## Fields

```text
id
strategy_version_id
symbol
date_uk
setup_time_uk
setup_candle_id
reference_start_time_uk
previous_high_candle_id
previous_high_price
previous_high_time_uk
previous_low_candle_id
previous_low_price
previous_low_time_uk
green_line_slope
green_line_intercept
red_line_slope
red_line_intercept
setup_valid
invalid_reason
created_at
```

## Why store line slope and intercept?

Because the line is not just a price. It changes over time.

To know whether price crossed the line at 13:35, the system needs to calculate the line price at 13:35.

## Action checklist

- [ ] Create `crossfire_setups` table.
- [ ] Store one setup per symbol per day per strategy version.
- [ ] Store reference candle IDs.
- [ ] Store high/low anchor candle IDs.
- [ ] Store line formula values.
- [ ] Store whether setup was valid.
- [ ] Store why setup was invalid.
- [ ] Show setup lines visually on chart.

---

# 10. Signal Detection

## Purpose

A signal is not the same as a trade.

A signal is when the market meets the strategy conditions.

A trade is when the system chooses to act on that signal.

## Table name

```text
signals
```

## Fields

```text
id
setup_id
strategy_version_id
symbol
direction
signal_time_utc
signal_time_uk
signal_candle_id
line_crossed
green_or_red_line
line_price_at_signal
candle_open
candle_high
candle_low
candle_close
breakout_type
breakout_distance_pips
breakout_distance_atr
body_size
upper_wick_size
lower_wick_size
candle_range
spread_at_signal
signal_valid
invalid_reason
created_at
```

## Signal classifications

Examples:

```text
wick_break_only
close_beyond_line
strong_body_close
weak_body_close
break_and_retest
fakeout
```

## Action checklist

- [ ] Create `signals` table.
- [ ] Detect all possible signals.
- [ ] Mark valid and invalid signals separately.
- [ ] Store reason for invalid signals.
- [ ] Track wick break versus close break.
- [ ] Track strength of breakout candle.
- [ ] Track distance beyond line.

---

# 11. Trade Execution Simulation

## Purpose

The backtest engine must simulate how trades would have played out based on fixed rules.

## Table name

```text
trades
```

## Fields

```text
id
signal_id
setup_id
strategy_version_id
symbol
direction
entry_time_utc
entry_time_uk
entry_price
stop_loss_price
take_profit_price
risk_pips
reward_pips
risk_reward_ratio
position_size
risk_percent
result
exit_time_utc
exit_time_uk
exit_price
profit_loss_r
profit_loss_amount
exit_reason
created_at
```

## Result values

```text
win
loss
break_even
partial_win
partial_loss
no_fill
expired
manual_exit
```

## Exit reason values

```text
take_profit_hit
stop_loss_hit
break_even_hit
session_close
opposite_signal
max_trade_duration
manual_rule
```

## Action checklist

- [ ] Create `trades` table.
- [ ] Simulate entries from signals.
- [ ] Simulate stop loss.
- [ ] Simulate take profit.
- [ ] Account for spread.
- [ ] Account for realistic entry price.
- [ ] Account for bid/ask difference if available.
- [ ] Store result in R-multiple.
- [ ] Store exact exit reason.
- [ ] Link every trade to candle data.

---

# 12. MFE and MAE Tracking

## Purpose

This is one of the most important parts of the system.

MFE = Maximum Favourable Excursion.

MAE = Maximum Adverse Excursion.

In plain English:

```text
How far did price go in your favour?
How far did price go against you?
```

This helps answer:

- Should you move stop to break even?
- Should you take partials?
- Is 1:3 too ambitious?
- Are stops too tight?
- Are entries too early?

## Table name

```text
trade_path_analysis
```

## Fields

```text
id
trade_id
max_favourable_price
max_adverse_price
max_favourable_r
max_adverse_r
reached_0_5r
reached_1r
reached_1_5r
reached_2r
reached_2_5r
reached_3r
reached_4r
returned_to_entry_after_1r
returned_to_entry_after_2r
would_be_have_helped
would_trailing_stop_have_helped
time_to_1r_minutes
time_to_2r_minutes
time_to_3r_minutes
time_to_exit_minutes
created_at
```

## Action checklist

- [ ] Create `trade_path_analysis` table.
- [ ] For every trade, scan candles after entry.
- [ ] Record maximum favourable movement.
- [ ] Record maximum adverse movement.
- [ ] Record whether 1R, 2R, 3R were reached.
- [ ] Record whether break-even would have saved a loss.
- [ ] Record whether break-even would have killed a winner.
- [ ] Record time to target/stop.
- [ ] Build analytics for stop and TP quality.

---

# 13. Context Before Trade

## Purpose

A trade outcome is not enough. The system needs to know the market condition before the trade.

## Table name

```text
trade_context
```

## Fields

```text
id
trade_id
symbol
date_uk
trend_m15
trend_h1
trend_h4
daily_bias
range_08_to_13_pips
range_08_to_13_atr
price_position_in_daily_range
price_position_in_session_range
atr_m5
atr_m15
atr_h1
previous_day_high
previous_day_low
current_day_high_at_entry
current_day_low_at_entry
near_previous_day_high
near_previous_day_low
near_round_number
market_condition
volatility_condition
created_at
```

## Market condition values

```text
trending_up
trending_down
ranging
compressed
volatile
choppy
post_large_move
pre_news
post_news
```

## Action checklist

- [ ] Create `trade_context` table.
- [ ] Calculate ATR values.
- [ ] Calculate trend direction per timeframe.
- [ ] Calculate 08:00-13:00 range.
- [ ] Calculate position in daily range.
- [ ] Calculate distance to previous day high/low.
- [ ] Classify market condition.
- [ ] Store all context at time of entry.

---

# 14. FTMO / Funded Account Simulation

## Purpose

The system should not only show whether a strategy is profitable. It should show whether it survives funded account rules.

## Table name

```text
funded_account_tests
```

## Fields

```text
id
strategy_version_id
backtest_run_id
account_size
profit_target_percent
max_daily_loss_percent
max_total_loss_percent
risk_per_trade_percent
start_balance
end_balance
peak_balance
lowest_balance
passed
failed
failure_reason
trades_to_pass
days_to_pass
max_drawdown_percent
max_daily_drawdown_percent
created_at
```

## FTMO-style checks

Track:

```text
Starting balance
Equity curve
Daily loss limit
Maximum total loss
Profit target
Minimum trading days if applicable
Pass/fail date
Failure date
```

## Action checklist

- [ ] Create `funded_account_tests` table.
- [ ] Add FTMO preset settings.
- [ ] Add custom funded account presets.
- [ ] Calculate daily drawdown.
- [ ] Calculate total drawdown.
- [ ] Calculate pass/fail.
- [ ] Show whether account would blow.
- [ ] Show number of trades to pass.
- [ ] Show number of days to pass.
- [ ] Show worst starting point analysis.

---

# 15. Backtest Runs

## Purpose

Every backtest must be saved and repeatable.

## Table name

```text
backtest_runs
```

## Fields

```text
id
strategy_version_id
symbol
start_date
end_date
timeframes_used
initial_balance
risk_per_trade
spread_mode
commission_mode
slippage_mode
settings_snapshot_json
status
started_at
completed_at
created_by
notes
```

## Important rule

A backtest result is meaningless unless the exact settings are saved.

Never allow a backtest without a settings snapshot.

## Action checklist

- [ ] Create `backtest_runs` table.
- [ ] Store exact strategy settings.
- [ ] Store date range.
- [ ] Store symbol.
- [ ] Store assumptions.
- [ ] Store backtest result summary.
- [ ] Link all trades to backtest run.

---

# 16. Analytics Engine

## Purpose

The analytics engine turns thousands of raw trades into useful summaries.

This should be code-driven, not AI-driven.

## Table name

```text
analytics_summaries
```

## Fields

```text
id
backtest_run_id
strategy_version_id
summary_type
summary_json
created_at
```

## Required analytics

### Overall performance

```text
total_trades
wins
losses
break_evens
win_rate
average_r
profit_factor
expectancy
max_drawdown
longest_losing_streak
longest_winning_streak
average_trade_duration
```

### By symbol

```text
EUR/USD win rate
GBP/USD win rate
XAU/USD win rate
```

### By day of week

```text
Monday
Tuesday
Wednesday
Thursday
Friday
```

### By session/time

```text
13:00-13:30
13:30-14:00
14:00-15:00
15:00-16:00
```

### By breakout type

```text
wick break only
candle close beyond line
strong body close
weak body close
break and retest
```

### By volatility

```text
low ATR
normal ATR
high ATR
```

### By pre-trade range

```text
small 08:00-13:00 range
medium 08:00-13:00 range
large 08:00-13:00 range
```

### By trend alignment

```text
with H1 trend
against H1 trend
with H4 trend
against H4 trend
```

### By distance from major levels

```text
near previous day high
near previous day low
middle of daily range
near round number
```

## Action checklist

- [ ] Build analytics generator.
- [ ] Generate overall stats.
- [ ] Generate symbol stats.
- [ ] Generate day-of-week stats.
- [ ] Generate session stats.
- [ ] Generate breakout-type stats.
- [ ] Generate volatility stats.
- [ ] Generate trend-alignment stats.
- [ ] Generate funded-account stats.
- [ ] Save analytics summaries.
- [ ] Display analytics in dashboard.

---

# 17. AI Research Layer

## Purpose

AI should analyse the clean summaries, not the full raw candle database.

## Table name

```text
ai_reviews
```

## Fields

```text
id
backtest_run_id
strategy_version_id
review_type
input_summary_json
ai_model
ai_prompt
ai_response
recommendations_json
confidence_score
created_at
```

## What AI should analyse

Ask AI to answer things like:

```text
What do losing trades have in common?
What do winning trades have in common?
Which filter would likely reduce losing streaks?
Which filter improves results without killing too many trades?
Is 1:3 realistic for this strategy?
Would break-even at 1R help or hurt?
Which symbol performs best?
Which day of week performs worst?
Which market condition should be avoided?
```

## What AI should not do automatically

AI should not:

- Directly edit live strategy settings.
- Directly place trades.
- Optimise endlessly until it curve-fits the past.
- Use one small sample and declare a rule.
- Change the system after every trade.

## Action checklist

- [ ] Create `ai_reviews` table.
- [ ] Feed AI analytics summaries, not raw candles.
- [ ] Store every prompt and response.
- [ ] Store recommendation JSON.
- [ ] Add confidence score.
- [ ] Add human approval status later.
- [ ] Prevent AI from changing live strategy directly.

---

# 18. Recommendation System

## Purpose

AI recommendations should become testable hypotheses.

## Table name

```text
strategy_recommendations
```

## Fields

```text
id
ai_review_id
strategy_version_id
recommendation_type
description
proposed_settings_json
reasoning
expected_benefit
risk
status
created_at
approved_at
rejected_at
```

## Status values

```text
suggested
backtesting
accepted
rejected
archived
```

## Example recommendation

```text
Avoid trades where the 08:00-13:00 range is greater than 80% of the daily ATR.
```

## Action checklist

- [ ] Create recommendation table.
- [ ] Turn AI observations into testable filters.
- [ ] Backtest each recommendation.
- [ ] Compare against original version.
- [ ] Only accept recommendations that improve robustness.
- [ ] Store rejected ideas to avoid retesting the same poor idea repeatedly.

---

# 19. Anti-Overfitting Rules

## This is critical

The system must not simply find the best settings for historical data.

## Required protections

### In-sample and out-of-sample testing

Split data:

```text
Training period: Used for optimisation
Testing period: Used to prove robustness
```

Example:

```text
2022-2024 = in-sample
2025 = out-of-sample
2026 = forward test/live paper test
```

### Walk-forward testing

Test settings across rolling windows.

Example:

```text
Optimise on 6 months
Test on next 1 month
Move forward
Repeat
```

### Robustness over profit

Prefer a strategy that works reasonably well across many periods over one that works perfectly in one period.

## Action checklist

- [ ] Add in-sample/out-of-sample split.
- [ ] Add walk-forward testing.
- [ ] Add random start date testing.
- [ ] Add worst-start analysis.
- [ ] Add losing-streak stress test.
- [ ] Reject settings that only work on one small window.
- [ ] Reject rules based on too few trades.
- [ ] Require minimum sample size before accepting a filter.

---

# 20. Visual Charting System

## Purpose

The user needs to see trades visually. Data alone is not enough.

The custom TradingView-style chart should remain, but it should become a visual layer over the database/backtest engine.

## Chart should display

```text
Candles
Crossfire lines
13:00 setup candle
Previous high anchor
Previous low anchor
Entry point
Stop loss
Take profit
Exit point
Trade path
Win/loss result
MFE/MAE levels
FTMO equity impact
AI notes
```

## Chart modes

### Mode 1: Replay mode

Step through candles from 08:00 onwards.

### Mode 2: Backtest review mode

Click through trades one by one.

### Mode 3: Losing streak review

Show all trades in the worst losing streak.

### Mode 4: AI insight mode

Show trades matching a selected AI observation.

Example:

```text
Show all losing trades where price only wicked beyond the line.
```

## Action checklist

- [ ] Keep the custom chart.
- [ ] Connect chart to stored candle data.
- [ ] Draw Crossfire setup lines from database.
- [ ] Plot entries and exits from trade database.
- [ ] Add trade review sidebar.
- [ ] Add AI notes panel.
- [ ] Add filter controls.
- [ ] Add replay mode later.

---

# 21. Dashboard Pages

## Required pages

### 1. Strategy Dashboard

Shows:

```text
Strategies
Versions
Active settings
Latest backtests
Latest AI recommendations
```

### 2. Backtest Dashboard

Shows:

```text
Backtest runs
Date ranges
Symbols
Win rate
Profit factor
Drawdown
FTMO pass/fail
```

### 3. Trade Explorer

Shows:

```text
All trades
Filters
Result
Symbol
Day
Session
Setup type
```

### 4. Chart Review

Shows selected trades visually.

### 5. AI Research

Shows:

```text
AI reviews
Recommendations
Accepted/rejected ideas
Hypotheses being tested
```

### 6. Funded Account Simulator

Shows:

```text
FTMO-style performance
Account equity curve
Daily loss breaches
Total drawdown
Pass/fail outcome
```

## Action checklist

- [ ] Build strategy dashboard.
- [ ] Build backtest dashboard.
- [ ] Build trade explorer.
- [ ] Build chart review page.
- [ ] Build AI research page.
- [ ] Build funded account simulator page.

---

# 22. Live Trading Robot Roadmap

## Important

Do not start with live trading.

Build in this order:

```text
Historical data
Backtesting
Analytics
AI research
Paper trading
Small live testing
Funded account testing
```

## Live bot stages

### Stage 1: Historical backtest

No live data.

### Stage 2: Paper trading

Uses live candles but no real trades.

### Stage 3: Alert-only mode

System says what it would do, but user manually confirms.

### Stage 4: Demo execution

Connect to demo Oanda account.

### Stage 5: Small live account

Tiny risk only.

### Stage 6: Funded account mode

Only after extensive proof.

## Action checklist

- [ ] Do not connect live execution yet.
- [ ] Build paper mode first.
- [ ] Log live signals without trading.
- [ ] Compare live signals to backtest assumptions.
- [ ] Add slippage/spread reality checks.
- [ ] Only then consider demo execution.

---

# 23. Compute and AI Cost Control

## Principle

Use code for heavy calculations. Use AI for summaries and reasoning.

## Do not send AI

```text
Millions of candles
Full raw backtest database
Every file in the project repeatedly
```

## Send AI

```text
Clean performance summaries
Grouped analytics
Top losing trade examples
Specific hypotheses
Selected trade samples
```

## Example AI input

```text
Here are 500 Crossfire trades summarised by breakout type, day of week, ATR band and result. Identify the most likely causes of poor performance and suggest no more than 5 testable filters.
```

## Action checklist

- [ ] Build analytics summaries before AI analysis.
- [ ] Limit AI input size.
- [ ] Store AI prompts.
- [ ] Store AI responses.
- [ ] Use AI weekly or per backtest run, not after every trade.
- [ ] Add manual trigger for expensive AI reviews.
- [ ] Add usage/budget warning if using API.

---

# 24. Build Phases

## Phase 1: Clean separation

Goal: separate trading research from Forex Battle.

Checklist:

- [ ] Create new trading research app.
- [ ] Move chart components.
- [ ] Remove Forex Battle dependencies.
- [ ] Keep existing visual chart working.

## Phase 2: Candle database

Goal: store reliable market data.

Checklist:

- [ ] Create database.
- [ ] Create candles table.
- [ ] Import Oanda candles.
- [ ] Store M5, M15, H1, H4, D1.
- [ ] Validate missing candles.
- [ ] Compare with chart display.

## Phase 3: Strategy registry

Goal: save strategies and settings properly.

Checklist:

- [ ] Create strategies table.
- [ ] Create strategy versions table.
- [ ] Store Crossfire settings.
- [ ] Add strategy settings UI.

## Phase 4: Crossfire setup engine

Goal: detect and save daily Crossfire setups.

Checklist:

- [ ] Identify 13:00 setup candle.
- [ ] Identify previous high.
- [ ] Identify previous low.
- [ ] Draw green/red lines.
- [ ] Save setup to database.
- [ ] Show setup on chart.

## Phase 5: Signal and trade engine

Goal: detect signals and simulate trades.

Checklist:

- [ ] Detect line breaks.
- [ ] Classify breakout type.
- [ ] Create trade simulation.
- [ ] Apply SL/TP rules.
- [ ] Save trade outcomes.

## Phase 6: Trade path analysis

Goal: understand what happened after entry.

Checklist:

- [ ] Calculate MFE.
- [ ] Calculate MAE.
- [ ] Test break-even logic.
- [ ] Test partials.
- [ ] Test 1:2, 1:3, 1:4 outcomes.

## Phase 7: FTMO simulator

Goal: test funded account survival.

Checklist:

- [ ] Add FTMO preset.
- [ ] Simulate £100,000 account.
- [ ] Track daily drawdown.
- [ ] Track max drawdown.
- [ ] Track pass/fail.
- [ ] Track trades and days to pass.

## Phase 8: Analytics engine

Goal: produce clean stats.

Checklist:

- [ ] Overall stats.
- [ ] By symbol.
- [ ] By day.
- [ ] By session.
- [ ] By breakout type.
- [ ] By volatility.
- [ ] By trend context.
- [ ] By FTMO outcome.

## Phase 9: AI research layer

Goal: make AI useful and cheap.

Checklist:

- [ ] Feed summaries to AI.
- [ ] Ask for losing trade patterns.
- [ ] Ask for testable filters.
- [ ] Store AI recommendations.
- [ ] Backtest AI recommendations.
- [ ] Require human approval.

## Phase 10: Paper trading

Goal: test live market behaviour without risk.

Checklist:

- [ ] Connect live candle feed.
- [ ] Generate live signals.
- [ ] Save signals and paper trades.
- [ ] Compare paper trades to historical expectations.
- [ ] Review after 30, 50 and 100 trades.

---

# 25. First Exact Build Task for AI Agent

Use this as the first task for Claude Code/Copilot Agent.

```text
We are rebuilding the trading research system from the ground up.

Your first job is NOT to rewrite the whole app.

Step 1:
Inspect the current project and identify all files related to:
- Forex Battle game logic
- Trading chart display
- Oanda candle loading
- Strategy/backtest logic
- FTMO simulation logic
- Analysis tools

Step 2:
Produce a file map showing what each relevant file does.

Step 3:
Propose a clean separation plan where:
- Forex Battle remains separate
- Trading Research becomes its own app/module
- Shared chart components are reusable
- Strategy/backtest logic is moved into packages

Do not edit any files yet.
Only inspect and produce a plan.
```

---

# 26. Second Build Task for AI Agent

```text
Create the initial database schema for the trading research system.

Include tables for:
- candles
- import_logs
- strategies
- strategy_versions
- crossfire_setups
- signals
- trades
- trade_path_analysis
- trade_context
- backtest_runs
- analytics_summaries
- ai_reviews
- strategy_recommendations
- funded_account_tests

Add appropriate primary keys, foreign keys, indexes and unique constraints.

Do not connect live trading.
Do not change the existing chart UI yet.
Only create the schema and database utility structure.
```

---

# 27. Third Build Task for AI Agent

```text
Build the candle ingestion layer using the existing Oanda API connection.

Requirements:
- Import historical candles for selected symbols.
- Support M5, M15, H1, H4 and D1 timeframes.
- Save candles to the database.
- Avoid duplicates.
- Validate candle integrity.
- Log import runs.
- Detect missing candle periods.
- Add a simple admin/debug page showing imported candle counts by symbol and timeframe.

Do not build strategy logic yet.
```

---

# 28. Fourth Build Task for AI Agent

```text
Build the Crossfire setup detection engine.

Requirements:
- Use M15 candles.
- For each symbol and date, identify the 13:00 UK setup candle.
- Identify the previous high and previous low according to the configured strategy settings.
- Calculate the green and red Crossfire lines.
- Save each setup to crossfire_setups.
- Mark invalid setups with a clear invalid_reason.
- Add a chart overlay that displays the setup candle, high/low anchors and Crossfire lines.

Do not place trades yet.
```

---

# 29. Fifth Build Task for AI Agent

```text
Build signal detection and trade simulation.

Requirements:
- Use M5 candles for entries.
- Detect when price breaks above/below Crossfire lines.
- Classify breakout type.
- Simulate entry based on strategy settings.
- Apply stop loss and take profit rules.
- Save trades to database.
- Calculate R result.
- Link every trade to setup, signal, strategy version and backtest run.
- Show trades visually on the chart.

Do not add AI yet.
```

---

# 30. Sixth Build Task for AI Agent

```text
Build analytics and FTMO simulation.

Requirements:
- Calculate overall strategy stats.
- Calculate win rate, expectancy, profit factor and drawdown.
- Calculate longest losing streak.
- Calculate performance by symbol, day, session, breakout type and ATR band.
- Calculate MFE and MAE for each trade.
- Simulate FTMO-style account rules.
- Save analytics summaries to database.
- Display results in dashboard.

Do not let AI change strategy settings.
```

---

# 31. Seventh Build Task for AI Agent

```text
Build the AI research layer.

Requirements:
- AI should read analytics summaries, not raw candle data.
- AI should identify common winning and losing trade patterns.
- AI should suggest testable improvements.
- AI recommendations must be saved to database.
- AI must not directly alter live strategy settings.
- Add an approval workflow for recommendations.
- Add a button to backtest an AI recommendation against the original strategy version.
```

---

# 32. Final Rules for the Build

## Non-negotiables

- [ ] Raw candle data must be stored.
- [ ] Strategy settings must be versioned.
- [ ] Every backtest must be repeatable.
- [ ] Every trade must link to the strategy version that created it.
- [ ] AI must not directly change live strategy settings.
- [ ] Code must calculate outcomes.
- [ ] AI must analyse clean summaries.
- [ ] The chart must remain visual and human-friendly.
- [ ] Forex Battle must be separated from Trading Research.
- [ ] Live trading must come last, not first.

## The main objective

Build a research-grade trading analysis platform that can answer:

```text
Does this strategy work?
When does it work?
When does it fail?
What conditions should be avoided?
Can it survive funded account rules?
Would the strategy still work outside the original backtest period?
```

Only after those questions are answered should the system move towards live automation.

