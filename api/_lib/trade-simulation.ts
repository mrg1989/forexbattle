import type { Candle, CrossfireSetup } from '@prisma/client'
import { computeLinePrice } from './signal-detection.js'

export interface TradeResult {
  entryPrice:  number
  slPrice:     number
  tpPrice:     number
  exitTs:      Date | null
  exitPrice:   number | null
  result:      'win' | 'loss' | 'open'
  profitLossR: number | null
}

// Simulate a Crossfire trade from the signal candle close.
//
// Dynamic SL: the opposite trendline at entry time.
//   - Buy entry → SL = red line price at entry timestamp
//   - Sell entry → SL = green line price at entry timestamp
//
// TP: entryPrice ± riskPips * riskReward
//
// postSignalCandles: M5 candles strictly AFTER the signal candle, in ascending order,
// up to but not including 16:00 UK.
//
// When SL and TP are both breached within the same candle (high >= TP and low <= SL),
// SL takes priority — conservative convention matching MT4/MT5 backtest behaviour.
export function simulateTrade(
  direction:         'buy' | 'sell',
  entryTs:           Date,
  entryPrice:        number,
  setup:             CrossfireSetup,
  riskReward:        number,
  postSignalCandles: Candle[],
): TradeResult {
  const entryTMs = entryTs.getTime()

  const greenAtEntry = computeLinePrice(setup.greenLineSlope, setup.greenLineIntercept, setup.greenLineOriginTs, entryTMs)
  const redAtEntry   = computeLinePrice(setup.redLineSlope,   setup.redLineIntercept,   setup.redLineOriginTs,   entryTMs)

  const slPrice  = direction === 'buy' ? redAtEntry : greenAtEntry
  const riskPips = Math.abs(entryPrice - slPrice)

  // Degenerate setup: lines have crossed or zero risk distance
  if (riskPips <= 1e-10) {
    return {
      entryPrice, slPrice, tpPrice: entryPrice,
      exitTs: entryTs, exitPrice: entryPrice,
      result: 'open', profitLossR: 0,
    }
  }

  const tpPrice = direction === 'buy'
    ? entryPrice + riskPips * riskReward
    : entryPrice - riskPips * riskReward

  for (const candle of postSignalCandles) {
    if (direction === 'buy') {
      if (candle.low <= slPrice) {
        return { entryPrice, slPrice, tpPrice, exitTs: candle.timestampUtc, exitPrice: slPrice,  result: 'loss', profitLossR: -1 }
      }
      if (candle.high >= tpPrice) {
        return { entryPrice, slPrice, tpPrice, exitTs: candle.timestampUtc, exitPrice: tpPrice, result: 'win',  profitLossR: riskReward }
      }
    } else {
      if (candle.high >= slPrice) {
        return { entryPrice, slPrice, tpPrice, exitTs: candle.timestampUtc, exitPrice: slPrice,  result: 'loss', profitLossR: -1 }
      }
      if (candle.low <= tpPrice) {
        return { entryPrice, slPrice, tpPrice, exitTs: candle.timestampUtc, exitPrice: tpPrice, result: 'win',  profitLossR: riskReward }
      }
    }
  }

  // Session ended without SL or TP hit
  const last = postSignalCandles[postSignalCandles.length - 1]
  return {
    entryPrice, slPrice, tpPrice,
    exitTs:      last?.timestampUtc ?? entryTs,
    exitPrice:   last?.close        ?? entryPrice,
    result:      'open',
    profitLossR: 0,
  }
}
