import { useCallback, useEffect, useRef, useState } from "react"

// A value that clears itself after `ms`, for short confirmations such as "Copied".
export function useFlash<T>(ms = 2000): [T | undefined, (value: T | undefined) => void] {
  const [value, setValue] = useState<T>()
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const flash = useCallback((next: T | undefined) => {
    clearTimeout(timer.current)
    setValue(next)
    if (next !== undefined) timer.current = setTimeout(() => setValue(undefined), ms)
  }, [ms])
  return [value, flash]
}

export type ActionFeedback = "idle" | "pending" | "done" | "failed"

// Tracks one button's action: pending while it runs, then "done" or "failed" for a moment.
// The work fails when it throws or resolves to false.
export function useActionFeedback(): [ActionFeedback, (work: () => unknown) => Promise<void>] {
  const [pending, setPending] = useState(false)
  const [result, flash] = useFlash<"done" | "failed">()
  const run = useCallback(async (work: () => unknown) => {
    setPending(true)
    flash(undefined)
    let ok: boolean
    try { ok = (await work()) !== false } catch { ok = false }
    setPending(false)
    flash(ok ? "done" : "failed")
  }, [flash])
  return [pending ? "pending" : result ?? "idle", run]
}
