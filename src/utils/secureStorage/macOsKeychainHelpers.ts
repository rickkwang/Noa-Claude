// @ts-nocheck
/**
 * Lightweight helpers shared between keychainPrefetch.ts and
 * macOsKeychainStorage.ts.
 *
 * This module MUST NOT import execa, execFileNoThrow, or
 * execFileNoThrowPortable. keychainPrefetch.ts fires at the very top of
 * main.tsx (before the ~65ms of module evaluation it parallelizes), and Bun's
 * __esm wrapper evaluates the ENTIRE module when any symbol is accessed —
 * so a heavy transitive import here defeats the prefetch. The execa →
 * human-signals → cross-spawn chain alone is ~58ms of synchronous init.
 *
 * The imports below (envUtils, oauth constants, crypto, os) are already
 * evaluated by startupProfiler.ts at main.tsx:5, so they add no module-init
 * cost when keychainPrefetch.ts pulls this file in.
 */

import { createHash } from 'crypto'
import { userInfo } from 'os'
import { getOauthConfig } from 'src/constants/oauth.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import type { SecureStorageData } from './types.js'

// Suffix distinguishing the OAuth credentials keychain entry from the legacy
// API key entry (which uses no suffix). Both share the service name base.
// DO NOT change this value — it's part of the keychain lookup key and would
// orphan existing stored credentials.
export const CREDENTIALS_SERVICE_SUFFIX = '-credentials'

export function getMacOsKeychainStorageServiceName(
  serviceSuffix: string = '',
): string {
  const configDir = getClaudeConfigHomeDir()
  const isDefaultDir = !process.env.CLAUDE_CONFIG_DIR

  // Use a hash of the config dir path to create a unique but stable suffix
  // Only add suffix for non-default directories to maintain backwards compatibility
  const dirHash = isDefaultDir
    ? ''
    : `-${createHash('sha256').update(configDir).digest('hex').substring(0, 8)}`
  return `Claude Code${getOauthConfig().OAUTH_FILE_SUFFIX}${serviceSuffix}${dirHash}`
}

// Reads and deletes spawn `security` with argv, so the account name is never
// exposed to a shell. The writes are the reason this guard exists: both
// macOsKeychainStorage.update() and utils/auth.ts build an
// `add-generic-password -a "${username}" …` line and feed it to `security -i`,
// whose own parser honours those quotes. A username containing `"` therefore
// truncates the command mid-argument — the same silently-corrupted write that
// SECURITY_STDIN_LINE_LIMIT documents for overlong payloads (#30337).
//
// Upstream constrains the value to this alphabet with a fixed fallback; this
// fork had dropped that. macOS short names cannot contain anything outside it,
// so the guard only engages when $USER has been overridden to something exotic
// — in which case the worst case is storing under the fallback account and
// having to log in again, not a corrupted entry.
const SAFE_USERNAME = /^[a-zA-Z0-9._-]+$/
const FALLBACK_USERNAME = 'claude-code-user'

export function getUsername(): string {
  let username: string
  try {
    username = process.env.USER || userInfo().username
  } catch {
    return FALLBACK_USERNAME
  }
  if (!SAFE_USERNAME.test(username)) return FALLBACK_USERNAME
  return username
}

// --

// Cache for keychain reads to avoid repeated expensive security CLI calls.
// TTL bounds staleness for cross-process scenarios (another CC instance
// refreshing/invalidating tokens) without forcing a blocking spawnSync on
// every read. In-process writes invalidate via clearKeychainCache() directly.
//
// The sync read() path takes ~500ms per `security` spawn. With 50+ claude.ai
// MCP connectors authenticating at startup, a short TTL expires mid-storm and
// triggers repeat sync reads — observed as a 5.5s event-loop stall
// (go/ccshare/adamj-20260326-212235). 30s of cross-process staleness is fine:
// OAuth tokens expire in hours, and the only cross-process writer is another
// CC instance's /login or refresh.
//
// Lives here (not in macOsKeychainStorage.ts) so keychainPrefetch.ts can
// prime it without pulling in execa. Wrapped in an object because ES module
// `let` bindings aren't writable across module boundaries — both this file
// and macOsKeychainStorage.ts need to mutate all three fields.
export const KEYCHAIN_CACHE_TTL_MS = 30_000

// Sentinel distinguishing "the `security` call failed" from "the keychain has
// no entry". Both used to collapse to null, and readAsync() then cached that
// null for the full TTL — so one transient spawn failure made every consumer
// (including every MCP server's OAuth token, which lives in the same blob)
// look unauthenticated for 30s. tokens() returning undefined means the MCP SDK
// sends no Authorization header, which the server answers with 401: a burst of
// 401s that looks like auth never completed. Only doReadAsync() produces this
// value; it never escapes readAsync().
export const TRANSIENT_READ_FAILURE = Symbol('keychain-transient-read-failure')
export type TransientReadFailure = typeof TRANSIENT_READ_FAILURE

