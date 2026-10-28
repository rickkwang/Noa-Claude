import { useCallback, useEffect, useState } from "react"

// The width is remembered per viewer; a missing or out-of-range value falls back to the default.
export function usePanelWidth(storageKey: string, defaultWidth: number, minimumWidth: number, maximumWidth: number) {
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(storageKey))
      return saved >= minimumWidth && saved <= maximumWidth ? saved : defaultWidth
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
    (next: number) => setWidth(Math.round(Math.max(minimumWidth, Math.min(maximumWidth, next)))),
    [minimumWidth, maximumWidth],
  )

  return { width, set }
}
