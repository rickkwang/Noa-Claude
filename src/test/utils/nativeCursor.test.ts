import { afterEach, describe, expect, test } from 'bun:test'
import {
  isNativeCursorEnabled,
  resetNativeCursorCacheForTesting,
} from '../../utils/nativeCursor.js'

const VARS = ['NOA_CLAUDE_NATIVE_CURSOR', 'CLAUDE_CODE_NATIVE_CURSOR'] as const

function setEnv(vars: Partial<Record<(typeof VARS)[number], string>>) {
  for (const name of VARS) delete process.env[name]
  for (const [name, value] of Object.entries(vars)) process.env[name] = value
  resetNativeCursorCacheForTesting()
}

afterEach(() => {
  for (const name of VARS) delete process.env[name]
  resetNativeCursorCacheForTesting()
})

describe('isNativeCursorEnabled', () => {
  test('defaults to enabled when unset', () => {
    setEnv({})
    expect(isNativeCursorEnabled()).toBe(true)
  })

  // An empty value is how an unset var arrives through some shell wrappers;
  // it must not read as an opt-out.
  test.each(['', '   '])('treats %p as unset (enabled)', value => {
    setEnv({ NOA_CLAUDE_NATIVE_CURSOR: value })
    expect(isNativeCursorEnabled()).toBe(true)
  })

  test.each(['0', 'false', 'no', 'off'])('%p opts out', value => {
    setEnv({ NOA_CLAUDE_NATIVE_CURSOR: value })
    expect(isNativeCursorEnabled()).toBe(false)
  })

  test.each(['1', 'true', 'yes', 'on'])('%p opts in', value => {
    setEnv({ NOA_CLAUDE_NATIVE_CURSOR: value })
    expect(isNativeCursorEnabled()).toBe(true)
  })

  test('accepts the legacy CLAUDE_CODE_ name', () => {
    setEnv({ CLAUDE_CODE_NATIVE_CURSOR: '0' })
    expect(isNativeCursorEnabled()).toBe(false)
  })

  test('NOA_CLAUDE_ wins over the legacy name', () => {
    setEnv({ NOA_CLAUDE_NATIVE_CURSOR: '0', CLAUDE_CODE_NATIVE_CURSOR: '1' })
    expect(isNativeCursorEnabled()).toBe(false)
  })

  test('caches, so a mid-session env change is ignored', () => {
    setEnv({ NOA_CLAUDE_NATIVE_CURSOR: '0' })
    expect(isNativeCursorEnabled()).toBe(false)
    process.env.NOA_CLAUDE_NATIVE_CURSOR = '1'
    expect(isNativeCursorEnabled()).toBe(false)
  })
})
