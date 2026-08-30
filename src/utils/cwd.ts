// @ts-nocheck
import { AsyncLocalStorage } from 'async_hooks'
import { getCwdState, getOriginalCwd } from '../bootstrap/state.js'

/** An isolated agent's working directory, paired with the checkout it was
 * isolated *from*. The two must travel together: the boundary is the gap
 * between them, and reading either half from live global state at check time
 * lets the boundary move after the fact. */
export type CwdOverride = { cwd: string; sharedCheckout: string }

const cwdOverrideStorage = new AsyncLocalStorage<CwdOverride>()

/**
 * Run a function with an overridden working directory for the current async context.
 * All calls to pwd()/getCwd() within the function (and its async descendants) will
 * return the overridden cwd instead of the global one. This enables concurrent
 * agents to each see their own working directory without affecting each other.
 */
export function runWithCwdOverride<T>(cwd: string, fn: () => T): T {
  // Snapshot the shared checkout on entry rather than reading it at check
  // time. getOriginalCwd() is mutated mid-session by /cd and EnterWorktree,
  // and a concurrent agent's isolation boundary must not shift under it —
  // that direction fails open.
  return cwdOverrideStorage.run({ cwd, sharedCheckout: getOriginalCwd() }, fn)
}

/**
 * The cwd override in effect for this async context, or undefined when there
 * is none. Distinct from getCwd(): that also reports a plain `cd` in the
 * shell, which is not an isolation boundary. Only use this to reason about
 * the boundary itself — see checkWorktreeEscape.
 */
export function getCwdOverride(): CwdOverride | undefined {
  return cwdOverrideStorage.getStore()
}

/**
 * Get the current working directory
 */
export function pwd(): string {
  return cwdOverrideStorage.getStore()?.cwd ?? getCwdState()
}

/**
 * Get the current working directory or the original working directory if the current one is not available
 */
export function getCwd(): string {
  try {
    return pwd()
  } catch {
    return getOriginalCwd()
  }
}
