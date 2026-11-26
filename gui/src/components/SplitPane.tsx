import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react"
import { useAgent } from "../agent/useAgent"
import { isSubagentTask } from "../agent/reducer"
import type { TurnDiff, UserContent } from "../agent/protocol"
import type { ProjectInfo, SessionSummary } from "../api"
import { useEvent } from "../hooks/useEvent"
import { openBrowser, projectBrowser } from "../lib/browserTabs"
import { ListDetails, SidebarClosed, SidebarOpen, X } from "../lib/icons"
import { PANE_CHAT_OVERFLOW_MIN, PANE_LEFT_PEEK_MIN, PANE_RIGHT_MIN, loadPaneSideState, paneRightWidth, savePaneSideState } from "../lib/panePrefs"
import { matchesShortcut } from "../lib/shortcuts"
import { abandonSideChat, askSideChat, pumpSideChat } from "../lib/sideChat"
import { openTerminal, terminalTabs } from "../lib/terminalSessions"
import type { AppSettings } from "../types"
import { Composer } from "./Composer"
import { ElicitationCard } from "./ElicitationCard"
import { MessageList } from "./MessageList"
import { OverviewPanel } from "./OverviewPanel"
import { PermissionCard } from "./PermissionCard"
import { QueuedMessages } from "./QueuedMessages"
import { ResizeHandle } from "./ResizeHandle"
import { RightPanel, type PanelTab, type RightTab } from "./RightPanel"
import { SessionTitle } from "./SessionTitle"
import { TERMINAL_PANEL_DEFAULT_HEIGHT, TerminalPanel } from "./TerminalPanel"

const dragRegion = { WebkitAppRegion: "drag" } as CSSProperties
const noDragRegion = { WebkitAppRegion: "no-drag" } as CSSProperties
const noop = () => {}

