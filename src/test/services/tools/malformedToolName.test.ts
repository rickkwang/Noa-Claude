import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import type { ToolUseContext } from '../../../Tool.js'
import { StreamingToolExecutor } from '../../../services/tools/StreamingToolExecutor.js'
import { runTools } from '../../../services/tools/toolOrchestration.js'
import { BASH_TOOL_NAME } from '../../../tools/BashTool/toolName.js'
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
    getAppState: () =>
      ({
        toolPermissionContext: { mode: 'default' },
        agentDefinitions: { activeAgents: [], allAgents: [], allowedAgentTypes: [] },
        sessionHooks: new Map(),
      }) as ReturnType<ToolUseContext['getAppState']>,
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

const bashInputSchema = z.object({
  command: z.string(),
  readOnly: z.boolean(),
  fail: z.boolean().optional(),
  delayMs: z.number().optional(),
})

function createFakeBashTool() {
  return {
    name: BASH_TOOL_NAME,
    inputSchema: bashInputSchema,
    async call(input: z.infer<typeof bashInputSchema>) {
      if (input.delayMs) {
        await new Promise(resolve => setTimeout(resolve, input.delayMs))
      }
      return {
        data: input.fail
          ? { output: 'failed', isError: true }
          : { output: 'ok' },
      }
    },
    async description() {
      return 'fake bash'
    },
    isConcurrencySafe(input: z.infer<typeof bashInputSchema>) {
      return input.readOnly
    },
    isReadOnly(input: z.infer<typeof bashInputSchema>) {
      return input.readOnly
    },
    isEnabled() {
      return true
    },
    async checkPermissions() {
      return { behavior: 'allow' }
    },
    async prompt() {
      return ''
    },
    userFacingName() {
      return 'Bash'
    },
    toAutoClassifierInput() {
      return ''
    },
    mapToolResultToToolResultBlockParam(
      content: { output: string; isError?: boolean },
      toolUseID: string,
    ) {
      return {
        type: 'tool_result',
        tool_use_id: toolUseID,
        content: content.output,
        is_error: content.isError,
      }
    },
    renderToolUseMessage() {
      return null
    },
    maxResultSizeChars: 1000,
  } as never
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

describe('streaming Bash sibling cancellation', () => {
  test('read-only Bash failures do not cancel parallel read-only siblings', async () => {
    const failingToolUse = {
      type: 'tool_use',
      id: 'toolu_readonly_fail',
      name: BASH_TOOL_NAME,
      input: {
        command: 'grep missing file',
        readOnly: true,
        fail: true,
      },
    } as ToolUseBlock
    const siblingToolUse = {
      type: 'tool_use',
      id: 'toolu_readonly_sibling',
      name: BASH_TOOL_NAME,
      input: {
        command: 'cat file',
        readOnly: true,
        delayMs: 20,
      },
    } as ToolUseBlock
    const assistant = createAssistantWithToolUse(failingToolUse)
    const fakeBashTool = createFakeBashTool()
    const context = createContext()
    context.options.tools = [fakeBashTool]
    const executor = new StreamingToolExecutor(
      [fakeBashTool],
      async (_tool, input) => ({ behavior: 'allow', updatedInput: input }),
      context,
    )
    const updates: Message[] = []

    executor.addTool(failingToolUse, assistant)
    executor.addTool(siblingToolUse, assistant)
    for await (const update of executor.getRemainingResults()) {
      if (update.message) updates.push(update.message)
    }

    const results = getToolResults(updates)
    const siblingResult = results.find(
      result => result.tool_use_id === siblingToolUse.id,
    )
    expect(siblingResult?.is_error).not.toBe(true)
    expect(siblingResult?.content).toBe('ok')
  })

  test('non-read-only Bash failures still cancel queued siblings', async () => {
    const failingToolUse = {
      type: 'tool_use',
      id: 'toolu_mutating_fail',
      name: BASH_TOOL_NAME,
      input: {
        command: 'mkdir /forbidden',
        readOnly: false,
        fail: true,
      },
    } as ToolUseBlock
    const siblingToolUse = {
      type: 'tool_use',
      id: 'toolu_after_mutating_fail',
      name: BASH_TOOL_NAME,
      input: {
        command: 'cat file',
        readOnly: true,
      },
    } as ToolUseBlock
    const assistant = createAssistantWithToolUse(failingToolUse)
    const fakeBashTool = createFakeBashTool()
    const context = createContext()
    context.options.tools = [fakeBashTool]
    const executor = new StreamingToolExecutor(
      [fakeBashTool],
      async (_tool, input) => ({ behavior: 'allow', updatedInput: input }),
      context,
    )
    const updates: Message[] = []

    executor.addTool(failingToolUse, assistant)
    executor.addTool(siblingToolUse, assistant)
    for await (const update of executor.getRemainingResults()) {
      if (update.message) updates.push(update.message)
    }

    const results = getToolResults(updates)
    const siblingResult = results.find(
      result => result.tool_use_id === siblingToolUse.id,
    )
    expect(siblingResult?.is_error).toBe(true)
    expect(String(siblingResult?.content)).toContain('Cancelled')
  })
})
