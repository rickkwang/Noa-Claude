import { describe, expect, test } from 'bun:test'
import { isModifierPressed } from '../../utils/modifiers.js'

describe('isModifierPressed', () => {
  test('returns false instead of throwing when no native modifier module is shipped', () => {
    expect(() => isModifierPressed('shift')).not.toThrow()
    expect(isModifierPressed('shift')).toBe(false)
  })
})
