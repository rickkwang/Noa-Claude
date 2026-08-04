import { describe, expect, test } from 'bun:test'
import {
  formatModelCacheUsage,
  formatModelPercentage,
  formatUsageBreakdown,
  getModelEntriesWithTotal,
  getUsageTotalTokens,
} from '../../components/Stats.js'

/**
 * Pins the Stats panel's token accounting to upstream Claude Code 2.1.221,
 * which changed "total tokens" to include both cache legs and added the
 * input/output/cache-read/cache-write breakdown. Before 2.1.221 the total was
 * input + output only, which understated real usage by an order of magnitude
 * on cache-heavy sessions.
 */

const SONNET = {
  inputTokens: 1_000,
  outputTokens: 2_000,
  cacheReadInputTokens: 500_000,
  cacheCreationInputTokens: 30_000,
}
const HAIKU = {
  inputTokens: 100,
  outputTokens: 200,
  cacheReadInputTokens: 1_000,
  cacheCreationInputTokens: 400,
}

describe('getUsageTotalTokens', () => {
  test('sums all four token classes', () => {
    expect(getUsageTotalTokens(SONNET)).toBe(533_000)
  })

  test('treats missing fields as zero', () => {
    expect(getUsageTotalTokens({ inputTokens: 5 })).toBe(5)
    expect(getUsageTotalTokens({})).toBe(0)
  })

  test('cache tokens dominate a cache-heavy session', () => {
    // The pre-2.1.221 formula would have reported 3,000 here.
    expect(SONNET.inputTokens + SONNET.outputTokens).toBe(3_000)
    expect(getUsageTotalTokens(SONNET)).toBeGreaterThan(500_000)
  })
})

describe('getModelEntriesWithTotal', () => {
  test('totals across models and sorts by cache-inclusive usage', () => {
    const { modelEntries, totalTokens } = getModelEntriesWithTotal({
      haiku: HAIKU,
      sonnet: SONNET,
    })
    expect(totalTokens).toBe(534_700)
    expect(modelEntries.map(([model]) => model)).toEqual(['sonnet', 'haiku'])
  })

  test('a model ranks by cache tokens, not just input + output', () => {
    // `chatty` wins on input+output; `cached` wins once cache is counted.
    const chatty = {
      inputTokens: 10_000,
      outputTokens: 10_000,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    }
    const cached = {
      inputTokens: 100,
      outputTokens: 100,
      cacheReadInputTokens: 900_000,
      cacheCreationInputTokens: 0,
    }
    const { modelEntries } = getModelEntriesWithTotal({ chatty, cached })
    expect(modelEntries[0]![0]).toBe('cached')
  })

  test('handles an empty model map', () => {
    const { modelEntries, totalTokens } = getModelEntriesWithTotal({})
    expect(modelEntries).toEqual([])
    expect(totalTokens).toBe(0)
  })
})

describe('formatUsageBreakdown', () => {
  test('reports the four classes separately', () => {
    expect(formatUsageBreakdown({ sonnet: SONNET, haiku: HAIKU })).toBe(
      'Input 1.1k · Output 2.2k · Cache read 501.0k · Cache write 30.4k',
    )
  })

  test('renders zeros for an empty model map', () => {
    expect(formatUsageBreakdown({})).toBe(
      'Input 0 · Output 0 · Cache read 0 · Cache write 0',
    )
  })
})

describe('formatModelCacheUsage', () => {
  test('splits read and write', () => {
    expect(formatModelCacheUsage(SONNET)).toBe('Cache: 500.0k read · 30.0k write')
  })

  test('defaults missing cache fields to zero', () => {
    expect(formatModelCacheUsage({ inputTokens: 1 })).toBe('Cache: 0 read · 0 write')
  })
})

describe('formatModelPercentage', () => {
  test('is computed over cache-inclusive totals', () => {
    const { totalTokens } = getModelEntriesWithTotal({
      sonnet: SONNET,
      haiku: HAIKU,
    })
    expect(formatModelPercentage(SONNET, totalTokens)).toBe('99.7')
    expect(formatModelPercentage(HAIKU, totalTokens)).toBe('0.3')
  })

  test('guards against a zero total instead of returning NaN', () => {
    expect(formatModelPercentage(SONNET, 0)).toBe('0.0')
    expect(formatModelPercentage(SONNET, -1)).toBe('0.0')
  })
})
