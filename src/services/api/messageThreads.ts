import { createHash } from 'crypto'
import { APIError } from '@anthropic-ai/sdk/error'
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { getSessionId } from '../../bootstrap/state.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { isDirectFirstParty } from '../../utils/model/providers.js'

const THREAD_BETA = 'message-threads-2026-08-12'
// Beta blocks the SDK types do not carry yet; upstream emits them for late tool loading.
const TOOL_CHANGE_BLOCKS = new Set<string>(['tool_addition', 'tool_removal'])
type WireMessage = BetaMessageStreamParams['messages'][number]
type ThreadParams = BetaMessageStreamParams & {
  thread?: { type: 'create' } | { type: 'continue'; previous_message_id: string }
}
type ThreadState = { fingerprint: string; history: string[]; messageId: string }
type ThreadOutcome = 'not_found' | 'fingerprint_mismatch' | 'already_continued' | 'unsupported_request' | 'other_thread_400'
const threads = new Map<string, ThreadState>()
// Stateless-per-model, as upstream: one model refusing threads does not disable them for another.
const unsupportedModels = new Set<string>()
// The beta header is latched rejected for the whole session once the server refuses it.
const rejectedSessions = new Set<string>()
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

function classify(error: APIError): ThreadOutcome | undefined {
  const body = error.error as { error?: { details?: { error_code?: string } } } | undefined
  const code = body?.error?.details?.error_code
  const message = error.message
  if (error.status === 404) {
    return code === 'thread_not_found' || message.includes('thread_not_found') ? 'not_found' : undefined
  }
  if (error.status !== 400) return undefined
  if (code === 'thread_unsupported_request' || message.includes(THREAD_BETA)) return 'unsupported_request'
  if (code === 'thread_fingerprint_mismatch' || message.includes('differing field')) return 'fingerprint_mismatch'
  if (code === 'thread_already_continued' || message.includes('already been continued')) return 'already_continued'
  if (/(?<!diagnostics\.)previous_message_id/.test(message) ||
    /\bthread\b.{0,3}(param|field|request|type|:)/i.test(message) || code?.startsWith('thread_')) {
    return 'other_thread_400'
  }
  return undefined
}

// True when the server's mismatch report names a field this request left to the thread.
function namesOmittedField(error: APIError, omitted: { system: boolean; tools: boolean }): boolean {
  if (!omitted.system && !omitted.tools) return false
  const named = /differing field\(s\):\s*([A-Za-z_,\s-]+)/i.exec(error.message)
  if (!named) return true
  const fields = (named[1] ?? '').split(',').map(field => field.trim().toLowerCase())
  return (omitted.system && fields.includes('system')) || (omitted.tools && fields.includes('tools'))
}

export function createMessageThreadRequest(querySource: string, agentId: string | undefined, model: string) {
  const session = getSessionId()
  const key = `${session}:${agentId ?? 'root'}`
  const modelKey = `${session}\0${model}`
  let forceCreate = false
  let recoveries = 0
  let prepared: {
    params: ThreadParams
    fingerprint: string
    history: string[]
    omitted: { system: boolean; tools: boolean }
  } | undefined
  const enabled = isDirectFirstParty() &&
    !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS) &&
    isEnvTruthy(process.env.NOA_CLAUDE_TETHER_LIVE ?? process.env.CLAUDE_CODE_TETHER_LIVE) &&
    (querySource === 'sdk' || querySource.startsWith('repl_main_thread') || querySource.startsWith('agent:'))
  const available = () => enabled && !rejectedSessions.has(session) && !unsupportedModels.has(modelKey)

  return {
    isEnabled(): boolean {
      return available()
    },
    prepare(params: BetaMessageStreamParams, environment: unknown): ThreadParams {
      // A stale plan must never settle or recover a request that did not go out threaded.
      prepared = undefined
      if (!available()) return params
      if (params.messages.some(message => Array.isArray(message.content) && message.content.some(block =>
        block.type === 'server_tool_use' || TOOL_CHANGE_BLOCKS.has(block.type)))) {
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
      // Deliberately omits static fields on continuation (upstream sends them unless its gate is on);
      // a fingerprint mismatch naming them switches this session to full fields.
      const inherit = canContinue && !fullFieldsSessions.has(session)
      const inheritedSystem = inherit && Array.isArray(params.system)
        ? params.system.filter(block => block.text.startsWith('x-anthropic-billing-header:'))
        : undefined
      const threaded: ThreadParams = {
        ...params,
        betas: [...(params.betas ?? []), THREAD_BETA],
        tools: inherit ? undefined : params.tools,
        system: inheritedSystem ?? params.system,
        messages: canContinue ? messages.slice(previous.history.length) : messages,
        thread: canContinue ? { type: 'continue', previous_message_id: previous.messageId } : { type: 'create' },
      }
      prepared = {
        params: threaded,
        fingerprint,
        history,
        omitted: {
          system: inheritedSystem !== undefined && inheritedSystem.length < (params.system as unknown[]).length,
          tools: inherit && params.tools !== undefined,
        },
      }
      return threaded
    },
    recover(error: unknown): boolean {
      if (!prepared || !prepared.params.thread || !(error instanceof APIError) || recoveries >= 2) return false
      const outcome = classify(error)
      if (outcome === 'unsupported_request' || (outcome === 'other_thread_400' && prepared.params.thread.type === 'create')) {
        if (outcome === 'unsupported_request' && error.message.includes(THREAD_BETA)) rejectedSessions.add(session)
        unsupportedModels.add(modelKey)
      } else if (prepared.params.thread.type === 'continue') {
        if (outcome === 'fingerprint_mismatch') {
          if (namesOmittedField(error, prepared.omitted)) fullFieldsSessions.add(session)
        } else if (outcome !== 'not_found' && outcome !== 'already_continued' && outcome !== 'other_thread_400') {
          return false
        }
        forceCreate = true
      } else {
        return false
      }
      recoveries++
      threads.delete(key)
      return true
    },
    complete(messageId: string, response: WireMessage[]): void {
      if (!prepared || !prepared.params.thread || !available()) return
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
