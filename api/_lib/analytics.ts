import { toUKHour, toUKDateString } from './time.js'

export interface TradeRecord {
  id:           string
  direction:    string
  entryTs:      Date
  result:       string          // 'win' | 'loss' | 'open'
  profitLossR:  number | null
  breakoutType: string          // from signal
  pathAnalysis: {
    mfeR:               number | null
    maeR:               number | null
    reached1r:          boolean
    reached2r:          boolean
    reached3r:          boolean
    timeTo1rMinutes:    number | null
    timeToExitMinutes:  number | null
    breakEvenWouldHelp: boolean
  } | null
}

// ── Helpers ────────────────────────────────────────────────────────────────

function r2(n: number): number { return Math.round(n * 100) / 100 }
function r1(n: number): number { return Math.round(n * 10)  / 10  }

function pct(count: number, total: number): number {
  return total > 0 ? r1((count / total) * 100) : 0
}

function avg(nums: number[]): number | null {
  return nums.length > 0 ? r2(nums.reduce((s, n) => s + n, 0) / nums.length) : null
}

function decided(trades: TradeRecord[]): TradeRecord[] {
  return trades.filter(t => t.result === 'win' || t.result === 'loss')
}

function groupStats(trades: TradeRecord[]) {
  const dec = decided(trades)
  const wins   = dec.filter(t => t.result === 'win').length
  const losses = dec.filter(t => t.result === 'loss').length
  const opens  = trades.filter(t => t.result === 'open').length
  const totalR = r2(dec.reduce((s, t) => s + (t.profitLossR ?? 0), 0))
  const winRatePct = dec.length > 0 ? r1((wins / dec.length) * 100) : null
  return { total: trades.length, wins, losses, opens, decided: dec.length, totalR, winRatePct }
}

// ── Summary functions ──────────────────────────────────────────────────────

export function computeOverall(trades: TradeRecord[]): object {
  const dec    = decided(trades)
  const wins   = dec.filter(t => t.result === 'win')
  const losses = dec.filter(t => t.result === 'loss')
  const opens  = trades.filter(t => t.result === 'open').length

  const totalR     = dec.reduce((s, t) => s + (t.profitLossR ?? 0), 0)
  const avgR       = dec.length > 0 ? r2(totalR / dec.length) : null
  const grossWinR  = wins.reduce((s, t) => s + (t.profitLossR ?? 0), 0)
  const grossLossR = losses.reduce((s, t) => s + Math.abs(t.profitLossR ?? 0), 0)
  const profitFactor = grossLossR > 0 ? r2(grossWinR / grossLossR) : null

  const withPath = trades.filter(t => t.pathAnalysis !== null)
  const avgMfeR  = avg(withPath.map(t => t.pathAnalysis!.mfeR ?? 0))
  const avgMaeR  = avg(withPath.map(t => t.pathAnalysis!.maeR ?? 0))

  const durTrades = withPath.filter(t => t.pathAnalysis!.timeToExitMinutes !== null)
  const t1rTrades = withPath.filter(t => t.pathAnalysis!.timeTo1rMinutes   !== null)
  const beCount   = withPath.filter(t => t.pathAnalysis!.breakEvenWouldHelp).length

  return {
    totalTrades:               trades.length,
    wins:                      wins.length,
    losses:                    losses.length,
    opens,
    decidedTrades:             dec.length,
    winRatePct:                dec.length > 0 ? r1((wins.length / dec.length) * 100) : null,
    totalR:                    r2(totalR),
    avgR,
    expectancy:                avgR,
    profitFactor,
    avgMfeR,
    avgMaeR,
    pctReaching1r:             pct(withPath.filter(t => t.pathAnalysis!.reached1r).length, withPath.length),
    pctReaching2r:             pct(withPath.filter(t => t.pathAnalysis!.reached2r).length, withPath.length),
    pctReaching3r:             pct(withPath.filter(t => t.pathAnalysis!.reached3r).length, withPath.length),
    pctReaching4r:             pct(withPath.filter(t => (t.pathAnalysis!.mfeR ?? 0) >= 4.0).length, withPath.length),
    pctReaching5r:             pct(withPath.filter(t => (t.pathAnalysis!.mfeR ?? 0) >= 5.0).length, withPath.length),
    breakEvenImprovementRate:  pct(beCount, withPath.length),
    avgTradeDurationMinutes:   durTrades.length > 0 ? Math.round(durTrades.reduce((s, t) => s + t.pathAnalysis!.timeToExitMinutes!, 0) / durTrades.length) : null,
    avgTimeTo1rMinutes:        t1rTrades.length > 0 ? Math.round(t1rTrades.reduce((s, t) => s + t.pathAnalysis!.timeTo1rMinutes!, 0) / t1rTrades.length)   : null,
  }
}

