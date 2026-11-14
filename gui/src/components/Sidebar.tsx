import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"
import { PopupMenu, anchorBelow, type PopupMenuAnchor } from "./PopupMenu"
import { MarqueeText } from "./MarqueeText"
import { UpdateButton } from "./UpdateButton"
import { useSessionHoverCard } from "./SessionHoverCard"
import { Collapsible } from "./Collapsible"
import type { ProjectInfo, SessionSummary } from "../api"
import {
  ArrowUpDown,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  Pin,
  Search,
  Settings,
  SquarePen,
  Trash2,
} from "../lib/icons"

// Tasks shown per project before "Show more".
const TASK_PREVIEW = 5
// Recents lists every project's tasks in one list, ten at a time.
const RECENTS_PREVIEW = 10

const dragRegion = { WebkitAppRegion: "drag" } as CSSProperties
const noDragRegion = { WebkitAppRegion: "no-drag" } as CSSProperties

// Pins and manual ordering live in the browser: the server keeps producing
// newest-first lists, and the sidebar layers the user's arrangement over them.
type SessionPrefs = {
  pinned: Record<string, Record<string, true>>
  pinnedOrder: string[]
  order: Record<string, string[]>
  // Project paths in the user's drag order.
  projects: string[]
}
const SESSION_PREFS_KEY = "noa-agent.sessionPrefs"

type RecentsSort = "updated" | "created"
type RecentsPrefs = { collapsed: boolean; sort: RecentsSort; project: string | null }
const RECENTS_PREFS_KEY = "noa-agent.recents"

function loadRecentsPrefs(): RecentsPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENTS_PREFS_KEY) ?? "{}") as Partial<RecentsPrefs>
    return {
      collapsed: raw.collapsed === true,
      sort: raw.sort === "created" ? "created" : "updated",
      project: typeof raw.project === "string" ? raw.project : null,
    }
  } catch {
    return { collapsed: false, sort: "updated", project: null }
  }
}

function loadSessionPrefs(): SessionPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(SESSION_PREFS_KEY) ?? "{}") as Partial<SessionPrefs>
    return { pinned: raw.pinned ?? {}, pinnedOrder: raw.pinnedOrder ?? [], order: raw.order ?? {}, projects: raw.projects ?? [] }
  } catch {
    return { pinned: {}, pinnedOrder: [], order: {}, projects: [] }
  }
}

// Stored ids first, in their saved order; sessions the server added since are appended newest-first.
function resolveOrder(prefs: SessionPrefs, path: string, sessions: SessionSummary[]): string[] {
  const ids = sessions.map((session) => session.id)
  const stored = (prefs.order[path] ?? []).filter((id) => ids.includes(id))
  const seen = new Set(stored)
  return [...stored, ...ids.filter((id) => !seen.has(id))]
}

// Same rule for projects: the stored drag order first, projects added since keep the server's order.
function orderedProjects(prefs: SessionPrefs, projects: ProjectInfo[]): ProjectInfo[] {
  const byPath = new Map(projects.map((project) => [project.path, project]))
  const stored = prefs.projects.flatMap((path) => byPath.get(path) ?? [])
  const seen = new Set(stored)
  return [...stored, ...projects.filter((project) => !seen.has(project))]
}

function orderedSessions(prefs: SessionPrefs, path: string, sessions: SessionSummary[]): SessionSummary[] {
  const index = new Map(resolveOrder(prefs, path, sessions).map((id, position) => [id, position]))
  const pinned = prefs.pinned[path] ?? {}
  return [...sessions].sort((a, b) => {
    const group = Number(!pinned[a.id]) - Number(!pinned[b.id])
    return group || (index.get(a.id) ?? 0) - (index.get(b.id) ?? 0)
  })
}

interface ActiveSession {
  cwd: string
  id?: string
}

interface SidebarProps {
  projects: ProjectInfo[]
  // Sessions per project path, newest first.
  sessions: Record<string, SessionSummary[]>
  // Projects whose latest session read succeeded; stale preferences are only pruned after a successful read.
  loadedProjects: ReadonlySet<string>
  active: ActiveSession
  // Without a path the active project is used.
  onNewSession: (cwd?: string) => void
  onSelect: (cwd: string, id: string) => void
  onAddProject: () => void
  onEditProject: (project: ProjectInfo) => void
  onRemoveProject: (path: string) => void
  onRevealProject: (path: string) => void
  onOpenCoordinator: (path: string) => void
  onDeleteSession: (cwd: string, id: string, title: string) => void
  onSearch: () => void
  onSettings: () => void
}

// Noa's sidebar: search, a Projects toolbar, then one collapsible group per project folder.
const isMac = navigator.platform.includes("Mac")

