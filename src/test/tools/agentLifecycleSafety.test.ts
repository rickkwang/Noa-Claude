import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { AgentTool } from '../../tools/AgentTool/AgentTool.js'
import * as agentRunner from '../../tools/AgentTool/runAgent.js'
import { runAsyncAgentLifecycle } from '../../tools/AgentTool/agentToolUtils.js'
import * as tasks from '../../tasks/LocalAgentTask/LocalAgentTask.js'
import * as commands from '../../commands.js'
import * as mcp from '../../services/mcp/client.js'
import * as mcpConfig from '../../services/mcp/config.js'
import * as prompts from '../../constants/prompts.js'
import * as worktrees from '../../utils/worktree.js'
import * as sessionStorage from '../../utils/sessionStorage.js'
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
    const connect = spyOn(mcp, 'connectToServer').mockImplementation((async (name: string, config: any) => ({ type: 'connected', name, config, cleanup: name === 'shared' ? cleanupShared : cleanupInline })) as any)
    Object.assign(connect, { cache: new Map() })
    spyOn(mcp, 'fetchToolsForClient').mockImplementation((async (client: any) => {
      if (client.name === 'inline') throw new Error('MCP tools failed')
      return []
    }) as any)
    await expect(agentRunner.runAgent(params({ ...agent, mcpServers: ['shared', { inline: { type: 'stdio', command: 'unused' } }] }, context)).next()).rejects.toThrow('MCP tools failed')
    expect(cleanupInline).toHaveBeenCalledTimes(1)
    expect(cleanupShared).not.toHaveBeenCalled()
  })

  test('killing a wedged run keeps its id until the run exits', () => {
    const { store, agent } = fixture()
    const id = 'agent-lifecycle-kill-release'
    const registration: any = { agentId: id, description: 'test', prompt: 'test', selectedAgent: agent, getAppState: store.getState, setAppState: store.setState }
    tasks.registerAsyncAgent(registration)

    // No run ever calls finishAgentRun here — that is the wedged case.
    tasks.killAsyncAgent(id, store.setState)

    expect(store.getState().tasks[id]?.status).toBe('killed')
    // Still owned: the run may legitimately still be unwinding its cleanup.
    expect(() => tasks.registerAsyncAgent(registration)).toThrow(/finishing|active|cleanup/)
    tasks.finishAgentRun(id, tasks.getAgentRunToken(id))
    expect(tasks.registerAsyncAgent(registration).agentId).toBe(id)
    tasks.finishAgentRun(id, tasks.getAgentRunToken(id))
  })

  test('a duplicate release does not release a re-registered run', () => {
    const { store, agent } = fixture()
    const id = 'agent-lifecycle-stale-release'
    const registration: any = { agentId: id, description: 'test', prompt: 'test', selectedAgent: agent, getAppState: store.getState, setAppState: store.setState }
    tasks.registerAsyncAgent(registration)
    const oldToken = tasks.getAgentRunToken(id)

    tasks.killAsyncAgent(id, store.setState)
    tasks.finishAgentRun(id, oldToken)
    expect(tasks.registerAsyncAgent(registration).agentId).toBe(id)
    tasks.finishAgentRun(id, oldToken)
    expect(() => tasks.registerAsyncAgent(registration)).toThrow(/finishing|active|cleanup/)
    tasks.finishAgentRun(id, tasks.getAgentRunToken(id))
  })

  test('background lifecycle bounds a wedged worktree cleanup', async () => {
    const { store, agent, context } = fixture()
    const id = 'agent-lifecycle-worktree-cap'
    const registration: any = { agentId: id, description: 'test', prompt: 'test', selectedAgent: agent, getAppState: store.getState, setAppState: store.setState }
    const task = tasks.registerAsyncAgent(registration)
    const cleanup = gate()

    // Fire the 30s cleanup cap immediately instead of waiting real time.
    const realSetTimeout = globalThis.setTimeout
    const timer = spyOn(globalThis, 'setTimeout').mockImplementation(((fn: any, ms: any, ...args: any[]) => {
      if (ms === 30_000) return (realSetTimeout as any)(fn, 0, ...args)
      return (realSetTimeout as any)(fn, ms, ...args)
    }) as any)
    try {
      await runAsyncAgentLifecycle({
        taskId: id, abortController: task.abortController!,
        makeStream: async function* () { yield createAssistantMessage({ content: 'done' }) },
        metadata: { prompt: 'test', resolvedAgentModel: 'test-model', isBuiltInAgent: false, startTime: Date.now(), agentType: 'test-worker', isAsync: true },
        description: 'test', toolUseContext: context, rootSetAppState: store.setState,
        agentIdForCleanup: id, enableSummarization: false,
        getWorktreeResult: async () => { await cleanup.promise; return {} },
      })
    } finally {
      timer.mockRestore()
    }

    expect(store.getState().tasks[id]?.status).toBe('completed')
    expect(() => tasks.registerAsyncAgent(registration)).toThrow(/finishing|active|cleanup/)
    cleanup.resolve()
    await Bun.sleep(0)
    expect(tasks.registerAsyncAgent(registration).agentId).toBe(id)
    tasks.finishAgentRun(id, tasks.getAgentRunToken(id))
  })

  test('one inline MCP user exiting does not close another user connection', async () => {
    const { agent, context } = fixture()
    const cleanup = mock(async () => {})
    const config = { type: 'stdio', command: 'unused', scope: 'dynamic' }
    const client = { type: 'connected', name: 'inline', config, cleanup }
    const bothConnected = gate(), releaseFirst = gate(), releaseSecond = gate()
    let calls = 0
    const cacheKey = mcp.getServerCacheKey(client.name, config as any)
    const connection = Promise.resolve(client)
    const cache = new Map([[cacheKey, connection]])
    const connect = spyOn(mcp, 'connectToServer').mockReturnValue(connection as any)
    Object.assign(connect, { cache })
    spyOn(mcp, 'fetchToolsForClient').mockImplementation((async () => {
      const index = ++calls
      if (index === 2) bothConnected.resolve()
      await (index === 1 ? releaseFirst : releaseSecond).promise
      throw new Error('setup ended')
    }) as any)
    const definition = { ...agent, mcpServers: [{ inline: { type: 'stdio', command: 'unused' } }] }
    const start = (id: string) => {
      const options = params(definition, context)
      options.override.agentId = id
      return agentRunner.runAgent(options).next().catch(error => error)
    }
    const first = start('mcp-owner-first'), second = start('mcp-owner-second')
    try {
      await bothConnected.promise
      releaseFirst.resolve()
      expect(await first).toBeInstanceOf(Error)
      expect(cleanup).not.toHaveBeenCalled()
      expect(cache.has(cacheKey)).toBe(true)
    } finally {
      releaseFirst.resolve()
      releaseSecond.resolve()
      await Promise.all([first, second])
    }
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(cache.has(cacheKey)).toBe(false)
  })

  test.each([false, true])('AgentTool keeps ownership during late worktree cleanup (background=%s)', async background => {
    const { store, agent, context } = fixture()
    const cleanup = gate(), entered = gate(), notified = gate()
    const metadataStarted = gate(), metadataDone = gate()
    spyOn(sessionStorage, 'writeAgentMetadata').mockImplementation(async () => {
      metadataStarted.resolve()
      await metadataDone.promise
    })
    const remove = spyOn(worktrees, 'removeAgentWorktree').mockResolvedValue(true)
    spyOn(worktrees, 'createAgentWorktree').mockResolvedValue({ worktreePath: '/tmp/test-agent-worktree', headCommit: 'test-head', gitRoot: '/tmp' } as any)
    spyOn(worktrees, 'hasWorktreeChanges').mockImplementation(async () => {
      entered.resolve()
      await cleanup.promise
      return false
    })
    spyOn(prompts, 'enhanceSystemPromptWithEnvDetails').mockResolvedValue(['test'])
    let id!: string
    spyOn(agentRunner, 'runAgent').mockImplementation((async function* (params: any) {
      id = params.override.agentId
      yield createAssistantMessage({ content: 'done' })
    }) as any)
    const unsubscribe = store.subscribe(() => {
      if (Object.values(store.getState().tasks).some(t => t.notified)) notified.resolve()
    })
    const realSetTimeout = globalThis.setTimeout
    const timer = spyOn(globalThis, 'setTimeout').mockImplementation(((fn: any, ms: any, ...args: any[]) =>
      (realSetTimeout as any)(fn, ms === 30_000 ? 0 : ms, ...args)) as any)
    const call = AgentTool.call({ prompt: 'test', description: 'test', subagent_type: 'test-worker', isolation: 'worktree', run_in_background: background }, context, undefined as never, createAssistantMessage({ content: 'spawn' }))
    try {
      await entered.promise
      const result = await call
      if (background) await notified.promise
      const registration: any = { agentId: id, description: 'resume', prompt: 'resume', selectedAgent: agent, getAppState: store.getState, setAppState: store.setState }
      expect(result.data.status).toBe(background ? 'async_launched' : 'completed')
      expect(() => tasks.registerAsyncAgent(registration)).toThrow(/finishing|active|cleanup/)
      expect(remove).not.toHaveBeenCalled()
      cleanup.resolve()
      await metadataStarted.promise
      expect(remove).toHaveBeenCalledTimes(1)
      expect(() => tasks.registerAsyncAgent(registration)).toThrow(/finishing|active|cleanup/)
      metadataDone.resolve()
      await Bun.sleep(0)
      expect(tasks.registerAsyncAgent(registration).agentId).toBe(id)
      tasks.finishAgentRun(id, tasks.getAgentRunToken(id))
    } finally {
      cleanup.resolve()
      metadataDone.resolve()
      timer.mockRestore()
      unsubscribe()
      await call
    }
  })
})
