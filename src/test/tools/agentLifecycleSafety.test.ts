import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { AgentTool } from '../../tools/AgentTool/AgentTool.js'
import * as agentRunner from '../../tools/AgentTool/runAgent.js'
import { runAsyncAgentLifecycle } from '../../tools/AgentTool/agentToolUtils.js'
import * as tasks from '../../tasks/LocalAgentTask/LocalAgentTask.js'
import * as commands from '../../commands.js'
import * as mcp from '../../services/mcp/client.js'
import * as mcpConfig from '../../services/mcp/config.js'
import * as prompts from '../../constants/prompts.js'
import { getDefaultAppState } from '../../state/AppStateStore.js'
import { createStore } from '../../state/store.js'
import { createFileStateCacheWithSizeLimit } from '../../utils/fileStateCache.js'
import { createAssistantMessage, createUserMessage } from '../../utils/messages.js'
import { resetSessionBudgets } from '../../utils/task/sessionBudget.js'
import { AbortError } from '../../utils/errors.js'

function gate() {
  let resolve!: () => void
  const promise = new Promise<void>(r => { resolve = r })
  return { promise, resolve }
}

function fixture() {
  const store = createStore(getDefaultAppState())
  const agent = { agentType: 'test-worker', source: 'custom', tools: [], getSystemPrompt: () => 'test' }
  const context: any = {
    options: { tools: [], mainLoopModel: 'test-model', mcpClients: [], agentDefinitions: { activeAgents: [agent] } },
    getAppState: store.getState,
    setAppState: store.setState,
    abortController: new AbortController(),
    messages: [],
    readFileState: createFileStateCacheWithSizeLimit(10),
    setResponseLength: () => {},
  }
  return { store, agent, context }
}

afterEach(() => {
  mock.restore()
  resetSessionBudgets()
})

