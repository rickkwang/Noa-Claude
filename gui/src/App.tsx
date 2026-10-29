import { ElicitationCard } from "./components/ElicitationCard"
import { useCallback, useEffect, useRef, useState } from "react"
import { useAgent } from "./agent/useAgent"
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
import { defaultSettings } from "./theme/settings"
import { SettingsDialog } from "./components/SettingsDialog"
import { SessionTitle } from "./components/SessionTitle"
import { RateLimitNotice } from "./components/RateLimitNotice"
import { ListDetails, PanelRight } from "./lib/icons"

// Noa's default layout widths.
const SIDEBAR_DEFAULT_WIDTH = 340

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
      if (agent.defaultPermissionMode === "bypassPermissions") {
        agent.defaultPermissionMode = defaultSettings.agent.defaultPermissionMode
        agent.showFullAccess = true
      }
      return {
        ...defaultSettings,
        appearance: {
          ...defaultSettings.appearance,
          ...appearance,
        },
        agent,
      }
    } catch {
      return defaultSettings
    }
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  useEffect(() => {
    localStorage.setItem("noa-agent.appearance", JSON.stringify(settings.appearance))
    localStorage.setItem("noa-agent.agent", JSON.stringify(settings.agent))
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
  const [refreshTick, setRefreshTick] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  // Claude's session-rail model. `shown` is the remembered preference. The docked column is visible when it
  // is shown and fits; when it does not fit, the toggle opens a transient popover instead. The popover
  // closes by itself once the column becomes visible, and a hidden column never morphs into a popover.
  // Claude's session-rail model: `shown` is the remembered preference. The docked column is visible when it
  // is shown and fits; when it does not fit, the toggle opens a transient popover instead.
  const [overviewShown, setOverviewShown] = useState(() => { try { return localStorage.getItem("noa-overview-shown") !== "false" } catch { return true } })
  useEffect(() => { try { localStorage.setItem("noa-overview-shown", String(overviewShown)) } catch { /* Ignore unavailable storage. */ } }, [overviewShown])
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

  const { state, sendMessage, reloadCommands, loadEarlier, interrupt, answerPermission, answerElicitation, removeQueued, moveQueued, updateQueued, steerQueued, setQueuePaused, runQueued, stopTask, setModel, setPermissionMode, setEffort, refreshContext, refreshMcp, turnDiffAction, clearDiffAction, startAuthentication, waitForAuthentication, submitAuthenticationCode, closeAuthentication } =
    useAgent({
      cwd: session.cwd,
      resume: session.resume,
      sessionKey: session.key,
      runtimeId: session.runtimeId,
      defaultPermissionMode: settings.agent.defaultPermissionMode,
    })

  useEffect(() => {
    fetchProjects().then(setProjects)
  }, [])

  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      try {
        const runsResponse = await fetch("/api/runs")
        const runs = await runsResponse.json() as { cwd: string; sessionId?: string; title?: string; busy: boolean; waiting: boolean; queued: number }[]
        const entries = await Promise.all(projects.map(async (p) => {
          const sessions = await fetchSessions(p.path)
          for (const run of runs.filter((r) => r.cwd === p.path && r.sessionId)) {
            let summary = sessions.find((s) => s.id === run.sessionId)
            if (!summary) { summary = { id: run.sessionId!, title: run.title ?? "New task", updatedAt: Date.now() }; sessions.unshift(summary) }
            summary.status = run.waiting ? "waiting" : run.busy ? "running" : run.queued ? "queued" : undefined
          }
          return [p.path, sessions] as const
        }))
        if (!cancelled) setSessionsByProject(Object.fromEntries(entries))
      } catch {}
    }
    void refresh()
    return () => {
      cancelled = true
    }
  }, [projects, refreshTick])

  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      try {
        const runs = await (await fetch("/api/runs")).json() as { cwd: string; sessionId?: string; title?: string; busy: boolean; waiting: boolean; queued: number }[]
        if (cancelled) return
        setSessionsByProject((current) => {
          const next = { ...current }
          for (const project of projects) {
            const sessions = current[project.path] ?? []
            const updated: SessionSummary[] = sessions.map((session) => {
              const run = runs.find((candidate) => candidate.cwd === project.path && candidate.sessionId === session.id)
              return {
                ...session,
                status: run?.waiting ? "waiting" : run?.busy ? "running" : run?.queued ? "queued" : undefined,
              }
            })
            for (const run of runs) {
              if (run.cwd !== project.path || !run.sessionId || updated.some((session) => session.id === run.sessionId)) continue
              updated.unshift({
                id: run.sessionId,
                title: run.title ?? "New task",
                updatedAt: Date.now(),
                status: run.waiting ? "waiting" : run.busy ? "running" : run.queued ? "queued" : undefined,
              })
            }
            next[project.path] = updated
          }
          return next
        })
      } catch {}
    }
    void refresh()
    const timer = setInterval(refresh, 2000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [projects])

  // A finished turn may have created or renamed the current session.
  useEffect(() => {
    if (state.result) setRefreshTick((n) => n + 1)
  }, [state.result])

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
  // follow the new turn's live/final diff instead, as Codex's Changes tab does.
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

  const activeId = state.sessionId ?? session.resume
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
      className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-[var(--icon-ink,#52514E)] transition-colors hover:bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_7.5%,transparent)] hover:text-[var(--text-primary,#2D2D2B)]"
      title="Right panel"
      aria-label="Right panel"
      aria-pressed={rightOpen}
    >
      <PanelRight size={16} />
    </button>
  )

  // Back and forward step through the tasks the user has opened, like the browser history Codex shows.
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
    setHistory({ ...history, index })
    setQuote(undefined)
    setReference(undefined)
    setEditDraft(undefined)
    setQueueEditId(undefined)
    setSession((s) => ({ cwd: target.cwd, resume: target.resume, runtimeId: target.runtimeId ?? crypto.randomUUID(), key: s.key + 1 }))
  }
  const newSession = (dir?: string) => {
    setQuote(undefined)
    setReference(undefined)
    setEditDraft(undefined)
    setQueueEditId(undefined)
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
    if (content) sendMessage(content)
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
  const animate = moving ? "" : "transition-[width,--noa-edge-fade] duration-500 ease-in-out"
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
  const toggleOverview = () => {
    if (overviewVisible) {
      setOverviewPopover(null)
      if (overviewDockedVisible) setOverviewShown(false)
      return
    }
    setOverviewShown(true)
    if (!overviewDocked) setOverviewPopover(session.key)
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
      className="noa-app-shell h-screen w-screen flex flex-col bg-[var(--surface-page,#F9F9F7)] text-[var(--text-primary,#2D2D2B)] font-ui overflow-hidden relative selection:bg-[var(--accent-color,#CC7D5E)] selection:text-white"
      style={
        {
          "--noa-sidebar-width": `${sidebar.width}px`,
          "--noa-right-panel-width": `${rightWidth}px`,
        } as React.CSSProperties
      }
    >
      <ThemeInjector settings={settings} />

      {/* The sidebar runs the full height behind the titlebar, as in Noa; the TopBar paints only beside it. */}
      <div
        data-sidebar-container
        inert={!sidebarOpen ? true : undefined}
        className={`noa-edge-fade-right absolute inset-y-0 left-0 z-10 overflow-hidden bg-[var(--bg-sidebar,#FBFBF9)] ${animate}`}
        style={{ width: sidebarWidth, "--noa-edge-fade": sidebarOpen ? "0px" : "28px" } as React.CSSProperties}
      >
        <div
          className="h-full transition-opacity duration-300 ease-out"
          style={{ width: sidebarOpen ? "100%" : sidebarTarget, opacity: sidebarOpen ? 1 : 0 }}
        >
          <Sidebar
            projects={projects}
            sessions={sessionsByProject}
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
      <div
        aria-hidden="true"
        data-sidebar-divider
        className={`pointer-events-none absolute inset-y-0 z-30 w-[0.5px] bg-[var(--divider-subtle,#E6E2DA)] ${moving ? "" : "transition-[left,opacity] duration-500 ease-in-out"}`}
        style={{ left: sidebarWidth, opacity: sidebarOpen ? 1 : 0 }}
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
      <div
        aria-hidden="true"
        data-right-divider
        className={`pointer-events-none absolute inset-y-0 z-30 w-[0.5px] bg-[var(--divider-subtle,#E6E2DA)] ${moving ? "" : "transition-[right,opacity] duration-500 ease-in-out"}`}
        style={{ right: rightWidth, opacity: rightOpen ? 1 : 0 }}
      />
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
        inert={!rightOpen ? true : undefined}
        className={`noa-edge-fade-left absolute inset-y-0 right-0 z-30 overflow-hidden bg-[var(--surface-page,#F9F9F7)] ${animate}`}
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
          className="absolute inset-y-0 right-0 h-full transition-opacity duration-300 ease-out"
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
        settings={settings}
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
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-[var(--icon-ink,#52514E)] transition-colors hover:bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_7.5%,transparent)] hover:text-[var(--text-primary,#2D2D2B)] aria-pressed:bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_7.5%,transparent)]"
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
          {/* With a conversation the composer floats over the list, as Codex's conversation-footer does:
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
                onFiles={() => showWorkspacePane("files")}
                newTask={!hasTurns}
                contextUsage={state.contextUsage}
                connection={state.connection}
                busy={state.busy}
                models={state.models}
                model={state.model}
                mode={state.permissionMode}
                showFullAccess={settings.agent.showFullAccess}
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
            docked={overviewDocked}
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
          settings={settings}
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
