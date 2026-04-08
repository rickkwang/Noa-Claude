import type { LocalCommandResult } from '../../types/command.js'
import type { Message } from '../../types/message.js'

type SummaryMode = 'short' | 'detailed'

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    const text = content
      .filter(block => block && typeof block === 'object' && (block as { type?: string }).type === 'text')
      .map(block => (block as { text?: string }).text ?? '')
      .join('\n')
      .trim()
    return text
  }
  return ''
}

function summarizeSystemMessage(message: Message): string {
  if (typeof message.content === 'string' && message.content.trim()) {
    return message.content.trim()
  }
  if (typeof message.subtype === 'string') {
    return `System event: ${message.subtype}`
  }
  return 'System event'
}

function extractMessageText(message: Message): string {
  const direct = textFromContent(message.content)
  if (direct) return direct
  const sdk = textFromContent(message.message?.content)
  if (sdk) return sdk
  if (message.type === 'system') return summarizeSystemMessage(message)
  return ''
}

function firstLine(input: string, max = 120): string {
  const line = input.split('\n').map(v => v.trim()).find(Boolean) ?? ''
  if (line.length <= max) return line
  return `${line.slice(0, max - 1)}…`
}

function isCommandText(text: string): boolean {
  const value = text.trim().toLowerCase()
  return (
    value.startsWith('/summary') ||
    value.startsWith('/share') ||
    value.startsWith('/fork') ||
    value.startsWith('/workflows')
  )
}

export function buildSessionSummary(
  messages: Message[],
  mode: SummaryMode,
): string {
  const visible = messages.filter(m => m && !m.isMeta)
  const userMessages = visible
    .filter(m => m.type === 'user')
    .map(extractMessageText)
    .map(v => v.trim())
    .filter(v => v.length > 0 && !isCommandText(v))
  const assistantMessages = visible
    .filter(m => m.type === 'assistant')
    .map(extractMessageText)
    .map(v => v.trim())
    .filter(Boolean)
  const systemErrors = visible.filter(
    m => m.type === 'system' && m.subtype === 'api_error',
  )
  const systemMessages = visible
    .filter(m => m.type === 'system')
    .map(extractMessageText)
    .map(v => v.trim())
    .filter(Boolean)
  const objective = userMessages.length > 0 ? firstLine(userMessages[0] ?? '') : 'No explicit objective detected'

  const updateSource = [
    ...assistantMessages.map(msg => ({ kind: 'assistant', value: msg })),
    ...systemMessages.map(msg => ({ kind: 'system', value: msg })),
  ]
  const updates = updateSource
    .slice(-(mode === 'short' ? 4 : 8))
    .map(entry =>
      entry.kind === 'assistant'
        ? `- ${firstLine(entry.value)}`
        : `- [system] ${firstLine(entry.value)}`,
    )
    .slice(0, mode === 'short' ? 4 : 8)

  const pending = userMessages
    .slice(-(mode === 'short' ? 2 : 4))
    .map(msg => firstLine(msg))
    .filter(Boolean)
    .map(msg => `- ${msg}`)
    .slice(0, mode === 'short' ? 2 : 4)

  const risks = [
    ...(systemErrors.length > 0
      ? [`- ${systemErrors.length} API/system error message(s) detected in this session`]
      : []),
    ...(assistantMessages.length === 0
      ? ['- No assistant output yet; summary may be incomplete']
      : []),
    ...(visible.length === 0
      ? ['- Empty session; no conversation content available']
      : []),
  ]

  const statusLine =
    visible.length === 0
      ? 'Session state: empty'
      : `Session state: ${visible.length} visible message(s), ${userMessages.length} user prompt(s), ${assistantMessages.length} assistant response(s)`

  return [
    `Session Summary (${mode})`,
    '',
    statusLine,
    '',
    `Objective: ${objective}`,
    '',
    'Key Updates:',
    ...(updates.length > 0 ? updates : ['- No material updates found']),
    '',
    'Pending / Next:',
    ...(pending.length > 0 ? pending : ['- No explicit pending items detected']),
    '',
    'Risks:',
    ...(risks.length > 0 ? risks : ['- No obvious risk signal detected']),
  ].join('\n')
}

function resolveMode(args: string): SummaryMode {
  const normalized = args.trim().toLowerCase()
  if (
    normalized === 'detailed' ||
    normalized === 'detail' ||
    normalized === 'long' ||
    normalized === '--detailed'
  ) {
    return 'detailed'
  }
  return 'short'
}

export async function call(
  args: string,
  context: { messages: Message[] },
): Promise<LocalCommandResult> {
  const mode = resolveMode(args)
  const summary = buildSessionSummary(context.messages ?? [], mode)
  return {
    type: 'text',
    value: summary,
  }
}
