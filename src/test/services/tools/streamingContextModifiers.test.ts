import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import type { ToolUseContext } from '../../../Tool.js'
import { StreamingToolExecutor } from '../../../services/tools/StreamingToolExecutor.js'
import type { AssistantMessage } from '../../../types/message.js'
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

const inputSchema = z.object({
  marker: z.string(),
  hang: z.boolean(),
})

type ModifiedContext = ToolUseContext & { appliedMarkers?: string[] }

// A concurrency-safe tool whose result carries a contextModifier appending
// its marker to the context. The 'hang' variant blocks until release() fires.
function createModifierTool(hooks: {
  onRelease: Promise<void>
  onFastDone: () => void
  applied: string[]
}) {
  return {
    name: 'ModifierTool',
    inputSchema,
    async call(input: z.infer<typeof inputSchema>) {
      if (input.hang) {
        await hooks.onRelease
      } else {
        hooks.onFastDone()
      }
      return {
        data: { output: input.marker },
        contextModifier: (context: ModifiedContext): ModifiedContext => {
          hooks.applied.push(input.marker)
          return {
            ...context,
            appliedMarkers: [...(context.appliedMarkers ?? []), input.marker],
          }
        },
      }
    },
    async description() {
      return 'modifier tool'
    },
    isConcurrencySafe() {
      return true
    },
    isReadOnly() {
      return true
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
      return 'ModifierTool'
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

describe('StreamingToolExecutor context modifiers', () => {
  test('applies concurrency-safe tools’ modifiers in block order, not completion order', async () => {
    let release: () => void
    const released = new Promise<void>(resolve => {
      release = resolve
    })
    let fastDone: () => void
    const fastDonePromise = new Promise<void>(resolve => {
      fastDone = resolve
    })
    const applied: string[] = []

    const tool = createModifierTool({
      onRelease: released,
      onFastDone: () => fastDone(),
      applied,
    })
    const context = createContext()
    context.options.tools = [tool]
    const executor = new StreamingToolExecutor(
      [tool],
      async (_tool, input) => ({ behavior: 'allow', updatedInput: input }),
      context,
    )

    // Tool A (block-order first) hangs; tool B completes immediately.
    const toolUseA = {
      type: 'tool_use',
      id: 'toolu_modifier_a',
      name: 'ModifierTool',
      input: { marker: 'A', hang: true },
    } as ToolUseBlock
    const toolUseB = {
      type: 'tool_use',
      id: 'toolu_modifier_b',
      name: 'ModifierTool',
      input: { marker: 'B', hang: false },
    } as ToolUseBlock
    executor.addTool(toolUseA, createAssistantWithToolUse(toolUseA))
    executor.addTool(toolUseB, createAssistantWithToolUse(toolUseB))

    // Let B finish its call() before A is released, so completion order (B, A)
    // differs from block order (A, B).
    await fastDonePromise
    release!()

    let lastContext: ModifiedContext | undefined
    for await (const update of executor.getRemainingResults()) {
      if (update.newContext) {
        lastContext = update.newContext as ModifiedContext
      }
    }

    // Pre-fix behavior: concurrency-safe modifiers were silently dropped
    // ([] here). Block order must also hold despite B completing first.
    expect(applied).toEqual(['A', 'B'])
    expect(lastContext?.appliedMarkers).toEqual(['A', 'B'])
  }, 5000)
})
