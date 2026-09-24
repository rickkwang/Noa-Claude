import { describe, expect, mock, test } from 'bun:test'

// The public npm `modifiers-napi` is a name-reservation placeholder that
// exports nothing, so the native lookup must degrade to "not pressed".
mock.module('modifiers-napi', () => ({}))

const { isModifierPressed } = await import('../../utils/modifiers.js')

describe('isModifierPressed', () => {
  test('returns false instead of throwing when the native module is a stub', () => {
    expect(() => isModifierPressed('shift')).not.toThrow()
    expect(isModifierPressed('shift')).toBe(false)
  })
})
