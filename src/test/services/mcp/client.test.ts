import { describe, expect, test } from 'bun:test'
import { transformMCPResult } from '../../../services/mcp/client.js'

describe('MCP client result transformation', () => {
  test('preserves content blocks when structuredContent is also present', async () => {
    const result = await transformMCPResult(
      {
        content: [
          {
            type: 'text',
            text: 'visible content',
          },
        ],
        structuredContent: {
          count: 1,
          items: ['alpha'],
        },
      },
      'search',
      'test-server',
    )

    expect(result.type).toBe('contentArray')
    expect(Array.isArray(result.content)).toBe(true)
    const blocks = result.content as Array<{ type: string; text?: string }>
    expect(blocks.some(block => block.text === 'visible content')).toBe(true)
    expect(
      blocks.some(block =>
        block.text?.includes('[Structured content from test-server]'),
      ),
    ).toBe(true)
  })
})
