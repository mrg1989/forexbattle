import type { Candle } from '@prisma/client'
import { db } from './db.js'
import { toUKHour, toUKDateString } from './time.js'

interface SetupFields {
  setupValid:         boolean
  invalidReason:      string | null
  setupCandleTs:      Date
  setupCandleOpen:    number
  setupCandleHigh:    number
  setupCandleLow:     number
  setupCandleClose:   number
  hhCandleTs:         Date
  hhPrice:            number
  llCandleTs:         Date
  llPrice:            number
  greenLineSlope:     number
  greenLineIntercept: number
  greenLineOriginTs:  Date
  redLineSlope:       number
  redLineIntercept:   number
  redLineOriginTs:    Date
}

export interface RangeDetectionSummary {
  symbol:            string
  strategyVersionId: string
  datesProcessed:    number
  valid:             number
  invalid:           number
}

// Pure function — compute setup fields from pre-loaded M15 candles for one UK date.
function detectSetupFields(dateUk: string, candles: Candle[]): SetupFields {
  const sentinel = new Date(dateUk + 'T00:00:00Z')

  // Find the 13:00 UK setup candle
  const setupCandle = candles.find(c => toUKHour(c.timestampUtc.getTime()) === 13)
  if (!setupCandle) {
    return {
      setupValid: false, invalidReason: 'no_1300_candle',
      setupCandleTs: sentinel, setupCandleOpen: 0, setupCandleHigh: 0,
      setupCandleLow: 0, setupCandleClose: 0,
      hhCandleTs: sentinel, hhPrice: 0,
      llCandleTs: sentinel, llPrice: 0,
      greenLineSlope: 0, greenLineIntercept: 0, greenLineOriginTs: sentinel,
      redLineSlope:   0, redLineIntercept:   0, redLineOriginTs:   sentinel,
    }
  }

  // Reference window: M15 candles that open at 08:00–12:45 UK (hours 8–12 inclusive)
  const refCandles = candles.filter(c => {
    const h = toUKHour(c.timestampUtc.getTime())
    return h >= 8 && h < 13
  })

  if (refCandles.length === 0) {
    return {
      setupValid: false, invalidReason: 'no_reference_candles',
      setupCandleTs: setupCandle.timestampUtc,
      setupCandleOpen: setupCandle.open, setupCandleHigh: setupCandle.high,
      setupCandleLow: setupCandle.low,   setupCandleClose: setupCandle.close,
      hhCandleTs: sentinel, hhPrice: 0,
      llCandleTs: sentinel, llPrice: 0,
      greenLineSlope: 0, greenLineIntercept: 0, greenLineOriginTs: sentinel,
      redLineSlope:   0, redLineIntercept:   0, redLineOriginTs:   sentinel,
    }
  }

  const hhCandle = refCandles.reduce((best, c) => c.high > best.high ? c : best, refCandles[0])
  const llCandle = refCandles.reduce((best, c) => c.low  < best.low  ? c : best, refCandles[0])

  const setupTs = setupCandle.timestampUtc.getTime()
  const hhTs    = hhCandle.timestampUtc.getTime()
  const llTs    = llCandle.timestampUtc.getTime()

  // Slope: price per millisecond. Intercept: anchor price at originTs.
  // linePrice(t) = intercept + slope * (t_ms - originTs_ms)
  const greenSlope = (setupCandle.high - hhCandle.high) / (setupTs - hhTs)
  const redSlope   = (setupCandle.low  - llCandle.low)  / (setupTs - llTs)

  return {
    setupValid: true, invalidReason: null,
    setupCandleTs:    setupCandle.timestampUtc,
    setupCandleOpen:  setupCandle.open,
    setupCandleHigh:  setupCandle.high,
    setupCandleLow:   setupCandle.low,
    setupCandleClose: setupCandle.close,
    hhCandleTs:         hhCandle.timestampUtc,
    hhPrice:            hhCandle.high,
    llCandleTs:         llCandle.timestampUtc,
    llPrice:            llCandle.low,
    greenLineSlope:     greenSlope,
    greenLineIntercept: hhCandle.high,
    greenLineOriginTs:  hhCandle.timestampUtc,
    redLineSlope:       redSlope,
    redLineIntercept:   llCandle.low,
    redLineOriginTs:    llCandle.timestampUtc,
  }
}

