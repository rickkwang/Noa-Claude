import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { APIError } from '@anthropic-ai/sdk'
import {
  getAssistantMessageFromError,
  getErrorMessageIfRefusal,
} from '../../../services/api/errors.js'

const ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
] as const
const original = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]))

function getTextContent(model: string): string {
  const result = getErrorMessageIfRefusal('refusal', model)
  expect(result).toBeDefined()
  const content = result?.message?.content
  expect(Array.isArray(content)).toBe(true)
  return (content as Array<{ type: string; text?: string }>)
    .filter(block => block.type === 'text')
    .map(block => block.text ?? '')
    .join('')
}

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key]
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = original[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('refusal model suggestion', () => {
  test('uses the direct Anthropic Sonnet default', () => {
    const content = getTextContent('claude-opus-4-8')

    expect(content).toContain('/model claude-sonnet-5')
  })

  test('uses the provider-aware Sonnet default on Bedrock', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    const content = getTextContent('us.anthropic.claude-opus-4-7-v1:0')

    expect(content).toContain('claude-sonnet-4-5')
    expect(content).not.toContain('claude-sonnet-5')
  })

  test('does not recommend a Claude model on OpenAI-compatible providers', () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    const content = getTextContent('gpt-5.1')

    expect(content).not.toContain('try running /model')
  })

  test('does not invent a model for custom Anthropic-compatible endpoints', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://example.test/anthropic'
    const content = getTextContent('custom-model')

    expect(content).not.toContain('try running /model')
  })

  test('honors an explicit Sonnet default on custom endpoints', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://example.test/anthropic'
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = 'custom-sonnet'
    const content = getTextContent('custom-opus')

    expect(content).toContain('/model custom-sonnet')
  })
})

describe('third-party 401 handling', () => {
  const make401 = (message: string) =>
    new APIError(401, { error: { message } }, message, new Headers())

  function getErrorKind(error: APIError): {
    kind: string | undefined
    text: string
  } {
    const result = getAssistantMessageFromError(error, 'test-model') as {
      error?: string
      message?: { content?: unknown }
    }
    const content = result.message?.content
    const text = Array.isArray(content)
      ? (content as Array<{ type: string; text?: string }>)
          .filter(block => block.type === 'text')
          .map(block => block.text ?? '')
          .join('')
      : ''
    return { kind: result.error, text }
  }

  test('x-api-key 401 on a third-party provider is invalid_request, not authentication_failed', () => {
    // 'authentication_failed' triggers the VS Code extension's showLogin(),
    // which cannot fix a third-party key. Several gateways echo the header
    // name in their 401 body, which routes into the x-api-key branch.
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    const { kind, text } = getErrorKind(make401('Invalid x-api-key'))

    expect(kind).toBe('invalid_request')
    expect(text).toContain('Failed to authenticate')
    expect(text).not.toContain('/login')
  })

  test('x-api-key 401 on first-party keeps authentication_failed', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-dummy'
    const { kind } = getErrorKind(make401('Invalid x-api-key'))

    expect(kind).toBe('authentication_failed')
  })
})

// Upstream 2.1.258 arms a refusal fallback only for models whose safety
// classifiers can decline a request: `claude-fable-*` and Opus 5. Its target is
// the constant `claude-opus-4-8`, resolved through ANTHROPIC_DEFAULT_OPUS_MODEL
// when set. Mythos models are guarded out ahead of the capability check and get
// no fallback at all.
describe('armed refusal fallback target', () => {
  test('Fable 5.1 is sent to Opus 4.8, not down to Sonnet', () => {
    const content = getTextContent('claude-fable-5-1')

    expect(content).toContain('/model claude-opus-4-8')
    expect(content).not.toContain('claude-sonnet')
  })

  test('Fable 5 and Opus 5 take the same target', () => {
    for (const model of ['claude-fable-5', 'claude-opus-5']) {
      expect(getTextContent(model)).toContain('/model claude-opus-4-8')
    }
  })

  test('a pinned opus model wins over the constant', () => {
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'my-opus-alias'
    expect(getTextContent('claude-fable-5-1')).toContain('/model my-opus-alias')
  })

  test('Mythos gets no armed fallback, so it keeps the Sonnet suggestion', () => {
    expect(getTextContent('claude-mythos-5-1')).toContain('/model claude-sonnet-5')
  })

  test('models without the capability keep the Sonnet suggestion', () => {
    for (const model of ['claude-opus-4-8', 'claude-sonnet-5']) {
      expect(getTextContent(model)).not.toContain('claude-opus-4-8 ')
    }
    expect(getTextContent('claude-opus-4-8')).toContain('/model claude-sonnet-5')
  })
})
