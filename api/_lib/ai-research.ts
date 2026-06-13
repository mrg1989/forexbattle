import type { CrossfireSettings } from './strategy-registry.js'

// ── Input types ────────────────────────────────────────────────────────────

export interface AnalyticsSummaryInput {
  summaryType: string
  summaryJson: unknown
}

export interface FtmoInput {
  profitTarget:     number | null
  passed:           boolean
  peakBalance:      number
  worstDrawdown:    number
  dailyBreachCount: number
  failureReason:    string | null
  finalBalance:     number | null
}

export interface ReviewInput {
  backtestRunId:         string
  strategyVersionNumber: number
  settings:              CrossfireSettings
  summaries:             AnalyticsSummaryInput[]
  ftmoResults:           FtmoInput[]
}

// ── Output types ───────────────────────────────────────────────────────────

export interface ParsedRecommendation {
  filter:               string
  rationale:            string
  proposedSettingChange: Record<string, unknown>
  expectedBenefit:      string
  overfittingRisk:      string
}

// ── Helpers ────────────────────────────────────────────────────────────────

function get(summaries: AnalyticsSummaryInput[], type: string): Record<string, unknown> {
  return (summaries.find(s => s.summaryType === type)?.summaryJson ?? {}) as Record<string, unknown>
}

function fv(v: unknown, suffix = ''): string {
  return v != null ? `${v}${suffix}` : 'n/a'
}

// ── Prompt builder ─────────────────────────────────────────────────────────

