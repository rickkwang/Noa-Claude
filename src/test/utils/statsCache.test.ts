import { afterEach, describe, expect, test } from 'bun:test'
import {
  parseLocalDateString,
  toDateString,
} from '../../utils/statsCache.js'

const originalTimezone = process.env.TZ

afterEach(() => {
  if (originalTimezone === undefined) {
    delete process.env.TZ
  } else {
    process.env.TZ = originalTimezone
  }
})

describe('stats date keys', () => {
  test('preserves a local calendar day in a negative UTC timezone', () => {
    process.env.TZ = 'America/Los_Angeles'

    const date = parseLocalDateString('2026-06-19')

    expect(toDateString(date)).toBe('2026-06-19')
    expect(
      date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      }),
    ).toBe('Jun 19')
  })
})
