// @ts-nocheck
import { feature } from 'bun:bundle'
import { markPostCompaction } from 'src/bootstrap/state.js'
import { getSdkBetas } from '../../bootstrap/state.js'
import type { QuerySource } from '../../constants/querySource.js'
import type { ToolUseContext } from '../../Tool.js'
import type { Message } from '../../types/message.js'
import { getGlobalConfig } from '../../utils/config.js'
import { getContextWindowForModel } from '../../utils/context.js'
import { logForDebugging } from '../../utils/debug.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import type { CacheSafeParams } from '../../utils/forkedAgent.js'
import { logError } from '../../utils/log.js'
import { tokenCountWithEstimation } from '../../utils/tokens.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'
import { getMaxOutputTokensForModel } from '../api/claude.js'
import { notifyCompaction } from '../api/promptCacheBreakDetection.js'
import { setLastSummarizedMessageId } from '../SessionMemory/sessionMemoryUtils.js'
import {
  beginCompactLifecycle,
  type CompactionResult,
  compactConversation,
  endCompactLifecycle,
  isCompactionUserAbort,
  partialCompactConversation,
  type PreCompactHookResult,
  type RecompactionInfo,
} from './compact.js'
import { estimateMessageTokens } from './microCompact.js'
import {
  armPrecompute,
  consumePrecompute,
  isPrecomputeEnabled,
} from './precomputedCompact.js'
import { runPostCompactCleanup } from './postCompactCleanup.js'
import { adjustIndexToPreserveAPIInvariants } from './preservedTail.js'
import { trySessionMemoryCompaction } from './sessionMemoryCompact.js'
import { executePreCompactHooks } from '../../utils/hooks.js'

// Reserve this many tokens for output during compaction
// Based on p99.99 of compact summary output being 17,387 tokens.
const MAX_OUTPUT_TOKENS_FOR_SUMMARY = 20_000

// Safety floor: ensure effective context never drops below this value
// This prevents compact threshold from becoming negative and triggering infinite loops
const MIN_EFFECTIVE_CONTEXT_FLOOR = 13_000

// Returns the context window size minus the max output tokens for the model
export function getEffectiveContextWindowSize(model: string): number {
  const reservedTokensForSummary = Math.min(
    getMaxOutputTokensForModel(model),
    MAX_OUTPUT_TOKENS_FOR_SUMMARY,
  )
  let contextWindow = getContextWindowForModel(model, getSdkBetas())

  // Env override wins; otherwise fall back to the persisted /autocompact
  // setting. Either way the value is capped to the model's real context
  // window below (Math.min), so a too-large setting can never exceed the model.
  const envWindow = process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW
  const configWindow = getGlobalConfig().autoCompactWindow
  const autoCompactWindow =
    envWindow || (configWindow != null ? String(configWindow) : undefined)
  if (autoCompactWindow) {
    const parsed = parseInt(autoCompactWindow, 10)
    if (!isNaN(parsed) && parsed > 0) {
      contextWindow = Math.min(contextWindow, parsed)
    }
  }

  const effectiveContext = contextWindow - reservedTokensForSummary

  // Safety floor: ensure effective context never drops below minimum
  // This prevents compact threshold from becoming negative
  return Math.max(effectiveContext, MIN_EFFECTIVE_CONTEXT_FLOOR)
}

export type AutoCompactTrackingState = {
  compacted: boolean
  turnCounter: number
  // Unique ID per turn
  turnId: string
  // Consecutive autocompact failures. Reset on success.
  // Used as a circuit breaker to stop retrying when the context is
  // irrecoverably over the limit (e.g., prompt_too_long).
  consecutiveFailures?: number
}

export const AUTOCOMPACT_BUFFER_TOKENS = 13_000
export const WARNING_THRESHOLD_BUFFER_TOKENS = 20_000
export const ERROR_THRESHOLD_BUFFER_TOKENS = 10_000
export const MANUAL_COMPACT_BUFFER_TOKENS = 3_000

