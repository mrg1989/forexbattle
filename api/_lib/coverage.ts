import { db } from './db.js'

// Metadata for every timeframe the system knows about.
// Add H1/H4/D1 entries here when those import/analysis stages are built.
export const TIMEFRAME_META: Record<string, {
  candlesPerWeekday: number   // expected candles on a Mon–Fri trading day (24-hr forex)
  description:       string
  supported:         boolean  // can be imported and used in the pipeline today
  stage:             string   // human-readable description of what this TF is used for
}> = {
  M5:  { candlesPerWeekday: 288, description: '5-minute',  supported: true,  stage: 'Signal detection · trade simulation · path analysis' },
  M15: { candlesPerWeekday: 96,  description: '15-minute', supported: true,  stage: 'Setup detection (08:00–13:00 UK window)' },
  H1:  { candlesPerWeekday: 24,  description: '1-hour',    supported: false, stage: 'Planned — H1 trend filter (not yet active)' },
  H4:  { candlesPerWeekday: 6,   description: '4-hour',    supported: false, stage: 'Planned — H4 bias filter (not yet active)' },
  D1:  { candlesPerWeekday: 1,   description: 'Daily',     supported: false, stage: 'Planned — daily range / PDH / PDL (not yet active)' },
}

// Count Monday–Friday days in [from, to] inclusive (UTC calendar dates).
// Weekend days are excluded because OANDA does not produce candles for Sat/Sun.
export function countWeekdays(from: Date, to: Date): number {
  let count = 0
  const cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))
  const end = new Date(Date.UTC(to.getUTCFullYear(),   to.getUTCMonth(),   to.getUTCDate()))
  while (cur <= end) {
    const dow = cur.getUTCDay()
    if (dow !== 0 && dow !== 6) count++
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return count
}

export interface CoverageRow {
  symbol:          string
  timeframe:       string
  actualCount:     number
  expectedCount:   number   // weekdays × candlesPerWeekday; excludes bank holidays (estimate)
  missingEstimate: number   // max(0, expected − actual)
  coveragePct:     number   // 0–100, capped at 100
  earliestCandle:  string | null   // ISO
  latestCandle:    string | null   // ISO
  lastImportAt:    string | null   // ISO — most recent completed import_log row
  source:          string | null   // 'oanda' when data is present
  hasData:         boolean
  needsImport:     boolean         // supported + coveragePct < 90
  supported:       boolean
  stage:           string
}

// Compute coverage stats for every (symbol × timeframe) combination requested.
// Uses one groupBy query for candles and one findMany for import logs — no N+1.
export async function computeCoverage(
  symbols:    string[],
  timeframes: string[],
  from:       Date,
  to:         Date,
): Promise<CoverageRow[]> {
  const [candleGroups, importLogs] = await Promise.all([
    db.candle.groupBy({
      by:    ['symbol', 'timeframe'],
      where: {
        symbol:       { in: symbols },
        timeframe:    { in: timeframes },
        timestampUtc: { gte: from, lte: to },
      },
      _count: { id: true },
      _min:   { timestampUtc: true },
      _max:   { timestampUtc: true },
    }),
    db.importLog.findMany({
      where:   { symbol: { in: symbols }, timeframe: { in: timeframes }, status: 'completed' },
      orderBy: { createdAt: 'desc' },
      select:  { symbol: true, timeframe: true, createdAt: true },
    }),
  ])

  const weekdays = countWeekdays(from, to)

  // Keep only the most-recent import per (symbol, timeframe)
  const lastImportMap = new Map<string, Date>()
  for (const log of importLogs) {
    const key = `${log.symbol}|${log.timeframe}`
    if (!lastImportMap.has(key)) lastImportMap.set(key, log.createdAt)
  }

  const rows: CoverageRow[] = []

  for (const symbol of symbols) {
    for (const tf of timeframes) {
      const meta          = TIMEFRAME_META[tf]
      const cg            = candleGroups.find(g => g.symbol === symbol && g.timeframe === tf)
      const lastImp       = lastImportMap.get(`${symbol}|${tf}`)
      const cpd           = meta?.candlesPerWeekday ?? 96
      const expectedCount = weekdays * cpd
      const actualCount   = cg?._count.id ?? 0
      const missing       = Math.max(0, expectedCount - actualCount)
      // One decimal place; cap at 100 to avoid >100% when bank-holiday candles are absent
      const coveragePct   = expectedCount > 0
        ? Math.min(100, Math.round(actualCount / expectedCount * 1000) / 10)
        : 0

      rows.push({
        symbol,
        timeframe:       tf,
        actualCount,
        expectedCount,
        missingEstimate: missing,
        coveragePct,
        earliestCandle:  cg?._min.timestampUtc?.toISOString() ?? null,
        latestCandle:    cg?._max.timestampUtc?.toISOString() ?? null,
        lastImportAt:    lastImp?.toISOString() ?? null,
        source:          actualCount > 0 ? 'oanda' : null,
        hasData:         actualCount > 0,
        needsImport:     coveragePct < 90 && (meta?.supported ?? false),
        supported:       meta?.supported ?? false,
        stage:           meta?.stage ?? '',
      })
    }
  }

  return rows
}
