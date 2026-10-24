// Local bridge between the browser UI and the agent's stream-json mode.
// One agent process per WebSocket connection. Client messages are written
// verbatim as NDJSON to the agent's stdin; stdout lines come back wrapped in
// an envelope so the client can tell agent messages from log lines.
import { existsSync, statSync } from "node:fs"
import { join, resolve, sep } from "node:path"
import type { ServerWebSocket, Subprocess } from "bun"
import { SESSION_ID, listSessions, loadHistory, renameSession } from "./sessions"
import { addProject, listProjects, removeProject } from "./projects"
import { workspaceRequest } from "./workspace"

const REPO_ROOT = resolve(import.meta.dir, "../..")
const DIST_DIR = resolve(import.meta.dir, "../dist")
const PORT = Number(process.env.NOA_GUI_PORT ?? 8787)

type Envelope =
  | { kind: "agent"; message: unknown }
  | { kind: "log"; text: string }
  | { kind: "exit"; code: number | null }

interface SocketData {
  proc?: Subprocess<"pipe", "pipe", "pipe">
  cwd: string
  resume?: string
}

function send(ws: ServerWebSocket<SocketData>, envelope: Envelope) {
  ws.send(JSON.stringify(envelope))
}

async function forwardLines(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let newline = buffer.indexOf("\n")
    while (newline !== -1) {
      onLine(buffer.slice(0, newline))
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf("\n")
    }
  }
  if (buffer.length > 0) onLine(buffer)
}

function spawnAgent(ws: ServerWebSocket<SocketData>) {
  const args = [
    process.execPath,
    join(REPO_ROOT, "run-noa.js"),
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    // Without this, "ask" decisions are denied in headless mode instead of
    // being sent to the client as can_use_tool control requests.
    "--permission-prompt-tool",
    "stdio",
  ]
  if (ws.data.resume) args.push("--resume", ws.data.resume)

  const proc = Bun.spawn(args, { cwd: ws.data.cwd, stdin: "pipe", stdout: "pipe", stderr: "pipe" })
  ws.data.proc = proc

  forwardLines(proc.stdout, (line) => {
    if (line.trim() === "") return
    try {
      send(ws, { kind: "agent", message: JSON.parse(line) })
    } catch {
      send(ws, { kind: "log", text: line })
    }
  })
  forwardLines(proc.stderr, (line) => send(ws, { kind: "log", text: line }))
  proc.exited.then((code) => send(ws, { kind: "exit", code }))
}

function resolveCwd(raw: string | null): string | null {
  if (!raw) return REPO_ROOT
  const dir = resolve(raw)
  return statSync(dir, { throwIfNoEntry: false })?.isDirectory() ? dir : null
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

function serveStatic(pathname: string): Response {
  if (!existsSync(DIST_DIR)) {
    return new Response("GUI not built. Run `bun run dev` in gui/ or `bun run build`.", { status: 404 })
  }
  const path = resolve(DIST_DIR, pathname === "/" ? "index.html" : `.${pathname}`)
  // Reject paths that escape the dist directory.
  if (!path.startsWith(DIST_DIR + sep) || !statSync(path, { throwIfNoEntry: false })?.isFile())
    return new Response("Not found", { status: 404 })
  return new Response(Bun.file(path))
}

Bun.serve<SocketData>({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(req, server) {
    const url = new URL(req.url)
    const origin = req.headers.get("origin")
    if (origin && origin !== url.origin && origin !== "http://localhost:5173")
      return json({ error: "Origin not allowed" }, 403)
    const cwd = resolveCwd(url.searchParams.get("cwd"))

    if (["/api/files", "/api/file", "/api/changes", "/api/diff"].includes(url.pathname)) {
      if (req.method !== "GET") return json({ error: "Method not allowed" }, 405)
      if (!cwd) return json({ error: "cwd is not a directory" }, 400)
      try {
        return json(await workspaceRequest(url, cwd))
      } catch (error) {
        return json({ error: (error as Error).message }, 400)
      }
    }

    if (url.pathname === "/api/projects") {
      const defaultCwd = resolveCwd(null)!
      if (req.method === "GET") return json(listProjects(defaultCwd))
      if (req.method === "POST") {
        const body = (await req.json().catch(() => null)) as { path?: unknown } | null
        const error = typeof body?.path === "string" ? addProject(defaultCwd, body.path) : "Missing path."
        return error ? json({ error }, 400) : json(listProjects(defaultCwd))
      }
      if (req.method === "DELETE") {
        const path = url.searchParams.get("path")
        if (!path) return json({ error: "Missing path." }, 400)
        removeProject(defaultCwd, path)
        return json(listProjects(defaultCwd))
      }
      return json({ error: "Method not allowed" }, 405)
    }

    if (url.pathname === "/api/projects/reveal") {
      if (req.method !== "POST") return json({ error: "Method not allowed" }, 405)
      const body = (await req.json().catch(() => null)) as { path?: unknown } | null
      const path = typeof body?.path === "string" ? body.path : null
      // Only listed projects may be opened, so this cannot launch arbitrary paths.
      if (!path || !listProjects(resolveCwd(null)!).some((p) => p.path === path))
        return json({ error: "Unknown project." }, 400)
      Bun.spawn(["open", path])
      return json({ ok: true })
    }

    if (url.pathname === "/ws") {
      if (!cwd) return new Response("cwd is not a directory", { status: 400 })
      const resume = url.searchParams.get("resume") ?? undefined
      if (resume && !SESSION_ID.test(resume)) return new Response("invalid session id", { status: 400 })
      if (server.upgrade(req, { data: { cwd, resume } })) return undefined
      return new Response("Expected WebSocket upgrade", { status: 426 })
    }

    if (url.pathname === "/api/info") {
      if (!cwd) return json({ error: "cwd is not a directory" }, 400)
      return json({ cwd })
    }

    if (url.pathname === "/api/sessions") {
      if (!cwd) return json({ error: "cwd is not a directory" }, 400)
      return json(listSessions(cwd))
    }

    const historyMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/)
    if (historyMatch) {
      if (!cwd) return json({ error: "cwd is not a directory" }, 400)
      if (req.method === "PATCH") {
        try {
          const body = (await req.json()) as { title?: unknown }
          if (typeof body.title !== "string") return json({ error: "Missing task name" }, 400)
          renameSession(cwd, decodeURIComponent(historyMatch[1]!), body.title)
          return json(listSessions(cwd))
        } catch (error) {
          return json({ error: (error as Error).message }, 400)
        }
      }
      if (req.method !== "GET") return json({ error: "Method not allowed" }, 405)
      const items = loadHistory(cwd, decodeURIComponent(historyMatch[1]!))
      return items ? json(items) : json({ error: "session not found" }, 404)
    }

    return serveStatic(url.pathname)
  },
  websocket: {
    open(ws) {
      spawnAgent(ws)
    },
    message(ws, raw) {
      const proc = ws.data.proc
      if (!proc || typeof raw !== "string") return
      proc.stdin.write(raw.endsWith("\n") ? raw : `${raw}\n`)
      proc.stdin.flush()
    },
    close(ws) {
      ws.data.proc?.kill()
    },
  },
})

console.log(`Noa GUI bridge listening on http://localhost:${PORT}`)
