/**
 * Git diff snapshots for `/diff` — both the dialog and the fullscreen panel.
 *
 * A snapshot answers one of four questions:
 *
 * - `auto`        — uncommitted changes; when the tree is clean, the branch's
 *                   committed work against its merge base instead. The dialog.
 * - `session`     — uncommitted changes, with files already dirty before this
 *                   session flagged `preSession` (see {@link markPreSessionFiles}).
 * - `uncommitted` — uncommitted changes vs HEAD, no session split.
 * - `branch`      — a PR-shaped diff against the merge base with the default
 *                   branch, degrading to HEAD when there is no base branch.
 *
 * Hunks are fetched separately, against the ref the snapshot resolved to, so a
 * stats refresh doesn't have to re-parse megabytes of patch text.
 */
import type { StructuredPatchHunk } from 'diff'
import { lstat } from 'fs/promises'
import { join } from 'path'
import { getSessionStartTime } from '../bootstrap/state.js'
import { getCwd } from './cwd.js'
import { execFileNoThrow } from './execFileNoThrow.js'
import {
  findGitRoot,
  getBranch,
  getDefaultBranch,
  getIsGit,
  gitExe,
  RAW_DIFF_FLAGS,
} from './git.js'
import {
  GIT_TIMEOUT_MS,
  isInTransientGitState,
  MAX_FILES,
  MAX_FILES_FOR_DETAILS,
  parseGitDiff,
  parseGitNumstat,
  parseShortstat,
  type GitDiffStats,
  type PerFileStats,
} from './gitDiff.js'

/** User-selectable base for the panel (`ctrl+x b` cycles it; persisted globally). */
export type DiffBaseMode = 'session' | 'uncommitted' | 'branch'

/** The three modes `ctrl+x b` cycles through, in order. */
export const DIFF_BASE_MODES: readonly DiffBaseMode[] = [
  'session',
  'uncommitted',
  'branch',
]

/** What a snapshot can be asked for: a panel base, or the dialog's `auto`. */
export type DiffFetchMode = DiffBaseMode | 'auto'

/** What the returned snapshot actually ended up comparing against. */
export type DiffSource =
  | { kind: 'working-tree' }
  | { kind: 'branch'; baseBranch: string; baseRef: string }

export type DiffSnapshot = {
  stats: GitDiffStats
  perFileStats: Map<string, PerFileStats>
  source: DiffSource
  /** True when the repo has no commits yet — the diff is against the index. */
  noCommits?: boolean
}

export type DiffHunks = {
  hunks: Map<string, StructuredPatchHunk[]>
  skippedLarge: Set<string>
}

export const EMPTY_DIFF_HUNKS: DiffHunks = {
  hunks: new Map(),
  skippedLarge: new Set(),
}

const BASE_DIFF_FLAGS = [
  '--no-optional-locks',
  '-c',
  'diff.relative=false',
  'diff',
  '--ignore-submodules=dirty',
  '--submodule=short',
] as const

type NumstatSnapshot = {
  stats: GitDiffStats
  perFileStats: Map<string, PerFileStats>
}

type UntrackedFiles = Map<string, PerFileStats>

const WORKING_TREE: DiffSource = { kind: 'working-tree' }

/**
 * Collect diff stats. Returns null when the answer would be misleading:
 * outside a git repo, or mid merge/rebase/cherry-pick/revert where the working
 * tree holds incoming changes nobody here made.
 */
export async function fetchDiffSnapshot(
  mode: DiffFetchMode = 'auto',
  signal?: AbortSignal,
): Promise<DiffSnapshot | null> {
  if (!(await getIsGit())) return null
  if (await isInTransientGitState()) return null

  if (mode === 'branch') return fetchBranchSnapshot(signal, true)

  const headDiff = await numstatAgainst('HEAD', signal)
  if (headDiff === null) return fetchNoCommitsSnapshot(signal)

  const workingTree = { ...headDiff, source: WORKING_TREE }
  // Above this many files we report accurate totals but skip per-file work.
  if (headDiff.stats.filesCount > MAX_FILES_FOR_DETAILS) return workingTree

  if (mode === 'session') {
    await Promise.all([
      markPreSessionFiles(headDiff),
      addUntrackedFiles(headDiff, signal, { includePreSession: true }),
    ])
    return workingTree
  }

  const untracked = await addUntrackedFiles(headDiff, signal)
  if (mode === 'uncommitted' || headDiff.stats.filesCount > 0) {
    return workingTree
  }

  // `auto` on a clean tree: show what the branch has committed instead.
  const branch = await fetchBranchSnapshot(signal, false, untracked)
  return branch === null || branch.stats.filesCount === 0
    ? workingTree
    : branch
}

