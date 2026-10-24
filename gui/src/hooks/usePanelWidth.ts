import { useCallback, useEffect, useState } from "react"

// Noa's limits: a panel never shrinks below its default width and stops at 480px.
export const PANEL_MAX_WIDTH = 480

// The width is remembered per viewer; a missing or out-of-range value falls back to the default.
export function usePanelWidth(storageKey: string, defaultWidth: number, minimumWidth = defaultWidth) {
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(storageKey))
      return saved >= minimumWidth && saved <= PANEL_MAX_WIDTH ? saved : defaultWidth
    } catch {
      return defaultWidth
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(width))
    } catch {
      // Storage unavailable: the width still applies for this session.
    }
  }, [storageKey, width])

  const set = useCallback(
    (next: number) => setWidth(Math.round(Math.max(minimumWidth, Math.min(PANEL_MAX_WIDTH, next)))),
    [minimumWidth],
  )

  return { width, set }
}
