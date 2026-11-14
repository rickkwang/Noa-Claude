import { useState } from "react"
import type { ProjectInfo } from "../api"
import { ProjectPicker } from "./ProjectPicker"
import { StatsPanel } from "./StatsPanel"

export function EmptyState({
  cwd,
  projects,
  onSelectProject,
  onAddProject,
}: {
  cwd: string
  projects: ProjectInfo[]
  onSelectProject: (path: string) => void
  onAddProject: () => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const name = cwd.split("/").filter(Boolean).pop() ?? cwd
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center gap-4 overflow-y-auto px-6 py-4 text-center font-ui">
      <h1 className="relative mx-0 mb-0 mt-auto shrink-0 text-balance text-[length:var(--text-title)] font-normal leading-[1.2] tracking-normal">
        What should we build in{" "}
        <button
          onClick={() => setPickerOpen(true)}
          aria-haspopup="menu"
          aria-expanded={pickerOpen}
          title={cwd}
          className="inline-block max-w-full cursor-pointer break-words whitespace-normal align-baseline underline decoration-dotted decoration-[1px] decoration-[var(--text-secondary,#7B7974)] underline-offset-4 hover:text-[var(--text-secondary,#7B7974)]"
        >
          {name}?
        </button>
        {pickerOpen && (
          <ProjectPicker
            projects={projects}
            activeCwd={cwd}
            onSelect={(path) => {
              setPickerOpen(false)
              onSelectProject(path)
            }}
            onAddProject={() => {
              setPickerOpen(false)
              onAddProject()
            }}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </h1>
      <div className="-mt-1.5 mb-auto flex w-full shrink-0 justify-center">
        <StatsPanel />
      </div>
    </div>
  )
}
