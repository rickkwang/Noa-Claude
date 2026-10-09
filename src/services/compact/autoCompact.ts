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
import { roughTokenCountEstimationForMessages } from '../tokenEstimation.js'
import { createAttachmentMessage } from '../../utils/attachments.js'
import { SYNTHETIC_MODEL } from '../../utils/messages.js'
import {
  noteOverflowCanCompact,
  overflowReminderText,
  type PendingOverflow,
  settleOverflow,
  takeOverflow,
} from './classifierOverflowCompact.js'
import { getMaxOutputTokensForModel } from '../api/claude.js'
import { notifyCompaction } from '../api/promptCacheBreakDetection.js'
import {
  beginCompactLifecycle,
  type CompactionResult,
  ERROR_MESSAGE_COMPACT_BLOCKED_BY_HOOK,
  compactConversation,
  endCompactLifecycle,
  isCompactionUserAbort,
  partialCompactConversation,
  type PreCompactHookResult,
  type RecompactionInfo,
} from './compact.js'
import {
  armPrecompute,
  consumePrecompute,
  isPrecomputeEnabled,
} from './precomputedCompact.js'
import { runPostCompactCleanup } from './postCompactCleanup.js'
import { runReactiveCompaction, type ReactiveCompactOutcome } from './reactiveCompact.js'
import { executePreCompactHooks } from '../../utils/hooks.js'

// Reserve this many tokens for output during compaction
// Based on p99.99 of compact summary output being 17,387 tokens.
const MAX_OUTPUT_TOKENS_FOR_SUMMARY = 20_000

// Safety floor: ensure effective context never drops below this value
// This prevents compact threshold from becoming negative and triggering infinite loops
const MIN_EFFECTIVE_CONTEXT_FLOOR = 13_000

function getSummaryOutputReserve(model: string): number {
  return Math.min(getMaxOutputTokensForModel(model), MAX_OUTPUT_TOKENS_FOR_SUMMARY)
}

/**
 * The model's real context window minus the summary output reserve, ignoring
 * any /autocompact window. That setting says when to compact, not how much
 * the API accepts — so the hard blocking limit is measured against this.
 */
export function getModelEffectiveContextWindowSize(model: string): number {
  return Math.max(
    getContextWindowForModel(model, getSdkBetas()) -
      getSummaryOutputReserve(model),
    MIN_EFFECTIVE_CONTEXT_FLOOR,
  )
}

const AUTO_COMPACT_WINDOW_MIN = 100_000
const AUTO_COMPACT_WINDOW_MAX = 1_000_000

/**
 * Parses CLAUDE_CODE_AUTO_COMPACT_WINDOW like upstream: exponent or
 * digit-grouped numbers, otherwise a leading-integer parseInt. Invalid values
 * return undefined so the /autocompact setting applies; valid ones are clamped
 * to [100k, 1M].
 */
export function parseAutoCompactWindowEnv(raw: string): number | undefined {
  const s = raw.trim()
  const n = /^[+-]?(\d+(\.\d*)?|\.\d+)[eE][+-]?\d+$/.test(s)
    ? Number(s)
    : /^[+-]?\d{1,3}([_,\u00A0\u202F ])\d{3}(?:\1\d{3})*$/.test(s)
      ? parseInt(s.replace(/[_,\u00A0\u202F ]/g, ''), 10)
      : parseInt(s, 10)
  if (!Number.isInteger(n) || n <= 0) return undefined
  return Math.min(Math.max(n, AUTO_COMPACT_WINDOW_MIN), AUTO_COMPACT_WINDOW_MAX)
}

/**
 * The user-configured auto-compact window, if any: a valid env value overrides
 * the persisted /autocompact setting.
 */
function getConfiguredAutoCompactWindow(): number | undefined {
  const fromEnv = parseAutoCompactWindowEnv(
    process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW ?? '',
  )
  if (fromEnv !== undefined) return fromEnv
  const configWindow = getGlobalConfig().autoCompactWindow
  return configWindow != null && configWindow > 0 ? configWindow : undefined
}