// Produces a compact prompt targeting under 1,500 tokens.
// Analytics summaries are formatted as inline stats — not raw JSON blobs.
export function buildPrompt(input: ReviewInput): string {
  const { summaries, ftmoResults, settings, strategyVersionNumber, backtestRunId } = input

  const overall = get(summaries, 'overall')
  const evalS   = get(summaries, 'strategy_evaluation')
  const mfeMae  = get(summaries, 'mfe_mae_summary')
  const byDay   = get(summaries, 'by_day_of_week')
  const byHour  = get(summaries, 'by_entry_hour')
  const byBreak = get(summaries, 'by_breakout_type')

  const dayLine = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
    .map(d => {
      const s = (byDay[d] ?? {}) as Record<string, unknown>
      return `${d.slice(0, 3)}: ${fv(s.winRatePct, '%')} (n=${s.decided ?? 0})`
    })
    .join(' | ')

  const hourLine = ['13', '14', '15']
    .map(h => {
      const s = (byHour[h] ?? {}) as Record<string, unknown>
      return `${h}:xx: ${fv(s.winRatePct, '%')} (n=${s.decided ?? 0})`
    })
    .join(' | ')

  const btEntries = Object.entries(byBreak)
  const btLine = btEntries.length > 0
    ? btEntries
        .map(([bt, s]) => `${bt}: ${fv((s as Record<string, unknown>).winRatePct, '%')} (n=${(s as Record<string, unknown>).decided ?? 0})`)
        .join(' | ')
    : 'no data'

  const ftmoLines = ftmoResults.length > 0
    ? ftmoResults
        .sort((a, b) => (a.profitTarget ?? 0) - (b.profitTarget ?? 0))
        .map(f => {
          const tgt = f.profitTarget != null ? `${(f.profitTarget * 100).toFixed(0)}%` : '?%'
          return `  ${tgt}: ${f.passed ? 'PASS' : 'FAIL'} (peak £${Math.round(f.peakBalance).toLocaleString()}, worst DD £${Math.round(f.worstDrawdown).toLocaleString()}, daily breaches: ${f.dailyBreachCount})`
        })
        .join('\n')
    : '  No FTMO data available'

  // Compact settings — omit verbose/redundant fields to save tokens
  const compact = {
    symbol:             settings.symbol,
    riskReward:         settings.riskReward,
    entryMode:          settings.entryMode,
    stopLossMode:       settings.stopLossMode,
    breakEvenAtR:       settings.breakEvenAtR,
    maxTradesPerDay:    settings.maxTradesPerDay,
    allowWickBreak:     settings.allowWickBreak,
    tradingWindowEndUK: settings.tradingWindowEndUK,
  }

  return `You are a trading strategy research analyst reviewing historical backtest data.

GUARDRAILS (strictly enforced):
- Suggest testable hypotheses only — do not recommend live trading
- Flag any finding with fewer than 30 trades as low-confidence; state the sample size
- Do not claim certainty from small samples
- Each suggested filter must be independently verifiable on a separate dataset
- You cannot change strategy settings — only humans can approve changes after review

STRATEGY: Crossfire v${strategyVersionNumber} — ${settings.symbol}
Entry: M5 candle close beyond M15 trendline drawn from 08:00–13:00 UK session high/low.
Entry window: 13:00–16:00 UK. Max 1 trade per day. Risk/reward: 1:${settings.riskReward}.

BACKTEST RESULTS (id: ${backtestRunId})
Decided trades: ${overall.decidedTrades ?? 0} — wins: ${overall.wins ?? 0}, losses: ${overall.losses ?? 0}, open/expired: ${overall.opens ?? 0}
Win rate: ${fv(overall.winRatePct, '%')} | Expectancy: ${fv(overall.expectancy)}R | Profit factor: ${fv(overall.profitFactor)}
Total R: ${fv(overall.totalR)} | Max drawdown: ${fv(evalS.maxDrawdownR)}R
Losing streak: ${evalS.longestLosingStreak ?? 'n/a'} max | Winning streak: ${evalS.longestWinningStreak ?? 'n/a'} max
Avg trade duration: ${fv(overall.avgTradeDurationMinutes)} min | Avg time to 1R: ${fv(overall.avgTimeTo1rMinutes)} min

PATH ANALYSIS (n=${mfeMae.tradesWithPathAnalysis ?? 0} trades with data)
Reached 1R: ${fv(mfeMae.pctReaching1r, '%')} | 2R: ${fv(mfeMae.pctReaching2r, '%')} | 3R: ${fv(mfeMae.pctReaching3r, '%')} | 4R: ${fv(mfeMae.pctReaching4r, '%')} | 5R: ${fv(mfeMae.pctReaching5r, '%')}
Avg MFE: ${fv(mfeMae.avgMfeR)}R (wins: ${fv(mfeMae.avgMfeRForWins)}R) | Avg MAE: ${fv(mfeMae.avgMaeR)}R (losses: ${fv(mfeMae.avgMaeRForLosses)}R)
Break-even at 1R would save: ${fv(mfeMae.breakEvenWouldHelpPct, '%')} of losing trades

BY DAY: ${dayLine}
BY SESSION HOUR: ${hourLine}
BY BREAKOUT TYPE: ${btLine}

FTMO SIMULATION (£100k account, 1% fixed risk, 5% daily limit, 10% max drawdown):
${ftmoLines}

CURRENT SETTINGS: ${JSON.stringify(compact)}

---
Based only on the data above, suggest up to 5 testable filters or rule adjustments that could improve strategy robustness. Return ONLY a valid JSON array — no other text before or after.

Each element must follow this exact schema:
{
  "filter": "one-line description of the change",
  "rationale": "specific evidence from the data above — cite numbers",
  "proposedSettingChange": { "fieldName": "newValue" },
  "expectedBenefit": "which metric should improve and why",
  "overfittingRisk": "low|medium|high — one sentence explaining why"
}`
}

// ── Recommendation parser ──────────────────────────────────────────────────

// Extracts a JSON array from Claude's response text. Tolerates markdown code fences
// and leading/trailing prose. Returns empty array on any parse failure.
export function parseRecommendations(text: string, maxCount = 5): ParsedRecommendation[] {
  // Strip markdown code fences
  const cleaned = text.replace(/```(?:json)?\s*/g, '').trim()

  const match = cleaned.match(/\[[\s\S]*\]/)
  if (!match) return []

  let arr: unknown[]
  try {
    arr = JSON.parse(match[0])
  } catch {
    return []
  }

  if (!Array.isArray(arr)) return []

  return arr.slice(0, maxCount).flatMap(item => {
    if (typeof item !== 'object' || item === null) return []
    const r = item as Record<string, unknown>
    if (!r.filter || typeof r.filter !== 'string') return []
    return [{
      filter:               r.filter,
      rationale:            String(r.rationale ?? ''),
      proposedSettingChange: (typeof r.proposedSettingChange === 'object' && r.proposedSettingChange !== null)
        ? (r.proposedSettingChange as Record<string, unknown>)
        : {},
      expectedBenefit:      String(r.expectedBenefit ?? r.expected_benefit ?? ''),
      overfittingRisk:      String(r.overfittingRisk ?? r.overfitting_risk ?? ''),
    }]
  })
}
