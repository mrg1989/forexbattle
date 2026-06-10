interface TimerProps {
  total: number
  current: number
  phase: 'watching' | 'predicting' | 'resolving'
  size?: number
  showLabel?: boolean
}

export default function Timer({ total, current, phase, size = 100, showLabel = true }: TimerProps) {
  const r      = (size - 10) / 2
  const circ   = 2 * Math.PI * r
  const pct    = Math.max(0, current / total)
  const offset = circ * (1 - pct)
  const urgent = phase === 'predicting' && current <= 5
  const color  = urgent ? '#EF4444' : phase === 'watching' ? '#3B82F6' : phase === 'predicting' ? '#8B5CF6' : '#22C55E'
  const dim    = urgent ? 'rgba(239,68,68,0.12)' : phase === 'watching' ? 'rgba(59,130,246,0.12)' : phase === 'predicting' ? 'rgba(139,92,246,0.12)' : 'rgba(34,197,94,0.12)'

  const mm = String(Math.floor(current / 60)).padStart(2, '0')
  const ss = String(current % 60).padStart(2, '0')

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative inline-flex items-center justify-center flex-shrink-0"
           style={{ width: size, height: size }}>
        {/* Background circle */}
        <div className="absolute inset-0 rounded-full" style={{ background: dim }} />
        <svg width={size} height={size} className="-rotate-90" style={{ position: 'absolute' }}>
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={dim} strokeWidth={8} />
          <circle
            cx={size/2} cy={size/2} r={r} fill="none"
            stroke={color} strokeWidth={urgent ? 9 : 8}
            strokeLinecap="round"
            strokeDasharray={circ} strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 0.9s linear, stroke 0.3s', filter: `drop-shadow(0 0 ${urgent ? 8 : 5}px ${color})` }}
          />
        </svg>
        <div className="relative z-10 text-center">
          <div className="font-black tabular leading-none" style={{ fontSize: size * 0.28, color, textShadow: urgent ? `0 0 16px ${color}` : 'none' }}>
            {total > 60 ? `${mm}:${ss}` : ss}
          </div>
        </div>
      </div>
      {showLabel && (
        <div className="text-[10px] font-bold tracking-widest uppercase" style={{ color }}>
          {phase === 'watching' ? 'WATCH' : phase === 'predicting' ? 'TIME TO DECIDE' : 'RESULT IN'}
        </div>
      )}
    </div>
  )
}
