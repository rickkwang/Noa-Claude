import { useState } from "react"

interface AddProjectDialogProps {
  onAdd: (path: string) => Promise<void>
  onClose: () => void
}

// Small modal for entering a project folder's absolute path; the bridge checks that it exists.
export function AddProjectDialog({ onAdd, onClose }: AddProjectDialogProps) {
  const [path, setPath] = useState("")
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!path.trim() || busy) return
    setBusy(true)
    setError(undefined)
    try {
      await onAdd(path.trim())
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 pt-[18vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        role="dialog"
        aria-label="Add project folder"
        className="flex w-[420px] flex-col gap-3 rounded-[10px] bg-[var(--bg-card,#FFFFFF)] p-5 font-ui shadow-[var(--shadow-dialog)]"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose()
        }}
      >
        <div>
          <h2 className="m-0 text-balance text-body font-semibold text-[var(--text-primary,#2D2D2B)]">Add project folder</h2>
          <p className="m-0 mt-1 text-balance text-caption text-[var(--sidebar-text-muted,#898781)]">
            Sessions started in this folder are grouped under it.
          </p>
        </div>
        <input
          autoFocus
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="/Users/you/Projects/my-app"
          aria-label="Project folder path"
          spellCheck={false}
          className="h-8 rounded-md bg-[var(--surface-page,#F9F9F7)] px-2.5 font-mono text-caption text-[var(--text-primary,#2D2D2B)] shadow-[0_0_0_1px_var(--divider-subtle)] outline-none focus:shadow-[0_0_0_1px_var(--accent-color,#CC7D5E)]"
        />
        {error && <p className="m-0 text-caption text-[#C24444]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-7 rounded-md border border-[var(--divider-subtle)] px-3 text-caption text-[var(--text-primary,#2D2D2B)] noa-press"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!path.trim() || busy}
            className="h-7 rounded-md bg-[var(--accent-color,#CC7D5E)] px-3 text-caption text-white disabled:opacity-50 noa-press"
          >
            Add
          </button>
        </div>
      </form>
    </div>
  )
}
