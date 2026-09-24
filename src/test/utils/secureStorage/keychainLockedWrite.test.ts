import { beforeEach, describe, expect, mock, test } from 'bun:test'

// A login keychain that locks mid-session (a Mac just woken from sleep) answers
// every `security` call with exit 36. The entry is still there behind the lock.
// A write in that window used to be demoted to plaintext, and the fallback's
// best-effort keychain delete then either failed (the old entry shadows the new
// plaintext once unlocked, losing the new MCP OAuth token) or succeeded (the
// keychain entry is gone and only a blob built from a partial read survives).

type SyncResult = { exitCode: number | undefined; stdout: string }

let syncQueue: SyncResult[] = []
let syncCalls: string[][] = []

mock.module('execa', () => ({
  execaSync: (_file: string, args: string[]) => {
    syncCalls.push(args)
    const next = syncQueue.shift()
    if (!next) throw new Error('unexpected extra `security` spawn')
    return { ...next, stderr: '', timedOut: false }
  },
  execa: async () => ({ exitCode: 0, stdout: '', stderr: '', failed: false }),
}))

const { macOsKeychainStorage } = await import(
  '../../../utils/secureStorage/macOsKeychainStorage.js'
)
const { createFallbackStorage } = await import(
  '../../../utils/secureStorage/fallbackStorage.js'
)
const { keychainCacheState } = await import(
  '../../../utils/secureStorage/macOsKeychainHelpers.js'
)

const STORED = {
  claudeAiOauth: { accessToken: 'tok' },
  mcpOAuth: { a: { accessToken: 'a' }, b: { accessToken: 'b' } },
}
const ok = (data: unknown): SyncResult => ({
  exitCode: 0,
  stdout: JSON.stringify(data),
})
const WRITE_OK: SyncResult = { exitCode: 0, stdout: '' }
const LOCKED: SyncResult = { exitCode: 36, stdout: '' }

let plaintext: Record<string, unknown> | null
const secondary = {
  name: 'plaintext',
  read: () => plaintext,
  readAsync: async () => plaintext,
  update: (data: Record<string, unknown>) => {
    plaintext = data
    return { success: true }
  },
  delete: () => {
    plaintext = null
    return true
  },
}
const storage = createFallbackStorage(macOsKeychainStorage, secondary as never)

function expireCache() {
  keychainCacheState.cache = { data: keychainCacheState.cache.data, cachedAt: 1 }
  keychainCacheState.lastReadFailure = null
}

beforeEach(() => {
  syncQueue = []
  syncCalls = []
  plaintext = null
  keychainCacheState.cache = { data: null, cachedAt: 0 }
  keychainCacheState.lastReadFailure = null
  keychainCacheState.keychainHoldsItem = false
})

describe('writes while the keychain is temporarily locked', () => {
  test('are dropped, not demoted to plaintext, and never delete the entry', () => {
    syncQueue = [ok(STORED)]
    expect(storage.read()).toEqual(STORED)
    expect(keychainCacheState.keychainHoldsItem).toBe(true)

    // The Mac sleeps and wakes; the cache has expired.
    expireCache()
    syncQueue = [LOCKED]
    // Locked over a known entry is not "no credentials": no null cached, and
    // the stale value keeps serving.
    expect(storage.read()).toEqual(STORED)

    // An MCP token refresh writes back while still locked.
    const next = { ...STORED, mcpOAuth: { ...STORED.mcpOAuth, a: { accessToken: 'a2' } } }
    syncQueue = [LOCKED]
    const result = storage.update(next)
    expect(result).toMatchObject({ success: false, transient: true, keychainLocked: true })
    expect(plaintext).toBeNull()
    expect(syncCalls.some(args => args[0] === 'delete-generic-password')).toBe(false)
    // Reads keep serving what the keychain still holds.
    expect(keychainCacheState.cache.data).toEqual(STORED)
  })

  test('a cold read while locked over a known entry does not cache a null', () => {
    syncQueue = [WRITE_OK]
    expect(macOsKeychainStorage.update(STORED).success).toBe(true)
    keychainCacheState.cache = { data: null, cachedAt: 0 }

    syncQueue = [LOCKED]
    expect(macOsKeychainStorage.read()).toBeNull()
    expect(keychainCacheState.cache.cachedAt).toBe(0)
    expect(keychainCacheState.lastReadFailure).not.toBeNull()
  })

  test('a keychain locked all session still falls back to plaintext', () => {
    // SSH case: the entry was never seen, so plaintext is the real store.
    syncQueue = [LOCKED, LOCKED]
    const result = storage.update(STORED)
    expect(result.success).toBe(true)
    expect(plaintext).toEqual(STORED)
  })
})
