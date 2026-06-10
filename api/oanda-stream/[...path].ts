import type { VercelRequest, VercelResponse } from '@vercel/node'

const STREAM_BASE = 'https://stream-fxpractice.oanda.com/v3'
const OANDA_TOKEN = process.env.OANDA_TOKEN ?? ''

// Catch-all: handles /api/oanda-stream/accounts/.../pricing/stream?instruments=...
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const segments = Array.isArray(req.query.path)
    ? req.query.path
    : [req.query.path ?? '']
  const oandaPath = '/' + segments.join('/')

  const { path: _p, ...qp } = req.query as Record<string, string | string[]>
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(qp)) {
    if (Array.isArray(v)) v.forEach(x => qs.append(k, x))
    else qs.append(k, v)
  }
  const queryString = qs.toString() ? '?' + qs.toString() : ''
  const url = `${STREAM_BASE}${oandaPath}${queryString}`

  const upstream = await fetch(url, {
    headers: { Authorization: `Bearer ${OANDA_TOKEN}` },
  })

  if (!upstream.ok || !upstream.body) {
    res.status(upstream.status).send('Stream unavailable')
    return
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Transfer-Encoding', 'chunked')
  res.setHeader('Cache-Control', 'no-cache')

  const reader = upstream.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(value)
    }
  } finally {
    res.end()
  }
}
