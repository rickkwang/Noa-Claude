import {
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent,
} from "react"
import { AlertTriangle, Folder, FolderPlus, Loader2, X } from "../lib/icons"
import type { ProjectInfo } from "../api"

interface AddProjectDialogProps {
  project?: ProjectInfo
  onAdd: (paths: string[], name: string) => Promise<void>
  onClose: () => void
}

export function AddProjectDialog({ project, onAdd, onClose }: AddProjectDialogProps) {
  const [paths, setPaths] = useState<string[]>(project?.sources ?? [])
  const [name, setName] = useState(project?.name ?? "")
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const [dragging, setDragging] = useState(false)
  const cardRef = useRef<HTMLFormElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const addFolderRef = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef<HTMLElement | null>(null)
  const canChooseFolder = Boolean(
    window.noaDesktop?.selectProjectDirectories ?? window.noaDesktop?.selectProjectDirectory,
  )

  useEffect(() => {
    restoreFocus.current = document.activeElement as HTMLElement | null
    nameRef.current?.focus()
    return () => restoreFocus.current?.focus?.()
  }, [])

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || busy) return
      event.preventDefault()
      onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [busy, onClose])

  function mergePaths(nextPaths: string[]) {
    const previousPrimary = paths[0]
    const merged = [...new Set([...paths, ...nextPaths])]
    if (!merged.length) return
    const previousDefaultName = previousPrimary ? folderName(previousPrimary) : ""
    if (!name.trim() || name === previousDefaultName) setName(folderName(merged[0]!))
    setPaths(merged)
  }

  async function chooseFolders() {
    if (choosing || !canChooseFolder) return
    setChoosing(true)
    setError(undefined)
    try {
      const selectMany = window.noaDesktop?.selectProjectDirectories
      const selected = selectMany
        ? await selectMany()
        : await window.noaDesktop?.selectProjectDirectory?.().then((path) => path ? [path] : [])
      if (selected?.length) mergePaths(selected)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setChoosing(false)
      requestAnimationFrame(() => addFolderRef.current?.focus())
    }
  }

  function removeFolder(path: string) {
    if (project && (path === paths[0] || paths.length === 1)) return
    const wasDefaultName = !name.trim() || name === folderName(paths[0] ?? "")
    const next = paths.filter((candidate) => candidate !== path)
    setPaths(next)
    if (wasDefaultName) setName(next[0] ? folderName(next[0]) : "")
    requestAnimationFrame(() => addFolderRef.current?.focus())
  }

  function makePrimary(path: string) {
    if (project) return
    if (paths[0] === path) return
    const wasDefaultName = !name.trim() || name === folderName(paths[0] ?? "")
    setPaths([path, ...paths.filter((candidate) => candidate !== path)])
    if (wasDefaultName) setName(folderName(path))
    requestAnimationFrame(() => addFolderRef.current?.focus())
  }

  function onDrop(event: ReactDragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    if (busy || choosing || !canChooseFolder) return
    const items = Array.from(event.dataTransfer.items)
    const dropped = Array.from(event.dataTransfer.files).flatMap((file, index) => {
      const item = items[index] as (DataTransferItem & {
        webkitGetAsEntry?: () => { isDirectory: boolean } | null
      }) | undefined
      const entry = item?.webkitGetAsEntry?.()
      if (entry && !entry.isDirectory) return []
      const path = window.noaDesktop?.getPathForFile?.(file)
      return path ? [path] : []
    })
    if (!dropped.length) {
      setError("Drop folders here.")
      return
    }
    setError(undefined)
    mergePaths(dropped)
  }

  async function submit() {
    if (!paths.length || busy) return
    setBusy(true)
    setError(undefined)
    try {
      await onAdd(paths, name.trim())
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key !== "Tab") return
    const focusable = cardRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    )
    if (!focusable?.length) return
    const first = focusable[0]!
    const last = focusable[focusable.length - 1]!
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    }
  }

  return (
    <div
      className="noa-project-dialog"
      onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}
    >
      <form
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-project-title"
        onMouseDown={(event) => event.stopPropagation()}
        className="noa-project-dialog__panel"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
        onKeyDown={onKeyDown}
      >
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          aria-label="Close"
          title="Close"
          className="noa-project-dialog__close"
        >
          <X size={16} />
        </button>

        <h2 id="add-project-title" className="noa-project-dialog__title">
          {project ? "Edit project" : "Create project"}
        </h2>

        <div className="noa-project-dialog__body">
          <div>
            <label htmlFor="project-name" className="sr-only">Project name</label>
            <div className="noa-project-dialog__input">
              <span className="noa-project-dialog__input-leading">
                <Folder size={16} />
              </span>
              <input
                ref={nameRef}
                id="project-name"
                value={name}
                maxLength={120}
                onChange={(event) => setName(event.target.value)}
                placeholder="Project name"
                aria-label="Project name"
                autoFocus
                className="noa-project-dialog__name-input"
              />
            </div>
          </div>

          <div className="noa-project-dialog__section">
            <span className="noa-project-dialog__source-label">Source folders</span>
            <div
              className={`noa-project-dialog__sources${dragging ? " is-dragging" : ""}`}
              onDragEnter={(event) => {
                event.preventDefault()
                if (canChooseFolder) setDragging(true)
              }}
              onDragOver={(event) => {
                event.preventDefault()
                if (canChooseFolder) event.dataTransfer.dropEffect = "copy"
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              {paths.map((path, index) => (
                <div key={path} className="noa-project-dialog__source-row">
                  <Folder size={16} className="noa-project-dialog__source-icon" />
                  <span className="noa-project-dialog__source-name" title={path}>
                    {folderName(path)}
                  </span>
                  {paths.length > 1 && index === 0 && (
                    <span
                      className="noa-project-dialog__primary-badge"
                      title="Noa looks in the primary folder for AGENTS.md, config.toml, and skill files"
                    >
                      Primary
                    </span>
                  )}
                  {index > 0 && (
                    <button
                      type="button"
                      disabled={busy || choosing || Boolean(project)}
                      onClick={() => makePrimary(path)}
                      aria-label={`Make ${folderName(path)} primary`}
                      className="noa-project-dialog__make-primary"
                    >
                      Make primary
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy || choosing || Boolean(project && (paths.length === 1 || index === 0))}
                    onClick={() => removeFolder(path)}
                    aria-label={`Remove ${folderName(path)}`}
                    title="Remove folder"
                    className="noa-project-dialog__remove"
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
              <button
                ref={addFolderRef}
                type="button"
                disabled={busy || choosing || !canChooseFolder}
                onClick={() => void chooseFolders()}
                aria-label={paths.length ? "Add folder" : "Choose source folders"}
                className={`noa-project-dialog__source-add${paths.length ? "" : " is-empty"}`}
              >
                <FolderPlus size={16} />
                <span>
                  {choosing
                    ? "Choosing folders…"
                    : paths.length
                      ? "Add folder"
                      : "Add folders Noa can read and edit"}
                </span>
              </button>
            </div>
          </div>

          <div className="noa-project-dialog__footer">
            <div className="noa-project-dialog__status">
              {error && (
                <p role="alert" className="noa-project-dialog__error">
                  <AlertTriangle size={14} />
                  <span>{error}</span>
                </p>
              )}
            </div>
            <div className="noa-project-dialog__actions">
              <button
                type="button"
                disabled={busy}
                onClick={onClose}
                className="noa-project-dialog__button"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!paths.length || busy || choosing}
                aria-busy={busy || undefined}
                className="noa-project-dialog__button is-primary"
              >
                {busy && <Loader2 size={12} className="noa-project-dialog__spinner" />}
                <span>{project ? "Save project" : "Create project"}</span>
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}

function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}
