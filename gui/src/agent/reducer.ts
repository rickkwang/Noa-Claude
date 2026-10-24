import type {
  AgentMessage,
  ContentBlock,
  ContextUsage,
  ControlPayload,
  ModelInfo,
  PermissionMode,
  PermissionRequest,
  SlashCommand,
  StreamEvent,
} from "./protocol"

export type ToolBlock = {
  kind: "tool"
  id: string
  name: string
  input: Record<string, unknown>
  partialJson: string
  status: "running" | "done" | "error"
  output?: string
}

export type Block = { kind: "text"; text: string } | { kind: "thinking"; text: string; done: boolean } | ToolBlock

export type Turn =
  | { role: "user"; id: string; text: string }
  | { role: "assistant"; id: string; blocks: Block[]; streaming: boolean }

export interface Permission {
  requestId: string
  toolUseId: string
  toolName: string
  input: Record<string, unknown>
  title?: string
  description?: string
  suggestions: unknown[]
}

export interface AgentState {
  connection: "connecting" | "ready" | "closed"
  sessionId?: string
  model?: string
  effort?: string
  // Unknown until the agent reports it in system/init.
  permissionMode?: PermissionMode
  models: ModelInfo[]
  commands: SlashCommand[]
  contextUsage?: ContextUsage
  turns: Turn[]
  busy: boolean
  stopping?: boolean
  permissions: Permission[]
  result?: { durationMs: number; costUsd?: number; isError: boolean; interrupted?: boolean }
  logs: string[]
  error?: string
}

export type Action =
  | { type: "reset" }
  | { type: "connection"; status: AgentState["connection"] }
  | { type: "user-sent"; id: string; text: string }
  | { type: "history-user"; id: string; text: string }
  | { type: "agent"; message: AgentMessage }
  | { type: "control"; payload: ControlPayload }
  | { type: "model-set"; model: string }
  | { type: "effort-set"; effort?: string }
  | { type: "permission-mode-set"; mode: PermissionMode }
  | { type: "log"; text: string }
  | { type: "permission-answered"; requestId: string }
  | { type: "error"; text: string }
  | { type: "interrupt-requested" }

export const initialState: AgentState = {
  connection: "connecting",
  models: [],
  commands: [],
  turns: [],
  busy: false,
  permissions: [],
  logs: [],
}

const MAX_LOGS = 50

export function reducer(state: AgentState, action: Action): AgentState {
  switch (action.type) {
    case "reset":
      return initialState
    case "connection":
      return { ...state, connection: action.status, busy: action.status === "closed" ? false : state.busy }
    case "user-sent":
      return {
        ...state,
        busy: true,
        stopping: false,
        error: undefined,
        turns: [...state.turns, { role: "user", id: action.id, text: action.text }],
      }
    case "history-user":
      return { ...state, turns: [...state.turns, { role: "user", id: action.id, text: action.text }] }
    case "log":
      return { ...state, logs: [...state.logs, action.text].slice(-MAX_LOGS) }
    case "error":
      return { ...state, error: action.text, logs: [...state.logs, action.text].slice(-MAX_LOGS) }
    case "interrupt-requested":
      return { ...state, stopping: true }
    case "permission-answered":
      return { ...state, permissions: state.permissions.filter((p) => p.requestId !== action.requestId) }
    case "model-set":
      return { ...state, model: action.model }
    case "effort-set":
      return { ...state, effort: action.effort }
    case "permission-mode-set":
      return { ...state, permissionMode: action.mode }
    case "control":
      if (action.payload.kind === "initialize") {
        return { ...state, models: action.payload.models, commands: action.payload.commands }
      }
      return { ...state, contextUsage: action.payload.usage }
    case "agent":
      return applyAgentMessage(state, action.message)
  }
}

function applyAgentMessage(state: AgentState, m: AgentMessage): AgentState {
  // Messages tagged with a parent tool use come from sub-agents; not rendered yet.
  if ("parent_tool_use_id" in m && m.parent_tool_use_id) return state

  switch (m.type) {
    case "system":
      if (m.subtype !== "init") return state
      return {
        ...state,
        sessionId: m.session_id,
        model: m.model,
        permissionMode: m.permissionMode,
      }

    case "stream_event":
      return { ...state, turns: applyStreamEvent(state.turns, m.event) }

    case "assistant":
      return { ...state, turns: finalizeAssistant(state.turns, m.message.content) }

    case "user":
      if (typeof m.message.content === "string") return state
      return { ...state, turns: applyToolResults(state.turns, m.message.content) }

    case "result":
      return {
        ...state,
        busy: false,
        turns: closeStreaming(state.turns),
        result: {
          durationMs: m.duration_ms,
          costUsd: m.total_cost_usd,
          isError: m.is_error,
          interrupted: state.stopping,
        },
      }

    case "control_request":
      if (m.request.subtype !== "can_use_tool") return state
      return {
        ...state,
        permissions: [...state.permissions, toPermission(m.request_id, m.request as PermissionRequest)],
      }

    case "control_cancel_request":
      return { ...state, permissions: state.permissions.filter((p) => p.requestId !== m.request_id) }

    default:
      return state
  }
}

