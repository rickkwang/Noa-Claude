import { afterEach, expect, test } from 'bun:test'
import { WebSearchTool } from '../../tools/WebSearchTool/WebSearchTool.js'

const originalBaseUrl = process.env.ANTHROPIC_BASE_URL
afterEach(() => {
  if (originalBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL
  else process.env.ANTHROPIC_BASE_URL = originalBaseUrl
})

test('WebSearch is disabled for a custom Anthropic-compatible endpoint', () => {
  process.env.ANTHROPIC_BASE_URL = 'https://api.minimaxi.com/anthropic'
  expect(WebSearchTool.isEnabled()).toBe(false)
})
