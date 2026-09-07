/**
 * Base-mode-aware git diff collection for the REPL diff panel.
 *
 * The panel is long-lived, so unlike `fetchGitDiff()` (a one-shot snapshot for
 * the `/diff` dialog) this layer answers three different questions depending on
 * the user's chosen base:
 *
 * - `session`     — everything uncommitted, split into "changed this session"
 *                   and "already dirty when we started" (see {@link markPreSessionFiles}).
 * - `uncommitted` — everything uncommitted vs HEAD, no session split.
 * - `branch`      — a PR-shaped diff against the merge base with the default
 *                   branch, falling back to HEAD when there is no base branch.
 *
 * Hunks are fetched separately (and against the ref the snapshot resolved to)
 * so a stats refresh doesn't have to re-parse megabytes of patch text.
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
  parseGitDiffDetailed,
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
  '--ignore-submodules=all',
] as const

type NumstatSnapshot = {
  stats: GitDiffStats
  perFileStats: Map<string, PerFileStats>
}

/**
 * Collect diff stats for the panel. Returns null when the answer would be
 * misleading: outside a git repo, or mid merge/rebase/cherry-pick/revert where
 * the working tree holds incoming changes nobody here made.
 */
export async function fetchDiffSnapshot(
  baseMode: DiffBaseMode,
  signal?: AbortSignal,
): Promise<DiffSnapshot | null> {
  if (!(await getIsGit())) return null
  if (await isInTransientGitState()) return null

  if (baseMode === 'branch') {
    return fetchBranchSnapshot(signal)
  }

  const headDiff = await numstatAgainst('HEAD', signal)
  // No HEAD to diff against — either a fresh repo or a broken one.
  if (headDiff === null) return fetchNoCommitsSnapshot(signal)

  const workingTree = (snapshot: NumstatSnapshot): DiffSnapshot => ({
    ...snapshot,
    source: { kind: 'working-tree' },
  })

  // Above this many files we report accurate totals but skip per-file work.
  if (headDiff.stats.filesCount > MAX_FILES_FOR_DETAILS) {
    return workingTree(headDiff)
  }

  if (baseMode === 'session') {
    // Untracked files mark their own preSession flag inside addUntrackedFiles,
    // so the two enrichments can race each other safely.
    await Promise.all([
      markPreSessionFiles(headDiff),
      addUntrackedFiles(headDiff, true, signal),
    ])
    return workingTree(headDiff)
  }

  // Only 'uncommitted' remains: 'session' returned above and 'branch' at the
  // top, so this is a plain working-tree snapshot of everything vs HEAD —
  // untracked files included, however old.
  await addUntrackedFiles(headDiff, false, signal)
  return workingTree(headDiff)
}

/** The git ref a snapshot's hunks must be read against. */
export function diffRefForSnapshot(snapshot: DiffSnapshot): string {
  if (snapshot.noCommits) return '--cached'
  return snapshot.source.kind === 'branch' ? snapshot.source.baseRef : 'HEAD'
}

/**
 * Read the patch text for `ref` and parse it into per-file hunks.
 * Returns null when git fails, so the caller can keep showing the last good
 * hunks rather than blanking the panel on a transient error.
 */
