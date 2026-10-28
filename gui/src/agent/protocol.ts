// Subset of the stream-json protocol the GUI consumes.
// Source of truth: src/entrypoints/sdk/coreSchemas.ts and controlSchemas.ts.
// Unknown message types fall through the reducer's default branch.

export type PermissionMode = "default" | "acceptEdits" | "plan" | "auto" | "bypassPermissions" | "dontAsk"

export interface ImageAttachment {
  id: string
  name: string
  dataUrl: string
}

export type UserContent = string | (Extract<ContentBlock, { type: "text" }> | ImageBlock)[]
export interface ImageBlock { type: "image"; source: { type: "base64"; media_type: string; data: string } }
export interface QueuedMessage { id: string; content: UserContent }

export interface ElicitationRequest {
  subtype: "elicitation"
  mcp_server_name: string
  message: string
  mode?: "form" | "url"
  url?: string
  elicitation_id?: string
  requested_schema?: Record<string, unknown>
}

export type ContentBlock =
  | ImageBlock
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: unknown; is_error?: boolean; tool_use_result?: unknown }

export type StreamEvent =
  | { type: "message_start"; message: { id: string } }
  | { type: "message_stop" }
  | {
      type: "content_block_start"
      index?: number
      content_block: { type: "text" } | { type: "thinking" } | { type: "tool_use"; id: string; name: string }
    }
  | {
      type: "content_block_delta"
      index?: number
      delta:
        | { type: "text_delta"; text: string }
        | { type: "thinking_delta"; thinking: string }
        | { type: "input_json_delta"; partial_json: string }
    }
  | { type: "content_block_stop"; index?: number }

export interface PermissionRequest {
  subtype: "can_use_tool"
  tool_name: string
  tool_use_id: string
  input: Record<string, unknown>
  title?: string
  description?: string
  decision_reason?: string
  permission_suggestions?: unknown[]
}

export interface ModelInfo {
  value: string
  displayName: string
  description: string
  supportsEffort?: boolean
  supportedEffortLevels?: string[]
  supportsAutoMode?: boolean
}

export interface AccountInfo {
  email?: string
  organization?: string
  subscriptionType?: string
  tokenSource?: string
  apiKeySource?: string
  apiProvider?: string
}

export interface SlashCommand {
  type?: "prompt" | "local" | "local-jsx"
  source?: string
  aliases?: string[]
  hidden?: boolean
  name: string
  description: string
  argumentHint: string
}

export interface ContextUsage {
  totalTokens: number
  maxTokens: number
  percentage: number
  model: string
  rawMaxTokens?: number
  autocompactSource?: "env" | "settings" | "model-default" | "unknown-model" | "auto"
  categories?: { id?: string; name: string; tokens: number; isDeferred?: boolean; kind?: "used" | "free" | "buffer" | "deferred" }[]
  memoryFiles?: { path: string; type: string; tokens: number }[]
  mcpTools?: { name: string; serverName: string; tokens: number; isLoaded?: boolean }[]
  mcpInstructions?: { serverName: string; tokens: number }[]
  systemTools?: { name: string; tokens: number }[]
  systemPromptSections?: { name: string; tokens: number }[]
  agents?: { agentType: string; source: string; tokens: number; pluginId?: string; path?: string }[]
  skills?: { totalSkills: number; includedSkills: number; tokens: number; skillFrontmatter: { name: string; source: string; pluginName?: string; tokens: number }[] }
  isAutoCompactEnabled?: boolean
  autoCompactThreshold?: number
  apiUsage?: { input_tokens: number; output_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number } | null
}

export interface McpServerStatus {
  name: string
  status: "connected" | "failed" | "needs-auth" | "pending" | "disabled"
}

// Responses to requests the GUI sent, keyed by request_id on the client.
export type ControlPayload =
  | { kind: "initialize"; models: ModelInfo[]; commands: SlashCommand[]; account?: AccountInfo }
  | { kind: "context_usage"; usage: ContextUsage }
  | { kind: "mcp_status"; servers: McpServerStatus[] }
  | { kind: "commands"; commands: SlashCommand[] }

export interface RateLimitInfo {
  status: "allowed" | "allowed_warning" | "rejected"
  resetsAt?: number
  rateLimitType?: "five_hour" | "seven_day" | "seven_day_opus" | "seven_day_sonnet" | "overage"
  utilization?: number
}

