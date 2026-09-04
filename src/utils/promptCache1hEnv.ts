// Leaf module: imports only envUtils so both the request path
// (services/api/claude.ts) and the doctor diagnostic (utils/promptCache1h.ts)
// can read the 1h-TTL opt-in without pulling in the
// claude.ts <-> claudeAiLimits.ts import cycle.
import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'

/**
 * Query sources covered when the env opt-in is set to a bare boolean.
 *
 * Only the interactive main thread and the SDK driver ever see the
 * human-length pauses a 1-hour TTL exists to survive. Subagents and forked
 * side-queries run back-to-back inside a single turn, so a 1h write there is
 * pure surcharge — 2x input against the 5-minute entry's 1.25x — on a read
 * that would have hit the short entry anyway.
 */
export const PROMPT_CACHE_1H_DEFAULT_SOURCES = ['repl_main_thread*', 'sdk']

/**
 * Local opt-in for the 1-hour prompt-cache TTL.
 *
 * The allowlist `should1hCacheTTL` reads is a GrowthBook config, and GrowthBook
 * is hard-disabled in this fork (both override paths are additionally
 * `USER_TYPE === 'ant'`-gated), so off Bedrock the 1h TTL could not fire at
 * all. This makes the lever reachable without reintroducing a remote-config
 * dependency.
 *
 * **It should stay off for most sessions.** A 1h cache write bills at 2x input
 * against 1.25x for the 5-minute entry, so switching every write to the long
 * TTL only pays when more than ~37.5% of a session's cache-write *volume*
 * follows a gap longer than five minutes. Measured over this repo's own
 * transcripts that share is 2.6% — enabling it there would have cost about
 * 1.56x the write spend. It pays for a genuinely interrupted rhythm: ask,
 * leave for half an hour, come back to the same session.
 *
 * Accepted values: a boolean (`1`/`true`/`on` → {@link
 * PROMPT_CACHE_1H_DEFAULT_SOURCES}, `0`/`false`/`off` → hard off, outranking
 * `ENABLE_PROMPT_CACHING_1H_BEDROCK`), or a comma-separated query-source
 * pattern list for finer control (`repl_main_thread*,agent:*`; a trailing `*`
 * is a prefix match, matching the GrowthBook config's shape).
 *
 * @returns the patterns to match against, or undefined when unset (callers
 * then fall through to the existing eligibility + allowlist path).
 */
export function getPromptCache1hEnvAllowlist(): string[] | undefined {
  const raw =
    process.env.NOA_CLAUDE_PROMPT_CACHE_1H ??
    process.env.CLAUDE_CODE_PROMPT_CACHE_1H
  if (raw === undefined || raw.trim() === '') {
    return undefined
  }
  if (isEnvTruthy(raw)) {
    return PROMPT_CACHE_1H_DEFAULT_SOURCES
  }
  if (isEnvDefinedFalsy(raw)) {
    return []
  }
  const patterns = raw
    .split(',')
    .map(pattern => pattern.trim())
    .filter(pattern => pattern.length > 0)
  return patterns.length > 0 ? patterns : undefined
}

export function matchAllowlist(querySource: string, allowlist: string[]): boolean {
  return allowlist.some(pattern =>
    pattern.endsWith('*')
      ? querySource.startsWith(pattern.slice(0, -1))
      : querySource === pattern,
  )
}
