import { useCallback, useEffect, useReducer, useRef } from "react"
import { query } from "../api"
import type {
  ContextUsage,
  ControlRequest,
  Envelope,
  HistoryItem,
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
  | { model: string }
  | { mode: PermissionMode }

export function useAgent({ cwd, resume, sessionKey, defaultPermissionMode }: AgentOptions) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const defaultModeRef = useRef(defaultPermissionMode)
  defaultModeRef.current = defaultPermissionMode
  const socketRef = useRef<WebSocket | null>(null)
  const pendingRef = useRef(new Map<string, ResponseKind>())

  const write = useCallback((message: Outgoing) => {
    const socket = socketRef.current
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
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
    dispatch({ type: "reset" })
    pendingRef.current.clear()

    const params = new URLSearchParams()
    if (cwd) params.set("cwd", cwd)
    if (resume) params.set("resume", resume)
    const url = new URL(`/ws?${params}`, window.location.href)
    url.protocol = url.protocol.replace("http", "ws")

    const socket = new WebSocket(url)
    socketRef.current = socket
    // Under StrictMode the effect runs twice; events from a replaced socket are ignored.
    const isCurrent = () => socketRef.current === socket

    const history = resume
      ? loadHistory(cwd, resume)
          .then((items) => {
            if (!isCurrent()) return
            for (const item of items) {
              if (item.kind === "user") dispatch({ type: "history-user", id: crypto.randomUUID(), text: item.text })
              else dispatch({ type: "agent", message: item.message })
            }
          })
          .catch((error) => {
            if (isCurrent()) dispatch({ type: "error", text: `Cannot restore task: ${(error as Error).message}` })
            return false
          })
      : Promise.resolve()

    // The agent prints system/init only after the first user turn, so the
    // initialize response is what marks the connection ready.
    socket.onopen = async () => {
      try {
        if ((await history) === false) {
          socket.close()
          return
        }
        if (isCurrent()) control({ subtype: "initialize" }, "initialize")
      } catch (error) {
        if (!isCurrent()) return
        dispatch({ type: "error", text: `Cannot restore task: ${(error as Error).message}` })
        socket.close()
      }
    }

    socket.onmessage = (event) => {
      if (!isCurrent()) return
      const envelope = JSON.parse(String(event.data)) as Envelope
      switch (envelope.kind) {
        case "agent": {
          const message = envelope.message
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
          if (message.type === "result") control({ subtype: "get_context_usage" }, "context_usage")
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
        } else dispatch({ type: "permission-mode-set", mode: kind.mode })
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
          const cliMode = effective?.permissions?.defaultMode ?? "default"
          const guiMode = defaultModeRef.current
          if (guiMode && guiMode !== cliMode) control({ subtype: "set_permission_mode", mode: guiMode }, { mode: guiMode })
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
  }, [cwd, resume, sessionKey, control])

  const sendMessage = useCallback(
    (text: string) => {
      if (state.connection !== "ready") return
      dispatch({ type: "user-sent", id: crypto.randomUUID(), text })
      write({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null })
    },
    [state.connection, write],
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
      write({
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
      dispatch({ type: "permission-answered", requestId: permission.requestId })
    },
    [write],
  )

  const setEffort = useCallback(
    (effort: string | null) => control({ subtype: "apply_flag_settings", settings: { effortLevel: effort } }, "effort"),
    [control],
  )

  return { state, sendMessage, interrupt, answerPermission, setModel, setPermissionMode, setEffort, refreshContext }
}

async function loadHistory(cwd: string | undefined, sessionId: string): Promise<HistoryItem[]> {
  const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}${query(cwd)}`)
  if (!response.ok) throw new Error(`History request failed (${response.status})`)
  return (await response.json()) as HistoryItem[]
}
