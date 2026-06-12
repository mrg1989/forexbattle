import type { Candle } from '../types'
import { toUKHour, toUKDateString } from '../lib/time'

export interface LineOverlay {
  x1Ms:         number   // start timestamp (ms)
  y1:           number   // start price  (ignored when fullHeight; used as box top/bottom when fillZone+priceBound)
  x2Ms:         number   // end timestamp (ms)
  y2:           number   // end price     (ignored when fullHeight; used as box top/bottom when fillZone+priceBound)
  color:        string
  lineWidth?:   number
  dashPattern?: number[]
  label?:       string
  fullHeight?:  boolean  // vertical line spanning full chart height
  fillZone?:    boolean  // filled background rectangle x1→x2
  priceBound?:  boolean  // when true + fillZone: rect is bounded by y1 (top price) and y2 (bottom price)
  fillColor?:   string   // fill color when fillZone=true
  markerType?:  'buy' | 'sell'  // renders entry arrow at (x1Ms, y1)
  tradeResult?: 'win' | 'loss' | 'open'  // renders W/L chip next to arrow
}

// ── Swing-point helpers ───────────────────────────────────────────────────────

function isSwingHigh(candles: Candle[], i: number, lookback: number): boolean {
  const h = candles[i].high
  for (let j = Math.max(0, i - lookback); j <= Math.min(candles.length - 1, i + lookback); j++) {
    if (j !== i && candles[j].high >= h) return false
  }
  return true
}

function isSwingLow(candles: Candle[], i: number, lookback: number): boolean {
  const l = candles[i].low
  for (let j = Math.max(0, i - lookback); j <= Math.min(candles.length - 1, i + lookback); j++) {
    if (j !== i && candles[j].low <= l) return false
  }
  return true
}

// ─────────────────────────────────────────────────────────────────────────────
//  Crossfire Strategy
//
//  Step 1: Identify the 1pm UK candle.
//  Step 2: Find closest swing High (HH) between 8am–1pm. Draw descending green
//          line from its wick to 1pm high, extended to 3pm.
//  Step 3: Find closest swing Low  (LL) between 8am–1pm. Draw ascending red
//          line from its wick to 1pm low, extended to 3pm.
//  Step 4: Background fill 1pm→3pm shows the "crossfire zone".
// ─────────────────────────────────────────────────────────────────────────────

