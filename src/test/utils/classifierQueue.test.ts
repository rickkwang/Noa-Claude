import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  _resetClassifierQueueForTesting,
  isClassifierQueueEnabled,
  runClassifierQueued,
} from '../../utils/permissions/classifierQueue.js'

const originalNoaEnv = process.env.NOA_CLAUDE_AUTO_MODE_CLASSIFIER_QUEUE
const originalLegacyEnv = process.env.CLAUDE_CODE_AUTO_MODE_CLASSIFIER_QUEUE

describe('classifierQueue', () => {
  beforeEach(() => {
    _resetClassifierQueueForTesting()
  })

  afterEach(() => {
    if (originalNoaEnv === undefined) {
      delete process.env.NOA_CLAUDE_AUTO_MODE_CLASSIFIER_QUEUE
    } else {
      process.env.NOA_CLAUDE_AUTO_MODE_CLASSIFIER_QUEUE = originalNoaEnv
    }
    if (originalLegacyEnv === undefined) {
      delete process.env.CLAUDE_CODE_AUTO_MODE_CLASSIFIER_QUEUE
    } else {
      process.env.CLAUDE_CODE_AUTO_MODE_CLASSIFIER_QUEUE = originalLegacyEnv
    }
  })

  test('is disabled by default', () => {
    delete process.env.NOA_CLAUDE_AUTO_MODE_CLASSIFIER_QUEUE
    delete process.env.CLAUDE_CODE_AUTO_MODE_CLASSIFIER_QUEUE
    expect(isClassifierQueueEnabled()).toBe(false)
  })

  test('legacy CLAUDE_CODE_ env var enables it', () => {
    delete process.env.NOA_CLAUDE_AUTO_MODE_CLASSIFIER_QUEUE
    process.env.CLAUDE_CODE_AUTO_MODE_CLASSIFIER_QUEUE = 'true'
    expect(isClassifierQueueEnabled()).toBe(true)
  })

  test('serializes calls under the same key in enqueue order', async () => {
    const order: number[] = []
    const releases: Array<() => void> = []

    const makeTask = (id: number) => () =>
      new Promise<void>(resolve => {
        releases.push(() => {
          order.push(id)
          resolve()
        })
      })

    const p1 = runClassifierQueued('agent-1', makeTask(1))
    const p2 = runClassifierQueued('agent-1', makeTask(2))
    const p3 = runClassifierQueued('agent-1', makeTask(3))

    // Only the first task should have started — its release callback is
    // the only one queued so far.
    await Promise.resolve()
    await Promise.resolve()
    expect(releases.length).toBe(1)

    releases[0]!()
    await p1
    await Promise.resolve()
    expect(releases.length).toBe(2)

    releases[1]!()
    await p2
    await Promise.resolve()
    expect(releases.length).toBe(3)

    releases[2]!()
    await p3

    expect(order).toEqual([1, 2, 3])
  })

  test('different keys run concurrently, not serialized', async () => {
    let concurrent = 0
    let maxConcurrent = 0

    const task = () => async () => {
      concurrent++
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await new Promise(resolve => setTimeout(resolve, 5))
      concurrent--
    }

    await Promise.all([
      runClassifierQueued('agent-a', task()),
      runClassifierQueued('agent-b', task()),
    ])

    expect(maxConcurrent).toBe(2)
  })

  test('reports queue depth and wait time on dequeue', async () => {
    const dequeueInfos: Array<{ queueDepth: number; queueWaitMs: number }> = []
    let releaseFirst: () => void = () => {}
    const first = runClassifierQueued(
      'agent-1',
      () => new Promise<void>(resolve => (releaseFirst = resolve)),
      info => dequeueInfos.push(info),
    )
    const second = runClassifierQueued(
      'agent-1',
      () => Promise.resolve(),
      info => dequeueInfos.push(info),
    )

    await Promise.resolve()
    expect(dequeueInfos).toHaveLength(1)
    expect(dequeueInfos[0]!.queueDepth).toBe(0)

    releaseFirst()
    await first
    await second

    expect(dequeueInfos).toHaveLength(2)
    expect(dequeueInfos[1]!.queueDepth).toBe(1)
    expect(dequeueInfos[1]!.queueWaitMs).toBeGreaterThanOrEqual(0)
  })

  test('a rejected task does not poison the queue for later callers', async () => {
    const p1 = runClassifierQueued('agent-1', () =>
      Promise.reject(new Error('boom')),
    )
    const p2 = runClassifierQueued('agent-1', () => Promise.resolve('ok'))

    await expect(p1).rejects.toThrow('boom')
    await expect(p2).resolves.toBe('ok')
  })
})
