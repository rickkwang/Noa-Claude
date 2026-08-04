// @ts-nocheck
// Auto mode classifier request queue — serializes classifier API calls
// per agent so a burst of tool calls in one turn doesn't fire N concurrent
// classifier requests (rate-limit pressure, unpredictable latency/cost).
//
// Serializing is also what makes prompt caching work across a parallel tool
// batch: concurrent classifier calls can't read each other's cache writes, so
// N parallel requests all miss and all pay a cache write. Queued behind each
// other, request 2..N read the conversation prefix request 1 wrote. Upstream
// Claude Code 2.1.221 made the queue unconditional for exactly this reason
// (it deleted both CLAUDE_CODE_AUTO_MODE_CLASSIFIER_QUEUE and the
// tengu_auto_mode_classifier_queue gate that guarded it in 2.1.220).
//
// Deviation from upstream: the escape hatch is kept, inverted — on by
// default, and NOA_CLAUDE_AUTO_MODE_CLASSIFIER_QUEUE=0 (or legacy
// CLAUDE_CODE_AUTO_MODE_CLASSIFIER_QUEUE=0) forces it off so a suspected
// serialization regression can be bisected without a rebuild.
//
// Serializing adds real wait time (a queued call sits behind a live API
// round-trip), so a permission decision made from a classifier result that
// waited in queue can be stale by the time it resolves — the caller must
// re-check the permission mode after dequeuing before trusting the verdict
// (see the mode_changed_while_queued handling in permissions.ts).

import { getGlobalConfig } from '../config.js'
import { isEnvDefinedFalsy, isEnvTruthy } from '../envUtils.js'

export type ClassifierQueueDequeueInfo = Readonly<{
  queueDepth: number
  queueWaitMs: number
}>

export function isClassifierQueueEnabled(): boolean {
  if (isEnvDefinedFalsy(process.env.NOA_CLAUDE_AUTO_MODE_CLASSIFIER_QUEUE)) {
    return false
  }
  if (isEnvTruthy(process.env.NOA_CLAUDE_AUTO_MODE_CLASSIFIER_QUEUE)) {
    return true
  }
  if (isEnvDefinedFalsy(process.env.CLAUDE_CODE_AUTO_MODE_CLASSIFIER_QUEUE)) {
    return false
  }
  if (isEnvTruthy(process.env.CLAUDE_CODE_AUTO_MODE_CLASSIFIER_QUEUE)) {
    return true
  }
  if (getGlobalConfig().autoModeClassifierQueueEnabled === false) {
    return false
  }
  return true
}

const queueTails = new Map<string, Promise<void>>()
const queueDepths = new Map<string, number>()

/**
 * Runs `task` after every prior call queued under the same `key` has
 * settled — a per-key FIFO serializer. Right before `task()` actually
 * starts, `onDequeue` fires once with the queue depth observed at enqueue
 * time and how long this call waited for its turn.
 */
export function runClassifierQueued<T>(
  key: string,
  task: () => Promise<T>,
  onDequeue?: (info: ClassifierQueueDequeueInfo) => void,
): Promise<T> {
  const queueDepth = queueDepths.get(key) ?? 0
  queueDepths.set(key, queueDepth + 1)
  const enqueuedAt = Date.now()

  const previousTail = queueTails.get(key) ?? Promise.resolve()
  const result = previousTail.then(() => {
    onDequeue?.({ queueDepth, queueWaitMs: Date.now() - enqueuedAt })
    return task()
  })

  // Other callers queued behind this one must wait regardless of whether
  // this call succeeds or fails, so the shared tail never rejects.
  const settledTail = result.then(
    () => undefined,
    () => undefined,
  )
  queueTails.set(key, settledTail)
  settledTail.then(() => {
    if (queueTails.get(key) === settledTail) queueTails.delete(key)
  })

  return result.finally(() => {
    const depth = (queueDepths.get(key) ?? 1) - 1
    if (depth <= 0) queueDepths.delete(key)
    else queueDepths.set(key, depth)
  })
}

/**
 * tool_use ids that have already been the subject of a classifier request.
 *
 * The transcript serializer collapses runs of adjacent blocks into one text
 * block, so the block boundaries of request N+1 only line up with those of
 * request N if the tool_use that request N classified is forced onto its own
 * block. Without that, every new action reshuffles the boundaries and the
 * shared conversation prefix stops matching byte-for-byte at block level —
 * the cache misses even though the text is identical.
 *
 * Session-lifetime and unbounded, matching upstream: entries are tool_use ids
 * (~40 bytes) for actions that actually reached the classifier, which is
 * bounded by the turn count of the session.
 */
const classifiedToolUseIDs = new Set<string>()

export function markToolUseClassified(toolUseID: string): void {
  classifiedToolUseIDs.add(toolUseID)
}

export function wasToolUseClassified(toolUseID: string): boolean {
  return classifiedToolUseIDs.has(toolUseID)
}

export function _resetClassifierQueueForTesting(): void {
  queueTails.clear()
  queueDepths.clear()
  classifiedToolUseIDs.clear()
}
