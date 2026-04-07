// @ts-nocheck
declare module '@anthropic-ai/claude-agent-sdk' {
  export type PermissionMode = import('./permissions.js').PermissionMode
}

declare module '@anthropic-ai/sandbox-runtime' {
  export type FsReadRestrictionConfig = {
    denyOnly: string[]
    allowWithinDeny?: string[]
  }
  export type FsWriteRestrictionConfig = {
    allowOnly: string[]
    denyWithinAllow: string[]
  }
  export type NetworkHostPattern = string | { host?: string }
  export type NetworkRestrictionConfig = {
    allowedHosts?: string[]
    deniedHosts?: string[]
  }
  export type IgnoreViolationsConfig = Record<string, string[]>
  export type SandboxAskCallback = (
    hostPattern: NetworkHostPattern,
  ) => boolean | Promise<boolean>
  export type SandboxDependencyCheck = {
    warnings: string[]
    errors?: string[]
  }
  export type SandboxRuntimeConfig = Record<string, unknown>
  export type SandboxViolationEvent = Record<string, unknown>

  export class SandboxViolationStore {
    getTotalCount(): number
    subscribe(listener: () => void): () => void
  }

  export const SandboxRuntimeConfigSchema: unknown
  export const SandboxManager: Record<string, (...args: any[]) => any>
}
