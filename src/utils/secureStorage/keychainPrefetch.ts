// @ts-nocheck
/**
 * Minimal module for firing macOS keychain reads in parallel with main.tsx
 * module evaluation, same pattern as startMdmRawRead() in settings/mdm/rawRead.ts.
 *
 * isRemoteManagedSettingsEligible() reads two separate keychain entries
 * SEQUENTIALLY via sync execSync during applySafeConfigEnvironmentVariables():
 *   1. "Claude Code-credentials" (OAuth tokens)  — ~32ms
 *   2. "Claude Code" (legacy API key)            — ~33ms
 * Sequential cost: ~65ms on every macOS startup.
 *
 * Firing both here lets the subprocesses run in parallel with the ~65ms of
 * main.tsx imports. ensureKeychainPrefetchCompleted() is awaited alongside
 * ensureMdmSettingsLoaded() in main.tsx preAction — nearly free since the
 * subprocesses finish during import evaluation. Sync read() and
 * getApiKeyFromConfigOrMacOSKeychain() then hit their caches.
 *
 * Imports stay minimal: child_process + macOsKeychainHelpers.ts (NOT
 * macOsKeychainStorage.ts — that pulls in execa → human-signals →
 * cross-spawn, ~58ms of synchronous module init). The helpers file's own
 * import chain (envUtils, oauth constants, crypto) is already evaluated by
 * startupProfiler.ts at main.tsx:5, so no new module-init cost lands here.
 */

import { execFile } from 'child_process'
import { isBareMode } from '../envUtils.js'
import {
  CREDENTIALS_SERVICE_SUFFIX,
  getMacOsKeychainStorageServiceName,
  getUsername,
  isDefinitiveKeychainExitCode,
  keychainCacheState,
  primeKeychainCacheFromPrefetch,
} from './macOsKeychainHelpers.js'

const KEYCHAIN_PREFETCH_TIMEOUT_MS = 10_000

// Shared with auth.ts getApiKeyFromConfigOrMacOSKeychain() so it can skip its
// sync spawn when the prefetch already landed. Distinguishing "not started" (null)
// from "completed with no key" ({ stdout: null }) lets the sync reader only
// trust a completed prefetch.
let legacyApiKeyPrefetch: { stdout: string | null } | null = null

// Invalidation counter for the slot above, bumped by clearLegacyApiKeyPrefetch().
// The prefetch captures it at spawn and drops its result if it moved, so a key
// swapped while the subprocess is still in flight is not undone by the stale
// read landing afterwards.
//
// saveApiKey()/removeApiKey() clear only this slot — they never touch the
// credentials cache — so keychainCacheState.generation cannot guard it: those
// two would have to bump it, which discards a warm OAuth cache and buys an
// extra `security` spawn for an unrelated entry. Both counters are checked
// below, so either kind of invalidation still discards the result.
let legacyPrefetchGeneration = 0

let prefetchPromise: Promise<void> | null = null

type SpawnResult = { stdout: string | null; definitive: boolean }

/**
 * Whether an execFile callback error is a definitive "nothing to read" that may
 * be primed into the shared cache, versus a failure that tells us nothing.
 *
 * Only a definitive answer may be primed: priming null on an inconclusive
 * result seeds a 30s "no credentials" window before the first request even
 * fires — the same poisoned-cache failure readAsync() guards against, except
 * this one lands at startup, when nothing has a stale value to fall back to.
 *
 * The three error shapes, all verified against Bun's child_process:
 *   - exit 44 / 36  → `code` is that number      → definitive
 *   - our timeout   → `code: null`, killed=true  → not definitive
 *   - missing binary→ `code: 'ENOENT'` (string)  → not definitive
 * Hence the typeof guard: a string `code` must never reach the numeric check.
 */
export function isDefinitiveSpawnError(err: unknown): boolean {
  if (!err) return true
  const code = (err as { code?: unknown }).code
  return typeof code === 'number' && isDefinitiveKeychainExitCode(code)
}