function crossfireForDay(candles: Candle[], onePmIdx: number, _tfMs: number, useBodyLines = false): LineOverlay[] {
  const onePmCandle = candles[onePmIdx]
  const onePmMs     = onePmCandle.timestamp
  const threePmMs   = onePmMs + 2 * 3_600_000
  const onePmDay    = toUKDateString(onePmMs)

  // ── Find London open (8am UK) on same UK calendar day ────────────────────
  let londonOpenMs = -Infinity
  for (let i = onePmIdx; i >= 0; i--) {
    const ts = candles[i].timestamp
    if (toUKDateString(ts) !== onePmDay) break
    if (toUKHour(ts) === 8 && new Date(ts).getMinutes() === 0) { londonOpenMs = candles[i].timestamp; break }
  }
  if (londonOpenMs === -Infinity) {
    for (let i = onePmIdx; i >= 0; i--) {
      const ts = candles[i].timestamp
      if (toUKDateString(ts) !== onePmDay) break
      londonOpenMs = candles[i].timestamp
    }
  }

  // ── London session slice ──────────────────────────────────────────────────
  const session: Candle[] = []
  for (let i = 0; i < onePmIdx; i++) {
    const c = candles[i]
    if (c.timestamp < londonOpenMs) continue
    if (toUKDateString(c.timestamp) !== onePmDay) continue
    session.push(c)
  }
  if (session.length < 3) return []

  // Standard swing-point lookback: 2 candles each side (5-candle local max).
  const lb = 2

  // Body helpers: when useBodyLines, anchor trendlines to candle body edges
  // (body close/open extremes) rather than wick highs/lows. This produces
  // cleaner levels since bodies represent where price "agreed to be".
  const bHigh = (c: Candle) => useBodyLines ? Math.max(c.open, c.close) : c.high
  const bLow  = (c: Candle) => useBodyLines ? Math.min(c.open, c.close) : c.low

  // ── Collect ALL qualifying swing highs above 1pm high ────────────────────
  let hhCandle: Candle | null = null
  for (let si = 0; si < session.length; si++) {
    if (isSwingHigh(session, si, lb) && bHigh(session[si]) > bHigh(onePmCandle)) {
      if (!hhCandle || bHigh(session[si]) > bHigh(hhCandle)) hhCandle = session[si]
    }
  }
  // Fallback: absolute highest candle in the session
  if (!hhCandle) {
    const absHigh = session.reduce((b, c) => bHigh(c) > bHigh(b) ? c : b, session[0])
    if (bHigh(absHigh) > bHigh(onePmCandle)) hhCandle = absHigh
  }

  // ── Collect ALL qualifying swing lows below 1pm low ───────────────────────
  let llCandle: Candle | null = null
  for (let si = 0; si < session.length; si++) {
    if (isSwingLow(session, si, lb) && bLow(session[si]) < bLow(onePmCandle)) {
      if (!llCandle || bLow(session[si]) < bLow(llCandle)) llCandle = session[si]
    }
  }
  // Fallback: absolute lowest candle in the session
  if (!llCandle) {
    const absLow = session.reduce((b, c) => bLow(c) < bLow(b) ? c : b, session[0])
    if (bLow(absLow) < bLow(onePmCandle)) llCandle = absLow
  }

  const lines: LineOverlay[] = []

  // ── Background fill 1pm → 3pm ─────────────────────────────────────────────
  lines.push({
    x1Ms: onePmMs, y1: 0, x2Ms: threePmMs, y2: 0,
    color: 'rgba(139,92,246,0)',
    fillZone: true,
    fillColor: 'rgba(139,92,246,0.055)',
  })

  // ── 1pm / 3pm vertical markers ────────────────────────────────────────────
  lines.push({
    x1Ms: onePmMs, y1: 0, x2Ms: onePmMs, y2: 0,
    color: 'rgba(245,158,11,0.50)', lineWidth: 1, dashPattern: [4,4],
    label: '1pm', fullHeight: true,
  })
  lines.push({
    x1Ms: threePmMs, y1: 0, x2Ms: threePmMs, y2: 0,
    color: 'rgba(245,158,11,0.28)', lineWidth: 1, dashPattern: [2,6],
    label: '3pm', fullHeight: true,
  })

  // ── Upper (green) trendline ───────────────────────────────────────────────
  if (hhCandle !== null) {
    const x1 = hhCandle.timestamp, y1 = bHigh(hhCandle)
    const x2 = onePmMs,            y2 = bHigh(onePmCandle)
    const slope = (y2 - y1) / (x2 - x1)
    lines.push({ x1Ms: x1, y1, x2Ms: threePmMs, y2: y2 + slope * (threePmMs - x2), color: '#22C55E', lineWidth: 1.5, label: 'HH' })
  } else {
    lines.push({ x1Ms: onePmMs, y1: bHigh(onePmCandle), x2Ms: threePmMs, y2: bHigh(onePmCandle), color: '#22C55E', lineWidth: 1.5, dashPattern: [8,4] })
  }

  // ── Lower (red) trendline ─────────────────────────────────────────────────
  if (llCandle !== null) {
    const x1 = llCandle.timestamp, y1 = bLow(llCandle)
    const x2 = onePmMs,            y2 = bLow(onePmCandle)
    const slope = (y2 - y1) / (x2 - x1)
    lines.push({ x1Ms: x1, y1, x2Ms: threePmMs, y2: y2 + slope * (threePmMs - x2), color: '#EF4444', lineWidth: 1.5, label: 'LL' })
  } else {
    lines.push({ x1Ms: onePmMs, y1: bLow(onePmCandle), x2Ms: threePmMs, y2: bLow(onePmCandle), color: '#EF4444', lineWidth: 1.5, dashPattern: [8,4] })
  }

  return lines
}

// ── H1 aggregation helpers ───────────────────────────────────────────────────

/**
 * Build hourStartMs → H1 close price from any resolution candle array.
 * The last candle that falls within each clock hour becomes that hour's close.
 * O(n) — call once and reuse the Map across the session loop.
 */
export function buildH1Closes(candles: Candle[]): Map<number, number> {
  const result = new Map<number, number>()
  for (const c of candles) {
    const d = new Date(c.timestamp)
    const hourStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), 0, 0).getTime()
    result.set(hourStart, c.close)
  }
  return result
}

/**
 * Return the H1 trend direction at a given moment.
 * Looks back up to 10 clock hours, collects the 4 most recent completed H1
 * closes, and compares the oldest to the newest.
 * Returns +1 (bullish), -1 (bearish), 0 (insufficient data).
 */
export function getH1TrendAt(h1Map: Map<number, number>, targetTs: number): -1 | 0 | 1 {
  const oneHourMs = 3_600_000
  const closes: number[] = []
  for (let offset = 1; offset <= 10 && closes.length < 4; offset++) {
    const t = targetTs - offset * oneHourMs
    const d = new Date(t)
    const hs = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), 0, 0).getTime()
    const close = h1Map.get(hs)
    if (close !== undefined) closes.unshift(close)
  }
  if (closes.length < 2) return 0
  return closes[closes.length - 1] > closes[0] ? 1
       : closes[closes.length - 1] < closes[0] ? -1
       : 0
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Crossfire for the most recent 1pm UK candle in the data. */
export function computeCrossfire(candles: Candle[]): LineOverlay[] {
  if (candles.length < 5) return []
  const tfMs = candles.length > 1 ? candles[1].timestamp - candles[0].timestamp : 900_000
  for (let i = candles.length - 1; i >= 0; i--) {
    const ts = candles[i].timestamp
    if (toUKHour(ts) === 13 && new Date(ts).getMinutes() === 0) {
      return crossfireForDay(candles, i, tfMs)
    }
  }
  return []
}

