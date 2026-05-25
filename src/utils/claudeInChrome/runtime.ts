// @ts-nocheck
import { existsSync } from 'fs'
import { createRequire } from 'module'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const require = createRequire(import.meta.url)
const currentDir = dirname(fileURLToPath(import.meta.url))
const chromeMcpPackageJsonPath = join(
  currentDir,
  '..',
  '..',
  '..',
  'node_modules',
  '@ant',
  'claude-for-chrome-mcp',
  'package.json',
)

type ChromeMcpModule = {
  BROWSER_TOOLS?: Array<{ name: string }>
  createClaudeForChromeMcpServer?: (context: unknown) => {
    connect: (transport: unknown) => Promise<void>
  }
}

let chromeMcpModule: ChromeMcpModule | null = null

if (existsSync(chromeMcpPackageJsonPath)) {
  try {
    chromeMcpModule = require('@ant/claude-for-chrome-mcp') as ChromeMcpModule
  } catch {
    chromeMcpModule = null
  }
}

export const HAS_CLAUDE_FOR_CHROME_MCP = chromeMcpModule !== null

export const BROWSER_TOOLS = chromeMcpModule?.BROWSER_TOOLS ?? []

export function createClaudeForChromeMcpServer(context: unknown): {
  connect: (transport: unknown) => Promise<void>
} {
  const factory = chromeMcpModule?.createClaudeForChromeMcpServer
  if (!factory) {
    throw new Error(
      'Claude in Chrome MCP support is unavailable in this environment because @ant/claude-for-chrome-mcp is not installed.',
    )
  }

  return factory(context)
}
