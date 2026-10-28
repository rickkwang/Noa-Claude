// @ts-nocheck
import { FILE_EDIT_TOOL_NAME } from 'src/tools/FileEditTool/constants.js'
import { MULTI_EDIT_TOOL_NAME } from 'src/tools/MultiEditTool/constants.js'
import { FILE_READ_TOOL_NAME } from 'src/tools/FileReadTool/prompt.js'
import { FILE_WRITE_TOOL_NAME } from 'src/tools/FileWriteTool/prompt.js'
import { GLOB_TOOL_NAME } from 'src/tools/GlobTool/prompt.js'
import { GREP_TOOL_NAME } from 'src/tools/GrepTool/prompt.js'
import { NOTEBOOK_EDIT_TOOL_NAME } from 'src/tools/NotebookEditTool/constants.js'
import { WEB_FETCH_TOOL_NAME } from 'src/tools/WebFetchTool/prompt.js'
import { WEB_SEARCH_TOOL_NAME } from 'src/tools/WebSearchTool/prompt.js'
import { SHELL_TOOL_NAMES } from 'src/utils/shell/shellToolUtils.js'
import type { Message } from '../../types/message.js'
import { getGlobalConfig } from '../../utils/config.js'
import { logForDebugging } from '../../utils/debug.js'
import { isEnvTruthy } from '../../utils/envUtils.js'

// docs: https://docs.google.com/document/d/1oCT4evvWTh3P6z-kcfNQwWTCxAhkoFndSaNS9Gm40uw/edit?tab=t.0

// Default values for context management strategies
// Match client-side microcompact token values
const DEFAULT_MAX_INPUT_TOKENS = 180_000 // Typical warning threshold
const DEFAULT_TARGET_INPUT_TOKENS = 40_000 // Keep last 40k tokens like client-side

const TOOLS_CLEARABLE_RESULTS = [
  ...SHELL_TOOL_NAMES,
  GLOB_TOOL_NAME,
  GREP_TOOL_NAME,
  FILE_READ_TOOL_NAME,
  WEB_FETCH_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME,
]

const TOOLS_CLEARABLE_USES = [
  FILE_EDIT_TOOL_NAME,
  MULTI_EDIT_TOOL_NAME,
  FILE_WRITE_TOOL_NAME,
  NOTEBOOK_EDIT_TOOL_NAME,
]

