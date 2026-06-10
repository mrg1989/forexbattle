/**
 * /api/signal — Trading signal relay for MT5 EA
 *
 * POST /api/signal  (from web app when Crossfire fires + all filters pass)
 *   Body: { pair, direction, entry, sl, tp, slPips, tpPips, timestamp }
 *
 * GET  /api/signal  (polled by MT5 EA every 10 seconds)
 *   Returns: signal JSON or { pending: false } if no new signal
 *
 * Signal is consumed once — GET clears it (one-shot delivery).
 *
 * Secret header X-Signal-Key (set in env as SIGNAL_KEY) prevents
 * unauthorised parties from reading or posting signals.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'

// In-memory store — resets on cold start, fine for one signal at a time.
// For production persistence use Vercel KV (one line swap).
let pendingSignal: Record<string, unknown> | null = null
let signalId = 0

const SIGNAL_KEY = process.env.SIGNAL_KEY ?? ''

function authOk(req: VercelRequest): boolean {
  if (!SIGNAL_KEY) return true   // no key set = open (dev only)
  return req.headers['x-signal-key'] === SIGNAL_KEY
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Signal-Key')

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  if (!authOk(req)) {
    res.status(401).json({ error: 'Unauthorised' })
    return
  }

  if (req.method === 'POST') {
    // Web app posts a new signal
    signalId++
    pendingSignal = { ...req.body, id: signalId, receivedAt: new Date().toISOString() }
    console.log(`[signal] New signal #${signalId}:`, pendingSignal)
    res.status(200).json({ ok: true, id: signalId })
    return
  }

  if (req.method === 'GET') {
    if (!pendingSignal) {
      res.status(200).json({ pending: false })
      return
    }
    // Consume — MT5 gets it once, then it's cleared
    const signal = pendingSignal
    pendingSignal = null
    res.status(200).json({ pending: true, signal })
    return
  }

  res.status(405).send('Method not allowed')
}
