import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import type { ToolUseContext } from '../../../Tool.js'
import { StreamingToolExecutor } from '../../../services/tools/StreamingToolExecutor.js'
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
      }) as unknown as ReturnType<ToolUseContext['getAppState']>,
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

const hangingInputSchema = z.object({
  command: z.string(),
  readOnly: z.boolean(),
})

// A tool whose call() blocks until its per-tool abort signal fires —
// stands in for a long-running Bash subprocess listening to the signal.
function createHangingTool(hooks: {
  onStart: () => void
  onAbort: () => void
}) {
  return {
    name: BASH_TOOL_NAME,
    inputSchema: hangingInputSchema,
    async call(
      _input: z.infer<typeof hangingInputSchema>,
      context: ToolUseContext,
    ) {
      hooks.onStart()
      await new Promise<void>(resolve => {
        if (context.abortController.signal.aborted) {
          hooks.onAbort()
          resolve()
          return
        }
        context.abortController.signal.addEventListener(
          'abort',
          () => {
            hooks.onAbort()
            resolve()
          },
          { once: true },
        )
      })
      return { data: { output: 'aborted' } }
    },
    async description() {
      return 'hanging bash'
    },
    isConcurrencySafe(input: z.infer<typeof hangingInputSchema>) {
      return input.readOnly
    },
    isReadOnly(input: z.infer<typeof hangingInputSchema>) {
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
      content: { output: string },
      toolUseID: string,
    ) {
      return {
        type: 'tool_result',
        tool_use_id: toolUseID,
        content: content.output,
      }
    },
    renderToolUseMessage() {
      return null
    },
    maxResultSizeChars: 1000,
  } as never
}

describe('StreamingToolExecutor.discard', () => {
  test('aborts in-flight tools so subprocesses do not run to completion', async () => {
    let started: () => void
    const startedPromise = new Promise<void>(resolve => {
      started = resolve
    })
    let aborted: () => void
    const abortedPromise = new Promise<void>(resolve => {
      aborted = resolve
    })

    const hangingTool = createHangingTool({
      onStart: () => started(),
      onAbort: () => aborted(),
    })
    const context = createContext()
    context.options.tools = [hangingTool]
    const executor = new StreamingToolExecutor(
      [hangingTool],
      async (_tool, input) => ({ behavior: 'allow', updatedInput: input }),
      context,
    )

    const toolUse = {
      type: 'tool_use',
      id: 'toolu_hanging',
      name: BASH_TOOL_NAME,
      input: { command: 'sleep forever', readOnly: false },
    } as ToolUseBlock
    executor.addTool(toolUse, createAssistantWithToolUse(toolUse))

    // Wait until the tool's call() is actually running, then discard.
    await startedPromise
    executor.discard()

    // Without the abort in discard(), this hangs until test timeout.
    await abortedPromise

    // Discard must not end the turn — the query controller stays live for
    // the fallback retry.
    expect(context.abortController.signal.aborted).toBe(false)

    // Discarded executors yield nothing.
    const updates: Message[] = []
    for await (const update of executor.getRemainingResults()) {
      if (update.message) updates.push(update.message)
    }
    expect(updates).toHaveLength(0)
  }, 5000)
})
