// Local HTTP and WebSocket bridge for the Noa CLI.
import { existsSync, statSync } from "node:fs"
import { resolve, sep } from "node:path"
import { SESSION_ID, listSessions, loadHistory, renameSession } from "./sessions"
import { addProject, listProjects, removeProject } from "./projects"
import { isManagedWorktree, mediaResponse, projectWorktrees, workspaceRequest } from "./workspace"
import { attachAgent, agentMessage, detachAgent, listAgentRuns, SPAWN_PERMISSION_MODES, type SocketData } from "./agents"

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

const TOKEN = process.env.NOA_GUI_TOKEN
const TOKEN_COOKIE = "noa_token"

// The desktop shell hands the page a cookie and itself a bearer header; anything else on this machine is refused.
function authorized(req: Request): boolean {
  if (!TOKEN) return true
  const bearer = req.headers.get("authorization")
  if (bearer === `Bearer ${TOKEN}`) return true
  return (req.headers.get("cookie") ?? "").split(";").some((part) => part.trim() === `${TOKEN_COOKIE}=${TOKEN}`)
}

function inListedProject(cwd: string): boolean {
  return isManagedWorktree(cwd) || listProjects(REPO_ROOT).some((project) =>
    project.sources.some((source) => cwd === source || cwd.startsWith(source + sep))
  )
}

type Handler = (ctx: { req: Request; url: URL; cwd: string; server: Bun.Server<SocketData> }) => Response | undefined | Promise<Response | undefined>

// Routes that act on a folder. Every method a route accepts is listed here, and the folder must belong to a listed project.
const cwdRoutes: Record<string, { methods: string[]; handler: Handler }> = {}

function workspaceRoute(path: string, methods: string[]) {
  cwdRoutes[path] = {
    methods,
    async handler({ req, url, cwd }) {
      try {
        return json(await workspaceRequest(url, cwd, req.method === "POST" ? await req.json() : undefined, req.signal))
      } catch (error) {
        return json({ error: (error as Error).message }, 400)
      }
    },
  }
}
for (const path of ["/api/files", "/api/changes", "/api/diff", "/api/editors", "/api/grep"]) workspaceRoute(path, ["GET"])
for (const path of ["/api/file", "/api/branches", "/api/worktree"]) workspaceRoute(path, ["GET", "POST"])
for (const path of ["/api/git-action", "/api/open-in"]) workspaceRoute(path, ["POST"])

cwdRoutes["/api/media"] = {
  methods: ["GET", "HEAD"],
  async handler({ req, url, cwd }) {
    try { return await mediaResponse(cwd, url.searchParams.get("path") ?? "", req) }
    catch (error) { return json({ error: (error as Error).message }, 400) }
  },
}

cwdRoutes["/ws"] = {
  methods: ["GET"],
  handler({ req, url, cwd, server }) {
    const resume = url.searchParams.get("resume") ?? undefined
    if (resume && !SESSION_ID.test(resume)) return new Response("invalid session id", { status: 400 })
    const runtimeId = url.searchParams.get("runtime") ?? crypto.randomUUID()
    if (!SESSION_ID.test(runtimeId)) return new Response("invalid runtime id", { status: 400 })
    const modeParam = url.searchParams.get("mode") ?? undefined
    if (modeParam && !SPAWN_PERMISSION_MODES.has(modeParam)) return new Response("invalid permission mode", { status: 400 })
    if (server.upgrade(req, { data: { cwd, resume, runtimeId, mode: modeParam } })) return undefined
    return new Response("Expected WebSocket upgrade", { status: 426 })
  },
}

cwdRoutes["/api/sessions"] = {
  methods: ["GET"],
  async handler({ cwd }) {
    // Sessions started in the project's worktrees are listed with it, tagged with the folder they run in.
    const worktrees = await projectWorktrees(cwd)
    return json([...listSessions(cwd), ...worktrees.flatMap((path) => listSessions(path).map((session) => ({ ...session, cwd: path })))]
      .sort((a, b) => b.updatedAt - a.updatedAt))
  },
}

async function sessionRequest(req: Request, cwd: string, id: string): Promise<Response> {
  if (req.method === "PATCH") {
    try {
      const body = (await req.json()) as { title?: unknown }
      if (typeof body.title !== "string") return json({ error: "Missing task name" }, 400)
      renameSession(cwd, id, body.title)
      return json(listSessions(cwd))
    } catch (error) {
      return json({ error: (error as Error).message }, 400)
    }
  }
  const items = await loadHistory(cwd, id)
  return items ? json(items) : json({ error: "session not found" }, 404)
}

async function projectsRequest(req: Request, url: URL): Promise<Response> {
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
  const path = url.searchParams.get("path")
  if (!path) return json({ error: "Missing path." }, 400)
  removeProject(defaultCwd, path)
  return json(listProjects(defaultCwd))
}

async function revealProject(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { path?: unknown } | null
  const path = typeof body?.path === "string" ? body.path : null
  // Only listed projects may be opened, so this cannot launch arbitrary paths.
  if (!path || !listProjects(resolveCwd(null)!).some((p) => p.path === path))
    return json({ error: "Unknown project." }, 400)
  Bun.spawn(["open", path])
  return json({ ok: true })
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
    if (!authorized(req)) return json({ error: "Unauthorized" }, 401)

    const route = cwdRoutes[url.pathname]
    if (route) {
      if (!route.methods.includes(req.method)) return json({ error: "Method not allowed" }, 405)
      const cwd = resolveCwd(url.searchParams.get("cwd"))
      if (!cwd) return url.pathname === "/ws" ? new Response("cwd is not a directory", { status: 400 }) : json({ error: "cwd is not a directory" }, 400)
      if (!inListedProject(cwd)) return json({ error: "Only listed projects are accessible" }, 403)
      return route.handler({ req, url, cwd, server })
    }

    if (url.pathname === "/api/projects") {
      if (!["GET", "POST", "DELETE"].includes(req.method)) return json({ error: "Method not allowed" }, 405)
      return projectsRequest(req, url)
    }
    if (url.pathname === "/api/projects/reveal") {
      if (req.method !== "POST") return json({ error: "Method not allowed" }, 405)
      return revealProject(req)
    }
    if (url.pathname === "/api/runs") return json(listAgentRuns())
    if (url.pathname === "/api/info") {
      const cwd = resolveCwd(url.searchParams.get("cwd"))
      return cwd ? json({ cwd }) : json({ error: "cwd is not a directory" }, 400)
    }

    const historyMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/)
    if (historyMatch) {
      if (req.method !== "GET" && req.method !== "PATCH") return json({ error: "Method not allowed" }, 405)
      const cwd = resolveCwd(url.searchParams.get("cwd"))
      if (!cwd) return json({ error: "cwd is not a directory" }, 400)
      if (!inListedProject(cwd)) return json({ error: "Only listed projects are accessible" }, 403)
      return sessionRequest(req, cwd, decodeURIComponent(historyMatch[1]!))
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
