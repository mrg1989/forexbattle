import type { VercelRequest, VercelResponse } from '@vercel/node'
import { ingestCandles } from '../_lib/candle-ingestion.js'

const ALLOWED_SYMBOLS    = ['EUR_USD', 'GBP_USD'] as const
const ALLOWED_TIMEFRAMES = ['M5', 'M15'] as const

function isAllowedSymbol(s: string): s is typeof ALLOWED_SYMBOLS[number] {
  return (ALLOWED_SYMBOLS as readonly string[]).includes(s)
}
function isAllowedTimeframe(s: string): s is typeof ALLOWED_TIMEFRAMES[number] {
  return (ALLOWED_TIMEFRAMES as readonly string[]).includes(s)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  const secret = process.env.ADMIN_SECRET
  if (!secret || req.headers['authorization'] !== `Bearer ${secret}`) {
    return res.status(401).json({ success: false, error: 'Unauthorized' })
  }

  const { symbol, timeframe, from, to } = req.body as {
    symbol?:    string
    timeframe?: string
    from?:      string
    to?:        string
  }

  if (!symbol || !timeframe || !from || !to) {
    return res.status(400).json({ success: false, error: 'symbol, timeframe, from, and to are required' })
  }
  if (!isAllowedSymbol(symbol)) {
    return res.status(400).json({ success: false, error: `symbol must be one of: ${ALLOWED_SYMBOLS.join(', ')}` })
  }
  if (!isAllowedTimeframe(timeframe)) {
    return res.status(400).json({ success: false, error: `timeframe must be one of: ${ALLOWED_TIMEFRAMES.join(', ')}` })
  }

  const fromDate = new Date(from)
  const toDate   = new Date(to)

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    return res.status(400).json({ success: false, error: 'from and to must be valid ISO date strings' })
  }
  if (fromDate >= toDate) {
    return res.status(400).json({ success: false, error: 'from must be before to' })
  }

  try {
    const result = await ingestCandles(symbol, timeframe, fromDate, toDate)
    return res.status(200).json({ success: true, data: result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return res.status(500).json({ success: false, error: message })
  }
}
