/**
 * The REPL diff sidebar — a live view of what has changed, rendered beside the
 * transcript rather than as a modal over it.
 *
 * `DiffPanelHost` owns the mount decision, the `/diff` toggle and auto-open;
 * `DiffPanel` is the sidebar itself and only renders once the layout has given
 * it a width. `DiffDialog` still covers everywhere the sidebar can't go.
 */
import type { StructuredPatchHunk } from 'diff'
import { resolve } from 'path'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getSessionId } from '../../bootstrap/state.js'
import { useNotifications } from '../../context/notifications.js'
import { type DiffFile, useDiffData } from '../../hooks/useDiffData.js'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import { useTimeout } from '../../hooks/useTimeout.js'
import { Box, Text } from '../../ink.js'
import ScrollBox, {
  type ScrollBoxHandle,
} from '../../ink/components/ScrollBox.js'
import type { DOMElement } from '../../ink/dom.js'
import type { WheelEvent } from '../../ink/events/wheel-event.js'
import { useSelection } from '../../ink/hooks/use-selection.js'
import wrapText from '../../ink/wrap-text.js'
import { useRegisterKeybindingContext } from '../../keybindings/KeybindingContext.js'
import {
  useKeybinding,
  useKeybindings,
} from '../../keybindings/useKeybinding.js'
import { useShortcutDisplay } from '../../keybindings/useShortcutDisplay.js'
import { useAppState, useSetAppState } from '../../state/AppState.js'
import type { AppState } from '../../state/AppStateStore.js'
import { getCwd } from '../../utils/cwd.js'
import type { DiffBaseMode, DiffSource } from '../../utils/diffData.js'
import {
  cycleDiffBaseMode,
  describeDiffBase,
  diffPanelOpenBlocker,
  diffPanelWidth,
  dismissDiffPanel,
  getDiffBaseMode,
  isGitRepo,
  shouldAutoOpenDiffPanel,
  toggleReplTab,
  type ReplTab,
} from '../../utils/diffPanelState.js'
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js'
import { isGeneratedFile, isTestFile } from '../../utils/generatedFiles.js'
import { findGitRoot } from '../../utils/git.js'
import { matchingRuleForInput } from '../../utils/permissions/filesystem.js'
import { plural } from '../../utils/stringUtils.js'
import type { TodoList } from '../../utils/todo/types.js'
import { truncatePathMiddle } from '../../utils/truncate.js'
import { Divider } from '../design-system/Divider.js'
import { LoadingState } from '../design-system/LoadingState.js'
import { ProgressBar } from '../design-system/ProgressBar.js'
import { useDragToScroll } from '../ScrollKeybindingHandler.js'
import { DiffDetailView } from './DiffDetailView.js'
import { type DiffSelection, useDiffSelection } from './useDiffSelection.js'

/** File-list rows shown before the "N more below" fold. */
const FILE_LIST_ROWS = 8

/** Above this many pre-session files we list names only, no diffs. */
const MAX_PRE_SESSION_DIFFS = 20

/** A load faster than this never shows the spinner. */
const LOADING_INDICATOR_DELAY_MS = 300

/** Body rows one wheel notch scrolls. The file list moves one row per notch. */
const WHEEL_ROWS_PER_NOTCH = 3

const selectReplTab = (state: AppState): ReplTab => state.replTab
const selectTrackedFileCount = (state: AppState): number =>
  state.fileHistory.trackedFiles.size
const selectTrackSequence = (state: AppState): number =>
  state.fileHistory.trackSequence ?? 0
type PanelPermissionContext = AppState['toolPermissionContext']
const selectToolPermissionContext = (
  state: AppState,
): PanelPermissionContext => state.toolPermissionContext
const selectTodos = (state: AppState): TodoList | undefined =>
  state.todos[getSessionId()]

