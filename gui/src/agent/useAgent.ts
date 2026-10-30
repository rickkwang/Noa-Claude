import { useCallback, useEffect, useReducer, useRef } from "react"
import type {
  AccountInfo,
  CliSettings,
  ContextUsage,
  ControlRequest,
  McpServerStatus,
  Envelope,
  AgentMessage,
  UserContent,
  ModelInfo,
  Outgoing,
  PermissionMode,
  SlashCommand,
} from "./protocol"
import { initialState, reducer, type Permission } from "./reducer"

interface AgentOptions {
  cwd?: string
  // Session to reopen; undefined starts a new session.
  resume?: string
  // Changing sessionKey opens a fresh socket even when cwd and resume are unchanged.
  sessionKey: number
  runtimeId: string
  // GUI default for new sessions; the CLI's own default applies when unset.
  defaultPermissionMode?: PermissionMode
}

// Requests whose responses carry data the UI needs; everything else is fire-and-forget.
type ResponseKind =
  | "initialize"
  | "auth_urls"
  | "auth_complete"
  | "context_usage"
  | "mcp_status"
  | "mcp_action"
  | "settings"
  | "startup_settings"
  | "effort"
  | "commands"
  | { model: string }
  | { mode: PermissionMode }

const INITIALIZE_TIMEOUT_MS = 20_000