function toPermission(requestId: string, req: PermissionRequest): Permission {
  return {
    requestId,
    toolUseId: req.tool_use_id,
    toolName: req.tool_name,
    input: req.input,
    title: req.title,
    description: req.description,
    suggestions: req.permission_suggestions ?? [],
  }
}

// Index of the assistant turn currently receiving stream deltas, or -1.
function streamingIndex(turns: Turn[]): number {
  const last = turns.length - 1
  const turn = turns[last]
  return turn?.role === "assistant" && turn.streaming ? last : -1
}

function withAssistant(turns: Turn[], index: number, update: (blocks: Block[]) => Block[]): Turn[] {
  const next = [...turns]
  const turn = next[index]
  if (turn?.role === "assistant") next[index] = { ...turn, blocks: update(turn.blocks) }
  return next
}

function applyStreamEvent(turns: Turn[], event: StreamEvent): Turn[] {
  let index = streamingIndex(turns)
  let next = turns

  if (event.type === "content_block_start") {
    if (index === -1) {
      next = [...turns, { role: "assistant", id: crypto.randomUUID(), blocks: [], streaming: true }]
      index = next.length - 1
    }
    const block = event.content_block
    const created: Block =
      block.type === "text"
        ? { kind: "text", text: "" }
        : block.type === "thinking"
          ? { kind: "thinking", text: "", done: false }
          : { kind: "tool", id: block.id, name: block.name, input: {}, partialJson: "", status: "running" }
    return withAssistant(next, index, (blocks) => [...blocks, created])
  }

  if (index === -1) return turns

  if (event.type === "content_block_delta") {
    const delta = event.delta
    return withAssistant(next, index, (blocks) => {
      const last = blocks[blocks.length - 1]
      if (!last) return blocks
      if (delta.type === "text_delta" && last.kind === "text") {
        return [...blocks.slice(0, -1), { ...last, text: last.text + delta.text }]
      }
      if (delta.type === "thinking_delta" && last.kind === "thinking") {
        return [...blocks.slice(0, -1), { ...last, text: last.text + delta.thinking }]
      }
      if (delta.type === "input_json_delta" && last.kind === "tool") {
        return [...blocks.slice(0, -1), { ...last, partialJson: last.partialJson + delta.partial_json }]
      }
      return blocks
    })
  }

  if (event.type === "content_block_stop") {
    return withAssistant(next, index, (blocks) => {
      const last = blocks[blocks.length - 1]
      if (last?.kind !== "thinking") return blocks
      return [...blocks.slice(0, -1), { ...last, done: true }]
    })
  }

  return turns
}

// The complete assistant message is authoritative: it replaces whatever the
// stream accumulated, and keeps tool results that already arrived.
function finalizeAssistant(turns: Turn[], content: ContentBlock[]): Turn[] {
  const blocks: Block[] = content.flatMap((block): Block[] => {
    if (block.type === "text") return [{ kind: "text", text: block.text }]
    if (block.type === "thinking") return [{ kind: "thinking", text: block.thinking, done: true }]
    if (block.type === "tool_use") {
      const existing = findTool(turns, block.id)
      return [
        {
          kind: "tool",
          id: block.id,
          name: block.name,
          input: block.input,
          partialJson: "",
          status: existing?.status ?? "running",
          output: existing?.output,
        },
      ]
    }
    return []
  })

  const index = streamingIndex(turns)
  if (index !== -1) {
    const next = [...turns]
    next[index] = { role: "assistant", id: (turns[index] as Turn).id, blocks, streaming: false }
    return next
  }
  return [...turns, { role: "assistant", id: crypto.randomUUID(), blocks, streaming: false }]
}

function applyToolResults(turns: Turn[], content: ContentBlock[]): Turn[] {
  const results = content.filter(
    (block): block is Extract<ContentBlock, { type: "tool_result" }> => block.type === "tool_result",
  )
  if (results.length === 0) return turns

  return turns.map((turn) => {
    if (turn.role !== "assistant") return turn
    if (!turn.blocks.some((b) => b.kind === "tool" && results.some((r) => r.tool_use_id === b.id))) return turn
    return {
      ...turn,
      blocks: turn.blocks.map((b) => {
        if (b.kind !== "tool") return b
        const result = results.find((r) => r.tool_use_id === b.id)
        if (!result) return b
        return {
          ...b,
          status: result.is_error ? "error" : "done",
          output: stringifyContent(result.content),
        }
      }),
    }
  })
}

function closeStreaming(turns: Turn[]): Turn[] {
  const index = streamingIndex(turns)
  if (index === -1) return turns
  const next = [...turns]
  const turn = next[index] as Turn & { role: "assistant" }
  next[index] = {
    ...turn,
    streaming: false,
    blocks: turn.blocks.map((b) => (b.kind === "thinking" ? { ...b, done: true } : b)),
  }
  return next
}

function findTool(turns: Turn[], id: string): ToolBlock | undefined {
  for (const turn of turns) {
    if (turn.role !== "assistant") continue
    const found = turn.blocks.find((b): b is ToolBlock => b.kind === "tool" && b.id === id)
    if (found) return found
  }
  return undefined
}

function stringifyContent(content: unknown): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === "object" && part !== null && "text" in part ? String(part.text) : JSON.stringify(part),
      )
      .join("\n")
  }
  return JSON.stringify(content, null, 2)
}
