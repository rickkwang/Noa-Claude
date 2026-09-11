import type { StructuredPatchHunk } from 'diff'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  diffRefForSnapshot,
  EMPTY_DIFF_HUNKS,
  fetchDiffHunksForRef,
  fetchDiffSnapshot,
  type DiffFetchMode,
  type DiffHunks,
  type DiffSnapshot,
  type DiffSource,
} from '../utils/diffData.js'
import { subscribeToGitState } from '../utils/git/gitFilesystem.js'
import type { GitDiffStats } from '../utils/gitDiff.js'
import { logError } from '../utils/log.js'

const MAX_LINES_PER_FILE = 400

/**
 * Debounce for refreshes. The first read runs immediately so a view isn't
 * blank when it opens; later ones coalesce, since a multi-file edit turn would
 * otherwise fire one git pass per file.
 */
const REFRESH_DEBOUNCE_MS = 150

export type DiffFile = {
  path: string
  linesAdded: number
  linesRemoved: number
  isBinary: boolean
  isLargeFile: boolean
  isTruncated: boolean
  isNewFile?: boolean
  isUntracked?: boolean
  /** The file's last write predates this session — `session` mode only. */
  preSession?: boolean
}

export type DiffData = {
  stats: GitDiffStats | null
  files: DiffFile[]
  hunks: Map<string, StructuredPatchHunk[]>
  loading: boolean
  /** What the diff was actually taken against. */
  source: DiffSource
  /** The mode that produced this data — lags the requested one mid-refresh. */
  baseMode: DiffFetchMode
  /** True when the repo has no commits, so the diff is against the index. */
  noCommits?: boolean
}

type Loaded = {
  snapshot: DiffSnapshot
  baseMode: DiffFetchMode
  hunks: DiffHunks
}

/**
 * Git diff data for `/diff`. Re-reads when `changeKey` advances (the
 * file-history activity counter) and whenever the repo's committed state moves
 * — a commit or checkout changes what the diff is taken against.
 */
export function useDiffData(
  changeKey = 0,
  enabled = true,
  baseMode: DiffFetchMode = 'auto',
): DiffData {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [loading, setLoading] = useState(true)
  const [gitStateTick, setGitStateTick] = useState(0)
  const hasLoadedOnce = useRef(false)

  useEffect(() => subscribeToGitState(() => setGitStateTick(tick => tick + 1)), [])

  useEffect(() => {
    if (!enabled) return

    let cancelled = false
    const controller = new AbortController()

    async function read(): Promise<void> {
      try {
        const snapshot = await fetchDiffSnapshot(baseMode, controller.signal)
        if (cancelled) return
        if (snapshot === null) {
          // Keep whatever was last read: null covers a whole merge or rebase
          // as well as a transient git failure, and blanking for either would
          // be worse than a slightly stale view.
          hasLoadedOnce.current = true
          setLoading(false)
          return
        }

        const ref = diffRefForSnapshot(snapshot)
        const hunks =
          snapshot.stats.filesCount === 0
            ? EMPTY_DIFF_HUNKS
            : await fetchDiffHunksForRef(ref, controller.signal)
        if (cancelled) return

        setLoaded(previous => ({
          snapshot,
          baseMode,
          // A failed hunk read keeps the previous hunks when they were taken
          // against the same ref.
          hunks:
            hunks ??
            (previous !== null && diffRefForSnapshot(previous.snapshot) === ref
              ? previous.hunks
              : EMPTY_DIFF_HUNKS),
        }))
      } catch (error) {
        if (cancelled) return
        logError(error)
      }
      hasLoadedOnce.current = true
      setLoading(false)
    }

    const delay =
      hasLoadedOnce.current || changeKey !== 0 ? REFRESH_DEBOUNCE_MS : 0
    const timer = setTimeout(read, delay)

    return () => {
      cancelled = true
      clearTimeout(timer)
      controller.abort()
    }
  }, [changeKey, gitStateTick, enabled, baseMode])

  return useMemo(() => {
    if (!loaded) {
      return {
        stats: null,
        files: [],
        hunks: new Map(),
        loading: enabled && loading,
        source: { kind: 'working-tree' },
        baseMode,
      }
    }

    const { snapshot, hunks } = loaded
    const files: DiffFile[] = []
    for (const [path, stats] of snapshot.perFileStats) {
      const isLargeFile = hunks.skippedLarge.has(path)
      files.push({
        path,
        linesAdded: stats.added,
        linesRemoved: stats.removed,
        isBinary: stats.isBinary,
        isLargeFile,
        isTruncated:
          !isLargeFile &&
          !stats.isBinary &&
          stats.added + stats.removed > MAX_LINES_PER_FILE,
        isUntracked: stats.isUntracked ?? false,
        preSession: stats.preSession ?? false,
      })
    }
    files.sort((a, b) => a.path.localeCompare(b.path))

    return {
      stats: snapshot.stats,
      files,
      hunks: hunks.hunks,
      loading: false,
      source: snapshot.source,
      baseMode: loaded.baseMode,
      noCommits: snapshot.noCommits,
    }
  }, [loaded, loading, enabled, baseMode])
}