/**
 * Crossfire for the most recent 1pm UK candle + entry/SL/TP projection using
 * current settings. Always draws the risk levels on the live chart so changing
 * SL mode or R:R gives instant visual feedback without needing backtest mode.
 */
export function computeCrossfireWithLevels(
  candles: Candle[],
  settings: BacktestSettings,
): LineOverlay[] {
  if (candles.length < 5) return []
  const tfMs = candles.length > 1 ? candles[1].timestamp - candles[0].timestamp : 900_000

  // Find most recent 1pm UK candle
  let onePmIdx = -1
  for (let i = candles.length - 1; i >= 0; i--) {
    const ts = candles[i].timestamp
    if (toUKHour(ts) === 13 && new Date(ts).getMinutes() === 0) { onePmIdx = i; break }
  }
  if (onePmIdx === -1) return []

  const base   = crossfireForDay(candles, onePmIdx, tfMs)
  const trades = backtestDay(candles, onePmIdx, tfMs, settings)
  return [...base, ...trades.flatMap(toTradeOverlays)]
}

/**
 * Crossfire for EVERY 1pm UK candle in the data (backtest mode).
 * Each trading day gets its own zone + trendlines.
 * Capped at the most recent 60 sessions to prevent rendering overload.
 */
export function computeCrossfireAll(candles: Candle[], useBodyLines = false): LineOverlay[] {
  if (candles.length < 5) return []
  const tfMs = candles.length > 1 ? candles[1].timestamp - candles[0].timestamp : 900_000
  const result: LineOverlay[] = []
  const seenDays = new Set<string>()

  const onePmIndices: number[] = []
  for (let i = candles.length - 1; i >= 0; i--) {
    const ts = candles[i].timestamp
    if (toUKHour(ts) !== 13 || new Date(ts).getMinutes() !== 0) continue
    const dayKey = toUKDateString(ts)
    if (seenDays.has(dayKey)) continue
    seenDays.add(dayKey)
    onePmIndices.push(i)
  }
  for (const idx of onePmIndices) {
    result.push(...crossfireForDay(candles, idx, tfMs, useBodyLines))
  }
  return result
}

// ── Backtest engine ───────────────────────────────────────────────────────────────

export interface BacktestSettings {
  slMode:        'static' | 'dynamic'
  slPips:        number   // static: fixed pips below/above opposite line; dynamic: buffer pips below red (ignored for buy)
  rrRatio:       number   // take profit = SL distance × rrRatio (e.g. 1.5, 2, 3)
  pipSize:       number
  requireFullBody?: boolean  // when true: both open AND close must clear the trendline (no partial body entries)
}

export interface BacktestTrade {
  direction:   'buy' | 'sell'
  sessionDate: string
  entryTs:     number
  entryPrice:  number
  slPrice:     number
  tpPrice:     number
  exitTs:      number | null
  result:      'win' | 'loss' | 'open'
  pnlPips:     number
}

export interface BacktestStats {
  trades:          number
  wins:            number
  losses:          number
  openTrades:      number
  winRate:         number   // 0–100
  avgWin:          number   // pips
  avgLoss:         number   // pips (positive)
  rr:              number   // avgWin / avgLoss
  expectancy:      number   // expected pips per trade
  sessionsScanned: number   // total 1pm sessions looked at
  noSetupSessions: number   // sessions where Crossfire never triggered (no line break)
  filteredSetups:  number   // sessions where Crossfire fired but ALL entries were filtered out
  dateFrom?:       string   // earliest trade date (display)
  dateTo?:         string   // most recent trade date (display)
}

export interface BacktestResult {
  overlays: LineOverlay[]
  trades:   BacktestTrade[]
  stats:    BacktestStats
}

function linePriceAt(x1Ms: number, y1: number, x2Ms: number, y2: number, t: number): number {
  const span = x2Ms - x1Ms
  return span === 0 ? y1 : y1 + (y2 - y1) * (t - x1Ms) / span
}

