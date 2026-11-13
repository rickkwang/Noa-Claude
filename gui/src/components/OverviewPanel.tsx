import { useEffect, useRef, useState, type ReactNode } from "react"
import { query } from "../api"
import { isSubagentTask, type AgentState, type AgentTask } from "../agent/reducer"
import { ChevronRight, Folder, GitBranch, Plug, PlusMinus, Terminal } from "../lib/icons"
import { ContextUsageCard } from "./ContextUsageCard"
import { SubagentAvatar } from "./SubagentAvatar"

// Overview rail: a stack of collapsible cards (Tasks, Changes, Connectors, Context, Environment, Diagnostics).
const OPEN_KEY = "noa-overview-open"
const DEFAULT_OPEN: Record<string, boolean> = { tasks: true, changes: true, connectors: false, context: true, environment: true, diagnostics: true }

function useCardOpen(id: string): [boolean, () => void] {
  const [open, setOpen] = useState(() => {
    try { const saved = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "{}")[id]; if (typeof saved === "boolean") return saved } catch { /* Ignore unavailable storage. */ }
    return DEFAULT_OPEN[id] ?? true
  })
  const toggle = () => setOpen((value) => {
    try { localStorage.setItem(OPEN_KEY, JSON.stringify({ ...JSON.parse(localStorage.getItem(OPEN_KEY) ?? "{}"), [id]: !value })) } catch { /* Ignore unavailable storage. */ }
    return !value
  })
  return [open, toggle]
}

// Metrics come from Claude's session rail: 12px card padding, a 24px header (12px inset, 8px gap) whose
// trigger is a 13px/500 button, the caret turning in 60ms, a collapsed summary at the right edge, and an
// 80px drag zone at the header's end that shows its grip on hover. Collapsing is instant.
interface CardChrome { dragging: boolean; onGripDown: (event: React.PointerEvent) => void; onGripKey: (direction: -1 | 1) => void; onMenu: (x: number, y: number) => void }
const MUTED = "text-[var(--sidebar-text-muted)]"
function RailCard({ id, title, summary, children, chrome }: { id: string; title: string; summary?: ReactNode; children: ReactNode; chrome?: CardChrome }) {
  const [open, toggle] = useCardOpen(id)
  return <section data-rail-card={id} className="flex flex-col py-1.5 text-body">
    <div className="group/railtop relative flex min-h-7 min-w-0 items-center gap-2 px-1.5">
      <button type="button" aria-expanded={open} onClick={toggle} onContextMenu={(event) => { event.preventDefault(); chrome?.onMenu(event.clientX, event.clientY) }} className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded-md px-2 text-start text-body font-medium text-[var(--text-primary)] hover:text-[var(--text-primary)]">
        <span className="shrink-0">{title}</span>
        <span className={`flex size-4 shrink-0 items-center justify-center ${MUTED}`}><ChevronRight size={12} className={`transition-transform duration-[60ms] ease-out ${open ? "rotate-90" : ""}`} aria-hidden="true" /></span>
        {summary !== undefined && <span className={`ms-auto min-w-0 truncate ps-2 font-normal ${MUTED} ${open ? "invisible" : "group-hover/railtop:opacity-0"}`}>{summary}</span>}
      </button>
      {chrome && <>
        <div aria-hidden="true" onPointerDown={chrome.onGripDown} className="absolute inset-y-0 end-0 w-20 cursor-grab touch-none active:cursor-grabbing" />
        <button type="button" aria-label={`Reorder ${title}`} onKeyDown={(event) => { if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); chrome.onGripKey(event.key === "ArrowUp" ? -1 : 1) } }}
          className={`pointer-events-none absolute inset-y-0 end-0 flex w-20 items-center justify-end pe-2.5 opacity-0 outline-none group-hover/railtop:opacity-100 focus-visible:opacity-100 ${MUTED}`}>
          <span className="grid size-5 grid-cols-2 place-content-center gap-[2px] rounded-lg" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <i key={i} className="block size-[2px] justify-self-center rounded-full bg-current" />)}</span>
        </button>
      </>}
    </div>
    {open && <div className="flex flex-col px-1.5">{children}</div>}
  </section>
}

interface ChangeSummary { isGit: boolean; branch: string; additions: number; deletions: number; files: unknown[] }

// Working-tree totals and branch; polled while the tab is visible, like the Changes tab.
function useChangeSummary(cwd: string, active: boolean, refreshKey: number) {
  const [summary, setSummary] = useState<ChangeSummary>()
  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    const load = () => fetch(`/api/changes${query(cwd)}&scope=all`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : undefined)
      .then((value) => { if (value && !controller.signal.aborted) setSummary(value) })
      .catch(() => {})
    void load()
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load() }, 3000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [cwd, active, refreshKey])
  return summary
}

