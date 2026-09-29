/**
 * bgIsolation: a background session shares the user's working copy, so an
 * Edit/Write from one can overwrite work from the main session or a parallel
 * agent. Mirroring upstream (`worktree.bgIsolation` in settings /
 * CLAUDE_BG_ISOLATION, default 'worktree'), writes into the shared checkout
 * are rejected until the session isolates with EnterWorktree; 'none' works
 * in place. This module is the guard; the matching system-prompt section is
 * registered in systemPromptAssemblyHelpers.ts.
 */
import { getOriginalCwd } from '../../bootstrap/state.js'
import { getCwd } from '../cwd.js'
import { getPathsForPermissionCheck } from '../fsOperations.js'
import { findGitRoot } from '../git.js'
import { pathInWorkingPath } from '../permissions/filesystem.js'
import { getProjectWorktreeDirCandidates } from '../productPaths.js'
import { getSettings_DEPRECATED } from '../settings/settings.js'
import { getCurrentWorktreeSession } from '../worktree.js'
import { isBgSession } from './bgJob.js'

export type BgIsolation = 'worktree' | 'none'

export function getBgIsolation(): BgIsolation {
  const env = process.env.NOA_CLAUDE_BG_ISOLATION ?? process.env.CLAUDE_BG_ISOLATION
  if (env === 'worktree' || env === 'none') return env
  return getSettings_DEPRECATED().worktree?.bgIsolation ?? 'worktree'
}

/**
 * Refuse a write from a background session that lands in the shared
 * checkout. Returns the refusal message, or null when the write is fine.
 *
 * Deliberately narrow (same boundary as checkWorktreeEscape): this refuses
 * writes *into the shared checkout*, not writes elsewhere — scratch space
 * like /tmp is legitimate and cannot cause a lost update in the repo.
 */
export function checkBgIsolation(targetPath: string): string | null {
  if (!isBgSession()) return null
  if (getBgIsolation() === 'none') return null
  // Not a git repo: EnterWorktree can't isolate here, so don't demand it.
  if (!findGitRoot(getCwd())) return null

  const worktree = getCurrentWorktreeSession()
  const sharedCheckout = worktree?.originalCwd ?? getOriginalCwd()
  // Every link in the chain, not just the spelling we were handed — see
  // checkWorktreeEscape for why a textual containment test is not enough.
  const paths = getPathsForPermissionCheck(targetPath)

  if (worktree) {
    // Already isolated: keep writes out of the shared checkout (upstream's
    // already-isolated branch). Worktrees live inside the checkout, so the
    // worktree test has to come first.
    const escapes = paths.some(
      p => !pathInWorkingPath(p, worktree.worktreePath) && pathInWorkingPath(p, sharedCheckout),
    )
    return escapes
      ? `This background session is isolated in the worktree ${worktree.worktreePath}. Edit the worktree copy of this file instead of the shared-checkout path.`
      : null
  }

  // Not isolated yet. A path inside a linked worktree is accepted even
  // though it sits under the checkout — cover the managed worktrees dir and
  // anything outside the checkout (where `git worktree add` usually lands).
  const intoCheckout = paths.some(
    p =>
      pathInWorkingPath(p, sharedCheckout) &&
      !getProjectWorktreeDirCandidates(sharedCheckout).some(dir => pathInWorkingPath(p, dir)),
  )
  if (!intoCheckout) return null

  // Upstream's message, with the settings file path adapted (.noa, not
  // .claude) — an intentional deviation, the fork's settings namespace.
  return `This background session hasn't isolated its changes yet. Call EnterWorktree first so edits land in a worktree instead of the shared checkout, then retry this edit using the worktree path (a path inside a linked git worktree, including one you create with \`git worktree add\`, is accepted). (To disable this guard for this repo, set \`"worktree": {"bgIsolation": "none"}\` in .noa/settings.json.)`
}

/**
 * The system-prompt section a background session gets (upstream's
 * "bg-session" section; the worktrees dir is the fork's .noa one — an
 * intentional deviation, as above).
 */
export function getBgSessionSection(): string | null {
  if (!isBgSession()) return null
  const isolation = getBgIsolation()
  if (isolation === 'none') {
    return 'Edit files directly in your working directory — this session is configured to work in place rather than isolating into a worktree. Skip EnterWorktree unless the user explicitly asks to work in a worktree.'
  }
  // Upstream uses a terser instruction when isolation was set explicitly via
  // env; mirror that split.
  if (process.env.NOA_CLAUDE_BG_ISOLATION === 'worktree' || process.env.CLAUDE_BG_ISOLATION === 'worktree') {
    return 'This agent is configured with `isolation: worktree`. Call the EnterWorktree tool as your first action — before reading files or running commands — unless your cwd is already under `.noa/worktrees/`. If EnterWorktree fails, continue in place.'
  }
  return 'Before making any code changes, use the EnterWorktree tool to isolate your work from other parallel jobs and the user\'s working copy — unless your cwd is already under `.noa/worktrees/`, in which case you\'re already isolated. This is enforced: file edits in the shared checkout are rejected until you isolate, so call EnterWorktree before your first edit rather than after a rejected attempt. If you\'re only reading, searching, or answering questions, skip this and work in place. If EnterWorktree fails, continue in place.'
}
