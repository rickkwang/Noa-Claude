// Local HTTP and WebSocket bridge for the Noa CLI.
import { existsSync, statSync } from "node:fs"
import { resolve, sep } from "node:path"
import { SESSION_ID, listSessions, loadHistory, renameSession } from "./sessions"
import { addProject, listProjects, removeProject } from "./projects"
import { mediaResponse, workspaceRequest } from "./workspace"
import { attachAgent, agentMessage, detachAgent, listAgentRuns, type SocketData } from "./agents"

const REPO_ROOT = resolve(import.meta.dir, "../..")
const DIST_DIR = resolve(import.meta.dir, "../dist")
const PORT = Number(process.env.NOA_GUI_PORT ?? 8787)

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
    // Reject DNS-rebinding requests: the Host must be a loopback name.
    if (!["localhost", "127.0.0.1"].includes(url.hostname)) return json({ error: "Host not allowed" }, 403)
    const origin = req.headers.get("origin")
    if (origin && origin !== url.origin && !["http://localhost:5173", "http://127.0.0.1:5173"].includes(origin))
      return json({ error: "Origin not allowed" }, 403)
    const cwd = resolveCwd(url.searchParams.get("cwd"))

    if (url.pathname === "/api/media") {
      if (req.method !== "GET" && req.method !== "HEAD") return json({ error: "Method not allowed" }, 405)
      if (!cwd) return json({ error: "cwd is not a directory" }, 400)
      try { return await mediaResponse(cwd, url.searchParams.get("path") ?? "", req) }
      catch (error) { return json({ error: (error as Error).message }, 400) }
    }

    if (["/api/files", "/api/file", "/api/changes", "/api/diff", "/api/git-action", "/api/editors", "/api/open-in", "/api/grep", "/api/branches"].includes(url.pathname)) {
      if (req.method !== "GET" && !(req.method === "POST" && ["/api/file", "/api/git-action", "/api/open-in", "/api/branches"].includes(url.pathname))) return json({ error: "Method not allowed" }, 405)
      if (["/api/git-action", "/api/open-in"].includes(url.pathname) && req.method !== "POST") return json({ error: "Method not allowed" }, 405)
      if (!cwd) return json({ error: "cwd is not a directory" }, 400)
      // Writes are limited to listed projects (or folders inside them).
      if (req.method === "POST" && !listProjects(REPO_ROOT).some((project) =>
        project.sources.some((source) => cwd === source || cwd.startsWith(source + sep))
      ))
        return json({ error: "Writes are only allowed inside listed projects" }, 403)
      try {
        return json(await workspaceRequest(url, cwd, req.method === "POST" ? await req.json() : undefined, req.signal))
      } catch (error) {
        return json({ error: (error as Error).message }, 400)
      }
    }

    if (url.pathname === "/api/projects") {
      const defaultCwd = resolveCwd(null)!
      if (req.method === "GET") return json(listProjects(defaultCwd))
      if (req.method === "POST") {
        const body = (await req.json().catch(() => null)) as { path?: unknown; name?: unknown; sources?: unknown } | null
        let error: string | null = "Missing path."
        if (typeof body?.path === "string") {
          try {
            const sources = Array.isArray(body.sources)
              ? body.sources.filter((source): source is string => typeof source === "string")
              : undefined
            error = addProject(defaultCwd, body.path, typeof body.name === "string" ? body.name : undefined, sources)
          } catch (caught) {
            error = (caught as Error).message
          }
        }
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
      const runtimeId = url.searchParams.get("runtime") ?? crypto.randomUUID()
      if (!SESSION_ID.test(runtimeId)) return new Response("invalid runtime id", { status: 400 })
      if (server.upgrade(req, { data: { cwd, resume, runtimeId } })) return undefined
      return new Response("Expected WebSocket upgrade", { status: 426 })
    }

    if (url.pathname === "/api/runs") return json(listAgentRuns())

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
      const items = await loadHistory(cwd, decodeURIComponent(historyMatch[1]!))
      return items ? json(items) : json({ error: "session not found" }, 404)
    }

    return serveStatic(url.pathname)
  },
  websocket: {
    maxPayloadLength: 32 * 1024 * 1024,
    open(ws) { attachAgent(ws, REPO_ROOT) },
    message: agentMessage,
    close: detachAgent,
  },
})

console.log(`Noa GUI bridge listening on http://localhost:${PORT}`)
// Load the transcript recovery code while the user is choosing a session.
const transcriptModule = "../../src/utils/sessionStorage.ts"
void import(transcriptModule).catch(() => {})
