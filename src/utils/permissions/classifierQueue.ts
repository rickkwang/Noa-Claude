// @ts-nocheck
// Auto mode classifier request queue — serializes classifier API calls
// per agent so a burst of tool calls in one turn doesn't fire N concurrent
// classifier requests (rate-limit pressure, unpredictable latency/cost).
// Mirrors upstream Claude Code 2.1.218's classifier queue (env
// CLAUDE_CODE_AUTO_MODE_CLASSIFIER_QUEUE / gate tengu_auto_mode_classifier_queue,
// default off). Off by default here too — set
// NOA_CLAUDE_AUTO_MODE_CLASSIFIER_QUEUE (or legacy
// CLAUDE_CODE_AUTO_MODE_CLASSIFIER_QUEUE) or config
// autoModeClassifierQueueEnabled to enable.
//
// Serializing adds real wait time (a queued call sits behind a live API
// round-trip), so a permission decision made from a classifier result that
// waited in queue can be stale by the time it resolves — the caller must
// re-check the permission mode after dequeuing before trusting the verdict
// (see the mode_changed_while_queued handling in permissions.ts).

import { getGlobalConfig } from '../config.js'
import { isEnvTruthy } from '../envUtils.js'

export type ClassifierQueueDequeueInfo = Readonly<{
  queueDepth: number
  queueWaitMs: number
}>

export function isClassifierQueueEnabled(): boolean {
  if (isEnvTruthy(process.env.NOA_CLAUDE_AUTO_MODE_CLASSIFIER_QUEUE)) {
    return true
  }
  if (isEnvTruthy(process.env.CLAUDE_CODE_AUTO_MODE_CLASSIFIER_QUEUE)) {
    return true
  }
  return getGlobalConfig().autoModeClassifierQueueEnabled === true
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

export function _resetClassifierQueueForTesting(): void {
  queueTails.clear()
  queueDepths.clear()
}