// Stop trying autocompact after this many consecutive failures.
// BQ 2026-03-10: 1,279 sessions had 50+ consecutive failures (up to 3,272)
// in a single session, wasting ~250K API calls/day globally.
const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3

export function getAutoCompactThreshold(model: string): number {
  const effectiveContextWindow = getEffectiveContextWindowSize(model)

  const autocompactThreshold =
    effectiveContextWindow - AUTOCOMPACT_BUFFER_TOKENS

  // Override for easier testing of autocompact
  const envPercent = process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE
  if (envPercent) {
    const parsed = parseFloat(envPercent)
    if (!isNaN(parsed) && parsed > 0 && parsed <= 100) {
      const percentageThreshold = Math.floor(
        effectiveContextWindow * (parsed / 100),
      )
      return Math.min(percentageThreshold, autocompactThreshold)
    }
  }

  return autocompactThreshold
}

// --- Keep-tail partial auto-compaction ---
//
// The full-compact path replaces the whole conversation with a summary
// (messagesKept: 0). Keeping a verbatim recent tail and summarizing only the
// older prefix preserves the exact recent context the next turn needs, while
// still relieving context pressure. The machinery already exists
// (partialCompactConversation + adjustIndexToPreserveAPIInvariants); these
// helpers pick the pivot for the *auto* path.

// Below this many verbatim-tail tokens, partial compaction isn't worth it
// (too little recent context kept, too little prefix relieved) — use full.
export const AUTOCOMPACT_KEEP_TAIL_MIN_TOKENS = 4_000
const KEEP_TAIL_FRACTION = 0.12
const KEEP_TAIL_FLOOR_TOKENS = 10_000
const KEEP_TAIL_CEIL_TOKENS = 25_000
// Cap the kept tail at this fraction of the auto-compact threshold so the
// post-compact context (summary + tail + attachments) lands with headroom and
// doesn't immediately re-trigger compaction.
const KEEP_TAIL_THRESHOLD_CAP_FRACTION = 0.3
// Tokens that survive compaction regardless of the kept tail: system prompt +
// tool schemas + userContext + the summary + restored attachments. Partial only
// relieves pressure if the threshold has room for the tail PLUS this. Compared
// against the threshold in the same window-token units (no rough/real estimator
// mixing). Approximate and intentionally conservative; refine via the
// compaction-quality eval.
const POST_COMPACT_OVERHEAD_RESERVE_TOKENS = 40_000
// adjustIndexToPreserveAPIInvariants can grow the tail past the budget when a
// tool chain straddles the boundary. Bail if the snapped tail blew well past the
// requested budget — both sides measured with estimateMessageTokens (consistent
// units).
const KEEP_TAIL_SNAP_TOLERANCE = 3

// Default on; set CLAUDE_CODE_AUTOCOMPACT_KEEP_TAIL=0 to fall back to full
// summarize-everything compaction.
export function isKeepTailEnabled(): boolean {
  const value = process.env.CLAUDE_CODE_AUTOCOMPACT_KEEP_TAIL
  if (value === undefined || value === '') return true
  const normalized = value.trim().toLowerCase()
  return normalized !== '0' && normalized !== 'false' && normalized !== 'off'
}

/**
 * Pick the index where the verbatim tail begins: walk from the end accumulating
 * estimated tokens until reaching `keepTailTokens`, then snap the boundary back
 * via adjustIndexToPreserveAPIInvariants so a kept tool_result never loses its
 * tool_use. Returns null when the whole conversation fits within the budget
 * (nothing to summarize) or the snapped pivot reaches the start.
 */
export function selectTailPivot(
  messages: Message[],
  keepTailTokens: number,
): number | null {
  if (messages.length === 0 || keepTailTokens <= 0) {
    return null
  }
  let accumulated = 0
  let candidate: number | null = null
  for (let i = messages.length - 1; i >= 0; i--) {
    accumulated += estimateMessageTokens([messages[i]!])
    if (accumulated >= keepTailTokens) {
      candidate = i
      break
    }
  }
  // Never reached the budget → the whole conversation is smaller than the tail
  // we'd keep, so there's no prefix worth summarizing.
  if (candidate === null) {
    return null
  }
  const pivot = adjustIndexToPreserveAPIInvariants(messages, candidate)
  if (pivot <= 0) {
    return null
  }
  return pivot
}

