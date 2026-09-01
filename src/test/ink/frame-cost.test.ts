import { afterEach, expect, test } from 'bun:test'
import {
  reportFrameCost,
  resetFrameCost,
  setFramePressureListener,
} from '../../ink/frame-cost.js'

let events: boolean[] = []
let unsub: (() => void) | undefined

afterEach(() => {
  unsub?.()
  unsub = undefined
  events = []
  resetFrameCost()
})

function listen(): void {
  unsub = setFramePressureListener(p => events.push(p))
  events = [] // ignore the initial state replay
}

/** Feed a steady stream of frames at the given cost until pressure settles. */
function steadyFrames(costMs: number, count = 60): void {
  for (let i = 0; i < count; i++) reportFrameCost(costMs)
}

test('cheap frames never trip backpressure', () => {
  listen()
  steadyFrames(4)
  expect(events).toEqual([])
})

test('sustained expensive frames raise pressure, cheap frames recover', () => {
  listen()
  steadyFrames(20)
  expect(events).toEqual([true])
  steadyFrames(2)
  expect(events).toEqual([true, false])
})

test('a single expensive frame does not trip (EMA smoothing)', () => {
  listen()
  steadyFrames(2, 30)
  reportFrameCost(80)
  steadyFrames(2, 5)
  expect(events).toEqual([])
})

test('hysteresis: pressure holds until cost drops below recover threshold', () => {
  listen()
  steadyFrames(20)
  expect(events).toEqual([true])
  // 10ms sits between OVER_BUDGET (12) and RECOVER (8): EMA decays toward 10
  // but pressure must hold.
  steadyFrames(10)
  expect(events).toEqual([true])
  steadyFrames(2)
  expect(events).toEqual([true, false])
})

test('listener unsubscribe stops notifications', () => {
  listen()
  unsub!()
  steadyFrames(20)
  expect(events).toEqual([])
})

test('subscribe replays latched pressure state', () => {
  steadyFrames(20) // latch pressure with no listener attached
  const replayed: boolean[] = []
  const off = setFramePressureListener(p => replayed.push(p))
  expect(replayed).toEqual([true])
  off()
})
