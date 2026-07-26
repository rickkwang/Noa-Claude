import { expect, test } from 'bun:test'
import * as toolSearch from '../../utils/toolSearch.js'

test('token counting cache distinguishes models with different tool prompts', () => {
  expect('getDeferredToolTokenCacheKey' in toolSearch).toBe(true)

  const getCacheKey = (
    toolSearch as Record<string, unknown>
  ).getDeferredToolTokenCacheKey as (
    tools: unknown[],
    model: string,
  ) => string
  const tools = [{ name: 'mcp__example__search', isMcp: true }]

  expect(getCacheKey(tools, 'claude-opus-5')).not.toBe(
    getCacheKey(tools, 'claude-fable-5'),
  )
  expect(getCacheKey(tools, 'claude-opus-5')).toBe(
    getCacheKey(tools, 'claude-opus-5'),
  )
})
