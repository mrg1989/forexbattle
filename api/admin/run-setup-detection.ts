import type { VercelRequest, VercelResponse } from '@vercel/node'
import { runSetupDetectionForRange } from '../_lib/crossfire-setup.js'
import { getActiveStrategyVersion } from '../_lib/strategy-registry.js'

const ALLOWED_SYMBOLS = ['EUR_USD', 'GBP_USD']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  const secret = process.env.ADMIN_SECRET
  if (!secret || req.headers['authorization'] !== `Bearer ${secret}`) {
    return res.status(401).json({ success: false, error: 'Unauthorized' })
  }

  const { symbol, from, to, strategyVersionId } = req.body ?? {}

  if (!symbol || !ALLOWED_SYMBOLS.includes(symbol)) {
    return res.status(400).json({ success: false, error: `symbol must be one of: ${ALLOWED_SYMBOLS.join(', ')}` })
  }
  if (!from || !DATE_RE.test(from)) {
    return res.status(400).json({ success: false, error: 'from must be YYYY-MM-DD' })
  }
  if (!to || !DATE_RE.test(to)) {
    return res.status(400).json({ success: false, error: 'to must be YYYY-MM-DD' })
  }
  if (from > to) {
    return res.status(400).json({ success: false, error: 'from must be <= to' })
  }

  let svId: string = strategyVersionId
  if (!svId) {
    const version = await getActiveStrategyVersion('Crossfire')
    if (!version) {
      return res.status(400).json({
        success: false,
        error: 'No active Crossfire strategy version found — run POST /api/admin/seed-strategies first.',
      })
    }
    svId = version.id
  }

  try {
    const result = await runSetupDetectionForRange(
      symbol,
      svId,
      new Date(from + 'T00:00:00Z'),
      new Date(to + 'T00:00:00Z'),
    )

    return res.status(200).json({ success: true, data: result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return res.status(500).json({ success: false, error: message })
  }
}
