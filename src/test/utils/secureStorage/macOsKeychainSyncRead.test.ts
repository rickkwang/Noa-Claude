import { beforeEach, describe, expect, mock, test } from 'bun:test'

// The sync read() feeds the read-modify-write sites (19 of the 22
// `storage.update(...)` call sites discard the result) that do
// `storage.read() || {}` and write the result straight back. A failed read
// that gets cached as "empty" therefore does more than misreport for the 30s
// TTL — it invites a write that overwrites the entire credentials blob.
//
// Both the read and the write are execaSync, so every deadline they carry is
// also a hard ceiling on how long the event loop can freeze.

type SyncResult = { exitCode: number | undefined; stdout: string }

let syncQueue: SyncResult[] = []
let syncCalls: Array<{ args: string[]; options: Record<string, unknown> }> = []

mock.module('execa', () => ({
  execaSync: (
    _file: string,
    args: string[],
    options: Record<string, unknown>,
  ) => {
    syncCalls.push({ args, options })
    const next = syncQueue.shift()
    if (!next) throw new Error('unexpected extra `security` spawn')
    return { ...next, stderr: '', timedOut: false }
  },
  execa: async () => ({ exitCode: 0, stdout: '', stderr: '', failed: false }),
}))

const { macOsKeychainStorage } = await import(
  '../../../utils/secureStorage/macOsKeychainStorage.js'
)
const {
  keychainCacheState,
  KEYCHAIN_BLOCKING_EXEC_TIMEOUT_MS,
  KEYCHAIN_BLOCKING_FAILURE_COOLDOWN_MS,
  KEYCHAIN_FAILURE_COOLDOWN_MS,
} = await import('../../../utils/secureStorage/macOsKeychainHelpers.js')

const STORED = { claudeAiOauth: { accessToken: 'tok' } }

const ok = (data: unknown): SyncResult => ({
  exitCode: 0,
  stdout: JSON.stringify(data),
})
const NOT_FOUND: SyncResult = { exitCode: 44, stdout: '' }
// execa reports a SIGTERM'd timeout with no exit code.
const TIMED_OUT: SyncResult = { exitCode: undefined, stdout: '' }

function seedExpiredCache(data: unknown | null) {
  keychainCacheState.cache = { data, cachedAt: 1 }
  keychainCacheState.generation = 0
  keychainCacheState.readInFlight = null
  keychainCacheState.lastReadFailure = null
}

beforeEach(() => {
  syncQueue = []
  syncCalls = []
  seedExpiredCache(null)
})

describe('macOsKeychainStorage.read (sync)', () => {
  test('a cold-cache failure does not cache a null', () => {
    syncQueue = [TIMED_OUT]

    expect(macOsKeychainStorage.read()).toBeNull()
    // Regression guard: writing {data:null, cachedAt:now} here is what lets a
    // later `storage.read() || {}` produce an empty blob for 30 uninterrupted
    // seconds, with a credential-clobbering update behind it.
    expect(keychainCacheState.cache.cachedAt).toBe(1)
    expect(keychainCacheState.lastReadFailure).not.toBeNull()
  })

  test('caches the null when the entry genuinely does not exist', () => {
    syncQueue = [NOT_FOUND]

    expect(macOsKeychainStorage.read()).toBeNull()
    // exit 44 is a real answer: caching it is correct and saves a spawn.
    expect(keychainCacheState.cache.cachedAt).not.toBe(1)
    expect(keychainCacheState.lastReadFailure).toBeNull()
  })

  test('serves the stale value on a transient failure', () => {
    seedExpiredCache(STORED)
    syncQueue = [TIMED_OUT]

    expect(macOsKeychainStorage.read()).toEqual(STORED)
    expect(keychainCacheState.cache.data).toEqual(STORED)
    expect(keychainCacheState.lastReadFailure).not.toBeNull()
  })

  test('the cooldown suppresses a second blocking spawn', () => {
    syncQueue = [TIMED_OUT]
    expect(macOsKeychainStorage.read()).toBeNull()
    expect(syncCalls).toHaveLength(1)

    // No queued result: another spawn would throw.
    expect(macOsKeychainStorage.read()).toBeNull()
    expect(syncCalls).toHaveLength(1)
  })

  test('the cooldown outlasts a single blocking timeout', () => {
    // This is the whole reason the blocking path gets its own window. read()
    // is called once per HTTP/SSE server from hasMcpDiscoveryButNoToken()
    // (services/mcp/client.ts), and each spawn can freeze the event loop for
    // KEYCHAIN_BLOCKING_EXEC_TIMEOUT_MS. A cooldown shorter than that deadline
    // lets a wedged keychain freeze the UI for most of MCP startup.
    expect(KEYCHAIN_BLOCKING_FAILURE_COOLDOWN_MS).toBeGreaterThanOrEqual(
      KEYCHAIN_BLOCKING_EXEC_TIMEOUT_MS,
    )

    keychainCacheState.lastReadFailure =
      Date.now() - KEYCHAIN_FAILURE_COOLDOWN_MS - 1
    // Past the async window, still inside the blocking one: no queued result,
    // so a spawn here would throw.
    expect(macOsKeychainStorage.read()).toBeNull()
    expect(syncCalls).toHaveLength(0)
  })

  test('a success clears the failure state so readAsync stops short-circuiting', () => {
    keychainCacheState.lastReadFailure =
      Date.now() - KEYCHAIN_BLOCKING_FAILURE_COOLDOWN_MS - 1
    syncQueue = [ok(STORED)]

    expect(macOsKeychainStorage.read()).toEqual(STORED)
    expect(keychainCacheState.lastReadFailure).toBeNull()
  })

  test('spawns with argv and a bounded deadline, never a shell string', () => {
    syncQueue = [ok(STORED)]
    macOsKeychainStorage.read()

    const [call] = syncCalls
    expect(call?.args).toContain('find-generic-password')
    expect(call?.options.timeout).toBe(KEYCHAIN_BLOCKING_EXEC_TIMEOUT_MS)
    expect(call?.options.shell).toBeUndefined()
  })
})

describe('macOsKeychainStorage.update (sync)', () => {
  test('the write carries the blocking deadline, not the 2s one', () => {
    // A write that gives up early leaves the credentials nowhere: the fallback
    // declines to demote them to plaintext (correctly), and 19 of the 22
    // update() call sites discard the result, so nothing surfaces the loss.
    // `security add-generic-password` can also sit on a keychain-unlock
    // dialog, which 2s would misread as wedged.
    syncQueue = [{ exitCode: 0, stdout: '' }]
    macOsKeychainStorage.update({ claudeAiOauth: { accessToken: 'tok' } })

    const [call] = syncCalls
    expect(call?.options.timeout).toBe(KEYCHAIN_BLOCKING_EXEC_TIMEOUT_MS)
  })
})

describe('macOsKeychainStorage.delete (sync)', () => {
  test('reports success when there was nothing to delete', () => {
    syncQueue = [NOT_FOUND]
    expect(macOsKeychainStorage.delete()).toBe(true)
  })

  test('does not claim logout succeeded when the delete failed', () => {
    syncQueue = [TIMED_OUT]
    // Reporting true here would let logout finish over a keychain that still
    // holds the credentials.
    expect(macOsKeychainStorage.delete()).toBe(false)
  })
})
