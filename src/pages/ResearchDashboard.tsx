import { useState, useEffect, useCallback, type ComponentType } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import {
  ArrowLeft, BarChart3, TrendingUp, Bot, List,
  Copy, Check, X, Loader2, AlertCircle, Zap,
  ChevronDown, ChevronUp, RefreshCw,
  Database, Play, CheckCircle2, SkipForward, XCircle, Clock,
  Info, Table2, Crosshair, ExternalLink,
  ArrowUp, ArrowDown, Filter,
} from 'lucide-react'
import { adminApi } from '../lib/adminApi'
import type {
  BacktestRun, AnalyticsSummary, FtmoResult,
  AiReview, Recommendation, PromptData,
  CoverageRow, ImportPlanResult, PipelineResult, PipelineStep,
  BacktestDetail, TradeRow, SetupRow,
} from '../lib/adminApi'

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function ukDate(dateUk: string): string {
  if (!dateUk || dateUk.length < 10) return dateUk
  return `${dateUk.slice(8, 10)}/${dateUk.slice(5, 7)}/${dateUk.slice(0, 4)}`
}

function ukTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso))
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

// ── Overview Panel ─────────────────────────────────────────────────────────

const DATA_PROVENANCE = [
  { source: 'M15 candles',                  usedFor: 'Setup detection — daily 08:00–13:00 UK window' },
  { source: 'M5 candles',                   usedFor: 'Signal detection — 13:00–16:00 UK trading session' },
  { source: 'M5 candles',                   usedFor: 'Trade simulation — entry, SL/TP walk-forward' },
  { source: 'M5 candles (stored)',           usedFor: 'Trade path analysis — MFE / MAE / R milestones' },
  { source: 'Trades + path analysis',        usedFor: 'Analytics — win rate, expectancy, day/hour/breakout slices' },
  { source: 'Analytics summaries only',      usedFor: 'AI reviews — no raw candles sent to Claude' },
  { source: 'H1 / H4 / D1 candles',         usedFor: 'Planned — trend filter context (not yet active)' },
]

