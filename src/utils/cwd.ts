// @ts-nocheck
import { AsyncLocalStorage } from 'async_hooks'
import { getCwdState, getOriginalCwd } from '../bootstrap/state.js'
import type { WorktreeSession } from './worktree.js'

/** An agent's pinned directory and its original shared checkout. Ordinary
 * directory pinning is not an isolation boundary; `isolated` distinguishes it
 * from an explicit cwd/worktree isolation or EnterWorktree switch. */
export type CwdOverride = {
  cwd: string
  sharedCheckout: string
  isolated?: boolean
  /** Root assigned by explicit isolation; changing cwd cannot widen it. */
  isolationRoot?: string
  worktreeSession?: WorktreeSession
}

const cwdOverrideStorage = new AsyncLocalStorage<CwdOverride>()

/**
 * Run a function with an overridden working directory for the current async context.
 * All calls to pwd()/getCwd() within the function (and its async descendants) will
 * return the overridden cwd instead of the global one. This enables concurrent
 * agents to each see their own working directory without affecting each other.
 */
export function runWithCwdOverride<T>(cwd: string, fn: () => T, isolated = true): T {
  // Snapshot the shared checkout on entry rather than reading it at check
  // time. getOriginalCwd() is mutated mid-session by /cd and EnterWorktree,
  // and a concurrent agent's isolation boundary must not shift under it —
  // that direction fails open.
  return cwdOverrideStorage.run({ cwd, sharedCheckout: getOriginalCwd(), isolated,
    isolationRoot: isolated ? cwd : undefined }, fn)
}

/**
 * The pinned directory, isolation state, and worktree session for this async
 * context, or undefined when there is none.
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
