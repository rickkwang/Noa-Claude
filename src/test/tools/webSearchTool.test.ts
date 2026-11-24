import { afterEach, beforeEach, expect, test } from 'bun:test'
import { WebSearchTool } from '../../tools/WebSearchTool/WebSearchTool.js'

const envKeys = [
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_OPENAI',
  'NOA_CLAUDE_WEB_SEARCH_BACKEND',
] as const
const original = Object.fromEntries(envKeys.map(key => [key, process.env[key]]))

beforeEach(() => {
  for (const key of envKeys) delete process.env[key]
})

afterEach(() => {
  for (const key of envKeys) {
    if (original[key] === undefined) delete process.env[key]
    else process.env[key] = original[key]
  }
})

test('WebSearch on a custom Anthropic-compatible endpoint rejects the call with setup steps', async () => {
  process.env.ANTHROPIC_BASE_URL = 'https://api.minimaxi.com/anthropic'
  const result = await WebSearchTool.validateInput!({ query: 'bun release notes' })
  expect(result.result).toBe(false)
  expect(result.result === false && result.message).toContain('NOA_CLAUDE_WEB_SEARCH_BACKEND')
})
