import envPaths from 'env-paths'
import { tmpdir } from 'os'
import { join } from 'path'
import { getFsImplementation } from './fsOperations.js'
import { djb2Hash } from './hash.js'

const paths = envPaths('claude-cli')
const FALLBACK_CACHE_ROOT = join(tmpdir(), 'claude-cli-cache')
const OVERRIDE_CACHE_ROOT = process.env.CLAUDE_CODE_CACHE_DIR?.trim() || null

let resolvedCacheRoot: string | null = null

function ensureCacheRoot(dir: string): boolean {
  const probePath = join(dir, `.write-test-${process.pid}-${Date.now()}`)
  try {
    getFsImplementation().appendFileSync(probePath, '')
    getFsImplementation().unlinkSync(probePath)
    return true
  } catch {
    try {
      getFsImplementation().unlinkSync(probePath)
    } catch {
      // Ignore cleanup failures; this is only a write probe.
    }
    return false
  }
}

function getCacheRoot(): string {
  if (resolvedCacheRoot) {
    return resolvedCacheRoot
  }

  if (OVERRIDE_CACHE_ROOT) {
    if (ensureCacheRoot(OVERRIDE_CACHE_ROOT)) {
      resolvedCacheRoot = OVERRIDE_CACHE_ROOT
      return resolvedCacheRoot
    }
  }

  if (ensureCacheRoot(paths.cache)) {
    resolvedCacheRoot = paths.cache
    return resolvedCacheRoot
  }

  if (ensureCacheRoot(FALLBACK_CACHE_ROOT)) {
    resolvedCacheRoot = FALLBACK_CACHE_ROOT
    return resolvedCacheRoot
  }

  // Best effort: keep the original root if even the fallback cannot be created.
  resolvedCacheRoot = paths.cache
  return resolvedCacheRoot
}

// Local sanitizePath using djb2Hash — NOT the shared version from
// sessionStoragePortable.ts which uses Bun.hash (wyhash) when available.
// Cache directory names must remain stable across upgrades so existing cache
// data (error logs, MCP logs) is not orphaned.
const MAX_SANITIZED_LENGTH = 200
function sanitizePath(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9]/g, '-')
  if (sanitized.length <= MAX_SANITIZED_LENGTH) {
    return sanitized
  }
  return `${sanitized.slice(0, MAX_SANITIZED_LENGTH)}-${Math.abs(djb2Hash(name)).toString(36)}`
}

function getProjectDir(cwd: string): string {
  return sanitizePath(cwd)
}

export const CACHE_PATHS = {
  baseLogs: () => join(getCacheRoot(), getProjectDir(getFsImplementation().cwd())),
  errors: () =>
    join(getCacheRoot(), getProjectDir(getFsImplementation().cwd()), 'errors'),
  messages: () =>
    join(getCacheRoot(), getProjectDir(getFsImplementation().cwd()), 'messages'),
  mcpLogs: (serverName: string) =>
    join(
      getCacheRoot(),
      getProjectDir(getFsImplementation().cwd()),
      // Sanitize server name for Windows compatibility (colons are reserved for drive letters)
      `mcp-logs-${sanitizePath(serverName)}`,
    ),
}
