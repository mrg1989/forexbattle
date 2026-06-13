// Admin API client for the Research Dashboard.
// Reads VITE_ADMIN_SECRET from import.meta.env — add it to .env.local and Vercel env vars.
// All calls go to /api/admin on the same origin (works in production and with `vercel dev`).

const BASE = '/api/admin'
const secret = () => (import.meta.env.VITE_ADMIN_SECRET as string | undefined) ?? ''

async function req<T>(
  method: 'GET' | 'POST',
  action: string,
  params: Record<string, string> = {},
  body?: object,
): Promise<T> {
  const qs = new URLSearchParams({ action, ...params }).toString()
  const res = await fetch(`${BASE}?${qs}`, {
    method,
    headers: {
      Authorization: `Bearer ${secret()}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const json: { success: boolean; data?: T; error?: string } = await res.json()
  if (!json.success) throw new Error(json.error ?? `Request failed: ${res.status}`)
  return json.data as T
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface BacktestRun {
  id: string
  symbol: string
  timeframe: string
  fromDate: string
  toDate: string
  status: string
  tradeCount: number
  winCount: number
  lossCount: number
  winRate: number | null
  startedAt: string
  completedAt: string | null
  strategyVersionId: string
}

export interface AnalyticsSummary {
  summaryType: string
  summaryJson: Record<string, unknown>
  createdAt: string
}

export interface FtmoResult {
  id: string
  backtestRunId: string
  accountSize: number
  riskPercent: number
  dailyLossLimit: number
  maxDrawdownLimit: number
  passed: boolean
  peakBalance: number
  worstDrawdown: number
  dailyBreachCount: number
  failureReason: string | null
  createdAt: string
  profitTarget: number | null
  finalBalance: number | null
}

export interface AiReview {
  id: string
  aiModel: string
  tokenCount: number | null
  recommendationCount: number
  createdAt: string
}

export interface Recommendation {
  id: string
  aiReviewId: string
  backtestRunId: string
  strategyVersionId: string
  rationale: string
  expectedBenefit: string
  proposedSettingsJson: Record<string, unknown>
  status: 'suggested' | 'approved' | 'rejected' | 'tested'
  createdAt: string
}

export interface PromptData {
  prompt: string
  backtestRunId: string
  strategyVersionId: string
  summaryCount: number
  ftmoResultCount: number
  autoReviewAvailable: boolean
}

// ── Methods ────────────────────────────────────────────────────────────────

export const adminApi = {
  getBacktestRuns: () =>
    req<{ runs: BacktestRun[] }>('GET', 'backtest-results'),

  getAnalytics: (backtestRunId: string) =>
    req<AnalyticsSummary[]>('GET', 'analytics-results', { backtestRunId }),

  getFtmoResults: (backtestRunId: string) =>
    req<FtmoResult[]>('GET', 'ftmo-results', { backtestRunId }),

  getAiReviews: (backtestRunId: string) =>
    req<AiReview[]>('GET', 'ai-review-results', { backtestRunId }),

  getRecommendations: (backtestRunId: string) =>
    req<Recommendation[]>('GET', 'recommendation-results', { backtestRunId }),

  generatePrompt: (backtestRunId: string) =>
    req<PromptData>('GET', 'generate-ai-prompt', { backtestRunId }),

  saveAiReview: (backtestRunId: string, responseText: string, aiModel?: string) =>
    req<{ reviewId: string; recommendationCount: number; parsedSuccessfully: boolean }>(
      'POST', 'save-ai-review', {}, { backtestRunId, responseText, aiModel },
    ),
}