const CONNECTORS_SHOWN = 3
const stateLabel = (status: string) => status === "failed" ? "Reconnect" : status === "needs-auth" ? "Authenticate" : status === "disabled" || status === "pending" ? "Unavailable" : undefined

function ConnectorsCard({ state, chrome }: { state: AgentState; chrome?: CardChrome }) {
  const [all, setAll] = useState(false)
  const servers = state.mcpServers ?? []
  if (!servers.length) return null
  const reconnect = servers.filter((s) => s.status === "failed" || s.status === "needs-auth").length
  const connected = servers.filter((s) => s.status === "connected").length
  const shown = all ? servers : servers.slice(0, CONNECTORS_SHOWN)
  return <RailCard id="connectors" title="Connectors" chrome={chrome} summary={reconnect > 0 ? `${reconnect} to reconnect` : `${connected} connected`}>
    <div className="flex flex-col">
      {shown.map((server) => {
        const label = stateLabel(server.status)
        return <div key={server.name} className="flex min-h-7 min-w-0 items-center gap-[5px] px-2">
          <Plug size={16} className={`shrink-0 ${MUTED}`} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-[var(--text-primary)]">{server.name}</span>
          {label && <span className={`shrink-0 ${label === "Unavailable" ? MUTED : "text-[#A8741A]"}`}>{label}</span>}
        </div>
      })}
      {servers.length > CONNECTORS_SHOWN && <button type="button" onClick={() => setAll(!all)} className={`min-h-7 px-2 text-start ${MUTED} hover:text-[var(--text-primary)]`}>{all ? "Show less" : `Show ${servers.length - CONNECTORS_SHOWN} more`}</button>}
    </div>
  </RailCard>
}

const TASKS_SHOWN = 5
const live = (task: AgentTask) => task.status === "running" || task.status === "unknown"

// Subagents first, then background processes; working tasks lead each group.
function TasksCard({ tasks, chrome, onOpenTask, onStopTask }: { tasks: AgentTask[]; chrome?: CardChrome; onOpenTask: (id: string) => void; onStopTask: (id: string) => void }) {
  const [all, setAll] = useState(false)
  if (!tasks.length) return null
  const sorted = [...tasks].sort((a, b) => Number(isSubagentTask(b)) - Number(isSubagentTask(a)) || Number(live(b)) - Number(live(a)))
  const working = tasks.filter(live).length
  const summary = [working && `${working} working`, tasks.length - working && `${tasks.length - working} done`].filter(Boolean).join(" · ")
  const shown = all ? sorted : sorted.slice(0, TASKS_SHOWN)
  return <RailCard id="tasks" title="Tasks" chrome={chrome} summary={summary}>
    <div className="flex flex-col">
      {shown.map((task) => {
        const agent = isSubagentTask(task)
        const status = task.status === "unknown" ? "Disconnected" : task.status === "running" ? "Working" : task.status === "completed" ? "Done" : task.status === "failed" ? "Failed" : "Stopped"
        const label = <>
          {agent ? <SubagentAvatar id={task.id} size={16} /> : <Terminal size={16} className={`shrink-0 ${MUTED}`} aria-hidden="true" />}
          <span className={`min-w-0 flex-1 truncate text-[var(--text-primary)] ${task.status === "running" ? "noa-shimmer" : ""}`}>{task.description}</span>
        </>
        return <div key={task.id} data-overview-task={task.id} className="group/task flex min-h-7 min-w-0 items-center gap-[5px] rounded-md px-2 hover:bg-[var(--fill-hover)]" title={task.outputFile ? `Output: ${task.outputFile}` : undefined}>
          {agent ? <button type="button" onClick={() => onOpenTask(task.id)} className="flex min-h-7 min-w-0 flex-1 items-center gap-[5px] text-start">{label}</button> : <span className="flex min-w-0 flex-1 items-center gap-[5px]">{label}</span>}
          {task.status === "running" && !agent && task.id !== task.toolUseId
            ? <button type="button" onClick={() => onStopTask(task.id)} className={`shrink-0 ${MUTED} hover:text-[var(--text-primary)]`}>Stop</button>
            : <span className={`shrink-0 ${MUTED}`}>{status}</span>}
        </div>
      })}
      {sorted.length > TASKS_SHOWN && <button type="button" onClick={() => setAll(!all)} className={`min-h-7 px-2 text-start ${MUTED} hover:text-[var(--text-primary)]`}>{all ? "Show less" : `Show ${sorted.length - TASKS_SHOWN} more`}</button>}
    </div>
  </RailCard>
}

