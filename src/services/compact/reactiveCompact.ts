// Reactive compaction: recovery for a context overflow that proactive
// auto-compact did not prevent. A single huge tool result can push one turn
// past the limit, so the main query itself comes back prompt-too-long (or
// media-too-large). The query loop withholds that error, compacts in place,
// and retries once with the compacted context.
//
// The recent rounds are kept verbatim when they fit a tail budget, so the
// retry continues from the user's actual latest request instead of a
// paraphrase of it. A round too big for the budget — typically the very tool
// result that caused the overflow — is summarized rather than kept, since
// keeping it would overflow the retry again. compactConversation and
// partialCompactConversation carry the prompt-too-long retries (boundary
// slide, then head truncation) for the summary request itself.

import { feature } from 'bun:bundle'
import type { QuerySource } from '../../constants/querySource.js'
import type { AssistantMessage, Message } from '../../types/message.js'
import { getGlobalConfig } from '../../utils/config.js'
import { logForDebugging } from '../../utils/debug.js'
import { isEnvDefinedFalsy } from '../../utils/envUtils.js'
import type { CacheSafeParams } from '../../utils/forkedAgent.js'
import { executePreCompactHooks } from '../../utils/hooks.js'
import { logError } from '../../utils/log.js'
import {
  getPromptTooLongTokenGap,
  isMediaSizeErrorMessage,
  isPromptTooLongMessage,
} from '../api/errors.js'
import { roughTokenCountEstimationForMessages } from '../tokenEstimation.js'
import {
  getModelEffectiveContextWindowSize,
  isAutoCompactEnabled,
  isBackgroundForkQuerySource,
} from './autoCompact.js'
import {
  beginCompactLifecycle,
  type CompactionResult,
  compactConversation,
  endCompactLifecycle,
  isCompactionUserAbort,
  partialCompactConversation,
  POST_COMPACT_SKILLS_TOKEN_BUDGET,
  POST_COMPACT_TOKEN_BUDGET,
  stripImagesFromMessages,
} from './compact.js'
import { suppressCompactWarning } from './compactWarningState.js'
import { groupMessagesByApiRound } from './grouping.js'
import { runPostCompactCleanup } from './postCompactCleanup.js'
import { adjustIndexToPreserveAPIInvariants } from './preservedTail.js'

// Fewer API rounds than this means the fixed prefix (system prompt, tools,
// userContext) is the overflow, and summarizing messages cannot help.
const MIN_GROUPS_TO_COMPACT = 2

// Verbatim tail budget: enough recent rounds to continue from, small enough
// that the retry has room to fit.
const REACTIVE_TAIL_FRACTION = 0.1
const REACTIVE_TAIL_FLOOR_TOKENS = 8_000
const REACTIVE_TAIL_CEIL_TOKENS = 20_000
// What the summary request adds on top of the summarized prefix (prompt and
// framing), so a tail sized from the overflow leaves that much headroom too.
const SUMMARY_REQUEST_OVERHEAD_TOKENS = 3_000
// What the retry carries besides the kept tail: system prompt, tools and
// userContext, the summary, and the context re-injected after compaction
// (restored files and invoked skills, each up to its own budget).
// Read at call time: compact.js and this module sit in an import cycle, so its
// constants are not yet initialized while this module evaluates.
const RETRY_FIXED_RESERVE_TOKENS = 40_000
function getRetryOverheadTokens(): number {
  return (
    RETRY_FIXED_RESERVE_TOKENS +
    POST_COMPACT_TOKEN_BUDGET +
    POST_COMPACT_SKILLS_TOKEN_BUDGET
  )
}

// Message's loose attachment typing doesn't narrow to the estimator's Attachment.
function estimateTokens(messages: Message[]): number {
  return roughTokenCountEstimationForMessages(
    messages as Parameters<typeof roughTokenCountEstimationForMessages>[0],
  )
}

/**
 * On whenever auto-compact is — DISABLE_COMPACT, DISABLE_AUTO_COMPACT and
 * autoCompactEnabled=false turn off both. `reactiveCompactEnabled: false` or
 * NOA_CLAUDE_REACTIVE_COMPACT=0 turns off only this recovery layer.
 */
