import type { VercelRequest, VercelResponse } from '@vercel/node'
import { db } from '../../src/lib/db'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  const secret = process.env.ADMIN_SECRET
  if (!secret || req.headers['authorization'] !== `Bearer ${secret}`) {
    return res.status(401).json({ success: false, error: 'Unauthorized' })
  }

  try {
    const groups = await db.candle.groupBy({
      by:      ['symbol', 'timeframe'],
      _count:  { id: true },
      _min:    { timestampUtc: true },
      _max:    { timestampUtc: true },
      orderBy: [{ symbol: 'asc' }, { timeframe: 'asc' }],
    })

    const data = groups.map(g => ({
      symbol:       g.symbol,
      timeframe:    g.timeframe,
      count:        g._count.id,
      earliestDate: g._min.timestampUtc,
      latestDate:   g._max.timestampUtc,
    }))

    return res.status(200).json({ success: true, data })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return res.status(500).json({ success: false, error: message })
  }
}
