import { describe, expect, test } from 'bun:test'
import { getMcpConfigForManifest } from '@anthropic-ai/mcpb'
import { validateManifest } from '../../utils/dxt/helpers.js'

describe('local MCPB stub', () => {
  test('accepts a minimal valid manifest', async () => {
    await expect(
      validateManifest({
        name: 'Example MCP server',
        author: { name: 'Noa' },
      }),
    ).resolves.toEqual({
      name: 'Example MCP server',
      author: { name: 'Noa' },
    })
  })

  test('rejects invalid manifests with field errors', async () => {
    await expect(
      validateManifest({
        author: { name: 'Noa' },
      }),
    ).rejects.toThrow('name: Name is required')
  })

  test('does not synthesize a fake MCP server config', async () => {
    await expect(
      getMcpConfigForManifest({
        manifest: {
          name: 'Example MCP server',
          author: { name: 'Noa' },
        },
        extensionPath: '/tmp/example',
        systemDirs: {},
      }),
    ).resolves.toBeNull()
  })
})