export function useAgent({ cwd, resume, sessionKey, runtimeId, defaultPermissionMode }: AgentOptions) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const ownerRef = useRef(runtimeId)
  const defaultModeRef = useRef(defaultPermissionMode)
  defaultModeRef.current = defaultPermissionMode
  const socketRef = useRef<WebSocket | null>(null)
  const modeRef = useRef<PermissionMode | undefined>(undefined)
  const pendingRef = useRef(new Map<string, ResponseKind>())
  const mcpTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const contextTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const contextRefreshAfterRef = useRef(false)

  const write = useCallback((message: Outgoing) => {
    const socket = socketRef.current
    if (socket?.readyState !== WebSocket.OPEN) return false
    socket.send(JSON.stringify(message))
    return true
  }, [])

  const control = useCallback(
    (request: ControlRequest, expects?: ResponseKind) => {
      if (expects === "mcp_action" && [...pendingRef.current.values()].includes("mcp_action")) return false
      if (expects === "context_usage" && [...pendingRef.current.values()].includes("context_usage")) return false
      const requestId = crypto.randomUUID()
      if (expects) pendingRef.current.set(requestId, expects)
      const sent = write({ type: "control_request", request_id: requestId, request })
      if (!sent && expects) pendingRef.current.delete(requestId)
      if (expects === "mcp_action") {
        if (sent) mcpTimerRef.current = setTimeout(() => {
          pendingRef.current.delete(requestId)
          mcpTimerRef.current = undefined
          dispatch({ type: "mcp-pending", pending: false })
          dispatch({ type: "error", text: "MCP request timed out. Refresh server status before trying again." })
        }, 60000)
        else dispatch({ type: "error", text: "Noa is disconnected." })
      }
      if (expects === "context_usage") {
        dispatch(sent ? { type: "context-request" } : { type: "context-error", error: "Agent is disconnected" })
        if (sent) contextTimerRef.current = setTimeout(() => {
          pendingRef.current.delete(requestId)
          contextTimerRef.current = undefined
          contextRefreshAfterRef.current = false
          dispatch({ type: "context-error", error: "Context request timed out. Try again." })
        }, 20000)
      }
      return sent
    },
    [write],
  )

  useEffect(() => {
    ownerRef.current = runtimeId
    dispatch({ type: "reset" })
    pendingRef.current.clear()
    contextRefreshAfterRef.current = false
    modeRef.current = undefined

    const params = new URLSearchParams()
    if (cwd) params.set("cwd", cwd)
    if (resume) params.set("resume", resume)
    params.set("runtime", runtimeId)
    // Start the CLI in the chosen mode so the first turn and a resumed session already run under it.
    if (defaultModeRef.current && defaultModeRef.current !== "bypassPermissions" && defaultModeRef.current !== "dontAsk") params.set("mode", defaultModeRef.current)
    const url = new URL(`/ws?${params}`, window.location.href)
    url.protocol = url.protocol.replace("http", "ws")

    const socket = new WebSocket(url)
    socketRef.current = socket
    // Under StrictMode the effect runs twice; events from a replaced socket are ignored.
    const isCurrent = () => socketRef.current === socket
    let initializationTimer: ReturnType<typeof setTimeout> | undefined
    const clearInitializationTimer = () => {
      if (initializationTimer !== undefined) clearTimeout(initializationTimer)
      initializationTimer = undefined
    }

    socket.onopen = () => {
      if (!isCurrent()) return
      initializationTimer = setTimeout(() => {
        if (!isCurrent()) return
        dispatch({
          type: "error",
          text: "Noa did not finish starting within 20 seconds. Open Activity → Diagnostics for details.",
        })
        socket.close()
      }, INITIALIZE_TIMEOUT_MS)
      control({ subtype: "initialize" }, "initialize")
    }

    let deltaFrame: number | undefined
    let pendingDeltas: Extract<AgentMessage, { type: "stream_event" }>[] = []
    const flushDeltas = () => {
      if (deltaFrame !== undefined) cancelAnimationFrame(deltaFrame)
      deltaFrame = undefined
      for (const message of pendingDeltas) dispatch({ type: "agent", message })
      pendingDeltas = []
    }

    socket.onmessage = (event) => {
      if (!isCurrent()) return
      const envelope = JSON.parse(String(event.data)) as Envelope
      if (envelope.kind === "agent" && envelope.message.type === "stream_event" && envelope.message.event.type === "content_block_delta") {
        const message = envelope.message
        const previous = pendingDeltas[pendingDeltas.length - 1]
        const next = message.event
        const last = previous?.event
        if (previous?.parent_tool_use_id === message.parent_tool_use_id && last?.type === "content_block_delta" && next.type === "content_block_delta" && last.index === next.index && last.delta.type === next.delta.type) {
          if (last.delta.type === "text_delta" && next.delta.type === "text_delta") last.delta.text += next.delta.text
          else if (last.delta.type === "thinking_delta" && next.delta.type === "thinking_delta") last.delta.thinking += next.delta.thinking
          else if (last.delta.type === "input_json_delta" && next.delta.type === "input_json_delta") last.delta.partial_json += next.delta.partial_json
        } else pendingDeltas.push(message)
        deltaFrame ??= requestAnimationFrame(flushDeltas)
        return
      }
      flushDeltas()
      switch (envelope.kind) {
        case "interrupt":
          dispatch({ type: "interrupt-requested" })
          break
        case "attached":
          if (envelope.mode) modeRef.current = envelope.mode
          break
        case "turn-diff":
          dispatch({ type: "turn-diff", diff: envelope.diff, updateOnly: envelope.updateOnly })
          break
        case "turn-diff-live":
          dispatch({ type: "turn-diff-live", diff: envelope.diff })
          break
        case "turn-diff-action":
          dispatch({
            type: "turn-diff-action",
            turnIndex: envelope.turnIndex,
            action: envelope.action,
            result: envelope.result,
          })
          break
        case "history":
          dispatch({ type: "history", items: envelope.items, before: envelope.before, prepend: envelope.prepend })
          break
        case "user":
          dispatch({ type: "user-sent", id: envelope.id, content: envelope.content })
          break
        case "queue":
          dispatch({ type: "queue", messages: envelope.messages, paused: envelope.paused })
          break
        case "agent": {
          const message = envelope.message
          if (message.type === "system" && (message.subtype === "init" || message.subtype === "status") && message.permissionMode) modeRef.current = message.permissionMode
          if (message.type === "control_response") {
            const kind = pendingRef.current.get(message.response.request_id)
            if (kind) {
              pendingRef.current.delete(message.response.request_id)
              if (kind === "context_usage") { clearTimeout(contextTimerRef.current); contextTimerRef.current = undefined }
              if (kind === "initialize") clearInitializationTimer()
              if (kind === "mcp_action") {
                clearTimeout(mcpTimerRef.current)
                mcpTimerRef.current = undefined
                dispatch({ type: "mcp-pending", pending: false })
                control({ subtype: "mcp_status" }, "mcp_status")
              }
              if (message.response.subtype === "error") {
                const error = message.response.error ?? "Agent rejected the request"
                if (kind === "context_usage") dispatch({ type: "context-error", error })
                else if (kind === "auth_urls" || kind === "auth_complete") dispatch({ type: "auth-error", error })
                else dispatch({ type: "error", text: error })
                if (kind === "initialize") socket.close()
              } else routeResponse(kind, message.response.response)
              if (kind === "context_usage" && contextRefreshAfterRef.current) {
                contextRefreshAfterRef.current = false
                control({ subtype: "get_context_usage" }, "context_usage")
              }
            }
          }
          if (message.type === "control_request" && !["can_use_tool", "elicitation"].includes(message.request.subtype)) {
            socket.send(JSON.stringify({ type: "control_response", response: { subtype: "error", request_id: message.request_id, error: `Unsupported GUI request: ${message.request.subtype}` } }))
          }
          if (message.type === "result" && !message.parent_tool_use_id) {
            if ([...pendingRef.current.values()].includes("context_usage")) contextRefreshAfterRef.current = true
            else control({ subtype: "get_context_usage" }, "context_usage")
          }
          dispatch({ type: "agent", message })
          break
        }
        case "log":
          dispatch({ type: "log", text: envelope.text })
          break
        case "exit":
          dispatch({ type: "log", text: `agent exited (code ${envelope.code ?? "null"})` })
          dispatch({ type: "exit", code: envelope.code })
          break
      }
    }

    socket.onclose = () => {
      clearInitializationTimer()
      if (isCurrent()) {
        clearTimeout(mcpTimerRef.current)
        mcpTimerRef.current = undefined
        clearTimeout(contextTimerRef.current)
        contextTimerRef.current = undefined
        contextRefreshAfterRef.current = false
        dispatch({ type: "mcp-pending", pending: false })
        flushDeltas(); dispatch({ type: "connection", status: "closed" })
      }
    }

    function routeResponse(kind: ResponseKind, response: unknown) {
      if (typeof kind === "object") {
        if ("model" in kind) {
          dispatch({ type: "model-set", model: kind.model })
          control({ subtype: "get_settings" }, "settings")
        } else { modeRef.current = kind.mode; dispatch({ type: "permission-mode-set", mode: kind.mode }) }
        return
      }
      if (kind === "commands") {
        const commands = (response as { commands?: SlashCommand[] })?.commands ?? []
        dispatch({ type: "control", payload: { kind: "commands", commands } })
        const errors = (response as { error_count?: number })?.error_count ?? 0
        dispatch({ type: "notice", text: `Reloaded ${commands.filter((command) => !command.hidden).length} commands and skills${errors ? ` · ${errors} plugin errors` : ""}` })
        return
      }
      if (kind === "auth_urls") {
        const body = (response ?? {}) as { automaticUrl?: unknown; manualUrl?: unknown }
        if (typeof body.automaticUrl === "string" && typeof body.manualUrl === "string")
          dispatch({ type: "auth-urls", automaticUrl: body.automaticUrl, manualUrl: body.manualUrl })
        else dispatch({ type: "auth-error", error: "Noa did not return a sign-in URL." })
        return
      }
      if (kind === "auth_complete") {
        const body = (response ?? {}) as { account?: AccountInfo }
        dispatch({ type: "auth-complete", account: body.account ?? {} })
        control({ subtype: "get_settings" }, "settings")
        return
      }
      if (kind === "effort") {
        control({ subtype: "get_settings" }, "settings")
        return
      }
      if (kind === "mcp_action") return
      if (kind === "mcp_status") {
        const servers = (response as { mcpServers?: McpServerStatus[] } | undefined)?.mcpServers
        if (Array.isArray(servers)) dispatch({ type: "control", payload: { kind: "mcp_status", servers } })
        return
      }
      const body = (response ?? {}) as Record<string, unknown>
      if (kind === "initialize") {
        dispatch({ type: "connection", status: "ready" })
        control({ subtype: "get_context_usage" }, "context_usage")
        control({ subtype: "get_settings" }, "startup_settings")
        dispatch({
          type: "control",
          payload: {
            kind: "initialize",
            models: (body.models as ModelInfo[] | undefined) ?? [],
            commands: (body.commands as SlashCommand[] | undefined) ?? [],
            account: body.account as AccountInfo | undefined,
          },
        })
      } else if (kind === "settings" || kind === "startup_settings") {
        dispatch({ type: "control", payload: { kind: "settings", settings: body as unknown as CliSettings } })
        const applied = body.applied as { model?: string; effort?: string | null } | undefined
        const effective = body.effective as { permissions?: { defaultMode?: PermissionMode } } | undefined
        if (applied?.model) dispatch({ type: "model-set", model: applied.model })
        dispatch({ type: "effort-set", effort: applied?.effort ?? undefined })
        if (kind === "startup_settings") {
          dispatch({ type: "permission-mode-set", mode: modeRef.current ?? effective?.permissions?.defaultMode ?? "default" })
        }
      } else {
        dispatch({ type: "control", payload: { kind: "context_usage", usage: body as unknown as ContextUsage } })
      }
    }

    return () => {
      if (deltaFrame !== undefined) cancelAnimationFrame(deltaFrame)
      pendingDeltas = []
      clearInitializationTimer()
      clearTimeout(contextTimerRef.current)
      contextTimerRef.current = undefined
      clearTimeout(mcpTimerRef.current)
      mcpTimerRef.current = undefined
      socketRef.current = null
      socket.close()
    }
  }, [cwd, resume, sessionKey, runtimeId, control])

  const sendMessage = useCallback(
    (content: UserContent) => write({ type: "user", message: { role: "user", content }, parent_tool_use_id: null }),
    [write],
  )

  const interrupt = useCallback(() => {
    dispatch({ type: "interrupt-requested" })
    control({ subtype: "interrupt" })
  }, [control])

  const setModel = useCallback(
    (model: string) => {
      control({ subtype: "set_model", model }, { model })
    },
    [control],
  )

  const setPermissionMode = useCallback(
    (mode: PermissionMode) => {
      control({ subtype: "set_permission_mode", mode }, { mode })
    },
    [control],
  )

  const loadEarlier = useCallback(() => {
    if (!state.historyBefore || state.historyLoading) return
    if (write({ type: "history_before", before: state.historyBefore })) dispatch({ type: "history-loading" })
  }, [write, state.historyBefore, state.historyLoading])

  const refreshSettings = useCallback(() => control({ subtype: "get_settings" }, "settings"), [control])
  const changeMcp = useCallback((serverName: string, enabled?: boolean) => {
    const sent = control(enabled === undefined ? { subtype: "mcp_reconnect", serverName } : { subtype: "mcp_toggle", serverName, enabled }, "mcp_action")
    if (sent) dispatch({ type: "mcp-pending", pending: true })
  }, [control])
  const refreshMcp = useCallback(() => control({ subtype: "mcp_status" }, "mcp_status"), [control])
  const refreshContext = useCallback(() => control({ subtype: "get_context_usage" }, "context_usage"), [control])

  const answerPermission = useCallback(
    (permission: Permission, allow: boolean, remember: boolean, updatedInput?: Record<string, unknown>) => {
      const sent = write({
        type: "control_response",
        response: {
          subtype: "success",
          request_id: permission.requestId,
          response: allow
            ? {
                behavior: "allow",
                updatedInput: updatedInput ?? permission.input,
                ...(remember ? { updatedPermissions: permission.suggestions } : {}),
              }
            : { behavior: "deny", message: "User denied tool execution" },
        },
      })
      if (sent) dispatch({ type: "permission-answered", requestId: permission.requestId })
    },
    [write],
  )

  const setEffort = useCallback(
    (effort: string | null) => control({ subtype: "apply_flag_settings", settings: { effortLevel: effort } }, "effort"),
    [control],
  )

  const answerElicitation = useCallback((requestId: string, action: "accept" | "decline" | "cancel", content?: Record<string, unknown>) => {
    if (write({ type: "control_response", response: { subtype: "success", request_id: requestId, response: { action, content } } })) dispatch({ type: "permission-answered", requestId })
  }, [write])
  const removeQueued = useCallback((id: string) => { write({ type: "queue_remove", id }) }, [write])
  const moveQueued = useCallback((id: string, toIndex: number) => { write({ type: "queue_move", id, toIndex }) }, [write])
  const updateQueued = useCallback((id: string, content: UserContent) => write({ type: "queue_update", id, content }), [write])
  const steerQueued = useCallback((id: string) => { write({ type: "queue_steer", id }) }, [write])
  const setQueuePaused = useCallback((paused: boolean) => { write({ type: "queue_pause", paused }) }, [write])
  const runQueued = useCallback(() => { write({ type: "queue_run" }) }, [write])
  const reloadCommands = useCallback(() => control({ subtype: "reload_plugins" }, "commands"), [control])
  const stopTask = useCallback((taskId: string) => control({ subtype: "stop_task", task_id: taskId }), [control])
  const turnDiffAction = useCallback(
    (turnIndex: number, action: "undo" | "reapply") => write({ type: "turn_diff_action", turnIndex, action }),
    [write],
  )
  const clearDiffAction = useCallback(() => dispatch({ type: "diff-action-clear" }), [])
  const startAuthentication = useCallback(() => {
    dispatch({ type: "auth-start" })
    if (!control({ subtype: "claude_authenticate", loginWithClaudeAi: true }, "auth_urls"))
      dispatch({ type: "auth-error", error: "Noa is not connected. Reconnect and try again." })
  }, [control])
  const waitForAuthentication = useCallback(() => {
    if (!control({ subtype: "claude_oauth_wait_for_completion" }, "auth_complete"))
      dispatch({ type: "auth-error", error: "Noa is not connected. Reconnect and try again." })
  }, [control])
  const submitAuthenticationCode = useCallback((raw: string) => {
    const parsed = parseAuthorizationCode(raw)
    if (!parsed) {
      dispatch({ type: "auth-error", error: "Paste the authorization code and state from the browser." })
      return
    }
    if (!control({
      subtype: "claude_oauth_callback",
      authorizationCode: parsed.authorizationCode,
      state: parsed.state,
    }, "auth_complete"))
      dispatch({ type: "auth-error", error: "Noa is not connected. Reconnect and try again." })
  }, [control])
  const closeAuthentication = useCallback(() => dispatch({ type: "auth-close" }), [])

  return { state: ownerRef.current === runtimeId ? state : initialState, sendMessage, reloadCommands, loadEarlier, answerElicitation, removeQueued, moveQueued, updateQueued, steerQueued, setQueuePaused, runQueued, stopTask, interrupt, answerPermission, setModel, setPermissionMode, setEffort, refreshSettings, changeMcp, refreshContext, refreshMcp, turnDiffAction, clearDiffAction, startAuthentication, waitForAuthentication, submitAuthenticationCode, closeAuthentication }
}

export function parseAuthorizationCode(raw: string): { authorizationCode: string; state: string } | undefined {
  const value = raw.trim()
  if (!value) return undefined
  try {
    const url = new URL(value)
    const authorizationCode = url.searchParams.get("code")
    const state = url.searchParams.get("state")
    if (authorizationCode && state) return { authorizationCode, state }
  } catch {
    // The browser success page also accepts the compact code#state form.
  }
  const separator = value.indexOf("#")
  if (separator <= 0 || separator === value.length - 1) return undefined
  return {
    authorizationCode: value.slice(0, separator),
    state: value.slice(separator + 1),
  }
}
