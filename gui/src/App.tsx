import { ElicitationCard } from "./components/ElicitationCard"
import { useCallback, useEffect, useRef, useState } from "react"
import { useAgent } from "./agent/useAgent"
import type { ImageAttachment, ImageBlock, UserContent } from "./agent/protocol"
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
import { PermissionCard } from "./components/PermissionCard"
import { QueuedMessages } from "./components/QueuedMessages"
import { RightPanel, type PanelTab } from "./components/RightPanel"
import { ResizeHandle } from "./components/ResizeHandle"
import { usePanelWidth } from "./hooks/usePanelWidth"
import { Sidebar } from "./components/Sidebar"
import TopBar from "./components/TopBar"
import ThemeInjector from "./theme/ThemeInjector"
import { defaultSettings } from "./theme/settings"
import { SettingsDialog } from "./components/SettingsDialog"
import { SessionTitle } from "./components/SessionTitle"
import { PanelRight } from "./lib/icons"

// Noa's default layout widths.
const SIDEBAR_DEFAULT_WIDTH = 325
const RIGHT_PANEL_DEFAULT_WIDTH = 360

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
      const agent = JSON.parse(localStorage.getItem("noa-agent.agent") ?? "{}")
      return {
        ...defaultSettings,
        appearance: {
          ...defaultSettings.appearance,
          ...appearance,
        },
        agent: { ...defaultSettings.agent, ...agent },
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
      const saved = JSON.parse(sessionStorage.getItem("noa-agent.current") ?? "null")
      if (saved?.cwd && saved?.runtimeId) return { ...saved, key: 0 }
    } catch {}
    return { cwd, runtimeId: crypto.randomUUID(), key: 0 }
  })
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [sessionsByProject, setSessionsByProject] = useState<Record<string, SessionSummary[]>>({})
  const [refreshTick, setRefreshTick] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  const [addingProject, setAddingProject] = useState(false)
  const [reference, setReference] = useState<{ path: string; key: number }>()
  const [editDraft, setEditDraft] = useState<{ text: string; images: ImageAttachment[]; key: number }>()
  const [queueEditId, setQueueEditId] = useState<string>()
  const [changes, setChanges] = useState<{ count: number; additions: number; deletions: number; branch: string; files: { path: string; additions: number; deletions: number; binary: boolean }[] }>()
  const [rightTab, setRightTab] = useState<PanelTab>("files")

  const { state, sendMessage, reloadCommands, interrupt, answerPermission, answerElicitation, removeQueued, moveQueued, updateQueued, steerQueued, setQueuePaused, runQueued, stopTask, setModel, setPermissionMode, setEffort, refreshContext } =
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
    const timer = setInterval(refresh, 2000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [projects, refreshTick])

  // A finished turn may have created or renamed the current session.
  useEffect(() => {
    if (state.result) setRefreshTick((n) => n + 1)
  }, [state.result])

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

  const activeId = state.sessionId ?? session.resume
  useEffect(() => {
    sessionStorage.setItem("noa-agent.current", JSON.stringify({ cwd: session.cwd, resume: activeId, runtimeId: session.runtimeId }))
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
    setReference(undefined)
    setEditDraft(undefined)
    setQueueEditId(undefined)
    setSession((s) => ({ cwd: target.cwd, resume: target.resume, runtimeId: target.runtimeId ?? crypto.randomUUID(), key: s.key + 1 }))
  }
  const newSession = (dir?: string) => {
    setReference(undefined)
    setEditDraft(undefined)
    setQueueEditId(undefined)
    const runtimeId = crypto.randomUUID()
    pushHistory({ cwd: dir ?? session.cwd, runtimeId })
    setSession((s) => ({ cwd: dir ?? s.cwd, resume: undefined, runtimeId, key: s.key + 1 }))
  }
  const selectSession = (dir: string, id: string) => {
    if (dir === session.cwd && id === activeId) return
    setReference(undefined)
    setEditDraft(undefined)
    setQueueEditId(undefined)
    const runtimeId = crypto.randomUUID()
    pushHistory({ cwd: dir, resume: id, runtimeId })
    setSession((s) => ({ cwd: dir, resume: id, runtimeId, key: s.key + 1 }))
  }
  const [focusChange, setFocusChange] = useState<{ path: string; at: number }>()
  const showWorkspacePane = (tab: "files" | "changes", path?: string) => {
    setRightOpen(true)
    setRightTab(tab)
    if (path) setFocusChange({ path, at: Date.now() })
  }

  async function addProjectPath(path: string) {
    setProjects(await addProject(path))
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
  const sidebar = usePanelWidth("noa-agent.sidebarWidth", SIDEBAR_DEFAULT_WIDTH, 220)
  const right = usePanelWidth("noa-agent.rightPanelWidth", RIGHT_PANEL_DEFAULT_WIDTH)
  // Dragging follows the pointer, so the column's width transition is off while a handle is held.
  const [resizing, setResizing] = useState(false)
  const animate = resizing ? "" : "transition-[width,--noa-edge-fade] duration-500 ease-in-out"
  const [windowWidth, setWindowWidth] = useState(window.innerWidth)
  useEffect(() => {
    const resize = () => setWindowWidth(window.innerWidth)
    window.addEventListener("resize", resize)
    return () => window.removeEventListener("resize", resize)
  }, [])
  // Each pane keeps its open width while it slides in or out: the outer edge animates and covers the content,
  // which never reflows. The main column does not move; the panes overlay it.
  const sidebarTarget = Math.round(Math.min(sidebar.width, Math.max(220, windowWidth - 480 - (rightOpen ? 250 : 0))))
  const rightTarget = Math.round(Math.min(right.width, Math.max(250, windowWidth - sidebarTarget - 480)))
  const sidebarWidth = sidebarOpen ? sidebarTarget : 0
  const rightWidth = rightOpen ? rightTarget : 0

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
          style={{ width: sidebarTarget, opacity: sidebarOpen ? 1 : 0 }}
        >
          <Sidebar
            projects={projects}
            sessions={sessionsByProject}
            active={{ cwd: session.cwd, id: activeId }}
            onNewSession={newSession}
            onSelect={selectSession}
            onAddProject={() => setAddingProject(true)}
            onRemoveProject={removeProjectPath}
            onRevealProject={revealProject}
            onSettings={() => setSettingsOpen(true)}
          />
        </div>
      </div>
      <div
        aria-hidden="true"
        data-sidebar-divider
        className={`pointer-events-none absolute inset-y-0 z-30 w-[0.5px] bg-[var(--divider-subtle,#E6E2DA)] ${resizing ? "" : "transition-[left,opacity] duration-500 ease-in-out"}`}
        style={{ left: sidebarWidth, opacity: sidebarOpen ? 1 : 0 }}
      />
      {/* One titlebar rule across both columns; above the right panel so it is not hidden behind it. */}
      <div
        aria-hidden="true"
        data-titlebar-divider
        className={`pointer-events-none absolute z-40 h-[0.5px] bg-[var(--divider-subtle,#E6E2DA)] ${resizing ? "" : "transition-[left] duration-500 ease-in-out"}`}
        style={{ top: 43.5, left: sidebarWidth, right: 0 }}
      />
      {rightOpen && (
        <ResizeHandle
          label="Resize right panel"
          grow={-1}
          width={rightWidth}
          defaultWidth={RIGHT_PANEL_DEFAULT_WIDTH}
          onResize={right.set}
          onDraggingChange={setResizing}
          style={{ right: rightWidth - 4, zIndex: 40 }}
        />
      )}
      <div
        aria-hidden="true"
        data-right-divider
        className={`pointer-events-none absolute inset-y-0 z-30 w-[0.5px] bg-[var(--divider-subtle,#E6E2DA)] ${resizing ? "" : "transition-[right,opacity] duration-500 ease-in-out"}`}
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
          style={{ width: rightTarget, opacity: rightOpen ? 1 : 0 }}
        >
          <RightPanel
            state={state}
            onStopTask={stopTask}
            cwd={session.cwd}
            sessionId={activeId}
            onRefreshContext={refreshContext}
            tab={rightTab}
            onTab={setRightTab}
            onReference={(path) => setReference({ path, key: Date.now() })}
            onWorkspaceChange={() => setRefreshTick((n) => n + 1)}
            focusChange={focusChange}
          />
        </div>
      </div>

      <TopBar
        settings={settings}
        resizing={resizing}
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
        {panelToggle}
      </div>

      <div className="flex-1 flex min-h-0 overflow-visible relative">
        <div
          className={`relative flex min-w-0 flex-1 flex-col ${resizing ? "" : "transition-[margin-left,margin-right] duration-500 ease-in-out"}`}
          style={{ marginLeft: sidebarWidth, marginRight: rightWidth, "--composer-overlay": `${footerHeight}px` } as React.CSSProperties}
        >
          {hasTurns ? (
            <MessageList
              key={session.key}
              turns={state.turns}
              busy={state.busy}
              result={state.result}
              readingWidth={readingWidth}
              changes={changes}
              onChanges={(path) => showWorkspacePane("changes", path)}
              onRetry={retryLast}
              onEdit={editMessage}
              tasks={state.tasks}
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
              {(state.connection === "closed" || state.status === "compacting") && (
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
                </div>
              )}
              {state.permissions.length > 0 && (
                <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto p-px">
                  {state.permissions.map((permission) => (
                    <PermissionCard key={permission.requestId} permission={permission} onAnswer={answerPermission} />
                  ))}
                </div>
              )}
              {state.elicitations.map((request) => <ElicitationCard key={request.requestId} request={request} onAnswer={answerElicitation} />)}
              {state.queue.length > 0 && (
                <QueuedMessages
                  messages={state.queue}
                  busy={state.busy}
                  paused={state.queuePaused}
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
              {state.notice && <p role="status" className="m-0 px-1 text-caption text-[var(--sidebar-text-muted)]">{state.notice}</p>}
              {state.error && (
                <p role="alert" className="m-0 break-words px-1 text-caption text-[#C24444]">
                  {state.error}
                </p>
              )}
              <Composer
                key={session.key}
                draftKey={`noa-agent.draft:${session.cwd}:${activeId ?? session.runtimeId}`}
                reference={reference}
                editDraft={editDraft ? { ...editDraft, label: queueEditId ? "Edit queued message" : "Edit and resend" } : undefined}
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
                contextPercent={state.contextUsage?.percentage}
                disabled={state.connection !== "ready"}
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
                  else if (action === "context") { setRightOpen(true); setRightTab("context"); refreshContext() }
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
        </div>
      </div>

      {addingProject && <AddProjectDialog onAdd={addProjectPath} onClose={() => setAddingProject(false)} />}
      {settingsOpen && (
        <SettingsDialog settings={settings} onChange={setSettings} onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  )
}
