import { useEffect, useRef, useState } from "react"
import type { ControlRequest } from "../agent/protocol"
import type { AppSettings } from "../types"
import { GitBranch, ListDetails, MoreHorizontal, RotateCcw } from "../lib/icons"
import { anchorBelow, PopupMenu, type PopupMenuAnchor } from "./PopupMenu"

type TranscriptView = AppSettings["appearance"]["transcriptView"]

export function SessionActions({ disabled, transcriptView, onTranscriptViewChange, onFork }: {
  disabled: boolean
  transcriptView: TranscriptView
  onTranscriptViewChange: (view: TranscriptView) => void
  onFork: () => Promise<void>
}) {
  const [anchor, setAnchor] = useState<PopupMenuAnchor>()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const trigger = useRef<HTMLButtonElement>(null)
  return <>
    <button ref={trigger} type="button" aria-label="Task actions" aria-haspopup="menu" aria-expanded={!!anchor} title="Task actions" disabled={pending} className="flex size-7 items-center justify-center rounded-md hover:bg-[var(--fill-hover)] disabled:opacity-40" onClick={event => setAnchor(anchor ? undefined : anchorBelow(event.currentTarget))}>{pending ? <span className="size-3 animate-spin rounded-full border border-current border-t-transparent" /> : <MoreHorizontal size={16} />}</button>
    {anchor && <PopupMenu anchor={anchor} trigger={trigger.current} label="Task actions" onClose={() => setAnchor(undefined)} entries={[
      { label: "Fork conversation", icon: GitBranch, disabled, onSelect: () => {
        setAnchor(undefined)
        setPending(true)
        setError(undefined)
        void onFork().catch(error => setError(error.message)).finally(() => setPending(false))
      } },
      { kind: "separator" },
      { label: "Transcript view", icon: ListDetails, submenu: [
        { label: "Normal", checked: transcriptView === "normal", onSelect: () => onTranscriptViewChange("normal") },
        { label: "Verbose", checked: transcriptView === "verbose", onSelect: () => onTranscriptViewChange("verbose") },
      ] },
    ]} />}
    {error && <span role="alert" className="text-caption text-[var(--text-danger)]">{error}</span>}
  </>
}

export function RewindButton({ blocked, onClick }: { blocked?: string; onClick: () => void }) {
  const label = blocked ?? "Rewind: take back this message and everything after it"
  return <button type="button" data-rewind disabled={!!blocked} aria-label={label} title={label} onClick={onClick} className="flex size-7 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--fill-hover)] disabled:opacity-40"><RotateCcw size={14} /></button>
}

export type RewindPreview = { canRewind?: boolean; filesChanged?: string[]; insertions?: number; deletions?: number; turnsRemoved?: number }
type RewindMode = "both" | "conversation" | "files"

