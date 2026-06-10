import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useGameStore } from '../store/gameStore'
import { TOURNAMENT_TEMPLATES, TournamentTemplate } from '../types'

type Tab = 'live' | 'upcoming' | 'completed'

const TIER_COLOR: Record<string, string> = {
  Starter:       '#22C55E',
  Intermediate:  '#3B82F6',
  Professional:  '#8B5CF6',
  Expert:        '#F59E0B',
  Elite:         '#EF4444',
}

function Sparkline({ seed }: { seed: number }) {
  const pts = Array.from({ length: 11 }, (_, i) => {
    const y = 16 + Math.sin(i * 0.7 + seed) * 10 + Math.cos(i * 1.3 + seed * 2) * 5
    return `${i * 10},${Math.max(2, Math.min(30, y))}`
  }).join(' ')
  const up = Math.sin(seed) > 0
  return (
    <svg width="80" height="32" viewBox="0 0 100 32" fill="none" preserveAspectRatio="none">
      <polyline points={pts} stroke={up ? '#22C55E' : '#EF4444'} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CountdownBadge({ seconds }: { seconds: number }) {
  const m = Math.floor(seconds / 60), s = seconds % 60
  return (
    <span className="text-xs font-bold tabular px-2 py-0.5 rounded-md"
          style={{ background: 'rgba(245,158,11,0.12)', color: '#F59E0B', border: '1px solid rgba(245,158,11,0.2)' }}>
      ⏱ {m > 0 ? `${m}m ` : ''}{s}s
    </span>
  )
}

function TournamentCard({ t, index, onJoin }: { t: TournamentTemplate; index: number; onJoin: (t: TournamentTemplate) => void }) {
  const col = TIER_COLOR[t.name.split(' ')[0]] ?? '#8B5CF6'
  const countdown = 120 + index * 47

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="rounded-2xl overflow-hidden flex flex-col"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
    >
      {/* Accent bar */}
      <div className="h-[3px]" style={{ background: `linear-gradient(90deg, ${col}, ${col}44)` }} />

      <div className="p-5 flex flex-col flex-1">
        {/* Header row */}
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="font-bold text-sm text-btl-text">{t.name}</div>
            <div className="text-xs text-btl-muted mt-0.5">{t.pair} · {t.totalRounds} rounds</div>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs font-semibold text-green-400">LIVE</span>
          </div>
        </div>

        {/* Prize + sparkline */}
        <div className="flex items-end justify-between mb-4">
          <div>
            <div className="font-black text-xl tabular" style={{ color: col }}>
              ${(t.entryFee * t.maxPlayers).toLocaleString()}
            </div>
            <div className="text-[10px] text-btl-faint">prize pool</div>
          </div>
          <Sparkline seed={index * 1.3} />
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-2 mb-4 text-center">
          {[
            { label: 'Players', value: `${Math.floor(t.maxPlayers * 0.7)}/${t.maxPlayers}` },
            { label: 'Entry',   value: `${t.entryFee} pts` },
            { label: 'Rounds',  value: `${t.totalRounds}` },
          ].map(s => (
            <div key={s.label} className="py-1.5 rounded-lg"
                 style={{ background: 'rgba(255,255,255,0.04)' }}>
              <div className="font-bold text-xs text-btl-text">{s.value}</div>
              <div className="text-[10px] text-btl-faint mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Countdown + join */}
        <div className="mt-auto flex items-center gap-2">
          <CountdownBadge seconds={countdown} />
          <motion.button
            onClick={() => onJoin(t)}
            whileTap={{ scale: 0.96 }}
            className="flex-1 py-2.5 rounded-xl font-bold text-sm text-white"
            style={{ background: `linear-gradient(135deg, ${col}cc, ${col}77)`, border: `1px solid ${col}33` }}>
            Join →
          </motion.button>
        </div>
      </div>
    </motion.div>
  )
}

export default function Lobby() {
  const [tab, setTab] = useState<Tab>('live')
  const { goTo, selectTournament, startWaiting } = useGameStore()

  function handleJoin(t: TournamentTemplate) {
    selectTournament(t)
    startWaiting()
  }

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'live',      label: 'Live',      count: TOURNAMENT_TEMPLATES.length },
    { key: 'upcoming',  label: 'Upcoming',  count: 4 },
    { key: 'completed', label: 'Completed', count: 12 },
  ]

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(160deg, #0D0D1E 0%, #080818 100%)' }}>

      {/* ── Top nav ─────────────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-30 flex items-center justify-between px-8 h-16"
           style={{ background: 'rgba(8,8,24,0.9)', backdropFilter: 'blur(16px)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center gap-3">
          <button onClick={() => goTo('landing')}
                  className="flex items-center gap-1.5 text-sm font-medium text-btl-muted hover:text-btl-text transition-colors">
            ← Home
          </button>
          <div className="w-px h-4" style={{ background: 'rgba(255,255,255,0.1)' }} />
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-sm"
                 style={{ background: 'linear-gradient(135deg, #7C3AED, #3B82F6)' }}>⚔️</div>
            <span className="font-black text-btl-text">Lobby</span>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center gap-1 p-1 rounded-xl"
             style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="relative px-4 py-1.5 rounded-lg text-sm font-semibold transition-all"
              style={{ color: tab === t.key ? '#F1F1FF' : 'rgba(241,241,255,0.4)' }}>
              {tab === t.key && (
                <motion.div layoutId="tab-bg" className="absolute inset-0 rounded-lg"
                            style={{ background: 'rgba(139,92,246,0.25)', border: '1px solid rgba(139,92,246,0.3)' }} />
              )}
              <span className="relative">{t.label}</span>
              <span className="relative ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full"
                    style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(241,241,255,0.5)' }}>
                {t.count}
              </span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-btl-muted">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span className="font-semibold text-green-400">1,247 online</span>
          </div>
        </div>
      </nav>

      {/* ── Main grid ───────────────────────────────────────────────────── */}
      <main className="max-w-7xl mx-auto px-8 py-8">
        <AnimatePresence mode="wait">
          {tab === 'live' && (
            <motion.div key="live" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="grid grid-cols-3 xl:grid-cols-4 gap-4">
                {TOURNAMENT_TEMPLATES.map((t, i) => (
                  <TournamentCard key={t.id} t={t} index={i} onJoin={handleJoin} />
                ))}
                {/* Create tournament card */}
                <div className="rounded-2xl flex flex-col items-center justify-center p-8 cursor-pointer transition-colors min-h-[240px]"
                     style={{ background: 'rgba(255,255,255,0.02)', border: '2px dashed rgba(255,255,255,0.1)' }}>
                  <div className="text-3xl mb-3 opacity-40">+</div>
                  <div className="font-semibold text-sm text-btl-muted">Create Tournament</div>
                  <div className="text-xs text-btl-faint mt-1">Coming soon</div>
                </div>
              </div>
            </motion.div>
          )}
          {tab === 'upcoming' && (
            <motion.div key="upcoming" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="flex flex-col items-center justify-center py-24">
              <div className="text-4xl mb-4">⏳</div>
              <div className="font-bold text-btl-muted">Upcoming tournaments loading…</div>
              <div className="text-sm text-btl-faint mt-2">Check back in a few minutes</div>
            </motion.div>
          )}
          {tab === 'completed' && (
            <motion.div key="completed" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="flex flex-col items-center justify-center py-24">
              <div className="text-4xl mb-4">🏆</div>
              <div className="font-bold text-btl-muted">No completed tournaments yet</div>
              <div className="text-sm text-btl-faint mt-2">Play your first game to see results here</div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  )
}
