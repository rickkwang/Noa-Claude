// HTTP endpoints served by the bridge (server/main.ts).

export interface SessionSummary {
  id: string
  title: string
  updatedAt: number
  createdAt: number
  status?: "running" | "waiting" | "queued"
  // One line on where the task stands, and the pull request the task opened.
  summary?: string
  progress?: string
  error?: string
  pr?: { number: number; url: string; repository: string; state?: "open" | "draft" | "merged" | "closed" }
  // Set when the session runs in one of the project's worktrees instead of the project folder.
  cwd?: string
  // The project's coordinator chat, which runs the other sessions as threads.
  coordinator?: boolean
}

export interface ProjectInfo {
  path: string
  name: string
  sources: string[]
  missing: boolean
}

export async function fetchSessions(cwd: string | undefined): Promise<SessionSummary[]> {
  const response = await fetch(`/api/sessions${query(cwd)}`)
  if (!response.ok) throw new Error(`Could not list tasks (HTTP ${response.status})`)
  return (await response.json()) as SessionSummary[]
}

export async function fetchProjects(): Promise<ProjectInfo[]> {
  const response = await fetch("/api/projects")
  return response.ok ? ((await response.json()) as ProjectInfo[]) : []
}

// Resolves to the updated project list, or throws with the bridge's message.
export async function addProject(paths: string[], name?: string): Promise<ProjectInfo[]> {
  const response = await fetch("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: paths[0], sources: paths, name }),
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
  return body as ProjectInfo[]
}

export async function removeProject(path: string): Promise<ProjectInfo[]> {
  const response = await fetch(`/api/projects?path=${encodeURIComponent(path)}`, { method: "DELETE" })
  return (await response.json()) as ProjectInfo[]
}

export async function revealProject(path: string): Promise<void> {
  await fetch("/api/projects/reveal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path }),
  })
}

interface MarketplaceInfo {
  name: string
  source: string
  repo?: string
  url?: string
  path?: string
  installLocation?: string
}

interface MarketplacePlugin {
  pluginId: string
  name: string
  description?: string
  marketplaceName: string
  installCount?: number
  source?: string | { source?: string; url?: string; repo?: string; path?: string }
}

interface InstalledPlugin {
  id: string
  version: string
  scope: string
  enabled: boolean
  mcpServers?: Record<string, unknown>
  description?: string
  homepage?: string
}

export interface PluginCatalog {
  marketplaces: MarketplaceInfo[]
  installed: InstalledPlugin[]
  available: MarketplacePlugin[]
}

export async function fetchPlugins(): Promise<PluginCatalog> {
  const response = await fetch("/api/plugins")
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error ?? `Could not load plugins (HTTP ${response.status})`)
  }
  return (await response.json()) as PluginCatalog
}

export type PluginAction = "marketplace-add" | "marketplace-remove" | "marketplace-update" | "install" | "uninstall" | "enable" | "disable"

// Throws with the CLI's message when the command fails.
export async function runPluginAction(action: PluginAction, target?: string, sparse?: string, scope?: string): Promise<void> {
  const response = await fetch("/api/plugins", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, target, sparse, scope }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
}

export interface SkillsState {
  modes: Record<string, string>
  // Skills in the user's own skills folder: the only ones the bridge can read, reveal and remove. Listed
  // here too because a skill that is switched off is dropped from the CLI's command list.
  userSkills: { name: string; description: string }[]
}

export async function fetchSkillsState(): Promise<SkillsState> {
  const response = await fetch("/api/skills")
  if (!response.ok) throw new Error(`Could not load skills (HTTP ${response.status})`)
  return (await response.json()) as SkillsState
}

// Resolves with the response body, or throws with the bridge's message.
export async function runSkillAction(action: "mode" | "read" | "reveal" | "uninstall", name: string, mode?: "on" | "off"): Promise<{ content?: string }> {
  const response = await fetch("/api/skills", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, name, mode }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
  return body
}

export function query(cwd: string | undefined): string {
  return cwd ? `?cwd=${encodeURIComponent(cwd)}` : ""
}

// The project's coordinator chat, named on first use.
export async function openCoordinator(cwd: string): Promise<string> {
  const response = await fetch(`/api/coordinator${query(cwd)}`, { method: "POST" })
  const body = (await response.json()) as { sessionId?: string; error?: string }
  if (!response.ok || !body.sessionId) throw new Error(body.error ?? "Could not open the coordinator")
  return body.sessionId
}

export async function deleteSession(cwd: string, id: string): Promise<void> {
  const response = await fetch(`/api/sessions/${encodeURIComponent(id)}${query(cwd)}`, { method: "DELETE" })
  if (!response.ok) throw new Error(((await response.json()) as { error?: string }).error ?? "Could not delete task")
}

export async function renameSession(cwd: string, id: string, title: string): Promise<SessionSummary[]> {
  const response = await fetch(`/api/sessions/${encodeURIComponent(id)}${query(cwd)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error ?? "Could not rename task")
  return body as SessionSummary[]
}

export type StatsRange = "7d" | "30d" | "all"

export interface StatsSummary {
  range: StatsRange
  days: { date: string; messages: number }[]
  heatmapDays: { date: string; messages: number }[]
  allTimeMessages: string
  totalSessions: string
  totalTokens: string
  favoriteModel: string | null
  currentStreak: number
  longestStreak: number
  activeDays: number
  rangeDays: number
  longestSessionMs: number | null
  totalMessages: string
  peakActivityHour: number | null
  usage: ModelUsage
  models: { name: string; tokens: number; usage: ModelUsage }[]
  chartDays: { date: string; tokensByModel: Record<string, number> }[]
}

export interface ModelUsage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export async function fetchStats(range: StatsRange): Promise<StatsSummary> {
  const response = await fetch(`/api/stats?range=${range}`)
  if (!response.ok) throw new Error(`Could not load stats (HTTP ${response.status})`)
  return (await response.json()) as StatsSummary
}