// Opened only when files changed after the message, so the choice is about whether to restore them.
export function RewindDialog({ message, cwd, preview, initialError, request, onClose, onDone }: {
  message: { id: string; text: string }
  cwd: string
  preview?: RewindPreview
  initialError?: string
  request: (request: ControlRequest) => Promise<any>
  onClose: () => void
  onDone: (mode: RewindMode) => void
}) {
  const files = preview?.canRewind ? preview.filesChanged ?? [] : []
  const [mode, setMode] = useState<RewindMode>(files.length ? "both" : "conversation")
  const [error, setError] = useState(initialError)
  const [pending, setPending] = useState(false)
  const [showFiles, setShowFiles] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    panel.current?.querySelector<HTMLElement>("[data-rewind-cancel]")?.focus()
    return () => previous?.focus()
  }, [])
  async function confirm() {
    if (pending) return
    setPending(true)
    setError(undefined)
    try {
      await request({ subtype: "session_action", action: "rewind", user_message_id: message.id, mode })
      onDone(mode)
    } catch (error) { setError((error as Error).message) }
    finally { setPending(false) }
  }
  const fileCount = `${files.length} file${files.length === 1 ? "" : "s"}`
  const theWayBefore = files.length === 1 ? "back the way it was" : "back the way they were"
  const options: [RewindMode, string][] = files.length ? [["both", "Chat and files"], ["conversation", "Chat only"], ["files", "Files only"]] : [["conversation", "Chat only"]]
  const consequence = mode === "both" ? `Removes this message and the replies after it, and puts ${fileCount} ${theWayBefore} before it.`
    : mode === "files" ? `Puts ${fileCount} ${theWayBefore} before this message. The chat stays as it is.`
      : files.length ? `Removes this message and the replies after it. ${fileCount} keep their current changes.` : "Removes this message and the replies after it."
  return <div className="noa-confirm-scrim fixed inset-0 z-50 flex items-center justify-center p-4" onClick={event => { if (event.target === event.currentTarget && !pending) onClose() }} onKeyDown={event => {
    if (event.key === "Escape" && !pending) { event.stopPropagation(); onClose() }
    if (event.key === "Tab") {
      const items = [...panel.current!.querySelectorAll<HTMLElement>("button:not(:disabled)")]
      const first = items[0], last = items.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
  }}>
    <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="rewind-title" aria-busy={pending} className="noa-confirm-dialog flex max-h-[calc(100vh-32px)] w-full max-w-[440px] flex-col gap-3 overflow-y-auto rounded-2xl bg-[var(--bg-card)] p-5 font-ui">
      <h2 id="rewind-title" className="m-0 text-body font-medium">Rewind to before this message?</h2>
      <div className="rounded-lg bg-[var(--fill-hover)] px-3 py-2"><p className="m-0 line-clamp-2 whitespace-pre-wrap break-words text-body text-[var(--text-primary)]">{message.text}</p></div>
      {files.length > 0 && <div role="radiogroup" aria-label="What to rewind" className="flex gap-1 rounded-lg bg-[var(--fill-hover)] p-0.5">
        {options.map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={mode === value} disabled={pending} onClick={() => setMode(value)} className={`h-7 flex-1 rounded-md text-body ${mode === value ? "bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}>{label}</button>)}
      </div>}
      <div className="flex flex-col gap-1 text-caption text-[var(--text-secondary)]">
        <p className="m-0">{consequence}{mode !== "files" && " Your message goes back into the composer so you can edit and resend it."}</p>
        {files.length > 0 && mode !== "conversation" && <>
          <button type="button" aria-expanded={showFiles} onClick={() => setShowFiles(value => !value)} className="w-fit text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            <span className="noa-change-count">{fileCount}{preview?.insertions ? <> · <span className="is-added">+{preview.insertions}</span></> : null}{preview?.deletions ? <> {preview.insertions ? "" : "· "}<span className="is-removed">−{preview.deletions}</span></> : null}</span> · {showFiles ? "Hide" : "Show"} files
          </button>
          {showFiles && <ul className="m-0 max-h-28 overflow-auto pl-4">{files.map(path => <li key={path} className="break-all">{path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path}</li>)}</ul>}
          <p className="m-0 text-[var(--text-tertiary)]">Changes made by shell commands, and commits, are not undone.</p>
        </>}
      </div>
      {error && <p role="alert" className="m-0 text-caption text-[var(--text-danger)]">{error}</p>}
      <div className="mt-1 flex justify-end gap-2">
        <button data-rewind-cancel type="button" disabled={pending} className="noa-confirm-btn h-8 rounded-lg border border-[var(--border-default)] px-3 text-body" onClick={onClose}>Cancel</button>
        <button type="button" disabled={pending} className="h-8 rounded-lg bg-[var(--text-primary)] px-3 text-body text-[var(--bg-card)] disabled:opacity-40" onClick={() => void confirm()}>{pending ? "Rewinding…" : mode === "files" ? "Restore files" : "Rewind"}</button>
      </div>
    </div>
  </div>
}
