import type { ServerWebSocket, Subprocess } from "bun"
import { join } from "node:path"
import { loadHistory } from "./sessions"
import type { AgentMessage, Envelope, Outgoing, QueuedMessage } from "../src/agent/protocol"

export interface SocketData {
  cwd: string
  resume?: string
  runtimeId: string
  run?: AgentRun
}
interface AgentRun {
  id: string
  cwd: string
  sessionId?: string
  proc: Subprocess<"pipe", "pipe", "pipe">
  clients: Set<ServerWebSocket<SocketData>>
  journal: Envelope[]
  queue: QueuedMessage[]
  busy: boolean
  queuePaused?: boolean
  turnSucceeded?: boolean
  waiting: Set<string>
  title?: string
  initialization?: Extract<AgentMessage, { type: "control_response" }>
  initializationRequest?: string
  initializeWaiters: Map<ServerWebSocket<SocketData>, string>
  historyReady: Promise<void>
  exited: boolean
}
const runs = new Map<string, AgentRun>()
function emit(run: AgentRun, envelope: Envelope) {
  if (envelope.kind === "queue") run.journal = run.journal.filter((entry) => entry.kind !== "queue")
  if (envelope.kind === "agent" && envelope.message.type === "assistant") {
    const parent = envelope.message.parent_tool_use_id
    run.journal = run.journal.filter(
      (entry) =>
        !(
          entry.kind === "agent" &&
          entry.message.type === "stream_event" &&
          entry.message.parent_tool_use_id === parent
        ),
    )
  }
  run.journal.push(envelope)
  for (const client of run.clients) client.send(JSON.stringify(envelope))
}
function write(run: AgentRun, message: unknown) {
  run.proc.stdin.write(`${JSON.stringify(message)}\n`)
  run.proc.stdin.flush()
}
async function lines(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let at: number
    while ((at = buffer.indexOf("\n")) !== -1) {
      onLine(buffer.slice(0, at))
      buffer = buffer.slice(at + 1)
    }
  }
  if (buffer) onLine(buffer)
}
function startNext(run: AgentRun) {
  if (run.busy || run.waiting.size || run.exited || !run.queue.length) return
  const next = run.queue.shift()!
  run.busy = true
  run.turnSucceeded = undefined
  emit(run, { kind: "queue", messages: [...run.queue] })
  emit(run, { kind: "user", id: next.id, content: next.content })
  write(run, { type: "user", message: { role: "user", content: next.content }, parent_tool_use_id: null })
}
export function attachAgent(ws: ServerWebSocket<SocketData>, root: string) {
  let run = runs.get(ws.data.runtimeId)
  if (!run && ws.data.resume)
    run = [...runs.values()].find((r) => r.cwd === ws.data.cwd && r.sessionId === ws.data.resume && !r.exited)
  if (run && run.cwd !== ws.data.cwd) {
    ws.close(1008, "Workspace mismatch")
    return
  }
  if (!run || run.exited) {
    const args = [
      process.execPath,
      join(root, "run-noa.js"),
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--permission-prompt-tool",
      "stdio",
    ]
    if (ws.data.resume) args.push("--resume", ws.data.resume)
    const retainedQueue = run?.queue ?? []
    const proc = Bun.spawn(args, {
      cwd: ws.data.cwd,
      env: { ...process.env, CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: "1", CLAUDE_CODE_EAGER_FLUSH: "1" },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })
    run = {
      id: ws.data.runtimeId,
      cwd: ws.data.cwd,
      sessionId: ws.data.resume,
      proc,
      clients: new Set(),
      journal: retainedQueue.length ? [{ kind: "queue", messages: retainedQueue }] : [],
      queue: retainedQueue,
      busy: false,
      waiting: new Set(),
      initializeWaiters: new Map(),
      historyReady: Promise.resolve(),
      exited: false,
    }
    if (ws.data.resume) {
      const current = run
      current.historyReady = loadHistory(run.cwd, ws.data.resume)
        .then((items) => {
          if (!items) throw new Error("Task history not found")
          current.journal.unshift({ kind: "history", items })
        })
        .catch((error) => {
          emit(current, { kind: "log", text: `Cannot restore task: ${String(error)}` })
          current.proc.kill()
        })
    }
    runs.set(run.id, run)
    const current = run
    lines(proc.stdout, (line) => {
      if (!line.trim()) return
      let message: AgentMessage
      try {
        message = JSON.parse(line)
      } catch {
        emit(current, { kind: "log", text: line })
        return
      }
      if (message.type === "control_response") {
        const refreshedCommands = (message.response.response as { commands?: unknown } | undefined)?.commands
        if (message.response.subtype === "success" && Array.isArray(refreshedCommands) && current.initialization) {
          const original = current.initialization.response.response as Record<string, unknown>
          current.initialization = { ...current.initialization, response: { ...current.initialization.response, response: { ...original, commands: refreshedCommands } } }
        }
        if (message.response.request_id === current.initializationRequest) {
          if (message.response.subtype === "success") current.initialization = message
          for (const [client, requestId] of current.initializeWaiters)
            client.send(
              JSON.stringify({
                kind: "agent",
                message: { ...message, response: { ...message.response, request_id: requestId } },
              }),
            )
          current.initializeWaiters.clear()
          current.initializationRequest = undefined
        } else for (const client of current.clients) client.send(JSON.stringify({ kind: "agent", message }))
        return
      }
      if (message.type === "system" && message.subtype === "init") current.sessionId = message.session_id
      if (message.type === "control_request") current.waiting.add(message.request_id)
      if (message.type === "control_cancel_request") current.waiting.delete(message.request_id)
      emit(current, { kind: "agent", message })
      if (message.type === "result" && !message.parent_tool_use_id) current.turnSucceeded = !message.is_error
      if (message.type === "system" && message.subtype === "session_state_changed" && message.state === "idle") {
        current.busy = false
        if (current.turnSucceeded && !current.queuePaused) startNext(current)
      }
    }).catch((error) => emit(current, { kind: "log", text: String(error) }))
    lines(proc.stderr, (text) => emit(current, { kind: "log", text })).catch(() => {})
    proc.exited.then((code) => {
      current.exited = true
      current.busy = false
      if (!current.queue.length && runs.get(current.id) === current) runs.delete(current.id)
      emit(current, { kind: "exit", code })
    })
  }
  ws.data.run = run
  const current = run
  current.historyReady.then(() => {
    if (ws.readyState !== 1) return
    current.clients.add(ws)
    ws.send(JSON.stringify({ kind: "attached", runtimeId: current.id }))
    for (const envelope of current.journal) ws.send(JSON.stringify(envelope))
  })
}
export async function agentMessage(ws: ServerWebSocket<SocketData>, raw: string | Buffer) {
  const run = ws.data.run
  if (!run || run.exited || typeof raw !== "string") return
  await run.historyReady
  if (run.exited) return
  let message: Outgoing
  try {
    message = JSON.parse(raw)
  } catch {
    return
  }
  if (message.type === "user") {
    const content = message.message.content
    if (!run.title)
      run.title =
        (typeof content === "string"
          ? content
          : content
              .filter((b) => b.type === "text")
              .map((b) => b.text)
              .join(" ")
        ).slice(0, 80) || "Image task"
    if (!run.busy) run.queuePaused = false
    run.queue.push({ id: crypto.randomUUID(), content })
    emit(run, { kind: "queue", messages: [...run.queue] })
    startNext(run)
  } else if (message.type === "queue_remove") {
    run.queue = run.queue.filter((m) => m.id !== message.id)
    emit(run, { kind: "queue", messages: [...run.queue] })
  } else if (message.type === "queue_run") {
    run.queuePaused = false
    startNext(run)
  } else if (message.type === "control_request" && message.request.subtype === "initialize") {
    if (run.initialization)
      ws.send(
        JSON.stringify({
          kind: "agent",
          message: {
            ...run.initialization,
            response: { ...run.initialization.response, request_id: message.request_id },
          },
        }),
      )
    else {
      run.initializeWaiters.set(ws, message.request_id)
      if (!run.initializationRequest) {
        run.initializationRequest = message.request_id
        write(run, message)
      }
    }
  } else {
    if (message.type === "control_request" && message.request.subtype === "interrupt") {
      run.queuePaused = true
      emit(run, { kind: "interrupt" })
    }
    if (message.type === "control_response") {
      run.waiting.delete(message.response.request_id)
      emit(run, { kind: "agent", message: { type: "control_cancel_request", request_id: message.response.request_id } })
    }
    write(run, message)
  }
}
export function detachAgent(ws: ServerWebSocket<SocketData>) {
  const run = ws.data.run
  if (!run) return
  run.clients.delete(ws)
  run.initializeWaiters.delete(ws)
  if (!run.clients.size && !run.busy && !run.queue.length && !run.waiting.size) {
    run.proc.kill()
    runs.delete(run.id)
  }
}
export function listAgentRuns() {
  return [...runs.values()]
    .filter((r) => r.busy || r.queue.length || r.waiting.size || (r.sessionId && !r.exited))
    .map((r) => ({
      runtimeId: r.id,
      cwd: r.cwd,
      sessionId: r.sessionId,
      title: r.title,
      busy: r.busy,
      waiting: r.waiting.size > 0,
      queued: r.queue.length,
    }))
}
function shutdown() {
  for (const run of runs.values()) if (!run.exited) run.proc.kill()
}
process.on("SIGTERM", () => {
  shutdown()
  process.exit(0)
})
process.on("SIGINT", () => {
  shutdown()
  process.exit(0)
})
