// Interactive shells for the GUI's terminal panel, one PTY per tab.
import { basename } from "node:path"
import type { ServerWebSocket, Subprocess } from "bun"

export interface TerminalSocketData {
  kind: "terminal"
  cwd: string
  id: string
  cols: number
  rows: number
  // Set when the bridge will not open a shell; the socket only carries the reason to the panel.
  refused?: string
}

interface TerminalSession {
  id: string
  cwd: string
  shell: string
  proc: Subprocess
  terminal: Bun.Terminal
  decoder: TextDecoder
  buffer: string
  // Private modes (alternate screen, mouse, bracketed paste, …) as last set, and as set where the buffer starts.
  modes: Map<string, boolean>
  headModes: Map<string, boolean>
  cols: number
  rows: number
  socket?: ServerWebSocket<TerminalSocketData>
  reap?: ReturnType<typeof setTimeout>
}

// Replay keeps the latest output only; the panel's own scrollback holds the rest while it stays open.
const BUFFER_LIMIT = 16_000
// A page reload drops the socket; the shell waits this long for the same tab to attach again.
const DETACH_GRACE_MS = 60_000
export const TERMINAL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// Per-session variables only: provider and feature toggles (CLAUDE_CODE_USE_*, …) are the user's own settings.
const INHERITED_SESSION = /^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_CODE_(SESSION_ID|CHILD_SESSION|ENTRYPOINT|BRIDGE_SESSION_ID|MESSAGING_\w+|SESSION_ATTENDED|EXECPATH|MODEL_CAPABILITIES|MCP_INSTR_DELTA))$/

const sessions = new Map<string, TerminalSession>()

export function terminalSize(raw: string | null, fallback: number): number {
  const value = Number(raw)
  return Number.isInteger(value) && value >= 2 && value <= 1000 ? value : fallback
}

function terminalEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    // The bridge token would let anything run in the shell drive the bridge.
    if (value === undefined || key.startsWith("NOA_GUI_") || key === "ELECTRON_RUN_AS_NODE" || key === "TERMINFO" || key === "TERMINFO_DIRS") continue
    // An app launched from an agent session inherits that session's identity (and its messaging token);
    // an agent started in this shell would take itself for that session's child.
    if (INHERITED_SESSION.test(key)) continue
    env[key] = value
  }
  return { ...env, TERM: "xterm-256color", COLORTERM: "truecolor", TERM_PROGRAM: "noa" }
}

function send(session: TerminalSession, message: unknown) {
  session.socket?.send(JSON.stringify(message))
}

