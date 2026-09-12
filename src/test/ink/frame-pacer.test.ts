import { describe, expect, test } from 'bun:test'
import { FramePacer } from '../../ink/frame-pacer.js'
import {
  FRAME_INTERVAL_MS,
  INPUT_PRIORITY_FRAME_INTERVAL_MS,
} from '../../ink/constants.js'

// The pacer injects its clock and timer queue, so these tests are
// deterministic: advance() moves a manual clock, firing any timer that comes
// due and draining the microtask queue after each fire.
function makePacer() {
  let now = 0
  let nextTimerId = 1
  const timers: { id: number; dueAt: number; fire: () => void }[] = []
  const microtasks: (() => void)[] = []
  const frames: number[] = []

  const flushMicrotasks = () => {
    while (microtasks.length > 0) microtasks.shift()!()
  }

  const pacer = new FramePacer(() => frames.push(now), {
    now: () => now,
    setTimeoutFn: ((fn: () => void, ms?: number) => {
      const id = nextTimerId++
      timers.push({ id, dueAt: now + (ms ?? 0), fire: fn })
      return id
    }) as unknown as typeof setTimeout,
    clearTimeoutFn: ((id: number) => {
      const i = timers.findIndex(t => t.id === id)
      if (i >= 0) timers.splice(i, 1)
    }) as unknown as typeof clearTimeout,
    queueMicrotaskFn: (fn: () => void) => microtasks.push(fn),
  })

  const advance = (ms: number) => {
    const target = now + ms
    for (;;) {
      const due = timers
        .filter(t => t.dueAt <= target)
        .sort((a, b) => a.dueAt - b.dueAt)[0]
      if (!due) break
      now = due.dueAt
      timers.splice(timers.indexOf(due), 1)
      due.fire()
      flushMicrotasks()
    }
    now = target
    flushMicrotasks()
  }

  return { pacer, frames, advance, flushMicrotasks, pendingTimers: () => timers.length }
}

describe('FramePacer', () => {
  test('first frame renders on a microtask, no timer', () => {
    const { pacer, frames, flushMicrotasks, pendingTimers } = makePacer()
    pacer.schedule()
    expect(frames).toEqual([]) // not synchronous — layout effects commit first
    expect(pendingTimers()).toBe(0)
    flushMicrotasks()
    expect(frames).toEqual([0])
  })

  test('repeated schedules within one frame coalesce to a single paint', () => {
    const { pacer, frames, flushMicrotasks, pendingTimers } = makePacer()
    pacer.schedule()
    pacer.schedule()
    pacer.schedule()
    flushMicrotasks()
    expect(frames).toEqual([0])
    expect(pendingTimers()).toBe(0)
  })

  test('steady cadence is FRAME_INTERVAL_MS; rescheduling does not postpone', () => {
    const { pacer, frames, advance, flushMicrotasks } = makePacer()
    pacer.schedule()
    flushMicrotasks()
    expect(frames).toEqual([0])

    pacer.schedule() // arms a timer due at 16
    advance(6)
    pacer.schedule() // due is still 16, not 22
    advance(FRAME_INTERVAL_MS - 6 - 1)
    expect(frames).toEqual([0])
    advance(1)
    expect(frames).toEqual([0, 16])

    pacer.schedule()
    advance(FRAME_INTERVAL_MS)
    expect(frames).toEqual([0, 16, 32])
  })

  test('a keystroke re-arms the pending frame at the short interval', () => {
    const { pacer, frames, advance, flushMicrotasks, pendingTimers } = makePacer()
    pacer.schedule()
    flushMicrotasks() // frame at 0
    pacer.schedule() // timer due at 16
    advance(2)
    pacer.requestInputPriorityFrame()
    pacer.schedule() // elapsed 2 < 4 → re-arm due at 0 + 4
    expect(pendingTimers()).toBe(1) // re-armed, not stacked
    advance(INPUT_PRIORITY_FRAME_INTERVAL_MS - 2 - 1)
    expect(frames).toEqual([0])
    advance(1)
    expect(frames).toEqual([0, 4])
  })

  test('the priority window buys one frame, then cadence returns to normal', () => {
    const { pacer, frames, advance, flushMicrotasks } = makePacer()
    pacer.schedule()
    flushMicrotasks() // frame at 0
    pacer.requestInputPriorityFrame()
    pacer.schedule()
    advance(INPUT_PRIORITY_FRAME_INTERVAL_MS)
    expect(frames).toEqual([0, 4]) // boosted frame consumed the window

    pacer.schedule() // back to 16ms: due at 20, not 8
    advance(FRAME_INTERVAL_MS - 1)
    expect(frames).toEqual([0, 4])
    advance(1)
    expect(frames).toEqual([0, 4, 20])
  })

  test('an expired priority window does not shorten the wait', () => {
    const { pacer, frames, advance, flushMicrotasks } = makePacer()
    pacer.schedule()
    flushMicrotasks() // frame at 0
    pacer.requestInputPriorityFrame() // window open until t=50, never used
    advance(51)
    pacer.schedule()
    flushMicrotasks() // frame at 51; window has lapsed

    pacer.schedule() // normal cadence: due at 67. With a stuck window: 55.
    advance(INPUT_PRIORITY_FRAME_INTERVAL_MS)
    expect(frames).toEqual([0, 51]) // not fired at 55 → window really expired
    advance(FRAME_INTERVAL_MS - INPUT_PRIORITY_FRAME_INTERVAL_MS)
    expect(frames).toEqual([0, 51, 67])
  })

  test('cancel drops the pending frame', () => {
    const { pacer, frames, advance, flushMicrotasks, pendingTimers } = makePacer()
    pacer.schedule()
    flushMicrotasks()
    pacer.schedule()
    expect(pendingTimers()).toBe(1)
    pacer.cancel()
    expect(pendingTimers()).toBe(0)
    advance(50)
    expect(frames).toEqual([0])
  })
})
