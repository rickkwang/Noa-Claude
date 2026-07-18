// Reactive compaction: the safety net for an UNEXPECTED context overflow.
//
// Proactive auto-compact (autoCompact.ts) relieves pressure BEFORE the model
// query is sent. But a single huge tool result can push one turn straight past
// the limit, so the main query itself comes back prompt-too-long (or a media
// too-large rejection). Without recovery the user just sees "Conversation too
// long". Reactive compaction catches that withheld error and summarizes in
// place, then the loop retries with the compacted context.
//
// This module is loaded by query.ts / commands/compact only under
// feature('REACTIVE_COMPACT') (dev-full), so it is compiled out of the baseline
// build entirely — baseline behaviour is unchanged. When compiled in, it is
// additionally gated at RUNTIME by isReactiveCompactEnabled() (env
// NOA_CLAUDE_REACTIVE_COMPACT / config reactiveCompactEnabled, default false),
// so the withhold predicates return false and nothing changes until enabled.
//
// The heavy lifting reuses compactConversation(), which already carries the
// robust PTL-retry (truncateHeadForPTLRetry) and image/document stripping —
// reactive adds only the reactive-specific guards: single-shot dedup, an
// abort check, and a "too few groups → compaction can't help" bail.

import { markPostCompaction } from '../../bootstrap/state.js'
import type { QuerySource } from '../../constants/querySource.js'
import type { ToolUseContext } from '../../Tool.js'
import type { AssistantMessage, Message } from '../../types/message.js'
import { getGlobalConfig } from '../../utils/config.js'
import { logForDebugging } from '../../utils/debug.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import type { CacheSafeParams } from '../../utils/forkedAgent.js'
import { logError } from '../../utils/log.js'
import {
  isMediaSizeErrorMessage,
  isPromptTooLongMessage,
} from '../api/errors.js'
import {
  type CompactionResult,
  compactConversation,
  isCompactionUserAbort,
} from './compact.js'
import { suppressCompactWarning } from './compactWarningState.js'
import { groupMessagesByApiRound } from './grouping.js'
import { resetMicrocompactState } from './microCompact.js'
import { runPostCompactCleanup } from './postCompactCleanup.js'
import { setLastSummarizedMessageId } from '../SessionMemory/sessionMemoryUtils.js'

// Fewer API-round groups than this means there is nothing meaningful to
// summarize away — the fixed prefix (system prompt + tools + userContext) is
// the overflow, and compaction can't help. Bail rather than loop.
const MIN_GROUPS_TO_COMPACT = 2

export function isReactiveCompactEnabled(): boolean {
  if (isEnvTruthy(process.env.NOA_CLAUDE_REACTIVE_COMPACT)) return true
  if (isEnvTruthy(process.env.CLAUDE_CODE_REACTIVE_COMPACT)) return true
  return getGlobalConfig().reactiveCompactEnabled === true
}

// Reactive-only mode (routing proactive/manual compaction entirely through the
// reactive path) is a larger behaviour change; keep it off. Reactive stays the
// safety net while proactive auto-compact remains primary.
export function isReactiveOnlyMode(): boolean {
  return false
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
 * Shared post-success cleanup. compactConversation already calls
 * markPostCompaction + notifyCompaction internally; reactive adds the pieces
 * the proactive query-loop path would otherwise run.
 */
function afterReactiveSuccess(querySource?: QuerySource): void {
  setLastSummarizedMessageId(undefined)
  runPostCompactCleanup(querySource)
  suppressCompactWarning()
  resetMicrocompactState()
  markPostCompaction()
}

/**
 * Auto path (query loop). Returns a CompactionResult to retry with, or null to
 * surface the original error. Single-shot per turn (hasAttempted) so a repeated
 * failure can't spiral.
 */
export async function tryReactiveCompact(params: {
  hasAttempted: boolean
  querySource: QuerySource
  aborted: boolean
  messages: Message[]
  cacheSafeParams: CacheSafeParams
}): Promise<CompactionResult | null> {
  if (!isReactiveCompactEnabled()) return null
  const { hasAttempted, querySource, aborted, messages, cacheSafeParams } =
    params
  if (aborted || hasAttempted) return null

  // Fixed-prefix bail: nothing summarizable → compaction cannot help.
  if (groupMessagesByApiRound(messages).length < MIN_GROUPS_TO_COMPACT) {
    logForDebugging(
      '[REACTIVE] too few groups — compaction cannot help; surfacing error',
    )
    return null
  }

  const context = cacheSafeParams.toolUseContext
  try {
    logForDebugging('[REACTIVE] recovering from withheld overflow via compact')
    const result = await compactConversation(
      messages,
      context,
      cacheSafeParams,
      true, // suppress follow-up questions
      undefined, // no custom instructions on the auto path
      true, // isAutoCompact
    )
    afterReactiveSuccess(querySource)
    return result
  } catch (error) {
    // Abort is not a failure to report — the loop handles it.
    if (!isCompactionUserAbort(error, context.abortController.signal)) {
      logError(error)
    }
    return null
  }
}

export type ReactiveCompactOutcome =
  | { ok: true; result: CompactionResult }
  | {
      ok: false
      reason:
        | 'too_few_groups'
        | 'aborted'
        | 'exhausted'
        | 'media_unstrippable'
        | 'error'
    }

/**
 * Manual path (/compact under reactive-only mode). Not reached while
 * isReactiveOnlyMode() is false, but implemented for contract completeness.
 */
export async function reactiveCompactOnPromptTooLong(
  messages: Message[],
  cacheSafeParams: CacheSafeParams,
  options: {
    customInstructions: string | undefined
    trigger: 'manual' | 'auto'
  },
): Promise<ReactiveCompactOutcome> {
  const context = cacheSafeParams.toolUseContext
  if (context.abortController.signal.aborted) {
    return { ok: false, reason: 'aborted' }
  }
  if (groupMessagesByApiRound(messages).length < MIN_GROUPS_TO_COMPACT) {
    return { ok: false, reason: 'too_few_groups' }
  }
  try {
    const result = await compactConversation(
      messages,
      context,
      cacheSafeParams,
      options.trigger === 'auto', // suppress follow-ups on the auto trigger only
      options.customInstructions,
      options.trigger === 'auto',
    )
    afterReactiveSuccess(context.options.querySource)
    return { ok: true, result }
  } catch (error) {
    if (isCompactionUserAbort(error, context.abortController.signal)) {
      return { ok: false, reason: 'aborted' }
    }
    logError(error)
    return { ok: false, reason: 'error' }
  }
}

export default {
  isReactiveCompactEnabled,
  isReactiveOnlyMode,
  isWithheldPromptTooLong,
  isWithheldMediaSizeError,
  tryReactiveCompact,
  reactiveCompactOnPromptTooLong,
}