/** The git ref a snapshot's hunks must be read against. */
export function diffRefForSnapshot(snapshot: DiffSnapshot): string {
  if (snapshot.noCommits) return '--cached'
  return snapshot.source.kind === 'branch' ? snapshot.source.baseRef : 'HEAD'
}

/**
 * Read the patch text for `ref` and parse it into per-file hunks.
 * Returns null when git fails, so the caller can keep showing the last good
 * hunks rather than blanking on a transient error.
 */
export async function fetchDiffHunksForRef(
  ref = 'HEAD',
  signal?: AbortSignal,
): Promise<DiffHunks | null> {
  if (!(await getIsGit())) return null
  if (await isInTransientGitState()) return null

  const quick = await shortstatAgainst(ref, signal)
  if (quick && quick.filesCount > MAX_FILES_FOR_DETAILS) {
    return EMPTY_DIFF_HUNKS
  }

  const { stdout, code } = await runGit(
    [...BASE_DIFF_FLAGS, ...RAW_DIFF_FLAGS, ref],
    signal,
  )
  if (code !== 0) return null

  const parsed = parseGitDiff(stdout)

  // `--cached` shows the index, but a file staged and then edited again would
  // render a stale hunk. Drop anything that also has unstaged changes.
  if (ref === '--cached' && parsed.hunks.size > 0) {
    const unstaged = await numstatUnstaged(signal)
    if (unstaged === null) return null
    for (const path of unstaged.perFileStats.keys()) {
      parsed.hunks.delete(path)
    }
  }

  return parsed
}

/**
 * Resolve the branch this checkout diverged from.
 *
 * - `merge-base`   — a real branch diff.
 * - `head-is-base` — sitting on the default branch, so a "branch diff" is just
 *                    the working tree; still labelled with the branch name.
 * - `none`         — no base to compare against (detached HEAD, no default
 *                    branch, unrelated histories).
 */
type BranchBase =
  | { kind: 'merge-base'; baseBranch: string; mergeBase: string }
  | { kind: 'head-is-base'; baseBranch: string }
  | { kind: 'none' }
  | { kind: 'error' }

async function resolveBranchBase(signal?: AbortSignal): Promise<BranchBase> {
  const [currentBranch, defaultBranch] = await Promise.all([
    getBranch(),
    getDefaultBranch(),
  ])
  if (!currentBranch || currentBranch === 'HEAD') return { kind: 'none' }
  const baseBranch = process.env.CLAUDE_CODE_BASE_REF || defaultBranch
  if (!baseBranch || baseBranch.startsWith('-')) return { kind: 'none' }
  if (currentBranch === baseBranch) return { kind: 'head-is-base', baseBranch }

  // Try the remote-tracking ref first, then the local branch; when both merge
  // bases exist, keep the later one (a stale local main would otherwise diff
  // against ancient history and blame this branch for upstream's commits).
  let sawNoMergeBase = false
  const candidates: string[] = []
  for (const ref of [`origin/${baseBranch}`, baseBranch]) {
    const { stdout, code } = await runGit(
      ['--no-optional-locks', 'merge-base', 'HEAD', ref],
      signal,
    )
    if (code === 1) sawNoMergeBase = true
    if (code === 0 && stdout.trim()) candidates.push(stdout.trim())
  }

  const [first, second] = candidates
  let mergeBase = first ?? null
  if (first && second && first !== second) {
    const { code } = await runGit(
      ['--no-optional-locks', 'merge-base', '--is-ancestor', first, second],
      signal,
    )
    if (code === 0) mergeBase = second
  }

  if (mergeBase === null) {
    // merge-base exit 1 means the histories genuinely share no ancestor.
    if (sawNoMergeBase) return { kind: 'none' }
    // Otherwise the base ref is missing — unless it exists and merge-base
    // failed for some other reason, which is a real error.
    for (const ref of [
      `refs/remotes/origin/${baseBranch}`,
      `refs/heads/${baseBranch}`,
    ]) {
      const { code } = await runGit(
        ['--no-optional-locks', 'show-ref', '--verify', '--quiet', ref],
        signal,
      )
      if (code === 0) return { kind: 'error' }
    }
    return { kind: 'none' }
  }

  const head = await runGit(['--no-optional-locks', 'rev-parse', 'HEAD'], signal)
  if (head.code !== 0) return { kind: 'error' }
  if (head.stdout.trim() === mergeBase) {
    return { kind: 'head-is-base', baseBranch }
  }
  return { kind: 'merge-base', baseBranch, mergeBase }
}

