import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import type { AssistantMessage, Message } from '../../../types/message.js'

// End-to-end coverage for the reactive-compact recovery itself: choosing
// between keep-tail and full compaction, stripping media, and owning the
// compact lifecycle. compactConversation / partialCompactConversation and the
// pre-compact hooks are stubbed; everything in reactiveCompact.ts runs for real.

type CompactCall =
  | {
      kind: 'full'
      messages: Message[]
      suppressFollowUps: unknown
      customInstructions: unknown
      isAutoCompact: unknown
      forkContextMessages: Message[] | undefined
    }
  | {
      kind: 'partial'
      messages: Message[]
      pivot: number
      direction: unknown
      opts: Record<string, unknown>
      forkContextMessages: Message[] | undefined
    }

let compactCalls: CompactCall[] = []
let compactShouldThrow: Error | null = null
let lifecycle: string[] = []

const FAKE_RESULT = {
  summaryMessages: [],
  boundaryMarker: undefined,
  attachments: [],
  hookResults: [],
} as unknown as import('../../../services/compact/compact.js').CompactionResult

const actualCompact = await import('../../../services/compact/compact.js')
mock.module('../../../services/compact/compact.js', () => ({
  ...actualCompact,
  beginCompactLifecycle: () => {
    lifecycle.push('begin')
  },
  endCompactLifecycle: () => {
    lifecycle.push('end')
  },
  compactConversation: async (
    messages: Message[],
    _context: unknown,
    cacheSafeParams: { forkContextMessages?: Message[] },
    suppressFollowUps: unknown,
    customInstructions: unknown,
    isAutoCompact: unknown,
  ) => {
    compactCalls.push({
      kind: 'full',
      messages,
      suppressFollowUps,
      customInstructions,
      isAutoCompact,
      forkContextMessages: cacheSafeParams.forkContextMessages,
    })
    if (compactShouldThrow) throw compactShouldThrow
    return FAKE_RESULT
  },
  partialCompactConversation: async (
    messages: Message[],
    pivot: number,
    _context: unknown,
    cacheSafeParams: { forkContextMessages?: Message[] },
    _feedback: unknown,
    direction: unknown,
    opts: Record<string, unknown>,
  ) => {
    compactCalls.push({
      kind: 'partial',
      messages,
      pivot,
      direction,
      opts,
      forkContextMessages: cacheSafeParams.forkContextMessages,
    })
    if (compactShouldThrow) throw compactShouldThrow
    return FAKE_RESULT
  },
}))

let preCompactBlockedBy: string | undefined

const hooks = await import('../../../utils/hooks.js')
mock.module('../../../utils/hooks.js', () => ({
  ...hooks,
  executePreCompactHooks: async () => ({
    userDisplayMessage: 'hook ran',
    blockedBy: preCompactBlockedBy,
  }),
}))

// Suffixed so this is a fresh instance of the real module that resolves the
// mocks above, even if another suite already loaded or replaced
// reactiveCompact.js in the shared registry.
const REAL_REACTIVE_MODULE =
  '../../../services/compact/reactiveCompact.js?reactive-e2e-real'
const { tryReactiveCompact } = (await import(
  REAL_REACTIVE_MODULE
)) as typeof import('../../../services/compact/reactiveCompact.js')

const ENV_KEYS = [
  'NOA_CLAUDE_REACTIVE_COMPACT',
  'DISABLE_AUTO_COMPACT',
  'DISABLE_COMPACT',
] as const
const originalEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]))

let counter = 0
function asst(text: string): Message {
  counter += 1
  const id = `msg-${counter}`
  return {
    type: 'assistant',
    uuid: id,
    message: { id, role: 'assistant', content: [{ type: 'text', text }] },
  } as unknown as Message
}
function user(content: unknown): Message {
  counter += 1
  return {
    type: 'user',
    uuid: `user-${counter}`,
    message: { role: 'user', content },
  } as unknown as Message
}

/** Three small API rounds ending in the user's latest request. */
function smallConversation(): Message[] {
  return [
    user('first request'),
    asst('first round'),
    user('second request'),
    asst('second round'),
    user('latest request'),
  ]
}

function ctx() {
  return {
    toolUseContext: {
      abortController: new AbortController(),
      options: { mainLoopModel: 'test-model' },
      onCompactProgress: () => {},
    },
  } as never
}

function ptlError(details?: string): AssistantMessage {
  return {
    type: 'assistant',
    uuid: 'ptl',
    isApiErrorMessage: true,
    errorDetails: details,
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'Prompt is too long' }],
    },
  } as unknown as AssistantMessage
}

