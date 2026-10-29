import { useEffect, useRef, useState } from "react"
import type { ProjectInfo } from "../api"
import { Check, Folder, Plus, Search } from "../lib/icons"

// Project chooser: search, the projects with the active one ticked, then "New project".
export function ProjectPicker({
  projects,
  activeCwd,
  onSelect,
  onAddProject,
  onClose,
}: {
  projects: ProjectInfo[]
  activeCwd: string
  onSelect: (path: string) => void
  onAddProject: () => void
  onClose: () => void
}) {
  const [query, setQuery] = useState("")
  const ref = useRef<HTMLDivElement>(null)
  const matches = projects.filter(
    (project) => !project.missing && project.name.toLowerCase().includes(query.trim().toLowerCase()),
  )
  // A row shows its full path on hover only when another project has the same name.
  const duplicateNames = new Set(
    projects.filter((p) => projects.filter((q) => q.name === p.name).length > 1).map((p) => p.name),
  )

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("mousedown", close)
    document.addEventListener("keydown", escape)
    return () => {
      document.removeEventListener("mousedown", close)
      document.removeEventListener("keydown", escape)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      role="menu"
      className="noa-floating-panel absolute left-1/2 top-full z-50 mt-2 w-64 -translate-x-1/2 rounded-panel bg-[var(--bg-card)] p-1 text-left font-ui"
    >
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[var(--sidebar-text-muted,#898781)]">
        <Search size={14} className="shrink-0" />
        <input
          type="text"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search projects"
          aria-label="Search projects"
          className="min-w-0 flex-1 bg-transparent text-body text-[var(--text-primary)] outline-none placeholder:text-[var(--sidebar-text-muted,#898781)]"
        />
      </div>
      <div className="my-1 h-px bg-[var(--divider-subtle)]" />
      {matches.map((project) => (
        <button
          key={project.path}
          type="button"
          role="menuitem"
          onClick={() => onSelect(project.path)}
          aria-current={activeCwd === project.path ? "true" : undefined}
          title={duplicateNames.has(project.name) ? project.path : undefined}
          className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-body hover:bg-[color-mix(in_srgb,var(--text-primary)_6%,transparent)] ${
            activeCwd === project.path ? "bg-[color-mix(in_srgb,var(--text-primary)_6%,transparent)]" : ""
          }`}
        >
          <span className="shrink-0 text-[var(--sidebar-text-muted,#898781)]">
            <Folder size={14} />
          </span>
          <span className="min-w-0 flex-1 truncate">{project.name}</span>
          {activeCwd === project.path && <Check size={14} className="shrink-0" />}
        </button>
      ))}
      {matches.length === 0 && (
        <div className="px-2.5 py-1.5 text-caption text-[var(--sidebar-text-muted,#898781)]">No projects match</div>
      )}
      <div className="my-1 h-px bg-[var(--divider-subtle)]" />
      <button
        type="button"
        role="menuitem"
        onClick={onAddProject}
        className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-body text-[var(--sidebar-text-muted,#898781)] hover:bg-[color-mix(in_srgb,var(--text-primary)_5%,transparent)]"
      >
        <Plus size={14} className="shrink-0" />
        New project
      </button>
    </div>
  )
}
