// Server-side OANDA REST client for candle ingestion.
// NOT a browser proxy — calls OANDA directly using OANDA_TOKEN from process.env.
// Must only be imported from api/ serverless functions or src/lib/candle-ingestion.ts.

const OANDA_BASE  = 'https://api-fxpractice.oanda.com/v3'
const PAGE_SIZE   = 5000

export interface RawOandaCandle {
  time:     string
  mid:      { o: string; h: string; l: string; c: string }
  volume:   number
  complete: boolean
}

interface OandaCandleResponse {
  candles?: RawOandaCandle[]
  errorMessage?: string
}

// Fetch a single page: up to PAGE_SIZE complete candles starting at `fromRfc3339`.
// Returns an empty array on non-200 or empty responses.
async function fetchPage(
  instrument:  string,
  granularity: string,
  fromRfc3339: string,
): Promise<RawOandaCandle[]> {
  const token = process.env.OANDA_TOKEN
  if (!token) throw new Error('OANDA_TOKEN not set')

  const url =
    `${OANDA_BASE}/instruments/${instrument}/candles` +
    `?granularity=${granularity}&count=${PAGE_SIZE}&from=${encodeURIComponent(fromRfc3339)}&price=M`

  const res = await fetch(url, {
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`OANDA ${res.status}: ${body}`)
  }

  const data = (await res.json()) as OandaCandleResponse
  return (data.candles ?? []).filter(c => c.complete)
}

// Fetch ALL complete candles for the given instrument/granularity between from and to.
// Paginates automatically (PAGE_SIZE candles per request).
// Calls onProgress(totalFetched) after each page if provided.
export async function fetchAllCandles(
  instrument:  string,
  granularity: string,
  from:        Date,
  to:          Date,
  onProgress?: (totalFetched: number) => void,
): Promise<RawOandaCandle[]> {
  const all: RawOandaCandle[] = []
  let fromRfc3339 = from.toISOString()
  const toMs = to.getTime()

  for (;;) {
    const page = await fetchPage(instrument, granularity, fromRfc3339)

    if (page.length === 0) break

    // Keep only candles within the requested range
    const inRange = page.filter(c => new Date(c.time).getTime() <= toMs)
    all.push(...inRange)
    onProgress?.(all.length)

    // Stop if we've passed `to` or didn't fill a full page
    if (inRange.length < page.length || page.length < PAGE_SIZE) break

    // Advance 1 second past the last candle to avoid re-fetching it
    const lastTs = new Date(page[page.length - 1].time).getTime()
    fromRfc3339  = new Date(lastTs + 1000).toISOString()

    // Safety: stop if we've already passed the requested end
    if (lastTs >= toMs) break
  }

  return all
}
