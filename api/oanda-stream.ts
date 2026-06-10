import type { VercelRequest, VercelResponse } from '@vercel/node'

const STREAM_BASE = 'https://stream-fxpractice.oanda.com/v3'
const OANDA_TOKEN = process.env.OANDA_TOKEN ?? ''

// Called via rewrite: /api/oanda-stream/accounts/.../pricing/stream?instruments=...
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { _path = '', ...rest } = req.query as Record<string, string | string[]>
  const oandaPath = '/' + (Array.isArray(_path) ? _path.join('/') : _path)

  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(rest)) {
    if (Array.isArray(v)) v.forEach(x => qs.append(k, x))
    else qs.append(k, v)
  }

  const url = `${STREAM_BASE}${oandaPath}${qs.toString() ? '?' + qs.toString() : ''}`

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
