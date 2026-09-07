/**
 * Live diff data for the REPL diff panel.
 *
 * Differs from `useDiffData` (the one-shot `/diff` dialog fetch) in three ways
 * the panel needs: it re-reads whenever files change, it honours a base mode,
 * and it reports what it actually compared against so the panel can explain
 * itself when the requested base wasn't available.
 */
import type { StructuredPatchHunk } from 'diff'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { DiffFile } from './useDiffData.js'
import {
  diffRefForSnapshot,
  EMPTY_DIFF_HUNKS,
  fetchDiffHunksForRef,
  fetchDiffSnapshot,
  type DiffBaseMode,
  type DiffHunks,
  type DiffSnapshot,
  type DiffSource,
} from '../utils/diffPanelData.js'
import { fileHistoryEnabled } from '../utils/fileHistory.js'
import { logError } from '../utils/log.js'

const MAX_LINES_PER_FILE = 400

/**
 * Debounce for refreshes triggered by edits. The first read of a session runs
 * immediately so the panel isn't blank when it opens; later ones coalesce, since
 * a multi-file edit turn would otherwise fire one git pass per file.
 */
const REFRESH_DEBOUNCE_MS = 150

/**
 * Safety-net poll. `changeKey` only advances on file-history snapshots, so it
 * misses two things: edits made outside this session (another terminal, a
 * formatter, `git checkout`), and every edit at all when file checkpointing is
 * turned off. Polling faster in the latter case, since then it is the *only*
 * refresh signal. Only runs while the panel is open.
 */
const POLL_MS_WITH_FILE_HISTORY = 10_000
const POLL_MS_WITHOUT_FILE_HISTORY = 2_000

export type PanelDiffData = {
  stats: { filesCount: number; linesAdded: number; linesRemoved: number } | null
  files: DiffFile[]
  hunks: Map<string, StructuredPatchHunk[]>
  loading: boolean
  /** What the diff was actually taken against. */
  source: DiffSource
  /** The base that produced this data — may lag the requested one mid-refresh. */
  baseMode: DiffBaseMode
  /** True when the repo has no commits, so there is nothing to diff against. */
  noCommits?: boolean
}

type Loaded = {
  snapshot: DiffSnapshot
  baseMode: DiffBaseMode
  hunks: DiffHunks
}

const EMPTY: PanelDiffData = {
  stats: null,
  files: [],
  hunks: new Map(),
  loading: false,
  source: { kind: 'working-tree' },
  baseMode: 'session',
}

export function usePanelDiffData(
  /** Bump to force a refresh — the file-history snapshot counter. */
  changeKey: number,
  enabled: boolean,
  baseMode: DiffBaseMode,
): PanelDiffData {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [loading, setLoading] = useState(true)
  const [pollTick, setPollTick] = useState(0)
  // Once a read has completed we always debounce; before that, load eagerly.
  const hasLoadedOnce = useRef(false)

  useEffect(() => {
    if (!enabled) return
    const period = fileHistoryEnabled()
      ? POLL_MS_WITH_FILE_HISTORY
      : POLL_MS_WITHOUT_FILE_HISTORY
    const timer = setInterval(() => setPollTick(tick => tick + 1), period)
    return () => clearInterval(timer)
  }, [enabled])

  useEffect(() => {
    if (!enabled) return

    let cancelled = false
    const controller = new AbortController()

    async function read(): Promise<void> {
      try {
        const snapshot = await fetchDiffSnapshot(baseMode, controller.signal)
        if (cancelled) return
        if (snapshot === null) {
          hasLoadedOnce.current = true
          setLoading(false)
          setLoaded(null)
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
          // against the same ref — better a slightly stale patch than none.
          hunks:
            hunks ??
            (previous !== null && diffRefForSnapshot(previous.snapshot) === ref
              ? previous.hunks
              : EMPTY_DIFF_HUNKS),
        }))
        hasLoadedOnce.current = true
        setLoading(false)
      } catch (error) {
        if (cancelled) return
        logError(error)
        hasLoadedOnce.current = true
        setLoading(false)
      }
    }

    const delay =
      hasLoadedOnce.current || changeKey !== 0 ? REFRESH_DEBOUNCE_MS : 0
    const timer = setTimeout(read, delay)

    return () => {
      cancelled = true
      clearTimeout(timer)
      controller.abort()
    }
  }, [changeKey, pollTick, enabled, baseMode])

  return useMemo(() => {
    if (!loaded) {
      return { ...EMPTY, loading: enabled && loading, baseMode }
    }

    const { snapshot, hunks } = loaded
    const files: DiffFile[] = []

    for (const [path, stats] of snapshot.perFileStats) {
      const isUntracked = stats.isUntracked ?? false
      const isLargeFile = hunks.skippedLarge.has(path)
      const totalLines = stats.added + stats.removed
      const isTruncated =
        !isLargeFile && !stats.isBinary && totalLines > MAX_LINES_PER_FILE

      files.push({
        path,
        linesAdded: stats.added,
        linesRemoved: stats.removed,
        isBinary: stats.isBinary,
        isLargeFile,
        isTruncated,
        isUntracked,
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
