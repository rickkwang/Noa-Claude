import { afterEach, describe, expect, test } from 'bun:test'
import { isFastModeSupportedByModel } from '../../utils/fastMode.js'

const original = process.env.CLAUDE_CODE_DISABLE_FAST_MODE

afterEach(() => {
  if (original === undefined) delete process.env.CLAUDE_CODE_DISABLE_FAST_MODE
  else process.env.CLAUDE_CODE_DISABLE_FAST_MODE = original
})

describe('isFastModeSupportedByModel', () => {
  test('Opus 4.8 and Opus 5 support fast mode', () => {
    delete process.env.CLAUDE_CODE_DISABLE_FAST_MODE
    expect(isFastModeSupportedByModel('claude-opus-4-8')).toBe(true)
    expect(isFastModeSupportedByModel('claude-opus-5')).toBe(true)
  })

  /**
   * Opus 4.7's fast mode was removed upstream — `speed: "fast"` on 4.7 now
   * errors. 4.7 is still a selectable model, so claiming support here would
   * fail the request outright for anyone who picks it with fast mode on.
   */
  test('Opus 4.7 does NOT support fast mode', () => {
    delete process.env.CLAUDE_CODE_DISABLE_FAST_MODE
    expect(isFastModeSupportedByModel('claude-opus-4-7')).toBe(false)
  })

  test('other models do not support fast mode', () => {
    delete process.env.CLAUDE_CODE_DISABLE_FAST_MODE
    for (const model of [
      'claude-sonnet-5',
      'claude-sonnet-4-6',
      'claude-haiku-4-5',
      'claude-opus-4-6',
      'claude-fable-5',
    ]) {
      expect(isFastModeSupportedByModel(model)).toBe(false)
    }
  })

  test('the kill switch disables fast mode for every model', () => {
    process.env.CLAUDE_CODE_DISABLE_FAST_MODE = '1'
    expect(isFastModeSupportedByModel('claude-opus-5')).toBe(false)
    expect(isFastModeSupportedByModel('claude-opus-4-8')).toBe(false)
  })
})
