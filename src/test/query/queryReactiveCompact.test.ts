import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import type { ToolUseContext } from '../../Tool.js'
import type { QueryDeps } from '../../query/deps.js'
import type { Terminal } from '../../query/transitions.js'
import { PROMPT_TOO_LONG_ERROR_MESSAGE } from '../../services/api/errors.js'
import type { Message } from '../../types/message.js'
import {
  createAssistantAPIErrorMessage,
  createAssistantMessage,
  createCompactBoundaryMessage,
  createUserMessage,
} from '../../utils/messages.js'
import { asSystemPrompt } from '../../utils/systemPromptType.js'

// Loop-level wiring for reactive compaction: a prompt-too-long from the main
// query is withheld, compacted, and retried. The summary call itself is faked
// (compactConversation is covered in services/compact); everything else is the
// real query loop. mock.module is process-wide, so this has its own file.

// When set, the fake interrupts the turn mid-compaction with this abort reason.
let abortDuringCompaction: string | undefined

const reactiveCalls: Array<{
  hasAttempted: boolean
  querySource: string
  errorText: string
}> = []

const reactive = await import('../../services/compact/reactiveCompact.js')
mock.module('../../services/compact/reactiveCompact.js', () => ({
  ...reactive,
  tryReactiveCompact: async (params: {
    hasAttempted: boolean
    querySource: string
    error?: Message
    cacheSafeParams: { toolUseContext: ToolUseContext }
  }) => {
    reactiveCalls.push({
      hasAttempted: params.hasAttempted,
      querySource: params.querySource,
      errorText: JSON.stringify(params.error?.message),
    })
    if (abortDuringCompaction !== undefined) {
      // Compaction reports an abort as "no result", as the real one does.
      params.cacheSafeParams.toolUseContext.abortController.abort(
        abortDuringCompaction,
      )
      return null
    }
    if (!reactive.isReactiveCompactEnabled() || params.hasAttempted) {
      return null
    }
    return {
      boundaryMarker: createCompactBoundaryMessage('auto', 250_000),
      summaryMessages: [
        createUserMessage({ content: 'Summary: compacted', isCompactSummary: true }),
      ],
      attachments: [],
      hookResults: [],
    }
  },
}))

const { query } = await import('../../query.js')

const ENV_KEYS = [
  'NOA_CLAUDE_REACTIVE_COMPACT',
  'DISABLE_AUTO_COMPACT',
  'DISABLE_COMPACT',
] as const
const originalEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]))

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k]
  reactiveCalls.length = 0
  abortDuringCompaction = undefined
})
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (originalEnv[k] === undefined) delete process.env[k]
    else process.env[k] = originalEnv[k]
  }
})

function createContext(): ToolUseContext {
  const appState = {
    toolPermissionContext: { mode: 'default' },
    agentDefinitions: { activeAgents: [], allAgents: [], allowedAgentTypes: [] },
    sessionHooks: new Map(),
    mcp: { tools: [], clients: [] },
    fastMode: false,
  }
  return {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'main-model',
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
      appState as unknown as ReturnType<ToolUseContext['getAppState']>,
    setAppState: () => {},
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
    messages: [],
  } as ToolUseContext
}

function promptTooLong() {
  return createAssistantAPIErrorMessage({
    content: `${PROMPT_TOO_LONG_ERROR_MESSAGE}: 250000 tokens > 200000 maximum`,
    error: 'invalid_request',
  })
}

// A proactive compaction that ran just before the model call, reporting the
// rapid-refill streak it leaves behind.
function proactiveCompactionWithStreak(consecutiveRapidRefills: number) {
  let ran = false
  return async () => {
    if (ran) return { wasCompacted: false }
    ran = true
    return {
      wasCompacted: true,
      consecutiveRapidRefills,
      compactionResult: {
        boundaryMarker: createCompactBoundaryMessage('auto', 180_000),
        summaryMessages: [
          createUserMessage({ content: 'Summary: proactive', isCompactSummary: true }),
        ],
        attachments: [],
        hookResults: [],
      },
    }
  }
}