// After a transient failure, short-circuit reads for this long instead of
// re-spawning `security` on every call. A keychain that just timed out is
// unlikely to answer the next request either, and the retry storm is itself
// part of what makes the stall visible.
//
// Two windows over the one `lastReadFailure` timestamp, because the two read
// paths pay very different prices for a retry. readAsync() costs an off-loop
// subprocess bounded at 2s, so it may retry eagerly and recover fast. read()
// is execaSync — it freezes the event loop for up to
// KEYCHAIN_BLOCKING_EXEC_TIMEOUT_MS (10s), and it is called once per HTTP/SSE
// server from hasMcpDiscoveryButNoToken() (services/mcp/client.ts), so a
// 1s window would let a wedged keychain freeze the UI for 10 of every 11
// seconds for the length of MCP startup. Both retries return the same value
// (whatever we last knew), so the only thing a longer window costs the sync
// path is a slower recovery — cheap next to the freeze.
export const KEYCHAIN_FAILURE_COOLDOWN_MS = 1_000
export const KEYCHAIN_BLOCKING_FAILURE_COOLDOWN_MS = 10_000

// Deadline for the `security` calls whose result we cannot afford to guess
// wrong — the sync read, the sync delete, both write spawns, and the legacy
// API-key read in utils/auth.ts. Deliberately much longer than the 2s upstream
// uses everywhere (see macOsKeychainStorage.ts for the full reasoning): a read
// that gives up early reports "no credentials" into a fork whose write path
// has no way to refuse an untrusted read, and a write that gives up early
// leaves the credentials nowhere at all. 10s bounds a genuinely wedged
// keychain without misreading a merely slow one — a healthy read measures
// 14-20ms, so this sits ~500x above normal.
export const KEYCHAIN_BLOCKING_EXEC_TIMEOUT_MS = 10_000

// `security` exit codes that answer the question rather than failing to ask it:
// the entry isn't there, or the keychain is locked so nothing is readable this
// session either way. Both are safe to cache as "no credentials".
export const SEC_ERR_ITEM_NOT_FOUND = 44
export const SEC_ERR_KEYCHAIN_LOCKED = 36

/**
 * Whether a `security` exit code is a real answer (cacheable) rather than a
 * failure to get one. Shared by the storage read and the startup prefetch so
 * both classify identically — they poison the same cache.
 *
 * Note what is deliberately NOT definitive: exit 1, which is what both execa
 * and child_process report for a process we SIGTERM'd on timeout, and what a
 * missing `security` binary surfaces as.
 */
export function isDefinitiveKeychainExitCode(code: number | undefined): boolean {
  return (
    code === 0 ||
    code === SEC_ERR_ITEM_NOT_FOUND ||
    code === SEC_ERR_KEYCHAIN_LOCKED
  )
}

export const keychainCacheState: {
  cache: { data: SecureStorageData | null; cachedAt: number } // cachedAt 0 = invalid
  // Incremented on every cache invalidation. readAsync() captures this before
  // spawning and skips its cache write if a newer generation exists, preventing
  // a stale subprocess result from overwriting fresh data written by update().
  generation: number
  // Deduplicates concurrent readAsync() calls so TTL expiry under load spawns
  // one subprocess, not N. Cleared on invalidation so fresh reads don't join
  // a stale in-flight promise.
  readInFlight: Promise<SecureStorageData | null> | null
  // Timestamp of the last transient read failure, or null if the last read
  // succeeded. Gates the cooldown above; reset on success and on invalidation.
  lastReadFailure: number | null
} = {
  cache: { data: null, cachedAt: 0 },
  generation: 0,
  readInFlight: null,
  lastReadFailure: null,
}

export function clearKeychainCache(): void {
  keychainCacheState.cache = { data: null, cachedAt: 0 }
  keychainCacheState.generation++
  keychainCacheState.readInFlight = null
  keychainCacheState.lastReadFailure = null
}

/**
 * Prime the keychain cache from a prefetch result (keychainPrefetch.ts).
 * Only writes if the cache hasn't been touched yet — if sync read() or
 * update() already ran, their result is authoritative and we discard this.
 *
 * `generation` must be the value captured when the prefetch subprocess was
 * spawned. The cachedAt check alone is not enough: clearKeychainCache() resets
 * cachedAt to 0, and delete() (logout) invalidates without repopulating — so a
 * prefetch still in flight would sail through the cachedAt check and restore
 * the credentials it read before the logout, leaving the session looking
 * authenticated for another TTL.
 */
export function primeKeychainCacheFromPrefetch(
  stdout: string | null,
  generation: number,
): void {
  if (
    keychainCacheState.cache.cachedAt !== 0 ||
    keychainCacheState.generation !== generation
  ) {
    return
  }
  let data: SecureStorageData | null = null
  if (stdout) {
    try {
      // eslint-disable-next-line custom-rules/no-direct-json-operations -- jsonParse() pulls slowOperations (lodash-es/cloneDeep) into the early-startup import chain; see file header
      data = JSON.parse(stdout)
    } catch {
      // malformed prefetch result — let sync read() re-fetch
      return
    }
  }
  keychainCacheState.cache = { data, cachedAt: Date.now() }
}
