import { defineConfig } from 'prisma/config'
import { config } from 'dotenv'

// Load .env.local before reading process.env — Prisma CLI does not auto-load it
// (it only auto-loads .env). This keeps credentials in one place alongside OANDA vars.
config({ path: '.env.local' })

// Prisma 7: CLI configuration for migrations, schema push, and introspection.
// DIRECT_URL is the Supabase direct connection (bypasses PgBouncer pooler).
// This file is NOT imported at runtime — only used by the Prisma CLI.
// See: https://pris.ly/d/config-datasource
export default defineConfig({
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '',
  },
})