// A task opened beside the main one in split view: its own connection, conversation, composer,
// overview, terminal, and independent right sidebar.
export function SplitPane({
  cwd,
  id,
  title,
  titlebar,
  focused,
  settings,
  projects,
  sessions,
  onSelectSession,
  onRename,
  onClose,
  onGripPointerDown,
}: {
  cwd: string
  id: string
  title?: string
  titlebar: boolean
  focused: boolean
  settings: AppSettings
  projects: ProjectInfo[]
  sessions: SessionSummary[]
  onSelectSession: (id: string) => void
  onRename?: (name: string) => Promise<void>
  onClose: () => void
  onGripPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
}) {
  const [runtimeId] = useState(() => crypto.randomUUID())
  const {
    state,
    request,
    sendMessage,
    interrupt,
    answerPermission,
    answerElicitation,
    loadEarlier,
    setModel,
    setPermissionMode,
    setEffort,
    reloadCommands,
    removeQueued,
    moveQueued,
    steerQueued,
    setQueuePaused,
    runQueued,
    stopTask,
    refreshContext,
    refreshMcp,
  } = useAgent({
    cwd,
    resume: id,
    sessionKey: 0,
    runtimeId,
    persistPreview: false,
    defaultPermissionMode: settings.agent.permissionDefault === "inherit" ? undefined : settings.agent.permissionDefault,
    defaultOutputStyle: settings.agent.outputStyle,
  })

  // Per-session right sidebar state (open, width share, tabs, active tab).
  const [sideState, setSideState] = useState(() => loadPaneSideState(id, false))
  useEffect(() => savePaneSideState(id, sideState), [id, sideState])
  // Mount the right panel lazily on first open, then keep it mounted so toggling avoids re-fetching and layout jitter.
  const [rightMounted, setRightMounted] = useState(() => sideState.open)
  useEffect(() => {
    if (sideState.open && !rightMounted) setRightMounted(true)
  }, [sideState.open, rightMounted])
  const [rightNewTab, setRightNewTab] = useState(false)
  const [rightResizing, setRightResizing] = useState(false)
  const [rightTerminalFocus, setRightTerminalFocus] = useState(0)
  const [sideChatFocus, setSideChatFocus] = useState(0)
  const [refreshTick, setRefreshTick] = useState(0)
  const [focusChange, setFocusChange] = useState<{ path: string; at: number }>()
  const [focusFile, setFocusFile] = useState<{ path: string; at: number; line?: number; endLine?: number }>()
  const [focusTask, setFocusTask] = useState<{ id?: string; key: number }>()
  const [turnDiff, setTurnDiff] = useState<{ diff: TurnDiff; path?: string; key: number }>()
  const [reference, setReference] = useState<{ path: string; key: number }>()
  const [quote, setQuote] = useState<{ text: string; key: number }>()

  const setRightOpen = (open: boolean | ((current: boolean) => boolean)) =>
    setSideState((prev) => ({ ...prev, open: typeof open === "function" ? open(prev.open) : open }))
  const setRightTabs = (tabs: PanelTab[]) =>
    setSideState((prev) => ({ ...prev, tabs }))
  const setRightTab = (tab: RightTab) =>
    setSideState((prev) => ({
      ...prev,
      tabs: tab !== "new" && tab !== "terminal" && tab !== "browser" && !prev.tabs.includes(tab) ? [...prev.tabs, tab] : prev.tabs,
      tab,
    }))
  const showPanelTool = (tool: "changes" | "files" | "browser" | "sidechat") => {
    setRightNewTab(false)
    setSideState((prev) => ({
      ...prev,
      open: true,
      tabs: tool !== "browser" && !prev.tabs.includes(tool) ? [...prev.tabs, tool] : prev.tabs,
      tab: tool,
    }))
  }

  // Per-pane bottom terminal.
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [terminalHeight, setTerminalHeight] = useState(TERMINAL_PANEL_DEFAULT_HEIGHT)
  const [terminalFocus, setTerminalFocus] = useState(0)
  const showBottomTerminal = () => {
    setTerminalOpen(true)
    setTerminalFocus((n) => n + 1)
  }

  // Per-pane overview panel (docks when chat column >= 611px, otherwise floats as a popover).
  const [overviewShown, setOverviewShown] = useState(false)
  const [overviewPopover, setOverviewPopover] = useState(false)
  const [showDiagnostics, setShowDiagnostics] = useState(false)

  // Measure pane width (for right sidebar sizing) and chat column docking threshold without re-rendering every drag pixel.
  const paneRef = useRef<HTMLDivElement>(null)
  const chatRef = useRef<HTMLDivElement>(null)
  const [paneWidth, setPaneWidth] = useState(0)
  const [chatWide, setChatWide] = useState(false)
  const [chatHeight, setChatHeight] = useState(0)
  const sideOpenRef = useRef(sideState.open)
  sideOpenRef.current = sideState.open
  const terminalOpenRef = useRef(terminalOpen)
  terminalOpenRef.current = terminalOpen
  useEffect(() => {
    const pane = paneRef.current
    const chat = chatRef.current
    let frame = 0
    const sync = () => {
      frame = 0
      if (pane && sideOpenRef.current) {
        const w = pane.offsetWidth
        setPaneWidth((cur) => (cur === w ? cur : w))
      }
      if (chat) {
        const wide = chat.offsetWidth >= 611
        setChatWide((cur) => (cur === wide ? cur : wide))
        if (terminalOpenRef.current) {
          const h = chat.offsetHeight
          setChatHeight((cur) => (cur === h ? cur : h))
        }
      }
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(sync)
    }
    sync()
    const observer = new ResizeObserver(schedule)
    if (pane) observer.observe(pane)
    if (chat) observer.observe(chat)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [sideState.open, terminalOpen])

  const rightMetrics = paneRightWidth(paneWidth, sideState.widthRatio)
  // Delay the loading shimmer so fast cached/local history loads never flash placeholder bars.
  const [showSkeleton, setShowSkeleton] = useState(false)
  useEffect(() => {
    if (state.turns.length > 0 || state.connection !== "connecting") {
      setShowSkeleton(false)
      return
    }
    const timer = setTimeout(() => setShowSkeleton(true), 220)
    return () => clearTimeout(timer)
  }, [state.turns.length, state.connection])
  const rightWidth = sideState.open && paneWidth > 0 ? rightMetrics.width : 0
  const overviewDocked = chatWide
  const overviewDockedVisible = overviewShown && overviewDocked
  const overviewVisible = overviewDockedVisible || (overviewPopover && !overviewDockedVisible)
  useEffect(() => {
    if (!overviewVisible) setShowDiagnostics(false)
  }, [overviewVisible])
  useEffect(() => {
    if (overviewShown && !overviewDocked) {
      setOverviewShown(false)
      setOverviewPopover(true)
    }
  }, [overviewShown, overviewDocked])
  useEffect(() => {
    if (overviewPopover && overviewDocked) {
      setOverviewPopover(false)
      setOverviewShown(true)
    }
  }, [overviewPopover, overviewDocked])
  const toggleOverview = () => {
    if (overviewVisible) {
      setOverviewPopover(false)
      if (overviewDockedVisible) setOverviewShown(false)
      return
    }
    if (overviewDocked) setOverviewShown(true)
    else setOverviewPopover(true)
  }

  // Side chat synchronization for this session.
  const sideChatReady = state.connection === "ready"
  useEffect(() => {
    if (sideChatReady) pumpSideChat(id, request)
  }, [sideChatReady, id])
  useEffect(() => () => abandonSideChat(id), [id])

  // Follow live/current turn diff when Changes tab is open.
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
    if (!sideState.open || sideState.tab !== "changes") return
    const diff = state.liveDiff ?? currentTurnDiff
    if (!diff) return
    setTurnDiff((current) => {
      if (!diff.files.length) return current?.diff.turnIndex === diff.turnIndex ? undefined : current
      if (current && current.diff.turnIndex !== undefined && current.diff.turnIndex !== diff.turnIndex) return current
      const key = current && current.diff.turnIndex === diff.turnIndex ? current.key : Date.now()
      return { diff, path: current?.path, key }
    })
  }, [state.liveDiff, currentTurnDiff, sideState.open, sideState.tab])

  // Handle pane-scoped keyboard shortcuts when this pane is focused.
  useEffect(() => {
    if (!focused) return
    const onKey = (e: KeyboardEvent) => {
      const bindings = settings.shortcuts
      if (matchesShortcut(e, bindings.bottomPanel)) {
        e.preventDefault()
        setTerminalOpen((open) => !open)
      } else if (matchesShortcut(e, bindings.terminal)) {
        e.preventDefault()
        if (settings.terminal.defaultLocation === "right") {
          if (terminalTabs(cwd, "right").ids.length === 0) openTerminal(cwd, "right")
          setRightOpen(true)
          setRightTab("terminal")
          setRightTerminalFocus((n) => n + 1)
        } else {
          showBottomTerminal()
        }
      } else if (matchesShortcut(e, bindings.changes)) {
        e.preventDefault()
        showPanelTool("changes")
      } else if (matchesShortcut(e, bindings.files)) {
        e.preventDefault()
        showPanelTool("files")
      } else if (matchesShortcut(e, bindings.browser) && window.noaDesktop?.preview) {
        e.preventDefault()
        if (projectBrowser(cwd).tabs.length === 0) openBrowser(cwd)
        showPanelTool("browser")
      } else if (matchesShortcut(e, bindings.sideChat)) {
        e.preventDefault()
        showPanelTool("sidechat")
        setSideChatFocus((n) => n + 1)
      } else if (
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
  }, [focused, cwd, state.busy, settings.shortcuts, settings.terminal.defaultLocation])

  const openFile = (path: string, line?: number, endLine?: number) => {
    setFocusFile({ path, at: Date.now(), line, endLine })
    showPanelTool("files")
  }
  const openTurnDiff = (diff: TurnDiff, path?: string) => {
    setTurnDiff({ diff, path, key: Date.now() })
    showPanelTool("changes")
  }
  const openTask = (taskId?: string) => {
    const task = taskId ? state.tasks.find((item) => item.id === taskId) : undefined
    if (task && !isSubagentTask(task)) {
      if (!overviewVisible) toggleOverview()
      return
    }
    setRightNewTab(false)
    setRightOpen(true)
    setRightTab("subagents")
    setFocusTask({ id: taskId, key: Date.now() })
  }

  const drafts = useRef(new Map<string, unknown>())
  const footerRef = useRef<HTMLDivElement>(null)
  const [footerHeight, setFooterHeight] = useState(0)
  useEffect(() => {
    const el = footerRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setFooterHeight(el.offsetHeight))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const onSend = useEvent((content: UserContent) =>
    sendMessage(content, state.busy && settings.composer.followUpMode === "steer" ? "steer" : undefined),
  )
  const onCommand = useEvent((action: string, value?: string) => {
    if (action === "stop") interrupt()
    else if (action === "plan") setPermissionMode("plan")
    else if (action === "reload") reloadCommands()
    else if (action === "context") {
      if (!overviewVisible) toggleOverview()
      refreshContext()
    } else if (action === "activity") {
      if (!overviewVisible) toggleOverview()
      setShowDiagnostics(true)
    } else if (action === "btw") {
      showPanelTool("sidechat")
      setSideChatFocus((n) => n + 1)
      if (value) askSideChat(id, value, sideChatReady ? request : undefined)
    }
  })

  const name =
    title ??
    state.turns
      .find((turn) => turn.role === "user")
      ?.text?.replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) ??
    "Task"
  const button =
    "flex size-6 shrink-0 items-center justify-center rounded-md text-[var(--icon-ink,#52514E)] transition-colors hover:bg-[var(--fill-hover)] hover:text-[var(--text-primary,#2D2D2B)] aria-pressed:bg-[var(--fill-active)]"

  return (
    <div ref={paneRef} role="group" aria-label={name} data-split-pane="" className="relative flex h-full min-h-0 min-w-0">
      {/* Centered top drag grip for moving or swapping this pane. */}
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        title="Drag to move pane"
        className="noa-pane-grip"
        style={noDragRegion}
        onPointerDown={onGripPointerDown}
        onMouseDown={(e) => e.preventDefault()}
      />

      {/* Chat + bottom terminal column: clipped on the right when narrower than 320px so the right sidebar masks it instead of squeezing content. */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className={`relative flex shrink-0 items-center gap-1 pl-3 pr-2 ${titlebar ? "h-11" : "h-9"}`} style={titlebar ? dragRegion : undefined}>
          <div className="flex min-w-0 flex-1 items-center">
            <div className="flex min-w-0 max-w-full items-center" style={noDragRegion}>
              <SessionTitle title={name} onRename={!state.busy ? onRename : undefined} />
            </div>
          </div>
          <div className="noa-pane-actions flex shrink-0 items-center gap-0.5" style={noDragRegion}>
            <button
              type="button"
              className={button}
              onClick={toggleOverview}
              title="Overview"
              aria-label="Overview"
              data-overview-toggle=""
              aria-pressed={overviewVisible}
            >
              <ListDetails size={16} />
            </button>
            {!sideState.open && (
              <>
                <button
                  type="button"
                  className={button}
                  onClick={() => setRightOpen(true)}
                  title="Right panel"
                  aria-label="Right panel"
                  data-right-panel-toggle=""
                  aria-pressed={false}
                >
                  <SidebarClosed size={16} style={{ transform: "scaleX(-1)" }} />
                </button>
                <button type="button" className={button} onClick={onClose} title="Close pane" aria-label="Close pane">
                  <X size={15} />
                </button>
              </>
            )}
          </div>
        </div>

        <div className="relative flex min-h-0 flex-1 flex-col" style={{ minWidth: PANE_CHAT_OVERFLOW_MIN }}>
        <div
          ref={chatRef}
          className="relative flex min-h-0 flex-1 flex-col"
          style={{ "--composer-overlay": `${footerHeight}px` } as CSSProperties}
        >
          {state.turns.length > 0 ? (
            <MessageList
              turns={state.turns}
              cwd={cwd}
              sessionId={id}
              busy={state.busy}
              result={state.result}
              readingWidth={settings.appearance.maxWidth}
              tasks={state.tasks}
              onStopTask={stopTask}
              onOpenFile={openFile}
              liveDiff={state.liveDiff}
              onTurnDiff={openTurnDiff}
              onOpenTask={openTask}
              onQuote={(text) => setQuote({ text, key: Date.now() })}
              historyBefore={state.historyBefore}
              historyLoading={state.historyLoading}
              onLoadEarlier={loadEarlier}
              transcriptView={settings.appearance.transcriptView}
            />
          ) : showSkeleton ? (
            <div className="flex flex-1 flex-col gap-3 px-6 pt-6" aria-busy="true" aria-label="Loading conversation">
              <div className="h-3.5 w-2/5 animate-pulse rounded bg-[var(--fill-hover)]" />
              <div className="h-3.5 w-3/4 animate-pulse rounded bg-[var(--fill-hover)]" />
              <div className="h-3.5 w-3/5 animate-pulse rounded bg-[var(--fill-hover)]" />
            </div>
          ) : (
            <div className="flex-1" />
          )}

          <div ref={footerRef} className="noa-conversation-footer">
            <div className="noa-conversation-column noa-composer-column flex flex-col gap-2" style={{ maxWidth: settings.appearance.maxWidth }}>
              {(state.permissions.length > 0 || state.elicitations.length > 0) && (
                <div className="flex min-h-0 max-h-[50vh] flex-col gap-2 overflow-y-auto p-px">
                  {state.permissions.map((permission) => (
                    <PermissionCard
                      key={permission.requestId}
                      permission={permission}
                      onAnswer={answerPermission}
                      draft={drafts.current.get(permission.requestId) as never}
                      onDraftChange={(draft) => drafts.current.set(permission.requestId, draft)}
                    />
                  ))}
                  {state.elicitations.map((req) => (
                    <ElicitationCard
                      key={req.requestId}
                      request={req}
                      onAnswer={answerElicitation}
                      draft={drafts.current.get(req.requestId) as never}
                      onDraftChange={(draft) => drafts.current.set(req.requestId, draft)}
                    />
                  ))}
                </div>
              )}
              {state.queue.length > 0 && (
                <QueuedMessages
                  messages={state.queue}
                  busy={state.busy}
                  paused={state.queuePaused}
                  editing={false}
                  onMove={moveQueued}
                  onRemove={removeQueued}
                  onEdit={noop}
                  onSteer={steerQueued}
                  onRetry={(queuedId) => {
                    moveQueued(queuedId, 0)
                    setQueuePaused(false)
                    runQueued()
                  }}
                  onRun={runQueued}
                  onPaused={setQueuePaused}
                />
              )}
              {state.error && !state.turns.some((turn) => turn.role === "assistant" && turn.error === state.error) && (
                <p role="alert" className="m-0 break-words px-1 text-caption text-[#C24444]">
                  {state.error}
                </p>
              )}
              <Composer
                draftKey={`noa-agent.draft:${cwd}:${id}`}
                effort={state.effort}
                onEffort={setEffort}
                cwd={cwd}
                projects={projects}
                onProject={noop}
                onBranchChange={() => setRefreshTick((n) => n + 1)}
                onWorktree={async () => {}}
                newTask={false}
                quote={quote}
                onQuoteConsumed={() => setQuote(undefined)}
                reference={reference}
                contextUsage={settings.composer.showContextUsage ? state.contextUsage : undefined}
                sendShortcut={settings.composer.sendShortcut}
                followUpMode={settings.composer.followUpMode}
                showFullAccess={settings.composer.showFullAccess}
                systemCaret={settings.composer.systemCaret}
                mascot={settings.composer.mascot}
                connection={state.connection}
                readOnly={!!state.external}
                busy={state.busy}
                models={state.models}
                model={state.model}
                mode={state.permissionMode}
                commands={state.commands}
                onSend={onSend}
                onCommand={onCommand}
                onInterrupt={interrupt}
                onModel={setModel}
                onMode={setPermissionMode}
              />
            </div>
          </div>

          <OverviewPanel
            state={state}
            cwd={cwd}
            open={overviewVisible}
            workspaceRefreshKey={refreshTick}
            endInset={8}
            bottomInset={Math.max(0, footerHeight - 32)}
            docked={overviewDockedVisible}
            onClose={() => setOverviewPopover(false)}
            onRefreshContext={refreshContext}
            onRefreshMcp={refreshMcp}
            onReference={(path) => setReference({ path, key: Date.now() })}
            onOpenChanges={() => showPanelTool("changes")}
            showDiagnostics={showDiagnostics}
            onOpenTask={openTask}
            onStopTask={stopTask}
          />
        </div>

        <TerminalPanel
          cwd={cwd}
          open={terminalOpen}
          height={terminalHeight}
          available={chatHeight || window.innerHeight}
          styleKey={JSON.stringify(settings.appearance)}
          focusKey={terminalFocus}
          onHeight={setTerminalHeight}
          onHide={() => setTerminalOpen(false)}
          onDraggingChange={setRightResizing}
          onMovedToRight={() => {
            setRightOpen(true)
            setRightTab("terminal")
            setRightTerminalFocus((n) => n + 1)
          }}
        />
        </div>
      </div>

      {/* Per-pane independent right sidebar (kept mounted after first open to avoid remount/fetch jitter). */}
      {rightMounted && (
        <div
          data-pane-right-panel=""
          inert={!sideState.open ? true : undefined}
          className={`relative z-20 flex h-full min-h-0 shrink-0 flex-col border-l-[0.5px] border-[var(--divider-subtle,#E6E2DA)] bg-[var(--surface-page,#F9F9F7)] ${sideState.open ? "" : "hidden"}`}
          style={{
            width: `${(sideState.widthRatio * 100).toFixed(2)}%`,
            minWidth: PANE_RIGHT_MIN,
            maxWidth: `calc(100% - ${PANE_LEFT_PEEK_MIN}px)`,
            ...noDragRegion,
          }}
        >
          <ResizeHandle
            label="Resize pane right panel"
            grow={-1}
            width={rightWidth}
            defaultWidth={rightMetrics.defaultWidth}
            onResize={(nextWidth) => {
              if (!paneWidth) return
              const clamped = Math.max(rightMetrics.min, Math.min(rightMetrics.max, nextWidth))
              setSideState((prev) => ({ ...prev, widthRatio: clamped / paneWidth }))
            }}
            onDraggingChange={setRightResizing}
            style={{ top: 44, left: -4, zIndex: 30 }}
          />
          <div className={`flex h-full min-h-0 flex-col ${rightResizing ? "pointer-events-none select-none" : ""}`}>
            <RightPanel
              shortcuts={settings.shortcuts}
              state={state}
              onStopTask={stopTask}
              cwd={cwd}
              open={sideState.open}
              tabs={sideState.tabs}
              onTabs={setRightTabs}
              newTab={rightNewTab}
              onNewTab={setRightNewTab}
              tab={sideState.tab}
              onTab={setRightTab}
              terminalFocusKey={rightTerminalFocus}
              onBottomTerminal={showBottomTerminal}
              onReference={(path) => setReference({ path, key: Date.now() })}
              onWorkspaceChange={() => setRefreshTick((n) => n + 1)}
              workspaceRefreshKey={refreshTick}
              focusChange={focusChange}
              focusFile={focusFile}
              focusTask={focusTask}
              turnDiff={turnDiff}
              sessions={sessions}
              activeSessionId={id}
              sideChat={{ key: id, ready: sideChatReady, draftKey: runtimeId, request, focusKey: sideChatFocus }}
              onSelectSession={onSelectSession}
              compactHeader={!titlebar}
              headerActions={
                <div className="noa-pane-actions ml-1 flex shrink-0 items-center gap-0.5" style={noDragRegion}>
                  <button
                    type="button"
                    className={button}
                    onClick={() => setRightOpen(false)}
                    title="Hide right panel"
                    aria-label="Hide right panel"
                    data-right-panel-toggle=""
                    aria-pressed={true}
                  >
                    <SidebarOpen size={16} style={{ transform: "scaleX(-1)" }} />
                  </button>
                  <button type="button" className={button} onClick={onClose} title="Close pane" aria-label="Close pane">
                    <X size={15} />
                  </button>
                </div>
              }
            />
          </div>
        </div>
      )}
    </div>
  )
}
