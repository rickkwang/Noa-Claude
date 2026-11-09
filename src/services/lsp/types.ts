import type { z } from 'zod/v4'
import type { LspServerConfigSchema } from '../../utils/plugins/schemas.js'

/**
 * Lifecycle state of one LSP server instance. Legal transitions are listed in
 * LSP_TRANSITIONS in LSPServerInstance.ts.
 */
export type LspServerState =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'error'

export type LspServerConfig = z.infer<ReturnType<typeof LspServerConfigSchema>>

/** Plugin-provided server config, keyed by `plugin:<plugin>:<name>`. */
export type ScopedLspServerConfig = LspServerConfig & {
  scope: 'dynamic'
  source: string
}