function parsePositiveIntegerEnv(
  value: string | undefined,
  fallback: number,
): number {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function getToolClearThresholds(): {
  triggerThreshold: number
  clearAtLeast: number
} {
  const triggerThreshold = parsePositiveIntegerEnv(
    process.env.API_MAX_INPUT_TOKENS,
    DEFAULT_MAX_INPUT_TOKENS,
  )
  const keepTarget = parsePositiveIntegerEnv(
    process.env.API_TARGET_INPUT_TOKENS,
    DEFAULT_TARGET_INPUT_TOKENS,
  )

  return {
    triggerThreshold,
    clearAtLeast: Math.max(1, triggerThreshold - keepTarget),
  }
}

// Context management strategy types matching API documentation
export type ContextEditStrategy =
  | {
      type: 'clear_tool_uses_20250919'
      trigger?: {
        type: 'input_tokens' | 'tool_uses'
        value: number
      }
      keep?: {
        type: 'tool_uses'
        value: number
      }
      clear_tool_inputs?: boolean | string[]
      exclude_tools?: string[]
      clear_at_least?: {
        type: 'input_tokens'
        value: number
      }
    }
  | {
      type: 'clear_thinking_20251015'
      keep: { type: 'thinking_turns'; value: number } | 'all'
    }

// Context management configuration wrapper
export type ContextManagementConfig = {
  edits: ContextEditStrategy[]
}

// Upstream's idle clear: after this long without an assistant message the
// server cache is cold anyway, so old tool results can go. Keeps a larger tail
// than the client-side paths because the server applies it per request.
const IDLE_MIN_SECONDS = 3900
const IDLE_KEEP_TOOL_USES = 12
const IDLE_CLEAR_AT_LEAST_TOKENS = 20_000
const IDLE_TRIGGER_TOOL_USES_BELOW_COUNT = 3
const IDLE_MIN_TRIGGER_TOOL_USES = IDLE_KEEP_TOOL_USES + 15
// Upstream caps its tool-name sets at 64; a longer exclude list only bloats
// every request.
const IDLE_MAX_EXCLUDE_TOOLS = 64

const CLEARED_RESULT_MARKERS = [
  '[Old tool result content cleared]',
  '<persisted-output>',
]

const CLEARABLE_TOOL_NAMES = new Set([
  ...TOOLS_CLEARABLE_RESULTS,
  ...TOOLS_CLEARABLE_USES,
])

function isClearableToolName(name: string): boolean {
  return CLEARABLE_TOOL_NAMES.has(name) || name.startsWith('mcp__')
}

export type IdleCompactionMode = 'on' | 'shadow' | 'off' | 'unknown'

/**
 * Upstream reads the mode from a server-side rollout flag (on/shadow/off, with
 * "unknown" when absent). Noa has no rollout channel, so the setting is the
 * switch: true is on, false is off, unset is unknown — unknown keeps working
 * only when an earlier request already had results cleared, which is what
 * upstream does when its flag is missing.
 */
export function getIdleCompactionMode(): IdleCompactionMode {
  const raw =
    process.env.NOA_CLAUDE_IDLE_COMPACTION ??
    process.env.CLAUDE_CODE_IDLE_COMPACTION
  if (raw !== undefined && raw.trim() !== '') {
    const value = raw.trim().toLowerCase()
    if (value === 'shadow') return 'shadow'
    if (value === 'off' || value === 'false' || value === '0' || value === 'no')
      return 'off'
    if (value === 'on' || value === 'true' || value === '1' || value === 'yes')
      return 'on'
    return 'unknown'
  }
  // Runs on every request; a config read failure must not fail the request.
  try {
    const setting = getGlobalConfig().idleCompaction
    if (setting === true) return 'on'
    if (setting === false) return 'off'
    return 'unknown'
  } catch {
    return 'off'
  }
}

/** Did an earlier response report the server actually clearing tool uses? */
function hadAppliedToolClearing(messages: readonly Message[]): boolean {
  for (const message of messages) {
    if (message.type !== 'assistant') continue
    const edits = (
      message.message as {
        context_management?: {
          applied_edits?: Array<{
            type?: string
            cleared_tool_uses?: number
          }>
        }
      }
    ).context_management?.applied_edits
    if (
      edits?.some(
        edit =>
          edit?.type === 'clear_tool_uses_20250919' &&
          (edit.cleared_tool_uses ?? 0) > 0,
      )
    ) {
      return true
    }
  }
  return false
}

/**
 * Timestamp of the assistant message that started an idle window, or undefined
 * when there is none. Mirrors upstream: a gap longer than the idle threshold
 * after an assistant message anywhere in the transcript, or since the last one.
 */
function idleWindowStart(
  messages: readonly Message[],
  now: number,
): number | undefined {
  const idleMs = IDLE_MIN_SECONDS * 1000
  let lastAssistantAt: number | undefined
  let idleStart: number | undefined
  for (const message of messages) {
    // Meta/virtual rows are not part of the replayable conversation and would
    // otherwise manufacture gaps.
    if (message.isMeta || message.isVirtual || message.isVisibleInTranscriptOnly)
      continue
    const timestamp = Date.parse(message.timestamp)
    if (!Number.isFinite(timestamp)) continue
    if (
      idleStart === undefined &&
      lastAssistantAt !== undefined &&
      timestamp - lastAssistantAt > idleMs
    ) {
      idleStart = lastAssistantAt
    }
    if (message.type === 'assistant') {
      lastAssistantAt = timestamp
    }
  }
  if (idleStart !== undefined) return idleStart
  if (lastAssistantAt !== undefined && now - lastAssistantAt > idleMs) {
    return lastAssistantAt
  }
  return undefined
}

function startsWithClearedMarker(text: string): boolean {
  return CLEARED_RESULT_MARKERS.some(marker => text.startsWith(marker))
}

// Upstream matches the marker at the start of the content (after any pointer
// wrapper); a result that merely quotes the marker is still clearable.
function hasAlreadyClearedContent(content: unknown): boolean {
  if (typeof content === 'string') {
    return startsWithClearedMarker(content)
  }
  if (!Array.isArray(content)) return false
  return content.some(
    block =>
      block &&
      typeof block === 'object' &&
      'text' in block &&
      typeof (block as { text?: unknown }).text === 'string' &&
      startsWithClearedMarker((block as { text: string }).text),
  )
}

function hasMediaContent(content: unknown): boolean {
  if (!Array.isArray(content)) return false
  return content.some(
    block =>
      block &&
      typeof block === 'object' &&
      'type' in block &&
      ((block as { type?: unknown }).type === 'image' ||
        (block as { type?: unknown }).type === 'document'),
  )
}

/**
 * Build the server-side idle clear, or undefined when the conversation is not
 * idle, has too few tool uses to be worth a rewrite, or the feature is off.
 * Mirrors upstream's idle plan: trigger on tool-use count, keep the last
 * IDLE_KEEP_TOOL_USES, and demand IDLE_CLEAR_AT_LEAST_TOKENS of relief.
 */
export function getIdleToolClearingStrategy(
  messages: readonly Message[],
  now: number = Date.now(),
  mode: IdleCompactionMode = getIdleCompactionMode(),
): ContextEditStrategy | undefined {
  if (mode === 'off') return undefined
  // Upstream's "unknown" (no rollout value): keep going only when the server
  // has already cleared results in this conversation.
  if (mode === 'unknown' && !hadAppliedToolClearing(messages)) return undefined

  const idleStartedAt = idleWindowStart(messages, now)
  if (idleStartedAt === undefined) return undefined

  const toolUseNames = new Map<string, string>()
  const excludeTools = new Set<string>()
  const countedToolUses = new Set<string>()

  for (const message of messages) {
    if (message.type === 'assistant' && Array.isArray(message.message.content)) {
      for (const block of message.message.content) {
        if (block.type !== 'tool_use') continue
        const name = typeof block.name === 'string' ? block.name : ''
        if (!name) continue
        if (isClearableToolName(name)) {
          toolUseNames.set(block.id, name)
        } else if (
          excludeTools.size < IDLE_MAX_EXCLUDE_TOOLS &&
          /^[A-Za-z0-9_-]{1,128}$/.test(name)
        ) {
          // Anything the clear cannot reason about stays untouched.
          excludeTools.add(name)
        }
      }
      continue
    }
    if (message.type !== 'user' || !Array.isArray(message.message.content)) {
      continue
    }
    for (const block of message.message.content) {
      if (block.type !== 'tool_result') continue
      const name = toolUseNames.get(block.tool_use_id)
      if (name === undefined) continue
      if (hasAlreadyClearedContent(block.content)) {
        excludeTools.add(name)
        continue
      }
      if (hasMediaContent(block.content)) {
        excludeTools.add(name)
        continue
      }
      countedToolUses.add(block.tool_use_id)
    }
  }

  const triggerToolUses =
    countedToolUses.size - IDLE_TRIGGER_TOOL_USES_BELOW_COUNT
  if (
    triggerToolUses <= IDLE_KEEP_TOOL_USES ||
    triggerToolUses < IDLE_MIN_TRIGGER_TOOL_USES
  ) {
    return undefined
  }

  return {
    type: 'clear_tool_uses_20250919',
    trigger: { type: 'tool_uses', value: triggerToolUses },
    keep: { type: 'tool_uses', value: IDLE_KEEP_TOOL_USES },
    clear_at_least: {
      type: 'input_tokens',
      value: IDLE_CLEAR_AT_LEAST_TOKENS,
    },
    exclude_tools: [...excludeTools].sort(),
  }
}

// API-based microcompact implementation that uses native context management
export function getAPIContextManagement(options?: {
  hasThinking?: boolean
  isRedactThinkingActive?: boolean
  clearAllThinking?: boolean
  messages?: readonly Message[]
  querySource?: string
  isSubagent?: boolean
  now?: number
}): ContextManagementConfig | undefined {
  const {
    hasThinking = false,
    isRedactThinkingActive = false,
    clearAllThinking = false,
    messages,
    querySource,
    isSubagent = false,
    now,
  } = options ?? {}

  const strategies: ContextEditStrategy[] = []

  // Preserve thinking blocks in previous assistant turns. Skip when
  // redact-thinking is active — redacted blocks have no model-visible content.
  // clearAllThinking is a caller-controlled escape hatch; the default path
  // keeps all thinking turns to avoid degrading continuity.
  if (hasThinking && !isRedactThinkingActive) {
    strategies.push({
      type: 'clear_thinking_20251015',
      keep: clearAllThinking ? { type: 'thinking_turns', value: 1 } : 'all',
    })
  }

  const useClearToolResults =
    process.env.USER_TYPE === 'ant' &&
    isEnvTruthy(process.env.USE_API_CLEAR_TOOL_RESULTS)
  const useClearToolUses =
    process.env.USER_TYPE === 'ant' &&
    isEnvTruthy(process.env.USE_API_CLEAR_TOOL_USES)
  // Idle clearing is the successor to those env-gated strategies. An explicit
  // ant opt-in wins; sending both would put two clear_tool_uses edits in one
  // request.
  const antToolClearing = useClearToolResults || useClearToolUses

  // Idle clearing: after a long pause the cache is cold, so old tool results
  // are worth shedding even without context pressure. Main conversation only —
  // subagents and side queries have their own short-lived transcripts.
  if (
    !antToolClearing &&
    messages !== undefined &&
    !isSubagent &&
    (querySource?.startsWith('repl_main_thread') || querySource === 'sdk')
  ) {
    const mode = getIdleCompactionMode()
    const idleStrategy = getIdleToolClearingStrategy(messages, now, mode)
    if (idleStrategy) {
      const triggerValue = idleStrategy.trigger?.value ?? 0
      if (mode === 'shadow') {
        logForDebugging(
          `[IDLE MC] shadow: would clear tool results (trigger ${triggerValue} tool uses)`,
        )
      } else {
        logForDebugging(
          `[IDLE MC] clearing old tool results (trigger ${triggerValue} tool uses, keep ${IDLE_KEEP_TOOL_USES})`,
        )
        strategies.push(idleStrategy)
      }
    }
  }

  // Tool clearing strategies are ant-only
  if (process.env.USER_TYPE !== 'ant') {
    return strategies.length > 0 ? { edits: strategies } : undefined
  }

  // If no tool clearing strategy is enabled, return early
  if (!useClearToolResults && !useClearToolUses) {
    return strategies.length > 0 ? { edits: strategies } : undefined
  }

  if (useClearToolResults) {
    const { triggerThreshold, clearAtLeast } = getToolClearThresholds()

    const strategy: ContextEditStrategy = {
      type: 'clear_tool_uses_20250919',
      trigger: {
        type: 'input_tokens',
        value: triggerThreshold,
      },
      clear_at_least: {
        type: 'input_tokens',
        value: clearAtLeast,
      },
      clear_tool_inputs: TOOLS_CLEARABLE_RESULTS,
    }

    strategies.push(strategy)
  }

  if (useClearToolUses) {
    const { triggerThreshold, clearAtLeast } = getToolClearThresholds()

    const strategy: ContextEditStrategy = {
      type: 'clear_tool_uses_20250919',
      trigger: {
        type: 'input_tokens',
        value: triggerThreshold,
      },
      clear_at_least: {
        type: 'input_tokens',
        value: clearAtLeast,
      },
      exclude_tools: TOOLS_CLEARABLE_USES,
    }

    strategies.push(strategy)
  }

  return strategies.length > 0 ? { edits: strategies } : undefined
}
