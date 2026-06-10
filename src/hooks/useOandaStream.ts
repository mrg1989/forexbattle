import { useEffect, useRef, useState } from 'react'

// Injected at build time by vite.config.ts — never the token, just the account ID
declare const __OANDA_ACCOUNT__: string
declare const __OANDA_CONFIGURED__: boolean
declare const __AI_CONFIGURED__: boolean

const INSTRUMENT_MAP: Record<string, string> = {
  'EUR/USD': 'EUR_USD',
  'GBP/USD': 'GBP_USD',
  'USD/JPY': 'USD_JPY',
  'USD/CHF': 'USD_CHF',
  'AUD/USD': 'AUD_USD',
  'XAU/USD': 'XAU_USD',
}

export type StreamStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'unconfigured'

interface OandaTick {
  price: number
  bid: number
  ask: number
  time: string
}

interface UseOandaStreamReturn {
  status: StreamStatus
  latestTick: OandaTick | null
  error: string | null
}

/**
 * Connects to the OANDA practice price stream via the Vite dev proxy.
 * Calls onTick() for every incoming price update (~4/sec).
 * Falls back gracefully if .env.local is not configured.
 */
export function useOandaStream(
  pair: string,
  onTick: (price: number) => void,
): UseOandaStreamReturn {
  const [status, setStatus]           = useState<StreamStatus>('idle')
  const [latestTick, setLatestTick]   = useState<OandaTick | null>(null)
  const [error, setError]             = useState<string | null>(null)
  const abortRef                      = useRef<AbortController | null>(null)
  const onTickRef                     = useRef(onTick)
  onTickRef.current = onTick  // always latest without re-subscribing

  useEffect(() => {
    if (!__OANDA_CONFIGURED__) {
      setStatus('unconfigured')
      return
    }

    const instrument = INSTRUMENT_MAP[pair]
    if (!instrument) {
      setStatus('error')
      setError(`Unsupported pair: ${pair}`)
      return
    }

    const accountId = __OANDA_ACCOUNT__
    const url = `/api/oanda-stream/accounts/${accountId}/pricing/stream?instruments=${instrument}`

    const controller = new AbortController()
    abortRef.current = controller
    setStatus('connecting')
    setError(null)

    let buffer = ''

    fetch(url, { signal: controller.signal })
      .then(res => {
        if (!res.ok) throw new Error(`OANDA stream ${res.status}: ${res.statusText}`)
        if (!res.body)  throw new Error('No response body')
        setStatus('connected')

        const reader = res.body.getReader()
        const decoder = new TextDecoder()

        const pump = (): Promise<void> =>
          reader.read().then(({ done, value }) => {
            if (done) {
              setStatus('idle')
              return
            }

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''   // keep incomplete last line

            for (const line of lines) {
              const trimmed = line.trim()
              if (!trimmed) continue
              try {
                const msg = JSON.parse(trimmed)
                // OANDA sends either a "PRICE" message or a "HEARTBEAT"
                if (msg.type === 'PRICE' && msg.asks?.[0]?.price && msg.bids?.[0]?.price) {
                  const bid = parseFloat(msg.bids[0].price)
                  const ask = parseFloat(msg.asks[0].price)
                  const mid = (bid + ask) / 2
                  const tick: OandaTick = { price: mid, bid, ask, time: msg.time }
                  setLatestTick(tick)
                  onTickRef.current(mid)
                }
              } catch {
                // ignore malformed lines
              }
            }

            return pump()
          })

        return pump()
      })
      .catch(err => {
        if (err.name === 'AbortError') return   // intentional disconnect
        console.error('[OANDA stream]', err)
        setStatus('error')
        setError(err.message ?? 'Stream error')
      })

    return () => {
      controller.abort()
      abortRef.current = null
    }
  }, [pair])   // reconnect if pair changes

  return { status, latestTick, error }
}
