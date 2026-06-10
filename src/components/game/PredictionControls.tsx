import { motion } from 'framer-motion'
import type { PredictionChoice, RiskLevel } from '../../types'
import { RISK_CONFIG, streakMultiplier } from '../../types'

interface PredictionControlsProps {
  pair: string
  phase: 'watching' | 'predicting' | 'resolving'
  myPrediction: PredictionChoice | null
  myRiskLevel: RiskLevel
  predictionPrice: number | null
  phaseTimer: number
  myStreak: number
  onPredict: (dir: PredictionChoice) => void
  onRiskChange: (r: RiskLevel) => void
}

const RISK_LABELS: Record<RiskLevel, { icon: string; label: string; color: string; bg: string; border: string }> = {
  safe:       { icon: '🛡️', label: 'SAFE',       color: '#22C55E', bg: 'rgba(34,197,94,0.1)',   border: 'rgba(34,197,94,0.3)' },
  balanced:   { icon: '⚖️', label: 'BALANCED',   color: '#3B82F6', bg: 'rgba(59,130,246,0.1)',  border: 'rgba(59,130,246,0.3)' },
  aggressive: { icon: '🚀', label: 'AGGRESSIVE', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.35)' },
}

export default function PredictionControls({
  pair, phase, myPrediction, myRiskLevel, predictionPrice, phaseTimer, myStreak,
  onPredict, onRiskChange,
}: PredictionControlsProps) {

  const rc   = RISK_CONFIG[myRiskLevel]
  const mult = streakMultiplier(myStreak)
  const win  = Math.round(rc.betAmount * rc.winMultiplier * mult)
  const lose = Math.round(rc.betAmount * rc.lossMultiplier)

  /* ── WATCHING ─────────────────────────────────────────────────────────── */
  if (phase === 'watching') {
    return (
      <div className="flex items-center justify-between px-6 py-3">
        <div>
          <div className="text-sm font-semibold text-btl-muted">Watching the market</div>
          <div className="text-xs text-btl-faint mt-0.5">Predict phase starts in <span className="text-btl-text font-bold">{phaseTimer}s</span></div>
        </div>
        <div className="flex gap-2 opacity-40 pointer-events-none select-none">
          <div className="px-8 py-3 rounded-xl font-black text-base text-btl-up border border-btl-up/30">▲ UP</div>
          <div className="px-8 py-3 rounded-xl font-black text-base text-btl-down border border-btl-down/30">▼ DOWN</div>
        </div>
      </div>
    )
  }

  /* ── RESOLVING ────────────────────────────────────────────────────────── */
  if (phase === 'resolving') {
    return (
      <div className="flex items-center justify-between px-6 py-3">
        <div>
          <div className="text-sm font-semibold text-btl-muted">Resolving…</div>
          {myPrediction ? (
            <div className="text-xs mt-0.5">
              Your call: <span className="font-bold" style={{ color: myPrediction === 'up' ? '#22C55E' : '#EF4444' }}>
                {myPrediction === 'up' ? '▲ UP' : '▼ DOWN'}
              </span>
              {predictionPrice && (
                <span className="text-btl-faint ml-2">@ {predictionPrice.toFixed(5)}</span>
              )}
            </div>
          ) : (
            <div className="text-xs text-btl-faint mt-0.5">You skipped this round</div>
          )}
        </div>
        <div className="flex items-center gap-2 opacity-60">
          <div className="w-2 h-2 rounded-full bg-btl-purple animate-pulse" />
          <span className="text-sm text-btl-muted font-medium">Result in {phaseTimer}s</span>
        </div>
      </div>
    )
  }

  /* ── PREDICTING ───────────────────────────────────────────────────────── */
  return (
    <div className="flex items-center gap-4 px-5 py-3">

      {/* Risk selector */}
      <div className="flex-shrink-0">
        <div className="text-[10px] font-bold uppercase tracking-widest text-btl-muted mb-1.5">Risk</div>
        <div className="flex gap-1.5">
          {(Object.entries(RISK_LABELS) as [RiskLevel, typeof RISK_LABELS[RiskLevel]][]).map(([key, cfg]) => (
            <motion.button
              key={key}
              onClick={() => onRiskChange(key)}
              whileTap={{ scale: 0.95 }}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all"
              style={{
                background:   myRiskLevel === key ? cfg.bg   : 'rgba(255,255,255,0.04)',
                border:       `1px solid ${myRiskLevel === key ? cfg.border : 'rgba(255,255,255,0.08)'}`,
                color:        myRiskLevel === key ? cfg.color : 'rgba(241,241,255,0.4)',
                boxShadow:    myRiskLevel === key ? `0 0 10px ${cfg.bg}` : 'none',
              }}
            >
              <span>{cfg.icon}</span>
              <span>{cfg.label}</span>
            </motion.button>
          ))}
        </div>
      </div>

      {/* Win/loss indicator */}
      <div className="flex-shrink-0 flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg"
           style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="text-[10px] text-btl-muted font-semibold uppercase tracking-wide">Payout</div>
        <div className="text-xs font-bold" style={{ color: '#22C55E' }}>+{win} pts</div>
        <div className="text-xs font-bold" style={{ color: '#EF4444' }}>−{lose} pts</div>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Prompt */}
      <div className="flex-shrink-0 hidden lg:block">
        <div className="text-xs font-medium text-btl-muted text-center">Will <span className="text-btl-text font-bold">{pair}</span> go</div>
        <div className="text-[10px] text-btl-faint text-center mt-0.5">in this round?</div>
      </div>

      {/* UP / DOWN buttons */}
      <div className="flex gap-3 flex-shrink-0">
        <motion.button
          onClick={() => onPredict('up')}
          whileTap={{ scale: 0.94 }}
          className="flex items-center gap-2 px-7 py-3 rounded-xl font-black text-base transition-all"
          style={{
            background: 'rgba(34,197,94,0.12)',
            border: '1.5px solid rgba(34,197,94,0.4)',
            color: '#22C55E',
            boxShadow: '0 0 20px rgba(34,197,94,0.15)',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10 3L18 13H2L10 3Z" />
            <path d="M10 8L16 16H4L10 8Z" opacity="0.5" />
          </svg>
          UP
        </motion.button>

        <motion.button
          onClick={() => onPredict('down')}
          whileTap={{ scale: 0.94 }}
          className="flex items-center gap-2 px-7 py-3 rounded-xl font-black text-base transition-all"
          style={{
            background: 'rgba(239,68,68,0.12)',
            border: '1.5px solid rgba(239,68,68,0.4)',
            color: '#EF4444',
            boxShadow: '0 0 20px rgba(239,68,68,0.15)',
          }}
        >
          DOWN
          <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10 17L2 7H18L10 17Z" />
            <path d="M10 12L4 4H16L10 12Z" opacity="0.5" />
          </svg>
        </motion.button>
      </div>

      {myStreak >= 2 && (
        <div className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg"
             style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)' }}>
          <span className="streak-fire text-sm">🔥</span>
          <span className="text-xs font-bold" style={{ color: '#F59E0B' }}>×{mult.toFixed(1)}</span>
        </div>
      )}
    </div>
  )
}
