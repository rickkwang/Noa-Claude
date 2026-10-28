// @ts-nocheck
import { feature } from 'bun:bundle'
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import type { QuerySource } from '../../constants/querySource.js'
import type { ToolUseContext } from '../../Tool.js'
import { FILE_EDIT_TOOL_NAME } from '../../tools/FileEditTool/constants.js'
import { MULTI_EDIT_TOOL_NAME } from '../../tools/MultiEditTool/constants.js'
import { FILE_READ_TOOL_NAME } from '../../tools/FileReadTool/prompt.js'
import { FILE_WRITE_TOOL_NAME } from '../../tools/FileWriteTool/prompt.js'
import { GLOB_TOOL_NAME } from '../../tools/GlobTool/prompt.js'
import { GREP_TOOL_NAME } from '../../tools/GrepTool/prompt.js'
import { WEB_FETCH_TOOL_NAME } from '../../tools/WebFetchTool/prompt.js'
import { WEB_SEARCH_TOOL_NAME } from '../../tools/WebSearchTool/prompt.js'
import type { Message } from '../../types/message.js'
import { modelEnforcesThinkingPrefixBinding } from '../../utils/betas.js'
import { logForDebugging } from '../../utils/debug.js'
import { getMainLoopModel } from '../../utils/model/model.js'
import { SHELL_TOOL_NAMES } from '../../utils/shell/shellToolUtils.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { logEvent } from '../analytics/index.js'
import { notifyCacheDeletion } from '../api/promptCacheBreakDetection.js'
import { roughTokenCountEstimation } from '../tokenEstimation.js'
import {
  clearCompactWarningSuppression,
  suppressCompactWarning,
} from './compactWarningState.js'
import {
  getTimeBasedMCConfig,
  type TimeBasedMCConfig,
} from './timeBasedMCConfig.js'
import {
  getSizeBasedMCConfig,
  shouldSizeTrigger,
} from './sizeBasedMCConfig.js'

// Inline from utils/toolResultStorage.ts — importing that file pulls in
// sessionStorage → utils/messages → services/api/errors, completing a
// circular-deps loop back through this file via promptCacheBreakDetection.
// Drift is caught by a test asserting equality with the source-of-truth.
export const TIME_BASED_MC_CLEARED_MESSAGE = '[Old tool result content cleared]'
export const MC_CLEARED_INPUT_MESSAGE =
  '[Old tool input content cleared; re-read the file if needed]'
// Same inline-for-circular-deps reason, same drift test.
export const MC_PERSISTED_OUTPUT_TAG = '<persisted-output>'

/**
 * Pointers to content microcompact wrote to disk, ready to substitute for the
 * content itself. `results` is keyed by tool_use_id, `inputs` by
 * `${tool_use_id}:${field}`. Produced async, consumed by the sync rewrite.
 */
export type MCPersistedPointers = {
  results: ReadonlyMap<string, string>
  inputs: ReadonlyMap<string, string>
}

// Only clear an input string field when it's at least this long. Small
// fields (paths, short edits) save nothing and are often load-bearing.
const MIN_CLEARABLE_INPUT_CHARS = 1_000

// Tools whose inputs duplicate file content that lives on disk (recoverable
// via Read). Other tools' inputs (Bash commands, search patterns) are small
// and describe intent, so they stay.
const INPUT_CLEARABLE_TOOLS = new Set<string>([
  FILE_WRITE_TOOL_NAME,
  FILE_EDIT_TOOL_NAME,
])

const IMAGE_MAX_TOKEN_SIZE = 2000

// Only compact these tools
const COMPACTABLE_TOOLS = new Set<string>([
  FILE_READ_TOOL_NAME,
  ...SHELL_TOOL_NAMES,
  GREP_TOOL_NAME,
  GLOB_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME,
  WEB_FETCH_TOOL_NAME,
  FILE_EDIT_TOOL_NAME,
  MULTI_EDIT_TOOL_NAME,
  FILE_WRITE_TOOL_NAME,
])

/**
 * Check if a tool is compactable.
 * Built-in tools are listed in COMPACTABLE_TOOLS.
 * MCP tools follow the pattern mcp__serverName__toolName and are always compactable.
 */