/**
 * A snapshot against the branch's merge base.
 *
 * `degrade` is the panel's explicit `branch` base: with no merge base it falls
 * back to a HEAD diff (and says so) rather than returning null. `auto` passes
 * false — it only wants a branch diff when one really exists — along with the
 * untracked files it already listed.
 */
async function fetchBranchSnapshot(
  signal: AbortSignal | undefined,
  degrade: boolean,
  untracked?: UntrackedFiles | null,
): Promise<DiffSnapshot | null> {
  const base = await resolveBranchBase(signal)
  if (base.kind === 'error') {
    return degrade ? fetchNoCommitsSnapshot(signal) : null
  }

  let numstat: NumstatSnapshot | null
  let source: DiffSource
  if (base.kind === 'merge-base') {
    numstat = await numstatAgainst(base.mergeBase, signal)
    source = {
      kind: 'branch',
      baseBranch: base.baseBranch,
      baseRef: base.mergeBase,
    }
  } else {
    if (!degrade) return null
    numstat = await numstatAgainst('HEAD', signal)
    source =
      base.kind === 'head-is-base'
        ? { kind: 'branch', baseBranch: base.baseBranch, baseRef: 'HEAD' }
        : WORKING_TREE
  }

  if (numstat === null) {
    return base.kind === 'merge-base' ? null : fetchNoCommitsSnapshot(signal)
  }
  if (numstat.stats.filesCount <= MAX_FILES_FOR_DETAILS) {
    await addUntrackedFiles(numstat, signal, { precomputed: untracked })
  }
  return { ...numstat, source }
}

/**
 * A repo with no commits has no HEAD, so `git diff HEAD` fails. Diff the index
 * instead and fold unstaged edits into the same per-file totals, so a brand-new
 * repo shows staged + new files rather than "diff unavailable".
 */
async function fetchNoCommitsSnapshot(
  signal?: AbortSignal,
): Promise<DiffSnapshot | null> {
  const { code } = await runGit(
    ['--no-optional-locks', 'rev-parse', '--verify', '--quiet', 'HEAD'],
    signal,
  )
  // exit 1 is specifically "HEAD does not resolve"; anything else is a real
  // failure and shouldn't be reported as an empty repo.
  if (code !== 1) return null

  const snapshot: DiffSnapshot = {
    stats: { filesCount: 0, linesAdded: 0, linesRemoved: 0 },
    perFileStats: new Map(),
    source: WORKING_TREE,
    noCommits: true,
  }

  const staged = await numstatAgainst('--cached', signal)
  if (staged !== null) {
    snapshot.stats = staged.stats
    snapshot.perFileStats = staged.perFileStats
    if (staged.stats.filesCount > MAX_FILES_FOR_DETAILS) return snapshot
    if (staged.stats.filesCount > 0) {
      await foldUnstagedIntoStaged(snapshot, signal)
    }
  }

  await addUntrackedFiles(snapshot, signal)
  return snapshot
}

/**
 * Combine unstaged edits into the staged totals so a file staged then edited
 * again reports its net line count once, not twice.
 */
async function foldUnstagedIntoStaged(
  snapshot: DiffSnapshot,
  signal?: AbortSignal,
): Promise<void> {
  const unstaged = await numstatUnstaged(signal)
  if (unstaged === null) return

  for (const [path, delta] of unstaged.perFileStats) {
    const staged = snapshot.perFileStats.get(path)
    if (staged === undefined) continue
    const isBinary = staged.isBinary || delta.isBinary
    const added = isBinary
      ? 0
      : Math.max(0, staged.added + delta.added - delta.removed)
    snapshot.stats.linesAdded += added - staged.added
    snapshot.perFileStats.set(path, {
      added,
      removed: 0,
      isBinary,
      isUntracked: false,
    })
  }
}

function runGit(args: string[], signal?: AbortSignal) {
  return execFileNoThrow(gitExe(), args, {
    timeout: GIT_TIMEOUT_MS,
    preserveOutputOnError: false,
    abortSignal: signal,
  })
}

async function numstatUnstaged(
  signal?: AbortSignal,
): Promise<NumstatSnapshot | null> {
  const { stdout, code } = await runGit([...BASE_DIFF_FLAGS, '--numstat'], signal)
  if (code !== 0) return null
  return parseGitNumstat(stdout, Number.POSITIVE_INFINITY)
}

