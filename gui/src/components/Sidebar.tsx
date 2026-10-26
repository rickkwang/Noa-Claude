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
import type { ProjectInfo, SessionSummary } from "../api"
import {
  Check,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  Pin,
  PinFilled,
  Plus,
  Search,
  Settings,
  SquarePen,
} from "../lib/icons"

// Tasks shown per project before "Show more".
const TASK_PREVIEW = 5

const dragRegion = { WebkitAppRegion: "drag" } as CSSProperties
const noDragRegion = { WebkitAppRegion: "no-drag" } as CSSProperties

// Pins and manual ordering live in the browser: the server keeps producing
// newest-first lists, and the sidebar layers the user's arrangement over them.
type SessionPrefs = {
  pinned: Record<string, Record<string, true>>
  order: Record<string, string[]>
}
const SESSION_PREFS_KEY = "noa-agent.sessionPrefs"

function loadSessionPrefs(): SessionPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(SESSION_PREFS_KEY) ?? "{}") as Partial<SessionPrefs>
    return { pinned: raw.pinned ?? {}, order: raw.order ?? {} }
  } catch {
    return { pinned: {}, order: {} }
  }
}

// Stored ids first, in their saved order; sessions the server added since are appended newest-first.
function resolveOrder(prefs: SessionPrefs, path: string, sessions: SessionSummary[]): string[] {
  const ids = sessions.map((session) => session.id)
  const stored = (prefs.order[path] ?? []).filter((id) => ids.includes(id))
  const seen = new Set(stored)
  return [...stored, ...ids.filter((id) => !seen.has(id))]
}

function orderedSessions(prefs: SessionPrefs, path: string, sessions: SessionSummary[]): SessionSummary[] {
  const index = new Map(resolveOrder(prefs, path, sessions).map((id, position) => [id, position]))
  const pinned = prefs.pinned[path] ?? {}
  return [...sessions].sort((a, b) => {
    const group = Number(!pinned[a.id]) - Number(!pinned[b.id])
    return group || (index.get(a.id) ?? 0) - (index.get(b.id) ?? 0)
  })
}

export interface ActiveSession {
  cwd: string
  id?: string
}

interface SidebarProps {
  projects: ProjectInfo[]
  // Sessions per project path, newest first.
  sessions: Record<string, SessionSummary[]>
  active: ActiveSession
  // Without a path the active project is used.
  onNewSession: (cwd?: string) => void
  onSelect: (cwd: string, id: string) => void
  onAddProject: () => void
  onEditProject: (project: ProjectInfo) => void
  onRemoveProject: (path: string) => void
  onRevealProject: (path: string) => void
  onSettings: () => void
}

