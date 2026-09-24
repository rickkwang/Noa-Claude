import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import type { ToolUseContext } from '../../../Tool.js'
import { StreamingToolExecutor } from '../../../services/tools/StreamingToolExecutor.js'
import {
  createAssistantMessage,
  markTurnEndedForMessage,
  REJECT_MESSAGE,
  TURN_ENDED_FOR_MESSAGE_TOOL_RESULT,
} from '../../../utils/messages.js'

function contextWith(tools: unknown[]) {
  return {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'test-model',
      tools,
      verbose: false,
      thinkingConfig: { type: 'disabled' },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: true,
      agentDefinitions: { activeAgents: [], allAgents: [], allowedAgentTypes: [] },
    },
    abortController: new AbortController(),
    readFileState: {},
    getAppState: () => ({
      toolPermissionContext: { mode: 'default' },
      agentDefinitions: { activeAgents: [], allAgents: [], allowedAgentTypes: [] },
      sessionHooks: new Map(),
      mcp: { tools: [], clients: [] },
      fastMode: false,
    }),
    setAppState: () => {},
    setInProgressToolUseIDs: () => {},
    setHasInterruptibleToolInProgress: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
    messages: [],
  } as unknown as ToolUseContext
}

// A tool an 'interrupt' abort cancels (interruptBehavior 'cancel').
const sleepLike = {
  name: 'SleepLike',
  inputSchema: z.object({}),
  isConcurrencySafe: () => false,
  isReadOnly: () => true,
  interruptBehavior: () => 'cancel' as const,
  async call() {
    return { data: {} }
  },
  mapToolResultToToolResultBlockParam: (_: unknown, id: string) => ({
    type: 'tool_result' as const,
    tool_use_id: id,
    content: 'ran',
  }),
  maxResultSizeChars: 1000,
}

async function cutOffResult(markEnded: boolean): Promise<unknown> {
  const context = contextWith([sleepLike])
  if (markEnded) markTurnEndedForMessage(context.abortController.signal)
  context.abortController.abort('interrupt')
  const executor = new StreamingToolExecutor(
    context.options.tools,
    (async (_t: unknown, input: unknown) => ({ behavior: 'allow', updatedInput: input })) as never,
    context,
  )
  const block = { type: 'tool_use' as const, id: 'call-1', name: 'SleepLike', input: {} }
  executor.addTool(block as never, createAssistantMessage({ content: [block] }) as never)
  for await (const update of executor.getRemainingResults()) {
    const content = (update.message as { message?: { content?: unknown } })?.message?.content
    if (Array.isArray(content) && content[0]?.type === 'tool_result') {
      return content[0].content
    }
  }
  return undefined
}

describe('tool call cut off by an interrupt', () => {
  test('send-now: says the turn ended to deliver the next message', async () => {
    expect(await cutOffResult(true)).toBe(TURN_ENDED_FOR_MESSAGE_TOOL_RESULT)
  })

  test('any other interrupt keeps the rejection text', async () => {
    expect(String(await cutOffResult(false))).toStartWith(REJECT_MESSAGE)
  })
})
