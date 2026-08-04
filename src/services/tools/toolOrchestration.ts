// @ts-nocheck
import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import { findToolByName, type ToolUseContext } from '../../Tool.js'
import type { AssistantMessage, Message } from '../../types/message.js'
import { errorMessage } from '../../utils/errors.js'
import { all } from '../../utils/generators.js'
import { logEvent } from '../analytics/index.js'
import { type MessageUpdateLazy, runToolUse } from './toolExecution.js'

export function getMaxToolUseConcurrency(): number {
  return (
    parseInt(process.env.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY || '', 10) || 10
  )
}

export type MessageUpdate = {
  message?: Message
  newContext: ToolUseContext
}

export async function* runTools(
  toolUseMessages: ToolUseBlock[],
  assistantMessages: AssistantMessage[],
  canUseTool: CanUseToolFn,
  toolUseContext: ToolUseContext,
): AsyncGenerator<MessageUpdate, void> {
  let currentContext = toolUseContext
  // Tool uses from earlier batches of this same turn. Batches run in order,
  // so everything here has already been dispatched by the time the next
  // batch starts.
  const precedingBlocks: ToolUseBlock[] = []
  for (const { isConcurrencySafe, blocks } of partitionToolCalls(
    toolUseMessages,
    currentContext,
  )) {
    const batchPrecedingBlocks = [...precedingBlocks]
    precedingBlocks.push(...blocks)
    if (isConcurrencySafe) {
      const queuedContextModifiers: Record<
        string,
        ((context: ToolUseContext) => ToolUseContext)[]
      > = {}
      // Run read-only batch concurrently
      for await (const update of runToolsConcurrently(
        blocks,
        assistantMessages,
        canUseTool,
        currentContext,
        batchPrecedingBlocks,
      )) {
        if (update.contextModifier) {
          const { toolUseID, modifyContext } = update.contextModifier
          if (!queuedContextModifiers[toolUseID]) {
            queuedContextModifiers[toolUseID] = []
          }
          queuedContextModifiers[toolUseID].push(modifyContext)
        }
        yield {
          message: update.message,
          newContext: currentContext,
        }
      }
      for (const block of blocks) {
        const modifiers = queuedContextModifiers[block.id]
        if (!modifiers) {
          continue
        }
        for (const modifier of modifiers) {
          currentContext = modifier(currentContext)
        }
      }
      yield { newContext: currentContext }
    } else {
      // Run non-read-only batch serially
      for await (const update of runToolsSerially(
        blocks,
        assistantMessages,
        canUseTool,
        currentContext,
        batchPrecedingBlocks,
      )) {
        if (update.newContext) {
          currentContext = update.newContext
        }
        yield {
          message: update.message,
          newContext: currentContext,
        }
      }
    }
  }
}

/** A tool use paired with the assistant message that emitted it. */
export type PrecedingToolUse = {
  block: ToolUseBlock
  assistantMessage: AssistantMessage
}

/**
 * Rebuild preceding tool uses as assistant messages, grouped by the message
 * each came from and keeping the model's original ordering. Used to give the
 * auto mode classifier the rest of the current turn as context — see
 * ToolUseContext.sameTurnToolUses. Shared by both execution paths
 * (runTools here, StreamingToolExecutor) so they can't drift apart.
 *
 * Returns undefined when there is nothing preceding, so the classifier path
 * can skip copying `messages` entirely for the common single-tool turn.
 */
export function buildSameTurnToolUses(
  precedingToolUses: PrecedingToolUse[],
): AssistantMessage[] | undefined {
  if (precedingToolUses.length === 0) return undefined
  try {
    const byMessage = new Map<AssistantMessage, ToolUseBlock[]>()
    for (const { block, assistantMessage } of precedingToolUses) {
      const blocks = byMessage.get(assistantMessage) ?? []
      blocks.push(block)
      byMessage.set(assistantMessage, blocks)
    }
    return [...byMessage.entries()].map(([msg, blocks]) => ({
      ...msg,
      message: { ...msg.message, content: blocks },
    }))
  } catch (error) {
    // Context for the classifier is best-effort — a failure here must not
    // take down tool execution. Falling back to undefined just means the
    // classifier sees the turn without its sibling calls.
    logEvent('tengu_auto_mode_sibling_context_error', {
      error: errorMessage(error),
    })
    return undefined
  }
}

/**
 * Pair each block with the assistant message that emitted it, dropping blocks
 * whose source message can't be found. runTools tracks blocks and messages
 * separately, so it has to resolve the pairing that StreamingToolExecutor
 * already carries on each tracked tool.
 */
