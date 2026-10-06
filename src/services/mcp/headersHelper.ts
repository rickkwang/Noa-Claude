// @ts-nocheck
import { getIsNonInteractiveSession, getOriginalCwd } from '../../bootstrap/state.js'
import { getProjectTrustKey, hasPersistedProjectTrust, isPathTrusted } from '../../utils/config.js'
import { getGlobalClaudeFile } from '../../utils/env.js'
import { errorMessage } from '../../utils/errors.js'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import { logError, logMCPDebug, logMCPError } from '../../utils/log.js'
import { jsonParse } from '../../utils/slowOperations.js'
import { credentialFreeSubprocessEnv, subprocessEnv } from '../../utils/subprocessEnv.js'
import type {
  McpHTTPServerConfig,
  McpSSEServerConfig,
  McpWebSocketServerConfig,
  ScopedMcpServerConfig,
} from './types.js'

/**
 * Check if the MCP server config comes from project settings (projectSettings or localSettings)
 * This is important for security checks
 */
function isMcpServerFromProjectOrLocalSettings(
  config: ScopedMcpServerConfig,
): boolean {
  return config.scope === 'project' || config.scope === 'local'
}

// Repository config names and paths reach the terminal; keep them inert.
function printable(value: string): string {
  return value.replace(/[\p{Cc}\p{Cf}\u2028\u2029]+/gu, ' ')
}

const reportedMissingTrust = new Set<string>()

/**
 * Get dynamic headers for an MCP server using the headersHelper script
 * @param serverName The name of the MCP server
 * @param config The MCP server configuration
 * @returns Headers object or null if not configured or failed
 */
export async function getMcpHeadersFromHelper(
  serverName: string,
  config: McpSSEServerConfig | McpHTTPServerConfig | McpWebSocketServerConfig,
): Promise<Record<string, string> | null> {
  if (!config.headersHelper) {
    return null
  }

  const scope = 'scope' in config ? (config as ScopedMcpServerConfig).scope : undefined
  const repoResident = scope !== undefined && isMcpServerFromProjectOrLocalSettings(config as ScopedMcpServerConfig)
  // The directory whose trust authorizes the helper; it also runs there, so
  // a relative helper path keeps meaning the same file after /cd.
  const sourceDir = repoResident ? (config as ScopedMcpServerConfig).sourceDir ?? getOriginalCwd() : undefined
  if (sourceDir !== undefined && !hasPersistedProjectTrust(sourceDir)) {
    const configFix = `set projects[${JSON.stringify(printable(getProjectTrustKey(sourceDir)))}].hasTrustDialogAccepted in ${printable(getGlobalClaudeFile())}`
    // Trust inherited from a parent folder suppresses the trust dialog, so
    // only the config edit can grant this workspace its own trust.
    const fix = isPathTrusted(sourceDir)
      ? `trust inherited from a parent folder does not count and the trust dialog will not appear there; ${configFix}`
      : `accept the trust dialog in ${printable(sourceDir)} once interactively, or ${configFix}`
    const message = `MCP server '${printable(serverName)}': headersHelper not run — this workspace has no persisted trust; ${fix}. Using static headers only.`
    logMCPDebug(serverName, message)
    if (getIsNonInteractiveSession() && !reportedMissingTrust.has(serverName)) {
      reportedMissingTrust.add(serverName)
      process.stderr.write(message + '\n')
    }
    return null
  }

  // Pass server context so one helper script can serve multiple MCP servers
  // (git credential-helper style). See deshaw/anthropic-issues#28.
  const serverContext = {
    CLAUDE_CODE_MCP_SERVER_NAME: serverName,
    CLAUDE_CODE_MCP_SERVER_URL: config.url,
  }
  try {
    logMCPDebug(serverName, 'Executing headersHelper to get dynamic headers')
    const execResult = await execFileNoThrowWithCwd(config.headersHelper, [], {
      shell: true,
      timeout: 10000,
      cwd: sourceDir,
      extendEnv: false,
      // A .mcp.json helper's output goes to a repository-chosen URL, so it
      // inherits no credentials from the environment.
      env: scope === 'project'
        ? credentialFreeSubprocessEnv(serverContext)
        : { ...subprocessEnv(), ...serverContext },
    })
    if (execResult.code !== 0 || !execResult.stdout) {
      throw new Error(
        `headersHelper for MCP server '${serverName}' did not return a valid value`,
      )
    }
    const result = execResult.stdout.trim()

    const headers = jsonParse(result)
    if (
      typeof headers !== 'object' ||
      headers === null ||
      Array.isArray(headers)
    ) {
      throw new Error(
        `headersHelper for MCP server '${serverName}' must return a JSON object with string key-value pairs`,
      )
    }

    // Validate all values are strings
    for (const [key, value] of Object.entries(headers)) {
      if (typeof value !== 'string') {
        throw new Error(
          `headersHelper for MCP server '${serverName}' returned non-string value for key "${key}": ${typeof value}`,
        )
      }
    }

    logMCPDebug(
      serverName,
      `Successfully retrieved ${Object.keys(headers).length} headers from headersHelper`,
    )
    return headers as Record<string, string>
  } catch (error) {
    logMCPError(
      serverName,
      `Error getting headers from headersHelper: ${errorMessage(error)}`,
    )
    logError(
      new Error(
        `Error getting MCP headers from headersHelper for server '${serverName}': ${errorMessage(error)}`,
      ),
    )
    // Return null instead of throwing to avoid blocking the connection
    return null
  }
}

/**
 * Get combined headers for an MCP server (static + dynamic)
 * @param serverName The name of the MCP server
 * @param config The MCP server configuration
 * @returns Combined headers object
 */
export async function getMcpServerHeaders(
  serverName: string,
  config: McpSSEServerConfig | McpHTTPServerConfig | McpWebSocketServerConfig,
): Promise<Record<string, string>> {
  const staticHeaders = config.headers || {}
  const dynamicHeaders =
    (await getMcpHeadersFromHelper(serverName, config)) || {}

  // Dynamic headers override static headers if both are present
  return {
    ...staticHeaders,
    ...dynamicHeaders,
  }
}
