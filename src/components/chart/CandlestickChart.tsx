import { useRef, useEffect } from 'react'
import type { Candle } from '../../types'
import { formatPrice } from '../../utils/forex'
import type { LineOverlay } from '../../utils/strategies'

interface CandlestickChartProps {
  candles: Candle[]
  liveCandle: Candle | null
  pair: string
  predictionPrice: number | null
  phase: 'watching' | 'predicting' | 'resolving'
  marketResult?: 'up' | 'down' | null
  width: number
  height: number
  zoomPips?: number
  onNeedHistory?: (beforeMs: number) => void
  overlays?: LineOverlay[]
}

const NEON_UP   = '#22C55E'
const NEON_DOWN = '#EF4444'
const NEON_GOLD = '#F59E0B'
const BG        = '#06061A'
const PR = 72, PT = 14, PL = 4, PB = 22, VOL = 0.12

export default function CandlestickChart({
  candles, liveCandle, pair, predictionPrice, phase,
  width, height, zoomPips, onNeedHistory, overlays,
}: CandlestickChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // All viewport state in a single ref — mutated directly, no React re-renders
  const vp = useRef({
    slotW:         10,    // candle slot width in pixels (float)
    pixelOffset:   0,     // pixels panned back from live edge (float, ≥ 0)
    pipWindow:     null as number | null,
    priceShiftAmt: 0,     // price-unit vertical pan
    mouseX: -1, mouseY: -1,
  })

  // Always-current props ref — safe to read from event handlers
  const pr = useRef({ candles, liveCandle, pair, predictionPrice, phase, width, height, zoomPips, onNeedHistory, overlays })
  pr.current = { candles, liveCandle, pair, predictionPrice, phase, width, height, zoomPips, onNeedHistory, overlays }

  // History request dedup: only fire once per "near-edge" event
  const histPending    = useRef(false)
  const prevCandlesLen = useRef(0)
  const prevFirstTs    = useRef(0)   // tracks oldest candle ts to detect genuine prepends
  const lastRangeRef   = useRef(0.0001)

  // ── Draw ──────────────────────────────────────────────────────────────────
  function redraw() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    try {
      _redrawInner(canvas, ctx)
    } catch (err) {
      // Prevent a bad overlay value from killing the draw loop.
      // Clear to background so a blank canvas is never left partially drawn.
      ctx.restore() // in case save() was called
      ctx.fillStyle = BG
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      console.warn('[CandlestickChart] redraw error:', err)
    }
  }

  function _redrawInner(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {

    const { candles, liveCandle, pair, predictionPrice, phase, width, height, onNeedHistory, overlays } = pr.current
    const { slotW, pixelOffset, pipWindow, priceShiftAmt, mouseX, mouseY } = vp.current
    if (width === 0 || height === 0 || slotW === 0) return

    const dpr = window.devicePixelRatio || 1
    canvas.width  = width  * dpr
    canvas.height = height * dpr
    ctx.scale(dpr, dpr)

    const all    = liveCandle ? [...candles, liveCandle] : candles
    if (all.length === 0) return

    const chartH = height - PT - PB
    const priceH = chartH * (1 - VOL)
    const volH   = chartH * VOL
    const volTop = PT + priceH
    const chartW = width - PL - PR

    // Candle position formula:
    // x(i) = PL + chartW - slotW*0.5 - (all.length-1-i)*slotW + pixelOffset
    // Visible range:
    const iMin = Math.max(0, Math.floor(all.length - 1 - (chartW + pixelOffset) / slotW))
    const iMax = Math.min(all.length - 1, Math.ceil(all.length - 1 + pixelOffset / slotW + 1))

    // Near left edge → request older history (once per gap)
    if (iMin < 15 && !histPending.current && all.length > 0 && onNeedHistory) {
      histPending.current = true
      onNeedHistory(all[0].timestamp)
    }

    // Price range from visible candles
    const pipSize = pair.includes('JPY') ? 0.01 : 0.0001
    let priceMax: number, priceMin: number
    if (pipWindow !== null) {
      const last = all[Math.min(iMax, all.length - 1)].close
      priceMax = last + pipWindow * pipSize
      priceMin = last - pipWindow * pipSize
    } else {
      const vis = all.slice(iMin, iMax + 1)
      priceMax = Math.max(...vis.map(c => c.high))
      priceMin = Math.min(...vis.map(c => c.low))
      const pad = (priceMax - priceMin) * 0.12 || pipSize * 10
      priceMax += pad; priceMin -= pad
    }
    // Apply vertical pan — no clamp; double-click resets if you drift too far.
    priceMax += priceShiftAmt; priceMin += priceShiftAmt
    const range    = priceMax - priceMin || 0.0001
    lastRangeRef.current = range
    const priceToY = (p: number) => PT + priceH - ((p - priceMin) / range) * priceH
    const yToPrice = (y: number) => priceMin + (1 - (y - PT) / priceH) * range

    // ── Background ────────────────────────────────────────────────────────
    ctx.fillStyle = BG; ctx.fillRect(0, 0, width, height)
    ctx.fillStyle = 'rgba(28,42,64,0.2)'
    for (let gx = PL; gx < PL + chartW; gx += 20)
      for (let gy = PT; gy < PT + priceH; gy += 20)
        ctx.fillRect(gx, gy, 1, 1)

    // ── Price axis: dynamic step size ────────────────────────────────────
    const targetLines = Math.max(4, Math.floor(priceH / 45))
    const rawStep     = range / targetLines
    const mag         = Math.pow(10, Math.floor(Math.log10(rawStep)))
    const niceStep    = [1,2,2.5,5,10].map(f => f * mag).find(s => s >= rawStep) ?? rawStep
    const startP      = Math.ceil(priceMin / niceStep) * niceStep

    ctx.font = '9px "Inter",monospace'; ctx.textAlign = 'left'
    for (let p = startP; p <= priceMax + niceStep * 0.01; p += niceStep) {
      const y = priceToY(p)
      if (y < PT - 2 || y > PT + priceH + 2) continue
      ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 0.5
      ctx.beginPath(); ctx.moveTo(PL, y); ctx.lineTo(width - PR, y); ctx.stroke()
      ctx.fillStyle = 'rgba(77,96,128,0.85)'
      ctx.fillText(formatPrice(p, pair), width - PR + 4, y + 3)
    }

    // ── Time axis ─────────────────────────────────────────────────────────
    ctx.textAlign = 'center'
    const labelEvery      = Math.max(1, Math.round(80 / slotW))
    const tfMs            = all.length > 1 ? all[1].timestamp - all[0].timestamp : 10000
    const labelIntervalMs = labelEvery * tfMs
    const MONTHS          = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

    if (labelIntervalMs >= 6 * 3600_000) {
      // ── Day-scale: one label per calendar day, month name on the 1st ──
      let lastDayKey = -1
      for (let i = iMin; i <= iMax; i++) {
        const d      = new Date(all[i].timestamp)
        const dayKey = d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate()
        if (dayKey === lastDayKey) continue
        lastDayKey = dayKey
        const x = PL + chartW - slotW * 0.5 - (all.length - 1 - i) * slotW + pixelOffset
        if (x < PL + 10 || x > PL + chartW - 10) continue
        // Subtle day-boundary grid line
        ctx.save(); ctx.setLineDash([2, 4])
        ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 0.5
        ctx.beginPath(); ctx.moveTo(x, PT); ctx.lineTo(x, PT + priceH); ctx.stroke()
        ctx.restore()
        const isFirst = d.getDate() === 1
        ctx.fillStyle = isFirst ? 'rgba(167,139,250,0.9)' : 'rgba(100,120,150,0.8)'
        ctx.font      = isFirst ? 'bold 9px "Inter",monospace' : '8px "Inter",monospace'
        ctx.fillText(isFirst ? MONTHS[d.getMonth()] : `${d.getDate()}`, x, height - 5)
      }
    } else {
      // ── Time-scale: evenly spaced, upgrade to date label at midnight ──
      ctx.font = '8px "Inter",monospace'
      for (let i = iMin; i <= iMax; i++) {
        if ((all.length - 1 - i) % labelEvery !== 0) continue
        const x = PL + chartW - slotW * 0.5 - (all.length - 1 - i) * slotW + pixelOffset
        if (x < PL + 24 || x > PL + chartW - 24) continue
        const d       = new Date(all[i].timestamp)
        const prevDay = i > 0 ? new Date(all[i - 1].timestamp).getDate() : d.getDate()
        const hh      = d.getHours().toString().padStart(2,'0')
        const mm      = d.getMinutes().toString().padStart(2,'0')
        const ss      = d.getSeconds().toString().padStart(2,'0')
        if (d.getDate() !== prevDay && labelIntervalMs >= 60_000) {
          // Midnight crossing — show date instead of time
          const isFirst = d.getDate() === 1
          ctx.fillStyle = 'rgba(167,139,250,0.85)'
          ctx.font      = 'bold 8px "Inter",monospace'
          ctx.fillText(isFirst ? MONTHS[d.getMonth()] : `${d.getDate()}`, x, height - 5)
          ctx.font = '8px "Inter",monospace'
        } else {
          ctx.fillStyle = 'rgba(77,96,128,0.7)'
          ctx.fillText(labelIntervalMs >= 60_000 ? `${hh}:${mm}` : `${hh}:${mm}:${ss}`, x, height - 5)
        }
      }
    }

    // ── Volume ────────────────────────────────────────────────────────────
    const maxVol = Math.max(...all.slice(iMin, iMax+1).map(c => c.volume), 1)
    const bodyW  = Math.max(1.5, slotW * 0.56)
    const wickW  = Math.max(0.8, bodyW * 0.12)

    for (let i = iMin; i <= iMax; i++) {
      const c = all[i]
      const x = PL + chartW - slotW * 0.5 - (all.length - 1 - i) * slotW + pixelOffset
      if (x + bodyW < PL || x - bodyW > PL + chartW) continue
      const bh = (c.volume / maxVol) * volH * 0.8
      ctx.fillStyle = c.close >= c.open ? 'rgba(34,197,94,0.10)' : 'rgba(239,68,68,0.10)'
      ctx.fillRect(x - bodyW/2, volTop + volH - bh, bodyW, bh)
    }

    // ── Candles ───────────────────────────────────────────────────────────
    for (let i = iMin; i <= iMax; i++) {
      const c      = all[i]
      const isLive = liveCandle !== null && i === all.length - 1
      const isUp   = c.close >= c.open
      const full   = isUp ? NEON_UP : NEON_DOWN
      const dim    = isUp ? 'rgba(34,197,94,0.55)' : 'rgba(239,68,68,0.55)'
      const col    = isLive ? full : dim
      const x      = PL + chartW - slotW * 0.5 - (all.length - 1 - i) * slotW + pixelOffset
      if (x + bodyW < PL || x - bodyW > PL + chartW) continue

      const openY  = priceToY(c.open), closeY = priceToY(c.close)
      const highY  = priceToY(c.high),  lowY   = priceToY(c.low)
      const bTop   = Math.min(openY, closeY)
      const bH     = Math.max(1.5, Math.abs(openY - closeY))

      ctx.strokeStyle = col; ctx.lineWidth = wickW
      ctx.beginPath(); ctx.moveTo(x, highY); ctx.lineTo(x, lowY); ctx.stroke()
      ctx.fillStyle = col; ctx.fillRect(x - bodyW/2, bTop, bodyW, bH)

      if (isLive) {
        ctx.shadowBlur = 10; ctx.shadowColor = full
        ctx.fillRect(x - bodyW/2, bTop, bodyW, bH); ctx.shadowBlur = 0
      }
    }

    // ── Strategy overlays ─────────────────────────────────────────────────
    if (overlays && overlays.length > 0) {
      // Candle-index-aware timestamp → x.
      // The chart is SLOT-based (each candle occupies one slot regardless of
      // wall-clock gaps like weekends). Using linear time produces wrong pixel
      // positions for any candle not near the live edge. Instead, binary-search
      // the candle array for the two surrounding candles and interpolate on
      // their slot indices — gaps disappear automatically.
      const n = all.length
      const tfMs2 = n > 1 ? all[1].timestamp - all[0].timestamp : 900_000

      const tsToFracIdx = (t: number): number => {
        if (n === 0) return 0
        if (t <= all[0].timestamp) {
          return (t - all[0].timestamp) / tfMs2         // extrapolate left
        }
        if (t >= all[n - 1].timestamp) {
          return n - 1 + (t - all[n - 1].timestamp) / tfMs2  // extrapolate right
        }
        // Binary search for bracketing candles
        let lo = 0, hi = n - 1
        while (lo < hi - 1) {
          const mid = (lo + hi) >> 1
          if (all[mid].timestamp <= t) lo = mid; else hi = mid
        }
        // Interpolate fractional index between lo and hi
        const span = all[hi].timestamp - all[lo].timestamp
        return lo + (span > 0 ? (t - all[lo].timestamp) / span : 0)
      }

      const tsToX = (t: number): number => {
        const fi = tsToFracIdx(t)
        return PL + chartW - slotW * 0.5 - (n - 1 - fi) * slotW + pixelOffset
      }

      ctx.save()
      // Clip drawing to chart body only
      ctx.beginPath(); ctx.rect(PL, PT, chartW, priceH); ctx.clip()

      for (const ov of overlays) {
        const x1 = tsToX(ov.x1Ms)
        const x2 = tsToX(ov.x2Ms)

        // ── Zone fill (background rect) ─────────────────────────────────────
        if (ov.fillZone) {
          const fx1 = Math.max(PL, Math.min(x1, x2))
          const fx2 = Math.min(PL + chartW, Math.max(x1, x2))
          if (fx2 > fx1) {
            ctx.fillStyle = ov.fillColor ?? 'rgba(139,92,246,0.07)'
            if (ov.priceBound) {
              const ry1 = priceToY(Math.max(ov.y1, ov.y2))
              const ry2 = priceToY(Math.min(ov.y1, ov.y2))
              ctx.fillRect(fx1, ry1, fx2 - fx1, ry2 - ry1)
              // border outline
              ctx.strokeStyle = ov.color
              ctx.lineWidth   = ov.lineWidth ?? 1
              ctx.setLineDash(ov.dashPattern ?? [])
              ctx.shadowBlur  = 4; ctx.shadowColor = ov.color
              ctx.strokeRect(fx1, ry1, fx2 - fx1, ry2 - ry1)
              ctx.shadowBlur = 0
              if (ov.label) {
                ctx.setLineDash([])
                ctx.font      = 'bold 9px "Inter",monospace'
                ctx.fillStyle = ov.color
                ctx.textAlign = 'left'
                ctx.fillText(ov.label, fx1 + 3, ry1 + 11)
              }
            } else {
              ctx.fillRect(fx1, PT, fx2 - fx1, priceH)
            }
          }
          continue
        }

        // ── Entry arrow marker ───────────────────────────────────────────────
        if (ov.markerType) {
          if (x1 < PL || x1 > PL + chartW) continue
          const cy  = priceToY(ov.y1)
          if (cy < PT || cy > PT + priceH) continue
          const isBuy = ov.markerType === 'buy'
          const mc    = isBuy ? '#22C55E' : '#EF4444'
          const sz = 6, gap = 9, h = 13
          ctx.save()
          ctx.fillStyle   = mc
          ctx.shadowBlur  = 12
          ctx.shadowColor = mc
          ctx.beginPath()
          if (isBuy) {
            ctx.moveTo(x1,      cy + gap)
            ctx.lineTo(x1 - sz, cy + gap + h)
            ctx.lineTo(x1 + sz, cy + gap + h)
          } else {
            ctx.moveTo(x1 - sz, cy - gap - h)
            ctx.lineTo(x1 + sz, cy - gap - h)
            ctx.lineTo(x1,      cy - gap)
          }
          ctx.closePath()
          ctx.fill()

          // W / L outcome chip above (buy) or below (sell) the arrow
          if (ov.tradeResult === 'win' || ov.tradeResult === 'loss') {
            const chipText = ov.tradeResult === 'win' ? 'W' : 'L'
            const chipCol  = ov.tradeResult === 'win' ? '#22C55E' : '#EF4444'
            const chipBg   = ov.tradeResult === 'win' ? 'rgba(34,197,94,0.18)' : 'rgba(239,68,68,0.18)'
            const chipW = 14, chipH = 12
            const chipX = x1 - chipW / 2
            const chipY = isBuy ? cy + gap + h + 3 : cy - gap - h - chipH - 3
            ctx.shadowBlur = 0
            ctx.fillStyle = chipBg
            if (ctx.roundRect) ctx.roundRect(chipX, chipY, chipW, chipH, 3)
            else               ctx.rect(chipX, chipY, chipW, chipH)
            ctx.fill()
            ctx.fillStyle = chipCol
            ctx.font = 'bold 8px "Inter",monospace'
            ctx.textAlign = 'center'
            ctx.fillText(chipText, x1, chipY + chipH - 2.5)
          }

          ctx.restore()
          continue
        }

        const y1 = ov.fullHeight ? PT         : priceToY(ov.y1)
        const y2 = ov.fullHeight ? PT + priceH : priceToY(ov.y2)

        // Skip lines entirely outside the visible area
        if (Math.max(x1, x2) < PL || Math.min(x1, x2) > PL + chartW) continue

        ctx.beginPath()
        ctx.strokeStyle = ov.color
        ctx.lineWidth   = ov.lineWidth ?? 1
        ctx.setLineDash(ov.dashPattern ?? [])
        ctx.shadowBlur  = 8
        ctx.shadowColor = ov.color
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
        ctx.stroke()
        ctx.shadowBlur = 0

        if (ov.label) {
          ctx.setLineDash([])
          ctx.font      = 'bold 9px "Inter",monospace'
          ctx.fillStyle = ov.color
          ctx.textAlign = 'left'
          const lx = Math.max(x1, PL + 4)
          const ly = ov.fullHeight
            ? PT + 13
            : Math.min(Math.max(y1 - 5, PT + 11), PT + priceH - 4)
          ctx.fillText(ov.label, lx, ly)
        }
      }
      ctx.restore()
    }

    // ── Prediction line ───────────────────────────────────────────────────
    if (predictionPrice !== null) {
      const py = priceToY(predictionPrice)
      ctx.save(); ctx.setLineDash([6,4])
      ctx.strokeStyle = NEON_GOLD; ctx.lineWidth = 1.5
      ctx.shadowBlur = 6; ctx.shadowColor = NEON_GOLD
      ctx.beginPath(); ctx.moveTo(PL, py); ctx.lineTo(width - PR, py); ctx.stroke()
      ctx.restore()
      ctx.fillStyle = NEON_GOLD; ctx.font = 'bold 9px "Inter",monospace'; ctx.textAlign = 'left'
      ctx.fillText('ENTRY', PL + 4, py - 3)
    }

    // ── Live price line + label ───────────────────────────────────────────
    const last = liveCandle ?? (candles.length ? candles[candles.length-1] : null)
    if (last) {
      const cy   = priceToY(last.close)
      const pcol = last.close >= last.open ? NEON_UP : NEON_DOWN
      ctx.save(); ctx.setLineDash([3,3])
      ctx.strokeStyle = `${pcol}55`; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(PL, cy); ctx.lineTo(width - PR, cy); ctx.stroke()
      ctx.restore()
      const str = formatPrice(last.close, pair)
      const lH = 16, lW = PR - 2, lx = width - PR + 2
      ctx.save(); ctx.shadowBlur = 8; ctx.shadowColor = pcol
      ctx.fillStyle = pcol
      if (ctx.roundRect) ctx.roundRect(lx, cy - lH/2, lW, lH, 2)
      else               ctx.rect(lx, cy - lH/2, lW, lH)
      ctx.fill(); ctx.restore()
      ctx.fillStyle = BG; ctx.font = 'bold 9px "Inter",monospace'; ctx.textAlign = 'center'
      ctx.fillText(str, lx + lW/2, cy + 3.5)
    }

    // ── Resolving zone ────────────────────────────────────────────────────
    if (phase === 'resolving' && predictionPrice !== null && last) {
      const py = priceToY(predictionPrice), cy = priceToY(last.close)
      ctx.fillStyle = last.close > predictionPrice ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)'
      ctx.fillRect(PL, Math.min(py,cy), chartW, Math.abs(py-cy))
    }

    // ── Crosshair ─────────────────────────────────────────────────────────
    if (mouseX >= PL && mouseX <= PL + chartW && mouseY >= PT && mouseY <= PT + priceH) {
      ctx.save(); ctx.setLineDash([4,4])
      ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 0.8
      ctx.beginPath(); ctx.moveTo(mouseX, PT); ctx.lineTo(mouseX, PT + priceH); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(PL, mouseY); ctx.lineTo(width - PR, mouseY); ctx.stroke()
      ctx.restore()

      // Price label on axis
      const hp = yToPrice(mouseY)
      const hStr = formatPrice(hp, pair)
      const lH2 = 15, lW2 = PR - 2, lx2 = width - PR + 2
      ctx.fillStyle = 'rgba(241,241,255,0.92)'
      if (ctx.roundRect) ctx.roundRect(lx2, mouseY - lH2/2, lW2, lH2, 2)
      else               ctx.rect(lx2, mouseY - lH2/2, lW2, lH2)
      ctx.fill()
      ctx.fillStyle = '#06061A'; ctx.font = 'bold 9px "Inter",monospace'; ctx.textAlign = 'center'
      ctx.fillText(hStr, lx2 + lW2/2, mouseY + 3.5)

      // Time label at bottom
      const iCursor = Math.round(all.length - 1 - (PL + chartW - slotW * 0.5 - mouseX + pixelOffset) / slotW)
      if (iCursor >= 0 && iCursor < all.length) {
        const d = new Date(all[iCursor].timestamp)
        const tStr = d.toLocaleTimeString([], { hour12: false })
        ctx.font = 'bold 8px "Inter",monospace'
        const tw = ctx.measureText(tStr).width + 10
        ctx.fillStyle = 'rgba(241,241,255,0.92)'
        ctx.fillRect(mouseX - tw/2, height - PB, tw, PB)
        ctx.fillStyle = '#06061A'; ctx.textAlign = 'center'
        ctx.fillText(tStr, mouseX, height - 5)
      }
    }

    // ── History-pan banner ────────────────────────────────────────────────
    if (pixelOffset > chartW * 0.15 && all[iMin]) {
      const d = new Date(all[iMin].timestamp)
      ctx.fillStyle = 'rgba(245,158,11,0.5)'; ctx.font = 'bold 9px "Inter",monospace'; ctx.textAlign = 'left'
      ctx.fillText(`◀  ${d.toLocaleTimeString([], {hour12:false})}  ·  dbl-click to jump live`, PL + 6, PT + 12)
    }
  }

  const redrawRef = useRef(redraw)
  redrawRef.current = redraw

  // Redraw whenever props change.
  // Only clear histPending when candles were genuinely PREPENDED (older data loaded) —
  // i.e. the first candle's timestamp decreased. A candle ROLL appends to the end and
  // should NOT clear histPending; doing so was causing repeated refetches while scrolled back.
  useEffect(() => {
    const { candles } = pr.current
    if (candles.length > 0) {
      const ft = candles[0].timestamp
      if (prevFirstTs.current === 0 || ft < prevFirstTs.current) {
        // Genuine prepend (history loaded) — allow next edge-trigger
        prevFirstTs.current = ft
        histPending.current = false
      }
      prevCandlesLen.current = candles.length
    }
    redrawRef.current()
  })

  // Sync external zoomPips prop
  useEffect(() => { vp.current.pipWindow = zoomPips ?? null; redrawRef.current() }, [zoomPips])

  // Set initial slotW from width
  useEffect(() => {
    if (width > 0) { vp.current.slotW = (width - PL - PR) / 60; redrawRef.current() }
  }, [width])

  // ── Event listeners (attached once — read state via refs) ─────────────────
  useEffect(() => {
    const canvas = canvasRef.current!
    let dragging = false, dragPA = false
    let lastX = 0, lastY = 0, dragStartPip = 20

    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const rect   = canvas.getBoundingClientRect()
      const cx     = e.clientX - rect.left
      const { width } = pr.current
      const chartW = width - PL - PR
      const onPA   = cx > PL + chartW

      // Normalize delta: works naturally for both trackpads (small) and wheels (large)
      const norm = Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY) * 0.08, 8)

      if (onPA) {
        // Vertical price zoom
        vp.current.pipWindow = Math.max(2, Math.min(3000,
          (vp.current.pipWindow ?? 20) * (1 + norm * 0.007)))
      } else {
        // Time zoom — keep candle under mouse pinned in place
        const old  = vp.current.slotW
        // norm > 0 (scroll down/out) → more candles → smaller slot
        // norm < 0 (scroll up/in)   → fewer candles → larger slot
        const next = Math.max(2, Math.min(150, old * (1 - norm * 0.013)))

        const { candles, liveCandle } = pr.current
        const all = liveCandle ? [...candles, liveCandle] : candles
        // Candle index conceptually under the mouse
        const i_cx = all.length - 1 - (PL + chartW - old * 0.5 - cx + vp.current.pixelOffset) / old
        // New pixelOffset so i_cx stays at same canvas x
        const newOff = cx - PL - chartW + next * 0.5 + (all.length - 1 - i_cx) * next

        vp.current.slotW       = next
        vp.current.pixelOffset = Math.max(0, newOff)
      }
      redrawRef.current()
    }

    function onMouseDown(e: MouseEvent) {
      if (e.button !== 0) return
      const rect = canvas.getBoundingClientRect()
      const cx   = e.clientX - rect.left
      const cw   = pr.current.width - PL - PR
      if (cx > PL + cw) {
        dragPA = true; lastY = e.clientY
        dragStartPip = vp.current.pipWindow ?? 20
        canvas.style.cursor = 'ns-resize'
      } else {
        dragging = true; lastX = e.clientX; lastY = e.clientY
        canvas.style.cursor = 'grabbing'
      }
    }

    function onMouseMove(e: MouseEvent) {
      const rect = canvas.getBoundingClientRect()
      vp.current.mouseX = e.clientX - rect.left
      vp.current.mouseY = e.clientY - rect.top
      const cw = pr.current.width - PL - PR

      if (dragging) {
        // Natural grab: drag right = older candles (paper follows hand)
        const dx = e.clientX - lastX; lastX = e.clientX
        const dy = e.clientY - lastY; lastY = e.clientY
        vp.current.pixelOffset = Math.max(0, vp.current.pixelOffset + dx)
        // Vertical pan: follow cursor (drag down = candles go down)
        const priceH2 = (pr.current.height - PT - PB) * (1 - VOL)
        vp.current.priceShiftAmt += (dy / priceH2) * lastRangeRef.current
        canvas.style.cursor = 'grabbing'
      } else if (dragPA) {
        const dy = e.clientY - lastY; lastY = e.clientY
        vp.current.pipWindow = Math.max(2, Math.min(3000,
          (vp.current.pipWindow ?? dragStartPip) * (1 + dy * 0.007)))
        canvas.style.cursor = 'ns-resize'
      } else {
        canvas.style.cursor = vp.current.mouseX > PL + cw ? 'ns-resize' : 'crosshair'
      }
      redrawRef.current()
    }

    function onMouseUp()    { dragging = false; dragPA = false }
    function onMouseLeave() {
      dragging = false; dragPA = false
      vp.current.mouseX = -1; vp.current.mouseY = -1
      redrawRef.current()
    }
    function onDblClick()   { vp.current.pixelOffset = 0; vp.current.priceShiftAmt = 0; redrawRef.current() }

    canvas.addEventListener('wheel',      onWheel,     { passive: false })
    canvas.addEventListener('mousedown',  onMouseDown)
    window.addEventListener('mousemove',  onMouseMove)
    window.addEventListener('mouseup',    onMouseUp)
    canvas.addEventListener('mouseleave', onMouseLeave)
    canvas.addEventListener('dblclick',   onDblClick)
    canvas.style.cursor = 'crosshair'

    return () => {
      canvas.removeEventListener('wheel',      onWheel)
      canvas.removeEventListener('mousedown',  onMouseDown)
      window.removeEventListener('mousemove',  onMouseMove)
      window.removeEventListener('mouseup',    onMouseUp)
      canvas.removeEventListener('mouseleave', onMouseLeave)
      canvas.removeEventListener('dblclick',   onDblClick)
    }
  }, [])

  return <canvas ref={canvasRef} style={{ width, height, display: 'block' }} />
}
