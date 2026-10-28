import type {
  AccountInfo,
  HistoryItem,
  AgentMessage,
  ElicitationRequest,
  ImageBlock,
  QueuedMessage,
  UserContent,
  ContentBlock,
  ContextUsage,
  ControlPayload,
  McpServerStatus,
  ModelInfo,
  RateLimitInfo,
  PermissionMode,
  PermissionRequest,
  SlashCommand,
  StreamEvent,
  TurnDiff,
  TurnDiffActionResult,
} from "./protocol"

export type ToolBlock = {
  kind: "tool"
  id: string
  name: string
  input: Record<string, unknown>
  partialJson: string
  streamIndex?: number
  status: "running" | "done" | "error" | "stopped" | "unknown"
  output?: string
  rawResult?: unknown
  images?: ImageBlock[]
  exitCode?: number
  interrupted?: boolean
  startedAt?: number
  endedAt?: number
}

export type CompactionBlock = { kind: "compaction"; status: "running" | "done" | "stopped" | "unknown"; startedAt?: number; trigger?: "manual" | "auto" }
export type RetryBlock = { kind: "retry"; attempt: number; maxRetries: number; delayMs: number; errorStatus?: number | null; done?: boolean }
export type Block =
  | CompactionBlock
  | RetryBlock
  | { kind: "text"; text: string; done?: boolean; streamIndex?: number }
  | { kind: "thinking"; text: string; done: boolean; startedAt?: number; streamIndex?: number }
  | ToolBlock

export type Turn =
  | { role: "user"; id: string; text: string; images?: ImageBlock[] }
  | {
      role: "assistant"
      id: string
      blocks: Block[]
      streaming: boolean
      messageId?: string
      stoppedStreamIndex?: number
      pendingAssistant?: { content: ContentBlock[]; messageId: string }
      startedAt?: number
      durationMs?: number
      interrupted?: boolean
      error?: string
      incomplete?: boolean
      diff?: TurnDiff
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
  status: "running" | "completed" | "failed" | "stopped" | "unknown"
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
  account?: AccountInfo
  auth?: {
    status: "starting" | "waiting" | "complete" | "error"
    automaticUrl?: string
    manualUrl?: string
    error?: string
  }
  contextUsage?: ContextUsage
  mcpServers?: McpServerStatus[]
  contextLoading?: boolean
  contextError?: string
  contextUpdatedAt?: number
  turns: Turn[]
  historyBefore?: number
  historyLoading?: boolean
  // Compact diff summary while the current turn is still running.
  liveDiff?: TurnDiff
  // Result of an Undo/Reapply request, shown in a dialog.
  diffAction?: { turnIndex: number; action: "undo" | "reapply"; result: TurnDiffActionResult; id: number }
  busy: boolean
  stopping?: boolean
  elicitations: (ElicitationRequest & { requestId: string; completed?: boolean })[]
  tasks: AgentTask[]
  queue: QueuedMessage[]
  queuePaused: boolean
  status?: string
  // Latest rate-limit state; cleared once the limit reports "allowed" again.
  rateLimit?: RateLimitInfo
  permissions: Permission[]
  result?: { durationMs: number; costUsd?: number; isError: boolean; interrupted?: boolean }
  logs: string[]
  error?: string
  notice?: string
}

