import { ElicitationCard } from "./components/ElicitationCard"
import { useCallback, useEffect, useRef, useState } from "react"
import { useAgent } from "./agent/useAgent"
import { deleteImageDraft } from "./agent/imageDrafts"
import type { ImageAttachment, ImageBlock, TurnDiff, UserContent } from "./agent/protocol"
import {
  addProject,
  fetchProjects,
  fetchSessions,
  query,
  removeProject,
  revealProject,
  renameSession,
  type ProjectInfo,
  type SessionSummary,
} from "./api"
import { AddProjectDialog } from "./components/AddProjectDialog"
import { Composer } from "./components/Composer"
import { EmptyState } from "./components/EmptyState"
import { MessageList } from "./components/MessageList"
import { DiffActionDialog } from "./components/TurnDiffCard"
import { PermissionCard, type QuestionDraft } from "./components/PermissionCard"
import { QueuedMessages } from "./components/QueuedMessages"
import { RightPanel, type PanelTab } from "./components/RightPanel"
import { OverviewPanel } from "./components/OverviewPanel"
import { ResizeHandle } from "./components/ResizeHandle"
import { usePanelWidth } from "./hooks/usePanelWidth"
import { Sidebar } from "./components/Sidebar"
import TopBar from "./components/TopBar"
import ThemeInjector from "./theme/ThemeInjector"
import { migrateAppearance } from "./lib/appearanceMigration"
import { defaultSettings } from "./theme/settings"
import { SettingsDialog } from "./components/SettingsDialog"
import { SessionTitle } from "./components/SessionTitle"
import { RateLimitNotice } from "./components/RateLimitNotice"
import { ListDetails, PanelRight } from "./lib/icons"

// Noa's default layout widths.
const SIDEBAR_DEFAULT_WIDTH = 340
const SESSION_LIST_LIMIT = 200

function sessionUpdateKey(cwd: string, id: string): string {
  return `${cwd}\0${id}`
}

function removeSessionBrowserState(cwd: string, id: string): void {
  const draftKey = `noa-agent.draft:${cwd}:${id}`
  localStorage.removeItem(draftKey)
  localStorage.removeItem(`${draftKey}:references`)
  localStorage.removeItem(`noa-agent.bookmarks.v2.${id}`)
  void deleteImageDraft(draftKey).catch(() => {})
}

