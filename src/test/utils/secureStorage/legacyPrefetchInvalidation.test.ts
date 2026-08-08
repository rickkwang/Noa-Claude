import { afterEach, describe, expect, test } from 'bun:test'
import {
  clearLegacyApiKeyPrefetch,
  getLegacyApiKeyPrefetchResult,
  getLegacyPrefetchGeneration,
  primeLegacyApiKeyPrefetch,
} from '../../../utils/secureStorage/keychainPrefetch.js'

// startKeychainPrefetch() reads the legacy API-key entry with a 10s deadline,
// so its subprocess is still in flight for the first ~10s of a session. If
// /login swaps the key inside that window, saveApiKey() nulls the prefetch slot
// — but the read that was already running must not put the OLD key back
// afterwards. getApiKeyFromConfigOrMacOSKeychain() clears its memoize at the
// same call site, a moment too early, so a resurrected slot gets pinned for the
// rest of the process: every request authenticates with the key the user just
// replaced, and only a restart clears it.

afterEach(() => {
  clearLegacyApiKeyPrefetch()
})

describe('legacy API-key prefetch invalidation', () => {
  test('a prefetch that resolves after a key swap is discarded', () => {
    // Session start: the prefetch spawns and captures the generation.
    const spawnGeneration = getLegacyPrefetchGeneration()

    // /login writes a new key -> saveApiKey() clears the slot.
    clearLegacyApiKeyPrefetch()
    expect(getLegacyApiKeyPrefetchResult()).toBeNull()

    // The subprocess that started before the swap now lands, carrying the old
    // key. Nulling the slot alone did not stop this.
    primeLegacyApiKeyPrefetch('sk-ant-OLD', spawnGeneration)

    // Null means "prefetch didn't land", which sends
    // getApiKeyFromConfigOrMacOSKeychain() to its own read instead of handing
    // back a superseded key.
    expect(getLegacyApiKeyPrefetchResult()).toBeNull()
  })

  test('a prefetch that resolves with no swap in between still primes', () => {
    const spawnGeneration = getLegacyPrefetchGeneration()
    primeLegacyApiKeyPrefetch('sk-ant-CURRENT', spawnGeneration)

    expect(getLegacyApiKeyPrefetchResult()).toEqual({
      stdout: 'sk-ant-CURRENT',
    })
  })

  test('"completed with no key" stays distinguishable from "not started"', () => {
    const spawnGeneration = getLegacyPrefetchGeneration()
    primeLegacyApiKeyPrefetch(null, spawnGeneration)

    // auth.ts branches on exactly this: a completed prefetch with no key falls
    // through to config, while null falls through to a blocking `security`
    // spawn.
    expect(getLegacyApiKeyPrefetchResult()).toEqual({ stdout: null })
  })

  test('each clear invalidates independently', () => {
    const first = getLegacyPrefetchGeneration()
    clearLegacyApiKeyPrefetch()
    const second = getLegacyPrefetchGeneration()
    clearLegacyApiKeyPrefetch()

    expect(second).not.toBe(first)
    expect(getLegacyPrefetchGeneration()).not.toBe(second)
    primeLegacyApiKeyPrefetch('sk-ant-STALE', second)
    expect(getLegacyApiKeyPrefetchResult()).toBeNull()
  })
})
