import { describe, expect, test } from 'bun:test'
import { parseWindowArg } from '../../commands/autocompact/autocompact.js'

describe('parseWindowArg', () => {
  test('reset aliases clear the override', () => {
    for (const s of ['auto', 'reset', 'default', 'unset', 'none', ' AUTO ']) {
      expect(parseWindowArg(s)).toBe('auto')
    }
  })

  test('k / m suffixes scale correctly', () => {
    expect(parseWindowArg('500k')).toBe(500_000)
    expect(parseWindowArg('1m')).toBe(1_000_000)
    expect(parseWindowArg('1M')).toBe(1_000_000)
    expect(parseWindowArg('250K')).toBe(250_000)
    expect(parseWindowArg('1.5m')).toBe(1_500_000)
  })

  test('bare large integers pass through unchanged', () => {
    expect(parseWindowArg('200000')).toBe(200_000)
    expect(parseWindowArg('1000000')).toBe(1_000_000)
  })

  test('bare small integers are treated as k shorthand', () => {
    expect(parseWindowArg('200')).toBe(200_000) // 200 -> 200k
    expect(parseWindowArg('500')).toBe(500_000)
  })

  test('rejects values below the 100k floor', () => {
    expect(parseWindowArg('50k')).toBeNull()
    expect(parseWindowArg('99999')).toBeNull()
    // 99 shorthand -> 99k, still below floor
    expect(parseWindowArg('99')).toBeNull()
  })

  test('accepts exactly the 100k floor', () => {
    expect(parseWindowArg('100k')).toBe(100_000)
    expect(parseWindowArg('100')).toBe(100_000) // 100 -> 100k
  })

  test('rejects unparseable input', () => {
    for (const s of ['', 'abc', '500kb', '5 0 0', '-200k', 'k', '1.2.3']) {
      expect(parseWindowArg(s)).toBeNull()
    }
  })

  test('trims surrounding whitespace', () => {
    expect(parseWindowArg('  500k  ')).toBe(500_000)
  })
})
