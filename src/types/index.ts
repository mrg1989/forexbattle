// ─── Core Data Types ──────────────────────────────────────────────────────────

export type RiskLevel = 'safe' | 'balanced' | 'aggressive'
export type PredictionChoice = 'up' | 'down' | 'skip'
export type RoundPhase = 'watching' | 'predicting' | 'resolving'
export type AppScreen = 'landing' | 'lobby' | 'waiting' | 'game' | 'results'

export interface Candle {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

// ─── Player ───────────────────────────────────────────────────────────────────

export interface Player {
  id: string
  name: string
  avatar: string   // emoji
  points: number
  streak: number
  bestStreak: number
  eliminated: boolean
  isHuman: boolean   // the local player
  prediction?: PredictionChoice
  lastResult?: 'win' | 'loss' | 'skip' | null
  rankChange?: number  // +1 moved up, -1 moved down, 0 same
}

// ─── Tournament ───────────────────────────────────────────────────────────────

export type TournamentTier = 'quick' | 'standard' | 'championship'

export interface TournamentTemplate {
  id: string
  tier: TournamentTier
  name: string
  pair: string             // e.g. "EUR/USD"
  entryFee: number         // points
  maxPlayers: number
  totalRounds: number
  eliminationEvery: number // eliminate every N rounds
  eliminatePercent: number // % of remaining players eliminated
  // Prize split for top 3 (percent)
  prizes: [number, number, number]
  description: string
  color: string            // CSS color for tier badge
}

export interface Tournament extends TournamentTemplate {
  currentPlayers: number
  prizePool: number
  startingIn: number       // seconds until start (in waiting room)
}

// ─── Round ────────────────────────────────────────────────────────────────────

export interface RoundResult {
  round: number
  prediction: PredictionChoice
  marketResult: 'up' | 'down'
  won: boolean
  pointsBefore: number
  pointsChange: number
  streakBefore: number
  streakAfter: number
  multiplier: number
  riskLevel: RiskLevel
}

// ─── Risk Level Config ────────────────────────────────────────────────────────

export interface RiskConfig {
  label: string
  betAmount: number      // points wagered
  winMultiplier: number  // net win = betAmount * winMultiplier
  lossMultiplier: number // net loss = betAmount * lossMultiplier
  description: string
}

export const RISK_CONFIG: Record<RiskLevel, RiskConfig> = {
  safe:       { label: 'Safe',       betAmount: 50,  winMultiplier: 0.8,  lossMultiplier: 0.4,  description: '+40 / -20 pts' },
  balanced:   { label: 'Balanced',   betAmount: 100, winMultiplier: 1.5,  lossMultiplier: 1.0,  description: '+150 / -100 pts' },
  aggressive: { label: 'Aggressive', betAmount: 200, winMultiplier: 2.0,  lossMultiplier: 1.0,  description: '+400 / -200 pts' },
}

// ─── Streak Multiplier ────────────────────────────────────────────────────────

export function streakMultiplier(streak: number): number {
  if (streak >= 5) return 2.0
  if (streak >= 3) return 1.5
  if (streak >= 2) return 1.25
  return 1.0
}

// ─── Phase durations (seconds) ────────────────────────────────────────────────
export const PHASE_DURATIONS: Record<RoundPhase, number> = {
  watching:   18,
  predicting: 15,
  resolving:  22,
}

// ─── Tournament templates ─────────────────────────────────────────────────────
export const TOURNAMENT_TEMPLATES: TournamentTemplate[] = [
  {
    id: 'quick',
    tier: 'quick',
    name: 'Quick Battle',
    pair: 'EUR/USD',
    entryFee: 100,
    maxPlayers: 10,
    totalRounds: 10,
    eliminationEvery: 4,
    eliminatePercent: 25,
    prizes: [60, 30, 10],
    description: '~10 min · 10 players',
    color: '#4d6bff',
  },
  {
    id: 'standard',
    tier: 'standard',
    name: 'Standard Arena',
    pair: 'GBP/USD',
    entryFee: 500,
    maxPlayers: 20,
    totalRounds: 16,
    eliminationEvery: 4,
    eliminatePercent: 25,
    prizes: [60, 30, 10],
    description: '~20 min · 20 players',
    color: '#f5c542',
  },
  {
    id: 'championship',
    tier: 'championship',
    name: 'Championship',
    pair: 'USD/JPY',
    entryFee: 2000,
    maxPlayers: 40,
    totalRounds: 20,
    eliminationEvery: 4,
    eliminatePercent: 20,
    prizes: [55, 30, 15],
    description: '~30 min · 40 players',
    color: '#ff4d6a',
  },
]