// Noa's sidebar: search, a Projects toolbar, then one collapsible group per project folder.
export function Sidebar({
  projects,
  sessions,
  active,
  onNewSession,
  onSelect,
  onAddProject,
  onEditProject,
  onRemoveProject,
  onRevealProject,
  onSettings,
}: SidebarProps) {
  const [query, setQuery] = useState("")
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set())
  const [projectsOpen, setProjectsOpen] = useState(true)
  const [prefs, setPrefs] = useState<SessionPrefs>(loadSessionPrefs)
  const dragRef = useRef<{ path: string; id: string; x: number; y: number; moved: boolean } | undefined>(undefined)
  const suppressClickRef = useRef(false)
  const [dragging, setDragging] = useState<{ path: string; id: string }>()
  const [dropTarget, setDropTarget] = useState<{ path: string; id: string; edge: "before" | "after" }>()
  const q = query.trim().toLowerCase()

  useEffect(() => {
    try {
      localStorage.setItem(SESSION_PREFS_KEY, JSON.stringify(prefs))
    } catch {
      // Ordering is a convenience; a full storage quota must not break the sidebar.
    }
  }, [prefs])

  // Drop the global drag cursor if the sidebar unmounts mid-drag.
  useEffect(() => () => document.body.classList.remove("noa-session-dragging"), [])

  // While searching, every project with a match opens so the hits are visible.
  const groups = useMemo(
    () =>
      projects.map((project) => {
        const all = orderedSessions(prefs, project.path, sessions[project.path] ?? [])
        const matches = q ? all.filter((s) => s.title.toLowerCase().includes(q)) : all
        const nameMatches = q !== "" && project.name.toLowerCase().includes(q)
        return { project, visible: nameMatches ? all : matches }
      }),
    [projects, sessions, q, prefs],
  )

  const isPinned = (path: string, id: string) => !!prefs.pinned[path]?.[id]

  function saveOrder(path: string, order: string[]) {
    setPrefs((current) => ({ ...current, order: { ...current.order, [path]: order } }))
  }

  function togglePin(path: string, id: string) {
    const order = resolveOrder(prefs, path, sessions[path] ?? [])
    const pinned = { ...prefs.pinned[path] }
    if (pinned[id]) delete pinned[id]
    else {
      pinned[id] = true
      // A freshly pinned task joins the top of the pinned block.
      const from = order.indexOf(id)
      if (from >= 0) order.splice(from, 1)
      order.unshift(id)
    }
    setPrefs((current) => ({
      ...current,
      pinned: { ...current.pinned, [path]: pinned },
      order: { ...current.order, [path]: order },
    }))
  }

  function reorder(path: string, fromId: string, toId: string, edge: "before" | "after") {
    if (fromId === toId) return
    const order = resolveOrder(prefs, path, sessions[path] ?? [])
    const from = order.indexOf(fromId)
    if (from < 0) return
    order.splice(from, 1)
    const to = order.indexOf(toId)
    if (to < 0) return
    order.splice(edge === "before" ? to : to + 1, 0, fromId)
    saveOrder(path, order)
  }

  // Alt+↑/↓ moves a task inside its own block (pinned or recent).
  function moveBy(path: string, id: string, direction: -1 | 1) {
    const all = sessions[path] ?? []
    const group = orderedSessions(prefs, path, all).filter((session) => isPinned(path, session.id) === isPinned(path, id))
    const position = group.findIndex((session) => session.id === id)
    const target = group[position + direction]
    if (!target) return
    const order = resolveOrder(prefs, path, all)
    const a = order.indexOf(id)
    const b = order.indexOf(target.id)
    if (a < 0 || b < 0) return
    ;[order[a], order[b]] = [order[b]!, order[a]!]
    saveOrder(path, order)
  }

  // 4px of travel before a press becomes a drag, so click-to-open stays reliable.
  function startDrag(event: PointerEvent<HTMLElement>, path: string, id: string) {
    if (event.button !== 0 || (event.target as HTMLElement).closest("[data-session-action]")) return
    dragRef.current = { path, id, x: event.clientX, y: event.clientY, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function moveDrag(event: PointerEvent<HTMLElement>) {
    const start = dragRef.current
    if (!start) return
    if (!start.moved) {
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 4) return
      start.moved = true
      setDragging({ path: start.path, id: start.id })
      document.body.classList.add("noa-session-dragging")
    }
    const row = (document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-session-id]")
    if (!row || row.dataset.sessionPath !== start.path || row.dataset.sessionId === start.id) {
      setDropTarget(undefined)
      return
    }
    // Pinned and recent blocks stay separate; a cross-block drop would snap back.
    if ((row.dataset.sessionPinned === "true") !== isPinned(start.path, start.id)) {
      setDropTarget(undefined)
      return
    }
    const rect = row.getBoundingClientRect()
    setDropTarget({
      path: start.path,
      id: row.dataset.sessionId!,
      edge: event.clientY < rect.top + rect.height / 2 ? "before" : "after",
    })
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
    if (target && target.path === start.path) reorder(start.path, start.id, target.id, target.edge)
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
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  return (
    <div className="noa-sidebar-surface noa-sidebar-fade-scope w-full h-full min-h-0 flex flex-col shrink-0 relative">
      {/* Titlebar band: the traffic lights and sidebar toggle sit over it, so it stays draggable. */}
      <div className="h-11 shrink-0" style={dragRegion} />

      <div className="noa-sidebar-search mx-2 mb-[9px] flex h-[26px] shrink-0 cursor-text items-center gap-0.5 rounded-[6px]">
        <span
          aria-hidden="true"
          className="ml-[5px] mr-[7px] flex size-4 shrink-0 items-center justify-center text-[var(--sidebar-text-muted,#898781)]"
        >
          <Search size={16} />
        </span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault()
              setQuery("")
              e.currentTarget.blur()
            }
          }}
          placeholder="Search"
          aria-label="Search tasks"
          className="noa-sidebar-search-input min-w-0 flex-1 bg-transparent text-body font-ui outline-none"
        />
      </div>

      <button
        type="button"
        onClick={() => onNewSession()}
        className="noa-sidebar-tree-item noa-sidebar-tree-row noa-sidebar-hover-surface-subtle mx-2 mb-0.5 flex min-h-[26px] shrink-0 items-center gap-2 rounded-lg px-[7px]"
      >
        <SquarePen size={14} className="shrink-0" />
        New task
      </button>

      <div className="group/projects noa-sidebar-toolbar-mask h-8 flex items-center pl-1 pr-2 gap-0.5 shrink-0 z-10 overflow-visible">
        <button
          type="button"
          aria-expanded={projectsOpen}
          onClick={() => setProjectsOpen((open) => !open)}
          className="flex min-w-0 flex-1 items-center gap-1 pl-[11px] text-body text-[var(--sidebar-text-muted,#898781)] font-ui"
        >
          Projects
          <ChevronRight
            size={12}
            className={`shrink-0 transition-transform duration-150 ${projectsOpen ? "rotate-90" : ""}`}
          />
        </button>
        {/* Hidden until the header is hovered or focused, as Codex's Projects toolbar is. */}
        <span className="flex opacity-0 transition-opacity group-hover/projects:opacity-100 focus-within:opacity-100">
          <IconButton title="Add project folder" label="Add project" onClick={onAddProject}>
            <FolderPlus size={14} />
          </IconButton>
        </span>
      </div>

      <div className="noa-sidebar-scroll noa-sidebar-scroll-fade group/tree flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        <div className="pt-1 pb-2">
          {projects.length === 0 && (
            <button
              type="button"
              onClick={onAddProject}
              className="mx-4 mt-2 text-left text-caption text-[var(--accent-color,#CC7D5E)] hover:underline"
            >
              Add a project folder to start
            </button>
          )}
          {projectsOpen &&
            groups.map(({ project, visible }) => {
              const isOpen = q !== "" || expanded.has(project.path)
              const isActiveProject = active.cwd === project.path
              return (
                <div key={project.path} className="font-ui mb-px">
                  <ProjectRow
                    project={project}
                    open={isOpen}
                    onToggle={() => toggle(project.path)}
                    onNewSession={() => onNewSession(project.path)}
                    onEdit={() => onEditProject(project)}
                    onRemove={() => onRemoveProject(project.path)}
                    onReveal={() => onRevealProject(project.path)}
                  />
                  {isOpen && (
                    <>
                      {(q !== "" || unfolded.has(project.path) ? visible : visible.slice(0, TASK_PREVIEW)).map((session) => (
                        <SessionRow
                          key={session.id}
                          id={session.id}
                          path={project.path}
                          title={session.title}
                          status={session.status}
                          active={isActiveProject && session.id === active.id}
                          indent
                          pinned={isPinned(project.path, session.id)}
                          dragging={dragging?.path === project.path && dragging.id === session.id}
                          dropEdge={
                            dropTarget?.path === project.path && dropTarget.id === session.id
                              ? dropTarget.edge
                              : undefined
                          }
                          onClick={() => selectSession(project.path, session.id)}
                          onTogglePin={() => togglePin(project.path, session.id)}
                          onMove={(direction) => moveBy(project.path, session.id, direction)}
                          onPointerDown={(event) => startDrag(event, project.path, session.id)}
                          onPointerMove={moveDrag}
                          onPointerUp={endDrag}
                          onPointerCancel={cancelDrag}
                        />
                      ))}
                      {q === "" && visible.length > TASK_PREVIEW && (
                        <button
                          type="button"
                          onClick={() => toggleUnfolded(project.path)}
                          className="mb-px block w-full cursor-pointer py-0 text-left text-caption text-[var(--sidebar-text-muted,#898781)] hover:text-[var(--text-primary,#2D2D2B)]"
                          style={{ paddingLeft: "31px" }}
                        >
                          {unfolded.has(project.path) ? "Show less" : "Show more"}
                        </button>
                      )}
                      {visible.length === 0 && q !== "" && (
                        <div className="pl-9 py-1 text-caption text-[var(--sidebar-text-muted,#898781)]">
                          No tasks match
                        </div>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          {projectsOpen && projects.length > 0 && q === "" && groups.every((g) => g.visible.length === 0) && (
            <div className="px-4 py-2 text-caption text-[var(--sidebar-text-muted,#898781)]">No tasks yet</div>
          )}
        </div>
      </div>
      <div className="shrink-0 border-t border-[var(--divider-subtle)] px-2 py-1" style={noDragRegion}>
        <button
          onClick={onSettings}
          className="flex h-7 w-full items-center gap-2.5 rounded-lg px-[7px] text-body text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--text-primary)_6%,transparent)] active:bg-[color-mix(in_srgb,var(--text-primary)_10%,transparent)]"
        >
          <Settings size={16} />
          Settings
        </button>
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
      className="flex size-6 items-center justify-center rounded-md noa-sidebar-hover-surface text-[var(--sidebar-text-muted,#898781)] hover:text-[var(--text-primary,#2D2D2B)] transition-colors noa-press"
      title={title}
      aria-label={label}
    >
      {children}
    </button>
  )
}

// A project folder header; its actions appear on hover, as Noa's tree rows do.
function ProjectRow({
  project,
  open,
  onToggle,
  onNewSession,
  onEdit,
  onRemove,
  onReveal,
}: {
  project: ProjectInfo
  open: boolean
  onToggle: () => void
  onNewSession: () => void
  onEdit: () => void
  onRemove: () => void
  onReveal: () => void
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
    <div className="noa-sidebar-tree-item mb-px">
      <div
        role="button"
        tabIndex={0}
        title={project.path}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault()
            onToggle()
          }
        }}
        className={`noa-sidebar-tree-row noa-agent-sidebar-row group flex min-h-[26px] items-center gap-2 px-[7px] mx-2 rounded-lg cursor-pointer select-none ${menuOpen ? "is-active" : ""}`}
      >
        <span className="shrink-0 text-[var(--sidebar-text-muted,#898781)]">
          {open ? <FolderOpen size={16} /> : <Folder size={16} />}
        </span>
        <span
          className={`min-w-0 flex-1 truncate text-body text-[var(--sidebar-text,#52514E)] ${project.missing ? "text-[var(--sidebar-text-muted,#898781)] line-through" : ""}`}
        >
          {project.name}
        </span>
        {project.missing && <span className="shrink-0 text-caption text-[#C24444]">missing</span>}
        <span
          className={`flex shrink-0 items-center gap-2 transition-opacity group-hover:opacity-100 focus-within:opacity-100 ${menuOpen ? "opacity-100" : "opacity-0"}`}
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
              className="flex size-5 items-center justify-center rounded-md text-[var(--sidebar-text-muted)] hover:text-[var(--sidebar-text)]"
            >
              <MoreHorizontal size={14} />
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="noa-floating-panel absolute right-0 top-full z-50 mt-1 w-44 rounded-panel bg-[var(--bg-card)] p-1"
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    onEdit()
                  }}
                  className="w-full rounded-md px-2.5 py-1.5 text-left text-body hover:bg-[color-mix(in_srgb,var(--text-primary)_5%,transparent)]"
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
                        onReveal()
                      }}
                      className="w-full rounded-md px-2.5 py-1.5 text-left text-body hover:bg-[color-mix(in_srgb,var(--text-primary)_5%,transparent)]"
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
                  className="w-full rounded-md px-2.5 py-1.5 text-left text-body hover:bg-[color-mix(in_srgb,var(--text-primary)_5%,transparent)]"
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
              className="flex size-5 items-center justify-center rounded-md text-[var(--sidebar-text-muted,#898781)] hover:text-[var(--text-primary,#2D2D2B)] transition-colors noa-press"
            >
              <SquarePen size={14} />
            </button>
          )}
        </span>
      </div>
    </div>
  )
}

