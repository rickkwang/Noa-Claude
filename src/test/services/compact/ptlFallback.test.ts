import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { PROMPT_TOO_LONG_ERROR_MESSAGE } from '../../../services/api/errors.js'
import type { AssistantMessage, Message } from '../../../types/message.js'

// The PTL fallback paths can only be exercised by driving a real compaction,
// which means faking the one API call it makes. mock.module is process-wide, so
// these live in their own file rather than compact.test.ts.

type ForkCall = {
  promptMessages: unknown[]
  forkContextMessages: Message[] | undefined
}

const forkCalls: ForkCall[] = []
// Replies runForkedAgent hands back, consumed in order. Anything past the end
// is a summary, so an unexpected extra retry can't hang the test.
let forkReplies: Array<'ptl' | 'api-ptl' | string> = []
let streamingReplies: Array<'ptl' | string> = []

// Deliberately NOT isApiErrorMessage: streamCompactSummary's cache-sharing
// path refuses to return flagged messages, so this is the shape the retry loop
// actually sees from it. Consequence: getPromptTooLongTokenGap can't parse a
// gap here, so the retries exercise the halving fallback. The gap-guided
// arithmetic is unit-covered in compact.test.ts.
function ptlMessage(isApiErrorMessage = false): AssistantMessage {
  return {
    type: 'assistant',
    id: 'ptl',
    uuid: 'ptl',
    message: {
      id: 'ptl',
      role: 'assistant',
      model: 'test-model',
      content: [{ type: 'text', text: PROMPT_TOO_LONG_ERROR_MESSAGE }],
      usage: { input_tokens: 0, output_tokens: 0 },
    },
    ...(isApiErrorMessage
      ? {
          isApiErrorMessage: true,
          errorDetails: 'prompt is too long: 200600 tokens > 200000',
        }
      : {}),
  } as unknown as AssistantMessage
}

function summaryMessage(text: string): AssistantMessage {
  return {
    type: 'assistant',
    id: 'sum',
    uuid: 'sum',
    message: {
      id: 'sum',
      role: 'assistant',
      model: 'test-model',
      content: [{ type: 'text', text }],
      usage: { input_tokens: 10, output_tokens: 10 },
    },
  } as unknown as AssistantMessage
}

