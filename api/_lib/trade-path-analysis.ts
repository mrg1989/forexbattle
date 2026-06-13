import type { Candle, Trade } from '@prisma/client'

export interface PathAnalysisResult {
  mfePips:            number        // raw price distance in favourable direction
  maePips:            number        // raw price distance in adverse direction
  mfeR:               number        // mfePips / riskPips
  maeR:               number        // maePips / riskPips
  reached1r:          boolean
  reached2r:          boolean
  reached3r:          boolean
  timeTo1rMinutes:    number | null // null if 1R never reached
  timeTo3rMinutes:    number | null // null if 3R never reached
  timeToExitMinutes:  number | null
  breakEvenWouldHelp: boolean       // losing trade where MFE crossed 1R before SL
}

// Pure function — no DB access.
//
// tradeCandles: M5 candles where timestampUtc > trade.entryTs and <= trade.exitTs,
// sorted ascending. Matches the postSignalCandles window used in trade simulation.
//
// mfePips / maePips are stored as raw price distances (e.g. 0.0050 for EUR_USD),
// not multiplied by 10000 to convert to 4-decimal pips.
export function computePathAnalysis(
  trade:        Trade,
  tradeCandles: Candle[],
): PathAnalysisResult {
  const { direction, entryPrice, slPrice, entryTs, exitTs, result } = trade
  const riskPips = Math.abs(entryPrice - slPrice)

  const timeToExitMinutes = exitTs
    ? Math.round((exitTs.getTime() - entryTs.getTime()) / 60000)
    : null

  const zero: PathAnalysisResult = {
    mfePips: 0, maePips: 0, mfeR: 0, maeR: 0,
    reached1r: false, reached2r: false, reached3r: false,
    timeTo1rMinutes: null, timeTo3rMinutes: null,
    timeToExitMinutes,
    breakEvenWouldHelp: false,
  }

  if (riskPips <= 1e-10 || tradeCandles.length === 0) return zero

  const entryTMs = entryTs.getTime()

  let globalMaxHigh        = -Infinity
  let globalMinLow         =  Infinity
  let runningMaxFavPrice   = direction === 'buy' ? -Infinity : Infinity
  let timeTo1r: number | null = null
  let timeTo3r: number | null = null

  for (const candle of tradeCandles) {
    const elapsedMinutes = Math.round((candle.timestampUtc.getTime() - entryTMs) / 60000)

    if (candle.high > globalMaxHigh) globalMaxHigh = candle.high
    if (candle.low  < globalMinLow)  globalMinLow  = candle.low

    if (direction === 'buy') {
      if (candle.high > runningMaxFavPrice) runningMaxFavPrice = candle.high
    } else {
      if (candle.low  < runningMaxFavPrice) runningMaxFavPrice = candle.low
    }

    const runningMfeR = direction === 'buy'
      ? Math.max(0, (runningMaxFavPrice - entryPrice) / riskPips)
      : Math.max(0, (entryPrice - runningMaxFavPrice) / riskPips)

    if (timeTo1r === null && runningMfeR >= 1.0) timeTo1r = elapsedMinutes
    if (timeTo3r === null && runningMfeR >= 3.0) timeTo3r = elapsedMinutes
  }

  let mfePips: number, maePips: number
  if (direction === 'buy') {
    mfePips = Math.max(0, globalMaxHigh - entryPrice)
    maePips = Math.max(0, entryPrice    - globalMinLow)
  } else {
    mfePips = Math.max(0, entryPrice    - globalMinLow)
    maePips = Math.max(0, globalMaxHigh - entryPrice)
  }

  const mfeR = mfePips / riskPips
  const maeR = maePips / riskPips

  return {
    mfePips,
    maePips,
    mfeR,
    maeR,
    reached1r:          mfeR >= 1.0,
    reached2r:          mfeR >= 2.0,
    reached3r:          mfeR >= 3.0,
    timeTo1rMinutes:    timeTo1r,
    timeTo3rMinutes:    timeTo3r,
    timeToExitMinutes,
    breakEvenWouldHelp: result === 'loss' && mfeR >= 1.0,
  }
}
