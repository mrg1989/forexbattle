import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Read .env.local directly — loadEnv doesn't expose non-VITE_ vars to process.env
function readEnvLocal(): Record<string, string> {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
    return Object.fromEntries(
      raw.split('\n')
        .filter(l => l && !l.startsWith('#') && l.includes('='))
        .map(l => {
          const idx = l.indexOf('=')
          return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()]
        })
    )
  } catch {
    return {}
  }
}

const env = readEnvLocal()
const oandaToken    = env.OANDA_TOKEN      ?? ''
const oandaAccount  = env.OANDA_ACCOUNT    ?? ''
const anthropicKey  = env.ANTHROPIC_API_KEY ?? ''
const isConfigured  = Boolean(oandaToken && oandaAccount)
const isAiConfigured = Boolean(anthropicKey)

if (isConfigured) {
  console.log(`[OANDA] Proxy configured for account ${oandaAccount}`)
} else {
  console.warn('[OANDA] No credentials found in .env.local — running in simulation mode')
}

if (isAiConfigured) {
  console.log('[AI] Anthropic proxy configured')
} else {
  console.warn('[AI] No ANTHROPIC_API_KEY in .env.local — AI analysis will be unavailable')
}

export default defineConfig({
  plugins: [react()],
  define: {
    __OANDA_ACCOUNT__:    JSON.stringify(oandaAccount),
    __OANDA_CONFIGURED__: JSON.stringify(isConfigured),
    __AI_CONFIGURED__:    JSON.stringify(isAiConfigured),
  },
  server: {
    proxy: {
      // Stream MUST be listed before /api/oanda (more specific wins)
      '/api/oanda-stream': {
        target: 'https://stream-fxpractice.oanda.com',
        changeOrigin: true,
        secure: false,
        rewrite: path => path.replace(/^\/api\/oanda-stream/, '/v3'),
        headers: { Authorization: `Bearer ${oandaToken}` },
      },
      // REST prices
      '/api/oanda': {
        target: 'https://api-fxpractice.oanda.com',
        changeOrigin: true,
        secure: false,
        rewrite: path => path.replace(/^\/api\/oanda/, '/v3'),
        headers: { Authorization: `Bearer ${oandaToken}`, 'Content-Type': 'application/json' },
      },
      // Anthropic Claude API — key stays server-side, never exposed to browser
      '/api/ai': {
        target: 'https://api.anthropic.com',
        changeOrigin: true,
        secure: true,
        rewrite: path => path.replace(/^\/api\/ai/, ''),
        headers: {
          'x-api-key':           anthropicKey,
          'anthropic-version':   '2023-06-01',
        },
      },
    },
  },
})
