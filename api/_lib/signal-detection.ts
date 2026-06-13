import type { Candle, CrossfireSetup } from '@prisma/client'

// Evaluate a stored trendline at any UTC timestamp (ms).
// linePrice(t) = intercept + slope * (t_ms - originTs_ms)
export function computeLinePrice(
  slope:     number,
  intercept: number,
  originTs:  Date,
  tMs:       number,
): number {
  return intercept + slope * (tMs - originTs.getTime())
}

export interface DetectedSignal {
  direction:         'buy' | 'sell'
  signalTs:          Date
  breakoutType:      'strong_body_close' | 'weak_body_close'
  signalValid:       boolean
  invalidReason:     string | null
  candleOpen:        number
  candleHigh:        number
  candleLow:         number
  candleClose:       number
  candleVolume:      number
  linePriceAtSignal: number
}

// Scan session M5 candles (13:00–16:00 UK, pre-filtered and ordered) for the first
// close-beyond-line breakout. Returns null if no valid signal found in the session.
// Checks buy (green line break) before sell (red line break) on each candle.
export function detectSignal(
  setup:          CrossfireSetup,
  sessionCandles: Candle[],
): DetectedSignal | null {
  for (const candle of sessionCandles) {
    const tMs   = candle.timestampUtc.getTime()
    const green = computeLinePrice(setup.greenLineSlope, setup.greenLineIntercept, setup.greenLineOriginTs, tMs)
    const red   = computeLinePrice(setup.redLineSlope,   setup.redLineIntercept,   setup.redLineOriginTs,   tMs)

    // Buy: close above green line (resistance breakout)
    if (candle.close > green) {
      const bodyMin = Math.min(candle.open, candle.close)
      return {
        direction:         'buy',
        signalTs:          candle.timestampUtc,
        breakoutType:      bodyMin > green ? 'strong_body_close' : 'weak_body_close',
        signalValid:       true,
        invalidReason:     null,
        candleOpen:        candle.open,
        candleHigh:        candle.high,
        candleLow:         candle.low,
        candleClose:       candle.close,
        candleVolume:      candle.volume,
        linePriceAtSignal: green,
      }
    }

    // Sell: close below red line (support breakout)
    if (candle.close < red) {
      const bodyMax = Math.max(candle.open, candle.close)
      return {
        direction:         'sell',
        signalTs:          candle.timestampUtc,
        breakoutType:      bodyMax < red ? 'strong_body_close' : 'weak_body_close',
        signalValid:       true,
        invalidReason:     null,
        candleOpen:        candle.open,
        candleHigh:        candle.high,
        candleLow:         candle.low,
        candleClose:       candle.close,
        candleVolume:      candle.volume,
        linePriceAtSignal: red,
      }
    }
  }

  return null
}
