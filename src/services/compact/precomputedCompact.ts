// @ts-nocheck
//
// Precomputed compaction (in-memory, opt-in).
//
// Problem: a full auto-compact blocks the turn for 5-30s while the summary API
// call runs. Precompute hides that latency by computing the summary *ahead of
// time* in the background — once the context enters the warning zone but before
// it crosses the auto-compact threshold — and consuming the ready result when
// the compaction actually fires.
//
// Design (reuses noa's keep-tail / partial 'up_to' path):
//   - ARM: while approaching the threshold, background-summarize the current
//     message set (the prefix). The expensive streamCompactSummary API call
//     runs on a detached promise with a UI-stubbed context clone, so the main
//     loop is never blocked and the compacting spinner never shows.
//   - CONSUME: when auto-compact fires, if a ready summary exists whose armed
//     prefix is still an append-only prefix of the current messages (and the
//     new verbatim tail is within budget), rebuild the CompactionResult via
//     partialCompactConversation('up_to', { precomputedSummary }) — which
//     splices the current tail after the summary and SKIPS the API call.
//   - Any mismatch (history rewound, tail too large, compute failed/aborted)
//     discards the precompute and the caller falls back to synchronous compact.
//
// Off by default. Enable at runtime with NOA_CLAUDE_PRECOMPUTE_COMPACT=1
// (legacy CLAUDE_CODE_PRECOMPUTE_COMPACT also accepted). When disabled the
// entry points are cheap no-ops and behaviour is identical to before.

import type { UUID } from 'crypto'
import type { ToolUseContext } from '../../Tool.js'
import type { AssistantMessage, Message } from '../../types/message.js'
import { getGlobalConfig } from '../../utils/config.js'
import { logForDebugging } from '../../utils/debug.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import type { CacheSafeParams } from '../../utils/forkedAgent.js'
import { logError } from '../../utils/log.js'
import {
  createUserMessage,
  getAssistantMessageText,
} from '../../utils/messages.js'
import { streamCompactSummary } from './compact.js'
import { estimateMessageTokens } from './microCompact.js'
import { getPartialCompactPrompt } from './prompt.js'

export function isPrecomputeEnabled(): boolean {
  if (isEnvTruthy(process.env.NOA_CLAUDE_PRECOMPUTE_COMPACT)) return true
  if (isEnvTruthy(process.env.CLAUDE_CODE_PRECOMPUTE_COMPACT)) return true
  // Optional persisted opt-in (defaults false when unset).
  return getGlobalConfig().precomputeCompactEnabled === true
}

type ArmedState = {
  status: 'computing' | 'ready' | 'error'
  // Number of messages summarized === pivot index at consume time.
  pivotCount: number
  // uuid of the last armed message; guards against history rewrite/rewind.
  tailUuid: UUID
  summaryText?: string
  startedAt: number
  abort: AbortController
}

let armed: ArmedState | null = null

// Each arm spends a real background summary API call. Re-arming is triggered by
// the tail outgrowing its budget or the prefix changing (rewind/edit), both of
// which a user can drive repeatedly while sitting in the warning band. Cap the
// re-arms per compaction cycle so a churning session can't spend unbounded
// tokens on summaries it never consumes. The counter resets when a compaction
// actually fires (consumePrecompute) — i.e. once per cycle.
const MAX_ARM_ATTEMPTS_PER_CYCLE = 3
let armAttempts = 0

/**
 * True when `armed` still describes an append-only prefix of `messages`
 * (the armed pivot message is exactly messages[pivotCount-1]).
 */
function armedPrefixMatches(messages: Message[]): boolean {
  if (!armed) return false
  if (messages.length < armed.pivotCount || armed.pivotCount < 1) return false
  return messages[armed.pivotCount - 1]?.uuid === armed.tailUuid
}

function tailTokens(messages: Message[], pivotCount: number): number {
  return estimateMessageTokens(messages.slice(pivotCount))
}

/**
 * Reset the precompute slot, aborting any in-flight background compute.
 * Safe to call unconditionally.
 */
export function discardPrecompute(reason: string): void {
  if (!armed) return
  logForDebugging(`[PRECOMPUTE] discard (${reason})`, { level: 'debug' })
  try {
    armed.abort.abort()
  } catch {
    // Aborting a settled controller is a no-op; ignore.
  }
  armed = null
}

/**
 * Fire-and-forget: kick off a background summary for the current message set
 * if one isn't already validly armed. Cheap no-op when disabled.
 *
 * `maxTailTokens` bounds how large the verbatim tail may grow before the armed
 * summary stops relieving enough pressure — when the current tail exceeds it we
 * re-arm at the current (larger) pivot so consume stays useful.
 */
