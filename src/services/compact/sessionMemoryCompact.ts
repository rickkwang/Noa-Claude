// @ts-nocheck
/**
 * Session memory compaction
 */

import type { AgentId } from '../../types/ids.js'
import type { HookResultMessage, Message } from '../../types/message.js'
import type { ToolUseContext } from '../../Tool.js'
import { logForDebugging } from '../../utils/debug.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { errorMessage } from '../../utils/errors.js'
import { executePostCompactHooks } from '../../utils/hooks.js'
import {
  createCompactBoundaryMessage,
  createUserMessage,
  isCompactBoundaryMessage,
} from '../../utils/messages.js'
import { getMainLoopModel } from '../../utils/model/model.js'
import { getSessionMemoryPath } from '../../utils/permissions/filesystem.js'
import { processSessionStartHooks } from '../../utils/sessionStart.js'
import { getTranscriptPath } from '../../utils/sessionStorage.js'
import { tokenCountFromLastAPIResponse } from '../../utils/tokens.js'
import { extractDiscoveredToolNames } from '../../utils/toolSearch.js'
import {
  getDynamicConfig_BLOCKS_ON_INIT,
  getFeatureValue_CACHED_MAY_BE_STALE,
} from '../analytics/growthbook.js'
import { logEvent } from '../analytics/index.js'
import {
  isSessionMemoryEmpty,
  truncateSessionMemoryForCompact,
} from '../SessionMemory/prompts.js'
import {
  getLastSummarizedMessageId,
  getSessionMemoryContent,
  waitForSessionMemoryExtraction,
} from '../SessionMemory/sessionMemoryUtils.js'
import {
  annotateBoundaryWithPreservedSegment,
  buildPostCompactMessages,
  type CompactionResult,
  createPlanAttachmentIfNeeded,
  isCompactionUserAbort,
  mergeHookDisplayMessages,
} from './compact.js'
import {
  roughTokenCountEstimation,
  roughTokenCountEstimationForMessages,
} from '../tokenEstimation.js'
import { estimateMessageTokens } from './microCompact.js'
import { adjustIndexToPreserveAPIInvariants } from './preservedTail.js'
import { getCompactUserSummaryMessage } from './prompt.js'

/**
 * Estimate token count for a full post-compact message array.
 * Builds on roughTokenCountEstimationForMessages (which handles assistant,
 * user, and attachment types) and adds system + hook_result coverage that
 * the upstream function intentionally skips.
 */
function estimatePostCompactTokens(messages: Message[]): number {
  let total = roughTokenCountEstimationForMessages(messages)
  for (const message of messages) {
    if (message.type === 'system') {
      const content = (message as Record<string, unknown>).content
      if (typeof content === 'string') {
        total += roughTokenCountEstimation(content)
      }
    } else if (message.type === 'hook_result') {
      const result = (message as Record<string, unknown>).result
      total += roughTokenCountEstimation(
        typeof result === 'string' ? result : JSON.stringify(result ?? {}),
      )
    }
  }
  return total
}

/**
 * Configuration for session memory compaction thresholds
 */
export type SessionMemoryCompactConfig = {
  /** Minimum tokens to preserve after compaction */
  minTokens: number
  /** Minimum number of messages with text blocks to keep */
  minTextBlockMessages: number
  /** Maximum tokens to preserve after compaction (hard cap) */
  maxTokens: number
}

// Default configuration values (exported for use in tests)
export const DEFAULT_SM_COMPACT_CONFIG: SessionMemoryCompactConfig = {
  minTokens: 10_000,
  minTextBlockMessages: 5,
  maxTokens: 40_000,
}

// Current configuration (starts with defaults)
let smCompactConfig: SessionMemoryCompactConfig = {
  ...DEFAULT_SM_COMPACT_CONFIG,
}

// Promise-based lock to prevent concurrent initialization
let initPromise: Promise<void> | null = null

/**
 * Set the session memory compact configuration
 */
export function setSessionMemoryCompactConfig(
  config: Partial<SessionMemoryCompactConfig>,
): void {
  smCompactConfig = {
    ...smCompactConfig,
    ...config,
  }
}

/**
 * Get the current session memory compact configuration
 */
export function getSessionMemoryCompactConfig(): SessionMemoryCompactConfig {
  return { ...smCompactConfig }
}

/**
 * Reset config state (useful for testing)
 */
export function resetSessionMemoryCompactConfig(): void {
  smCompactConfig = { ...DEFAULT_SM_COMPACT_CONFIG }
  initPromise = null
}

/**
 * Initialize configuration from remote config (GrowthBook).
 * Only fetches once per session - subsequent calls return immediately.
 */
