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
  resolveFixedLoadWindowOverride,
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

describe('fixed-load adaptive window raising', () => {
  afterEach(() => {
    restoreEnv()
  })

  test('raises a smaller configured window when fixed prefix exceeds half the threshold', () => {
    delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW
    const messages = [asstText(400)] // ~100 rough tokens
    // 1M model with a 200k override (threshold 167k) and 110k fixed load (> 83.5k).
    const res = resolveFixedLoadWindowOverride(
      messages,
      'claude-sonnet-5',
      110_100,
      200_000,
    )
    expect(res.raisedFrom).toBe(200_000)
    expect(res.raisedTo).toBeGreaterThan(200_000)
    expect(res.effectiveOverride).toBe(res.raisedTo)
  })

  test('does not silently raise an explicit CLAUDE_CODE_AUTO_COMPACT_WINDOW env override', () => {
    process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = '200000'
    const messages = [asstText(400)]
    const res = resolveFixedLoadWindowOverride(
      messages,
      'claude-sonnet-4-6',
      150_000,
    )
    expect(res.raisedTo).toBeUndefined()
  })

  test('does not mistake CJK/dense conversation text for fixed prefix load', () => {
    delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW
    // 75k Chinese chars: rough chars/4 is ~18.75k, real tokens ~150k, fixed prefix ~20k.
    const cjkMsg = {
      type: 'user',
      uuid: nextUuid(),
      message: { role: 'user', content: '中'.repeat(75_000) },
    } as unknown as Message
    const res = resolveFixedLoadWindowOverride(
      [cjkMsg],
      'claude-sonnet-4-6',
      170_000,
      200_000,
    )
    expect(res.raisedTo).toBeUndefined()
    expect(res.effectiveOverride).toBe(200_000)
  })

  test('does not raise past an explicit subagent ceiling', () => {
    delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW
    const messages = [asstText(400)]
    const ceilingOverride = { ceiling: 200_000 }
    const res = resolveFixedLoadWindowOverride(
      messages,
      'claude-sonnet-4-6',
      150_000,
      ceilingOverride,
    )
    expect(res.raisedTo).toBeUndefined()
    expect(res.effectiveOverride).toBe(ceilingOverride)
  })

  test('counts attachment messages in upperBoundMessageTokens so CJK attachments are not misattributed to fixed load', () => {
    delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW
    // English user message + large CJK attachment: upperBound must include the
    // attachment instead of letting the English message mask it.
    const englishMsg = asstText(20_000)
    const cjkAttachment = {
      type: 'attachment',
      uuid: nextUuid(),
      attachment: {
        type: 'critical_system_reminder',
        content: '中'.repeat(70_000),
      },
    } as unknown as Message
    const res = resolveFixedLoadWindowOverride(
      [englishMsg, cjkAttachment],
      'claude-sonnet-4-6',
      170_000,
      200_000,
    )
    expect(res.raisedTo).toBeUndefined()
    expect(res.effectiveOverride).toBe(200_000)
  })

  test('does not mistake high-resolution image blocks for fixed prefix load', () => {
    delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW
    // 40 high-res images (~5k tokens each = 200k) + 20k real fixed prefix = 220k total.
    const imageMsg = {
      type: 'user',
      uuid: nextUuid(),
      message: {
        role: 'user',
        content: Array.from({ length: 40 }, () => ({
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
        })),
      },
    } as unknown as Message
    const res = resolveFixedLoadWindowOverride(
      [imageMsg],
      'claude-sonnet-4-6',
      220_000,
      200_000,
    )
    expect(res.raisedTo).toBeUndefined()
    expect(res.effectiveOverride).toBe(200_000)
  })

  test('does not mistake a small-byte multi-page base64 PDF document for fixed prefix load', () => {
    delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW
    // A 100-page PDF can be small in bytes (40k base64 chars) yet bill ~150k tokens;
    // with 10k real fixed prefix (160k total), it must not raise a 200k window.
    const pdfMsg = {
      type: 'user',
      uuid: nextUuid(),
      message: {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: 'A'.repeat(40_000),
            },
          },
        ],
      },
    } as unknown as Message
    const res = resolveFixedLoadWindowOverride(
      [pdfMsg],
      'claude-sonnet-4-6',
      160_000,
      200_000,
    )
    expect(res.raisedTo).toBeUndefined()
    expect(res.effectiveOverride).toBe(200_000)
  })
})
