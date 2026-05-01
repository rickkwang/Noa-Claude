import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import { describe, expect, test } from 'bun:test'
import type { ToolUseContext } from '../../../Tool.js'
import { StreamingToolExecutor } from '../../../services/tools/StreamingToolExecutor.js'
import { runTools } from '../../../services/tools/toolOrchestration.js'
import type { AssistantMessage, Message } from '../../../types/message.js'
import { createAssistantMessage } from '../../../utils/messages.js'

function createContext(): ToolUseContext {
  return {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'test-model',
      tools: [],
      verbose: false,
      thinkingConfig: { type: 'disabled' },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: true,
      agentDefinitions: { activeAgents: [], allAgents: [], allowedAgentTypes: [] },
    },
    abortController: new AbortController(),
    readFileState: {} as ToolUseContext['readFileState'],
    getAppState: () => ({}) as ReturnType<ToolUseContext['getAppState']>,
    setAppState: () => {},
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
    messages: [],
  }
}

function createAssistantWithToolUse(toolUse: ToolUseBlock): AssistantMessage {
  return createAssistantMessage({
    content: [toolUse],
  })
}

function getToolResults(messages: Message[]) {
  return messages.flatMap(message =>
    message.type === 'user' && Array.isArray(message.message?.content)
      ? message.message.content.filter(block => block.type === 'tool_result')
      : [],
  )
}

describe('malformed tool names', () => {
  test('serial tool execution returns an error tool_result instead of throwing', async () => {
    const toolUse = {
      type: 'tool_use',
      id: 'toolu_bad_serial',
      name: { malformed: true },
      input: {},
    } as unknown as ToolUseBlock
    const assistant = createAssistantWithToolUse(toolUse)
    const updates: Message[] = []

    for await (const update of runTools(
      [toolUse],
      [assistant],
      async () => ({ behavior: 'allow', updatedInput: {} }),
      createContext(),
    )) {
      if (update.message) updates.push(update.message)
    }

    const results = getToolResults(updates)
    expect(results).toHaveLength(1)
    expect(results[0]?.tool_use_id).toBe('toolu_bad_serial')
    expect(results[0]?.is_error).toBe(true)
  })

  test('streaming parallel executor completes malformed tool names', async () => {
    const toolUse = {
      type: 'tool_use',
      id: 'toolu_bad_streaming',
      name: ['not', 'a', 'name'],
      input: {},
    } as unknown as ToolUseBlock
    const assistant = createAssistantWithToolUse(toolUse)
    const executor = new StreamingToolExecutor(
      [],
      async () => ({ behavior: 'allow', updatedInput: {} }),
      createContext(),
    )
    const updates: Message[] = []

    executor.addTool(toolUse, assistant)
    for await (const update of executor.getRemainingResults()) {
      if (update.message) updates.push(update.message)
    }

    const results = getToolResults(updates)
    expect(results).toHaveLength(1)
    expect(results[0]?.tool_use_id).toBe('toolu_bad_streaming')
    expect(results[0]?.is_error).toBe(true)
  })
})
