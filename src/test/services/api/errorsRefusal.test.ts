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

  test('uses the provider-aware lagging Sonnet default on Bedrock', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    const content = getTextContent('us.anthropic.claude-opus-4-7-v1:0')

    expect(content).toContain('claude-sonnet-4-6')
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
