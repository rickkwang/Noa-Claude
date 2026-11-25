import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react"
import { deleteImageDraft } from "../agent/imageDrafts"
import type { AgentState } from "../agent/reducer"
import { fetchSessions, type ProjectInfo, type SessionSummary } from "../api"

const SESSION_LIST_LIMIT = 200
const SESSION_REQUEST_TIMEOUT = 8000
const RUN_ONLY = Symbol("run-only session")

type SidebarSession = SessionSummary & { [RUN_ONLY]?: true }
type SessionRun = { cwd: string; sessionId?: string; title?: string; coordinator?: boolean; busy: boolean; waiting: boolean; waitingFor?: string; queued: number }

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
  const [sessionsByProject, setSessionsByProject] = useState<Record<string, SidebarSession[]>>({})
  const [loadedProjects, setLoadedProjects] = useState<ReadonlySet<string>>(() => new Set())
  const activeSessionKey = activeId ? sessionUpdateKey(session.cwd, activeId) : undefined
  const activeSessionRef = useRef({ cwd: session.cwd, id: activeId, runtimeId: session.runtimeId })
  activeSessionRef.current = { cwd: session.cwd, id: activeId, runtimeId: session.runtimeId }
  const busyRef = useRef(state.busy)
  busyRef.current = state.busy
  const connectionRef = useRef(state.connection)
  connectionRef.current = state.connection
  const runsRef = useRef<SessionRun[]>([])
  const seenSessionUpdatesRef = useRef(new Map<string, number>())
  const pendingSessionReloadRef = useRef<string | undefined>(undefined)
  const localBusySessionRef = useRef<string | undefined>(undefined)
  const expectedSessionUpdatesRef = useRef(new Set(session.resume ? [sessionUpdateKey(session.cwd, session.resume)] : []))
  const seedSessionUpdate = (dir: string, id: string) => {
    const key = sessionUpdateKey(dir, id)
    for (const [path, items] of Object.entries(sessionsByProject)) {
      const summary = items.find((item) => !item[RUN_ONLY] && item.id === id && (item.cwd ?? path) === dir)
      if (!summary) continue
      seenSessionUpdatesRef.current.set(key, summary.updatedAt)
      expectedSessionUpdatesRef.current.delete(key)
      return
    }
    expectedSessionUpdatesRef.current.add(key)
  }

  useEffect(() => {
    const controller = new AbortController()
    const paths = projects.map((project) => project.path)
    const inFlight = new Map<string, Promise<SessionSummary[] | undefined>>()
    let runsInFlight = false
    let round = 0
    const requestSignal = () => AbortSignal.any([controller.signal, AbortSignal.timeout(SESSION_REQUEST_TIMEOUT)])

    const updateList = (path: string, prev: SidebarSession[], base: SidebarSession[], runs: SessionRun[]) => {
      const visible = base.filter((session) => !session[RUN_ONLY]).map((session): SidebarSession => {
        const run = runs.find((r) => r.cwd === (session.cwd ?? path) && r.sessionId === session.id)
        return { ...session, status: run?.waiting ? "waiting" : run?.busy ? "running" : run?.queued ? "queued" : undefined, waitingFor: run?.waiting ? run.waitingFor : undefined }
      })
      for (const run of runs) {
        if (run.cwd !== path || !run.sessionId || visible.some((s) => s.id === run.sessionId)) continue
        const existing = prev.find((s) => s.id === run.sessionId)
        const now = Date.now()
        visible.unshift({
          [RUN_ONLY]: true,
          id: run.sessionId,
          title: run.title ?? "New task",
          coordinator: run.coordinator,
          updatedAt: existing?.updatedAt ?? now,
          createdAt: existing?.createdAt ?? now,
          status: run.waiting ? "waiting" : run.busy ? "running" : run.queued ? "queued" : undefined,
          waitingFor: run.waiting ? run.waitingFor : undefined,
        })
      }
      return prev.length === visible.length && prev.every((s, i) => {
        const v = visible[i]!
        // PR state refreshes from GitHub without touching the transcript, so updatedAt alone misses it.
        return s[RUN_ONLY] === v[RUN_ONLY] && s.id === v.id && s.title === v.title && s.updatedAt === v.updatedAt && s.status === v.status && s.cwd === v.cwd && s.summary === v.summary && s.error === v.error && s.pr?.state === v.pr?.state && s.waitingFor === v.waitingFor && s.resolvedAt === v.resolvedAt && s.remindAt === v.remindAt
      }) ? prev : visible
    }

    const refreshRuns = async () => {
      if (runsInFlight) return
      runsInFlight = true
      try {
        const response = await fetch("/api/runs", { signal: requestSignal() })
        if (!response.ok) return
        const runs = await response.json() as SessionRun[]
        if (controller.signal.aborted) return
        runsRef.current = runs
        setSessionsByProject((current) => {
          const next: Record<string, SessionSummary[]> = {}
          for (const path of paths) {
            const prev = current[path] ?? []
            next[path] = updateList(path, prev, prev, runs)
          }
          return paths.length === Object.keys(current).length && paths.every((path) => next[path] === current[path]) ? current : next
        })
      } catch {} finally { runsInFlight = false }
    }

    const refreshProject = async (path: string) => {
      const sessions = await fetchSessions(path, requestSignal()).catch(() => undefined)
      if (controller.signal.aborted) return
      const complete = sessions !== undefined && sessions.length < SESSION_LIST_LIMIT
      setLoadedProjects((current) => {
        if (current.has(path) === complete) return current
        const next = new Set(current)
        if (complete) next.add(path)
        else next.delete(path)
        return next
      })
      if (!sessions) return
      const history = sessions
      const runs = runsRef.current
      setSessionsByProject((current) => {
        const prev = current[path] ?? []
        const visible = updateList(path, prev, history, runs)
        return visible === current[path] ? current : { ...current, [path]: visible }
      })

      const active = activeSessionRef.current
      const summary = history.find((item) => (item.cwd ?? path) === active.cwd && item.id === active.id)
      if (summary) {
        const key = sessionUpdateKey(active.cwd, summary.id)
        const previous = seenSessionUpdatesRef.current.get(key)
        seenSessionUpdatesRef.current.set(key, summary.updatedAt)
        const expected = expectedSessionUpdatesRef.current.delete(key)
        if (previous !== undefined && previous !== summary.updatedAt && !expected && localBusySessionRef.current !== key && !busyRef.current) {
          if (connectionRef.current === "ready") {
            pendingSessionReloadRef.current = undefined
            expectedSessionUpdatesRef.current.add(key)
            setSession((current) => current.runtimeId === active.runtimeId ? { ...current, key: current.key + 1 } : current)
          } else {
            pendingSessionReloadRef.current = key
          }
        }
      }
      return history
    }

    setLoadedProjects((current) => {
      const next = new Set(paths.filter((path) => current.has(path)))
      return next.size === current.size ? current : next
    })
    const refresh = async () => {
      void refreshRuns()
      const currentRound = ++round
      // Share outstanding reads so deletion never treats a pending project as absent.
      const results = await Promise.all(paths.map((path) => {
        const pending = inFlight.get(path)
        if (pending) return pending
        const request = refreshProject(path).finally(() => inFlight.delete(path))
        inFlight.set(path, request)
        return request
      }))
      if (controller.signal.aborted || currentRound !== round) return
      const active = activeSessionRef.current
      if (!active.id) return
      const activeKey = sessionUpdateKey(active.cwd, active.id)
      if (!seenSessionUpdatesRef.current.has(activeKey)) return
      const complete = results.map((result) => result !== undefined && result.length < SESSION_LIST_LIMIT)
      if (!(paths.length > 0 && complete.every(Boolean) || complete[paths.indexOf(active.cwd)])) return
      if (results.some((result, i) => result?.some((item) => (item.cwd ?? paths[i]) === active.cwd && item.id === active.id))) return
      seenSessionUpdatesRef.current.delete(activeKey)
      pendingSessionReloadRef.current = undefined
      removeSessionBrowserState(active.cwd, active.id)
      setSession((current) => current.runtimeId === active.runtimeId ? { cwd: current.cwd, runtimeId: crypto.randomUUID(), key: current.key + 1 } : current)
    }
    const refreshVisible = () => { if (document.visibilityState === "visible") void refresh() }
    void refresh()
    const timer = setInterval(refreshVisible, 2000)
    window.addEventListener("focus", refreshVisible)
    document.addEventListener("visibilitychange", refreshVisible)
    return () => {
      controller.abort()
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
