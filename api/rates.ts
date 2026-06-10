import type { VercelRequest, VercelResponse } from '@vercel/node'

// Proxy for frankfurter.app — avoids CORS issues when called from the browser.
// Usage: /api/rates?from=EUR&to=USD
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { from = 'EUR', to = 'USD' } = req.query as Record<string, string>
  try {
    const upstream = await fetch(
      `https://api.frankfurter.dev/v1/latest?from=${from}&to=${to}`,
      { headers: { Accept: 'application/json' } }
    )
    const body = await upstream.text()
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120')
    res.status(upstream.status).send(body)
  } catch (e) {
    res.status(502).json({ error: 'upstream fetch failed' })
  }
}
