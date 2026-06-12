import { db } from './db.js'
import { fetchAllCandles, type RawOandaCandle } from './oanda-client.js'

export interface IngestResult {
  symbol:    string
  timeframe: string
  inserted:  number
  skipped:   number
  invalid:   number
  errors:    string[]
}

function isValidCandle(c: RawOandaCandle): boolean {
  const o = parseFloat(c.mid.o)
  const h = parseFloat(c.mid.h)
  const l = parseFloat(c.mid.l)
  const cl = parseFloat(c.mid.c)
  return h >= Math.max(o, cl) && l <= Math.min(o, cl)
}

export async function ingestCandles(
  symbol:    string,
  timeframe: string,
  from:      Date,
  to:        Date,
): Promise<IngestResult> {
  const errors: string[] = []
  let invalid = 0

  const raw = await fetchAllCandles(symbol, timeframe, from, to)

  const valid = raw.filter(c => {
    if (isValidCandle(c)) return true
    invalid++
    return false
  })

  const rows = valid.map(c => ({
    symbol,
    timeframe,
    timestampUtc: new Date(c.time),
    open:         parseFloat(c.mid.o),
    high:         parseFloat(c.mid.h),
    low:          parseFloat(c.mid.l),
    close:        parseFloat(c.mid.c),
    volume:       c.volume,
    source:       'oanda',
  }))

  let inserted = 0
  let skipped  = 0

  if (rows.length > 0) {
    try {
      const result = await db.candle.createMany({
        data:           rows,
        skipDuplicates: true,
      })
      inserted = result.count
      skipped  = rows.length - result.count
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`createMany failed: ${msg}`)
    }
  }

  await db.importLog.create({
    data: {
      symbol,
      timeframe,
      fromDate:     from,
      toDate:       to,
      candleCount:  inserted,
      status:       errors.length > 0 ? 'partial' : 'completed',
      errorMessage: errors.length > 0 ? errors.join('; ') : null,
    },
  })

  return { symbol, timeframe, inserted, skipped, invalid, errors }
}
