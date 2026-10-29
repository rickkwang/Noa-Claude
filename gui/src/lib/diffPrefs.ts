import { useSyncExternalStore } from "react"

// Diff display options shared by every diff surface, with Claude Code's defaults: unified layout,
// word wrap and changed-word emphasis on, whitespace changes shown, changed files listed flat.
// Side by side and word wrap keep reading the keys the GUI used before these options moved here.
export const DIFF_PREFS = {
  sideBySide: { key: "noa-diff-side-by-side", fallback: false, legacy: () => localStorage.getItem("noa-diff-layout") === "split" },
  wordWrap: { key: "noa-diff-wrap-v2", fallback: true },
  wordDiff: { key: "noa-diff-word-diff", fallback: true },
  hideWhitespace: { key: "noa-diff-hide-whitespace", fallback: false },
  fileTree: { key: "noa-diff-file-tree", fallback: false },
} as const
type Pref = keyof typeof DIFF_PREFS

// Below this width a side-by-side diff falls back to unified, as Claude Code's splitMinWidth.
export const SPLIT_MIN_WIDTH = 560

const listeners = new Set<() => void>()

function read(pref: Pref): boolean {
  const option = DIFF_PREFS[pref]
  try {
    const value = localStorage.getItem(option.key)
    if (value !== null) return value === "true"
    return "legacy" in option ? option.legacy() : option.fallback
  } catch {
    return option.fallback
  }
}

function write(pref: Pref, value: boolean) {
  try { localStorage.setItem(DIFF_PREFS[pref].key, String(value)) } catch { /* Ignore unavailable storage. */ }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useDiffPref(pref: Pref): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(subscribe, () => read(pref), () => DIFF_PREFS[pref].fallback)
  return [value, (next) => write(pref, next)]
}