export type AgentMessage =
  | { type: "system"; subtype: "elicitation_complete"; mcp_server_name: string; elicitation_id: string }
  | { type: "system"; subtype: "hook_started" | "hook_progress" | "hook_response"; hook_id: string; hook_name: string; hook_event: string; stdout?: string; stderr?: string; output?: string; exit_code?: number; outcome?: "success" | "error" | "cancelled" }
  | { type: "rate_limit_event"; rate_limit_info: RateLimitInfo }
  | { type: "tool_progress"; tool_use_id: string; tool_name: string; parent_tool_use_id: string | null; elapsed_time_seconds: number; heartbeat?: boolean }
  | { type: "system"; subtype: "compact_boundary"; compact_metadata: { trigger: "manual" | "auto"; pre_tokens?: number } }
  | { type: "system"; subtype: "api_retry"; attempt: number; max_retries: number; retry_delay_ms: number; error_status?: number | null }
  | { type: "system"; subtype: "task_started" | "task_progress" | "task_notification"; task_id: string; tool_use_id?: string; description?: string; summary?: string; status?: "completed" | "failed" | "stopped" | "unknown"; last_tool_name?: string; output_file?: string; usage?: { total_tokens: number; tool_uses: number; duration_ms: number } }
  | { type: "system"; subtype: "status" | "session_state_changed"; status?: string | null; permissionMode?: PermissionMode; state?: "idle" | "running" | "requires_action" }
  | {
      type: "system"
      subtype: "init"
      model: string
      permissionMode: PermissionMode
      session_id: string
    }
  | { type: "stream_event"; event: StreamEvent; parent_tool_use_id: string | null }
  | { type: "assistant"; message: { id?: string; content: ContentBlock[] }; parent_tool_use_id: string | null }
  | {
      type: "user"
      message: { content: ContentBlock[] | string }
      parent_tool_use_id: string | null
      tool_use_result?: unknown
    }
  | {
      type: "result"
      subtype: string
      is_error: boolean
      result?: string
      errors?: string[]
      duration_ms: number
      total_cost_usd?: number
      parent_tool_use_id?: string | null
    }
  | { type: "control_request"; request_id: string; request: PermissionRequest | ElicitationRequest | { subtype: string } }
  | { type: "control_cancel_request"; request_id: string }
  | {
      type: "control_response"
      response: { subtype: "success" | "error"; request_id: string; response?: unknown; error?: string }
    }

export interface TurnDiffFile {
  path: string
  // Repo-relative path used inside the patch, when it differs from `path`.
  patchPath?: string
  additions: number
  deletions: number
  binary?: boolean
  tooLarge?: boolean
}

export interface TurnDiff {
  files: TurnDiffFile[]
  additions: number
  deletions: number
  patch?: string
  truncated?: boolean
  // Cross-source patches are reviewable but cannot be applied against one Git root.
  undoable?: boolean
  // Bridge-assigned turn number; used to update or revert one turn in place.
  turnIndex?: number
  // Set after Undo so the same card offers Reapply.
  reverted?: boolean
}

export interface TurnDiffActionResult {
  ok: boolean
  errorCode?: "not-git-repo" | "no-patch" | "apply-failed"
  error?: string
  appliedPaths: string[]
  skippedPaths: string[]
  conflictedPaths: string[]
}

export type Envelope =
  | { kind: "interrupt" }
  | { kind: "attached"; runtimeId: string }
  | { kind: "history"; items: HistoryItem[]; before?: number; prepend?: boolean }
  | { kind: "user"; id: string; content: UserContent }
  | { kind: "queue"; messages: QueuedMessage[]; paused?: boolean }
  | { kind: "agent"; message: AgentMessage }
  | { kind: "turn-diff"; diff: TurnDiff; updateOnly?: boolean }
  // While a turn runs, the bridge streams its diff so the composer can show a
  // live summary, as Codex does above the composer.
  | { kind: "turn-diff-live"; diff: TurnDiff }
  | {
      kind: "turn-diff-action"
      turnIndex: number
      action: "undo" | "reapply"
      result: TurnDiffActionResult
    }
  | { kind: "log"; text: string }
  | { kind: "exit"; code: number | null }

// Messages the GUI writes to the agent's stdin.
export type Outgoing =
  | { type: "history_before"; before: number }
  | { type: "user"; message: { role: "user"; content: UserContent }; parent_tool_use_id: null; uuid?: string }
  | { type: "queue_remove"; id: string }
  | { type: "queue_move"; id: string; toIndex: number }
  | { type: "queue_update"; id: string; content: UserContent }
  | { type: "queue_steer"; id: string }
  | { type: "queue_pause"; paused: boolean }
  | { type: "queue_run" }
  | { type: "turn_diff_action"; turnIndex: number; action: "undo" | "reapply" }
  | { type: "control_request"; request_id: string; request: ControlRequest }
  | {
      type: "control_response"
      response: {
        subtype: "success"
        request_id: string
        response:
          | { behavior: "allow"; updatedInput: Record<string, unknown>; updatedPermissions?: unknown[] }
          | { behavior: "deny"; message: string }
          | { action: "accept" | "decline" | "cancel"; content?: Record<string, unknown> }
      }
    }

export type ControlRequest =
  | { subtype: "initialize" }
  | { subtype: "interrupt" }
  | { subtype: "stop_task"; task_id: string }
  | { subtype: "set_model"; model: string }
  | { subtype: "set_permission_mode"; mode: PermissionMode }
  | { subtype: "get_context_usage" }
  | { subtype: "mcp_status" }
  | { subtype: "get_settings" }
  | { subtype: "reload_plugins" }
  | { subtype: "apply_flag_settings"; settings: { effortLevel: string | null } }
  | { subtype: "claude_authenticate"; loginWithClaudeAi?: boolean }
  | { subtype: "claude_oauth_callback"; authorizationCode: string; state: string }
  | { subtype: "claude_oauth_wait_for_completion" }

// Shape of the bridge's /api/sessions/:id response.
export type HistoryItem =
  | { kind: "user"; id?: string; text: string; images?: ImageBlock[] }
  | { kind: "turn-duration"; durationMs: number; interrupted?: boolean; error?: string }
  | { kind: "compaction"; trigger: "manual" | "auto" }
  | { kind: "turn-diff"; diff: TurnDiff; updateOnly?: boolean }
  | {
      kind: "agent"
      messageId?: string
      message: AgentMessage
    }
