import { afterEach, describe, expect, test } from 'bun:test'
import { parseUserSpecifiedModel } from '../../utils/model/model.js'

const ENV_KEYS = [
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_OPENAI',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
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
    delete process.env.CLAUDE_CODE_USE_BEDROCK
    delete process.env.CLAUDE_CODE_USE_VERTEX
    delete process.env.CLAUDE_CODE_USE_FOUNDRY
    delete process.env.CLAUDE_CODE_USE_OPENAI
    delete process.env.ANTHROPIC_BASE_URL
    delete process.env.ANTHROPIC_DEFAULT_OPUS_MODEL
    delete process.env.CLAUDE_CODE_DISABLE_LEGACY_MODEL_REMAP
    expect(parseUserSpecifiedModel('claude-opus-4-0')).toBe('claude-opus-4-8')
  })

  test('a custom Anthropic-compatible base URL preserves the pinned legacy model', () => {
    delete process.env.CLAUDE_CODE_USE_BEDROCK
    delete process.env.CLAUDE_CODE_USE_VERTEX
    delete process.env.CLAUDE_CODE_USE_FOUNDRY
    delete process.env.CLAUDE_CODE_USE_OPENAI
    delete process.env.ANTHROPIC_DEFAULT_OPUS_MODEL
    delete process.env.CLAUDE_CODE_DISABLE_LEGACY_MODEL_REMAP
    process.env.ANTHROPIC_BASE_URL = 'https://api.minimaxi.com/anthropic'
    expect(parseUserSpecifiedModel('claude-opus-4-0')).toBe('claude-opus-4-0')
  })
})
