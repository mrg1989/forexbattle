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

  try {
    const strategies = await db.strategy.findMany({
      include: {
        versions: {
          orderBy: { versionNumber: 'asc' },
          select: {
            id:            true,
            versionNumber: true,
            isActive:      true,
            isLiveApproved:true,
            notes:         true,
            settingsJson:  true,
            createdAt:     true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    })

    return res.status(200).json({ success: true, data: strategies })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return res.status(500).json({ success: false, error: message })
  }
}
