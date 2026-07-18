import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import type { Message } from '../../../types/message.js'

// End-to-end coverage for the reactive-compact HAPPY PATH.
//
// The sibling reactiveCompact.test.ts only reaches the guard early-returns, so
// the recovery itself — delegating to compactConversation and returning a
// result for the loop to retry with — never ran. These tests stub only
// compactConversation and drive the real path through.

type CompactCall = {
  messages: Message[]
  suppressFollowUps: unknown
  customInstructions: unknown
  isAutoCompact: unknown
}

let compactCalls: CompactCall[] = []
let compactShouldThrow: Error | null = null

// A stand-in for compactConversation's return value. These tests assert on
// identity (the exact object is handed back to the caller), not on its
// contents, so a minimal shape cast to the real type is enough.
const FAKE_RESULT = {
  messagesAfterCompacting: [],
  summaryMessages: [],
  boundaryMarker: undefined,
  attachments: [],
  hookResults: [],
} as unknown as import('../../../services/compact/compact.js').CompactionResult

const actualCompact = await import('../../../services/compact/compact.js')

mock.module('../../../services/compact/compact.js', () => ({
  ...actualCompact,
  compactConversation: async (
    messages: Message[],
    _context: unknown,
    _cacheSafeParams: unknown,
    suppressFollowUps: unknown,
    customInstructions: unknown,
    isAutoCompact: unknown,
  ) => {
    compactCalls.push({
      messages,
      suppressFollowUps,
      customInstructions,
      isAutoCompact,
    })
    if (compactShouldThrow) throw compactShouldThrow
    return FAKE_RESULT
  },
}))

const { reactiveCompactOnPromptTooLong, tryReactiveCompact } = await import(
  '../../../services/compact/reactiveCompact.js'
)

const ENV_KEY = 'NOA_CLAUDE_REACTIVE_COMPACT'
const originalEnv = process.env[ENV_KEY]

let counter = 0
/** Distinct message.id per call → each becomes its own API-round group. */
function asst(text: string): Message {
  counter += 1
  const id = `msg-${counter}`
  return {
    type: 'assistant',
    id,
    uuid: id,
    message: {
      id,
      role: 'assistant',
      content: [{ type: 'text', text }],
    },
  } as unknown as Message
}

/** Two distinct assistant ids → 2 groups, clearing MIN_GROUPS_TO_COMPACT. */
function compactableMessages(): Message[] {
  return [asst('first round'), asst('second round')]
}

function ctx() {
  return {
    toolUseContext: {
      abortController: new AbortController(),
      options: {},
    },
  } as never
}

beforeEach(() => {
  process.env[ENV_KEY] = '1'
  compactCalls = []
  compactShouldThrow = null
})

afterEach(() => {
  if (originalEnv === undefined) delete process.env[ENV_KEY]
  else process.env[ENV_KEY] = originalEnv
})

describe('tryReactiveCompact end-to-end (auto path)', () => {
  test('recovers by compacting and returns a result to retry with', async () => {
    const messages = compactableMessages()
    const result = await tryReactiveCompact({
      hasAttempted: false,
      querySource: 'repl_main_thread',
      aborted: false,
      messages,
      cacheSafeParams: ctx(),
    })

    expect(result).toBe(FAKE_RESULT)
    expect(compactCalls).toHaveLength(1)
    // The auto path suppresses follow-up questions and flags itself as auto.
    expect(compactCalls[0]!.suppressFollowUps).toBe(true)
    expect(compactCalls[0]!.isAutoCompact).toBe(true)
    // No custom instructions are invented on the auto path.
    expect(compactCalls[0]!.customInstructions).toBeUndefined()
  })

  test('a failing compaction surfaces the original error instead of throwing', async () => {
    compactShouldThrow = new Error('compaction blew up')
    const result = await tryReactiveCompact({
      hasAttempted: false,
      querySource: 'repl_main_thread',
      aborted: false,
      messages: compactableMessages(),
      cacheSafeParams: ctx(),
    })

    // null = "I could not help, show the user the real error" — never a throw,
    // which would escape into the query loop.
    expect(result).toBeNull()
    expect(compactCalls).toHaveLength(1)
  })

  test('the single-shot guard prevents a second attempt in the same turn', async () => {
    const messages = compactableMessages()
    await tryReactiveCompact({
      hasAttempted: false,
      querySource: 'repl_main_thread',
      aborted: false,
      messages,
      cacheSafeParams: ctx(),
    })
    await tryReactiveCompact({
      hasAttempted: true, // query.ts flips this after the first attempt
      querySource: 'repl_main_thread',
      aborted: false,
      messages,
      cacheSafeParams: ctx(),
    })

    expect(compactCalls).toHaveLength(1)
  })
})

describe('reactiveCompactOnPromptTooLong end-to-end (manual path)', () => {
  test('returns ok with the compaction result', async () => {
    const outcome = await reactiveCompactOnPromptTooLong(
      compactableMessages(),
      ctx(),
      { customInstructions: 'focus on the bug', trigger: 'manual' },
    )

    expect(outcome).toEqual({ ok: true, result: FAKE_RESULT })
    expect(compactCalls).toHaveLength(1)
    // The manual trigger forwards the user's instructions and keeps follow-ups.
    expect(compactCalls[0]!.customInstructions).toBe('focus on the bug')
    expect(compactCalls[0]!.suppressFollowUps).toBe(false)
    expect(compactCalls[0]!.isAutoCompact).toBe(false)
  })

  test('reports a failure reason rather than throwing', async () => {
    compactShouldThrow = new Error('compaction blew up')
    const outcome = await reactiveCompactOnPromptTooLong(
      compactableMessages(),
      ctx(),
      { customInstructions: undefined, trigger: 'manual' },
    )

    expect(outcome).toEqual({ ok: false, reason: 'error' })
  })
})
