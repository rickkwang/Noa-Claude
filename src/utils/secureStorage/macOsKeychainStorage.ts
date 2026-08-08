// @ts-nocheck
import { execaSync } from 'execa'
import { logForDebugging } from '../debug.js'
import { execFileNoThrow } from '../execFileNoThrow.js'
import { jsonParse, jsonStringify, slowLogging } from '../slowOperations.js'
import {
  CREDENTIALS_SERVICE_SUFFIX,
  clearKeychainCache,
  getMacOsKeychainStorageServiceName,
  getUsername,
  isDefinitiveKeychainExitCode,
  KEYCHAIN_BLOCKING_EXEC_TIMEOUT_MS,
  KEYCHAIN_BLOCKING_FAILURE_COOLDOWN_MS,
  KEYCHAIN_CACHE_TTL_MS,
  KEYCHAIN_FAILURE_COOLDOWN_MS,
  keychainCacheState,
  SEC_ERR_ITEM_NOT_FOUND,
  TRANSIENT_READ_FAILURE,
  type TransientReadFailure,
} from './macOsKeychainHelpers.js'
import type { SecureStorage, SecureStorageData } from './types.js'

// Every `security` invocation gets a hard deadline. Without one, a wedged
// keychain (stuck securityd, a Touch ID prompt nobody answers) blocks for the
// 10-minute default the sync helper applies — or forever, on the write path,
// which passed no timeout at all.
//
// 2s only where a false "timed out" is genuinely free: readAsync(), which runs
// off the event loop and whose failure is classified through
// TRANSIENT_READ_FAILURE rather than cached, and isMacOsKeychainLocked(),
// which only feeds a UI hint. Everything else uses the 10s blocking deadline.
const KEYCHAIN_EXEC_TIMEOUT_MS = 2_000

// KEYCHAIN_BLOCKING_EXEC_TIMEOUT_MS (10s, from the helpers) covers the sync
// read, the sync delete, and both write spawns instead. That gap is a
// deliberate divergence from upstream, which uses 2s everywhere, and it exists
// because on those four calls an early give-up is not a free retry:
//
//   Reads. Upstream can afford 2s because every write goes through
//   mutate() → readAsyncStrict(), which refuses to write when the read came
//   back transient. This fork has no mutate(): of 22 `storage.update(...)`
//   sites, 19 (most of them in services/mcp/auth.ts) do
//   `const existing = storage.read() || {}` and then
//   `storage.update({...existing, …})` without checking the result. A sync
//   read that wrongly reports "empty" therefore does not just misreport — it
//   feeds a read-modify-write that overwrites the whole credentials blob,
//   taking claudeAiOauth and every other server's tokens with it.
//
//   Writes. Those same 19 sites discard the return value, so a timed-out write
//   is not surfaced anywhere: createFallbackStorage() declines to demote the
//   credentials to plaintext (correctly — see the `transient` flag below), and
//   the caller never learns the write was dropped. `security
//   add-generic-password` can also sit on a keychain-unlock or authorize
//   dialog, which is exactly the slow-but-healthy case a 2s deadline would
//   misread as wedged.
//
// 10s still bounds the pathological hang, but sits ~500x above the 14-20ms a
// healthy call costs, so it fires only when the keychain is genuinely wedged.
// Tighten it once the write path can refuse an untrusted read AND the write
// sites check their result.

// `security -i` reads stdin with a 4096-byte fgets() buffer (BUFSIZ on darwin).
// A command line longer than this is truncated mid-argument: the first 4096
// bytes are consumed as one command (unterminated quote → fails), the overflow
// is interpreted as a second unknown command. Net: non-zero exit with NO data
// written, but the *previous* keychain entry is left intact — which fallback
// storage then reads as stale. See #30337.
// Headroom of 64B below the limit guards against edge-case line-terminator
// accounting differences.
const SECURITY_STDIN_LINE_LIMIT = 4096 - 64

