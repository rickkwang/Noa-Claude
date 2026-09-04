import { afterEach, expect, mock, spyOn, test } from 'bun:test'
import '../../tools/AgentTool/AgentTool.js'
import { runAgent } from '../../tools/AgentTool/runAgent.js'
import * as queryModule from '../../query.js'
import * as sessionStorage from '../../utils/sessionStorage.js'
import { getDefaultAppState } from '../../state/AppStateStore.js'
import { createStore } from '../../state/store.js'
import { createFileStateCacheWithSizeLimit } from '../../utils/fileStateCache.js'
import { TaskCreateTool } from '../../tools/TaskCreateTool/TaskCreateTool.js'
import { runToolUse } from '../../services/tools/toolExecution.js'
import { createAssistantMessage } from '../../utils/messages.js'
import { z } from 'zod'

afterEach(() => mock.restore())

test('a foreground iterator adopts the full background context without reinitialization', async () => {
  const store = createStore(getDefaultAppState())
  const id = 'background-context-test'
  store.setState(s => ({ ...s, tasks: { [id]: { id, type: 'local_agent', status: 'running', isBackgrounded: false } as any } }))
  const context: any = {
    getAppState: store.getState, setAppState: store.setState,
    options: { mainLoopModel: 'test-model', tools: [TaskCreateTool], mcpClients: [], isNonInteractiveSession: false },
    abortController: new AbortController(), messages: [],
    readFileState: createFileStateCacheWithSizeLimit(10),
  }
  let checks = 0
  const createTask = spyOn(TaskCreateTool, 'call')
  spyOn(sessionStorage, 'recordSidechainTranscript').mockResolvedValue(undefined)
  spyOn(sessionStorage, 'writeAgentMetadata').mockResolvedValue(undefined)
  spyOn(queryModule, 'query').mockImplementation((async function* (params: any) {
    const getPermissions = () => params.toolUseContext.getAppState().toolPermissionContext
    expect(getPermissions().shouldAvoidPermissionPrompts).not.toBe(true)
    store.setState(s => ({ ...s, tasks: { [id]: { ...s.tasks[id]!, isBackgrounded: true } as any } }))
    expect(getPermissions().shouldAvoidPermissionPrompts).toBe(true)
    expect(store.getState().toolPermissionContext.shouldAvoidPermissionPrompts).not.toBe(true)
    const original = params.toolUseContext
    const refreshed = original.refreshRuntimeContext?.(original) ?? original
    expect(refreshed.options.tools).not.toContain(TaskCreateTool)
    expect(refreshed.options.isNonInteractiveSession).toBe(true)
    expect(refreshed.localDenialTracking).toEqual({ consecutiveDenials: 0, totalDenials: 0 })
    const previous = store.getState()
    refreshed.setAppState((s: any) => ({ ...s, expandedView: 'tasks' }))
    expect(store.getState()).toBe(previous)
    original.setAppState((s: any) => ({ ...s, expandedView: 'tasks' }))
    expect(store.getState()).toBe(previous)
    refreshed.setAppStateForTasks((s: any) => ({ ...s, expandedView: 'tasks' }))
    expect(store.getState().expandedView).toBe('tasks')
    // Even an old model response queued before handoff must use the new policy.
    const block = { type: 'tool_use', id: 'queued-task', name: TaskCreateTool.name, input: { subject: 'test', description: 'test' } }
    const results = []
    for await (const update of runToolUse(block as any, createAssistantMessage({ content: [block] } as any), undefined as never, original)) results.push(update)
    expect(results.length).toBeGreaterThan(0)
    expect(createTask).not.toHaveBeenCalled()
    checks++
  }) as any)
  for await (const _ of runAgent({
    agentDefinition: { agentType: 'test', source: 'custom', tools: ['*'], getSystemPrompt: () => 'test' },
    promptMessages: [], toolUseContext: context, canUseTool: undefined,
    isAsync: false, availableTools: [TaskCreateTool], querySource: 'agent:custom',
    override: { agentId: id, systemPrompt: ['test'], userContext: {}, systemContext: {} },
  } as any)) {}
  expect(checks).toBe(1)
})

