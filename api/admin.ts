/**
 * Consolidated admin endpoint — all admin actions via ?action= query param.
 * Reduces 8 separate Vercel serverless functions to 1, staying within Hobby plan limits.
 *
 * GET  /api/admin?action=candle-counts
 * GET  /api/admin?action=strategies
 * GET  /api/admin?action=setup-counts[&symbol=EUR_USD]
 * GET  /api/admin?action=backtest-results[&symbol=EUR_USD]
 * POST /api/admin?action=ingest             { symbol, timeframe, from, to }
 * POST /api/admin?action=seed-strategies
 * POST /api/admin?action=run-setup-detection { symbol, from, to, strategyVersionId? }
 * POST /api/admin?action=run-backtest        { symbol, from, to, strategyVersionId? }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { Candle } from '@prisma/client'
import { db } from './_lib/db.js'
import { ingestCandles } from './_lib/candle-ingestion.js'
import { ensureCrossfireV1, getActiveStrategyVersion } from './_lib/strategy-registry.js'
import type { CrossfireSettings } from './_lib/strategy-registry.js'
import { runSetupDetectionForRange } from './_lib/crossfire-setup.js'
import { detectSignal } from './_lib/signal-detection.js'
import { simulateTrade } from './_lib/trade-simulation.js'
import { toUKHour, toUKDateString } from './_lib/time.js'

const ALLOWED_SYMBOLS    = ['EUR_USD', 'GBP_USD']
const ALLOWED_TIMEFRAMES = ['M5', 'M15']
const DATE_RE            = /^\d{4}-\d{2}-\d{2}$/

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.ADMIN_SECRET
  if (!secret || req.headers['authorization'] !== `Bearer ${secret}`) {
    return res.status(401).json({ success: false, error: 'Unauthorized' })
  }

  // action can come from query string (all methods) or request body (POST fallback)
  const action = String(req.query.action ?? req.body?.action ?? '')

  try {
    switch (action) {
      case 'candle-counts':        return await handleCandleCounts(req, res)
      case 'ingest':               return await handleIngest(req, res)
      case 'seed-strategies':      return await handleSeedStrategies(req, res)
      case 'strategies':           return await handleStrategies(req, res)
      case 'run-setup-detection':  return await handleRunSetupDetection(req, res)
      case 'setup-counts':         return await handleSetupCounts(req, res)
      case 'run-backtest':         return await handleRunBacktest(req, res)
      case 'backtest-results':     return await handleBacktestResults(req, res)
      default:
        return res.status(400).json({
          success: false,
          error: `Missing or unknown action. Valid actions: candle-counts, ingest, seed-strategies, strategies, run-setup-detection, setup-counts, run-backtest, backtest-results`,
        })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return res.status(500).json({ success: false, error: message })
  }
}

// ── GET candle-counts ──────────────────────────────────────────────────────

async function handleCandleCounts(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' })

  const groups = await db.candle.groupBy({
    by:      ['symbol', 'timeframe'],
    _count:  { id: true },
    _min:    { timestampUtc: true },
    _max:    { timestampUtc: true },
    orderBy: [{ symbol: 'asc' }, { timeframe: 'asc' }],
  })

  return res.status(200).json({
    success: true,
    data: groups.map(g => ({
      symbol:       g.symbol,
      timeframe:    g.timeframe,
      count:        g._count.id,
      earliestDate: g._min.timestampUtc,
      latestDate:   g._max.timestampUtc,
    })),
  })
}

// ── POST ingest ────────────────────────────────────────────────────────────

async function handleIngest(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' })

  const { symbol, timeframe, from, to } = req.body ?? {}

  if (!symbol || !ALLOWED_SYMBOLS.includes(symbol))
    return res.status(400).json({ success: false, error: `symbol must be one of: ${ALLOWED_SYMBOLS.join(', ')}` })
  if (!timeframe || !ALLOWED_TIMEFRAMES.includes(timeframe))
    return res.status(400).json({ success: false, error: `timeframe must be one of: ${ALLOWED_TIMEFRAMES.join(', ')}` })
  if (!from || !DATE_RE.test(from))
    return res.status(400).json({ success: false, error: 'from must be YYYY-MM-DD' })
  if (!to || !DATE_RE.test(to))
    return res.status(400).json({ success: false, error: 'to must be YYYY-MM-DD' })
  if (from > to)
    return res.status(400).json({ success: false, error: 'from must be <= to' })

  const result = await ingestCandles(
    symbol, timeframe,
    new Date(from + 'T00:00:00Z'),
    new Date(to   + 'T23:59:59Z'),
  )
  return res.status(200).json({ success: true, data: result })
}

// ── POST seed-strategies ───────────────────────────────────────────────────

async function handleSeedStrategies(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' })

  const { strategy, version, created } = await ensureCrossfireV1()
  return res.status(200).json({
    success: true,
    data: {
      created,
      strategy: { id: strategy.id, name: strategy.name, description: strategy.description, status: strategy.status },
      version:  { id: version.id, versionNumber: version.versionNumber, isActive: version.isActive, notes: version.notes, settingsJson: version.settingsJson },
    },
  })
}

// ── GET strategies ─────────────────────────────────────────────────────────

async function handleStrategies(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' })

  const strategies = await db.strategy.findMany({
    include: {
      versions: {
        orderBy: { versionNumber: 'asc' },
        select:  { id: true, versionNumber: true, isActive: true, isLiveApproved: true, notes: true, settingsJson: true, createdAt: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  })
  return res.status(200).json({ success: true, data: strategies })
}

// ── POST run-setup-detection ───────────────────────────────────────────────

async function handleRunSetupDetection(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' })

  const { symbol, from, to, strategyVersionId } = req.body ?? {}

  if (!symbol || !ALLOWED_SYMBOLS.includes(symbol))
    return res.status(400).json({ success: false, error: `symbol must be one of: ${ALLOWED_SYMBOLS.join(', ')}` })
  if (!from || !DATE_RE.test(from))
    return res.status(400).json({ success: false, error: 'from must be YYYY-MM-DD' })
  if (!to || !DATE_RE.test(to))
    return res.status(400).json({ success: false, error: 'to must be YYYY-MM-DD' })
  if (from > to)
    return res.status(400).json({ success: false, error: 'from must be <= to' })

  let svId: string = strategyVersionId
  if (!svId) {
    const v = await getActiveStrategyVersion('Crossfire')
    if (!v) return res.status(400).json({ success: false, error: 'No active Crossfire strategy version — run action=seed-strategies first.' })
    svId = v.id
  }

  const result = await runSetupDetectionForRange(
    symbol, svId,
    new Date(from + 'T00:00:00Z'),
    new Date(to   + 'T00:00:00Z'),
  )
  return res.status(200).json({ success: true, data: result })
}

// ── GET setup-counts ───────────────────────────────────────────────────────

async function handleSetupCounts(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' })

  const symbol = req.query.symbol ? String(req.query.symbol) : undefined
  const where  = symbol ? { symbol } : {}

  const [grouped, dateRanges] = await Promise.all([
    db.crossfireSetup.groupBy({
      by:    ['symbol', 'strategyVersionId', 'setupValid'],
      where,
      _count: { id: true },
    }),
    db.crossfireSetup.groupBy({
      by:   ['symbol', 'strategyVersionId'],
      where,
      _min: { dateUk: true },
      _max: { dateUk: true },
    }),
  ])

  const data = dateRanges.map(dr => {
    const vCount = grouped.find(g => g.symbol === dr.symbol && g.strategyVersionId === dr.strategyVersionId && g.setupValid === true)?._count.id  ?? 0
    const iCount = grouped.find(g => g.symbol === dr.symbol && g.strategyVersionId === dr.strategyVersionId && g.setupValid === false)?._count.id ?? 0
    return {
      symbol: dr.symbol, strategyVersionId: dr.strategyVersionId,
      totalCount: vCount + iCount, validCount: vCount, invalidCount: iCount,
      earliestDate: dr._min.dateUk, latestDate: dr._max.dateUk,
    }
  })

  return res.status(200).json({ success: true, data })
}

// ── POST run-backtest ──────────────────────────────────────────────────────

async function handleRunBacktest(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' })

  const { symbol, from, to, strategyVersionId } = req.body ?? {}

  if (!symbol || !ALLOWED_SYMBOLS.includes(symbol))
    return res.status(400).json({ success: false, error: `symbol must be one of: ${ALLOWED_SYMBOLS.join(', ')}` })
  if (!from || !DATE_RE.test(from))
    return res.status(400).json({ success: false, error: 'from must be YYYY-MM-DD' })
  if (!to || !DATE_RE.test(to))
    return res.status(400).json({ success: false, error: 'to must be YYYY-MM-DD' })
  if (from > to)
    return res.status(400).json({ success: false, error: 'from must be <= to' })

  let svId: string = strategyVersionId
  if (!svId) {
    const v = await getActiveStrategyVersion('Crossfire')
    if (!v) return res.status(400).json({ success: false, error: 'No active Crossfire strategy version — run action=seed-strategies first.' })
    svId = v.id
  }

  const sv = await db.strategyVersion.findUnique({ where: { id: svId } })
  if (!sv) return res.status(400).json({ success: false, error: `strategyVersionId ${svId} not found` })
  const settings = sv.settingsJson as unknown as CrossfireSettings

  const fromDate = new Date(from + 'T00:00:00Z')
  const toDate   = new Date(to   + 'T23:59:59Z')

  const run = await db.backtestRun.create({
    data: { strategyVersionId: svId, symbol, timeframe: 'M5', fromDate, toDate, status: 'running' },
  })

  try {
    const setups = await db.crossfireSetup.findMany({
      where:   { strategyVersionId: svId, symbol, setupValid: true, dateUk: { gte: from, lte: to } },
      orderBy: { dateUk: 'asc' },
    })

    const m5Candles = await db.candle.findMany({
      where:   { symbol, timeframe: 'M5', timestampUtc: { gte: fromDate, lte: toDate } },
      orderBy: { timestampUtc: 'asc' },
    })

    // Group session M5 candles (13:00–15:xx UK) by UK date
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

      const signalRow = await db.signal.upsert({
        where:  { setupId_direction: { setupId: setup.id, direction: signal.direction } },
        create: {
          setupId: setup.id, direction: signal.direction, signalTs: signal.signalTs,
          breakoutType: signal.breakoutType, signalValid: signal.signalValid, invalidReason: signal.invalidReason,
          candleOpen: signal.candleOpen, candleHigh: signal.candleHigh, candleLow: signal.candleLow,
          candleClose: signal.candleClose, candleVolume: signal.candleVolume, linePriceAtSignal: signal.linePriceAtSignal,
        },
        update: {
          signalTs: signal.signalTs, breakoutType: signal.breakoutType, signalValid: signal.signalValid,
          invalidReason: signal.invalidReason, candleOpen: signal.candleOpen, candleHigh: signal.candleHigh,
          candleLow: signal.candleLow, candleClose: signal.candleClose, candleVolume: signal.candleVolume,
          linePriceAtSignal: signal.linePriceAtSignal,
        },
      })

      const postSignal = sessionCandles.filter(c => c.timestampUtc.getTime() > signal.signalTs.getTime())
      const trade = simulateTrade(signal.direction, signal.signalTs, signal.candleClose, setup, settings.riskReward, postSignal)

      await db.trade.upsert({
        where:  { signalId: signalRow.id },
        create: {
          signalId: signalRow.id, strategyVersionId: svId, backtestRunId: run.id,
          symbol, direction: signal.direction, entryTs: signal.signalTs, entryPrice: signal.candleClose,
          slPrice: trade.slPrice, tpPrice: trade.tpPrice, exitTs: trade.exitTs,
          exitPrice: trade.exitPrice, result: trade.result, profitLossR: trade.profitLossR,
        },
        update: {
          backtestRunId: run.id, slPrice: trade.slPrice, tpPrice: trade.tpPrice,
          exitTs: trade.exitTs, exitPrice: trade.exitPrice, result: trade.result, profitLossR: trade.profitLossR,
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
      data:  { status: 'completed', tradeCount: wins + losses + opens, winCount: wins, lossCount: losses, winRate, completedAt: new Date() },
    })

    return res.status(200).json({
      success: true,
      data: { backtestRunId: run.id, symbol, strategyVersionId: svId, setupsProcessed: setups.length, signalsDetected: signalCount, wins, losses, opens, winRate },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await db.backtestRun.update({ where: { id: run.id }, data: { status: 'failed', errorMessage: message } }).catch(() => {})
    throw err
  }
}

// ── GET backtest-results ───────────────────────────────────────────────────

async function handleBacktestResults(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' })

  const symbol      = req.query.symbol ? String(req.query.symbol) : undefined
  const tradeWhere  = symbol ? { symbol } : {}
  const signalWhere = symbol ? { setup: { symbol } } : {}

  const [runs, tradesByResult, signalsByDirection] = await Promise.all([
    db.backtestRun.findMany({ where: symbol ? { symbol } : {}, orderBy: { startedAt: 'desc' }, take: 20 }),
    db.trade.groupBy({ by: ['result'], where: tradeWhere, _count: { id: true } }),
    db.signal.groupBy({ by: ['direction'], where: signalWhere, _count: { id: true } }),
  ])

  return res.status(200).json({
    success: true,
    data: {
      runs,
      summary: {
        totalSignals:       signalsByDirection.reduce((s, r) => s + r._count.id, 0),
        totalTrades:        tradesByResult.reduce((s, r) => s + r._count.id, 0),
        signalsByDirection,
        tradesByResult,
      },
    },
  })
}
