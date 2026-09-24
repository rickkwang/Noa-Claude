import type { QueuedCommand } from '../types/textInputTypes.js'
import { logForDebugging } from './debug.js'
import {
  getCommandQueue,
  isQueuedCommandEditable,
  isSlashCommand,
  promoteToNow,
  subscribeToCommandQueue,
} from './messageQueueManager.js'

/**
 * "Send now" (chat:sendNow) while a turn is running: get the queued input to
 * the model without cancelling the turn when possible.
 *
 * Queued input is already drained mid-turn at the next tool boundary
 * (query.ts). What delays it is a long-running tool, so the move is to
 * background the foreground shells and subagents holding that boundary — the
 * same thing ctrl+b does — and let the drain pick the input up.
 *
 * A tool that can't be moved is waited out rather than interrupted: an
 * 'interrupt' abort lets such a tool finish anyway (only 'cancel' tools stop),
 * so interrupting would only end the turn at the same boundary the drain
 * already delivers at. Shells and subagents become movable once they register
 * as foreground tasks (after 2 s); the controller keeps checking and moves
 * them then.
 *
 * It interrupts — promoting the input to 'now' priority, which the REPL
 * answers with abort('interrupt') — only when that is the faster path: the
 * model is streaming a reply with no tool to wait for, or the input can't be
 * delivered mid-turn at all (a slash or bash-mode command).
 */

/** How often the controller re-checks while it has something to deliver. */
export const SEND_NOW_TICK_MS = 200

/**
 * Backgrounding passes before tasks that still look movable are treated as
 * unmovable, so a task that refuses to background can't pin the controller in
 * a background loop.
 */
export const SEND_NOW_MAX_BACKGROUND_PASSES = 3

export type SendNowState = {
  /** Targets still sitting in the queue. */
  pendingTargets: number
  isTurnActive: boolean
  /** A permission or other blocking dialog is open. */
  isHeldByDialog: boolean
  /** The first pending target can be drained at a tool boundary. */
  isDeliverableMidTurn: boolean
  /** Foreground shells/subagents that ctrl+b could background. */
  hasMovableTasks: boolean
  isBackgroundingDisabled: boolean
  /** A tool is running or the model is streaming a tool call. */
  isExecuting: boolean
  /** The model is streaming a reply. */
  isSampling: boolean
}

export type SendNowDecision =
  | { action: 'done' }
  | { action: 'stand_by' }
  | {
      action: 'wait'
      reason: 'held_by_dialog' | 'tool_running' | 'not_sampling'
    }
  | { action: 'background' }
  | { action: 'interrupt' }

export function decideSendNow(s: SendNowState): SendNowDecision {
  if (s.pendingTargets === 0) return { action: 'done' }
  // The turn ended: the queue processor sends what's left as the next turn.
  if (!s.isTurnActive) return { action: 'stand_by' }
  // Never cut across a permission prompt the user is looking at.
  if (s.isHeldByDialog) return { action: 'wait', reason: 'held_by_dialog' }
  if (!s.isDeliverableMidTurn) return { action: 'interrupt' }
  if (s.hasMovableTasks && !s.isBackgroundingDisabled) {
    return { action: 'background' }
  }
  if (s.isExecuting) return { action: 'wait', reason: 'tool_running' }
  if (s.isSampling) return { action: 'interrupt' }
  return { action: 'wait', reason: 'not_sampling' }
}

/** Queued commands "send now" acts on: the user's own prompt/bash input. */
export function isSendNowTarget(cmd: QueuedCommand): boolean {
  return cmd.agentId === undefined && isQueuedCommandEditable(cmd)
}

/**
 * Whether `target` can be drained mid-turn. query.ts never drains slash or
 * bash-mode commands mid-turn, and anything queued ahead of the target that
 * has to wait for the end of the turn holds it back too.
 */