const CARDS = [
  { id: "tasks", title: "Tasks" },
  { id: "connectors", title: "Connectors" },
  { id: "changes", title: "Changes" },
  { id: "context", title: "Context" },
  { id: "environment", title: "Environment" },
  { id: "diagnostics", title: "Diagnostics" },
] as const
type CardId = (typeof CARDS)[number]["id"]
const LAYOUT_KEY = "noa-overview-layout-v2"
interface Layout { order: CardId[]; hidden: CardId[] }
// Diagnostics are raw agent logs, hidden until asked for.
const DEFAULT_LAYOUT: Layout = { order: CARDS.map((card) => card.id), hidden: ["diagnostics"] }
const DRAG_DISTANCE = 6
const SORT_MS = 200

function loadLayout(): Layout {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "null") as Partial<Layout> | null
    const known = new Set<string>(DEFAULT_LAYOUT.order)
    const order = (saved?.order ?? []).filter((id) => known.has(id))
    // Cards added after the layout was saved fall in at their default place and visibility.
    const added = DEFAULT_LAYOUT.order.filter((id) => !order.includes(id))
    for (const id of added) order.splice(Math.min(order.length, DEFAULT_LAYOUT.order.indexOf(id)), 0, id)
    const hidden = [...(saved?.hidden ?? []).filter((id) => known.has(id)), ...added.filter((id) => DEFAULT_LAYOUT.hidden.includes(id))]
    return { order, hidden }
  } catch { return DEFAULT_LAYOUT }
}

interface Drag { id: CardId; dy: number; to: number; from: number; height: number }
// Docked cards sit 10px apart; the popover joins them with dividers.
const DOCK_GAP = 10

