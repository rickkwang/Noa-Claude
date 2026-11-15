import { afterEach, expect, test } from 'bun:test'
import { WebSearchTool } from '../../tools/WebSearchTool/WebSearchTool.js'

const originalBaseUrl = process.env.ANTHROPIC_BASE_URL
afterEach(() => {
  if (originalBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL
  else process.env.ANTHROPIC_BASE_URL = originalBaseUrl
})

test('WebSearch on a custom Anthropic-compatible endpoint rejects the call with setup steps', async () => {
  process.env.ANTHROPIC_BASE_URL = 'https://api.minimaxi.com/anthropic'
  const result = await WebSearchTool.validateInput!({ query: 'bun release notes' })
  expect(result.result).toBe(false)
  expect(result.result === false && result.message).toContain('NOA_CLAUDE_WEB_SEARCH_BACKEND')
})
