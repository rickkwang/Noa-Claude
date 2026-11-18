import { homedir } from 'os'
import { basename, resolve } from 'path'
import { tryParseShellCommand } from './bash/shellQuote.js'
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
  override: CwdOverride | undefined = getCwdOverride(),
): string | null {
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
    const error = checkWorktreeEscape(resolve(from, path), override)
    if (error) return error
  }
  return checkSharedGitRefMutation(command, override)
}

const GIT_GLOBAL_OPTS_WITH_ARG = new Set([
  '-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--exec-path', '--list-cmds',
])

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

function hasShortFlag(arg: string, chars: string): boolean {
  if (!arg.startsWith('-') || arg.startsWith('--') || arg.length < 2) return false
  return [...arg.slice(1)].some(ch => chars.includes(ch))
}

function isMutatingGitRefCommand(args: string[]): string | null {
  let i = 0
  while (i < args.length) {
    const arg = args[i]!
    if (arg === '--') {
      i++
      break
    }
    if (GIT_GLOBAL_OPTS_WITH_ARG.has(arg)) {
      i += 2
      continue
    }
    if (arg.startsWith('-')) {
      i++
      continue
    }
    break
  }
  const sub = args[i]
  if (!sub) return null
  const rest = args.slice(i + 1)

  if (sub === 'update-ref' || sub === 'push') return `git ${sub}`

  if (sub === 'symbolic-ref') {
    const positional = rest.filter(a => !a.startsWith('-'))
    const deletes = rest.some(a => a === '--delete' || hasShortFlag(a, 'd'))
    if (deletes || positional.length >= 2) return 'git symbolic-ref'
    return null
  }

  if (sub === 'branch') {
    const mutating = rest.some(a =>
      ['--delete', '--move', '--copy', '--force', '--set-upstream-to', '--unset-upstream', '--edit-description'].includes(a) ||
      a.startsWith('--set-upstream-to=') ||
      hasShortFlag(a, 'dDmMcCfFu'),
    )
    if (mutating) return 'git branch'
    const readQuery = rest.some(a =>
      ['--all', '--remotes', '--list', '--contains', '--no-contains', '--merged', '--no-merged', '--points-at', '--show-current'].includes(a) ||
      hasShortFlag(a, 'arl'),
    )
    const hasPositional = rest.some(a => !a.startsWith('-'))
    if (!readQuery && hasPositional) return 'git branch'
    return null
  }

  if (sub === 'tag') {
    const mutating = rest.some(a =>
      ['--delete', '--force', '--annotate', '--sign', '--local-user', '--file'].includes(a) ||
      hasShortFlag(a, 'dfasumF'),
    )
    if (mutating) return 'git tag'
    const readQuery = rest.some(a =>
      ['--list', '--verify', '--contains', '--no-contains', '--merged', '--no-merged', '--points-at'].includes(a) ||
      hasShortFlag(a, 'lv'),
    )
    const hasPositional = rest.some(a => !a.startsWith('-'))
    if (!readQuery && hasPositional) return 'git tag'
    return null
  }

  if (sub === 'checkout' || sub === 'switch') {
    const createsBranch = rest.some(a =>
      a === '--orphan' || a === '--track' || hasShortFlag(a, 'bBcC'),
    )
    if (createsBranch) return `git ${sub}`
    return null
  }

  if (sub === 'worktree') {
    const action = rest.find(a => !a.startsWith('-'))
    if (action && action !== 'list') return `git worktree ${action}`
    return null
  }

  if (sub === 'remote') {
    const action = rest.find(a => !a.startsWith('-'))
    if (action && ['add', 'remove', 'rm', 'rename', 'set-url', 'prune', 'update', 'set-head', 'set-branches'].includes(action)) {
      return `git remote ${action}`
    }
    return null
  }

  return null
}

function checkSharedGitRefMutation(command: string, override: CwdOverride): string | null {
  const parsed = tryParseShellCommand(command)
  if (!parsed.success) return null

  const segments: string[][] = [[]]
  for (const token of parsed.tokens) {
    if (typeof token === 'string') {
      segments.at(-1)!.push(token)
    } else if (segments.at(-1)!.length > 0) {
      segments.push([])
    }
  }

  for (const seg of segments) {
    let idx = 0
    while (idx < seg.length && (ENV_ASSIGNMENT.test(seg[idx]!) || seg[idx] === 'command' || seg[idx] === 'env')) {
      idx++
    }
    const exe = seg[idx]
    if (!exe || basename(exe) !== 'git') continue
    const blocked = isMutatingGitRefCommand(seg.slice(idx + 1))
    if (blocked) {
      const cwd = override.isolationRoot ?? override.cwd
      return (
        `This agent is isolated in ${cwd}, but \`${blocked}\` modifies shared Git references ` +
        `across all worktrees (${override.sharedCheckout}). Refusing to run it.`
      )
    }
  }
  return null
}