function isCompactableTool(toolName: string): boolean {
  if (COMPACTABLE_TOOLS.has(toolName)) return true
  // MCP tools format: mcp__serverName__toolName
  if (toolName.startsWith('mcp__')) return true
  return false
}

let toolResultStorageModule:
  | typeof import('../../utils/toolResultStorage.js')
  | null = null

// Dynamic import for the circular-deps reason noted on the inlined constants
// above: a static import of toolResultStorage loops back into this file.
async function getToolResultStorageModule(): Promise<
  typeof import('../../utils/toolResultStorage.js')
> {
  if (!toolResultStorageModule) {
    toolResultStorageModule = await import('../../utils/toolResultStorage.js')
  }
  return toolResultStorageModule
}

// Helper to calculate tool result tokens
function calculateToolResultTokens(block: ToolResultBlockParam): number {
  if (!block.content) {
    return 0
  }

  if (typeof block.content === 'string') {
    return roughTokenCountEstimation(block.content)
  }

  // Array of TextBlockParam | ImageBlockParam | DocumentBlockParam
  return block.content.reduce((sum, item) => {
    if (item.type === 'text') {
      return sum + roughTokenCountEstimation(item.text)
    } else if (item.type === 'image' || item.type === 'document') {
      // Images/documents are approximately 2000 tokens regardless of format
      return sum + IMAGE_MAX_TOKEN_SIZE
    }
    return sum
  }, 0)
}

/**
 * Estimate token count for messages by extracting text content
 * Used for rough token estimation when we don't have accurate API counts
 * Pads estimate by 4/3 to be conservative since we're approximating
 */
export function estimateMessageTokens(messages: Message[]): number {
  let totalTokens = 0

  for (const message of messages) {
    if (message.type !== 'user' && message.type !== 'assistant') {
      continue
    }

    if (typeof message.message.content === 'string') {
      totalTokens += roughTokenCountEstimation(message.message.content)
      continue
    }
    if (!Array.isArray(message.message.content)) {
      continue
    }

    for (const block of message.message.content) {
      if (block.type === 'text') {
        totalTokens += roughTokenCountEstimation(block.text)
      } else if (block.type === 'tool_result') {
        totalTokens += calculateToolResultTokens(block)
      } else if (block.type === 'image' || block.type === 'document') {
        totalTokens += IMAGE_MAX_TOKEN_SIZE
      } else if (block.type === 'thinking') {
        // Match roughTokenCountEstimationForBlock: count only the thinking
        // text, not the JSON wrapper or signature (signature is metadata,
        // not model-tokenized content).
        totalTokens += roughTokenCountEstimation(block.thinking)
      } else if (block.type === 'redacted_thinking') {
        totalTokens += roughTokenCountEstimation(block.data)
      } else if (block.type === 'tool_use') {
        // Match roughTokenCountEstimationForBlock: count name + input,
        // not the JSON wrapper or id field.
        totalTokens += roughTokenCountEstimation(
          block.name +
            jsonStringify(
              ('originalInput' in block ? block.originalInput : block.input) ?? {},
            ),
        )
      } else {
        // server_tool_use, web_search_tool_result, etc.
        totalTokens += roughTokenCountEstimation(jsonStringify(block))
      }
    }
  }

  // Pad estimate by 4/3 to be conservative since we're approximating
  return Math.ceil(totalTokens * (4 / 3))
}

export type MicrocompactResult = {
  messages: Message[]
}

/**
 * Walk messages and collect tool_use IDs whose tool name is compactable,
 * in encounter order. Shared by both microcompact paths.
 */
function collectCompactableToolIds(messages: Message[]): string[] {
  const ids: string[] = []
  for (const message of messages) {
    if (
      message.type === 'assistant' &&
      Array.isArray(message.message.content)
    ) {
      for (const block of message.message.content) {
        if (block.type === 'tool_use' && isCompactableTool(block.name)) {
          ids.push(block.id)
        }
      }
    }
  }
  return ids
}

// Prefix-match because promptCategory.ts sets the querySource to
// 'repl_main_thread:outputStyle:<style>' when a non-default output style
// is active. The bare 'repl_main_thread' is only used for the default style,
// so an equality check would silently exclude non-default output styles.
function isMainThreadSource(querySource: QuerySource | undefined): boolean {
  return !querySource || querySource.startsWith('repl_main_thread')
}

