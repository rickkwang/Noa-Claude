import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import type { Message } from '../../../types/message.js'

// End-to-end coverage for the precompute HAPPY PATH.
//
// The sibling precomputedCompact.test.ts covers the guards by injecting state
// directly, which means the actual background summarization (computeSummary ->
// streamCompactSummary -> status 'ready') never runs. These tests drive the
// real arm -> compute -> ready -> consume sequence with only the summary API
// call itself stubbed, so the wiring is exercised rather than asserted.

let summaryCalls: Array<{ messages: Message[]; forkContextMessages: unknown }> =
  []
let summaryText = '<summary>precomputed summary</summary>'
let summaryShouldThrow = false
let summaryIsApiError = false

// Keep the real module intact and override only the summary API call —
// compact.ts has many other exports the import graph depends on.
const actualCompact = await import('../../../services/compact/compact.js')

mock.module('../../../services/compact/compact.js', () => ({
  ...actualCompact,
  streamCompactSummary: async (params: {
    messages: Message[]
    cacheSafeParams: { forkContextMessages?: unknown }
  }) => {
    summaryCalls.push({
      messages: params.messages,
      forkContextMessages: params.cacheSafeParams?.forkContextMessages,
    })
    if (summaryShouldThrow) throw new Error('summary API exploded')
    return {
      type: 'assistant',
      uuid: 'summary-msg',
      isApiErrorMessage: summaryIsApiError,
      message: {
        id: 'summary-msg',
        role: 'assistant',
        content: [{ type: 'text', text: summaryText }],
      },
    }
  },
}))

const {
  __getArmedForTest,
  __resetForTest,
  armPrecompute,
  consumePrecompute,
} = await import('../../../services/compact/precomputedCompact.js')

const ENV_KEY = 'NOA_CLAUDE_PRECOMPUTE_COMPACT'
const originalEnv = process.env[ENV_KEY]
const BIG_TAIL_BUDGET = 10_000_000

let counter = 0
function asst(chars: number): Message {
  counter += 1
  const id = `00000000-0000-0000-0000-${String(counter).padStart(12, '0')}`
  return {
    type: 'assistant',
    id,
    uuid: id,
    message: {
      id,
      role: 'assistant',
      content: [{ type: 'text', text: 'x'.repeat(chars) }],
    },
  } as unknown as Message
}

function liveContext() {
  return {
    abortController: new AbortController(),
    getAppState: () => ({}),
    options: {},
  } as never
}

