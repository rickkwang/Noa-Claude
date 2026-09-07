/**
 * The REPL diff sidebar — a live, always-visible view of what has changed,
 * rendered beside the transcript rather than as a modal over it.
 *
 * `DiffPanelHost` owns the mount decision and the `/diff` toggle; `DiffPanel`
 * is the sidebar itself and only renders once the layout has given it a width.
 * The modal `DiffDialog` still exists for the cases the sidebar can't serve
 * (non-fullscreen, narrow terminals, non-git directories, per-turn diffs).
 */
import type { StructuredPatchHunk } from 'diff'
import { resolve } from 'path'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNotifications } from '../../context/notifications.js'
import { getSessionId } from '../../bootstrap/state.js'
import { usePanelDiffData } from '../../hooks/usePanelDiffData.js'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import type { DiffFile } from '../../hooks/useDiffData.js'
import { Box, Text } from '../../ink.js'
import type { DOMElement } from '../../ink/dom.js'
import ScrollBox, {
  type ScrollBoxHandle,
} from '../../ink/components/ScrollBox.js'
import { useRegisterKeybindingContext } from '../../keybindings/KeybindingContext.js'
import { useKeybinding } from '../../keybindings/useKeybinding.js'
import { useShortcutDisplay } from '../../keybindings/useShortcutDisplay.js'
import { useAppState, useSetAppState } from '../../state/AppState.js'
import type { AppState } from '../../state/AppStateStore.js'
import type { DiffBaseMode, DiffSource } from '../../utils/diffPanelData.js'
import { getCwd } from '../../utils/cwd.js'
import { findGitRoot } from '../../utils/git.js'
import {
  closeDiffPanel,
  cycleDiffBaseMode,
  describeDiffBase,
  diffPanelWidth,
  dismissDiffPanel,
  getDiffBaseMode,
  isGitRepo,
  MIN_DIFF_PANEL_COLUMNS,
  NO_GIT_REPO_MESSAGE,
  shouldAutoOpenDiffPanel,
  toggleReplTab,
  tooNarrowMessage,
  type ReplTab,
} from '../../utils/diffPanelState.js'
import { readFileSafe } from '../../utils/file.js'
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js'
import { isGeneratedFile, isTestFile } from '../../utils/generatedFiles.js'
import { matchingRuleForInput } from '../../utils/permissions/filesystem.js'
import { plural } from '../../utils/stringUtils.js'
import type { TodoList } from '../../utils/todo/types.js'
import { truncatePathMiddle } from '../../utils/truncate.js'
import { Divider } from '../design-system/Divider.js'
import { ProgressBar } from '../design-system/ProgressBar.js'
import { StructuredDiff } from '../StructuredDiff.js'

// StructuredDiff lives in a type-unchecked module, so its prop types don't
// survive the import. Re-declare them here rather than opting this file out.
const TypedStructuredDiff = StructuredDiff as (props: {
  patch: StructuredPatchHunk
  filePath: string
  firstLine: string | null
  fileContent?: string
  dim: boolean
  width: number
}) => React.ReactNode

/** File-list rows shown before the "N more below" fold. */
const FILE_LIST_ROWS = 8

/** Above this many pre-session files we list names only, no diffs. */
const MAX_PRE_SESSION_DIFFS = 20

const selectReplTab = (state: AppState): ReplTab => state.replTab
const selectTrackedFileCount = (state: AppState): number =>
  state.fileHistory.trackedFiles.size
const selectSnapshotSequence = (state: AppState): number =>
  state.fileHistory.snapshotSequence ?? 0
type PanelPermissionContext = AppState['toolPermissionContext']
const selectToolPermissionContext = (
  state: AppState,
): PanelPermissionContext => state.toolPermissionContext
const selectTodos = (state: AppState): TodoList | undefined =>
  state.todos[getSessionId()]

type HostProps = {
  /** Columns the layout reserved for the panel; 0 means don't render. */
  width: number
  isThinClient: boolean
}

/**
 * Owns the `/diff` toggle and the first-edit auto-open, independent of whether
 * the panel is currently visible — the toggle has to work (and explain itself)
 * precisely when the panel is *not* showing.
 */
