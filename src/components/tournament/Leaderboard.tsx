import { motion, AnimatePresence } from 'framer-motion'
import type { Player } from '../../types'

interface LeaderboardProps {
  players: Player[]
  currentRound: number
  totalRounds: number
  myId: string
}

const RANK_ICONS = ['👑', '🥈', '🥉']
const AVATARS    = ['🐺','🦊','🐯','🦁','🐻','🦅','🦈','🐉','⚡','🔥','💎','🎯']

export default function Leaderboard({ players, currentRound, totalRounds, myId }: LeaderboardProps) {
  const sorted = [...players].sort((a, b) => b.points - a.points)
  const me     = sorted.findIndex(p => p.isHuman)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 flex-shrink-0"
           style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="flex gap-1">
          <button className="px-3 py-1 rounded-lg text-[11px] font-bold text-white"
                  style={{ background: 'linear-gradient(135deg, #7C3AED, #8B5CF6)' }}>
            Leaderboard
          </button>
          <button className="px-3 py-1 rounded-lg text-[11px] font-medium text-btl-muted">
            My Rank
          </button>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          <span className="text-[10px] text-green-400 font-semibold">Live</span>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        <AnimatePresence mode="popLayout">
          {sorted.map((p, i) => {
            const isMe   = p.isHuman
            const rank   = i + 1
            const avatar = AVATARS[i % AVATARS.length]
            return (
              <motion.div
                key={p.id}
                layout
                initial={{ opacity: 0, x: -12 }} animate={{ opacity: p.eliminated ? 0.3 : 1, x: 0 }}
                exit={{ opacity: 0, x: 12 }}
                transition={{ type: 'spring', stiffness: 260, damping: 28 }}
                className="flex items-center gap-2 px-2.5 py-2 rounded-xl mb-1"
                style={{
                  background: isMe ? 'rgba(139,92,246,0.12)' : rank <= 3 ? 'rgba(255,255,255,0.04)' : 'transparent',
                  border: isMe ? '1px solid rgba(139,92,246,0.3)' : 'none',
                }}
              >
                {/* Rank badge */}
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs flex-shrink-0 font-bold"
                     style={{
                       background: rank === 1 ? 'rgba(245,158,11,0.2)' : rank === 2 ? 'rgba(156,163,175,0.15)' : rank === 3 ? 'rgba(180,113,60,0.15)' : 'rgba(255,255,255,0.06)',
                       color: rank <= 3 ? (rank===1?'#F59E0B':rank===2?'#9CA3AF':'#B45309') : 'rgba(241,241,255,0.4)',
                     }}>
                  {p.eliminated ? '💀' : rank <= 3 ? RANK_ICONS[rank-1] : rank}
                </div>

                {/* Avatar */}
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-sm flex-shrink-0"
                     style={{ background: 'rgba(255,255,255,0.08)' }}>
                  {isMe ? '😎' : avatar}
                </div>

                {/* Name */}
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-xs truncate"
                       style={{ color: isMe ? '#A78BFA' : p.eliminated ? 'rgba(241,241,255,0.3)' : '#F1F1FF' }}>
                    {p.name}{isMe ? ' (You)' : ''}
                  </div>
                  {p.streak >= 2 && !p.eliminated && (
                    <div className="text-[10px]" style={{ color: '#F97316' }}>🔥 {p.streak}×</div>
                  )}
                </div>

                {/* Points */}
                <motion.div key={p.points} initial={{ scale: 1.2 }} animate={{ scale: 1 }}
                  className="font-bold text-xs tabular"
                  style={{ color: isMe ? '#A78BFA' : p.eliminated ? 'rgba(241,241,255,0.25)' : '#F1F1FF' }}>
                  {p.points.toLocaleString()}
                </motion.div>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>

      {/* "You" sticky row if not in top */}
      {me >= 5 && !players[me]?.eliminated && (
        <div className="flex-shrink-0 px-2 pb-2 pt-1" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="flex items-center gap-2 px-2.5 py-2 rounded-xl"
               style={{ background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)' }}>
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                 style={{ background: 'rgba(139,92,246,0.3)', color: '#A78BFA' }}>{me+1}</div>
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-sm"
                 style={{ background: 'rgba(255,255,255,0.08)' }}>😎</div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-xs" style={{ color: '#A78BFA' }}>You</div>
            </div>
            <div className="font-bold text-xs text-btl-text tabular">{sorted[me]?.points.toLocaleString()}</div>
          </div>
          <div className="text-[10px] text-btl-faint text-center mt-1">🏆 Top 10 players win the prize pool!</div>
        </div>
      )}
    </div>
  )
}