function spawnSecurity(serviceName: string): Promise<SpawnResult> {
  return new Promise(resolve => {
    execFile(
      'security',
      ['find-generic-password', '-a', getUsername(), '-w', '-s', serviceName],
      { encoding: 'utf-8', timeout: KEYCHAIN_PREFETCH_TIMEOUT_MS },
      (err, stdout) => {
        // biome-ignore lint/nursery/noFloatingPromises: resolve() is not a floating promise
        resolve({
          stdout: err ? null : stdout?.trim() || null,
          definitive: isDefinitiveSpawnError(err),
        })
      },
    )
  })
}

/**
 * Fire both keychain reads in parallel. Called at main.tsx top-level
 * immediately after startMdmRawRead(). Non-darwin is a no-op.
 */
export function startKeychainPrefetch(): void {
  if (process.platform !== 'darwin' || prefetchPromise || isBareMode()) return

  // Captured before spawning so a logout (or any other invalidation) that
  // lands while these are in flight discards the result instead of restoring
  // the credentials it read beforehand.
  const generation = keychainCacheState.generation
  const legacyGeneration = getLegacyPrefetchGeneration()

  // Fire both subprocesses immediately (non-blocking). They run in parallel
  // with each other AND with main.tsx imports. The await in Promise.all
  // happens later via ensureKeychainPrefetchCompleted().
  const oauthSpawn = spawnSecurity(
    getMacOsKeychainStorageServiceName(CREDENTIALS_SERVICE_SUFFIX),
  )
  const legacySpawn = spawnSecurity(getMacOsKeychainStorageServiceName())

  prefetchPromise = Promise.all([oauthSpawn, legacySpawn]).then(
    ([oauth, legacy]) => {
      // Inconclusive prefetch: don't prime. Sync read/spawn will retry with
      // its own timeout. Priming null here would shadow a key that the sync
      // path might successfully fetch.
      if (oauth.definitive) {
        primeKeychainCacheFromPrefetch(oauth.stdout, generation)
      }
      if (legacy.definitive && keychainCacheState.generation === generation) {
        primeLegacyApiKeyPrefetch(legacy.stdout, legacyGeneration)
      }
    },
  )
}

/**
 * Await prefetch completion. Called in main.tsx preAction alongside
 * ensureMdmSettingsLoaded() — nearly free since subprocesses finish during
 * the ~65ms of main.tsx imports. Resolves immediately on non-darwin.
 */
export async function ensureKeychainPrefetchCompleted(): Promise<void> {
  if (prefetchPromise) await prefetchPromise
}

/**
 * Consumed by getApiKeyFromConfigOrMacOSKeychain() in auth.ts before it
 * falls through to sync execSync. Returns null if prefetch hasn't completed.
 */
export function getLegacyApiKeyPrefetchResult(): {
  stdout: string | null
} | null {
  return legacyApiKeyPrefetch
}

/**
 * Read the current invalidation counter. Capture this before spawning a legacy
 * API-key read and hand it back to primeLegacyApiKeyPrefetch().
 */
export function getLegacyPrefetchGeneration(): number {
  return legacyPrefetchGeneration
}

/**
 * Store a completed legacy API-key read, unless it was invalidated while in
 * flight. Mirrors primeKeychainCacheFromPrefetch() for the OAuth slot.
 */
export function primeLegacyApiKeyPrefetch(
  stdout: string | null,
  generation: number,
): void {
  if (legacyPrefetchGeneration !== generation) return
  legacyApiKeyPrefetch = { stdout }
}

/**
 * Clear prefetch result. Called alongside getApiKeyFromConfigOrMacOSKeychain
 * cache invalidation so a stale prefetch doesn't shadow a fresh write.
 *
 * Bumping the generation is what makes that true for a prefetch that has not
 * resolved yet. saveApiKey() runs inside the prefetch's own ~10s window, and
 * nulling the slot alone let the in-flight read reinstate the *old* key
 * afterwards — which the memoize in getApiKeyFromConfigOrMacOSKeychain (cleared
 * at the same call site, a moment too early) then pinned for the rest of the
 * process, so every request authed with a key the user had just replaced.
 */
export function clearLegacyApiKeyPrefetch(): void {
  legacyApiKeyPrefetch = null
  legacyPrefetchGeneration++
}
