import type {
  AgentMessage,
  ElicitationRequest,
  ImageBlock,
  QueuedMessage,
  UserContent,
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
  images?: ImageBlock[]
  exitCode?: number
  interrupted?: boolean
}

export type Block =
  | { kind: "text"; text: string; done?: boolean }
  | { kind: "thinking"; text: string; done: boolean }
  | ToolBlock

export type Turn =
  | { role: "user"; id: string; text: string; images?: ImageBlock[] }
  | {
      role: "assistant"
      id: string
      blocks: Block[]
      streaming: boolean
      durationMs?: number
      interrupted?: boolean
    }

export interface Permission {
  requestId: string
  toolUseId: string
  toolName: string
  input: Record<string, unknown>
  title?: string
  description?: string
  decisionReason?: string
  suggestions: unknown[]
}

export interface AgentTask {
  id: string
  toolUseId?: string
  description: string
  status: "running" | "completed" | "failed" | "stopped"
  summary?: string
  outputFile?: string
  lastTool?: string
  usage?: { total_tokens: number; tool_uses: number; duration_ms: number }
  turns: Turn[]
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
  elicitations: (ElicitationRequest & { requestId: string })[]
  tasks: AgentTask[]
  queue: QueuedMessage[]
  queuePaused: boolean
  status?: string
  permissions: Permission[]
  result?: { durationMs: number; costUsd?: number; isError: boolean; interrupted?: boolean }
  logs: string[]
  error?: string
  notice?: string
}

export type Action =
  | { type: "reset" }
  | { type: "queue"; messages: QueuedMessage[]; paused?: boolean }
  | { type: "connection"; status: AgentState["connection"] }
  | { type: "user-sent"; id: string; text?: string; content?: UserContent }
  | { type: "history-user"; id: string; text: string; images?: ImageBlock[] }
  | { type: "turn-duration"; durationMs: number; interrupted?: boolean }
  | { type: "agent"; message: AgentMessage }
  | { type: "control"; payload: ControlPayload }
  | { type: "model-set"; model: string }
  | { type: "effort-set"; effort?: string }
  | { type: "permission-mode-set"; mode: PermissionMode }
  | { type: "log"; text: string }
  | { type: "permission-answered"; requestId: string }
  | { type: "error"; text: string }
  | { type: "notice"; text: string }
  | { type: "interrupt-requested" }

export const initialState: AgentState = {
  connection: "connecting",
  models: [],
  commands: [],
  turns: [],
  busy: false,
  permissions: [],
  elicitations: [],
  tasks: [],
  queue: [],
  queuePaused: false,
  logs: [],
}

const MAX_LOGS = 50

export function reducer(state: AgentState, action: Action): AgentState {
  switch (action.type) {
    case "queue":
      return { ...state, queue: action.messages, queuePaused: action.paused ?? state.queuePaused }
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
        notice: undefined,
        turns: [...state.turns, userTurn(action.id, action.content ?? action.text ?? "")],
      }
    case "history-user":
      return { ...state, turns: [...state.turns, { role: "user", id: action.id, text: action.text, images: action.images }] }
    case "turn-duration":
      return {
        ...state,
        turns: applyTurnDuration(state.turns, action.durationMs, action.interrupted),
      }
    case "log":
      return { ...state, logs: [...state.logs, action.text].slice(-MAX_LOGS) }
    case "notice":
      return { ...state, notice: action.text }
    case "error":
      return { ...state, notice: undefined, error: action.text, logs: [...state.logs, action.text].slice(-MAX_LOGS) }
    case "interrupt-requested":
      return { ...state, stopping: true }
    case "permission-answered":
      return { ...state, permissions: state.permissions.filter((p) => p.requestId !== action.requestId), elicitations: state.elicitations.filter((p) => p.requestId !== action.requestId) }
    case "model-set":
      return { ...state, model: action.model }
    case "effort-set":
      return { ...state, effort: action.effort }
    case "permission-mode-set":
      return { ...state, permissionMode: action.mode }
    case "control":
      if (action.payload.kind === "commands") return { ...state, commands: action.payload.commands }
      if (action.payload.kind === "initialize") {
        return { ...state, models: action.payload.models, commands: action.payload.commands }
      }
      return { ...state, contextUsage: action.payload.usage }
    case "agent":
      return applyAgentMessage(state, action.message)
  }
}

