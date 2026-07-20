// @ts-nocheck
import type { Message } from './message.js'

export type ShellProgress = {
  output: string
  fullOutput: string
  elapsedTimeSeconds?: number
  totalLines?: number
  totalBytes?: number
  timeoutMs?: number
  taskId?: string
}

export type BashProgress = ShellProgress & {
  stderr?: string
  stdout?: string
  interrupted?: boolean
  backgroundTaskId?: string
}

export type PowerShellProgress = ShellProgress & {
  stderr?: string
  stdout?: string
  interrupted?: boolean
  backgroundTaskId?: string
}

export type AgentToolProgress = {
  message: Message
}

export type SkillToolProgress = {
  message: Message
}

export type TaskOutputProgress = {
  taskDescription?: string
  taskType?: string
}

export type MCPProgress = {
  progress?: number
  total?: number
  progressMessage?: string
}

// Periodic keep-alive for a long-running tool call. Carries no tool output —
// only the elapsed time — so headless/remote consumers get a "still running"
// signal instead of silence. Emitted by startToolHeartbeat; the interactive
// REPL drops these frames and no progress is persisted, so they surface only
// on the headless/SDK output stream.
export type ToolHeartbeatProgress = {
  type: 'tool_heartbeat'
  toolName: string
  elapsedTimeSeconds: number
}

export type WebSearchProgress =
  | {
      type: 'query_update'
      query: string
    }
  | {
      type: 'search_results_received'
      query: string
      resultCount: number
    }

export type SdkWorkflowProgress = {
  type?: string
  phaseIndex?: number
  index?: number
  [key: string]: unknown
}

// REPL is a transparent wrapper: its progress emits a native-looking message
// for each inner tool call (mirrors AgentToolProgress/SkillToolProgress).
export type REPLToolProgress = {
  message: Message
}

/**
 * Union of every tool's progress payload. Used as the generic bound
 * `P extends ToolProgressData` across the Tool type and as the `data` carried
 * by tool ProgressMessages. Distinguished from HookProgress (which carries
 * `type: 'hook_progress'`) at filter boundaries.
 */
export type ToolProgressData =
  | BashProgress
  | PowerShellProgress
  | AgentToolProgress
  | SkillToolProgress
  | TaskOutputProgress
  | MCPProgress
  | ToolHeartbeatProgress
  | WebSearchProgress
  | SdkWorkflowProgress
  | REPLToolProgress