// Floating overview, separate from the right column. The layer, panel, fade-in and dismissal follow
// Claude's flat session-rail popover; cards sort by pointer drag (6px to start, 200ms shift) or by the
// grip's arrow keys, and the header's context menu hides cards or resets the layout.
export function OverviewPanel({ state, cwd, open, workspaceRefreshKey, endInset, bottomInset, docked, showDiagnostics, onClose, onRefreshContext, onRefreshMcp, onReference, onOpenChanges, onOpenTask, onStopTask }: {
  state: AgentState; cwd: string; open: boolean; workspaceRefreshKey: number; endInset: number; bottomInset: number; docked: boolean
  // Shows the Diagnostics card even when the layout hides it (/status, the disconnected banner).
  showDiagnostics?: boolean
  onClose: () => void
  onRefreshContext: () => void; onRefreshMcp: () => void; onReference: (path: string) => void; onOpenChanges: () => void
  onOpenTask: (id: string) => void; onStopTask: (id: string) => void
}) {
  useEffect(() => { if (open && state.connection === "ready") { onRefreshContext(); onRefreshMcp() } }, [open, state.connection, onRefreshContext, onRefreshMcp])
  const changes = useChangeSummary(cwd, open, workspaceRefreshKey)
  const [layout, setLayout] = useState(loadLayout)
  const [drag, setDrag] = useState<Drag>()
  const [menu, setMenu] = useState<{ x: number; y: number }>()
  const panelRef = useRef<HTMLElement>(null)
  const cardRefs = useRef(new Map<CardId, HTMLDivElement>())
  const update = (next: Layout) => {
    setLayout(next)
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(next)) } catch { /* Ignore unavailable storage. */ }
  }
  const move = (id: CardId, to: number) => {
    const order = layout.order.filter((card) => card !== id)
    order.splice(Math.max(0, Math.min(order.length, to)), 0, id)
    update({ ...layout, order })
  }
  const visible = layout.order.filter((id) => !layout.hidden.includes(id) || (id === "diagnostics" && showDiagnostics))

  // Outside press or Escape dismisses; the toggle button handles its own press.
  useEffect(() => {
    if (!open || docked) return
    const press = (event: PointerEvent) => {
      const target = event.target as Element | null
      if (panelRef.current?.contains(target) || target?.closest("[data-overview-toggle], [role=menu], [role=dialog]")) return
      onClose()
    }
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || (event.target as Element | null)?.closest?.("[role=dialog]")) return
      if (menu) setMenu(undefined)
      else onClose()
    }
    window.addEventListener("pointerdown", press, true)
    window.addEventListener("keydown", key, true)
    return () => { window.removeEventListener("pointerdown", press, true); window.removeEventListener("keydown", key, true) }
  }, [open, docked, menu, onClose])
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(undefined)
    window.addEventListener("pointerdown", close)
    return () => window.removeEventListener("pointerdown", close)
  }, [menu])

  const startDrag = (id: CardId, event: React.PointerEvent) => {
    if (event.button !== 0) return
    const rects = visible.map((card) => ({ card, rect: cardRefs.current.get(card)?.getBoundingClientRect() }))
    const from = visible.indexOf(id)
    const own = rects[from]?.rect
    if (!own) return
    const startY = event.clientY
    let active = false
    let last: { to: number; from: number } | undefined
    const onMove = (e: PointerEvent) => {
      const dy = e.clientY - startY
      if (!active && Math.abs(dy) < DRAG_DISTANCE) return
      active = true
      const center = own.top + own.height / 2 + dy
      let to = from
      rects.forEach(({ rect }, index) => {
        if (!rect || index === from) return
        const mid = rect.top + rect.height / 2
        if (index > from && center > mid) to = Math.max(to, index)
        if (index < from && center < mid) to = Math.min(to, index)
      })
      last = { to, from }
      setDrag({ id, dy, to, from, height: own.height })
    }
    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
      if (last && last.to !== last.from) {
        // Slots are among visible cards; map the target back onto the full order.
        const target = visible[last.to]
        if (target) move(id, layout.order.indexOf(target))
      }
      setDrag(undefined)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
  }
  const shiftOf = (id: CardId) => {
    if (!drag) return 0
    const index = visible.indexOf(id)
    if (id === drag.id) return drag.dy
    const step = drag.height + (docked ? DOCK_GAP : 0)
    if (drag.to > drag.from && index > drag.from && index <= drag.to) return -step
    if (drag.to < drag.from && index >= drag.to && index < drag.from) return step
    return 0
  }
  if (!open) return null

  const usage = state.contextUsage
  const home = cwd.match(/^\/(?:Users|home)\/[^/]+/)?.[0]
  const shortCwd = home ? `~${cwd.slice(home.length)}` : cwd
  const note = state.contextLoading ? "Refreshing…" : state.contextError ? `Refresh failed: ${state.contextError}` : state.connection === "closed" ? usage ? "Disconnected · showing last measurement" : "Disconnected" : usage ? "" : "Send a message to see context usage."
  const chromeFor = (id: CardId): CardChrome => ({
    dragging: drag?.id === id,
    onGripDown: (event) => startDrag(id, event),
    onGripKey: (direction) => move(id, layout.order.indexOf(id) + direction),
    onMenu: (x, y) => setMenu({ x, y }),
  })
  const iconRow = "flex min-h-7 min-w-0 items-center gap-[5px] px-2"
  const cards: Record<CardId, ReactNode> = {
    tasks: <TasksCard tasks={state.tasks} chrome={chromeFor("tasks")} onOpenTask={onOpenTask} onStopTask={onStopTask} />,
    diagnostics: <RailCard id="diagnostics" title="Diagnostics" chrome={chromeFor("diagnostics")} summary={state.logs.length ? `${state.logs.length} ${state.logs.length === 1 ? "entry" : "entries"}` : undefined}>
      <pre className="noa-activity-log px-2">{state.logs.join("\n") || "No agent diagnostics"}</pre>
    </RailCard>,
    changes: changes?.isGit ? <RailCard id="changes" title="Changes" chrome={chromeFor("changes")} summary={<span><span className="text-[var(--diff-added,#3E8E57)]">+{changes.additions}</span> <span className="text-[var(--diff-removed,#C24444)]">−{changes.deletions}</span></span>}>
      <div className={iconRow}>
        <PlusMinus size={16} className={`shrink-0 ${MUTED}`} aria-hidden="true" />
        {changes.files.length ? <span className="shrink-0 whitespace-nowrap"><span className="text-[var(--diff-added,#3E8E57)]">+{changes.additions}</span> <span className="text-[var(--diff-removed,#C24444)]">−{changes.deletions}</span></span> : <span className={`min-w-0 truncate ${MUTED}`}>Working tree clean</span>}
        <button type="button" onClick={onOpenChanges} className="ms-auto h-6 shrink-0 whitespace-nowrap rounded-lg bg-[var(--fill-hover)] px-2.5 text-[var(--text-primary)] hover:bg-[var(--fill-hover)]">Review changes</button>
      </div>
    </RailCard> : null,
    connectors: <ConnectorsCard state={state} chrome={chromeFor("connectors")} />,
    context: <RailCard id="context" title="Context" chrome={chromeFor("context")} summary={usage ? `${Math.round(usage.percentage)}%` : undefined}>
      {usage ? <ContextUsageCard usage={usage} home={home} onReference={onReference} /> : <p className={`m-0 px-2 ${MUTED}`} role="status">{note}</p>}
      {usage && <div className="flex min-h-7 items-center justify-between gap-2 px-2">
        <p className={`m-0 ${MUTED}`} role={state.contextError ? "alert" : "status"}>{note || (state.contextUpdatedAt ? `Measured ${new Date(state.contextUpdatedAt).toLocaleTimeString()}` : "")}</p>
        <button type="button" className={`-me-1.5 h-6 rounded-md px-1.5 ${MUTED} hover:text-[var(--text-primary)] disabled:opacity-40`} onClick={onRefreshContext} disabled={state.contextLoading || state.connection !== "ready"} aria-label="Refresh context" title="Refresh">Refresh</button>
      </div>}
    </RailCard>,
    environment: <RailCard id="environment" title="Environment" chrome={chromeFor("environment")} summary={changes?.branch || cwd.split("/").filter(Boolean).pop()}>
      <div className={iconRow} title={cwd}>
        <Folder size={16} className={`shrink-0 ${MUTED}`} aria-hidden="true" />
        <span className="shrink-0 text-[var(--text-primary)]">{cwd.split("/").filter(Boolean).pop() ?? "/"}</span>
        <span className={`min-w-0 truncate ${MUTED}`}>· {shortCwd}</span>
      </div>
      {changes?.isGit && changes.branch && <div className={iconRow} title="Current branch">
        <GitBranch size={16} className={`shrink-0 ${MUTED}`} aria-hidden="true" />
        <span className="min-w-0 truncate text-[var(--text-primary)]">{changes.branch}</span>
      </div>}
    </RailCard>,
  }
  const cardClass = (index: number) => docked
    ? "rounded-lg shadow-[0_0_0_1px_var(--border-default)] empty:hidden"
    : `${index > 0 ? "rounded-[10px] border-t border-[var(--divider-subtle)] " : ""}empty:hidden`
  const cardEls = visible.map((id, index) => <div key={id} ref={(node) => { if (node) cardRefs.current.set(id, node); else cardRefs.current.delete(id) }}
    className={cardClass(index)}
    style={{ transform: drag ? `translateY(${shiftOf(id)}px)` : undefined, transition: drag && drag.id !== id ? `transform ${SORT_MS}ms ease` : undefined, zIndex: drag?.id === id ? 1 : undefined, position: drag?.id === id ? "relative" : undefined, background: drag?.id === id ? "var(--surface-page, #F9F9F7)" : undefined }}>
    {cards[id]}
  </div>)
  return <div className={docked ? "noa-overview-dock" : "noa-overview-layer"} style={{ insetInlineEnd: endInset, ...(docked ? {} : { bottom: bottomInset }) }}>
    {docked
      ? <aside ref={panelRef} aria-label="Overview" className="flex flex-col gap-2 p-px font-ui">{cardEls}</aside>
      : <aside ref={panelRef} aria-label="Overview" className="noa-overview font-ui">{cardEls}</aside>}
    {menu && <div role="menu" aria-label="Overview cards" style={{ position: "fixed", left: menu.x, top: menu.y }} onPointerDown={(event) => event.stopPropagation()} className="noa-floating-panel pointer-events-auto z-50 min-w-40 rounded-[var(--menu-popover-radius)] bg-[var(--bg-card)] p-1 font-ui text-body shadow-[var(--menu-shadow)]">
      <div className={`px-2 py-1 ${MUTED}`}>Show</div>
      {CARDS.map((card) => <button key={card.id} type="button" role="menuitemcheckbox" aria-checked={!layout.hidden.includes(card.id)} onClick={() => update({ ...layout, hidden: layout.hidden.includes(card.id) ? layout.hidden.filter((id) => id !== card.id) : [...layout.hidden, card.id] })} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start hover:bg-[var(--fill-hover)]">
        <span className="w-3 text-center">{layout.hidden.includes(card.id) ? "" : "✓"}</span>{card.title}
      </button>)}
      <div className="my-1 h-px bg-[var(--divider-subtle)]" />
      <button type="button" role="menuitem" disabled={layout.hidden.length === 0 && layout.order.every((id, i) => id === DEFAULT_LAYOUT.order[i])} onClick={() => { update(DEFAULT_LAYOUT); setMenu(undefined) }} className="flex w-full items-center rounded-lg px-2 py-1.5 text-start hover:bg-[var(--fill-hover)] disabled:opacity-40">Reset to defaults</button>
    </div>}
  </div>
}