describe('agent lifecycle ownership', () => {
  test('background handoff drains the original iterator without losing in-flight results', async () => {
    const { store, context } = fixture()
    const pending = gate(), release = gate(), closing = gate(), closed = gate(), notified = gate()
    const toolUse = createAssistantMessage({ content: [{ type: 'tool_use', id: 'pending-tool', name: 'Bash', input: {} }] })
    const toolResult = createUserMessage({ content: [{ type: 'tool_result', tool_use_id: 'pending-tool', content: 'mutation finished' }] })
    let starts = 0
    let foregroundController!: AbortController
    const unsubscribe = store.subscribe(() => {
      const task: any = Object.values(store.getState().tasks)[0]
      if (task?.notified) notified.resolve()
    })
    spyOn(prompts, 'enhanceSystemPromptWithEnvDetails').mockResolvedValue(['test'])
    spyOn(agentRunner, 'runAgent').mockImplementation((async function* (params: any) {
      starts++
      if (starts === 1) {
        foregroundController = params.override.abortController
        try {
          yield toolUse
          pending.resolve()
          await release.promise
          yield toolResult
          yield createAssistantMessage({ content: 'done' })
        } finally {
          closing.resolve()
          await closed.promise
        }
      } else {
        throw new Error('must not restart')
      }
    }) as any)
    const call = AgentTool.call({ prompt: 'test', description: 'test', subagent_type: 'test-worker' }, context, undefined as never, createAssistantMessage({ content: 'spawn' }))
    try {
      await pending.promise
      const id = Object.keys(store.getState().tasks)[0]!
      expect(tasks.backgroundAgentTask(id, store.getState, store.setState)).toBe(true)
      store.setState(s => ({ ...s, tasks: { ...s.tasks, [id]: { ...s.tasks[id]!, retain: true, messages: [] } as any } }))
      expect((await call).data).toMatchObject({ status: 'async_launched' })
      context.abortController.abort('parent escaped')
      expect(foregroundController.signal.aborted).toBe(false)
      await Bun.sleep(1100)
      expect(starts).toBe(1)
      release.resolve()
      await closing.promise
      expect(starts).toBe(1)
      closed.resolve()
      await notified.promise
      const final: any = store.getState().tasks[id]
      expect(final.messages).toContain(toolResult)
      expect(final.result.totalToolUseCount).toBe(1)
      expect(final.result.content).toEqual([{ type: 'text', text: 'done' }])
      expect(starts).toBe(1)
    } finally {
      release.resolve()
      closed.resolve()
      await call
      await Bun.sleep(20)
      unsubscribe()
    }
  }, 5000)

  test.each(['complete', 'error', 'stop'])('pending foreground %s is finalized without restarting', async mode => {
    const { store, context } = fixture()
    const pending = gate(), release = gate(), notified = gate()
    let starts = 0
    let controller!: AbortController
    spyOn(prompts, 'enhanceSystemPromptWithEnvDetails').mockResolvedValue(['test'])
    spyOn(agentRunner, 'runAgent').mockImplementation((async function* (params: any) {
      starts++
      controller = params.override.abortController
      yield createAssistantMessage({ content: 'partial result' })
      pending.resolve()
      await release.promise
      if (mode === 'error') throw new Error('pending failure')
      if (controller.signal.aborted) throw new AbortError()
    }) as any)
    const call = AgentTool.call({ prompt: 'test', description: 'test', subagent_type: 'test-worker' }, context, undefined as never, createAssistantMessage({ content: 'spawn' }))
    await pending.promise
    const id = Object.keys(store.getState().tasks)[0]!
    const unsubscribe = store.subscribe(() => { if (store.getState().tasks[id]?.notified) notified.resolve() })
    try {
      tasks.backgroundAgentTask(id, store.getState, store.setState)
      await call
      if (mode === 'stop') {
        tasks.killAsyncAgent(id, store.setState)
        expect(controller.signal.aborted).toBe(true)
      }
      release.resolve()
      await notified.promise
      expect(starts).toBe(1)
      expect(store.getState().tasks[id]?.status).toBe(mode === 'complete' ? 'completed' : mode === 'stop' ? 'killed' : 'failed')
    } finally {
      release.resolve()
      unsubscribe()
      await call
    }
  })

  test('same ID cannot register again until terminal notification cleanup has finished', async () => {
    const { store, agent, context } = fixture()
    const id = 'agent-lifecycle-reentry'
    const registration: any = { agentId: id, description: 'test', prompt: 'test', selectedAgent: agent, getAppState: store.getState, setAppState: store.setState }
    const task = tasks.registerAsyncAgent(registration)
    const entered = gate(), release = gate()
    const lifecycle = runAsyncAgentLifecycle({
      taskId: id, abortController: task.abortController!,
      makeStream: async function* () { yield createAssistantMessage({ content: 'old result' }) },
      metadata: { prompt: 'test', resolvedAgentModel: 'test-model', isBuiltInAgent: false, startTime: Date.now(), agentType: 'test-worker', isAsync: true },
      description: 'test', toolUseContext: context, rootSetAppState: store.setState,
      agentIdForCleanup: id, enableSummarization: false,
      getWorktreeResult: async () => { entered.resolve(); await release.promise; return {} },
    })
    try {
      await entered.promise
      expect(store.getState().tasks[id]?.status).toBe('completed')
      expect(() => tasks.registerAsyncAgent(registration)).toThrow(/finishing|active|cleanup/)
      // A terminal task can be evicted while its cleanup is still pending.
      store.setState(s => ({ ...s, tasks: {} }))
      expect(() => tasks.registerAsyncAgent(registration)).toThrow(/finishing|active|cleanup/)
    } finally {
      release.resolve()
      await lifecycle
    }
    const next = tasks.registerAsyncAgent(registration)
    expect(next.notified).toBe(false)
    await runAsyncAgentLifecycle({
      taskId: id, abortController: next.abortController!,
      makeStream: async function* () { yield createAssistantMessage({ content: 'new result' }) },
      metadata: { prompt: 'test', resolvedAgentModel: 'test-model', isBuiltInAgent: false, startTime: Date.now(), agentType: 'test-worker', isAsync: true },
      description: 'test', toolUseContext: context, rootSetAppState: store.setState,
      agentIdForCleanup: id, enableSummarization: false, getWorktreeResult: async () => ({}),
    })
    expect(store.getState().tasks[id]).toMatchObject({ status: 'completed', notified: true })
  })
})

