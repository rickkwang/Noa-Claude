import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { setCwdState } from '../../../bootstrap/state.js'
import { addMcpConfig, removeMcpConfig } from '../../../services/mcp/config.js'
import { isRemoteHttpsHostnameConfig } from '../../../services/mcp/useManageMCPConnections.js'
import { getCwd } from '../../../utils/cwd.js'
import { getPrimaryProjectMcpPath } from '../../../utils/productPaths.js'

const origCwd = getCwd()
let tempDir: string | undefined

afterEach(() => {
  setCwdState(origCwd)
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true })
    tempDir = undefined
  }
})

describe('MCP config hardening', () => {
  test('addMcpConfig and removeMcpConfig preserve top-level .mcp.json fields', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'noa-mcp-json-'))
    setCwdState(tempDir)
    const mcpPath = getPrimaryProjectMcpPath(tempDir)
    mkdirSync(dirname(mcpPath), { recursive: true })
    writeFileSync(
      mcpPath,
      JSON.stringify(
        {
          $schema: 'https://example.com/mcp.schema.json',
          customMeta: { owner: 'team-a' },
          mcpServers: {
            existing: { type: 'stdio', command: 'echo', args: ['hi'] },
          },
        },
        null,
        2,
      ),
    )

    await addMcpConfig(
      'added',
      { type: 'http', url: 'https://mcp.example.com/mcp' },
      'project',
    )
    const afterAdd = JSON.parse(readFileSync(mcpPath, 'utf8'))
    expect(afterAdd.$schema).toBe('https://example.com/mcp.schema.json')
    expect(afterAdd.customMeta).toEqual({ owner: 'team-a' })
    expect(afterAdd.mcpServers.existing).toBeDefined()
    expect(afterAdd.mcpServers.added).toBeDefined()

    await removeMcpConfig('added', 'project')
    const afterRemove = JSON.parse(readFileSync(mcpPath, 'utf8'))
    expect(afterRemove.$schema).toBe('https://example.com/mcp.schema.json')
    expect(afterRemove.customMeta).toEqual({ owner: 'team-a' })
    expect(afterRemove.mcpServers.added).toBeUndefined()
    expect(afterRemove.mcpServers.existing).toBeDefined()
  })

  test('refuses to overwrite .mcp.json with unexpected top-level or mcpServers shape', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'noa-mcp-bad-'))
    setCwdState(tempDir)
    const mcpPath = getPrimaryProjectMcpPath(tempDir)
    mkdirSync(dirname(mcpPath), { recursive: true })
    writeFileSync(mcpPath, '["not", "an", "object"]')

    await expect(
      addMcpConfig(
        'test',
        { type: 'http', url: 'https://mcp.example.com/mcp' },
        'project',
      ),
    ).rejects.toThrow()
    expect(readFileSync(mcpPath, 'utf8')).toBe('["not", "an", "object"]')
  })
})

describe('isRemoteHttpsHostnameConfig', () => {
  test('matches remote https hostnames and excludes loopback, http, and stdio', () => {
    expect(
      isRemoteHttpsHostnameConfig({
        type: 'http',
        url: 'https://mcp.example.com/mcp',
      }),
    ).toBe(true)
    expect(
      isRemoteHttpsHostnameConfig({
        type: 'sse',
        url: 'https://api.service.dev/sse',
      }),
    ).toBe(true)
    expect(
      isRemoteHttpsHostnameConfig({
        type: 'http',
        url: 'https://localhost:8443/mcp',
      }),
    ).toBe(false)
    expect(
      isRemoteHttpsHostnameConfig({
        type: 'http',
        url: 'https://127.0.0.1:8443/mcp',
      }),
    ).toBe(false)
    expect(
      isRemoteHttpsHostnameConfig({
        type: 'http',
        url: 'http://mcp.example.com/mcp',
      }),
    ).toBe(false)
    expect(isRemoteHttpsHostnameConfig({ type: 'stdio' })).toBe(false)
  })
})