export async function microcompactMessages(
  messages: Message[],
  toolUseContext?: ToolUseContext,
  querySource?: QuerySource,
): Promise<MicrocompactResult> {
  // Clear suppression flag at start of new microcompact attempt
  clearCompactWarningSuppression()

  // Time-based trigger runs first and short-circuits. If the gap since the
  // last assistant message exceeds the threshold, the server cache has expired
  // and the full prefix will be rewritten regardless — so content-clear old
  // tool results now, before the request, to shrink what gets rewritten.
  const timeBasedResult = await maybeTimeBasedMicrocompact(
    messages,
    querySource,
  )
  if (timeBasedResult) {
    return timeBasedResult
  }

  // Size-based fallback (provider-neutral, client-side). An active session that
  // never pauses gets no time-based relief, so without this it grows straight
  // into the blocking full compact. Clear old tool results once the context
  // crosses a fraction of the window, below the autocompact threshold.
  const sizeBasedResult = await maybeSizeBasedMicrocompact(
    messages,
    querySource,
    toolUseContext,
  )
  if (sizeBasedResult) {
    return sizeBasedResult
  }

  // Otherwise no compaction happens here; autocompact handles context pressure.
  return { messages }
}

/**
 * Check whether the time-based trigger should fire for this request.
 *
 * Returns the measured gap (minutes since last assistant message) when the
 * trigger fires, or null when it doesn't (disabled, wrong source, under
 * threshold, no prior assistant, unparseable timestamp).
 *
 * Extracted so other pre-request paths (e.g. snip force-apply) can consult
 * the same predicate without coupling to the tool-result clearing action.
 */
export function evaluateTimeBasedTrigger(
  messages: Message[],
  querySource: QuerySource | undefined,
): { gapMinutes: number; config: TimeBasedMCConfig } | null {
  const config = getTimeBasedMCConfig()
  // Require an explicit main-thread querySource. isMainThreadSource treats
  // undefined as main-thread, but several callers (/context, /compact,
  // analyzeContext) invoke microcompactMessages without a source for
  // analysis-only purposes — they should not trigger.
  if (!config.enabled || !querySource || !isMainThreadSource(querySource)) {
    return null
  }
  const lastAssistant = messages.findLast(m => m.type === 'assistant')
  if (!lastAssistant) {
    return null
  }
  const gapMinutes =
    (Date.now() - new Date(lastAssistant.timestamp).getTime()) / 60_000
  if (!Number.isFinite(gapMinutes) || gapMinutes < config.gapThresholdMinutes) {
    return null
  }
  return { gapMinutes, config }
}

/**
 * Split compactable ids into the tail we keep and the prefix we clear.
 * Shared so the persistence pass and the rewrite agree on the same set.
 */
function computeClearSet(
  compactableIds: string[],
  keepRecent: number,
): { clearSet: Set<string>; keepSet: Set<string> } {
  // Floor at 1: slice(-0) returns the full array (paradoxically keeps
  // everything), and clearing ALL results leaves the model with zero working
  // context. Neither degenerate is sensible — always keep at least the last.
  const keep = Math.max(1, keepRecent)
  const keepSet = new Set(compactableIds.slice(-keep))
  return {
    keepSet,
    clearSet: new Set(compactableIds.filter(id => !keepSet.has(id))),
  }
}

/**
 * Already-cleared content, in either form: the bare marker or a persisted
 * pointer. Both must count as cleared so a repeat fire is idempotent — it must
 * not re-persist, re-count tokens, or replace a pointer with the bare marker.
 */
function isAlreadyClearedValue(value: unknown, bareMarker: string): boolean {
  return (
    value === bareMarker ||
    (typeof value === 'string' && value.startsWith(MC_PERSISTED_OUTPUT_TAG))
  )
}

/** The pointer that stands in for content now living at `filepath`. */
function buildPersistedPointer(
  storage: typeof import('../../utils/toolResultStorage.js'),
  label: string,
  filepath: string,
): string {
  return `${storage.PERSISTED_OUTPUT_TAG}${label} saved to: ${filepath}\n\nUse ${FILE_READ_TOOL_NAME} to view${storage.PERSISTED_OUTPUT_CLOSING_TAG}`
}