/**
 * Decide whether the auto-compact path should keep a verbatim tail, and if so
 * where it starts. Returns the pivot index for partialCompactConversation
 * (direction 'up_to'), or null to fall back to full compaction.
 */
export function computeAutoCompactPivot(
  messages: Message[],
  model: string,
): number | null {
  if (!isKeepTailEnabled()) {
    return null
  }
  const effectiveWindow = getEffectiveContextWindowSize(model)
  const threshold = getAutoCompactThreshold(model)
  const base = Math.min(
    Math.max(
      Math.floor(effectiveWindow * KEEP_TAIL_FRACTION),
      KEEP_TAIL_FLOOR_TOKENS,
    ),
    KEEP_TAIL_CEIL_TOKENS,
  )
  const keepTailTokens = Math.min(
    base,
    Math.floor(threshold * KEEP_TAIL_THRESHOLD_CAP_FRACTION),
  )
  if (keepTailTokens < AUTOCOMPACT_KEEP_TAIL_MIN_TOKENS) {
    return null
  }
  // Partial only relieves pressure if the threshold has room for the kept tail
  // PLUS the non-compactable overhead that survives compaction. Measured in the
  // same window-token units as `threshold` — avoids mixing rough message-token
  // estimates with the real-token trigger. (A low-threshold run exposed this: a
  // messages-only tail never approaches a threshold that includes ~30K of
  // system/tools/userContext overhead, so the old guard never fired.)
  if (keepTailTokens + POST_COMPACT_OVERHEAD_RESERVE_TOKENS >= threshold) {
    return null
  }
  const pivot = selectTailPivot(messages, keepTailTokens)
  if (pivot === null) {
    return null
  }
  // adjustIndexToPreserveAPIInvariants can grow the tail past the budget when a
  // tool chain straddles the boundary. Both sides use estimateMessageTokens
  // (consistent units): bail if the snapped tail blew well past the budget.
  if (
    estimateMessageTokens(messages.slice(pivot)) >
    keepTailTokens * KEEP_TAIL_SNAP_TOLERANCE
  ) {
    return null
  }
  return pivot
}

/**
 * Auto-path entry: returns the keep-tail pivot, or null to use full
 * compaction. Forces full when we're already re-compacting in a chain — a
 * previous compact (possibly itself partial) failed to relieve enough, so
 * keeping another tail risks a re-compaction loop; full maximizes relief.
 */
export function resolveAutoCompactPivot(
  messages: Message[],
  model: string,
  recompactionInfo?: RecompactionInfo,
): number | null {
  if (recompactionInfo?.isRecompactionInChain) {
    return null
  }
  return computeAutoCompactPivot(messages, model)
}

export function calculateTokenWarningState(
  tokenUsage: number,
  model: string,
): {
  percentLeft: number
  isAboveWarningThreshold: boolean
  isAboveErrorThreshold: boolean
  isAboveAutoCompactThreshold: boolean
  isAtBlockingLimit: boolean
} {
  const autoCompactThreshold = getAutoCompactThreshold(model)
  const threshold = isAutoCompactEnabled()
    ? autoCompactThreshold
    : getEffectiveContextWindowSize(model)

  const percentLeft =
    threshold > 0
      ? Math.max(
          0,
          Math.round(((threshold - tokenUsage) / threshold) * 100),
        )
      : 0

  const warningThreshold = threshold - WARNING_THRESHOLD_BUFFER_TOKENS
  const errorThreshold = threshold - ERROR_THRESHOLD_BUFFER_TOKENS

  const isAboveWarningThreshold = tokenUsage >= warningThreshold
  const isAboveErrorThreshold = tokenUsage >= errorThreshold

  const isAboveAutoCompactThreshold =
    isAutoCompactEnabled() && tokenUsage >= autoCompactThreshold

  const actualContextWindow = getEffectiveContextWindowSize(model)
  const defaultBlockingLimit =
    actualContextWindow - MANUAL_COMPACT_BUFFER_TOKENS

  // Allow override for testing
  const blockingLimitOverride = process.env.CLAUDE_CODE_BLOCKING_LIMIT_OVERRIDE
  const parsedOverride = blockingLimitOverride
    ? parseInt(blockingLimitOverride, 10)
    : NaN
  const blockingLimit =
    !isNaN(parsedOverride) && parsedOverride > 0
      ? parsedOverride
      : defaultBlockingLimit

  const isAtBlockingLimit = tokenUsage >= blockingLimit

  return {
    percentLeft,
    isAboveWarningThreshold,
    isAboveErrorThreshold,
    isAboveAutoCompactThreshold,
    isAtBlockingLimit,
  }
}