// Detect and upsert Crossfire setups for all weekdays in [from, to] (UTC inclusive).
// Loads all M15 candles in a single DB query then processes each date in memory.
export async function runSetupDetectionForRange(
  symbol:            string,
  strategyVersionId: string,
  from:              Date,
  to:                Date,
): Promise<RangeDetectionSummary> {
  const queryFrom = new Date(from)
  queryFrom.setUTCHours(0, 0, 0, 0)
  const queryTo = new Date(to)
  queryTo.setUTCHours(23, 59, 59, 999)

  const candles = await db.candle.findMany({
    where: {
      symbol,
      timeframe:    'M15',
      timestampUtc: { gte: queryFrom, lte: queryTo },
    },
    orderBy: { timestampUtc: 'asc' },
  })

  // Group by UK calendar date using BST-safe conversion
  const byDate = new Map<string, Candle[]>()
  for (const c of candles) {
    const d = toUKDateString(c.timestampUtc.getTime())
    let arr = byDate.get(d)
    if (!arr) { arr = []; byDate.set(d, arr) }
    arr.push(c)
  }

  let valid = 0, invalid = 0, datesProcessed = 0
  const current = new Date(queryFrom)

  while (current <= queryTo) {
    const dow = current.getUTCDay() // 0=Sun, 6=Sat
    if (dow !== 0 && dow !== 6) {
      const dateUk    = toUKDateString(current.getTime())
      const dayCandles = byDate.get(dateUk) ?? []
      const f         = detectSetupFields(dateUk, dayCandles)

      await db.crossfireSetup.upsert({
        where: { strategyVersionId_symbol_dateUk: { strategyVersionId, symbol, dateUk } },
        create: {
          strategyVersionId,
          symbol,
          dateUk,
          setupValid:         f.setupValid,
          invalidReason:      f.invalidReason,
          setupCandleTs:      f.setupCandleTs,
          setupCandleOpen:    f.setupCandleOpen,
          setupCandleHigh:    f.setupCandleHigh,
          setupCandleLow:     f.setupCandleLow,
          setupCandleClose:   f.setupCandleClose,
          hhCandleTs:         f.hhCandleTs,
          hhPrice:            f.hhPrice,
          llCandleTs:         f.llCandleTs,
          llPrice:            f.llPrice,
          greenLineSlope:     f.greenLineSlope,
          greenLineIntercept: f.greenLineIntercept,
          greenLineOriginTs:  f.greenLineOriginTs,
          redLineSlope:       f.redLineSlope,
          redLineIntercept:   f.redLineIntercept,
          redLineOriginTs:    f.redLineOriginTs,
        },
        update: {
          setupValid:         f.setupValid,
          invalidReason:      f.invalidReason,
          setupCandleTs:      f.setupCandleTs,
          setupCandleOpen:    f.setupCandleOpen,
          setupCandleHigh:    f.setupCandleHigh,
          setupCandleLow:     f.setupCandleLow,
          setupCandleClose:   f.setupCandleClose,
          hhCandleTs:         f.hhCandleTs,
          hhPrice:            f.hhPrice,
          llCandleTs:         f.llCandleTs,
          llPrice:            f.llPrice,
          greenLineSlope:     f.greenLineSlope,
          greenLineIntercept: f.greenLineIntercept,
          greenLineOriginTs:  f.greenLineOriginTs,
          redLineSlope:       f.redLineSlope,
          redLineIntercept:   f.redLineIntercept,
          redLineOriginTs:    f.redLineOriginTs,
        },
      })

      f.setupValid ? valid++ : invalid++
      datesProcessed++
    }
    current.setUTCDate(current.getUTCDate() + 1)
  }

  return { symbol, strategyVersionId, datesProcessed, valid, invalid }
}