export const macOsKeychainStorage = {
  name: 'keychain',
  read(): SecureStorageData | null {
    const prev = keychainCacheState.cache
    if (Date.now() - prev.cachedAt < KEYCHAIN_CACHE_TTL_MS) {
      return prev.data
    }
    // Cooldown: a read that just failed gets whatever we last knew, not another
    // blocking spawn. The longer of the two windows, because the spawn below
    // freezes the event loop for up to 10s. Reachable only with a cold cache —
    // a transient failure that had a stale value refreshed cachedAt, so the TTL
    // check above catches that case first — which makes prev.data here
    // equivalent to readAsync()'s bare null.
    const { lastReadFailure } = keychainCacheState
    if (
      lastReadFailure !== null &&
      Date.now() - lastReadFailure < KEYCHAIN_BLOCKING_FAILURE_COOLDOWN_MS
    ) {
      return prev.data
    }

    let definitive = false
    try {
      using _ = slowLogging`keychain: security find-generic-password (sync)`
      const storageServiceName = getMacOsKeychainStorageServiceName(
        CREDENTIALS_SERVICE_SUFFIX,
      )
      // argv, not a shell string: `security` is spawned directly so the
      // username and service name can never be reparsed as shell syntax, and
      // exitCode survives — which execSyncWithDefaults_DEPRECATED discards,
      // leaving this path unable to tell "no entry" from "call failed".
      const result = execaSync(
        'security',
        [
          'find-generic-password',
          '-a',
          getUsername(),
          '-w',
          '-s',
          storageServiceName,
        ],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          reject: false,
          timeout: KEYCHAIN_BLOCKING_EXEC_TIMEOUT_MS,
          maxBuffer: 1_000_000,
        },
      )
      definitive = isDefinitiveKeychainExitCode(result.exitCode)
      const stdout = result.exitCode === 0 ? result.stdout?.trim() : ''
      if (stdout) {
        const data = jsonParse(stdout)
        keychainCacheState.cache = { data, cachedAt: Date.now() }
        // A successful sync read proves the keychain is answering, so don't let
        // an earlier async failure keep readAsync() short-circuiting to null.
        keychainCacheState.lastReadFailure = null
        return data
      }
    } catch (_e) {
      // jsonParse on a corrupt entry: unusable, but a real answer.
      definitive = true
    }

    // Stale-while-error: if we had a value before and the refresh failed,
    // keep serving the stale value rather than caching null. Since #23192
    // clears the upstream memoize on every API request (macOS path), a
    // single transient `security` spawn failure would otherwise poison the
    // cache and surface as "Not logged in" across all subsystems until the
    // next user interaction. clearKeychainCache() sets data=null, so
    // explicit invalidation (logout, delete) still reads through.
    //
    // Stale wins even over a definitive "no entry": another process deleting
    // the entry is exactly the cross-process case the 30s TTL already accepts
    // as tolerable staleness, and exit 36 (locked keychain, common over SSH)
    // would otherwise drop a working session's credentials on the floor.
    if (prev.data !== null) {
      logForDebugging('[keychain] read failed; serving stale cache', {
        level: 'warn',
      })
      keychainCacheState.cache = { data: prev.data, cachedAt: Date.now() }
      // readAsync() shares this signal, so keep it truthful even though the
      // refreshed cachedAt above means the TTL, not the cooldown, is what
      // actually paces the next 30s of reads.
      keychainCacheState.lastReadFailure = definitive ? null : Date.now()
      return prev.data
    }

    if (!definitive) {
      // Cold cache and we never got an answer. Upstream caches the null here
      // and can afford to: its writes go through mutate() → readAsyncStrict(),
      // which refuses to build a payload from a read it doesn't trust. This
      // fork's ~20 write sites do `storage.read() || {}` and write the result
      // straight back, so a cached null does not merely misreport for 30s —
      // it invites a read-modify-write that overwrites the whole credentials
      // blob. Leave the cache untouched and let the cooldown pace the retries.
      logForDebugging('[keychain] read failed; not caching a null', {
        level: 'warn',
      })
      keychainCacheState.lastReadFailure = Date.now()
      return null
    }

    keychainCacheState.cache = { data: null, cachedAt: Date.now() }
    keychainCacheState.lastReadFailure = null
    return null
  },
  async readAsync(): Promise<SecureStorageData | null> {
    const prev = keychainCacheState.cache
    if (Date.now() - prev.cachedAt < KEYCHAIN_CACHE_TTL_MS) {
      return prev.data
    }
    if (keychainCacheState.readInFlight) {
      return keychainCacheState.readInFlight
    }
    // Short window: this spawn is off the event loop and bounded at 2s, so an
    // eager retry is cheap. Returns prev.data rather than a bare null for the
    // same reason read() does — provably equivalent today (a failure that had
    // a stale value refreshed cachedAt, so the TTL check above already caught
    // it), but nothing enforces that invariant, and serving the stale value is
    // the safe side of it either way.
    const { lastReadFailure } = keychainCacheState
    if (
      lastReadFailure !== null &&
      Date.now() - lastReadFailure < KEYCHAIN_FAILURE_COOLDOWN_MS
    ) {
      return prev.data
    }

    const gen = keychainCacheState.generation
    const promise = doReadAsync().then(data => {
      // If the cache was invalidated or updated while we were reading,
      // our subprocess result is stale — don't overwrite the newer entry.
      if (gen !== keychainCacheState.generation) {
        return data === TRANSIENT_READ_FAILURE ? null : data
      }
      keychainCacheState.readInFlight = null

      if (data === TRANSIENT_READ_FAILURE) {
        // The read failed; we learned nothing. Caching null here is what turned
        // one `security` hiccup into 30s of "no credentials" for every MCP
        // server at once. Serve whatever we last knew and let the next read
        // (after the cooldown) try again.
        logForDebugging('[keychain] readAsync failed; not caching a null', {
          level: 'warn',
        })
        keychainCacheState.lastReadFailure = Date.now()
        if (prev.data !== null) {
          keychainCacheState.cache = { data: prev.data, cachedAt: Date.now() }
        }
        return prev.data
      }

      // data === null here means the keychain genuinely has no entry, which is
      // a real answer and safe to cache.
      const next = data ?? prev.data
      keychainCacheState.cache = { data: next, cachedAt: Date.now() }
      keychainCacheState.lastReadFailure = null
      return next
    })
    keychainCacheState.readInFlight = promise
    return promise
  },
  update(data: SecureStorageData): {
    success: boolean
    warning?: string
    // Set when the write failed without a verdict (keychain timeout), so
    // createFallbackStorage() knows not to demote the credentials to plaintext.
    transient?: boolean
  } {
    // Invalidate cache before update
    clearKeychainCache()

    try {
      const storageServiceName = getMacOsKeychainStorageServiceName(
        CREDENTIALS_SERVICE_SUFFIX,
      )
      const username = getUsername()
      const jsonString = jsonStringify(data)

      // Convert to hexadecimal to avoid any escaping issues
      const hexValue = Buffer.from(jsonString, 'utf-8').toString('hex')

      // Prefer stdin (`security -i`) so process monitors (CrowdStrike et al.)
      // see only "security -i", not the payload (INC-3028).
      // When the payload would overflow the stdin line buffer, fall back to
      // argv. Hex in argv is recoverable by a determined observer but defeats
      // naive plaintext-grep rules, and the alternative — silent credential
      // corruption — is strictly worse. ARG_MAX on darwin is 1MB so argv has
      // effectively no size limit for our purposes.
      const command = `add-generic-password -U -a "${username}" -s "${storageServiceName}" -X "${hexValue}"\n`

      using _ = slowLogging`keychain: security add-generic-password (sync)`

      let result
      if (command.length <= SECURITY_STDIN_LINE_LIMIT) {
        result = execaSync('security', ['-i'], {
          input: command,
          stdio: ['pipe', 'pipe', 'pipe'],
          reject: false,
          timeout: KEYCHAIN_BLOCKING_EXEC_TIMEOUT_MS,
        })
      } else {
        logForDebugging(
          `Keychain payload (${jsonString.length}B JSON) exceeds security -i stdin limit; using argv`,
          { level: 'warn' },
        )
        result = execaSync(
          'security',
          [
            'add-generic-password',
            '-U',
            '-a',
            username,
            '-s',
            storageServiceName,
            '-X',
            hexValue,
          ],
          {
            stdio: ['ignore', 'pipe', 'pipe'],
            reject: false,
            timeout: KEYCHAIN_BLOCKING_EXEC_TIMEOUT_MS,
          },
        )
      }

      if (result.exitCode !== 0) {
        // A timed-out write is not evidence the keychain is unusable, and the
        // fallback would answer it by writing the credentials to plaintext and
        // deleting the keychain entry. Report it as transient so the caller
        // skips that demotion; see createFallbackStorage().
        //
        // The cost of that choice is that a dropped write is silent at the 19
        // call sites that discard this result — which is why the deadline here
        // is the 10s blocking one, not 2s: it has to be long enough that a
        // timeout really means wedged.
        //
        // Only a timeout counts. A locked keychain (exit 36, the common SSH
        // case) is deliberately NOT transient: it is a real refusal, so the
        // credentials go to plaintext (0o600) rather than nowhere. Be aware
        // where that lands, though — createFallbackStorage() follows the
        // plaintext write with a best-effort primary.delete(), which on a
        // locked keychain fails too. The old keychain entry survives, read()
        // prefers primary, and the stale token shadows the fresh plaintext one
        // until some later write succeeds. That is the #30337 state
        // fallbackStorage's own comment calls "a bad state we can't fix from
        // here" — pre-existing, and not something a flag here can repair.
        return { success: false, transient: result.timedOut === true }
      }

      // Update cache with new data on success
      keychainCacheState.cache = { data, cachedAt: Date.now() }
      return { success: true }
    } catch (_e) {
      return { success: false }
    }
  },
  delete(): boolean {
    // Invalidate cache before delete
    clearKeychainCache()

    try {
      const storageServiceName = getMacOsKeychainStorageServiceName(
        CREDENTIALS_SERVICE_SUFFIX,
      )
      // Same long leash as read(): a delete that gives up early would leave
      // the credentials in the keychain.
      using _ = slowLogging`keychain: security delete-generic-password (sync)`
      const result = execaSync(
        'security',
        [
          'delete-generic-password',
          '-a',
          getUsername(),
          '-s',
          storageServiceName,
        ],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          reject: false,
          timeout: KEYCHAIN_BLOCKING_EXEC_TIMEOUT_MS,
        },
      )
      // 44 = nothing to delete, which is the state the caller asked for.
      // Anything else means the credentials may still be there, so report
      // failure. No caller acts on this yet — /logout (commands/logout) ignores
      // the return and createFallbackStorage() ORs it with the plaintext
      // result — but the honest value is what a future "logout didn't fully
      // succeed" prompt would need, and returning a bare `true` here was
      // simply false.
      return (
        result.exitCode === 0 || result.exitCode === SEC_ERR_ITEM_NOT_FOUND
      )
    } catch (_e) {
      return false
    }
  },
} satisfies SecureStorage

