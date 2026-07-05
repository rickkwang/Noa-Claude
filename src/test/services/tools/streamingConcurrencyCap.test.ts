import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import { afterEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import type { ToolUseContext } from '../../../Tool.js'
import { StreamingToolExecutor } from '../../../services/tools/StreamingToolExecutor.js'
import type { AssistantMessage } from '../../../types/message.js'
import { createAssistantMessage } from '../../../utils/messages.js'

const CONCURRENCY_ENV = 'CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY'
const originalConcurrencyEnv = process.env[CONCURRENCY_ENV]

afterEach(() => {
  if (originalConcurrencyEnv === undefined) {
    delete process.env[CONCURRENCY_ENV]
  } else {
    process.env[CONCURRENCY_ENV] = originalConcurrencyEnv
  }
})

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

const inputSchema = z.object({ id: z.string() })

// A concurrency-safe tool that blocks on a shared release gate and reports
// how many instances are running at once via the shared `active`/`maxActive`
// counters — stands in for N read-only tools (Read/Grep/Glob) the model
// emits in a single batch.
function createTrackedTool(state: {
  active: number
  maxActive: number
  release: Promise<void>
}) {
  return {
    name: 'TrackedTool',
    inputSchema,
    async call() {
      state.active += 1
      state.maxActive = Math.max(state.maxActive, state.active)
      await state.release
      state.active -= 1
      return { data: { output: 'ok' } }
    },
    async description() {
      return 'tracked tool'
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
      return 'TrackedTool'
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

describe('StreamingToolExecutor concurrency cap', () => {
  test('never runs more concurrency-safe tools at once than the configured cap', async () => {
    process.env[CONCURRENCY_ENV] = '2'

    let release: () => void
    const released = new Promise<void>(resolve => {
      release = resolve
    })
    const state = { active: 0, maxActive: 0, release: released }

    const tool = createTrackedTool(state)
    const context = createContext()
    context.options.tools = [tool]
    const executor = new StreamingToolExecutor(
      [tool],
      async (_tool, input) => ({ behavior: 'allow', updatedInput: input }),
      context,
    )

    const toolUseCount = 5
    for (let i = 0; i < toolUseCount; i++) {
      const toolUse = {
        type: 'tool_use',
        id: `toolu_tracked_${i}`,
        name: 'TrackedTool',
        input: { id: String(i) },
      } as ToolUseBlock
      executor.addTool(toolUse, createAssistantWithToolUse(toolUse))
    }

    // Give the executor's microtask-driven queue processing a chance to start
    // every tool it's willing to start before anything completes.
    await new Promise(resolve => setTimeout(resolve, 20))

    // Pre-fix behavior: canExecuteTool only checked isConcurrencySafe, so all
    // 5 would start at once (state.active === 5). With the cap restored to 2,
    // only 2 should be running while the rest wait in the queue.
    expect(state.active).toBe(2)

    release!()

    const updates: unknown[] = []
    for await (const update of executor.getRemainingResults()) {
      if (update.message) updates.push(update.message)
    }

    expect(updates).toHaveLength(toolUseCount)
    expect(state.maxActive).toBe(2)
    expect(state.active).toBe(0)
  }, 5000)
})
