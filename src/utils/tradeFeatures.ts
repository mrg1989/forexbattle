import type { Candle } from '../types'
import type { BacktestTrade } from './strategies'
import { toUKHour, toUKDateString } from '../lib/time'

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
  hourOfEntry:        number   // 13 or 14 (UK)
  minuteOfEntry:      number   // 0–59
  minutesSince1pm:    number   // 0–120
  candlesSince1pm:    number   // candles elapsed from 1pm until entry
  // Volatility context (1pm session, up to entry)
  sessionRangePips:     number   // max high − min low from 1pm up to & including entry candle
  // Pre-session context (8am–1pm, before the trigger window)
  preSessionRangePips:  number   // total range of 8am–1pm session (low to high)
  preSessionTrendPips:  number   // signed net move: 1pm close − 8am open (+ = bullish into 1pm)
  onePmRangePosition:   number   // where 1pm price sits in the 8am–1pm range, 0–100% (100=at the top)
  lastHourRangePips:    number   // volatility in the hour before 1pm (12:00–13:00 UK)
  prevDayResult:        number   // previous calendar day's trade: +1=win, -1=loss, 0=none/open
  // Multi-timeframe context
  h1TrendBias:          number   // H1 trend direction at entry: +1=bullish, -1=bearish, 0=neutral
}

// ── Aggregate stats for a single feature ─────────────────────────────────────

export interface FeatureStat {
  feature:     string
  label:       string
  meanWins:    number
  meanLosses:  number
  delta:       number
  pctDiff:     number
  unit:        string
}

// ── Win-rate by quartile for a single feature ────────────────────────────────

export interface QuartileBucket {
  range:   string
  winRate: number
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
  topPatterns:    string[]
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

  const tsMap = new Map<number, Candle>()
  const tsIndex: number[] = []
  for (const c of candles) { tsMap.set(c.timestamp, c); tsIndex.push(c.timestamp) }
  tsIndex.sort((a, b) => a - b)

  const h1Map = new Map<number, number>()
  for (const c of candles) {
    const d = new Date(c.timestamp)
    const hs = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), 0, 0).getTime()
    h1Map.set(hs, c.close)
  }

  const dateResultMap = new Map<string, 'win' | 'loss' | 'open'>()
  for (const t of trades) {
    const dk = toUKDateString(t.entryTs)
    dateResultMap.set(dk, t.result)
  }
  const sortedTrades = [...trades].sort((a, b) => a.entryTs - b.entryTs)

  return sortedTrades.map((trade, tradeIdx) => {
    const ec = tsMap.get(trade.entryTs)
    const bodyPips       = ec ? Math.abs(ec.close - ec.open) / pipSize : 0
    const totalRangePips = ec ? (ec.high - ec.low) / pipSize : 0
    const wickPips       = Math.max(0, totalRangePips - bodyPips)
    const wickRatio      = bodyPips > 0 ? wickPips / bodyPips : 99
    const breakoutPips   = bodyPips

    const entryIdx = tsIndex.indexOf(trade.entryTs)
    let prevCandleAligned = 0
    if (entryIdx > 0) {
      const prevC = tsMap.get(tsIndex[entryIdx - 1])
      if (prevC) {
        const prevUp = prevC.close > prevC.open
        prevCandleAligned = (trade.direction === 'buy' && prevUp) || (trade.direction === 'sell' && !prevUp) ? 1 : 0
      }
    }

    const slPipsActual = Math.abs(trade.entryPrice - trade.slPrice) / pipSize
    const tpPipsActual = Math.abs(trade.entryPrice - trade.tpPrice) / pipSize

    const hourOfEntry     = toUKHour(trade.entryTs)
    const minuteOfEntry   = new Date(trade.entryTs).getMinutes()
    const minutesSince1pm = (hourOfEntry - 13) * 60 + minuteOfEntry

    const onePmTs = findOnePmTs(trade.entryTs, candles)

    let candlesSince1pm = 0
    let sessionHigh = -Infinity, sessionLow = Infinity
    for (const c of candles) {
      if (onePmTs !== null && c.timestamp >= onePmTs && c.timestamp <= trade.entryTs) {
        candlesSince1pm++
        sessionHigh = Math.max(sessionHigh, c.high)
        sessionLow  = Math.min(sessionLow,  c.low)
      }
    }
    const sessionRangePips = sessionHigh > sessionLow ? (sessionHigh - sessionLow) / pipSize : 0

    const dayStr = toUKDateString(trade.entryTs)
    let psHigh = -Infinity, psLow = Infinity
    let eightAmOpen: number | null = null
    let lastHourHigh = -Infinity, lastHourLow = Infinity
    let onePmClose: number | null = null

    for (const c of candles) {
      if (toUKDateString(c.timestamp) !== dayStr) continue
      const ukH = toUKHour(c.timestamp)
      const mins = new Date(c.timestamp).getMinutes()
      if (ukH >= 8 && ukH < 13) {
        psHigh = Math.max(psHigh, c.high)
        psLow  = Math.min(psLow,  c.low)
        if ((ukH === 8 && mins === 0) || eightAmOpen === null) eightAmOpen = c.open
        if (ukH === 12) {
          lastHourHigh = Math.max(lastHourHigh, c.high)
          lastHourLow  = Math.min(lastHourLow,  c.low)
        }
      }
      if (ukH === 13 && mins === 0) onePmClose = c.close
    }

    const preSessionRangePips = psHigh > psLow && psHigh !== -Infinity ? (psHigh - psLow) / pipSize : 0
    const preSessionTrendPips = (eightAmOpen !== null && onePmClose !== null) ? (onePmClose - eightAmOpen) / pipSize : 0
    const onePmRangePosition  = (psHigh > psLow && onePmClose !== null)
      ? Math.round(((onePmClose - psLow) / (psHigh - psLow)) * 100) : 50
    const lastHourRangePips   = lastHourHigh > lastHourLow && lastHourHigh !== -Infinity ? (lastHourHigh - lastHourLow) / pipSize : 0

    let prevDayResult = 0
    if (tradeIdx > 0) {
      const prevTrade = sortedTrades[tradeIdx - 1]
      const prevDay   = toUKDateString(prevTrade.entryTs)
      if (prevDay !== dayStr) {
        prevDayResult = prevTrade.result === 'win' ? 1 : prevTrade.result === 'loss' ? -1 : 0
      }
    }

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
      bodyPips, totalRangePips, wickRatio, breakoutPips, prevCandleAligned,
      slPipsActual, tpPipsActual, hourOfEntry, minuteOfEntry, minutesSince1pm,
      candlesSince1pm, sessionRangePips, preSessionRangePips, preSessionTrendPips,
      onePmRangePosition, lastHourRangePips, prevDayResult, h1TrendBias,
    }
  })
}