export function useSetReplTab(): (tab: ReplTab) => void {
  const setAppState = useSetAppState()
  return useCallback(
    (tab: ReplTab) => {
      setAppState(previous =>
        previous.replTab === tab ? previous : { ...previous, replTab: tab },
      )
    },
    [setAppState],
  )
}

/**
 * The tracked-file count auto-open must not react to: the count at mount, so a
 * resumed session (whose tracked files are rebuilt from snapshots) doesn't
 * fling the panel open at startup. It lapses as soon as the count moves, and a
 * new session (`/clear`) starts without one.
 */
function useAutoOpenBaseline(trackedFileCount: number): number | null {
  const sessionId = getSessionId()
  const [state, setState] = useState(() => ({
    sessionId,
    baseline: trackedFileCount as number | null,
  }))
  let baseline = state.baseline
  if (baseline !== null && trackedFileCount !== baseline) baseline = null
  if (state.sessionId !== sessionId) baseline = null
  if (state.sessionId !== sessionId || state.baseline !== baseline) {
    setState({ sessionId, baseline })
  }
  return baseline
}

type HostProps = {
  /** Columns the layout reserved for the panel; 0 means don't render. */
  width: number
  isThinClient: boolean
  /**
   * Receives text the user selects inside the panel, to attach to their next
   * prompt. Undefined while a modal owns the screen.
   */
  onAskAboutSelection?: (selection: DiffSelection) => void
}

/**
 * Owns the `/diff` toggle and the first-edit auto-open, independent of whether
 * the panel is currently visible — the toggle has to work (and explain itself)
 * precisely when the panel is *not* showing.
 */
export function DiffPanelHost({
  width,
  isThinClient,
  onAskAboutSelection,
}: HostProps): React.ReactNode {
  const replTab = useAppState(selectReplTab) as ReplTab
  const setReplTab = useSetReplTab()
  const { columns } = useTerminalSize()
  const trackedFileCount = useAppState(selectTrackedFileCount) as number
  const autoOpenBaseline = useAutoOpenBaseline(trackedFileCount)

  // Open the panel unprompted when this session starts touching files.
  useEffect(() => {
    if (replTab !== 'convo' || trackedFileCount === 0) return
    if (autoOpenBaseline !== null && trackedFileCount === autoOpenBaseline) {
      return
    }
    if (!isFullscreenEnvEnabled() || isThinClient) return
    if (!shouldAutoOpenDiffPanel(columns)) return
    setReplTab('diff')
  }, [replTab, trackedFileCount, autoOpenBaseline, columns, isThinClient, setReplTab])

  const { addNotification } = useNotifications()
  const toggle = useCallback(() => {
    const blocker = replTab === 'diff' ? null : diffPanelOpenBlocker(columns)
    if (blocker !== null) {
      addNotification({
        key: isGitRepo() ? 'diff-sidebar-too-narrow' : 'diff-sidebar-no-git',
        text: blocker,
        priority: 'immediate',
        timeoutMs: 3000,
      })
      return
    }
    toggleReplTab(replTab, setReplTab)
  }, [replTab, columns, addNotification, setReplTab])
  useKeybinding('app:toggleReplTab', toggle, {
    context: 'Global',
    isActive: isFullscreenEnvEnabled() && !isThinClient,
  })

  // Losing the column (narrow terminal, agent transcript) keeps the tab, so
  // the panel comes straight back when the column does.
  if (replTab !== 'diff' || width === 0) return null
  return <DiffPanel width={width} onAskAboutSelection={onAskAboutSelection} />
}

