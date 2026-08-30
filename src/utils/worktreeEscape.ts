// @ts-nocheck
import { getOriginalCwd } from '../bootstrap/state.js'
import { getCwdOverride } from './cwd.js'
import { pathInWorkingPath } from './permissions/filesystem.js'

/**
 * Refuse a write that reaches out of an agent's cwd override and back into
 * the shared checkout.
 *
 * `isolation: "worktree"` (and an explicit `cwd`) put the agent under a cwd
 * override — see runWithCwdOverride in AgentTool — but an override only
 * redirects *relative* paths. An absolute path naming the parent checkout
 * still landed there, so the isolation the caller asked for came apart
 * silently, and with parallel agents that is exactly the lost update the
 * worktree was meant to prevent.
 *
 * Keyed on the override, not on `getCwd() !== getOriginalCwd()`: a plain `cd`
 * in the shell moves the cwd too, and treating that as a boundary would
 * refuse ordinary writes for the rest of the session.
 *
 * Deliberately narrow: this refuses writes to the shared checkout, not writes
 * outside it. Scratch space like /tmp is a legitimate destination and cannot
 * cause a lost update in the repo — guarding it would make this a sandbox,
 * which it is not.
 *
 * Returns an error message, or null when the write is fine.
 */
export function checkWorktreeEscape(
  targetPath: string,
  cwdOverride: string | undefined = getCwdOverride(),
  sharedCheckout: string = getOriginalCwd(),
): string | null {
  // Not an isolated agent: nothing here applies.
  if (cwdOverride === undefined || cwdOverride === sharedCheckout) return null

  // Order matters. Worktrees live at `.noa/worktrees/<slug>`, inside the
  // checkout, so the worktree test has to come first — otherwise every path
  // in the worktree also reads as a path in the shared checkout.
  if (pathInWorkingPath(targetPath, cwdOverride)) return null

  if (!pathInWorkingPath(targetPath, sharedCheckout)) return null

  return (
    `This agent is isolated in ${cwdOverride}, but this path resolves into the shared ` +
    `checkout (${sharedCheckout}). Writing there would defeat the isolation and can ` +
    `overwrite work from the main session or a parallel agent. Use the copy of this file ` +
    `inside ${cwdOverride} instead.`
  )
}