function toTradeOverlays(trade: BacktestTrade): LineOverlay[] {
  // SL/TP lines run until the actual exit; fallback = 8 hours after entry
  const endTs    = trade.exitTs ?? (trade.entryTs + 8 * 3_600_000)
  const col      = trade.direction === 'buy' ? '#22C55E' : '#EF4444'
  const slHit    = trade.result === 'loss'
  const tpHit    = trade.result === 'win'
  return [
    // Entry arrow + W/L chip
    { x1Ms: trade.entryTs, y1: trade.entryPrice,
      x2Ms: trade.entryTs, y2: trade.entryPrice,
      color: col, markerType: trade.direction, tradeResult: trade.result },
    // SL line — brighter / solid when it got hit
    { x1Ms: trade.entryTs, y1: trade.slPrice,
      x2Ms: endTs,         y2: trade.slPrice,
      color: slHit ? 'rgba(239,68,68,0.9)' : 'rgba(239,68,68,0.45)',
      lineWidth: slHit ? 1.5 : 1,
      dashPattern: slHit ? [] : [3,4],
      label: slHit ? '✗ SL' : 'SL' },
    // TP line — brighter / solid when it got hit
    { x1Ms: trade.entryTs, y1: trade.tpPrice,
      x2Ms: endTs,         y2: trade.tpPrice,
      color: tpHit ? 'rgba(34,197,94,0.9)' : 'rgba(34,197,94,0.45)',
      lineWidth: tpHit ? 1.5 : 1,
      dashPattern: tpHit ? [] : [3,4],
      label: tpHit ? '✓ TP' : 'TP' },
  ]
}

function calcStats(trades: BacktestTrade[], sessionsScanned = 0, filteredSetups = 0): BacktestStats {
  const wins   = trades.filter(t => t.result === 'win')
  const losses = trades.filter(t => t.result === 'loss')
  const closed = wins.length + losses.length
  const winRate    = closed > 0 ? (wins.length / closed) * 100 : 0
  const avgWin     = wins.length   > 0 ? wins.reduce((s,t) => s + t.pnlPips, 0) / wins.length : 0
  const avgLoss    = losses.length > 0 ? -losses.reduce((s,t) => s + t.pnlPips, 0) / losses.length : 0
  const rr         = avgLoss > 0 ? avgWin / avgLoss : 0
  const expectancy = (winRate / 100) * avgWin - (1 - winRate / 100) * avgLoss
  const noSetupSessions = Math.max(0, sessionsScanned - trades.length - filteredSetups)
  const fmtDate = (ts: number) => new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })
  const sortedTs = [...trades].sort((a, b) => a.entryTs - b.entryTs)
  const dateFrom = sortedTs.length > 0 ? fmtDate(sortedTs[0].entryTs) : undefined
  const dateTo   = sortedTs.length > 0 ? fmtDate(sortedTs[sortedTs.length - 1].entryTs) : undefined
  return { trades: trades.length, wins: wins.length, losses: losses.length,
           openTrades: trades.filter(t => t.result === 'open').length,
           winRate, avgWin, avgLoss, rr, expectancy,
           sessionsScanned, noSetupSessions, filteredSetups, dateFrom, dateTo }
}

function backtestDay(
  candles: Candle[], onePmIdx: number, tfMs: number, settings: BacktestSettings
): BacktestTrade[] {
  const dayOverlays = crossfireForDay(candles, onePmIdx, tfMs)
  const greenLine   = dayOverlays.find(o => o.color === '#22C55E' && !o.fullHeight && !o.fillZone)
  const redLine     = dayOverlays.find(o => o.color === '#EF4444' && !o.fullHeight && !o.fillZone)
  if (!greenLine || !redLine) return []

  const onePmMs     = candles[onePmIdx].timestamp
  const threePmMs   = onePmMs + 2 * 3_600_000
  const sessionDate = new Date(onePmMs).toDateString()
  const { slMode, slPips, rrRatio, pipSize, requireFullBody } = settings

  for (let i = onePmIdx + 1; i < candles.length; i++) {
    const c = candles[i]
    if (c.timestamp >= threePmMs) break

    const gl = linePriceAt(greenLine.x1Ms, greenLine.y1, greenLine.x2Ms, greenLine.y2, c.timestamp)
    const rl = linePriceAt(redLine.x1Ms,   redLine.y1,   redLine.x2Ms,   redLine.y2,   c.timestamp)

    // Entry check: optionally require the full candle body to clear the line,
    // not just the close. This filters out weak partial-body closes.
    let direction: 'buy' | 'sell' | null
    if (requireFullBody) {
      direction = (c.open > gl && c.close > gl) ? 'buy'
                : (c.open < rl && c.close < rl) ? 'sell'
                : null
    } else {
      direction = c.close > gl ? 'buy' : c.close < rl ? 'sell' : null
    }
    if (!direction) continue

    const entry = c.close
    let slPrice: number, tpPrice: number

    if (direction === 'buy') {
      // SL is below the red support line
      if (slMode === 'static') {
        // Option 1: fixed pips below red line
        slPrice = rl - slPips * pipSize
      } else {
        // Option 2: entry-to-red distance mirrored below red line
        const dist = Math.max(entry - rl, pipSize)   // entry above red line
        slPrice = rl - dist
      }
      const slDistance = entry - slPrice
      tpPrice = entry + slDistance * rrRatio
    } else {
      // Sell: SL is above the green resistance line
      if (slMode === 'static') {
        // Option 1: fixed pips above green line
        slPrice = gl + slPips * pipSize
      } else {
        // Option 2: entry-to-green distance mirrored above green line
        const dist = Math.max(gl - entry, pipSize)   // entry below green line
        slPrice = gl + dist
      }
      const slDistance = slPrice - entry
      tpPrice = entry - slDistance * rrRatio
    }

    const slPipsActual = Math.abs(entry - slPrice) / pipSize
    const tpPipsActual = Math.abs(entry - tpPrice) / pipSize

    let result: 'win' | 'loss' | 'open' = 'open'
    let exitTs: number | null = null
    let pnlPips = 0

    // Scan to end of all data — NO 3pm cap on the exit.
    // Entry window closes at 3pm, but the trade itself runs until SL/TP or data ends.
    for (let j = i + 1; j < candles.length; j++) {
      const fc = candles[j]
      if (direction === 'buy') {
        if (fc.low  <= slPrice) { result = 'loss'; exitTs = fc.timestamp; pnlPips = -slPipsActual; break }
        if (fc.high >= tpPrice) { result = 'win';  exitTs = fc.timestamp; pnlPips =  tpPipsActual; break }
      } else {
        if (fc.high >= slPrice) { result = 'loss'; exitTs = fc.timestamp; pnlPips = -slPipsActual; break }
        if (fc.low  <= tpPrice) { result = 'win';  exitTs = fc.timestamp; pnlPips =  tpPipsActual; break }
      }
      if (j === candles.length - 1) {
        // Reached end of loaded data without hitting SL or TP — mark open
        pnlPips = direction === 'buy' ? (fc.close - entry) / pipSize : (entry - fc.close) / pipSize
        exitTs  = fc.timestamp
      }
    }

    // One trade per session
    return [{ direction, sessionDate, entryTs: c.timestamp, entryPrice: entry,
               slPrice, tpPrice, exitTs, result, pnlPips }]
  }
  return []
}