export function computeStrategyEvaluation(trades: TradeRecord[]): object {
  const dec    = decided(trades)
  const wins   = dec.filter(t => t.result === 'win')
  const losses = dec.filter(t => t.result === 'loss')

  const totalR     = dec.reduce((s, t) => s + (t.profitLossR ?? 0), 0)
  const grossWinR  = wins.reduce((s, t) => s + (t.profitLossR ?? 0), 0)
  const grossLossR = losses.reduce((s, t) => s + Math.abs(t.profitLossR ?? 0), 0)
  const profitFactor = grossLossR > 0 ? r2(grossWinR / grossLossR) : null

  // Max drawdown in R and streaks — single pass
  let runningR = 0, peakR = 0, maxDdR = 0
  let curLoss = 0, maxLoss = 0, curWin = 0, maxWin = 0

  for (const t of dec) {
    runningR += t.profitLossR ?? 0
    if (runningR > peakR) peakR = runningR
    const dd = peakR - runningR
    if (dd > maxDdR) maxDdR = dd

    if (t.result === 'loss') { curLoss++; if (curLoss > maxLoss) maxLoss = curLoss; curWin  = 0 }
    if (t.result === 'win')  { curWin++;  if (curWin  > maxWin)  maxWin  = curWin;  curLoss = 0 }
  }

  // Monthly and yearly breakdown
  const byMonth: Record<string, { trades: number; totalR: number; wins: number; losses: number }> = {}
  for (const t of dec) {
    const month = toUKDateString(t.entryTs.getTime()).substring(0, 7)  // "YYYY-MM"
    if (!byMonth[month]) byMonth[month] = { trades: 0, totalR: 0, wins: 0, losses: 0 }
    byMonth[month].trades++
    byMonth[month].totalR += t.profitLossR ?? 0
    if (t.result === 'win')  byMonth[month].wins++
    if (t.result === 'loss') byMonth[month].losses++
  }

  const byYear: Record<string, number> = {}
  for (const [month, data] of Object.entries(byMonth)) {
    const year = month.substring(0, 4)
    byYear[year] = (byYear[year] ?? 0) + data.totalR
  }

  const monthlyBreakdown = Object.fromEntries(
    Object.entries(byMonth).map(([m, d]) => [m, { ...d, totalR: r2(d.totalR) }])
  )

  return {
    winRatePct:          dec.length > 0 ? r1((wins.length / dec.length) * 100) : null,
    profitFactor,
    expectancy:          dec.length > 0 ? r2(totalR / dec.length) : null,
    maxDrawdownR:        r2(maxDdR),
    longestLosingStreak: maxLoss,
    longestWinningStreak: maxWin,
    avgMonthlyR:         avg(Object.values(byMonth).map(m => m.totalR)),
    avgYearlyR:          avg(Object.values(byYear)),
    monthlyBreakdown,
  }
}

