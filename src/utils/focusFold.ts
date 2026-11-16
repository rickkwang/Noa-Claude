import { NO_CONTENT_MESSAGE } from '../constants/messages.js'
import { findToolByName, type Tools } from '../Tool.js'
import { AGENT_TOOL_NAME, LEGACY_AGENT_TOOL_NAME } from '../tools/AgentTool/constants.js'
import { FILE_EDIT_TOOL_NAME } from '../tools/FileEditTool/constants.js'
import { FILE_WRITE_TOOL_NAME } from '../tools/FileWriteTool/prompt.js'
import { NOTEBOOK_EDIT_TOOL_NAME } from '../tools/NotebookEditTool/constants.js'
import { NO_RESPONSE_REQUESTED } from './messages.js'

// The declared Message union names collapsed groups differently from what
// collapseReadSearch emits at runtime, so rows are handled structurally here.
type Row = Record<string, any>

const EDIT_TOOL_NAMES = new Set([FILE_EDIT_TOOL_NAME, FILE_WRITE_TOOL_NAME, NOTEBOOK_EDIT_TOOL_NAME])

function isTurnStart(m: Row): boolean {
  if (m.type === 'user') return m.message.content[0]?.type !== 'tool_result'
  if (m.type !== 'attachment') return false
  const a = m.attachment
  if (a.type !== 'queued_command' || a.commandMode !== 'prompt') return false
  const origin = a.origin
  if (!a.isMeta && (origin === undefined || origin.kind === 'human' || origin.kind === 'auto-continuation')) return true
  return origin?.kind === 'channel' || origin?.kind === 'peer'
}

function isNoResponseText(text: string): boolean {
  return text.trim() === NO_CONTENT_MESSAGE || text === NO_RESPONSE_REQUESTED
}

function hasVisibleText(m: Row): boolean {
  if (m.type !== 'assistant') return false
  const block = m.message.content[0]
  return block?.type === 'text' && block.text.trim().length > 0 && !isNoResponseText(block.text)
}

function isNoResponse(m: Row): boolean {
  if (m.type !== 'assistant') return false
  const block = m.message.content[0]
  return block?.type === 'text' && isNoResponseText(block.text)
}

function isFinalAnswer(m: Row): boolean {
  return m.type === 'assistant' && m.message.stop_reason === 'end_turn' && hasVisibleText(m)
}

function isTurnEnd(m: Row): boolean {
  return m.type === 'system' && (m.subtype === 'turn_duration' || m.subtype === 'scheduled_task_fire')
}

function isQuietTail(m: Row): boolean {
  if (m.type === 'assistant') {
    const type = m.message.content[0]?.type
    return type === 'thinking' || type === 'redacted_thinking'
  }
  return m.type === 'attachment' || m.type === 'system'
}

function emptySummary(m: Row): Row {
  return {
    type: 'collapsed_read_search',
    searchCount: 0,
    readCount: 0,
    listCount: 0,
    replCount: 0,
    memorySearchCount: 0,
    memoryReadCount: 0,
    memoryWriteCount: 0,
    messages: [m],
    displayMessage: m,
    uuid: m.uuid,
    timestamp: m.timestamp,
  }
}

function countLines(s: unknown): number {
  return typeof s === 'string' && s.length > 0 ? s.split('\n').length : 0
}

function editLineDelta(toolName: string, input: Row | null | undefined): { added: number; removed: number } {
  if (typeof input !== 'object' || input === null) return { added: 0, removed: 0 }
  if (toolName === FILE_EDIT_TOOL_NAME) {
    if (Array.isArray(input.edits)) {
      let added = 0
      let removed = 0
      for (const edit of input.edits) {
        if (typeof edit !== 'object' || edit === null) continue
        added += countLines(edit.new_string)
        removed += countLines(edit.old_string)
      }
      return { added, removed }
    }
    return { added: countLines(input.new_string), removed: countLines(input.old_string) }
  }
  if (toolName === FILE_WRITE_TOOL_NAME) return { added: countLines(input.content), removed: 0 }
  if (toolName === NOTEBOOK_EDIT_TOOL_NAME) return { added: countLines(input.new_source), removed: 0 }
  return { added: 0, removed: 0 }
}

/** Summary row for a tool call that the read/search collapse left standing. */
function summarizeToolCalls(
  m: Row,
  toolName: string,
  inputs: (Row | undefined)[],
  tools: Tools,
): Row {
  const count = inputs.length
  const summary = emptySummary(m)
  if (toolName === AGENT_TOOL_NAME || toolName === LEGACY_AGENT_TOOL_NAME) {
    summary.agentCount = count
    const descriptions = inputs.flatMap(input => {
      const d = input?.description
      if (typeof d !== 'string') return []
      const line = d.replace(/\s+/g, ' ').trim().slice(0, 300)
      return line !== '' ? [line] : []
    })
    if (descriptions.length > 0) summary.agentDescriptions = descriptions
    return summary
  }
  const tool = findToolByName(tools, toolName)
  if (tool?.isMcp) {
    summary.mcpCallCount = count
    if (tool.mcpInfo?.serverName) summary.mcpServerNames = [tool.mcpInfo.serverName]
  } else if (EDIT_TOOL_NAMES.has(toolName)) {
    summary.editFileCount = count
    let added = 0
    let removed = 0
    for (const input of inputs) {
      const delta = editLineDelta(toolName, input)
      added += delta.added
      removed += delta.removed
    }
    if (added > 0) summary.linesAdded = added
    if (removed > 0) summary.linesRemoved = removed
  } else {
    summary.otherToolCount = count
  }
  return summary
}

