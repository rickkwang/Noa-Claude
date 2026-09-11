import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { FallbackTriggeredError } from '../../../services/api/withRetry.js'
import type { AssistantMessage, Message } from '../../../types/message.js'

// Drives streamCompactSummary with both API paths faked. mock.module is
// process-wide, so this lives in its own file.

function assistant(text: string, isApiErrorMessage = false): AssistantMessage {
  return {
    type: 'assistant',
    uuid: `a-${text}`,
    message: {
      id: `a-${text}`,
      role: 'assistant',
      model: 'test-model',
      content: [{ type: 'text', text }],
      usage: { input_tokens: 1, output_tokens: 1 },
    },
    ...(isApiErrorMessage ? { isApiErrorMessage: true } : {}),
  } as unknown as AssistantMessage
}

const forkFallbacks: Array<string | undefined> = []
const streamingModels: Array<{ model: string; fallbackModel?: string }> = []
let overloadFirstStreamingCall = true

const forkedAgent = await import('../../../utils/forkedAgent.js')
mock.module('../../../utils/forkedAgent.js', () => ({
  ...forkedAgent,
  // The cache-sharing fork fails, forcing the direct streaming path.
  runForkedAgent: async (params: { fallbackModel?: string }) => {
    forkFallbacks.push(params.fallbackModel)
    return {
      messages: [assistant('API Error: overloaded', true)],
      totalUsage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    }
  },
}))

const claudeApi = await import('../../../services/api/claude.js')
mock.module('../../../services/api/claude.js', () => ({
  ...claudeApi,
  queryModelWithStreaming: async function* (params: {
    options: { model: string; fallbackModel?: string }
  }) {
    streamingModels.push({
      model: params.options.model,
      fallbackModel: params.options.fallbackModel,
    })
    if (overloadFirstStreamingCall && streamingModels.length === 1) {
      // Mirrors withRetry: only a request carrying a fallback model can
      // trigger the switch; without one the overload surfaces as-is.
      if (params.options.fallbackModel) {
        throw new FallbackTriggeredError(
          params.options.model,
          params.options.fallbackModel,
        )
      }
      throw new Error('Repeated 529 Overloaded errors')
    }
    yield assistant(`summary from ${params.options.model}`)
  },
}))

const REAL_COMPACT_MODULE =
  '../../../services/compact/compact.js?fallback-model-real'
const { streamCompactSummary } = (await import(
  REAL_COMPACT_MODULE
)) as typeof import('../../../services/compact/compact.js')

function context(fallbackModel: string | undefined) {
  return {
    abortController: new AbortController(),
    options: {
      mainLoopModel: 'claude-opus-4-8',
      fallbackModel,
      tools: [],
      mcpClients: [],
      agentDefinitions: { activeAgents: [] },
      isNonInteractiveSession: true,
    },
    getAppState: () => ({ toolPermissionContext: { mode: 'default' } }),
    setStreamMode: () => {},
    setResponseLength: () => {},
  } as never
}

async function summarize(fallbackModel: string | undefined) {
  return streamCompactSummary({
    messages: [] as Message[],
    summaryRequest: {
      type: 'user',
      uuid: 'req',
      message: { role: 'user', content: 'summarize' },
    } as never,
    appState: { toolPermissionContext: { mode: 'default' } } as never,
    context: context(fallbackModel),
    preCompactTokenCount: 100,
    cacheSafeParams: {} as never,
  })
}

beforeEach(() => {
  forkFallbacks.length = 0
  streamingModels.length = 0
  overloadFirstStreamingCall = true
})

describe('compaction on an overloaded model', () => {
  test('retries the summary on --fallback-model', async () => {
    const response = await summarize('claude-sonnet-4-6')

    expect(forkFallbacks).toEqual(['claude-sonnet-4-6'])
    expect(streamingModels).toEqual([
      { model: 'claude-opus-4-8', fallbackModel: 'claude-sonnet-4-6' },
      { model: 'claude-sonnet-4-6', fallbackModel: undefined },
    ])
    expect(JSON.stringify(response)).toContain('summary from claude-sonnet-4-6')
  })

  test('does not offer the main model as its own fallback', async () => {
    overloadFirstStreamingCall = false
    await summarize('claude-opus-4-8')

    expect(forkFallbacks).toEqual([undefined])
    expect(streamingModels).toEqual([
      { model: 'claude-opus-4-8', fallbackModel: undefined },
    ])
  })

  test('without a fallback model the overload error propagates', async () => {
    await expect(summarize(undefined)).rejects.toThrow(
      'Repeated 529 Overloaded errors',
    )
    expect(streamingModels).toHaveLength(1)
  })
})