async function initSessionMemoryCompactConfig(): Promise<void> {
  if (initPromise) {
    return initPromise
  }

  initPromise = (async () => {
    try {
      // Load config from GrowthBook, merging with defaults
      const remoteConfig = await getDynamicConfig_BLOCKS_ON_INIT<
        Partial<SessionMemoryCompactConfig>
      >('tengu_sm_compact_config', {})

      // Only use remote values if they are explicitly set (positive numbers)
      // This ensures sensible defaults aren't overridden by zero values
      const config: SessionMemoryCompactConfig = {
        minTokens:
          remoteConfig.minTokens && remoteConfig.minTokens > 0
            ? remoteConfig.minTokens
            : DEFAULT_SM_COMPACT_CONFIG.minTokens,
        minTextBlockMessages:
          remoteConfig.minTextBlockMessages && remoteConfig.minTextBlockMessages > 0
            ? remoteConfig.minTextBlockMessages
            : DEFAULT_SM_COMPACT_CONFIG.minTextBlockMessages,
        maxTokens:
          remoteConfig.maxTokens && remoteConfig.maxTokens > 0
            ? remoteConfig.maxTokens
            : DEFAULT_SM_COMPACT_CONFIG.maxTokens,
      }
      setSessionMemoryCompactConfig(config)
    } catch (error) {
      // Reset initPromise so the next call can retry rather than returning
      // the permanently-rejected promise.
      initPromise = null
      throw error
    }
  })()

  return initPromise
}

/**
 * Check if a message contains text blocks (text content for user/assistant interaction)
 */
export function hasTextBlocks(message: Message): boolean {
  if (message.type === 'assistant') {
    const content = message.message.content
    return content.some(block => block.type === 'text')
  }
  if (message.type === 'user') {
    const content = message.message.content
    if (typeof content === 'string') {
      return content.length > 0
    }
    if (Array.isArray(content)) {
      return content.some(block => block.type === 'text')
    }
  }
  return false
}

/**
 * Calculate the starting index for messages to keep after compaction.
 * Starts from lastSummarizedMessageId, then expands backwards to meet minimums:
 * - At least config.minTokens tokens
 * - At least config.minTextBlockMessages messages with text blocks
 * Stops expanding if config.maxTokens is reached.
 * Also ensures tool_use/tool_result pairs are not split.
 */
export function calculateMessagesToKeepIndex(
  messages: Message[],
  lastSummarizedIndex: number,
): number {
  if (messages.length === 0) {
    return 0
  }

  const config = getSessionMemoryCompactConfig()

  // Start from the message after lastSummarizedIndex
  // If lastSummarizedIndex is -1 (not found) or messages.length (no summarized id),
  // we start with no messages kept
  let startIndex =
    lastSummarizedIndex >= 0 ? lastSummarizedIndex + 1 : messages.length

  // Calculate current tokens and text-block message count from startIndex to end
  let totalTokens = 0
  let textBlockMessageCount = 0
  for (let i = startIndex; i < messages.length; i++) {
    const msg = messages[i]!
    totalTokens += estimateMessageTokens([msg])
    if (hasTextBlocks(msg)) {
      textBlockMessageCount++
    }
  }

  // Check if we already hit the max cap
  if (totalTokens >= config.maxTokens) {
    return adjustIndexToPreserveAPIInvariants(messages, startIndex)
  }

  // Check if we already meet both minimums
  if (
    totalTokens >= config.minTokens &&
    textBlockMessageCount >= config.minTextBlockMessages
  ) {
    return adjustIndexToPreserveAPIInvariants(messages, startIndex)
  }

  // Expand backwards until we meet both minimums or hit max cap.
  // Floor at the last boundary: the preserved-segment chain has a disk
  // discontinuity there (att[0]→summary shortcut from dedup-skip), which
  // would let the loader's tail→head walk bypass inner preserved messages
  // and then prune them. Reactive compact already slices at the boundary
  // via getMessagesAfterCompactBoundary; this is the same invariant.
  const idx = messages.findLastIndex(m => isCompactBoundaryMessage(m))
  const floor = idx === -1 ? 0 : idx + 1
  for (let i = startIndex - 1; i >= floor; i--) {
    const msg = messages[i]!
    const msgTokens = estimateMessageTokens([msg])

    // Stop if adding this message would exceed the hard cap
    if (totalTokens + msgTokens > config.maxTokens) {
      break
    }

    totalTokens += msgTokens
    if (hasTextBlocks(msg)) {
      textBlockMessageCount++
    }
    startIndex = i

    // Stop if we meet both minimums
    if (
      totalTokens >= config.minTokens &&
      textBlockMessageCount >= config.minTextBlockMessages
    ) {
      break
    }
  }

  // Adjust for tool pairs
  return adjustIndexToPreserveAPIInvariants(messages, startIndex)
}