/**
 * Write to-be-cleared content to disk and return the pointers that replace it.
 *
 * `results` is keyed by tool_use_id; `inputs` by `${tool_use_id}:${field}`,
 * since one tool_use can have several clearable fields (Edit's old_string and
 * new_string). Keys absent from a map fall back to the bare marker, which is
 * why every failure path here is a silent skip: losing the file is a smaller
 * regression than skipping the clear entirely.
 *
 * Deliberately no preview — a preview would defeat the point of clearing. The
 * path plus a Read hint is enough for the model to recover the content.
 */
async function persistClearedContent(
  messages: Message[],
  clearSet: Set<string>,
): Promise<MCPersistedPointers> {
  const results = new Map<string, string>()
  const inputs = new Map<string, string>()
  if (clearSet.size === 0) return { results, inputs }

  let storage: typeof import('../../utils/toolResultStorage.js')
  try {
    storage = await getToolResultStorageModule()
  } catch {
    return { results, inputs }
  }

  for (const message of messages) {
    if (message.type === 'assistant' && Array.isArray(message.message.content)) {
      for (const block of message.message.content) {
        if (
          block.type !== 'tool_use' ||
          !clearSet.has(block.id) ||
          !INPUT_CLEARABLE_TOOLS.has(block.name) ||
          'originalInput' in block ||
          !block.input ||
          typeof block.input !== 'object'
        ) {
          continue
        }
        for (const [key, value] of Object.entries(block.input)) {
          if (
            typeof value !== 'string' ||
            value.length < MIN_CLEARABLE_INPUT_CHARS ||
            isAlreadyClearedValue(value, MC_CLEARED_INPUT_MESSAGE) ||
            // The field name becomes part of the filename; anything but a
            // plain identifier could escape the tool-results directory.
            !/^\w+$/.test(key)
          ) {
            continue
          }
          const result = await storage
            .persistToolResult(value, `${block.id}.input.${key}`)
            .catch(() => null)
          if (!result || storage.isPersistError(result)) {
            continue
          }
          inputs.set(
            `${block.id}:${key}`,
            buildPersistedPointer(storage, 'Tool input', result.filepath),
          )
        }
      }
      continue
    }
    if (message.type !== 'user' || !Array.isArray(message.message.content)) {
      continue
    }
    for (const block of message.message.content) {
      if (
        block.type !== 'tool_result' ||
        !clearSet.has(block.tool_use_id) ||
        results.has(block.tool_use_id) ||
        !block.content ||
        isAlreadyClearedValue(block.content, TIME_BASED_MC_CLEARED_MESSAGE)
      ) {
        continue
      }
      // persistToolResult rejects non-text blocks (images, documents) on its
      // own, so those land in the catch-all skip below.
      const result = await storage
        .persistToolResult(block.content, block.tool_use_id)
        .catch(() => null)
      if (!result || storage.isPersistError(result)) {
        continue
      }
      results.set(
        block.tool_use_id,
        buildPersistedPointer(storage, 'Tool result', result.filepath),
      )
    }
  }

  return { results, inputs }
}

// Upstream requires at least this much relief before a keep-recent clear
// rewrites the prefix (a rewrite costs a cache miss); below it, clearing frees
// too little to be worth it.
const MIN_MICROCOMPACT_SAVED_TOKENS = 20_000

/** Gross tokens a clearSet rewrite would free, before persistence. */
function estimateClearSavings(
  messages: Message[],
  clearSet: ReadonlySet<string>,
): number {
  let tokens = 0
  for (const message of messages) {
    if (
      message.type === 'assistant' &&
      Array.isArray(message.message.content)
    ) {
      for (const block of message.message.content) {
        if (
          block.type !== 'tool_use' ||
          !clearSet.has(block.id) ||
          !INPUT_CLEARABLE_TOOLS.has(block.name) ||
          'originalInput' in block
        ) {
          continue
        }
        const input = block.input
        if (!input || typeof input !== 'object') continue
        for (const value of Object.values(input)) {
          if (
            typeof value === 'string' &&
            value.length >= MIN_CLEARABLE_INPUT_CHARS &&
            !isAlreadyClearedValue(value, MC_CLEARED_INPUT_MESSAGE)
          ) {
            tokens += roughTokenCountEstimation(value)
          }
        }
      }
      continue
    }
    if (message.type !== 'user' || !Array.isArray(message.message.content)) {
      continue
    }
    for (const block of message.message.content) {
      if (
        block.type === 'tool_result' &&
        clearSet.has(block.tool_use_id) &&
        !isAlreadyClearedValue(block.content, TIME_BASED_MC_CLEARED_MESSAGE)
      ) {
        tokens += calculateToolResultTokens(block)
      }
    }
  }
  return tokens
}

