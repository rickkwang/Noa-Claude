// Reads the agent's transcripts (<config>/projects/<sanitized cwd>/<id>.jsonl)
// so the GUI can list past sessions and rebuild their history.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import type { ContentBlock, ImageBlock, TurnDiff } from "../src/agent/protocol"
import { sanitizePath } from "../../src/utils/sessionStoragePortable"

export const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_SESSIONS = 50
// Injected wrappers such as <local-command-caveat> are not user-authored text.
const SYSTEM_WRAPPER = /^<(local-command-|command-|system-reminder|task-notification)/
const INTERRUPT_MARKER = /^\[Request interrupted by user(?:\s+for tool use)?\]$/

export interface SessionSummary {
  id: string
  title: string
  updatedAt: number
}

function canonicalCwd(cwd: string): string {
  return (existsSync(cwd) ? realpathSync(cwd) : cwd).normalize("NFC")
}

export function projectDir(cwd: string): string {
  const configHome = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".noa")
  return join(configHome, "projects", sanitizePath(canonicalCwd(cwd)))
}

export function transcriptPath(cwd: string, id: string): string {
  return join(projectDir(cwd), `${id}.jsonl`)
}

export interface TurnDiffRecord {
  index: number
  userMessageId?: string
  diff: TurnDiff
  // Uncapped patch for Undo; `diff.patch` may be omitted for large diffs.
  patch?: string
}

function turnDiffPath(cwd: string, id: string): string {
  return join(projectDir(cwd), `${id}.turn-diffs.jsonl`)
}

export function appendTurnDiff(cwd: string, id: string, record: TurnDiffRecord): void {
  const file = turnDiffPath(cwd, id)
  mkdirSync(dirname(file), { recursive: true })
  appendFileSync(file, `${JSON.stringify(record)}\n`)
}

/** Latest record for a turn; a later line replaces an earlier one. */
export function findTurnDiff(cwd: string, id: string, index: number): TurnDiffRecord | undefined {
  const records = readTurnDiffs(cwd, id)
  for (let i = records.length - 1; i >= 0; i--) if (records[i]!.index === index) return records[i]
  return undefined
}

export function setTurnDiffReverted(cwd: string, id: string, index: number, reverted: boolean): TurnDiffRecord | undefined {
  const record = findTurnDiff(cwd, id, index)
  if (!record) return undefined
  const updated: TurnDiffRecord = { ...record, diff: { ...record.diff, reverted } }
  appendTurnDiff(cwd, id, updated)
  return updated
}

export function readTurnDiffs(cwd: string, id: string): TurnDiffRecord[] {
  const file = turnDiffPath(cwd, id)
  if (!existsSync(file)) return []
  const records: TurnDiffRecord[] = []
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line) continue
    try {
      const record = JSON.parse(line) as TurnDiffRecord
      if (typeof record.index === "number" && record.diff?.files) records.push(record)
    } catch {
      // A partially written line; skip it.
    }
  }
  return records
}

/** Find the user message that opened the turn, starting at the transcript offset. */
export function findTurnUserMessage(cwd: string, id: string, offset: number): string | undefined {
  const file = transcriptPath(cwd, id)
  if (!existsSync(file)) return undefined
  const raw = readFileSync(file, "utf8")
  const parse = (text: string) => {
    for (const line of text.split("\n")) {
      if (!line) continue
      try {
        const entry = JSON.parse(line) as Entry
        if (entry.type === "user" && entry.uuid && !entry.isSidechain && !entry.isMeta && !entry.isCompactSummary)
          return entry.uuid
      } catch {
        // Live transcript tail may be incomplete.
      }
    }
    return undefined
  }
  return parse(raw.slice(offset)) ?? parse(raw)
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
  durationMs?: number
  message?: { id?: string; content?: unknown }
  toolUseResult?: unknown
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
  if (INTERRUPT_MARKER.test(text.trim())) return null
  return text
}

/**
 * Number of user turns in a transcript. Turn diffs use it so a resumed session
 * keeps numbering turns the way the transcript does, instead of restarting
 * from the highest stored diff.
 */
