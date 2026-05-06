import { describe, expect, test } from 'bun:test'
import { urlMatchesPattern } from '../../../services/mcp/config.js'

describe('MCP policy URL matching', () => {
  test('matches mixed-case URL schemes and hosts', () => {
    expect(
      urlMatchesPattern('HTTPS://Api.Example.com/v1', '*://api.example.com/*'),
    ).toBe(true)
  })
})