/**
 * clearOldToolResults with the cleared content persisted to disk first, so the
 * model can Read back what it lost instead of only seeing a "cleared" marker.
 */
async function clearOldToolResultsWithPersistence(
  messages: Message[],
  keepRecent: number,
  precomputedIds?: string[],
): Promise<ReturnType<typeof clearOldToolResults>> {
  const compactableIds = precomputedIds ?? collectCompactableToolIds(messages)
  const { clearSet } = computeClearSet(compactableIds, keepRecent)
  if (clearSet.size === 0) return null
  // Checked before persisting: a sub-threshold clear would otherwise write
  // files to disk for a rewrite that gets discarded.
  if (estimateClearSavings(messages, clearSet) < MIN_MICROCOMPACT_SAVED_TOKENS) {
    return null
  }
  const pointers = await persistClearedContent(messages, clearSet)
  return clearOldToolResults(messages, keepRecent, compactableIds, pointers)
}

/**
 * Pure transform shared by both microcompact triggers: content-clear every
 * compactable tool result except the last `keepRecent`. Returns null when
 * nothing is actually cleared (no clearable results, or all already cleared).
 *
 * For Write/Edit tool_uses in the cleared set, also clears their large input
 * strings (Write `content`, Edit `old_string`/`new_string`). Those inputs
 * duplicate file content that lives on disk, and they routinely dwarf the
 * tool result ("File written successfully") — clearing only the result would
 * leave the bulk of a write-heavy session's tokens untouched.
 *
 * Both results and inputs are replaced by `pointers` when the caller persisted
 * them, and by the bare marker otherwise.
 *
 * Provider-neutral — it only rewrites local message content, so it works on
 * any model/provider without API betas.
 */
