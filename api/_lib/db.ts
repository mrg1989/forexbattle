import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

// Prisma 7 requires a driver adapter — the URL is no longer passed in schema.prisma.
// At runtime (Vercel serverless), DATABASE_URL is the Supabase transaction pooler URL.
// This file must only be imported from api/ serverless functions, never from src/components.

declare const globalThis: {
  prismaClient: PrismaClient | undefined
} & typeof global

function createClient(): PrismaClient {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const adapter = new PrismaPg(pool)
  return new PrismaClient({ adapter })
}

// Singleton: reuse in dev across HMR reloads; create fresh each cold start in prod.
export const db: PrismaClient = globalThis.prismaClient ?? createClient()

if (process.env.NODE_ENV !== 'production') {
  globalThis.prismaClient = db
}
