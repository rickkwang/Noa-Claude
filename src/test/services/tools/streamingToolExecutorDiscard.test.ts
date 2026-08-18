import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import type { ToolUseContext } from '../../../Tool.js'
import { StreamingToolExecutor } from '../../../services/tools/StreamingToolExecutor.js'
import { createAssistantMessage } from '../../../utils/messages.js'

const inputSchema = z.object({})

/**
 * Context whose in-progress set is a real Set, so a leak is observable.
 * The executor is the only writer in these tests.
 */
function createContext(tools: ToolUseContext['options']['tools']) {
  const inProgress = new Set<string>()
  let interruptible: boolean | undefined
  const appState = {
    toolPermissionContext: { mode: 'default' },
    agentDefinitions: { activeAgents: [], allAgents: [], allowedAgentTypes: [] },
    sessionHooks: new Map(),
    mcp: { tools: [], clients: [] },
    fastMode: false,
  }
  const context = {
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
      agentDefinitions: {
        activeAgents: [],
        allAgents: [],
        allowedAgentTypes: [],
      },
    },
    abortController: new AbortController(),
    readFileState: {} as ToolUseContext['readFileState'],
    getAppState: () =>
      appState as unknown as ReturnType<ToolUseContext['getAppState']>,
    setAppState: () => {},
    setInProgressToolUseIDs: (f: (prev: Set<string>) => Set<string>) => {
      const next = f(inProgress)
      inProgress.clear()
      for (const id of next) inProgress.add(id)
    },
    setHasInterruptibleToolInProgress: (v: boolean) => {
      interruptible = v
    },
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
    messages: [],
  } as unknown as ToolUseContext
  return {
    context,
    inProgress,
    getInterruptible: () => interruptible,
  }
}

const allowAll = async (_tool: unknown, input: unknown) => ({
  behavior: 'allow' as const,
  updatedInput: input,
})

/** Minimal tool whose `call` resolves when `body` does. */
function makeTool(name: string, body: () => Promise<void>) {
  return {
    name,
    inputSchema,
    isConcurrencySafe: () => false,
    isReadOnly: () => false,
    async call() {
      await body()
      return { data: { output: 'done' } }
    },
    mapToolResultToToolResultBlockParam: (
      _data: unknown,
      toolUseID: string,
    ) => ({
      type: 'tool_result' as const,
      tool_use_id: toolUseID,
      content: 'done',
    }),
    maxResultSizeChars: 100_000,
  }
}

function toolUseBlock(id: string, name: string) {
  return { type: 'tool_use' as const, id, name, input: {} }
}

function assistantWith(id: string, name: string) {
  const msg = createAssistantMessage({
    content: [toolUseBlock(id, name)],
  })
  return msg
}

describe('StreamingToolExecutor.discard', () => {
  test('releases in-progress marks and does not start queued tools', async () => {
    // Two non-concurrency-safe tools: the first runs, the second stays queued
    // (canExecuteTool refuses to start it while another tool executes).
    let releaseFirst: () => void = () => {}
    const firstRunning = new Promise<void>(resolve => {
      releaseFirst = resolve
    })
    let firstStarted: () => void = () => {}
    const firstHasStarted = new Promise<void>(resolve => {
      firstStarted = resolve
    })

    const tool = makeTool('SlowTool', async () => {
      firstStarted()
      await firstRunning
    })

    const { context, inProgress, getInterruptible } = createContext([
      tool,
    ] as unknown as ToolUseContext['options']['tools'])

    const executor = new StreamingToolExecutor(
      context.options.tools,
      allowAll as never,
      context,
    )

    executor.addTool(
      toolUseBlock('call-1', 'SlowTool') as never,
      assistantWith('call-1', 'SlowTool') as never,
    )
    executor.addTool(
      toolUseBlock('call-2', 'SlowTool') as never,
      assistantWith('call-2', 'SlowTool') as never,
    )

    await firstHasStarted
    expect(inProgress.has('call-1')).toBe(true)
    // call-2 is queued behind a non-concurrency-safe tool, so it never started.
    expect(inProgress.has('call-2')).toBe(false)

    executor.discard()

    // discard must release what it took: otherwise the fallback retry comes
    // back with fresh tool_use_ids and 'call-1' pins the REPL's running state.
    expect(inProgress.size).toBe(0)
    expect(getInterruptible()).toBe(false)

    // Let the in-flight tool settle. Its promise.finally re-enters
    // processQueue, which would otherwise start the queued 'call-2' and
    // re-add an in-progress mark that nothing will ever clear.
    releaseFirst()
    await new Promise(resolve => setTimeout(resolve, 20))

    expect([...inProgress]).toEqual([])
  })

  test('discarded executor yields no results', async () => {
    const tool = makeTool('QuickTool', async () => {})
    const { context, inProgress } = createContext([
      tool,
    ] as unknown as ToolUseContext['options']['tools'])
    const executor = new StreamingToolExecutor(
      context.options.tools,
      allowAll as never,
      context,
    )
    executor.addTool(
      toolUseBlock('q-1', 'QuickTool') as never,
      assistantWith('q-1', 'QuickTool') as never,
    )
    executor.discard()
    await new Promise(resolve => setTimeout(resolve, 20))

    // Both getters are documented to return early once discarded — the
    // in-progress release in discard() is therefore the only cleanup path.
    expect([...executor.getCompletedResults()]).toHaveLength(0)
    expect(inProgress.size).toBe(0)
  })
})
