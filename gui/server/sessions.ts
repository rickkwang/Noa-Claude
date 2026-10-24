// Reads the agent's transcripts (<config>/projects/<sanitized cwd>/<id>.jsonl)
// so the GUI can list past sessions and rebuild their history.
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_SESSIONS = 50
// Injected wrappers such as <local-command-caveat> are not user-authored text.
const SYSTEM_WRAPPER = /^<(local-command-|command-)/

export interface SessionSummary {
  id: string
  title: string
  updatedAt: number
}

// Mirrors the agent's sessionStoragePortable.sanitizePath (without its long-path hash).
function projectDir(cwd: string): string {
  const configHome = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".noa")
  return join(configHome, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"))
}

interface Entry {
  type: string
  isMeta?: boolean
  isSidechain?: boolean
  message?: { id?: string; content?: unknown }
  customTitle?: string
}

function readEntries(file: string): Entry[] {
  const entries: Entry[] = []
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line) continue
    try {
      entries.push(JSON.parse(line))
    } catch {
      // A partially written line at the end of a live transcript; skip it.
    }
  }
  return entries
}

function userText(entry: Entry): string | null {
  if (entry.type !== "user" || entry.isMeta || entry.isSidechain) return null
  const content = entry.message?.content
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .filter((b) => b?.type === "text")
            .map((b) => b.text as string)
            .join("\n")
        : ""
  if (!text.trim() || SYSTEM_WRAPPER.test(text.trimStart())) return null
  return text
}

export function listSessions(cwd: string): SessionSummary[] {
  const dir = projectDir(cwd)
  if (!existsSync(dir)) return []

  const sessions: SessionSummary[] = []
  for (const file of readdirSync(dir)) {
    const id = file.endsWith(".jsonl") ? file.slice(0, -".jsonl".length) : ""
    if (!SESSION_ID.test(id)) continue
    const path = join(dir, file)
    const entries = readEntries(path)
    const first = entries.map(userText).find((t): t is string => t !== null)
    if (!first) continue
    sessions.push({
      id,
      title:
        [...entries]
          .reverse()
          .find((entry) => entry.type === "custom-title")
          ?.customTitle?.trim() || first.replace(/\s+/g, " ").trim().slice(0, 80),
      updatedAt: statSync(path).mtimeMs,
    })
  }
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_SESSIONS)
}

export function renameSession(cwd: string, id: string, title: string): void {
  if (!SESSION_ID.test(id)) throw new Error("Invalid task id")
  const name = title.trim()
  if (!name || name.length > 120) throw new Error("Use a task name between 1 and 120 characters")
  const file = join(projectDir(cwd), `${id}.jsonl`)
  if (!existsSync(file)) throw new Error("Task not found")
  appendFileSync(file, `${JSON.stringify({ type: "custom-title", customTitle: name, sessionId: id })}\n`)
}

// History items use the same shapes as live stream-json messages, so the
// client feeds them through the same reducer.
export type HistoryItem =
  | { kind: "user"; text: string }
  | {
      kind: "agent"
      messageId?: string
      message: { type: "assistant" | "user"; message: { content: unknown[] }; parent_tool_use_id: null }
    }

export function loadHistory(cwd: string, id: string): HistoryItem[] | null {
  if (!SESSION_ID.test(id)) return null
  const file = join(projectDir(cwd), `${id}.jsonl`)
  if (!existsSync(file)) return null

  const items: HistoryItem[] = []
  for (const entry of readEntries(file)) {
    if (entry.isSidechain) continue

    if (entry.type === "assistant") {
      const blocks = (Array.isArray(entry.message?.content) ? entry.message.content : []).filter(
        (b: any) => !(b?.type === "thinking" && !b.thinking),
      )
      const messageId = entry.message?.id
      const last = items[items.length - 1]
      // The transcript stores one entry per content block; merge them back into one message.
      if (last?.kind === "agent" && messageId && last.messageId === messageId) {
        const content = last.message.message.content
        for (const block of blocks) {
          if (!content.some((c) => JSON.stringify(c) === JSON.stringify(block))) content.push(block)
        }
      } else {
        items.push({
          kind: "agent",
          messageId,
          message: { type: "assistant", message: { content: [...blocks] }, parent_tool_use_id: null },
        })
      }
      continue
    }

    const text = userText(entry)
    if (text !== null) {
      items.push({ kind: "user", text })
      continue
    }

    const content = entry.message?.content
    if (entry.type === "user" && Array.isArray(content) && content.some((b: any) => b?.type === "tool_result")) {
      items.push({ kind: "agent", message: { type: "user", message: { content }, parent_tool_use_id: null } })
    }
  }
  return items
}