/** `--shortstat` totals: O(1) memory, so a huge diff is caught before enumeration. */
async function shortstatAgainst(
  ref: string,
  signal?: AbortSignal,
): Promise<GitDiffStats | null> {
  const { stdout, code } = await runGit(
    [...BASE_DIFF_FLAGS, ref, '--shortstat'],
    signal,
  )
  return code === 0 ? parseShortstat(stdout) : null
}

async function numstatAgainst(
  ref: string,
  signal?: AbortSignal,
): Promise<NumstatSnapshot | null> {
  const quick = await shortstatAgainst(ref, signal)
  if (quick && quick.filesCount > MAX_FILES_FOR_DETAILS) {
    return { stats: quick, perFileStats: new Map() }
  }

  const { stdout, code } = await runGit(
    [...BASE_DIFF_FLAGS, ref, '--numstat'],
    signal,
  )
  if (code !== 0) return null
  return parseGitNumstat(stdout)
}

/** Scan cap for the untracked listing — each entry costs an lstat. */
const UNTRACKED_SCAN_CAP = 500

/**
 * Top up a snapshot with untracked files, within the MAX_FILES budget, and
 * return what was listed so a follow-up snapshot can reuse it.
 *
 * Paths are listed repo-wide and root-relative so they share the numstat base
 * (`-c diff.relative=false`); a plain `ls-files` from a subdirectory would
 * miss files above it.
 *
 * Untracked files last written before this session started are left out —
 * they're leftovers, not work — except with `includePreSession`, where they
 * are kept, after the fresh ones, and flagged `preSession` for the session
 * base to fold away.
 */
async function addUntrackedFiles(
  snapshot: NumstatSnapshot,
  signal: AbortSignal | undefined,
  options: {
    includePreSession?: boolean
    precomputed?: UntrackedFiles | null
  } = {},
): Promise<UntrackedFiles | null> {
  const remaining = MAX_FILES - snapshot.perFileStats.size
  if (remaining <= 0) return null

  const untracked =
    options.precomputed !== undefined
      ? options.precomputed
      : await listUntrackedFiles(
          remaining,
          signal,
          options.includePreSession ?? false,
        )
  if (untracked) {
    for (const [path, stats] of untracked) {
      if (snapshot.perFileStats.has(path)) continue
      snapshot.perFileStats.set(path, stats)
      snapshot.stats.filesCount += 1
    }
  }
  return untracked
}

async function listUntrackedFiles(
  limit: number,
  signal: AbortSignal | undefined,
  includePreSession: boolean,
): Promise<UntrackedFiles | null> {
  const root = findGitRoot(getCwd()) ?? getCwd()
  const { stdout, code } = await runGit(
    [
      '--no-optional-locks',
      '-C',
      root,
      'ls-files',
      '--others',
      '--exclude-standard',
      '--full-name',
    ],
    signal,
  )
  if (code !== 0 || !stdout.trim()) return null

  const sessionStart = getSessionStartTime()
  const listed = await Promise.all(
    stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .slice(0, UNTRACKED_SCAN_CAP)
      .map(async path => {
        try {
          const info = await lstat(join(root, path))
          return {
            path,
            preSession: Math.max(info.mtimeMs, info.ctimeMs) < sessionStart,
          }
        } catch {
          return { path, preSession: false }
        }
      }),
  )

  const kept = listed.filter(file => !file.preSession)
  if (includePreSession) kept.push(...listed.filter(file => file.preSession))
  if (kept.length === 0) return null

  const untracked: UntrackedFiles = new Map()
  for (const { path, preSession } of kept.slice(0, limit)) {
    untracked.set(path, {
      added: 0,
      removed: 0,
      isBinary: false,
      isUntracked: true,
      ...(preSession ? { preSession } : {}),
    })
  }
  return untracked
}

/**
 * Flag files whose last write predates this session. mtime is a heuristic — a
 * file touched without a content change looks "this session" — but it needs no
 * per-file git calls, which matters for a panel that refreshes on every edit.
 */
async function markPreSessionFiles(snapshot: NumstatSnapshot): Promise<void> {
  if (snapshot.perFileStats.size === 0) return

  const root = findGitRoot(getCwd()) ?? getCwd()
  const sessionStart = getSessionStartTime()

  await Promise.all(
    Array.from(snapshot.perFileStats, async ([path, stats]) => {
      try {
        const info = await lstat(join(root, path))
        if (Math.max(info.mtimeMs, info.ctimeMs) < sessionStart) {
          stats.preSession = true
        }
      } catch {
        // Deleted or unreadable — leave it in the "this session" bucket.
      }
    }),
  )
}