export function isAutoCompactEnabled(): boolean {
  if (isEnvTruthy(process.env.DISABLE_COMPACT)) {
    return false
  }
  // Allow disabling just auto-compact (keeps manual /compact working)
  if (isEnvTruthy(process.env.DISABLE_AUTO_COMPACT)) {
    return false
  }
  // Check if user has disabled auto-compact in their settings
  const userConfig = getGlobalConfig()
  return userConfig.autoCompactEnabled
}

export async function shouldAutoCompact(
  messages: Message[],
  model: string,
  querySource?: QuerySource,
  // Snip removes messages but the surviving assistant's usage still reflects
  // pre-snip context, so tokenCountWithEstimation can't see the savings.
  // Subtract the rough-delta that snip already computed.
  snipTokensFreed = 0,
): Promise<boolean> {
  // Recursion guards. session_memory and compact are forked agents that
  // would deadlock.
  if (querySource === 'session_memory' || querySource === 'compact') {
    return false
  }
  // marble_origami is the ctx-agent — if ITS context blows up and
  // autocompact fires, runPostCompactCleanup calls resetContextCollapse()
  // which destroys the MAIN thread's committed log (module-level state
  // shared across forks). Inside feature() so the string DCEs from
  // external builds (it's in excluded-strings.txt).
  if (feature('CONTEXT_COLLAPSE')) {
    if (querySource === 'marble_origami') {
      return false
    }
  }

  if (!isAutoCompactEnabled()) {
    return false
  }

  // Reactive-only mode: suppress proactive autocompact, let reactive compact
  // catch the API's prompt-too-long. feature() wrapper keeps the flag string
  // out of external builds (REACTIVE_COMPACT is ant-only).
  // Note: returning false here also means autoCompactIfNeeded never reaches
  // trySessionMemoryCompaction in the query loop — the /compact call site
  // still tries session memory first. Revisit if reactive-only graduates.
  if (feature('REACTIVE_COMPACT')) {
    if (getFeatureValue_CACHED_MAY_BE_STALE('tengu_cobalt_raccoon', false)) {
      return false
    }
  }

  // Context-collapse mode: same suppression. Collapse IS the context
  // management system when it's on — the 90% commit / 95% blocking-spawn
  // flow owns the headroom problem. Autocompact firing at effective-13k
  // (~93% of effective) sits right between collapse's commit-start (90%)
  // and blocking (95%), so it would race collapse and usually win, nuking
  // granular context that collapse was about to save. Gating here rather
  // than in isAutoCompactEnabled() keeps reactiveCompact alive as the 413
  // fallback (it consults isAutoCompactEnabled directly) and leaves
  // sessionMemory + manual /compact working.
  //
  // Consult isContextCollapseEnabled (not the raw gate) so the
  // CLAUDE_CONTEXT_COLLAPSE env override is honored here too. require()
  // inside the block breaks the init-time cycle (this file exports
  // getEffectiveContextWindowSize which collapse's index imports).
  if (feature('CONTEXT_COLLAPSE')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { isContextCollapseEnabled } =
      require('../contextCollapse/index.js') as typeof import('../contextCollapse/index.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    if (isContextCollapseEnabled()) {
      return false
    }
  }

  const tokenCount = tokenCountWithEstimation(messages) - snipTokensFreed
  const threshold = getAutoCompactThreshold(model)
  const effectiveWindow = getEffectiveContextWindowSize(model)

  // Threshold collapses to ~0 when effective window hits its floor (small
  // CLAUDE_CODE_AUTO_COMPACT_WINDOW or an unusually small context model).
  // Any post-compact context (~10-30K of boundary+summary+attachments)
  // would then exceed threshold and re-trigger compact immediately; the
  // consecutiveFailures circuit breaker only catches failures, so a
  // successful re-compact loop runs forever. Refuse here — manual /compact
  // still works, and PTL-driven reactive compact handles genuine overflow.
  if (threshold <= 0) {
    logForDebugging(
      `autocompact: refused (threshold=${threshold} effective=${effectiveWindow} — window too small)`,
      { level: 'warn' },
    )
    return false
  }

  logForDebugging(
    `autocompact: tokens=${tokenCount} threshold=${threshold} effectiveWindow=${effectiveWindow}${snipTokensFreed > 0 ? ` snipFreed=${snipTokensFreed}` : ''}`,
  )

  const { isAboveAutoCompactThreshold } = calculateTokenWarningState(
    tokenCount,
    model,
  )

  return isAboveAutoCompactThreshold
}