/**
 * Check if we should use session memory for compaction
 * Uses cached gate values to avoid blocking on Statsig initialization
 */
export function shouldUseSessionMemoryCompaction(): boolean {
  // Allow env var override for eval runs and testing
  if (isEnvTruthy(process.env.ENABLE_CLAUDE_CODE_SM_COMPACT)) {
    return true
  }
  if (isEnvTruthy(process.env.DISABLE_CLAUDE_CODE_SM_COMPACT)) {
    return false
  }

  const sessionMemoryFlag = getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_session_memory',
    false,
  )
  const smCompactFlag = getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_sm_compact',
    false,
  )
  const shouldUse = sessionMemoryFlag && smCompactFlag

  // Log flag states for debugging (ant-only to avoid noise in external logs)
  if (process.env.USER_TYPE === 'ant') {
    logEvent('tengu_sm_compact_flag_check', {
      tengu_session_memory: sessionMemoryFlag,
      tengu_sm_compact: smCompactFlag,
      should_use: shouldUse,
    })
  }

  return shouldUse
}

/**
 * Create a CompactionResult from session memory.
 *
 * @internal Exported only for unit tests (see sessionMemoryCompact.test.ts).
 *           Production callers should go through `trySessionMemoryCompaction`.
 */
export async function createCompactionResultFromSessionMemory(
  messages: Message[],
  sessionMemory: string,
  messagesToKeep: Message[],
  hookResults: HookResultMessage[],
  transcriptPath: string,
  trigger: 'manual' | 'auto',
  agentId?: AgentId,
): Promise<CompactionResult> {
  const preCompactTokenCount = tokenCountFromLastAPIResponse(messages)

  const boundaryMarker = createCompactBoundaryMessage(
    trigger,
    preCompactTokenCount ?? 0,
    messages[messages.length - 1]?.uuid,
  )
  const preCompactDiscovered = extractDiscoveredToolNames(messages)
  if (preCompactDiscovered.size > 0) {
    boundaryMarker.compactMetadata.preCompactDiscoveredTools = [
      ...preCompactDiscovered,
    ].sort()
  }

  // Truncate oversized sections to prevent session memory from consuming
  // the entire post-compact token budget
  const { truncatedContent, wasTruncated } =
    truncateSessionMemoryForCompact(sessionMemory)

  let summaryContent = getCompactUserSummaryMessage(
    truncatedContent,
    true,
    transcriptPath,
    true,
  )

  if (wasTruncated) {
    const memoryPath = getSessionMemoryPath()
    summaryContent += `\n\nSome session memory sections were truncated for length. The full session memory can be viewed at: ${memoryPath}`
  }

  const summaryMessages = [
    createUserMessage({
      content: summaryContent,
      isCompactSummary: true,
      isVisibleInTranscriptOnly: true,
      summarizeMetadata: {
        messagesSummarized: messages.length - messagesToKeep.length,
        rawCompactSummary: truncatedContent,
      },
    }),
  ]

  const planAttachment = await createPlanAttachmentIfNeeded(agentId)
  const attachments = planAttachment ? [planAttachment] : []

  const initialPostCompactMessages = [
    boundaryMarker,
    ...summaryMessages,
    ...messagesToKeep,
    ...attachments,
    ...hookResults,
  ]
  const initialPostCompactTokens =
    estimatePostCompactTokens(initialPostCompactMessages)

  return {
    boundaryMarker: annotateBoundaryWithPreservedSegment(
      boundaryMarker,
      summaryMessages[summaryMessages.length - 1]!.uuid,
      messagesToKeep,
    ),
    summaryMessages,
    attachments,
    hookResults,
    messagesToKeep,
    preCompactTokenCount,
    // SM-compact has no compact-API-call, so postCompactTokenCount (kept for
    // event continuity) and truePostCompactTokenCount converge to the same value.
    postCompactTokenCount: initialPostCompactTokens,
    truePostCompactTokenCount: initialPostCompactTokens,
  }
}

/**
 * Try to use session memory for compaction instead of traditional compaction.
 * Returns null if session memory compaction cannot be used.
 *
 * Handles two scenarios:
 * 1. Normal case: lastSummarizedMessageId is set, keep only messages after that ID
 * 2. Resumed session: lastSummarizedMessageId is not set but session memory has content,
 *    keep all messages but use session memory as the summary
 */
