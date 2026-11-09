import { z } from 'zod/v4'
import {
  ensureConnectedClient,
  getMcpToolTimeoutMs,
} from '../../services/mcp/client.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { recursivelySanitizeUnicode } from '../../utils/sanitization.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { DESCRIPTION, DIRECTORY_READ_EXTENSION, PROMPT } from './prompt.js'

// Matches upstream: pages are followed up to this limit, then the listing is
// marked incomplete rather than read to the end.
const MAX_PAGES = 20
// JSON-RPC error code for invalid params (the SDK's ErrorCode.InvalidParams).
const INVALID_PARAMS = -32602

export function serverDeclaresDirectoryRead(
  capabilities:
    | { extensions?: Record<string, { directoryRead?: unknown } | undefined> }
    | undefined,
): boolean {
  return capabilities?.extensions?.[DIRECTORY_READ_EXTENSION]?.directoryRead === true
}

const directoryPageSchema = z.object({
  resources: z.array(
    z.object({
      uri: z.string(),
      name: z.string(),
      mimeType: z.string().optional(),
    }),
  ),
  nextCursor: z.string().optional(),
})

export const inputSchema = lazySchema(() =>
  z.object({
    server: z.string().describe('The MCP server name'),
    uri: z.string().describe('The directory resource URI to list'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

export const outputSchema = lazySchema(() =>
  z.object({
    entries: z.array(
      z.object({
        uri: z.string().describe('Child resource URI'),
        name: z.string().describe('Child resource name'),
        mimeType: z.string().optional().describe('Child MIME type'),
      }),
    ),
    incomplete: z
      .boolean()
      .describe(
        'True when the listing is not complete: it stopped at the page limit, or the server rejected a later page cursor',
      ),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

export const ReadMcpResourceDirTool = buildTool({
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return `${input.server} ${input.uri}`
  },
  shouldDefer: true,
  name: 'ReadMcpResourceDirTool',
  searchHint: 'list the children of an MCP directory resource',
  maxResultSizeChars: 100_000,
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return PROMPT
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  renderToolUseMessage(input) {
    return `${input.server} ${input.uri}`
  },
  async call(input, { options: { mcpClients }, abortController }) {
    const { server: serverName, uri } = input

    const client = mcpClients.find(client => client.name === serverName)

    if (!client) {
      throw new Error(
        `Server "${serverName}" not found. Available servers: ${mcpClients.map(c => c.name).join(', ')}`,
      )
    }

    if (client.type !== 'connected') {
      throw new Error(`Server "${serverName}" is not connected`)
    }

    if (!serverDeclaresDirectoryRead(client.capabilities)) {
      throw new Error(`Server "${serverName}" does not support directory listing`)
    }

    const connectedClient = await ensureConnectedClient(client)
    const entries = []
    let cursor
    let incomplete = false
    for (let page = 1; ; page++) {
      let result
      try {
        result = await connectedClient.client.request(
          {
            method: 'resources/directory/read',
            params: { uri, ...(cursor !== undefined && { cursor }) },
          },
          directoryPageSchema,
          { signal: abortController.signal, timeout: getMcpToolTimeoutMs() },
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if ((error as { code?: unknown } | null)?.code !== INVALID_PARAMS) {
          // Timeouts, cancellation, and server failures are errors, not an
          // incomplete listing.
          throw new Error(`Could not list "${uri}" on server "${serverName}": ${message}`)
        }
        if (page === 1) {
          throw new Error(
            `Not a directory resource: ${uri}. The server rejected the request. If it is a file resource, use ReadMcpResourceTool instead.`,
          )
        }
        // A later page's cursor was rejected: keep the pages already read.
        incomplete = true
        break
      }
      entries.push(...recursivelySanitizeUnicode(result.resources))
      cursor = result.nextCursor
      if (!cursor) break
      if (page >= MAX_PAGES) {
        incomplete = true
        break
      }
    }

    return { data: { entries, incomplete } }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: jsonStringify(content),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
