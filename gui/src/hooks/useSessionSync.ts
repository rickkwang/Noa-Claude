import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react"
import { deleteImageDraft } from "../agent/imageDrafts"
import type { AgentState } from "../agent/reducer"
import { fetchSessions, type ProjectInfo, type SessionSummary } from "../api"

const SESSION_LIST_LIMIT = 200

interface SessionTarget {
  cwd: string
  resume?: string
  runtimeId: string
  key: number
}

function sessionUpdateKey(cwd: string, id: string): string {
  return `${cwd}\0${id}`
}

export function removeSessionBrowserState(cwd: string, id: string): void {
  const draftKey = `noa-agent.draft:${cwd}:${id}`
  localStorage.removeItem(draftKey)
  localStorage.removeItem(`${draftKey}:references`)
  localStorage.removeItem(`noa-agent.bookmarks.v2.${id}`)
  void deleteImageDraft(draftKey).catch(() => {})
}

// Keeps the sidebar's task lists in step with the bridge and the CLI. Every two seconds it lists each project's
// sessions with their run status, and it watches the open session's updatedAt: a change this window did not cause
// (another window or the CLI wrote to it) reloads the session once it is idle, and a session that disappeared
// from a complete listing was deleted elsewhere, so a new task replaces it.
export function useSessionSync({
  projects,
  refreshTick,
  setRefreshTick,
  session,
  setSession,
  activeId,
  state,
}: {
  projects: ProjectInfo[]
  refreshTick: number
  setRefreshTick: Dispatch<SetStateAction<number>>
  session: SessionTarget
  setSession: Dispatch<SetStateAction<SessionTarget>>
  activeId: string | undefined
  state: Pick<AgentState, "busy" | "connection" | "result">
}) {
  const [sessionsByProject, setSessionsByProject] = useState<Record<string, SessionSummary[]>>({})
  const [loadedProjects, setLoadedProjects] = useState<ReadonlySet<string>>(() => new Set())
  const activeSessionKey = activeId ? sessionUpdateKey(session.cwd, activeId) : undefined
  const activeSessionRef = useRef({ cwd: session.cwd, id: activeId, runtimeId: session.runtimeId })
  activeSessionRef.current = { cwd: session.cwd, id: activeId, runtimeId: session.runtimeId }
  const busyRef = useRef(state.busy)
  busyRef.current = state.busy
  const connectionRef = useRef(state.connection)
  connectionRef.current = state.connection
  const seenSessionUpdatesRef = useRef(new Map<string, number>())
  const pendingSessionReloadRef = useRef<string | undefined>(undefined)
  const localBusySessionRef = useRef<string | undefined>(undefined)
  const expectedSessionUpdatesRef = useRef(new Set(session.resume ? [sessionUpdateKey(session.cwd, session.resume)] : []))
  const seedSessionUpdate = (dir: string, id: string) => {
    const key = sessionUpdateKey(dir, id)
    const summary = Object.values(sessionsByProject).flat().find((item) => item.id === id)
    if (summary) {
      seenSessionUpdatesRef.current.set(key, summary.updatedAt)
      expectedSessionUpdatesRef.current.delete(key)
    } else {
      expectedSessionUpdatesRef.current.add(key)
    }
  }

  useEffect(() => {
    let cancelled = false
    let refreshing = false
    const refresh = async () => {
      if (refreshing) return
      refreshing = true
      try {
        const runsResponse = await fetch("/api/runs")
        const runs = await runsResponse.json() as { cwd: string; sessionId?: string; title?: string; busy: boolean; waiting: boolean; queued: number }[]
        const results = await Promise.allSettled(projects.map((project) => fetchSessions(project.path)))
        const completeResults = results.map((result) => result.status === "fulfilled" && result.value.length < SESSION_LIST_LIMIT)
        const active = activeSessionRef.current
        const activeKey = active.id ? sessionUpdateKey(active.cwd, active.id) : undefined
        let activeSummary: SessionSummary | undefined
        for (let index = 0; index < projects.length; index++) {
          const project = projects[index]!
          const result = results[index]!
          if (result.status !== "fulfilled") continue
          activeSummary = result.value.find((item) => (item.cwd ?? project.path) === active.cwd && item.id === active.id)
          if (activeSummary) break
        }
        let reloadActive = false
        let deletedActive = false
        if (activeKey && activeSummary) {
          const previous = seenSessionUpdatesRef.current.get(activeKey)
          if (previous === undefined) {
            seenSessionUpdatesRef.current.set(activeKey, activeSummary.updatedAt)
            expectedSessionUpdatesRef.current.delete(activeKey)
          } else if (previous !== activeSummary.updatedAt) {
            const expected = expectedSessionUpdatesRef.current.delete(activeKey)
            if (!expected && localBusySessionRef.current !== activeKey) {
              if (connectionRef.current === "ready" && !busyRef.current) reloadActive = true
              else if (!busyRef.current) pendingSessionReloadRef.current = activeKey
            }
            seenSessionUpdatesRef.current.set(activeKey, activeSummary.updatedAt)
          } else {
            expectedSessionUpdatesRef.current.delete(activeKey)
          }
        } else if (
          activeKey &&
          (projects.length > 0 && completeResults.every(Boolean) ||
            projects.some((project, index) => project.path === active.cwd && completeResults[index])) &&
          seenSessionUpdatesRef.current.has(activeKey)
        ) {
          deletedActive = true
          seenSessionUpdatesRef.current.delete(activeKey)
        }
        if (!cancelled) {
          setLoadedProjects((current) => {
            const next = new Set(current)
            for (let index = 0; index < projects.length; index++) {
              const path = projects[index]!.path
              if (completeResults[index]) next.add(path)
              else next.delete(path)
            }
            return next.size === current.size && [...next].every((path) => current.has(path)) ? current : next
          })
          setSessionsByProject((current) => {
            const next: Record<string, SessionSummary[]> = {}
            let changed = Object.keys(current).length !== projects.length
            for (let index = 0; index < projects.length; index++) {
              const project = projects[index]!
              const prev = current[project.path] ?? []
              const result = results[index]!
              const base = result.status === "fulfilled" ? result.value : prev
              const visible = base.map((session): SessionSummary => {
                const run = runs.find((r) => r.cwd === (session.cwd ?? project.path) && r.sessionId === session.id)
                return { ...session, status: run?.waiting ? "waiting" : run?.busy ? "running" : run?.queued ? "queued" : undefined }
              })
              for (const run of runs.filter((r) => r.cwd === project.path && r.sessionId)) {
                if (!visible.some((s) => s.id === run.sessionId)) {
                  const existing = prev.find((s) => s.id === run.sessionId)
                  const now = Date.now()
                  visible.unshift({
                    id: run.sessionId!,
                    title: run.title ?? "New task",
                    updatedAt: existing?.updatedAt ?? now,
                    createdAt: existing?.createdAt ?? now,
                    status: run.waiting ? "waiting" : run.busy ? "running" : run.queued ? "queued" : undefined,
                  })
                }
              }
              const sameList =
                prev.length === visible.length &&
                prev.every((s, i) => {
                  const v = visible[i]!
                  return s.id === v.id && s.title === v.title && s.updatedAt === v.updatedAt && s.status === v.status && s.cwd === v.cwd
                })
              next[project.path] = sameList ? prev : visible
              if (!sameList) changed = true
            }
            return changed ? next : current
          })
          if (reloadActive && activeKey) {
            pendingSessionReloadRef.current = undefined
            expectedSessionUpdatesRef.current.add(activeKey)
            setSession((current) => ({ ...current, key: current.key + 1 }))
          } else if (deletedActive && active.id) {
            pendingSessionReloadRef.current = undefined
            removeSessionBrowserState(active.cwd, active.id)
            setSession((current) => ({ cwd: current.cwd, runtimeId: crypto.randomUUID(), key: current.key + 1 }))
          }
        }
      } catch {} finally { refreshing = false }
    }
    const refreshVisible = () => { if (document.visibilityState === "visible") void refresh() }
    void refresh()
    const timer = setInterval(refreshVisible, 2000)
    window.addEventListener("focus", refreshVisible)
    document.addEventListener("visibilitychange", refreshVisible)
    return () => {
      cancelled = true
      clearInterval(timer)
      window.removeEventListener("focus", refreshVisible)
      document.removeEventListener("visibilitychange", refreshVisible)
    }
  }, [projects, refreshTick])

  // A finished turn may have created or renamed the current session.
  useEffect(() => {
    if (!state.result) return
    const active = activeSessionRef.current
    if (active.id) {
      const key = sessionUpdateKey(active.cwd, active.id)
      localBusySessionRef.current = undefined
      expectedSessionUpdatesRef.current.add(key)
    }
    setRefreshTick((n) => n + 1)
  }, [state.result])

  useEffect(() => {
    if (activeSessionKey && state.busy) localBusySessionRef.current = activeSessionKey
  }, [activeSessionKey, state.busy])

  useEffect(() => {
    const key = pendingSessionReloadRef.current
    if (!key || key !== activeSessionKey || state.connection !== "ready" || state.busy) return
    pendingSessionReloadRef.current = undefined
    expectedSessionUpdatesRef.current.add(key)
    setSession((current) => ({ ...current, key: current.key + 1 }))
  }, [activeSessionKey, state.busy, state.connection])

  return {
    sessionsByProject,
    setSessionsByProject,
    loadedProjects,
    activeSessionRef,
    seedSessionUpdate,
    // Opening another task drops what was tracked for the previous one.
    resetSessionTracking: () => {
      pendingSessionReloadRef.current = undefined
      localBusySessionRef.current = undefined
    },
    // A turn this window starts changes the session; its own update must not reload it.
    markActiveSessionBusy: () => {
      const active = activeSessionRef.current
      if (active.id) localBusySessionRef.current = sessionUpdateKey(active.cwd, active.id)
    },
    expectSessionUpdate: (cwd: string, id: string) => {
      expectedSessionUpdatesRef.current.add(sessionUpdateKey(cwd, id))
    },
  }
}
