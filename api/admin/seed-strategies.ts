import type { VercelRequest, VercelResponse } from '@vercel/node'
import { ensureCrossfireV1 } from '../_lib/strategy-registry.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  const secret = process.env.ADMIN_SECRET
  if (!secret || req.headers['authorization'] !== `Bearer ${secret}`) {
    return res.status(401).json({ success: false, error: 'Unauthorized' })
  }

  try {
    const { strategy, version, created } = await ensureCrossfireV1()
    return res.status(200).json({
      success: true,
      data: {
        created,
        strategy: {
          id:          strategy.id,
          name:        strategy.name,
          description: strategy.description,
          status:      strategy.status,
        },
        version: {
          id:            version.id,
          versionNumber: version.versionNumber,
          isActive:      version.isActive,
          notes:         version.notes,
          settingsJson:  version.settingsJson,
        },
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return res.status(500).json({ success: false, error: message })
  }
}
