import { useRef } from "react"

/** A callback with a stable identity that always runs the latest closure, so memoized children skip re-renders. */
export function useEvent<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const latest = useRef(fn)
  latest.current = fn
  return useRef((...args: A) => latest.current(...args)).current
}
