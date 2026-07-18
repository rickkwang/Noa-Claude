import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import type { Message } from '../../../types/message.js'

// Wiring test for autoCompactIfNeeded's precompute-consume branch — the code
// that connects consumePrecompute to partialCompactConversation. The module
// tests cover precomputedCompact in isolation; this covers the branch in
// autoCompact.ts that decides WHEN the slot is touched and what gets passed
// through, with only the compaction/API layer stubbed.

let partialCalls: Array<{
  pivotIndex: number
  direction: unknown
  opts: { precomputedSummary?: string } & Record<string, unknown>
}> = []
let fullCalls = 0
let smCalls = 0

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
  beginCompactLifecycle: () => {},
  endCompactLifecycle: () => {},
  partialCompactConversation: async (
    _messages: Message[],
    pivotIndex: number,
    _ctx: unknown,
    _cacheSafe: unknown,
    _feedback: unknown,
    direction: unknown,
    opts: { precomputedSummary?: string } & Record<string, unknown>,
  ) => {
    partialCalls.push({ pivotIndex, direction, opts })
    return FAKE_RESULT
  },
  compactConversation: async () => {
    fullCalls++
    return FAKE_RESULT
  },
}))

const actualHooks = await import('../../../utils/hooks.js')
mock.module('../../../utils/hooks.js', () => ({
  ...actualHooks,
  executePreCompactHooks: async () => ({
    newCustomInstructions: undefined,
    userDisplayMessage: undefined,
  }),
}))

const actualSM = await import(
  '../../../services/compact/sessionMemoryCompact.js'
)
mock.module('../../../services/compact/sessionMemoryCompact.js', () => ({
  ...actualSM,
  trySessionMemoryCompaction: async () => {
    smCalls++
    return null
  },
}))

const { autoCompactIfNeeded } = await import(
  '../../../services/compact/autoCompact.js'
)
const { __getArmedForTest, __resetForTest, __setReadyForTest } = await import(
  '../../../services/compact/precomputedCompact.js'
)

const ENV_KEYS = [
  'NOA_CLAUDE_PRECOMPUTE_COMPACT',
  'CLAUDE_CODE_AUTO_COMPACT_WINDOW',
  'DISABLE_COMPACT',
  'DISABLE_AUTO_COMPACT',
  'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE',
] as const
const originalEnv = Object.fromEntries(
  ENV_KEYS.map(k => [k, process.env[k]]),
)

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

function uid(m: Message | undefined): string {
  return String(m?.uuid)
}

function ctx() {
  return {
    options: { mainLoopModel: 'test-model' },
    abortController: new AbortController(),
    getAppState: () => ({}),
  } as never
}

// Two large messages push the estimated count past the (shrunken) threshold;
// the small third keeps the post-arm tail inside the consume budget.
function overThresholdMessages(): Message[] {
  return [asst(40_000), asst(40_000), asst(100)]
}

/** Arm a ready summary whose pivot covers the first two messages. */
function armReadyAt2(messages: Message[]): void {
  __setReadyForTest({
    pivotCount: 2,
    tailUuid: uid(messages[1]),
    summaryText: 'PRECOMPUTED',
  })
}

beforeEach(() => {
  process.env.NOA_CLAUDE_PRECOMPUTE_COMPACT = '1'
  // Shrink the window so the synthetic messages sit above the auto-compact
  // threshold: effective = max(40000 - 20000, 13000) = 20000, threshold = 7000.
  process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = '40000'
  delete process.env.DISABLE_COMPACT
  delete process.env.DISABLE_AUTO_COMPACT
  delete process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE
  partialCalls = []
  fullCalls = 0
  smCalls = 0
  __resetForTest()
})

afterEach(() => {
  for (const [k, v] of Object.entries(originalEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  __resetForTest()
})

describe('autoCompactIfNeeded consume branch', () => {
  test('a ready summary is consumed via partial up_to and skips SM + full', async () => {
    const messages = overThresholdMessages()
    armReadyAt2(messages)

    const result = await autoCompactIfNeeded(
      messages,
      ctx(),
      {} as never,
      'repl_main_thread',
    )

    expect(result.wasCompacted).toBe(true)
    expect(result.compactionResult).toBe(FAKE_RESULT)
    expect(result.consecutiveFailures).toBe(0)

    // The armed pivot and summary flowed through to the partial call.
    expect(partialCalls).toHaveLength(1)
    expect(partialCalls[0]!.pivotIndex).toBe(2)
    expect(partialCalls[0]!.direction).toBe('up_to')
    expect(partialCalls[0]!.opts.precomputedSummary).toBe('PRECOMPUTED')
    expect(partialCalls[0]!.opts.trigger).toBe('auto')
    expect(partialCalls[0]!.opts.ownsLifecycle).toBe(false)

    // Consume short-circuits the slower paths entirely.
    expect(smCalls).toBe(0)
    expect(fullCalls).toBe(0)

    // The slot is spent.
    expect(__getArmedForTest()).toBeNull()
  })

  test('a subagent compaction leaves the owner’s slot untouched', async () => {
    const messages = overThresholdMessages()
    armReadyAt2(messages)

    const result = await autoCompactIfNeeded(
      messages,
      ctx(),
      {} as never,
      'agent:custom',
    )

    // The subagent still compacts (via the normal fallback paths)…
    expect(result.wasCompacted).toBe(true)
    expect(
      partialCalls.every(c => c.opts?.precomputedSummary === undefined),
    ).toBe(true)
    // …but the main thread's armed summary survives for its own use.
    expect(__getArmedForTest()?.status).toBe('ready')
  })

  test('a recompaction chain skips consume and the post-compact cleanup drops the stale slot', async () => {
    const messages = overThresholdMessages()
    armReadyAt2(messages)

    const result = await autoCompactIfNeeded(
      messages,
      ctx(),
      {} as never,
      'repl_main_thread',
      // compacted:true = a compact already happened in this chain and
      // under-relieved; forcing a fresh compact beats a tail-keeping partial.
      { compacted: true, turnCounter: 1, turnId: 't1' },
    )

    expect(result.wasCompacted).toBe(true)
    expect(
      partialCalls.every(c => c.opts?.precomputedSummary === undefined),
    ).toBe(true)
    // Lifecycle fix: after a real main-thread compaction the armed summary
    // refers to history that no longer exists — cleanup must discard it.
    expect(__getArmedForTest()).toBeNull()
  })

  test('disabled precompute never touches the slot even when armed', async () => {
    const messages = overThresholdMessages()
    armReadyAt2(messages)
    delete process.env.NOA_CLAUDE_PRECOMPUTE_COMPACT

    const result = await autoCompactIfNeeded(
      messages,
      ctx(),
      {} as never,
      'repl_main_thread',
    )

    expect(result.wasCompacted).toBe(true)
    expect(
      partialCalls.every(c => c.opts?.precomputedSummary === undefined),
    ).toBe(true)
  })

  test('below threshold nothing compacts and nothing is consumed', async () => {
    // Generous window → threshold far above these messages.
    process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = '900000'
    const messages = [asst(100), asst(100)]
    armReadyAt2(messages)

    const result = await autoCompactIfNeeded(
      messages,
      ctx(),
      {} as never,
      'repl_main_thread',
    )

    expect(result.wasCompacted).toBe(false)
    expect(partialCalls).toHaveLength(0)
    expect(fullCalls).toBe(0)
  })
})