export function countUserTurns(cwd: string, id: string): number {
  if (!SESSION_ID.test(id)) return 0
  const file = transcriptPath(cwd, id)
  if (!existsSync(file)) return 0
  let count = 0
  for (const entry of readEntries(file)) {
    if (entry.isSidechain) continue
    if (entry.type === "system" && entry.subtype === "local_command" && entry.content?.startsWith("/")) {
      count++
      continue
    }
    if (userText(entry) !== null) {
      count++
      continue
    }
    const content = entry.message?.content
    if (
      entry.type === "user" &&
      !entry.isMeta &&
      !entry.isCompactSummary &&
      Array.isArray(content) &&
      content.some((block: any) => block?.type === "image") &&
      !content.some((block: any) => block?.type === "tool_result")
    )
      count++
  }
  return count
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
  | { kind: "turn-duration"; durationMs: number; interrupted?: boolean }
  | { kind: "turn-diff"; diff: TurnDiff }
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
  const byUser = new Map<string, TurnDiff>()
  const byIndex = new Map<number, TurnDiff>()
  for (const record of readTurnDiffs(cwd, id)) {
    // Old records predate turnIndex; derive it so Undo works on their cards.
    const diff = { ...record.diff, turnIndex: record.diff.turnIndex ?? record.index }
    if (record.userMessageId) byUser.set(record.userMessageId, diff)
    byIndex.set(record.index, diff)
  }
  let turnNumber = 0
  let currentUserMessageId: string | undefined
  const flushTurnDiff = () => {
    if (currentUserMessageId === undefined && !byIndex.has(turnNumber)) return
    const diff = (currentUserMessageId ? byUser.get(currentUserMessageId) : undefined) ?? byIndex.get(turnNumber)
    if (diff) items.push({ kind: "turn-diff", diff })
    currentUserMessageId = undefined
  }
  let interrupted = false
  for (const entry of await conversationChain(file, entries)) {
    if (entry.isSidechain) continue

    if (entry.type === "system" && entry.subtype === "turn_duration" && typeof entry.durationMs === "number") {
      items.push({ kind: "turn-duration", durationMs: entry.durationMs, interrupted })
      flushTurnDiff()
      interrupted = false
      continue
    }

    if (entry.type === "system" && entry.subtype === "local_command" && entry.content) {
      const output = entry.content.match(/^<local-command-(?:stdout|stderr)>([\s\S]*?)<\/local-command-(?:stdout|stderr)>$/)?.[1]
      if (output) items.push({ kind: "agent", message: { type: "assistant", message: { content: [{ type: "text", text: output }] }, parent_tool_use_id: null } })
      else if (entry.content.startsWith("/")) {
        if (currentUserMessageId === undefined) turnNumber++
        currentUserMessageId = entry.uuid ?? currentUserMessageId
        items.push({ kind: "user", text: entry.content })
      }
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

    const content = entry.message?.content
    if (entry.type === "user" && typeof content === "string" && INTERRUPT_MARKER.test(content.trim())) {
      interrupted = true
      continue
    }

    const text = userText(entry)
    const images = Array.isArray(content) ? content.filter((b: any) => b?.type === "image") : []
    if (text !== null || (entry.type === "user" && !entry.isMeta && !entry.isCompactSummary && images.length)) {
      if (currentUserMessageId === undefined) turnNumber++
      currentUserMessageId = entry.uuid ?? currentUserMessageId
      items.push({ kind: "user", text: text ?? "", images: Array.isArray(content) ? content.filter((b: any) => b?.type === "image") : undefined })
      continue
    }

    if (entry.type === "user" && Array.isArray(content) && content.some((b: any) => b?.type === "tool_result")) {
      items.push({
        kind: "agent",
        message: {
          type: "user",
          message: {
            content: content.map((block: any) =>
              block?.type === "tool_result"
                ? { ...block, tool_use_result: entry.toolUseResult }
                : block,
            ) as ContentBlock[],
          },
          parent_tool_use_id: null,
        },
      })
    }
  }
  flushTurnDiff()
  return items
}
