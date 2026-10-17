import { describe, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import { toolAlwaysAllowedRule } from '../../utils/permissions/permissions.js'

type McpToolLike = {
  name: string
  mcpInfo?: { serverName: string; toolName: string }
}

function isAllowed(tool: McpToolLike, allowRules: string[]): boolean {
  const context = {
    ...getEmptyToolPermissionContext(),
    alwaysAllowRules: { localSettings: allowRules },
  }
  return toolAlwaysAllowedRule(context, tool) !== null
}

describe('MCP server-level permission rules use the whole normalized server name', () => {
  const tool: McpToolLike = {
    name: 'mcp__my__server__tool',
    mcpInfo: { serverName: 'my__server', toolName: 'tool' },
  }

  test('matches the whole normalized server name', () => {
    expect(isAllowed(tool, ['mcp__my__server'])).toBe(true)
    expect(isAllowed(tool, ['mcp__my__server__*'])).toBe(true)
    expect(isAllowed(tool, ['mcp__my__server__tool'])).toBe(true)
  })

  test('does not match a truncated server name', () => {
    expect(isAllowed(tool, ['mcp__my'])).toBe(false)
    expect(isAllowed(tool, ['mcp__my__*'])).toBe(false)
  })

  test('does not match a prefix-overlapping server', () => {
    const overlap: McpToolLike = {
      name: 'mcp__foo__bar__run',
      mcpInfo: { serverName: 'foo__bar', toolName: 'run' },
    }
    expect(isAllowed(overlap, ['mcp__foo__*'])).toBe(false)
    expect(isAllowed(overlap, ['mcp__foo__bar__*'])).toBe(true)
  })

  test('normalizes special characters in the server name', () => {
    const spaced: McpToolLike = {
      name: 'mcp__my_server__tool',
      mcpInfo: { serverName: 'my server', toolName: 'tool' },
    }
    expect(isAllowed(spaced, ['mcp__my_server__*'])).toBe(true)
    expect(isAllowed(spaced, ['mcp__my_server'])).toBe(true)
  })

  test('still matches ordinary server rules', () => {
    const github: McpToolLike = {
      name: 'mcp__github__search',
      mcpInfo: { serverName: 'github', toolName: 'search' },
    }
    expect(isAllowed(github, ['mcp__github__*'])).toBe(true)
    expect(isAllowed(github, ['mcp__github'])).toBe(true)
    expect(isAllowed(github, ['mcp__gitlab__*'])).toBe(false)
  })
})
