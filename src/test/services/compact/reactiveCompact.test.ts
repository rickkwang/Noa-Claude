import { describe, expect, test } from 'bun:test'
import { roughTokenCountEstimationForMessages } from '../../../services/tokenEstimation.js'
import type { Message } from '../../../types/message.js'

// Other suites replace the module in the shared registry, so load a fresh real instance.
const REAL_REACTIVE_MODULE =
  '../../../services/compact/reactiveCompact.js?reactive-unit-real'
const { selectReactiveTailPivot } = (await import(
  REAL_REACTIVE_MODULE
)) as typeof import('../../../services/compact/reactiveCompact.js')

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
