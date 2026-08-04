import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DAILY_MODEL_TOKENS_VERSION,
  getStatsCachePath,
  loadStatsCache,
  mergeCacheWithNewStats,
  type PersistedStatsCache,
  STATS_CACHE_VERSION,
} from '../../utils/statsCache.js'

function getEmptyCacheLike(): PersistedStatsCache {
  return {
    version: STATS_CACHE_VERSION,
    lastComputedDate: '2026-08-01',
    dailyActivity: [],
    dailyModelTokens: [],
    modelUsage: {},
    totalSessions: 0,
    totalMessages: 0,
    longestSession: null,
    firstSessionDate: null,
    hourCounts: {},
    totalSpeculationTimeSavedMs: 0,
  }
}

/**
 * The Stats panel counts cache read + cache write in its per-day token
 * buckets. Caches written before that change hold buckets computed by the old
 * input-plus-output formula, and STATS_CACHE_VERSION alone can't evict them —
 * migration preserves `dailyModelTokens` verbatim. `dailyModelTokensVersion`
 * is what marks them stale, so it must survive a load as `undefined`.
 */

let configDir: string
let originalConfigDir: string | undefined

beforeEach(() => {
  originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  configDir = mkdtempSync(join(tmpdir(), 'noa-stats-cache-'))
  process.env.CLAUDE_CONFIG_DIR = configDir
})

afterEach(() => {
  if (originalConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  }
  rmSync(configDir, { recursive: true, force: true })
})

function writeCache(cache: unknown): void {
  writeFileSync(getStatsCachePath(), JSON.stringify(cache))
}

const V4_CACHE = {
  version: 4,
  lastComputedDate: '2026-08-01',
  dailyActivity: [
    { date: '2026-08-01', messageCount: 3, sessionCount: 1, toolCallCount: 2 },
  ],
  // Computed by the pre-v5 formula: input + output only.
  dailyModelTokens: [
    { date: '2026-08-01', tokensByModel: { 'claude-sonnet-5': 3000 } },
  ],
  modelUsage: {},
  totalSessions: 1,
  totalMessages: 3,
  longestSession: null,
  firstSessionDate: '2026-08-01',
  hourCounts: { 9: 3 },
  totalSpeculationTimeSavedMs: 0,
}

describe('stats cache dailyModelTokens versioning', () => {
  test('a v4 cache migrates but is left marked as needing a rebuild', async () => {
    writeCache(V4_CACHE)
    const cache = await loadStatsCache()

    // History is preserved rather than discarded...
    expect(cache.version).toBe(STATS_CACHE_VERSION)
    expect(cache.totalSessions).toBe(1)
    expect(cache.dailyActivity).toHaveLength(1)

    // ...but the stale day buckets are flagged for rebuild.
    expect(cache.dailyModelTokensVersion).toBeUndefined()
    expect(cache.dailyModelTokensVersion ?? 0).toBeLessThan(
      DAILY_MODEL_TOKENS_VERSION,
    )
  })

  test('a current cache round-trips without asking for a rebuild', async () => {
    writeCache({
      ...V4_CACHE,
      version: STATS_CACHE_VERSION,
      dailyModelTokensVersion: DAILY_MODEL_TOKENS_VERSION,
    })
    const cache = await loadStatsCache()

    expect(cache.dailyModelTokensVersion).toBe(DAILY_MODEL_TOKENS_VERSION)
    expect(cache.dailyModelTokensVersion ?? 0).not.toBeLessThan(
      DAILY_MODEL_TOKENS_VERSION,
    )
  })

  test('a missing cache starts at the current formula version', async () => {
    const cache = await loadStatsCache()

    expect(cache.lastComputedDate).toBeNull()
    expect(cache.dailyModelTokensVersion).toBe(DAILY_MODEL_TOKENS_VERSION)
  })

  test('a pre-migratable cache is dropped entirely', async () => {
    writeCache({ ...V4_CACHE, version: 3 })
    const cache = await loadStatsCache()

    expect(cache.lastComputedDate).toBeNull()
    expect(cache.totalSessions).toBe(0)
    expect(cache.dailyModelTokensVersion).toBe(DAILY_MODEL_TOKENS_VERSION)
  })
})

const EMPTY_NEW_STATS = {
  dailyActivity: [],
  dailyModelTokens: [],
  modelUsage: {},
  sessionStats: [],
  hourCounts: {},
  totalSpeculationTimeSavedMs: 0,
}

describe('mergeCacheWithNewStats and the rebuild marker', () => {
  test('a stale marker survives a merge, so the rebuild still runs', () => {
    // Merging appends new days; it never recomputes the days already cached.
    // Stamping the marker current here would strand those stale day buckets.
    const stale = { ...getEmptyCacheLike(), dailyModelTokensVersion: undefined }
    const merged = mergeCacheWithNewStats(stale, EMPTY_NEW_STATS, '2026-08-02')

    expect(merged.dailyModelTokensVersion).toBeUndefined()
    expect(merged.dailyModelTokensVersion ?? 0).toBeLessThan(
      DAILY_MODEL_TOKENS_VERSION,
    )
  })

  test('a current marker is carried through a merge unchanged', () => {
    const fresh = {
      ...getEmptyCacheLike(),
      dailyModelTokensVersion: DAILY_MODEL_TOKENS_VERSION,
    }
    const merged = mergeCacheWithNewStats(fresh, EMPTY_NEW_STATS, '2026-08-02')

    expect(merged.dailyModelTokensVersion).toBe(DAILY_MODEL_TOKENS_VERSION)
  })
})
