/**
 * Moving a conversation to the background while a turn may be running: the
 * REPL owns the turn, the prompt input owns the ← gesture and /background
 * owns the command, so the REPL registers how to hand over and the others
 * ask for it.
 */

import type { HandoffPrefill } from './dispatch.js'

export type HandoffController = {
  /** ← on an empty prompt in a foreground session. */
  onLeftArrow(): void
  /**
   * /background typed while a turn runs: stop the turn right away (no
   * waiting on tools) and resolve once it has settled, so what it produced
   * is in the transcript the fork copies.
   */
  stopTurnForHandoff(): Promise<HandoffPrefill | undefined>
}

let controller: HandoffController | null = null

export function registerBackgroundHandoff(c: HandoffController): () => void {
  controller = c
  return () => {
    if (controller === c) controller = null
  }
}

export function requestBackgroundHandoff(): boolean {
  if (!controller) return false
  controller.onLeftArrow()
  return true
}

/** Resolves with the reply that was streaming, if a turn was running. */
export async function stopTurnForHandoff(): Promise<HandoffPrefill | undefined> {
  return controller?.stopTurnForHandoff()
}
