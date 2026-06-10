import type { VercelRequest, VercelResponse } from '@vercel/node'

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? ''

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed')
    return
  }

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':          ANTHROPIC_KEY,
      'anthropic-version':  '2023-06-01',
      'Content-Type':       'application/json',
    },
    body: JSON.stringify(req.body),
  })

  const contentType = upstream.headers.get('content-type') ?? 'application/json'
  res.setHeader('Content-Type', contentType)
  res.status(upstream.status)

  if (!upstream.body) {
    const body = await upstream.text()
    res.send(body)
    return
  }

  // Forward SSE stream
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