/**
 * Run a full Crossfire backtest across every available trading day.
 * Returns trendline overlays + entry/SL/TP markers and aggregated stats.
 */
export function runCrossfireBacktest(candles: Candle[], settings: BacktestSettings): BacktestResult {
  const empty: BacktestStats = { trades:0, wins:0, losses:0, openTrades:0,
                                  winRate:0, avgWin:0, avgLoss:0, rr:0, expectancy:0,
                                  sessionsScanned:0, noSetupSessions:0, filteredSetups:0 }
  if (candles.length < 5) return { overlays: [], trades: [], stats: empty }

  const tfMs         = candles.length > 1 ? candles[1].timestamp - candles[0].timestamp : 900_000
  const baseOverlays = computeCrossfireAll(candles)
  const trades: BacktestTrade[] = []
  const seenDays = new Set<string>()

  const onePmIndices: number[] = []
  for (let i = candles.length - 1; i >= 0; i--) {
    const ts = candles[i].timestamp
    if (toUKHour(ts) !== 13 || new Date(ts).getMinutes() !== 0) continue
    const dayKey = toUKDateString(ts)
    if (seenDays.has(dayKey)) continue
    seenDays.add(dayKey)
    onePmIndices.push(i)
  }
  for (const idx of onePmIndices) {
    trades.push(...backtestDay(candles, idx, tfMs, settings))
  }

  return {
    overlays: [...baseOverlays, ...trades.flatMap(toTradeOverlays)],
    trades,
    stats: calcStats(trades, onePmIndices.length, 0),
  }
}

// ── Crossfire AI Strategy ─────────────────────────────────────────────────────

export interface CrossfireAiSettings {
  rrRatio:               number   // R:R target
  pipSize:               number
  minBodyPips:           number   // minimum entry candle body
  maxBodyPips?:          number   // maximum entry candle body (>6.9p → 0% WR in dataset)
  maxWickRatio:          number   // wick/body cap (0.10 = strong directional candles only)
  minMinutes:            number   // minimum minutes since 1pm before entering
  maxMinutes?:           number   // cap entry window (data: >50min → 22% WR vs 68% before)
  maxSlPips:             number   // SL cap in pips
  useBodyLines?:         boolean  // anchor trendlines to candle bodies instead of wicks
  requireTrendAlignment?: boolean // only take trades aligned with the H1 trend direction
  requireCounterTrend?:  boolean  // only take trades COUNTER to the H1 trend (reversal mode)
  requirePrevAligned?:   boolean  // require previous candle to move in trade direction
  filterBuysCounterH1?:  boolean  // buys only when H1 is bearish (counter-trend buys)
  tradeDirection?:       'both' | 'buy' | 'sell'  // restrict to one direction
  skipBearishDrift?:     boolean  // skip days where 8am→1pm trend is between -20 and -6 pips
  requirePrevDayWin?:    boolean  // only trade after a winning session
}

