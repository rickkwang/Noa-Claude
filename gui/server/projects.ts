// Project folders shown in the sidebar, kept in <config>/gui-projects.json.
// The first run seeds the list from the working directories recorded in existing transcripts.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, isAbsolute, join, resolve } from "node:path"

export interface ProjectInfo {
  path: string
  name: string
  missing: boolean
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

function readStore(defaultCwd: string): string[] {
  if (existsSync(storePath())) {
    try {
      const paths = JSON.parse(readFileSync(storePath(), "utf8")).projects
      if (Array.isArray(paths)) return paths.filter((p): p is string => typeof p === "string")
    } catch {
      // Unreadable store: fall through and reseed rather than hide every project.
    }
  }
  const seeded = [...new Set([defaultCwd, ...transcriptCwds()])].filter(isDirectory)
  writeStore(seeded)
  return seeded
}

function writeStore(projects: string[]) {
  mkdirSync(configHome(), { recursive: true })
  writeFileSync(storePath(), JSON.stringify({ projects }, null, 2))
}

export function listProjects(defaultCwd: string): ProjectInfo[] {
  return readStore(defaultCwd).map((path) => ({ path, name: basename(path), missing: !isDirectory(path) }))
}

// Returns an error message, or null when the project was added (or was already listed).
export function addProject(defaultCwd: string, raw: string): string | null {
  if (!isAbsolute(raw)) return "Enter an absolute path."
  const path = resolve(raw)
  if (!isDirectory(path)) return "That folder does not exist."
  const paths = readStore(defaultCwd)
  if (!paths.includes(path)) writeStore([...paths, path])
  return null
}

export function removeProject(defaultCwd: string, path: string) {
  writeStore(readStore(defaultCwd).filter((p) => p !== path))
}