function addOptional(into: Row, from: Row, key: string): void {
  if (from[key]) into[key] = (into[key] ?? 0) + from[key]
}

function concatOptional(into: Row, from: Row, key: string): void {
  if (from[key]?.length) into[key] = [...(into[key] ?? []), ...from[key]]
}

function mergeSummary(into: Row, from: Row): void {
  into.searchCount += from.searchCount
  into.readCount += from.readCount
  into.listCount += from.listCount
  into.memorySearchCount += from.memorySearchCount
  into.memoryReadCount += from.memoryReadCount
  into.memoryWriteCount += from.memoryWriteCount
  for (const key of [
    'teamMemorySearchCount',
    'teamMemoryReadCount',
    'teamMemoryWriteCount',
    'mcpCallCount',
    'bashCount',
    'gitOpBashCount',
    'otherToolCount',
    'agentCount',
    'editFileCount',
    'linesAdded',
    'linesRemoved',
  ]) {
    addOptional(into, from, key)
  }
  if (from.mcpServerNames?.length) {
    into.mcpServerNames = [...new Set([...(into.mcpServerNames ?? []), ...from.mcpServerNames])]
  }
  for (const key of [
    'agentDescriptions',
    'commits',
    'pushes',
    'branches',
    'prs',
    'readFilePaths',
    'searchArgs',
    'relevantMemories',
  ]) {
    concatOptional(into, from, key)
  }
  into.latestDisplayHint = from.latestDisplayHint ?? into.latestDisplayHint
  into.messages.push(...from.messages)
}

/**
 * Fold each turn down to its prompt, one summary row for the tool work, and
 * the final response. Thinking, attachments and mid-turn text are hidden; the
 * turn's `turn_duration` row carries how many messages were hidden. While the
 * last turn is still running nothing is counted and no final text is picked.
 */
export function foldFocusTurns(messages: Row[], tools: Tools, isLoading: boolean): Row[] {
  const out: Row[] = []
  let i = 0
  let inTurn = false
  while (i < messages.length) {
    const first = messages[i]!
    if (!inTurn && !isTurnStart(first)) {
      out.push(first)
      i++
      continue
    }
    if (!inTurn) {
      out.push(first)
      i++
    }
    const start = i
    let end = i
    let answered = false
    let ended = false
    while (end < messages.length && !isTurnStart(messages[end]!)) {
      const m = messages[end]!
      if (m.type === 'assistant' || m.type === 'collapsed_read_search' || m.type === 'grouped_tool_use') {
        if (ended) break
        answered = isFinalAnswer(m)
      } else if (answered && isTurnEnd(m)) {
        ended = true
      }
      end++
    }

    let live = isLoading && end === messages.length
    if (live) {
      let k = end - 1
      while (k >= start && isQuietTail(messages[k]!)) k--
      const last = k >= start ? messages[k] : undefined
      if (last?.type === 'assistant' && last.message.stop_reason !== null && (hasVisibleText(last) || isNoResponse(last))) {
        live = false
      }
    }
    let finalIdx = -1
    if (!live) {
      for (let k = end - 1; k >= start; k--) {
        if (hasVisibleText(messages[k]!)) {
          finalIdx = k
          break
        }
      }
    }

    const keep = new Set<number>()
    let summary: Row | null = null
    let summaryAt = end
    let uncounted = 0
    for (let k = start; k < end; k++) {
      if (k === finalIdx) continue
      const m = messages[k]!
      if (m.type === 'system') {
        if (m.subtype === 'informational' && m.level === 'info') uncounted++
        else if (!(m.subtype === 'stop_hook_summary' && typeof m.hookLabel === 'string' && m.hookLabel.length > 0)) keep.add(k)
        continue
      }
      let part: Row | null = null
      if (m.type === 'collapsed_read_search') {
        part = m
      } else if (m.type === 'grouped_tool_use') {
        part = summarizeToolCalls(m, m.toolName, m.messages.map((g: Row) => g.message.content[0]?.input), tools)
      } else if (m.type === 'assistant') {
        const block = m.message.content[0]
        if (block?.type === 'tool_use') part = summarizeToolCalls(m, block.name, [block.input], tools)
        else if (isNoResponse(m) || block?.type === 'thinking' || block?.type === 'redacted_thinking') uncounted++
      } else if (m.type === 'user') {
        summary?.messages.push(m)
      }
      if (m.type === 'attachment') uncounted++
      if (part) {
        if (summary) mergeSummary(summary, part)
        else {
          summary = { ...part, messages: [...part.messages] }
          summaryAt = k
        }
      }
    }
    if (finalIdx !== -1) keep.add(finalIdx)
    const shown: [number, Row][] = [...keep].map(k => [k, messages[k]!])
    if (summary) {
      summary.uuid = `brief-${summary.uuid}`
      summary.hookCount = undefined
      summary.hookTotalMs = undefined
      summary.hookInfos = undefined
      shown.push([summaryAt, summary])
    }
    shown.sort((a, b) => a[0] - b[0])
    const hidden = live ? 0 : end - start - shown.length - uncounted
    for (const [, m] of shown) {
      out.push(hidden > 0 && m.type === 'system' && m.subtype === 'turn_duration' ? { ...m, briefHiddenCount: hidden } : m)
    }
    i = end
    inTurn = i < messages.length && !isTurnStart(messages[i]!)
  }
  return out
}
