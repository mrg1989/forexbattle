/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        btl: {
          bg:          '#060618',
          surface:     '#0C0C26',
          card:        '#131332',
          'card-2':    '#1A1A40',
          border:      'rgba(255,255,255,0.06)',
          'border-hi': 'rgba(255,255,255,0.14)',
          up:          '#22C55E',
          'up-2':      '#4ADE80',
          'up-muted':  'rgba(34,197,94,0.18)',
          down:        '#EF4444',
          'down-2':    '#F87171',
          'down-muted':'rgba(239,68,68,0.18)',
          purple:      '#8B5CF6',
          'purple-2':  '#A78BFA',
          'purple-m':  'rgba(139,92,246,0.18)',
          blue:        '#3B82F6',
          teal:        '#06B6D4',
          gold:        '#F59E0B',
          'gold-2':    '#FCD34D',
          orange:      '#F97316',
          pink:        '#EC4899',
          text:        '#F1F1FF',
          muted:       'rgba(241,241,255,0.5)',
          faint:       'rgba(241,241,255,0.12)',
          'faint-2':   'rgba(241,241,255,0.05)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        '4xl': '2rem',
        '5xl': '2.5rem',
      },
      animation: {
        'float':          'float 3s ease-in-out infinite',
        'float-slow':     'float 5.5s ease-in-out infinite',
        'pulse-soft':     'pulseSoft 2.5s ease-in-out infinite',
        'pulse-gold':     'pulseGold 1.8s ease-in-out infinite',
        'glow-up':        'glowUp 2s ease-in-out infinite',
        'glow-down':      'glowDown 2s ease-in-out infinite',
        'glow-purple':    'glowPurple 2.5s ease-in-out infinite',
        'glow-gold':      'glowGold 2.5s ease-in-out infinite',
        'shimmer':        'shimmer 2.2s linear infinite',
        'slide-up':       'slideUp 0.35s cubic-bezier(0.34,1.56,0.64,1)',
        'pop-in':         'popIn 0.35s cubic-bezier(0.34,1.56,0.64,1)',
        'bounce-in':      'bounceIn 0.55s cubic-bezier(0.34,1.56,0.64,1)',
        'fade-in':        'fadeIn 0.25s ease-out',
        'number-pop':     'numberPop 0.45s cubic-bezier(0.34,1.56,0.64,1)',
        'streak-ring':    'streakRing 3s linear infinite',
        'orb-drift':      'orbDrift 9s ease-in-out infinite alternate',
        'orb-drift-2':    'orbDrift2 11s ease-in-out infinite alternate',
        'ticker':         'ticker 24s linear infinite',
        'confetti-fall':  'confettiFall 2s ease-in forwards',
        'scale-out':      'scaleOut 0.3s ease-in forwards',
        'toast-in':       'toastIn 0.4s cubic-bezier(0.34,1.56,0.64,1)',
        'toast-out':      'toastOut 0.3s ease-in forwards',
      },
      keyframes: {
        float: {
          '0%,100%': { transform: 'translateY(0px)' },
          '50%':     { transform: 'translateY(-10px)' },
        },
        pulseSoft: {
          '0%,100%': { opacity: '0.65' },
          '50%':     { opacity: '1' },
        },
        pulseGold: {
          '0%,100%': { opacity: '0.8', filter: 'brightness(1)' },
          '50%':     { opacity: '1',   filter: 'brightness(1.2)' },
        },
        glowUp: {
          '0%,100%': { boxShadow: '0 0 14px rgba(34,197,94,0.25), 0 0 32px rgba(34,197,94,0.1)' },
          '50%':     { boxShadow: '0 0 22px rgba(34,197,94,0.5), 0 0 60px rgba(34,197,94,0.22)' },
        },
        glowDown: {
          '0%,100%': { boxShadow: '0 0 14px rgba(239,68,68,0.25), 0 0 32px rgba(239,68,68,0.1)' },
          '50%':     { boxShadow: '0 0 22px rgba(239,68,68,0.5), 0 0 60px rgba(239,68,68,0.22)' },
        },
        glowPurple: {
          '0%,100%': { boxShadow: '0 0 14px rgba(139,92,246,0.3), 0 0 32px rgba(139,92,246,0.12)' },
          '50%':     { boxShadow: '0 0 22px rgba(139,92,246,0.55), 0 0 60px rgba(139,92,246,0.25)' },
        },
        glowGold: {
          '0%,100%': { boxShadow: '0 0 14px rgba(245,158,11,0.3), 0 0 32px rgba(245,158,11,0.12)' },
          '50%':     { boxShadow: '0 0 22px rgba(245,158,11,0.6), 0 0 60px rgba(245,158,11,0.25)' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        slideUp: {
          from: { transform: 'translateY(20px)', opacity: '0' },
          to:   { transform: 'translateY(0)',    opacity: '1' },
        },
        popIn: {
          from: { transform: 'scale(0.75)', opacity: '0' },
          to:   { transform: 'scale(1)',    opacity: '1' },
        },
        bounceIn: {
          '0%':   { transform: 'scale(0.3)',    opacity: '0' },
          '60%':  { transform: 'scale(1.08)' },
          '80%':  { transform: 'scale(0.97)' },
          '100%': { transform: 'scale(1)',      opacity: '1' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        numberPop: {
          '0%':  { transform: 'scale(0.5) translateY(12px)', opacity: '0' },
          '70%': { transform: 'scale(1.12) translateY(-3px)' },
          '100%':{ transform: 'scale(1) translateY(0)',       opacity: '1' },
        },
        streakRing: {
          from: { backgroundPosition: '0% 50%' },
          to:   { backgroundPosition: '300% 50%' },
        },
        orbDrift: {
          from: { transform: 'translate(0,0) scale(1)' },
          to:   { transform: 'translate(40px,-30px) scale(1.15)' },
        },
        orbDrift2: {
          from: { transform: 'translate(0,0) scale(1)' },
          to:   { transform: 'translate(-30px,20px) scale(0.9)' },
        },
        ticker: {
          from: { transform: 'translateX(100%)' },
          to:   { transform: 'translateX(-100%)' },
        },
        confettiFall: {
          '0%':   { transform: 'translateY(-20px) rotate(0deg)', opacity: '1' },
          '100%': { transform: 'translateY(110vh) rotate(720deg)', opacity: '0' },
        },
        scaleOut: {
          from: { transform: 'scale(1)',   opacity: '1' },
          to:   { transform: 'scale(0.9)', opacity: '0' },
        },
        toastIn: {
          from: { transform: 'translateY(-100%) scale(0.9)', opacity: '0' },
          to:   { transform: 'translateY(0) scale(1)',        opacity: '1' },
        },
        toastOut: {
          from: { transform: 'translateY(0) scale(1)',        opacity: '1' },
          to:   { transform: 'translateY(-100%) scale(0.9)', opacity: '0' },
        },
      },
    },
  },
  plugins: [],
}