export type Action =
  | { type: "context-request" }
  | { type: "context-error"; error: string }
  | { type: "history"; items: HistoryItem[]; before?: number; prepend?: boolean }
  | { type: "history-loading" }
  | { type: "reset" }
  | { type: "queue"; messages: QueuedMessage[]; paused?: boolean }
  | { type: "connection"; status: AgentState["connection"] }
  | { type: "user-sent"; id: string; text?: string; content?: UserContent }
  | { type: "history-user"; id: string; text: string; images?: ImageBlock[] }
  | { type: "turn-duration"; durationMs: number; interrupted?: boolean; error?: string }
  | { type: "exit"; code: number | null }
  | { type: "compaction"; trigger: "manual" | "auto" }
  | { type: "turn-diff"; diff: TurnDiff; updateOnly?: boolean }
  | { type: "turn-diff-live"; diff: TurnDiff }
  | { type: "turn-diff-action"; turnIndex: number; action: "undo" | "reapply"; result: TurnDiffActionResult }
  | { type: "diff-action-clear" }
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
  | { type: "auth-start" }
  | { type: "auth-urls"; automaticUrl: string; manualUrl: string }
  | { type: "auth-complete"; account: AccountInfo }
  | { type: "auth-error"; error: string }
  | { type: "auth-close" }

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
    case "context-request": return { ...state, contextLoading: true, contextError: undefined }
    case "context-error": return { ...state, contextLoading: false, contextError: action.error }
    case "history-loading": return { ...state, historyLoading: true }
    case "history": {
      let restored = initialState
      for (const item of action.items) {
        if (item.kind === "user") restored = reducer(restored, { type: "history-user", id: item.id ?? crypto.randomUUID(), text: item.text, images: item.images })
        else if (item.kind === "turn-duration") restored = reducer(restored, { ...item, type: "turn-duration" })
        else if (item.kind === "compaction") restored = reducer(restored, { type: "compaction", trigger: item.trigger })
        else if (item.kind === "turn-diff") restored = reducer(restored, { type: "turn-diff", diff: item.diff })
        else restored = reducer(restored, { type: "agent", message: item.message })
      }
      const turns = settlePending(restored.turns, "unknown").map(turn => turn.role === "assistant" && turn.blocks.some(block => block.kind === "tool" && block.status === "unknown") ? { ...turn, incomplete: true } : turn)
      const tasks = restored.tasks.map(task => ({ ...task, turns: settlePending(task.turns, "unknown") }))
      let combined = action.prepend ? [...turns, ...state.turns] : turns
      if (action.prepend) {
        const latest = new Map<string, ToolBlock>()
        for (const turn of state.turns) if (turn.role === "assistant") for (const block of turn.blocks) if (block.kind === "tool" && block.name === "Hook") latest.set(block.id, block)
        const seen = new Set<string>()
        combined = combined.map(turn => {
          if (turn.role !== "assistant") return turn
          let resolved = false
          const blocks = turn.blocks.flatMap((block): Block[] => {
            if (block.kind !== "tool" || block.name !== "Hook") return [block]
            if (seen.has(block.id)) return []
            seen.add(block.id)
            const current = latest.get(block.id)
            if (!current) return [block]
            resolved ||= block.status === "unknown" && current.status !== "unknown"
            return [{ ...block, ...current }]
          })
          return { ...turn, blocks, incomplete: resolved && !blocks.some(block => block.kind === "tool" && block.status === "unknown") ? false : turn.incomplete }
        })
      }
      return { ...state, historyBefore: action.before, historyLoading: false,
        turns: combined,
        tasks: [...tasks.filter(task => !state.tasks.some(current => current.id === task.id)), ...state.tasks.map(current => {
          const earlier = tasks.find(task => task.id === current.id)
          return earlier && !current.turns.length ? { ...earlier, ...current, turns: earlier.turns, usage: current.usage ?? earlier.usage } : current
        })] }
    }
    case "queue":
      return { ...state, queue: action.messages, queuePaused: action.paused ?? state.queuePaused }
    case "reset":
      return initialState
    case "compaction":
      return { ...state, turns: updateCompaction(state.turns, "done", action.trigger) }
    case "exit": {
      const unfinished = state.busy || state.turns.some(t => t.role === "assistant" && (t.streaming || t.blocks.some(b => b.kind === "tool" && (b.status === "running" || b.status === "unknown"))))
      const error = unfinished && !state.stopping ? `Agent exited before completing this turn (code ${action.code ?? "unknown"}).` : undefined
      return { ...state, connection: "closed", contextLoading: false, busy: false, stopping: false, permissions: [], elicitations: [], liveDiff: undefined,
        turns: unfinished ? stampTurn(settlePending(state.turns, "stopped"), undefined, state.stopping, error) : state.turns,
        tasks: state.tasks.map(task => task.status === "running" || task.status === "unknown" ? { ...task, status: "stopped", turns: settlePending(task.turns, "stopped") } : task), error: error ?? state.error }
    }
    case "connection": {
      const turns = action.status === "closed" ? settlePending(state.turns, "unknown") : state.turns
      const last = turns.at(-1)
      if (action.status === "closed" && state.busy && last?.role === "assistant") turns[turns.length - 1] = { ...last, incomplete: true }
      return {
        ...state,
        connection: action.status,
        contextLoading: action.status === "closed" ? false : state.contextLoading,
        turns,
        tasks: action.status === "closed" ? state.tasks.map(task => task.status === "running" ? { ...task, status: "unknown", turns: settlePending(task.turns, "unknown") } : task) : state.tasks,
        busy: action.status === "closed" ? false : state.busy,
        liveDiff: action.status === "closed" ? undefined : state.liveDiff,
        permissions: action.status === "closed" ? [] : state.permissions,
        elicitations: action.status === "closed" ? [] : state.elicitations,
        auth: action.status === "closed" && state.auth && state.auth.status !== "complete"
          ? { ...state.auth, status: "error", error: "Noa disconnected during sign-in. Reconnect and try again." }
          : state.auth,
        error: state.error ?? (action.status === "closed" && state.connection === "connecting" ? "Noa could not start. Open Activity → Diagnostics for details." : undefined),
      }
    }
    case "user-sent":
      return {
        ...state,
        busy: true,
        stopping: false,
        error: undefined,
        notice: undefined,
        liveDiff: undefined,
        // A message sent while the agent is busy is a steer: the in-flight message keeps streaming above it.
        turns: [...(state.busy ? state.turns : closeStreaming(state.turns)), userTurn(action.id, action.content ?? action.text ?? "")],
      }
    case "history-user":
      return { ...state, turns: [...state.turns, { role: "user", id: action.id, text: action.text, images: action.images }] }
    case "turn-duration":
      return {
        ...state,
        turns: stampTurn(action.error || action.interrupted ? settlePending(state.turns, "stopped") : state.turns, action.durationMs, action.interrupted, action.error),
      }
    case "turn-diff": {
      // A bridge update carries turnIndex and replaces that turn in place; the
      // first event after a result belongs to the latest assistant turn.
      const matching = action.diff.turnIndex === undefined
        ? -1
        : state.turns.findIndex(
            (turn) => turn.role === "assistant" && turn.diff?.turnIndex === action.diff.turnIndex,
          )
      if (action.updateOnly && matching === -1) return state
      const fallback = state.turns.map((turn) => turn.role === "assistant" && turn.blocks.some((block) => block.kind !== "compaction" && block.kind !== "retry")).lastIndexOf(true)
      const index = matching === -1 ? fallback : matching
      if (index === -1) return state
      const turns = state.turns.slice()
      turns[index] = { ...(turns[index] as Extract<Turn, { role: "assistant" }>), diff: action.diff }
      return { ...state, turns, liveDiff: undefined }
    }
    case "turn-diff-live":
      return { ...state, liveDiff: action.diff }
    case "turn-diff-action":
      return {
        ...state,
        diffAction: { turnIndex: action.turnIndex, action: action.action, result: action.result, id: Date.now() },
      }
    case "diff-action-clear":
      return { ...state, diffAction: undefined }
    case "log":
      return {
        ...state,
        logs: [...state.logs, action.text].slice(-MAX_LOGS),
        error: state.connection !== "ready" && /\[(?:CONFIG|AUTH)_ERROR\]/.test(action.text)
          ? action.text.replace(/\[(?:CONFIG|AUTH)_ERROR\]\s*/g, "").trim()
          : state.error,
      }
    case "notice":
      return { ...state, notice: action.text }
    case "error":
      return { ...state, notice: undefined, error: action.text, logs: [...state.logs, action.text].slice(-MAX_LOGS) }
    case "interrupt-requested":
      return { ...state, stopping: true }
    case "auth-start":
      return { ...state, auth: { status: "starting" } }
    case "auth-urls":
      return { ...state, auth: { status: "waiting", automaticUrl: action.automaticUrl, manualUrl: action.manualUrl } }
    case "auth-complete":
      return { ...state, account: action.account, auth: { status: "complete" } }
    case "auth-error":
      return { ...state, auth: { ...state.auth, status: "error", error: action.error } }
    case "auth-close":
      return { ...state, auth: undefined }
    case "permission-answered":
      return { ...state, permissions: state.permissions.filter((p) => p.requestId !== action.requestId), elicitations: state.elicitations.filter((p) => p.requestId !== action.requestId) }
    case "model-set":
      return { ...state, model: action.model }
    case "effort-set":
      return { ...state, effort: action.effort }
    case "permission-mode-set":
      return { ...state, permissionMode: action.mode }
    case "control":
      if (action.payload.kind === "mcp_status") return { ...state, mcpServers: action.payload.servers }
      if (action.payload.kind === "commands") return { ...state, commands: action.payload.commands }
      if (action.payload.kind === "initialize") {
        return {
          ...state,
          models: action.payload.models,
          commands: action.payload.commands,
          account: action.payload.account ?? state.account,
        }
      }
      return { ...state, contextUsage: action.payload.usage, contextLoading: false, contextError: undefined, contextUpdatedAt: Date.now() }
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
      if (m.subtype === "elicitation_complete") return { ...state, notice: `${m.mcp_server_name} authorization completed`, elicitations: state.elicitations.map(request => request.mcp_server_name === m.mcp_server_name && request.elicitation_id === m.elicitation_id ? { ...request, completed: true } : request) }
      if (m.subtype === "hook_started" || m.subtype === "hook_progress" || m.subtype === "hook_response") {
        const id = `hook:${m.hook_id}`
        const existing = findTool(state.turns, id)
        const block: ToolBlock = {
          ...existing,
          kind: "tool", id, name: "Hook",
          input: { hook_name: m.hook_name, hook_event: m.hook_event },
          partialJson: "",
          status: m.subtype !== "hook_response" ? "running" : m.outcome === "error" ? "error" : m.outcome === "cancelled" ? "stopped" : "done",
          output: m.output || [m.stdout, m.stderr].filter(Boolean).join("\n") || existing?.output,
          exitCode: m.exit_code ?? existing?.exitCode,
          startedAt: existing?.startedAt ?? Date.now(),
          endedAt: m.subtype === "hook_response" ? Date.now() : undefined,
        }
        return { ...state, turns: existing
          ? state.turns.map(turn => turn.role === "assistant" && turn.blocks.includes(existing) ? { ...turn, blocks: turn.blocks.map(b => b === existing ? block : b) } : turn)
          : appendNotice(state.turns, block) }
      }
      if (m.subtype === "task_started" || m.subtype === "task_progress" || m.subtype === "task_notification") {
        const existing = state.tasks.find((t) => t.id === m.task_id || (m.tool_use_id !== undefined && (t.id === m.tool_use_id || t.toolUseId === m.tool_use_id)))
        const task: AgentTask = {
          id: m.task_id,
          toolUseId: m.tool_use_id ?? existing?.toolUseId,
          description: m.description ?? existing?.description ?? "Background task",
          status: m.status === "unknown" && existing && ["completed", "failed", "stopped"].includes(existing.status) ? existing.status : m.status ?? existing?.status ?? "running",
          summary: m.summary ?? existing?.summary,
          outputFile: m.output_file ?? existing?.outputFile,
          lastTool: m.last_tool_name ?? existing?.lastTool,
          usage: m.usage ?? existing?.usage,
          turns: m.status === "completed" || m.status === "failed" || m.status === "stopped"
            ? settlePending(existing?.turns ?? [], "stopped")
            : existing?.turns ?? [],
        }
        return { ...state, tasks: [...state.tasks.filter((t) => t !== existing), task] }
      }
      if (m.subtype === "compact_boundary") return { ...state, status: undefined, turns: updateCompaction(state.turns, "done", m.compact_metadata.trigger) }
      if (m.subtype === "api_retry") return { ...state, turns: appendNotice(settleRetry(state.turns), { kind: "retry", attempt: m.attempt, maxRetries: m.max_retries, delayMs: m.retry_delay_ms, errorStatus: m.error_status }) }
      if (m.subtype === "status") return { ...state, status: m.status ?? undefined, permissionMode: m.permissionMode ?? state.permissionMode, turns: m.status === "compacting" ? updateCompaction(state.turns, "running") : state.turns }
      if (m.subtype === "session_state_changed") return { ...state, status: m.state, busy: m.state === "idle" ? false : state.busy, turns: m.state === "idle" ? settlePending(state.turns, "stopped") : state.turns }
      if (m.subtype !== "init") return state
      return {
        ...state,
        sessionId: m.session_id,
        model: m.model,
        permissionMode: m.permissionMode,
      }

    case "rate_limit_event":
      return { ...state, rateLimit: m.rate_limit_info.status === "allowed" ? undefined : m.rate_limit_info }

    case "tool_progress":
      return { ...state, turns: state.turns.map(turn => turn.role !== "assistant" ? turn : { ...turn, blocks: turn.blocks.map(block => block.kind === "tool" && block.id === m.tool_use_id && block.status === "running" && block.startedAt === undefined ? { ...block, startedAt: Date.now() - m.elapsed_time_seconds * 1000 } : block) }) }

    case "stream_event": {
      let turns = applyStreamEvent(settleRetry(state.turns), m.event)
      const index = streamingIndex(turns)
      const turn = index === -1 ? undefined : turns[index] as Extract<Turn, { role: "assistant" }>
      if (m.event.type === "content_block_stop" && turn?.pendingAssistant)
        turns = finalizeAssistant(turns, turn.pendingAssistant.content, turn.pendingAssistant.messageId)
      return { ...state, turns }
    }

    case "assistant": {
      const turns = settleRetry(state.turns)
      const index = streamingIndex(turns)
      const turn = index === -1 ? undefined : turns[index] as Extract<Turn, { role: "assistant" }>
      // The CLI yields a canonical block before forwarding its indexed stop event.
      if (turn && m.message.id && turn.messageId === m.message.id && m.message.content.length === 1 && turn.stoppedStreamIndex === undefined) {
        const block = m.message.content[0]!
        return { ...state, turns: turns.map((current, i) => i !== index ? current : { ...turn,
          pendingAssistant: { content: m.message.content, messageId: m.message.id! },
          blocks: turn.blocks.map(prior => block.type === "tool_use" && prior.kind === "tool" && prior.id === block.id ? { ...prior, input: block.input, partialJson: "" } : prior),
        }) }
      }
      return { ...state, turns: finalizeAssistant(turns, m.message.content, m.message.id) }
    }

    case "user":
      if (typeof m.message.content === "string") return state
      return { ...state, turns: applyToolResults(state.turns, m.message.content, m.tool_use_result) }

    case "result": {
      const error = m.is_error && !state.stopping ? m.errors?.join("\n") || `Agent failed (${m.subtype})` : undefined
      const turns = stampTurn(settlePending(completeResult(state.turns, m.result), "stopped"), m.duration_ms, state.stopping, error)
      return {
        ...state,
        busy: false,
        stopping: false,
        error,
        logs: m.is_error && m.errors?.length ? [...state.logs, ...m.errors].slice(-MAX_LOGS) : state.logs,
        turns,
        result: {
          durationMs: m.duration_ms,
          costUsd: m.total_cost_usd,
          isError: m.is_error && !state.stopping,
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

// Index of the assistant turn currently receiving stream deltas, or -1. A steering
// message lands after the turn that is still streaming, so look past trailing user turns.
function streamingIndex(turns: Turn[]): number {
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]!
    if (turn.role === "assistant") return turn.streaming ? i : -1
  }
  return -1
}

function withAssistant(turns: Turn[], index: number, update: (blocks: Block[]) => Block[]): Turn[] {
  const next = [...turns]
  const turn = next[index]
  if (turn?.role === "assistant") next[index] = { ...turn, blocks: update(turn.blocks) }
  return next
}

function isStreamBlock(block: Block): boolean {
  return block.kind === "text" || block.kind === "thinking" || (block.kind === "tool" && block.name !== "Hook")
}

function applyStreamEvent(turns: Turn[], event: StreamEvent): Turn[] {
  let index = streamingIndex(turns)
  let next = turns

  if (event.type === "message_start") return [...closeStreaming(turns), { role: "assistant", id: crypto.randomUUID(), messageId: event.message.id, blocks: [], streaming: true, startedAt: Date.now() }]
  if (event.type === "message_stop") return closeStreaming(turns)

  if (event.type === "content_block_start") {
    if (index === -1) {
      next = [...turns, { role: "assistant", id: crypto.randomUUID(), blocks: [], streaming: true, startedAt: Date.now() }]
      index = next.length - 1
    }
    const block = event.content_block
    const created: Block =
      block.type === "text"
        ? { kind: "text", text: "", done: false }
        : block.type === "thinking"
          ? { kind: "thinking", text: "", done: false, startedAt: Date.now() }
          : { kind: "tool", id: block.id, name: block.name, input: {}, partialJson: "", status: "running", startedAt: Date.now() }
    return withAssistant(next, index, (blocks) => [...blocks, { ...created, streamIndex: event.index }])
  }

  if (index === -1) return turns

  if (event.type === "content_block_delta") {
    const delta = event.delta
    return withAssistant(next, index, (blocks) => {
      let lastIndex = event.index === undefined ? blocks.length - 1 : blocks.findIndex(block => isStreamBlock(block) && "streamIndex" in block && block.streamIndex === event.index)
      if (event.index === undefined) while (lastIndex >= 0 && !isStreamBlock(blocks[lastIndex]!)) lastIndex--
      const last = blocks[lastIndex]
      if (!last) return blocks
      if (delta.type === "text_delta" && last.kind === "text") {
        return blocks.map((b, i) => i === lastIndex ? { ...last, text: last.text + delta.text } : b)
      }
      if (delta.type === "thinking_delta" && last.kind === "thinking") {
        return blocks.map((b, i) => i === lastIndex ? { ...last, text: last.text + delta.thinking } : b)
      }
      if (delta.type === "input_json_delta" && last.kind === "tool") {
        return blocks.map((b, i) => i === lastIndex ? { ...last, partialJson: last.partialJson + delta.partial_json } : b)
      }
      return blocks
    })
  }

  if (event.type === "content_block_stop") {
    const stopped = withAssistant(next, index, (blocks) => {
      let lastIndex = event.index === undefined ? blocks.length - 1 : blocks.findIndex(block => isStreamBlock(block) && "streamIndex" in block && block.streamIndex === event.index)
      if (event.index === undefined) while (lastIndex >= 0 && !isStreamBlock(blocks[lastIndex]!)) lastIndex--
      const last = blocks[lastIndex]
      if (last?.kind !== "thinking" && last?.kind !== "text") return blocks
      return blocks.map((b, i) => i === lastIndex ? { ...last, done: true } : b)
    })
    const current = stopped[index] as Extract<Turn, { role: "assistant" }>
    stopped[index] = { ...current, stoppedStreamIndex: event.index }
    return stopped
  }

  return turns
}

// The complete assistant message is authoritative: it replaces whatever the
// stream accumulated, and keeps tool results that already arrived.
function finalizeAssistant(turns: Turn[], content: ContentBlock[], messageId?: string): Turn[] {
  const index = streamingIndex(turns)
  const currentBlocks = index !== -1 ? (turns[index] as Extract<Turn, { role: "assistant" }>).blocks : []
  const currentTurn = index !== -1 ? turns[index] as Extract<Turn, { role: "assistant" }> : undefined
  const target = messageId && currentTurn?.messageId === messageId && content.length === 1 && currentTurn.stoppedStreamIndex !== undefined
    ? currentBlocks.findIndex(block => isStreamBlock(block) && "streamIndex" in block && block.streamIndex === currentTurn.stoppedStreamIndex) : -1
  const streamedBlocks = target === -1 ? currentBlocks.filter(isStreamBlock) : [currentBlocks[target]!]
  let blockIndex = 0
  const blocks: Block[] = content.flatMap((block): Block[] => {
    const prior = streamedBlocks[blockIndex++]
    if (block.type === "text") return [{ kind: "text", text: block.text, done: true, streamIndex: prior && "streamIndex" in prior ? prior.streamIndex : undefined }]
    if (block.type === "thinking") return [{
      kind: "thinking",
      text: block.thinking,
      done: true,
      streamIndex: prior && "streamIndex" in prior ? prior.streamIndex : undefined,
      startedAt: prior?.kind === "thinking" ? prior.startedAt : undefined,
    }]
    if (block.type === "tool_use") {
      const existing = findTool(turns, block.id)
      return [
        {
          kind: "tool",
          id: block.id,
          name: block.name,
          input: block.input,
          partialJson: "",
          streamIndex: existing?.streamIndex,
          status: existing?.status ?? "running",
          output: existing?.output,
          rawResult: existing?.rawResult,
          images: existing?.images,
          exitCode: existing?.exitCode,
          interrupted: existing?.interrupted,
          startedAt: existing?.startedAt,
          endedAt: existing?.endedAt,
        },
      ]
    }
    return []
  })

  if (target !== -1 && currentTurn) return turns.map((turn, i) => i === index ? { ...currentTurn, stoppedStreamIndex: undefined, pendingAssistant: undefined, blocks: currentBlocks.map((block, b) => b === target ? blocks[0]! : block) } : turn)

  if (index !== -1) {
    const next = [...turns]
    const current = turns[index] as Extract<Turn, { role: "assistant" }>
    let replacement = 0
    const merged = current.blocks.flatMap((block): Block[] => {
      if (!isStreamBlock(block)) return [block]
      return replacement < blocks.length ? [blocks[replacement++]!] : []
    })
    merged.push(...blocks.slice(replacement))
    next[index] = {
      role: "assistant",
      id: current.id,
      blocks: merged,
      streaming: false,
      startedAt: current.startedAt,
      durationMs: current.durationMs,
      interrupted: current.interrupted,
    }
    return next
  }
  return [...turns, { role: "assistant", id: crypto.randomUUID(), blocks, streaming: false }]
}

function applyToolResults(turns: Turn[], content: ContentBlock[], toolUseResult?: unknown): Turn[] {
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
        const content = splitToolContent(result.content, result.tool_use_result ?? toolUseResult)
        return {
          ...b,
          status: content.interrupted ? "stopped" : result.is_error ? "error" : "done",
          output: content.output,
          rawResult: result.tool_use_result ?? toolUseResult,
          images: content.images,
          exitCode: content.exitCode,
          interrupted: content.interrupted,
          endedAt: Date.now(),
        }
      }),
    }
  })
}