test('the live query refreshes model schemas and tool contexts after handoff', async () => {
  const store = createStore(getDefaultAppState())
  const id = 'background-live-query'
  store.setState(s => ({ ...s, tasks: { [id]: { id, type: 'local_agent', status: 'running', isBackgrounded: false } as any } }))
  let toolCalls = 0
  const readTool: any = {
    name: 'Read', inputSchema: z.object({}), maxResultSizeChars: 1000,
    isReadOnly: () => true, isConcurrencySafe: () => true, isEnabled: () => true,
    description: async () => 'test', prompt: async () => '', userFacingName: () => 'Read',
    checkPermissions: async () => ({ behavior: 'allow' }), toAutoClassifierInput: () => '',
    renderToolUseMessage: () => null,
    call: async (_input: any, context: any) => {
      toolCalls++
      expect(context.options.isNonInteractiveSession).toBe(true)
      expect(context.localDenialTracking).toBeDefined()
      const previous = store.getState()
      context.setAppState((s: any) => ({ ...s, expandedView: 'tasks' }))
      expect(store.getState()).toBe(previous)
      return { data: { output: 'ok' } }
    },
    mapToolResultToToolResultBlockParam: (data: any, toolUseId: string) => ({ type: 'tool_result', tool_use_id: toolUseId, content: data.output }),
  }
  const context: any = {
    getAppState: store.getState, setAppState: store.setState,
    options: {
      mainLoopModel: 'test-model', tools: [readTool, TaskCreateTool], mcpClients: [],
      mcpResources: {}, agentDefinitions: { activeAgents: [], allAgents: [] },
      thinkingConfig: { type: 'disabled' }, isNonInteractiveSession: false,
    },
    abortController: new AbortController(), messages: [],
    readFileState: createFileStateCacheWithSizeLimit(10),
    setResponseLength: () => {}, setInProgressToolUseIDs: () => {},
    updateFileHistoryState: () => {}, updateAttributionState: () => {},
  }
  let modelCalls = 0
  const realQuery = queryModule.query
  spyOn(sessionStorage, 'recordSidechainTranscript').mockResolvedValue(undefined)
  spyOn(sessionStorage, 'writeAgentMetadata').mockResolvedValue(undefined)
  spyOn(queryModule, 'query').mockImplementation((params: any) => realQuery({
    ...params,
    deps: {
      callModel: async function* (request: any) {
        modelCalls++
        if (modelCalls === 1) {
          expect(request.tools.map((t: any) => t.name)).toContain('TaskCreate')
          store.setState(s => ({ ...s, tasks: { [id]: { ...s.tasks[id]!, isBackgrounded: true } as any } }))
          yield createAssistantMessage({ content: [{ type: 'tool_use', id: 'read-after-handoff', name: 'Read', input: {} }] })
        } else {
          expect(request.tools.map((t: any) => t.name)).not.toContain('TaskCreate')
          expect(request.options.isNonInteractiveSession).toBe(true)
          yield createAssistantMessage({ content: 'done' })
        }
      },
    },
  }))
  for await (const _ of runAgent({
    agentDefinition: { agentType: 'test', source: 'custom', tools: ['*'], getSystemPrompt: () => 'test' },
    promptMessages: [], toolUseContext: context,
    canUseTool: async (_tool: any, input: any) => ({ behavior: 'allow', updatedInput: input }),
    isAsync: false, availableTools: [readTool, TaskCreateTool], querySource: 'agent:custom',
    override: { agentId: id, systemPrompt: ['test'], userContext: {}, systemContext: {} },
  } as any)) {}
  expect(modelCalls).toBe(2)
  expect(toolCalls).toBe(1)
})
