import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useGameStore } from '../store/gameStore'

const RANK_EMOJIS = ['🥇', '🥈', '🥉']

function ConfettiPiece({ color, delay }: { color: string; delay: number }) {
  const left = Math.random() * 100
  const size = 6 + Math.random() * 8
  return (
    <div
      className="absolute pointer-events-none animate-confetti-fall"
      style={{
        left: `${left}%`,
        top: '-10px',
        width: size,
        height: size,
        background: color,
        borderRadius: Math.random() > 0.5 ? '50%' : '2px',
        animationDelay: `${delay}s`,
      }}
    />
  )
}

export default function Results() {
  const { players, myPoints, myStreak, goTo, resetGame } = useGameStore()
  const [show, setShow] = useState(false)

  const sorted      = [...players].sort((a, b) => b.points - a.points)
  const myRank      = sorted.findIndex(p => p.isHuman) + 1
  const isWinner    = myRank === 1
  const myPlayer    = sorted.find(p => p.isHuman)

  const CONFETTI_COLORS = ['#8B5CF6','#22C55E','#F59E0B','#3B82F6','#EF4444','#EC4899']

  useEffect(() => {
    const t = setTimeout(() => setShow(true), 100)
    return () => clearTimeout(t)
  }, [])

  function handlePlayAgain() {
    resetGame()
    goTo('lobby')
  }

  return (
    <div className="min-h-full bg-btl-bg overflow-y-auto pt-safe pb-safe">

      {/* Confetti */}
      {isWinner && show && (
        <div className="fixed inset-0 pointer-events-none z-10 overflow-hidden">
          {Array.from({ length: 40 }).map((_, i) => (
            <ConfettiPiece
              key={i}
              color={CONFETTI_COLORS[i % CONFETTI_COLORS.length]}
              delay={Math.random() * 2}
            />
          ))}
        </div>
      )}

      {/* Background orbs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="orb w-80 h-80 -top-24 left-1/2 -translate-x-1/2 animate-orb-drift"
             style={{ background: isWinner ? 'rgba(245,158,11,0.14)' : 'rgba(139,92,246,0.10)' }} />
        <div className="orb w-64 h-64 bottom-0 -right-20 animate-orb-drift-2"
             style={{ background: 'rgba(59,130,246,0.07)' }} />
      </div>

      <div className="relative z-10 max-w-lg mx-auto px-4">
        <AnimatePresence>
          {show && (
            <>
              {/* Hero result */}
              <motion.div
                initial={{ opacity: 0, scale: 0.7, y: 40 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 22, delay: 0.1 }}
                className="text-center pt-12 pb-8"
              >
                <div className="text-7xl mb-4 animate-bounce-in">
                  {isWinner ? '🏆' : myRank <= 3 ? RANK_EMOJIS[myRank - 1] : '🎮'}
                </div>
                <div
                  className="font-extrabold text-3xl mb-1"
                  style={{
                    color: isWinner ? '#F59E0B' : myRank <= 3 ? '#8B5CF6' : '#F1F1FF',
                    textShadow: isWinner ? '0 0 24px rgba(245,158,11,0.5)' : 'none',
                  }}
                >
                  {isWinner ? 'CHAMPION!' : myRank <= 3 ? `Top ${myRank}!` : `Rank #${myRank}`}
                </div>
                <div className="text-btl-muted text-sm">
                  {isWinner ? 'You dominated the tournament!' : `You finished #${myRank} out of ${sorted.length}`}
                </div>
              </motion.div>

              {/* My stats card */}
              <motion.div
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25, type: 'spring', stiffness: 280 }}
                className="p-5 rounded-3xl mb-5 card-shadow"
                style={{
                  background: isWinner
                    ? 'linear-gradient(135deg, rgba(245,158,11,0.12) 0%, rgba(245,158,11,0.04) 100%)'
                    : 'rgba(255,255,255,0.04)',
                  border: isWinner ? '1.5px solid rgba(245,158,11,0.3)' : '1px solid rgba(255,255,255,0.08)',
                }}
              >
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <div className="text-xs text-btl-faint mb-1">Final Points</div>
                    <div
                      className="font-extrabold text-2xl tabular"
                      style={{ color: isWinner ? '#F59E0B' : '#F1F1FF' }}
                    >
                      {(myPlayer?.points ?? myPoints).toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-btl-faint mb-1">Best Streak</div>
                    <div className="font-extrabold text-2xl" style={{ color: '#F97316' }}>
                      {myPlayer?.bestStreak ?? myStreak}×
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-btl-faint mb-1">Rank</div>
                    <div className="font-extrabold text-2xl" style={{ color: '#8B5CF6' }}>
                      #{myRank}
                    </div>
                  </div>
                </div>
              </motion.div>

              {/* Final leaderboard */}
              <motion.div
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.35, type: 'spring', stiffness: 260 }}
                className="rounded-3xl overflow-hidden mb-6 card-shadow"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
              >
                <div className="px-4 py-3 flex items-center justify-between"
                     style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                  <span className="font-bold text-sm text-btl-text">Final Standings</span>
                  <span className="text-xs text-btl-faint">{sorted.length} players</span>
                </div>
                <div className="p-2 space-y-1.5 max-h-64 overflow-y-auto">
                  {sorted.map((p, i) => (
                    <div
                      key={p.id}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-2xl"
                      style={{
                        background: p.isHuman ? 'rgba(139,92,246,0.12)' : i < 3 ? 'rgba(255,255,255,0.04)' : 'transparent',
                        border: p.isHuman ? '1.5px solid rgba(139,92,246,0.28)' : 'none',
                      }}
                    >
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0"
                        style={{
                          background: i === 0 ? 'rgba(245,158,11,0.2)' : i === 1 ? 'rgba(156,163,175,0.15)' : i === 2 ? 'rgba(180,113,60,0.15)' : 'rgba(255,255,255,0.06)',
                          color: i === 0 ? '#F59E0B' : i === 1 ? '#9CA3AF' : i === 2 ? '#B4713C' : 'rgba(241,241,255,0.5)',
                        }}
                      >
                        {p.eliminated ? '💀' : i < 3 ? RANK_EMOJIS[i] : i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div
                          className="font-semibold text-sm truncate"
                          style={{ color: p.isHuman ? '#A78BFA' : p.eliminated ? 'rgba(241,241,255,0.3)' : '#F1F1FF' }}
                        >
                          {p.name}{p.isHuman ? ' (you)' : ''}
                        </div>
                      </div>
                      <div
                        className="font-bold text-sm tabular"
                        style={{ color: p.eliminated ? 'rgba(241,241,255,0.3)' : p.isHuman ? '#A78BFA' : '#F1F1FF' }}
                      >
                        {p.points.toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>

              {/* Actions */}
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.45 }}
                className="flex flex-col gap-3 mb-10"
              >
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={handlePlayAgain}
                  className="w-full py-4 rounded-3xl font-extrabold text-base text-white shimmer-over"
                  style={{
                    background: 'linear-gradient(135deg, #7C3AED, #8B5CF6)',
                    boxShadow: '0 8px 28px rgba(139,92,246,0.4)',
                  }}
                >
                  Play Again →
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => goTo('landing')}
                  className="w-full py-3.5 rounded-3xl font-bold text-sm text-btl-muted"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  Back to Home
                </motion.button>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
