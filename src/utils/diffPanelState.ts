/**
 * Mount rules, width budget and persistence for the REPL diff panel.
 *
 * The panel is a sidebar, not an overlay, so it only exists where the layout
 * can actually give it a column: fullscreen mode, a wide enough terminal, a git
 * repo, and the main (non-teammate) view. Everywhere else `/diff` falls back to
 * the modal dialog — see `src/commands/diff/`.
 */
import { getCwd } from './cwd.js'
import { isFullscreenEnvEnabled } from './fullscreen.js'
import { findGitRoot } from './git.js'
import {
  getCurrentProjectConfig,
  getGlobalConfig,
  saveCurrentProjectConfig,
  saveGlobalConfig,
} from './config.js'
import { DIFF_BASE_MODES, type DiffBaseMode } from './diffPanelData.js'

/**
 * Below this the panel would leave the transcript unreadably narrow, so it
 * refuses to open at all rather than degrading both halves.
 */
export const MIN_DIFF_PANEL_COLUMNS = 110

/**
 * Auto-open needs more headroom than a deliberate open: opening a panel the
 * user didn't ask for is only a good trade when nothing else gets cramped.
 */
export const AUTO_OPEN_MIN_COLUMNS = 144

/** Columns the transcript keeps for itself; the panel gets what's left, capped. */
const MIN_TRANSCRIPT_COLUMNS = 70
const MAX_PANEL_COLUMNS = 90
const PANEL_WIDTH_RATIO = 0.45

export const NO_GIT_REPO_MESSAGE =
  'The diff panel shows git changes — the current directory isn’t in a git repository'

export function tooNarrowMessage(): string {
  return `Resize your terminal to at least ${MIN_DIFF_PANEL_COLUMNS} columns to show the diff panel`
}

/** Which REPL column has focus: the transcript, or the diff sidebar. */
export type ReplTab = 'convo' | 'diff'

export function isGitRepo(): boolean {
  return findGitRoot(getCwd()) !== null
}

/**
 * Whether `/diff` should toggle the sidebar instead of opening the modal
 * dialog. Only the layout matters here — the git and width preconditions are
 * deliberately *not* checked, so that failing either one still routes to the
 * toggle and the user gets told why ("not a git repository", "resize to at
 * least N columns") instead of a dialog they didn't ask for.
 *
 * Lives here rather than in the panel component so the command registry can
 * read it without pulling React and ink into startup.
 */
export function diffPanelIsPreferred(): boolean {
  return isFullscreenEnvEnabled()
}

type MountConditions = {
  fullscreen: boolean
  columns: number
  isThinClient: boolean
  isMainFocused: boolean
  hasGitRepo: boolean
}

/**
 * Whether the panel is allowed to occupy layout right now. Re-evaluated every
 * render — a terminal resize or a switch to a teammate view retracts it without
 * changing the user's `replTab` choice, so it comes back when conditions do.
 */
export function diffPanelCanMount({
  fullscreen,
  columns,
  isThinClient,
  isMainFocused,
  hasGitRepo,
}: MountConditions): boolean {
  return (
    fullscreen &&
    !isThinClient &&
    isMainFocused &&
    columns >= MIN_DIFF_PANEL_COLUMNS &&
    hasGitRepo
  )
}

/** Column width for the sidebar, or 0 when it should not be shown. */
export function diffPanelWidth(
  replTab: ReplTab,
  conditions: MountConditions,
): number {
  if (replTab !== 'diff') return 0
  if (!diffPanelCanMount(conditions)) return 0
  return Math.min(
    Math.floor(conditions.columns * PANEL_WIDTH_RATIO),
    MAX_PANEL_COLUMNS,
    conditions.columns - MIN_TRANSCRIPT_COLUMNS,
  )
}

/**
 * Whether to open the panel unprompted on the session's first file edit.
 *
 * An explicit `false` in project config is a permanent opt-out — the user
 * closed it here, so we never re-open on our own.
 */
export function shouldAutoOpenDiffPanel(columns: number): boolean {
  const remembered = getCurrentProjectConfig().diffSidebarOpen
  if (remembered === false) return false
  const minColumns =
    remembered === true ? MIN_DIFF_PANEL_COLUMNS : AUTO_OPEN_MIN_COLUMNS
  return columns >= minColumns && isGitRepo()
}

function rememberSidebarOpen(open: boolean): void {
  if (getCurrentProjectConfig().diffSidebarOpen === open) return
  saveCurrentProjectConfig(config => ({ ...config, diffSidebarOpen: open }))
}

/**
 * Flip between transcript and diff sidebar, persisting the choice.
 * Returns the tab that is now active.
 */
export function toggleReplTab(
  current: ReplTab,
  setReplTab: (tab: ReplTab) => void,
): ReplTab {
  const next: ReplTab = current === 'diff' ? 'convo' : 'diff'
  setReplTab(next)
  rememberSidebarOpen(next === 'diff')
  return next
}

/**
 * Close without persisting an opt-out. Used when the panel retracts for a
 * reason that isn't the user rejecting it (e.g. leaving fullscreen).
 */
export function closeDiffPanel(setReplTab: (tab: ReplTab) => void): void {
  setReplTab('convo')
}

/** Close because the user dismissed the panel — remembered across sessions. */
export function dismissDiffPanel(setReplTab: (tab: ReplTab) => void): void {
  closeDiffPanel(setReplTab)
  rememberSidebarOpen(false)
}

export function getDiffBaseMode(): DiffBaseMode {
  const mode = getGlobalConfig().diffSidebarBaseMode
  return mode === 'uncommitted' || mode === 'branch' ? mode : 'session'
}

export function cycleDiffBaseMode(current: DiffBaseMode): DiffBaseMode {
  const next =
    DIFF_BASE_MODES[
      (DIFF_BASE_MODES.indexOf(current) + 1) % DIFF_BASE_MODES.length
    ] ?? 'session'
  if (getGlobalConfig().diffSidebarBaseMode !== next) {
    saveGlobalConfig(config => ({ ...config, diffSidebarBaseMode: next }))
  }
  return next
}

/** Human-readable label for the current base, shown under the panel header. */
export function describeDiffBase(
  requested: DiffBaseMode,
  source: { kind: 'working-tree' } | { kind: 'branch'; baseBranch: string },
  pending: boolean,
): string {
  let label: string
  switch (requested) {
    case 'session':
      label = 'this session'
      break
    case 'uncommitted':
      label = 'uncommitted (vs HEAD)'
      break
    case 'branch':
      label =
        source.kind === 'branch'
          ? `branch vs ${source.baseBranch}`
          : pending
            ? 'branch diff'
            : 'vs HEAD (no base branch)'
      break
  }
  return pending ? `${label}…` : label
}