export function DiffPanelHost({
  width,
  isThinClient,
}: HostProps): React.ReactNode {
  const replTab = useAppState(selectReplTab) as ReplTab
  const setAppState = useSetAppState()
  const { columns } = useTerminalSize()
  const trackedFileCount = useAppState(selectTrackedFileCount) as number
  // The count at the moment the host mounted. Auto-open is for "the first edit
  // of a session that started clean" — if the panel comes up (or fullscreen
  // flips on) with files already tracked, those are context, not a trigger.
  const [autoOpenBaseline] = useState(() => trackedFileCount)
  const setReplTab = useCallback(
    (tab: ReplTab) => {
      setAppState(previous =>
        previous.replTab === tab ? previous : { ...previous, replTab: tab },
      )
    },
    [setAppState],
  )

  // Open the panel unprompted the first time this session touches a file —
  // the moment the panel has something to say and the user hasn't had to ask.
  useEffect(() => {
    if (replTab !== 'convo' || trackedFileCount === 0) return
    if (trackedFileCount === autoOpenBaseline) return
    if (!isFullscreenEnvEnabled() || isThinClient) return
    if (!shouldAutoOpenDiffPanel(columns)) return
    setReplTab('diff')
  }, [replTab, trackedFileCount, autoOpenBaseline, columns, isThinClient, setReplTab])

  const toggle = useToggleDiffPanel()

  useKeybinding('app:toggleReplTab', toggle, {
    context: 'Global',
    isActive: isFullscreenEnvEnabled() && !isThinClient,
  })

  const visible = replTab === 'diff' && width > 0

  // Losing fullscreen or landing on a thin client removes the panel's reason to
  // exist, so drop the tab rather than leaving state that can never render.
  // Deliberately not done for a narrow terminal or an agent transcript: those
  // are temporary, the width calculation already hides the panel, and keeping
  // the tab means it comes straight back when they end.
  useEffect(() => {
    if (replTab !== 'diff') return
    if (isFullscreenEnvEnabled() && !isThinClient) return
    closeDiffPanel(setReplTab)
  }, [replTab, isThinClient, setReplTab])

  if (!visible) return null
  return <DiffPanel width={width} />
}

/**
 * The `/diff` action: flip the sidebar, or explain why it can't open.
 *
 * Shared by the `app:toggleReplTab` keybinding and the `/diff` command so both
 * enforce the same preconditions — an unresponsive `/diff` is indistinguishable
 * from a bug, so every refusal says why.
 */
export function useToggleDiffPanel(): () => void {
  const replTab = useAppState(selectReplTab) as ReplTab
  const setAppState = useSetAppState()
  const { columns } = useTerminalSize()
  const { addNotification } = useNotifications()

  const setReplTab = useCallback(
    (tab: ReplTab) => {
      setAppState(previous =>
        previous.replTab === tab ? previous : { ...previous, replTab: tab },
      )
    },
    [setAppState],
  )

  return useCallback(() => {
    if (replTab !== 'diff') {
      if (!isGitRepo()) {
        addNotification({
          key: 'diff-sidebar-no-git',
          text: NO_GIT_REPO_MESSAGE,
          priority: 'immediate',
          timeoutMs: 3000,
        })
        return
      }
      if (columns < MIN_DIFF_PANEL_COLUMNS) {
        addNotification({
          key: 'diff-sidebar-too-narrow',
          text: tooNarrowMessage(),
          priority: 'immediate',
          timeoutMs: 3000,
        })
        return
      }
    }
    toggleReplTab(replTab, setReplTab)
  }, [replTab, columns, addNotification, setReplTab])
}

/**
 * Compute the width the layout should reserve for the panel this render.
 * Exported so REPL can size the transcript in the same pass.
 */
export function useDiffPanelWidth(
  isThinClient: boolean,
  isMainFocused: boolean,
): number {
  const replTab = useAppState(selectReplTab) as ReplTab
  const { columns } = useTerminalSize()
  const hasGitRepo = useHasGitRepo()
  return diffPanelWidth(replTab, {
    fullscreen: isFullscreenEnvEnabled(),
    columns,
    isThinClient,
    isMainFocused,
    hasGitRepo,
  })
}

/**
 * `findGitRoot` is memoized and cheap, but a `git init` mid-session should still
 * be picked up — so re-check whenever files change or the tab flips.
 */
