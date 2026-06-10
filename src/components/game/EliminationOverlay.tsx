import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface EliminationOverlayProps {
  eliminatedNames: string[]
  onDismiss: () => void
}

export default function EliminationOverlay({ eliminatedNames, onDismiss }: EliminationOverlayProps) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 3200)
    return () => clearTimeout(t)
  }, [onDismiss])

  return (
    <AnimatePresence>
      <motion.div
        key="elim-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-5"
        style={{ background: 'rgba(6,6,24,0.85)', backdropFilter: 'blur(12px)' }}
        onClick={onDismiss}
      >
        {/* Red radial burst */}
        <motion.div
          initial={{ opacity: 0, scale: 0.3 }}
          animate={{ opacity: [0, 0.15, 0], scale: [0.3, 2.5, 3.2] }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(circle at 50% 40%, #EF4444 0%, transparent 65%)' }}
        />

        {/* Panel */}
        <motion.div
          initial={{ scale: 0.5, y: 50, opacity: 0 }}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          exit={{ scale: 0.85, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 340, damping: 22 }}
          className="relative w-full max-w-xs rounded-3xl p-7 text-center card-shadow"
          style={{
            background: 'linear-gradient(160deg, #2A1232 0%, #0E0E2A 100%)',
            border: '1.5px solid rgba(239,68,68,0.4)',
            boxShadow: '0 0 40px rgba(239,68,68,0.22), 0 20px 48px rgba(0,0,0,0.6)',
          }}
          onClick={e => e.stopPropagation()}
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.1, type: 'spring', stiffness: 400, damping: 16 }}
            className="text-6xl mb-3"
          >
            💀
          </motion.div>

          <div
            className="font-extrabold tracking-wider mb-2"
            style={{ fontSize: '1.8rem', color: '#EF4444', textShadow: '0 0 20px rgba(239,68,68,0.6)' }}
          >
            ELIMINATED
          </div>

          <div className="text-btl-muted text-sm mb-4">
            {eliminatedNames.length === 1
              ? 'A player has been eliminated'
              : `${eliminatedNames.length} players eliminated`}
          </div>

          <div className="space-y-1.5 mb-4">
            {eliminatedNames.slice(0, 4).map(n => (
              <motion.div
                key={n}
                initial={{ x: -20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ delay: 0.2 + eliminatedNames.indexOf(n) * 0.08 }}
                className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm"
                style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#F87171' }}
              >
                <span>💀</span>
                <span className="font-medium">{n}</span>
              </motion.div>
            ))}
          </div>

          <div className="text-[10px] text-btl-faint">tap to continue</div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
