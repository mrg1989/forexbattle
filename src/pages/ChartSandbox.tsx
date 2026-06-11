import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { useGameStore } from '../store/gameStore'
import { useOandaStream } from '../hooks/useOandaStream'
import CandlestickChart from '../components/chart/CandlestickChart'
import AiAnalysisPanel from '../components/AiAnalysisPanel'
import { computeCrossfireWithLevels, computeCrossfireAll, runCrossfireBacktest, runCrossfireAiBacktest, evaluateLiveSignal } from '../utils/strategies'
import type { BacktestStats, BacktestTrade, CrossfireAiSettings, LiveSignal } from '../utils/strategies'
import { CROSSFIRE_AI_DEFAULTS } from '../utils/strategies'
import { runSmcBacktest, SMC_DEFAULTS } from '../utils/smcStrategy'
import type { SmcSettings } from '../utils/smcStrategy'
import type { Candle } from '../types'

const TIMEFRAMES = [
  { label: '5s',  oanda: 'S5',  seconds: 5    },
  { label: '10s', oanda: 'S10', seconds: 10   },
  { label: '30s', oanda: 'S30', seconds: 30   },
  { label: '1m',  oanda: 'M1',  seconds: 60   },
  { label: '5m',  oanda: 'M5',  seconds: 300  },
  { label: '15m', oanda: 'M15', seconds: 900  },
  { label: '30m', oanda: 'M30', seconds: 1800 },
  { label: '1H',  oanda: 'H1',  seconds: 3600 },
]
const PAIRS = ['EUR/USD','GBP/USD','USD/JPY','AUD/USD','USD/CHF','XAU/USD']
const PAIR_LABELS: Record<string,string> = {
  'EUR/USD':'EUR/USD','GBP/USD':'GBP/USD','USD/JPY':'USD/JPY',
  'AUD/USD':'AUD/USD','USD/CHF':'USD/CHF','XAU/USD':'Gold (XAU/USD)',
}
const INSTRUMENT_MAP: Record<string,string> = {
  'EUR/USD':'EUR_USD','GBP/USD':'GBP_USD','USD/JPY':'USD_JPY',
  'AUD/USD':'AUD_USD','USD/CHF':'USD_CHF','XAU/USD':'XAU_USD',
}

function toCandle(raw: {time:string;mid:{o:string;h:string;l:string;c:string};volume:number}): Candle {
  return {
    timestamp: new Date(raw.time).getTime(),
    open:  parseFloat(raw.mid.o), high: parseFloat(raw.mid.h),
    low:   parseFloat(raw.mid.l), close:parseFloat(raw.mid.c),
    volume: raw.volume,
  }
}

function useChartSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(e => {
      const { width, height } = e[0].contentRect
      setSize({ w: Math.floor(width), h: Math.floor(height) })
    })
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [ref])
  return size
}

