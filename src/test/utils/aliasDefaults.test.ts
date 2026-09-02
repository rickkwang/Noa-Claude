import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  getDefaultFableModel,
  getDefaultHaikuModel,
  getDefaultOpusModel,
  getDefaultSonnetModel,
} from '../../utils/model/model.js'
import { clearModelStringsCache } from '../../utils/model/modelStrings.js'

const SAVED = { ...process.env }

function useProvider(env?: string): void {
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
  delete process.env.CLAUDE_CODE_USE_OPENAI
  if (env) process.env[env] = '1'
  clearModelStringsCache()
}

beforeEach(() => {
  for (const k of [
    'ANTHROPIC_DEFAULT_OPUS_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    'ANTHROPIC_DEFAULT_FABLE_MODEL',
    'ANTHROPIC_MODEL',
  ]) {
    delete process.env[k]
  }
  useProvider()
})

afterEach(() => {
  process.env = { ...SAVED }
  clearModelStringsCache()
})

/**
 * Mirrors the `aliases` table in upstream's baked model catalog (2.1.258).
 * Asserted on the canonical substring, since Bedrock/Vertex render their own
 * provider-specific id shapes.
 */
describe('per-provider alias defaults match the upstream catalog', () => {
  test('first party gets the current generation of every family', () => {
    expect(getDefaultOpusModel()).toBe('claude-opus-5')
    expect(getDefaultSonnetModel()).toBe('claude-sonnet-5')
    expect(getDefaultFableModel()).toBe('claude-fable-5-1')
    expect(getDefaultHaikuModel()).toContain('claude-haiku-4-5')
  })

  test('Bedrock and Vertex get current Opus — not a trailing generation', () => {
    for (const env of ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX']) {
      useProvider(env)
      expect(getDefaultOpusModel()).toContain('claude-opus-5')
    }
  })

  test('Foundry pins Opus to 4.6 — two generations back, as upstream does', () => {
    useProvider('CLAUDE_CODE_USE_FOUNDRY')
    expect(getDefaultOpusModel()).toContain('claude-opus-4-6')
  })

  test('every cloud provider pins Sonnet to 4.5, not 4.6', () => {
    for (const env of [
      'CLAUDE_CODE_USE_BEDROCK',
      'CLAUDE_CODE_USE_VERTEX',
      'CLAUDE_CODE_USE_FOUNDRY',
    ]) {
      useProvider(env)
      expect(getDefaultSonnetModel()).toContain('claude-sonnet-4-5')
    }
  })

  test('Fable has no cloud-provider override — all providers get 5.1', () => {
    for (const env of [
      'CLAUDE_CODE_USE_BEDROCK',
      'CLAUDE_CODE_USE_VERTEX',
      'CLAUDE_CODE_USE_FOUNDRY',
    ]) {
      useProvider(env)
      expect(getDefaultFableModel()).toContain('claude-fable-5-1')
    }
  })

  test('an explicit env override still outranks the table', () => {
    useProvider('CLAUDE_CODE_USE_FOUNDRY')
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'my-deployment'
    expect(getDefaultOpusModel()).toBe('my-deployment')
  })
})

describe('the picker can reach every provider default', () => {
  test('the third-party Opus rows include the model that is now the default', () => {
    // Regression guard: the 3P branch offered only 4.1 / 4.8 while the default
    // moved to Opus 5, leaving no way back to the default from the picker.
    const src = readFileSync(
      new URL('../../utils/model/modelOptions.ts', import.meta.url),
      'utf8',
    )
    const payg3p = src.slice(src.indexOf('payg3pOptions'))
    expect(payg3p).toContain('payg3pOptions.push(getOpus5Option(fastMode))')
  })
})
