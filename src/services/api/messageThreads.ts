import { createHash } from 'crypto'
import { APIError } from '@anthropic-ai/sdk/error'
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { getSessionId } from '../../bootstrap/state.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { isDirectFirstParty } from '../../utils/model/providers.js'

const THREAD_BETA = 'message-threads-2026-08-12'
type WireMessage = BetaMessageStreamParams['messages'][number]
type ThreadParams = BetaMessageStreamParams & {
  thread?: { type: 'create' } | { type: 'continue'; previous_message_id: string }
}
type ThreadState = { fingerprint: string; history: string[]; messageId: string }
const threads = new Map<string, ThreadState>()
const unsupportedSessions = new Set<string>()
const fullFieldsSessions = new Set<string>()

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value, (key, value) => {
    if (key === 'cache_control') return undefined
    if (value instanceof Map) return [...value].sort(([a], [b]) => String(a).localeCompare(String(b)))
    if (value instanceof Set) return [...value].sort()
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]))
    }
    return value
  })).digest('hex')
}

export function createMessageThreadRequest(querySource: string, agentId: string | undefined) {
  const session = getSessionId()
  const key = `${session}:${agentId ?? 'root'}`
  let forceCreate = false
  let recoveries = 0
  let prepared: { params: ThreadParams; fingerprint: string; history: string[] } | undefined
  const enabled = isDirectFirstParty() &&
    !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS) &&
    isEnvTruthy(process.env.NOA_CLAUDE_TETHER_LIVE ?? process.env.CLAUDE_CODE_TETHER_LIVE) &&
    (querySource === 'sdk' || querySource.startsWith('repl_main_thread') || querySource.startsWith('agent:'))

  return {
    isEnabled(): boolean {
      return enabled && !unsupportedSessions.has(session)
    },
    prepare(params: BetaMessageStreamParams, environment: unknown): ThreadParams {
      if (!enabled || unsupportedSessions.has(session)) return params
      if (params.messages.some(message => Array.isArray(message.content) && message.content.some(block =>
        block.type === 'server_tool_use' || block.type === 'tool_addition' || block.type === 'tool_removal'))) {
        threads.delete(key)
        return params
      }
      const { messages, system, metadata: _metadata, ...configuration } = params
      const stableSystem = Array.isArray(system)
        ? system.filter(block => !block.text.startsWith('x-anthropic-billing-header:'))
        : system
      const fingerprint = hash([configuration, stableSystem, environment])
      const history = messages.map(message => hash({
        ...message,
        content: typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content,
      }))
      const previous = threads.get(key)
      const canContinue = !forceCreate && previous?.fingerprint === fingerprint &&
        history.length > previous.history.length && previous.history.every((value, index) => value === history[index])
      const threaded: ThreadParams = {
        ...params,
        betas: [...(params.betas ?? []), THREAD_BETA],
        tools: canContinue && !fullFieldsSessions.has(session) ? undefined : params.tools,
        system: canContinue && !fullFieldsSessions.has(session) && Array.isArray(params.system)
          ? params.system.filter(block => block.text.startsWith('x-anthropic-billing-header:'))
          : params.system,
        messages: canContinue ? messages.slice(previous.history.length) : messages,
        thread: canContinue ? { type: 'continue', previous_message_id: previous.messageId } : { type: 'create' },
      }
      prepared = { params: threaded, fingerprint, history }
      return threaded
    },
    recover(error: unknown): boolean {
      if (!prepared || !prepared.params.thread || !(error instanceof APIError) || recoveries >= 2) return false
      const body = error.error as { error?: { details?: { error_code?: string } } } | undefined
      const code = body?.error?.details?.error_code
      if (error.status === 404 && (code === 'thread_not_found' || error.message.includes('thread_not_found'))) {
        if (prepared.params.thread.type !== 'continue') return false
        forceCreate = true
      } else if (error.status === 400) {
        if (prepared.params.thread.type === 'continue' &&
          (code === 'thread_fingerprint_mismatch' || code === 'thread_already_continued' || error.message.includes('differing field'))) {
          forceCreate = true
          fullFieldsSessions.add(session)
        } else if (code === 'thread_unsupported_request' || code?.startsWith('thread_') ||
          /(?<!diagnostics\.)previous_message_id|\bthread\b.{0,3}(param|field|request|type|:)/i.test(error.message)) {
          unsupportedSessions.add(session)
        } else {
          // Not about threads (context, media, schema…): surface it. The failed
          // request is discarded, so the next turn starts a fresh thread.
          return false
        }
      } else return false
      recoveries++
      threads.delete(key)
      return true
    },
    complete(messageId: string, response: WireMessage[]): void {
      if (!prepared || !prepared.params.thread || unsupportedSessions.has(session)) return
      threads.delete(key)
      if (threads.size >= 128) threads.delete(threads.keys().next().value!)
      threads.set(key, {
        fingerprint: prepared.fingerprint,
        history: [...prepared.history, ...response.map(message => hash({ role: message.role, content: message.content }))],
        messageId,
      })
      prepared = undefined
    },
    discardIncomplete(): void {
      if (prepared) {
        threads.delete(key)
        prepared = undefined
      }
    },
    invalidate(): void {
      threads.delete(key)
      prepared = undefined
    },
  }
}
