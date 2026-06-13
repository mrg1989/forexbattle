import { useState, useEffect, useCallback, type ComponentType } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import {
  ArrowLeft, BarChart3, TrendingUp, Bot, List,
  Copy, Check, X, Loader2, AlertCircle, Zap,
  ChevronDown, ChevronUp, RefreshCw,
  Database, Play, CheckCircle2, SkipForward, XCircle, Clock,
} from 'lucide-react'
import { adminApi } from '../lib/adminApi'
import type {
  BacktestRun, AnalyticsSummary, FtmoResult,
  AiReview, Recommendation, PromptData,
  CoverageRow, ImportPlanResult, PipelineResult, PipelineStep,
} from '../lib/adminApi'

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtPct(v: unknown) {
  if (v == null) return '—'
  return `${Number(v).toFixed(1)}%`
}

function fmtR(v: unknown) {
  if (v == null) return '—'
  const n = Number(v)
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}R`
}

function fmtN(v: unknown, dp = 2) {
  if (v == null) return '—'
  return Number(v).toFixed(dp)
}

function fmtCurrency(v: unknown) {
  if (v == null) return '—'
  return `£${Math.round(Number(v)).toLocaleString()}`
}

function winColor(pct: unknown): string {
  const n = Number(pct)
  if (isNaN(n)) return 'text-btl-muted'
  if (n >= 55) return 'text-btl-up'
  if (n >= 45) return 'text-btl-gold'
  return 'text-btl-down'
}

function getSummary(summaries: AnalyticsSummary[], type: string): Record<string, unknown> {
  return (summaries.find(s => s.summaryType === type)?.summaryJson ?? {}) as Record<string, unknown>
}

// ── Small components ───────────────────────────────────────────────────────

function Spinner({ size = 4 }: { size?: number }) {
  return <Loader2 className={clsx(`w-${size} h-${size} animate-spin text-btl-muted`)} />
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 px-4 py-3 rounded-xl bg-btl-down/10 border border-btl-down/25 text-btl-down text-sm">
      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-16 text-btl-muted text-sm">
      {message}
    </div>
  )
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="glass-md rounded-xl p-4 flex flex-col gap-1">
      <span className="text-xs text-btl-muted uppercase tracking-wide">{label}</span>
      <span className={clsx('text-2xl font-bold tabular', color ?? 'text-btl-text')}>{value}</span>
      {sub && <span className="text-xs text-btl-muted">{sub}</span>}
    </div>
  )
}

type BadgeStatus = 'suggested' | 'approved' | 'rejected' | 'tested'
const BADGE_STYLES: Record<BadgeStatus, string> = {
  suggested: 'bg-btl-gold/15 text-btl-gold border-btl-gold/30',
  approved:  'bg-btl-up/15 text-btl-up border-btl-up/30',
  rejected:  'bg-btl-down/15 text-btl-down border-btl-down/30',
  tested:    'bg-btl-teal/15 text-btl-teal border-btl-teal/25',
}

function StatusBadge({ status }: { status: string }) {
  const style = BADGE_STYLES[status as BadgeStatus] ?? 'bg-btl-faint text-btl-muted border-btl-border'
  return (
    <span className={clsx('inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border', style)}>
      {status}
    </span>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      onClick={copy}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium glass-md text-btl-muted hover:text-btl-text transition-colors"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-btl-up" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? 'Copied' : 'Copy prompt'}
    </button>
  )
}

function TabButton({ active, onClick, icon: Icon, label }: {
  active: boolean; onClick: () => void; icon: ComponentType<{ className?: string }>; label: string
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
        active
          ? 'border-btl-purple text-btl-text'
          : 'border-transparent text-btl-muted hover:text-btl-text hover:border-btl-border',
      )}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  )
}

// ── Prompt Modal ───────────────────────────────────────────────────────────

function PromptModal({
  data,
  backtestRunId,
  onClose,
  onSaved,
}: {
  data: PromptData
  backtestRunId: string
  onClose: () => void
  onSaved: () => void
}) {
  const [response, setResponse] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveResult, setSaveResult] = useState<{ reviewId: string; recommendationCount: number } | null>(null)

  const save = async () => {
    if (!response.trim()) return
    setSaving(true)
    setSaveError(null)
    try {
      const result = await adminApi.saveAiReview(backtestRunId, response.trim(), 'manual')
      setSaveResult(result)
      onSaved()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-btl-bg/80 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-2xl glass-strong rounded-2xl card-shadow-lg flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-btl-border shrink-0">
          <div>
            <h2 className="font-semibold text-btl-text">AI Research Prompt</h2>
            <p className="text-xs text-btl-muted mt-0.5">
              {data.summaryCount} summaries · {data.ftmoResultCount} FTMO results
            </p>
          </div>
          <button onClick={onClose} className="text-btl-muted hover:text-btl-text transition-colors p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-5">
          {/* Prompt section */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-btl-muted uppercase tracking-wide">Prompt</span>
              <CopyButton text={data.prompt} />
            </div>
            <textarea
              readOnly
              value={data.prompt}
              rows={10}
              className="w-full bg-btl-bg/60 border border-btl-border rounded-xl px-3 py-3 text-xs font-mono text-btl-muted resize-none focus:outline-none"
            />
          </div>

          <div className="divider" />

          {/* Response section */}
          {saveResult ? (
            <div className="flex items-start gap-3 px-4 py-4 rounded-xl bg-btl-up/10 border border-btl-up/25">
              <Check className="w-5 h-5 text-btl-up mt-0.5 shrink-0" />
              <div>
                <p className="text-btl-up font-medium text-sm">Review saved</p>
                <p className="text-btl-muted text-xs mt-1">
                  {saveResult.recommendationCount} recommendation{saveResult.recommendationCount !== 1 ? 's' : ''} stored with status <strong>suggested</strong>.
                  Check the Recommendations tab.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-btl-muted uppercase tracking-wide">
                Paste Claude's response
              </span>
              <textarea
                value={response}
                onChange={e => setResponse(e.target.value)}
                rows={8}
                placeholder='Paste the JSON array from Claude here…'
                className="w-full bg-btl-bg/60 border border-btl-border rounded-xl px-3 py-3 text-sm text-btl-text resize-none focus:outline-none focus:border-btl-purple/50 transition-colors placeholder:text-btl-faint"
              />
              {saveError && <ErrorBanner message={saveError} />}
            </div>
          )}
        </div>

        {/* Modal footer */}
        {!saveResult && (
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-btl-border shrink-0">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm text-btl-muted hover:text-btl-text transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={!response.trim() || saving}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold bg-btl-purple text-white hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {saving && <Spinner size={3} />}
              Save Review
            </button>
          </div>
        )}
        {saveResult && (
          <div className="flex justify-end px-6 py-4 border-t border-btl-border shrink-0">
            <button
              onClick={onClose}
              className="px-5 py-2 rounded-xl text-sm font-semibold bg-btl-purple text-white hover:bg-purple-500 transition-colors"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Analytics Panel ────────────────────────────────────────────────────────

function AnalyticsPanel({ summaries, loading }: { summaries: AnalyticsSummary[]; loading: boolean }) {
  if (loading) return <div className="flex justify-center py-16"><Spinner size={6} /></div>
  if (!summaries.length) return <EmptyState message="No analytics summaries. Run action=run-analytics first." />

  const overall  = getSummary(summaries, 'overall')
  const evalS    = getSummary(summaries, 'strategy_evaluation')
  const mfeMae   = getSummary(summaries, 'mfe_mae_summary')
  const byDay    = getSummary(summaries, 'by_day_of_week')
  const byHour   = getSummary(summaries, 'by_entry_hour')
  const byBreak  = getSummary(summaries, 'by_breakout_type')

  const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
  const DAY_LABELS: Record<string, string> = {
    monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri',
  }
  const HOUR_KEYS = ['13', '14', '15']

  return (
    <div className="flex flex-col gap-6">
      {/* Overall performance */}
      <section>
        <h3 className="text-xs font-semibold text-btl-muted uppercase tracking-wider mb-3">Overall Performance</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Win Rate" value={fmtPct(overall.winRatePct)} sub={`${overall.wins ?? 0}W / ${overall.losses ?? 0}L`} color={winColor(overall.winRatePct)} />
          <StatCard label="Expectancy" value={fmtR(overall.expectancy)} color={Number(overall.expectancy) >= 0 ? 'text-btl-up' : 'text-btl-down'} />
          <StatCard label="Profit Factor" value={fmtN(overall.profitFactor)} color={Number(overall.profitFactor) >= 1.5 ? 'text-btl-up' : 'text-btl-muted'} />
          <StatCard label="Total R" value={fmtR(overall.totalR)} color={Number(overall.totalR) >= 0 ? 'text-btl-up' : 'text-btl-down'} />
          <StatCard label="Decided Trades" value={String(overall.decidedTrades ?? overall.totalTrades ?? '—')} sub={`${overall.opens ?? 0} open/expired`} />
          <StatCard label="Avg Duration" value={overall.avgTradeDurationMinutes != null ? `${Math.round(Number(overall.avgTradeDurationMinutes))}m` : '—'} sub={overall.avgTimeTo1rMinutes != null ? `1R in ${Math.round(Number(overall.avgTimeTo1rMinutes))}m` : undefined} />
        </div>
      </section>

      {/* Strategy evaluation */}
      {Object.keys(evalS).length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-btl-muted uppercase tracking-wider mb-3">Risk & Streaks</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard label="Max Drawdown" value={fmtR(evalS.maxDrawdownR)} color="text-btl-down" />
            <StatCard label="Max Runup" value={fmtR(evalS.maxRunupR)} color="text-btl-up" />
            <StatCard label="Avg Win" value={fmtR(evalS.avgWinR)} color="text-btl-up" />
            <StatCard label="Avg Loss" value={fmtR(evalS.avgLossR)} color="text-btl-down" />
            <StatCard label="Best Streak" value={String(evalS.longestWinningStreak ?? '—')} sub="wins" color="text-btl-up" />
            <StatCard label="Worst Streak" value={String(evalS.longestLosingStreak ?? '—')} sub="losses" color="text-btl-down" />
          </div>
        </section>
      )}

      {/* Path analysis */}
      {Object.keys(mfeMae).length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-btl-muted uppercase tracking-wider mb-3">
            Path Analysis <span className="text-btl-faint font-normal normal-case">({String(mfeMae.tradesWithPathAnalysis ?? 0)} trades)</span>
          </h3>
          <div className="glass-md rounded-xl p-4 flex flex-col gap-4">
            {/* R milestones */}
            <div className="flex flex-col gap-2">
              {([['1R', 'pctReaching1r'], ['2R', 'pctReaching2r'], ['3R', 'pctReaching3r'], ['4R', 'pctReaching4r'], ['5R', 'pctReaching5r']] as [string, string][]).map(([label, key]) => {
                const pct = Number(mfeMae[key] ?? 0)
                return (
                  <div key={key} className="flex items-center gap-3">
                    <span className="text-xs text-btl-muted w-6 tabular">{label}</span>
                    <div className="flex-1 h-1.5 bg-btl-faint rounded-full overflow-hidden">
                      <div className="h-full bg-btl-purple rounded-full" style={{ width: `${Math.min(pct, 100)}%` }} />
                    </div>
                    <span className="text-xs text-btl-text tabular w-10 text-right">{fmtPct(pct)}</span>
                  </div>
                )
              })}
            </div>
            <div className="divider" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="Avg MFE" value={`${fmtN(mfeMae.avgMfeR)}R`} sub={`wins: ${fmtN(mfeMae.avgMfeRForWins)}R`} color="text-btl-up" />
              <StatCard label="Avg MAE" value={`${fmtN(mfeMae.avgMaeR)}R`} sub={`losses: ${fmtN(mfeMae.avgMaeRForLosses)}R`} color="text-btl-down" />
              <StatCard label="BE Would Help" value={fmtPct(mfeMae.breakEvenWouldHelpPct)} sub="of losing trades" color="text-btl-gold" />
              <StatCard label="Reaches 3R" value={fmtPct(mfeMae.pctReaching3r)} sub="before exit" />
            </div>
          </div>
        </section>
      )}

      {/* Breakdowns */}
      <section>
        <h3 className="text-xs font-semibold text-btl-muted uppercase tracking-wider mb-3">Breakdowns</h3>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* By day */}
          <div className="glass-md rounded-xl p-4">
            <p className="text-xs text-btl-muted font-medium mb-3">By Day of Week</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-btl-muted">
                  <th className="text-left pb-2 font-normal">Day</th>
                  <th className="text-right pb-2 font-normal">Win%</th>
                  <th className="text-right pb-2 font-normal">n</th>
                </tr>
              </thead>
              <tbody>
                {DAY_KEYS.map(d => {
                  const row = (byDay[d] ?? {}) as Record<string, unknown>
                  const n = Number(row.decided ?? 0)
                  return (
                    <tr key={d} className="border-t border-btl-border/40">
                      <td className="py-1.5 text-btl-text">{DAY_LABELS[d]}</td>
                      <td className={clsx('py-1.5 text-right tabular', winColor(row.winRatePct))}>{fmtPct(row.winRatePct)}</td>
                      <td className="py-1.5 text-right text-btl-muted tabular">{n || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* By hour */}
          <div className="glass-md rounded-xl p-4">
            <p className="text-xs text-btl-muted font-medium mb-3">By Entry Hour (UK)</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-btl-muted">
                  <th className="text-left pb-2 font-normal">Hour</th>
                  <th className="text-right pb-2 font-normal">Win%</th>
                  <th className="text-right pb-2 font-normal">n</th>
                </tr>
              </thead>
              <tbody>
                {HOUR_KEYS.map(h => {
                  const row = (byHour[h] ?? {}) as Record<string, unknown>
                  const n = Number(row.decided ?? 0)
                  return (
                    <tr key={h} className="border-t border-btl-border/40">
                      <td className="py-1.5 text-btl-text">{h}:xx</td>
                      <td className={clsx('py-1.5 text-right tabular', winColor(row.winRatePct))}>{fmtPct(row.winRatePct)}</td>
                      <td className="py-1.5 text-right text-btl-muted tabular">{n || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* By breakout type */}
          <div className="glass-md rounded-xl p-4">
            <p className="text-xs text-btl-muted font-medium mb-3">By Breakout Type</p>
            {Object.keys(byBreak).length === 0 ? (
              <p className="text-xs text-btl-muted">No data</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-btl-muted">
                    <th className="text-left pb-2 font-normal">Type</th>
                    <th className="text-right pb-2 font-normal">Win%</th>
                    <th className="text-right pb-2 font-normal">n</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(byBreak).map(([bt, s]) => {
                    const row = s as Record<string, unknown>
                    const n = Number(row.decided ?? 0)
                    const label = bt.replace(/_/g, ' ')
                    return (
                      <tr key={bt} className="border-t border-btl-border/40">
                        <td className="py-1.5 text-btl-text text-xs capitalize">{label}</td>
                        <td className={clsx('py-1.5 text-right tabular', winColor(row.winRatePct))}>{fmtPct(row.winRatePct)}</td>
                        <td className="py-1.5 text-right text-btl-muted tabular">{n || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

// ── FTMO Panel ─────────────────────────────────────────────────────────────

function FtmoPanel({ results, loading }: { results: FtmoResult[]; loading: boolean }) {
  if (loading) return <div className="flex justify-center py-16"><Spinner size={6} /></div>
  if (!results.length) return <EmptyState message="No FTMO results. Run action=run-ftmo-evaluation first." />

  const sorted = [...results].sort((a, b) => (a.profitTarget ?? 0) - (b.profitTarget ?? 0))
  const byTarget = new Map<number, FtmoResult[]>()
  for (const r of sorted) {
    const k = r.profitTarget ?? 0
    if (!byTarget.has(k)) byTarget.set(k, [])
    byTarget.get(k)!.push(r)
  }

  return (
    <div className="flex flex-col gap-4">
      {[...byTarget.entries()].map(([target, rows]) => {
        const latest = rows[0]
        const tgtLabel = `${(target * 100).toFixed(0)}% target`
        return (
          <div
            key={target}
            className={clsx(
              'glass-md rounded-2xl p-5 border',
              latest.passed ? 'border-btl-up/30' : 'border-btl-down/20',
            )}
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-semibold text-btl-text capitalize">{tgtLabel}</h3>
                <p className="text-xs text-btl-muted mt-0.5">
                  £{latest.accountSize.toLocaleString()} · {(latest.riskPercent * 100).toFixed(0)}% risk/trade ·
                  {' '}{(latest.dailyLossLimit * 100).toFixed(0)}% daily limit ·
                  {' '}{(latest.maxDrawdownLimit * 100).toFixed(0)}% max DD
                </p>
              </div>
              <span className={clsx(
                'px-3 py-1 rounded-full text-sm font-bold',
                latest.passed
                  ? 'bg-btl-up/15 text-btl-up border border-btl-up/30'
                  : 'bg-btl-down/15 text-btl-down border border-btl-down/30',
              )}>
                {latest.passed ? 'PASS' : 'FAIL'}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="Final Balance" value={fmtCurrency(latest.finalBalance)} color={latest.passed ? 'text-btl-up' : 'text-btl-muted'} />
              <StatCard label="Peak Balance" value={fmtCurrency(latest.peakBalance)} color="text-btl-up" />
              <StatCard label="Worst Drawdown" value={fmtCurrency(latest.worstDrawdown)} color="text-btl-down" />
              <StatCard label="Daily Breaches" value={String(latest.dailyBreachCount)} color={latest.dailyBreachCount > 0 ? 'text-btl-down' : 'text-btl-up'} />
            </div>

            {latest.failureReason && !latest.passed && (
              <p className="mt-3 text-xs text-btl-down/80">
                Failure reason: <span className="font-mono">{latest.failureReason}</span>
              </p>
            )}

            {rows.length > 1 && (
              <p className="mt-2 text-xs text-btl-muted">{rows.length} runs — showing most recent</p>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── AI Review Panel ────────────────────────────────────────────────────────

function AiPanel({
  backtestRunId,
  summaries,
  reviews,
  loading,
  onReviewSaved,
}: {
  backtestRunId: string
  summaries: AnalyticsSummary[]
  reviews: AiReview[]
  loading: boolean
  onReviewSaved: () => void
}) {
  const [generating, setGenerating] = useState(false)
  const [promptData, setPromptData] = useState<PromptData | null>(null)
  const [genError, setGenError] = useState<string | null>(null)
  const hasAnalytics = summaries.length > 0

  const generate = async () => {
    setGenerating(true)
    setGenError(null)
    try {
      const data = await adminApi.generatePrompt(backtestRunId)
      setPromptData(data)
    } catch (e) {
      setGenError(e instanceof Error ? e.message : 'Failed to generate prompt')
    } finally {
      setGenerating(false)
    }
  }

  const handleSaved = () => {
    onReviewSaved()
  }

  if (loading) return <div className="flex justify-center py-16"><Spinner size={6} /></div>

  return (
    <div className="flex flex-col gap-6">
      {/* Generate prompt section */}
      <div className="glass-md rounded-2xl p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-semibold text-btl-text">Generate AI Research Prompt</h3>
            <p className="text-sm text-btl-muted mt-1">
              Builds a compact analytics prompt (~1,200 tokens) from the summaries and FTMO results for this run.
              Copy it into claude.ai, then paste the response back here.
            </p>
            {!hasAnalytics && (
              <p className="mt-2 text-xs text-btl-gold">
                Requires analytics summaries — run <span className="font-mono">action=run-analytics</span> first.
              </p>
            )}
          </div>
          <button
            onClick={generate}
            disabled={!hasAnalytics || generating}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-btl-purple text-white hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            {generating ? <Spinner size={4} /> : <Zap className="w-4 h-4" />}
            Generate prompt
          </button>
        </div>
        {genError && <div className="mt-3"><ErrorBanner message={genError} /></div>}
      </div>

      {/* Review history */}
      <section>
        <h3 className="text-xs font-semibold text-btl-muted uppercase tracking-wider mb-3">
          Review History ({reviews.length})
        </h3>
        {reviews.length === 0 ? (
          <EmptyState message="No reviews yet. Generate a prompt above and paste the response." />
        ) : (
          <div className="flex flex-col gap-2">
            {reviews.map(r => (
              <div key={r.id} className="glass-md rounded-xl px-4 py-3 flex items-center gap-4">
                <Bot className="w-5 h-5 text-btl-purple shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-btl-text font-mono truncate">{r.aiModel}</p>
                  <p className="text-xs text-btl-muted">{fmtDate(r.createdAt)}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold text-btl-text">{r.recommendationCount}</p>
                  <p className="text-xs text-btl-muted">recs</p>
                </div>
                {r.tokenCount != null && (
                  <div className="text-right shrink-0">
                    <p className="text-xs text-btl-muted tabular">{r.tokenCount.toLocaleString()} tokens</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Prompt modal */}
      {promptData && (
        <PromptModal
          data={promptData}
          backtestRunId={backtestRunId}
          onClose={() => setPromptData(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}

// ── Recommendations Panel ──────────────────────────────────────────────────

function RecsPanel({ recommendations, loading }: { recommendations: Recommendation[]; loading: boolean }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  if (loading) return <div className="flex justify-center py-16"><Spinner size={6} /></div>
  if (!recommendations.length) return <EmptyState message="No recommendations yet. Complete an AI review first." />

  const grouped = recommendations.reduce<Record<string, Recommendation[]>>((acc, r) => {
    const group = r.status
    ;(acc[group] ??= []).push(r)
    return acc
  }, {})

  const ORDER: Array<'suggested' | 'approved' | 'tested' | 'rejected'> = ['suggested', 'approved', 'tested', 'rejected']

  return (
    <div className="flex flex-col gap-6">
      {ORDER.filter(s => grouped[s]?.length).map(status => (
        <section key={status}>
          <div className="flex items-center gap-2 mb-3">
            <StatusBadge status={status} />
            <span className="text-xs text-btl-muted">{grouped[status].length}</span>
          </div>
          <div className="flex flex-col gap-2">
            {grouped[status].map(r => {
              const isOpen = expanded.has(r.id)
              const firstLine = r.rationale.split('\n')[0]
              return (
                <div key={r.id} className="glass-md rounded-xl overflow-hidden">
                  <button
                    onClick={() => toggle(r.id)}
                    className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-btl-text">{firstLine}</p>
                      {!isOpen && (
                        <p className="text-xs text-btl-muted mt-0.5 truncate">{r.expectedBenefit}</p>
                      )}
                    </div>
                    <div className="shrink-0 text-btl-muted mt-0.5">
                      {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </div>
                  </button>

                  {isOpen && (
                    <div className="px-4 pb-4 flex flex-col gap-3 border-t border-btl-border/40">
                      <div className="pt-3">
                        <p className="text-xs text-btl-muted font-medium mb-1">Rationale</p>
                        <p className="text-sm text-btl-text whitespace-pre-wrap">{r.rationale}</p>
                      </div>
                      <div>
                        <p className="text-xs text-btl-muted font-medium mb-1">Expected Benefit</p>
                        <p className="text-sm text-btl-text">{r.expectedBenefit}</p>
                      </div>
                      <div>
                        <p className="text-xs text-btl-muted font-medium mb-1">Proposed Settings Change</p>
                        <pre className="text-xs font-mono text-btl-muted bg-btl-bg/60 rounded-lg p-3 overflow-x-auto">
                          {JSON.stringify(r.proposedSettingsJson, null, 2)}
                        </pre>
                      </div>
                      <p className="text-xs text-btl-muted">{fmtDate(r.createdAt)}</p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

// ── Pipeline Panel ─────────────────────────────────────────────────────────

const SYMBOLS = ['EUR_USD', 'GBP_USD']

const TIMEFRAME_ORDER = ['M5', 'M15', 'H1', 'H4', 'D1']

function coverageBadge(row: CoverageRow) {
  if (!row.supported) return <span className="text-xs text-btl-faint">planned</span>
  if (!row.hasData)   return <span className="text-xs text-btl-down font-medium">no data</span>
  const color = row.coveragePct >= 90
    ? 'text-btl-up'
    : row.coveragePct >= 60
      ? 'text-btl-gold'
      : 'text-btl-down'
  return <span className={clsx('text-xs font-semibold tabular', color)}>{row.coveragePct.toFixed(1)}%</span>
}

function stepIcon(status: PipelineStep['status']) {
  if (status === 'completed') return <CheckCircle2 className="w-4 h-4 text-btl-up shrink-0" />
  if (status === 'skipped')   return <SkipForward className="w-4 h-4 text-btl-muted shrink-0" />
  return <XCircle className="w-4 h-4 text-btl-down shrink-0" />
}

function fmtDuration(ms: number) {
  if (ms === 0)    return '—'
  if (ms < 1000)   return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms / 1000 / 60)}m ${Math.round((ms / 1000) % 60)}s`
}

