import { useCallback, useEffect, useReducer, useRef } from "react"
import type {
  ContextUsage,
  ControlRequest,
  Envelope,
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
  | "context_usage"
  | "settings"
  | "startup_settings"
  | "effort"
  | "commands"
  | { model: string }
  | { mode: PermissionMode }

export function useAgent({ cwd, resume, sessionKey, runtimeId, defaultPermissionMode }: AgentOptions) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const ownerRef = useRef(runtimeId)
  const defaultModeRef = useRef(defaultPermissionMode)
  defaultModeRef.current = defaultPermissionMode
  const socketRef = useRef<WebSocket | null>(null)
  const modeRef = useRef<PermissionMode | undefined>(undefined)
  const pendingRef = useRef(new Map<string, ResponseKind>())

  const write = useCallback((message: Outgoing) => {
    const socket = socketRef.current
    if (socket?.readyState !== WebSocket.OPEN) return false
    socket.send(JSON.stringify(message))
    return true
  }, [])

  const control = useCallback(
    (request: ControlRequest, expects?: ResponseKind) => {
      const requestId = crypto.randomUUID()
      if (expects) pendingRef.current.set(requestId, expects)
      write({ type: "control_request", request_id: requestId, request })
    },
    [write],
  )

  useEffect(() => {
    ownerRef.current = runtimeId
    dispatch({ type: "reset" })
    pendingRef.current.clear()
    modeRef.current = undefined

    const params = new URLSearchParams()
    if (cwd) params.set("cwd", cwd)
    if (resume) params.set("resume", resume)
    params.set("runtime", runtimeId)
    const url = new URL(`/ws?${params}`, window.location.href)
    url.protocol = url.protocol.replace("http", "ws")

    const socket = new WebSocket(url)
    socketRef.current = socket
    // Under StrictMode the effect runs twice; events from a replaced socket are ignored.
    const isCurrent = () => socketRef.current === socket

    socket.onopen = () => {
      if (isCurrent()) control({ subtype: "initialize" }, "initialize")
    }

    socket.onmessage = (event) => {
      if (!isCurrent()) return
      const envelope = JSON.parse(String(event.data)) as Envelope
      switch (envelope.kind) {
        case "interrupt":
          dispatch({ type: "interrupt-requested" })
          break
        case "attached":
          break
        case "turn-diff":
          dispatch({ type: "turn-diff", diff: envelope.diff })
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
          for (const item of envelope.items) {
            if (item.kind === "user") dispatch({ type: "history-user", id: crypto.randomUUID(), text: item.text, images: item.images })
            else if (item.kind === "turn-duration") dispatch({ type: "turn-duration", durationMs: item.durationMs, interrupted: item.interrupted })
            else if (item.kind === "turn-diff") dispatch({ type: "turn-diff", diff: item.diff })
            else dispatch({ type: "agent", message: item.message })
          }
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
              if (message.response.subtype === "error") {
                dispatch({ type: "error", text: message.response.error ?? "Agent rejected the request" })
                if (kind === "initialize") socket.close()
              } else routeResponse(kind, message.response.response)
            }
          }
          if (message.type === "control_request" && !["can_use_tool", "elicitation"].includes(message.request.subtype)) {
            socket.send(JSON.stringify({ type: "control_response", response: { subtype: "error", request_id: message.request_id, error: `Unsupported GUI request: ${message.request.subtype}` } }))
          }
          if (message.type === "result" && !message.parent_tool_use_id && pendingRef.current.size === 0) control({ subtype: "get_context_usage" }, "context_usage")
          dispatch({ type: "agent", message })
          break
        }
        case "log":
          dispatch({ type: "log", text: envelope.text })
          break
        case "exit":
          dispatch({ type: "log", text: `agent exited (code ${envelope.code ?? "null"})` })
          dispatch({ type: "connection", status: "closed" })
          break
      }
    }

    socket.onclose = () => {
      if (isCurrent()) dispatch({ type: "connection", status: "closed" })
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
      if (kind === "effort") {
        control({ subtype: "get_settings" }, "settings")
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
          },
        })
      } else if (kind === "settings" || kind === "startup_settings") {
        const applied = body.applied as { model?: string; effort?: string | null } | undefined
        const effective = body.effective as { permissions?: { defaultMode?: PermissionMode } } | undefined
        if (applied?.model) dispatch({ type: "model-set", model: applied.model })
        dispatch({ type: "effort-set", effort: applied?.effort ?? undefined })
        if (kind === "startup_settings") {
          const cliMode = modeRef.current ?? effective?.permissions?.defaultMode ?? "default"
          const guiMode = defaultModeRef.current
          if (!resume && !modeRef.current && guiMode && guiMode !== cliMode) control({ subtype: "set_permission_mode", mode: guiMode }, { mode: guiMode })
          else dispatch({ type: "permission-mode-set", mode: cliMode })
        }
      } else {
        dispatch({ type: "control", payload: { kind: "context_usage", usage: body as unknown as ContextUsage } })
      }
    }

    return () => {
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

  return { state: ownerRef.current === runtimeId ? state : initialState, sendMessage, reloadCommands, answerElicitation, removeQueued, moveQueued, updateQueued, steerQueued, setQueuePaused, runQueued, stopTask, interrupt, answerPermission, setModel, setPermissionMode, setEffort, refreshContext, turnDiffAction, clearDiffAction }
}