function OverviewPanel({ detail, loading }: { detail: BacktestDetail | null; loading: boolean }) {
  const [settingsOpen, setSettingsOpen] = useState(false)

  if (loading) return <div className="flex justify-center py-16"><Spinner size={6} /></div>
  if (!detail) return <EmptyState message="Run backtest-detail to load overview." />

  const a = detail.analytics ?? {}

  return (
    <div className="flex flex-col gap-6">
      {/* Run metadata */}
      <section>
        <h3 className="text-xs font-semibold text-btl-muted uppercase tracking-wider mb-3">Run Details</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-3">
          <StatCard label="Symbol"    value={detail.symbol.replace('_', '/')} />
          <StatCard label="Timeframe" value={detail.timeframe} />
          <StatCard label="From"      value={fmtDate(detail.fromDate)} />
          <StatCard label="To"        value={fmtDate(detail.toDate)} />
          <StatCard label="Status"    value={detail.status}
            color={detail.status === 'completed' ? 'text-btl-up' : detail.status === 'failed' ? 'text-btl-down' : 'text-btl-gold'} />
          <StatCard label="Strategy"  value={`${detail.strategyName} v${detail.versionNumber}`} />
          <StatCard label="Trades"    value={String(detail.tradeCount)}
            sub={`${detail.winCount}W / ${detail.lossCount}L / ${detail.openCount} open`} />
          <StatCard label="Win Rate"  value={detail.winRate != null ? fmtPct(detail.winRate * 100) : '—'}
            color={winColor(detail.winRate != null ? detail.winRate * 100 : null)} />
        </div>
        <p className="text-xs font-mono text-btl-faint">ID: {detail.id}</p>
      </section>

      {/* Analytics stats (from overall summary) */}
      {detail.analytics && (
        <section>
          <h3 className="text-xs font-semibold text-btl-muted uppercase tracking-wider mb-3">Performance Stats</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Expectancy"    value={fmtR(a.expectancy)}
              color={Number(a.expectancy) >= 0 ? 'text-btl-up' : 'text-btl-down'} />
            <StatCard label="Profit Factor" value={fmtN(a.profitFactor)}
              color={Number(a.profitFactor) >= 1.5 ? 'text-btl-up' : 'text-btl-muted'} />
            <StatCard label="Max Drawdown"  value={fmtR(a.maxDrawdownR)} color="text-btl-down" />
            <StatCard label="Total R"       value={fmtR(a.totalR)}
              color={Number(a.totalR) >= 0 ? 'text-btl-up' : 'text-btl-down'} />
          </div>
        </section>
      )}

      {/* Strategy settings snapshot */}
      <section>
        <button
          onClick={() => setSettingsOpen(o => !o)}
          className="flex items-center gap-2 text-xs font-semibold text-btl-muted uppercase tracking-wider mb-2 hover:text-btl-text transition-colors"
        >
          {settingsOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          Strategy Settings Snapshot (v{detail.versionNumber})
        </button>
        {settingsOpen && (
          <pre className="text-xs font-mono text-btl-muted bg-btl-bg/60 border border-btl-border rounded-xl p-4 overflow-x-auto">
            {JSON.stringify(detail.settingsJson, null, 2)}
          </pre>
        )}
      </section>

      {/* Data provenance */}
      <section>
        <h3 className="text-xs font-semibold text-btl-muted uppercase tracking-wider mb-3">Data Provenance</h3>
        <div className="glass-md rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-btl-muted border-b border-btl-border">
                <th className="text-left px-4 py-2.5 font-normal">Data source</th>
                <th className="text-left px-4 py-2.5 font-normal">Used for</th>
              </tr>
            </thead>
            <tbody>
              {DATA_PROVENANCE.map((row, i) => (
                <tr key={i} className={clsx('border-t border-btl-border/40', row.source.includes('Planned') && 'opacity-50')}>
                  <td className="px-4 py-2.5 text-xs font-mono text-btl-text whitespace-nowrap">{row.source}</td>
                  <td className="px-4 py-2.5 text-xs text-btl-muted">{row.usedFor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

// ── Trade Explorer ─────────────────────────────────────────────────────────

type TradeFilter = 'all' | 'wins' | 'losses' | 'opens' | 'buys' | 'sells'
type TradeSort   = { col: 'date' | 'r' | 'mfe' | 'mae'; dir: 'asc' | 'desc' }

function dirLabel(d: string) { return d === 'buy' ? '▲ Buy' : '▼ Sell' }
function dirColor(d: string) { return d === 'buy' ? 'text-btl-up' : 'text-btl-down' }
function resultColor(r: string) {
  if (r === 'win')  return 'text-btl-up'
  if (r === 'loss') return 'text-btl-down'
  return 'text-btl-muted'
}
function exitReason(result: string) {
  if (result === 'win')  return 'TP hit'
  if (result === 'loss') return 'SL hit'
  return 'Session end'
}
function fmtMins(m: number | null) {
  if (m == null) return '—'
  if (m < 60)    return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}
function px(p: number) { return p.toFixed(5) }

interface BalanceStats {
  current: number
  peak:    number
  maxDDPct: number
  totalR:  number
  curve:   Map<string, number>   // tradeId → running balance after that trade
}

function computeBalance(trades: TradeRow[], start: number, riskPct: number): BalanceStats {
  let balance = start
  let peak    = start
  let maxDD   = 0
  let totalR  = 0
  const curve = new Map<string, number>()
  for (const t of trades) {
    if (t.profitLossR != null) {
      const pnl = balance * (riskPct / 100) * t.profitLossR
      balance  += pnl
      totalR   += t.profitLossR
      if (balance > peak) peak = balance
      const dd = peak > 0 ? ((peak - balance) / peak) * 100 : 0
      if (dd > maxDD) maxDD = dd
    }
    curve.set(t.id, balance)
  }
  return { current: balance, peak, maxDDPct: maxDD, totalR, curve }
}

function TradeExplorer({ trades, symbol, loading }: { trades: TradeRow[]; symbol: string; loading: boolean }) {
  const [filter, setFilter]       = useState<TradeFilter>('all')
  const [sort, setSort]           = useState<TradeSort>({ col: 'date', dir: 'asc' })
  const [startBal, setStartBal]   = useState('10000')
  const [riskPct, setRiskPct]     = useState('1')
  const [balOpen, setBalOpen]     = useState(false)

  const start   = parseFloat(startBal) || 10000
  const riskP   = parseFloat(riskPct)  || 1
  const balance = computeBalance(trades, start, riskP)

  const visible = trades
    .filter(t => {
      if (filter === 'wins')   return t.result === 'win'
      if (filter === 'losses') return t.result === 'loss'
      if (filter === 'opens')  return t.result === 'open'
      if (filter === 'buys')   return t.direction === 'buy'
      if (filter === 'sells')  return t.direction === 'sell'
      return true
    })
    .sort((a, b) => {
      const mul = sort.dir === 'asc' ? 1 : -1
      if (sort.col === 'date') return mul * (new Date(a.entryTs).getTime() - new Date(b.entryTs).getTime())
      if (sort.col === 'r')    return mul * ((a.profitLossR ?? -99) - (b.profitLossR ?? -99))
      if (sort.col === 'mfe')  return mul * ((a.mfeR ?? 0) - (b.mfeR ?? 0))
      if (sort.col === 'mae')  return mul * ((a.maeR ?? 0) - (b.maeR ?? 0))
      return 0
    })

  function toggleSort(col: TradeSort['col']) {
    setSort(prev => prev.col === col
      ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { col, dir: col === 'date' ? 'asc' : 'desc' })
  }

  function SortIcon({ col }: { col: TradeSort['col'] }) {
    if (sort.col !== col) return <ArrowUp className="w-3 h-3 text-btl-faint" />
    return sort.dir === 'asc'
      ? <ArrowUp className="w-3 h-3 text-btl-purple" />
      : <ArrowDown className="w-3 h-3 text-btl-purple" />
  }

  if (loading) return <div className="flex justify-center py-16"><Spinner size={6} /></div>
  if (!trades.length) return <EmptyState message="No trades for this run. Run action=run-backtest first." />

  const FILTERS: { id: TradeFilter; label: string }[] = [
    { id: 'all',    label: `All (${trades.length})` },
    { id: 'wins',   label: `Wins (${trades.filter(t => t.result === 'win').length})` },
    { id: 'losses', label: `Losses (${trades.filter(t => t.result === 'loss').length})` },
    { id: 'opens',  label: `Open (${trades.filter(t => t.result === 'open').length})` },
    { id: 'buys',   label: `Buy (${trades.filter(t => t.direction === 'buy').length})` },
    { id: 'sells',  label: `Sell (${trades.filter(t => t.direction === 'sell').length})` },
  ]

  return (
    <div className="flex flex-col gap-5">
      {/* Balance calculator */}
      <div className="glass-md rounded-xl overflow-hidden">
        <button
          onClick={() => setBalOpen(o => !o)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-btl-text hover:bg-white/[0.02] transition-colors"
        >
          <span className="flex items-center gap-2">
            {balOpen ? <ChevronUp className="w-4 h-4 text-btl-muted" /> : <ChevronDown className="w-4 h-4 text-btl-muted" />}
            Running Account Balance
          </span>
          <span className="text-xs text-btl-muted">{balOpen ? 'collapse' : 'expand'}</span>
        </button>
        {balOpen && (
          <div className="px-4 pb-4 border-t border-btl-border/40">
            <div className="flex flex-wrap gap-3 mt-3 mb-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-btl-muted">Starting balance (£)</label>
                <input
                  type="number" min="100" value={startBal}
                  onChange={e => setStartBal(e.target.value)}
                  className="bg-btl-surface border border-btl-border rounded-lg px-3 py-1.5 text-sm text-btl-text w-28 focus:outline-none focus:border-btl-purple/50"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-btl-muted">Risk per trade (%)</label>
                <input
                  type="number" min="0.1" step="0.1" max="10" value={riskPct}
                  onChange={e => setRiskPct(e.target.value)}
                  className="bg-btl-surface border border-btl-border rounded-lg px-3 py-1.5 text-sm text-btl-text w-20 focus:outline-none focus:border-btl-purple/50"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="Current Balance" value={`£${Math.round(balance.current).toLocaleString()}`}
                color={balance.current >= start ? 'text-btl-up' : 'text-btl-down'} />
              <StatCard label="Peak Balance"    value={`£${Math.round(balance.peak).toLocaleString()}`} color="text-btl-up" />
              <StatCard label="Max Drawdown"    value={`${balance.maxDDPct.toFixed(1)}%`} color="text-btl-down" />
              <StatCard label="Total R"         value={fmtR(balance.totalR)}
                color={balance.totalR >= 0 ? 'text-btl-up' : 'text-btl-down'} />
            </div>
            <p className="mt-3 text-xs text-btl-muted">
              Compound model — {riskP}% of current balance risked per trade. Open trades counted at R=0.
            </p>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="w-3.5 h-3.5 text-btl-faint shrink-0" />
        {FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={clsx(
              'px-3 py-1 rounded-lg text-xs font-medium transition-colors',
              filter === f.id
                ? 'bg-btl-purple/20 text-btl-text border border-btl-purple/40'
                : 'glass-md text-btl-muted hover:text-btl-text',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Trade table */}
      <div className="overflow-x-auto rounded-xl border border-btl-border">
        <table className="w-full text-xs whitespace-nowrap">
          <thead>
            <tr className="bg-btl-surface text-btl-muted border-b border-btl-border">
              <th className="px-3 py-2.5 text-left font-normal">#</th>
              <th className="px-3 py-2.5 text-left font-normal">
                <button className="flex items-center gap-1" onClick={() => toggleSort('date')}>Date<SortIcon col="date" /></button>
              </th>
              <th className="px-3 py-2.5 text-left font-normal">Dir</th>
              <th className="px-3 py-2.5 text-right font-normal">Entry</th>
              <th className="px-3 py-2.5 text-right font-normal">SL</th>
              <th className="px-3 py-2.5 text-right font-normal">TP</th>
              <th className="px-3 py-2.5 text-right font-normal">Exit</th>
              <th className="px-3 py-2.5 text-center font-normal">Result</th>
              <th className="px-3 py-2.5 text-right font-normal">
                <button className="flex items-center gap-1 ml-auto" onClick={() => toggleSort('r')}>R<SortIcon col="r" /></button>
              </th>
              <th className="px-3 py-2.5 text-right font-normal">
                <button className="flex items-center gap-1 ml-auto" onClick={() => toggleSort('mfe')}>MFE R<SortIcon col="mfe" /></button>
              </th>
              <th className="px-3 py-2.5 text-right font-normal">
                <button className="flex items-center gap-1 ml-auto" onClick={() => toggleSort('mae')}>MAE R<SortIcon col="mae" /></button>
              </th>
              <th className="px-3 py-2.5 text-right font-normal">→1R</th>
              <th className="px-3 py-2.5 text-right font-normal">Duration</th>
              <th className="px-3 py-2.5 text-center font-normal">Exit reason</th>
              <th className="px-3 py-2.5 text-center font-normal">BE?</th>
              <th className="px-3 py-2.5 text-right font-normal">Balance</th>
              <th className="px-3 py-2.5 text-center font-normal">Chart</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((t, i) => {
              const durationMin = t.exitTs
                ? Math.round((new Date(t.exitTs).getTime() - new Date(t.entryTs).getTime()) / 60_000)
                : t.timeToExitMinutes
              const bal = balance.curve.get(t.id)
              return (
                <tr key={t.id} className="border-t border-btl-border/40 hover:bg-white/[0.015] transition-colors">
                  <td className="px-3 py-2 text-btl-faint tabular">{i + 1}</td>
                  <td className="px-3 py-2 text-btl-muted tabular">
                    {ukDate(t.dateUk ?? new Date(t.entryTs).toISOString().slice(0, 10))}{' '}
                    <span className="text-btl-faint">{ukTime(t.entryTs)}</span>
                  </td>
                  <td className={clsx('px-3 py-2 font-medium', dirColor(t.direction))}>{dirLabel(t.direction)}</td>
                  <td className="px-3 py-2 text-right tabular text-btl-text">{px(t.entryPrice)}</td>
                  <td className="px-3 py-2 text-right tabular text-btl-down">{px(t.slPrice)}</td>
                  <td className="px-3 py-2 text-right tabular text-btl-up">{px(t.tpPrice)}</td>
                  <td className="px-3 py-2 text-right tabular text-btl-muted">{t.exitPrice != null ? px(t.exitPrice) : '—'}</td>
                  <td className={clsx('px-3 py-2 text-center font-semibold', resultColor(t.result))}>{t.result}</td>
                  <td className={clsx('px-3 py-2 text-right tabular font-medium', t.profitLossR != null && t.profitLossR >= 0 ? 'text-btl-up' : 'text-btl-down')}>
                    {t.profitLossR != null ? fmtR(t.profitLossR) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular text-btl-up">{t.mfeR != null ? `${t.mfeR.toFixed(2)}R` : '—'}</td>
                  <td className="px-3 py-2 text-right tabular text-btl-down">{t.maeR != null ? `${t.maeR.toFixed(2)}R` : '—'}</td>
                  <td className="px-3 py-2 text-right tabular text-btl-muted">{fmtMins(t.timeTo1rMinutes)}</td>
                  <td className="px-3 py-2 text-right tabular text-btl-muted">{fmtMins(durationMin ?? null)}</td>
                  <td className="px-3 py-2 text-center text-btl-muted">{exitReason(t.result)}</td>
                  <td className="px-3 py-2 text-center">
                    {t.breakEvenWouldHelp
                      ? <span className="text-btl-gold font-medium">Yes</span>
                      : <span className="text-btl-faint">No</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular text-btl-muted">
                    {bal != null ? `£${Math.round(bal).toLocaleString()}` : '—'}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {t.dateUk && (
                      <Link
                        to={`/?symbol=${symbol}&date=${t.dateUk}&tradeId=${t.id}`}
                        className="inline-flex items-center gap-0.5 text-btl-purple hover:text-purple-400 transition-colors"
                        title="Open on chart"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </Link>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {visible.length === 0 && (
          <div className="py-8 text-center text-btl-muted text-xs">No trades match the current filter.</div>
        )}
      </div>
    </div>
  )
}

// ── Setup Explorer ─────────────────────────────────────────────────────────

type SetupFilter = 'all' | 'valid' | 'invalid'

function SetupExplorer({ setups, loading }: { setups: SetupRow[]; loading: boolean }) {
  const [filter, setFilter] = useState<SetupFilter>('all')

  if (loading) return <div className="flex justify-center py-16"><Spinner size={6} /></div>
  if (!setups.length) return <EmptyState message="No setups found. Run action=run-setup-detection first." />

  const visible = setups.filter(s => {
    if (filter === 'valid')   return s.setupValid
    if (filter === 'invalid') return !s.setupValid
    return true
  })

  const validCount   = setups.filter(s => s.setupValid).length
  const signalCount  = setups.filter(s => s.signalDetected).length
  const tradeCount   = setups.filter(s => s.tradeCreated).length

  const FILTERS: { id: SetupFilter; label: string }[] = [
    { id: 'all',     label: `All (${setups.length})` },
    { id: 'valid',   label: `Valid (${validCount})` },
    { id: 'invalid', label: `Invalid (${setups.length - validCount})` },
  ]

  return (
    <div className="flex flex-col gap-5">
      {/* Summary chips */}
      <div className="flex flex-wrap gap-3">
        <div className="glass-md rounded-lg px-3 py-1.5 text-xs">
          <span className="text-btl-muted">Total setups: </span>
          <span className="text-btl-text font-medium">{setups.length}</span>
        </div>
        <div className="glass-md rounded-lg px-3 py-1.5 text-xs">
          <span className="text-btl-muted">Valid: </span>
          <span className="text-btl-up font-medium">{validCount}</span>
          <span className="text-btl-muted"> · Invalid: </span>
          <span className="text-btl-down font-medium">{setups.length - validCount}</span>
        </div>
        <div className="glass-md rounded-lg px-3 py-1.5 text-xs">
          <span className="text-btl-muted">Signal detected: </span>
          <span className="text-btl-text font-medium">{signalCount}</span>
        </div>
        <div className="glass-md rounded-lg px-3 py-1.5 text-xs">
          <span className="text-btl-muted">Trade created: </span>
          <span className="text-btl-text font-medium">{tradeCount}</span>
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex items-center gap-2">
        <Filter className="w-3.5 h-3.5 text-btl-faint shrink-0" />
        {FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={clsx(
              'px-3 py-1 rounded-lg text-xs font-medium transition-colors',
              filter === f.id
                ? 'bg-btl-purple/20 text-btl-text border border-btl-purple/40'
                : 'glass-md text-btl-muted hover:text-btl-text',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Setup table */}
      <div className="overflow-x-auto rounded-xl border border-btl-border">
        <table className="w-full text-xs whitespace-nowrap">
          <thead>
            <tr className="bg-btl-surface text-btl-muted border-b border-btl-border">
              <th className="px-3 py-2.5 text-left font-normal">Date</th>
              <th className="px-3 py-2.5 text-center font-normal">Valid</th>
              <th className="px-3 py-2.5 text-left font-normal">Reason</th>
              <th className="px-3 py-2.5 text-right font-normal">Prev High</th>
              <th className="px-3 py-2.5 text-right font-normal">Prev Low</th>
              <th className="px-3 py-2.5 text-left font-normal">Setup candle</th>
              <th className="px-3 py-2.5 text-left font-normal">Green line</th>
              <th className="px-3 py-2.5 text-left font-normal">Red line</th>
              <th className="px-3 py-2.5 text-center font-normal">Signal</th>
              <th className="px-3 py-2.5 text-center font-normal">Dir</th>
              <th className="px-3 py-2.5 text-center font-normal">Trade</th>
              <th className="px-3 py-2.5 text-center font-normal">Result</th>
              <th className="px-3 py-2.5 text-center font-normal">Chart</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(s => (
              <tr key={s.id} className="border-t border-btl-border/40 hover:bg-white/[0.015] transition-colors">
                <td className="px-3 py-2 text-btl-text font-mono">{ukDate(s.dateUk)}</td>
                <td className="px-3 py-2 text-center">
                  {s.setupValid
                    ? <CheckCircle2 className="w-3.5 h-3.5 text-btl-up inline" />
                    : <XCircle className="w-3.5 h-3.5 text-btl-down inline" />}
                </td>
                <td className="px-3 py-2 text-btl-muted max-w-[160px] truncate" title={s.invalidReason ?? ''}>
                  {s.invalidReason ?? '—'}
                </td>
                <td className="px-3 py-2 text-right tabular text-btl-up">{s.hhPrice.toFixed(5)}</td>
                <td className="px-3 py-2 text-right tabular text-btl-down">{s.llPrice.toFixed(5)}</td>
                <td className="px-3 py-2 text-btl-muted tabular">
                  {ukTime(s.setupCandleTs)} UK
                </td>
                <td className="px-3 py-2 text-btl-faint tabular" title="slope · intercept">
                  {s.greenLineSlope.toExponential(3)}
                </td>
                <td className="px-3 py-2 text-btl-faint tabular" title="slope · intercept">
                  {s.redLineSlope.toExponential(3)}
                </td>
                <td className="px-3 py-2 text-center">
                  {s.signalDetected
                    ? <span className="text-btl-up font-medium">Yes</span>
                    : <span className="text-btl-faint">No</span>}
                </td>
                <td className={clsx('px-3 py-2 text-center font-medium', s.signalDirection ? dirColor(s.signalDirection) : 'text-btl-faint')}>
                  {s.signalDirection ?? '—'}
                </td>
                <td className="px-3 py-2 text-center">
                  {s.tradeCreated
                    ? <span className="text-btl-up font-medium">Yes</span>
                    : <span className="text-btl-faint">No</span>}
                </td>
                <td className={clsx('px-3 py-2 text-center font-medium', s.tradeResult ? resultColor(s.tradeResult) : 'text-btl-faint')}>
                  {s.tradeResult ?? '—'}
                </td>
                <td className="px-3 py-2 text-center">
                  <Link
                    to={`/?symbol=${s.symbol}&date=${s.dateUk}&setupId=${s.id}`}
                    className="inline-flex items-center gap-0.5 text-btl-purple hover:text-purple-400 transition-colors"
                    title="Open on chart"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {visible.length === 0 && (
          <div className="py-8 text-center text-btl-muted text-xs">No setups match the current filter.</div>
        )}
      </div>

      <p className="text-xs text-btl-faint">
        Open On Chart links route to <span className="font-mono">/?symbol=…&date=…&setupId=…</span>.
        Chart support for these params is a planned follow-up — the chart sandbox will ignore them for now.
      </p>
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

type Tab = 'overview' | 'trades' | 'setups' | 'analytics' | 'ftmo' | 'ai' | 'recommendations'

export default function ResearchDashboard() {
  const [runs, setRuns] = useState<BacktestRun[]>([])
  const [runsLoading, setRunsLoading] = useState(true)
  const [runsError, setRunsError] = useState<string | null>(null)

  const [showPipeline, setShowPipeline] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('overview')

  const [summaries, setSummaries]         = useState<AnalyticsSummary[]>([])
  const [ftmoResults, setFtmoResults]     = useState<FtmoResult[]>([])
  const [aiReviews, setAiReviews]         = useState<AiReview[]>([])
  const [recommendations, setRecs]        = useState<Recommendation[]>([])
  const [backtestDetail, setDetail]       = useState<BacktestDetail | null>(null)
  const [tradeList, setTradeList]         = useState<TradeRow[]>([])
  const [setupList, setSetupList]         = useState<SetupRow[]>([])
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
    setDetail(null)
    setTradeList([])
    setSetupList([])
    try {
      const [s, f, a, r, d, tl, sl] = await Promise.allSettled([
        adminApi.getAnalytics(id),
        adminApi.getFtmoResults(id),
        adminApi.getAiReviews(id),
        adminApi.getRecommendations(id),
        adminApi.getBacktestDetail(id),
        adminApi.getTradeList(id),
        adminApi.getSetupList(id),
      ])
      if (s.status === 'fulfilled')  setSummaries(s.value)
      if (f.status === 'fulfilled')  setFtmoResults(f.value)
      if (a.status === 'fulfilled')  setAiReviews(a.value)
      if (r.status === 'fulfilled')  setRecs(r.value)
      if (d.status === 'fulfilled')  setDetail(d.value)
      if (tl.status === 'fulfilled') setTradeList(tl.value)
      if (sl.status === 'fulfilled') setSetupList(sl.value)
    } finally {
      setDataLoading(false)
    }
  }, [])

  const selectRun = (id: string) => {
    setShowPipeline(false)
    setSelectedId(id)
    setActiveTab('overview')
    loadRunData(id)
  }

  const refreshReviews = () => {
    if (selectedId) {
      adminApi.getAiReviews(selectedId).then(setAiReviews).catch(() => {})
      adminApi.getRecommendations(selectedId).then(setRecs).catch(() => {})
    }
  }

  const TABS: { id: Tab; label: string; icon: ComponentType<{ className?: string }> }[] = [
    { id: 'overview',        label: 'Overview',        icon: Info },
    { id: 'trades',          label: 'Trades',          icon: Table2 },
    { id: 'setups',          label: 'Setups',          icon: Crosshair },
    { id: 'analytics',       label: 'Analytics',       icon: BarChart3 },
    { id: 'ftmo',            label: 'FTMO',            icon: TrendingUp },
    { id: 'ai',              label: 'AI Review',       icon: Bot },
    { id: 'recommendations', label: 'Recs',            icon: List },
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
                {activeTab === 'overview' && (
                  <OverviewPanel detail={backtestDetail} loading={dataLoading} />
                )}
                {activeTab === 'trades' && (
                  <TradeExplorer
                    trades={tradeList}
                    symbol={backtestDetail?.symbol ?? selectedRun?.symbol ?? ''}
                    loading={dataLoading}
                  />
                )}
                {activeTab === 'setups' && (
                  <SetupExplorer setups={setupList} loading={dataLoading} />
                )}
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