export function Sidebar({
  projects,
  sessions,
  loadedProjects,
  active,
  onNewSession,
  onSelect,
  onAddProject,
  onEditProject,
  onRemoveProject,
  onRevealProject,
  onOpenCoordinator,
  onDeleteSession,
  onSearch,
  onSettings,
}: SidebarProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set())
  const [projectsOpen, setProjectsOpen] = useState(true)
  const [pinsOpen, setPinsOpen] = useState(true)
  const [prefs, setPrefs] = useState<SessionPrefs>(loadSessionPrefs)
  const [recentsPrefs, setRecentsPrefs] = useState<RecentsPrefs>(loadRecentsPrefs)
  const [recentsUnfolded, setRecentsUnfolded] = useState(false)
  const [recentsMenu, setRecentsMenu] = useState<{ anchor: PopupMenuAnchor; trigger: Element }>()
  // A task drag carries its project in `path`; a project drag uses an empty `path` and the project path as `id`.
  const dragRef = useRef<DragStart | undefined>(undefined)
  const suppressClickRef = useRef(false)
  const [dragging, setDragging] = useState<DragState>()
  const [dropTarget, setDropTarget] = useState<{ kind: DragKind; path: string; id: string; edge: "before" | "after" }>()

  useEffect(() => {
    try {
      localStorage.setItem(SESSION_PREFS_KEY, JSON.stringify(prefs))
    } catch {
      // Ordering is a convenience; a full storage quota must not break the sidebar.
    }
  }, [prefs])

  useEffect(() => {
    if (!loadedProjects.size) return
    setPrefs((current) => {
      let changed = false
      const pinned = { ...current.pinned }
      const order = { ...current.order }
      const currentProjects = new Set(projects.map((project) => project.path))
      for (const path of loadedProjects) {
        if (!currentProjects.has(path)) continue
        const ids = new Set((sessions[path] ?? []).map((session) => session.id))
        const currentPinned = current.pinned[path]
        if (currentPinned) {
          const nextPinned = Object.fromEntries(Object.entries(currentPinned).filter(([id]) => ids.has(id)))
          if (Object.keys(nextPinned).length !== Object.keys(currentPinned).length) {
            changed = true
            if (Object.keys(nextPinned).length) pinned[path] = nextPinned
            else delete pinned[path]
          }
        }
        const currentOrder = current.order[path]
        if (currentOrder) {
          const nextOrder = currentOrder.filter((id) => ids.has(id))
          if (nextOrder.length !== currentOrder.length) {
            changed = true
            if (nextOrder.length) order[path] = nextOrder
            else delete order[path]
          }
        }
      }
      return changed ? { ...current, pinned, order, pinnedOrder: current.pinnedOrder.filter(id => Object.values(pinned).some(group => group[id])) } : current
    })
  }, [loadedProjects, projects, sessions])

  useEffect(() => {
    try {
      localStorage.setItem(RECENTS_PREFS_KEY, JSON.stringify(recentsPrefs))
    } catch {
      // A view preference; losing it must not break the sidebar.
    }
  }, [recentsPrefs])

  // A filter on a project that has since been removed falls back to all projects.
  const recentsProject = projects.some((project) => project.path === recentsPrefs.project) ? recentsPrefs.project : null
  const recents = useMemo(() => {
    const key = recentsPrefs.sort === "created" ? "createdAt" : "updatedAt"
    return projects
      .filter((project) => recentsProject === null || project.path === recentsProject)
      .flatMap((project) => (sessions[project.path] ?? []).filter(session => !session.coordinator && !prefs.pinned[project.path]?.[session.id]).map((session) => ({ project, session })))
      .sort((a, b) => b.session[key] - a.session[key])
  }, [projects, sessions, recentsProject, recentsPrefs.sort, prefs.pinned])

  // Drop the global drag cursor if the sidebar unmounts mid-drag.
  useEffect(() => () => document.body.classList.remove("noa-session-dragging"), [])

  const sortedProjects = useMemo(() => orderedProjects(prefs, projects), [prefs, projects])
  const pinnedSessions = useMemo(() => {
    const index = new Map(prefs.pinnedOrder.map((id, position) => [id, position]))
    return sortedProjects.flatMap(project => orderedSessions(prefs, project.path, sessions[project.path] ?? [])
      .filter(session => prefs.pinned[project.path]?.[session.id])
      .map(session => ({ project, session })))
      .sort((a, b) => (index.get(a.session.id) ?? index.size) - (index.get(b.session.id) ?? index.size))
  }, [sortedProjects, sessions, prefs])

  const groups = useMemo(
    () =>
      sortedProjects.map((project) => {
        const all = orderedSessions(prefs, project.path, sessions[project.path] ?? []).filter(session => !prefs.pinned[project.path]?.[session.id])
        return { project, visible: all }
      }),
    [sortedProjects, sessions, prefs],
  )

  const isPinned = (path: string, id: string) => !!prefs.pinned[path]?.[id]

  function saveOrder(path: string, order: string[]) {
    setPrefs((current) => ({ ...current, order: { ...current.order, [path]: order } }))
  }

  function togglePin(path: string, id: string) {
    if (!isPinned(path, id)) {
      setPinsOpen(true)
      requestAnimationFrame(() => document.querySelector(`[aria-label="Pinned"] [data-session-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" }))
    }
    setPrefs((current) => {
      const pinned = { ...current.pinned[path] }
      const pinnedOrder = current.pinnedOrder.filter(key => key !== id)
      if (pinned[id]) delete pinned[id]
      else {
        pinned[id] = true
        pinnedOrder.unshift(id)
      }
      return { ...current, pinned: { ...current.pinned, [path]: pinned }, pinnedOrder }
    })
  }

  function reorder(path: string, fromId: string, toId: string, edge: "before" | "after") {
    if (fromId === toId) return
    const pinned = isPinned(path, fromId)
    const order = pinned ? pinnedSessions.map(({ session }) => session.id) : resolveOrder(prefs, path, sessions[path] ?? [])
    const from = order.indexOf(fromId)
    if (from < 0) return
    order.splice(from, 1)
    const to = order.indexOf(toId)
    if (to < 0) return
    order.splice(edge === "before" ? to : to + 1, 0, fromId)
    if (pinned) setPrefs(current => ({ ...current, pinnedOrder: order }))
    else saveOrder(path, order)
  }

  // Alt+↑/↓ moves a task inside its own block (pinned or recent).
  function moveBy(path: string, id: string, direction: -1 | 1) {
    const group = isPinned(path, id) ? pinnedSessions.map(({ session }) => session)
      : orderedSessions(prefs, path, sessions[path] ?? []).filter(session => !isPinned(path, session.id))
    const position = group.findIndex((session) => session.id === id)
    const target = group[position + direction]
    if (!target) return
    reorder(path, id, target.id, direction < 0 ? "before" : "after")
  }

  function reorderProject(fromPath: string, toPath: string, edge: "before" | "after") {
    if (fromPath === toPath) return
    const order = orderedProjects(prefs, projects).map((project) => project.path)
    order.splice(order.indexOf(fromPath), 1)
    const to = order.indexOf(toPath)
    if (to < 0) return
    order.splice(edge === "before" ? to : to + 1, 0, fromPath)
    setPrefs((current) => ({ ...current, projects: order }))
  }

  // Alt+↑/↓ moves a project one place.
  function moveProjectBy(path: string, direction: -1 | 1) {
    const order = sortedProjects.map((project) => project.path)
    const target = order[order.indexOf(path) + direction]
    if (target) reorderProject(path, target, direction < 0 ? "before" : "after")
  }

  // 4px of travel before a press becomes a drag, so click-to-open stays reliable.
  function startDrag(event: PointerEvent<HTMLElement>, kind: DragKind, path: string, id: string, label: string) {
    if (event.button !== 0 || (event.target as HTMLElement).closest("[data-session-action]")) return
    const rect = event.currentTarget.getBoundingClientRect()
    dragRef.current = {
      kind,
      path,
      id,
      label,
      x: event.clientX,
      y: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      moved: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function findDropSlot(container: HTMLElement | undefined, items: HTMLElement[], x: number, y: number, isStart: (el: HTMLElement) => boolean) {
    if (!container || !items.length) return undefined
    const bounds = container.getBoundingClientRect()
    if (x < bounds.left - 16 || x > bounds.right + 16 || y < bounds.top - 12 || y > bounds.bottom + 12) return undefined
    const index = items.findIndex((item) => {
      const rect = item.getBoundingClientRect()
      return y < rect.top + rect.height / 2
    })
    const targetIndex = index === -1 ? items.length : index
    const startIndex = items.findIndex(isStart)
    if (startIndex !== -1 && (targetIndex === startIndex || targetIndex === startIndex + 1)) return undefined
    return targetIndex < items.length
      ? { item: items[targetIndex]!, edge: "before" as const }
      : { item: items.at(-1)!, edge: "after" as const }
  }

  function findDropTarget(start: DragStart, x: number, y: number) {
    if (start.kind === "project") {
      const container = document.querySelector<HTMLElement>("[data-project-list]") ?? undefined
      const groups = container ? [...container.querySelectorAll<HTMLElement>("[data-project-group]")] : []
      const slot = findDropSlot(container, groups, x, y, (group) => group.dataset.projectGroup === start.id)
      const path = slot?.item.dataset.projectGroup
      return slot && path ? { kind: start.kind, path: "", id: path, edge: slot.edge } : undefined
    }
    const listKey = isPinned(start.path, start.id) ? "pinned" : start.path
    const container = [...document.querySelectorAll<HTMLElement>("[data-session-list]")].find((el) => el.dataset.sessionList === listKey)
    const rows = container ? [...container.querySelectorAll<HTMLElement>("[data-session-id]")] : []
    const slot = findDropSlot(container, rows, x, y, (row) => row.dataset.sessionId === start.id)
    return slot ? { kind: start.kind, path: slot.item.dataset.sessionPath!, id: slot.item.dataset.sessionId!, edge: slot.edge } : undefined
  }

  function moveDrag(event: PointerEvent<HTMLElement>) {
    const start = dragRef.current
    if (!start) return
    if (!start.moved) {
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 4) return
      start.moved = true
      document.body.classList.add("noa-session-dragging")
    }
    // The floating copy keeps the grab point under the pointer.
    setDragging({
      kind: start.kind,
      path: start.path,
      id: start.id,
      label: start.label,
      left: event.clientX - start.offsetX,
      top: event.clientY - start.offsetY,
    })
    setDropTarget(findDropTarget(start, event.clientX, event.clientY))
  }

  function endDrag(event: PointerEvent<HTMLElement>) {
    const start = dragRef.current
    dragRef.current = undefined
    document.body.classList.remove("noa-session-dragging")
    if (!start?.moved) {
      setDropTarget(undefined)
      return
    }
    event.preventDefault()
    event.stopPropagation()
    // The click that follows this pointerup belongs to the drag, not to row selection.
    suppressClickRef.current = true
    setTimeout(() => { suppressClickRef.current = false }, 0)
    const target = dropTarget
    setDragging(undefined)
    setDropTarget(undefined)
    if (!target || target.kind !== start.kind) return
    if (start.kind === "project") reorderProject(start.id, target.id, target.edge)
    else if (target.path === start.path || isPinned(start.path, start.id)) reorder(start.path, start.id, target.id, target.edge)
  }

  function cancelDrag() {
    dragRef.current = undefined
    document.body.classList.remove("noa-session-dragging")
    setDragging(undefined)
    setDropTarget(undefined)
  }

  function selectSession(path: string, id: string) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    onSelect(path, id)
  }

  function toggleUnfolded(path: string) {
    setUnfolded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function toggle(path: string) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  return (
    <div className="noa-sidebar-surface noa-sidebar-fade-scope w-full h-full min-h-0 flex flex-col shrink-0 relative">
      {/* Titlebar band: the traffic lights and sidebar toggle sit over it, so it stays draggable. At 40px the
          Search action sits below the traffic lights, aligned with New task. */}
      <div className="h-10 shrink-0" style={dragRegion} />

      <button
        type="button"
        onClick={onSearch}
        aria-label="Search"
        aria-haspopup="dialog"
        aria-keyshortcuts={isMac ? "Meta+K" : "Control+K"}
        className="noa-sidebar-search noa-sidebar-tree-item noa-sidebar-tree-row noa-sidebar-hover-surface-subtle mx-2 mb-1 flex h-[30px] shrink-0 items-center gap-2 rounded-lg pl-[7px] pr-2 text-body"
      >
        <Search size={14} className="shrink-0" />
        Search
      </button>

      <button
        type="button"
        onClick={() => onNewSession()}
        className="noa-sidebar-tree-item noa-sidebar-tree-row noa-sidebar-hover-surface-subtle mx-2 mb-1 flex h-[30px] shrink-0 items-center gap-2 rounded-lg pl-[7px] pr-2 text-body"
      >
        <SquarePen size={14} className="shrink-0" />
        New task
      </button>

      <div className="noa-sidebar-scroll scrollbar-on-scroll noa-sidebar-scroll-fade group/tree flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        <div className="pb-2">
          {pinnedSessions.length > 0 && (
            <section aria-label="Pinned" className="mb-2">
              <div className="h-[30px] flex items-center pl-[10px] pr-2">
                <button
                  type="button"
                  aria-expanded={pinsOpen}
                  onClick={() => setPinsOpen(open => !open)}
                  className="group flex min-w-0 flex-1 items-center gap-1 pl-[5px] text-chat-sm text-[var(--text-tertiary,#898781)] font-ui"
                >
                  Pinned
                  <ChevronRight size={12} className={`shrink-0 transition-[transform,opacity] duration-300 ease-[cubic-bezier(.19,1,.22,1)] ${pinsOpen ? "rotate-90 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" : ""}`} />
                </button>
              </div>
              <Collapsible open={pinsOpen} duration={300} fade>
              <div data-session-list="pinned" className="flex flex-col gap-px pt-1">
              {pinnedSessions.map(({ project, session }) => (
                <SessionRow
                  key={`${project.path}\0${session.id}`}
                  id={session.id}
                  path={project.path}
                  title={session.title}
                  updatedAt={session.updatedAt}
                  projectName={project.name}
                  worktree={worktreeName(session, project)}
                  status={session.status}
                  active={active.cwd === (session.cwd ?? project.path) && session.id === active.id}
                  pinned
                  dragging={dragging?.kind === "session" && dragging.id === session.id}
                  dropEdge={dropTarget?.kind === "session" && dropTarget.id === session.id ? dropTarget.edge : undefined}
                  onClick={() => selectSession(session.cwd ?? project.path, session.id)}
                  onTogglePin={() => togglePin(project.path, session.id)}
                  onDelete={() => onDeleteSession(session.cwd ?? project.path, session.id, session.title)}
                  onMove={direction => moveBy(project.path, session.id, direction)}
                  onPointerDown={event => startDrag(event, "session", project.path, session.id, session.title)}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={cancelDrag}
                />
              ))}
              </div>
              </Collapsible>
            </section>
          )}
          <div className="group/projects noa-sidebar-toolbar-mask h-[30px] flex items-center pl-[10px] pr-2 gap-0.5 shrink-0 z-10 mb-1 overflow-visible">
            <button
              type="button"
              aria-expanded={projectsOpen}
              onClick={() => setProjectsOpen((open) => !open)}
              className="group flex min-w-0 flex-1 items-center gap-1 pl-[5px] text-chat-sm text-[var(--text-tertiary,#898781)] font-ui"
            >
              Projects
              <ChevronRight
                size={12}
                className={`shrink-0 transition-[transform,opacity] duration-300 ease-[cubic-bezier(.19,1,.22,1)] ${projectsOpen ? "rotate-90 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" : ""}`}
              />
            </button>
            {/* Hidden until the header is hovered or focused. */}
            <span className="flex opacity-0 group-hover/projects:opacity-100 focus-within:opacity-100">
              <IconButton title="Add project folder" label="Add project" onClick={onAddProject}>
                <FolderPlus size={14} />
              </IconButton>
            </span>
          </div>
          {projects.length === 0 && (
            <button
              type="button"
              onClick={onAddProject}
              className="mx-4 mt-2 text-left text-caption text-[var(--accent-color,#CC7D5E)] hover:underline"
            >
              Add a project folder to start
            </button>
          )}
          <Collapsible open={projectsOpen} duration={300} fade>
            <div data-project-list className="flex flex-col gap-px pt-1">
            {groups.map(({ project, visible }) => {
              const isOpen = expanded.has(project.path)
              return (
                <div
                  key={project.path}
                  data-project-group={project.path}
                  className="relative font-ui"
                >
                  {dropTarget?.kind === "project" && dropTarget.id === project.path && (
                    <DropIndicator edge={dropTarget.edge} className="left-2 right-2" />
                  )}
                  <ProjectRow
                    project={project}
                    open={isOpen}
                    dragging={dragging?.kind === "project" && dragging.id === project.path}
                    onToggle={() => toggle(project.path)}
                    onMove={(direction) => moveProjectBy(project.path, direction)}
                    onPointerDown={(event) => startDrag(event, "project", "", project.path, project.name)}
                    onPointerMove={moveDrag}
                    onPointerUp={endDrag}
                    onPointerCancel={cancelDrag}
                    onNewSession={() => onNewSession(project.path)}
                    onEdit={() => onEditProject(project)}
                    onRemove={() => onRemoveProject(project.path)}
                    onReveal={() => onRevealProject(project.path)}
                    onOpenCoordinator={() => onOpenCoordinator(project.path)}
                  />
                  <Collapsible open={isOpen} duration={300} fade>
                    <div data-session-list={project.path} className="flex flex-col gap-px pb-2 pt-1">
                      {(unfolded.has(project.path) ? visible : visible.slice(0, TASK_PREVIEW)).map((session) => (
                        <SessionRow
                          key={session.id}
                          id={session.id}
                          path={project.path}
                          title={session.title}
                          updatedAt={session.updatedAt}
                          projectName={project.name}
                          worktree={worktreeName(session, project)}
                          status={session.status}
                          active={active.cwd === (session.cwd ?? project.path) && session.id === active.id}
                          indent
                          pinned={isPinned(project.path, session.id)}
                          dragging={dragging?.kind === "session" && dragging.path === project.path && dragging.id === session.id}
                          dropEdge={
                            dropTarget?.kind === "session" && dropTarget.path === project.path && dropTarget.id === session.id
                              ? dropTarget.edge
                              : undefined
                          }
                          onClick={() => selectSession(session.cwd ?? project.path, session.id)}
                          onTogglePin={() => togglePin(project.path, session.id)}
                          onDelete={() => onDeleteSession(session.cwd ?? project.path, session.id, session.title)}
                          onMove={(direction) => moveBy(project.path, session.id, direction)}
                          onPointerDown={(event) => startDrag(event, "session", project.path, session.id, session.title)}
                          onPointerMove={moveDrag}
                          onPointerUp={endDrag}
                          onPointerCancel={cancelDrag}
                        />
                      ))}
                      {visible.length > TASK_PREVIEW && (
                        <button
                          type="button"
                          onClick={() => toggleUnfolded(project.path)}
                          className="noa-sidebar-hover-surface-subtle mx-2 mb-0.5 block min-h-[30px] w-[calc(100%-1rem)] cursor-pointer rounded-lg py-1 text-left text-body text-[var(--sidebar-text-muted,#898781)] hover:text-[var(--text-primary,#2D2D2B)]"
                          style={{ paddingLeft: "29px" }}
                        >
                          {unfolded.has(project.path) ? "Show less" : "Show more"}
                        </button>
                      )}
                    </div>
                  </Collapsible>
                </div>
              )
            })}
            </div>
          </Collapsible>
          {projects.length > 0 && (
            <section aria-label="Recents" className="mt-2">
              <div className="group/recents h-[30px] flex items-center pl-[10px] pr-2 gap-0.5">
                <button
                  type="button"
                  aria-expanded={!recentsPrefs.collapsed}
                  onClick={() => setRecentsPrefs((current) => ({ ...current, collapsed: !current.collapsed }))}
                  className="group flex min-w-0 flex-1 items-center gap-1 pl-[5px] text-chat-sm text-[var(--text-tertiary,#898781)] font-ui"
                >
                  Recents
                  {/* Expanded, the chevron shows only on hover, as in Codex. */}
                  <ChevronRight
                    size={12}
                    className={`shrink-0 transition-[transform,opacity] duration-300 ease-[cubic-bezier(.19,1,.22,1)] ${recentsPrefs.collapsed ? "" : "rotate-90 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"}`}
                  />
                  {/* A collapsed list still shows that one of its tasks is working. */}
                  {recentsPrefs.collapsed && recents.some(({ session }) => session.status) && (
                    <span role="status" aria-label="Tasks running" className={`ml-1 ${recents.some(({ session }) => session.status === "running") ? "noa-status-running" : "size-1.5 shrink-0 rounded-full bg-[var(--accent-color)]"}`} />
                  )}
                </button>
                {/* Shown on hover; an active filter keeps them visible. */}
                <span
                  className={`flex items-center gap-0.5 group-hover/recents:opacity-100 focus-within:opacity-100 has-[[aria-expanded=true]]:opacity-100 ${recentsProject ? "opacity-100" : "opacity-0"}`}
                >
                  <button
                    type="button"
                    aria-label="Recents options"
                    title="Recents options"
                    aria-haspopup="menu"
                    aria-expanded={!!recentsMenu}
                    onClick={(event) => {
                      const trigger = event.currentTarget
                      setRecentsMenu((current) => (current ? undefined : { anchor: anchorBelow(trigger), trigger }))
                    }}
                    className={`flex size-6 items-center justify-center rounded-md noa-sidebar-hover-surface noa-press ${
                      recentsMenu ? "text-[var(--text-primary,#2D2D2B)]" : "text-[var(--sidebar-text-muted,#898781)] hover:text-[var(--text-primary,#2D2D2B)]"
                    }`}
                  >
                    <MoreHorizontal size={14} />
                  </button>
                  {recentsMenu && (
                    <PopupMenu
                      label="Recents options"
                      anchor={recentsMenu.anchor}
                      trigger={recentsMenu.trigger}
                      onClose={() => setRecentsMenu(undefined)}
                      entries={[
                        {
                          label: "Sort tasks by",
                          icon: ArrowUpDown,
                          submenu: (
                            [
                              ["updated", "Last updated"],
                              ["created", "Created"],
                            ] as const
                          ).map(([sort, label]) => ({
                            key: sort,
                            label,
                            checked: recentsPrefs.sort === sort,
                            onSelect: () => setRecentsPrefs((current) => ({ ...current, sort })),
                          })),
                        },
                        { kind: "separator" },
                        { kind: "heading", label: "Show" },
                        {
                          key: "all",
                          label: "All projects",
                          checked: recentsProject === null,
                          onSelect: () => setRecentsPrefs((current) => ({ ...current, project: null })),
                        },
                        {
                          label: "Only one project",
                          icon: Folder,
                          submenu: projects.map((project) => ({
                            key: project.path,
                            label: project.name,
                            checked: recentsProject === project.path,
                            onSelect: () => setRecentsPrefs((current) => ({ ...current, project: project.path })),
                          })),
                        },
                      ]}
                    />
                  )}
                  <IconButton
                    title={recentsProject ? "New task in this project" : "New task"}
                    label="New task"
                    onClick={() => onNewSession(recentsProject ?? undefined)}
                  >
                    <SquarePen size={14} />
                  </IconButton>
                </span>
              </div>
              <Collapsible open={!recentsPrefs.collapsed} duration={300} fade>
                <div className="flex flex-col gap-px pt-1 font-ui">
                  {(recentsUnfolded ? recents : recents.slice(0, RECENTS_PREVIEW)).map(({ project, session }) => (
                    <SessionRow
                      key={`${project.path}\0${session.id}`}
                      id={session.id}
                      path={project.path}
                      title={session.title}
                      updatedAt={session.updatedAt}
                      projectName={project.name}
                      worktree={worktreeName(session, project)}
                      status={session.status}
                      active={active.cwd === (session.cwd ?? project.path) && session.id === active.id}
                      pinned={isPinned(project.path, session.id)}
                      onClick={() => selectSession(session.cwd ?? project.path, session.id)}
                      onTogglePin={() => togglePin(project.path, session.id)}
                      onDelete={() => onDeleteSession(session.cwd ?? project.path, session.id, session.title)}
                    />
                  ))}
                  {recents.length > RECENTS_PREVIEW && (
                    <button
                      type="button"
                      onClick={() => setRecentsUnfolded((open) => !open)}
                      className="noa-sidebar-hover-surface-subtle mx-2 mb-0.5 block min-h-[30px] w-[calc(100%-1rem)] cursor-pointer rounded-lg py-1 text-left text-body text-[var(--sidebar-text-muted,#898781)] hover:text-[var(--text-primary,#2D2D2B)]"
                      style={{ paddingLeft: "7px" }}
                    >
                      {recentsUnfolded ? "Show less" : "Show more"}
                    </button>
                  )}
                  {recents.length === 0 && (
                    <div className="pl-[15px] py-1 text-caption text-[var(--sidebar-text-muted,#898781)]">
                      {recentsProject ? "No tasks in this project yet" : "No tasks yet"}
                    </div>
                  )}
                </div>
              </Collapsible>
            </section>
          )}
        </div>
      </div>
      {dragging && <DragOverlay drag={dragging} />}
      <div className="flex shrink-0 items-center gap-1 border-t-[0.5px] border-[var(--panel-divider)] px-2 py-1.5" style={noDragRegion}>
        <button
          type="button"
          onClick={onSettings}
          className="noa-sidebar-tree-item noa-sidebar-hover-surface-subtle flex h-[30px] min-w-0 flex-1 items-center gap-2 rounded-lg pl-[7px] pr-2 text-body text-[var(--sidebar-text-muted)] hover:text-[var(--text-primary,#2D2D2B)]"
        >
          <Settings size={14} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left">Settings</span>
        </button>
        <UpdateButton />
      </div>
    </div>
  )
}

function IconButton({
  title,
  label,
  onClick,
  children,
}: {
  title: string
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      className="flex size-6 items-center justify-center rounded-md noa-sidebar-hover-surface text-[var(--sidebar-text-muted,#898781)] hover:text-[var(--text-primary,#2D2D2B)] noa-press"
      title={title}
      aria-label={label}
    >
      {children}
    </button>
  )
}

type DragKind = "session" | "project"
type DragStart = { kind: DragKind; path: string; id: string; label: string; x: number; y: number; offsetX: number; offsetY: number; moved: boolean }
type DragState = { kind: DragKind; path: string; id: string; label: string; left: number; top: number }

// The drop indicator: a 2px accent rule with a hollow ring at its start, on the edge being dropped onto.
function DropIndicator({ edge, indented, className }: { edge: "before" | "after"; indented?: boolean; className: string }) {
  return (
    <div
      aria-hidden="true"
      role="presentation"
      className={`noa-drop-indicator pointer-events-none absolute z-10 h-0 ${edge === "before" ? "top-0" : "bottom-0"} ${indented ? "is-indented" : ""} ${className}`}
    />
  )
}

// The floating copy that follows the pointer while a row is dragged.
function DragOverlay({ drag }: { drag: DragState }) {
  return createPortal(
    <div
      aria-hidden="true"
      className="noa-drag-overlay pointer-events-none fixed z-[100] flex h-[30px] max-w-80 items-center gap-2 overflow-hidden rounded-lg font-ui text-body"
      style={{ left: drag.left, top: drag.top, paddingLeft: drag.kind === "project" ? 7 : 8, paddingRight: 12 }}
    >
      {drag.kind === "project" && <Folder size={16} className="shrink-0" />}
      <span className="min-w-0 truncate">{drag.label}</span>
    </div>,
    document.body,
  )
}

// A project folder header; its actions appear on hover, as Noa's tree rows do.
function ProjectRow({
  project,
  open,
  dragging,
  onToggle,
  onMove,
  onNewSession,
  onEdit,
  onRemove,
  onReveal,
  onOpenCoordinator,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  project: ProjectInfo
  open: boolean
  dragging: boolean
  onToggle: () => void
  onMove: (direction: -1 | 1) => void
  onNewSession: () => void
  onEdit: () => void
  onRemove: () => void
  onReveal: () => void
  onOpenCoordinator: () => void
  onPointerDown?: (event: PointerEvent<HTMLElement>) => void
  onPointerMove: (event: PointerEvent<HTMLElement>) => void
  onPointerUp: (event: PointerEvent<HTMLElement>) => void
  onPointerCancel: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menuOpen) return
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        setMenuOpen(false)
      }
    }
    document.addEventListener("mousedown", close)
    document.addEventListener("keydown", escape)
    return () => {
      document.removeEventListener("mousedown", close)
      document.removeEventListener("keydown", escape)
    }
  }, [menuOpen])
  return (
    <div className="noa-sidebar-tree-item mb-0.5">
      <div
        role="button"
        tabIndex={0}
        title={project.path}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return
          if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
            e.preventDefault()
            onMove(e.key === "ArrowUp" ? -1 : 1)
          } else if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            onToggle()
          }
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        className={`noa-sidebar-tree-row noa-agent-sidebar-row group flex h-[30px] items-center gap-[7px] pl-[6px] pr-2 mx-2 rounded-lg cursor-pointer select-none ${menuOpen ? "is-active" : ""} ${dragging ? "noa-session-row-dragging" : ""}`}
      >
        {/* A 16px folder icon in the row ink, centred on the New task icon's column so names line up
            with the search and New task labels. Open folders swap to the open shape. */}
        {open ? (
          <FolderOpen size={16} className="shrink-0" />
        ) : (
          <Folder size={16} className="shrink-0" />
        )}
        <span
          className={`min-w-0 flex-1 truncate text-body ${project.missing ? "text-[var(--sidebar-text-muted,#898781)] line-through" : ""}`}
        >
          {project.name}
        </span>
        {project.missing && <span className="shrink-0 text-caption text-[#C24444]">missing</span>}
        <span
          data-session-action
          className={`flex shrink-0 items-center gap-2 group-hover:opacity-100 focus-within:opacity-100 ${menuOpen ? "opacity-100" : "opacity-0"}`}
          style={noDragRegion}
        >
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              aria-label={`Project actions for ${project.name}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              title="Project actions"
              onClick={(event) => {
                event.stopPropagation()
                setMenuOpen((open) => !open)
              }}
              className="flex size-6 items-center justify-center rounded-md text-[var(--sidebar-text-muted)] hover:text-[var(--sidebar-text)]"
            >
              <MoreHorizontal size={14} />
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="noa-floating-panel absolute right-0 top-full z-50 mt-1 w-44 rounded-[var(--menu-popover-radius)] bg-[var(--bg-card)] p-1 shadow-[var(--menu-shadow)]"
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    onEdit()
                  }}
                  className="w-full rounded-md px-2.5 py-1.5 text-left text-body hover:bg-[var(--fill-hover)]"
                >
                  Edit project
                </button>
                {!project.missing && (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false)
                        onOpenCoordinator()
                      }}
                      className="w-full rounded-md px-2.5 py-1.5 text-left text-body hover:bg-[var(--fill-hover)]"
                    >
                      Coordinator
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false)
                        onReveal()
                      }}
                      className="w-full rounded-md px-2.5 py-1.5 text-left text-body hover:bg-[var(--fill-hover)]"
                    >
                      Reveal in Finder
                    </button>
                    <div className="my-1 h-px bg-[var(--divider-subtle)]" />
                  </>
                )}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    onRemove()
                  }}
                  className="w-full rounded-md px-2.5 py-1.5 text-left text-body hover:bg-[var(--fill-hover)]"
                >
                  Remove project
                </button>
              </div>
            )}
          </div>
          {!project.missing && (
            <button
              type="button"
              aria-label="New task in project"
              title={`New task in ${project.name}`}
              onClick={(event) => {
                event.stopPropagation()
                onNewSession()
              }}
              className="flex size-6 items-center justify-center rounded-md text-[var(--sidebar-text-muted,#898781)] hover:text-[var(--text-primary,#2D2D2B)] noa-press"
            >
              <SquarePen size={14} />
            </button>
          )}
        </span>
      </div>
    </div>
  )
}

