/**
 * Consolidated admin endpoint — all admin actions via ?action= query param.
 * Reduces 8 separate Vercel serverless functions to 1, staying within Hobby plan limits.
 *
 * GET  /api/admin?action=candle-counts
 * GET  /api/admin?action=strategies
 * GET  /api/admin?action=setup-counts[&symbol=EUR_USD]
 * GET  /api/admin?action=backtest-results[&symbol=EUR_USD]
 * GET  /api/admin?action=trade-analysis-results[&symbol=EUR_USD]
 * GET  /api/admin?action=backtest-detail ?backtestRunId=xxx
 * GET  /api/admin?action=trade-list     ?backtestRunId=xxx
 * GET  /api/admin?action=setup-list     ?backtestRunId=xxx
 * GET  /api/admin?action=data-coverage  ?from=YYYY-MM-DD&to=YYYY-MM-DD[&symbol=EUR_USD][&timeframes=M5,M15,H1,H4,D1]
 * GET  /api/admin?action=import-plan    ?from=YYYY-MM-DD&to=YYYY-MM-DD[&symbol=EUR_USD][&timeframes=M5,M15]
 * POST /api/admin?action=ingest             { symbol, timeframe, from, to }
 * POST /api/admin?action=seed-strategies
 * POST /api/admin?action=run-setup-detection { symbol, from, to, strategyVersionId? }
 * POST /api/admin?action=run-backtest        { symbol, from, to, strategyVersionId? }
 * POST /api/admin?action=run-trade-analysis  { backtestRunId } OR { symbol, from, to }
 * POST /api/admin?action=run-pipeline        { symbol, from, to }
 * GET  /api/admin?action=generate-ai-prompt    ?backtestRunId=xxx
 * POST /api/admin?action=save-ai-review        { backtestRunId, responseText, aiModel? }
 * POST /api/admin?action=run-ai-review          { backtestRunId }   (requires ANTHROPIC_API_KEY)
 * GET  /api/admin?action=ai-review-results      ?backtestRunId=xxx
 * GET  /api/admin?action=recommendation-results ?backtestRunId=xxx [&status=suggested]
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
import { computePathAnalysis } from './_lib/trade-path-analysis.js'
import { computeAllSummaries } from './_lib/analytics.js'
import type { TradeRecord } from './_lib/analytics.js'
import { simulateFtmo } from './_lib/ftmo.js'
import type { FtmoConfig } from './_lib/ftmo.js'
import { buildPrompt, parseRecommendations } from './_lib/ai-research.js'
import type { FtmoInput } from './_lib/ai-research.js'
import { toUKHour, toUKDateString } from './_lib/time.js'
import { computeCoverage, countWeekdays } from './_lib/coverage.js'

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
      case 'run-backtest':          return await handleRunBacktest(req, res)
      case 'backtest-results':      return await handleBacktestResults(req, res)
      case 'run-trade-analysis':     return await handleRunTradeAnalysis(req, res)
      case 'trade-analysis-results': return await handleTradeAnalysisResults(req, res)
      case 'run-analytics':          return await handleRunAnalytics(req, res)
      case 'analytics-results':      return await handleAnalyticsResults(req, res)
      case 'run-ftmo-evaluation':    return await handleRunFtmoEvaluation(req, res)
      case 'ftmo-results':           return await handleFtmoResults(req, res)
      case 'generate-ai-prompt':     return await handleGenerateAiPrompt(req, res)
      case 'save-ai-review':         return await handleSaveAiReview(req, res)
      case 'run-ai-review':          return await handleRunAiReview(req, res)
      case 'ai-review-results':      return await handleAiReviewResults(req, res)
      case 'recommendation-results': return await handleRecommendationResults(req, res)
      case 'backtest-detail':        return await handleBacktestDetail(req, res)
      case 'trade-list':             return await handleTradeList(req, res)
      case 'setup-list':             return await handleSetupList(req, res)
      case 'data-coverage':          return await handleDataCoverage(req, res)
      case 'import-plan':            return await handleImportPlan(req, res)
      case 'run-pipeline':           return await handleRunPipeline(req, res)
      default:
        return res.status(400).json({
          success: false,
          error: `Missing or unknown action. Valid actions: candle-counts, ingest, seed-strategies, strategies, run-setup-detection, setup-counts, run-backtest, backtest-results, run-trade-analysis, trade-analysis-results, run-analytics, analytics-results, run-ftmo-evaluation, ftmo-results, generate-ai-prompt, save-ai-review, run-ai-review, ai-review-results, recommendation-results, backtest-detail, trade-list, setup-list, data-coverage, import-plan, run-pipeline`,
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

// ── POST run-trade-analysis ────────────────────────────────────────────────

async function handleRunTradeAnalysis(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' })

  const { backtestRunId, symbol, from, to } = req.body ?? {}

  let tradeSymbol: string
  let tradeWhere: Record<string, unknown>

  if (backtestRunId) {
    const run = await db.backtestRun.findUnique({ where: { id: String(backtestRunId) } })
    if (!run) return res.status(400).json({ success: false, error: `backtestRunId ${backtestRunId} not found` })
    tradeSymbol = run.symbol
    tradeWhere  = { backtestRunId: String(backtestRunId) }
  } else if (symbol && from && to) {
    if (!ALLOWED_SYMBOLS.includes(symbol))
      return res.status(400).json({ success: false, error: `symbol must be one of: ${ALLOWED_SYMBOLS.join(', ')}` })
    if (!DATE_RE.test(from))
      return res.status(400).json({ success: false, error: 'from must be YYYY-MM-DD' })
    if (!DATE_RE.test(to))
      return res.status(400).json({ success: false, error: 'to must be YYYY-MM-DD' })
    if (from > to)
      return res.status(400).json({ success: false, error: 'from must be <= to' })
    tradeSymbol = symbol
    tradeWhere  = {
      symbol,
      entryTs: { gte: new Date(from + 'T00:00:00Z'), lte: new Date(to + 'T23:59:59Z') },
    }
  } else {
    return res.status(400).json({
      success: false,
      error: 'Provide either { backtestRunId } or { symbol, from, to }',
    })
  }

  const trades = await db.trade.findMany({ where: tradeWhere, orderBy: { entryTs: 'asc' } })
  if (trades.length === 0) return res.status(200).json({ success: true, data: { processed: 0, symbol: tradeSymbol } })

  // Determine candle window spanning all trades (one batch query)
  const minEntryTs = trades[0].entryTs
  const maxExitTs  = trades.reduce<Date>((max, t) => {
    const ts = t.exitTs ?? t.entryTs
    return ts > max ? ts : max
  }, trades[0].exitTs ?? trades[0].entryTs)

  const allCandles = await db.candle.findMany({
    where:   { symbol: tradeSymbol, timeframe: 'M5', timestampUtc: { gte: minEntryTs, lte: maxExitTs } },
    orderBy: { timestampUtc: 'asc' },
  })

  let processed = 0

  for (const trade of trades) {
    const entryTMs = trade.entryTs.getTime()
    const exitTMs  = trade.exitTs?.getTime() ?? Infinity

    // Candles strictly after entry and up to (inclusive) exit, matching postSignalCandles convention
    const tradeCandles = allCandles.filter(c => {
      const ts = c.timestampUtc.getTime()
      return ts > entryTMs && ts <= exitTMs
    })

    const result = computePathAnalysis(trade, tradeCandles)

    await db.tradePathAnalysis.upsert({
      where:  { tradeId: trade.id },
      create: { tradeId: trade.id, ...result },
      update: { ...result },
    })

    processed++
  }

  return res.status(200).json({ success: true, data: { processed, symbol: tradeSymbol } })
}

// ── GET trade-analysis-results ─────────────────────────────────────────────

async function handleTradeAnalysisResults(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' })

  const symbol = req.query.symbol ? String(req.query.symbol) : undefined

  const rows = await db.tradePathAnalysis.findMany({
    where:   symbol ? { trade: { symbol } } : {},
    include: { trade: { select: { result: true } } },
  })

  if (rows.length === 0) return res.status(200).json({ success: true, data: { count: 0 } })

  const count    = rows.length
  const avgMfeR  = rows.reduce((s, r) => s + (r.mfeR ?? 0), 0) / count
  const avgMaeR  = rows.reduce((s, r) => s + (r.maeR ?? 0), 0) / count
  const pct1r    = (rows.filter(r => r.reached1r).length / count) * 100
  const pct2r    = (rows.filter(r => r.reached2r).length / count) * 100
  const pct3r    = (rows.filter(r => r.reached3r).length / count) * 100
  const beHelped = rows.filter(r => r.breakEvenWouldHelp).length

  const with1rTime   = rows.filter(r => r.timeTo1rMinutes !== null)
  const avgTimeTo1r  = with1rTime.length > 0
    ? Math.round(with1rTime.reduce((s, r) => s + (r.timeTo1rMinutes ?? 0), 0) / with1rTime.length)
    : null

  const avgExitMins  = rows.filter(r => r.timeToExitMinutes !== null).reduce((s, r) => s + (r.timeToExitMinutes ?? 0), 0)
  const avgExitCount = rows.filter(r => r.timeToExitMinutes !== null).length

  return res.status(200).json({
    success: true,
    data: {
      count,
      avgMfeR:              r2(avgMfeR),
      avgMaeR:              r2(avgMaeR),
      pctReaching1r:        r1(pct1r),
      pctReaching2r:        r1(pct2r),
      pctReaching3r:        r1(pct3r),
      breakEvenWouldHelp:   { count: beHelped, pct: r1((beHelped / count) * 100) },
      avgTimeTo1rMinutes:   avgTimeTo1r,
      avgTimeToExitMinutes: avgExitCount > 0 ? Math.round(avgExitMins / avgExitCount) : null,
    },
  })
}

function r2(n: number) { return Math.round(n * 100) / 100 }
function r1(n: number) { return Math.round(n * 10)  / 10  }

// ── POST run-analytics ─────────────────────────────────────────────────────

async function handleRunAnalytics(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' })

  const { backtestRunId } = req.body ?? {}
  if (!backtestRunId) return res.status(400).json({ success: false, error: 'backtestRunId is required' })

  const run = await db.backtestRun.findUnique({ where: { id: String(backtestRunId) } })
  if (!run) return res.status(400).json({ success: false, error: `backtestRunId ${backtestRunId} not found` })

  const rawTrades = await db.trade.findMany({
    where:   { backtestRunId: run.id },
    orderBy: { entryTs: 'asc' },
    include: {
      pathAnalysis: true,
      signal:       { select: { breakoutType: true } },
    },
  })

  const trades: TradeRecord[] = rawTrades.map(t => ({
    id:           t.id,
    direction:    t.direction,
    entryTs:      t.entryTs,
    result:       t.result,
    profitLossR:  t.profitLossR,
    breakoutType: t.signal?.breakoutType ?? 'unknown',
    pathAnalysis: t.pathAnalysis ? {
      mfeR:               t.pathAnalysis.mfeR,
      maeR:               t.pathAnalysis.maeR,
      reached1r:          t.pathAnalysis.reached1r,
      reached2r:          t.pathAnalysis.reached2r,
      reached3r:          t.pathAnalysis.reached3r,
      timeTo1rMinutes:    t.pathAnalysis.timeTo1rMinutes,
      timeToExitMinutes:  t.pathAnalysis.timeToExitMinutes,
      breakEvenWouldHelp: t.pathAnalysis.breakEvenWouldHelp,
    } : null,
  }))

  const summaries = computeAllSummaries(trades)
  let processed = 0

  for (const [summaryType, summaryJson] of Object.entries(summaries)) {
    await db.analyticsSummary.upsert({
      where:  { backtestRunId_summaryType: { backtestRunId: run.id, summaryType } },
      create: { backtestRunId: run.id, summaryType, summaryJson },
      update: { summaryJson },
    })
    processed++
  }

  return res.status(200).json({
    success: true,
    data: { backtestRunId: run.id, tradeCount: trades.length, summariesGenerated: processed },
  })
}

// ── GET analytics-results ──────────────────────────────────────────────────

async function handleAnalyticsResults(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' })

  const backtestRunId = req.query.backtestRunId ? String(req.query.backtestRunId) : undefined
  if (!backtestRunId) return res.status(400).json({ success: false, error: 'backtestRunId query param is required' })

  const rows = await db.analyticsSummary.findMany({
    where:   { backtestRunId },
    orderBy: { summaryType: 'asc' },
  })

  return res.status(200).json({
    success: true,
    data: rows.map(r => ({ summaryType: r.summaryType, summaryJson: r.summaryJson, createdAt: r.createdAt })),
  })
}

// ── POST run-ftmo-evaluation ───────────────────────────────────────────────

async function handleRunFtmoEvaluation(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' })

  const { backtestRunId } = req.body ?? {}
  if (!backtestRunId) return res.status(400).json({ success: false, error: 'backtestRunId is required' })

  const run = await db.backtestRun.findUnique({ where: { id: String(backtestRunId) } })
  if (!run) return res.status(400).json({ success: false, error: `backtestRunId ${backtestRunId} not found` })

  const sv = await db.strategyVersion.findUnique({ where: { id: run.strategyVersionId } })
  const rrRatio = sv ? (sv.settingsJson as unknown as CrossfireSettings).riskReward ?? 3 : 3

  const trades = await db.trade.findMany({
    where:   { backtestRunId: run.id },
    orderBy: { entryTs: 'asc' },
    select:  { entryTs: true, profitLossR: true },
  })

  const scenarios: FtmoConfig[] = [
    { accountSize: 100_000, riskPercent: 0.01, rrRatio, dailyLossLimit: 0.05, maxDrawdownLimit: 0.10, profitTarget: 0.08 },
    { accountSize: 100_000, riskPercent: 0.01, rrRatio, dailyLossLimit: 0.05, maxDrawdownLimit: 0.10, profitTarget: 0.10 },
  ]

  const results = []
  for (const config of scenarios) {
    const sim = simulateFtmo(trades, config)
    const row = await db.fundedAccountTest.create({
      data: {
        strategyVersionId: run.strategyVersionId,
        backtestRunId:     run.id,
        accountSize:       config.accountSize,
        riskPercent:       config.riskPercent,
        rrRatio:           config.rrRatio,
        dailyLossLimit:    config.dailyLossLimit,
        maxDrawdownLimit:  config.maxDrawdownLimit,
        passed:            sim.passed,
        peakBalance:       sim.peakBalance,
        worstDrawdown:     sim.worstDrawdown,
        dailyBreachCount:  sim.dailyBreachCount,
        failureReason:     sim.failureReason,
        equityCurveJson:   sim.equityCurveJson as object,
      },
    })
    results.push({
      id:               row.id,
      profitTarget:     config.profitTarget,
      passed:           sim.passed,
      failureReason:    sim.failureReason,
      peakBalance:      sim.peakBalance,
      worstDrawdown:    sim.worstDrawdown,
      finalBalance:     sim.finalBalance,
      dailyBreachCount: sim.dailyBreachCount,
    })
  }

  const passCount = results.filter(r => r.passed).length

  return res.status(200).json({
    success: true,
    data: { backtestRunId: run.id, tested: results.length, passCount, results },
  })
}

// ── GET ftmo-results ───────────────────────────────────────────────────────

async function handleFtmoResults(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' })

  const backtestRunId = req.query.backtestRunId ? String(req.query.backtestRunId) : undefined
  const symbol        = req.query.symbol        ? String(req.query.symbol)        : undefined

  const where: Record<string, unknown> = {}
  if (backtestRunId) where.backtestRunId = backtestRunId
  if (symbol)        where.backtestRun   = { symbol }

  const rows = await db.fundedAccountTest.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take:    20,
  })

  return res.status(200).json({
    success: true,
    data: rows.map(r => ({
      id:               r.id,
      backtestRunId:    r.backtestRunId,
      accountSize:      r.accountSize,
      riskPercent:      r.riskPercent,
      dailyLossLimit:   r.dailyLossLimit,
      maxDrawdownLimit: r.maxDrawdownLimit,
      passed:           r.passed,
      peakBalance:      r.peakBalance,
      worstDrawdown:    r.worstDrawdown,
      dailyBreachCount: r.dailyBreachCount,
      failureReason:    r.failureReason,
      createdAt:        r.createdAt,
      profitTarget:     (r.equityCurveJson as Record<string, unknown>)?.profitTarget ?? null,
      finalBalance:     (r.equityCurveJson as Record<string, unknown>)?.finalBalance ?? null,
    })),
  })
}

// ── POST run-ai-review ─────────────────────────────────────────────────────

async function handleRunAiReview(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(400).json({ success: false, error: 'ANTHROPIC_API_KEY is not configured' })

  const { backtestRunId } = req.body ?? {}
  if (!backtestRunId) return res.status(400).json({ success: false, error: 'backtestRunId is required' })

  const run = await db.backtestRun.findUnique({ where: { id: String(backtestRunId) } })
  if (!run) return res.status(400).json({ success: false, error: `backtestRunId ${backtestRunId} not found` })

  // Require analytics summaries to exist
  const rawSummaries = await db.analyticsSummary.findMany({
    where:   { backtestRunId: run.id },
    orderBy: { summaryType: 'asc' },
  })
  if (rawSummaries.length === 0)
    return res.status(400).json({ success: false, error: 'No analytics summaries found. Run action=run-analytics first.' })

  // FTMO results for context (latest 4 = 2 runs × 2 targets)
  const rawFtmo = await db.fundedAccountTest.findMany({
    where:   { backtestRunId: run.id },
    orderBy: { createdAt: 'desc' },
    take:    4,
  })

  // Strategy version + settings
  const sv = await db.strategyVersion.findUnique({ where: { id: run.strategyVersionId } })
  if (!sv) return res.status(400).json({ success: false, error: 'Strategy version not found' })
  const settings = sv.settingsJson as unknown as CrossfireSettings

  const ftmoResults: FtmoInput[] = rawFtmo.map(r => ({
    profitTarget:     (r.equityCurveJson as Record<string, unknown>)?.profitTarget as number | null ?? null,
    passed:           r.passed,
    peakBalance:      r.peakBalance,
    worstDrawdown:    r.worstDrawdown,
    dailyBreachCount: r.dailyBreachCount,
    failureReason:    r.failureReason,
    finalBalance:     (r.equityCurveJson as Record<string, unknown>)?.finalBalance as number | null ?? null,
  }))

  const prompt = buildPrompt({
    backtestRunId:         run.id,
    strategyVersionNumber: sv.versionNumber,
    settings,
    summaries:             rawSummaries.map(s => ({ summaryType: s.summaryType, summaryJson: s.summaryJson })),
    ftmoResults,
  })

  // Call Anthropic API (non-streaming — we need to parse the full response)
  const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type':      'application/json',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages:   [{ role: 'user', content: prompt }],
    }),
  })

  if (!aiRes.ok) {
    const errText = await aiRes.text()
    return res.status(500).json({ success: false, error: `Anthropic API error ${aiRes.status}: ${errText.slice(0, 300)}` })
  }

  const aiData = await aiRes.json() as {
    content?: { type: string; text: string }[]
    usage?:   { input_tokens: number; output_tokens: number }
    model?:   string
  }

  const responseText = aiData.content?.[0]?.text ?? ''
  const tokenCount   = (aiData.usage?.input_tokens ?? 0) + (aiData.usage?.output_tokens ?? 0)
  const modelUsed    = aiData.model ?? 'claude-haiku-4-5-20251001'

  const parsed = parseRecommendations(responseText)

  // Persist the review row (even if recommendations parsing failed — raw response is preserved)
  const review = await db.aiReview.create({
    data: {
      backtestRunId:       run.id,
      aiModel:             modelUsed,
      prompt,
      response:            responseText,
      recommendationsJson: parsed.length > 0 ? parsed as object[] : undefined,
      tokenCount,
    },
  })

  // Create one StrategyRecommendation row per parsed recommendation
  // proposedSettingsJson = full merged settings (current + delta) for human review
  let recCount = 0
  for (const rec of parsed) {
    const proposedSettings = { ...settings, ...rec.proposedSettingChange }
    await db.strategyRecommendation.create({
      data: {
        aiReviewId:          review.id,
        strategyVersionId:   sv.id,
        proposedSettingsJson: proposedSettings as object,
        rationale:           `${rec.filter}\n\n${rec.rationale}\n\nOverfitting risk: ${rec.overfittingRisk}`,
        expectedBenefit:     rec.expectedBenefit,
        status:              'suggested',
      },
    })
    recCount++
  }

  return res.status(200).json({
    success: true,
    data: {
      reviewId:            review.id,
      backtestRunId:       run.id,
      modelUsed,
      tokenCount,
      recommendationCount: recCount,
      parsedSuccessfully:  parsed.length > 0,
    },
  })
}

// ── GET ai-review-results ──────────────────────────────────────────────────

async function handleAiReviewResults(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' })

  const backtestRunId = req.query.backtestRunId ? String(req.query.backtestRunId) : undefined
  if (!backtestRunId) return res.status(400).json({ success: false, error: 'backtestRunId query param is required' })

  const rows = await db.aiReview.findMany({
    where:   { backtestRunId },
    orderBy: { createdAt: 'desc' },
    select: {
      id:                  true,
      aiModel:             true,
      tokenCount:          true,
      recommendationsJson: true,
      createdAt:           true,
      _count:              { select: { recommendations: true } },
    },
  })

  return res.status(200).json({
    success: true,
    data: rows.map(r => ({
      id:                  r.id,
      aiModel:             r.aiModel,
      tokenCount:          r.tokenCount,
      recommendationCount: r._count.recommendations,
      recommendationsJson: r.recommendationsJson,
      createdAt:           r.createdAt,
    })),
  })
}

// ── GET recommendation-results ─────────────────────────────────────────────

async function handleRecommendationResults(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' })

  const backtestRunId = req.query.backtestRunId ? String(req.query.backtestRunId) : undefined
  const status        = req.query.status        ? String(req.query.status)        : undefined

  const where: Record<string, unknown> = {}
  if (backtestRunId) where.aiReview = { backtestRunId }
  if (status)        where.status   = status

  const rows = await db.strategyRecommendation.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take:    50,
    include: {
      aiReview: { select: { id: true, backtestRunId: true, aiModel: true, createdAt: true } },
    },
  })

  return res.status(200).json({
    success: true,
    data: rows.map(r => ({
      id:                  r.id,
      aiReviewId:          r.aiReviewId,
      backtestRunId:       r.aiReview.backtestRunId,
      strategyVersionId:   r.strategyVersionId,
      rationale:           r.rationale,
      expectedBenefit:     r.expectedBenefit,
      proposedSettingsJson: r.proposedSettingsJson,
      status:              r.status,
      createdAt:           r.createdAt,
    })),
  })
}

// ── GET generate-ai-prompt ─────────────────────────────────────────────────
// Builds the analytics prompt without calling Anthropic. Copy the returned
// prompt into claude.ai, then POST the response to action=save-ai-review.

async function handleGenerateAiPrompt(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' })

  const backtestRunId = req.query.backtestRunId ? String(req.query.backtestRunId) : undefined
  if (!backtestRunId) return res.status(400).json({ success: false, error: 'backtestRunId query param is required' })

  const run = await db.backtestRun.findUnique({ where: { id: backtestRunId } })
  if (!run) return res.status(400).json({ success: false, error: `backtestRunId ${backtestRunId} not found` })

  const rawSummaries = await db.analyticsSummary.findMany({
    where:   { backtestRunId: run.id },
    orderBy: { summaryType: 'asc' },
  })
  if (rawSummaries.length === 0)
    return res.status(400).json({ success: false, error: 'No analytics summaries found. Run action=run-analytics first.' })

  const rawFtmo = await db.fundedAccountTest.findMany({
    where:   { backtestRunId: run.id },
    orderBy: { createdAt: 'desc' },
    take:    4,
  })

  const sv = await db.strategyVersion.findUnique({ where: { id: run.strategyVersionId } })
  if (!sv) return res.status(400).json({ success: false, error: 'Strategy version not found' })
  const settings = sv.settingsJson as unknown as CrossfireSettings

  const ftmoResults: FtmoInput[] = rawFtmo.map(r => ({
    profitTarget:     (r.equityCurveJson as Record<string, unknown>)?.profitTarget as number | null ?? null,
    passed:           r.passed,
    peakBalance:      r.peakBalance,
    worstDrawdown:    r.worstDrawdown,
    dailyBreachCount: r.dailyBreachCount,
    failureReason:    r.failureReason,
    finalBalance:     (r.equityCurveJson as Record<string, unknown>)?.finalBalance as number | null ?? null,
  }))

  const prompt = buildPrompt({
    backtestRunId:         run.id,
    strategyVersionNumber: sv.versionNumber,
    settings,
    summaries:             rawSummaries.map(s => ({ summaryType: s.summaryType, summaryJson: s.summaryJson })),
    ftmoResults,
  })

  // Indicate whether auto-review is available so a UI can show the right call-to-action
  const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY)

  return res.status(200).json({
    success: true,
    data: {
      prompt,
      backtestRunId:     run.id,
      strategyVersionId: sv.id,
      summaryCount:      rawSummaries.length,
      ftmoResultCount:   rawFtmo.length,
      autoReviewAvailable: hasApiKey,
    },
  })
}

// ── POST save-ai-review ────────────────────────────────────────────────────
// Accepts a pasted Claude response and saves it as if Anthropic had responded.
// Use after copying the prompt from generate-ai-prompt and running it manually.

async function handleSaveAiReview(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' })

  const { backtestRunId, responseText, aiModel } = req.body ?? {}
  if (!backtestRunId)  return res.status(400).json({ success: false, error: 'backtestRunId is required' })
  if (!responseText || typeof responseText !== 'string' || responseText.trim().length === 0)
    return res.status(400).json({ success: false, error: 'responseText is required and must be a non-empty string' })

  const run = await db.backtestRun.findUnique({ where: { id: String(backtestRunId) } })
  if (!run) return res.status(400).json({ success: false, error: `backtestRunId ${backtestRunId} not found` })

  const sv = await db.strategyVersion.findUnique({ where: { id: run.strategyVersionId } })
  if (!sv) return res.status(400).json({ success: false, error: 'Strategy version not found' })
  const settings = sv.settingsJson as unknown as CrossfireSettings

  // Re-build the prompt so the stored review row has the full prompt/response pair
  const rawSummaries = await db.analyticsSummary.findMany({
    where:   { backtestRunId: run.id },
    orderBy: { summaryType: 'asc' },
  })
  if (rawSummaries.length === 0)
    return res.status(400).json({ success: false, error: 'No analytics summaries found. Run action=run-analytics first.' })

  const rawFtmo = await db.fundedAccountTest.findMany({
    where:   { backtestRunId: run.id },
    orderBy: { createdAt: 'desc' },
    take:    4,
  })

  const ftmoResults: FtmoInput[] = rawFtmo.map(r => ({
    profitTarget:     (r.equityCurveJson as Record<string, unknown>)?.profitTarget as number | null ?? null,
    passed:           r.passed,
    peakBalance:      r.peakBalance,
    worstDrawdown:    r.worstDrawdown,
    dailyBreachCount: r.dailyBreachCount,
    failureReason:    r.failureReason,
    finalBalance:     (r.equityCurveJson as Record<string, unknown>)?.finalBalance as number | null ?? null,
  }))

  const prompt = buildPrompt({
    backtestRunId:         run.id,
    strategyVersionNumber: sv.versionNumber,
    settings,
    summaries:             rawSummaries.map(s => ({ summaryType: s.summaryType, summaryJson: s.summaryJson })),
    ftmoResults,
  })

  const parsed = parseRecommendations(responseText.trim())

  const review = await db.aiReview.create({
    data: {
      backtestRunId: run.id,
      aiModel:       aiModel ? String(aiModel) : 'manual',
      prompt,
      response:      responseText.trim(),
      recommendationsJson: parsed.length > 0 ? parsed as object[] : undefined,
      tokenCount:    null,
    },
  })

  let recCount = 0
  for (const rec of parsed) {
    const proposedSettings = { ...settings, ...rec.proposedSettingChange }
    await db.strategyRecommendation.create({
      data: {
        aiReviewId:           review.id,
        strategyVersionId:    sv.id,
        proposedSettingsJson: proposedSettings as object,
        rationale:            `${rec.filter}\n\n${rec.rationale}\n\nOverfitting risk: ${rec.overfittingRisk}`,
        expectedBenefit:      rec.expectedBenefit,
        status:               'suggested',
      },
    })
    recCount++
  }

  return res.status(200).json({
    success: true,
    data: {
      reviewId:            review.id,
      backtestRunId:       run.id,
      aiModel:             review.aiModel,
      recommendationCount: recCount,
      parsedSuccessfully:  parsed.length > 0,
    },
  })
}

// ── Pipeline step type ─────────────────────────────────────────────────────

interface PipelineStep {
  step:       string
  status:     'completed' | 'skipped' | 'failed'
  durationMs: number
  data?:      Record<string, unknown>
  error?:     string
}

// ── GET data-coverage ──────────────────────────────────────────────────────

async function handleDataCoverage(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' })

  const from    = req.query.from    ? String(req.query.from)    : undefined
  const to      = req.query.to      ? String(req.query.to)      : undefined
  const symRaw  = req.query.symbol  ? String(req.query.symbol)  : undefined
  const tfRaw   = req.query.timeframes ? String(req.query.timeframes) : 'M5,M15,H1,H4,D1'

  if (!from || !DATE_RE.test(from)) return res.status(400).json({ success: false, error: 'from must be YYYY-MM-DD' })
  if (!to   || !DATE_RE.test(to))   return res.status(400).json({ success: false, error: 'to must be YYYY-MM-DD' })
  if (from > to) return res.status(400).json({ success: false, error: 'from must be <= to' })

  const symbols    = symRaw ? [symRaw] : ALLOWED_SYMBOLS
  const timeframes = tfRaw.split(',').map(s => s.trim()).filter(Boolean)
  const fromDate   = new Date(from + 'T00:00:00Z')
  const toDate     = new Date(to   + 'T23:59:59Z')

  const coverage = await computeCoverage(symbols, timeframes, fromDate, toDate)

  return res.status(200).json({
    success: true,
    data: {
      from,
      to,
      weekdays: countWeekdays(fromDate, toDate),
      coverage,
    },
  })
}

// ── GET import-plan ────────────────────────────────────────────────────────

async function handleImportPlan(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' })

  const from   = req.query.from   ? String(req.query.from)   : undefined
  const to     = req.query.to     ? String(req.query.to)     : undefined
  const symRaw = req.query.symbol ? String(req.query.symbol) : undefined
  const tfRaw  = req.query.timeframes ? String(req.query.timeframes) : 'M5,M15'

  if (!from || !DATE_RE.test(from)) return res.status(400).json({ success: false, error: 'from must be YYYY-MM-DD' })
  if (!to   || !DATE_RE.test(to))   return res.status(400).json({ success: false, error: 'to must be YYYY-MM-DD' })
  if (from > to) return res.status(400).json({ success: false, error: 'from must be <= to' })

  const symbols    = symRaw ? [symRaw] : ALLOWED_SYMBOLS
  // Restrict to supported timeframes only
  const timeframes = tfRaw.split(',').map(s => s.trim()).filter(t => ALLOWED_TIMEFRAMES.includes(t))
  if (timeframes.length === 0) timeframes.push('M5', 'M15')

  const fromDate = new Date(from + 'T00:00:00Z')
  const toDate   = new Date(to   + 'T23:59:59Z')

  const coverage = await computeCoverage(symbols, timeframes, fromDate, toDate)

  const jobs = coverage
    .filter(c => c.needsImport)
    .map(c => ({
      symbol:        c.symbol,
      timeframe:     c.timeframe,
      from,
      to,
      currentCount:  c.actualCount,
      expectedCount: c.expectedCount,
      coveragePct:   c.coveragePct,
    }))

  const m15Ready = !coverage.some(c => c.timeframe === 'M15' && c.needsImport)
  const m5Ready  = !coverage.some(c => c.timeframe === 'M5'  && c.needsImport)

  return res.status(200).json({
    success: true,
    data: {
      from,
      to,
      weekdays:               countWeekdays(fromDate, toDate),
      coverage,
      jobs,
      readyForSetupDetection: m15Ready,
      readyForBacktest:       m5Ready,
      readyToRunPipeline:     m15Ready && m5Ready,
    },
  })
}

// ── POST run-pipeline ──────────────────────────────────────────────────────
// Runs the full pipeline in order: import M15 → import M5 → setup detection
// → backtest → path analysis → analytics → FTMO. Skips import if coverage ≥ 90%.
// Stops on fatal failures (import / setup / backtest); continues on non-fatal ones.
// AI review is NOT included — always trigger that manually.

async function handleRunPipeline(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' })

  const { symbol, from, to } = req.body ?? {}

  if (!symbol || !ALLOWED_SYMBOLS.includes(symbol))
    return res.status(400).json({ success: false, error: `symbol must be one of: ${ALLOWED_SYMBOLS.join(', ')}` })
  if (!from || !DATE_RE.test(from))
    return res.status(400).json({ success: false, error: 'from must be YYYY-MM-DD' })
  if (!to || !DATE_RE.test(to))
    return res.status(400).json({ success: false, error: 'to must be YYYY-MM-DD' })
  if (from > to)
    return res.status(400).json({ success: false, error: 'from must be <= to' })

  const fromDate = new Date(from + 'T00:00:00Z')
  const toDate   = new Date(to   + 'T23:59:59Z')

  const sv = await getActiveStrategyVersion('Crossfire')
  if (!sv) return res.status(400).json({ success: false, error: 'No active Crossfire strategy version — run action=seed-strategies first.' })
  const settings = sv.settingsJson as unknown as CrossfireSettings

  const pipelineStart = Date.now()
  const steps: PipelineStep[] = []

  async function runStep<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
    const t0 = Date.now()
    try {
      const data = await fn()
      steps.push({ step: name, status: 'completed', durationMs: Date.now() - t0, data: data as Record<string, unknown> })
      return data
    } catch (err) {
      steps.push({ step: name, status: 'failed', durationMs: Date.now() - t0, error: err instanceof Error ? err.message : String(err) })
      return null
    }
  }

  function abortWith(reason: string) {
    return res.status(200).json({
      success: false,
      error:   reason,
      data:    { symbol, from, to, backtestRunId: null, steps, totalDurationMs: Date.now() - pipelineStart, completedAt: new Date().toISOString() },
    })
  }

  // ── Step 1: Import M15 if needed ─────────────────────────────────────────
  {
    const [cov] = await computeCoverage([symbol], ['M15'], fromDate, toDate)
    if (cov.needsImport) {
      const r = await runStep('import-m15', () => ingestCandles(symbol, 'M15', fromDate, toDate))
      if (r === null) return abortWith('M15 import failed — cannot run setup detection without M15 candles')
    } else {
      steps.push({ step: 'import-m15', status: 'skipped', durationMs: 0, data: { reason: `${cov.coveragePct}% coverage — ${cov.actualCount} candles already stored` } })
    }
  }

  // ── Step 2: Import M5 if needed ──────────────────────────────────────────
  {
    const [cov] = await computeCoverage([symbol], ['M5'], fromDate, toDate)
    if (cov.needsImport) {
      const r = await runStep('import-m5', () => ingestCandles(symbol, 'M5', fromDate, toDate))
      if (r === null) return abortWith('M5 import failed — cannot run backtest without M5 candles')
    } else {
      steps.push({ step: 'import-m5', status: 'skipped', durationMs: 0, data: { reason: `${cov.coveragePct}% coverage — ${cov.actualCount} candles already stored` } })
    }
  }

  // ── Step 3: Setup detection (M15) ────────────────────────────────────────
  {
    const r = await runStep('setup-detection', () => runSetupDetectionForRange(symbol, sv.id, fromDate, toDate))
    if (r === null) return abortWith('Setup detection failed — cannot run backtest without setups')
  }

  // ── Step 4: Backtest (M5 signals + trade simulation) ─────────────────────
  let backtestRunId: string | null = null
  {
    const r = await runStep('backtest', () => pipelineRunBacktest(symbol, sv.id, settings, fromDate, toDate, from, to))
    if (r === null) return abortWith('Backtest failed')
    backtestRunId = r.backtestRunId
  }

  // ── Step 5: Trade path analysis — non-fatal ───────────────────────────────
  if (backtestRunId) {
    await runStep('path-analysis', () => pipelineRunPathAnalysis(backtestRunId!, symbol))
  }

  // ── Step 6: Analytics — non-fatal ────────────────────────────────────────
  if (backtestRunId) {
    await runStep('analytics', () => pipelineRunAnalytics(backtestRunId!))
  }

  // ── Step 7: FTMO evaluation — non-fatal ──────────────────────────────────
  if (backtestRunId) {
    await runStep('ftmo', () => pipelineRunFtmo(backtestRunId!, sv.id, settings.riskReward))
  }

  return res.status(200).json({
    success: true,
    data: {
      symbol, from, to,
      strategyVersionId: sv.id,
      backtestRunId,
      steps,
      totalDurationMs: Date.now() - pipelineStart,
      completedAt:     new Date().toISOString(),
    },
  })
}

// ── Pipeline step helpers ──────────────────────────────────────────────────
// Extracted so handleRunPipeline stays readable. Each helper is a thin wrapper
// around the same logic used in the individual action handlers.

async function pipelineRunBacktest(
  symbol:   string,
  svId:     string,
  settings: CrossfireSettings,
  fromDate: Date,
  toDate:   Date,
  from:     string,
  to:       string,
): Promise<{ backtestRunId: string; setupsProcessed: number; signalsDetected: number; wins: number; losses: number; opens: number; winRate: number | null }> {
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

    return { backtestRunId: run.id, setupsProcessed: setups.length, signalsDetected: signalCount, wins, losses, opens, winRate }
  } catch (err) {
    await db.backtestRun.update({ where: { id: run.id }, data: { status: 'failed', errorMessage: err instanceof Error ? err.message : String(err) } }).catch(() => {})
    throw err
  }
}

async function pipelineRunPathAnalysis(backtestRunId: string, symbol: string): Promise<{ processed: number }> {
  const trades = await db.trade.findMany({
    where:   { backtestRunId },
    orderBy: { entryTs: 'asc' },
  })
  if (trades.length === 0) return { processed: 0 }

  const minEntryTs = trades[0].entryTs
  const maxExitTs  = trades.reduce<Date>((max, t) => {
    const ts = t.exitTs ?? t.entryTs
    return ts > max ? ts : max
  }, trades[0].exitTs ?? trades[0].entryTs)

  const allCandles = await db.candle.findMany({
    where:   { symbol, timeframe: 'M5', timestampUtc: { gte: minEntryTs, lte: maxExitTs } },
    orderBy: { timestampUtc: 'asc' },
  })

  let processed = 0
  for (const trade of trades) {
    const entryTMs     = trade.entryTs.getTime()
    const exitTMs      = trade.exitTs?.getTime() ?? Infinity
    const tradeCandles = allCandles.filter(c => {
      const ts = c.timestampUtc.getTime()
      return ts > entryTMs && ts <= exitTMs
    })
    const result = computePathAnalysis(trade, tradeCandles)
    await db.tradePathAnalysis.upsert({
      where:  { tradeId: trade.id },
      create: { tradeId: trade.id, ...result },
      update: { ...result },
    })
    processed++
  }
  return { processed }
}

async function pipelineRunAnalytics(backtestRunId: string): Promise<{ summariesGenerated: number; tradeCount: number }> {
  const rawTrades = await db.trade.findMany({
    where:   { backtestRunId },
    orderBy: { entryTs: 'asc' },
    include: {
      pathAnalysis: true,
      signal:       { select: { breakoutType: true } },
    },
  })

  const trades: TradeRecord[] = rawTrades.map(t => ({
    id:           t.id,
    direction:    t.direction,
    entryTs:      t.entryTs,
    result:       t.result,
    profitLossR:  t.profitLossR,
    breakoutType: t.signal?.breakoutType ?? 'unknown',
    pathAnalysis: t.pathAnalysis ? {
      mfeR:               t.pathAnalysis.mfeR,
      maeR:               t.pathAnalysis.maeR,
      reached1r:          t.pathAnalysis.reached1r,
      reached2r:          t.pathAnalysis.reached2r,
      reached3r:          t.pathAnalysis.reached3r,
      timeTo1rMinutes:    t.pathAnalysis.timeTo1rMinutes,
      timeToExitMinutes:  t.pathAnalysis.timeToExitMinutes,
      breakEvenWouldHelp: t.pathAnalysis.breakEvenWouldHelp,
    } : null,
  }))

  const summaries = computeAllSummaries(trades)
  let summariesGenerated = 0
  for (const [summaryType, summaryJson] of Object.entries(summaries)) {
    await db.analyticsSummary.upsert({
      where:  { backtestRunId_summaryType: { backtestRunId, summaryType } },
      create: { backtestRunId, summaryType, summaryJson },
      update: { summaryJson },
    })
    summariesGenerated++
  }
  return { summariesGenerated, tradeCount: trades.length }
}

async function pipelineRunFtmo(backtestRunId: string, strategyVersionId: string, rrRatio: number): Promise<{ tested: number; passCount: number }> {
  const trades = await db.trade.findMany({
    where:   { backtestRunId },
    orderBy: { entryTs: 'asc' },
    select:  { entryTs: true, profitLossR: true },
  })

  const scenarios: FtmoConfig[] = [
    { accountSize: 100_000, riskPercent: 0.01, rrRatio, dailyLossLimit: 0.05, maxDrawdownLimit: 0.10, profitTarget: 0.08 },
    { accountSize: 100_000, riskPercent: 0.01, rrRatio, dailyLossLimit: 0.05, maxDrawdownLimit: 0.10, profitTarget: 0.10 },
  ]

  let passCount = 0
  for (const config of scenarios) {
    const sim = simulateFtmo(trades, config)
    await db.fundedAccountTest.create({
      data: {
        strategyVersionId,
        backtestRunId,
        accountSize:      config.accountSize,
        riskPercent:      config.riskPercent,
        rrRatio:          config.rrRatio,
        dailyLossLimit:   config.dailyLossLimit,
        maxDrawdownLimit: config.maxDrawdownLimit,
        passed:           sim.passed,
        peakBalance:      sim.peakBalance,
        worstDrawdown:    sim.worstDrawdown,
        dailyBreachCount: sim.dailyBreachCount,
        failureReason:    sim.failureReason,
        equityCurveJson:  sim.equityCurveJson as object,
      },
    })
    if (sim.passed) passCount++
  }
  return { tested: scenarios.length, passCount }
}

// ── GET backtest-detail ────────────────────────────────────────────────────
// Full backtest run record, strategy version info, and overall analytics stats
// in one request — used by the Overview tab in the Research Dashboard.

async function handleBacktestDetail(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' })

  const backtestRunId = req.query.backtestRunId ? String(req.query.backtestRunId) : undefined
  if (!backtestRunId) return res.status(400).json({ success: false, error: 'backtestRunId query param is required' })

  const run = await db.backtestRun.findUnique({
    where:   { id: backtestRunId },
    include: { strategyVersion: { include: { strategy: true } } },
  })
  if (!run) return res.status(404).json({ success: false, error: `backtestRunId ${backtestRunId} not found` })

  const [openCount, overallSummary] = await Promise.all([
    db.trade.count({ where: { backtestRunId, result: 'open' } }),
    db.analyticsSummary.findUnique({
      where: { backtestRunId_summaryType: { backtestRunId, summaryType: 'overall' } },
    }),
  ])

  return res.status(200).json({
    success: true,
    data: {
      id:               run.id,
      symbol:           run.symbol,
      timeframe:        run.timeframe,
      fromDate:         run.fromDate,
      toDate:           run.toDate,
      status:           run.status,
      tradeCount:       run.tradeCount,
      winCount:         run.winCount,
      lossCount:        run.lossCount,
      openCount,
      winRate:          run.winRate,
      startedAt:        run.startedAt,
      completedAt:      run.completedAt,
      strategyName:     run.strategyVersion.strategy.name,
      versionNumber:    run.strategyVersion.versionNumber,
      settingsJson:     run.strategyVersion.settingsJson,
      analytics:        (overallSummary?.summaryJson ?? null) as Record<string, unknown> | null,
    },
  })
}

// ── GET trade-list ─────────────────────────────────────────────────────────
// All trades for a backtest run with signal metadata and path analysis.

async function handleTradeList(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' })

  const backtestRunId = req.query.backtestRunId ? String(req.query.backtestRunId) : undefined
  if (!backtestRunId) return res.status(400).json({ success: false, error: 'backtestRunId query param is required' })

  const trades = await db.trade.findMany({
    where:   { backtestRunId },
    orderBy: { entryTs: 'asc' },
    include: {
      signal: {
        include: { setup: { select: { id: true, dateUk: true } } },
      },
      pathAnalysis: true,
    },
  })

  return res.status(200).json({
    success: true,
    data: trades.map(t => ({
      id:                 t.id,
      symbol:             t.symbol,
      direction:          t.direction,
      entryTs:            t.entryTs,
      exitTs:             t.exitTs,
      entryPrice:         t.entryPrice,
      slPrice:            t.slPrice,
      tpPrice:            t.tpPrice,
      exitPrice:          t.exitPrice,
      result:             t.result,
      profitLossR:        t.profitLossR,
      breakoutType:       t.signal?.breakoutType ?? null,
      dateUk:             t.signal?.setup?.dateUk ?? null,
      setupId:            t.signal?.setup?.id ?? null,
      mfeR:               t.pathAnalysis?.mfeR ?? null,
      maeR:               t.pathAnalysis?.maeR ?? null,
      reached1r:          t.pathAnalysis?.reached1r ?? false,
      timeTo1rMinutes:    t.pathAnalysis?.timeTo1rMinutes ?? null,
      timeToExitMinutes:  t.pathAnalysis?.timeToExitMinutes ?? null,
      breakEvenWouldHelp: t.pathAnalysis?.breakEvenWouldHelp ?? false,
    })),
  })
}

// ── GET setup-list ─────────────────────────────────────────────────────────
// All Crossfire setups for a backtest run's symbol + date range.
// Annotated with whether a signal and trade were produced for each setup.

async function handleSetupList(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' })

  const backtestRunId = req.query.backtestRunId ? String(req.query.backtestRunId) : undefined
  if (!backtestRunId) return res.status(400).json({ success: false, error: 'backtestRunId query param is required' })

  const run = await db.backtestRun.findUnique({ where: { id: backtestRunId } })
  if (!run) return res.status(404).json({ success: false, error: `backtestRunId ${backtestRunId} not found` })

  const fromDateStr = run.fromDate.toISOString().slice(0, 10)
  const toDateStr   = run.toDate.toISOString().slice(0, 10)

  const setups = await db.crossfireSetup.findMany({
    where: {
      strategyVersionId: run.strategyVersionId,
      symbol:            run.symbol,
      dateUk:            { gte: fromDateStr, lte: toDateStr },
    },
    orderBy: { dateUk: 'asc' },
    include: {
      signals: {
        include: { trade: { select: { id: true, result: true } } },
      },
    },
  })

  return res.status(200).json({
    success: true,
    data: setups.map(s => ({
      id:                  s.id,
      symbol:              run.symbol,
      dateUk:              s.dateUk,
      setupValid:          s.setupValid,
      invalidReason:       s.invalidReason,
      setupCandleTs:       s.setupCandleTs,
      hhPrice:             s.hhPrice,
      llPrice:             s.llPrice,
      greenLineSlope:      s.greenLineSlope,
      greenLineIntercept:  s.greenLineIntercept,
      redLineSlope:        s.redLineSlope,
      redLineIntercept:    s.redLineIntercept,
      signalDetected:      s.signals.length > 0,
      signalDirection:     s.signals[0]?.direction ?? null,
      tradeCreated:        s.signals.some(sig => sig.trade != null),
      tradeResult:         s.signals.find(sig => sig.trade != null)?.trade?.result ?? null,
    })),
  })
}
