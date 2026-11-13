import { useCallback, useEffect, useReducer, useRef, useState } from "react"
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
  ProviderInfo,
  Outgoing,
  PermissionMode,
  SlashCommand,
} from "./protocol"
import { initialState, reducer, type Permission, type AgentState } from "./reducer"

interface AgentOptions {
  cwd?: string
  // Session to reopen; undefined starts a new session.
  resume?: string
  // Changing sessionKey opens a fresh socket even when cwd and resume are unchanged.
  sessionKey: number
  runtimeId: string
  // GUI default for new sessions; the CLI's own default applies when unset.
  defaultPermissionMode?: PermissionMode
  // GUI default output style for new sessions; "inherit" keeps the CLI's own setting.
  defaultOutputStyle?: string
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
  | "output_style"
  | "provider"
  | "commands"
  | "commands-quiet"
  | { model: string }
  | { mode: PermissionMode }

type ModelPreview = Pick<AgentState, "models" | "model" | "effort" | "permissionMode">
function readModelPreview(cwd?: string): ModelPreview {
  try {
    const value = JSON.parse(localStorage.getItem(`noa-agent.modelPreview:${cwd ?? ""}`) ?? "null")
    if (value && Array.isArray(value.models) && value.models.every((m: ModelInfo) => m && typeof m.value === "string" && typeof m.displayName === "string") && typeof value.model === "string" && (value.effort === undefined || typeof value.effort === "string")) return { models: value.models, model: value.model, effort: value.effort, permissionMode: ["default", "auto", "acceptEdits", "plan"].includes(value.permissionMode) ? value.permissionMode : undefined }
  } catch {}
  return { models: [] }
}

const INITIALIZE_TIMEOUT_MS = 20_000

export function useAgent({ cwd, resume, sessionKey, runtimeId, defaultPermissionMode, defaultOutputStyle }: AgentOptions) {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({ ...initialState, ...readModelPreview(cwd), ...(defaultPermissionMode ? { permissionMode: defaultPermissionMode } : {}) }))
  // Bumped when another process releases the task this view was following, to attach a CLI of its own.
  const [followEnded, setFollowEnded] = useState(0)
  const queuedSelection = useRef<{ model?: string; effort?: string | null; mode?: PermissionMode }>({})
  const readyRef = useRef(false)
  readyRef.current = state.connection === "ready"
  // Read when a socket opens, so a new chat starts with the default in force at that moment.
  const defaultOutputStyleRef = useRef(defaultOutputStyle)
  defaultOutputStyleRef.current = defaultOutputStyle
  const modelPreviewCwdRef = useRef(cwd)
  useEffect(() => {
    if (modelPreviewCwdRef.current !== cwd || state.connection !== "ready" || !state.models.length || !state.model) return
    try {
      localStorage.setItem(`noa-agent.modelPreview:${cwd ?? ""}`, JSON.stringify({ models: state.models, model: state.model, effort: state.effort, permissionMode: state.permissionMode }))
    } catch {}
  }, [cwd, state.connection, state.models, state.model, state.effort, state.permissionMode])
  const ownerRef = useRef(runtimeId)
  const defaultModeRef = useRef(defaultPermissionMode)
  defaultModeRef.current = defaultPermissionMode
  const socketRef = useRef<WebSocket | null>(null)
  const modeRef = useRef<PermissionMode | undefined>(undefined)
  const pendingRef = useRef(new Map<string, ResponseKind>())
  const requestsRef = useRef(new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>())
  const mcpTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const contextTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const contextRefreshAfterRef = useRef<"summary" | "full" | undefined>(undefined)
  const authCompletedRef = useRef(false)

  const write = useCallback((message: Outgoing) => {
    const socket = socketRef.current
    if (socket?.readyState !== WebSocket.OPEN) return false
    socket.send(JSON.stringify(message))
    return true
  }, [])

