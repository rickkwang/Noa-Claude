import { beforeEach, describe, expect, mock, test } from 'bun:test'

// The keychain read path is what feeds every MCP server's OAuth bearer token
// (they all live in one credentials blob). A transient `security` failure that
// gets cached as null makes tokens() return undefined, the MCP SDK omit the
// Authorization header, and every server answer 401 — for the full cache TTL,
// which reads as "authentication never completed".

type ExecResult = { stdout: string; stderr: string; code: number }

let execQueue: ExecResult[] = []
let execCalls = 0

mock.module('../../../utils/execFileNoThrow.js', () => ({
  execFileNoThrow: async () => {
    execCalls++
    const next = execQueue.shift()
    if (!next) throw new Error('unexpected extra `security` spawn')
    return next
  },
  execSyncWithDefaults_DEPRECATED: () => null,
}))

const { macOsKeychainStorage } = await import(
  '../../../utils/secureStorage/macOsKeychainStorage.js'
)
const { keychainCacheState, KEYCHAIN_FAILURE_COOLDOWN_MS } = await import(
  '../../../utils/secureStorage/macOsKeychainHelpers.js'
)

const STORED = { claudeAiOauth: { accessToken: 'tok' } }

function ok(data: unknown): ExecResult {
  return { stdout: JSON.stringify(data), stderr: '', code: 0 }
}
const NOT_FOUND: ExecResult = { stdout: '', stderr: '', code: 44 }
// execa leaves exitCode undefined when it SIGTERMs a timed-out process, which
// execFileNoThrow reports as code 1.
const TIMED_OUT: ExecResult = { stdout: '', stderr: '', code: 1 }

/** Seed a warm cache without spawning, then expire it. */
function seedExpiredCache(data: unknown | null) {
  keychainCacheState.cache = { data, cachedAt: 1 }
  keychainCacheState.generation = 0
  keychainCacheState.readInFlight = null
  keychainCacheState.lastReadFailure = null
}

beforeEach(() => {
  execQueue = []
  execCalls = 0
  seedExpiredCache(null)
})

describe('macOsKeychainStorage.readAsync transient failure handling', () => {
  test('serves the stale value and does not cache a null', async () => {
    seedExpiredCache(STORED)
    execQueue = [TIMED_OUT]

    expect(await macOsKeychainStorage.readAsync()).toEqual(STORED)
    // The cache must still hold the credentials, not the failure.
    expect(keychainCacheState.cache.data).toEqual(STORED)
    expect(keychainCacheState.lastReadFailure).not.toBeNull()
  })

  test('a cold-cache failure does not poison the cache for the whole TTL', async () => {
    execQueue = [TIMED_OUT]
    expect(await macOsKeychainStorage.readAsync()).toBeNull()

    // Regression guard: caching {data:null, cachedAt:now} here is the bug —
    // it would make every later read inside the 30s TTL return null without
    // ever retrying, so every MCP server 401s until the TTL lapses.
    expect(keychainCacheState.cache.cachedAt).toBe(1)

    // Once the cooldown lapses the next read really does re-spawn and recover.
    keychainCacheState.lastReadFailure =
      Date.now() - KEYCHAIN_FAILURE_COOLDOWN_MS - 1
    execQueue = [ok(STORED)]
    expect(await macOsKeychainStorage.readAsync()).toEqual(STORED)
    expect(keychainCacheState.lastReadFailure).toBeNull()
  })

  test('caches the null when the keychain definitively has no entry', async () => {
    execQueue = [NOT_FOUND]

    expect(await macOsKeychainStorage.readAsync()).toBeNull()
    // exit 44 is a real answer, so caching it is correct and saves a spawn.
    expect(keychainCacheState.cache.cachedAt).not.toBe(1)
    expect(keychainCacheState.lastReadFailure).toBeNull()
  })

  test('the cooldown suppresses re-spawning right after a failure', async () => {
    execQueue = [TIMED_OUT]
    await macOsKeychainStorage.readAsync()
    expect(execCalls).toBe(1)

    // No queued result: a spawn here would throw.
    expect(await macOsKeychainStorage.readAsync()).toBeNull()
    expect(execCalls).toBe(1)
  })

  test('the cooldown serves the stale value rather than a bare null', async () => {
    // Reachable only if a transient failure ever leaves a stale value behind
    // without refreshing cachedAt. It cannot today, but nothing enforces that,
    // and read() already returns prev.data here — the two paths must not
    // disagree about what "we could not refresh" means.
    seedExpiredCache(STORED)
    keychainCacheState.lastReadFailure = Date.now()

    expect(await macOsKeychainStorage.readAsync()).toEqual(STORED)
    expect(execCalls).toBe(0)
  })

  test('a successful read clears the failure state', async () => {
    execQueue = [ok(STORED)]

    expect(await macOsKeychainStorage.readAsync()).toEqual(STORED)
    expect(keychainCacheState.lastReadFailure).toBeNull()
    expect(keychainCacheState.cache.data).toEqual(STORED)
  })

  test('a failure that lands after invalidation does not overwrite fresh data', async () => {
    seedExpiredCache(STORED)
    execQueue = [TIMED_OUT]

    const inFlight = macOsKeychainStorage.readAsync()
    keychainCacheState.generation++ // simulate update()/clearKeychainCache()
    keychainCacheState.cache = { data: { fresh: true }, cachedAt: Date.now() }

    expect(await inFlight).toBeNull()
    expect(keychainCacheState.cache.data).toEqual({ fresh: true })
  })
})