export function isReactiveCompactEnabled(): boolean {
  if (
    isEnvDefinedFalsy(process.env.NOA_CLAUDE_REACTIVE_COMPACT) ||
    isEnvDefinedFalsy(process.env.CLAUDE_CODE_REACTIVE_COMPACT) ||
    getGlobalConfig().reactiveCompactEnabled === false
  ) {
    return false
  }
  return isAutoCompactEnabled()
}

/** Whether a query from this source recovers from an overflow by compacting. */
export function canReactivelyCompact(querySource: QuerySource): boolean {
  return isReactiveCompactEnabled() && !isExcludedSource(querySource)
}

export function isWithheldPromptTooLong(message: unknown): boolean {
  if (!isReactiveCompactEnabled()) return false
  const msg = message as AssistantMessage | undefined
  return (
    msg?.type === 'assistant' &&
    msg.isApiErrorMessage === true &&
    isPromptTooLongMessage(msg)
  )
}

export function isWithheldMediaSizeError(message: unknown): boolean {
  if (!isReactiveCompactEnabled()) return false
  const msg = message as AssistantMessage | undefined
  return msg?.type === 'assistant' && isMediaSizeErrorMessage(msg)
}

/**
 * Where the verbatim tail starts, or null to summarize everything.
 *
 * Keeps whole API rounds from the end while they fit the tail budget. When the
 * overflow is known, the tail must also hold at least that much plus the
 * summary request's own overhead, so the summary request — the conversation
 * minus the tail — fits on its first attempt. Past the budget the tail grows
 * only until that minimum is covered, never further: everything kept verbatim
 * also has to fit in the retry, next to the summary and the re-injected
 * context, which caps the tail at the window minus that overhead (and at half
 * the window). The summarized prefix must keep an assistant turn and every
 * earlier compact summary, the only record of the history before it.
 */
export function selectReactiveTailPivot(
  messages: Message[],
  model: string,
  tokenGap?: number,
): number | null {
  const groups = groupMessagesByApiRound(messages)
  if (groups.length < MIN_GROUPS_TO_COMPACT) return null

  const window = getModelEffectiveContextWindowSize(model)
  const budget = Math.min(
    Math.max(Math.floor(window * REACTIVE_TAIL_FRACTION), REACTIVE_TAIL_FLOOR_TOKENS),
    REACTIVE_TAIL_CEIL_TOKENS,
  )
  const hardCap = Math.max(
    budget,
    Math.min(Math.floor(window / 2), window - getRetryOverheadTokens()),
  )
  const minTail =
    tokenGap !== undefined ? tokenGap + SUMMARY_REQUEST_OVERHEAD_TOKENS : 0
  if (minTail > hardCap) return null

  // The summarized prefix must keep at least one assistant turn — otherwise
  // there is nothing substantive to summarize.
  const firstAssistantGroup = groups.findIndex(group =>
    group.some(m => m.type === 'assistant'),
  )
  if (firstAssistantGroup === -1) return null
  let tailTokens = 0
  let keptGroups = 0
  for (let g = groups.length - 1; g > firstAssistantGroup; g--) {
    const groupTokens = estimateTokens(groups[g]!)
    // Once the overflow is covered, the budget decides; the cap always does.
    if (tailTokens >= minTail && tailTokens + groupTokens > budget) break
    if (tailTokens + groupTokens > hardCap) break
    tailTokens += groupTokens
    keptGroups++
  }
  if (keptGroups === 0 || tailTokens < minTail) return null

  const groupPivot = groups
    .slice(0, groups.length - keptGroups)
    .reduce((count, group) => count + group.length, 0)
  const pivot = adjustIndexToPreserveAPIInvariants(messages, groupPivot)
  if (pivot <= 0 || pivot >= messages.length) return null

  // Snapping back to keep a tool_use with its result may grow the tail; it may
  // not grow past what the loop itself would have accepted.
  const tail = messages.slice(pivot)
  const snappedTailTokens =
    pivot === groupPivot ? tailTokens : estimateTokens(tail)
  if (
    snappedTailTokens > Math.min(Math.max(budget, tailTokens), hardCap) ||
    snappedTailTokens < minTail
  ) {
    return null
  }

  const prefix = messages.slice(0, pivot)
  if (!prefix.some(m => m.type === 'assistant')) return null
  if (tail.some(m => m.type === 'user' && m.isCompactSummary)) return null
  return pivot
}

