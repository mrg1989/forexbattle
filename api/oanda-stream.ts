import type { VercelRequest, VercelResponse } from '@vercel/node'

const STREAM_BASE  = 'https://stream-fxpractice.oanda.com/v3'
const OANDA_TOKEN  = process.env.OANDA_TOKEN ?? ''

// Vercel streaming response — forwards OANDA price stream to the browser
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const path = req.url?.replace(/^\/api\/oanda-stream/, '') ?? ''
  const url  = `${STREAM_BASE}${path}`

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
