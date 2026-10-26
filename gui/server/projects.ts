// Project folders shown in the sidebar, kept in <config>/gui-projects.json.
// The first run seeds the list from the working directories recorded in existing transcripts.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, isAbsolute, join, resolve, sep } from "node:path"

export interface ProjectInfo {
  path: string
  name: string
  sources: string[]
  missing: boolean
}

interface ProjectRecord {
  path: string
  name?: string
  sources?: string[]
}

function configHome(): string {
  return process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".noa")
}

function storePath(): string {
  return join(configHome(), "gui-projects.json")
}

function isDirectory(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false
}

const TEMP_DIR = /^\/(private\/)?(tmp|var\/folders)(\/|$)|\/scratchpad(\/|$)/

// Each transcript directory holds the cwd of its sessions in its user entries.
function transcriptCwds(): string[] {
  const root = join(configHome(), "projects")
  if (!existsSync(root)) return []
  const found = new Set<string>()
  for (const dir of readdirSync(root)) {
    const sub = join(root, dir)
    for (const file of readdirSync(sub).filter((f) => f.endsWith(".jsonl"))) {
      for (const line of readFileSync(join(sub, file), "utf8").split("\n")) {
        if (!line.includes('"cwd"')) continue
        try {
          const cwd = JSON.parse(line).cwd
          // Scratch directories (tests, /tmp runs) are not projects worth seeding.
          if (typeof cwd === "string" && !TEMP_DIR.test(cwd)) {
            found.add(cwd)
            break
          }
        } catch {
          // Partial line from a live transcript; try the next one.
        }
      }
    }
  }
  return [...found]
}

function readRecord(value: unknown): ProjectRecord | null {
  if (typeof value === "string") return { path: value }
  if (typeof value !== "object" || value === null || !("path" in value) || typeof value.path !== "string") return null
  if (!isAbsolute(value.path)) return null
  const sources = "sources" in value && Array.isArray(value.sources)
    ? value.sources.filter((source): source is string => typeof source === "string" && isAbsolute(source)).map((source) => resolve(source))
    : undefined
  return {
    path: value.path,
    name: "name" in value && typeof value.name === "string" ? value.name.trim() || undefined : undefined,
    sources,
  }
}

function readStore(defaultCwd: string): ProjectRecord[] {
  if (existsSync(storePath())) {
    try {
      const projects = JSON.parse(readFileSync(storePath(), "utf8")).projects
      if (Array.isArray(projects)) return projects.flatMap((project) => {
        const record = readRecord(project)
        return record ? [record] : []
      })
    } catch {
      // Unreadable store: fall through and reseed rather than hide every project.
    }
  }
  const seeded = [...new Set([defaultCwd, ...transcriptCwds()])].filter(isDirectory).map((path) => ({ path }))
  writeStore(seeded)
  return seeded
}

function writeStore(projects: ProjectRecord[]) {
  mkdirSync(configHome(), { recursive: true })
  writeFileSync(storePath(), JSON.stringify({ projects }, null, 2))
}

function sourcesFor(project: ProjectRecord): string[] {
  return [...new Set([project.path, ...(project.sources ?? [])])]
}

export function listProjects(defaultCwd: string): ProjectInfo[] {
  return readStore(defaultCwd).map((project) => ({
    path: project.path,
    name: project.name ?? basename(project.path),
    sources: sourcesFor(project),
    missing: !isDirectory(project.path),
  }))
}

// Returns an error message, or null when the project was added (or was already listed).
export function addProject(defaultCwd: string, raw: string, rawName?: string, rawSources?: string[]): string | null {
  if (!isAbsolute(raw)) return "Enter an absolute path."
  const path = resolve(raw)
  if (!isDirectory(path)) return "That folder does not exist."
  const sources = rawSources === undefined
    ? undefined
    : [...new Set([path, ...rawSources].map((source) => {
        if (!isAbsolute(source)) throw new Error("Use absolute paths for every source folder.")
        return resolve(source)
      }))]
  if (sources?.some((source) => !isDirectory(source))) return "Every source folder must exist."
  const name = rawName?.trim()
  if (name && name.length > 120) return "Use a project name up to 120 characters."
  const projects = readStore(defaultCwd)
  const existing = projects.find((project) => project.path === path)
  if (existing) {
    const updated = {
      ...existing,
      ...(rawName !== undefined ? { name: name || undefined } : {}),
      ...(sources ? { sources: sources.length > 1 ? sources : undefined } : {}),
    }
    if (updated.name !== existing.name || updated.sources?.join("\0") !== existing.sources?.join("\0"))
      writeStore(projects.map((project) => project.path === path ? updated : project))
  } else writeStore([...projects, { path, name: name || undefined, sources: sources && sources.length > 1 ? sources : undefined }])
  return null
}

export function removeProject(defaultCwd: string, path: string) {
  writeStore(readStore(defaultCwd).filter((project) => project.path !== path))
}

// Extra roots become CLI --add-dir arguments; only directories that actually
// contain the active workspace are considered.
export function projectAdditionalDirectories(defaultCwd: string, cwd: string): string[] {
  const contains = (source: string) => cwd === source || cwd.startsWith(source + sep)
  const matches = readStore(defaultCwd)
    .filter((candidate) => sourcesFor(candidate).some(contains))
  const matchedSourceLength = (project: ProjectRecord) =>
    Math.max(...sourcesFor(project).filter(contains).map((source) => source.length))
  const project = matches.sort((a, b) =>
    matchedSourceLength(b) - matchedSourceLength(a)
  )[0]
  if (!project) return []
  return sourcesFor(project).filter((source) => cwd !== source && !cwd.startsWith(source + sep))
}