export const CROSSFIRE_AI_DEFAULTS: CrossfireAiSettings = {
  rrRatio:               3,
  pipSize:               0.0001,
  minBodyPips:           1.5,
  maxBodyPips:           20,
  maxWickRatio:          0.10,
  minMinutes:            15,
  maxMinutes:            195,
  maxSlPips:             20,
  useBodyLines:          false,
  requireTrendAlignment: false,
  requireCounterTrend:   false,
  requirePrevAligned:    true,
  filterBuysCounterH1:   true,
  tradeDirection:        'both',
  skipBearishDrift:      true,
}

function backtestDayAi(
  candles: Candle[], onePmIdx: number, tfMs: number,
  settings: CrossfireAiSettings,
  h1Map: Map<number, number>,
  prevResult: 'win' | 'loss' | 'open' | null = null,
): { trades: BacktestTrade[], hadRawSetup: boolean } {
  const { rrRatio, pipSize, minBodyPips, maxWickRatio, minMinutes, maxSlPips,
          useBodyLines = false, requireTrendAlignment = false,
          requireCounterTrend = false, requirePrevAligned = false,
          maxBodyPips, filterBuysCounterH1 = false,
          tradeDirection = 'both', maxMinutes, skipBearishDrift = false,
          requirePrevDayWin = false } = settings

  if (requirePrevDayWin && prevResult !== 'win') return { trades: [], hadRawSetup: false }
  const dayOverlays = crossfireForDay(candles, onePmIdx, tfMs, useBodyLines)
  const greenLine   = dayOverlays.find(o => o.color === '#22C55E' && !o.fullHeight && !o.fillZone)
  const redLine     = dayOverlays.find(o => o.color === '#EF4444' && !o.fullHeight && !o.fillZone)
  if (!greenLine || !redLine) return { trades: [], hadRawSetup: false }

  const onePmMs     = candles[onePmIdx].timestamp
  const threePmMs   = onePmMs + 2 * 3_600_000
  const sessionDate = new Date(onePmMs).toDateString()
  let hadRawSetup   = false

  if (skipBearishDrift) {
    const ukDay = toUKDateString(onePmMs)
    let eightAmOpen: number | null = null
    let onePmClose: number | null = null
    for (let k = 0; k < candles.length; k++) {
      const c = candles[k]
      if (toUKHour(c.timestamp) === 8 && new Date(c.timestamp).getMinutes() === 0 &&
          toUKDateString(c.timestamp) === ukDay && eightAmOpen === null) {
        eightAmOpen = c.open
      }
      if (c.timestamp === onePmMs) { onePmClose = c.close; break }
    }
    if (eightAmOpen !== null && onePmClose !== null) {
      const trend = (onePmClose - eightAmOpen) / pipSize
      if (trend >= -20 && trend <= -6) return { trades: [], hadRawSetup: false }
    }
  }

  for (let i = onePmIdx + 1; i < candles.length; i++) {
    const c = candles[i]
    if (c.timestamp >= threePmMs) break

    const minsSince1pm = (c.timestamp - onePmMs) / 60_000
    if (minsSince1pm < minMinutes) continue
    if (maxMinutes !== undefined && minsSince1pm > maxMinutes) break

    const gl = linePriceAt(greenLine.x1Ms, greenLine.y1, greenLine.x2Ms, greenLine.y2, c.timestamp)
    const rl = linePriceAt(redLine.x1Ms,   redLine.y1,   redLine.x2Ms,   redLine.y2,   c.timestamp)

    const direction: 'buy' | 'sell' | null =
      c.close > gl ? 'buy' : c.close < rl ? 'sell' : null
    if (!direction) continue

    hadRawSetup = true

    if (tradeDirection !== 'both' && direction !== tradeDirection) continue

    if (filterBuysCounterH1 && direction === 'buy') {
      const h1Trend = getH1TrendAt(h1Map, c.timestamp)
      if (h1Trend === 1) continue
    }

    if (requireTrendAlignment) {
      const h1Trend = getH1TrendAt(h1Map, c.timestamp)
      if (h1Trend !== 0 && h1Trend !== (direction === 'buy' ? 1 : -1)) continue
    }

    if (requireCounterTrend) {
      const h1Trend = getH1TrendAt(h1Map, c.timestamp)
      if (h1Trend !== 0 && h1Trend === (direction === 'buy' ? 1 : -1)) continue
    }

    const bodyPips  = Math.abs(c.close - c.open) / pipSize
    const rangePips = (c.high - c.low) / pipSize
    const wickPips  = Math.max(0, rangePips - bodyPips)
    const wickRatio = bodyPips > 0 ? wickPips / bodyPips : 999
    if (wickRatio > maxWickRatio) continue
    if (bodyPips < minBodyPips) continue
    if (maxBodyPips !== undefined && maxBodyPips > 0 && bodyPips > maxBodyPips) continue

    if (requirePrevAligned && i > 0) {
      const prevC  = candles[i - 1]
      const prevUp = prevC.close > prevC.open
      if (!((direction === 'buy' && prevUp) || (direction === 'sell' && !prevUp))) continue
    }

    const entry = c.close
    let slPrice: number
    if (direction === 'buy') {
      const dist = Math.max(entry - rl, pipSize)
      slPrice = rl - dist
    } else {
      const dist = Math.max(gl - entry, pipSize)
      slPrice = gl + dist
    }

    const rawSlPips = Math.abs(entry - slPrice) / pipSize
    if (rawSlPips > maxSlPips) {
      slPrice = direction === 'buy'
        ? entry - maxSlPips * pipSize
        : entry + maxSlPips * pipSize
    }

    const slPipsActual = Math.abs(entry - slPrice) / pipSize
    const tpPipsActual = slPipsActual * rrRatio
    const tpPrice = direction === 'buy'
      ? entry + tpPipsActual * pipSize
      : entry - tpPipsActual * pipSize

    let result: 'win' | 'loss' | 'open' = 'open'
    let exitTs: number | null = null
    let pnlPips = 0

    for (let j = i + 1; j < candles.length; j++) {
      const fc = candles[j]
      if (direction === 'buy') {
        if (fc.low  <= slPrice) { result = 'loss'; exitTs = fc.timestamp; pnlPips = -slPipsActual; break }
        if (fc.high >= tpPrice) { result = 'win';  exitTs = fc.timestamp; pnlPips =  tpPipsActual; break }
      } else {
        if (fc.high >= slPrice) { result = 'loss'; exitTs = fc.timestamp; pnlPips = -slPipsActual; break }
        if (fc.low  <= tpPrice) { result = 'win';  exitTs = fc.timestamp; pnlPips =  tpPipsActual; break }
      }
      if (j === candles.length - 1) {
        pnlPips = direction === 'buy' ? (fc.close - entry) / pipSize : (entry - fc.close) / pipSize
        exitTs  = fc.timestamp
      }
    }

    return { trades: [{ direction, sessionDate, entryTs: c.timestamp, entryPrice: entry,
               slPrice, tpPrice, exitTs, result, pnlPips }], hadRawSetup: true }
  }
  return { trades: [], hadRawSetup }
}

