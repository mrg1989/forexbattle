import type { VercelRequest, VercelResponse } from '@vercel/node'

const OANDA_BASE  = 'https://api-fxpractice.oanda.com/v3'
const OANDA_TOKEN = process.env.OANDA_TOKEN ?? ''

// Catch-all: handles /api/oanda/instruments/EUR_USD/candles?count=200&...
// req.query.path = ['instruments', 'EUR_USD', 'candles'] — the catch-all segments
// All other req.query keys are the real query params (count, granularity, etc.)
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const segments = Array.isArray(req.query.path)
    ? req.query.path
    : [req.query.path ?? '']
  const oandaPath = '/' + segments.join('/')

  // Reconstruct query string from remaining params (strip out the 'path' catch-all key)
  const { path: _p, ...qp } = req.query as Record<string, string | string[]>
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(qp)) {
    if (Array.isArray(v)) v.forEach(x => qs.append(k, x))
    else qs.append(k, v)
  }
  const queryString = qs.toString() ? '?' + qs.toString() : ''
  const url = `${OANDA_BASE}${oandaPath}${queryString}`

  const upstream = await fetch(url, {
    method:  req.method ?? 'GET',
    headers: {
      Authorization:  `Bearer ${OANDA_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: req.method !== 'GET' && req.method !== 'HEAD'
      ? JSON.stringify(req.body)
      : undefined,
  })

  const contentType = upstream.headers.get('content-type') ?? 'application/json'
  const body = await upstream.text()
  res.setHeader('Content-Type', contentType)
  res.status(upstream.status).send(body)
}