export function resolvePrecedingToolUses(
  blocks: ToolUseBlock[],
  assistantMessages: AssistantMessage[],
): PrecedingToolUse[] {
  const pairs: PrecedingToolUse[] = []
  for (const block of blocks) {
    const assistantMessage = assistantMessages.find(msg =>
      msg.message.content.some(
        content => content.type === 'tool_use' && content.id === block.id,
      ),
    )
    if (assistantMessage) pairs.push({ block, assistantMessage })
  }
  return pairs
}

type Batch = { isConcurrencySafe: boolean; blocks: ToolUseBlock[] }

/**
 * Partition tool calls into batches where each batch is either:
 * 1. A single non-read-only tool, or
 * 2. Multiple consecutive read-only tools
 */
function partitionToolCalls(
  toolUseMessages: ToolUseBlock[],
  toolUseContext: ToolUseContext,
): Batch[] {
  return toolUseMessages.reduce((acc: Batch[], toolUse) => {
    const tool = findToolByName(toolUseContext.options.tools, toolUse.name)
    const parsedInput = tool?.inputSchema.safeParse(toolUse.input)
    const isConcurrencySafe = parsedInput?.success
      ? (() => {
          try {
            return Boolean(tool?.isConcurrencySafe(parsedInput.data))
          } catch {
            // If isConcurrencySafe throws (e.g., due to shell-quote parse failure),
            // treat as not concurrency-safe to be conservative
            return false
          }
        })()
      : false
    if (isConcurrencySafe && acc[acc.length - 1]?.isConcurrencySafe) {
      acc[acc.length - 1]!.blocks.push(toolUse)
    } else {
      acc.push({ isConcurrencySafe, blocks: [toolUse] })
    }
    return acc
  }, [])
}

async function* runToolsSerially(
  toolUseMessages: ToolUseBlock[],
  assistantMessages: AssistantMessage[],
  canUseTool: CanUseToolFn,
  toolUseContext: ToolUseContext,
  precedingBlocks: ToolUseBlock[] = [],
): AsyncGenerator<MessageUpdate, void> {
  let currentContext = toolUseContext

  for (const [index, toolUse] of toolUseMessages.entries()) {
    toolUseContext.setInProgressToolUseIDs(prev =>
      new Set(prev).add(toolUse.id),
    )
    const sameTurnToolUses = buildSameTurnToolUses(
      resolvePrecedingToolUses(
        [...precedingBlocks, ...toolUseMessages.slice(0, index)],
        assistantMessages,
      ),
    )
    for await (const update of runToolUse(
      toolUse,
      assistantMessages.find(_ =>
        _.message.content.some(
          _ => _.type === 'tool_use' && _.id === toolUse.id,
        ),
      )!,
      canUseTool,
      { ...currentContext, sameTurnToolUses },
    )) {
      if (update.contextModifier) {
        currentContext = update.contextModifier.modifyContext(currentContext)
      }
      yield {
        message: update.message,
        newContext: currentContext,
      }
    }
    markToolUseAsComplete(toolUseContext, toolUse.id)
  }
}

async function* runToolsConcurrently(
  toolUseMessages: ToolUseBlock[],
  assistantMessages: AssistantMessage[],
  canUseTool: CanUseToolFn,
  toolUseContext: ToolUseContext,
  precedingBlocks: ToolUseBlock[] = [],
): AsyncGenerator<MessageUpdateLazy, void> {
  yield* all(
    toolUseMessages.map(async function* (toolUse, index) {
      toolUseContext.setInProgressToolUseIDs(prev =>
        new Set(prev).add(toolUse.id),
      )
      // Every call in the batch is dispatched together, so "preceding" here
      // means the model's emission order, not completion order — that
      // ordering is what makes each call's prefix an extension of the last.
      const sameTurnToolUses = buildSameTurnToolUses(
        resolvePrecedingToolUses(
          [...precedingBlocks, ...toolUseMessages.slice(0, index)],
          assistantMessages,
        ),
      )
      yield* runToolUse(
        toolUse,
        assistantMessages.find(_ =>
          _.message.content.some(
            _ => _.type === 'tool_use' && _.id === toolUse.id,
          ),
        )!,
        canUseTool,
        { ...toolUseContext, sameTurnToolUses },
      )
      markToolUseAsComplete(toolUseContext, toolUse.id)
    }),
    getMaxToolUseConcurrency(),
  )
}

function markToolUseAsComplete(
  toolUseContext: ToolUseContext,
  toolUseID: string,
) {
  toolUseContext.setInProgressToolUseIDs(prev => {
    const next = new Set(prev)
    next.delete(toolUseID)
    return next
  })
}
