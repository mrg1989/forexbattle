/**
 * tradeFeatures.ts
 *
 * Extracts numerical features from each BacktestTrade + candle context,
 * then runs local statistical pattern analysis.
 *
 * No AI required for the statistical layer — patterns are computed directly
 * from the numbers. The AI layer (AiAnalysisPanel) uses these as input.
 */

import type { Candle } from '../types'
import type { BacktestTrade } from './strategies'

// ── Per-trade feature vector ──────────────────────────────────────────────────

export interface TradeFeatures extends BacktestTrade {
  // Entry candle shape
  bodyPips:           number   // |close - open| in pips
  totalRangePips:     number   // (high - low) in pips
  wickRatio:          number   // wick pips / body pips (high = indecision candle)
  // Breakout quality
  breakoutPips:       number   // how far close cleared the trendline (conviction)
  prevCandleAligned:  number   // 1 if previous candle moved in trade direction, 0 if not
  // Risk params
  slPipsActual:       number   // |entry - SL| in pips
  tpPipsActual:       number   // |entry - TP| in pips
  // Timing
  hourOfEntry:        number   // 13 or 14
  minuteOfEntry:      number   // 0–59
  minutesSince1pm:    number   // 0–120
  candlesSince1pm:    number   // candles elapsed from 1pm until entry
  // Volatility context (1pm session, up to entry)
  sessionRangePips:     number   // max high − min low from 1pm up to & including entry candle
  // Pre-session context (8am–1pm, before the trigger window)
  preSessionRangePips:  number   // total range of 8am–1pm session (low to high)
  preSessionTrendPips:  number   // signed net move: 1pm close − 8am open (+ = bullish into 1pm)
  onePmRangePosition:   number   // where 1pm price sits in the 8am–1pm range, 0–100% (100=at the top)
  lastHourRangePips:    number   // volatility in the hour before 1pm (12:00–13:00)
  prevDayResult:        number   // previous calendar day's trade: +1=win, -1=loss, 0=none/open
  // Multi-timeframe context
  h1TrendBias:          number   // H1 trend direction at entry: +1=bullish, -1=bearish, 0=neutral
}

// ── Aggregate stats for a single feature ─────────────────────────────────────

export interface FeatureStat {
  feature:     string
  label:       string          // human display name
  meanWins:    number
  meanLosses:  number
  delta:       number          // meanWins − meanLosses
  pctDiff:     number          // % difference (positive = higher for wins)
  unit:        string
}

// ── Win-rate by quartile for a single feature ────────────────────────────────

export interface QuartileBucket {
  range:   string
  winRate: number              // 0–100
  count:   number
}

export interface QuartileStat {
  feature:   string
  label:     string
  quartiles: QuartileBucket[]
}

// ── Full local analysis output ────────────────────────────────────────────────

