import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { getSessionId } from '../../bootstrap/state.js'
import type { LocalCommandResult } from '../../types/command.js'
import type { Message } from '../../types/message.js'
import { getCwd } from '../../utils/cwd.js'
import { getPrimaryProjectSubdir } from '../../utils/productPaths.js'
import { buildSessionSummary } from '../summary/summary.js'

function formatTimestamp(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  const second = String(date.getSeconds()).padStart(2, '0')
  return `${year}${month}${day}-${hour}${minute}${second}`
}

function sanitizeFilename(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '-')
}

function messageSnippet(message: Message): string {
  const raw = extractMessageText(message)
  const oneLine = raw.replace(/\s+/g, ' ').trim()
  if (!oneLine) return ''
  if (oneLine.length <= 140) return oneLine
  return `${oneLine.slice(0, 139)}…`
}

function extractMessageText(message: Message): string {
  if (typeof message.content === 'string' && message.content.trim()) {
    return message.content.trim()
  }
  const sdk = message.message?.content
  if (typeof sdk === 'string' && sdk.trim()) {
    return sdk.trim()
  }
  if (Array.isArray(sdk)) {
    const text = sdk
      .filter(block => block && typeof block === 'object' && (block as { type?: string }).type === 'text')
      .map(block => (block as { text?: string }).text ?? '')
      .join('\n')
      .trim()
    if (text) return text
  }
  if (message.type === 'system' && typeof message.subtype === 'string') {
    return `System event: ${message.subtype}`
  }
  return ''
}

function parseArgs(args: string): {
  mode: 'short' | 'detailed'
  outputName?: string
} {
  const parts = args
    .split(/\s+/)
    .map(v => v.trim())
    .filter(Boolean)
  const detailed =
    parts.includes('--detailed') ||
    parts.includes('detailed') ||
    parts.includes('long')
  const filtered = parts.filter(
    v => v !== '--detailed' && v !== 'detailed' && v !== 'long',
  )
  return {
    mode: detailed ? 'detailed' : 'short',
    outputName: filtered[0],
  }
}

function buildSnapshotContent(params: {
  sessionId: string
  summary: string
  messages: Message[]
  mode: 'short' | 'detailed'
}): string {
  const { sessionId, summary, messages, mode } = params
  const now = new Date().toISOString()
  const visible = messages.filter(m => m && !m.isMeta)
  const snippets = visible
    .filter(m => m && !m.isMeta)
    .slice(mode === 'short' ? -12 : -24)
    .map(m => ({
      type: m.type,
      snippet: messageSnippet(m),
    }))
    .filter(entry => entry.snippet.length > 0)
  const counts = {
    visible: visible.length,
    user: visible.filter(m => m.type === 'user').length,
    assistant: visible.filter(m => m.type === 'assistant').length,
    system: visible.filter(m => m.type === 'system').length,
  }

  return [
    '# Noa Claude Share Snapshot',
    '',
    `GeneratedAt: ${now}`,
    `SessionId: ${sessionId}`,
    `SummaryMode: ${mode}`,
    `VisibleMessages: ${counts.visible}`,
    `UserMessages: ${counts.user}`,
    `AssistantMessages: ${counts.assistant}`,
    `SystemMessages: ${counts.system}`,
    '',
    '## Summary',
    '',
    summary,
    '',
    '## Context Excerpts',
    ...(snippets.length > 0
      ? snippets.map((entry, idx) => `${idx + 1}. [${entry.type}] ${entry.snippet}`)
      : ['No excerpt available.']),
    '',
  ].join('\n')
}

export async function call(
  args: string,
  context: { messages: Message[] },
): Promise<LocalCommandResult> {
  const { mode, outputName } = parseArgs(args)
  const summary = buildSessionSummary(context.messages ?? [], mode)
  const cwd = getCwd()
  const shareDir = getPrimaryProjectSubdir(cwd, 'shares')
  const sessionId = getSessionId()
  const baseName = outputName
    ? sanitizeFilename(outputName.replace(/\.md$/i, ''))
    : `share-${formatTimestamp(new Date())}`
  const filename = `${baseName || 'share'}.md`
  const fullPath = join(shareDir, filename)

  try {
    await mkdir(shareDir, { recursive: true })
    const content = buildSnapshotContent({
      sessionId,
      summary,
      messages: context.messages ?? [],
      mode,
    })
    await writeFile(fullPath, content, 'utf8')
    return {
      type: 'text',
      value: `Share snapshot exported: ${fullPath}`,
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown write failure'
    return {
      type: 'text',
      value: `Failed to export share snapshot: ${message}`,
    }
  }
}
