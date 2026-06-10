import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { RoundResult } from '../../types'

interface Props { result: RoundResult; onDismiss: () => void }

function Particle({ color, i }: { color: string; i: number }) {
  const angle  = (i / 20) * 360
  const dist   = 80 + Math.random() * 80
  const x      = Math.cos(angle * Math.PI / 180) * dist
  const y      = Math.sin(angle * Math.PI / 180) * dist
  const shapes = ['circle', 'square']
  const shape  = shapes[i % shapes.length]
  return (
    <motion.div
      initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
      animate={{ x, y, opacity: 0, scale: 0, rotate: angle * 2 }}
      transition={{ duration: 0.9 + Math.random() * 0.6, ease: 'easeOut', delay: Math.random() * 0.2 }}
      className="absolute"
      style={{
        width: 6 + (i % 4) * 2,
        height: 6 + (i % 4) * 2,
        background: color,
        borderRadius: shape === 'circle' ? '50%' : '2px',
        top: '50%', left: '50%',
        marginTop: -(3 + (i % 4)),
        marginLeft: -(3 + (i % 4)),
      }}
    />
  )
}

const COLORS = ['#22C55E','#F59E0B','#8B5CF6','#3B82F6','#EC4899','#F97316','#4ADE80','#FCD34D']

export default function RoundResultOverlay({ result, onDismiss }: Props) {
  const [count, setCount] = useState(0)
  const [nextIn, setNextIn] = useState(3)
  const won    = result.won
  const skip   = result.prediction === 'skip'
  const change = Math.abs(result.pointsChange)

  useEffect(() => {
    if (!change) return
    const step = change / 22
    let cur = 0
    const t = setInterval(() => {
      cur += step
      if (cur >= change) { setCount(change); clearInterval(t) }
      else setCount(Math.floor(cur))
    }, 28)
    return () => clearInterval(t)
  }, [change])

  useEffect(() => {
    if (nextIn <= 0) { onDismiss(); return }
    const t = setInterval(() => setNextIn(n => n - 1), 1000)
    return () => clearInterval(t)
  }, [nextIn, onDismiss])

  const verdict = skip ? { label: 'SKIPPED', color: '#8B5CF6', icon: '⏭', sub: '' }
    : won ? { label: 'CORRECT!', color: '#22C55E', icon: '↑', sub: `EUR/USD went ${result.marketResult.toUpperCase()}` }
    : { label: 'WRONG', color: '#EF4444', icon: '↓', sub: `EUR/USD went ${result.marketResult.toUpperCase()}` }

  return (
    <AnimatePresence>
      <motion.div
        key="rr"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-50 flex flex-col items-center justify-center px-5"
        style={{ background: 'rgba(8,8,20,0.9)', backdropFilter: 'blur(12px)' }}
        onClick={onDismiss}
      >
        {/* Radial burst */}
        {!skip && (
          <motion.div
            initial={{ opacity: 0, scale: 0.3 }} animate={{ opacity: [0, 0.25, 0], scale: [0.3, 2.8, 3.5] }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            className="absolute inset-0 pointer-events-none"
            style={{ background: `radial-gradient(circle at 50% 40%, ${verdict.color} 0%, transparent 60%)` }}
          />
        )}

        <motion.div
          initial={{ scale: 0.6, y: 40, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }}
          exit={{ scale: 0.85, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 360, damping: 22 }}
          className="relative w-full max-w-xs rounded-3xl px-6 py-8 text-center"
          style={{
            background: 'linear-gradient(160deg, #1C1C36 0%, #0E0E24 100%)',
            border: `1.5px solid ${verdict.color}30`,
            boxShadow: `0 0 48px ${verdict.color}20, 0 24px 60px rgba(0,0,0,0.7)`,
          }}
          onClick={e => e.stopPropagation()}
        >
          {/* VERDICT label */}
          <motion.div
            initial={{ y: -12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.1 }}
            className="font-black mb-1" style={{ fontSize: '2.4rem', color: verdict.color, textShadow: `0 0 24px ${verdict.color}70`, letterSpacing: '-0.01em' }}
          >
            {verdict.label}
          </motion.div>

          {verdict.sub && (
            <div className="text-sm text-btl-muted mb-4">{verdict.sub}</div>
          )}

          {/* Big circle icon with particles */}
          {!skip && (
            <div className="relative flex justify-center mb-5">
              <div className="relative">
                {/* Particles */}
                {Array.from({ length: 20 }).map((_, i) => (
                  <Particle key={i} color={COLORS[i % COLORS.length]} i={i} />
                ))}
                {/* Circle */}
                <motion.div
                  initial={{ scale: 0 }} animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 18, delay: 0.05 }}
                  className="relative z-10 w-24 h-24 rounded-full flex items-center justify-center"
                  style={{
                    background: `radial-gradient(circle, ${verdict.color}30 0%, ${verdict.color}10 100%)`,
                    border: `3px solid ${verdict.color}`,
                    boxShadow: `0 0 32px ${verdict.color}50, 0 0 64px ${verdict.color}20`,
                  }}
                >
                  <span className="font-black text-4xl" style={{ color: verdict.color }}>{verdict.icon}</span>
                </motion.div>
              </div>
            </div>
          )}

          {/* Points */}
          {change > 0 && (
            <motion.div
              initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.18, type: 'spring', stiffness: 340 }}
              className="mb-4"
            >
              <div className="font-black tabular" style={{
                fontSize: '3rem', lineHeight: 1,
                color: result.pointsChange > 0 ? '#F59E0B' : '#F87171',
                textShadow: result.pointsChange > 0 ? '0 0 24px rgba(245,158,11,0.6)' : '0 0 24px rgba(239,68,68,0.6)',
              }}>
                {result.pointsChange > 0 ? '+' : '-'}{count}
              </div>
              <div className="text-sm text-btl-muted mt-0.5">POINTS</div>
            </motion.div>
          )}

          {/* Stats row */}
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.28 }}
            className="grid grid-cols-3 gap-2 mb-5 text-center"
          >
            <div>
              <div className="text-xs text-btl-faint mb-0.5">New Balance</div>
              <div className="font-bold text-sm text-btl-text">{(result.pointsBefore + result.pointsChange).toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs text-btl-faint mb-0.5">Streak</div>
              <div className="font-bold text-sm" style={{ color: result.streakAfter >= 2 ? '#F97316' : '#9CA3AF' }}>
                {result.streakAfter >= 1 ? `🔥 ${result.streakAfter}` : '—'}
              </div>
            </div>
            <div>
              <div className="text-xs text-btl-faint mb-0.5">Multiplier</div>
              <div className="font-bold text-sm" style={{ color: result.multiplier > 1 ? '#F59E0B' : '#9CA3AF' }}>
                ×{result.multiplier.toFixed(2)}
              </div>
            </div>
          </motion.div>

          {/* Next round button */}
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={onDismiss}
            className="w-full py-3.5 rounded-2xl font-bold text-base text-white mb-3"
            style={{ background: 'linear-gradient(135deg, #7C3AED, #8B5CF6)', boxShadow: '0 6px 20px rgba(139,92,246,0.45)' }}
          >
            NEXT ROUND
          </motion.button>

          <div className="text-xs text-btl-faint">Round starts in {nextIn}…</div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
