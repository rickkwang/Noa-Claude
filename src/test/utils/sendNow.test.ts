import { afterEach, describe, expect, test } from 'bun:test'
import { DEFAULT_BINDINGS } from '../../keybindings/defaultBindings.js'
import { parseBindings } from '../../keybindings/parser.js'
import { resolveKeyWithChordState } from '../../keybindings/resolver.js'
import { getSendNowShortcut } from '../../keybindings/sendNowShortcut.js'
import { hasForegroundTasksForToolUses } from '../../tasks/LocalShellTask/LocalShellTask.js'
import type { QueuedCommand } from '../../types/textInputTypes.js'
import {
  enqueue,
  getCommandQueue,
  promoteToNow,
  remove,
  resetCommandQueue,
} from '../../utils/messageQueueManager.js'
import {
  decideSendNow,
  isDeliverableMidTurn,
  SEND_NOW_MAX_BACKGROUND_PASSES,
  SendNowController,
  type SendNowState,
  type SendNowTurnState,
} from '../../utils/sendNow.js'

afterEach(() => resetCommandQueue())

const base: SendNowState = {
  pendingTargets: 1,
  isTurnActive: true,
  isHeldByDialog: false,
  isDeliverableMidTurn: true,
  hasMovableTasks: false,
  isBackgroundingDisabled: false,
  isExecuting: false,
  isSampling: false,
}

describe('decideSendNow', () => {
  test.each([
    ['nothing left to deliver', { pendingTargets: 0 }, { action: 'done' }],
    ['turn ended', { isTurnActive: false }, { action: 'stand_by' }],
    [
      'permission dialog open',
      { isHeldByDialog: true, hasMovableTasks: true },
      { action: 'wait', reason: 'held_by_dialog' },
    ],
    [
      'not deliverable mid-turn: background first so the interrupt is not held',
      { isDeliverableMidTurn: false, hasMovableTasks: true },
      { action: 'background' },
    ],
    [
      'not deliverable mid-turn, nothing to move: interrupt',
      { isDeliverableMidTurn: false, isExecuting: true },
      { action: 'interrupt' },
    ],
    [
      'movable tools are backgrounded, not cancelled',
      { hasMovableTasks: true, isExecuting: true },
      { action: 'background' },
    ],
    [
      'backgrounding disabled never backgrounds',
      { hasMovableTasks: true, isBackgroundingDisabled: true, isExecuting: true },
      { action: 'wait', reason: 'tool_running' },
    ],
    [
      'an unmovable tool is waited out, never interrupted',
      { isExecuting: true, isSampling: true },
      { action: 'wait', reason: 'tool_running' },
    ],
    ['model sampling text interrupts', { isSampling: true }, { action: 'interrupt' }],
    [
      'between states waits',
      {},
      { action: 'wait', reason: 'not_sampling' },
    ],
  ] as const)('%s', (_name, patch, expected) => {
    expect(decideSendNow({ ...base, ...patch })).toEqual(expected)
  })
})

describe('isDeliverableMidTurn', () => {
  const prompt = (value: string): QueuedCommand => ({ value, mode: 'prompt' })
  test('a plain prompt is deliverable', () => {
    const p = prompt('hi')
    expect(isDeliverableMidTurn([p], p)).toBe(true)
  })
  test('slash and bash-mode commands wait for the turn to end', () => {
    const slash = prompt('/compact')
    const bash: QueuedCommand = { value: 'ls', mode: 'bash' }
    expect(isDeliverableMidTurn([slash], slash)).toBe(false)
    expect(isDeliverableMidTurn([bash], bash)).toBe(false)
  })
  test('a prompt queued behind a slash command is held back', () => {
    const slash = prompt('/compact')
    const p = prompt('hi')
    expect(isDeliverableMidTurn([slash, p], p)).toBe(false)
  })
})