// Precompute keeps the recent tail verbatim after the summary. Bound the tail
// to this fraction of the auto-compact threshold so the post-compact context
// (summary + tail + overhead) lands with headroom and doesn't immediately
// re-trigger compaction. Beyond this, the armed summary is too stale to help
// and we fall back to a fresh synchronous compact.
const PRECOMPUTE_TAIL_BUDGET_FRACTION = 0.4

function precomputeTailBudget(model: string): number {
  return Math.floor(
    getAutoCompactThreshold(model) * PRECOMPUTE_TAIL_BUDGET_FRACTION,
  )
}

/**
 * True only for the main conversation's own query loop.
 *
 * Precompute keeps a SINGLE module-level slot, but query() is shared: subagents
 * ('agent:*' from AgentTool/SkillTool/swarm), the forked summarizers ('compact',
 * 'session_memory') and every other side-query drive the same loop with their
 * own message arrays. Letting them arm can't corrupt anything — consume matches
 * the armed pivot by uuid, so a foreign slot is discarded rather than used — but
 * they would thrash the slot, throwing away in-flight background summaries the
 * main thread paid for, and burn the shared per-cycle re-arm budget on summaries
 * that can never be consumed. So this is an allowlist, not a denylist.
 */
function isPrecomputeOwner(querySource?: QuerySource): boolean {
  if (!querySource) return false
  // Output-style variants suffix the value, hence startsWith (see QuerySource).
  return querySource.startsWith('repl_main_thread') || querySource === 'sdk'
}

/**
 * Arm a background precompute when the context has entered the warning band
 * (compaction is imminent) but hasn't yet crossed the auto-compact threshold.
 * Fire-and-forget and cheap-no-op when precompute is disabled.
 */
function maybeArmPrecompute(
  messages: Message[],
  context: ToolUseContext,
  cacheSafeParams: CacheSafeParams,
  model: string,
  querySource?: QuerySource,
): void {
  if (!isPrecomputeEnabled()) return
  if (!isPrecomputeOwner(querySource)) return
  if (!isAutoCompactEnabled()) return
  const tokenCount = tokenCountWithEstimation(messages)
  const { isAboveWarningThreshold, isAboveAutoCompactThreshold } =
    calculateTokenWarningState(tokenCount, model)
  // Only in the warning band: at/over threshold is the consume path, not arm.
  if (!isAboveWarningThreshold || isAboveAutoCompactThreshold) return
  armPrecompute({
    messages,
    context,
    cacheSafeParams,
    maxTailTokens: precomputeTailBudget(model),
  })
}