export function computeMfeMaeSummary(trades: TradeRecord[]): object {
  const withPath = trades.filter(t => t.pathAnalysis !== null)
  const winPath  = withPath.filter(t => t.result === 'win')
  const lossPath = withPath.filter(t => t.result === 'loss')
  const beCount  = withPath.filter(t => t.pathAnalysis!.breakEvenWouldHelp).length
  const t1rRows  = withPath.filter(t => t.pathAnalysis!.timeTo1rMinutes !== null)

  return {
    tradesWithPathAnalysis: withPath.length,
    avgMfeR:                avg(withPath.map(t => t.pathAnalysis!.mfeR ?? 0)),
    avgMaeR:                avg(withPath.map(t => t.pathAnalysis!.maeR ?? 0)),
    avgMfeRForWins:         avg(winPath.map(t => t.pathAnalysis!.mfeR ?? 0)),
    avgMaeRForLosses:       avg(lossPath.map(t => t.pathAnalysis!.maeR ?? 0)),
    pctReaching1r:          pct(withPath.filter(t => t.pathAnalysis!.reached1r).length, withPath.length),
    pctReaching2r:          pct(withPath.filter(t => t.pathAnalysis!.reached2r).length, withPath.length),
    pctReaching3r:          pct(withPath.filter(t => t.pathAnalysis!.reached3r).length, withPath.length),
    pctReaching4r:          pct(withPath.filter(t => (t.pathAnalysis!.mfeR ?? 0) >= 4.0).length, withPath.length),
    pctReaching5r:          pct(withPath.filter(t => (t.pathAnalysis!.mfeR ?? 0) >= 5.0).length, withPath.length),
    breakEvenWouldHelpCount: beCount,
    breakEvenWouldHelpPct:  pct(beCount, withPath.length),
    avgTimeTo1rMinutes:     t1rRows.length > 0 ? Math.round(t1rRows.reduce((s, t) => s + t.pathAnalysis!.timeTo1rMinutes!, 0) / t1rRows.length) : null,
  }
}

export function computeByDayOfWeek(trades: TradeRecord[]): object {
  const days: Record<string, TradeRecord[]> = {
    monday: [], tuesday: [], wednesday: [], thursday: [], friday: [],
  }
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  for (const t of trades) {
    const ukDate = toUKDateString(t.entryTs.getTime())
    const idx    = new Date(ukDate + 'T12:00:00Z').getUTCDay()
    const name   = dayNames[idx]
    if (days[name]) days[name].push(t)
  }
  return Object.fromEntries(Object.entries(days).map(([day, ts]) => [day, groupStats(ts)]))
}

export function computeByEntryHour(trades: TradeRecord[]): object {
  const hours: Record<string, TradeRecord[]> = { '13': [], '14': [], '15': [] }
  for (const t of trades) {
    const h = String(toUKHour(t.entryTs.getTime()))
    if (hours[h]) hours[h].push(t)
  }
  return Object.fromEntries(Object.entries(hours).map(([h, ts]) => [h, groupStats(ts)]))
}

export function computeByBreakoutType(trades: TradeRecord[]): object {
  const types: Record<string, TradeRecord[]> = {}
  for (const t of trades) {
    const bt = t.breakoutType || 'unknown'
    if (!types[bt]) types[bt] = []
    types[bt].push(t)
  }
  return Object.fromEntries(Object.entries(types).map(([bt, ts]) => [bt, groupStats(ts)]))
}

// ── Master export ──────────────────────────────────────────────────────────

export const SUMMARY_TYPES = [
  'overall',
  'strategy_evaluation',
  'mfe_mae_summary',
  'by_day_of_week',
  'by_entry_hour',
  'by_breakout_type',
] as const

export type SummaryType = typeof SUMMARY_TYPES[number]

export function computeAllSummaries(trades: TradeRecord[]): Record<SummaryType, object> {
  return {
    overall:             computeOverall(trades),
    strategy_evaluation: computeStrategyEvaluation(trades),
    mfe_mae_summary:     computeMfeMaeSummary(trades),
    by_day_of_week:      computeByDayOfWeek(trades),
    by_entry_hour:       computeByEntryHour(trades),
    by_breakout_type:    computeByBreakoutType(trades),
  }
}