describe('promoteToNow', () => {
  test('raises only the given commands, keeping their position', () => {
    enqueue({ value: 'a', mode: 'prompt' })
    enqueue({ value: 'b', mode: 'prompt' })
    const [a] = getCommandQueue()
    expect(promoteToNow([a!])).toBe(true)
    expect(getCommandQueue().map(c => [c.value, c.priority])).toEqual([
      ['a', 'now'],
      ['b', 'next'],
    ])
    expect(promoteToNow([])).toBe(false)
  })
})

function harness(turn: Partial<SendNowTurnState>) {
  const state: SendNowTurnState = {
    isTurnActive: true,
    isHeldByDialog: false,
    hasMovableTasks: false,
    isBackgroundingDisabled: false,
    isExecuting: false,
    isSampling: false,
    ...turn,
  }
  const timers: (() => void)[] = []
  let backgroundCalls = 0
  const controller = new SendNowController({
    getTurnState: () => state,
    backgroundRunningTools: () => {
      backgroundCalls++
    },
    setTimeout: fn => {
      timers.push(fn)
      return () => {
        const i = timers.indexOf(fn)
        if (i !== -1) timers.splice(i, 1)
      }
    },
  })
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) timers.shift()?.()
  }
  return {
    state,
    controller,
    tick,
    pendingTimers: () => timers.length,
    backgroundCalls: () => backgroundCalls,
  }
}

describe('SendNowController', () => {
  test('backgrounds running tools and stops once the prompt is drained', () => {
    enqueue({ value: 'look at this', mode: 'prompt' })
    const h = harness({ hasMovableTasks: true, isExecuting: true })
    expect(h.controller.sendQueuedNow()).toBe(true)
    h.tick()
    expect(h.backgroundCalls()).toBe(1)
    // The tool boundary drains the prompt mid-turn (query.ts removes it).
    h.state.hasMovableTasks = false
    remove(getCommandQueue())
    expect(h.pendingTimers()).toBe(0)
    expect(getCommandQueue()).toEqual([])
  })

  test('waits out an unmovable tool, then backgrounds it once it can move', () => {
    enqueue({ value: 'read this', mode: 'prompt' })
    const h = harness({ isExecuting: true })
    h.controller.sendQueuedNow()
    h.tick(20)
    expect(getCommandQueue()[0]!.priority).toBe('next')
    expect(h.backgroundCalls()).toBe(0)
    // A shell registers as a foreground task after 2 s.
    h.state.hasMovableTasks = true
    h.tick()
    expect(h.backgroundCalls()).toBe(1)
  })

  test('a task that refuses to background cannot pin it in a loop', () => {
    enqueue({ value: 'x', mode: 'prompt' })
    const h = harness({ hasMovableTasks: true, isExecuting: true })
    h.controller.sendQueuedNow()
    h.tick(200)
    expect(h.backgroundCalls()).toBe(SEND_NOW_MAX_BACKGROUND_PASSES)
    expect(getCommandQueue()[0]!.priority).toBe('next')
  })

  test('a slash command backgrounds, then interrupts: it runs after the turn', () => {
    enqueue({ value: '/compact', mode: 'prompt' })
    const h = harness({ hasMovableTasks: true, isExecuting: true })
    h.controller.sendQueuedNow()
    h.tick()
    expect(h.backgroundCalls()).toBe(1)
    expect(getCommandQueue()[0]!.priority).toBe('next')
    h.state.hasMovableTasks = false
    h.tick()
    expect(getCommandQueue()[0]!.priority).toBe('now')
  })

  test('never interrupts while a permission dialog is open', () => {
    enqueue({ value: 'x', mode: 'prompt' })
    const h = harness({ isHeldByDialog: true, isSampling: true })
    h.controller.sendQueuedNow()
    h.tick(50)
    expect(getCommandQueue()[0]!.priority).toBe('next')
    expect(h.pendingTimers()).toBe(1)
  })

  test('interrupts a model that is only streaming text', () => {
    enqueue({ value: 'x', mode: 'prompt' })
    const h = harness({ isSampling: true })
    h.controller.sendQueuedNow()
    h.tick()
    expect(getCommandQueue()[0]!.priority).toBe('now')
  })

  test('does nothing when no turn runs or nothing is queued', () => {
    const idle = harness({ isTurnActive: false })
    enqueue({ value: 'x', mode: 'prompt' })
    expect(idle.controller.sendQueuedNow()).toBe(false)
    resetCommandQueue()
    const empty = harness({})
    expect(empty.controller.sendQueuedNow()).toBe(false)
  })

  test('ignores system-generated queue entries', () => {
    enqueue({ value: 'tick', mode: 'prompt', isMeta: true })
    const h = harness({ isSampling: true })
    expect(h.controller.sendQueuedNow()).toBe(false)
  })

  test('stands by when the turn ends first', () => {
    enqueue({ value: 'x', mode: 'prompt' })
    const h = harness({ isExecuting: true })
    h.controller.sendQueuedNow()
    h.state.isTurnActive = false
    h.tick()
    expect(h.pendingTimers()).toBe(0)
    expect(getCommandQueue()[0]!.priority).toBe('next')
  })
})