const TRACKED_MODES = new Set(["1", "25", "47", "1000", "1002", "1003", "1004", "1006", "1047", "1049", "2004"])
const PRIVATE_MODE = /\x1b\[\?([0-9;]+)([hl])/g

function trackModes(modes: Map<string, boolean>, text: string) {
  for (const [, list, action] of text.matchAll(PRIVATE_MODE)) {
    for (const mode of list!.split(";")) if (TRACKED_MODES.has(mode)) modes.set(mode, action === "h")
  }
}

// Replayed output must not carry terminal queries: the panel would answer them again as typed input.
// A trimmed buffer starts at a line or escape boundary, after the modes its dropped head had set.
function replay(session: TerminalSession): string {
  const { buffer } = session
  if (buffer.length < BUFFER_LIMIT) return withoutQueries(buffer)
  const boundary = buffer.search(/[\n\x1b]/)
  const start = boundary < 0 ? buffer.length : buffer[boundary] === "\n" ? boundary + 1 : boundary
  const head = new Map(session.headModes)
  trackModes(head, buffer.slice(0, start))
  const modes = [...head].sort(([a], [b]) => Number(b === "1049") - Number(a === "1049"))
  return modes.map(([mode, on]) => `\x1b[?${mode}${on ? "h" : "l"}`).join("") + withoutQueries(buffer.slice(start))
}

function withoutQueries(text: string): string {
  return text.replace(/\x1b\[[?>=]?[0-9;]*[nc]/g, "")
}

// A full-screen program redraws on SIGWINCH; a resize away and back sends it one.
function redraw(session: TerminalSession) {
  if (!session.modes.get("1049") && !session.modes.get("1047") && !session.modes.get("47")) return
  session.terminal.resize(session.cols, Math.max(2, session.rows - 1))
  setTimeout(() => { if (sessions.get(session.id) === session) session.terminal.resize(session.cols, session.rows) }, 50)
}

function resize(session: TerminalSession, cols: number, rows: number) {
  session.cols = cols
  session.rows = rows
  session.terminal.resize(cols, rows)
}

function descendants(pid: number): number[] {
  const out = Bun.spawnSync(["ps", "-A", "-o", "pid=,ppid="]).stdout.toString()
  const children = new Map<number, number[]>()
  for (const line of out.split("\n")) {
    const [child, parent] = line.trim().split(/\s+/).map(Number)
    if (!child || !parent) continue
    children.set(parent, [...(children.get(parent) ?? []), child])
  }
  const found: number[] = []
  const queue = [pid]
  while (queue.length) for (const child of children.get(queue.shift()!) ?? []) { found.push(child); queue.push(child) }
  return found
}

// Background jobs started from the shell go with it, deepest first.
function destroy(session: TerminalSession) {
  if (sessions.get(session.id) !== session) return
  sessions.delete(session.id)
  clearTimeout(session.reap)
  for (const pid of [session.proc.pid, ...descendants(session.proc.pid)].reverse()) {
    try { process.kill(pid, "SIGKILL") } catch { /* Already gone. */ }
  }
  try { session.terminal.close() } catch { /* Already closed. */ }
}

function spawn(data: TerminalSocketData): TerminalSession {
  const shell = process.env.SHELL || "/bin/zsh"
  let session: TerminalSession | undefined
  const proc = Bun.spawn([shell, "-l"], {
    cwd: data.cwd,
    env: terminalEnv(),
    terminal: {
      cols: data.cols,
      rows: data.rows,
      name: "xterm-256color",
      data(_terminal, bytes) {
        if (!session) return
        const text = session.decoder.decode(bytes, { stream: true })
        if (!text) return
        const next = session.buffer + text
        if (next.length > BUFFER_LIMIT) trackModes(session.headModes, next.slice(0, next.length - BUFFER_LIMIT))
        session.buffer = next.slice(-BUFFER_LIMIT)
        trackModes(session.modes, text)
        send(session, { type: "data", data: text })
      },
    },
  })
  session = { id: data.id, cwd: data.cwd, shell: basename(shell), proc, terminal: proc.terminal!, decoder: new TextDecoder(), buffer: "", modes: new Map(), headModes: new Map(), cols: data.cols, rows: data.rows }
  const created = session
  void proc.exited.then((code) => {
    if (sessions.get(created.id) !== created) return
    send(created, { type: "exit", code })
    sessions.delete(created.id)
    clearTimeout(created.reap)
    try { created.terminal.close() } catch { /* Already closed. */ }
  })
  return session
}

export function attachTerminal(ws: ServerWebSocket<TerminalSocketData>) {
  const { id, cwd, cols, rows, refused } = ws.data
  if (refused) {
    ws.send(JSON.stringify({ type: "error", message: refused }))
    ws.close(4003, "refused")
    return
  }
  let session = sessions.get(id)
  const reattached = !!session
  if (session && session.cwd !== cwd) {
    ws.send(JSON.stringify({ type: "error", message: "This terminal belongs to another folder." }))
    ws.close(4000, "cwd mismatch")
    return
  }
  if (!session) {
    try {
      session = spawn(ws.data)
    } catch (error) {
      ws.send(JSON.stringify({ type: "error", message: `Could not start the shell: ${(error as Error).message}` }))
      ws.close(4001, "spawn failed")
      return
    }
    sessions.set(id, session)
  } else {
    clearTimeout(session.reap)
    session.reap = undefined
    if (session.socket && session.socket !== ws) session.socket.close(4002, "attached elsewhere")
    resize(session, cols, rows)
  }
  session.socket = ws
  send(session, { type: "attached", shell: session.shell, cwd: session.cwd, buffer: replay(session) })
  if (reattached) redraw(session)
}

export function terminalMessage(ws: ServerWebSocket<TerminalSocketData>, raw: string | Buffer) {
  const session = sessions.get(ws.data.id)
  if (!session || session.socket !== ws || typeof raw !== "string") return
  let message: { type?: unknown; data?: unknown; cols?: unknown; rows?: unknown }
  try { message = JSON.parse(raw) } catch { return }
  if (message.type === "input" && typeof message.data === "string") session.terminal.write(message.data)
  else if (message.type === "resize") {
    const cols = terminalSize(String(message.cols), 0), rows = terminalSize(String(message.rows), 0)
    if (cols && rows) resize(session, cols, rows)
  } else if (message.type === "close") destroy(session)
}

export function detachTerminal(ws: ServerWebSocket<TerminalSocketData>) {
  const session = sessions.get(ws.data.id)
  if (!session || session.socket !== ws) return
  session.socket = undefined
  session.reap = setTimeout(() => destroy(session), DETACH_GRACE_MS)
}

// Exit handlers run synchronously, which the process-tree kill is.
process.on("exit", () => {
  for (const session of [...sessions.values()]) destroy(session)
})