export async function fetchDiffHunksForRef(
  ref: string,
  signal?: AbortSignal,
): Promise<DiffHunks | null> {
  if (!(await getIsGit())) return null
  if (await isInTransientGitState()) return null

  const { stdout: shortstatOut, code: shortstatCode } = await execFileNoThrow(
    gitExe(),
    [...BASE_DIFF_FLAGS, ref, '--shortstat'],
    { timeout: GIT_TIMEOUT_MS, preserveOutputOnError: false, abortSignal: signal },
  )
  if (shortstatCode === 0) {
    const quick = parseShortstat(shortstatOut)
    if (quick && quick.filesCount > MAX_FILES_FOR_DETAILS) {
      return EMPTY_DIFF_HUNKS
    }
  }

  const { stdout, code } = await execFileNoThrow(
    gitExe(),
    [...BASE_DIFF_FLAGS, ...RAW_DIFF_FLAGS, ref],
    { timeout: GIT_TIMEOUT_MS, preserveOutputOnError: false, abortSignal: signal },
  )
  if (code !== 0) return null

  const parsed = parseGitDiffDetailed(stdout)

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
 * The three non-error outcomes are meaningfully different to the panel:
 * - `merge-base`   — a real branch diff.
 * - `head-is-base` — we're sitting on the default branch, so a "branch diff" is
 *                    just the working tree; still labelled with the branch name.
 * - `no-base`      — no default branch exists here at all (a local-only repo).
 *                    Fall back to a HEAD diff and say so, rather than showing
 *                    nothing.
 */
type BranchBase =
  | { kind: 'merge-base'; baseBranch: string; mergeBase: string }
  | { kind: 'head-is-base'; baseBranch: string }
  | { kind: 'no-base' }
  | { kind: 'error' }

async function resolveBranchBase(signal?: AbortSignal): Promise<BranchBase> {
  const [currentBranch, defaultBranch] = await Promise.all([
    getBranch(),
    getDefaultBranch(),
  ])
  // Detached HEAD: there is no "my branch" to compare against a base.
  if (!currentBranch || currentBranch === 'HEAD') return { kind: 'no-base' }
  const baseBranch = process.env.CLAUDE_CODE_BASE_REF || defaultBranch
  if (!baseBranch || baseBranch.startsWith('-')) return { kind: 'no-base' }
  // Sitting on the base branch: a "branch diff" is just the working tree.
  if (currentBranch === baseBranch) return { kind: 'head-is-base', baseBranch }

  const options = {
    timeout: GIT_TIMEOUT_MS,
    preserveOutputOnError: false as const,
    abortSignal: signal,
  }
  const run = (args: string[]) => execFileNoThrow(gitExe(), args, options)

  // Try the remote-tracking ref first, then the local branch; when both merge
  // bases exist, keep the later one (a stale local main would otherwise diff
  // against ancient history and blame this branch for upstream's commits).
  let sawNoMergeBase = false
  const candidates: string[] = []
  for (const ref of [`origin/${baseBranch}`, baseBranch]) {
    const { stdout, code } = await run([
      '--no-optional-locks',
      'merge-base',
      'HEAD',
      ref,
    ])
    if (code === 1) sawNoMergeBase = true
    if (code === 0 && stdout.trim()) candidates.push(stdout.trim())
  }

  let mergeBase: string | null = null
  if (candidates.length > 0) {
    const [first, second] = candidates
    if (second === undefined || second === first) {
      mergeBase = first ?? null
    } else {
      const { code } = await run([
        '--no-optional-locks',
        'merge-base',
        '--is-ancestor',
        first ?? '',
        second,
      ])
      mergeBase = code === 0 ? second : first ?? null
    }
  }

  if (mergeBase === null) {
    // merge-base exit 1 means the histories genuinely share no ancestor.
    if (sawNoMergeBase) return { kind: 'no-base' }
    // Otherwise the base ref itself is missing — unless it exists and the
    // merge-base call failed for some other reason, which is a real error.
    for (const ref of [
      `refs/remotes/origin/${baseBranch}`,
      `refs/heads/${baseBranch}`,
    ]) {
      const { code } = await run([
        '--no-optional-locks',
        'show-ref',
        '--verify',
        '--quiet',
        ref,
      ])
      if (code === 0) return { kind: 'error' }
    }
    return { kind: 'no-base' }
  }

  const { stdout: headOut, code: headCode } = await run([
    '--no-optional-locks',
    'rev-parse',
    'HEAD',
  ])
  if (headCode !== 0) return { kind: 'error' }
  if (headOut.trim() === mergeBase) {
    return { kind: 'head-is-base', baseBranch }
  }
  return { kind: 'merge-base', baseBranch, mergeBase }
}

/**
 * The panel only ever asks for `branch` explicitly, so this always degrades to
 * a HEAD diff (and says so) when no base branch exists, rather than returning
 * null. (Upstream additionally calls here with an implicit "auto" mode for the
 * /diff dialog — the panel has no such caller, so the parameter is gone.)
 */
async function fetchBranchSnapshot(
  signal: AbortSignal | undefined,
): Promise<DiffSnapshot | null> {
  const base = await resolveBranchBase(signal)
  if (base.kind === 'error') {
    return fetchNoCommitsSnapshot(signal)
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
    // No branch-shaped diff exists; fall back to a HEAD diff.
    numstat = await numstatAgainst('HEAD', signal)
    source =
      base.kind === 'head-is-base'
        ? { kind: 'branch', baseBranch: base.baseBranch, baseRef: 'HEAD' }
        : { kind: 'working-tree' }
  }

  if (numstat === null) {
    return base.kind === 'merge-base' ? null : fetchNoCommitsSnapshot(signal)
  }

  if (numstat.stats.filesCount <= MAX_FILES_FOR_DETAILS) {
    await addUntrackedFiles(numstat, false, signal)
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
  const { code } = await execFileNoThrow(
    gitExe(),
    ['--no-optional-locks', 'rev-parse', '--verify', '--quiet', 'HEAD'],
    { timeout: GIT_TIMEOUT_MS, preserveOutputOnError: false, abortSignal: signal },
  )
  // exit 1 is specifically "HEAD does not resolve"; anything else is a real
  // failure and shouldn't be reported as an empty repo.
  if (code !== 1) return null

  const snapshot: DiffSnapshot = {
    stats: { filesCount: 0, linesAdded: 0, linesRemoved: 0 },
    perFileStats: new Map(),
    source: { kind: 'working-tree' },
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

  await addUntrackedFiles(snapshot, false, signal)
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

async function numstatUnstaged(
  signal?: AbortSignal,
): Promise<NumstatSnapshot | null> {
  const { stdout, code } = await execFileNoThrow(
    gitExe(),
    [...BASE_DIFF_FLAGS, '--numstat'],
    { timeout: GIT_TIMEOUT_MS, preserveOutputOnError: false, abortSignal: signal },
  )
  if (code !== 0) return null
  return parseGitNumstat(stdout, Number.POSITIVE_INFINITY)
}

async function numstatAgainst(
  ref: string,
  signal?: AbortSignal,
): Promise<NumstatSnapshot | null> {
  // Cheap probe first: --shortstat is O(1) memory, so a huge diff is detected
  // before we ask git to enumerate every file.
  const { stdout: shortstatOut, code: shortstatCode } = await execFileNoThrow(
    gitExe(),
    [...BASE_DIFF_FLAGS, ref, '--shortstat'],
    { timeout: GIT_TIMEOUT_MS, preserveOutputOnError: false, abortSignal: signal },
  )
  if (shortstatCode === 0) {
    const quick = parseShortstat(shortstatOut)
    if (quick && quick.filesCount > MAX_FILES_FOR_DETAILS) {
      return { stats: quick, perFileStats: new Map() }
    }
  }

  const { stdout, code } = await execFileNoThrow(
    gitExe(),
    [...BASE_DIFF_FLAGS, ref, '--numstat'],
    { timeout: GIT_TIMEOUT_MS, preserveOutputOnError: false, abortSignal: signal },
  )
  if (code !== 0) return null
  return parseGitNumstat(stdout)
}

/** Scan cap for the untracked listing — stats are per-file lstats, so bound them. */
const UNTRACKED_SCAN_CAP = 500

/**
 * Top up a snapshot with untracked files, respecting the MAX_FILES budget.
 *
 * Panel-local (the /diff dialog keeps its own cwd-relative fetcher): paths are
 * fetched repo-wide and root-relative so they share the numstat base
 * (`-c diff.relative=false`) — running plain `ls-files` from a subdirectory
 * would report cwd-relative paths and silently drop files above it.
 *
 * Fresh files win the MAX_FILES budget first: when a repo has more untracked
 * files than the panel can show, the ones touched this session are the ones
 * worth showing. Nothing is dropped for being old — an untracked file created
 * last week is still uncommitted.
 *
 * `flagPreSession` controls only whether the age is *recorded*. Session mode
 * folds flagged files into its "edited before this session" section; the other
 * bases have no session boundary to speak of, so flagging there would hide
 * files behind a heading that doesn't apply to them.
 */
async function addUntrackedFiles(
  snapshot: NumstatSnapshot,
  flagPreSession: boolean,
  signal?: AbortSignal,
): Promise<void> {
  const remaining = MAX_FILES - snapshot.perFileStats.size
  if (remaining <= 0) return

  const root = findGitRoot(getCwd()) ?? getCwd()
  const { stdout, code } = await execFileNoThrow(
    gitExe(),
    [
      '--no-optional-locks',
      '-C',
      root,
      'ls-files',
      '--others',
      '--exclude-standard',
      '--full-name',
    ],
    { timeout: GIT_TIMEOUT_MS, preserveOutputOnError: false, abortSignal: signal },
  )
  if (code !== 0 || !stdout.trim()) return

  const sessionStart = getSessionStartTime()
  const marked = await Promise.all(
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
            preSession:
              Math.max(info.mtimeMs, info.ctimeMs) < sessionStart,
          }
        } catch {
          // Vanished between listing and stat — treat as fresh.
          return { path, preSession: false }
        }
      }),
  )

  const ordered = [
    ...marked.filter(file => !file.preSession),
    ...marked.filter(file => file.preSession),
  ]

  for (const { path, preSession } of ordered.slice(0, remaining)) {
    if (snapshot.perFileStats.has(path)) continue
    snapshot.perFileStats.set(path, {
      added: 0,
      removed: 0,
      isBinary: false,
      isUntracked: true,
      ...(flagPreSession && preSession ? { preSession: true } : {}),
    })
    snapshot.stats.filesCount += 1
  }
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