export function runCrossfireAiBacktest(
  candles: Candle[],
  settings: CrossfireAiSettings,
): BacktestResult {
  const empty: BacktestStats = { trades:0, wins:0, losses:0, openTrades:0,
                                  winRate:0, avgWin:0, avgLoss:0, rr:0, expectancy:0,
                                  sessionsScanned:0, noSetupSessions:0, filteredSetups:0 }
  if (candles.length < 5) return { overlays: [], trades: [], stats: empty }

  const tfMs         = candles.length > 1 ? candles[1].timestamp - candles[0].timestamp : 900_000
  const baseOverlays = computeCrossfireAll(candles, settings.useBodyLines)
  const h1Map        = buildH1Closes(candles)
  const trades: BacktestTrade[] = []
  let filteredSetups = 0
  const seenDays = new Set<string>()

  const onePmIndices: number[] = []
  for (let i = candles.length - 1; i >= 0; i--) {
    const ts = candles[i].timestamp
    if (toUKHour(ts) !== 13 || new Date(ts).getMinutes() !== 0) continue
    const dayKey = toUKDateString(ts)
    if (seenDays.has(dayKey)) continue
    seenDays.add(dayKey)
    onePmIndices.push(i)
  }
  for (const idx of onePmIndices) {
    const lastResult = trades.length > 0 ? trades[trades.length - 1].result : null
    const { trades: dayTrades, hadRawSetup } = backtestDayAi(candles, idx, tfMs, settings, h1Map, lastResult)
    if (dayTrades.length > 0) {
      trades.push(...dayTrades)
    } else if (hadRawSetup) {
      filteredSetups++
    }
  }

  return {
    overlays: [...baseOverlays, ...trades.flatMap(toTradeOverlays)],
    trades,
    stats: calcStats(trades, onePmIndices.length, filteredSetups),
  }
}

// ── Live signal evaluator ─────────────────────────────────────────────────────

export interface LiveSignal {
  pair:        string
  direction:   'buy' | 'sell'
  entry:       number
  sl:          number
  tp:          number
  slPips:      number
  tpPips:      number
  timestamp:   number
}

