import { beforeEach, describe, expect, test } from 'bun:test'
import { selectTipWithLongestTimeSinceShown } from '../../../services/tips/tipScheduler.js'
import { saveGlobalConfig } from '../../../utils/config.js'

function fakeTip(id: string, priority = 0) {
  return {
    id,
    content: async () => id,
    cooldownSessions: 0,
    priority,
    isRelevant: async () => true,
  }
}

beforeEach(() => {
  saveGlobalConfig(c => ({ ...c, numStartups: 0, tipsHistory: {} }))
})

describe('selectTipWithLongestTimeSinceShown', () => {
  test('empty and singleton inputs', () => {
    expect(selectTipWithLongestTimeSinceShown([])).toBeUndefined()
    const only = fakeTip('only')
    expect(selectTipWithLongestTimeSinceShown([only])).toBe(only)
  })

  test('the longest-unserved tip wins regardless of priority', () => {
    saveGlobalConfig(c => ({
      ...c,
      numStartups: 10,
      tipsHistory: { low: 2, high: 9 },
    }))
    // low: 8 sessions ago, priority 0; high: 1 session ago, priority 99.
    const low = fakeTip('low', 0)
    const high = fakeTip('high', 99)
    expect(selectTipWithLongestTimeSinceShown([high, low])).toBe(low)
  })

  test('priority breaks ties only among never-shown tips', () => {
    const a = fakeTip('a', 1)
    const b = fakeTip('b', 5)
    const c = fakeTip('c', 3)
    expect(selectTipWithLongestTimeSinceShown([a, b, c])?.id).toBe('b')
    expect(selectTipWithLongestTimeSinceShown([c, a, b])?.id).toBe('b')
  })

  test('priority does not break a tie between shown tips', () => {
    saveGlobalConfig(c => ({
      ...c,
      numStartups: 10,
      tipsHistory: { first: 5, second: 5 },
    }))
    // Equal finite session counts: priority must stay out of it; the
    // original (stable) order decides.
    const first = fakeTip('first', 0)
    const second = fakeTip('second', 99)
    expect(selectTipWithLongestTimeSinceShown([first, second])?.id).toBe(
      'first',
    )
  })

  test('a never-shown tip beats any shown tip', () => {
    saveGlobalConfig(c => ({
      ...c,
      numStartups: 100,
      // Value 0 would read back as "never shown" (tipHistory treats a
      // falsy lastShown as Infinity) — use a real session number.
      tipsHistory: { stale: 1 },
    }))
    const stale = fakeTip('stale')
    const fresh = fakeTip('fresh')
    expect(selectTipWithLongestTimeSinceShown([stale, fresh])?.id).toBe(
      'fresh',
    )
  })
})
