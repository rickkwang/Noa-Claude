import { describe, expect, test } from 'bun:test'
import { formatCompactSummary, hasSummaryBlock } from '../../../services/compact/prompt.js'

describe('compact summary tag parsing', () => {
  test('extracts summary and strips analysis', () => {
    const raw = '<analysis>draft notes</analysis>\n<summary>final body</summary>'
    expect(hasSummaryBlock(raw)).toBe(true)
    expect(formatCompactSummary(raw)).toBe('Summary:\nfinal body')
  })

  test('does not hang on thousands of unclosed analysis or summary tags', () => {
    const manyUnclosed = '<analysis>'.repeat(5000) + 'trailing text'
    const start = performance.now()
    expect(hasSummaryBlock(manyUnclosed)).toBe(false)
    expect(formatCompactSummary(manyUnclosed)).toBe(manyUnclosed)
    expect(performance.now() - start).toBeLessThan(100)

    const manySummaryOpen = '<summary>'.repeat(5000)
    const start2 = performance.now()
    expect(hasSummaryBlock(manySummaryOpen)).toBe(true)
    expect(formatCompactSummary(manySummaryOpen)).toBe(manySummaryOpen)
    expect(performance.now() - start2).toBeLessThan(100)
  })
})
