import { query } from "../api"
import { initialState, reducer, type AgentTask, type Turn } from "./reducer"
import type { HistoryItem } from "./protocol"

export type CachedSessionHistory = {
  turns: Turn[]
  historyBefore?: number
  tasks: AgentTask[]
}

const MAX_CACHED_SESSIONS = 24
const cache = new Map<string, CachedSessionHistory>()
const inflight = new Map<string, Promise<void>>()
// Prefetches that cached nothing (failed, empty, or no turns), so a drag doesn't refetch on every pointer move.
const PREFETCH_RETRY_MS = 10_000
const emptyPrefetches = new Map<string, number>()

function keyOf(cwd: string | undefined, id: string | undefined) {
  return cwd && id ? `${cwd}\0${id}` : undefined
}

export function readCachedHistory(cwd: string | undefined, id: string | undefined): CachedSessionHistory | undefined {
  const key = keyOf(cwd, id)
  if (!key) return undefined
  const entry = cache.get(key)
  if (!entry) return undefined
  // Refresh LRU order.
  cache.delete(key)
  cache.set(key, entry)
  return entry
}

export function writeCachedHistory(cwd: string | undefined, id: string | undefined, entry: CachedSessionHistory) {
  const key = keyOf(cwd, id)
  if (!key || entry.turns.length === 0) return
  if (cache.has(key)) cache.delete(key)
  cache.set(key, entry)
  while (cache.size > MAX_CACHED_SESSIONS) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
}

// Pre-warms both the server's history cache and the client's parsed turn cache while dragging a task.
export function prefetchSessionHistory(cwd: string, id: string): void {
  const key = keyOf(cwd, id)
  if (!key || cache.has(key) || inflight.has(key) || Date.now() - (emptyPrefetches.get(key) ?? -Infinity) < PREFETCH_RETRY_MS) return
  const promise = fetch(`/api/session-history${query(cwd)}&id=${encodeURIComponent(id)}`)
    .then(async (res) => {
      if (!res.ok) return
      const data = (await res.json()) as { items?: HistoryItem[]; before?: number }
      if (!Array.isArray(data.items) || data.items.length === 0) return
      const restored = reducer(initialState, { type: "history", items: data.items, before: data.before ?? 0 })
      writeCachedHistory(cwd, id, {
        turns: restored.turns,
        historyBefore: restored.historyBefore,
        tasks: restored.tasks,
      })
    })
    .catch(() => {})
    .finally(() => {
      inflight.delete(key)
      if (!cache.has(key)) emptyPrefetches.set(key, Date.now())
    })
  inflight.set(key, promise)
}
