import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { Candle } from '@prisma/client'
import { db } from '../_lib/db.js'
import { getActiveStrategyVersion } from '../_lib/strategy-registry.js'
import type { CrossfireSettings } from '../_lib/strategy-registry.js'
import { detectSignal } from '../_lib/signal-detection.js'
import { simulateTrade } from '../_lib/trade-simulation.js'
import { toUKHour, toUKDateString } from '../_lib/time.js'

const ALLOWED_SYMBOLS = ['EUR_USD', 'GBP_USD']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  const secret = process.env.ADMIN_SECRET
  if (!secret || req.headers['authorization'] !== `Bearer ${secret}`) {
    return res.status(401).json({ success: false, error: 'Unauthorized' })
  }

  const { symbol, from, to, strategyVersionId } = req.body ?? {}

  if (!symbol || !ALLOWED_SYMBOLS.includes(symbol)) {
    return res.status(400).json({ success: false, error: `symbol must be one of: ${ALLOWED_SYMBOLS.join(', ')}` })
  }
  if (!from || !DATE_RE.test(from)) {
    return res.status(400).json({ success: false, error: 'from must be YYYY-MM-DD' })
  }
  if (!to || !DATE_RE.test(to)) {
    return res.status(400).json({ success: false, error: 'to must be YYYY-MM-DD' })
  }
  if (from > to) {
    return res.status(400).json({ success: false, error: 'from must be <= to' })
  }

  // Resolve strategy version
  let svId: string = strategyVersionId
  if (!svId) {
    const v = await getActiveStrategyVersion('Crossfire')
    if (!v) {
      return res.status(400).json({
        success: false,
        error: 'No active Crossfire strategy version — run POST /api/admin/seed-strategies first.',
      })
    }
    svId = v.id
  }

  const sv = await db.strategyVersion.findUnique({ where: { id: svId } })
  if (!sv) {
    return res.status(400).json({ success: false, error: `strategyVersionId ${svId} not found` })
  }
  const settings = sv.settingsJson as unknown as CrossfireSettings

  const fromDate = new Date(from + 'T00:00:00Z')
  const toDate   = new Date(to   + 'T23:59:59Z')

  // Create the BacktestRun checkpoint — updated to 'completed' or 'failed' when done
  const run = await db.backtestRun.create({
    data: { strategyVersionId: svId, symbol, timeframe: 'M5', fromDate, toDate, status: 'running' },
  })

  try {
    // One query for valid setups in range
    const setups = await db.crossfireSetup.findMany({
      where: { strategyVersionId: svId, symbol, setupValid: true, dateUk: { gte: from, lte: to } },
      orderBy: { dateUk: 'asc' },
    })

    // One query for all M5 candles in range
    const m5Candles = await db.candle.findMany({
      where: { symbol, timeframe: 'M5', timestampUtc: { gte: fromDate, lte: toDate } },
      orderBy: { timestampUtc: 'asc' },
    })

    // Group candles by UK date, keeping only session hours 13:00–15:xx UK
    const sessionByDate = new Map<string, Candle[]>()
    for (const c of m5Candles) {
      const h = toUKHour(c.timestampUtc.getTime())
      if (h < 13 || h >= 16) continue
      const d = toUKDateString(c.timestampUtc.getTime())
      let arr = sessionByDate.get(d)
      if (!arr) { arr = []; sessionByDate.set(d, arr) }
      arr.push(c)
    }

    let wins = 0, losses = 0, opens = 0, signalCount = 0

    for (const setup of setups) {
      const sessionCandles = sessionByDate.get(setup.dateUk) ?? []
      const signal = detectSignal(setup, sessionCandles)
      if (!signal) continue

      signalCount++

      // Upsert signal — idempotent by (setupId, direction)
      const signalRow = await db.signal.upsert({
        where:  { setupId_direction: { setupId: setup.id, direction: signal.direction } },
        create: {
          setupId:           setup.id,
          direction:         signal.direction,
          signalTs:          signal.signalTs,
          breakoutType:      signal.breakoutType,
          signalValid:       signal.signalValid,
          invalidReason:     signal.invalidReason,
          candleOpen:        signal.candleOpen,
          candleHigh:        signal.candleHigh,
          candleLow:         signal.candleLow,
          candleClose:       signal.candleClose,
          candleVolume:      signal.candleVolume,
          linePriceAtSignal: signal.linePriceAtSignal,
        },
        update: {
          signalTs:          signal.signalTs,
          breakoutType:      signal.breakoutType,
          signalValid:       signal.signalValid,
          invalidReason:     signal.invalidReason,
          candleOpen:        signal.candleOpen,
          candleHigh:        signal.candleHigh,
          candleLow:         signal.candleLow,
          candleClose:       signal.candleClose,
          candleVolume:      signal.candleVolume,
          linePriceAtSignal: signal.linePriceAtSignal,
        },
      })

      // Post-signal candles for trade simulation (strictly after the signal candle)
      const postSignal = sessionCandles.filter(
        c => c.timestampUtc.getTime() > signal.signalTs.getTime()
      )

      const trade = simulateTrade(
        signal.direction,
        signal.signalTs,
        signal.candleClose,
        setup,
        settings.riskReward,
        postSignal,
      )

      // Upsert trade — idempotent by signalId
      await db.trade.upsert({
        where:  { signalId: signalRow.id },
        create: {
          signalId:          signalRow.id,
          strategyVersionId: svId,
          backtestRunId:     run.id,
          symbol,
          direction:         signal.direction,
          entryTs:           signal.signalTs,
          entryPrice:        signal.candleClose,
          slPrice:           trade.slPrice,
          tpPrice:           trade.tpPrice,
          exitTs:            trade.exitTs,
          exitPrice:         trade.exitPrice,
          result:            trade.result,
          profitLossR:       trade.profitLossR,
        },
        update: {
          backtestRunId:     run.id,
          slPrice:           trade.slPrice,
          tpPrice:           trade.tpPrice,
          exitTs:            trade.exitTs,
          exitPrice:         trade.exitPrice,
          result:            trade.result,
          profitLossR:       trade.profitLossR,
        },
      })

      if (trade.result === 'win')  wins++
      if (trade.result === 'loss') losses++
      if (trade.result === 'open') opens++
    }

    const decided = wins + losses
    const winRate = decided > 0 ? wins / decided : null

    await db.backtestRun.update({
      where: { id: run.id },
      data:  {
        status:      'completed',
        tradeCount:  wins + losses + opens,
        winCount:    wins,
        lossCount:   losses,
        winRate,
        completedAt: new Date(),
      },
    })

    return res.status(200).json({
      success: true,
      data: {
        backtestRunId:    run.id,
        symbol,
        strategyVersionId: svId,
        setupsProcessed:  setups.length,
        signalsDetected:  signalCount,
        wins,
        losses,
        opens,
        winRate,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await db.backtestRun.update({
      where: { id: run.id },
      data:  { status: 'failed', errorMessage: message },
    }).catch(() => {})
    return res.status(500).json({ success: false, error: message })
  }
}