export function clearOldToolResults(
  messages: Message[],
  keepRecent: number,
  precomputedIds?: string[],
  pointers?: MCPersistedPointers,
): {
  messages: Message[]
  tokensSaved: number
  cleared: number
  kept: number
} | null {
  // Callers that already collected the ids (e.g. the size-based pre-gate) pass
  // them in to avoid a second traversal; everyone else computes them here.
  const compactableIds = precomputedIds ?? collectCompactableToolIds(messages)
  const { clearSet, keepSet } = computeClearSet(compactableIds, keepRecent)

  if (clearSet.size === 0) {
    return null
  }

  let tokensSaved = 0
  // Count only results cleared on THIS pass. clearSet may include ids already
  // cleared on a prior turn (the conversation keeps growing, so older ids stay
  // outside keepSet); reporting clearSet.size would over-count on repeat fires.
  let clearedNow = 0
  let inputsCleared = 0

  // A persisted pointer carries a real path, so for small content it costs
  // more than the content it replaces. Fall back to the bare marker whenever
  // it isn't actually cheaper — otherwise clearing would grow the context.
  function cheaperReplacement(
    pointer: string | undefined,
    grossTokens: number,
    bareMarker: string,
  ): string {
    return pointer && roughTokenCountEstimation(pointer) < grossTokens
      ? pointer
      : bareMarker
  }

  // Clear large input string fields on a Write/Edit tool_use whose result is
  // also being cleared. Returns the original block when nothing changes
  // (small fields, already cleared) so repeat fires stay idempotent.
  function clearLargeInputFields(block: {
    type: 'tool_use'
    id: string
    name: string
    input?: unknown
  }): typeof block {
    // API replay uses the preserved input, so clearing its execution copy saves nothing.
    if ('originalInput' in block) return block
    const input = block.input
    if (!input || typeof input !== 'object') {
      return block
    }
    let touched = false
    const newInput: Record<string, unknown> = { ...input }
    for (const [key, value] of Object.entries(newInput)) {
      if (
        typeof value === 'string' &&
        value.length >= MIN_CLEARABLE_INPUT_CHARS &&
        !isAlreadyClearedValue(value, MC_CLEARED_INPUT_MESSAGE)
      ) {
        const gross = roughTokenCountEstimation(value)
        const replacement = cheaperReplacement(
          pointers?.inputs.get(`${block.id}:${key}`),
          gross,
          MC_CLEARED_INPUT_MESSAGE,
        )
        tokensSaved += gross - roughTokenCountEstimation(replacement)
        newInput[key] = replacement
        inputsCleared++
        touched = true
      }
    }
    return touched ? { ...block, input: newInput } : block
  }

  const result: Message[] = messages.map(message => {
    if (
      message.type === 'assistant' &&
      Array.isArray(message.message.content)
    ) {
      let touched = false
      const newContent = message.message.content.map(block => {
        if (
          block.type !== 'tool_use' ||
          !clearSet.has(block.id) ||
          !INPUT_CLEARABLE_TOOLS.has(block.name)
        ) {
          return block
        }
        const newBlock = clearLargeInputFields(block)
        if (newBlock !== block) {
          touched = true
        }
        return newBlock
      })
      if (!touched) return message
      return {
        ...message,
        message: { ...message.message, content: newContent },
      }
    }
    if (message.type !== 'user' || !Array.isArray(message.message.content)) {
      return message
    }
    let touched = false
    const newContent = message.message.content.map(block => {
      if (
        block.type === 'tool_result' &&
        clearSet.has(block.tool_use_id) &&
        !isAlreadyClearedValue(block.content, TIME_BASED_MC_CLEARED_MESSAGE)
      ) {
        const gross = calculateToolResultTokens(block)
        const content = cheaperReplacement(
          pointers?.results.get(block.tool_use_id),
          gross,
          TIME_BASED_MC_CLEARED_MESSAGE,
        )
        // Net saving: the replacement is charged against the result it
        // replaced, so a pointer's real cost shows up instead of the gross size.
        tokensSaved += gross - roughTokenCountEstimation(content)
        clearedNow++
        touched = true
        return { ...block, content }
      }
      return block
    })
    if (!touched) return message
    return {
      ...message,
      message: { ...message.message, content: newContent },
    }
  })

  // Nothing rewritten — everything in clearSet was already cleared on an
  // earlier pass. Keyed off the rewrite count rather than tokensSaved: with
  // net accounting a real clear can net out to zero, and returning null then
  // would throw away a rewrite whose content is already persisted to disk.
  if (clearedNow === 0 && inputsCleared === 0) {
    return null
  }

  return {
    messages: result,
    tokensSaved,
    cleared: clearedNow,
    kept: keepSet.size,
  }
}

/**
 * Shared side-effects after a content-clear, identical for both triggers:
 * suppress the imminent compact warning and tell the cache-break detector to
 * expect a low cache read next turn.
 */
function finalizeContentClear(querySource: QuerySource | undefined): void {
  suppressCompactWarning()
  // We just changed the prompt content — the next response's cache read will
  // be low, but that's us, not a break. Tell the detector to expect a drop.
  // notifyCacheDeletion (not notifyCompaction) because it's already imported
  // here and achieves the same false-positive suppression — adding the second
  // symbol to the import was flagged by the circular-deps check.
  // Pass the actual querySource: getTrackingKey returns the full source string
  // (e.g. 'repl_main_thread:outputStyle:custom'), not just the prefix.
  if (feature('PROMPT_CACHE_BREAK_DETECTION') && querySource) {
    notifyCacheDeletion(querySource)
  }
}

/**
 * Time-based microcompact: when the gap since the last main-loop assistant
 * message exceeds the configured threshold, content-clear all but the most
 * recent N compactable tool results.
 *
 * Returns null when the trigger doesn't fire (disabled, wrong source, gap
 * under threshold, nothing to clear) — caller falls through to other paths.
 *
 * This mutates message content directly. The cache is cold by the time the
 * trigger fires, so there is no warm prefix to preserve.
 */
