/**
 * AiAnalysisPanel.tsx
 *
 * Full-screen overlay that shows:
 * - Local statistical analysis (instant, no API)
 * - Optional AI narrative via Claude API proxy (/api/ai)
 */

import { useMemo, useState, useRef, useEffect } from 'react'
import type { BacktestTrade } from '../utils/strategies'
import type { Candle } from '../types'
import {
  extractFeatures,
  analyzeLocally,
  buildAiPrompt,
  type FeatureStat,
  type QuartileStat,
} from '../utils/tradeFeatures'

interface Props {
  trades:    BacktestTrade[]
  candles:   Candle[]
  pair:      string
  tfLabel:   string
  slMode:    string
  slPips:    number
  rrRatio:   number
  onClose:   () => void
}

// ── Mini bar chart for quartile win rates ────────────────────────────────────

function QuartileChart({ qs }: { qs: QuartileStat }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'rgba(241,241,255,0.4)' }}>
        {qs.label}
      </span>
      <div className="flex flex-col gap-0.5">
        {qs.quartiles.map((b, i) => {
          const pct  = Math.max(0, Math.min(100, b.winRate))
          const col  = pct >= 60 ? '#22C55E' : pct >= 40 ? '#F59E0B' : '#EF4444'
          return (
            <div key={i} className="flex items-center gap-2">
              <span className="text-[8px] tabular-nums" style={{ color: 'rgba(241,241,255,0.35)', width: 72, flexShrink: 0 }}>
                {b.range}
              </span>
              <div className="flex-1 h-3 rounded-sm overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                <div
                  className="h-full rounded-sm transition-all"
                  style={{ width: `${pct}%`, background: col, opacity: 0.8 }}
                />
              </div>
              <span className="text-[9px] font-bold tabular-nums" style={{ color: col, width: 36, flexShrink: 0, textAlign: 'right' }}>
                {b.count > 0 ? `${pct.toFixed(0)}%` : '—'}
              </span>
              <span className="text-[8px]" style={{ color: 'rgba(241,241,255,0.25)', width: 22, flexShrink: 0 }}>
                n={b.count}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Feature comparison table row ─────────────────────────────────────────────

function FeatureRow({ fs }: { fs: FeatureStat }) {
  const col   = fs.pctDiff > 0 ? '#22C55E' : '#EF4444'
  const arrow = fs.pctDiff > 0 ? '▲' : '▼'
  const fmt   = (v: number) =>
    fs.unit === 'ratio' ? v.toFixed(2) :
    fs.unit === 'pips'  ? v.toFixed(1) :
    fs.unit === 'min'   ? v.toFixed(0) + 'm' :
    v.toFixed(0)

  return (
    <div className="grid gap-2 py-1.5 px-2 rounded-md" style={{
      gridTemplateColumns: '1fr 64px 64px 52px',
      background: 'rgba(255,255,255,0.025)',
      border: '1px solid rgba(255,255,255,0.05)',
    }}>
      <span className="text-[10px]" style={{ color: 'rgba(241,241,255,0.65)' }}>{fs.label}</span>
      <span className="text-[10px] font-bold text-right tabular-nums" style={{ color: '#22C55E' }}>
        {fmt(fs.meanWins)}
      </span>
      <span className="text-[10px] font-bold text-right tabular-nums" style={{ color: '#EF4444' }}>
        {fmt(fs.meanLosses)}
      </span>
      <span className="text-[10px] font-bold text-right tabular-nums" style={{ color: Math.abs(fs.pctDiff) < 10 ? 'rgba(241,241,255,0.3)' : col }}>
        {arrow} {Math.abs(fs.pctDiff).toFixed(0)}%
      </span>
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function AiAnalysisPanel({
  trades, candles, pair, tfLabel, slMode, slPips, rrRatio, onClose,
}: Props) {
  const pipSize = pair.includes('JPY') || pair.includes('XAU') ? 0.01 : 0.0001

  const features = useMemo(
    () => extractFeatures(trades, candles, pipSize),
    [trades, candles, pipSize],
  )

  const analysis = useMemo(
    () => analyzeLocally(features),
    [features],
  )

  const [aiText,     setAiText]     = useState('')
  const [aiLoading,  setAiLoading]  = useState(false)
  const [aiError,    setAiError]    = useState<string | null>(null)
  const [copied,     setCopied]     = useState(false)
  const [startBalance, setStartBalance] = useState(100000)
  const [riskPct,      setRiskPct]      = useState(1.0)
  const [ftmoMode,     setFtmoMode]     = useState(false)
  const [startDate,    setStartDate]    = useState('')
  const [hoveredRow,   setHoveredRow]   = useState<number | null>(null)
  const textRef = useRef<HTMLDivElement>(null)

  // ── Equity curve ────────────────────────────────────────────────────────────
  const equityCurve = useMemo(() => {
    const allClosed = trades
      .filter(t => t.result === 'win' || t.result === 'loss')
      .slice()
      .sort((a, b) => a.entryTs - b.entryTs)
    const startTs = startDate ? new Date(startDate).getTime() : 0
    const closed = startDate ? allClosed.filter(t => new Date(t.sessionDate).getTime() >= startTs) : allClosed
    let balance = startBalance
    let peak    = startBalance
    let maxDd   = 0
    // FTMO: track daily P&L (trades grouped by sessionDate)
    const dailyRunning = new Map<string, number>()
    let maxDailyLoss   = 0
    let ftmoBreachIdx  = -1
    let ftmoMaxLoss    = 0
    // FTMO phase 1/2 milestones
    let phase1PassIdx  = -1  // row where +10% first hit
    let phase2PassIdx  = -1  // row where phase-2 notional +5% first hit
    let p2Bal          = startBalance
    let p2Active       = false
    const rows = closed.map((t, i) => {
      const prev    = balance
      if (t.result === 'win')  balance = balance * (1 + (riskPct / 100) * rrRatio)
      else                     balance = balance * (1 - riskPct / 100)
      peak  = Math.max(peak, balance)
      const dd = (peak - balance) / peak * 100
      if (dd > maxDd) maxDd = dd
      const pnlAmt = balance - prev
      const dayPnl = (dailyRunning.get(t.sessionDate) ?? 0) + pnlAmt
      dailyRunning.set(t.sessionDate, dayPnl)
      const dailyLossPct = Math.max(0, -dayPnl / startBalance * 100)
      if (dailyLossPct > maxDailyLoss) maxDailyLoss = dailyLossPct
      const ftmoLossPct = Math.max(0, (startBalance - balance) / startBalance * 100)
      if (ftmoLossPct > ftmoMaxLoss) ftmoMaxLoss = ftmoLossPct
      if (ftmoLossPct >= 10 && ftmoBreachIdx === -1) ftmoBreachIdx = i
      const dailyBreach = dailyLossPct >= 5
      const floorBreach = ftmoLossPct >= 10
      // Phase 1: first time balance >= startBalance * 1.10 without prior breach
      let p1Pass = false, p2Pass = false
      if (phase1PassIdx === -1 && ftmoBreachIdx === -1 && balance >= startBalance * 1.10) {
        phase1PassIdx = i; p1Pass = true; p2Active = true
      }
      // Phase 2: notional fresh 100K account running after phase 1 passed
      if (p2Active && !p1Pass && phase2PassIdx === -1) {
        if (t.result === 'win') p2Bal = p2Bal * (1 + (riskPct / 100) * rrRatio)
        else                    p2Bal = p2Bal * (1 - riskPct / 100)
        if (p2Bal >= startBalance * 1.05) { phase2PassIdx = i; p2Pass = true }
      }
      return { n: i + 1, date: t.sessionDate, dir: t.direction, result: t.result, balance, dd, pnlAmt, ftmoLossPct, dailyLossPct, dailyBreach, floorBreach, p1Pass, p2Pass }
    })
    const totalReturn = startBalance > 0 ? (balance - startBalance) / startBalance * 100 : 0
    return { rows, finalBalance: balance, totalReturn, maxDd, maxDailyLoss, ftmoMaxLoss, ftmoBreachIdx, phase1PassIdx, phase2PassIdx }
  }, [trades, startBalance, riskPct, rrRatio, startDate])

  // Auto-scroll AI response
  useEffect(() => {
    if (textRef.current) textRef.current.scrollTop = textRef.current.scrollHeight
  }, [aiText])

  async function copyPrompt() {
    const prompt = buildAiPrompt(features, analysis, pair, tfLabel, slMode, slPips, rrRatio)
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback: show in a textarea
      const ta = document.createElement('textarea')
      ta.value = prompt
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  async function askAi() {
    setAiLoading(true); setAiError(null); setAiText('')
    const prompt = buildAiPrompt(features, analysis, pair, tfLabel, slMode, slPips, rrRatio)

    try {
      const res = await fetch('/api/ai/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-opus-4-5',
          max_tokens: 1200,
          stream: true,
          messages: [{ role: 'user', content: prompt }],
        }),
      })

      if (!res.ok) {
        const body = await res.text()
        if (res.status === 404 || res.status === 502) {
          setAiError('AI proxy not reachable. Add ANTHROPIC_API_KEY to .env.local and restart the dev server.')
        } else if (res.status === 401) {
          setAiError('Invalid API key. Check ANTHROPIC_API_KEY in .env.local.')
        } else {
          setAiError(`Error ${res.status}: ${body.slice(0, 120)}`)
        }
        setAiLoading(false)
        return
      }

      // Read SSE stream
      const reader = res.body?.getReader()
      if (!reader) { setAiError('No stream'); setAiLoading(false); return }

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') continue
          try {
            const ev = JSON.parse(data)
            // Anthropic stream: content_block_delta
            if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
              setAiText(t => t + ev.delta.text)
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (e: unknown) {
      setAiError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setAiLoading(false)
    }
  }

  const isConfigured = (window as { __AI_CONFIGURED__?: boolean }).__AI_CONFIGURED__

  const { featureStats, quartileStats, topPatterns, closedCount, winCount, lossCount } = analysis
  const overallWr = closedCount > 0 ? (winCount / closedCount * 100) : 0

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col overflow-hidden"
      style={{ background: 'rgba(6,6,26,0.97)', backdropFilter: 'blur(6px)' }}
    >
      {/* ── Header ── */}
      <div
        className="flex-shrink-0 flex items-center gap-3 px-4 h-12"
        style={{ background: 'rgba(8,8,28,0.98)', borderBottom: '1px solid rgba(139,92,246,0.2)' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-black" style={{ color: '#A78BFA' }}>AI Analysis</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(139,92,246,0.15)', color: '#A78BFA', border: '1px solid rgba(139,92,246,0.25)' }}>
            {pair} · {tfLabel}
          </span>
        </div>
        <div className="flex items-center gap-3 ml-3" style={{ color: 'rgba(241,241,255,0.4)', fontSize: 11 }}>
          <span>{closedCount} trades</span>
          <span style={{ color: '#22C55E', fontWeight: 700 }}>{winCount}W</span>
          <span style={{ color: '#EF4444', fontWeight: 700 }}>{lossCount}L</span>
          <span style={{ fontWeight: 700, color: overallWr >= 50 ? '#22C55E' : '#EF4444' }}>{overallWr.toFixed(1)}%</span>
        </div>
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
          style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(241,241,255,0.6)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          ✕ Close
        </button>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 min-h-0 flex overflow-hidden">

        {/* ── Left: statistical analysis ── */}
        <div className="flex flex-col gap-4 p-4 overflow-y-auto" style={{ width: '55%', minWidth: 0, borderRight: '1px solid rgba(255,255,255,0.06)' }}>

          {closedCount === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2" style={{ color: 'rgba(241,241,255,0.3)' }}>
              <span className="text-2xl">📊</span>
              <span className="text-sm">No closed trades to analyse yet.</span>
              <span className="text-xs">Run the Crossfire backtest first.</span>
            </div>
          ) : (
            <>
              {/* Key patterns */}
              {topPatterns.length > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: '#A78BFA' }}>
                    Key Patterns Found
                  </span>
                  <div className="flex flex-col gap-1.5">
                    {topPatterns.map((p, i) => (
                      <div
                        key={i}
                        className="text-[10px] leading-relaxed px-3 py-2 rounded-lg"
                        style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.18)', color: 'rgba(241,241,255,0.75)' }}
                      >
                        {p}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Feature comparison */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  <span className="text-[9px] font-black uppercase tracking-widest flex-1" style={{ color: 'rgba(241,241,255,0.4)' }}>
                    Feature Comparison
                  </span>
                  <div className="grid gap-2 text-[8px] font-bold uppercase" style={{ gridTemplateColumns: '1fr 64px 64px 52px', color: 'rgba(241,241,255,0.3)' }}>
                    <span className="px-2">Feature</span>
                    <span className="text-right" style={{ color: '#22C55E' }}>Wins avg</span>
                    <span className="text-right" style={{ color: '#EF4444' }}>Loss avg</span>
                    <span className="text-right">Edge</span>
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  {featureStats.map(fs => <FeatureRow key={fs.feature} fs={fs} />)}
                </div>
              </div>

              {/* Quartile charts */}
              {quartileStats.length > 0 && (
                <div className="flex flex-col gap-3">
                  <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: 'rgba(241,241,255,0.4)' }}>
                    Win Rate by Quartile
                  </span>
                  <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
                    {quartileStats.map(qs => <QuartileChart key={qs.feature} qs={qs} />)}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Right: AI response ── */}
        <div className="flex flex-col gap-0" style={{ width: '45%', minWidth: 0 }}>

          {/* Equity config row */}
          <div
            className="flex-shrink-0 flex items-center gap-3 px-4 py-2 flex-wrap"
            style={{ background: 'rgba(8,8,28,0.9)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
          >
            <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: 'rgba(241,241,255,0.4)' }}>Equity Curve</span>
            <button
              onClick={() => setFtmoMode(f => !f)}
              className="px-2 py-0.5 rounded text-[9px] font-bold transition-all"
              style={{
                background: ftmoMode ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${ftmoMode ? 'rgba(245,158,11,0.5)' : 'rgba(255,255,255,0.1)'}`,
                color: ftmoMode ? '#F59E0B' : 'rgba(241,241,255,0.35)',
              }}
            >FTMO Rules</button>
            {startDate && (
              <div className="flex items-center gap-1">
                <span className="text-[9px] px-2 py-0.5 rounded font-bold" style={{ background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)', color: '#A78BFA' }}>
                  From {new Date(startDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}
                </span>
                <button onClick={() => setStartDate('')} className="text-[9px] px-1.5 py-0.5 rounded font-bold" style={{ color: '#F87171', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}>✕ Reset</button>
              </div>
            )}
            <div className="flex items-center gap-1">
              <span className="text-[9px]" style={{ color: 'rgba(241,241,255,0.3)' }}>Start £</span>
              <input
                type="number" value={startBalance}
                onChange={e => setStartBalance(Number(e.target.value))}
                className="w-20 px-1.5 py-0.5 rounded text-[10px] tabular-nums text-right"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(241,241,255,0.8)', outline: 'none' }}
              />
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[9px]" style={{ color: 'rgba(241,241,255,0.3)' }}>Risk %</span>
              <input
                type="number" value={riskPct} step={0.1} min={0.1} max={10}
                onChange={e => setRiskPct(Number(e.target.value))}
                className="w-12 px-1.5 py-0.5 rounded text-[10px] tabular-nums text-right"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(241,241,255,0.8)', outline: 'none' }}
              />
            </div>
            {equityCurve.rows.length > 0 && (
              <>
                <div className="w-px h-3" style={{ background: 'rgba(255,255,255,0.1)' }} />
                <span className="text-[10px] font-bold tabular-nums" style={{ color: equityCurve.totalReturn >= 0 ? '#4ADE80' : '#F87171' }}>
                  {equityCurve.totalReturn >= 0 ? '+' : ''}{equityCurve.totalReturn.toFixed(1)}%
                </span>
                <span className="text-[9px]" style={{ color: 'rgba(241,241,255,0.3)' }}>return</span>
                {!ftmoMode && <>
                  <span className="text-[10px] font-bold tabular-nums" style={{ color: '#F87171' }}>-{equityCurve.maxDd.toFixed(1)}%</span>
                  <span className="text-[9px]" style={{ color: 'rgba(241,241,255,0.3)' }}>max DD</span>
                </>}
                {ftmoMode && <>
                  <span className="text-[10px] font-bold tabular-nums" style={{ color: equityCurve.ftmoMaxLoss >= 10 ? '#EF4444' : equityCurve.ftmoMaxLoss >= 7 ? '#F59E0B' : '#4ADE80' }}>
                    -{equityCurve.ftmoMaxLoss.toFixed(1)}%
                  </span>
                  <span className="text-[9px]" style={{ color: 'rgba(241,241,255,0.3)' }}>vs floor (10% limit)</span>
                  <span className="text-[10px] font-bold tabular-nums" style={{ color: equityCurve.maxDailyLoss >= 5 ? '#EF4444' : equityCurve.maxDailyLoss >= 3.5 ? '#F59E0B' : '#4ADE80' }}>
                    -{equityCurve.maxDailyLoss.toFixed(1)}%
                  </span>
                  <span className="text-[9px]" style={{ color: 'rgba(241,241,255,0.3)' }}>worst day (5% limit)</span>
                  {equityCurve.ftmoBreachIdx >= 0 && (
                    <span className="text-[9px] px-2 py-0.5 rounded font-bold" style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', color: '#F87171' }}>
                      ✕ FAILS at trade #{equityCurve.ftmoBreachIdx + 1}
                    </span>
                  )}
                  {equityCurve.ftmoBreachIdx === -1 && equityCurve.rows.length > 0 && (
                    <span className="text-[9px] px-2 py-0.5 rounded font-bold" style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)', color: '#4ADE80' }}>
                      ✓ Passes FTMO limits
                    </span>
                  )}
                  {equityCurve.phase1PassIdx >= 0 && (
                    <span className="text-[9px] px-2 py-0.5 rounded font-bold" style={{ background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.4)', color: '#4ADE80' }}>
                      ✓ Phase 1 passed (trade #{equityCurve.phase1PassIdx + 1})
                    </span>
                  )}
                  {equityCurve.phase2PassIdx >= 0 && (
                    <span className="text-[9px] px-2 py-0.5 rounded font-bold" style={{ background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.4)', color: '#FCD34D' }}>
                      ✓ Phase 2 passed (trade #{equityCurve.phase2PassIdx + 1})
                    </span>
                  )}
                </>}
                <span className="text-[10px] font-bold tabular-nums" style={{ color: 'rgba(241,241,255,0.6)' }}>£{equityCurve.finalBalance.toLocaleString('en-GB', { maximumFractionDigits: 0 })}</span>
              </>
            )}
          </div>

          {/* AI header */}
          <div
            className="flex-shrink-0 flex items-center gap-3 px-4 py-2"
            style={{ background: 'rgba(8,8,28,0.8)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
          >
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#A78BFA' }}>
              Claude Analysis
            </span>
            <div className="flex-1" />
            {!isConfigured && (
              <span className="text-[9px] px-2 py-1 rounded" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', color: '#F59E0B' }}>
                needs ANTHROPIC_API_KEY
              </span>
            )}
            <button
              onClick={copyPrompt}
              disabled={closedCount === 0}
              className="px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all disabled:opacity-40"
              style={{
                background: copied ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${copied ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.1)'}`,
                color: copied ? '#4ADE80' : 'rgba(241,241,255,0.5)',
              }}
            >
              {copied ? '✓ Copied!' : '⎘ Copy prompt'}
            </button>
            <button
              onClick={askAi}
              disabled={aiLoading || closedCount === 0}
              className="px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all disabled:opacity-40"
              style={{
                background: aiLoading ? 'rgba(139,92,246,0.1)' : 'rgba(139,92,246,0.2)',
                border: '1px solid rgba(139,92,246,0.4)',
                color: '#A78BFA',
                cursor: aiLoading || closedCount === 0 ? 'not-allowed' : 'pointer',
              }}
            >
              {aiLoading ? '⟳ Thinking…' : '✦ Ask AI'}
            </button>
          </div>

          {/* AI response area */}
          <div
            ref={textRef}
            className="flex-1 overflow-y-auto px-4 py-3"
            style={{ minHeight: 0 }}
          >
            {aiError && (
              <div
                className="text-[10px] leading-relaxed p-3 rounded-lg mb-3"
                style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#F87171' }}
              >
                {aiError}
              </div>
            )}

            {!aiText && !aiLoading && !aiError && (
              equityCurve.rows.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-2" style={{ color: 'rgba(241,241,255,0.25)' }}>
                  <span className="text-2xl">📈</span>
                  <span className="text-[11px]">No closed trades yet.</span>
                </div>
              ) : (
                <table className="w-full text-[10px] border-collapse">
                  <thead className="sticky top-0" style={{ background: 'rgba(8,8,28,0.97)' }}>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                      <th className="text-left py-1.5 pr-2 font-bold tabular-nums" style={{ color: 'rgba(241,241,255,0.3)', width: 24 }}>#</th>
                      <th className="text-left py-1.5 pr-3 font-bold" style={{ color: 'rgba(241,241,255,0.3)' }}>Date</th>
                      <th className="text-center py-1.5 px-1 font-bold" style={{ color: 'rgba(241,241,255,0.3)', width: 28 }}>Dir</th>
                      <th className="text-center py-1.5 px-1 font-bold" style={{ color: 'rgba(241,241,255,0.3)', width: 28 }}>R</th>
                      <th className="text-right py-1.5 pl-2 font-bold" style={{ color: 'rgba(241,241,255,0.3)' }}>P&amp;L</th>
                      <th className="text-right py-1.5 pl-2 font-bold" style={{ color: 'rgba(241,241,255,0.3)' }}>Balance</th>
                      {!ftmoMode && <th className="text-right py-1.5 pl-2 font-bold" style={{ color: 'rgba(241,241,255,0.3)' }}>DD%</th>}
                      {ftmoMode && <>
                        <th className="text-right py-1.5 pl-2 font-bold" style={{ color: '#F59E0B' }}>vs Floor</th>
                        <th className="text-right py-1.5 pl-2 font-bold" style={{ color: '#F59E0B' }}>Day loss</th>
                      </>}
                    </tr>
                  </thead>
                  <tbody>
                    {equityCurve.rows.map(row => (
                      <>
                        {ftmoMode && row.p1Pass && (
                          <tr key={`p1-${row.n}`}>
                            <td colSpan={ftmoMode ? 8 : 7} className="py-1 px-2">
                              <div className="flex items-center gap-2">
                                <div className="flex-1 h-px" style={{ background: 'rgba(34,197,94,0.4)' }} />
                                <span className="text-[9px] font-black px-2 py-0.5 rounded" style={{ background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.4)', color: '#4ADE80', whiteSpace: 'nowrap' }}>
                                  🏁 PHASE 1 PASSED — +10% reached · £{row.balance.toLocaleString('en-GB', { maximumFractionDigits: 0 })}
                                </span>
                                <div className="flex-1 h-px" style={{ background: 'rgba(34,197,94,0.4)' }} />
                              </div>
                            </td>
                          </tr>
                        )}
                        {ftmoMode && row.p2Pass && (
                          <tr key={`p2-${row.n}`}>
                            <td colSpan={ftmoMode ? 8 : 7} className="py-1 px-2">
                              <div className="flex items-center gap-2">
                                <div className="flex-1 h-px" style={{ background: 'rgba(245,158,11,0.5)' }} />
                                <span className="text-[9px] font-black px-2 py-0.5 rounded" style={{ background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.5)', color: '#FCD34D', whiteSpace: 'nowrap' }}>
                                  🏆 PHASE 2 PASSED — FULLY FUNDED
                                </span>
                                <div className="flex-1 h-px" style={{ background: 'rgba(245,158,11,0.5)' }} />
                              </div>
                            </td>
                          </tr>
                        )}
                        <tr
                          key={`row-${row.n}`}
                          onClick={() => setStartDate(row.date)}
                          onMouseEnter={() => setHoveredRow(row.n)}
                          onMouseLeave={() => setHoveredRow(null)}
                          style={{
                            borderBottom: '1px solid rgba(255,255,255,0.04)',
                            background: hoveredRow === row.n
                              ? 'rgba(139,92,246,0.1)'
                              : ftmoMode && (row.floorBreach || row.dailyBreach) ? 'rgba(239,68,68,0.07)' : undefined,
                            cursor: 'pointer',
                          }}
                        >
                        <td className="py-1 pr-2 tabular-nums" style={{ color: 'rgba(241,241,255,0.25)' }}>{row.n}</td>
                        <td className="py-1 pr-3" style={{ color: hoveredRow === row.n ? '#A78BFA' : 'rgba(241,241,255,0.5)', whiteSpace: 'nowrap' }}>
                          {new Date(row.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                          {hoveredRow === row.n && <span className="ml-1 text-[8px]" style={{ color: '#A78BFA' }}>← start here</span>}
                        </td>
                        <td className="py-1 px-1 text-center">
                          <span className="px-1 rounded text-[9px] font-bold" style={{
                            background: row.dir === 'buy' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                            color: row.dir === 'buy' ? '#4ADE80' : '#F87171',
                          }}>{row.dir === 'buy' ? 'B' : 'S'}</span>
                        </td>
                        <td className="py-1 px-1 text-center">
                          <span className="px-1 rounded text-[9px] font-bold" style={{
                            background: row.result === 'win' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                            color: row.result === 'win' ? '#4ADE80' : '#F87171',
                          }}>{row.result === 'win' ? 'W' : 'L'}</span>
                        </td>
                        <td className="py-1 pl-2 text-right tabular-nums font-bold" style={{ color: row.result === 'win' ? '#4ADE80' : '#F87171' }}>
                          {row.pnlAmt >= 0 ? '+' : ''}£{row.pnlAmt.toLocaleString('en-GB', { maximumFractionDigits: 0 })}
                        </td>
                        <td className="py-1 pl-2 text-right tabular-nums" style={{ color: 'rgba(241,241,255,0.7)' }}>
                          £{row.balance.toLocaleString('en-GB', { maximumFractionDigits: 0 })}
                        </td>
                        {!ftmoMode && (
                          <td className="py-1 pl-2 text-right tabular-nums" style={{ color: row.dd > 5 ? '#F87171' : row.dd > 0 ? '#F59E0B' : '#4ADE80' }}>
                            {row.dd > 0 ? `-${row.dd.toFixed(1)}%` : '—'}
                          </td>
                        )}
                        {ftmoMode && <>
                          <td className="py-1 pl-2 text-right tabular-nums font-bold" style={{ color: row.floorBreach ? '#EF4444' : row.ftmoLossPct >= 7 ? '#F59E0B' : row.ftmoLossPct > 0 ? 'rgba(241,241,255,0.5)' : '#4ADE80' }}>
                            {row.ftmoLossPct > 0 ? `-${row.ftmoLossPct.toFixed(1)}%` : '—'}
                            {row.floorBreach && <span className="ml-1 text-[8px]">✕</span>}
                          </td>
                          <td className="py-1 pl-2 text-right tabular-nums font-bold" style={{ color: row.dailyBreach ? '#EF4444' : row.dailyLossPct >= 3.5 ? '#F59E0B' : row.dailyLossPct > 0 ? 'rgba(241,241,255,0.4)' : 'rgba(241,241,255,0.2)' }}>
                            {row.dailyLossPct > 0 ? `-${row.dailyLossPct.toFixed(1)}%` : '—'}
                            {row.dailyBreach && <span className="ml-1 text-[8px]">✕</span>}
                          </td>
                        </>}
                      </tr>
                      </>
                    ))}
                  </tbody>
                </table>
              )
            )}

            {(aiText || aiLoading) && (
              <div
                className="text-[11px] leading-relaxed whitespace-pre-wrap"
                style={{ color: 'rgba(241,241,255,0.82)', fontFamily: '"Inter", system-ui, sans-serif' }}
              >
                {aiText}
                {aiLoading && (
                  <span
                    className="inline-block w-1.5 h-3 ml-0.5 rounded-sm animate-pulse"
                    style={{ background: '#A78BFA', verticalAlign: 'text-bottom' }}
                  />
                )}
              </div>
            )}
          </div>

          {/* Setup instructions (collapsed if already configured) */}
          {!isConfigured && (
            <div
              className="flex-shrink-0 px-4 py-3 text-[9px] leading-relaxed"
              style={{ borderTop: '1px solid rgba(255,255,255,0.06)', color: 'rgba(241,241,255,0.3)' }}
            >
              <strong style={{ color: 'rgba(241,241,255,0.5)' }}>Setup:</strong>
              {' '}Get an API key at{' '}
              <span style={{ color: '#A78BFA' }}>console.anthropic.com</span>
              {' '}→ add{' '}
              <code style={{ fontFamily: 'monospace', color: '#F59E0B' }}>ANTHROPIC_API_KEY=sk-ant-…</code>
              {' '}to <code style={{ fontFamily: 'monospace' }}>.env.local</code> → restart dev server.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
