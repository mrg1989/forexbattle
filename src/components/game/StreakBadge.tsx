import { motion } from 'framer-motion'

interface StreakBadgeProps {
  streak: number
  size?: 'sm' | 'md' | 'lg'
}

function getConfig(streak: number) {
  if (streak >= 10) return {
    emoji: '⚡', label: `${streak}× UNSTOPPABLE`,
    color: '#A78BFA', bg: 'rgba(139,92,246,0.18)',
    border: 'rgba(167,139,250,0.5)',
    glow: '0 0 22px rgba(139,92,246,0.5), 0 0 44px rgba(139,92,246,0.25)',
    extra: 'streak-5-border',
  }
  if (streak >= 7) return {
    emoji: '🔥', label: `${streak}× ON FIRE`,
    color: '#F97316', bg: 'rgba(249,115,22,0.16)',
    border: 'rgba(249,115,22,0.5)',
    glow: '0 0 18px rgba(249,115,22,0.5), 0 0 36px rgba(249,115,22,0.2)',
    extra: 'streak-5-border',
  }
  if (streak >= 5) return {
    emoji: '🔥', label: `HOT! ${streak}×`,
    color: '#F59E0B', bg: 'rgba(245,158,11,0.16)',
    border: 'rgba(245,158,11,0.45)',
    glow: '0 0 16px rgba(245,158,11,0.45), 0 0 32px rgba(245,158,11,0.18)',
    extra: '',
  }
  if (streak >= 3) return {
    emoji: '🔥', label: `${streak}×`,
    color: '#F97316', bg: 'rgba(249,115,22,0.12)',
    border: 'rgba(249,115,22,0.38)',
    glow: '0 0 12px rgba(249,115,22,0.35)',
    extra: '',
  }
  if (streak >= 2) return {
    emoji: '✨', label: `${streak}×`,
    color: '#F59E0B', bg: 'rgba(245,158,11,0.1)',
    border: 'rgba(245,158,11,0.3)',
    glow: '0 0 10px rgba(245,158,11,0.25)',
    extra: '',
  }
  return null
}

export default function StreakBadge({ streak, size = 'md' }: StreakBadgeProps) {
  const cfg = getConfig(streak)
  if (!cfg) return null

  const px = size === 'sm' ? 'px-2 py-0.5' : size === 'lg' ? 'px-4 py-2' : 'px-3 py-1'
  const textSz = size === 'sm' ? 'text-[10px]' : size === 'lg' ? 'text-sm' : 'text-xs'
  const emojiSz = size === 'sm' ? 'text-sm' : size === 'lg' ? 'text-xl' : 'text-base'

  return (
    <motion.div
      key={streak}
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 450, damping: 18 }}
      className={`inline-flex items-center gap-1 rounded-full ${px} ${cfg.extra}`}
      style={{
        background: cfg.bg,
        border: `1.5px solid ${cfg.border}`,
        boxShadow: cfg.glow,
      }}
    >
      <span className={`${emojiSz} ${streak >= 3 ? 'streak-fire' : ''}`}>{cfg.emoji}</span>
      <span className={`font-bold tabular ${textSz}`} style={{ color: cfg.color }}>
        {cfg.label}
      </span>
    </motion.div>
  )
}

/* Milestone toast — shown briefly when streak milestone is hit */
interface StreakToastProps {
  streak: number
  onDone: () => void
}

const MILESTONES: Record<number, { text: string; sub: string; color: string }> = {
  2:  { text: '✨ 2 in a row!',       sub: 'Keep it up',                  color: '#F59E0B' },
  3:  { text: '🔥 3 STREAK!',         sub: '×1.25 bonus on wins',         color: '#F97316' },
  5:  { text: '🔥 HOT STREAK! ×5',    sub: '×1.5 multiplier active',      color: '#EF4444' },
  7:  { text: '🔥 ON FIRE! ×7',       sub: '×1.75 — unbelievable!',       color: '#F97316' },
  10: { text: '⚡ UNSTOPPABLE! ×10',  sub: '×2.0 — maximum multiplier!',  color: '#A78BFA' },
}

export function StreakMilestoneToast({ streak, onDone }: StreakToastProps) {
  const milestone = [10, 7, 5, 3, 2].find(m => streak === m)
  if (!milestone) return null
  const cfg = MILESTONES[milestone]

  return (
    <motion.div
      initial={{ y: -80, opacity: 0, scale: 0.9 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      exit={{ y: -80, opacity: 0, scale: 0.9 }}
      transition={{ type: 'spring', damping: 22, stiffness: 350 }}
      onAnimationComplete={() => setTimeout(onDone, 1800)}
      className="absolute top-16 left-1/2 z-50 rounded-2xl px-5 py-3 text-center"
      style={{
        transform: 'translateX(-50%)',
        background: 'rgba(6,6,24,0.92)',
        border: `1.5px solid ${cfg.color}50`,
        boxShadow: `0 0 24px ${cfg.color}35, 0 8px 32px rgba(0,0,0,0.5)`,
        backdropFilter: 'blur(16px)',
        minWidth: '200px',
      }}
    >
      <div className="font-extrabold text-base" style={{ color: cfg.color }}>{cfg.text}</div>
      <div className="text-xs text-btl-muted mt-0.5">{cfg.sub}</div>
    </motion.div>
  )
}