export async function autoCompactIfNeeded(
  messages: Message[],
  toolUseContext: ToolUseContext,
  cacheSafeParams: CacheSafeParams,
  querySource?: QuerySource,
  tracking?: AutoCompactTrackingState,
  snipTokensFreed?: number,
): Promise<{
  wasCompacted: boolean
  compactionResult?: CompactionResult
  consecutiveFailures?: number
}> {
  if (isEnvTruthy(process.env.DISABLE_COMPACT)) {
    return { wasCompacted: false }
  }

  // Circuit breaker: stop retrying after N consecutive failures.
  // Without this, sessions where context is irrecoverably over the limit
  // hammer the API with doomed compaction attempts on every turn.
  if (
    tracking?.consecutiveFailures !== undefined &&
    tracking.consecutiveFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES
  ) {
    return { wasCompacted: false }
  }

  const model = toolUseContext.options.mainLoopModel
  const shouldCompact = await shouldAutoCompact(
    messages,
    model,
    querySource,
    snipTokensFreed,
  )

  if (!shouldCompact) {
    // Below threshold: arm a background precompute if we're in the warning band
    // so the eventual compaction can consume a ready summary instead of blocking.
    maybeArmPrecompute(messages, toolUseContext, cacheSafeParams, model, querySource)
    return { wasCompacted: false }
  }

  const recompactionInfo: RecompactionInfo = {
    isRecompactionInChain: tracking?.compacted === true,
    turnsSincePreviousCompact: tracking?.turnCounter ?? -1,
    previousCompactTurnId: tracking?.turnId,
    autoCompactThreshold: getAutoCompactThreshold(model),
    querySource,
  }

  // autoCompactIfNeeded is the single owner of the compact_start / compact_end
  // lifecycle for the auto path. Inner functions (SM, compactConversation)
  // no longer emit these events.
  beginCompactLifecycle(toolUseContext)

  try {
    const preCompactHookResult: PreCompactHookResult =
      await executePreCompactHooks(
        { trigger: 'auto', customInstructions: null },
        toolUseContext.abortController.signal,
      )

    toolUseContext.onCompactProgress?.({ type: 'compact_start' })

    // Precomputed compaction: if a background summary is ready for the current
    // (append-only) message set, consume it — rebuilds the result via partial
    // 'up_to' keeping the current tail verbatim, skipping the summary API call.
    // Skipped when a pre-compact hook injected custom instructions the armed
    // summary didn't honor, or when we're already re-compacting in a chain
    // (mirrors resolveAutoCompactPivot: a prior compact under-relieved, so force
    // full for max relief instead of consuming a tail-preserving partial). On
    // any mismatch, consumePrecompute returns null and we fall through to the
    // normal SM / keep-tail / full paths.
    //
    // Gated on isPrecomputeOwner for the same reason arming is: a subagent
    // compacting its own context would find the main thread's slot, fail the
    // uuid match, and DISCARD a summary it never had a claim to (also resetting
    // the shared re-arm budget). Only the owner touches the slot.
    if (
      isPrecomputeOwner(querySource) &&
      !preCompactHookResult.newCustomInstructions &&
      !recompactionInfo.isRecompactionInChain &&
      isPrecomputeEnabled()
    ) {
      const pre = consumePrecompute({
        messages,
        maxTailTokens: precomputeTailBudget(model),
      })
      if (pre) {
        const compactionResult = await partialCompactConversation(
          messages,
          pre.pivotIndex,
          toolUseContext,
          cacheSafeParams,
          undefined, // no user feedback on the auto path
          'up_to', // keep the recent tail, summary covers the older prefix
          {
            trigger: 'auto',
            suppressFollowUpQuestions: true,
            preCompactHookResult,
            ownsLifecycle: false, // autoCompactIfNeeded owns begin/endCompactLifecycle
            autoCompactThreshold: recompactionInfo.autoCompactThreshold,
            precomputedSummary: pre.summaryText,
          },
        )
        setLastSummarizedMessageId(undefined)
        runPostCompactCleanup(querySource)
        if (feature('PROMPT_CACHE_BREAK_DETECTION')) {
          notifyCompaction(querySource ?? 'compact', toolUseContext.agentId)
        }
        markPostCompaction()
        return {
          wasCompacted: true,
          compactionResult,
          consecutiveFailures: 0,
        }
      }
    }

    // Try session memory compaction first
    if (!preCompactHookResult.newCustomInstructions) {
      const sessionMemoryResult = await trySessionMemoryCompaction(messages, {
        autoCompactThreshold: recompactionInfo.autoCompactThreshold,
        trigger: 'auto',
        context: toolUseContext,
        preCompactUserDisplayMessage: preCompactHookResult.userDisplayMessage,
      })
      if (sessionMemoryResult) {
        // Reset lastSummarizedMessageId since session memory compaction prunes messages
        // and the old message UUID will no longer exist after the REPL replaces messages
        setLastSummarizedMessageId(undefined)
        runPostCompactCleanup(querySource)
        // Reset cache read baseline so the post-compact drop isn't flagged as a
        // break. compactConversation does this internally; SM-compact doesn't.
        // BQ 2026-03-01: missing this made 20% of tengu_prompt_cache_break events
        // false positives (systemPromptChanged=true, timeSinceLastAssistantMsg=-1).
        if (feature('PROMPT_CACHE_BREAK_DETECTION')) {
          notifyCompaction(querySource ?? 'compact', toolUseContext.agentId)
        }
        markPostCompaction()
        return {
          wasCompacted: true,
          compactionResult: sessionMemoryResult,
        }
      }
    }

    // Keep-tail partial compaction: when a verbatim recent tail can be
    // preserved (and we're not already re-compacting in a chain), summarize
    // only the older prefix and keep the tail, instead of replacing the whole
    // conversation with a summary. Falls back to full compaction otherwise.
    const keepTailPivot = resolveAutoCompactPivot(
      messages,
      model,
      recompactionInfo,
    )
    if (keepTailPivot != null) {
      logForDebugging(
        `autocompact: keep-tail partial compaction (pivot=${keepTailPivot}, kept=${messages.length - keepTailPivot})`,
      )
    }
    const compactionResult =
      keepTailPivot != null
        ? await partialCompactConversation(
            messages,
            keepTailPivot,
            toolUseContext,
            cacheSafeParams,
            undefined, // no user feedback on the auto path
            'up_to', // keep the recent tail, summarize the older prefix
            {
              trigger: 'auto',
              suppressFollowUpQuestions: true,
              preCompactHookResult,
              // autoCompactIfNeeded owns begin/endCompactLifecycle
              ownsLifecycle: false,
              autoCompactThreshold: recompactionInfo.autoCompactThreshold,
            },
          )
        : await compactConversation(
            messages,
            toolUseContext,
            cacheSafeParams,
            true, // Suppress user questions for autocompact
            undefined, // Hook instructions are merged from preCompactHookResult
            true, // isAutoCompact
            recompactionInfo,
            preCompactHookResult,
          )

    // Reset lastSummarizedMessageId since legacy compaction replaces all messages
    // and the old message UUID will no longer exist in the new messages array
    setLastSummarizedMessageId(undefined)
    runPostCompactCleanup(querySource)

    return {
      wasCompacted: true,
      compactionResult,
      // Reset failure count on success
      consecutiveFailures: 0,
    }
  } catch (error) {
    if (isCompactionUserAbort(error, toolUseContext.abortController.signal)) {
      return {
        wasCompacted: false,
        consecutiveFailures: tracking?.consecutiveFailures,
      }
    }

    logError(error)
    // Increment consecutive failure count for circuit breaker.
    // The caller threads this through autoCompactTracking so the
    // next query loop iteration can skip futile retry attempts.
    const prevFailures = tracking?.consecutiveFailures ?? 0
    const nextFailures = prevFailures + 1
    if (nextFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES) {
      logForDebugging(
        `autocompact: circuit breaker tripped after ${nextFailures} consecutive failures — skipping future attempts this session`,
        { level: 'warn' },
      )
    }
    return { wasCompacted: false, consecutiveFailures: nextFailures }
  } finally {
    endCompactLifecycle(toolUseContext)
  }
}
