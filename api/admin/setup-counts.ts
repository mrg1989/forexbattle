import type { VercelRequest, VercelResponse } from '@vercel/node'
import { db } from '../_lib/db.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  const secret = process.env.ADMIN_SECRET
  if (!secret || req.headers['authorization'] !== `Bearer ${secret}`) {
    return res.status(401).json({ success: false, error: 'Unauthorized' })
  }

  const symbol = req.query.symbol ? String(req.query.symbol) : undefined

  try {
    const where = symbol ? { symbol } : {}

    const [grouped, dateRanges] = await Promise.all([
      db.crossfireSetup.groupBy({
        by:    ['symbol', 'strategyVersionId', 'setupValid'],
        where,
        _count: { id: true },
      }),
      db.crossfireSetup.groupBy({
        by:   ['symbol', 'strategyVersionId'],
        where,
        _min: { dateUk: true },
        _max: { dateUk: true },
      }),
    ])

    const data = dateRanges.map(dr => {
      const validCount = grouped.find(
        g => g.symbol === dr.symbol && g.strategyVersionId === dr.strategyVersionId && g.setupValid === true
      )?._count.id ?? 0

      const invalidCount = grouped.find(
        g => g.symbol === dr.symbol && g.strategyVersionId === dr.strategyVersionId && g.setupValid === false
      )?._count.id ?? 0

      return {
        symbol:            dr.symbol,
        strategyVersionId: dr.strategyVersionId,
        totalCount:        validCount + invalidCount,
        validCount,
        invalidCount,
        earliestDate:      dr._min.dateUk,
        latestDate:        dr._max.dateUk,
      }
    })

    return res.status(200).json({ success: true, data })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return res.status(500).json({ success: false, error: message })
  }
}
