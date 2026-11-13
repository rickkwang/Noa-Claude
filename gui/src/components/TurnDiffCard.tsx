import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react"
import { formatPatch, parsePatch } from "diff"
import type { TurnDiff, TurnDiffActionResult, TurnDiffFile } from "../agent/protocol"
import { ChevronDown, ChevronRight, ChevronUp, RotateCcw, X } from "../lib/icons"
import { useConfirm } from "./ConfirmDialog"
import { CodexIcon } from "./CodexIcon"
import CodeView from "./CodeView"
import { OutputContext } from "./Markdown"

export function TurnDiffCard({ diff, onOpen, onAction, pending }: {
  diff: TurnDiff
  onOpen: (path?: string) => void
  onAction?: (action: "undo" | "reapply") => void
  pending?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const { onOpenFile } = useContext(OutputContext)
  const [previewFile, setPreviewFile] = useState<TurnDiffFile>()
  const trigger = useRef<HTMLButtonElement>(null)
  const preview = useRef<HTMLDivElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const previewPatch = useMemo(() => {
    if (!previewFile || !diff.patch) return ""
    const path = previewFile.patchPath ?? previewFile.path
    try {
      const patch = parsePatch(diff.patch).find(patch => [patch.newFileName, patch.oldFileName].some(name => name?.replace(/^(a|b)\//, "") === path))
      return patch ? formatPatch(patch) : ""
    } catch { return "" }
  }, [diff.patch, previewFile])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  useLayoutEffect(() => {
    if (!previewPatch || !preview.current || !trigger.current) return
    const panel = preview.current
    const rect = trigger.current.getBoundingClientRect()
    const above = rect.top > innerHeight - rect.bottom
    const width = Math.min(Math.max(0, rect.width - 64), innerWidth - 16)
    Object.assign(panel.style, {
      width: `${width}px`, left: `${Math.max(8, Math.min(rect.left + (rect.width - width) / 2, innerWidth - width - 8))}px`,
      top: above ? "auto" : `${rect.bottom}px`, bottom: above ? `${innerHeight - rect.top}px` : "auto",
      maxHeight: `${Math.max(0, Math.min(420, (above ? rect.top : innerHeight - rect.bottom) - 8))}px`,
    })
    panel.showPopover()
    const close = (event: Event) => {
      if (event.target instanceof Node && (panel.contains(event.target) || trigger.current?.contains(event.target))) return
      hidePreview()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault(); event.stopPropagation()
      trigger.current?.focus({ preventScroll: true })
      hidePreview()
    }
    window.addEventListener("keydown", escape, true)
    window.addEventListener("resize", close)
    window.addEventListener("scroll", close, true)
    document.addEventListener("pointerdown", close)
    return () => {
      if (panel.matches(":popover-open")) panel.hidePopover()
      window.removeEventListener("keydown", escape, true)
      window.removeEventListener("resize", close)
      window.removeEventListener("scroll", close, true)
      document.removeEventListener("pointerdown", close)
    }
  }, [previewPatch])
  function hidePreview() {
    window.clearTimeout(timer.current)
    setPreviewFile(undefined)
  }
  function showPreview(file: TurnDiffFile | undefined, button: HTMLButtonElement, delay = 0) {
    hidePreview()
    if (!file || file.binary || file.tooLarge || diff.truncated || !diff.patch) return
    trigger.current = button
    timer.current = window.setTimeout(() => setPreviewFile(file), delay)
  }
  function leavePreview(relatedTarget: EventTarget | null) {
    if (!(relatedTarget instanceof Node && preview.current?.contains(relatedTarget))) hidePreview()
  }
  function open(event: MouseEvent<HTMLButtonElement>, file?: TurnDiffFile) {
    hidePreview()
    if (file && (event.metaKey || event.ctrlKey) && onOpenFile) onOpenFile(file.path)
    else onOpen(file?.path)
  }
  const { confirm, dialog } = useConfirm()
  const single = diff.files.length === 1
  const shown = expanded ? diff.files : diff.files.slice(0, 3)
  const hidden = diff.files.length - shown.length
  const title = single ? `Edited ${basename(diff.files[0]!.path)}` : `Edited ${diff.files.length} files`
  const action = diff.reverted ? "reapply" : "undo"
  const canAct = onAction !== undefined && diff.turnIndex !== undefined && diff.undoable !== false

  return (
    <div className="noa-turn-diff-card">
      <div className="noa-turn-diff-headrow">
        <button
          type="button"
          className="noa-turn-diff-header group/turn-diff"
          onClick={event => open(event, single ? diff.files[0] : undefined)}
          onMouseEnter={event => showPreview(single ? diff.files[0] : undefined, event.currentTarget, 800)}
          onMouseLeave={event => leavePreview(event.relatedTarget)}
          onFocus={event => showPreview(single ? diff.files[0] : undefined, event.currentTarget)}
          onBlur={event => leavePreview(event.relatedTarget)}
          aria-label={`${title}. View changes`}
        >
          <span className="noa-turn-diff-icon"><CardIcon /></span>
          <span className="noa-turn-diff-heading">
            <span className="truncate text-[length:var(--font-text-md-size)] font-medium text-[var(--text-primary)]">{title}</span>
            <span className="noa-turn-diff-default">
              <Stats file={diff} />
            </span>
            <span className="noa-turn-diff-hover">
              View changes
              <ChevronRight size={12} aria-hidden="true" />
            </span>
          </span>
        </button>
        {canAct && (
          <button
            type="button"
            className="noa-turn-diff-action"
            disabled={pending}
            onClick={async () => {
              if (await confirm({
                title: action === "undo" ? "Undo workspace changes?" : "Reapply workspace changes?",
                description: <>
                  <p className="m-0">This snapshot includes changes made while this turn ran, including edits from you or other tasks. This action affects all files listed below.</p>
                  <ul className="mt-2 max-h-48 overflow-auto break-all pl-5">
                    {diff.files.map((file) => <li key={file.path}>{file.path}</li>)}
                  </ul>
                </>,
                confirmLabel: action === "undo" ? "Undo changes" : "Reapply changes",
                danger: true,
              })) onAction(action)
            }}
            title={action === "undo" ? "Undo" : "Reapply"}
          >
            {action === "reapply" ? "Reapply" : "Undo"}
            {pending ? <RotateCcw size={12} aria-hidden="true" className="animate-spin" /> : <CodexIcon name={action} size={12} />}
          </button>
        )}
        <button type="button" className="noa-turn-diff-view" onClick={() => onOpen(single ? diff.files[0]!.path : undefined)}>View changes</button>
      </div>
      {!single && (
        <div className="noa-turn-diff-list">
          {shown.map((file) => (
            <button key={file.path} type="button" className="noa-turn-diff-row" onClick={event => open(event, file)} title={file.path}
              onMouseEnter={event => showPreview(file, event.currentTarget, 800)} onMouseLeave={event => leavePreview(event.relatedTarget)}
              onFocus={event => showPreview(file, event.currentTarget)} onBlur={event => leavePreview(event.relatedTarget)}>
              <MiddlePath path={file.path} />
              <RowStats file={file} />
            </button>
          ))}
          {hidden > 0 && (
            <button type="button" className="noa-turn-diff-more" onClick={() => setExpanded(true)} aria-expanded="false">
              Show {hidden} more file{hidden === 1 ? "" : "s"}
              <ChevronDown size={12} aria-hidden="true" />
            </button>
          )}
          {expanded && diff.files.length > 3 && (
            <button type="button" className="noa-turn-diff-more" onClick={() => setExpanded(false)} aria-expanded="true">
              Collapse files
              <ChevronUp size={12} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
      {diff.truncated && <p className="noa-turn-diff-note">Diff too large to preview</p>}
      {diff.undoable === false && <p className="noa-turn-diff-note">{diff.restoredByRewind ? "A rewind restored these files to how they were before this turn." : "Undo is unavailable when a turn changes multiple source folders."}</p>}
      {previewFile && previewPatch && <div ref={preview} popover="manual" role="dialog" aria-label={`Changes to ${previewFile.path}`} data-turn-diff-preview
        className="noa-turn-diff-preview noa-floating-panel m-0 flex flex-col overflow-hidden rounded-lg p-0 text-[var(--text-primary)]" style={{ position: "fixed", inset: "auto" }}
        onMouseLeave={event => { if (!(event.relatedTarget instanceof Node && trigger.current?.contains(event.relatedTarget)) && !preview.current?.contains(document.activeElement)) hidePreview() }}>
        <div className="flex min-w-0 shrink-0 items-center gap-2 border-b border-[var(--divider-subtle)] px-3 py-2 text-body">
          <span className="min-w-0 flex-1"><MiddlePath path={previewFile.path} /></span><RowStats file={previewFile} />
          <button type="button" aria-label="Close diff preview" onClick={hidePreview}><X size={14} /></button>
        </div>
        <div className="noa-panel-body is-code scrollbar-on-scroll"><CodeView path={previewFile.path} content={previewPatch} diff /></div>
      </div>}
      {dialog}
    </div>
  )
}

// Codex's square-plus-minus glyph (24px monochrome); the card uses it instead of a file-diff document.
function CardIcon() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M14.5 15.25C14.9142 15.25 15.25 15.5858 15.25 16C15.25 16.4142 14.9142 16.75 14.5 16.75H9.5C9.08579 16.75 8.75 16.4142 8.75 16C8.75 15.5858 9.08579 15.25 9.5 15.25H14.5Z" fill="currentColor" />
      <path d="M12 6.75C12.4142 6.75 12.75 7.08579 12.75 7.5V9.25H14.5C14.9142 9.25 15.25 9.58579 15.25 10C15.25 10.4142 14.9142 10.75 14.5 10.75H12.75V12.5C12.75 12.9142 12.4142 13.25 12 13.25C11.5858 13.25 11.25 12.9142 11.25 12.5V10.75H9.5C9.08579 10.75 8.75 10.4142 8.75 10C8.75 9.58579 9.08579 9.25 9.5 9.25H11.25V7.5C11.25 7.08579 11.5858 6.75 12 6.75Z" fill="currentColor" />
      <path d="M17.2002 3.25C19.1607 3.25011 20.7499 4.83935 20.75 6.7998V17.2002C20.7499 19.1607 19.1607 20.7499 17.2002 20.75H6.7998C4.83935 20.7499 3.25011 19.1607 3.25 17.2002V6.7998C3.25011 4.83935 4.83935 3.25011 6.7998 3.25H17.2002ZM6.7998 4.75C5.66778 4.75011 4.75011 5.66778 4.75 6.7998V17.2002C4.75011 18.3322 5.66778 19.2499 6.7998 19.25H17.2002C18.3322 19.2499 19.2499 18.3322 19.25 17.2002V6.7998C19.2499 5.66778 18.3322 4.75011 17.2002 4.75H6.7998Z" fillRule="evenodd" clipRule="evenodd" fill="currentColor" />
    </svg>
  )
}

/** In-progress row above the composer: files changed while the turn runs. */
export function LiveDiffSummary({ diff, onOpen }: { diff: TurnDiff; onOpen: () => void }) {
  const count = diff.files.length
  if (count === 0) return null
  return (
    <button
      type="button"
      className="noa-live-diff noa-press"
      onClick={onOpen}
      aria-label={`${count} ${count === 1 ? "file" : "files"} changed. View changes`}
    >
      <CodexIcon name="square-plus-minus" size={14} className="shrink-0" />
      <span className="noa-shimmer">{count} {count === 1 ? "file" : "files"} changed</span>
      <Stats file={diff} />
    </button>
  )
}

export function DiffActionDialog({ action, result, onClose }: {
  action: "undo" | "reapply"
  result: TurnDiffActionResult
  onClose: () => void
}) {
  useEffect(() => {
    if (!result.ok) return
    const timer = window.setTimeout(onClose, 3500)
    return () => window.clearTimeout(timer)
  }, [result, onClose])
  const reverted = action === "undo"
  if (result.ok) return (
    <div role="status" className="noa-turn-diff-notice noa-floating-panel fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl px-4 py-3 text-body text-[var(--text-primary)]">
      {reverted ? "Changes reverted" : "Changes reapplied"}
      <button type="button" aria-label="Dismiss notification" onClick={onClose}><X size={14} /></button>
    </div>
  )
  const title =
    result.errorCode === "not-git-repo"
      ? `${reverted ? "Undo" : "Reapply"} requires a Git repository`
      : result.appliedPaths.length > 0
        ? `Some changes ${reverted ? "reverted" : "reapplied"}`
        : result.skippedPaths.length > 0 && result.conflictedPaths.length === 0
          ? `No changes ${reverted ? "reverted" : "reapplied"}`
          : `Failed to ${reverted ? "revert" : "reapply"} changes`
  const groups = [
    { label: `Applied cleanly (${result.appliedPaths.length})`, paths: result.appliedPaths, color: "" },
    { label: `Skipped (${result.skippedPaths.length})`, paths: result.skippedPaths, color: "text-[var(--sidebar-text-muted)]" },
    { label: `Conflicts (${result.conflictedPaths.length})`, paths: result.conflictedPaths, color: "text-[#C24444]" },
  ].filter((group) => group.paths.length > 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-6" role="presentation" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="noa-confirm-dialog w-full max-w-md rounded-2xl bg-[var(--bg-card)] p-5 font-ui text-[var(--text-primary)]"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="m-0 text-balance text-[length:var(--font-text-md-size)] font-medium tabular-nums">{title}</h2>
        {result.errorCode === "no-patch" && (
          <p className="mt-2 text-caption text-[var(--sidebar-text-muted)]">This turn has no stored patch to apply.</p>
        )}
        {result.errorCode === "not-git-repo" && (
          <p className="mt-2 text-caption text-[var(--sidebar-text-muted)]">This action only works when running in a Git repository.</p>
        )}
        {groups.length > 0 && (
          <div className="mt-3 flex max-h-[40vh] flex-col gap-3 overflow-y-auto">
            {groups.map((group) => (
              <div key={group.label}>
                <p className={`m-0 text-caption font-medium tabular-nums ${group.color}`}>{group.label}</p>
                <ul className="m-0 mt-1 list-none break-all p-0 text-caption text-[var(--sidebar-text-muted)]">
                  {group.paths.map((path) => <li key={path}>{path}</li>)}
                </ul>
              </div>
            ))}
          </div>
        )}
        {result.error && groups.length === 0 && (
          <p className="mt-2 whitespace-pre-wrap break-words text-caption text-[#C24444]">{result.error}</p>
        )}
        <div className="mt-4 flex justify-end">
          <button type="button" className="noa-panel-button" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

function Stats({ file }: { file: TurnDiff }) {
  return (
    <span className="noa-turn-diff-stats">
      {file.additions > 0 && <span className="is-added">+{file.additions}</span>}
      {file.deletions > 0 && <span className="is-removed">-{file.deletions}</span>}
    </span>
  )
}

function RowStats({ file }: { file: TurnDiffFile }) {
  if (file.binary) return <span className="noa-turn-diff-note">Binary</span>
  return (
    <span className="noa-turn-diff-stats">
      {file.tooLarge && <span className="noa-turn-diff-note">Too large to render inline</span>}
      {file.additions > 0 && <span className="is-added">+{file.additions}</span>}
      {file.deletions > 0 && <span className="is-removed">-{file.deletions}</span>}
    </span>
  )
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path
}

export function MiddlePath({ path }: { path: string }) {
  const at = path.lastIndexOf("/")
  return (
    <span className="noa-middle-path" title={path}>
      {at > 0 && <span className="noa-middle-path-dir">{path.slice(0, at + 1)}</span>}
      <span className="noa-middle-path-base">{path.slice(at + 1)}</span>
    </span>
  )
}