function applyAgentMessage(state: AgentState, m: AgentMessage): AgentState {
  if ("parent_tool_use_id" in m && m.parent_tool_use_id) {
    const id = m.parent_tool_use_id
    const task = state.tasks.find((t) => t.id === id || t.toolUseId === id) ?? { id, toolUseId: id, description: "Subagent", status: "running" as const, turns: [] }
    const child = applyAgentMessage({ ...initialState, turns: task.turns }, { ...m, parent_tool_use_id: null } as AgentMessage)
    return { ...state, tasks: [...state.tasks.filter((t) => t !== task), { ...task, turns: child.turns }] }
  }

  switch (m.type) {
    case "system":
      if (m.subtype === "task_started" || m.subtype === "task_progress" || m.subtype === "task_notification") {
        const existing = state.tasks.find((t) => t.id === m.task_id || (m.tool_use_id !== undefined && (t.id === m.tool_use_id || t.toolUseId === m.tool_use_id)))
        const task: AgentTask = {
          id: m.task_id,
          toolUseId: m.tool_use_id ?? existing?.toolUseId,
          description: m.description ?? existing?.description ?? "Background task",
          status: m.status ?? existing?.status ?? "running",
          summary: m.summary ?? existing?.summary,
          outputFile: m.output_file ?? existing?.outputFile,
          lastTool: m.last_tool_name ?? existing?.lastTool,
          usage: m.usage ?? existing?.usage,
          turns: existing?.turns ?? [],
        }
        return { ...state, tasks: [...state.tasks.filter((t) => t !== existing), task] }
      }
      if (m.subtype === "status") return { ...state, status: m.status ?? undefined, permissionMode: m.permissionMode ?? state.permissionMode }
      if (m.subtype === "session_state_changed") return { ...state, status: m.state, busy: m.state === "idle" ? false : state.busy }
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

    case "result": {
      const turns = applyTurnDuration(completeResult(state.turns, m.result), m.duration_ms, state.stopping)
      return {
        ...state,
        busy: false,
        stopping: false,
        error: m.is_error ? m.errors?.join("\n") || `Agent failed (${m.subtype})` : undefined,
        turns,
        result: {
          durationMs: m.duration_ms,
          costUsd: m.total_cost_usd,
          isError: m.is_error,
          interrupted: state.stopping,
        },
      }
    }

    case "control_request":
      if (m.request.subtype === "elicitation") return { ...state, elicitations: [...state.elicitations, { ...(m.request as ElicitationRequest), requestId: m.request_id }] }
      if (m.request.subtype !== "can_use_tool") return { ...state, error: `Unsupported agent request: ${m.request.subtype}` }
      return {
        ...state,
        permissions: [...state.permissions, toPermission(m.request_id, m.request as PermissionRequest)],
      }

    case "control_cancel_request":
      return { ...state, permissions: state.permissions.filter((p) => p.requestId !== m.request_id), elicitations: state.elicitations.filter((p) => p.requestId !== m.request_id) }

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
    decisionReason: req.decision_reason,
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
        ? { kind: "text", text: "", done: false }
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
    if (block.type === "text") return [{ kind: "text", text: block.text, done: true }]
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
          images: existing?.images,
          exitCode: existing?.exitCode,
          interrupted: existing?.interrupted,
        },
      ]
    }
    return []
  })

  const index = streamingIndex(turns)
  if (index !== -1) {
    const next = [...turns]
    const current = turns[index] as Extract<Turn, { role: "assistant" }>
    next[index] = {
      role: "assistant",
      id: current.id,
      blocks,
      streaming: false,
      durationMs: current.durationMs,
      interrupted: current.interrupted,
    }
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
        const content = splitToolContent(result.content, result.tool_use_result)
        return {
          ...b,
          status: result.is_error ? "error" : "done",
          output: content.output,
          images: content.images,
          exitCode: content.exitCode,
          interrupted: content.interrupted,
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
    blocks: turn.blocks.map((b) =>
      b.kind === "thinking" || b.kind === "text" ? { ...b, done: true } : b,
    ),
  }
  return next
}

