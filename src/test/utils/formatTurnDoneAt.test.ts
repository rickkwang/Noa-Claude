import { describe, expect, test } from 'bun:test'
import { formatTurnDoneAt } from '../../utils/format.js'

describe('formatTurnDoneAt', () => {
  const now = new Date(2026, 8, 17, 23, 0) // Thu Sep 17 2026, local time
  const at = (month: number, day: number, h: number, m: number) =>
    new Date(2026, month, day, h, m).toISOString()

  test('a turn finished today shows only the clock time', () => {
    expect(formatTurnDoneAt(at(8, 17, 21, 44), now)).toBe('9:44 PM')
  })

  test('a turn from earlier this week adds the weekday', () => {
    expect(formatTurnDoneAt(at(8, 15, 9, 5), now)).toBe('Tuesday 9:05 AM')
  })

  test('an older turn adds the date', () => {
    expect(formatTurnDoneAt(at(8, 1, 13, 30), now)).toBe(
      'Tuesday, Sep 1, 1:30 PM',
    )
  })

  test('a missing or invalid timestamp yields nothing to append', () => {
    expect(formatTurnDoneAt('not a date', now)).toBe('')
  })
})
