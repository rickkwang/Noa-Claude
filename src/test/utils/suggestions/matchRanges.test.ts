import { describe, expect, test } from 'bun:test'
import { computeMatchRanges } from '../../../utils/suggestions/matchRanges.js'

const slice = (text: string, ranges: [number, number][]) =>
  ranges.map(([start, end]) => text.slice(start, end))

describe('computeMatchRanges', () => {
  test('returns nothing without a query or text', () => {
    expect(computeMatchRanges('/model', '')).toEqual([])
    expect(computeMatchRanges('', 'mod')).toEqual([])
  })

  test('prefers the first contiguous occurrence', () => {
    expect(computeMatchRanges('/model', 'mod')).toEqual([[1, 4]])
  })

  test('matches case-insensitively in both directions', () => {
    expect(computeMatchRanges('/Model', 'mod')).toEqual([[1, 4]])
    // Callers are expected to pre-lowercase, but must not have to.
    expect(computeMatchRanges('/model', 'MoD')).toEqual([[1, 4]])
  })

  test('only the first occurrence is highlighted', () => {
    // Old behaviour highlighted every occurrence; upstream stops at the first.
    expect(computeMatchRanges('/aa-aa', 'aa')).toEqual([[1, 3]])
  })

  test('falls back to a subsequence match, merging adjacent hits', () => {
    const text = '/security-review'
    const ranges = computeMatchRanges(text, 'srev')
    // s(1) r(5) e(11) v(12) — the trailing "ev" is adjacent, so it merges.
    expect(slice(text, ranges)).toEqual(['s', 'r', 'ev'])
  })

  test('contiguousOnly suppresses the subsequence fallback', () => {
    expect(computeMatchRanges('/security-review', 'srev', true)).toEqual([])
  })

  test('returns nothing when the subsequence cannot be completed', () => {
    expect(computeMatchRanges('/model', 'modz')).toEqual([])
  })

  test('keeps a ZWJ emoji sequence in one range', () => {
    const text = '/ship-👨‍👩‍👧-it'
    const ranges = computeMatchRanges(text, 'ship')
    expect(slice(text, ranges)).toEqual(['ship'])

    // A query landing inside the family emoji widens out to the whole cluster
    // instead of splitting it into broken halves.
    const inside = computeMatchRanges(text, '👨')
    expect(slice(text, inside)).toEqual(['👨‍👩‍👧'])
  })

  test('keeps a combining accent attached to its base letter', () => {
    const text = '/café-menu' // "café" written as e + U+0301
    const ranges = computeMatchRanges(text, 'caf')
    expect(slice(text, ranges)).toEqual(['caf'])

    const throughE = computeMatchRanges(text, 'cafe')
    expect(slice(text, throughE)).toEqual(['café'])
  })

  test('bails out when case folding changes the string length', () => {
    // 'İ'.toLowerCase() is two code units, so offsets no longer map back.
    expect(computeMatchRanges('/İstanbul', 'stan')).toEqual([])
  })

  test('precomposed accents skip the segmenter but still match', () => {
    expect(computeMatchRanges('/café-menu', 'caf')).toEqual([[1, 4]])
  })
})
