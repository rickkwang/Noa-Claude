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
  isPrecomputeEnabled,
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

describe('isPrecomputeEnabled', () => {
  test('honors the env toggle', () => {
    process.env[ENV_KEY] = '1'
    expect(isPrecomputeEnabled()).toBe(true)
    delete process.env[ENV_KEY]
    expect(isPrecomputeEnabled()).toBe(false)
  })
})

describe('consumePrecompute', () => {
  test('returns null when disabled even if a summary is armed', () => {
    const messages = [asst(10), asst(10)]
    __setReadyForTest({
      pivotCount: 2,
      tailUuid: uid(messages[1]),
      summaryText: 'S',
    })
    delete process.env[ENV_KEY]
    expect(consumePrecompute({ messages, maxTailTokens: BIG_TAIL_BUDGET })).toBeNull()
  })

  test('returns null while still computing (no blocking wait)', () => {
    const messages = [asst(10), asst(10)]
    __setComputingForTest({ pivotCount: 2, tailUuid: uid(messages[1]) })
    expect(consumePrecompute({ messages, maxTailTokens: BIG_TAIL_BUDGET })).toBeNull()
  })

  test('consumes a ready summary on an unchanged prefix and clears the slot', () => {
    const messages = [asst(10), asst(10)]
    __setReadyForTest({
      pivotCount: 2,
      tailUuid: uid(messages[1]),
      summaryText: 'SUMMARY',
    })
    const out = consumePrecompute({ messages, maxTailTokens: BIG_TAIL_BUDGET })
    expect(out).toEqual({ pivotIndex: 2, summaryText: 'SUMMARY' })
    // slot cleared after consume
    expect(__getArmedForTest()).toBeNull()
  })

  test('consumes with an appended verbatim tail (append-only growth)', () => {
    const base = [asst(10), asst(10)]
    __setReadyForTest({
      pivotCount: 2,
      tailUuid: uid(base[1]),
      summaryText: 'SUMMARY',
    })
    // Two new messages appended since arm; prefix[0..2] is unchanged.
    const grown = [...base, asst(10), asst(10)]
    const out = consumePrecompute({ messages: grown, maxTailTokens: BIG_TAIL_BUDGET })
    expect(out).toEqual({ pivotIndex: 2, summaryText: 'SUMMARY' })
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

  test('returns null when nothing is armed', () => {
    const messages = [asst(10), asst(10)]
    expect(consumePrecompute({ messages, maxTailTokens: BIG_TAIL_BUDGET })).toBeNull()
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

  test('does not count arms while disabled', () => {
    delete process.env[ENV_KEY]
    armOnce([asst(10), asst(10)])
    expect(__getArmAttemptsForTest()).toBe(0)
  })

  test('resetPrecomputeCycle drops the slot and refreshes the budget', () => {
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
})
