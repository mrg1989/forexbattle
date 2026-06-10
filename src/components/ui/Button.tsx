import clsx from 'clsx'
import type { ReactNode, ButtonHTMLAttributes } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'up' | 'down' | 'ghost' | 'danger' | 'gold'
  size?: 'sm' | 'md' | 'lg' | 'xl'
  children: ReactNode
  fullWidth?: boolean
  glow?: boolean
}

const variantClasses = {
  primary: 'bg-battle-blue text-white hover:bg-blue-600 active:bg-blue-700',
  up:      'bg-battle-up text-battle-bg font-bold hover:bg-emerald-400 active:bg-emerald-600 glow-up',
  down:    'bg-battle-down text-white font-bold hover:bg-rose-500 active:bg-rose-600 glow-down',
  gold:    'bg-battle-gold text-battle-bg font-bold hover:bg-yellow-400 active:bg-yellow-500 glow-gold',
  ghost:   'bg-battle-card border border-battle-border text-battle-muted hover:text-battle-text hover:border-battle-faint',
  danger:  'bg-battle-down/20 border border-battle-down/40 text-battle-down hover:bg-battle-down/30',
}

const sizeClasses = {
  sm:  'px-3 py-1.5 text-sm rounded-lg',
  md:  'px-4 py-2.5 text-sm rounded-xl',
  lg:  'px-6 py-3.5 text-base rounded-xl',
  xl:  'px-8 py-4 text-lg rounded-2xl',
}

export default function Button({
  variant = 'primary',
  size = 'md',
  children,
  fullWidth,
  glow,
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={clsx(
        'font-semibold transition-all duration-150 no-select',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        'focus:outline-none focus:ring-2 focus:ring-battle-gold/40',
        variantClasses[variant],
        sizeClasses[size],
        fullWidth && 'w-full',
        glow && variant === 'gold' && 'glow-gold',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