async function doReadAsync(): Promise<
  SecureStorageData | null | TransientReadFailure
> {
  try {
    const storageServiceName = getMacOsKeychainStorageServiceName(
      CREDENTIALS_SERVICE_SUFFIX,
    )
    const username = getUsername()
    const { stdout, code } = await execFileNoThrow(
      'security',
      ['find-generic-password', '-a', username, '-w', '-s', storageServiceName],
      {
        useCwd: false,
        preserveOutputOnError: false,
        timeout: KEYCHAIN_EXEC_TIMEOUT_MS,
      },
    )
    if (code === 0 && stdout) {
      return jsonParse(stdout.trim())
    }
    if (isDefinitiveKeychainExitCode(code)) {
      return null
    }
    // Everything else — spawn failure, SIGTERM from our own timeout (execa
    // leaves exitCode undefined, which execFileNoThrow reports as 1), securityd
    // errors — tells us nothing about what the keychain holds.
    return TRANSIENT_READ_FAILURE
  } catch (_e) {
    // execFileNoThrow never throws, so this is jsonParse choking on a corrupt
    // entry — a definitive "unusable", not a transient failure. Retrying it
    // forever would be worse than caching the null.
    return null
  }
}

let keychainLockedCache: boolean | undefined

/**
 * Checks if the macOS keychain is locked.
 * Returns true if on macOS and keychain is locked (exit code 36 from security show-keychain-info).
 * This commonly happens in SSH sessions where the keychain isn't automatically unlocked.
 *
 * Cached for process lifetime — execaSync('security', ...) is a ~27ms sync
 * subprocess spawn, and this is called from render (AssistantTextMessage).
 * During virtual-scroll remounts on sessions with "Not logged in" messages,
 * each remount re-spawned security(1), adding 27ms/message to the commit.
 * Keychain lock state doesn't change during a CLI session.
 */
export function isMacOsKeychainLocked(): boolean {
  if (keychainLockedCache !== undefined) return keychainLockedCache
  // Only check on macOS
  if (process.platform !== 'darwin') {
    keychainLockedCache = false
    return false
  }

  try {
    const result = execaSync('security', ['show-keychain-info'], {
      reject: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: KEYCHAIN_EXEC_TIMEOUT_MS,
    })
    // Exit code 36 indicates the keychain is locked
    keychainLockedCache = result.exitCode === 36
  } catch {
    // If the command fails for any reason, assume keychain is not locked
    keychainLockedCache = false
  }
  return keychainLockedCache
}
