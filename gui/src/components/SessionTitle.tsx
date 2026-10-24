import { useState } from "react"
import { Check, ChevronRight, X } from "../lib/icons"

export function SessionTitle({
  project,
  title,
  onRename,
}: {
  project: string
  title?: string
  onRename?: (title: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const name = title ?? "New task"

  async function save() {
    if (!onRename || saving || !draft.trim()) return
    setSaving(true)
    setError(undefined)
    try {
      await onRename(draft.trim())
      setEditing(false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="relative flex min-w-0 items-center gap-1 font-normal">
      <span className="max-w-28 truncate text-caption text-[var(--sidebar-text-muted)]" title={project}>
        {project}
      </span>
      <ChevronRight size={11} className="shrink-0 text-[var(--sidebar-text-muted)]" />
      {editing ? (
        <form
          className="flex min-w-0 items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <input
            autoFocus
            aria-label="Task name"
            value={draft}
            maxLength={120}
            disabled={saving}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault()
                setEditing(false)
              }
            }}
            className="h-7 w-56 min-w-0 rounded-md border border-[var(--divider-subtle)] bg-[var(--bg-card)] px-2 text-body outline-none focus:border-[var(--accent-color)]"
          />
          <button
            type="submit"
            aria-label="Save task name"
            disabled={saving || !draft.trim()}
            className="rounded-md p-1 disabled:opacity-40"
          >
            <Check size={13} />
          </button>
          <button type="button" aria-label="Cancel rename" onClick={() => setEditing(false)} className="rounded-md p-1">
            <X size={13} />
          </button>
        </form>
      ) : (
        <button
          type="button"
          disabled={!onRename}
          aria-label={onRename ? "Rename task" : name}
          title={onRename ? `${name}\nClick to rename` : name}
          onClick={() => {
            setDraft(name)
            setError(undefined)
            setEditing(true)
          }}
          className="h-7 max-w-[min(28vw,320px)] truncate rounded-md px-1.5 text-body text-[var(--sidebar-text)] enabled:hover:bg-[color-mix(in_srgb,var(--text-primary)_5%,transparent)]"
        >
          {name}
        </button>
      )}
      {error && (
        <span
          role="alert"
          className="noa-floating-panel absolute left-0 top-full mt-1 w-64 rounded-md bg-[var(--bg-card)] p-2 text-caption text-[#C24444]"
        >
          {error}
        </span>
      )}
    </div>
  )
}
