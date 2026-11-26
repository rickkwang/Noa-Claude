import { DEFAULT_RIGHT_TABS, type PanelTab, type RightTab } from "../components/RightPanel"

// Per-session right sidebar preferences: open state, width share within its pane, and open tabs.
export type PaneSideState = {
  open: boolean
  // Share of the pane's width given to the right sidebar (0..1), clamped at render time.
  widthRatio: number
  tabs: PanelTab[]
  tab: RightTab
}

const STORAGE_KEY = "noa-agent.paneSidebars.v1"
const VALID_PANEL_TABS = new Set<PanelTab>(["files", "changes", "subagents", "threads", "sidechat", "thread"])
const MAX_STORED = 64
const DEFAULT_RATIO = 0.44

type StoredMap = Record<string, Partial<PaneSideState> & { updatedAt?: number }>

function readAll(): StoredMap {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")
    return parsed && typeof parsed === "object" ? (parsed as StoredMap) : {}
  } catch {
    return {}
  }
}

function writeAll(map: StoredMap) {
  try {
    const entries = Object.entries(map)
    if (entries.length > MAX_STORED) {
      entries.sort((a, b) => (b[1].updatedAt ?? 0) - (a[1].updatedAt ?? 0))
      map = Object.fromEntries(entries.slice(0, MAX_STORED))
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    /* Storage unavailable. */
  }
}

export function loadPaneSideState(sessionKey: string | undefined, fallbackOpen = false): PaneSideState {
  if (!sessionKey) {
    return { open: fallbackOpen, widthRatio: DEFAULT_RATIO, tabs: DEFAULT_RIGHT_TABS, tab: DEFAULT_RIGHT_TABS[0] ?? "files" }
  }
  const saved = readAll()[sessionKey]
  if (!saved) {
    return { open: fallbackOpen, widthRatio: DEFAULT_RATIO, tabs: DEFAULT_RIGHT_TABS, tab: DEFAULT_RIGHT_TABS[0] ?? "files" }
  }
  const tabs = Array.isArray(saved.tabs)
    ? saved.tabs.filter((t): t is PanelTab => VALID_PANEL_TABS.has(t as PanelTab))
    : DEFAULT_RIGHT_TABS
  const widthRatio = typeof saved.widthRatio === "number" && Number.isFinite(saved.widthRatio)
    ? Math.max(0.2, Math.min(0.75, saved.widthRatio))
    : DEFAULT_RATIO
  const tab: RightTab = typeof saved.tab === "string" ? (saved.tab as RightTab) : (tabs[0] ?? "files")
  return {
    open: typeof saved.open === "boolean" ? saved.open : fallbackOpen,
    widthRatio,
    tabs: tabs.length ? tabs : DEFAULT_RIGHT_TABS,
    tab,
  }
}

export function savePaneSideState(sessionKey: string | undefined, state: PaneSideState) {
  if (!sessionKey) return
  const map = readAll()
  map[sessionKey] = { ...state, updatedAt: Date.now() }
  writeAll(map)
}

// Clamps a pane's right sidebar width. When the pane is narrow, the chat column stays at its 320px
// floor anchored to the left and is masked under the right sidebar rather than squeezed.
export const PANE_CHAT_OVERFLOW_MIN = 320
export const PANE_RIGHT_MIN = 240
export const PANE_LEFT_PEEK_MIN = 120

export function paneRightWidth(paneWidth: number, widthRatio: number): { width: number; min: number; max: number; defaultWidth: number } {
  const min = Math.min(PANE_RIGHT_MIN, Math.max(180, paneWidth - PANE_LEFT_PEEK_MIN))
  const max = Math.max(min, paneWidth - PANE_LEFT_PEEK_MIN)
  const defaultWidth = Math.round(Math.max(min, Math.min(max, paneWidth * 0.52)))
  const desired = Math.round(paneWidth * widthRatio)
  const width = Math.max(min, Math.min(max, desired))
  return { width, min, max, defaultWidth }
}