function PipelinePanel() {
  const [symbol, setSymbol]               = useState('EUR_USD')
  const [from, setFrom]                   = useState('')
  const [to, setTo]                       = useState('')
  const [coverageLoading, setCoverageLoading] = useState(false)
  const [coverageError, setCoverageError] = useState<string | null>(null)
  const [coverageData, setCoverageData]   = useState<ImportPlanResult | null>(null)
  const [running, setRunning]             = useState(false)
  const [runError, setRunError]           = useState<string | null>(null)
  const [result, setResult]               = useState<PipelineResult | null>(null)

  const checkCoverage = async () => {
    if (!from || !to) return
    setCoverageLoading(true)
    setCoverageError(null)
    setCoverageData(null)
    setResult(null)
    try {
      const data = await adminApi.getImportPlan(from, to, symbol)
      setCoverageData(data)
    } catch (e) {
      setCoverageError(e instanceof Error ? e.message : 'Failed to load coverage')
    } finally {
      setCoverageLoading(false)
    }
  }

  const runPipeline = async () => {
    if (!from || !to) return
    setRunning(true)
    setRunError(null)
    setResult(null)
    try {
      const data = await adminApi.runPipeline(symbol, from, to)
      setResult(data)
    } catch (e) {
      setRunError(e instanceof Error ? e.message : 'Pipeline failed')
    } finally {
      setRunning(false)
    }
  }

  const sorted = coverageData
    ? TIMEFRAME_ORDER.map(tf => coverageData.coverage.find(r => r.timeframe === tf)).filter(Boolean) as CoverageRow[]
    : []

  return (
    <div className="flex flex-col gap-6">
      {/* Config */}
      <div className="glass-md rounded-2xl p-5">
        <h3 className="font-semibold text-btl-text mb-4">Data Coverage &amp; Pipeline</h3>
        <div className="flex flex-wrap gap-3 items-end">
          {/* Symbol */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-btl-muted">Symbol</label>
            <select
              value={symbol}
              onChange={e => { setSymbol(e.target.value); setCoverageData(null); setResult(null) }}
              className="bg-btl-surface border border-btl-border rounded-lg px-3 py-2 text-sm text-btl-text focus:outline-none focus:border-btl-purple/50"
            >
              {SYMBOLS.map(s => <option key={s} value={s}>{s.replace('_', '/')}</option>)}
            </select>
          </div>
          {/* From */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-btl-muted">From</label>
            <input
              type="date"
              value={from}
              onChange={e => { setFrom(e.target.value); setCoverageData(null); setResult(null) }}
              className="bg-btl-surface border border-btl-border rounded-lg px-3 py-2 text-sm text-btl-text focus:outline-none focus:border-btl-purple/50"
            />
          </div>
          {/* To */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-btl-muted">To</label>
            <input
              type="date"
              value={to}
              onChange={e => { setTo(e.target.value); setCoverageData(null); setResult(null) }}
              className="bg-btl-surface border border-btl-border rounded-lg px-3 py-2 text-sm text-btl-text focus:outline-none focus:border-btl-purple/50"
            />
          </div>
          {/* Check */}
          <button
            onClick={checkCoverage}
            disabled={!from || !to || coverageLoading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium glass-md text-btl-muted hover:text-btl-text disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {coverageLoading ? <Spinner size={4} /> : <Database className="w-4 h-4" />}
            Check Coverage
          </button>
        </div>
        {coverageError && <div className="mt-3"><ErrorBanner message={coverageError} /></div>}
      </div>

      {/* Coverage table */}
      {coverageData && (
        <div className="glass-md rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-btl-text">
              Coverage &mdash; {symbol.replace('_', '/')} &mdash; {coverageData.weekdays} weekdays
            </h3>
            {coverageData.readyToRunPipeline ? (
              <span className="text-xs text-btl-up font-medium">Ready to run</span>
            ) : (
              <span className="text-xs text-btl-gold font-medium">{coverageData.jobs.length} import{coverageData.jobs.length !== 1 ? 's' : ''} needed</span>
            )}
          </div>

          <table className="w-full text-sm mb-4">
            <thead>
              <tr className="text-xs text-btl-muted border-b border-btl-border">
                <th className="text-left pb-2 font-normal">Timeframe</th>
                <th className="text-right pb-2 font-normal">Coverage</th>
                <th className="text-right pb-2 font-normal hidden sm:table-cell">Actual</th>
                <th className="text-right pb-2 font-normal hidden sm:table-cell">Expected</th>
                <th className="text-right pb-2 font-normal hidden md:table-cell">Earliest</th>
                <th className="text-right pb-2 font-normal hidden md:table-cell">Latest</th>
                <th className="text-left pb-2 font-normal pl-4">Usage</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(row => (
                <tr key={row.timeframe} className={clsx('border-t border-btl-border/40', !row.supported && 'opacity-50')}>
                  <td className="py-2 font-mono text-btl-text">{row.timeframe}</td>
                  <td className="py-2 text-right">{coverageBadge(row)}</td>
                  <td className="py-2 text-right text-btl-muted tabular hidden sm:table-cell">{row.actualCount.toLocaleString()}</td>
                  <td className="py-2 text-right text-btl-muted tabular hidden sm:table-cell">{row.expectedCount.toLocaleString()}</td>
                  <td className="py-2 text-right text-btl-muted hidden md:table-cell">
                    {row.earliestCandle ? fmtDate(row.earliestCandle) : '—'}
                  </td>
                  <td className="py-2 text-right text-btl-muted hidden md:table-cell">
                    {row.latestCandle ? fmtDate(row.latestCandle) : '—'}
                  </td>
                  <td className="py-2 pl-4 text-xs text-btl-muted">{row.stage}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Import jobs */}
          {coverageData.jobs.length > 0 && (
            <div className="flex flex-col gap-2 pt-2 border-t border-btl-border/40">
              <p className="text-xs font-medium text-btl-gold">Imports needed before pipeline can run:</p>
              {coverageData.jobs.map(j => (
                <div key={`${j.symbol}|${j.timeframe}`} className="flex items-center gap-3 text-xs">
                  <span className="font-mono text-btl-text">{j.symbol} {j.timeframe}</span>
                  <span className="text-btl-muted">{j.currentCount.toLocaleString()} / {j.expectedCount.toLocaleString()} candles ({j.coveragePct.toFixed(1)}%)</span>
                </div>
              ))}
              <p className="text-xs text-btl-muted mt-1">
                Use <span className="font-mono text-btl-faint">action=ingest</span> for each, or click Run Pipeline below — it will import automatically.
              </p>
            </div>
          )}

          {/* Run pipeline button */}
          <div className="flex items-center gap-3 mt-4 pt-4 border-t border-btl-border/40">
            <button
              onClick={runPipeline}
              disabled={running}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-btl-purple text-white hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {running ? <Spinner size={4} /> : <Play className="w-4 h-4" />}
              Run Full Pipeline
            </button>
            <p className="text-xs text-btl-muted">
              Import → Setup detection → Backtest → Path analysis → Analytics → FTMO
            </p>
          </div>
          {runError && <div className="mt-3"><ErrorBanner message={runError} /></div>}
        </div>
      )}

      {/* Pipeline result */}
      {result && (
        <div className="glass-md rounded-2xl p-5">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="font-semibold text-btl-text">Pipeline Result</h3>
              <p className="text-xs text-btl-muted mt-0.5">
                {result.symbol.replace('_', '/')} · {result.from} – {result.to} · total {fmtDuration(result.totalDurationMs)}
              </p>
            </div>
            {result.backtestRunId && (
              <p className="text-xs font-mono text-btl-muted truncate max-w-[200px]">{result.backtestRunId}</p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            {result.steps.map(step => (
              <div key={step.step} className="flex items-start gap-3 px-3 py-2.5 rounded-xl glass-md">
                {stepIcon(step.status)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono text-btl-text">{step.step}</span>
                    <span className={clsx(
                      'text-xs',
                      step.status === 'completed' ? 'text-btl-up' :
                      step.status === 'skipped'   ? 'text-btl-muted' : 'text-btl-down',
                    )}>
                      {step.status}
                    </span>
                  </div>
                  {step.data && Object.keys(step.data).length > 0 && (
                    <p className="text-xs text-btl-muted mt-0.5 truncate">
                      {step.data.reason
                        ? String(step.data.reason)
                        : Object.entries(step.data)
                            .filter(([, v]) => v !== null && v !== undefined)
                            .map(([k, v]) => `${k}: ${String(v)}`)
                            .join(' · ')
                      }
                    </p>
                  )}
                  {step.error && <p className="text-xs text-btl-down mt-0.5">{step.error}</p>}
                </div>
                <div className="flex items-center gap-1 text-xs text-btl-faint shrink-0">
                  <Clock className="w-3 h-3" />
                  {fmtDuration(step.durationMs)}
                </div>
              </div>
            ))}
          </div>

          {result.backtestRunId && (
            <p className="mt-4 text-xs text-btl-muted">
              Backtest run saved. Select it in the sidebar to view analytics, FTMO, and AI review tabs.
            </p>
          )}
        </div>
      )}

      {/* Timeframe key */}
      {!coverageData && !coverageLoading && (
        <div className="glass-md rounded-2xl p-5">
          <h3 className="text-xs font-semibold text-btl-muted uppercase tracking-wider mb-3">Timeframe Status</h3>
          <div className="flex flex-col gap-2">
            {[
              { tf: 'M5',  active: true,  label: 'Active',  desc: 'Signal detection · trade simulation · path analysis' },
              { tf: 'M15', active: true,  label: 'Active',  desc: 'Setup detection (08:00–13:00 UK window)' },
              { tf: 'H1',  active: false, label: 'Planned', desc: 'H1 trend filter — not yet active' },
              { tf: 'H4',  active: false, label: 'Planned', desc: 'H4 bias filter — not yet active' },
              { tf: 'D1',  active: false, label: 'Planned', desc: 'Daily range / PDH / PDL — not yet active' },
            ].map(({ tf, active, label, desc }) => (
              <div key={tf} className={clsx('flex items-start gap-3', !active && 'opacity-50')}>
                <span className="font-mono text-sm text-btl-text w-8 shrink-0">{tf}</span>
                <span className={clsx('text-xs font-medium shrink-0 mt-0.5', active ? 'text-btl-up' : 'text-btl-muted')}>{label}</span>
                <span className="text-xs text-btl-muted">{desc}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Run Sidebar Item ───────────────────────────────────────────────────────

function RunItem({ run, selected, onClick }: { run: BacktestRun; selected: boolean; onClick: () => void }) {
  const fromDate = new Date(run.fromDate).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
  const toDate   = new Date(run.toDate).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
  const statusColor: Record<string, string> = {
    completed: 'text-btl-up',
    running:   'text-btl-gold',
    partial:   'text-btl-orange',
    failed:    'text-btl-down',
  }

  return (
    <button
      onClick={onClick}
      className={clsx(
        'w-full text-left px-3 py-3 rounded-xl transition-colors',
        selected
          ? 'bg-btl-purple/15 border border-btl-purple/30'
          : 'hover:bg-btl-faint border border-transparent',
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs font-semibold text-btl-text">{run.symbol}</span>
        <span className={clsx('text-xs tabular', statusColor[run.status] ?? 'text-btl-muted')}>
          {run.status}
        </span>
      </div>
      <p className="text-xs text-btl-muted">{fromDate} – {toDate}</p>
      {run.tradeCount > 0 && (
        <div className="flex items-center gap-2 mt-1.5">
          <span className={clsx('text-xs font-semibold tabular', winColor(run.winRate != null ? run.winRate * 100 : null))}>
            {run.winRate != null ? fmtPct(run.winRate * 100) : '—'}
          </span>
          <span className="text-xs text-btl-muted">{run.tradeCount} trades</span>
        </div>
      )}
    </button>
  )
}

// ── Main Dashboard ─────────────────────────────────────────────────────────

type Tab = 'analytics' | 'ftmo' | 'ai' | 'recommendations'

export default function ResearchDashboard() {
  const [runs, setRuns] = useState<BacktestRun[]>([])
  const [runsLoading, setRunsLoading] = useState(true)
  const [runsError, setRunsError] = useState<string | null>(null)

  const [showPipeline, setShowPipeline] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('analytics')

  const [summaries, setSummaries]         = useState<AnalyticsSummary[]>([])
  const [ftmoResults, setFtmoResults]     = useState<FtmoResult[]>([])
  const [aiReviews, setAiReviews]         = useState<AiReview[]>([])
  const [recommendations, setRecs]        = useState<Recommendation[]>([])
  const [dataLoading, setDataLoading]     = useState(false)

  const secretMissing = !(import.meta.env.VITE_ADMIN_SECRET as string | undefined)

  // Load runs on mount
  useEffect(() => {
    if (secretMissing) { setRunsLoading(false); return }
    adminApi.getBacktestRuns()
      .then(d => setRuns(d.runs))
      .catch(e => setRunsError(e.message))
      .finally(() => setRunsLoading(false))
  }, [secretMissing])

  // Load all run data when selection changes
  const loadRunData = useCallback(async (id: string) => {
    setDataLoading(true)
    setSummaries([])
    setFtmoResults([])
    setAiReviews([])
    setRecs([])
    try {
      const [s, f, a, r] = await Promise.allSettled([
        adminApi.getAnalytics(id),
        adminApi.getFtmoResults(id),
        adminApi.getAiReviews(id),
        adminApi.getRecommendations(id),
      ])
      if (s.status === 'fulfilled') setSummaries(s.value)
      if (f.status === 'fulfilled') setFtmoResults(f.value)
      if (a.status === 'fulfilled') setAiReviews(a.value)
      if (r.status === 'fulfilled') setRecs(r.value)
    } finally {
      setDataLoading(false)
    }
  }, [])

  const selectRun = (id: string) => {
    setShowPipeline(false)
    setSelectedId(id)
    loadRunData(id)
  }

  const refreshReviews = () => {
    if (selectedId) {
      adminApi.getAiReviews(selectedId).then(setAiReviews).catch(() => {})
      adminApi.getRecommendations(selectedId).then(setRecs).catch(() => {})
    }
  }

  const TABS: { id: Tab; label: string; icon: ComponentType<{ className?: string }> }[] = [
    { id: 'analytics',       label: 'Analytics',       icon: BarChart3 },
    { id: 'ftmo',            label: 'FTMO',            icon: TrendingUp },
    { id: 'ai',              label: 'AI Review',       icon: Bot },
    { id: 'recommendations', label: 'Recommendations', icon: List },
  ]

  const selectedRun = runs.find(r => r.id === selectedId)

  return (
    <div className="flex flex-col h-full bg-btl-bg text-btl-text">
      {/* Top header */}
      <header className="flex items-center gap-4 px-6 py-4 border-b border-btl-border shrink-0">
        <Link
          to="/"
          className="flex items-center gap-1.5 text-sm text-btl-muted hover:text-btl-text transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Chart
        </Link>
        <div className="h-4 w-px bg-btl-border" />
        <h1 className="text-sm font-semibold text-btl-text">Research Dashboard</h1>
      </header>

      {/* Secret not configured warning */}
      {secretMissing && (
        <div className="mx-6 mt-4">
          <ErrorBanner message="VITE_ADMIN_SECRET is not set. Add it to .env.local and Vercel env vars to use the dashboard." />
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <aside className="w-56 shrink-0 border-r border-btl-border flex flex-col">
          {/* Pipeline button */}
          <div className="px-2 pt-2 pb-1 border-b border-btl-border">
            <button
              onClick={() => { setShowPipeline(true); setSelectedId(null) }}
              className={clsx(
                'w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-colors',
                showPipeline
                  ? 'bg-btl-purple/15 border border-btl-purple/30 text-btl-text'
                  : 'text-btl-muted hover:text-btl-text hover:bg-btl-faint border border-transparent',
              )}
            >
              <Database className="w-4 h-4" />
              Pipeline
            </button>
          </div>

          {/* Backtest runs */}
          <div className="flex items-center justify-between px-3 py-2.5">
            <span className="text-xs font-semibold text-btl-muted uppercase tracking-wider">Backtest Runs</span>
            <button
              onClick={() => {
                setRunsLoading(true)
                adminApi.getBacktestRuns().then(d => setRuns(d.runs)).catch(e => setRunsError(e.message)).finally(() => setRunsLoading(false))
              }}
              className="text-btl-muted hover:text-btl-text transition-colors p-1"
              title="Refresh"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-2 flex flex-col gap-1">
            {runsLoading && <div className="flex justify-center py-8"><Spinner /></div>}
            {runsError && <ErrorBanner message={runsError} />}
            {!runsLoading && !runsError && runs.length === 0 && (
              <p className="text-xs text-btl-muted px-2 py-4">No backtest runs yet.</p>
            )}
            {runs.map(run => (
              <RunItem key={run.id} run={run} selected={run.id === selectedId && !showPipeline} onClick={() => selectRun(run.id)} />
            ))}
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0 flex flex-col">
          {showPipeline ? (
            <div className="flex-1 overflow-y-auto p-6">
              <PipelinePanel />
            </div>
          ) : !selectedId ? (
            <div className="flex-1 flex items-center justify-center text-btl-muted text-sm">
              Select a backtest run from the sidebar, or use Pipeline to import data and run the full pipeline.
            </div>
          ) : (
            <>
              {/* Run info bar */}
              {selectedRun && (
                <div className="px-6 py-3 border-b border-btl-border bg-btl-surface/50 flex items-center gap-4 shrink-0">
                  <span className="text-sm font-semibold text-btl-text">{selectedRun.symbol}</span>
                  <span className="text-xs text-btl-muted">
                    {fmtDate(selectedRun.fromDate)} – {fmtDate(selectedRun.toDate)}
                  </span>
                  {selectedRun.tradeCount > 0 && (
                    <>
                      <span className="text-xs text-btl-muted">{selectedRun.tradeCount} trades</span>
                      <span className={clsx('text-xs font-semibold tabular', winColor(selectedRun.winRate != null ? selectedRun.winRate * 100 : null))}>
                        {selectedRun.winRate != null ? fmtPct(selectedRun.winRate * 100) : '—'}
                      </span>
                    </>
                  )}
                  <span className="text-xs text-btl-muted font-mono truncate hidden sm:block">{selectedRun.id}</span>
                </div>
              )}

              {/* Tabs */}
              <div className="flex border-b border-btl-border px-6 shrink-0">
                {TABS.map(tab => (
                  <TabButton
                    key={tab.id}
                    active={activeTab === tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    icon={tab.icon}
                    label={tab.label}
                  />
                ))}
              </div>

              {/* Tab content */}
              <div className="flex-1 overflow-y-auto p-6">
                {activeTab === 'analytics' && (
                  <AnalyticsPanel summaries={summaries} loading={dataLoading} />
                )}
                {activeTab === 'ftmo' && (
                  <FtmoPanel results={ftmoResults} loading={dataLoading} />
                )}
                {activeTab === 'ai' && (
                  <AiPanel
                    backtestRunId={selectedId}
                    summaries={summaries}
                    reviews={aiReviews}
                    loading={dataLoading}
                    onReviewSaved={refreshReviews}
                  />
                )}
                {activeTab === 'recommendations' && (
                  <RecsPanel recommendations={recommendations} loading={dataLoading} />
                )}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
