// HTTP endpoints served by the bridge (server/main.ts).

export interface SessionSummary {
  id: string
  title: string
  updatedAt: number
  status?: "running" | "waiting" | "queued"
}

export interface ProjectInfo {
  path: string
  name: string
  sources: string[]
  missing: boolean
}

export async function fetchSessions(cwd: string | undefined): Promise<SessionSummary[]> {
  const response = await fetch(`/api/sessions${query(cwd)}`)
  return response.ok ? ((await response.json()) as SessionSummary[]) : []
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

export function query(cwd: string | undefined): string {
  return cwd ? `?cwd=${encodeURIComponent(cwd)}` : ""
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
