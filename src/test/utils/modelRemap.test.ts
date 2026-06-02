import { afterEach, describe, expect, test } from 'bun:test'
import { parseUserSpecifiedModel } from '../../utils/model/model.js'

const ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_DISABLE_LEGACY_MODEL_REMAP',
] as const

const original = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]))

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (original[k] === undefined) delete process.env[k]
    else process.env[k] = original[k]
  }
})

describe('legacy Opus remap — direct 1P only', () => {
  test('direct first-party remaps legacy Opus 4 ids to the current default', () => {
    delete process.env.ANTHROPIC_BASE_URL
    expect(parseUserSpecifiedModel('claude-opus-4-0')).toBe('claude-opus-4-8')
  })

  test('a custom Anthropic-compatible base URL preserves the pinned legacy model', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://api.minimaxi.com/anthropic'
    expect(parseUserSpecifiedModel('claude-opus-4-0')).toBe('claude-opus-4-0')
  })
})
