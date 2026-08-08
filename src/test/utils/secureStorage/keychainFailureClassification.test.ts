import { afterEach, describe, expect, test } from 'bun:test'
import { createFallbackStorage } from '../../../utils/secureStorage/fallbackStorage.js'
import { isDefinitiveSpawnError } from '../../../utils/secureStorage/keychainPrefetch.js'
import {
  clearKeychainCache,
  getUsername,
  isDefinitiveKeychainExitCode,
  keychainCacheState,
  primeKeychainCacheFromPrefetch,
} from '../../../utils/secureStorage/macOsKeychainHelpers.js'

// Everything here defends one invariant: a keychain call that FAILED must never
// be recorded as a keychain that is EMPTY. Both feed the same credentials blob,
// and every MCP server's OAuth token lives in it — so a misclassified failure
// shows up as a burst of 401s that looks like auth never happened.

describe('isDefinitiveKeychainExitCode', () => {
  test('treats real answers as cacheable', () => {
    expect(isDefinitiveKeychainExitCode(0)).toBe(true)
    expect(isDefinitiveKeychainExitCode(44)).toBe(true) // no such entry
    expect(isDefinitiveKeychainExitCode(36)).toBe(true) // keychain locked
  })

  test('treats a killed or failed spawn as inconclusive', () => {
    // Both execa and child_process surface a SIGTERM'd timeout as exit 1.
    expect(isDefinitiveKeychainExitCode(1)).toBe(false)
    expect(isDefinitiveKeychainExitCode(undefined)).toBe(false)
  })
})

describe('isDefinitiveSpawnError', () => {
  test('no error is definitive', () => {
    expect(isDefinitiveSpawnError(null)).toBe(true)
    expect(isDefinitiveSpawnError(undefined)).toBe(true)
  })

  test('numeric exit codes classify by code', () => {
    expect(isDefinitiveSpawnError({ code: 44 })).toBe(true)
    expect(isDefinitiveSpawnError({ code: 36 })).toBe(true)
    expect(isDefinitiveSpawnError({ code: 1 })).toBe(false)
  })

  test('a timed-out spawn is never definitive', () => {
    // Verified shape: execFile reports code null + killed on its own timeout.
    expect(
      isDefinitiveSpawnError({ code: null, killed: true, signal: 'SIGTERM' }),
    ).toBe(false)
  })

  test('a string errno is never mistaken for an exit code', () => {
    // 'ENOENT' must not slip through a loose == or truthiness check.
    expect(isDefinitiveSpawnError({ code: 'ENOENT' })).toBe(false)
  })
})

describe('primeKeychainCacheFromPrefetch', () => {
  const originalUser = process.env.USER

  afterEach(() => {
    if (originalUser === undefined) delete process.env.USER
    else process.env.USER = originalUser
    clearKeychainCache()
  })

  test('primes a cold cache', () => {
    clearKeychainCache()
    const gen = keychainCacheState.generation
    primeKeychainCacheFromPrefetch('{"claudeAiOauth":{"accessToken":"tok"}}', gen)
    expect(keychainCacheState.cache.data).toEqual({
      claudeAiOauth: { accessToken: 'tok' },
    })
  })

  test('discards a result that a logout raced past it', () => {
    clearKeychainCache()
    const gen = keychainCacheState.generation

    // delete() → clearKeychainCache() sets cachedAt back to 0 and never
    // repopulates, so the cachedAt guard alone lets the in-flight prefetch
    // through and re-seats the credentials the user just logged out of.
    clearKeychainCache()
    primeKeychainCacheFromPrefetch('{"claudeAiOauth":{"accessToken":"tok"}}', gen)

    expect(keychainCacheState.cache.data).toBeNull()
    expect(keychainCacheState.cache.cachedAt).toBe(0)
  })
})

describe('getUsername', () => {
  const originalUser = process.env.USER
  afterEach(() => {
    if (originalUser === undefined) delete process.env.USER
    else process.env.USER = originalUser
  })

  test('passes through an ordinary macOS short name', () => {
    process.env.USER = 'ada.lovelace_1-x'
    expect(getUsername()).toBe('ada.lovelace_1-x')
  })

  test('substitutes a fallback for a name that would break the `security -i` line', () => {
    // update() interpolates this into `add-generic-password -a "${username}"`
    // and feeds it to `security -i`, which honours the quotes.
    process.env.USER = 'a" -s "other'
    expect(getUsername()).toBe('claude-code-user')
  })

  test('substitutes a fallback for whitespace and non-ASCII', () => {
    process.env.USER = 'My Name'
    expect(getUsername()).toBe('claude-code-user')
    process.env.USER = 'josé'
    expect(getUsername()).toBe('claude-code-user')
  })
})

describe('createFallbackStorage does not demote credentials on a transient write', () => {
  function stubStorage(name: string, overrides: Record<string, unknown> = {}) {
    return {
      name,
      read: () => null,
      readAsync: async () => null,
      update: () => ({ success: true }),
      delete: () => true,
      ...overrides,
    }
  }

  test('a timed-out primary write is surfaced, not routed to plaintext', () => {
    const secondaryWrites: unknown[] = []
    let primaryDeleted = false

    const primary = stubStorage('keychain', {
      read: () => ({ claudeAiOauth: { accessToken: 'tok' } }),
      update: () => ({ success: false, transient: true }),
      delete: () => {
        primaryDeleted = true
        return true
      },
    })
    const secondary = stubStorage('plaintext', {
      update: (data: unknown) => {
        secondaryWrites.push(data)
        return { success: true }
      },
    })

    const result = createFallbackStorage(primary, secondary).update({
      claudeAiOauth: { accessToken: 'new' },
    })

    expect(result.success).toBe(false)
    // The keychain never said no — it never answered. Writing the credentials
    // to plaintext and deleting a keychain entry that is probably fine would
    // be a much worse outcome than a failed write the caller can retry.
    expect(secondaryWrites).toEqual([])
    expect(primaryDeleted).toBe(false)
  })

  test('a genuine primary failure still falls back', () => {
    const secondaryWrites: unknown[] = []
    const primary = stubStorage('keychain', {
      read: () => null,
      update: () => ({ success: false }),
    })
    const secondary = stubStorage('plaintext', {
      update: (data: unknown) => {
        secondaryWrites.push(data)
        return { success: true, warning: 'plaintext' }
      },
    })

    const result = createFallbackStorage(primary, secondary).update({
      claudeAiOauth: { accessToken: 'new' },
    })

    expect(result.success).toBe(true)
    expect(secondaryWrites).toHaveLength(1)
  })
})