function StatChip({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col items-center gap-0">
      <span style={{ fontSize: 8, color: 'rgba(241,241,255,0.35)', letterSpacing: '0.07em', textTransform: 'uppercase' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 800, color: color ?? 'rgba(241,241,255,0.85)', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  )
}

export default function ChartSandbox() {
  const { goTo, pushLiveTick, setLiveBasePrice } = useGameStore()

  const [pair,       setPair]       = useState('EUR/USD')
  const [tfIdx,      setTfIdx]      = useState(1)
  const [candles,    setCandles]    = useState<Candle[]>([])
  const [liveCandle, setLiveCandle] = useState<Candle | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [fetchErr,   setFetchErr]   = useState<string | null>(null)
  const [tickCount,  setTickCount]  = useState(0)
  const [firstPrice, setFirstPrice] = useState<number | null>(null)
  const [countdown,  setCountdown]  = useState(0)
  const [openMenu,   setOpenMenu]   = useState<'pair' | 'tf' | 'strategies' | 'ai' | null>(null)
  const [activeStrategy,  setActiveStrategy]  = useState<string | null>(null)
  const [backtestMode,    setBacktestMode]    = useState(false)
  const [slMode,          setSlMode]          = useState<'static' | 'dynamic'>('static')
  const [slPips,          setSlPips]          = useState(10)
  const [rrRatio,         setRrRatio]         = useState(2.0)
  const [requireFullBody, setRequireFullBody] = useState(false)
  const [showAiPanel,     setShowAiPanel]     = useState(false)
  const [btTrades,        setBtTrades]        = useState<BacktestTrade[]>([])
  // AI Strategy mode
  const [aiStrategyMode,  setAiStrategyMode]  = useState(false)
  const [aiSettings,      setAiSettings]      = useState<CrossfireAiSettings>({
    ...CROSSFIRE_AI_DEFAULTS,
    pipSize: 0.0001,
  })
  // Deep historical backtest
  const [deepCandles,     setDeepCandles]     = useState<Candle[]>([])
  const [deepLoading,     setDeepLoading]     = useState(false)
  const [deepProgress,    setDeepProgress]    = useState(0)
  const [startingAccount, setStartingAccount] = useState(1000)
  // SMC Strategy mode
  const [smcMode,         setSmcMode]         = useState(false)
  const [smcSettings,     setSmcSettings]     = useState<SmcSettings>({ ...SMC_DEFAULTS })
  // Live signal state
  const [liveSignal,      setLiveSignal]      = useState<LiveSignal | null>(null)
  const liveSignalSentRef = useRef<number>(0)  // timestamp of last signal sent — prevents duplicate POSTs

  const liveCandleRef     = useRef<Candle | null>(null)
  const candleStartRef    = useRef<number>(0)
  const histLoadingRef    = useRef(false)   // prevents duplicate history fetches
  const deepFetchIdRef    = useRef(0)       // cancels stale deep fetches on pair/tf change
  const candlesRef        = useRef<Candle[]>([])
  const aiStrategyModeRef = useRef(false)
  const aiSettingsRef     = useRef<CrossfireAiSettings>({ ...CROSSFIRE_AI_DEFAULTS, pipSize: 0.0001 })
  const chartRef          = useRef<HTMLDivElement>(null)
  const menuRef           = useRef<HTMLDivElement>(null)
  const { w: chartW, h: chartH } = useChartSize(chartRef)

  const tf = TIMEFRAMES[tfIdx]

  // Close dropdowns on outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(null)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  // ── Initial candle fetch ──────────────────────────────────────────────────
  useEffect(() => {
    const instrument = INSTRUMENT_MAP[pair]
    if (!instrument) return
    setLoading(true); setFetchErr(null); setCandles([]); setLiveCandle(null)
    liveCandleRef.current = null; setTickCount(0); setFirstPrice(null)

    fetch(`/api/oanda/instruments/${instrument}/candles?count=200&granularity=${tf.oanda}&price=M`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(d => {
        const raw: Candle[] = (d.candles ?? []).filter((c:{complete:boolean}) => c.complete).map(toCandle)
        if (raw.length === 0) throw new Error('No candles returned')
        const last      = raw[raw.length - 1]
        const nowMs     = Date.now()
        const periodMs  = tf.seconds * 1000
        const pStart    = Math.floor(nowMs / periodMs) * periodMs
        const live: Candle = { timestamp: pStart, open: last.close, high: last.close, low: last.close, close: last.close, volume: 0 }
        liveCandleRef.current  = live
        candleStartRef.current = pStart
        setCandles(raw); setLiveCandle(live); setLiveBasePrice(last.close); setLoading(false)
        histLoadingRef.current = false
      })
      .catch(e => { setFetchErr(e.message); setLoading(false) })
  }, [pair, tfIdx])

  // ── Candle roll ───────────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      const lc = liveCandleRef.current; if (!lc) return
      const nowMs = Date.now(), periodMs = tf.seconds * 1000
      if (nowMs - candleStartRef.current >= periodMs) {
        const closed   = { ...lc }
        const newStart = Math.floor(nowMs / periodMs) * periodMs
        const newLive: Candle = { timestamp: newStart, open: closed.close, high: closed.close, low: closed.close, close: closed.close, volume: 0 }
        candleStartRef.current = newStart; liveCandleRef.current = newLive
        setCandles(prev => [...prev, closed])
        setLiveCandle({ ...newLive })
      }
    }, 500)
    return () => clearInterval(id)
  }, [tfIdx])

  // ── Countdown timer ───────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      setCountdown(Math.ceil(Math.max(0, tf.seconds * 1000 - (Date.now() - candleStartRef.current)) / 1000))
    }, 200)
    return () => clearInterval(id)
  }, [tfIdx])

  // ── OANDA stream ──────────────────────────────────────────────────────────
  const handleTick = useCallback((price: number) => {
    const lc = liveCandleRef.current; if (!lc) return
    const upd: Candle = { ...lc, close: price, high: Math.max(lc.high, price), low: Math.min(lc.low, price), volume: lc.volume + 1 }
    liveCandleRef.current = upd
    setLiveCandle({ ...upd }); pushLiveTick(price)
    setTickCount(n => n + 1); setFirstPrice(p => p ?? price)

    // Live signal evaluation — only when AI strategy mode is on
    if (aiStrategyModeRef.current) {
      const pipSz = pair.includes('JPY') || pair.includes('XAU') ? 0.01 : 0.0001
      const s = { ...aiSettingsRef.current, pipSize: pipSz }
      const signal = evaluateLiveSignal(candlesRef.current, upd, s, pair)
      if (signal && signal.timestamp !== liveSignalSentRef.current) {
        liveSignalSentRef.current = signal.timestamp
        setLiveSignal(signal)
        // POST to signal endpoint (Vercel or local dev server)
        fetch('/api/signal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(signal),
        }).catch(() => { /* non-critical */ })
      }
    }
  }, [pushLiveTick, pair])

  const { status: streamStatus } = useOandaStream(pair, handleTick)
  const isLive = streamStatus === 'connected'

  // ── Infinite scroll back: fetch older candles ────────────────────────────
  const handleNeedHistory = useCallback((beforeMs: number) => {
    if (histLoadingRef.current) return
    histLoadingRef.current = true
    const instrument = INSTRUMENT_MAP[pair]
    // Fetch 200 complete candles ending just before the oldest we have
    const to  = new Date(beforeMs - 500).toISOString()
    const url = `/api/oanda/instruments/${instrument}/candles?count=200&to=${to}&granularity=${tf.oanda}&price=M`
    fetch(url)
      .then(r => r.json())
      .then(d => {
        const older: Candle[] = (d.candles ?? []).filter((c:{complete:boolean}) => c.complete).map(toCandle)
        if (older.length > 0) {
          setCandles(prev => [...older, ...prev])
        }
        histLoadingRef.current = false
      })
      .catch(() => { histLoadingRef.current = false })
  }, [pair, tfIdx])

  // ── Deep historical fetch: auto-loads ~1 year of data for full backtest ──
  const handleDeepFetch = useCallback(async () => {
    const fetchId = ++deepFetchIdRef.current
    setDeepLoading(true); setDeepProgress(0); setDeepCandles([])
    const instrument = INSTRUMENT_MAP[pair]
    const BATCHES = 20
    const COUNT   = 5000
    let allCandles: Candle[] = []
    let to: string | null = null
    for (let batch = 0; batch < BATCHES; batch++) {
      try {
        const base = `/api/oanda/instruments/${instrument}/candles?count=${COUNT}&granularity=${tf.oanda}&price=M`
        const url  = to ? `${base}&to=${to}` : base
        const resp = await fetch(url)
        const d    = await resp.json()
        const fetched: Candle[] = (d.candles ?? []).filter((c:{complete:boolean}) => c.complete).map(toCandle)
        if (fetched.length === 0) break
        allCandles = [...fetched, ...allCandles]
        to = new Date(fetched[0].timestamp - 500).toISOString()
        setDeepProgress(Math.round((batch + 1) / BATCHES * 100))
      } catch { break }
    }
    if (deepFetchIdRef.current === fetchId) {
      setDeepCandles(allCandles)
      setDeepLoading(false)
    }
  }, [pair, tfIdx])

  // ── Strategy overlays + backtest stats ──────────────────────────────────────────────
  const { chartOverlays, btStats, btTrades: derivedBtTrades } = useMemo(() => {
    const none = { chartOverlays: [] as ReturnType<typeof computeCrossfireWithLevels>, btStats: null as BacktestStats | null, btTrades: [] as BacktestTrade[] }
    if (activeStrategy !== 'crossfire') return none
    const pipSz = pair.includes('JPY') || pair.includes('XAU') ? 0.01 : 0.0001
    const settings = { slMode, slPips, rrRatio, pipSize: pipSz, requireFullBody }
    if (backtestMode) {
      const r = runCrossfireBacktest(candles, settings)
      return { chartOverlays: r.overlays, btStats: r.stats, btTrades: r.trades }
    }
    return { chartOverlays: computeCrossfireWithLevels(candles, settings), btStats: null as BacktestStats | null, btTrades: [] as BacktestTrade[] }
  }, [activeStrategy, backtestMode, candles, slMode, slPips, rrRatio, requireFullBody, pair])

  // Sync derivedBtTrades → state so AiAnalysisPanel can reference it
  useEffect(() => { setBtTrades(derivedBtTrades) }, [derivedBtTrades])

  // Keep refs in sync so handleTick can read latest values without stale closures
  useEffect(() => { candlesRef.current = candles },           [candles])
  useEffect(() => { aiStrategyModeRef.current = aiStrategyMode }, [aiStrategyMode])
  useEffect(() => { aiSettingsRef.current = aiSettings },     [aiSettings])

  // Reset deep candles when pair or timeframe changes
  useEffect(() => { setDeepCandles([]); setDeepProgress(0) }, [pair, tfIdx])

  // AI Strategy backtest — runs whenever aiStrategyMode is on.
  // NOTE: stats & trades are derived directly from the memo, NOT via setState.
  // Calling setState inside useMemo causes React to discard/defer the updates.
  // Overlays always use chart candles so they render correctly on the visible chart.
  const aiOverlays = useMemo(() => {
    if (!aiStrategyMode) return [] as typeof chartOverlays
    const pipSz = pair.includes('JPY') || pair.includes('XAU') ? 0.01 : 0.0001
    const s = { ...aiSettings, pipSize: pipSz }
    return runCrossfireAiBacktest(candles, s).overlays
  }, [aiStrategyMode, candles, aiSettings, pair])

  // Stats and trades use deep candles when loaded (full history), otherwise chart candles
  const { aiStats, aiTrades } = useMemo(() => {
    if (!aiStrategyMode) return { aiStats: null as BacktestStats | null, aiTrades: [] as BacktestTrade[] }
    const pipSz = pair.includes('JPY') || pair.includes('XAU') ? 0.01 : 0.0001
    const s = { ...aiSettings, pipSize: pipSz }
    const src = deepCandles.length > 0 ? deepCandles : candles
    const r = runCrossfireAiBacktest(src, s)
    return { aiStats: r.stats, aiTrades: r.trades }
  }, [aiStrategyMode, deepCandles, candles, aiSettings, pair])

  // Compounding calculator — 1% fixed-fractional risk, compounded on each closed trade
  const compounding = useMemo(() => {
    if (!aiStats || !aiTrades.length) return null
    const sorted = [...aiTrades].filter(t => t.result !== 'open').sort((a, b) => a.entryTs - b.entryTs)
    if (sorted.length === 0) return null
    let account = startingAccount
    let peak = startingAccount
    let maxDD = 0
    const rr = aiSettings.rrRatio
    for (const trade of sorted) {
      const risk = account * 0.01
      if (trade.result === 'win') account += risk * rr
      else account -= risk
      peak = Math.max(peak, account)
      maxDD = Math.max(maxDD, (peak - account) / peak)
    }
    return {
      finalAccount: account,
      totalReturn:  (account - startingAccount) / startingAccount * 100,
      maxDrawdown:  maxDD * 100,
    }
  }, [aiTrades, startingAccount, aiSettings.rrRatio, aiStats])

  // SMC backtest — chart overlays use visible candles; stats use deep candles when loaded
  const smcOverlays = useMemo(() => {
    if (!smcMode) return []
    const pipSz = pair.includes('JPY') || pair.includes('XAU') ? 0.01 : 0.0001
    return runSmcBacktest(candles, { ...smcSettings, pipSize: pipSz }).overlays
  }, [smcMode, candles, smcSettings, pair])

  const { smcStats, smcTrades } = useMemo(() => {
    if (!smcMode) return { smcStats: null, smcTrades: [] }
    const pipSz = pair.includes('JPY') || pair.includes('XAU') ? 0.01 : 0.0001
    const src = deepCandles.length > 0 ? deepCandles : candles
    const r = runSmcBacktest(src, { ...smcSettings, pipSize: pipSz })
    return { smcStats: r.stats, smcTrades: r.trades }
  }, [smcMode, deepCandles, candles, smcSettings, pair])

  // Merge overlays: AI strategy overlays replace crossfire ones when active
  const allOverlays = smcMode ? smcOverlays : aiStrategyMode ? aiOverlays : chartOverlays

  // ── Derived ───────────────────────────────────────────────────────────────
  const currentPrice = liveCandle?.close ?? 0
  const openPrice    = liveCandle?.open ?? currentPrice
  const priceUp      = currentPrice >= openPrice
  const isJpy        = pair.includes('JPY')
  const isGold       = pair.includes('XAU')
  const pipSize      = isGold ? 0.01 : isJpy ? 0.01 : 0.0001
  const sessionPips  = firstPrice ? ((currentPrice - firstPrice) / pipSize).toFixed(1) : '—'
  const full         = isGold ? currentPrice.toFixed(2) : currentPrice.toFixed(isJpy ? 3 : 5)
  const priceBody    = full.slice(0, -1)
  const pricePip     = full.slice(-1)
  const col          = priceUp ? '#22C55E' : '#EF4444'
  const colDim       = priceUp ? '#4ADE80' : '#F87171'

  return (
    <>
    <div className="fixed inset-0 flex flex-col overflow-hidden no-select" style={{ background: '#06061A' }}>

      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center gap-2 px-3 h-12"
           style={{ background: 'rgba(8,8,24,0.97)', borderBottom: '1px solid rgba(255,255,255,0.07)', zIndex: 30 }}
           ref={menuRef}>

        {/* Home */}
        <button onClick={() => goTo('landing')}
                className="text-xs font-medium px-2.5 py-1.5 rounded-lg flex-shrink-0 transition-colors"
                style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(241,241,255,0.5)' }}>
          ← Home
        </button>

        <div className="w-px h-4 flex-shrink-0" style={{ background: 'rgba(255,255,255,0.08)' }} />

        {/* ── Instrument dropdown ── */}
        <div className="relative flex-shrink-0">
          <button
            onClick={() => setOpenMenu(m => m === 'pair' ? null : 'pair')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
            style={{
              background: openMenu === 'pair' ? 'rgba(139,92,246,0.2)' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${openMenu === 'pair' ? 'rgba(139,92,246,0.45)' : 'rgba(255,255,255,0.09)'}`,
              color: '#A78BFA',
            }}>
            {pair}
            <span style={{ fontSize: 8, opacity: 0.6 }}>▾</span>
          </button>
          {openMenu === 'pair' && (
            <div className="absolute top-full left-0 mt-1 rounded-xl overflow-hidden shadow-2xl"
                 style={{ background: 'rgba(14,14,32,0.98)', border: '1px solid rgba(139,92,246,0.2)', minWidth: 160, zIndex: 50 }}>
              {PAIRS.map(p => (
                <button key={p}
                        onClick={() => { setPair(p); setOpenMenu(null) }}
                        className="w-full text-left px-3.5 py-2.5 text-xs font-semibold transition-colors hover:bg-white/5"
                        style={{ color: pair === p ? '#A78BFA' : 'rgba(241,241,255,0.65)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  {pair === p && <span className="mr-2" style={{ color: '#A78BFA' }}>✓</span>}
                  {PAIR_LABELS[p]}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Timeframe dropdown ── */}
        <div className="relative flex-shrink-0">
          <button
            onClick={() => setOpenMenu(m => m === 'tf' ? null : 'tf')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
            style={{
              background: openMenu === 'tf' ? 'rgba(245,158,11,0.18)' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${openMenu === 'tf' ? 'rgba(245,158,11,0.45)' : 'rgba(255,255,255,0.09)'}`,
              color: '#F59E0B',
            }}>
            {tf.label}
            <span style={{ fontSize: 8, opacity: 0.6 }}>▾</span>
          </button>
          {openMenu === 'tf' && (
            <div className="absolute top-full left-0 mt-1 rounded-xl overflow-hidden shadow-2xl"
                 style={{ background: 'rgba(14,14,32,0.98)', border: '1px solid rgba(245,158,11,0.2)', minWidth: 100, zIndex: 50 }}>
              {TIMEFRAMES.map((t, i) => (
                <button key={t.label}
                        onClick={() => { setTfIdx(i); setOpenMenu(null) }}
                        className="w-full text-left px-3.5 py-2.5 text-xs font-semibold transition-colors hover:bg-white/5"
                        style={{ color: tfIdx === i ? '#F59E0B' : 'rgba(241,241,255,0.65)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  {tfIdx === i && <span className="mr-2" style={{ color: '#F59E0B' }}>✓</span>}
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="w-px h-4 flex-shrink-0" style={{ background: 'rgba(255,255,255,0.08)' }} />

        {/* ── Strategies ── */}
        <div className="relative flex-shrink-0">
          <button
            onClick={() => setOpenMenu(m => m === 'strategies' ? null : 'strategies')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
            style={{
              background: openMenu === 'strategies' ? 'rgba(34,197,94,0.15)' : activeStrategy ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${openMenu === 'strategies' || activeStrategy ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.09)'}`,
              color: openMenu === 'strategies' || activeStrategy ? '#22C55E' : 'rgba(241,241,255,0.55)',
            }}>
            {activeStrategy && <div className="w-1.5 h-1.5 rounded-full bg-green-400" />}
            Strategies
            <span style={{ fontSize: 8, opacity: 0.6 }}>▾</span>
          </button>
          {openMenu === 'strategies' && (
            <div className="absolute top-full left-0 mt-1 rounded-xl shadow-2xl"
                 style={{ background: 'rgba(14,14,32,0.98)', border: '1px solid rgba(34,197,94,0.15)', width: 230, zIndex: 50 }}>
              <div className="px-4 py-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                <div className="text-xs font-bold" style={{ color: '#22C55E' }}>Strategies</div>
                <div className="text-[10px] mt-0.5" style={{ color: 'rgba(241,241,255,0.35)' }}>Overlay on chart · best on 15m</div>
              </div>
              <div className="p-2 flex flex-col gap-1">
                {/* Crossfire — live */}
                <div
                  className="rounded-lg overflow-hidden"
                  style={{
                    background: activeStrategy === 'crossfire' ? 'rgba(34,197,94,0.08)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${activeStrategy === 'crossfire' ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.07)'}`,
                  }}>
                  {/* Toggle row */}
                  <button
                    onClick={() => {
                      setActiveStrategy(s => s === 'crossfire' ? null : 'crossfire')
                      if (activeStrategy === 'crossfire') setBacktestMode(false)
                      setOpenMenu(null)
                    }}
                    className="w-full text-left px-3 py-2.5 text-xs font-semibold transition-all"
                    style={{ color: activeStrategy === 'crossfire' ? '#22C55E' : 'rgba(241,241,255,0.7)' }}>
                    <span className="flex items-center justify-between">
                      <span>{activeStrategy === 'crossfire' ? '✓ ' : ''}Crossfire</span>
                      <span style={{ color: activeStrategy === 'crossfire' ? 'rgba(34,197,94,0.6)' : 'rgba(139,92,246,0.7)', fontSize: 9 }}>
                        {activeStrategy === 'crossfire' ? 'ON' : 'active'}
                      </span>
                    </span>
                    <div className="mt-0.5 text-[10px]" style={{ color: 'rgba(241,241,255,0.3)', fontWeight: 400 }}>
                      HH/LL trendlines from London open
                    </div>
                  </button>
                  {/* Backtest row — only when strategy active */}
                  {activeStrategy === 'crossfire' && (
                    <button
                      onClick={() => { setBacktestMode(m => !m); setOpenMenu(null) }}
                      className="w-full text-left px-3 py-2 text-xs font-semibold transition-all flex items-center justify-between"
                      style={{
                        borderTop: '1px solid rgba(255,255,255,0.06)',
                        background: backtestMode ? 'rgba(245,158,11,0.12)' : 'rgba(255,255,255,0.02)',
                        color: backtestMode ? '#F59E0B' : 'rgba(241,241,255,0.45)',
                      }}>
                      <span>⟳ Backtest all days</span>
                      <span style={{ fontSize: 9, opacity: 0.7 }}>{backtestMode ? 'ON' : 'OFF'}</span>
                    </button>
                  )}
                  {/* SL / TP inputs */}
                  {activeStrategy === 'crossfire' && (
                    <div className="flex flex-col gap-3 px-3 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
                         onClick={e => e.stopPropagation()}>

                      {/* SL Mode selector */}
                      <div className="flex flex-col gap-1.5">
                        <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'rgba(241,241,255,0.4)' }}>Stop Loss Method</span>
                        <div className="flex gap-1">
                          <button onClick={() => setSlMode('static')}
                                  className="flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all"
                                  style={{ background: slMode==='static'?'rgba(239,68,68,0.15)':'rgba(255,255,255,0.04)', border:`1px solid ${slMode==='static'?'rgba(239,68,68,0.4)':'rgba(255,255,255,0.08)'}`, color: slMode==='static'?'#F87171':'rgba(241,241,255,0.4)' }}>
                            Static
                          </button>
                          <button onClick={() => setSlMode('dynamic')}
                                  className="flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all"
                                  style={{ background: slMode==='dynamic'?'rgba(245,158,11,0.15)':'rgba(255,255,255,0.04)', border:`1px solid ${slMode==='dynamic'?'rgba(245,158,11,0.4)':'rgba(255,255,255,0.08)'}`, color: slMode==='dynamic'?'#F59E0B':'rgba(241,241,255,0.4)' }}>
                            Dynamic
                          </button>
                        </div>
                        <div className="text-[9px] leading-relaxed" style={{ color: 'rgba(241,241,255,0.28)' }}>
                          {slMode === 'static'
                            ? 'Fixed pips below the opposite line'
                            : 'Mirror entry→line distance below the opposite line'}
                        </div>
                      </div>

                      {/* Pips below line (static mode only) */}
                      {slMode === 'static' && (
                        <div className="flex items-end gap-3">
                          <div className="flex flex-col gap-1">
                            <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'rgba(239,68,68,0.7)' }}>Pips below line</span>
                            <div className="flex items-center gap-1">
                              <input type="number" min={1} max={50} step={1} value={slPips}
                                     onChange={e => setSlPips(Math.max(1, parseInt(e.target.value) || 10))}
                                     className="w-14 px-2 py-1.5 text-xs font-bold text-center rounded-lg"
                                     style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#F87171', outline: 'none' }} />
                              <span className="text-[10px]" style={{ color: 'rgba(241,241,255,0.3)' }}>pips</span>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* R:R ratio */}
                      <div className="flex flex-col gap-1.5">
                        <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'rgba(34,197,94,0.7)' }}>Risk : Reward</span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-bold" style={{ color: 'rgba(241,241,255,0.45)' }}>1 :</span>
                          <input
                            type="number"
                            min="0.5"
                            max="20"
                            step="0.5"
                            value={rrRatio}
                            onChange={e => {
                              const v = parseFloat(e.target.value)
                              if (!isNaN(v) && v >= 0.5) setRrRatio(v)
                            }}
                            className="w-16 py-1.5 px-2 rounded-lg text-[11px] font-bold text-center outline-none"
                            style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.35)', color: '#4ADE80' }}
                          />
                        </div>
                      </div>

                      {/* Full body confirmation */}
                      <div className="flex flex-col gap-1.5">
                        <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'rgba(139,92,246,0.7)' }}>Entry Filter</span>
                        <button
                          onClick={() => setRequireFullBody(v => !v)}
                          className="py-1.5 px-2 rounded-lg text-[10px] font-bold text-left transition-all"
                          style={{
                            background: requireFullBody ? 'rgba(139,92,246,0.15)' : 'rgba(255,255,255,0.04)',
                            border: `1px solid ${requireFullBody ? 'rgba(139,92,246,0.45)' : 'rgba(255,255,255,0.08)'}`,
                            color: requireFullBody ? '#A78BFA' : 'rgba(241,241,255,0.4)',
                          }}>
                          Full body close &#x2014; {requireFullBody ? 'ON' : 'OFF'}
                        </button>
                        <div className="text-[9px] leading-relaxed" style={{ color: 'rgba(241,241,255,0.28)' }}>
                          {requireFullBody
                            ? 'Both open & close must clear the line'
                            : 'Entry on close crossing the line'}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                {/* Placeholder strategies */}
                {/* AI Analysis */}
                <button
                  onClick={() => { setShowAiPanel(true); setOpenMenu(null) }}
                  className="w-full text-left px-3 py-2 rounded-lg text-xs font-semibold transition-all"
                  style={{
                    background: 'rgba(139,92,246,0.08)',
                    border: '1px solid rgba(139,92,246,0.25)',
                    color: btTrades.length > 0 ? '#A78BFA' : 'rgba(167,139,250,0.45)',
                  }}>
                  ✦ AI Analysis
                  {btTrades.length > 0
                    ? <span className="ml-1.5 text-[9px]" style={{ color: 'rgba(167,139,250,0.6)' }}>{btTrades.length} trades</span>
                    : <span className="ml-1.5 text-[9px]" style={{ color: 'rgba(245,158,11,0.5)' }}>run backtest first</span>
                  }
                </button>
                {['Moving Average','Bollinger Bands','RSI','MACD'].map(s => (
                  <button key={s}
                          className="w-full text-left px-3 py-2 rounded-lg text-xs transition-colors"
                          style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', color: 'rgba(241,241,255,0.25)', cursor: 'not-allowed' }}>
                    {s} <span className="ml-1 text-[9px]" style={{ color: 'rgba(245,158,11,0.4)' }}>soon</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="w-px h-4 flex-shrink-0" style={{ background: 'rgba(255,255,255,0.08)' }} />

        {/* ── AI Strategies dropdown ── */}
        <div className="relative flex-shrink-0">
          <button
            onClick={() => setOpenMenu(m => m === 'ai' ? null : 'ai')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
            style={{
              background: openMenu === 'ai' ? 'rgba(139,92,246,0.2)' : aiStrategyMode ? 'rgba(139,92,246,0.15)' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${openMenu === 'ai' || aiStrategyMode ? 'rgba(139,92,246,0.5)' : 'rgba(255,255,255,0.09)'}`,
              color: aiStrategyMode ? '#A78BFA' : 'rgba(241,241,255,0.55)',
            }}>
            {aiStrategyMode && <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#A78BFA' }} />}
            ✦ AI Strategies
            <span style={{ fontSize: 8, opacity: 0.6 }}>▾</span>
          </button>
          {openMenu === 'ai' && (
            <div className="absolute top-full left-0 mt-1 rounded-xl shadow-2xl"
                 style={{ background: 'rgba(14,14,32,0.98)', border: '1px solid rgba(139,92,246,0.2)', width: 260, zIndex: 50 }}>
              <div className="px-4 py-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                <div className="text-xs font-bold" style={{ color: '#A78BFA' }}>✦ AI Strategies</div>
                <div className="text-[10px] mt-0.5" style={{ color: 'rgba(241,241,255,0.35)' }}>Crossfire · {pair} · {tf.label}</div>
              </div>
              <div className="p-2 flex flex-col gap-1">
                {/* Crossfire AI */}
                <div className="rounded-lg overflow-hidden"
                     style={{
                       background: aiStrategyMode ? 'rgba(139,92,246,0.1)' : 'rgba(255,255,255,0.03)',
                       border: `1px solid ${aiStrategyMode ? 'rgba(139,92,246,0.35)' : 'rgba(255,255,255,0.07)'}`,
                     }}>
                  <button
                    onClick={() => { setAiStrategyMode(m => !m); if (aiStrategyMode) setActiveStrategy(null); setOpenMenu(null) }}
                    className="w-full text-left px-3 py-2.5 text-xs font-semibold transition-all"
                    style={{ color: aiStrategyMode ? '#A78BFA' : 'rgba(241,241,255,0.7)' }}>
                    <span className="flex items-center justify-between">
                      <span>{aiStrategyMode ? '✓ ' : ''}Crossfire AI</span>
                      <span style={{ color: aiStrategyMode ? 'rgba(139,92,246,0.7)' : 'rgba(139,92,246,0.4)', fontSize: 9 }}>
                        {aiStrategyMode ? 'ON' : 'backtest'}
                      </span>
                    </span>
                    <div className="mt-0.5 text-[10px]" style={{ color: 'rgba(241,241,255,0.3)', fontWeight: 400 }}>
                      Crossfire + time, wick &amp; body filters
                    </div>
                  </button>
                  {/* Filter controls */}
                  {aiStrategyMode && (
                    <div className="flex flex-col gap-2.5 px-3 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
                         onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-between">
                        <div className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'rgba(139,92,246,0.7)' }}>Filter Parameters</div>
                        <button
                          onClick={() => setAiSettings({ ...CROSSFIRE_AI_DEFAULTS, pipSize: pair.includes('JPY') || pair.includes('XAU') ? 0.01 : 0.0001 })}
                          className="text-[8px] px-1.5 py-0.5 rounded transition-all"
                          style={{ color: 'rgba(139,92,246,0.6)', border: '1px solid rgba(139,92,246,0.2)', background: 'transparent' }}>
                          ↺ reset
                        </button>
                      </div>

                      {/* Min minutes */}
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[9px]" style={{ color: 'rgba(241,241,255,0.45)' }}>Entry after 1pm +</span>
                        <div className="flex items-center gap-1">
                          <input type="number" min={0} max={60} step={5} value={aiSettings.minMinutes}
                                 onChange={e => setAiSettings(s => ({ ...s, minMinutes: Math.max(0, parseInt(e.target.value) || 0) }))}
                                 className="w-12 px-1.5 py-1 text-[10px] font-bold text-center rounded"
                                 style={{ background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.3)', color: '#A78BFA', outline: 'none' }} />
                          <span className="text-[9px]" style={{ color: 'rgba(241,241,255,0.3)' }}>min</span>
                        </div>
                      </div>

                      {/* Max minutes (entry window close) */}
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <span className="text-[9px]" style={{ color: 'rgba(241,241,255,0.45)' }}>Stop entries after +</span>
                          <div className="text-[8px]" style={{ color: 'rgba(241,241,255,0.25)' }}>&gt;50min = 22% WR vs 68% before</div>
                        </div>
                        <div className="flex items-center gap-1">
                          <input type="number" min={15} max={120} step={5} value={aiSettings.maxMinutes ?? 120}
                                 onChange={e => setAiSettings(s => ({ ...s, maxMinutes: Math.max(15, parseInt(e.target.value) || 120) }))}
                                 className="w-12 px-1.5 py-1 text-[10px] font-bold text-center rounded"
                                 style={{ background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.3)', color: '#A78BFA', outline: 'none' }} />
                          <span className="text-[9px]" style={{ color: 'rgba(241,241,255,0.3)' }}>min</span>
                        </div>
                      </div>

                      {/* Max wick ratio */}
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[9px]" style={{ color: 'rgba(241,241,255,0.45)' }}>Max wick/body ratio</span>
                        <input type="number" min={0.1} max={5} step={0.1} value={aiSettings.maxWickRatio}
                               onChange={e => setAiSettings(s => ({ ...s, maxWickRatio: Math.max(0.1, parseFloat(e.target.value) || 0.5) }))}
                               className="w-14 px-1.5 py-1 text-[10px] font-bold text-center rounded"
                               style={{ background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.3)', color: '#A78BFA', outline: 'none' }} />
                      </div>

                      {/* Min body */}
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[9px]" style={{ color: 'rgba(241,241,255,0.45)' }}>Min candle body</span>
                        <div className="flex items-center gap-1">
                          <input type="number" min={0} max={10} step={0.5} value={aiSettings.minBodyPips}
                                 onChange={e => setAiSettings(s => ({ ...s, minBodyPips: Math.max(0, parseFloat(e.target.value) || 0) }))}
                                 className="w-12 px-1.5 py-1 text-[10px] font-bold text-center rounded"
                                 style={{ background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.3)', color: '#A78BFA', outline: 'none' }} />
                          <span className="text-[9px]" style={{ color: 'rgba(241,241,255,0.3)' }}>pips</span>
                        </div>
                      </div>

                      {/* Max SL */}
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[9px]" style={{ color: 'rgba(241,241,255,0.45)' }}>Max SL size</span>
                        <div className="flex items-center gap-1">
                          <input type="number" min={5} max={50} step={1} value={aiSettings.maxSlPips}
                                 onChange={e => setAiSettings(s => ({ ...s, maxSlPips: Math.max(5, parseInt(e.target.value) || 20) }))}
                                 className="w-12 px-1.5 py-1 text-[10px] font-bold text-center rounded"
                                 style={{ background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.3)', color: '#A78BFA', outline: 'none' }} />
                          <span className="text-[9px]" style={{ color: 'rgba(241,241,255,0.3)' }}>pips</span>
                        </div>
                      </div>

                      {/* Max body */}
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <span className="text-[9px]" style={{ color: 'rgba(241,241,255,0.45)' }}>Max candle body</span>
                          <div className="text-[8px]" style={{ color: 'rgba(241,241,255,0.25)' }}>&gt;7p body → 0% WR in data</div>
                        </div>
                        <div className="flex items-center gap-1">
                          <input type="number" min={0} max={30} step={0.5} value={aiSettings.maxBodyPips ?? 0}
                                 onChange={e => setAiSettings(s => ({ ...s, maxBodyPips: Math.max(0, parseFloat(e.target.value) || 0) || undefined }))}
                                 className="w-12 px-1.5 py-1 text-[10px] font-bold text-center rounded"
                                 style={{ background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.3)', color: '#A78BFA', outline: 'none' }} />
                          <span className="text-[9px]" style={{ color: 'rgba(241,241,255,0.3)' }}>pips</span>
                        </div>
                      </div>

                      {/* Prev candle aligned */}
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <span className="text-[9px]" style={{ color: 'rgba(241,241,255,0.45)' }}>Prev candle aligned</span>
                          <div className="text-[8px]" style={{ color: 'rgba(241,241,255,0.25)' }}>35% WR on, 7% WR off</div>
                        </div>
                        <button onClick={() => setAiSettings(s => ({ ...s, requirePrevAligned: !s.requirePrevAligned }))}
                                className="flex-shrink-0 w-8 h-4 rounded-full transition-colors"
                                style={{ background: aiSettings.requirePrevAligned ? 'rgba(245,158,11,0.7)' : 'rgba(255,255,255,0.1)' }}>
                          <div className="w-3 h-3 rounded-full bg-white transition-transform mx-0.5"
                               style={{ transform: aiSettings.requirePrevAligned ? 'translateX(16px)' : 'translateX(0)' }} />
                        </button>
                      </div>

                      {/* Counter-trend (reversal) mode */}
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <span className="text-[9px]" style={{ color: 'rgba(241,241,255,0.45)' }}>Counter-H1 (all)</span>
                          <div className="text-[8px]" style={{ color: 'rgba(241,241,255,0.25)' }}>skip trend-following entries</div>
                        </div>
                        <button onClick={() => setAiSettings(s => ({ ...s, requireCounterTrend: !s.requireCounterTrend, requireTrendAlignment: false }))}
                                className="flex-shrink-0 w-8 h-4 rounded-full transition-colors"
                                style={{ background: aiSettings.requireCounterTrend ? 'rgba(239,68,68,0.6)' : 'rgba(255,255,255,0.1)' }}>
                          <div className="w-3 h-3 rounded-full bg-white transition-transform mx-0.5"
                               style={{ transform: aiSettings.requireCounterTrend ? 'translateX(16px)' : 'translateX(0)' }} />
                        </button>
                      </div>

                      {/* Filter H1=+1 buys only — key data insight */}
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <span className="text-[9px]" style={{ color: 'rgba(245,158,11,0.85)' }}>★ No H1-bull buys</span>
                          <div className="text-[8px]" style={{ color: 'rgba(241,241,255,0.25)' }}>H1=+1 buys: 8% WR → skip them</div>
                        </div>
                        <button onClick={() => setAiSettings(s => ({ ...s, filterBuysCounterH1: !s.filterBuysCounterH1 }))}
                                className="flex-shrink-0 w-8 h-4 rounded-full transition-colors"
                                style={{ background: aiSettings.filterBuysCounterH1 ? 'rgba(245,158,11,0.7)' : 'rgba(255,255,255,0.1)' }}>
                          <div className="w-3 h-3 rounded-full bg-white transition-transform mx-0.5"
                               style={{ transform: aiSettings.filterBuysCounterH1 ? 'translateX(16px)' : 'translateX(0)' }} />
                        </button>
                      </div>

                      {/* Skip bearish drift zone */}
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <span className="text-[9px]" style={{ color: 'rgba(245,158,11,0.85)' }}>★ Skip bearish drift</span>
                          <div className="text-[8px]" style={{ color: 'rgba(241,241,255,0.25)' }}>-20→-6 pip morning = 9% WR</div>
                        </div>
                        <button onClick={() => setAiSettings(s => ({ ...s, skipBearishDrift: !s.skipBearishDrift }))}
                                className="flex-shrink-0 w-8 h-4 rounded-full transition-colors"
                                style={{ background: (aiSettings.skipBearishDrift ?? false) ? 'rgba(245,158,11,0.7)' : 'rgba(255,255,255,0.1)' }}>
                          <div className="w-3 h-3 rounded-full bg-white transition-transform mx-0.5"
                               style={{ transform: (aiSettings.skipBearishDrift ?? false) ? 'translateX(16px)' : 'translateX(0)' }} />
                        </button>
                      </div>

                      {/* Require previous day win */}
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <span className="text-[9px]" style={{ color: 'rgba(241,241,255,0.45)' }}>After win only</span>
                          <div className="text-[8px]" style={{ color: 'rgba(241,241,255,0.25)' }}>prev win = 63% WR vs 44%</div>
                        </div>
                        <button onClick={() => setAiSettings(s => ({ ...s, requirePrevDayWin: !s.requirePrevDayWin }))}
                                className="flex-shrink-0 w-8 h-4 rounded-full transition-colors"
                                style={{ background: (aiSettings.requirePrevDayWin ?? false) ? 'rgba(34,197,94,0.7)' : 'rgba(255,255,255,0.1)' }}>
                          <div className="w-3 h-3 rounded-full bg-white transition-transform mx-0.5"
                               style={{ transform: (aiSettings.requirePrevDayWin ?? false) ? 'translateX(16px)' : 'translateX(0)' }} />
                        </button>
                      </div>

                      {/* Direction filter */}
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[9px]" style={{ color: 'rgba(241,241,255,0.45)' }}>Trade direction</span>
                        <div className="flex gap-1">
                          {(['both', 'sell', 'buy'] as const).map(d => (
                            <button key={d} onClick={() => setAiSettings(s => ({ ...s, tradeDirection: d }))}
                                    className="px-1.5 py-0.5 rounded text-[9px] font-bold transition-all capitalize"
                                    style={{
                                      background: (aiSettings.tradeDirection ?? 'both') === d ? 'rgba(139,92,246,0.35)' : 'rgba(255,255,255,0.05)',
                                      border: `1px solid ${(aiSettings.tradeDirection ?? 'both') === d ? 'rgba(139,92,246,0.5)' : 'rgba(255,255,255,0.08)'}`,
                                      color: (aiSettings.tradeDirection ?? 'both') === d ? '#A78BFA' : 'rgba(241,241,255,0.35)',
                                    }}>{d}</button>
                          ))}
                        </div>
                      </div>

                      {/* R:R */}
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[9px]" style={{ color: 'rgba(241,241,255,0.45)' }}>R:R target</span>
                        <div className="flex items-center gap-1">
                          <span className="text-[9px]" style={{ color: 'rgba(241,241,255,0.3)' }}>1:</span>
                          <input type="number" min={1} max={10} step={0.5} value={aiSettings.rrRatio}
                                 onChange={e => setAiSettings(s => ({ ...s, rrRatio: Math.max(1, parseFloat(e.target.value) || 3) }))}
                                 className="w-12 px-1.5 py-1 text-[10px] font-bold text-center rounded"
                                 style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', color: '#4ADE80', outline: 'none' }} />
                        </div>
                      </div>

                      {/* Body-to-body lines */}
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <span className="text-[9px]" style={{ color: 'rgba(241,241,255,0.45)' }}>Body-to-body lines</span>
                          <div className="text-[8px]" style={{ color: 'rgba(241,241,255,0.25)' }}>anchor to candle body, not wick</div>
                        </div>
                        <button onClick={() => setAiSettings(s => ({ ...s, useBodyLines: !s.useBodyLines }))}
                                className="flex-shrink-0 w-8 h-4 rounded-full transition-colors"
                                style={{ background: aiSettings.useBodyLines ? 'rgba(139,92,246,0.7)' : 'rgba(255,255,255,0.1)' }}>
                          <div className="w-3 h-3 rounded-full bg-white transition-transform mx-0.5"
                               style={{ transform: aiSettings.useBodyLines ? 'translateX(16px)' : 'translateX(0)' }} />
                        </button>
                      </div>

                      {/* H1 trend alignment */}
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <span className="text-[9px]" style={{ color: 'rgba(241,241,255,0.45)' }}>H1 trend alignment</span>
                          <div className="text-[8px]" style={{ color: 'rgba(241,241,255,0.25)' }}>skip counter-trend entries</div>
                        </div>
                        <button onClick={() => setAiSettings(s => ({ ...s, requireTrendAlignment: !s.requireTrendAlignment }))}
                                className="flex-shrink-0 w-8 h-4 rounded-full transition-colors"
                                style={{ background: aiSettings.requireTrendAlignment ? 'rgba(34,197,94,0.7)' : 'rgba(255,255,255,0.1)' }}>
                          <div className="w-3 h-3 rounded-full bg-white transition-transform mx-0.5"
                               style={{ transform: aiSettings.requireTrendAlignment ? 'translateX(16px)' : 'translateX(0)' }} />
                        </button>
                      </div>

                    </div>
                  )}
                </div>

                {/* SMC Order Block */}
                <div className="rounded-lg overflow-hidden"
                     style={{
                       background: smcMode ? 'rgba(245,158,11,0.08)' : 'rgba(255,255,255,0.03)',
                       border: `1px solid ${smcMode ? 'rgba(245,158,11,0.35)' : 'rgba(255,255,255,0.07)'}`,
                     }}>
                  <button
                    onClick={() => { setSmcMode(m => !m); setAiStrategyMode(false); setActiveStrategy(null); setOpenMenu(null) }}
                    className="w-full text-left px-3 py-2.5 text-xs font-semibold transition-all"
                    style={{ color: smcMode ? '#FCD34D' : 'rgba(241,241,255,0.7)' }}>
                    <span className="flex items-center justify-between">
                      <span>{smcMode ? '✓ ' : ''}SMC Order Block</span>
                      <span style={{ color: smcMode ? 'rgba(245,158,11,0.7)' : 'rgba(245,158,11,0.4)', fontSize: 9 }}>
                        {smcMode ? 'ON' : 'backtest'}
                      </span>
                    </span>
                    <div className="mt-0.5 text-[10px]" style={{ color: 'rgba(241,241,255,0.3)', fontWeight: 400 }}>
                      Liquidity sweep · Fib zone · Order block entry
                    </div>
                  </button>
                  {smcMode && (
                    <div className="px-3 pb-3 flex flex-col gap-2 border-t" style={{ borderColor: 'rgba(245,158,11,0.1)' }}>
                      <div className="flex items-center justify-between gap-2 pt-2">
                        <span className="text-[9px]" style={{ color: 'rgba(241,241,255,0.45)' }}>R:R target</span>
                        <div className="flex items-center gap-1">
                          <span className="text-[9px]" style={{ color: 'rgba(241,241,255,0.3)' }}>1:</span>
                          <input type="number" min={1} max={10} step={0.5} value={smcSettings.rrRatio}
                                 onChange={e => setSmcSettings(s => ({ ...s, rrRatio: Math.max(1, parseFloat(e.target.value) || 3) }))}
                                 className="w-12 px-1.5 py-1 text-[10px] font-bold text-center rounded"
                                 style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: '#FCD34D', outline: 'none' }} />
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[9px]" style={{ color: 'rgba(241,241,255,0.45)' }}>Min sweep (pips)</span>
                        <input type="number" min={1} max={20} step={0.5} value={smcSettings.minSweepPips}
                               onChange={e => setSmcSettings(s => ({ ...s, minSweepPips: Math.max(0.5, parseFloat(e.target.value) || 2) }))}
                               className="w-14 px-1.5 py-1 text-[10px] font-bold text-center rounded"
                               style={{ background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.3)', color: '#A78BFA', outline: 'none' }} />
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[9px]" style={{ color: 'rgba(241,241,255,0.45)' }}>Max SL (pips)</span>
                        <input type="number" min={5} max={50} step={1} value={smcSettings.maxSlPips}
                               onChange={e => setSmcSettings(s => ({ ...s, maxSlPips: Math.max(5, parseFloat(e.target.value) || 25) }))}
                               className="w-14 px-1.5 py-1 text-[10px] font-bold text-center rounded"
                               style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#F87171', outline: 'none' }} />
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[9px]" style={{ color: 'rgba(241,241,255,0.45)' }}>Session (UTC hrs)</span>
                        <div className="flex items-center gap-1">
                          <input type="number" min={0} max={23} step={1} value={smcSettings.sessionStart}
                                 onChange={e => setSmcSettings(s => ({ ...s, sessionStart: parseInt(e.target.value) || 7 }))}
                                 className="w-10 px-1 py-1 text-[10px] font-bold text-center rounded"
                                 style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', color: '#4ADE80', outline: 'none' }} />
                          <span className="text-[9px]" style={{ color: 'rgba(241,241,255,0.3)' }}>–</span>
                          <input type="number" min={0} max={23} step={1} value={smcSettings.sessionEnd}
                                 onChange={e => setSmcSettings(s => ({ ...s, sessionEnd: parseInt(e.target.value) || 17 }))}
                                 className="w-10 px-1 py-1 text-[10px] font-bold text-center rounded"
                                 style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', color: '#4ADE80', outline: 'none' }} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

              </div>
            </div>
          )}
        </div>

        <div className="flex-1" />

        {/* ── Right: price + status ── */}
        {!loading && (
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="text-xs" style={{ color: 'rgba(241,241,255,0.3)' }}>
              Next <span className="font-bold tabular" style={{ color: '#F59E0B' }}>{countdown}s</span>
            </div>
            {currentPrice > 0 && (
              <div className="flex items-baseline gap-0 tabular" style={{ color: col }}>
                <span className="font-black text-xl leading-none">{priceBody}</span>
                <span className="font-black text-2xl leading-none" style={{ color: colDim, textShadow: `0 0 12px ${col}` }}>{pricePip}</span>
              </div>
            )}
            {currentPrice > 0 && (
              <div className="text-xs font-semibold tabular" style={{ color: col }}>
                {priceUp ? '▲' : '▼'} {sessionPips} pips
              </div>
            )}
            {isLive ? (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md"
                   style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)' }}>
                <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                <span className="text-xs font-bold" style={{ color: '#22C55E' }}>LIVE</span>
                <span className="text-[10px] ml-0.5" style={{ color: 'rgba(241,241,255,0.35)' }}>{tickCount.toLocaleString()}</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-md"
                   style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
                <span className="text-[10px] capitalize" style={{ color: 'rgba(241,241,255,0.4)' }}>{streamStatus}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Chart ─────────────────────────────────────────────────────────────── */}
      {/* Stats bar: shown when backtest has results */}
      {activeStrategy === 'crossfire' && backtestMode && btStats && btStats.trades > 0 && (
        <div className="flex-shrink-0 flex items-center gap-4 px-4 py-2 flex-wrap"
             style={{ background: 'rgba(10,8,28,0.97)', borderBottom: '1px solid rgba(139,92,246,0.12)' }}>
          <span className="text-[10px] font-black uppercase tracking-widest mr-1" style={{ color: '#A78BFA' }}>Crossfire</span>
          <div className="w-px h-4" style={{ background: 'rgba(255,255,255,0.08)' }} />
          <StatChip label="Trades" value={String(btStats.trades)} />
          <StatChip label="Days" value={String(btStats.sessionsScanned)} />
          <StatChip label="Win Rate" value={`${btStats.winRate.toFixed(1)}%`} color={btStats.winRate >= 50 ? '#22C55E' : '#EF4444'} />
          <StatChip label="Avg Win" value={`+${btStats.avgWin.toFixed(1)}`} color="#22C55E" />
          <StatChip label="Avg Loss" value={`−${btStats.avgLoss.toFixed(1)}`} color="#EF4444" />
          <StatChip label="R:R" value={`1 : ${btStats.rr.toFixed(2)}`} />
          <StatChip label="Expectancy" value={`${btStats.expectancy >= 0 ? '+' : ''}${btStats.expectancy.toFixed(1)} pips`} color={btStats.expectancy >= 0 ? '#22C55E' : '#EF4444'} />
          <div className="ml-auto text-[10px] tabular" style={{ color: 'rgba(241,241,255,0.3)' }}>
            {btStats.wins}W / {btStats.losses}L{btStats.openTrades > 0 ? ` / ${btStats.openTrades} open` : ''}
            <span className="ml-2" style={{ color: 'rgba(241,241,255,0.18)' }}>
              {slMode === 'static' ? `SL ${slPips}p below line` : 'Dynamic SL'} · 1:{rrRatio} R:R
            </span>
          </div>
        </div>
      )}
      {/* AI Strategy stats bar */}
      {aiStrategyMode && aiStats && (
        <div className="flex-shrink-0 flex items-center gap-4 px-4 py-2 flex-wrap"
             style={{ background: 'rgba(8,6,28,0.97)', borderBottom: '1px solid rgba(139,92,246,0.25)' }}>
          <span className="text-[10px] font-black uppercase tracking-widest mr-1" style={{ color: '#A78BFA' }}>✦ Crossfire AI</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(139,92,246,0.12)', color: 'rgba(167,139,250,0.7)', border: '1px solid rgba(139,92,246,0.2)' }}>
            {pair} · {tf.label}
          </span>
          <div className="w-px h-4" style={{ background: 'rgba(255,255,255,0.08)' }} />
          {aiStats.trades === 0 ? (
            <span className="text-[10px]" style={{ color: 'rgba(241,241,255,0.4)' }}>
              0 qualifying trades across {aiStats.sessionsScanned} sessions — wick filter may be too strict, try relaxing max wick/body
            </span>
          ) : (
            <>
              <StatChip label="Trades" value={String(aiStats.trades)} />
              <StatChip label="Days" value={String(aiStats.sessionsScanned)} />
              <StatChip label="Win Rate" value={`${aiStats.winRate.toFixed(1)}%`} color={aiStats.winRate >= 50 ? '#22C55E' : '#EF4444'} />
              <StatChip label="Avg Win" value={`+${aiStats.avgWin.toFixed(1)}`} color="#22C55E" />
              <StatChip label="Avg Loss" value={`−${aiStats.avgLoss.toFixed(1)}`} color="#EF4444" />
              <StatChip label="R:R" value={`1 : ${aiStats.rr.toFixed(2)}`} />
              <StatChip label="Expectancy" value={`${aiStats.expectancy >= 0 ? '+' : ''}${aiStats.expectancy.toFixed(1)} pips`} color={aiStats.expectancy >= 0 ? '#22C55E' : '#EF4444'} />
              <div className="ml-auto flex items-center gap-3">
                <span className="text-[10px] tabular" style={{ color: 'rgba(241,241,255,0.3)' }}>
                  {aiStats.wins}W / {aiStats.losses}L{aiStats.openTrades > 0 ? ` / ${aiStats.openTrades} open` : ''}
                  {aiStats.noSetupSessions > 0 && (
                    <span className="ml-2" style={{ color: 'rgba(241,241,255,0.2)' }}>
                      — {aiStats.noSetupSessions} no setup, {aiStats.filteredSetups} filtered out
                      {' '}/ {aiStats.sessionsScanned} sessions
                    </span>
                  )}
                  {aiStats.dateFrom && aiStats.dateTo && (
                    <span className="ml-2" style={{ color: 'rgba(241,241,255,0.15)' }}>
                      — {aiStats.dateFrom} – {aiStats.dateTo}
                    </span>
                  )}
                </span>
                <button
                  onClick={() => setShowAiPanel(true)}
                  className="px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all"
                  style={{ background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.35)', color: '#A78BFA' }}>
                  ✦ AI Analysis
                </button>                <button
                  onClick={handleDeepFetch}
                  disabled={deepLoading}
                  className="px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all"
                  style={{
                    background: deepLoading ? 'rgba(245,158,11,0.08)' : deepCandles.length > 0 ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)',
                    border: `1px solid ${deepLoading ? 'rgba(245,158,11,0.2)' : deepCandles.length > 0 ? 'rgba(34,197,94,0.35)' : 'rgba(245,158,11,0.35)'}`,
                    color: deepLoading ? 'rgba(245,158,11,0.5)' : deepCandles.length > 0 ? '#4ADE80' : '#F59E0B',
                    cursor: deepLoading ? 'default' : 'pointer',
                  }}>
                  {deepLoading
                    ? `⧖ Loading ${deepProgress}%…`
                    : deepCandles.length > 0
                      ? `✓ ${aiStats.sessionsScanned} days loaded`
                      : '⧖ Load Full History'}
                </button>              </div>
            </>
          )}
        </div>
      )}
      {/* ── Compounding row — shown when AI mode has trades ── */}
      {aiStrategyMode && compounding && (
        <div className="flex-shrink-0 flex items-center gap-3 px-4 py-1.5 flex-wrap"
             style={{ background: 'rgba(5,5,20,0.99)', borderBottom: '1px solid rgba(34,197,94,0.1)' }}>
          <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: 'rgba(34,197,94,0.5)' }}>Account Growth</span>
          <div className="w-px h-3" style={{ background: 'rgba(255,255,255,0.07)' }} />
          <div className="flex items-center gap-1">
            <span className="text-[9px]" style={{ color: 'rgba(241,241,255,0.3)' }}>Start £</span>
            <input
              type="number" min={100} step={100} value={startingAccount}
              onChange={e => setStartingAccount(Math.max(100, parseInt(e.target.value) || 1000))}
              className="w-16 px-1.5 py-0.5 text-[9px] font-bold text-center rounded"
              style={{ background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.2)', color: '#4ADE80', outline: 'none' }} />
          </div>
          <span className="text-[9px]" style={{ color: 'rgba(241,241,255,0.18)' }}>@ 1% risk · 1:{aiSettings.rrRatio} R:R</span>
          <div className="w-px h-3" style={{ background: 'rgba(255,255,255,0.07)' }} />
          <StatChip label="Final Account" value={`£${Math.round(compounding.finalAccount).toLocaleString()}`} color={compounding.finalAccount >= startingAccount ? '#22C55E' : '#EF4444'} />
          <StatChip label="Total Return" value={`${compounding.totalReturn >= 0 ? '+' : ''}${compounding.totalReturn.toFixed(1)}%`} color={compounding.totalReturn >= 0 ? '#22C55E' : '#EF4444'} />
          <StatChip label="Max Drawdown" value={`${compounding.maxDrawdown.toFixed(1)}%`} color={compounding.maxDrawdown > 20 ? '#EF4444' : compounding.maxDrawdown > 10 ? '#F59E0B' : '#22C55E'} />
        </div>
      )}
      {/* ── Live signal banner — flashes when Crossfire fires in real time ── */}
      {aiStrategyMode && liveSignal && (
        <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2 flex-wrap animate-pulse"
             style={{
               background: liveSignal.direction === 'buy' ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
               borderBottom: `1px solid ${liveSignal.direction === 'buy' ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)'}`,
             }}>
          <span className="text-[10px] font-black uppercase tracking-widest"
                style={{ color: liveSignal.direction === 'buy' ? '#22C55E' : '#EF4444' }}>
            ▶ LIVE SIGNAL — {liveSignal.direction.toUpperCase()}
          </span>
          <div className="w-px h-4" style={{ background: 'rgba(255,255,255,0.1)' }} />
          <StatChip label="Entry" value={liveSignal.entry.toFixed(5)} />
          <StatChip label="Stop Loss" value={liveSignal.sl.toFixed(5)} color="#EF4444" />
          <StatChip label="Take Profit" value={liveSignal.tp.toFixed(5)} color="#22C55E" />
          <StatChip label="SL Pips" value={liveSignal.slPips.toFixed(1)} color="#F59E0B" />
          <StatChip label="TP Pips" value={liveSignal.tpPips.toFixed(1)} color="#22C55E" />
          <button onClick={() => setLiveSignal(null)}
                  className="ml-auto text-[9px] px-2 py-0.5 rounded"
                  style={{ color: 'rgba(241,241,255,0.4)', border: '1px solid rgba(255,255,255,0.1)' }}>
            ✕ dismiss
          </button>
        </div>
      )}
      {/* ── SMC stats bar ── */}
      {smcMode && smcStats && (
        <div className="flex-shrink-0 flex items-center gap-4 px-4 py-2 flex-wrap"
             style={{ background: 'rgba(8,6,22,0.98)', borderBottom: '1px solid rgba(245,158,11,0.25)' }}>
          <span className="text-[10px] font-black uppercase tracking-widest mr-1" style={{ color: '#FCD34D' }}>◈ SMC Order Block</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(245,158,11,0.1)', color: 'rgba(252,211,77,0.7)', border: '1px solid rgba(245,158,11,0.2)' }}>
            {pair} · {tf.label}
          </span>
          <div className="w-px h-4" style={{ background: 'rgba(255,255,255,0.08)' }} />
          {smcStats.trades === 0 ? (
            <span className="text-[10px]" style={{ color: 'rgba(241,241,255,0.4)' }}>No setups found — try zooming out or loading more history</span>
          ) : (
            <>
              <StatChip label="Trades" value={String(smcStats.trades)} />
              <StatChip label="Win Rate" value={`${smcStats.winRate.toFixed(1)}%`} color={smcStats.winRate >= 50 ? '#22C55E' : '#EF4444'} />
              <StatChip label="Avg Win" value={`+${smcStats.avgWinPips.toFixed(1)}`} color="#22C55E" />
              <StatChip label="Avg Loss" value={`−${smcStats.avgLossPips.toFixed(1)}`} color="#EF4444" />
              <StatChip label="Expectancy" value={`${smcStats.expectancyPips >= 0 ? '+' : ''}${smcStats.expectancyPips.toFixed(1)} pips`} color={smcStats.expectancyPips >= 0 ? '#22C55E' : '#EF4444'} />
              <div className="ml-auto text-[10px] tabular" style={{ color: 'rgba(241,241,255,0.3)' }}>
                {smcStats.wins}W / {smcStats.losses}L{smcStats.openTrades > 0 ? ` / ${smcStats.openTrades} open` : ''}
                {smcStats.dateFrom && <span className="ml-2" style={{ color: 'rgba(241,241,255,0.18)' }}>{smcStats.dateFrom} – {smcStats.dateTo}</span>}
              </div>
            </>
          )}
        </div>
      )}
      <div ref={chartRef} className="flex-1 min-h-0 relative">
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3" style={{ background: '#06061A' }}>
            <div className="w-8 h-8 rounded-full border-2 border-btl-purple border-t-transparent animate-spin" />
            <div className="text-sm text-btl-muted">Loading {pair} {tf.label} candles…</div>
          </div>
        )}
        {fetchErr && !loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <div className="text-2xl">⚠️</div>
            <div className="text-sm font-bold text-btl-text">Failed to load candles</div>
            <div className="text-xs text-btl-muted">{fetchErr}</div>
          </div>
        )}
        {!loading && !fetchErr && chartW > 0 && chartH > 0 && (
          <CandlestickChart
            candles={candles}
            liveCandle={liveCandle}
            pair={pair}
            predictionPrice={null}
            phase="watching"
            onNeedHistory={handleNeedHistory}
            overlays={allOverlays}
            width={chartW}
            height={chartH}
          />
        )}
      </div>

      {/* ── Hint bar ──────────────────────────────────────────────────────────── */}
      {!loading && !fetchErr && (
        <div className="flex-shrink-0 flex items-center justify-center gap-6 px-4 py-1 text-[10px]"
             style={{ borderTop: '1px solid rgba(255,255,255,0.04)', color: 'rgba(241,241,255,0.2)' }}>
          <span>Scroll = zoom · Drag = pan · Drag price axis = stretch scale · Double-click = reset</span>
          {activeStrategy === 'crossfire' && chartOverlays.length === 0 && (
            <span style={{ color: 'rgba(239,68,68,0.6)' }}>Crossfire: no 1pm candle found — scroll back to a trading day</span>
          )}
          {activeStrategy === 'crossfire' && chartOverlays.length > 0 && !backtestMode && (
            <span style={{ color: 'rgba(34,197,94,0.5)' }}>✓ Crossfire active</span>
          )}
          {activeStrategy === 'crossfire' && backtestMode && (
            <span style={{ color: 'rgba(245,158,11,0.65)' }}>⟳ Backtest mode — all 1pm sessions shown · scroll back to see more</span>
          )}
        </div>
      )}
    </div>

    {/* ── AI Analysis Panel (full-screen overlay) ────────────────────────────── */}
    {showAiPanel && (
      <AiAnalysisPanel
        trades={aiStrategyMode ? aiTrades : btTrades}
        candles={aiStrategyMode && deepCandles.length > 0 ? deepCandles : candles}
        pair={pair}
        tfLabel={tf.label}
        slMode={aiStrategyMode ? 'dynamic (AI filtered)' : slMode}
        slPips={slPips}
        rrRatio={aiStrategyMode ? aiSettings.rrRatio : rrRatio}
        onClose={() => setShowAiPanel(false)}
      />
    )}
  </>
  )
}
