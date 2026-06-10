import type { VercelRequest, VercelResponse } from '@vercel/node'

const OANDA_BASE  = 'https://api-fxpractice.oanda.com/v3'
const OANDA_TOKEN = process.env.OANDA_TOKEN ?? ''

// Called via rewrite: /api/oanda/instruments/EUR_USD/candles?count=200&...
// vercel.json rewrites inject _path=instruments/EUR_USD/candles into req.query
// All original query params (count, granularity, price) are merged in too.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { _path = '', ...rest } = req.query as Record<string, string | string[]>
  const oandaPath = '/' + (Array.isArray(_path) ? _path.join('/') : _path)

  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(rest)) {
    if (Array.isArray(v)) v.forEach(x => qs.append(k, x))
    else qs.append(k, v)
  }

  const url = `${OANDA_BASE}${oandaPath}${qs.toString() ? '?' + qs.toString() : ''}`

  const upstream = await fetch(url, {
    method: req.method ?? 'GET',
    headers: {
      Authorization:  `Bearer ${OANDA_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: req.method !== 'GET' && req.method !== 'HEAD'
      ? JSON.stringify(req.body) : undefined,
  })

  const contentType = upstream.headers.get('content-type') ?? 'application/json'
  const body = await upstream.text()
  res.setHeader('Content-Type', contentType)
  res.status(upstream.status).send(body)
}
