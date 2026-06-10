import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useGameStore } from '../store/gameStore'
import { TOURNAMENT_TEMPLATES } from '../types'
import { useLiveRate } from '../hooks/useLiveRate'

// Tiny sparkline SVG for tournament cards
function Sparkline({ up }: { up: boolean }) {
  const pts = up
    ? '0,30 10,22 20,26 30,14 40,18 50,8 60,12 70,4 80,8 90,2 100,6'
    : '0,4 10,10 20,6 30,18 40,14 50,24 60,20 70,28 80,24 90,30 100,26'
  return (
    <svg width="100" height="32" viewBox="0 0 100 32" fill="none" preserveAspectRatio="none">
      <polyline points={pts} stroke={up ? '#22C55E' : '#EF4444'} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const FEATURES = [
  { icon: '⚡', title: 'Live Forex Charts', desc: 'Real-time candlestick data seeded from live EUR/USD market prices' },
  { icon: '🏆', title: 'Tournament Play',   desc: 'Compete against up to 20 players across multiple rounds' },
  { icon: '🎯', title: 'Risk Management',   desc: 'Choose SAFE, BALANCED or AGGRESSIVE for every prediction' },
  { icon: '🔥', title: 'Streak Multipliers', desc: 'Build winning streaks to amplify your points with multipliers' },
]

export default function Landing() {
  const { goTo, selectTournament, startWaiting, setLiveBasePrice } = useGameStore()
  const { rate: liveRate, lastUpdated } = useLiveRate('EUR/USD')
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (liveRate) setLiveBasePrice(liveRate)
  }, [liveRate, setLiveBasePrice])

  // Simulate live price movement for the hero display
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 800)
    return () => clearInterval(id)
  }, [])

  const baseRate  = liveRate ?? 1.0854
  const simDelta  = Math.sin(tick * 0.3) * 0.0008 + Math.cos(tick * 0.17) * 0.0004
  const simPrice  = baseRate + simDelta
  const simUp     = simDelta >= 0

  function handleJoin(t: typeof TOURNAMENT_TEMPLATES[0]) {
    selectTournament(t)
    startWaiting()
  }

  return (
    <div className="min-h-screen overflow-x-hidden" style={{ background: 'linear-gradient(160deg, #0D0D1E 0%, #080818 100%)' }}>

      {/* ── Top nav ───────────────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-30 flex items-center justify-between px-8 h-16"
           style={{ background: 'rgba(8,8,24,0.9)', backdropFilter: 'blur(16px)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center text-lg"
               style={{ background: 'linear-gradient(135deg, #7C3AED, #3B82F6)' }}>⚔️</div>
          <span className="font-black text-lg text-btl-text tracking-tight">Forex Battle</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => goTo('lobby')}
                  className="px-4 py-2 rounded-lg text-sm font-semibold text-btl-muted hover:text-btl-text transition-colors"
                  style={{ background: 'rgba(255,255,255,0.05)' }}>
            Lobby
          </button>
          <button onClick={() => goTo('chart')}
                  className="px-4 py-2 rounded-lg text-sm font-semibold text-btl-muted hover:text-btl-text transition-colors"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
            📈 View Chart
          </button>
          <motion.button
            onClick={() => goTo('lobby')}
            whileTap={{ scale: 0.96 }}
            className="px-5 py-2 rounded-lg text-sm font-bold text-white"
            style={{ background: 'linear-gradient(135deg, #7C3AED, #6D28D9)' }}>
            Play Now →
          </motion.button>
        </div>
      </nav>

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="max-w-7xl mx-auto px-8 py-20 grid grid-cols-2 gap-16 items-center">
        {/* Left: copy */}
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold mb-6"
               style={{ background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)', color: '#A78BFA' }}>
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            Live Tournament Prediction Game
          </div>
          <h1 className="text-6xl font-black leading-none mb-4">
            <span style={{ background: 'linear-gradient(135deg, #F1F1FF 0%, rgba(241,241,255,0.7) 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              Predict.<br />Outsmart.<br />
            </span>
            <span style={{ background: 'linear-gradient(135deg, #8B5CF6 0%, #3B82F6 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              Win.
            </span>
          </h1>
          <p className="text-lg text-btl-muted leading-relaxed mb-8 max-w-md">
            Compete in live forex prediction tournaments. Call the market UP or DOWN, build streaks, and climb the leaderboard to win real prizes.
          </p>
          <div className="flex items-center gap-3">
            <motion.button
              onClick={() => goTo('lobby')}
              whileTap={{ scale: 0.97 }}
              className="px-8 py-4 rounded-xl font-black text-lg text-white"
              style={{ background: 'linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)', boxShadow: '0 8px 32px rgba(124,58,237,0.4)' }}>
              Enter Lobby →
            </motion.button>
            <div className="text-sm text-btl-muted">
              <div className="font-semibold text-btl-text">10,000+</div>
              battles played
            </div>
          </div>
        </div>

        {/* Right: live rate card */}
        <div className="space-y-4">
          {/* Live rate display */}
          <div className="rounded-2xl p-6"
               style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(20px)' }}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <span className="text-sm font-semibold text-btl-muted">EUR/USD — Live Rate</span>
              </div>
              {lastUpdated && (
                <span className="text-[10px] text-btl-faint">
                  Updated {lastUpdated.toLocaleTimeString()}
                </span>
              )}
            </div>
            <div className="flex items-end gap-3 mb-4">
              <motion.div
                key={Math.floor(simPrice * 10000)}
                initial={{ opacity: 0.6 }} animate={{ opacity: 1 }}
                className="text-5xl font-black tabular"
                style={{ color: simUp ? '#22C55E' : '#EF4444' }}>
                {simPrice.toFixed(5)}
              </motion.div>
              <div className="pb-1.5">
                <div className="text-sm font-bold" style={{ color: simUp ? '#22C55E' : '#EF4444' }}>
                  {simUp ? '▲' : '▼'} {(Math.abs(simDelta) * 10000).toFixed(1)} pips
                </div>
                {liveRate && <div className="text-[10px] text-btl-faint">Seeded from real market</div>}
              </div>
            </div>
            <Sparkline up={simUp} />
          </div>

          {/* Quick stats row */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Active Players', value: '1,247', icon: '👥' },
              { label: 'Prize Pool',     value: '$12,400', icon: '💰' },
              { label: 'Live Games',     value: '34', icon: '🎮' },
            ].map(s => (
              <div key={s.label} className="rounded-xl p-3 text-center"
                   style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="text-xl mb-1">{s.icon}</div>
                <div className="font-black text-base text-btl-text">{s.value}</div>
                <div className="text-[10px] text-btl-faint mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ──────────────────────────────────────────────────────── */}
      <section className="max-w-7xl mx-auto px-8 py-12">
        <div className="grid grid-cols-4 gap-4">
          {FEATURES.map(f => (
            <div key={f.title} className="rounded-2xl p-5"
                 style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="text-2xl mb-3">{f.icon}</div>
              <div className="font-bold text-btl-text mb-1.5 text-sm">{f.title}</div>
              <div className="text-xs text-btl-muted leading-relaxed">{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Tournaments ───────────────────────────────────────────────────── */}
      <section className="max-w-7xl mx-auto px-8 py-12">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-black text-btl-text">Live Tournaments</h2>
          <button onClick={() => goTo('lobby')} className="text-sm font-semibold text-btl-purple hover:underline">
            View all →
          </button>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {TOURNAMENT_TEMPLATES.map((t, i) => {
            const colors = ['#8B5CF6','#22C55E','#F59E0B']
            const col = colors[i % colors.length]
            return (
              <div key={t.id} className="rounded-2xl overflow-hidden"
                   style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <div className="h-1" style={{ background: col }} />
                <div className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="font-bold text-btl-text">{t.name}</div>
                      <div className="text-xs text-btl-muted mt-0.5">{t.pair} · {t.totalRounds} rounds</div>
                    </div>
                    <div className="text-right">
                      <div className="font-black text-base" style={{ color: col }}>${(t.entryFee * t.maxPlayers).toLocaleString()}</div>
                      <div className="text-[10px] text-btl-faint">prize pool</div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs text-btl-muted mb-4">
                    <span>👥 {t.maxPlayers} players</span>
                    <span>⏱ {t.totalRounds} rounds</span>
                    <span>🎟 {t.entryFee} pts entry</span>
                  </div>
                  <Sparkline up={i % 2 === 0} />
                  <motion.button
                    onClick={() => handleJoin(t)}
                    whileTap={{ scale: 0.97 }}
                    className="w-full mt-4 py-2.5 rounded-xl font-bold text-sm text-white"
                    style={{ background: `linear-gradient(135deg, ${col}cc, ${col}88)`, border: `1px solid ${col}44` }}>
                    Join Tournament →
                  </motion.button>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <div className="h-16" />
    </div>
  )
}