export function isDeliverableMidTurn(
  queue: readonly QueuedCommand[],
  target: QueuedCommand,
): boolean {
  const index = queue.indexOf(target)
  if (index === -1) return false
  const waitsForTurnEnd = (cmd: QueuedCommand) =>
    cmd.mode === 'bash' || isSlashCommand(cmd)
  if (waitsForTurnEnd(target)) return false
  return !queue
    .slice(0, index)
    .some(cmd => cmd.agentId === undefined && waitsForTurnEnd(cmd))
}

export type SendNowTurnState = {
  isTurnActive: boolean
  isHeldByDialog: boolean
  hasMovableTasks: boolean
  isBackgroundingDisabled: boolean
  isExecuting: boolean
  isSampling: boolean
}

export type SendNowDeps = {
  getTurnState: () => SendNowTurnState
  /** Background every foreground shell and subagent (ctrl+b). */
  backgroundAll: () => void
  setTimeout: (fn: () => void, ms: number) => () => void
}

export class SendNowController {
  #deps: SendNowDeps
  #targets = new Set<QueuedCommand>()
  #cancelTimer: (() => void) | null = null
  #unsubscribe: (() => void) | null = null
  #backgroundPasses = 0
  #lastLogged = ''
  #disposed = false

  constructor(deps: SendNowDeps) {
    this.#deps = deps
  }

  /**
   * Start delivering the currently queued user input. Returns false when there
   * is nothing to deliver or no turn is running (the queue processor sends it
   * as the next turn anyway).
   */
  sendQueuedNow(): boolean {
    if (this.#disposed) return false
    if (!this.#deps.getTurnState().isTurnActive) return false
    for (const cmd of getCommandQueue()) {
      if (isSendNowTarget(cmd)) this.#targets.add(cmd)
    }
    if (this.#targets.size === 0) return false
    this.#unsubscribe ??= subscribeToCommandQueue(() => this.#onQueueChange())
    if (this.#cancelTimer === null) this.#schedule(0)
    return true
  }

  dispose(): void {
    this.#disposed = true
    this.#stop()
  }

  #onQueueChange(): void {
    const queue = new Set(getCommandQueue())
    for (const target of this.#targets) {
      if (!queue.has(target)) this.#targets.delete(target)
    }
    if (this.#targets.size === 0) this.#stop()
  }

  #schedule(ms: number): void {
    this.#cancelTimer?.()
    this.#cancelTimer = this.#deps.setTimeout(() => {
      this.#cancelTimer = null
      this.#tick()
    }, ms)
  }

  #stop(): void {
    this.#cancelTimer?.()
    this.#cancelTimer = null
    this.#unsubscribe?.()
    this.#unsubscribe = null
    this.#targets.clear()
    this.#backgroundPasses = 0
    this.#lastLogged = ''
  }

  #tick(): void {
    this.#onQueueChange()
    if (this.#targets.size === 0) return
    const queue = getCommandQueue()
    const head = queue.find(cmd => this.#targets.has(cmd))
    const turn = this.#deps.getTurnState()
    const decision = decideSendNow({
      pendingTargets: this.#targets.size,
      ...turn,
      hasMovableTasks:
        turn.hasMovableTasks &&
        this.#backgroundPasses < SEND_NOW_MAX_BACKGROUND_PASSES,
      isDeliverableMidTurn:
        head !== undefined && isDeliverableMidTurn(queue, head),
    })
    const summary =
      decision.action === 'wait' ? `wait ${decision.reason}` : decision.action
    if (summary !== this.#lastLogged) {
      this.#lastLogged = summary
      logForDebugging(`[send-now] ${summary}`)
    }
    switch (decision.action) {
      case 'done':
      case 'stand_by':
        this.#stop()
        return
      case 'background':
        this.#deps.backgroundAll()
        this.#backgroundPasses++
        this.#schedule(SEND_NOW_TICK_MS)
        return
      case 'wait':
        this.#schedule(SEND_NOW_TICK_MS)
        return
      case 'interrupt':
        promoteToNow([...this.#targets])
        this.#stop()
        return
    }
  }
}
