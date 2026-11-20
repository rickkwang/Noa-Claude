// Session-only cron jobs and the pending dynamic /loop wakeup live in memory,
// so resuming a session rebuilds them from its transcript.
import {
  addSessionCronTask,
  getSessionCronTasks,
  removeSessionCronTasks,
  setScheduledTasksEnabled,
} from '../bootstrap/state.js'
import type { Message } from '../types/message.js'
import { createAttachmentMessage, type Attachment } from './attachments.js'
import { removeByFilter } from './messageQueueManager.js'
import { getCronJitterConfig } from './cronJitterConfig.js'
import {
  LOOP_WAKEUP_MAX_DELAY_S,
  nextCronRunMs,
  oneShotJitteredNextCronRunMs,
  restoreLoopWakeup,
} from './cronTasks.js'
import { logForDebugging } from './debug.js'
import { formatDuration } from './format.js'
import {
  createSystemMessage,
  createUserMessage,
  wrapMessagesInSystemReminder,
} from './messages.js'

type Call = { name: string; input: Record<string, unknown>; at: number; index: number }
type Carry = Extract<Attachment, { type: 'session_cron_carry' }>

/** The main session's in-memory jobs and pending wakeup, for compaction. */
export function createSessionCronCarry(
  messages: readonly Message[] = [],
  stoppedIds: string[] = [],
  stoppedLoopAt?: number,
): Carry | null {
  const previous = messages.findLast(m => m.type === 'attachment' && m.attachment.type === 'session_cron_carry')
  const prior = previous?.type === 'attachment' ? previous.attachment as Carry : undefined
  const ended = [...new Set([...(prior?.ended ?? []), ...stoppedIds])]
  const loopStoppedAt = stoppedLoopAt ?? prior?.loopStoppedAt
  const own = getSessionCronTasks().filter(t => t.agentId === undefined)
  const tasks = own
    .filter(t => t.kind === undefined)
    .map(t => ({
      id: t.id,
      cron: t.cron,
      prompt: t.prompt,
      createdAt: t.createdAt,
      recurring: t.recurring === true,
    }))
  const loop = own.find(t => t.kind === 'loop')
  const scheduledFor = loop ? nextCronRunMs(loop.cron, loop.createdAt) : null
  const wakeup =
    loop && scheduledFor !== null
      ? { prompt: loop.prompt, scheduledFor }
      : undefined
  if (tasks.length === 0 && !wakeup && ended.length === 0 && loopStoppedAt === undefined) return null
  return {
    type: 'session_cron_carry', tasks,
    ...(wakeup && { wakeup }),
    ...(ended.length > 0 && { ended }),
    ...(loopStoppedAt !== undefined && { loopStoppedAt }),
  }
}

export function stopSessionCronTasks(
  ids: string[],
  setMessages: (update: (messages: Message[]) => Message[]) => void,
): Message[] | undefined {
  const tasks = getSessionCronTasks().filter(task => ids.includes(task.id))
  if (!tasks.length) return
  const stoppedIds = tasks.map(task => task.id)
  const stoppedLoopAt = tasks.some(task => task.kind === 'loop') ? Date.now() : undefined
  removeSessionCronTasks(stoppedIds)
  removeByFilter(command => command.scheduledTaskId !== undefined && stoppedIds.includes(command.scheduledTaskId))
  let updated: Message[] | undefined
  setMessages(messages => {
    const carry = createSessionCronCarry(messages, stoppedIds, stoppedLoopAt)!
    return updated = [...messages, createAttachmentMessage(carry)]
  })
  return updated
}

export type MissedLoopWakeup = { prompt: string; scheduledFor: number }

/**
 * Returns the /loop wakeup that fell due while the session was closed; it is
 * not restored, and the caller tells the user and the model it will not fire.
 */
