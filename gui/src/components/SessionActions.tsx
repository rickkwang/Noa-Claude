import { useEffect, useRef, useState } from "react"
import type { ControlRequest } from "../agent/protocol"
import { GitBranch, MoreHorizontal, RotateCcw } from "../lib/icons"
import { anchorBelow, PopupMenu, type PopupMenuAnchor } from "./PopupMenu"

export function SessionActions({ disabled, onFork }: { disabled: boolean; onFork: () => Promise<void> }) {
  const [anchor, setAnchor] = useState<PopupMenuAnchor>()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const trigger = useRef<HTMLButtonElement>(null)
  return <>
    <button ref={trigger} type="button" aria-label="Task actions" aria-haspopup="menu" aria-expanded={!!anchor} title="Task actions" disabled={disabled || pending} className="flex size-7 items-center justify-center rounded-md hover:bg-[var(--fill-hover)] disabled:opacity-40" onClick={event => setAnchor(anchor ? undefined : anchorBelow(event.currentTarget))}>{pending ? <span className="size-3 animate-spin rounded-full border border-current border-t-transparent" /> : <MoreHorizontal size={16} />}</button>
    {anchor && <PopupMenu anchor={anchor} trigger={trigger.current} label="Task actions" onClose={() => setAnchor(undefined)} entries={[{ label: "Fork conversation", icon: GitBranch, onSelect: () => {
      setAnchor(undefined)
      setPending(true)
      setError(undefined)
      void onFork().catch(error => setError(error.message)).finally(() => setPending(false))
    } }]} />}
    {error && <span role="alert" className="text-caption text-[var(--text-danger)]">{error}</span>}
  </>
}

export function RewindButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return <button type="button" disabled={disabled} aria-label="Rewind to this message" title="Rewind to this message" onClick={onClick} className="flex size-7 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--fill-hover)] disabled:opacity-40"><RotateCcw size={14} /></button>
}

export function RewindDialog({ message, request, onClose, onDone }: {
  message: { id: string; text: string }
  request: (request: ControlRequest) => Promise<any>
  onClose: () => void
  onDone: (restorePrompt: boolean) => void
}) {
  const [mode, setMode] = useState<"conversation" | "files" | "both">("conversation")
  const [preview, setPreview] = useState<{ turnsRemoved?: number; filesChanged?: string[] }>()
  const [error, setError] = useState<string>()
  const [pending, setPending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [previewKey, setPreviewKey] = useState(0)
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    panel.current?.querySelector<HTMLElement>("[data-rewind-cancel]")?.focus()
    return () => previous?.focus()
  }, [])
  useEffect(() => {
    let cancelled = false
    setPreview(undefined)
    setError(undefined)
    setLoading(true)
    void request({ subtype: "session_action", action: "rewind", user_message_id: message.id, mode, dry_run: true }).then(result => { if (!cancelled) setPreview(result) }).catch(error => { if (!cancelled) setError(error.message) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [message.id, mode, request, previewKey])
  async function restore() {
    if (pending || loading || !preview) return
    setPending(true)
    try {
      await request({ subtype: "session_action", action: "rewind", user_message_id: message.id, mode })
      onDone(mode !== "files")
    } catch (error) { setError((error as Error).message) }
    finally { setPending(false) }
  }
  return <div className="noa-confirm-scrim fixed inset-0 z-50 flex items-center justify-center p-4" onClick={event => { if (event.target === event.currentTarget && !pending) onClose() }} onKeyDown={event => {
    if (event.key === "Escape" && !pending) { event.stopPropagation(); onClose() }
    if (event.key === "Tab") {
      const items = [...panel.current!.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)")]
      const first = items[0], last = items.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
  }}>
    <div ref={panel} role="dialog" aria-modal="true" aria-label="Rewind conversation" aria-busy={loading || pending} className="noa-confirm-dialog flex max-h-[calc(100vh-32px)] w-full max-w-[480px] flex-col overflow-y-auto rounded-2xl bg-[var(--bg-card)] p-5 font-ui">
      <h2 className="m-0 text-body font-medium">Rewind to this message</h2>
      <p className="my-3 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--fill-hover)] px-3 py-2 text-caption text-[var(--text-secondary)]">{message.text}</p>
      <fieldset aria-label="Rewind scope" disabled={pending || loading} className="flex flex-col gap-2 text-body">
        {([['conversation', 'Conversation only'], ['files', 'Files only'], ['both', 'Conversation and files']] as const).map(([value, label]) => <label key={value} className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 ${mode === value ? "border-[var(--accent-color)] bg-[var(--fill-hover)]" : "border-[var(--border-default)]"}`}><input style={{ accentColor: "var(--accent-color)" }} type="radio" name="rewind-mode" checked={mode === value} onChange={() => setMode(value)} />{label}</label>)}
      </fieldset>
      <p className="mt-3 text-caption text-[var(--text-secondary)]">{mode === "conversation" ? "This message and later replies will leave the active conversation. Files stay as they are." : mode === "files" ? "Checkpointed files will be restored. This can overwrite later edits. The conversation stays as it is." : "This message and later replies will leave the active conversation. Restoring checkpointed files can overwrite later edits."}</p>
      {loading && <p role="status" className="mt-3 text-caption text-[var(--text-tertiary)]">Checking the selected restore point…</p>}
      {preview && <p role="status" className="mt-3 text-caption text-[var(--text-secondary)]">{mode !== "files" && `${preview.turnsRemoved ?? 0} user message${preview.turnsRemoved === 1 ? "" : "s"} will be removed. `}{mode !== "conversation" && `${preview.filesChanged?.length ?? 0} checkpointed file${preview.filesChanged?.length === 1 ? "" : "s"} will be restored. Shell commands and external changes are not rolled back.`}</p>}
      {preview?.filesChanged?.length ? <ul className="my-2 max-h-24 overflow-auto text-caption">{preview.filesChanged.map(path => <li key={path}>{path}</li>)}</ul> : null}
      {error && <div role="alert" className="mt-3 text-caption text-[var(--text-danger)]"><p>{error}</p><button type="button" className="mt-2 h-7 rounded-md border border-[var(--border-default)] px-2 text-[var(--text-primary)] hover:bg-[var(--fill-hover)]" onClick={() => setPreviewKey(value => value + 1)}>Check again</button></div>}
      <div className="mt-4 flex justify-end gap-2"><button data-rewind-cancel type="button" disabled={pending} className="noa-confirm-btn h-8 rounded-lg border border-[var(--border-default)] px-3 text-body" onClick={onClose}>Cancel</button><button type="button" disabled={pending || loading || !preview || !!error} className="h-8 rounded-lg bg-[var(--accent-color)] px-3 text-body text-white disabled:opacity-40" onClick={() => void restore()}>{pending ? "Rewinding…" : "Rewind"}</button></div>
    </div>
  </div>
}