// Returns the auto-compact window minus the summary output reserve
export function getEffectiveContextWindowSize(model: string): number {
  const reservedTokensForSummary = getSummaryOutputReserve(model)
  let contextWindow = getContextWindowForModel(model, getSdkBetas())

  // The window is capped to the model's real context window below.
  const configuredWindow = getConfiguredAutoCompactWindow()
  if (configuredWindow !== undefined) {
    contextWindow = Math.min(contextWindow, configuredWindow)
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
  // Consecutive compacts that each happened within RAPID_REFILL_TURN_WINDOW
  // turns of the previous one. Feeds the rapid-refill breaker.
  consecutiveRapidRefills?: number
}

// Rapid-refill breaker. If compaction fires, the
// context refills past the threshold within a few turns, and compaction fires
// again — repeatedly — something in the loop is re-inflating context faster
// than summarization can shrink it (e.g. a huge file read or tool result in
// the preserved tail). Compacting forever burns a summary call every few
// turns; trip instead and surface an error.
export const RAPID_REFILL_TURN_WINDOW = 3
export const RAPID_REFILL_MAX_CONSECUTIVE = 3
export const AUTOCOMPACT_THRASHING_MESSAGE =
  'Autocompact is thrashing: the context refilled to the limit within 3 turns of the previous compact, 3 times in a row. ' +
  'A file being read or a tool output is likely too large for the context window. ' +
  'Try reading in smaller chunks, or use /clear to start fresh.'

/**
 * Consecutive compacts that each happened within RAPID_REFILL_TURN_WINDOW
 * turns of the previous one. Any gap >= the window (or no prior compact)
 * resets the streak to 0.
 */
export function countConsecutiveRapidRefills(
  tracking: AutoCompactTrackingState | undefined,
): number {
  return tracking?.compacted === true &&
    tracking.turnCounter < RAPID_REFILL_TURN_WINDOW
    ? (tracking.consecutiveRapidRefills ?? 0) + 1
    : 0
}

export const AUTOCOMPACT_BUFFER_TOKENS = 13_000
export const WARNING_THRESHOLD_BUFFER_TOKENS = 20_000
export const ERROR_THRESHOLD_BUFFER_TOKENS = 10_000
export const MANUAL_COMPACT_BUFFER_TOKENS = 3_000

// Stop trying autocompact after this many consecutive failures. A context
// that is irrecoverably over the limit otherwise spends a doomed summary call
// on every turn.
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

  const defaultBlockingLimit =
    getModelEffectiveContextWindowSize(model) - MANUAL_COMPACT_BUFFER_TOKENS

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

/**
 * Background forks that carry the parent conversation for a one-shot side
 * task (next-prompt suggestion, away/agent progress summaries, speculative
 * execution). When one overflows, the side task is simply skipped: compacting
 * it would spend a full summary call on throwaway context, and the post-compact
 * cleanup resets process-wide state the main thread still relies on.
 */
const BACKGROUND_FORK_QUERY_SOURCES: ReadonlySet<string> = new Set([
  'agent_summary',
  'away_summary',
  'prompt_suggestion',
  'speculation',
])

export function isBackgroundForkQuerySource(
  querySource: QuerySource | undefined,
): boolean {
  return querySource !== undefined && BACKGROUND_FORK_QUERY_SOURCES.has(querySource)
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
  // Recursion guards: session_memory and compact are forked agents that
  // would deadlock.
  if (querySource === 'session_memory' || querySource === 'compact') {
    return false
  }
  if (isBackgroundForkQuerySource(querySource)) {
    return false
  }

  if (!isAutoCompactEnabled()) {
    return false
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

  if (
    isAboveAutoCompactThreshold &&
    isFixedPrefixOverThreshold(tokenCount, messages, threshold)
  ) {
    const prefixTokens =
      tokenCount - roughTokenCountEstimationForMessages(messages)
    logForDebugging(
      `autocompact: fixed prefix ~${prefixTokens} > threshold ${threshold} — compaction cannot help`,
      { level: 'warn' },
    )
  }

  return isAboveAutoCompactThreshold
}

/**
 * Does the part of the request compaction cannot shrink — system prompt, tool
 * schemas, userContext — already clear the threshold on its own?
 *
 * When it does, every compaction succeeds and the very next turn re-triggers,
 * because summarizing messages can't touch the thing that's actually too big
 * (usually a large MCP tool set). The rapid-refill breaker catches that
 * symptom; this names the cause so the log says what to go turn off.
 *
 * Subtracts with roughTokenCountEstimationForMessages, not
 * estimateMessageTokens: tokenCount comes from tokenCountWithEstimation, which
 * is real usage plus roughTokenCountEstimationForMessages of the tail, so this
 * is the one estimator that cancels. estimateMessageTokens skips messages
 * whose content is a plain string, which would charge every such user turn to
 * the prefix and fire on conversations that have no prefix problem.
 *
 * Still a diagnostic, not a number to act on: the remainder is the prefix plus
 * whatever the estimator got wrong.
 */
export function isFixedPrefixOverThreshold(
  tokenCount: number,
  messages: Message[],
  threshold: number,
): boolean {
  return (
    Math.max(0, tokenCount - roughTokenCountEstimationForMessages(messages)) >
    threshold
  )
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

export function isAutoCompactWindowConfigured(): boolean {
  return getConfiguredAutoCompactWindow() !== undefined
}

/**
 * Whether this query source may compact at all. Forked summarizers and
 * background side-task forks never do (see shouldAutoCompact).
 */
function canAutoCompactSource(querySource: QuerySource | undefined): boolean {
  if (isEnvTruthy(process.env.DISABLE_COMPACT)) return false
  if (!isAutoCompactEnabled()) return false
  return (
    querySource !== undefined &&
    querySource !== 'compact' &&
    querySource !== 'session_memory' &&
    !isBackgroundForkQuerySource(querySource)
  )
}

/**
 * The model the conversation was last served by, when it has a larger window
 * than the current one and the current window would block. Upstream also gates
 * this on the model's recognition and billing state, which Noa has no source
 * for; the window comparison stands in for "recognized".
 */
function findLargerWindowModel(
  messages: Message[],
  model: string,
  snipTokensFreed: number,
): string | undefined {
  let candidate: string | undefined
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message?.type === 'assistant' && message.message.model !== SYNTHETIC_MODEL) {
      candidate = message.message.model
      break
    }
  }
  if (candidate === undefined || candidate === model) return undefined
  if (getContextWindowForModel(candidate, getSdkBetas()) <= getContextWindowForModel(model, getSdkBetas())) {
    return undefined
  }
  const tokenCount = tokenCountWithEstimation(messages) - snipTokensFreed
  return calculateTokenWarningState(tokenCount, model).isAtBlockingLimit
    ? candidate
    : undefined
}

/**
 * Compacts through the reactive ladder. Used when the window is configured,
 * when a classifier overflow is pending, and for the larger-window retry (with
 * the summary request sent to that model).
 */
function compactRouted(
  messages: Message[],
  toolUseContext: ToolUseContext,
  cacheSafeParams: CacheSafeParams,
  querySource: QuerySource,
  summaryModel?: string,
): Promise<ReactiveCompactOutcome> {
  const context =
    summaryModel === undefined
      ? toolUseContext
      : {
          ...toolUseContext,
          options: { ...toolUseContext.options, mainLoopModel: summaryModel },
        }
  return runReactiveCompaction({
    messages,
    cacheSafeParams: { ...cacheSafeParams, toolUseContext: context },
    querySource,
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
  // Set when the rapid-refill breaker tripped (value = streak length). No
  // compaction was attempted — the caller should end the turn.
  rapidRefillTripped?: number
  // Streak length to persist into the next tracking state on success.
  consecutiveRapidRefills?: number
}> {
  if (isEnvTruthy(process.env.DISABLE_COMPACT)) {
    return { wasCompacted: false }
  }

  const canCompact = canAutoCompactSource(querySource)
  noteOverflowCanCompact(toolUseContext.agentId, canCompact)
  const model = toolUseContext.options.mainLoopModel
  let failures = tracking?.consecutiveFailures

  // Larger-window retry: when the current window would block and the last
  // served model had a larger one, summarize with that model. Skipped once a
  // previous compaction has failed.
  if ((failures ?? 0) === 0 && querySource !== undefined && canCompact) {
    const largerModel = findLargerWindowModel(messages, model, snipTokensFreed ?? 0)
    if (largerModel !== undefined) {
      logForDebugging(
        `autocompact: summarizing with larger-window model ${largerModel} (current window would block)`,
      )
      const outcome = await compactRouted(
        messages,
        toolUseContext,
        cacheSafeParams,
        querySource,
        largerModel,
      )
      if (outcome.kind === 'compacted') {
        return {
          wasCompacted: true,
          compactionResult: outcome.result,
          consecutiveFailures: 0,
          consecutiveRapidRefills: countConsecutiveRapidRefills(tracking),
        }
      }
      if (outcome.kind === 'hook_blocked') {
        return { wasCompacted: false, consecutiveFailures: failures }
      }
      failures = (failures ?? 0) + 1
    }
  }

  const currentMode = toolUseContext.getAppState().toolPermissionContext.mode
  const forced = takeOverflow({
    messages,
    agentId: toolUseContext.agentId,
    mode: currentMode,
    canCompact,
  })

  // Circuit breaker: stop retrying after N consecutive failures.
  // Without this, sessions where context is irrecoverably over the limit
  // hammer the API with doomed compaction attempts on every turn. A pending
  // classifier overflow bypasses it: its compaction is what unblocks the turn.
  if (forced === undefined && (failures ?? 0) >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES) {
    return { wasCompacted: false }
  }

  const shouldCompact =
    forced !== undefined ||
    (await shouldAutoCompact(messages, model, querySource, snipTokensFreed))

  if (!shouldCompact) {
    // Below threshold: arm a background precompute if we're in the warning band
    // so the eventual compaction can consume a ready summary instead of blocking.
    maybeArmPrecompute(messages, toolUseContext, cacheSafeParams, model, querySource)
    return { wasCompacted: false, consecutiveFailures: failures }
  }

  // Rapid-refill breaker. Checked before spending a summary call: when the
  // streak trips, the summary would be wasted — the turn is dying either way.
  const consecutiveRapidRefills = countConsecutiveRapidRefills(tracking)
  if (consecutiveRapidRefills >= RAPID_REFILL_MAX_CONSECUTIVE) {
    logForDebugging(
      `autocompact: rapid-refill breaker tripped — ${consecutiveRapidRefills} consecutive refills within <${RAPID_REFILL_TURN_WINDOW} turns each (last was ${tracking?.turnCounter} turns)`,
      { level: 'warn' },
    )
    if (forced !== undefined) {
      settleOverflow(toolUseContext.agentId, forced, false)
    }
    return { wasCompacted: false, rapidRefillTripped: consecutiveRapidRefills }
  }

  const routed =
    forced !== undefined || isAutoCompactWindowConfigured()
  if (routed && querySource !== undefined) {
    return finishRoutedCompaction({
      outcome: await compactRouted(messages, toolUseContext, cacheSafeParams, querySource),
      forced,
      toolUseContext,
      failures,
      consecutiveRapidRefills,
    })
  }

  const recompactionInfo: RecompactionInfo = {
    isRecompactionInChain: tracking?.compacted === true,
    turnsSincePreviousCompact: tracking?.turnCounter ?? -1,
    previousCompactTurnId: tracking?.turnId,
    autoCompactThreshold: getAutoCompactThreshold(model),
    querySource,
  }

  // autoCompactIfNeeded owns the compact_start / compact_end lifecycle for the
  // auto path; compactConversation does not emit those events itself.
  beginCompactLifecycle(toolUseContext)

  try {
    const preCompactHookResult: PreCompactHookResult =
      await executePreCompactHooks(
        { trigger: 'auto', customInstructions: null },
        toolUseContext.abortController.signal,
      )
    // A hook veto is a decision, not a failure: skip this attempt and leave
    // the circuit breaker's failure count where it was.
    if (preCompactHookResult.blockedBy) {
      logForDebugging(
        `autocompact: ${ERROR_MESSAGE_COMPACT_BLOCKED_BY_HOOK}: ${preCompactHookResult.blockedBy}`,
        { level: 'warn' },
      )
      return {
        wasCompacted: false,
        consecutiveFailures: failures,
      }
    }

    toolUseContext.onCompactProgress?.({ type: 'compact_start' })

    // Precomputed compaction: if a background summary is ready for the current
    // (append-only) message set, consume it — rebuilds the result via partial
    // 'up_to' keeping the current tail verbatim, skipping the summary API call.
    // Skipped when a pre-compact hook injected custom instructions the armed
    // summary didn't honor, or when we're already re-compacting in a chain
    // (a prior compact under-relieved, so force full for max relief). On any
    // mismatch, consumePrecompute returns null and we fall through to full
    // compaction.
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
        runPostCompactCleanup(querySource)
        if (feature('PROMPT_CACHE_BREAK_DETECTION')) {
          notifyCompaction(querySource ?? 'compact', toolUseContext.agentId)
        }
        markPostCompaction()
        return {
          wasCompacted: true,
          compactionResult,
          consecutiveFailures: 0,
          consecutiveRapidRefills,
        }
      }
    }

    const compactionResult = await compactConversation(
      messages,
      toolUseContext,
      cacheSafeParams,
      true, // Suppress user questions for autocompact
      undefined, // Hook instructions are merged from preCompactHookResult
      true, // isAutoCompact
      recompactionInfo,
      preCompactHookResult,
    )

    runPostCompactCleanup(querySource)

    return {
      wasCompacted: true,
      compactionResult,
      // Reset failure count on success
      consecutiveFailures: 0,
      consecutiveRapidRefills,
    }
  } catch (error) {
    if (isCompactionUserAbort(error, toolUseContext.abortController.signal)) {
      return {
        wasCompacted: false,
        consecutiveFailures: failures,
      }
    }

    logError(error)
    // Increment consecutive failure count for circuit breaker.
    // The caller threads this through autoCompactTracking so the
    // next query loop iteration can skip futile retry attempts.
    const nextFailures = (failures ?? 0) + 1
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

function finishRoutedCompaction(args: {
  outcome: ReactiveCompactOutcome
  forced: PendingOverflow | undefined
  toolUseContext: ToolUseContext
  failures: number | undefined
  consecutiveRapidRefills: number
}): {
  wasCompacted: boolean
  compactionResult?: CompactionResult
  consecutiveFailures?: number
  consecutiveRapidRefills?: number
} {
  const { outcome, forced, toolUseContext, failures } = args
  const aborted = toolUseContext.abortController.signal.aborted
  if (forced !== undefined) {
    settleOverflow(toolUseContext.agentId, forced, aborted)
  }
  if (outcome.kind === 'hook_blocked') {
    return { wasCompacted: false, consecutiveFailures: failures }
  }
  if (outcome.kind === 'failed') {
    const nextFailures = (failures ?? 0) + 1
    if (nextFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES) {
      logForDebugging(
        `autocompact: circuit breaker tripped after ${nextFailures} consecutive failures (reactive path) — skipping future attempts this session`,
        { level: 'warn' },
      )
    }
    return { wasCompacted: false, consecutiveFailures: nextFailures }
  }
  const result =
    forced === undefined
      ? outcome.result
      : {
          ...outcome.result,
          attachments: [
            ...outcome.result.attachments,
            createAttachmentMessage({
              type: 'critical_system_reminder',
              content: overflowReminderText(forced.deniedToolNames),
            }),
          ],
        }
  return {
    wasCompacted: true,
    compactionResult: result,
    consecutiveFailures: 0,
    consecutiveRapidRefills: args.consecutiveRapidRefills,
  }
}