export function armPrecompute(params: {
  messages: Message[]
  context: ToolUseContext
  cacheSafeParams: CacheSafeParams
  maxTailTokens: number
}): void {
  if (!isPrecomputeEnabled()) return
  const { messages, context, cacheSafeParams, maxTailTokens } = params

  const pivotCount = messages.length
  const tailUuid = messages[pivotCount - 1]?.uuid as UUID | undefined
  if (!tailUuid || pivotCount < 2) return

  // Already armed on a compatible prefix?
  if (
    armed &&
    (armed.status === 'computing' || armed.status === 'ready') &&
    armedPrefixMatches(messages)
  ) {
    // Still fresh enough? If the verbatim tail has grown past budget, the
    // armed summary no longer relieves enough — re-arm at the current pivot.
    if (tailTokens(messages, armed.pivotCount) <= maxTailTokens) {
      return
    }
    discardPrecompute('tail_grew_rearm')
  } else if (armed && !armedPrefixMatches(messages)) {
    discardPrecompute('prefix_changed_rearm')
  } else if (armed) {
    // errored slot — replace it
    discardPrecompute('replace_errored')
  }

  // Cost guard: don't keep re-arming within a single compaction cycle.
  if (armAttempts >= MAX_ARM_ATTEMPTS_PER_CYCLE) {
    logForDebugging(
      `[PRECOMPUTE] re-arm capped (${armAttempts}/${MAX_ARM_ATTEMPTS_PER_CYCLE} this cycle)`,
    )
    return
  }
  armAttempts++

  const abort = new AbortController()
  // Link to the session abort so an interrupted session cancels the background
  // compute too (the summary would be useless once the session is gone).
  const onSessionAbort = () => abort.abort()
  context.abortController.signal.addEventListener('abort', onSessionAbort, {
    once: true,
  })

  armed = {
    status: 'computing',
    pivotCount,
    tailUuid,
    startedAt: Date.now(),
    abort,
  }
  const slot = armed

  logForDebugging(
    `[PRECOMPUTE] arm: summarizing ${pivotCount} messages in background`,
  )

  void computeSummary(messages, context, cacheSafeParams, abort)
    .then(text => {
      // Slot may have been discarded/replaced while we were computing.
      if (armed !== slot) return
      if (!text) {
        slot.status = 'error'
        return
      }
      slot.status = 'ready'
      slot.summaryText = text
      logForDebugging('[PRECOMPUTE] ready')
    })
    .catch(error => {
      if (armed === slot) slot.status = 'error'
      logError(error)
    })
    .finally(() => {
      context.abortController.signal.removeEventListener(
        'abort',
        onSessionAbort,
      )
    })
}

/**
 * If a ready summary matches the current (append-only) message set and the
 * verbatim tail is within budget, return it for consumption and clear the slot.
 * Otherwise discard and return null (caller compacts synchronously).
 */
export function consumePrecompute(params: {
  messages: Message[]
  maxTailTokens: number
}): { pivotIndex: number; summaryText: string } | null {
  if (!isPrecomputeEnabled()) return null
  // Compaction is firing: a new cycle begins regardless of the outcome below,
  // so the per-cycle re-arm budget refreshes here.
  armAttempts = 0
  if (!armed) return null
  const { messages, maxTailTokens } = params

  if (armed.status !== 'ready' || !armed.summaryText) {
    // Still computing or errored — don't wait, fall back to sync compact.
    logForDebugging(`[PRECOMPUTE] not consumable (status=${armed.status})`)
    return null
  }
  if (!armedPrefixMatches(messages)) {
    discardPrecompute('consume_prefix_changed')
    return null
  }
  if (tailTokens(messages, armed.pivotCount) > maxTailTokens) {
    discardPrecompute('consume_tail_too_large')
    return null
  }

  const result = { pivotIndex: armed.pivotCount, summaryText: armed.summaryText }
  logForDebugging(
    `[PRECOMPUTE] consume: pivot=${result.pivotIndex}, tail kept verbatim`,
  )
  armed = null
  return result
}

/**
 * Background summary computation. Uses the same partial 'up_to' prompt that
 * consume's partialCompactConversation will use, over a UI-stubbed context
 * clone so the compacting spinner / stream state of the live session is never
 * touched. Returns the raw summary text (with <analysis>/<summary> tags), or
 * null on abort / empty / API-error response.
 */
async function computeSummary(
  messages: Message[],
  context: ToolUseContext,
  cacheSafeParams: CacheSafeParams,
  abort: AbortController,
): Promise<string | null> {
  const quietContext: ToolUseContext = {
    ...context,
    abortController: abort,
    setStreamMode: undefined,
    setResponseLength: undefined,
    setSDKStatus: undefined,
    onCompactProgress: undefined,
  }

  const summaryRequest = createUserMessage({
    content: getPartialCompactPrompt(undefined, 'up_to'),
  })

  const response: AssistantMessage = await streamCompactSummary({
    messages,
    summaryRequest,
    appState: context.getAppState(),
    context: quietContext,
    preCompactTokenCount: estimateMessageTokens(messages),
    // 'up_to' summarizes the whole armed set; forkContextMessages must match.
    cacheSafeParams: { ...cacheSafeParams, forkContextMessages: messages },
  })

  if (abort.signal.aborted) return null
  const text = getAssistantMessageText(response)
  if (!text || (response as AssistantMessage).isApiErrorMessage) return null
  return text
}

// Test-only: inspect/inject/reset internal state without going through the API.
export function __getArmedForTest(): ArmedState | null {
  return armed
}
export function __resetForTest(): void {
  armed = null
  armAttempts = 0
}
export function __getArmAttemptsForTest(): number {
  return armAttempts
}
export const __MAX_ARM_ATTEMPTS_PER_CYCLE = MAX_ARM_ATTEMPTS_PER_CYCLE
export function __setReadyForTest(state: {
  pivotCount: number
  tailUuid: string
  summaryText: string
}): void {
  armed = {
    status: 'ready',
    pivotCount: state.pivotCount,
    tailUuid: state.tailUuid as UUID,
    summaryText: state.summaryText,
    startedAt: 0,
    abort: new AbortController(),
  }
}
export function __setComputingForTest(state: {
  pivotCount: number
  tailUuid: string
}): void {
  armed = {
    status: 'computing',
    pivotCount: state.pivotCount,
    tailUuid: state.tailUuid as UUID,
    startedAt: 0,
    abort: new AbortController(),
  }
}