export function restoreScheduledTasksFromMessages(
  messages: Message[],
  nowMs = Date.now(),
): MissedLoopWakeup | undefined {
  const calls = new Map<string, Call>()
  const results = new Map<string, Record<string, unknown>>()
  let lastInterruptIndex = -1
  // Last time a /loop wakeup re-entered the loop, so a fired wakeup is not
  // mistaken for a missed one.
  let lastLoopEntryIndex = -1
  let carry: { attachment: Carry; at: number; index: number } | undefined
  messages.forEach((m, index) => {
    if (m.type === 'attachment' && m.attachment?.type === 'session_cron_carry') {
      carry = { attachment: m.attachment, at: new Date(m.timestamp).getTime(), index }
      return
    }
    if (m.type === 'system' && m.subtype === 'scheduled_task_fire')
      lastLoopEntryIndex = index
    if (
      m.type === 'user' &&
      typeof m.message?.content === 'string' &&
      m.message.content.includes('<command-name>/loop</command-name>')
    )
      lastLoopEntryIndex = index
    const content = Array.isArray(m.message?.content) ? m.message.content : []
    if (m.type === 'assistant') {
      for (const b of content) {
        if (b?.type === 'tool_use' && typeof b.id === 'string')
          calls.set(b.id, {
            name: b.name,
            input: (b.input ?? {}) as Record<string, unknown>,
            at: new Date(m.timestamp).getTime(),
            index,
          })
      }
    } else if (m.type === 'user') {
      const toolResults = content.filter(b => b?.type === 'tool_result')
      // toolUseResult belongs to the message's only tool_result.
      if (
        toolResults.length === 1 &&
        !toolResults[0].is_error &&
        m.toolUseResult &&
        typeof m.toolUseResult === 'object'
      )
        results.set(
          toolResults[0].tool_use_id,
          m.toolUseResult as Record<string, unknown>,
        )
      if (
        content.some(
          b =>
            b?.type === 'text' &&
            typeof b.text === 'string' &&
            b.text.startsWith('[Request interrupted by user'),
        )
      )
        lastInterruptIndex = index
    }
  })

  // Jobs carried across the last compaction look like the calls that made them.
  for (const t of carry?.attachment.tasks ?? []) {
    const id = `carried:${t.id}`
    calls.set(id, {
      name: 'CronCreate',
      input: { cron: t.cron, prompt: t.prompt },
      at: t.createdAt,
      index: carry!.index,
    })
    results.set(id, { id: t.id, recurring: t.recurring, durable: false })
  }

  const cfg = getCronJitterConfig()
  const present = new Set(getSessionCronTasks().map(t => t.id))
  const deleted = new Set(carry?.attachment.ended ?? [])
  for (const [id, call] of calls)
    if (call.name === 'CronDelete' && results.has(id))
      deleted.add(String(results.get(id)!.id))

  let restored = 0
  for (const [toolUseId, call] of calls) {
    if (call.name !== 'CronCreate') continue
    const result = results.get(toolUseId)
    const { cron, prompt } = call.input
    if (!result || typeof result.id !== 'string' || result.durable === true)
      continue
    if (typeof cron !== 'string' || typeof prompt !== 'string') continue
    if (deleted.has(result.id) || present.has(result.id)) continue
    const recurring = result.recurring !== false
    if (recurring) {
      if (nowMs - call.at >= cfg.recurringMaxAgeMs) continue
    } else {
      const next = oneShotJitteredNextCronRunMs(cron, call.at, result.id, cfg)
      if (next === null || next < nowMs) continue
    }
    addSessionCronTask({
      id: result.id,
      cron,
      prompt,
      createdAt: call.at,
      // Count the next run from now, so the downtime does not fire at once.
      ...(recurring ? { recurring: true, lastFiredAt: nowMs } : {}),
    })
    // A job can appear both as its CronCreate call and in a later carry.
    present.add(result.id)
    restored++
  }

  // Only the last wakeup can still be pending; one the user interrupted
  // afterwards was cancelled by that Esc. A wakeup carried across compaction
  // counts unless a ScheduleWakeup call came after it.
  const wakeups = [...calls.entries()].filter(
    ([id, c]) => c.name === 'ScheduleWakeup' && results.has(id),
  )
  const [lastId, last] = wakeups.at(-1) ?? []
  let pending:
    | { prompt: string; scheduledFor: number; index: number; chainStart: number }
    | undefined
  if (last && (!carry || last.index > carry.index)) {
    const wake = results.get(lastId!)!
    if (
      last.at > (carry?.attachment.loopStoppedAt ?? -Infinity) &&
      wake.stopped !== true &&
      typeof wake.scheduledFor === 'number' &&
      typeof last.input.prompt === 'string'
    ) {
      const prompt = last.input.prompt
      // Walk back only through this run of the loop: an earlier wakeup belongs
      // to it when the next call came within the maximum delay of its fire
      // time, the same rule scheduleLoopWakeup uses to continue a chain.
      let chainStart = last.at
      let laterAt = last.at
      for (let i = wakeups.length - 2; i >= 0; i--) {
        const [id, c] = wakeups[i]!
        const firedAt = results.get(id)!.scheduledFor
        if (c.input.prompt !== prompt || typeof firedAt !== 'number') break
        if (laterAt > firedAt + LOOP_WAKEUP_MAX_DELAY_S * 1000) break
        chainStart = c.at
        laterAt = c.at
      }
      pending = { prompt, scheduledFor: wake.scheduledFor, index: last.index, chainStart }
    }
  } else if (carry?.attachment.wakeup) {
    pending = { ...carry.attachment.wakeup, index: carry.index, chainStart: carry.at }
  }
  let missed: MissedLoopWakeup | undefined
  if (pending && pending.index > lastInterruptIndex) {
    if (pending.scheduledFor > nowMs) {
      restoreLoopWakeup(pending.scheduledFor, pending.prompt, pending.chainStart, nowMs)
      restored++
    } else if (pending.index > lastLoopEntryIndex) {
      missed = { prompt: pending.prompt, scheduledFor: pending.scheduledFor }
    }
  }

  if (restored > 0) {
    setScheduledTasksEnabled(true)
    logForDebugging(`[ScheduledTasks] restored ${restored} task(s) on resume`)
  }
  return missed
}

/** A notice for the user and a reminder for the model's next turn. */
export function createMissedLoopWakeupMessages(
  missed: MissedLoopWakeup,
  nowMs = Date.now(),
): Message[] {
  const late = nowMs - missed.scheduledFor
  const ago = late < 60_000 ? 'less than a minute' : formatDuration(late)
  return [
    createSystemMessage(
      `This session resumed ${ago} after its next /loop wakeup was due, so that wakeup will not fire. The loop stays stopped until Claude schedules it again: reply to continue it.`,
      'warning',
    ),
    ...wrapMessagesInSystemReminder([
      createUserMessage({
        content: `The dynamic /loop wakeup for \`${missed.prompt}\` was still pending when this session's previous process ended, and its fire time passed before the session resumed. It will not fire, and nothing wakes this session for the loop: call ScheduleWakeup again only if the loop is still wanted, and when the conversation does not make that clear, ask the user first.`,
        isMeta: true,
      }),
    ]),
  ]
}
