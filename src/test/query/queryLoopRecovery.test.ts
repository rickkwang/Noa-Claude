import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import type { ToolUseContext } from '../../Tool.js'
import { query } from '../../query.js'
import type { QueryDeps } from '../../query/deps.js'
import type { Terminal } from '../../query/transitions.js'
import { FallbackTriggeredError } from '../../services/api/withRetry.js'
import type { Message } from '../../types/message.js'
import {
  createAssistantAPIErrorMessage,
  createAssistantMessage,
  createUserMessage,
} from '../../utils/messages.js'
import { asSystemPrompt } from '../../utils/systemPromptType.js'

// Loop-level tests for queryLoop's recovery paths, driven through QueryDeps
// injection (same harness as streamingToolExecution.test.ts). Each test
// asserts the externally observable contract: which messages reach the
// consumer, what the model sees on retry, and the Terminal reason.

function createContext(
  tools: ToolUseContext['options']['tools'] = [],
): ToolUseContext {
  const appState = {
    toolPermissionContext: { mode: 'default' },
    agentDefinitions: {
      activeAgents: [],
      allAgents: [],
      allowedAgentTypes: [],
    },
    sessionHooks: new Map(),
    mcp: { tools: [], clients: [] },
    fastMode: false,
    effortValue: undefined,
    advisorModel: undefined,
    goal: undefined,
  }
  return {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'main-model',
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
    getAppState: () => appState as ReturnType<ToolUseContext['getAppState']>,
    setAppState: () => {},
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
    messages: [],
  } as ToolUseContext
}

function makeDeps(
  callModel: QueryDeps['callModel'],
  overrides?: Partial<QueryDeps>,
): Partial<QueryDeps> {
  let uuidCounter = 0
  return {
    uuid: () =>
      `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, '0')}`,
    microcompact: async messages => ({ messages }),
    autocompact: async () => ({ wasCompacted: false }),
    callModel,
    ...overrides,
  } as Partial<QueryDeps>
}

// Drives the generator manually so the Terminal return value is observable —
// production callers use for-await and discard it.
async function drain(params: {
  deps: Partial<QueryDeps>
  toolUseContext?: ToolUseContext
  maxTurns?: number
  fallbackModel?: string
}): Promise<{ events: Message[]; terminal: Terminal }> {
  const gen = query({
    messages: [createUserMessage({ content: 'start' })],
    systemPrompt: asSystemPrompt([]),
    userContext: {},
    systemContext: {},
    canUseTool: async (_tool, input) => ({
      behavior: 'allow',
      updatedInput: input,
    }),
    toolUseContext: params.toolUseContext ?? createContext(),
    querySource: 'repl_main_thread',
    deps: params.deps,
    maxTurns: params.maxTurns,
    fallbackModel: params.fallbackModel,
  })
  const events: Message[] = []
  let result = await gen.next()
  while (!result.done) {
    events.push(result.value as Message)
    result = await gen.next()
  }
  return { events, terminal: result.value }
}

function maxOutputTokensError() {
  return createAssistantAPIErrorMessage({
    content: 'max output tokens reached',
    apiError: 'max_output_tokens',
  })
}

function yieldedMaxOutputTokensErrors(events: Message[]) {
  return events.filter(
    e => e.type === 'assistant' && e.apiError === 'max_output_tokens',
  )
}

