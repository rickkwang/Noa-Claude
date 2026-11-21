import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  __MAX_ARM_ATTEMPTS_PER_CYCLE,
  __getArmAttemptsForTest,
  __getArmedForTest,
  __resetForTest,
  __setComputingForTest,
  __setReadyForTest,
  armPrecompute,
  consumePrecompute,
  resetPrecomputeCycle,
} from '../../../services/compact/precomputedCompact.js'
import type { Message } from '../../../types/message.js'

const ENV_KEY = 'NOA_CLAUDE_PRECOMPUTE_COMPACT'
const originalEnv = process.env[ENV_KEY]

let counter = 0
function uuid(): string {
  counter += 1
  return `00000000-0000-0000-0000-${String(counter).padStart(12, '0')}`
}

function asst(chars: number): Message {
  const id = uuid()
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

// Read a message uuid as a plain string for the test injectors.
function uid(m: Message | undefined): string {
  return String(m?.uuid)
}

const BIG_TAIL_BUDGET = 10_000_000

beforeEach(() => {
  process.env[ENV_KEY] = '1'
  __resetForTest()
})

afterEach(() => {
  if (originalEnv === undefined) delete process.env[ENV_KEY]
  else process.env[ENV_KEY] = originalEnv
  __resetForTest()
})

describe('consumePrecompute', () => {
  test('returns null while still computing (no blocking wait)', () => {
    const messages = [asst(10), asst(10)]
    __setComputingForTest({ pivotCount: 2, tailUuid: uid(messages[1]) })
    expect(consumePrecompute({ messages, maxTailTokens: BIG_TAIL_BUDGET })).toBeNull()
  })

  test('discards when the armed prefix no longer matches (history rewound)', () => {
    const armedMessages = [asst(10), asst(10)]
    __setReadyForTest({
      pivotCount: 2,
      tailUuid: uid(armedMessages[1]),
      summaryText: 'SUMMARY',
    })
    // Different messages at the pivot position → prefix mismatch.
    const rewound = [asst(10), asst(10), asst(10)]
    expect(consumePrecompute({ messages: rewound, maxTailTokens: BIG_TAIL_BUDGET })).toBeNull()
    expect(__getArmedForTest()).toBeNull()
  })

  test('discards when the verbatim tail exceeds the budget (too stale)', () => {
    const base = [asst(10), asst(10)]
    __setReadyForTest({
      pivotCount: 2,
      tailUuid: uid(base[1]),
      summaryText: 'SUMMARY',
    })
    // Large appended tail; budget of 100 tokens is far exceeded.
    const grown = [...base, asst(50_000)]
    expect(consumePrecompute({ messages: grown, maxTailTokens: 100 })).toBeNull()
    expect(__getArmedForTest()).toBeNull()
  })

})

describe('re-arm cap (cost guard)', () => {
  // A context whose abortController is already aborted, so computeSummary's
  // background call never reaches the API — we only exercise the arm bookkeeping.
  function abortedContext() {
    const abortController = new AbortController()
    abortController.abort()
    return {
      abortController,
      getAppState: () => ({}),
      options: {},
    } as never
  }

  function armOnce(messages: Message[]): void {
    armPrecompute({
      messages,
      context: abortedContext(),
      cacheSafeParams: {} as never,
      maxTailTokens: BIG_TAIL_BUDGET,
    })
  }

  test('stops re-arming after the per-cycle cap', () => {
    // Each call uses a fresh message set → prefix mismatch → forces a re-arm.
    for (let i = 0; i < __MAX_ARM_ATTEMPTS_PER_CYCLE + 3; i++) {
      armOnce([asst(10), asst(10)])
    }
    expect(__getArmAttemptsForTest()).toBe(__MAX_ARM_ATTEMPTS_PER_CYCLE)
  })

  test('the budget refreshes once a compaction cycle fires', () => {
    for (let i = 0; i < __MAX_ARM_ATTEMPTS_PER_CYCLE + 1; i++) {
      armOnce([asst(10), asst(10)])
    }
    expect(__getArmAttemptsForTest()).toBe(__MAX_ARM_ATTEMPTS_PER_CYCLE)

    // consumePrecompute marks the start of a new cycle even when it finds
    // nothing consumable.
    consumePrecompute({ messages: [asst(10)], maxTailTokens: BIG_TAIL_BUDGET })
    expect(__getArmAttemptsForTest()).toBe(0)

    armOnce([asst(10), asst(10)])
    expect(__getArmAttemptsForTest()).toBe(1)
  })

  test('post-compact reset drops the slot and refreshes the budget', () => {
    const messages = [asst(10), asst(10)]
    __setReadyForTest({
      pivotCount: 2,
      tailUuid: uid(messages[1]),
      summaryText: 'S',
    })
    for (let i = 0; i < __MAX_ARM_ATTEMPTS_PER_CYCLE; i++) {
      armOnce([asst(10), asst(10)])
    }

    resetPrecomputeCycle()

    expect(__getArmedForTest()).toBeNull()
    expect(__getArmAttemptsForTest()).toBe(0)
  })

  test('checkArmedCoverage detects a modified message inside the armed prefix', async () => {
    const { checkArmedCoverage } = await import(
      '../../../services/compact/precomputedCompact.js'
    )
    const m1 = asst(10)
    const m2 = asst(10)
    const m3 = asst(10)
    armOnce([m1, m2])
    expect(checkArmedCoverage([m1, m2, m3])).toBe('match')

    // Replacing m1 while keeping m2 (tailUuid) intact must still be caught.
    const replaced = asst(10)
    expect(checkArmedCoverage([replaced, m2, m3])).toBe('covered_messages_changed')
  })

  test('tryDeferBesideTurn defers at most once per armed slot and never when ready', async () => {
    const { tryDeferBesideTurn } = await import(
      '../../../services/compact/precomputedCompact.js'
    )
    const messages = [asst(10), asst(10)]
    const params = {
      messages,
      context: abortedContext(),
      cacheSafeParams: {} as never,
      maxTailTokens: BIG_TAIL_BUDGET,
    }

    // First call arms beside_turn and defers once.
    expect(tryDeferBesideTurn(params)).toBe(true)
    // Second call on the same computing slot must NOT defer again.
    expect(tryDeferBesideTurn(params)).toBe(false)

    // When a ready summary exists, never defer — consume it immediately.
    __setReadyForTest({
      pivotCount: 2,
      tailUuid: uid(messages[1]),
      summaryText: 'READY',
    })
    expect(tryDeferBesideTurn(params)).toBe(false)
  })

  test('tryDeferBesideTurn does not re-defer after an errored slot or for an over-budget computing slot', async () => {
    const {
      tryDeferBesideTurn,
      __getArmedForTest,
      __setComputingForTest,
      __resetForTest,
    } = await import('../../../services/compact/precomputedCompact.js')

    const m1 = asst(10)
    const m2 = asst(10)
    const params = {
      messages: [m1, m2],
      context: abortedContext(),
      cacheSafeParams: {} as never,
      maxTailTokens: BIG_TAIL_BUDGET,
    }

    // First deferral succeeds; if that slot errors, a second call in the same
    // cycle must NOT defer again.
    expect(tryDeferBesideTurn(params)).toBe(true)
    const slot = __getArmedForTest()!
    slot.status = 'error'
    expect(tryDeferBesideTurn(params)).toBe(false)

    // Fresh cycle: a computing slot whose verbatim tail already exceeds
    // maxTailTokens must not be deferred on — it re-arms at the new pivot.
    __resetForTest()
    const bigTail = asst(50_000)
    __setComputingForTest({ pivotCount: 2, tailUuid: uid(m2) })
    expect(
      tryDeferBesideTurn({
        messages: [m1, m2, bigTail],
        context: abortedContext(),
        cacheSafeParams: {} as never,
        maxTailTokens: 100,
      }),
    ).toBe(true)
    expect(__getArmedForTest()?.pivotCount).toBe(3)
  })

})
