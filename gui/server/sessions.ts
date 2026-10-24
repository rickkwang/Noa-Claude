// Reads the agent's transcripts (<config>/projects/<sanitized cwd>/<id>.jsonl)
// so the GUI can list past sessions and rebuild their history.
import { appendFileSync, existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { ContentBlock, ImageBlock } from "../src/agent/protocol"
import { sanitizePath } from "../../src/utils/sessionStoragePortable"

export const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_SESSIONS = 50
// Injected wrappers such as <local-command-caveat> are not user-authored text.
const SYSTEM_WRAPPER = /^<(local-command-|command-)/

export interface SessionSummary {
  id: string
  title: string
  updatedAt: number
}

function canonicalCwd(cwd: string): string {
  return (existsSync(cwd) ? realpathSync(cwd) : cwd).normalize("NFC")
}

function projectDir(cwd: string): string {
  const configHome = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".noa")
  return join(configHome, "projects", sanitizePath(canonicalCwd(cwd)))
}

interface Entry {
  type: string
  subtype?: string
  content?: string
  uuid?: string
  parentUuid?: string | null
  timestamp?: string
  cwd?: string
  isMeta?: boolean
  isCompactSummary?: boolean
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
  if (entry.type !== "user" || entry.isMeta || entry.isCompactSummary || entry.isSidechain) return null
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
  if (!text.trim()) return Array.isArray(content) && content.some((b: any) => b?.type === "image") ? "[Image]" : null
  const command = text.trimStart().match(/^<command-name>(\/[^<]+)<\/command-name>/)?.[1]
  if (command) {
    const args = text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim()
    return `${command}${args ? ` ${args}` : ""}`
  }
  if (SYSTEM_WRAPPER.test(text.trimStart())) return null
  return text
}

export function listSessions(cwd: string): SessionSummary[] {
  const dir = projectDir(cwd)
  if (!existsSync(dir)) return []

  const files = readdirSync(dir).flatMap((file) => {
    const id = file.endsWith(".jsonl") ? file.slice(0, -".jsonl".length) : ""
    if (!SESSION_ID.test(id)) return []
    const path = join(dir, file)
    return [{ id, path, updatedAt: statSync(path).mtimeMs }]
  }).sort((a, b) => b.updatedAt - a.updatedAt)

  const sessions: SessionSummary[] = []
  for (const file of files) {
    const entries = readEntries(file.path)
    const owner = entries.find((entry) => typeof entry.cwd === "string")?.cwd
    if (owner && canonicalCwd(owner) !== canonicalCwd(cwd)) continue
    const first = entries.map(userText).find((t): t is string => t !== null)
    if (!first) continue
    sessions.push({
      id: file.id,
      title:
        [...entries]
          .reverse()
          .find((entry) => entry.type === "custom-title")
          ?.customTitle?.trim() || first.replace(/\s+/g, " ").trim().slice(0, 80),
      updatedAt: file.updatedAt,
    })
    if (sessions.length === MAX_SESSIONS) break
  }
  return sessions
}

export function renameSession(cwd: string, id: string, title: string): void {
  if (!SESSION_ID.test(id)) throw new Error("Invalid task id")
  const name = title.trim()
  if (!name || name.length > 120) throw new Error("Use a task name between 1 and 120 characters")
  const file = join(projectDir(cwd), `${id}.jsonl`)
  if (!existsSync(file)) throw new Error("Task not found")
  const entries = readEntries(file)
  const owner = entries.find((entry) => typeof entry.cwd === "string")?.cwd
  if (owner && canonicalCwd(owner) !== canonicalCwd(cwd)) throw new Error("Task not found")
  appendFileSync(file, `${JSON.stringify({ type: "custom-title", customTitle: name, sessionId: id })}\n`)
}

async function conversationChain(file: string, entries: Entry[]): Promise<Entry[]> {
  if (!entries.some((entry) => entry.uuid)) return entries
  // Load the CLI's recovery rules, including compact/snip and orphaned tool results.
  const modulePath = "../../src/utils/sessionStorage.ts"
  const { loadTranscriptFile, buildConversationChain } = await import(modulePath)
  const { messages, leafUuids } = await loadTranscriptFile(file) as { messages: Map<string, Entry>; leafUuids: Set<string> }
  let leaf: Entry | undefined
  for (const entry of messages.values()) {
    if (entry.isSidechain || (entry.type !== "user" && entry.type !== "assistant")) continue
    if (leafUuids.size && !leafUuids.has(entry.uuid!)) continue
    if (!leaf || (entry.timestamp ?? "") >= (leaf.timestamp ?? "")) leaf = entry
  }
  return leaf ? buildConversationChain(messages, leaf) : []
}

// History items use the same shapes as live stream-json messages, so the
// client feeds them through the same reducer.
export type HistoryItem =
  | { kind: "user"; text: string; images?: ImageBlock[] }
  | {
      kind: "agent"
      messageId?: string
      message: { type: "assistant" | "user"; message: { content: ContentBlock[] }; parent_tool_use_id: null }
    }

export async function loadHistory(cwd: string, id: string): Promise<HistoryItem[] | null> {
  if (!SESSION_ID.test(id)) return null
  const file = join(projectDir(cwd), `${id}.jsonl`)
  if (!existsSync(file)) return null

  const entries = readEntries(file)
  const owner = entries.find((entry) => typeof entry.cwd === "string")?.cwd
  if (owner && canonicalCwd(owner) !== canonicalCwd(cwd)) return null

  const items: HistoryItem[] = []
  for (const entry of await conversationChain(file, entries)) {
    if (entry.isSidechain) continue

    if (entry.type === "system" && entry.subtype === "local_command" && entry.content) {
      const output = entry.content.match(/^<local-command-(?:stdout|stderr)>([\s\S]*?)<\/local-command-(?:stdout|stderr)>$/)?.[1]
      if (output) items.push({ kind: "agent", message: { type: "assistant", message: { content: [{ type: "text", text: output }] }, parent_tool_use_id: null } })
      else if (entry.content.startsWith("/")) items.push({ kind: "user", text: entry.content })
      continue
    }

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
    const images = Array.isArray(entry.message?.content) ? entry.message.content.filter((b: any) => b?.type === "image") : []
    if (text !== null || (entry.type === "user" && !entry.isMeta && !entry.isCompactSummary && images.length)) {
      items.push({ kind: "user", text: text ?? "", images: Array.isArray(entry.message?.content) ? entry.message.content.filter((b: any) => b?.type === "image") : undefined })
      continue
    }

    const content = entry.message?.content
    if (entry.type === "user" && Array.isArray(content) && content.some((b: any) => b?.type === "tool_result")) {
      items.push({ kind: "agent", message: { type: "user", message: { content: content as ContentBlock[] }, parent_tool_use_id: null } })
    }
  }
  return items
}