function worktreeName(session: SessionSummary, project: ProjectInfo): string | undefined {
  return session.cwd && session.cwd !== project.path ? session.cwd.split("/").filter(Boolean).pop() : undefined
}

// Same row shell as Noa's FileNode (noa-sidebar-tree-item / noa-sidebar-tree-row).
function SessionRow({
  id,
  path,
  title,
  updatedAt,
  projectName,
  worktree,
  status,
  active,
  indent,
  pinned,
  dragging,
  dropEdge,
  onClick,
  onTogglePin,
  onDelete,
  onMove,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  id: string
  path: string
  title: string
  updatedAt?: number
  projectName?: string
  // Folder name of the worktree the task runs in, when it is not the project folder.
  worktree?: string
  status?: "running" | "waiting" | "queued"
  active: boolean
  indent?: boolean
  pinned: boolean
  dragging?: boolean
  dropEdge?: "before" | "after"
  onClick?: () => void
  onTogglePin?: () => void
  onDelete?: () => void
  onMove?: (direction: -1 | 1) => void
  onPointerDown?: (event: PointerEvent<HTMLElement>) => void
  onPointerMove?: (event: PointerEvent<HTMLElement>) => void
  onPointerUp?: (event: PointerEvent<HTMLElement>) => void
  onPointerCancel?: () => void
}) {
  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    // Alt+arrows reorder without a pointer; Enter/Space still activates the row.
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault()
      onMove?.(e.key === "ArrowUp" ? -1 : 1)
      return
    }
    if (onClick && e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault()
      onClick()
    }
  }
  const hoverCard = useSessionHoverCard({ title, updatedAt, project: projectName, worktree }, !dragging)
  const [menu, setMenu] = useState<{ anchor: PopupMenuAnchor; trigger?: Element }>()
  return (
    <div className="font-ui mb-0.5 noa-sidebar-tree-item">
      <div
        data-session-id={onPointerDown ? id : undefined}
        data-session-path={onPointerDown ? path : undefined}
        data-session-pinned={onPointerDown ? (pinned ? "true" : "false") : undefined}
        role="button"
        aria-current={active ? "page" : undefined}
        tabIndex={0}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onContextMenu={(event) => {
          event.preventDefault()
          setMenu({ anchor: { left: event.clientX, top: event.clientY + 4, bottom: event.clientY - 4 } })
        }}
        onPointerEnter={hoverCard.triggerProps.onPointerEnter}
        onPointerLeave={hoverCard.triggerProps.onPointerLeave}
        onFocus={hoverCard.triggerProps.onFocus}
        onBlur={hoverCard.triggerProps.onBlur}
        onPointerDown={(event) => { hoverCard.triggerProps.onPointerDown(); onPointerDown?.(event) }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        className={`noa-sidebar-tree-row relative flex h-[30px] items-center justify-between py-0 px-2 mx-2 rounded-lg cursor-pointer select-none group ${
          active ? "noa-agent-sidebar-row is-active" : "noa-agent-sidebar-row"
        } ${dragging ? "noa-session-row-dragging" : ""}`}
        style={{ paddingLeft: indent ? "29px" : "7px" }}
      >
        {dropEdge && <DropIndicator edge={dropEdge} indented={indent} className="inset-x-0" />}
        <MarqueeText className={status ? "" : "-mr-2 group-hover:mr-6 group-focus-within:mr-6"}>{title}</MarqueeText>
        <span className={`${status ? "ml-2 flex shrink-0" : "absolute inset-y-0 right-2 flex"} items-center gap-1`}>
          {status && <span role="status" aria-label={status === "waiting" ? "Approval required" : status === "running" ? "Running" : "Queued"} title={status} className={`size-1.5 shrink-0 rounded-full ${status === "running" ? "noa-status-running" : status === "waiting" ? "bg-amber-500" : "animate-pulse bg-[var(--accent-color)]"}`} />}
          <button
            type="button"
            data-session-action
            aria-label="Task options"
            aria-haspopup="menu"
            aria-expanded={!!menu}
            title="Task options"
            onClick={(event) => {
              event.stopPropagation()
              const trigger = event.currentTarget
              setMenu((current) => (current ? undefined : { anchor: anchorBelow(trigger), trigger }))
            }}
            className={`flex size-6 items-center justify-center rounded-md text-[var(--sidebar-text-muted,#898781)] hover:text-[var(--text-primary,#2D2D2B)] noa-press ${
              status
                // Collapsed to nothing while hidden so the status dot sits at the row's edge, not left of an invisible button.
                ? "-ml-1 w-0 overflow-hidden opacity-0 group-hover:ml-0 group-hover:w-6 group-hover:opacity-100 group-focus-within:ml-0 group-focus-within:w-6 group-focus-within:opacity-100 aria-expanded:ml-0 aria-expanded:w-6 aria-expanded:opacity-100"
                : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
            }`}
          >
            <MoreHorizontal size={14} />
          </button>
        </span>
      </div>
      {hoverCard.card}
      {menu && (
        <PopupMenu
          label="Task options"
          anchor={menu.anchor}
          trigger={menu.trigger}
          onClose={() => setMenu(undefined)}
          entries={[
            { label: pinned ? "Unpin" : "Pin", icon: Pin, onSelect: onTogglePin },
            { kind: "separator" },
            { label: "Delete", icon: Trash2, danger: true, onSelect: onDelete },
          ]}
        />
      )}
    </div>
  )
}
