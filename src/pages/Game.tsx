import { useRef, useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useGameStore } from '../store/gameStore'
import { useLiveRate } from '../hooks/useLiveRate'
import { useOandaStream } from '../hooks/useOandaStream'
import CandlestickChart from '../components/chart/CandlestickChart'
import PredictionControls from '../components/game/PredictionControls'
import Timer from '../components/game/Timer'
import Leaderboard from '../components/tournament/Leaderboard'
import RoundResultOverlay from '../components/game/RoundResultOverlay'
import EliminationOverlay from '../components/game/EliminationOverlay'
import { StreakMilestoneToast } from '../components/game/StreakBadge'
import { PHASE_DURATIONS } from '../types'
import { formatPrice } from '../utils/forex'
import { streakMultiplier } from '../types'

function useChartSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      setSize({ w: Math.floor(width), h: Math.floor(height) })
    })
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [ref])
  return size
}

export default function Game() {
  const chartRef = useRef<HTMLDivElement>(null)
  const { w: chartW, h: chartH } = useChartSize(chartRef)
  const [streakToast, setStreakToast] = useState(false)
  const [prevStreak, setPrevStreak]   = useState(0)

  const {
    candles, liveCandle, pair,
    currentRound, totalRounds, roundPhase, phaseTimer,
    myPoints, myStreak, myPrediction, myRiskLevel,
    predictionPrice, eliminated,
    players, selectedTemplate,
    lastRoundResult, showResultOverlay, showEliminationOverlay, eliminatedNames,
    makePrediction, setRiskLevel, setLiveBasePrice, pushLiveTick,
    dismissResultOverlay, dismissEliminationOverlay,
    goTo,
  } = useGameStore()

  // ── Live OANDA price stream ────────────────────────────────────────────
  const handleTick = useCallback((price: number) => pushLiveTick(price), [pushLiveTick])
  const { status: streamStatus } = useOandaStream(pair, handleTick)
  const isLive = streamStatus === 'connected'

  // Fallback: seed simulation starting price from daily Frankfurter rate
  // (only matters when OANDA stream is unconfigured)
  const { rate: liveRate } = useLiveRate(pair)
  useEffect(() => {
    if (liveRate) setLiveBasePrice(liveRate)
  }, [liveRate, setLiveBasePrice])

  const phaseTotal  = PHASE_DURATIONS[roundPhase as 'watching' | 'predicting' | 'resolving'] ?? 20
  const activeCount = players.filter(p => !p.eliminated).length
  const myRank      = [...players].filter(p => !p.eliminated).sort((a, b) => b.points - a.points).findIndex(p => p.isHuman) + 1
  const currentPrice = liveCandle?.close ?? candles[candles.length - 1]?.close ?? 0
  const prevPrice    = candles.length >= 2 ? candles[candles.length - 2]?.close : (candles[0]?.open ?? currentPrice)
  const priceChange  = currentPrice - prevPrice
  const priceChangePct = prevPrice > 0 ? ((priceChange / prevPrice) * 100).toFixed(2) : '0.00'
  const priceUp      = priceChange >= 0
  const mult         = streakMultiplier(myStreak)
  const phase        = (roundPhase === 'between' ? 'watching' : roundPhase) as 'watching' | 'predicting' | 'resolving'

  useEffect(() => {
    if (myStreak > prevStreak && [2, 3, 5, 7, 10].includes(myStreak)) setStreakToast(true)
    setPrevStreak(myStreak)
  }, [myStreak])

  return (
    <div className="fixed inset-0 flex flex-col no-select overflow-hidden"
         style={{ background: 'linear-gradient(160deg, #0D0D1E 0%, #080818 100%)' }}>

      {/* ── Top header bar ───────────────────────────────────────────────── */}
      <header className="flex-shrink-0 flex items-center gap-4 px-5 h-14"
              style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'rgba(8,8,24,0.92)', backdropFilter: 'blur(12px)', zIndex: 20 }}>

        {/* Back */}
        <button onClick={() => goTo('lobby')}
                className="flex items-center gap-1.5 text-sm font-medium text-btl-muted hover:text-btl-text transition-colors px-3 py-1.5 rounded-lg"
                style={{ background: 'rgba(255,255,255,0.05)' }}>
          ← Lobby
        </button>

        {/* Pair + live price */}
        <div className="flex items-center gap-3">
          <span className="font-black text-lg text-btl-text tracking-tight">{pair}</span>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg"
               style={{ background: priceUp ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)', border: `1px solid ${priceUp ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}` }}>
            <span className="font-bold text-base tabular" style={{ color: priceUp ? '#22C55E' : '#EF4444' }}>
              {formatPrice(currentPrice, pair)}
            </span>
            <span className="text-xs font-semibold tabular" style={{ color: priceUp ? '#22C55E' : '#EF4444' }}>
              {priceUp ? '▲' : '▼'} {Math.abs(Number(priceChangePct))}%
            </span>
          </div>
          {/* Live status badge */}
          {isLive ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md"
                 style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)' }}>
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs font-bold" style={{ color: '#22C55E' }}>LIVE OANDA</span>
            </div>
          ) : streamStatus === 'connecting' ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md"
                 style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)' }}>
              <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
              <span className="text-xs font-semibold" style={{ color: '#F59E0B' }}>Connecting…</span>
            </div>
          ) : (
            <span className="text-xs text-btl-faint px-2 py-0.5 rounded-md"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
              Simulated
            </span>
          )}
        </div>

        <div className="flex-1" />

        {/* Round + players */}
        <div className="flex items-center gap-4 text-sm">
          <div className="text-btl-muted">
            Round <span className="font-bold text-btl-text">{currentRound}</span>
            <span className="text-btl-faint">/{totalRounds}</span>
          </div>
          <div className="flex items-center gap-1.5 text-btl-muted">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="font-semibold text-btl-text">{activeCount}</span> active
          </div>
          {myStreak >= 2 && (
            <div className="flex items-center gap-1 px-2 py-1 rounded-lg"
                 style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)' }}>
              <span className="streak-fire">🔥</span>
              <span className="font-bold text-xs" style={{ color: '#F59E0B' }}>{myStreak}×</span>
            </div>
          )}
        </div>
      </header>

      {/* ── Main 2-column body ────────────────────────────────────────────── */}
      <div className="flex-1 flex min-h-0">

        {/* ── LEFT: Chart ───────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Chart fills the space */}
          <div ref={chartRef} className="flex-1 min-h-0" style={{ background: '#06061A' }}>
            {chartW > 0 && chartH > 0 && (
              <CandlestickChart
                candles={candles}
                liveCandle={liveCandle}
                pair={pair}
                predictionPrice={predictionPrice}
                phase={phase}
                zoomPips={20}
                width={chartW}
                height={chartH}
              />
            )}
          </div>

          {/* Prediction controls - sits below chart */}
          <div className="flex-shrink-0"
               style={{ borderTop: '1px solid rgba(255,255,255,0.07)', background: 'rgba(8,8,24,0.95)', backdropFilter: 'blur(12px)' }}>
            <PredictionControls
              pair={pair}
              phase={phase}
              myPrediction={myPrediction}
              myRiskLevel={myRiskLevel}
              predictionPrice={predictionPrice}
              phaseTimer={phaseTimer}
              myStreak={myStreak}
              onPredict={makePrediction}
              onRiskChange={setRiskLevel}
            />
          </div>
        </div>

        {/* ── RIGHT: Sidebar ─────────────────────────────────────────────── */}
        <div className="w-80 xl:w-96 flex-shrink-0 flex flex-col min-h-0"
             style={{ borderLeft: '1px solid rgba(255,255,255,0.07)', background: 'rgba(6,6,24,0.6)' }}>

          {/* Timer section */}
          <div className="flex-shrink-0 flex flex-col items-center py-5 px-4"
               style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <Timer
              current={phaseTimer}
              total={phaseTotal}
              phase={phase}
              size={72}
            />
          </div>

          {/* My stats strip */}
          <div className="flex-shrink-0 grid grid-cols-4 gap-0"
               style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            {[
              { label: 'Balance', value: myPoints.toLocaleString(), icon: '💰', accent: '#F59E0B' },
              { label: 'Streak',  value: myStreak > 0 ? `${myStreak}×` : '—', icon: '🔥', accent: '#F97316' },
              { label: 'Multi',   value: mult > 1 ? `×${mult.toFixed(1)}` : '×1', icon: '⚡', accent: '#8B5CF6' },
              { label: 'Rank',    value: myRank > 0 ? `#${myRank}` : '—', icon: '🏆', accent: '#F59E0B' },
            ].map(s => (
              <div key={s.label} className="flex flex-col items-center py-2.5 px-1"
                   style={{ borderRight: '1px solid rgba(255,255,255,0.05)' }}>
                <div className="text-[10px] text-btl-muted mb-0.5">{s.label}</div>
                <div className="font-black text-sm tabular" style={{ color: s.accent }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Leaderboard takes remaining space */}
          <div className="flex-1 min-h-0 overflow-hidden">
            <Leaderboard
              players={players}
              currentRound={currentRound}
              totalRounds={totalRounds}
              myId="human"
            />
          </div>
        </div>
      </div>

      {/* ── Overlays ──────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showResultOverlay && lastRoundResult && (
          <RoundResultOverlay result={lastRoundResult} onDismiss={dismissResultOverlay} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showEliminationOverlay && (
          <EliminationOverlay
            eliminatedNames={eliminatedNames}
            onDismiss={dismissEliminationOverlay}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {streakToast && (
          <StreakMilestoneToast streak={myStreak} onDone={() => setStreakToast(false)} />
        )}
      </AnimatePresence>
    </div>
  )
}