function findOnePmTs(entryTs: number, candles: Candle[]): number | null {
  const ukDate = toUKDateString(entryTs)
  for (const c of candles) {
    if (toUKHour(c.timestamp) === 13 && new Date(c.timestamp).getMinutes() === 0 &&
        toUKDateString(c.timestamp) === ukDate) {
      return c.timestamp
    }
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Local statistical analysis
// ─────────────────────────────────────────────────────────────────────────────

export function analyzeLocally(features: TradeFeatures[]): LocalAnalysis {
  const closed  = features.filter(f => f.result !== 'open')
  const wins    = closed.filter(f => f.result === 'win')
  const losses  = closed.filter(f => f.result === 'loss')

  if (closed.length === 0) {
    return { featureStats: [], quartileStats: [], topPatterns: [], closedCount: 0, winCount: 0, lossCount: 0 }
  }

  type FeatureDef = { key: keyof TradeFeatures; label: string; unit: string }
  const featureDefs: FeatureDef[] = [
    { key: 'bodyPips',            label: 'Entry candle body',       unit: 'pips'    },
    { key: 'wickRatio',           label: 'Wick/body ratio',          unit: 'ratio'   },
    { key: 'breakoutPips',        label: 'Breakout distance',        unit: 'pips'    },
    { key: 'prevCandleAligned',   label: 'Prev candle aligned',      unit: 'bool'    },
    { key: 'slPipsActual',        label: 'Stop loss size',           unit: 'pips'    },
    { key: 'minutesSince1pm',     label: 'Minutes since 1pm',       unit: 'min'     },
    { key: 'candlesSince1pm',     label: 'Candles since 1pm',       unit: 'candles' },
    { key: 'sessionRangePips',    label: 'Post-1pm session range',   unit: 'pips'    },
    { key: 'totalRangePips',      label: 'Entry candle range',       unit: 'pips'    },
    { key: 'preSessionRangePips', label: 'Pre-session range',        unit: 'pips'    },
    { key: 'preSessionTrendPips', label: 'Pre-session trend',        unit: 'pips'    },
    { key: 'onePmRangePosition',  label: '1pm position in range',    unit: '%'       },
    { key: 'lastHourRangePips',   label: 'Last hour range (12–1pm)', unit: 'pips'    },
    { key: 'prevDayResult',       label: 'Prev day result',          unit: 'score'   },
    { key: 'h1TrendBias',         label: 'H1 trend bias',            unit: 'score'   },
  ]

  const featureStats: FeatureStat[] = featureDefs.map(({ key, label, unit }) => {
    const mw  = mean(wins.map(f => f[key] as number))
    const ml  = mean(losses.map(f => f[key] as number))
    const d   = mw - ml
    const pct = ml !== 0 ? (d / Math.abs(ml)) * 100 : 0
    return { feature: key as string, label, meanWins: mw, meanLosses: ml, delta: d, pctDiff: pct, unit }
  })
  featureStats.sort((a, b) => Math.abs(b.pctDiff) - Math.abs(a.pctDiff))

  const top4 = featureStats.slice(0, 4)
  const quartileStats: QuartileStat[] = top4.map(fs => ({
    feature:   fs.feature,
    label:     fs.label,
    quartiles: quartileWinRates(closed, fs.feature as keyof TradeFeatures, fs.unit),
  }))

  const topPatterns: string[] = []

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

  const early = closed.filter(f => f.minutesSince1pm < 30)
  const late  = closed.filter(f => f.minutesSince1pm >= 30)
  if (early.length >= 3 && late.length >= 3) {
    const wrEarly = winRate(early), wrLate = winRate(late)
    const better  = wrLate > wrEarly ? 'after 1:30 pm' : 'within the first 30 min'
    topPatterns.push(
      `Time filter: trades before 1:30pm win ${wrEarly.toFixed(0)}%, after 1:30pm win ${wrLate.toFixed(0)}%. ` +
      `${better.charAt(0).toUpperCase() + better.slice(1)} appears stronger.`
    )
  }

  const bullishInto1pm = closed.filter(f => f.preSessionTrendPips > 0)
  const bearishInto1pm = closed.filter(f => f.preSessionTrendPips <= 0)
  if (bullishInto1pm.length >= 3 && bearishInto1pm.length >= 3) {
    const wrBull = winRate(bullishInto1pm), wrBear = winRate(bearishInto1pm)
    if (Math.abs(wrBull - wrBear) >= 10) {
      topPatterns.push(
        `Pre-session trend: days where 8am–1pm was bullish won at ${wrBull.toFixed(0)}%, ` +
        `bearish days won at ${wrBear.toFixed(0)}%. (n=${bullishInto1pm.length} bull, n=${bearishInto1pm.length} bear)`
      )
    }
  }

  const topOfRange    = closed.filter(f => f.onePmRangePosition >= 70)
  const bottomOfRange = closed.filter(f => f.onePmRangePosition <= 30)
  if (topOfRange.length >= 3 && bottomOfRange.length >= 3) {
    const wrTop = winRate(topOfRange), wrBot = winRate(bottomOfRange)
    if (Math.abs(wrTop - wrBot) >= 10) {
      topPatterns.push(
        `1pm price position: top 30% of range wins ${wrTop.toFixed(0)}%, bottom 30% wins ${wrBot.toFixed(0)}%. ` +
        `(n=${topOfRange.length} top, n=${bottomOfRange.length} bottom)`
      )
    }
  }

  const h1Aligned   = closed.filter(f => f.h1TrendBias !== 0 && f.h1TrendBias === (f.direction === 'buy' ? 1 : -1))
  const h1Unaligned = closed.filter(f => f.h1TrendBias !== 0 && f.h1TrendBias !== (f.direction === 'buy' ? 1 : -1))
  if (h1Aligned.length >= 3 && h1Unaligned.length >= 3) {
    const wrAligned = winRate(h1Aligned), wrUnaligned = winRate(h1Unaligned)
    if (Math.abs(wrAligned - wrUnaligned) >= 8) {
      topPatterns.push(
        `H1 trend alignment: WITH trend ${wrAligned.toFixed(0)}%, AGAINST ${wrUnaligned.toFixed(0)}%. ` +
        `(n=${h1Aligned.length} aligned, n=${h1Unaligned.length} counter-trend)`
      )
    }
  }

  return { featureStats, quartileStats, topPatterns, closedCount: closed.length, winCount: wins.length, lossCount: losses.length }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function mean(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((s, v) => s + v, 0) / arr.length
}

function winRate(trades: TradeFeatures[]): number {
  const closed = trades.filter(t => t.result !== 'open')
  return closed.length === 0 ? 0 : (closed.filter(t => t.result === 'win').length / closed.length) * 100
}

function quartileWinRates(trades: TradeFeatures[], key: keyof TradeFeatures, unit: string): QuartileBucket[] {
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
    const bucket = trades.filter(t => { const v = t[key] as number; return v >= b.min && v < b.max })
    return { range: b.label, winRate: winRate(bucket as TradeFeatures[]), count: bucket.length }
  })
}

function fmt(v: number, unit: string): string {
  if (unit === 'ratio') return v.toFixed(2)
  if (unit === 'pips' || unit === 'min' || unit === '%') return v.toFixed(1)
  return v.toFixed(0)
}

// ─────────────────────────────────────────────────────────────────────────────
// AI prompt builder
// ─────────────────────────────────────────────────────────────────────────────

export function buildAiPrompt(
  features: TradeFeatures[], analysis: LocalAnalysis,
  pair: string, tfLabel: string, slMode: string, slPips: number, rrRatio: number,
): string {
  const closed = features.filter(f => f.result !== 'open')
  const wins   = closed.filter(f => f.result === 'win')
  const buys   = closed.filter(f => f.direction === 'buy')
  const sells  = closed.filter(f => f.direction === 'sell')
  const buyWr  = buys.length  > 0 ? (buys.filter(f => f.result === 'win').length  / buys.length  * 100).toFixed(0) : 'n/a'
  const sellWr = sells.length > 0 ? (sells.filter(f => f.result === 'win').length / sells.length * 100).toFixed(0) : 'n/a'

  const featureTable = analysis.featureStats
    .map(fs =>
      `${fs.label.padEnd(26)} wins: ${fmt(fs.meanWins, fs.unit).padStart(7)} ${fs.unit.padEnd(7)}` +
      `losses: ${fmt(fs.meanLosses, fs.unit).padStart(7)} ${fs.unit.padEnd(7)}` +
      `diff: ${fs.pctDiff >= 0 ? '+' : ''}${fs.pctDiff.toFixed(0)}%`
    ).join('\n')

  const quartileSection = analysis.quartileStats
    .map(qs => `${qs.label}:\n` + qs.quartiles.map(b => `  ${b.range.padEnd(16)} → ${b.winRate.toFixed(0)}% (n=${b.count})`).join('\n'))
    .join('\n\n')

  const tradeRows = closed.slice(-60).map(t =>
    [t.direction[0].toUpperCase(), t.result[0].toUpperCase(),
     t.bodyPips.toFixed(1), t.wickRatio.toFixed(2), t.breakoutPips.toFixed(1),
     t.prevCandleAligned, t.slPipsActual.toFixed(1), t.minutesSince1pm,
     t.sessionRangePips.toFixed(1), t.preSessionRangePips.toFixed(1),
     t.preSessionTrendPips.toFixed(1), t.onePmRangePosition,
     t.lastHourRangePips.toFixed(1), t.prevDayResult, t.h1TrendBias, t.pnlPips.toFixed(1)].join(',')
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
- preSessionRange: how much ground EUR/USD covered 8am–1pm UK (wide = active day, narrow = dead)
- preSessionTrend: net signed move 8am→1pm UK in pips (positive = bullish into 1pm, negative = bearish)
- onePmPosition%: where 1pm price sits in the 8am–1pm range (100=at the top, 0=at the bottom)
- lastHourRange: volatility 12pm–1pm UK (accelerating into trigger vs calming down)
- prevDayResult: +1=previous day won, -1=previous day lost, 0=no trade previous day
- h1Trend: H1 chart trend at entry time (+1=bullish, -1=bearish, 0=insufficient data)

Please provide:
1. Top 3 features that most strongly separate wins from losses — with specific thresholds suggested as filters
2. Whether H1 trend alignment matters — do trades WITH the H1 trend win significantly more than counter-trend trades?
3. Whether any pre-session condition predicts outcome — should any be a "skip day" condition?
4. Whether a "minimum body size" entry filter would help, and what threshold to use
5. Whether there is a time window within 1pm–3pm where performance is notably better or worse
6. Whether buys or sells perform differently and if a direction filter is warranted
7. Any SL or R:R adjustments the data suggests
8. One sentence summary: is this strategy statistically viable as-is, or does it need a filter first?

Be concise, quantitative, and directly actionable. No generic trading advice.`
}
