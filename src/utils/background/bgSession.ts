/**
 * The session side of a background job: a session started by dispatch.ts
 * reports what it is doing into its job record.
 */
import type { Tools } from '../../Tool.js'
import { findToolByName } from '../../Tool.js'
import type { Message } from '../../types/message.js'
import { logForDebugging } from '../debug.js'
import { errorMessage } from '../errors.js'
import { getUserMessageText } from '../messages.js'
import { getBgJobShort } from './bgJob.js'
import { IDLE_DETAIL, IDLE_NEEDS, patchJob, readJob, type JobRecord } from './jobs.js'

export type BgActivity = {
  status: 'busy' | 'waiting' | 'idle'
  waitingFor?: string
  /** What the current turn is doing (tool activity). */
  detail?: string
  /** First line of the last assistant reply. */
  result?: string
  /** The last turn ended on an API error (rate limit, auth…). */
  error?: string
  /** Session title from /rename. */
  title?: string
  /** First user prompt, for naming an untitled session. */
  firstPrompt?: string
}

function firstLine(text: string, max = 200): string {
  const line = text.trim().split('\n').find(l => l.trim()) ?? ''
  return line.length > max ? `${line.slice(0, max - 1)}…` : line.trim()
}

export function deriveBgActivity(
  messages: readonly Message[],
  tools: Tools,
): Omit<BgActivity, 'status' | 'waitingFor' | 'title'> {
  let detail: string | undefined
  let result: string | undefined
  let error: string | undefined
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    if (m.type !== 'assistant') continue
    const content = Array.isArray(m.message?.content) ? m.message.content : []
    if (detail === undefined) {
      const last = content.at(-1)
      if (last?.type === 'tool_use') {
        const tool = findToolByName(tools, last.name)
        detail =
          tool?.getActivityDescription?.(last.input as never) ??
          tool?.userFacingName(last.input as never) ??
          last.name
      } else {
        detail = ''
      }
    }
    const text = content
      .filter(b => b.type === 'text')
      .map(b => (b as { text: string }).text)
      .join('\n')
    if (text.trim()) {
      if (m.isApiErrorMessage) error = firstLine(text)
      else result = firstLine(text)
      break
    }
  }

  let firstPrompt: string | undefined
  for (const m of messages) {
    if (m.type !== 'user' || m.isMeta) continue
    const text = getUserMessageText(m)?.trim()
    if (!text || text.startsWith('<')) continue
    firstPrompt = firstLine(text, 60)
    break
  }

  return {
    detail: detail || undefined,
    result,
    error,
    firstPrompt,
  }
}

/**
 * Whether a turn has run in this process. A conversation moved here by
 * /background, or resumed after the session exited, has history but waits
 * for its next prompt — it belongs under Needs input, not Completed.
 */
let ranTurn = false

function toPatch(a: BgActivity, current: JobRecord): Partial<JobRecord> {
  const patch: Partial<JobRecord> = {}
  if (a.title && (current.name !== a.title || current.nameSource !== 'user')) {
    patch.name = a.title
    patch.nameSource = 'user'
  } else if (!current.name && a.firstPrompt) {
    patch.name = a.firstPrompt
    patch.nameSource = 'auto'
  }

  if (a.status === 'busy') {
    Object.assign(patch, {
      state: 'working',
      tempo: 'active',
      needs: undefined,
      detail: a.detail ?? 'working…',
    })
  } else if (a.status === 'waiting') {
    const needs = a.waitingFor ?? 'input needed'
    Object.assign(patch, { state: 'blocked', tempo: 'blocked', needs, detail: needs })
  } else if (a.error) {
    Object.assign(patch, {
      state: 'blocked',
      tempo: 'blocked',
      needs: a.error,
      detail: a.error,
    })
  } else if (!ranTurn) {
    Object.assign(patch, {
      state: 'blocked',
      tempo: 'blocked',
      needs: IDLE_NEEDS,
      // A moved conversation shows where it left off.
      detail: a.result ?? IDLE_DETAIL,
    })
  } else {
    Object.assign(patch, {
      state: 'done',
      tempo: 'idle',
      needs: undefined,
      detail: a.result ?? 'done',
      output: a.result ? { result: a.result } : current.output,
    })
  }
  return patch
}

let lastWritten = ''
let queued: BgActivity | null = null
let writing = false

/**
 * Push this session's activity into its job record. Coalesces bursts
 * (streaming re-renders) and skips writes that change nothing.
 */
export function reportBgActivity(activity: BgActivity): void {
  const jobShort = getBgJobShort()
  if (!jobShort) return
  if (activity.status === 'busy') ranTurn = true
  queued = activity
  if (writing) return
  writing = true
  void (async () => {
    try {
      while (queued) {
        const next = queued
        queued = null
        const current = await readJob(jobShort)
        if (!current) return
        const patch = toPatch(next, current)
        const key = JSON.stringify(patch)
        if (key === lastWritten) continue
        lastWritten = key
        await patchJob(jobShort, patch)
      }
    } catch (e) {
      logForDebugging(`[bgSession] report failed: ${errorMessage(e)}`)
    } finally {
      writing = false
    }
  })()
}
