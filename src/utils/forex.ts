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

export function formatPrice(price: number, pair: string): string {
  if (pair.includes('XAU')) return price.toFixed(2)
  const { pip } = getPairConfig(pair)
  const decimals = pip >= 0.01 ? 3 : 5
  return price.toFixed(decimals)
}

export function formatPriceDiff(diff: number, pair: string): string {
  const { pip } = getPairConfig(pair)
  const pips = Math.abs(diff / pip)
  const sign = diff >= 0 ? '+' : '-'
  return `${sign}${pips.toFixed(1)} pips`
}