describe('chat:sendNow keybindings', () => {
  const bindings = parseBindings(DEFAULT_BINDINGS)
  const key = (k: Record<string, boolean>) =>
    ({ ctrl: false, shift: false, meta: false, super: false, ...k }) as never

  test('ctrl+enter sends now', () => {
    const r = resolveKeyWithChordState('\r', key({ ctrl: true, return: true }), ['Chat'], bindings, null)
    expect(r).toEqual({ type: 'match', action: 'chat:sendNow' })
  })

  test('ctrl+x ctrl+s sends now; ctrl+s alone still stashes', () => {
    const first = resolveKeyWithChordState('x', key({ ctrl: true }), ['Chat'], bindings, null)
    expect(first.type).toBe('chord_started')
    const pending = (first as unknown as { pending: never }).pending
    expect(
      resolveKeyWithChordState('s', key({ ctrl: true }), ['Chat'], bindings, pending),
    ).toEqual({ type: 'match', action: 'chat:sendNow' })
    expect(
      resolveKeyWithChordState('s', key({ ctrl: true }), ['Chat'], bindings, null),
    ).toEqual({ type: 'match', action: 'chat:stash' })
  })

  test('plain enter still submits', () => {
    expect(
      resolveKeyWithChordState('\r', key({ return: true }), ['Chat'], bindings, null),
    ).toEqual({ type: 'match', action: 'chat:submit' })
  })

  test('the hint shows a chord the terminal can deliver', () => {
    expect(getSendNowShortcut(bindings, true)).toBe('ctrl+enter')
    expect(getSendNowShortcut(bindings, false)).toBe('ctrl+x ctrl+s')
    expect(getSendNowShortcut([], true)).toBe('')
  })
})

describe('send-now background scope', () => {
  const shell = (patch: object) => ({
    type: 'local_bash',
    status: 'running',
    isBackgrounded: false,
    shellCommand: {},
    toolUseId: 'tu_main',
    ...patch,
  })
  const agent = (patch: object) => ({
    type: 'local_agent',
    agentType: 'general-purpose',
    status: 'running',
    isBackgrounded: false,
    toolUseId: 'tu_main',
    ...patch,
  })
  const has = (tasks: Record<string, object>) =>
    hasForegroundTasksForToolUses({ tasks } as never, new Set(['tu_main']))

  test("moves the turn's own shell and subagent", () => {
    expect(has({ a: shell({}) })).toBe(true)
    expect(has({ a: agent({}) })).toBe(true)
  })

  test('leaves other work alone', () => {
    expect(has({ a: shell({ toolUseId: 'tu_other' }) })).toBe(false)
    expect(has({ a: shell({ agentId: 'agent-1' }) })).toBe(false)
    expect(has({ a: shell({ isBackgrounded: true }) })).toBe(false)
    expect(has({ a: shell({ shellCommand: null }) })).toBe(false)
    expect(has({ a: agent({ toolUseId: undefined }) })).toBe(false)
    expect(has({ a: agent({ status: 'completed' }) })).toBe(false)
  })
})