const forkedAgent = await import('../../../utils/forkedAgent.js')
mock.module('../../../utils/forkedAgent.js', () => ({
  ...forkedAgent,
  runForkedAgent: async (params: {
    promptMessages: unknown[]
    cacheSafeParams?: { forkContextMessages?: Message[] }
  }) => {
    forkCalls.push({
      promptMessages: params.promptMessages,
      forkContextMessages: params.cacheSafeParams?.forkContextMessages,
    })
    const reply = forkReplies[forkCalls.length - 1] ?? 'a summary'
    return {
      messages: [
        reply === 'ptl'
          ? ptlMessage()
          : reply === 'api-ptl'
            ? ptlMessage(true)
            : summaryMessage(reply),
      ],
      totalUsage: {
        input_tokens: 10,
        output_tokens: 10,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    }
  },
}))

const claudeApi = await import('../../../services/api/claude.js')
mock.module('../../../services/api/claude.js', () => ({
  ...claudeApi,
  queryModelWithStreaming: async function* () {
    const reply = streamingReplies.shift() ?? 'a streaming summary'
    yield reply === 'ptl' ? ptlMessage(true) : summaryMessage(reply)
  },
}))

const hooks = await import('../../../utils/hooks.js')
mock.module('../../../utils/hooks.js', () => ({
  ...hooks,
  executePreCompactHooks: async () => {
    preCompactHookRuns++
    return { userDisplayMessage: 'pre-compact hook said this' }
  },
  executePostCompactHooks: async () => ({}),
}))
let preCompactHookRuns = 0

const sessionStart = await import('../../../utils/sessionStart.js')
mock.module('../../../utils/sessionStart.js', () => ({
  ...sessionStart,
  processSessionStartHooks: async () => [],
}))

const sessionStorage = await import('../../../utils/sessionStorage.js')
mock.module('../../../utils/sessionStorage.js', () => ({
  ...sessionStorage,
  getTranscriptPath: () => '/tmp/noa-ptl-test-transcript.jsonl',
  reAppendSessionMetadata: () => {},
}))

// Query suffix, not a plain import: other suites in this directory replace
// compact.js in the module registry with stubbed compactConversation /
// partialCompactConversation, and whichever file runs first wins. This asks
// for a fresh instance of the real module, which still picks up the mocks
// above. Held in a variable because tsc can't resolve a suffixed specifier.
const REAL_COMPACT_MODULE =
  '../../../services/compact/compact.js?ptl-fallback-real'
const { compactConversation, partialCompactConversation, PTL_RETRY_MARKER } =
  (await import(REAL_COMPACT_MODULE)) as typeof import('../../../services/compact/compact.js')

// ~250 rough tokens each, so a 40-turn conversation is comfortably larger than
// the 100k gap the fake PTL response reports.
function makeTurns(count: number): Message[] {
  return Array.from({ length: count }, (_, i) => {
    const uuid = `turn-${i}`
    return {
      type: 'assistant',
      id: uuid,
      uuid,
      message: {
        id: uuid,
        role: 'assistant',
        model: 'test-model',
        content: [{ type: 'text', text: 'x'.repeat(1000) }],
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    } as unknown as Message
  })
}

function makeContext() {
  return {
    abortController: new AbortController(),
    agentId: 'test-agent',
    options: {
      mainLoopModel: 'claude-sonnet-4-5',
      querySource: 'compact',
      tools: [],
      mcpClients: [],
      agentDefinitions: { activeAgents: [] },
    },
    getAppState: () => ({
      tasks: {},
      mcp: { clients: [], tools: [], commands: [], resources: {} },
      toolPermissionContext: { mode: 'default' },
    }),
    readFileState: new Map(),
    loadedNestedMemoryPaths: new Set<string>(),
    onCompactProgress: () => {},
    setStreamMode: () => {},
    setResponseLength: () => {},
    setSDKStatus: () => {},
    addNotification: () => {},
  } as never
}

function requestSizes(): number[] {
  return forkCalls.map(c => c.forkContextMessages?.length ?? -1)
}

beforeEach(() => {
  forkCalls.length = 0
  forkReplies = []
  streamingReplies = []
  preCompactHookRuns = 0
})

describe('partial compaction slides the boundary on prompt-too-long', () => {
  test('retries with a smaller summarized prefix instead of dropping messages', async () => {
    forkReplies = ['ptl', 'summary text']
    const messages = makeTurns(40)

    const result = await partialCompactConversation(
      messages,
      30,
      makeContext(),
      {} as never,
      undefined,
      'up_to',
      { trigger: 'auto', ownsLifecycle: false },
    )

    expect(forkCalls.length).toBe(2)
    const [first, second] = requestSizes()
    // First request is the original prefix; the retry must be strictly smaller.
    expect(first).toBe(30)
    expect(second!).toBeLessThan(first!)
    expect(second!).toBeGreaterThan(0)

    // Nothing was deleted: what left the summarized half joined the kept half.
    expect(result.messagesToKeep!.length).toBe(messages.length - second!)
    const requestTexts = JSON.stringify(forkCalls[1])
    expect(requestTexts).not.toContain(PTL_RETRY_MARKER)
  })

  test('the summary reports the slid count, not the original pivot', async () => {
    forkReplies = ['ptl', 'summary text']

    const result = await partialCompactConversation(
      makeTurns(40),
      30,
      makeContext(),
      {} as never,
      undefined,
      'up_to',
      { trigger: 'auto', ownsLifecycle: false },
    )

    expect(
      result.boundaryMarker!.compactMetadata!.messagesSummarized,
    ).toBe(requestSizes()[1])
  })

  test('spends the whole retry budget sliding and never drops a message', async () => {
    // Every attempt overflows. 'up_to' can always find a smaller boundary, so
    // head truncation stays unreached and the run fails without deleting
    // anything — the caller surfaces the error with the conversation intact.
    forkReplies = ['ptl', 'ptl', 'ptl', 'ptl']

    await expect(
      partialCompactConversation(
        makeTurns(40),
        30,
        makeContext(),
        {} as never,
        undefined,
        'up_to',
        { trigger: 'auto', ownsLifecycle: false },
      ),
    ).rejects.toThrow()

    // Budget is MAX_PTL_RETRIES (3) retries on top of the first attempt.
    expect(forkCalls.length).toBe(4)
    const sizes = requestSizes()
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]!).toBeLessThan(sizes[i - 1]!)
    }
    expect(forkCalls.some(c => JSON.stringify(c).includes(PTL_RETRY_MARKER))).toBe(
      false,
    )
  })

  test('direction "from" cannot slide and goes straight to truncation', async () => {
    forkReplies = ['ptl', 'summary text']

    await partialCompactConversation(
      makeTurns(40),
      10,
      makeContext(),
      {} as never,
      undefined,
      'from',
      { trigger: 'auto', ownsLifecycle: false },
    )

    expect(forkCalls.length).toBe(2)
    expect(JSON.stringify(forkCalls[1])).toContain(PTL_RETRY_MARKER)
  })
})

describe('full compaction falls back to partial on prompt-too-long', () => {
  test('handles a real API-error PTL after cache-sharing falls back to streaming', async () => {
    forkReplies = ['api-ptl', 'summary text']
    streamingReplies = ['ptl']

    const result = await compactConversation(
      makeTurns(40),
      makeContext(),
      {} as never,
      false,
      undefined,
      true,
    )

    expect(forkCalls.length).toBe(2)
    expect(streamingReplies).toEqual([])
    expect(result.messagesToKeep!.length).toBeGreaterThan(0)
  })

  test('summarizes a prefix and keeps the tail instead of dropping rounds', async () => {
    forkReplies = ['ptl', 'summary text']
    const messages = makeTurns(40)

    const result = await compactConversation(
      messages,
      makeContext(),
      {} as never,
      false,
      undefined,
      true,
    )

    expect(forkCalls.length).toBe(2)
    // Full compaction summarizes everything and keeps nothing; a non-empty
    // kept tail proves the retry went through partialCompactConversation.
    expect(result.messagesToKeep!.length).toBeGreaterThan(0)
    expect(JSON.stringify(forkCalls[1])).not.toContain(PTL_RETRY_MARKER)
  })

  test('does not re-run pre-compact hooks when it delegates', async () => {
    forkReplies = ['ptl', 'summary text']

    const result = await compactConversation(
      makeTurns(40),
      makeContext(),
      {} as never,
      false,
      undefined,
      true,
    )

    // Guard against passing for the wrong reason: without delegation the count
    // is also 1, so assert the delegation actually happened.
    expect(result.messagesToKeep!.length).toBeGreaterThan(0)
    expect(preCompactHookRuns).toBe(1)
  })

  test('still surfaces the pre-compact hook display message', async () => {
    forkReplies = ['ptl', 'summary text']

    const result = await compactConversation(
      makeTurns(40),
      makeContext(),
      {} as never,
      false,
      undefined,
      true,
    )

    // The direct path merges pre- and post-compact hook messages; taking the
    // fallback must not silently drop the pre-compact one.
    expect(result.userDisplayMessage).toContain('pre-compact hook said this')
  })
})