async function maybeTimeBasedMicrocompact(
  messages: Message[],
  querySource: QuerySource | undefined,
): Promise<MicrocompactResult | null> {
  const trigger = evaluateTimeBasedTrigger(messages, querySource)
  if (!trigger) {
    return null
  }
  const { gapMinutes, config } = trigger

  const cleared = await clearOldToolResultsWithPersistence(
    messages,
    config.keepRecent,
  )
  if (!cleared) {
    return null
  }

  logEvent('tengu_time_based_microcompact', {
    gapMinutes: Math.round(gapMinutes),
    gapThresholdMinutes: config.gapThresholdMinutes,
    toolsCleared: cleared.cleared,
    toolsKept: cleared.kept,
    keepRecent: config.keepRecent,
    tokensSaved: cleared.tokensSaved,
  })

  logForDebugging(
    `[TIME-BASED MC] gap ${Math.round(gapMinutes)}min > ${config.gapThresholdMinutes}min, cleared ${cleared.cleared} tool results (~${cleared.tokensSaved} tokens), kept last ${cleared.kept}`,
  )

  finalizeContentClear(querySource)

  return { messages: cleared.messages }
}

/**
 * Size-based microcompact: the provider-neutral, client-side path.
 *
 * The time-based trigger only fires after a wall-clock pause; an active session
 * never pauses, so without this it grows unchecked until the blocking full
 * compact. Once estimated tokens cross a fraction of the effective context
 * window (below the auto-compact threshold), clear old tool results to buy
 * headroom and defer — or skip — the full compact.
 */
async function maybeSizeBasedMicrocompact(
  messages: Message[],
  querySource: QuerySource | undefined,
  toolUseContext?: ToolUseContext,
): Promise<MicrocompactResult | null> {
  const config = getSizeBasedMCConfig()
  const sdkCanRestore = querySource === 'sdk' && toolUseContext?.options.tools.some(tool => tool.name === FILE_READ_TOOL_NAME)
  if (!config.enabled || !querySource || !(isMainThreadSource(querySource) || sdkCanRestore)) {
    return null
  }

  // Cheap short-circuit: if there aren't more compactable results than we'd
  // keep, clearOldToolResults would return null anyway. Skip the O(n) per-block
  // estimateMessageTokens traversal on the many turns that can't clear anything
  // (plain Q&A, tool-light sessions). Outcome-preserving — only avoids work.
  // The ids are reused below so clearOldToolResults doesn't re-collect them.
  const compactableIds = collectCompactableToolIds(messages)
  if (compactableIds.length <= Math.max(1, config.keepRecent)) {
    return null
  }

  // Preserved thinking binds each thinking block to every earlier byte, so
  // clearing a tool result already sent invalidates all reasoning after it.
  // Leave these models' history append-only; autocompact still bounds it.
  const model = toolUseContext?.options.mainLoopModel ?? getMainLoopModel()
  if (modelEnforcesThinkingPrefixBinding(model)) {
    return null
  }

  // Lazy require to avoid the init-time circular dependency this file is
  // sensitive to (see the toolResultStorage inline note above) — autoCompact
  // pulls in a chain that loops back here at module-load time.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getEffectiveContextWindowSize } =
    require('./autoCompact.js') as typeof import('./autoCompact.js')
  const effectiveWindow = getEffectiveContextWindowSize(
    model,
    toolUseContext?.options.autoCompactWindow,
  )
  const estimatedTokens = estimateMessageTokens(messages)

  if (!shouldSizeTrigger(estimatedTokens, effectiveWindow, config)) {
    return null
  }

  const cleared = await clearOldToolResultsWithPersistence(
    messages,
    config.keepRecent,
    compactableIds,
  )
  if (!cleared) {
    return null
  }

  logEvent('tengu_size_based_microcompact', {
    estimatedTokens,
    effectiveWindow,
    triggerFraction: config.triggerFraction,
    toolsCleared: cleared.cleared,
    toolsKept: cleared.kept,
    keepRecent: config.keepRecent,
    tokensSaved: cleared.tokensSaved,
  })

  logForDebugging(
    `[SIZE-BASED MC] est ${estimatedTokens} >= ${Math.floor(effectiveWindow * config.triggerFraction)} (${Math.round(config.triggerFraction * 100)}% of ${effectiveWindow}), cleared ${cleared.cleared} tool results (~${cleared.tokensSaved} tokens), kept last ${cleared.kept}`,
  )

  finalizeContentClear(querySource)

  return { messages: cleared.messages }
}