describe('query loop recovery', () => {
  test('max_output_tokens: withholds the error, injects a resume prompt, and retries', async () => {
    const callMessages: Message[][] = []
    const deps = makeDeps(async function* ({ messages }) {
      callMessages.push(messages)
      if (callMessages.length === 1) {
        yield maxOutputTokensError()
        return
      }
      yield createAssistantMessage({ content: 'recovered' })
    })

    const { events, terminal } = await drain({ deps })

    expect(callMessages.length).toBe(2)
    // The retry prompt is the last message the model sees on attempt 2.
    const retryPrompt = callMessages[1]!.at(-1)!
    expect(retryPrompt.type).toBe('user')
    expect(String(retryPrompt.message?.content)).toContain(
      'Output token limit hit',
    )
    // The withheld error never reached the consumer.
    expect(yieldedMaxOutputTokensErrors(events)).toHaveLength(0)
    expect(terminal).toEqual({ reason: 'completed' })
  }, 5000)

  test('max_output_tokens: surfaces the error after the recovery limit is exhausted', async () => {
    let calls = 0
    const deps = makeDeps(async function* () {
      calls += 1
      yield maxOutputTokensError()
    })

    const { events, terminal } = await drain({ deps })

    // Initial attempt + MAX_OUTPUT_TOKENS_RECOVERY_LIMIT (3) recoveries.
    expect(calls).toBe(4)
    // Only the final, unrecoverable error surfaces to the consumer.
    expect(yieldedMaxOutputTokensErrors(events)).toHaveLength(1)
    expect(terminal).toEqual({ reason: 'completed' })
  }, 5000)

  test('model fallback: retries on the fallback model without mutating caller options', async () => {
    const observedModels: string[] = []
    const deps = makeDeps(async function* ({ options }) {
      observedModels.push(options.model)
      if (observedModels.length === 1) {
        throw new FallbackTriggeredError('main-model', 'fallback-model')
      }
      yield createAssistantMessage({ content: 'done on fallback' })
    })
    const toolUseContext = createContext()

    const { events, terminal } = await drain({
      deps,
      toolUseContext,
      fallbackModel: 'fallback-model',
    })

    expect(observedModels).toEqual(['main-model', 'fallback-model'])
    const warning = events.find(
      e => e.type === 'system' && String(e.content).includes('Switched to'),
    )
    expect(warning).toBeDefined()
    // e942fd09 regression guard: options is shared by reference with the
    // caller; the fallback switch must copy, not mutate.
    expect(toolUseContext.options.mainLoopModel).toBe('main-model')
    expect(terminal).toEqual({ reason: 'completed' })
  }, 5000)

  test('empty assistant turn: yields a retryable empty_response error instead of silence', async () => {
    const deps = makeDeps(async function* () {
      // Model produced nothing.
    })

    const { events, terminal } = await drain({ deps })

    const errorEvent = events.find(
      e => e.type === 'assistant' && e.isApiErrorMessage,
    )
    expect(errorEvent).toBeDefined()
    expect(errorEvent!.error).toBe('empty_response')
    expect(terminal).toEqual({ reason: 'completed' })
  }, 5000)

  test('stop hook blocking: feeds the error back to the model with stop_hook_active set', async () => {
    const callMessages: Message[][] = []
    const stopHookActiveFlags: Array<boolean | undefined> = []
    let alreadyBlocked = false

    const stopHooks: QueryDeps['stopHooks'] = async function* (
      _messages,
      _assistant,
      _systemPrompt,
      _userContext,
      _systemContext,
      _toolUseContext,
      _querySource,
      stopHookActive,
    ) {
      stopHookActiveFlags.push(stopHookActive)
      if (!alreadyBlocked) {
        alreadyBlocked = true
        return {
          blockingErrors: [
            createUserMessage({
              content: 'Stop hook: lint failed, fix it',
              isMeta: true,
            }),
          ],
          preventContinuation: false,
        }
      }
      return { blockingErrors: [], preventContinuation: false }
    }

    const deps = makeDeps(
      async function* ({ messages }) {
        callMessages.push(messages)
        yield createAssistantMessage({ content: `attempt ${callMessages.length}` })
      },
      { stopHooks },
    )

    const { terminal } = await drain({ deps })

    // Blocking error triggers one re-query with the error appended …
    expect(callMessages.length).toBe(2)
    const feedback = callMessages[1]!.at(-1)!
    expect(String(feedback.message?.content)).toContain('lint failed')
    // … and the second stop-hook round sees stop_hook_active so a
    // misbehaving hook can break the cycle.
    expect(stopHookActiveFlags).toEqual([undefined, true])
    expect(terminal).toEqual({ reason: 'completed' })
  }, 5000)

  test('stop hook preventContinuation: ends the turn with stop_hook_prevented', async () => {
    let modelCalls = 0
    const stopHooks: QueryDeps['stopHooks'] = async function* () {
      return { blockingErrors: [], preventContinuation: true }
    }
    const deps = makeDeps(
      async function* () {
        modelCalls += 1
        yield createAssistantMessage({ content: 'done' })
      },
      { stopHooks },
    )

    const { terminal } = await drain({ deps })

    expect(modelCalls).toBe(1)
    expect(terminal).toEqual({ reason: 'stop_hook_prevented' })
  }, 5000)

  test('maxTurns: stops the tool-use loop with a max_turns terminal and attachment', async () => {
    const inputSchema = z.object({})
    const tool = {
      name: 'LoopTool',
      inputSchema,
      async call() {
        return { data: { output: 'ok' } }
      },
      async description() {
        return 'loop tool'
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
        return 'LoopTool'
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

    let calls = 0
    const deps = makeDeps(async function* () {
      calls += 1
      yield createAssistantMessage({
        content: [
          {
            type: 'tool_use',
            id: `toolu_loop_${calls}`,
            name: 'LoopTool',
            input: {},
          } as ToolUseBlock,
        ],
      })
    })

    const { events, terminal } = await drain({
      deps,
      toolUseContext: createContext([tool]),
      maxTurns: 2,
    })

    expect(calls).toBe(2)
    expect(terminal).toEqual({ reason: 'max_turns', turnCount: 3 })
    const attachment = events.find(
      e =>
        e.type === 'attachment' &&
        e.attachment?.type === 'max_turns_reached',
    )
    expect(attachment).toBeDefined()
  }, 5000)
})