function appendNotice(turns: Turn[], block: Block): Turn[] {
  const last = turns.at(-1)
  if (last?.role === "assistant") return [...turns.slice(0, -1), { ...last, blocks: [...last.blocks, block] }]
  return [...turns, { role: "assistant", id: crypto.randomUUID(), streaming: false, blocks: [block] }]
}

function updateCompaction(turns: Turn[], status: CompactionBlock["status"], trigger?: CompactionBlock["trigger"]): Turn[] {
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]!
    if (turn.role === "user") break
    if (turn.role !== "assistant") continue
    if (turn.blocks.some(b => b.kind === "compaction" && b.status === "running")) return turns.map((t, index) => index === i ? { ...turn, blocks: turn.blocks.map(b => b.kind === "compaction" && b.status === "running" ? { ...b, status, trigger } : b) } : t)
  }
  return appendNotice(turns, { kind: "compaction", status, trigger, startedAt: status === "running" ? Date.now() : undefined })
}

function settleRetry(turns: Turn[]): Turn[] {
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]!
    if (turn.role === "user") break
    if (turn.role === "assistant" && turn.blocks.some(b => b.kind === "retry" && !b.done)) {
      const next = [...turns]
      next[i] = { ...turn, blocks: turn.blocks.map(b => b.kind === "retry" ? { ...b, done: true } : b) }
      return next
    }
  }
  return turns
}

