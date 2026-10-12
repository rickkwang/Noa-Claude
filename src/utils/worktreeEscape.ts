import { homedir } from 'os'
import { resolve } from 'path'
import { type CwdOverride, getCwdOverride } from './cwd.js'
import { getPathsForPermissionCheck } from './fsOperations.js'
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
  override: CwdOverride | undefined = getCwdOverride(),
): string | null {
  // Not an isolated agent: nothing here applies.
  if (override === undefined || (override.isolated === false && !override.isolationRoot)) return null
  const { sharedCheckout } = override
  const cwd = override.isolationRoot ?? override.cwd
  if (cwd === sharedCheckout) return null

  // Every link in the chain, not just the spelling we were handed: a symlink
  // *inside* the worktree pointing at the checkout passes a textual
  // containment test, and writing through it lands in the checkout anyway.
  // One `ln -s` would otherwise retire this whole guard. Mirrors what
  // pathInAllowedWorkingPath does for permission checks.
  const escapes = getPathsForPermissionCheck(targetPath).some(
    path =>
      // Order matters. Worktrees live at `.noa/worktrees/<slug>`, inside the
      // checkout, so the worktree test has to come first — otherwise every
      // path in the worktree also reads as a path in the shared checkout.
      !pathInWorkingPath(path, cwd) && pathInWorkingPath(path, sharedCheckout),
  )
  if (!escapes) return null

  return (
    `This agent is isolated in ${cwd}, but this path resolves into the shared ` +
    `checkout (${sharedCheckout}). Writing there would defeat the isolation and can ` +
    `overwrite work from the main session or a parallel agent. Use the copy of this file ` +
    `inside ${cwd} instead.`
  )
}

const CD_TARGET_PATTERN = /(?:^|[;&|(])\s*(?:cd|pushd)\s+(?:"([^"]*)"|'([^']*)'|([^\s;&|()]+))/g
// git options that point git at a repository or worktree, plus the env forms.
const GIT_PATH_PATTERN = /\bgit\b[^;&|()\n]*?(?:\s-C\s*|\s--git-dir[= ]|\s--work-tree[= ])("[^"]*"|'[^']*'|[^\s;&|()]+)|(?:^|\s)(?:GIT_DIR|GIT_WORK_TREE)=("[^"]*"|'[^']*'|[^\s;&|()]+)/g
const RUNTIME_TARGET = /[$`]/

/**
 * Best-effort static check of a shell command for an isolated agent: `cd` and
 * `pushd` targets, and git's -C / --git-dir / --work-tree / GIT_DIR /
 * GIT_WORK_TREE targets. The shell only moves its cwd after the command runs,
 * so checkWorktreeEscape on the current cwd misses `cd <shared checkout> && <write>`
 * in one command. A target computed at runtime cannot be checked, so it is refused.
 */
export function checkWorktreeEscapeForCommand(
  command: string,
  from: string,
): string | null {
  const override = getCwdOverride()
  if (override === undefined || (override.isolated === false && !override.isolationRoot)) return null
  const targets = [
    ...[...command.matchAll(CD_TARGET_PATTERN)].map(m => m[1] ?? m[2] ?? m[3] ?? ''),
    ...[...command.matchAll(GIT_PATH_PATTERN)].map(m => m[1] ?? m[2] ?? ''),
  ]
  for (const raw of targets) {
    const target = raw.replace(/^["']|["']$/g, '')
    if (RUNTIME_TARGET.test(target)) {
      return `This command points at a directory computed at runtime (${raw}), which cannot be verified to stay inside this agent's worktree. Use a literal path.`
    }
    const path = target.startsWith('~') ? homedir() + target.slice(1) : target
    const error = checkWorktreeEscape(resolve(from, path))
    if (error) return error
  }
  return null
}