/**
 * The width the layout should reserve for the panel this render. Exported so
 * REPL can size the transcript in the same pass.
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

/** Re-probed on file activity and tab flips, so a mid-session `git init` is picked up. */
function useHasGitRepo(): boolean {
  const trackSequence = useAppState(selectTrackSequence) as number
  const replTab = useAppState(selectReplTab) as ReplTab
  const cwd = getCwd()
  return useMemo(
    () => isGitRepo(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-probe triggers
    [cwd, trackSequence, replTab],
  )
}

type EmptyState = { headline: string; hint: string | null }

type PanelProps = {
  width: number
  onAskAboutSelection?: (selection: DiffSelection) => void
}

function DiffPanel({
  width,
  onAskAboutSelection,
}: PanelProps): React.ReactNode {
  const setAppState = useSetAppState()
  const setReplTab = useSetReplTab()
  const trackSequence = useAppState(selectTrackSequence) as number
  const permissionContext = useAppState(
    selectToolPermissionContext,
  ) as PanelPermissionContext

  // Chord resolution only reaches handlers in *registered* contexts, so
  // `ctrl+x b` belongs to the panel only while it is mounted.
  useRegisterKeybindingContext('DiffPanel', true)

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
  } = useDiffData(trackSequence, true, baseMode)

  // While the panel is up, transient toasts are held; draining on unmount shows
  // anything that queued meanwhile.
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

  const scrollRef = useRef<ScrollBoxHandle>(null)
  const panelRef = useRef<DOMElement | null>(null)
  const bodyRef = useRef<DOMElement | null>(null)
  const fileAnchors = useRef(new Map<string, DOMElement>())
  const { columns } = useTerminalSize()
  useDiffSelection({
    panelRef,
    bodyRef,
    minCol: columns - width,
    anchors: fileAnchors,
    onSelect: onAskAboutSelection,
  })
  // Dragging a selection past the body's edge scrolls the body — only for a
  // selection that started in it.
  const selection = useSelection()
  useDragToScroll(scrollRef, selection, true, undefined, { requireScope: true })

  const contentWidth = Math.max(width - 2, 20)

  const [showNoise, setShowNoise] = useState(false)
  const { visible, preSession, noiseCount, deniedCount } = useMemo(
    () => partitionFiles(files, permissionContext, showNoise),
    [files, permissionContext, showNoise],
  )

  // Header counts describe this session's work, so pre-session files are
  // subtracted — unless *everything* is pre-session, where zeroes would be
  // more confusing than the totals.
  const preSessionTotals = sumLines(preSession)
  const allPreSession =
    files.length > 0 &&
    preSession.length === files.length &&
    noiseCount === 0 &&
    deniedCount === 0
  const headerAdded = allPreSession
    ? 0
    : (stats?.linesAdded ?? 0) - preSessionTotals.added
  const headerRemoved = allPreSession
    ? 0
    : (stats?.linesRemoved ?? 0) - preSessionTotals.removed
  const headerFiles = allPreSession
    ? 0
    : (stats?.filesCount ?? files.length) - preSession.length

  const [listOffset, setListOffset] = useState(0)
  const maxOffset = Math.max(0, visible.length - FILE_LIST_ROWS)
  const offset = Math.min(listOffset, maxOffset)
  const rows = visible.slice(offset, offset + FILE_LIST_ROWS)
  const below = visible.length - (offset + rows.length)
  // Files git counted but never listed (over the per-file detail cap).
  const notShown = Math.max(0, headerFiles - (files.length - preSession.length))
  const hiddenNoiseCount = showNoise ? 0 : noiseCount

  const status = loading
    ? null
    : describeStatus({
        stats,
        headerFiles,
        noCommits,
        baseMode: loadedBaseMode as DiffBaseMode,
        source,
      })

  const toggleNoise = useCallback(() => setShowNoise(shown => !shown), [])
  useKeybinding('app:toggleDiffNoiseFilter', toggleNoise, {
    context: 'Global',
    isActive: noiseCount > 0,
  })

  const scrollList = useCallback(
    (delta: number) => {
      setListOffset(current =>
        Math.min(Math.max(Math.min(current, maxOffset) + delta, 0), maxOffset),
      )
    },
    [maxOffset],
  )
  useKeybindings(
    {
      'app:diffFileListUp': () => scrollList(-1),
      'app:diffFileListDown': () => scrollList(1),
    },
    { context: 'Global', isActive: maxOffset > 0 },
  )
  const scrollDownShortcut = useShortcutDisplay(
    'app:diffFileListDown',
    'Global',
    'alt+down',
  )

  const [showPreSession, setShowPreSession] = useState(false)
  const togglePreSession = useCallback(
    () => setShowPreSession(shown => !shown),
    [],
  )
  useKeybinding('app:toggleDiffPreSession', togglePreSession, {
    context: 'Global',
    isActive: preSession.length > 0,
  })

  const empty: EmptyState | null = loading
    ? null
    : status !== null
      ? status
      : files.length === 0
        ? {
            headline: 'Too many changed files to show diff',
            hint: 'Per-file diff is skipped above 500 files',
          }
        : visible.length === 0
          ? describeAllHidden(deniedCount, hiddenNoiseCount)
          : null
  const centered = loading || (empty !== null && !showPreSession)
  const loadingIndicatorDue = useTimeout(LOADING_INDICATOR_DELAY_MS)

  const scrollToFile = useCallback((path: string) => {
    const node = fileAnchors.current.get(path)
    if (node) scrollRef.current?.scrollToElement(node)
  }, [])

  const onPanelWheel = useCallback((event: WheelEvent) => {
    scrollRef.current?.scrollBy(event.deltaY * WHEEL_ROWS_PER_NOTCH)
    event.preventDefault()
    event.stopPropagation()
  }, [])

  const preSessionSection =
    stats !== null && preSession.length > 0 ? (
      <PreSessionSection
        files={preSession}
        hunks={hunks}
        shown={showPreSession}
        onToggle={togglePreSession}
        width={contentWidth}
      />
    ) : null

  return (
    <Box
      ref={panelRef}
      flexDirection="column"
      width={width}
      height="100%"
      flexShrink={0}
      onWheel={onPanelWheel}
      selectionScope
    >
      <Box flexDirection="column" paddingX={1} paddingY={1} flexShrink={0}>
        <Box flexDirection="row">
          {!loading && status === null && (
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
          <HoverToggle onClick={() => dismissDiffPanel(setReplTab)}>
            {hovered => (
              <Text bold={hovered} dimColor={!hovered}>
                ✕
              </Text>
            )}
          </HoverToggle>
        </Box>
        {stats !== null &&
          (noCommits ? (
            headerFiles > 0 && (
              <Text dimColor>no commits yet — showing staged and new files</Text>
            )
          ) : (
            (baseMode !== 'session' || loadedBaseMode !== 'session') && (
              <Text dimColor>
                {describeDiffBase(baseMode, source, baseMode !== loadedBaseMode)}
              </Text>
            )
          ))}
        <TodoProgress width={contentWidth} />
        {(rows.length > 0 || noiseCount > 0) && (
          <Box
            flexDirection="column"
            marginTop={1}
            onWheel={
              maxOffset > 0
                ? (event: WheelEvent) => {
                    scrollList(event.deltaY)
                    event.preventDefault()
                    event.stopPropagation()
                  }
                : undefined
            }
          >
            {offset > 0 && <Text dimColor>↑ {offset} more above</Text>}
            {rows.map(file => (
              <HoverToggle key={file.path} onClick={() => scrollToFile(file.path)}>
                {hovered => (
                  <>
                    <Text dimColor={!hovered} underline={hovered}>
                      {truncatePathMiddle(file.path, Math.max(contentWidth - 12, 8))}
                    </Text>
                    <Box flexGrow={1} />
                    <LineCounts added={file.linesAdded} removed={file.linesRemoved} />
                  </>
                )}
              </HoverToggle>
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
              <HoverToggle onClick={toggleNoise}>
                {hovered => (
                  <Text dimColor={!hovered} underline={hovered}>
                    {noiseCount} {plural(noiseCount, 'test')}/generated (
                    {showNoise ? 'hide' : 'show'})
                  </Text>
                )}
              </HoverToggle>
            )}
          </Box>
        )}
      </Box>
      <Box ref={bodyRef} flexGrow={1} flexDirection="column" overflow="hidden">
        {centered ? (
          <>
            <Box
              flexGrow={1}
              flexDirection="column"
              justifyContent="center"
              alignItems="center"
              paddingX={1}
            >
              {loading
                ? loadingIndicatorDue && (
                    <LoadingState message="Loading diff…" dimColor />
                  )
                : empty !== null &&
                  [empty.headline, empty.hint ?? '']
                    .flatMap(text =>
                      text === ''
                        ? []
                        : wrapText(text, contentWidth, 'wrap').split('\n'),
                    )
                    .map((line, index) => (
                      <Text key={index} dimColor>
                        {line}
                      </Text>
                    ))}
            </Box>
            {preSessionSection && (
              <Box flexShrink={0} paddingX={1} paddingBottom={1}>
                {preSessionSection}
              </Box>
            )}
          </>
        ) : (
          <ScrollBox
            ref={scrollRef}
            flexGrow={1}
            flexDirection="column"
            stickyScroll={false}
            paddingX={1}
          >
            <Box flexDirection="column" width={contentWidth}>
              {empty !== null ? (
                <Box flexDirection="column">
                  <Text dimColor>{empty.headline}</Text>
                  {empty.hint && (
                    <Text dimColor italic>
                      {empty.hint}
                    </Text>
                  )}
                </Box>
              ) : (
                <Box flexDirection="column" gap={1}>
                  {visible.map(file => (
                    <Box
                      key={file.path}
                      flexDirection="column"
                      ref={(node: DOMElement | null) => {
                        if (node) fileAnchors.current.set(file.path, node)
                        else fileAnchors.current.delete(file.path)
                      }}
                    >
                      <Divider width={contentWidth} />
                      <FileDiff file={file} hunks={hunks} width={contentWidth} />
                    </Box>
                  ))}
                </Box>
              )}
              {preSessionSection}
            </Box>
          </ScrollBox>
        )}
      </Box>
    </Box>
  )
}

/** The empty state git itself implies, or null when there is something to list. */
function describeStatus({
  stats,
  headerFiles,
  noCommits,
  baseMode,
  source,
}: {
  stats: { filesCount: number } | null
  headerFiles: number
  noCommits: boolean | undefined
  baseMode: DiffBaseMode
  source: DiffSource
}): EmptyState | null {
  if (stats === null) {
    return {
      headline: 'Diff unavailable',
      hint: "Couldn't read the git diff — it will retry on the next change",
    }
  }
  if (headerFiles !== 0) return null
  if (noCommits) {
    return {
      headline: 'No commits yet',
      hint: "Nothing to diff against until the repo's first commit",
    }
  }
  switch (baseMode) {
    case 'uncommitted':
      return { headline: 'No uncommitted changes', hint: null }
    case 'branch':
      return source.kind === 'branch'
        ? { headline: `No changes vs ${source.baseBranch}`, hint: null }
        : {
            headline: 'No changes vs HEAD',
            hint: 'No base branch to compare against — showing changes vs HEAD',
          }
    case 'session':
      return { headline: 'No changes this session', hint: null }
  }
}

function describeAllHidden(
  deniedCount: number,
  hiddenNoiseCount: number,
): EmptyState {
  if (deniedCount > 0 && hiddenNoiseCount > 0) {
    return {
      headline: 'Only hidden files changed',
      hint: 'Read-denied, test, and generated files are hidden in this panel',
    }
  }
  if (deniedCount > 0) {
    return {
      headline: 'Only read-denied files changed',
      hint: 'Read-denied files are hidden in this panel',
    }
  }
  return {
    headline: 'Only tests and generated files changed',
    hint: 'Tests and generated files are hidden · click "show" above to view them',
  }
}

function sumLines(files: DiffFile[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const file of files) {
    added += file.linesAdded
    removed += file.linesRemoved
  }
  return { added, removed }
}

/**
 * Todo completion, mirrored into the panel: the sidebar takes the columns the
 * progress would otherwise have under the prompt.
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

function FileDiff({
  file,
  hunks,
  width,
}: {
  file: DiffFile
  hunks: Map<string, StructuredPatchHunk[]>
  width: number
}): React.ReactNode {
  return (
    <DiffDetailView
      filePath={file.path}
      hunks={hunks.get(file.path) ?? []}
      isBinary={file.isBinary}
      isLargeFile={file.isLargeFile}
      isTruncated={file.isTruncated}
      isUntracked={file.isUntracked}
      width={width}
    />
  )
}

/**
 * Files that were already dirty when the session started. Collapsed by
 * default: they're context, not this session's work.
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
  return (
    <Box flexDirection="column" marginTop={1}>
      <HoverToggle onClick={onToggle}>
        {hovered => (
          <Text dimColor={!hovered} underline={hovered}>
            +{files.length} {plural(files.length, 'file')} edited before this
            session ({shown ? 'hide' : 'show'})
          </Text>
        )}
      </HoverToggle>
      {shown && (
        <>
          <Box flexDirection="column" marginTop={1}>
            {files.map(file => (
              <Box key={file.path} flexDirection="row" width={width}>
                <Text dimColor>
                  {truncatePathMiddle(file.path, Math.max(width - 12, 8))}
                </Text>
                <Box flexGrow={1} />
                <LineCounts added={file.linesAdded} removed={file.linesRemoved} />
              </Box>
            ))}
          </Box>
          {files.length > MAX_PRE_SESSION_DIFFS ? (
            <Text dimColor>diffs hidden above {MAX_PRE_SESSION_DIFFS} files</Text>
          ) : (
            files.map(file => (
              <Box key={file.path} flexDirection="column">
                <Divider width={width} />
                <FileDiff file={file} hunks={hunks} width={width} />
              </Box>
            ))
          )}
        </>
      )}
    </Box>
  )
}

/** A clickable row that restyles itself while the pointer is over it. */
function HoverToggle({
  onClick,
  children,
}: {
  onClick: () => void
  children: (hovered: boolean) => React.ReactNode
}): React.ReactNode {
  const [hovered, setHovered] = useState(false)
  return (
    <Box
      flexDirection="row"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children(hovered)}
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
 * Split the change set into what the panel shows, what it folds away, and what
 * it must not show at all. Read-deny rules apply here rather than at fetch
 * time: the counts still come from git, but denied contents never render.
 */
function partitionFiles(
  files: DiffFile[],
  permissionContext: PanelPermissionContext,
  showNoise: boolean,
): {
  visible: DiffFile[]
  preSession: DiffFile[]
  noiseCount: number
  deniedCount: number
} {
  // Diff paths are repo-root-relative, so rules resolve against the git root;
  // the session cwd would misplace every rule from a subdirectory.
  const root = findGitRoot(getCwd()) ?? getCwd()
  const visible: DiffFile[] = []
  const preSession: DiffFile[] = []
  let noiseCount = 0
  let deniedCount = 0

  for (const file of files) {
    const denied =
      matchingRuleForInput(
        resolve(root, file.path),
        permissionContext as Parameters<typeof matchingRuleForInput>[1],
        'read',
        'deny',
      ) !== null
    if (denied) {
      deniedCount++
      continue
    }
    if (file.preSession) {
      preSession.push(file)
      continue
    }
    if (isTestFile(file.path) || isGeneratedFile(file.path)) {
      noiseCount++
      if (!showNoise) continue
    }
    visible.push(file)
  }

  return { visible, preSession, noiseCount, deniedCount }
}