// Same row shell as Noa's FileNode (noa-sidebar-tree-item / noa-sidebar-tree-row).
function SessionRow({
  id,
  path,
  title,
  status,
  active,
  indent,
  pinned,
  dragging,
  dropEdge,
  onClick,
  onTogglePin,
  onMove,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  id: string
  path: string
  title: string
  status?: "running" | "waiting" | "queued"
  active: boolean
  indent?: boolean
  pinned: boolean
  dragging?: boolean
  dropEdge?: "before" | "after"
  onClick?: () => void
  onTogglePin?: () => void
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
  return (
    <div className="font-ui mb-px noa-sidebar-tree-item">
      <div
        data-session-id={id}
        data-session-path={path}
        data-session-pinned={pinned ? "true" : "false"}
        role="button"
        aria-current={active ? "page" : undefined}
        tabIndex={0}
        title={title}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        className={`noa-sidebar-tree-row flex min-h-[26px] items-center justify-between py-0 px-[7px] mx-2 rounded-lg cursor-pointer select-none group ${
          active ? "noa-agent-sidebar-row is-active" : "noa-agent-sidebar-row"
        } ${dragging ? "noa-session-row-dragging" : ""} ${
          dropEdge === "before" ? "noa-session-drop-before" : dropEdge === "after" ? "noa-session-drop-after" : ""
        }`}
        style={{ paddingLeft: indent ? "31px" : "7px" }}
      >
        <span className="noa-fade-truncate">{title}</span>
        <span className="ml-2 flex shrink-0 items-center gap-1">
          {status && <span role="status" aria-label={status === "waiting" ? "Approval required" : status === "running" ? "Running" : "Queued"} title={status} className={`size-1.5 shrink-0 rounded-full ${status === "waiting" ? "bg-amber-500" : "animate-pulse bg-[var(--accent-color)]"}`} />}
          <button
            type="button"
            data-session-action
            aria-label={pinned ? `Unpin ${title}` : `Pin ${title}`}
            aria-pressed={pinned}
            title={pinned ? "Unpin task" : "Pin task"}
            onClick={(event) => {
              event.stopPropagation()
              onTogglePin?.()
            }}
            className={`flex size-5 items-center justify-center rounded-md text-[var(--sidebar-text-muted,#898781)] hover:text-[var(--text-primary,#2D2D2B)] noa-press ${
              pinned ? "" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            }`}
          >
            {pinned ? <PinFilled size={13} /> : <Pin size={13} />}
          </button>
        </span>
      </div>
    </div>
  )
}