export interface LocalAnalysis {
  featureStats:   FeatureStat[]
  quartileStats:  QuartileStat[]
  topPatterns:    string[]     // auto-generated sentences summarising strongest patterns
  closedCount:    number
  winCount:       number
  lossCount:      number
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature extraction
// ─────────────────────────────────────────────────────────────────────────────

export function extractFeatures(
  trades: BacktestTrade[],
  candles: Candle[],
  pipSize: number,
): TradeFeatures[] {
  if (candles.length === 0 || trades.length === 0) return []

  // Build a fast ts→candle lookup and ordered index
  const tsMap = new Map<number, Candle>()
  const tsIndex: number[] = []
  for (const c of candles) { tsMap.set(c.timestamp, c); tsIndex.push(c.timestamp) }
  tsIndex.sort((a, b) => a - b)

  // Pre-build H1 close map for trend bias computation (O(n))
  const h1Map = new Map<number, number>()
  for (const c of candles) {
    const d = new Date(c.timestamp)
    const hs = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), 0, 0).getTime()
    h1Map.set(hs, c.close)
  }

  // Build a dateKey→trade result map for prevDayResult lookup
  const dateResultMap = new Map<string, 'win' | 'loss' | 'open'>()
  for (const t of trades) {
    const dk = new Date(t.entryTs).toDateString()
    dateResultMap.set(dk, t.result)
  }
  // Sort trades by date ascending for prev-day lookup
  const sortedTrades = [...trades].sort((a, b) => a.entryTs - b.entryTs)

  return sortedTrades.map((trade, tradeIdx) => {
    // Entry candle
    const ec = tsMap.get(trade.entryTs)
    const bodyPips       = ec ? Math.abs(ec.close - ec.open) / pipSize : 0
    const totalRangePips = ec ? (ec.high - ec.low) / pipSize : 0
    const wickPips       = Math.max(0, totalRangePips - bodyPips)
    const wickRatio      = bodyPips > 0 ? wickPips / bodyPips : 99

    // Breakout distance — how far the close cleared the trendline.
    // We use slPrice as a proxy for where the trendline was: for a buy,
    // entry > trendline, so breakoutPips ≈ |entry - SL side trendline|.
    // A cleaner proxy: for buy the close cleared the green line by (entry - greenLine).
    // Since we don't store the line price at entry, we use entryPrice - tpPrice/rrRatio
    // as an approximation. Actually we do have slPrice which is below the red line for buys.
    // Better: just use bodyPips × conviction direction as a rough proxy.
    // The actual value = (close - linePriceAtEntry). We don't have the line price stored
    // in BacktestTrade, so we derive it from the SL: for a buy, SL ≈ redLine - dist,
    // and entry ≈ greenLine + breakout. Approximation: breakoutPips = bodyPips (entry candle body
    // is entirely above the line if it's a strong break).
    // GOOD ENOUGH for statistical analysis since body and breakout are correlated.
    const breakoutPips = bodyPips   // close beyond line ≈ candle body for clean breaks

    // Previous candle alignment — was the candle before entry moving in the right direction?
    const entryIdx = tsIndex.indexOf(trade.entryTs)
    let prevCandleAligned = 0
    if (entryIdx > 0) {
      const prevC = tsMap.get(tsIndex[entryIdx - 1])
      if (prevC) {
        const prevUp = prevC.close > prevC.open
        prevCandleAligned = (trade.direction === 'buy' && prevUp) || (trade.direction === 'sell' && !prevUp) ? 1 : 0
      }
    }

    // Risk sizing
    const slPipsActual = Math.abs(trade.entryPrice - trade.slPrice) / pipSize
    const tpPipsActual = Math.abs(trade.entryPrice - trade.tpPrice) / pipSize

    // Timing
    const d              = new Date(trade.entryTs)
    const hourOfEntry    = d.getHours()
    const minuteOfEntry  = d.getMinutes()
    const minutesSince1pm = (hourOfEntry - 13) * 60 + minuteOfEntry

    // Find the 1pm candle for this session
    const onePmTs = findOnePmTs(trade.entryTs, candles)

    // Candles since 1pm + post-1pm session range
    let candlesSince1pm = 0
    let sessionHigh = -Infinity, sessionLow = Infinity
    for (const c of candles) {
      if (onePmTs !== null && c.timestamp >= onePmTs && c.timestamp <= trade.entryTs) {
        candlesSince1pm++
        sessionHigh = Math.max(sessionHigh, c.high)
        sessionLow  = Math.min(sessionLow,  c.low)
      }
    }
    const sessionRangePips = sessionHigh > sessionLow
      ? (sessionHigh - sessionLow) / pipSize
      : 0

    // ── Pre-session context (8am – 1pm) ─────────────────────────────────────
    const dayStr = d.toDateString()
    const eightAmMs  = new Date(d.getFullYear(), d.getMonth(), d.getDate(),  8,  0, 0).getTime()
    const twelveAmMs = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12,  0, 0).getTime()
    const onePmMs    = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 13,  0, 0).getTime()

    let psHigh = -Infinity, psLow = Infinity
    let eightAmOpen: number | null = null
    let lastHourHigh = -Infinity, lastHourLow = Infinity
    let onePmClose: number | null = null

    for (const c of candles) {
      if (new Date(c.timestamp).toDateString() !== dayStr) continue
      if (c.timestamp >= eightAmMs && c.timestamp < onePmMs) {
        psHigh = Math.max(psHigh, c.high)
        psLow  = Math.min(psLow,  c.low)
        if (c.timestamp === eightAmMs || eightAmOpen === null) eightAmOpen = c.open
        if (c.timestamp >= twelveAmMs) {
          lastHourHigh = Math.max(lastHourHigh, c.high)
          lastHourLow  = Math.min(lastHourLow,  c.low)
        }
      }
      if (c.timestamp === onePmMs) onePmClose = c.close
    }

    const preSessionRangePips = psHigh > psLow && psHigh !== -Infinity
      ? (psHigh - psLow) / pipSize
      : 0
    const preSessionTrendPips = (eightAmOpen !== null && onePmClose !== null)
      ? (onePmClose - eightAmOpen) / pipSize
      : 0
    const onePmRangePosition = (psHigh > psLow && onePmClose !== null)
      ? Math.round(((onePmClose - psLow) / (psHigh - psLow)) * 100)
      : 50
    const lastHourRangePips = lastHourHigh > lastHourLow && lastHourHigh !== -Infinity
      ? (lastHourHigh - lastHourLow) / pipSize
      : 0

    // Previous calendar day's trade result
    let prevDayResult = 0
    if (tradeIdx > 0) {
      const prevTrade = sortedTrades[tradeIdx - 1]
      const prevDay   = new Date(prevTrade.entryTs).toDateString()
      if (prevDay !== dayStr) {
        prevDayResult = prevTrade.result === 'win' ? 1 : prevTrade.result === 'loss' ? -1 : 0
      }
    }

    // H1 trend direction at entry
    const oneHourMs = 3_600_000
    const h1Closes: number[] = []
    for (let offset = 1; offset <= 10 && h1Closes.length < 4; offset++) {
      const t = trade.entryTs - offset * oneHourMs
      const dh = new Date(t)
      const hs = new Date(dh.getFullYear(), dh.getMonth(), dh.getDate(), dh.getHours(), 0, 0).getTime()
      const close = h1Map.get(hs)
      if (close !== undefined) h1Closes.unshift(close)
    }
    const h1TrendBias: number = h1Closes.length < 2 ? 0
      : h1Closes[h1Closes.length - 1] > h1Closes[0] ? 1
      : h1Closes[h1Closes.length - 1] < h1Closes[0] ? -1
      : 0

    return {
      ...trade,
      bodyPips,
      totalRangePips,
      wickRatio,
      breakoutPips,
      prevCandleAligned,
      slPipsActual,
      tpPipsActual,
      hourOfEntry,
      minuteOfEntry,
      minutesSince1pm,
      candlesSince1pm,
      sessionRangePips,
      preSessionRangePips,
      preSessionTrendPips,
      onePmRangePosition,
      lastHourRangePips,
      prevDayResult,
      h1TrendBias,
    }
  })
}

