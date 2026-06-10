import { motion, AnimatePresence } from 'framer-motion'
import { useGameStore } from '../store/gameStore'

const BOT_AVATARS = ['🐺','🦊','🐯','🦁','🐻','🦅','🦈','🐉','🎯','⚡','🔥','💎','🏆','🎲','🃏','🎮']

export default function WaitingRoom() {
  const { players, selectedTemplate, waitingCountdown, goTo, startGame } = useGameStore()

  const filled    = players.length
  const total     = selectedTemplate?.maxPlayers ?? 10
  const fillPct   = Math.round((filled / total) * 100)
  const readyToGo = filled >= total || waitingCountdown <= 0

  return (
    <div className="min-h-full bg-btl-bg flex flex-col pt-safe pb-safe overflow-hidden">

      {/* Background orbs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="orb w-80 h-80 -top-24 left-1/2 -translate-x-1/2 animate-orb-drift"
             style={{ background: 'rgba(139,92,246,0.10)' }} />
        <div className="orb w-56 h-56 bottom-0 -right-16 animate-orb-drift-2"
             style={{ background: 'rgba(59,130,246,0.07)' }} />
      </div>

      <div className="relative z-10 flex flex-col flex-1 max-w-lg mx-auto w-full px-4">

        {/* Header */}
        <div className="flex items-center gap-3 pt-6 pb-4">
          <button
            onClick={() => goTo('lobby')}
            className="p-2 rounded-2xl text-btl-muted hover:text-btl-text transition-colors"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)' }}
          >
            ←
          </button>
          <div>
            <h1 className="font-extrabold text-xl text-btl-text">Waiting Room</h1>
            <p className="text-xs text-btl-muted">{selectedTemplate?.name ?? 'Tournament'}</p>
          </div>
        </div>

        {/* Fill progress */}
        <div
          className="p-5 rounded-3xl mb-5 card-shadow"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <div className="flex items-end justify-between mb-3">
            <div>
              <div className="font-extrabold text-3xl text-btl-text">{filled}<span className="text-xl text-btl-muted">/{total}</span></div>
              <div className="text-sm text-btl-muted">players joined</div>
            </div>
            {waitingCountdown > 0 && waitingCountdown < 14 && (
              <div className="text-center">
                <div className="font-extrabold text-4xl" style={{ color: '#8B5CF6', textShadow: '0 0 20px rgba(139,92,246,0.5)' }}>
                  {waitingCountdown}
                </div>
                <div className="text-xs text-btl-muted">starting in</div>
              </div>
            )}
          </div>

          {/* Progress bar */}
          <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.07)' }}>
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${fillPct}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
              className="h-full rounded-full"
              style={{ background: 'linear-gradient(90deg, #8B5CF6, #3B82F6)' }}
            />
          </div>
        </div>

        {/* Player list */}
        <div className="flex-1 overflow-y-auto mb-4">
          <div className="grid grid-cols-2 gap-2">
            <AnimatePresence mode="popLayout">
              {players.map((p, i) => (
                <motion.div
                  key={p.id}
                  initial={{ opacity: 0, scale: 0.8, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 320, damping: 24 }}
                  className="flex items-center gap-2.5 p-3 rounded-2xl"
                  style={{
                    background: p.isHuman ? 'rgba(139,92,246,0.12)' : 'rgba(255,255,255,0.04)',
                    border: p.isHuman ? '1.5px solid rgba(139,92,246,0.3)' : '1px solid rgba(255,255,255,0.07)',
                  }}
                >
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-base flex-shrink-0"
                    style={{ background: 'rgba(255,255,255,0.08)' }}
                  >
                    {p.isHuman ? '😎' : BOT_AVATARS[i % BOT_AVATARS.length]}
                  </div>
                  <div className="min-w-0">
                    <div
                      className="font-semibold text-xs truncate"
                      style={{ color: p.isHuman ? '#A78BFA' : 'rgba(241,241,255,0.85)' }}
                    >
                      {p.name}
                    </div>
                    <div className="text-[10px] text-btl-faint">{p.isHuman ? 'You' : 'AI Bot'}</div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Empty slots */}
            {Array.from({ length: Math.max(0, total - filled) }).map((_, i) => (
              <div
                key={`empty-${i}`}
                className="flex items-center gap-2.5 p-3 rounded-2xl"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.06)' }}
              >
                <div
                  className="w-8 h-8 rounded-full animate-pulse-soft"
                  style={{ background: 'rgba(255,255,255,0.05)' }}
                />
                <div className="text-xs text-btl-faint">Waiting...</div>
              </div>
            ))}
          </div>
        </div>

        {/* Start button */}
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={startGame}
          className="w-full py-4 rounded-3xl font-extrabold text-base text-white mb-4 shimmer-over"
          style={{
            background: readyToGo
              ? 'linear-gradient(135deg, #7C3AED, #8B5CF6)'
              : 'rgba(255,255,255,0.06)',
            boxShadow: readyToGo ? '0 8px 28px rgba(139,92,246,0.45)' : 'none',
            color: readyToGo ? 'white' : 'rgba(241,241,255,0.3)',
            border: readyToGo ? 'none' : '1px solid rgba(255,255,255,0.08)',
          }}
        >
          {readyToGo ? '⚔ Start Battle!' : `Filling lobby... ${filled}/${total}`}
        </motion.button>
      </div>
    </div>
  )
}