  const control = useCallback(
    (request: ControlRequest, expects?: ResponseKind) => {
      if (expects === "mcp_action" && [...pendingRef.current.values()].includes("mcp_action")) return false
      if (expects === "context_usage" && [...pendingRef.current.values()].includes("context_usage")) {
        if (request.subtype === "get_context_usage" && request.detail === "full") contextRefreshAfterRef.current = "full"
        return false
      }
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
          contextRefreshAfterRef.current = undefined
          dispatch({ type: "context-error", error: "Context request timed out. Try again." })
        }, 20000)
      }
      return sent
    },
    [write],
  )

  const request = useCallback((request: ControlRequest): Promise<any> => new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID()
    const timer = setTimeout(() => {
      requestsRef.current.delete(requestId)
      reject(new Error("Request timed out. Reconnect before trying again."))
    }, 60000)
    requestsRef.current.set(requestId, { resolve, reject, timer })
    if (!write({ type: "control_request", request_id: requestId, request })) {
      clearTimeout(timer)
      requestsRef.current.delete(requestId)
      reject(new Error("Noa is disconnected."))
    }
  }), [write])

  useEffect(() => {
    ownerRef.current = runtimeId
    modelPreviewCwdRef.current = cwd
    dispatch({ type: "reset", modelPreview: { ...readModelPreview(cwd), ...(defaultModeRef.current ? { permissionMode: defaultModeRef.current } : {}) } })
    queuedSelection.current = {}
    pendingRef.current.clear()
    for (const pending of requestsRef.current.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error("Noa disconnected before the request completed."))
    }
    requestsRef.current.clear()
    contextRefreshAfterRef.current = undefined
    modeRef.current = undefined

    const params = new URLSearchParams()
    if (cwd) params.set("cwd", cwd)
    if (resume) params.set("resume", resume)
    params.set("runtime", runtimeId)
    // Start the CLI in the chosen mode so the first turn and a resumed session already run under it.
    if (defaultModeRef.current && defaultModeRef.current !== "bypassPermissions" && defaultModeRef.current !== "dontAsk") params.set("mode", defaultModeRef.current)
    if (defaultOutputStyleRef.current && defaultOutputStyleRef.current !== "inherit") params.set("outputStyle", defaultOutputStyleRef.current)
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
        case "external":
          clearInitializationTimer()
          dispatch({ type: "external", pid: envelope.pid, status: envelope.status })
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
          dispatch({ type: "user-sent", id: envelope.id, content: envelope.content, sentAt: envelope.at })
          break
        case "queue":
          dispatch({ type: "queue", messages: envelope.messages, paused: envelope.paused })
          break
        case "agent": {
          const message = envelope.message
          if (message.type === "system" && (message.subtype === "init" || message.subtype === "status") && message.permissionMode) modeRef.current = message.permissionMode
          if (message.type === "control_response") {
            const pending = requestsRef.current.get(message.response.request_id)
            if (pending) {
              clearTimeout(pending.timer)
              requestsRef.current.delete(message.response.request_id)
              if (message.response.subtype === "error") pending.reject(new Error(message.response.error ?? "Request failed"))
              else pending.resolve(message.response.response)
            }
            const kind = pendingRef.current.get(message.response.request_id)
            if (kind) {
              pendingRef.current.delete(message.response.request_id)
              if (kind === "context_usage") { clearTimeout(contextTimerRef.current); contextTimerRef.current = undefined }
              if (kind === "startup_settings") clearInitializationTimer()
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
                else if (kind === "provider") dispatch({ type: "provider-error", error })
                else dispatch({ type: "error", text: error })
                if (kind === "initialize" || kind === "startup_settings") socket.close()
              } else routeResponse(kind, message.response.response)
              if (kind === "context_usage" && contextRefreshAfterRef.current) {
                const detail = contextRefreshAfterRef.current
                contextRefreshAfterRef.current = undefined
                control({ subtype: "get_context_usage", detail }, "context_usage")
              }
            }
          }
          if (message.type === "control_request" && !["can_use_tool", "elicitation"].includes(message.request.subtype)) {
            socket.send(JSON.stringify({ type: "control_response", response: { subtype: "error", request_id: message.request_id, error: `Unsupported GUI request: ${message.request.subtype}` } }))
          }
          if (message.type === "result" && !message.parent_tool_use_id) {
            if ([...pendingRef.current.values()].includes("context_usage")) contextRefreshAfterRef.current ??= "summary"
            else control({ subtype: "get_context_usage", detail: "summary" }, "context_usage")
          }
          dispatch({ type: "agent", message })
          break
        }
        case "log":
          dispatch({ type: "log", text: envelope.text })
          break
        case "exit":
          for (const pending of requestsRef.current.values()) {
            clearTimeout(pending.timer)
            pending.reject(new Error("Noa exited before the request completed. Reconnect to continue."))
          }
          requestsRef.current.clear()
          dispatch({ type: "log", text: `agent exited (code ${envelope.code ?? "null"})` })
          dispatch({ type: "exit", code: envelope.code })
          break
      }
    }

    socket.onclose = (event) => {
      clearInitializationTimer()
      if (isCurrent() && event.code === 4000) {
        setFollowEnded(n => n + 1)
        return
      }
      if (isCurrent()) {
        for (const pending of requestsRef.current.values()) {
          clearTimeout(pending.timer)
          pending.reject(new Error("Noa disconnected before the request completed."))
        }
        requestsRef.current.clear()
        clearTimeout(mcpTimerRef.current)
        mcpTimerRef.current = undefined
        clearTimeout(contextTimerRef.current)
        contextTimerRef.current = undefined
        contextRefreshAfterRef.current = undefined
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
      if (kind === "commands" || kind === "commands-quiet") {
        const commands = (response as { commands?: SlashCommand[] })?.commands ?? []
        dispatch({ type: "control", payload: { kind: "commands", commands } })
        // Reloads that follow a settings change update the lists without announcing themselves in the composer.
        if (kind === "commands-quiet") return
        const errors = (response as { error_count?: number })?.error_count ?? 0
        dispatch({ type: "notice", text: `Reloaded ${commands.filter((command) => !command.hidden).length} commands and skills${errors ? ` · ${errors} plugin errors` : ""}` })
        return
      }
      if (kind === "auth_urls") {
        const body = (response ?? {}) as { automaticUrl?: unknown; manualUrl?: unknown }
        if (typeof body.automaticUrl === "string" && typeof body.manualUrl === "string") {
          dispatch({ type: "auth-urls", automaticUrl: body.automaticUrl, manualUrl: body.manualUrl })
          // Go straight to the browser and start waiting for its redirect, so sign-in finishes
          // on its own; the dialog only offers to reopen the page or paste a code.
          if (/^https?:\/\//.test(body.automaticUrl)) window.open(body.automaticUrl, "_blank", "noopener,noreferrer")
          if (!control({ subtype: "claude_oauth_wait_for_completion" }, "auth_complete"))
            dispatch({ type: "auth-error", error: "Noa is not connected. Reconnect and try again." })
        } else dispatch({ type: "auth-error", error: "Noa did not return a sign-in URL." })
        return
      }
      if (kind === "auth_complete") {
        if (authCompletedRef.current) return
        authCompletedRef.current = true
        const body = (response ?? {}) as Record<string, unknown>
        if (Array.isArray(body.providers) && Array.isArray(body.models)) {
          dispatch({
            type: "control",
            payload: {
              kind: "provider",
              models: body.models as ModelInfo[],
              providers: body.providers as ProviderInfo[],
              account: body.account as AccountInfo | undefined,
              model: body.model as string | undefined,
            },
          })
        }
        dispatch({ type: "auth-complete", account: (body.account as AccountInfo | undefined) ?? {} })
        control({ subtype: "get_settings" }, "settings")
        control({ subtype: "get_context_usage", detail: "summary" }, "context_usage")
        return
      }
      if (kind === "provider") {
        const body = (response ?? {}) as Record<string, unknown>
        dispatch({
          type: "control",
          payload: {
            kind: "provider",
            models: (body.models as ModelInfo[] | undefined) ?? [],
            providers: (body.providers as ProviderInfo[] | undefined) ?? [],
            account: body.account as AccountInfo | undefined,
            model: body.model as string | undefined,
          },
        })
        control({ subtype: "get_settings" }, "settings")
        control({ subtype: "get_context_usage", detail: "summary" }, "context_usage")
        return
      }
      if (kind === "effort" || kind === "output_style") {
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
        control({ subtype: "get_settings" }, "startup_settings")
        control({ subtype: "get_context_usage", detail: "summary" }, "context_usage")
        dispatch({
          type: "control",
          payload: {
            kind: "initialize",
            models: (body.models as ModelInfo[] | undefined) ?? [],
            commands: (body.commands as SlashCommand[] | undefined) ?? [],
            account: body.account as AccountInfo | undefined,
            providers: body.providers as ProviderInfo[] | undefined,
          },
        })
      } else if (kind === "settings" || kind === "startup_settings") {
        dispatch({ type: "control", payload: { kind: "settings", settings: body as unknown as CliSettings } })
        const applied = body.applied as { model?: string; effort?: string | null } | undefined
        const effective = body.effective as { permissions?: { defaultMode?: PermissionMode }; outputStyle?: string } | undefined
        if (applied?.model) dispatch({ type: "model-set", model: applied.model })
        dispatch({ type: "effort-set", effort: applied?.effort ?? undefined })
        dispatch({ type: "output-style-set", style: effective?.outputStyle })
        if (kind === "startup_settings") {
          dispatch({ type: "permission-mode-set", mode: modeRef.current ?? effective?.permissions?.defaultMode ?? "default" })
          const selection = queuedSelection.current
          queuedSelection.current = {}
          if (selection.mode !== undefined) {
            dispatch({ type: "permission-mode-set", mode: selection.mode })
            control({ subtype: "set_permission_mode", mode: selection.mode }, { mode: selection.mode })
          }
          if (selection.model !== undefined) {
            dispatch({ type: "model-set", model: selection.model })
            control({ subtype: "set_model", model: selection.model }, { model: selection.model })
          }
          if (selection.effort !== undefined) {
            dispatch({ type: "effort-set", effort: selection.effort ?? undefined })
            control({ subtype: "apply_flag_settings", settings: { effortLevel: selection.effort } }, "effort")
          }
          dispatch({ type: "connection", status: "ready" })
        }
      } else {
        dispatch({ type: "control", payload: { kind: "context_usage", usage: body as unknown as ContextUsage } })
      }
    }

    return () => {
      for (const pending of requestsRef.current.values()) {
        clearTimeout(pending.timer)
        pending.reject(new Error("Noa disconnected before the request completed."))
      }
      requestsRef.current.clear()
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
  }, [cwd, resume, sessionKey, runtimeId, control, followEnded])

  const sendMessage = useCallback(
    (content: UserContent, delivery?: "queue" | "steer") =>
      write({ type: "user", message: { role: "user", content }, parent_tool_use_id: null, ...(delivery ? { delivery } : {}) }),
    [write],
  )

  const interrupt = useCallback(() => {
    dispatch({ type: "interrupt-requested" })
    control({ subtype: "interrupt" })
  }, [control])

  const setModel = useCallback(
    (model: string) => {
      if (!readyRef.current) {
        queuedSelection.current.model = model
        dispatch({ type: "model-set", model })
        return
      }
      control({ subtype: "set_model", model }, { model })
    },
    [control],
  )

  const sendProviderControl = useCallback(
    (payload: ControlRequest) => {
      dispatch({ type: "provider-pending", pending: true })
      if (!control(payload, "provider"))
        dispatch({ type: "provider-error", error: "Noa is not connected. Reconnect and try again." })
    },
    [control],
  )

  const setProvider = useCallback(
    (providerId: string) => sendProviderControl({ subtype: "set_provider", providerId }),
    [sendProviderControl],
  )

  const saveProvider = useCallback(
    (draft: { id?: string; type?: string; name: string; baseUrl: string; apiKey: string; model: string }) =>
      sendProviderControl({ subtype: "provider_save", ...draft }),
    [sendProviderControl],
  )

  // Lists the endpoint's models. The agent also keeps them on the saved profile and replies with the refreshed provider state.
  const fetchProviderModels = useCallback(
    async (draft: { id?: string; type?: string; baseUrl: string; apiKey: string }) => {
      const body = (await request({ subtype: "provider_models", id: draft.id, type: draft.type ?? "", baseUrl: draft.baseUrl, apiKey: draft.apiKey })) as Record<string, unknown>
      dispatch({
        type: "control",
        payload: {
          kind: "provider",
          models: (body.models as ModelInfo[] | undefined) ?? [],
          providers: (body.providers as ProviderInfo[] | undefined) ?? [],
          account: body.account as AccountInfo | undefined,
          model: body.model as string | undefined,
        },
      })
      return (body.fetchedModels as string[] | undefined) ?? []
    },
    [request],
  )

  const deleteProvider = useCallback(
    (providerId: string) => sendProviderControl({ subtype: "provider_delete", providerId }),
    [sendProviderControl],
  )

  const setPermissionMode = useCallback(
    (mode: PermissionMode) => {
      if (!readyRef.current) {
        if (mode === "bypassPermissions" || mode === "dontAsk") return
        queuedSelection.current.mode = mode
        dispatch({ type: "permission-mode-set", mode })
        return
      }
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
  const refreshContext = useCallback(() => control({ subtype: "get_context_usage", detail: "full" }, "context_usage"), [control])

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

  // Applies to this chat only; the default for new chats lives in the GUI settings.
  const setOutputStyle = useCallback(
    (style: string) => {
      if (!readyRef.current) return
      dispatch({ type: "output-style-set", style })
      control({ subtype: "apply_flag_settings", settings: { outputStyle: style } }, "output_style")
    },
    [control],
  )

  const setEffort = useCallback(
    (effort: string | null) => {
      if (!readyRef.current) {
        queuedSelection.current.effort = effort
        dispatch({ type: "effort-set", effort: effort ?? undefined })
        return
      }
      control({ subtype: "apply_flag_settings", settings: { effortLevel: effort } }, "effort")
    },
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
  const reloadCommands = useCallback((quiet = false) => control({ subtype: "reload_plugins" }, quiet ? "commands-quiet" : "commands"), [control])
  const stopTask = useCallback((taskId: string) => control({ subtype: "stop_task", task_id: taskId }), [control])
  const turnDiffAction = useCallback(
    (turnIndex: number, action: "undo" | "reapply") => write({ type: "turn_diff_action", turnIndex, action }),
    [write],
  )
  const clearDiffAction = useCallback(() => dispatch({ type: "diff-action-clear" }), [])
  const startAuthentication = useCallback(() => {
    authCompletedRef.current = false
    dispatch({ type: "auth-start" })
    if (!control({ subtype: "claude_authenticate", loginWithClaudeAi: true }, "auth_urls"))
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

  return { state: ownerRef.current === runtimeId ? state : initialState, request, sendMessage, reloadCommands, loadEarlier, answerElicitation, removeQueued, moveQueued, updateQueued, steerQueued, setQueuePaused, runQueued, stopTask, interrupt, answerPermission, setModel, setProvider, saveProvider, fetchProviderModels, deleteProvider, setPermissionMode, setEffort, setOutputStyle, refreshSettings, changeMcp, refreshContext, refreshMcp, turnDiffAction, clearDiffAction, startAuthentication, submitAuthenticationCode, closeAuthentication }
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
