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
  const textRef = useRef<HTMLDivElement>(null)

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

          {/* AI header */}
          <div
            className="flex-shrink-0 flex items-center gap-3 px-4 py-3"
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
              <div className="flex flex-col items-center justify-center h-full gap-3" style={{ color: 'rgba(241,241,255,0.25)' }}>
                <div className="text-4xl" style={{ filter: 'grayscale(0.5)' }}>✦</div>
                <p className="text-[11px] text-center max-w-xs leading-relaxed">
                  The statistical analysis on the left is computed locally from your trade data.
                  Click <span style={{ color: '#A78BFA' }}>Ask AI</span> to get Claude's interpretation — it will identify the strongest patterns and suggest specific entry filters.
                </p>
                {!isConfigured && (
                  <p className="text-[10px] text-center max-w-xs leading-relaxed px-3 py-2 rounded-lg"
                     style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.15)', color: '#F59E0B' }}>
                    Add <code style={{ fontFamily: 'monospace' }}>ANTHROPIC_API_KEY=sk-ant-…</code> to <code style={{ fontFamily: 'monospace' }}>.env.local</code> and restart the dev server to enable AI analysis.
                  </p>
                )}
              </div>
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