/** Wait for the detached background compute to settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const armed = __getArmedForTest()
    if (!armed || armed.status !== 'computing') return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('background precompute never settled')
}

beforeEach(() => {
  process.env[ENV_KEY] = '1'
  summaryCalls = []
  summaryText = '<summary>precomputed summary</summary>'
  summaryShouldThrow = false
  summaryIsApiError = false
  __resetForTest()
})

afterEach(() => {
  if (originalEnv === undefined) delete process.env[ENV_KEY]
  else process.env[ENV_KEY] = originalEnv
  __resetForTest()
})

describe('precompute end-to-end (arm -> compute -> ready -> consume)', () => {
  test('arms, summarizes in the background, and the summary is consumable', async () => {
    const messages = [asst(10), asst(10), asst(10)]

    armPrecompute({
      messages,
      context: liveContext(),
      cacheSafeParams: {} as never,
      maxTailTokens: BIG_TAIL_BUDGET,
    })

    // Armed immediately, still computing — the main loop is never blocked.
    expect(__getArmedForTest()?.status).toBe('computing')

    await settle()
    expect(__getArmedForTest()?.status).toBe('ready')

    // The summary request covered the whole armed set, and forkContextMessages
    // matches it (the 'up_to' contract partialCompactConversation relies on).
    expect(summaryCalls).toHaveLength(1)
    expect(summaryCalls[0]!.messages).toHaveLength(3)
    expect(summaryCalls[0]!.forkContextMessages).toHaveLength(3)

    const out = consumePrecompute({ messages, maxTailTokens: BIG_TAIL_BUDGET })
    expect(out).toEqual({
      pivotIndex: 3,
      summaryText: '<summary>precomputed summary</summary>',
    })
    expect(__getArmedForTest()).toBeNull()
  })

  test('a tail appended while computing is still consumable (the real race)', async () => {
    const messages = [asst(10), asst(10)]
    armPrecompute({
      messages,
      context: liveContext(),
      cacheSafeParams: {} as never,
      maxTailTokens: BIG_TAIL_BUDGET,
    })
    await settle()

    // The turn kept producing messages while the summary was being computed.
    const grown = [...messages, asst(10), asst(10)]
    const out = consumePrecompute({
      messages: grown,
      maxTailTokens: BIG_TAIL_BUDGET,
    })

    // Pivot stays at the armed boundary; the 2 new messages survive verbatim.
    expect(out).toEqual({
      pivotIndex: 2,
      summaryText: '<summary>precomputed summary</summary>',
    })
  })

  test('a failed summary call leaves nothing consumable (falls back to sync)', async () => {
    summaryShouldThrow = true
    const messages = [asst(10), asst(10)]
    armPrecompute({
      messages,
      context: liveContext(),
      cacheSafeParams: {} as never,
      maxTailTokens: BIG_TAIL_BUDGET,
    })
    await settle()

    expect(__getArmedForTest()?.status).toBe('error')
    expect(
      consumePrecompute({ messages, maxTailTokens: BIG_TAIL_BUDGET }),
    ).toBeNull()
  })

  test('an API-error summary response is not consumed as a summary', async () => {
    summaryIsApiError = true
    const messages = [asst(10), asst(10)]
    armPrecompute({
      messages,
      context: liveContext(),
      cacheSafeParams: {} as never,
      maxTailTokens: BIG_TAIL_BUDGET,
    })
    await settle()

    expect(__getArmedForTest()?.status).toBe('error')
    expect(
      consumePrecompute({ messages, maxTailTokens: BIG_TAIL_BUDGET }),
    ).toBeNull()
  })

  test('aborting the session cancels the background compute', async () => {
    const context = liveContext() as unknown as {
      abortController: AbortController
    }
    const messages = [asst(10), asst(10)]
    armPrecompute({
      messages,
      context: context as never,
      cacheSafeParams: {} as never,
      maxTailTokens: BIG_TAIL_BUDGET,
    })
    context.abortController.abort()
    await settle()

    // Whatever the compute returned, an aborted session must not leave a
    // consumable summary behind.
    expect(
      consumePrecompute({ messages, maxTailTokens: BIG_TAIL_BUDGET }),
    ).toBeNull()
  })

  test('a foreign message set can never consume the owner’s summary', async () => {
    // Stands in for a subagent compacting its own context while the main
    // thread has a summary armed: uuids differ, so the slot must not be used.
    const owner = [asst(10), asst(10)]
    armPrecompute({
      messages: owner,
      context: liveContext(),
      cacheSafeParams: {} as never,
      maxTailTokens: BIG_TAIL_BUDGET,
    })
    await settle()
    expect(__getArmedForTest()?.status).toBe('ready')

    const foreign = [asst(10), asst(10)]
    expect(
      consumePrecompute({
        messages: foreign,
        maxTailTokens: BIG_TAIL_BUDGET,
      }),
    ).toBeNull()
  })

  test('re-arming on an unchanged prefix does not spend a second API call', async () => {
    const messages = [asst(10), asst(10)]
    const context = liveContext()
    armPrecompute({
      messages,
      context,
      cacheSafeParams: {} as never,
      maxTailTokens: BIG_TAIL_BUDGET,
    })
    await settle()
    expect(summaryCalls).toHaveLength(1)

    // Same prefix, tail still within budget → the armed summary stands.
    armPrecompute({
      messages: [...messages, asst(10)],
      context,
      cacheSafeParams: {} as never,
      maxTailTokens: BIG_TAIL_BUDGET,
    })
    await settle()
    expect(summaryCalls).toHaveLength(1)
  })
})
