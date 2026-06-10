import { motion } from 'framer-motion'
import type { AppScreen } from '../../types'

interface BottomNavProps {
  active: AppScreen
  onNavigate: (s: AppScreen) => void
}

const TABS: { id: AppScreen; label: string; icon: (active: boolean) => string }[] = [
  { id: 'landing', label: 'Home',   icon: () => '🏠' },
  { id: 'lobby',   label: 'Lobby',  icon: () => '🏆' },
  { id: 'game',    label: 'Battle', icon: () => '⚔️' },
  { id: 'results', label: 'Profile',icon: () => '👤' },
]

export default function BottomNav({ active, onNavigate }: BottomNavProps) {
  return (
    <div
      className="flex items-center justify-around px-2 flex-shrink-0"
      style={{
        background: 'rgba(8,8,20,0.97)',
        borderTop: '1px solid rgba(255,255,255,0.07)',
        paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 8px)',
        paddingTop: '8px',
      }}
    >
      {TABS.map(tab => {
        const isActive = active === tab.id || (tab.id === 'game' && active === 'waiting')
        return (
          <button
            key={tab.id}
            onClick={() => onNavigate(tab.id)}
            className="flex flex-col items-center gap-1 min-w-[60px] py-1 rounded-2xl transition-all"
            style={{ background: isActive ? 'rgba(139,92,246,0.12)' : 'transparent' }}
          >
            <motion.div
              animate={isActive ? { scale: [1, 1.2, 1] } : { scale: 1 }}
              transition={{ duration: 0.3 }}
              className="text-xl leading-none"
            >
              {tab.icon(isActive)}
            </motion.div>
            <span
              className="text-[10px] font-semibold"
              style={{
                color: isActive ? '#8B5CF6' : 'rgba(241,241,255,0.35)',
              }}
            >
              {tab.label}
            </span>
            {isActive && (
              <motion.div
                layoutId="nav-dot"
                className="w-1 h-1 rounded-full"
                style={{ background: '#8B5CF6' }}
              />
            )}
          </button>
        )
      })}
    </div>
  )
}
