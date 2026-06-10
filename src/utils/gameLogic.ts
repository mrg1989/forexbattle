import type { Player, RiskLevel, RoundResult } from '../types'
import { RISK_CONFIG, streakMultiplier } from '../types'

// ─── Point calculation ────────────────────────────────────────────────────────

export function calculatePointsChange(
  prediction: 'up' | 'down' | 'skip',
  marketResult: 'up' | 'down',
  riskLevel: RiskLevel,
  streak: number,
): { change: number; won: boolean; multiplier: number } {
  if (prediction === 'skip') return { change: 0, won: false, multiplier: 1 }

  const config = RISK_CONFIG[riskLevel]
  const won = prediction === marketResult
  const streakMult = won ? streakMultiplier(streak) : 1

  const change = won
    ? Math.round(config.betAmount * config.winMultiplier * streakMult)
    : -Math.round(config.betAmount * config.lossMultiplier)

  return { change, won, multiplier: streakMult }
}

export function applyRoundResult(
  player: Player,
  prediction: 'up' | 'down' | 'skip',
  marketResult: 'up' | 'down',
  riskLevel: RiskLevel,
): { updatedPlayer: Player; result: RoundResult } {
  const { change, won } = calculatePointsChange(prediction, marketResult, riskLevel, player.streak)

  const streakBefore = player.streak
  let streakAfter = streakBefore

  if (prediction === 'skip') {
    streakAfter = streakBefore // preserved
  } else if (won) {
    streakAfter = streakBefore + 1
  } else {
    streakAfter = 0
  }

  const pointsAfter = Math.max(0, player.points + change)

  const updatedPlayer: Player = {
    ...player,
    points: pointsAfter,
    streak: streakAfter,
    bestStreak: Math.max(player.bestStreak, streakAfter),
    lastResult: prediction === 'skip' ? 'skip' : won ? 'win' : 'loss',
  }

  const result: RoundResult = {
    round: 0, // set by caller
    prediction,
    marketResult,
    won,
    pointsBefore: player.points,
    pointsChange: change,
    streakBefore,
    streakAfter,
    multiplier: streakMultiplier(streakBefore),
    riskLevel,
  }

  return { updatedPlayer, result }
}

// ─── AI player simulation ─────────────────────────────────────────────────────

/**
 * Simulate an AI player's prediction. AI is correct ~55% of the time.
 */
export function aiPredict(): 'up' | 'down' | 'skip' {
  const r = Math.random()
  if (r < 0.08) return 'skip'
  return r < 0.54 ? 'up' : 'down'
}

export function aiRiskLevel(): RiskLevel {
  const r = Math.random()
  if (r < 0.4) return 'safe'
  if (r < 0.75) return 'balanced'
  return 'aggressive'
}

// ─── Elimination ──────────────────────────────────────────────────────────────

/**
 * Eliminate the bottom `percent`% of active players by points.
 * Returns updated player array (eliminated players marked).
 */
export function eliminatePlayers(players: Player[], percent: number): Player[] {
  const active = players.filter(p => !p.eliminated)
  if (active.length <= 2) return players // never eliminate below 2

  const countToEliminate = Math.max(1, Math.floor(active.length * (percent / 100)))
  const sorted = [...active].sort((a, b) => a.points - b.points)
  const elimIds = new Set(sorted.slice(0, countToEliminate).map(p => p.id))

  return players.map(p => elimIds.has(p.id) ? { ...p, eliminated: true } : p)
}

// ─── Leaderboard ─────────────────────────────────────────────────────────────

export function rankPlayers(players: Player[]): Player[] {
  const active   = players.filter(p => !p.eliminated).sort((a, b) => b.points - a.points)
  const inactive = players.filter(p => p.eliminated)
  return [...active, ...inactive]
}

// ─── Prize pool ───────────────────────────────────────────────────────────────

export function calculatePrizePool(entryFee: number, playerCount: number): number {
  return Math.floor(entryFee * playerCount * 0.9)
}

// ─── Bot names / avatars ─────────────────────────────────────────────────────

const BOT_NAMES = [
  'TradeKing', 'PipHunter', 'BullRush', 'BearTrap', 'Scalper99',
  'ForexWolf', 'GoldFinger', 'MarketMaker', 'PipMaster', 'TrendRider',
  'SwingKing', 'DayTrader', 'FxSniper', 'CandleStick', 'AlphaPip',
  'HedgeHog', 'FxNinja', 'PipCrusher', 'TrendSetter', 'FxShark',
  'PipBoss', 'ForexLion', 'BullFlag', 'BearBait', 'MoonShot',
  'VixMaster', 'FxFury', 'PipWarrior', 'TrendKiller', 'FxChampion',
  'BigMover', 'SmartMoney', 'CandleKing', 'PipSlinger', 'ForexEagle',
  'DeltaHedge', 'FxGhost', 'PipRocket', 'TrendMaster', 'FxLegend',
]
const BOT_AVATARS = ['🐺','🦊','🐯','🦁','🐻','🦅','🦈','🐉','🎯','⚡','🔥','💎','🏆','🎲','🃏','🎮']

export function createBots(count: number, startingPoints: number): Player[] {
  const shuffled = [...BOT_NAMES].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, count).map((name, i) => ({
    id: `bot_${i}`,
    name,
    avatar: BOT_AVATARS[i % BOT_AVATARS.length],
    points: startingPoints,
    streak: 0,
    bestStreak: 0,
    eliminated: false,
    isHuman: false,
  }))
}

export const HUMAN_PLAYER: Player = {
  id: 'player_human',
  name: 'You',
  avatar: '👤',
  points: 1000,
  streak: 0,
  bestStreak: 0,
  eliminated: false,
  isHuman: true,
}
