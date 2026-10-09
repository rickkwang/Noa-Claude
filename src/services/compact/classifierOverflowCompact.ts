// Auto-mode classifier overflow. When the classifier's transcript outgrows its
// window, the call is denied and recorded here. The next auto-compact attempt
// (same conversation epoch, same mode) compacts the main conversation and tells
// the model which calls did not run, so they can be issued again.
//
// The epoch is the first message's uuid, which changes whenever compaction
// rewrites the head of the conversation: a record from before a compaction is
// stale and dropped.

import type { Message } from '../../types/message.js'

export type PendingOverflow = {
  epoch: string
  mode: string
  deniedToolNames: string[]
}

type OverflowState = {
  canCompact: boolean
  // Epoch of the last compaction this record drove, so a denial that happened
  // before that compaction is not recorded again.
  spentEpoch?: string
  pending?: PendingOverflow
}

const statesByAgent = new Map<string, OverflowState>()

function keyOf(agentId: string | undefined): string {
  return agentId ?? 'main'
}

function epochOf(messages: readonly Message[]): string | undefined {
  return messages[0]?.uuid
}

/** Called on every auto-compact check: whether this query may compact at all. */
export function noteOverflowCanCompact(
  agentId: string | undefined,
  canCompact: boolean,
): void {
  const key = keyOf(agentId)
  statesByAgent.set(key, { ...statesByAgent.get(key), canCompact })
}

/**
 * Records a classifier overflow for the denied call. Returns whether a record
 * now exists for this epoch, which decides the denial message.
 */
export function recordOverflowDenial(args: {
  messages: readonly Message[]
  agentId: string | undefined
  mode: string
  toolName: string
  denied: boolean
}): boolean {
  const epoch = epochOf(args.messages)
  const key = keyOf(args.agentId)
  const state = statesByAgent.get(key)
  if (epoch === undefined || state?.canCompact !== true) return false
  if (state.spentEpoch === epoch) return false
  const existing = state.pending?.epoch === epoch ? state.pending : undefined
  const base: PendingOverflow = existing ?? {
    epoch,
    mode: args.mode,
    deniedToolNames: [],
  }
  statesByAgent.set(key, {
    ...state,
    pending: args.denied
      ? { ...base, deniedToolNames: [...base.deniedToolNames, args.toolName] }
      : base,
  })
  return true
}

/**
 * Takes the pending record for this compaction attempt, or undefined when there
 * is none or it no longer applies. A record that does not apply is cleared.
 */
export function takeOverflow(args: {
  messages: readonly Message[]
  agentId: string | undefined
  mode: string
  canCompact: boolean
}): PendingOverflow | undefined {
  const key = keyOf(args.agentId)
  const state = statesByAgent.get(key)
  const pending = state?.pending
  if (state === undefined || pending === undefined) return undefined
  const stale =
    pending.epoch !== epochOf(args.messages) ||
    (pending.mode !== args.mode &&
      args.mode !== 'auto' &&
      args.mode !== 'dontAsk')
  if (stale || !args.canCompact) {
    settleOverflow(args.agentId, pending, false)
    return undefined
  }
  return pending
}

/**
 * Clears the record once the attempt it drove has finished. An aborted attempt
 * keeps the record so the next attempt can still run it.
 */
export function settleOverflow(
  agentId: string | undefined,
  pending: PendingOverflow,
  aborted: boolean,
): void {
  if (aborted) return
  const key = keyOf(agentId)
  const state = statesByAgent.get(key)
  if (state === undefined) return
  statesByAgent.set(key, {
    ...state,
    pending: undefined,
    spentEpoch: pending.epoch,
  })
}

export function overflowReminderText(deniedToolNames: readonly string[]): string {
  const count = deniedToolNames.length
  if (count === 0) {
    return "The conversation was compacted because it had become too long for auto mode's classifier."
  }
  const names = deniedToolNames.join(', ')
  if (count === 1) {
    return `Auto mode could not review an earlier tool call (${names}) because the conversation was too long for its classifier, so that call did not run. The conversation has now been compacted. If still needed, issue it again and it will be reviewed normally.`
  }
  return `Auto mode could not review ${count} earlier tool calls (${names}) because the conversation was too long for its classifier, so those calls did not run. The conversation has now been compacted. If still needed, issue them again and they will be reviewed normally.`
}
