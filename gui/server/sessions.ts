// Reads the agent's transcripts (<config>/projects/<sanitized cwd>/<id>.jsonl)
// so the GUI can list past sessions and rebuild their history.
import { appendFileSync, closeSync, openSync, readSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs"
import { StringDecoder } from "node:string_decoder"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import type { AgentMessage, ContentBlock, ImageBlock, TurnDiff } from "../src/agent/protocol"
import { sanitizePath } from "../../src/utils/sessionStoragePortable"

export const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_SESSION_SUMMARIES = 200
// Injected wrappers such as <local-command-caveat> are not user-authored text.
const SYSTEM_WRAPPER = /^<(local-command-|command-|system-reminder|task-notification)/
const INTERRUPT_MARKER = /^\[Request interrupted by user(?:\s+for tool use)?\]$/

interface SessionSummaryCacheEntry {
  size: number
  mtimeMs: number
  createdAt: number
  owner?: string
  title?: string
}

const sessionSummaryCaches = new Map<string, Map<string, SessionSummaryCacheEntry>>()

export interface SessionSummary {
  id: string
  title: string
  updatedAt: number
  createdAt: number
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
export function findTurnUserMessage(cwd: string, id: string, offset: number, onlyAfterOffset = false): string | undefined {
  const file = transcriptPath(cwd, id)
  if (!existsSync(file)) return undefined
  const firstUser = (entries: Iterable<Entry>) => {
    for (const entry of entries) if (entry.uuid && userText(entry) !== null) return entry.uuid
    return undefined
  }
  return firstUser(scanEntries(file, offset)) ?? (onlyAfterOffset ? undefined : firstUser(scanEntries(file)))
}

export interface TurnResultRecord { index: number; userMessageId?: string; durationMs: number; error: string }
export function appendTurnResult(cwd: string, id: string, record: TurnResultRecord): void {
  const file = join(projectDir(cwd), `${id}.turn-results.jsonl`)
  mkdirSync(dirname(file), { recursive: true })
  appendFileSync(file, `${JSON.stringify(record)}\n`)
}

interface TimelineRecord { turn: number; afterUuid?: string; message: AgentMessage }

export function appendTimelineEvent(cwd: string, id: string, record: TimelineRecord): void {
  const file = join(projectDir(cwd), `${id}.gui-events.jsonl`)
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  appendFileSync(file, `${JSON.stringify(record)}\n`, { mode: 0o600 })
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
  compactMetadata?: { trigger?: "manual" | "auto" }
  message?: { id?: string; content?: unknown }
  toolUseResult?: unknown
  mcpMeta?: Record<string, unknown>
  customTitle?: string
  aiTitle?: string
}

function* scanEntries(file: string, offset = 0): Generator<Entry> {
  const fd = openSync(file, "r")
  const buffer = Buffer.alloc(64 * 1024)
  const decoder = new StringDecoder("utf8")
  let pending = ""
  let position = offset
  try {
    let size: number
    while ((size = readSync(fd, buffer, 0, buffer.length, position)) > 0) {
      position += size
      pending += decoder.write(buffer.subarray(0, size))
      let start = 0, end: number
      while ((end = pending.indexOf("\n", start)) !== -1) {
        const line = pending.slice(start, end)
        start = end + 1
        if (line) { try { yield JSON.parse(line) } catch { /* Partial or invalid record. */ } }
      }
      pending = pending.slice(start)
    }
    pending += decoder.end()
    if (pending) { try { yield JSON.parse(pending) } catch { /* A live final line may be incomplete. */ } }
  } finally { closeSync(fd) }
}

function readEntries(file: string): Entry[] { return [...scanEntries(file)] }

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
  for (const entry of scanEntries(file)) {
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
  const currentOwner = canonicalCwd(cwd)
  const cache = sessionSummaryCaches.get(dir) ?? new Map<string, SessionSummaryCacheEntry>()
  sessionSummaryCaches.set(dir, cache)
  const seen = new Set<string>()

  const files = readdirSync(dir).flatMap((file) => {
    const id = file.endsWith(".jsonl") ? file.slice(0, -".jsonl".length) : ""
    if (!SESSION_ID.test(id)) return []
    const path = join(dir, file)
    const info = statSync(path)
    return [{ id, path, size: info.size, updatedAt: info.mtimeMs, birthtimeMs: info.birthtimeMs }]
  }).sort((a, b) => b.updatedAt - a.updatedAt)

  const sessions: SessionSummary[] = []
  for (const file of files) {
    seen.add(file.path)
    let cached = cache.get(file.path)
    if (!cached || cached.size !== file.size || cached.mtimeMs !== file.updatedAt) {
      const entries = readEntries(file.path)
      const owner = entries.find((entry) => typeof entry.cwd === "string")?.cwd
      const first = entries.map(userText).find((t): t is string => t !== null)
      // The first timestamped entry is when the task started; the file's birth time is the fallback.
      const started = entries.map((entry) => Date.parse(String(entry.timestamp))).find((time) => Number.isFinite(time))
      cached = {
        size: file.size,
        mtimeMs: file.updatedAt,
        createdAt: started ?? file.birthtimeMs,
        owner: owner ? canonicalCwd(owner) : undefined,
        title:
          [...entries]
            .reverse()
            .find((entry) => entry.type === "custom-title")
            ?.customTitle?.trim() || [...entries].reverse().find((entry) => entry.type === "ai-title")
            ?.aiTitle?.trim() || first?.replace(/\s+/g, " ").trim().slice(0, 80),
      }
      cache.set(file.path, cached)
    }
    if (cached.owner && cached.owner !== currentOwner) continue
    if (!cached.title) continue
    sessions.push({
      id: file.id,
      title: cached.title,
      updatedAt: file.updatedAt,
      createdAt: cached.createdAt,
    })
  }
  for (const path of cache.keys()) if (!seen.has(path)) cache.delete(path)
  return sessions.slice(0, MAX_SESSION_SUMMARIES)
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

async function conversationChain(file: string, includeSidechain = false): Promise<Entry[]> {
  // Load the CLI's recovery rules, including compact/snip and orphaned tool results.
  const modulePath = "../../src/utils/sessionStorage.ts"
  const { loadTranscriptFile, buildConversationChain } = await import(modulePath)
  const { messages, leafUuids } = await loadTranscriptFile(file) as { messages: Map<string, Entry>; leafUuids: Set<string> }
  let hasUuid = false
  for (const entry of messages.values()) if (entry.uuid) { hasUuid = true; break }
  if (!hasUuid) return readEntries(file)
  let leaf: Entry | undefined
  for (const entry of messages.values()) {
    if ((!includeSidechain && entry.isSidechain) || (entry.type !== "user" && entry.type !== "assistant")) continue
    if (leafUuids.size && !leafUuids.has(entry.uuid!)) continue
    if (!leaf || (entry.timestamp ?? "") >= (leaf.timestamp ?? "")) leaf = entry
  }
  return leaf ? buildConversationChain(messages, leaf) : []
}

// History items use the same shapes as live stream-json messages, so the
// client feeds them through the same reducer.
export type HistoryItem =
  | { kind: "user"; id?: string; text: string; images?: ImageBlock[] }
  | { kind: "turn-duration"; durationMs: number; interrupted?: boolean; error?: string }
  | { kind: "compaction"; trigger: "manual" | "auto" }
  | { kind: "turn-diff"; diff: TurnDiff }
  | {
      kind: "agent"
      messageId?: string
      message: AgentMessage
    }

export function historyPage(items: HistoryItem[], before = items.length): { items: HistoryItem[]; before: number } {
  const end = Math.max(0, Math.min(before, items.length))
  let start = end, users = 0
  while (start > 0) {
    start--
    if (items[start]?.kind === "user" && ++users >= 40) break
  }
  // A background result can arrive in a later turn. Keep its originating call in the page.
  const calls = new Map<string, number>()
  const hooks = new Map<string, number>()
  let userStart = 0
  for (let i = 0; i < end; i++) {
    const item = items[i]!
    if (item.kind === "user") userStart = i
    if (item.kind === "agent" && item.message.type === "assistant") {
      for (const block of item.message.message.content) if (block.type === "tool_use") calls.set(block.id, userStart)
    }
    if (item.kind === "agent" && item.message.type === "system" && item.message.subtype === "hook_started") hooks.set(item.message.hook_id, userStart)
  }
  for (let i = end - 1; i >= start; i--) {
    const item = items[i]!
    if (item.kind !== "agent") continue
    const message = item.message
    if (message.type === "system" && (message.subtype === "hook_response" || message.subtype === "hook_progress")) start = Math.min(start, hooks.get(message.hook_id) ?? start)
    const ids = "parent_tool_use_id" in message && message.parent_tool_use_id ? [message.parent_tool_use_id] : []
    if (message.type === "system" && ["task_started", "task_progress", "task_notification"].includes(message.subtype) && "tool_use_id" in message && message.tool_use_id) ids.push(message.tool_use_id)
    if (message.type === "user" && Array.isArray(message.message.content)) for (const block of message.message.content) if (block.type === "tool_result") ids.push(block.tool_use_id)
    for (const id of ids) start = Math.min(start, calls.get(id) ?? start)
  }
  return { items: items.slice(start, end), before: start }
}

async function restoreAgentHistory(items: HistoryItem[], cwd: string, session: string, tool: Extract<ContentBlock, { type: "tool_use" }>, result: Record<string, any>, failed: boolean, visited: Set<string>): Promise<void> {
  if (typeof result.agentId !== "string" || !/^[a-zA-Z0-9_-]+$/.test(result.agentId)) return
  if (visited.has(result.agentId)) return
  visited.add(result.agentId)
  items.push({ kind: "agent", message: {
    type: "system", subtype: "task_notification", task_id: result.agentId, tool_use_id: tool.id,
    description: typeof tool.input.description === "string" ? tool.input.description : "Subagent",
    status: failed ? "failed" : result.status === "completed" ? "completed" : "unknown",
    usage: typeof result.totalDurationMs === "number" ? { duration_ms: result.totalDurationMs, total_tokens: result.totalTokens ?? 0, tool_uses: result.totalToolUseCount ?? 0 } : undefined,
  } })
  const file = join(projectDir(cwd), session, "subagents", `agent-${result.agentId}.jsonl`)
  if (!existsSync(file) || statSync(file).size > 50 * 1024 * 1024) return
  const calls = new Map<string, Extract<ContentBlock, { type: "tool_use" }>>()
  let children: Entry[]
  try { children = await conversationChain(file, true) }
  catch { return }
  for (const child of children) {
    if ((child.type !== "assistant" && child.type !== "user") || !Array.isArray(child.message?.content)) continue
    const content = child.message.content as ContentBlock[]
    items.push({ kind: "agent", message: { type: child.type, parent_tool_use_id: tool.id, message: { content }, ...(child.type === "user" ? { tool_use_result: child.toolUseResult } : {}) } })
    for (const block of content) {
      if (block.type === "tool_use") calls.set(block.id, block)
      if (block.type === "tool_result" && child.toolUseResult && typeof child.toolUseResult === "object") {
        const nested = calls.get(block.tool_use_id)
        if (nested && (nested.name === "Agent" || nested.name === "Task")) await restoreAgentHistory(items, cwd, session, nested, child.toolUseResult as Record<string, any>, block.is_error === true, visited)
      }
    }
  }
}

export async function loadHistory(cwd: string, id: string): Promise<HistoryItem[] | null> {
  if (!SESSION_ID.test(id)) return null
  const file = join(projectDir(cwd), `${id}.jsonl`)
  if (!existsSync(file)) return null

  const entries = await conversationChain(file)
  const owner = entries.find((entry) => typeof entry.cwd === "string")?.cwd
  if (owner && canonicalCwd(owner) !== canonicalCwd(cwd)) return null

  const items: HistoryItem[] = []
  const restoredAgents = new Set<string>()
  const byUser = new Map<string, TurnDiff>()
  const byIndex = new Map<number, TurnDiff>()
  for (const record of readTurnDiffs(cwd, id)) {
    // Old records predate turnIndex; derive it so Undo works on their cards.
    const diff = { ...record.diff, turnIndex: record.diff.turnIndex ?? record.index }
    if (record.userMessageId) byUser.set(record.userMessageId, diff)
    byIndex.set(record.index, diff)
  }
  const results = new Map<string | number, TurnResultRecord>()
  const resultFile = join(projectDir(cwd), `${id}.turn-results.jsonl`)
  if (existsSync(resultFile)) for (const line of readFileSync(resultFile, "utf8").split("\n")) {
    try {
      const record = JSON.parse(line) as TurnResultRecord
      if (record.error && typeof record.durationMs === "number") results.set(record.userMessageId ?? record.index, record)
    } catch { /* A live final line may be incomplete. */ }
  }
  let turnNumber = 0
  let currentUserMessageId: string | undefined
  const flushTurnDiff = () => {
    const resultKey = currentUserMessageId && results.has(currentUserMessageId) ? currentUserMessageId : turnNumber
    const result = results.get(resultKey)
    if (result) {
      items.push({ kind: "turn-duration", durationMs: result.durationMs, error: result.error })
      results.delete(resultKey)
    }
    if (currentUserMessageId === undefined && !byIndex.has(turnNumber)) return
    const diff = (currentUserMessageId ? byUser.get(currentUserMessageId) : undefined) ?? byIndex.get(turnNumber)
    if (diff) items.push({ kind: "turn-diff", diff })
    currentUserMessageId = undefined
  }
  const byAnchor = new Map<string, AgentMessage[]>()
  const byTurn = new Map<number, AgentMessage[]>()
  const eventFile = join(projectDir(cwd), `${id}.gui-events.jsonl`)
  if (existsSync(eventFile)) for (const line of readFileSync(eventFile, "utf8").split("\n")) {
    if (!line) continue
    try {
      const record = JSON.parse(line) as TimelineRecord
      const bucket = (record.afterUuid ? byAnchor.get(record.afterUuid) : byTurn.get(record.turn)) ?? []
      bucket.push(record.message)
      if (record.afterUuid) byAnchor.set(record.afterUuid, bucket)
      else byTurn.set(record.turn, bucket)
    } catch { /* A live sidecar tail may be incomplete. */ }
  }
  if (byTurn.size) {
    let rawTurn = 0
    for (const entry of scanEntries(file)) {
      if ((entry.type === "system" && entry.subtype === "local_command" && entry.content?.startsWith("/")) || userText(entry) !== null) {
        rawTurn++
        const messages = byTurn.get(rawTurn)
        if (messages && entry.uuid) {
          byAnchor.set(entry.uuid, [...(byAnchor.get(entry.uuid) ?? []), ...messages])
          byTurn.delete(rawTurn)
        }
      }
    }
  }
  for (const message of byTurn.get(0) ?? []) items.push({ kind: "agent", message })
  byTurn.delete(0)
  let interrupted = false
  let recordIndex = 0
  for (const entry of entries) {
    const userId = entry.uuid ?? `${id}:user:${recordIndex}`
    recordIndex++
    if (entry.isSidechain) continue
    try {
    if (entry.type === "system" && entry.subtype === "compact_boundary") {
      items.push({ kind: "compaction", trigger: entry.compactMetadata?.trigger ?? "auto" })
      continue
    }
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
        items.push({ kind: "user", id: userId, text: entry.content })
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
      if (last?.kind === "agent" && last.message.type === "assistant" && messageId && last.messageId === messageId) {
        const content = last.message.message.content
        content.push(...blocks)
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
      if (currentUserMessageId !== undefined) flushTurnDiff()
      if (currentUserMessageId === undefined) turnNumber++
      currentUserMessageId = entry.uuid ?? currentUserMessageId
      items.push({ kind: "user", id: userId, text: text ?? "", images: Array.isArray(content) ? content.filter((b: any) => b?.type === "image") : undefined })
      continue
    }

    if (entry.type === "user" && Array.isArray(content) && content.some((b: any) => b?.type === "tool_result")) {
      const result = entry.toolUseResult as Record<string, any> | undefined
      if (result && typeof result.agentId === "string" && /^[a-zA-Z0-9_-]+$/.test(result.agentId)) {
        const toolResult = content.find((block: any) => block.type === "tool_result")
        const tool = items.flatMap(item => item.kind === "agent" && item.message.type === "assistant" ? item.message.message.content : [])
          .find(block => block.type === "tool_use" && block.id === toolResult?.tool_use_id)
        if (tool?.type === "tool_use" && (tool.name === "Agent" || tool.name === "Task")) {
          await restoreAgentHistory(items, cwd, id, tool, result, toolResult.is_error === true, restoredAgents)
        }
      }
      items.push({
        kind: "agent",
        message: {
          type: "user",
          message: {
            content: content.map((block: any) =>
              block?.type === "tool_result"
                ? { ...block, tool_use_result: entry.mcpMeta ? { content: entry.toolUseResult, ...entry.mcpMeta } : entry.toolUseResult }
                : block,
            ) as ContentBlock[],
          },
          parent_tool_use_id: null,
        },
      })
    }
    } finally {
      for (const message of (entry.uuid ? byAnchor.get(entry.uuid) : undefined) ?? []) items.push({ kind: "agent", message })
      if (entry.type === "user" && userText(entry) !== null) {
        for (const message of byTurn.get(turnNumber) ?? []) items.push({ kind: "agent", message })
        byTurn.delete(turnNumber)
      }
    }
  }
  flushTurnDiff()
  // The CLI records /compact after its new boundary; show the action before its outcome.
  for (let i = 0; i < items.length - 1; i++) {
    const boundary = items[i]!, command = items[i + 1]!
    if (boundary.kind === "compaction" && boundary.trigger === "manual" && command.kind === "user" && /^\/compact(?:\s|$)/.test(command.text)) {
      items[i] = command
      items[++i] = boundary
    }
  }
  return items
}
