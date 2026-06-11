/**
 * SMC Order Block Strategy
 *
 * Detects Smart Money Concepts / Order Block setups on M5 candles:
 *
 *  1. LIQUIDITY SWEEP: price wicks below a recent swing low (or above swing high)
 *     then CLOSES back on the other side in the same or next candle.
 *     → The wick tip is the "liquidity grab" — institutions knocked out retail stops.
 *
 *  2. ORDER BLOCK: the last opposite-colour candle before the sweep impulse.
 *     e.g. for a bullish sweep: the last bearish candle before the big up move.
 *     This is where institutions loaded positions.
 *
 *  3. FIBONACCI ZONE: 50%–79% retracement of the sweep move (swing low → reversal high).
 *     Price must pull back into this zone after the sweep.
 *
 *  4. ENTRY: first candle that closes inside the Fib zone after the retracement.
 *     Confirmation: that candle must close in the trade direction (bullish close for longs).
 *
 *  5. SL: below the sweep wick tip (+ small buffer)
 *  6. TP: 1:3 R:R default (configurable)
 */

import type { Candle } from '../types'
import type { LineOverlay } from './strategies'

// ── Settings ──────────────────────────────────────────────────────────────────

export interface SmcSettings {
  rrRatio:         number   // risk:reward (default 3)
  pipSize:         number   // 0.0001 for most pairs
  swingLookback:   number   // candles each side to confirm a swing (default 5)
  minSweepPips:    number   // wick must sweep at least this many pips past the swing (default 2)
  maxEntryBars:    number   // max candles after sweep to wait for entry (default 50)
  fib50:           number   // lower Fib level (default 0.50)
  fib79:           number   // upper Fib level (default 0.786)
  minSlPips:       number   // minimum SL distance in pips (default 3)
  maxSlPips:       number   // maximum SL distance in pips (default 25)
  sessionStart:    number   // hour (0–23) to start looking for setups (default 7)
  sessionEnd:      number   // hour (0–23) to stop looking for setups (default 17)
}

export const SMC_DEFAULTS: SmcSettings = {
  rrRatio:       3,
  pipSize:       0.0001,
  swingLookback: 5,
  minSweepPips:  2,
  maxEntryBars:  50,
  fib50:         0.50,
  fib79:         0.786,
  minSlPips:     3,
  maxSlPips:     25,
  sessionStart:  7,
  sessionEnd:    17,
}

// ── Trade result types ────────────────────────────────────────────────────────

export interface SmcTrade {
  direction:     'buy' | 'sell'
  sessionDate:   string
  sweepTs:       number    // timestamp of the sweep candle
  sweepWickTip:  number    // the wick extreme (lowest low for bull sweep, highest high for bear)
  swingLevel:    number    // the swing low/high that was swept
  obHigh:        number    // order block top
  obLow:         number    // order block bottom
  fib50Price:    number    // 50% retrace level
  fib79Price:    number    // 79% retrace level
  entryTs:       number
  entryPrice:    number
  slPrice:       number
  tpPrice:       number
  exitTs:        number | null
  result:        'win' | 'loss' | 'open'
  pnlPips:       number
}

