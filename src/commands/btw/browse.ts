/** Earlier /btw questions listed above the current one; older ones collapse. */
export const VISIBLE_HISTORY = 5

/**
 * Step through the panel's history. `browsed` is an index into the earlier
 * exchanges, or null for the current question. Only the listed (most recent
 * VISIBLE_HISTORY) exchanges are reachable. `wrap` cycles past either end back
 * to the current question (Tab); otherwise the ends clamp ([ ] and ⇧←/→).
 */
export function stepBrowse(
  historyLength: number,
  browsed: number | null,
  direction: 'older' | 'newer',
  wrap = false,
): number | null {
  const reachable = Math.min(historyLength, VISIBLE_HISTORY)
  const offset = browsed === null ? 0 : historyLength - browsed
  const delta = direction === 'older' ? 1 : -1
  const next = wrap
    ? (offset + delta + reachable + 1) % (reachable + 1)
    : Math.min(Math.max(offset + delta, 0), reachable)
  return next === 0 ? null : historyLength - next
}
