import { afterEach, describe, expect, test } from 'bun:test'
import { WebSearchTool } from '../../tools/WebSearchTool/WebSearchTool.js'

const ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_VERTEX',
] as const

const original = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]))

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (original[k] === undefined) delete process.env[k]
    else process.env[k] = original[k]
  }
})

describe('WebSearchTool provider gating', () => {
  test('enables web search on direct first-party', () => {
    delete process.env.ANTHROPIC_BASE_URL
    expect(WebSearchTool.isEnabled()).toBe(true)
  })

  test('does not enable web search for custom Anthropic-compatible base URL', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://api.minimaxi.com/anthropic'
    expect(WebSearchTool.isEnabled()).toBe(false)
  })
})
