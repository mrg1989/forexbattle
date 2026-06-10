import { create } from 'zustand'
import type { Candle, Player, RiskLevel, PredictionChoice, RoundResult, TournamentTemplate } from '../types'
import { PHASE_DURATIONS, RISK_CONFIG, TOURNAMENT_TEMPLATES, streakMultiplier } from '../types'
import {
  generateCandles, tickCandle, newCandle, getMarketResult, formatPrice,
} from '../utils/forex'
import {
  applyRoundResult, aiPredict, aiRiskLevel, eliminatePlayers, rankPlayers,
  calculatePrizePool, createBots, HUMAN_PLAYER,
} from '../utils/gameLogic'

// ─── State shape ──────────────────────────────────────────────────────────────

export type AppScreen = 'landing' | 'lobby' | 'waiting' | 'game' | 'results' | 'chart'

interface GameStore {
  // Navigation
  screen: AppScreen

  // Selected tournament config
  selectedTemplate: TournamentTemplate | null

  // Waiting room
  waitingPlayers: string[]  // names of players who "joined"
  waitingCountdown: number  // seconds until game starts

  // Game state
  players: Player[]
  candles: Candle[]
  liveCandle: Candle | null
  currentRound: number
  totalRounds: number
  roundPhase: 'watching' | 'predicting' | 'resolving' | 'between'
  phaseTimer: number        // seconds left in this phase
  eliminationRound: boolean // true = elimination happening after resolving
  pair: string

  // Human player state
  myPoints: number
  myStreak: number
  myBestStreak: number
  myPrediction: PredictionChoice | null
  myRiskLevel: RiskLevel
  predictionPrice: number | null   // price when prediction was locked
  finalPrice: number | null        // price at end of resolution
  lastRoundResult: RoundResult | null
  eliminated: boolean
  showResultOverlay: boolean
  showEliminationOverlay: boolean
  eliminatedNames: string[]        // names eliminated this round

  // Results
  finalRank: number
  prizeWon: number
  roundHistory: RoundResult[]

  // Intervals (kept for cleanup)
  _gameTickInterval: ReturnType<typeof setInterval> | null
  _priceTickInterval: ReturnType<typeof setInterval> | null

  // ── Actions ──────────────────────────────────────────────────────────────
  goTo: (screen: AppScreen) => void
  selectTournament: (t: TournamentTemplate) => void
  startWaiting: () => void
  startGame: () => void
  makePrediction: (p: PredictionChoice) => void
  setRiskLevel: (r: RiskLevel) => void
  dismissResultOverlay: () => void
  dismissEliminationOverlay: () => void
  resetGame: () => void
  liveBasePrice: number | null
  setLiveBasePrice: (price: number) => void
  // Called by useOandaStream when a real tick arrives
  pushLiveTick: (price: number) => void
  // internal
  _gameTick: () => void
  _priceTick: () => void
}

// ─── Initial values ───────────────────────────────────────────────────────────

const STARTING_POINTS = 1000