async function drain(
  callModel: QueryDeps['callModel'],
  autocompact: QueryDeps['autocompact'] = async () => ({ wasCompacted: false }),
): Promise<{ events: Message[]; terminal: Terminal }> {
  let uuidCounter = 0
  const gen = query({
    messages: [
      createUserMessage({ content: 'first' }),
      createAssistantMessage({ content: 'a reply' }),
      createUserMessage({ content: 'second' }),
    ],
    systemPrompt: asSystemPrompt([]),
    userContext: {},
    systemContext: {},
    canUseTool: async (_tool, input) => ({ behavior: 'allow', updatedInput: input }),
    toolUseContext: createContext(),
    querySource: 'repl_main_thread',
    deps: {
      uuid: () =>
        `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, '0')}`,
      microcompact: async messages => ({ messages }),
      autocompact,
      callModel,
    } as Partial<QueryDeps>,
  })
  const events: Message[] = []
  let result = await gen.next()
  while (!result.done) {
    events.push(result.value as Message)
    result = await gen.next()
  }
  return { events, terminal: result.value }
}

const isPtl = (e: Message) =>
  e.type === 'assistant' &&
  e.isApiErrorMessage === true &&
  JSON.stringify(e.message?.content).includes(PROMPT_TOO_LONG_ERROR_MESSAGE)

describe('query loop: reactive compaction', () => {
  test('withholds prompt-too-long, compacts, and retries on the summary', async () => {
    const seen: Message[][] = []
    const { events, terminal } = await drain(async function* ({ messages }) {
      seen.push(messages)
      if (seen.length === 1) {
        yield promptTooLong()
        return
      }
      yield createAssistantMessage({ content: 'recovered' })
    })

    expect(reactiveCalls.map(c => [c.hasAttempted, c.querySource])).toEqual([
      [false, 'repl_main_thread'],
    ])
    // The withheld error is handed over so recovery can size the kept tail.
    expect(reactiveCalls[0]!.errorText).toContain('250000 tokens > 200000')
    expect(events.some(isPtl)).toBe(false)
    expect(JSON.stringify(seen[1])).toContain('Summary: compacted')
    expect(JSON.stringify(events.at(-1))).toContain('recovered')
    expect(terminal).toEqual({ reason: 'completed' })
  })

  test('a second overflow after compacting surfaces the error exactly once', async () => {
    const { events, terminal } = await drain(async function* () {
      yield promptTooLong()
    })

    expect(reactiveCalls.map(c => c.hasAttempted)).toEqual([false, true])
    expect(events.filter(isPtl)).toHaveLength(1)
    expect(terminal).toEqual({ reason: 'prompt_too_long' })
  })

  test('with recovery turned off the error surfaces once and the turn ends', async () => {
    process.env.NOA_CLAUDE_REACTIVE_COMPACT = '0'
    const { events, terminal } = await drain(async function* () {
      yield promptTooLong()
    })

    expect(events.filter(isPtl)).toHaveLength(1)
    expect(terminal).toEqual({ reason: 'prompt_too_long' })
  })

  test('recovery counts as a compaction for the rapid-refill breaker', async () => {
    // The proactive compact that just ran was already the third refill in a
    // row; overflowing straight after it trips the breaker instead of
    // compacting yet again.
    const { events, terminal } = await drain(
      async function* () {
        yield promptTooLong()
      },
      proactiveCompactionWithStreak(2) as never,
    )

    expect(reactiveCalls).toHaveLength(0)
    expect(events.some(isPtl)).toBe(false)
    expect(JSON.stringify(events.at(-1))).toContain('Autocompact is thrashing')
    expect(terminal).toEqual({ reason: 'rapid_refill_breaker' })
  })

  test('a short refill streak still recovers', async () => {
    let calls = 0
    const { terminal } = await drain(
      async function* () {
        calls += 1
        if (calls === 1) {
          yield promptTooLong()
          return
        }
        yield createAssistantMessage({ content: 'recovered' })
      },
      proactiveCompactionWithStreak(0) as never,
    )

    expect(reactiveCalls).toHaveLength(1)
    expect(terminal).toEqual({ reason: 'completed' })
  })

  test('Esc during recovery ends the turn as an interrupt, not an overflow error', async () => {
    abortDuringCompaction = 'user-cancel'
    const { events, terminal } = await drain(async function* () {
      yield promptTooLong()
    })

    expect(reactiveCalls).toHaveLength(1)
    expect(events.some(isPtl)).toBe(false)
    expect(JSON.stringify(events.at(-1))).toContain('[Request interrupted by user]')
    expect(terminal).toEqual({ reason: 'aborted_streaming' })
  })

  test('a submit-interrupt during recovery ends quietly for the queued message', async () => {
    abortDuringCompaction = 'interrupt'
    const { events, terminal } = await drain(async function* () {
      yield promptTooLong()
    })

    expect(events.some(isPtl)).toBe(false)
    expect(JSON.stringify(events)).not.toContain('[Request interrupted by user]')
    expect(terminal).toEqual({ reason: 'aborted_streaming' })
  })
})
