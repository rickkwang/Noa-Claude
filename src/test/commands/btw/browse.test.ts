import { describe, expect, test } from 'bun:test'
import { stepBrowse } from '../../../commands/btw/browse.js'

describe('stepBrowse', () => {
  test('older steps back from the current question, then clamps', () => {
    expect(stepBrowse(3, null, 'older')).toBe(2)
    expect(stepBrowse(3, 2, 'older')).toBe(1)
    expect(stepBrowse(3, 0, 'older')).toBe(0)
  })

  test('newer returns to the current question, then clamps', () => {
    expect(stepBrowse(3, 2, 'newer')).toBeNull()
    expect(stepBrowse(3, null, 'newer')).toBeNull()
  })

  test('only the five listed exchanges are reachable', () => {
    expect(stepBrowse(8, 3, 'older')).toBe(3)
    expect(stepBrowse(8, 4, 'older')).toBe(3)
  })

  test('wrap cycles through the current question', () => {
    expect(stepBrowse(2, 0, 'older', true)).toBeNull()
    expect(stepBrowse(2, null, 'newer', true)).toBe(0)
  })

  test('no history stays on the current question', () => {
    expect(stepBrowse(0, null, 'older')).toBeNull()
    expect(stepBrowse(0, null, 'older', true)).toBeNull()
  })
})