export function App() {
  // Optional workspace: /?cwd=/absolute/path. The bridge resolves the default when absent.
  const [workspace, setWorkspace] = useState<string>()
  const [loadError, setLoadError] = useState<string>()

  useEffect(() => {
    fetch(`/api/info${query(new URLSearchParams(window.location.search).get("cwd") ?? undefined)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? `HTTP ${r.status}`)
        return (await r.json()) as { cwd: string }
      })
      .then((info) => setWorkspace(info.cwd))
      .catch((err: Error) => setLoadError(err.message))
  }, [])

  if (loadError)
    return (
      <div className="grid h-full place-items-center text-[var(--sidebar-text,#52514E)]">
        Cannot open workspace: {loadError}
      </div>
    )
  if (!workspace)
    return <div className="grid h-full place-items-center text-[var(--sidebar-text,#52514E)]">Connecting…</div>
  return <Workspace cwd={workspace} />
}

function Workspace({ cwd }: { cwd: string }) {
  const [settings, setSettings] = useState(() => {
    try {
      const appearance = JSON.parse(localStorage.getItem("noa-agent.appearance") ?? "{}")
      if (appearance.maxWidth === 880) appearance.maxWidth = defaultSettings.appearance.maxWidth
      const agent = { ...defaultSettings.agent, ...JSON.parse(localStorage.getItem("noa-agent.agent") ?? "{}") }
      // Superseded by permissionDefault. A stored "default" was the old initial value, so only explicit choices carry over.
      if (["acceptEdits", "plan", "auto"].includes(agent.defaultPermissionMode)) agent.permissionDefault = agent.defaultPermissionMode
      delete agent.defaultPermissionMode
      return {
        ...defaultSettings,
        appearance: {
          ...defaultSettings.appearance,
          ...migrateAppearance(appearance),
        },
        agent,
        composer: { ...defaultSettings.composer, ...JSON.parse(localStorage.getItem("noa-agent.composer") ?? "{}") },
      }
    } catch {
      return defaultSettings
    }
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  // The settings page overlays the whole window, so CSS hides the app shell while it is open.
  // The attribute hides the shell, so it is cleared on unmount too: a stuck flag would leave a blank window.
  useEffect(() => {
    if (settingsOpen) document.documentElement.dataset.settingsOpen = "true"
    else delete document.documentElement.dataset.settingsOpen
    return () => { delete document.documentElement.dataset.settingsOpen }
  }, [settingsOpen])
  useEffect(() => {
    localStorage.setItem("noa-agent.appearance", JSON.stringify(settings.appearance))
    localStorage.setItem("noa-agent.agent", JSON.stringify(settings.agent))
    localStorage.setItem("noa-agent.composer", JSON.stringify(settings.composer))
  }, [settings])
  const readingWidth = settings.appearance.maxWidth
  // cwd travels with resume: a session belongs to the project it was started in.
  const [session, setSession] = useState<{ cwd: string; resume?: string; runtimeId: string; key: number }>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("noa-agent.current") ?? "null")
      if (saved?.cwd && saved?.runtimeId && (!new URLSearchParams(window.location.search).get("cwd") || saved.cwd === cwd)) return { ...saved, key: 0 }
    } catch {}
    return { cwd, runtimeId: crypto.randomUUID(), key: 0 }
  })
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [sessionsByProject, setSessionsByProject] = useState<Record<string, SessionSummary[]>>({})
  const [loadedProjects, setLoadedProjects] = useState<ReadonlySet<string>>(() => new Set())
  const [refreshTick, setRefreshTick] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  // The translucent veil animates only for the sidebar's own dock motion (never on first paint, when the flag is still off). The flag is derived
  // while rendering, so it lands in the same commit as the new material width; set from an effect it would arrive a
  // frame late and the veil would snap to its destination instead of transitioning.
  const [dockMotion, setDockMotion] = useState(false)
  const [dockedOpen, setDockedOpen] = useState(sidebarOpen)
  if (dockedOpen !== sidebarOpen) {
    setDockedOpen(sidebarOpen)
    setDockMotion(true)
  }
  useEffect(() => {
    if (!dockMotion) return
    const timer = setTimeout(() => setDockMotion(false), 520)
    return () => clearTimeout(timer)
  }, [dockMotion, sidebarOpen])
  const [rightOpen, setRightOpen] = useState(true)
  // The docked column is visible while it is shown and fits; when it does not fit, the toggle opens a transient
  // popover instead. Both open only from the toggle: never persisted, and a column that stops fitting becomes
  // the popover, so widening the window again cannot re-dock it on its own.
  const [overviewShown, setOverviewShown] = useState(false)
  // The popover belongs to the session it was raised in, as Claude's rail overlay is keyed to its session id.
  const [overviewPopover, setOverviewPopover] = useState<number | null>(null)
  const [addingProject, setAddingProject] = useState(false)
  const [editingProject, setEditingProject] = useState<ProjectInfo>()
  const [quote, setQuote] = useState<{ text: string; key: number }>()
  const [reference, setReference] = useState<{ path: string; key: number }>()
  const [editDraft, setEditDraft] = useState<{ text: string; images: ImageAttachment[]; key: number }>()
  const [queueEditId, setQueueEditId] = useState<string>()
  const [changes, setChanges] = useState<{ count: number; additions: number; deletions: number; branch: string; files: { path: string; additions: number; deletions: number; binary: boolean }[] }>()
  const [turnDiff, setTurnDiff] = useState<{ diff: TurnDiff; path?: string; key: number }>()
  const [pendingDiffAction, setPendingDiffAction] = useState<number>()
  const [rightTab, setRightTab] = useState<PanelTab>("files")
  useEffect(() => { setTurnDiff(undefined) }, [session.key])

  const { state, sendMessage, reloadCommands, loadEarlier, interrupt, answerPermission, answerElicitation, removeQueued, moveQueued, updateQueued, steerQueued, setQueuePaused, runQueued, stopTask, setModel, setPermissionMode, setEffort, refreshSettings, changeMcp, refreshContext, refreshMcp, turnDiffAction, clearDiffAction, startAuthentication, waitForAuthentication, submitAuthenticationCode, closeAuthentication } =
    useAgent({
      cwd: session.cwd,
      resume: session.resume,
      sessionKey: session.key,
      runtimeId: session.runtimeId,
      defaultPermissionMode: settings.agent.permissionDefault === "inherit" ? undefined : settings.agent.permissionDefault,
    })
  const activeId = state.sessionId ?? session.resume
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
    fetchProjects().then(setProjects)
  }, [])

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
          setSessionsByProject((current) => Object.fromEntries(projects.map((project, index) => {
            const result = results[index]!
            const sessions = (result.status === "fulfilled" ? result.value : current[project.path] ?? []).map((session): SessionSummary => {
              const run = runs.find((r) => r.cwd === (session.cwd ?? project.path) && r.sessionId === session.id)
              return { ...session, status: run?.waiting ? "waiting" : run?.busy ? "running" : run?.queued ? "queued" : undefined }
            })
            for (const run of runs.filter((r) => r.cwd === project.path && r.sessionId)) {
              if (!sessions.some((s) => s.id === run.sessionId)) sessions.unshift({ id: run.sessionId!, title: run.title ?? "New task", updatedAt: Date.now(), createdAt: Date.now(), status: run.waiting ? "waiting" : run.busy ? "running" : run.queued ? "queued" : undefined })
            }
            return [project.path, sessions]
          })))
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

  useEffect(() => {
    if (!state.diffAction) return
    setPendingDiffAction(undefined)
    if (state.diffAction.result.ok) setRefreshTick((n) => n + 1)
  }, [state.diffAction])

  useEffect(() => {
    let cancelled = false
    setChanges(undefined)
    fetch(`/api/changes${query(session.cwd)}`)
      .then(async (r) => {
        if (!r.ok) return
        const body = await r.json()
        if (!cancelled)
          setChanges({
            count: body.files.length,
            additions: body.additions,
            deletions: body.deletions,
            branch: body.branch,
            files: body.files,
          })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [session.cwd, state.result, refreshTick])

  // A new user turn makes the previous turn's diff stale. If Changes is open,
  // follow the new turn's live/final diff instead.
  const lastUserId = state.turns.reduce<string | undefined>(
    (id, turn) => (turn.role === "user" ? turn.id : id),
    undefined,
  )
  const lastUserIdRef = useRef(lastUserId)
  useEffect(() => {
    if (lastUserIdRef.current === lastUserId) return
    lastUserIdRef.current = lastUserId
    setTurnDiff(undefined)
  }, [lastUserId])

  const lastUserIndex = state.turns.reduce((index, turn, i) => (turn.role === "user" ? i : index), -1)
  let currentTurnDiff: TurnDiff | undefined
  for (let i = state.turns.length - 1; i > lastUserIndex; i--) {
    const turn = state.turns[i]
    if (turn?.role === "assistant" && turn.diff) {
      currentTurnDiff = turn.diff
      break
    }
  }
  useEffect(() => {
    if (!rightOpen || rightTab !== "changes") return
    const diff = state.liveDiff ?? currentTurnDiff
    if (!diff) return
    setTurnDiff((current) => {
      if (!diff.files.length) return current?.diff.turnIndex === diff.turnIndex ? undefined : current
      // Keep a turn the user explicitly opened; follow this turn's updates.
      if (current && current.diff.turnIndex !== undefined && current.diff.turnIndex !== diff.turnIndex) return current
      // Live updates keep the same key so they don't re-force the Turn scope.
      const key = current && current.diff.turnIndex === diff.turnIndex ? current.key : Date.now()
      return { diff, path: current?.path, key }
    })
  }, [state.liveDiff, currentTurnDiff, rightOpen, rightTab])

  const requestDraftPrefix = `${session.cwd}:${activeId ?? session.runtimeId}:`
  const questionDrafts = useRef(new Map<string, QuestionDraft>())
  const elicitationDrafts = useRef(new Map<string, Record<string, string[]>>())
  useEffect(() => {
    if (state.connection !== "ready") return
    const prefix = requestDraftPrefix
    const pending = new Set([...state.permissions, ...state.elicitations].map(request => prefix + request.requestId))
    for (const drafts of [questionDrafts.current, elicitationDrafts.current]) {
      for (const key of drafts.keys()) if (key.startsWith(prefix) && !pending.has(key)) drafts.delete(key)
    }
  }, [requestDraftPrefix, state.connection, state.permissions, state.elicitations])

  useEffect(() => {
    localStorage.setItem("noa-agent.current", JSON.stringify({ cwd: session.cwd, resume: activeId, runtimeId: session.runtimeId }))
  }, [session.cwd, session.runtimeId, activeId])
  const panelToggle = (
    <button
      type="button"
      onClick={() => setRightOpen((o) => !o)}
      className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-[var(--icon-ink,#52514E)] transition-colors hover:bg-[var(--fill-hover)] hover:text-[var(--text-primary,#2D2D2B)]"
      title="Right panel"
      aria-label="Right panel"
      aria-pressed={rightOpen}
    >
      <PanelRight size={16} />
    </button>
  )

  // Back and forward step through the tasks the user has opened, like browser history.
  const [history, setHistory] = useState<{ entries: { cwd: string; resume?: string; runtimeId?: string }[]; index: number }>()
  const pushHistory = (target: { cwd: string; resume?: string; runtimeId?: string }) =>
    setHistory((h) => {
      const past = h ? h.entries.slice(0, h.index + 1) : [{ cwd: session.cwd, resume: activeId, runtimeId: session.runtimeId }]
      return { entries: [...past, target], index: past.length }
    })
  useEffect(() => {
    if (!activeId) return
    setHistory((h) => h ? { ...h, entries: h.entries.map((entry, i) => i === h.index ? { ...entry, resume: activeId, runtimeId: session.runtimeId } : entry) } : h)
  }, [activeId, session.runtimeId])
  const goHistory = (step: -1 | 1) => {
    if (!history) return
    const index = history.index + step
    const target = history.entries[index]
    if (!target) return
    pendingSessionReloadRef.current = undefined
    localBusySessionRef.current = undefined
    if (target.resume) seedSessionUpdate(target.cwd, target.resume)
    setHistory({ ...history, index })
    setQuote(undefined)
    setReference(undefined)
    setEditDraft(undefined)
    setQueueEditId(undefined)
    setSession((s) => ({ cwd: target.cwd, resume: target.resume, runtimeId: target.runtimeId ?? crypto.randomUUID(), key: s.key + 1 }))
  }
  // Set while the session runs in a worktree: the project checkout that worktree belongs to.
  const [worktreeOf, setWorktreeOf] = useState<string>()
  useEffect(() => {
    let cancelled = false
    fetch(`/api/worktree${query(session.cwd)}`)
      .then((r) => (r.ok ? r.json() : { origin: null }))
      .then((info: { origin: string | null }) => !cancelled && setWorktreeOf(info.origin ?? undefined), () => !cancelled && setWorktreeOf(undefined))
    return () => { cancelled = true }
  }, [session.cwd])
  const worktreeRequest = async (cwd: string, body: { action: "create" | "remove"; base?: string }) => {
    const response = await fetch(`/api/worktree${query(cwd)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error ?? "Git command failed")
    return result as { path?: string }
  }
  // A worktree is made as soon as the switch turns on and dropped again when it turns off, so an
  // abandoned new task leaves nothing behind but the switch's own state.
  const toggleWorktree = async (on: boolean) => {
    if (on) {
      const { path } = await worktreeRequest(session.cwd, { action: "create", base: changes?.branch === "Detached HEAD" ? undefined : changes?.branch })
      setWorktreeOf(session.cwd)
      newSession(path!)
    } else if (worktreeOf) {
      const worktree = session.cwd
      newSession(worktreeOf)
      await worktreeRequest(worktree, { action: "remove" }).catch(() => undefined)
    }
  }
  const newSession = (dir?: string) => {
    setQuote(undefined)
    setReference(undefined)
    setEditDraft(undefined)
    setQueueEditId(undefined)
    pendingSessionReloadRef.current = undefined
    localBusySessionRef.current = undefined
    const runtimeId = crypto.randomUUID()
    pushHistory({ cwd: dir ?? session.cwd, runtimeId })
    setSession((s) => ({ cwd: dir ?? s.cwd, resume: undefined, runtimeId, key: s.key + 1 }))
  }
  const selectSession = (dir: string, id: string) => {
    if (dir === session.cwd && id === activeId) return
    setQuote(undefined)
    setReference(undefined)
    setEditDraft(undefined)
    setQueueEditId(undefined)
    pendingSessionReloadRef.current = undefined
    localBusySessionRef.current = undefined
    seedSessionUpdate(dir, id)
    const runtimeId = crypto.randomUUID()
    pushHistory({ cwd: dir, resume: id, runtimeId })
    setSession((s) => ({ cwd: dir, resume: id, runtimeId, key: s.key + 1 }))
  }
  const [focusChange, setFocusChange] = useState<{ path: string; at: number }>()
  const [focusFile, setFocusFile] = useState<{ path: string; at: number; line?: number; endLine?: number }>()
  const showWorkspacePane = (tab: "files" | "changes", path?: string) => {
    setRightOpen(true)
    setRightTab(tab)
    if (path) setFocusChange({ path, at: Date.now() })
  }

  async function addProjectPaths(paths: string[], name: string) {
    setProjects(await addProject(paths, name))
  }

  async function removeProjectPath(path: string) {
    setProjects(await removeProject(path))
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault()
        newSession()
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setSidebarOpen(true)
        requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[aria-label="Search tasks"]')?.focus())
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault()
        setSettingsOpen(true)
      }
      if (
        e.key === "Escape" &&
        state.busy &&
        !e.defaultPrevented &&
        !(e.target instanceof HTMLTextAreaElement) &&
        !document.querySelector('dialog[open], [role="dialog"], [role="menu"]')
      ) {
        e.preventDefault()
        interrupt()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [state.busy, activeId, session, history])

  const firstUserText = state.turns.find((t) => t.role === "user")?.text
  const title =
    sessionsByProject[session.cwd]?.find((s) => s.id === activeId)?.title ??
    firstUserText?.replace(/\s+/g, " ").trim().slice(0, 80)

  // Retry resends the last prompt: the bridge has no regenerate call, so this is a new turn with the same content.
  function retryLast() {
    const last = [...state.turns].reverse().find((turn) => turn.role === "user")
    if (!last) return
    const content = last.images?.length
      ? [...last.images, ...(last.text ? [{ type: "text" as const, text: last.text }] : [])]
      : last.text
    if (content) {
      if (activeId) localBusySessionRef.current = sessionUpdateKey(session.cwd, activeId)
      sendMessage(content)
    }
  }

  // Edit loads the message back into the composer; sending it again adds a new turn rather than rewriting history.
  function editMessage(text: string, images?: ImageBlock[], queuedId?: string) {
    setQueueEditId(queuedId)
    setEditDraft({
      text,
      images: (images ?? []).map((image, index) => ({
        id: crypto.randomUUID(),
        name: `image-${index + 1}.${image.source.media_type.split("/")[1] ?? "png"}`,
        dataUrl: `data:${image.source.media_type};base64,${image.source.data}`,
      })),
      key: Date.now(),
    })
  }
  function editQueued(message: typeof state.queue[number]) {
    setQueuePaused(true)
    const content = typeof message.content === "string"
      ? { text: message.content, images: [] as ImageBlock[] }
      : {
          text: message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n"),
          images: message.content.filter((block): block is ImageBlock => block.type === "image"),
        }
    editMessage(content.text, content.images, message.id)
  }
  useEffect(() => {
    if (queueEditId && !state.queue.some((message) => message.id === queueEditId)) {
      setQueueEditId(undefined)
      setEditDraft(undefined)
    }
  }, [queueEditId, state.queue])
  function sendComposer(content: UserContent) {
    const sent = queueEditId ? updateQueued(queueEditId, content) : sendMessage(content)
    if (!sent) return false
    if (!queueEditId && activeId) localBusySessionRef.current = sessionUpdateKey(session.cwd, activeId)
    setQueueEditId(undefined)
    setEditDraft(undefined)
    return true
  }
  const hasTurns = state.turns.length > 0
  const sidebar = usePanelWidth("noa-agent.sidebarWidth", SIDEBAR_DEFAULT_WIDTH, 240, 520)
  const [rightRatio, setRightRatio] = useState<number | null>(() => {
    try {
      const saved = localStorage.getItem("noa-agent.rightPanelWidthRatio")
      if (saved === null) return null
      const ratio = Number(saved)
      return Number.isFinite(ratio) && ratio >= 0 && ratio <= 1 ? ratio : null
    } catch { return null }
  })
  useEffect(() => {
    try {
      if (rightRatio !== null) localStorage.setItem("noa-agent.rightPanelWidthRatio", String(rightRatio))
    } catch { /* Storage unavailable. */ }
  }, [rightRatio])
  // Dragging follows the pointer, so the column's width transition is off while a handle is held.
  const [resizing, setResizing] = useState(false)
  const [windowSize, setWindowSize] = useState({ width: window.innerWidth, height: window.innerHeight })
  const [windowResizing, setWindowResizing] = useState(false)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const resize = () => {
      setWindowResizing(true)
      setWindowSize({ width: window.innerWidth, height: window.innerHeight })
      clearTimeout(timer)
      timer = setTimeout(() => setWindowResizing(false), 150)
    }
    window.addEventListener("resize", resize)
    return () => { window.removeEventListener("resize", resize); clearTimeout(timer) }
  }, [])
  const moving = resizing || windowResizing
  const animate = moving ? "" : "transition-[width,--noa-edge-fade,border-radius,border-left-color] duration-500 ease-in-out"
  // Closed panes keep their content width while the outer edge slides away.
  const sidebarTarget = Math.round(Math.max(240, Math.min(sidebar.width, windowSize.width - (rightOpen ? 320 + 352 : 352))))
  const sidebarWidth = sidebarOpen ? sidebarTarget : 0
  const workspaceWidth = windowSize.width - sidebarWidth
  const rightMax = Math.max(320, workspaceWidth - 352)
  const rightDefault = Math.max(320, Math.min(windowSize.height * 1.6, workspaceWidth - 500), Math.min(640, workspaceWidth - 352))
  const defaultRatio = rightMax === 320 ? 0 : Math.max(0, Math.min(1, (rightDefault - 320) / (rightMax - 320)))
  useEffect(() => {
    if (rightRatio === null && rightMax > 320) setRightRatio(defaultRatio)
  }, [rightRatio, rightMax, defaultRatio])
  const rightTarget = Math.round(320 + (rightRatio ?? defaultRatio) * (rightMax - 320))
  const rightWidth = rightOpen ? rightTarget : 0
  // Claude's rule: the overview docks as a column when the chat area is wide enough (more with a pane open),
  // otherwise it floats over the chat as a popover.
  // Measure the chat column itself: window-size state lags a live resize and the sidebar animates, so a
  // computed width can dock the overview while the real column is too narrow to hold it.
  const chatColumnRef = useRef<HTMLDivElement>(null)
  const [measuredChatWidth, setMeasuredChatWidth] = useState<number>()
  useEffect(() => {
    const el = chatColumnRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setMeasuredChatWidth(el.offsetWidth))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const chatWidth = measuredChatWidth ?? workspaceWidth - rightWidth
  const overviewDocked = chatWidth >= (rightOpen ? 771 : 611)
  const overviewDockedVisible = overviewShown && overviewDocked
  const overviewPopoverOpen = overviewPopover === session.key && !overviewDockedVisible
  const overviewVisible = overviewDockedVisible || overviewPopoverOpen
  useEffect(() => { if (overviewPopover !== null && !overviewPopoverOpen) setOverviewPopover(null) }, [overviewPopover, overviewPopoverOpen])
  // A docked column that stops fitting turns into the popover instead of vanishing.
  useEffect(() => { if (overviewShown && !overviewDocked) { setOverviewShown(false); setOverviewPopover(session.key) } }, [overviewShown, overviewDocked, session.key])
  const toggleOverview = () => {
    if (overviewVisible) {
      setOverviewPopover(null)
      if (overviewDockedVisible) setOverviewShown(false)
      return
    }
    if (overviewDocked) setOverviewShown(true)
    else setOverviewPopover(session.key)
  }
  const overviewDockInset = overviewDockedVisible ? 280 + 8 + 12 : 0

  const footerRef = useRef<HTMLDivElement>(null)
  const [footerHeight, setFooterHeight] = useState(0)
  useEffect(() => {
    const el = footerRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setFooterHeight(el.offsetHeight))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      data-sidebar-dock-motion={dockMotion ? "true" : undefined}
      className="noa-app-shell h-screen w-screen flex flex-col isolate bg-[var(--bg-sidebar,#FBFBF9)] text-[var(--text-primary,#2D2D2B)] font-ui overflow-hidden relative selection:bg-[var(--accent-color,#CC7D5E)] selection:text-white"
      style={
        {
          "--noa-sidebar-width": `${sidebar.width}px`,
          "--noa-sidebar-material-width": `${sidebarWidth}px`,
          "--noa-right-panel-width": `${rightWidth}px`,
        } as React.CSSProperties
      }
    >
      <ThemeInjector settings={settings} />

      {/* The sidebar runs the full height behind the titlebar, as in Noa; the TopBar paints only beside it. */}
      <div
        data-sidebar-container
        data-sidebar-column-surface="true"
        data-sidebar-expanded={sidebarOpen ? "true" : undefined}
        inert={!sidebarOpen ? true : undefined}
        className={`noa-edge-fade-right absolute inset-y-0 left-0 z-10 overflow-hidden bg-[var(--bg-sidebar,#FBFBF9)] ${animate}`}
        style={{ width: sidebarWidth, "--noa-edge-fade": sidebarOpen ? "0px" : "28px" } as React.CSSProperties}
      >
        <div
          className="h-full transition-opacity duration-500 ease-in-out"
          style={{ width: sidebarOpen ? "100%" : sidebarTarget, opacity: sidebarOpen ? 1 : 0 }}
        >
          <Sidebar
            projects={projects}
            sessions={sessionsByProject}
            loadedProjects={loadedProjects}
            active={{ cwd: session.cwd, id: activeId }}
            onNewSession={newSession}
            onSelect={selectSession}
            onAddProject={() => {
              setEditingProject(undefined)
              setAddingProject(true)
            }}
            onEditProject={(project) => {
              setAddingProject(false)
              setEditingProject(project)
            }}
            onRemoveProject={removeProjectPath}
            onRevealProject={revealProject}
            onSettings={() => setSettingsOpen(true)}
          />
        </div>
      </div>
      {/* The content surface rides over the sidebar floor, so its left edge is a rounded card edge instead of a
          straight hairline; the sidebar colour shows through the corner notches. Behind the in-flow columns. */}
      <div
        aria-hidden="true"
        data-content-surface
        data-flush={sidebarOpen ? undefined : true}
        className={`noa-content-surface ${moving ? "" : "transition-[left,border-radius,border-left-color] duration-500 ease-in-out"}`}
        style={{ left: sidebarWidth }}
      />
      {/* One titlebar rule across both columns; above the right panel so it is not hidden behind it. */}
      <div
        aria-hidden="true"
        data-titlebar-divider
        className={`pointer-events-none absolute z-40 h-[0.5px] bg-[var(--divider-subtle,#E6E2DA)] ${moving ? "" : "transition-[left] duration-500 ease-in-out"}`}
        style={{ top: 43.5, left: sidebarWidth, right: 0 }}
      />
      {rightOpen && (
        <ResizeHandle
          label="Resize right panel"
          grow={-1}
          width={rightWidth}
          defaultWidth={rightDefault}
          onResize={(width) => setRightRatio(rightMax === 320 ? 0 : Math.max(0, Math.min(1, (width - 320) / (rightMax - 320))))}
          onDraggingChange={setResizing}
          style={{ right: rightWidth - 4, zIndex: 40 }}
        />
      )}
      {sidebarOpen && (
        <ResizeHandle
          label="Resize sidebar"
          grow={1}
          width={sidebarWidth}
          defaultWidth={SIDEBAR_DEFAULT_WIDTH}
          onResize={sidebar.set}
          onDraggingChange={setResizing}
          style={{ left: sidebarWidth - 4 }}
        />
      )}
      {/* The right column runs the full height too, so its cards start at the top edge. */}
      <div
        data-right-panel-container
        data-flush={rightOpen ? undefined : true}
        inert={!rightOpen ? true : undefined}
        className={`noa-right-surface absolute inset-y-0 right-0 z-30 overflow-hidden bg-[var(--surface-page,#F9F9F7)] ${animate}`}
        // No-drag and above the titlebar, so the tab row can sit level with the panel toggle.
        style={
          {
            width: rightWidth,
            "--noa-edge-fade": rightOpen ? "0px" : "28px",
            WebkitAppRegion: "no-drag",
          } as React.CSSProperties
        }
      >
        <div
          className="noa-edge-fade-left absolute inset-y-0 right-0 h-full transition-opacity duration-500 ease-in-out"
          style={{ width: rightOpen ? "100%" : rightTarget, opacity: rightOpen ? 1 : 0 }}
        >
          <RightPanel
            state={state}
            onStopTask={stopTask}
            cwd={session.cwd}
            tab={rightTab}
            onTab={setRightTab}
            onReference={(path) => setReference({ path, key: Date.now() })}
            onWorkspaceChange={() => setRefreshTick((n) => n + 1)}
            workspaceRefreshKey={refreshTick}
            focusChange={focusChange}
            focusFile={focusFile}
            turnDiff={turnDiff}
          />
        </div>
      </div>

      <TopBar
        resizing={moving}
        sidebarOpen={sidebarOpen}
        sidebarWidth={sidebarWidth}
        rightWidth={rightWidth}
        onToggleSidebar={() => setSidebarOpen((o) => !o)}
        canBack={!!history && history.index > 0}
        canForward={!!history && history.index < history.entries.length - 1}
        onBack={() => goHistory(-1)}
        onForward={() => goHistory(1)}
        center={
          <SessionTitle
            key={activeId ?? session.key}
            project={session.cwd.split("/").pop() ?? session.cwd}
            title={title}
            onRename={
              activeId && !state.busy
                ? async (name) => {
                    expectedSessionUpdatesRef.current.add(sessionUpdateKey(session.cwd, activeId))
                    const updated = await renameSession(session.cwd, activeId, name)
                    setSessionsByProject((all) => ({ ...all, [session.cwd]: updated }))
                  }
                : undefined
            }
          />
        }
      />
      {/* The column toggle is fixed to the window's top-right corner, above the column in either state. */}
      <div
        className="absolute right-[15px] top-[10px] z-40"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={toggleOverview}
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-[var(--icon-ink,#52514E)] transition-colors hover:bg-[var(--fill-hover)] hover:text-[var(--text-primary,#2D2D2B)] aria-pressed:bg-[var(--fill-active)]"
            title="Overview"
            aria-label="Overview"
            data-overview-toggle=""
            aria-pressed={overviewVisible}
          >
            <ListDetails size={16} />
          </button>
          {panelToggle}
        </div>
      </div>

      <div className="flex-1 flex min-h-0 overflow-visible relative">
        <div
          ref={chatColumnRef}
          className={`relative flex min-w-0 flex-1 flex-col ${moving ? "" : "transition-[margin-left,margin-right] duration-500 ease-in-out"}`}
          style={{ marginLeft: sidebarWidth, marginRight: rightWidth, paddingRight: overviewDockInset, "--noa-overview-dock": `${overviewDockInset}px`, "--composer-overlay": `${footerHeight}px` } as React.CSSProperties}
        >
          {hasTurns ? (
            <MessageList
              key={session.key}
              cwd={session.cwd}
              sessionId={activeId}
              historyBefore={state.historyBefore}
              historyLoading={state.historyLoading}
              onLoadEarlier={loadEarlier}
              onOpenFile={(path, line, endLine) => { setRightOpen(true); setRightTab("files"); setFocusFile({ path, line, endLine, at: Date.now() }) }}
              turns={state.turns}
              busy={state.busy}
              result={state.result}
              readingWidth={readingWidth}
              liveDiff={state.liveDiff}
              onTurnDiff={(diff, path) => {
                setTurnDiff({ diff, path, key: Date.now() })
                setRightOpen(true)
                setRightTab("changes")
              }}
              onTurnDiffAction={(diff, action) => {
                if (diff.turnIndex === undefined) return
                setPendingDiffAction(diff.turnIndex)
                turnDiffAction(diff.turnIndex, action)
              }}
              diffActionPending={pendingDiffAction}
              onRetry={retryLast}
              onEdit={editMessage}
              onQuote={text => setQuote({ text, key: Date.now() })}
              tasks={state.tasks}
              onStopTask={stopTask}
              onOpenTask={() => {
                setRightOpen(true)
                setRightTab("activity")
              }}
            />
          ) : (
            <EmptyState
              cwd={session.cwd}
              projects={projects}
              onSelectProject={(path) => newSession(path)}
              onAddProject={() => setAddingProject(true)}
            />
          )}
          {/* With a conversation the composer floats over the list:
              messages scroll beneath it and a gradient fades them out above the card. */}
          <div ref={footerRef} className={hasTurns ? "noa-conversation-footer" : "shrink-0 px-[29px] pb-3 pt-2"}>
            <div className="mx-auto flex flex-col gap-2" style={{ maxWidth: readingWidth + 22 }}>
              {(state.connection === "closed") && (
                <div
                  role="status"
                  className="flex items-center justify-center gap-2 text-caption text-[var(--sidebar-text-muted)]"
                >
                  <span
                    className={`size-1.5 rounded-full ${state.connection === "closed" ? "bg-red-500" : "animate-pulse bg-[var(--accent-color)]"}`}
                  />
                  <span className={state.connection === "closed" ? undefined : "noa-shimmer"}>
                  {state.connection === "closed"
                    ? "Agent disconnected"
                    : "Compacting context…"}
                  </span>
                  {state.connection === "closed" && (
                    <button
                      className="text-[var(--accent-color)]"
                      onClick={() => setSession((s) => ({ ...s, resume: activeId, key: s.key + 1 }))}
                    >
                      Reconnect
                    </button>
                  )}
                  {state.connection === "closed" && (
                    <button className="text-[var(--accent-color)]" onClick={() => { setRightOpen(true); setRightTab("activity") }}>
                      Diagnostics
                    </button>
                  )}
                </div>
              )}
              {(state.permissions.length > 0 || state.elicitations.length > 0) && (
                <div className="flex min-h-0 max-h-[50vh] flex-col gap-2 overflow-y-auto p-px">
                  {state.permissions.map((permission) => (
                    <PermissionCard key={permission.requestId} permission={permission} onAnswer={answerPermission} draft={questionDrafts.current.get(requestDraftPrefix + permission.requestId)} onDraftChange={draft => questionDrafts.current.set(requestDraftPrefix + permission.requestId, draft)} />
                  ))}
                  {state.elicitations.map((request) => <ElicitationCard key={request.requestId} request={request} onAnswer={answerElicitation} draft={elicitationDrafts.current.get(requestDraftPrefix + request.requestId)} onDraftChange={draft => elicitationDrafts.current.set(requestDraftPrefix + request.requestId, draft)} />)}
                </div>
              )}
              {state.queue.length > 0 && (
                <QueuedMessages
                  messages={state.queue}
                  busy={state.busy}
                  paused={state.queuePaused}
                  editing={!!queueEditId}
                  onMove={moveQueued}
                  onRemove={removeQueued}
                  onEdit={editQueued}
                  onSteer={steerQueued}
                  onRetry={(id) => {
                    moveQueued(id, 0)
                    setQueuePaused(false)
                    runQueued()
                  }}
                  onRun={runQueued}
                  onPaused={setQueuePaused}
                />
              )}
              {state.rateLimit && <RateLimitNotice info={state.rateLimit} />}
              {state.notice && <p role="status" className="m-0 px-1 text-caption text-[var(--sidebar-text-muted)]">{state.notice}</p>}
              {state.error && !state.turns.some(turn => turn.role === "assistant" && turn.error === state.error) && (
                <p role="alert" className="m-0 break-words px-1 text-caption text-[#C24444]">
                  {state.error}
                </p>
              )}
              <Composer
                key={session.key}
                draftKey={`noa-agent.draft:${session.cwd}:${activeId ?? session.runtimeId}`}
                reference={reference}
                quote={quote}
                onQuoteConsumed={() => setQuote(undefined)}
                editDraft={editDraft ? { ...editDraft, queued: !!queueEditId, label: queueEditId ? "Edit queued message" : "Edit and resend" } : undefined}
                onCancelEdit={() => {
                  setEditDraft(undefined)
                  setQueueEditId(undefined)
                }}
                effort={state.effort}
                onEffort={setEffort}
                cwd={session.cwd}
                projects={projects}
                onProject={newSession}
                branch={changes?.branch}
                onBranchChange={() => setRefreshTick((n) => n + 1)}
                worktreeOf={worktreeOf}
                onWorktree={toggleWorktree}
                onFiles={() => showWorkspacePane("files")}
                newTask={!hasTurns}
                contextUsage={settings.composer.showContextUsage ? state.contextUsage : undefined}
                sendShortcut={settings.composer.sendShortcut}
                connection={state.connection}
                busy={state.busy}
                models={state.models}
                model={state.model}
                mode={state.permissionMode}
                commands={state.commands}
                onSend={sendComposer}
                onCommand={(action) => {
                  if (action === "new") newSession()
                  else if (action === "resume") {
                    setSidebarOpen(true)
                    requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[aria-label="Search tasks"]')?.focus())
                  } else if (action === "settings") setSettingsOpen(true)
                  else if (action === "context") { if (!overviewVisible) toggleOverview(); refreshContext() }
                  else if (action === "activity") { setRightOpen(true); setRightTab("activity") }
                  else if (action === "plan") setPermissionMode("plan")
                  else if (action === "stop") interrupt()
                  else if (action === "reload") reloadCommands()
                }}
                onInterrupt={interrupt}
                onModel={setModel}
                onMode={setPermissionMode}
              />
            </div>
          </div>
          <OverviewPanel
            state={state}
            cwd={session.cwd}
            open={overviewVisible}
            workspaceRefreshKey={refreshTick}
            endInset={8}
            // The popover stops above the composer card (the footer's 32px top padding is only a fade).
            bottomInset={Math.max(0, footerHeight - 32)}
            docked={overviewDockedVisible}
            onClose={() => setOverviewPopover(null)}
            onRefreshContext={refreshContext}
            onRefreshMcp={refreshMcp}
            onReference={(path) => setReference({ path, key: Date.now() })}
            onOpenChanges={() => { setRightOpen(true); setRightTab("changes") }}
          />
        </div>
      </div>

      {addingProject && <AddProjectDialog onAdd={addProjectPaths} onClose={() => setAddingProject(false)} />}
      {editingProject && (
        <AddProjectDialog
          project={editingProject}
          onAdd={addProjectPaths}
          onClose={() => setEditingProject(undefined)}
        />
      )}
      {state.diffAction && (
        <DiffActionDialog
          action={state.diffAction.action}
          result={state.diffAction.result}
          onClose={clearDiffAction}
        />
      )}
      {settingsOpen && (
        <SettingsDialog
          navWidth={sidebarTarget}
          navResizeHandle={
            <ResizeHandle
              label="Resize sidebar"
              grow={1}
              width={sidebarTarget}
              defaultWidth={SIDEBAR_DEFAULT_WIDTH}
              onResize={sidebar.set}
              onDraggingChange={setResizing}
              style={{ left: sidebarTarget - 4 }}
            />
          }
          settings={settings}
          agent={state}
          onRefreshSettings={refreshSettings}
          onRefreshMcp={refreshMcp}
          onChangeMcp={changeMcp}
          onReloadCommands={reloadCommands}
          onModel={setModel}
          onEffort={setEffort}
          onMode={setPermissionMode}
          onChange={setSettings}
          onClose={() => setSettingsOpen(false)}
          account={state.account}
          auth={state.auth}
          onStartAuthentication={startAuthentication}
          onWaitForAuthentication={waitForAuthentication}
          onSubmitAuthenticationCode={submitAuthenticationCode}
          onCloseAuthentication={() => {
            const completed = state.auth?.status === "complete"
            closeAuthentication()
            if (completed) {
              const resume = state.sessionId ?? session.resume
              setSession((current) => ({
                cwd: current.cwd,
                resume,
                runtimeId: crypto.randomUUID(),
                key: current.key + 1,
              }))
            }
          }}
        />
      )}
    </div>
  )
}