const defaultState = {
  screen: 'landing' as AppScreen,
  selectedTemplate: null,
  waitingPlayers: [],
  waitingCountdown: 15,
  players: [],
  candles: [],
  liveCandle: null,
  currentRound: 1,
  totalRounds: 10,
  roundPhase: 'watching' as const,
  phaseTimer: PHASE_DURATIONS.watching,
  eliminationRound: false,
  pair: 'EUR/USD',
  myPoints: STARTING_POINTS,
  myStreak: 0,
  myBestStreak: 0,
  myPrediction: null,
  myRiskLevel: 'balanced' as RiskLevel,
  predictionPrice: null,
  finalPrice: null,
  lastRoundResult: null,
  eliminated: false,
  showResultOverlay: false,
  showEliminationOverlay: false,
  eliminatedNames: [],
  finalRank: 0,
  prizeWon: 0,
  roundHistory: [],
  liveBasePrice: null,
  _gameTickInterval: null,
  _priceTickInterval: null,
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useGameStore = create<GameStore>((set, get) => ({
  ...defaultState,

  // ── Navigation ──────────────────────────────────────────────────────────

  goTo: (screen) => set({ screen }),

  selectTournament: (t) => set({ selectedTemplate: t }),

  // ── Waiting room ────────────────────────────────────────────────────────

  startWaiting: () => {
    const { selectedTemplate } = get()
    if (!selectedTemplate) return

    const bots = createBots(selectedTemplate.maxPlayers - 1, STARTING_POINTS)
    const humanPlayer = { ...HUMAN_PLAYER, points: STARTING_POINTS }

    // Simulate players "joining" one by one during countdown
    const names = bots.map(b => b.name)
    const joinInterval = setInterval(() => {
      const { waitingPlayers } = get()
      if (waitingPlayers.length < names.length) {
        set({ waitingPlayers: [...get().waitingPlayers, names[get().waitingPlayers.length]] })
      } else {
        clearInterval(joinInterval)
      }
    }, 800)

    const countdownInterval = setInterval(() => {
      const { waitingCountdown } = get()
      if (waitingCountdown <= 1) {
        clearInterval(countdownInterval)
        clearInterval(joinInterval)
        get().startGame()
        return
      }
      set({ waitingCountdown: waitingCountdown - 1 })
    }, 1000)

    set({
      screen: 'waiting',
      waitingPlayers: [],
      waitingCountdown: 15,
      players: [humanPlayer, ...bots],
    })
  },

  // ── Game start ───────────────────────────────────────────────────────────

  startGame: () => {
    const { selectedTemplate, players } = get()
    if (!selectedTemplate) return

    const pair = selectedTemplate.pair
    const candles = generateCandles(pair, 50, 10_000, get().liveBasePrice ?? undefined)
    const lastClose = candles[candles.length - 1].close
    const live = newCandle(lastClose, 10_000)

    // Kill any existing intervals
    const existing = get()._gameTickInterval
    const existingPrice = get()._priceTickInterval
    if (existing) clearInterval(existing)
    if (existingPrice) clearInterval(existingPrice)

    const gameTickInterval = setInterval(() => get()._gameTick(), 1000)
    const priceTickInterval = setInterval(() => get()._priceTick(), 200)

    set({
      screen: 'game',
      pair,
      candles,
      liveCandle: live,
      currentRound: 1,
      totalRounds: selectedTemplate.totalRounds,
      roundPhase: 'watching',
      phaseTimer: PHASE_DURATIONS.watching,
      eliminationRound: false,
      myPoints: STARTING_POINTS,
      myStreak: 0,
      myBestStreak: 0,
      myPrediction: null,
      myRiskLevel: 'balanced',
      predictionPrice: null,
      finalPrice: null,
      lastRoundResult: null,
      eliminated: false,
      showResultOverlay: false,
      showEliminationOverlay: false,
      eliminatedNames: [],
      roundHistory: [],
      finalRank: 0,
      prizeWon: 0,
      _gameTickInterval: gameTickInterval,
      _priceTickInterval: priceTickInterval,
    })
  },

  // ── Prediction ───────────────────────────────────────────────────────────

  makePrediction: (p) => {
    const { roundPhase, liveCandle } = get()
    if (roundPhase !== 'predicting') return
    set({
      myPrediction: p,
      predictionPrice: p === 'skip' ? null : liveCandle?.close ?? null,
    })
  },

  setRiskLevel: (r) => set({ myRiskLevel: r }),
  setLiveBasePrice: (price) => set({ liveBasePrice: price }),

  // Called by useOandaStream each time a real price tick arrives.
  // Updates the live forming candle with the real market price instead of GBM.
  pushLiveTick: (price) => {
    const { liveCandle, screen } = get()
    if (screen !== 'game' || !liveCandle) return
    set({
      liveCandle: {
        ...liveCandle,
        close:  price,
        high:   Math.max(liveCandle.high, price),
        low:    Math.min(liveCandle.low,  price),
      },
    })
  },

  // ── Overlays ─────────────────────────────────────────────────────────────

  dismissResultOverlay: () => set({ showResultOverlay: false }),
  dismissEliminationOverlay: () => set({ showEliminationOverlay: false }),

  // ── Reset ────────────────────────────────────────────────────────────────

  resetGame: () => {
    const { _gameTickInterval, _priceTickInterval } = get()
    if (_gameTickInterval) clearInterval(_gameTickInterval)
    if (_priceTickInterval) clearInterval(_priceTickInterval)
    set({ ...defaultState })
  },

  // ── Internal: price tick (every 200ms) ───────────────────────────────────

  _priceTick: () => {
    const { liveCandle, pair, roundPhase } = get()
    if (!liveCandle) return
    // Only update live price display during watching/predicting; freeze during resolving
    if (roundPhase === 'between') return
    set({ liveCandle: tickCandle(liveCandle, pair) })
  },

  // ── Internal: game tick (every 1s) ───────────────────────────────────────

  _gameTick: () => {
    const state = get()
    const {
      roundPhase, phaseTimer, currentRound, totalRounds, pair,
      myPrediction, myRiskLevel, myPoints, myStreak, myBestStreak,
      predictionPrice, liveCandle, candles, players, eliminated,
      selectedTemplate, roundHistory,
    } = state

    const newTimer = phaseTimer - 1

    // ── Still counting down ──────────────────────────────────────────────

    if (newTimer > 0) {
      set({ phaseTimer: newTimer })
      return
    }

    // ── Phase transition ─────────────────────────────────────────────────

    if (roundPhase === 'watching') {
      // Move to predicting phase
      set({
        roundPhase: 'predicting',
        phaseTimer: PHASE_DURATIONS.predicting,
        myPrediction: null,
        predictionPrice: null,
      })
      return
    }

    if (roundPhase === 'predicting') {
      // Lock prediction (default to skip if not chosen)
      const lockedPrediction = myPrediction ?? 'skip'
      // *** BUG FIX: use the price captured at the moment the user tapped UP/DOWN.
      // Do NOT override with the current live price — that was moving the entry line.
      const capturedPrice = state.predictionPrice
      set({
        roundPhase: 'resolving',
        phaseTimer: PHASE_DURATIONS.resolving,
        myPrediction: lockedPrediction,
        predictionPrice: lockedPrediction !== 'skip' ? capturedPrice : null,
      })
      return
    }

    if (roundPhase === 'resolving') {
      // ── Calculate results ──────────────────────────────────────────────
      const endPrice = liveCandle?.close ?? 0
      const startPrice = state.predictionPrice ?? endPrice
      const marketResult = getMarketResult(startPrice, endPrice, pair)
      const prediction = state.myPrediction ?? 'skip'

      // Human result
      let updatedMyPoints = myPoints
      let updatedMyStreak = myStreak
      let updatedMyBestStreak = myBestStreak
      let result: RoundResult | null = null

      if (!eliminated) {
        const humanPlayer: Player = {
          id: 'player_human', name: 'You', avatar: '👤',
          points: myPoints, streak: myStreak, bestStreak: myBestStreak,
          eliminated: false, isHuman: true,
        }
        const { updatedPlayer, result: r } = applyRoundResult(humanPlayer, prediction, marketResult, myRiskLevel)
        updatedMyPoints = updatedPlayer.points
        updatedMyStreak = updatedPlayer.streak
        updatedMyBestStreak = updatedPlayer.bestStreak
        result = { ...r, round: currentRound }
      }

      // AI players
      let updatedPlayers = players.map(p => {
        if (p.isHuman) return { ...p, points: updatedMyPoints, streak: updatedMyStreak }
        if (p.eliminated) return p
        const aiP = aiPredict()
        const aiR = aiRiskLevel()
        const { updatedPlayer } = applyRoundResult(p, aiP, marketResult, aiR)
        return { ...updatedPlayer, prediction: aiP, lastResult: updatedPlayer.lastResult }
      })

      // Rank
      updatedPlayers = rankPlayers(updatedPlayers)

      // Check elimination
      const isEliminationRound = selectedTemplate
        ? currentRound % selectedTemplate.eliminationEvery === 0
        : false

      let eliminatedNames: string[] = []
      let humanEliminated = eliminated

      if (isEliminationRound) {
        const beforeElim = updatedPlayers
        updatedPlayers = eliminatePlayers(updatedPlayers, selectedTemplate?.eliminatePercent ?? 25)
        eliminatedNames = updatedPlayers
          .filter(p => p.eliminated && !beforeElim.find(b => b.id === p.id && b.eliminated))
          .map(p => p.name)

        // Check if human was just eliminated
        const humanInPlayers = updatedPlayers.find(p => p.isHuman)
        if (humanInPlayers?.eliminated && !eliminated) {
          humanEliminated = true
        }
      }

      // Seal closed candle into history; start fresh live candle
      const sealedCandle: Candle = { ...liveCandle! }
      const freshLive = newCandle(sealedCandle.close, 10_000)

      const newHistory = result ? [...roundHistory, result] : roundHistory

      // Check if game over
      const activePlayers = updatedPlayers.filter(p => !p.eliminated)
      const isGameOver = currentRound >= totalRounds || activePlayers.length <= 1

      if (isGameOver) {
        const rank = updatedPlayers.findIndex(p => p.isHuman) + 1
        const prizePool = calculatePrizePool(
          selectedTemplate?.entryFee ?? 100,
          selectedTemplate?.maxPlayers ?? 10,
        )
        const prizes = selectedTemplate?.prizes ?? [60, 30, 10]
        let prizeWon = 0
        if (rank === 1) prizeWon = Math.floor(prizePool * prizes[0] / 100)
        else if (rank === 2) prizeWon = Math.floor(prizePool * prizes[1] / 100)
        else if (rank === 3) prizeWon = Math.floor(prizePool * prizes[2] / 100)

        const { _gameTickInterval, _priceTickInterval } = get()
        if (_gameTickInterval) clearInterval(_gameTickInterval)
        if (_priceTickInterval) clearInterval(_priceTickInterval)

        set({
          players: updatedPlayers,
          myPoints: updatedMyPoints,
          myStreak: updatedMyStreak,
          myBestStreak: updatedMyBestStreak,
          eliminated: humanEliminated,
          lastRoundResult: result,
          showResultOverlay: !!result && !isEliminationRound,
          showEliminationOverlay: isEliminationRound && eliminatedNames.length > 0,
          eliminatedNames,
          finalRank: rank,
          prizeWon,
          roundHistory: newHistory,
          candles: [...candles, sealedCandle].slice(-80),
          liveCandle: freshLive,
          roundPhase: 'between',
          phaseTimer: 0,
          finalPrice: endPrice,
          _gameTickInterval: null,
          _priceTickInterval: null,
        })

        // Navigate to results after a short delay
        setTimeout(() => set({ screen: 'results' }), 2500)
        return
      }

      set({
        players: updatedPlayers,
        myPoints: updatedMyPoints,
        myStreak: updatedMyStreak,
        myBestStreak: updatedMyBestStreak,
        eliminated: humanEliminated,
        lastRoundResult: result,
        showResultOverlay: !!result && !isEliminationRound,
        showEliminationOverlay: isEliminationRound && eliminatedNames.length > 0,
        eliminatedNames,
        roundHistory: newHistory,
        candles: [...candles, sealedCandle].slice(-80),
        liveCandle: freshLive,
        currentRound: currentRound + 1,
        roundPhase: 'watching',
        phaseTimer: PHASE_DURATIONS.watching,
        myPrediction: null,
        predictionPrice: null,
        finalPrice: endPrice,
        eliminationRound: isEliminationRound,
      })
    }
  },
}))
