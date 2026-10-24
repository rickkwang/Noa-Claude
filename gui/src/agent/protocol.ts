// Subset of the stream-json protocol the GUI consumes.
// Source of truth: src/entrypoints/sdk/coreSchemas.ts and controlSchemas.ts.
// Unknown message types fall through the reducer's default branch.

export type PermissionMode = "default" | "acceptEdits" | "plan" | "auto" | "bypassPermissions" | "dontAsk"

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: unknown; is_error?: boolean }

export type StreamEvent =
  | {
      type: "content_block_start"
      content_block: { type: "text" } | { type: "thinking" } | { type: "tool_use"; id: string; name: string }
    }
  | {
      type: "content_block_delta"
      delta:
        | { type: "text_delta"; text: string }
        | { type: "thinking_delta"; thinking: string }
        | { type: "input_json_delta"; partial_json: string }
    }
  | { type: "content_block_stop" }

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

export interface SlashCommand {
  name: string
  description: string
  argumentHint: string
}

export interface ContextUsage {
  totalTokens: number
  maxTokens: number
  percentage: number
  model: string
}

// Responses to requests the GUI sent, keyed by request_id on the client.
export type ControlPayload =
  | { kind: "initialize"; models: ModelInfo[]; commands: SlashCommand[] }
  | { kind: "context_usage"; usage: ContextUsage }

export type AgentMessage =
  | {
      type: "system"
      subtype: "init"
      model: string
      permissionMode: PermissionMode
      session_id: string
    }
  | { type: "stream_event"; event: StreamEvent; parent_tool_use_id: string | null }
  | { type: "assistant"; message: { content: ContentBlock[] }; parent_tool_use_id: string | null }
  | { type: "user"; message: { content: ContentBlock[] | string }; parent_tool_use_id: string | null }
  | {
      type: "result"
      subtype: string
      is_error: boolean
      duration_ms: number
      total_cost_usd?: number
      parent_tool_use_id?: string | null
    }
  | { type: "control_request"; request_id: string; request: PermissionRequest | { subtype: string } }
  | { type: "control_cancel_request"; request_id: string }
  | {
      type: "control_response"
      response: { subtype: "success" | "error"; request_id: string; response?: unknown; error?: string }
    }

export type Envelope =
  | { kind: "agent"; message: AgentMessage }
  | { kind: "log"; text: string }
  | { kind: "exit"; code: number | null }

// Messages the GUI writes to the agent's stdin.
export type Outgoing =
  | { type: "user"; message: { role: "user"; content: string }; parent_tool_use_id: null }
  | { type: "control_request"; request_id: string; request: ControlRequest }
  | {
      type: "control_response"
      response: {
        subtype: "success"
        request_id: string
        response:
          | { behavior: "allow"; updatedInput: Record<string, unknown>; updatedPermissions?: unknown[] }
          | { behavior: "deny"; message: string }
      }
    }

export type ControlRequest =
  | { subtype: "initialize" }
  | { subtype: "interrupt" }
  | { subtype: "set_model"; model: string }
  | { subtype: "set_permission_mode"; mode: PermissionMode }
  | { subtype: "get_context_usage" }
  | { subtype: "get_settings" }
  | { subtype: "apply_flag_settings"; settings: { effortLevel: string | null } }

// Shape of the bridge's /api/sessions/:id response.
export type HistoryItem =
  | { kind: "user"; text: string }
  | {
      kind: "agent"
      messageId?: string
      message: { type: "assistant" | "user"; message: { content: ContentBlock[] }; parent_tool_use_id: null }
    }