describe('agent setup rollback', () => {
  function params(agent: any, context: any) {
    return { agentDefinition: agent, promptMessages: [], toolUseContext: context, canUseTool: undefined as never, isAsync: true, querySource: 'agent:custom', availableTools: [], override: { agentId: 'setup-failure', systemPrompt: ['test'], userContext: {}, systemContext: {} } } as any
  }

  test('clears registered hooks when skill discovery throws', async () => {
    const { store, agent, context } = fixture()
    const definition = { ...agent, hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'echo test' }] }] }, skills: ['bad-skill'] }
    let registered = false
    spyOn(commands, 'getSkillToolCommands').mockImplementation((async () => {
      registered = store.getState().sessionHooks.has('setup-failure')
      throw new Error('skill failed')
    }) as any)
    await expect(agentRunner.runAgent(params(definition, context)).next()).rejects.toThrow('skill failed')
    expect(registered).toBe(true)
    expect(store.getState().sessionHooks.has('setup-failure')).toBe(false)
  })

  test('cleans partial inline MCP clients but not inherited clients when setup fails', async () => {
    const { agent, context } = fixture()
    const cleanupInline = mock(async () => {}), cleanupShared = mock(async () => {})
    spyOn(mcpConfig, 'getMcpConfigByName').mockReturnValue({ type: 'stdio', command: 'unused' } as any)
    spyOn(mcp, 'connectToServer').mockImplementation((async (name: string) => ({ type: 'connected', name, cleanup: name === 'shared' ? cleanupShared : cleanupInline })) as any)
    spyOn(mcp, 'fetchToolsForClient').mockImplementation((async (client: any) => {
      if (client.name === 'inline') throw new Error('MCP tools failed')
      return []
    }) as any)
    await expect(agentRunner.runAgent(params({ ...agent, mcpServers: ['shared', { inline: { type: 'stdio', command: 'unused' } }] }, context)).next()).rejects.toThrow('MCP tools failed')
    expect(cleanupInline).toHaveBeenCalledTimes(1)
    expect(cleanupShared).not.toHaveBeenCalled()
  })

  test('killing a wedged run releases its id after the grace period', () => {
    const { store, agent } = fixture()
    const id = 'agent-lifecycle-kill-release'
    const registration: any = { agentId: id, description: 'test', prompt: 'test', selectedAgent: agent, getAppState: store.getState, setAppState: store.setState }
    tasks.registerAsyncAgent(registration)

    // No run ever calls finishAgentRun here — that is the wedged case. Capture
    // the grace timer instead of waiting a real minute for it.
    let fireGrace: (() => void) | undefined
    const realSetTimeout = globalThis.setTimeout
    const timer = spyOn(globalThis, 'setTimeout').mockImplementation(((fn: any, ms: any, ...args: any[]) => {
      if (ms === 60_000) {
        fireGrace = () => fn(...args)
        return { unref() {} } as any
      }
      return (realSetTimeout as any)(fn, ms, ...args)
    }) as any)
    try {
      tasks.killAsyncAgent(id, store.setState)
    } finally {
      timer.mockRestore()
    }

    expect(store.getState().tasks[id]?.status).toBe('killed')
    // Still owned: the run may legitimately still be unwinding its cleanup.
    expect(() => tasks.registerAsyncAgent(registration)).toThrow(/finishing|active|cleanup/)
    expect(fireGrace).toBeDefined()

    fireGrace!()

    // Grace elapsed — the id is reusable even though the run never released it.
    expect(tasks.registerAsyncAgent(registration).agentId).toBe(id)
    tasks.finishAgentRun(id)
  })
})
