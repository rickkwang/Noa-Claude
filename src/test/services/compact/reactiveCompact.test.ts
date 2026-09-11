import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { roughTokenCountEstimationForMessages } from '../../../services/tokenEstimation.js'
import type { Message } from '../../../types/message.js'

// Query suffix, not a plain import: other suites replace reactiveCompact.js in
// the process-wide module registry, and whichever file runs first wins. This
// asks for a fresh instance of the real module. Held in a variable because tsc
// can't resolve a suffixed specifier.
const REAL_REACTIVE_MODULE =
  '../../../services/compact/reactiveCompact.js?reactive-unit-real'
const {
  canReactivelyCompact,
  isReactiveCompactEnabled,
  isWithheldMediaSizeError,
  isWithheldPromptTooLong,
  selectReactiveTailPivot,
  tryReactiveCompact,
} = (await import(
  REAL_REACTIVE_MODULE
)) as typeof import('../../../services/compact/reactiveCompact.js')

// Reactive compaction is on whenever auto-compact is. These tests exercise the
// runtime gate + guard early-returns without hitting the summary API.

const ENV_KEYS = [
  'NOA_CLAUDE_REACTIVE_COMPACT',
  'CLAUDE_CODE_REACTIVE_COMPACT',
  'DISABLE_AUTO_COMPACT',
  'DISABLE_COMPACT',
] as const
const originalEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]))

function ptlMessage(): Message {
  return {
    type: 'assistant',
    uuid: 'ptl',
    isApiErrorMessage: true,
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'Prompt is too long: 210000 > 200000' }],
    },
  } as unknown as Message
}

function mediaMessage(): Message {
  return {
    type: 'assistant',
    uuid: 'media',
    isApiErrorMessage: true,
    errorDetails: 'image exceeds 5 MB maximum: 5316852 bytes > 5242880 bytes',
    message: { role: 'assistant', content: [{ type: 'text', text: 'API Error' }] },
  } as unknown as Message
}

function plainError(): Message {
  return {
    type: 'assistant',
    uuid: 'err',
    isApiErrorMessage: true,
    message: { role: 'assistant', content: [{ type: 'text', text: 'API Error' }] },
  } as unknown as Message
}

function turnOff(): void {
  process.env.NOA_CLAUDE_REACTIVE_COMPACT = '0'
}

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k]
})
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (originalEnv[k] === undefined) delete process.env[k]
    else process.env[k] = originalEnv[k]
  }
})

describe('reactiveCompact runtime gate', () => {
  test('on by default alongside auto-compact', () => {
    expect(isReactiveCompactEnabled()).toBe(true)
  })

  test('off when auto-compact is off', () => {
    process.env.DISABLE_AUTO_COMPACT = '1'
    expect(isReactiveCompactEnabled()).toBe(false)
  })

  test('off when compaction is disabled entirely', () => {
    process.env.DISABLE_COMPACT = '1'
    expect(isReactiveCompactEnabled()).toBe(false)
  })

  test('env opt-out turns off only the reactive layer', () => {
    turnOff()
    expect(isReactiveCompactEnabled()).toBe(false)
    delete process.env.NOA_CLAUDE_REACTIVE_COMPACT
    process.env.CLAUDE_CODE_REACTIVE_COMPACT = 'false'
    expect(isReactiveCompactEnabled()).toBe(false)
  })
})

describe('canReactivelyCompact', () => {
  test('main thread, SDK and subagents recover; forks and side tasks do not', () => {
    for (const source of ['repl_main_thread', 'sdk', 'agent:builtin:general-purpose']) {
      expect(canReactivelyCompact(source as never)).toBe(true)
    }
    for (const source of [
      'compact',
      'session_memory',
      'agent_summary',
      'away_summary',
      'prompt_suggestion',
      'speculation',
    ]) {
      expect(canReactivelyCompact(source as never)).toBe(false)
    }
  })

  test('follows the global switch', () => {
    turnOff()
    expect(canReactivelyCompact('repl_main_thread')).toBe(false)
  })
})

describe('withhold predicates', () => {
  test('never withhold when turned off', () => {
    turnOff()
    expect(isWithheldPromptTooLong(ptlMessage())).toBe(false)
    expect(isWithheldMediaSizeError(mediaMessage())).toBe(false)
  })

  test('withhold prompt-too-long', () => {
    expect(isWithheldPromptTooLong(ptlMessage())).toBe(true)
    expect(isWithheldPromptTooLong(plainError())).toBe(false)
    expect(isWithheldPromptTooLong(undefined)).toBe(false)
  })

  test('withhold media-size errors', () => {
    expect(isWithheldMediaSizeError(mediaMessage())).toBe(true)
    expect(isWithheldMediaSizeError(plainError())).toBe(false)
    expect(isWithheldMediaSizeError(undefined)).toBe(false)
  })
})

