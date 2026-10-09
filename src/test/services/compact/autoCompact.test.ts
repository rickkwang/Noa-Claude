import { afterEach, describe, expect, test } from 'bun:test'
import {
  calculateTokenWarningState,
  countConsecutiveRapidRefills,
  ERROR_THRESHOLD_BUFFER_TOKENS,
  getEffectiveContextWindowSize,
  getModelEffectiveContextWindowSize,
  isFixedPrefixOverThreshold,
  RAPID_REFILL_MAX_CONSECUTIVE,
  RAPID_REFILL_TURN_WINDOW,
  shouldAutoCompact,
  WARNING_THRESHOLD_BUFFER_TOKENS,
} from '../../../services/compact/autoCompact.js'
import type { Message } from '../../../types/message.js'

const originalEnv = {
  DISABLE_AUTO_COMPACT: process.env.DISABLE_AUTO_COMPACT,
  CLAUDE_CODE_AUTO_COMPACT_WINDOW: process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW,
  CLAUDE_AUTOCOMPACT_PCT_OVERRIDE:
    process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE,
}

function restoreEnv(): void {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

describe('calculateTokenWarningState', () => {
  afterEach(() => {
    restoreEnv()
  })

  test('blocking limit follows the model window, not the auto-compact window', () => {
    process.env.DISABLE_AUTO_COMPACT = '1'
    process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = '30000'

    const model = 'test-model'
    const modelWindow = getModelEffectiveContextWindowSize(model)
    expect(getEffectiveContextWindowSize(model)).toBeLessThan(modelWindow)

    // Well past the configured compaction window, still far from the API limit.
    expect(calculateTokenWarningState(60_000, model).isAtBlockingLimit).toBe(
      false,
    )
    expect(
      calculateTokenWarningState(modelWindow, model).isAtBlockingLimit,
    ).toBe(true)
  })
})

let fixtureCounter = 0
function nextUuid(): string {
  fixtureCounter += 1
  return `m-${fixtureCounter}`
}
function asstText(chars: number): Message {
  const uuid = nextUuid()
  return {
    type: 'assistant',
    id: uuid,
    uuid,
    message: {
      id: uuid,
      role: 'assistant',
      content: [{ type: 'text', text: 'x'.repeat(chars) }],
    },
  } as unknown as Message
}
describe('isFixedPrefixOverThreshold', () => {
  test('flags a prefix that clears the threshold on its own', () => {
    const messages = [asstText(400)] // ~100 rough tokens
    // 60k total with ~100 tokens of messages → the prefix is the overflow.
    expect(isFixedPrefixOverThreshold(60_000, messages, 50_000)).toBe(true)
  })

})

describe('countConsecutiveRapidRefills (rapid-refill breaker)', () => {
  test('compact within the turn window increments the streak', () => {
    expect(
      countConsecutiveRapidRefills({
        compacted: true,
        turnCounter: 2,
        turnId: 'x',
        consecutiveRapidRefills: 1,
      }),
    ).toBe(2)
  })

  test('a gap at or beyond the window resets the streak', () => {
    expect(
      countConsecutiveRapidRefills({
        compacted: true,
        turnCounter: RAPID_REFILL_TURN_WINDOW,
        turnId: 'x',
        consecutiveRapidRefills: 2,
      }),
    ).toBe(0)
  })

  test('streak reaching the max trips the breaker threshold', () => {
    const streak = countConsecutiveRapidRefills({
      compacted: true,
      turnCounter: 1,
      turnId: 'x',
      consecutiveRapidRefills: RAPID_REFILL_MAX_CONSECUTIVE - 1,
    })
    expect(streak).toBe(RAPID_REFILL_MAX_CONSECUTIVE)
  })
})

describe('shouldAutoCompact background forks', () => {
  afterEach(() => {
    restoreEnv()
  })

  test('side-task forks skip compaction the main thread would run', async () => {
    delete process.env.DISABLE_AUTO_COMPACT
    process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = '1'
    const messages = Array.from({ length: 80 }, () => asstText(3000))

    expect(await shouldAutoCompact(messages, 'test-model', 'repl_main_thread')).toBe(
      true,
    )
    for (const source of ['agent_summary', 'away_summary', 'prompt_suggestion', 'speculation']) {
      expect(await shouldAutoCompact(messages, 'test-model', source as never)).toBe(false)
    }
  })
})
