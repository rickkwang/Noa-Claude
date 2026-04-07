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
