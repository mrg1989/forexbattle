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
    const tradeWhere = symbol ? { symbol } : {}
    const signalWhere = symbol ? { setup: { symbol } } : {}

    const [runs, tradesByResult, signalsByDirection] = await Promise.all([
      db.backtestRun.findMany({
        where:   symbol ? { symbol } : {},
        orderBy: { startedAt: 'desc' },
        take:    20,
      }),
      db.trade.groupBy({
        by:   ['result'],
        where: tradeWhere,
        _count: { id: true },
      }),
      db.signal.groupBy({
        by:    ['direction'],
        where: signalWhere,
        _count: { id: true },
      }),
    ])

    const totalTrades  = tradesByResult.reduce((s, r) => s + r._count.id, 0)
    const totalSignals = signalsByDirection.reduce((s, r) => s + r._count.id, 0)

    return res.status(200).json({
      success: true,
      data: {
        runs,
        summary: {
          totalSignals,
          totalTrades,
          signalsByDirection,
          tradesByResult,
        },
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return res.status(500).json({ success: false, error: message })
  }
}
