import { useState, useEffect } from 'react'

/**
 * Fetches the live EUR/USD (or any pair) rate from the free Frankfurter API.
 * Updates every 60 seconds. Falls back gracefully on network errors.
 */
export function useLiveRate(pair: string) {
  const [rate, setRate]           = useState<number | null>(null)
  const [lastUpdated, setUpdated] = useState<Date | null>(null)
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    const parts = pair.split('/')
    if (parts.length !== 2) return
    const [base, quote] = parts

    const load = () => {
      fetch(`/api/rates?from=${base}&to=${quote}`)
        .then(r => { if (!r.ok) throw new Error('bad response'); return r.json() })
        .then(d => {
          const p = d?.rates?.[quote]
          if (typeof p === 'number') {
            setRate(p)
            setUpdated(new Date())
          }
        })
        .catch(() => {/* silent fallback */})
        .finally(() => setLoading(false))
    }

    load()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [pair])

  return { rate, lastUpdated, loading }
}