export function evaluateLiveSignal(
  candles:     Candle[],
  liveCandle:  Candle,
  settings:    CrossfireAiSettings,
  pair:        string,
): LiveSignal | null {
  if (candles.length < 5) return null

  const tfMs = candles.length > 1 ? candles[1].timestamp - candles[0].timestamp : 900_000
  const { rrRatio, pipSize, minBodyPips, maxWickRatio, minMinutes, maxSlPips,
          useBodyLines = false, maxBodyPips, filterBuysCounterH1 = false,
          tradeDirection = 'both', maxMinutes, skipBearishDrift = false,
          requirePrevAligned = false, requireTrendAlignment = false,
          requireCounterTrend = false } = settings

  let onePmIdx = -1
  for (let i = candles.length - 1; i >= 0; i--) {
    const ts = candles[i].timestamp
    if (toUKHour(ts) === 13 && new Date(ts).getMinutes() === 0) { onePmIdx = i; break }
  }
  if (onePmIdx === -1) return null

  const onePmMs  = candles[onePmIdx].timestamp
  const threePmMs = onePmMs + 2 * 3_600_000
  const nowMs    = liveCandle.timestamp

  if (nowMs < onePmMs || nowMs >= threePmMs) return null

  const minsSince1pm = (nowMs - onePmMs) / 60_000
  if (minsSince1pm < minMinutes) return null
  if (maxMinutes !== undefined && minsSince1pm > maxMinutes) return null

  if (skipBearishDrift) {
    const ukDay = toUKDateString(onePmMs)
    let eightAmOpen: number | null = null
    let onePmClose: number | null = null
    for (const c of candles) {
      if (toUKHour(c.timestamp) === 8 && new Date(c.timestamp).getMinutes() === 0 &&
          toUKDateString(c.timestamp) === ukDay && eightAmOpen === null) {
        eightAmOpen = c.open
      }
      if (c.timestamp === onePmMs) { onePmClose = c.close; break }
    }
    if (eightAmOpen !== null && onePmClose !== null) {
      const trend = (onePmClose - eightAmOpen) / pipSize
      if (trend >= -20 && trend <= -6) return null
    }
  }

  const dayOverlays = crossfireForDay(candles, onePmIdx, tfMs, useBodyLines)
  const greenLine   = dayOverlays.find(o => o.color === '#22C55E' && !o.fullHeight && !o.fillZone)
  const redLine     = dayOverlays.find(o => o.color === '#EF4444' && !o.fullHeight && !o.fillZone)
  if (!greenLine || !redLine) return null

  const c  = liveCandle
  const gl = linePriceAt(greenLine.x1Ms, greenLine.y1, greenLine.x2Ms, greenLine.y2, c.timestamp)
  const rl = linePriceAt(redLine.x1Ms,   redLine.y1,   redLine.x2Ms,   redLine.y2,   c.timestamp)

  const direction: 'buy' | 'sell' | null =
    c.close > gl ? 'buy' : c.close < rl ? 'sell' : null
  if (!direction) return null

  if (tradeDirection !== 'both' && direction !== tradeDirection) return null

  const bodyPips  = Math.abs(c.close - c.open) / pipSize
  const rangePips = (c.high - c.low) / pipSize
  const wickPips  = Math.max(0, rangePips - bodyPips)
  const wickRatio = bodyPips > 0 ? wickPips / bodyPips : 999
  if (wickRatio > maxWickRatio) return null
  if (bodyPips < minBodyPips) return null
  if (maxBodyPips !== undefined && maxBodyPips > 0 && bodyPips > maxBodyPips) return null

  const h1Map = buildH1Closes(candles)
  if (filterBuysCounterH1 && direction === 'buy') {
    if (getH1TrendAt(h1Map, c.timestamp) === 1) return null
  }
  if (requireTrendAlignment) {
    const h1 = getH1TrendAt(h1Map, c.timestamp)
    if (h1 !== 0 && h1 !== (direction === 'buy' ? 1 : -1)) return null
  }
  if (requireCounterTrend) {
    const h1 = getH1TrendAt(h1Map, c.timestamp)
    if (h1 !== 0 && h1 === (direction === 'buy' ? 1 : -1)) return null
  }

  if (requirePrevAligned) {
    const prevC = candles[candles.length - 1]
    const prevUp = prevC.close > prevC.open
    if (!((direction === 'buy' && prevUp) || (direction === 'sell' && !prevUp))) return null
  }

  const entry = c.close
  let slPrice: number
  if (direction === 'buy') {
    const dist = Math.max(entry - rl, pipSize)
    slPrice = rl - dist
  } else {
    const dist = Math.max(gl - entry, pipSize)
    slPrice = gl + dist
  }
  const rawSlPips = Math.abs(entry - slPrice) / pipSize
  if (rawSlPips > maxSlPips) {
    slPrice = direction === 'buy'
      ? entry - maxSlPips * pipSize
      : entry + maxSlPips * pipSize
  }
  const slPipsActual = Math.abs(entry - slPrice) / pipSize
  const tpPipsActual = slPipsActual * rrRatio
  const tpPrice = direction === 'buy'
    ? entry + tpPipsActual * pipSize
    : entry - tpPipsActual * pipSize

  return { pair, direction, entry, sl: slPrice, tp: tpPrice,
           slPips: slPipsActual, tpPips: tpPipsActual, timestamp: c.timestamp }
}