describe('tryReactiveCompact guards (no API call)', () => {
  const dummyParams = {
    querySource: 'repl_main_thread' as const,
    messages: [ptlMessage()],
    cacheSafeParams: {} as never,
  }

  test('returns null when turned off', async () => {
    turnOff()
    expect(
      await tryReactiveCompact({
        ...dummyParams,
        hasAttempted: false,
        aborted: false,
      }),
    ).toBeNull()
  })

  test('returns null when aborted (single-shot, before touching context)', async () => {
    expect(
      await tryReactiveCompact({
        ...dummyParams,
        hasAttempted: false,
        aborted: true,
      }),
    ).toBeNull()
  })

  test('returns null when already attempted this turn', async () => {
    expect(
      await tryReactiveCompact({
        ...dummyParams,
        hasAttempted: true,
        aborted: false,
      }),
    ).toBeNull()
  })

  test('bails when there are too few groups to compact', async () => {
    // A single error message → fewer than MIN_GROUPS_TO_COMPACT groups.
    expect(
      await tryReactiveCompact({
        querySource: 'repl_main_thread',
        messages: [ptlMessage()],
        cacheSafeParams: {} as never,
        hasAttempted: false,
        aborted: false,
      }),
    ).toBeNull()
  })
})

describe('selectReactiveTailPivot', () => {
  let n = 0
  const asst = (chars = 40): Message => {
    n += 1
    return {
      type: 'assistant',
      uuid: `a${n}`,
      message: {
        id: `a${n}`,
        role: 'assistant',
        content: [{ type: 'text', text: 'x'.repeat(chars) }],
      },
    } as unknown as Message
  }
  const user = (chars = 40, extra: Record<string, unknown> = {}): Message => {
    n += 1
    return {
      type: 'user',
      uuid: `u${n}`,
      message: { role: 'user', content: 'y'.repeat(chars) },
      ...extra,
    } as unknown as Message
  }
  // groups: [u] [a u] [a u] ... — one API round per assistant turn
  const rounds = (count: number, chars = 40): Message[] => [
    user(chars),
    ...Array.from({ length: count }, () => [asst(chars), user(chars)]).flat(),
  ]

  test('keeps every recent round that fits, leaving an assistant turn to summarize', () => {
    const messages = rounds(4)
    const pivot = selectReactiveTailPivot(messages, 'test-model')
    // [u] [a u] stay in the prefix; the last three rounds are kept.
    expect(pivot).toBe(3)
  })

  test('stops at the first round that would exceed the budget', () => {
    const messages = [
      ...rounds(2),
      asst(40),
      user(200_000), // ~50K tokens: over any tail budget
      asst(40),
      user(40),
    ]
    const pivot = selectReactiveTailPivot(messages, 'test-model')
    expect(pivot).toBe(messages.length - 2)
  })

  test('returns null when even the latest round is too big to keep', () => {
    const messages = [...rounds(2), asst(40), user(400_000)]
    expect(selectReactiveTailPivot(messages, 'test-model')).toBeNull()
  })

  test('grows the tail past the budget only far enough to cover a reported overflow', () => {
    // Rounds of ~5K tokens. The budget alone keeps three; a 20K overflow needs
    // 23K kept out of the summary request — five rounds, not one more.
    const messages = rounds(10, 10_000)
    const roundTokens = roughTokenCountEstimationForMessages(messages.slice(-2) as never)
    const withoutGap = selectReactiveTailPivot(messages, 'test-model')!
    const withGap = selectReactiveTailPivot(messages, 'test-model', 20_000)!
    expect(withGap).toBeLessThan(withoutGap)
    const kept = roughTokenCountEstimationForMessages(messages.slice(withGap) as never)
    expect(kept).toBeGreaterThanOrEqual(23_000)
    expect(kept).toBeLessThan(23_000 + roundTokens)
  })

  test('an overflow the budget already covers keeps the budget-sized tail', () => {
    const messages = rounds(10, 10_000)
    expect(selectReactiveTailPivot(messages, 'test-model', 5_000)).toBe(
      selectReactiveTailPivot(messages, 'test-model'),
    )
  })

  test('returns null when the overflow is bigger than any tail it may keep', () => {
    expect(
      selectReactiveTailPivot(rounds(4), 'test-model', 500_000),
    ).toBeNull()
  })

  test('never keeps a compact summary in the tail', () => {
    const messages = [
      user(40, { isCompactSummary: true }),
      asst(40),
      user(40),
    ]
    // The only assistant turn is in group 1 → nothing left to keep after it.
    expect(selectReactiveTailPivot(messages, 'test-model')).toBeNull()
  })
})