function applyTurnDuration(turns: Turn[], durationMs: number, interrupted = false): Turn[] {
  const closed = closeStreaming(turns)
  const lastAssistant = closed.map((turn) => turn.role).lastIndexOf("assistant")
  const lastUser = closed.map((turn) => turn.role).lastIndexOf("user")
  if (lastAssistant === -1 || lastAssistant < lastUser) {
    if (!closed.length) return closed
    return [
      ...closed,
      {
        role: "assistant",
        id: crypto.randomUUID(),
        blocks: [],
        streaming: false,
        durationMs,
        interrupted,
      },
    ]
  }
  const next = [...closed]
  next[lastAssistant] = {
    ...(next[lastAssistant] as Extract<Turn, { role: "assistant" }>),
    durationMs,
    interrupted,
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
  if (typeof content === "object" && content !== null && "text" in content) return String(content.text)
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === "object" && part !== null && "text" in part ? String(part.text) : JSON.stringify(part),
      )
      .join("\n")
  }
  return JSON.stringify(content, null, 2)
}

function splitToolContent(content: unknown, toolUseResult?: unknown): {
  output?: string
  images?: ImageBlock[]
  exitCode?: number
  interrupted?: boolean
} {
  const parts = Array.isArray(content) ? content : [content]
  const images = parts.filter(
    (part): part is ImageBlock =>
      typeof part === "object" &&
      part !== null &&
      "type" in part &&
      part.type === "image" &&
      "source" in part &&
      typeof part.source === "object" &&
      part.source !== null,
  )
  const textParts = parts.filter((part) => !images.includes(part as ImageBlock))
  const result = typeof toolUseResult === "object" && toolUseResult !== null ? toolUseResult as Record<string, unknown> : undefined
  const stdout = typeof result?.stdout === "string" ? result.stdout : ""
  const stderr = typeof result?.stderr === "string" ? result.stderr : ""
  const fallback = [stdout, stderr].filter((value) => value.trim()).join("\n")
  const output = textParts.length > 0
    ? stringifyContent(textParts.length === 1 ? textParts[0] : textParts)
    : fallback || undefined
  const exitCode = typeof result?.exitCode === "number"
    ? result.exitCode
    : typeof result?.exit_code === "number"
      ? result.exit_code
      : undefined
  return {
    output: output?.trim() ? output : undefined,
    images: images.length ? images : undefined,
    exitCode,
    interrupted: result?.interrupted === true,
  }
}

function userTurn(id: string, content: UserContent): Turn {
  return { role: "user", id, text: typeof content === "string" ? content : content.filter((b) => b.type === "text").map((b) => b.text).join("\n"), images: typeof content === "string" ? undefined : content.filter((b): b is ImageBlock => b.type === "image") }
}

function completeResult(turns: Turn[], result?: string): Turn[] {
  const closed = closeStreaming(turns)
  if (!result?.trim()) return closed
  let lastUser = closed.length - 1
  while (lastUser >= 0 && closed[lastUser]?.role !== "user") lastUser--
  const hasAnswer = closed.slice(lastUser + 1).some((turn) => turn.role === "assistant" && turn.blocks.some((block) => block.kind === "text" && block.text.trim()))
  return hasAnswer ? closed : [...closed, { role: "assistant", id: crypto.randomUUID(), blocks: [{ kind: "text", text: result, done: true }], streaming: false }]
}
