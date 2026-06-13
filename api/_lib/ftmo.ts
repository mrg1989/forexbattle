import { toUKDateString } from './time.js'

export interface FtmoConfig {
  accountSize:      number  // e.g. 100_000
  riskPercent:      number  // e.g. 0.01 (1% per trade, fixed on initial balance)
  rrRatio:          number  // stored for reference
  dailyLossLimit:   number  // fraction, e.g. 0.05 (5% of account)
  maxDrawdownLimit: number  // fraction, e.g. 0.10 (10% of account, absolute from start)
  profitTarget:     number  // fraction, e.g. 0.10 (10% of account)
}

export interface FtmoResult {
  passed:           boolean
  failureReason:    string | null  // null on pass; otherwise 'max_drawdown_exceeded' | 'daily_loss_exceeded' | 'target_not_reached'
  peakBalance:      number
  worstDrawdown:    number         // max dollar loss from starting balance
  dailyBreachCount: number         // days where daily loss exceeded the daily limit
  finalBalance:     number
  equityCurveJson:  {
    accountSize:   number
    riskAmount:    number
    profitTarget:  number
    finalBalance:  number
    equityCurve:   { date: string; balance: number; dailyPnl: number }[]
  }
}

// Simulate FTMO-style challenge rules against a chronological trade sequence.
//
// Rules applied:
//   - Risk per trade = accountSize × riskPercent (fixed, does not compound)
//   - Daily loss limit: if any day's net P&L < -(accountSize × dailyLossLimit) → fail
//   - Max drawdown: if balance ever falls below accountSize × (1 − maxDrawdownLimit) → fail
//   - Profit target: if balance ever reaches accountSize × (1 + profitTarget) without breach → pass
//
// Open trades contribute 0 P&L but still consume a trading day slot.
export function simulateFtmo(
  trades:  { entryTs: Date; profitLossR: number | null }[],
  config:  FtmoConfig,
): FtmoResult {
  const { accountSize, riskPercent, rrRatio, dailyLossLimit, maxDrawdownLimit, profitTarget } = config
  const riskAmount         = accountSize * riskPercent
  const maxDailyLossAmount = accountSize * dailyLossLimit
  const minAllowedBalance  = accountSize * (1 - maxDrawdownLimit)
  const targetBalance      = accountSize * (1 + profitTarget)

  let balance        = accountSize
  let peakBalance    = accountSize
  let worstDrawdown  = 0
  let dailyBreachCount = 0
  let failureReason: string | null = null
  let targetReached  = false

  const equityCurve: { date: string; balance: number; dailyPnl: number }[] = []

  // Group trades by UK date, ascending
  const dayMap = new Map<string, typeof trades>()
  for (const t of trades) {
    const ukDate = toUKDateString(t.entryTs.getTime())
    let arr = dayMap.get(ukDate)
    if (!arr) { arr = []; dayMap.set(ukDate, arr) }
    arr.push(t)
  }

  for (const [day, dayTrades] of [...dayMap.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1)) {
    if (failureReason || targetReached) break

    const dayStartBalance = balance

    for (const trade of dayTrades) {
      balance += (trade.profitLossR ?? 0) * riskAmount

      if (balance > peakBalance) peakBalance = balance

      const lossFromStart = accountSize - balance
      if (lossFromStart > worstDrawdown) worstDrawdown = lossFromStart

      if (balance <= minAllowedBalance) {
        failureReason = 'max_drawdown_exceeded'
        break
      }
    }

    if (!failureReason) {
      const dailyPnl = balance - dayStartBalance
      if (dailyPnl < -maxDailyLossAmount) {
        dailyBreachCount++
        failureReason = 'daily_loss_exceeded'
      }
    }

    equityCurve.push({
      date:     day,
      balance:  Math.round(balance * 100) / 100,
      dailyPnl: Math.round((balance - dayStartBalance) * 100) / 100,
    })

    if (!failureReason && balance >= targetBalance) {
      targetReached = true
    }
  }

  const passed = targetReached && failureReason === null

  return {
    passed,
    failureReason:   passed ? null : (failureReason ?? 'target_not_reached'),
    peakBalance:     Math.round(peakBalance    * 100) / 100,
    worstDrawdown:   Math.round(Math.max(0, worstDrawdown) * 100) / 100,
    dailyBreachCount,
    finalBalance:    Math.round(balance        * 100) / 100,
    equityCurveJson: {
      accountSize,
      riskAmount,
      profitTarget,
      finalBalance: Math.round(balance * 100) / 100,
      equityCurve,
    },
  }
}