function settlePending(turns: Turn[], status: "unknown" | "stopped"): Turn[] {
  return turns.map(t => t.role === "assistant" ? { ...t, streaming: false, pendingAssistant: undefined, stoppedStreamIndex: undefined, blocks: t.blocks.map(b => {
    if (b.kind === "thinking" || b.kind === "text") return { ...b, done: true }
    if (b.kind === "tool" && (b.status === "running" || b.status === "unknown")) return { ...b, status, endedAt: Date.now() }
    if (b.kind === "compaction" && (b.status === "running" || b.status === "unknown")) return { ...b, status }
    if (b.kind === "retry") return { ...b, done: true }
    return b
  }) } : t)
}

function closeStreaming(turns: Turn[]): Turn[] {
  const index = streamingIndex(turns)
  if (index === -1) return turns
  const next = [...turns]
  const turn = next[index] as Turn & { role: "assistant" }
  next[index] = {
    ...turn,
    streaming: false,
    pendingAssistant: undefined,
    stoppedStreamIndex: undefined,
    blocks: turn.blocks.map((b) =>
      b.kind === "thinking" || b.kind === "text" ? { ...b, done: true } : b,
    ),
  }
  return next
}

function stampTurn(turns: Turn[], durationMs?: number, interrupted = false, error?: string): Turn[] {
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
        error,
      },
    ]
  }
  const next = [...closed]
  next[lastAssistant] = {
    ...(next[lastAssistant] as Extract<Turn, { role: "assistant" }>),
    durationMs,
    interrupted,
    error,
    incomplete: false,
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