function useHasGitRepo(): boolean {
  const trackSequence = useAppState(selectSnapshotSequence) as number
  const replTab = useAppState(selectReplTab) as ReplTab
  const cwd = getCwd()
  return useMemo(
    () => isGitRepo(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-probe triggers
    [cwd, trackSequence, replTab],
  )
}

type PanelProps = { width: number }

function DiffPanel({ width }: PanelProps): React.ReactNode {
  const setAppState = useSetAppState()
  const trackSequence = useAppState(selectSnapshotSequence) as number
  const permissionContext = useAppState(selectToolPermissionContext) as PanelPermissionContext

  // Chord resolution and handler dispatch both run against the *registered*
  // active contexts, so `ctrl+x b` only reaches the panel while this is on.
  useRegisterKeybindingContext('DiffPanel', true)

  // Tell the notification layer the panel is on screen, so transient toasts
  // wait rather than pulling the eye off a diff. Draining the queue on unmount
  // is what makes anything held during that time show promptly afterwards.
  const { processQueue } = useNotifications()
  useEffect(() => {
    setAppState(previous =>
      previous.diffPanelVisible
        ? previous
        : { ...previous, diffPanelVisible: true },
    )
    return () => {
      setAppState(previous =>
        previous.diffPanelVisible
          ? { ...previous, diffPanelVisible: false }
          : previous,
      )
      processQueue()
    }
  }, [setAppState, processQueue])

  const [baseMode, setBaseMode] = useState<DiffBaseMode>(getDiffBaseMode)
  const cycleBase = useCallback(
    () => setBaseMode(current => cycleDiffBaseMode(current)),
    [],
  )
  useKeybinding('app:cycleDiffBase', cycleBase, { context: 'DiffPanel' })

  const {
    stats,
    files,
    hunks,
    loading,
    source,
    baseMode: loadedBaseMode,
    noCommits,
  } = usePanelDiffData(trackSequence, true, baseMode)

  const [showNoise, setShowNoise] = useState(false)
  const [showPreSession, setShowPreSession] = useState(false)
  const [listOffset, setListOffset] = useState(0)

  const contentWidth = Math.max(width - 2, 20)

  const setReplTab = useCallback(
    (tab: ReplTab) => {
      setAppState(previous =>
        previous.replTab === tab ? previous : { ...previous, replTab: tab },
      )
    },
    [setAppState],
  )

  const partitioned = useMemo(
    () => partitionFiles(files, permissionContext, showNoise),
    [files, permissionContext, showNoise],
  )
  const { visible, preSession, noiseCount, deniedCount } = partitioned

  const toggleNoise = useCallback(() => setShowNoise(v => !v), [])
  const togglePreSession = useCallback(() => setShowPreSession(v => !v), [])
  useKeybinding('app:toggleDiffNoiseFilter', toggleNoise, {
    context: 'Global',
    isActive: noiseCount > 0,
  })
  useKeybinding('app:toggleDiffPreSession', togglePreSession, {
    context: 'Global',
    isActive: preSession.length > 0,
  })

  const maxOffset = Math.max(0, visible.length - FILE_LIST_ROWS)
  const scrollList = useCallback(
    (delta: number) => {
      setListOffset(current =>
        Math.min(Math.max(Math.min(current, maxOffset) + delta, 0), maxOffset),
      )
    },
    [maxOffset],
  )
  const scrollListUp = useCallback(() => scrollList(-1), [scrollList])
  const scrollListDown = useCallback(() => scrollList(1), [scrollList])
  useKeybinding('app:diffFileListUp', scrollListUp, {
    context: 'Global',
    isActive: maxOffset > 0,
  })
  useKeybinding('app:diffFileListDown', scrollListDown, {
    context: 'Global',
    isActive: maxOffset > 0,
  })

  const scrollDownShortcut = useShortcutDisplay(
    'app:diffFileListDown',
    'Global',
    'ctrl+down',
  )
  const offset = Math.min(listOffset, maxOffset)
  const rows = visible.slice(offset, offset + FILE_LIST_ROWS)
  const below = visible.length - (offset + rows.length)

  // Header counts describe the current session's work, so pre-session files are
  // subtracted out — except when *everything* is pre-session, where showing
  // zeroes would be more confusing than showing the totals.
  const allPreSession =
    files.length > 0 &&
    preSession.length === files.length &&
    noiseCount === 0 &&
    deniedCount === 0
  const preSessionTotals = preSession.reduce(
    (acc, file) => ({
      added: acc.added + file.linesAdded,
      removed: acc.removed + file.linesRemoved,
    }),
    { added: 0, removed: 0 },
  )
  const headerFiles = allPreSession
    ? 0
    : (stats?.filesCount ?? files.length) - preSession.length
  const headerAdded = allPreSession
    ? 0
    : (stats?.linesAdded ?? 0) - preSessionTotals.added
  const headerRemoved = allPreSession
    ? 0
    : (stats?.linesRemoved ?? 0) - preSessionTotals.removed
  // Files git counted but we never listed (over the per-file detail cap).
  const notShown = Math.max(0, headerFiles - (files.length - preSession.length))

  const empty = describeEmptyState({
    loading,
    stats,
    headerFiles,
    noCommits,
    baseMode: loadedBaseMode,
    source,
  })

  // Upstream also scrolls the panel body and the file-list window on hover
  // wheel. Not ported: this ink fork routes the wheel through a global
  // keybinding rather than per-Box `onWheel`, so there is no hit-tested target
  // to attach it to. Keyboard scrolling covers both.
  const scrollRef = useRef<ScrollBoxHandle>(null)
  const fileAnchors = useRef(new Map<string, DOMElement>())
  const scrollToFile = useCallback((path: string) => {
    const node = fileAnchors.current.get(path)
    if (node) scrollRef.current?.scrollToElement(node)
  }, [])

  return (
    <Box
      flexDirection="column"
      width={width}
      flexShrink={0}
      height="100%"
      overflow="hidden"
    >
      <Box flexDirection="column" paddingX={1} paddingY={1} flexShrink={0}>
        <Box flexDirection="row">
          {empty.title !== null ? (
            <Text dimColor wrap="truncate">
              {empty.title}
            </Text>
          ) : (
            <Text>
              <Text bold>
                {headerFiles} {plural(headerFiles, 'file')}
              </Text>{' '}
              changed
              {(headerAdded > 0 || headerRemoved > 0) && ' '}
              <LineCounts added={headerAdded} removed={headerRemoved} />
            </Text>
          )}
          <Box flexGrow={1} />
          <ClosePanelButton onClose={() => dismissDiffPanel(setReplTab)} />
        </Box>
        {stats !== null &&
          (noCommits ? (
            headerFiles > 0 && (
              <Text dimColor>no commits yet — showing staged and new files</Text>
            )
          ) : baseMode !== 'session' || loadedBaseMode !== 'session' ? (
            <Text dimColor>
              {describeDiffBase(baseMode, source, baseMode !== loadedBaseMode)}
            </Text>
          ) : null)}
        <TodoProgress width={contentWidth} />
        {(rows.length > 0 || noiseCount > 0) && (
          <Box flexDirection="column" marginTop={1}>
            {offset > 0 && <Text dimColor>↑ {offset} more above</Text>}
            {rows.map(file => (
              <FileListRow
                key={file.path}
                path={file.path}
                added={file.linesAdded}
                removed={file.linesRemoved}
                width={contentWidth}
                onClick={() => scrollToFile(file.path)}
              />
            ))}
            {(below > 0 || deniedCount > 0 || notShown > 0) && (
              <Text dimColor>
                {below > 0 ? '↓ ' : '… '}
                {[
                  below > 0
                    ? `${below} more below${scrollDownShortcut ? ` (${scrollDownShortcut} to scroll)` : ''}`
                    : null,
                  deniedCount > 0 ? `${deniedCount} read-denied` : null,
                  notShown > 0 ? `${notShown} not shown` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            )}
            {noiseCount > 0 && (
              <NoiseToggle
                count={noiseCount}
                shown={showNoise}
                onToggle={() => setShowNoise(v => !v)}
              />
            )}
          </Box>
        )}
      </Box>
      <Box flexGrow={1} flexDirection="column" overflow="hidden">
        <ScrollBox
          ref={scrollRef}
          flexGrow={1}
          flexDirection="column"
          stickyScroll={false}
          paddingX={1}
        >
          <Box flexDirection="column" width={contentWidth}>
            <PanelBody
              loading={loading}
              empty={empty}
              totalFiles={files.length}
              visible={visible}
              hunks={hunks}
              width={contentWidth}
              deniedCount={deniedCount}
              hiddenNoiseCount={showNoise ? 0 : noiseCount}
              anchors={fileAnchors}
            />
            {!loading && stats !== null && preSession.length > 0 && (
              <PreSessionSection
                files={preSession}
                hunks={hunks}
                shown={showPreSession}
                onToggle={() => setShowPreSession(v => !v)}
                width={contentWidth}
              />
            )}
          </Box>
        </ScrollBox>
      </Box>
    </Box>
  )
}

type EmptyState = { title: string | null; detail: string | null }

function describeEmptyState({
  loading,
  stats,
  headerFiles,
  noCommits,
  baseMode,
  source,
}: {
  loading: boolean
  stats: { filesCount: number } | null
  headerFiles: number
  noCommits: boolean | undefined
  baseMode: DiffBaseMode
  source: DiffSource
}): EmptyState {
  if (loading) return { title: null, detail: null }
  if (stats === null) {
    return {
      title: 'Diff unavailable',
      detail: "Couldn't read the git diff — it will retry on the next change",
    }
  }
  if (headerFiles !== 0) return { title: null, detail: null }

  if (noCommits) {
    return {
      title: 'No commits yet',
      detail: "Nothing to diff against until the repo's first commit",
    }
  }
  if (baseMode === 'uncommitted') {
    return { title: 'No uncommitted changes', detail: null }
  }
  if (baseMode === 'branch') {
    return source.kind === 'branch'
      ? { title: `No changes vs ${source.baseBranch}`, detail: null }
      : {
          title: 'No changes vs HEAD',
          detail: 'No base branch to compare against — showing changes vs HEAD',
        }
  }
  return { title: 'No changes this session', detail: null }
}

/**
 * Todo completion, mirrored into the panel. The sidebar takes columns from the
 * transcript, so the progress that would otherwise sit under the prompt is
 * repeated where the user is now looking.
 */
function TodoProgress({ width }: { width: number }): React.ReactNode {
  const todos = useAppState(selectTodos) as TodoList | undefined
  const total = todos?.length ?? 0
  if (total === 0) return null
  const done = todos?.filter(todo => todo.status === 'completed').length ?? 0
  return (
    <Box marginTop={1} flexDirection="row" gap={1}>
      <ProgressBar
        ratio={done / total}
        width={Math.min(20, Math.max(width - 12, 4))}
        fillColor="success"
        emptyColor="inactive"
      />
      <Text dimColor>
        {done}/{total}
      </Text>
    </Box>
  )
}

function PanelBody({
  loading,
  empty,
  totalFiles,
  visible,
  hunks,
  width,
  deniedCount,
  hiddenNoiseCount,
  anchors,
}: {
  loading: boolean
  empty: EmptyState
  totalFiles: number
  visible: DiffFile[]
  hunks: Map<string, StructuredPatchHunk[]>
  width: number
  deniedCount: number
  hiddenNoiseCount: number
  anchors: React.RefObject<Map<string, DOMElement>>
}): React.ReactNode {
  if (loading) {
    return <Text dimColor>Loading diff…</Text>
  }
  if (empty.title !== null) {
    return empty.detail !== null ? <Text dimColor>{empty.detail}</Text> : null
  }
  if (totalFiles === 0) {
    return (
      <Box flexDirection="column">
        <Text dimColor>Too many changed files to show diff</Text>
        <Text dimColor italic>
          Per-file diff is skipped above 500 files
        </Text>
      </Box>
    )
  }
  if (visible.length === 0) {
    const both = deniedCount > 0 && hiddenNoiseCount > 0
    return (
      <Box flexDirection="column">
        <Text dimColor>
          {both
            ? 'Only hidden files changed'
            : deniedCount > 0
              ? 'Only read-denied files changed'
              : 'Only tests and generated files changed'}
        </Text>
        <Text dimColor italic>
          {both
            ? 'Read-denied, test, and generated files are hidden in this panel'
            : deniedCount > 0
              ? 'Read-denied files are hidden in this panel'
              : 'Tests and generated files are hidden · click "show" above to view them'}
        </Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" gap={1}>
      {visible.map(file => (
        <Box
          key={file.path}
          flexDirection="column"
          ref={(node: DOMElement | null) => {
            if (node) anchors.current.set(file.path, node)
            else anchors.current.delete(file.path)
          }}
        >
          <Divider width={width} />
          <PanelFileDiff
            filePath={file.path}
            hunks={hunks.get(file.path) ?? []}
            isBinary={file.isBinary}
            isLargeFile={file.isLargeFile}
            isTruncated={file.isTruncated}
            isUntracked={file.isUntracked}
            width={width}
          />
        </Box>
      ))}
    </Box>
  )
}

/**
 * Files that were already dirty when the session started. Collapsed by default:
 * they're context, not this session's work, and mixing them into the main list
 * would make "N files changed" mean nothing.
 */
function PreSessionSection({
  files,
  hunks,
  shown,
  onToggle,
  width,
}: {
  files: DiffFile[]
  hunks: Map<string, StructuredPatchHunk[]>
  shown: boolean
  onToggle: () => void
  width: number
}): React.ReactNode {
  const [hovered, setHovered] = useState(false)
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box
        flexDirection="row"
        onClick={onToggle}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <Text dimColor={!hovered} underline={hovered}>
          +{files.length} {plural(files.length, 'file')} edited before this
          session ({shown ? 'hide' : 'show'})
        </Text>
      </Box>
      {shown && (
        <>
          <Box flexDirection="column" marginTop={1}>
            {files.map(file => (
              <Box key={file.path} flexDirection="row" width={width}>
                <Text dimColor>
                  {truncatePathMiddle(file.path, Math.max(width - 12, 8))}
                </Text>
                <Box flexGrow={1} />
                <LineCounts
                  added={file.linesAdded}
                  removed={file.linesRemoved}
                />
              </Box>
            ))}
          </Box>
          {files.length > MAX_PRE_SESSION_DIFFS ? (
            <Text dimColor>diffs hidden above {MAX_PRE_SESSION_DIFFS} files</Text>
          ) : (
            files.map(file => (
              <Box key={file.path} flexDirection="column">
                <Divider width={width} />
                <PanelFileDiff
                  filePath={file.path}
                  hunks={hunks.get(file.path) ?? []}
                  isBinary={file.isBinary}
                  isLargeFile={file.isLargeFile}
                  isTruncated={file.isTruncated}
                  isUntracked={file.isUntracked}
                  width={width}
                />
              </Box>
            ))
          )}
        </>
      )}
    </Box>
  )
}

function NoiseToggle({
  count,
  shown,
  onToggle,
}: {
  count: number
  shown: boolean
  onToggle: () => void
}): React.ReactNode {
  const [hovered, setHovered] = useState(false)
  return (
    <Box
      flexDirection="row"
      onClick={onToggle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Text dimColor={!hovered} underline={hovered}>
        {count} {plural(count, 'test')}/generated ({shown ? 'hide' : 'show'})
      </Text>
    </Box>
  )
}

function ClosePanelButton({
  onClose,
}: {
  onClose: () => void
}): React.ReactNode {
  const [hovered, setHovered] = useState(false)
  return (
    <Box
      onClick={onClose}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Text bold={hovered} dimColor={!hovered}>
        ✕
      </Text>
    </Box>
  )
}

function FileListRow({
  path,
  added,
  removed,
  width,
  onClick,
}: {
  path: string
  added: number
  removed: number
  width: number
  onClick: () => void
}): React.ReactNode {
  const [hovered, setHovered] = useState(false)
  const label = truncatePathMiddle(path, Math.max(width - 12, 8))
  return (
    <Box
      flexDirection="row"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Text dimColor={!hovered} underline={hovered}>
        {label}
      </Text>
      <Box flexGrow={1} />
      <LineCounts added={added} removed={removed} />
    </Box>
  )
}

function LineCounts({
  added,
  removed,
}: {
  added: number
  removed: number
}): React.ReactNode {
  return (
    <Text>
      {added > 0 && <Text color="diffAddedWord">+{added}</Text>}
      {added > 0 && removed > 0 && ' '}
      {removed > 0 && <Text color="diffRemovedWord">-{removed}</Text>}
    </Text>
  )
}

/**
 * A single file's diff, sized to the panel rather than the terminal.
 * Mirrors `DiffDetailView` but takes an explicit width and skips the
 * dialog-only chrome.
 */
function PanelFileDiff({
  filePath,
  hunks,
  isBinary,
  isLargeFile,
  isTruncated,
  isUntracked,
  width,
}: {
  filePath: string
  hunks: StructuredPatchHunk[]
  isBinary?: boolean
  isLargeFile?: boolean
  isTruncated?: boolean
  isUntracked?: boolean
  width: number
}): React.ReactNode {
  const fileContent = useMemo(() => {
    if (!filePath || isBinary || isLargeFile || isUntracked) return undefined
    try {
      // Diff paths are repo-root-relative; resolve against the git root so a
      // session started in a subdirectory still reads the right file.
      const root = findGitRoot(getCwd()) ?? getCwd()
      return readFileSafe(resolve(root, filePath)) ?? undefined
    } catch {
      return undefined
    }
  }, [filePath, isBinary, isLargeFile, isUntracked])
  const firstLine = fileContent?.split('\n')[0] ?? null

  if (isUntracked) {
    return (
      <Box flexDirection="column" width="100%">
        <Box>
          <Text bold>{filePath}</Text>
          <Text dimColor> (untracked)</Text>
        </Box>
        <Divider width={width} />
        <Box flexDirection="column">
          <Text dimColor italic>
            New file not yet staged.
          </Text>
          <Text dimColor italic>
            Run `git add :/{filePath}` to see line counts.
          </Text>
        </Box>
      </Box>
    )
  }

  if (isBinary || isLargeFile) {
    return (
      <Box flexDirection="column" width="100%">
        <Box>
          <Text bold>{filePath}</Text>
        </Box>
        <Divider width={width} />
        <Box flexDirection="column">
          <Text dimColor italic>
            {isBinary
              ? 'Binary file - cannot display diff'
              : 'Large file - diff exceeds 1 MB limit'}
          </Text>
        </Box>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" width="100%">
      <Box>
        <Text bold>{filePath}</Text>
        {isTruncated && <Text dimColor> (truncated)</Text>}
      </Box>
      <Divider width={width} />
      <Box flexDirection="column">
        {hunks.length === 0 ? (
          <Text dimColor>No diff content</Text>
        ) : (
          hunks.map((hunk, index) => (
            <TypedStructuredDiff
              key={index}
              patch={hunk}
              filePath={filePath}
              firstLine={firstLine}
              fileContent={fileContent}
              dim={false}
              width={width}
            />
          ))
        )}
      </Box>
      {isTruncated && (
        <Text dimColor italic>
          … diff truncated (exceeded 400 line limit)
        </Text>
      )}
    </Box>
  )
}

type Partitioned = {
  visible: DiffFile[]
  preSession: DiffFile[]
  noiseCount: number
  deniedCount: number
}

/**
 * Split the change set into what the panel shows, what it folds away, and what
 * it must not show at all.
 *
 * Read-deny rules are honoured here rather than at fetch time: the counts still
 * come from git (so totals stay honest) but the contents never reach the panel.
 */
function partitionFiles(
  files: DiffFile[],
  permissionContext: PanelPermissionContext,
  showNoise: boolean,
): Partitioned {
  // Git reports repo-root-relative paths (the fetcher runs with
  // diff.relative=false), so resolve against the git root — resolving against
  // the session cwd would misplace every rule whenever the session runs from
  // a subdirectory and let rooted deny rules miss.
  const root = findGitRoot(getCwd()) ?? getCwd()
  const visible: DiffFile[] = []
  const preSession: DiffFile[] = []
  let noiseCount = 0
  let deniedCount = 0

  for (const file of files) {
    if (
      matchingRuleForInput(
        resolve(root, file.path),
        permissionContext as Parameters<typeof matchingRuleForInput>[1],
        'read',
        'deny',
      ) !== null
    ) {
      deniedCount++
      continue
    }
    if (file.preSession) {
      preSession.push(file)
      continue
    }
    if (isNoise(file.path)) {
      noiseCount++
      if (!showNoise) continue
    }
    visible.push(file)
  }

  return { visible, preSession, noiseCount, deniedCount }
}

/**
 * Test suites and generated artifacts are real changes, but they crowd out the
 * code a reviewer actually needs to look at — so the panel folds them behind a
 * count by default.
 */
function isNoise(path: string): boolean {
  return isTestFile(path) || isGeneratedFile(path)
}