// Sources that must never compact their own context, matching
// shouldAutoCompact: forked summarizers (the summary request would recurse
// into another summary), background side-task forks, and the context-collapse
// agent (runPostCompactCleanup would reset the main thread's collapse log).
function isExcludedSource(querySource: QuerySource): boolean {
  if (querySource === 'compact' || querySource === 'session_memory') {
    return true
  }
  if (isBackgroundForkQuerySource(querySource)) {
    return true
  }
  if (feature('CONTEXT_COLLAPSE')) {
    if (querySource === 'marble_origami') {
      return true
    }
  }
  return false
}

/**
 * Returns a CompactionResult to retry with, or null to surface the original
 * error. Single-shot per turn (hasAttempted) so a repeated overflow cannot
 * spiral.
 */
export async function tryReactiveCompact(params: {
  hasAttempted: boolean
  querySource: QuerySource
  aborted: boolean
  messages: Message[]
  cacheSafeParams: CacheSafeParams
  /** The withheld API error that triggered recovery. */
  error?: AssistantMessage
}): Promise<CompactionResult | null> {
  const { hasAttempted, querySource, aborted, cacheSafeParams, error } = params
  if (!canReactivelyCompact(querySource) || aborted || hasAttempted) return null

  if (groupMessagesByApiRound(params.messages).length < MIN_GROUPS_TO_COMPACT) {
    logForDebugging(
      '[REACTIVE] too few rounds — compaction cannot help; surfacing error',
    )
    return null
  }

  const context = cacheSafeParams.toolUseContext
  // A media rejection repeats on every request that still carries the media —
  // the summary request and the retry alike — so strip it before either. The
  // kept tail is stripped in memory only: its transcript entries are shared by
  // uuid and keep the original media, so a resumed session can hit the same
  // rejection once more and recover the same way.
  const isMediaError = error !== undefined && isMediaSizeErrorMessage(error)
  const messages = isMediaError
    ? stripImagesFromMessages(params.messages)
    : params.messages
  const compactParams = isMediaError
    ? { ...cacheSafeParams, forkContextMessages: messages }
    : cacheSafeParams
  const tokenGap =
    error !== undefined && !isMediaError
      ? getPromptTooLongTokenGap(error)
      : undefined
  const pivot = selectReactiveTailPivot(
    messages,
    context.options.mainLoopModel,
    tokenGap,
  )

  beginCompactLifecycle(context)
  try {
    logForDebugging(
      `[REACTIVE] recovering from withheld ${isMediaError ? 'media error' : 'overflow'} via ${pivot === null ? 'full' : `keep-tail (pivot=${pivot}/${messages.length})`} compact`,
    )
    const preCompactHookResult = await executePreCompactHooks(
      { trigger: 'auto', customInstructions: null },
      context.abortController.signal,
    )
    context.onCompactProgress?.({ type: 'compact_start' })
    const result =
      pivot === null
        ? await compactConversation(
            messages,
            context,
            compactParams,
            true, // suppress follow-up questions
            undefined, // no custom instructions on the auto path
            true, // isAutoCompact
            undefined,
            preCompactHookResult,
          )
        : await partialCompactConversation(
            messages,
            pivot,
            context,
            compactParams,
            undefined,
            'up_to', // summarize the older prefix, keep the recent rounds
            {
              trigger: 'auto',
              suppressFollowUpQuestions: true,
              preCompactHookResult,
              ownsLifecycle: false,
            },
          )
    runPostCompactCleanup(querySource)
    suppressCompactWarning()
    return result
  } catch (compactError) {
    if (!isCompactionUserAbort(compactError, context.abortController.signal)) {
      logError(compactError)
    }
    return null
  } finally {
    endCompactLifecycle(context)
  }
}