function findOnePmTs(entryTs: number, candles: Candle[]): number | null {
  const d = new Date(entryTs)
  const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 13, 0, 0).getTime()
  // Find closest candle at or just after 1pm on the same day
  for (const c of candles) {
    if (c.timestamp >= dayStart && c.timestamp <= entryTs) return c.timestamp
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Local statistical analysis (no API needed)
// ─────────────────────────────────────────────────────────────────────────────

export function analyzeLocally(features: TradeFeatures[]): LocalAnalysis {
  const closed  = features.filter(f => f.result !== 'open')
  const wins    = closed.filter(f => f.result === 'win')
  const losses  = closed.filter(f => f.result === 'loss')

  if (closed.length === 0) {
    return { featureStats: [], quartileStats: [], topPatterns: [], closedCount: 0, winCount: 0, lossCount: 0 }
  }

  // ── Feature stats ─────────────────────────────────────────────────────────

  type FeatureDef = { key: keyof TradeFeatures; label: string; unit: string }
  const featureDefs: FeatureDef[] = [
    // Entry candle
    { key: 'bodyPips',              label: 'Entry candle body',      unit: 'pips'    },
    { key: 'wickRatio',             label: 'Wick/body ratio',         unit: 'ratio'   },
    { key: 'breakoutPips',          label: 'Breakout distance',       unit: 'pips'    },
    { key: 'prevCandleAligned',     label: 'Prev candle aligned',     unit: 'bool'    },
    // Risk
    { key: 'slPipsActual',          label: 'Stop loss size',          unit: 'pips'    },
    // Timing
    { key: 'minutesSince1pm',       label: 'Minutes since 1pm',      unit: 'min'     },
    { key: 'candlesSince1pm',       label: 'Candles since 1pm',      unit: 'candles' },
    // Post-1pm context
    { key: 'sessionRangePips',      label: 'Post-1pm session range',  unit: 'pips'    },
    { key: 'totalRangePips',        label: 'Entry candle range',      unit: 'pips'    },
    // Pre-session context (8am–1pm)
    { key: 'preSessionRangePips',   label: 'Pre-session range',       unit: 'pips'    },
    { key: 'preSessionTrendPips',   label: 'Pre-session trend',       unit: 'pips'    },
    { key: 'onePmRangePosition',    label: '1pm position in range',   unit: '%'       },
    { key: 'lastHourRangePips',     label: 'Last hour range (12–1pm)', unit: 'pips'    },
    { key: 'prevDayResult',         label: 'Prev day result',         unit: 'score'   },
    // Multi-timeframe
    { key: 'h1TrendBias',            label: 'H1 trend bias',           unit: 'score'   },
  ]

  const featureStats: FeatureStat[] = featureDefs.map(({ key, label, unit }) => {
    const mw  = mean(wins.map(f => f[key] as number))
    const ml  = mean(losses.map(f => f[key] as number))
    const d   = mw - ml
    const pct = ml !== 0 ? (d / Math.abs(ml)) * 100 : 0
    return { feature: key as string, label, meanWins: mw, meanLosses: ml, delta: d, pctDiff: pct, unit }
  })

  // Sort by absolute % difference — most predictive features first
  featureStats.sort((a, b) => Math.abs(b.pctDiff) - Math.abs(a.pctDiff))

  // ── Quartile stats (top 4 features only) ─────────────────────────────────

  const top4 = featureStats.slice(0, 4)
  const quartileStats: QuartileStat[] = top4.map(fs => ({
    feature:   fs.feature,
    label:     fs.label,
    quartiles: quartileWinRates(closed, fs.feature as keyof TradeFeatures, fs.unit),
  }))

  // ── Pattern sentences ─────────────────────────────────────────────────────

  const topPatterns: string[] = []

  // Best single feature narrative
  for (const fs of featureStats.slice(0, 3)) {
    if (Math.abs(fs.pctDiff) < 10) continue
    const direction = fs.delta > 0 ? 'higher' : 'lower'
    const opposite  = fs.delta > 0 ? 'lower'  : 'higher'
    topPatterns.push(
      `Winning trades had ${direction} ${fs.label} on average ` +
      `(${fmt(fs.meanWins, fs.unit)} wins vs ${fmt(fs.meanLosses, fs.unit)} losses, ` +
      `${Math.abs(fs.pctDiff).toFixed(0)}% ${direction} for ${opposite} outcomes).`
    )
  }

  // Best/worst quartile for top feature
  if (quartileStats.length > 0) {
    const qs = quartileStats[0]
    const best  = [...qs.quartiles].sort((a, b) => b.winRate - a.winRate)[0]
    const worst = [...qs.quartiles].sort((a, b) => a.winRate - b.winRate)[0]
    if (best && worst && best !== worst) {
      topPatterns.push(
        `Best ${qs.label} zone: ${best.range} ${featureStats[0].unit} → ${best.winRate.toFixed(0)}% win rate (n=${best.count}). ` +
        `Worst: ${worst.range} → ${worst.winRate.toFixed(0)}% (n=${worst.count}).`
      )
    }
  }

  // Pattern sentences (time-of-day)
  const early = closed.filter(f => f.minutesSince1pm < 30)
  const late  = closed.filter(f => f.minutesSince1pm >= 30)
  if (early.length >= 3 && late.length >= 3) {
    const wrEarly = winRate(early)
    const wrLate  = winRate(late)
    const better  = wrLate > wrEarly ? 'after 1:30 pm' : 'within the first 30 min'
    topPatterns.push(
      `Time filter: trades before 1:30pm win ${wrEarly.toFixed(0)}%, ` +
      `after 1:30pm win ${wrLate.toFixed(0)}%. ` +
      `${better.charAt(0).toUpperCase() + better.slice(1)} appears stronger.`
    )
  }

  // Pre-session trend pattern
  const bullishInto1pm = closed.filter(f => f.preSessionTrendPips > 0)
  const bearishInto1pm = closed.filter(f => f.preSessionTrendPips <= 0)
  if (bullishInto1pm.length >= 3 && bearishInto1pm.length >= 3) {
    const wrBull = winRate(bullishInto1pm)
    const wrBear = winRate(bearishInto1pm)
    if (Math.abs(wrBull - wrBear) >= 10) {
      topPatterns.push(
        `Pre-session trend: days where 8am–1pm was bullish won at ${wrBull.toFixed(0)}%, ` +
        `bearish days won at ${wrBear.toFixed(0)}%. ` +
        `(n=${bullishInto1pm.length} bull, n=${bearishInto1pm.length} bear)`
      )
    }
  }

  // 1pm range position pattern
  const topOfRange    = closed.filter(f => f.onePmRangePosition >= 70)
  const bottomOfRange = closed.filter(f => f.onePmRangePosition <= 30)
  if (topOfRange.length >= 3 && bottomOfRange.length >= 3) {
    const wrTop = winRate(topOfRange)
    const wrBot = winRate(bottomOfRange)
    if (Math.abs(wrTop - wrBot) >= 10) {
      topPatterns.push(
        `1pm price position: when 1pm price is in the top 30% of the pre-session range, win rate is ${wrTop.toFixed(0)}%. ` +
        `Bottom 30%: ${wrBot.toFixed(0)}%. ` +
        `(n=${topOfRange.length} top, n=${bottomOfRange.length} bottom)`
      )
    }
  }

  // H1 trend alignment pattern
  const h1Aligned    = closed.filter(f => f.h1TrendBias !== 0 && f.h1TrendBias === (f.direction === 'buy' ? 1 : -1))
  const h1Unaligned  = closed.filter(f => f.h1TrendBias !== 0 && f.h1TrendBias !== (f.direction === 'buy' ? 1 : -1))
  if (h1Aligned.length >= 3 && h1Unaligned.length >= 3) {
    const wrAligned   = winRate(h1Aligned)
    const wrUnaligned = winRate(h1Unaligned)
    if (Math.abs(wrAligned - wrUnaligned) >= 8) {
      topPatterns.push(
        `H1 trend alignment: trades WITH the H1 trend won at ${wrAligned.toFixed(0)}%, ` +
        `AGAINST won at ${wrUnaligned.toFixed(0)}%. ` +
        `(n=${h1Aligned.length} aligned, n=${h1Unaligned.length} counter-trend)`
      )
    }
  }

  return {
    featureStats,
    quartileStats,
    topPatterns,
    closedCount: closed.length,
    winCount:    wins.length,
    lossCount:   losses.length,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function mean(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((s, v) => s + v, 0) / arr.length
}

function winRate(trades: TradeFeatures[]): number {
  const closed = trades.filter(t => t.result !== 'open')
  if (closed.length === 0) return 0
  return (closed.filter(t => t.result === 'win').length / closed.length) * 100
}

function quartileWinRates(
  trades: TradeFeatures[],
  key: keyof TradeFeatures,
  unit: string,
): QuartileBucket[] {
  const values = trades.map(t => t[key] as number).sort((a, b) => a - b)
  const n = values.length
  const q1 = values[Math.floor(n * 0.25)]
  const q2 = values[Math.floor(n * 0.50)]
  const q3 = values[Math.floor(n * 0.75)]

  const buckets = [
    { min: -Infinity, max: q1, label: `< ${q1.toFixed(1)}` },
    { min: q1, max: q2,        label: `${q1.toFixed(1)}–${q2.toFixed(1)}` },
    { min: q2, max: q3,        label: `${q2.toFixed(1)}–${q3.toFixed(1)}` },
    { min: q3, max: Infinity,  label: `> ${q3.toFixed(1)}` },
  ]

  return buckets.map(b => {
    const bucket = trades.filter(t => {
      const v = t[key] as number
      return v >= b.min && v < b.max
    })
    return {
      range:   b.label,
      winRate: winRate(bucket as TradeFeatures[]),
      count:   bucket.length,
    }
  })
}

function fmt(v: number, unit: string): string {
  if (unit === 'ratio') return v.toFixed(2)
  if (unit === 'pips' || unit === 'min' || unit === '%') return v.toFixed(1)
  if (unit === 'score') return v.toFixed(0)
  return v.toFixed(0)
}

// ─────────────────────────────────────────────────────────────────────────────
// Build compact text payload for AI prompt
// ─────────────────────────────────────────────────────────────────────────────

export function buildAiPrompt(
  features:  TradeFeatures[],
  analysis:  LocalAnalysis,
  pair:      string,
  tfLabel:   string,
  slMode:    string,
  slPips:    number,
  rrRatio:   number,
): string {
  const closed = features.filter(f => f.result !== 'open')
  const wins   = closed.filter(f => f.result === 'win')

  // Direction split
  const buys   = closed.filter(f => f.direction === 'buy')
  const sells  = closed.filter(f => f.direction === 'sell')
  const buyWr  = buys.length  > 0 ? (buys.filter(f => f.result === 'win').length  / buys.length  * 100).toFixed(0) : 'n/a'
  const sellWr = sells.length > 0 ? (sells.filter(f => f.result === 'win').length / sells.length * 100).toFixed(0) : 'n/a'

  const featureTable = analysis.featureStats
    .map(fs =>
      `${fs.label.padEnd(26)} wins: ${fmt(fs.meanWins, fs.unit).padStart(7)} ${fs.unit.padEnd(7)}` +
      `losses: ${fmt(fs.meanLosses, fs.unit).padStart(7)} ${fs.unit.padEnd(7)}` +
      `diff: ${fs.pctDiff >= 0 ? '+' : ''}${fs.pctDiff.toFixed(0)}%`
    )
    .join('\n')

  const quartileSection = analysis.quartileStats
    .map(qs =>
      `${qs.label}:\n` +
      qs.quartiles
        .map(b => `  ${b.range.padEnd(16)} → ${b.winRate.toFixed(0)}% (n=${b.count})`)
        .join('\n')
    )
    .join('\n\n')

  // Compact trade CSV (max 60 trades)
  const tradeRows = closed.slice(-60).map(t =>
    [
      t.direction[0].toUpperCase(),
      t.result[0].toUpperCase(),
      t.bodyPips.toFixed(1),
      t.wickRatio.toFixed(2),
      t.breakoutPips.toFixed(1),
      t.prevCandleAligned,
      t.slPipsActual.toFixed(1),
      t.minutesSince1pm,
      t.sessionRangePips.toFixed(1),
      t.preSessionRangePips.toFixed(1),
      t.preSessionTrendPips.toFixed(1),
      t.onePmRangePosition,
      t.lastHourRangePips.toFixed(1),
      t.prevDayResult,
      t.h1TrendBias,
      t.pnlPips.toFixed(1),
    ].join(',')
  ).join('\n')

  return `You are a quantitative trading analyst. Analyse this historical trade data from a Crossfire strategy and provide specific, actionable insights.

STRATEGY PARAMETERS
Pair: ${pair} | Timeframe: ${tfLabel} | SL method: ${slMode} ${slMode === 'static' ? `(${slPips}p)` : ''} | R:R target: 1:${rrRatio}
Total closed trades: ${closed.length} | Wins: ${wins.length} | Losses: ${analysis.lossCount} | Win rate: ${analysis.closedCount > 0 ? (wins.length / analysis.closedCount * 100).toFixed(1) : 0}%
Buys: ${buys.length} trades, ${buyWr}% WR | Sells: ${sells.length} trades, ${sellWr}% WR

FEATURE MEANS (wins vs losses)
${featureTable}

WIN RATE BY QUARTILE
${quartileSection}

RAW TRADE DATA (dir, result, bodyPips, wickRatio, breakoutPips, prevAligned, slPips, minsSince1pm, postSessionRange, preSessionRange, preSessionTrend, onePmPosition%, lastHourRange, prevDayResult, h1Trend, pnlPips)
${tradeRows}

NOTE ON FEATURES:
- preSessionRange: how much ground EUR/USD covered 8am–1pm (wide = active day, narrow = dead)
- preSessionTrend: net signed move 8am→1pm in pips (positive = bullish into 1pm, negative = bearish)
- onePmPosition%: where 1pm price sits in the 8am–1pm range (100=at the top, 0=at the bottom)
- lastHourRange: volatility 12pm–1pm (accelerating into trigger vs calming down)
- prevDayResult: +1=previous day won, -1=previous day lost, 0=no trade previous day
- h1Trend: H1 chart trend at entry time (+1=bullish, -1=bearish, 0=insufficient data)

Please provide:
1. Top 3 features that most strongly separate wins from losses — with specific thresholds suggested as filters
2. Whether H1 trend alignment matters — do trades WITH the H1 trend win significantly more than counter-trend trades? Should counter-trend entries be skipped?
3. Whether any pre-session condition (trend, range, 1pm position, last-hour volatility) predicts outcome — should any of these be a \"skip day\" condition?
4. Whether a \"minimum body size\" entry filter would help, and what threshold to use
5. Whether there is a time window within the 1pm–3pm session where performance is notably better or worse
6. Whether buys or sells perform differently and if a direction filter is warranted
7. Any SL or R:R adjustments that the data suggests
8. One sentence summary: is this strategy statistically viable as-is, or does it need a filter first?

Be concise, quantitative, and directly actionable. No generic trading advice.`
}