function run(
  messages: Message[],
  error?: AssistantMessage,
  hasAttempted = false,
) {
  return tryReactiveCompact({
    hasAttempted,
    querySource: 'repl_main_thread',
    aborted: false,
    messages,
    cacheSafeParams: ctx(),
    error,
  })
}

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k]
  compactCalls = []
  compactShouldThrow = null
  lifecycle = []
  preCompactBlockedBy = undefined
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (originalEnv[k] === undefined) delete process.env[k]
    else process.env[k] = originalEnv[k]
  }
})

describe('tryReactiveCompact end-to-end', () => {
  test('keeps the recent rounds verbatim and summarizes the older prefix', async () => {
    const messages = smallConversation()
    const result = await run(messages, ptlError())

    expect(result).toBe(FAKE_RESULT)
    expect(compactCalls).toHaveLength(1)
    const call = compactCalls[0]!
    expect(call.kind).toBe('partial')
    if (call.kind !== 'partial') return
    expect(call.direction).toBe('up_to')
    expect(call.pivot).toBeGreaterThan(0)
    // The latest request is in the kept tail, not paraphrased by the summary.
    expect(messages.slice(call.pivot).at(-1)).toBe(messages.at(-1))
    expect(call.opts.trigger).toBe('auto')
    expect(call.opts.suppressFollowUpQuestions).toBe(true)
    expect(call.opts.ownsLifecycle).toBe(false)
    expect(call.opts.preCompactHookResult).toEqual({
      userDisplayMessage: 'hook ran',
    })
    expect(lifecycle).toEqual(['begin', 'end'])
  })

  test('summarizes everything when the latest round is too big to keep', async () => {
    const messages = [
      ...smallConversation(),
      asst('reads a huge file'),
      user([
        { type: 'tool_result', tool_use_id: 't1', content: 'x'.repeat(400_000) },
      ]),
    ]
    await run(messages, ptlError())

    expect(compactCalls.map(c => c.kind)).toEqual(['full'])
    const call = compactCalls[0]!
    if (call.kind !== 'full') return
    expect(call.suppressFollowUps).toBe(true)
    expect(call.isAutoCompact).toBe(true)
    expect(call.customInstructions).toBeUndefined()
  })

  test('a known overflow no tail can shed goes straight to a full summary', async () => {
    await run(
      smallConversation(),
      ptlError('prompt is too long: 350000 tokens > 200000 maximum'),
    )

    expect(compactCalls.map(c => c.kind)).toEqual(['full'])
  })

  test('media errors strip media from both the summary request and the kept tail', async () => {
    const image = {
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
    }
    const messages = [
      ...smallConversation(),
      asst('looks at a screenshot'),
      user([{ type: 'text', text: 'see this' }, image]),
    ]
    const mediaError = {
      type: 'assistant',
      uuid: 'media',
      isApiErrorMessage: true,
      errorDetails: 'image exceeds 5 MB maximum: 6291456 bytes > 5242880 bytes',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'API Error' }],
      },
    } as unknown as AssistantMessage

    await run(messages, mediaError)

    const call = compactCalls[0]!
    expect(JSON.stringify(call.messages)).not.toContain('"type":"image"')
    expect(JSON.stringify(call.messages)).toContain('[image]')
    expect(call.forkContextMessages).toBe(call.messages)
  })

  test('a failing compaction surfaces the original error and still ends the lifecycle', async () => {
    compactShouldThrow = new Error('compaction blew up')
    const result = await run(smallConversation(), ptlError())

    expect(result).toBeNull()
    expect(compactCalls).toHaveLength(1)
    expect(lifecycle).toEqual(['begin', 'end'])
  })

  test('the single-shot guard prevents a second attempt in the same turn', async () => {
    const messages = smallConversation()
    await run(messages, ptlError())
    await run(messages, ptlError(), true)

    expect(compactCalls).toHaveLength(1)
  })

  test('a PreCompact hook veto leaves the overflow error to surface', async () => {
    preCompactBlockedBy = '[guard.sh]: not right now'
    const result = await run(smallConversation(), ptlError())

    expect(result).toBeNull()
    expect(compactCalls).toEqual([])
    // The lifecycle still closes — the spinner must not be left running.
    expect(lifecycle).toEqual(['begin', 'end'])
  })

  test('forked summarizers and background side-task forks never compact', async () => {
    for (const querySource of [
      'compact',
      'session_memory',
      'agent_summary',
      'away_summary',
      'prompt_suggestion',
      'speculation',
    ] as const) {
      const result = await tryReactiveCompact({
        hasAttempted: false,
        querySource,
        aborted: false,
        messages: smallConversation(),
        cacheSafeParams: ctx(),
        error: ptlError(),
      })
      expect(result).toBeNull()
    }
    expect(compactCalls).toHaveLength(0)
    expect(lifecycle).toEqual([])
  })
})
