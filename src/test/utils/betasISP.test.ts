import { afterEach, describe, expect, test } from 'bun:test'
import {
  clearBetasCaches,
  getAllModelBetas,
  getMergedBetas,
  modelSupportsContextManagement,
  modelSupportsISP,
  modelSupportsStructuredOutputs,
  shouldIncludeFirstPartyOnlyBetas,
  shouldUseGlobalCacheScope,
} from '../../utils/betas.js'
import { CONTEXT_MANAGEMENT_BETA_HEADER } from '../../constants/betas.js'

const ENV_KEYS = [
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_OPENAI',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES',
  'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS',
  'ANTHROPIC_API_KEY',
] as const

const original = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]))

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (original[k] === undefined) delete process.env[k]
    else process.env[k] = original[k]
  }
  clearBetasCaches()
})

describe('modelSupportsISP — third-party Anthropic-compatible', () => {
  test('direct first-party enables interleaved thinking for Claude 4+', () => {
    delete process.env.ANTHROPIC_BASE_URL
    expect(modelSupportsISP('claude-opus-4-8')).toBe(true)
  })

  test('does NOT send the ISP header to a 3P model behind a custom base URL', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://api.minimaxi.com/anthropic'
    expect(modelSupportsISP('MiniMax-M2.7')).toBe(false)
  })

  test('a 3P endpoint can opt in via SUPPORTED_CAPABILITIES override', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://api.minimaxi.com/anthropic'
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'minimax-m2.7'
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES =
      'interleaved_thinking'
    expect(modelSupportsISP('MiniMax-M2.7')).toBe(true)
  })

  test('Claude Haiku 4.5 behind a custom proxy still requires override', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://gateway.example.com/anthropic'
    expect(modelSupportsISP('claude-haiku-4-5')).toBe(false)
  })

  test('Claude Haiku 4.5 behind a custom proxy can opt in via override', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://gateway.example.com/anthropic'
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'claude-haiku-4-5'
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES =
      'interleaved_thinking'
    expect(modelSupportsISP('claude-haiku-4-5')).toBe(true)
  })

  test('Foundry keeps ISP for every model, including Claude 3 (no regression)', () => {
    process.env.CLAUDE_CODE_USE_FOUNDRY = '1'
    expect(modelSupportsISP('claude-3-5-sonnet')).toBe(true)
  })
})

describe('modelSupportsContextManagement — third-party leak prevention', () => {
  test('direct first-party enables it for Claude 4+', () => {
    delete process.env.ANTHROPIC_BASE_URL
    expect(modelSupportsContextManagement('claude-opus-4-8')).toBe(true)
  })

  test('does NOT enable it for a non-Claude 3P model behind a custom base URL', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://api.minimaxi.com/anthropic'
    expect(modelSupportsContextManagement('MiniMax-M2.7')).toBe(false)
  })

  test('a genuine Claude model proxied through a custom base URL still requires override', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://gateway.example.com/anthropic'
    expect(modelSupportsContextManagement('claude-haiku-4-5')).toBe(false)
  })

  test('a custom base URL can opt into context management via override', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://gateway.example.com/anthropic'
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'claude-haiku-4-5'
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES =
      'context_management'
    expect(modelSupportsContextManagement('claude-haiku-4-5')).toBe(true)
  })

  test('a custom base URL override sends the context-management beta header', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-leakcheck'
    process.env.ANTHROPIC_BASE_URL = 'https://gateway.example.com/anthropic'
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'claude-haiku-4-5'
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES =
      'context_management'
    expect(getMergedBetas('claude-haiku-4-5')).toContain(
      CONTEXT_MANAGEMENT_BETA_HEADER,
    )
  })
})

describe('first-party beta gates — custom base URL leak prevention', () => {
  test('direct first-party includes experimental betas and global cache scope', () => {
    delete process.env.ANTHROPIC_BASE_URL
    expect(shouldIncludeFirstPartyOnlyBetas()).toBe(true)
    expect(shouldUseGlobalCacheScope()).toBe(true)
  })

  test('a custom ANTHROPIC_BASE_URL (proxy/kimi/minimax) gets neither', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://api.minimaxi.com/anthropic'
    expect(shouldIncludeFirstPartyOnlyBetas()).toBe(false)
    expect(shouldUseGlobalCacheScope()).toBe(false)
  })
})

describe('modelSupportsStructuredOutputs — third-party leak prevention', () => {
  test('direct first-party enables structured outputs for supported Claude models', () => {
    delete process.env.ANTHROPIC_BASE_URL
    expect(modelSupportsStructuredOutputs('claude-sonnet-4-6')).toBe(true)
  })

  test('a custom base URL does not infer structured outputs from model name', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://gateway.example.com/anthropic'
    expect(modelSupportsStructuredOutputs('claude-sonnet-4-6')).toBe(false)
  })

  test('a custom base URL can opt into structured outputs via override', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://gateway.example.com/anthropic'
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'claude-sonnet-4-6'
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES =
      'structured_outputs'
    expect(modelSupportsStructuredOutputs('claude-sonnet-4-6')).toBe(true)
  })
})

describe('Claude Code beta header — effort-style 3P gating', () => {
  test('does NOT send claude-code-20250219 to a non-Claude 3P model', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-leakcheck'
    process.env.ANTHROPIC_BASE_URL = 'https://api.minimaxi.com/anthropic'
    expect(getAllModelBetas('minimax-leakcheck-a')).not.toContain(
      'claude-code-20250219',
    )
  })

  test('agentic merge does NOT re-add claude-code-20250219 for a custom base URL', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-leakcheck'
    process.env.ANTHROPIC_BASE_URL = 'https://api.minimaxi.com/anthropic'
    expect(
      getMergedBetas('minimax-leakcheck-agentic', { isAgenticQuery: true }),
    ).not.toContain('claude-code-20250219')
  })

  test('a custom base URL can opt into claude-code-20250219 via override', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-leakcheck'
    process.env.ANTHROPIC_BASE_URL = 'https://gateway.example.com/anthropic'
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'claude-opus-4-8-leakcheck-b'
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES =
      'claude_code_beta'
    expect(getMergedBetas('claude-opus-4-8-leakcheck-b')).toContain(
      'claude-code-20250219',
    )
  })

  test('direct first-party still sends claude-code-20250219', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-leakcheck'
    delete process.env.ANTHROPIC_BASE_URL
    expect(getAllModelBetas('claude-opus-4-8-leakcheck-c')).toContain(
      'claude-code-20250219',
    )
  })
})
