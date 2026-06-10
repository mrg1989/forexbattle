import type { VercelRequest, VercelResponse } from '@vercel/node'

const OANDA_BASE    = 'https://api-fxpractice.oanda.com/v3'
const OANDA_TOKEN   = process.env.OANDA_TOKEN ?? ''

// Catch-all: handles /api/oanda/instruments/EUR_USD/candles?count=200&...
// req.url contains the full original path + query string
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const path = req.url?.replace(/^\/api\/oanda/, '') ?? ''
  const url  = `${OANDA_BASE}${path}`

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
