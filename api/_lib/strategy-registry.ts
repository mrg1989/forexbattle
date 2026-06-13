import { db } from './db.js'

// Canonical Crossfire v1 settings. These match the hardcoded constants currently
// in src/utils/strategies.ts and the CrossfireEA.mq5 reference implementation.
// Changing any value here must be done as a new strategy version, never by editing this object.
export interface CrossfireSettings {
  symbol:                  string
  setupTimeUK:             string
  lineTimeframe:           string
  entryTimeframe:          string
  referenceStartTimeUK:    string
  entryMode:               string
  allowWickBreak:          boolean
  riskReward:              number
  stopLossMode:            string
  takeProfitMode:          string
  breakEvenAtR:            number | null
  maxTradesPerDay:         number
  previousHighDefinition:  string
  previousLowDefinition:   string
  tradingWindowEndUK:      string
  avoidNewsMinutesBefore:  number
  avoidNewsMinutesAfter:   number
}

export const CROSSFIRE_V1_SETTINGS: CrossfireSettings = {
  symbol:                  'EUR_USD',
  setupTimeUK:             '13:00',
  lineTimeframe:           'M15',
  entryTimeframe:          'M5',
  referenceStartTimeUK:    '08:00',
  entryMode:               'candle_close_beyond_line',
  allowWickBreak:          false,
  riskReward:              3,
  stopLossMode:            'dynamic',
  takeProfitMode:          'fixed_rr',
  breakEvenAtR:            null,
  maxTradesPerDay:         1,
  previousHighDefinition:  'highest_high_0800_1300',
  previousLowDefinition:   'lowest_low_0800_1300',
  tradingWindowEndUK:      '16:00',
  avoidNewsMinutesBefore:  0,
  avoidNewsMinutesAfter:   0,
}

// Returns the single active version for the named strategy, or null if the strategy
// doesn't exist or has no active version.
export async function getActiveStrategyVersion(strategyName: string) {
  const strategy = await db.strategy.findUnique({
    where: { name: strategyName },
    include: {
      versions: {
        where:   { isActive: true },
        orderBy: { versionNumber: 'desc' },
        take:    1,
      },
    },
  })
  if (!strategy) return null
  return strategy.versions[0] ?? null
}

// Creates a new strategy version and atomically deactivates the previous active version.
// Always inserts — never updates an existing version row.
export async function createStrategyVersion(
  strategyId: string,
  settings:   CrossfireSettings,
  notes:      string,
) {
  return db.$transaction(async tx => {
    await tx.strategyVersion.updateMany({
      where: { strategyId, isActive: true },
      data:  { isActive: false },
    })

    const latest = await tx.strategyVersion.findFirst({
      where:   { strategyId },
      orderBy: { versionNumber: 'desc' },
    })

    return tx.strategyVersion.create({
      data: {
        strategyId,
        versionNumber: (latest?.versionNumber ?? 0) + 1,
        settingsJson:  settings as object,
        isActive:      true,
        notes,
      },
    })
  })
}

// Idempotent: creates the Crossfire strategy and v1 if they don't exist.
// Safe to call multiple times — returns existing data without modification if already seeded.
export async function ensureCrossfireV1() {
  const strategy = await db.strategy.upsert({
    where:  { name: 'Crossfire' },
    update: {},
    create: {
      name:        'Crossfire',
      description: 'Crossfire trendline breakout — 13:00 UK setup, M15 lines, M5 entry, dynamic SL, 1:3 R:R',
      status:      'active',
    },
  })

  const existing = await db.strategyVersion.findFirst({
    where:   { strategyId: strategy.id },
    orderBy: { versionNumber: 'asc' },
  })

  if (existing) {
    return { strategy, version: existing, created: false }
  }

  const version = await db.strategyVersion.create({
    data: {
      strategyId:    strategy.id,
      versionNumber: 1,
      settingsJson:  CROSSFIRE_V1_SETTINGS as object,
      isActive:      true,
      notes:         'Initial version. Settings match current hardcoded constants in strategies.ts and CrossfireEA.mq5.',
    },
  })

  return { strategy, version, created: true }
}
