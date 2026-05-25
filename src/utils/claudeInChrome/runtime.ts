// @ts-nocheck
import { existsSync } from 'fs'
import { createRequire } from 'module'
import { join } from 'path'

const require = createRequire(import.meta.url)
const CHROME_MCP_PACKAGE_NAME = '@ant/claude-for-chrome-mcp'
const CHROME_MCP_PACKAGE_PATH_SEGMENTS = ['@ant', 'claude-for-chrome-mcp']

type ChromeMcpModule = {
  BROWSER_TOOLS?: Array<{ name: string }>
  createClaudeForChromeMcpServer?: (context: unknown) => {
    connect: (transport: unknown) => Promise<void>
  }
}

let chromeMcpModule: ChromeMcpModule | null = null
let chromeMcpModuleLoadError: unknown = null

function hasInstalledChromeMcpPackage(): boolean {
  const searchPaths = require.resolve.paths(CHROME_MCP_PACKAGE_NAME) ?? []

  for (const searchPath of searchPaths) {
    const packageJsonPath = join(
      searchPath,
      ...CHROME_MCP_PACKAGE_PATH_SEGMENTS,
      'package.json',
    )
    if (existsSync(packageJsonPath)) {
      return true
    }
  }

  return false
}

if (hasInstalledChromeMcpPackage()) {
  try {
    chromeMcpModule = require(CHROME_MCP_PACKAGE_NAME) as ChromeMcpModule
  } catch (error) {
    chromeMcpModuleLoadError = error
  }
}

export const HAS_CLAUDE_FOR_CHROME_MCP = chromeMcpModule !== null

export const BROWSER_TOOLS = chromeMcpModule?.BROWSER_TOOLS ?? []

export function assertClaudeForChromeMcpAvailable(): void {
  if (chromeMcpModuleLoadError) {
    const message =
      chromeMcpModuleLoadError instanceof Error
        ? chromeMcpModuleLoadError.message
        : String(chromeMcpModuleLoadError)
    throw new Error(
      `Claude in Chrome MCP support failed to load from ${CHROME_MCP_PACKAGE_NAME}: ${message}`,
    )
  }

  if (!chromeMcpModule) {
    throw new Error(
      `Claude in Chrome MCP support is unavailable in this environment because ${CHROME_MCP_PACKAGE_NAME} is not installed.`,
    )
  }
}

export function createClaudeForChromeMcpServer(context: unknown): {
  connect: (transport: unknown) => Promise<void>
} {
  assertClaudeForChromeMcpAvailable()
  const factory = chromeMcpModule?.createClaudeForChromeMcpServer
  if (!factory) {
    throw new Error(
      `Claude in Chrome MCP support is unavailable in this environment because ${CHROME_MCP_PACKAGE_NAME} does not export createClaudeForChromeMcpServer.`,
    )
  }

  return factory(context)
}