export async function trySessionMemoryCompaction(
  messages: Message[],
  {
    agentId,
    autoCompactThreshold,
    trigger = 'auto',
    context,
    preCompactUserDisplayMessage,
  }: {
    agentId?: AgentId
    autoCompactThreshold?: number
    trigger?: 'manual' | 'auto'
    context: Pick<ToolUseContext, 'abortController' | 'onCompactProgress'>
    preCompactUserDisplayMessage?: string
  },
): Promise<CompactionResult | null> {
  if (!shouldUseSessionMemoryCompaction()) {
    return null
  }

  // Initialize config from remote (only fetches once)
  await initSessionMemoryCompactConfig()

  // Wait for any in-progress session memory extraction to complete (with timeout)
  await waitForSessionMemoryExtraction()

  const lastSummarizedMessageId = getLastSummarizedMessageId()
  const sessionMemory = await getSessionMemoryContent()

  // No session memory file exists at all
  if (!sessionMemory) {
    logEvent('tengu_sm_compact_no_session_memory', {})
    return null
  }

  // Session memory exists but matches the template (no actual content extracted)
  // Fall back to legacy compact behavior
  if (await isSessionMemoryEmpty(sessionMemory)) {
    logEvent('tengu_sm_compact_empty_template', {})
    return null
  }

  let lastSummarizedIndex: number
  if (lastSummarizedMessageId) {
    // Normal case: we know exactly which messages have been summarized
    lastSummarizedIndex = messages.findIndex(
      msg => msg.uuid === lastSummarizedMessageId,
    )

    if (lastSummarizedIndex === -1) {
      // The summarized message ID doesn't exist in current messages
      // This can happen if messages were modified - fall back to legacy compact
      // since we can't determine the boundary between summarized and unsummarized messages
      logEvent('tengu_sm_compact_summarized_id_not_found', {})
      return null
    }
  } else {
    // Resumed session case: session memory has content but we don't know the boundary
    // Set lastSummarizedIndex to last message so startIndex becomes messages.length (no messages kept initially)
    lastSummarizedIndex = messages.length - 1
    logEvent('tengu_sm_compact_resumed_session', {})
  }

  let compactionResult: CompactionResult
  let postCompactTokenCount: number

  try {
    // Calculate the starting index for messages to keep
    // This starts from lastSummarizedIndex, expands to meet minimums,
    // and adjusts to not split tool_use/tool_result pairs
    const startIndex = calculateMessagesToKeepIndex(
      messages,
      lastSummarizedIndex,
    )
    // Filter out old compact boundary messages from messagesToKeep.
    // After REPL pruning, old boundaries re-yielded from messagesToKeep would
    // trigger an unwanted second prune (isCompactBoundaryMessage returns true),
    // discarding the new boundary and summary.
    const messagesToKeep = messages
      .slice(startIndex)
      .filter(m => !isCompactBoundaryMessage(m))

    context.onCompactProgress?.({
      type: 'hooks_start',
      hookType: 'session_start',
    })
    // Run session start hooks to restore CLAUDE.md and other context
    const hookResults = await processSessionStartHooks('compact', {
      model: getMainLoopModel(),
    })

    // Get transcript path for the summary message
    const transcriptPath = getTranscriptPath()

    compactionResult = await createCompactionResultFromSessionMemory(
      messages,
      sessionMemory,
      messagesToKeep,
      hookResults,
      transcriptPath,
      trigger,
      agentId,
    )

    const postCompactMessages = buildPostCompactMessages(compactionResult)

    postCompactTokenCount = estimatePostCompactTokens(postCompactMessages)

    // Only check threshold if one was provided (for autocompact)
    if (
      autoCompactThreshold !== undefined &&
      postCompactTokenCount >= autoCompactThreshold
    ) {
      logEvent('tengu_sm_compact_threshold_exceeded', {
        postCompactTokenCount,
        autoCompactThreshold,
      })
      return null
    }

  } catch (error) {
    if (isCompactionUserAbort(error, context.abortController.signal)) {
      throw error
    }
    // Use logEvent instead of logError since errors here are expected
    // (e.g., file not found, path issues) and shouldn't go to error logs
    logEvent('tengu_sm_compact_error', {})
    if (process.env.USER_TYPE === 'ant') {
      logForDebugging(`Session memory compaction error: ${errorMessage(error)}`)
    }
    return null
  }

  context.onCompactProgress?.({
    type: 'hooks_start',
    hookType: 'post_compact',
  })
  const postCompactHookResult = await executePostCompactHooks(
    {
      trigger,
      compactSummary:
        compactionResult.summaryMessages[0]?.summarizeMetadata
          ?.rawCompactSummary ?? sessionMemory,
    },
    context.abortController.signal,
  )

  return {
    ...compactionResult,
    postCompactTokenCount,
    truePostCompactTokenCount: postCompactTokenCount,
    userDisplayMessage: mergeHookDisplayMessages(
      preCompactUserDisplayMessage,
      postCompactHookResult.userDisplayMessage,
    ),
  }
}