export interface SmcBacktestResult {
  trades:    SmcTrade[]
  overlays:  LineOverlay[]
  stats: {
    trades:          number
    wins:            number
    losses:          number
    openTrades:      number
    winRate:         number
    avgWinPips:      number
    avgLossPips:     number
    expectancyPips:  number
    dateFrom?:       string
    dateTo?:         string
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function bHigh(c: Candle) { return Math.max(c.open, c.close) }
function bLow (c: Candle) { return Math.min(c.open, c.close) }

function isSwingLow(candles: Candle[], idx: number, lb: number): boolean {
  const low = candles[idx].low
  for (let k = Math.max(0, idx - lb); k <= Math.min(candles.length - 1, idx + lb); k++) {
    if (k !== idx && candles[k].low <= low) return false
  }
  return true
}

function isSwingHigh(candles: Candle[], idx: number, lb: number): boolean {
  const high = candles[idx].high
  for (let k = Math.max(0, idx - lb); k <= Math.min(candles.length - 1, idx + lb); k++) {
    if (k !== idx && candles[k].high >= high) return false
  }
  return true
}

// ── Overlay builders ──────────────────────────────────────────────────────────

function tradeToOverlays(trade: SmcTrade, endMs: number): LineOverlay[] {
  const lines: LineOverlay[] = []
  const exitMs = trade.exitTs ?? endMs
  const col    = trade.direction === 'buy' ? '#22C55E' : '#EF4444'
  const slHit  = trade.result === 'loss'
  const tpHit  = trade.result === 'win'

  // SL line
  lines.push({
    x1Ms: trade.entryTs, y1: trade.slPrice,
    x2Ms: exitMs,        y2: trade.slPrice,
    color: 'rgba(239,68,68,0.55)', lineWidth: 1,
    dashPattern: slHit ? [] : [3,4],
    label: slHit ? '✗ SL' : 'SL',
  })
  // TP line
  lines.push({
    x1Ms: trade.entryTs, y1: trade.tpPrice,
    x2Ms: exitMs,        y2: trade.tpPrice,
    color: 'rgba(34,197,94,0.55)', lineWidth: 1,
    dashPattern: tpHit ? [] : [3,4],
    label: tpHit ? '✓ TP' : 'TP',
  })
  // Entry arrow
  lines.push({
    x1Ms: trade.entryTs, y1: trade.entryPrice,
    x2Ms: trade.entryTs, y2: trade.entryPrice,
    color: col, lineWidth: 1,
    markerType: trade.direction === 'buy' ? 'buy' : 'sell',
    tradeResult: trade.result,
  })

  return lines
}

function setupToOverlays(trade: SmcTrade, settings: SmcSettings): LineOverlay[] {
  const lines: LineOverlay[] = []
  const endMs = trade.sweepTs + 8 * 3_600_000   // draw overlays for 8 hours

  // Order block box
  lines.push({
    x1Ms: trade.sweepTs, y1: trade.obHigh,
    x2Ms: endMs,         y2: trade.obLow,
    color: trade.direction === 'buy' ? 'rgba(34,197,94,0.6)' : 'rgba(239,68,68,0.6)',
    lineWidth: 1,
    fillZone: true, priceBound: true,
    fillColor: trade.direction === 'buy' ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
    label: 'OB',
  })

  // Fib 50% level
  lines.push({
    x1Ms: trade.sweepTs, y1: trade.fib50Price,
    x2Ms: endMs,         y2: trade.fib50Price,
    color: 'rgba(245,158,11,0.5)', lineWidth: 1, dashPattern: [4, 3],
    label: '50%',
  })

  // Fib 79% level
  lines.push({
    x1Ms: trade.sweepTs, y1: trade.fib79Price,
    x2Ms: endMs,         y2: trade.fib79Price,
    color: 'rgba(245,158,11,0.75)', lineWidth: 1, dashPattern: [4, 3],
    label: '79%',
  })

  // Fib zone fill between 50% and 79%
  lines.push({
    x1Ms: trade.sweepTs, y1: Math.max(trade.fib50Price, trade.fib79Price),
    x2Ms: endMs,         y2: Math.min(trade.fib50Price, trade.fib79Price),
    color: 'rgba(245,158,11,0.4)', lineWidth: 0,
    fillZone: true, priceBound: true,
    fillColor: 'rgba(245,158,11,0.06)',
  })

  // Sweep wick tip marker (liquidity grab level)
  lines.push({
    x1Ms: trade.sweepTs - 10 * 60_000, y1: trade.sweepWickTip,
    x2Ms: endMs,                        y2: trade.sweepWickTip,
    color: 'rgba(139,92,246,0.5)', lineWidth: 1, dashPattern: [2, 5],
    label: 'Grab',
  })

  return lines
}

// ── Core detection engine ─────────────────────────────────────────────────────
//
// Algorithm (correct SMC sweep logic):
//
//  For each candle i (the potential sweep candle):
//    → Look BACK up to swingSearchBars candles to find recent confirmed swing lows/highs
//    → A confirmed swing low at index k means: candle k has the lowest LOW
//      in the window [k-lb .. k+lb], AND k+lb < i (fully confirmed, no future overlap)
//    → If candle i wicks BELOW that swing low (and closes back ABOVE it) → bullish sweep
//    → Find order block: last BEARISH candle before i (in previous ~10 candles)
//    → Fib levels: sweep wick tip → sweep candle high (or nearby impulse high)
//    → Look ahead for a retracement entry in the 50–79% zone

export function runSmcBacktest(
  candles: Candle[],
  settings: SmcSettings = SMC_DEFAULTS,
): SmcBacktestResult {
  const empty = { trades: 0, wins: 0, losses: 0, openTrades: 0,
                  winRate: 0, avgWinPips: 0, avgLossPips: 0, expectancyPips: 0 }
  if (candles.length < 20) return { trades: [], overlays: [], stats: empty }

  const { pipSize, swingLookback: lb, minSweepPips, maxEntryBars,
          fib50, fib79, minSlPips, maxSlPips, sessionStart, sessionEnd, rrRatio } = settings

  // How far back to search for a swing level to sweep
  const swingSearchBars = 80

  const trades: SmcTrade[]      = []
  const overlays: LineOverlay[] = []
  const usedSweepTs = new Set<number>()

  for (let i = lb * 2 + 1; i < candles.length - 1; i++) {
    const c  = candles[i]
    const hr = new Date(c.timestamp).getHours()
    if (hr < sessionStart || hr >= sessionEnd) continue
    if (usedSweepTs.has(c.timestamp)) continue

    // Skip if there's already an active (open) trade — one at a time
    const lastTrade = trades.length > 0 ? trades[trades.length - 1] : null
    if (lastTrade && lastTrade.result === 'open') continue
    if (lastTrade && lastTrade.exitTs !== null && c.timestamp < lastTrade.exitTs) continue

    // ── Bullish setup: candle i wicks below a recent confirmed swing low ────
    {
      // Find most recent confirmed swing low strictly before candle i
      let swingPrice = Infinity
      let swingIdx   = -1
      const searchFrom = Math.max(lb, i - swingSearchBars)
      for (let k = i - lb - 1; k >= searchFrom; k--) {
        // Confirmed: k+lb < i ensures the right side is fully confirmed before i
        if (k + lb >= i) continue
        if (isSwingLow(candles, k, lb)) {
          swingPrice = candles[k].low
          swingIdx   = k
          break   // take the most recent confirmed swing low
        }
      }

      if (swingIdx >= 0 && c.low < swingPrice && c.close > swingPrice) {
        const sweepPips = (swingPrice - c.low) / pipSize
        if (sweepPips >= minSweepPips) {
          const sweepWickTip = c.low
          // Impulse high: highest high in this candle and next 2
          let impulseHigh = c.high
          for (let k = i + 1; k <= Math.min(i + 3, candles.length - 1); k++) {
            impulseHigh = Math.max(impulseHigh, candles[k].high)
          }

          // Order block: last bearish candle in the 15 candles before i
          let obIdx = i - 1
          while (obIdx > Math.max(0, i - 15) && candles[obIdx].close >= candles[obIdx].open) obIdx--
          const ob = candles[Math.max(0, obIdx)]

          // Fib levels: from wick tip up to impulse high
          const move       = impulseHigh - sweepWickTip
          const fib50Price = impulseHigh - move * fib50
          const fib79Price = impulseHigh - move * fib79
          const zoneHigh   = Math.max(fib50Price, fib79Price)
          const zoneLow    = Math.min(fib50Price, fib79Price)

          // Look ahead for bullish close inside the Fib zone
          let entryCandle: Candle | null = null
          let entryIdx = -1
          for (let k = i + 1; k <= Math.min(i + maxEntryBars, candles.length - 1); k++) {
            const fc = candles[k]
            // Invalidate if price goes below the sweep wick
            if (fc.low < sweepWickTip - pipSize) break
            // Entry: bullish close inside zone
            if (fc.close >= zoneLow && fc.close <= zoneHigh && fc.close > fc.open) {
              entryCandle = fc; entryIdx = k; break
            }
          }

          if (entryCandle) {
            const entry  = entryCandle.close
            const slRaw  = sweepWickTip - 2 * pipSize
            const slPips = (entry - slRaw) / pipSize
            if (slPips >= minSlPips && slPips <= maxSlPips) {
              const tpPips = slPips * rrRatio
              const tp     = entry + tpPips * pipSize

              let result: 'win' | 'loss' | 'open' = 'open'
              let exitTs: number | null = null
              let pnlPips = 0
              for (let m = entryIdx + 1; m < candles.length; m++) {
                const fc = candles[m]
                if (fc.low  <= slRaw) { result = 'loss'; exitTs = fc.timestamp; pnlPips = -slPips; break }
                if (fc.high >= tp)    { result = 'win';  exitTs = fc.timestamp; pnlPips =  tpPips; break }
                if (m === candles.length - 1) { pnlPips = (fc.close - entry) / pipSize; exitTs = fc.timestamp }
              }

              const t: SmcTrade = {
                direction: 'buy', sessionDate: new Date(c.timestamp).toDateString(),
                sweepTs: c.timestamp, sweepWickTip, swingLevel: swingPrice,
                obHigh: ob.high, obLow: ob.low,
                fib50Price, fib79Price,
                entryTs: entryCandle.timestamp, entryPrice: entry,
                slPrice: slRaw, tpPrice: tp, exitTs, result, pnlPips,
              }
              trades.push(t)
              usedSweepTs.add(c.timestamp)
              overlays.push(...setupToOverlays(t, settings))
              overlays.push(...tradeToOverlays(t, candles[candles.length - 1].timestamp))
            }
          }
        }
      }
    }

    if (usedSweepTs.has(c.timestamp)) continue  // already used as bullish sweep

    // ── Bearish setup: candle i wicks above a recent confirmed swing high ───
    {
      let swingPrice = -Infinity
      let swingIdx   = -1
      const searchFrom = Math.max(lb, i - swingSearchBars)
      for (let k = i - lb - 1; k >= searchFrom; k--) {
        if (k + lb >= i) continue
        if (isSwingHigh(candles, k, lb)) {
          swingPrice = candles[k].high
          swingIdx   = k
          break
        }
      }

      if (swingIdx >= 0 && c.high > swingPrice && c.close < swingPrice) {
        const sweepPips = (c.high - swingPrice) / pipSize
        if (sweepPips >= minSweepPips) {
          const sweepWickTip = c.high
          let impulseLow = c.low
          for (let k = i + 1; k <= Math.min(i + 3, candles.length - 1); k++) {
            impulseLow = Math.min(impulseLow, candles[k].low)
          }

          // Order block: last bullish candle in the 15 candles before i
          let obIdx = i - 1
          while (obIdx > Math.max(0, i - 15) && candles[obIdx].close <= candles[obIdx].open) obIdx--
          const ob = candles[Math.max(0, obIdx)]

          const move       = sweepWickTip - impulseLow
          const fib50Price = impulseLow + move * fib50
          const fib79Price = impulseLow + move * fib79
          const zoneHigh   = Math.max(fib50Price, fib79Price)
          const zoneLow    = Math.min(fib50Price, fib79Price)

          let entryCandle: Candle | null = null
          let entryIdx = -1
          for (let k = i + 1; k <= Math.min(i + maxEntryBars, candles.length - 1); k++) {
            const fc = candles[k]
            if (fc.high > sweepWickTip + pipSize) break
            if (fc.close >= zoneLow && fc.close <= zoneHigh && fc.close < fc.open) {
              entryCandle = fc; entryIdx = k; break
            }
          }

          if (entryCandle) {
            const entry  = entryCandle.close
            const slRaw  = sweepWickTip + 2 * pipSize
            const slPips = (slRaw - entry) / pipSize
            if (slPips >= minSlPips && slPips <= maxSlPips) {
              const tpPips = slPips * rrRatio
              const tp     = entry - tpPips * pipSize

              let result: 'win' | 'loss' | 'open' = 'open'
              let exitTs: number | null = null
              let pnlPips = 0
              for (let m = entryIdx + 1; m < candles.length; m++) {
                const fc = candles[m]
                if (fc.high >= slRaw) { result = 'loss'; exitTs = fc.timestamp; pnlPips = -slPips; break }
                if (fc.low  <= tp)    { result = 'win';  exitTs = fc.timestamp; pnlPips =  tpPips; break }
                if (m === candles.length - 1) { pnlPips = (entry - fc.close) / pipSize; exitTs = fc.timestamp }
              }

              const t: SmcTrade = {
                direction: 'sell', sessionDate: new Date(c.timestamp).toDateString(),
                sweepTs: c.timestamp, sweepWickTip, swingLevel: swingPrice,
                obHigh: ob.high, obLow: ob.low,
                fib50Price, fib79Price,
                entryTs: entryCandle.timestamp, entryPrice: entry,
                slPrice: slRaw, tpPrice: tp, exitTs, result, pnlPips,
              }
              trades.push(t)
              usedSweepTs.add(c.timestamp)
              overlays.push(...setupToOverlays(t, settings))
              overlays.push(...tradeToOverlays(t, candles[candles.length - 1].timestamp))
            }
          }
        }
      }
    }
  }

  // ── Stats ─────────────────────────────────────────────────────────────────
  const wins   = trades.filter(t => t.result === 'win')
  const losses = trades.filter(t => t.result === 'loss')
  const open   = trades.filter(t => t.result === 'open')
  const wr     = trades.length > 0 ? (wins.length / (wins.length + losses.length)) * 100 : 0
  const avgW   = wins.length   > 0 ? wins.reduce((s, t) => s + t.pnlPips, 0)   / wins.length   : 0
  const avgL   = losses.length > 0 ? losses.reduce((s, t) => s + Math.abs(t.pnlPips), 0) / losses.length : 0
  const exp    = (wr / 100) * avgW - ((100 - wr) / 100) * avgL

  const dates  = trades.map(t => t.entryTs).sort((a, b) => a - b)
  const dateFrom = dates.length > 0 ? new Date(dates[0]).toLocaleDateString('en-GB')               : undefined
  const dateTo   = dates.length > 0 ? new Date(dates[dates.length - 1]).toLocaleDateString('en-GB') : undefined

  return {
    trades,
    overlays,
    stats: {
      trades:         trades.length,
      wins:           wins.length,
      losses:         losses.length,
      openTrades:     open.length,
      winRate:        Math.round(wr * 10) / 10,
      avgWinPips:     Math.round(avgW * 10) / 10,
      avgLossPips:    Math.round(avgL * 10) / 10,
      expectancyPips: Math.round(exp * 10) / 10,
      dateFrom,
      dateTo,
    },
  }
}
