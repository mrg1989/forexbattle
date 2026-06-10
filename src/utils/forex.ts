import type { Candle } from '../types'

// ─── Geometric Brownian Motion forex simulator ────────────────────────────────

const PAIRS: Record<string, { base: number; volatility: number; pip: number }> = {
  'EUR/USD': { base: 1.0854, volatility: 0.00035, pip: 0.0001 },
  'GBP/USD': { base: 1.2643, volatility: 0.00045, pip: 0.0001 },
  'USD/JPY': { base: 149.82, volatility: 0.055,   pip: 0.01   },
  'USD/CHF': { base: 0.9012, volatility: 0.00030, pip: 0.0001 },
  'AUD/USD': { base: 0.6523, volatility: 0.00040, pip: 0.0001 },
  'XAU/USD': { base: 2320.0, volatility: 0.80,    pip: 0.01   },
}

export function getPairConfig(pair: string) {
  return PAIRS[pair] ?? PAIRS['EUR/USD']
}

/**
 * Generate a realistic series of OHLC candles using GBM with mean-reversion.
 */
export function generateCandles(pair: string, count: number, intervalMs = 10_000, startPrice?: number): Candle[] {
  const { base, volatility } = getPairConfig(pair)
  const candles: Candle[] = []
  let price = startPrice ?? (base + (Math.random() - 0.5) * base * 0.002)
  const now = Date.now()
  const start = now - count * intervalMs

  for (let i = 0; i < count; i++) {
    const timestamp = start + i * intervalMs
    // Mean reversion + random walk
    const reversion = (base - price) * 0.015
    const rand = (Math.random() - 0.5) * 2
    const drift = reversion + volatility * rand

    const open = price
    const close = price + drift

    const range = Math.abs(drift) * (1.2 + Math.random() * 1.5)
    const high = Math.max(open, close) + range * 0.4
    const low  = Math.min(open, close) - range * 0.4

    const volume = Math.floor(300 + Math.random() * 1400)

    candles.push({ timestamp, open, high, low, close, volume })
    price = close
  }

  return candles
}

/**
 * Advance a live forming candle with a new tick.
 * Call this ~every 200ms for a smooth live feel.
 */
export function tickCandle(current: Candle, pair: string): Candle {
  const { volatility } = getPairConfig(pair)
  const tick = (Math.random() - 0.5) * 2 * volatility * 0.4
  const newClose = current.close + tick
  return {
    ...current,
    close: newClose,
    high:  Math.max(current.high, newClose),
    low:   Math.min(current.low,  newClose),
    volume: current.volume + Math.floor(Math.random() * 20),
  }
}

/**
 * Start a fresh candle from the previous close.
 */
export function newCandle(prevClose: number, intervalMs: number): Candle {
  return {
    timestamp: Date.now(),
    open:   prevClose,
    high:   prevClose,
    low:    prevClose,
    close:  prevClose,
    volume: 0,
  }
}

/**
 * Simulate price movement for the resolution phase.
 * Returns the final close after `seconds` of movement.
 */
export function simulatePriceMove(startPrice: number, pair: string, seconds: number): number {
  const { volatility } = getPairConfig(pair)
  let price = startPrice
  for (let i = 0; i < seconds * 5; i++) {
    price += (Math.random() - 0.5) * 2 * volatility * 0.4
  }
  return price
}

/**
 * Determine if the market moved up or down between two prices.
 * Uses a minimum threshold so near-zero moves are decided by coin flip.
 */
export function getMarketResult(startPrice: number, endPrice: number, pair: string): 'up' | 'down' {
  const { pip } = getPairConfig(pair)
  const diff = endPrice - startPrice
  if (Math.abs(diff) < pip * 0.5) return Math.random() > 0.5 ? 'up' : 'down'
  return diff > 0 ? 'up' : 'down'
}

export function formatPrice(price: number, pair: string): string {
  if (pair.includes('XAU')) return price.toFixed(2)
  const { pip } = getPairConfig(pair)
  // pip=0.01 → JPY (3dp),  pip=0.0001 → everything else (5dp)
  const decimals = pip >= 0.01 ? 3 : 5
  return price.toFixed(decimals)
}

export function formatPriceDiff(diff: number, pair: string): string {
  const { pip } = getPairConfig(pair)
  const pips = Math.abs(diff / pip)
  const sign = diff >= 0 ? '+' : '-'
  return `${sign}${pips.toFixed(1)} pips`
}
